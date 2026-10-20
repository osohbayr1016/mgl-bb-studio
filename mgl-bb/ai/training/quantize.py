#!/usr/bin/env python3
"""
MGL AI · АДАПТЕР → GGUF → QUANTIZE (§33, §36).

Гинж:
    LoRA адаптер
      → суурьтай НЭГТГЭХ (merge)         [fp16, ~8 GB диск]
      → GGUF болгон хөрвүүлэх            [llama.cpp/convert_hf_to_gguf.py]
      → quantize Q4_K_M / Q5_K_M         [llama-quantize]
      → SHA-256                          [релизийн манифестэд]
      → локал шалгалт                    [ai:benchmark]

⚠️ НЭГТГЭЛТ НЬ ДИСК ИДНЭ, VRAM БИШ.  Merge нь CPU дээр хийгдэнэ (fp16),
   тул 8 GB GPU нь саад БИШ.  Гэхдээ ~16 GB СУЛ ДИСК хэрэгтэй.

⚠️ ЭНЭ СКРИПТ ХОЁРТЫН ФАЙЛ ТАТАХГҮЙ.  `llama.cpp`-ийн repo болон
   `llama-quantize` нь `ai:setup`-аар суулгагдана.  Автомат татах нь
   CUDA хувилбарын нийцгүй байдлыг далдална.

⚠️ ГАРАЛТ НЬ АВТОМАТААР РЕЛИЗ БОЛОХГҮЙ.  §32: релиз нь ГАРААР.  Энэ
   скрипт нь артефакт + checksum гаргана; түүнийг `ai_model_releases`-д
   бүртгэх, `license_cleared`, `eval_passed` тугийг тавих нь АДМИНЫ
   ухамсартай үйлдэл.
"""

from __future__ import annotations

import sys as _sys

for _stream in (_sys.stdout, _sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "models" / "gguf"

# ⚠️ Эдгээрийг ХЭМЖИЖ байж өгөгдмөл болгоно (§6: «Do not automatically
#    assume biggest quantization is best»).  Q4_K_M нь 8 GB-д эхлэлийн
#    сонголт — Q5_K_M нь KV кэшийн зайг хумина.
QUANTS = ["Q4_K_M", "Q5_K_M", "Q6_K"]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str]) -> None:
    print(f"  $ {' '.join(cmd[:4])} …")
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        _sys.exit(f"  ✖ Амжилтгүй (код {proc.returncode}): {cmd[0]}")


def main() -> None:
    ap = argparse.ArgumentParser(description="MGL AI · GGUF + quantize")
    ap.add_argument("--adapter", required=True, help="LoRA адаптерын хавтас")
    ap.add_argument("--base-model", default="Qwen/Qwen3.5-4B-Instruct")
    ap.add_argument("--llama-cpp", required=True, help="llama.cpp repo-гийн зам")
    ap.add_argument("--quant", default="Q4_K_M", choices=QUANTS)
    ap.add_argument("--version", required=True, help="ж: 1.1.0")
    args = ap.parse_args()

    adapter = Path(args.adapter).resolve()
    if not adapter.exists():
        _sys.exit(f"Адаптер олдсонгүй: {adapter}")

    llama = Path(args.llama_cpp).resolve()
    convert = llama / "convert_hf_to_gguf.py"
    if not convert.exists():
        _sys.exit(
            f"convert_hf_to_gguf.py олдсонгүй: {convert}\n"
            "  llama.cpp-ийн repo-г clone хийж --llama-cpp-оор зааж өгнө үү."
        )

    OUT.mkdir(parents=True, exist_ok=True)
    merged = OUT / f"mgl-ai-{args.version}-merged"
    gguf_f16 = OUT / f"mgl-ai-{args.version}-f16.gguf"
    gguf_q = OUT / f"mgl-ai-{args.version}-{args.quant}.gguf"

    print(f"\nMGL AI · {args.version} · {args.quant}\n")

    # ── 1. НЭГТГЭХ ───────────────────────────────────────────────────
    if not merged.exists():
        print("  1/4 адаптерыг суурьтай нэгтгэж байна (CPU, fp16)…")
        from peft import PeftModel  # noqa: PLC0415
        from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: PLC0415
        import torch  # noqa: PLC0415

        base = AutoModelForCausalLM.from_pretrained(
            args.base_model, torch_dtype=torch.float16, device_map="cpu"
        )
        model = PeftModel.from_pretrained(base, str(adapter))
        model = model.merge_and_unload()
        model.save_pretrained(merged, safe_serialization=True)
        AutoTokenizer.from_pretrained(args.base_model).save_pretrained(merged)
        print(f"      → {merged}")
    else:
        print(f"  1/4 нэгтгэсэн загвар аль хэдийн байна: {merged}")

    # ── 2. GGUF ──────────────────────────────────────────────────────
    if not gguf_f16.exists():
        print("  2/4 GGUF болгон хөрвүүлж байна…")
        run([_sys.executable, str(convert), str(merged), "--outfile", str(gguf_f16), "--outtype", "f16"])
    else:
        print("  2/4 f16 GGUF аль хэдийн байна")

    # ── 3. QUANTIZE ──────────────────────────────────────────────────
    quantize_bin = llama / "build" / "bin" / "llama-quantize"
    if not quantize_bin.exists():
        quantize_bin = llama / "llama-quantize.exe"
    if not quantize_bin.exists():
        _sys.exit(f"llama-quantize олдсонгүй ({quantize_bin}).  llama.cpp-г build хийнэ үү.")

    print(f"  3/4 {args.quant} болгон quantize хийж байна…")
    run([str(quantize_bin), str(gguf_f16), str(gguf_q), args.quant])

    # ── 4. CHECKSUM + МАНИФЕСТ ───────────────────────────────────────
    print("  4/4 SHA-256 бодож байна…")
    digest = sha256(gguf_q)
    size = gguf_q.stat().st_size

    meta = {
        "product": "MGL AI",
        "model_family": "mgl-ai",
        "version": args.version,
        "runtime_variant": "employee-4b-q4" if args.quant == "Q4_K_M" else "employee-4b-q5",
        "base_model": args.base_model,
        "adapter": adapter.name,
        "quantization": args.quant,
        "runtime": "llama.cpp",
        "artifact_bytes": size,
        "artifact_sha256": digest,
        # ⚠️ ЭНЭ ХОЁР ТУГ ЭНД ХЭЗЭЭ Ч `true` БОЛОХГҮЙ.  Лиценз шалгах,
        #    golden eval давуулах нь ХҮНИЙ шийдвэр (§32, миграц 0270).
        "license_cleared": False,
        "eval_passed": False,
    }
    meta_path = gguf_q.with_suffix(".json")
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n  ✔ {gguf_q.name}  ({size / 1024**3:.2f} GB)")
    print(f"    sha256 {digest}")
    print(f"    → {meta_path}\n")
    print("  ДАРААГИЙН АЛХАМ (гараар, §32):")
    print("    1. Артефактыг R2 руу байршуул")
    print("    2. `ai/evaluation` golden багцаар шалга")
    print("    3. Лицензийг шалгаж `LICENSES.md`-д бич")
    print("    4. `ai_model_releases`-д мөр нэмж license_cleared=1, eval_passed=1")
    print("    5. Идэвхжүүл — ажилтнууд `ai:model -- pull` хийнэ\n")


if __name__ == "__main__":
    main()
