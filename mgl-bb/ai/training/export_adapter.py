#!/usr/bin/env python3
"""
MGL AI · PEFT АДАПТЕР → GGUF LoRA (llama.cpp `--lora`) — §29–30.

Serving нь llama-server + Q4_K_M GGUF тул адаптер нь НЭГТГЭГДЭХГҮЙ (merge
хийвэл 16 GB fp16 → дахин quantize → 5 GB шинэ суурь болно; тэр нь «суурь,
адаптер, нэр дэвшигч, өмнөх — ТУСДАА» гэсэн шаардлагыг зөрчинө).  Оронд нь
llama.cpp-ийн `convert_lora_to_gguf.py` нь PEFT адаптерыг GGUF LoRA болгож,
runtime нь `--lora <файл>` гэж ачаална (`ModelManager`-ийн `adapters/` эсвэл
үнэлгээнд `MGLAI_LORA_PATH`).

⚠️ ХӨРВҮҮЛЭГЧ НЬ SERVING BUILD-ТЭЙ ИЖИЛ llama.cpp-ээс (b10850, `training/.llama.cpp`,
   shallow clone) — өөр хувилбарын хөрвүүлэгч өөр tensor нэр гаргаж болно.
   Гаралтын толгойд `general.type = adapter`, `adapter.type = lora`,
   `adapter.lora.alpha` байх ёстой; энэ скрипт тэдгээрийг УНШИЖ баталгаажуулна.

⚠️ АРХИТЕКТУР/ХУВИЛБАРЫН ТААРЦ (§30): адаптерын `adapter_config.json`-ийн
   `base_model_name_or_path` ба сургалтын тайлангийн `base_revision` нь registry-ийн
   serving суурьтай ЯГ ижил байх ёстой; зөрвөл экспорт ЗОГСОНО.

Ажиллуулах:
    ai/training/.venv/Scripts/python.exe -X utf8 ai/training/export_adapter.py --run mgl-adapter-0.1-smoke
"""

from __future__ import annotations

import sys as _sys

for _stream in (_sys.stdout, _sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import argparse
import hashlib
import json
import struct
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ADAPTERS = ROOT / "models" / "adapters"
REPORTS = ROOT / "training" / "reports"
LLAMA = ROOT / "training" / ".llama.cpp"
REGISTRY = ROOT / "registry" / "models.json"
SERVING_VARIANT = "employee-8b-q4"


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def gguf_kv(path: Path, wanted: set[str]) -> dict:
    """GGUF толгойн KV-г уншина (зөвхөн `wanted` түлхүүрүүд)."""
    T = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}
    out = {}
    with path.open("rb") as f:
        def rd(fmt):
            return struct.unpack("<" + fmt, f.read(struct.calcsize(fmt)))

        def rstr():
            (n,) = rd("Q")
            return f.read(n).decode("utf-8", "replace")

        def rval(t):
            if t == 8:
                return rstr()
            if t == 9:
                (et,) = rd("I")
                (n,) = rd("Q")
                return [rval(et) for _ in range(n)]
            return rd(T[t])[0]

        magic = f.read(4)
        if magic != b"GGUF":
            raise SystemExit(f"GGUF биш: {path}")
        (ver,) = rd("I")
        (nt,) = rd("Q")
        (nkv,) = rd("Q")
        out["_version"] = ver
        out["_tensors"] = nt
        for _ in range(nkv):
            k = rstr()
            (t,) = rd("I")
            v = rval(t)
            if k in wanted:
                out[k] = v
    return out


def serving_base() -> dict:
    reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
    for c in reg["candidates"]:
        if c["runtime_variant"] == SERVING_VARIANT:
            return c
    raise SystemExit(f"registry-д {SERVING_VARIANT} алга")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True, help="models/adapters/<run>")
    ap.add_argument("--outtype", default="f16", choices=["f16", "f32"])
    args = ap.parse_args()

    run_dir = ADAPTERS / args.run
    adapter_dir = run_dir / "adapter"
    cfg_path = adapter_dir / "adapter_config.json"
    if not cfg_path.exists():
        raise SystemExit(f"адаптер алга: {cfg_path}")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    train_report_path = REPORTS / f"train-{args.run}.json"
    train_report = json.loads(train_report_path.read_text(encoding="utf-8")) if train_report_path.exists() else {}

    serving = serving_base()
    base_name = cfg.get("base_model_name_or_path")
    if base_name != serving["base_model"]:
        raise SystemExit(f"Адаптерын суурь ({base_name}) ≠ serving суурь ({serving['base_model']}) — ЭКСПОРТ ХИЙХГҮЙ (§30).")
    rev = train_report.get("base_revision")
    if rev and serving.get("base_model_revision") and rev != serving["base_model_revision"]:
        raise SystemExit(f"Адаптерын суурийн хувилбар ({rev}) ≠ serving ({serving['base_model_revision']}) — ЭКСПОРТ ХИЙХГҮЙ.")

    conv = LLAMA / "convert_lora_to_gguf.py"
    if not conv.exists():
        raise SystemExit(f"{conv} алга — `git clone --depth 1 --branch b10850 https://github.com/ggml-org/llama.cpp ai/training/.llama.cpp`")
    llama_commit = subprocess.run(["git", "-C", str(LLAMA), "log", "-1", "--format=%h %d"], capture_output=True, text=True).stdout.strip()

    # Суурийн HF snapshot (tokenizer/config-д) — HF кэшээс.
    from huggingface_hub import snapshot_download  # noqa: PLC0415

    base_dir = snapshot_download(serving["base_model"], revision=serving.get("base_model_revision"), allow_patterns=["*.json", "*.txt", "merges.txt", "vocab.json"], local_files_only=True)

    out = run_dir / f"{args.run}.lora.gguf"
    cmd = [sys.executable, "-X", "utf8", str(conv), "--base", base_dir, "--outfile", str(out), "--outtype", args.outtype, str(adapter_dir)]
    print("  ", " ".join(cmd))
    t0 = time.time()
    r = subprocess.run(cmd, cwd=str(LLAMA), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print(r.stderr[-3000:])
        raise SystemExit("convert_lora_to_gguf.py унав")
    dur = time.time() - t0

    kv = gguf_kv(out, {"general.type", "general.architecture", "adapter.type", "adapter.lora.alpha", "general.base_model.0.name", "general.base_model.0.repo_url"})
    if kv.get("general.type") != "adapter" or kv.get("adapter.type") != "lora":
        raise SystemExit(f"Гаралтын GGUF нь LoRA адаптер биш: {kv}")
    if kv.get("general.architecture") != "qwen3":
        raise SystemExit(f"Архитектур зөрөв: {kv.get('general.architecture')} ≠ qwen3")
    digest = sha256(out)
    report = {
        "run_name": args.run,
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "converter": {"llama_cpp": llama_commit, "script": "convert_lora_to_gguf.py", "outtype": args.outtype, "seconds": round(dur)},
        "base": {"model": serving["base_model"], "revision": serving.get("base_model_revision"), "serving_gguf_sha256": serving.get("artifact_sha256")},
        "adapter_source": {"dir": str(adapter_dir), "r": cfg.get("r"), "alpha": cfg.get("lora_alpha"), "targets": cfg.get("target_modules"), "files": {k: v for k, v in (train_report.get("adapter", {}).get("files", {}) or {}).items()}},
        "gguf": {"path": str(out), "bytes": out.stat().st_size, "sha256": digest, "header": {k: v for k, v in kv.items()}},
        "status": "EXPORTED_NOT_EVALUATED",
        "deployed": False,
    }
    rp = REPORTS / f"export-{args.run}.json"
    rp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"  ✔ GGUF LoRA: {out} · {out.stat().st_size >> 20} MB · sha256 {digest[:16]}… · толгой {kv}")
    print(f"  ✔ Тайлан: {rp}")


if __name__ == "__main__":
    main()
