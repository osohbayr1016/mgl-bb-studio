/**
 * Төслийн Drive баримт — API давхарга.  Бүх дуудлага манай Worker руу
 * (`/api/projects/:id/drive/...` эсвэл `/api/main-projects/:id/drive/...`);
 * Google-ийн нууц, токен хөтөчид ХЭЗЭЭ Ч ирдэггүй — Drive-тай ярьдаг нь
 * зөвхөн сервер.
 *
 * `scope` (types.ts `DriveScope`): 'project' = ангиллын төсөл, 'main' = үндсэн
 * төсөл (migration 0281).  Серверийн handler-ууд ижил тул зөвхөн угтвар солигдоно.
 */
import { ApiError, ApiNetworkError, apiFetch, apiFetchBlob } from '@/shared/api/client';
import { resolveApiHost } from '@/shared/api/apiHost';
import type {
  DriveActivityResponse,
  DriveAnyoneRole,
  DriveCreateFolderResult,
  DriveFileDetail,
  DriveItem,
  DriveFolderPage,
  DriveLinkResult,
  DriveRootState,
  DriveScope,
  DriveSharingState,
  DriveStatus,
  DriveUploadChunkResult,
  DriveUploadConflict,
  DriveUploadStart,
  DriveVersion,
  MainProject,
  MainProjectsResponse,
} from './types';

/* ---- Угтвар ---------------------------------------------------------- */

export function driveBase(scope: DriveScope, id: number): string {
  if (scope === 'main') return `/main-projects/${id}`;
  if (scope === 'client') return `/client/projects/${id}`;
  return `/projects/${id}`;
}

/* ---- Query түлхүүрүүд ------------------------------------------------ */

export const driveStatusKey = (scope: DriveScope, id: number) =>
  ['project-drive', scope, id, 'status'] as const;
export const driveFolderKey = (scope: DriveScope, id: number, folderId: string) =>
  ['project-drive', scope, id, 'folder', folderId] as const;
export const driveActivityKey = (scope: DriveScope, id: number) =>
  ['project-drive', scope, id, 'activity'] as const;
export const driveVersionsKey = (scope: DriveScope, id: number, fileId: string) =>
  ['project-drive', scope, id, 'versions', fileId] as const;
export const driveSharingKey = (scope: DriveScope, id: number) =>
  ['project-drive', scope, id, 'sharing'] as const;
/** Documents хуудасны жагсаалт (`GET /main-projects`) — холбох/салгах/бүлэглэхэд
 *  `['project-drive']` угтвараар хамт хүчингүй болно. */
export const mainProjectsKey = ['project-drive', 'main-projects'] as const;

/* ---- Замууд ----------------------------------------------------------- */

export const driveStatusPath = (scope: DriveScope, id: number) => `${driveBase(scope, id)}/drive`;

export function driveFolderPath(
  scope: DriveScope,
  id: number,
  folderId: string,
  opts: { pageToken?: string | null; refresh?: boolean } = {},
): string {
  const q = new URLSearchParams();
  if (opts.pageToken) q.set('page_token', opts.pageToken);
  if (opts.refresh) q.set('refresh', '1');
  const qs = q.toString();
  return `${driveBase(scope, id)}/drive/folders/${encodeURIComponent(folderId)}${qs ? `?${qs}` : ''}`;
}

export const driveFilePath = (scope: DriveScope, id: number, fileId: string) =>
  `${driveBase(scope, id)}/drive/files/${encodeURIComponent(fileId)}`;

/* ---- Үзэх ------------------------------------------------------------- */

export function fetchDriveFolder(
  scope: DriveScope,
  id: number,
  folderId: string,
  opts: { pageToken?: string | null; refresh?: boolean } = {},
): Promise<DriveFolderPage> {
  // Drive-ын нэг хуудас нь хүйтэн worker + Google-ийн хариуг хамтад нь
  // авахад 12 сек-ийн өгөгдмөлөөс удаан байж болно.
  return apiFetch<DriveFolderPage>(driveFolderPath(scope, id, folderId, opts), { timeoutMs: 30_000 });
}

export function fetchDriveFile(scope: DriveScope, id: number, fileId: string): Promise<DriveFileDetail> {
  return apiFetch<DriveFileDetail>(driveFilePath(scope, id, fileId), { timeoutMs: 30_000 });
}

/** Урьдчилан харах байтууд (PDF / зураг / текст / Office / Google → PDF).  Blob-оор
 *  авдаг нь заавал: cross-origin isolation дор HTTP хаягаар ачаалсан PDF
 *  iframe ажилладаггүй — `blob:` л ажиллана (AttachmentPreviews.tsx). */
export function fetchDrivePreviewBlob(
  scope: DriveScope,
  id: number,
  fileId: string,
  onProgress?: (loaded: number, total: number | null) => void,
): Promise<Blob> {
  // `onProgress` — 100 MB-ийн тайланг татахад эргэлдэгчийн оронд хувь харуулна.
  return apiFetchBlob(`${driveFilePath(scope, id, fileId)}/content`, { onProgress });
}

export function fetchDriveThumbnailBlob(scope: DriveScope, id: number, fileId: string): Promise<Blob> {
  return apiFetchBlob(`${driveFilePath(scope, id, fileId)}/thumbnail`);
}

/** Татах — bearer толгойтой fetch + object URL (downloadPdf-тэй ижил шалтгаан:
 *  API нь өөр origin дээр тул `<a href>` толгой явуулж чадахгүй). */
export async function downloadDriveFile(
  scope: DriveScope,
  id: number,
  fileId: string,
  fallbackName: string,
): Promise<void> {
  const blob = await apiFetchBlob(`${driveFilePath(scope, id, fileId)}/content?download=1`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function fetchDriveStatus(scope: DriveScope, id: number): Promise<DriveStatus> {
  return apiFetch<DriveStatus>(driveStatusPath(scope, id));
}

/** Админ: хавтас холбох (`folder` = id эсвэл Drive холбоос) / салгах (null).
 *  Ангиллын төсөл дээр дуудахад сервер үндсэн төсөлтэй бол ТҮҮНД бичнэ (`scope` хариу). */
export function setDriveFolder(
  scope: DriveScope,
  id: number,
  folder: string | null,
): Promise<DriveLinkResult & { scope: 'main' | 'project' }> {
  return apiFetch(`${driveBase(scope, id)}/drive-folder`, {
    method: 'PUT',
    data: { folder },
    timeoutMs: 30_000,
  });
}

/* ---- Байршуулах (2026-09-17) ---------------------------------------- */

/** Дэд хавтас үүсгэх; `reuse` (өгөгдмөл true) — ижил нэртэй байвал түүнийг буцаана. */
export function createDriveFolder(
  scope: DriveScope,
  id: number,
  parentId: string,
  name: string,
  opts: { reuse?: boolean } = {},
): Promise<DriveCreateFolderResult> {
  return apiFetch<DriveCreateFolderResult>(`${driveFolderPath(scope, id, parentId)}/folders`, {
    method: 'POST',
    data: { name, reuse: opts.reuse ?? true },
    timeoutMs: 30_000,
  });
}

/** Google resumable session нээж тикет авна — байт энд явахгүй. */
export function startDriveUpload(
  scope: DriveScope,
  id: number,
  parentId: string,
  file: { name: string; mime: string; size: number },
  onConflict: DriveUploadConflict,
): Promise<DriveUploadStart> {
  return apiFetch<DriveUploadStart>(`${driveFolderPath(scope, id, parentId)}/uploads`, {
    method: 'POST',
    data: { name: file.name, mime: file.mime, size: file.size, on_conflict: onConflict },
    timeoutMs: 30_000,
  });
}

/**
 * «Эх файлыг нээх»: ИЖИЛ .docx-ийн шинэ хувилбарын session (2026-09-30, шинэ файл үүсгэхгүй).
 * `base_modified_time` — засвар хийхээр татсан үеийн `modified_time`; хооронд нь өөрчлөгдсөн бол
 * сервер 409 `STALE_FILE`.  Байт нь `putDriveChunk`-ээр (ердийн байршуулалтын ижил зам).
 */
export function startDriveRevision(
  scope: DriveScope,
  id: number,
  fileId: string,
  body: { size: number; base_modified_time: string },
): Promise<Pick<DriveUploadStart, 'upload_token' | 'chunk_bytes'>> {
  return apiFetch(`${driveFilePath(scope, id, fileId)}/revision`, {
    method: 'POST',
    data: body,
    timeoutMs: 30_000,
  });
}

/**
 * Нэг chunk — XHR (fetch нь upload явцыг өгдөггүй; `uploadLargeFile`-тэй
 * ижил шалтгаан).  Токен/бүртгэл `client.ts`-ийн upload-уудтай адил
 * (`localStorage.auth_token` + credentials).  Алдааг серверийн `code`-той
 * `ApiError` болгож `describeDriveError` уншихуйц шиднэ.
 */
export function putDriveChunk(
  scope: DriveScope,
  id: number,
  uploadToken: string,
  offset: number,
  chunk: Blob,
  opts: { onProgress?: (loaded: number) => void; signal?: AbortSignal } = {},
): Promise<DriveUploadChunkResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${resolveApiHost()}/api${driveBase(scope, id)}/drive/uploads?offset=${offset}`);
    xhr.withCredentials = true;
    const token = localStorage.getItem('auth_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('X-Upload-Token', uploadToken);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded);
    };
    const onAbort = () => {
      xhr.abort();
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.onload = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        /* JSON биш хариу — доор статусаар шийднэ */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload as unknown as DriveUploadChunkResult);
      } else {
        reject(new ApiError(xhr.status, typeof payload.error === 'string' ? payload.error : `HTTP ${xhr.status}`, payload));
      }
    };
    xhr.onerror = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new ApiNetworkError('Network error during upload', 1, false));
    };
    xhr.onabort = () => {
      opts.signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('aborted', 'AbortError'));
    };
    xhr.send(chunk);
  });
}

/** Хагас байршуулалтыг цуцлах — сайн санааны, алдаа залгина. */
export async function cancelDriveUpload(scope: DriveScope, id: number, uploadToken: string): Promise<void> {
  try {
    await apiFetch(`${driveBase(scope, id)}/drive/uploads`, {
      method: 'DELETE',
      headers: { 'X-Upload-Token': uploadToken },
      timeoutMs: 10_000,
    });
  } catch {
    /* Google 7 хоногт өөрөө хаяна */
  }
}

/* ---- Нэр солих / зөөх (2026-09-18) ----------------------------------- */

export function renameDriveItem(scope: DriveScope, id: number, fileId: string, name: string): Promise<{ item: DriveItem }> {
  return apiFetch<{ item: DriveItem }>(driveFilePath(scope, id, fileId), { method: 'PATCH', data: { name }, timeoutMs: 30_000 });
}

/** `parentId` = 'root' эсвэл хавтасны id.  Ижил хавтас руу → `moved:false`. */
export function moveDriveItem(
  scope: DriveScope,
  id: number,
  fileId: string,
  parentId: string,
): Promise<{ item: DriveItem | null; moved: boolean }> {
  return apiFetch(`${driveFilePath(scope, id, fileId)}/move`, { method: 'POST', data: { parent_id: parentId }, timeoutMs: 30_000 });
}

/* ---- Хувилбарын түүх (миграц 0300) ---------------------------------- */

/** Үндэс хавтасны сүүлийн өөрчлөлтүүд — ledger, Drive руу дуудахгүй. */
export function fetchDriveActivity(scope: DriveScope, id: number, limit = 100): Promise<DriveActivityResponse> {
  return apiFetch<DriveActivityResponse>(`${driveBase(scope, id)}/drive/activity?limit=${limit}`);
}

export function fetchDriveVersions(scope: DriveScope, id: number, fileId: string): Promise<{ items: DriveVersion[] }> {
  return apiFetch<{ items: DriveVersion[] }>(`${driveFilePath(scope, id, fileId)}/versions`);
}

/** Хувилбарын хуулбарыг (R2) татах — `downloadDriveFile`-тэй ижил object URL зам. */
export async function downloadDriveVersion(
  scope: DriveScope,
  id: number,
  versionId: number,
  fallbackName: string,
): Promise<void> {
  const blob = await apiFetchBlob(`${driveBase(scope, id)}/drive/versions/${versionId}/content`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Drive-ыг энэ хувилбар руу буцаана — Drive шинэ хувилбар үүсгэнэ, юу ч устахгүй. */
export function restoreDriveVersion(
  scope: DriveScope,
  id: number,
  versionId: number,
): Promise<{ version: DriveVersion }> {
  return apiFetch(`${driveBase(scope, id)}/drive/versions/${versionId}/restore`, {
    method: 'POST',
    data: {},
    // Хуулбарыг R2-оос Drive руу дамжуулах — том файлд удаан.
    timeoutMs: 120_000,
  });
}

/** Админ: одоо байгаа файл бүрийн эхний хуулбарыг дараалалд (сонсогч зөвхөн
 *  ирээдүйн өөрчлөлтийг өгдөг). */
export function enqueueDriveBaseline(
  scope: DriveScope,
  id: number,
): Promise<{ files: number; folders: number; truncated: boolean }> {
  return apiFetch(`${driveBase(scope, id)}/drive/baseline`, { method: 'POST', data: {}, timeoutMs: 60_000 });
}

/* ---- «Холбоостой хэн ч» эрх (админ) ---------------------------------- */

export function fetchDriveSharing(scope: DriveScope, id: number): Promise<DriveSharingState> {
  return apiFetch<DriveSharingState>(`${driveBase(scope, id)}/drive/sharing`, { timeoutMs: 30_000 });
}

export function setDriveSharing(
  scope: DriveScope,
  id: number,
  anyone: DriveAnyoneRole | null,
): Promise<DriveSharingState> {
  return apiFetch<DriveSharingState>(`${driveBase(scope, id)}/drive/sharing`, {
    method: 'PUT',
    data: { anyone },
    timeoutMs: 30_000,
  });
}

/* ---- Үндсэн төсөл ----------------------------------------------------- */

export const MAIN_PROJECTS_PATH = '/main-projects';

export function fetchMainProjects(): Promise<MainProjectsResponse> {
  return apiFetch<MainProjectsResponse>(MAIN_PROJECTS_PATH);
}

export function createMainProject(data: {
  name: string;
  code?: string | null;
  project_ids?: number[];
}): Promise<Pick<MainProject, 'id' | 'code' | 'name'>> {
  return apiFetch(MAIN_PROJECTS_PATH, { method: 'POST', data });
}

export function updateMainProject(
  id: number,
  data: { name?: string; code?: string | null; project_ids?: number[] },
): Promise<{ message: string }> {
  return apiFetch(`${MAIN_PROJECTS_PATH}/${id}`, { method: 'PUT', data });
}

export function deleteMainProject(id: number): Promise<{ message: string }> {
  return apiFetch(`${MAIN_PROJECTS_PATH}/${id}`, { method: 'DELETE' });
}

export function assignMainProject(projectId: number, mainProjectId: number | null): Promise<unknown> {
  return apiFetch(`${MAIN_PROJECTS_PATH}/assign`, {
    method: 'PUT',
    data: { project_id: projectId, main_project_id: mainProjectId },
  });
}

export function autoGroupMainProjects(): Promise<{ created: number; assigned: number; created_names: string[] }> {
  return apiFetch(`${MAIN_PROJECTS_PATH}/auto-group`, { method: 'POST', data: {} });
}

/* ---- Drive-ийн үндсэн хавтас (шинэ хавтсыг автоматаар нэмэх) ---------- */

/** `project-drive` угтвартай — `DriveFolderForm`-ийн ерөнхий invalidate үүнийг ч шинэчилнэ. */
export const driveRootKey = ['project-drive', 'drive-root'] as const;

export function fetchDriveRoot(): Promise<DriveRootState> {
  return apiFetch<DriveRootState>(`${MAIN_PROJECTS_PATH}/drive-root`);
}

/** Холбоод сервер тэр даруй илрүүлнэ (Drive-ийг уншдаг тул урт хугацаа). */
export function setDriveRoot(folder: string | null): Promise<DriveRootState> {
  return apiFetch<DriveRootState>(`${MAIN_PROJECTS_PATH}/drive-root`, {
    method: 'PUT',
    data: { folder },
    timeoutMs: 60_000,
  });
}

export function syncDriveRoot(): Promise<DriveRootState> {
  return apiFetch<DriveRootState>(`${MAIN_PROJECTS_PATH}/drive-root/sync`, { method: 'POST', data: {}, timeoutMs: 60_000 });
}

export function restoreIgnoredDriveFolder(folderId: string): Promise<DriveRootState> {
  return apiFetch<DriveRootState>(`${MAIN_PROJECTS_PATH}/drive-root/ignored/${encodeURIComponent(folderId)}`, {
    method: 'DELETE',
    timeoutMs: 60_000,
  });
}
