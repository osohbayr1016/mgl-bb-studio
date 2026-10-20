/**
 * Google Drive клиент — баримт бичгийн архивын Office файлыг Google Docs/Sheets
 * болгож хөрвүүлэх, буцааж татах, урьдчилан харах PDF гаргах.
 *
 * ТОКЕН: Gmail-ийн БАЙГАА OAuth холболтыг дахин ашиглана — шинэ нууц ч,
 * шинэ зөвшөөрлийн урсгал ч, Google Admin console дээрх ажил ч БАЙХГҮЙ.
 *
 * ⚠️ Яагаад service account БИШ вэ (2026-09-07-нд хэмжсэн): продакшны
 * `email_accounts`-ийн хоёр мөр ХОЁУЛАА `auth_type = 'oauth'` — өөрөөр
 * хэлбэл domain-wide delegation энэ байгууллагад ХЭЗЭЭ Ч тохируулагдаж
 * байгаагүй.  Эхний хувилбар нь DWD дээр тогтсон байсан бөгөөд тэр нь
 * зөвхөн байхгүй тохиргоог шаардаж, боломж бүхэлдээ унтарсан хэвээр
 * үлдэх байв.  Нэмэлт давуу тал: OAuth нь бодит хэрэглэгчийн нэрээр
 * ажилладаг тул 2022 оноос хойшхи «service account-д Drive-ын багтаамж
 * байхгүй» (`storageQuotaExceeded`) асуудал огт үүсэхгүй — файл нь тэр
 * хүний Drive дээр, тэдний багтаамжаар үүснэ.
 *
 * ГАНЦ шаардлагатай гар ажил: `drive.file` scope нь 2026-09-07-нд нэмэгдсэн
 * тул түүнээс ӨМНӨ олгогдсон refresh token Drive рүү орох эрхгүй.  Админ
 * «Мэйл хайрцаг → Gmail холбох»-оор НЭГ УДАА дахин зөвшөөрөхөд л хангалттай
 * ({@link isScopeError} түүнийг таньж ойлгомжтой алдаа өгнө).
 *
 * ХУВААЛЦАХ: өгөгдмөл нь `domain` — @mglenc.com Google акаунтаар нэвтэрсэн хүн
 * бүр засах эрхтэй.  Эзний хэлснээр баг тус бүр нэг @mglenc.com хаягтай тул
 * энэ нь яг тэр загварт таарна.  Workspace-ийн бодлого домэйн хуваалцахыг
 * хааж болох тул `DOCS_DRIVE_SHARE=link` гэж холбоосоор хуваалцах руу шилжиж
 * болно — ГЭХДЭЭ тэр үед холбоос мэддэг ХЭН Ч засах тул зөвхөн шаардлагатай
 * үед хэрэглэнэ.
 */
import type { Env } from '../../types';
import { getAccessTokenForAccount, type TokenAccount } from './googleAuth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Drive-ын экспортын хатуу хязгаар.  Үүнээс том Google Doc-ыг API-аар .docx
 *  болгож татаж ЧАДАХГҮЙ (403 exportSizeLimitExceeded) — тийм тохиолдолд
 *  хэрэглэгчид Drive-аас нь гараар татахыг зөвлөнө. */
export const DRIVE_EXPORT_MAX_BYTES = 10 * 1024 * 1024;

/** Тохиргоо дутуу үед route нь 503 буцааж, UI нь Google товчоо нуухын тулд. */
export class DriveNotConfigured extends Error {
  constructor(detail: string) {
    super(
      `Google Drive холболт хийгдээгүй байна (${detail}). ` +
        `Админ → Мэйл хайрцаг хуудаснаас Google хаягаа холбоно уу.`,
    );
    this.name = 'DriveNotConfigured';
  }
}

/** Drive-ын алдааг задалж уншигдахуйц болгоно — түүхий JSON нь хэрэглэгчид утгагүй. */
export class DriveApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'DriveApiError';
  }
}

/**
 * Drive-ын файлыг эзэмших холбогдсон Google хайрцгийг олно.
 *
 * `DOCS_DRIVE_SUBJECT` өгсөн бол ЯГ тэр хаягийг, эс бөгөөс идэвхтэй ганц
 * хайрцгийг (хэд байвал хамгийн эртнийхийг) авна.  Сүүлийнх нь зориуд:
 * продакшнд хоёрхон хайрцаг бүртгэлтэй бөгөөд тохиргоо хоосон байхад
 * боломжийг бүхэлд нь хаахаас илүү ажиллуулсан нь дээр.
 */
async function driveAccount(env: Env): Promise<TokenAccount> {
  const wanted = env.DOCS_DRIVE_SUBJECT?.trim().toLowerCase();
  const row = wanted
    ? await env.DB.prepare(
        `SELECT address, auth_type, refresh_token_enc FROM email_accounts
         WHERE lower(address) = ? AND is_active = 1`,
      )
        .bind(wanted)
        .first<TokenAccount>()
    : await env.DB.prepare(
        `SELECT address, auth_type, refresh_token_enc FROM email_accounts
         WHERE is_active = 1 AND (auth_type <> 'oauth' OR refresh_token_enc IS NOT NULL)
         ORDER BY id LIMIT 1`,
      ).first<TokenAccount>();

  if (!row) {
    throw new DriveNotConfigured(
      wanted ? `«${wanted}» хайрцаг холбогдоогүй байна` : 'холбогдсон Google хайрцаг алга',
    );
  }
  if (row.auth_type === 'oauth' && !row.refresh_token_enc) {
    throw new DriveNotConfigured(`«${row.address}» хайрцгийн Google зөвшөөрөл хадгалагдаагүй`);
  }
  return row;
}

/** Google дээр засах боломж бэлэн эсэх.  D1 уншдаг тул async — UI нь үүнийг
 *  товч харуулах эсэхээ шийдэхэд ашиглана. */
export async function driveEnabled(env: Env): Promise<boolean> {
  try {
    await driveAccount(env);
    return true;
  } catch {
    return false;
  }
}

async function driveToken(env: Env): Promise<string> {
  return getAccessTokenForAccount(env, await driveAccount(env));
}

/**
 * Хадгалсан refresh token нь Drive-ын scope-гүй үед Google юу буцаадаг вэ.
 *
 * Энэ бол ХАМГИЙН МАГАДЛАЛТАЙ бүтэлгүйтэл: `drive.file` нь 2026-09-07-нд
 * scope жагсаалтад нэмэгдсэн ч токен нь олгогдох мөчдөө scope-оо тогтоодог
 * тул тэрнээс өмнө холбогдсон хайрцаг Drive рүү орох эрхгүй хэвээр.  Ганц
 * засвар нь нэг удаа дахин зөвшөөрөх, тиймээс түүнийг тусад нь таньж
 * хэрэглэгчид ЯГ тэр алхмыг хэлдэг.
 */
export function isScopeError(err: unknown): boolean {
  if (!(err instanceof DriveApiError)) return false;
  if (err.status !== 401 && err.status !== 403) return false;
  return (
    err.reason === 'insufficientPermissions' ||
    err.reason === 'forbidden' ||
    /insufficient (authentication )?scope|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(err.message)
  );
}

async function failure(res: Response): Promise<DriveApiError> {
  const text = await res.text();
  let reason = '';
  try {
    const j = JSON.parse(text) as { error?: { errors?: { reason?: string }[] } };
    reason = j.error?.errors?.[0]?.reason ?? '';
  } catch {
    /* JSON биш бол түүхий текстээ хэрэглэнэ */
  }
  return new DriveApiError(res.status, reason, `Drive ${res.status}: ${text.slice(0, 400)}`);
}

interface DriveFile {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  trashed?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Үүсгэх                                                             */
/* ------------------------------------------------------------------ */

/**
 * Түүхий Office байтыг Drive руу илгээж, ШУУД Google Doc/Sheet болгож
 * хөрвүүлнэ (`metadata.mimeType` нь зорилтот төрөл, media хэсгийн
 * `Content-Type` нь эх төрөл — Drive хоёрын зөрүүг «хөрвүүл» гэж ойлгодог).
 *
 * multipart/related-ыг ГАРААР угсарна: Workers-ийн `FormData` нь
 * `multipart/form-data` үүсгэдэг бөгөөд Drive түүнийг хүлээж авдаггүй.
 */
/** Worker-ийн санах ой ~128 MB.  multipart биетийг `Blob`-оор угсарснаар
 *  байтуудыг ДАХИН ХУУЛАХГҮЙ ч, эх ArrayBuffer нь санах ойд бүтнээрээ
 *  сууна.  Энэ таазыг давсан файлыг оролдохгүй — OOM нь бүхэл worker-ийг
 *  унагаадаг тул ойлгомжтой алдаа өгсөн нь дээр. */
export const DRIVE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export async function driveUpload(
  env: Env,
  opts: {
    name: string;
    bytes: ArrayBuffer;
    sourceMime: string;
    /** Өгвөл Drive хөрвүүлнэ; ОРХИВОЛ файл эх хэлбэрээрээ сууна
     *  (Office editing mode — форматаа алдахгүй, экспортын хязгаар үйлчлэхгүй). */
    convertTo?: string;
  },
): Promise<DriveFile> {
  const token = await driveToken(env);
  const parent = env.DOCS_DRIVE_FOLDER_ID?.trim();
  const metadata: Record<string, unknown> = { name: opts.name };
  // `mimeType`-ыг зөвхөн ХӨРВҮҮЛЭХ үед өгнө.  Эх төрлөөр нь үлдээхийн тулд
  // metadata-д огт бичихгүй — Drive нь media хэсгийн Content-Type-аар шийднэ.
  if (opts.convertTo) metadata.mimeType = opts.convertTo;
  if (parent) metadata.parents = [parent];

  const boundary = `mgl${crypto.randomUUID().replace(/-/g, '')}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${opts.sourceMime}\r\n\r\n`,
    opts.bytes,
    `\r\n--${boundary}--\r\n`,
  ]);

  const res = await fetch(
    `${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,modifiedTime`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) throw await failure(res);
  return (await res.json()) as DriveFile;
}

/**
 * Ажилтнууд засах эрхтэй болгоно.  `domain` горим нь @mglenc.com акаунтаар
 * нэвтэрсэн хүнийг л оруулах тул холбоос алдагдсан ч гадны хүн орж чадахгүй.
 */
export async function driveShare(env: Env, fileId: string): Promise<'domain' | 'link'> {
  const token = await driveToken(env);
  const mode = env.DOCS_DRIVE_SHARE?.trim() === 'link' ? 'link' : 'domain';
  const domain = env.DOCS_DRIVE_DOMAIN?.trim() || 'mglenc.com';
  const body =
    mode === 'link' ? { type: 'anyone', role: 'writer' } : { type: 'domain', domain, role: 'writer' };

  const res = await fetch(
    `${DRIVE_API}/files/${fileId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw await failure(res);
  return mode;
}

/* ------------------------------------------------------------------ */
/*  Унших / татах                                                      */
/* ------------------------------------------------------------------ */

/** Файл амьд эсэх + хамгийн сүүлд хэзээ өөрчлөгдсөн.  Sync sweep нь энэ
 *  `modifiedTime`-ыг л хардаг — Drive өөрөө webhook явуулахгүй. */
export async function driveGetMeta(env: Env, fileId: string): Promise<DriveFile | null> {
  const token = await driveToken(env);
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,trashed`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res);
  return (await res.json()) as DriveFile;
}

/** Google Doc/Sheet → Office эсвэл PDF байт.  10 MB-ийн хязгаартай (дээрх
 *  тайлбар); `DriveApiError.reason === 'exportSizeLimitExceeded'` гэж таньж
 *  болохоор `reason`-ыг үлдээв. */
export async function driveExport(
  env: Env,
  fileId: string,
  mimeType: string,
): Promise<ArrayBuffer> {
  const token = await driveToken(env);
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(mimeType)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw await failure(res);
  return res.arrayBuffer();
}

/**
 * Файлыг ЭХ БАЙТААР нь татна (`alt=media`).
 *
 * ⚠️ `files.export`-оос ялгаатай нь **10 MB-ийн хязгааргүй** — тэр хязгаар нь
 * Google-ийн ӨӨРИЙН форматаас Office рүү хөрвүүлж гаргахад л үйлчилдэг.
 * Эх хэлбэрээрээ (Office editing mode) сууж байгаа .docx/.xlsx-ийг татахад
 * ямар ч таазгүй — эзний «10MB-аас том файл» гомдлын гол шийдэл яг энэ.
 */
export async function driveDownload(env: Env, fileId: string): Promise<ArrayBuffer> {
  const token = await driveToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await failure(res);
  return res.arrayBuffer();
}

/**
 * Файлыг өөр төрөл рүү хөрвүүлсэн ТҮР хуулбар үүсгэнэ.
 *
 * Эх хэлбэрээрээ сууж байгаа .docx-оос PDF гаргах цорын ганц зам: Drive нь
 * зөвхөн ӨӨРИЙН форматаас экспортолдог тул эхлээд Google Doc болгож хуулж
 * аваад, экспортлоод, хуулбарыг устгана.  Эх файл ХӨНДӨГДӨХГҮЙ — тиймээс
 * засварын үнэн эх нь алдагдалгүй OOXML хэвээрээ үлдэнэ.
 */
export async function driveCopyAs(
  env: Env,
  fileId: string,
  mimeType: string,
  name: string,
): Promise<DriveFile> {
  const token = await driveToken(env);
  const res = await fetch(
    `${DRIVE_API}/files/${fileId}/copy?supportsAllDrives=true&fields=id,mimeType`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType, name }),
    },
  );
  if (!res.ok) throw await failure(res);
  return (await res.json()) as DriveFile;
}

/** Түр хуулбарыг БҮРМӨСӨН устгана — хогийн сав руу явуулбал эзэмшигчийн
 *  Drive нь урьдчилан харах болгонд нэг хогоор дүүрнэ. */
export async function driveDeleteForever(env: Env, fileId: string): Promise<void> {
  const token = await driveToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?supportsAllDrives=true`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw await failure(res);
}

/** Холболтыг таслахад Drive дээрх хуулбарыг хогийн саванд хийнэ — устгахгүй,
 *  ингэснээр буруу дарсан тохиолдолд Drive-аас сэргээж болно. */
export async function driveTrash(env: Env, fileId: string): Promise<void> {
  const token = await driveToken(env);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?supportsAllDrives=true`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
  if (!res.ok && res.status !== 404) throw await failure(res);
}
