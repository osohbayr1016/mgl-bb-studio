# §02 · Backend архитектур

Бүх HTTP нэг Worker дээр (`backend/src/index.ts`). Дотор нь ~50 Hono route module-ыг `/api/*` дор mount хийсэн. Гол зүйл: **default export нь энгийн Hono апп биш** — гадуур нь `@cloudflare/workers-oauth-provider` ороосон (MCP-д зориулсан).

```js
// index.ts — хамгийн гадна давхарга
OAuthProvider({
  apiHandlers: { '/mcp': mcpStreamable, '/sse': mcpSse },  // MCP → Durable Object
  defaultHandler: app,        // бусад бүгд (/api/*, /media/*, /, /authorize) → Hono
  tokenEndpoint: '/token', clientRegistrationEndpoint: '/register',
  resolveExternalToken: ...   // хуучин ~1 жилийн mcp-token JWT-г ч зөвшөөрнө
})
```

`scheduled` (cron) handler-ыг OAuthProvider дэмждэггүй тул default export нь `oauthProvider.fetch` + `scheduled`-ыг зэрэг эзэмшдэг.

## `/api/*` дээрх middleware дараалал

1. **CORS** — `ALLOWED_ORIGINS`-оос (exact эсвэл `*.suffix` wildcard). Reflect-any байхгүй; production зөвхөн production-ыг, локал зөвхөн localhost-ыг зөвшөөрнө.
2. **Timing logger** — ≥250ms бол лог, эсвэл 5% sample; `Server-Timing` header тавьдаг.
3. **authMiddleware** — JWT-г `Authorization: Bearer` header эсвэл `token` cookie-оос уншиж `c.var.user` тавина.

`/media/*` нь тусдаа: нээлттэй GET CORS-той, дээд түвшинд ба `/api/media` хоёуланд mount — ингэснээр `<img src>` avatar bearer token-гүй ажиллана.

## Auth-аас **санаатай чөлөөлсөн** surface-ууд

Шинэ нээлттэй endpoint нэмбэл энэ жагсаалтыг эвдэхгүй байх ёстой:

- `POST /api/auth/login` — cookie тавьдаг.
- `GET /api/landing/public` — нэвтрээгүй нүүр хуудасны read-only payload.
- `/api/quotes/public/*` — QR-ээр нээгддэг үнийн санал (`authMiddleware`-ээс path prefix-ээр чөлөөлсөн).
- `/mcp` · `/sse` · `/authorize` · `/token` · `/register` — MCP + OAuth (worker root, `/api`-гаас гадуур).
- `/speechmatics` · `/meeting-audio` — worker root; эхнийх нь `x-mgl-speechmatics-secret` header, хоёр дахь нь signed `?t=<jwt>`-оор өөрөө батална.

## Role-ууд

Нийт 5 role: `admin · engineer · architect · senior · client`. Guard-ууд `backend/src/middleware/auth.ts`-д:

| Guard | Хэн |
|-------|-----|
| `requireAdmin()` | `ADMIN_ROLES` = зөвхөн `admin` |
| `requireManager()` | `admin` + багийн `senior` (structure/roster засах) |
| `requireRole(...)` | дурын role list |

> **Senior-ыг admin болгож бүү дэвшүүл.** `senior`-ыг pricing/хэрэглэгчийн администрацийн endpoint-д санаатай оруулаагүй. Хуучин `system_admin`/`management` role-ууд 2026-06-д устсан — тэдгээр нь код доторх хий үзэгдэл байсан (DB CHECK нь зөвхөн дээрх 5-г зөвшөөрдөг).

## Cron — `*/2 * * * *` (2 минут тутам)

`scheduled` handler 3 зүйлийг `ctx.waitUntil`-аар зэрэг явуулна:

1. **`syncAllMailboxes`** — идэвхтэй Gmail хайрцгуудаас шинэ мэйл татах.
2. **`reconcileMeetings`** — Speechmatics webhook алдвал гацсан хурлыг дуусгах backstop.
3. **`syncGoogleCalendar`** — компанийн Google Calendar-тай 2-талын sync.

## Cloudflare binding-ууд

| Binding | Төрөл | Юунд |
|---------|-------|------|
| `DB` | D1 | Гол SQLite сан `mgl-progress-db` |
| `OAUTH_KV` | KV | OAuth token/grant + calendar sync state. **Нэр нь чухал** — library exact нэрээр уншдаг |
| `MEDIA_BUCKET` | R2 (нийтийн) | Avatar, upload, `.ifc` — `/media/*`-аар үйлчилдэг |
| `MEETING_BUCKET` | R2 (хувийн) | Хурлын аудио — зөвхөн signed URL-аар |
| `BROWSER` | Browser Rendering | Headless Chromium PDF ([§06](06-pdf.md)) |
| `AI` | Workers AI | Монгол хэлний хураангуй/засвар (llama-3.1) |
| `MCP_OBJECT` | Durable Object | SQLite-backed `MglMcpAgent` ([§09](09-mcp.md)) |
| `STIRLING_SVC` · `WEASYPRINT_SVC` | Service binding | PDF контейнер-Worker-ууд ([§10](10-containers.md)) |

DO migration v1–v5 нь append-only түүх (ChatRoom + IfcConverter class үүсгээд устгасан). `nodejs_compat` flag нь `@cloudflare/puppeteer`-т хэрэгтэй. `Env` interface (`backend/src/types.ts`) нь binding-ийн source of truth.
