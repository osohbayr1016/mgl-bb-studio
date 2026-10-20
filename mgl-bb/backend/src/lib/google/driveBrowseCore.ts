/**
 * `driveBrowse.ts`-ийн СҮЛЖЭЭГҮЙ хэсэг: тогтмолууд, алдааны төрөл, Google-ийн
 * алдааг ангилах, SA-ийн хаягийг унших, мета өгөгдлийн хэлбэр.
 *
 * Тусдаа файл байгаа шалтгаан: `googleAuth.ts` нь `node --test`-ийн strip-only
 * TypeScript горимд ачаалагддаггүй хэлбэр (параметрийн шинж чанар) хэрэглэдэг
 * тул түүнийг импортлодог модулийг тестлэх боломжгүй.  Энд байгаа бүхэн
 * цэвэр — `projectDrive.test.ts` шууд импортлодог.
 */
import type { Env } from '../../types';

/** Drive-ын хавтас гэдгийг заах MIME. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
/** Drive-ын товчлол — зорилтот файл руу заана, өөрөө агуулгагүй. */
export const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
/** Google-ийн өөрийн форматын угтвар (Docs/Sheets/Slides/…). */
export const GOOGLE_APPS_PREFIX = 'application/vnd.google-apps.';

/** Drive-ын экспортын хатуу хязгаар — түүнээс том Google Doc-ыг PDF болгож
 *  гаргаж ЧАДАХГҮЙ (403 exportSizeLimitExceeded). */
export const DRIVE_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/*  Алдаанууд — route нь `code`-оор HTTP статус + хэрэглэгчийн мессеж   */
/*  сонгоно; техникийн дэлгэрэнгүй нь ЗӨВХӨН логт.                       */
/* ------------------------------------------------------------------ */

export type DriveBrowseErrorCode =
  /** GOOGLE_SA_JSON алга / хүчингүй — байршуулалтын тохиргоо. */
  | 'NOT_CONFIGURED'
  /** Google нь SA-ийн токеныг хүлээж аваагүй, эсвэл Drive API тэр Cloud
   *  төсөл дээр асаагүй (`accessNotConfigured`). */
  | 'AUTH_CONFIG'
  /** Хавтас/файл байхгүй эсвэл SA-д огт харагдахгүй (Drive нь хуваалцаагүй
   *  зүйлийг ч 404 гэж хариулдаг). */
  | 'NOT_FOUND'
  /** SA-д энэ зүйлийг унших эрх байхгүй. */
  | 'PERMISSION_DENIED'
  /** Google-ийн квот/хурдны хязгаар. */
  | 'RATE_LIMITED'
  /** Google Doc нь 10 MB-ийн экспортын хязгаараас том. */
  | 'EXPORT_TOO_LARGE'
  /** Drive-ын 5xx / сүлжээ. */
  | 'UNAVAILABLE'
  /** Файл ҮҮСГЭХЭД Google «Service Accounts do not have storage quota»
   *  (`storageQuotaExceeded`) — хавтас My Drive-д байна, Shared Drive биш.
   *  Тохиргооны алдаа: хавтсыг Хамтын диск рүү зөөх л шийдэл. */
  | 'SA_NO_QUOTA'
  /** Хавтас My Drive-д тул SA эзний нэрээр бичих ёстой (domain-wide delegation),
   *  гэвч Google Admin Console-д тэр эрх олгогдоогүй (`unauthorized_client`). */
  | 'DELEGATION_REQUIRED';

export class DriveBrowseError extends Error {
  readonly code: DriveBrowseErrorCode;
  /** Google-ийн HTTP статус (сүлжээний алдаанд 0). */
  readonly status: number;
  /** Google-ийн `errors[0].reason` — логт л хэрэгтэй. */
  readonly reason: string;
  // ⚠️ Параметрийн шинж чанар (`constructor(readonly x)`) ЗОРИУДААР БИШ:
  // `node --test` нь TypeScript-ийг зөвхөн ХУУЛЖ ажиллуулдаг тул тэр хэлбэрийг
  // ачаалж чаддаггүй — `projectDrive.test.ts` энэ файлыг импортлодог.
  constructor(code: DriveBrowseErrorCode, status: number, reason: string, detail: string) {
    super(detail);
    this.name = 'DriveBrowseError';
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

/** Google-ийн алдааны биетийг задалж, манай `code`-руу буулгана.
 *  Экспорт хийгдсэн нь тестлэхэд (`projectDrive.test.ts`). */
export function classifyDriveFailure(status: number, body: string): DriveBrowseError {
  let reason = '';
  let message = '';
  try {
    const j = JSON.parse(body) as {
      error?: { message?: string; errors?: { reason?: string; message?: string }[] };
    };
    reason = j.error?.errors?.[0]?.reason ?? '';
    message = j.error?.message ?? j.error?.errors?.[0]?.message ?? '';
  } catch {
    message = body;
  }
  const detail = `Drive ${status}${reason ? ` (${reason})` : ''}: ${message.slice(0, 300)}`;

  let code: DriveBrowseErrorCode;
  if (status === 404) code = 'NOT_FOUND';
  else if (status === 401) code = 'AUTH_CONFIG';
  else if (status === 429) code = 'RATE_LIMITED';
  else if (status === 403) {
    if (reason === 'exportSizeLimitExceeded') code = 'EXPORT_TOO_LARGE';
    // `quotaExceeded` regex-ээс ӨМНӨ: storageQuotaExceeded нь хурдны хязгаар биш.
    else if (reason === 'storageQuotaExceeded') code = 'SA_NO_QUOTA';
    else if (reason === 'accessNotConfigured' || reason === 'dailyLimitExceededUnreg') {
      code = 'AUTH_CONFIG';
    } else if (/rateLimitExceeded|quotaExceeded/i.test(reason)) code = 'RATE_LIMITED';
    else code = 'PERMISSION_DENIED';
  } else if (status >= 500 || status === 0) code = 'UNAVAILABLE';
  else code = 'UNAVAILABLE';
  return new DriveBrowseError(code, status, reason, detail);
}

/* ------------------------------------------------------------------ */
/*  Тохиргоо                                                           */
/* ------------------------------------------------------------------ */

/** Drive хавтсыг ЭНЭ хаягтай хуваалцана.  Нууц БИШ — SA-ийн JSON-ы
 *  `client_email` талбар; админы тохиргооны дэлгэцэд харуулна.
 *  Тохируулаагүй бол null. */
export function driveBrowseServiceEmail(env: Env): string | null {
  if (!env.GOOGLE_SA_JSON) return null;
  try {
    const parsed = JSON.parse(env.GOOGLE_SA_JSON) as { client_email?: unknown };
    return typeof parsed.client_email === 'string' && parsed.client_email.includes('@')
      ? parsed.client_email
      : null;
  } catch {
    return null;
  }
}

export function driveBrowseConfigured(env: Env): boolean {
  return driveBrowseServiceEmail(env) !== null;
}

/* ------------------------------------------------------------------ */
/*  Мета өгөгдлийн хэлбэр                                              */
/* ------------------------------------------------------------------ */

/** `files.get` / `files.list`-ээс АВДАГ талбарууд — `fields=` нь ЯГ энэ
 *  жагсаалт.  Шинэ талбар хэрэгтэй бол хоёуланг нь хамт өргөтгө. */
export interface DriveEntry {
  id: string;
  name: string;
  mimeType: string;
  /** RFC 3339. */
  modifiedTime?: string;
  /** Байтаар, мөр хэлбэрээр (Drive нь int64-ийг string гэж буцаадаг).
   *  Google-ийн өөрийн форматын файлд байхгүй. */
  size?: string;
  parents?: string[];
  trashed?: boolean;
  /** Drive UI / Google засварлагч руу нээх холбоос — «Эх файлыг нээх». */
  webViewLink?: string;
  /** Google-ийн 16px дүрсний холбоос (нийтийн CDN, нэвтрэлт шаардахгүй). */
  iconLink?: string;
  hasThumbnail?: boolean;
  /** Богино хугацаанд хүчинтэй, Authorization толгойгоор л нээгдэнэ. */
  thumbnailLink?: string;
  /** Shared Drive-ын id — My Drive-ын файлд байхгүй. */
  driveId?: string;
  shortcutDetails?: { targetId?: string; targetMimeType?: string };
  /* ---- Зөвхөн SYNC_FIELDS-ээр (driveBrowse.ts, хувилбарын түүх) ---- */
  /** Энгийн файлын агуулгын шинжүүр; Google форматад байхгүй. */
  md5Checksum?: string;
  /** Drive-ын өөрийн монотон хувилбарын тоолуур (мета өөрчлөгдөхөд ч өснө). */
  version?: string;
  /** Сүүлд засварласан Google хэрэглэгч — холбоосоор орсон нэргүй хүнд байхгүй. */
  lastModifyingUser?: { displayName?: string; emailAddress?: string };
}

export interface DriveListPage {
  files: DriveEntry[];
  nextPageToken: string | null;
}
