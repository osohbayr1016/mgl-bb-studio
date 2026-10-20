/**
 * Төслийн баримт бичиг — Google Drive нь эх сурвалж.
 * `backend/src/routes/projectDrive.ts`-ийн хариуны хэлбэрүүд (ИХЭР — хамт
 * өөрчлөгдөнө).  Drive-ын түүхий мөр энд ХЭЗЭЭ Ч ирдэггүй; сервер зөвхөн
 * хэрэгтэй талбаруудыг буулгаж өгдөг (`toProjectDriveItem`).
 */

/** Сервер файл бүрийг ЯАЖ харуулахыг шийддэг (`lib/projectDrive.ts previewPlan`). */
export type DrivePreviewKind =
  | 'pdf'
  | 'image'
  /** mp4/webm — эх байтыг `<video>`-д (blob:). */
  | 'video'
  | 'text'
  | 'google'
  /** .docx — эх байтыг хөтөч дээр `docx-preview`-ээр render хийнэ. */
  | 'docx'
  /** .xlsx — эх байтыг хөтөч дээр `exceljs`-ээр уншиж хүснэгтээр. */
  | 'xlsx'
  | 'thumbnail'
  | 'none';

export interface DriveItem {
  id: string;
  name: string;
  kind: 'folder' | 'file' | 'shortcut';
  mime_type: string;
  /** RFC 3339 эсвэл null. */
  modified_time: string | null;
  /** Байт; Google-ийн өөрийн форматын файлд null. */
  size: number | null;
  /** Drive UI / Google засварлагч — «Эх файлыг нээх». */
  open_url: string | null;
  icon_url: string | null;
  preview: DrivePreviewKind;
  shortcut_target_mime?: string;
}

export interface DrivePathNode {
  id: string;
  name: string;
}

/**
 * Drive-тай зүйлийн төрөл: `project` = ангиллын төсөл (`/api/projects/:id/drive`),
 * `main` = үндсэн төсөл (`/api/main-projects/:id/drive`, migration 0281),
 * `client` = ЗАХИАЛАГЧИЙН портал (`/api/client/projects/:id/drive`, migration 0327;
 * 2026-09-21-ээс төслийн хавтас БҮХЭЛДЭЭ view-only, `open_url` үргэлж null,
 * байршуулах ЗӨВХӨН «09» хавтас + дэд мод — `can_upload`).
 * Эхний хоёр нь серверийн ИЖИЛ handler-ууд; гурав дахь нь өөр эрхийн дүрэмтэй
 * тусдаа router, гэхдээ хариуны хэлбэр ижил тул ижил компонентууд ажиллана.
 */
export type DriveScope = 'project' | 'main' | 'client';

/** `GET /{projects|main-projects}/:id/drive` — Drive руу дуудалгүй, тохиргооны төлөв. */
export interface DriveStatus {
  project_name: string;
  /** Зөвхөн `client` scope (2026-09-21): захиалагчийн байршуулах хавтас — үндэсний
   *  доорх «09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ»; Drive-д байхгүй/олдоогүй бол null. */
  upload_folder?: { id: string; name: string } | null;
  /** Зөвхөн `client` scope: энэ хэрэглэгч байршуулах ЭРХИЙН ТҮВШИНТЭЙ юу
   *  (`contributor`/`approver`); аль хавтсанд болохыг хуудас бүрийн `can_upload` хэлнэ. */
  can_upload?: boolean;
  /** Байршуулалтад service account тохируулагдсан эсэх. */
  configured: boolean;
  /** Хавтас холбогдсон эсэх (ангиллын төсөлд үндсэн төслийнх ч байж болно). */
  linked: boolean;
  folder_id: string | null;
  folder_name: string | null;
  /** Хавтас хаанаас: 'main' (үндсэн төсөл) | 'project' (өөрийнх) | null. */
  folder_scope: 'main' | 'project' | null;
  /** Ангиллын төслийн үндсэн төсөл (байвал) — холбоос тэнд очно. */
  main_project_id: number | null;
  main_project_name: string | null;
  /** Зөвхөн админд — хавтсыг хуваалцах хаяг. */
  service_email: string | null;
}

/** `GET /main-projects` — үндсэн төслүүд + гишүүн ангиллын төслүүд. */
export interface MainProjectMember {
  id: number;
  name: string;
  display_title: string | null;
  category: string | null;
  status: string;
  is_pending: number | null;
  own_folder_id: string | null;
}

export interface MainProject {
  id: number;
  code: string | null;
  name: string;
  folder_id: string | null;
  folder_name: string | null;
  /** Үндсэн төсөл ERP-д бүртгэгдсэн огноо — кодгүй үед жагсаалтын «Огноо» баганын нөөц. */
  created_at: string;
  updated_at: string;
  members: MainProjectMember[];
}

export interface MainProjectsResponse {
  configured: boolean;
  main_projects: MainProject[];
  /** Үндсэн төсөлгүй ч өөрийн Drive хавтастай ангиллын төслүүд. */
  standalone: MainProjectMember[];
  /** Зөвхөн админд — үндсэн төсөлд харьяалагдаагүй төслүүд. */
  unassigned: MainProjectMember[] | null;
}

/** `GET /projects/:id/drive/folders/:folderId` — нэг хуудас. */
export interface DriveFolderPage {
  root: DrivePathNode;
  folder: DrivePathNode & { open_url: string | null };
  /** Үндэснээс энэ хавтас хүртэл (хоёулаа орно) — breadcrumb. */
  path: DrivePathNode[];
  items: DriveItem[];
  next_page_token: string | null;
  cached: boolean;
  fetched_at: string;
  /** Зөвхөн `client` scope: ЭНЭ хавтсанд захиалагч байршуулж болно (09 + дэд мод, эрхтэй). */
  can_upload?: boolean;
}

/** `GET /projects/:id/drive/files/:fileId`. */
export interface DriveFileDetail {
  item: DriveItem;
  path: DrivePathNode[];
  preview: DrivePreviewKind;
  export_limit_bytes: number | null;
}

/** `PUT /projects/:id/drive-folder`. */
export interface DriveLinkResult {
  folder_id: string | null;
  folder_name: string | null;
  open_url: string | null;
}

/* ---- Хувилбарын түүх (миграц 0300, lib/projectDriveVersions.ts) ---------- */

export type DriveChangeKind =
  | 'created'
  | 'modified'
  | 'renamed'
  | 'moved'
  | 'trashed'
  | 'untrashed'
  | 'deleted'
  | 'restored';

/** `GET …/drive/activity` ба `GET …/drive/files/:fileId/versions`-ийн нэг мөр. */
export interface DriveVersion {
  id: number;
  file_id: string;
  file_name: string;
  mime_type: string;
  parent_id: string | null;
  size: number | null;
  change_kind: DriveChangeKind;
  /** Drive-ын хэлсэн засварлагч (багийн акаунт); холбоосоор орсон нэргүй хүнд null. */
  modified_by: { name: string | null; email: string | null } | null;
  drive_modified_at: string | null;
  /** ERP-ийн хүн — зөвхөн `restored` мөрөнд. */
  restored_by: { id: number; name: string } | null;
  restored_from_version_id: number | null;
  /** ERP-ээс байршуулсан хүн (миграц 0325) — `created`/`modified` мөрөнд. */
  uploaded_by: { id: number; name: string } | null;
  /** Байт хуулбар байгаа (татаж болно). */
  has_snapshot: boolean;
  /** Энэ хувилбар руу Drive-ыг буцааж болно. */
  restorable: boolean;
  created_at: string;
}

export interface DriveActivityResponse {
  items: DriveVersion[];
  /** Хадгалагдсан гэж илэрсэн ч хараахан хуулбарлагдаагүй файлын тоо. */
  pending: number;
}

export type DriveAnyoneRole = 'reader' | 'commenter' | 'writer';

/** `GET/PUT …/drive/sharing` — үндэс хавтасны «холбоостой хэн ч» эрх. */
export interface DriveSharingState {
  anyone: DriveAnyoneRole | null;
  linked: boolean;
  open_url?: string;
}

/** Серверийн `code` талбар — `driveErrors.ts` орчуулга сонгоно. */
export type DriveErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH_CONFIG'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'EXPORT_TOO_LARGE'
  | 'UNAVAILABLE'
  | 'NOT_LINKED'
  | 'OUTSIDE_PROJECT'
  | 'INVALID_FOLDER'
  | 'NOT_A_FOLDER'
  | 'TRASHED'
  | 'NO_PREVIEW'
  | 'THUMBNAIL_ONLY'
  | 'FORBIDDEN'
  | 'PROJECT_NOT_FOUND'
  | 'VERSION_NOT_FOUND'
  | 'NO_SNAPSHOT'
  | 'SNAPSHOT_MISSING'
  | 'NOT_RESTORABLE'
  | 'NO_PARENT'
  /* ---- байршуулалт (2026-09-17) ---- */
  | 'SA_NO_QUOTA'
  | 'DELEGATION_REQUIRED'
  | 'INVALID_NAME'
  | 'EMPTY_FILE'
  | 'UPLOAD_TOO_LARGE'
  | 'UPLOAD_TOKEN_INVALID'
  | 'UPLOAD_SESSION_GONE'
  | 'BAD_OFFSET'
  | 'BAD_LENGTH'
  /* ---- нэр солих / зөөх (2026-09-18) ---- */
  | 'IS_ROOT'
  | 'MOVE_INTO_SELF'
  /* ---- захиалагчийн байршуулалт (2026-09-21, routes/clientDrive.ts) ---- */
  | 'UPLOAD_NOT_ALLOWED'
  | 'UPLOAD_FOLDER_MISSING'
  /* ---- Drive-ийн үндсэн хавтас (2026-09-24, routes/mainProjects.ts) ---- */
  | 'ROOT_IS_PROJECT_FOLDER'
  /* ---- «Эх файлыг нээх» — .docx-ийн шинэ хувилбар (2026-09-30) ---- */
  | 'STALE_FILE'
  | 'NOT_REVISABLE'
  | 'REVISION_TOO_LARGE'
  | 'BASE_REQUIRED';

/* ---- Drive-ийн үндсэн хавтас — шинэ төслийн хавтсыг автоматаар нэмэх ---- */

export interface DriveFolderRef {
  id: string;
  name: string;
}

/** `GET|PUT /main-projects/drive-root`, `POST …/sync`, `DELETE …/ignored/:id`. */
export interface DriveRootState {
  configured: boolean;
  service_email: string | null;
  root: (DriveFolderRef & { open_url: string }) | null;
  /** Админ устгасан / салгасан — автоматаар дахин нэмэгдэхгүй хавтсууд. */
  ignored: DriveFolderRef[];
  /** Сүүлд шинэ төсөл нэмсэн / алдаа гарсан үе (тик бүрийг бичдэггүй). */
  last: { at: string; created: string[]; error: string | null } | null;
  /** Зөвхөн PUT/sync/restore-ийн хариунд — яг одоо нэмэгдсэн хавтсууд. */
  created?: DriveFolderRef[];
}

/* ---- Байршуулах (lib/projectDriveUpload.ts, 2026-09-17) ------------------ */

/** Ижил нэртэй файл байвал: `replace` = түүний шинэ хувилбар, `keep` = хажууд нь шинэ файл. */
export type DriveUploadConflict = 'replace' | 'keep';

/** `POST …/drive/folders/:folderId/uploads`. */
export interface DriveUploadStart {
  /** Гарын үсэгтэй тикет — `X-Upload-Token` толгойгоор chunk бүрд явна; Google-ийн session URI дотор нь нуугдсан. */
  upload_token: string;
  chunk_bytes: number;
  /** Солигдох файл (шинэ хувилбар болно), эсвэл null. */
  replacing: { id: string; name: string } | null;
}

/** `PUT …/drive/uploads?offset=N`. */
export type DriveUploadChunkResult = { done: false; received: number } | { done: true; item: DriveItem };

/** `POST …/drive/folders/:folderId/folders`. */
export interface DriveCreateFolderResult {
  item: DriveItem;
  /** false = ижил нэртэй хавтас аль хэдийн байсан, түүнийг буцаав. */
  created: boolean;
}

/** `GET /projects/drive/linked` — «Төслийн баримт бичиг» хуудасны жагсаалт. */
export interface DriveLinkedProject {
  id: number;
  name: string;
  display_title: string | null;
  category: string | null;
  status: string;
  is_pending: number | null;
  updated_at: string;
  folder_id: string;
  folder_name: string | null;
}

export interface DriveLinkedProjectsResponse {
  configured: boolean;
  projects: DriveLinkedProject[];
  /** Зөвхөн админд — хараахан холбоогүй төслүүд (хуудаснаас шууд холбоход). */
  unlinked: { id: number; name: string; display_title: string | null }[] | null;
}

/* ---- Чирж зөөх (2026-09-18) --------------------------------------------- */

/** Жагсаалтын мөрийг чирэхэд `dataTransfer`-т тавих төрөл — гаднаас (`Files`) ирсэн
 *  чирэлтээс ялгана. */
export const DRIVE_DRAG_MIME = 'application/x-mgl-drive-item';

export interface DriveDragPayload {
  id: string;
  name: string;
  kind: DriveItem['kind'];
}
