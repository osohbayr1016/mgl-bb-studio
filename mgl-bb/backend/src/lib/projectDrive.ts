/**
 * Төслийн баримт бичиг — Google Drive нь ЭХ СУРВАЛЖ (2026-09-10).
 *
 * Энэ модуль нь `routes/projectDrive.ts` (HTTP)-ийн ЦЭВЭР (сүлжээгүй)
 * төслийн түвшний логик:
 *
 *   • хавтасны id-г URL-аас ялгах (админ Drive-ын холбоосыг шууд наадаг);
 *   • төслийн үндэс хавтсыг D1-ээс унших;
 *   • файл бүрийг ЯАЖ урьдчилан харуулахыг шийдэх төлөвлөгөө (§6);
 *   • Drive-ын түүхий мөрийг хөтөч рүү явах хэлбэрт буулгах.
 *
 * Drive рүү дуудлага хийдэг хэсэг (эрхийн ancestry шалгалт, жагсаалтын
 * богино кэш) нь `projectDriveAccess.ts`-д — тэр нь `googleAuth.ts`-ийг
 * татдаг тул `node --test`-д ачаалагддаггүй; энэ файл нь `projectDrive.test.ts`-д
 * шууд импортлогддог.
 *
 * Drive-ын мета өгөгдлийг D1-д ХУУЛДАГГҮЙ.
 */
import {
  FOLDER_MIME,
  GOOGLE_APPS_PREFIX,
  SHORTCUT_MIME,
  type DriveEntry,
} from './google/driveBrowseCore';

/* ------------------------------------------------------------------ */
/*  Хавтасны id — админы оруулсан утгаас                               */
/* ------------------------------------------------------------------ */

/** Drive-ын id: base64url үсэг, доод тал нь 10 тэмдэгт.  Shared Drive-ын
 *  үндэс `0A…` гэж 19 тэмдэгт, энгийн хавтас 28-33 тэмдэгт. */
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,}$/;

/**
 * Түүхий id ЭСВЭЛ Drive-ын дурын хэлбэрийн холбоосоос хавтасны id-г ялгана.
 * Танигдахгүй бол null.  Хадгалагдах нь ҮРГЭЛЖ id — URL биш (§1).
 *
 *   https://drive.google.com/drive/folders/1AbC…?usp=sharing
 *   https://drive.google.com/drive/u/0/folders/1AbC…
 *   https://drive.google.com/open?id=1AbC…
 *   https://drive.google.com/drive/folders/0AKx…  (Shared Drive-ын үндэс)
 */
export function parseDriveFolderInput(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (DRIVE_ID_RE.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/i.test(url.hostname)) return null;
  const fromPath = url.pathname.match(/\/folders\/([A-Za-z0-9_-]{10,})/);
  if (fromPath?.[1]) return fromPath[1];
  const fromQuery = url.searchParams.get('id');
  if (fromQuery && DRIVE_ID_RE.test(fromQuery)) return fromQuery;
  return null;
}

/* ------------------------------------------------------------------ */
/*  Төслийн үндэс хавтас                                               */
/* ------------------------------------------------------------------ */

/**
 * Ямар нэг Drive-тай зүйлийн (ангиллын төсөл ЭСВЭЛ үндсэн төсөл) үндэс хавтас.
 *
 * `scope` = 'project' бол `project_id` нь `projects.id`; 'main' бол
 * `main_projects.id`.  `folder_scope` нь хавтас ХААНААС ирснийг хэлнэ:
 * ангиллын төсөлд үндсэн төслийн хавтас байвал ТЭР давамгайлна (эзний
 * 2026-09-11-ний шийдвэр — баримт бичиг нь бодит төслийнх, ангиллынх биш),
 * эс бөгөөс өөрийн `projects.google_drive_folder_id`.
 */
export interface ProjectDriveRoot {
  scope: 'project' | 'main';
  project_id: number;
  project_name: string;
  folder_id: string | null;
  folder_name: string | null;
  folder_scope: 'main' | 'project' | null;
  /** Ангиллын төслийн харьяалагдах үндсэн төсөл (байвал). */
  main_project_id: number | null;
  main_project_name: string | null;
}

export async function loadProjectDriveRoot(
  db: D1Database,
  projectId: number,
): Promise<ProjectDriveRoot | null> {
  const row = await db
    .prepare(
      `SELECT p.id, p.name, p.google_drive_folder_id, p.google_drive_folder_name,
              p.main_project_id, m.name AS main_name,
              m.google_drive_folder_id AS main_folder_id,
              m.google_drive_folder_name AS main_folder_name
         FROM projects p
         LEFT JOIN main_projects m ON m.id = p.main_project_id
        WHERE p.id = ?`,
    )
    .bind(projectId)
    .first<{
      id: number;
      name: string;
      google_drive_folder_id: string | null;
      google_drive_folder_name: string | null;
      main_project_id: number | null;
      main_name: string | null;
      main_folder_id: string | null;
      main_folder_name: string | null;
    }>();
  if (!row) return null;
  const mainFolder = row.main_folder_id?.trim() || null;
  const ownFolder = row.google_drive_folder_id?.trim() || null;
  return {
    scope: 'project',
    project_id: row.id,
    project_name: row.name,
    folder_id: mainFolder ?? ownFolder,
    folder_name: mainFolder ? row.main_folder_name : ownFolder ? row.google_drive_folder_name : null,
    folder_scope: mainFolder ? 'main' : ownFolder ? 'project' : null,
    main_project_id: row.main_project_id,
    main_project_name: row.main_name,
  };
}

/** Үндсэн төслийн үндэс хавтас — `/api/main-projects/:id/drive/*`. */
export async function loadMainProjectDriveRoot(
  db: D1Database,
  mainId: number,
): Promise<ProjectDriveRoot | null> {
  const row = await db
    .prepare(`SELECT id, name, google_drive_folder_id, google_drive_folder_name FROM main_projects WHERE id = ?`)
    .bind(mainId)
    .first<{
      id: number;
      name: string;
      google_drive_folder_id: string | null;
      google_drive_folder_name: string | null;
    }>();
  if (!row) return null;
  const folder = row.google_drive_folder_id?.trim() || null;
  return {
    scope: 'main',
    project_id: row.id,
    project_name: row.name,
    folder_id: folder,
    folder_name: folder ? row.google_drive_folder_name : null,
    folder_scope: folder ? 'main' : null,
    main_project_id: row.id,
    main_project_name: row.name,
  };
}

/* ------------------------------------------------------------------ */
/*  Урьдчилан харах төлөвлөгөө                                         */
/* ------------------------------------------------------------------ */

/**
 * Хөтөч дээр ЯАЖ харуулах вэ:
 *   pdf       — эх байтыг blob: iframe-д (Chrome-ийн PDF үзүүлэгч);
 *   image     — эх байтыг <img>-д;
 *   video     — эх байтыг <video>-д (хөтөч тоглуулж чаддаг mp4/webm);
 *   text      — эх байтыг <pre>-д (жижиг текст/CSV/JSON);
 *   google    — Docs/Sheets/Slides/Drawings-ыг Drive-аар PDF болгож
 *               ЭКСПОРТОЛЖ (хуулбар үүсгэхгүй) blob: iframe-д;
 *   docx      — эх байтыг ХӨТӨЧ ДЭЭР render хийнэ (`docx-preview`) — Drive-ын
 *               нэг хуудасны зураг «хангалтгүй» гэсэн эзний 2026-09-11-ний
 *               гомдлын хариу; хуулбар, Google хөрвүүлэлт ХЭРЭГГҮЙ;
 *   xlsx      — эх байтыг хөтөч дээр `exceljs`-ээр уншиж хүснэгтээр харуулна;
 *   thumbnail — Drive-ын үүсгэсэн эхний хуудасны зураг (PowerPoint, хуучин
 *               .doc/.xls г.м. хөтөч render хийж чаддаггүй төрөл) + «Эх файлыг нээх»;
 *   none      — зөвхөн «Эх файлыг нээх» / татах.
 */
export type DrivePreviewKind =
  | 'pdf'
  | 'image'
  | 'video'
  | 'text'
  | 'google'
  | 'docx'
  | 'xlsx'
  | 'thumbnail'
  | 'none';

export interface DrivePreviewPlan {
  kind: DrivePreviewKind;
  /** `google` төрөлд Drive-аас экспортлох MIME. */
  exportMime?: string;
  /** Урсгалаар дамжуулах агуулгын MIME (хөтөчид өгөх Content-Type). */
  contentType?: string;
}

/** SVG-г ЗОРИУДААР зураг гэж үзэхгүй — скрипт агуулж чаддаг (архивын
 *  модультай ижил бодлого). */
const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif',
]);
/** Хөтөч бүр (Chrome/Edge/Firefox) тоглуулж чаддаг видео контейнерүүд.  `.mov`
 *  (video/quicktime) ЗОРИУД алга — codec-оос хамаарч тоглохгүй байж болно. */
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm']);
const TEXT_MIMES = new Set(['text/plain', 'text/csv', 'text/markdown', 'application/json']);

/**
 * Өргөтгөл → MIME.  Drive файлын MIME-ийг ихэвчлэн зөв өгдөг, гэвч ERP-ээс
 * байршуулсан файлд хөтөч `File.type`-оо ХООСОН өгвөл (Windows дээр чирж
 * тавих, хавтас байршуулах үед элбэг) Drive-д `application/octet-stream`
 * гэж бичигддэг — тэр файл дараа нь хэзээ ч урьдчилан харагдахгүй байв.
 * Тиймээс ерөнхий MIME-тэй файлыг НЭРЭЭР нь таньж, байршуулахад ч
 * (`projectDriveUpload.ts normalizeUploadMime`) ижил хүснэгтийг хэрэглэнэ.
 * Зөвхөн урьдчилан харах/дүрсэнд нөлөөлдөг өргөтгөлүүд — бүх MIME-ийн
 * бүртгэл БИШ.
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
  json: 'application/json',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  dwg: 'image/vnd.dwg',
  dxf: 'image/vnd.dxf',
};

/** Ерөнхий (мэдээлэлгүй) MIME — нэрээр нь тодруулах шаардлагатай. */
const GENERIC_MIMES = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/unknown']);

/** Файлын нэрийн өргөтгөлөөс MIME; танигдахгүй бол null. */
export function mimeFromFileName(name: string | undefined | null): string | null {
  if (!name) return null;
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  if (!m) return null;
  return MIME_BY_EXTENSION[m[1]!.toLowerCase()] ?? null;
}

/**
 * Урьдчилан харахад ХЭРЭГЛЭХ MIME: Drive-ын өгсөн MIME тодорхой бол тэр,
 * ерөнхий (octet-stream) бол нэрээр нь таньсан нь, эс бөгөөс Drive-ынх хэвээр.
 */
export function effectiveMime(mimeType: string, name?: string | null): string {
  const mime = (mimeType ?? '').trim().toLowerCase();
  if (!GENERIC_MIMES.has(mime)) return mime;
  return mimeFromFileName(name) ?? mime;
}
/** PDF болгож экспортолж болох Google форматууд. */
const GOOGLE_EXPORTABLE = new Set([
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
]);

/** Текст урьдчилан харахын тааз — түүнээс том текстийг хөтөчид уншуулахгүй. */
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** Хөтөч дээр render хийх Office файлын тааз — .docx/.xlsx-ийг бүтнээр нь
 *  татаж задалдаг тул хэт томыг Drive-ын зураг руу буулгана.
 *  ⚠️ 2026-09-21 хүртэл 40 MB байсан — гэтэл компанийн ЖИНХЭНЭ Word файлууд
 *  (зурагтай ЗХ/гүйцэтгэлийн тайлан) прод дээр 47–110 MB тул яг тэдгээр нь
 *  render хийгдэлгүй нэг хуудасны зураг руу унаж байв.  Хэмжсэн: 110 MB,
 *  120 зурагтай .docx нь docx-preview-д ~1 с, JS heap ~225 MB — хөтөч дааж
 *  байна; хязгаарлагч нь татах хугацаа, тиймээс UI явцын хувь харуулна. */
export const OFFICE_RENDER_MAX_BYTES = 150 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Эх байтаар харах (PDF/зураг/видео) тааз — урсгалаар явдаг ч хөтөч дээр
 *  хэдэн зуун MB-ийн файлыг «урьдчилан харах» нь утгагүй.  Прод дээрх
 *  хамгийн том PDF 157 MB (2026-09-21) тул 200 MB. */
export const INLINE_PREVIEW_MAX_BYTES = 200 * 1024 * 1024;

export function previewPlan(
  entry: Pick<DriveEntry, 'mimeType' | 'size' | 'hasThumbnail'> & Partial<Pick<DriveEntry, 'name'>>,
): DrivePreviewPlan {
  if (entry.mimeType === FOLDER_MIME || entry.mimeType === SHORTCUT_MIME) return { kind: 'none' };
  // Drive `application/octet-stream` гэсэн .docx/.pdf-ийг нэрээр нь таньж
  // render хийнэ — Content-Type ч энэ тодруулсан MIME-ээр явна.
  const mime = effectiveMime(entry.mimeType, entry.name);
  const size = entry.size ? Number(entry.size) : 0;
  if (GOOGLE_EXPORTABLE.has(mime)) {
    return { kind: 'google', exportMime: 'application/pdf', contentType: 'application/pdf' };
  }
  if (mime.startsWith(GOOGLE_APPS_PREFIX)) return { kind: 'none' };
  if (mime === 'application/pdf') {
    return size > INLINE_PREVIEW_MAX_BYTES ? { kind: 'none' } : { kind: 'pdf', contentType: mime };
  }
  if (IMAGE_MIMES.has(mime)) {
    return size > INLINE_PREVIEW_MAX_BYTES ? { kind: 'none' } : { kind: 'image', contentType: mime };
  }
  if (VIDEO_MIMES.has(mime)) {
    return size > INLINE_PREVIEW_MAX_BYTES ? { kind: 'none' } : { kind: 'video', contentType: mime };
  }
  if (TEXT_MIMES.has(mime)) {
    return size > TEXT_PREVIEW_MAX_BYTES
      ? { kind: 'none' }
      : { kind: 'text', contentType: `${mime}; charset=utf-8` };
  }
  if ((mime === DOCX_MIME || mime === XLSX_MIME) && size <= OFFICE_RENDER_MAX_BYTES) {
    return { kind: mime === DOCX_MIME ? 'docx' : 'xlsx', contentType: mime };
  }
  if (entry.hasThumbnail) return { kind: 'thumbnail' };
  return { kind: 'none' };
}

/* ------------------------------------------------------------------ */
/*  API-д буцаах хэлбэр                                                */
/* ------------------------------------------------------------------ */

/** Хөтөч рүү явах нэг мөр — Drive-ын түүхий мөрөөс ЗӨВХӨН хэрэгтэйг нь. */
export interface ProjectDriveItem {
  id: string;
  name: string;
  kind: 'folder' | 'file' | 'shortcut';
  mime_type: string;
  modified_time: string | null;
  size: number | null;
  /** Drive UI / Google засварлагч — «Эх файлыг нээх». */
  open_url: string | null;
  icon_url: string | null;
  preview: DrivePreviewKind;
  /** Товчлолын зорилтот төрөл — UI дүрсэнд. */
  shortcut_target_mime?: string;
}

export function toProjectDriveItem(entry: DriveEntry): ProjectDriveItem {
  const kind =
    entry.mimeType === FOLDER_MIME ? 'folder' : entry.mimeType === SHORTCUT_MIME ? 'shortcut' : 'file';
  const item: ProjectDriveItem = {
    id: entry.id,
    name: entry.name,
    kind,
    mime_type: entry.mimeType,
    modified_time: entry.modifiedTime ?? null,
    size: entry.size ? Number(entry.size) : null,
    open_url: entry.webViewLink ?? null,
    icon_url: entry.iconLink ?? null,
    preview: kind === 'file' ? previewPlan(entry).kind : 'none',
  };
  if (kind === 'shortcut' && entry.shortcutDetails?.targetMimeType) {
    item.shortcut_target_mime = entry.shortcutDetails.targetMimeType;
  }
  return item;
}
