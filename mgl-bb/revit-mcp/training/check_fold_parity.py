r"""`textfold.py` (Python) ↔ `backend/src/lib/textFold.ts` (TypeScript) ТУЛГАЛТ.

Гурван хослолын гуравдугаарыг нь барина.  Санаа таних загвар нь эвхсэн
хэлбэр дээр суралцдаг тул хоёр тал зөрвөл вэб дээрх хайлт болон Revit
дэх таних чадвар ЧИМЭЭГҮЙ зөрнө.

    ..\..\server\.venv\Scripts\python.exe check_fold_parity.py
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

from textfold import fold_text

ROOT = Path(__file__).resolve().parents[2]
TS = ROOT / "backend" / "src" / "lib" / "textFold.ts"

def corpus() -> list[str]:
    rows: list[str] = []
    d = Path(__file__).resolve().parent / "data"
    for f in sorted(d.glob("*.json")):
        obj = json.loads(io.open(f, encoding="utf-8").read())
        got = obj.get("rows") if isinstance(obj, dict) else obj
        if not isinstance(got, list):
            continue          # report.json гэх мэт өгөгдлийн бус файл
        rows += [r["text"] for r in got if isinstance(r, dict) and "text" in r]
    # ⚠️ Ирмэгийн тохиолдлууд — сургалтын өгөгдөлд байхгүй боловч
    # эвхэлтийн дүрэм бүрийг дангаар нь хөнддөг.
    rows += [
        "", " ", "\t\n", "ӨӨӨ", "үүү", "ЩЩ", "ъь", "Ёлка", "яЯюЮ",
        "БА-01", "BA 01", "ХАС_01", "kh KH Kh", "TS ts Ц ц",
        "y Y й Й ы Ы", "aaa bbb ccc", "1200", "1-р давхар", "café",
        "Ажлын   зураг", "МОНГОЛ", "mongol", "MoNgOl",
        "хийснээ илгээе", "hiisnee ilgeeye", "khiisnee ilgeye",
        "70% болголоо", "70% болсон уу?", "БА-01 ыг 60% болгов",
    ]
    return rows


def main() -> None:
    rows = corpus()
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        ts = io.open(TS, encoding="utf-8").read()
        # төрлийн тэмдэглэгээ хасах (файл энгийн тул хангалттай)
        js = (ts.replace(": Record<string, string>", "")
                .replace("(input: string): string", "(input)")
                .replace("export function", "function"))
        js += "\nexport { foldText, foldCode };\n"
        (d / "fold.mjs").write_text(js, encoding="utf-8")
        (d / "in.json").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        (d / "run.mjs").write_text(
            "import { readFileSync, writeFileSync } from 'node:fs';\n"
            "import { foldText } from './fold.mjs';\n"
            "const rows = JSON.parse(readFileSync(process.argv[2], 'utf8'));\n"
            "writeFileSync(process.argv[3], JSON.stringify(rows.map(foldText)), 'utf8');\n",
            encoding="utf-8")
        out = d / "out.json"
        r = subprocess.run(["node", str(d / "run.mjs"), str(d / "in.json"), str(out)],
                           capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print(r.stdout[-2000:], file=sys.stderr)
            print(r.stderr[-2000:], file=sys.stderr)
            raise SystemExit(f"node амжилтгүй (rc={r.returncode})")
        ts_out = json.loads(io.open(out, encoding="utf-8").read())

    bad = [(t, a, b) for t, a, b in zip(rows, [fold_text(x) for x in rows], ts_out) if a != b]
    print(f"  мөр   : {len(rows)}")
    print(f"  зөрүү : {len(bad)}")
    for t, a, b in bad[:15]:
        print(f"    {t!r}\n       python={a!r}\n       ts    ={b!r}")
    print()
    if bad:
        print("  ❌ ЗӨРҮҮТЭЙ — textfold.py ба textFold.ts-ийг тулга")
        sys.exit(1)
    print("  ✅ Python ба TypeScript ЯГ ИЖИЛ")


if __name__ == "__main__":
    main()
