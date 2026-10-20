/**
 * Google Drive v3 — ЗӨВХӨН УНШИХ клиент, төслийн баримт бичгийг Drive-аас
 * шууд харуулахад (routes/projectDrive.ts, lib/projectDrive.ts).
 *
 * ТОКЕН: service account ӨӨРИЙНХӨӨ нэрээр, `drive.readonly` scope-той.
 * Компанийн Drive хавтсыг (эсвэл Shared Drive-ыг) тэр SA-ийн `client_email`
 * хаягтай «Үзэгч» эрхээр хуваалцахад л хангалттай — Calendar-ын
 * `calendarAuth.ts`-тэй ЯГ ижил, продакшнд ажиллаж буй загвар.
 *
 * ⚠️ Яагаад `driveClient.ts`-ийн OAuth токен БИШ вэ:
 *   • тэр токен `drive.file` scope-той — зөвхөн ЭНЭ АПП-ЫН ҮҮСГЭСЭН файлыг
 *     хардаг тул компанийн хавтсыг огт нээж чадахгүй;
 *   • түүнийг `drive.readonly` болгож өргөтгөвөл Gmail-ийн зөвшөөрлийн
 *     дэлгэцэд «restricted» scope орж, мөн тэр хайрцгийн БҮХ Drive-ыг
 *     (хуваалцаагүй хавтсыг ч) аппд нээнэ — хамгийн бага эрхийн зарчмын
 *     эсрэг.
 *   • ажилтан бүр Google акаунтгүй (баг тус бүр нэг @mglenc.com), тиймээс
 *     «хэрэглэгч бүрийн өөрийн Google эрх» гэсэн загвар энд утгагүй —
 *     хэн юу харахыг ERP-ийн эрх шийднэ, Drive биш.
 * ⚠️ Яагаад domain-wide delegation БИШ вэ: энэ байгууллагад ХЭЗЭЭ Ч
 *   тохируулагдаж байгаагүй (CLAUDE.md, 2026-09-07-ны хэмжилт).  SA нь
 *   ӨӨРӨӨ уншдаг тул DWD огт хэрэггүй.
 *
 * УНШИХ зам (жагсаалт, мета, байт, экспорт, Changes) нь `drive.readonly`
 * scope-той хэвээр.  Бичих үйлдлүүд тусдаа `drive` scope-той токеноор
 * (`DRIVE_WRITE_SCOPE`):
 *   • хувилбар СЭРГЭЭХ — R2 дахь хуулбарыг `files.update`-ээр буцааж ачаалах
 *     (`routes/projectDrive.ts` restore, `lib/projectDriveSync.ts`) — 2026-09-15;
 *   • хавтасны «холбоостой хэн ч» эрхийг асаах/унтраах (`permissions`) — 2026-09-15;
 *   • ERP-ээс файл/хавтас БАЙРШУУЛАХ — resumable upload session + хавтас
 *     үүсгэх (`routes/projectDrive.ts` uploads, `lib/projectDriveUpload.ts`) —
 *     2026-09-17, эзний шийдвэр: «Drive нээлгүй системээсээ оруулна».
 * Бүгдэд нь хавтас SA-д «Засварлагч» эрхээр хуваалцагдсан байх ёстой —
 * «Үзэгч» бол Google 403 өгнө (PERMISSION_DENIED болж админд харагдана).
 * ⚠️ Файл ҮҮСГЭХ нь үүсгэгчийг ЭЗЭМШИГЧ болгодог.  SA өөрийнхөө нэрээр
 *   My Drive хавтсанд файл үүсгэвэл Google «Service Accounts do not have
 *   storage quota» (403 storageQuotaExceeded) өгдөг — 2026-09-18-нд прод
 *   дээр ХЭМЖИГДСЭН (төслийн хавтсууд Shared drive БИШ, багийн акаунтын
 *   My Drive-д; «холбоостой хэн ч засварлана» тохиргоо үүнд нөлөөгүй).
 *   Google-ийн хоёр л шийдэл: Shared drive, эсвэл domain-wide delegation.
 *   Тиймээс бичих үйлдэл бүр `driveWriteIdentity(root)`-оор шийднэ:
 *     • хавтас Shared drive-д (`driveId` бий) → SA өөрөө (`subject` үгүй);
 *     • My Drive-д → хавтасны ЭЗНИЙ (`owners[0].emailAddress`) нэрээр
 *       (`mintServiceAccountToken` `subject`, DWD — Admin Console-д SA-ийн
 *       client ID-д `drive` scope олгосон байх ёстой; олгоогүй бол Google
 *       `unauthorized_client` → `DELEGATION_REQUIRED`, админд яг заавар).
 *   Эзний нэрээр үүссэн файл нь багийн акаунтын өмч, «хэн засав» ч зөв.
 *   `SA_NO_QUOTA` нь одоо зөвхөн эзэн нь домэйны гадна (gmail) үед л гарна.
 * Sync-ийн сонсогч, жагсаалт, харах бүгд УНШИХ scope-оороо л явна.
 */
import type { Env } from '../../types';
import { mintServiceAccountToken } from './googleAuth';
import {
  DriveBrowseError,
  FOLDER_MIME,
  classifyDriveFailure,
  driveBrowseConfigured,
  type DriveEntry,
  type DriveListPage,
} from './driveBrowseCore';

// Цэвэр хэсгийг (тогтмол, алдаа, ангилал, SA хаяг, төрөл) нэг цэгээс дахин экспортолно.
export * from './driveBrowseCore';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

/** Зөвхөн унших.  `drive.readonly` нь `files.list/get/export` + `alt=media`-г
 *  бүрэн зөвшөөрдөг; permissions/бичих API-г хаадаг. */
export const DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
/** Бичих — ЗӨВХӨН сэргээх (`files.update/create`), хогийн савнаас буцаах,
 *  хавтасны холбоосын эрх (`permissions`).  Уншилтад ХЭЗЭЭ Ч ашиглахгүй. */
export const DRIVE_WRITE_SCOPE = 'https://www.googleapis.com/auth/drive';

async function driveToken(env: Env, scope: string = DRIVE_READONLY_SCOPE, subject?: string): Promise<string> {
  if (!driveBrowseConfigured(env)) {
    throw new DriveBrowseError(
      'NOT_CONFIGURED',
      0,
      '',
      'GOOGLE_SA_JSON secret is not set or has no client_email',
    );
  }
  try {
    return await mintServiceAccountToken(env, subject ? { scope, subject } : { scope });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'service account token failed';
    // Эзний нэрээр (DWD) токен авахад Google `unauthorized_client` → Admin
    // Console-д SA-ийн client ID-д энэ scope олгогдоогүй.  Тохиргооны алдаа,
    // SA-ийн түлхүүрийн алдаа БИШ — тусдаа код, админд яг заавар очно.
    if (subject && /unauthorized_client/i.test(msg)) {
      throw new DriveBrowseError('DELEGATION_REQUIRED', 401, 'unauthorized_client', `DWD not granted for subject ${subject}: ${msg}`);
    }
    // Токен олгох алдаа = SA-ийн түлхүүр буруу / цуцлагдсан.  Мессежид
    // нууц ОРДОГГҮЙ (googleAuth нь зөвхөн статус + Google-ийн текст бичдэг).
    throw new DriveBrowseError('AUTH_CONFIG', 0, 'token', msg);
  }
}

/** SA JSON-ы `client_id` — Admin Console-ын DWD заавар админд харуулахад.
 *  Нууц биш (OAuth client id); байхгүй бол null. */
export function driveServiceClientId(env: Env): string | null {
  try {
    const j = JSON.parse(env.GOOGLE_SA_JSON ?? '') as { client_id?: string };
    return typeof j.client_id === 'string' && j.client_id ? j.client_id : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Мета өгөгдлийн хэлбэр                                              */
/* ------------------------------------------------------------------ */

const ENTRY_FIELDS =
  'id,name,mimeType,modifiedTime,size,parents,trashed,webViewLink,iconLink,hasThumbnail,thumbnailLink,driveId,shortcutDetails';

/** Хамгийн бага талбарууд — эцэг рүү дээшлэх (ancestry) алхамд. */
const PARENT_FIELDS = 'id,name,mimeType,parents,trashed,driveId,webViewLink';

/** Drive-ын нэг хуудсанд авах дээд тоо.  Google-ийн тааз 1000; 200 нь
 *  хавтас бүрийг нэг дуудлагаар авахад хангалттай бөгөөд хариу нь хөнгөн. */
export const LIST_PAGE_SIZE = 200;

async function driveGet(
  env: Env,
  url: string,
  init: RequestInit = {},
  scope: string = DRIVE_READONLY_SCOPE,
  subject?: string,
): Promise<Response> {
  const token = await driveToken(env, scope, subject);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    throw new DriveBrowseError(
      'UNAVAILABLE',
      0,
      'network',
      err instanceof Error ? err.message : 'fetch failed',
    );
  }
  if (!res.ok) {
    throw classifyDriveFailure(res.status, await res.text());
  }
  return res;
}

/* ------------------------------------------------------------------ */
/*  Мета өгөгдөл унших                                                 */
/* ------------------------------------------------------------------ */

/** Нэг файл/хавтасны бүрэн мета.  Байхгүй/харагдахгүй бол NOT_FOUND шиднэ. */
export async function driveBrowseGet(env: Env, fileId: string): Promise<DriveEntry> {
  const res = await driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(ENTRY_FIELDS)}`,
  );
  return (await res.json()) as DriveEntry;
}

/** Зөвхөн эцэг/нэр — ancestry алхамд (хөнгөн хариу). */
export async function driveBrowseGetParents(
  env: Env,
  fileId: string,
): Promise<Pick<DriveEntry, 'id' | 'name' | 'mimeType' | 'parents' | 'trashed' | 'driveId' | 'webViewLink'>> {
  const res = await driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(PARENT_FIELDS)}`,
  );
  return (await res.json()) as DriveEntry;
}

/**
 * Хавтасны ШУУД хүүхдүүд — нэг хуудас.  Рекурс ХЭЗЭЭ Ч хийхгүй: зөвхөн
 * харж буй хавтсаа уншина (§11).  Хавтас эхэнд, дараа нь нэрээр (natural
 * sort — «Зураг 2» нь «Зураг 10»-аас өмнө).
 *
 * `includeItemsFromAllDrives` + `supportsAllDrives` — Shared Drive доторх
 * хавтас ч ижилхэн ажиллана.
 */
export async function driveBrowseList(
  env: Env,
  folderId: string,
  pageToken?: string | null,
): Promise<DriveListPage> {
  const params = new URLSearchParams({
    q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    orderBy: 'folder,name_natural',
    pageSize: String(LIST_PAGE_SIZE),
    fields: `nextPageToken,files(${ENTRY_FIELDS})`,
  });
  if (pageToken) params.set('pageToken', pageToken);
  const res = await driveGet(env, `${DRIVE_API}/files?${params.toString()}`);
  const data = (await res.json()) as { files?: DriveEntry[]; nextPageToken?: string };
  return { files: data.files ?? [], nextPageToken: data.nextPageToken ?? null };
}

/* ------------------------------------------------------------------ */
/*  Агуулга дамжуулах — ХЭЗЭЭ Ч хадгалахгүй, зөвхөн урсгалаар нэвтрүүлнэ */
/* ------------------------------------------------------------------ */

/** Файлын эх байтууд (`alt=media`).  Хариуг УРСГАЛААР буцаана — Worker-ийн
 *  санах ойд байтыг цуглуулахгүй (том PDF-д OOM болохгүй). */
export async function driveBrowseDownload(env: Env, fileId: string): Promise<Response> {
  return driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    // `identity`: Google gzip-лэвэл Workers fetch задалж өгдөг ч `content-length`
    // нь ШАХСАН хэмжээ хэвээр үлддэг — R2 руу FixedLengthStream-ээр хийхэд
    // (projectDriveSync.ts) урт зөрж алдаа өгнө.  Урьдчилан харахад ч ялгаагүй.
    { headers: { 'Accept-Encoding': 'identity' } },
  );
}

/** Google Doc/Sheet/Slide → өгсөн MIME (ихэвчлэн PDF).  10 MB-ийн хязгаар
 *  давбал `EXPORT_TOO_LARGE`. */
export async function driveBrowseExport(
  env: Env,
  fileId: string,
  mimeType: string,
): Promise<Response> {
  return driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}`,
  );
}

/**
 * Drive-ын үүсгэсэн эхний хуудасны зураг.  `thumbnailLink` нь хувийн файлд
 * Authorization толгой шаарддаг тул хөтөч рүү шууд өгч болохгүй — энд
 * SA-ийн токеноор татаж дамжуулна.  `=s220` төгсгөлийг том хэмжээ болгож
 * солино (Google-ийн зургийн URL-ын стандарт параметр).
 */
export async function driveBrowseThumbnail(
  env: Env,
  thumbnailLink: string,
  sizePx = 1600,
): Promise<Response> {
  const url = thumbnailLink.replace(/=s\d+(-[a-z]+)?$/i, `=s${sizePx}`);
  return driveGet(env, url);
}

/* ------------------------------------------------------------------ */
/*  Хувилбарын түүх — Changes API, sync мета (2026-09-15)              */
/* ------------------------------------------------------------------ */

/** Sync-д хэрэгтэй нэмэлт талбарууд: md5 (агуулгын шинжүүр), version,
 *  сүүлд засварласан хүн.  `ENTRY_FIELDS`-ээс ТУСДАА — жагсаалтын хариуг
 *  хүндрүүлэхгүй. */
const SYNC_FIELDS =
  'id,name,mimeType,modifiedTime,size,parents,trashed,md5Checksum,version,driveId,webViewLink,lastModifyingUser(displayName,emailAddress)';

export interface DriveChange {
  fileId: string;
  removed: boolean;
  time?: string;
  changeType?: string;
  file?: DriveEntry;
}

export interface DriveChangesPage {
  changes: DriveChange[];
  nextPageToken: string | null;
  newStartPageToken: string | null;
}

/** Сүүлийн мета — sync (md5, version, lastModifyingUser орсон). */
export async function driveBrowseGetSync(env: Env, fileId: string): Promise<DriveEntry> {
  const res = await driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(SYNC_FIELDS)}`,
  );
  return (await res.json()) as DriveEntry;
}

/** Changes API-ийн эхлэлийн токен — «энэ мөчөөс хойшхи өөрчлөлт». */
export async function driveChangesStartToken(env: Env): Promise<string> {
  const res = await driveGet(env, `${DRIVE_API}/changes/startPageToken?supportsAllDrives=true`);
  const data = (await res.json()) as { startPageToken?: string };
  if (!data.startPageToken) {
    throw new DriveBrowseError('UNAVAILABLE', 0, 'startPageToken', 'Drive returned no startPageToken');
  }
  return data.startPageToken;
}

/**
 * SA-д харагдах БҮХ файлын өөрчлөлтийн нэг хуудас (хуваалцсан хавтасных ч
 * орно).  `includeRemoved` — устгасан/хуваалцахаа больсон файл `removed: true`
 * гэж ирнэ.  Хуудасны төгсгөлд `newStartPageToken` (дараагийн тикийн эхлэл).
 */
export async function driveChangesList(env: Env, pageToken: string): Promise<DriveChangesPage> {
  const params = new URLSearchParams({
    pageToken,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    includeRemoved: 'true',
    pageSize: '500',
    fields: `nextPageToken,newStartPageToken,changes(fileId,removed,time,changeType,file(${SYNC_FIELDS}))`,
  });
  const res = await driveGet(env, `${DRIVE_API}/changes?${params.toString()}`);
  const data = (await res.json()) as {
    changes?: DriveChange[];
    nextPageToken?: string;
    newStartPageToken?: string;
  };
  return {
    changes: data.changes ?? [],
    nextPageToken: data.nextPageToken ?? null,
    newStartPageToken: data.newStartPageToken ?? null,
  };
}

/**
 * Changes API-ийн НӨӨЦ зам: SA-д харагдах, `since`-ээс хойш өөрчлөгдсөн файлууд
 * (шинэ нь эхэнд).  Хуваалцсан хавтасны файлд Changes мэдэгдэл хоцорч/алдагдаж
 * болзошгүй тул sync тик бүр үүнийг ч татаж дарааллаа дүүргэнэ (давхардал
 * `pending`-ийн PK-аар хаагдана).  Хавтас, хогийн сав дахь зүйл орохгүй.
 */
export async function driveListModifiedSince(
  env: Env,
  sinceIso: string,
  pageToken?: string | null,
): Promise<{ files: DriveEntry[]; nextPageToken: string | null }> {
  const params = new URLSearchParams({
    q: `modifiedTime > '${sinceIso.replace(/'/g, '')}' and trashed = false and mimeType != '${FOLDER_MIME}'`,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    orderBy: 'modifiedTime desc',
    pageSize: '200',
    fields: `nextPageToken,files(${SYNC_FIELDS})`,
  });
  if (pageToken) params.set('pageToken', pageToken);
  const res = await driveGet(env, `${DRIVE_API}/files?${params.toString()}`);
  const data = (await res.json()) as { files?: DriveEntry[]; nextPageToken?: string };
  return { files: data.files ?? [], nextPageToken: data.nextPageToken ?? null };
}

/* ------------------------------------------------------------------ */
/*  Бичих — зөвхөн сэргээх, хогийн сав, холбоосын эрх                 */
/* ------------------------------------------------------------------ */

const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/** Байтын эх: урттай урсгал (R2 объект) — `FixedLengthStream` нь fetch-д
 *  `Content-Length` тавьдаг, Google-ийн media upload үүнийг шаарддаг. */
export interface DriveUploadBody {
  stream: ReadableStream;
  length: number;
  mime: string;
}

function fixedLength(body: DriveUploadBody): ReadableStream {
  const { readable, writable } = new FixedLengthStream(body.length);
  void body.stream.pipeTo(writable).catch(() => {
    /* fetch талд алдаа гарна — энд залгихгүй */
  });
  return readable;
}

/**
 * Одоо байгаа файлын АГУУЛГЫГ солино (`files.update`, uploadType=media) —
 * Drive шинэ хувилбар үүсгэнэ, хуучин нь Drive-ын өөрийн түүхэнд үлдэнэ.
 * Google Doc-ыг docx-оор ачаалахад Drive импортолж дахин Doc болгодог.
 * Буцаах: шинэ мета (md5/version/modifiedTime — sync-ийн давхардлыг хаахад).
 */
export async function driveUpdateContent(env: Env, fileId: string, body: DriveUploadBody): Promise<DriveEntry> {
  const res = await driveGet(
    env,
    `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(fileId)}?uploadType=media&supportsAllDrives=true&fields=${encodeURIComponent(SYNC_FIELDS)}`,
    { method: 'PATCH', headers: { 'Content-Type': body.mime }, body: fixedLength(body) },
    DRIVE_WRITE_SCOPE,
  );
  return (await res.json()) as DriveEntry;
}

/** Бүрмөсөн устсан файлыг хуулбараас ШИНЭ файл болгон эцэг хавтсанд нь
 *  үүсгэнэ (multipart — мета + байт нэг хүсэлтэд).  Google форматын эх
 *  байвал `targetMime`-аар хөрвүүлнэ (docx → Google Doc). */
export async function driveCreateFromSnapshot(
  env: Env,
  opts: { name: string; parentId: string; body: DriveUploadBody; targetMime?: string },
): Promise<DriveEntry> {
  const boundary = `mgl${Math.random().toString(36).slice(2)}`;
  const meta: Record<string, unknown> = { name: opts.name, parents: [opts.parentId] };
  if (opts.targetMime) meta.mimeType = opts.targetMime;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${opts.body.mime}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const enc = new TextEncoder();
  const headBytes = enc.encode(head);
  const tailBytes = enc.encode(tail);
  const total = headBytes.byteLength + opts.body.length + tailBytes.byteLength;
  const { readable, writable } = new FixedLengthStream(total);
  void (async () => {
    try {
      const w = writable.getWriter();
      await w.write(headBytes);
      w.releaseLock();
      await opts.body.stream.pipeTo(writable, { preventClose: true });
      const w2 = writable.getWriter();
      await w2.write(tailBytes);
      await w2.close();
    } catch {
      /* fetch талд алдаа гарна */
    }
  })();
  const res = await driveGet(
    env,
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent(SYNC_FIELDS)}`,
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: readable },
    DRIVE_WRITE_SCOPE,
  );
  return (await res.json()) as DriveEntry;
}

/** Хогийн савнаас буцаана (эсвэл хийнэ). */
export async function driveSetTrashed(env: Env, fileId: string, trashed: boolean): Promise<DriveEntry> {
  const res = await driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(SYNC_FIELDS)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed }) },
    DRIVE_WRITE_SCOPE,
  );
  return (await res.json()) as DriveEntry;
}

/** «Холбоостой хэн ч» эрхийн төлөв: null = байхгүй; 'reader' | 'commenter' |
 *  'writer'.  Drive-ын `anyone` төрлийн эрхийн id нь `anyoneWithLink`
 *  (allowFileDiscovery=false) эсвэл `anyone` (хайлтад ил). */
export type DriveAnyoneRole = 'reader' | 'commenter' | 'writer';

export async function driveGetAnyonePermission(env: Env, fileId: string): Promise<DriveAnyoneRole | null> {
  const res = await driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&fields=${encodeURIComponent('permissions(id,type,role)')}`,
  );
  const data = (await res.json()) as { permissions?: { id: string; type: string; role: string }[] };
  const anyone = (data.permissions ?? []).find((p) => p.type === 'anyone');
  if (!anyone) return null;
  return anyone.role === 'writer' || anyone.role === 'commenter' || anyone.role === 'reader'
    ? anyone.role
    : 'reader';
}

/**
 * Хавтас (эсвэл файл) дээрх «холбоостой хэн ч» эрхийг тавина/устгана.
 * Хавтас дээр тавьсан эрх бүх хүүхдэд ӨВЛӨГДӨНӨ — төслийн үндэс хавтас дээр
 * нэг удаа тавихад л хангалттай.  SA нь тэр хавтас дээр «Засварлагч» байх
 * ёстой (Google-ийн sharing эрх), эс бөгөөс PERMISSION_DENIED.
 */
export async function driveSetAnyonePermission(
  env: Env,
  fileId: string,
  role: DriveAnyoneRole | null,
): Promise<DriveAnyoneRole | null> {
  const current = await driveGetAnyonePermission(env, fileId);
  if (current === role) return role;
  const base = `${DRIVE_API}/files/${encodeURIComponent(fileId)}/permissions`;
  if (current !== null) {
    // Google нь `anyone` эрхийн id-г тогтмол өгдөг; хоёуланг нь оролдоно.
    for (const pid of ['anyoneWithLink', 'anyone']) {
      try {
        await driveGet(env, `${base}/${pid}?supportsAllDrives=true`, { method: 'DELETE' }, DRIVE_WRITE_SCOPE);
        break;
      } catch (err) {
        if (!(err instanceof DriveBrowseError && err.code === 'NOT_FOUND')) throw err;
      }
    }
  }
  if (role === null) return null;
  await driveGet(
    env,
    `${base}?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role, allowFileDiscovery: false }),
    },
    DRIVE_WRITE_SCOPE,
  );
  return role;
}

/* ------------------------------------------------------------------ */
/*  Бичих identity — SA өөрөө (Shared drive) эсвэл эзний нэрээр (My Drive) */
/* ------------------------------------------------------------------ */

export interface DriveWriteIdentity {
  /** Токен авахад impersonate хийх хэрэглэгч; null = SA өөрөө. */
  subject: string | null;
  /** Үндэс хавтас Shared drive-д (`driveId` бий). */
  sharedDrive: boolean;
  ownerEmail: string | null;
}

const IDENTITY_TTL_MS = 5 * 60_000;
const identityCache = new Map<string, { at: number; v: DriveWriteIdentity }>();

/**
 * Үндэс хавтас ХААНА байгаагаас бичих identity-г шийднэ (файлын толгойн
 * тайлбарыг үз).  My Drive → эзний имэйл (`owners` нь Shared drive-ийн
 * файлд ирдэггүй — тэр нь өөрөө ялгуур).  5 мин кэш — хавтас бүрд нэг
 * `files.get`; хавтас зөөгдвөл 5 минутын дараа өөрөө шинэчлэгдэнэ.
 */
export async function driveWriteIdentity(env: Env, rootId: string): Promise<DriveWriteIdentity> {
  const now = Date.now();
  const hit = identityCache.get(rootId);
  if (hit && now - hit.at < IDENTITY_TTL_MS) return hit.v;
  const res = await driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(rootId)}?supportsAllDrives=true&fields=${encodeURIComponent('id,driveId,owners(emailAddress)')}`,
  );
  const data = (await res.json()) as { driveId?: string; owners?: { emailAddress?: string }[] };
  const ownerEmail = data.owners?.[0]?.emailAddress ?? null;
  const sharedDrive = Boolean(data.driveId);
  const v: DriveWriteIdentity = { subject: sharedDrive ? null : ownerEmail, sharedDrive, ownerEmail };
  identityCache.set(rootId, { at: now, v });
  return v;
}

/* ------------------------------------------------------------------ */
/*  Байршуулах — ERP-ээс файл/хавтас нэмэх (2026-09-17)                */
/* ------------------------------------------------------------------ */

/** Drive `q` мөрийн утга — `\` ба `'` л тусгай. */
function qEscape(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Байршуулалтын хариу: жагсаалтын мөр (`toProjectDriveItem`) + sync-ийн
 *  шинжүүрүүд (md5/version/modifiedTime — ledger-т шууд бичихэд).  Нэг
 *  дуудлагаар хоёуланг нь авна. */
const UPLOAD_FIELDS = `${ENTRY_FIELDS},md5Checksum,version,lastModifyingUser(displayName,emailAddress)`;

/**
 * Хавтасны ШУУД хүүхдүүдээс нэрээр нэгийг олно (хогийн сав орохгүй).  Drive
 * ижил нэртэй файлыг зөвшөөрдөг тул хэд байвал хамгийн сүүлд өөрчлөгдсөнийг
 * авна — «солих» гэдэг нь тэр файлын ШИНЭ ХУВИЛБАР болно.
 */
export async function driveFindChildByName(
  env: Env,
  parentId: string,
  name: string,
  kind: 'folder' | 'file',
): Promise<DriveEntry | null> {
  const mimeClause = kind === 'folder' ? `mimeType = '${FOLDER_MIME}'` : `mimeType != '${FOLDER_MIME}'`;
  const params = new URLSearchParams({
    q: `'${qEscape(parentId)}' in parents and name = '${qEscape(name)}' and ${mimeClause} and trashed = false`,
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    corpora: 'allDrives',
    orderBy: 'modifiedTime desc',
    pageSize: '1',
    fields: `files(${ENTRY_FIELDS})`,
  });
  const res = await driveGet(env, `${DRIVE_API}/files?${params.toString()}`);
  const data = (await res.json()) as { files?: DriveEntry[] };
  return data.files?.[0] ?? null;
}

/** Дэд хавтас үүсгэнэ (Shared Drive-д ч).  Ижил нэртэйг ДАВХАР үүсгэхгүй байх
 *  нь дуудагчийн ажил (`driveFindChildByName` → `reuse`). */
export async function driveCreateFolder(
  env: Env,
  opts: { name: string; parentId: string; subject?: string | null },
): Promise<DriveEntry> {
  const res = await driveGet(
    env,
    `${DRIVE_API}/files?supportsAllDrives=true&fields=${encodeURIComponent(ENTRY_FIELDS)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: opts.name, mimeType: FOLDER_MIME, parents: [opts.parentId] }),
    },
    DRIVE_WRITE_SCOPE,
    opts.subject ?? undefined,
  );
  return (await res.json()) as DriveEntry;
}

/**
 * Resumable upload session эхлүүлнэ — Google `Location` толгойд session URI
 * өгнө; тэр URI руу дараагийн chunk-ууд Authorization-ГҮЙ явна (URI өөрөө
 * эрх — тиймээс хөтөч рүү ХЭЗЭЭ Ч ил өгөхгүй, `lib/projectDriveUpload.ts`
 * гарын үсэгтэй токенд нуугдана).  Session 7 хоног амьд.
 *
 * `existingFileId` өгвөл тэр файлын АГУУЛГЫГ солино (`files.update` — Drive
 * шинэ хувилбар үүсгэнэ, нэр/байрлал хэвээр); үгүй бол `parentId` дотор
 * ШИНЭ файл (`files.create`).  `fields` нь эцсийн хариунд л үйлчилнэ.
 */
export async function driveResumableStart(
  env: Env,
  opts: {
    name: string;
    parentId: string;
    mime: string;
    size: number;
    existingFileId: string | null;
    /** `driveWriteIdentity().subject` — My Drive хавтсанд эзний нэрээр. */
    subject?: string | null;
  },
): Promise<string> {
  const qs = `uploadType=resumable&supportsAllDrives=true&fields=${encodeURIComponent(UPLOAD_FIELDS)}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': opts.mime,
    'X-Upload-Content-Length': String(opts.size),
  };
  const res = opts.existingFileId
    ? await driveGet(
        env,
        `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(opts.existingFileId)}?${qs}`,
        { method: 'PATCH', headers, body: '{}' },
        DRIVE_WRITE_SCOPE,
        opts.subject ?? undefined,
      )
    : await driveGet(
        env,
        `${DRIVE_UPLOAD_API}/files?${qs}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: opts.name,
            parents: [opts.parentId],
          }),
        },
        DRIVE_WRITE_SCOPE,
        opts.subject ?? undefined,
      );
  const location = res.headers.get('location');
  await res.body?.cancel().catch(() => {});
  if (!location) {
    throw new DriveBrowseError('UNAVAILABLE', res.status, 'resumable', 'Drive returned no upload session Location');
  }
  return location;
}

export type DriveResumableResult =
  | { done: false; received: number }
  | { done: true; entry: DriveEntry };

/** Google-ийн `Range: bytes=0-N` → N+1 (хүлээн авсан байт); толгой алга = 0. */
export function parseResumableRange(header: string | null): number {
  if (!header) return 0;
  const m = /bytes=0-(\d+)/.exec(header);
  return m ? Number(m[1]) + 1 : 0;
}

/**
 * Нэг chunk-ийг session руу дамжуулна.  `Content-Range: bytes a-b/total`;
 * Google 308 = үргэлжлүүл (хүлээн авсан хүртэл `Range` толгойд), 200/201 =
 * дууссан (файлын мета).  Content-Length ЗААВАЛ тул `FixedLengthStream`.
 * Токен хэрэггүй — session URI өөрөө эрх.
 */
export async function driveResumablePut(
  sessionUri: string,
  chunk: { stream: ReadableStream; length: number },
  offset: number,
  total: number,
): Promise<DriveResumableResult> {
  const { readable, writable } = new FixedLengthStream(chunk.length);
  void chunk.stream.pipeTo(writable).catch(() => {
    /* fetch талд алдаа гарна */
  });
  let res: Response;
  try {
    res = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${offset + chunk.length - 1}/${total}` },
      body: readable,
    });
  } catch (err) {
    throw new DriveBrowseError('UNAVAILABLE', 0, 'network', err instanceof Error ? err.message : 'fetch failed');
  }
  if (res.status === 308) {
    await res.body?.cancel().catch(() => {});
    return { done: false, received: parseResumableRange(res.headers.get('range')) };
  }
  if (!res.ok) throw classifyDriveFailure(res.status, await res.text());
  return { done: true, entry: (await res.json()) as DriveEntry };
}

/** Session-ийн төлөв (тасарсны дараа хаанаас үргэлжлүүлэх): хоосон PUT +
 *  `Content-Range: bytes * / total` (зайгүй).  404/410 = session хүчингүй (7 хоног өнгөрсөн). */
export async function driveResumableStatus(sessionUri: string, total: number): Promise<DriveResumableResult> {
  let res: Response;
  try {
    res = await fetch(sessionUri, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes */${total}`, 'Content-Length': '0' },
    });
  } catch (err) {
    throw new DriveBrowseError('UNAVAILABLE', 0, 'network', err instanceof Error ? err.message : 'fetch failed');
  }
  if (res.status === 308) {
    await res.body?.cancel().catch(() => {});
    return { done: false, received: parseResumableRange(res.headers.get('range')) };
  }
  if (!res.ok) throw classifyDriveFailure(res.status, await res.text());
  return { done: true, entry: (await res.json()) as DriveEntry };
}

/** Session-ийг цуцална (хагас байршуулсан байт Drive-д үлдэхгүй).  Алдаа залгина —
 *  цуцлалт нь «сайн санааны» ажил, 7 хоногт Google өөрөө хаяна. */
export async function driveResumableCancel(sessionUri: string): Promise<void> {
  try {
    const res = await fetch(sessionUri, { method: 'DELETE', headers: { 'Content-Length': '0' } });
    await res.body?.cancel().catch(() => {});
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/*  Нэр солих / зөөх — ERP-ээс Drive-ыг засах (2026-09-18)              */
/* ------------------------------------------------------------------ */

/** Файл/хавтасны нэрийг солино (`files.update`, зөвхөн мета).  Sync сонсогч
 *  Changes-ээр `renamed` мөр бичнэ — энд ledger хөндөхгүй. */
export async function driveRename(
  env: Env,
  fileId: string,
  name: string,
  subject?: string | null,
): Promise<DriveEntry> {
  const res = await driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=${encodeURIComponent(ENTRY_FIELDS)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) },
    DRIVE_WRITE_SCOPE,
    subject ?? undefined,
  );
  return (await res.json()) as DriveEntry;
}

/** Файл/хавтсыг өөр хавтас руу зөөнө (`addParents`/`removeParents` — Drive
 *  одоо ганц эцэгтэй тул хуучныг заавал хасна). */
export async function driveMove(
  env: Env,
  fileId: string,
  fromParentId: string,
  toParentId: string,
  subject?: string | null,
): Promise<DriveEntry> {
  const qs = new URLSearchParams({
    supportsAllDrives: 'true',
    addParents: toParentId,
    removeParents: fromParentId,
    fields: ENTRY_FIELDS,
  });
  const res = await driveGet(
    env,
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${qs.toString()}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    DRIVE_WRITE_SCOPE,
    subject ?? undefined,
  );
  return (await res.json()) as DriveEntry;
}
