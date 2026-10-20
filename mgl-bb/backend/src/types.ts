import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import type { ProjectCategory } from './lib/projectCategories';
import type { CopyPlan, CopySelection } from './lib/structureCopyPlan';
import type { OrgEnvVars } from './lib/orgConfig';
export type { ProjectCategory } from './lib/projectCategories';

/* ------------------------------------------------------------------ */
/*  Cloudflare Worker bindings (mirrors wrangler.toml)                 */
/* ------------------------------------------------------------------ */

/**
 * `OrgEnvVars`-ыг өргөтгөнө: байгууллагын БҮХ `ORG_*` тохиргоо (нэр, цагийн
 * бүс, ээлжийн цаг, CEO id …) нь `lib/orgConfig.ts`-д тодорхойлогдоно.  Тэнд
 * шинэ талбар нэмэхэд энд автоматаар нэмэгдэнэ — хоёр газар засах шаардлагагүй.
 * Бүгд optional бөгөөд тохируулаагүй үед MGL-ийн одоогийн утга хүчинтэй.
 */
export interface Env extends OrgEnvVars {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  /** PRIVATE R2 bucket for meeting voice recordings (Хурлын тэмдэглэл).  Never
   *  served through the public `/media/*` mount — audio is streamed only via the
   *  signed `/meeting-audio/:key?t=<jwt>` route (see routes/meetingAudio.ts), so
   *  recordings aren't world-readable by key the way /media objects are. */
  MEETING_BUCKET: R2Bucket;
  /** ХУВИЙН R2 bucket — «Програмын хүсэлт» (engineering feedback, migrations 0410–0414)-ийн хавсралт: Revit-ийн
   *  дэлгэцийн зураг, лог, RVT/RFA/ZIP.  Нийтийн домэйн, r2.dev холбоосгүй; `/media/*`, `/meeting-audio`, storage
   *  audit/cleanup хэрэгсэл энэ bucket-ийг ОГТ уншихгүй.  Байт зөвхөн `routes/engineeringFeedback.ts`-ийн reviewer-ийн
   *  баталгаажсан stream-ээр.  ⚠️ Сонголттой: binding байхгүй (эсвэл tenant зарлаагүй) бол хавсралтын замууд 503 —
   *  MEDIA_BUCKET руу ХЭЗЭЭ Ч унагахгүй (`lib/tenants.ts` tenantEnv нь tenant бүрт дарж тавина). */
  FEEDBACK_BUCKET?: R2Bucket;
  /** ⚠️ ТҮР ЗУУРЫН — 2026-08-24-ний акаунт хоорондын нүүлгэлтийн үлдэгдэл.
   *  D1 бүтнээрээ хуулагдсан ч R2 нь ~3 хоногийн өмнө хуулагдсан тул тэр
   *  хооронд байршуулсан ~59 объект шинэ bucket-д ОРООГҮЙ (мөр нь D1-д
   *  байгаа, байт нь хуучин акаунтад).  `routes/media.ts` нь олдоогүй
   *  түлхүүрийг ЭНЭ origin-оос татаж, буцаахын зэрэгцээ `MEDIA_BUCKET` руу
   *  бичдэг тул объект бүр анх харагдахдаа аяндаа нүүнэ.
   *  Хоосон/тохируулаагүй бол нөхөх зам бүхэлдээ унтарна — хуучин акаунтыг
   *  хаах өдөр `wrangler.toml`-оос энэ мөрийг устгана. */
  LEGACY_MEDIA_ORIGIN?: string;
  JWT_SECRET: string;
  /** Revit add-in-ий лицензийн ГАРЫН ҮСГИЙН хувийн түлхүүр (secret, migration
   *  0374, `lib/revitLicense.ts`): `{"kid","kty":"EC","crv":"P-256","d","x","y"}`.
   *  Нийтийн хагас нь add-in-ий `Licensing/Core/LicenseKeys.cs`-д шигтгэгдсэн —
   *  солих бол ШИНЭ `kid`-тэй түлхүүрийг add-in-д ЭХЛЭЭД нэмж тараана.
   *  Тохируулаагүй бол `POST /api/revit/license` 503 — add-in 1.9+ түгжигдэнэ. */
  REVIT_LICENSE_KEY?: string;
  FRONTEND_URL: string;
  /** Comma-separated CORS allowlist. Exact origins or `*.suffix` wildcards.
   *  Set per-environment: production origins in wrangler.toml [vars],
   *  localhost origins in .dev.vars (which overrides [vars] in dev). */
  ALLOWED_ORIGINS: string;
  /** '1' → office-IP gate on staff API/login/MCP. Anything else → off. */
  OFFICE_ACCESS_ENFORCED?: string;
  // Cloudflare Browser Rendering binding (see wrangler.toml [browser]).
  // Typed as Fetcher because @cloudflare/puppeteer accepts it directly.
  BROWSER: Fetcher;
  AI: Ai;
  /** McpAgent-backed Durable Object namespace (SQLite-backed) that serves the
   *  remote MCP server.  The `agents` SDK looks this binding up BY NAME
   *  (default `MCP_OBJECT`) to route each MCP session to its own DO instance.
   *  See src/mcp/MglMcpAgent.ts and the `/mcp` handler in src/index.ts. */
  MCP_OBJECT: DurableObjectNamespace;
  /** Захиалагчийн порталын realtime өрөө — ТӨСӨЛ ТУС БҮРД нэг instance
   *  (`idFromName('project:<id>')`).  WebSocket Hibernation API ашигладаг тул
   *  сул зогсох үед санах ойгоос гарна.  ⚠️ Энэ бол зөвхөн ТЭЭВЭР: үнэн нь
   *  D1-ийн `client_events` хүснэгтэд байна (see lib/clientEvents.ts).
   *  Optional гэдэг нь санаатай — binding тохируулаагүй орчинд (хуучин
   *  wrangler.toml, зарим тест) портал polling-гүйгээр ч ажиллана. */
  CLIENT_ROOM?: DurableObjectNamespace;
  /** System Workbench-ийн амьд урсгалын өрөө (`live/WorkbenchLive.ts`, wrangler tag v7). */
  WORKBENCH_LIVE?: DurableObjectNamespace;
  /** KV namespace for @cloudflare/workers-oauth-provider — OAuth grants,
   *  access/refresh tokens and dynamically-registered (DCR) clients.  The
   *  library reads it by the EXACT binding name `OAUTH_KV`.  Declared in
   *  wrangler.toml [[kv_namespaces]]. */
  OAUTH_KV: KVNamespace;
  /** Injected at RUNTIME by OAuthProvider into the defaultHandler's env (NOT
   *  declared in wrangler.toml).  Gives src/oauth/authorize.ts access to
   *  parseAuthRequest / lookupClient / completeAuthorization. */
  OAUTH_PROVIDER: OAuthHelpers;
  /** Public origin of the API worker (used by routes/email.ts links).
   *  Falls back to a request-derived URL if unset. */
  API_PUBLIC_URL?: string;

  /* ---- Internal developer workbench (admin-only; see routes/devWorkbench.ts) ---- */
  /** '1' enables GitHub-backed source editing/testing. Keep unset in customer deployments. */
  DEV_WORKBENCH_ENABLED?: string;
  /** Fine-grained GitHub token. Required permissions: Contents RW, Actions RW, Pull requests RW. */
  GITHUB_WORKBENCH_TOKEN?: string;
  /** owner/repo. Defaults to osohbayr1016/mgl-e-c when omitted. */
  GITHUB_WORKBENCH_REPO?: string;
  /** Protected base branch. Defaults to main. Workbench writes never target this branch directly. */
  GITHUB_WORKBENCH_BASE_BRANCH?: string;

  /**
   * ОЛОН-TENANT зураглал — `TenantSpec[]`-ийн JSON (`lib/tenants.ts`).
   *
   * Тохируулаагүй бол систем НЭГ-tenant горимоор ажиллана (MGL-ийн одоогийн
   * суулгац).  Тохируулсан бол нэг Worker олон компанийг үйлчилнэ: host
   * (эсвэл `X-Tenant` толгой) -оос компанийг олж, `DB` / `MEDIA_BUCKET` /
   * `MEETING_BUCKET` binding-ийг тэр компанийнхаар солино.
   *
   * ⚠️ `db` + `media` + `meeting` нь БҮГД ЗААВАЛ.  Аль нэг нь дутуу бичлэгийг
   *    `parseTenants` БҮРЭН ХАЯНА (алдаа шидэхгүй, лог бичээд алгасна) —
   *    «дефолт руу унагаах» нь тухайн компанийн файлыг ҮНДСЭН, нээлттэй
   *    `/media/:key` bucket руу чимээгүй бичих байсан.  Үндсэн компани ч
   *    `"MEDIA_BUCKET"` / `"MEETING_BUCKET"` гэж ИЛ бичнэ.
   *
   * `legacyMediaOrigin` нь СОНГОЛТТОЙ: зарлаагүй компанид `tenantEnv` нь
   * `LEGACY_MEDIA_ORIGIN`-ыг ХООСОН болгож, `routes/media.ts`-ийн нөхөж татах
   * салааг бүхэлд нь унтраана.
   *
   * Жишээ:
   *   [{"id":"acme","label":"ACME","hosts":["api.acme.mn"],
   *     "db":"DB_ACME","media":"MEDIA_ACME","meeting":"MEETING_ACME"}]
   */
  TENANTS?: string;

  /* ---- Локал хөгжүүлэлтийн auth алгасалт (see lib/devAuth.ts) ---- */
  /** '1' → token байхгүй хүсэлтийг 401-дэхийн оронд `DEV_AUTH_USER`-ээр
   *  нэвтэрсэнд тооцно.  ЗӨВХӨН `.dev.vars`-д (gitignore) тавина —
   *  wrangler.toml [vars]-д БИТГИЙ нэм.  Нэмэлт хамгаалалт болгож host нь
   *  localhost/127.0.0.1 биш бол огт идэвхжихгүй. */
  DEV_AUTH_BYPASS?: string;
  /** Алгасалт идэвхтэй үед ямар хэрэглэгчээр орох (username).  Өгөгдмөл `admin`. */
  DEV_AUTH_USER?: string;
  /** '1' → хүсэлт/cron БҮРИЙН D1 мөрийн тоолуурыг логдоно (lib/d1Telemetry.ts).
   *  Зөвхөн локал хэмжилтэд — prod дээр босго давсан хүсэлт л логдоно. */
  D1_TELEMETRY_VERBOSE?: string;

  /* ---- Gmail integration (see lib/google/, routes/email.ts) ---- */
  /** Whole service-account JSON (client_email + private_key) as one secret.
   *  Used for Workspace mailboxes via domain-wide delegation. */
  GOOGLE_SA_JSON?: string;
  /** Google Calendar id to two-way sync the dashboard calendar with (e.g.
   *  'mgl.eandc@gmail.com').  Absent → calendar sync is a no-op.  See
   *  lib/googleCalendarSync.ts. */
  GOOGLE_CALENDAR_ID?: string;
  /** Internal user id that owns events imported FROM Google.  Falls back to
   *  the lowest-id admin when unset. */
  GOOGLE_SYNC_USER_ID?: string;
  /** OAuth Web client — only needed to connect plain @gmail mailboxes. */
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  /** base64 of a 256-bit key; encrypts stored OAuth refresh tokens. */
  EMAIL_ENCRYPTION_KEY?: string;

  /* ---- Speechmatics batch STT (see lib/speechmatics.ts, routes/meetings.ts) ---- */
  /** Speechmatics batch API key.  `wrangler secret put SPEECHMATICS_API_KEY`. */
  SPEECHMATICS_API_KEY?: string;
  /** Shared secret echoed back in `notification_config.auth_headers` so the
   *  worker-root `/speechmatics/callback` can authenticate Speechmatics' POST.
   *  `wrangler secret put SPEECHMATICS_WEBHOOK_SECRET`. */
  SPEECHMATICS_WEBHOOK_SECRET?: string;
  /** Speechmatics regional API base, e.g. https://eu1.asr.api.speechmatics.com/v2.
   *  Declared in wrangler.toml [vars]; falls back to eu1 if unset. */
  SPEECHMATICS_BASE_URL?: string;
  /** '1' → auto-run Workers-AI analysis as soon as a transcript lands.  Any
   *  other value → analysis is on-demand only (POST /api/meetings/:id/analyze). */
  MEETING_AUTO_ANALYZE?: string;

  /* ---- Stirling-PDF integration (see lib/stirling.ts, routes/pdfTools.ts) ---- */
  /** Base URL of a self-hosted Stirling-PDF instance, e.g.
   *  https://stirling.example.com.  Stirling is a Java/Docker service that
   *  CANNOT run on the Worker itself — it lives on a separate container host and
   *  the Worker calls its REST API.  Empty/unset → the "PDF засах" report actions
   *  stay hidden (stirlingEnabled() is false).  Declared in wrangler.toml [vars]. */
  STIRLING_BASE_URL?: string;
  /** API key for the Stirling instance when it has login/API-key auth enabled
   *  (sent as the `X-API-KEY` header).  Optional — omit for an unauthenticated
   *  private instance.  `wrangler secret put STIRLING_API_KEY`. */
  STIRLING_API_KEY?: string;
  /** Service binding to the Stirling-PDF container Worker (stirling/). When
   *  present it is the preferred transport — internal, no public hop, no key. */
  STIRLING_SVC?: Fetcher;

  /* ---- Google Drive: баримт бичгийг Docs/Sheets дээр засах (lib/google/driveClient.ts) ---- */
  /** Drive дээрх ажлын хуулбарыг эзэмших, ХОЛБОГДСОН Google хайрцгийн хаяг
   *  (`email_accounts.address`).  Токен нь Gmail-ийн OAuth refresh token-оос
   *  ирдэг — service account БИШ (продакшнд DWD хэзээ ч тохируулагдаагүй).
   *  Хоосон → идэвхтэй эхний хайрцгийг автоматаар авна; нэг ч холбогдоогүй
   *  бол Google товчнууд нуугдана.  wrangler.toml [vars] дээр зарлана. */
  DOCS_DRIVE_SUBJECT?: string;
  /** Хөрвүүлсэн файлуудыг хийх Drive хавтасны id.  Хоосон бол эзэмшигчийн
   *  My Drive-ын үндэс рүү очно. */
  DOCS_DRIVE_FOLDER_ID?: string;
  /** `domain` (өгөгдмөл) — зөвхөн DOCS_DRIVE_DOMAIN-ы Google акаунтаар
   *  нэвтэрсэн хүн засна.  `link` — холбоос мэддэг ХЭН Ч засна; Workspace нь
   *  домэйн хуваалцахыг хаасан тохиолдолд л хэрэглэнэ. */
  DOCS_DRIVE_SHARE?: string;
  /** `domain` горимд хуваалцах домэйн.  Өгөгдмөл `mglenc.com`. */
  DOCS_DRIVE_DOMAIN?: string;

  /* ---- WeasyPrint HTML->PDF integration (see lib/weasyprint.ts) ---- */
  /** Service binding to the WeasyPrint container Worker (weasyprint/). Renders
   *  the server-built bilingual HTML of the client design-progress report into
   *  a PDF (POST /render {html}). Internal, no public hop, no key. Unset → the
   *  client-report PDF/MCP actions return 503 (weasyprintEnabled() is false). */
  WEASYPRINT_SVC?: Fetcher;
  /** Public URL of the Stirling instance (the container Worker's workers.dev
   *  URL or a custom domain), used ONLY to open the web editor for manual
   *  edits. Empty/unset hides the manual-edit button. Declared in [vars]. */
  STIRLING_PUBLIC_URL?: string;

  /* ---- Autodesk Platform Services (APS / Forge) 3D viewer (see lib/aps.ts) ---- */
  /** APS app credentials for 2-legged (client_credentials) auth. Used server-side
   *  to upload .rvt to OSS + translate to SVF2, and to mint short-lived
   *  `viewables:read` tokens for the browser viewer. `wrangler secret put`. */
  APS_CLIENT_ID?: string;
  APS_CLIENT_SECRET?: string;
  /** OSS bucket key for translated models (lowercase). Declared in [vars]. */
  APS_BUCKET?: string;
  /** APS region — 'US' (default) | 'EMEA'. Bucket + translate must match.
   *  Declared in [vars]. */
  APS_REGION?: string;

  /* ---- Web Push / VAPID (see lib/webPush.ts, lib/pushSweep.ts) ---- */
  /** VAPID нийтийн түлхүүр — 65 байтын шахагдаагүй P-256 цэг, base64url.
   *  Браузерын `applicationServerKey`-тэй ЯГ ижил утга тул НУУЦ БИШ;
   *  wrangler.toml [vars]-д бичигдэнэ.  `npx web-push generate-vapid-keys`.
   *  Солих нь бүх хуучин subscription-ыг хүчингүй болгоно. */
  VAPID_PUBLIC_KEY?: string;
  /** VAPID хувийн түлхүүр — 32 байтын түүхий `d` скаляр, base64url (PEM БИШ).
   *  `wrangler secret put VAPID_PRIVATE_KEY`. */
  VAPID_PRIVATE_KEY?: string;

  /** Anthropic API түлхүүр — `wrangler secret put ANTHROPIC_API_KEY`.
   *
   *  ⚠️ ЗӨВХӨН Worker дээр.  Revit add-in энэ түлхүүрийг ХЭЗЭЭ Ч авахгүй:
   *  `POST /api/revit/chat` нь туслахын НЭГ ээлжийг л дамжуулж өгдөг бөгөөд
   *  хэрэгслүүд нь ажилтны компьютер дээрх Revit дотор гүйцэтгэгддэг.
   *  Тавиагүй бол чат нь Workers AI руу (сул) шилжинэ. */
  ANTHROPIC_API_KEY?: string;

  /** Чатын модель.  Тавиагүй бол `claude-sonnet-5`. */
  REVIT_CHAT_MODEL?: string;
  /** RFC 8292 `sub` claim — push service-т холбоо барих `mailto:` эсвэл
   *  https URL.  wrangler.toml [vars]. */
  VAPID_SUBJECT?: string;
}

/* ------------------------------------------------------------------ */
/*  Hono variable bag (set by authMiddleware)                          */
/* ------------------------------------------------------------------ */

export type JWTPayload = {
  sub: number;
  role: UserRole;
  iat: number;
  exp: number;
  /** Optional token-purpose scope.  Session tokens omit it; print tokens set
   *  'print' (2026-08, 1A-3); special single-use tokens set their own
   *  ('mcp', 'stt-audio', 'email_oauth') so a handler can reject a normal
   *  session JWT replayed in its place.  See routes/email.ts.
   *
   *  ⚠️ The 'print' claim is a MARKER ONLY today — nothing rejects on it yet.
   *  It had to land FIRST so a future "no purpose ⇒ session token" rule can be
   *  true; before this change print tokens were byte-indistinguishable from a
   *  24h session token (only `exp − iat` differed).  Any rejection also has to
   *  reckon with `frontend/src/shared/lib/printAuth.ts`, which bridges the
   *  60-second `?t=` token OVER `localStorage.auth_token`.
   *
   *  ⚠️ purpose==='mcp' must NEVER be rejected on /api — the Revit add-in
   *  authenticates every REST call with it, has no refresh flow, and would
   *  need a manual Install.bat re-run on ~20 PCs to recover. */
  purpose?: string;
  /** Set on short-lived `purpose:'stt-audio'` tokens that authorise fetching one
   *  private meeting-audio object (Speechmatics fetch + in-app playback).  The
   *  signed key scopes the token to a single R2 object.  See routes/meetingAudio.ts. */
  audio_key?: string;
  /**
   * Tenant id (`lib/tenants.ts` → `TenantSpec.id`) — ОЛОН-TENANT суулгацын
   * АЮУЛГҮЙ БАЙДЛЫН ГОЛ ХИЛ.
   *
   * `JWT_SECRET` нь Worker-т НЭГ тул A компанид олгосон токен B компанийн
   * контекстэд ч гарын үсгийн хувьд хүчинтэй шалгагдана; `sub` нь тухайн
   * компанийн DB доторх user id учир A-гийн `sub: 5` нь B-д ӨӨР ХҮН болно.
   * Тиймээс `middleware/auth.ts` нь энэ claim-ийг хүсэлтийн tenant-тай
   * тулгаж, зөрвөл 401 буцаана.
   *
   * Нэг-tenant суулгацад ОГТ БАЙХГҮЙ (`undefined`) — тэр үед шалгалт ч
   * хийгдэхгүй, өмнөх токенууд хүчинтэй хэвээр үлдэнэ.
   */
  tid?: string;
  /** `purpose:'revit'` (session) ба `purpose:'revit-refresh'` (renewal credential) токены
   *  төхөөрөмжийн уяа: add-in-ий device_id (SHA-256 hex) ба түлхүүрийн key_id.
   *  `lib/revitSessionCheck.ts` хүсэлт бүрд төхөөрөмжийн төлөвтэй тулгана (migration 0375). */
  dev?: string;
  kid?: string;
};

export type AppVariables = {
  user: JWTPayload;
  /** Таскийн хуваарилалтын хаалга (middleware/taskAllocGuard.ts): корреляцийн ID ба идэвхжүүлэлтийн төлөв. */
  allocCorrelationId?: string;
  allocState?: string;
};

/* ------------------------------------------------------------------ */
/*  Roles & seniority                                                  */
/* ------------------------------------------------------------------ */

// `system_admin` ба `management` role-уудыг 2026-06-д бүрэн болиулсан.
// Хоёулаа кодод л байсан хийсвэр зүйл байв: production users хүснэгтийн
// CHECK constraint анхнаасаа ('admin','engineer','architect','senior',
// 'client') байсан тул DB-д хэзээ ч оноогдох боломжгүй байсан.  Админ
// эрх одоо ганц `admin` role.
//
// `worker` (цэвэрлэгч / туслах ажилтан) нь 2026-08-д нэмэгдсэн ЖИНХЭНЭ DB
// role — migration 0136 нь users хүснэгтийг rebuild хийж CHECK-д нэмсэн
// (тэр файлын толгой дахь аюулгүй хэрэглэх зааврыг заавал уншина уу).
// Worker нь зөвхөн ирцээ бүртгэдэг: төслийн өгөгдөл, баг, бүтээмжийн
// самбарт огт хандахгүй — `lib/workerScope.ts`-ийг үз.
export type UserRole = 'admin' | 'engineer' | 'architect' | 'senior' | 'client' | 'worker';

export const ALL_ROLES: UserRole[] = [
  'admin',
  'engineer',
  'architect',
  'senior',
  'client',
  'worker',
];

export const ADMIN_ROLES: UserRole[] = ['admin'];

export function isAdminRole(role: string): boolean {
  return (ADMIN_ROLES as string[]).includes(role);
}

/** Ирцээс өөр юу ч хийхгүй туслах ажилтан (цэвэрлэгч) эсэх. */
export function isWorkerRole(role: string): boolean {
  return role === 'worker';
}

// Roles that earn leaderboard points.  Admin/client are excluded —
// they review or watch but never appear on rankings.
export const LEADERBOARD_ELIGIBLE_ROLES: UserRole[] = ['engineer', 'architect', 'senior'];

export function isLeaderboardEligible(role: string): boolean {
  return (LEADERBOARD_ELIGIBLE_ROLES as string[]).includes(role);
}

export type Seniority = 'senior' | 'intermediate' | 'junior' | 'intern';

/* ------------------------------------------------------------------ */
/*  Notification types                                                 */
/* ------------------------------------------------------------------ */

export type NotificationType =
  | 'task_assigned'
  | 'progress_pending'
  | 'progress_approved'
  | 'progress_rejected'
  /* Ажилтан чөлөөний хүсэлт илгээв — батлагчид (admin tier).  Урьд нь ямар ч
   * мэдэгдэл байгаагүй тул хүсэлт шөнөжин хараагүй хэвтэж, маргааш өглөө нь
   * ажилтанд бодит хоцролтын торгууль үүсгэдэг байв. */
  | 'leave_requested'
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_cancelled'
  | 'attendance_adjusted'
  | 'attendance_confirm_requested'
  | 'attendance_confirm_responded'
  /* Ирцийн журмын зарлал — удирдлагаас БҮХ ажилтанд (migration 0198).
   * Хувь хүнд чиглэсэн эвент биш, компанийн хэмжээний нэг удаагийн
   * мэдэгдэл тул тусдаа төрөл: bell дээр «зарлал» icon-той гарна. */
  | 'attendance_announcement'
  | 'suggestion_submitted'
  | 'suggestion_updated'
  | 'suggestion_resolved'
  | 'pgp_feedback'
  | 'asr_submitted'
  | 'asr_approved'
  | 'asr_rejected'
  /* Зохиогчийн хяналтын ХУВААРЬ (миграц 0331) — admin/senior хүмүүсийг
   * талбайд явуулахаар сонгоход тэдэнд («тэдэн сарын тэдэнд энэ төсөл дээр
   * зохиогчийн хяналтаар явна»), мөн хуваарь өөрчлөгдөх/цуцлагдахад. */
  | 'asr_visit_assigned'
  | 'asr_visit_cancelled'
  /* Ур чадварын үнэлгээ (migration 0137) — round нээгдэхэд оролцогч/ахлагч
   * руу, ажилтан өөрийн үнэлгээгээ илгээхэд түүний ахлагч руу. */
  | 'assessment_assigned'
  | 'assessment_submitted'
  /* Төслийн хугацаа / сануулга («Төслийн хуваарь» хуудас) — дуусах огноо
   * ойртсон/хэтэрсэн үед хариуцагч руу автоматаар, мөн admin/senior гараар
   * «сануулах» товч дарахад. */
  | 'project_deadline'
  | 'project_nudge'
  /* Захиалагчийн портал (2026-09).  Эхний хоёр нь АЖИЛТАН руу, сүүлийн
   * хоёр нь ЗАХИАЛАГЧ руу чиглэнэ.  `CATEGORY_OF` нь `Record<NotificationType,
   * PushCategory>` тул энд төрөл нэмэх бүрд `lib/pushSweep.ts` компиляцын
   * алдаа өгч, ангилал сонгохоос өөр аргагүй болно — тэр нь санаатай. */
  | 'client_submission_received'
  | 'client_submission_reviewed'
  | 'client_publication'
  | 'client_message'
  /* RFI/CR захиалагчийн гарын үсэг (migration 0335).  Эхнийх нь ЗАХИАЛАГЧ руу
   * («зурна уу»), хоёр дахь нь АЖИЛТАН руу («зурлаа»). */
  | 'client_signature_requested'
  | 'client_signed'
  /* Нийтийн мэдээлэл (migration 0338) — админ нийтлэхэд хүрээний ажилтан
   * бүрд, «дахин баталгаажуул» гэж шинэчлэхэд, мөн сануулгад. */
  | 'announcement_published'
  /* Багийн профайл (migration 0346) — захирал багийн ахлах руу «гишүүдийн
   * бүтээмжийн зөрүү босгоос их байна» гэж анхааруулна
   * (`routes/teamProductivity.ts`). */
  | 'team_gap_warning'
  /* «Баримт бичиг» дээрх Word баримтын гарын үсэг (migration 0371,
   * routes/driveSigning.ts).  `doc_sign_requested` — захирал руу «батлана уу»
   * ЭСВЭЛ хамт олон руу «гарын үсэг зурна уу»; `doc_sign_decided` — захирал
   * баталсан / буцаасныг хүсэгч, зурсан ажилтнуудад. */
  | 'doc_sign_requested'
  | 'doc_sign_decided'
  /* Revit «Өөрчлөхөөс өмнө» — архитектор элемент зөөхөд мөргөлдсөн элементийн
   * зохиогчид / гараар нэмсэн хүмүүст, мөн хүлээн авагч танилцахад илгээгчид
   * (migration 0390, routes/revitChangeNotices.ts). */
  | 'revit_change_notice'
  /* «Програмын хүсэлт» (migrations 0410–0414, routes/engineeringFeedback.ts).  `engineering_request_new` /
   * `engineering_request_activity` — ЗӨВХӨН баталгаажсан Software Engineer reviewer руу (шинэ хүсэлт; илгээгчийн
   * retest/нэмэлт мэдээлэл); `engineering_request_update` — ИЛГЭЭГЧ руу (нийтийн төлөв, хариу; дотоод тэмдэглэл
   * хэзээ ч орохгүй). */
  | 'engineering_request_new'
  | 'engineering_request_activity'
  | 'engineering_request_update';

/* ------------------------------------------------------------------ */
/*  Progress status                                                    */
/* ------------------------------------------------------------------ */

export type ProgressStatus = 'pending' | 'approved' | 'rejected';

/* ------------------------------------------------------------------ */
/*  Gmail integration                                                  */
/* ------------------------------------------------------------------ */

/** Per-mailbox auth strategy — drives token minting in lib/google. */
export type EmailAuthType = 'workspace' | 'oauth';

/** Whether a message left our side or arrived from outside. */
export type EmailDirection = 'in' | 'out';

/** Construction-correspondence document classification.
 *  rfi = Request for Information, cr = Change Request,
 *  official = Албан бичиг, mr = Meeting Report. */
export type DocType = 'rfi' | 'cr' | 'official' | 'mr';

export const DOC_TYPES: DocType[] = ['rfi', 'cr', 'official', 'mr'];

export function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (DOC_TYPES as string[]).includes(v);
}

export interface EmailAccountRow {
  id: number;
  address: string;
  label: string | null;
  auth_type: EmailAuthType;
  refresh_token_enc: string | null;
  history_id: string | null;
  last_synced_at: string | null;
  last_sync_error: string | null;
  watch_expiration: string | null;
  is_active: 0 | 1;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface EmailMessageRow {
  id: number;
  account_id: number;
  gmail_message_id: string;
  thread_id: string | null;
  rfc_message_id: string | null;
  direction: EmailDirection;
  from_addr: string | null;
  to_addrs: string | null;
  cc_addrs: string | null;
  subject: string | null;
  snippet: string | null;
  body_text: string | null;
  body_html_r2_key: string | null;
  internal_date: string | null;
  label_ids: string | null;
  is_read: 0 | 1;
  triaged: 0 | 1;
  is_deleted: 0 | 1;
  correspondence_id: number | null;
  created_at: string;
}

export interface EmailAttachmentRow {
  id: number;
  message_id: number;
  gmail_attachment_id: string | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  r2_key: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  DB row types                                                       */
/* ------------------------------------------------------------------ */

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  profile_image: string | null;
  cover_image: string | null;
  /** Saved signature image URL (/media/<key>), drawn or uploaded once and
   *  auto-inserted into meeting-minutes / document signature blocks. */
  signature_url: string | null;
  /** Saved stamp/seal image URL (/media/<key>) — uploaded once, auto-inserted
   *  next to the signature on quote PDFs and author-supervision (ASR) reports.
   *  Unlike a signature it is never drawn by hand; it is always an upload. */
  stamp_url: string | null;
  bio: string | null;
  description: string | null;
  social_links: string | null;
  /** Legacy primary team column — kept for backward compat; new code reads from `user_teams`. */
  team_id: number | null;
  position: string | null;
  employee_id: string | null;
  /** ⚠️ DB-ийн CHECK нь 'standard'|'early' хэвээр.  Бодит СОНГОЛТ нь
   *  `user_work_schedules` (миграци 0199) — энэ багана нь 2026 оны 9-р
   *  сараас өмнөх түүхэн утга.  `lib/workSchedule.effectiveSchedule`-аар
   *  дамжуулж уншина. */
  work_schedule: 'standard' | 'early';
  seniority: Seniority | null;
  email: string | null;
  /** Ирцийн төхөөрөмжийн холболт — анхны clock-in хийсэн PC-ийн id
   *  (NULL = холбоогүй).  Зөвхөн тэр төхөөрөмжөөс л clock-in хийнэ;
   *  admin reset-ээр NULL болгож шинэ PC холбогдоно. */
  attendance_device_id: string | null;
  /** Холбох үеийн User-Agent snapshot (admin-д харуулах). */
  attendance_device_label: string | null;
  /** Хэзээ холбогдсон (ISO, UB). */
  attendance_device_bound_at: string | null;
  /** Дэмжих ажилтан (цэвэрлэгч гэх мэт) эсэх — 1 бол бүтээмжийн
   *  (чансааны / leaderboard) самбараас хасагдана.  Ирц бүртгэлд
   *  нөлөөлөхгүй (clock-in role-аас үл хамаарна). */
  is_support: number;
  /** 1 бол ирцийн бүх хязгаарлалтаас (утаснаас хориглох, нэг төхөөрөмжид
   *  холбох, төсөл заавал сонгох) чөлөөтэй — admin-тай адил.  Admin
   *  UsersPage-аас toggle хийнэ. */
  attendance_unrestricted: number;
  /** 1 бол оффисын IP-ийн гаднаас бүрэн системд хандах зөвшөөрөлтэй. */
  remote_access_allowed: number;
  /** Браузерын push мэдэгдлийн ангилал бүрийн асаалт/унтраалт (JSON).
   *  NULL = анхдагч (бүгд асаалттай).  lib/pushSweep.ts → resolvePrefs(). */
  push_prefs: string | null;
  /** ⚠️ ХЭРЭГЛЭГДЭХГҮЙ (leftover column).  Миграци 0191 нь лоббиийн зурагт
   *  дэлгэцэд хөл хорьсон «kiosk» данс хийхээр нэмсэн ч тэр загварыг 0192-т
   *  болиулж, бүх мөрөнд 0 болгосон.  Багана хасах нь `users`-ийг дахин
   *  байгуулах гэсэн үг тул `accent_color`-той ижил үлдээв. */
  tv_kiosk: number;
}

export interface ProjectRow {
  id: number;
  name: string;
  /** Optional presentation-only header title; falls back to `name`. See
   *  migration 0089 and the project detail header's click-to-edit dialog. */
  display_title: string | null;
  description: string | null;
  status: 'active' | 'completed' | 'archived';
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  key_image_url: string | null;
  /** Uploaded .ifc model — consumed by the in-browser QTO (Тоо хэмжээ) tab.
   *  The 3D viewer now runs on APS (.rvt → SVF2, see lib/aps.ts); the dormant
   *  model_xkt_url / model_conversion_status columns from migration 0067 still
   *  exist in the DB but are no longer read anywhere. */
  model_url: string | null;
  complexity: ProjectComplexity;
  /** Per-project performance weight (0-100) an admin types in directly.
   *  Drives scoring as `complexity_pct × Δpct / 100`. Replaces the fixed
   *  tier→percent mapping from migration 0093 onward; the `complexity`
   *  tier above is retained only for backward compatibility. */
  complexity_pct: number;
  /** Гараар тавьсан явц (0-100).  Block/drawing задаргаагүй жижиг засварын
   *  ажлууд эс бөгөөс мөнхөд 0% харагдах тул энэ утга тэдгээрт тооцоолсон
   *  явцыг дардаг.  NULL = автомат тооцоолол. */
  manual_progress: number | null;
  /** Явцын горим (миграц 0339): 'tasks' = жинлэсэн блок→зураг→таскийн мод
   *  (өгөгдмөл, бүх хуучин төсөл); 'hours' = ажилчдад олгосон Σ user_points.amount
   *  (2026-09-29, 100-аас давж болно) —
   *  шинэ ZA засварын төсөл, таск дээр гараар % бичих 403.  lib/repairProgress.ts. */
  progress_mode: 'tasks' | 'hours';
  /** High-level project type (Ажлын зураг / Засвар / …). Nullable for
   *  rows that pre-date migration 0079. See backend/src/lib/projectCategories.ts. */
  category: ProjectCategory | null;
  /** 1 = Зохиогчийн хяналтын төсөл — Төслүүд хуудсанд гарахгүй. */
  asr_only?: number;
  /** Энэ төслийн БҮТЭЦ (блок→зураг→эд анги→ажил) хаанаас хуулагдсаныг
   *  заана (миграци 0254).  ZA засварын төсөл ↔ засварлаж буй БАРИЛГА
   *  хоёрыг үүрд холбоно.
   *  ⚠️ D1 нь runtime дээр FK-г хэрэгжүүлдэггүй тул схемийн
   *  `ON DELETE SET NULL` нь зөвхөн баримтжуулалт — `DELETE
   *  /api/projects/:id` энэ баганыг ГАРААР NULL болгодог. */
  source_project_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface BlockRow {
  id: number;
  project_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  /** Owning team. `weight_percent` is "% within this team". */
  team_id: number | null;
  /** Хариуцагч — free-text responsible-person name (migration 0123), typed
   *  inline on the block card by admin/senior.  NULL/'' = unassigned.
   *  (`responsible_user_id` from 0122 is a leftover column, now unused.) */
  responsible_user_id: number | null;
  responsible_name: string | null;
  created_at: string;
}

export interface DrawingRow {
  id: number;
  block_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  created_at: string;
}

export interface ComponentRow {
  id: number;
  drawing_id: number;
  name: string;
  weight_percent: number;
  sort_order: number;
  created_at: string;
}

export interface TaskRow {
  id: number;
  component_id: number;
  name: string;
  weight_percent: number;
  assigned_to: number | null;
  sort_order: number;
  due_date: string | null;
  created_at: string;
  ai_completion_summary: string | null;
  ai_completion_summary_at: string | null;
}

export interface TeamRow {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** User responsible for approving 100% task submissions on this team's
   *  blocks (`progress_entries.status='pending'` queue).  Must hold the
   *  global `senior` role and be a member of this team — enforced in the
   *  team update handler.  NULL means no lead assigned; admin-tier users
   *  remain the only approvers in that case. */
  lead_user_id: number | null;
}

export interface ProjectClientRow {
  id: number;
  project_id: number;
  type: 'company' | 'individual';
  name: string;
  share_percent: number;
  sort_order: number;
  created_at: string;
}

/** One row in `project_team_shares` — "team T owns N% of project P".
 *  See migration 0042 for the schema.  Sum across a single project
 *  SHOULD be 100 but is not enforced at the DB layer; the UI surfaces
 *  the running total as a soft amber warning so half-edited rosters
 *  can still be saved.
 *
 *  Today this is only consumed by the create-project dialog and the
 *  admin setup page; downstream rollups (progress / leaderboard /
 *  dashboard) still use the global PRESET_TEAM_SHARES defaults. */
export interface ProjectTeamShareRow {
  id: number;
  project_id: number;
  team_id: number;
  share_percent: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: 0 | 1;
  created_at: string;
  /** 1 бол браузерын push мэдэгдэл аль хэдийн илгээгдсэн (эсвэл хоцорсон
   *  тул алгасагдсан).  Cron sweep зөвхөн 0 мөрүүдийг түүнэ — migration
   *  0132, lib/pushSweep.ts. */
  pushed: 0 | 1;
}

export interface ProgressEntryRow {
  id: number;
  task_id: number | null;
  subtask_id: number | null;
  user_id: number;
  percentage: number;
  date: string;
  notes: string | null;
  status: ProgressStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
}

/** One self-logged засвар (repair / extra work) entry — migration 0114.
 *  Оноо нь ажлын долоо хоног (40 цаг = 100%)-ийн хувиар автоматаар тооцогдоно:
 *  computed_pct = weekly_progress_points × (hours / 40). Багануудын нэр migration
 *  0114-ийн хуучин загварынх (`day_hours` = 40 divisor snapshot, `weekly_avg_pct`
 *  = 7 хоногийн нийт progress-оноо snapshot). */
export interface RepairEntryRow {
  id: number;
  /** Жинхэнэ төсөл.  `repair_project_id`-тэй ЯГ НЭГ нь дүүрэн (0194 CHECK). */
  project_id: number | null;
  /** Админы үүсгэсэн засварын төсөл (`repair_projects`) — 0194. */
  repair_project_id: number | null;
  user_id: number;
  description: string;
  hours: number;
  day_hours: number;
  /** Үүсгэх үеийн СУУРЬ ханшийн snapshot — «нэг АЖЛЫН ӨДӨР хэдэн хувь».
   *  ⚠️ Баганын нэр түүхэн: 0196 хүртэл долоо хоногийн ханш байсан. */
  weekly_avg_pct: number;
  /** Суурь ханш аль шатнаас гарсан ('self30' | 'self90' | 'team30' | 'company30' | 'none';
   *  0348-аас өмнөх мөрөнд 'self7'). */
  rate_source: string | null;
  computed_pct: number;
  /** ЯВЦЫН ханшийн snapshot (0339) — `user_points.delta_pct` хэмжигдэхүүнтэй
   *  ижил шат; `progress_pct = progress_rate × цаг/8`.  2026-09-29-нөөс явцад
   *  ОРОХГҮЙ (явц = олгосон оноо, lib/repairProgress.ts) — түүхэн snapshot.
   *  0339-оос өмнөх мөрөнд 0 / NULL — `POST /api/repair/backfill-progress` нөхнө. */
  progress_rate: number;
  progress_rate_source: string | null;
  progress_pct: number;
  /** Цагаар бодогддог төслийн таск (0341) — таскийн мөрөөс бүртгэсэн бол; бусад үед NULL. */
  task_id?: number | null;
  /** 0348: 'manual' (гараар бичсэн хуучин мөр) | 'auto' (тэмдэглэгээнээс, оноотой) |
   *  'backfill' (хуучин ZA хувийн бөглөлтөөс, оноогүй). */
  hours_source?: 'manual' | 'auto' | 'backfill';
  /** Цагийг гаргасан тэмдэглэгээ (`repair_marks.id`) — manual мөрөнд NULL. */
  mark_id?: number | null;
  /** `GET /repair/my`: 'entry' = энэ хүснэгтийн мөр, 'mark' = 0 цаг ногдсон тул
   *  мөргүй тэмдэглэгээ (id нь `repair_marks.id`). */
  kind?: 'entry' | 'mark';
  date: string;
  created_at: string;
}

/** GET /api/repair/all мөр — admin түүхэнд submitter + төслийн нэртэй. */
export interface RepairAdminRow extends RepairEntryRow {
  user_full_name: string;
  /** `COALESCE(projects.name, repair_projects.name)` — аль эх сурвалжаас
   *  ирснийг `is_repair_project` ялгана. */
  project_name: string;
  is_repair_project: 0 | 1;
  /** `tasks.name` (0341) — таскгүй бол NULL. */
  task_name: string | null;
}

/**
 * Засварын төсөл (`repair_projects`, миграци 0194) — ЖИНХЭНЭ төсөл БИШ.
 *
 * Бүх төсөл эзэнтэй болчихсон үед ажилтан компанийн дотоод ажил хийж цаг +
 * тайлбараа бүртгэдэг «сав».  `projects` хүснэгтэд ОГТ ордоггүй тул Төслүүд
 * хуудас, хянах самбар, Timeline, компанийн тойм, MCP, клиент портал, глобал
 * хайлтын аль нэгэнд ч ХЭЗЭЭ Ч гарч ирэхгүй — зөвхөн `/api/repair/projects`
 * л буцаана.  Зөвхөн админ үүсгэнэ/засна.
 */
export interface RepairProjectRow {
  id: number;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  sort_order: number;
  created_by: number | null;
  created_at: string;
  /** Жагсаалтын хамт ирдэг тоолуур — архивлах/устгах шийдвэрт хэрэгтэй. */
  entry_count?: number;
  /** Ажилласан нийт цаг ба хүний тоо (2026-09-24) — ажилтанд хувь биш цаг харагдана. */
  total_hours?: number;
  people_count?: number;
  /** Ажилчдад олгосон хувийн нийлбэр (2026-09-29, 100-аас давж болно).
   *  Шинэ төсөл 0 — хэн ч гараар хувь өгөхгүй. */
  progress?: number;
}

/** Хувь хүний хөгжлийн төлөвлөгөө (PGP) — migration 0125. Маягтын бүх талбар
 *  `answers_json`-д (frontend schema) хадгалагдана; статус/түгжээ байхгүй. */
export interface PgpPlanRow {
  id: number;
  user_id: number;
  period: string;
  answers_json: string;
  created_at: string;
  updated_at: string;
}

/** Admin/senior-ийн PGP санал (feedback) мөр — author нэртэй нэгтгэсэн. */
export interface PgpCommentRow {
  id: number;
  pgp_id: number;
  author_id: number;
  note: string;
  created_at: string;
  // Joined
  author_name?: string | null;
}

/* ---- Ур чадвар / зан чанарын үнэлгээ (Assessments) — migration 0137 ----
 *  Асуулга нь КОДОНД БИШ, `schema_json`-д JSON схемээр хадгалагдана.
 *  Схемийн каноник төрлүүд: backend/src/lib/assessmentSchema.ts.
 *  Дэлгэрэнгүй: docs/dev/assessments-spec.md */

/** Асуулгын загвар. Админ зохионо, round-ууд үүнээс snapshot авна. */
export interface AssessmentTemplateRow {
  id: number;
  /** 'ARCH_SKILLS_2026' г.м — UNIQUE. */
  code: string;
  title_mn: string;
  title_en: string | null;
  description: string | null;
  /** AssessmentSchema (JSON). */
  schema_json: string;
  status: 'draft' | 'active' | 'archived';
  /** Анхдагч баг — JSON массив текст: '["BB"]'. NULL = баг заагаагүй (migration 0146). */
  team_codes: string | null;
  /** Анхдагч үнэлэгчид — JSON массив текст: '[3,4]' (migration 0147). */
  senior_user_ids: string | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Судалгааны ээлж. `schema_json` нь template-ийн SNAPSHOT — round эхэлсний
 *  дараа template засагдсан ч энэ round-ын асуулга/жин өөрчлөгдөхгүй. */
export interface AssessmentRoundRow {
  id: number;
  template_id: number;
  name: string;
  period: string;
  status: 'draft' | 'open' | 'closed';
  schema_json: string;
  opens_at: string | null;
  closes_at: string | null;
  /** Энэ раунд ямар багт явсан — JSON массив текст (migration 0146). */
  team_codes: string | null;
  /** Раунд ДАЯАР үнэлэх senior-уудын id — JSON массив текст: '[4,11]' (migration 0146). */
  senior_user_ids: string | null;
  /**
   * Хамрах хүрээний үлдсэн хоёр хэмжүүр — JSON массив текст (migration 0182).
   * `team_codes`-той хамт «энэ раундад хэн байх ёстой вэ» гэдгийг БҮТНЭЭР
   * тодорхойлдог тул дараа ажилд орсон хүнийг нөхөж бүртгэх (sync) боломжтой.
   * Гурвуулаа NULL бол хамрах хүрээ мэдэгдэхгүй → sync юу ч хийхгүй.
   */
  roles: string | null;
  user_ids: string | null;
  /**
   * Админ ЗОРИУД хассан хүмүүс — JSON массив текст (migration 0182).
   * Sync тэднийг ДАХИН нэмэхгүй; эс бөгөөс «хасах → sync → буцаж ирэх»
   * гэсэн төгсгөлгүй мөчлөг үүснэ.
   */
  excluded_user_ids: string | null;
  /** 1 бол шинэ ажилтныг автоматаар бүртгэнэ (migration 0182). */
  auto_enroll: number;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Оролцогч. `evaluator_user_id` = түүнийг үнэлэх багийн ахлагч
 *  (teams.lead_user_id); NULL бол зөвхөн өөрийн үнэлгээ бөглөгдөнө. */
export interface AssessmentParticipantRow {
  id: number;
  round_id: number;
  user_id: number;
  evaluator_user_id: number | null;
  created_at: string;
}

/** Бөглөх маягт. Нэг оролцогчид дээд тал нь 2 мөр: self + senior.
 *  `evaluator_user_id` бол БӨГЛӨХ ЭЗЭН (self үед subject_user_id-тэй ижил),
 *  тиймээс эрхийн шалгалт нэг дүрэм: evaluator_user_id === user.sub. */
export interface AssessmentResponseRow {
  id: number;
  round_id: number;
  subject_user_id: number;
  evaluator_user_id: number | null;
  evaluator_kind: 'self' | 'senior';
  /** { "<itemId>": 1..5 } хавтгай map (JSON). */
  answers_json: string;
  status: 'draft' | 'submitted';
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

/** POST /api/repair body — ажилтан өөрийн засварыг бүртгэхэд. */
export interface CreateRepairRequest {
  /** Жинхэнэ төсөл дээрх засвар.  `repair_project_id`-тэй ЯГ НЭГ нь ирнэ. */
  project_id?: number | null;
  /** Админы үүсгэсэн засварын төсөл дээрх дотоод ажил (0194). */
  repair_project_id?: number | null;
  /** Гараар бүртгэхэд (`hours`-тэй) ЗААВАЛ; «Ажилласан» тэмдэглэгээнд хэрэггүй. */
  description?: string | null;
  /** Цагаар бодогддог төслийн таск (0341) — зөвхөн `project_id`-тэй хамт. */
  task_id?: number | null;
  /** Ирвэл ГАРААР бүртгэнэ (2026-10-08 сэргээсэн); ирэхгүй бол «Ажилласан»
   *  тэмдэглэгээ — цагийг систем хуваарилна (0348). */
  hours?: number | null;
  /** Тэмдэглэгээнд зөвхөн өнөөдөр (UB); гар бүртгэлд ≤ өнөөдөр. */
  date?: string;
}

/** POST/PATCH /api/repair/projects — зөвхөн админ. */
export interface RepairProjectInput {
  name?: string;
  description?: string | null;
  status?: 'active' | 'archived';
  sort_order?: number;
}

export interface AttendanceSessionRow {
  id: number;
  user_id: number;
  clock_in: string;
  clock_out: string | null;
  hours_worked: number | null;
  device_id: string | null;
  ip_address: string | null;
  date: string;
  notes: string | null;
  late_minutes?: number;
  created_at: string;
  /** Админ гарах цагийг гараар нөхсөн бол хэн/хэзээ/тайлбар (0098). */
  edited_by?: number | null;
  edited_at?: string | null;
  edit_note?: string | null;
  /** Админ ирцийг бүхэлд нь гараар нөхөж үүсгэсэн бол үүсгэгч (0102).
   *  NULL = ажилтан өөрөө clock-in хийсэн organic бичлэг. */
  created_by?: number | null;
}

/** One row of the XLSX-style daily attendance grid. Returned by
 *  `GET /attendance/daily-grid` — one record per active employee per
 *  working day in the requested range. */
export interface DailyAttendanceRow {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  position: string | null;
  team_code: string | null;
  team_name: string | null;
  /** ISO yyyy-mm-dd in UB time zone. */
  date: string;
  schedule_key: 'standard' | 'early' | 'mid';
  /** UI label that matches the XLSX column ("08-17" / "09-18" / "08:30-17:30").
   *  ⚠️ Урьд нь литерал union байсан — 3 дахь ээлж нэмэгдсэн бөгөөд утга нь
   *  `ORG_SHIFT_*` тохиргооноос гардаг тул хаалттай байх боломжгүй. */
  schedule_label: string;
  /** Planned arrival ("HH:mm") — derived from `users.work_schedule`. */
  planned_in: string;
  /** Planned departure ("HH:mm"). */
  planned_out: string;
  /** Actual `clock_in` projected to "HH:mm" (UB). null when no session. */
  actual_in: string | null;
  /** Actual `clock_out` projected to "HH:mm" (UB). null until clock-out. */
  actual_out: string | null;
  /** Хоцорсон минут (no hour conversion — XLSX shows raw minutes). */
  late_minutes: number;
  /** Работанные minutes for the day. null when no session. */
  work_minutes: number | null;
  /** True when an approved leave covers this date. */
  is_on_leave: boolean;
  leave_type: 'annual' | 'sick' | 'unpaid' | 'remote' | 'other' | null;
  /** `leave_requests.reason` — surfaced so the UI can show it next to the
   *  Чөлөө chip without a second roundtrip. */
  leave_reason: string | null;
  /** True only when there's no clock-in, no leave, and date <= today. */
  is_absent: boolean;
}

export interface DailyAttendanceGridResponse {
  period: { from: string; to: string; working_days: number };
  rows: DailyAttendanceRow[];
}

export type AttendanceCheckpointType = 'morning' | 'afternoon' | 'clock_out';

export interface AttendanceProjectCheckpointRow {
  id: number;
  user_id: number;
  date: string;
  session_id: number | null;
  checkpoint_type: AttendanceCheckpointType;
  recorded_at: string;
  notes: string | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Request body types                                                 */
/* ------------------------------------------------------------------ */

export interface CreateProjectRequest {
  name: string;
  description?: string;
  status?: string;
  location?: string;
  latitude?: number | null;
  longitude?: number | null;
  complexity?: ProjectComplexity;
  /** Per-project performance weight (0-100). Clamped server-side. When
   *  omitted on create it defaults to 50 (the legacy 'mid' weight). */
  complexity_pct?: number;
  /** When set on create, the route auto-seeds team_shares from the
   *  category's default roster unless `team_shares` is also supplied. */
  category?: ProjectCategory | null;
  clients?: ClientInput[];
  team_shares?: TeamShareInput[];
  /** Гэрээ хэлэлцээрийн шатны САНУУЛГА болгож үүсгэх (Timeline-аас).
   *  Ийм төсөл зөвхөн admin + senior-т харагдана. */
  is_pending?: boolean;
  /** Бүтцийг нь хуулж авсан ЭХ төсөл (миграци 0254).  Үүсгэх дуудлага
   *  ЭНД юу ч хуулахгүй — зөвхөн холбоосыг бичнэ; бүтэц хуулах нь
   *  тусдаа, дахин оролдож болох `POST /api/projects/:id/copy-structure`. */
  source_project_id?: number | null;
}

/** Payload row for create/update project team-share endpoints.  The
 *  share is clamped server-side to [0, 100]; sum-to-100 is only a UI
 *  warning so a half-edited roster can still be saved. */
export interface TeamShareInput {
  team_id: number;
  share_percent: number;
  sort_order?: number;
}

/* ------------------------------------------------------------------ */
/*  Бүтэц хуулах — POST /api/projects/:id/copy-structure               */
/* ------------------------------------------------------------------ */

/**
 * Хүсэлтийн их бие.  URL дэх `:id` нь ЗОРИЛТОТ (шинэ) төсөл, их бие дэх
 * `source_project_id` нь ЭХ төсөл.
 *
 * ⚠️ Жингүүд ЯГ ХЭВЭЭР хуулагдана («keep» горим) — эзний шийдвэр.  7-оос
 * 2 мэргэжлийг л сонговол шинэ төслийн багийн хувь 41 болж, төсөл хэзээ ч
 * 41%-иас дээш заахгүй.  Үүнийг НУУХГҮЙ: `CopyPlan.ceiling_pct` нь тэр
 * дээд хязгаарыг буцаана.
 */
export interface CopyStructureRequest {
  source_project_id: number;
  /** Түвшин бүрийн id-гийн жагсаалт.  Түвшинг орхих / `null` = БҮГД. */
  selection?: CopySelection;
  /** Анхдагч `true` — `projects.source_project_id`-г бичнэ. */
  link?: boolean;
  /** Анхдагч `false` — юу ч бичихгүй, зөвхөн төлөвлөгөө буцаана. */
  dry_run?: boolean;
  /** Анхдагч `false` — зорилтот төсөлд бүтэц байвал дарж бичихийг зөвшөөрнө. */
  confirm_replace?: boolean;
}

export interface CopyStructureResponse {
  plan: CopyPlan;
  /** Үүсгэсэн блокуудын id — `dry_run` үед байхгүй. */
  created?: { block_ids: number[] };
  linked?: boolean;
  /**
   * Багийн хувь хэмжээ ҮРГЭЛЖ бүхэлдээ солигдоно — UI нь эндээс
   * `copyStructure.rosterNotice`-г гаргана.  `dry_run` дээр ч ирнэ.
   */
  roster: {
    replaced: true;
    /** Устах гэж буй ОДООГИЙН `project_team_shares` мөрийн тоо. */
    target_count: number;
    /** Оронд нь орох ЭХ төслийн мөрийн тоо. */
    source_count: number;
  };
}

/** Маршрутын алдааны нэгдсэн `{ error, code }` дахь код. */
export type CopyStructureErrorCode =
  | 'BAD_REQUEST'
  | 'SAME_PROJECT'
  | 'NO_SELECTION'
  | 'TARGET_ASR_ONLY'
  | 'SOURCE_NOT_FOUND'
  | 'TARGET_NOT_FOUND'
  | 'CYCLE'
  | 'ALREADY_LINKED'
  | 'NOT_EMPTY'
  /** Зорилтот төсөлд БАТЛАГДСАН ахиц бий — бүтцийг нь солихыг хориглоно. */
  | 'HAS_PROGRESS'
  | 'TOO_LARGE'
  | 'COPY_FAILED'
  | 'PARTIAL';

/** `GET /api/projects/:id/derived`-ийн нэг мөр. */
export interface DerivedProjectRow {
  id: number;
  name: string;
  display_title: string | null;
  category: ProjectCategory | null;
  status: ProjectRow['status'];
  created_at: string;
  source_project_id: number | null;
  task_count: number;
}

export interface DerivedProjectsResponse {
  projects: DerivedProjectRow[];
}

export interface CreateBlockRequest {
  project_id: number;
  name: string;
  weight_percent: number;
  sort_order?: number;
  /** Owning team. `weight_percent` is "% within this team". */
  team_id?: number | null;
}

export interface CreateDrawingRequest {
  block_id: number;
  name: string;
  weight_percent: number;
  sort_order?: number;
}

export interface CreateComponentRequest {
  drawing_id: number;
  name: string;
  weight_percent: number;
  sort_order?: number;
}

export interface CreateTaskRequest {
  component_id: number;
  name: string;
  weight_percent: number;
  assigned_to?: number;
  assignees?: number[];
  sort_order?: number;
  due_date?: string;
  start_date?: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  full_name: string;
  role: UserRole;
  team_id?: number;
  position?: string;
  employee_id?: string;
  seniority?: Seniority;
  email?: string;
  /** Дэмжих ажилтан (leaderboard-оос хасагдана). */
  is_support?: boolean;
}

export interface UpdateUserRequest {
  username?: string;
  full_name?: string;
  role?: UserRole;
  status?: 'active' | 'inactive';
  team_id?: number | null;
  position?: string | null;
  employee_id?: string | null;
  seniority?: Seniority | null;
  email?: string | null;
  /** Дэмжих ажилтан (leaderboard-оос хасагдана). */
  is_support?: boolean;
  /** Saved signature image URL (admin can set/clear for any user). */
  signature_url?: string | null;
  /** Saved stamp/seal image URL (admin can set/clear for any user). */
  stamp_url?: string | null;
  /** Ажлын ээлж — админ ажилтны өмнөөс сонгоно.  `users` баганад БИЧИГДЭХГҮЙ,
   *  `user_work_schedules`-д МАРГААШААС хүчинтэй мөр болж орно (миграци 0199). */
  work_schedule?: 'standard' | 'early' | 'mid';
}

export interface CreateTeamRequest {
  code: string;
  name_mn: string;
  name_en?: string;
  description?: string;
  sort_order?: number;
}

export interface UpdateTeamRequest {
  code?: string;
  name_mn?: string;
  name_en?: string;
  description?: string;
  sort_order?: number;
  /** Pass `null` to clear, a user id to set.  Backend validates that the
   *  user has role='senior' AND is a current member of this team. */
  lead_user_id?: number | null;
}

export interface ClientInput {
  type: 'company' | 'individual';
  name: string;
  share_percent: number;
  sort_order?: number;
}

/** Нэг өдрийн тайланд хавсаргасан ганц файл (migration 0177).
 *  `url` нь ҮРГЭЛЖ `/media/<key>` — `POST /api/upload` буцаадаг нийтийн
 *  зам.  Гадаад URL зөвшөөрөхгүй (сервер талд шалгадаг). */
export interface ProgressAttachment {
  url: string;
  name: string;
  /** MIME төрөл — UI зураг/PDF/бусад гэж ялгахад л хэрэглэнэ. */
  type?: string;
  size?: number;
}

export interface ProgressEntryRequest {
  task_id: number;
  percentage: number;
  date: string;
  notes?: string;
  is_rest_day?: boolean;
  defer_next_day?: boolean;
  image_url?: string;
  /** Олон хавсралт (зураг/PDF/DWG…).  `image_url` нь эхний ЗУРГААР
   *  автоматаар дүүрдэг тул хуучин уншигчид эвдрэхгүй. */
  attachments?: ProgressAttachment[];
  /** Answers to the project's completion questions, keyed by question id.
   *  Required (and stored) when the entry brings the task to 100%. */
  completion_qa?: Record<string, string>;
}

/** `POST /api/progress/bulk` — олон мөрийн өдөр тутмын тайланг нэг
 *  round-trip-аар илгээх.  Мөр бүр дээр `POST /api/progress`-тэй яг
 *  ижил дүрэм ажиллана; зөвхөн 100% хаалт (completion_qa шаардсан)
 *  нь bulk-д ОРОХГҮЙ — түүнийг ганцаарчилсан dialog-оор л илгээнэ. */
export interface ProgressBulkRequest {
  entries: ProgressEntryRequest[];
}

/** Ирцийн сонголт хоёр эх сурвалжтай (2026-09-17, миграц 0324): `project_ids`
 *  нь `projects.id`, `repair_project_ids` нь `repair_projects.id` — ХОЁР ӨӨР
 *  id-ийн орон зай тул ХЭЗЭЭ Ч нэг массивт хийхгүй.  «Дор хаяж нэг» дүрэм
 *  хоёрын нийлбэрээр. */
export interface ClockInRequest {
  device_id?: string;
  notes?: string;
  project_ids?: number[];
  repair_project_ids?: number[];
  /** Браузераас үл хамаарах техник хангамжийн профайл — ижил компьютерийн
   *  шинэ браузерыг таних (`lib/attendanceDevice.ts`).  Сонголттой. */
  device?: import('./lib/attendanceDevice').HwProfileInput;
  /** Энэ цэгт сонгосон төслийн бус ажил (0357) — `lib/nonProjectWork.ts`
   *  `parseNonProjectPicks`.  Талбаргүй (хуучин клиент) бол сонголтод хүрэхгүй. */
  non_project?: unknown;
}

export interface ClockOutRequest {
  notes?: string;
  project_ids?: number[];
  repair_project_ids?: number[];
  /** Гарах үед сонголт бүр «юу хийсэн» `report`-той ирж болно. */
  non_project?: unknown;
}

export interface AttendanceCheckpointRequest {
  checkpoint_type?: AttendanceCheckpointType;
  notes?: string;
  project_ids?: number[];
  repair_project_ids?: number[];
  non_project?: unknown;
}

/* ------------------------------------------------------------------ */
/*  Calendar / dashboard announcements                                  */
/* ------------------------------------------------------------------ */

export type CalendarPriority = 'normal' | 'high' | 'urgent';

export interface CalendarEventRow {
  id: number;
  event_date: string;
  title: string;
  /** Optional short one-liner shown above the longer message body. */
  summary: string | null;
  message: string | null;
  task_id: number | null;
  /** Legacy single-team column (migration 0041).  Kept as a dead column —
   *  targeting now lives in the `calendar_event_teams` junction
   *  (migration 0100); reads/writes no longer consult this. */
  team_id: number | null;
  /** Comma-separated team codes / ids / names this event targets,
   *  aggregated from `calendar_event_teams`.  null = company-wide
   *  (no junction rows).  See migration 0100. */
  team_codes: string | null;
  team_ids_csv: string | null;
  team_names: string | null;
  priority: CalendarPriority;
  /** Optional time-of-day window (HH:MM, 24h).  Both null = whole-day
   *  announcement.  See migration 0053. */
  start_time: string | null;
  end_time: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  /** Google Calendar sync bookkeeping (migration 0124).  NULL until the row
   *  has been pushed to / imported from Google.  google_synced_at is stored
   *  in SQLite CURRENT_TIMESTAMP format so it is comparable with updated_at. */
  google_event_id: string | null;
  google_etag: string | null;
  google_synced_at: string | null;
}

export interface CalendarEventAckRow {
  event_id: number;
  user_id: number;
  acknowledged_at: string;
}

export interface CreateCalendarEventRequest {
  event_date: string;
  title: string;
  summary?: string | null;
  message?: string | null;
  task_id?: number | null;
  /** Teams this event targets.  Empty array / omitted = visible to
   *  everyone (company-wide).  See migration 0100. */
  team_ids?: number[];
  /** @deprecated single-team scope kept for back-compat; prefer team_ids.
   *  When sent, it's treated as `[team_id]`. */
  team_id?: number | null;
  priority?: CalendarPriority;
  /** Optional HH:MM (24h) time window.  Both omitted/null = whole-day. */
  start_time?: string | null;
  end_time?: string | null;
}

export interface UpdateCalendarEventRequest {
  event_date?: string;
  title?: string;
  summary?: string | null;
  message?: string | null;
  task_id?: number | null;
  /** When provided, replaces the event's team targeting.  Empty array =
   *  company-wide.  Omitted = leave targeting unchanged. */
  team_ids?: number[];
  /** @deprecated kept for back-compat; treated as `[team_id]` (or
   *  company-wide when null). */
  team_id?: number | null;
  priority?: CalendarPriority;
  start_time?: string | null;
  end_time?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Leaderboard / performance scoring                                  */
/* ------------------------------------------------------------------ */

/**
 * Per-project complexity tier.  Drives employee performance scoring:
 * each tier maps to a percentage weight (see {@link COMPLEXITY_PERCENT}).
 */
export type ProjectComplexity = 'low' | 'mid' | 'high' | 'special';

/**
 * One row per (user × approved progress entry) recorded in `user_points`.
 * `amount` now stores the percent-points share the user earned for the
 * task — there is no money component anymore.
 */
export interface UserPointRow {
  id: number;
  user_id: number;
  project_id: number;
  task_id: number | null;
  progress_entry_id: number | null;
  amount: number; // percent points awarded (e.g. 25 * deltaPct/100 / N)
  delta_pct: number; // project progress delta that triggered the award
  assignee_count: number; // how many eligible assignees the points were split between
  awarded_at: string;
  awarded_by: number | null;
}

/** Admin-tier full leaderboard row (one user). */
export interface LeaderboardEntry {
  user_id: number;
  full_name: string;
  username: string;
  role: UserRole;
  profile_image: string | null;
  total_points: number; // primary display value (percent points)
  projects: number;
  award_count: number;
  last_awarded_at: string | null;
}

/** "My stats" — what every authenticated user can fetch about themselves. */
export interface MyLeaderboardStats {
  rank: number | null;
  total_workers: number;
  /** Сүүлийн 30 хоногийн бүтээмж — батлагдсан чөлөөт өдрийг алгасаж өмнөх
   *  ажлын өдрүүдээр нөхсөн (lib/leaveAvailability.ts). */
  total_points: number;
  /** 30 хуанлийн хоногт бодитоор олгогдсон (чөлөөгүй бол `total_points`-тэй ижил). */
  total_points_actual: number;
  /** Алгассан батлагдсан чөлөөт ажлын өдөр. */
  leave_days: number;
  award_count: number;
  recent: Array<{
    id: number;
    project_id: number;
    project_name: string | null;
    project_complexity_pct: number | null;
    task_id: number | null;
    task_name: string | null;
    points: number;
    delta_pct: number;
    awarded_at: string;
  }>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

export const STANDARD_WORK_DAY_HOURS = 8;

export const LATE_PENALTY_PER_MINUTE = 500;

/**
 * Per-project complexity → percent weight used for performance scoring.
 * Each progress submission awards `complexity_pct × deltaPct / 100`
 * percent points, split evenly across the task's eligible assignees.
 */
export const COMPLEXITY_PERCENT: Record<ProjectComplexity, number> = {
  low: 25,
  mid: 50,
  high: 75,
  special: 100,
};
