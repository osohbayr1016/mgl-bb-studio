# 1B-2-event-ingest — Event ingest маршрут, бичигч сан, bind тест

> **Track:** 1B — ӨГӨГДЛИЙН БҮРЭН БҮТЭН БАЙДАЛ (DATA INTEGRITY)
> **Хамаарал (depends on):** **1B-1** — `learning_events` схем нь ЭНЭ ажлаас ӨМНӨ, ТУСДАА deploy-оор production-д хэрэглэгдсэн байх ЁСТОЙ
> **Блоклож буй (blocks):** 1B-3 (provenance/review lifecycle), 1B-4 (dataset + model versioning), 1B-5 (golden eval), 1C-* (latency instrumentation нь энэ ledger дээр суудаг)
> **Хөндөх файлууд:** `backend/src/lib/learningEvents.ts` (ШИНЭ) · `backend/src/lib/learningEvents.test.ts` (ШИНЭ) · `backend/src/routes/learning.ts` (ШИНЭ) · `backend/src/index.ts` (2 мөр) · `backend/src/lib/modules.ts` (4 мөр) · `backend/scripts/check-learning-events.mjs` (ШИНЭ) · `backend/package.json` (1 мөр)
> **Deploy тоо:** **1** (энэ ажлын хувьд). Гэхдээ 1B-1-ийн migration нь ӨМНӨХ, ТУСДАА deploy байна → нийт гинж = 2.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ.** Дээрх «Хөндөх файлууд» жагсаалтаас ГАДУУР нэг ч файл үүсгэх, засах, устгахгүй. Энэ сесси нь backend-ийн route + lib + тест л бичнэ. **Frontend-д юу ч хийхгүй. C# add-in-д юу ч хийхгүй. Migration бичихгүй** (доорх §5-ын нэг тодорхой нөхцлөөс бусад тохиолдолд).

**Бусад агентуудтай зэрэг ажиллах.** Энэ репод олон хөгжүүлэгч/агент ЗЭРЭГ ажилладаг. Тиймээс working tree-д тухайн мөчид бусдын дуусаагүй, магадгүй **эмхэтгэгдэхгүй** өөрчлөлт байж болно.

- Ажлын хүрээнээсээ ГАРАХГҮЙ. Хамааралгүй файлыг «засах», reformat хийх, буцаах, цэвэрлэх ХОРИОТОЙ — тэр нь бараг гарцаагүй өөр агентын дуусаагүй ажил.
- `git restore`, `git checkout --`, `git stash`, файл устгах, өөрийн засаагүй файлыг `git add`/commit хийх **ХЭЗЭЭ Ч ҮГҮЙ**.
- **Бүтэн build унасан нь автоматаар чинийх биш.** `tsc --noEmit` нь бүх аппыг эмхэтгэдэг тул чиний хөндөөгүй файл дээр унаж болно. Алдаанууд зөвхөн хамааралгүй файлд байгааг батал, дараа нь эзэнд нь МЭДЭГД — бүү хөө.
- **Одоогийн baseline (2026-08-27-нд ЭНЭ СЕССИЙН ХЭМЖИЛТ):** `cd backend && npx tsc --noEmit` → **exit 0, алдаагүй**. `cd backend && npm test` → **221/221 pass, 17 тест файл**. Тиймээс ямар ч улаан бол чинийх, эсвэл өөр агентын амьд WIP.

**Deploy хийж болох уу?** **ҮГҮЙ — эзний ил зөвшөөрөлгүйгээр deploy ХИЙХГҮЙ.** Энэ бол production-д ажилтны зан төлөвийн бүртгэл эхлүүлэх өөрчлөлт; §9-ийн нууцлал/зөвшилцлийн асуултууд хаагдтал deploy болохгүй. Код бичиж, тест ногоон болгож, зогсоно.

**ХЭЗЭЭ Ч БҮҮ ХИЙ (програм даяарх дүрэм):**
- `verifyToken` эсвэл `authMiddleware`-ийг `purpose === 'mcp'`-ийг `/api/*` дээр ТАТГАЛЗАХ болгож ЧАНГАЛАХГҮЙ. Add-in нь REST дуудлага БҮРИЙГ тэр токеноор баталгаажуулдаг ба refresh урсгал БАЙХГҮЙ. Энэ бол алсаас сэргээх боломжгүй ЦОРЫН ГАНЦ өөрчлөлт: ~20 ПК, `Install.bat`, Revit хаалттай байх шаардлагатай.
- Шинэ багана нь түүнийг УНШИХ кодоос **хатуу ӨМНӨХ** deploy-д гарсан байх ёстой.

---

## 1. КОНТЕКСТ

### 1.1 Систем (хүйтэн сессид хангалттай хэмжээгээр)

| Давхарга | Тайлбар |
|---|---|
| `backend/` | Cloudflare Worker. Hono нь `@cloudflare/workers-oauth-provider`-т **ороосон** — `index.ts`-ийн default export нь провайдер, Hono нь түүний `defaultHandler`. D1 (SQLite) `DB` · R2 `MEDIA_BUCKET` (**нийтийн, authless**) / `MEETING_BUCKET` (хувийн) · KV `OAUTH_KV` · Durable Object `MCP_OBJECT` → `MglMcpAgent`. |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages, төсөл **`mgl-design-system`** (`--project-name mgl-design-system`-ийг ил дамжуул). **Энэ ажилд хамаарахгүй.** |
| `revit-mcp/addin/` | Revit 2024–2027 add-in, C#/WPF, in-process, ~16k мөр / 47 файл, **тест ТЭГ**, ажилтны ПК дээр **авто-шинэчлэл БАЙХГҮЙ**. |
| `revit-mcp/training/`, `server/`, `agent/` | Python сургалтын дамжуулга, MCP гүүр, бие даасан локал агент. |
| Хэмжээ | ~49 идэвхтэй мэдлэгийн ажилтан. Production D1 ≈ 45 MB, 114 хүснэгт; хамгийн том нь `progress_entries` ≈ 8,062 мөр. *(Энэ гурван тоо аудитаас ирсэн — энэ сессид production-д хандаж БАТАЛГААЖУУЛААГҮЙ; §9-ийг үз.)* |

**Программын гурван зам:** **1A** production safety (эхэлж явна; AI-г бүрэн унтраасан ч production аюулгүй байх), **1B** data integrity (энэ), **1C** measurement (250 ms бол шаардлага БИШ — хэн ч хэмжээгүй хэмжигдэхүүн). **Track C** future AI (typed BIM intent, дүрмийн хөдөлгүүр, multimodal) — хараахан хийгээгүй.

### 1.2 Яагаад энэ ажил байх ёстой вэ

Одоо add-in-ий сурах давхарга **`assistant_logs`** (migration `0195_assistant_learning.sql`) дээр суудаг. Тэр хүснэгт нь **нэг мөр = нэг асуулт** гэсэн хавтгай загвартай:

- Үйл явдал хоорондын **удам (lineage)** БАЙХГҮЙ — «энэ засвар нь ЭНЭ таамаглалын үр дүн» гэдгийг илэрхийлэх талбар алга.
- **Гарал үүсэл (provenance)** БАЙХГҮЙ — аль загварын хувилбар, аль add-in build, аль prompt хувилбар үүсгэсэн нь `model_version` талбараар (add-in талд бий) хэсэгчлэн л мэдэгдэнэ.
- **Дараалал / сесс** БАЙХГҮЙ — Revit 1.2 GB `.rvt` дээр унахад аль үйл явдал хүрч, аль нь хүрээгүйг мэдэх арга алга.
- **Хүлээгдэж буй хэлбэрийн зарлал БАЙХГҮЙ** — үйл явдал юу агуулах ёстойгоо зарладаггүй тул **дагалдах мөр алдагдсан** тохиолдол нь **дагалдах мөр анхнаасаа байгаагүй** тохиолдлоос ЯЛГАГДАХГҮЙ. Dataset үүсгэгч нь төгс хүчинтэй харагддаг, гэтэл чимээгүйхэн БУРУУ сургалтын жишээ гаргана. **Энэ бол энэ баримт бичгийн хамгийн чухал зөв байдлын зүйл.**

1B-1 нь `learning_events` схемийг гаргана. **1B-2 (энэ) нь тэр хүснэгтэд бичих ЦОРЫН ГАНЦ гарцыг барина** — нэг бичигч сан, нэг багцалсан ingest маршрут, нэг resume гарц, нэг artefact гарц, эдгээрийн bind арифметикийг ижил commit-д барих unit тест.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх мөр бүрийг энэ сесси файлыг нээж баталгаажуулсан (2026-08-27). Аудитаас ирсэн боловч **БУРУУ** байсан зүйлийг ⚠️-ээр тэмдэглэв.

### 2.1 `routes/revit.ts` — багцалсан upsert (хуулах ёстой хэв маяг)

`backend/src/routes/revit.ts:1658` — `POST /api/revit/assistant/logs`.

Багцын хязгаар (`backend/src/routes/revit.ts:1628`, `:1630`):
```ts
const MAX_LOG_BATCH = 200;
const MAX_LOG_TEXT = 500;
```
`:1666-1668`:
```ts
  if (body.entries.length > MAX_LOG_BATCH) {
    return c.json({ error: `Too many entries (max ${MAX_LOG_BATCH})` }, 413);
  }
```

**Унтраах товч** (`:1670-1677`) — deploy-гүйгээр ingest-ийг зогсоох. Хуулах ёстой:
```ts
  const enabled = await db
    .prepare("SELECT value FROM app_settings WHERE key = 'assistant.logging'")
    .first<{ value: string }>()
    .catch(() => null);
  if ((enabled?.value ?? 'on').toLowerCase() === 'off') {
    return c.json({ accepted: 0, logging: 'off' });
  }
```

**⚠️ ЖИВЭЭД БУЙ (LIVE DRIFT) №1 — bind тайлбар нь тогтмолтойгоо зөрчилдөж байна.** `backend/src/routes/revit.ts:1703-1707`:
```ts
  // 12 bind/мөр → floor(100/12) = 8 мөр/statement (D1-ийн 100 bind хязгаар).
  // ⚠️ БАГАНА НЭМБЭЛ ЭНЭ ТООГ ЗАСАХ ЁСТОЙ.  D1-ийн нэг statement 100
  // bind-аар хязгаарлагдана; 13 × 7 = 91 ≤ 100.
  const BINDS = 13;
  const PER = Math.floor(100 / BINDS);
```
Эхний мөр «12 bind → 8 мөр» гэж хэлж байгаа боловч тогтмол нь **13**, `PER` нь **7**. Хоёр дахь мөр нь зөв (13 × 7 = 91). Өөрөөр хэлбэл тайлбар нь ӨӨРТӨӨ зөрчилтэй: migration `0200_assistant_feedback_note.sql` `feedback_note` багана нэмэхэд тогтмол болон хоёр дахь мөр шинэчлэгдсэн ч эхний мөр хуучраад үлдсэн. **Энэ нь §3.6-гийн unit тест яагаад СОНГОЛТ БИШ болохын ЯГ шалтгаан:** тайлбар нь хуучирдаг, тест нь хуучирдаггүй.

**⚠️ ЖИВЭЭД БУЙ №2 — маршрутын толгойн тайлбар буруу SQL нэрлэдэг.** `:1651-1657`:
```
 * ⚠️ Add-in локалд бичээд БАГЦААР илгээдэг тул давхардал БОЛОМЖТОЙ
 * (сүлжээ тасарч дахин илгээх).  `INSERT OR IGNORE` + өвөрмөц индекс
 * түүнийг барина — клиент id-г түлхүүр болгоно.
```
Гэтэл бодит statement (`:1722-1733`) нь `INSERT OR IGNORE` **БИШ**, харин зорилтот upsert:
```sql
INSERT INTO assistant_logs
  (user_id, project_id, doc_uid, revit_version, text,
   predicted, confidence, decided_by, corrected, feedback, acted, client_id,
   feedback_note)
VALUES ${values}
ON CONFLICT (user_id, client_id) DO UPDATE SET
  corrected     = COALESCE(excluded.corrected, assistant_logs.corrected),
  feedback      = COALESCE(excluded.feedback,  assistant_logs.feedback),
  acted         = MAX(excluded.acted, assistant_logs.acted),
  feedback_note = COALESCE(excluded.feedback_note, assistant_logs.feedback_note)
```
Түлхүүр индекс: `0195_assistant_learning.sql` → `CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_logs_client ON assistant_logs(user_id, client_id);`

**Chunk давталт** (`:1709-1719`) — хуулах загвар:
```ts
  for (let i = 0; i < rows.length; i += PER) {
    const chunk = rows.slice(i, i + PER);
    const values = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const binds: unknown[] = [];
    for (const r of chunk) { binds.push(/* … 13 утга … */); }
    stmts.push(db.prepare(`…VALUES ${values}…`).bind(...binds));
  }
  await db.batch(stmts);
  return c.json({ accepted: rows.length });
```
**⚠️ Анхаар:** `accepted: rows.length` нь **шүүлтээс ҮЛДСЭН** мөрийн тоо бөгөөд DB-д ҮНЭХЭЭР шинээр орсон мөрийн тоо БИШ. Upsert тул ялгаа нь ач холбогдолгүй. **Бидний шинэ маршрутад ялгаа нь ЧУХАЛ** (§3.3-ыг үз).

Өөр хоёр bind тогтмол:
- `backend/src/routes/revit.ts:58-59` — `const BINDS_PER_BINDING_ROW = 13;` / `const BINDING_ROWS_PER_STATEMENT = Math.floor(100 / BINDS_PER_BINDING_ROW); // = 7`. Тайлбар (`:53-57`) нь `qto.ts`-ийн «4 fact × 21 bind»-ыг ил иш татдаг. **Энэ хосын тайлбар нь ЗӨВ** — зөрсөн нь зөвхөн `:1703`.
- `backend/src/routes/revit.ts:75` — `const IDS_PER_STATEMENT = 50;` (`IN (...)`-д хэдэн id хийхийг зөвшөөрөх). §3.3-ын урьдчилсан шалгалт үүнийг хуулна.
- `backend/src/routes/revit.ts:85-88` — `str(v, max)` туслах, `MAX_STR = 256` (`:50`). Мөрийг **чимээгүй тасалдаг**, татгалздаггүй.

### 2.2 `routes/qto.ts` — 100-bind таазны гар тохируулга

`backend/src/routes/qto.ts:832`:
```ts
  // Fact insert — 4 мөр/statement (21 bind × 4 = 84 ≤ D1-ийн 100 bind хязгаар).
```
`:835` — `const FACT_SQL_ONE = '(?, ?, … ?)'` нь **21** тэмдэгттэй; `:844-870` баганын жагсаалт бас 21. `:860-871` дэх давталт `i += 4`.

`:874`:
```ts
  // 6 bind/мөр × 16 = 96 ≤ 100.
```
`:879-887` — `for (let i = 0; i < roomRows.length; i += 16)`, `ROOM_SQL_ONE = '(?, ?, ?, ?, ?, ?)'`.

**Энэ хоёр тайлбар ЗӨВ.** Гэхдээ хоёулаа зөвхөн ТАЙЛБАР — ямар ч тест барихгүй. `qto.ts` дээр `qto_facts`-д багана нэмэхэд 21 → 22 болж 4 × 22 = 88 хэвээр өнгөрөх ч, 5 болгож нэмэгдүүлбэл чимээгүй унана.

### 2.3 `lib/pushSweep.ts` — БҮРЭН Record идиом (event-type union-ы загвар)

**⚠️ Тодорхойлолтын АЛДАА: `CATEGORY_OF` нь `webPush.ts`-д БАЙХГҮЙ.** `grep -rn "CATEGORY_OF" backend/src/` нь тодорхойлолтыг **`backend/src/lib/pushSweep.ts:53`**-д олдог. `webPush.test.ts` гэдэг нэртэй тест файл байдаг ч тэр нь `./pushSweep.ts`-ээс импортолдог (`backend/src/lib/webPush.test.ts:28`). `modules.ts:157` болон `orgConfig.ts:274` дэх тайлбарууд бас «`webPush.ts`-ийн `CATEGORY_OF`» гэж БУРУУ иш татдаг — репод тархсан ижил алдаа.

`backend/src/lib/pushSweep.ts:45-53`:
```ts
/**
 * Мэдэгдлийн төрөл → хэрэглэгчид харагдах ангилал.
 *
 * ⚠️ `Record<NotificationType, PushCategory>` тэмдэглэгээ нь ЗОРИУДААР:
 *    types.ts-д 15 дахь төрөл нэмэхэд энэ файл ЭВДЭРЧ, шинэ төрөл ямар
 *    ангилалд хамаарахыг шийдэхээс өөр аргагүй болно (чимээгүй алдагдахгүй).
 */
export const CATEGORY_OF: Record<NotificationType, PushCategory> = {
```
Мөн `backend/src/lib/pushSweep.ts:23-35` — `PUSH_CATEGORIES` нь `as const` массив, `PushCategory` нь `(typeof PUSH_CATEGORIES)[number]`, `DEFAULT_PUSH_PREFS` нь `Record<PushCategory, boolean>`. **Энэ гурвалсан бүтэц (as const массив → union төрөл → БҮРЭН Record) нь §3.2-ын event-type union-ы хуулах загвар.**

### 2.4 Модулийн лиценз (`lib/modules.ts`) — БҮРЭН Record, compile-ээр албадсан

- `backend/src/lib/modules.ts:27-47` — `export const MODULE_IDS = [ 'core', 'attendance', … ] as const;` (одоо **19** модуль), `:49` `export type ModuleId = (typeof MODULE_IDS)[number];`
- `:52` — `export const MODULE_LABELS: Record<ModuleId, { mn: string; en: string }>` → **шинэ `ModuleId` нэмэхэд label заавал нэмэгдэнэ, эс бөгөөс compile унана.** ✅ баталгаажсан.
- `:95-149` — `export const API_PREFIXES = [ … ] as const;` (одоо **53** угтвар), `:151` `export type ApiPrefix`.
- `:161-166` тайлбар + `:167` — `export const MODULE_OF: Record<ApiPrefix, ModuleId>` → **шинэ угтвар зарлаад модуль оноохгүй бол compile унана.** ✅ баталгаажсан. (Тайлбар нь өөрөө `webPush.ts`-ийн `CATEGORY_OF`-ыг иш татдаг — §2.3-ын алдааг үз.)
- `backend/src/lib/modules.test.ts:39-58` — `API_PREFIXES` нь `index.ts`-ийн `app.route('…')` дуудлагуудтай **ЯГ** таарахыг шалгадаг. Mount хийгээд `modules.ts`-д нэмэхээ мартвал **тест унана**.
- `:245-250` — `moduleOfPath()` нь СЕГМЕНТИЙН хилээр таардаг: `path === p || path.startsWith(`${p}/`)`.

**⚠️ Одоо `/api/revit` нь `progress` модульд харьяалагдана** (`modules.ts:216-220`):
```ts
  // Revit-ээс явц илгээх гарц нь `progress` модулийн нэг хэсэг — Revit
  // нэмэлт татах хуудастай (`revit`) ХАМААРАЛГҮЙ.  Progress модулийг
  // унтраасан tenant-д Revit push мөн унтарна, энэ нь зөв.
  '/api/revit': 'progress',
  '/api/revit-addin': 'revit',
```
**Энэ бол яг тэр урхи, руу нь орж болохгүй.** Хэрэв ingest-ийг `/api/revit/*` дор өлгөвөл, «явцын хяналт» худалдаж авсан үйлчлүүлэгч бүр ажилтныхаа зан төлөвийн бүртгэлийг нэмэлт худалдан авалтгүй, тусад нь зөвшилцөл ярилцахгүйгээр ЧИМЭЭГҮЙ авна. §3.8-ыг үз.

**⚠️ Жижиг живээ:** `modules.ts:260-268` дэх `parseModules`-ийн тайлбар «`ENABLED_MODULES` env … эсвэл `app_settings`-ийн `modules.enabled`» гэдэг. Бодит нэрс нь `backend/src/lib/orgConfig.ts:264` дэх **`ORG_MODULES_ENABLED`** env ба `orgConfig.ts:299` дэх **`org.modules_enabled`** app_settings түлхүүр. Энэ ажилд нөлөөгүй, гэхдээ хуучирсан гэдгийг мэд.

### 2.5 Middleware гинж (`index.ts`) — `/mcp` яг ЮУГ тойрдог вэ

`backend/src/index.ts`:
```
:144  app.use('/api/*', authMiddleware);
:147  app.use('/api/*', workerScopeGuard);
:150  app.use('/api/*', entitlementGuard);
:152+ app.route('/api/…', …)   ← 58 mount
:193  app.route('/media', media);     ← ROOT, authMiddleware хүрэхгүй
:261  app.route('/', authorizeRoutes);
:267  const mcpStreamable = MglMcpAgent.serve('/mcp');
:268  const mcpSse = MglMcpAgent.serveSSE('/sse');
:275  const oauthProvider = new OAuthProvider<Env>({
:276    apiHandlers: { '/mcp': mcpStreamable, '/sse': mcpSse },
:280    defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) } …
```

Гурван нэхэмжлэл, тус бүрийг баталгаажуулав:

| Нэхэмжлэл | Баталгаа | Итгэл |
|---|---|---|
| **`/mcp` нь `workerScopeGuard`-ыг тойрдог** | `index.ts:147` — guard нь `'/api/*'` дээр Л суусан. `/mcp` нь `apiHandlers`-т байгаа root зам, Hono-д огт хүрдэггүй. `backend/src/lib/workerScope.ts:19-32` нь цагаан жагсаалт (`/api/auth`, `/api/attendance`, `/api/attendance-confirmations`, `/api/leaves`, `/api/notifications`, `/api/push`, `/api/upload`) — `/mcp` тэнд шалгагдах ч үгүй. | **БАТАЛГААЖСАН** |
| **`/mcp` нь `entitlementGuard`-ыг тойрдог** | `index.ts:150` — мөн `'/api/*'`. `backend/src/lib/entitlement.ts:29-33` дэх ӨӨРИЙНХ нь толгойн тайлбар үүнийг ил хэлдэг: «⚠️ ЭНЭ ХААЛТ `/api/*`-д Л СУУНА. `/mcp` нь OAuth provider-ийн эзэмшдэг root зам тул энд ХАМРАГДАХГҮЙ — `workerScope`-ийн адил цоорхой.» | **БАТАЛГААЖСАН** |
| **`/mcp` нь tenant-ийн DB солилтыг тойрдог** | Хоёр хэсэгтэй. **(а) Токены tenant хил ХЭРЭГЖДЭГГҮЙ — БАТАЛГААЖСАН.** `tid` тулгалт нь ЗӨВХӨН `backend/src/middleware/auth.ts:79-88`-д байдаг ба тэр нь `/api/*` middleware. `/mcp`-ийн токен шийдвэрлэгч `index.ts:292-296` (`resolveExternalToken`) нь `verifyToken`-оос өөр юу ч шалгадаггүй: `tid` ч, `purpose` ч биш. **(б) DO-ийн `env` нь солигдоогүй байх магадлалтай.** `index.ts:321-355` дэх `fetch` нь `tenantEnv(env, tenant)`-ээр ШИНЭ объект (`lib/tenants.ts:183-205`, эх env-ийг мутацлахгүй, `{...bag, DB: db}`) үүсгээд `oauthProvider.fetch(request, scoped, ctx)` дуудна. Гэвч `MglMcpAgent` нь Durable Object (`backend/src/mcp/MglMcpAgent.ts:44` — `extends McpAgent<Env, …>`) ба tool бүр `this.env`-ийг хүлээн авдаг (`:57`, `:62`, `:87`, `:96`, … нийт 25 дуудлага). DO-ийн `this.env` нь ажиллах орчны binding хүснэгтээс ирдэг бөгөөд хүсэлтийн scope-той объект БИШ → `this.env.DB` нь **үндсэн `DB`**. | (а) **БАТАЛГААЖСАН** · (б) **ӨНДӨР МАГАДЛАЛТАЙ, ГАР ТУРШИЛТААР батал** — §7-ыг үз |

**Дүгнэлт:** энэ track-ийн юуг ч `/mcp`-ээр гаргахгүй. Шалтгааныг **маршрутын файлын толгойд** бич, зөвхөн энэ баримт бичигт биш.

### 2.6 Токен — `purpose` шалгагддаггүй (програм даяарх дүрмийн ҮНДЭС)

`backend/src/lib/jwt.ts` `verifyToken` нь **гарын үсэг + `exp`-ийг Л** шалгана:
```ts
    const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(signingInput));
    if (!valid) return null;
    …
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
```
`alg` шалгалт байхгүй, `purpose` шалгалт байхгүй, хүчингүй болгох жагсаалт байхгүй. `backend/src/middleware/auth.ts:52` нь үүнийг шууд дуудаад `:90` дээр `c.set('user', payload)` хийдэг — `purpose` хаана ч харьцуулагддаггүй.

Add-in нь `POST /api/auth/mcp-token`-оор (`backend/src/routes/auth.ts:71-79`, `{ sub, role, purpose: 'mcp' }`, ~1 жил) токен авч, **REST дуудлага БҮРД** түүнийг ашигладаг — `revit-mcp/addin/ApiClient.cs` дотор 8 газар `req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);` (мөр 148, 183, 230, 253, 292, 313, …). Тиймээс `purpose === 'mcp'`-ийг `/api/*` дээр татгалзвал **бүх add-in нэг зэрэг үхнэ**.

### 2.7 Одоо байгаа idempotency идиомууд (хуулах)

| Хэлбэр | Байршил |
|---|---|
| `UNIQUE(user_id, draft_uid)` + `INSERT` | `backend/migrations/0189_revit_submissions.sql:64-65` — `CREATE UNIQUE INDEX IF NOT EXISTS idx_revit_submissions_draft ON revit_submissions(user_id, draft_uid);` |
| `INSERT OR IGNORE` + `UNIQUE(user_id, turn_id)` | `backend/src/routes/revit.ts:1562` + `backend/migrations/0193_revit_agent_turns.sql:44-45` |
| Хариу буцсаны ДАРАА аудит бичих | `backend/src/routes/revit.ts:1559-1561` — `c.executionCtx.waitUntil(db.prepare(…).run().catch(() => undefined))` |
| Role gate маршрутын толгойд | `backend/src/routes/revit.ts:79` — `revit.use('*', requireRole(...REVIT_ROLES));`, `:43` — `const REVIT_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];` |

### 2.8 R2 — хувийн эсэх

- `backend/src/index.ts:193` — `app.route('/media', media);` нь **root** дээр, `authMiddleware`-ийн ГАДНА.
- `backend/src/routes/media.ts:55-56` — `media.get('/:key', …)`, `const key = c.req.param('key');` → **нэг сегментийн** таалт, **эрх шалгахгүй**. `MEDIA_BUCKET`-д тавьсан объект бүр түлхүүрээ мэдэх хэн бүхэнд нээлттэй.
- `backend/src/routes/upload.ts:13-16` — `pickBucket()` нь `MEETING_BUCKET`-ыг хувийн сонголт болгож харуулна; `:47-50` — «Private bucket → no public URL».
- `backend/src/routes/revitAddin.ts:29-51` — gated татах загвар: `/api/…` доторх маршрут R2-оос уншиж, `Cache-Control: private, no-store`-той stream хийдэг. **Artefact татахад ЯГ ЭНЭ загварыг хуул** — шинэ гарын үсэгтэй токен ангилал үүсгэхгүй.

### 2.9 Migration folder-ийн одоогийн байдал (баталгаажсан тоо)

```
$ ls backend/migrations | wc -l          → 190
$ ls backend/migrations | tail -1        → 0200_assistant_feedback_note.sql
$ grep -ril 'CREATE TRIGGER'   backend/migrations | wc -l   → 0
$ grep -ril 'CREATE VIEW'      backend/migrations | wc -l   → 0
$ grep -ril 'GENERATED ALWAYS' backend/migrations | wc -l   → 0
$ grep -ril 'json_extract'     backend/migrations | wc -l   → 0
$ grep -ril 'json_valid'       backend/migrations | wc -l   → 1
```
**⚠️ `json_valid`-ийн ЦОРЫН ГАНЦ хэрэглээ** нь `backend/migrations/0075_landing_blocks.sql:375` бөгөөд тэр нь `WHERE` нөхцөлд (`OR NOT json_valid(p.gallery_urls)`), **CHECK constraint-д БИШ**. Өөрөөр хэлбэл **`CHECK (json_valid(...))` нь энэ репод НЭГ Ч УДАА production D1 дээр ажиллаж байгаагүй.** §3.1 болон §9-ийг үз.

### 2.10 Add-in талын одоогийн бүртгэл

- `revit-mcp/addin/AssistantLog.cs:175` — `Id = Guid.NewGuid().ToString("N").Substring(0, 16)` — **бүртгэл тус бүрд** санамсаргүй id.
- `revit-mcp/addin/AssistantLog.cs:46-63` дэх тайлбар: локалд эхлээд бичээд дараа нь багцаар илгээдэг; интернэтгүй үед ч ажиллана; алдааг чимээгүй залгина.
- **`grep -rn "SessionId\|sessionId\|session_id" revit-mcp/addin/` → эх кодонд ТААРАЛТ БАЙХГҮЙ** (зөвхөн `bin/` доторх binary DLL таарна). Өөрөөр хэлбэл **add-in-д сессийн ойлголт ОДООГООР БАЙХГҮЙ.** §9-ийг үз — энэ бол блоклогч асуулт.
- Одоо байгаа санамсаргүй id-ууд: `AgentChat.cs:305` `runId`, `AgentChat.cs:426` `turn_id`, `QtoExtractor.cs:247` `PushId`, `RevitApi.cs:473` `NewDraftUid()`.

---

## 3. ХИЙХ АЖИЛ

> **Урьдчилсан нөхцөл:** 1B-1-ийн migration production-д хэрэглэгдсэн байх ёстой. Эхлэхийн өмнө `ls backend/migrations | tail -3` ажиллуулж 1B-1-ийн файлыг ол, `PRAGMA table_info(learning_events)`-оор production дээрх БОДИТ баганын нэрсийг ав. Доорх нэрс нь 1B-1-ийн ГЭРЭЭ; зөрвөл 1B-1-ийнх нь ялна, харин доорх ХАРИЛЦАН ХАМААРАЛ (invariants) хэвээр байх ёстой.

### 3.0 1B-1-ээс шаардах гэрээ (эхлэхийн өмнө тулга)

`learning_events` хүснэгт нь дараах зүйлсийг агуулсан байх ёстой. **Байхгүй бол ЗОГС** — SQLite-д одоо байгаа хүснэгтэд `CHECK` нэмэх нь хүснэгтийг бүтнээр нь дахин барихыг шаардана, тэр нь 1B-2-ын хамрах хүрээнээс гадуур.

| Багана | Төрөл / хязгаарлалт | Яагаад |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `client_uid` | `TEXT NOT NULL` + **UNIQUE индекс ГАНЦААРАА** | Дахин илгээлтийн түлхүүр |
| `session_uid` | `TEXT NOT NULL` | Resume-ийн түлхүүр |
| `seq` | `INTEGER NOT NULL CHECK (seq >= 0)` + **UNIQUE(session_uid, seq)** | Дараалал |
| `user_id` | `INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` | |
| `project_id` | `INTEGER REFERENCES projects(id) ON DELETE SET NULL` | |
| `event_type` | `TEXT NOT NULL` | §3.2-ын union |
| `occurred_at` | `TEXT NOT NULL` | Клиентийн цаг (ISO-8601, UTC) |
| `received_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | **Серверийн цаг. bind = 0.** |
| `schema_version` | `INTEGER NOT NULL` | |
| `producer` | `TEXT NOT NULL` | add-in build id |
| `revit_version` | `TEXT` | |
| `doc_uid` | `TEXT` | |
| `payload_json` | `TEXT NOT NULL` + **`CHECK (json_valid(payload_json))`** | §3.1 |
| `payload_contract` | `TEXT NOT NULL` + **`CHECK (payload_contract GLOB 'v[0-9]*:*')`** | §3.1 |
| `expected_parts` | `TEXT NOT NULL DEFAULT '[]'` + `CHECK (json_valid(expected_parts))` | §3.4 |
| `present_parts` | `TEXT NOT NULL DEFAULT '[]'` + `CHECK (json_valid(present_parts))` | §3.4 |
| `expected_count` | `INTEGER NOT NULL DEFAULT 0` | §3.4 — индекслэгдэх тоолуур |
| `present_count` | `INTEGER NOT NULL DEFAULT 0` + `CHECK (present_count >= 0 AND present_count <= expected_count)` | §3.4 |
| `parent_client_uid` | `TEXT` | Удам (lineage) |
| `artifact_sha256` | `TEXT` | §3.7 |

Мөн шаардлагатай индексүүд (бүгд `IF NOT EXISTS`):
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_events_uid  ON learning_events(client_uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_learning_events_seq  ON learning_events(session_uid, seq);
CREATE INDEX IF NOT EXISTS idx_learning_events_session     ON learning_events(session_uid, seq DESC);
CREATE INDEX IF NOT EXISTS idx_learning_events_user_time   ON learning_events(user_id, received_at DESC);
-- Эрүүл мэндийн хэмжүүр — хэсэгчилсэн индекс тул бараг зай эзлэхгүй.
CREATE INDEX IF NOT EXISTS idx_learning_events_unsatisfied
  ON learning_events(received_at) WHERE present_count < expected_count;
```

**⚠️ Хоёр UNIQUE индекс нь ТУСДАА байх ЁСТОЙ.** `UNIQUE(client_uid, session_uid, seq)` шиг нэгтгэсэн индекс нь §3.3-ын логикийг бүхэлд нь устгана.

### 3.1 ЦОРЫН ГАНЦ бичигч — `backend/src/lib/learningEvents.ts`

`learning_events`-д хийх **БҮХ** `INSERT` нь энэ файлаар дамжина. Экспортлох гадаргуу:

```ts
/** D1-ийн 100-bind таазны ГАР ТООЦОО.  §3.6-гийн тест үүнийг барина. */
export const EVENT_INSERT_COLUMNS = [
  'client_uid', 'session_uid', 'seq', 'user_id', 'project_id',
  'event_type', 'occurred_at', 'schema_version', 'producer', 'revit_version',
  'doc_uid', 'payload_json', 'payload_contract', 'expected_parts',
  'expected_count', 'parent_client_uid', 'artifact_sha256',
] as const;
// ⚠️ `received_at` нь ЭНД БАЙХГҮЙ — DEFAULT (datetime('now')).  bind = 0.
// ⚠️ `present_parts` / `present_count` нь эхний бичилтэд ҮРГЭЛЖ хоосон —
//    DEFAULT-аар орно.  bind = 0.  Дагалдах хэсэг ирэхэд UPDATE-ээр л өснө.

export const EVENT_BIND_COLUMNS = EVENT_INSERT_COLUMNS.length; // = 17
export const EVENT_VALUES_TUPLE = `(${EVENT_INSERT_COLUMNS.map(() => '?').join(', ')})`;

/**
 * НЭГ БАГАНЫН НӨӨЦ.  `BINDS`-ээр биш `BINDS + 1`-ээр хуваана: ингэснээр
 * маргааш нэг багана нэмэхэд статемент ЧИМЭЭГҮЙ унахгүй.
 *   одоо:  5 × 17 = 85 ≤ 100
 *   +1 багана: 5 × 18 = 90 ≤ 100  ✔
 */
export const EVENT_ROWS_PER_STATEMENT = Math.floor(100 / (EVENT_BIND_COLUMNS + 1)); // = 5
```

Гол функц — **ЦОРЫН ГАНЦ бичих гарц**:

```ts
export interface WriteResult {
  accepted: number;      // ҮНЭХЭЭР шинээр орсон мөр (meta.changes-ийн нийлбэр)
  duplicates: number;    // client_uid давхардсан → чимээгүй алгассан (ХЭВИЙН)
}

export async function writeLearningEvents(
  db: D1Database,
  rows: readonly LearningEventRow[],
): Promise<WriteResult> {
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += EVENT_ROWS_PER_STATEMENT) {
    const chunk = rows.slice(i, i + EVENT_ROWS_PER_STATEMENT);
    const values = chunk.map(() => EVENT_VALUES_TUPLE).join(', ');
    stmts.push(
      db.prepare(
        `INSERT INTO learning_events (${EVENT_INSERT_COLUMNS.join(', ')})
         VALUES ${values}
         ON CONFLICT (client_uid) DO NOTHING`,
      ).bind(...chunk.flatMap(bindEvent)),
    );
  }
  const res = await db.batch(stmts);
  const accepted = res.reduce((n, r) => n + Number(r.meta?.changes ?? 0), 0);
  return { accepted, duplicates: rows.length - accepted };
}
```

**⚠️ ТОДОРХОЙЛОЛТЫН ЗАСВАР — `INSERT OR IGNORE` нь СОНГОМОЛ БАЙЖ ЧАДАХГҮЙ.**
Тодорхойлолт нь «`INSERT OR IGNORE` on the client-uid unique index ONLY» гэсэн. SQLite-д `INSERT OR IGNORE` нь **АЛЬ Ч** өвөрмөц хязгаарлалтын мөргөлдөөнийг залгидаг — зорилтот индексийг заах боломжгүй. Хүссэн зан төлөвийг илэрхийлэх ЦОРЫН ГАНЦ бүтэц нь **`ON CONFLICT (client_uid) DO NOTHING`** — энэ нь `client_uid` дээрх мөргөлдөөнийг залгиж, `(session_uid, seq)` дээрх мөргөлдөөнийг **ХЭВЭЭР ШИДНЭ**. Дээрх кодыг тэгж бичсэн. Санаа нь тодорхойлолтынхтой яг ижил; синтакс нь өөр.

**ЯАГААД хоёулан дээр залгиж БОЛОХГҮЙ вэ.** Хоёр индекс дээр залгивал ялгаж болдоггүй хоёр тохиолдол нэг болно:

| Тохиолдол | `client_uid` | `(session_uid, seq)` | Утга |
|---|---|---|---|
| **Дахин илгээлт** (ХЭВИЙН) | давхардсан | давхардсан | Сүлжээ тасарсан, add-in дахин илгээв. Чимээгүй алгас. |
| **Клиентийн АЛДАА** (ЭМГЭГ) | **ШИНЭ** | давхардсан | Сесс тоолуур тэглэгдсэн / хоёр thread нэг тоолуур хуваалцсан / сесс дахин ашиглагдсан. **Өгөгдлийн бүрэн бүтэн байдал эвдэрсэн.** |

Хоёулан дээр `OR IGNORE` тавьбал хоёр дахь тохиолдол чимээгүй хаягдаж, `accepted` тоо нь **цорын ганц дохио** болно — тэгээд тэр дохио «сүлжээ муу байсан» гэж уншигдана. Түүхийн нэг хэсэг ул мөргүй алга болно. Тиймээс: `client_uid` дээр залгина, `(session_uid, seq)` дээр ИЛ гаргана.

**Grep баталгаа (нэг файлын дүрэм).** `backend/scripts/check-learning-events.mjs`:

```js
// `learning_events`-д INSERT хийх нь ЗӨВХӨН lib/learningEvents.ts-д зөвшөөрөгдөнө.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ALLOWED = 'src/lib/learningEvents.ts';
const RE = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+learning_events/i;
const bad = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.ts$/.test(p)) continue;
    if (p.replace(/\\/g, '/').endsWith(ALLOWED)) continue;
    if (RE.test(readFileSync(p, 'utf8'))) bad.push(p);
  }
})('src');
if (bad.length) {
  console.error(`learning_events-д ГАДНААС INSERT хийсэн файл:\n  ${bad.join('\n  ')}`);
  console.error(`Бүх бичилт ${ALLOWED}-ийн writeLearningEvents()-ээр дамжина.`);
  process.exit(1);
}
console.log('✔ learning_events-ийн бичих гарц нэг файлд хаалттай');
```

Үүнийг ХОЁР газраас дуудна:
1. `backend/package.json`-д шинэ script: `"verify": "tsc --noEmit && node --test \"src/**/*.test.ts\" && node scripts/check-learning-events.mjs"` — backend-д одоо `verify` script БАЙХГҮЙ (баталгаажсан), тиймээс энэ нь шинэ.
2. **Мөн `node --test`-ээр ажилладаг тест болгож** — `backend/src/lib/learningEvents.test.ts` дотор ижил шалгалтыг давтаж бич. Учир нь `npm test` нь одоо БОДИТООР ажилладаг цорын ганц гарц (221/221).

**⚠️ ҮНЭНЧ БАЙ: lint нь ажиллах үеийн хяналт БИШ.** Энэ репод build-ийн сахилга бат ил зөөлөн:
- Хоёр GitHub workflow (`.github/workflows/deploy-backend.yml`, `deploy-frontend.yml`) хоёулаа **амжилтгүй болдог**; deploy нь локал wrangler-ээр л явдаг.
- **`wrangler deploy` нь typecheck ХИЙХГҮЙ** (esbuild), тиймээс `tsc` унасан ч worker гарна.
- Frontend `npm run lint` нь ~139 өмнөх react-hooks алдаатай, `lint:tokens` нь 1358 зөрчилтэй — өөрөөр хэлбэл «lint ногоон байх» нь энэ репод хэвшил БИШ.

Тиймээс grep баталгаа нь **зөвлөх**. Жинхэнэ хяналт нь DB түвшний хоёр хямд хаалт:
- `CHECK (json_valid(payload_json))` — эвдэрсэн JSON нь **INSERT-ийн үед** унана, dataset үүсгэх үед биш.
- `CHECK (payload_contract GLOB 'v[0-9]*:*')` — гэрээний тэмдэглэгээгүй мөр огт орж чадахгүй. `GLOB` нь SQLite-ийн цөмийн оператор, өргөтгөл шаардахгүй.

**⚠️ Аль аль нь энэ репод УРЬД НЬ ХЭРЭГЛЭГДЭЭГҮЙ CHECK хэлбэр** (§2.9). `json_valid` нь 190 migration дотор ганцхан удаа, тэр нь `WHERE`-д. Тиймээс **1B-1 нь эдгээрийг хаях D1 дээр урьдчилан батлах ЁСТОЙ** (§7).

### 3.2 Event-type union — БҮРЭН Record (`pushSweep.ts`-ийн заль)

`backend/src/lib/learningEvents.ts` дотор, `lib/pushSweep.ts:23-53`-ийн бүтцийг ЯГ хуулж:

```ts
export const LEARNING_EVENT_TYPES = [
  'intent_predicted',     // ангилагч санаа таасан
  'intent_corrected',     // хүн зассан
  'tool_invoked',         // Revit tool дуудагдсан
  'tool_result',          // үр дүн (амжилт/алдаа)
  'model_output',         // LLM-ийн хариу
  'user_feedback',        // 👍 / 👎 / чөлөөт тайлбар
  'selection_snapshot',   // сонгосон элементийн ТООЛУУР (агуулга БИШ)
  'session_start',
  'session_end',
] as const;
export type LearningEventType = (typeof LEARNING_EVENT_TYPES)[number];

/** Төрөл бүрийн payload — ялгаварлагдсан нэгдэл (discriminated union). */
export type LearningPayload =
  | { type: 'intent_predicted'; text: string; predicted: string | null; confidence: number; decided_by: string; model_version: string | null }
  | { type: 'intent_corrected'; corrected: string; from_client_uid: string }
  /* … төрөл бүрд нэг гишүүн … */;

/**
 * Төрөл → тухайн үйл явдал ЗААВАЛ зарлах ёстой дагалдах хэсгүүд.
 *
 * ⚠️ `Record<LearningEventType, …>` тэмдэглэгээ нь ЗОРИУДААР: 10 дахь төрөл
 *    нэмэхэд ЭНЭ ФАЙЛ ЭВДЭРЧ, шинэ төрөл ямар хэлбэртэй болохыг шийдэхээс
 *    өөр аргагүй болно (чимээгүй алдагдахгүй).  `lib/pushSweep.ts:53`-ийн
 *    `CATEGORY_OF`-той ЯГ ИЖИЛ заль.
 */
export const REQUIRED_PARTS_OF: Record<LearningEventType, readonly string[]> = {
  intent_predicted:   ['prompt'],
  intent_corrected:   ['prompt', 'correction'],
  tool_invoked:       ['args'],
  tool_result:        ['result'],
  model_output:       ['prompt', 'output'],
  user_feedback:      [],
  selection_snapshot: ['counts'],
  session_start:      [],
  session_end:        ['summary'],
};

/** Гэрээний тэмдэглэгээ — DB-ийн GLOB CHECK-тэй таарна. */
export const CONTRACT_VERSION = 1;
export function contractTag(t: LearningEventType): string {
  const parts = REQUIRED_PARTS_OF[t];
  return `v${CONTRACT_VERSION}:${t}${parts.length ? '+' + parts.join('+') : ''}`;
}
```

**⚠️ `webPush.ts` БИШ.** Тодорхойлолт нь энэ зальг `backend/src/lib/webPush.ts`-д байдаг гэсэн. Тэнд БАЙХГҮЙ — `backend/src/lib/pushSweep.ts:53`-д байгаа (`webPush.test.ts:28` нь `./pushSweep.ts`-ээс импортолдог). Тайлбар бичихдээ ЗӨВ файлыг иш тат; репод аль хэдийн гурван газар буруу иш татсан байна (`modules.ts:157`, `orgConfig.ts:274`, `webPush.test.ts:181`).

### 3.3 Багцалсан, хязгаартай POST ingest

`backend/src/routes/learning.ts`:

```ts
const learning = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Role gate — `routes/revit.ts:43,79`-тэй ИЖИЛ дөрвөн үүрэг.  `client` ба
// `worker` энд хүрэхгүй (`lib/workerScope.ts` нь хаалттай-анхдагч цагаан
// жагсаалт тул `/api/learning` түүнд автоматаар 403).
const LEARNING_ROLES: UserRole[] = ['engineer', 'architect', 'senior', 'admin'];
learning.use('*', requireRole(...LEARNING_ROLES));

const MAX_EVENT_BATCH = 200;   // `revit.ts:1628`-ийн MAX_LOG_BATCH-тай ижил
const MAX_PAYLOAD_BYTES = 16 * 1024;
const SEQ_CHECK_PER_STATEMENT = 50;  // `revit.ts:75`-ийн IDS_PER_STATEMENT
```

`POST /api/learning/events` урсгал:

1. **Унтраах товч.** `app_settings['learning.ingest']` ≠ `'off'` эсэхийг шалга (`revit.ts:1670-1677`-ийн хэв маяг). `'off'` бол `{ accepted: 0, ingest: 'off' }` буцаа — add-in дахин оролдох ёсгүй.
2. **Хэлбэр + хязгаар.** `entries` массив биш → 400. `> MAX_EVENT_BATCH` → 413. `event_type` нь `LEARNING_EVENT_TYPES`-д байхгүй → тэр мөрийг **хаяж, `rejected` тоолуурт нэм** (чимээгүй алгасахгүй). `payload_json` нь `MAX_PAYLOAD_BYTES`-ээс урт → тэр мөрийг хая. Мөр таслах (`str()`) нь **зөвхөн** богино метадата талбарт (`producer`, `revit_version`, `doc_uid`); payload-ыг ХЭЗЭЭ Ч чимээгүй бүү тас.
3. **Багц доторх дарааллын мөргөлдөөн.** `Map<`${session_uid}#${seq}`, client_uid>` барь. Ижил түлхүүр дээр ӨӨР `client_uid` тааралдвал → **409**.
4. **Багц ГАДНАХ дарааллын мөргөлдөөн (урьдчилсан шалгалт).** Сесс тус бүрээр `seq`-үүдийг `SEQ_CHECK_PER_STATEMENT`-ээр хэсэглэн:
   ```sql
   SELECT seq, client_uid FROM learning_events
    WHERE session_uid = ? AND seq IN (?, ?, …)
   ```
   (1 + 50 = 51 bind ≤ 100 ✔)
   - Байгаа `seq`, `client_uid` нь **ИЖИЛ** → **дахин илгээлт**, чимээгүй хая, `duplicates`++.
   - Байгаа `seq`, `client_uid` нь **ӨӨР** → **дарааллын мөргөлдөөн**.
5. **Мөргөлдөөн байвал БҮХ багцыг татгалза** — хэсэгчилсэн бичилт нь ул мөрийг улам бүрхэгдүүлнэ:
   ```ts
   return c.json({
     error: 'sequence_conflict',
     conflicts: conflicts.slice(0, 20),  // { session_uid, seq, existing_client_uid, incoming_client_uid }
     hint: 'Нэг session_uid дор ижил seq-д ӨӨР client_uid ирлээ — клиентийн тоолуур эвдэрсэн.',
   }, 409);
   ```
   Мөн `console.warn` бич (Workers лог) — энэ бол чимээгүй байх ЁСГҮЙ ангилал.
6. **Бичилт** — `writeLearningEvents()` (§3.1). Уралдааны эцсийн хамгаалалт нь `ON CONFLICT (client_uid) DO NOTHING`; урьдчилсан шалгалт ба бичилтийн хооронд шинэ `(session,seq)` мөргөлдөөн орж ирвэл `db.batch()` **шидэж**, бүх багц буцаана — яг хүссэн зан төлөв. `catch`-ыг `UNIQUE constraint failed: learning_events.session_uid` мөрөнд тааруулж 409 болгон буулга; бусад алдааг 500.
7. **Хариу:**
   ```ts
   return c.json({
     accepted,          // ҮНЭХЭЭР орсон (meta.changes-ийн нийлбэр)
     duplicates,        // дахин илгээлт — ХЭВИЙН
     rejected,          // хэлбэр/хэмжээ шалгалтад унасан — ХЭВИЙН БИШ
     last_seq_by_session, // { [session_uid]: number }
   });
   ```
   **`accepted` нь `rows.length` БИШ.** `revit.ts:1739` нь `rows.length` буцаадаг (upsert тул тэнд зөв). Энд `DO NOTHING` тул `meta.changes` нь ялгаатай — тэр ялгаа нь чухал дохио.

### 3.4 SATELLITE MASK — хүлээгдэж буй хэлбэрийн зарлал

**Энэ бол хамгийн чухал зөв байдлын зүйл.** Асуудлыг дахин: үйл явдал агуулах ёстой зүйлээ ЗАРЛАХГҮЙ бол, **алдагдсан дагалдах мөр** нь **анхнаасаа дагалдах мөргүй байсан** үйл явдлаас ялгагдахгүй. Dataset үүсгэгч нь төгс хүчинтэй харагддаг, гэтэл чимээгүйхэн БУРУУ сургалтын жишээ гаргана — тэр алдаа нь загварын нарийвчлалаар л илэрч, гэхдээ хэзээ ч оношлогдохгүй.

**Гурван дүрэм:**

**(а) ЭХНИЙ бичилт нь хэлбэрээ ЗАРЛАНА.**
`writeLearningEvents` нь `expected_parts` / `expected_count`-ыг дуудагчаас авахгүй — `REQUIRED_PARTS_OF[event_type]`-ээс **өөрөө ургуулна**. Клиент худал зарлаж чадахгүй:
```ts
function bindEvent(e: LearningEventRow): unknown[] {
  const required = REQUIRED_PARTS_OF[e.event_type];   // сервер талаас
  return [
    e.client_uid, e.session_uid, e.seq, e.user_id, e.project_id,
    e.event_type, e.occurred_at, e.schema_version, e.producer, e.revit_version,
    e.doc_uid, e.payload_json, contractTag(e.event_type),
    JSON.stringify(required), required.length,
    e.parent_client_uid, e.artifact_sha256,
  ];
}
```

**(б) Дагалдах хэсэг ирэхэд `present_*` өснө.**
`POST /api/learning/events/parts` (эсвэл дагалдах үйл явдал өөрөө `parent_client_uid`-аар ирнэ). Мөн `learningEvents.ts` дотор, идемпотент байдлаар:
```sql
UPDATE learning_events
   SET present_parts = ?,     -- нэгтгэсэн ОЛОНЛОГ, JS талд union хийсэн
       present_count = ?
 WHERE client_uid = ?
   AND ? <= expected_count    -- CHECK-ийг хэзээ ч зөрчихгүй
```
JS талд `present_parts`-ыг уншиж, шинэ хэсгийг union хийж, `expected_parts`-ийн дэд олонлог болгож ХЯЗГААРЛА (танихгүй хэсгийг хая), дараа нь бич. Ингэснээр `present_count <= expected_count` CHECK нь хэзээ ч унахгүй.

**(в) Dataset үүсгэгч нь хангагдаагүй үйл явдлыг ТАТГАЛЗАНА.**
1B-4-ийн dataset үүсгэгч нь **ЗААВАЛ** `WHERE present_count >= expected_count` шүүлт хийнэ. Энэ нь 1B-2-т биелдэггүй амлалт тул **`learningEvents.ts`-д тэр шүүлтийг экспортлосон тогтмол болгож** гарга, dataset үүсгэгч нь өөрөө SQL бичихгүй:
```ts
/** Dataset-д ОРОХ эрхтэй мөрийн ЦОРЫН ГАНЦ тодорхойлолт.  1B-4 үүнийг
 *  дуудна — өөрийн шүүлт бичихийг ХОРИГЛОНО. */
export const DATASET_ELIGIBLE_SQL = 'present_count >= expected_count';
```

**(г) Хангагдаагүйн тоог ЭРҮҮЛ МЭНДИЙН ХЭМЖҮҮР болгож ил гарга.**
`GET /api/learning/health` (**admin only** — `requireAdmin()`):
```sql
SELECT
  (SELECT COUNT(*) FROM learning_events)                                   AS total,
  (SELECT COUNT(*) FROM learning_events WHERE present_count < expected_count) AS unsatisfied,
  (SELECT COUNT(*) FROM learning_events
     WHERE present_count < expected_count
       AND received_at < datetime('now', '-1 hour'))                       AS unsatisfied_stale,
  (SELECT MAX(received_at) FROM learning_events)                           AS last_event_at
```
`idx_learning_events_unsatisfied` хэсэгчилсэн индекс тул хоёр, гурав дахь дэд асуулга бараг үнэгүй.

**Яагаад JSON биш, ТООЛУУР вэ.** `expected_parts` ⊄ `present_parts` гэсэн олонлогийн ялгааг SQL-д тооцоолохын тулд `json_each` эсвэл `json_extract` хэрэгтэй болно. Энэ репод **json функцийн CHECK/JOIN хэрэглээ тэг** (§2.9), тэгэхээр D1 дээр батлагдаагүй газар руу ороно. Хоёр `INTEGER` тоолуурын харьцуулалт нь индекслэгддэг, батлагдсан, хямд. JSON массивууд нь **алдаа оношлоход** үлдэнэ, хаалт болж ажиллахгүй.

### 3.5 Head / resume гарц

Revit нь 1.2 GB `.rvt` дээр унах нь тэр өдрүүдийн ХЭВИЙН төгсгөл. Add-in дахин асахдаа хаанаас үргэлжлүүлэхээ мэдэх ёстой.

```
GET /api/learning/events/head?session_uid=<uid>
GET /api/learning/events/head?session_uids=<uid1>,<uid2>,…   (дээд тал нь 20)
```

- **Зөвхөн ӨӨРИЙН сессийг** уншина: `WHERE user_id = ?` — `c.get('user').sub`. Өөр хүний сессийн толгойг уншуулах нь зан төлөвийн мэдээлэл алдагдах цоорхой.
- 20 × sessions + 1 user_id = 21 bind ≤ 100 ✔
```sql
SELECT session_uid,
       MAX(seq)            AS last_seq,
       COUNT(*)            AS accepted_count,
       MAX(received_at)    AS last_received_at
  FROM learning_events
 WHERE user_id = ? AND session_uid IN (?, ?, …)
 GROUP BY session_uid
```
- Мэдэгдэхгүй сесс → тэр түлхүүрийг хариунаас ОРХИ (`null` биш). Add-in нь «байхгүй = 0-оос эхэл» гэж уншина.
- Хариу: `{ heads: { [session_uid]: { last_seq, accepted_count, last_received_at } } }`
- **`MAX(seq)` нь «сүүлд хүлээн авсан» гэсэн үг, «завсаргүй» гэсэн үг БИШ.** Add-in нь `last_seq + 1`-ээс үргэлжлүүлж, локал дараалалдаа `> last_seq` бүхнийг дахин илгээнэ. `client_uid` нь давхардлыг барина. Энэ хосолмол байдлыг маршрутын тайлбарт ил бич.

### 3.6 BIND АРИФМЕТИК + ТЕСТ, ИЖИЛ COMMIT-Д

**Дүрэм:**
1. Bind хийгддэг баганыг ТООЛ. **Generated багана ТЭГ bind зарцуулна** (мөн `DEFAULT`-той серверийн талын багана ч тэр — `received_at`, `present_*`).
2. `rowsPerStatement = floor(100 / (bindColumns + 1))` — **нэг баганын нөөц** үлдээ.
3. Тогтмолыг statement-ийн ХАЖУУД тавь, өөр файлд биш.
4. Тогтмол нь `VALUES` цуваа-ны арностой ТЭНЦҮҮ гэдгийг **unit тест** бататга.

`backend/src/lib/learningEvents.test.ts` (`node --test`, `registerHooks`-ийн `.ts` шийдвэрлэгчтэй — `webPush.test.ts:12-20`, `modules.test.ts:13-20`-ийг хуул):

```ts
test('EVENT_VALUES_TUPLE-ийн арно нь EVENT_BIND_COLUMNS-тай ТЭНЦҮҮ', () => {
  const q = (EVENT_VALUES_TUPLE.match(/\?/g) ?? []).length;
  assert.equal(q, EVENT_BIND_COLUMNS,
    `VALUES цуваанд ${q} тэмдэгт, гэтэл EVENT_BIND_COLUMNS = ${EVENT_BIND_COLUMNS}`);
  assert.equal(EVENT_INSERT_COLUMNS.length, EVENT_BIND_COLUMNS);
});

test('нэг statement D1-ийн 100 bind таазыг давахгүй', () => {
  assert.ok(EVENT_ROWS_PER_STATEMENT >= 1, 'нэг мөр ч багтахгүй байна');
  assert.ok(EVENT_ROWS_PER_STATEMENT * EVENT_BIND_COLUMNS <= 100,
    `${EVENT_ROWS_PER_STATEMENT} × ${EVENT_BIND_COLUMNS} > 100`);
});

test('НЭГ БАГАНЫН НӨӨЦ хэвээр байна', () => {
  // Маргааш багана нэмэхэд ЧИМЭЭГҮЙ унахгүй байх баталгаа.
  assert.ok(EVENT_ROWS_PER_STATEMENT * (EVENT_BIND_COLUMNS + 1) <= 100,
    'нөөц алга — EVENT_ROWS_PER_STATEMENT-ийг бууруул');
});

test('INSERT баганын жагсаалт давхардаагүй', () => {
  assert.equal(new Set(EVENT_INSERT_COLUMNS).size, EVENT_INSERT_COLUMNS.length);
});

test('REQUIRED_PARTS_OF нь төрөл БҮРИЙГ хамарна', () => {
  for (const t of LEARNING_EVENT_TYPES) {
    assert.ok(Array.isArray(REQUIRED_PARTS_OF[t]), `${t} дутуу`);
  }
  assert.equal(Object.keys(REQUIRED_PARTS_OF).length, LEARNING_EVENT_TYPES.length);
});

test('contractTag нь DB-ийн GLOB CHECK-д таарна', () => {
  // CHECK (payload_contract GLOB 'v[0-9]*:*')
  for (const t of LEARNING_EVENT_TYPES) {
    assert.match(contractTag(t), /^v[0-9][^:]*:.+/);
  }
});
```

**Яагаад энэ тест СОНГОЛТ БИШ вэ.** `backend/src/routes/revit.ts:1703` дээр яг ийм тайлбар өнөөдөр production-д ХУДАЛ бичигдсэн байна: «12 bind/мөр → floor(100/12) = 8 мөр/statement», гэтэл хоёр мөрийн доор `const BINDS = 13; const PER = 7;`. Migration 0200 багана нэмэхэд хүн тогтмолыг зассан ч тайлбарын нэг мөрийг мартсан. Тайлбар хуучирдаг. Тест хуучирдаггүй. `routes/qto.ts:832` ба `:874` дэх хоёр тайлбар өнөөдөр ЗӨВ ч, тэднийг ч юу ч барихгүй.

### 3.7 Artefact upload — сервер тал sha256-г ДАХИН БОДНО

```
POST /api/learning/artifacts?sha256=<64 hex>&client_uid=<uid>&content_type=<mime>
```
Их бие нь түүхий байт (`c.req.arrayBuffer()`).

```ts
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;   // ⚠️ ШИЙДВЭР, олдсон хязгаар БИШ — §9

const declared = (c.req.query('sha256') ?? '').toLowerCase();
if (!/^[0-9a-f]{64}$/.test(declared)) return c.json({ error: 'bad_sha256' }, 400);

const bytes = new Uint8Array(await c.req.arrayBuffer());
if (bytes.byteLength === 0) return c.json({ error: 'empty_body' }, 400);
if (bytes.byteLength > MAX_ARTIFACT_BYTES) return c.json({ error: 'too_large' }, 413);

// ⚠️ СЕРВЕР ӨӨРӨӨ БОДНО.  Клиентийн зарласан утга бол ЗӨВХӨН нэхэмжлэл.
const digest = await crypto.subtle.digest('SHA-256', bytes);
const actual = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
if (actual !== declared) {
  return c.json({ error: 'sha256_mismatch', declared, actual }, 422);
}
```

- **`crypto.subtle.digest` нь `backend/src/` дотор одоогоор ХЭРЭГЛЭГДЭЭГҮЙ** (`grep -rn "crypto.subtle.digest" backend/src/` → тааралт байхгүй). `lib/jwt.ts` нь `importKey`/`sign`/`verify`-г ашигладаг тул WebCrypto боломжтой нь батлагдсан, гэхдээ `digest` нь шинэ гарц — тестээр батал.
- **R2 bucket: `MEETING_BUCKET` (ХУВИЙН), `MEDIA_BUCKET` ХЭЗЭЭ Ч ҮГҮЙ.** `index.ts:193` нь `/media`-г root дээр, auth-гүйгээр mount хийдэг ба `routes/media.ts:55-56` нь түлхүүрээр нь хэн ч уншиж болно. Artefact нь ажилтны загварын контекст агуулж болзошгүй.
- **Түлхүүр нь агуулгаар хаяглагдана:** `learning/${user.sub}/${actual}` — ижил байт дахин илгээхэд идемпотент, `client_uid` дахин ашиглагдсан ч байт хэзээ ч бүрхэгдэхгүй.
- Амжилттай бол `learning_events.artifact_sha256`-ыг `client_uid`-аар нь UPDATE хий (`learningEvents.ts`-ийн функцээр, маршрутаас шууд SQL бичихгүй) ба `present_parts`-д `'artifact'` нэм (§3.4б).
- **Татах нь gated маршрутаар:** `GET /api/learning/artifacts/:sha256` → `requireAdmin()`, `MEETING_BUCKET.get(key)`, `Cache-Control: private, no-store`. `routes/revitAddin.ts:29-51`-ийн загварыг хуул. **Шинэ гарын үсэгтэй токен ангилал БҮҮ үүсгэ** — `JWT_SECRET` аль хэдийн 5 ангиллын токен гарын үсэг зурдаг ба түүнийг эргүүлэх нь бүх сесс, суулгасан add-in бүрийг нэг зэрэг унагаана.

### 3.8 ЭРХИЙН БҮРТГЭЛ (entitlement) — ТУСДАА `ModuleId`

`backend/src/lib/modules.ts`-д **дөрвөн** мөр:

```ts
// 1) MODULE_IDS массивт (:27-47-ийн төгсгөлд)
  'learning',      // BIM-AI сургалтын өгөгдөл — үйл явдлын түүх, artefact

// 2) MODULE_LABELS-д (:52-72)  ← Record<ModuleId,…> тул ЭНЭ НЬ COMPILE-ЭЭР АЛБАДАГДАНА
  learning: { mn: 'Сургалтын өгөгдөл (BIM-AI)', en: 'BIM-AI learning data' },

// 3) API_PREFIXES массивт (:95-149), цагаан толгойн байрандаа
  '/api/learning',

// 4) MODULE_OF-д (:167-…)  ← Record<ApiPrefix,…> тул ЭНЭ НЬ ЧУ COMPILE-ЭЭР АЛБАДАГДАНА
  '/api/learning': 'learning',
```

Мөн `backend/src/index.ts`-д ХОЁР мөр:
```ts
import learning from './routes/learning';
…
// BIM-AI сургалтын үйл явдлын түүх.  ТУСДАА модуль — `progress`-ийн хэсэг БИШ.
app.route('/api/learning', learning);
```
`backend/src/lib/modules.test.ts:39-58` нь `index.ts`-ийн mount-уудыг `API_PREFIXES`-тэй тулгадаг тул хоёрын аль нэгийг мартвал **тест унана** (баталгаажсан).

**Compile-ээр албадагдаж байгааг баталгаажуулсан:** `modules.ts:52` нь `Record<ModuleId, { mn: string; en: string }>`, `:167` нь `Record<ApiPrefix, ModuleId>` — хоёулаа БҮРЭН Record. ✅

**АРИЛЖААНЫ ШАЛТГААН — ил бич.** Компани энэ системийг өөр архитектурын фирмүүдэд зарах бодолтой. Хэрэв энэ чадварыг `progress` модульд (эсвэл одоо `progress`-т харьяалагддаг `/api/revit`-д) өлгөвөл, **«явцын хяналт» худалдаж авсан үйлчлүүлэгч бүр ажилтныхаа зан төлөвийн бүртгэлийг нэмэлт худалдан авалтгүй, тусад нь зөвшилцөл ярилцахгүйгээр чимээгүй авна.** Тусдаа `ModuleId` нь техникийн цэвэрлэгээ биш — тэр нь тухайн чадварыг унтраалгатай, гэрээгээр асаадаг, ярианы сэдэв болгодог. `modules.ts:15-16`-ийн өөрийнх нь толгойн тайлбар үүнийг хэлдэг: «⚠️ ЭНЭ ФАЙЛ ЛИЦЕНЗИЙН ХИЛ. Шинэ модуль нэмэх … нь худалдааны шийдвэр — код цэвэрлэгээ БИШ.»

**Анхдагч зан төлөв өөрчлөгдөхгүй:** `lib/entitlement.ts:39` — `orgConfig().enabledModules` нь `null` бол guard юу ч хийхгүй. MGL-ийн одоогийн production-д `ORG_MODULES_ENABLED` тохируулаагүй → шинэ модуль нэмэх нь юуг ч хаахгүй.

### 3.9 Маршрутын файлын толгой — `/mcp`-ийн шалтгааныг ЭНД бич

`backend/src/routes/learning.ts`-ийн эхэнд, төлөвлөгөөнд ГАНЦХАН биш:

```ts
/**
 * BIM-AI СУРГАЛТЫН ҮЙЛ ЯВДЛЫН ЛЕДЖЕР — бичих гарц.
 *
 * ⚠️ ЭНЭ ГАДАРГУУГ `/mcp`-ЭЭР ХЭЗЭЭ Ч БҮҮ ГАРГА.  Ямар ч tool бүртгэхгүй,
 *    `mcp/tools/`-д twin бүү бич.  `/mcp` нь ГУРВАН хаалтыг ЗЭРЭГ тойрдог:
 *
 *    1. `workerScopeGuard` — `index.ts:147` дээр `'/api/*'`-д Л суудаг.
 *       `/mcp` нь OAuth провайдерын `apiHandlers`-т байгаа root зам тул
 *       Hono-д огт хүрдэггүй (`index.ts:276`).
 *    2. `entitlementGuard` — мөн `'/api/*'` (`index.ts:150`).  Тэр файлын
 *       өөрийнх нь толгой (`lib/entitlement.ts:29-33`) үүнийг ил хэлдэг.
 *       Өөрөөр хэлбэл модуль унтраасан tenant ч MCP-ээр хандана.
 *    3. Tenant-ийн хил — `tid` тулгалт нь ЗӨВХӨН `middleware/auth.ts:79-88`-д
 *       байна.  `/mcp`-ийн токен шийдвэрлэгч (`index.ts:292-296`,
 *       `resolveExternalToken`) нь `verifyToken`-оос өөр юу ч шалгадаггүй —
 *       `tid` ч, `purpose` ч биш.  Нэмээд `MglMcpAgent` бол Durable Object
 *       (`mcp/MglMcpAgent.ts:44`), tool бүр `this.env`-ийг авдаг — тэр нь
 *       `index.ts:341`-ийн `tenantEnv()` үүсгэсэн хүсэлтийн scope-той объект
 *       БИШ.
 *
 *    Гурвуулаа НЭГ ЗЭРЭГ.  Ажилтны зан төлөвийн бүртгэлийн хувьд энэ нь
 *    хүлээн зөвшөөрөгдөхгүй.
 */
```

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Зүйл | Одоогийн зан төлөв | Хөндвөл юу эвдрэх вэ |
|---|---|---|
| `verifyToken` / `authMiddleware` дээр `purpose` шалгалт | `lib/jwt.ts` нь гарын үсэг + `exp`-ийг Л шалгана; `middleware/auth.ts:52,90` нь `purpose`-ыг харьцуулдаггүй | Add-in нь ~1 жилийн `purpose:'mcp'` токеноор REST дуудлага БҮРИЙГ хийдэг (`ApiClient.cs`, 8 газар). Чангалбал **~20 ПК дээр бүх add-in нэг зэрэг үхнэ**, refresh урсгал байхгүй, алсаас засах арга алга — `Install.bat`, Revit хаалттай. **АЛСААС СЭРГЭЭХ БОЛОМЖГҮЙ ЦОРЫН ГАНЦ ӨӨРЧЛӨЛТ.** |
| `routes/revit.ts` `/assistant/logs` | 0195/0200-ийн `assistant_logs`-д upsert | Шинэ ledger нь түүнийг ОРЛОХГҮЙ. Хоёулаа зэрэг ажиллана. Хуучныг устгах нь тусдаа ажил (1B-3+), энэ сессид ҮГҮЙ. |
| `routes/revit.ts:58-59, 75, 1706` bind тогтмолууд | 13/7, 50, 13/7 | Хөндөхгүй. Тэдгээрийг ЗАСАХ нь энэ сессийн хамрах хүрээнд БИШ (`:1703`-ийн худал тайлбар ч мөн адил — өөр агентын файл байж болно; §9-д мэдэгд). |
| `MODULE_OF['/api/revit'] = 'progress'` | `modules.ts:216-220` | Хөндөхгүй. Явцын push нь үнэхээр progress-ийн хэсэг. Шинэ ingest нь ТУСДАА угтвартай. |
| `lib/entitlement.ts`-ийн «тохируулаагүй бол хязгаарлалтгүй» | `:39` `if (!enabled) return next();` | Хөндөхгүй. MGL-ийн production-д `ORG_MODULES_ENABLED` тохируулаагүй; шинэ модуль нэмэх нь ямар ч функцийг хаах ЁСГҮЙ. |
| `/media/:key` нь нэг сегментийн таалт | `routes/media.ts:55-56` | Энэ нь нэгэн зэрэг **аюулгүй байдлын хяналт** (`authorSupervision.ts`-ийн `isMediaUrl` түүнээс хамаардаг). Бүү өргөтгө. Artefact-ыг `MEEETING_BUCKET`-д тавь. |
| `JWT_SECRET` | 5 ангиллын токен, 17 дуудлагын цэгээс гарын үсэг зурдаг | Эргүүлбэл бүх сесс, суулгасан add-in бүр, нислэг дэх хэвлэлтийн ажил бүр НЭГ ЗЭРЭГ үхнэ. Artefact татахад шинэ гарын үсэгтэй токен ангилал бүү нэм. |
| `[[migrations]]` DO шошго v1–v5 | `wrangler.toml` | Гурав нь устгасан классын булш. Бүү устга, бүү дараалал соль. |
| `users` / `projects` хүснэгт | `users`-д cascade хүүхэд ОЛОН (migration эх кодын grep: `REFERENCES users(id) … ON DELETE CASCADE` **33** тааралт, `projects` дээр **41** — CLAUDE.md 19/33 гэдэг, аудит 27/38 гэсэн; **гурвуулаа зөрж байна**, учир нь grep нь хүснэгт дахин барихад давхардсан тодорхойлолтыг тоолдог) | Аль ч тоо байсан дүгнэлт нэг: `wrangler d1 migrations apply` нь файл бүрийг ГҮЙЛГЭЭНД ороодог ба тэнд `ON DELETE CASCADE` **АЖИЛЛАДАГ**. Эдгээрийн аль нэгийг `migrations apply`-аар ХЭЗЭЭ Ч дахин бүү бари. Бодит тоог production дээр `PRAGMA foreign_key_list`-ээр авах ёстой (§9). |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### 5.1 Урьдчилсан нөхцөл

1. **1B-1 (схем) production-д хэрэглэгдсэн байх ЁСТОЙ.** Программ даяарх дүрэм: *шинэ багана нь түүнийг УНШИХ кодоос хатуу ӨМНӨХ deploy-д гарна.* Хэрэглэгдсэн эсэхийг батал:
   ```
   cd backend && npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml \
     --command "SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 5"
   ```
2. **1B-1-д §3.0-ийн БҮХ `CHECK` байх ёстой.** SQLite-д одоо байгаа хүснэгтэд `CHECK` НЭМЭХ боломжгүй — хүснэгтийг бүтнээр нь дахин барина. Хэрэв 1B-1 CHECK-гүйгээр аль хэдийн ГАРСАН бол: **зогсоод эзэнд мэдэгд.** `learning_events` нь `users`-ийн cascade хүүхэд тул түүнийг дахин барих нь энгийн зүйл биш (`0136_worker_role.sql`, `0142_assessment_multi_senior.sql`-ийн «path B» гарын авлагыг үз) — тэр нь 1B-2-ын ажил БИШ.
3. **1B-1 `json_valid` CHECK-ийг хаях D1 дээр УРЬДЧИЛАН баталсан байх ёстой** (§2.9, §7).

### 5.2 Deploy дараалал

| # | Юу | Хэн | Тэмдэглэл |
|---|---|---|---|
| 0 | `learning_events` + индекс + CHECK migration | **1B-1** | `npx wrangler d1 migrations apply mgl-progress-db-v3 --remote --config wrangler.toml` |
| 1 | *(энэ ажил)* `lib/learningEvents.ts`, `routes/learning.ts`, `modules.ts`, `index.ts`, тест | **1B-2** | `npx tsc --noEmit` → `npm test` → `npm run verify` → **зогс, эзний зөвшөөрөл хүлээ** → `npx wrangler deploy --config wrangler.toml` |
| 2 | Add-in-ийн илгээгч (C#) | **ТУСДАА, дараа нь** | Бүх C# өөрчлөлт НЭГ хувилбарт багцлагдана. Албадсан шинэчлэлийн механизм БАЙХГҮЙ. |

**⚠️ `--config wrangler.toml` нь ЗААВАЛ.** Репо-ийн үндэст төөрсөн `wrangler.jsonc` байдаг бөгөөд өөр worker (`name: "mgl"`, binding-гүй) зарладаг, wrangler-ийн config хайлт түүнийг сонгож болно.
**⚠️ `wrangler deploy` нь typecheck ХИЙХГҮЙ.** `npx tsc --noEmit`-ийг ӨӨРӨӨ ажиллуул.
**⚠️ Deploy нь локал wrangler, CI БИШ.** `.github/workflows/deploy-backend.yml` ба `deploy-frontend.yml` хоёулаа байдаг ч аль нь ч амжилттай болдоггүй.
**⚠️ `pages` дэд команд бүрийг `npx -y wrangler@latest`-ээр ажиллуул.** (Энэ ажилд frontend байхгүй, гэхдээ дүрэм хэвээр.)

### 5.3 Дараа юу ирэх вэ

- **1B-3** — provenance + review lifecycle: `learning_events`-ээс уншиж, шошгын төлөв нэмнэ. `writeLearningEvents` нь тэдний бичих гарц хэвээр.
- **1B-4** — dataset + model versioning: `DATASET_ELIGIBLE_SQL`-ийг ЗААВАЛ дуудна.
- **1B-5** — golden eval.
- **1C** — latency instrumentation: `occurred_at` ↔ `received_at` зөрүү нь эхний хэмжигдэхүүн. **250 ms бол шаардлага БИШ, хэн ч хэмжээгүй хэмжигдэхүүн.**

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

Хүн шалгаж болох, объектив жагсаалт:

- [ ] `grep -rn "INSERT.*INTO learning_events" backend/src/` нь **зөвхөн** `backend/src/lib/learningEvents.ts`-ийг олно.
- [ ] `cd backend && node scripts/check-learning-events.mjs` → exit 0, «✔ learning_events-ийн бичих гарц нэг файлд хаалттай».
- [ ] Түр зуур `routes/learning.ts`-д `INSERT INTO learning_events` мөр нэмэхэд дээрх скрипт **exit 1** өгнө; буцаагаад ав.
- [ ] `cd backend && npx tsc --noEmit` → exit 0 (эсвэл алдаа нь ЗӨВХӨН хамааралгүй файлд).
- [ ] `cd backend && npm test` → **221 + шинэ тестүүд**, fail = 0.
- [ ] `LEARNING_EVENT_TYPES`-д шинэ мөр нэмээд `REQUIRED_PARTS_OF`-д нэмэхгүй бол **`tsc` унана** (гараар туршиж, буцаа).
- [ ] `MODULE_IDS`-д `'learning'` нэмээд `MODULE_LABELS`-д нэмэхгүй бол **`tsc` унана** (гараар туршиж, буцаа).
- [ ] `API_PREFIXES`-д `'/api/learning'` нэмээд `index.ts`-д mount хийхгүй бол **`modules.test.ts` унана** (гараар туршиж, буцаа).
- [ ] `EVENT_ROWS_PER_STATEMENT * EVENT_BIND_COLUMNS <= 100` **ба** `* (EVENT_BIND_COLUMNS + 1) <= 100` — тестээр батлагдсан.
- [ ] `EVENT_VALUES_TUPLE`-ийн `?` тоо = `EVENT_INSERT_COLUMNS.length` — тестээр батлагдсан.
- [ ] Локал D1 дээр: 200 үйл явдлын багц илгээхэд `{accepted: 200, duplicates: 0, rejected: 0}`.
- [ ] **Тэр ЯГ ИЖИЛ багцыг дахин илгээхэд** `{accepted: 0, duplicates: 200}` — ямар ч алдаа гарахгүй.
- [ ] **ШИНЭ `client_uid`, гэхдээ АЛЬ ХЭДИЙН БАЙГАА `(session_uid, seq)`** илгээхэд → **HTTP 409**, `error: 'sequence_conflict'`, `conflicts[]` нь хоёр `client_uid`-ийг заана. Хэсэгчилсэн бичилт БАЙХГҮЙ (`SELECT COUNT(*)` өөрчлөгдөөгүй).
- [ ] `payload_json`-д хүчингүй JSON тавьж шууд D1-д INSERT хийхэд `CHECK constraint failed` гарна.
- [ ] `payload_contract`-т `'garbage'` тавьж шууд INSERT хийхэд `CHECK constraint failed` гарна.
- [ ] `expected_parts` зарласан үйл явдал (ж: `model_output`) дагалдах хэсэггүй үлдэхэд `GET /api/learning/health`-ийн `unsatisfied` нь **1**-ээр өснө.
- [ ] Дагалдах хэсэг ирсний дараа `unsatisfied` буцаж буурна.
- [ ] `GET /api/learning/events/head?session_uid=…` нь тухайн сессийн `MAX(seq)`-ийг зөв буцаана; **өөр хэрэглэгчийн** `session_uid` асуухад хоосон `heads` буцаана (мөр гоожихгүй).
- [ ] Artefact: зөв `sha256`-аар upload → 200 + R2 түлхүүр. **Нэг байтыг өөрчилж** дахин upload → **422 `sha256_mismatch`**, R2-д объект БИЧИГДЭЭГҮЙ.
- [ ] Artefact `MEETING_BUCKET`-д байгаа, `MEDIA_BUCKET`-д БАЙХГҮЙ. `GET /media/learning/<...>` → 404.
- [ ] `app_settings` дээр `learning.ingest = 'off'` тавихад ingest нь `{accepted: 0, ingest: 'off'}` буцаана, DB-д юу ч бичигдэхгүй.
- [ ] `client` эсвэл `worker` role-той токеноор `/api/learning/*` дуудахад **403**.
- [ ] `grep -rn "learning" backend/src/mcp/` → **тааралт БАЙХГҮЙ** (MCP-д гоожоогүй).
- [ ] `git status --porcelain` нь ЗӨВХӨН зорьсон файлуудыг харуулна (`docs/bim-ai/` ба өөр агентын `live2.js`-ээс гадна).

---

## 7. ШАЛГАХ КОМАНД

```bash
# ── Baseline (ажил эхлэхээс ӨМНӨ ажиллуулж, тоог тэмдэглэ) ──────────
cd backend && npx tsc --noEmit ; echo "tsc exit=$?"
cd backend && npm test 2>&1 | tail -8          # хүлээгдэж буй: pass 221, fail 0

# ── Аудитын нэхэмжлэлүүдийг дахин батлах ───────────────────────────
grep -n "BINDS\|PER =" backend/src/routes/revit.ts | head
sed -n '1700,1710p' backend/src/routes/revit.ts          # живээд буй тайлбар
sed -n '830,835p;872,876p' backend/src/routes/qto.ts     # qto-ийн chunk тайлбар
grep -rn "CATEGORY_OF" backend/src/                      # pushSweep.ts:53, webPush.ts БИШ
grep -n "app.use('/api/\*'" backend/src/index.ts         # :144 :147 :150
sed -n '274,282p' backend/src/index.ts                   # apiHandlers — /mcp root
sed -n '29,34p' backend/src/lib/entitlement.ts           # /mcp цоорхойн өөрийнх нь тайлбар
grep -rn "SessionId\|session_id" revit-mcp/addin/*.cs    # → тааралт БАЙХГҮЙ

# ── Migration-ийн орчны нэхэмжлэлүүд ───────────────────────────────
ls backend/migrations | wc -l                            # 190
ls backend/migrations | tail -3                          # 0198/0199/0200
grep -ril 'CREATE TRIGGER\|CREATE VIEW\|GENERATED ALWAYS\|json_extract' backend/migrations | wc -l   # 0
grep -rn 'json_valid' backend/migrations                 # ЗӨВХӨН 0075:375, WHERE-д

# ── Ажлын дараах шалгалт ───────────────────────────────────────────
cd backend && npx tsc --noEmit
cd backend && npm test 2>&1 | tail -8
cd backend && node scripts/check-learning-events.mjs
grep -rn "INSERT.*INTO learning_events" backend/src/     # ЗӨВХӨН lib/learningEvents.ts
grep -rn "learning" backend/src/mcp/                     # ТАЙЛАН БАЙХГҮЙ байх ёстой

# ── Локал D1-ийн end-to-end (wrangler dev :3000) ───────────────────
cd backend && npm run db:migrate:all:local
cd backend && npm run dev        # өөр цонхонд

TOK=…   # A.Anand/admin123-аар нэвтэрч авсан токен
curl -s -X POST localhost:3000/api/learning/events -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"entries":[{"client_uid":"a1","session_uid":"s1","seq":1,"event_type":"model_output","occurred_at":"2026-08-27T01:00:00Z","schema_version":1,"producer":"addin-test","payload_json":"{\"prompt\":\"x\",\"output\":\"y\"}"}]}'
# → {"accepted":1,"duplicates":0,"rejected":0,…}

# дахин илгээх → duplicates:1
# ижил seq, ӨӨР uid → 409 sequence_conflict
curl -s -X POST localhost:3000/api/learning/events -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"entries":[{"client_uid":"a2","session_uid":"s1","seq":1,"event_type":"model_output","occurred_at":"2026-08-27T01:00:01Z","schema_version":1,"producer":"addin-test","payload_json":"{}"}]}'

curl -s "localhost:3000/api/learning/events/head?session_uid=s1" -H "Authorization: Bearer $TOK"
curl -s localhost:3000/api/learning/health -H "Authorization: Bearer $TOK"

# ── CHECK-ийн зан төлөв (локал sqlite) ─────────────────────────────
cd backend && npx wrangler d1 execute mgl-progress-db-v3 --local --config wrangler.toml \
  --command "INSERT INTO learning_events (client_uid,session_uid,seq,user_id,event_type,occurred_at,schema_version,producer,payload_json,payload_contract) VALUES ('z','z',1,1,'model_output','2026-01-01T00:00:00Z',1,'t','NOT JSON','v1:model_output+prompt+output')"
# → хүлээгдэж буй: CHECK constraint failed
```

**⚠️ `json_valid` CHECK-ийг ХАЯХ D1 дээр батлах (1B-1-ийн үүрэг, гэхдээ энэ сесси ХЭРЭГЛЭГДСЭНИЙГ баталгаажуулна).** Локал miniflare нь remote D1-ийн бүх зан төлөвийг хуулбарладаггүй (мэдэгдэж буй жишээ: remote D1 нь том TEXT баганад `LIKE '%…%'`-ийг татгалздаг, локал нь татгалздаггүй). Тиймээс:
```bash
npx wrangler d1 create mgl-throwaway-checktest
# CHECK-тэй CREATE TABLE-ыг --remote-оор ажиллуул, дараа нь хүчингүй JSON INSERT хийж
# `CHECK constraint failed` гарахыг батал, эцэст нь `d1 delete`.
```

**⚠️ `/mcp`-ийн tenant-DO нэхэмжлэлийг (§2.5 (б)) гараар батлах.** Энэ нь ЭНЭ ажлыг блоклохгүй (бид `/mcp`-д юу ч гаргахгүй), гэхдээ маршрутын толгойд бичсэн нэхэмжлэл үнэн байх ёстой. `TENANTS` var-тай, хоёр D1 binding-тай тохиргоо дээр `/mcp`-ээр tool дуудаж, аль DB-ээс өгөгдөл ирснийг харна. Батлагдахгүй бол толгойн 3 дугаар цэгийн ХОЁРДУГААР хагасыг (DO-ийн `this.env`) хас — эхний хагас (`tid` тулгалт огт ажиллахгүй, `resolveExternalToken` нь `tid`/`purpose` шалгахгүй) нь кодоос БҮРЭН батлагдсан тул хэвээр үлдэнэ.

---

## 8. ROLLBACK

**Шинэ migration дугаар ШААРДЛАГАТАЙ ЮУ? — ҮГҮЙ.** Энэ ажил нь migration бичихгүй (§5.1-ийн урьдчилсан нөхцөл биелсэн тохиолдолд). Тиймээс буцаах нь зөвхөн кодын буцаалт.

| Түвшин | Үйлдэл |
|---|---|
| **Кодыг буцаах** | `git revert <commit>` → `cd backend && npx tsc --noEmit` → `npx wrangler deploy --config wrangler.toml`. Хүснэгт үлдэнэ, хоосон эсвэл хэсэг өгөгдөлтэй; хэн ч уншихгүй. **`learning_events`-ыг БҮҮ DROP хий** — `users`-ийн cascade хүүхэд бөгөөд `migrations apply`-аар DROP хийх нь §4-ийн эрсдэлийг үүсгэнэ; хэрэглэгдээгүй хүснэгт нь юуг ч гэмтээхгүй. |
| **Deploy-гүй, шуурхай зогсоолт** | `app_settings` дээр `learning.ingest = 'off'`: `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "INSERT OR REPLACE INTO app_settings (key,value) VALUES ('learning.ingest','off')"`. Ingest нь тэр даруй `{accepted:0, ingest:'off'}` буцаана. **Эхлээд үүнийг оролд.** |
| **Модулиар унтраах** | `ORG_MODULES_ENABLED`-ийг `learning`-гүйгээр тохируулбал `entitlementGuard` нь `/api/learning/*` бүрийг 403 болгоно. ⚠️ Гэхдээ энэ var нь тохируулагдмагц **бүх бусад модуль ч цагаан жагсаалтад орох ёстой** (`lib/modules.ts:260-275` — хоосон = хязгаарлалтгүй, тохируулсан = зөвхөн жагсаасан + `core`). Production дээр анх удаа тохируулах бол болгоомжтой. |
| **Хэсэгчилсэн буцаалт** | `modules.ts`-ийн 4 мөрийг буцаахдаа `index.ts`-ийн mount-ыг мөн буцаа, эс бөгөөс `modules.test.ts` унана. Хоёулаа ижил commit-д. |
| **Add-in** | Энэ ажил add-in-д юу ч хийгээгүй тул буцаах юм алга. Хэрэв илгээгч аль хэдийн гарсан бол: сервер `{accepted:0, ingest:'off'}` буцаахад add-in зогсох ёстой — тэр зан төлөв нь `AssistantLog.cs`-ийн одоогийн «алдааг чимээгүй залгих» хэв маягтай нийцнэ, гэхдээ **C# талд БАТЛАГДААГҮЙ** (§9). |

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Репогоос ШИЙДЭГДЭХГҮЙ, эзэн эсвэл production асуулга шаардах зүйлс. **1–3 нь БЛОКЛОГЧ.**

| # | Асуулт | Яагаад репо хариулж чадахгүй вэ | Хэрхэн хаах вэ |
|---|---|---|---|
| **1** 🔴 | **Инженер тутмын БОДИТ үйл явдлын хурд?** Өдөрт хэдэн үйл явдал? Оргил үед минутад хэдэн? | Batch хэмжээ (200), statement тутмын мөр (5), payload дээд хэмжээ (16 KB), хадгалах бодлого — БҮГД үүнээс хамаарна. 49 ажилтан × өдөрт 200 үйл явдал = 9,800 мөр/өдөр; тэр нь **өнөөгийн хамгийн том хүснэгт `progress_entries` (~8,062 мөр)-ыг ХОЁРДУГААР ӨДӨР давна**. 45 MB D1 дээр энэ нь загварын шийдвэр, техникийн нарийн ширийн зүйл биш. | `assistant_logs`-оос хэмж: `SELECT date(created_at) d, COUNT(*) n, COUNT(DISTINCT user_id) u FROM assistant_logs GROUP BY d ORDER BY d DESC LIMIT 30`. Үүнийг «нэг асуулт = хэдэн үйл явдал» коэффициентоор үржүүл. |
| **2** 🔴 | **Add-in нь ТОГТВОРТОЙ `session_uid` илгээж чадах уу?** | **`grep -rn "SessionId\|sessionId\|session_id" revit-mcp/addin/` → эх кодонд ТААРАЛТ БАЙХГҮЙ** (§2.10). Add-in-д сессийн ойлголт огт байхгүй. `AssistantLog.cs:175` нь бүртгэл тутамд санамсаргүй 16 тэмдэгтийн id үүсгэдэг. Тогтвортой сессгүйгээр `(session_uid, seq)` UNIQUE ба resume гарц ХОЁУЛАА утгагүй болно. | Эзэн + add-in-ийг бичдэг хүнээс: сесс нь юу вэ? (Revit процессийн ажиллагаа? нэг баримт нээлт? нэг чат тасалбар?) Процесс дахин эхлэхэд шинэ id үү, үргэлжлэх үү? Дискэн дээр хадгалагдах уу (Revit унахад амьд үлдэх ёстой)? `seq` нь сесс тус бүрд 0-оос эхлэх үү? **Хариулт нь `seq`-ийн семантикийг тодорхойлно; түүнгүйгээр §3.3-ийн 409 логик нь тодорхойлолтгүй.** |
| **3** 🔴 | **Ажилтны зан төлөвийн бүртгэлийн ЗӨВШИЛЦӨЛ.** Ажилтнууд мэдэх үү? HR бодлогод байгаа юу? Гадуур байх боломж бий юу? | Энэ бол хуулийн/HR шийдвэр, кодын шийдвэр биш. `0195_assistant_learning.sql`-ийн толгой нь «`assistant_logs` нь инженерийн БИЧСЭН ТЕКСТИЙГ хадгална … Загварын геометр, файлын агуулга ОГТ ОРОХГҮЙ» гэсэн нууцлалын хилийг аль хэдийн тогтоосон. **Шинэ ledger нь тэр хилийг ӨРГӨТГӨЖ БАЙНА** (tool дуудлага, сонголтын агшин, artefact). | Эзнээс ил шийдвэр ав, дараа нь `routes/learning.ts`-ийн толгой БОЛОН 1B-1-ийн migration-ийн толгойд бич — 0195/0200-ийн хэв маягаар. **Deploy хийхээс өмнө хаагдсан байх ёстой.** |
| 4 | **Хадгалах хугацаа (retention).** Үйл явдлыг хэр удаан хадгалах вэ? Автомат цэвэрлэгээ хэрэгтэй юу? | 0195 нь «90 хоногийн дараа цэвэрлэж болно (одоохондоо автомат цэвэрлэгээ БАЙХГҮЙ — гараар)» гэсэн. Хэмжээ нь #1-ээс хамаарна. | Эзэн. Хэрэв автомат хэрэгтэй бол ТУСДАА ажил — `wrangler.toml`-ийн cron-д **ГУРАВ ДАХЬ илэрхийлэл БҮҮ нэм** (`index.ts:363-373` дэх fail-safe салаа нь Gmail/meeting/calendar дөрвөлийг ДАВХАР ажиллуулна); `lib/deadlineSweep.ts` шиг өөрийн цагаа шалга. |
| 5 | **`MAX_ARTIFACT_BYTES = 8 MB` зөв үү?** | §3.7-ийн энэ тоо бол ЭНЭ баримт бичгийн ШИЙДВЭР, олдсон хязгаар БИШ. Ямар artefact вэ (дэлгэцийн зураг? элементийн жагсаалт? загварын хэсэг?) гэдгээс хамаарна. | Эзэн + add-in зохиогч. R2-д объектын хэмжээ асуудал биш; Worker-ийн санах ой болон 1B-4-ийн dataset хэмжээ л асуудал. |
| 6 | **`event_type` жагсаалт бүрэн үү?** §3.2-ын 9 төрөл нь ЭНЭ баримт бичгийн санал. | Бодит хэрэгцээ нь Track C-ийн typed BIM intent-ээс тодорхойлогдоно, тэр нь хараахан хийгдээгүй. | Эзэн. **Дутуу байсан нь аюулгүй** — `Record<LearningEventType, …>` нь шинэ төрөл нэмэхийг compile алдаа болгоно, чимээгүй алдагдал болгохгүй. |
| 7 | **`users` / `projects`-ийн cascade хүүхдийн БОДИТ тоо.** | Гурван эх сурвалж зөрж байна: CLAUDE.md 19/33 · аудит 27/38 · энэ сессийн migration grep 33/41 (grep нь хүснэгт дахин барихад давхардсан тодорхойлолтыг тоолдог). | `npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT m.name, f.\"table\", f.on_delete FROM sqlite_master m, pragma_foreign_key_list(m.name) f WHERE m.type='table' AND f.\"table\" IN ('users','projects')"`. Энэ ажилд нөлөөгүй (хүснэгт дахин барихгүй) — гэхдээ CLAUDE.md-г зөв тоогоор засах нь ТУСДАА, ирээдүйн ажил. |
| 8 | **`routes/revit.ts:1703`-ийн худал тайлбарыг засах уу?** | Энэ нь **энэ ажлын хамрах хүрээнээс ГАДУУР** — тэр файл өөр агентын амьд WIP байж болно. | **БҮҮ ЗАС.** Эзэнд мэдэгд: «`backend/src/routes/revit.ts:1703` дээрх тайлбарын эхний мөр `const BINDS = 13`-тай зөрчилдөж байна; нэг мөрийн засвар, тусдаа». |

---

### Хавсралт — энэ сессийн үеэр илэрсэн ТОДОРХОЙЛОЛТЫН АЛДААНУУД

| Тодорхойлолт хэлсэн | Кодод бодитоор байгаа нь |
|---|---|
| «`backend/src/lib/webPush.ts` — БҮРЭН Record идиом» | `CATEGORY_OF` нь **`backend/src/lib/pushSweep.ts:53`**-д. `webPush.ts`-д тийм зүйл алга. (`webPush.test.ts:28` нь `./pushSweep.ts`-ээс импортолдог.) Репо өөрөө `modules.ts:157`, `orgConfig.ts:274`, `webPush.test.ts:181` гурван газарт ижил буруу иш татсан. |
| «`INSERT OR IGNORE` on the client-uid unique index ONLY» | SQLite-д `INSERT OR IGNORE` нь **сонгомол байж ЧАДАХГҮЙ** — бүх өвөрмөц хязгаарлалтыг залгина. Зорилтот бүтэц нь **`ON CONFLICT (client_uid) DO NOTHING`**. Санаа нь ижил; синтакс өөр. |
| «`routes/revit.ts` … its BINDS constant … a comment near that constant states a different number» | БАТЛАГДСАН, ба **тайлбар нь ӨӨРТӨӨ зөрчилтэй**: `:1703` нь «12 bind → 8 мөр» гэдэг, `:1705` нь «13 × 7 = 91» гэдэг, `:1706-1707` нь `BINDS = 13`, `PER = 7`. Зөвхөн `:1703` хуучирсан. Файлын өөр хоёр bind тогтмол (`:58-59`, `:75`) нь ЗӨВ тайлбартай. |
| «`routes/revit.ts` assistant/logs (the batched upsert, its ON CONFLICT clause)» | Зөв, гэхдээ **маршрутын толгойн тайлбар (`:1655`) нь «`INSERT OR IGNORE`» гэж БУРУУ нэрлэдэг** — бодит SQL нь `ON CONFLICT (user_id, client_id) DO UPDATE SET …` (`:1727`). |
| «`/mcp` bypasses … the tenant DB swap» | **Хагас зөв, нарийвчлал шаардлагатай.** `index.ts:321-355` дэх tenant-ийн `env` солилт нь `oauthProvider.fetch`-д ХҮРДЭГ, тэгэхээр `/mcp` ч scoped env хүлээн авдаг. Гэвч (а) `tid` тулгалт нь ЗӨВХӨН `middleware/auth.ts:79-88`-д, `/mcp` тэнд огт очдоггүй, ба `resolveExternalToken` (`index.ts:292-296`) нь `tid`/`purpose` шалгахгүй — **энэ нь БҮРЭН батлагдсан**; (б) `MglMcpAgent` нь Durable Object тул `this.env.DB` нь үндсэн `DB` байх магадлалтай — **энэ нь гар туршилт шаардана**. |
| «Migrations … 190 files exist, highest is 0200» | БАТЛАГДСАН (`ls | wc -l` = 190, `tail -1` = `0200_assistant_feedback_note.sql`). |
| «ZERO json_extract … in all 190 migration files» | БАТЛАГДСАН. Гэхдээ **`json_valid` нь ТЭГ БИШ** — `0075_landing_blocks.sql:375` дээр НЭГ УДАА, `WHERE` нөхцөлд (CHECK-д биш). Тиймээс `CHECK (json_valid(...))` нь энэ репод батлагдаагүй хэвээр. |
| «backend … verify script-д grep баталгаа нэм» | **backend-д `verify` script БАЙХГҮЙ** (`backend/package.json` — dev/deploy/format/test/db:* л бий). Шинээр үүсгэх ёстой, ба ажиллах магадлал өндөртэй нь `npm test` (одоо 221/221 pass) дотор тест болгож давхар бичих. |
| «~49 active knowledge workers; D1 45 MB / 114 tables; progress_entries 8,062 rows» | **Энэ сессид БАТАЛГААЖУУЛААГҮЙ** — production D1 руу хандаагүй. §9 #1-д асуулга өгсөн. |
