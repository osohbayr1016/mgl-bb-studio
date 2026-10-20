/**
 * Солигдсон `/media/<key>` объектыг R2-оос цэвэрлэх — «шинэ зураг → DB шинэ
 * URL → ХУУЧИН файл үүрд үлддэг» гоожилтын эсрэг (2026-09-11, R2 аудит).
 *
 * Профайлын зураг, ковер, гарын үсэг, тамга, төслийн гол зураг, тайлангийн
 * лого/тамга — бүгд «солих» хэлбэрийн зураг: хэрэглэгч шинийг байршуулж
 * (`POST /api/upload` → шинэ түлхүүр), дараа нь баганад шинэ URL бичнэ.
 * Хуучин объект хэзээ ч устдаггүй байсан тул хэрэглэгч бүрийн бүх хуучин
 * avatar bucket-д хуримтлагдана.
 *
 * ДЭГ (Phase 11): 1) хуучин утгыг УНШ → 2) шинийг байршуулах нь клиент талд
 * аль хэдийн болсон → 3) DB-г шинэ утгаар ШИНЭЧИЛ → 4) амжилттай бол л
 * 5) хуучин объектыг, ХЭН Ч ИШЛЭХГҮЙ байвал устга.  DB-ийн UPDATE унавал
 * устгалт ОГТ хийгдэхгүй (дуудагч `after` дотор л дуудна).
 *
 * АЮУЛГҮЙ БАЙДЛЫН ХААЛТ — доорх БҮГД хангагдсан үед л устгана:
 *   • prev нь `/media/<нэг сегмент>` (lib/mediaUrl.ts) — хавтастай түлхүүр
 *     (`email/…`, `client-reports/…`) энэ замаар хэзээ ч устгагдахгүй;
 *   • prev ≠ next (ижил утгаар дахин хадгалах нь устгал БИШ);
 *   • түлхүүр нь `routes/upload.ts`-ийн `<userSub>-<ms>-…` хэлбэртэй, өөрөөр
 *     хэлбэл ХЭН НЭГЭН хэрэглэгчийн байршуулсан файл — `default-profile-photo.png`
 *     мэт гараар тавьсан хуваалцсан объект ХЭЗЭЭ Ч устгагдахгүй;
 *   • `users` (4 багана), `projects.key_image_url`, `app_settings.value`,
 *     `landing_projects.image_url`-д ӨӨР мөр ижил URL-ийг ишлээгүй (ишлэлийн
 *     тоо = 0).  Эдгээр хүснэгт жижиг (≤ 100 мөр) тул шалгалт хямд бөгөөд
 *     солих үйлдэл өдөрт хэдхэн удаа л болдог.
 *
 * Устгал `ctx.waitUntil` дотор, алдаа залгина — R2 delete унасан ч хариу
 * унахгүй (объект дараагийн `scripts/find-orphaned-r2.mjs` гүйлтэнд орно).
 */
import { isSingleSegmentMediaUrl } from './mediaUrl';

const MEDIA_PREFIX = '/media/';
/** `<sub>-<13 оронтой ms>-` — routes/upload.ts-ийн mediaKey хэлбэр (rand хэсэг заавал биш: хуучин түлхүүр rand-гүй). */
const USER_UPLOAD_KEY = /^\d+-\d{13}-/;

export function mediaKeyOfUrl(url: string): string | null {
  if (!isSingleSegmentMediaUrl(url)) return null;
  return decodeURIComponent(url.slice(MEDIA_PREFIX.length));
}

/** Хэрэглэгчийн байршуулсан (`/api/upload`) объект мөн үү — устгаж болох цорын ганц ангилал. */
export function isUserUploadedMediaUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const key = mediaKeyOfUrl(url);
  return key !== null && USER_UPLOAD_KEY.test(key);
}

/** Аппын «солих» хэлбэрийн зургийн баганууд — ишлэлийн тоог эндээс уншина. */
const REFERENCE_SQL = `
  SELECT
    (SELECT COUNT(*) FROM users
      WHERE profile_image = ?1 OR cover_image = ?1 OR signature_url = ?1 OR stamp_url = ?1)
  + (SELECT COUNT(*) FROM projects WHERE key_image_url = ?1)
  + (SELECT COUNT(*) FROM app_settings WHERE value = ?1)
  + (SELECT COUNT(*) FROM landing_projects WHERE image_url = ?1)
  AS n`;

export async function mediaReferenceCount(db: D1Database, url: string): Promise<number> {
  const row = await db.prepare(REFERENCE_SQL).bind(url).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface ReplaceMediaEnv {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
}

/**
 * DB-ийн UPDATE АМЖИЛТТАЙ болсны ДАРАА дуудна.  `prev`/`next` нь тухайн
 * баганын хуучин ба шинэ утга.  Юу устгасныг (эсвэл яагаад устгаагүйг)
 * буцаана — тест ба лог хоёуланд.
 */
export async function deleteReplacedMedia(
  env: ReplaceMediaEnv,
  prev: string | null | undefined,
  next: string | null | undefined,
): Promise<{ deleted: boolean; reason: string; key?: string }> {
  if (!prev) return { deleted: false, reason: 'no_prev' };
  if (prev === next) return { deleted: false, reason: 'unchanged' };
  if (!isUserUploadedMediaUrl(prev)) return { deleted: false, reason: 'not_user_upload' };
  const key = mediaKeyOfUrl(prev);
  if (!key) return { deleted: false, reason: 'not_media_url' };
  // UPDATE аль хэдийн хийгдсэн тул энэ мөр өөрөө ишлэхээ больсон: 0 = хэн ч хэрэглэхгүй.
  const refs = await mediaReferenceCount(env.DB, prev);
  if (refs > 0) return { deleted: false, reason: `still_referenced:${refs}`, key };
  try {
    await env.MEDIA_BUCKET.delete(key);
  } catch (err) {
    console.warn('[media-replace] delete failed', key, err);
    return { deleted: false, reason: 'r2_error', key };
  }
  return { deleted: true, reason: 'ok', key };
}

/**
 * Хэд хэдэн баганыг зэрэг сольсон UPDATE-ийн дараа: (prev, next) хос бүрд
 * `deleteReplacedMedia`.  `ctx.waitUntil`-д өгөхөд тохиромжтой — хэзээ ч шидэхгүй.
 */
export async function deleteReplacedMediaAll(
  env: ReplaceMediaEnv,
  pairs: Array<[prev: string | null | undefined, next: string | null | undefined]>,
): Promise<void> {
  for (const [prev, next] of pairs) {
    try {
      const r = await deleteReplacedMedia(env, prev, next);
      if (r.deleted) console.log('[media-replace] deleted', r.key);
    } catch (err) {
      console.warn('[media-replace] failed', err);
    }
  }
}
