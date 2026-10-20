#!/usr/bin/env python3
"""
MGL AI · QWEN3-8B QLoRA САНАХ ОЙН ХЭМЖИЛТ (§22–§24) — ТААМАГ БИШ, ХЭМЖИЛТ.

⚠️ ЭНЭ СКРИПТ СУРГАДАГГҮЙ.  Бодит 4-бит (NF4, давхар квантчлал) Qwen3-8B +
   LoRA дээр 512 → 768 → 1024 токены дарааллаар ШАТЛАН forward + backward +
   optimizer алхам хийж, шат бүрд оргил VRAM (allocated/reserved), системийн
   RAM, алхмын хугацааг хэмжинэ.  OOM гарвал ТЭР шатыг унасан гэж бичээд
   баримтжуулсан бууралт (зорилтот модуль → зөвхөн анхаарал) руу шилжинэ.
   Дүгнэлт ГУРВЫН НЭГ:

       FITS_STABLY                       — ≥1024 токен бүх зорилтот модультай, spill-гүй, degraded-гүй (reserved < 92%, алхмын хугацаа шугаман)
       FITS_WITH_OFFLOAD_OR_REDUCED_SEQ  — зөвхөн богино урт эсвэл хумисан модультай багтана
       DOES_NOT_FIT_CURRENT_STACK        — 512-д ч багтахгүй

   `readiness.mjs`-ийн H4 болон `train_lora.py`-ийн preflight ЭНЭ ФАЙЛЫН
   гаралтыг л уншина.  «8B нь 8 GB-д багтахгүй» гэсэн өмнөх мэдэгдэл
   ХЭМЖИЛГҮЙ байсан тул хасагдав.

⚠️ АЖИЛЛУУЛАХААС ӨМНӨ llama-server-ийг ЗОГСОО (`npm run ai:stop`) — тэр 5.7 GB
   VRAM эзэлдэг; хэмжилт нь ХООСОН GPU-г төлөөлөх ёстой.  Скрипт эхлэхдээ
   чөлөөт VRAM-ыг бичнэ; 7 GB-аас бага бол анхааруулна.

⚠️ WINDOWS-ИЙН SYSMEM FALLBACK — ХУУРАМЧ «БАГТЛАА».  NVIDIA драйвер CUDA-ийн
   хуваарилалтыг системийн RAM руу («Shared GPU memory») чимээгүй хальдаг тул
   torch OOM ӨГӨХГҮЙ, харин «allocated» нь физик VRAM-аас ИХ, алхам 10 дахин удаан
   болно.  Хэмжсэн (2026-09-10): PEFT-ийн fp32 upcast-тай хувилбар 512 токенд
   17 GB «allocated», 40 с/алхам гэж «OK» гарч байв.  Одоо `peak_allocated > VRAM`
   бол тэр шат `sysmem_spill: true`, `ok: false` — багтаагүйд тооцно.

⚠️ PROBE ≠ БОДИТ СУРГАЛТ (хэмжсэн 2026-09-10).  Probe нь НЭГ уртаар 3 алхам хийдэг
   тул reserved 7514 MB (1536) гэж хэлсэн ч бодит сургалтад урт нь мөр бүрд өөр
   (358–1536) байдгаас хуваарилагч хуваагдаж reserved 7830 → 7970 → 8390 MB болж
   өссөн; 20 алхмын дараа 30 → 90 с/алхам (драйвер хуудаслалт).  `expandable_segments`
   тусалсангүй.  Тиймээс сургалтын урт нь probe-ийн зөвлөх уртаас НЭГ шат доогуур
   (1280–1408) байх нь хурдны хувьд аюулгүй; 1536 нь БАГТАНА, гэхдээ удаан.

⚠️ 4B РУУ ЧИМЭЭГҮЙ ШИЛЖИХГҮЙ.  Суурь нь registry-ийн serving суурь; `--base-model`
   өгсөн ч тайланд тэмдэглэгдэнэ.

Ажиллуулах:
    npm run ai:train:probe                       # 512 → 768 → 1024, бүх модуль, дараа нь attn
    npm run ai:train:probe -- --seqs 512,768     # шатыг өөрөө заах
    npm run ai:train:probe -- --tokens-only      # зөвхөн багцын токены урт (tokenizer)
"""

from __future__ import annotations

import sys as _sys

for _stream in (_sys.stdout, _sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import argparse
import gc
import json
import platform
import statistics
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "training" / "reports"
BEHAVIOR_OUT = ROOT / "training" / "out"
REGISTRY = ROOT / "registry" / "models.json"
SERVING_VARIANT = "employee-8b-q4"
ALL_TARGETS = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]
ATTN_TARGETS = ["q_proj", "k_proj", "v_proj", "o_proj"]


def serving_base() -> tuple[str, str | None]:
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for c in reg["candidates"]:
        if c["runtime_variant"] == SERVING_VARIANT:
            return c["base_model"], c.get("base_model_revision")
    raise SystemExit(f"registry-д {SERVING_VARIANT} алга")


def nvidia_smi() -> str | None:
    try:
        return subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,memory.used,driver_version", "--format=csv,noheader"], capture_output=True, text=True, timeout=10).stdout.strip()
    except Exception:
        return None


def token_lengths(tok, path: Path) -> dict:
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    lens = []
    for r in rows:
        msgs = r["messages"]
        prompt = tok.apply_chat_template(msgs[:-1], tokenize=False, add_generation_prompt=True, enable_thinking=False)
        n = len(tok(prompt, add_special_tokens=False)["input_ids"]) + len(tok(msgs[-1]["content"] + tok.eos_token, add_special_tokens=False)["input_ids"])
        lens.append(n)
    lens.sort()
    q = lambda p: lens[min(len(lens) - 1, int(p * len(lens)))]  # noqa: E731
    return {"n": len(lens), "mean": int(statistics.mean(lens)), "median": q(0.5), "p90": q(0.9), "p95": q(0.95), "max": lens[-1], **{f"over_{t}": sum(1 for x in lens if x > t) for t in (512, 768, 1024, 1536, 1792, 2048, 2304, 2560, 3072)}}


def sliced_completion_loss(model, input_ids, attention_mask, labels):
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
    return F.cross_entropy(logits.reshape(-1, logits.shape[-1]), tgt.reshape(-1), ignore_index=-100)


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
    ap = argparse.ArgumentParser()
    ap.add_argument("--seqs", default="512,768,1024,1536,2048")
    ap.add_argument("--steps", type=int, default=3, help="шат бүрд хэдэн optimizer алхам")
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--base-model", default=None)
    ap.add_argument("--tokens-only", action="store_true")
    ap.add_argument("--no-attn-fallback", action="store_true")
    ap.add_argument("--quantize-lm-head", action="store_true", help="lm_head-ийг ч NF4 болгоно (~0.9 GB хэмнэнэ; serving GGUF ч output.weight-ийг квантчилдаг)")
    args = ap.parse_args()

    base, rev = serving_base()
    if args.base_model and args.base_model != base:
        print(f"  ⚠️ --base-model {args.base_model} нь serving суурь {base}-тай ЗӨРНӨ — тайланд тэмдэглэгдэнэ")
        base, rev = args.base_model, None

    import torch
    import psutil
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import LoraConfig, get_peft_model
    import transformers, peft, bitsandbytes  # noqa: E401

    REPORTS.mkdir(parents=True, exist_ok=True)
    tok = AutoTokenizer.from_pretrained(base, revision=rev)
    train_path = BEHAVIOR_OUT / "behavior-sft-train.jsonl"
    tl = None
    if train_path.exists():
        man = json.loads((BEHAVIOR_OUT / "manifest.json").read_text(encoding="utf-8")) if (BEHAVIOR_OUT / "manifest.json").exists() else {}
        tl = token_lengths(tok, train_path)
        tl["dataset_version"] = man.get("dataset_version")
        tl["tokenizer"] = f"{base}@{(rev or '?')[:8]}"
        (REPORTS / "token-lengths.json").write_text(json.dumps(tl, indent=2), encoding="utf-8")
        print(f"  Багцын токены урт: {json.dumps(tl)}")
    if args.tokens_only:
        return

    if not torch.cuda.is_available():
        raise SystemExit("CUDA алга")
    free0, total = torch.cuda.mem_get_info()
    print(f"  GPU: {torch.cuda.get_device_name(0)} · нийт {total >> 20} MB · чөлөөтэй {free0 >> 20} MB · {nvidia_smi()}")
    if free0 < 7 * (1 << 30):
        print("  ⚠️ Чөлөөт VRAM 7 GB-аас бага — llama-server ажиллаж байна уу?  `npm run ai:stop`")

    env = {
        "os": f"{platform.system()} {platform.release()} ({platform.version()})",
        "python": platform.python_version(),
        "torch": torch.__version__, "cuda": torch.version.cuda, "cudnn": torch.backends.cudnn.version(),
        "transformers": transformers.__version__, "peft": peft.__version__, "bitsandbytes": bitsandbytes.__version__,
        "gpu": torch.cuda.get_device_name(0), "vram_total_mb": total >> 20, "vram_free_at_start_mb": free0 >> 20,
        "ram_total_mb": psutil.virtual_memory().total >> 20, "nvidia_smi": nvidia_smi(),
    }
    proc = psutil.Process()

    # ⚠️ lm_head (620M, bf16 1.24 GB) нь bnb-ийн өгөгдмөлөөр квантчлагддаггүй.  Serving GGUF нь
    #    output.weight-ийг Q6_K болгодог тул сургалтад NF4 болгох нь serving-ээс хол зөрөхгүй, харин
    #    ~0.9 GB VRAM хэмнэж драйверийн хуудаслалтын хязгаараас холдоно (2026-09-10: ширээний
    #    програмууд 0.5–1 GB VRAM эзэлж 1536-д ч 15 мин/алхам болсон).
    bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True, **({"llm_int8_skip_modules": []} if args.quantize_lm_head else {}))
    torch.cuda.reset_peak_memory_stats()
    t0 = time.time()
    model = AutoModelForCausalLM.from_pretrained(base, revision=rev, quantization_config=bnb, device_map={"": 0}, dtype=torch.bfloat16)
    load_s = time.time() - t0
    load_alloc = torch.cuda.memory_allocated() >> 20
    load_peak = torch.cuda.max_memory_allocated() >> 20
    print(f"  Ачаалалт: {load_s:.0f} с · allocated {load_alloc} MB · оргил {load_peak} MB · RAM RSS {proc.memory_info().rss >> 20} MB", flush=True)
    prepare_kbit_bf16(model)
    print(f"  Бэлтгэлийн дараа (bf16 хэвээр, fp32 upcast-гүй): allocated {torch.cuda.memory_allocated() >> 20} MB", flush=True)

    # Бодит мөрөөс дараалал — синтетик тоо биш; хамгийн урт мөрийг авч тайрна/дүүргэнэ.
    sample_ids = None
    if train_path.exists():
        rows = [json.loads(l) for l in train_path.read_text(encoding="utf-8").splitlines() if l.strip()]
        best = max(rows, key=lambda r: sum(len(m["content"]) for m in r["messages"]))
        text = tok.apply_chat_template(best["messages"], tokenize=False, enable_thinking=False)
        sample_ids = tok(text, add_special_tokens=False)["input_ids"]

    stages = []
    verdict = "DOES_NOT_FIT_CURRENT_STACK"
    seqs = [int(x) for x in args.seqs.split(",")]
    plans = [("all", ALL_TARGETS)] + ([] if args.no_attn_fallback else [("attn", ATTN_TARGETS)])
    peft_model = None
    for plan_name, targets in plans:
        lcfg = LoraConfig(r=args.rank, lora_alpha=2 * args.rank, lora_dropout=0.05, target_modules=targets, bias="none", task_type="CAUSAL_LM")
        if peft_model is None:
            peft_model = get_peft_model(model, lcfg, adapter_name=plan_name)
        else:
            # ⚠️ `get_peft_model`-ыг дахин дуудвал ӨМНӨХ LoRA давхарга ҮЛДЭНЭ (суурь модель
            #    газар дээрээ өөрчлөгдсөн) — «attn» гэж нэрлээд all-ын жинг хэмждэг байв.
            #    Өмнөх адаптерыг устгаж, шинийг нэмнэ.
            prev = [n for n in peft_model.peft_config.keys()]
            peft_model.add_adapter(plan_name, lcfg)
            peft_model.set_adapter(plan_name)
            for n in prev:
                peft_model.delete_adapter(n)
            gc.collect()
            torch.cuda.empty_cache()
        # ⚠️ TRAIN ГОРИМ ЗААВАЛ — eval горимд gradient checkpointing АЖИЛЛАДАГГҮЙ тул 36 давхаргын
        #    activation бүгд хадгалагдаж 512 токенд 12.6 GB «allocated» гарч байв (Trainer нь
        #    train()-ийг өөрөө дууддаг; энэ probe дуудаагүй байсан).
        peft_model.train()
        trainable = sum(p.numel() for p in peft_model.parameters() if p.requires_grad)
        print(f"\n  ── зорилтот модуль: {plan_name} ({trainable/1e6:.1f}M сургагдах параметр)")
        from bitsandbytes.optim import PagedAdamW8bit

        opt = PagedAdamW8bit([p for p in peft_model.parameters() if p.requires_grad], lr=2e-4)
        failed_here = False
        for seq in seqs:
            if failed_here:
                stages.append({"plan": plan_name, "max_seq": seq, "ok": False, "skipped": "өмнөх богино урт унасан"})
                continue
            ids = (sample_ids or list(range(100, 100 + seq)))
            ids = (ids * ((seq // max(1, len(ids))) + 1))[:seq]
            x = torch.tensor([ids], device="cuda")
            # Бодит мөртэй ижил: зорилт нь сүүлийн ~15% (assistant), prompt -100.
            labels = x.clone()
            n_tgt = max(32, int(seq * 0.15))
            labels[:, : seq - n_tgt] = -100
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()
            gc.collect()
            torch.cuda.empty_cache()
            rec = {"plan": plan_name, "max_seq": seq, "micro_batch": 1, "steps": args.steps}
            try:
                times = []
                fwd_peak = None
                bwd_peak = None
                for i in range(args.steps):
                    t = time.time()
                    loss = sliced_completion_loss(peft_model, x, torch.ones_like(x), labels)
                    torch.cuda.synchronize()
                    if fwd_peak is None:
                        fwd_peak = torch.cuda.max_memory_allocated() >> 20
                    loss.backward()
                    torch.cuda.synchronize()
                    if bwd_peak is None:
                        bwd_peak = torch.cuda.max_memory_allocated() >> 20
                    opt.step()
                    opt.zero_grad(set_to_none=True)
                    torch.cuda.synchronize()
                    times.append(round((time.time() - t) * 1000))
                    if not torch.isfinite(loss):
                        rec["nan"] = True
                # ⚠️ Windows драйверийн sysmem fallback: «allocated» нь VRAM-аас ИХ бол
                #    GPU-д багтаагүй, системийн RAM руу хальсан — ХУУРАМЧ амжилт.
                spilled = (torch.cuda.max_memory_allocated() >> 20) > (total >> 20)
                rec.update({
                    "ok": not spilled,
                    "sysmem_spill": spilled,
                    "loss": float(loss),
                    "forward_peak_mb": fwd_peak, "backward_peak_mb": bwd_peak,
                    "peak_allocated_mb": torch.cuda.max_memory_allocated() >> 20,
                    "peak_reserved_mb": torch.cuda.max_memory_reserved() >> 20,
                    "step_ms": int(statistics.median(times)), "step_ms_all": times,
                    "ram_rss_mb": proc.memory_info().rss >> 20,
                })
                print(f"    seq {seq}: {'OK' if rec['ok'] else 'SYSMEM SPILL (багтаагүй)'} · fwd {fwd_peak} MB · bwd {bwd_peak} MB · оргил {rec['peak_allocated_mb']} MB (reserved {rec['peak_reserved_mb']}) · алхам {rec['step_ms']} мс · RAM {rec['ram_rss_mb']} MB", flush=True)
                if spilled:
                    failed_here = True
            except torch.cuda.OutOfMemoryError as e:  # noqa: F841
                rec.update({"ok": False, "error": "CUDA OOM", "peak_reserved_mb": torch.cuda.max_memory_reserved() >> 20})
                print(f"    seq {seq}: OOM (reserved {rec['peak_reserved_mb']} MB)", flush=True)
                failed_here = True
                opt.zero_grad(set_to_none=True)
                gc.collect()
                torch.cuda.empty_cache()
            finally:
                del x, labels
                gc.collect()
                torch.cuda.empty_cache()
            stages.append(rec)
        del opt
        ok_all = [s for s in stages if s["plan"] == "all" and s.get("ok")]
        if plan_name == "all" and any(s["max_seq"] == max(seqs) for s in ok_all):
            break  # бүх модуль, хамгийн урт нь багтав — attn руу буух хэрэггүй

    total_mb = total >> 20
    # ⚠️ «Багтсан» ≠ «тогтвортой».  ХЭМЖСЭН (2026-09-10): 1024→2.3 с, 1536→4.7 с, 1792→11.8 с,
    #    2048→28 с/алхам — reserved физик VRAM-ын ~92%-иас дээш гармагц драйвер хуудаслаж
    #    алхмын хугацаа ШУГАМАН БИШ өснө.  Тиймээс шат нь reserved ≥ 92% ЭСВЭЛ алхмын
    #    хугацаа өмнөх шатнаас (уртаар нормчилсон) 2 дахинаас илүү өссөн бол `degraded`.
    for plan_name in {s["plan"] for s in stages}:
        prev = None
        for st in [s for s in stages if s["plan"] == plan_name and s.get("ok")]:
            ratio = (st["step_ms"] / prev["step_ms"]) / (st["max_seq"] / prev["max_seq"]) if prev else 1.0
            st["degraded"] = st["peak_reserved_mb"] >= 0.92 * total_mb or ratio > 2.0
            st["step_ratio_vs_prev"] = round(ratio, 2)
            prev = st
    ok = [s for s in stages if s.get("ok")]
    stable_all = [s for s in ok if s["plan"] == "all" and not s.get("degraded")]
    stable_any = [s for s in ok if not s.get("degraded")]
    if stable_all and max(s["max_seq"] for s in stable_all) >= 1024:
        verdict = "FITS_STABLY"
    elif ok:
        verdict = "FITS_WITH_OFFLOAD_OR_REDUCED_SEQ"
    report = {
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "base_model": base, "base_revision": rev, "rank": args.rank,
        "quant": {"load_in_4bit": True, "type": "nf4", "double_quant": True, "compute": "bfloat16", "lm_head_quantized": bool(args.quantize_lm_head)},
        "optimizer": "paged_adamw_8bit", "gradient_checkpointing": True,
        "env": env,
        "load": {"seconds": round(load_s), "allocated_mb": load_alloc, "peak_mb": load_peak},
        "token_lengths": tl,
        "stages": stages,
        "verdict": verdict,
        "recommended_max_seq": max((s["max_seq"] for s in stable_all), default=max((s["max_seq"] for s in stable_any), default=None)),
        "recommended_targets": "all" if stable_all else ("attn" if stable_any else None),
        "fits_but_degraded": [{"plan": s["plan"], "max_seq": s["max_seq"], "step_ms": s["step_ms"], "peak_reserved_mb": s["peak_reserved_mb"]} for s in ok if s.get("degraded")],
    }
    out = REPORTS / f"memory-probe-{time.strftime('%Y-%m-%dT%H-%M-%S')}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n  ДҮГНЭЛТ: {verdict} · зөвлөх урт {report['recommended_max_seq']} · модуль {report['recommended_targets']}")
    print(f"  → {out}")


if __name__ == "__main__":
    main()
