/* =============================================================
 * Захиалагчийн портал — төслийн Drive баримт (2026-09-18, миграц 0327;
 * эрхийн дүрэм 2026-09-21-нд ЭЗНИЙ шийдвэрээр өөрчлөгдсөн)
 * -------------------------------------------------------------
 * `/api/client` дээр mount хийгдсэн ХОЁР ДАХЬ router (routes/clientPortal.ts-ийн
 * дараа).  Замууд нь ажилтны `/api/projects/:id/drive/*`-тай ЗЭРЭГЦЭЭ, гэхдээ
 * эрхийн дүрэм нь ӨӨР (`lib/clientDriveUpload.ts`-ийн толгой):
 *
 *   • ХАРАХ: төсөлд эрхтэй байгууллагын захиалагч (`project_client_access`,
 *     ямар ч түвшин) төслийн Drive үндэс хавтсыг БҮХЭЛД НЬ харж, татна.
 *     (2026-09-18 — 2026-09-21 хооронд «зөвхөн `client_drive_shares`-д нээсэн
 *     зүйл» байсан; эзэн 2026-09-21-нд «бүх хавтас view-only» гэж шийдэв.
 *     `client_drive_shares` + `routes/clientDriveAdmin.ts` хэвээр — хандалтын
 *     лог, урилга, түүх; харагдацыг ШИЙДЭХЭЭ больсон.)
 *   • БАЙРШУУЛАХ: ЗӨВХӨН «09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ» хавтас + дэд мод
 *     (нэрээр таньдаг — `findClientUploadFolder`), зөвхөн `contributor`/`approver`
 *     түвшний захиалагч (`clientCanSubmit` — материал илгээхтэй ижил).  Бусад
 *     хавтсанд байршуулах / дэд хавтас үүсгэх → 403 `UPLOAD_NOT_ALLOWED`;
 *     09 хавтас Drive-д байхгүй → 409 `UPLOAD_FOLDER_MISSING`.  Нэр солих,
 *     зөөх, устгах, хувилбар сэргээх — захиалагчид ОГТ БАЙХГҮЙ.
 *
 *   GET    /projects/:id/drive                                төлөв + 09 хавтас + байршуулах эрх
 *   GET    /projects/:id/drive/folders/:folderId              жагсаалт (`root` = үндэс), `can_upload`
 *   GET    /projects/:id/drive/files/:fileId                  мета + харах төлөвлөгөө
 *   GET    /projects/:id/drive/files/:fileId/content          байтууд (урсгалаар; ?download=1)
 *   GET    /projects/:id/drive/files/:fileId/thumbnail        эхний хуудасны зураг
 *   POST   /projects/:id/drive/folders/:folderId/folders      дэд хавтас (09 дотор л)
 *   POST   /projects/:id/drive/folders/:folderId/uploads      upload эхлүүлэх (09 дотор л)
 *   PUT    /projects/:id/drive/uploads?offset=N               chunk (X-Upload-Token)
 *   DELETE /projects/:id/drive/uploads                        цуцлах
 *
 * Хариуны хэлбэр нь ажилтны замынхтай ИЖИЛ (`DriveFolderPage`, `DriveFileDetail`,
 * `DriveUploadStart`) — frontend-ийн `DriveItemList`/`DriveFilePreviewDialog`/
 * `useDriveFolder`/`runDriveUploads` `scope = 'client'`-ээр ЯГ тэр кодыг дахин
 * ашигладаг; байршуулалтын цөм (`createSubfolderIn`, `startUploadIn`,
 * `putUploadChunkFor`) `routes/projectDrive.ts`-ээс экспортлогдсон — хоёр
 * router зөрөхгүй.
 *
 * Эрхийн дөрвөн шалгалт (projectDrive.ts-тэй ижил бүтэц):
 *   1. нэвтэрсэн; 2. төсөл байгаа + захиалагч тэр төсөлд эрхтэй
 *   (`clientAccessLevel`, DB-ээс, JWT биш); 3. зүйл нь төслийн үндэс хавтасны
 *   дотор (`resolveAncestry`); 4. БИЧИХ үйлдэлд зорилтот зам 09-ийн дотор
 *   (`uploadAllowedOnPath`) + `contributor`+ түвшин.  Тикет нь үндэс + хэрэглэгчээр
 *   баригддаг (`readUploadTicket`), chunk бүрд 09-ийн дотор эсэхийг ДАХИН шалгана —
 *   09 хавтсыг байршуулалтын дундуур зөөсөн/нэрийг нь сольсон ч гадуур байт очихгүй.
 *
 * Ажилтан (admin/senior) энэ замыг «захиалагч юу харж байна» гэж шалгах
 * зорилгоор дуудаж болно — зөвхөн УНШИХ; бичих замууд тэдэнд 403 (ажилтан
 * өөрийн `/api/projects/:id/drive/*` замаар байршуулна — ledger-ийн «хэн
 * байршуулав» захиалагч/ажилтан гэдгээрээ үнэн үлдэнэ).  Бусад ажилтны role 403.
 * Захиалагчийн харах/татах бүр `client_drive_access_log`-д (`via_item_id` =
 * үндэс хавтас, «бүх төсөл нээлттэй»-тэй ижил утга) — ажилтных биш.
 * ============================================================= */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, AppVariables } from '../types';
import { clientAccessLevel, clientOrgIds, type ClientAccessLevel } from '../lib/clientAccess';
import { logClientDriveAccess } from '../lib/clientDriveShares';
import { pickClientUploadFolder, uploadAllowedOnPath } from '../lib/clientDriveUpload';
import {
  DRIVE_EXPORT_MAX_BYTES,
  FOLDER_MIME,
  driveBrowseConfigured,
  driveBrowseGet,
  type DriveEntry,
} from '../lib/google/driveBrowse';
import { loadProjectDriveRoot, previewPlan, toProjectDriveItem, type ProjectDriveRoot } from '../lib/projectDrive';
import {
  invalidateDriveListing,
  listProjectFolder,
  resolveAncestry,
  type DrivePathNode,
} from '../lib/projectDriveAccess';
import {
  DRIVE_MANAGER_ROLES,
  cancelUploadFor,
  createSubfolderIn,
  driveErrorResponse,
  noStore,
  putUploadChunkFor,
  readUploadTicket,
  serveDriveContent,
  serveDriveThumbnail,
  startUploadIn,
} from './projectDrive';

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const clientDrive = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const ID_RE = /^[A-Za-z0-9_-]{10,}$/;

/** Захиалагчид очих мөр — `open_url` (Drive-ын webViewLink) ХЭЗЭЭ Ч явахгүй:
 *  хавтас «холбоостой хэн ч засна» горимтой байж болох тул (0300) тэр холбоос
 *  нь захиалагчид Drive дээр ЗАСАХ эрх өгчихнө.  Портал зөвхөн харах + татах
 *  (+ 09-д байршуулах). */
function clientItem(entry: DriveEntry) {
  return { ...toProjectDriveItem(entry), open_url: null, icon_url: null };
}

/** Материал илгээх эрх — `clientCanSubmit`-тэй ижил дүрэм (contributor+). */
function canUploadLevel(level: ClientAccessLevel | null): boolean {
  return level === 'contributor' || level === 'approver';
}

type Access =
  | {
      ok: true;
      root: ProjectDriveRoot;
      /** Захиалагчийн эхний байгууллага — лог бичихэд. */
      orgId: number | null;
      isClient: boolean;
      /** Захиалагч байршуулж болох уу (эрхийн түвшин; хавтас тусдаа). */
      canUpload: boolean;
    }
  | { ok: false; response: Response };

async function assertClientDriveAccess(c: AppContext, projectId: number): Promise<Access> {
  const user = c.get('user');
  if (!Number.isInteger(projectId) || projectId <= 0) {
    return { ok: false, response: c.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, 404) };
  }
  const isClient = user.role === 'client';
  if (!isClient && !DRIVE_MANAGER_ROLES.has(user.role)) {
    return { ok: false, response: c.json({ error: 'Access denied', code: 'FORBIDDEN' }, 403) };
  }
  let orgIds: number[] = [];
  let canUpload = false;
  if (isClient) {
    const level = await clientAccessLevel(c.env.DB, user.sub, projectId);
    if (!level) {
      return { ok: false, response: c.json({ error: 'Access denied', code: 'FORBIDDEN' }, 403) };
    }
    canUpload = canUploadLevel(level);
    orgIds = await clientOrgIds(c.env.DB, user.sub);
  }
  const root = await loadProjectDriveRoot(c.env.DB, projectId);
  if (!root) {
    return { ok: false, response: c.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, 404) };
  }
  return { ok: true, root, orgId: orgIds[0] ?? null, isClient, canUpload };
}

/** Үндэсний жагсаалтаас 09 хавтсыг олно — хамгийн ихдээ 5 хуудас (1 000 зүйл);
 *  `listProjectFolder`-ийн 30 сек кэшийг дахин ашиглана. */
const UPLOAD_FOLDER_MAX_PAGES = 5;

export async function findClientUploadFolder(
  env: Env,
  rootId: string,
  opts: { bypassCache?: boolean } = {},
): Promise<DriveEntry | null> {
  let pageToken: string | null = null;
  for (let i = 0; i < UPLOAD_FOLDER_MAX_PAGES; i++) {
    const page = await listProjectFolder(env, rootId, { pageToken, bypassCache: opts.bypassCache });
    const hit = pickClientUploadFolder(page.files);
    if (hit) return hit;
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }
  return null;
}

// GET /projects/:id/drive — тохиргооны төлөв.  Ажилтны хариутай ИЖИЛ түлхүүрүүд
// (`DriveStatus`) + `upload_folder` (09 хавтас, Drive-аас; олдохгүй/алдаа → null,
// төлөв өөрөө унахгүй) + `can_upload` (энэ хэрэглэгч байршуулах эрхтэй юу).
clientDrive.get('/projects/:id/drive', async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  const r = access.root;
  const linked = r.folder_id !== null;
  let uploadFolder: DriveEntry | null = null;
  if (linked && driveBrowseConfigured(c.env)) {
    try {
      uploadFolder = await findClientUploadFolder(c.env, r.folder_id!);
    } catch (err) {
      // Төлөв нь Drive-ын алдаанд унахгүй — жагсаалтын route өөрөө хэлнэ.
      console.warn(`[client-drive] upload folder lookup project=${id}`, err);
    }
  }
  return c.json({
    project_name: r.project_name,
    configured: driveBrowseConfigured(c.env),
    linked,
    folder_id: null,
    folder_name: r.project_name,
    folder_scope: r.folder_scope,
    main_project_id: null,
    main_project_name: null,
    service_email: null,
    upload_folder: uploadFolder ? { id: uploadFolder.id, name: uploadFolder.name } : null,
    can_upload: access.canUpload,
  });
});

type FolderAccess =
  | { ok: true; rootId: string; folderId: string; path: DrivePathNode[]; target: { id: string; name: string } }
  | { ok: false; response: Response };

/** `root` эсвэл id → ancestry шалгалт (үндэсний дотор) + хавтас мөн эсэх.
 *  Гадуурх/устсан → 404 (403 биш: id таамаглаж бүтэц тандахгүй). */
async function loadVisibleFolder(c: AppContext, root: ProjectDriveRoot, raw: string): Promise<FolderAccess> {
  const rootId = root.folder_id;
  if (!rootId) {
    return {
      ok: false,
      response: c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409),
    };
  }
  const folderId = raw === 'root' ? rootId : raw;
  if (!ID_RE.test(folderId)) return { ok: false, response: c.json({ error: 'Invalid folder id', code: 'INVALID_ID' }, 400) };
  const anc = await resolveAncestry(c.env, rootId, folderId);
  if (!anc.ok) return { ok: false, response: c.json({ error: 'Олдсонгүй', code: 'NOT_FOUND' }, 404) };
  if (anc.target.mimeType !== FOLDER_MIME) {
    return { ok: false, response: c.json({ error: 'Энэ id нь хавтас биш', code: 'NOT_A_FOLDER' }, 400) };
  }
  return { ok: true, rootId, folderId, path: anc.path, target: { id: anc.target.id, name: anc.target.name } };
}

// GET /projects/:id/drive/folders/:folderId?page_token=&refresh=1
clientDrive.get('/projects/:id/drive/folders/:folderId', async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  const requested = c.req.param('folderId');
  const refresh = c.req.query('refresh') === '1';
  const rootName = access.root.project_name;
  try {
    const folder = await loadVisibleFolder(c, access.root, requested);
    if (!folder.ok) return folder.response;
    const pageToken = c.req.query('page_token') || null;
    if (refresh) invalidateDriveListing(folder.folderId);
    const page = await listProjectFolder(c.env, folder.folderId, { pageToken, bypassCache: refresh });
    // Байршуулах эрх ЭНЭ хавтсанд: түвшин + 09-ийн дотор.  Үндэс хавтасны
    // жагсаалт саяхан уншигдсан (эсвэл ЭНЭ хүсэлт үндэс өөрөө) тул кэшнээс.
    let canUpload = false;
    if (access.canUpload) {
      const up = await findClientUploadFolder(c.env, folder.rootId);
      canUpload = uploadAllowedOnPath(folder.path, up?.id ?? null);
    }
    return c.json({
      root: { id: 'root', name: rootName },
      folder: { id: folder.target.id, name: folder.folderId === folder.rootId ? rootName : folder.target.name, open_url: null },
      path: [{ id: 'root', name: rootName }, ...folder.path.slice(1)],
      items: page.files.map(clientItem),
      next_page_token: page.nextPageToken,
      cached: page.cached,
      fetched_at: new Date().toISOString(),
      can_upload: canUpload,
    });
  } catch (err) {
    return driveErrorResponse(c, err, `client list project=${id} folder=${requested}`);
  }
});

type FileAccess =
  | { ok: true; entry: DriveEntry; path: DrivePathNode[]; rootId: string }
  | { ok: false; response: Response };

async function loadVisibleFile(c: AppContext, root: ProjectDriveRoot, fileId: string): Promise<FileAccess> {
  const rootId = root.folder_id;
  if (!rootId) {
    return {
      ok: false,
      response: c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409),
    };
  }
  if (!ID_RE.test(fileId)) return { ok: false, response: c.json({ error: 'Invalid file id', code: 'INVALID_ID' }, 400) };
  const anc = await resolveAncestry(c.env, rootId, fileId);
  if (!anc.ok) return { ok: false, response: c.json({ error: 'Олдсонгүй', code: 'NOT_FOUND' }, 404) };
  if (anc.target.mimeType === FOLDER_MIME) {
    return { ok: false, response: c.json({ error: 'Энэ id нь хавтас байна', code: 'IS_FOLDER' }, 400) };
  }
  const entry = await driveBrowseGet(c.env, fileId);
  return { ok: true, entry, path: [{ id: 'root', name: root.project_name }, ...anc.path.slice(1)], rootId };
}

// GET /projects/:id/drive/files/:fileId
clientDrive.get('/projects/:id/drive/files/:fileId', async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  const fileId = c.req.param('fileId');
  try {
    const file = await loadVisibleFile(c, access.root, fileId);
    if (!file.ok) return file.response;
    const plan = previewPlan(file.entry);
    return c.json({
      item: clientItem(file.entry),
      path: file.path,
      preview: plan.kind,
      export_limit_bytes: plan.kind === 'google' ? DRIVE_EXPORT_MAX_BYTES : null,
    });
  } catch (err) {
    return driveErrorResponse(c, err, `client file project=${id} file=${fileId}`);
  }
});

// GET /projects/:id/drive/files/:fileId/content?download=1
clientDrive.get('/projects/:id/drive/files/:fileId/content', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  const fileId = c.req.param('fileId');
  const download = c.req.query('download') === '1';
  try {
    const file = await loadVisibleFile(c, access.root, fileId);
    if (!file.ok) return file.response;
    const res = await serveDriveContent(c, file.entry, download);
    if (res.ok && access.isClient) {
      const user = c.get('user');
      c.executionCtx.waitUntil(
        logClientDriveAccess(c.env.DB, {
          project_id: id,
          org_id: access.orgId,
          user_id: user.sub,
          drive_item_id: file.entry.id,
          via_item_id: file.rootId,
          item_name: file.entry.name,
          action: download ? 'download' : 'view',
        }),
      );
    }
    return res;
  } catch (err) {
    return driveErrorResponse(c, err, `client content project=${id} file=${fileId}`);
  }
});

// GET /projects/:id/drive/files/:fileId/thumbnail
clientDrive.get('/projects/:id/drive/files/:fileId/thumbnail', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  const fileId = c.req.param('fileId');
  try {
    const file = await loadVisibleFile(c, access.root, fileId);
    if (!file.ok) return file.response;
    return await serveDriveThumbnail(c, file.entry);
  } catch (err) {
    return driveErrorResponse(c, err, `client thumbnail project=${id} file=${fileId}`);
  }
});

/* ------------------------------------------------------------------ */
/*  Байршуулах — ЗӨВХӨН 09 хавтас + дэд мод (2026-09-21)               */
/* ------------------------------------------------------------------ */

type WriteTarget =
  | { ok: true; rootId: string; folderId: string }
  | { ok: false; response: Response };

/**
 * Бичих үйлдлийн хаалт — UI-д итгэхгүй, сервер бүрэн шийднэ:
 *   1. зөвхөн `client` role (ажилтны «захиалагчийн нүдээр» горим уншихаас хэтрэхгүй);
 *   2. эрхийн түвшин `contributor`+ (`viewer` → 403 `UPLOAD_NOT_ALLOWED`);
 *   3. 09 хавтас Drive-д байна (үгүй → 409 `UPLOAD_FOLDER_MISSING`);
 *   4. зорилтот хавтас төслийн дотор (үгүй → 404) БА 09-ийн дотор (үгүй → 403).
 */
async function resolveWriteTarget(c: AppContext, access: Extract<Access, { ok: true }>, raw: string): Promise<WriteTarget> {
  if (!access.isClient) {
    return {
      ok: false,
      response: c.json({ error: 'Ажилтан төслийн өөрийн замаар байршуулна', code: 'FORBIDDEN' }, 403),
    };
  }
  if (!access.canUpload) {
    return {
      ok: false,
      response: c.json({ error: 'Танд материал байршуулах эрх алга (зөвхөн харах)', code: 'UPLOAD_NOT_ALLOWED' }, 403),
    };
  }
  const folder = await loadVisibleFolder(c, access.root, raw);
  if (!folder.ok) return folder;
  const up = await findClientUploadFolder(c.env, folder.rootId);
  if (!up) {
    return {
      ok: false,
      response: c.json(
        { error: 'Төслийн хавтсанд «09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ» хавтас олдсонгүй', code: 'UPLOAD_FOLDER_MISSING' },
        409,
      ),
    };
  }
  if (!uploadAllowedOnPath(folder.path, up.id)) {
    return {
      ok: false,
      response: c.json(
        { error: `Захиалагч зөвхөн «${up.name}» хавтсанд байршуулна`, code: 'UPLOAD_NOT_ALLOWED', upload_folder: { id: up.id, name: up.name } },
        403,
      ),
    };
  }
  return { ok: true, rootId: folder.rootId, folderId: folder.folderId };
}

// POST /projects/:id/drive/folders/:folderId/folders — { name, reuse? }  (09 дотор л)
clientDrive.post('/projects/:id/drive/folders/:folderId/folders', async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  const body = await c.req.json<unknown>().catch(() => ({}));
  try {
    const target = await resolveWriteTarget(c, access, c.req.param('folderId'));
    if (!target.ok) return target.response;
    return await createSubfolderIn(c, { rootId: target.rootId, folderId: target.folderId, body, label: `client project=${id}` });
  } catch (err) {
    return driveErrorResponse(c, err, `client mkdir project=${id}`);
  }
});

// POST /projects/:id/drive/folders/:folderId/uploads — { name, mime, size, on_conflict? }  (09 дотор л)
clientDrive.post('/projects/:id/drive/folders/:folderId/uploads', async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  const body = await c.req.json<unknown>().catch(() => ({}));
  try {
    const target = await resolveWriteTarget(c, access, c.req.param('folderId'));
    if (!target.ok) return target.response;
    return await startUploadIn(c, {
      rootId: target.rootId,
      folderId: target.folderId,
      userId: c.get('user').sub,
      body,
      label: `client project=${id}`,
    });
  } catch (err) {
    return driveErrorResponse(c, err, `client upload-start project=${id}`);
  }
});

// PUT /projects/:id/drive/uploads?offset=N  (X-Upload-Token, түүхий биет)
// Тикет үндэс + хэрэглэгчээр баригдсан; дээр нь ЭНЭ chunk-д ч зорилтот хавтас
// 09-ийн дотор хэвээр эсэхийг тулгана (ancestry/жагсаалтын кэш — Drive дуудлага ховор).
clientDrive.put('/projects/:id/drive/uploads', async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  const t = await readUploadTicket(c, access.root.folder_id);
  if (!t.ok) return t.response;
  try {
    const target = await resolveWriteTarget(c, access, t.ticket.parent);
    if (!target.ok) return target.response;
    return await putUploadChunkFor(c, t.ticket, `client project=${id}`);
  } catch (err) {
    return driveErrorResponse(c, err, `client upload-chunk project=${id}`);
  }
});

// DELETE /projects/:id/drive/uploads (X-Upload-Token) — хагас байршуулалтыг цуцална.
clientDrive.delete('/projects/:id/drive/uploads', async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  const access = await assertClientDriveAccess(c, id);
  if (!access.ok) return access.response;
  if (!access.isClient) return c.json({ error: 'Access denied', code: 'FORBIDDEN' }, 403);
  const t = await readUploadTicket(c, access.root.folder_id);
  if (!t.ok) return t.response;
  return cancelUploadFor(c, t.ticket);
});

export default clientDrive;
