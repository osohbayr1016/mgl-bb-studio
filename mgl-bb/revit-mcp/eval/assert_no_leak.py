r"""ГИШҮҮНЧЛЭЛИЙН БАТЛАМЖ (1B-5) — golden мөр СУРГАЛТЫН багцад ОРООГҮЙ эсэх.

Энэ файл бол `revit-mcp/eval/`-ийн ҮНДЭС.  Бусад бүх скрипт (`run_golden.py`,
`freeze.py`, `nominate.py`) болон сургалтын шугам үүнийг дуудна.

⚠️ ЯАГААД ЛАВЛАХ ӨӨРӨӨ ХАНГАЛТГҮЙ ВЭ
`training/data/`-аас гарах нь ердөө ГУРВАН glob-ыг тойрдог
(`pull_and_retrain.datasets()`, `check_behavior.training_texts()`,
`check_fold_parity.corpus()`).  Хэн нэгэн `--data ../eval/golden/intents.json`
гэж ГАРААР дамжуулбал юу ч зогсоохгүй.  Тиймээс хамгаалалт нь лавлах биш,
БАТЛАМЖ — энд бичсэн хоёр функц.  Тэдгээр нь СЭРЭМЖЛҮҮЛЭГ БИШ, УНАЛТ.

⚠️ МӨРИЙН ТАНИХ ТЭМДЭГ нь ТҮҮХИЙ ТЕКСТ БИШ.  `train_intent.clean_records()`
нь давхардлыг `(preprocess(text), intent)`-ээр хасдаг тул «ЦБУ-05 ыг 70 хувь
болголоо» ба «cbu 05 ig 70 huv bolgoloo» нь загварын хувьд ЯГ НЭГ мөр.
Түүхий текстээр батламж бичвэл golden мөрийг латинаар хөрвүүлээд сургалтад
чөлөөтэй оруулж болно — тэр нь train-on-test.

⚠️ `row_id` ба `preprocess`-ийг ЭНД ДАХИН БИЧИХГҮЙ.  Хоёулаа
`train_intent.py`-аас импортлогдоно (1B-4-ийн `row_id`, форматыг нь БҮҮ
ӨӨРЧИЛ).  Өөрийн хувилбар бичвэл гэрээ чимээгүй сална.

    ..\server\.venv\Scripts\python.exe assert_no_leak.py

⚠️ 2026-08-28 (A3).  Энэ файл БАЙСАН боловч `pull_and_retrain.py`-ийн
долоон хаалганы АЛЬ НЬ Ч түүнийг ДУУДДАГГҮЙ байв — өөрөөр хэлбэл батламж
бичигдсэн ч ХЭЗЭЭ Ч ажилладаггүй байсан.  Одоо `--data` аргумент нэмэгдсэн
бөгөөд шугам үүнийг 0-р ХААЛГА болгож дуудна:

    assert_no_leak.py --data <сургалтын файлууд…>

`--data` өгөгдвөл ХОЁР батламж НЭМЖ ажиллана:
  · `assert_paths_not_golden()` — `eval/golden/`-ийн файлыг ГАРААР
    дамжуулсныг барина (лавлахын хамгаалалт тойрогддог, §«Яагаад лавлах
    өөрөө хангалтгүй вэ»),
  · `assert_no_golden_rows()`   — дамжуулсан ФАЙЛУУДЫН мөрүүд дотор golden
    мөр байгаа эсэх (`row_id` + эвхсэн текст).
Дараа нь `check()` ердийнхөөрөө БҮХ `data/*.json`-ыг сканнердана.

⚠️ 2026-08-28 (A3-4) · КАРАНТИНЫ ГОРИМ — `--quarantine-out <зам>`.

    assert_no_leak.py --data <файлууд…> --quarantine-out q.json

Анхдагч зан төлөв нь ЗӨВ: алдагдал = УНАЛТ.  Гэвч ӨДӨР ТУТМЫН гогцоонд тэр
нь ГАНЦ ЗАМ байж болохгүй.  GOLDEN-EVAL-ын 83 мөрийн 79 нь ЖИРИЙН
хэрэглэгчийн өгүүлбэр («хуудсуудаа харул даа») тул нэг ажилтан Revit дотор
ижил өгүүлбэр бичихэд `production.json`-д тэр мөр орж, дараагийн шөнийн
гогцоо БҮХЭЛДЭЭ зогсоно — гэтэл эвдэрсэн зүйл нь ердөө НЭГ МӨР.

Тиймээс энэ горим нь МӨРИЙН гишүүнчлэлийг УНАЛТ БИШ, машин уншиж болох
ТАЙЛАН болгож өгнө; дуудагч (`pull_and_retrain.py --allow-leak`) зөрчсөн
мөрийг КАРАНТИНД тусгаарлаж, ХЭД хассанаа ЧАНГА хэвлээд үлдсэнээр
үргэлжилнэ.  ХОЁР зүйл ЭНЭ ГОРИМД Ч УНАНА:
  · golden ЗАМ сургалтад дамжсан   — өгөгдлийн биш, ДУУДАГЧИЙН алдаа
  · манифест эвдэрсэн              — батламж өөрөө утгагүй болсон
"""

from __future__ import annotations

import argparse
import hashlib
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
REPO = HERE.parent                      # revit-mcp/
TRAINING = REPO / "training"
DATA = TRAINING / "data"
GOLDEN = HERE / "golden"
MANIFEST_PATH = HERE / "manifest.json"

# 1B-4-ийн сургалтын датасетын бүртгэл.  Байхгүй байж БОЛНО (тэр сесс
# хараахан шипээгүй) — тэр үед `data/*.json` glob руу уначихна.
TRAIN_REGISTRY = TRAINING / "datasets.manifest.json"

# Зургаан хуваарь.  Дараалал нь тайлангийн дараалал.
PARTITIONS = ["intents", "bim", "rules", "difficult_cases", "regressions", "adversarial"]

if str(TRAINING) not in sys.path:
    sys.path.insert(0, str(TRAINING))

# ⚠️ ЭХ СУРВАЛЖ НЬ `train_intent.py`.  Энд хувилбар бичихийг ХОРИГЛОНО.
from train_intent import PREPROCESS_CONTRACT, preprocess, row_id  # noqa: E402


class LeakError(RuntimeError):
    """Golden мөр сургалтын багцад оржээ."""


# --------------------------------------------------------------------------
# Файл ба checksum
# --------------------------------------------------------------------------

def sha256_file(p: Path) -> str:
    """Файлын БАЙТ-ын sha256.  JSON-ыг дахин цэгцэлдэггүй — нэг тэмдэгт
    өөрчлөгдөхөд л таарахаа болих ёстой (`run_golden.py`-ийн шалгалт)."""
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def rel(p: Path) -> str:
    """Манифестад бичих зам — ҮРГЭЛЖ `revit-mcp/`-аас, POSIX зураасаар."""
    return p.resolve().relative_to(REPO).as_posix()


def read_json(p: Path):
    return json.loads(io.open(p, encoding="utf-8-sig").read())


# --------------------------------------------------------------------------
# Манифест ба golden хуваарь
# --------------------------------------------------------------------------

def load_manifest(path: Path | None = None) -> dict:
    p = path or MANIFEST_PATH
    if not p.exists():
        raise SystemExit(f"манифест олдсонгүй: {p}  (`freeze.py refresh` ажиллуул)")
    return read_json(p)


def partition_path(name: str) -> Path:
    return GOLDEN / f"{name}.json"


def partition_rows(name: str) -> list[dict]:
    """Нэг хуваарийн мөрүүд.  Файл байхгүй бол ХООСОН биш, УНАЛТ —
    хоосон хуваарь нь `"rows": []`-тэй ФАЙЛ байх ёстой (§3.4)."""
    p = partition_path(name)
    if not p.exists():
        raise SystemExit(f"хуваарийн файл дутуу: {rel(p)}")
    obj = read_json(p)
    rows = obj.get("rows")
    if not isinstance(rows, list):
        raise SystemExit(f"{rel(p)}: 'rows' массив алга")
    return rows


def golden_rows() -> dict[str, list[dict]]:
    return {name: partition_rows(name) for name in PARTITIONS}


def golden_row_ids() -> list[str]:
    """GOLDEN-EVAL ∪ GOLDEN-REGRESSION-ийн БҮХ `row_id`, давхардалгүй,
    эрэмбэлсэн.  `intents` ба `adversarial` 18 мөрөөр давхцдаг — тэр нь ЗӨВ
    (§3.2), тиймээс энд олонлог болгоно."""
    ids: set[str] = set()
    for rows in golden_rows().values():
        for r in rows:
            ids.add(row_id(r["text"], r["intent"]))
    return sorted(ids)


def golden_folded() -> dict[str, tuple[str, str]]:
    """эвхсэн текст → (хуваарь, санаа).  Санаанаас ҮЛ ХАМААРАХ шалгалтад."""
    out: dict[str, tuple[str, str]] = {}
    for name, rows in golden_rows().items():
        for r in rows:
            out.setdefault(preprocess(r["text"]), (name, r["intent"]))
    return out


# --------------------------------------------------------------------------
# CURATED-TRAIN
# --------------------------------------------------------------------------

def curated_files() -> list[Path]:
    """Сургалтад ОРОХ БОЛОМЖТОЙ файлууд.

    ⚠️ Санаатайгаар ХЭТ ӨРГӨН: 1B-4-ийн бүртгэл (`datasets.manifest.json`)
    БОЛОН `data/*.json` glob хоёрын НЭГДЭЛ.  Алдагдал хайхад хэт өргөн байх
    нь аюулгүй тал руугаа алдана — бүртгэлд ороогүй мөр ч бариулна.  Мөн
    `check_behavior.training_texts()` ба `check_fold_parity.corpus()` нь
    ӨНӨӨДӨР ч гэсэн ЖИНХЭНЭ glob хэвээр байгаа тул `data/`-д унасан ямар ч
    мөр бодит эрсдэл юм.

    ⚠️ Хасалт нь ЗӨВХӨН машин бичдэг тайлан (`report.json`,
    `report.prev.json` …) — тэдгээрт `rows` байхгүй тул ямар ч тохиолдолд
    хувь нэмэр оруулахгүй, зөвхөн жагсаалтыг бохирдуулна.
    """
    found: dict[Path, None] = {}
    for p in sorted(DATA.glob("*.json")):
        if p.name == "report.json" or p.name.startswith("report."):
            continue
        found[p.resolve()] = None
    if TRAIN_REGISTRY.exists():
        try:
            reg = read_json(TRAIN_REGISTRY)
            for d in reg.get("datasets") or []:
                name = str(d.get("file") or "").strip()
                if not name:
                    continue
                p = (DATA / name).resolve()
                if p.exists():
                    found[p] = None
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠️ {rel(TRAIN_REGISTRY)} уншигдсангүй ({e}) — зөвхөн glob",
                  file=sys.stderr)
    return sorted(found)


def curated_index() -> tuple[dict[str, str], dict[str, str], dict[str, int]]:
    """(эвхсэн текст → файл, row_id → файл, файл → хувь нэмэр оруулсан мөр).

    Гурав дахь буцаалт нь ТАЙЛАНД зориулагдсан: `data/`-д `rows`-гүй файл
    (ID жагсаалт, тайлан) хэвтэж байвал «0 мөр» гэж ил харагдана — тэр нь
    сургалтын багц гэж андуурагдах ёсгүй."""
    by_folded: dict[str, str] = {}
    by_rowid: dict[str, str] = {}
    counts: dict[str, int] = {}
    for f in curated_files():
        obj = read_json(f)
        rows = obj.get("rows") if isinstance(obj, dict) else obj
        n = 0
        if isinstance(rows, list):
            for r in rows:
                if not isinstance(r, dict):
                    continue
                text = (r.get("text") or "").strip()
                intent = (r.get("intent") or "").strip()
                if not text:
                    continue
                n += 1
                by_folded.setdefault(preprocess(text), f.name)
                if intent:
                    by_rowid.setdefault(row_id(text, intent), f.name)
        counts[f.name] = n
    return by_folded, by_rowid, counts


# --------------------------------------------------------------------------
# БАТЛАМЖ №1 — path
# --------------------------------------------------------------------------

def assert_paths_not_golden(paths) -> None:
    """`eval/golden/` доорх ямар ч файл сургалтад ОРОХГҮЙ.

    `train_intent.main()`-д `--data`-ийн дараа, `pull_and_retrain.datasets()`-д
    буцаахын өмнө дуудна.  Гараар дамжуулсан golden файлыг ЭНЭ барина.
    """
    bad = []
    for p in paths:
        try:
            rp = Path(p).resolve()
        except Exception:  # noqa: BLE001
            continue
        try:
            rp.relative_to(GOLDEN)
        except ValueError:
            continue
        bad.append(rp)
    if bad:
        print("❌ GOLDEN ФАЙЛЫГ СУРГАЛТАД ДАМЖУУЛЖЭЭ — BUILD УНАЛАА:",
              file=sys.stderr)
        for p in bad:
            print(f"     {p}", file=sys.stderr)
        print("   GOLDEN-EVAL нь ХӨЛДӨӨСӨН.  Сургалтын мөр нэмэх бол "
              "`training/data/`-д нэм.", file=sys.stderr)
        sys.exit(1)


# --------------------------------------------------------------------------
# БАТЛАМЖ №2 — мөрийн гишүүнчлэл
# --------------------------------------------------------------------------

def assert_no_golden_rows(rows, manifest: dict | None = None) -> None:
    """Сургалтын мөрүүд дотор golden мөр байвал УНАНА.

    ХОЁР шалгалт, хоёулаа ҮХЛИЙН:

      1. `row_id` огтлолцол — (эвхсэн текст + санаа) яг таарсан.  Манифестын
         `exclude_row_ids` нь тоологдох, тодорхой жагсаалт (§3.3).
      2. ЭВХСЭН ТЕКСТ огтлолцол — санаанаас ҮЛ ХАМААРАН.  `check_behavior.py`
         -ийн одоо байгаа leak guard яг үүнийг хийдэг: ижил текстийг ӨӨР
         шошготойгоор сургалтад оруулсан ч загвар тэр онцлогийн векторыг
         аль хэдийн ҮЗСЭН болно — тест ерөнхийлөлтийг хэмжихээ болино.
    """
    man = manifest if manifest is not None else load_manifest()
    excl = set(man.get("exclude_row_ids") or [])
    gold_folded = golden_folded()

    hits_id: list[tuple[str, str]] = []
    hits_fold: list[tuple[str, str, str]] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        text = (r.get("text") or "").strip()
        intent = (r.get("intent") or "").strip()
        if not text:
            continue
        if intent and row_id(text, intent) in excl:
            hits_id.append((row_id(text, intent), text))
        fold = preprocess(text)
        if fold in gold_folded:
            part, gi = gold_folded[fold]
            hits_fold.append((text, part, gi))

    if not hits_id and not hits_fold:
        return

    print("❌ GOLDEN МӨР СУРГАЛТЫН БАГЦАД ОРСОН — BUILD УНАЛАА:", file=sys.stderr)
    for rid, t in hits_id:
        print(f"     [row_id] {rid}  {t!r}", file=sys.stderr)
    for t, part, gi in hits_fold:
        print(f"     [эвхэлт] {t!r} ≡ golden/{part} ({gi})", file=sys.stderr)
    print("   ЗАСВАР: golden мөрийг СОЛЬ, сургалтын мөрийг БҮҮ ХАС.",
          file=sys.stderr)
    print("   (`freeze.py add-regression` нь давхцсан мөрийг ӨӨРӨӨ татгалзана.)",
          file=sys.stderr)
    sys.exit(1)


# --------------------------------------------------------------------------
# Манифестын бүрэн бүтэн байдал
# --------------------------------------------------------------------------

def scan_data_files(paths, manifest: dict | None = None) -> dict:
    """A3-4 · Файл ТУС БҮРЭЭР golden гишүүнчлэлийн оногдол.  УНАХГҮЙ — ТАЙЛАГНАНА.

    ⚠️ `assert_no_golden_rows()`-ЫН ХАРИЛЦАН АДИЛГҮЙ ХОС.  Тэр нь БҮХ мөрийг
    нэг сагсанд хийж `sys.exit(1)` хийдэг — «зогс» гэсэн хариулт.  Энэ нь
    ЯГ АЛЬ файлын ЯГ АЛЬ индекс дэх мөр зөрчсөнийг буцаана, ингэснээр
    дуудагч тэр мөрийг КАРАНТИНД тусгаарлаад үлдсэнээр үргэлжилж чадна.

    ⚠️ ИНДЕКС нь ФАЙЛЫН `rows` жагсаалтын ТҮҮХИЙ индекс.  `dict` биш мөрийг
    ч тоолж алгасна — өөрөөр хэлбэл индекс нь файл дахь байрлалыг ЯГ заана,
    эс бөгөөс карантин өөр мөр хасна.

    ⚠️ Илрүүлэлтийн ЛОГИК НЬ ЯГ ИЖИЛ (`row_id` + эвхсэн текст).  Энд хоёр
    дахь хувилбар бичихийг ХОРИГЛОНО — зөвхөн ГАРАЛТЫН хэлбэр өөр.
    """
    man = manifest if manifest is not None else load_manifest()
    excl = set(man.get("exclude_row_ids") or [])
    gold_folded = golden_folded()

    out: list[dict] = []
    total_hits = 0
    total_rows = 0
    for raw in paths:
        fp = Path(raw)
        if not fp.exists():
            raise SystemExit(f"--data: файл алга: {fp}")
        obj = read_json(fp)
        rows = obj.get("rows") if isinstance(obj, dict) else obj
        if not isinstance(rows, list):
            rows = []
        hits: list[dict] = []
        for i, r in enumerate(rows):
            if not isinstance(r, dict):
                continue
            text = (r.get("text") or "").strip()
            intent = (r.get("intent") or "").strip()
            if not text:
                continue
            kinds: list[str] = []
            part = gi = ""
            if intent and row_id(text, intent) in excl:
                kinds.append("row_id")
            fold = preprocess(text)
            if fold in gold_folded:
                kinds.append("эвхэлт")
                part, gi = gold_folded[fold]
            if not kinds:
                continue
            hits.append({"index": i, "text": text, "intent": intent,
                         "kind": "+".join(kinds),
                         "golden_partition": part, "golden_intent": gi})
        total_rows += len(rows)
        total_hits += len(hits)
        out.append({"file": str(fp), "name": fp.name,
                    "rows": len(rows), "hits": hits})
    return {"total_rows": total_rows, "total_hits": total_hits, "files": out}


def verify_contract(manifest: dict) -> list[str]:
    """`preprocess_contract` зөрвөл БҮХ `row_id` хүчингүй."""
    want = manifest.get("preprocess_contract")
    if want != PREPROCESS_CONTRACT:
        return [f"preprocess_contract зөрөв: манифест {want!r} ≠ "
                f"train_intent {PREPROCESS_CONTRACT!r} — `freeze.py recontract`"]
    return []


def verify_checksums(manifest: dict) -> list[str]:
    """Хуваарийн файл бүрийн SHA-256 манифесттэй таарч байна уу."""
    bad: list[str] = []
    g = manifest.get("golden") or {}
    for name in PARTITIONS:
        spec = g.get(name)
        if not spec:
            bad.append(f"манифестад `golden.{name}` алга")
            continue
        p = REPO / spec["file"]
        if not p.exists():
            bad.append(f"{spec['file']}: файл алга")
            continue
        actual = sha256_file(p)
        if actual != spec.get("sha256"):
            bad.append(f"{spec['file']}: SHA-256 ТААРСАНГҮЙ\n"
                       f"       манифест {spec.get('sha256')}\n"
                       f"       файл     {actual}")
            continue
        rows = partition_rows(name)
        if len(rows) != int(spec.get("rows") or 0):
            bad.append(f"{spec['file']}: мөрийн тоо зөрөв "
                       f"({len(rows)} ≠ {spec.get('rows')})")
    return bad


def verify_exclusions(manifest: dict) -> list[str]:
    have = set(manifest.get("exclude_row_ids") or [])
    want = set(golden_row_ids())
    bad: list[str] = []
    if have != want:
        missing = sorted(want - have)
        extra = sorted(have - want)
        if missing:
            bad.append(f"exclude_row_ids дутуу {len(missing)} id: {missing[:5]}…")
        if extra:
            bad.append(f"exclude_row_ids илүү {len(extra)} id: {extra[:5]}…")
    return bad


# --------------------------------------------------------------------------

def check(verbose: bool = True) -> int:
    man = load_manifest()
    problems: list[str] = []
    problems += verify_contract(man)
    problems += verify_checksums(man)
    problems += verify_exclusions(man)

    files = curated_files()
    by_folded, by_rowid, counts = curated_index()
    gold = golden_rows()
    n_gold = sum(len(v) for v in gold.values())
    ids = golden_row_ids()

    leaks: list[str] = []
    for name, rows in gold.items():
        for r in rows:
            fold = preprocess(r["text"])
            rid = row_id(r["text"], r["intent"])
            if rid in by_rowid:
                leaks.append(f"[row_id] golden/{name}  {r['text']!r} → "
                             f"data/{by_rowid[rid]}")
            elif fold in by_folded:
                leaks.append(f"[эвхэлт] golden/{name}  {r['text']!r} → "
                             f"data/{by_folded[fold]}")

    if verbose:
        print("ГИШҮҮНЧЛЭЛИЙН БАТЛАМЖ — GOLDEN ↔ CURATED-TRAIN")
        print(f"  гэрээ                {PREPROCESS_CONTRACT}")
        print(f"  датасетын хувилбар   {man.get('dataset_version')}")
        print(f"  CURATED-TRAIN файл   {len(files)}")
        for f in files:
            n = counts.get(f.name, 0)
            tag = "" if n else "   ⚠️ мөр алга — сургалтын багц БИШ"
            print(f"      • {f.name:26} {n:>5}{tag}")
        print(f"  CURATED эвхсэн мөр   {len(by_folded)}")
        print(f"  GOLDEN мөр (нийт)    {n_gold}  (өвөрмөц id {len(ids)})")
        for name in PARTITIONS:
            print(f"      {name:16} {len(gold[name]):>4}")
        print(f"  АЛДАГДАЛ             {len(leaks)}")

    if leaks:
        print("\n❌ АЛДАГДАЛ ИЛЭРЛЭЭ — golden мөр сургалтын багцад байна:",
              file=sys.stderr)
        for l in leaks:
            print(f"     {l}", file=sys.stderr)
        print("   ЗАСВАР: golden мөрийг СОЛЬ.  CURATED-TRAIN-аас мөр БҮҮ ХАС "
              "(§4).", file=sys.stderr)
    if problems:
        print("\n❌ МАНИФЕСТЫН БҮРЭН БҮТЭН БАЙДАЛ ЭВДЭРСЭН:", file=sys.stderr)
        for p in problems:
            print(f"     {p}", file=sys.stderr)

    if leaks or problems:
        return 1
    if verbose:
        print("\n✅ Алдагдал алга, манифест бүрэн бүтэн.")
    return 0


def rows_of(paths) -> list[dict]:
    """Дамжуулсан файлуудын БҮХ түүхий мөр.  `rows`-гүй файл (ID жагсаалт,
    тайлан) 0 мөр өгнө — уналт БИШ, тэдгээр нь сургалтын багц биш."""
    out: list[dict] = []
    for p in paths:
        fp = Path(p)
        if not fp.exists():
            raise SystemExit(f"--data: файл алга: {fp}")
        obj = read_json(fp)
        rows = obj.get("rows") if isinstance(obj, dict) else obj
        if isinstance(rows, list):
            out += [r for r in rows if isinstance(r, dict)]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(
        description="GOLDEN ↔ CURATED-TRAIN гишүүнчлэлийн батламж")
    ap.add_argument("--data", nargs="+", type=Path, default=None,
                    help="сургалтад дамжуулж буй файлууд (зам + мөрийн батламж)")
    ap.add_argument("--quiet", action="store_true", help="хураангуй хэвлэхгүй")
    # ⚠️ A3-4 · КАРАНТИНЫ ГОРИМ.  Мөрийн гишүүнчлэлийг УНАЛТ БИШ, ТАЙЛАН
    # болгож өгнө (JSON нь заасан зам руу бичигдэнэ).  ЗӨВХӨН мөрийн
    # гишүүнчлэл зөөлрөнө — golden ЗАМ дамжуулсан (дуудагчийн алдаа) ба
    # МАНИФЕСТ эвдэрсэн (батламж өөрөө утгагүй болсон) хоёр нь ХЭВЭЭР УНАНА.
    ap.add_argument("--quarantine-out", type=Path, default=None,
                    help="A3-4: алдагдсан мөрийн JSON тайлан бичих зам "
                         "(мөрийн гишүүнчлэл уналт БИШ болно)")
    args = ap.parse_args()

    if args.quarantine_out:
        assert_paths_not_golden(args.data or [])
        rep = scan_data_files(args.data or [], load_manifest())
        args.quarantine_out.write_text(
            json.dumps(rep, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8")
        if not args.quiet:
            print(f"КАРАНТИНЫ СКАН: {len(rep['files'])} файл · "
                  f"{rep['total_rows']} мөр · ОНОГДОЛ {rep['total_hits']}")
            for d in rep["files"]:
                if d["hits"]:
                    print(f"  • {d['name']:26} {len(d['hits']):>5} / {d['rows']}")
            print(f"  тайлан: {args.quarantine_out}")
        # ⚠️ Манифест эвдэрсэн бол карантин ч утгагүй — `exclude_row_ids`
        # дутуу байхад «оногдол алга» гэдэг нь ХУДАЛ ногоон гэрэл.
        man = load_manifest()
        bad = verify_contract(man) + verify_checksums(man) + verify_exclusions(man)
        if bad:
            print("\n❌ МАНИФЕСТЫН БҮРЭН БҮТЭН БАЙДАЛ ЭВДЭРСЭН "
                  "(карантин ч аврахгүй):", file=sys.stderr)
            for b in bad:
                print(f"     {b}", file=sys.stderr)
            sys.exit(3)
        sys.exit(0)

    if args.data:
        # ⚠️ ЭНЭ ХОЁР нь `sys.exit(1)` хийдэг — сэрэмжлүүлэг БИШ, УНАЛТ.
        assert_paths_not_golden(args.data)
        rows = rows_of(args.data)
        assert_no_golden_rows(rows, load_manifest())
        if not args.quiet:
            print(f"--data батламж: {len(args.data)} файл · {len(rows)} түүхий "
                  f"мөр — golden мөр АЛГА, golden ЗАМ АЛГА\n")

    sys.exit(check(verbose=not args.quiet))


if __name__ == "__main__":
    main()
