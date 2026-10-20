/* =============================================================
 * Төслийн баримт бичиг — Google Drive нь ЭХ СУРВАЛЖ (2026-09-10)
 * -------------------------------------------------------------
 * `/api/projects` дээр mount хийгдсэн ТАВ ДАХЬ router (projects,
 * performanceReports, projectCharts, teamFormTemplates-ийн дараа).
 * Замууд нь `/api/projects/:id/drive/...` — `projects.ts`-ийн `/:id`
 * нь нэг сегменттэй тул мөргөлдөхгүй.
 *
 * Үзэх/холбох handler-ууд нь `mountDriveBrowse()` ҮЙЛДВЭРЭЭР бүртгэгддэг тул
 * `/api/main-projects/:id/drive/*` (routes/mainProjects.ts) ЯГ ижил кодыг
 * өөр үндэс-шийдэгчтэй ашиглана — үндсэн төсөл (0281) нь ангиллын төслүүдийн
 * баримт бичгийг НЭГ хавтсанд нэгтгэдэг.
 *
 *   GET  /drive/service-account            (admin)  хавтсыг хуваалцах SA хаяг
 *   PUT  /:id/drive-folder                 (admin)  холбох / салгах
 *   GET  /:id/drive                                 тохиргооны төлөв (Drive дуудахгүй)
 *   GET  /:id/drive/folders/:folderId               хавтасны агуулга (`root` = үндэс)
 *   GET  /:id/drive/files/:fileId                   файлын мета + харах төлөвлөгөө
 *   GET  /:id/drive/files/:fileId/content           байтуудыг УРСГАЛААР дамжуулна
 *   GET  /:id/drive/files/:fileId/thumbnail         эхний хуудасны зураг
 *
 *   Хувилбарын түүх (миграц 0300, lib/projectDriveSync.ts, 2026-09-15):
 *   GET  /:id/drive/activity                        үндэс хавтасны сүүлийн өөрчлөлтүүд
 *   GET  /:id/drive/files/:fileId/versions          нэг файлын хувилбарууд
 *   GET  /:id/drive/versions/:versionId/content     хувилбарын хуулбарыг татах (R2)
 *   POST /:id/drive/versions/:versionId/restore     тэр хувилбар руу Drive-ыг буцаах
 *   POST /:id/drive/baseline               (admin)  одоо байгаа файлуудын эхний хуулбар
 *   GET  /:id/drive/sharing                (admin)  «холбоостой хэн ч» эрхийн төлөв
 *   PUT  /:id/drive/sharing                (admin)  тэр эрхийг тавих / авах
 *
 *   Байршуулах (lib/projectDriveUpload.ts, 2026-09-17 — эзний шийдвэр: ажилтан
 *   Drive нээлгүй системээсээ файл/хавтас оруулна; захиалагч, мэйл хойшид):
 *   POST /:id/drive/folders/:folderId/folders       дэд хавтас үүсгэх (нэрээр давхардуулахгүй)
 *   POST /:id/drive/folders/:folderId/uploads       upload эхлүүлэх → гарын үсэгтэй токен
 *   PUT  /:id/drive/uploads?offset=N                нэг chunk (X-Upload-Token) → Drive руу урсгалаар
 *   DELETE /:id/drive/uploads                       хагас байршуулалтыг цуцлах
 *   PATCH /:id/drive/files/:fileId                  нэр солих (файл, хавтас — үндэс биш)
 *   POST  /:id/drive/files/:fileId/move             өөр хавтас руу зөөх ({ parent_id })
 *
 * ЭРХ (§9, §13) — endpoint бүрт дөрвөн шалгалт:
 *   1. нэвтэрсэн (authMiddleware — index.ts);
 *   2. төсөл байгаа (resolveRoot → 404);
 *   3. хэрэглэгч төсөлд хандах эрхтэй (`assertDriveAccess`):
 *        • БҮХ ажилтан (`admin|senior|engineer|architect`) — БҮХ төсөл
 *          (`DRIVE_ROLES`).  Эзний 2026-09-24-ний шийдвэр: «Баримт бичиг»
 *          хэсгийг хүн бүр харж, засаж (нэр солих, зөөх, хувилбар буцаах),
 *          файл/хавтас нэмж чадна — гэхдээ УСТГАЖ ЧАДАХГҮЙ: энэ router-т
 *          Drive файл устгах/хогийн сав руу хийх зам ЗОРИУД байхгүй
 *          (`DELETE …/drive/uploads` нь зөвхөн дуусаагүй байршуулалтыг
 *          цуцална).  Устгах endpoint НЭМЭХГҮЙ.  «Солих» байршуулалт нь
 *          Drive-д шинэ хувилбар үүсгэх тул хуучин агуулга хувилбарын
 *          түүхэд үлдэнэ.  (2026-09-15 – 09-24 хооронд зөвхөн admin + senior
 *          байсан.)  Frontend-ийн sidebar (`Layout.tsx` NAV_ITEMS) + төслийн
 *          таб (`ProjectTabs.tsx`) ижил дүрэмтэй — хамт өөрчлөгдөнө.
 *          Тохиргоо (хавтас холбох, хуваалцах, baseline) admin хэвээр;
 *          захиалагчийн самбар admin + senior (`DRIVE_MANAGER_ROLES`).
 *        • `client` — ЭНД ХААЛТТАЙ (`lib/clientScope.ts` ч `/api/projects`-ийг
 *          нээдэг ч `DRIVE_ROLES` 403).  Захиалагчийн порталын эзний шийдвэр
 *          (2026-09-07): татах хүрээ = тайлан + ГАРГАСАН зургийн багц +
 *          батлагдсан ASR — компанийн ажлын хавтас БИШ.  2026-09-18-наас
 *          захиалагч ЗӨВХӨН ажилтны тэмдэглэсэн хавтас/файлыг тусдаа замаар
 *          харна: `/api/client/projects/:id/drive/*` (routes/clientDrive.ts,
 *          `client_drive_shares`, миграц 0327) — түүхий хавтас хэвээр хаалттай.
 *        • `worker` — `lib/workerScope.ts` угтвараар аль хэдийн 403.
 *   4. хүссэн Drive зүйл нь ТЭР төслийн хавтасны дотор (`resolveAncestry`)
 *      — URL-ын `fileId`-г солиод өөр төслийн (эсвэл огт хуваалцаагүй)
 *      файл руу орж чадахгүй.  Front-end-ээс ирсэн id-д ХЭЗЭЭ Ч итгэхгүй.
 *
 * Үзэх зам дээр файлын байт манай серверт буудаггүй — `content` нь Drive-ын
 * хариуг урсгалаар нэвтрүүлж өгдөг (§7).  ХУВИЛБАРЫН хуулбар нь тусдаа:
 * cron сонсогч (`lib/projectDriveSync.ts`) хадгалагдсан файл бүрийг хувийн
 * R2 (`MEETING_BUCKET`, `drive-versions/`) руу хийж, `versions/:id/content`
 * тэндээс уншина.  Drive-ын нууц (SA түлхүүр) хөтөч рүү очих ямар ч зам
 * байхгүй: токен зөвхөн `driveBrowse.ts` дотор Authorization толгойд явна (§3).
 * ============================================================= */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import {
  DRIVE_EXPORT_MAX_BYTES,
  DriveBrowseError,
  FOLDER_MIME,
  GOOGLE_APPS_PREFIX,
  SHORTCUT_MIME,
  driveBrowseConfigured,
  driveBrowseDownload,
  driveBrowseExport,
  driveBrowseGet,
  driveBrowseServiceEmail,
  driveBrowseThumbnail,
  driveCreateFolder,
  driveFindChildByName,
  driveMove,
  driveRename,
  driveResumableCancel,
  driveResumablePut,
  driveResumableStart,
  driveServiceClientId,
  driveWriteIdentity,
  type DriveEntry,
} from '../lib/google/driveBrowse';
import {
  DOCX_MIME,
  UPLOAD_CHUNK_BYTES,
  UPLOAD_MAX_BYTES,
  UPLOAD_TOKEN_TTL_MS,
  checkChunk,
  isRevisableDocx,
  normalizeUploadMime,
  parseConflict,
  parseRevisionRequest,
  sanitizeUploadName,
  signUploadTicket,
  verifyUploadTicket,
  type UploadTicket,
} from '../lib/projectDriveUpload';
import {
  loadProjectDriveRoot,
  parseDriveFolderInput,
  previewPlan,
  toProjectDriveItem,
  type ProjectDriveRoot,
} from '../lib/projectDrive';
import {
  invalidateDriveListing,
  listProjectFolder,
  rememberDriveEntry,
  resolveAncestry,
} from '../lib/projectDriveAccess';
import {
  DriveRestoreError,
  enqueueBaseline,
  loadVersion,
  recordUpload,
  restoreVersion,
} from '../lib/projectDriveSync';
import { snapshotFileName, versionView, type DriveVersionRow } from '../lib/projectDriveVersions';
import { ignoreDiscoveredFolder, unignoreDiscoveredFolder } from '../lib/projectDriveDiscovery';
import { driveGetAnyonePermission, driveSetAnyonePermission, type DriveAnyoneRole } from '../lib/google/driveBrowse';
import { mountDriveSigning } from './driveSigning';
import { makeDriveSignIo } from '../lib/driveSigningIo';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;
type App = Hono<{ Bindings: Env; Variables: AppVariables }>;

/* ------------------------------------------------------------------ */
/*  Алдааны нэгдсэн хариу                                              */
/* ------------------------------------------------------------------ */

/** Хэрэглэгчид харагдах мессеж — техникийн шалтгаан нь ЗӨВХӨН логт (§10).
 *  Front-end нь `code`-оор өөрийн орчуулгыг сонгодог; `error` нь ямар ч
 *  UI-гүй дуудагчид (curl, MCP) уншигдахуйц байх зориулалттай. */
const USER_MESSAGE: Record<DriveBrowseError['code'], string> = {
  NOT_CONFIGURED: 'Google Drive холболт байршуулалтад тохируулагдаагүй байна.',
  AUTH_CONFIG: 'Google Drive-ын нэвтрэлтийн тохиргоо буруу байна — админд хандана уу.',
  NOT_FOUND: 'Хавтас эсвэл файл Drive дээр олдсонгүй (устгагдсан эсвэл хуваалцаагүй).',
  PERMISSION_DENIED: 'Google Drive энэ зүйлийг унших эрх олгосонгүй.',
  RATE_LIMITED: 'Google Drive хэт олон хүсэлт авч байна — түр хүлээгээд дахин оролдоно уу.',
  EXPORT_TOO_LARGE: 'Файл урьдчилан харахад хэт том байна — Google дээр нээнэ үү.',
  UNAVAILABLE: 'Google Drive-тай холбогдож чадсангүй — дахин оролдоно уу.',
  SA_NO_QUOTA:
    'Google энэ хавтсанд файл үүсгэхийг зөвшөөрсөнгүй: хавтасны эзэн байгууллагын (Workspace) акаунт биш байна. Хавтсыг байгууллагын акаунт руу шилжүүлэх эсвэл Хамтын диск (Shared drive) рүү зөөнө үү.',
  DELEGATION_REQUIRED:
    'Google Admin Console дээр service account-д хавтасны эзний нэрээр бичих эрх (domain-wide delegation) олгогдоогүй байна — админд хандана уу.',
};

const HTTP_STATUS: Record<DriveBrowseError['code'], 404 | 403 | 413 | 429 | 502 | 503> = {
  NOT_CONFIGURED: 503,
  AUTH_CONFIG: 503,
  NOT_FOUND: 404,
  PERMISSION_DENIED: 403,
  RATE_LIMITED: 429,
  EXPORT_TOO_LARGE: 413,
  UNAVAILABLE: 502,
  SA_NO_QUOTA: 503,
  DELEGATION_REQUIRED: 503,
};

export function driveErrorResponse(c: AppContext, err: unknown, where: string): Response {
  if (err instanceof DriveBrowseError) {
    // Түүхий Google-ийн текст логт л үлдэнэ — токен/нууц АГУУЛДАГГҮЙ
    // (`driveBrowse.ts` нь хариуны биетээс зөвхөн статус + reason + мессеж авдаг).
    console.error(`[project-drive] ${where}: ${err.code} status=${err.status} reason=${err.reason} — ${err.message}`);
    if (err.code === 'DELEGATION_REQUIRED') {
      // Админд яг хийх алхам: SA client ID + scope — хоёулаа нууц биш.
      const clientId = driveServiceClientId(c.env);
      const subject = /subject (\S+):/.exec(err.message)?.[1] ?? null;
      return c.json(
        {
          error: `${USER_MESSAGE.DELEGATION_REQUIRED} Admin Console → Security → API controls → Domain-wide delegation → Add new: Client ID ${clientId ?? '(GOOGLE_SA_JSON client_id)'}, scope https://www.googleapis.com/auth/drive. Хавтасны эзэн: ${subject ?? '?'}.`,
          code: err.code,
          delegation: { client_id: clientId, scope: 'https://www.googleapis.com/auth/drive', subject },
        },
        HTTP_STATUS[err.code],
      );
    }
    return c.json({ error: USER_MESSAGE[err.code], code: err.code }, HTTP_STATUS[err.code]);
  }
  console.error(`[project-drive] ${where}: unexpected`, err);
  return c.json({ error: USER_MESSAGE.UNAVAILABLE, code: 'UNAVAILABLE' }, 502);
}

/* ------------------------------------------------------------------ */
/*  Эрхийн хаалт                                                       */
/* ------------------------------------------------------------------ */

/** «Баримт бичиг» (Drive) хэсгийг харах + засах + нэмэх эрх — эзний
 *  2026-09-24-ний шийдвэр: бүх ажилтан (устгах зам байхгүй).  `client` нь
 *  `routes/clientDrive.ts`-ээр, `worker` нь `workerScope`-оор хаалттай.
 *  Frontend-ийн `Layout.tsx` NAV_ITEMS ба `ProjectTabs.tsx` ижил олонлогийг
 *  хатуу бичдэг — хамт өөрчлөгдөнө. */
export const DRIVE_ROLES = new Set(['admin', 'senior', 'engineer', 'architect']);

/** Захиалагчид юу харагдахыг урьдчилан харах (`routes/clientDrive.ts`) —
 *  `/api/client-admin` (`requireManager`)-тэй ижил олонлог. */
export const DRIVE_MANAGER_ROLES = new Set(['admin', 'senior']);

type AccessResult =
  | { ok: true; root: ProjectDriveRoot }
  | { ok: false; status: 403 | 404; error: string; code: string };

/** JSON хариуг CDN/хөтөч кэшлэхгүй — эрхээр ялгаатай, Drive-ын шинэ төлөв
 *  бүр хүсэлт бүрт ирэх ёстой (§8). */
export function noStore(c: AppContext): void {
  c.header('Cache-Control', 'private, no-store');
}

/** Кирилл нэртэй файл ч зөв татагдахын тулд RFC 5987 (clientFiles.ts-тэй ижил). */
function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Файлын байтыг Drive-аас УРСГАЛААР нэвтрүүлнэ — хадгалахгүй, хуулбарлахгүй.
 * Google формат (Docs/Sheets/Slides) → PDF экспорт; бусад → эх байт.
 * Ажилтны (`/api/projects/:id/drive`) ба захиалагчийн (`/api/client/projects/:id/drive`,
 * routes/clientDrive.ts) замууд ЭНЭ НЭГ функцийг дууддаг — эрхийн шалгалт
 * нь дуудагчийнх, урсгал нь ижил.  Дуудагч `DriveBrowseError`-ыг өөрөө барина.
 */
export async function serveDriveContent(c: AppContext, entry: DriveEntry, download: boolean): Promise<Response> {
  const plan = previewPlan(entry);
  const isGoogle = plan.kind === 'google';
  // Товчлол өөрөө агуулгагүй; Google Forms/Sites г.м. экспортлогдохгүй —
  // хоёуланд нь зөвхөн «Эх файлыг нээх».
  if (entry.mimeType === SHORTCUT_MIME || (!isGoogle && entry.mimeType.startsWith(GOOGLE_APPS_PREFIX))) {
    return c.json({ error: 'Энэ төрлийн файлыг зөвхөн Google дээр нээнэ', code: 'NO_PREVIEW' }, 415);
  }
  if (!download && plan.kind === 'none') {
    return c.json({ error: 'Энэ төрлийн файлыг хуудсан дотор харах боломжгүй', code: 'NO_PREVIEW' }, 415);
  }
  if (!download && plan.kind === 'thumbnail') {
    return c.json({ error: 'Зөвхөн зургаар харна', code: 'THUMBNAIL_ONLY' }, 415);
  }

  const upstream = isGoogle
    ? await driveBrowseExport(c.env, entry.id, plan.exportMime ?? 'application/pdf')
    : await driveBrowseDownload(c.env, entry.id);

  const headers = new Headers();
  const upstreamType = upstream.headers.get('content-type');
  headers.set('Content-Type', plan.contentType ?? upstreamType ?? 'application/octet-stream');
  const len = upstream.headers.get('content-length');
  if (len) headers.set('Content-Length', len);
  const name = isGoogle ? `${entry.name}.pdf` : entry.name;
  headers.set('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', name));
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, { status: 200, headers });
}

/** Drive-ын үүсгэсэн эхний хуудасны зураг (`thumbnailLink` нь bearer токен
 *  шаарддаг тул хөтөч рүү ХЭЗЭЭ Ч явахгүй — серверээр дамжина). */
export async function serveDriveThumbnail(c: AppContext, entry: DriveEntry): Promise<Response> {
  if (!entry.hasThumbnail || !entry.thumbnailLink) {
    return c.json({ error: 'Энэ файлд урьдчилсан зураг алга', code: 'NO_THUMBNAIL' }, 404);
  }
  const upstream = await driveBrowseThumbnail(c.env, entry.thumbnailLink);
  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'image/png');
  headers.set('Cache-Control', 'private, max-age=60');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(upstream.body, { status: 200, headers });
}

/**
 * Drive хавтасны id/холбоосыг Drive-аас ҮНЭХЭЭР уншиж баталгаажуулна: буруу
 * id, хуваалцаагүй хавтас, файл (хавтас биш), хогийн сав дахь хавтас бүгд
 * энд л илэрнэ — ажилтан хоосон таб хараад гайхахгүй.
 * Буцаах: баталгаажсан Drive мөр, ЭСВЭЛ бэлэн HTTP хариу (алдаа).
 */
export async function verifyFolderInput(
  c: AppContext,
  raw: string,
  where: string,
): Promise<{ ok: true; entry: DriveEntry } | { ok: false; response: Response }> {
  const folderId = parseDriveFolderInput(raw);
  if (!folderId) {
    return {
      ok: false,
      response: c.json({ error: 'Drive хавтасны id эсвэл холбоос танигдсангүй', code: 'INVALID_FOLDER' }, 400),
    };
  }
  let entry: DriveEntry;
  try {
    entry = await driveBrowseGet(c.env, folderId);
  } catch (err) {
    return { ok: false, response: driveErrorResponse(c, err, where) };
  }
  if (entry.mimeType !== FOLDER_MIME) {
    return { ok: false, response: c.json({ error: 'Энэ id нь хавтас биш, файл байна', code: 'NOT_A_FOLDER' }, 400) };
  }
  if (entry.trashed) {
    return { ok: false, response: c.json({ error: 'Энэ хавтас Drive-ын хогийн саванд байна', code: 'TRASHED' }, 400) };
  }
  return { ok: true, entry };
}

/* ------------------------------------------------------------------ */
/*  Байршуулалтын ЦӨМ — хоёр router хуваалцана                          */
/* ------------------------------------------------------------------ */
/*
 * Ажилтны (`mountDriveBrowse`, `/api/projects` + `/api/main-projects`) ба
 * захиалагчийн (`routes/clientDrive.ts`, `/api/client`) router хоёулаа ЭНЭ
 * функцүүдийг дуудна — Google resumable session, тикет, chunk-ийн шалгалт,
 * ledger нэг л хэрэгжилттэй (2026-09-21).  Дуудагч ЭРХИЙГ өөрөө шийдээд
 * (ажилтан: `DRIVE_ROLES` + ancestry; захиалагч: төслийн эрх + «09» дэд мод)
 * ЗӨВХӨН баталгаажсан `rootId`/`folderId`-г дамжуулна — энд эрхийн шалгалт
 * ДАХИН хийгдэхгүй.
 */

type UploadBody = {
  name?: unknown;
  mime?: unknown;
  size?: unknown;
  on_conflict?: unknown;
  /** Зөвхөн ШИНЭЧЛЭЭГҮЙ хуудас (хасагдсан «Google Docs болгох») илгээнэ — `startUploadIn` татгалзана. */
  convert?: unknown;
};
type MkdirBody = { name?: unknown; reuse?: unknown };

/** Дэд хавтас үүсгэнэ.  `reuse` (өгөгдмөл true): ижил нэртэй хавтас байвал
 *  ТҮҮНИЙГ буцаана — хавтас байршуулахад хөтөч зам бүрийг үүсгэдэг тул давхар
 *  «Зураг/Зураг» үүсэхгүй. */
export async function createSubfolderIn(
  c: AppContext,
  opts: { rootId: string; folderId: string; body: unknown; label: string },
): Promise<Response> {
  const body = (opts.body ?? {}) as MkdirBody;
  const name = sanitizeUploadName(body.name);
  if (!name) return c.json({ error: 'Хавтасны нэр буруу байна', code: 'INVALID_NAME' }, 400);
  try {
    if (body.reuse !== false) {
      const existing = await driveFindChildByName(c.env, opts.folderId, name, 'folder');
      if (existing) return c.json({ item: toProjectDriveItem(existing), created: false });
    }
    const ident = await driveWriteIdentity(c.env, opts.rootId);
    const entry = await driveCreateFolder(c.env, { name, parentId: opts.folderId, subject: ident.subject });
    invalidateDriveListing(opts.folderId);
    return c.json({ item: toProjectDriveItem(entry), created: true }, 201);
  } catch (err) {
    return driveErrorResponse(c, err, `mkdir ${opts.label} folder=${opts.folderId}`);
  }
}

/**
 * Google resumable session нээж, гарын үсэгтэй токен буцаана.  Байт энд ирэхгүй.
 * `on_conflict`: replace (өгөгдмөл) = ижил нэртэй файл байвал ТҮҮНИЙ шинэ
 * хувилбар (Drive-ын түүх + манай ledger хоёуланд хадгалагдана); keep = хажууд
 * нь ижил нэртэй ШИНЭ файл (Drive үүнийг зөвшөөрдөг).
 */
export async function startUploadIn(
  c: AppContext,
  opts: { rootId: string; folderId: string; userId: number; body: unknown; label: string },
): Promise<Response> {
  const body = (opts.body ?? {}) as UploadBody;
  // «Google Docs болгох» 2026-10-01-нд хасагдсан; deploy-оос өмнө нээгдсэн хуудас (хуучин chunk санах
  // ойд) дарвал сервер хөрвүүлэхгүй тул үргэлжлүүлбэл хавтсанд ижил нэртэй .docx ДАВХАРДАЛ үүснэ.
  if (body.convert != null) {
    return c.json({ error: 'Хуудсаа шинэчилнэ үү — «Google Docs болгох» хасагдсан', code: 'CLIENT_OUTDATED' }, 400);
  }
  const name = sanitizeUploadName(body.name);
  if (!name) return c.json({ error: 'Файлын нэр буруу байна', code: 'INVALID_NAME' }, 400);
  const size = typeof body.size === 'number' ? body.size : Number.NaN;
  if (!Number.isInteger(size) || size <= 0) {
    return c.json({ error: 'Хоосон файл байршуулах боломжгүй', code: 'EMPTY_FILE' }, 400);
  }
  if (size > UPLOAD_MAX_BYTES) {
    return c.json({ error: 'Файл хэт том байна (тааз 2 GB)', code: 'UPLOAD_TOO_LARGE' }, 413);
  }
  const conflict = parseConflict(body.on_conflict);
  if (!conflict) return c.json({ error: 'Invalid on_conflict', code: 'INVALID_CONFLICT' }, 400);
  const mime = normalizeUploadMime(body.mime, name);
  try {
    let existing: DriveEntry | null = null;
    if (conflict === 'replace') {
      const found = await driveFindChildByName(c.env, opts.folderId, name, 'file');
      // Google-ийн өөрийн форматтай (Doc/Sheet) файлыг байт ачаалж «солих» нь
      // Drive-ын импорт болно — таамаглахгүй, хажууд нь шинэ файл үүсгэнэ.
      if (found && !found.mimeType.startsWith(GOOGLE_APPS_PREFIX) && found.mimeType !== SHORTCUT_MIME) {
        existing = found;
      }
    }
    // My Drive хавтсанд ЭЗНИЙ нэрээр (DWD), Shared drive-д SA өөрөө — файлын
    // толгойн тайлбар (`driveBrowse.ts`).  Прод 2026-09-18: storageQuotaExceeded.
    const ident = await driveWriteIdentity(c.env, opts.rootId);
    const session = await driveResumableStart(c.env, {
      name,
      parentId: opts.folderId,
      mime,
      size,
      existingFileId: existing?.id ?? null,
      subject: ident.subject,
    });
    const ticket: UploadTicket = {
      session,
      root: opts.rootId,
      parent: opts.folderId,
      name,
      mime,
      size,
      existing: existing?.id ?? null,
      user: opts.userId,
      exp: Date.now() + UPLOAD_TOKEN_TTL_MS,
    };
    return c.json({
      upload_token: await signUploadTicket(c.env.JWT_SECRET, ticket),
      chunk_bytes: UPLOAD_CHUNK_BYTES,
      /** Солигдох файл (шинэ хувилбар болно) — UI-д «солигдоно» гэж харуулна. */
      replacing: existing ? { id: existing.id, name: existing.name } : null,
    });
  } catch (err) {
    return driveErrorResponse(c, err, `upload-start ${opts.label} folder=${opts.folderId}`);
  }
}

/** `X-Upload-Token` → тикет; ЭНЭ төслийн үндэс + ЭНЭ хэрэглэгчийнх байх ёстой. */
export async function readUploadTicket(
  c: AppContext,
  rootFolderId: string | null,
): Promise<{ ok: true; ticket: UploadTicket } | { ok: false; response: Response }> {
  const raw = c.req.header('x-upload-token') ?? '';
  const ticket = await verifyUploadTicket(c.env.JWT_SECRET, raw);
  if (!ticket) {
    return {
      ok: false,
      response: c.json({ error: 'Байршуулалтын токен хүчингүй — дахин эхлүүлнэ үү', code: 'UPLOAD_TOKEN_INVALID' }, 401),
    };
  }
  if (!rootFolderId || ticket.root !== rootFolderId || ticket.user !== c.get('user').sub) {
    return {
      ok: false,
      response: c.json({ error: 'Энэ байршуулалт өөр төсөл эсвэл өөр хэрэглэгчийнх', code: 'OUTSIDE_PROJECT' }, 403),
    };
  }
  return { ok: true, ticket };
}

/**
 * Нэг chunk-ийг Drive session руу УРСГАЛААР дамжуулна — санах ойд
 * цуглуулахгүй.  Дундах chunk → { done:false, received }; сүүлийнх →
 * { done:true, item } + ledger (`recordUpload`, waitUntil).
 */
export async function putUploadChunkFor(c: AppContext, ticket: UploadTicket, label: string): Promise<Response> {
  const offset = Number(c.req.query('offset') ?? '');
  const contentLength = Number(c.req.header('content-length') ?? '');
  const chunk = checkChunk(offset, contentLength, ticket.size);
  if (!chunk.ok) {
    return c.json(
      {
        error: chunk.reason === 'BAD_OFFSET' ? 'Chunk-ийн эхлэл буруу' : 'Chunk-ийн урт буруу',
        code: chunk.reason,
        chunk_bytes: UPLOAD_CHUNK_BYTES,
      },
      400,
    );
  }
  const body = c.req.raw.body;
  if (!body) return c.json({ error: 'Биет алга', code: 'BAD_LENGTH' }, 400);
  try {
    const r = await driveResumablePut(ticket.session, { stream: body, length: chunk.length }, offset, ticket.size);
    if (!r.done) return c.json({ done: false, received: r.received });
    invalidateDriveListing(ticket.parent);
    // Хуулбар + «хэн байршуулав» мөр — хөтөч хүлээхгүй; унавал сонсогч
    // Changes-ээр файлыг олоод нэргүй `created` мөр бичнэ (нөөц зам).
    c.executionCtx.waitUntil(
      recordUpload(c.env, ticket.root, r.entry, { userId: ticket.user, replaced: ticket.existing !== null }).catch(
        (err: unknown) => console.error(`[project-drive] recordUpload file=${r.entry.id}`, err),
      ),
    );
    return c.json({ done: true, item: toProjectDriveItem(r.entry) });
  } catch (err) {
    // Google session-ийн 404 = хугацаа дууссан/цуцлагдсан — «хавтас олдсонгүй» биш.
    if (err instanceof DriveBrowseError && err.code === 'NOT_FOUND') {
      console.error(`[project-drive] upload-chunk ${label}: session gone — ${err.message}`);
      return c.json({ error: 'Байршуулалтын session хүчингүй болсон — дахин эхлүүлнэ үү', code: 'UPLOAD_SESSION_GONE' }, 410);
    }
    return driveErrorResponse(c, err, `upload-chunk ${label} offset=${offset}`);
  }
}

/** Хагас байршуулалтыг цуцална (Google session). */
export async function cancelUploadFor(c: AppContext, ticket: UploadTicket): Promise<Response> {
  await driveResumableCancel(ticket.session);
  return c.json({ ok: true });
}

/* ------------------------------------------------------------------ */
/*  Үзэх / холбох handler-уудын үйлдвэр                                */
/* ------------------------------------------------------------------ */

export interface DriveBrowseScope {
  /** Логийн шошго: 'project' | 'main'. */
  label: string;
  /** `:id` → үндэс (байхгүй бол null). */
  resolveRoot: (db: D1Database, id: number) => Promise<ProjectDriveRoot | null>;
  /**
   * Хавтас холбох/салгах бичилт.  Ангиллын төслийн scope дээр үндсэн төсөл
   * байвал бичилт ҮНДСЭН ТӨСӨЛ РҮҮ очно (баримт бичиг нь бодит төслийнх).
   * Буцаах: бичилт ХААНА очсон.
   */
  writeFolder: (
    db: D1Database,
    root: ProjectDriveRoot,
    folder: { id: string; name: string } | null,
  ) => Promise<'main' | 'project'>;
}

export function mountDriveBrowse(app: App, scope: DriveBrowseScope): void {
  async function assertDriveAccess(c: AppContext, id: number): Promise<AccessResult> {
    const user = c.get('user');
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, status: 404, error: 'Project not found', code: 'PROJECT_NOT_FOUND' };
    }
    if (!DRIVE_ROLES.has(user.role)) {
      return { ok: false, status: 403, error: 'Access denied', code: 'FORBIDDEN' };
    }
    const root = await scope.resolveRoot(c.env.DB, id);
    if (!root) {
      return { ok: false, status: 404, error: 'Project not found', code: 'PROJECT_NOT_FOUND' };
    }
    return { ok: true, root };
  }

  // PUT /:id/drive-folder (admin)
  // Body: { folder: string | null } — Drive id ЭСВЭЛ Drive-ын холбоос; null = салгах.
  app.put('/:id/drive-folder', requireAdmin(), async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);

    const body = await c.req.json<{ folder?: string | null }>().catch(() => ({}) as { folder?: string | null });
    const raw = body.folder;

    // Салгасан / сольсон хуучин хавтас Drive-ийн үндсэн хавтсанд байвал
    // автомат илрүүлэлт (lib/projectDriveDiscovery.ts) түүнийг дараагийн
    // тикэд ШИНЭ үндсэн төсөл болгох байсан — «алгасах» жагсаалтад хийнэ.
    const oldFolder = access.root.folder_id
      ? { id: access.root.folder_id, name: access.root.folder_name ?? access.root.folder_id }
      : null;

    if (raw === null || raw === undefined || String(raw).trim() === '') {
      const wroteTo = await scope.writeFolder(c.env.DB, access.root, null);
      if (oldFolder) {
        invalidateDriveListing(oldFolder.id);
        await ignoreDiscoveredFolder(c.env.DB, oldFolder);
      }
      return c.json({ folder_id: null, folder_name: null, open_url: null, scope: wroteTo });
    }

    const verified = await verifyFolderInput(c, String(raw), `link ${scope.label}=${id}`);
    if (!verified.ok) return verified.response;
    const { entry } = verified;
    const wroteTo = await scope.writeFolder(c.env.DB, access.root, { id: entry.id, name: entry.name });
    invalidateDriveListing(entry.id);
    await unignoreDiscoveredFolder(c.env.DB, entry.id);
    if (oldFolder && oldFolder.id !== entry.id) {
      invalidateDriveListing(oldFolder.id);
      await ignoreDiscoveredFolder(c.env.DB, oldFolder);
    }
    return c.json({
      folder_id: entry.id,
      folder_name: entry.name,
      open_url: entry.webViewLink ?? null,
      scope: wroteTo,
    });
  });

  // GET /:id/drive — Drive руу ДУУДАХГҮЙ, зөвхөн D1 + тохиргоо.
  app.get('/:id/drive', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const user = c.get('user');
    const r = access.root;
    return c.json({
      project_name: r.project_name,
      /** Байршуулалтад SA тохируулагдсан эсэх (GOOGLE_SA_JSON). */
      configured: driveBrowseConfigured(c.env),
      /** Хавтас холбогдсон эсэх (үндсэн төслийнх ч байж болно). */
      linked: r.folder_id !== null,
      folder_id: r.folder_id,
      folder_name: r.folder_name,
      /** Хавтас хаанаас: 'main' (үндсэн төсөл) | 'project' (өөрийнх) | null. */
      folder_scope: r.folder_scope,
      main_project_id: r.main_project_id,
      main_project_name: r.main_project_name,
      /** Зөвхөн админд — хавтсыг хуваалцах хаяг. */
      service_email: user.role === 'admin' ? driveBrowseServiceEmail(c.env) : null,
    });
  });

  // GET /:id/drive/folders/:folderId?page_token=&refresh=1
  // `folderId = root` → үндэс.  Зөвхөн ЭНЭ хавтасны шууд хүүхдүүд — рекурс
  // байхгүй (§11).  `refresh=1` → кэшийг тойрч Drive-аас шинээр.
  app.get('/:id/drive/folders/:folderId', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const rootId = access.root.folder_id;
    if (!rootId) {
      return c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409);
    }

    const requested = c.req.param('folderId');
    const folderId = requested === 'root' ? rootId : requested;
    if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
      return c.json({ error: 'Invalid folder id', code: 'INVALID_ID' }, 400);
    }
    const pageToken = c.req.query('page_token') || null;
    const refresh = c.req.query('refresh') === '1';

    try {
      // 4-р шалгалт: хавтас нь төслийн үндсийн дотор мөн үү.  Үндэс өөрөө ч
      // энэ замаар явдаг — устгагдсан/хуваалцахаа больсон үндэс тэнд л илэрнэ.
      const anc = await resolveAncestry(c.env, rootId, folderId);
      if (!anc.ok) {
        return anc.reason === 'TRASHED'
          ? c.json({ error: USER_MESSAGE.NOT_FOUND, code: 'NOT_FOUND' }, 404)
          : c.json({ error: 'Энэ хавтас төслийн хавтасны дотор биш', code: 'OUTSIDE_PROJECT' }, 403);
      }
      if (anc.target.mimeType !== FOLDER_MIME) {
        return c.json({ error: 'Энэ id нь хавтас биш', code: 'NOT_A_FOLDER' }, 400);
      }
      if (refresh) invalidateDriveListing(folderId);
      const page = await listProjectFolder(c.env, folderId, { pageToken, bypassCache: refresh });
      return c.json({
        root: { id: rootId, name: anc.path[0]?.name ?? access.root.folder_name ?? '' },
        folder: { id: anc.target.id, name: anc.target.name, open_url: anc.target.webViewLink },
        /** Үндэснээс энэ хавтас хүртэл — breadcrumb. */
        path: anc.path,
        items: page.files.map(toProjectDriveItem),
        next_page_token: page.nextPageToken,
        cached: page.cached,
        fetched_at: new Date().toISOString(),
      });
    } catch (err) {
      return driveErrorResponse(c, err, `list ${scope.label}=${id} folder=${folderId}`);
    }
  });

  type FileAccess =
    | { ok: true; entry: DriveEntry; path: { id: string; name: string }[] }
    | { ok: false; response: Response };

  /** Файлын эрх + мета: ancestry шалгаад дараа нь бүрэн мета уншина.
   *  Файлын мета нь `size`/`thumbnailLink` агуулах ёстой тул ancestry-ийн
   *  хөнгөн хариу хангалтгүй — гэхдээ ancestry нь ЭХЛЭЭД: хуваалцаагүй
   *  зүйлийн бүрэн мета руу огт хүрэхгүй. */
  async function loadFile(c: AppContext, root: ProjectDriveRoot, fileId: string): Promise<FileAccess> {
    const rootId = root.folder_id;
    if (!rootId) {
      return {
        ok: false,
        response: c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409),
      };
    }
    if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
      return { ok: false, response: c.json({ error: 'Invalid file id', code: 'INVALID_ID' }, 400) };
    }
    const anc = await resolveAncestry(c.env, rootId, fileId);
    if (!anc.ok) {
      return {
        ok: false,
        response:
          anc.reason === 'TRASHED'
            ? c.json({ error: USER_MESSAGE.NOT_FOUND, code: 'NOT_FOUND' }, 404)
            : c.json({ error: 'Энэ файл төслийн хавтасны дотор биш', code: 'OUTSIDE_PROJECT' }, 403),
      };
    }
    if (anc.target.mimeType === FOLDER_MIME) {
      return { ok: false, response: c.json({ error: 'Энэ id нь хавтас байна', code: 'IS_FOLDER' }, 400) };
    }
    const entry = await driveBrowseGet(c.env, fileId);
    return { ok: true, entry, path: anc.path };
  }

  // GET /:id/drive/files/:fileId — мета + урьдчилан харах төлөвлөгөө.
  app.get('/:id/drive/files/:fileId', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const fileId = c.req.param('fileId');
    try {
      const file = await loadFile(c, access.root, fileId);
      if (!file.ok) return file.response;
      const plan = previewPlan(file.entry);
      return c.json({
        item: toProjectDriveItem(file.entry),
        path: file.path,
        preview: plan.kind,
        /** Google формат — экспортын 10 MB тааз (хэмжээ нь мэдэгддэггүй). */
        export_limit_bytes: plan.kind === 'google' ? DRIVE_EXPORT_MAX_BYTES : null,
      });
    } catch (err) {
      return driveErrorResponse(c, err, `file ${scope.label}=${id} file=${fileId}`);
    }
  });

  // GET /:id/drive/files/:fileId/content?download=1
  // Байтуудыг Drive-аас УРСГАЛААР нэвтрүүлнэ — хадгалахгүй, хуулбарлахгүй.
  // Google формат (Docs/Sheets/Slides) → PDF экспорт (Drive өөрөө хөрвүүлнэ,
  // хуулбар үүсгэхгүй).  Бусад (PDF, зураг, текст, .docx/.xlsx) → эх байт.
  app.get('/:id/drive/files/:fileId/content', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const fileId = c.req.param('fileId');
    const download = c.req.query('download') === '1';
    try {
      const file = await loadFile(c, access.root, fileId);
      if (!file.ok) return file.response;
      return await serveDriveContent(c, file.entry, download);
    } catch (err) {
      return driveErrorResponse(c, err, `content ${scope.label}=${id} file=${fileId}`);
    }
  });

  // GET /:id/drive/files/:fileId/thumbnail — Drive-ын үүсгэсэн эхний хуудасны
  // зураг (PowerPoint, хуучин .doc/.xls г.м. хөтөч render хийж чаддаггүй файлд).
  app.get('/:id/drive/files/:fileId/thumbnail', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const fileId = c.req.param('fileId');
    try {
      const file = await loadFile(c, access.root, fileId);
      if (!file.ok) return file.response;
      return await serveDriveThumbnail(c, file.entry);
    } catch (err) {
      return driveErrorResponse(c, err, `thumbnail ${scope.label}=${id} file=${fileId}`);
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Байршуулах — файл / хавтас (2026-09-17)                          */
  /* ---------------------------------------------------------------- */

  type FolderTarget =
    | { ok: true; rootId: string; folderId: string }
    | { ok: false; response: Response };

  /** Зорилтот хавтас: `root` эсвэл id → ancestry шалгалт + хавтас мөн эсэх.
   *  Жагсаалтын route-той ижил дөрвөн шалгалтын 4-р алхам — файл ӨӨР төслийн
   *  хавтсанд, эсвэл огт хуваалцаагүй хавтсанд очиж чадахгүй. */
  async function resolveTargetFolder(c: AppContext, root: ProjectDriveRoot, raw: string): Promise<FolderTarget> {
    const rootId = root.folder_id;
    if (!rootId) {
      return {
        ok: false,
        response: c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409),
      };
    }
    const folderId = raw === 'root' ? rootId : raw;
    if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) {
      return { ok: false, response: c.json({ error: 'Invalid folder id', code: 'INVALID_ID' }, 400) };
    }
    const anc = await resolveAncestry(c.env, rootId, folderId);
    if (!anc.ok) {
      return {
        ok: false,
        response:
          anc.reason === 'TRASHED'
            ? c.json({ error: USER_MESSAGE.NOT_FOUND, code: 'NOT_FOUND' }, 404)
            : c.json({ error: 'Энэ хавтас төслийн хавтасны дотор биш', code: 'OUTSIDE_PROJECT' }, 403),
      };
    }
    if (anc.target.mimeType !== FOLDER_MIME) {
      return { ok: false, response: c.json({ error: 'Энэ id нь хавтас биш', code: 'NOT_A_FOLDER' }, 400) };
    }
    return { ok: true, rootId, folderId };
  }

  // POST /:id/drive/folders/:folderId/folders — { name, reuse? }
  // Дэд хавтас үүсгэнэ (цөм: `createSubfolderIn`).
  app.post('/:id/drive/folders/:folderId/folders', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const body = await c.req.json<unknown>().catch(() => ({}));
    const target = await resolveTargetFolder(c, access.root, c.req.param('folderId'));
    if (!target.ok) return target.response;
    return createSubfolderIn(c, { rootId: target.rootId, folderId: target.folderId, body, label: `${scope.label}=${id}` });
  });

  // POST /:id/drive/folders/:folderId/uploads — { name, mime, size, on_conflict? }
  // Google resumable session нээж, гарын үсэгтэй токен буцаана (цөм: `startUploadIn`).
  app.post('/:id/drive/folders/:folderId/uploads', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const body = await c.req.json<unknown>().catch(() => ({}));
    const target = await resolveTargetFolder(c, access.root, c.req.param('folderId'));
    if (!target.ok) return target.response;
    return startUploadIn(c, {
      rootId: target.rootId,
      folderId: target.folderId,
      userId: c.get('user').sub,
      body,
      label: `${scope.label}=${id}`,
    });
  });

  // PUT /:id/drive/uploads?offset=N  (X-Upload-Token, түүхий биет) — цөм: `putUploadChunkFor`.
  app.put('/:id/drive/uploads', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const t = await readUploadTicket(c, access.root.folder_id);
    if (!t.ok) return t.response;
    return putUploadChunkFor(c, t.ticket, `${scope.label}=${id}`);
  });

  // DELETE /:id/drive/uploads (X-Upload-Token) — хагас байршуулалтыг цуцална.
  app.delete('/:id/drive/uploads', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const t = await readUploadTicket(c, access.root.folder_id);
    if (!t.ok) return t.response;
    return cancelUploadFor(c, t.ticket);
  });

  /* ---------------------------------------------------------------- */
  /*  Нэр солих / зөөх (2026-09-18)                                    */
  /* ---------------------------------------------------------------- */

  type ItemAccess =
    | { ok: true; rootId: string; itemId: string; target: { id: string; name: string; mimeType: string }; parentId: string | null }
    | { ok: false; response: Response };

  /** Файл ЭСВЭЛ хавтас — ancestry шалгалт; үндэс хавтас өөрөө хориотой
   *  (нэр нь `projects/main_projects`-д кэшлэгдсэн, зөөвөл холбоос тасарна). */
  async function resolveItem(c: AppContext, root: ProjectDriveRoot, raw: string): Promise<ItemAccess> {
    const rootId = root.folder_id;
    if (!rootId) {
      return {
        ok: false,
        response: c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409),
      };
    }
    if (!/^[A-Za-z0-9_-]{10,}$/.test(raw)) {
      return { ok: false, response: c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400) };
    }
    if (raw === rootId) {
      return { ok: false, response: c.json({ error: 'Төслийн үндэс хавтсыг энд өөрчлөхгүй', code: 'IS_ROOT' }, 400) };
    }
    const anc = await resolveAncestry(c.env, rootId, raw);
    if (!anc.ok) {
      return {
        ok: false,
        response:
          anc.reason === 'TRASHED'
            ? c.json({ error: USER_MESSAGE.NOT_FOUND, code: 'NOT_FOUND' }, 404)
            : c.json({ error: 'Энэ зүйл төслийн хавтасны дотор биш', code: 'OUTSIDE_PROJECT' }, 403),
      };
    }
    // path = [root … parent, item]
    const parentId = anc.path.length >= 2 ? (anc.path[anc.path.length - 2]?.id ?? null) : null;
    return { ok: true, rootId, itemId: raw, target: anc.target, parentId };
  }

  // PATCH /:id/drive/files/:fileId — { name }
  app.patch('/:id/drive/files/:fileId', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown });
    const name = sanitizeUploadName(body.name);
    if (!name) return c.json({ error: 'Нэр буруу байна', code: 'INVALID_NAME' }, 400);
    const item = await resolveItem(c, access.root, c.req.param('fileId'));
    if (!item.ok) return item.response;
    try {
      const ident = await driveWriteIdentity(c.env, item.rootId);
      const entry = await driveRename(c.env, item.itemId, name, ident.subject);
      rememberDriveEntry(entry);
      if (item.parentId) invalidateDriveListing(item.parentId);
      return c.json({ item: toProjectDriveItem(entry) });
    } catch (err) {
      return driveErrorResponse(c, err, `rename ${scope.label}=${id} item=${item.itemId}`);
    }
  });

  // POST /:id/drive/files/:fileId/move — { parent_id } ('root' = үндэс)
  // Зөөх хавтас нь төслийн дотор, хавтас байх ёстой; өөрийнхөө дотор (эсвэл
  // дэд хавтас руугаа) зөөж болохгүй — Drive үүнийг өөрөө ч татгалздаг, гэхдээ
  // энд ойлгомжтой кодтой 400.
  app.post('/:id/drive/files/:fileId/move', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const body = await c.req.json<{ parent_id?: unknown }>().catch(() => ({}) as { parent_id?: unknown });
    const rawParent = typeof body.parent_id === 'string' ? body.parent_id : '';
    const item = await resolveItem(c, access.root, c.req.param('fileId'));
    if (!item.ok) return item.response;
    const dest = await resolveTargetFolder(c, access.root, rawParent);
    if (!dest.ok) return dest.response;
    if (dest.folderId === item.parentId) return c.json({ item: null, moved: false });
    try {
      if (item.target.mimeType === FOLDER_MIME) {
        // Зорилтот хавтасны гинжид зөөгдөж буй хавтас өөрөө байвал → өөрийнхөө дотор.
        const chain = await resolveAncestry(c.env, item.rootId, dest.folderId);
        if (chain.ok && chain.path.some((n) => n.id === item.itemId)) {
          return c.json({ error: 'Хавтсыг өөрийнх нь дотор зөөж болохгүй', code: 'MOVE_INTO_SELF' }, 400);
        }
      }
      const ident = await driveWriteIdentity(c.env, item.rootId);
      const entry = await driveMove(c.env, item.itemId, item.parentId ?? item.rootId, dest.folderId, ident.subject);
      rememberDriveEntry(entry);
      if (item.parentId) invalidateDriveListing(item.parentId);
      invalidateDriveListing(dest.folderId);
      return c.json({ item: toProjectDriveItem(entry), moved: true });
    } catch (err) {
      return driveErrorResponse(c, err, `move ${scope.label}=${id} item=${item.itemId} to=${dest.folderId}`);
    }
  });

  /* ---------------------------------------------------------------- */
  /*  «Эх файлыг нээх» — ИЖИЛ .docx-ийн шинэ хувилбар (2026-09-30)     */
  /* ---------------------------------------------------------------- */

  // POST /:id/drive/files/:fileId/revision — { size, base_modified_time }
  // Хөтөч .docx-ийг Google-д Word-той ижил харагдахаар засаад (`frontend/.../drive/
  // docxGoogleReady.ts`) ИЖИЛ файлын шинэ хувилбар болгон байршуулах resumable session
  // (`files.update`) — шинэ файл ХЭЗЭЭ Ч үүсэхгүй («Google Docs болгох» товчийн давхардлыг
  // орлосон).  Байт нь байршуулалтын ердийн `PUT /:id/drive/uploads` chunk-ээр явна; ledger-т
  // `modified` мөр + хэн (`uploaded_by_user_id`).  Хөтөч засвар хийхээр татснаас хойш файл
  // өөрчлөгдсөн бол 409 `STALE_FILE` — бусдын засварыг хуучин байтаар дарахгүй.
  app.post('/:id/drive/files/:fileId/revision', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const req = parseRevisionRequest(await c.req.json<unknown>().catch(() => ({})));
    if (!req.ok) {
      if (req.code === 'REVISION_TOO_LARGE') {
        return c.json({ error: 'Файл хэт том — засваргүй нээнэ үү', code: req.code }, 413);
      }
      return c.json({ error: 'Хүсэлт буруу байна', code: req.code }, 400);
    }
    const item = await resolveItem(c, access.root, c.req.param('fileId'));
    if (!item.ok) return item.response;
    if (!item.parentId) return c.json({ error: 'Энэ файлыг солих боломжгүй', code: 'NOT_REVISABLE' }, 400);
    try {
      const entry = await driveBrowseGet(c.env, item.itemId);
      if (!isRevisableDocx(entry)) {
        return c.json({ error: 'Зөвхөн .docx файлыг ингэж шинэчилнэ', code: 'NOT_REVISABLE' }, 400);
      }
      if ((entry.modifiedTime ?? '') !== req.base) {
        return c.json({ error: 'Файл хооронд нь өөрчлөгдсөн байна', code: 'STALE_FILE' }, 409);
      }
      const ident = await driveWriteIdentity(c.env, item.rootId);
      const session = await driveResumableStart(c.env, {
        name: entry.name,
        parentId: item.parentId,
        mime: DOCX_MIME,
        size: req.size,
        existingFileId: entry.id,
        subject: ident.subject,
      });
      const ticket: UploadTicket = {
        session,
        root: item.rootId,
        parent: item.parentId,
        name: entry.name,
        mime: DOCX_MIME,
        size: req.size,
        existing: entry.id,
        user: c.get('user').sub,
        exp: Date.now() + UPLOAD_TOKEN_TTL_MS,
      };
      return c.json({
        upload_token: await signUploadTicket(c.env.JWT_SECRET, ticket),
        chunk_bytes: UPLOAD_CHUNK_BYTES,
      });
    } catch (err) {
      return driveErrorResponse(c, err, `revision ${scope.label}=${id} file=${item.itemId}`);
    }
  });

  /* ---------------------------------------------------------------- */
  /*  Хувилбарын түүх (миграц 0300)                                    */
  /* ---------------------------------------------------------------- */

  type VersionRowWithUser = DriveVersionRow & { restored_by_name: string | null; uploaded_by_name: string | null };
  // ⚠️ `users`-д `name` багана БАЙХГҮЙ (`full_name`) — прод дээр «Түүх»/«Хувилбарууд»
  // 2026-10-01 хүртэл «no such column: u.name» 500 өгч байв.
  const VERSION_SELECT = `SELECT v.*, COALESCE(u.full_name, u.username) AS restored_by_name,
                                 COALESCE(up.full_name, up.username) AS uploaded_by_name
                            FROM project_drive_versions v
                            LEFT JOIN users u ON u.id = v.restored_by_user_id
                            LEFT JOIN users up ON up.id = v.uploaded_by_user_id`;

  // GET /:id/drive/activity?limit=100 — үндэс хавтасны сүүлийн өөрчлөлтүүд
  // (хэн, хэзээ, аль файл, юу).  Drive руу дуудахгүй — зөвхөн ledger.
  app.get('/:id/drive/activity', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const rootId = access.root.folder_id;
    if (!rootId) return c.json({ items: [], pending: 0 });
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '100', 10) || 100, 1), 300);
    const [rows, pending] = await Promise.all([
      c.env.DB.prepare(`${VERSION_SELECT} WHERE v.root_folder_id = ? ORDER BY v.id DESC LIMIT ?`)
        .bind(rootId, limit)
        .all<VersionRowWithUser>(),
      c.env.DB.prepare('SELECT COUNT(*) AS n FROM project_drive_pending WHERE root_folder_id = ?')
        .bind(rootId)
        .first<{ n: number }>(),
    ]);
    return c.json({
      items: rows.results.map(versionView),
      /** Хадгалагдсан гэж илэрсэн ч хараахан хуулбарлагдаагүй (тогтохыг хүлээж буй) файлын тоо. */
      pending: pending?.n ?? 0,
    });
  });

  // GET /:id/drive/files/:fileId/versions — нэг файлын бүх хувилбар (шинэ нь эхэнд).
  // Ancestry шалгалт ХИЙХГҮЙ: устсан/хогийн сав дахь файлын түүх ч харагдах
  // ёстой (тэр л «буцаах» тохиолдол) — оронд нь мөрийн `root_folder_id` нь
  // ЭНЭ төслийн үндэс мөн үү гэдгээр хязгаарлана.
  app.get('/:id/drive/files/:fileId/versions', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const rootId = access.root.folder_id;
    const fileId = c.req.param('fileId');
    if (!rootId) return c.json({ items: [] });
    if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
      return c.json({ error: 'Invalid file id', code: 'INVALID_ID' }, 400);
    }
    const rows = await c.env.DB.prepare(
      `${VERSION_SELECT} WHERE v.file_id = ? AND v.root_folder_id = ? ORDER BY v.id DESC LIMIT 200`,
    )
      .bind(fileId, rootId)
      .all<VersionRowWithUser>();
    return c.json({ items: rows.results.map(versionView) });
  });

  /** Хувилбарын мөр + «энэ төслийнх мөн үү» шалгалт. */
  async function loadOwnedVersion(
    c: AppContext,
    root: ProjectDriveRoot,
    raw: string,
  ): Promise<{ ok: true; ver: DriveVersionRow } | { ok: false; response: Response }> {
    const vid = parseInt(raw, 10);
    if (!Number.isInteger(vid) || vid <= 0) {
      return { ok: false, response: c.json({ error: 'Invalid version id', code: 'INVALID_ID' }, 400) };
    }
    const ver = await loadVersion(c.env.DB, vid);
    if (!ver || !root.folder_id || ver.root_folder_id !== root.folder_id) {
      return { ok: false, response: c.json({ error: 'Хувилбар олдсонгүй', code: 'VERSION_NOT_FOUND' }, 404) };
    }
    return { ok: true, ver };
  }

  // GET /:id/drive/versions/:versionId/content — R2 дахь хуулбарыг татах.
  app.get('/:id/drive/versions/:versionId/content', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const owned = await loadOwnedVersion(c, access.root, c.req.param('versionId'));
    if (!owned.ok) return owned.response;
    const { ver } = owned;
    if (!ver.r2_key) return c.json({ error: 'Энэ хувилбарт хуулбар байхгүй', code: 'NO_SNAPSHOT' }, 404);
    const obj = await c.env.MEETING_BUCKET.get(ver.r2_key);
    if (!obj) return c.json({ error: 'Хуулбар R2-д олдсонгүй', code: 'SNAPSHOT_MISSING' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', ver.snapshot_mime ?? obj.httpMetadata?.contentType ?? 'application/octet-stream');
    headers.set('Content-Length', String(obj.size));
    headers.set('Content-Disposition', contentDisposition('attachment', snapshotFileName(ver)));
    headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(obj.body, { status: 200, headers });
  });

  // POST /:id/drive/versions/:versionId/restore — Drive-ыг энэ хувилбар руу буцаана.
  // Юу ч устахгүй: Drive шинэ хувилбар үүсгэнэ, ledger-т `restored` мөр (хэн,
  // аль хувилбараас) бичигдэнэ.  SA хавтас дээр «Засварлагч» байх ёстой.
  app.post('/:id/drive/versions/:versionId/restore', async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const owned = await loadOwnedVersion(c, access.root, c.req.param('versionId'));
    if (!owned.ok) return owned.response;
    const user = c.get('user');
    try {
      const row = await restoreVersion(c.env, owned.ver, user.sub);
      const who = await c.env.DB.prepare('SELECT COALESCE(full_name, username) AS name FROM users WHERE id = ?')
        .bind(user.sub)
        .first<{ name: string }>();
      return c.json({ version: versionView({ ...row, restored_by_name: who?.name ?? null }) });
    } catch (err) {
      if (err instanceof DriveRestoreError) {
        const msg: Record<DriveRestoreError['code'], string> = {
          NO_SNAPSHOT: 'Энэ хувилбарт хуулбар байхгүй тул буцааж болохгүй.',
          NOT_RESTORABLE: 'Энэ төрлийн файлыг (Google Drawing г.м.) хуулбараас буцааж болохгүй.',
          SNAPSHOT_MISSING: 'Хуулбар хадгалалтаас олдсонгүй.',
          NO_PARENT: 'Устсан файлын эцэг хавтас мэдэгдэхгүй тул дахин үүсгэж чадсангүй.',
        };
        return c.json({ error: msg[err.code], code: err.code }, err.code === 'SNAPSHOT_MISSING' ? 404 : 409);
      }
      return driveErrorResponse(c, err, `restore ${scope.label}=${id} version=${owned.ver.id}`);
    }
  });

  // POST /:id/drive/baseline (admin) — одоо байгаа файл бүрийг дараалалд:
  // сонсогч зөвхөн ирээдүйн өөрчлөлтийг өгдөг тул анхны хуулбарыг энд авна.
  app.post('/:id/drive/baseline', requireAdmin(), async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const rootId = access.root.folder_id;
    if (!rootId) {
      return c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409);
    }
    try {
      const res = await enqueueBaseline(c.env, rootId);
      return c.json(res);
    } catch (err) {
      return driveErrorResponse(c, err, `baseline ${scope.label}=${id}`);
    }
  });

  // GET /:id/drive/sharing (admin) — үндэс хавтасны «холбоостой хэн ч» эрх.
  app.get('/:id/drive/sharing', requireAdmin(), async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const rootId = access.root.folder_id;
    if (!rootId) return c.json({ anyone: null, linked: false });
    try {
      const anyone = await driveGetAnyonePermission(c.env, rootId);
      return c.json({ anyone, linked: true, open_url: `https://drive.google.com/drive/folders/${rootId}` });
    } catch (err) {
      return driveErrorResponse(c, err, `sharing ${scope.label}=${id}`);
    }
  });

  // PUT /:id/drive/sharing (admin) — { anyone: 'writer' | 'reader' | 'commenter' | null }.
  // Хавтас дээр тавьсан эрх бүх хүүхдэд өвлөгдөнө: «writer» = Google акаунтгүй
  // гүйцэтгэгч ч холбоосоор орж засварлана (эзний 2026-09-15-ны шийдвэр).
  app.put('/:id/drive/sharing', requireAdmin(), async (c) => {
    noStore(c);
    const id = parseInt(c.req.param('id'), 10);
    const access = await assertDriveAccess(c, id);
    if (!access.ok) return c.json({ error: access.error, code: access.code }, access.status);
    const rootId = access.root.folder_id;
    if (!rootId) {
      return c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409);
    }
    const body = await c.req.json<{ anyone?: unknown }>().catch(() => ({}) as { anyone?: unknown });
    const raw = body.anyone;
    let role: DriveAnyoneRole | null;
    if (raw === null || raw === undefined || raw === '') role = null;
    else if (raw === 'writer' || raw === 'reader' || raw === 'commenter') role = raw;
    else return c.json({ error: 'Invalid role', code: 'INVALID_ROLE' }, 400);
    try {
      const anyone = await driveSetAnyonePermission(c.env, rootId, role);
      return c.json({ anyone, linked: true });
    } catch (err) {
      return driveErrorResponse(c, err, `set-sharing ${scope.label}=${id} role=${role ?? 'none'}`);
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Ангиллын төслийн scope (/api/projects)                             */
/* ------------------------------------------------------------------ */

const projectDrive: App = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// GET /api/projects/drive/service-account (admin)
// Хавтсыг ЭНЭ хаягтай «Үзэгч» эрхээр хуваалцана.  Нууц биш.
projectDrive.get('/drive/service-account', requireAdmin(), (c) => {
  noStore(c);
  const email = driveBrowseServiceEmail(c.env);
  return c.json({ configured: email !== null, email });
});

mountDriveBrowse(projectDrive, {
  label: 'project',
  resolveRoot: loadProjectDriveRoot,
  // Үндсэн төсөлтэй ангиллын төсөл дээр холбовол ҮНДСЭН ТӨСӨЛ рүү бичнэ —
  // AZ болон ZA хоёулаа нэг хавтсыг харах ёстой (эзний 2026-09-11-ний шийдвэр).
  writeFolder: async (db, root, folder) => {
    if (root.main_project_id != null) {
      await db
        .prepare(
          `UPDATE main_projects
              SET google_drive_folder_id = ?, google_drive_folder_name = ?, updated_at = datetime('now')
            WHERE id = ?`,
        )
        .bind(folder?.id ?? null, folder?.name ?? null, root.main_project_id)
        .run();
      return 'main';
    }
    await db
      .prepare(
        `UPDATE projects
            SET google_drive_folder_id = ?, google_drive_folder_name = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(folder?.id ?? null, folder?.name ?? null, root.project_id)
      .run();
    return 'project';
  },
});

// Word баримтын гарын үсэг + захирлын баталгаажуулалт (routes/driveSigning.ts, миграц 0371).
mountDriveSigning(projectDrive, {
  label: 'project',
  resolveRoot: loadProjectDriveRoot,
  io: makeDriveSignIo(driveErrorResponse),
});

export default projectDrive;
