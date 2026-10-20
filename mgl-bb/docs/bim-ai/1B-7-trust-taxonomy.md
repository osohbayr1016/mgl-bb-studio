# 1B-7-trust-taxonomy — Өгөгдлийн итгэлийн таксономи — 8 төлөв ба хянан үзэх мөчлөг

> **Track:** 1B · DATA INTEGRITY (item 7)
> **Хамаарал (depends on):** 1B-6 «курацийн UI» — тэр UI л эдгээр төлөвийг бичнэ. Схем нь UI-гүйгээр ч аюулгүй суух ба одоогийн зан төлөвийг байт байтаар хадгална. Мөн 1B-1 / 1B-3-тай **зөвхөн миграцийн ДУГААРААР** мөргөлдөнө.
> **Блоклож буй (blocks):** 1B-4 (training integrity / manifest), 1B-5 (golden datasets) — хоёулаа «аль мөр сургалтад тэнцэх вэ» гэдгийг энэ таксономиос уншина.
> **Хөндөх файлууд:**
> `backend/migrations/0203_assistant_trust_taxonomy.sql` (ШИНЭ, дугаарыг §5-аас баталгаажуул)
> `backend/src/routes/revit.ts` (§8 «Туслахын СУРАЛЦАХ давхарга», мөр 1609–1991 хооронд)
> `revit-mcp/training/pull_and_retrain.py` (СОНГОЛТТОЙ, 1 мөр — §3.5)
> **Deploy тоо:** **2** — (1) `d1 migrations apply --remote`, (2) `wrangler deploy`. Дараалал заавал. Гуравдугаар deploy БАЙХГҮЙ; frontend, add-in хөндөгдөхгүй.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

| # | Дүрэм |
|---|---|
| 1 | **Хамрах хүрээнээс гарахгүй.** Зөвхөн дээрх 3 файл. `assistant_*` хүснэгтүүд болон `routes/revit.ts`-ийн §8 бүлгээс гадуур юу ч засахгүй. |
| 2 | **Энэ репо дээр олон агент ЗЭРЭГ ажилладаг.** Ажлын мод дотор өөр хүний дуусаагүй, магадгүй **эмхэтгэгдэхгүй** файл байж болно. Тэдгээрийг «засах», форматлах, буцаах, цэвэрлэх — **ХОРИОТОЙ**. |
| 3 | **Өөрийн бус файлыг `git restore` / `git checkout --` / `git add` хийхгүй.** Хэрэглэх ёстой файл эвдэрхий байвал өөрөө сэргээхгүй — **зогсоод эзэнд хэл**. |
| 4 | **Бүтэн build унасан нь автоматаар таных биш.** `tsc --noEmit` нь бүх воркерыг эмхэтгэдэг. Алдаа зөвхөн таны хөндөөгүй файлууд дээр байгаа эсэхийг батал, дараа нь тэр блокерыг **эзэнд мэдэгд** — араас нь хөөцөлдөхгүй. |
| 5 | **`verifyToken` / `authMiddleware`-ийг ХЭЗЭЭ Ч `purpose === 'mcp'`-ийг татгалзуулахаар чангатгахгүй.** Add-in бүх REST дуудлагаа тэр токеноор хийдэг, refresh урсгал байхгүй. Энэ бол алсаас сэргээх боломжгүй ЦОРЫН ГАНЦ өөрчлөлт (~20 компьютер, `Install.bat`, Revit хаалттай). Энэ сесс эрхийн давхаргад **огт хүрэхгүй**. |
| 6 | **`users` / `projects`-ыг `migrations apply`-аар дахин барихгүй.** Энэ сесст ямар ч rebuild байхгүй — зөвхөн `ALTER TABLE … ADD COLUMN`. |
| 7 | **C# (`revit-mcp/addin/`) хөндөхгүй.** Add-in-ийн БҮХ өөрчлөлт 1C-ийн НЭГ релизэд багцлагдана. |
| 8 | **Deploy хийж БОЛНО**, гэхдээ §5-ын дараалалаар л. Тестгүйгээр deploy хийхгүй; `tsc --noEmit` нь `wrangler deploy`-д ОРДОГГҮЙ, өөрөө ажиллуул. |
| 9 | **Frontend-д огт хүрэхгүй.** Курацийн UI бол 1B-6-ийн ажил. |

---

## 1. КОНТЕКСТ

### 1.1 Систем (хүйтэн сесст хангалттай хэмжээгээр)

- **`backend/`** — Cloudflare Worker. Default export нь Hono **биш**, `@cloudflare/workers-oauth-provider`; Hono app нь түүний `defaultHandler`. Хадгалалт: **D1** (SQLite), **R2** (`MEDIA_BUCKET` нийтэд нээлттэй / `MEETING_BUCKET` хаалттай), **KV**, нэг **Durable Object** (`MglMcpAgent`).
- **`frontend/`** — Vite + React 19 SPA, Cloudflare Pages, төсөл нь **`mgl-design-system`** (`--project-name mgl-design-system`-ыг **үргэлж тодорхой дамжуул**).
- **`revit-mcp/addin/`** — Revit 2024–2027 add-in, C#/WPF, in-process, ~16k мөр / 47 файл, **тест ТЭГ**, ажилтны компьютер дээр **автомат шинэчлэлт БАЙХГҮЙ**.
- **`revit-mcp/training/`** — Python-ий санаа таних ангилагчийн сургалтын хоолой, git-д хянагддаг.
- **`revit-mcp/server/`, `revit-mcp/agent/`** — Python MCP гүүр ба бие даасан локал агент.
- ~49 идэвхтэй мэдлэгийн ажилтан. Продакшны D1 = **45 MB / 114 хүснэгт**; хамгийн том хүснэгт нь `progress_entries` **8 062 мөр**.

### 1.2 Платформын ХАТУУ хязгаарлалтууд (энэ сесст хамаарах хэсэг)

| Хязгаар | Дэлгэрэнгүй |
|---|---|
| **D1: нэг statement дээд тал нь 100 bind** | Тохируулсан жишээ: `backend/src/routes/qto.ts:832` «Fact insert — 4 мөр/statement (21 bind × 4 = 84 ≤ D1-ийн 100 bind хязгаар)». `routes/revit.ts:58-59` `BINDS_PER_BINDING_ROW = 13` → `= 7`. ⚠️ **АМЬД ДРИФТ:** `revit.ts:1704` дээрх тайлбар «12 bind/мөр → floor(100/12) = 8 мөр/statement» гэж бичсэн боловч дараагийн 2 мөр нь «13 × 7 = 91» гэж, тогтмол нь `const BINDS = 13;` (`revit.ts:1706`). **Тогтмол нь ЗӨВ** (INSERT-д 13 багана бий — 0200 `feedback_note` нэмэхэд тайлбарын эхний мөр хоцорсон). Аль нэгийг нь **хуулж авахаас өмнө INSERT-ийн баганыг тоол.** |
| **Миграц APPEND-ONLY** | 190 файл, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. Хэрэгжсэн файлыг засах нь продакшн дээр **чимээгүй no-op**. Дунд нь унавал сан хагас-миграцтай үлдэх бөгөөд цорын ганц хууль ёсны засвар нь **ШИНЭ дугаар**. |
| **`IF NOT EXISTS`** | Хэмжсэн: репод `CREATE TABLE`-тэй 82 миграц, `IF NOT EXISTS`-гүй нь **0**. Шинэ `CREATE INDEX` бас заавал `IF NOT EXISTS`. |
| **`ALTER` эхэнд** | Байгаа хүснэгт дээрх `ALTER` нь миграцийн блокийн **ХАМГИЙН ЭХЭНД** — унавал хоосон хүснэгт үүсэхээс өмнө таслагдана. Энэ миграцид `CREATE TABLE` огт байхгүй тул дараалал: **ALTER ×5 → UPDATE backfill ×2 → CREATE INDEX**. |
| **D1 нь FK-г ажиллах үед хэрэгжүүлдэггүй, ГЭВЧ `migrations apply` нь файл бүрийг transaction-д ороодог бөгөөд тэнд `ON DELETE CASCADE` ЗААВАЛ ажиллана.** | `users` ба `projects` эцэг хүснэгтийг `migrations apply`-аар **хэзээ ч rebuild хийхгүй**. Энэ сесст rebuild байхгүй. |
| **`END;` том үсгээр, өөрийн мөрөнд, өмнө нь зай** | wrangler-ийн задлагч үсэг ялгадаг. Репо дахь прецедент: `backend/migrations/0093_project_complexity_pct.sql:35` — `UPDATE … CASE … END;` нь өөрийн мөрөнд том үсгээр. Энэ миграцид `CASE … END` **хоёр удаа** ашиглагдана (§3.1) — тэр дүрмийг мөрд. |
| **`CREATE TRIGGER` / `CREATE VIEW` / `GENERATED ALWAYS` / `json_extract` — 190 файлд ТЭГ** | Хэмжсэн (`grep -ric`). Энэ миграц тэдний **аль нэгийг ч ашиглахгүй**. ⚠️ `0195_assistant_learning.sql:138` дээрх тайлбар «(доорх trigger барина)» гэдэг нь **ТӨӨРӨГДӨЛ** — бодит хэрэгжүүлэлт нь `idx_assistant_model_active` хэсэгчилсэн ӨВӨРМӨЦ индекс (мөр 147-148). Тэр тайлбарыг битгий дагаж trigger бичээрэй. |
| **Deploy нь ЛОКАЛ wrangler, CI БИШ** | Хоёр GitHub workflow үхсэн. `npx wrangler deploy --config wrangler.toml` — `--config` нь **заавал**, репогийн үндэс дэх `wrangler.jsonc` өөр воркер зарладаг. `wrangler deploy` нь **typecheck хийдэггүй**. |
| **`pages` дэд командууд** | `npx -y wrangler@latest pages …`. Энэ сесст хамаарахгүй (frontend хөндөгдөхгүй). |
| **Шинэ багана нь түүнийг уншдаг кодоос ЧАНД ЭРТ deploy-д гарна** | §5-ын дараалал үүнээс гарч байгаа. |

### 1.3 Энэ ажил яагаад байгаа вэ

Санаа таних ангилагч нь API/LLM/интернэт шаардахгүй ажиллах ёстой (`routes/revit.ts:1613-1625`). Түүнийг сайжруулах цорын ганц зам нь бодит хэрэглээг цуглуулж, **шошголж**, дахин сургах гогцоо. Тэр гогцоо шипсэн — **гэвч «энэ мөр итгэж болох уу» гэдгийг илэрхийлэх талбар БАЙХГҮЙ.**

Одоо `assistant_examples` дээр `source` гэсэн **гурван утгатай** багана (`'seed' | 'usage' | 'manual'`) ба `is_active` гэсэн 0/1 туг бий. Энэ хоёр нь **хоёр өөр асуултыг нэг талбарт шахсан**:

- «Энэ мөр хаанаас ирсэн бэ?» (гарал үүсэл)
- «Хүн үүнийг харж, зөв гэж баталсан уу?» (хянан үзэх)

Эдгээр нь **ХОЁР ТЭНХЛЭГ** бөгөөд тэднийг нийлүүлж болохгүй.

> ### ⚠️ ЭНЭ ДААЛГАВРЫН ГОЛ ЗАГВАРЫН ЦЭГ
>
> **ЭХ СУРВАЛЖИЙН таксономи** (`HUMAN`, `AI_GENERATED`, …) ба **ХЯНАН ҮЗЭХ МӨЧЛӨГ** (`pending`, `reviewed`, `verified`, `rejected`) нь **ХОЁР ТУСДАА ТЭНХЛЭГ**.
>
> Нэг мөр нэгэн зэрэг **`AI_GENERATED` БАС хүнээр баталгаажсан** (`review_state = 'verified'`) байж БОЛНО — энэ бол зөрчил биш, хамгийн энгийн тохиолдол.
>
> **Тэднийг хэзээ ч нэг багана болгож нийлүүлэхгүй.** Сургалтад тэнцэх эсэх нь **хоёуланских нь функц**:
> ```
> eligible(row) = policy_allows(row.source_type) AND row.review_state IN ('reviewed','verified')
> ```
> AI-ийн үүсгэсэн агуулга **хэзээ ч чимээгүйгээр ground truth болохгүй.**

### 1.4 Эзний тодорхойлолт (өөрчлөхгүй)

**Яг эдгээр найман эх сурвалжийн төлөв:**

| # | `source_type` | Утга |
|---|---|---|
| 1 | `HUMAN` | Хүн 0-оос бичсэн |
| 2 | `HUMAN_CORRECTED` | Машин таасан → **хүн залруулсан** (жинхэнэ санааг хүн бичсэн) |
| 3 | `HUMAN_VERIFIED` | Машин таасан → хүн **зөв гэж баталсан** (залруулаагүй) |
| 4 | `RULE_VERIFIED` | Детерминист дүрэм/шалгуураар баталгаажсан |
| 5 | `SYNTHETIC` | Зориудаар үүсгэсэн (аугментац, хэв маягийн хувилбар) |
| 6 | `AI_GENERATED` | Загвар/LLM бичсэн |
| 7 | `IMPORTED` | Гаднаас оруулсан, гарал үүсэл нь өөр систем |
| 8 | `UNKNOWN` | Гарал үүсэл нь **тодорхойгүй** — таамаглахгүй |

**Анхны бодлого (initial policy):**

```
core training  =  HUMAN_VERIFIED ∪ RULE_VERIFIED ∪ HUMAN_CORRECTED
SYNTHETIC      =  сонголттой (тохиргоогоор асаана/унтраана)
AI_GENERATED   =  ЗӨВХӨН үнэлгээ (evaluation), сөрөг жишээ (negative), аугментац
HUMAN          =  цөмд орох эсэхийг эзэн шийднэ (§9.6)
IMPORTED       =  цөмд ОРОХГҮЙ, гарал үүслээ баталгаажуулах хүртэл
UNKNOWN        =  цөмд ХЭЗЭЭ Ч ОРОХГҮЙ
```

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг **энэ сессээр нээж шалгасан** (2026-08-27). Код нь хуулбарласан бодит текст.

### 2.1 Схем — `backend/migrations/0195_assistant_learning.sql`

`assistant_examples` (мөр 28–57):

```sql
  -- seed   = гараар/AI-аар үүсгэсэн үр
  -- usage  = бодит хэрэглээнээс шошголсон
  -- manual = хүн гараар нэмсэн
  source      TEXT    NOT NULL DEFAULT 'seed'                       -- :47
                      CHECK (source IN ('seed','usage','manual')),  -- :48

  -- Муу жишээг УСТГАХГҮЙ, унтраана — юу яагаад хасагдсаныг мэдэх ёстой.  -- :50
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),      -- :51
  note        TEXT,                                                       -- :52
```

- **Мөр 50 бол ЗОРИЛГЫН МЭДЭГДЭЛ, түүнийг хэрэгжүүлээгүй.** «Муу жишээг УСТГАХГҮЙ, унтраана — юу яагаад хасагдсаныг мэдэх ёстой». Хэмжсэн: `is_active`-ийг **0 болгодог код репод БАЙХГҮЙ**, `note` багана руу **бичдэг код БАЙХГҮЙ**. `grep -rn "assistant_examples" backend/src/` нь **зөвхөн `routes/revit.ts`**-ыг буцаана; `is_active`-ийн бүх бичилт нь `= 1` (`revit.ts:1945`).
- Индексүүд: `idx_assistant_ex_uniq(text, intent)` ӨВӨРМӨЦ (:59-60), `idx_assistant_ex_intent(intent, is_active)` (:61-62), `idx_assistant_ex_folded(text_folded)` (:63-64).

`assistant_logs` (мөр 70–104):

```sql
  -- Шошголж `assistant_examples` руу шилжүүлсэн эсэх.                    -- :99
  curated       INTEGER NOT NULL DEFAULT 0 CHECK (curated IN (0,1)),      -- :100
```

`0200_assistant_feedback_note.sql` нь `assistant_logs`-д `feedback_note TEXT` нэмсэн (энэ хүснэгт дээрх хамгийн сүүлийн ALTER).

### 2.2 Цорын ганц бичигч — `backend/src/routes/revit.ts`

Mount: `backend/src/index.ts:216` → `app.route('/api/revit', revit);`
Роутерийн gate: `revit.ts:79` → `revit.use('*', requireRole(...REVIT_ROLES));`, `REVIT_ROLES = ['engineer','architect','senior','admin']` (`revit.ts:45`).
`isManager` (`revit.ts:90-92`): `role === 'admin' || role === 'senior'`.

**А. `POST /assistant/examples` — `revit.ts:1900-1968`**

`source`-ыг клиентээс авах хэлбэр (`revit.ts:1922`):
```ts
source: e.source === 'seed' || e.source === 'manual' ? String(e.source) : 'usage',
```
→ хүлээн зөвшөөрөгдөөгүй ямар ч утга **чимээгүйгээр `'usage'`** болно.

Upsert (`revit.ts:1941-1947`):
```sql
INSERT INTO assistant_examples
  (text, text_folded, intent, slot, style, source, created_by)
VALUES ${values}
ON CONFLICT (text, intent) DO UPDATE SET
  is_active = 1,                                              -- :1945
  slot      = COALESCE(excluded.slot, assistant_examples.slot)
```
→ **`ON CONFLICT` нь `is_active`-ыг АЛБАДАН 1 болгоно.** Хэрэв ирээдүйд хэн нэгэн мөрийг унтраавал, ижил текст дахин ирэхэд тэр **чимээгүйгээр амилна**.

`curated` тугийг тавих хэсэг (`revit.ts:1951-1964`):
```ts
const ids = Array.isArray(body.log_ids) ? … : [];
if (ids.length > 0) { … `UPDATE assistant_logs SET curated = 1 WHERE id IN (…)` … }
```

**⚠️ ХОЁР БОДИТ АЛДАА, ХОЁУЛАА БАТАЛГААЖСАН:**

| # | Алдаа | Нотолгоо |
|---|---|---|
| 1 | **Татгалзал бүртгэх боломж ОГТ БАЙХГҮЙ.** `revit.ts:1926` — `if (rows.length === 0) return c.json({ added: 0 });` нь `log_ids`-ийн блок (`:1951`)-оос **ӨМНӨ** буцаадаг. Тиймээс «энэ бүртгэл муу, жишээ болгохгүй» гэж зөвхөн `log_ids` илгээвэл сервер **юу ч хийхгүй**, мөр `curated = 0` хэвээр үлдэж `/assistant/pending`-д **үүрд эргэж гарна**. | `revit.ts:1926` vs `:1951` |
| 2 | **`curated` нь дэвшүүлэлтийн ДАГАВАР ҮР ДАГАВАР.** Нэг батчид дор хаяж 1 жишээ БАЙВАЛ, тэр батчийн бүх `log_ids` `curated = 1` болно — тэр бүртгэлүүд жишээ болсон эсэхээс үл хамааран. Өөрөөр хэлбэл **дэвшүүлсэн мөр ба (батчид оруулсан) татгалзсан мөр хоёулаа `curated = 1`** болж, ялгагдахаа болино. | `revit.ts:1954-1964` дэх `UPDATE`-д жишээний мөртэй ямар ч холбоо байхгүй |

*(Тайлбар: даалгаврын анхны тодорхойлолт «дэвшүүлэлт нь `curated`-ыг дагавар байдлаар тавьдаг тул татгалзсан ба дэвшүүлсэн мөр хоёулаа `curated`» гэсэн нь **бүрэн зөв биш** — бодит байдал арай ноцтой: цэвэр татгалзал огт бүртгэгдэх боломжгүй. §3.3-т хоёуланг нь засна.)*

**Б. `GET /assistant/export` — `revit.ts:1974-1990`**

```sql
SELECT text, intent, slot, style, source        -- :1977
  FROM assistant_examples
 WHERE is_active = 1                            -- :1979
 ORDER BY intent, id
```
`return c.json({ count: rows.length, per_intent: byIntent, rows });` (`:1989`)

- Эрх: `requireAdmin()` (`revit.ts:1974`).
- ⚠️ **Даалгаврын «source баганыг хаяж байна» гэсэн заалт нь ТОДОРХОЙ БУС.** Бодит байдал: **SQL нь `source`-ыг СОНГОЖ, роут нь буцаадаг.** Хаядаг нь **хэрэглэгч** — `revit-mcp/training/pull_and_retrain.py:73-78`:
  ```python
  clean = [
      {"text": r["text"], "intent": r["intent"],
       "style": r.get("style") or "", **({"slot": r["slot"]} if r.get("slot") else {})}
      for r in rows …
  ]
  ```
  `source` энд **алга болно** — сургалтын багц гарал үүслээ мэдэхгүй.

**В. `GET /assistant/pending` — `revit.ts:1864-1892`**
Эрх: `if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);` (`:1865`).
Шүүлт: `WHERE l.curated = 0` (`:1875`). Эрэмбэ: `feedback_note` бүхий мөр (-1) → `corrected` (0) → `feedback = -1` (1) → `decided_by = 'fallback'` (2) → бусад (3), дараа нь `created_at DESC`.

**Г. Хэрэглэгчид (callers) — хэмжсэн**

```
grep -rln "assistant/pending|assistant/examples|assistant/export|assistant/logs|assistant/model" frontend/src revit-mcp
  → revit-mcp/addin/ApiClient.cs           (/assistant/model  — :144)
  → revit-mcp/addin/AssistantLog.cs        (/assistant/logs   — :291)
  → revit-mcp/training/pull_and_retrain.py (/assistant/export — :71)
```

→ **`/assistant/pending` ба `/assistant/examples`-д хэрэглэгч ОГТ БАЙХГҮЙ.** Frontend-д курацийн дэлгэц байхгүй (`grep -ril "assistant" frontend/src` нь зөвхөн `shared/config/modules.ts`-ыг өгнө). **Энэ бол 1B-6-ийн ажил.** Дүгнэлт: одоогийн байдлаар `assistant_examples` руу бичих бодит зам **бараг байхгүй** — тиймээс энэ сессийн backfill-ийн эрсдэл маш бага (§9.1-ээр батал).

### 2.3 Байгаа корпусын АНГИЛАЛ — таамаглаагүй, ХЭМЖСЭН

`revit-mcp/training/data/*.json` бүрийг Python-оор уншиж мөрийг тоолж, `_note` талбарыг уншсан (2026-08-27):

| Файл | Мөр | Мөрийн түлхүүрүүд | `_note`-оос гарах гарал үүсэл | Оноогдох `source_type` |
|---|---:|---|---|---|
| `seed.json` | **517** | `intent, style, text` | «Үр өгөгдөл — 9 санаа, 7 хэв маяг … Аудитаар 53 мөр ХАСАГДАЖ, 51 мөр НЭМЭГДСЭН» — машин үүсгэж, машин аудитласан | `AI_GENERATED` |
| `multilang.json` | **1 291** | `intent, lang, style, text` | «Үүсгэлт: **11 зэрэг агент → 2 аудитлагч**» | `AI_GENERATED` |
| `english.json` | **463** | `intent, lang, style, text` | «ХЭМЖСЭН сул цэг рүү чиглэсэн багц … ЭСРЭГ ХОСУУДААР бүтсэн» — зорилтот аугментац | `SYNTHETIC` (боловсруулалт нь AI, хэлбэр нь аугментац — §9.4) |
| `hard-negatives.json` | **46** | `intent, style, text` | «2026-08-25-нд **БОДИТ ХЭМЖИЛТЭЭР** нэмэв» — бодит 2 уналтаас гаралтай, гараар бичсэн эсэх нь **баримтжаагүй** | `UNKNOWN` (§9.5) |
| `bootstrap.json` | **215** | `intent, style, text` | «БООТСТРАП үр — гогцоог баталгаажуулах ЖИЖИГ багц» | `AI_GENERATED` |
| `report.json` | — | (мөр биш) | `train_intent.py`-ийн гаралт; `datasets()` үүнийг хасдаг (`pull_and_retrain.py:96`) | — |
| **НИЙТ** | **2 532** | | | |

Нэмэлт хэмжилт:
- Уникал `(text.lower(), intent)` = **2 479**.
- `train_intent.py:169-190` нь **эвхсэн** текстээр давхардал хасдаг → `data/report.json` дахь бодит сургалтын тоо **`examples: 2402`**, `accuracy: 0.9403`, `version: "2026-08-25.1"`.
- **Мөрийн схемд `source`, `author`, `verified_by`, ямар ч provenance талбар БАЙХГҮЙ.** Түлхүүрүүд нь зөвхөн `text / intent / style / (lang)`.

> ### 📌 ШУЛУУН ХАРИУ
>
> **Шипсэн 2 532 мөрийн корпус бүхэлдээ `AI_GENERATED`, `SYNTHETIC` эсвэл `UNKNOWN`.**
> **`HUMAN_VERIFIED` = 0 мөр. `RULE_VERIFIED` = 0 мөр. `HUMAN_CORRECTED` = 0 мөр.**
>
> **Үр дагавар:** анхны бодлогыг өнөөдөр хэрэглэвэл **сургалтад тэнцэх мөр ТЭГ** гарна.
> Энэ нь **бодлогын алдаа биш, ҮНЭН ЗУРАГ.** Систем «энэ өгөгдлийг хүн шалгасан» гэж
> хэзээ ч мэдэгдэж байгаагүй; таксономи нь тэр чимээгүй байдлыг **харагдуулж байна**.
>
> **Шилжилтийн зам:** байгаа корпусыг `AI_GENERATED` (ба `SYNTHETIC`) гэж шошголоод
> **аугментац болгон хадгална**, хүний цөм (1B-6-ийн курацийн UI-аар) бүтэх хүртэл.
> Ангилагч өнөөдрийнхөөрөө ажиллаж, чанар нь буурахгүй — зөвхөн **юу нь юу болох нь
> нэрлэгдэнэ**. Бодлогын хатуу gate нь 1B-4/1B-5-д (сургалтын манифест) хэрэгжинэ,
> энэ сесст **биш**.

### 2.4 SQLite-ийн `ALTER TABLE ADD COLUMN` дүрмүүд — өөрөө хэмжсэн

Локал `sqlite 3.49.1` дээр туршив:

| Туршилт | Үр дүн |
|---|---|
| `ADD COLUMN x TEXT NOT NULL DEFAULT 'verified' CHECK (x IN (…))` | **OK** |
| `ADD COLUMN y INTEGER REFERENCES users(id) ON DELETE SET NULL` (өгөгдмөл NULL) | **OK** |
| `ADD COLUMN z TEXT` (nullable timestamp) | **OK** |
| `ADD COLUMN w INTEGER NOT NULL DEFAULT 0 REFERENCES users(id)` (`PRAGMA foreign_keys=ON`) | локалд OK — **гэвч SQLite-ийн баримт бичиг үүнийг хориглодог. БҮҮ АШИГЛА.** |
| `ADD COLUMN t TEXT NOT NULL DEFAULT (datetime('now'))` | локалд OK — **баримт бичиг хориглодог. БҮҮ АШИГЛА.** |

**Гаргаж авсан дүрэм (энэ миграцид дагах):**
1. `CHECK` **зөвшөөрөгдөнө**.
2. `NOT NULL` нь **тогтмол** өгөгдмөлтэй бол зүгээр.
3. `REFERENCES` агуулсан багана **өгөгдмөл нь NULL байх ёстой** (тиймээс `reviewed_by`, `origin_log_id` хоёул nullable).
4. Огнооны багана — **тогтмол бус өгөгдмөл өгөхгүй**, зүгээр `TEXT` (nullable) байг; утгыг `UPDATE`/`INSERT`-д `datetime('now')`-оор бичнэ.

> ### ⚠️ РЕПОД ТАРХСАН БУРУУ МЭДЭЭЛЭЛ
>
> Гурван миграц «SQLite-д `ALTER TABLE … ADD COLUMN` дээр CHECK нэмэх боломжгүй» гэж
> **буруу** мэдэгддэг:
> - `backend/migrations/0168_quotes_status.sql:27-31`
> - `backend/migrations/0170_quotes_source.sql:36-39`
> - `backend/migrations/0181_quotes_lang.sql:11-15`
>
> Дээрх хэмжилтээр CHECK нь **зөвшөөрөгддөг** (SQLite-ийн ADD COLUMN-ий хориглосон
> жагсаалтад PRIMARY KEY, UNIQUE, `GENERATED … STORED`, тогтмол бус DEFAULT, FK-тэй
> NOT NULL байдаг — CHECK **байхгүй**).
>
> **ГЭХДЭЭ:** энэ бол репо-хэмжээний итгэл үнэмшил, D1-ийн SQLite build нь өөр байж
> болно. Тиймээс **энэ миграцийг продакшнд хэрэгжүүлэхээс ӨМНӨ хаяхад бэлэн алсын
> D1 дээр батал** (§7.2). Прецедент бий: `0136_worker_role.sql:15` нь `mgl-fk-probe`
> нэртэй түр D1 дээр хэмжсэн үр дүнг иш татдаг. Хэрэв D1 татгалзвал §3.1-ийн
> Fallback-B (CHECK-гүй + роутын валидац) руу шилж.

---

## 3. ХИЙХ АЖИЛ

### 3.1 Миграц — `backend/migrations/0203_assistant_trust_taxonomy.sql` (ШИНЭ)

**Дугаарыг эхлээд бататга:** `ls backend/migrations | tail -3`. Одоо `0200` хамгийн өндөр. 1B-1 нь `0201`, 1B-3 нь `0202`-ыг авахаар төлөвлөгдсөн (§5.1) — **чөлөөтэй хамгийн бага дугаарыг ав**, аль хэдийн авагдсан бол дараагийнхыг.

**Дараалал ХАТУУ:** ALTER бүгд эхэнд → UPDATE backfill → INDEX хамгийн сүүлд.

```sql
-- 0203 — ИТГЭЛИЙН ТАКСОНОМИ: эх сурвалж ба хянан үзэх нь ХОЁР ТЭНХЛЭГ.
--
-- ⚠️ ГОЛ ЗАРЧИМ: `source_type` («хаанаас ирсэн») ба `review_state` («хүн
-- баталсан уу») нь ТУСДАА тэнхлэг.  Нэг мөр AI_GENERATED БАС verified байж
-- БОЛНО.  Тэднийг нэг багана болгож нийлүүлэх нь энэ миграцийн БҮХ утгыг
-- устгана.  Сургалтад тэнцэх эсэх = ХОЁУЛАНГИЙНХ нь функц.
--
-- ⚠️ 0195:50 «Муу жишээг УСТГАХГҮЙ, унтраана» гэсэн зорилго нь ХЭРЭГЖЭЭГҮЙ
-- байсан: `is_active`-ыг 0 болгодог код, `note`-д бичдэг код репод байгаагүй.
-- Энэ миграц түүнийг бодит болгоно.
--
-- ⚠️ ЗАН ТӨЛӨВ БАЙТ БАЙТААР ХАДГАЛАГДАНА.  `GET /api/revit/assistant/export`
-- өнөөдөр `WHERE is_active = 1` шүүдэг.  Backfill нь `is_active = 1` бүх
-- мөрийг `review_state = 'verified'` болгоно; шинэ шүүлт
-- `review_state IN ('reviewed','verified')` нь ЯГ ИЖИЛ олонлогийг өгнө.
--
-- ⚠️ SQLite ADD COLUMN: CHECK зөвшөөрөгдөнө; NOT NULL нь ТОГТМОЛ өгөгдмөлтэй
-- байна; REFERENCES агуулсан багана өгөгдмөл NULL байх ЁСТОЙ.  Тиймээс
-- `reviewed_by` / `origin_log_id` nullable, `reviewed_at` нь энгийн TEXT.
--
-- ⚠️ ALTER-ууд ЭХЭНД: унавал юу ч үүсээгүй байхаар.

/* ---- 1. Эх сурвалжийн таксономи (8 төлөв) --------------------------- */
ALTER TABLE assistant_examples
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (source_type IN (
      'HUMAN','HUMAN_CORRECTED','HUMAN_VERIFIED','RULE_VERIFIED',
      'SYNTHETIC','AI_GENERATED','IMPORTED','UNKNOWN'));

/* ---- 2. Хянан үзэх мөчлөг (ТУСДАА тэнхлэг) -------------------------- */
-- ⚠️ Өгөгдмөл нь 'verified' — ЗОРИУД.  Өнөөдрийн бүх мөр экспортод ордог;
-- 'pending' болговол экспорт ХООСРОХ буюу зан төлөв ӨӨРЧЛӨГДӨНӨ.
ALTER TABLE assistant_examples
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'verified'
    CHECK (review_state IN ('pending','reviewed','verified','rejected'));

ALTER TABLE assistant_examples
  ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE assistant_examples
  ADD COLUMN reviewed_at TEXT;

/* ---- 3. Гарал үүслийн ХОЛБООС — аль бүртгэлээс дэвшсэн бэ ----------- */
-- ⚠️ ON DELETE SET NULL: бүртгэл цэвэрлэгдэхэд (0195-ийн 90 хоногийн
-- бодлого) жишээ ҮЛДЭХ ёстой, зөвхөн мөр хөтлөгч холбоос тасарна.
ALTER TABLE assistant_examples
  ADD COLUMN origin_log_id INTEGER REFERENCES assistant_logs(id) ON DELETE SET NULL;

/* ---- 4. BACKFILL — зан төлөвийг байт байтаар хадгална --------------- */
-- `is_active = 1` → 'verified'  (өнөөдөр экспортод ордог)
-- `is_active = 0` → 'rejected'  (өнөөдөр экспортод ОРДОГГҮЙ)
-- Одоогоор 0 болгодог бичигч байхгүй тул хоёрдугаар салаа онолын, гэвч
-- гараар D1 дээр засагдсан мөр байвал түүнийг ч зөв авна.
UPDATE assistant_examples
  SET review_state = CASE WHEN is_active = 1 THEN 'verified' ELSE 'rejected'
  END;

-- Хуучин 3 утгатай `source`-ыг 8 төлөвт БУУЛГАНА.
--   'seed'   → AI_GENERATED  (хэмжсэн: шипсэн 2532 мөрийн корпус машин зохиосон)
--   'manual' → HUMAN         (хүн гараар нэмсэн — 0195:46-ийн тодорхойлолт)
--   'usage'  → UNKNOWN       (⚠️ ЗОРИУД.  Дэвшүүлэлтийн зам нь «хүн залруулсан»
--                            ба «хүн зөвшөөрсөн»-ийг ЯЛГАДАГГҮЙ байсан тул
--                            HUMAN_CORRECTED / HUMAN_VERIFIED гэж НЭРЛЭХ
--                            баримт БАЙХГҮЙ.  Хүний шошгыг зохиох нь
--                            таксономийн бүх утгыг устгана.  §9.1 / §9.3-ыг үз.)
UPDATE assistant_examples
  SET source_type = CASE source
    WHEN 'usage'  THEN 'UNKNOWN'
    WHEN 'manual' THEN 'HUMAN'
    ELSE 'AI_GENERATED'
  END;

/* ---- 5. Сургалтын гол унших хэлбэрийн индекс ------------------------ */
-- «тэнцэх мөрүүд, санаагаар» — ХОЁУЛАНГ нь агуулсан composite.
CREATE INDEX IF NOT EXISTS idx_assistant_ex_trust
  ON assistant_examples(review_state, source_type, intent);
```

**Заавал шалгах зүйлс:**
- `END;` **том үсгээр, өөрийн мөрөнд** (дээрх хоёр `CASE` дээр). Прецедент: `0093_project_complexity_pct.sql:35`.
- Файлын аль ч мөрөнд `CREATE TRIGGER`, `CREATE VIEW`, `GENERATED ALWAYS`, `json_extract` **байхгүй**.
- `CREATE INDEX` нь `IF NOT EXISTS`-тэй.
- `users` эсвэл `projects`-ыг **хөндөхгүй** — эдгээр нь `assistant_examples` дээрх зөвхөн additive ALTER.

**Fallback-B (хэрэв §7.2-ын проб дээр D1 нь `CHECK`-ыг татгалзвал):** хоёр багананаас `CHECK (...)`-ыг хас, өгөгдмөлүүдийг хэвээр үлдээ, валидацыг `routes/revit.ts`-ийн `SOURCE_TYPES` / `REVIEW_STATES` тогтмолуудад бүрэн шилжүүл (`0168`/`0170`/`0181`-ийн загвар), ба **яагаад** гэдгийг миграцийн толгойд хэмжсэн алдааны текстийн хамт бич.

### 3.2 `GET /assistant/export` — хоёр тэнхлэгийг гаргах (`revit.ts:1974-1990`)

**Одоо:**
```ts
`SELECT text, intent, slot, style, source
   FROM assistant_examples
  WHERE is_active = 1
  ORDER BY intent, id`
```

**Болгох:**
```ts
revit.get('/assistant/export', requireAdmin(), async (c) => {
  // ⚠️ ХОЁР ТЭНХЛЭГ.  Энэ гарц нь ХЯНАН ҮЗЭХ тэнхлэгээр шүүдэг
  // (`reviewed` | `verified`), эх сурвалжийн бодлогоор ШҮҮДЭГГҮЙ —
  // `source_type`-ыг мөр тус бүр дээр БУЦААНА, шийдвэрийг сургалтын
  // манифест (1B-4) гаргана.  Энд бодлого шатаавал бодлого солиход
  // worker deploy шаардагдана.
  //
  // ⚠️ `WHERE review_state IN ('reviewed','verified')` нь 0203-ын
  // backfill-ийн дараа `is_active = 1`-тэй ЯГ ИЖИЛ олонлог өгнө.
  const { results } = await c.env.DB
    .prepare(
      `SELECT text, intent, slot, style, source, source_type, review_state,
              reviewed_by, reviewed_at, origin_log_id
         FROM assistant_examples
        WHERE review_state IN ('reviewed','verified')
        ORDER BY intent, id`,
    )
    .all<{ /* … */ }>();

  const rows = results ?? [];
  const byIntent: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const r of rows) {
    byIntent[r.intent] = (byIntent[r.intent] ?? 0) + 1;
    bySource[r.source_type] = (bySource[r.source_type] ?? 0) + 1;
  }
  return c.json({ count: rows.length, per_intent: byIntent, per_source_type: bySource, rows });
});
```

- `per_source_type` нь **шинэ** талбар — нэмэлт, хуучин хэрэглэгчийг эвдэхгүй (`pull_and_retrain.py:87` зөвхөн `per_intent`-ыг уншдаг).
- **`is_active`-ыг устгахгүй** — тэр багана хэвээр үлдэнэ, §3.3/§3.4 нь түүнийг `review_state`-тэй синхрон байлгана.

### 3.3 `POST /assistant/examples` — хоёр тэнхлэгийг бичих + 2 алдааг засах (`revit.ts:1900-1968`)

**(а) Эрт буцаалтыг зөөх — «татгалзал боломжгүй» алдааг засна.**
`revit.ts:1926` дээрх
```ts
if (rows.length === 0) return c.json({ added: 0 });
```
-г
```ts
// ⚠️ `log_ids`-ийг АГУУЛСАН, жишээгүй хүсэлт нь ХҮЧИНТЭЙ: «энэ бүртгэлүүдийг
// харлаа, юу ч дэвшүүлэхгүй».  Урьд нь энд эрт буцаадаг байсан тул
// `curated` тавигдахгүй, мөр `/assistant/pending`-д ҮҮРД эргэж гардаг байв.
const ids = Array.isArray(body.log_ids)
  ? (body.log_ids as unknown[]).map(Number).filter(Number.isInteger).slice(0, 500)
  : [];
if (rows.length === 0 && ids.length === 0) return c.json({ added: 0, curated: 0 });
```
болгож, `ids`-ийн тооцоог **дээш зөөнө** (`:1951-1953`-аас). `stmts` массивыг `ids` тооцооны дараа үүсгэнэ; жишээ INSERT-ийн гогцоо `rows.length === 0` үед зүгээр л ажиллахгүй.

**(б) `source_type` / `review_state` / provenance-ыг бичих.**

Клиентээс авах (`revit.ts:1917-1924`-ийн `.map` дотор):
```ts
const SOURCE_TYPES = [
  'HUMAN','HUMAN_CORRECTED','HUMAN_VERIFIED','RULE_VERIFIED',
  'SYNTHETIC','AI_GENERATED','IMPORTED','UNKNOWN',
] as const;

// ⚠️ ӨГӨГДМӨЛ НЬ 'UNKNOWN', 'HUMAN_*' БИШ.  Хүний баталгааг ХЭЗЭЭ Ч
// таамаглахгүй — эргэлзээтэй бол таксономи «мэдэхгүй» гэж хэлэх ёстой.
source_type: (SOURCE_TYPES as readonly string[]).includes(String(e.source_type))
  ? String(e.source_type) : 'UNKNOWN',
// ⚠️ Курацийн UI-аас ирсэн дэвшүүлэлт нь тодорхойлолтоороо ХҮН ХАРСАН
// мөр тул 'verified'.  Багц импорт хийх бол клиент 'pending' илгээнэ.
review_state: e.review_state === 'pending' || e.review_state === 'reviewed'
  ? String(e.review_state) : 'verified',
origin_log_id: Number.isInteger(Number(e.origin_log_id)) ? Number(e.origin_log_id) : null,
```

**(в) Bind тоог ДАХИН ТООЦОХ.** Одоо `revit.ts:1928-1930`:
```ts
// 7 bind/мөр → 14 мөр/statement.
const BINDS = 7;
const PER = Math.floor(100 / BINDS);
```
Шинэ INSERT-д bind 7 → 11 болно (`text, text_folded, intent, slot, style, source, created_by, source_type, review_state, reviewed_by, origin_log_id`). `reviewed_at`-ыг **bind БИШ**, SQL дотор `datetime('now')` литералаар бич.
```ts
// ⚠️ БАГАНА НЭМБЭЛ ЭНЭ ТООГ ЗАСАХ ЁСТОЙ.  D1-ийн нэг statement 100
// bind-аар хязгаарлагдана; 11 × 9 = 99 ≤ 100.
// `reviewed_at` нь bind БИШ — SQL дотор datetime('now').
const BINDS = 11;
const PER = Math.floor(100 / BINDS);   // = 9
```
`values` мөрийн загварт `?` нь **11**, түүнээс гадна `datetime('now')`:
```ts
const values = chunk
  .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)")
  .join(', ');
```
⚠️ **Баганын жагсаалт ба `?`-ийн дараалал таарч байгааг ГАРААР тоол** — `reviewed_at` нь `reviewed_by`-ийн ард, `origin_log_id`-ийн өмнө байрлана.

**(г) `ON CONFLICT` — татгалзсан мөрийг ЧИМЭЭГҮЙ АМИЛУУЛАХГҮЙ.**
```sql
INSERT INTO assistant_examples
  (text, text_folded, intent, slot, style, source, created_by,
   source_type, review_state, reviewed_by, reviewed_at, origin_log_id)
VALUES ${values}
ON CONFLICT (text, intent) DO UPDATE SET
  is_active     = 1,
  review_state  = excluded.review_state,
  source_type   = excluded.source_type,
  reviewed_by   = excluded.reviewed_by,
  reviewed_at   = datetime('now'),
  origin_log_id = COALESCE(excluded.origin_log_id, assistant_examples.origin_log_id),
  slot          = COALESCE(excluded.slot, assistant_examples.slot)
WHERE assistant_examples.review_state <> 'rejected'
```
- ⚠️ **`WHERE assistant_examples.review_state <> 'rejected'` нь заавал.** Үүнгүйгээр ижил текст дахин ирэхэд `is_active = 1` (одоогийн `:1945`) нь **татгалзсан жишээг чимээгүй амилуулна** — 0195:50-ын бүх зорилгыг устгана.
- Өнөөдөр `rejected` мөр **тэг** тул энэ нөхцөл одоогийн зан төлөвийг **өөрчлөхгүй**.

**(д) `curated` — дэвшүүлсэн бүртгэлийг л тэмдэглэх.** `UPDATE assistant_logs SET curated = 1 WHERE id IN (…)` хэвээр (`revit.ts:1959-1960`); гэвч §3.4-ийн татгалзлын зам нь **тусдаа** шалтгаан бичнэ, тиймээс «яагаад curated болов» гэдэг ялгагдана.

### 3.4 ШИНЭ роут — татгалзал бүртгэх

`revit.ts`-ийн §8 бүлэгт, `POST /assistant/examples`-ийн **дараа**, `GET /assistant/export`-ийн **өмнө** нэм.

```ts
/**
 * POST /api/revit/assistant/reject — ТАТГАЛЗАЛ бүртгэнэ (admin/senior).
 *
 * ⚠️ 0195:50 «Муу жишээг УСТГАХГҮЙ, унтраана — юу яагаад хасагдсаныг мэдэх
 * ёстой» гэсэн зорилгын ХЭРЭГЖҮҮЛЭЛТ.  Хоёр төрлийн татгалзал:
 *   example_ids — байгаа жишээг унтраана (review_state='rejected', is_active=0)
 *   log_ids     — түүхий бүртгэлийг «харлаа, дэвшүүлэхгүй» гэж хаана
 *
 * ⚠️ `is_active`-ыг `review_state`-тэй СИНХРОН байлгана.  Хуучин индекс
 * `idx_assistant_ex_intent(intent, is_active)` ба хуучин уншигч кодтой
 * зөрчилдөхөөс сэргийлнэ — хоёр тэнхлэг гэдэг нь ХОЁР БАГАНА ЗӨРӨХ гэсэн
 * үг БИШ.
 */
revit.post('/assistant/reject', async (c) => {
  const user = c.get('user');
  if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);

  const db = c.env.DB;
  const body = await c.req
    .json<{ example_ids?: unknown; log_ids?: unknown; note?: unknown }>()
    .catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const note = str(body.note, 500) || null;
  const exIds = Array.isArray(body.example_ids)
    ? (body.example_ids as unknown[]).map(Number).filter(Number.isInteger).slice(0, 500) : [];
  const logIds = Array.isArray(body.log_ids)
    ? (body.log_ids as unknown[]).map(Number).filter(Number.isInteger).slice(0, 500) : [];
  if (exIds.length === 0 && logIds.length === 0) {
    return c.json({ error: 'example_ids or log_ids required' }, 400);
  }

  const stmts: D1PreparedStatement[] = [];

  // ⚠️ IN(...)-ийн bind тоо: note + reviewed_by + 90 id = 92 ≤ 100.
  //    Файлын `IDS_PER_STATEMENT = 50` (revit.ts:70)-ээс ЯЛГААТАЙ — тэр нь
  //    өөр гарцынх.  Энд 2 нэмэлт bind байгааг тооцсон тусдаа тогтмол.
  const PER_IDS = 90;
  for (let i = 0; i < exIds.length; i += PER_IDS) {
    const chunk = exIds.slice(i, i + PER_IDS);
    stmts.push(
      db.prepare(
        `UPDATE assistant_examples
            SET review_state = 'rejected',
                is_active    = 0,
                note         = COALESCE(?, note),
                reviewed_by  = ?,
                reviewed_at  = datetime('now')
          WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(note, user.sub, ...chunk),
    );
  }
  for (let i = 0; i < logIds.length; i += PER_IDS) {
    const chunk = logIds.slice(i, i + PER_IDS);
    stmts.push(
      db.prepare(
        `UPDATE assistant_logs SET curated = 1
          WHERE id IN (${chunk.map(() => '?').join(',')})`,
      ).bind(...chunk),
    );
  }

  await db.batch(stmts);
  return c.json({ rejected_examples: exIds.length, closed_logs: logIds.length });
});
```

**Эрх:** `isManager` (admin + senior) — `POST /assistant/examples`-тэй **ижил** (`revit.ts:1902`), зориуд. Татгалзал нь дэвшүүлэхээс илүү эрх шаардахгүй. (`HUMAN_VERIFIED` онооход хэн эрхтэй вэ — §9.2.)

### 3.5 СОНГОЛТТОЙ — `revit-mcp/training/pull_and_retrain.py:73-78`

`source_type`-ыг сургалтын багц руу дамжуулна (ганц мөр):
```python
    clean = [
        {"text": r["text"], "intent": r["intent"],
         "style": r.get("style") or "",
         # ⚠️ Гарал үүслийг ХАДГАЛНА — 1B-4-ийн сургалтын манифест үүнийг уншина.
         "source_type": r.get("source_type") or "UNKNOWN",
         **({"slot": r["slot"]} if r.get("slot") else {})}
        for r in rows
        if (r.get("text") or "").strip() and (r.get("intent") or "").strip()
    ]
```
**Аюулгүй эсэх шалгагдсан:** `train_intent.py`-ийн `clean()` (мөр 169-190) нь зөвхөн `r.get("text")` ба `r.get("intent")`-ыг уншдаг; илүү түлхүүрийг үл тоомсорлоно. Тиймээс энэ нь сургалтыг өөрчлөхгүй.
**Хэрэв цаг хүрэхгүй бол алгас** — бодлогын хэрэглээ 1B-4-ийнх. Гэвч алгасвал §6-ийн жагсаалтад «`source_type` нь сургалтын багцад хүрэхгүй хэвээр» гэж **тэмдэглэ**.

### 3.6 ХИЙХГҮЙ ажлууд (энэ сесст ХОРИОТОЙ)

| ⛔ | Яагаад |
|---|---|
| Хуучин `source` баганыг **устгах**/CHECK-ыг өргөтгөх | `assistant_examples` rebuild шаардана. Хоёр багана зэрэг оршино; `source` нь түүхэн, `source_type` нь эрх мэдэлтэй. |
| `is_active`-ыг **устгах** | Индекс `idx_assistant_ex_intent(intent, is_active)` түүнээс хамаарна; §3.3/§3.4 нь синхрон байлгана. |
| `review_state`-ыг өгөгдмөл `'pending'` болгох | Экспортыг **хоосруулна** — ангилагч талбар дээр эвдэрнэ. |
| Курацийн UI бичих | 1B-6. |
| C# / add-in хөндөх | 1C-ийн нэг релиз. |
| Бодлогын шүүлтийг **export роутад шатаах** | Бодлого солих бүрд worker deploy шаардана; 1B-4-ийн манифест дээр байх ёстой. |
| `assistant_logs` дээр ямар нэг ALTER | 1B-3-ын нутаг. Мөргөлдөнө. |

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Юу | Юунаас хамаарч байна | Эвдвэл юу болох |
|---|---|---|
| **`GET /assistant/export`-ийн буцаах ОЛОНЛОГ** | `revit-mcp/training/pull_and_retrain.py:71-90` нь үүнийг татаж `data/production.json` бичдэг; дараа нь `train_intent.py` сургана. | Шүүлт хэт чанга болбол сургалтын багц чимээгүйгээр **багасаж**, дараагийн загварын нарийвчлал унана. Backfill-ийн `CASE` нь энэ олонлогийг **байт байтаар** хадгална — түүнийг өөрчлөхгүй. |
| **`is_active` багана ба `idx_assistant_ex_intent(intent, is_active)`** | `0195:51`, `0195:61-62`. | `is_active`-ыг `review_state`-тэй **зөрүүлэх** нь хоёр өөр «идэвхтэй» тодорхойлолт үүсгэнэ. §3.3(г) ба §3.4 хоёуланг нь зэрэг бичдэг байх ЁСТОЙ. |
| **`idx_assistant_ex_uniq(text, intent)` ӨВӨРМӨЦ индекс** | `0195:59-60`; `ON CONFLICT (text, intent)` түүнээс хамаарна. | Хөндвөл бүх upsert 500 өгнө. |
| **`assistant_logs.curated` нь `/assistant/pending`-ийн ЦОРЫН ГАНЦ шүүлт** | `revit.ts:1875` `WHERE l.curated = 0`. | Татгалзсан мөрийг `curated = 1` болгохгүй бол дараалал **хэзээ ч цэвэрлэгдэхгүй**; 1B-6-ийн UI ашиглах боломжгүй болно. |
| **`POST /assistant/logs`-ийн 13-bind чанк (`revit.ts:1706-1748`)** | D1-ийн 100 bind хязгаар. | Энэ сесс `assistant_logs`-д багана **нэмэхгүй** тул хөндөгдөхгүй — гэвч санамсаргүй хөндвөл add-in-ий бүртгэл илгээх зам 500 өгнө. Тэр зам нь **алсаас засаж болдоггүй** add-in-аас дуудагддаг. |
| **`revit.use('*', requireRole(...REVIT_ROLES))` (`revit.ts:79`)** | `/api/revit/*` бүхэлдээ. `client` ба `worker` энд хүрэхгүй (`lib/workerScope.ts` нь хаалттай-анхдагч зөвшөөрлийн жагсаалт). | Роутерийн gate-ыг хөндвөл бүх Revit урсгал (handshake, submissions) 403 өгнө. **ХҮРЭХГҮЙ.** |
| **`authMiddleware` / `verifyToken`** | Add-in бүх REST дуудлагаа `purpose === 'mcp'` токеноор хийдэг, refresh урсгал БАЙХГҮЙ. | ~20 компьютер, `Install.bat`, Revit хаалттай. **Алсаас сэргээх БОЛОМЖГҮЙ.** Энэ сесс эрхийн давхаргад огт хүрэхгүй. |
| **`revit-mcp/training/data/*.json` файлууд** | `pull_and_retrain.py:96` `datasets()` нь `report.json`-оос бусад БҮХ `*.json`-ыг сургалтад оруулна. | Тэдгээр файлын **агуулгыг энэ сесст өөрчлөхгүй.** Шошго нь DB талд, файлын мөр дээр биш. |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### 5.1 Урьдчилсан нөхцөл

| Нөхцөл | Байдал |
|---|---|
| **1A бүхэлдээ дууссан байх** | Аюулгүй байдлын нүх нь AI-ийн замын зураг биш. |
| **1B-6 (курацийн UI)** | *Концепцын* хамаарал. Энэ схем UI-гүйгээр суух ба ямар ч зан төлөв өөрчлөхгүй; гэвч **бичигч нь 1B-6** тул түүнгүйгээр таксономи бөглөгдөхгүй. **UI-г хүлээхгүй** — схем нь UI-аас өмнө байх ёстой. |
| **1B-1 / 1B-3 — миграцийн ДУГААР** | Гурвуулаа шинэ миграц авна. Төлөвлөсөн: **1B-1 → 0201, 1B-3 → 0202, 1B-7 → 0203.** Эхлэхийн өмнө `ls backend/migrations \| tail -3` ажиллуулж, чөлөөтэй хамгийн бага дугаарыг ав. Дугаар мөргөлдвөл репод аль хэдийн **зургаан давхардсан дугаар** байдаг (0002, 0060, 0080, 0110, 0120, 0121) — түүн дээр долоо дахийг нэмэхгүй. |
| **1B-3-тай ФАЙЛЫН мөргөлдөөн** | 1B-3 нь `assistant_logs`-ыг өөрчилнө, энэ сесс `assistant_examples`-ыг. **Хоёулаа `routes/revit.ts`-ийн §8 бүлгийг хөндөнө.** Хэрэв 1B-3 аль хэдийн газардсан бол `git pull` хийж §2-ын мөрийн дугааруудыг **дахин шалга**. |

### 5.2 Deploy-ийн дараалал (заавал)

> **Дүрэм: шинэ багана нь түүнийг уншдаг кодоос ЧАНД ЭРТ deploy-д гарна.**

```
① backend/ дотроос:
     npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
   → 0203 газардана.  Энэ мөчид ХУУЧИН worker ажиллаж байна: тэр шинэ багануудыг
     үл тоомсорлоно, экспорт нь `WHERE is_active = 1` хэвээр — зан төлөв ИЖИЛ.

② tsc --noEmit цэвэр эсэхийг батал (алдаа зөвхөн ХӨНДӨӨГҮЙ файлууд дээр эсэхийг шалга)

③ backend/ дотроос:
     npx wrangler deploy --config wrangler.toml
   → шинэ export шүүлт + /assistant/reject роут амьдарна.

  ⚠️ ①-ийг ③-ийн ӨМНӨ.  Урвуулбал шинэ код `no such column: review_state` гээд
     экспорт болон бүх дэвшүүлэлт 500 өгнө.
  ⚠️ `--config wrangler.toml` нь ЗААВАЛ — репогийн үндэс дэх `wrangler.jsonc`
     өөр воркер зарладаг ба wrangler-ийн тохиргоо олох механизм түүнийг сонгож болно.
  ⚠️ `wrangler deploy` нь typecheck ХИЙДЭГГҮЙ.
```

### 5.3 Энэ сессийн дараа

- **1B-4 (training integrity)** — сургалтын манифест дээр бодлогын gate-ыг хэрэгжүүлнэ: `core = HUMAN_VERIFIED ∪ RULE_VERIFIED ∪ HUMAN_CORRECTED`, `SYNTHETIC` сонголттой, `AI_GENERATED` зөвхөн eval/negative/augmentation.
- **1B-5 (golden datasets)** — хөлдөөсөн holdout нь `review_state = 'verified'` мөрөөс л бүрдэнэ.
- **1C** — C# өөрчлөлт байхгүй. Add-in-ий релиз энэ ажлаас **хамаарахгүй**.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

Хүн шалгаж болох, объектив жагсаалт:

- [ ] `backend/migrations/0203_assistant_trust_taxonomy.sql` (эсвэл авсан дугаар) үүссэн; **өөр ямар ч миграц засагдаагүй** (`git status` нь зөвхөн энэ 1 шинэ файл + `routes/revit.ts` (+ сонголттойгоор `pull_and_retrain.py`)-ыг харуулна).
- [ ] Миграц дотор `CREATE TRIGGER`, `CREATE VIEW`, `GENERATED ALWAYS`, `json_extract` **байхгүй**; `CREATE INDEX` нь `IF NOT EXISTS`-тэй; `END;` том үсгээр өөрийн мөрөнд.
- [ ] Миграцийн БҮХ `ALTER` нь БҮХ `UPDATE`/`CREATE INDEX`-ээс **өмнө**.
- [ ] Алсын D1 дээр хэрэгжсэний дараа `PRAGMA table_info(assistant_examples)` нь **5 шинэ багана** харуулна: `source_type`, `review_state`, `reviewed_by`, `reviewed_at`, `origin_log_id`.
- [ ] `SELECT COUNT(*) FROM assistant_examples WHERE review_state NOT IN ('pending','reviewed','verified','rejected')` → **0**.
- [ ] `SELECT COUNT(*) FROM assistant_examples WHERE (is_active = 1) <> (review_state IN ('reviewed','verified'))` → **0** (хоёр тэнхлэг миграцийн дараа зөрөөгүй).
- [ ] `SELECT COUNT(*) FROM assistant_examples WHERE source_type IN ('HUMAN_VERIFIED','RULE_VERIFIED','HUMAN_CORRECTED')` → **0** (backfill нь хүний баталгааг **зохиогоогүй**).
- [ ] `GET /api/revit/assistant/export`-ийн `count` нь **deploy-ийн өмнөх утгатай ИЖИЛ** (тоог өмнө нь §7.1-ээр тэмдэглэ).
- [ ] Экспортын мөр бүр `source_type` талбартай; хариу `per_source_type` тоолуур агуулна.
- [ ] `POST /api/revit/assistant/reject` нь `{ log_ids: [n] }`-д **200** буцааж, дараа нь `GET /assistant/pending` тэр `id`-г **харуулахаа болино**.
- [ ] `POST /api/revit/assistant/reject` нь `{ example_ids: [n], note: "…" }`-д **200** буцааж, тэр мөр `review_state='rejected'`, `is_active=0`, `note` бөглөгдсөн, `reviewed_by`/`reviewed_at` бөглөгдсөн болно; экспортын `count` **1-ээр буурна**.
- [ ] Татгалзсан жишээтэй **яг ижил `(text, intent)`**-ыг `POST /assistant/examples`-аар дахин илгээхэд тэр мөр **амилахгүй** (`review_state` нь `'rejected'` хэвээр, `is_active` нь 0 хэвээр).
- [ ] `POST /assistant/reject`-ыг `engineer` эрхээр дуудахад **403 «Хандах эрхгүй»**.
- [ ] `POST /assistant/examples`-ын bind тоо гараар тоологдсон: `?`-ийн тоо = баганын жагсаалтын урт − 1 (`datetime('now')` нь bind биш), `BINDS × PER ≤ 100`.
- [ ] `cd backend && npx tsc --noEmit` — алдаа зөвхөн **энэ сессээр хөндөөгүй** файлууд дээр (байвал эзэнд мэдэгд, араас нь хөөцөлдөхгүй).
- [ ] `cd backend && npm test` — deploy-ийн өмнөх baseline-аас **дордоогүй**.
- [ ] Add-in-ий хоёр амьд зам ажиллаж байгаа: `GET /api/revit/assistant/model` (200 эсвэл `no_active_model` 404) ба `POST /api/revit/assistant/logs` (`{accepted: n}`).
- [ ] Frontend файл **нэг ч** засагдаагүй.

---

## 7. ШАЛГАХ КОМАНД

### 7.1 Эхлэхийн өмнө

```bash
# Дугаар авах
ls backend/migrations | tail -3

# Өөр агентын ажил ажлын модонд байгаа эсэх
git status --porcelain

# Одоогийн мөрийн дугаарууд зөрсөн эсэх (1B-3 газардсан бол зөрнө)
grep -n "assistant_examples\|is_active\|curated\|const BINDS" backend/src/routes/revit.ts

# Экспортын ӨМНӨХ тоог тэмдэглэ (deploy-ийн дараа тааруулах эталон)
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT COUNT(*) AS active FROM assistant_examples WHERE is_active = 1"
```

### 7.2 CHECK-ийг АЛСЫН D1 дээр батлах (продакшнд хүрэхээс өмнө)

> Репод гурван миграц «ADD COLUMN дээр CHECK боломжгүй» гэж **буруу** мэдэгддэг (§2.4).
> Локал sqlite нь зөвшөөрдөг. D1 бол өөр build — **хаяхад бэлэн** D1 дээр батал.
> Прецедент: `0136_worker_role.sql:15` (`mgl-fk-probe`).

```bash
npx wrangler d1 create mgl-trust-probe
# → буцаасан database_id-г ашиглан түр [[d1_databases]] блок нэмнэ ЭСВЭЛ
#   тухайн нэрээр нь шууд ажиллуул:

npx wrangler d1 execute mgl-trust-probe --remote --command \
  "CREATE TABLE t(id INTEGER PRIMARY KEY, a TEXT);
   ALTER TABLE t ADD COLUMN review_state TEXT NOT NULL DEFAULT 'verified'
     CHECK (review_state IN ('pending','reviewed','verified','rejected'));"
# → OK бол §3.1-ийг тэр хэвээр ашигла.
# → error бол §3.1-ийн Fallback-B (CHECK-гүй + роутын валидац) руу шилж.

npx wrangler d1 delete mgl-trust-probe
```

### 7.3 Локал шалгалт

```bash
cd backend
npm run db:migrate:all:local     # ⚠️ 0021-0025 нь 1-байтын хоосон файл тул
                                 # ЦЭВЭР сан 0023 дээр унана — энэ нь ХУУЧИН,
                                 # мэдэгдэж буй асуудал, ТАНЫХ БИШ.
                                 # Бүтэн локал сан хэрэгтэй бол:
npm run db:bootstrap:local

npx tsc --noEmit
npm test
npm run dev                      # :3000
```

Дараа нь (өөр терминал; `DEV_AUTH_BYPASS=1` + loopback, эсвэл A.Anand/admin123-ийн токен):

```bash
# Экспорт — source_type талбар байгаа эсэх
curl -s -H "Authorization: Bearer $TOK" \
  http://127.0.0.1:3000/api/revit/assistant/export | head -c 600

# Татгалзал — зөвхөн log_ids (хуучин кодод БОЛОМЖГҮЙ байсан)
curl -s -X POST -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"log_ids":[1]}' http://127.0.0.1:3000/api/revit/assistant/reject

# Дараалалаас гарсан эсэх
curl -s -H "Authorization: Bearer $TOK" \
  "http://127.0.0.1:3000/api/revit/assistant/pending?limit=200" | grep -c '"id":1' || echo "гарсан"
```

### 7.4 Deploy

```bash
cd backend
npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
npx tsc --noEmit
npx wrangler deploy --config wrangler.toml
```

### 7.5 Deploy-ийн дараа

```bash
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command \
  "SELECT review_state, source_type, COUNT(*) AS n
     FROM assistant_examples GROUP BY 1, 2 ORDER BY n DESC"

npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command \
  "SELECT COUNT(*) AS mismatch FROM assistant_examples
    WHERE (is_active = 1) <> (review_state IN ('reviewed','verified'))"
# → 0 байх ЁСТОЙ

npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command \
  "PRAGMA table_info(assistant_examples)"
```

### 7.6 Корпусын тоог дахин хэмжих (§2.3-ыг батлах)

```bash
cd revit-mcp/training/data && PYTHONIOENCODING=utf-8 python -c "
import json,glob
tot=0
for p in sorted(glob.glob('*.json')):
    d=json.load(open(p,encoding='utf-8'))
    r=d.get('rows')
    if not isinstance(r,list): print(p,'— мөргүй'); continue
    tot+=len(r); print(p,len(r), sorted(r[0].keys()))
print('НИЙТ', tot)"
```

---

## 8. ROLLBACK

### 8.1 Код (worker) — шууд, эрсдэлгүй

```bash
cd backend
git checkout <өмнөх-commit> -- src/routes/revit.ts   # ⚠️ ЗӨВХӨН энэ файл
npx tsc --noEmit
npx wrangler deploy --config wrangler.toml
```
Шинэ багана DB-д үлдэнэ; хуучин код тэднийг үл тоомсорлож `WHERE is_active = 1` руу буцна. Backfill нь `is_active`-ыг **өөрчлөөгүй** тул экспортын олонлог **ижил хэвээр**. Энэ бол практикт хангалттай rollback.

### 8.2 Схем — **ШИНЭ МИГРАЦИЙН ДУГААР ЗААВАЛ ШААРДАГДАНА**

`0203`-ыг **устгах ч, засах ч БОЛОХГҮЙ** (append-only; хэрэгжсэн файлыг засах нь продакшн дээр чимээгүй no-op).

Хэрэв багануудыг үнэхээр буцаах бол `0204_revert_trust_taxonomy.sql`:

```sql
-- ⚠️ ДАРААЛАЛ ЧУХАЛ: индекс баганаас хамаарна.  Индексийг ЭХЛЭЭД устгана.
-- Хэмжсэн (sqlite 3.49.1): индекстэй байхад DROP COLUMN нь
-- «error in index idx_assistant_ex_trust after drop column: no such column»
-- гэж УНАНА.  Багана дээрх өөрийнх нь CHECK нь DROP COLUMN-ыг ХОРИГЛОХГҮЙ.
DROP INDEX IF EXISTS idx_assistant_ex_trust;
ALTER TABLE assistant_examples DROP COLUMN origin_log_id;
ALTER TABLE assistant_examples DROP COLUMN reviewed_at;
ALTER TABLE assistant_examples DROP COLUMN reviewed_by;
ALTER TABLE assistant_examples DROP COLUMN review_state;
ALTER TABLE assistant_examples DROP COLUMN source_type;
```

`DROP COLUMN`-ий репо дахь прецедент: `0017_drop_subtasks.sql:87`, `0045_project_complexity.sql:31`, `0062_drop_horoolol_template.sql:16`, `0176_milestone_assignees.sql:51`.

**⚠️ Хэрэв 8.2-ыг сонговол `POST /assistant/reject`-ээр бичигдсэн бүх татгалзлын шалтгаан УСТАНА.** Урьдаар хуулбарла:
```bash
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command \
  "SELECT id, text, intent, source, source_type, review_state, reviewed_by, reviewed_at, note
     FROM assistant_examples WHERE review_state = 'rejected'"
```

### 8.3 Хагас-миграц (миграц дунд нь унасан)

`d1 migrations apply` файл бүрийг transaction-д ороодог тул онолын хувьд бүхэлдээ буцна. **Гэвч батал:**
```bash
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command \
  "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 3"
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command \
  "PRAGMA table_info(assistant_examples)"
```
Хэрэв зарим багана орж, зарим нь ороогүй байвал — **`0203`-ыг битгий зас.** `0204`-т дутуу `ALTER TABLE … ADD COLUMN`-ыг нөх, `0203`-ын мөрийг `d1_migrations`-д гараар нэм.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

> Эдгээрийг **репогоос шийдэх БОЛОМЖГҮЙ**. Кодыг бичихээс өмнө хариулт ав.

### 9.1 Продакшнд `assistant_examples` мөр байгаа юу, `source` тархалт нь ямар вэ? — **D1 асуулга шаардлагатай**

```bash
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command \
  "SELECT source, is_active, COUNT(*) AS n FROM assistant_examples GROUP BY 1, 2"
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml --command \
  "SELECT (SELECT COUNT(*) FROM assistant_logs) AS logs,
          (SELECT COUNT(*) FROM assistant_examples) AS examples,
          (SELECT COUNT(*) FROM assistant_examples WHERE source='usage') AS usage_rows"
```

**Яагаад чухал:** `/assistant/examples`-д **хэрэглэгч байхгүй** (§2.2Г) — курацийн UI хараахан байхгүй. Тиймээс `usage_rows = 0` байх магадлал өндөр, тэгвэл §3.1-ийн `'usage' → UNKNOWN` сонголт **утгагүй** болж, маргаан дуусна. Хэрэв `usage_rows > 0` бол §9.3-ыг эзэнтэй шийд.

### 9.2 `HUMAN_VERIFIED`-ыг хэн оноож болох вэ? — **эзний шийдвэр**

Одоо: `POST /assistant/examples` нь `isManager` (admin + senior, `revit.ts:1902`), `GET /assistant/export` нь `requireAdmin()` (`revit.ts:1974`).

| Хувилбар | Үр дагавар |
|---|---|
| **A.** `isManager` (одоогийнх) — senior ч `HUMAN_VERIFIED` онооно | Хамгийн энгийн, нэмэлт код байхгүй. **⚠️ `requireManager` нь MGL-д багийн гишүүнчлэлийг ШАЛГАДАГГҮЙ** — аль ч senior аль ч мөрийг баталгаажуулж чадна. |
| **B.** `HUMAN_VERIFIED`/`RULE_VERIFIED` зөвхөн `admin`; senior нь `HUMAN_CORRECTED` хүртэл | Роутад нэмэлт шалгалт. Илүү нягт, гэвч нэг хүн (admin) шээлтүүр болно. |
| **C.** Senior оноож болно, гэвч тэр мөр `review_state='reviewed'` (verified БИШ) → admin батална | Хоёр шатлалт. Хамгийн зөв, гэвч 1B-6-ийн UI-д хоёр товч хэрэгтэй. |

**Хэрэв хариулт ирэхгүй бол: A-г ав** (одоогийн зан төлөвтэй ижил) ба сонголтыг миграцийн толгойд бич.

### 9.3 Хуучин `'usage'` мөрүүдийг ямар төлөвт буулгах вэ? — **эзний шийдвэр (§9.1-ээс хамаарна)**

- `UNKNOWN` (санал болгож буй) — үнэнч, гэвч тэр мөрүүд цөмд орохгүй.
- `HUMAN_CORRECTED` — өгөөмөр, гэвч бид тэдгээр бүртгэл `corrected` талбартай байсан эсэхийг **мэдэхгүй**.
- `HUMAN_VERIFIED` — **бүү сонго**: хүн зөвшөөрсөн гэдгийг баталсан баримт байхгүй.

*(Онолын хувьд `origin_log_id`-г сэргээж `assistant_logs.corrected IS NOT NULL` эсэхээр `HUMAN_CORRECTED` vs `HUMAN_VERIFIED` гэж ялгах боломж бий — гэвч дэвшүүлэлт нь `origin_log_id` бичдэггүй байсан тул холбоос **байхгүй**. Текстээр тааруулах нь баримт биш, таамаг — бүү хий.)*

### 9.4 `SYNTHETIC` анхнаасаа цөмд орох уу? — **эзний шийдвэр**

Тодорхойлолт «SYNTHETIC сонголттой» гэсэн. `english.json` (463 мөр) нь **хэмжсэн сул цэг рүү чиглэсэн** аугментац бөгөөд түүнийг хасах нь англи хэлний нарийвчлалыг **буулгах магадлалтай** (`_note` нь 87.3% → сайжруулах зорилготой гэдгийг бичсэн). Асуулт: анхны бодлогод `SYNTHETIC` **асаалттай** эхлэх үү? Мөн `english.json`-ыг `SYNTHETIC` гэж үзэх үү, эсвэл `AI_GENERATED` гэж үзэх үү (боловсруулагч нь агент байсан).

### 9.5 `hard-negatives.json`-ы 46 мөрийн жинхэнэ гарал үүсэл? — **эзэн эсвэл `git log`**

`_note` нь «2026-08-25-нд БОДИТ ХЭМЖИЛТЭЭР нэмэв» гэдэг — **уналт нь бодит хэмжилт**, гэвч **мөрүүдийг хүн бичсэн үү, агент бичсэн үү** гэдэг баримтжаагүй. Хүн бичсэн бол `HUMAN` (энэ нь корпус дахь **цорын ганц** хүний мөр болно); эс бөгөөс `AI_GENERATED`. Одоогийн санал: `UNKNOWN`.

### 9.6 `HUMAN` (0-оос хүн бичсэн) нь цөмд орох уу? — **эзний шийдвэр**

Тодорхойлолтын бодлого 3 төлөвийг л нэрлэсэн (`HUMAN_VERIFIED`, `RULE_VERIFIED`, `HUMAN_CORRECTED`) — `HUMAN` тэнд **байхгүй**. Хүн 0-оос бичсэн жишээ нь баталгаажаагүй хүний бичвэр (алдаатай байж болно) тул хасагдсан байх нь логиктой, гэвч энэ нь **зориуд уу, орхигдсон уу** гэдгийг батал. (§3.1-ийн backfill нь `'manual'` → `HUMAN` гэж буулгадаг тул энэ хариулт тэр мөрүүдийн хувь заяаг шийднэ.)

### 9.7 `assistant_logs`-ийн зөвшөөрөл ба хадгалах хугацаа — **хөдөлмөрийн харилцааны шийдвэр**

`0195:22-26` нь «шошголж шилжсэн мөрийг 90 хоногийн дараа цэвэрлэж болно (одоохондоо автомат цэвэрлэгээ БАЙХГҮЙ — гараар)» гэсэн. Энэ сессийн `origin_log_id` нь `ON DELETE SET NULL` тул цэвэрлэгээ жишээг устгахгүй. Гэвч **инженерийн бичсэн текстийг хадгалах бодлого** нь инженерийн шийдвэр биш — эзэн/HR батлах ёстой.

### 9.8 Тоон зөрүү (мэдээллийн зорилгоор, блоклохгүй)

`users` / `projects`-ийн каскад хүүхдийн тоо **гурван газар гурван өөр байна**:

| Эх сурвалж | `users` | `projects` |
|---|---:|---:|
| `docs/bim-ai/README.md` (хатуу дүрэм №2) | 27 | 38 |
| Репогийн үндсэн `CLAUDE.md` | 19 | 33 |
| Энэ сессийн хэмжилт (`grep -c "REFERENCES users(id) ON DELETE CASCADE" backend/migrations`) | 33 | 41 |

grep нь **миграцийн текстийг** тоолдог (дараа нь устгагдсан/rebuild хийгдсэн хүснэгтүүд орсон) тул дээд хязгаар. Жинхэнэ тоог мэдэх ганц зам нь продакшн дээр бүх хүснэгт дээр `PRAGMA foreign_key_list` ажиллуулах. **Энэ ажилд ач холбогдолгүй** (rebuild хийхгүй), гэвч гурван тоог хэн ч эвлэрүүлээгүй нь баримт. **Хатуу дүрэм ижил хэвээр: `users` / `projects`-ыг `migrations apply`-аар ХЭЗЭЭ Ч rebuild хийхгүй.**
