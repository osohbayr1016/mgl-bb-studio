# 1A-6-qto-batch-privilege — QTO болон батч машины эрхийг багасгах

> **Track:** 1A · PRODUCTION SAFETY (зүйл 6)
> **Хамаарал:** Байхгүй — 1A-ийн бусад сессээс бие даан явна. (1A-3 токены амьдралын мөчлөгтэй ойр боловч блоклохгүй.)
> **Блоклож буй:** Юуг ч биш. Гэхдээ §3.2-ийн nonce нь **1C add-in релизийн** агуулгад нэг зүйл нэмнэ.
> **Хөндөх файлууд:** `backend/src/routes/qto.ts` · `revit-mcp/scripts/batch/batch-qto.ps1` · `revit-mcp/scripts/batch/install-batch-task.ps1` · `revit-mcp/scripts/batch/README.md`. **Миграц энэ сессэд БАЙХГҮЙ.**
> **Deploy тоо:** **1** (backend worker). Add-in (C#) энэ сессэд **дахин build/тараахгүй**. PowerShell script нь deploy биш — батч PC дээр гараар хуулна.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

**Хамрах хүрээ (яг эдгээр л):**

1. `backend/src/routes/qto.ts` — QTO intake-ийн зөвшөөрөл, identity талбарын таслалт, мөрийн хязгаарын алдааны хэлбэр.
2. `revit-mcp/scripts/batch/*.ps1` + `README.md` — батч дарааллын nonce/PID/TTL бичилт, хуучирсан queue-г цэвэрлэх, багасгасан эрхтэй бүртгэлийн заавар.

**Хөндөхгүй:**

| ⛔ | Юу | Яагаад |
|---|---|---|
| 1 | `revit-mcp/addin/**` дахь **ямар ч** C# файл | Add-in-ий бүх өөрчлөлт **1C**-ийн НЭГ релизэд багцлагдана. Албадан шинэчлэх механизм байхгүй, ~20 компьютер, `Install.bat`, Revit хаалттай байх шаардлагатай. |
| 2 | `backend/src/middleware/auth.ts`, `backend/src/lib/jwt.ts` | `purpose === 'mcp'`-ийг `/api/*`-д татгалзуулах нь **алсаас сэргээх боломжгүй цорын ганц өөрчлөлт**. Add-in бүх REST дуудлагаа тэр токеноор хийдэг, refresh урсгал байхгүй. |
| 3 | `backend/migrations/**` | Энэ сесст схемийн өөрчлөлт **байхгүй**. Дугаар авах ч шаардлагагүй. |
| 4 | `backend/src/mcp/**` | MCP-ийн tool шат энд өөрчлөгдөхгүй (1A-2-ийн ажил). Зөвхөн §3.1-ийн аудит тайлбар. |
| 5 | `frontend/**` | QTO хуудасны role gate нь зөвхөн UX. Backend шийднэ. Хэрэв §3.1-ийн шийдвэр `engineer`-ийг оруулбал frontend-ийн nav өөрчлөлт нь **тусдаа** ажил бөгөөд §9-д гарна. |

**Бусад агентын ажил.** Энэ репод хэд хэдэн хөгжүүлэгч зэрэг ажилладаг тул working tree-д бусдын **дуусаагүй, компайл болохгүй** файл байж болно.

- Зөвхөн даалгавартаа хамаарах файлыг үүсгэ/засварла/устга. Хамааралгүй файлыг «засах», reformat хийх, буцаах — **үгүй**.
- `git restore`, `git checkout --`, өөрийн биш файлыг `git add` — **хэзээ ч үгүй**.
- `tsc --noEmit` бүтэн репог компайл хийдэг тул чиний хөндөөгүй файл дээр унаж болно. **Бүтэн build унасан нь автоматаар таных биш** — алдаанууд зөвхөн хамааралгүй файлд байгаа эсэхийг батал, дараа нь хэрэглэгчид блокероо мэдэгд, бүү хөөцөл.

**Deploy хийж болох уу?** Тийм — `backend`-ийн нэг deploy. Гэхдээ §3.1-ийн шийдвэр эзнээс гарсны дараа (§9.1). Шийдвэргүйгээр §3.3–3.4 (таслалт + мөрийн хязгаарын алдаа) л явж болно, тэдгээр нь зан төлөвийн эвдрэлгүй.

---

## 1. КОНТЕКСТ

### 1.1 Систем (хүйтэн сесст)

| Хэсэг | Юу |
|---|---|
| `backend/` | Cloudflare Worker. `src/index.ts`-ийн default export нь **`@cloudflare/workers-oauth-provider`**, Hono биш; Hono `app` нь түүний `defaultHandler`. D1 (SQLite) + R2 (`MEDIA_BUCKET` нээлттэй / `MEETING_BUCKET` хаалттай) + KV + нэг Durable Object (`MglMcpAgent`). |
| `frontend/` | Vite + React 19 SPA, Cloudflare Pages, төсөл **`mgl-design-system`** (`--project-name mgl-design-system` заавал). |
| `revit-mcp/addin/` | Revit 2024–2027 add-in, C#/WPF, in-process, 47 файл ~16k мөр, **тест тэг**, автомат шинэчлэлт байхгүй. |
| `revit-mcp/scripts/batch/` | 24/7 PC дээрх PowerShell батч автоматжуулалт (Task Scheduler → `batch-qto.ps1` → Revit → add-in → сервер). |
| `revit-mcp/training/`, `server/`, `agent/` | Python — энэ сесст хамаарахгүй. |
| Хэмжээ | ~49 идэвхтэй мэдлэгийн ажилтан. Продакшн D1 = 45 МБ / 114 хүснэгт; хамгийн том хүснэгт `progress_entries` 8 062 мөр. |

**Role-ууд яг зургаа:** `admin | engineer | architect | senior | client | worker`.
`ADMIN_ROLES = ['admin']` (`backend/src/types.ts:241`) — өөрөөр хэлбэл `requireAdmin()` нь **ганц** role.
⚠️ `role` нь **JWT-ээс** уншигддаг, DB-ээс биш — D1 дээр role солиход тухайн хүн дахин нэвтрэх хүртэл (24 цаг хүртэл) хуучин эрхээрээ ажиллана. mcp-token дээр энэ нь **365 хоног**.

**Платформын хатуу хязгаарууд (энэ сесст хамаарах хэсэг):**

| Хязгаар | Дэлгэрэнгүй |
|---|---|
| D1 bind | Нэг statement-д дээд тал нь **100 bind**. `routes/qto.ts` = 21 bind × 4 fact мөр = 84; өрөө = 6 bind × 16 = 96. **Багана нэмбэл хоёуланг нь дахин тооцно.** |
| ⚠️ Амьд drift | `backend/src/routes/revit.ts:1703-1706` — тайлбарын **эхний** мөр «12 bind/мөр → floor(100/12) = 8 мөр/statement» гэж бичсэн атлаа доорх тогтмол нь `const BINDS = 13` (→ `PER = 7`); тайлбарын дараагийн мөр «13 × 7 = 91 ≤ 100» гэж зөв бичсэн. **Эхний мөрийг хуулж болохгүй.** Мөн `revit.ts:58-59`-д `BINDS_PER_BINDING_ROW = 13` / `BINDING_ROWS_PER_STATEMENT = 7` гэж тусдаа хос байна. |
| Миграц | Append-only, 190 файл, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. Хэрэгжсэн файлыг засах = продакшн дээр **чимээгүй no-op**. Дунд нь унавал DB хагас-миграцтай үлдэх бөгөөд цорын ганц хууль ёсны засвар нь **ШИНЭ дугаар**. Энэ сесст миграц **шаардлагагүй**. |
| Миграцын дүрэм (лавлагаа) | `CREATE TABLE` / `CREATE INDEX` бүр `IF NOT EXISTS`; **байгаа** хүснэгт дээрх `ALTER`-ыг блокийн **эхэнд**; `END;` том үсгээр, өөрийн мөрөнд (wrangler-ийн задлагч үсэг ялгадаг); репод `CREATE TRIGGER` / `CREATE VIEW` / `GENERATED ALWAYS` / `json_extract` **тэг** удаа тохиолддог. |
| FK | D1 нь ажиллах үед зарласан FK-г **хэрэгжүүлдэггүй**, ГЭХДЭЭ `wrangler d1 migrations apply` файл бүрийг транзакцад ороодог бөгөөд тэнд `ON DELETE CASCADE` **ажилладаг**. `users`-д 27, `projects`-д 38 амьд каскад хүүхэд — тэднийг `migrations apply`-аар **хэзээ ч** дахин барихгүй. |
| Deploy | Локал wrangler, CI биш (хоёр GitHub workflow хоёулаа үхсэн). `npx wrangler deploy --config wrangler.toml` — `--config` **заавал** (репо root дахь `wrangler.jsonc` өөр worker зарладаг). `wrangler deploy` typecheck **хийхгүй** — `tsc --noEmit` өөрөө ажиллуул. |
| Pages | `pages` дэд командыг **бүгдийг** `npx -y wrangler@latest`-ээр (энэ сесст хэрэггүй). |

### 1.2 Энэ ажил яагаад байгаа вэ

QTO (Тоо хэмжээ) урсгал: Revit add-in загварын элементүүдийг нэгтгээд `POST /api/qto/revit-runs` руу түлхдэг. 24/7 PC дээр `batch-qto.ps1` өдөрт гурван удаа өөрчлөгдсөн `.rvt` файлуудыг олж, Revit-ийг асааж, түлхээд Revit-ээ унтраадаг.

Дөрвөн асуудал:

1. **Тэр батч машин диск дээрээ 365 хоногийн ADMIN токен хадгалдаг** — учир нь intake нь `requireAdmin()`. Хүн байхгүй, 24/7 асаалттай компьютер компанийн бүх admin REST гадаргуу + бүх Tier-4 MCP tool-ыг эзэмшинэ.
2. **Хуучирсан `batch-queue.json` нь энгийн интерактив Revit нээлтийг өөрийгөө устгагч батч ажил болгодог** — тухайн инженерийн Revit-ийг `Process.Kill()`-оор хаана.
3. **Identity мөрүүд 256 тэмдэгтээр чимээгүй тасарч**, тасарсан утга нь `combo_key`-г үүсгэдэг — «хэзээ ч өөрчлөгдөж болохгүй» гэж баримтжуулсан run-diff join түлхүүр чимээгүй хоёр хуваагдана.
4. **20 000 мөрийн таазыг зөвхөн сервер шалгадаг** — том загвар бүтэн задлалт + олон МБ upload хийсний **дараа** унана.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх `file:line` бүрийг энэ сесст нээж баталсан (2026-08-27, `d7fecf5` дээр).

### 2.1 FINDING 1 — QTO push бүр ADMIN-аар нэвтэрдэг

**Модулийн түвшний хамгаалалт (эхэлж ажиллана):**

`backend/src/routes/qto.ts:29`
```ts
const QTO_ROLES: UserRole[] = ['admin', 'senior'];
```

`backend/src/routes/qto.ts:39`
```ts
qto.use('*', requireRole(...QTO_ROLES));
```

**Замын түвшний хамгаалалт (дараа нь ажиллана):**

`backend/src/routes/qto.ts:642-645`
```ts
// POST /api/qto/revit-runs — Revit add-in-ий push (admin-only).
// Нэг db.batch() дотор run + fact мөрүүд бичигдэнэ (batch нь transactional).
// push_id давхардвал 409 — add-in retry хийхэд давхар run үүсэхгүй.
qto.post('/revit-runs', requireAdmin(), async (c) => {
```

`requireAdmin()` = `requireRole(...ADMIN_ROLES)` (`backend/src/middleware/auth.ts:111`); `requireRole` нь `createMiddleware`-ээр 403 буцаадаг (`middleware/auth.ts:94-105`); `ADMIN_ROLES = ['admin']` (`backend/src/types.ts:241`).

Модуль нь `backend/src/index.ts:212`-т `app.route('/api/qto', qto)`-оор холбогдоно.

**⚠️ Дарааллын үр дагавар — энэ бол энэ сессийн хамгийн чухал техникийн баримт.**
`qto.use('*', ...)` нь 39-р мөрөнд, аль ч route зарлагдахаас **өмнө** бүртгэгддэг. Hono middleware-ийг бүртгэсэн дарааллаар нь ажиллуулдаг тул модулийн хамгаалалт **эхэлж** ажиллана. Тиймээс:

> `qto.post('/revit-runs', requireRole('admin','senior','engineer'), …)` гэж **route-ыг өргөсгөх нь юу ч өгөхгүй** — `engineer` 39-р мөрөнд аль хэдийн 403 авсан байна.
> Өргөтгөл нь **зайлшгүй `QTO_ROLES` дээр**, эсвэл модулийн `use`-ээс **өмнө** бүртгэгдсэн, зөвхөн `/revit-runs`-д тохирох тусдаа middleware дээр хийгдэнэ.

Бусад `requireAdmin()`-тэй QTO route-ууд (лавлагаа, энэ сессийн хамрах хүрээнд **ОРОХГҮЙ**): `:305` `POST /view-exports`, `:345` `DELETE /view-exports/:id`, `:431` `POST /schedules`, `:517` `DELETE /schedules/:id`.

**Токеныг add-in хэрхэн авдаг вэ:**

`revit-mcp/addin/ApiClient.cs:83-101` — `LoginAsync` → `POST /api/auth/login` → богино session токен + role.
`revit-mcp/addin/ApiClient.cs:103-122` — `MintLongTokenAsync` → `POST /api/auth/mcp-token` → урт токен.
`revit-mcp/addin/SettingsDialog.xaml.cs:117-130` — нэвтрэхэд хоёуланг дараалуулж дуудаад, урт токеныг хадгална.

`backend/src/routes/auth.ts:71-80`
```ts
auth.post('/mcp-token', async (c) => {
  const user = c.get('user');
  const expiresInDays = 365;
  const token = await signToken(
    { sub: user.sub, role: user.role, purpose: 'mcp' },
    c.env.JWT_SECRET,
    expiresInDays * 24,
  );
  return c.json({ token, purpose: 'mcp', expires_in_days: expiresInDays });
});
```
**Энэ route-д role gate БАЙХГҮЙ**, expiry нь 365 хоног, тайлбар нь өөрөө хэлж байна (`auth.ts:68-70`): *«Revoke by rotating JWT_SECRET (invalidates all tokens) until a per-token denylist exists.»*

**Хадгалалт:** `revit-mcp/addin/SettingsStore.cs:23` — `%APPDATA%\RevitMcpAddin\settings.json`; `:94-108` `Protect()` = `ProtectedData.Protect(..., DataProtectionScope.CurrentUser)`. Файлын өөрийн тайлбар (`SettingsStore.cs:61-66`) хэлдэг: DPAPI нь **файл хуулагдах/нөөцлөгдөх** эрсдэлийг л бууруулна — ижил хэрэглэгчийн доор ажиллаж буй **ямар ч процесс** `Unprotect`-ийг адилхан дуудаж чадна.

**Blast radius (батлагдсан):**

| Гадаргуу | Юу нээгдэнэ |
|---|---|
| REST | `requireAdmin()`-тэй **бүх** route: `routes/quotes.ts` (үнийн санал бүхэлдээ — тэр модулийн бүх route admin), хэрэглэгчийн администрац, имэйл, хурал, гүйцэтгэлийн тайлан г.м. |
| MCP | `backend/src/index.ts:292-296` `resolveExternalToken` нь `verifyToken`-ийг л дуудаад `{sub, role}` буцаана — **`purpose` шалгахгүй**. `backend/src/mcp/MglMcpAgent.ts:121-137` — `isAdminRole(user.role)` бол Tier-4 бүхэлдээ бүртгэгдэнэ: `registerExecutiveTools`, `registerPortfolioTools`, `registerTrendTools`, `registerEmailTools`, `registerEmailTriageTools` (**WRITE**), `registerEmailReadTools`, `registerMeetingTools`, `registerQuoteTools`. |
| JWT | `backend/src/lib/jwt.ts:70-92` `verifyToken` нь **гарын үсэг + `exp` л шалгана** — `alg` шалгахгүй, `purpose` шалгахгүй, revocation жагсаалт байхгүй. |
| Цуцлалт | **`JWT_SECRET` эргүүлэхээс өөр арга байхгүй** — тэр нь бүх session, суусан add-in бүр, нислэг дунд байгаа бүх print job-ыг нэг дор алдаг (5 төрлийн токен, 17 дуудлагын цэг). |

### 2.2 FINDING 2 — Хуучирсан `batch-queue.json` = өөрийгөө устгагч Revit

**Триггер нь ЗӨВХӨН файл байгаа эсэх:**

`revit-mcp/addin/BatchQto.cs:38-43`
```csharp
public static void Hook(UIControlledApplication application)
{
    if (!File.Exists(QueuePath))
        return;
    application.ControlledApplication.ApplicationInitialized += OnApplicationInitialized;
}
```
`QueuePath` = `%APPDATA%\RevitMcpAddin\batch-queue.json` (`BatchQto.cs:33`). `App.OnStartup`-аас дуудагдана — `revit-mcp/addin/App.cs:131`.

**PID шалгалт БАЙХГҮЙ. Эзний тэмдэг БАЙХГҮЙ. Хугацааны хамгаалалт БАЙХГҮЙ.** `BatchQueue` DTO-д (`BatchQto.cs:191-199`) зөвхөн `exit` (bool, анхдагч `true`) ба `files` (list) хоёр талбар бий; `BatchFile` (`:201-208`) нь `path` + `project_id`.

**Төгсгөл нь Revit-ийг хатуу устгана:**

`revit-mcp/addin/BatchQto.cs:88-92`
```csharp
// Batch session — ажил дууссан тул Revit-ийг бүхэлд нь унтраана.
// (RevitBatchProcessor ч мөн адил process-оо шууд дуусгадаг.)
if (exitWhenDone)
    Process.GetCurrentProcess().Kill();
```
`exitWhenDone` нь `queue.Exit`-ээс ирнэ (`BatchQto.cs:69`), script нь үргэлж `exit = $true` бичдэг (`batch-qto.ps1:83`).

Queue-г `batch-queue.processing.json` болгож нэрлэх нь (`BatchQto.cs:60-64`) **дахин ачаалалтаас** л хамгаална — өөр хэрэглэгч/өөр зорилготой session-оос **ХАМГААЛАХГҮЙ**.

**PowerShell тал:**

`revit-mcp/scripts/batch/batch-qto.ps1:82-86`
```powershell
$queue = @{
    exit  = $true
    files = @($work | ForEach-Object { @{ path = $_.path; project_id = $_.project_id } })
}
$queue | ConvertTo-Json -Depth 5 | Out-File $queuePath -Encoding utf8
```
`:89-94`
```powershell
$proc = Start-Process -FilePath $revitExe -PassThru
$exited = $proc.WaitForExit($timeoutMin * 60 * 1000)
if (-not $exited) {
    Log "TIMEOUT: Revit ${timeoutMin} минутад дуусаагүй — process-ийг хаалаа"
    try { $proc.Kill() } catch {}
}
```
`:97-101`
```powershell
if (Test-Path $queuePath) {
    Log "АЛДАА: add-in batch-г огт эхлүүлээгүй (queue хэвээр) — Revit дээр попап гарсан эсэхийг шалгана уу"
    Remove-Item $queuePath -Force
    exit 1
}
```

**Мөр 86 → мөр 99 хооронд юу тохиолдвол queue диск дээр үлдэх вэ:**

| Тохиолдол | Үр дүн |
|---|---|
| Task Scheduler task-ыг зогсоох / `ExecutionTimeLimit` 3 цаг дуусах (`install-batch-task.ps1:27`) | PowerShell процесс алагдана, мөр 97-99 **хэзээ ч ажиллахгүй** → queue үлдэнэ |
| Гараар `-Force`-оор ажиллуулж байгаад Ctrl+C дарах | Мөн адил. Script-д `try/finally` **огт байхгүй**; `$ErrorActionPreference = 'Stop'` (`:28`) нь цэвэрлэгээ өгдөггүй |
| PC reboot / цахилгаан тасрах | Queue диск дээр үлдэнэ |
| `WaitForExit` timeout → `$proc.Kill()` (`:93`) | Энэ тохиолдолд мөр 97 ажиллана тул queue **цэвэрлэгдэнэ** — timeout нь эрсдэлийн зам БИШ |

**Queue үлдсэний дараа:** тэр PC дээр тухайн Windows хэрэглэгчийн нэрээр **дараагийн** Revit нээлт (инженер ердийн ажлаа хийхээр нээсэн ч) `Hook` → `ApplicationInitialized` → `batch-config.json`-д жагсаасан бүх файлыг **detached** нээж push хийгээд → **`Process.GetCurrentProcess().Kill()`**. Инженерийн хадгалаагүй ажил алдагдана, шалтгаан нь ямар ч UI-д харагдахгүй — батч горимд `TaskDialog` **зориудаар** харуулдаггүй (`BatchQto.cs:20-22`).

⚠️ Энэ нь **зөвхөн батч PC-д хамаарахгүй**: `%APPDATA%` нь хэрэглэгч тус бүрийнх боловч `README.md`-ийн «Гараар турших» (алхам 4) нь ямар ч ажлын станц дээр `batch-qto.ps1 -Force`-ыг ажиллуулахыг зөвлөдөг — тэр туршилтыг тасалдуулсан инженерийн **өөрийнх нь машин** ижил байдалд орно.

### 2.3 FINDING 3 — 256 тэмдэгтийн чимээгүй таслалт → `combo_key` хуваагдана

`backend/src/routes/qto.ts:34-35`
```ts
/** Identity талбаруудын дээд урт. */
const MAX_STR = 256;
```

`backend/src/routes/qto.ts:639-640`
```ts
const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim().slice(0, MAX_STR) : '';
```

`backend/src/routes/qto.ts:732-735`
```ts
    const category = str(row.category);
    const typeName = str(row.type_name);
    const material = str(row.material);
    const comboKey = normalizeFactKey(category, typeName, material);
```

`backend/src/lib/resourceMap.ts:20-22`
```ts
export function normalizeFactKey(category: string, typeName: string, material: string): string {
  return [category, typeName, material].map((s) => normalizeRawName(s ?? '')).join('|');
}
```
(`normalizeRawName` нь `backend/src/lib/qtoNormalize.ts:23-53` — тэмдэгт багасгах, тусгаарлагч нэгтгэх; **уртыг огт хөндөхгүй**.)

**Тиймээс `combo_key` нь ТАСАРСАН утгуудаас гарна.** Хоёр өөр type name эхний 256 тэмдэгтээрээ ижил бол нэг key рүү **нийлнэ**; тасралтын цэг шилжвэл (шинэ Revit хувилбарт нэр өөрчлөгдөх, префикс нэмэгдэх) нэг бодит type **хоёр key болж хуваагдана**.

**Яагаад энэ нь ноцтой вэ — `combo_key` бол run-diff-ийн join түлхүүр:**

`frontend/src/features/qto/components/RunDiff.tsx:42-43`
```
/** Run A (older) vs Run B (newer) — revit runs only. The diff is keyed by
 *  `combo_key`; deltas are B − A and only changed rows are shown. */
```
`frontend/src/features/qto/lib/pivots.ts:161-164, 172, 183` — diff map-ыг `f.combo_key`-ээр барина.
`backend/migrations/0117_qto_revit.sql:67` — `combo_key TEXT NOT NULL,  -- normalizeFactKey(category, type_name, material)`; `:75` — `CREATE INDEX IF NOT EXISTS idx_qto_facts_combo ON qto_facts (combo_key);`

`CLAUDE.md`-д энэ нь **хувиршгүй** гэж баримтжуулагдсан: *«`combo_key` / `normalizeFactKey` must never change — it is both the run-diff join key and the alias lookup key.»* Таслалт нь тэр тогтвортой байдлыг **чимээгүй** зөрчинө.

**Хоёр талын аль нь ч анхааруулга өгөхгүй:**
- Сервер: 201 хариу (`qto.ts:913-923`) нь `run_id, facts, mapped, unmapped, unmapped_keys` л буцаана — таслалтын тоо байхгүй, лог ч байхгүй.
- Add-in: `ApiClient.PostRevitRunAsync` (`revit-mcp/addin/ApiClient.cs:305-329`) нь зөвхөн 401 / 409 / non-2xx-ыг ялгана; 201 бол `QtoPushResult`-ыг задлаад дуусна.

**Дагалдах эрсдэл:** `qto.ts:664` `const fileName = str(body.file_name);` — `file_name` нь **самбарын нэгтгэлийн нэгж** (add-in файл тус бүрд тусдаа run илгээдэг), мөн `model_url = ` `` `revit://${fileName}` `` (`qto.ts:857`) түүнээс барина. Практикт add-in зөвхөн `Path.GetFileName(...)`-ыг илгээдэг (`revit-mcp/addin/QtoExtractor.cs:536-543`) тул 256-д хүрэх магадлал бага — гэхдээ хамгаалалт байхгүй.

**Мөн чимээгүй таслагддаг зүйлс (лавлагаа, энэ сессийн ажил биш):**

| Юу | Хаана |
|---|---|
| `MAX_ROOMS = 5_000` → `.slice(0, MAX_ROOMS)` | `qto.ts:634`, `:877` — 5000-аас олон өрөө **чимээгүй хаягдана** |
| `MAX_SCHEDULE_ROWS = 5_000` → `.slice(...)` | `qto.ts:359`, `:476` |
| `MAX_SCHEDULE_COLS = 40` → `.slice(...)` | `qto.ts:360`, `:473`, `:477` |
| `MAX_CELL = 500` → `.slice(...)` | `qto.ts:361`, `:459` |

### 2.4 FINDING 4 — 20 000 мөрийн тааз зөвхөн серверт байна

**Сервер тал (fact-ууд) — БҮТЭН push-ыг ТАТГАЛЗАНА:**

`backend/src/routes/qto.ts:31-33`
```ts
/** Нэг push-д зөвшөөрөх дээд fact мөр — үүнээс их бол add-in бүлэглэлтээ
 *  алдсан (per-element илгээсэн) гэсэн үг тул хүлээж авахгүй. */
const MAX_ROWS = 20_000;
```
`backend/src/routes/qto.ts:668-670`
```ts
  if (body.rows.length > MAX_ROWS) {
    return c.json({ error: `Too many rows (max ${MAX_ROWS}) — add-in must aggregate` }, 413);
  }
```

**Add-in тал (fact-ууд) — УРЬДЧИЛСАН ШАЛГАЛТ БАЙХГҮЙ:**
`revit-mcp/addin/QtoExportCommand.cs` бүхэлдээ 287 мөр. Push-аас өмнөх ганц шалгалт нь `:68` `if (extraction.RowCount == 0)`. `MAX_ROWS`-той дүйцэх тогтмол, харьцуулалт **байхгүй** (`grep -n "20000\|20_000\|MaxRows" revit-mcp/addin/QtoExportCommand.cs` → хоосон). `BatchQto.cs`-д ч байхгүй.

**Ведомостын зам — ЭСРЭГЭЭР, клиент тал ижил тоог мэднэ:**

`revit-mcp/addin/ScheduleReader.cs:15-16`
```csharp
/// <summary>Нэг ведомостоос авах мөрийн дээд хязгаар (сервер: 5000).</summary>
public const int MaxRows = 5_000;
```
`revit-mcp/addin/ScheduleReader.cs:99`
```csharp
int rows = Math.Min(body.NumberOfRows, MaxRows);
```

> **⚠️ Даалгаврын тодорхойлолт энд ТОДОРХОЙ БУС байсан — залруулга.**
> Тодорхойлолт нь «ведомостын зам клиент талд урьдчилж шалгадаг нь **яг сервер бүтэн push-ыг татгалздаг учраас**» гэсэн. Кодыг шалгахад **тийм биш**: `/schedules` сервер нь мөрийг **чимээгүй тасалдаг** (`qto.ts:476` `.slice(0, MAX_SCHEDULE_ROWS)`), татгалздаггүй; тэр зам дээрх цорын ганц 413 нь **ведомостын ТОО** 60-аас хэтрэх үед (`qto.ts:358`, `:449-451`).
> Бодит ялгаа нь: **ведомостын зам дээр клиент ба сервер ижил тоог (5000) мэддэг** (add-in-ий тайлбар өөрөө «сервер: 5000» гэж бичсэн), харин **fact зам дээр клиент 20 000-ыг ОГТ МЭДЭХГҮЙ**. Үр дагавар нь тодорхойлолтынхтой ижил — том загвар бүтэн задлалт (минутууд) + олон МБ upload хийгээд дараа нь 413 авна — гэхдээ шалтгааны тайлбарыг зөв бичих ёстой.

---

## 3. ХИЙХ АЖИЛ

### 3.1 QTO intake-д өөрийн, нарийсгасан зөвшөөрөл өгөх — **ЭЗНИЙ ШИЙДВЭР ШААРДЛАГАТАЙ**

> **Энэ сесс ӨӨРӨӨ шийдэхгүй.** Энэ бол «QTO өгөгдөл нь үнийн ангилалынх уу?» гэсэн бүтээгдэхүүний асуулт. §9.1-д тавигдсан. Эзний хариу гарах хүртэл §3.3–3.4-ийг л ship хий.

**Техникийн хязгаарлалт (заавал ойлгох):** §2.1-д батлагдсанчлан модулийн `qto.use('*', requireRole(...QTO_ROLES))` (`qto.ts:39`) нь route-ийн middleware-ээс **өмнө** ажиллана.

| Хувилбар | Хэрхэн хэрэгжинэ | Blast radius |
|---|---|---|
| **A — push-ыг `senior`-т нээх** | `qto.post('/revit-runs', requireRole('admin','senior'), …)`. `QTO_ROLES` аль хэдийн `['admin','senior']` тул модулийн gate саад болохгүй. **Хамгийн бага өөрчлөлт.** | Батч дансны токен нь `requireManager()` гадаргуу + MCP Tier-3-тэй тэнцэнэ. Үнийн санал, имэйл, хурал (Tier-4) **хаагдана**. |
| **B — `engineer`/`architect`-ыг push-д нээх** | `QTO_ROLES`-ыг өргөсгөх **боломжгүй** (тэр нь QTO-г **унших** эрхийг ч нээнэ). Модулийн `use`-ээс **өмнө** route-тусгай gate бүртгэнэ. | Хамгийн бага эрх. Product-ийн хувьд ч зөв — QTO push нь зургаа хийсэн инженерийн ажил. Хамгийн том код өөрчлөлт. |
| **C — хэвээр (`admin`) + батч PC-д тусдаа least-privilege данс** | Код өөрчлөхгүй; §3.4 л ажиллана. | Blast radius буурахгүй, зөвхөн **мөрдөгдөх** болно. **Өнөөдөр хийж болох хамгийн хурдан алхам.** |

**Хувилбар B-ийн техникийн хэлбэр** (эзэн сонговол):

```ts
// backend/src/routes/qto.ts — 39-р мөрийн ӨМНӨ
//
// ⚠️ ДАРААЛАЛ АЧААЛАЛТАЙ: доорх `qto.use('*', requireRole(...QTO_ROLES))` нь
// бүртгэлийн дарааллаар ЭХЭЛЖ ажилладаг тул `/revit-runs`-ын өргөтгөлийг
// ЗААВАЛ түүнээс дээр тавина.  Route-ийн дотор requireRole нэмэх нь юу ч
// өгөхгүй — модулийн gate аль хэдийн 403 буцаасан байна.
const QTO_PUSH_ROLES: UserRole[] = ['admin', 'senior', 'engineer', 'architect'];
```

⚠️ Hono-д ижил method+path дээр gate-only handler нэмэх нь `next()` дуудагдсан үед л дараагийнх руу шилждэг. `requireRole` нь `createMiddleware` (`middleware/auth.ts:95`) тул `next()`-ыг зөв дууддаг — **гэхдээ хэрэгжүүлэгч сесс үүнийг локал `wrangler dev` дээр бодитоор баталгаажуулах ёстой** (§7), таамаглаж болохгүй. Найдвартай, тодорхой хувилбар: `/revit-runs`-ыг **тусдаа `Hono` instance** болгож `index.ts:212`-ийн `app.route('/api/qto', qto)`-ээс **өмнө** mount хийх:

```ts
// backend/src/index.ts — 212-р мөрийн ӨМНӨ
app.route('/api/qto', qtoPush);   // зөвхөн POST /revit-runs, өөрийн gate-тэй
app.route('/api/qto', qto);       // одоо байгаа мөр
```

**Хувилбар А эсвэл B-г сонгосон тохиолдолд заавал хамт хийх:**

1. `qto.ts:27-28` дахь толгойн тайлбарыг шинэчлэх (одоо «илгээх … нь admin-only» гэж бичсэн).
2. `qto.ts:642` дахь `// POST /api/qto/revit-runs — Revit add-in-ий push (admin-only).` мөрийг засах.
3. **MCP аудит (програмын дүрэм: REST access rule өөрчлөгдвөл MCP-г заавал шалгана).** `backend/src/mcp/MglMcpAgent.ts:114-116`-ийн тайлбар нь QTO-ийн REST gate-ийг шууд ишлэдэг:
   ```
   // Тоо хэмжээ (QTO) — routes/qto.ts-ийн requireRole('admin','senior')
   // gate-ийн MCP дүйцэл (engineer/architect-ийг 2026-06-д хассан).
   ```
   `registerQuantityTools` нь **уншихын** tool тул `admin|senior` хэвээр үлдэх нь зөв (push-ын эрх өргөжсөн нь уншихын эрхийг өргөсгөхгүй). Шийдвэрээ тэр тайлбарт бич — код өөрчлөх шаардлагагүй.
4. Frontend nav (`frontend/src/shared/components/Layout.tsx:403-409`, `roles: ['admin','senior']`) ба `frontend/src/features/qto/QtoPage.tsx:77` (`user.role === 'admin' || user.role === 'senior'`) — **энэ сесст бүү хөндөх**; уншихын эрх өөрчлөгдөөгүй тул хэвээр зөв.

### 3.2 Батч дарааллын nonce + PID + TTL (PowerShell тал ЭНЭ СЕССЭД, add-in тал ДАРАА)

**Дарааллын дүрэм (урвуулбал шөнийн батч чимээгүй зогсоно):**

```
Одоо (энэ сесс)   : PS нь queue-д НЭМЭЛТ талбар бичнэ.  Add-in тэдгээрийг ҮЛ ТООМСОРЛОНО.
1C релиз N        : Add-in ТЭВЧИНЭ — nonce-гүй queue-г хуучин ёсоор ажиллуулна,
                    БАЙВАЛ nonce/pid/created_at-ыг хүндэтгэнэ.
1C релиз N+1      : Add-in ШААРДАНА — nonce-гүй queue-г алгасаад устгана.
```

**Яагаад PS тал өнөөдөр аюулгүй вэ (батлагдсан):** `BatchQto.cs:66`
```csharp
queue = JsonSerializer.Deserialize<BatchQueue>(File.ReadAllText(ProcessingPath));
```
`JsonSerializerOptions` дамжуулаагүй → `System.Text.Json`-ий **анхдагч** зан төлөв нь тодорхойлогдоогүй JSON гишүүдийг **үл тоомсорлох**. Тиймээс `nonce`, `pid`, `created_at` талбар нэмэх нь талбар дээр байгаа **бүх** add-in хувилбарт бүрэн нийцтэй.

**`batch-qto.ps1`-д хийх өөрчлөлт:**

**(1) Замын блок** (`:29-33`) — `processing` замыг нэмнэ (нэрийг `BatchQto.cs:34`-ээс баталсан):
```powershell
$processingPath = Join-Path $dir 'batch-queue.processing.json'
```

**(2) Ажиллаж эхлэхэд хуучирсан queue-г цэвэрлэх** — тохиргоо уншсаны дараа, «Төлөв унших» блокоос өмнө (одоогийн `:55` орчим):
```powershell
# ---- Хуучирсан queue цэвэрлэх ----------------------------------------
# Өмнөх ажиллагаа хатуу тасалдвал (Task Scheduler-ийн ExecutionTimeLimit,
# Ctrl+C, reboot) batch-queue.json диск дээр үлддэг.  Тэр үед инженерийн
# ЭНГИЙН Revit нээлт батч горимд орж, Revit-ээ өөрөө хаана
# (BatchQto.cs:92 — Process.GetCurrentProcess().Kill()).  Тиймээс
# өөрийнхөө үлдэгдлийг ЭХЭЛЖ устгана.
if (Test-Path $queuePath) {
    $age = (Get-Date) - (Get-Item $queuePath).LastWriteTime
    Log ("Анхаар: хуучирсан batch-queue.json олдлоо ({0:N0} мин) — устгалаа" -f $age.TotalMinutes)
    Remove-Item $queuePath -Force
}
if (Test-Path $processingPath) {
    Log "Анхаар: дуусаагүй batch-queue.processing.json олдлоо — устгалаа"
    Remove-Item $processingPath -Force
}
```

**(3) Queue-д nonce/PID/TTL бичих** (одоогийн `:82-86`-г солино):
```powershell
$nonce = [guid]::NewGuid().ToString('N')
$queue = @{
    exit       = $true
    nonce      = $nonce                                      # add-in релиз N+1-д ЗААВАЛ
    pid        = $PID                                        # энэ script-ийн процессын дугаар
    created_at = (Get-Date).ToUniversalTime().ToString('o')  # TTL шалгах суурь
    files      = @($work | ForEach-Object { @{ path = $_.path; project_id = $_.project_id } })
}
$queue | ConvertTo-Json -Depth 5 | Out-File $queuePath -Encoding utf8
```
`files` бүтэц **өөрчлөгдөхгүй** — `BatchFile` DTO (`BatchQto.cs:201-208`) яг тэр хоёр талбарыг хүлээдэг.

**(4) `try/finally`-ээр өөрийн queue-г баталгаатай устгах.** `Start-Process` мөрөөс (`:89`) үр дүн боловсруулах хүртэлх хэсгийг:
```powershell
try {
    # Start-Process … WaitForExit … үр дүн уншиж боловсруулах
} finally {
    if (Test-Path $queuePath) { Remove-Item $queuePath -Force }
}
```
Энэ нь Ctrl+C ба terminating error-ыг барина; **хатуу `Kill` дээр ажиллахгүй** тул алхам (2) хэвээр зайлшгүй.

**`install-batch-task.ps1`-д хийх өөрчлөлт:**
- `-ExecutionTimeLimit (New-TimeSpan -Hours 3)` (`:27`) нь `batch-config.json`-ий `timeout_minutes` (анхдагч 90 — `batch-qto.ps1:51`)-ээс **урт** байх ёстой; одоо зөв. Тайлбар нэм: «энэ хоёрыг хооронд нь бүү солиорхойл — task эхэлж зогсвол script-ийн `finally` ажиллахгүй, queue үлдэнэ».
- Task-ыг ямар Windows дансаар ажиллуулахыг `-User` / `-Principal`-аар зааж өгөх боломжийг параметр болгон нэм (одоо огт заадаггүй — `:32-35`, бүртгэсэн хэрэглэгчийн доор интерактив session-д ажиллана). §3.4-тэй хамт.

**`README.md`-д нэмэх мөрүүд** («Анхаарах зүйлс» жагсаалтад):
> - **Хуучирсан queue:** script хатуу тасалдвал (task зогсоох, reboot, Ctrl+C) `batch-queue.json` үлдэж, дараагийн **энгийн** Revit нээлт батч болж хувирч Revit-ээ хаана. Script одоо эхлэхдээ өөрөө цэвэрлэдэг. Гараар шалгах: `Test-Path "$env:APPDATA\RevitMcpAddin\batch-queue.json"` — `$true` бол устга.
> - **Windows данс:** батч task-ыг домэйн админ биш, сүлжээний `.rvt` хавтас руу **зөвхөн уншихын** эрхтэй тусдаа дансаар ажиллуул.

**1C релиз N-д (энэ сесст БИШ) add-in талд юу орох вэ — тодорхойлолт бэлдэж үлдээ:**
- `BatchQueue`-д `Nonce`, `Pid`, `CreatedAt` талбар нэм.
- `Hook` / `OnApplicationInitialized`-д: `CreatedAt` байгаа бөгөөд одоогоос **TTL-ээс** хуучин бол (санал: 6 цаг, §9.5) queue-г устгаад **энгийн session хэвээр** үлдэ; `Pid` байгаа бөгөөд тэр PID амьд **биш** бол мөн адил. Талбар **байхгүй** бол хуучин зан төлөв (ажиллуулна) — **ТЭВЧИНЭ**.
- Шийдвэрээ `batch-result.json`-д бич (`TaskDialog` **хэзээ ч биш** — `BatchQto.cs:20-22`).
- Релиз N+1-д л `Nonce`-ыг заавал болгоно.

### 3.3 Identity талбарын таслалтыг илэрхий болгох

**Ship хийх (энэ deploy):** таслалтыг **тоолоод хариуд буцаах** + илэрхий татгалзалтыг тогтмолын ард тавих.

`backend/src/routes/qto.ts:34-35`-ийн дор нэмнэ:
```ts
/**
 * ⚠️ `combo_key` нь ТАСАРСАН утгуудаас гардаг (normalizeFactKey(category,
 * type_name, material)) тул 256-аас урт нэр нь run-diff-ийн join түлхүүрийг
 * чимээгүй хуваах/нийлүүлэх эрсдэлтэй.  Одоохондоо ТООЛООД буцаана;
 * `STRICT_IDENTITY = true` болгоход 422-оор татгалзана — тэрийг зөвхөн §9.3-ын
 * продакшны асуулга 0 таслалт харуулсны ДАРАА, тусдаа deploy-д асаана.
 */
const STRICT_IDENTITY = false;
```

`qto.ts:639-640`-ийн `str`-ийн **хажууд** (солихгүй — бусад 20 гаруй дуудлага түүнийг ашигладаг) тоолууртай хувилбар нэмнэ:
```ts
interface TruncCounter { n: number; longest: number; sample: string | null }

const strCounted = (v: unknown, ctr: TruncCounter): string => {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  if (t.length <= MAX_STR) return t;
  ctr.n++;
  if (t.length > ctr.longest) { ctr.longest = t.length; ctr.sample = t.slice(0, 80); }
  return t.slice(0, MAX_STR);
};
```

`/revit-runs` handler дотор:

- `const trunc: TruncCounter = { n: 0, longest: 0, sample: null };` — `qto.ts:646` орчим.
- `combo_key`-д **ОРДОГ** дөрвөн талбарыг л сольж өгнө: `fileName` (`:664`), `category` / `typeName` / `material` (`:732-734`). Бусад талбарууд (`family`, `level`, `type_mark`, `marks`, `assembly_code`, `keynote`, өрөөний талбарууд) нь түлхүүрт ордоггүй тул `str` хэвээр.
- Мөрийн давталт дууссаны дараа, **`push_id` дедупликац болон `runInsert`-ийн өмнө**:

```ts
if (trunc.n > 0) {
  if (STRICT_IDENTITY) {
    return c.json(
      {
        error: `Identity field longer than ${MAX_STR} chars — combo_key would split`,
        truncated: trunc.n,
        longest: trunc.longest,
        sample: trunc.sample,
      },
      422,
    );
  }
  console.warn(
    `[qto] identity truncation: project=${projectId} file=${fileName} ` +
    `count=${trunc.n} longest=${trunc.longest} sample=${JSON.stringify(trunc.sample)}`,
  );
}
```

- 201 хариуг өргөтгөнө (`qto.ts:913-923`):
```ts
  return c.json(
    {
      run_id: runId,
      facts: facts.length,
      mapped,
      unmapped: facts.length - mapped,
      truncated: trunc.n,          // ← ШИНЭ.  0 бол бүх identity бүрэн.
      unmapped_keys: [...unmappedKeys.values()].slice(0, 50),
    },
    201,
  );
```

**Зөвлөмж (эзэн/§9.3-д):** зөв хариулт нь **татгалзах** (422) — таслалт нь баримтжуулсан хувиршгүй түлхүүрийг эвдэж, хоёр талын аль нь ч мэдэгдэхгүй. Гэхдээ 422-г **шууд асаах нь эрсдэлтэй**: талбар дээрх add-in-ууд өнөөдөр амжилттай push хийж байгаа загвартаа гэнэт бүтэн 422 авч болзошгүй бөгөөд алдааг **харуулах UI ч байхгүй**. Тиймээс: **энэ deploy = зөвхөн тоолуур + лог**, продакшны өгөгдөл 0 таслалт харуулсны дараа `STRICT_IDENTITY = true`-г **дараагийн** deploy-д асаана.

⚠️ `truncated` талбар нэмэх нь `QtoPushResult` DTO (`revit-mcp/addin/QtoDtos.cs`)-д **өөрчлөлт шаардахгүй** — `System.Text.Json` анхдагчаар илүүдэл талбарыг үл тоомсорлоно. Тэр талбарыг **харуулах** ажил нь 1C релизийн агуулга.

### 3.4 Мөрийн хязгаарын алдааг машин уншихаар болгох (FINDING 4-ийн серверийн тал)

`qto.ts:668-670`-г:
```ts
  if (body.rows.length > MAX_ROWS) {
    return c.json(
      {
        error: `Too many rows (max ${MAX_ROWS}) — add-in must aggregate`,
        max_rows: MAX_ROWS,          // ← ШИНЭ: add-in урьдчилан шалгах тоог мэдэх боломж
        got: body.rows.length,       // ← ШИНЭ
      },
      413,
    );
  }
```

Add-in талын урьдчилсан шалгалт (`QtoExportCommand.cs` / `BatchQto.cs`-д `extraction.RowCount > MAX_ROWS` бол задлалт дуусмагц зогсоох) нь **1C релизийн агуулга** — энэ сесст **хийхгүй**. `ScheduleReader.cs:15-16`-ийн загварыг дага: тогтмолыг add-in талд хатуу бич, тайлбартаа серверийн тоог заа.

### 3.5 Батч PC-г тусдаа, багасгасан эрхтэй данс руу шилжүүлэх (үйл ажиллагаа, код тэг)

**Өнөөдөр хийх — blast radius-ыг хамгийн хурдан бууруулах алхам.**

1. Вэб дээр батч машинд **зориулсан** хэрэглэгч үүсгэ (жишээ нь `qto-batch`), role нь §3.1-ийн шийдвэрээр. `admin` хэвээр байсан ч **хүн биш, тусдаа** данс байх нь чухал — `qto_runs.created_by` тэр дансыг заана, мөрдөгдөх болно.
   ⚠️ Гэхдээ санаж яв: `role` JWT-ээс уншигддаг, revocation байхгүй (`backend/src/lib/jwt.ts:70-92`) тул дансыг `status='inactive'` болгосон ч **тэр токен 365 хоног хүчинтэй хэвээр**. Жинхэнэ цуцлалт нь **1A-3**-ийн ажил; энд гарах ашиг нь зөвхөн мөрдөгдөх чадвар + role-ийн хүрээ.
2. Батч PC дээр Revit-ийг **тэр дансаар** нэвтрүүлж (`MGL > Тохиргоо`), хуучин токеныг дарж бичнэ (`%APPDATA%\RevitMcpAddin\settings.json`).
3. Windows талд батч task-ыг **тусдаа Windows хэрэглэгчийн** доор ажиллуул — домэйн админ БИШ, сүлжээний `.rvt` хавтас руу зөвхөн **уншихын** эрхтэй. `install-batch-task.ps1` одоо `-User`/`-Principal` заадаггүй (`:32-35`).
4. Тэр PC-г бусад ажилд **бүү ашигла** — §2.2-ийн хуучирсан queue-ийн эрсдэл нь ижил Windows хэрэглэгчийн доорх бүх Revit нээлтэд хамаарна.

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| Зүйл | Юу хамаарч байна |
|---|---|
| **`normalizeFactKey` / `normalizeRawName`** (`backend/src/lib/resourceMap.ts:20-22`, `backend/src/lib/qtoNormalize.ts:23-53`) | `combo_key` бол run-diff-ийн join түлхүүр **БА** `resource_alias` lookup түлхүүр. Нэг тэмдэгтийн өөрчлөлт бүх түүхэн run-ийг харьцуулах боломжгүй болгоно. §3.3 нь **оролтыг** л хянана, алгоритмыг **биш**. |
| **`MAX_STR = 256`-ийн УТГЫГ өсгөх** | `qto_facts` дахь бүх түүхэн мөр 256-аар таслагдсан. Хязгаарыг өсгөвөл шинэ run-ууд хуучинтайгаа **join хийхээ болино** — яг тэр асуудлыг үүсгэнэ. Хязгаарыг **бүү хөдөлгө**; зөвхөн илрүүл, эцэст нь татгалз. |
| **21 bind × 4 fact / 6 bind × 16 өрөө** (`qto.ts:842`, `:860-871`, `:875-889`) | D1-ийн 100 bind хязгаарт гар аргаар тааруулсан. `qto_facts`-д **багана нэмбэл** хоёуланг дахин тооц. Энэ сесст багана нэмэхгүй. |
| **`qto.use('*', requireRole(...QTO_ROLES))` (`qto.ts:39`)** | QTO-г **унших** бүх route (`/projects-overview`, `/projects/:id/dashboard`, `/runs/:id/facts`, `/schedules` …) энэ ганц мөрөөс хамгаалалтаа авдаг. `QTO_ROLES`-д role нэмэх нь **бүх QTO өгөгдлийг** тэр role-д нээнэ — push-ыг л биш. |
| **`Process.GetCurrentProcess().Kill()` (`BatchQto.cs:92`)** | Батч урсгалын **зориудын** төгсгөл. Устгавал 24/7 PC дээр Revit хуримтлагдаж, дараагийн батч гацна. Асуудал нь Kill биш — **триггер** нь. |
| **Батч горимд `TaskDialog` харуулахгүй** (`BatchQto.cs:20-22`) | Хүн байхгүй тул попап нь бүтэн session-ыг гацаана. Ямар ч оношилгооны мессежийг `batch-result.json`-д бич. |
| **`purpose === 'mcp'` токен `/api/*`-д ажиллах** (`middleware/auth.ts:46-55`, `lib/jwt.ts:70-92`) | Add-in **бүх** REST дуудлагаа тэр токеноор хийдэг, refresh урсгал байхгүй. Татгалзуулбал ~20 PC дээр Revit хаагаад `Install.bat` ажиллуулах шаардлагатай — **алсаас сэргээх боломжгүй**. |
| **Queue JSON-д илүүдэл талбар нэмэх аюулгүй байдал** | `BatchQto.cs:66`-д `JsonSerializerOptions` дамжуулаагүй тул анхдагч «үл тоомсорлох» зан төлөв. Хэрэв ирээдүйд `UnmappedMemberHandling.Disallow` тохируулбал §3.2-ийн nonce нь талбар дээрх **бүх** add-in-ыг унагаана. |
| **`push_id` дедупликац** (`qto.ts:677-686`) | Батч дахин оролдоход давхар run үүсгэхгүй. §3.3-ийн 422-г мөрийн давталтын **дараа**, `runInsert`-ийн **өмнө** тавь — өмнө нь буулгавал retry-ийн семантик өөрчлөгдөнө. |
| **`batch-queue.processing.json` руу нэрлэх (`BatchQto.cs:60-64`)** | Дахин ачаалалтаас хамгаалдаг зориудын механизм. PowerShell тал түүнийг **эхлэхдээ** л устгана (§3.2), ажиллаж байх үед **хэзээ ч** үгүй. |
| **`file_name` нь самбарын нэгтгэлийн нэгж** | Add-in файл тус бүрд тусдаа run илгээдэг (Decision #2). `file_name`-ийг норчлох/өөрчлөх нь бүх түүхэн самбарыг эвдэнэ. |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

### 5.1 Урьдчилсан нөхцөл

| # | Юу | Хаанаас |
|---|---|---|
| 1 | «QTO өгөгдөл нь үнийн ангилалынх уу?» — эзний шийдвэр | §9.1 |
| 2 | Батч PC өнөөдөр **ямар дансаар** ажилладаг, task **идэвхтэй** эсэх | §9.2 |
| 3 | Продакшнд 256 тэмдэгтэд хүрсэн identity утга **байгаа эсэх** | §9.3 |
| 4 | Бодит хамгийн том загварын мөрийн тоо | §9.4 |

§3.2 / §3.3 / §3.4 / §3.5 нь №1-гүйгээр явж болно. §3.1 нь №1-ийг **шаардана**.

### 5.2 Deploy дараалал

```
ӨНӨӨДӨР (код тэг)
  └─ §3.5  Батч PC → тусдаа least-privilege данс.  Deploy шаардахгүй.

DEPLOY 1  (backend worker, энэ сесс)
  ├─ §3.3  truncation тоолуур + warn лог + 201-д `truncated`  (STRICT_IDENTITY = false)
  ├─ §3.4  413-ийн биетэд { max_rows, got }
  └─ §3.1  (шийдвэр гарсан бол) intake-ийн зөвшөөрлийн өөрчлөлт

PS SHIP  (deploy биш — батч PC дээр гараар хуулна; DEPLOY 1-тэй ижил өдөр болж болно)
  └─ §3.2  batch-qto.ps1: эхлэлийн цэвэрлэгээ + nonce/pid/created_at + try/finally
           ⚠️ Одоогийн add-in эдгээр талбарыг ҮЛ ТООМСОРЛОНО — эвдрэлгүй.

1C РЕЛИЗ N   (add-in, ДАРАА, ЭНЭ СЕССЭД БИШ)
  ├─ BatchQueue-д Nonce/Pid/CreatedAt уншина — БАЙВАЛ хүндэтгэнэ,
  │  БАЙХГҮЙ бол хуучин ёсоор ажиллана          ← ТЭВЧИНЭ
  ├─ QtoExportCommand/BatchQto-д MAX_ROWS урьдчилсан шалгалт (FINDING 4)
  └─ 201-ийн `truncated > 0`-г хэрэглэгчид харуулна (FINDING 3)

DEPLOY 2  (backend, §9.3-ийн асуулга 0 таслалт харуулсны ДАРАА)
  └─ STRICT_IDENTITY = true → 422

1C РЕЛИЗ N+1 (add-in, хамгийн сүүлд)
  └─ Nonce ЗААВАЛ; nonce-гүй queue-г устгаад энгийн session хэвээр
```

**⚠️ Дарааллын хатуу дүрэм — урвуулбал шөнийн QTO батч ЧИМЭЭГҮЙ зогсоно.**
Add-in **эхлээд тэвчинэ (релиз N)**, зөвхөн **дараа нь шаардана (релиз N+1)**. Хэрэв add-in эхлээд nonce шаардвал, PowerShell script нь хуучин хэвээр байгаа PC дээр queue огт боловсрогдохгүй бөгөөд `batch-qto.ps1:97-101` нь «add-in batch-г огт эхлүүлээгүй» гэж бичээд `exit 1` хийнэ — өдөр бүр, чимээгүй, ямар ч сэрэмжлүүлэггүй.

**Програмын түвшний дүрэм:** шинэ багана нь түүнийг **уншдаг** кодоос **хатуу өмнөх** deploy-д ороx ёстой. Энэ сесст шинэ багана байхгүй; харин §3.3-ийн `truncated` талбар add-in уншихаас **өмнө** серверт байх ёстой — дээрх дараалал үүнийг хангаж байна.

**Мөн:** цуцлалтын хайлт (revocation lookup) хийх ажил гарвал тэр нь `authMiddleware` **БА** `resolveExternalToken` хоёулангаас дуудагдах **нэг ерөнхий helper** байх ёстой, **нэг deploy-д**. Энэ сесст тийм ажил **байхгүй** — 1A-3.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

**§3.3 (таслалт):**

- [ ] `backend/src/routes/qto.ts`-д `STRICT_IDENTITY` тогтмол байгаа, утга нь `false`.
- [ ] `MAX_STR` утга **256 хэвээр**.
- [ ] `combo_key` алгоритм **өөрчлөгдөөгүй**: `git diff backend/src/lib/resourceMap.ts backend/src/lib/qtoNormalize.ts` → **хоосон**.
- [ ] `category` / `type_name` / `material` / `file_name` дөрвүүлээ тоолуур авдаг helper-ээр дамжина.
- [ ] 300 тэмдэгттэй `type_name`-тай нэг мөр push хийхэд **201** буцаж, биед нь `"truncated": 1`.
- [ ] 200 тэмдэгттэй мөр push хийхэд `"truncated": 0`.
- [ ] `npx wrangler tail` дээр `[qto] identity truncation:` гэсэн warn мөр гарна.

**§3.4 (мөрийн тааз):**

- [ ] 20 001 мөр илгээхэд 413 буцаж, биед нь `max_rows: 20000` ба `got: 20001`.
- [ ] `MAX_ROWS` утга **20 000 хэвээр**.

**§3.1 (зөвшөөрөл) — сонгосон хувилбараас хамаарна:**

- [ ] Хувилбар C бол: `git diff backend/src/routes/qto.ts` нь **зөвхөн** §3.3 ба §3.4-ийн өөрчлөлтийг агуулна.
- [ ] Хувилбар A/B бол: `engineer` токеноор `GET /api/qto/projects-overview` → **403 хэвээр** (унших эрх өргөжөөгүй).
- [ ] Хувилбар B бол: `engineer` токеноор `POST /api/qto/revit-runs` → **201**, локал `wrangler dev` дээр **бодитоор** баталгаажсан (middleware дарааллыг таамаглаагүй).
- [ ] `qto.ts:27-28` ба `:642` дахь «admin-only» тайлбарууд шинэ бодит байдалтай нийцсэн.
- [ ] `backend/src/mcp/MglMcpAgent.ts:114-116`-ийг аудит хийж, шийдвэрээ тайлбарт бичсэн (код өөрчлөгдөх шаардлагагүй бол ч).

**§3.2 (батч дараалал):**

- [ ] `batch-qto.ps1` эхлэхэд `batch-queue.json` **ба** `batch-queue.processing.json`-ийг байвал устгаж, лог бичнэ.
- [ ] Бичигдсэн `batch-queue.json`-д `nonce`, `pid`, `created_at` талбарууд байна; `files` бүтэц **өөрчлөгдөөгүй** (`path` + `project_id`).
- [ ] Гараар турших: queue бичигдсэний дараа script-ийг Ctrl+C-ээр таслаад, дахин ажиллуулахад «хуучирсан batch-queue.json олдлоо — устгалаа» гэж бичигдэнэ.
- [ ] Шинэ script + **хуучин** add-in-аар бүтэн батч ажиллаж, `batch-result.json` дээр `ok: true` гарна (нийцлийн баталгаа).
- [ ] `README.md`-д хуучирсан queue-ийн тэмдэглэл ба Windows дансны шаардлага орсон.

**Хамрах хүрээний хяналт:**

- [ ] `git status --porcelain revit-mcp/addin` → **хоосон** (C# огт хөндөгдөөгүй).
- [ ] `git status --porcelain backend/migrations` → **хоосон** (миграц байхгүй).
- [ ] `git status --porcelain frontend` → **хоосон**.
- [ ] `cd backend && npx tsc --noEmit` — алдаа байвал **зөвхөн** миний хөндөөгүй файлд (жагсаалтыг гарга, бүү зас).
- [ ] `cd backend && npm test` — өмнөх baseline-тай ижил.

---

## 7. ШАЛГАХ КОМАНД

```bash
# --- Баталгаажуулалт (өөрчлөхөөс ӨМНӨ) ---------------------------------
sed -n '27,40p'   backend/src/routes/qto.ts        # QTO_ROLES + модулийн use
sed -n '636,672p' backend/src/routes/qto.ts        # str/num helper + requireAdmin + MAX_ROWS
sed -n '730,740p' backend/src/routes/qto.ts        # combo_key оролт
sed -n '910,924p' backend/src/routes/qto.ts        # 201 хариу
sed -n '36,45p'   revit-mcp/addin/BatchQto.cs      # Hook — файл байгаа эсэх л
sed -n '55,95p'   revit-mcp/addin/BatchQto.cs      # processing rename + Process.Kill
sed -n '28,35p'   revit-mcp/scripts/batch/batch-qto.ps1
sed -n '82,102p'  revit-mcp/scripts/batch/batch-qto.ps1
sed -n '20,36p'   revit-mcp/scripts/batch/install-batch-task.ps1
sed -n '12,18p'   revit-mcp/addin/ScheduleReader.cs   # клиент талын 5000 (харьцуулалт)

# --- Хамрах хүрээний хяналт ---------------------------------------------
git status --porcelain backend/migrations   # ХООСОН
git status --porcelain revit-mcp/addin      # ХООСОН
git status --porcelain frontend             # ХООСОН

# --- Typecheck + тест ----------------------------------------------------
cd backend && npx tsc --noEmit
cd backend && npm test

# --- Локал шалгалт -------------------------------------------------------
cd backend && npm run dev                   # wrangler dev :3000

# admin токеноор — 201 + truncated: 0
curl -s -X POST http://127.0.0.1:3000/api/qto/revit-runs \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"project_id":30,"file_name":"test.rvt","push_id":"t1",
       "rows":[{"category":"Walls","type_name":"W200","material":"Concrete","count":1}]}'

# 300 тэмдэгттэй type_name — 201 + truncated: 1
LONG=$(python -c "print('T'*300)")
curl -s -X POST http://127.0.0.1:3000/api/qto/revit-runs \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"project_id\":30,\"file_name\":\"test.rvt\",\"push_id\":\"t2\",
       \"rows\":[{\"category\":\"Walls\",\"type_name\":\"$LONG\",\"material\":\"C\",\"count\":1}]}"

# engineer токеноор — унших нь 403 ХЭВЭЭР байх ёстой
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/api/qto/projects-overview \
  -H "Authorization: Bearer $ENGINEER_TOKEN"

# Хувилбар B сонгосон бол — push нь 201 болох ёстой
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/qto/revit-runs \
  -H "Authorization: Bearer $ENGINEER_TOKEN" -H 'Content-Type: application/json' \
  -d '{"project_id":30,"file_name":"e.rvt","push_id":"e1",
       "rows":[{"category":"Walls","type_name":"W","material":"C","count":1}]}'

# --- Deploy (backend) ----------------------------------------------------
cd backend && npx tsc --noEmit && npx wrangler deploy --config wrangler.toml
#   ⚠️ --config ЗААВАЛ: репо root дахь wrangler.jsonc өөр worker зарладаг
#   ⚠️ wrangler deploy typecheck ХИЙХГҮЙ — дээрх tsc-г алгасаж болохгүй
npx wrangler tail --config wrangler.toml --format pretty | grep -i truncation
```

```powershell
# --- Батч PC дээр (PowerShell) -------------------------------------------
Test-Path "$env:APPDATA\RevitMcpAddin\batch-queue.json"             # $false байх ёстой
Test-Path "$env:APPDATA\RevitMcpAddin\batch-queue.processing.json"  # $false байх ёстой
Get-Content "$env:APPDATA\RevitMcpAddin\batch-log.txt" -Tail 30
Get-ScheduledTask -TaskName 'MGL QTO Batch' | Get-ScheduledTaskInfo
(Get-ScheduledTask -TaskName 'MGL QTO Batch').Principal              # ямар данс, ямар RunLevel
powershell -ExecutionPolicy Bypass -File revit-mcp\scripts\batch\batch-qto.ps1 -Force
Get-Content "$env:APPDATA\RevitMcpAddin\batch-result.json"
```

---

## 8. ROLLBACK

**Миграц байхгүй — ШИНЭ ДУГААР ШААРДЛАГАГҮЙ.** Энэ сесс схем хөндөхгүй.

| Юу | Хэрхэн буцаах |
|---|---|
| **Backend deploy (§3.1 / §3.3 / §3.4)** | Cloudflare dashboard → Worker → Deployments → өмнөх хувилбар руу rollback; эсвэл өмнөх commit-оос `npx wrangler deploy --config wrangler.toml`. **Өгөгдлийн алдагдал байхгүй** — 201/413-ийн шинэ талбарууд нэмэлт бөгөөд add-in тэдгээрийг үл тоомсорлодог. |
| **`STRICT_IDENTITY = true` (Deploy 2)** | `false` болгоод дахин deploy. Тэр хугацаанд татгалзагдсан push-ууд DB-д **юу ч үлдээгээгүй** (422 нь `runInsert`-ийн өмнө буудаг) тул зөвхөн дахин push хийнэ. |
| **§3.1 зөвшөөрлийн өргөтгөл** | `QTO_ROLES` / route gate-ыг өмнөх мөрөнд буцаах — нэг мөрийн revert + deploy. Аль хэдийн орсон `qto_runs` мөрүүд үлдэнэ (`created_by` нь тэр хүнийг зааж байна) — устгах шаардлагагүй, `DELETE /api/qto/runs/:id` бий (`qto.ts:924-940`). |
| **§3.2 PowerShell** | Батч PC дээр репо байхгүй тул `git checkout` **биш** — хуучин `batch-qto.ps1`-ийг буцааж хуулна. Queue JSON-ий нэмэлт талбарууд add-in-д ямар ч нөлөөгүй тул хагас байдал аюулгүй. |
| **§3.5 данс** | Батч PC дээр Revit нээж `MGL > Тохиргоо`-оос хуучин дансаар дахин нэвтэрнэ. ⚠️ Тусдаа дансны 365 хоногийн токен нь **хүчинтэй хэвээр** үлдэнэ — `JWT_SECRET` эргүүлэхээс өөр цуцлах арга байхгүй (1A-3-ийн ажил). |
| **Ямар ч тохиолдолд** | `revit-mcp/addin/**` хөндөгдөөгүй тул **add-in-ийг дахин тараах шаардлага үүсэхгүй**. Энэ бол сессийг ийм хэлбэрээр хуваасны гол шалтгаан. |

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

### 9.1 Эзэн — QTO өгөгдөл нь үнийн ангилалынх уу?

`§3.1`-ийн хувилбарыг **зөвхөн эзэн** шийднэ:

> Тоо хэмжээ (элементийн тоо, эзэлхүүн, талбай, материал) нь **үнийн санал шиг нууц** уу, эсвэл зургаа хийсэн **инженерийн ажлын үр дүн** үү?
> - Нууц бол → **Хувилбар C** (хэвээр `admin`), эрсдэлийг зөвхөн тусдаа дансаар бууруулна.
> - Ажлын үр дүн бол → **Хувилбар A** (`senior`) эсвэл **B** (`engineer`/`architect`).

Контекст өгөх: одоо `senior` нь QTO-г **уншиж** чаддаг (`QTO_ROLES = ['admin','senior']`), зөвхөн **бичиж** чаддаггүй. Тэр тэнцвэр зориудынх эсэхийг асуу.

### 9.2 Батч PC — өнөөдөр ямар байна вэ (репогоос мэдэгдэхгүй)

| Асуулт | Хэрхэн олох |
|---|---|
| Ямар **вэб дансаар** нэвтэрсэн бэ (`users.id`)? | D1: `SELECT DISTINCT created_by FROM qto_runs WHERE source='revit' ORDER BY id DESC LIMIT 20;` → `users`-тэй холбох |
| Ямар **Windows дансаар** ажилладаг вэ, домэйн админ уу? | `(Get-ScheduledTask -TaskName 'MGL QTO Batch').Principal` |
| Шөнийн task **идэвхтэй** юу, сүүлд хэзээ ажилласан, үр дүн нь юу вэ? | `Get-ScheduledTask -TaskName 'MGL QTO Batch' \| Get-ScheduledTaskInfo` (`State`, `LastRunTime`, `LastTaskResult`) |
| Тэр PC-ийг **өөр ажилд** ашигладаг уу (интерактив Revit)? | Эзнээс асуух — FINDING 2-ийн бодит нөлөө үүнээс хамаарна |
| Одоо `batch-queue.json` **үлдсэн** байгаа юу? | `Test-Path "$env:APPDATA\RevitMcpAddin\batch-queue.json"` — **тийм** бол энэ нь ИДЭВХТЭЙ эрсдэл, шууд устга |

### 9.3 Продакшн — identity таслалт бодитоор тохиолдож байсан уу?

```bash
# 256 тэмдэгттэй ЯГ ТЭНЦҮҮ утга = таслагдсаны шинж тэмдэг
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT
      SUM(LENGTH(category)  = 256) AS cat256,
      SUM(LENGTH(type_name) = 256) AS typ256,
      SUM(LENGTH(material)  = 256) AS mat256,
      MAX(LENGTH(type_name)) AS max_type_len,
      MAX(LENGTH(material))  AS max_mat_len,
      COUNT(*) AS total
    FROM qto_facts"
```
Бүгд `0` бол `STRICT_IDENTITY = true`-г Deploy 2-т **эрсдэлгүй** асаана. Тэгээс их бол эхлээд тэдгээр мөрүүдийг эзэнд харуул — `combo_key` аль хэдийн хуваагдсан байж болзошгүй.

```bash
# Нэг combo_key хэдэн run дээр байна — diff-ийн тогтвортой байдлын хяналт
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT combo_key, COUNT(DISTINCT qto_run_id) AS runs
             FROM qto_facts GROUP BY combo_key ORDER BY runs DESC LIMIT 10"
```

### 9.4 Продакшн — хамгийн том загварын бодит мөрийн тоо

```bash
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT qto_run_id, COUNT(*) AS facts FROM qto_facts
             GROUP BY qto_run_id ORDER BY facts DESC LIMIT 10"

npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT id, file_name, element_count, created_at, created_by
             FROM qto_runs WHERE source='revit'
             ORDER BY element_count DESC LIMIT 10"
```

Хамгийн их `facts` нь 20 000-аас **хол доогуур** бол FINDING 4 нь онолын; **ойрхон** бол 1C релизийн урьдчилсан шалгалт тэргүүлэх ач холбогдолтой. `element_count` (задлагдсан элемент) ба `facts` (бүлэглэсэн мөр) хоёрын харьцаа нь add-in-ий бүлэглэлт хэр үр дүнтэйг харуулна.

### 9.5 Бусад тодруулга

| # | Асуулт | Хэн хариулах |
|---|---|---|
| 1 | Хуучирсан queue-ийн TTL хэдэн цаг байх вэ? (санал: **6 цаг** — `timeout_minutes` анхдагч 90 мин, task-ууд 02:00 / 12:30 / 18:30, хамгийн ойрхон зай 6 цаг) | Эзэн / батч операторч |
| 2 | Батч дансыг цуцлах шаардлага гарвал `JWT_SECRET` эргүүлэх нь **бүх** session, add-in, print job-ыг алдаг. Токен цуцлалтын жагсаалт (**1A-3**) хэзээ ирэх вэ? | Програмын дараалал |
| 3 | `truncated > 0` үед add-in хэрэглэгчид **юу харуулах** вэ (1C-ийн агуулга)? Батч горимд зөвхөн `batch-result.json` — интерактив горимд юу вэ? | Эзэн |
| 4 | Хувилбар B сонговол `qto_runs.created_by` нь түүхэн `admin` дансны мөртэй холилдоно — тайланд ялгах шаардлагатай юу? | Эзэн |
| 5 | Батч PC-ийн Revit лиценз нь TRIAL уу, жинхэнэ юу? (`README.md`-ийн «Анхаарах зүйлс» — TRIAL попап нь автоматжуулалтыг зогсоодог) | Эзэн |
