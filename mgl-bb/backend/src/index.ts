import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './middleware/auth';
import { officeAccessGuard } from './middleware/officeAccessGuard';
import { workerScopeGuard } from './lib/workerScope';
import { clientScopeGuard } from './lib/clientScope';
import { revitLegacyTokenGuard } from './middleware/revitLegacyTokenGuard';
import { getClientIpFromRequest } from './lib/officeNetwork';
import { assertOfficeAccess, officeAccessJson } from './lib/officeAccess';
import { entitlementGuard } from './lib/entitlement';
import { parseTenants, resolveTenant, tenantEnv, TENANT_HEADER } from './lib/tenants';
import { runWithTenant, currentTenantId, hasTenantContext } from './lib/requestContext';
import { loadOrgConfig, orgConfig } from './lib/orgConfig';
import type { Env, AppVariables } from './types';

import auth from './routes/auth';
import users from './routes/users';
import projects from './routes/projects';
import blocks from './routes/blocks';
import drawings from './routes/drawings';
import components from './routes/components';
import tasks from './routes/tasks';
import progress from './routes/progress';
import taskTimer from './routes/taskTimer';
import taskAllocations from './routes/taskAllocations';
import taskRootSplit from './routes/taskRootSplit';
import taskAllocAdmin from './routes/taskAllocAdmin';
import { sweepPendingPostCommit } from './lib/taskPostCommit';
import { sweepCreditReconcileQueue } from './lib/taskCreditReconcileQueue';
import repair from './routes/repair';
import pgp from './routes/pgp';
import assessments from './routes/assessments';
import dashboard from './routes/dashboard';
import teams from './routes/teams';
import teamProductivity from './routes/teamProductivity';
import profiles from './routes/profiles';
import notifications from './routes/notifications';
import attendance from './routes/attendance';
import attendanceConfirmations from './routes/attendanceConfirmations';
import nonProjectWork from './routes/nonProjectWork';
import dailyWorkLogs from './routes/dailyWorkLogs';
import officeIps from './routes/office-ips';
import projectChat from './routes/projectChat';
import clientPortal from './routes/clientPortal';
import clientFiles from './routes/clientFiles';
import clientAdmin from './routes/clientAdmin';
import clientDrive from './routes/clientDrive';
import clientDriveAdmin from './routes/clientDriveAdmin';
import documents from './routes/documents';
import upload from './routes/upload';
import media from './routes/media';
import leaves from './routes/leaves';
import outOfOffice from './routes/out-of-office';
import suggestions from './routes/suggestions';
import engineeringFeedback, { sweepEngineeringFeedback } from './routes/engineeringFeedback';
import company from './routes/company';
import speedtest from './routes/speedtest';
import calendar from './routes/calendar';
import leaderboard from './routes/leaderboard';
import reports from './routes/reports';
import settings from './routes/settings';
import correspondence from './routes/correspondence';
import authorSupervision from './routes/authorSupervision';
import asrBackfill from './routes/asrBackfill';
import asrSafety from './routes/asrSafety';
import authorSupervisionStats from './routes/authorSupervisionStats';
import asrSummary from './routes/asrSummary';
import landing from './routes/landing';
import landingBlocks from './routes/landingBlocks';
import ai from './routes/ai';
import mglAi from './routes/mglAi';
import devWorkbench from './routes/devWorkbench';
import mglAiFleet from './routes/mglAiFleet';
import { mglAiNormRegistry } from './routes/mglAiNormRegistry';
import statusStarters from './routes/statusStarters';
import performanceReports from './routes/performanceReports';
import projectCharts from './routes/projectCharts';
import projectDrive, { driveErrorResponse } from './routes/projectDrive';
import mainProjects from './routes/mainProjects';
import driveSigning from './routes/driveSigning';
import { createSigningRouters } from './routes/publicDocumentSigning';
import { realSigningRender, renderDriveSignedPdf } from './lib/publicSigningRender';
import { createDrivePublicSigning } from './routes/drivePublicSigning';
import { makeDriveSignIo } from './lib/driveSigningIo';
import { loadMainProjectDriveRoot, loadProjectDriveRoot } from './lib/projectDrive';
import reportTemplates from './routes/reportTemplates';
import normCatalog from './routes/normCatalog';
import teamDrawingItems from './routes/teamDrawingItems';
import teamFormTemplates from './routes/teamFormTemplates';
import qto from './routes/qto';
import revit from './routes/revit';
import revitAddin from './routes/revitAddin';
import revitTracking from './routes/revitTracking';
import revitLicense from './routes/revitLicense';
import revitDevice from './routes/revitDevice';
import revitChangeNotices from './routes/revitChangeNotices';
import aps from './routes/aps';
import email from './routes/email';
import meetings from './routes/meetings';
import holidays from './routes/holidays';
import handbook from './routes/handbook';
import internalRules from './routes/internalRules';
import announcements from './routes/announcements';
import speechmatics from './routes/speechmatics';
import meetingAudio from './routes/meetingAudio';
import pdfTools from './routes/pdfTools';
import quotes from './routes/quotes';
import push from './routes/push';
import ticker from './routes/ticker';
import timeline from './routes/timeline';
import deadlines from './routes/deadlines';
import projectDeadline from './routes/projectDeadline';
import learning from './routes/learning';
import compliance from './routes/compliance';
import search from './routes/search';
import devD1Probe from './routes/devD1Probe';
import storageAudit from './routes/storageAudit';
import { syncAllMailboxes } from './lib/emailSync';
import { sweepPushNotifications } from './lib/pushSweep';
import { runDeadlineSweep } from './lib/deadlineSweep';
import { runEmployeeSnapshot } from './lib/employeeSnapshot';
import { sweepGoogleDocSync } from './lib/documentGoogle';
import { syncProjectDriveChanges } from './lib/projectDriveSync';
import { runRepairHoursBackfillCron } from './lib/repairDayStore';
import { runTaskTimerDayEndSweep } from './lib/taskTimerSweep';
import { reconcileMeetings } from './lib/meetingTranscription';
import { reconcileAsrRecordings } from './lib/asrTranscription';
import { syncGoogleCalendar } from './lib/googleCalendarSync';
import { verifyToken } from './lib/jwt';
import { checkTokenValidity } from './lib/tokenValidity';
import {
  d1ServerTiming,
  d1StatsOf,
  formatD1Log,
  instrumentD1,
  overThreshold,
  withD1Telemetry,
} from './lib/d1Telemetry';
import { liveSource, normalizeLivePath, recordLive, shouldRecord, type LiveEvent } from './lib/liveTraffic';
import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { MglMcpAgent, type McpProps } from './mcp/MglMcpAgent';
import { checkMcpAccess, isMcpPath, MCP_ROUTES } from './mcp/guard';
import authorizeRoutes from './oauth/authorize';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// CORS allowlist is environment-scoped: production origins come from
// wrangler.toml [vars] ALLOWED_ORIGINS, localhost origins from .dev.vars
// (which overrides [vars] in `wrangler dev`). So production allows only
// production, local allows only local — no reflect-any. Entries are exact
// origins or `*.suffix` wildcards (Pages preview deploys).
app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      // No Origin header → same-origin / non-browser caller; nothing to gate.
      if (!origin) return origin;
      const allowed = ((c.env as Env).ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const entry of allowed) {
        if (entry === origin) return origin;
        if (entry.startsWith('*.') && origin.endsWith(entry.slice(1))) return origin;
      }
      return null; // disallowed → no Access-Control-Allow-Origin header
    },
    credentials: true,
    // ⚠️ TODO(tenant) — T6, ЭНЭ АЖЛЫН ХАМРАХ ХҮРЭЭНД БИШ (1A-4 §3 алхам 6).
    //    `'X-Tenant'` энд БАЙХГҮЙ.  `*.workers.dev` дээр бүх компани НЭГ host
    //    хуваалцдаг тул `lib/tenants.ts`-ийн 2-р зам (толгойгоор ялгах) нь
    //    браузерын cross-origin SPA-аас preflight дээр УНАНА.  Мөн
    //    `ALLOWED_ORIGINS` нь `[vars]` — Worker-т ГЛОБАЛ тул бүх компанийн
    //    домэйн нэг жагсаалтад холилдоно.  Frontend-ийн `X-Tenant` талтай
    //    ХАМТ хийгдэнэ; ганцаараа нэмэх нь ашиггүй.
    // `X-Upload-Token` — төслийн Drive байршуулалтын chunk/цуцлалт (routes/projectDrive.ts,
    // 2026-09-18): гарын үсэгтэй тикет толгойгоор явдаг; жагсаалтад байхгүй бол хөтөч
    // preflight дээр л унана (прод дээр хэмжсэн: «x-upload-token is not allowed»).
    //
    // `X-Task-Alloc-Contract` / `X-Request-Id` — таскийн хуваарилалтын нэгжийн гэрээ (2026-10-05, lib/taskAllocGate.ts).
    // ⚠️ Жагсаалтад БАЙХГҮЙ бол хуваарилалтын хүсэлт бүр preflight дээр унана.  Тиймээс ЭХЛЭЭД worker, ДАРАА нь Pages
    // deploy хийнэ (шинэ frontend + хуучин worker = зөвхөн хуваарилалтын хүсэлт унана, бичигдэхгүй — fail closed).
    allowHeaders: ['Content-Type', 'Authorization', 'X-Device-Id', 'X-Upload-Token', 'X-Task-Alloc-Contract', 'X-Request-Id'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Cross-origin SPA нь хариуны толгойг ЗӨВХӨН энд жагсаасан бол уншина (426/423 болон гэрээний хувилбар).
    exposeHeaders: ['X-Task-Alloc-Contract', 'X-Task-Alloc-State', 'X-Request-Id'],
  }),
);

// Байгууллагын тохиргоо (нэр, цагийн бүс, ээлжийн цаг, CEO id …) — ENV дээр
// `app_settings` дахь `org.*` мөрүүдийг давхарлана.  `lib/orgConfig.ts` нь
// үр дүнг 60 секунд memo хийдэг тул энэ нь ихэвчлэн санах ойн уншилт бөгөөд
// DB рүү isolate тутамд минутанд нэгээс олон очихгүй.
//
// БҮХ зам дээр (зөвхөн `/api/*` биш): `/media`, root, `/authorize` ч гэсэн
// байгууллагын нэрийг харуулдаг.  Алдаа гарвал `loadOrgConfig` дотроо
// залгидаг тул хүсэлт унахгүй — хамгийн муудаа дефолт утга хүчинтэй болно.
app.use('*', async (c, next) => {
  await loadOrgConfig(c.env);
  await next();
});

// Lightweight request timing.  Logs a single line per request with
// method, path, status, and elapsed ms — Workers ships these straight
// to `wrangler tail` / Logpush so we can spot p95 hotspots without
// wiring up Analytics Engine.  A `Server-Timing` header lets Chrome
// DevTools surface the same number under each XHR's "Timing" tab.
app.use('/api/*', async (c, next) => {
  const start = Date.now();
  await next();
  const elapsed = Date.now() - start;
  // D1 мөрийн тоолуур (lib/d1Telemetry.ts) — `defaultHandler` нь хүсэлт бүрд
  // `env.DB`-г телеметртэй хувилбараар сольсон тул энд статистик бэлэн.
  const d1 = d1StatsOf(c.env.DB);
  c.res.headers.set('Server-Timing', d1 ? `app;dur=${elapsed}, ${d1ServerTiming(d1)}` : `app;dur=${elapsed}`);
  // Sample noisy endpoints to keep log volume bounded; everything
  // slower than 250 ms is always logged so we never miss a regression.
  const verbose = c.env.D1_TELEMETRY_VERBOSE === '1';
  if (elapsed >= 250 || verbose || Math.random() < 0.05) {
    console.log(`[timing] ${c.req.method} ${c.req.path} ${c.res.status} ${elapsed}ms`);
  }
  // Хүнд D1 хүсэлт (олон мөр скандсан / олон query) — үргэлж логдоно; verbose
  // горимд бүх хүсэлт.  Хямд зам (polling, cron) лог гаргахгүй.
  if (d1 && (verbose || overThreshold(d1))) {
    console.log(formatD1Log(`${c.req.method} ${c.req.path} ${c.res.status}`, d1));
  }
  // Verbose (зөвхөн локал): хамгийн хүнд query-үүдийг толгойгоор ч буцаана —
  // `wrangler dev`-ийн stdout-ыг файл руу чиглүүлэхэд worker-ийн console
  // мөрүүд алдагддаг тул хэмжилтийн скрипт үүнийг уншина.
  if (d1 && verbose) {
    c.res.headers.set(
      'X-D1-Top',
      encodeURIComponent(JSON.stringify(d1.heaviest.map((h) => [h.rowsRead, h.rows, h.sql]))),
    );
  }
  // System Workbench-ийн амьд урсгал (lib/liveTraffic.ts) — санах ойд л, үзэгчгүй
  // үед ≤1 probe / 10 сек; D1-д юу ч бичихгүй.
  if (!hasTenantContext() && shouldRecord(c.req.method, c.req.path)) {
    const user = c.get('user');
    recordLive(c.env, safeExecutionCtx(c), {
      t: Date.now(),
      k: 'http',
      m: c.req.method,
      p: normalizeLivePath(c.req.path),
      s: c.res.status,
      ms: elapsed,
      q: d1?.queries ?? 0,
      r: d1?.rowsRead ?? 0,
      w: d1?.rowsWritten ?? 0,
      u: user?.sub ?? null,
      role: user?.role ?? null,
      c: liveColo(c.req.raw),
      ch: c.res.headers.get('x-edge-cache'),
      src: liveSource(c.req.header('user-agent'), user?.purpose),
    });
  }
});

/**
 * Hono-гийн `executionCtx` нь контекстгүй (тест) үед шиддэг.  Структур төрөл —
 * Hono ба workers-types-ийн `ExecutionContext` зарлалууд нийцдэггүй (routes/email.ts-тэй ижил).
 */
function safeExecutionCtx(c: { executionCtx: { waitUntil(p: Promise<unknown>): void } }): {
  waitUntil(p: Promise<unknown>): void;
} | null {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

function liveColo(request: Request): string | null {
  const colo = (request as Request & { cf?: { colo?: unknown } }).cf?.colo;
  return typeof colo === 'string' ? colo : null;
}

// `/media/*` (R2) — `/api/*`-ийн timing middleware хамардаггүй тул тусад нь.
app.use('/media/*', async (c, next) => {
  const start = Date.now();
  await next();
  if (hasTenantContext() || c.req.method === 'OPTIONS') return;
  recordLive(c.env, safeExecutionCtx(c), {
    t: Date.now(),
    k: 'http',
    m: c.req.method,
    p: '/media/:key',
    s: c.res.status,
    ms: Date.now() - start,
    q: 0,
    r: 0,
    w: 0,
    u: null,
    role: null,
    c: liveColo(c.req.raw),
    ch: null,
    src: liveSource(c.req.header('user-agent')),
  });
});

// Public CORS for media — `<img>` tags don't usually need it, but
// `fetch()` callers (e.g. download buttons) do.  No credentials, no
// Authorization, just open GET.
app.use('/media/*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));

// Нэвтрэхгүй client гарын үсгийн link — bearer token өөрөө тухайн НЭГ баримтын
// эрх тул cookie/session хэрэглэдэггүй.  Cross-origin Pages -> Worker POST-д
// зөвхөн Content-Type нээнэ; /api-ийн staff auth-аас ЗОРИУД гадна.
app.use(
  '/public/signing/*',
  cors({ origin: '*', allowHeaders: ['Content-Type'], allowMethods: ['GET', 'POST', 'OPTIONS'] }),
);
const { publicDocumentSigning, signingLinks } = createSigningRouters(realSigningRender);
// «Баримт бичиг» (Drive) Word баримтын гаднын link (0397) — ЭХЛЭЭД: токен энэ хүснэгтэд
// байхгүй бол `next()` → доорх 0381-ийн (RFI/CR, ЗХ) handler.
app.route(
  '/public/signing',
  createDrivePublicSigning({
    io: makeDriveSignIo(driveErrorResponse),
    resolveRoot: (db, scope, id) => (scope === 'main' ? loadMainProjectDriveRoot(db, id) : loadProjectDriveRoot(db, id)),
    renderPdf: renderDriveSignedPdf,
  }),
);
app.route('/public/signing', publicDocumentSigning);

app.use('/api/*', authMiddleware);
// Staff-ийг зөвхөн оффисын IP-ээс (client + remote_access_allowed-аас бусад).
app.use('/api/*', officeAccessGuard);
// `worker` (цэвэрлэгч) role-ийн цагаан жагсаалт — ирц/чөлөө/профайлаас
// бусад БҮХ /api гарцыг 403-оор хаана.  See lib/workerScope.ts.
app.use('/api/*', workerScopeGuard);
// `client` (захиалагч) role-ийн цагаан жагсаалт — портал ашигладаг гарцаас
// бусад БҮХ /api замыг 403-оор хаана.  See lib/clientScope.ts.
app.use('/api/*', clientScopeGuard);
// Revit add-in-ий QTO push замууд (зөвхөн add-in дуудна) — 365 хоногийн `mcp` токеныг
// `revit.legacy_token_policy = deny` үед хаана (migration 0375).  Вэб session (purpose-гүй)
// болон төхөөрөмжийн session (`purpose:'revit'`) хөндөгдөхгүй.  `/api/revit/*`-ийн хаалт
// `routes/revit.ts`-д.
app.use('/api/qto/revit-runs', revitLegacyTokenGuard);
app.use('/api/qto/schedules', revitLegacyTokenGuard);
app.use('/api/qto/view-exports', revitLegacyTokenGuard);
// Модулийн эрхийн хаалт — тухайн байгууллага худалдаж аваагүй модулийг
// 403-оор хаана.  Тохируулаагүй үед юу ч хийхгүй (see lib/entitlement.ts).
app.use('/api/*', entitlementGuard);

app.route('/api/auth', auth);
app.route('/api/users', users);
app.route('/api/projects', projects);
// Second mount on the same prefix: performance-report routes live under
// /api/projects/:id/performance-reports/... but are kept in their own
// module so projects.ts doesn't grow further.
app.route('/api/projects', performanceReports);
app.route('/api/projects', projectCharts);
// Төслийн баримт бичиг — Google Drive нь эх сурвалж; /api/projects/:id/drive/*
// (routes/projectDrive.ts).  Ижил угтвар дээрх ТАВ ДАХЬ mount.
app.route('/api/projects', projectDrive);
// Үндсэн төсөл — ангиллын төслүүдийг (AZ/ZA/…) нэгтгэж, баримт бичгийн Drive
// хавтсыг НЭГ газар холбоно (routes/mainProjects.ts, migration 0281).
app.route('/api/main-projects', mainProjects);
// Word баримтын гарын үсэг — захирлын хүлээгдэж буй дараалал (routes/driveSigning.ts,
// migration 0371).  Файл тус бүрийн замууд нь дээрх хоёр Drive router-т.
app.route('/api/drive-signing', driveSigning);
// RFI/CR + ЗХ тайлангийн гаднын гарын үсгийн хугацаатай share link (0381).
app.route('/api/signing-links', signingLinks);
app.route('/api/report-templates', reportTemplates);
app.route('/api/norm-catalog', normCatalog);
app.route('/api/team-drawing-items', teamDrawingItems);
app.route('/api/projects', teamFormTemplates);
app.route('/api/blocks', blocks);
app.route('/api/drawings', drawings);
app.route('/api/components', components);
// Таскийн хуваарилалт (2026-10-02): `/api/tasks/:id/allocation/*` — `tasks`-ийн `/:id`-ээс ӨМНӨ.
// Менежерийн гадаргуу (`/api/tasks/alloc-admin/*`: төлөв, тойм, аудит, хөрвүүлэлт) — хаалганаас ЧӨЛӨӨТЭЙ, ЗААВАЛ эхэнд.
app.route('/api/tasks', taskAllocAdmin);
app.route('/api/tasks', taskAllocations);
// Таскийг үндсэн таскууд болгон хуваах / буцаах (0395) — `tasks`-ийн `/:id`-ээс ӨМНӨ.
app.route('/api/tasks', taskRootSplit);
app.route('/api/tasks', tasks);
app.route('/api/progress', progress);
// Албан ёсны таскийн цаг хэмжигч (▶/⏸, 0361) — захирал/админд харагдах ЦОРЫН
// ГАНЦ албан цаг.  Revit-ийн автомат цаг (0360) энд холилдохгүй.
app.route('/api/task-timer', taskTimer);
// Засвар — ажилтны өөрөө бүртгэх засвар/нэмэлт ажил (leaderboard-д ордог).
app.route('/api/repair', repair);
// Хувь хүний хөгжлийн төлөвлөгөө (PGP) — ажилтан жил бүр бөглөнө, удирдлага харж санал өгнө.
app.route('/api/pgp', pgp);
// Ур чадвар / зан чанарын үнэлгээ — template → round → self/senior маягт.
app.route('/api/assessments', assessments);
app.route('/api/dashboard', dashboard);
app.route('/api/teams', teams);
// Багийн профайлын «Бүтээмж» таб (0346) — ижил угтвар дээрх ХОЁР ДАХЬ mount;
// замууд (`/:id/productivity*`, `/productivity/settings`) дээрхтэй давхцахгүй.
app.route('/api/teams', teamProductivity);
app.route('/api/profiles', profiles);
app.route('/api/notifications', notifications);
// Браузерын push мэдэгдэл — төхөөрөмжийн бүртгэл + ангиллын тохиргоо.
// Мэдэгдлийг өөрийг нь минут тутмын cron (lib/pushSweep.ts) илгээнэ.
app.route('/api/push', push);
app.route('/api/attendance', attendance);
app.route('/api/attendance-confirmations', attendanceConfirmations);
// Төслийн бус ажил (0342) — ирцийн цонх ба «Миний ажлууд»-аас бүртгэнэ.
// Шинэ угтвар тул worker/client-ийн цагаан жагсаалтад ОРООГҮЙ (хаалттай).
app.route('/api/non-project-work', nonProjectWork);
// Өдрийн ажлын тайлан (0345) — админ Профайл дээрээ бичнэ, зөвхөн өөрөө харна.
// Шинэ угтвар тул worker/client-ийн цагаан жагсаалтад ОРООГҮЙ (хаалттай).
app.route('/api/daily-work-logs', dailyWorkLogs);
app.route('/api/office-ips', officeIps);
app.route('/api/project-chat', projectChat);
// Захиалагчийн портал — уншилт, материал илгээх, realtime суваг.
app.route('/api/client', clientPortal);
// Захиалагчид нээсэн төслийн Drive баримт (0327) — ижил угтвар дээрх ХОЁР ДАХЬ mount.
app.route('/api/client', clientDrive);
// Хувийн R2-оос файл дамжуулах (илгээсэн материал + гаргасан зургийн багц).
app.route('/api/client-files', clientFiles);
// Ажилтны тал: байгууллага, эрх, нийтлэл, багц, ирсэн материалын шалгалт.
// ⚠️ `/api/client-admin` нь `lib/clientScope.ts`-ийн цагаан жагсаалтад
//    ОРООГҮЙ (сегментийн хилээр таардаг) тул захиалагч энд хүрэхгүй.
app.route('/api/client-admin', clientAdmin);
// Захиалагчид Drive хавтас/файл нээх, хаах, татсан лог (routes/clientDriveAdmin.ts).
app.route('/api/client-admin', clientDriveAdmin);
app.route('/api/documents', documents);
app.route('/api/upload', upload);
app.route('/api/media', media);
// Public mount — uploads return `/media/<key>` for use in plain
// `<img src>` tags, which can't carry the bearer token that `/api/*`
// requires.  Without this top-level route every avatar 404s even
// though the upload itself succeeded.
app.route('/media', media);
app.route('/api/leaves', leaves);
app.route('/api/out-of-office', outOfOffice);
// Санал хүсэлт — ажилтны санал/хүсэлт (received → discussing → resolved).
app.route('/api/suggestions', suggestions);
// Програмын хүсэлт (2026-10-16, migrations 0410–0414) — Revit add-in-ий «Санал хүсэлт» ба ERP-ээс; inbox нь ЗӨВХӨН
// баталгаажсан Software Engineer-т (lib/engineeringFeedbackAccess.ts).  Admin suggestions / OWNER_ID=1 revit-addin
// router-ийн ДОР ЗОРИУД mount хийгээгүй.  workerScope/clientScope-д ЗОРИУД байхгүй (worker, client хаалттай); Revit-ийн
// төхөөрөмжийн session зөвхөн илгээх замуудад (lib/revitSessionCheck.ts, method-aware).
app.route('/api/engineering-feedback', engineeringFeedback);
app.route('/api/company', company);
app.route('/api/speedtest', speedtest);
app.route('/api/calendar', calendar);
app.route('/api/leaderboard', leaderboard);
app.route('/api/reports', reports);
// BIM-AI сургалтын үйл явдлын леджер (миграц 0201–0210).  ТУСДАА модуль —
// `progress`-ийн хэсэг БИШ (`lib/modules.ts`-ийн `MODULE_OF` -ийг үз).
// ⚠️ Энэ гадаргууг `/mcp`-ээр ХЭЗЭЭ Ч гаргахгүй: `/mcp` нь workerScopeGuard,
//    entitlementGuard, tenant-ийн хил ГУРВУУЛАНГ тойрдог.  Шалтгаан нь
//    `routes/learning.ts`-ийн толгойд бүтнээр бичигдсэн.
app.route('/api/learning', learning);
// Нийцлийн дүрмийн загвар (миграц 0220–0223) — БНбД/MNS баримтын бүртгэл,
// хувилбартай дүрэм, `rulepack-v1` багц.  ⚠️ `lib/workerScope.ts`-д НЭМЭХГҮЙ:
//    тэр цагаан жагсаалт тул нэмэхгүй байх нь `worker`-ыг ЗӨВ хаана.
// ⚠️ Энэ mount нь ЯГ НЭГ УДАА бичигдэнэ — `2-3`…`2-7` сессүүд ДАХИН нэмэхгүй.
app.route('/api/compliance', compliance);
// Нэгдсэн хайлт — төсөл (нэр · урт гарчиг · зургийн шифр · баримтын дугаар)
// + тэдгээрийн доторх бичлэгүүд.  ⚠️ `lib/workerScope.ts`-д НЭМЭХГҮЙ: тэр
// цагаан жагсаалт тул нэмэхгүй байх нь `worker`-ыг ЗӨВ 403-оор хаана.
app.route('/api/search', search);
app.route('/api/settings', settings);
app.route('/api/correspondence', correspondence);
// Зохиогчийн хяналт — /app/asr самбарын статистик (routes/authorSupervisionStats.ts).
// ⚠️ ҮНДСЭН router-ээс ӨМНӨ: тэр нь `GET /:id`-тэй тул `/stats`-ыг 400-аар залгина.
app.route('/api/author-supervision', authorSupervisionStats);
// Зохиогчийн хяналтын НЭГТГЭЛ тайлан (admin) — `/summary`, `/summary/pdf` (routes/asrSummary.ts).
// ⚠️ ҮНДСЭН router-ээс ӨМНӨ: тэр нь `GET /:id`, `GET /:id/pdf`-тэй.
app.route('/api/author-supervision', asrSummary);
// Зохиогчийн хяналт (ASR) — төслийн талбайн хяналтын тайлангийн бүртгэл.
// ⚠️ `asrSafety` нь ЭХЛЭЭД: `/safety*` замууд үндсэн router-ийн `/:id`-ээс
// өмнө таарах ёстой, мөн `POST /projects/:id`-ийн ХАБ-ын хаалт нь
// `await next()`-ээр үндсэн create handler руу залгадаг middleware.
// Хуучин ЗХ тайлан нөхөж бүртгэх (`/backfill/*`, миграц 0332) — үндсэн
// router-оос ӨМНӨ, `GET /:id`-тэй мөргөлдөхгүй (routes/asrBackfill.ts).
app.route('/api/author-supervision', asrBackfill);
app.route('/api/author-supervision', asrSafety);
app.route('/api/author-supervision', authorSupervision);
app.route('/api/landing', landing);
app.route('/api/landing/v2', landingBlocks);
app.route('/api/ai', ai);
// MGL AI — ХЯНАЛТЫН ХАВТГАЙ.  ⚠️ Энэ mount нь LLM ажиллуулдаггүй: инференс
// нь ажилтны PC дээрх `mgl-ai-runtime` (llama.cpp) эсвэл захиалагчийн хөтөч
// дээр (WebGPU) явагдана.  Worker нь эрх, контекст, типтэй ERP хэрэгсэл,
// яриа, санал хүсэлт, загварын релизийг эзэмшинэ.  `/api/ai` (Workers AI-ийн
// монгол бичвэр сайжруулагч) -тай мөргөлдөхгүй — Hono `/` хилээр салгадаг.
// Developer workbench lives under the existing MGL AI module prefix so the
// module registry remains a single source of truth. It is admin-only and
// feature-flagged inside the router; mount it before general MGL AI handlers.
app.route('/api/mgl-ai', devWorkbench);
app.route('/api/mgl-ai', mglAi);
// Session B — MGL AI флот / релизийн манифест / алдааны inbox.  Ижил prefix дээрх
// ХОЁР ДАХЬ router (тусдаа файл, mglAi.ts-ийг хөндөхгүй); замууд давхцдаггүй.
app.route('/api/mgl-ai', mglAiFleet);
app.route('/api/mgl-ai', mglAiNormRegistry);
app.route('/api/status-starters', statusStarters);
// Тоо хэмжээ (QTO) — quantity take-off run history (computed in-browser,
// summaries persisted for diffing + the MCP get_project_quantities tool).
app.route('/api/qto', qto);
// Revit add-in -> явц.  `/api/revit-addin`-тай мөргөлдөхгүй: Hono нь `/`
// хилээр салгадаг бөгөөд `moduleOfPath` нь PREFIXES_LONGEST_FIRST тул
// `/api/revit-addin` замд урт угтвар нь ялна.
app.route('/api/revit', revit);
// Revit-ийн автомат цаг бүртгэл (0360) — `/api/revit`-ийн ХОЁР ДАХЬ mount
// (`/tracking/*` л; `revit.ts`-ийн замуудтай давхцахгүй, өөрийн role хаалттай).
app.route('/api/revit', revitTracking);
// Revit add-in-ий ЛИЦЕНЗ (0374) — `/api/revit`-ийн ГУРАВ ДАХЬ mount (`/license*` л).
// Add-in 1.9+ нь бүх хэрэгслээ зөвхөн гарын үсэгтэй лицензтэй үед ажиллуулна.
app.route('/api/revit', revitLicense);
app.route('/api/revit', revitDevice);
// Revit «Өөрчлөхөөс өмнө»-ийн ӨӨРЧЛӨЛТИЙН МЭДЭГДЭЛ (0390) — `/identity`, `/change-notices*`, `/aliases`.
app.route('/api/revit', revitChangeNotices);
// «Revit нэмэлт» татах — Revit add-in суулгах zip-үүд (одоохондоо зөвхөн id 1).
app.route('/api/revit-addin', revitAddin);
// APS (Autodesk Platform Services) 3D viewer — .rvt upload→SVF2 translation +
// viewer token. Replaces the old ifc-convert container / xeokit pipeline.
app.route('/api/aps', aps);
app.route('/api/email', email);
// Хурлын тэмдэглэл — admin-tier voice-meeting transcription + analysis.
app.route('/api/meetings', meetings);
app.route('/api/holidays', holidays);
// Гарын авлага — албан тушаал × түвшин тус бүрийн заавар (унших нь staff,
// бичих нь admin).  Ажилтан профайл дээрээ өөрийн role-ын нийтлэгдсэн
// бичлэгүүдийг хардаг — routes/handbook.ts.
app.route('/api/handbook', handbook);
// Дотоод журам — ажилтан уншиж, профайлын гарын үсгээрээ танилцсанаа
// баталгаажуулна; хувилбар бүрд дахин зурна (миграц 0330, routes/internalRules.ts).
app.route('/api/internal-rules', internalRules);
// Нийтийн мэдээлэл — системийн шинэчлэлт / компанийн мэдээлэл / зарлал; HTML
// агуулга, уншсан баталгаа эсвэл профайлын гарын үсэг (миграц 0338,
// routes/announcements.ts).  Зохиогч/статистик зөвхөн admin.
app.route('/api/announcements', announcements);
// Stirling-PDF passthrough for the performance-report editor (config + process).
app.route('/api/pdf-tools', pdfTools);
// Үнийн санал — хуудсан (sheet) загвартай баримт + тарифын каталог (admin-only).
app.route('/api/quotes', quotes);
// «Төслийн хуваарь» — төсөл бүрийг нэг мөрөөр огнооны тэнхлэг дээр харуулах
// portfolio Gantt + эрсдэлийн эрэмбэ (admin + senior, routes/timeline.ts).
app.route('/api/ticker', ticker);
app.route('/api/timeline', timeline);
// «Хугацаа» — төслийн эцсийн хугацаа / блокийн муж / таскийн огноо /
// дэд шалгах цэгүүдийг НЭГ эрэмбэлсэн жагсаалт болгоно (routes/deadlines.ts).
// ⚠️ Timeline-аас ялгаатай нь энд module-level дүрийн guard БАЙХГҮЙ:
// инженер, архитектор өөрийн ажлын хугацааг харах ёстой.  Бичих эрх нь
// route бүрийн дотор (admin/senior ЭСВЭЛ эцэг таскийн эзэн).
app.route('/api/deadlines', deadlines);
// Төслийн дуусах хугацааны СУНГАЛТ + түүх (migration 0337) — `/api/deadlines`-ийн
// ХОЁР ДАХЬ mount; замууд `/project/:id/extensions…` тул дээрхтэй мөргөлдөхгүй.
app.route('/api/deadlines', projectDeadline);
// ЗӨВХӨН ЛОКАЛ D1 rows_read хэмжигч (routes/devD1Probe.ts) — prod дээр 404:
// `D1_TELEMETRY_VERBOSE=1` + loopback host + admin гурвуулаа шаардана.
app.route('/api/dev/d1-probe', devD1Probe);
// R2 хадгалалтын аудит + эзэнгүй объектын цэвэрлэгээ (`/audit`, `/purge`, 2026-09-13) ба
// зөвхөн-уншдаг инвентор (`/inventory` — scripts/cleanup/fetch-r2-inventory.mjs), бүгд admin.
// ⚠️ `lib/workerScope.ts` / `lib/clientScope.ts`-ийн цагаан жагсаалтад НЭМЭХГҮЙ.
app.route('/api/storage', storageAudit);

// Speechmatics batch-job completion webhook — worker-root, outside /api/* so
// `authMiddleware` is skipped; it authenticates via the shared
// `x-mgl-speechmatics-secret` header (see routes/speechmatics.ts).
app.route('/speechmatics', speechmatics);

// Private meeting-audio streaming — worker-root, authed by a short-lived signed
// `?t=<jwt>` token (see routes/meetingAudio.ts).  Serves both Speechmatics'
// fetch_data and in-app playback; the audio is NOT on the public /media mount.
app.route('/meeting-audio', meetingAudio);

app.get('/', (c) => c.text(`${orgConfig().appName} API`));

// OAuth `/authorize` consent + login UI for the remote MCP server.  Mounted at
// the ROOT (outside `/api/*`) so `authMiddleware` skips it; it authenticates the
// user itself, reusing the `/api/auth/login` check, and mints the OAuth grant
// via `env.OAUTH_PROVIDER.completeAuthorization`.  See src/oauth/authorize.ts.
app.route('/', authorizeRoutes);

// Remote MCP transports.  The OAuthProvider validates the OAuth access token
// (or, via `resolveExternalToken`, a legacy mcp-token JWT), decrypts the grant
// props, and injects them as `ctx.props` BEFORE invoking these handlers — the
// exact slot the old bearer guard filled by hand.  See src/mcp/MglMcpAgent.ts.
const mcpStreamable = MglMcpAgent.serve('/mcp'); // Streamable HTTP
const mcpSse = MglMcpAgent.serveSSE('/sse'); // legacy SSE

/** `MglMcpAgent.serve()` / `.serveSSE()`-ийн буцаадаг хэлбэр. */
type McpTransportHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};

/**
 * L1 — MCP ХААЛТ.  Provider нь токеныг шалгаж `ctx.props`-ыг тавьсны ДАРАА,
 * харин DO руу орохоос ӨМНӨ ажиллана (`oauth-provider.js:2054`).  Энэ бол
 * OAuth grant (`decryptProps`, :2025) ба legacy JWT (`resolveExternalToken`,
 * :2046) ХОЁУЛАН нийлдэг цорын ганц цэг — тиймээс шалгалт ЭНД сууна,
 * `resolveExternalToken` дотор БИШ (тэр нь хоёрын зөвхөн нэгийг барина).
 *
 * ⚠️ Энэ функц нь гадаад fetch-ийн `runWithTenant`-ийн ДОТОР ажилладаг тул
 *    `hasTenantContext()` энд ЗӨВ утга өгнө.  Гадаад `fetch` дотор биш!
 */
function guardMcp(inner: McpTransportHandler): McpTransportHandler {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const verdict = checkMcpAccess(ctx.props, hasTenantContext() ? currentTenantId() : null);
      if (!verdict.ok) {
        console.warn(`[mcp-guard] ${verdict.code} ${new URL(request.url).pathname}`);
        return new Response(JSON.stringify({ error: verdict.message, code: verdict.code }), {
          status: verdict.status,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      // OAuth grant (`decryptProps`) нь `iat` агуулдаггүй тул идэвхгүй болгосон
      // хүний grant-ыг энд DB-ээр хаана.  Legacy JWT-ийг `resolveExternalToken`
      // аль хэдийн шалгана; энэ мөр нь хоёр эх үүсвэрийг нэгтгэнэ.
      const nowSec = Math.floor(Date.now() / 1000);
      const validity = await checkTokenValidity(env.DB, {
        sub: verdict.sub,
        role: verdict.role,
        iat: nowSec,
        exp: nowSec + 3600,
      });
      if (!validity.ok) {
        console.warn(`[mcp-guard] token_revoked sub=${verdict.sub} reason=${validity.reason}`);
        return new Response(
          JSON.stringify({ error: 'Нэвтрэлт хүчингүй боллоо', code: 'mcp_token_revoked' }),
          { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' } },
        );
      }
      const clientIp = getClientIpFromRequest(request);
      const officeVerdict = await assertOfficeAccess({
        env,
        requestUrl: request.url,
        clientIp,
        db: env.DB,
        user: { sub: verdict.sub, role: verdict.role },
      });
      if (!officeVerdict.ok) {
        console.warn(`[mcp-guard] ${officeVerdict.code} ${new URL(request.url).pathname}`);
        return new Response(JSON.stringify(officeAccessJson(officeVerdict)), {
          status: officeVerdict.status,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        });
      }
      const started = Date.now();
      const res = await inner.fetch(request, env, ctx);
      if (!hasTenantContext()) {
        recordLive(env, ctx, {
          t: Date.now(),
          k: 'mcp',
          m: request.method,
          p: new URL(request.url).pathname,
          s: res.status,
          ms: Date.now() - started,
          q: 0,
          r: 0,
          w: 0,
          u: verdict.sub,
          role: verdict.role,
          c: liveColo(request),
          ch: null,
        });
      }
      return res;
    },
  };
}

/**
 * ⚠️ Хаалт ба маршрут САЛЖ БОЛОХГҮЙ — түлхүүрүүд нь `mcp/guard.ts`-ийн
 * `MCP_ROUTES`-д амьдардаг.  `satisfies` нь ХОЁР чиглэлийг барина:
 * `MCP_ROUTES`-д зам нэмээд ЭНД нэмэхгүй бол «дутуу түлхүүр», эсрэгээр
 * энд илүү түлхүүр байвал «илүүдэл шинж» гэж `tsc` унана.
 *
 * ⚠️ ТӨРЛИЙГ `Record<string, …>` БОЛГОЖ БҮҮ ЗАСАХ — index signature нь
 *    дутуу түлхүүрийг ЧИМЭЭГҮЙ зөвшөөрч, доорх хамралтын шалгалтыг
 *    утгагүй болгоно (бодитоор хэмжсэн).
 */
const MCP_API_HANDLERS = {
  '/mcp': guardMcp(mcpStreamable),
  '/sse': guardMcp(mcpSse),
} satisfies Record<(typeof MCP_ROUTES)[number], McpTransportHandler>;

// DRIFT-ХАМГААЛАЛТ: `MCP_ROUTES`-ийн БҮХ түлхүүр `MCP_API_HANDLERS`-д байх
// ЁСТОЙ — байхгүй бол `tsc` унана.  Шинэ transport нэмэх бүрд хоёулан дээр.
const _mcpRouteCoverage: Record<(typeof MCP_ROUTES)[number], McpTransportHandler> =
  MCP_API_HANDLERS;
void _mcpRouteCoverage;

// Wrap the whole Worker in the OAuth provider.  It implements `/token`,
// `/register` (DCR — claude.ai needs it) and the `/.well-known/oauth-*`
// discovery docs; advertises `/authorize` (implemented by `app` above);
// protects `/mcp` + `/sse` with OAuth; and hands everything else to the Hono
// `app` (all `/api/*`, `/media/*`, `/`).
const oauthProvider = new OAuthProvider<Env>({
  apiHandlers: MCP_API_HANDLERS,
  defaultHandler: {
    // Хүсэлт бүрд `env`-ийн ГҮЕХЭН хуулбар + телеметртэй `DB` (lib/d1Telemetry.ts).
    // `env` нь isolate-д нэг объект тул шууд солих нь зэрэгцээ хүсэлтүүдийн
    // тоолуурыг холино; хуулбар нь `tenantEnv`-ийн хийдэгтэй ижил хэлбэр.
    fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
      app.fetch(request, { ...env, DB: instrumentD1(env.DB) }, ctx),
  } as ExportedHandler<Env>,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: ['mcp'],
  accessTokenTTL: 3600,
  allowPlainPKCE: false,
  // Federate the legacy long-lived mcp-token JWT (routes/auth.ts) so a pasted
  // bearer still works.  Called ONLY when the presented bearer isn't an OAuth
  // token in OAUTH_KV.  Same {sub, role} props → same `this.props` as OAuth.
  //
  // ⚠️ TODO(tenant) — T5, ЭНЭ АЖЛЫН ХАМРАХ ХҮРЭЭНД БИШ (1A-4 §3 алхам 6).
  //    Энэ функц `tid`-г ШАЛГАДАГГҮЙ ба ЗОРИУД: хоёр эх үүсвэр нийлдэг цэг нь
  //    `guardMcp` (`checkMcpAccess(ctx.props, …)`) — tenant тулгалт ТЭНД сууна.
  //    ГЭВЧ `MglMcpAgent` нь `this.env` (DO-ийн deploy-үеийн env) уншдаг тул
  //    tid зөв байлаа ч ӨӨР компанийн DB руу очно — тиймээс олон-tenant үед
  //    /mcp нь дээрх L0 хаалтаар БҮХЭЛДЭЭ 503.  Тэр хаалтыг АРИЛГАХААС ӨМНӨ:
  //    (a) DO-д tenant-ийн binding хүргэх зам гаргах, (b) props-ын `tid`-г DO
  //    сэрэх зам дээр ч мөрдүүлэх.  `purpose` шалгалт ЭНД НЭМЭХГҮЙ (1A-3).
  resolveExternalToken: async ({ token, env }) => {
    const payload = await verifyToken(token, env.JWT_SECRET);
    if (!payload) return null;
    // ─── ТОКЕНЫ ЦУЦЛАЛТ (1A-3) ───────────────────────────────────────
    // `middleware/auth.ts`-тай ЯГ ижил шалгалт.  `authMiddleware` нь ЗӨВХӨН
    // /api дээр суудаг тул үүнийг энд ДАВХАР хийхгүй бол идэвхгүй болгосон
    // хүний токен /mcp ба /sse рүү нэвтэрсээр байх бөгөөд «цуцаллаа» гэсэн
    // баталгаа ХУДАЛ болно.  ХОЁУЛАА НЭГ deploy дотор.
    //
    // ⚠️ Энэ нь ЗӨВХӨН legacy bearer JWT-ийн замыг хаана.  `/authorize`-аар
    //    олгогдсон OAuth grant нь `decryptProps` салаагаар явдаг, `iat` ч
    //    агуулдаггүй тул `tokens_valid_from` түүнд хамаарахгүй (ТУСДАА ажил).
    const validity = await checkTokenValidity(env.DB, payload);
    if (!validity.ok) return null;
    // Төхөөрөмжид уяатай Revit токенууд (migration 0375) нь MCP-д зориулагдаагүй: 30 хоногийн renewal
    // credential /mcp-д БҮТЭН ТОКЕН болж (бүх tool, admin ч) хэрэглэгдэх ёсгүй, 30 минутын session-ийн
    // төхөөрөмж хаагдсан эсэхийг энд шалгадаггүй.  ('mcp' purpose ХЭЗЭЭ Ч татгалзагдахгүй: Revit
    // add-in-ий хуучин 365 хоногийн токенууд — доорх 1A-3-ын тэмдэглэл.)
    if (payload.purpose === 'revit' || payload.purpose === 'revit-refresh') return null;
    // ⚠️ ЭНД role/tenant ШАЛГАЛТ ХИЙХГҮЙ — энэ салаа нь legacy JWT-д Л
    //    ажилладаг (`oauth-provider.js:2027`).  OAuth access token нь
    //    `decryptProps` салаагаар (:2025) явдаг тул тэнд тавьсан шалгалт
    //    хоёр эх үүсвэрийн зөвхөн нэгийг барина.  Жинхэнэ хаалт нь
    //    `guardMcp` — `ctx.props` дээр, :2054-ийн ӨМНӨ.  Мөн `purpose`
    //    шалгалт ЭНД НЭМЭХГҮЙ (1A-3-т харьяална): Revit add-in-ийн
    //    365 хоногийн токенууд тэр дороо унана.
    return {
      props: {
        sub: payload.sub,
        role: payload.role,
        ...(payload.tid ? { tid: payload.tid } : {}),
      } satisfies McpProps,
    };
  },
});

/**
 * НЭГ КОМПАНИЙН cron ажил.
 *
 * ⚠️ `env` нь ТЭР компанийн binding-үүдтэй байх ЁСТОЙ (`tenantEnv`-ийн
 *    гаралт), мөн дуудлага нь `runWithTenant`-ийн ДОТОР байх ЁСТОЙ —
 *    `loadOrgConfig` нь `currentTenantId()`-ээр slot сонгодог.
 *
 * ⚠️ ИРЭЭДҮЙД: cron дотроос кэш хүчингүй болгох ажил нэмэгдвэл тэр нь ЗААВАЛ
 *    `runWithTenant`-ийн дотор байх ёстой.  `lib/edgeCache.ts`-ийн `cacheHost()`
 *    нь `currentTenantId()`-ээс түлхүүрлэдэг тул контекстгүй дуудвал ӨӨР
 *    нэрийн зайд хүрч, тухайн компанийн бичлэгийг бүтэн TTL-ийн турш чимээгүй
 *    алдана.  (`bustEdgeCache` нь `AppContext` шаарддаг тул өнөөдөр cron-оос
 *    дуудагдах боломжгүй — энэ бол ирээдүйн анхааруулга.)
 *
 * ⚠️ ХЭМЖЭЭ: компани бүр 6 хүртэл `waitUntil` promise нэмнэ.  N компанитай
 *    үед нэг cron дуудлагад N×6 ажил, `scheduled` нь CPU/wall хязгаартай.
 *    N > 5 болмогц cron-ыг Queue болгох, эсвэл компаниудыг цагаар нь тараах
 *    тусдаа ажил үүснэ.  ШИНЭ cron илэрхийлэл нэмж ШИЙДЭХГҮЙ — гуравдахь
 *    илэрхийлэл нь доорх fail-safe салааг давхар ажиллуулна.
 */
async function runScheduledFor(
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  // Cron нь Hono-гийн middleware гинжийг тойрдог тул байгууллагын тохиргоог
  // ЭНД тусад нь ачаална.  `runDeadlineSweep` нь `todayInUB()`-ээр өдрөө
  // тодорхойлдог бөгөөд тэр нь одоо тохируулсан цагийн бүсээс хамаарна —
  // ачаалахгүй бол cron дефолт бүсээр (Asia/Ulaanbaatar) ажиллана.
  await loadOrgConfig(env);

  // Cron ажил бүр өөрийн D1 тоолууртай (lib/d1Telemetry.ts) — босго давбал
  // `[d1] cron:<нэр>` мөр логдоно, эс бөгөөс чимээгүй.
  const job = async <T>(name: string, fn: (e: Env) => Promise<T>): Promise<T> => {
    const started = Date.now();
    const stats = { q: 0, r: 0, w: 0 };
    let ok = false;
    try {
      const out = await withD1Telemetry(`cron:${name}`, env, (scoped) => {
        // Хэмжилтийг амьд урсгалд дамжуулахын тулд scoped DB-ийн статистикийг уншина.
        const result = fn(scoped);
        return result.finally(() => {
          const d1 = d1StatsOf(scoped.DB);
          if (d1) Object.assign(stats, { q: d1.queries, r: d1.rowsRead, w: d1.rowsWritten });
        });
      });
      ok = true;
      return out;
    } finally {
      if (!hasTenantContext()) {
        recordLive(env, ctx, {
          t: Date.now(),
          k: 'cron',
          m: 'CRON',
          p: name,
          s: ok ? 200 : 500,
          ms: Date.now() - started,
          ...stats,
          u: null,
          role: null,
          c: null,
          ch: null,
        } satisfies LiveEvent);
      }
    }
  };

  if (event.cron === '* * * * *') {
    // Шинэ мэдэгдлүүдийг браузерын push болгон илгээнэ (lib/pushSweep.ts).
    ctx.waitUntil(job('pushSweep', sweepPushNotifications));
    return;
  }
  // FAIL-SAFE: бүх бусад (мөн танихгүй / хуучирсан) cron илэрхийлэл энэ
  // салаагаар орно.  wrangler.toml-ийн cron-ыг өөрчилсөн хэрнээ энэ файлыг
  // мартвал «Gmail-ийн sync үргэлжилнэ» болж доройтоно — «юу ч ажиллахгүй»
  // болохгүй.
  ctx.waitUntil(job('emailSync', syncAllMailboxes));
  // Backstop for any Speechmatics webhook we missed: finalise stuck
  // 'transcribing' meetings (see lib/meetingTranscription.ts).
  ctx.waitUntil(job('reconcileMeetings', reconcileMeetings));
  // Мөн адил Зохиогчийн хяналтын талбайн дуу бичлэгүүдэд (lib/asrTranscription.ts).
  // ШИНЭ cron илэрхийлэл нэмээгүй — доорх runDeadlineSweep-ийн тайлбар яагаад
  // гэдгийг тайлбарласан.
  ctx.waitUntil(job('reconcileAsr', reconcileAsrRecordings));
  // Two-way sync the dashboard calendar with the company Google Calendar
  // (no-op unless GOOGLE_SA_JSON + GOOGLE_CALENDAR_ID are set).
  ctx.waitUntil(job('gcalSync', syncGoogleCalendar));
  // Таскийн хуваарилалтын commit-ийн ДАРАА биелээгүй үр дагавар (архив, snapshot, засварын цаг) — `task_ops.post_status =
  // 'pending'` мөрийг дахин ажиллуулна.  ШИНЭ cron илэрхийлэлгүй (lib/taskPostCommit.ts).
  ctx.waitUntil(job('taskPostCommit', (e) => sweepPendingPostCommit(e)));
  // Жин/төвөгшил засварын дараа унасан managed онооны тулгалт (migration 0402, lib/taskCreditReconcileQueue.ts).
  ctx.waitUntil(job('creditReconcile', (e) => sweepCreditReconcileQueue(e)));
  // Төслийн хугацааны сануулга («Төслийн хуваарь»).  ШИНЭ cron илэрхийлэл
  // ЗОРИУДААР нэмээгүй: wrangler.toml-д таарахгүй илэрхийлэл нэмбэл яг энэ
  // fail-safe салаагаар орж Gmail-ийн sync гурвалыг тэр хуваариар давхар
  // ажиллуулна.  Оронд нь sweep өөрөө цагаа хаадаг — УБ-ийн 09:00-аас өмнө
  // болон өдөрт хоёр дахь удаагаа ажиллахгүй (lib/deadlineSweep.ts).  Энэ нь
  // pushSweep-ийн prune UTC минут == 17 дээр өөрийгөө хаадагтай ижил хэв маяг.
  ctx.waitUntil(job('deadlineSweep', runDeadlineSweep));
  // Ажилтны өдрийн snapshot («Тайлан» хуудас, lib/employeeSnapshot.ts).  ШИНЭ
  // cron илэрхийлэл нэмээгүй — дээрх runDeadlineSweep-ийн тайлбартай ижил
  // шалтгаан.  Ажил өөрөө УБ 02:00-аас өмнө болон өдөрт хоёр дахь удаагаа
  // ажиллахгүй (app_settings.employee_snapshot_last_date цоож).
  ctx.waitUntil(job('employeeSnapshot', runEmployeeSnapshot));
  // Google Docs/Sheets дээр засаж байгаа баримтыг архив руу буцааж татна.
  // ШИНЭ cron илэрхийлэл нэмээгүй — дээрх runDeadlineSweep-ийн тайлбартай
  // ижил шалтгаан.  Sweep өөрөө «5 минут чимээгүй болсны дараа» гэсэн
  // нөхцөлөөр өөрийгөө хаадаг (lib/documentGoogle.ts).
  ctx.waitUntil(job('gdocSweep', sweepGoogleDocSync));
  // Төслийн Drive хавтсыг СОНСОНО (Changes API): хадгалагдсан файл бүрийн
  // хуулбарыг R2-д, «хэн/хэзээ/юу» ledger-т (lib/projectDriveSync.ts, миграц
  // 0300).  ШИНЭ cron илэрхийлэл нэмээгүй — ижил шалтгаан; холбогдсон хавтас
  // байхгүй бол Drive рүү огт очихгүй, app_settings цоожоор давхардахгүй.
  ctx.waitUntil(job('driveVersions', syncProjectDriveChanges));
  // Хуучин ZA хувийн бөглөлтийг ЦАГ болгож нөхнө (миграц 0348,
  // lib/repairDayStore.ts).  ШИНЭ cron илэрхийлэл нэмээгүй — ижил шалтгаан.
  // Дууссан бол `app_settings`-ийн ганц уншилт; дуусаагүй бол нэг удаад цөөн
  // ажилтан-өдөр (энэ дуудлагын бусад ажилтай D1-ийн ≤1000 асуулгыг хуваалцана).
  ctx.waitUntil(job('repairHoursBackfill', runRepairHoursBackfillCron));
  // Мартагдсан албан таскийн таймерыг эхэлсэн өдрийнх нь 23:59-д зогсооно (эзэн
  // 2026-10-01 — таск дээрх нэр = таймер нь явж буй хүн).  ШИНЭ cron илэрхийлэл
  // нэмээгүй — ажил байхгүй үед `ended_at IS NULL` мөрийн ганц уншилт.
  ctx.waitUntil(job('taskTimerDayEnd', runTaskTimerDayEndSweep));
  // Програмын хүсэлтийн хаягдсан / хугацаа дууссан хавсралтын байтыг ХУВИЙН FEEDBACK_BUCKET-ээс устгана (ready, илгээсэн
  // хүсэлтийнхийг хэзээ ч биш).  ШИНЭ cron илэрхийлэлгүй; binding байхгүй бол юу ч хийхгүй.
  ctx.waitUntil(job('engineeringFeedbackSweep', sweepEngineeringFeedback));
}

// Default export keeps the cron `scheduled` handler alongside the provider's
// `fetch` (OAuthProvider implements only `fetch`).  Two cron expressions are
// registered in the `[triggers] crons` block of wrangler.toml and we branch on
// `event.cron` to keep them independent:
//
//   "* * * * *"    → push sweep only.  Must run every minute so a notification
//                    banner arrives while it's still relevant.  It is cheap
//                    (one indexed `pushed = 0` lookup) and must NOT drag the
//                    much slower Gmail/meeting/calendar syncs along with it.
//   "*/2 * * * *"  → the pre-existing Gmail + meeting + calendar syncs.
export default {
  /**
   * ОЛОН-TENANT ОРОЛТ.
   *
   * `TENANTS` var тохируулаагүй бол (MGL-ийн одоогийн суулгац) энэ нь
   * өмнөхтэй ЯГ ИЖИЛ — шууд провайдер руу дамжина, нэмэлт ажил тэг.
   *
   * Тохируулсан бол: хүсэлтийн host (эсвэл `X-Tenant` толгой) -оос компанийг
   * олж, `env.DB` / `MEDIA_BUCKET` / `MEETING_BUCKET`-ыг ТЭР компанийнхаар
   * сольж, `AsyncLocalStorage` контекст дотор ажиллуулна.  Контекст нь
   * `orgConfig()` болон `middleware/auth.ts`-ийн tenant шалгалтыг тэжээнэ.
   */
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    const tenants = parseTenants(env.TENANTS);
    if (!tenants) return oauthProvider.fetch(request, env, ctx);

    const url = new URL(request.url);

    // ── L0 FAIL-CLOSED: олон-tenant үед /mcp, /sse ХААЛТТАЙ ─────────────
    // `MCP_OBJECT` нь `TenantSpec`-д БАЙХГҮЙ (lib/tenants.ts) ба `tenantEnv`
    // нь зөвхөн DB / MEDIA_BUCKET / MEETING_BUCKET-ыг сольдог.  Durable
    // Object нь дуудагчийн засварласан env-ийг БИШ, Worker script-ийнхээ
    // ӨӨРИЙН env-ийг авдаг тул DO доторх `this.env.DB` нь ямар ч tenant-д
    // ҮНДСЭН баазыг заана.  Мөн `runWithTenant`-ийн AsyncLocalStorage нь
    // DO-ийн хил давдаггүй.  Тиймээс олон-tenant үед /mcp нь ЗӨВ tid-тэй
    // байлаа ч ӨӨР компанийн өгөгдөл унших болно → бүхэлд нь 503.
    //
    // ⚠️ Түлхүүр нь `tenants !== null`, `hasTenantContext()` БИШ: энэ код
    //    `runWithTenant`-ийн ГАДНА ажилладаг тул тэр функц ЭНД үргэлж
    //    худал буцаана (чимээгүй fail-open болно).
    //
    // Энэ хаалтыг арилгах нь `1A-4 tenant preflight`-ийн ажил.
    if (isMcpPath(url.pathname)) {
      return new Response(
        JSON.stringify({
          error: 'MCP олон-tenant горимд түр хаалттай',
          code: 'mcp_multitenant_unsupported',
        }),
        { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } },
      );
    }

    const hit = resolveTenant(tenants, {
      host: url.hostname,
      header: request.headers.get(TENANT_HEADER),
    });

    if (!hit) {
      // Танихгүй host/tenant — ЯМАР Ч өгөгдөл рүү хандуулахгүй.  Ямар нэг
      // компани руу «дефолтоор» унагаах нь хамгийн аюултай зан төлөв байх
      // тул зориудаар хийхгүй.
      return new Response(JSON.stringify({ error: 'unknown_tenant', host: url.hostname }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    const scoped = tenantEnv(env, hit.tenant);
    if (!scoped) {
      // Тохиргоонд байгаа binding нь wrangler.toml-д алга — deploy буруу.
      // 500 биш 503: энэ бол түр зуурын тохиргооны алдаа, кодын алдаа биш.
      console.error(
        `[tenant] ${hit.tenant.id}: binding олдсонгүй (db=${hit.tenant.db})`,
      );
      return new Response(JSON.stringify({ error: 'tenant_misconfigured' }), {
        status: 503,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }

    return runWithTenant(hit.tenant.id, () => oauthProvider.fetch(request, scoped, ctx));
  },
  /**
   * CRON — КОМПАНИ БҮРЭЭР.
   *
   * `TENANTS` тохируулаагүй бол (MGL-ийн одоогийн суулгац) `runScheduledFor`-ыг
   * ЯГ НЭГ удаа, контекстгүй, суурь `env`-ээр дуудна — өмнөх кодтой байт-ижил.
   *
   * Тохируулсан бол компани бүрийн binding-ээр давтана.  Үүнгүйгээр шинэ
   * компанид Gmail sync, хурал/ЗХ-ын бичлэг finalize, Google Calendar sync,
   * хугацааны сануулга, push мэдэгдэл — БҮГД чимээгүй хийгдэхгүй байна
   * (ямар ч алдаа гарахгүй тул илрэхгүй).
   */
  scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    const tenants = parseTenants(env.TENANTS);
    // ЭРТ ГАРАХ — MGL-ийн production ямар ч шинэ код зам руу орохгүй.
    if (!tenants) return runScheduledFor(event, env, ctx);

    for (const t of tenants) {
      const scoped = tenantEnv(env, t);
      if (!scoped) {
        // Нэг компанийн тохиргоо буруу байх нь БУСДЫГ зогсоох ЁСГҮЙ —
        // cron бол backstop, бүтэн зогсох нь хамгийн муу үр дүн.
        console.error(`[tenant] cron: binding олдсонгүй (${t.id}, db=${t.db})`);
        continue;
      }
      // ⚠️ `runWithTenant`-ийн ДОТОР дуудна.  `ctx.waitUntil(fn(env))` доторх
      //    `fn()` нь SYNC дуудагддаг тул түүний async гинж `AsyncLocalStorage`
      //    store-ыг ӨВЛӨНӨ — `runWithTenant` буцсаны дараа ч хэвээр.
      await runWithTenant(t.id, () => runScheduledFor(event, scoped, ctx));
    }
  },
} satisfies ExportedHandler<Env>;
// McpAgent Durable Object — bound as `MCP_OBJECT` in wrangler.toml.
export { MglMcpAgent } from './mcp/MglMcpAgent';
// Захиалагчийн порталын realtime өрөө (төсөл тус бүрд нэг instance).
// ⚠️ `wrangler.toml`-ийн `[[migrations]]` tag v6-д бүртгэлтэй — tag-уудыг
//    ХЭЗЭЭ Ч дарааллыг нь өөрчлөх / устгахгүй.
export { ClientRoom } from './client/ClientRoom';
// System Workbench-ийн амьд урсгалын өрөө (lib/liveTraffic.ts).  `wrangler.toml` tag v7.
export { WorkbenchLive } from './live/WorkbenchLive';
