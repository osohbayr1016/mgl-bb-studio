#!/usr/bin/env python3
"""
MGL AI · QLoRA СУРГАЛТ (§33) — SERVING СУУРЬ Qwen3-8B-ийн ЭСРЭГ.

⚠️ ХАТУУ ҮНЭН: RTX 3070-ийн 8 GB VRAM дээр 8B загварыг FP16-аар БҮРЭН
   fine-tune хийх БОЛОМЖГҮЙ.  Тооцоо:

       жин         8B × 2 байт (fp16)        = 16.0 GB
       градиент    8B × 2 байт               = 16.0 GB
       AdamW төлөв 8B × 8 байт (m, v fp32)   = 64.0 GB
       ──────────────────────────────────────────────
       нийт (activation-гүйгээр)             ≈ 96 GB

   «Багц хэмжээг багасгая» гэсэн зөвлөгөө энд ажиллахгүй — дээрх гурав нь
   багцаас ХАМААРАХГҮЙ.

   ТИЙМЭЭС: QLoRA.  Суурь жин 4-бит (NF4) хөлдөнө, зөвхөн LoRA адаптер
   сургагдана.  8B багтах ЭСЭХ нь ТООЦООЛОЛ БИШ, ХЭМЖИЛТ — `memory_probe.py`
   нь 512 → 768 → 1024 гэсэн шатаар бодит forward/backward/optimizer-ийн
   оргил VRAM-ыг хэмжиж FITS_STABLY / FITS_WITH_OFFLOAD_OR_REDUCED_SEQ /
   DOES_NOT_FIT_CURRENT_STACK гэж хэлнэ; `readiness.mjs`-ийн H4 нь ТҮҮНИЙГ
   л уншина.  Энэ файлын өмнөх хувилбар «4B-д л болно, 8B-д ≥12 GB» гэж
   ХЭМЖИЛГҮЙ бичсэн байсан — тэр таамаг хасагдав.

⚠️ СУУРЬ = SERVING СУУРЬ.  Ажилтны машин дээр `Qwen3-8B-Q4_K_M.gguf`
   (unsloth/Qwen3-8B-GGUF ← Qwen/Qwen3-8B@b968826d) ажилладаг тул адаптерыг
   ЯГ `Qwen/Qwen3-8B` дээр сургана.  4B дээр сургасан адаптер 8B-д
   АЖИЛЛАХГҮЙ (давхарга 36 vs 36 ч embedding 4096 vs 2560).  Санах ойн
   асуудлыг 4B руу шилжиж «шийдэхийг» ЭНЭ ФАЙЛ ЗӨВШӨӨРӨХГҮЙ — `--base-model`
   нь registry-ийн serving суурьтай таарахгүй бол зогсоно (`--allow-base-mismatch`
   зөвхөн туршилтад, тэмдэглэгээтэй).

⚠️ АНХНЫ СУРГАЛТ БОЛ SMOKE НЭР ДЭВШИГЧ (§26): `--run-name mgl-adapter-0.1-smoke`.
   Зорилго — дамжуулах хоолой, адаптер ачаалалт, зан төлөвийн чиглэл, монгол
   хэв маяг, гэрээний зан төлөв, гамшигт регресс байхгүй эсэх.  Продакшн БИШ.

⚠️ §35 — ДИНАМИК БАРИМТЫГ ЖИНД СУРГАХГҮЙ.  `dataset_lint.py` нь багцыг
   шалгаж, амьд ERP утга агуулсан мөрийг ТАТГАЛЗАНА.  Тэр шалгалтыг
   алгасах туг ЭНД БАЙХГҮЙ.

⚠️ ЗӨВХӨН TRAIN ХУВААЛТ (§27).  val нь eval_loss-д, test/алтан/held-out нь
   ХЭЗЭЭ Ч оролцохгүй.

Ажиллуулах (төслийн venv):
    ai/training/.venv/Scripts/python.exe -X utf8 ai/training/train_lora.py --dataset behavior --dry-run
    ai/training/.venv/Scripts/python.exe -X utf8 ai/training/train_lora.py --dataset behavior --run-name mgl-adapter-0.1-smoke
"""


from __future__ import annotations

import sys as _sys

# ⚠️ Windows-ийн консол нь өгөгдмөлөөр cp1252 — кирилл тэмдэгт бүхий
#    ганц `print` нь UnicodeEncodeError-оор скриптийг УНАГААНА.
for _stream in (_sys.stdout, _sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import argparse
import hashlib
import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATASETS = ROOT / "datasets"
BEHAVIOR_OUT = ROOT / "training" / "out"
REPORTS = ROOT / "training" / "reports"
OUT = ROOT / "models" / "adapters"
REGISTRY = ROOT / "registry" / "models.json"
SERVING_VARIANT = "employee-8b-q4"


def serving_base() -> tuple[str, str | None]:
    """Registry-ийн serving суурь (репо, хувилбар).  Хатуу бичихгүй."""
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for c in reg["candidates"]:
        if c["runtime_variant"] == SERVING_VARIANT:
            return c["base_model"], c.get("base_model_revision")
    sys.exit(f"registry-д {SERVING_VARIANT} алга")


# ⚠️ ЭДГЭЭР ТОО НЬ ӨГӨГДМӨЛ, БҮТЭЭГДЭХҮҮНИЙ ШААРДЛАГА БИШ (§25).  Smoke
#    сургалтын утгыг багцын хэмжээ, дарааллын тархалт, санах ойн хэмжилтээс
#    сонгож `--rank/--alpha/--lr/--epochs/--max-seq-len`-ээр өгнө; сонголт
#    ба шалтгаан нь тайланд (`reports/train-<run>.json`) бичигдэнэ.
@dataclass
class TrainConfig:
    base_model: str = "Qwen/Qwen3-8B"
    base_revision: str | None = "b968826d9c46dd6066d109eabc6255188de91218"
    dataset: str = ""
    run_name: str = ""
    lora_r: int = 16
    lora_alpha: int = 32
    lora_dropout: float = 0.05
    # ⚠️ Анхаарлын БҮХ проекц + MLP.  Зөвхөн q,v сургах нь монгол хэлний
    #    дасан зохицолд ХАНГАЛТГҮЙ (токенизаци нь латинд оновчтой).
    #    Санах ой багтахгүй бол `--targets attn` (зөвхөн q,k,v,o).
    target_modules: tuple[str, ...] = (
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    )
    micro_batch: int = 1
    grad_accum: int = 16
    max_seq_len: int = 1024
    # Утгын тайралтын шатууд — probe-ийн хэмжсэн багтах уртууд; мөр бүр хамгийн бага багтах шат руу дүүргэгдэнэ.
    seq_buckets: tuple[int, ...] = (1536,)
    learning_rate: float = 2e-4
    epochs: float = 1.0
    warmup_ratio: float = 0.03
    gradient_checkpointing: bool = True
    load_in_4bit: bool = True
    bnb_4bit_quant_type: str = "nf4"
    bnb_4bit_compute_dtype: str = "bfloat16"
    bnb_4bit_use_double_quant: bool = True
    optim: str = "paged_adamw_8bit"
    # lm_head-ийг ч NF4 (~0.9 GB хэмнэнэ) — memory_probe.py --quantize-lm-head-той ижил.
    quantize_lm_head: bool = False
    seed: int = 42
    resume: bool = False
    # N optimizer алхам тутамд checkpoint (0 = epoch бүрд).  config.json-д хадгалагдана → --resume ижилхэн.
    save_steps: int = 0
    # Зөвхөн assistant токенд алдагдал тооцно — system/user prompt-ыг сургахгүй.
    completion_only: bool = True
    eval_on_val: bool = True
    reason: str = ""


def latest_probe() -> dict | None:
    files = sorted(REPORTS.glob("memory-probe-*.json"))
    if not files:
        return None
    d = json.loads(files[-1].read_text(encoding="utf-8"))
    d["_file"] = files[-1].name
    return d


def preflight(cfg: TrainConfig, allow_mismatch: bool) -> None:
    """⚠️ Сургалт эхлэхээс ӨМНӨ бодит нөхцөлийг шалгана."""
    base, rev = serving_base()
    if cfg.base_model != base and not allow_mismatch:
        sys.exit(
            f"Сургалтын суурь ({cfg.base_model}) нь SERVING суурьтай ({base}) таарахгүй.\n"
            "  Өөр суурь дээр сургасан адаптер ажилтны машин дээр АЖИЛЛАХГҮЙ.\n"
            "  Санах ойн асуудлыг суурь солих замаар ШИЙДЭХГҮЙ — memory_probe.py-ийн\n"
            "  хэмжилтээр дараалал/зорилтот модуль/offload-оор шийднэ."
        )
    if cfg.base_revision is None:
        cfg.base_revision = rev
    try:
        import torch  # noqa: PLC0415
    except ImportError:
        sys.exit("torch суулгаагүй байна.  ai/training/.venv → pip install -r requirements.txt")
    if not torch.cuda.is_available():
        sys.exit("CUDA олдсонгүй.  8 GB GPU-гүйгээр энэ сургалт бодит хугацаанд дуусахгүй.")
    vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
    print(f"  GPU: {torch.cuda.get_device_name(0)} · {vram_gb:.1f} GB · torch {torch.__version__}")
    probe = latest_probe()
    if probe is None:
        sys.exit("memory_probe.py-ийн хэмжилт алга — 8B багтах эсэхийг ХЭМЖИЛГҮЙ сургахгүй.  `npm run ai:train:probe`")
    if probe.get("verdict") == "DOES_NOT_FIT_CURRENT_STACK":
        sys.exit(f"Хэмжилт: {probe['verdict']} — сургалт ЭХЛҮҮЛЭХГҮЙ.  Тайлан: {probe.get('_file')}")
    # Хэмжсэн урт нь БҮХ probe тайлангийн нэгдэл (ижил суурь) — сүүлийн probe зөвхөн 2048+ хэмжсэн байж болно.
    ok_seqs = sorted({st["max_seq"] for f in REPORTS.glob("memory-probe-*.json") for st in json.loads(f.read_text(encoding="utf-8")).get("stages", []) if st.get("ok") and json.loads(f.read_text(encoding="utf-8")).get("base_model") == cfg.base_model})
    for b in cfg.seq_buckets:
        if b not in ok_seqs:
            sys.exit(f"seq bucket {b} нь хэмжсэн багтах уртад ({ok_seqs}) байхгүй.  Хэмжсэн утгаас сонго.")
    print(f"  Санах ойн хэмжилт: {probe['verdict']} · багтсан урт {ok_seqs}")


def load_split(name: str, split: str) -> list[dict]:
    if name == "behavior":
        path = BEHAVIOR_OUT / f"behavior-sft-{split}.jsonl"
    else:
        path = DATASETS / name / f"{split}.jsonl"
    if not path.exists():
        if split != "train":
            return []
        sys.exit(f"Багц олдсонгүй: {path}\n  Эхлээд:  npm run ai:build:sft")
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def manifest_of(name: str) -> dict:
    path = (BEHAVIOR_OUT if name == "behavior" else DATASETS / name) / "manifest.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def sha256_dir(path: Path) -> dict[str, str]:
    out = {}
    for f in sorted(path.rglob("*")):
        if f.is_file():
            h = hashlib.sha256()
            with f.open("rb") as fh:
                for chunk in iter(lambda: fh.read(1 << 20), b""):
                    h.update(chunk)
            out[str(f.relative_to(path)).replace("\\", "/")] = h.hexdigest()
    return out


def sliced_completion_loss(model, input_ids, attention_mask, labels, num_items_in_batch=None):
    """
    ЗӨВХӨН ЗОРИЛТЫН БАЙРЛАЛД logits тооцно (`logits_to_keep`) — completion-only алдагдал.

    ⚠️ ХЭМЖСЭН (2026-09-10): бүтэн дарааллын logits (N × 151 936 үгсийн сан, fp32 upcast +
       градиент) нь 1024 токенд ~1.5 GB — 8 GB GPU-д суурь (5.8 GB) дээр нэмэгдэхэд
       sysmem spill-ийн ГОЛ шалтгаан.  Prompt-ын байрлалын logits нь алдагдалд ОРДОГГҮЙ
       (label -100) тул тэдгээрийг тооцох нь цэвэр үрэлт.  Зорилт нь дарааллын
       ТӨГСГӨЛД (assistant) байдаг тул сүүлийн k = |зорилт| + 1 байрлал хангалттай.
       Энэ нь transformers-ийн албан ёсны `logits_to_keep` параметр — hack биш.
    """
    import torch
    import torch.nn.functional as F

    k = int((labels != -100).sum().item()) + 1
    k = max(2, min(k, input_ids.shape[1]))
    out = model(input_ids=input_ids, attention_mask=attention_mask, logits_to_keep=k, use_cache=False)
    logits = out.logits[:, :-1, :].float()
    tgt = labels[:, -(k - 1):]
    if num_items_in_batch is None:
        return F.cross_entropy(logits.reshape(-1, logits.shape[-1]), tgt.reshape(-1), ignore_index=-100)
    # ⚠️ transformers ≥ 4.46-ийн gradient accumulation гэрээ: Trainer нь НЭГ optimizer
    #    алхмын БҮХ micro-batch-ийн зорилтын токены тоог `num_items_in_batch`-аар өгдөг;
    #    алдагдал = токены НИЙЛБЭР / тэр тоо.  Дундаж буцаавал 8 micro-batch-ийн дундаж
    #    нэмэгдэж лог дээр 8 дахин их «loss» (23.7) гарч байв — Adam-д нөлөөгүй ч тайлан худал.
    total = F.cross_entropy(logits.reshape(-1, logits.shape[-1]), tgt.reshape(-1), ignore_index=-100, reduction="sum")
    return total / num_items_in_batch


def prepare_kbit_bf16(model, gradient_checkpointing: bool = True) -> None:
    """
    `peft.prepare_model_for_kbit_training`-ийн ОРЛУУЛАГЧ — fp32 upcast-ГҮЙ.

    ⚠️ ХЭМЖСЭН (2026-09-10, RTX 3070 8 GB): PEFT-ийн функц нь квантчлагдаагүй
       БҮХ bf16 параметрийг fp32 болгодог — Qwen3-8B-д `embed_tokens` + `lm_head`
       (2 × 620M, tie_word_embeddings=false) = 2.5 GB → 5 GB.  Тэр ганц алхам
       4-бит суурийг 5.8 GB-аас 8.3 GB болгож, Windows драйверийн «shared GPU
       memory» (sysmem fallback) руу хальж, 512 токенд ч 17 GB «allocated»,
       40 с/алхам гэсэн ХУУРАМЧ «багтлаа» гаргаж байв.  Энд bf16-г хэвээр үлдээж,
       зөвхөн хөлдөөх + gradient checkpointing + оролтын градиент асаана.
    """
    for p in model.parameters():
        p.requires_grad_(False)
    if gradient_checkpointing:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
        model.enable_input_require_grads()
    model.config.use_cache = False


def main() -> None:
    ap = argparse.ArgumentParser(description="MGL AI · QLoRA (Qwen3-8B)")
    ap.add_argument("--dataset", required=True, help="`behavior` (training/out) эсвэл datasets/<нэр>")
    ap.add_argument("--run-name", default="", help="ж: mgl-adapter-0.1-smoke")
    ap.add_argument("--base-model", default=TrainConfig.base_model)
    ap.add_argument("--allow-base-mismatch", action="store_true", help="ЗӨВХӨН туршилт — serving суурьтай зөрөх")
    ap.add_argument("--epochs", type=float, default=TrainConfig.epochs)
    ap.add_argument("--max-seq-len", type=int, default=TrainConfig.max_seq_len)
    ap.add_argument("--seq-buckets", default="", help="ж: 1536,1792,2048 — мөр бүр хамгийн бага багтах шат руу дүүргэгдэнэ (өгөгдмөл: max-seq-len ганцаараа)")
    ap.add_argument("--rank", type=int, default=TrainConfig.lora_r)
    ap.add_argument("--alpha", type=int, default=TrainConfig.lora_alpha)
    ap.add_argument("--lr", type=float, default=TrainConfig.learning_rate)
    ap.add_argument("--grad-accum", type=int, default=TrainConfig.grad_accum)
    ap.add_argument("--targets", choices=["all", "attn"], default="all")
    ap.add_argument("--reason", default="", help="тохиргооны сонголтын шалтгаан (тайланд)")
    ap.add_argument("--quantize-lm-head", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="зөвхөн шалгаад гарна")
    # ── §15/§29 — тасалдлаас сэргээх, урт сургалтын аюулгүй байдал ──
    ap.add_argument("--resume", action="store_true", help="run_dir доторх сүүлийн checkpoint-оос үргэлжлүүлнэ (optimizer/scheduler/RNG хамт)")
    ap.add_argument("--save-steps", type=int, default=0, help="N optimizer алхам тутамд checkpoint (0 = epoch бүрд).  Олон цагийн сургалтад 10–20 зөвлөнө")
    ap.add_argument("--allow-shared-gpu", action="store_true", help="ЗӨВХӨН туршилт — инференс ажиллаж байхад ч сургана (хэмжилт найдваргүй)")
    args = ap.parse_args()

    cfg = TrainConfig(
        base_model=args.base_model,
        dataset=args.dataset,
        run_name=args.run_name or f"{args.dataset}-r{args.rank}",
        epochs=args.epochs,
        max_seq_len=args.max_seq_len,
        seq_buckets=tuple(int(x) for x in args.seq_buckets.split(",") if x.strip()) or (args.max_seq_len,),
        lora_r=args.rank,
        lora_alpha=args.alpha,
        learning_rate=args.lr,
        grad_accum=args.grad_accum,
        target_modules=("q_proj", "k_proj", "v_proj", "o_proj") if args.targets == "attn" else TrainConfig.target_modules,
        reason=args.reason,
        quantize_lm_head=args.quantize_lm_head,
        resume=args.resume,
        save_steps=args.save_steps,
    )

    print("\nMGL AI · QLoRA сургалт\n")
    preflight(cfg, args.allow_base_mismatch)
    # ⚠️ §2 — үйлдвэрлэлийн инференс энэ GPU дээр ажиллаж байвал ЗОГСОНО (gpu_guard.py-ийн толгойг үз).
    from gpu_guard import assert_gpu_free_for_training, telemetry as gpu_telemetry, thermal_verdict, acquire_training_lock, release_training_lock  # noqa: PLC0415

    gpu_state = assert_gpu_free_for_training(allow_shared=args.allow_shared_gpu) if not args.dry_run else {"telemetry": gpu_telemetry(), "dry_run": True}
    rows = load_split(cfg.dataset, "train")
    val_rows = load_split(cfg.dataset, "val") if cfg.eval_on_val else []
    man = manifest_of(cfg.dataset)
    print(f"  Багц: {man.get('dataset_version', cfg.dataset)} · train {len(rows)} · val {len(val_rows)} · kernel {man.get('kernel_snapshot')}")

    if len(rows) < 50:
        sys.exit(f"Зөвхөн {len(rows)} жишээ байна.  50-аас цөөн жишээгээр QLoRA хийх нь загварыг МУУТГАХ магадлалтай.")

    # ⚠️ БОДЛОГЫН ХААЛГА — §35.  Алгасах туг БАЙХГҮЙ.
    from dataset_lint import lint_rows  # noqa: PLC0415

    problems = lint_rows(rows)
    if problems:
        print("\n  ✖ Багц бодлогын шалгалтад унав:\n")
        for p in problems[:20]:
            print(f"    · мөр {p['row']}: {p['rule']} — {p['detail']}")
        sys.exit("\n  Динамик компанийн баримтыг ЖИНД сургах нь маргааш ХУДАЛ хариу болно (§35).")
    print(f"  ✔ Бодлогын шалгалт: {len(rows)} мөр цэвэр\n")

    OUT.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    run_dir = OUT / cfg.run_name
    run_dir.mkdir(exist_ok=True)
    cfg_path = run_dir / "config.json"
    if cfg.resume and cfg_path.exists():
        # ⚠️ Өөр гиперпараметрээр «үргэлжлүүлэх» нь ХУДАЛ сургалт — optimizer төлөв нь хуучин LR/rank-д.
        prev = json.loads(cfg_path.read_text(encoding="utf-8"))
        frozen = ("base_model", "base_revision", "dataset", "lora_r", "lora_alpha", "lora_dropout", "target_modules", "max_seq_len", "seq_buckets", "learning_rate", "epochs", "grad_accum", "micro_batch", "optim", "seed")
        diff = {k: (prev.get(k), getattr(cfg, k)) for k in frozen if json.dumps(prev.get(k)) != json.dumps(getattr(cfg, k))}
        if diff:
            sys.exit(f"--resume: тохиргоо {cfg_path}-тэй зөрж байна: {json.dumps(diff, ensure_ascii=False)}\n  Ижил тохиргоогоор үргэлжлүүл, эсвэл ӨӨР --run-name-ээр шинээр эхлүүл.")
        ckpts = sorted(run_dir.glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[-1]))
        print(f"  --resume: {ckpts[-1].name if ckpts else 'checkpoint АЛГА — эхнээс'}")
    elif cfg.resume:
        print("  --resume өгсөн ч run_dir шинэ — эхнээс эхэлнэ.")
    cfg_path.write_text(json.dumps(asdict(cfg), indent=2, ensure_ascii=False), encoding="utf-8")

    if args.dry_run:
        print(f"  --dry-run: тохиргоо бичигдэв → {cfg_path}\n")
        return

    # ── Бодит сургалт ────────────────────────────────────────────────
    # ⚠️ ХЭМЖСЭН (2026-09-10): 1536 токенд probe 4.7 с/алхам байтал бодит сургалтад
    #    reserved 7514 → 7968 MB болж өсөөд (урт өөр өөр мөр → хуваарилагчийн
    #    хуваагдал) 25 алхмын дараа 30 → 117 с/алхам болж унасан.  `expandable_segments`
    #    нь PyTorch-ийн албан ёсны тохиргоо — хуваагдлыг багасгана.  Процесс эхлэхээс
    #    ӨМНӨ тавигдах ёстой тул `import torch`-оос өмнө.
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    import torch
    from peft import LoraConfig, get_peft_model
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        Trainer,
        TrainingArguments,
        TrainerCallback,
    )

    tok = AutoTokenizer.from_pretrained(cfg.base_model, revision=cfg.base_revision, trust_remote_code=False)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    # ⚠️ SERVING-ТЭЙ ЯГ ИЖИЛ ХЭЛБЭР: llama-server нь `enable_thinking=false`-ээр
    #    prompt-ыг `<|im_start|>assistant\n<think>\n\n</think>\n\n` хүртэл
    #    угсардаг, загвар түүний АРД бичдэг.  Сургалтын мөр ч яг тэр:
    #    prompt = template(..., add_generation_prompt=True, enable_thinking=False),
    #    зорилт = assistant текст + <|im_end|>.  Алдагдал ЗӨВХӨН зорилтод (completion-only).
    # ⚠️ УТГЫН ТАЙРАЛТ (v.4, §13–14).  Хуучин «prompt-ын дундаас тайрах» нь СИСТЕМ
    #    ЗААВРЫН дүрмийг (гүн, гэрээ, нормын тушаал) устгадаг байсан — аудитаар 1536-д
    #    124/419 мөрийн system хөндөгдөж байв.  Мөр бүрд ХАМГИЙН БАГА багтах шатыг
    #    (`--seq-buckets`, ж. 1536,1792,2048 — probe-ийн хэмжсэн урт) сонгож, тэр урт
    #    руу ТОГТМОЛ дүүргэнэ (fixed shape → хуваарилагч хуваагдахгүй; probe-ийн
    #    хэмжилт бодит сургалтад давтагдана).  Түүх/хайрцаг/асуулт/зорилт БҮТЭН.
    #    Хамгийн том шатанд ч багтахгүй мөр (ховор) л system-ийн дундаас тайрагдаж,
    #    `critical_truncated`-д ТООЛОГДОНО — тайланд ил.
    stats = {"truncated": 0, "critical_truncated": 0, "bucket": {b: 0 for b in cfg.seq_buckets}}
    max_bucket = max(cfg.seq_buckets)

    stats["history_dropped"] = 0

    def render(example: dict) -> dict:
        msgs = example["messages"]
        prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
        target = msgs[-1]["content"] + tok.eos_token + "\n"
        p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
        t_ids = tok(target, add_special_tokens=False)["input_ids"]
        ids = p_ids + t_ids
        # ⚠️ v.5 — хамгийн том шатанд ч багтахгүй бол ЭХЛЭЭД түүхийг (system ба сүүлийн user-ийн
        #    хоорондох ээлжүүд) хаяна: түүх нь зохиомол дүүргэгч, system заавар нь ЭРХ БҮХИЙ агуулга.
        #    Хэмжсэн (v.5, 2048): давсан 25 мөрийн 7 нь multi-intent 299 токен түүхтэй.
        if len(ids) > max_bucket and len(msgs) > 3:
            msgs = [msgs[0], msgs[-2], msgs[-1]]
            prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
            p_ids = tok(prompt, add_special_tokens=False)["input_ids"]
            ids = p_ids + t_ids
            stats["history_dropped"] += 1
        labels = ([-100] * len(p_ids) if cfg.completion_only else list(p_ids)) + t_ids
        bucket = next((b for b in cfg.seq_buckets if len(ids) <= b), None)
        if bucket is None:
            bucket = max_bucket
            stats["truncated"] += 1
            stats["critical_truncated"] += 1
            keep = bucket - len(t_ids)
            if keep < 64:
                ids = ids[:bucket]
                labels = labels[:bucket]
            else:
                head_n = keep // 2
                ids = p_ids[:head_n] + p_ids[len(p_ids) - (keep - head_n):] + t_ids
                labels = ([-100] * keep) + t_ids
        stats["bucket"][bucket] += 1
        # ⚠️ ДҮҮРГЭЛТГҮЙ (2026-09-10 хэмжсэн): шатны урт руу pad хийхэд attention_mask-д 0 орж
        #    SDPA хурдан зам алдагдан анхаарлын матриц бүтнээр материалчлагдаж, VRAM хязгаар давж
        #    драйвер хуудаслаад 8 мөр/алхам нь 6+ мин болсон (probe 4.7 с/мөр).  micro_batch = 1
        #    тул мөр бүр өөрийн уртаар явна; шат нь зөвхөн тайрагдлын шийдвэр/статистикт.
        return {"input_ids": ids, "labels": labels, "attention_mask": [1] * len(ids), "seq_len": len(ids), "bucket": bucket}

    class ListDS(torch.utils.data.Dataset):
        def __init__(self, rs):
            self.items = [render(r) for r in rs]

        def __len__(self):
            return len(self.items)

        def __getitem__(self, i):
            return self.items[i]

    ds = ListDS(rows)
    val_ds = ListDS(val_rows) if val_rows else None
    lens = [x["seq_len"] for x in ds.items]
    print(f"  Дараалал (токен): дундаж {sum(lens) // len(lens)} · max {max(lens)} · шат {stats['bucket']} · түүх хаясан {stats['history_dropped']} · system тайрагдсан {stats['critical_truncated']}/{len(lens)}")

    dynamics = {"log": [], "nan_steps": 0, "step_ms": [], "step_bucket": [], "last_seq": None, "last_bucket": None}

    def collate(batch):
        # Мөр бүр аль хэдийн шатныхаа урт руу дүүргэгдсэн (micro_batch = 1).
        m = max(len(b["input_ids"]) for b in batch)
        pad = tok.pad_token_id
        dynamics["last_seq"] = [b["seq_len"] for b in batch]
        dynamics["last_bucket"] = [b["bucket"] for b in batch]
        return {
            "input_ids": torch.tensor([b["input_ids"] + [pad] * (m - len(b["input_ids"])) for b in batch]),
            "labels": torch.tensor([b["labels"] + [-100] * (m - len(b["labels"])) for b in batch]),
            "attention_mask": torch.tensor([b["attention_mask"] + [0] * (m - len(b["attention_mask"])) for b in batch]),
        }

    bnb = BitsAndBytesConfig(
        load_in_4bit=cfg.load_in_4bit,
        bnb_4bit_quant_type=cfg.bnb_4bit_quant_type,
        bnb_4bit_compute_dtype=getattr(torch, cfg.bnb_4bit_compute_dtype),
        bnb_4bit_use_double_quant=cfg.bnb_4bit_use_double_quant,
        **({"llm_int8_skip_modules": []} if cfg.quantize_lm_head else {}),
    )
    torch.cuda.reset_peak_memory_stats()
    t_load = time.time()
    model = AutoModelForCausalLM.from_pretrained(
        cfg.base_model, revision=cfg.base_revision, quantization_config=bnb, device_map={"": 0}, dtype=torch.bfloat16,
    )
    load_mb = torch.cuda.max_memory_allocated() // (1 << 20)
    prepare_kbit_bf16(model, cfg.gradient_checkpointing)
    model = get_peft_model(
        model,
        LoraConfig(r=cfg.lora_r, lora_alpha=cfg.lora_alpha, lora_dropout=cfg.lora_dropout, target_modules=list(cfg.target_modules), bias="none", task_type="CAUSAL_LM"),
    )
    model.print_trainable_parameters()
    print(f"  Ачаалалт: {time.time() - t_load:.0f} с · VRAM {load_mb} MB")

    # ⚠️ §29 — АМЬД ТӨЛӨВ.  `state.json` нь алхам бүрд дахин бичигдэнэ: `train.ps1 -Status`
    #    ба хүн хоёулаа ТҮҮНИЙГ уншина (процессын stdout-ыг биш).  Атомаар (tmp → rename)
    #    бичнэ — уншигч хагас файл харахгүй.
    state_path = run_dir / "state.json"
    run_t0 = time.time()

    def write_state(**extra):
        d = {"run_name": cfg.run_name, "pid": os.getpid(), "updated_at": time.strftime("%Y-%m-%dT%H:%M:%S"), "elapsed_s": round(time.time() - run_t0), **extra}
        tmp = state_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, state_path)

    write_state(status="LOADING", gpu=gpu_state.get("telemetry"))
    # ⚠️ §2 — түгжээ: runtime энэ файлыг хараад llama-server-ийг ачаалахгүй (runtime/src/trainingLock.ts).
    import atexit  # noqa: PLC0415

    lock_path = acquire_training_lock(cfg.run_name)
    atexit.register(release_training_lock)
    print(f"  🔒 сургалтын түгжээ: {lock_path}")

    class Dyn(TrainerCallback):
        _t = None
        _thermal_warned = False

        def on_step_begin(self, args_, state, control, **kw):
            self._t = time.time()

        def on_step_end(self, args_, state, control, **kw):
            if self._t is not None:
                dynamics["step_ms"].append(round((time.time() - self._t) * 1000))
                dynamics["step_bucket"].append(dynamics.get("last_bucket"))
            # Хуваарилагчийн хуваагдлыг барих — 0.1 сургалтад reserved 7826 → 8392 MB болж 30 → 88 с/алхам болсон.
            torch.cuda.empty_cache()
            # ── §15 — дулааны хамгаалалт: анхааруулга → эмх цэгцтэй зогсолт (checkpoint хамт) ──
            g = gpu_telemetry()
            verdict, why = thermal_verdict(g)
            if verdict == "stop":
                print(f"\n  ⚠️  {why}\n")
                dynamics["thermal_stop"] = {"step": state.global_step, "gpu": g, "why": why}
                control.should_save = True
                control.should_training_stop = True
            elif verdict == "warn" and not self._thermal_warned:
                print(f"  ⚠️  {why}")
                self._thermal_warned = True
            # ── §29 — ЭМХ ЦЭГЦТЭЙ ЗОГСООЛТ: `train.ps1 -Stop` нь run_dir/STOP файл үүсгэнэ.  Windows-д
            #    цонхгүй процесс руу Ctrl+C илгээх найдвартай арга байхгүй тул sentinel файл.
            #    Checkpoint хадгалаад зогсоно → `--resume` яг тэр алхмаас.
            if (run_dir / "STOP").exists():
                print("\n  ⏸  STOP файл олдлоо — checkpoint хадгалаад зогсож байна.\n")
                dynamics["manual_stop"] = {"step": state.global_step}
                control.should_save = True
                control.should_training_stop = True
            # ETA — хэмжсэн алхмын дундаж × үлдсэн алхам (§29).
            done = state.global_step
            total = state.max_steps or 0
            recent = dynamics["step_ms"][-10:]
            avg_ms = (sum(recent) / len(recent)) if recent else None
            eta_s = round((total - done) * avg_ms / 1000) if (avg_ms and total) else None
            last_log = dynamics["log"][-1] if dynamics["log"] else {}
            ckpts = sorted(run_dir.glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[-1]))
            write_state(
                status="TRAINING",
                step=done, max_steps=total, epoch=round(state.epoch or 0, 3),
                loss=last_log.get("loss"), learning_rate=last_log.get("learning_rate"), grad_norm=last_log.get("grad_norm"),
                step_ms_recent=round(avg_ms) if avg_ms else None, eta_s=eta_s,
                vram_peak_mb=torch.cuda.max_memory_allocated() // (1 << 20),
                vram_reserved_mb=torch.cuda.max_memory_reserved() // (1 << 20),
                gpu=g, last_checkpoint=ckpts[-1].name if ckpts else None,
                nan_steps=dynamics["nan_steps"],
            )

        def on_save(self, args_, state, control, **kw):
            ckpts = sorted(run_dir.glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[-1]))
            print(f"    💾 checkpoint: {ckpts[-1].name if ckpts else '?'} (алхам {state.global_step})")

        def on_log(self, args_, state, control, logs=None, **kw):
            if not logs:
                return
            rec = {"step": state.global_step, **{k: v for k, v in logs.items() if isinstance(v, (int, float))}}
            rec["vram_peak_mb"] = torch.cuda.max_memory_allocated() // (1 << 20)
            rec["vram_reserved_mb"] = torch.cuda.max_memory_reserved() // (1 << 20)
            g = gpu_telemetry()
            if g:
                rec["gpu_temp_c"] = g.get("temp_c")
                rec["gpu_power_w"] = g.get("power_w")
                rec["gpu_util_pct"] = g.get("util_pct")
                if g.get("throttle"):
                    rec["gpu_throttle"] = ",".join(g["throttle"])
            if any(isinstance(v, float) and v != v for v in logs.values()):
                dynamics["nan_steps"] += 1
            dynamics["log"].append(rec)
            print("   ", json.dumps(rec, ensure_ascii=False))

    targs = TrainingArguments(
        output_dir=str(run_dir),
        per_device_train_batch_size=cfg.micro_batch,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=cfg.grad_accum,
        num_train_epochs=cfg.epochs,
        learning_rate=cfg.learning_rate,
        # transformers 5.x: `warmup_ratio` хасагдсан — алхмаар тооцно.
        warmup_steps=max(1, int(cfg.warmup_ratio * cfg.epochs * len(ds) / (cfg.micro_batch * cfg.grad_accum))),
        lr_scheduler_type="cosine",
        gradient_checkpointing=cfg.gradient_checkpointing,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        bf16=True,
        optim=cfg.optim,
        logging_steps=2,
        eval_strategy="epoch" if val_ds is not None else "no",
        # ⚠️ §15 — олон цагийн сургалтад epoch-ийн төгсгөл хүртэл хүлээх нь тасалдалд бүтэн epoch алдана.
        #    `--save-steps N` → N optimizer алхам тутамд (adapter + optimizer + scheduler + RNG).
        save_strategy="steps" if cfg.save_steps > 0 else "epoch",
        **({"save_steps": cfg.save_steps} if cfg.save_steps > 0 else {}),
        save_total_limit=3,
        report_to=[],  # ⚠️ Гуравдагч телеметр рүү ЮУ Ч илгээхгүй.
        seed=cfg.seed,
        max_grad_norm=1.0,
        dataloader_pin_memory=False,
        remove_unused_columns=False,
    )
    class SlicedTrainer(Trainer):
        # ⚠️ Бүтэн logits-гүй completion-only алдагдал (`sliced_completion_loss`-ын толгойг үз).
        def compute_loss(self, model, inputs, return_outputs=False, num_items_in_batch=None):
            loss = sliced_completion_loss(model, inputs["input_ids"], inputs["attention_mask"], inputs["labels"], num_items_in_batch)
            return (loss, None) if return_outputs else loss

        def prediction_step(self, model, inputs, prediction_loss_only, ignore_keys=None):
            with torch.no_grad():
                loss = sliced_completion_loss(model, inputs["input_ids"], inputs["attention_mask"], inputs["labels"])
            return (loss.detach(), None, None)

    trainer = SlicedTrainer(model=model, train_dataset=ds, eval_dataset=val_ds, args=targs, data_collator=collate, callbacks=[Dyn()])

    import psutil  # noqa: PLC0415

    proc = psutil.Process()
    t0 = time.time()
    resume_from = bool(cfg.resume and any(run_dir.glob("checkpoint-*")))
    rp = REPORTS / f"train-{cfg.run_name}.json"

    def partial_report(status: str, err: str | None = None):
        # ⚠️ Тасалдал/алдаанд ч ТАЙЛАН үлдэнэ — 0.1 smoke сессийн teardown-д тасраад тайлан ЛОГООС сэргээгдсэн.
        ckpts = sorted(run_dir.glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[-1]))
        d = {
            "run_name": cfg.run_name, "status": status, "error": err, "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "base_model": cfg.base_model, "base_revision": cfg.base_revision, "config": asdict(cfg), "reason": cfg.reason,
            "dataset": {"name": cfg.dataset, "version": man.get("dataset_version"), "train_rows": len(rows), "val_rows": len(val_rows), "sha256": man.get("sha256"), "kernel_snapshot": man.get("kernel_snapshot")},
            "resumed_from_checkpoint": resume_from, "last_checkpoint": ckpts[-1].name if ckpts else None,
            "dynamics": {"nan_steps": dynamics["nan_steps"], "step_ms_mean": (sum(dynamics["step_ms"]) // len(dynamics["step_ms"])) if dynamics["step_ms"] else None, "vram_peak_mb": torch.cuda.max_memory_allocated() // (1 << 20), "log": dynamics["log"], "thermal_stop": dynamics.get("thermal_stop")},
            "gpu_guard": gpu_state, "deployed": False,
        }
        rp.write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
        write_state(status=status, error=err, last_checkpoint=d["last_checkpoint"], step=trainer.state.global_step, max_steps=trainer.state.max_steps)

    try:
        result = trainer.train(resume_from_checkpoint=resume_from)
    except KeyboardInterrupt:
        partial_report("INTERRUPTED")
        print(f"\n  ⏸  Тасарлаа.  Үргэлжлүүлэх:  --run-name {cfg.run_name} --resume\n")
        raise SystemExit(130)
    except Exception as e:  # noqa: BLE001
        partial_report("FAILED", f"{type(e).__name__}: {e}")
        raise
    duration = time.time() - t0
    if dynamics.get("manual_stop"):
        (run_dir / "STOP").unlink(missing_ok=True)
        partial_report("STOPPED")
        print(f"\n  ⏸  Зогсоолоо — checkpoint хадгалагдсан.  Үргэлжлүүлэх:  --run-name {cfg.run_name} --resume\n")
        return
    if dynamics.get("thermal_stop"):
        partial_report("THERMAL_STOPPED")
        print(f"\n  🌡  Дулааны улмаас зогссон — checkpoint хадгалагдсан.  Хөргөсний дараа:  --run-name {cfg.run_name} --resume\n")
        return
    write_state(status="EVALUATING", step=trainer.state.global_step, max_steps=trainer.state.max_steps)
    eval_metrics = trainer.evaluate() if val_ds is not None else {}

    adapter_dir = run_dir / "adapter"
    model.save_pretrained(adapter_dir)
    tok.save_pretrained(adapter_dir)
    hashes = sha256_dir(adapter_dir)

    report = {
        "run_name": cfg.run_name,
        "kind": "smoke-candidate" if "smoke" in cfg.run_name else "candidate",
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "base_model": cfg.base_model,
        "base_revision": cfg.base_revision,
        "dataset": {"name": cfg.dataset, "version": man.get("dataset_version"), "train_rows": len(rows), "val_rows": len(val_rows), "sha256": man.get("sha256"), "kernel_snapshot": man.get("kernel_snapshot")},
        "config": asdict(cfg),
        "reason": cfg.reason,
        "seq_tokens": {"mean": sum(lens) // len(lens), "max": max(lens), "buckets": {str(k): v for k, v in stats["bucket"].items()}, "critical_truncated": stats["critical_truncated"], "history_dropped": stats["history_dropped"]},
        "train": {"loss_final": result.training_loss, "steps": result.global_step, "duration_s": round(duration), "metrics": result.metrics},
        "eval": eval_metrics,
        "dynamics": {
            "nan_steps": dynamics["nan_steps"],
            "step_ms_mean": (sum(dynamics["step_ms"]) // len(dynamics["step_ms"])) if dynamics["step_ms"] else None,
            "step_ms_by_bucket": {str(b): (sum(ms for ms, bb in zip(dynamics["step_ms"], dynamics["step_bucket"]) if bb and bb[0] == b) // max(1, sum(1 for bb in dynamics["step_bucket"] if bb and bb[0] == b))) for b in cfg.seq_buckets},
            "step_ms_max": max(dynamics["step_ms"]) if dynamics["step_ms"] else None,
            "vram_peak_mb": torch.cuda.max_memory_allocated() // (1 << 20),
            "vram_reserved_peak_mb": torch.cuda.max_memory_reserved() // (1 << 20),
            "ram_rss_mb": proc.memory_info().rss // (1 << 20),
            "load_vram_mb": load_mb,
            "log": dynamics["log"],
        },
        "adapter": {"path": str(adapter_dir), "files": hashes},
        "resumed_from_checkpoint": resume_from,
        "gpu_guard": gpu_state,
        "gpu_peak_temp_c": max((r.get("gpu_temp_c") or 0) for r in dynamics["log"]) if dynamics["log"] else None,
        "gpu_peak_power_w": max((r.get("gpu_power_w") or 0) for r in dynamics["log"]) if dynamics["log"] else None,
        "status": "CANDIDATE_TRAINED_NOT_EVALUATED",
        "deployed": False,
    }
    rp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    write_state(status="DONE", step=trainer.state.global_step, max_steps=trainer.state.max_steps, loss=result.training_loss, eval_loss=eval_metrics.get("eval_loss"), adapter=str(adapter_dir), report=str(rp))
    print(f"\n  ✔ Адаптер: {adapter_dir}")
    print(f"  ✔ Тайлан: {rp}")
    print("  Дараа нь:  python ai/training/export_adapter.py --run <нэр>  (GGUF LoRA → llama.cpp --lora)\n")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    main()
