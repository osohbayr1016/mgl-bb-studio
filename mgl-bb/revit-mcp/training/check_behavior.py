r"""ЗАН ТӨЛӨВИЙН ШАЛГАЛТ — ТАНИХГҮЙ текст дээр загвар ЗӨВ ажиллаж байгаа эсэх.

`check_parity.py`-аас ЯЛГААТАЙ: тэр нь C# ба Python ижил эсэхийг шалгадаг
(хоёулаа ижилхэн БУРУУ байж болно).  Энэ нь загварын ЗӨВ эсэхийг шалгана.

⚠️ МӨР БҮР СУРГАЛТЫН БАГЦАД БАЙХГҮЙ.  Скрипт үүнийг ӨӨРӨӨ шалгадаг —
жишээ санамсаргүй өгөгдөлд орвол тест «ерөнхийлөх чадвар»-ыг хэмжихээ
болиод «цээжилсэн эсэх»-ийг хэмжинэ, гэтэл ногоон хэвээр байна.

ХАМРАХ ХҮРЭЭ (захиалагчийн шаардлагаар):
  • англи        — бүтээгдэхүүн бусад компанид зарагдана
  • латин-монгол — кирилл гарын үсэггүй хүн олон
  • кирилл       — үндсэн
  • алдаатай     — «үг үсэг үлдээж, дутуу бичдэг хүмүүсийн үгийг ойлгох»
  • холимог      — «progress оо push хий»
  • ХАТУУ СӨРӨГ  — MGL-ийн ӨӨР модулиуд (ирц, чөлөө, имэйл, тайлан)

⚠️ ХАМГИЙН ЧУХАЛ НЬ ХАТУУ СӨРӨГ ХЭСЭГ.  «ирцээ бүртгүүлье» нь MGL-ийн
ТУСДАА модуль (ирц), гэтэл «бүртгүүл» гэдэг үг submit_progress-ийн №1
түлхүүр үг.  2026-08-25-нд загвар үүнийг submit_progress 0.58 гэж
таамаглаж, босго давсан тул ҮЙЛДЭЛ хийх гэж байв.
`data/hard-negatives.json` үүнийг зассан; тэр мөрүүдийг ХАСАЖ БОЛОХГҮЙ.

    ..\..\server\.venv\Scripts\python.exe check_behavior.py

⚠️ Б3 (2026-08-28).  ЖИШЭЭНҮҮД ЭНЭ ФАЙЛД БИШ.  Тэдгээр нь `eval/golden/intents.json`
-д амьдарч, энд ЗӨВХӨН УНШИГДана (`load_probes()`).  Урьд нь хоёр хуулбар
байсан бөгөөд ямар ч зүйл тэднийг ижил байлгадаггүй байв.
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

import check_parity as cp
from train_intent import PREPROCESS_CONTRACT, preprocess

ADDIN = Path(__file__).resolve().parent.parent / "addin"
DATA = Path(__file__).resolve().parent / "data"

# ⚠️ `IntentRouter.MinConfidence` / `MinMargin`-тэй ЗААВАЛ таарна.  Тэнд
# өөрчилвөл ЭНД ч өөрчил — эс тэгвээс тест бодит зан төлөвийг шалгахаа болино.
MINC, MINM = 0.45, 0.15

# ⚠️ Б3 (2026-08-28) · ЖИШЭЭНҮҮД ЭНД БАЙХАА БОЛЬСОН.
#
# Урьд нь энэ файлд 61 мөрийн inline литерал байсан бөгөөд `eval/golden/
# intents.json` нь ЯГ ТЭР мөрүүдийн ХОЁР ДАХЬ ХУУЛБАР байв (тэр файлын
# `author` талбар бүр «check_behavior.py» гэж бичигдсэн — эх сурвалж нь
# энэ файл байсан).  Хоёр хуулбар нь ХЭЗЭЭ Ч ижил байхын баталгаагүй:
# энд нэг мөр нэмэхэд golden багц хөндөгдөхгүй, тэгээд `check_behavior.py`
# ба `run_golden.py` хоёр ӨӨР ӨӨР зүйл хэмжиж эхэлнэ — гэтэл хоёулаа
# ногоон гэрэл өгнө.  Одоо ЭХ СУРВАЛЖ НЬ ГАНЦ: golden `intents` хуваарь.
#
# ⚠️ ЭНЭ НЬ АЛДАГДАЛ БИШ.  Golden мөрийг СУРГАЛТАД оруулах нь алдагдал;
# ТЕСТЭД уншиж, түүн дээр СОРИХ нь golden багцын ЯГ ЗОРИУЛАЛТ.
# `assert_no_leak.py` нь эдгээр мөр сургалтын багцад ОРООГҮЙ гэдгийг
# тусад нь баталдаг тул хоёр шалгалт хоорондоо зөрчилдөхгүй.
#
# ⚠️ ХЯЗГААР (A3-8, ЭНЭ СЕССЭД ЗАСААГҮЙ).  Нэг эх сурвалж болгосон нь
# ХУУЛБАРЫГ арилгасан ч НЭГ ДОХИОГ ХОЁР болгодоггүй: golden `intents`
# нь өнөөдөр ч гэсэн энэ шалгалтаас ГАРАЛТАЙ мөрүүд.  Тиймээс
# `check_behavior.py` ба `run_golden.py --kind intent` хоёр нь ХАРААТ
# БУС хоёр хэмжилт БИШ — нэг л багцыг хоёр өөр harness-аар уншиж байна.
# Бие даасан GOLDEN-EVAL болгохын тулд ШИНЭ, өөр гараас гарсан мөр
# зохиох хэрэгтэй; тэр нь ӨГӨГДЛИЙН шийдвэр, инженерийн биш.
EVAL_DIR = Path(__file__).resolve().parent.parent / "eval"
GOLDEN_INTENTS = EVAL_DIR / "golden" / "intents.json"


def load_probes() -> list[tuple[str, str, str]]:
    """GOLDEN-EVAL `intents` хуваарийг (текст, санаа, бүлэг) болгож уншина.

    ⚠️ ФАЙЛ БАЙХГҮЙ / ХООСОН бол УНАЛТ.  «Олдсонгүй тул алгаслаа» гэдэг нь
    яг тэр чимээгүй ногоон гэрэл — шалгалт ажиллаагүй атлаа 0 алдаа гэж
    тайлагнана.
    """
    if not GOLDEN_INTENTS.exists():
        raise SystemExit(
            f"❌ {GOLDEN_INTENTS} ОЛДСОНГҮЙ.  Зан төлөвийн жишээнүүд ЭНД БИШ, "
            f"golden багцад амьдардаг (Б3) — энэ шалгалт ажиллах боломжгүй.")
    obj = json.loads(io.open(GOLDEN_INTENTS, encoding="utf-8-sig").read())
    if obj.get("partition") != "intents":
        raise SystemExit(f"❌ {GOLDEN_INTENTS.name}: `partition` нь `intents` биш "
                         f"({obj.get('partition')!r})")
    if obj.get("preprocess_contract") != PREPROCESS_CONTRACT:
        raise SystemExit(
            f"❌ {GOLDEN_INTENTS.name}: `preprocess_contract` зөрөв "
            f"({obj.get('preprocess_contract')!r} ≠ {PREPROCESS_CONTRACT!r}) — "
            f"`eval/freeze.py recontract` ажиллуул.")
    rows = obj.get("rows")
    if not isinstance(rows, list) or not rows:
        raise SystemExit(f"❌ {GOLDEN_INTENTS.name}: `rows` хоосон эсвэл алга")

    out: list[tuple[str, str, str]] = []
    seen: set[str] = set()
    for i, r in enumerate(rows):
        text = (r.get("text") or "").strip()
        intent = (r.get("intent") or "").strip()
        group = (r.get("group") or "?").strip()
        if not text or not intent:
            raise SystemExit(f"❌ {GOLDEN_INTENTS.name} мөр #{i}: `text`/`intent` дутуу")
        # ⚠️ C# harness нь МӨРӨӨР ажилладаг (`p.txt`) тул мөр шилжилт/таб
        # агуулсан текст нь гаралтын мөрүүдийг ГАЖУУДУУЛНА.
        if "\n" in text or "\t" in text:
            raise SystemExit(f"❌ {GOLDEN_INTENTS.name} мөр #{i}: мөр шилжилт/таб "
                             f"агуулсан текст — harness мөрөөр ажилладаг")
        if text in seen:
            raise SystemExit(f"❌ {GOLDEN_INTENTS.name} мөр #{i}: давхардсан текст "
                             f"{text!r} — harness гаралтыг мөр мөрөөр тулгадаг")
        seen.add(text)
        out.append((text, intent, group))
    return out


# (текст, хүлээсэн санаа, тайлбар-бүлэг) — эх сурвалж нь golden `intents`.
PROBES: list[tuple[str, str, str]] = load_probes()


def training_texts() -> set[str]:
    out: set[str] = set()
    for f in sorted(DATA.glob("*.json")):
        obj = json.loads(io.open(f, encoding="utf-8").read())
        rows = obj.get("rows") if isinstance(obj, dict) else obj
        if not isinstance(rows, list):
            continue
        for r in rows:
            if isinstance(r, dict) and r.get("text"):
                out.add(preprocess(r["text"]))
    return out


def main() -> None:
    # ⚠️ ЭХЛЭЭД: жишээ нь сургалтын багцад ОРООГҮЙ эсэхийг батал.
    seen = training_texts()
    leaked = [t for t, _, _ in PROBES if preprocess(t) in seen]
    if leaked:
        print("❌ ЖИШЭЭ СУРГАЛТЫН БАГЦАД ОРСОН — тест утгаа алдана:", file=sys.stderr)
        for t in leaked:
            print(f"     {t!r}", file=sys.stderr)
        print("   Эдгээрийг СОЛИНО уу (өгөгдлөөс хасах нь буруу шийдэл).",
              file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp)
        (d / "parity.csproj").write_text(
            cp.HARNESS_CSPROJ
              .replace("__MODEL_CS__", str((ADDIN / "IntentModel.cs").resolve()))
              .replace("__FOLD_CS__", str((ADDIN / "TextFold.cs").resolve())),
            encoding="utf-8")
        (d / "Program.cs").write_text(cp.HARNESS_MAIN, encoding="utf-8")
        pf = d / "p.txt"
        pf.write_text("\n".join(t for t, _, _ in PROBES), encoding="utf-8")

        r = subprocess.run(
            ["dotnet", "run", "--project", str(d / "parity.csproj"), "--",
             str((ADDIN / "Resources" / "intent-model.json").resolve()), str(pf)],
            capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            print((r.stdout or "")[-2000:], file=sys.stderr)
            print((r.stderr or "")[-2000:], file=sys.stderr)
            raise SystemExit(f"C# harness амжилтгүй (rc={r.returncode})")
        lines = [l for l in (r.stdout or "").splitlines() if "\t" in l]

    if len(lines) != len(PROBES):
        raise SystemExit(f"мөрийн тоо зөрж байна: {len(lines)} vs {len(PROBES)}")

    ok = 0
    by_group: dict[str, list[int]] = {}
    print(f"  {'бүлэг':16} {'текст':38} {'таамаг':17} {'итгэл':>6} {'хүлээсэн':17}")
    print("  " + "-" * 100)
    for (text, exp, grp), line in zip(PROBES, lines):
        _, lab, c = line.split("\t")
        c = float(c)
        acted = lab != "unknown" and c >= MINC
        good = lab == exp
        ok += good
        by_group.setdefault(grp.split("·")[0], []).append(1 if good else 0)
        mark = "✅" if good else "❌"
        act = "→үйлдэл" if acted else "→асууна"
        print(f"  {mark} {grp:14} {text[:36]:36} {lab:17} {c:6.2f} {exp:17} {act}")

    print(f"\n  {'бүлэг':16} {'зөв':>9}")
    print("  " + "-" * 27)
    for g in sorted(by_group):
        v = by_group[g]
        print(f"  {g:16} {sum(v):>4}/{len(v):<4}")

    print(f"\n  НИЙТ {ok}/{len(PROBES)} зөв")

    # ⚠️ Тэг биш кодоор гарна — скрипт/CI үүнийг барих ёстой.
    if ok < len(PROBES):
        sys.exit(1)


if __name__ == "__main__":
    main()
