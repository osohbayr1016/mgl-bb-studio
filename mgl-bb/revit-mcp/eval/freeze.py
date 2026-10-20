r"""GOLDEN БАГЦЫГ ХӨДӨЛГӨХ ЦОРЫН ГАНЦ ЗАМ (1B-5).

Golden файлыг ГАРААР засах нь болно (git-д харагдана), ГЭХДЭЭ дараа нь
`freeze.py refresh` ЗААВАЛ ажиллана — эс тэгвээс SHA-256 зөрч, `run_golden.py`
шууд унана.  Тэр нь алдаа биш, ЗОРИЛГО: «загварыг давуулахын тулд golden-ыг
засах» гэдэг оролдлого тэр дор нь ил гарна.

    # регресс нэмэх (ГОЛ хэрэглээ)
    ..\server\.venv\Scripts\python.exe freeze.py add-regression ^
        --text "ирцээ тэмдэглэх хуудас хаана байдаг вэ" --intent unknown ^
        --incident HN-1 --was "submit_progress@0.58" ^
        --why "«бүртгүүл» n-gram дийлсэн" --author "О.Сохбаяр"

    # энгийн golden мөр нэмэх
    ... freeze.py add --partition adversarial --text "…" --intent unknown

    # гараар засварласны дараа checksum/id дахин тооцох
    ... freeze.py refresh

    # `PREPROCESS_CONTRACT` өөрчлөгдсөн үед (ТУСДАА commit!)
    ... freeze.py recontract

⚠️ **МӨР ХАСАХ ДЭД КОМАНД БАЙХГҮЙ.**  Санаатай.  Регрессийн багц зөвхөн
ӨСНӨ — «энэ уналт дахин гарахгүй» гэсэн амлалтыг машин цуцалж болохгүй.
Хасах ёстой бол ГАРААР засаад PR-т ЯАГААД гэдгийг бич; хүний хяналт нь
механизм (§3.9).

⚠️ Шинэ мөр CURATED-TRAIN-тэй эвхэлтээрээ давхцвал ЭНЭ СКРИПТ ТАТГАЛЗАНА.
Тэр үед сургалтын мөрийг хасах нь БУРУУ шийдэл — өөр хэллэг ол (§4).
"""

from __future__ import annotations

import argparse
import ast
import datetime as _dt
import io
import json
import sys
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import assert_no_leak as anl  # noqa: E402
from assert_no_leak import (  # noqa: E402
    DATA,
    GOLDEN,
    MANIFEST_PATH,
    PARTITIONS,
    REPO,
    TRAINING,
    TRAIN_REGISTRY,
    curated_files,
    curated_index,
    golden_row_ids,
    partition_path,
    partition_rows,
    read_json,
    rel,
    sha256_file,
)
from train_intent import PREPROCESS_CONTRACT, preprocess, row_id  # noqa: E402

# `required_partitions` — аль хуваарь нь тухайн ТӨРЛИЙН загварыг ХААХ эрхтэй вэ.
#
# ⚠️ `difficult_cases` нь `intent`-д ОРООГҮЙ.  §9-ийн 6-р асуулт (эзний
# шийдвэр) хариулагдаагүй байгаа ба `nominate.py` нэг ч удаа ажиллаагүй тул
# өнөөдөр оруулбал БҮХ intent загвар блоклогдоно.  Эхний нэр дэвшүүлэлт
# хийгдэж, эзэн доод хязгаарыг (санал: 20 мөр) баталсны дараа ЭНД нэмнэ.
REQUIRED_PARTITIONS = {
    "intent": ["intents", "regressions", "adversarial"],
    "bim": ["bim", "regressions"],
    "rules": ["rules", "regressions"],
}

PARTITION_NOTE = {
    "intents": ("GOLDEN-EVAL · санаа таних БҮТЭН зан төлөвийн зураглал.  "
                "Эх сурвалж: check_behavior.py-ийн PROBES (61 мөр).  "
                "ХӨЛДӨӨСӨН — ердийн сургалтын дамжуулга үүнийг ХЭЗЭЭ Ч өөрчлөхгүй."),
    "bim": ("GOLDEN-EVAL · typed BIM intent.  ХООСОН ШИЛЖИНЭ — Track C хүртэл "
            "хэмжих зүйл алга.  ⚠️ Хоосныг АЛГАСАХГҮЙ: `--kind bim` загвар "
            "энэ файл дүүрэх хүртэл БЛОКЛОГДОНО (§3.4)."),
    "rules": ("GOLDEN-EVAL · дүрмийн хөдөлгүүр (БНбД хэмжээс).  ХООСОН "
              "ШИЛЖИНЭ — revit-mcp/CLAUDE.md:59-116-ийн тоонууд нь өөрсдөө "
              "«design-guidance, албан ёсны БНбД-тэй тулгаагүй» тул golden "
              "болгож ХӨЛДӨӨЖ БОЛОХГҮЙ (§9-ийн 3-р асуулт)."),
    "difficult_cases": ("GOLDEN-EVAL · хилийн зурвасаас нэр дэвшсэн бодит "
                        "тохиолдлууд.  `nominate.py` НЭР ДЭВШҮҮЛНЭ, хүн "
                        "`freeze.py add`-ээр БАТАЛНА.  Автомат оруулах нь "
                        "загварыг өөрөө өөрийгөө шалгах гогцоо болгоно."),
    "regressions": ("GOLDEN-REGRESSION · түүхэн уналт БҮР, ҮҮРД.  ⚠️ ХЭЗЭЭ Ч "
                    "МӨР ХАСАХГҮЙ.  Мөр бүр `hard-negatives.json`-ы ЗАСВАРЫН "
                    "АХ ДҮҮ хэллэг байх ёстой — хуулбар биш, эс тэгвээс тест "
                    "нь цээжилсэн эсэхийг хэмжинэ (§3.2).  Нэмэх журам: "
                    "`freeze.py add-regression`."),
    "adversarial": ("GOLDEN-EVAL · «хийж болохгүйгээ мэдэж байна уу».  "
                    "PROBES-ийн `unknown` хүлээлттэй 18 мөр.  `intents`-тэй "
                    "давхцах нь ЗӨВ — тусдаа оноо (§3.2)."),
}


# --------------------------------------------------------------------------
# Бичих туслахууд
# --------------------------------------------------------------------------

def write_json(p: Path, obj) -> None:
    """⚠️ ФОРМАТ НЬ ГЭРЭЭ.  `indent=1` + төгсгөлийн мөр шилжилт — SHA-256
    давтагдахуйц байхын тулд бичих бүрд ЯГ ИЖИЛ байх ёстой."""
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(obj, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )


def new_partition(name: str) -> dict:
    return {
        "_note": PARTITION_NOTE[name],
        "partition": name,
        "frozen": True,
        "preprocess_contract": PREPROCESS_CONTRACT,
        "rows": [],
    }


def load_partition_doc(name: str) -> dict:
    p = partition_path(name)
    if not p.exists():
        return new_partition(name)
    obj = read_json(p)
    obj.setdefault("partition", name)
    obj["_note"] = PARTITION_NOTE[name]
    obj["frozen"] = True
    obj["preprocess_contract"] = PREPROCESS_CONTRACT
    if not isinstance(obj.get("rows"), list):
        obj["rows"] = []
    return obj


def stamp_ids(doc: dict) -> dict:
    for r in doc["rows"]:
        r["row_id"] = row_id(r["text"], r["intent"])
    return doc


def today_version(prev: str | None) -> str:
    """`2026-08-28.1` → ижил өдөр дахин бичвэл `.2`."""
    today = _dt.date.today().isoformat()
    if prev and prev.startswith(today + "."):
        try:
            return f"{today}.{int(prev.rsplit('.', 1)[1]) + 1}"
        except ValueError:
            pass
    return today + ".1"


# --------------------------------------------------------------------------
# Давхцлын хамгаалалт
# --------------------------------------------------------------------------

def refuse_if_curated(text: str, intent: str) -> None:
    by_folded, by_rowid, _counts = curated_index()
    fold = preprocess(text)
    rid = row_id(text, intent)
    where = by_rowid.get(rid) or by_folded.get(fold)
    if where:
        print(f"❌ ТАТГАЛЗЛАА — энэ мөр CURATED-TRAIN-д АЛЬ ХЭДИЙН байна: "
              f"data/{where}", file=sys.stderr)
        print(f"   эвхсэн түлхүүр: {fold!r}", file=sys.stderr)
        print("   ЗАСВАР: ӨӨР ХЭЛЛЭГ ол.  Сургалтын мөрийг ХАСАХ нь БУРУУ "
              "шийдэл — `hard-negatives.json` бол ЗАСВАР, түүнийг хасвал "
              "уналт БУЦАЖ ИРНЭ (§4).", file=sys.stderr)
        sys.exit(1)


def refuse_if_duplicate(doc: dict, text: str, intent: str) -> None:
    rid = row_id(text, intent)
    for r in doc["rows"]:
        if row_id(r["text"], r["intent"]) == rid:
            print(f"❌ ТАТГАЛЗЛАА — `{doc['partition']}`-д ижил мөр байна: "
                  f"{r['text']!r} ({rid})", file=sys.stderr)
            sys.exit(1)


# --------------------------------------------------------------------------
# Манифест
# --------------------------------------------------------------------------

def registry_files() -> list[str]:
    """A5 · `training/datasets.manifest.json`-д ҮНЭХЭЭР бүртгэгдсэн файлууд.

    ⚠️ Энэ бол ЦОРЫН ГАНЦ «юу сургагддаг вэ» жагсаалт.  Дараалал нь эх
    сурвалжийнхтай ЯГ ИЖИЛ хэвээр — тэр нь давхардал хасалтын тэргүүлэх
    эрэмбэ тул `sorted()` ХИЙХГҮЙ.
    """
    if not TRAIN_REGISTRY.exists():
        return []
    try:
        reg = read_json(TRAIN_REGISTRY)
    except Exception:  # noqa: BLE001
        return []
    return [str(d.get("file") or "") for d in (reg.get("datasets") or [])
            if d.get("file")]


def build_manifest(version: str | None = None) -> dict:
    prev: dict = {}
    if MANIFEST_PATH.exists():
        prev = read_json(MANIFEST_PATH)

    golden: dict[str, dict] = {}
    for name in PARTITIONS:
        p = partition_path(name)
        if not p.exists():
            write_json(p, new_partition(name))
        golden[name] = {
            "file": rel(p),
            "sha256": sha256_file(p),
            "rows": len(partition_rows(name)),
        }

    by_folded, _rid, _counts = curated_index()
    holdout = DATA / "eval-holdout.ids.json"

    man = {
        "_note": (
            "1B-5 · GOLDEN БАГЦЫН МАНИФЕСТ.  ГАРААР БҮҮ ЗАС — `freeze.py "
            "refresh` бичнэ.  `exclude_row_ids` нь GOLDEN-EVAL ∪ "
            "GOLDEN-REGRESSION-ийн БҮХ мөрийн тодорхой, тоологдох жагсаалт; "
            "`train_intent.py` үүнтэй огтлолцсон сургалтын мөр олвол BUILD "
            "УНАНА (сэрэмжлүүлэг биш)."
        ),
        "manifest_version": 2,
        "dataset_version": version or prev.get("dataset_version") or today_version(None),
        # ⚠️ `train_intent.PREPROCESS_CONTRACT`-тай таарахгүй бол БҮХ row_id
        # хүчингүй — `run_golden.py` шууд унана.
        "preprocess_contract": PREPROCESS_CONTRACT,
        "row_id": {
            "source": "revit-mcp/training/train_intent.py :: row_id()",
            "formula": "sha256(preprocess(text) + '\\x00' + intent).hexdigest()[:16]",
            "_why": (
                "1B-4-ийн тодорхойлолтыг ЯГ дуудна — энд хувилбар бичихийг "
                "хориглоно.  Түлхүүр нь ЭВХСЭН текст + санаа, тиймээс "
                "«ЦБУ-05 ыг 70 хувь болголоо» ба «cbu 05 ig 70 huv bolgoloo» "
                "НЭГ id авна; үсгийн хувилбараар батламжийг тойрох боломжгүй."
            ),
        },
        "curated_train": {
            # ⚠️ ЖАГСААЛТЫГ ЭНД FORK ХИЙХГҮЙ.  Эх сурвалж нь 1B-4-ийн
            # бүртгэл; энд зөвхөн ЗААЖ, checksum-ыг нь барина.  Хоёр газар
            # жагсаалт барих нь ЧИМЭЭГҮЙ ЗӨРӨХ баталгаа.
            #
            # ⚠️ A5 (2026-08-28).  Урьд нь `_files_derived` нь `curated_files()`
            # -ийн ӨРГӨН glob-ыг ямар ч тэмдэглэгээгүйгээр хэвлэдэг байсан тул
            # `eval-holdout.ids.json` (ID жагсаалт, `rows` БАЙХГҮЙ) сургалтын
            # датасет мэт харагддаг байв.  Одоо ХОЁР жагсаалт ТУСДАА:
            #   · `registry_files` — ЯГ юу сургагдаж байгаа (эх сурвалж)
            #   · `_files_scanned` — алдагдал ХАЙХ хамрах хүрээ (ЗОРИУД илүү
            #     өргөн; бүртгэлгүй файл ч алдагдал авчирч болно)
            "_source_of_truth": "training/datasets.manifest.json",
            "registry": rel(TRAIN_REGISTRY) if TRAIN_REGISTRY.exists() else None,
            "registry_sha256": sha256_file(TRAIN_REGISTRY) if TRAIN_REGISTRY.exists() else None,
            "registry_files": registry_files(),
            "_files_scanned": [rel(f) for f in curated_files()],
            "_scan_note": (
                "`_files_scanned` нь `training/data/*.json` glob ба бүртгэлийн "
                "НЭГДЭЛ — сургалтын датасетын жагсаалт БИШ.  Аль нь үнэхээр "
                "сургагддагийг `registry_files` хэлнэ.  `eval-holdout.ids.json` "
                "нь 1B-4-ийн хөлдөөсөн ID жагсаалт (`rows` байхгүй, 0 мөр "
                "нэмдэг) тул бүртгэлд ХЭЗЭЭ Ч орохгүй."
            ),
            # ⚠️ ДАВХАРДАЛ ХАССАН тоо.  Түүхий мөрийн нийлбэртэй ТААРАХГҮЙ
            # (2402 ≠ 2532) — «45 vs 46» маягийн зөрүү бүр эндээс гардаг.
            "unique_folded_rows": len(by_folded),
            "_unique_folded_rows_note": (
                "`train_intent.clean_records()`-ийн дараах ӨВӨРМӨЦ "
                "(preprocess(text), intent) хосын тоо.  Файлын `rows` уртын "
                "нийлбэр БИШ."
            ),
        },
        "holdout": {
            # 1B-4-ийн ХӨЛДӨӨСӨН holdout.  Байхгүй бол БЛОКЛОХГҮЙ — 1B-5 нь
            # түүнээс ҮЛ ХАМААРАН ажиллана (§5.1).
            "file": rel(holdout) if holdout.exists() else "training/data/eval-holdout.ids.json",
            "present": holdout.exists(),
            "sha256": sha256_file(holdout) if holdout.exists() else None,
        },
        "golden": golden,
        "exclude_row_ids": golden_row_ids(),
        "required_partitions": REQUIRED_PARTITIONS,
        "_required_partitions_note": (
            "`difficult_cases` нь `intent`-д САНААТАЙГААР ОРООГҮЙ — §9-ийн "
            "6-р асуулт (эзний шийдвэр) хараахан хариулагдаагүй, `nominate.py` "
            "нэг ч удаа ажиллаагүй.  Эхний нэр дэвшүүлэлтийн дараа эзэн доод "
            "хязгаарыг баталж, `freeze.REQUIRED_PARTITIONS`-д нэмнэ."
        ),
    }
    return man


def cmd_refresh(args) -> int:
    for name in PARTITIONS:
        doc = stamp_ids(load_partition_doc(name))
        write_json(partition_path(name), doc)
    man = build_manifest(args.version)
    write_json(MANIFEST_PATH, man)
    print(f"манифест бичигдлээ: {rel(MANIFEST_PATH)}")
    print(f"  датасетын хувилбар  {man['dataset_version']}")
    print(f"  гэрээ               {man['preprocess_contract']}")
    for name in PARTITIONS:
        g = man["golden"][name]
        print(f"  {name:16} мөр={g['rows']:>4}  sha={g['sha256'][:16]}…")
    print(f"  exclude_row_ids     {len(man['exclude_row_ids'])} id "
          f"(давхардал хассан — `intents` ба `adversarial` 18 мөрөөр давхцана)")
    return anl.check(verbose=False)


# --------------------------------------------------------------------------
# Дэд командууд
# --------------------------------------------------------------------------

def cmd_add(args) -> int:
    text = args.text.strip()
    intent = args.intent.strip()
    if not text:
        raise SystemExit("--text хоосон")
    refuse_if_curated(text, intent)
    doc = load_partition_doc(args.partition)
    refuse_if_duplicate(doc, text, intent)
    row = {
        "row_id": row_id(text, intent),
        "text": text,
        "intent": intent,
        "group": args.group or "",
        "added": _dt.date.today().isoformat(),
        "author": args.author or "",
    }
    doc["rows"].append(row)
    write_json(partition_path(args.partition), stamp_ids(doc))
    print(f"нэмэгдлээ → golden/{args.partition}.json  {row['row_id']}  {text!r}")
    args.version = today_version(
        read_json(MANIFEST_PATH).get("dataset_version") if MANIFEST_PATH.exists() else None)
    return cmd_refresh(args)


def cmd_add_regression(args) -> int:
    text = args.text.strip()
    intent = args.intent.strip()
    if not text:
        raise SystemExit("--text хоосон")
    for req in ("incident", "was", "why"):
        if not (getattr(args, req) or "").strip():
            raise SystemExit(f"--{req} ЗААВАЛ — «яагаад энэ мөр үүрд байх вэ» "
                             f"гэдгийг PR уншигч мэдэх ёстой (§9-ийн 2-р асуулт)")
    refuse_if_curated(text, intent)
    doc = load_partition_doc("regressions")
    refuse_if_duplicate(doc, text, intent)
    doc["rows"].append({
        "row_id": row_id(text, intent),
        "text": text,
        "intent": intent,
        "incident": args.incident.strip(),
        "first_seen": (args.first_seen or _dt.date.today().isoformat()).strip(),
        "was": args.was.strip(),
        "why": args.why.strip(),
        "added": _dt.date.today().isoformat(),
        "author": args.author or "",
    })
    write_json(partition_path("regressions"), stamp_ids(doc))
    print(f"РЕГРЕСС нэмэгдлээ → golden/regressions.json  {text!r}")
    print("  ⚠️ Энэ мөрийг ХЭЗЭЭ Ч хасахгүй.  `run_golden.py` дээр "
          "`regressions` нэг ч буруутай бол БҮХ загвар блоклогдоно.")
    args.version = today_version(
        read_json(MANIFEST_PATH).get("dataset_version") if MANIFEST_PATH.exists() else None)
    return cmd_refresh(args)


def cmd_recontract(args) -> int:
    """`PREPROCESS_CONTRACT` өөрчлөгдсөний дараах ЦОРЫН ГАНЦ зам."""
    prev = read_json(MANIFEST_PATH).get("preprocess_contract") if MANIFEST_PATH.exists() else None
    print("⚠️ RECONTRACT — БҮХ `row_id` дахин тооцогдоно.")
    print(f"   {prev!r} → {PREPROCESS_CONTRACT!r}")
    print("   ⚠️ Үүнийг ТУСДАА commit-оор оруул: golden-ийн АГУУЛГА "
          "өөрчлөгдөөгүй, зөвхөн ТАНИХ ТЭМДЭГ өөрчлөгдсөн гэдэг нь diff дээр "
          "ил байх ёстой.")
    args.version = today_version(None)
    return cmd_refresh(args)


def cmd_verify(args) -> int:
    return anl.check(verbose=True)


def cmd_import_probes(args) -> int:
    """НЭГ УДААГИЙН ШИЛЖИЛТ — `check_behavior.py`-ийн PROBES → golden.

    ⚠️ AST-аар уншина, ИМПОРТЛОХГҮЙ: `check_behavior.py` нь `check_parity`-г
    импортолдог ба тэр нь sklearn + бусад сессийн ажлаас хамаардаг.  Энд
    хэрэгтэй нь ганц ЖАГСААЛТ.
    """
    src = io.open(TRAINING / "check_behavior.py", encoding="utf-8").read()
    probes = None
    for n in ast.parse(src).body:
        tgt = None
        if isinstance(n, ast.AnnAssign):
            tgt = getattr(n.target, "id", "")
        elif isinstance(n, ast.Assign) and len(n.targets) == 1:
            tgt = getattr(n.targets[0], "id", "")
        if tgt == "PROBES":
            probes = ast.literal_eval(n.value)
            break
    if not probes:
        raise SystemExit("check_behavior.py-аас PROBES олдсонгүй")

    intents_doc = new_partition("intents")
    adv_doc = new_partition("adversarial")
    for text, intent, group in probes:
        row = {"row_id": row_id(text, intent), "text": text,
               "intent": intent, "group": group,
               "added": "2026-08-25", "author": "check_behavior.py"}
        intents_doc["rows"].append(row)
        if intent == "unknown":
            adv_doc["rows"].append(dict(row))

    write_json(partition_path("intents"), intents_doc)
    write_json(partition_path("adversarial"), adv_doc)
    print(f"PROBES шилжлээ: intents={len(intents_doc['rows'])}  "
          f"adversarial={len(adv_doc['rows'])}")
    args.version = args.version or today_version(None)
    return cmd_refresh(args)


def main() -> None:
    ap = argparse.ArgumentParser(description="Golden багцыг хөлдөөх/өргөтгөх")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add-regression", help="ТҮҮХЭН УНАЛТЫГ үүрд бүртгэх")
    p.add_argument("--text", required=True)
    p.add_argument("--intent", required=True)
    p.add_argument("--incident", required=True, help="ж: HN-1")
    p.add_argument("--was", required=True, help="ж: submit_progress@0.58")
    p.add_argument("--why", required=True)
    p.add_argument("--first-seen", default=None)
    p.add_argument("--author", default="")
    p.add_argument("--version", default=None)
    p.set_defaults(fn=cmd_add_regression)

    p = sub.add_parser("add", help="GOLDEN-EVAL-д мөр нэмэх")
    p.add_argument("--partition", required=True,
                   choices=["intents", "bim", "rules", "difficult_cases", "adversarial"])
    p.add_argument("--text", required=True)
    p.add_argument("--intent", required=True)
    p.add_argument("--group", default="")
    p.add_argument("--author", default="")
    p.add_argument("--version", default=None)
    p.set_defaults(fn=cmd_add)

    p = sub.add_parser("refresh", help="row_id + SHA-256 + exclude_row_ids дахин тооцох")
    p.add_argument("--version", default=None)
    p.set_defaults(fn=cmd_refresh)

    p = sub.add_parser("recontract", help="PREPROCESS_CONTRACT өөрчлөгдсөн үед")
    p.add_argument("--version", default=None)
    p.set_defaults(fn=cmd_recontract)

    p = sub.add_parser("verify", help="алдагдал + манифестын шалгалт")
    p.set_defaults(fn=cmd_verify)

    p = sub.add_parser("import-probes",
                       help="НЭГ УДААГИЙН: check_behavior.PROBES → golden")
    p.add_argument("--version", default=None)
    p.set_defaults(fn=cmd_import_probes)

    args = ap.parse_args()
    sys.exit(args.fn(args))


if __name__ == "__main__":
    main()
