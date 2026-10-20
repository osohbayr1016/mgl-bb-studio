"""MGL Revit туслах — САНАА ТАНИХ ангилагчийн сургалт.

Энэ скрипт нэг л зүйл хийнэ: шошготой жишээнүүдээс жин сургаж,
add-in уншиж чадах JSON болгож экспортлоно.

    python train_intent.py --data data/seed.json --out ../addin/intent-model.json

⚠️ ЭНЭ НЬ АЖИЛТНЫ КОМПЬЮТЕР ДЭЭР АЖИЛЛАХГҮЙ.  Сургалт нь хөгжүүлэгчийн
машин дээр НЭГ УДАА болно; гарсан JSON нь add-in дотор шигтгэгдэж, C#
талаас ~1 мс-д уншигдана.  Ажилтанд Python, интернэт, API ХЭРЭГГҮЙ.

⚠️ `preprocess()` нь `addin/IntentModel.cs`-ийн `Preprocess()`-ийн ХОСЛОЛ.
Аль нэгийг өөрчилвөл нөгөөг нь ЗААВАЛ зэрэг өөрчил — эс бөгөөс сургалт ба
таамаглал өөр өөр онцлог үзэх бөгөөд нарийвчлал ЧИМЭЭГҮЙ унана.  Доорх
`--selftest` нь энэ хоёрыг шалгах жишээнүүдийг хэвлэнэ.

⚠️ ЯАГААД ТЭМДЭГТИЙН n-gram ВЭ: монгол хэл залгамал.  «илгээ / илгээх /
илгээнэ / илгээчих» бүгд нэг үндэстэй.  Үгэн n-gram эдгээрийг өөр өөр гэж
үзнэ; тэмдэгтийн 3-5 n-gram нь «илгэ», «лгээ» гэсэн хэсгүүдээр бүгдийг
барина.  Морфологийн задлагч, толь бичиг хэрэггүй.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import random
import re
import subprocess
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

# ─── 1B-4 · СУРГАЛТЫН ШУГАМЫН БҮРЭН БҮТЭН БАЙДАЛ ────────────────────────
# Энэ файл дахь манифест / хөлдөөсөн hold-out / provenance-ийн бүх хэсэг
# `1B-4` тэмдэглэгээтэй.  1B-5 (golden datasets) ЭНЭ ФАЙЛЫГ ДАРАА НЬ
# дахин засах тул өөрчлөлтүүд ЗОРИУД ЛОКАЛЧЛАГДСАН — нэг ч хуучин функцийн
# гарын үсэг өөрчлөгдөөгүй (§4.2).
HERE = Path(__file__).resolve().parent
HOLDOUT_PATH = HERE / "data" / "eval-holdout.ids.json"

# ─── 1B-5 · GOLDEN-EVAL-ийн ХАСАЛТ ──────────────────────────────────────
# ⚠️ ЭНЭ ХОЁР ЗАМ БОЛ A3-ЫН ЗАСВАР.  2026-08-28 хүртэл энэ файл
# `eval/manifest.json`-ыг ОГТ УНШДАГГҮЙ байсан тул `--pull` нь D1-ээс
# бодит хэрэглээний мөр татахад golden мөр `production.json`-д орж,
# дараагийн загвар ӨӨРИЙН ШАЛГАЛТЫН ХАРИУЛТЫГ цээжилдэг байв —
# `run_golden.py` 100% ногоон, ерөнхийлөлт хэмжигдэхээ больсон.
EVAL_DIR = HERE.parent / "eval"
EVAL_MANIFEST_PATH = EVAL_DIR / "manifest.json"
GOLDEN_DIR = EVAL_DIR / "golden"

# ⚠️ Windows-ийн консол анхдагчаар cp1252 — кирилл хэвлэхэд УНАДАГ.
# Скрипт өөрөө UTF-8 болгоно, хэрэглэгчийг PYTHONIOENCODING тохируулахыг
# шаардахгүй (тэр нь мартагдана).
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - хуучин Python, дахин чиглүүлсэн урсгал
        pass

# ⚠️ Манай өөрийн модуль — гуравдагч хамаарлын try-гаас ГАДНА байна.
# Байхгүй бол энэ нь суулгах асуудал биш, репо эвдэрсэн гэсэн үг.
from textfold import fold_text

try:
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import (
        RepeatedStratifiedKFold,
        StratifiedKFold,
        cross_val_predict,
        cross_val_score,
    )
    from sklearn.metrics import classification_report, confusion_matrix
    from sklearn.pipeline import Pipeline
except ImportError:  # pragma: no cover
    # ⚠️ 1B-4: багаж хэрэгсэл ТОГТООГДСОН.  scikit-learn нь олон ангиллын
    # анхдагч, IDF тэгшитгэл, n-gram зүсэлтээ бага хувилбарын шинэчлэлтэд
    # өөрчилдөг.  Тэр үед жин хөдөлж `check_parity.py` (C# ↔ Python) «зөрүү»
    # мэдээлнэ — гэвч тэр нь sklearn-ий өөрчлөлт үү, C#-ийн жинхэнэ ухралт
    # уу гэдгийг ялгах арга БАЙХГҮЙ.  Тиймээс `requirements.txt` (==).
    print(
        "Хамаарал дутуу байна:\n"
        "  ..\\server\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt",
        file=sys.stderr,
    )
    raise


INTENTS = [
    "submit_progress",
    "list_sheets",
    "isolate_sheet",
    "reset_view",
    "whats_changed",
    "set_baseline",
    "progress_status",
    "help",
    "unknown",
]

# ⚠️ Урьдчилан боловсруулалтын ГЭРЭЭ.  `preprocess()` эсвэл
# `textfold.py`-г өөрчилвөл ЭНЭ МӨРИЙГ ЗААВАЛ ӨӨРЧИЛ — эс тэгвээс
# хуучин add-in шинэ загварыг чимээгүй буруу уншина.
PREPROCESS_CONTRACT = "fold-v1"

# ⚠️ 2026-08-25-нд 3-5 / 6k-аас 2-6 / 12k БОЛГОВ.  Таамаглаар биш, 5×5
# давтсан шалгалтаар ХЭМЖИЖ:
#     тэмдэгт 3-5 / 6k    0.9362  σ0.010
#     тэмдэгт 2-6 / 12k   0.9407  σ0.007   ← тогтвор нь ч сайжирсан
# Хэл тутам: латин-монгол 96.1→97.5%, англи 89.5→90.2%, холимог 96.0→97.0%.
# 2 тэмдэгтийн n-gram нь богино залгаварыг (-ыг/-ийн/-аа) барьдаг; 6 нь
# бүтэн богино үгийг барьдаг.
#
# ⚠️ ҮГ ТҮВШНИЙ онцлог ТУС БОЛСОНГҮЙ (0.9360 — дуу чимээний хэмжээнд),
# LinearSVC нь МУУДСАН (0.9309).  Дахин бүү оролд — хэмжсэн.
#
# ⚠️ Эдгээр тоог загвар өөрөө JSON дотроо (`ngram_min`/`ngram_max`) авч
# явдаг тул C# тал АВТОМАТААР дасна — `IntentModel.cs` засах шаардлагагүй.
NGRAM_MIN = 2
NGRAM_MAX = 6


def preprocess(raw: str) -> str:
    """⚠️ `IntentModel.Preprocess()` (C#)-тэй ЯГ ИЖИЛ БАЙХ ЁСТОЙ.

    Кирилл ба латинаар бичсэн монголыг НЭГ хэлбэрт буулгаад n-gram гаргана:

        «илгээе» «ilgeeye» «ilgeye» «ИЛГЭЭЕ»  →  бүгд « ilge »
        «хийснээ» «hiisnee» «khiisne»          →  бүгд « hisne »

    2026-08-25-нд ХЭМЖСЭН: кирилл дээр сургаад ЛАТИН дээр шалгахад
    эвхэлтгүй 52.8%, эвхэлттэй 97.8%.  Ерөнхий нарийвчлал 88.5% → 92.3%.
    Өөрөөр хэлбэл өмнө нь латинаар бичдэг хүн бараг ойлгогдохгүй байсан.
    Давхардсан үсэг хураадаг тул эгшиг нэмэх/хасах алдаа ч өөрөө арилна.

    ⚠️ Эвхэлт нь ЦЭГ ТАСЛАЛЫГ УСТГАНА.  Монголд асуултыг бөөм
    («уу/вэ/бэ») зөөдөг тул алдагдахгүй, харин англид «is it 70%?» ба
    «it is 70%» хоёрын цорын ганц ялгаа нь тэмдэг байж болно — тиймээс
    `qmark` гэсэн тусдаа үг залгана.  Энэ өгөгдөл дээр нөлөө нь тэг,
    гэхдээ англи мөрүүд нэмэгдэхэд хэрэгтэй болно.
    """
    if not raw or not raw.strip():
        return " "
    s = fold_text(raw)
    if "?" in raw:
        s = (s + " qmark") if s else "qmark"
    return " " + s + " "


def row_id(text: str, intent: str) -> str:
    """1B-4 · Тогтвортой мөрийн ID.

    ⚠️ Түлхүүр нь `clean()`-ийн ДАВХАРДАЛ ХАСАХ ТҮЛХҮҮРТЭЙ ЯГ ИЖИЛ
    (`(preprocess(text), intent)`).  Тиймээс «илгээ» ба «ilgee» нэг ID авна —
    файлын дараалал, кирилл/латин бичлэг, файл хооронд зөөх зэрэг нь ID-г
    ХӨДӨЛГӨХГҮЙ.  2402 мөр дээр 2402 өвөрмөц ID (мөргөлдөөнгүй) — 2026-08-28-нд
    ХЭМЖСЭН.

    Энэ ID нь `data/eval-holdout.ids.json` дахь ХӨЛДӨӨСӨН үнэлгээний багцын
    цорын ганц холбоос тул форматыг НЬ БҮҮ ӨӨРЧИЛ — өөрчилвөл хөлдөөсөн
    багц бүхэлдээ «алдагдсан» болж, ухралтын түүх утгаа алдана.
    """
    return hashlib.sha256(
        (preprocess(text) + "\x00" + intent).encode("utf-8")).hexdigest()[:16]


SELFTEST_CASES = [
    "ilgeeye",
    "ИЛГЭЭЕ",
    "70% болсон уу?",
    "БА-01",
    "ba 01",
    "Хийснээ илгээ",
    "  ХУУДСУУДАА   харуул  ",
    "БА-01 ийг isolate хийгээд",
    "",
    "   ",
    "hiisnee\tilgee\nодоо",
]


def selftest() -> None:
    """C#-ийн `Preprocess`-тэй тулгах жишээнүүдийг хэвлэнэ."""
    print("preprocess() өгөгдөх/гарах хосууд — C#-тай тулгана уу:")
    for c in SELFTEST_CASES:
        print(f"  {c!r:38} -> {preprocess(c)!r}")


def load_rows(paths: list[Path], source_map: dict[str, str] | None = None) -> list[dict]:
    """JSON (rows массив) эсвэл JSONL уншина.

    ⚠️ 1B-4: мөр бүрд ХОЁР дотоод талбар залгана —

      `_file`   — эх файлын нэр (provenance-ийн тайланд)
      `_source` — `assistant_examples.source` (seed|usage|manual).  Мөр өөрөө
                  `source` талбартай бол ТЭР давуу; үгүй бол `source_map`
                  (манифестын файл→source); үгүй бол `"seed"`.

    Гарын үсэг НЭМЭГДСЭН боловч `source_map` нь СОНГОЛТТОЙ тул
    `check_parity.py:119`-ийн `load_rows(list(args.data))` дуудлага ХЭВЭЭР
    ажиллана.  Доод зураастай түлхүүрүүд нь `clean()`-д нөлөөлөхгүй.
    """
    rows: list[dict] = []
    smap = source_map or {}

    def tag(r: dict, name: str) -> dict:
        if not isinstance(r, dict):
            return r
        src = (r.get("source") or "").strip() or smap.get(name) or "seed"
        return {**r, "_file": name, "_source": src}

    for p in paths:
        text = p.read_text(encoding="utf-8-sig")
        if p.suffix == ".jsonl":
            for line in text.splitlines():
                line = line.strip()
                if line:
                    rows.append(tag(json.loads(line), p.name))
            continue
        obj = json.loads(text)
        if isinstance(obj, list):
            rows.extend(tag(r, p.name) for r in obj)
        elif isinstance(obj, dict) and isinstance(obj.get("rows"), list):
            rows.extend(tag(r, p.name) for r in obj["rows"])
        else:
            raise SystemExit(f"{p}: 'rows' массив олдсонгүй")
    return rows


def clean_records(rows: list[dict], default_source: dict[str, str] | None = None) -> list[dict]:
    """1B-4 · Хуучин `clean()`-ийн БҮХ логик, гэхдээ БҮТЭН бичлэг буцаана.

    Буцаах бичлэг бүр: `{"text", "intent", "source", "file", "id"}`.

    ⚠️ `clean()` нь ЭНЭ функцийн НИМГЭН БҮРХҮҮЛ бөгөөд АРИТИ 2 хэвээр —
    `check_parity.py:39,:119` түүнийг импортолж `X, y = clean(...)` гэж
    задалдаг тул арити өөрчлөгдвөл 1-Р ХААЛГА ШУУД УНАНА (§4.2).

    ⚠️ Эрэмбэ ба давхардал хасах түлхүүр НЭГ Ч ТЭМДЭГТ өөрчлөгдөөгүй —
    `source`/`file` талбарууд эрэмбэнд ОРОХГҮЙ (§4.4).  Давхардлын үед
    ЭХНИЙ хуулбар үлдэх тул `datasets.manifest.json`-ы ДАРААЛАЛ нь эх
    сурвалжийн тэргүүлэх эрэмбэ болно.
    """
    seen: set[tuple[str, str]] = set()
    X: list[str] = []
    y: list[str] = []
    src: list[str] = []
    fil: list[str] = []
    # --- 2-6 · ХЭМЖИХ ХОЁР ШИНЭ ТЭНХЛЭГ (0215-ын итгэл, 0238-ын баг) ---
    # ⚠️ ЭДГЭЭР НЬ ТООЛОГЧ, ШҮҮЛТ БИШ.  Нэг ч мөр эдгээрээс болж
    #    ХАЯГДАХГҮЙ: цөмийн бодлого өнөөдөр ТЭГ мөр өгнө (0215-ын backfill
    #    HUMAN_VERIFIED / RULE_VERIFIED / HUMAN_CORRECTED-ыг ХЭЗЭЭ Ч
    #    оноодоггүй), тиймээс шүүлт нэмбэл сургалт ЗҮГЭЭР Л БАРИГДАХГҮЙ.
    #    Хаалгыг эзэн цөм тэгээс дээш гарсны ДАРАА тавина.
    styp: list[str] = []
    team: list[str] = []
    dropped_dup = 0
    dropped_bad = 0
    smap = default_source or {}

    for r in rows:
        text = (r.get("text") or "").strip()
        intent = (r.get("intent") or "").strip()
        if not text or intent not in INTENTS:
            dropped_bad += 1
            continue
        # ⚠️ Эвхсэн хэлбэрээр давхардуулна.  «илгээ» ба «ilgee» нь
        # загварын хувьд ЯГ ИЖИЛ онцлог өгдөг тул хоёуланг нь үлдээвэл
        # тэр жишээ давхар жинтэй болно — өгөгдлийн файлд хоёул үлдэнэ.
        key = (preprocess(text), intent)
        if key in seen:
            dropped_dup += 1
            continue
        seen.add(key)
        X.append(text)
        y.append(intent)
        name = str(r.get("_file") or "")
        fil.append(name)
        src.append(str(r.get("_source") or r.get("source") or smap.get(name) or "seed"))
        # ⚠️ Талбар БАЙХГҮЙ бол «(мэдэгдэхгүй)» — «UNKNOWN» БИШ.  `UNKNOWN`
        #    нь 0215-ын CHECK-ийн ЖИНХЭНЭ утга (гарал нь мэдэгдэхгүй гэж
        #    БҮРТГЭГДСЭН мөр); талбар нь огт ирээгүй нь ӨӨР зүйл — хуучин
        #    экспорт эсвэл гараар бичсэн датасет.  Хоёрыг нийлүүлбэл
        #    «энэ загварын хэдэн хувь нь баталгаажсан бэ» гэсэн тоо ХУДАЛ болно.
        styp.append(str(r.get("source_type") or "(мэдэгдэхгүй)"))
        # ⚠️ None / хоосон = КОМПАНИ ДАЯАР.  ТААМАГЛАСАН баг БИШ.
        tcode = r.get("team")
        team.append(str(tcode) if isinstance(tcode, str) and tcode.strip() else "(компани даяар)")

    # ⚠️ ЭРЭМБЭЛНЭ.  Файлын дараалал өөрчлөгдөхөд хөндлөн шалгалтын fold-ын
    # бүрэлдэхүүн өөрчлөгдөж, нарийвчлал ±0.02 хэлбэлздэг байв (ижил өгөгдөл,
    # ижил үр).  Хаалганы тоо ЯГ ДАВТАГДАХ ёстой.
    # ⚠️ ТҮҮХИЙ текстээр БИШ, ЭВХСЭН хэлбэрээр эрэмбэлнэ.  Давхардал хасахад
    # «илгээ» эсвэл «ilgee»-ийн аль нь үлдэх нь файлын дараалалаас хамаарна;
    # хоёул ижил онцлог өгдөг тул матриц ижил, гэвч түүхий текстээр эрэмбэлбэл
    # МӨРИЙН БАЙРЛАЛ өөр болж fold дахин хуваагдана.
    order = sorted(range(len(X)), key=lambda i: (y[i], preprocess(X[i])))
    X = [X[i] for i in order]
    y = [y[i] for i in order]
    src = [src[i] for i in order]
    fil = [fil[i] for i in order]
    styp = [styp[i] for i in order]
    team = [team[i] for i in order]

    # ⚠️ Нэг текст ХОЁР өөр санаанд байвал загвар хэзээ ч зөв сурахгүй.
    # Чимээгүй өнгөрөөхгүй — зогсооно.
    by_text: dict[str, set[str]] = {}
    for t, i in zip(X, y):
        by_text.setdefault(preprocess(t), set()).add(i)
    conflicts = {t: v for t, v in by_text.items() if len(v) > 1}
    if conflicts:
        print("\nЗӨРЧИЛ — нэг текст олон санаанд:", file=sys.stderr)
        for t, v in list(conflicts.items())[:20]:
            print(f"  {t!r}: {sorted(v)}", file=sys.stderr)
        raise SystemExit(f"{len(conflicts)} зөрчилтэй мөр. Эхлээд зас.")

    print(f"  ачаалав: {len(X)} мөр  (давхардал {dropped_dup}, буруу {dropped_bad} хасав)")
    dist = Counter(y)
    for i in INTENTS:
        n = dist.get(i, 0)
        flag = "  ⚠️ ЦӨӨН" if n < 25 else ""
        print(f"    {i:18} {n:4}{flag}")
    missing = [i for i in INTENTS if dist.get(i, 0) == 0]
    if missing:
        raise SystemExit(f"Жишээгүй санаа: {missing}")

    # 1B-4 · Эх сурвалж тус бүрийн тоо — ЭЦСИЙН (давхардал хассаны дараах)
    # бичлэгүүдээс.  «Энэ загварын хэдэн хувь нь бодит хэрэглээнээс сурсан
    # бэ» гэсэн асуултад хариулах цорын ганц тоо.
    sc = Counter(src)
    print("    эх сурвалж:  " + " · ".join(f"{k} {sc[k]}" for k in sorted(sc)))
    fc = Counter(fil)
    if any(fc):
        print("    файлаар   :  " + " · ".join(f"{k} {fc[k]}" for k in sorted(fc) if k))
    # --- 2-6 · ХОЁР ШИНЭ ТООЛОГЧ ---
    # ⚠️ «итгэл» нь 0215-ын source_type тэнхлэг; «баг» нь 0238-ын team_code.
    #    Хоёулаа ЗӨВХӨН ХЭМЖИНЭ.  «(компани даяар)» нь 2402 мөр байх нь
    #    ХҮЛЭЭГДСЭН эхлэл: нийлүүлэгдсэн корпус бүхэлдээ синтетик тул ямар ч
    #    багийн нотолгоо БИШ, ба зориуд backfill ХИЙГЭЭГҮЙ.
    stc = Counter(styp)
    print("    итгэл     :  " + " · ".join(f"{k} {stc[k]}" for k in sorted(stc)))
    tmc = Counter(team)
    print("    баг       :  " + " · ".join(f"{k} {tmc[k]}" for k in sorted(tmc)))

    return [
        {"text": t, "intent": i, "source": s, "file": f, "id": row_id(t, i),
         "source_type": st, "team": tm}
        for t, i, s, f, st, tm in zip(X, y, src, fil, styp, team)
    ]


def clean(rows: list[dict]) -> tuple[list[str], list[str]]:
    """⚠️ АРИТИ 2 ХЭВЭЭР — `check_parity.py:39` үүнийг импортолдог (§4.2)."""
    recs = clean_records(rows)
    return [r["text"] for r in recs], [r["intent"] for r in recs]


def build(max_features: int):
    vec = TfidfVectorizer(
        analyzer="char",
        ngram_range=(NGRAM_MIN, NGRAM_MAX),
        # ⚠️ Бид ӨӨРСДӨӨ preprocess хийнэ — sklearn-д давхар хийлгэхгүй.
        lowercase=False,
        preprocessor=preprocess,
        max_features=max_features,
        # Нэг л удаа гарсан n-gram нь дуу чимээ; хоёроос эхэлнэ.
        min_df=2,
        sublinear_tf=False,
        norm="l2",
        smooth_idf=True,
    )
    clf = LogisticRegression(
        solver="lbfgs",
        max_iter=3000,
        # 5×5 давтсан шалгалт: C=8 нь C=4-өөс тогтмол дээгүүр
        # (0.9243 vs 0.9198).  Эвхэлтийн дараа онцлог цөөрсөн тул
        # илүү сул регуляризаци тохирно.
        C=8.0,
        # Ангиллын тэнцвэргүй байдлыг (unknown илүү олон) залруулна.
        class_weight="balanced",
    )
    return vec, clf


def evaluate_cv(X, y, max_features: int) -> dict:
    """ХОЁРДОГЧ ДОХИО — хөндлөн шалгалт, vectorizer нь Pipeline-ий ДОТОР.

    ⚠️ 1B-4 ЗАСВАР.  2026-08-28 хүртэл энэ функц `vec.fit_transform(X)`-ийг
    CV-ЭЭС ГАДНА нэг удаа дуудаж, зөвхөн `clf`-ийг fold-оор хуваадаг байв.
    Тэгэхэд vectorizer нь ГУРВАН зүйлийг БҮХ өгөгдлөөс сурсан байдаг:
      · үгсийн сангийн сонголт (`max_features`)
      · `min_df=2` тайралт
      · IDF вектор (`smooth_idf`)
    — өөрөөр хэлбэл тест fold-ын мөрүүд сургалтын онцлогт шингэсэн тул
    мэдээлж буй тоо түүврийн ГАДНАХ тоо БИШ байв.

    2026-08-28-нд ХЭМЖСЭН (2402 мөр, sklearn 1.9.0, `max_features=12000`):
        алдагдалтай (хуучин)  0.9403  σ 0.0098
        Pipeline (энэ)        0.9366  σ 0.0100
        хазайлт               +0.0037 · `unknown` дээр +0.026
    Хугацаа: 12.5 сек → 16.0 сек (ижил машин, зэрэгцээ ачаалалтай).
    """
    vec, clf = build(max_features)
    # ⚠️ Pipeline нь fold бүрийн СУРГАЛТЫН хэсэг дээр л `fit_transform`
    # хийж, тест хэсгийг зөвхөн `transform` хийнэ — алдагдал бүрэн таслагдана.
    pipe = Pipeline([("vec", vec), ("clf", clf)])
    yv = np.array(y)
    n_splits = min(5, min(Counter(y).values()))
    if n_splits < 2:
        print("  ⚠️ хөндлөн шалгалт хийхэд жишээ хэт цөөн")
        return {}
    # ⚠️ НЭГ УДААГИЙН 5-fold нь ХЭТ ЧИМЭЭТЭЙ (σ ≈ 0.021 хэмжигдсэн).  Хүний
    # нүдэнд харагдах тоо байсан бол зүгээр, ГЭВЧ `pull_and_retrain.py` нь
    # энэ тоогоор УХРАЛТЫГ шүүдэг тул хэлбэлзэл нь санамсаргүй татгалзал
    # эсвэл санамсаргүй зөвшөөрөл өгнө.  5×5 давталтын дундаж мэдэгдэхүйц
    # тогтвортой бөгөөд ердөө хэдхэн секунд нэмнэ.
    rep_cv = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=5, random_state=42)
    scores = cross_val_score(pipe, X, yv, cv=rep_cv, n_jobs=-1)
    acc = float(scores.mean())
    acc_std = float(scores.std())

    # Андуурлын матриц нь ХҮНД зориулсан оношилгоо — нэг хуваалт хангалттай.
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)
    pred = cross_val_predict(pipe, X, yv, cv=cv)

    print(f"\n  {n_splits}-fold ×5 хөндлөн шалгалт: {acc:.3f}  (σ {acc_std:.3f})")
    print(classification_report(yv, pred, digits=3, zero_division=0))

    labels = sorted(set(y))
    cm = confusion_matrix(yv, pred, labels=labels)
    print("  Андуурлын матриц (мөр = үнэн, багана = таамаг):")
    head = "".join(f"{l[:6]:>8}" for l in labels)
    print(f"    {'':18}{head}")
    for i, l in enumerate(labels):
        row = "".join(f"{v:>8}" for v in cm[i])
        print(f"    {l:18}{row}")

    # Хамгийн их андуурагдсан хосууд — засах ёстой газар.
    pairs = []
    for i, a in enumerate(labels):
        for j, b in enumerate(labels):
            if i != j and cm[i][j] > 0:
                pairs.append((cm[i][j], a, b))
    pairs.sort(reverse=True)
    if pairs:
        print("\n  Хамгийн их андуурал:")
        for n, a, b in pairs[:6]:
            print(f"    {a} -> {b}: {n}")

    per = {}
    for i, l in enumerate(labels):
        tot = int(cm[i].sum())
        per[l] = round(float(cm[i][i] / tot), 3) if tot else 0.0
    return {
        "accuracy": round(acc, 4),
        "accuracy_std": round(acc_std, 4),
        "per_intent": per,
        "folds": n_splits,
        "repeats": 5,
    }


# ─── 1B-4 · ХӨЛДӨӨСӨН ҮНЭЛГЭЭНИЙ БАГЦ ──────────────────────────────────

def load_holdout(path: Path) -> list[str] | None:
    """`eval-holdout.ids.json`-ыг уншина.  Байхгүй бол None."""
    if not path.exists():
        return None
    obj = json.loads(path.read_text(encoding="utf-8-sig"))
    ids = obj.get("ids") if isinstance(obj, dict) else obj
    if not isinstance(ids, list):
        raise SystemExit(f"{path}: 'ids' жагсаалт олдсонгүй")
    return [str(i) for i in ids]


def freeze_holdout(recs: list[dict], frac: float, seed: int) -> list[str]:
    """Санаа тус бүрээр ДАВХАРГАЛСАН hold-out түүвэрлэнэ (детерминист).

    ⚠️ НЭГ Л УДАА ажиллана.  Дахин хөлдөөх нь өмнөх БҮХ оноог утгагүй
    болгоно — тиймээс `--freeze-holdout` нь файл байвал `--force`-гүйгээр
    ТАТГАЛЗАНА.
    """
    rnd = random.Random(seed)
    by: dict[str, list[str]] = {}
    for r in recs:
        by.setdefault(r["intent"], []).append(r["id"])
    out: list[str] = []
    for intent in sorted(by):
        pool = sorted(set(by[intent]))
        k = max(1, round(len(pool) * frac))
        out += rnd.sample(pool, k)
    return sorted(set(out))


def evaluate_frozen(recs: list[dict], holdout_ids: list[str] | None,
                    max_features: int) -> dict:
    """АНХДАГЧ ДОХИО — ХӨЛДӨӨСӨН багц дээрх оноо.

    Hold-out мөрүүдийг ХАССАН өгөгдөл дээр загвар сургаж, hold-out дээр
    оноодог.  Энэ бол `pull_and_retrain.py`-ийн ухралтын хамгаалалт
    харьцуулах ЦОРЫН ГАНЦ утгатай тоо: хуучин ба шинэ загвар ЯГ ИЖИЛ
    мөрүүд дээр оноогдоно.  CV-ийн тоо нь өгөгдлийн багц томрох бүрд өөр
    түүвэр дээр тооцогддог тул хоорондоо харьцуулагдахгүй.

    ⚠️ ЭНД СУРГАСАН ЗАГВАР ЭКСПОРТЛОГДОХГҮЙ — ХАЯГДАНА.  Экспортын загвар
    нь БҮХ өгөгдөл дээр сургагдана, учир нь `check_parity.py:124-126` нь
    `max_features`-ийг экспортолсон загварын `vocab` уртаас уншиж Python
    талыг дахин сургадаг — зөрвөл 1-Р ХААЛГА ХУДАЛ УНАНА (§4.3).
    """
    if not holdout_ids:
        print("\n  ⚠️ хөлдөөсөн багц алга — `--freeze-holdout` ажиллуулаагүй байна")
        return {}

    want = set(holdout_ids)
    have = {r["id"] for r in recs}
    missing = sorted(want - have)
    # ⚠️ Хэн нэгэн датасетын текстийг засвал тэр мөрийн ID хөдөлж, hold-out
    # ЧИМЭЭГҮЙ хоосорно.  10%-иас илүү алдагдвал ЧАНГА УНАНА.
    if len(missing) > 0.10 * len(want):
        raise SystemExit(
            f"\n❌ ХӨЛДӨӨСӨН БАГЦ ЭВДЭРСЭН: {len(missing)}/{len(want)} ID олдсонгүй "
            f"(10%-иас их).\n   Датасетын текст засагдсан бол ID хөдөлнө.  "
            f"Засварыг буцаах эсвэл hold-out-ыг ЗОРИУД дахин хөлдөө "
            f"(--freeze-holdout --force) — сүүлийнх нь ухралтын түүхийг устгана.")

    ev = [r for r in recs if r["id"] in want]
    tr = [r for r in recs if r["id"] not in want]
    if len(ev) < 20 or len(set(r["intent"] for r in tr)) < len(INTENTS):
        print("\n  ⚠️ хөлдөөсөн багц хэт жижиг — үнэлгээ алгаслаа")
        return {}

    vec, clf = build(max_features)
    Xv = vec.fit_transform([r["text"] for r in tr])
    clf.fit(Xv, np.array([r["intent"] for r in tr]))
    pred = clf.predict(vec.transform([r["text"] for r in ev]))
    truth = np.array([r["intent"] for r in ev])

    acc = float((pred == truth).mean())
    per: dict[str, float] = {}
    cnt: dict[str, int] = {}
    for lab in sorted(set(truth.tolist())):
        m = truth == lab
        cnt[lab] = int(m.sum())
        per[lab] = round(float((pred[m] == lab).mean()), 3)

    print(f"\n  хөлдөөсөн багц: {acc:.4f}  (n={len(ev)}, алдагдсан ID {len(missing)})")
    for lab in sorted(per):
        print(f"    {lab:18} {per[lab]:.3f}  (n={cnt[lab]})")

    return {
        "frozen_accuracy": round(acc, 4),
        "frozen_per_intent": per,
        "frozen_counts": cnt,
        "frozen_n": len(ev),
        "frozen_missing_ids": len(missing),
    }


# ─── 1B-5 · GOLDEN-EVAL-ийн ГИШҮҮНЧЛЭЛИЙН ХАСАЛТ ────────────────────────

def load_exclusions(path: Path) -> tuple[set[str], str, bool]:
    """`eval/manifest.json`-ы `exclude_row_ids`-ыг уншина.

    Буцаах: (id-үүдийн олонлог, `dataset_version`, файл байсан эсэх).

    ⚠️ `preprocess_contract` зөрвөл БҮХ `row_id` хүчингүй — тэр үед хасалт
    ЧИМЭЭГҮЙ 0 мөр хасна, өөрөөр хэлбэл хамгаалалт байхгүйтэй адил болно.
    Тиймээс зөрөхөд ЧАНГА УНАНА (`freeze.py recontract` ажиллуулна).

    ⚠️ Файл БАЙХГҮЙ бол уналт БИШ (1B-5 шипээгүй чекаут байж болно), гэхдээ
    ЧАНГА анхааруулга — «чимээгүй хязгаарлалт байхгүй» дүрэм.
    """
    if not path.exists():
        return set(), "", False
    obj = json.loads(path.read_text(encoding="utf-8-sig"))
    want = obj.get("preprocess_contract")
    if want and want != PREPROCESS_CONTRACT:
        raise SystemExit(
            f"\n❌ {path.name}: preprocess_contract зөрөв "
            f"({want!r} ≠ {PREPROCESS_CONTRACT!r}) — БҮХ exclude_row_ids "
            f"хүчингүй, golden мөр сургалтад ЧИМЭЭГҮЙ орно.\n"
            f"   `eval/freeze.py recontract` ажиллуулаад дахин оролд.")
    ids = obj.get("exclude_row_ids")
    if not isinstance(ids, list):
        raise SystemExit(f"\n❌ {path.name}: 'exclude_row_ids' жагсаалт алга")
    return {str(i) for i in ids}, str(obj.get("dataset_version") or ""), True


def drop_golden_rows(recs: list[dict], excl: set[str]) -> tuple[list[dict], list[dict]]:
    """GOLDEN-EVAL ∪ GOLDEN-REGRESSION-ийн мөрийг сургалтаас ХАСНА.

    ⚠️ ХАСАЛТ нь `row_id`-аар — тэр нь `(preprocess(text), intent)` тул
    кирилл/латин бичлэгээр тойрох боломжгүй (`row_id()`-ийн тайлбар).

    ⚠️ ЭВХСЭН ТЕКСТЭЭР давхар шалгах нь ЭНД БИШ, `assert_no_leak.py`-д —
    тэр нь санаанаас үл хамааран барьдаг бөгөөд `pull_and_retrain.py`-ийн
    ГИШҮҮНЧЛЭЛИЙН ХААЛГА болж СУРГАЛТААС ӨМНӨ ажиллана.  Энд хасах нь
    хамгаалалтын ХОЁРДУГААР давхарга — хаалга алгасагдсан ч (жишээ нь
    `train_intent.py`-г гараар дуудсан) golden мөр жин рүү ОРОХГҮЙ.
    """
    if not excl:
        return recs, []
    kept: list[dict] = []
    dropped: list[dict] = []
    for r in recs:
        (dropped if r["id"] in excl else kept).append(r)
    return kept, dropped


# ─── 1B-4 · PROVENANCE ──────────────────────────────────────────────────

def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def dataset_entries(paths: list[Path], rows: list[dict],
                    source_map: dict[str, str] | None = None) -> list[dict]:
    """Файл тус бүрийн нэр · sha256 · ТҮҮХИЙ мөрийн тоо · source."""
    raw = Counter(str(r.get("_file") or "") for r in rows)
    smap = source_map or {}
    return [
        {"file": p.name, "sha256": sha256_file(p),
         "rows": int(raw.get(p.name, 0)), "source": smap.get(p.name)}
        for p in paths
    ]


def dataset_hash(entries: list[dict], recs: list[dict]) -> str:
    """Датасетын АГУУЛГЫН хэш.  Файлын хэш + эцсийн мөрийн тоо."""
    h = hashlib.sha256()
    for e in sorted(entries, key=lambda x: x["file"]):
        h.update(f"{e['file']}:{e['sha256']}\n".encode())
    h.update(f"rows={len(recs)}\n".encode())
    return h.hexdigest()


def build_hash(ds_hash: str, max_features: int) -> str:
    """ДАТАСЕТ + ГИПЕРПАРАМЕТРИЙН хэш — хувилбарын мөрөнд орох тоо.

    ⚠️ Датасетын хэш дангаараа `C=8.0`, `NGRAM_MIN/MAX`, `max_features`-ийг
    ҮЗЭХГҮЙ.  Тэдгээрийг өөрчилж дахин сургахад ижил хувилбарын нэр гарч,
    сервер `ON CONFLICT (version) DO UPDATE` (revit.ts:1826)-аар өмнөх жинг
    ДАРЖ БИЧНЭ, аль хэдийн татсан ~20 машин `have === row.version`
    (revit.ts:1765) шалтгаанаар ХУУЧИН жинтэй үлдэнэ.  Тиймээс
    гиперпараметрийг хэшид ОРУУЛНА (§9.2-ын санал болгосон анхдагч).
    """
    h = hashlib.sha256()
    h.update(ds_hash.encode())
    h.update(f"|C=8.0|ngram={NGRAM_MIN}-{NGRAM_MAX}|max_features={max_features}"
             f"|preprocess={PREPROCESS_CONTRACT}".encode())
    return h.hexdigest()


def toolchain_info() -> dict:
    """Хэмжсэн багажийн хувилбар — `requirements.txt`-тэй тулгах боломжтой."""
    def ver(mod: str) -> str | None:
        try:
            return __import__(mod).__version__
        except Exception:  # noqa: BLE001
            return None
    return {
        "python": platform.python_version(),
        "scikit_learn": ver("sklearn"),
        "numpy": ver("numpy"),
        "scipy": ver("scipy"),
    }


def git_sha() -> str | None:
    """`git rev-parse --short HEAD` — амжилтгүй бол None (унахыг зөвшөөрнө)."""
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"],
                             cwd=str(HERE), capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None if out.returncode == 0 else None
    except Exception:  # noqa: BLE001
        return None


def export(vec, clf, version: str, decimals: int, provenance: dict | None = None) -> dict:
    """Add-in уншиж чадах JSON болгоно."""
    # ⚠️ `clf.classes_`-ийн ДАРААЛАЛ нь `coef_`-ийн мөрийн дараалал.
    # Өөр дараалал бичвэл бүх таамаглал буруу болно.
    intents = [str(c) for c in clf.classes_]

    vocab = {str(k): int(v) for k, v in vec.vocabulary_.items()}
    idf = [round(float(v), decimals) for v in vec.idf_]

    coef = clf.coef_
    intercept = clf.intercept_
    # Хоёр ангилалтай үед sklearn НЭГ мөр буцаадаг — add-in нь ангилал
    # тутам нэг мөр хүлээдэг тул тэлнэ.
    if coef.shape[0] == 1 and len(intents) == 2:
        coef = np.vstack([-coef[0], coef[0]])
        intercept = np.array([-intercept[0], intercept[0]])

    return {
        "version": version,
        "intents": intents,
        # ⚠️ C# тал үүнийг ШАЛГАНА.  Хуучин add-in шинэ загвар уншвал
        # эвхэлтгүй n-gram гаргаж ЧИМЭЭГҮЙ буруу таамаглана.
        "preprocess": PREPROCESS_CONTRACT,
        "ngram_min": NGRAM_MIN,
        "ngram_max": NGRAM_MAX,
        "vocab": vocab,
        "idf": idf,
        "coef": [[round(float(w), decimals) for w in row] for row in coef],
        "intercept": [round(float(b), decimals) for b in intercept],
        # ─── 1B-4 · PROVENANCE ────────────────────────────────────────
        # ⚠️ Add-in ЭВДРЭХГҮЙ.  `addin/IntentModel.cs:22-40`-ийн
        # `IntentModelData` DTO-д `[JsonExtensionData]` БАЙХГҮЙ бөгөөд
        # `:153` нь `JsonSerializer.Deserialize<IntentModelData>(json)`-ыг
        # СОНГОЛТГҮЙ дуудна — `System.Text.Json`-ы анхдагч нь танихгүй
        # түлхүүрийг ЧИМЭЭГҮЙ АЛГАСАХ явдал (`UnmappedMemberHandling.Disallow`
        # тавигдаагүй).  Тиймээс add-in релиз ШААРДЛАГАГҮЙ.
        # Хэмжээ ~1 KB — `revit.ts:1817`-ийн 5 MB хязгаараас хол доогуур.
        **(provenance or {}),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Санаа таних ангилагчийг сургана")
    ap.add_argument("--data", nargs="+", type=Path, help="JSON/JSONL файл(ууд)")
    ap.add_argument("--out", type=Path, help="Гаралтын model JSON")
    ap.add_argument("--report", type=Path, help="Гаралтын тайлан JSON")
    ap.add_argument("--version", default=None, help="Загварын хувилбар")
    ap.add_argument("--max-features", type=int, default=12000)
    ap.add_argument("--decimals", type=int, default=3)
    ap.add_argument("--selftest", action="store_true", help="preprocess-ийн хосуудыг хэвлэх")
    # ─── 1B-4 ───────────────────────────────────────────────────────────
    ap.add_argument("--manifest-meta", type=Path, default=None,
                    help="pull_and_retrain.py-аас ирэх датасетын мета (JSON)")
    ap.add_argument("--holdout", type=Path, default=HOLDOUT_PATH,
                    help="хөлдөөсөн үнэлгээний ID файл")
    ap.add_argument("--freeze-holdout", action="store_true",
                    help="хөлдөөсөн үнэлгээний багцыг НЭГ УДАА үүсгэнэ")
    ap.add_argument("--frac", type=float, default=0.15, help="hold-out хувь")
    ap.add_argument("--seed", type=int, default=1234, help="hold-out түүврийн үр")
    ap.add_argument("--force", action="store_true",
                    help="⚠️ байгаа hold-out-ыг ДАРЖ БИЧНЭ (түүх устана)")
    # ─── 1B-5 ───────────────────────────────────────────────────────────
    ap.add_argument("--eval-manifest", type=Path, default=EVAL_MANIFEST_PATH,
                    help="golden багцын манифест (exclude_row_ids эндээс)")
    # ⚠️ A3/D5: `pull_and_retrain.py` энэ тугийг ӨГНӨ.  Эргүүлэлт нь ХААЛГА
    # ДАВСНЫ ДАРАА л болох ёстой — эс бөгөөс УНАСАН гүйлтийн тайлан дараагийн
    # гүйлтийн СУУРЬ болж, ухралт шат шатаар «хэвийн» болно (ratchet).
    ap.add_argument("--no-rotate-prev", action="store_true",
                    help="report.prev.json-ыг ЭРГҮҮЛЭХГҮЙ (дуудагч өөрөө хийнэ)")
    args = ap.parse_args()

    if args.selftest:
        selftest()
        return
    if not args.data:
        ap.error("--data шаардлагатай (эсвэл --selftest)")
    if not args.out and not args.freeze_holdout:
        ap.error("--out шаардлагатай (эсвэл --selftest / --freeze-holdout)")

    # 1B-4 · манифестын мета: {"файл": "source"} + дараалал
    source_map: dict[str, str] = {}
    if args.manifest_meta:
        meta = json.loads(args.manifest_meta.read_text(encoding="utf-8-sig"))
        for e in meta.get("datasets") or []:
            if e.get("source"):
                source_map[e["file"]] = e["source"]

    # ─── 1B-5 · GOLDEN ФАЙЛЫГ СУРГАЛТАД ДАМЖУУЛАХЫГ ХОРИНО ─────────────
    # ⚠️ Эх сурвалж нь `eval/assert_no_leak.assert_paths_not_golden()`.  Энд
    # `row_id`/`preprocess` ДАХИН БИЧИГДЭЭГҮЙ — зөвхөн ЗАМ харьцуулж байгаа
    # тул хоёр талын гэрээ салах эрсдэлгүй.  Бүрэн батламжийг
    # `pull_and_retrain.py`-ийн ГИШҮҮНЧЛЭЛИЙН ХААЛГА ажиллуулна.
    _gold = GOLDEN_DIR.resolve() if GOLDEN_DIR.exists() else None
    if _gold:
        bad = []
        for p in args.data:
            try:
                rp = Path(p).resolve()
                rp.relative_to(_gold)
            except (ValueError, OSError):
                continue
            bad.append(rp)
        if bad:
            raise SystemExit(
                "\n❌ GOLDEN ФАЙЛЫГ СУРГАЛТАД ДАМЖУУЛЖЭЭ:\n"
                + "".join(f"     {b}\n" for b in bad)
                + "   GOLDEN-EVAL нь ХӨЛДӨӨСӨН.  Сургалтын мөр нэмэх бол "
                  "`training/data/`-д нэм.")

    print("Сургалтын өгөгдөл:")
    rows = load_rows(args.data, source_map)
    recs = clean_records(rows, source_map)

    # ─── 1B-5 · GOLDEN-EVAL-ийн МӨРИЙГ СУРГАЛТААС ХАСНА ────────────────
    # ⚠️ A3-ЫН ГОЛ ЗАСВАР.  Хасагдсан тоог ҮРГЭЛЖ ХЭВЛЭНЭ — «чимээгүй
    # хязгаарлалт байхгүй» дүрэм.  0 гэсэн тоо ч гэсэн МЭДЭЭЛЭЛ: манифест
    # уншигдсан бөгөөд алдагдал байхгүй гэсэн үг.
    excl, eval_ds_ver, man_found = load_exclusions(args.eval_manifest)
    if not man_found:
        print(f"\n  ⚠️⚠️ GOLDEN МАНИФЕСТ ОЛДСОНГҮЙ: {args.eval_manifest}\n"
              f"       GOLDEN-EVAL-ийн хасалт ХИЙГДЭХГҮЙ — сургалтын багцад "
              f"шалгалтын мөр орсон эсэхийг ЮУ Ч БАТЛАХГҮЙ.", file=sys.stderr)
    recs, dropped = drop_golden_rows(recs, excl)
    print(f"\n  GOLDEN-EVAL хасалт: манифест {len(excl)} id "
          f"(датасет {eval_ds_ver or '—'}) · сургалтаас {len(dropped)} мөр хасав")
    if dropped:
        bc = Counter(f"{r['file']}/{r['intent']}" for r in dropped)
        for k in sorted(bc):
            print(f"    ХАСАВ  {k:34} {bc[k]}")
        # ⚠️ Хасалт нэг ангийг БҮРЭН хоослох нь загварыг чимээгүй эвдэнэ.
        lost = [i for i in INTENTS if not any(r["intent"] == i for r in recs)]
        if lost:
            raise SystemExit(
                f"\n❌ GOLDEN хасалтын дараа жишээгүй үлдсэн санаа: {lost}.\n"
                f"   Golden мөрийг СОЛЬ, эсвэл сургалтын багцад мөр НЭМ.")

    X = [r["text"] for r in recs]
    y = [r["intent"] for r in recs]

    # ─── 1B-4 · hold-out ХӨЛДӨӨХ горим (нэг удаагийн) ──────────────────
    if args.freeze_holdout:
        if args.holdout.exists() and not args.force:
            raise SystemExit(
                f"\n❌ {args.holdout.name} АЛЬ ХЭДИЙН БАЙНА — дахин хөлдөөхгүй.\n"
                f"   Дахин хөлдөөх нь өмнөх БҮХ ухралтын оноог утгагүй болгоно.\n"
                f"   Үнэхээр хүсэж байвал --force нэм.")
        ids = freeze_holdout(recs, args.frac, args.seed)
        args.holdout.parent.mkdir(parents=True, exist_ok=True)
        args.holdout.write_text(json.dumps({
            "_note": ("ХӨЛДӨӨСӨН ҮНЭЛГЭЭНИЙ БАГЦ. Хуучин ба шинэ загварыг ЯГ ЭНЭ "
                      "мөрүүд дээр оноодог. Бүү дахин үүсгэ — үүсгэвэл өмнөх бүх "
                      "оноо утгаа алдана. ID = sha256(preprocess(text) + '\\0' + "
                      "intent)[:16]. Шинэ мөр нэмэхэд энэ багц ХЭВЭЭР үлдэнэ (шинэ "
                      "мөр бүгд СУРГАЛТАД ордог) — ингэснээр багц томрох тусам "
                      "үнэлгээ хатуурч, харьцуулалт үнэн хэвээр байна."),
            "frozen_at": date.today().isoformat(),
            "seed": args.seed,
            "frac": args.frac,
            "ids": ids,
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"\n  хөлдөөв: {args.holdout}  ({len(ids)} ID)")
        return

    report = evaluate_cv(X, y, args.max_features)
    report.update(evaluate_frozen(recs, load_holdout(args.holdout), args.max_features))

    # Бүх өгөгдөл дээр ЭЦСИЙН сургалт (шалгалт аль хэдийн хийгдсэн).
    # ⚠️ ЭНЭ МӨРҮҮД ХЭВЭЭР — экспортын загвар БҮХ өгөгдөл дээр сургагдана,
    # эс бөгөөс `check_parity.py:124-126` ХУДАЛ ухралт мэдээлнэ (§4.3).
    vec, clf = build(args.max_features)
    Xv = vec.fit_transform(X)
    clf.fit(Xv, np.array(y))

    # ─── 1B-4 · PROVENANCE ба ХУВИЛБАР ─────────────────────────────────
    entries = dataset_entries(list(args.data), rows, source_map)
    ds_hash = dataset_hash(entries, recs)
    b_hash = build_hash(ds_hash, args.max_features)
    source_counts = dict(sorted(Counter(r["source"] for r in recs).items()))
    trained_at = datetime.now().astimezone().isoformat(timespec="seconds")
    tools = toolchain_info()
    gsha = git_sha()

    # ⚠️ 2026-08-28 хүртэл: `date.today().isoformat() + ".1"` — «.1» нь ХАТУУ
    # бичсэн литерал, ТООЛУУР БИШ.  Тиймээс нэг өдрийн БҮХ сургалт
    # `<огноо>.1` нэртэй байв: сервер `ON CONFLICT (version) DO UPDATE`-ээр
    # өмнөх жинг дарж бичдэг, аль хэдийн татсан add-in `have === row.version`
    # шалтгаанаар ХУУЧИН жинтэй үлддэг — хоёулаа өөрсдийгөө ижил хувилбар
    # гэж нэрлэнэ.  Одоо нэрэнд датасет+гиперпараметрийн хэш орсон тул
    # өгөгдөл эсвэл тохиргоо өөрчлөгдмөгц нэр АЛЬ ХЭДИЙН өөр болно.
    # Формат: `2026-08-28.1-3f9a1c02` = 22 тэмдэгт, зөвхөн [A-Za-z0-9.-]
    #   · revit.ts:1802 `str(body.version, 64)` — 64-өөс богино ✅
    #   · ApiClient.cs:145 `Uri.EscapeDataString(have)` — escape хийгдэхгүй ✅
    #   `+`, `_`, зай, кирилл БҮҮ АШИГЛА.
    version = args.version or f"{date.today().isoformat()}.1-{b_hash[:8]}"

    provenance = {
        "dataset_sha256": ds_hash,
        "build_sha256": b_hash,
        "dataset_files": [{"file": e["file"], "sha256": e["sha256"], "rows": e["rows"]}
                          for e in entries],
        "row_count": len(recs),
        "source_counts": source_counts,
        # 1B-5 · A3 — хасалт ТАЙЛАНД үлдэнэ, эс бөгөөс «хийгдсэн үү» гэдэгт
        # хариулах арга байхгүй.
        "golden_exclude_ids": len(excl),
        "golden_excluded_rows": len(dropped),
        "eval_dataset_version": eval_ds_ver,
        "eval_manifest_found": man_found,
        "trained_at": trained_at,
        "toolchain": tools,
        "git_sha": gsha,
    }
    model = export(vec, clf, version, args.decimals, provenance)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    # ⚠️ BOM-гүй — C# ба Python хоёулаа уншина.
    args.out.write_text(
        json.dumps(model, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = args.out.stat().st_size / 1024
    print(f"\n  загвар: {args.out}  ({size_kb:.0f} KB, {len(model['vocab'])} онцлог)")
    if size_kb > 1500:
        print("  ⚠️ 1.5 MB-аас том — --max-features багасгана уу")

    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        # ⚠️ 1B-4: ШИНЭ тайлан бичихийн ӨМНӨ одоогийнхыг `report.prev.json`
        # болгож хуулна.  `--offline` ажлын урсгалд сервер БАЙХГҮЙ тул
        # ухралтын хамгаалалт харьцуулах ганц суурь нь ЭНЭ файл болно.
        # ⚠️ A3/D5 (2026-08-28): `--no-rotate-prev` өгөгдсөн бол ЭНД
        # ЭРГҮҮЛЭХГҮЙ.  `pull_and_retrain.py` нь БҮХ хаалга давж, ухралт
        # илрээгүй тохиолдолд л эргүүлнэ; ингэснээр суурь нь «сүүлийн
        # гүйлт» БИШ, «сүүлийн МЭДЭГДЭЖ БУЙ САЙН гүйлт» болно.
        prev = args.report.with_name("report.prev.json")
        if args.report.exists() and not args.no_rotate_prev:
            prev.write_text(args.report.read_text(encoding="utf-8-sig"),
                            encoding="utf-8")
        args.report.write_text(
            json.dumps(
                # ⚠️ `accuracy` түлхүүрийн НЭР хэвээр — `pull_and_retrain.py`
                # уншина.  Гэхдээ утга нь одоо АЛДАГДАЛГҮЙ (Pipeline) тоо.
                {"version": version, "examples": len(X), **report, **provenance},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"  тайлан: {args.report}")

    # Эрүүл байдлын шалгалт — сургасан загвар өөрийн жишээгээ таних ёстой.
    print("\n  Хурдан шалгалт:")
    for probe in ["хийснээ илгээ", "hiisnee ilgee", "БА-01 харуул", "буцаа", "сайн уу"]:
        p = clf.predict_proba(vec.transform([probe]))[0]
        i = int(np.argmax(p))
        print(f"    {probe!r:24} -> {clf.classes_[i]:18} {p[i]:.2f}")


if __name__ == "__main__":
    main()
