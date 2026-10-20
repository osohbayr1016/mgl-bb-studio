# 1B-5-golden-datasets — Golden dataset — CURATED-TRAIN / GOLDEN-EVAL / GOLDEN-REGRESSION

> **Track:** 1B (ӨГӨГДЛИЙН БҮРЭН БҮТЭН БАЙДАЛ) · зүйл 5
> **Хамаарал (depends on):** **1B-4** — `eval/manifest.json` ба хөлдөөсөн holdout ЭХЛЭЭД байх ёстой. ⚠️ `docs/bim-ai/` өнөөдөр (2026-08-27) **ХООСОН** — 1B-4 хараахан бичигдээгүй. §5 ба §9-ийг унш.
> **Блоклож буй (blocks):** Track C-ийн бүх зүйл (typed BIM intent, дүрмийн хөдөлгүүр, multimodal) — тэдгээрийн аль нь ч GOLDEN-EVAL-гүйгээр «сайжирсан» гэж мэдэгдэх боломжгүй байх ёстой. Мөн 1C-ийн latency харьцуулалт нь тогтмол багц дээр л утгатай.
> **Хөндөх файлууд:** `revit-mcp/eval/**` (ШИНЭ лавлах) · `revit-mcp/training/check_behavior.py` · `revit-mcp/training/train_intent.py` · `revit-mcp/training/pull_and_retrain.py` · `backend/migrations/0201_assistant_model_eval.sql` (ШИНЭ, дугаарыг §5-д баталгаажуул) · `backend/src/routes/revit.ts` (POST `/assistant/models` + шинэ read-only route)
> **Deploy тоо:** **2** — (1) `wrangler d1 migrations apply` (баганыг эхлээд), (2) `npx wrangler deploy --config wrangler.toml` (баганыг уншдаг кодыг дараа нь). **Add-in (C#) релиз 0**, **frontend deploy 0**.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээнээс ГАРАХГҮЙ.** Энэ репо дээр олон хөгжүүлэгч/агент ЗЭРЭГ ажилладаг. Ажлын мод дотор яг одоо өөр хүний дуусаагүй, бүр **эмхэтгэгдэхгүй** өөрчлөлт байж болно.

- Зөвхөн дээрх «Хөндөх файлууд»-ыг үүсгэ/засварла. Өөр файл эвдэрхий харагдаж байвал бүү зас, бүү форматла, бүү буцаа.
- **ХЭЗЭЭ Ч** `git restore`, `git checkout --`, `git stash`, `git clean` бүү ажиллуул. Өөрийн бичээгүй файлыг `git add` бүү хий.
- **Бүтэн build унасан нь автоматаар чинийх БИШ.** `cd backend && npx tsc --noEmit` бүх воркерыг эмхэтгэдэг тул чиний хөндөөгүй файл дээр унаж болно. Алдаанууд зөвхөн хамааралгүй файлд байгааг батал, тэр саадыг **эзэнд нь мэдэгдээд цааш бүү хөө**.
- Migration бол **ЗӨВХӨН НЭМДЭГ**. Хэрэглэгдсэн файлыг засах нь продакшн дээр **чимээгүй юу ч хийхгүй**. Дугаарын блок өгөгдсөн бол түүн дотроо бай.

**ХӨНДӨХГҮЙ (энэ сесс):**

| Юу | Яагаад |
|---|---|
| `backend/src/middleware/auth.ts`, `lib/jwt.ts` `verifyToken` | Add-in REST дуудлага бүрээ `purpose === 'mcp'` токеноор баталгаажуулдаг, refresh урсгал БАЙХГҮЙ. Үүнийг чангатгавал ~20 компьютер, `Install.bat`, Revit хаалттай — **алсаас сэргээх боломжгүй ЦОРЫН ГАНЦ өөрчлөлт**. |
| `revit-mcp/addin/**` (бүх `.cs`, `.xaml`) | Бүх C# өөрчлөлт НЭГ релизэд багцлагдана; албадан шинэчлэх механизм байхгүй. Энэ ажил add-in-д **ямар ч** өөрчлөлт шаардахгүй. |
| `revit-mcp/training/data/*.json` доторх **мөрүүд** | Тэдгээр нь CURATED-TRAIN. Энэ ажил бол мөр нэмэх/хасах биш, ХҮРЭЭ тогтоох. Мөр устгаж golden-ыг «цэвэрлэх» нь яг л хийж болохгүй зүйл (§4). |
| `frontend/**` | Хамааралгүй. |

**Deploy хийж болох уу:** Тийм, гэхдээ **эзний зөвшөөрөлтэйгээр** ба §5-ын дараалалаар (migration → worker). Python талын өөрчлөлт нь ямар ч deploy шаардахгүй.

---

## 1. КОНТЕКСТ

### 1.1 Систем (хүйтэн сессэд хангалттай хэмжээгээр)

- **`backend/`** — Cloudflare Worker. Default export нь Hono БИШ, `@cloudflare/workers-oauth-provider`; Hono `app` нь түүний `defaultHandler`. Холболтууд: **D1** (SQLite, продакшн нэр `mgl-progress-db-v3`, 45 MB / 114 хүснэгт), **R2** (`MEDIA_BUCKET` нь **түлхүүрээр нь дэлхийд нээлттэй**, `MEETING_BUCKET` хаалттай), **KV**, нэг Durable Object (`MglMcpAgent`).
- **`frontend/`** — Vite + React 19 SPA, Cloudflare Pages төсөл **`mgl-design-system`** (`--project-name mgl-design-system`-ийг ЗААВАЛ шууд дамжуул).
- **`revit-mcp/addin/`** — Revit 2024–2027 add-in, C#/WPF, процесс дотор. Хэмжсэн: **43 `.cs` файл, 13,463 мөр** (`ls addin/*.cs | wc -l`; `.xaml`-ыг оруулбал 47 файл орчим). **Тест ТЭГ.** Ажилтны компьютер дээр авто-шинэчлэлт БАЙХГҮЙ.
- **`revit-mcp/training/`** — Python сургалтын шугам, git-д хянагддаг.
- **`revit-mcp/server/`, `revit-mcp/agent/`** — Python MCP гүүр ба бие даасан локал агент.
- ~49 идэвхтэй мэдлэгийн ажилтан. Хамгийн том хүснэгт `progress_entries` — 8,062 мөр.

### 1.2 Санаа таних ангилагч гэж юу вэ

Add-in дотор **LLM БАЙХГҮЙ**. Хэрэглэгчийн бичсэн монгол/англи/латин-монгол текстийг **офлайн, локал** logistic-regression ангилагч 9 санааны нэг рүү хуваарилдаг (`train_intent.py:64-74`):
`submit_progress · list_sheets · isolate_sheet · reset_view · whats_changed · set_baseline · progress_status · help · unknown`.

Загварыг хөгжүүлэгчийн машин дээр Python сургаж, `revit-mcp/addin/Resources/intent-model.json` (**940,283 байт, git-д хянагдана**) болгон экспортлоод, `POST /api/revit/assistant/models`-ээр D1 руу нийтэлдэг; add-in дараагийн нээхэд татдаг.

### 1.3 Яагаад энэ ажил байх ёстой вэ

Өнөөдөр **CURATED-TRAIN, GOLDEN-EVAL, GOLDEN-REGRESSION гурав ялгаагүй**. Бүх өгөгдөл нэг лавлахад (`revit-mcp/training/data/`) хэвтэж, сургалтын шугам түүнийг **файлын системийн glob**-оор шүүрдэж авдаг (`pull_and_retrain.py:96`). Өөрөөр хэлбэл:

1. Тэр лавлахад golden файл хийвэл **тэр дор нь сургалтын өгөгдөл болно** — тест утгаа алдана, гэтэл ногоон хэвээр байна.
2. Түүхэн уналтууд (буруу таасан бодит тохиолдлууд) `hard-negatives.json`-ы `_note` талбарт **зөвхөн зохиол хэлбэрээр** тэмдэглэгдсэн — машин уншдаг, заавал давдаг багц болоогүй.
3. Загварын хувилбар бүрд хадгалагддаг цорын ганц тоо нь `assistant_models.accuracy` — тэр нь **сургалтын өгөгдөл дээрх хөндлөн шалгалт**, өөрөөр хэлбэл өөрийгөө өөрөө дүгнэсэн тоо.

Энэ бол «сайжруулсан» гэсэн мэдэгдлийг хэн ч няцааж чадахгүй болох сонгодог зам. 1B-5 нь түүнийг хаана.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх мөр бүрийг би энэ сесс дотор файлыг нээж баталсан (2026-08-27, commit `d7fecf5`).

### 2.1 Сургалтын шугам — гурван GLOB нь дурын шинэ `.json`-ыг залгина

**`revit-mcp/training/pull_and_retrain.py:94-96`**

```python
def datasets() -> list[Path]:
    """Сургалтад орох БҮХ файл.  `production.json` байвал автоматаар орно."""
    return sorted(p for p in DATA.glob("*.json") if p.name != "report.json")
```

`DATA = HERE / "data"` (`pull_and_retrain.py:47`). Хасалт нь ЗӨВХӨН `report.json`. **`data/`-д хийсэн ямар ч `.json` сургалтад ордог.**

**`revit-mcp/training/check_behavior.py:133-143`** — зан төлөвийн шалгалтын «сургалтын мөрүүд» гэж үздэг олонлог нь мөн ижил glob:

```python
def training_texts() -> set[str]:
    out: set[str] = set()
    for f in sorted(DATA.glob("*.json")):
```

**`revit-mcp/training/check_fold_parity.py:32-38`** — гурав дахь glob (`corpus()`), мөн `data/*.json`.

⇒ **Лавлах өөрөө хамгаалалт БИШ.** Хамгаалалт нь build үеийн батламж байх ёстой (§3.3). Энэ бол даалгаврын «hard design question»-ы бодит үндэс.

**`revit-mcp/training/train_intent.py:148-166`** (`load_rows`) нь дурын path хүлээж авдаг — `--data`-д юу дамжуулснаа шалгадаггүй.

### 2.2 Давхардал хасах ба мөрийн ЖИНХЭНЭ түлхүүр

**`train_intent.py:99-122`** — `preprocess(raw)`: `fold_text(raw)` + `?` байвал ` qmark` залгаад хоёр талд зай нэмнэ.
**`train_intent.py:169-190`** — `clean()` нь `key = (preprocess(text), intent)`-ээр давхардал хасна:

```python
key = (preprocess(text), intent)
if key in seen:
    dropped_dup += 1
    continue
```

⇒ **Мөрийн таних тэмдэг нь түүхий текст БИШ, ЭВХСЭН текст + санаа.** «илгээе» ба «ilgeeye» нь загварын хувьд ЯГ нэг мөр. Аливаа гишүүнчлэлийн батламж эвхсэн түлхүүр дээр ажиллах ёстой — эс тэгвээс golden мөрийг үсгийн хувилбараар нь сургалтад оруулаад батламжийг тойрч болно.

### 2.3 `check_behavior.py` — GOLDEN-EVAL-ийн үр хөврөл (БАТЛАВ)

- **`PROBES` = яг 61 мөр**, `check_behavior.py:53-130`. AST-аар тоолов.
  Бүлгээр: `en` 13 · `mn-latn` 8 · `mn-cyrl` 9 · `алдаатай` 8 · `холимог` 5 · `сөрөг` 14 · `утгагүй` 2 · `яриа` 2.
  Хүлээсэн санаагаар: `unknown` **18**, `submit_progress` 8, `list_sheets` 7, `reset_view` 6, `set_baseline` 5, `progress_status` 5, `help` 5, `isolate_sheet` 4, `whats_changed` 3.
- **Алдагдлын хамгаалалт (leak guard) — `check_behavior.py:147-156`:**

```python
    seen = training_texts()
    leaked = [t for t, _, _ in PROBES if preprocess(t) in seen]
    if leaked:
        print("❌ ЖИШЭЭ СУРГАЛТЫН БАГЦАД ОРСОН — тест утгаа алдана:", file=sys.stderr)
        ...
        sys.exit(1)
```

  **Тэгээс ялгаатай кодоор гардаг** — CI/скрипт барьж чадна. Энэ нь яг «train-on-test = build failure» зарчмын үр хөврөл, гэхдээ **зөвхөн 61 мөрд** ба **зөвхөн энэ нэг файлд**.
- **Би шалгалтыг амьдаар нь давтав** (`dotnet`-гүйгээр, зөвхөн leak-guard логикийг Python-оор): сургалтын багцад **2,402 өвөрмөц эвхсэн түлхүүр**, **алдагдсан probe = 0**. Дөрвөн түүхэн уналтын текст бүгд сургалтад БАЙХГҮЙ:

  | Probe | Эвхсэн хэлбэр | Сургалтад бий юу |
  |---|---|---|
  | `өнөөдөр хэдэн градус байна` | `' onodor heden gradus baina '` | Үгүй |
  | `бүх 3d харагдацыг жагсаа` | `' buh 3d haragdacig jagsa '` | Үгүй |
  | `ЦБУ-08 ыг 65 хувь болголоо` | `' cbu 08 ig 65 huv bolgolo '` | Үгүй |
  | `өнөөдрийн ирцээ хаанаас бүртгүүлэх вэ` | `' onodrin irce hanas burtguleh ve '` | Үгүй |

- **`MINC, MINM = 0.45, 0.15`** — `check_behavior.py:50`, дээрх тайлбар нь `IntentRouter`-тэй заавал таарахыг шаарддаг. ⚠️ **`MINM` нь тодорхойлогдсон боловч ХЭРЭГЛЭГДЭХГҮЙ**: `check_behavior.py:189` дээр зөвхөн `acted = lab != "unknown" and c >= MINC`. Өөрөөр хэлбэл зан төлөвийн шалгалт нь `IntentRouter`-ийн margin шүүлтийг **дуурайдаггүй** (§9-ийн асуулт 8).

### 2.4 `hard-negatives.json` — GOLDEN-REGRESSION-ы үр хөврөл (БАТЛАВ)

- **46 мөр.** Талбарууд: `text`, `intent`, `style` — 46/46 мөр дээр гурвуулаа. **`label` талбар БАЙХГҮЙ.**
- `_note` талбар нь **дөрвөн БОДИТ ХЭМЖИЛТИЙН уналтыг** бичмэлээр тэмдэглэсэн:

  | № | Огноо | Бодит текст | Загвар юу гэсэн | Яагаад аюултай |
  |---|---|---|---|---|
  | HN-1 | 2026-08-25 | «ирцээ бүртгүүлье» | `submit_progress` **0.58** — босго давж, ҮЙЛДЭЛ хийх гэж байсан | Ирц бол ТУСДАА систем; буруу илгээх нь БИЧИХ үйлдэл. «бүртгүүл» нь `submit_progress`-д 13 мөрд, «ирц» ердөө 1 мөрд байсан — n-gram дийлсэн |
  | HN-2 | 2026-08-25 | «ЦБУ-05 ыг 70 хувь болголоо» | итгэлцэл **0.19** — мэдэхгүй байв | Үйл үггүй мэдэгдлийн хэлбэр өгөгдөлд байгаагүй |
  | HN-3 | 2026-08-25 (2-р ээлж) | «өнөөдөр хэдэн градус байна» | `progress_status` **0.41** | Босгоос доогуур ч шошго нь буруу — англи бэхжүүлэлтийн хажуугийн үр дагавар |
  | HN-4 | 2026-08-25 (3-р ээлж) | «бүх 3d харагдацыг жагсаа» | `reset_view` **0.38** | n-gram 3-5 → 2-6 болсны дараа ХАРАГДАЦ ≠ ТУСГААРЛАЛТ ЦУЦЛАХ хил бүдгэрсэн |

- ⚠️ **ЧУХАЛ ЯЛГАА:** `hard-negatives.json`-ы 46 мөр нь **ЗАСВАР**, тест БИШ — тэдгээр нь сургалтад ордог (`datasets()` glob). Тэдгээрийг GOLDEN-REGRESSION болгож хуулбал регресс тест нь цээжилсэн эсэхийг хэмжинэ. Регрессийн багц нь **эдгээр уналтын эвхэлтээрээ ӨӨР ах дүү хэллэгүүд** байх ёстой (§3.2).
- `_note` мөн хоёр удаа «хэв маяг» гэж тэмдэглэсэн: *шинэ өгөгдөл нэмэх бүрд ХИЛ бүдгэрч болно*, *онцлогийн бүтэц өөрчлөгдөх бүрд ХИЛ шинээр бүдгэрнэ*. Энэ бол яг «регрессийн багц үүрд ургана» гэсэн үндэслэл.

### 2.5 Одоогийн өгөгдлийн хэмжээ (`revit-mcp/training/data/`)

| Файл | Мөр | Git-д | Тайлбар |
|---|---:|---|---|
| `seed.json` | 517 | ✅ | Үр — 9 санаа × 7 хэв маяг |
| `multilang.json` | 1,291 | ✅ | англи · латин-монгол · кирилл · холимог |
| `english.json` | 463 | ✅ | Хэмжсэн сул цэг рүү чиглэсэн бэхжүүлэлт |
| `bootstrap.json` | 215 | ✅ | Гогцоо шалгах жижиг багц |
| `hard-negatives.json` | 46 | ✅ | Дээрх дөрвөн уналтын засвар |
| `report.json` | — | ✅ | Машин бичдэг; `datasets()`-д хасагддаг ЦОРЫН ГАНЦ файл |
| `production.json` | (одоо байхгүй) | ❌ **бас `.gitignore`-д ч алга** | `pull_and_retrain.pull()` дарж бичдэг (`:79-86`) |

**Нийт түүхий 2,532 мөр → давхардал хассаны дараа 2,402** (`data/report.json`: `"examples": 2402`, `"accuracy": 0.9403`, `"accuracy_std": 0.0098`, `"folds": 5`, `"repeats": 5`, хувилбар `2026-08-25.1`).

### 2.6 Хаалганы одоогийн байдал

`pull_and_retrain.py:155-162` дээр ТАВАН хаалга ажилладаг:
`check_parity.py` · `check_behavior.py` · `check_slots.py` · `check_lang.py` · `check_conversation.py`.

| Скрипт | Тохиолдол | `pull_and_retrain`-д ажилладаг уу | Leak guard бий юу |
|---|---:|---|---|
| `check_behavior.py` | **61** | ✅ | ✅ (ЦОРЫН ГАНЦ) |
| `check_slots.py` | 34 | ✅ | ❌ |
| `check_lang.py` | 27 | ✅ | ❌ |
| `check_conversation.py` | 20 | ✅ | ❌ |
| `check_nudge.py` | 20 | ❌ **ажиллуулагддаггүй** | ❌ |
| `check_fold_parity.py` | корпус + 30 ирмэг | ❌ **ажиллуулагддаггүй** | — |
| `check_parity.py` | сургалтын бүх мөр | ✅ | — (зорилго нь өөр) |

⚠️ **Баримтжуулалтын зөрүү:** `pull_and_retrain.py:15` «ТАВАН ХААЛГА» гэж бичсэн атлаа `:154` дээрх мөрийн тайлбар `# --- 3. Гурван хаалга ---` гэж хэвээр. `revit-mcp/docs/ASSISTANT.md:323-338`-ийн хүснэгт мөн «таван шалгалт» гэж `check_fold_parity`-г оруулж, `check_conversation`-ыг оруулаагүй — өөр тав. Аль нь ч бодит `gates` жагсаалттай яг таарахгүй.

### 2.7 Ухралтын хамгаалалт — одоо байгаа цорын ганц тоон хаалга

`pull_and_retrain.py:173-188`:

```python
        cur = api(args.host, token, "/api/revit/assistant/model")
        old = cur.get("accuracy")
        if old is not None and acc < float(old) - args.max_drop:
            raise SystemExit(... "НИЙТЛЭХГҮЙ" ...)
```

`--max-drop` анхдагч **0.02** (`:117-118`). ⚠️ Энэ нь **сургалтын өгөгдөл дээрх хөндлөн шалгалтын** тоог харьцуулдаг — өгөгдөл өөрчлөгдвөл суурь нь ч хамт хөдөлдөг. Хөлдөөсөн багцын харьцуулалт БАЙХГҮЙ. 1B-4/1B-5 үүнийг нөхнө.

### 2.8 Босго (`MinConfidence`) — auto-growth-ийн зангуу

**`revit-mcp/addin/IntentRouter.cs:81`**

```csharp
        public static double MinConfidence { get; set; } = 0.45;
```

**`IntentRouter.cs:95`** — `MinMargin = 0.15`. Хэрэглэгддэг цорын ганц газар **`IntentRouter.cs:176`**:

```csharp
                bool confident = p.Confidence >= MinConfidence && margin >= MinMargin;
```

`:52-64` дээрх тайлбар нь 0.55 → 0.45 болгосон шийдвэрийг **2392 мөрийн хэмжилтээр** үндэслэсэн хүснэгттэй:

| босго | үйлдэл хийсэн | ҮЙЛДЛИЙН ЗӨВ | буруу үйлдэл |
|---|---|---|---|
| 0.60 | 85.6% | 98.4% | 28 |
| 0.55 | 88.2% | 98.1% | 35 |
| **0.45** | **91.9%** | **97.1%** | **55** |
| 0.40 | 93.1% | 96.6% | 65 |

### 2.9 `app_settings['assistant.min_confidence']` — **ХЭН Ч УНШИХГҮЙ (БАТЛАВ)**

Даалгаврын хардлага **ЗӨВ БАЙВ**. Репо даяар хайхад ердөө **хоёр** тохиолдол:

```
backend/migrations/0195_assistant_learning.sql:163:VALUES ('assistant.min_confidence', '0.45');
revit-mcp/addin/IntentRouter.cs:76:        /// ⚠️ `app_settings['assistant.min_confidence']` мөр БАЙГАА ч ТҮҮНИЙГ
```

`0195_assistant_learning.sql:154-156` өөрөө үүнийг илэн далангүй бичсэн:

```
-- ⚠️ ЭНЭ МӨРИЙГ ОДООХОНДОО ХЭН Ч УНШИХГҮЙ.  Add-in нь `IntentRouter.
-- MinConfidence`-ийг эмхэтгэлийн үед л авдаг; серверээс татах код БИЧИГДЭЭГҮЙ.
-- Тиймээс энэ утгыг өөрчлөхөд ЮУ Ч БОЛОХГҮЙ — add-in-ыг дахин барих хэрэгтэй.
```

Харьцуулалт: **нөгөө үрсэн тохиргоо нь УНШИГДДАГ** — `assistant.logging`-ийг `backend/src/routes/revit.ts:1673` уншина:

```ts
    .prepare("SELECT value FROM app_settings WHERE key = 'assistant.logging'")
```

`backend/src/lib/orgConfig.ts:418` нь `app_settings`-ээс зөвхөн `key LIKE 'org.%'` уншдаг тул `assistant.*` түлхүүрүүд ерөнхий уншигчид ч ордоггүй.

⇒ **Auto-growth-ийн босгыг DB-ээс бүү унш.** Бодит эх сурвалж нь `IntentRouter.cs:81`-ийн `0.45`. Хэрэв хэзээ нэгэн цагт серверээс татдаг болговол `0195`-ын тайлбар, `IntentRouter.cs:76-79`, `check_behavior.py:48-50` **гурвууланг** нэг дор засна.

### 2.10 `assistant_models` — golden оноо хадгалах багана БАЙХГҮЙ

`0195_assistant_learning.sql:122-143` — багана: `id · version(UNIQUE) · weights_json · intents_json · example_count · accuracy · per_intent_json · is_active · note · trained_by · created_at`.
`idx_assistant_model_active` нь `WHERE is_active = 1` хэсэгчилсэн ӨВӨРМӨЦ индекс (`:147-148`) — нэгээс олон идэвхтэй загварыг хаадаг.
⚠️ `:138` дээрх тайлбар «доорх trigger барина» гэж бичсэн нь **буруу** — репо даяар `CREATE TRIGGER` **ТЭГ**; барьдаг нь тэр хэсэгчилсэн индекс.
`0200_assistant_feedback_note.sql` нь зөвхөн `assistant_logs`-д `feedback_note` нэмсэн. **`assistant_*`-д хамаатай migration яг хоёрхон: 0195 ба 0200.**

⇒ Golden оноог хадгалах газар байхгүй. `note` руу хийж болохгүй: `POST /assistant/models`-ын bind дээр `str(body.note, 500)` дуудагддаг ба `str()` нь **чимээгүй тасалдаг**:

```ts
function str(v: unknown, max = MAX_STR): string {      // routes/revit.ts:85-88
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > max ? s.slice(0, max) : s;
}
```

### 2.11 Хамаарах route-ууд

| Route | Мөр | Хаалга | Тэмдэглэл |
|---|---|---|---|
| `POST /api/revit/assistant/models` | `routes/revit.ts:1785` | `requireAdmin()` | INSERT `:1822`, идэвхжүүлэлт `:1848-1849`; weights >5 MB бол 413 |
| `GET /api/revit/assistant/model` | `routes/revit.ts:1748` | authed | Add-in татдаг |
| `GET /api/revit/assistant/pending` | `routes/revit.ts:1863` | `isManager` (admin\|senior), `:1864` | `confidence`, `decided_by` буцаана (`:1873-1875`); `limit` дээд тал **200** (`:1866`); эрэмбэ нь curation-ы үнэ цэнээр, итгэлцлээр БИШ |
| `POST /api/revit/assistant/examples` | `routes/revit.ts:1900` | `isManager` | 7 bind/мөр (`:1929`) |
| `GET /api/revit/assistant/export` | `routes/revit.ts:1974` | `requireAdmin()` | `assistant_examples WHERE is_active = 1` |
| `POST /api/revit/assistant/logs` | `routes/revit.ts:1658` | authed | 13 bind/мөр (`:1706`) |

⚠️ **BINDS-ийн зөрүү БАТЛАГДАВ** (даалгаварт дурдсанчлан): `routes/revit.ts:1703` дээрх тайлбарын эхний мөр `// 12 bind/мөр → floor(100/12) = 8 мөр/statement` гэж бичсэн атлаа `:1705` дээр `13 × 7 = 91 ≤ 100` гэж ЗӨВ бичээд `:1706` дээр `const BINDS = 13;`. **Эхний мөр нь хуучирсан — түүнээс бүү хуул.** Зөв загвар нь `:52-59`:

```ts
const BINDS_PER_BINDING_ROW = 13;
const BINDING_ROWS_PER_STATEMENT = Math.floor(100 / BINDS_PER_BINDING_ROW); // = 7
```

### 2.12 Дүрмийн (`rules`) хуваарийн бодит эх сурвалж

`revit-mcp/CLAUDE.md:59-116` дээр БНбД-ийн хэмжээсийн дүрмүүд бий — «wrong door width» төрлийн регрессийн шууд материал:

- Хонгил ≥ **1.2 м** (урт ≤10 м), ≥ **1.5 м** (урт >10 м) — `CLAUDE.md:64-67`
- Нүүлгэн шилжүүлэх хаалганы цэвэр өргөн ≥ **1.2 м** — `:68-69`
- Дотоод хаалганы цэвэр нээлт ≥ **0.9 м** (ХБИ өрөө / 00), стандарт өрөө ≥ **0.8 м** — `:70-72`
- Таазны цэвэр өндөр: өрөө ≥ **2.4 м**, хонгил ≥ **2.2 м** — `:76-78`
- Налуу зам ≤ **5 % (1:20)**, өргөн ≥ **0.9 м** — `:85-87`

⚠️ `CLAUDE.md:7-12` өөрөө: эдгээр нь «**design-guidance values**», албан ёсны БНбД-тэй тулгагдаагүй. **Тиймээс `rules` хуваарийг эдгээрээс автоматаар үүсгэж болохгүй** — §9-ийн асуулт 3.

---

## 3. ХИЙХ АЖИЛ

### 3.0 ГОЛ ШИЙДВЭР — GOLDEN-EVAL ФИЗИКААР ХААНА БАЙХ ВЭ

Дөрвөн хувилбарыг харьцуулав. Шалгуур: (a) сургалтын шугам түүнийг **санамсаргүй** залгих боломжгүй байх, (b) **санаатай** тойрох нь код өөрчлөлт ба **PR-д харагдах** байх, (c) `--offline` үед ажиллах, (d) өөрчлөлт бүр хүний хяналтад орох.

| Хувилбар | (a) Санамсаргүй | (b) Санаатай тойрох | (c) Офлайн | (d) Хяналт | Дүгнэлт |
|---|---|---|---|---|---|
| **A. Тусдаа git лавлах + checksum manifest + build-time батламж** | ✅ glob-оос гадна; батламж нь `train_intent`-ыг унагана | Кодын мөр устгах + manifest дахин тооцох → git diff-д **хоёулаа** харагдана | ✅ бүрэн локал | ✅ git blame / PR | **✅ СОНГОВ** |
| B. Тусдаа D1 хүснэгт, бичих route-гүй | ⚠️ Сургалтын шугам аль хэдийн admin токентой (`MGL_TOKEN`; `/assistant/export` нь `requireAdmin()`), «бичих route-гүй» нь нэг route-ын зайд | Route нэмэх нь харагдана, гэвч `d1 execute --remote` -ээр шууд бичихэд **ямар ч мөр үлдэхгүй** | ❌ **сүлжээгүй бол хаалга алга болно** — яг хамгийн эрсдэлтэй үед | ❌ мөр өөрчлөгдөхөд diff байхгүй | ✗ |
| C. R2 + «өөрчлөхгүй» гэсэн конвенц | ⚠️ Конвенц нь механизм биш; `MEDIA_BUCKET` нь бүр түлхүүрээр дэлхийд нээлттэй | Дурын PUT | ❌ | ❌ | ✗ |
| D. Тусдаа репозитор | ✅ | ✅ | ⚠️ хажуугийн clone байхгүй бол шалгалт **чимээгүй алгасагдана** — яг хориглох ёстой уналтын горим | ✅ | ✗ (тусдаа checkout, хуучрах эрсдэл) |

**Сонголт: A — `revit-mcp/eval/` (нэг репо дотор, `training/data/`-аас ГАДНА) + SHA-256 manifest + build үеийн батламж.**

**Үндэслэл (яагаад лавлах өөрөө хангалтгүй вэ):** `training/data/`-аас гарах нь зөвхөн **гурван glob**-ыг (§2.1) тойрдог. Хэн нэгэн `--data eval/golden/intents.json` гэж гараар дамжуулбал юу ч зогсоохгүй. Тиймээс **хамгаалалт нь лавлах биш, батламж**:

1. `train_intent.py` нь `--data`-д ирсэн ямар ч path нь `eval/golden/` дор байвал **шууд `SystemExit`**.
2. `train_intent.py` нь `eval/manifest.json`-ы `exclude_row_ids`-ыг уншиж, **сургалтын мөр бүрийн эвхсэн row_id** тэр олонлогт байвал **build унана** (сануулга биш).
3. `pull_and_retrain.datasets()` нь буцаах жагсаалтаа golden-тай огтлолцохгүй гэдгийг батална.
4. `run_golden.py` нь partition файл бүрийн SHA-256-г manifest-тэй тулгана — таарахгүй бол **хаалга унана**, өөрөөр хэлбэл «загварыг давуулахын тулд golden-ыг засах» нь тэр дор нь илэрнэ.

B ба C хувилбарууд (c) шалгуур дээр унасан нь шийдвэрлэх нь: `pull_and_retrain.py --offline` (`:114`) бол бодит хэрэглээний горим, тэр үед golden хаалга алга болбол хамгаалалт нь **байхгүй байхаас ч дор** — байгаа мэт харагдана.

### 3.1 Репо байрлал (ШИНЭ)

```
revit-mcp/eval/
  README.md                 # энэ бүхний товч дүрэм (МОНГОЛООР)
  manifest.json             # 1B-4 үүсгэсэн; ЭНЭ ажил өргөтгөнө
  golden/
    intents.json            # 61 мөр — check_behavior.py-ийн PROBES-ээс шилжүүлнэ
    bim.json                # 0 мөр  ← ХООСОН ХЭВЭЭР ШИЛЖИНЭ, ҮГҮЙСГЭХГҮЙ
    rules.json              # 0 мөр  ← мөн адил
    difficult_cases.json    # 0 мөр (auto-nomination дүүргэнэ)
    regressions.json        # 4 мөр — §2.4-ийн уналтуудын АХ ДҮҮ хэллэгүүд
    adversarial.json        # 18 мөр — PROBES-ийн `unknown` бүлэг
  run_golden.py             # оноолт + ХООСОН-БЛОК дүрэм + хэвлэлтийн тэмдэглэл
  freeze.py                 # мөр нэмэх / checksum дахин тооцох ЦОРЫН ГАНЦ зам
  nominate.py               # difficult_cases автомат нэр дэвшүүлэлт
  assert_no_leak.py         # гишүүнчлэлийн батламж (train_intent ба CI хоёулаа дуудна)
```

⚠️ **`training/data/`-г ҮЛ ХӨДӨЛГӨНӨ.** CURATED-TRAIN = яг одоогийн `training/data/*.json` (`report.json`-оос бусад). Файл зөөвөл §2.1-ийн гурван glob, `check_parity.py`, `pull_and_retrain` бүгд эвдэрнэ — ашиг нь тэг, эрсдэл нь өндөр. CURATED-TRAIN-ыг **нэрлэж, manifest-д бүртгэж** л хангалттай.

### 3.2 Гурван багц ба зургаан хуваарь — юу хаана орох вэ

| Багц | Агуулга | Хаана | Сургалтад ордог уу |
|---|---|---|---|
| **CURATED-TRAIN** | Баталгаажсан, сургалтад ЗӨВШӨӨРӨГДСӨН өгөгдөл | `revit-mcp/training/data/*.json` (2,402 өвөрмөц) | ✅ |
| **GOLDEN-EVAL** | Ердийн сургалтын шугамд **өөрчлөгдөшгүй** | `eval/golden/{intents,bim,rules,difficult_cases,adversarial}.json` | ❌ **хэзээ ч** |
| **GOLDEN-REGRESSION** | Түүхэн уналт БҮР, үүрд | `eval/golden/regressions.json` | ❌ **хэзээ ч** |

**Зургаан хуваарь ба анхны төлөв:**

| Хуваарь | Мөр (анх) | Эх сурвалж |
|---|---:|---|
| `intents` | **61** | `check_behavior.py:53-130` PROBES бүхэлдээ (`unknown` 18-ыг оруулаад) |
| `bim` | **0** | Track C хүртэл байхгүй — **ХООСОН ШИЛЖИНЭ** |
| `rules` | **0** | БНбД-ийн эх бичвэр тулгагдаагүй (§9) — **ХООСОН ШИЛЖИНЭ** |
| `difficult_cases` | **0** | `nominate.py` ургуулна (§3.5) |
| `regressions` | **4** | §2.4-ийн дөрвөн уналт, **АХ ДҮҮ хэллэгээр** |
| `adversarial` | **18** | PROBES-ийн `unknown` хүлээлттэй мөрүүд (сөрөг 14 + утгагүй 2 + яриа 2) |

⚠️ **`intents` ба `adversarial` давхцана** (18 мөр хоёуланд нь). Энэ нь ЗӨВ: `intents` бол бүтэн зан төлөвийн зураглал, `adversarial` бол «хийж болохгүйгээ мэдэж байна уу» гэсэн тусгай оноо. Гишүүнчлэлийн батламж нь golden↔golden давхцлыг **биш**, golden↔CURATED-TRAIN давхцлыг л хориглоно.

**Регрессийн мөрийг хэрхэн бичих вэ (шийдвэрлэх нарийн зүйл):**

`hard-negatives.json`-ы 46 мөр бол ЗАСВАР, сургалтад ордог. Тэднийг хуулж регресс болговол тест нь **цээжилсэн эсэхийг** хэмжинэ. Тиймээс `regressions.json`-ы мөр бүр:

- ижил уналтын **утгыг** барина,
- гэвч `preprocess()`-ээр **өөр эвхсэн түлхүүр** өгнө,
- `incident` талбарт `hard-negatives.json:_note`-ы дугаарыг заана.

```json
{
  "_note": "GOLDEN-REGRESSION — ХЭЗЭЭ Ч МӨР ХАСАХГҮЙ.  Нэмэх журам: eval/README.md.",
  "rows": [
    { "row_id": "g…", "text": "ирцээ тэмдэглэх хуудас хаана байдаг вэ",
      "intent": "unknown", "incident": "HN-1", "first_seen": "2026-08-25",
      "was": "submit_progress@0.58",
      "why": "«бүртгүүл» нь submit_progress-ийн n-gram-д дийлдэг; ирц бол ТУСДАА систем" },
    { "row_id": "g…", "text": "ХАС-12 ыг 40 хувь болгов",
      "intent": "submit_progress", "incident": "HN-2", "first_seen": "2026-08-25",
      "was": "unknown@0.19",
      "why": "үйл үггүй мэдэгдлийн хэлбэр" },
    { "row_id": "g…", "text": "маргааш цас орох уу",
      "intent": "unknown", "incident": "HN-3", "first_seen": "2026-08-25",
      "was": "progress_status@0.41",
      "why": "«хэдэн … вэ» асуултын хэв маяг progress_status руу татагдана" },
    { "row_id": "g…", "text": "бүх зүсэлтийн харагдацыг нээ",
      "intent": "unknown", "incident": "HN-4", "first_seen": "2026-08-25",
      "was": "reset_view@0.38",
      "why": "ХАРАГДАЦ ≠ ТУСГААРЛАЛТ ЦУЦЛАХ; 2-6 n-gram-ийн дараа хил бүдгэрсэн" }
  ]
}
```

⚠️ Мөр бүрийг бичсэний дараа **`assert_no_leak.py` ажиллуулж** эвхсэн түлхүүр нь CURATED-TRAIN-д байхгүйг батал. Байвал өөр хэллэг ол — **CURATED-TRAIN-аас мөр битгий хас** (§4).

### 3.3 Мөрийн таних тэмдэг ба гишүүнчлэлийн батламж

**`row_id`** (`eval/assert_no_leak.py`):

```python
import hashlib
# ⚠️ train_intent.preprocess()-ийг ЯГ дуудна — өөрийн хувилбар БҮҮ бич.
from train_intent import preprocess          # sys.path-д training/ нэмнэ

FOLD_CONTRACT = "fold-v1"                    # train_intent.PREPROCESS_CONTRACT (:80)

def row_id(text: str, intent: str) -> str:
    key = preprocess(text) + "\x1f" + intent.strip()
    return "g" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
```

**Яагаад эвхсэн хэлбэрээр вэ:** `train_intent.py:181` нь давхардлыг `(preprocess(text), intent)`-ээр хасдаг ба `check_behavior.py:149` нь алдагдлыг мөн эвхсэн хэлбэрээр барьдаг. Түүхий текстээр id гаргавал «ЦБУ-05 ыг 70 хувь болголоо» ба «cbu 05 ig 70 huv bolgoloo» **өөр id** авах ба хоёр дахь нь чөлөөтэй сургалтад орно — гэтэл загварын хувьд тэр нь **ЯГ ижил** мөр. Тэр нь train-on-test.

**Manifest (1B-4-ийн бүтцийг өргөтгөнө):**

```json
{
  "manifest_version": 2,
  "dataset_version": "2026-08-27.1",
  "preprocess_contract": "fold-v1",
  "curated_train": {
    "files": ["training/data/bootstrap.json", "training/data/english.json",
              "training/data/hard-negatives.json", "training/data/multilang.json",
              "training/data/seed.json"],
    "sha256": { "training/data/seed.json": "…", "…": "…" },
    "unique_folded_rows": 2402
  },
  "golden": {
    "intents":         { "file": "eval/golden/intents.json",         "sha256": "…", "rows": 61 },
    "bim":             { "file": "eval/golden/bim.json",             "sha256": "…", "rows": 0  },
    "rules":           { "file": "eval/golden/rules.json",           "sha256": "…", "rows": 0  },
    "difficult_cases": { "file": "eval/golden/difficult_cases.json", "sha256": "…", "rows": 0  },
    "regressions":     { "file": "eval/golden/regressions.json",     "sha256": "…", "rows": 4  },
    "adversarial":     { "file": "eval/golden/adversarial.json",     "sha256": "…", "rows": 18 }
  },
  "exclude_row_ids": ["g4b1c9e0a7f3d2b8", "g0f7a3c15d9e2b64", "…"],
  "required_partitions": {
    "intent": ["intents", "difficult_cases", "regressions", "adversarial"],
    "bim":    ["bim", "regressions"],
    "rules":  ["rules", "regressions"]
  }
}
```

`exclude_row_ids` = GOLDEN-EVAL ∪ GOLDEN-REGRESSION-ы **бүх** `row_id`, тодорхой, тоологдох жагсаалт хэлбэрээр (даалгаврын шаардлага: «express the exclusion as concrete row identifiers»).

**Батламж — `train_intent.py`-д, `clean()`-ээс ӨМНӨ:**

```python
# --- ГИШҮҮНЧЛЭЛИЙН БАТЛАМЖ (1B-5).  Энэ нь СЭРЭМЖЛҮҮЛЭГ БИШ, УНАЛТ. ---
from assert_no_leak import assert_paths_not_golden, assert_no_golden_rows

assert_paths_not_golden(args.data)     # eval/golden/ доорх path → SystemExit
rows = load_rows(args.data)
assert_no_golden_rows(rows, MANIFEST)  # exclude_row_ids огтлолцвол → SystemExit
X, y = clean(rows)
```

```python
def assert_no_golden_rows(rows, manifest) -> None:
    excl = set(manifest["exclude_row_ids"])
    hits = [(r.get("text"), row_id(r["text"], r["intent"]))
            for r in rows
            if r.get("text") and r.get("intent")
            and row_id(r["text"], r["intent"]) in excl]
    if hits:
        print("❌ GOLDEN МӨР СУРГАЛТЫН БАГЦАД ОРСОН — BUILD УНАЛАА:", file=sys.stderr)
        for t, rid in hits:
            print(f"     {rid}  {t!r}", file=sys.stderr)
        print("   ЗАСВАР: golden мөрийг СОЛЬ, сургалтын мөрийг БҮҮ ХАС.", file=sys.stderr)
        sys.exit(1)
```

⚠️ **`preprocess_contract` таарахгүй бол мөн унана.** `train_intent.py:80`-ийн `PREPROCESS_CONTRACT = "fold-v1"` өөрчлөгдвөл бүх `row_id` хүчингүй болно — тэр үед `freeze.py --recontract` ажиллуулж manifest-ыг **тусдаа commit-оор** дахин тооцно.

### 3.4 ХООСОН ХУВААРЬ = ХАТУУ БЛОК

**`eval/run_golden.py`-ийн дүрэм:**

```python
kind = args.kind                    # "intent" | "bim" | "rules"
required = MANIFEST["required_partitions"][kind]
blocked = []
for p in PARTITIONS:                # зургуулан дээр нь ҮРГЭЛЖ ажиллана
    n, passed, failed = score(p)
    print(f"  {p:16} мөр={n:>4}  зөв={passed:>4}  буруу={failed:>4}")
    if p in required and n == 0:
        blocked.append(p)           # ❌ алгасахгүй
    if p in required and failed > 0:
        blocked.append(p)
if blocked:
    print("❌ БЛОКЛОВ: " + ", ".join(sorted(set(blocked))), file=sys.stderr)
    sys.exit(2)
```

**Яагаад хоосныг алгасаж болохгүй вэ.** `bim` ба `rules` нь **хоосон шилжинэ** — өнөөдөр typed BIM intent ч, дүрмийн хөдөлгүүр ч байхгүй (Track C). Хоосон хуваарийг «n/a» гээд алгасвал:

1. Track C-ийн эхний загвар «BIM-ийг ойлгодог» гэж мэдэгдэхэд түүнийг **няцаах тоо байхгүй** болно.
2. «Сайжирлаа» гэсэн дельта нь **хэн ч эсэргүүцэж чадахгүй тоо** болно — яг энэ уналтын горимоос сэргийлж 1B байгаа.
3. Хоосон = «бид хараахан хэмжиж чадаагүй», харин алгасалт = «хэмжих шаардлагагүй». Хоёр өөр мэдэгдэл; систем нь эхнийхийг хэлэх ёстой.

Тиймээс: **`kind="intent"` загвар өнөөдөр нийтлэгдэж чадна** (`intents`, `regressions`, `adversarial` дүүрэн; `difficult_cases` эхний `nominate.py` гүйлтийн дараа дүүрнэ — §9-ийн асуулт 6). **`kind="bim"` эсвэл `kind="rules"` загвар өнөөдөр НИЙТЛЭГДЭЖ ЧАДАХГҮЙ** — хэн нэгэн эхлээд тэр мөрүүдийг бичих ёстой. Энэ бол алдаа биш, зорилго.

**Хэвлэлтийн тэмдэглэл (release note) — дельта бүрийн ХАЖУУД мөрийн тоо:**

```
Загвар 2026-08-27.1  (kind=intent)
  хуваарь            мөр    зөв      Δ өмнөхөөс
  intents             61   61/61     +0
  bim                  0    —        ⚠ ХООСОН — харьцуулалт БАЙХГҮЙ
  rules                0    —        ⚠ ХООСОН — харьцуулалт БАЙХГҮЙ
  difficult_cases     23   21/23     +2
  regressions          4    4/4      +0   (ХЭЗЭЭ Ч 4/4-ээс бага байж болохгүй)
  adversarial         18   18/18     +0
```

⚠️ «Δ +2» гэсэн тоог **мөрийн тоогүйгээр хэвлэхийг хориглоно** — 3 мөрийн багц дээрх +2 ба 300 мөрийн багц дээрх +2 хоёр өөр мэдэгдэл.

### 3.5 Auto-growth — `difficult_cases` нэр дэвшүүлэлт

**Зангуу нь `IntentRouter.cs:81`-ийн `0.45`**, DB-ийн `assistant.min_confidence` БИШ (§2.9 — түүнийг хэн ч уншдаггүй).

Зурвас: `MinConfidence ± BAND`, санал болгох `BAND = 0.07` → **[0.38, 0.52]**. Үндэслэл: §2.8-ийн хэмжсэн хүснэгтэд 0.40 ба 0.55 хоёрын хооронд «үйлдэл хийсэн» 93.1% → 88.2% болж хөдөлдөг — өөрөөр хэлбэл шийдвэр яг тэр зурваст хөдөлгөөнтэй. Мөн §2.4-ийн дөрвөн уналтын **гурав нь** (0.58 · 0.41 · 0.38) энэ зурваст эсвэл түүний хаяанд байсан.

```python
# eval/nominate.py — ЗӨВХӨН УНШИНА, хаана ч бичихгүй.
MINC, BAND = 0.45, 0.07      # ⚠️ IntentRouter.cs:81-тэй заавал таарна
rows = api("/api/revit/assistant/borderline?lo=0.38&hi=0.52&limit=500")
for r in rows:
    if row_id(r["text"], r["predicted"] or "unknown") in manifest["exclude_row_ids"]:
        continue                      # аль хэдийн golden
    if preprocess(r["text"]) in curated_folded:
        continue                      # аль хэдийн сургалтад
    print(json.dumps(r, ensure_ascii=False))   # → ХҮНИЙ ХЯНАЛТ руу
```

⚠️ **Нэр дэвшүүлэлт нь автомат, БАТЛАХ нь автомат БИШ.** `nominate.py` нь зөвхөн нэр дэвшигчийн жагсаалт хэвлэнэ; `freeze.py`-ээр хүн шошго өгч оруулна. Автомат оруулбал загвар өөрийн эргэлзээгээ өөрөө шалгуур болгож, гогцоо хаагдана.

**Backend-д ЯАГААД шинэ route хэрэгтэй вэ:** `GET /assistant/pending` (`routes/revit.ts:1863`) нь `confidence`-ыг **буцаадаг** боловч түүгээр **шүүдэггүй**, `limit` дээд тал 200 (`:1866`), эрэмбэ нь curation-ы үнэ цэнээр. Тиймээс зурвасын түүвэр гаргах боломжгүй. Шинэ route:

```ts
/**
 * GET /api/revit/assistant/borderline — ХИЛИЙН ЗУРВАС дахь бүртгэлүүд.
 *
 * ⚠️ Босго нь `IntentRouter.cs:81` дээр ЭМХЭТГЭГДДЭГ (0.45).  `app_settings`
 * дахь `assistant.min_confidence`-ыг ХЭН Ч УНШДАГГҮЙ — 0195:154-156-г үз.
 * Тиймээс зурвасыг ДУУДАГЧ дамжуулна, сервер таамаглахгүй.
 */
revit.get('/assistant/borderline', requireAdmin(), async (c) => {
  const lo = Math.max(0, Math.min(1, Number(c.req.query('lo')) || 0.38));
  const hi = Math.max(lo, Math.min(1, Number(c.req.query('hi')) || 0.52));
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, text, predicted, confidence, decided_by, corrected,
              feedback, feedback_note, acted, created_at
         FROM assistant_logs
        WHERE confidence IS NOT NULL
          AND confidence BETWEEN ? AND ?
          AND curated = 0
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(lo, hi, limit)
    .all();
  return c.json({ band: { lo, hi }, rows: results ?? [] });
});
```

⚠️ 3 bind — D1-ийн 100 bind хязгаарт ойрхон ч биш. `requireAdmin()`-ыг сонгосон нь `/assistant/export`-той (`:1974`) ижил түвшин — түүхий хэрэглэгчийн текст гардаг тул.

### 3.6 Оноог загвартай хамт хадгалах (migration + route)

**`backend/migrations/0201_assistant_model_eval.sql`** (дугаарыг §5-д баталгаажуул):

```sql
-- 0201 — Golden багцын оноог ЗАГВАРТАЙ ХАМТ хадгална.
--
-- ⚠️ ЯАГААД `note` руу хийж БОЛОХГҮЙ ВЭ: `routes/revit.ts:85-88`-ийн `str()`
-- нь 500 тэмдэгтээр ЧИМЭЭГҮЙ таслана — оноо дуусаагүй JSON болж хадгалагдана.
--
-- ⚠️ Одоо байгаа хүснэгтэд ALTER хийж байгаа тул ЭНЭ БЛОК ХАМГИЙН ЭХЭНД.
-- Унавал хоосон хүснэгт үүсэхээс өмнө зогсоно.
--
-- eval_json агуулга: { "dataset_version": …, "manifest_sha256": …,
--   "kind": "intent", "partitions": { "intents": {"rows":61,"pass":61}, … },
--   "blocked": [], "run_at": "…" }
ALTER TABLE assistant_models ADD COLUMN eval_json TEXT;

-- Хөлдөөсөн багцын хувилбар — «энэ загварыг ЯМАР багцаар дүгнэсэн бэ».
ALTER TABLE assistant_models ADD COLUMN eval_dataset_version TEXT;

-- Дүгнэлт БҮРЭН давсан эсэх.  Идэвхжүүлэх хаалга үүн дээр тогтоно.
ALTER TABLE assistant_models ADD COLUMN eval_passed INTEGER NOT NULL DEFAULT 0
  CHECK (eval_passed IN (0,1));

-- «Хамгийн сүүлд давсан загвар аль вэ» гэсэн ганц асуулт.
CREATE INDEX IF NOT EXISTS idx_assistant_models_evalpass
  ON assistant_models (eval_passed, created_at DESC);
```

⚠️ `ADD COLUMN … NOT NULL DEFAULT 0` нь SQLite дээр зөвшөөрөгдөнө (тогтмол default). `CHECK`-тэй хамт `ADD COLUMN` хийхийг **хаядаг D1 дээр эхлээд батал** (§7, алхам 8) — репо дотор энэ хэв маяг ховор.

**`routes/revit.ts` — `POST /assistant/models` (`:1785`) дээр:**

1. `eval` объектыг хүлээж аваад `eval_json` / `eval_dataset_version` / `eval_passed` руу бичнэ (INSERT `:1822`, `ON CONFLICT` салбарт мөн шинэчилнэ).
2. **Идэвхжүүлэлтийн хаалга** — `:1848-1849`-ийн `db.batch`-аас ӨМНӨ:

```ts
  // ⚠️ ГОЛ ХААЛГА: golden багц даваагүй загвар ИДЭВХЖИХГҮЙ.  Энэ шалгалт
  // сервер талд байх ёстой — хөгжүүлэгчийн зөөврийн дээрх Python-ыг
  // засаад өөрийгөө өөрөө «баталгаажуулах» боломжийг хаана.
  if (body.activate !== false && evalPassed !== 1) {
    return c.json(
      { error: 'golden багц даваагүй загварыг идэвхжүүлэх боломжгүй', eval: evalSummary },
      409,
    );
  }
```

**⚠️ Deploy дараалал:** `0201` migration нь **энэ кодоос ХАТУУ ӨМНӨ** хэрэглэгдэнэ (программ-хэмжээний дүрэм: шинэ багана нь түүнийг уншдаг кодоос эрт deploy хийгдэнэ).
**⚠️ Нийцтэй байдал:** `POST /assistant/models`-ын **цорын ганц дуудагч нь `pull_and_retrain.py:192`** (репо даяар өөр дуудагч алга — add-in зөвхөн `GET /assistant/model` уншина). Тиймээс хаалга нэмэх нь ямар ч add-in релиз шаардахгүй; хэрэв хэн нэгэн хуучин Python-оор нийтлэхийг оролдвол **чанга унана**, чимээгүй биш.

### 3.7 `check_behavior.py` — давхардлыг арилгах

PROBES-ыг файлаас уншдаг болгоно, **leak guard-ыг ХЭВЭЭР үлдээнэ**:

```python
# ⚠️ PROBES одоо `eval/golden/intents.json` дотор.  Энэ файлд БУЦААЖ
# хуулж болохгүй — хоёр хуулбар нь чимээгүй зөрнө.
PROBES = load_partition(EVAL / "golden" / "intents.json")
```

`MINC` нь `IntentRouter.cs:81`-тэй таарсан хэвээр. `MINM`-ийн хэрэглэгдэхгүй байдал (§2.3) нь **тусдаа шийдвэр** — §9-ийн асуулт 8, энэ ажил дотор бүү зас.

### 3.8 `pull_and_retrain.py` — зургаа дахь хаалга

`gates` жагсаалтад (`:155-162`) нэмнэ:

```python
        ("GOLDEN БАГЦ", [PY, "../eval/run_golden.py", "--kind", "intent",
                         "--model", str(MODEL)]),
```

Мөн `datasets()` (`:94-96`)-д батламж:

```python
def datasets() -> list[Path]:
    files = sorted(p for p in DATA.glob("*.json") if p.name != "report.json")
    assert_paths_not_golden(files)     # 1B-5 — golden файл энд ХЭЗЭЭ Ч байхгүй
    return files
```

Мөн `:154`-ийн `# --- 3. Гурван хаалга ---` тайлбарыг **«Зургаан хаалга»** болго (§2.6-ийн зөрүү).

### 3.9 `freeze.py` — регресс нэмэх ЦОРЫН ГАНЦ журам

```
python eval/freeze.py add-regression \
    --text "ирцээ тэмдэглэх хуудас хаана байдаг вэ" \
    --intent unknown --incident HN-1 --was "submit_progress@0.58" \
    --why "«бүртгүүл» n-gram дийлсэн" --author "<нэр>"
```

`freeze.py` нь:
1. `row_id` тооцно;
2. CURATED-TRAIN-ийн эвхсэн түлхүүрүүдтэй тулгана — давхцвал **татгалзана** (мөр хасахыг санал болгохгүй);
3. `regressions.json`-д нэмнэ, `manifest.exclude_row_ids` руу id-г нэмнэ, SHA-256-г дахин тооцно;
4. **МӨР ХАСАХ дэд команд БАЙХГҮЙ.** Хасах шаардлагатай бол гараар засаад PR-т яагаад гэдгийг бичнэ — хүний хяналт нь механизм.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Хэн хамаардаг | Эвдвэл юу болох |
|---|---|---|
| `training/data/` доторх файлын **байрлал ба нэр** | `pull_and_retrain.py:96`, `check_behavior.py:135`, `check_fold_parity.py:32-38`, `check_parity.py --data` | Гурван glob чимээгүй өөр багц уншина; хаалгууд утгаа алдана |
| `report.json`-ы нэр | `datasets()`-ийн ЦОРЫН ГАНЦ хасалт (`:96`) | Тайлан өөрөө сургалтын өгөгдөл болно |
| `preprocess()` ↔ `IntentModel.Preprocess()` хос | `train_intent.py:99`, `addin/IntentModel.cs`, `check_parity.py` | Сургалт ба таамаглал өөр онцлог үзнэ; нарийвчлал **чимээгүй** унана |
| `PREPROCESS_CONTRACT = "fold-v1"` (`train_intent.py:80`) | Бүх `row_id` | Гэрээ өөрчлөгдвөл manifest-ийн **бүх id хүчингүй** |
| `textfold.py` ↔ `backend/src/lib/textFold.ts` ↔ `frontend/.../search/normalize.ts` **гурвалсан хос** | `check_fold_parity.py` | Вэб хайлт, Revit хуудасны таарц, санаа таних гурав өөр хариу өгнө |
| `MinConfidence = 0.45` (`IntentRouter.cs:81`) | `check_behavior.py:50`, `nominate.py`-ийн зурвас | Зурвас хөвж, нэр дэвшүүлэлт утгагүй болно |
| `idx_assistant_model_active` (`0195:147-148`) | `POST /assistant/models:1848-1849`-ийн дараалал | Хоёр идэвхтэй загвар → add-in аль нь ирэхийг мэдэхгүй |
| `assistant_models.note` **500 тэмдэгт** (`routes/revit.ts:85-88`) | — | Оноог тийш хийвэл дуусаагүй JSON, ямар ч алдаагүй |
| `hard-negatives.json`-ы 46 мөр | `check_behavior.py`-ийн `сөрөг` бүлэг 14/14 | Хасвал «ирцээ бүртгүүлье» → `submit_progress` уналт **буцаж ирнэ** |
| `POST /assistant/models`-ын цорын ганц дуудагч нь `pull_and_retrain.py:192` | — | «Хаалга нэмэхэд add-in релиз шаардахгүй» гэдэг үүн дээр тогтоно |
| `authMiddleware` / `verifyToken` дээр `purpose === 'mcp'` **бүү чангатга** | ~20 компьютер дээрх add-in | Алсаас сэргээх БОЛОМЖГҮЙ |
| `users` (27 CASCADE хүүхэд) / `projects` (39 CASCADE лавлагаа migration эх дотор) | — | `migrations apply` доторх транзакцид CASCADE **ажилладаг** — эцэг хүснэгтийг ХЭЗЭЭ Ч тэгж дахин бүү бүтээ |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### 5.1 Урьдчилсан нөхцөл

| Нөхцөл | Байдал | Хэрэв байхгүй бол |
|---|---|---|
| **1B-4** — `eval/manifest.json` + хөлдөөсөн holdout | ❌ **ОДООГООР БАЙХГҮЙ.** `docs/bim-ai/` **хоосон**; `train_intent.py:365-370` нь `cross_val` хийгээд **бүх өгөгдөл дээр** дахин сургадаг — hold-out ОГТ БАЙХГҮЙ | 1B-4-ийг эхлээд бич. Хэрэв энэ сесс 1B-4-ээс өмнө ажиллах шаардлагатай бол §3.3-ын manifest бүтцийг **түр** үүсгээд, 1B-4 гарахад талбарын нэрсийг **түүнд нийцүүл** (fork хийж болохгүй) |
| Python + sklearn | ⚠️ Системийн `python` дээр **sklearn БАЙХГҮЙ** (шалгав). `revit-mcp/server/.venv/Scripts/python.exe` байгаа | Бүх команд venv-ийн python-оор |
| `dotnet` | ✅ `/c/Program Files/dotnet/dotnet` | `check_behavior/slots/lang/parity` бүгд C# harness барьдаг |
| Migration дугаарын нөөц | ⚠️ Хамгийн өндөр нь **0200** (190 файл). `0201` чөлөөтэй **байх шиг байна** | Бичихийн ӨМНӨ `ls backend/migrations \| tail -3` дахин ажиллуул. Өөр агент 0201-ыг авсан бол дараагийн чөлөөтэйг ав |

### 5.2 Дараалал

```
1B-4 (manifest + хөлдөөсөн holdout)
   └─> 1B-5  [ЭНЭ АЖИЛ]
         ├─ (a) Python / repo давхарга      — deploy ШААРДАХГҮЙ
         ├─ (b) migration 0201              — DEPLOY 1
         └─ (c) routes/revit.ts             — DEPLOY 2 (заавал (b)-ийн ДАРАА)
               └─> Track C-ийн бүх ажил (bim/rules хуваарь дүүрэх хүртэл БЛОКЛОГДСОН)
```

**(a)-г ганцаараа шилжүүлж болно.** Python давхарга нь ямар ч deploy-гүйгээр бүрэн ажиллана — `run_golden.py` локал загвар дээр ажиллаж, `pull_and_retrain`-ы зургаа дахь хаалга болно. `eval_json` хадгалалт нь зөвхөн «түүх сервер дээр үлдэх» хэсэг. Цаг хомс бол **(a) эхлээд, (b)+(c)-г дараагийн PR-т**.

### 5.3 Deploy командууд (ЯГ энэ дарааллаар)

```bash
# 1. Migration ЭХЛЭЭД (шинэ багана нь уншигчаасаа ХАТУУ эрт)
cd backend
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml

# 2. Дараа нь worker.  --config ЗААВАЛ: репо root-д байгаа wrangler.jsonc
#    ӨӨР worker зарладаг ба wrangler түүнийг сонгож болзошгүй.
npx tsc --noEmit          # wrangler deploy typecheck ХИЙХГҮЙ — өөрөө ажиллуул
npx wrangler deploy --config wrangler.toml
```

Frontend deploy **байхгүй**. Add-in релиз **байхгүй**. (Хэрэв ямар нэг шалтгаанаар Pages хөндвөл `npx -y wrangler@latest pages … --project-name mgl-design-system`.)

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

- [ ] `revit-mcp/eval/` үүссэн; `golden/` дор **зургаан** файл байгаа (`bim.json`, `rules.json` нь `"rows": []`).
- [ ] `eval/manifest.json`-ы `exclude_row_ids` нь GOLDEN-EVAL ∪ GOLDEN-REGRESSION-ы бүх мөрийг **тодорхой id жагсаалтаар** агуулна (intents 61 + regressions 4 + adversarial 18, давхцлыг хассаны дараах бодит тоог `freeze.py` хэвлэнэ).
- [ ] `training/data/` доторх **аль ч файлын мөр өөрчлөгдөөгүй** — `git diff --stat revit-mcp/training/data/` хоосон.
- [ ] `python eval/assert_no_leak.py` → алдагдал 0, exit 0.
- [ ] **Санаатай эвдэлт:** `seed.json`-д golden мөрийн текстийг (мөн түүний **латин хувилбарыг**) нэмээд `train_intent.py` ажиллуулахад **тэгээс ялгаатай кодоор унана** ба алдагдсан мөрийн `row_id` хэвлэгдэнэ. Дараа нь буцаана.
- [ ] `python eval/run_golden.py --kind intent` → `intents 61/61`, `regressions 4/4`, `adversarial 18/18`, `bim 0 ⚠ ХООСОН`, `rules 0 ⚠ ХООСОН`, exit **0**.
- [ ] `python eval/run_golden.py --kind bim` → `❌ БЛОКЛОВ: bim`, exit **2**. (Хоосон нь алгасагдахгүй гэдгийн бодит нотолгоо.)
- [ ] `golden/regressions.json`-ы нэг тэмдэгтийг өөрчлөөд `run_golden.py` ажиллуулахад **SHA-256 таарсангүй** гэж унана.
- [ ] `check_behavior.py` PROBES-ыг файлаас уншиж байгаа ба **61/61 хэвээр** (`dotnet` шаардана).
- [ ] `pull_and_retrain.py --offline` нь **зургаан** хаалга ажиллуулж, аль нэг нь унавал НИЙТЛЭХГҮЙ.
- [ ] `nominate.py` нь зурвасыг `0.38–0.52` гэж хэвлэх ба тэр тоо `IntentRouter.cs:81`-ийн `0.45 ± 0.07`-тай таарна.
- [ ] Migration хэрэглэгдсэний дараа `PRAGMA table_info(assistant_models)` дээр `eval_json`, `eval_dataset_version`, `eval_passed` гурав харагдана.
- [ ] `POST /assistant/models` дээр `activate: true` + golden даваагүй → **409**; golden давсан → **201**.
- [ ] Хэвлэлтийн тэмдэглэлд дельта бүрийн **хажууд мөрийн тоо** байна.
- [ ] `cd backend && npx tsc --noEmit` дээрх алдаанууд зөвхөн **хамааралгүй** файлд байвал энэ нь чиний саад БИШ — эзэнд мэдэгд, бүү хөө.

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 0. Урьдчилсан баримт дахин батлах (ХАМГИЙН ЭХЭНД) --------------
cd /c/Users/User/project/mgl-e-c
ls backend/migrations | tail -3                       # 0201 чөлөөтэй эсэх
grep -rn "assistant.min_confidence" --include=*.ts --include=*.cs \
     --include=*.sql --include=*.py . | grep -v node_modules
#   ХҮЛЭЭЛТ: ЯГ 2 мөр (0195:163 ба IntentRouter.cs:76) — уншигч БАЙХГҮЙ
sed -n '81p;95p;176p' revit-mcp/addin/IntentRouter.cs   # 0.45 / 0.15 / хэрэглээ
sed -n '94,96p'   revit-mcp/training/pull_and_retrain.py  # datasets() glob
sed -n '147,156p' revit-mcp/training/check_behavior.py    # leak guard
sed -n '1703,1707p' backend/src/routes/revit.ts           # BINDS тайлбарын зөрүү

# --- 1. Python орчин (⚠️ системийн python дээр sklearn БАЙХГҮЙ) ------
PY="/c/Users/User/project/mgl-e-c/revit-mcp/server/.venv/Scripts/python.exe"
"$PY" -c "import sklearn, numpy; print(sklearn.__version__)"

# --- 2. Одоогийн суурь (өөрчлөхийн өмнө) ----------------------------
cd revit-mcp/training
PYTHONIOENCODING=utf-8 "$PY" -c "
import ast, io
src = io.open('check_behavior.py', encoding='utf-8').read()
for n in ast.parse(src).body:
    if isinstance(n, ast.AnnAssign) and getattr(n.target,'id','')=='PROBES':
        print('PROBES =', len(ast.literal_eval(n.value)))"
#   ХҮЛЭЭЛТ: PROBES = 61

# --- 3. Гишүүнчлэлийн батламж ---------------------------------------
cd ../eval
PYTHONIOENCODING=utf-8 "$PY" assert_no_leak.py          # exit 0, алдагдал 0

# --- 4. Golden гүйлт --------------------------------------------------
PYTHONIOENCODING=utf-8 "$PY" run_golden.py --kind intent   # exit 0
PYTHONIOENCODING=utf-8 "$PY" run_golden.py --kind bim      # exit 2, «БЛОКЛОВ: bim»

# --- 5. САНААТАЙ ЭВДЭЛТ (ХАМГИЙН ЧУХАЛ шалгалт) ---------------------
cd ../training
cp data/seed.json /tmp/seed.bak.json
PYTHONIOENCODING=utf-8 "$PY" - <<'PY'
import json, io
o = json.loads(io.open('data/seed.json', encoding='utf-8').read())
o['rows'].append({"text": "маргааш цас орох уу", "intent": "unknown", "style": "cyrillic"})
io.open('data/seed.json', 'w', encoding='utf-8').write(
    json.dumps(o, ensure_ascii=False, indent=1))
PY
PYTHONIOENCODING=utf-8 "$PY" train_intent.py --data data/*.json --out /tmp/x.json
echo "exit=$?"      # ХҮЛЭЭЛТ: 1, «GOLDEN МӨР СУРГАЛТЫН БАГЦАД ОРСОН»
cp /tmp/seed.bak.json data/seed.json     # ⚠️ ЗААВАЛ БУЦААНА

# --- 6. Бүтэн гогцоо (dotnet шаардана, ~2-4 мин) --------------------
PYTHONIOENCODING=utf-8 "$PY" pull_and_retrain.py --offline
#   ХҮЛЭЭЛТ: 6 хаалга, бүгд ✅ ДАВСАН, «--publish өгөөгүй тул серверт илгээгээгүй»

# --- 7. Backend typecheck (deploy-оос ӨМНӨ) -------------------------
cd /c/Users/User/project/mgl-e-c/backend && npx tsc --noEmit

# --- 8. Migration-ыг ХАЯГДАХ D1 дээр эхлээд (CHECK-тэй ADD COLUMN) --
npx wrangler d1 create mgl-eval-throwaway
npx wrangler d1 execute mgl-eval-throwaway --remote \
    --file migrations/0195_assistant_learning.sql
npx wrangler d1 execute mgl-eval-throwaway --remote \
    --file migrations/0201_assistant_model_eval.sql
npx wrangler d1 execute mgl-eval-throwaway --remote \
    --command "PRAGMA table_info(assistant_models);"
npx wrangler d1 delete mgl-eval-throwaway
```

⚠️ `wrangler` дуудлага бүрд Bash sandbox-ыг унтраах шаардлагатай байж болно, мөн OAuth токен сессийн дунд унтарч болзошгүй.
⚠️ `wrangler` нь нийлмэл SQL-ийг **том үсгийн `END;`** төгсгөгчөөр (өмнөө зайтай, өөрийн мөрөнд) хуваадаг. `0201`-д блок байхгүй тул хамаарахгүй, гэвч дараа нэмбэл санаж бай.
⚠️ Репо даяар `CREATE TRIGGER`, `CREATE VIEW`, `GENERATED ALWAYS`, `json_extract` **ТЭГ** (190 migration-д батлав). `eval_json`-ыг SQL дотор задлахыг бүү оролд — TS талд `JSON.parse`.

---

## 8. ROLLBACK

| Давхарга | Буцаах арга | Шинэ migration дугаар хэрэгтэй юу |
|---|---|---|
| **Python / `eval/` лавлах** | `git revert <sha>`. `revit-mcp/eval/` бүхэлдээ шинэ — устгахад юу ч хамаарахгүй. `check_behavior.py`-ийн PROBES revert-ээр inline руугаа буцна. | ❌ |
| **`pull_and_retrain.py`-ийн 6 дахь хаалга** | `gates` жагсаалтаас мөрийг ХАС. Ямар ч төлөв үлдэхгүй. | ❌ |
| **`routes/revit.ts` идэвхжүүлэлтийн хаалга + `/borderline`** | `git revert` + `npx wrangler deploy --config wrangler.toml`. Хаалга алга болно, багана үлдэнэ (хор хөнөөлгүй). | ❌ |
| **`0201` migration** | ⚠️ **`ALTER TABLE … DROP COLUMN` бүү хий.** SQLite/D1 дээр энэ нь `assistant_models`-ыг дахин бүтээх эрсдэлтэй. Багана `NULL`-тэй үлдэх нь ямар ч уншигчийг эвдэхгүй — репо дахь өмнөх жишээнүүд: `accent_color`, `tv_kiosk`, `model_xkt_url`, `repair_projects.rate_multiplier`. | ✅ **Хэрэв ЗААВАЛ хасах бол ШИНЭ дугаар (0202+)**; `0201`-ыг **хэзээ ч бүү зас** — хэрэглэгдсэн файлыг засах нь продакшн дээр чимээгүй юу ч хийхгүй |
| **`eval_passed` хаалга буруу загварыг блоклож байвал (яаралтай)** | Түр зуур: D1 дээр **гараар** `UPDATE assistant_models SET eval_passed = 1 WHERE version = ?`. ⚠️ Энэ нь мөр үлдээдэг тул зөв яаралтай хавхлага; кодыг тойрч deploy хийхээс дээр. | ❌ |
| **Golden мөр буруу бичигдсэн** | `git revert` тэр commit-ыг. ⚠️ **Регрессийн мөрийг «дараа нь» устгаж болохгүй** — `freeze.py`-д устгах команд байхгүй нь санаатай. Буруу мөрийг ЗАСАХ бол шинэ commit + PR-т тайлбар. | ❌ |

**Хэсэгчилсэн уналт:** `0201`-ийн гурван `ALTER` дундуур унавал (жишээ нь `CHECK`-тэй `ADD COLUMN` татгалзвал) D1 хагас-migrated үлдэнэ. **Цорын ганц хууль ёсны засвар нь ШИНЭ дугаар** — `PRAGMA table_info(assistant_models)`-оор аль багана орсныг тогтоож, дутууг нь `0202`-д нэм. `0201`-ыг бүү зас.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

| # | Асуулт | Яагаад репоноос шийдэгдэхгүй вэ | Хэн хариулах |
|---|---|---|---|
| 1 | **Хуваарь тус бүрийн хүлээн зөвшөөрөх ХАМГИЙН БАГА мөрийн тоо хэд вэ?** Санал: `intents` ≥ 61 (одоогийн), `regressions` ≥ 4 ба **зөвхөн өснө**, `adversarial` ≥ 18, `difficult_cases` ≥ 20 (эхний нэр дэвшүүлэлтийн дараа), `bim`/`rules` ≥ 30 — тэр төрлийн загвар гаргахаас өмнө | Тоо бол **бүтээгдэхүүний эрсдэлийн шийдвэр**, кодоос гарахгүй. «Хэдэн уналтыг үүрд барих вэ» гэдэг эзний хариуцлага | **Эзэн** |
| 2 | **Регрессийн тохиолдол нэмэх эрхтэй хэн бэ?** Санал: (a) хэн ч **нэр дэвшүүлж** болно; (b) `freeze.py add-regression`-ыг **эзэн эсвэл техникийн ахлагч** л ажиллуулна; (c) PR-т **incident + was + why** гурав заавал | Репо-д зохиогчийн эрхийн бодлого байхгүй; `assistant_examples.created_by` (`0195:54`) бол өөр зүйл | **Эзэн** |
| 3 | **`rules` хуваарийн БНбД тоонууд хаанаас ирэх вэ?** `revit-mcp/CLAUDE.md:59-116`-ийн утгууд өөрөө «**design-guidance values**, албан ёсны БНбД-тэй тулгаагүй» гэж бичигдсэн (`CLAUDE.md:7-12`) | Тулгаагүй тоог golden болговол **буруу дүрмийг үүрд хөлдөөнө** | **Эзэн / архитектор** |
| 4 | **1B-4-ийн manifest талбаруудын нэр.** Энд `dataset_version`, `exclude_row_ids`, `preprocess_contract` гэж санал болгов. 1B-4 өөр нэр сонгосон бол **түүнийг дага, fork хийж болохгүй** | `docs/bim-ai/` хоосон — 1B-4 хараахан байхгүй | 1B-4-ийг бичсэн сесс |
| 5 | **Migration дугаар 0201 нөөцлөгдсөн үү?** Хамгийн өндөр нь одоо `0200`. Репо-д аль хэдийн **6 давхардсан дугаар** бий (0002, 0060, 0080, 0110, 0120, 0121) | Зэрэгцээ агентууд дугаар авдаг | **Оркестратор / эзэн** |
| 6 | **`assistant_logs`-д зурвасын түүвэр гаргахад хангалттай мөр бий юу?** `SELECT COUNT(*) FROM assistant_logs WHERE confidence BETWEEN 0.38 AND 0.52 AND curated = 0;` | Продакшн асуулт. `assistant.logging` = `on` (`0195:166-167`) боловч бодит эзлэхүүнийг хэн ч хэмжээгүй. **0 бол `difficult_cases` хоосон хэвээр байх ба §3.4-ийн дүрмээр `intent` загвар БЛОКЛОГДОНО** — тэр үед `required_partitions.intent`-ээс `difficult_cases`-ыг түр хасах уу, эсвэл гараар 20 мөр бичих үү гэдгийг эзэн шийднэ | **Продакшн асуулга + эзэн** |
| 7 | **`--max-drop 0.02` (`pull_and_retrain.py:117`) golden оноонд ч хамаарах уу?** Санал: **ҮГҮЙ** — `regressions` дээр ямар ч бууралт зөвшөөрөгдөхгүй (4/4 → 3/4 нь шууд блок), харин `intents`/`difficult_cases` дээр эзэн тэвчих хэмжээг тогтооно | Одоогийн 0.02 нь сургалтын хөндлөн шалгалтад зориулагдсан, өөр утгатай тоо | **Эзэн** |
| 8 | **`check_behavior.py`-ийн `MINM` хэрэглэгдэхгүй байгааг засах уу?** (`:50` дээр тодорхойлогдсон, `:189` дээр хэрэглэгдээгүй; `IntentRouter.cs:176` нь хоёуланг нь хэрэглэдэг.) Засвал одоогийн 61/61 унаж болзошгүй | Энэ нь зан төлөвийн өөрчлөлт — «шалгалт чангарлаа» гэж мэдэгдэхийн өмнө эзэн мэдэх ёстой | **Эзэн** |

---

### Хавсралт — энэ брифийг бичихдээ ИЛЭРСЭН баримтын зөрүүнүүд

| Байршил | Бичсэн нь | Бодит нь |
|---|---|---|
| `backend/src/routes/revit.ts:1703` | `// 12 bind/мөр → floor(100/12) = 8 мөр/statement` | `const BINDS = 13` (`:1706`); дараагийн мөр (`:1705`) өөрөө `13 × 7 = 91` гэж зөв бичсэн |
| `backend/migrations/0195_assistant_learning.sql:138` | «доорх trigger барина» | Trigger биш — `idx_assistant_model_active` хэсэгчилсэн ӨВӨРМӨЦ индекс (`:147-148`). Репо даяар `CREATE TRIGGER` ТЭГ |
| `revit-mcp/training/pull_and_retrain.py:154` | `# --- 3. Гурван хаалга ---` | Тав (`:155-162`); файлын docstring (`:15`) өөрөө «ТАВАН ХААЛГА» гэдэг |
| `revit-mcp/docs/ASSISTANT.md:323-338` | «ТАВАН ШАЛГАЛТ» + `check_fold_parity` | `pull_and_retrain`-ийн бодит тав нь `check_fold_parity`-г ОРУУЛААГҮЙ, `check_conversation`-ыг ОРУУЛСАН. `check_nudge.py` (20 тохиолдол) нь **аль ч жагсаалтад алга** |
| `revit-mcp/training/check_behavior.py:50` | `MINC, MINM = 0.45, 0.15` | `MINM` **хэрэглэгддэггүй** (`:189` зөвхөн `MINC`) |
| `revit-mcp/training/train_intent.py:20` (docstring) | «тэмдэгтийн 3-5 n-gram» | `NGRAM_MIN, NGRAM_MAX = 2, 6` (`:95-96`) |
| `revit-mcp/addin/IntentRouter.cs:53`, `0195:160` | «2392 мөрийн хөндлөн шалгалт» | `data/report.json` одоо `"examples": 2402` — босгын хэмжилтээс хойш өгөгдөл нэмэгдсэн |
| `revit-mcp/training/data/production.json` | — | Машин бичдэг файл (`pull_and_retrain.py:79-86`) боловч `.gitignore`-д ОРООГҮЙ ба git-д ч хянагддаггүй — татсаны дараа untracked болж гарч ирнэ |
