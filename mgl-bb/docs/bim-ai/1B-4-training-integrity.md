# 1B-4-training-integrity — Сургалтын шугамын бүрэн бүтэн байдал — манифест, source, hold-out

> **Track:** 1B · DATA INTEGRITY
> **Хамаарал (depends on):** 1A бүрэн дууссан байх. 1B-1/1B-2/1B-3 нь ЭНЭ ажлын урьдчилсан нөхцөл БИШ — энэ бол цэвэр Python, D1-д хүрэхгүй.
> **Блоклож буй (blocks):** 1B-5 (golden datasets) — манифест ба хөлдөөсөн hold-out эхлээд байх ёстой. Мөн 1C-ийн add-in релизэд орох `IntentModel.cs`-ийн ямар ч өөрчлөлт ЭНЭ файлаас ГАРАХГҮЙ.
> **Хөндөх файлууд:** `revit-mcp/training/train_intent.py` · `revit-mcp/training/pull_and_retrain.py` · ШИНЭ `revit-mcp/training/datasets.manifest.json` · ШИНЭ `revit-mcp/training/data/eval-holdout.ids.json` · ШИНЭ `revit-mcp/training/requirements.txt`. **Өөр ЮУГ Ч БИШ.**
> **Deploy тоо:** **0**. Backend deploy БАЙХГҮЙ, migration БАЙХГҮЙ, add-in релиз БАЙХГҮЙ, `wrangler` команд БАЙХГҮЙ.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (scope) — ЯГ ЭНЭ:** зөвхөн `revit-mcp/training/` доторх Python. Өөр юу ч биш.

| Юу | Зөвшөөрөгдөх үү |
|---|---|
| `revit-mcp/training/*.py` засах | ✅ |
| `revit-mcp/training/` дотор ШИНЭ файл үүсгэх (манифест, hold-out id, requirements) | ✅ |
| `backend/` доторх ямар нэг файл | ❌ ХОРИОТОЙ |
| `backend/migrations/` — шинэ migration | ❌ ХОРИОТОЙ. Энэ ажилд схемийн өөрчлөлт ХЭРЭГГҮЙ |
| `revit-mcp/addin/*.cs` | ❌ ХОРИОТОЙ. Зөвхөн УНШИНА (`IntentModel.cs`-ийг батлахын тулд) |
| `frontend/` | ❌ ХОРИОТОЙ |
| `wrangler deploy` / `pages deploy` / `d1 migrations apply` | ❌ ХОРИОТОЙ |
| `revit-mcp/docs/ASSISTANT.md` | ⚠️ Хилийн гадна. §3.7-г үзнэ үү — эзэмшигч зөвшөөрөхөөс нааш БҮҮ ЗАС, зөвхөн зөрүүг мэдэгд |
| Сургасан `intent-model.json`-ыг серверт нийтлэх (`--publish`) | ❌ ХОРИОТОЙ. Энэ сесс НИЙТЛЭХГҮЙ |

**Бусад агентуудтай зэрэг ажиллаж байна.** Энэ репод хэд хэдэн хөгжүүлэгч/агент ЗЭРЭГ ажилладаг тул working tree-д бусдын дуусаагүй, **эмхэтгэгдэхгүй** байж болох өөрчлөлт байж болно.

- Даалгавартаа хамаагүй файлыг **бүү зас, бүү форматла, бүү «цэвэрлэ»**. Илт эвдэрхий харагдсан ч тэр нь өөр агентын WIP.
- **`git restore`, `git checkout --`, `git stash`, `git clean` ХЭЗЭЭ Ч бүү ажиллуул.** Өөрийн зассан файлаас өөр юуг ч `git add` хийхгүй.
- **Унасан бүтэн build чинийх БИШ.** `frontend/` `tsc -b`, `backend/` `npm test` ЭНЭ ажилд огт хамаагүй. Хэрэв ажиллуулаад улаан гарвал алдаа зөвхөн ХАМААГҮЙ файлд байгааг батлаад, эзэмшигчид мэдэгд — араас нь бүү хөө.
- Сессийн эхэнд `git status --porcelain` ажиллуулж, аль файл аль хэдийн бохирдсоныг ТЭМДЭГЛЭ. Дууссаны дараа `git status` дахин хараад **зөвхөн дээрх 5 файл** нэмэгдсэн/өөрчлөгдсөн байх ёстой.

**Энэ сесс ЗААВАЛ хийх нэг хэмжилт:** §9-д хойшлуулахгүй. Vectorizer-ийг CV-ийн дотор оруулж дахин үнэлж, **бодит тоог мэдээл**. (Хариу нь энэ баримтад аль хэдийн байгаа — §2.6. Түүнийг ӨӨРӨӨ ДАХИН ҮРЖҮҮЛЖ баталгаажуул.)

---

## 1. КОНТЕКСТ

### 1.1 Систем (хүйтэн сессэд хангалттай хэмжээгээр)

MGL бол монголын архитектур/инженерийн компани (~49 мэдлэгийн ажилтан). Репо `mgl-e-c`:

- **`backend/`** — Cloudflare Worker: Hono, `@cloudflare/workers-oauth-provider`-оор ороосон. D1 (SQLite) + R2 (`MEDIA_BUCKET` нийтийн / `MEETING_BUCKET` хаалттай) + KV + нэг Durable Object (`MglMcpAgent`). Продакшн D1 нь 45 MB, 114 хүснэгт.
- **`frontend/`** — Vite + React 19 SPA, Cloudflare Pages, төсөл `mgl-design-system`.
- **`revit-mcp/addin/`** — Revit 2024-2027 add-in, C#/WPF, in-process, 47 файлд ~16k мөр, **тест ТЭГ**, ажилтны компьютер дээр **автомат шинэчлэлтийн механизм БАЙХГҮЙ** (~20 PC, `Install.bat`, Revit хаалттай байх шаардлагатай).
- **`revit-mcp/training/`** — Python сургалтын шугам, git-д хянагддаг. **← ЭНЭ ДААЛГАВРЫН БҮХ ХАМРАХ ХҮРЭЭ.**
- **`revit-mcp/server/`, `revit-mcp/agent/`** — Python MCP гүүр ба бие даасан локал агент.

### 1.2 Санаа таних (intent) шугам — юу яаж ажилладаг

```
data/*.json  ──train_intent.py──>  addin/Resources/intent-model.json
                                          │
                        pull_and_retrain.py --publish
                                          ▼
                       POST /api/revit/assistant/models  (D1: assistant_models)
                                          │
                          GET /api/revit/assistant/model?have=<ver>
                                          ▼
                    add-in: IntentModel.SaveDownloaded() → %APPDATA%\RevitMcpAddin\
```

Ангилагч нь **TF-IDF (тэмдэгтийн 2-6 n-gram) + LogisticRegression**, 9 санаа. Сургалт Python дээр, таамаглал **цэвэр C#** дээр (`addin/IntentModel.cs`, ~1 мс, интернэтгүй). Хоёр талын урьдчилан боловсруулалт нэг мөр зөрвөл нарийвчлал чимээгүй унана — тиймээс `PREPROCESS_CONTRACT` гэрээ байдаг (§4.1).

Хүмүүс Revit дотор 👍/👎 дарж, залруулга өгдөг → `assistant_logs` → хүн шошголж `assistant_examples` → `GET /api/revit/assistant/export` → `pull_and_retrain.py` татаж дахин сургадаг. Энэ бол **өөрөө сурдаг гогцоо**.

### 1.3 Яагаад энэ даалгавар байна вэ

Өөрөө сурдаг гогцоо нь нэг л зүйлээс хамаарна: **дараагийн загвар өмнөхөөсөө муу бол ТАТГАЛЗАХ**. Одоо тэр татгалзал ажиллахгүй:

1. Мэдээлж буй нарийвчлал нь **түүврийн ГАДНАХ (out-of-sample) тоо БИШ** — vectorizer нь өгөгдлийн 100%-д тохирдог.
2. Ухралтын хамгаалалт нь **офлайн ажлын урсгалд ХҮРДЭГГҮЙ** — `return`-ийн доор байрлана.
3. Өгөгдлийн сонголт нь **шүүлтгүй glob**, `source` баганыг татаж авахдаа **хаядаг** — курацлагдсан продакшн мөр ба машин үүсгэсэн үр ялгагдахаа больдог.
4. Хувилбарын мөр нь **өдөрт ганцхан утга** авдаг тул нэг өдөр хоёр удаа сургахад хоёр ӨӨР жин нэг л нэрээр явна.
5. Багаж хэрэгсэл **тогтоогдоогүй** — scikit-learn шинэчлэгдвэл жин өөрчлөгдөж, C#↔Python тулгалт үүнийг «тайлбаргүй зөрүү» гэж мэдээлнэ.

**Гарах шалгуур:** «Хэн, ямар өгөгдлөөс, ямар багажаар, ямар оноотой ямар загвар үүсгэснийг систем өөрөө мэдэж байна; муудсан загвар нийтлэгдэхгүй.»

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх мөрийн дугаар бүрийг **2026-08-27-нд** `git rev-parse --short HEAD` = `d7fecf5` дээр биечлэн нээж баталсан.

### 2.1 Файлын байдал ба өгөгдлийн бодит тоо

`revit-mcp/training/` — **10 Python файл** (`train_intent.py`, `pull_and_retrain.py`, `textfold.py` + **7 check скрипт**), `data/` дотор **6 `.json`** + 3 `.md` аудит + `_en_seen.txt`.

Мөрийг ӨӨРӨӨ тоолсон (`json.load` → `len(rows)`):

| Файл | Мөр | sha256 (эхний 16) | `rows[*]`-ийн БҮХ түлхүүр |
|---|---:|---|---|
| `data/bootstrap.json` | 215 | `50de5b3f4d5f450a` | `intent, slot, style, text` |
| `data/english.json` | 463 | `2bb15dae9eff177e` | `intent, lang, style, text` |
| `data/hard-negatives.json` | 46 | `e7a1095837e8571b` | `intent, style, text` |
| `data/multilang.json` | 1291 | `6637f537bde8591d` | `intent, lang, style, text` |
| `data/seed.json` | 517 | `755f9bdeabf04e46` | `intent, slot, style, text` |
| **НИЙТ түүхий** | **2532** | | |
| `clean()`-ийн дараа (давхардал хассан) | **2402** | | |
| `data/report.json` | — (өгөгдөл биш) | `8ea7ef670c1e635e` | `version, examples, accuracy, accuracy_std, per_intent, folds, repeats` |

**⚠️ Нэг ч дата файлд `source` талбар БАЙХГҮЙ.** Дөрөв нь `_note` (монгол тайлбар) агуулна; `hard-negatives.json`-ы `_note` нь «ирцээ бүртгүүлье → submit_progress 0.58» гэсэн БОДИТ продакшны алдаа яаж зассаныг бичсэн — эдгээр мөрийг хасахыг хориглосон.

**`data/production.json` ОДООГООР БАЙХГҮЙ** бөгөөд `.gitignore`-д ч БАЙХГҮЙ (`git check-ignore` rc=1). `git ls-files revit-mcp/training/` нь 21 файл буцаана, `production.json` тэдгээрийн дунд алга. Өөрөөр хэлбэл **`pull_and_retrain.py` энэ репод хэзээ ч амжилттай татаж байгаагүй** (эсвэл татаад файлыг устгасан). `report.json` дахь `version: 2026-08-25.1`, `examples: 2402` нь яг локал 5 файлын тоотой таарч байгаа нь энэ дүгнэлтийг батална.

### 2.2 ДУТУУ (1) — ХӨНДЛӨН ШАЛГАЛТЫН АЛДАГДАЛ (leakage)

`train_intent.py:256-258`:

```python
def evaluate(vec, clf, X, y) -> dict:
    """Хөндлөн шалгалт — ХЭТ САЙН сурсан эсэхийг барина."""
    Xv = vec.fit_transform(X)          # ← 258: өгөгдлийн 100% дээр FIT
```

`Xv` бол өгөгдлийн **бүх** мөрийг үзсэн vectorizer-ийн гаралт. Дараа нь:

- `train_intent.py:269-270` — `RepeatedStratifiedKFold(n_splits, n_repeats=5, random_state=42)` + `cross_val_score(clf, Xv, yv, ...)` — **зөвхөн `clf` нь fold-оор хуваагдана**.
- `train_intent.py:275-276` — `StratifiedKFold(...)` + `cross_val_predict(clf, Xv, yv, cv=cv)` — андуурлын матриц, мөн адил.

Vectorizer нь дараах ГУРВАН зүйлийг бүх өгөгдлөөс сурч байна (`build()`, `train_intent.py:229-242`):

| Юу | Хаана | Яагаад алдагдал вэ |
|---|---|---|
| Үгсийн сангийн СОНГОЛТ | `max_features=max_features` (`:236`, анхдагч 12000, `:353`) | Аль 12000 n-gram үлдэхийг **тест fold-ын мөрүүд ч санал өгнө** |
| `min_df` тайралт | `min_df=2` (`:238`) | «Ганц удаа гарсан» гэдэг нь бүх өгөгдлөөр тодорхойлогдоно |
| IDF вектор | `smooth_idf=True` (`:241`), экспортод `vec.idf_` (`:322`) | Тест мөрүүдийн баримтын давтамж сургалтын онцлогийн жинд шингэнэ |

Тиймээс `report.json`-ы `accuracy: 0.9403` нь **түүврийн гадна тоо биш**.

**Ухралтын хамгаалалтад үзүүлэх нөлөө:** `pull_and_retrain.py:177` нь энэ тоог серверт хадгалагдсан өмнөх тоотой харьцуулна. Гэвч өмнөх тоо нь **өөр өгөгдлийн багц дээр** (өмнөх өдрийн `data/`-аар) яг ижил хазайлттай аргаар тооцогдсон. Өөрөөр хэлбэл **хоёр хазайсан тоог, хоёр өөр багц дээр** харьцуулж байна. Багц томрох тусам хазайлт өөрөө шилждэг тул зөрүү нь загварын чанарыг илэрхийлэхгүй.

**Санаа тус бүрийн ухралт баригдахгүй.** `evaluate()` нь `per_intent`-ийг ТООЦООЛЖ (`:302-305`) `report.json`-д бичдэг, гэхдээ `pull_and_retrain.py` түүнийг зөвхөн серверт **дамжуулна** (`:196`), **ХЭЗЭЭ Ч ХАРЬЦУУЛАХГҮЙ**. Тиймээс `isolate_sheet` 0.99 → 0.60 болж унасан ч ерөнхий нарийвчлал 2%-иас бага хөдөлбөл нийтлэгдэнэ.

### 2.3 ДУТУУ (2) — УХРАЛТЫН ХАМГААЛАЛТ ОФЛАЙНААР ХҮРЭХГҮЙ

`pull_and_retrain.py`-ийн бодит дараалал:

| Мөр | Юу |
|---:|---|
| `:169-171` | `if not args.publish:` → `print("   (--publish өгөөгүй тул серверт илгээгээгүй)")` → **`return`** |
| `:173` | `# --- 4. Ухралтын хамгаалалт ---` |
| `:175` | `cur = api(args.host, token, "/api/revit/assistant/model")` |
| `:177-182` | `if old is not None and acc < float(old) - args.max_drop:` → `raise SystemExit("❌ УХРАЛТ …")` |
| `:190-202` | `# --- 5. Нийтлэх ---` |

Хамгаалалт нь **early-return-ийн ДООР** байна. Харин файлын өөрийнх нь docstring `:8-9` дээр баримтжуулсан ажлын урсгал бол:

```
    # зөвхөн локал өгөгдлөөр (сүлжээгүй)
    ..\..\server\.venv\Scripts\python.exe pull_and_retrain.py --offline
```

`--offline` нь `--publish`-гүй тул `:171`-д `return` хийж, **хамгаалалт хэзээ ч ажиллахгүй**. `revit-mcp/docs/ASSISTANT.md:325-327` мөн энэ яг тэр командыг «БҮГДИЙГ АЖИЛЛУУЛ» гэж зөвлөдөг. Docstring `:22-26` нь үүнийг «ЗУРГАА ДАХЬ ХААЛГА» гэж дүрсэлдэг ч бодит байдал дээр энэ нь хаалга биш, **нийтлэхийн өмнөх сүүлчийн алхам** юм.

**Нэмэлт бодит алдаа:** `:123-124` дээр `if not args.offline and not token: raise SystemExit(...)`. Тиймээс `--offline --publish` хоёуланг нь өгөхөд токенгүйгээр `:175`-д хүрч, `Bearer ` (хоосон) илгээгээд 401 авна; `:185-187` нь зөвхөн 404-ийг залгидаг тул скрипт `HTTPError`-оор унана — «нийтлэхгүй» гэсэн ойлгомжтой мессежгүйгээр.

### 2.4 ДУТУУ (3) — ШҮҮЛТГҮЙ GLOB + PROVENANCE АЛДАГДАЛ

**(а) Шүүлтгүй glob.** `pull_and_retrain.py:94-96`:

```python
def datasets() -> list[Path]:
    """Сургалтад орох БҮХ файл.  `production.json` байвал автоматаар орно."""
    return sorted(p for p in DATA.glob("*.json") if p.name != "report.json")
```

Энэ бол **allowlist БИШ, зөвхөн нэг файлын denylist**. `data/`-д унасан ямар ч `.json` шууд сургалтад орно. Схемийн шалгалт байхгүй:

- `rows` массивгүй файл → `train_intent.py:165` `raise SystemExit(f"{p}: 'rows' массив олдсонгүй")` — **чанга** унана (сайн).
- `rows` массивтай ч буруу шошготой файл → `clean()` (`:180`) нь `intent not in INTENTS` мөрийг **чимээгүй** `dropped_bad` болгож тоолоод үлдсэнийг нь сургана. Хэн ч мэдэхгүй.
- Дараагийн ажиллуулалтад ямар файл орсныг **ХАДГАЛДАГГҮЙ** — `report.json` (`train_intent.py:390-397`) нь `version, examples` + `evaluate()`-ийн үр дүнг л бичнэ, **файлын жагсаалтгүй, хэшгүй**.

Ижил glob нь **гурван** газар давхардсан бөгөөд гурвуулаа өөр өөр тэвчээртэй:

| Файл:мөр | Хэлбэр | Зан төлөв |
|---|---|---|
| `pull_and_retrain.py:96` | `DATA.glob("*.json")`, `report.json` хассан | Сургалтын жинхэнэ эх сурвалж |
| `check_fold_parity.py:34` | `d.glob("*.json")` | `rows` жагсаалт биш файлыг **чимээгүй алгасна** (`:37-38`) |
| `check_behavior.py:135` | `DATA.glob("*.json")` | Мөн адил алгасна — «зонд сургалтад ороогүй» шалгалтад ашиглагдана |

**(б) `source` алдагдана.** Экспортын endpoint нь `source`-ыг БУЦААДАГ. `backend/src/routes/revit.ts:1974-1981`:

```ts
revit.get('/assistant/export', requireAdmin(), async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT text, intent, slot, style, source
         FROM assistant_examples
        WHERE is_active = 1
        ORDER BY intent, id`,
```

`source` нь `backend/migrations/0195_assistant_learning.sql:47-48` дээр тодорхойлогдсон:

```sql
  source      TEXT    NOT NULL DEFAULT 'seed'
                      CHECK (source IN ('seed','usage','manual')),
```

(`seed` = гараар/AI-аар үүсгэсэн үр · `usage` = бодит хэрэглээнээс шошголсон · `manual` = хүн гараар нэмсэн.)

Гэвч `pull_and_retrain.py:73-78` мөрийг **дахин барьж, `source`-ыг хаяна**:

```python
    clean = [
        {"text": r["text"], "intent": r["intent"],
         "style": r.get("style") or "", **({"slot": r["slot"]} if r.get("slot") else {})}
        for r in rows
        if (r.get("text") or "").strip() and (r.get("intent") or "").strip()
    ]
```

`text`, `intent`, `style`, `slot` — `source` алга. Тиймээс `production.json` файл `seed.json`-оос ялгагдахгүй болж, «энэ загварын хэдэн хувь нь бодит хэрэглээнээс сурсан бэ» гэсэн асуултад хариулах боломжгүй болно. `train_intent.py`-ийн `clean()` (`:169-226`) ч `source`-ыг уншдаггүй.

### 2.5 ДУТУУ (4) — ХУВИЛБАРЫН МӨРГӨЛДӨӨН

**(а) Хувилбар үүсэх газар** — `train_intent.py:374`:

```python
    version = args.version or __import__("datetime").date.today().isoformat() + ".1"
```

⚠️ **Тодруулга:** энэ нь «огноо + тоолуур» БИШ — `".1"` бол **хатуу бичсэн литерал**. Тоолуур гэж байхгүй; нэмэгдэхгүй. `pull_and_retrain.py:144-145` нь `--version`-ыг **хэзээ ч дамжуулдаггүй** тул хувилбар нь **үргэлж `<өнөөдөр>.1`**. Нэг өдөр 5 удаа сургахад тав нь бүгд `2026-08-27.1`.

**(б) Сервер тэр нэр дээр ДАРЖ БИЧНЭ** — `backend/src/routes/revit.ts:1802`, `:1822-1832`:

```ts
  const version = str(body.version, 64);
…
      `INSERT INTO assistant_models
         (version, weights_json, intents_json, example_count, accuracy,
          per_intent_json, is_active, note, trained_by)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT (version) DO UPDATE SET
         weights_json    = excluded.weights_json,
```

`assistant_models.version` нь `TEXT NOT NULL UNIQUE` (`0195_assistant_learning.sql:125`), тиймээс хоёр дахь нийтлэлт **өмнөх жинг дарж бичнэ**.

**(в) Add-in нэрээр нь богино холбоо таслана** — `backend/src/routes/revit.ts:1765`:

```ts
  if (have && have === row.version) {
    return c.json({ version: row.version, unchanged: true });
  }
```

`have` нь `revit-mcp/addin/AssistantPane.xaml.cs:1728` дээр `IntentModel.LoadedVersion` (өөрөөр хэлбэл **аль хэдийн диск дээр байгаа** хувилбар), `revit-mcp/addin/ApiClient.cs:144-145` дээр `?have=` болж явна. `ApiClient.cs:158-160` нь `unchanged: true` ирвэл `null` буцаана — **татахгүй**.

**Үр дагавар:** өдрийн эхний сургалтыг татаж авсан 20 компьютер `2026-08-27.1` гэсэн **ХУУЧИН** жинтэй үлдэнэ; сервер дээр **ӨӨР** жин `2026-08-27.1` нэрээр сууна. Хоёулаа өөрсдийгөө ижил хувилбар гэж нэрлэнэ. `revit-mcp/addin/AssistantLog.cs:185` нь `ModelVersion = IntentModel.LoadedVersion`-ыг бүртгэлд илгээдэг тул **аудитын мөр ч ялгаж чадахгүй**.

**(г) ЗАСВАР АЮУЛГҮЙ ЭСЭХИЙГ БАТАЛСАН.** `revit-mcp/addin/IntentModel.cs:22-40` дахь `IntentModelData` DTO:

- `[JsonExtensionData]` шинж чанар **БАЙХГҮЙ**.
- `JsonSerializerOptions`-д `UnmappedMemberHandling.Disallow` **БАЙХГҮЙ** — `IntentModel.cs:153` нь `JsonSerializer.Deserialize<IntentModelData>(json)` гэж **сонголтгүй** дуудна, `System.Text.Json`-ы анхдагч нь танихгүй түлхүүрийг **чимээгүй алгасах** явдал.
- `Parse()` (`:150-167`) зөвхөн `Intents/Vocab/Coef/Idf/Intercept` байгаа эсэх, урт таарч байгаа эсэх (`:154-158`), `preprocess` гэрээ таарч байгаа эсэхийг (`:163-164`) шалгана.

**⇒ Экспортын JSON-д ШИНЭ түлхүүр нэмэх нь одоо суусан БҮХ add-in-д АЮУЛГҮЙ.** Add-in релиз шаардлагагүй.

⚠️ Гэхдээ хувилбарын мөрийн **тэмдэгт**-д болгоомжтой: `ApiClient.cs:145` нь `Uri.EscapeDataString(have)` хийдэг тул `+` тэмдэг `%2B` болно (техникийн хувьд зөв, гэхдээ шалтгаангүй эрсдэл). Мөн `revit.ts:1802` дээрх `str(body.version, 64)` нь **64 тэмдэгтээр тайрна**. Тиймээс шинэ формат `[A-Za-z0-9.-]` дотор, 64-өөс богино байх ёстой.

### 2.6 ДУТУУ (5) — БАГАЖ ХЭРЭГСЭЛ ТОГТООГООГҮЙ · БА АЛДАГДЛЫН БОДИТ ХЭМЖЭЭ

**(а) Тогтоолт байхгүй.** `find revit-mcp -maxdepth 3 -iname "requirements*" -o -iname "pyproject.toml" -o -iname "*.lock"` нь **ганц** файл буцаана: `revit-mcp/server/pyproject.toml`. Түүний `dependencies` нь `mcp>=1.2.0,<2` ба `httpx>=0.27.0` — **scikit-learn ч, numpy ч БАЙХГҮЙ**. `train_intent.py:56-62` нь import алдааг барьж «`py -3.12 -m pip install scikit-learn numpy`» гэж хэвлэдэг — **хувилбаргүй**. Виртуал орчин нь `revit-mcp/.gitignore:2` дээр `server/.venv/` гэж хаагдсан.

Одоогийн бодит багаж (`server/.venv` дотор хэмжсэн, 2026-08-27):

| Багаж | Хувилбар |
|---|---|
| Python | 3.12.10 |
| scikit-learn | **1.9.0** |
| numpy | 2.5.2 |
| scipy | 1.18.1 |
| .NET SDK (check скриптүүд шаарддаг) | 10.0.301 |
| Node (`check_fold_parity.py` шаарддаг) | v24.18.0 |

scikit-learn-ий олон ангиллын анхдагч (`multi_class`), IDF тэгшитгэл, эсвэл `TfidfVectorizer`-ийн n-gram зүсэлт өөрчлөгдвөл жин хөдөлнө. Тэр үед `check_parity.py` (C# ↔ Python) зөрүү мэдээлнэ — гэвч тэр зөрүү нь **шинэ sklearn** уу, эсвэл **C#-ийн жинхэнэ ухралт** уу гэдгийг ялгах мэдээлэл ХААНА Ч БАЙХГҮЙ.

**(б) АЛДАГДЛЫН БОДИТ ХЭМЖЭЭ — ЭНЭ СЕССЭД ХЭМЖСЭН.**

Одоогийн 5 датасет (2402 мөр), `max_features=12000`, `RepeatedStratifiedKFold(5, n_repeats=5, random_state=42)`, sklearn 1.9.0:

| Хувилбар | Нарийвчлал | σ | Тайлбар |
|---|---:|---:|---|
| **A · ОДООГИЙН** (`vec.fit_transform(X)` дараа CV) | **0.9403** | 0.0098 | `report.json`-той **яг таарна** — хэмжилт зөв дахин үржигдэв |
| **B · Vectorizer CV-ийн ДОТОР** (`Pipeline([vec, clf])`) | **0.9366** | 0.0100 | Алдагдалгүй |
| **ХАЗАЙЛТ (A − B)** | **+0.0037** | | **+0.37 нэгж хувь** |

Санаа тус бүрийн хазайлт:

| Санаа | A | B | Δ |
|---|---:|---:|---:|
| `unknown` | 0.878 | 0.852 | **+0.026** |
| `reset_view` | 0.960 | 0.953 | +0.007 |
| `whats_changed` | 0.934 | 0.929 | +0.005 |
| `isolate_sheet` | 0.988 | 0.984 | +0.004 |
| `help` · `list_sheets` · `progress_status` · `set_baseline` · `submit_progress` | — | — | 0.000 |

**Шударга унших нь:** ерөнхий хазайлт **0.37 нэгж хувь** — `--max-drop` анхдагч 0.02 (2 нэгж хувь)-аас ГУРАВ ДАХИН БАГА. Өөрөөр хэлбэл **алдагдал нь дангаараа гамшиг биш**. Жинхэнэ асуудал нь: (1) `unknown` дээр 2.6 нэгж хувь — хамгаалалтын босгоос **ДЭЭГҮҮР**, гэтэл `unknown` бол «үйлдэл бүү хий» гэсэн хамгийн аюулгүй ангилал; (2) энэ тоо нь **өөр өгөгдлийн багц дээрх өөр хазайлттай** харьцуулагдана; (3) хатуу баримт: **мэдээлж буй тоо ямар ч утгаараа шинэ мөр дээрх гүйцэтгэл БИШ**.

**Гүйцэтгэлийн зардал ТЭГ.** Хэмжсэн: A хувилбар 4.6 сек, B хувилбар (Pipeline) **2.9 сек** — pipeline нь **илүү ХУРДАН**, учир нь fold бүр өгөгдлийн 80%-ийг л вектор болгодог. Эцсийн сургалт 0.6 сек. Тиймээс «удаан болно» гэсэн эсэргүүцэл байхгүй.

**Лавлагаа: хөлдөөсөн hold-out.** Мөр-ID = `sha256(preprocess(text) + "\x00" + intent)[:16]` — 2402 мөр дээр **2402 өвөрмөц ID** (мөргөлдөөнгүй). Энэ нь `clean():186` дээрх давхардал хасах түлхүүртэй ЯГ ижил семантик. 15% давхаргалсан hold-out (n=361) дээр сургасан загвар: **0.9529** (`unknown` 52/57 = 0.912). n=361 дээр стандарт алдаа ≈ ±0.011 тул энэ тоог CV-ийн орлуулагч БИШ, **тогтмол лавлагаа** гэж үзэх ёстой.

### 2.7 ХААЛГЫН ЖАГСААЛТ — ХОЁР ШАЛГАЛТ ОРООГҮЙ

`pull_and_retrain.py:155-162` дахь бодит жагсаалт:

```python
    gates = [
        ("ТУЛГАЛТ (C# ↔ Python)", [PY, "check_parity.py", "--data",
                                   *[str(f) for f in files], "--model", str(MODEL)]),
        ("ЗАН ТӨЛӨВ (танихгүй текст)", [PY, "check_behavior.py"]),
        ("СЛОТ (хуудас ба хувь)", [PY, "check_slots.py"]),
        ("ХАРИУЛТЫН ХЭЛ", [PY, "check_lang.py"]),
        ("ЯРИА ХЭЛЦЛИЙН ТӨЛӨВ", [PY, "check_conversation.py"]),
    ]
```

Хавтсанд **7** check скрипт байхад **5** нь энд байна. Дутуу нь:

| Скрипт | Юуг батална | Шаардах багаж | Кодоос лавлагаа |
|---|---|---|---|
| **`check_fold_parity.py`** | `textfold.py` (Python) ↔ `backend/src/lib/textFold.ts` (TypeScript) эвхэлт ЯГ ижил үү | `node` (v24.18.0 суусан) | `revit-mcp/addin/TextFold.cs:18` энэ скриптийг нэрлэнэ; `textfold.py:7` мөн |
| **`check_nudge.py`** | `addin/Nudges.cs` — идэвхтэй сануулга ЧИМЭЭГҮЙ БАЙХ ЁСТОЙ тохиолдлууд | `dotnet` (10.0.301 суусан; `check_nudge.py:33` `net10.0`) | `revit-mcp/addin/Nudges.cs:19` энэ скриптийг нэрлэнэ |

Хоёулаа `revit-mcp/addin/`-ийн ЦЭВЭР ФУНКЦ давхаргыг Revit-гүйгээр тулгадаг, хоёулаа аль хэдийн суусан багаж дээр ажилладаг тул **нэмэлт хамаарал ТЭГ**.

**⚠️ Баримт бичгийн зөрүү (мэдээлэх, БҮҮ ЗАС — §0):** `revit-mcp/docs/ASSISTANT.md:330-337` дахь «ТАВАН ШАЛГАЛТ» хүснэгт нь `check_fold_parity.py`-г **тавын нэг** гэж жагсаадаг ба `check_conversation.py`-г **огт дурддаггүй**. `ASSISTANT.md:152` мөн адил. Өөрөөр хэлбэл баримт бичиг **өнөөдөр аль хэдийн буруу**.

### 2.8 БУСАД БАТАЛГААЖСАН ФАКТУУД (ажилд шаардлагатай)

| Баримт | Байршил |
|---|---|
| `check_parity.py:39` нь `train_intent`-оос `build, clean, load_rows, preprocess`-ийг **импортолдог**; `:119` дээр `X, y = clean(load_rows(list(args.data)))` | **`clean()`-ийн буцах арити 2-оос өөрчлөгдвөл 1-Р ХААЛГА УНАНА** |
| `check_behavior.py:43` нь зөвхөн `preprocess`-ийг импортолдог | Аюулгүй |
| `check_parity.py:124-126` — `max_features`-ийг **экспортолсон загварын `vocab` уртаас** уншина | Тиймээс эцсийн загвар бүх өгөгдөл дээр сургагдсан хэвээр байх ёстой |
| `clean():201` — `sorted(..., key=lambda i: (y[i], preprocess(X[i])))`, ТҮҮХИЙ текстээр БИШ | Fold-ын бүрэлдэхүүн давтагдана; эрэмбийг **бүү өөрчил** |
| `clean():205-215` — ижил текст → өөр санаа бол `SystemExit` | Чанга унадаг, сайн |
| `clean():221` — `n < 25` бол зөвхөн «⚠️ ЦӨӨН» хэвлэнэ, унахгүй | |
| `evaluate()` `n_splits < 2` үед `{}` буцаана (`:260-263`) → `pull_and_retrain.py:149` `acc = 0.0` | |
| `train_intent.py:390-397` — `report.json` = `{"version", "examples", **report}` — **датасетын мэдээлэл ТЭГ** | |
| `assistant_models` схем: `version, weights_json, intents_json, example_count, accuracy, per_intent_json, is_active, note, trained_by, created_at` (`0195:122-142`) | **Датасетын хэш/файлын жагсаалтад зориулсан багана БАЙХГҮЙ** |
| `revit.ts:1846-1851` — `activate !== false` бол өмнөхийг унтраагаад шинийг асаана; `idx_assistant_model_active` (`0195:147-148`) хоёр идэвхтэйг хориглоно | |
| `backend/src/routes/revit.ts:1703-1706` — тайлбар «12 bind/мөр → floor(100/12) = 8» гэж бичсэн атлаа `const BINDS = 13; const PER = Math.floor(100 / BINDS);` (= 7). Дараагийн тайлбарын мөр `:1705` «13 × 7 = 91 ≤ 100» гэж **зөв** байна | **Амьд зөрүү.** Энэ ажилд хамаагүй; хэрэв хэн нэгэн энэ загварыг хуулах гэвэл **тогтмолыг** ав, тайлбарыг БИШ |

Migration-ий байдал (лавлагаа): **190 файл**, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. **Энэ ажилд шинэ migration ХЭРЭГГҮЙ.**

---

## 3. ХИЙХ АЖИЛ

> Дараалал ЧУХАЛ: 1 → 2 → 3 → 4 → 5 → 6. Алхам бүрийн дараа §7-ийн команд ажиллуулж ногоон эсэхийг шалга.

### 3.1 ЭХЛЭЭД: багаж хэрэгслийг ТОГТОО (Дутуу 5)

**Шинэ файл `revit-mcp/training/requirements.txt`.** Хувилбарыг `../server/.venv/Scripts/python.exe -m pip freeze`-ээс ГАРГАЖ АВ — доорхийг сохроор бүү хуул, өөрийн машин дээрх бодит тоог бич (энэ баримтын тоо бол 2026-08-27-ны хэмжилт).

```
# MGL Revit туслах — САНАА ТАНИХ СУРГАГЧИЙН ТОГТООСОН БАГАЖ
#
# ⚠️ ЯАГААД ЯГ ТЭНЦҮҮ (==) ВЭ.  scikit-learn нь олон ангиллын анхдагч,
# IDF тэгшитгэл, n-gram зүсэлтээ бага хувилбарын шинэчлэлтэд өөрчилдөг.
# Тэр үед жин хөдөлж, `check_parity.py` (C# ↔ Python) «зөрүү» гэж
# мэдээлнэ — гэвч тэр нь sklearn-ий өөрчлөлт үү, C#-ийн жинхэнэ ухралт
# уу гэдгийг ЯЛГАХ АРГА БАЙХГҮЙ.  Тиймээс тогтооно.
#
#   ..\..\server\.venv\Scripts\python.exe -m pip install -r requirements.txt
#
# Хувилбар өргөтгөх бол: өргөтгөөд `python train_intent.py` ажиллуулж
# `report.json`-ы `accuracy` ба `check_parity.py` хоёуланг нь ХАРЬЦУУЛ.
scikit-learn==1.9.0
numpy==2.5.2
scipy==1.18.1
```

Мөн `train_intent.py`-ийн import алдааны мессежийг (`:57-61`) `pip install -r requirements.txt` руу заа.

### 3.2 МАНИФЕСТ + `source` provenance (Дутуу 3)

**(а) Шинэ файл `revit-mcp/training/datasets.manifest.json`:**

```json
{
  "_note": "ЭНЭ АЖИЛЛУУЛАЛТАД ЯМАР ДАТАСЕТ ОРОХЫГ ЯГ ЭНД БИЧНЭ. `data/`-д унасан ямар нэг .json автоматаар сургалтад ОРОХГҮЙ — энд бүртгэгдээгүй бол `pull_and_retrain.py` УНАНА. Мөрийг гараар нэмэх бол `hard-negatives.json`-д нэм; `production.json`-ыг МАШИН бичнэ.",
  "manifest_version": 1,
  "datasets": [
    { "file": "seed.json",           "source": "seed",   "required": true,  "sha256": "755f9bdeabf04e46…" },
    { "file": "bootstrap.json",      "source": "seed",   "required": true,  "sha256": "50de5b3f4d5f450a…" },
    { "file": "english.json",        "source": "seed",   "required": true,  "sha256": "2bb15dae9eff177e…" },
    { "file": "multilang.json",      "source": "seed",   "required": true,  "sha256": "6637f537bde8591d…" },
    { "file": "hard-negatives.json", "source": "manual", "required": true,  "sha256": "e7a1095837e8571b…" },
    { "file": "production.json",     "source": null,     "required": false, "sha256": null,
      "_why": "source нь МӨР ТУС БҮРД өөрийн талбартай (seed|usage|manual). sha256 = null: машин бичдэг тул тогтоохгүй, зөвхөн бүртгэнэ." }
  ]
}
```

- `sha256` — **бүтэн** 64 тэмдэгт (дээрх хураангуй нь зөвхөн жишээ). Утгыг файлаас ӨӨРӨӨ тооцоол.
- `sha256: null` = «шалгахгүй, тэмдэглэнэ». `required: false` = байхгүй бол алгасна.

**(б) `pull_and_retrain.py`: `datasets()`-ийг манифестээр солих** (`:94-96`-г орлуулна):

```python
MANIFEST = HERE / "datasets.manifest.json"

def datasets() -> tuple[list[Path], list[dict]]:
    """Манифестээс ЗӨВХӨН бүртгэгдсэн датасетыг буцаана.

    ⚠️ ЭНЭ НЬ ALLOWLIST.  Урьд нь `DATA.glob("*.json")` байсан тул `data/`-д
    унасан ямар ч файл ЧИМЭЭГҮЙ сургалтад ордог байв — буруу шошготой мөрийг
    `clean()` `dropped_bad` болгож тоолоод үлдсэнийг нь сургадаг.
    """
    spec = json.loads(MANIFEST.read_text(encoding="utf-8"))
    entries, files = [], []
    listed = set()
    for d in spec["datasets"]:
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
    # Бүртгэгдээгүй .json БАЙВАЛ УНА — чимээгүй алгасахгүй.
    stray = sorted(p.name for p in DATA.glob("*.json")
                   if p.name not in listed and p.name not in SKIP_JSON)
    if stray:
        raise SystemExit(
            "❌ Манифестад БҮРТГЭГДЭЭГҮЙ файл `data/`-д байна: " + ", ".join(stray) +
            "\n   Сургалтад оруулах бол datasets.manifest.json-д нэм; эс бөгөөс зөөж/устга.")
    return files, entries
```

`SKIP_JSON = {"report.json", "report.prev.json"}` — эдгээр нь өгөгдөл биш, тайлан (§3.5).
`main()` дотор (`:136`) `files, manifest_entries = datasets()` болгож, `manifest_entries`-ийг доор `--manifest-meta` замаар `train_intent.py`-д дамжуул (эсвэл түр JSON файлаар).

**(в) `pull_and_retrain.py:73-78` — `source`-ыг ХАДГАЛ:**

```python
    clean = [
        {"text": r["text"], "intent": r["intent"],
         "style": r.get("style") or "",
         # ⚠️ `source` нь `assistant_examples.source` (seed|usage|manual).
         # 2026-08-27 хүртэл ЭНД ХАЯГДДАГ байсан тул курацлагдсан продакшн
         # мөр ба машин үүсгэсэн үр ялгагдахгүй болдог байв.
         "source": r.get("source") or "usage",
         **({"slot": r["slot"]} if r.get("slot") else {})}
        for r in rows
        if (r.get("text") or "").strip() and (r.get("intent") or "").strip()
    ]
```

**(г) `train_intent.py` — `source`-ыг эцсээс эцэс хүртэл дамжуул.**

⚠️ **`clean()`-ийн гарын үсгийг БҮҮ ӨӨРЧИЛ** — `check_parity.py:39,:119` түүнийг импортолж 2 утга задалдаг (§2.8). Оронд нь доод давхарга нэм:

```python
def clean_records(rows: list[dict], default_source: dict[str, str] | None = None) -> list[dict]:
    """Одоогийн `clean()`-ийн БҮХ логик, гэхдээ бүтэн бичлэг буцаана.

    Буцаах бичлэг: {"text", "intent", "source", "file"}.
    """
    ...

def clean(rows: list[dict]) -> tuple[list[str], list[str]]:
    """⚠️ АРИТИ 2 хэвээр — `check_parity.py` үүнийг импортолдог."""
    recs = clean_records(rows)
    return [r["text"] for r in recs], [r["intent"] for r in recs]
```

`load_rows()` (`:148-166`) нь мөр бүрд `_file` (эх файлын нэр) залгаж, `source` талбар байхгүй бол манифестын `source`-ыг оноох. Эрэмбэ (`:201`) **өөрчлөгдөх ЁСГҮЙ** — `(intent, preprocess(text))` хэвээр.

Эх сурвалж тус бүрийн тоог хэвлэ ба тайланд бич:

```
  эх сурвалж:  seed 2356 · manual 46 · usage 0
  файлаар   :  seed.json 517 · bootstrap.json 215 · english.json 463 · multilang.json 1291 · hard-negatives.json 46
```

*(Эдгээр нь давхардал хасахаас ӨМНӨХ түүхий тоо. `clean()`-ийн дараа эх сурвалж тус бүрийн тоог ЭЦСИЙН бичлэгүүдээс тоол — 2402 нийлбэртэй байх ёстой.)*

### 3.3 ХӨЛДӨӨСӨН HOLD-OUT + АЛДАГДАЛГҮЙ CV (Дутуу 1)

**(а) Тогтвортой мөр-ID.** `train_intent.py`-д:

```python
def row_id(text: str, intent: str) -> str:
    """Тогтвортой мөрийн ID.

    ⚠️ Түлхүүр нь `clean()`-ийн ДАВХАРДАЛ ХАСАХ ТҮЛХҮҮРТЭЙ ЯГ ИЖИЛ
    (`(preprocess(text), intent)`).  Тиймээс «илгээ» ба «ilgee» нэг ID авна —
    файлын дараалал, кирилл/латин бичлэг, файл хооронд зөөх зэрэг нь ID-г
    ХӨДӨЛГӨХГҮЙ.  2402 мөр дээр 2402 өвөрмөц ID (мөргөлдөөнгүй) — хэмжсэн.
    """
    return hashlib.sha256(
        (preprocess(text) + "\x00" + intent).encode("utf-8")).hexdigest()[:16]
```

**(б) Шинэ файл `revit-mcp/training/data/eval-holdout.ids.json`** — `train_intent.py --freeze-holdout --frac 0.15 --seed 1234`-ээр НЭГ УДАА үүсгэнэ, дараа нь **хөлдөнө**:

```json
{
  "_note": "ХӨЛДӨӨСӨН ҮНЭЛГЭЭНИЙ БАГЦ. Хуучин ба шинэ загварыг ЯГ ЭНЭ мөрүүд дээр оноодог. Бүү дахин үүсгэ — үүсгэвэл өмнөх бүх оноо утгаа алдана. ID = sha256(preprocess(text) + '\\0' + intent)[:16]. Шинэ мөр нэмэхэд энэ багц ХЭВЭЭР үлдэнэ (шинэ мөр бүгд СУРГАЛТАД ордог) — ингэснээр багц томрох тусам үнэлгээ хатуурч, харьцуулалт үнэн хэвээр байна.",
  "frozen_at": "2026-08-27",
  "seed": 1234,
  "frac": 0.15,
  "ids": ["ab12cd34ef56ab78", "…"]
}
```

⚠️ `--freeze-holdout` нь **файл аль хэдийн байвал ТАТГАЛЗАХ ЁСТОЙ** (`--force` шаардах). Дахин хөлдөөх нь ухралтын түүхийг устгана.
⚠️ Энэ файл `data/`-д байх тул §3.2-ын `SKIP_JSON`-д ЗААВАЛ орох ёстой (эсвэл `data/`-аас гадуур байрлуул).

**(в) `evaluate()`-ийг хоёр хуваа** (`train_intent.py:256-312`):

```python
def evaluate_cv(X, y, max_features) -> dict:
    """ХОЁРДОГЧ ДОХИО — vectorizer нь Pipeline-ий ДОТОР.

    ⚠️ Урьд нь `vec.fit_transform(X)`-ийг CV-ЭЭС ГАДНА дуудаж, зөвхөн `clf`-ийг
    хуваадаг байв.  Тэгэхэд үгсийн сангийн сонголт (max_features), `min_df=2`
    тайралт, IDF вектор ГУРВУУЛАА тест fold-ын мөрүүдийг үзсэн байдаг —
    мэдээлж буй тоо түүврийн ГАДНАХ тоо БИШ.  2026-08-27-нд ХЭМЖСЭН:
    хазайлт 0.9403 → 0.9366 = +0.0037, `unknown` дээр +0.026.
    Хурд нь ч МУУДААГҮЙ: 4.6 сек → 2.9 сек (fold бүр 80%-ийг л вектор болгодог).
    """
    vec, clf = build(max_features)
    pipe = Pipeline([("vec", vec), ("clf", clf)])
    ...  # RepeatedStratifiedKFold(5, n_repeats=5, random_state=42) — өмнөх шиг
```

```python
def evaluate_frozen(recs, holdout_ids, max_features) -> dict:
    """АНХДАГЧ ДОХИО — ХӨЛДӨӨСӨН багц дээрх оноо.

    Hold-out мөрүүдийг ХАССАН өгөгдөл дээр загвар сургаж, hold-out дээр оноодог.
    Энэ бол `pull_and_retrain.py`-ийн ухралтын хамгаалалт ХАРЬЦУУЛАХ цорын
    ганц тоо: хуучин ба шинэ загвар ЯГ ИЖИЛ мөрүүд дээр оноогдоно.

    ⚠️ ЭНЭ ЗАГВАР ЭКСПОРТЛОГДОХГҮЙ.  Экспортын загвар нь БҮХ өгөгдөл дээр
    сургагдана (§3.3г) — `check_parity.py:124-126` нь vocab-ийн уртаас
    `max_features`-ийг уншдаг тул зөрвөл 1-Р ХААЛГА ХУДАЛ УНАНА.
    """
    ...
    return {
        "frozen_accuracy": ...,
        "frozen_per_intent": {...},
        "frozen_n": len(eval_rows),
        "frozen_missing_ids": ...,   # текст засагдсан тул ID алдагдсан мөрийн тоо
    }
```

**Алдагдсан ID-ийн хамгаалалт:** хөлдөөсөн ID-ийн 10%-иас илүү нь одоогийн өгөгдөлд олдохгүй бол **чанга уна** — үгүй бол хэн нэгэн текст засаад hold-out чимээгүй хоосорно.

**(г) Эцсийн экспорт БҮХ өгөгдөл дээр сургагдсан хэвээр** — `train_intent.py:371-372` **ХЭВЭЭР ҮЛДЭНЭ**. Энэ нь §4.3-ын шалтгаанаар load-bearing.

**(д) `report.json`-ы шинэ бүтэц** (`train_intent.py:390-397`):

```json
{
  "version": "2026-08-27.1-3f9a1c02",
  "examples": 2402,
  "frozen_accuracy": 0.9529,
  "frozen_per_intent": { "unknown": 0.912, "…": 0.0 },
  "frozen_n": 361,
  "frozen_missing_ids": 0,
  "accuracy": 0.9366,
  "accuracy_std": 0.0100,
  "per_intent": { "…": 0.0 },
  "folds": 5, "repeats": 5,
  "dataset_sha256": "3f9a1c02…",
  "dataset_files": [{ "file": "seed.json", "sha256": "…", "rows": 517, "source": "seed" }],
  "source_counts": { "seed": 2356, "manual": 46, "usage": 0 },
  "trained_at": "2026-08-27T14:02:11+08:00",
  "toolchain": { "python": "3.12.10", "scikit_learn": "1.9.0", "numpy": "2.5.2", "scipy": "1.18.1" },
  "git_sha": "d7fecf5"
}
```

⚠️ `accuracy` түлхүүрийн НЭР хэвээр үлдэнэ (`pull_and_retrain.py:149` уншина) — гэхдээ утга нь одоо **алдагдалгүй** тоо. `git_sha` — `git rev-parse --short HEAD`, амжилтгүй бол `null` (`subprocess` унахыг зөвшөөр).

### 3.4 ХУВИЛБАРЫН МӨРГӨЛДӨӨН + PROVENANCE ЭКСПОРТ (Дутуу 4)

**(а) Хувилбарын мөр** — `train_intent.py:374`-ийг сольж:

```python
def dataset_hash(entries: list[dict], recs: list[dict]) -> str:
    """Датасетын АГУУЛГЫН хэш.  Файлын хэш + мөрийн тоо."""
    h = hashlib.sha256()
    for e in sorted(entries, key=lambda x: x["file"]):
        h.update(f"{e['file']}:{e['sha256']}\n".encode())
    h.update(f"rows={len(recs)}\n".encode())
    return h.hexdigest()

# ⚠️ 2026-08-27 хүртэл: `date.today().isoformat() + ".1"` — «.1» нь ХАТУУ
# бичсэн литерал, тоолуур БИШ.  Тиймээс нэг өдрийн БҮХ сургалт `<огноо>.1`
# нэртэй байв.  Сервер `ON CONFLICT (version) DO UPDATE` (revit.ts:1826) —
# хоёр дахь нь ДАРЖ БИЧНЭ; add-in `have === row.version` (revit.ts:1765) —
# аль хэдийн татсан машин ХУУЧИН жинтэй үлдэнэ.  Хоёулаа ижил нэртэй.
# Датасетын хэш нэмснээр өгөгдөл өөрчлөгдсөн бол нэр АЛЬ ХЭДИЙН өөр болно.
version = args.version or f"{date.today().isoformat()}.1-{ds_hash[:8]}"
```

**Формат:** `2026-08-27.1-3f9a1c02` = 22 тэмдэгт. Хязгаарууд:
- `revit.ts:1802` `str(body.version, 64)` — 64 тэмдэгтээс богино ✅
- `ApiClient.cs:145` `Uri.EscapeDataString(have)` — `[A-Za-z0-9.-]` тул escape хийгдэхгүй ✅
- **`+`, `_`, зай, кирилл БҮҮ АШИГЛА.**

⚠️ Датасет **ЯГ ИЖИЛ** байхад дахин сургахад хувилбар ижил гарна — тэр нь **ЗӨВ**: ижил өгөгдөл + тогтоосон багаж = ижил жин, тиймээс дарж бичихэд асуудалгүй. (Гиперпараметр өөрчлөгдөх тохиолдлыг §9.2-т үз.)

**(б) Экспортын JSON-д provenance нэм** — `train_intent.py:332-344`-ийн `return` толь. **§2.5(г) дээр батлагдсан: одоо суусан add-in бүр танихгүй түлхүүрийг чимээгүй алгасна, тиймээс релиз ШААРДЛАГАГҮЙ.**

```python
    return {
        "version": version,
        "intents": intents,
        "preprocess": PREPROCESS_CONTRACT,
        "ngram_min": NGRAM_MIN,
        "ngram_max": NGRAM_MAX,
        "vocab": vocab,
        "idf": idf,
        "coef": [...],
        "intercept": [...],
        # --- ШИНЭ: provenance.  ⚠️ `IntentModelData` (addin/IntentModel.cs:22-40)
        # -д [JsonExtensionData] БАЙХГҮЙ, UnmappedMemberHandling.Disallow
        # БАЙХГҮЙ (`:153` анхдагч сонголтоор Deserialize) — System.Text.Json
        # танихгүй түлхүүрийг ЧИМЭЭГҮЙ алгасна.  Хуучин add-in эвдрэхгүй.
        "dataset_sha256": ds_hash,
        "dataset_files": [{"file": e["file"], "sha256": e["sha256"], "rows": e["rows"]}
                          for e in entries],
        "row_count": len(recs),
        "source_counts": source_counts,
        "trained_at": trained_at,
        "toolchain": toolchain,
        "git_sha": git_sha,
    }
```

Хэмжээ: ~5 датасет × ~100 байт ≈ 1 KB — `weightsJson.length > 5_000_000` хязгаараас (`revit.ts:1817`) хол доогуур ✅

**(в) `note` талбар** — `pull_and_retrain.py:198`. Сервер `str(body.note, 500)` (`revit.ts:1843`) 500 тэмдэгтээр тайрна, тиймээс НЯГТ бич:

```python
note = args.note or (
    f"ds={ds_hash[:8]} rows={n} src={source_counts} "
    f"frozen={frozen_acc:.4f} cv={acc:.4f} sk={toolchain['scikit_learn']} git={git_sha}")[:500]
```

### 3.5 УХРАЛТЫН ХАМГААЛАЛТЫГ EARLY-RETURN-ЫН ДЭЭР ЗӨӨХ (Дутуу 2)

`pull_and_retrain.py` — `:173-188` блокыг `:169`-ийн ӨМНӨ зөө. Мөн хоёр горим болго:

```python
    # --- 4. Ухралтын хамгаалалт --------------------------------------
    # ⚠️ ЭНЭ БЛОК `if not args.publish: return`-ЫН ДЭЭР БАЙХ ЁСТОЙ.
    # 2026-08-27 хүртэл доор нь байсан тул docstring-д баримтжуулсан
    # `--offline` урсгал ХЭЗЭЭ Ч энэ хаалгыг ажиллуулдаггүй байв.
    if token:
        try:
            cur = api(args.host, token, "/api/revit/assistant/model")
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            cur = None
            print("   (идэвхтэй загвар алга — анхны нийтлэлт)")
        except Exception as e:                       # noqa: BLE001
            print(f"   ⚠️ ухралтын шалгалт алгаслаа ({e})", file=sys.stderr)
            cur = None
    else:
        # ⚠️ `--offline` үед токен байхгүй байж БОЛНО.  Тэр үед харьцуулах
        # суурь нь СЕРВЕР биш, СҮҮЛИЙН ЛОКАЛ тайлан.
        cur = local_baseline()      # data/report.prev.json (доор)
        if cur is None:
            print("   ⚠️ харьцуулах суурь алга — ухралтын шалгалт хийгдсэнгүй")

    problems = regression_problems(cur, report, args.max_drop, args.max_drop_intent)
    for p in problems:
        print("   ❌ " + p, file=sys.stderr)
    if problems:
        if args.publish:
            raise SystemExit("\n❌ УХРАЛТ — НИЙТЛЭХГҮЙ.  `/assistant/pending`-ийг хараарай.")
        print("   ⚠️ УХРАЛТ илэрлээ (--publish өгөөгүй тул зөвхөн анхааруулга)")
    elif cur:
        print("   ухралтын шалгалт: ✅")

    if not args.publish:
        print("   (--publish өгөөгүй тул серверт илгээгээгүй)")
        return
```

`regression_problems()` нь **ГУРВАН** зүйл барина:

| Шалгалт | Босго | Яагаад |
|---|---|---|
| Хөлдөөсөн багцын ерөнхий нарийвчлал | `--max-drop` (анхдагч 0.02) | Одоогийнхтой ижил, гэхдээ ижил мөр дээр |
| **Санаа тус бүр** | ШИНЭ `--max-drop-intent` (санал болгох 0.05) | Ганц санаа сүйрч, ерөнхий тоо босгын доор хөдлөх боломжтой — §2.2 |
| Хөлдөөсөн ID-ийн алдагдал | > 10% бол уна | Hold-out чимээгүй хоосрохоос сэргийлнэ |

⚠️ **Сервер ба локал суурь нь ӨӨР талбартай.** `GET /api/revit/assistant/model` нь `accuracy` (`revit.ts:1770`) буцаана — тэр нь ХУУЧИН, CV-ийн тоо. `frozen_accuracy` серверт БАЙХГҮЙ. Тиймээс:
- **Сервертэй харьцуулахдаа** `accuracy ↔ accuracy` (хоёулаа CV) — цэвэр биш ч байгаа зүйл.
- **Локал `report.prev.json`-той харьцуулахдаа** `frozen_accuracy ↔ frozen_accuracy` — ЭНЭ нь чанартай харьцуулалт.
- Хоёулаа байвал **хоёуланг нь** шалга; аль нэг нь босго давбал асуудал гэж тоол.

**Локал суурь** — `data/report.prev.json`: `train_intent.py` шинэ тайлан бичихийн ӨМНӨ одоогийн `report.json`-ыг `report.prev.json` болгож хуулна. Ингэснээр офлайн ажлын урсгал ч харьцуулах юмтай болно. `report.prev.json` нь §3.2-ын `SKIP_JSON`-д орно.

**`--offline --publish` алдааг зас** (`:123-124`): `--publish` өгсөн атлаа токенгүй бол `main()`-ий эхэнд ойлгомжтой `SystemExit` шид.

### 3.6 ДУТУУ ХОЁР ХААЛГЫГ НЭМЭХ

`pull_and_retrain.py:155-162` дахь `gates` жагсаалтад нэм:

```python
    gates = [
        # ⚠️ Эвхэлтийн тулгалт ЭХЭНД: `textfold.py` ↔ `backend/src/lib/textFold.ts`
        # зөрвөл `check_parity.py` (C# ↔ Python) ч утгагүй болно — гурван
        # хослолын нэг нь тасарсан гэсэн үг.  `node` шаардана.
        ("ЭВХЭЛТ (Python ↔ TypeScript)", [PY, "check_fold_parity.py"]),
        ("ТУЛГАЛТ (C# ↔ Python)", [PY, "check_parity.py", "--data",
                                   *[str(f) for f in files], "--model", str(MODEL)]),
        ("ЗАН ТӨЛӨВ (танихгүй текст)", [PY, "check_behavior.py"]),
        ("СЛОТ (хуудас ба хувь)", [PY, "check_slots.py"]),
        ("ХАРИУЛТЫН ХЭЛ", [PY, "check_lang.py"]),
        ("ЯРИА ХЭЛЦЛИЙН ТӨЛӨВ", [PY, "check_conversation.py"]),
        # ⚠️ `addin/Nudges.cs`-ийн ЦЭВЭР ФУНКЦ давхарга.  Ихэнх тохиолдол нь
        # «ЧИМЭЭГҮЙ БАЙХ ЁСТОЙ» — уйтгартай сануулга нь хүнийг add-in-ыг
        # бүхэлд нь унтраахад хүргэдэг.  `dotnet` шаардана.
        ("ИДЭВХТЭЙ САНУУЛГА", [PY, "check_nudge.py"]),
    ]
```

Шаардах багаж: `node` (v24.18.0 суусан), `dotnet` (10.0.301 суусан) — **нэмэлт суулгалт ХЭРЭГГҮЙ**. Docstring `:15-21`-ийн «ТАВАН ХААЛГА»-г **ДОЛОО** болго.

⚠️ `check_fold_parity.py:34` ба `check_behavior.py:135` нь **өөрсдийн** glob-той. Тэднийг манифест руу шилжүүлэх нь ЗӨВ, гэхдээ **ЗААВАЛ БИШ** — тэд зөвхөн ЛАВЛАГАА корпус гэж уншдаг, сургадаггүй. Хэрэв цаг байвал зөөж, `check_parity.py:39`-ийн импортыг эвдэхгүйг ҮРГЭЛЖ шалга. (Ядаж `eval-holdout.ids.json` ба `report.prev.json` тэдгээрийн glob-д орохыг шалга — хоёулаа `rows` массивгүй тул `:37-38` / `:137-138` дээр чимээгүй алгасагдана, өөрөөр хэлбэл эвдрэхгүй.)

### 3.7 (ХИЛИЙН ГАДНА — эзэмшигч зөвшөөрөхөөс нааш БҮҮ ХИЙ)

| Юу | Файл | Яагаад мэдээлэх ёстой вэ |
|---|---|---|
| `check_conversation.py` баримтад алга, `check_fold_parity.py` буруу байрлалд | `revit-mcp/docs/ASSISTANT.md:152`, `:330-337` | Хаалганы жагсаалт өнөөдөр аль хэдийн БУРУУ; §3.6-ын дараа улам буруу болно |
| `data/production.json` **`.gitignore`-д БАЙХГҮЙ** | `revit-mcp/.gitignore` | Тэр файл нь **инженерийн бичсэн түүхий текст** агуулна (`0195_assistant_learning.sql:17` НУУЦЛАЛЫН тэмдэглэл). Анхны `pull` ажиллахад санамсаргүй commit хийгдэх боломжтой |

Хоёуланг нь §9-ийн жагсаалтад оруулж эзэмшигчид **тайлагна** — энэ сесс ЗАСАХГҮЙ.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

### 4.1 `PREPROCESS_CONTRACT = "fold-v1"` — БҮҮ ХӨНД

Энэ бол **бүх шугам дахь цорын ганц зөв ажиллаж байгаа хамгаалалт** — архитектурын хүсэж буй зүйл: **таарахгүй загвар ЧИМЭЭГҮЙ буруу таамаглахын оронд ТАТГАЛЗАГДДАГ.**

| Тал | Байршил |
|---|---|
| Python | `revit-mcp/training/train_intent.py:80` — `PREPROCESS_CONTRACT = "fold-v1"`; `export():337` дээр `"preprocess"` түлхүүрээр JSON-д бичигдэнэ |
| C# | `revit-mcp/addin/IntentModel.cs:80` — `public const string PreprocessContract = "fold-v1";` |
| Хэрэгжилт | `IntentModel.cs:163-164` — `if (!string.Equals(m.PreprocessContract, PreprocessContract, StringComparison.Ordinal)) return null;` |

Мөн `SaveDownloaded()` (`IntentModel.cs:170-185`) нь диск дээр бичихийн ӨМНӨ `Parse()`-ыг дуудна (`:174`) — **гэрээ зөрсөн загвар диск дээр ХҮРЭХГҮЙ** (`ApiClient.cs:165-168` тайлбар үүнийг тодорхой хэлнэ). Ямар ч тохиолдолд `preprocess()` (`train_intent.py:99-123`), `textfold.py`, `IntentModel.Preprocess()` (`:217-223`), `TextFold.cs` — **дөрвүүлээ ЭНЭ ажлын гадна**.

### 4.2 `clean()`-ийн буцах арити = 2

`check_parity.py:39` — `from train_intent import build, clean, load_rows, preprocess`
`check_parity.py:119` — `X, y = clean(load_rows(list(args.data)))`

Арити өөрчлөгдвөл **1-р хаалга шууд унана**. §3.2(г)-ийн `clean_records()` давхарга нь яг үүнээс сэргийлнэ.

### 4.3 Эцсийн экспорт нь БҮХ өгөгдөл дээр сургагдсан хэвээр байх ёстой

`check_parity.py:124-126` нь `max_features`-ийг **экспортолсон загварын `vocab` уртаас** уншина:

```python
    model_json = json.loads(io.open(args.model, encoding="utf-8").read())
    max_features = len(model_json.get("vocab") or {}) or 6000
```

Дараа нь `build(max_features)`-ээр Python талыг **бүх `--data` дээр** дахин сургаж, C# гаралттай тулгана. Хэрэв экспортын загвар hold-out хассан өгөгдөл дээр сургагдвал `check_parity.py`-ийн Python тал ӨӨР загвар болж, «C# буруу» гэсэн **ХУДАЛ ухралт** мэдээлнэ. (Яг ийм худал дохио 2026-08-25-нд нэг удаа болсныг `check_parity.py:126-131` тайлбар бичсэн.)

**⇒ `evaluate_frozen()`-ий сургасан загвар нь ХАЯГДАХ загвар. Экспорт нь `train_intent.py:371-372` дээрх бүх өгөгдлийн сургалт хэвээр.**

### 4.4 `clean()`-ийн эрэмбэ ба давхардал хасах түлхүүр

- `:186` `key = (preprocess(text), intent)` — эвхсэн хэлбэрээр давхардал хасна.
- `:201` `sorted(range(len(X)), key=lambda i: (y[i], preprocess(X[i])))` — **ТҮҮХИЙ текстээр БИШ**.

Тайлбар `:194-200` нь яагаадыг тайлбарладаг: файлын дараалал өөрчлөгдөхөд fold-ын бүрэлдэхүүн өөрчлөгдөж нарийвчлал ±0.02 хэлбэлздэг байв. `source`/`file` талбар нэмэх нь **эрэмбэнд ОРОХ ЁСГҮЙ**.

⚠️ Мөн: давхардал хасалт нь **аль файл эхэлж уншигдсанаас** хамаарна. Манифестын дараалал өөрчлөгдвөл «аль хуулбар үлдэх» нь өөрчлөгдөж болно. Онцлогийн матриц ижил (эвхэлт ижил) тул нарийвчлалд нөлөөлөхгүй, ГЭХДЭЭ мөрийн `source` шошго өөрчлөгдөнө. **Манифестын дараалал = давхардал хасалтын тэргүүлэх эрэмбэ.** Илүү өндөр итгэлтэй эх сурвалжийг ДЭЭР тавь (`hard-negatives.json` ба `production.json` дээгүүр).

### 4.5 Тогтоосон санамсаргүй үр

`random_state=42` (`:269`, `:275`), `n_repeats=5`. Эдгээрийг **бүү өөрчил** — `report.json`-ы түүхэн тоотой харьцуулах чадвар алдагдана. Hold-out-ын үр (1234) нь ТУСДАА бөгөөд нэг л удаа ашиглагдана.

### 4.6 Add-in-ий тал БҮХЭЛДЭЭ

`revit-mcp/addin/` дотор **нэг ч тэмдэгт бүү өөрчил**. Add-in-ий бүх C# өөрчлөлт **1C-ийн НЭГ релизэд** багцлагддаг; ~20 компьютер, `Install.bat`, Revit хаагдсан байх шаардлагатай, автомат шинэчлэлт БАЙХГҮЙ. Энэ ажлын БҮХ шийдэл нь **add-in-гүйгээр** ажиллах ёстой бөгөөд §2.5(г) дээр яг үүнийг баталсан.

### 4.7 Backend-ийн эрхийн дүрэм ба токен

- `GET /api/revit/assistant/export` — `requireAdmin()` (`revit.ts:1974`). `POST /api/revit/assistant/models` — `requireAdmin()` (`revit.ts:1785`). `MGL_TOKEN` нь **admin** байх ёстой.
- **`verifyToken` / `authMiddleware`-ийг `purpose === 'mcp'`-ийг татгалзахаар ХЭЗЭЭ Ч бүү чангатга.** Add-in бүх REST дуудлагаа тэр токеноор баталгаажуулдаг бөгөөд refresh урсгал БАЙХГҮЙ. Энэ бол алсаас сэргээх боломжгүй ЦОРЫН ГАНЦ өөрчлөлт. (Энэ ажилд хамаагүй, гэхдээ хажуугаар «цэвэрлэх» уруу таталт гарч болзошгүй.)

### 4.8 `hard-negatives.json`-ы 46 мөр

`check_behavior.py:20-25` тодорхой бичсэн: «`data/hard-negatives.json` үүнийг зассан; тэр мөрүүдийг **ХАСАЖ БОЛОХГҮЙ**». «ирцээ бүртгүүлье» → `submit_progress` 0.58 гэсэн БОДИТ продакшны алдааг эдгээр мөр зассан. Манифестад `required: true` байх ёстой.

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### 5.1 Урьдчилсан нөхцөл

| Нөхцөл | Заавал юу | Тайлбар |
|---|---|---|
| 1A бүрэн дууссан | ✅ Программын дүрэм | Аюулгүй байдал эхэнд |
| 1B-1/1B-2/1B-3 | ❌ **ШААРДАХГҮЙ** | Энэ ажил D1-д хүрэхгүй, схем шаардахгүй |
| `python`, `node`, `dotnet` суусан | ✅ | 3.12.10 / v24.18.0 / 10.0.301 — бүгд байгаа |
| `MGL_TOKEN` (admin) | ⚠️ ЗӨВХӨН §9-ийн нэг асуултад | Кодын өөрчлөлтөд ХЭРЭГГҮЙ; бүх ажлыг `--offline`-оор хийж болно |

### 5.2 Deploy дараалал

**Deploy ТЭГ.** Backend deploy, migration, `wrangler` команд, add-in релиз — **ЮУ Ч БАЙХГҮЙ.**

«Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарах ёстой» гэсэн дүрэм энд **үйлчлэхгүй**, учир нь шинэ багана байхгүй. `assistant_models`-д датасетын хэш/файлын жагсаалтад зориулсан багана НЭМЭХГҮЙ (§2.8) — provenance нь `weights_json` дотор ба `note` дотор явна. Тэр шийдвэрийн шалтгаан: `weights_json` руу шинэ түлхүүр нэмэх нь **аль хэдийн батлагдсан аюулгүй** (§2.5г), харин шинэ багана нь migration + deploy + унших код гэсэн гурван алхмыг шаардана.

### 5.3 Энэ ажлын дараа

| Юу | Хэзээ |
|---|---|
| **1B-5 (golden datasets)** | ЭНЭ ажил дууссаны ДАРАА. Манифест ба хөлдөөсөн hold-out нь golden багцын суурь |
| **1B-3 (assistant_logs provenance)** | Зэрэгцээ явж болно. `AssistantLog.cs:185` нь `ModelVersion` илгээдэг ч сервер `revit.ts:1706-1721`-ийн 13 bind дотор түүнийг **хадгалдаггүй**. Датасетын хэш бүхий хувилбар нь тэр багананд утга ОРУУЛАХ болно — 1B-3 хийгдэхгүй бол шинэ хувилбарын мөр ч бас хаягдсан хэвээр |
| **1C add-in релиз** | Энэ ажлаас C#-ийн өөрчлөлт ГАРАХГҮЙ |

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

Хүн шалгаж болох объектив жагсаалт. Бүгд ✅ болтол дуусаагүй.

**A. Хамрах хүрээ**
- [ ] `git status --porcelain` нь ЗӨВХӨН эдгээрийг харуулна: `revit-mcp/training/train_intent.py` (M), `revit-mcp/training/pull_and_retrain.py` (M), `revit-mcp/training/datasets.manifest.json` (??), `revit-mcp/training/requirements.txt` (??), `revit-mcp/training/data/eval-holdout.ids.json` (??), `revit-mcp/training/data/report.prev.json` (??), `revit-mcp/training/data/report.json` (M), `revit-mcp/addin/Resources/intent-model.json` (M — сургалт ажиллуулсны шууд үр дүн). Өмнөх сессийн бохирдол нэмэгдээгүй.
- [ ] `git diff --stat -- backend/ frontend/` нь **хоосон**.
- [ ] `git diff --stat -- revit-mcp/addin/` нь ЗӨВХӨН `Resources/intent-model.json`-ыг харуулна (`.cs` файл БАЙХГҮЙ).
- [ ] `backend/migrations/`-д шинэ файл БАЙХГҮЙ; хамгийн өндөр нь `0200_assistant_feedback_note.sql` хэвээр.

**B. Багаж тогтоолт**
- [ ] `revit-mcp/training/requirements.txt` байгаа, гурван мөр нь `==`-тэй (`>=` БИШ).
- [ ] `report.json`-ы `toolchain` нь суусан хувилбартай ЯГ таарна.

**C. Манифест ба provenance**
- [ ] `datasets.manifest.json` нь **яг 6** оруулга (5 required + `production.json` optional).
- [ ] `data/`-д `manifest.json`-д бүртгэгдээгүй `.json` унагавал (`echo '{"rows":[]}' > data/zzz-test.json`) `pull_and_retrain.py --offline` нь **чанга унана** ба `zzz-test.json` нэрийг мессежид дурдана. *(Тестийн дараа файлыг УСТГА.)*
- [ ] `seed.json`-ы нэг байтыг өөрчилвөл sha256 зөрүү мэдээлэгдэж унана.
- [ ] `report.json` нь `dataset_sha256`, `dataset_files`, `source_counts`, `trained_at`, `toolchain`, `git_sha` агуулна.
- [ ] `source_counts` нь `seed`/`manual`/`usage`-г ЯЛГАНА (одоо: `seed 2356 · manual 46 · usage 0`, нийлбэр 2402).

**D. Алдагдалгүй үнэлгээ**
- [ ] `report.json`-ы `accuracy` нь **0.9366 ± 0.002** (одоогийн 0.9403 БИШ). Энэ бол алдагдал арилсны ажиглагдах гарын үсэг.
- [ ] `report.json` нь `frozen_accuracy`, `frozen_per_intent`, `frozen_n`, `frozen_missing_ids` агуулна.
- [ ] `data/eval-holdout.ids.json` нь ~361 өвөрмөц ID агуулна; `--freeze-holdout`-ыг `--force`-гүй дахин ажиллуулбал **татгалзана**.
- [ ] Экспортын `intent-model.json`-ы `vocab` урт нь `--max-features` (12000) хэвээр — өөрөөр хэлбэл эцсийн загвар БҮХ өгөгдөл дээр сургагдсан.

**E. Хувилбар**
- [ ] `report.json`-ы `version` нь `^\d{4}-\d{2}-\d{2}\.\d+-[0-9a-f]{8}$` загварт нийцнэ.
- [ ] Урт ≤ 64 тэмдэгт; зөвхөн `[A-Za-z0-9.-]`.
- [ ] Датасетыг ӨӨРЧЛӨӨД дахин сургахад **өөр** хувилбар гарна; өөрчлөхгүйгээр дахин сургахад **ижил** хувилбар гарна.
- [ ] `intent-model.json` нь `dataset_sha256`, `dataset_files`, `row_count`, `source_counts`, `trained_at`, `toolchain`, `git_sha` агуулна.

**F. Хамгаалалт**
- [ ] `--publish`-гүйгээр ажиллуулахад ухралтын шалгалтын гаралт **ХАРАГДАНА** (өмнө нь харагддаггүй байсан).
- [ ] `data/report.prev.json`-ы `frozen_accuracy`-г гараар 0.99 болгож өөрчлөөд `--offline` ажиллуулбал «⚠️ УХРАЛТ илэрлээ» гарна; `--publish`-тай бол `SystemExit`. *(Тестийн дараа сэргээ.)*
- [ ] `report.prev.json`-ы `frozen_per_intent.unknown`-ыг 0.99 болгоход **санаа тус бүрийн** ухралт баригдана (ерөнхий тоо хөдлөөгүй ч).
- [ ] `--offline --publish` токенгүйгээр ажиллуулахад **ойлгомжтой** мессежээр унана (401 traceback БИШ).

**G. Хаалганууд**
- [ ] `gates` жагсаалт **7** оруулгатай; `check_fold_parity.py` ба `check_nudge.py` орсон.
- [ ] `pull_and_retrain.py --offline` бүрэн ажиллаж, долоон хаалга бүгд «✅ ДАВСАН».
- [ ] `check_parity.py` ЯМАР Ч зөрүүгүй (энэ нь `clean()`-ийн арити эвдрээгүйг батална).

---

## 7. ШАЛГАХ КОМАНД

> PowerShell, репогийн үндэс `C:\Users\User\project\mgl-e-c`. Python нь `revit-mcp/server/.venv` дотор — `revit-mcp/training/` нь өөрийн venv-гүй.
> ⚠️ Доорх замууд `revit-mcp\training`-аас харьцангуй: интерпретатор нь `..\server\.venv\Scripts\python.exe`. (Репод бичигдсэн зарим docstring `..\..\server\...` гэж бичдэг нь `training\` доторх дэд хавтаснаас бичигдсэн — өөрийн ажиллаж буй хавтсаа шалга.)

```powershell
# --- 0. ЭХЛЭХИЙН ӨМНӨ: бохирдлыг тэмдэглэ -----------------------------
cd C:\Users\User\project\mgl-e-c
git rev-parse --short HEAD
git status --porcelain

# --- 1. Багаж хэрэгслийн БОДИТ хувилбар ------------------------------
cd revit-mcp\training
..\server\.venv\Scripts\python.exe -c "import sys,platform,sklearn,numpy,scipy; sys.stdout.reconfigure(encoding='utf-8'); print(platform.python_version(), sklearn.__version__, numpy.__version__, scipy.__version__)"
node --version
dotnet --version

# --- 2. Одоогийн (алдагдалтай) суурийг ДАХИН ҮРЖҮҮЛ -------------------
#     Хүлээгдэх: accuracy 0.9403, accuracy_std 0.0098, examples 2402
..\server\.venv\Scripts\python.exe train_intent.py `
    --data data\seed.json data\bootstrap.json data\english.json data\multilang.json data\hard-negatives.json `
    --out ..\addin\Resources\intent-model.json --report data\report.json
type data\report.json

# --- 3. Мөрийн тоо ба хэшийг ӨӨРӨӨ тоол ------------------------------
..\server\.venv\Scripts\python.exe -c "import json,glob,hashlib,sys; sys.stdout.reconfigure(encoding='utf-8'); [print(f, (len(o['rows']) if isinstance(o,dict) and 'rows' in o else '-'), hashlib.sha256(open(f,'rb').read()).hexdigest()[:16]) for f in sorted(glob.glob('data/*.json')) for o in [json.loads(open(f,'rb').read().decode('utf-8-sig'))]]"

# --- 4. АЛДАГДЛЫН ХЭМЖЭЭГ ХЭМЖИХ (энэ сессийн ЗААВАЛ хийх зүйл) ------
#     A = одоогийн, B = Pipeline.  Хүлээгдэх: 0.9403 vs 0.9366, Δ=+0.0037
#     ⚠️ Скриптийг scratchpad-д бич, репод БҮҮ ОРХИ.
..\server\.venv\Scripts\python.exe $env:TEMP\leak.py

# --- 5. Өөрчлөлтийн дараа: БҮТЭН гогцоо, ДОЛООН хаалга ---------------
..\server\.venv\Scripts\python.exe pull_and_retrain.py --offline
#   Хүлээгдэх гаралт:
#     Сургалтын файлууд: • seed.json … (манифестын дараалал)
#     эх сурвалж: seed 2356 · manual 46 · usage 0
#     хувилбар 2026-…-…-xxxxxxxx · 2402 жишээ · нарийвчлал 0.9366
#     хөлдөөсөн багц: 0.95xx (n=361, алдагдсан ID 0)
#     ── ЭВХЭЛТ … ✅ ДАВСАН     (×7)
#     ухралтын шалгалт: ✅   ← ⚠️ ЭНЭ МӨР ӨМНӨ НЬ ХАРАГДДАГГҮЙ БАЙСАН
#     (--publish өгөөгүй тул серверт илгээгээгүй)

# --- 6. Манифестын ALLOWLIST-ийг БАТАЛ (сөрөг тест) ------------------
'{"rows":[]}' | Out-File -Encoding utf8 data\zzz-test.json
..\server\.venv\Scripts\python.exe pull_and_retrain.py --offline    # УНАХ ЁСТОЙ
Remove-Item data\zzz-test.json

# --- 7. sha256 хамгаалалтыг БАТАЛ ------------------------------------
Copy-Item data\seed.json data\seed.bak
Add-Content data\seed.json " "
..\server\.venv\Scripts\python.exe pull_and_retrain.py --offline    # УНАХ ЁСТОЙ
Move-Item -Force data\seed.bak data\seed.json

# --- 8. Ухралтын хамгаалалтыг БАТАЛ ----------------------------------
Copy-Item data\report.prev.json data\report.prev.bak
#   report.prev.json дотор frozen_accuracy = 0.99 болго, дараа нь:
..\server\.venv\Scripts\python.exe pull_and_retrain.py --offline    # ⚠️ УХРАЛТ гарах ёстой
Move-Item -Force data\report.prev.bak data\report.prev.json

# --- 9. Хувилбарын формат ---------------------------------------------
..\server\.venv\Scripts\python.exe -c "import json,re,sys; sys.stdout.reconfigure(encoding='utf-8'); v=json.load(open('data/report.json',encoding='utf-8'))['version']; print(v, len(v), bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}\.\d+-[0-9a-f]{8}', v)))"

# --- 10. Add-in-ий JSON ХЭВЭЭР уншигдаж байгааг БАТАЛ ---------------
#     check_parity.py нь экспортолсон загварыг C#-аар уншиж таамаглуулдаг —
#     танихгүй түлхүүр эвдэл үүсгэвэл ЭНД баригдана.
..\server\.venv\Scripts\python.exe check_parity.py `
    --data data\seed.json data\bootstrap.json data\english.json data\multilang.json data\hard-negatives.json `
    --model ..\addin\Resources\intent-model.json

# --- 11. ХАМРАХ ХҮРЭЭГ БАТАЛ -----------------------------------------
cd C:\Users\User\project\mgl-e-c
git status --porcelain
git diff --stat -- backend/ frontend/                       # ХООСОН байх ёстой
git diff --stat -- revit-mcp/addin/                         # зөвхөн intent-model.json
```

**ЭНЭ АЖИЛД АЖИЛЛУУЛАХГҮЙ:** `npx wrangler deploy`, `npx wrangler d1 migrations apply`, `npx -y wrangler@latest pages deploy`, `pull_and_retrain.py --publish`.

---

## 8. ROLLBACK

**Шинэ migration ХЭРЭГГҮЙ.** Энэ ажил D1-д хүрэхгүй, схем өөрчлөхгүй, deploy хийхгүй — тиймээс `backend/migrations/`-ийн append-only дүрэм, `wrangler d1 migrations apply`-ийн транзакцийн CASCADE урхи (`users` 27 cascading хүүхэд, `projects` 38), «ALTER-ийг блокийн эхэнд тавь» дүрэм, `END;` том үсгийн терминатор — **бүгд энэ ажилд ХАМААРАХГҮЙ**.

| Юуг буцаах | Яаж |
|---|---|
| Кодын өөрчлөлт | `git checkout d7fecf5 -- revit-mcp/training/train_intent.py revit-mcp/training/pull_and_retrain.py` (**зөвхөн эдгээр хоёр зам**; ил `git restore` / `git checkout --` БҮҮ ашигла — бусад агентын WIP-ыг устгана) |
| Шинэ файлууд | `git clean` БҮҮ ашигла. Гараар устга: `revit-mcp/training/datasets.manifest.json`, `revit-mcp/training/requirements.txt`, `revit-mcp/training/data/eval-holdout.ids.json`, `revit-mcp/training/data/report.prev.json` |
| `data/report.json` | `git checkout d7fecf5 -- revit-mcp/training/data/report.json` (git-д хянагддаг; `version: 2026-08-25.1`, `accuracy: 0.9403`) |
| `addin/Resources/intent-model.json` | ⚠️ Тэр файл **git-д хянагддаг**. Сургалт ажиллуулах бүрд дарж бичигдэнэ. `git checkout d7fecf5 -- revit-mcp/addin/Resources/intent-model.json` |
| Продакшнд нийтлэгдсэн загвар | **Хамаарахгүй** — энэ сесс `--publish` хийхгүй, `assistant_models` хүснэгтэд нэг ч мөр бичигдэхгүй |

**Хэрэв ямар нэг байдлаар нийтлэгдчихсэн бол** (энэ сессэд болох ЁСГҮЙ): `assistant_models`-ийн идэвхжүүлэлтийг буцаах нь `is_active`-ыг өмнөх мөрөнд шилжүүлэх явдал. `idx_assistant_model_active` (`0195:147-148`) нь ХОЁР идэвхтэйг хориглодог тул дараалал ЧУХАЛ: эхлээд бүгдийг унтраа, дараа нь өмнөхийг асаа — `revit.ts:1846-1851` яг үүнийг хийдэг. **Аль хэдийн татаж авсан add-in-ууд автоматаар буцахгүй**, харин `have === row.version` таарахгүй болох тул дараагийн Revit нээхэд өмнөх хувилбарыг татаж авна. **Ямар ч тохиолдолд эзэмшигчтэй ярилц.**

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Репогоос ШИЙДЭГДЭХГҮЙ асуултууд. Хариултгүйгээр эхэлж болно (§3.1-3.6 бүгд `--offline`-оор хийгдэнэ), гэвч эзэмшигчид ЗААВАЛ тавь.

### 9.1 Продакшны баримт (D1 асуулга шаардана — **эзэмшигч эсвэл admin токен**)

| Асуулт | Яаж хариулах | Яагаад чухал |
|---|---|---|
| **`pull_and_retrain.py` продакшны эсрэг ХЭЗЭЭ НЭГЭН ЦАГТ ажиллаж байсан уу?** Репогийн нотолгоо: **ҮГҮЙ** — `data/production.json` БАЙХГҮЙ, `.gitignore`-д ч БАЙХГҮЙ (`git check-ignore` rc=1), `git ls-files` түүнийг харуулахгүй; `report.json`-ы `examples: 2402` нь локал 5 файлын тоотой ЯГ таарна | `npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command "SELECT source, COUNT(*) FROM assistant_examples WHERE is_active=1 GROUP BY source"` | `usage` мөр байхгүй бол «источник хадгалах» нь өнөөдөр ямар ч тоог өөрчлөхгүй, зөвхөн ирээдүйд ажиллана. `usage` мөр БАЙВАЛ анхны `pull` нь өгөгдлийн багцыг МЭДЭГДЭХҮЙЦ өөрчилнө — тэр үед hold-out-ыг ХЭЗЭЭ хөлдөөх нь чухал шийдвэр |
| **`assistant_models`-д идэвхтэй мөр БАЙГАА ЮУ?** | `npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command "SELECT version, accuracy, example_count, is_active, created_at, substr(note,1,80) FROM assistant_models ORDER BY id DESC LIMIT 10"` | (а) Идэвхтэй мөргүй бол ухралтын хамгаалалт `404` замаар явна (`pull_and_retrain.py:185-188`) — «анхны нийтлэлт». (б) **Хэд хэдэн мөр `2026-08-2X.1` хэлбэртэй байвал §2.5-ийн мөргөлдөөн АЛЬ ХЭДИЙН болсон гэсэн үг** — тэр үед аль загвар ямар компьютер дээр байгааг мэдэх боломжгүй |
| **Add-in-ууд ямар хувилбар ачаалсан байна?** | `assistant_logs`-д `model_version` багана **БАЙХГҮЙ** (`0195:70-104`), `revit.ts:1706-1721`-ийн 13 bind-д ч байхгүй — **сервер тэр утгыг чимээгүй хаядаг** (`AssistantLog.cs:185` илгээдэг ч). Тиймээс энэ асуултад **өнөөдөр хариулах БОЛОМЖГҮЙ** | Энэ бол 1B-3-ийн ажил. Мэдээлэх — засахгүй |

### 9.2 Бодлогын шийдвэрүүд (эзэмшигч шийднэ)

| Асуулт | Санал болгож буй анхдагч | Яагаад асуух ёстой |
|---|---|---|
| **Hold-out-ын хэмжээ** | 15% (n≈361, `unknown` 57 мөр) | 15% дээр стандарт алдаа ≈ ±0.011 — `--max-drop 0.02`-той харьцуулахад чимээ шуугиан их. 20-25% нь тогтвортой боловч сургалтаас илүү өгөгдөл авна. Багц одоо ердөө 2402 мөр |
| **`--max-drop-intent` босго** | 0.05 | Хэт хатуу бол хаалга байнга унана; хэт зөөлөн бол `unknown` сүйрэхийг барихгүй. Хэмжсэн: одоогийн алдагдал дангаараа `unknown`-ыг 0.026-аар хөдөлгөнө |
| **Санаа тус бүрийн ухралтад ХАМГИЙН БАГА мөр** | Ангид ≥20 мөр байвал л шалгах | Жижиг ангид нэг мөрийн алдаа = том хувь |
| **`production.json`-ыг git-д хянах уу?** | **ҮГҮЙ — `.gitignore`-д нэм** | Тэр файл нь инженерийн бичсэн ТҮҮХИЙ текст (`0195:17` НУУЦЛАЛЫН тэмдэглэл). Гэхдээ хянахгүй бол «ямар өгөгдлөөр сургасан бэ» гэдэг git-ээс алдагдана — sha256 нь тэр цоорхойг нөхнө. **⚠️ `revit-mcp/.gitignore` нь энэ сессийн хилийн ГАДНА (§3.7)** |
| **Хувилбарын хэшид ГИПЕРПАРАМЕТР орох уу?** | Орох | Датасетын хэш нь `C=8.0`, `NGRAM_MIN/MAX=2/6`, `max_features=12000`-ийг **ҮЗЭХГҮЙ**. Тэдгээрийг өөрчилж дахин сургахад ижил хувилбарын нэр гарч, сервер өмнөх жинг дарж бичээд, аль хэдийн татсан машин хуучин жинтэй үлдэнэ — §2.5-ийн ЯГ ТЭР мөргөлдөөн. Хэшийг `sha256(dataset ‖ C ‖ ngram ‖ max_features)` болгох нь энэ цоорхойг хаана |
| **Тоолуур (`.1`) нэмэгдэх ёстой юу?** | Хэшид гиперпараметр оруулбал ШААРДЛАГАГҮЙ | Ижил өгөгдөл + ижил гиперпараметр + тогтоосон багаж ⇒ ижил жин ⇒ дарж бичихэд асуудалгүй |
| **`data/report.prev.json` эсвэл `data/history/*.json`?** | `report.prev.json` (нэг файл) | Түүх хадгалах нь илүү үнэ цэнэтэй боловч `data/`-д файл олшруулна. Эзэмшигч сонгоно |
| **`revit-mcp/docs/ASSISTANT.md`-ийн хаалганы хүснэгт (§3.7)** | Энэ сесс ЗАСАХГҮЙ, мэдээлнэ | `:152` ба `:330-337` өнөөдөр аль хэдийн буруу |

### 9.3 ЭНЭ СЕССЭД АЛЬ ХЭДИЙН ХЭМЖСЭН (хойшлуулаагүй)

> Даалгаврын шаардлагаар алдагдлын хэмжээг **хойшлуулалгүй** энэ сессэд хэмжсэн. Дүн §2.6(б).

| | Утга |
|---|---|
| Одоогийн (алдагдалтай) CV | **0.9403** (σ 0.0098) — `report.json`-той яг таарна |
| Vectorizer нь Pipeline дотор | **0.9366** (σ 0.0100) |
| **Алдагдлын хазайлт** | **+0.0037 (0.37 нэгж хувь)** |
| Хамгийн их хөндөгдсөн санаа | `unknown` **+0.026** |
| Гүйцэтгэлийн зардал | **Сөрөг** — 4.6 сек → 2.9 сек |
| Лавлагаа: 15% хөлдөөсөн hold-out (seed 1234) | **0.9529** (n=361) |
| Мөр-ID мөргөлдөөн | **0** (2402 мөр → 2402 өвөрмөц ID) |

**Шударга дүгнэлт:** хазайлт нь `--max-drop`-ийн 0.02 босгоос БАГА, тиймээс алдагдал дангаараа өнөөг хүртэл худал зөвшөөрөл өгсөн гэж батлах боломжгүй. Энэ ажлын жинхэнэ үнэ цэнэ нь **тоо буурах** явдал биш, **тоо ЮУ Ч БОЛОВ УТГАТАЙ болох** явдал: (1) хоёр загварыг ЯГ ИЖИЛ мөрүүд дээр оноох, (2) санаа тус бүрийн сүйрлийг барих, (3) ямар өгөгдлөөс ямар багажаар гарсныг мэдэх.
