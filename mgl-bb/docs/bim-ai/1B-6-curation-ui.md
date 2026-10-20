# 1B-6-curation-ui — Курацийн UI — хүний баталгаажуулах хаалгыг амьдруулах

> **Track:** 1B ДАТА БҮРЭН БҮТЭН БАЙДАЛ (item 6) · **Хамаарал:** 1A дуусаагүй ч энэ ажил AI-гүйгээр аюулгүй — ганц шаардлага нь `assistant_logs` / `assistant_examples` (migration `0195_assistant_learning.sql`, `0200_assistant_feedback_note.sql`) продакшнд аль хэдийн байгаа явдал · **Блоклож буй:** Track 1B-ийн бүх цаашдын цуглуулах гарц (шинэ capture surface), dataset/model хувилбарлалт, golden eval, `pull_and_retrain.py`-ийн `production.json` зам · **Хөндөх файлууд:** `backend/migrations/0201_*.sql` (ШИНЭ), `backend/src/routes/revit.ts`, `frontend/src/features/revit-assistant/**` (ШИНЭ), `frontend/src/app/routes.tsx`, `frontend/src/shared/components/Layout.tsx`, `frontend/src/shared/lib/search/sections.ts`, `frontend/src/shared/i18n/mn.json`, `frontend/src/shared/i18n/en.json` · **Deploy тоо:** 3 (1. D1 migration → 2. worker → 3. Pages)

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Энэ репод хэд хэдэн хөгжүүлэгч ЗЭРЭГ ажилладаг.** Working tree-д өөр хүний дуусаагүй, магадгүй **компайл болохгүй** өөрчлөлт байж болно.

| Дүрэм | Тайлбар |
|---|---|
| Зөвхөн хамрах хүрээндээ | Дээрх «Хөндөх файлууд» жагсаалтаас гадна ямар ч файл үүсгэх/засах/устгах ЁСГҮЙ. |
| Өөр хүний ажлыг БҮҮ хөнд | `git restore`, `git checkout --`, `git stash`, өөрийн биш файлыг `git add` — БҮГД ХОРИОТОЙ. |
| Унасан build автоматаар чинийх БИШ | `npm run build` / `tsc -b` бүх апп-ыг компайлдана. Алдаа гарвал эхлээд алдаанууд нь **зөвхөн чиний хөндөөгүй файлууд дээр** байгаа эсэхийг батал. Тийм бол засах гэж БҮҮ оролд — хэрэглэгчид мэдэгд. |
| Migration дугаар | Дараагийн чөлөөт дугаар нь **0201**. Нөөцөлсөн блок өгсөн бол ТҮҮН ДОТРОО бай. Хэрэглэсэн файлыг ХЭЗЭЭ Ч бүү засварла — продакшнд чимээгүй no-op болно. |
| Deploy | **ЗӨВШӨӨРНӨ**, гэхдээ §5-ийн дарааллаар ба зөвхөн эзэн зөвшөөрсний дараа. Deploy бүрийн өмнө `tsc --noEmit` өөрөө ажиллуул — `wrangler deploy` typecheck ХИЙХГҮЙ. |
| ХӨНДӨХГҮЙ | `middleware/auth.ts` (`verifyToken`, `authMiddleware`), `lib/workerScope.ts`, `revit-mcp/addin/**` (C#), `revit-mcp/training/data/**`, `assistant_models` хүснэгт ба `/assistant/model`, `/assistant/models` гарцууд. |
| C# add-in | Энэ ажил **add-in-д огт хүрэхгүй**. Add-in дээр өөрчлөлт хийх шаардлага гарвал — ЗОГС, эзэнд мэдэгд: add-in-ийн бүх өөрчлөлт НЭГ релизэд багцлагддаг, ~20 PC дээр `Install.bat`-аар гараар суулгадаг, албадан шинэчлэх механизм БАЙХГҮЙ. |

**⚠️ ХАМГИЙН ЧУХАЛ ХОРИГ (программ даяар):** `verifyToken` / `authMiddleware`-ийг `purpose === 'mcp'` токеныг `/api/*`-д татгалзахаар ЧАНГАЛЖ БОЛОХГҮЙ. Add-in бүх REST дуудлагаа тэр токеноор хийдэг бөгөөд refresh flow БАЙХГҮЙ. Энэ бол алсаас сэргээх БОЛОМЖГҮЙ цорын ганц өөрчлөлт: ~20 PC, `Install.bat`, Revit хаалттай байх шаардлагатай.

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сессид хангалттай хэмжээгээр)

- `backend/` — Cloudflare Worker. `src/index.ts`-ийн default export нь **`@cloudflare/workers-oauth-provider`**, Hono биш; Hono `app` нь түүний `defaultHandler`. Хадгалалт: **D1** (SQLite), **R2** (`MEDIA_BUCKET` — нийтэд НЭЭЛТТЭЙ, `MEETING_BUCKET` — хаалттай), **KV** (`OAUTH_KV`), нэг **Durable Object** (`MglMcpAgent`).
- `frontend/` — Vite + React 19 SPA, Cloudflare Pages дээр, төслийн нэр **`mgl-design-system`** (`--project-name mgl-design-system`-ийг ҮРГЭЛЖ ил бич).
- `revit-mcp/addin/` — Revit 2024–2027 add-in, C#/WPF, in-process, ~16k мөр / 47 файл, **тест ТЭГ**, автомат шинэчлэлт БАЙХГҮЙ.
- `revit-mcp/training/` — Python-ий санаа таних ангилагчийн сургалтын шугам (git-д хадгалагдсан).
- `revit-mcp/server/`, `revit-mcp/agent/` — Python MCP гүүр ба тусдаа локал агент.
- ~49 идэвхтэй мэдлэгийн ажилтан. Продакшн D1 = 45 MB / 114 хүснэгт; хамгийн том хүснэгт `progress_entries` 8,062 мөр.
- Дүрүүд: `admin | engineer | architect | senior | client | worker`. `role` нь **JWT-ээс** уншигдана, DB-ээс БИШ — DB дээр дүр солиход тухайн хүн дахин нэвтэрч байж хүчин төгөлдөр болно (session 24 ц).

### D1 / migration-ийн хатуу хязгаарлалт

| Хязгаар | Утга |
|---|---|
| Нэг statement-д bind | **дээд тал нь 100**. Тохируулсан жишээ: `routes/qto.ts` 21 bind × 4 мөр; `routes/revit.ts:1706-1707` `BINDS = 13` → `PER = 7`. |
| Migration | **APPEND-ONLY.** Одоо **190 файл**, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. Дундуур унавал DB хагас шилжсэн үлдэнэ; засах ЦОРЫН ГАНЦ хууль ёсны арга нь **ШИНЭ дугаар**. |
| DDL | `CREATE TABLE` / `CREATE INDEX` бүр **`IF NOT EXISTS`**-тэй. |
| Дараалал | БАЙГАА хүснэгт дээрх `ALTER`-ыг блокийн **ХАМГИЙН ЭХЭНД** тавь — унавал хоосон хүснэгт үүсэхээс өмнө таслана. |
| FK | D1 нь ажиллах үед зарласан FK-г **шалгадаггүй**, ГЭХДЭЭ `wrangler d1 migrations apply` файл бүрийг транзакцид ороодог бөгөөд тэнд `ON DELETE CASCADE` **АЖИЛЛАНА**. `users`-д CASCADE хүүхэд **27**, `projects`-д **39** (migration файлууд дээрх `grep -rh "REFERENCES … ON DELETE CASCADE" \| wc -l`; spec-ийн «38» нь ойролцоо). Аль алийг нь `migrations apply`-аар ХЭЗЭЭ Ч дахин барьж болохгүй. |
| Compound statement | wrangler нь **том үсгээр, өмнөө зайтай** `END;` терминатор шаарддаг — өөрийн мөрөнд `END;` гэж бич, жижгээр БИШ. |
| БАЙХГҮЙ зүйлс | 190 migration-д `CREATE TRIGGER`, `CREATE VIEW`, `GENERATED ALWAYS`, `json_extract` **ТЭГ**. Тэднийг ашиглах бол эхлээд хаях D1 дээр батал. |
| `ALTER TABLE … ADD COLUMN` | **CHECK хязгаарлалт нэмэх БОЛОМЖГҮЙ** — репо дотор гурван удаа тэмдэглэсэн: `0168_quotes_status.sql:27`, `0170_quotes_source.sql:37`, `0181_quotes_lang.sql:12`. Тиймээс шинэ багана дээр enum-ыг **route дотор** шалгана. |

### Deploy

CI **үхсэн** (`.github/workflows/deploy-*.yml` хоёул амжилтгүй болдог). Зөвхөн локал wrangler:

```
cd backend  && npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
cd backend  && npx wrangler deploy --config wrangler.toml
cd frontend && npm run build && npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main
```

`--config wrangler.toml` нь **ЗААВАЛ** — репо root дээрх төөрөгдүүлсэн `wrangler.jsonc` өөр worker зарладаг. `pages` дэд команд бүрийг **`npx -y wrangler@latest`**-ээр ажиллуул.

### Яагаад энэ ажил байгаа вэ — **ЭНЭ БОЛ TRACK B-ИЙН ХАМГИЙН ӨНДӨР ҮНЭ ЦЭНТЭЙ ЗҮЙЛ**

Revit туслахын санаа таних ангилагч нь API, LLM, интернэтгүйгээр локалд ажилладаг. Түүнийг сайжруулах **цорын ганц** зам бол бодит хэрэглээг цуглуулж → шошголж → дахин сургах гогцоо. `backend/src/routes/revit.ts:1620-1626`-ийн коммент тэр гогцоог өөрөө зурсан байдаг:

```
 *   add-in  --logs-->  assistant_logs  --шошго-->  assistant_examples
 *                                                        |
 *                                                    сургалт (Python)
 *                                                        v
 *   add-in  <--model--  assistant_models (is_active = 1)
```

**Гогцооны бүх холбоос БИЧИГДСЭН, ГАНЦ «--шошго-->» сум нь л ХҮНГҮЙ.** Сервер тал дээр хүний баталгаажуулах хаалга **БАЙГАА** — `GET /assistant/pending` (эрэмбэлэлт нь хүртэл сайтар бодогдсон) ба `POST /assistant/examples`. Гэвч **тэдгээрийг дуудах КЛИЕНТ ОГТ БАЙХГҮЙ** (§2.4-т нотолсон). Үр дүнд нь:

1. Сургалтын гогцоо **архитектурын хувьд бүрэн, ажиллагааны хувьд ҮХСЭН**.
2. Одоо нийлүүлэгдсэн сургалтын корпус **бүхэлдээ машин үүсгэсэн** — `revit-mcp/training/data/`-д 5 өгөгдлийн файл, нийт **2532 мөр**; тус бүрийн `_note` талбар нь өөрөө «үр өгөгдөл», «БООТСТРАП үр», «олон хэлний багц», «хатуу сөрөг» гэж хэлж байна (§2.7). `data/production.json` — бодит хэрэглээнээс ирэх ЦОРЫН ГАНЦ файл — **БАЙХГҮЙ** (`revit-mcp/training/pull_and_retrain.py:53` түүнийг хүлээж байгаа).
3. Тиймээс одоогийн модель бол **«LLM монгол инженерүүд юу бичих байх гэж төсөөлсөн нь»**, тэдний бодитоор бичдэг зүйл БИШ. Энэ UI нь яг тэр хоёрыг сольдог зүйл.
4. **Үүнээс өмнө барьсан ЛЮБОЙ нэмэлт цуглуулах гарц нь хэн ч хэзээ ч шошголохгүй мөр л нэмнэ.** Тиймээс энэ нь Track B-д хамгийн эхэнд явах ёстой.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх file:line бүрийг 2026-08-27-нд энэ сессид **шууд нээж** баталгаажуулсан.

### 2.1 Router-ийн эрх

`backend/src/routes/revit.ts:43`
```ts
const REVIT_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];
```
`backend/src/routes/revit.ts:79`
```ts
revit.use('*', requireRole(...REVIT_ROLES));
```
`client` ба `worker` энд хүрэхгүй (`lib/workerScope.ts` нь хаалттай-анхдагч allowlist).

`backend/src/routes/revit.ts:90-92` — **энэ файлын ЛОКАЛ туслах**, `lib/`-д БИШ:
```ts
function isManager(role: string): boolean {
  return role === 'admin' || role === 'senior';
}
```

### 2.2 Хүлээгдэж буй дараалал — БАЙГАА, эрэмбэ нь САНААТАЙ

`backend/src/routes/revit.ts:1863-1893`:

```ts
revit.get('/assistant/pending', async (c) => {
  const user = c.get('user');
  if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);   // :1865
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
  const { results } = await c.env.DB.prepare(
      `SELECT l.id, l.text, l.predicted, l.confidence, l.decided_by,
              l.corrected, l.feedback, l.feedback_note, l.acted, l.created_at,
              u.full_name AS user_name
         FROM assistant_logs l
         LEFT JOIN users u ON u.id = l.user_id
        WHERE l.curated = 0                                                    // :1875
        ORDER BY
          CASE
            WHEN l.feedback_note IS NOT NULL THEN -1                           // :1880
            WHEN l.corrected IS NOT NULL THEN 0
            WHEN l.feedback = -1         THEN 1
            WHEN l.decided_by = 'fallback' THEN 2
            ELSE 3
          END,
          l.created_at DESC
        LIMIT ?`).bind(limit).all();
  return c.json({ pending: results ?? [] });                                   // :1892
});
```

Тэмдэглэл: **эрэмбэ нь яг spec-д бичсэнчлэн** — чөлөөт бичвэрийн санал (`feedback_note`) → залруулга (`corrected`) → 👎 (`feedback = -1`) → `fallback` → бусад. Кодын дээрх коммент (`:1857-1862`) энэ санааг ил бичсэн: «Хамгийн үнэ цэнтэй нь дээрээ». UI нь энэ дарааллыг **ӨӨРЧЛӨХГҮЙГЭЭР** харуулах ёстой.

### 2.3 Жишээ дэвшүүлэх гарц

`backend/src/routes/revit.ts:1900-1968`. Гол мөрүүд:

- `:1902` — `if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);` → **admin БА senior хоёул**.
- `:1922` — эх сурвалжийн анхдагч:
  ```ts
  source: e.source === 'seed' || e.source === 'manual' ? String(e.source) : 'usage',
  ```
  **⚠️ Анхдагч нь `'usage'`.** Өөрөөр хэлбэл гараар шивж оруулсан мөр нь ямар ч тэмдэггүй бол «бодит хэрэглээнээс ажиглагдсан» гэж бүртгэгдэнэ.
- `:1929-1930` — `const BINDS = 7; const PER = Math.floor(100 / BINDS);` → 7 bind × 14 мөр.
- `:1941-1946` — INSERT + `ON CONFLICT (text, intent) DO UPDATE SET is_active = 1, slot = COALESCE(...)`. Bind-ууд: `r.text, foldText(r.text), r.intent, r.slot, r.style, r.source, user.sub`.
- `:1951-1952` — **`log_ids` нь БҮРЭН СОНГОЛТТОЙ**:
  ```ts
  const ids = Array.isArray(body.log_ids)
    ? (body.log_ids as unknown[]).map(Number).filter(Number.isInteger).slice(0, 500)
    : [];
  ```
- `:1959-1960` — гаралтын бүх нөлөө:
  ```sql
  UPDATE assistant_logs SET curated = 1 WHERE id IN (...)
  ```
- Хязгаарууд: `:1628` `MAX_LOG_BATCH = 200`, `:1630` `MAX_LOG_TEXT = 500`, `:1632` `MAX_EXAMPLE_BATCH = 500`.
- Санаанууд: `:1635-1645` `ASSISTANT_INTENTS` = `submit_progress, list_sheets, isolate_sheet, reset_view, whats_changed, set_baseline, progress_status, help, unknown` (twin: `addin/IntentRouter.cs`).

**→ SPEC-Д ЗАСВАР: «link is optional» гэсэн таамаг ХЭТ ЗӨӨЛӨН. Бодит байдал: холбоос ОГТ БАЙХГҮЙ.** `assistant_examples`-д `log_id` төрлийн багана байхгүй (§2.5); `log_ids` нь зөвхөн `assistant_logs` дээр туг тавихад ашиглагдаж, дэвшүүлсэн жишээ рүү буцаж заадаггүй.

### 2.4 Клиент — ТЭГ

```
$ cd frontend/src && grep -rn "assistant/pending\|assistant/examples\|assistant/export\|assistant/models\|assistant/logs" .
(гаралт байхгүй)
$ cd frontend/src && grep -rln "assistant" .
./shared/config/modules.ts        ← :59 зөвхөн `ai: { mn: 'AI туслах', en: 'AI assistant' }` шошго
```

Репо даяар (`.ts`, `.tsx`, `.cs`, `.py`, `.mjs`):

| Гарц | Дуудагч |
|---|---|
| `POST /assistant/logs` | `revit-mcp/addin/AssistantLog.cs:291` (add-in) |
| `GET /assistant/model` | `revit-mcp/addin/ApiClient.cs:144` (add-in) |
| `GET /assistant/export` | `revit-mcp/training/pull_and_retrain.py:69` (`pull()`) |
| `POST /assistant/models` | `pull_and_retrain.py` (`--publish` салаа) |
| **`GET /assistant/pending`** | **ХЭН Ч БИШ.** Ганц дурдагдсан газар нь `pull_and_retrain.py:182` — алдааны мессежийн текст: `` «`/assistant/pending`-ийг хараарай.» `` |
| **`POST /assistant/examples`** | **ХЭН Ч БИШ.** |

Түүнчлэн: `grep -rln "assistant_examples"` (node_modules-гүйгээр) нь **зөвхөн** `backend/src/routes/revit.ts` ба `revit-mcp/training/pull_and_retrain.py` (коммент)-ыг олно. Өөрөөр хэлбэл **`assistant_examples` руу бичдэг код репо даяар нэг ч дуудагдаж байгаагүй**, тиймээс `GET /assistant/export` нь хоосон массив буцаах магадлал өндөр (§9-Б-д продакшн асуулга).

### 2.5 DDL — татгалзал (reject) төлөвийг илэрхийлэх БОЛОМЖГҮЙ

`backend/migrations/0195_assistant_learning.sql`, `assistant_logs`:
```sql
  -- Шошголж `assistant_examples` руу шилжүүлсэн эсэх.
  curated       INTEGER NOT NULL DEFAULT 0 CHECK (curated IN (0,1)),
```
`assistant_examples`:
```sql
  source      TEXT    NOT NULL DEFAULT 'seed'
                      CHECK (source IN ('seed','usage','manual')),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  note        TEXT,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
```

`backend/migrations/0200_assistant_feedback_note.sql` (бүхэлдээ):
```sql
ALTER TABLE assistant_logs ADD COLUMN feedback_note TEXT;
CREATE INDEX IF NOT EXISTS idx_assistant_logs_notes
  ON assistant_logs (created_at) WHERE feedback_note IS NOT NULL;
```

**Баталгаажсан дүгнэлт:**

| Хэрэгтэй мэдээлэл | Одоо хадгалагдаж байгаа эсэх |
|---|---|
| Хянагч хэн бэ | ❌ `assistant_logs`-д БАЙХГҮЙ (`assistant_examples.created_by` нь зөвхөн дэвшүүлсэн тохиолдолд) |
| Хэзээ хянасан | ❌ БАЙХГҮЙ (`created_at` нь бүртгэл үүссэн огноо) |
| Үр дүн (дэвшүүлсэн / татгалзсан) | ❌ **БАЙХГҮЙ** — `curated` ганц 0/1 туг |
| Яагаад татгалзсан | ❌ БАЙХГҮЙ |
| Жишээ ↔ эх бүртгэлийн холбоос | ❌ **БАЙХГҮЙ** — `assistant_examples`-д `log_id` багана огт байхгүй |

**Тиймээс: татгалзсан мөр ба дэвшүүлсэн мөр ЯЛГАГДАХГҮЙ.** Хоёул `curated = 1`. Сөрөг шүүлт — «энэ мөр сургалтад ОРОХ ЁСГҮЙ, учир нь …» гэсэн хамгийн үнэ цэнтэй дохио — үүсмэгцээ УСТДАГ. Мөн `curated = 1` тавихын тулд `log_ids` дамжуулах шаардлагатай бөгөөд тэр нь сонголттой тул одоогийн API-аар «татгалзах» гэдэг нь: мөрийг дараалалд ҮҮРД үлдээх, эсвэл хуурамчаар «дэвшүүлсэн» болгох хоёрын нэг л байна.

### 2.6 Индексүүд

```sql
CREATE INDEX IF NOT EXISTS idx_assistant_logs_curate
  ON assistant_logs(curated, created_at DESC);
```
Энэ нь `WHERE l.curated = 0`-г дэмжинэ; `ORDER BY CASE …` нь индексээр шийдэгдэхгүй (`LIMIT 50..200` тул асуудалгүй).

### 2.7 Сургалтын корпус — бүхэлдээ машин үүсгэсэн

| Файл | Мөр | `_note`-ийн эхлэл (шууд уншсан) |
|---|---:|---|
| `seed.json` | 517 | «Үр өгөгдөл — 9 санаа, 7 хэв маяг (кирилл/латин/холимог/богино/эелдэг/алдаатай/асуулт) …» |
| `bootstrap.json` | 215 | «БООТСТРАП үр — гогцоог (сургалт → экспорт → C# таамаглал) баталгаажуулах ЖИЖИГ багц» |
| `english.json` | 463 | «АНГЛИ ХЭЛНИЙ БЭХЖҮҮЛЭЛТ — ХЭМЖСЭН сул цэг рүү чиглэсэн багц …» |
| `multilang.json` | 1291 | «ОЛОН ХЭЛНИЙ БАГЦ — англи · латинаар бичсэн монгол · кирилл … 9 санаа × 4 хэл» |
| `hard-negatives.json` | 46 | «ХАТУУ СӨРӨГ ба ирмэгийн жишээ — 2026-08-25-нд БОДИТ ХЭМЖИЛТЭЭР нэмэв …» |
| **НИЙТ** | **2532** | **нэг ч мөр бодит хэрэглээнээс ирээгүй** |
| `production.json` | — | **ФАЙЛ БАЙХГҮЙ** (`pull_and_retrain.py:53` `PROD = DATA / "production.json"`) |

`report.json` (өгөгдлийн файл биш, тайлан): `{"version": "2026-08-25.1", "examples": 2402, "accuracy": 0.9403, ...}` — 94% нарийвчлал нь **зөвхөн синтетик өгөгдөл дээрх** үзүүлэлт.

`pull_and_retrain.py:71-87` — `pull()` нь `/assistant/export`-оос `{text, intent, style, slot?}` талбаруудыг аваад `production.json` бичдэг; `datasets()` (`:94-96`) нь `data/*.json`-оос `report.json`-оос бусдыг **бүгдийг** сургалтад оруулна.

### 2.8 Add-in ямар талбар илгээдэг вэ (зөвхөн уншсан, хөндөхгүй)

- `revit-mcp/addin/AssistantLog.cs:22` — `[JsonPropertyName("decided_by")]`, `:37` — `[JsonPropertyName("feedback_note")]`, `:291` — `POST /api/revit/assistant/logs`.
- `revit-mcp/addin/IntentRouter.cs:221-227` — `DecidedByTag()` нь **`"keyword" | "model" | "fallback"`** гурван утга буцаана; тавигддаг газрууд `:149, :160, :185, :192`.
- `revit-mcp/addin/ApiClient.cs:144` — `GET /api/revit/assistant/model` (моделийн жин татах). Гогцооны «буцах» тал нь **аль хэдийн ажилладаг**.

### 2.9 SPEC-Д ЗАСВАР ОРУУЛАХ ЗҮЙЛ — `BINDS` комментын зөрүү

`backend/src/routes/revit.ts:1704-1707`:
```ts
  // 12 bind/мөр → floor(100/12) = 8 мөр/statement (D1-ийн 100 bind хязгаар).
  // ⚠️ БАГАНА НЭМБЭЛ ЭНЭ ТООГ ЗАСАХ ЁСТОЙ.  D1-ийн нэг statement 100
  // bind-аар хязгаарлагдана; 13 × 7 = 91 ≤ 100.
  const BINDS = 13;
```
Комментын **эхний мөр (12 → 8) хуучирсан**; хоёрдугаар мөр (13 × 7 = 91) ба тогтмол (`13`) зөв. Бодит bind: `user.sub, project_id, doc_uid, revit_version, text, predicted, confidence, decided_by, corrected, feedback, acted, client_id, feedback_note` = **13**.

Тусдаа тогтмол `backend/src/routes/revit.ts:58-59`:
```ts
const BINDS_PER_BINDING_ROW = 13;
const BINDING_ROWS_PER_STATEMENT = Math.floor(100 / BINDS_PER_BINDING_ROW); // = 7
```
— энэ нь `revit_sheet_bindings`-д хамаарах **ӨӨР** зүйл; хольж болохгүй. **Комментыг засах нь энэ ажлын хамрах хүрээнд БИШ** — зөвхөн хуулж болохгүйг мэдэж бай.

### 2.10 Frontend конвенцууд — тус бүрийг баталсан

| Конвенц | Баталгаа |
|---|---|
| **Хуудас бүр lazy** | `frontend/src/app/routes.tsx:17-129` — бүх хуудас `lazy(() => import(...))`. ЗААВАЛ ХЭВЭЭР ҮЛДЭЭ. |
| **Таб нь `useTabParam`, `useState` БИШ** | `frontend/src/shared/hooks/useTabParam.ts:27-56`. Ажиллаж буй жишээ: `features/approvals/ApprovalsPage.tsx:87` — `const [view, setView] = useTabParam(APPROVAL_VIEWS, 'approvals', 'view');`. `useState` болгож хувиргавал глобал хайлт **чимээгүй эвдэрнэ**. |
| **Хайлтад орох хэсэг = 2 алхам** | `frontend/src/shared/lib/search/sections.ts:23-30`: «1. Зорилтот блокт `id="sec-…"` + `scroll-mt-24` тавь; 2. энд НЭГ мөр нэм. **Гуравдугаар алхам байхгүй**». Мөрийн хэлбэр (`sections.ts:534-544`): `{ page, to, labelKey, keywords? }`. `page` нь `Layout.tsx`-ийн `NAV_ITEMS[].to`-той ЯГ таарах ёстой (`sections.ts:52-56` дээрх коммент: эцэг цэс харагдахгүй бол хэсэг нь хайлтад ч гарахгүй). |
| **Мөр хоёр хэлэнд** | `frontend/src/shared/i18n/mn.json` ба `en.json` — тус бүр **4754 түлхүүр, зөрүү ТЭГ** (энэ сессид тоолсон). `mn.json` шууд (eager) импортлогддог, `en.json` lazy. |
| **UI-ийн эрх нь зөвхөн UX** | `shared/components/ProtectedRoute.tsx:15,58` (`allowedRoles`) нь **бүх апп даяар ганц удаа** ашиглагдсан — `app/routes.tsx:310` (`/app/attendance/admin`). Бодит хаалга нь backend. |
| **Design-token lint нь тусдаа** | `npm run lint:tokens` — 1358 мэдэгдэж буй зөрчил; `npm run lint` — ~139 хуучин react-hooks алдаа. **Тэднийг засах гэж БҮҮ оролд.** |
| **NAV_ITEMS-д `module` ЗААВАЛ** | `shared/components/Layout.tsx:205-222` — `NavItem` төрөл: `to, icon, labelKey, roles, group, children?, module`. |
| **⚠️ Модулийн зураглал** | `backend/src/lib/modules.ts:223` — `'/api/revit': 'progress'` (`'revit'` БИШ; `:221-222`-ийн коммент тайлбарласан: `/api/revit-addin` л `'revit'` модуль). Тиймээс nav мөрийн `module` нь **`'progress'`** байх ёстой, эс бөгөөс backend нээлттэй байхад цэс нуугдана. |
| Таб бүрхүүл | `@/ui/keep-alive-tabs` (`frontend/src/ui/keep-alive-tabs.tsx`); хэрэглэгч жишээ: `features/attendance/AttendanceAdminPage.tsx`. |
| API давхарга | `@/shared/api/useApi` (`useApiQuery`) + `@/shared/api/client` (`apiFetch`). `client.ts:9` — суурь нь `${apiHost()}/api`, тиймээс endpoint нь `'/revit/assistant/pending'`. |

---

## 3. ХИЙХ АЖИЛ

### Deploy 1 — migration `0201_assistant_review.sql` (ЗӨВХӨН SCHEMA)

> **Дүрэм:** шинэ багана нь түүнийг уншдаг кодоос **ХАТУУ ӨМНӨХ** deploy-д гарна.
> Бүх `ALTER` нь эхэнд; `ADD COLUMN`-д **CHECK тавихгүй** (§1-ийн хүснэгт, репогийн 3 прецедент).

```sql
-- 0201 — Туслахын курацийн ТӨЛӨВ: татгалзал нь БОДИТ, БҮРТГЭГДСЭН төлөв.
--
-- ⚠️ ЯАГААД: 0195-д `assistant_logs.curated` нь ГАНЦ 0/1 туг байсан.  Түүнийг
-- `POST /api/revit/assistant/examples` дэвшүүлэлтийн ДАГАВАР үйлдлээр тавьдаг
-- (`routes/revit.ts:1959`).  Үр дүнд нь ТАТГАЛЗСАН мөр ба ДЭВШҮҮЛСЭН мөр
-- ялгагдахгүй; хянагч хэн бэ, хэзээ, яагаад гэдэг мэдээлэл алга.  Сөрөг
-- шүүлт бол сургалтын хамгийн үнэ цэнтэй дохио — түүнийг устгаж болохгүй.
--
-- ⚠️ `curated`-ыг ХЭВЭЭР үлдээв: `/assistant/pending`-ийн `WHERE curated = 0`
-- ба `idx_assistant_logs_curate` индекс түүн дээр тогтдог.  Шинэ багана нь
-- түүний ДЭЛГЭРЭНГҮЙ нь болно, ОРЛУУЛАГЧ нь биш.
--
-- ⚠️ ADD COLUMN дээр CHECK тавих боломжгүй (SQLite) — 0168/0170/0181-тэй
-- ижил.  Enum-ыг `routes/revit.ts` шалгана: 'promoted' | 'rejected'.

/* --- 1. БАЙГАА хүснэгтүүд дээрх ALTER — ЭХЭНД --- */

-- NULL = хараахан хянаагүй.  'promoted' = жишээ болсон.  'rejected' = сургалтад
-- ОРОХГҮЙ гэж ХҮН шийдсэн (мөрийг устгахгүй — шалтгаан нь өөрөө өгөгдөл).
ALTER TABLE assistant_logs ADD COLUMN review_status TEXT;
ALTER TABLE assistant_logs ADD COLUMN reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE assistant_logs ADD COLUMN reviewed_at   TEXT;
-- Яагаад татгалзсан / яагаад залруулсан.  Хүний бичсэн текст, 500 тэмдэгт.
ALTER TABLE assistant_logs ADD COLUMN review_note   TEXT;

-- Дэвшүүлсэн бол ЯМАР бүртгэлээс гарсан бэ.  Гар оруулга (source='manual')
-- ба ажиглагдсан мөрийг ялгах ЦОРЫН ГАНЦ бодит нотолгоо.
ALTER TABLE assistant_examples ADD COLUMN source_log_id INTEGER REFERENCES assistant_logs(id) ON DELETE SET NULL;
ALTER TABLE assistant_examples ADD COLUMN reviewed_at   TEXT;

/* --- 2. Индексүүд --- */

-- Хянасан түүхийн таб: «хэн юуг хэзээ».
CREATE INDEX IF NOT EXISTS idx_assistant_logs_review
  ON assistant_logs (review_status, reviewed_at DESC)
  WHERE review_status IS NOT NULL;

-- «Энэ жишээ хаанаас ирсэн бэ» — гар оруулга vs ажиглалт.
CREATE INDEX IF NOT EXISTS idx_assistant_ex_src_log
  ON assistant_examples (source_log_id)
  WHERE source_log_id IS NOT NULL;

/* --- 3. Түүхэн мөрийг НӨХӨН БӨГЛӨХ --- */

-- 0201-ээс ӨМНӨ `curated = 1` болсон мөр нь ЗӨВХӨН дэвшүүлэлтээр л ийм болж
-- чадна (татгалзал байгаагүй), тиймээс 'promoted' гэж тэмдэглэх нь зөв.
-- `reviewed_by` нь ҮЛ МЭДЭГДЭХ — хуурамч хүн БИЧИХГҮЙ, NULL үлдээнэ.
UPDATE assistant_logs
   SET review_status = 'promoted'
 WHERE curated = 1 AND review_status IS NULL;
```

**Заавал:** энэ файлыг **зөвхөн `wrangler d1 migrations apply`**-аар түлх. `d1 execute --file` замыг бүү ашигла (бүртгэлийн зөрүү үүсгэдэг).

### Deploy 2 — `backend/src/routes/revit.ts`

**3.1 `GET /assistant/pending` — өргөтгөх (одоогийн эрэмбийг ХЭВЭЭР)**

- `SELECT`-д `l.user_id`, `l.project_id`, `l.review_status` нэмнэ (`user_id` нь UI дээрх «өөрийн мөр» тэмдэглэгээ ба дөрвөн нүдний дүрэмд хэрэгтэй).
- `WHERE` нь `l.curated = 0 AND l.review_status IS NULL`.
- `ORDER BY CASE …` блокийг **ҮСЭГ ҮСГЭЭР ХЭВЭЭР** үлдээ.
- `?status=promoted|rejected` дэмжвэл «хянасан түүх» таб нэг гарцаар уншина:

```ts
const status = c.req.query('status');           // undefined | 'promoted' | 'rejected'
const where = status === 'promoted' || status === 'rejected'
  ? 'l.review_status = ?'
  : 'l.curated = 0 AND l.review_status IS NULL';
// bind: status ? [status, limit] : [limit]  → 100-ийн хязгаарт огт ойртохгүй
```

**3.2 `POST /assistant/examples` — эх сурвалжийг ЗААВАЛ болгох**

`:1922`-ийн анхдагчийг **алдаа** болгож солино:

```ts
// ⚠️ ӨМНӨ НЬ анхдагч нь 'usage' байсан — гараар шивсэн мөр «бодит
// хэрэглээнээс ажиглагдсан» гэж ХУДАЛ бүртгэгддэг байв.  Одоо: 'usage'
// бол эх бүртгэлийн ХОЛБООС заавал, эс бөгөөс 'manual' гэж ил тэмдэглэнэ.
const src = e.source;
if (src !== 'seed' && src !== 'manual' && src !== 'usage') return null;
if (src === 'usage' && !Number.isInteger(Number(e.log_id))) return null;
```
400 хариу: `{ error: 'each example needs source; source="usage" requires log_id' }`.

INSERT-д `source_log_id` нэмнэ → **bind 7-оос 8 болно**:
```ts
// ⚠️ 8 bind/мөр → floor(100/8) = 12 мөр/statement.  БАГАНА НЭМБЭЛ ЭНЭ ТООГ
// ЗАСАХ ЁСТОЙ — D1-ийн нэг statement 100 bind-аар хязгаарлагдана; 8 × 12 = 96.
const BINDS = 8;
const PER = Math.floor(100 / BINDS);      // = 12
```
```sql
INSERT INTO assistant_examples
  (text, text_folded, intent, slot, style, source, created_by, source_log_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (text, intent) DO UPDATE SET
  is_active     = 1,
  slot          = COALESCE(excluded.slot, assistant_examples.slot),
  source_log_id = COALESCE(assistant_examples.source_log_id, excluded.source_log_id)
```

`log_ids` дээрх `UPDATE`-ыг хянагчийн бүртгэлтэй болгоно:
```sql
UPDATE assistant_logs
   SET curated       = 1,
       review_status = 'promoted',
       reviewed_by   = ?,
       reviewed_at   = datetime('now')
 WHERE id IN (...)
   AND review_status IS NULL      -- давхар хяналт эхний шийдвэрийг ДАРЖ БИЧИХГҮЙ
```
Bind тооцоо: `1 (reviewed_by) + N (id)`. Одоогийн чанк 90 → `1 + 90 = 91 ≤ 100`, тиймээс **90 хэвээр байж болно** — гэхдээ **тооцоог комментоор бич**.

**3.3 ШИНЭ: `POST /assistant/review` — ТАТГАЛЗАЛ**

```ts
/**
 * POST /api/revit/assistant/review — бүртгэлийг ТАТГАЛЗАНА (admin/senior).
 *
 * ⚠️ ЯАГААД ТУСДАА ГАРЦ: татгалзал нь `assistant_examples`-д мөр
 * ҮҮСГЭХГҮЙ, тиймээс «хоосон examples» гэж `/examples`-ээр дамжуулах нь
 * семантикийн хувьд буруу.  Татгалзал бол БИЕ ДААСАН, БҮРТГЭГДСЭН шийдвэр.
 *
 * body: { log_ids: number[], outcome: 'rejected', note?: string }
 */
revit.post('/assistant/review', async (c) => {
  const user = c.get('user');
  if (!isManager(user.role)) return c.json({ error: 'Хандах эрхгүй' }, 403);
  // ...
  // ⚠️ 2 bind (note, reviewed_by) + N id.  Чанк 90 → 92 ≤ 100.
  // UPDATE assistant_logs
  //    SET curated = 1, review_status = 'rejected',
  //        reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?
  //  WHERE id IN (...) AND review_status IS NULL
});
```
`note` нь `str(body.note, 500)`. `outcome` нь одоогоор ЗӨВХӨН `'rejected'` (`'promoted'` нь `/examples`-ээр явна) — бусад утга 400.

**3.4 «дөрвөн нүд» (four-eyes) — эзний шийдвэрээр (§9-А-2)**

Зөвшөөрвөл §3.2 ба §3.3-ын `UPDATE`-д нэг мөр нэмнэ, мөн `/pending`-ийн `WHERE`-т ч:
```sql
  AND user_id <> ?    -- хянагч ӨӨРИЙНХӨӨ бичвэрийг баталгаажуулж болохгүй
```
Татгалзвал мөрийг **огт нэмэхгүй**, UI дээр ч хориглохгүй (зөвхөн «энэ чиний өөрийн бичвэр» гэсэн сануулга харуулж болно).

### Deploy 3 — Frontend

**3.5 Шинэ хуудас** `frontend/src/features/revit-assistant/AssistantCurationPage.tsx`

- `useApiQuery` (`@/shared/api/useApi`) + `apiFetch` (`@/shared/api/client`). Endpoint: `'/revit/assistant/pending'` (суурь нь аль хэдийн `/api`).
- Табууд: `useTabParam(['pending','reviewed','examples'] as const, 'pending')` + `KeepAliveTabs` (`@/ui/keep-alive-tabs`). **`useState` БҮҮ ХЭРЭГЛЭ.**
- **Серверийн буцаасан дарааллыг ХЭВЭЭР** үзүүл (клиент талд дахин эрэмбэлэхгүй). Мөр бүрд:

| Багана | Талбар | Тэмдэглэл |
|---|---|---|
| Бичвэр | `text` | хэрэглэгчийн бичсэн яг мөр |
| Таасан санаа | `predicted` | 9 санааны нэг |
| Итгэлцэл | `confidence` | босго `0.45` (`app_settings['assistant.min_confidence']`) — доогуур бол ялгаатай өнгө |
| Шийдсэн давхарга | `decided_by` | `keyword` / `model` / `fallback` — badge |
| Залруулга | `corrected` | байвал дэвшүүлэх талбарын **анхдагч** утга |
| 👍 / 👎 | `feedback` | `1` / `-1` |
| **Чөлөөт тэмдэглэл** | `feedback_note` | **хамгийн дээд эрэмбийн шалтгаан** — бүтэн харуул, таслахгүй |
| Хэн | `user_name` | `LEFT JOIN users` |
| Хэзээ | `created_at` | |

- Гурван үйлдэл: **Дэвшүүлэх** (`predicted`-ээр), **Засаад дэвшүүлэх** (санааны `<Select>`; `isolate_sheet` үед `slot` талбар), **ТАТГАЛЗАХ** (шалтгааны `<Textarea>` → `review_note`).
- Багц үйлдэл: checkbox → «сонгосныг дэвшүүлэх / татгалзах». Багцын хэмжээг `MAX_EXAMPLE_BATCH = 500`-аас доогуур байлга.
- «Гараар жишээ нэмэх» жижиг форм — `source: 'manual'`-ыг **ил** илгээнэ (`log_id` шаардахгүй).
- Хэсгүүдэд `id="sec-assistant-pending"` / `sec-assistant-reviewed` / `sec-assistant-examples` + `className="scroll-mt-24"`.

**3.6 Route** — `frontend/src/app/routes.tsx`
```tsx
const AssistantCurationPage = lazy(
  () => import('@/features/revit-assistant/AssistantCurationPage'),
);
...
<Route path="admin/assistant" element={<AssistantCurationPage />} />
```
`allowedRoles` prop-ыг **бүү** ашигла (апп даяар ганц газар хэрэглэсэн); эрхийн шалгалтыг хуудсан дотор хий — бодит хаалга нь backend.

**3.7 Nav** — `frontend/src/shared/components/Layout.tsx`, `NAV_ITEMS`
```tsx
// Revit туслахын СУРГАЛТЫН КУРАЦИ — хүний баталгаажуулах хаалга.
// ⚠️ backend нь `/api/revit`-ийг `progress` модульд харьяалуулдаг
// (`backend/src/lib/modules.ts:223`), тиймээс `module: 'progress'`.
{
  to: '/app/admin/assistant',
  icon: BrainCircuit,          // lucide-react
  labelKey: 'assistantCuration.navTitle',
  roles: ['admin', 'senior'],  // ⚠️ §9-А-1 — эзний шийдвэр
  group: 'people',             // эсвэл 'business' — эзэнтэй тохиролц
  module: 'progress',
},
```
`Layout.tsx`-ийн хайлтын синоним map-д (`:484` орчмын `'/app/approvals': '…'` хэлбэртэй бүтэц) мөр нэм:
```ts
'/app/admin/assistant': 'туслах сургалт шошго курац assistant training label curate intent',
```

**3.8 Хайлтын хэсгүүд** — `frontend/src/shared/lib/search/sections.ts`
```ts
{
  page: '/app/admin/assistant',
  to: '/app/admin/assistant?tab=pending',
  labelKey: 'assistantCuration.pendingTab',
  keywords: 'хүлээгдэж буй шошголоогүй pending queue label curate',
},
{
  page: '/app/admin/assistant',
  to: '/app/admin/assistant?tab=reviewed',
  labelKey: 'assistantCuration.reviewedTab',
  keywords: 'хянасан татгалзсан rejected reviewed history',
},
```
**Гуравдугаар алхам байхгүй** — `Layout.tsx` энэ жагсаалтыг өөрөө уншина.

**3.9 i18n** — `mn.json` БА `en.json` **хоёуланд**, ижил түлхүүрээр. Одоо тус бүр 4754 түлхүүртэй, зөрүү ТЭГ — тэр байдлыг хадгал.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Зүйл | Юунаас хамаарч байна | Эвдвэл юу болох |
|---|---|---|
| `assistant_logs.curated` багана ба `WHERE l.curated = 0` | `revit.ts:1875`, `idx_assistant_logs_curate` | `review_status`-аар БҮРЭН орлуулбал индекс ашиглагдахгүй + хуучин мөрүүд дахин дараалалд гарна. **`curated`-ыг үлдээ, зэрэгцүүлэн бич.** |
| `/assistant/pending`-ийн `ORDER BY CASE` (`revit.ts:1877-1886`) | Бүтээгдэхүүний шийдвэр, кодын коммент | Эрэмбийг өөрчилбөл хамгийн үнэ цэнтэй материал (чөлөөт тэмдэглэл) дараалалд булагдана. |
| `assistant_examples`-ийн `UNIQUE(text, intent)` + `ON CONFLICT DO UPDATE` (`revit.ts:1941-1946`) | Давхардал хамгаалалт | Устгавал давхардсан жишээ модель руу орж, `check_parity.py` унана. |
| `GET /assistant/export`-ийн **хэлбэр** | `pull_and_retrain.py:69-80` — `{count, per_intent, rows:[{text,intent,slot,style,source}]}` | Хэлбэрийг өөрчилбөл Python шугам чимээгүй хоосон `production.json` бичнэ. `source_log_id`-г export-д **одоохондоо нэмэхгүй**. |
| `assistant_models` / `/assistant/model` / `idx_assistant_model_active` | Add-in `ApiClient.cs:144` | Хоёр идэвхтэй модель байвал add-in аль нь ирснийг мэдэхгүй. Энэ ажил тэдэнд хүрэхгүй. |
| `revit.use('*', requireRole(...REVIT_ROLES))` (`revit.ts:79`) | Add-in-ийн бүх дуудлага | Чангалбал add-in ажиллахаа болино; засах арга нь ~20 PC дээр гараар. |
| `POST /assistant/logs`-ийн `BINDS = 13` (`revit.ts:1706`) | D1-ийн 100 bind | Багана нэмбэл тоог засах ёстой. **Энэ ажил тэр гарцад хүрэхгүй.** |
| `useTabParam` | `sections.ts`-ийн `?tab=` хаяглалт | `useState` болговол глобал хайлт **чимээгүй** эвдэрнэ. |
| Хуудсын lazy импорт | `manualChunks`, эхний ачаалалт | Шууд импорт хийвэл админы код бүх хэрэглэгчийн bundle-д орно. |
| `mn.json` eager импорт (универсал fallback) | i18n | Түлхүүрийг зөвхөн `en.json`-д нэмбэл монголоор түлхүүрийн нэр харагдана. |
| `lint` / `lint:tokens`-ийн хуучин зөрчлүүд | — | Зассан ч гэсэн энэ PR-ыг үл ойлгогдох болгоно. **Бүү зас.** |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### Урьдчилсан нөхцөл

1. `assistant_logs` / `assistant_examples` продакшнд байгаа (0195 + 0200 хэрэгжсэн) — `d1_migrations` дээр шалга.
2. §9-А-ийн шийдвэрүүд (хэн курац хийх эрхтэй; дөрвөн нүдний дүрэм) **эзнээс** гарсан байх.
3. `ls backend/migrations | tail -3` — **0201** үнэхээр чөлөөтэй эсэхийг дахин шалга (өөр агент авчихсан байж болно).

### Deploy дараалал — ЗААВАЛ ЭНЭ ДЭС ДАРААЛЛААР

| # | Юу | Команд | Яагаад |
|---|---|---|---|
| 1 | Migration `0201` | `cd backend && npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml` | **Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ӨМНӨХ deploy-д гарна.** |
| 2 | Worker | `cd backend && npx tsc --noEmit && npx wrangler deploy --config wrangler.toml` | Route-ууд шинэ баганыг уншина. Энэ хооронд frontend хуучин хэвээр — шинэ гарц зүгээр л дуудагдахгүй. |
| 3 | Pages | `cd frontend && npm run verify && npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main` | UI шинэ гарцуудыг дуудна. |

**Pages-ийн урхи:** «хамгийн сүүлийн production deployment ялна». Deploy-ийн дараа **ЗААВАЛ** шалга: локал `dist/index.html`-ийн hash-тай asset нэрийг `https://mgl-design-system.pages.dev/`-тэй тулга, мөн `npx -y wrangler@latest pages deployment list --project-name mgl-design-system`-ийн эхний мөр чиний commit мөн эсэхийг хар.

### Дараа нь юу ирэх вэ

Энэ ажил дуусмагц **Track 1B-ийн үлдсэн бүх зүйл утга агуулна**:
- `pull_and_retrain.py --publish` эцэст нь бодит `production.json` бичнэ (одоо файл байхгүй);
- dataset/model хувилбарлалт, golden eval нь хянагдсан мөр дээр тогтоно;
- **Энэ ажлын ӨМНӨ шинэ capture surface барих нь утгагүй** — хэн ч шошголохгүй мөр л нэмнэ.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

- [ ] `backend/migrations/0201_*.sql` нэмэгдсэн; бүх `ALTER` файлын эхэнд; `CREATE INDEX` бүр `IF NOT EXISTS`-тэй; `ADD COLUMN` дээр `CHECK` **байхгүй**; `CREATE TRIGGER` / `CREATE VIEW` / `GENERATED ALWAYS` / `json_extract` **байхгүй**.
- [ ] `PRAGMA table_info(assistant_logs)` нь `review_status`, `reviewed_by`, `reviewed_at`, `review_note` баганыг харуулна.
- [ ] `PRAGMA table_info(assistant_examples)` нь `source_log_id`, `reviewed_at` баганыг харуулна.
- [ ] `SELECT COUNT(*) FROM assistant_logs WHERE curated = 1 AND review_status IS NULL` → **0** (нөхөн бөглөлт ажилласан).
- [ ] `POST /api/revit/assistant/examples` нь `source`-гүй жишээг **400**-аар татгалзана; `source:'usage'` + `log_id`-гүй бол **400**; `source:'manual'` бол зөвшөөрнө.
- [ ] Дэвшүүлсний дараа: `assistant_logs.review_status = 'promoted'`, `reviewed_by` = хянагчийн `id`, `reviewed_at` NULL БИШ; холбогдох `assistant_examples.source_log_id` = тэр бүртгэлийн `id`.
- [ ] Татгалзсаны дараа: `review_status = 'rejected'`, `review_note` хадгалагдсан, **`assistant_examples`-д мөр НЭМЭГДЭЭГҮЙ**, мөр дараалалд дахин ГАРАХГҮЙ.
- [ ] Нэг мөрийг **хоёр дахь удаа** хянах оролдлого эхний шийдвэрийг **дарж бичихгүй** (`AND review_status IS NULL`).
- [ ] `engineer` эсвэл `architect` дүртэй хэрэглэгч `GET /api/revit/assistant/pending` дуудвал **403 `{"error":"Хандах эрхгүй"}`**.
- [ ] `client` эсвэл `worker` дүртэй хэрэглэгч дуудвал **403** (`requireRole(...REVIT_ROLES)` / `workerScope`).
- [ ] `/app/admin/assistant` нь `lazy()`-ээр импортлогдсон (`grep -c "lazy(" frontend/src/app/routes.tsx` тоо 1-ээр өссөн).
- [ ] Хуудасны таб нь `useTabParam`-аар удирдагдана; `frontend/src/features/revit-assistant/` дотор табыг `useState`-ээр барьсан газар **байхгүй**.
- [ ] `?tab=reviewed` гэсэн URL-аар шууд орход тэр таб нээгдэнэ.
- [ ] Хайлтын мөрөнд «шошго» / «курац» / «curate» гэж бичихэд хуудас олдоно; хэсгийн `id` нь `sec-`-ээр эхэлж, `scroll-mt-24`-тэй.
- [ ] `mn.json` ба `en.json`-ийн түлхүүрийн тоо **тэнцүү** (өмнө нь 4754 = 4754).
- [ ] Дарааллын эрэмбэ: `feedback_note`-той мөр эхэнд, дараа нь `corrected`, дараа нь `feedback = -1`, дараа нь `decided_by = 'fallback'` — SQL-ийн `ORDER BY CASE` **өөрчлөгдөөгүй**.
- [ ] `cd backend && npx tsc --noEmit` — цэвэр (эсвэл алдаа зөвхөн хөндөөгүй файлууд дээр, тэр тохиолдолд хэрэглэгчид мэдэгдсэн).
- [ ] `cd frontend && npm run verify` — амжилттай.
- [ ] `git status` дээр **зөвхөн** §0-д жагсаасан файлууд өөрчлөгдсөн.

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- 0. Хамрах хүрээ ---
git status --porcelain

# --- 1. Одоогийн байдлыг ДАХИН батал (эхлэхээс өмнө) ---
sed -n 1857,1970p backend/src/routes/revit.ts
grep -rn "assistant/pending\|assistant/examples" frontend/src/   # → ГАРАЛТ БАЙХГҮЙ байх ёстой
ls revit-mcp/training/data/production.json                        # → No such file
ls backend/migrations | tail -3                                   # → 0201 чөлөөтэй эсэх

# --- 2. Migration-ийг ЛОКАЛД эхлээд ---
cd backend
npm run db:migrate:all:local
npx wrangler d1 execute mgl-progress-db-v3 --local --config wrangler.toml \
  --command "PRAGMA table_info(assistant_logs);"
npx wrangler d1 execute mgl-progress-db-v3 --local --config wrangler.toml \
  --command "PRAGMA table_info(assistant_examples);"
npx wrangler d1 execute mgl-progress-db-v3 --local --config wrangler.toml \
  --command "SELECT COUNT(*) FROM assistant_logs WHERE curated=1 AND review_status IS NULL;"

# --- 3. Typecheck + тест ---
cd backend  && npx tsc --noEmit && npm test
cd frontend && npm run verify            # tsc -b --force + check-contrast + check:notes + vite build
node frontend/scripts/nav-matrix.mjs     # дүр→sidebar матриц — шинэ мөр зөв эрхтэй эсэх

# --- 4. i18n зөрүү ---
node -e "const a=require('./frontend/src/shared/i18n/mn.json'),b=require('./frontend/src/shared/i18n/en.json');
const f=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?f(v,p+k+'.'):[p+k]);
const A=new Set(f(a)),B=new Set(f(b));
console.log('mn only:',[...A].filter(x=>!B.has(x)));
console.log('en only:',[...B].filter(x=>!A.has(x)));"

# --- 5. Deploy (ДАРААЛЛААР!) ---
cd backend  && npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml
cd backend  && npx wrangler deploy --config wrangler.toml
cd frontend && npm run build && npx -y wrangler@latest pages deploy dist --project-name mgl-design-system --branch main
npx -y wrangler@latest pages deployment list --project-name mgl-design-system | head -3

# --- 6. Deploy-ийн дараах хяналт ---
cd backend
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT review_status, COUNT(*) FROM assistant_logs GROUP BY 1;"
npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
  --command "SELECT source, COUNT(*) AS n, SUM(source_log_id IS NOT NULL) AS linked FROM assistant_examples GROUP BY 1;"
```

Гараар шалгах (403 хаалга) — `engineer` токеноор:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $ENGINEER_JWT" \
  https://mgl-progress-api.mglenc-design.workers.dev/api/revit/assistant/pending   # → 403
```

---

## 8. ROLLBACK

### Frontend (хамгийн хялбар, эрсдэлгүй)
Өмнөх commit-оос `npm run build` → `pages deploy`. Шинэ хуудас алга болно, өөр юу ч эвдрэхгүй; backend-ийн шинэ гарцууд зүгээр л дуудагдахгүй.

### Worker
Өмнөх commit-оос `npx wrangler deploy --config wrangler.toml`. Шинэ багана DB дээр үлдэнэ (унших код байхгүй болно — асуудалгүй). `POST /assistant/examples`-ийн «source заавал» шалгалт буцна; 0201-ээс хойш дэвшүүлсэн мөрүүд `source_log_id`-тэй хэвээр үлдэх бөгөөд зөрчил үүсгэхгүй.

### Migration 0201 — **буцаах migration БИЧИХГҮЙ**

| Хийх | Хийхгүй |
|---|---|
| Багануудыг **байгаа хэвээр орхи**. Тэд `NULL` анхдагчтай, ямар ч хуучин кодыг эвдэхгүй (репод `accent_color`, `tv_kiosk`, `model_xkt_url`, `repair_projects.rate_multiplier` гэсэн дөрвөн ижил үлдэгдэл багана бий). | `ALTER TABLE … DROP COLUMN` — SQLite-д хүснэгтийн rebuild шаардана. `assistant_logs` нь `users`-ийн CASCADE хүүхэд; rebuild-ыг `migrations apply`-аар хийвэл транзакцид cascade **АЖИЛЛАЖ**, өгөгдөл алдагдана. |
| Өгөгдлийг буцаах шаардлагатай бол **ШИНЭ дугаартай** (`0202_…`) файл бичиж `UPDATE assistant_logs SET review_status = NULL, reviewed_by = NULL, reviewed_at = NULL, review_note = NULL;` гэж хий. | `0201`-ийг **ЗАСАХГҮЙ**. Хэрэглэсэн файлыг засах нь продакшнд чимээгүй no-op. |
| `0201` дундуур унасан бол: `d1_migrations`-д бүртгэгдсэн эсэхийг шалгаад, **ҮЛДСЭН statement-ийг ЗӨВХӨН шинэ дугаартай файлаар** нөх. | Гараар `d1 execute`-ээр нөхөж, `d1_migrations`-ыг тэнцүүлэхгүй орхих — өмнө нь бүртгэлийн зөрүү үүсгэж байсан зам. |

### Мэдээллийн алдагдал
Энэ ажил ямар ч мөр устгахгүй. Хамгийн муу тохиолдолд `review_status` буруу утгатай мөр үүсэх бөгөөд `UPDATE`-ээр засагдана.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

### А. ЭЗНЭЭС (репогоос гарахгүй шийдвэр)

1. **Хэн курац хийх эрхтэй вэ?**
   Одоо `revit.ts:1865` ба `:1902` хоёул `isManager()` = **`admin` ЭСВЭЛ `senior`**. Энэ нь зориулсан хүрээнээс **өргөн байж магадгүй**: репогийн бусад газарт `requireManager` нь багийн гишүүнчлэлийг огт шалгадаггүй тул **ямар ч senior** аль ч зүйлийг батлах эрхтэй байдаг. Сургалтын өгөгдөл нь бүтээгдэхүүний цөм тул хамрах хүрээ илүү нарийн байх шаардлагатай байж болно.
   - Сонголт 1: одоогийн хэвээр (`admin` + `senior`).
   - Сонголт 2: зөвхөн `admin`.
   - Сонголт 3: `admin` + нэрлэсэн цөөн `senior` (шинэ `app_settings` түлхүүр эсвэл `users` дээрх туг — **нэмэлт ажил**).
   Шийдвэр нь backend-ийн gate БА `NAV_ITEMS[].roles` хоёуланд нэг зэрэг тусна.

2. **Дөрвөн нүдний дүрэм — хянагч ӨӨРИЙНХӨӨ бичвэрийг баталгаажуулж болох уу?**
   ~49 ажилтны цөөн хэд нь `senior`; тэд өөрсдөө Revit туслах ашигладаг. Өөрийн 👎-ээ өөрөө «зөв» гэж дэвшүүлэх нь корпусыг өрөөсгөл болгож болно. Хэрэгжүүлэлт нь §3.4-ийн ганц мөр (`AND user_id <> ?`), гэхдээ **энэ нь бүтээгдэхүүний шийдвэр**: жижиг багт дарааллыг гацаах эрсдэлтэй (тухайн мөрийг хянах өөр хүн байхгүй байж болно). Зөөлөн хувилбар: хориглохгүй, зөвхөн UI дээр сануулга.

3. **Хадгалах хугацаа.** `0195`-ийн коммент: «шошголж `assistant_examples` руу шилжсэн мөрийг 90 хоногийн дараа цэвэрлэж болно (одоохондоо автомат цэвэрлэгээ БАЙХГҮЙ — гараар)». **`rejected` мөрүүд цэвэрлэгдэх үү?** Санал: ҮГҮЙ — татгалзлын шалтгаан өөрөө үнэ цэнтэй өгөгдөл. Эзний батламж хэрэгтэй.

4. **Нэр томьёо.** UI дээр «дэвшүүлэх / татгалзах»-ыг монголоор яаж нэрлэх вэ (ж: «Сургалтад авах» / «Хасах»)? `mn.json`-ийн түлхүүрийн нэршилд шууд нөлөөлнө.

### Б. ПРОДАКШН АСУУЛГААР ТОДРУУЛАХ (кодоос гарахгүй)

Эдгээрийг **эхлэхээс өмнө** ажиллуулж, хариуг брифийн эзэнд буцаа:

```sql
-- Хэдэн бүртгэл цугларсан бэ, аль нь хянагдаагүй вэ?
SELECT curated, COUNT(*) FROM assistant_logs GROUP BY 1;

-- Дарааллын эрэмбийн бодит хуваарилалт — UI-д ямар нүүр хамгийн чухал вэ?
SELECT
  SUM(feedback_note IS NOT NULL)          AS with_note,
  SUM(corrected IS NOT NULL)              AS corrected,
  SUM(feedback = -1)                      AS thumbs_down,
  SUM(decided_by = 'fallback')            AS fallback,
  COUNT(*)                                AS total
FROM assistant_logs WHERE curated = 0;

-- ⚠️ ХАМГИЙН ЧУХАЛ: `assistant_examples` руу бичдэг код репод БАЙХГҮЙ.
-- Хүснэгт үнэхээр ХООСОН уу?  Хоосон бол `GET /assistant/export` хоосон
-- буцааж байсан гэсэн үг — өөрөөр хэлбэл нийлүүлэгдсэн модель 100%
-- синтетик өгөгдөл дээр сургагдсан.
SELECT source, COUNT(*) FROM assistant_examples GROUP BY 1;

-- Хэдэн хүн туслахыг бодитоор ашиглаж байна вэ?  (0 эсвэл маш бага бол
-- UI-аас өмнө ХЭРЭГЛЭЭГ нэмэх нь илүү эрэмбэтэй байж магадгүй — эзэнд мэдэгд.)
SELECT COUNT(DISTINCT user_id) AS users, MIN(created_at), MAX(created_at)
FROM assistant_logs;

-- Идэвхтэй модель байгаа юу, ямар корпусаас гарсан бэ?
SELECT version, example_count, accuracy, created_at
FROM assistant_models WHERE is_active = 1;
```

### В. КОДООС ГАРСАН, ГЭХДЭЭ ЗӨРЧИЛТЭЙ ЗҮЙЛС (шийдвэр хэрэгтэй)

| Асуудал | Одоогийн байдал | Санал |
|---|---|---|
| Nav мөрийн `module` | `/api/revit` нь backend дээр **`progress`** модульд (`lib/modules.ts:223`), гэхдээ семантикийн хувьд `ai` эсвэл `revit` илүү тохирно | `module: 'progress'` (backend-тэй тааруулах). Өөрчлөх бол `backend/src/lib/modules.ts` + `frontend/src/shared/config/modules.ts` **хоёуланг** нэг PR-д. |
| `assistant.min_confidence` (0.45) ба `assistant.logging` тохиргоо | `app_settings`-д байгаа (0195-ийн төгсгөл), **UI ОГТ БАЙХГҮЙ** (`SettingsPage.tsx`-д нэг ч дурдлага алга) | Энэ хуудсанд «зөвхөн харуулах» байдлаар үзүүлэх нь ашигтай. Засварлах UI нь **тусдаа ажил** — `min_confidence`-ийг одоогоор ХЭН Ч УНШДАГГҮЙ (add-in эмхэтгэлийн үед `IntentRouter.MinConfidence` авдаг, 0195-ийн коммент үүнийг ил бичсэн). |
| `GET /assistant/export`-д `source_log_id` нэмэх үү | Одоо буцаадаггүй | **Одоохондоо ҮГҮЙ.** `pull_and_retrain.py:71-75` талбаруудыг ил жагсаадаг тул эвдрэхгүй, гэхдээ шаардлагагүй өөрчлөлт. Track 1B-ийн dataset lineage хэсэгт хамт хийнэ. |
| `assistant_examples.note` багана | 0195-д «юу яагаад хасагдсаныг мэдэх» гэж зориулсан, **бичигддэггүй** | Дэвшүүлэхэд хянагчийн тайлбарыг энд бичиж болно — эзний шийдвэрээр. Энэ брифийн заавал биш хэсэг. |
