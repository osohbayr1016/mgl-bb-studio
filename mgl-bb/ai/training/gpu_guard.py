#!/usr/bin/env python3
"""
MGL AI · GPU ТЕЛЕМЕТР + ҮЙЛДВЭРЛЭЛИЙН МӨРГӨЛДӨӨНИЙ ХАМГААЛАЛТ (§2, §15).

⚠️ ЭНЭ МАШИН НЬ СУРГАЛТЫН БОЛОН ИНФЕРЕНСИЙН ХОСТ ХОЁУЛАА.  Ажилтны
   `llama-server` нь ЯГ ТЭР RTX 3070-ийн 5.7 GB-ыг эзэлдэг; QLoRA-гийн
   хэмжсэн оргил нь 7.6 GB.  Хоёулаа зэрэг ажиллах нь 8 GB-д БАГТАХГҮЙ.
   Windows нь OOM өгөхийн оронд «shared GPU memory» (sysmem fallback) руу
   халина — сургалт 10 дахин удааширч, инференс нь хэрэглэгчийн нүдэн дээр
   зогсонги болно.  ХОЁУЛАА эвдэрнэ, аль нь ч унахгүй.

   ТИЙМЭЭС: сургалт эхлэхээс ӨМНӨ инференсийн процессыг ИЛРҮҮЛНЭ.  Энэ файл
   ТҮҮНИЙГ ЗОГСООХГҮЙ — үйлдвэрлэлийн шийдвэрийг скрипт гаргахгүй (§2:
   «Production reliability has priority»).  Хэрэглэгчид ЮУ болж байгааг
   хэлээд ЗОГСОНО; `npm run ai:stop` нь ХҮНИЙ шийдвэр.

⚠️ ДУЛААН: RTX 3070-ийн зөвшөөрөгдөх дээд нь 93 °C (драйверийн slowdown
   ~90 °C).  Бид 84 °C дээр АНХААРУУЛГА, 88 °C дээр сургалтыг ЭМХ ЦЭГЦТЭЙ
   зогсооно (checkpoint хадгалагдсан → `--resume` үргэлжлүүлнэ).  Overclock
   хийхгүй, хамгаалалт унтраахгүй (§15).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

# Драйверийн throttle тугууд (nvidia-smi clocks_throttle_reasons.active, bitmask).
# 0x1 = GpuIdle — хэвийн.  Дулаан/чадлын тугууд нь ЖИНХЭНЭ throttle.
THROTTLE_BITS = {
    0x0000000000000004: "sw_power_cap",
    0x0000000000000008: "hw_slowdown",
    0x0000000000000020: "sw_thermal_slowdown",
    0x0000000000000040: "hw_thermal_slowdown",
    0x0000000000000080: "hw_power_brake_slowdown",
}

WARN_TEMP_C = 84
STOP_TEMP_C = 88
RUNTIME_PORT = 39217


def telemetry() -> dict:
    """nvidia-smi-ийн ганц агшны хэмжилт.  Алдаа гарвал хоосон dict — сургалтыг УНАГААХГҮЙ."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return {}
    q = "temperature.gpu,power.draw,utilization.gpu,memory.used,memory.total,clocks_throttle_reasons.active"
    try:
        out = subprocess.run(
            [exe, f"--query-gpu={q}", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip().splitlines()[0]
    except Exception:
        return {}
    parts = [p.strip() for p in out.split(",")]
    if len(parts) < 6:
        return {}

    def num(s):
        try:
            return float(s)
        except ValueError:
            return None

    try:
        mask = int(parts[5], 16)
    except ValueError:
        mask = 0
    return {
        "temp_c": num(parts[0]),
        "power_w": num(parts[1]),
        "util_pct": num(parts[2]),
        "mem_used_mb": num(parts[3]),
        "mem_total_mb": num(parts[4]),
        "throttle": sorted(name for bit, name in THROTTLE_BITS.items() if mask & bit),
    }


def thermal_verdict(t: dict) -> tuple[str, str]:
    """('ok'|'warn'|'stop', тайлбар).  Хэмжилт байхгүй бол 'ok' — таамаглахгүй."""
    c = t.get("temp_c")
    if c is None:
        return "ok", ""
    hard = [x for x in t.get("throttle", []) if "thermal" in x or "hw_slowdown" in x]
    if c >= STOP_TEMP_C:
        return "stop", f"GPU {c:.0f} °C ≥ {STOP_TEMP_C} °C — сургалтыг эмх цэгцтэй зогсоолоо (checkpoint-оос --resume)."
    if hard:
        return "stop", f"Драйверийн дулааны throttle идэвхтэй ({', '.join(hard)}) — зогсоолоо."
    if c >= WARN_TEMP_C:
        return "warn", f"GPU {c:.0f} °C — {STOP_TEMP_C} °C дээр зогсоно."
    return "ok", ""


def inference_running(port: int = RUNTIME_PORT) -> dict | None:
    """
    Локал MGL AI runtime амьд эсэх.  Амьд бол llama-server нь VRAM барьж байна.

    Буцаах: {'port', 'health'} эсвэл None.  /health нь нэвтрэлтгүй (start.ps1-тэй ижил).
    """
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=3) as r:
            body = r.read(4096).decode("utf-8", "replace")
        try:
            body = json.loads(body)
        except Exception:
            pass
        return {"port": port, "health": body}
    except (urllib.error.URLError, OSError, TimeoutError):
        return None


def llama_processes() -> list[dict]:
    """GPU дээр VRAM барьж буй llama-server процессууд (nvidia-smi-ийн жагсаалт)."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return []
    try:
        out = subprocess.run(
            [exe, "--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True,
        ).stdout.strip()
    except Exception:
        return []
    rows = []
    for line in out.splitlines():
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            continue
        name = parts[1].lower()
        if "llama" in name or "python" in name:
            rows.append({"pid": parts[0], "name": parts[1], "used_mb": parts[2]})
    # ⚠️ WDDM (Windows) дээр nvidia-smi нь compute app-ыг ихэвчлэн ХАРУУЛДАГГҮЙ — процессын нэрээр ч шалгана.
    try:
        tl = subprocess.run(["tasklist", "/FI", "IMAGENAME eq llama-server.exe", "/FO", "CSV", "/NH"], capture_output=True, text=True, timeout=10).stdout
        for line in tl.splitlines():
            if line.lower().startswith('"llama-server.exe"'):
                pid = line.split('","')[1].strip('"')
                if not any(r["pid"] == pid for r in rows):
                    rows.append({"pid": pid, "name": "llama-server.exe", "used_mb": "?"})
    except Exception:
        pass
    return rows


def assert_gpu_free_for_training(allow_shared: bool = False) -> dict:
    """
    ⚠️ §2 — СУРГАЛТ ЭХЛЭХИЙН ӨМНӨ.  Инференс ажиллаж байвал ЗОГСОНО.

    `allow_shared=True` нь ЗӨВХӨН ухамсартай туршилтад (тайланд тэмдэглэгдэнэ):
    хоёулаа 8 GB-д багтахгүй гэдгийг хүн мэдэж байна гэсэн үг.
    """
    import sys

    t = telemetry()
    rt = inference_running()
    procs = llama_processes()
    state = {"telemetry": t, "inference_runtime": rt, "gpu_processes": procs, "allow_shared": allow_shared}

    if rt and not procs:
        print(f"  ℹ MGL AI runtime (порт {rt['port']}) амьд, гэвч llama-server ачаалагдаагүй — training.lock түүнийг ачаалахаас сэргийлнэ.")
    if procs:
        msg = [
            "",
            "  ⚠️  ҮЙЛДВЭРЛЭЛИЙН ИНФЕРЕНС ЭНЭ GPU ДЭЭР АЖИЛЛАЖ БАЙНА.",
            "",
        ]
        if rt:
            msg.append(f"      · MGL AI runtime: http://127.0.0.1:{rt['port']} хариу өгч байна")
        for p in procs:
            msg.append(f"      · GPU процесс pid {p['pid']} · {p['name']} · {p['used_mb']} MB")
        if t.get("mem_used_mb") is not None:
            msg.append(f"      · GPU санах ой: {t['mem_used_mb']:.0f} / {t['mem_total_mb']:.0f} MB эзэлсэн")
        msg += [
            "",
            "      QLoRA-гийн хэмжсэн оргил 7.6 GB + инференсийн 5.7 GB нь 8 GB-д БАГТАХГҮЙ.",
            "      Зэрэг ажиллуулбал Windows нь sysmem fallback руу халиад ХОЁУЛАА удаашрана",
            "      (сургалт ~10×, чат нь хэрэглэгчийн нүдэн дээр зогсонги).",
            "",
            "      Энэ скрипт үйлдвэрлэлийг ӨӨРӨӨ ЗОГСООХГҮЙ (§2).  Шийдвэрийг та гаргана:",
            "",
            "          cd ai && npm run ai:stop        # инференсийг зогсоож, VRAM суллана",
            "          # … сургалтын дараа:",
            "          cd ai && npm run ai:start",
            "",
            "      Ухамсартайгаар зэрэг ажиллуулах бол:  --allow-shared-gpu (тайланд тэмдэглэгдэнэ)",
            "",
        ]
        if not allow_shared:
            print("\n".join(msg))
            sys.exit(2)
        print("\n".join(msg))
        print("  ⚠️  --allow-shared-gpu өгсөн тул үргэлжилж байна.  Хэмжилт найдваргүй болно.\n")

    if t:
        print(
            f"  GPU телеметр: {t.get('temp_c')} °C · {t.get('power_w')} W · "
            f"{t.get('mem_used_mb')}/{t.get('mem_total_mb')} MB · throttle {t.get('throttle') or 'үгүй'}"
        )
    return state




# ── СУРГАЛТЫН ТҮГЖЭЭ — runtime/src/trainingLock.ts-ийн хос ─────────────────────
def training_lock_path() -> Path:
    """`%LOCALAPPDATA%/MglAi/training.lock` (эсвэл MGLAI_DATA_DIR) — runtime ЯГ энэ замыг уншина."""
    base = os.environ.get("MGLAI_DATA_DIR") or os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "MglAi")
    return Path(base) / "training.lock"


def acquire_training_lock(run_name: str) -> Path:
    """Runtime-д «GPU-г сургалт барьж байна» гэж хэлнэ; llama-server ачаалахаас татгалзана."""
    p = training_lock_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"pid": os.getpid(), "run": run_name, "since": time.strftime("%Y-%m-%dT%H:%M:%S")}), encoding="utf-8")
    return p


def release_training_lock() -> None:
    p = training_lock_path()
    try:
        if p.exists() and json.loads(p.read_text(encoding="utf-8")).get("pid") == os.getpid():
            p.unlink()
    except Exception:
        pass


if __name__ == "__main__":
    print(json.dumps({"telemetry": telemetry(), "inference": inference_running(), "procs": llama_processes(), "training_lock": str(training_lock_path())}, ensure_ascii=False, indent=2))
