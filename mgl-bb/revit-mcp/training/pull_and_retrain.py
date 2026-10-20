r"""ӨДӨР ТУТМЫН ГОГЦОО — татах → сургах → ШАЛГАХ → нийтлэх.

Энэ бол «өөрөө өөрийгөө сургадаг» хэсгийн ГАР БАРИУЛ.  Хэрэглэгчид Revit
дотор сонголт дарж, 👎 дарж, залруулга өгдөг; тэр өгөгдөл сервер дээр
`assistant_examples` болж хуримтлагддаг.  Энэ скрипт түүнийг татаж аваад
дахин сургаж, ШАЛГАЛТУУДЫГ ДАВСАН тохиолдолд л нийтэлнэ.

    # зөвхөн локал өгөгдлөөр (сүлжээгүй)
    ..\..\server\.venv\Scripts\python.exe pull_and_retrain.py --offline

    # серверээс татаж, сургаад, шалгаад, нийтлэх
    ..\..\server\.venv\Scripts\python.exe pull_and_retrain.py ^
        --token %MGL_TOKEN% --publish --note "8-р сарын 25-ны залруулгууд"

⚠️ ЕС ХААЛГА — аль нэг нь унавал НИЙТЛЭХГҮЙ.  Эхнийх нь СУРГАЛТААС ӨМНӨ
(0-р), долоо нь сургалтын ДАРАА (1-7), сүүлийнх нь ухралтын хамгаалалт:
  0. `eval/assert_no_leak.py` — golden мөр сургалтын багцад ОРООГҮЙ эсэх
                               (татсаны ДАРАА, сургалтын ӨМНӨ — доор үз)
  1. `check_fold_parity.py`  — `textfold.py` ↔ `backend/src/lib/textFold.ts`
                               эвхэлт ЯГ ИЖИЛ үү  (`node` шаардана)
  2. `check_parity.py`   — C# ба Python ЯГ ИЖИЛ таамаглаж байна уу
  3. `check_behavior.py` — сургалтад БАЙХГҮЙ мөрүүд дээр зөв үү
  4. `check_slots.py`    — хуудасны шифр ба хувийг зөв гаргаж байна уу
  5. `check_lang.py`     — хэрэглэгчийн хэлээр хариулж байна уу
  6. `check_conversation.py` — слот бөглөлт, заалт, гацаанаас гарах
  7. `check_nudge.py`    — идэвхтэй сануулга ЧИМЭЭГҮЙ БАЙХ ЁСТОЙ тохиолдлууд
                           (`dotnet` шаардана)

⚠️ 0-Р ХААЛГА — ГИШҮҮНЧЛЭЛИЙН БАТЛАМЖ (`eval/assert_no_leak.py`).  Найм
дахь шалгалт боловч дугаараар нь 0 — учир нь СУРГАЛТААС ӨМНӨ, татсаны ДАРАА
ажилладаг.  2026-08-28 хүртэл `assert_no_leak.py` БАЙСАН ч түүнийг ЭНЭ ФАЙЛ
нэг ч удаа ДУУДДАГГҮЙ байв (A3).  Тиймээс анхны `--pull` нь D1-ээс бодит
хэрэглээний мөр татахад golden мөр `production.json`-д орж, дараагийн загвар
ӨӨРИЙН ШАЛГАЛТЫН ХАРИУЛТЫГ цээжилдэг байсан — `run_golden.py` 100% ногоон,
хэн ч мэдэхгүй.  Энэ бол GOLDEN-EVAL-ын БҮХ утгыг устгадаг чимээгүй эвдрэл.
Одоо алдагдал олдвол БҮХ дамжуулга ЗОГСОНО (алгасахгүй, сэрэмжлүүлэг биш).

⚠️ A3-4 (2026-08-28) · `--allow-leak` — КАРАНТИН.  Дээрх «БҮХ дамжуулга
ЗОГСОНО» нь ЗӨВ анхдагч боловч ГАНЦ зам байж болохгүй: GOLDEN-EVAL-ын 83
мөрийн 79 нь ЖИРИЙН хэрэглэгчийн өгүүлбэр («хуудсуудаа харул даа») тул нэг
ажилтан Revit дотор ижил өгүүлбэр бичихэд тэр мөр `production.json`-д орж,
ӨДӨР ТУТМЫН гогцоо БҮХЭЛДЭЭ зогсоно — эвдэрсэн зүйл нь ердөө НЭГ МӨР байхад.
`--allow-leak` нь зөрчсөн мөрийг КАРАНТИНД (түр хавтас дахь цэвэрлэсэн
хуулбар) тусгаарлаж, ХЭД хассанаа файл тус бүрээр БА нийтээр хэвлээд
үлдсэнээр үргэлжилнэ.  Эх файл ХӨНДӨГДӨХГҮЙ; бүрэн жагсаалт нь
`training/quarantine.report.json`-д үлдэнэ.  Карантин нь ЗАСВАР БИШ,
ХОЙШЛУУЛАЛТ — golden талыг нь `eval/freeze.py`-аар СОЛИХ ёстой хэвээр.
Golden ЗАМ дамжуулсан ба МАНИФЕСТ эвдэрсэн хоёр нь энэ горимд Ч ЗОГСОНО.

⚠️ ЕС ДЭХ ХААЛГА — УХРАЛТЫН ХАМГААЛАЛТ.  Шинэ загварын оноо өмнөхөөсөө
`--max-drop`-оос илүү буурвал НИЙТЛЭХГҮЙ.  Өөрөө сурдаг систем дэх хамгийн
том эрсдэл нь нэг өдрийн муу шошго бүх зүйлийг чимээгүй мууруулах явдал.
Хүн бүр өдөр бүр тоо харах боломжгүй тул машин нь өөрөө татгалзах ёстой.

⚠️ 1B-4 (2026-08-28).  Энэ хамгаалалт УРЬД НЬ `if not args.publish: return`-ЫН
ДООР байсан тул дээрх баримтжуулсан `--offline` урсгал түүнийг ХЭЗЭЭ Ч
ажиллуулдаггүй байв.  Одоо early-return-ЫН ДЭЭР бөгөөд ГУРВАН зүйл барина:
  · хөлдөөсөн багцын ерөнхий оноо   (`--max-drop`, анхдагч 0.02)
  · САНАА ТУС БҮРИЙН оноо           (`--max-drop-intent`, анхдагч 0.05)
  · хөлдөөсөн ID-ийн алдагдал       (`train_intent.py` дотор, >10% бол уна)
Офлайн үед харьцуулах суурь нь сервер БИШ, `data/report.prev.json`.

⚠️ A3/D5 (2026-08-28).  `report.prev.json`-ыг `train_intent.py` УНАЛТААС ҮЛ
ХАМААРАН эргүүлдэг байсан тул УНАСАН гүйлтийн тайлан дараагийн гүйлтийн
СУУРЬ болж, ухралт шат шатаар «хэвийн» болдог байв (ratchet).  Одоо
`train_intent.py`-д `--no-rotate-prev` өгч, суурийг ЭНД, БҮХ хаалга давж
ухралт илрээгүй тохиолдолд Л эргүүлнэ — өөрөөр хэлбэл суурь нь «сүүлийн
гүйлт» биш, «сүүлийн МЭДЭГДЭЖ БУЙ САЙН гүйлт».

⚠️ A3/P1 (2026-08-28).  `--publish` нь ГУРВАН нөхцөл хангагдаагүй бол
АЖИЛЛАХГҮЙ: (1) татах алхам ҮНЭХЭЭР амжилттай болсон (сүлжээ тасарсан ч
чимээгүй үргэлжилдэг байв), (2) серверийн суурь загвар уншигдсан,
(3) шинэ тайланд `frozen_accuracy` БАЙГАА бөгөөд ухралтын харьцуулалт
ҮНЭХЭЭР хийгдсэн (hold-out файл алга бол хамгаалалт байхгүйтэй адил).
Тиймээс `--offline --publish` нь ЗОРИУД боломжгүй.

⚠️ A3-1 / A3-2 / A3-3 (2026-08-28) — дээрх гурван хамгаалалт ХАГАС байв:
  · A3-1 РАТЧЕТ.  Суурь эргүүлэлт нь ЗӨВХӨН `problems`-ыг хардаг байсан;
    hold-out файл УСТВАЛ `problems = []` болж, ХЭМЖИГДЭЭГҮЙ тайлан суурийг
    ДАРЖ БИЧДЭГ байв ⇒ суурь БУЦААШГҮЙ АЛДАГДАНА.  Одоо `checked_frozen`
    заавал (эсвэл суурь ОГТ БАЙХГҮЙ бол эхний суурь тогтооно).
  · A3-2 `checked`.  «Хөлдөөсөн hold-out дээр хэмжигдсэн үү» гэдэг нь
    «сервер амьд байна уу» гэдгээр хариулагддаг байсан (ҮРГЭЛЖ True).
    Одоо `checked` (ямар нэгэн харьцуулалт) ба `checked_frozen` (хөлдөөсөн
    багц) ХОЁР ТУСДАА; хаалганууд ЗӨВХӨН хоёр дахийг хардаг.
  · A3-3 `--offline`.  Серверийн суурь уншихдаа `and not args.offline`
    БАЙХГҮЙ байсан тул `--offline` сүлжээ хөнддөг байв; мөн 401/5xx дээр
    `raise` хийж БОЛОВСРУУЛААГҮЙ traceback өгдөг байсан — тэр ч байтугай
    загварыг `addin/Resources/`-д БИЧСЭНИЙ ДАРАА.  Одоо ЗӨӨЛӨН унаж,
    `server_ok = False` нь `--publish`-ийг өөрөө хаана.

⚠️ 1B-4 · ДАТАСЕТЫН ALLOWLIST.  Сургалтад орох файлууд `datasets.manifest.json`-д
бүртгэгдсэн байх ЁСТОЙ.  Урьд нь `DATA.glob("*.json")` байсан тул `data/`-д
унасан ямар ч файл ЧИМЭЭГҮЙ сургалтад ордог байв.
"""

from __future__ import annotations

import argparse
import atexit
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
PY = sys.executable
MODEL = HERE.parent / "addin" / "Resources" / "intent-model.json"

# ⚠️ Энэ файлыг МАШИН БИЧНЭ — гараар бүү засварла, дараагийн татах үед
# дарагдана.  Гарын жишээ нэмэх бол `hard-negatives.json`-д нэм.
PROD = DATA / "production.json"

# ─── 1B-4 ───────────────────────────────────────────────────────────────
MANIFEST = HERE / "datasets.manifest.json"
REPORT = DATA / "report.json"
REPORT_PREV = DATA / "report.prev.json"

# ─── 1B-5 / A3 · ГИШҮҮНЧЛЭЛИЙН БАТЛАМЖ ──────────────────────────────────
EVAL = HERE.parent / "eval"
LEAK = EVAL / "assert_no_leak.py"
GOLDEN = EVAL / "run_golden.py"
# ⚠️ `run_golden.py`-ийн бичдэг оноо.  Сервер (0213 + `revit.ts`-ийн ГОЛ
#    ХААЛГА) энэ файлыг ЯГ ХЭВЭЭР нь `eval` талбарт хүлээж авна.
GOLDEN_RESULT = EVAL / "last_run.json"

# ⚠️ A3-4 · КАРАНТИНЫ ТАЙЛАН.  `data/`-аас ГАДНА байх ЁСТОЙ — `data/*.json`
# нь ГУРВАН glob-д (сургалт, `check_behavior`, `check_fold_parity`) ордог
# тул тэнд бичвэл тайлан өөрөө сургалтын багц шиг харагдана.
QUARANTINE_REPORT = HERE / "quarantine.report.json"

# ⚠️ `data/` доторх ӨГӨГДЛИЙН БУС .json файлууд.  Эдгээр нь манифестад
# бүртгэгдэхгүй бөгөөд «бүртгэгдээгүй файл» гэж тооцогдохгүй.
SKIP_JSON = {"report.json", "report.prev.json", "eval-holdout.ids.json"}


def api(host: str, token: str, path: str, payload: dict | None = None) -> dict:
    url = host.rstrip("/") + path
    data = None
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers,
                                 method="POST" if payload is not None else "GET")
    with urllib.request.urlopen(req, timeout=180) as res:
        return json.loads(res.read().decode("utf-8"))


def pull(host: str, token: str) -> int:
    print("Серверээс шошголсон жишээ татаж байна…")
    got = api(host, token, "/api/revit/assistant/export")
    rows = got.get("rows") or []
    clean = [
        {"text": r["text"], "intent": r["intent"],
         "style": r.get("style") or "",
         # ⚠️ 1B-4: `source` нь `assistant_examples.source`
         # (seed|usage|manual — `0195_assistant_learning.sql:47-48`).
         # 2026-08-28 хүртэл ЭНД ХАЯГДДАГ байсан тул курацлагдсан продакшн
         # мөр ба машин үүсгэсэн үр ялгагдахгүй болж, «энэ загварын хэдэн
         # хувь нь бодит хэрэглээнээс сурсан бэ» гэдэгт хариулах боломжгүй
         # байв.  Экспортын endpoint (revit.ts:1974-1981) багануудыг
         # БУЦААДАГ — зөвхөн энд хаягддаг байсан.
         "source": r.get("source") or "usage",
         # --- 2-6 · АЛХАМ 1: 0215-ын ИТГЭЛИЙН ТАКСОНОМИ ---
         # ⚠️ 2026-08-31 хүртэл ЭНД ХАЯГДДАГ байсан.  Экспортын endpoint
         #    (`GET /api/revit/assistant/export`) хоёуланг нь БУЦААДАГ;
         #    0215:9-11-ийн тэнцэх дүрэм
         #      eligible(row) = policy_allows(row.source_type)
         #                      AND row.review_state IN ('reviewed','verified')
         #    нь ЭНЭ ХОЁР ТАЛБАРГҮЙГЭЭР хэрэгжих БОЛОМЖГҮЙ байсан.
         # ⚠️ ХОЁР ТУСДАА ТЭНХЛЭГ, нэг багана болгож НИЙЛҮҮЛЖ БОЛОХГҮЙ
         #    (0215:3-8): нэг мөр AI_GENERATED БАС хүнээр баталгаажсан байж
         #    БОЛНО — тэр нь зөрчил БИШ.
         # ⚠️ ЭНД ШҮҮЛТ ТАВИХГҮЙ, ЗӨВХӨН ДАМЖУУЛНА.  Цөмийн бодлого
         #    (HUMAN_VERIFIED ∪ RULE_VERIFIED ∪ HUMAN_CORRECTED) нь өнөөдөр
         #    ТЭГ мөр өгнө (0215-ын backfill тэдгээрийг ХЭЗЭЭ Ч оноодоггүй),
         #    тиймээс одоо чангаруулбал дараагийн загвар `train_intent.py`-ийн
         #    «Жишээгүй санаа» SystemExit дээр ЗҮГЭЭР Л БАРИГДАХГҮЙ.
         "source_type": r.get("source_type") or "UNKNOWN",
         "review_state": r.get("review_state") or "pending",
         # --- 2-6 · АЛХАМ 2: БАГИЙН ХАМРАХ ХҮРЭЭ (миграц 0238) ---
         # ⚠️ None = КОМПАНИ ДАЯАР.  Багийг ТААМАГЛАХГҮЙ — сервер тал
         #    `assistant_logs.team_code`-оос (үндсэн багаас) ургуулдаг ба
         #    тодорхойлж чадаагүй бол NULL үлдээдэг.  Энд ямар нэг өгөгдмөл
         #    баг оноох нь бүх синтетик корпусыг нэг багийн нотолгоо болгоно.
         # ⚠️ ДАРААЛАЛ АЧАА ДААНА: эхлээд source_type/review_state, ДАРАА нь
         #    team.  Урвуулбал үхсэн хэмжээс дээр хоёр дахь үхсэн хэмжээс
         #    нийлүүлнэ.
         "team": r.get("team_code"),
         **({"slot": r["slot"]} if r.get("slot") else {})}
        for r in rows
        if (r.get("text") or "").strip() and (r.get("intent") or "").strip()
    ]
    PROD.write_text(
        json.dumps(
            {"_note": ("МАШИН БИЧСЭН — `pull_and_retrain.py` дарж бичдэг.  Гараар "
                       "бүү засварла.  Эх сурвалж: assistant_examples (is_active=1), "
                       "өөрөөр хэлбэл Revit дотор хүмүүсийн өгсөн залруулга."),
             "rows": clean},
            ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8")
    per = got.get("per_intent") or {}
    print(f"  {len(clean)} мөр → {PROD.name}")
    for k in sorted(per):
        print(f"    {k:18} {per[k]}")
    return len(clean)


def datasets() -> tuple[list[Path], list[dict]]:
    """1B-4 · Манифестээс ЗӨВХӨН бүртгэгдсэн датасетыг буцаана.

    ⚠️ ЭНЭ НЬ ALLOWLIST.  Урьд нь `DATA.glob("*.json")` байсан тул `data/`-д
    унасан ямар ч файл ЧИМЭЭГҮЙ сургалтад ордог байв — буруу шошготой мөрийг
    `clean()` `dropped_bad` болгож тоолоод үлдсэнийг нь сургадаг, хэн ч
    мэдэхгүй.

    ⚠️ ЖАГСААЛТЫН ДАРААЛАЛ хадгалагдана — `clean_records()`-ийн давхардал
    хасалт ЭХНИЙ хуулбарыг үлдээдэг тул манифестын дараалал нь эх сурвалжийн
    ТЭРГҮҮЛЭХ ЭРЭМБЭ болно (§4.4).  `sorted()` ХИЙХГҮЙ.
    """
    if not MANIFEST.exists():
        raise SystemExit(f"Манифест олдсонгүй: {MANIFEST}")
    spec = json.loads(MANIFEST.read_text(encoding="utf-8-sig"))
    entries: list[dict] = []
    files: list[Path] = []
    listed: set[str] = set()
    for d in spec.get("datasets") or []:
        p = DATA / d["file"]
        listed.add(d["file"])
        if not p.exists():
            if d.get("required"):
                raise SystemExit(f"Манифестад заасан датасет алга: {p}")
            continue
        got = hashlib.sha256(p.read_bytes()).hexdigest()
        want = d.get("sha256")
        if want and got != want:
            raise SystemExit(
                f"❌ {d['file']}: sha256 зөрүүтэй\n"
                f"   манифест: {want}\n   бодит   : {got}\n"
                f"   Файл өөрчлөгдсөн бол манифестын хэшийг ЗОРИУД шинэчил.")
        files.append(p)
        entries.append({**d, "sha256": got})

    # ⚠️ Бүртгэгдээгүй .json БАЙВАЛ УНА — чимээгүй алгасахгүй.
    stray = sorted(p.name for p in DATA.glob("*.json")
                   if p.name not in listed and p.name not in SKIP_JSON)
    if stray:
        raise SystemExit(
            "❌ Манифестад БҮРТГЭГДЭЭГҮЙ файл `data/`-д байна: " + ", ".join(stray) +
            "\n   Сургалтад оруулах бол datasets.manifest.json-д нэм; "
            "эс бөгөөс зөөж/устга.")
    if not files:
        raise SystemExit("Манифестад нэг ч датасет алга")
    return files, entries


def _quarantine(files: list[Path], entries: list[dict], rep: dict
                ) -> tuple[list[Path], list[dict], int]:
    """A3-4 · Зөрчсөн МӨРИЙГ хасаж, ЦЭВЭРЛЭСЭН ХУУЛБАРААР үргэлжлүүлнэ.

    ⚠️ ЭХ ФАЙЛ ХӨНДӨГДӨХГҮЙ.  Хуулбар нь ТҮР ХАВТАСТ үүсэж, процесс дуусахад
    устана.  `training/data/`-д бичвэл дараагийн гүйлт түүнийг «бүртгэгдээгүй
    файл» гэж уначих ба гурван glob-д ч орох байсан.

    ⚠️ «NO SILENT CAPS» — ХЭД мөр хассанаа файл тус бүрээр БА нийтээр ЗААВАЛ
    хэвлэнэ.  Хасалт нь ЧИМЭЭГҮЙ болмогцоо энэ горим нь `--allow-leak` биш,
    «алдагдлыг үл тоомсорлох» болж хувирна.
    """
    drop_by_file: dict[str, set[int]] = {
        d["file"]: {int(h["index"]) for h in d["hits"]} for d in rep["files"]}
    qdir = Path(tempfile.mkdtemp(prefix="mgl-quarantine-"))
    atexit.register(shutil.rmtree, qdir, True)

    new_files: list[Path] = []
    new_entries: list[dict] = []
    total = 0
    show = 12
    for f, e in zip(files, entries):
        drop = drop_by_file.get(str(f)) or set()
        if not drop:
            new_files.append(f)
            new_entries.append(e)
            continue
        obj = json.loads(io.open(f, encoding="utf-8-sig").read())
        rows = obj.get("rows") if isinstance(obj, dict) else obj
        rows = rows if isinstance(rows, list) else []
        kept = [r for k, r in enumerate(rows) if k not in drop]
        out = dict(obj) if isinstance(obj, dict) else {}
        out["rows"] = kept
        out["_quarantine"] = (
            f"A3-4: golden багцтай давхцсан {len(drop)} мөр ХАСАГДСАН "
            f"(эх файл {f.name} ХӨНДӨГДӨӨГҮЙ).")
        q = qdir / f.name
        q.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n",
                     encoding="utf-8")
        got = hashlib.sha256(q.read_bytes()).hexdigest()
        total += len(drop)
        print(f"      • {f.name:22} {len(drop):>4} мөр ХАСАВ  "
              f"({len(rows)} → {len(kept)})")
        # ⚠️ ЯГ АЛЬ өгүүлбэр хасагдсаныг хэвлэнэ — хүн golden талыг СОЛИХ уу,
        # мөрөө орхих уу гэдгийг ШИЙДЭХ ёстой.
        hits = next(d["hits"] for d in rep["files"] if d["file"] == str(f))
        for h in hits[:show]:
            print(f"          [{h['kind']}] {h['text']!r} "
                  f"→ golden/{h['golden_partition'] or '?'}")
        if len(hits) > show:
            print(f"          … ба бусад {len(hits) - show} мөр "
                  f"(бүрэн жагсаалт: {QUARANTINE_REPORT.name})")
        new_files.append(q)
        # ⚠️ Манифестын мета нь СУРГАЛТАД ОРСОН БАЙТ-ыг тайлагнах ёстой тул
        # хэшийг ЦЭВЭРЛЭСЭН хуулбараар СОЛИНО; эх хэшийг `source_sha256`-д
        # үлдээнэ, эс бөгөөс `report.json`-ы provenance ХУДАЛ болно.
        new_entries.append({**e, "sha256": got,
                            "source_sha256": e.get("sha256"),
                            "quarantined_rows": len(drop)})
    return new_files, new_entries, total


def leak_gate(files: list[Path], entries: list[dict], allow_leak: bool = False
              ) -> tuple[list[Path], list[dict], int]:
    """0-Р ХААЛГА (A3) — golden мөр CURATED-TRAIN-д ОРООГҮЙ эсэх.

    ⚠️ ТАТСАНЫ ДАРАА, СУРГАЛТААС ӨМНӨ ажиллана.  Дараалал нь ЧУХАЛ:
    `pull()` нь `production.json`-ыг ДАРЖ БИЧДЭГ тул түүнээс өмнө шалгасан
    юу ч утгагүй — яг тэр шинэ мөрүүд дотор golden мөр байж болно.

    ⚠️ Дэд процессоор дуудаж байна, ИМПОРТООР БИШ.  `assert_no_leak.py` нь
    `train_intent`-ийг импортлодог (sklearn) бөгөөд өөрөө `sys.exit(1)`
    хийдэг; дэд процесс нь гаралтын кодыг цэвэр өгч, импортын дараалал
    эвдрэхээс сэргийлнэ.  `--data` нь ХОЁР батламжийг зэрэг ажиллуулна:
    (а) `eval/golden/`-ийн файл сургалтад дамжсан уу (зам),
    (б) golden мөр өгөгдлийн файлд байгаа юу (`row_id` + эвхсэн текст).

    ⚠️ Файл нь ӨӨРӨӨ байхгүй бол ЭНЭ Ч БАС УНАЛТ.  «Байхгүй тул алгаслаа»
    гэдэг нь яг тэр чимээгүй ногоон гэрэл — A3 гэдэг нэрээр бүртгэгдсэн.

    ⚠️ A3-4 (2026-08-28) · `allow_leak` — ГОГЦОО ЗОГСООХГҮЙ ЗАМ.
    Анхдагч (`False`) нь ХЭВЭЭР: алдагдал = БҮХ дамжуулга ЗОГСОНО.  Гэвч
    GOLDEN-EVAL-ын 83 мөрийн 79 нь ЖИРИЙН хэрэглэгчийн өгүүлбэр тул нэг
    ажилтан Revit дотор «хуудсуудаа харул даа» гэж бичихэд тэр мөр
    `production.json`-д орж, ӨДӨР ТУТМЫН гогцоо БҮХЭЛДЭЭ зогсоно — эвдэрсэн
    зүйл нь ердөө НЭГ МӨР байхад.  `--allow-leak` нь зөрчсөн мөрийг
    КАРАНТИНД тусгаарлаж, тоог нь ЧАНГА хэвлээд үлдсэнээр үргэлжилнэ.

    Буцаалт: (сургалтад өгөх файлууд, тэдгээрийн мета, карантинд орсон мөр).
    """
    print("\n── 0-Р ХААЛГА · ГИШҮҮНЧЛЭЛИЙН БАТЛАМЖ " + "─" * 20, flush=True)
    if not LEAK.exists():
        raise SystemExit(
            f"\n❌ {LEAK} ОЛДСОНГҮЙ.\n"
            f"   GOLDEN-EVAL-ын алдагдлын хаалгагүйгээр сургалт ЯВУУЛАХГҮЙ — "
            f"шалгалтын хариултаа цээжилсэн загвар нь 100% ногоон харагддаг.")

    if not allow_leak:
        r = subprocess.run([PY, str(LEAK), "--data", *[str(f) for f in files]],
                           cwd=str(EVAL))
        if r.returncode != 0:
            raise SystemExit(
                "\n❌ АЛДАГДАЛ — GOLDEN мөр сургалтын багцад байна.  "
                "СУРГАЛТ ЯВАХГҮЙ.\n"
                "   ЗАСВАР: golden мөрийг СОЛЬ (`eval/freeze.py`), сургалтын "
                "мөрийг БҮҮ ХАС.\n"
                "   Хэрэв мөр нь `production.json`-оос ирсэн бол тэр нь бодит "
                "хэрэглэгчийн залруулга — golden талыг нь СОЛИХ нь зөв.\n"
                "   Гогцоог зогсоолгүй үргэлжлүүлэх бол `--allow-leak` "
                "(зөрчсөн мөр КАРАНТИНД орно, тоо нь ЗААВАЛ хэвлэгдэнэ).")
        print("   ✅ ДАВСАН  (ГИШҮҮНЧЛЭЛИЙН БАТЛАМЖ)")
        return files, entries, 0

    # ---- КАРАНТИНЫ ЗАМ (--allow-leak) ---------------------------------
    r = subprocess.run([PY, str(LEAK), "--data", *[str(f) for f in files],
                        "--quarantine-out", str(QUARANTINE_REPORT)],
                       cwd=str(EVAL))
    if r.returncode != 0:
        # ⚠️ КАРАНТИН ЧАДАХГҮЙ ХОЁР ТОХИОЛДОЛ: golden ЗАМ дамжуулсан
        # (дуудагчийн алдаа) ба МАНИФЕСТ эвдэрсэн (батламж өөрөө утгагүй).
        # Хоёулаа мөр хасаад засагдахгүй тул ХЭВЭЭР ЗОГСОНО.
        raise SystemExit(
            "\n❌ КАРАНТИН ГОРИМД Ч ЗОГСОНО — golden ЗАМ сургалтад дамжсан "
            "эсвэл манифест эвдэрсэн.\n"
            "   Эдгээр нь ӨГӨГДЛИЙН биш, ТОХИРГООНЫ алдаа: мөр тусгаарлаад "
            "засагдахгүй.")
    try:
        rep = json.loads(io.open(QUARANTINE_REPORT, encoding="utf-8").read())
    except Exception as e:  # noqa: BLE001
        raise SystemExit(f"\n❌ карантины тайлан уншигдсангүй ({e})")

    total = int(rep.get("total_hits") or 0)
    if total == 0:
        print("   ✅ ДАВСАН  (ГИШҮҮНЧЛЭЛИЙН БАТЛАМЖ · карантин хэрэггүй)")
        return files, entries, 0

    print(f"\n   ⚠️ КАРАНТИН — {total} мөр golden багцтай давхцлаа.  "
          f"Тэдгээрийг СУРГАЛТААС ХАСААД үлдсэнээр үргэлжилнэ:")
    files, entries, dropped = _quarantine(files, entries, rep)
    print(f"   ⚠️ НИЙТ КАРАНТИНД ОРСОН МӨР: {dropped} "
          f"({rep.get('total_rows')} мөрөөс).  Тайлан: {QUARANTINE_REPORT}")
    print("   ⚠️ ЭНЭ НЬ ЗАСВАР БИШ, ХОЙШЛУУЛАЛТ.  Golden талыг нь СОЛЬ "
          "(`eval/freeze.py`) — эс бөгөөс тэр мөрүүд ХЭЗЭЭ Ч сурагдахгүй.")
    return files, entries, dropped


def rotate_prev() -> None:
    """A3/D5 · `report.json` → `report.prev.json`.

    ⚠️ ЗӨВХӨН БҮХ хаалга давж, ухралт илрээгүй үед дуудагдана.  Эс бөгөөс
    муу гүйлт өөрөө суурь болж, дараагийн адилхан муу гүйлт «ухралтгүй» гэж
    тооцогдоно (ratchet) — өөрөө сурдаг систем дэх хамгийн чимээгүй эвдрэл.
    """
    if not REPORT.exists():
        return
    REPORT_PREV.write_text(REPORT.read_text(encoding="utf-8-sig"),
                           encoding="utf-8")
    print(f"   суурь шинэчлэв: {REPORT_PREV.name} ← {REPORT.name}")


def local_baseline() -> dict | None:
    """1B-4 · Офлайн харьцуулалтын суурь — `data/report.prev.json`."""
    if not REPORT_PREV.exists():
        return None
    try:
        return json.loads(REPORT_PREV.read_text(encoding="utf-8-sig"))
    except Exception as e:  # noqa: BLE001
        print(f"   ⚠️ report.prev.json уншигдсангүй ({e})", file=sys.stderr)
        return None


def regression_problems(base: dict | None, report: dict, max_drop: float,
                        max_drop_intent: float, label: str,
                        key: str = "frozen_accuracy",
                        per_key: str = "frozen_per_intent",
                        min_rows: int = 20) -> list[str]:
    """1B-4 · Ухралтын шалгалт.  Асуудлын ЖАГСААЛТ буцаана (хоосон = цэвэр).

    ⚠️ Сервер ба локал суурь нь ӨӨР талбартай.  `GET /assistant/model`
    (revit.ts:1770) нь ЗӨВХӨН `accuracy` (CV-ийн тоо) буцаана — `per_intent`
    ч, `frozen_accuracy` ч БАЙХГҮЙ.  Тиймээс дуудагч нь сервертэй
    `accuracy ↔ accuracy`, локал `report.prev.json`-той
    `frozen_accuracy ↔ frozen_accuracy` гэж ХОЁР УДАА дуудна.

    `min_rows` — санаа тус бүрийн шалгалт нь тухайн ангид ХАНГАЛТТАЙ мөр
    байгаа үед л ажиллана; жижиг ангид нэг мөрийн алдаа = том хувь.
    """
    if not base:
        return []
    problems: list[str] = []
    old = base.get(key)
    new = report.get(key)
    if old is not None and new is not None:
        if float(new) < float(old) - max_drop:
            problems.append(
                f"{label} {key}: {float(old):.4f} → {float(new):.4f} "
                f"({max_drop:.2f}-оос их бууралт)")
        else:
            print(f"   {label} {key}: {float(old):.4f} → {float(new):.4f}  ✅")

    # ⚠️ Санаа тус бүрийн ухралт.  Ганц санаа сүйрч (жишээ нь `unknown`
    # 0.99 → 0.60) ерөнхий тоо босгын ДООР хөдлөх нь бүрэн боломжтой —
    # `unknown` бол «үйлдэл бүү хий» гэсэн ХАМГИЙН АЮУЛГҮЙ ангилал тул
    # түүний сүйрэл нь хамгийн аюултай ухралт.
    ob = base.get(per_key) or {}
    nb = report.get(per_key) or {}
    counts = report.get("frozen_counts") or {}
    for intent in sorted(set(ob) & set(nb)):
        if counts and int(counts.get(intent, 0)) < min_rows:
            continue
        if float(nb[intent]) < float(ob[intent]) - max_drop_intent:
            problems.append(
                f"{label} {per_key}[{intent}]: {float(ob[intent]):.3f} → "
                f"{float(nb[intent]):.3f} ({max_drop_intent:.2f}-оос их бууралт)")
    return problems


def run(label: str, argv: list[str]) -> bool:
    print(f"\n── {label} " + "─" * max(0, 56 - len(label)))
    r = subprocess.run(argv, cwd=str(HERE))
    ok = r.returncode == 0
    print(f"   {'✅ ДАВСАН' if ok else '❌ УНАСАН'}  ({label})")
    return ok


def main() -> None:
    ap = argparse.ArgumentParser(description="Өдөр тутмын дахин сургалтын гогцоо")
    # ⚠️ КОМПАНИЙН Cloudflare данс дахь worker.  Хуучин хувийн данс дээрх
    # `anandoctane4.workers.dev` нь 2026-08-24-ний шилжилтээр орхигдсон.
    ap.add_argument("--host",
                    default="https://mgl-progress-api.mglenc-design.workers.dev")
    ap.add_argument("--token", default=None, help="эсвэл MGL_TOKEN орчны хувьсагч")
    ap.add_argument("--offline", action="store_true", help="серверээс татахгүй")
    ap.add_argument("--publish", action="store_true", help="амжилттай бол сервер рүү илгээх")
    ap.add_argument("--note", default="", help="загварын тэмдэглэл")
    ap.add_argument("--max-drop", type=float, default=0.02,
                    help="одоогийн загвараас хэр буухыг зөвшөөрөх (анхдагч 2%%)")
    # ⚠️ 1B-4: санаа тус бүрийн босго.  Хэт хатуу бол хаалга байнга унана;
    # хэт зөөлөн бол `unknown` сүйрэхийг барихгүй.
    ap.add_argument("--max-drop-intent", type=float, default=0.05,
                    help="САНАА ТУС БҮРД хэр буухыг зөвшөөрөх (анхдагч 5%%)")
    # ⚠️ A3-4: анхдагч нь ХЭВЭЭР ХАТУУ (алдагдал = зогсолт).  Энэ туг нь
    # ЗӨВХӨН зогсолтыг КАРАНТИН болгож сольдог — алдагдлыг ҮЛ ТООМСОРЛОДОГГҮЙ.
    ap.add_argument("--allow-leak", action="store_true",
                    help="A3-4: golden-тай давхцсан мөрийг КАРАНТИНД хасаад "
                         "гогцоог үргэлжлүүлэх (хассан тоо ЗААВАЛ хэвлэгдэнэ)")
    args = ap.parse_args()

    token = args.token or os.environ.get("MGL_TOKEN") or ""
    if not args.offline and not token:
        raise SystemExit("Токен алга: --token эсвэл MGL_TOKEN тавина уу (эсвэл --offline)")
    # ⚠️ 1B-4: `--offline --publish` хоёуланг токенгүйгээр өгөхөд урьд нь
    # `Bearer ` (хоосон) илгээгээд 401 → `HTTPError` traceback-аар унадаг
    # байв.  Одоо ЭХЛЭХЭЭС ӨМНӨ ойлгомжтой мессежээр зогсоно.
    if args.publish and not token:
        raise SystemExit(
            "❌ --publish өгсөн атлаа токен алга.  Нийтлэхийн тулд admin токен "
            "ЗААВАЛ хэрэгтэй: --token эсвэл MGL_TOKEN.\n"
            "   (Зөвхөн сургаж шалгах бол --publish-гүйгээр ажиллуул.)")
    # ⚠️ A3/P1-1: `--offline --publish` нь «серверээс юу ч таталгүйгээр
    # серверт нийтэл» гэсэн үг — хамгийн сүүлийн залруулгуудыг ХАРАЛГҮЙ.
    if args.publish and args.offline:
        raise SystemExit(
            "❌ --offline ба --publish хамт өгөх боломжгүй.\n"
            "   Нийтлэх нь татсан өгөгдөл дээр сургасан гэдгийг БАТЛАХ ёстой; "
            "офлайн үед тэр баталгаа БАЙХГҮЙ.")

    # --- 1. Татах -------------------------------------------------------
    # ⚠️ A3/P1-1: татах алдаа нь ЗӨВХӨН СЭРЭМЖЛҮҮЛЭГ хэвээр (локал сургалт
    # утга ХЭВЭЭР), ГЭХДЭЭ `pull_ok` нь `--publish`-ийн ЗААВАЛ нөхцөл болно.
    # Сүлжээ тасарсныг мэдэлгүй нийтлэх нь хамгийн чимээгүй эвдрэл байв.
    pull_ok = False
    pull_error = "--offline"
    if not args.offline:
        try:
            pull(args.host, token)
            pull_ok = True
            pull_error = ""
        except urllib.error.HTTPError as e:
            pull_error = f"HTTP {e.code}"
            print(f"  ⚠️  татаж чадсангүй ({e.code}) — локал өгөгдлөөр үргэлжилнэ",
                  file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            pull_error = str(e)
            print(f"  ⚠️  татаж чадсангүй ({e}) — локал өгөгдлөөр үргэлжилнэ", file=sys.stderr)

    files, entries = datasets()
    print("\nСургалтын файлууд (datasets.manifest.json):")
    for e in entries:
        print(f"  • {e['file']:22} source={e.get('source') or '(мөр тус бүрд)'}"
              f"  sha256={e['sha256'][:12]}…")

    # --- 1.5 · 0-Р ХААЛГА (A3) ------------------------------------------
    # ⚠️ БАЙРЛАЛ ХАТУУ: `pull()`-ийн ДАРАА (шинэ `production.json`-ыг харах
    # ёстой), `train_intent.py`-ийн ӨМНӨ (нэг ч golden мөр жин рүү орохгүй).
    files, entries, quarantined = leak_gate(files, entries, args.allow_leak)

    # ⚠️ 1B-4: манифестын мета `train_intent.py`-д ТҮР ФАЙЛААР дамжина
    # (командын мөр хязгаараас зайлсхийхийн тулд).  Репод үлдэхгүй.
    meta_fd, meta_path = tempfile.mkstemp(suffix=".json", prefix="mgl-ds-meta-")
    os.close(meta_fd)
    Path(meta_path).write_text(json.dumps({"datasets": entries}, ensure_ascii=False),
                               encoding="utf-8")
    try:
        # --- 2. Сургах --------------------------------------------------
        # ⚠️ `--report` нь ЗААВАЛ — өгөхгүй бол тайлан бичигдэхгүй бөгөөд
        # ухралтын шалгалт хуучин тоо уншина.
        # ⚠️ A3/D5: `--no-rotate-prev` — суурийг ЭНД, хаалганы ДАРАА эргүүлнэ.
        if not run("СУРГАЛТ", [PY, "train_intent.py", "--data", *[str(f) for f in files],
                               "--out", str(MODEL), "--report", str(REPORT),
                               "--manifest-meta", meta_path, "--no-rotate-prev"]):
            raise SystemExit("Сургалт унасан — цааш явахгүй")
    finally:
        try:
            os.unlink(meta_path)
        except OSError:
            pass

    report = json.loads(io.open(REPORT, encoding="utf-8").read())
    acc = float(report.get("accuracy") or 0.0)
    ver = str(report.get("version") or "")
    n = int(report.get("examples") or 0)
    frozen = report.get("frozen_accuracy")
    src = report.get("source_counts") or {}
    ds_hash = str(report.get("dataset_sha256") or "")
    print(f"\n   хувилбар {ver} · {n} жишээ · нарийвчлал {acc:.4f}")
    print("   эх сурвалж: " + " · ".join(f"{k} {v}" for k, v in sorted(src.items())))
    if frozen is not None:
        print(f"   хөлдөөсөн багц: {float(frozen):.4f} "
              f"(n={report.get('frozen_n')}, алдагдсан ID {report.get('frozen_missing_ids')})")

    # --- 3. 1-7 ДУГААР хаалга (0-р нь сургалтаас ӨМНӨ явсан) ------------
    gates = [
        # ⚠️ 1B-4: Эвхэлтийн тулгалт ЭХЭНД.  `textfold.py` ↔
        # `backend/src/lib/textFold.ts` зөрвөл `check_parity.py`
        # (C# ↔ Python) ч утгагүй болно — гурван хослолын нэг нь тасарсан
        # гэсэн үг.  `node` шаардана (нэмэлт суулгалт ХЭРЭГГҮЙ).
        ("ЭВХЭЛТ (Python ↔ TypeScript)", [PY, "check_fold_parity.py"]),
        ("ТУЛГАЛТ (C# ↔ Python)", [PY, "check_parity.py", "--data",
                                   *[str(f) for f in files], "--model", str(MODEL)]),
        ("ЗАН ТӨЛӨВ (танихгүй текст)", [PY, "check_behavior.py"]),
        ("СЛОТ (хуудас ба хувь)", [PY, "check_slots.py"]),
        ("ХАРИУЛТЫН ХЭЛ", [PY, "check_lang.py"]),
        ("ЯРИА ХЭЛЦЛИЙН ТӨЛӨВ", [PY, "check_conversation.py"]),
        # ⚠️ 1B-4: `addin/Nudges.cs`-ийн ЦЭВЭР ФУНКЦ давхарга.  Ихэнх
        # тохиолдол нь «ЧИМЭЭГҮЙ БАЙХ ЁСТОЙ» — уйтгартай сануулга нь хүнийг
        # add-in-ыг бүхэлд нь унтраахад хүргэдэг.  `dotnet` шаардана.
        ("ИДЭВХТЭЙ САНУУЛГА", [PY, "check_nudge.py"]),
    ]
    failed = [label for label, argv in gates if not run(label, argv)]
    if failed:
        raise SystemExit("\n❌ ХААЛГА УНАСАН: " + ", ".join(failed) + " — НИЙТЛЭХГҮЙ")

    # --- 8 ДУГААР хаалга · GOLDEN багц (ХӨЛДӨӨСӨН) ---------------------
    # ⚠️ 2026-08-28 хүртэл `run_golden.py` нь ЗӨВХӨН ГАРААР ажилладаг байв:
    #    `gates`-д ч байгаагүй, бичсэн оноо нь серверт ч илгээгддэггүй.
    #    Өөрөөр хэлбэл GOLDEN-EVAL нь юуг ч БЛОКЛОДОГГҮЙ чимэглэл байсан —
    #    «сайжирлаа» гэсэн мэдэгдлийг зогсоох механизм БАЙХГҮЙ.
    # ⚠️ `cwd` нь ЗААВАЛ `EVAL` (`run()` нь `HERE`-д ажилладаг тул түүнийг
    #    ашиглаж БОЛОХГҮЙ) — 0-р хаалганы хэв маягтай ижил.
    if not GOLDEN.exists():
        raise SystemExit(
            f"\n❌ {GOLDEN} ОЛДСОНГҮЙ.\n"
            f"   GOLDEN-EVAL-гүйгээр загвар НИЙТЛЭХГҮЙ — ухралтыг барих\n"
            f"   цорын ганц хөлдөөсөн хэмжүүр тэр.")
    print("\n── 8-Р ХААЛГА · GOLDEN БАГЦ " + "─" * 30, flush=True)
    if subprocess.run([PY, str(GOLDEN), "--kind", "intent"],
                      cwd=str(EVAL)).returncode != 0:
        raise SystemExit(
            "\n❌ GOLDEN БАГЦ УНАСАН — НИЙТЛЭХГҮЙ.\n"
            "   Хөлдөөсөн багц нь МЭДЭГДЭЖ БУЙ түүхэн уналтуудыг барина;\n"
            "   түүнийг давахгүй загвар нь нэг талбарт сайжираад нөгөөд нь\n"
            "   ухарсан гэсэн үг.")
    print("   ✅ ДАВСАН  (GOLDEN БАГЦ)")

    print("\n✅ Бүх хаалга давлаа.")

    # --- 4. Ухралтын хамгаалалт ----------------------------------------
    # ⚠️ 1B-4: ЭНЭ БЛОК `if not args.publish: return`-ЫН ДЭЭР БАЙХ ЁСТОЙ.
    # 2026-08-28 хүртэл доор нь байсан тул docstring-д баримтжуулсан
    # `--offline` урсгал ХЭЗЭЭ Ч энэ хаалгыг ажиллуулдаггүй байв.
    print("\n── УХРАЛТЫН ХАМГААЛАЛТ " + "─" * 34)
    problems: list[str] = []
    # ⚠️ A3-2 (2026-08-28) · ХОЁР ӨӨР АСУУЛТ ⇒ ХОЁР ӨӨР ХУВЬСАГЧ.
    #   `checked`        — ЯМАР НЭГЭН харьцуулалт болсон уу?
    #   `checked_frozen` — ХӨЛДӨӨСӨН hold-out дээр ҮНЭХЭЭР хэмжигдсэн үү?
    # Урьд нь ганц `checked` байсан бөгөөд сервер `accuracy` буцаамагц
    # `checked = True` болдог байв — өөрөөр хэлбэл «хөлдөөсөн багц дээр
    # хэмжигдсэн үү» гэдэг асуулт «сервер амьд байна уу» гэдгээр
    # хариулагддаг, ҮРГЭЛЖ True.  Сервер нь ЗӨВХӨН CV-ийн `accuracy`
    # буцаадаг (revit.ts:1770) бөгөөд тэр нь ӨӨР өгөгдлийн багц дээр
    # тооцогдсон тул хөлдөөсөн багцын оронд ХЭЗЭЭ Ч зогсож чадахгүй.
    # Суурь эргүүлэлт (A3-1) ба `--publish` нь ЗӨВХӨН `checked_frozen`-ыг
    # хардаг; `checked` нь ЗӨВХӨН хүнд зориулсан тайлангийн текст.
    checked = False
    checked_frozen = False
    new_frozen = report.get("frozen_accuracy")
    new_acc = report.get("accuracy")

    # ⚠️ A3/P1-1: серверийн суурийг УНШИЖ ЧАДСАН эсэх нь `--publish`-ийн
    # заавал нөхцөл.  404 (загвар алга) нь ТОДОРХОЙ хариулт тул амжилт;
    # сүлжээ тасрах / 5xx нь ТОДОРХОЙГҮЙ тул амжилт БИШ.
    server_ok = False
    cur: dict | None = None
    # ⚠️ A3-3 (2026-08-28): `and not args.offline` нь ЭНД БАЙХГҮЙ байв.
    # `--offline` бол «СҮЛЖЭЭ ХӨНДӨХГҮЙ» гэсэн ГЭРЭЭ (docstring), гэтэл
    # `MGL_TOKEN` орчинд байхад скрипт офлайн гэж хэлсэн ч сервер рүү
    # залгадаг байсан — яг тэр гэрээ хэрэгтэй үед (сүлжээгүй, VPN-гүй)
    # 180 секунд гацаад унана.
    if token and not args.offline:
        try:
            cur = api(args.host, token, "/api/revit/assistant/model")
            server_ok = True
        except urllib.error.HTTPError as e:
            if e.code == 404:
                # 404 = «идэвхтэй загвар алга» — ТОДОРХОЙ хариулт тул амжилт.
                cur = None
                server_ok = True
                print("   (идэвхтэй загвар алга — анхны нийтлэлт)")
            else:
                # ⚠️ A3-3: урьд нь `raise` байсан.  401 (токен хүчингүй) ба
                # 5xx нь БОЛОВСРУУЛААГҮЙ traceback өгдөг байв — тэр ч
                # байтугай загварыг `addin/Resources/intent-model.json`-д
                # АЛЬ ХЭДИЙН БИЧСЭНИЙ ДАРАА.  Хэрэглэгч «сургалт уналаа» гэж
                # ойлгоод локал жин нь СОЛИГДСОНЫГ мэдэхгүй үлддэг.  Одоо
                # ЗӨӨЛӨН унаж, `server_ok = False` нь `--publish`-ийг
                # ӨӨРӨӨ хаана (4c).
                cur = None
                print(f"   ⚠️ серверийн суурь уншигдсангүй (HTTP {e.code}) — "
                      f"харьцуулалтгүй үргэлжилнэ", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            cur = None
            print(f"   ⚠️ серверийн шалгалт алгаслаа ({e})", file=sys.stderr)
    elif args.offline:
        print("   (--offline — сүлжээ ХӨНДӨӨГҮЙ, серверийн суурь уншаагүй)")

    if cur:
        # ⚠️ Сервер ЗӨВХӨН `accuracy`-г буцаана (revit.ts:1770) — тэр нь
        # CV-ийн тоо, ӨӨР өгөгдлийн багц дээр тооцогдсон.  Цэвэр
        # харьцуулалт биш ч байгаа зүйл — ГЭХДЭЭ `checked_frozen`-д
        # ХУВЬ НЭМЭР ОРУУЛАХГҮЙ (A3-2).
        problems += regression_problems(cur, report, args.max_drop,
                                        args.max_drop_intent, "сервер",
                                        key="accuracy", per_key="per_intent")
        # ⚠️ ХОЁР ТАЛ байж байж харьцуулалт болно.
        checked = checked or (cur.get("accuracy") is not None
                              and new_acc is not None)

    # ⚠️ Локал суурь нь ЧАНАРТАЙ харьцуулалт: `frozen_accuracy ↔
    # frozen_accuracy` — ЯГ ИЖИЛ хөлдөөсөн мөрүүд дээр оноогдсон.
    base = local_baseline()
    if base:
        problems += regression_problems(base, report, args.max_drop,
                                        args.max_drop_intent, "локал")
        if base.get("frozen_accuracy") is None:
            # ⚠️ 1B-4-ээс ӨМНӨХ тайланд `frozen_accuracy` БАЙХГҮЙ — тэр үед
            # ЮУ Ч харьцуулагдаагүй.  «✅» гэж хэлэх нь ХУДАЛ болно.
            print("   ⚠️ өмнөх тайлан 1B-4-ээс өмнөх бүтэцтэй "
                  "(frozen_accuracy алга) — хөлдөөсөн багцын харьцуулалт "
                  "ДАРААГИЙН ажиллуулалтаас эхэлнэ")
        elif new_frozen is None:
            # ⚠️ A3/P1-2: ШИНЭ тайланд хөлдөөсөн оноо алга — `eval-holdout.
            # ids.json` устсан эсвэл багц хэт жижиг болсон.  Суурь байсан ч
            # ХАРЬЦУУЛАХ ЮМ БАЙХГҮЙ; хамгаалалт байхгүйтэй адил.
            print("   ⚠️ ШИНЭ тайланд `frozen_accuracy` АЛГА — hold-out "
                  "(`data/eval-holdout.ids.json`) алга эсвэл хэт жижиг.  "
                  "ХӨЛДӨӨСӨН БАГЦЫН ХАРЬЦУУЛАЛТ ХИЙГДСЭНГҮЙ.", file=sys.stderr)
        else:
            # ⚠️ A3-2: ЗӨВХӨН ЭНД — хоёр талын `frozen_accuracy` хоёулаа
            # байж, ЯГ ИЖИЛ хөлдөөсөн мөрүүд дээр оноогдсон үед л.
            checked = True
            checked_frozen = True
    else:
        print("   ⚠️ локал суурь (`data/report.prev.json`) АЛГА — хөлдөөсөн "
              "багцын ухралтын шалгалт ХИЙГДСЭНГҮЙ")

    for p in problems:
        print("   ❌ " + p, file=sys.stderr)
    if problems:
        if args.publish:
            raise SystemExit(
                "\n❌ УХРАЛТ — НИЙТЛЭХГҮЙ.  Сүүлийн залруулгууд буруу шошготой "
                "байж магадгүй — `/assistant/pending`-ийг хараарай.")
        print("   ⚠️ УХРАЛТ илэрлээ (--publish өгөөгүй тул зөвхөн анхааруулга)")
    elif checked_frozen:
        print("   ухралтын шалгалт: ✅ (хөлдөөсөн hold-out ↔ hold-out)")
    elif checked:
        # ⚠️ A3-2: ЭНЭ НЬ «✅» БИШ.  Серверийн CV-ийн тоо ӨӨР багц дээр
        # тооцогдсон тул хөлдөөсөн багцын ухралтыг барихгүй.
        print("   ⚠️ ЗӨВХӨН серверийн CV-ийн тоогоор харьцуулав — ХӨЛДӨӨСӨН "
              "hold-out дээр ХЭМЖИГДЭЭГҮЙ")
    else:
        print("   ⚠️ ухралтын шалгалт ХИЙГДСЭНГҮЙ (харьцуулах тоо алга)")

    # --- 4b. СУУРЬ ЭРГҮҮЛЭХ (A3/D5 + A3-1) ------------------------------
    # ⚠️ ЗӨВХӨН ЭНД.  Бүх хаалга давсан бөгөөд ухралт илрээгүй үед л
    # `report.prev.json` урагшилна; уначихсан гүйлт ХЭЗЭЭ Ч суурь болохгүй.
    #
    # ⚠️ A3-1 (2026-08-28) — РАТЧЕТ ХАГАС БАЙВ.  Нөхцөл нь ердөө
    # `if problems: … else: rotate_prev()` байсан бөгөөд `problems` нь
    # «ХАРЬЦУУЛАЛТ БОЛСОН УУ» гэдгийг ХЭЛДЭГГҮЙ.  `data/eval-holdout.ids.json`
    # УСТВАЛ шинэ тайланд `frozen_accuracy` байхгүй болж
    # `regression_problems()` ХООСОН жагсаалт буцаана ⇒ `problems = []` ⇒
    # ХЭМЖИГДЭЭГҮЙ гүйлтийн тайлан `report.prev.json`-ыг ДАРЖ БИЧНЭ.  Тэр
    # шинэ суурьт ч `frozen_accuracy` байхгүй тул ДАРААГИЙН гүйлт бас
    # харьцуулах юмгүй — СУУРЬ БУЦААШГҮЙ АЛДАГДАНА, нэг ч алдааны
    # мессежгүйгээр.  Одоо `checked_frozen` нь ЗААВАЛ нөхцөл.
    if problems:
        print("   суурь ХЭВЭЭР ҮЛДЭЭВ (ухралттай гүйлт суурь болохгүй)")
    elif checked_frozen:
        rotate_prev()
    elif base is None and new_frozen is not None:
        # ⚠️ ЭХНИЙ СУУРЬ.  Харьцуулах юм байхгүй ч шинэ тайлан нь хөлдөөсөн
        # багц дээр ХЭМЖИГДСЭН тул суурь болох ЭРХТЭЙ.  Энэ салаа байхгүй
        # бол шинэ клон дээр суурь ХЭЗЭЭ Ч үүсэхгүй (мөнхийн гацаа).
        print("   эхний суурь тогтоов (`report.prev.json` урьд нь БАЙГААГҮЙ)")
        rotate_prev()
    else:
        print("   суурь ХЭВЭЭР ҮЛДЭЭВ — хөлдөөсөн hold-out дээр ХЭМЖИГДЭЭГҮЙ "
              "гүйлт суурь болохгүй (`report.prev.json` ХӨНДӨӨГҮЙ)")

    # --- 4c. НИЙТЛЭХИЙН УРЬДЧИЛСАН НӨХЦӨЛ (A3/P1-1, P1-2) ---------------
    # ⚠️ Эдгээр нь «загвар муу» гэсэн үг БИШ — «сайн эсэхийг МЭДЭХГҮЙ»
    # гэсэн үг.  Мэдэхгүй байж ~20 ПК рүү тархдаг жин нийтлэхийг хориглоно
    # (add-in-д АЛБАДАН БУЦААХ механизм БАЙХГҮЙ).
    if args.publish:
        blockers: list[str] = []
        if not pull_ok:
            blockers.append(f"татах алхам гүйцээгүй ({pull_error}) — "
                            f"сүүлийн залруулгууд загварт ОРООГҮЙ байж болно")
        if not server_ok:
            blockers.append("серверийн одоогийн загварыг уншиж чадсангүй — "
                            "юутай харьцуулж байгаагаа мэдэхгүй")
        if new_frozen is None:
            blockers.append("шинэ тайланд `frozen_accuracy` алга "
                            "(`data/eval-holdout.ids.json` алга эсвэл хэт жижиг)")
        if not checked_frozen:
            # ⚠️ A3-2: ЭНД `checked` байсан — сервер амьд байхад ҮРГЭЛЖ True
            # байсан тул энэ хаалга ХЭЗЭЭ Ч хаагдаж байгаагүй.
            blockers.append("ХӨЛДӨӨСӨН hold-out дээрх ухралтын харьцуулалт "
                            "ХИЙГДСЭНГҮЙ (`data/report.prev.json` алга эсвэл "
                            "`frozen_accuracy`-гүй)")
        if blockers:
            print("\n❌ НИЙТЛЭХ БОЛОМЖГҮЙ — урьдчилсан нөхцөл хангагдсангүй:",
                  file=sys.stderr)
            for b in blockers:
                print("     · " + b, file=sys.stderr)
            raise SystemExit(
                "   Загвар нь `addin/Resources/`-д бичигдсэн бөгөөд локал хаалга "
                "давсан — гэхдээ НИЙТЛЭХГҮЙ.\n"
                "   Шалтгааныг зассаны дараа дахин ажиллуул.")

    if not args.publish:
        print("   (--publish өгөөгүй тул серверт илгээгээгүй)")
        return

    # --- 5. Нийтлэх -----------------------------------------------------
    # ⚠️ ЛОКАЛ УРЬДЧИЛСАН ШАЛГАЛТ.  Сервер эдгээрийг ЯГ ИЖИЛ байдлаар
    #    шалгана; энд урьдчилан барих нь дуудагчид ОЙЛГОМЖТОЙ алдаа өгнө
    #    («онооны хувилбар зөрж байна»), сүлжээгээр явсны дараах 409-ийн
    #    оронд.  Серверийн шалгалтыг ЭНЭ НЬ ОРЛОХГҮЙ — хөгжүүлэгчийн
    #    зөөврийн дээрх Python-ыг засаад загвар өөрийгөө «баталгаажуулах»
    #    боломжийг зөвхөн СЕРВЕР тал хаадаг.
    if not GOLDEN_RESULT.exists():
        raise SystemExit(
            f"\n❌ {GOLDEN_RESULT} алга — GOLDEN хаалга ажиллаагүй байна.")
    golden = json.loads(io.open(GOLDEN_RESULT, encoding="utf-8").read())
    g_ver = str(golden.get("model_version") or "")
    g_blocked = golden.get("blocked") or []
    if golden.get("passed") is not True or g_blocked:
        raise SystemExit(
            f"\n❌ GOLDEN оноо давсангүй (passed={golden.get('passed')}, "
            f"blocked={g_blocked}) — НИЙТЛЭХГҮЙ.")
    if g_ver != ver:
        raise SystemExit(
            f"\n❌ ОНОО ӨӨР ЗАГВАРЫНХ: eval.model_version={g_ver!r} ≠ "
            f"нийтлэх version={ver!r}.\n"
            f"   `run_golden.py`-г ЭНЭ жин дээр дахин ажиллуул — эс бөгөөс\n"
            f"   өчигдрийн амжилттай оноогоор шинэ жин идэвхжих байсан.")

    weights = json.loads(io.open(MODEL, encoding="utf-8").read())
    # ⚠️ 1B-4: `assistant_models`-д датасетын хэшид зориулсан БАГАНА
    # БАЙХГҮЙ (0195:122-142) бөгөөд шинэ багана нэмэх нь migration + deploy +
    # унших код гэсэн ГУРВАН алхам.  Тиймээс provenance нь (а) `weights_json`
    # дотор (аль хэдийн бичигдсэн, add-in чимээгүй алгасна) ба (б) `note`
    # дотор явна.  Сервер `str(body.note, 500)` (revit.ts:1843) 500
    # тэмдэгтээр тайрдаг тул НЯГТ бич.
    tools = report.get("toolchain") or {}
    note = (args.note or
            f"ds={ds_hash[:8]} rows={n} src={src} "
            + (f"quarantined={quarantined} " if quarantined else "")
            + (f"frozen={float(frozen):.4f} " if frozen is not None else "")
            + f"cv={acc:.4f} sk={tools.get('scikit_learn')} "
              f"git={report.get('git_sha')}")[:500]
    res = api(args.host, token, "/api/revit/assistant/models", {
        "version": ver,
        "weights": weights,
        "accuracy": acc,
        "per_intent": report.get("per_intent"),
        "example_count": n,
        "note": note,
        "activate": True,
        # ⚠️ ЭНЭ ТАЛБАРГҮЙГЭЭР СЕРВЕР 409 БУЦААНА.  `revit.ts`-ийн ГОЛ
        #    ХААЛГА нь `eval.passed === true` БА `eval.blocked` хоосон БА
        #    `eval.model_version === version` ГУРВУУЛАНГ шаарддаг.  Талбарыг
        #    орхигдуулсан нь загвар нийтлэх урсгалыг 100% БИТҮҮ болгож байв:
        #    хаалга серверт нэмэгдсэн ч дуудагч тал оноо хавсаргаагүй.
        "eval": golden,
    })
    print(f"\n🚀 Нийтлэв: {res.get('version')} (идэвхтэй={res.get('activated')})")
    print("   Revit-үүд дараагийн нээхэд өөрсдөө татаж авна.")


if __name__ == "__main__":
    main()
