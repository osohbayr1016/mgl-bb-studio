# 1A-2-mcp-boundary — MCP хилийн хаалт — worker эскалаци, tenant tid, fail-closed

> **Track:** 1A · PRODUCTION SAFETY (item 2)
> **Хамаарал (depends on):** байхгүй — бие даан явна. `1A-1 media traversal`-тай зэрэгцэн ажиллаж болно (огт өөр файлууд).
> **Блоклож буй (blocks):** `1A-4 tenant preflight` (энэ сесс `/mcp`-г олон-tenant үед fail-closed болгоно; 1A-4 нь `TENANTS` утга бичихээс өмнө тэр хаалтыг хянана). `1A-3 token lifecycle` (revocation helper нь энэ сессийн үлдээсэн L1 давхаргад залгагдана).
> **Хөндөх файлууд:** `backend/src/mcp/guard.ts` (ШИНЭ), `backend/src/mcp/guard.test.ts` (ШИНЭ), `backend/src/mcp/MglMcpAgent.ts`, `backend/src/index.ts`, `backend/src/oauth/authorize.ts`. **Өөр ЮУ Ч БИШ.**
> **Deploy тоо:** **1** (backend worker). Миграц **байхгүй**. Frontend **байхгүй**. Add-in (C#) **байхгүй**.

---

## 0. ЭНЭ СЕССИЙН ДҮРЭМ

| ⛔ | Дүрэм |
|---|---|
| 1 | **`purpose === 'mcp'`-ийг `/api/*`-д ХЭЗЭЭ Ч татгалзуулж болохгүй.** Revit add-in нь БҮХ REST дуудлагаа тэр токеноор хийдэг бөгөөд refresh урсгал байхгүй. Энэ бол алсаас сэргээх боломжгүй цорын ганц өөрчлөлт — ~20 компьютер, `Install.bat`, Revit хаалттай. `middleware/auth.ts`-ийн `authMiddleware` болон `lib/jwt.ts`-ийн `verifyToken`-д purpose шалгалт **НЭМЭХГҮЙ**. |
| 2 | **Бусад агентын ажлыг битгий хөнд.** Энэ репод хэд хэдэн хөгжүүлэгч зэрэг ажилладаг тул ажлын мод дээр өөр хүний дуусаагүй, магадгүй компайл хийхгүй өөрчлөлт байж болно. `git restore` / `git checkout --` / `git stash` **хийхгүй**; өөрийн бус файлыг `git add` **хийхгүй**. |
| 3 | **Бүтэн build унасан нь автоматаар таных биш.** `tsc --noEmit` нь бүх worker-ийг компайл хийдэг тул чиний хөндөөгүй файл дээр унаж болно. Алдаанууд зөвхөн хамааралгүй файлууд дээр байгааг батал, дараа нь тэр саадыг эзэнд **мэдэгд** — өөрөө засахыг битгий оролд. |
| 4 | **Миграц бичихгүй.** Энэ ажил цэвэр код. Хэрэв схем хэрэгтэй болвол зогсоод асуу. |
| 5 | **Deploy хийж БОЛНО**, гэхдээ зөвхөн §6 бүрэн биелсэн, §7-ийн бүх команд ногоон болсны дараа, эзний зөвшөөрөлтэй. Deploy нь `backend/` worker ганцаараа. |
| 6 | Энэ ажил **backend only**. `frontend/`, `revit-mcp/`, `backend/migrations/` — гурвуулан **хөндөхгүй**. |

**Хамрах хүрээнээс ГАДУУР (татагдаж орох гэж оролдох зүйлс):**

- `POST /api/auth/mcp-token`-д role gate нэмэх → **буруу засвар**, §2.4-ийг үз.
- `resolveExternalToken`-д `purpose === 'mcp'` шаардах → технически аюулгүй ч (§4.3) **энэ сесст биш**, `1A-3 token lifecycle`-д харьяална.
- Revocation / denylist → `1A-3`.
- `client` role-ыг `/mcp`-с хаах → эзний бүтээгдэхүүний шийдвэр, §9.3.
- `/api/documents`, `/media` зэрэг бусад нээлттэй гарц → `1A-1` ба тусдаа ажил.

---

## 1. КОНТЕКСТ

### Систем (хүйтэн сесст хангалттай хэмжээгээр)

- **`backend/`** — Cloudflare Worker. Гол export нь Hono **БИШ**, харин `@cloudflare/workers-oauth-provider` (v0.7.2). Provider нь `/token`, `/register`, `/.well-known/oauth-*`-ыг өөрөө хэрэгжүүлж, `apiHandlers`-т бүртгэсэн замуудыг OAuth-оор хамгаалж, **бусад бүхнийг** `defaultHandler` буюу Hono `app`-д шилжүүлнэ.
- Хадгалалт: **D1** (SQLite, `mgl-progress-db-v3`, 45 МБ / 114 хүснэгт) · **R2** `MEDIA_BUCKET` (НИЙТИЙН) + `MEETING_BUCKET` (хаалттай) · **KV** `OAUTH_KV` (нэр нь ачаа даадаг — библиотек яг тэр мөрөөр шийддэг) · **Durable Object** `MCP_OBJECT` → `MglMcpAgent`.
- **`frontend/`** — Vite + React 19 SPA, Cloudflare Pages дээр (`mgl-design-system`). Энэ ажилд хамааралгүй.
- **`revit-mcp/addin/`** — Revit 2024–2027 C#/WPF add-in, ~16 мянган мөр / 47 файл, **тест тэг**, ажилтны компьютер дээр **албадан шинэчлэх механизм байхгүй**. Add-in нь `/api/*` REST-ээр л ярьдаг; `/mcp` рүү **огт залгадаггүй**.
- Ажилтан: ~49 идэвхтэй мэдлэгийн ажилтан.
- **Role 6 ширхэг**: `admin | engineer | architect | senior | client | worker` (`backend/src/types.ts:230`). `worker` (цэвэрлэгч) нь 2026-08-д миграц 0136-аар нэмэгдсэн, ЗӨВХӨН ирцээ бүртгэдэг.
- **Deploy нь ЛОКАЛ wrangler, CI биш** — GitHub-ийн хоёр workflow хоёулаа үхсэн. `npx wrangler deploy --config wrangler.toml` — `--config` нь **заавал**, учир нь репогийн root дээрх `wrangler.jsonc` өөр worker зарладаг ба wrangler-ийн config discovery түүнийг сонгож болно. `wrangler deploy` нь **typecheck хийхгүй** — `tsc --noEmit`-ыг өөрөө ажиллуул.
- Production API host: `https://mgl-progress-api.mglenc-design.workers.dev` (`frontend/src/shared/api/apiHost.ts:12`).

### Яагаад энэ ажил байгаа вэ

`/api/*` дээр гурван хамгаалалтын давхарга дараалан суудаг — `authMiddleware`, `workerScopeGuard`, `entitlementGuard` (`backend/src/index.ts:144`, `:147`, `:150`). **`/mcp` ба `/sse` нь эдгээрийн НЭГЭНД Ч ХАМРАГДАХГҮЙ**: тэдгээр нь OAuth provider-ийн эзэмшдэг root замууд бөгөөд Hono-гийн middleware гинжинд огт ордоггүй. `backend/src/lib/entitlement.ts:29-32` энэ цоорхойг өөрөө бичгээр хүлээн зөвшөөрсөн байдаг:

```
 * ⚠️ ЭНЭ ХААЛТ `/api/*`-д Л СУУНА.  `/mcp` нь OAuth provider-ийн эзэмшдэг
 *    root зам тул энд ХАМРАГДАХГҮЙ — `workerScope`-ийн адил цоорхой.
 *    MCP талын хязгаарлалт `mcp/MglMcpAgent.ts`-ийн `init()`-д тусад нь
 *    хийгдэх ёстой (одоогоор хийгдээгүй).
```

Үүнээс **гурван бодит асуудал** урган гарна: (1) `worker` role-ийн эрхийн давалт, (2) олон-tenant `tid` шалгалт `/mcp`-д огт хийгддэггүй, (3) хаалт нэмэхэд буруу тааруулбал тойрч гарах зам үлдэнэ.

**Гурван асуудлын өмнөх санал бүр няцаагдсан.** Доор няцаалт бүрийг эх кодоор нотолсон, дараа нь ЗӨВ хувилбарыг өгсөн.

---

## 2. БАТАЛГААЖСАН ОДООГИЙН ЗАН ТӨЛӨВ

> Доорх мөр бүрийг 2026-08-27-нд `d7fecf5` commit дээр биечлэн нээж шалгасан.
> Гуравдагч талын код (`node_modules`)-ийн мөрийн дугаар нь `@cloudflare/workers-oauth-provider@0.7.2` ба `agents@0.15.0`-д хамаарна — өөр хувилбар суулгасан бол дахин шалга.

### 2.1 Provider-ийн угсраа ба apiHandlers

`backend/src/index.ts:267-268`:

```ts
const mcpStreamable = MglMcpAgent.serve('/mcp'); // Streamable HTTP
const mcpSse = MglMcpAgent.serveSSE('/sse'); // legacy SSE
```

`backend/src/index.ts:275-297`:

```ts
const oauthProvider = new OAuthProvider<Env>({
  apiHandlers: {
    '/mcp': mcpStreamable,
    '/sse': mcpSse,
  },
  defaultHandler: { fetch: (request, env, ctx) => app.fetch(request, env, ctx) } as ExportedHandler<Env>,
  ...
  resolveExternalToken: async ({ token, env }) => {
    const payload = await verifyToken(token, env.JWT_SECRET);
    if (!payload) return null;
    return { props: { sub: payload.sub, role: payload.role } satisfies McpProps };
  },
});
```

`resolveExternalToken` нь **`index.ts:292-296`**. `purpose` шалгахгүй, `tid` уншихгүй, role шүүхгүй.

### 2.2 Hono-гийн гурван хаалт `/api/*`-д Л суудаг

| Хаалт | Суулгасан мөр |
|---|---|
| `authMiddleware` | `backend/src/index.ts:144` → `app.use('/api/*', authMiddleware);` |
| `workerScopeGuard` | `backend/src/index.ts:147` |
| `entitlementGuard` | `backend/src/index.ts:150` |

`/mcp`, `/sse` нь `app`-д огт хүрэхгүй — provider тэднийг `apiHandlers`-ээр таслан авдаг.

### 2.3 Provider дахь bearer-ийн салаа — `resolveExternalToken` ХЭЗЭЭ дуудагддаг вэ

`backend/node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js:1984` `handleApiRequest`:

- `:1993` — bearer-ыг `:`-ээр задалж `parts.length === 3` бол л «дотоод формат» гэж үзнэ. JWT-д `:` байхгүй тул үргэлж **1** → `isPossiblyInternalFormat = false` → `tokenData = null`.
- `:2004` — `tokenData` ч алга, `resolveExternalToken` ч алга бол 401.
- `:2025` — **`tokenData` байвал**: `ctx.props = await decryptProps(...)` — OAuth grant-ийн салаа.
- `:2027-2046` — **эсрэг тохиолдолд Л**: `const ext = await this.options.resolveExternalToken({...})` → `ctx.props = ext.props`.
- `:2054` — `apiHandler.handler.fetch(request, env, ctx)` — **`ctx.props` аль хэдийн тавигдсан байна**.

➡️ **Баталгаажлаа:** `resolveExternalToken` нь bearer нь `OAUTH_KV`-д байгаа OAuth токен **биш** үед Л дуудагдана. OAuth access token нь `decryptProps` салаагаар явдаг тул `resolveExternalToken` доторх ямар ч шалгалт **тэр урсгалыг огт хамрахгүй**.

`backend/src/oauth/authorize.ts:152`:

```ts
const props: McpProps = { sub: user.id, role: user.role };
```

➡️ OAuth grant нь `tid`-гүй, role шүүлтгүй мянтдагдана (`:152-159`). Нэвтрэлт нь `/api/auth/login`-ийн ЯГ ижил шалгалт (`:142-148`) — `status='active'` + bcrypt. **`role` огт харагддаггүй**, тиймээс `worker` бүрэн эрхтэй OAuth grant авч чадна.

### 2.4 (1) WORKER ROLE-ИЙН ЭРХИЙН ДАВАЛТ

**Өмнөх санал: «`worker`-ыг `POST /api/auth/mcp-token`-с хаа». ЭНЭ БУРУУ.** Дөрвөн баримт үүнийг няцаана:

| # | Баримт | Нотолгоо |
|---|---|---|
| а | `POST /api/auth/login` нь токеныг **хариуны бие дотор** буцаана | `backend/src/routes/auth.ts:44` `const token = await signToken({ sub: user.id, role: user.role }, c.env.JWT_SECRET);` → `:56` `return c.json({ user: profile, token });` |
| б | `/api/auth` нь `worker`-т **цагаан жагсаалтад бий** | `backend/src/lib/workerScope.ts:20` `'/api/auth',` (жагсаалт `:18-33`, тааруулагч `:38-40` сегментийн хилээр) |
| в | `resolveExternalToken` нь **гарын үсэг зөв, хугацаа дуусаагүй ЛЮБОЙ JWT**-г хүлээж авна | `backend/src/index.ts:292-296` — `purpose` шалгалтгүй |
| г | `verifyToken` нь зөвхөн **гарын үсэг + `exp`** шалгана | `backend/src/lib/jwt.ts:71-93`; `alg` шалгалт байхгүй, `purpose` шалгалт байхгүй, хүчингүйжүүлэлт байхгүй (`:88` — `if (payload.exp < Math.floor(Date.now()/1000)) return null;`) |

➡️ **Тиймээс `mcp-token`-г хаах нь юуг ч зогсоохгүй**: `worker` өөрийн ердийн **24 цагийн session токеноо** шууд `/mcp` рүү өгөөд бүрэн Tier-1 + Tier-2 шатыг авна. (`POST /api/auth/mcp-token` нь `routes/auth.ts:71-80` — үнэхээр role gate-гүй, гэхдээ энэ нь **цорын ганц** зам биш, тиймээс тэнд засах нь утгагүй.)

**Юу нээгддэг вэ.** `backend/src/mcp/MglMcpAgent.ts:51-139`-ийн дөрвөн шатны шат:

| Шат | Нөхцөл | Мөр | `worker` авах уу |
|---|---|---|---|
| Tier 1 | нэвтэрсэн бүх хүн | `:57-91` | **ТИЙМ** |
| Tier 2 | `if (user.role !== 'client')` | `:95-100` | **ТИЙМ** |
| Tier 3 | `if (isAdminRole(user.role) \|\| user.role === 'senior')` | `:104-117` | Үгүй |
| Tier 4 | `if (isAdminRole(user.role))` | `:121-138` | Үгүй |

`worker` бодитоор авах 13 tool: `list_projects`, `get_project_progress` (`tools/projects.ts`), `get_project_report`, `get_project_breakdown` (`tools/report.ts`), `generate_report`, `get_report_content` (`tools/generateReport.ts`), `get_team_reports`, `get_project_info`, `list_my_tasks`, `list_overdue_tasks`, `get_correspondence_log` (`tools/emailRead.ts:143`) — эдгээр нь Tier-1; дээр нь Tier-2-ийн `get_company_overview` + `get_report_template` + `write_word_report` prompt.

**Хамгийн хүнд нь `get_company_overview`.** `backend/src/mcp/tools/company.ts:24` `void user;` — хэрэглэгчээр огт шүүхгүй; `:66` `const all = await fetchVisibleProjects(env, user, true);` — гурав дахь аргумент нь **хатуу `true`**, өөрөөр хэлбэл `canSeeAll` шалгалтыг тойрч **бүх төслийг** буцаана. Мөн `:52-61`-ийн `totals` нь компанийн бүх төсөл / хэрэглэгч / таскийн тоог өгнө. Түүний REST хос болох `/api/company/*` нь `worker`-т **403** (цагаан жагсаалтад байхгүй, `lib/workerScope.ts:18-33`).

Харьцуулбал `list_projects` нь `canSeeAllProjects(role)`-оор шүүгддэг (`tools/projects.ts:29-36` — `worker` худал буцаана) тул тэр нь гишүүнчлэлээр хязгаарлагдана. Өөрөөр хэлбэл **эрхийн давалтын гол ачаа нь `get_company_overview`** дээр байна.

`grep -rn "worker" backend/src/mcp/` → **тэг үр дүн**. MCP давхаргад `worker` гэдэг ойлголт огт байхгүй.

➡️ **ЗӨВ ЗАСВАР:** `MglMcpAgent.init()` доторх **нөхцөлгүй role gate** + Worker талын wrapper дээрх 403 (§3.2, §3.3).

### 2.5 (2) `/mcp`-д TENANT `tid` ШАЛГАГДДАГГҮЙ

`backend/src/lib/tenants.ts:19-33` нь аюулгүй байдлын зарчмаа өөрөө тайлбарлана:

```
 *   • `JWT_SECRET` нь Worker-т НЭГ.  Тиймээс A компанид олгосон токен нь
 *     B компанийн контекстэд ч гарын үсгийн хувьд ХҮЧИНТЭЙ шалгагдана.
 *   • Токены `sub` нь ТУХАЙН компанийн DB доторх user id.  A-гийн `sub: 5`
 *     нь B-д ӨӨР ХҮН байна.
```

Тиймээс токен бүр `tid` claim авдаг: `backend/src/lib/jwt.ts:54-59` — `signToken` нь **11 дуудагч бүр дээр биш, ганц газарт** `tid`-ийг автоматаар шигтгэдэг:

```ts
...(hasTenantContext() && payload.tid === undefined ? { tid: currentTenantId() } : {}),
```

`tid` claim-ийн тодорхойлолт: `backend/src/types.ts:208` (`tid?: string;`, тайлбар `:195-207`).

Шалгалт нь **зөвхөн** `backend/src/middleware/auth.ts:80-88`-д байна:

```ts
if (hasTenantContext()) {
  const expected = currentTenantId();
  if (payload.tid !== expected) { ...; return c.json({ error: 'Invalid or expired token' }, 401); }
}
```

`authMiddleware` нь `/api/*`-д Л суудаг (`index.ts:144`) → **`/mcp` дээр энэ шалгалт огт хийгддэггүй**.

`resolveExternalToken` (`index.ts:292-296`) нь `payload.sub`, `payload.role` хоёрыг Л уншиж `payload.tid`-ийг **огт хардаггүй**. Тэр мөчид `runWithTenant` **аль хэдийн `env.DB`-г сольсон байна** (`index.ts:341` `tenantEnv`, `:354` `runWithTenant`) — өөрөөр хэлбэл A компанийн токен B компанийн DB рүү хандах бүх нөхцөл бүрдчихсэн байдаг.

**Өмнөх санал: «шалгалтыг `resolveExternalToken` дотор хий». БУРУУ ГАЗАР.** §2.3-ын нотолгооны дагуу `resolveExternalToken` нь **зөвхөн legacy JWT** салаанд дуудагддаг; **OAuth access token нь `decryptProps` салаагаар (`oauth-provider.js:2025`) явна**, тэнд чиний код огт ажиллахгүй. Мөн `oauth/authorize.ts:152` нь props-ыг `tid`-гүй мянтдаг. Тиймээс тэнд тавьсан шалгалт нь **хоёр эх үүсвэрийн зөвхөн нэгийг** нь барина.

➡️ **ХОЁР ЭХ ҮҮСВЭР НИЙЛДЭГ ГАЗАР** нь `ctx.props` — `oauth-provider.js:2054` дээр `apiHandler.handler.fetch(request, env, ctx)` дуудагдахаас өмнө хоёр салаа хоёулаа `ctx.props`-ыг тавьсан байна. Тиймээс шалгалт нь **apiHandlers-ийн wrapper** дээр (Worker талд, `runWithTenant` дотор) сууна; `MglMcpAgent.init()` нь **хоёр дахь давхарга** болно. `tid`-ийг OAuth grant-д **нэг commit дотор** нэмнэ.

#### ⚠️ ЗАЛРУУЛГА — `init()` дотор `tid`-ийг ЮУТАЙ ТУЛГАХ вэ?

Даалгаварт «шалгалт `MglMcpAgent.init()`-д, `props.tid`-ийн эсрэг байх ёстой» гэсэн нь **хагас зөв**. `init()` нь **Durable Object дотор** ажилладаг:

- `runWithTenant`-ийн `AsyncLocalStorage` (`backend/src/lib/requestContext.ts:38-53`) нь **DO-ийн хил давдаггүй**. Тиймээс DO дотор `hasTenantContext() === false`, `currentTenantId() === 'default'` (`:36`, `:46-48`).
- `TenantSpec` (`backend/src/lib/tenants.ts:37-53`)-д **`MCP_OBJECT` талбар БАЙХГҮЙ**, `tenantEnv` нь зөвхөн `DB` (`:191`), `MEDIA_BUCKET` (`:196`), `MEETING_BUCKET` (`:201`)-ыг сольдог. `agents/dist/mcp/index.js:1665` нь `env[binding]` («MCP_OBJECT»)-ыг л уншдаг, харин DO нь өөрөө instantiate хийгдэхдээ **Worker script-ийнхээ өөрийн env**-ийг авдаг — дуудагчийн зассан объектыг биш.

➡️ **Дүгнэлт:** `init()` доторх шалгалт нь «хүсэлт аль tenant-ынх вэ» гэдгийг **мэдэх боломжгүй**, хэрэв тэр утгыг гаднаас (props-оор) шигтгээгүй бол. Мөн үүнээс улбаалж **олон-tenant үед `/mcp` нь ямар ч tenant-д ҮНДСЭН `DB`-г уншина** — өөрөөр хэлбэл tid шалгалт зөв ажилласан ч өгөгдлийн тусгаарлалт байхгүй. Энэ шалтгаанаар §3.4-ийн fail-closed L0 давхарга нь олон-tenant үед `/mcp`-г **бүхэлд нь 503** болгоно.

### 2.6 (3) FAIL-CLOSED ХААЛТЫН ТААРУУЛАЛТ

**Өмнөх санал: «хоёр замын нэрийг ЯГ ТЭНЦҮҮГЭЭР тааруул». ДУТУУ.** Гурван шалтгаан:

**(а) Provider нь `startsWith`-ээр илгээдэг.** `oauth-provider.js:1042-1050`:

```js
matchApiRoute(url, route) {
    if (this.isPath(route)) {
        if (route === "/") return url.pathname === "/";
        return url.pathname.startsWith(route);
    } ...
}
```

`isApiRequest` (`:1056`) ба `findApiHandlerForUrl` (`:1065`) хоёул үүнийг ашиглана. Тиймээс `/mcp-anything`, `/sse/x`, `/mcpX` бүгд MCP handler руу очно (мөн provider тэдгээрийн токеныг эхлээд шалгаад `ctx.props` тавина). **Сегментийн хилээр (`p` эсвэл `p + '/'`) тааруулсан хаалт нь `/mcpX`-ыг АЛДАНА** — тиймээс хаалт нь provider-ийн ЯГ ТЭР семантикийг, өөрөөр хэлбэл нүцгэн `pathname.startsWith(p)`-ыг ашиглах ёстой.

**(б) Legacy SSE нь хүүхэд зам бүртгэдэг ба JSON-RPC дуудлага бүр ТЭНД POST хийгддэг.** `backend/node_modules/agents/dist/mcp/index.js`:

- `:387` — `const messagePattern = new URLPattern({ pathname: basePath + '/message' });`
- `:396` — `endpointUrl.pathname = encodeURI(basePath + '/message');` — SSE эхлэхэд клиентэд ЭНЭ хаягийг өгнө.
- `:460-466` — `POST {basePath}/message?sessionId=…` дээр `getAgentByName(namespace, 'sse:' + sessionId, { props: ctx.props, ... })` → `onSSEMcpMessage(...)`.

➡️ `/sse` дээрх ЯГ ТЭНЦҮҮ хаалт нь `/sse/message`-ыг алдана — тэгвэл tool дуудлага бүр хаалтыг тойрч гарна.

**(в) Хаалтын түлхүүрийг `hasTenantContext()`-д БҮҮ тулгуур — АНГИЛЛЫН АЛДАА.** `backend/src/index.ts:321-355`-ийн гадаад `fetch`:

```
:322   const tenants = parseTenants(env.TENANTS);
:323   if (!tenants) return oauthProvider.fetch(request, env, ctx);
:326   const hit = resolveTenant(tenants, {...});
:341   const scoped = tenantEnv(env, hit.tenant);
:354   return runWithTenant(hit.tenant.id, () => oauthProvider.fetch(request, scoped, ctx));
```

**`runWithTenant` нь `:354`-д Л эхэлдэг.** Тиймээс `:322`–`:353` хооронд ажиллах ЛЮБОЙ код дээр `hasTenantContext()` нь **худал**, `currentTenantId()` нь `'default'`. Гадаад `fetch`-д тавьсан «`if (hasTenantContext())`» хэлбэрийн хаалт нь **үргэлж алгасагдана** — өөрөөр хэлбэл чимээгүй fail-open.

Одоогийн репод энэ алдаа **байхгүй** — доорх бүх дуудагч `runWithTenant`-ийн ДОТОР ажилладаг:

| Дуудалт | Файл | ДОТОР уу |
|---|---|---|
| `hasTenantContext()` / `currentTenantId()` | `backend/src/lib/jwt.ts:56` (`signToken`) | Тийм — route-уудаас дуудагдана |
| `currentTenantId()` | `backend/src/lib/orgConfig.ts:389`, `:394`, `:452` | Тийм — `app.use('*')` (`index.ts:117-120`) нь provider-ийн доор явна. **Гэхдээ cron (`index.ts:361`) нь `runWithTenant`-гүй** → зориудаар `'default'` |
| `hasTenantContext()` | `backend/src/middleware/auth.ts:80` | Тийм — `/api/*` middleware |

➡️ **Шинэ код бичих бүрд `grep -rn "hasTenantContext\|currentTenantId" backend/src/` ажиллуулж, дуудагч нь `index.ts:354`-ийн ДАРАА ажиллаж байгаа эсэхийг батал.** Энэ бол нэг тохиолдол биш, **ангиллын алдаа**.

### 2.7 Props-ын амьдралын мөчлөг (яагаад хоёр давхарга хэрэгтэй вэ)

`agents@0.15.0`:

- `:167`, `:401`, `:466` — хүсэлт болгонд `getAgentByName(..., { props: ctx.props })`.
- `:1500-1503` — `async onStart(props) { if (props) await this.updateProps(props); else this.props = await this.ctx.storage.get("props"); await this.init(); }`
- `:1491-1493` — `updateProps` нь props-ыг **DO storage-д хадгална**.

➡️ `init()` нь DO **сэрэх** бүрд ажиллана, ба props нь storage-аас сэргэж болно. Тиймээс Worker талын wrapper (§3.3) нь цэвэр 403 өгөх ажлыг, `init()` доторх gate (§3.2) нь **сэрэлтийн замыг** барина. Хоёулаа хэрэгтэй.

### 2.8 Хажуугийн олдвор (энэ сесст ЗАСАХГҮЙ)

`backend/src/routes/revit.ts:1703`-ийн тайлбар `// 12 bind/мөр → floor(100/12) = 8 мөр/statement.` нь `:1706`-гийн `const BINDS = 13;`-тэй **зөрчилдөнө** (дараагийн мөрийн `13 × 7 = 91 ≤ 100` нь зөв). Хуучирсан нь **тайлбарын эхний мөр**, тогтмол нь зөв. Хамрах хүрээнээс гадуур — зөвхөн тэмдэглэв.

---

## 3. ХИЙХ АЖИЛ

Гурван давхарга. **L0 → L1 → L2 гэсэн дугаартай ч, бичих дараалал нь 3.1 → 3.7.** Нэг commit, нэг deploy.

### 3.1 ШИНЭ ФАЙЛ — `backend/src/mcp/guard.ts` (цэвэр функцүүд)

Бүх шийдвэрийг **цэвэр, тестлэгдэх** функц болгож нэг файлд төвлөрүүл. `apiHandlers`-ийн түлхүүрүүд ЭНД амьдарна, ингэснээр хаалт ба маршрутын жагсаалт **салж чадахгүй**.

```ts
import type { UserRole } from '../types';

/**
 * MCP-Д ХЭЗЭЭ Ч ОРУУЛАХГҮЙ role.
 *
 * `worker` (цэвэрлэгч) нь `lib/workerScope.ts`-ийн цагаан жагсаалтаар `/api/*`
 * дээр ирц/чөлөөнөөс өөр юунд ч хүрдэггүй.  `/mcp` нь тэр хаалтын ГАДНА тул
 * шат нь түүнд `get_company_overview` хүртэл нээгддэг байсан — REST хос нь
 * 403 өгдөг зүйл.  Энэ бол цагаан биш ХАР жагсаалт: MCP-ийн шат нь
 * `role !== 'client'` дээр суурилдаг тул шинэ role нэмэгдэхэд тэр нь
 * анхдагчаар НЭЭЛТТЭЙ байдаг.  Шинэ role нэмэх бүрд ЭНД шийдвэр гарга.
 */
export const MCP_DENIED_ROLES: readonly UserRole[] = ['worker'] as const;

/**
 * OAuth provider-ийн `apiHandlers` түлхүүрүүд.  ⚠️ Хаалт ба маршрут САЛЖ
 * БОЛОХГҮЙ тул `index.ts` нь ЭНЭ жагсаалтаас handler map-аа барина.
 */
export const MCP_ROUTES = ['/mcp', '/sse'] as const;

/**
 * Provider-ийн `matchApiRoute` нь `url.pathname.startsWith(route)` (0.7.2,
 * `dist/oauth-provider.js:1042-1050`).  Тиймээс `/mcpX` ч тэр handler руу
 * очно.  ЯГ ТЭР семантикийг давтана — сегментийн хилээр тааруулбал `/mcpX`
 * хаалтыг тойрч гарна.  Мөн legacy SSE нь `/sse/message` дээр JSON-RPC
 * POST хүлээн авдаг (`agents/dist/mcp/index.js:387,396,460`).
 */
export function isMcpPath(pathname: string): boolean {
  return MCP_ROUTES.some((r) => pathname.startsWith(r));
}

export type McpVerdict =
  | { ok: true; sub: number; role: UserRole }
  | { ok: false; status: 401 | 403; code: string; message: string };

/**
 * `ctx.props`-ыг шалгана.  ХОЁР эх үүсвэр энд НИЙЛНЭ:
 *   • OAuth access token → `oauth-provider.js:2025` `decryptProps`
 *   • legacy JWT        → `oauth-provider.js:2046` `resolveExternalToken`
 * Тиймээс `resolveExternalToken` дотор шалгах нь ЗӨВХӨН хоёр дахийг барина.
 *
 * @param expectedTenantId  Олон-tenant үед хүсэлтийн tenant id; НЭГ-tenant
 *   суулгацад `null` (тэр үед `tid` шалгалт бүрэн алгасагдана, хуучин
 *   токенууд хүчинтэй хэвээр — `middleware/auth.ts:80-88`-тай ижил зан).
 */
export function checkMcpAccess(props: unknown, expectedTenantId: string | null): McpVerdict {
  if (typeof props !== 'object' || props === null) {
    return { ok: false, status: 401, code: 'mcp_no_identity', message: 'Нэвтрэлт шаардлагатай' };
  }
  const p = props as { sub?: unknown; role?: unknown; tid?: unknown };
  if (typeof p.sub !== 'number' || typeof p.role !== 'string') {
    return { ok: false, status: 401, code: 'mcp_no_identity', message: 'Нэвтрэлт шаардлагатай' };
  }
  const role = p.role as UserRole;
  if (MCP_DENIED_ROLES.includes(role)) {
    return { ok: false, status: 403, code: 'mcp_role_denied', message: 'Энэ хэсэгт хандах эрхгүй' };
  }
  if (expectedTenantId !== null && p.tid !== expectedTenantId) {
    return { ok: false, status: 403, code: 'mcp_tenant_mismatch', message: 'Байгууллагын хил зөрчигдлөө' };
  }
  return { ok: true, sub: p.sub, role };
}
```

### 3.2 `backend/src/mcp/MglMcpAgent.ts` — L2: нөхцөлгүй role gate `init()`-д

`McpProps`-т `tid` нэм (`:34-37`):

```ts
export type McpProps = {
  sub: number;
  role: JWTPayload['role'];
  /** Олон-tenant суулгацын хил — `lib/tenants.ts`.  Нэг-tenant үед undefined. */
  tid?: string;
};
```

`init()`-ийн `:54-55` props-ын хамгаалалтын ДАРАА, `registerProjectTools` (`:57`)-ийн ӨМНӨ:

```ts
    const user = this.props;
    if (!user) return;

    // ⛔ MCP-д хориотой role — НЭГ Ч tool бүртгэхгүй.  Worker талын wrapper
    //    (index.ts) аль хэдийн 403 өгдөг; энэ нь DO СЭРЭХ замыг барина:
    //    `agents` нь props-ыг DO storage-д хадгалж (dist/mcp/index.js:1491),
    //    сэрэхэд `onStart` → `init()` дахин ажилладаг (:1500-1503) — тэр зам
    //    нь ямар ч HTTP хаалтаар дамжихгүй.
    if (MCP_DENIED_ROLES.includes(user.role)) return;
```

Импорт: `import { MCP_DENIED_ROLES } from './guard';`

**Зориудаар `throw` хийхгүй** — DO доторх throw нь ойлгомжгүй 500 болж хувирдаг. Цэвэр 403 нь L1-ийн ажил.

### 3.3 `backend/src/index.ts` — L1: apiHandlers-ийн wrapper (ГОЛ ЗАСВАР)

`:267-268`-ийн доор:

```ts
const mcpStreamable = MglMcpAgent.serve('/mcp');
const mcpSse = MglMcpAgent.serveSSE('/sse');

/**
 * MCP хаалт — provider нь токеныг шалгаж `ctx.props`-ыг тавьсны ДАРАА,
 * харин DO руу орохоос ӨМНӨ ажиллана (`oauth-provider.js:2054`).  Энэ бол
 * OAuth grant ба legacy JWT ХОЁУЛАН нийлдэг цорын ганц цэг.
 *
 * ⚠️ Энэ функц нь `runWithTenant`-ийн ДОТОР ажилладаг (index.ts:354) тул
 *    `hasTenantContext()` энд ЗӨВ утга өгнө.  Гадаад `fetch` дотор биш!
 */
function guardMcp(inner: ExportedHandler<Env>): ExportedHandler<Env> {
  return {
    fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
      const verdict = checkMcpAccess(
        (ctx as ExecutionContext & { props?: unknown }).props,
        hasTenantContext() ? currentTenantId() : null,
      );
      if (!verdict.ok) {
        console.warn(`[mcp-guard] ${verdict.code} ${new URL(request.url).pathname}`);
        return new Response(JSON.stringify({ error: verdict.message, code: verdict.code }), {
          status: verdict.status,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      return inner.fetch!(request, env, ctx);
    },
  };
}

/** ⚠️ Хаалт ба маршрут САЛЖ БОЛОХГҮЙ — `MCP_ROUTES` нь `mcp/guard.ts`-д. */
const MCP_API_HANDLERS: Record<string, ExportedHandler<Env>> = {
  '/mcp': guardMcp(mcpStreamable),
  '/sse': guardMcp(mcpSse),
};

// `MCP_ROUTES`-ийн бүх түлхүүр `MCP_API_HANDLERS`-д байх ЁСТОЙ — байхгүй бол
// tsc унана.  Шинэ transport нэмэх бүрд хоёулан дээр нэмэгдэнэ.
const _mcpRouteCoverage: Record<(typeof MCP_ROUTES)[number], ExportedHandler<Env>> = MCP_API_HANDLERS;
void _mcpRouteCoverage;
```

Дараа нь `:276-279`-ийг `apiHandlers: MCP_API_HANDLERS,` болго.

Импорт нэм: `import { checkMcpAccess, isMcpPath, MCP_ROUTES } from './mcp/guard';`, ба `:7`-ийн `import { runWithTenant } from './lib/requestContext';`-ыг `import { runWithTenant, currentTenantId, hasTenantContext } from './lib/requestContext';` болго.

> **Handler-ийн хэлбэр зөв эсэх:** provider-ийн `validateHandler` (`oauth-provider.js:812-822`) нь `typeof handler === "object" && typeof handler.fetch === "function"` бол `EXPORTED_HANDLER` гэж хүлээж авдаг. `MglMcpAgent.serve()` нь яг ижил `{ async fetch(request, env, ctx) }` объект буцаадаг (`agents/dist/mcp/index.js:1661-1665`), тиймээс wrapper нь асуудалгүй.

### 3.4 `backend/src/index.ts` — L0: гадаад fetch дэх fail-closed хаалт

`:321-355`-ийн `fetch`-д. **Түлхүүр нь `tenants !== null`, `hasTenantContext()` БИШ** (§2.6в).

```ts
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    const tenants = parseTenants(env.TENANTS);
    if (!tenants) return oauthProvider.fetch(request, env, ctx); // нэг-tenant — өөрчлөлтгүй

    const url = new URL(request.url);

    // ── FAIL-CLOSED: олон-tenant үед /mcp, /sse ХААЛТТАЙ ──────────────
    // `MCP_OBJECT` нь `TenantSpec`-д БАЙХГҮЙ (lib/tenants.ts:37-53) ба
    // `tenantEnv` нь зөвхөн DB / MEDIA_BUCKET / MEETING_BUCKET-ыг сольдог
    // (:191,:196,:201).  Durable Object нь дуудагчийн засварласан env-ийг
    // БИШ, Worker script-ийнхээ ӨӨРИЙН env-ийг авдаг тул `this.env.DB` нь
    // ямар ч tenant-д ҮНДСЭН баазыг заана.  Мөн `runWithTenant`-ийн
    // AsyncLocalStorage нь DO-ийн хил давдаггүй.  Тиймээс олон-tenant үед
    // /mcp нь ЗӨВ tid-тэй байлаа ч ӨӨР компанийн өгөгдөл унших болно.
    // Энэ хаалтыг арилгах нь `1A-4 tenant preflight`-ийн ажил.
    if (isMcpPath(url.pathname)) {
      return new Response(
        JSON.stringify({ error: 'MCP олон-tenant горимд түр хаалттай', code: 'mcp_multitenant_unsupported' }),
        { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
      );
    }

    const hit = resolveTenant(tenants, { host: url.hostname, header: request.headers.get(TENANT_HEADER) });
    ...  // үлдсэн нь ХЭВЭЭР
```

`TENANTS` нь өнөөдөр тохируулаагүй (§9.1) тул **энэ салаа production дээр огт ажиллахгүй** — зан төлөв байт байтаараа хэвээр.

### 3.5 `backend/src/oauth/authorize.ts` — grant-д `tid` нэмнэ (НЭГ commit дотор)

`:152`:

```ts
  // `tid` нь L1 хаалтын tenant тулгалтын эх өгөгдөл (mcp/guard.ts).  Нэг-tenant
  // суулгацад `hasTenantContext()` худал → талбар огт нэмэгдэхгүй, grant-ийн
  // хэлбэр өнөөдрийнхтэй ижил үлдэнэ (`lib/jwt.ts:54-59`-ийн хэв маяг).
  const props: McpProps = {
    sub: user.id,
    role: user.role,
    ...(hasTenantContext() ? { tid: currentTenantId() } : {}),
  };
```

Импорт: `import { currentTenantId, hasTenantContext } from '../lib/requestContext';`

**Энэ файл `runWithTenant`-ийн дотор ажилладаг** — `/authorize` нь Hono `app`-ын root mount (`index.ts:261`), `app` нь `defaultHandler` (`:281`), тэр нь provider-ийн дотор, provider нь `runWithTenant`-ийн дотор (`:354`). §2.6в-ийн урхинд орохгүй.

### 3.6 `backend/src/index.ts` — `resolveExternalToken`-д `tid`-ийг ДАМЖУУЛНА

`:292-296`. **Шалгалт нэмэхгүй** (§2.5 — буруу газар), зөвхөн claim-ыг props руу зөөнө:

```ts
  resolveExternalToken: async ({ token, env }) => {
    const payload = await verifyToken(token, env.JWT_SECRET);
    if (!payload) return null;
    // ⚠️ ЭНД role/tenant ШАЛГАЛТ ХИЙХГҮЙ — энэ салаа нь legacy JWT-д Л
    //    ажилладаг (oauth-provider.js:2027).  OAuth access token нь
    //    `decryptProps` салаагаар (:2025) явдаг тул тэнд тавьсан шалгалт
    //    хоёр эх үүсвэрийн зөвхөн нэгийг барина.  Жинхэнэ хаалт нь
    //    `guardMcp` (ctx.props дээр, :2054-ийн өмнө).
    return {
      props: {
        sub: payload.sub,
        role: payload.role,
        ...(payload.tid ? { tid: payload.tid } : {}),
      } satisfies McpProps,
    };
  },
```

### 3.7 ШИНЭ ФАЙЛ — `backend/src/mcp/guard.test.ts`

`backend/src/lib/tenants.test.ts:8-19`-ийн хэв маягийг ЯГ ХУУЛ. Extensionless relative import-ыг `node --test` дор ажиллуулахад `registerHooks` **заавал** (`tsc` ногоон хэвээр байдаг тул алдаа нь тестийг ажиллуулах хүртэл үл харагдана):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { checkMcpAccess, isMcpPath, MCP_ROUTES, MCP_DENIED_ROLES } = await import('./guard.ts');
```

Заавал байх кейсүүд:

| # | Оролт | Хүлээх |
|---|---|---|
| 1 | `isMcpPath('/mcp')`, `isMcpPath('/sse')` | true |
| 2 | `isMcpPath('/sse/message')` | **true** (legacy SSE хүүхэд зам) |
| 3 | `isMcpPath('/mcpX')` | **true** (provider `startsWith`) |
| 4 | `isMcpPath('/api/projects')`, `'/media/x'`, `'/'`, `'/authorize'` | false |
| 5 | `checkMcpAccess(undefined, null)` | 401 `mcp_no_identity` |
| 6 | `checkMcpAccess({}, null)`, `{sub:'2'}`, `{sub:2}` | 401 |
| 7 | `checkMcpAccess({sub:9, role:'worker'}, null)` | **403 `mcp_role_denied`** |
| 8 | `checkMcpAccess({sub:2, role:'admin'}, null)` | ok |
| 9 | `checkMcpAccess({sub:2, role:'admin'}, 'mgl')` (tid алга) | **403 `mcp_tenant_mismatch`** |
| 10 | `checkMcpAccess({sub:2, role:'admin', tid:'acme'}, 'mgl')` | 403 |
| 11 | `checkMcpAccess({sub:2, role:'admin', tid:'mgl'}, 'mgl')` | ok |
| 12 | `checkMcpAccess({sub:2, role:'client'}, null)` | ok (client одоогоор зөвшөөрөгдсөн — §9.3) |
| 13 | `MCP_DENIED_ROLES.includes('worker')` → true; `'client'` → false | одоогийн шийдвэрийг бэхлэх regression |

---

## 4. ХӨНДӨЖ БОЛОХГҮЙ (load-bearing)

| # | Юу | Яагаад эвдэрнэ |
|---|---|---|
| 1 | **`middleware/auth.ts` ба `lib/jwt.ts`-д `purpose` шалгалт** | Revit add-in бүх `/api/*` дуудлагаа `purpose:'mcp'` токеноор хийдэг, refresh урсгал байхгүй. ~20 компьютер, албадан шинэчлэлт байхгүй. **Алсаас сэргээх боломжгүй.** |
| 2 | **`resolveExternalToken`-ийг устгах / `null` буцаах** | Тавигдсан legacy mcp-token-ууд (365 хоног) бүгд тэр дороо унана. |
| 3 | **`resolveExternalToken`-д `purpose === 'mcp'` шаардах** | *Технически аюулгүй* — тэр callback нь ЗӨВХӨН `apiHandlers` замуудад дуудагддаг (`oauth-provider.js:2027`), `/api/*`-д огт хүрэхгүй. **ГЭХДЭЭ** (а) энэ нь §2.4-ийн эрхийн давалтыг **зогсоохгүй** (`worker` `mcp-token`-оо өөрөө мянтдаж чадна), (б) session токеноо MCP клиентдээ буулгасан хүн байвал тэр дороо тасарна. `1A-3`-т харьяална. |
| 4 | **`lib/workerScope.ts`-ийн `/api/auth` цагаан жагсаалт** | `worker` нэвтэрч, нууц үгээ солиж, профайлаа уншиж чадахгүй болно. |
| 5 | **`MglMcpAgent.init()`-ийн Tier 3/4 нөхцөлүүд** | REST-ийн `requireManager()` / `requireAdmin()`-тэй тэнцүүлж тохируулсан. Хөндвөл MCP ба REST сална. |
| 6 | **`oauth/authorize.ts`-ийн `props` ХЭЛБЭР** | `McpProps` нь DO storage-д хадгалагддаг (`agents/dist/mcp/index.js:1491`). Талбар **хасах** нь сэрсэн хуучин session-уудыг эвдэнэ. `tid`-ийг **нэмэх** нь аюулгүй (optional). |
| 7 | **`index.ts:322-323`-ийн `if (!tenants) return oauthProvider.fetch(...)` шууд зам** | `TENANTS`-гүй үед НЭМЭЛТ АЖИЛ ТЭГ байх нь `lib/tenants.ts:14-16`-ийн зарчим. L0 хаалтыг энэ мөрийн ӨМНӨ бүү тавь. |
| 8 | **`OAUTH_KV` binding-ийн НЭР** | Библиотек нь яг тэр мөрөөр шийддэг. |
| 9 | **Одоо байгаа OAuth grant-ууд `OAUTH_KV`-д `tid`-гүй** | Нэг-tenant үед `expectedTenantId === null` тул шалгалт алгасагдана — тэдгээр grant хүчинтэй хэвээр. Олон-tenant үед L0 нь `/mcp`-г 503 болгодог тул мөргөлдөөн үүсэхгүй. |
| 10 | **`entitlement.ts:29-32`-ийн тайлбар** | Энэ ажил дууссаны дараа тэр тайлбарын «одоогоор хийгдээгүй» гэсэн хэсгийг **шинэчил** (нэг мөр), эс бөгөөс дараагийн уншигч ижил дүгнэлт гаргана. |

---

## 5. ДАРААЛАЛ БА ХАМААРАЛ

**Урьдчилсан нөхцөл:** байхгүй.

**Deploy дараалал (нэг deploy, доторх бичих дараалал):**

1. `backend/src/mcp/guard.ts` + `guard.test.ts` — цэвэр функц, ямар ч зан төлөв өөрчлөхгүй.
2. `MglMcpAgent.ts` (L2) + `oauth/authorize.ts` (`tid`) + `index.ts`-ийн `resolveExternalToken` (`tid` дамжуулалт) — өгөгдөл **бэлдэх** давхарга.
3. `index.ts`-ийн `guardMcp` (L1) + L0 — өгөгдлийг **уншиж шийддэг** давхарга.

> **«Шинэ багана нь түүнийг уншдаг кодоос ХАТУУ ЭРТ deploy хийгдэх ёстой» дүрмийн код дахь дүйцэл:** `tid` нь props-ын шинэ талбар. Энд DB багана биш, ижил bundle доторх санах ойн объект тул **нэг deploy хангалттай** — 2-р алхам 3-аас өмнө **эх кодод** бичигдсэн бол болно. **Гэхдээ** `OAUTH_KV`-д аль хэдийн байгаа grant-ууд `tid`-гүй хэвээр үлдэнэ; тэднийг L1 нэг-tenant үед алгасдаг (§4.9).

**Дараа нь юу ирэх вэ:**

- **`1A-3 token lifecycle`** — revocation lookup. ⚠️ **Хатуу дүрэм:** ямар ч хүчингүйжүүлэлтийн хайлт нь `authMiddleware` **БОЛОН** `resolveExternalToken` **ХОЁУЛАНГААС** дуудагддаг НЭГ хуваалцсан helper байх ёстой, мөн **НЭГ deploy дотор**. Энэ сесс тэр helper-ийг үүсгэхгүй, гэхдээ `guardMcp` нь түүнийг залгах байгалийн байрлал болно.
- **`1A-4 tenant preflight`** — `TENANTS`-д утга бичихээс ӨМНӨ. §3.4-ийн L0 503-ыг тэр сесс хянаж, DO-ийн env асуудлыг (§2.5, §9.2) шийдсэний дараа Л арилгана.
- **`1C add-in release`** — C#-ийн ямар ч өөрчлөлт **энэ сесст байхгүй**.

---

## 6. ХҮЛЭЭН АВАХ ШАЛГУУР

- [ ] `backend/src/mcp/guard.ts` үүссэн; `MCP_DENIED_ROLES`, `MCP_ROUTES`, `isMcpPath`, `checkMcpAccess` дөрөв экспортлогдсон.
- [ ] `guard.test.ts`-ийн 13 кейс бүгд ногоон; `cd backend && npm test`-ийн нийт тоо **өссөн**, унасан тест **нэмэгдээгүй**.
- [ ] `cd backend && npx tsc --noEmit` — шинэ алдаа **тэг** (өөрчлөлт хийхийн өмнөх baseline-тай харьцуул).
- [ ] `MglMcpAgent.init()`-д `MCP_DENIED_ROLES` шалгалт нь `registerProjectTools`-ийн **ӨМНӨ** байна.
- [ ] `index.ts`-ийн `apiHandlers` нь `MCP_API_HANDLERS`-ыг заасан бөгөөд утга бүр нь `guardMcp(...)`-аар боогдсон.
- [ ] `_mcpRouteCoverage` drift-хамгаалалт байгаа. Нэг удаа гараар шалга: `MCP_ROUTES`-т гуравдахь зам нэмээд `MCP_API_HANDLERS`-д нэмэхгүй бол `tsc` унах ёстой; шалгасны дараа буцаа.
- [ ] `oauth/authorize.ts`-ийн `props` нь `hasTenantContext()` үед `tid` агуулна.
- [ ] `grep -rn "hasTenantContext\|currentTenantId" backend/src/` — шинэ дуудагч бүр `index.ts:354`-ийн `runWithTenant`-ийн **ДОТОР** ажиллана; гадаад `fetch`-д (`:321-353`) **нэг ч** байхгүй.
- [ ] **`/api/*` дээр ямар ч зан төлөв өөрчлөгдөөгүй** — `git diff --stat` нь `middleware/auth.ts`, `lib/jwt.ts`, `lib/workerScope.ts`, `routes/auth.ts`-ыг **огт хөндөөгүй**.
- [ ] **Амьд шалгалт** — `worker` role-ийн жинхэнэ бүртгэлээр (§9.4):
  - [ ] `POST /api/auth/login` → 200, `token` буцаана (**өөрчлөгдөөгүй**).
  - [ ] Тэр токеноор `POST /mcp` `initialize` → **403 `mcp_role_denied`** (өмнө нь 200 + session id байсан).
  - [ ] `GET /sse` → **403**; `POST /sse/message?sessionId=x` → **403**.
  - [ ] `POST /mcpX` → **403** (`startsWith` тааруулалт ажилласны нотолгоо).
- [ ] **Regression** — `engineer` (эсвэл `admin`) бүртгэлээр `/mcp` `initialize` + `tools/list` → 200, tool-ын тоо **өөрчлөгдөөгүй** (admin: 32 tool + 1 prompt).
- [ ] `/api/*` smoke: `GET /api/auth/me` бүх role-д 200 хэвээр; `worker`-ийн ирцийн гарцууд ажиллаж байна.

---

## 7. ШАЛГАХ КОМАНД

```bash
# ── 0. Baseline (өөрчлөлт хийхийн ӨМНӨ, гаралтыг хадгал) ──
cd backend && npx tsc --noEmit ; npm test

# ── 1. Мөрийн дугааруудыг ӨӨРӨӨ дахин баталгаажуул ──
sed -n '144,151p;267,300p;321,356p' backend/src/index.ts
sed -n '80,92p'  backend/src/middleware/auth.ts
sed -n '51,60p;95,105p' backend/src/mcp/MglMcpAgent.ts
sed -n '18,40p'  backend/src/lib/workerScope.ts
sed -n '44,57p;71,80p' backend/src/routes/auth.ts
sed -n '150,160p' backend/src/oauth/authorize.ts
sed -n '37,53p;183,205p' backend/src/lib/tenants.ts
sed -n '24,32p;60,70p' backend/src/mcp/tools/company.ts
grep -n "matchApiRoute(url, route) {" -A8 backend/node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js
sed -n '2024,2056p' backend/node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js
sed -n '383,400p;458,470p;1498,1506p;1659,1668p' backend/node_modules/agents/dist/mcp/index.js

# ── 2. Ангиллын алдааны grep (§2.6в) ──
grep -rn "hasTenantContext\|currentTenantId\|runWithTenant" backend/src/

# ── 3. Хамрах хүрээний хяналт ──
git status --porcelain
git diff --stat
# ЗӨВШӨӨРӨГДСӨН файлууд ЗӨВХӨН:
#   backend/src/mcp/guard.ts  backend/src/mcp/guard.test.ts
#   backend/src/mcp/MglMcpAgent.ts  backend/src/index.ts
#   backend/src/oauth/authorize.ts  backend/src/lib/entitlement.ts (тайлбарын 1 мөр)

# ── 4. Тест + typecheck ──
cd backend && npm test
cd backend && npx tsc --noEmit   # алдаа гарвал: зөвхөн ХАМААРАЛГҮЙ файл дээр эсэхийг батал

# ── 5. Локал дуудлагын шалгалт (wrangler dev, :3000) ──
cd backend && npm run dev
# өөр терминалд:
API=http://127.0.0.1:3000
TOKEN=$(curl -s -X POST "$API/api/auth/login" -H 'content-type: application/json' \
  -d '{"username":"<WORKER_USERNAME>","password":"<PASSWORD>"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token))")
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}'
curl -si -X POST "$API/mcp" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d "$INIT" | head -1              # ХҮЛЭЭХ: HTTP/1.1 403
curl -si -X POST "$API/sse/message?sessionId=x" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d "$INIT" | head -1     # ХҮЛЭЭХ: 403
curl -si -X POST "$API/mcpX" -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d "$INIT" | head -1              # ХҮЛЭЭХ: 403  (startsWith тааруулалт)

# ── 6. Deploy (эзний зөвшөөрлөөр, §6 бүрэн ногоон болсны ДАРАА) ──
cd backend && npx wrangler deploy --config wrangler.toml
#   ⚠️ --config ЗААВАЛ: репо root дээрх wrangler.jsonc өөр worker зарладаг.
#   ⚠️ wrangler deploy typecheck ХИЙХГҮЙ — дээрх tsc-ыг өөрөө ажиллуулсан байх.

# ── 7. Production шалгалт (deploy-ийн дараа) ──
API=https://mgl-progress-api.mglenc-design.workers.dev
#   §5-ийн curl-уудыг дахин ажиллуул: worker → 403, engineer/admin → 200
npx wrangler tail --config backend/wrangler.toml --format pretty | grep mcp-guard
```

---

## 8. ROLLBACK

**Миграцийн шинэ дугаар ШААРДЛАГАГҮЙ** — энэ ажил схем огт хөндөхгүй, `backend/migrations/`-т нэг ч файл нэмэхгүй. (Лавлагаа: миграц нь append-only, 190 файл, хамгийн өндөр нь `0200_assistant_feedback_note.sql`. Дугаар авах болвол `ls backend/migrations | tail -3`.)

**Буцаах:**

1. `git revert <commit>` → `cd backend && npx wrangler deploy --config wrangler.toml`. Нэг deploy — өмнөх зан төлөв бүрэн сэргэнэ.
2. `OAUTH_KV`-д хийгдсэн ганц өөрчлөлт нь шинэ grant-уудад `tid` талбар нэмэгдсэн явдал. Тэр нь **optional** талбар тул хуучин код түүнийг зүгээр л үл хэрэгсэнэ — **KV цэвэрлэх шаардлагагүй**.
3. **DO-ийн session** — идэвхтэй MCP session-ууд props-оо DO storage-д хадгалсан байдаг (`agents/dist/mcp/index.js:1491`). Deploy нь DO-г дахин ачаалахад `init()` шинэ кодоор ажиллана. Revert-ийн дараа тэдгээр session ердийн байдлаар сэргэнэ; клиент талд дахин холбогдох шаардлага **гарахгүй**.
4. **Хэсэгчилсэн буцаалт** — зөвхөн L0 (олон-tenant 503) саад болж байвал `index.ts`-ийн `isMcpPath(...)` блокийг устгахад хангалттай; L1/L2 нь бие даан ажиллана. Эсрэгээр, зөвхөн L1 асуудал үүсгэвэл `apiHandlers`-ыг `{ '/mcp': mcpStreamable, '/sse': mcpSse }` болгож буцаахад L2 (role gate) ганцаараа үлдэнэ.

**Юуг буцаах ШААРДЛАГАГҮЙ:** `/api/*` замын ямар ч файл хөндөгдөөгүй тул REST талд буцаах зүйл байхгүй. Add-in дээр ямар ч алхам байхгүй.

---

## 9. ЭХЛЭХИЙН ӨМНӨ ТОДРУУЛАХ

Эдгээрийг репогоос **шийдэх боломжгүй**.

### 9.1 `TENANTS` production дээр тохируулагдсан уу?

`backend/wrangler.toml`-ийн `[vars]` блокт (`:59`-өөс) **`TENANTS` БАЙХГҮЙ** — баталсан. `backend/src/types.ts:73` нь `TENANTS?: string;` гэж зөвхөн зарладаг. Гэвч Cloudflare-ийн dashboard-аас гараар var нэмсэн байж болно (энэ тохиолдолд дараагийн `wrangler deploy` нь `[vars]` блокоор дарж бичих ёстой — гэхдээ энэ таамгийг **бодитоор шалга**):

```
Cloudflare dashboard → Workers → mgl-progress-api → Settings → Variables and Secrets
```

**Хариу нь энэ сессийн эрсдэлийг тодорхойлно:** `TENANTS` тохируулаагүй бол §3.4-ийн L0 салаа production дээр огт ажиллахгүй (эрсдэл тэг). Тохируулсан бол `/mcp` **тэр дороо 503 болно** — эзэнд урьдчилан мэдэгд.

### 9.2 `MCP_OBJECT` нь tenant-ээр хязгаарлагдсан env хүлээж авч чадах уу?

**Репогийн нотолгоо: ҮГҮЙ.** `TenantSpec` (`backend/src/lib/tenants.ts:37-53`)-д `id`, `label`, `hosts`, `db`, `media`, `meeting` **зургаан талбар Л** байна — `MCP_OBJECT` **байхгүй**. `tenantEnv` (`:183-205`) нь `DB` (`:191`), `MEDIA_BUCKET` (`:196`), `MEETING_BUCKET` (`:201`) гуравыг Л сольдог. Durable Object нь өөрөө instantiate хийгдэхдээ Worker script-ийнхээ өөрийн env-ийг авдаг тул дуудагчийн `scoped` объект DO руу **дамждаггүй**, мөн `AsyncLocalStorage` контекст ч DO хил давдаггүй.

➡️ **Бодитоор баталгаажуулах шаардлагатай** (хаягдах throwaway deploy дээр, production-д БИШ): олон-tenant `TENANTS`-той, хоёр D1-тэй worker deploy хийж, `MglMcpAgent.init()` дотроос `this.env` дэх DB binding-ийн онцлогийг лог руу гарга. Хэрэв таамаг зөв бол **олон-tenant MCP нь одоогийн архитектурт боломжгүй** бөгөөд `1A-4` нь эсвэл (а) tenant тус бүрт тусдаа DO namespace, эсвэл (б) DB binding-ийн НЭРийг props-оор дамжуулж DO дотор `env[name]`-аар авах загварыг сонгох ёстой. **Энэ сессийн L0 хаалт нь тэр шийдвэрийг гартал баримтлах байр суурь.**

### 9.3 `client` role-ыг `/mcp`-с хаах уу?

Одоо `client` нь Tier-1-ийн 11 tool (үүнд `generate_report` — R2-д PDF бичдэг WRITE tool) авдаг. Энэ нь REST-ийн үйлчлүүлэгчийн портал зан төлөвтэй **зориудаар нийцүүлсэн** байх магадлалтай. `MCP_DENIED_ROLES`-т `client` нэмэх нь нэг мөр — **гэхдээ энэ нь бүтээгдэхүүний шийдвэр, эзнээс асуу.** Энэ сесс `worker`-ыг Л хаана.

### 9.4 `worker` role-ийн жинхэнэ бүртгэл ба нууц үг

§7-ийн амьд шалгалтад **бодит `worker` бүртгэлийн нэр/нууц үг** хэрэгтэй (эсвэл түр туршилтын бүртгэл). Production DB-ээс:

```bash
npx wrangler d1 execute mgl-progress-db-v3 --remote --config backend/wrangler.toml \
  --command "SELECT id, username, role, status FROM users WHERE role='worker'"
```

Хэрэв `worker` role-той хэрэглэгч **нэг ч байхгүй** бол энэ засвар нь урьдчилан сэргийлэх шинжтэй (шат нь `role !== 'client'` дээр суурилдаг тул шинэ role бүр анхдагчаар нээлттэй) — эзэнд тэгж тайлбарла.

### 9.5 Одоо `/mcp`-д хэн холбогдож байна вэ?

`wrangler tail`-ийн түүх байхгүй тул: **ямар нэг `worker` эсвэл `client` бодитоор MCP хэрэглэж байгаа эсэхийг** эзнээс асуу. Хэрэв хэн нэг нь Claude Desktop дээр session токеноо буулгасан байвал `1A-3`-ийн `purpose` чангаруулалт түүнийг тасална — энэ сесс тэгэхгүй, гэхдээ мэдээллийг **одоо** цуглуул.

### 9.6 `OAUTH_KV` дахь одоо байгаа grant-ууд

```bash
npx wrangler kv key list --binding OAUTH_KV --config backend/wrangler.toml --remote | head -40
```

Олон-tenant асуудлыг `1A-4` шийдэхэд эдгээр `tid`-гүй grant-уудыг **хүчингүй болгох уу, эсвэл дахин зөвшөөрөл авахуулах уу** — эзний шийдвэр. Энэ сесст хамааралгүй (L0 нь тэр урсгалыг хаадаг), гэхдээ `1A-4`-т өгөх ёстой мэдээлэл.
