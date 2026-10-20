r"""ХЭЦҮҮ ТОХИОЛДЛЫН НЭР ДЭВШҮҮЛЭЛТ (1B-5 §3.5) — ЗӨВХӨН УНШИНА.

Хилийн зурваст (`MinConfidence ± BAND`) унасан бодит бүртгэлүүдээс golden-д
нэр дэвшүүлэх мөрүүдийг ХЭВЛЭНЭ.  Хаана ч БИЧИХГҮЙ — `difficult_cases.json`
руу оруулах цорын ганц зам нь ХҮН `freeze.py add`-ээр батлах явдал.

    ..\server\.venv\Scripts\python.exe nominate.py --token %MGL_TOKEN%
    ..\server\.venv\Scripts\python.exe nominate.py --input borderline.json

⚠️ НЭР ДЭВШҮҮЛЭЛТ АВТОМАТ, БАТЛАХ НЬ АВТОМАТ БИШ.  Автомат оруулбал загвар
өөрийн ЭРГЭЛЗЭЭГЭЭ өөрөө шалгуур болгож, гогцоо хаагдана — «би энэ мөрд
эргэлзэж байсан, одоо би түүнийг зөв гэж бодож байна» гэсэн тест нь юу ч
хэмжихгүй.

⚠️ ЗУРВАСЫН ЗАНГУУ нь `revit-mcp/addin/IntentRouter.cs:81`-ийн 0.45,
`app_settings['assistant.min_confidence']` БИШ.  Тэр мөрийг репо даяар ХЭН Ч
УНШДАГГҮЙ (migration `0195:154-156` өөрөө ингэж бичсэн) — өөрчилвөл ЮУ Ч
болохгүй.  Тиймээс энэ скрипт бодит эх сурвалжийг C# файлаас УНШИЖ ТУЛГАНА.

BAND = 0.07 → [0.38, 0.52].  Үндэслэл (`IntentRouter.cs:52-64`-ийн 2392
мөрийн хэмжилт): 0.40 ба 0.55 хооронд «үйлдэл хийсэн» 93.1% → 88.2% болж
хөдөлдөг, өөрөөр хэлбэл ШИЙДВЭР яг тэр зурваст хөдөлгөөнтэй.  Мөн §2.4-ийн
дөрвөн уналтын ГУРАВ (0.58 · 0.41 · 0.38) энэ зурваст эсвэл хаяанд нь байв.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from assert_no_leak import (  # noqa: E402
    REPO,
    curated_index,
    load_manifest,
    read_json,
)
from train_intent import preprocess, row_id  # noqa: E402

MINC, BAND = 0.45, 0.07
ROUTER_CS = REPO / "addin" / "IntentRouter.cs"
DEFAULT_HOST = "https://mgl-progress-api.mglenc-design.workers.dev"


def assert_router_threshold() -> None:
    """⚠️ ХОСЫН ШАЛГАЛТ.  `IntentRouter.MinConfidence` хөдөлбөл зурвас хөвж,
    нэр дэвшүүлэлт утгагүй болно.  Чимээгүй зөрөхийг зөвшөөрөхгүй."""
    if not ROUTER_CS.exists():
        print(f"⚠️ {ROUTER_CS} олдсонгүй — босгыг тулгаж чадсангүй",
              file=sys.stderr)
        return
    src = io.open(ROUTER_CS, encoding="utf-8").read()
    m = re.search(r"MinConfidence\s*\{\s*get;\s*set;\s*\}\s*=\s*([0-9.]+)\s*;", src)
    if not m:
        raise SystemExit("IntentRouter.cs-аас MinConfidence уншигдсангүй")
    got = float(m.group(1))
    if abs(got - MINC) > 1e-9:
        raise SystemExit(
            f"❌ БОСГО ЗӨРӨВ: IntentRouter.cs = {got}, nominate.py = {MINC}.\n"
            f"   Хоёуланг нь зэрэг зас (`check_behavior.py:50`-ыг ч мартаж "
            f"болохгүй) — эс тэгвээс зурвас бодит шийдвэрийн хилтэй таарахгүй.")


def api(host: str, token: str, path: str) -> dict:
    req = urllib.request.Request(
        host.rstrip("/") + path,
        headers={"Authorization": "Bearer " + token, "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read().decode("utf-8"))


def main() -> None:
    ap = argparse.ArgumentParser(description="Хилийн зурвасаас golden нэр дэвшүүлэх")
    ap.add_argument("--host", default=DEFAULT_HOST)
    ap.add_argument("--token", default=None, help="эсвэл MGL_TOKEN")
    ap.add_argument("--input", type=Path, default=None,
                    help="сүлжээгүй горим: `/assistant/borderline`-ийн хариу файл")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--band", type=float, default=BAND)
    args = ap.parse_args()

    assert_router_threshold()
    lo = round(max(0.0, MINC - args.band), 4)
    hi = round(min(1.0, MINC + args.band), 4)
    print(f"ХИЛИЙН ЗУРВАС  [{lo}, {hi}]   (IntentRouter.MinConfidence={MINC} ± {args.band})",
          file=sys.stderr)

    if args.input:
        got = read_json(args.input)
    else:
        token = args.token or os.environ.get("MGL_TOKEN") or ""
        if not token:
            raise SystemExit("Токен алга: --token / MGL_TOKEN, эсвэл --input")
        try:
            got = api(args.host, token,
                      f"/api/revit/assistant/borderline?lo={lo}&hi={hi}&limit={args.limit}")
        except urllib.error.HTTPError as e:
            raise SystemExit(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:400]}")

    rows = got.get("rows") or []
    man = load_manifest()
    excl = set(man.get("exclude_row_ids") or [])
    curated_folded, _rid, _counts = curated_index()

    n_gold = n_train = n_empty = 0
    out = 0
    for r in rows:
        text = (r.get("text") or "").strip()
        if not text:
            n_empty += 1
            continue
        intent = (r.get("corrected") or r.get("predicted") or "unknown").strip() or "unknown"
        if row_id(text, intent) in excl:
            n_gold += 1                       # аль хэдийн golden
            continue
        if preprocess(text) in curated_folded:
            n_train += 1                      # аль хэдийн сургалтад
            continue
        print(json.dumps({
            "text": text,
            "suggest_intent": intent,
            "predicted": r.get("predicted"),
            "corrected": r.get("corrected"),
            "confidence": r.get("confidence"),
            "decided_by": r.get("decided_by"),
            "acted": r.get("acted"),
            "created_at": r.get("created_at"),
            "row_id": row_id(text, intent),
        }, ensure_ascii=False))
        out += 1

    print(f"\nзурвасын мөр {len(rows)} → нэр дэвшигч {out}  "
          f"(golden {n_gold} · сургалтад {n_train} · хоосон {n_empty})",
          file=sys.stderr)
    if out == 0 and len(rows) == 0:
        print("⚠️ Зурваст МӨР АЛГА.  `difficult_cases` хоосон хэвээр үлдэнэ; "
              "§9-ийн 6-р асуулт (эзний шийдвэр) хүчинтэй хэвээр.",
              file=sys.stderr)
    print("\nДАРААГИЙН АЛХАМ — мөр бүрийг ХҮН шалгаж, зөв шошгыг нь өгөөд:\n"
          "  freeze.py add --partition difficult_cases --text \"…\" "
          "--intent <санаа> --author \"<нэр>\"", file=sys.stderr)


if __name__ == "__main__":
    main()
