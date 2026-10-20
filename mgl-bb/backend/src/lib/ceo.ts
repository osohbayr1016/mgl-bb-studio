import { isLeaderboardEligible, LEADERBOARD_ELIGIBLE_ROLES } from '../types';
import { orgConfig } from './orgConfig';

/**
 * CEO hardcode — «admin-аас дээгүүр» ганц гүйцэтгэх захирал.
 *
 * Шинэ DB role НЭМЭХГҮЙ: production `users` хүснэгтийн CHECK constraint зөвхөн
 * `admin|engineer|architect|senior|client`-ийг зөвшөөрдөг бөгөөд D1-д parent
 * хүснэгтийг rebuild хийх боломжгүй (memory: d1-users-rebuild-limitation).
 * Оронд нь тодорхой хэрэглэгчийн id дээр hardcode хийнэ.
 *
 * Зорилтот хэрэглэгч: user_id 2 «Бат-Өлзий Билгүүн», DB role нь `admin` хэвээр
 * (бүх admin эрх хадгалагдана).  Нэмэлт зан төлөв: ирцний бүрэн чөлөөлөлт,
 * даалгавар авч гүйцэтгэх, бүтээмжийн самбарт харагдах.
 *
 * Frontend талд ижил тогтмол `frontend/src/shared/lib/ceo.ts`-д бий — хоёр
 * талыг ижил байлга.
 */
/**
 * MGL-ийн ӨГӨГДМӨЛ CEO id.  Тохиргоо байхгүй үеийн fallback бөгөөд SQL-д шууд
 * тоо оруулах шаардлагатай хоёр хуучин дуудлагын байрлалыг тэжээнэ.
 *
 * ⚠️ ШИНЭ КОД ЭНИЙГ БҮҮ ХЭРЭГЛЭ — `ceoUserId()`-г ашигла.  Энэ тогтмол нь
 *    тохиргоог ҮЛ ТООМСОРЛОНО.  Үлдсэн хоёр хэрэглэгч (`routes/authorSupervision.ts`
 *    :241/:254) нь өөр агентын дуусаагүй ажилтай файл дээр байгаа тул тэр
 *    файлыг цэвэрлэмэгц `ceoUserId()` руу шилжүүлнэ.
 */
export const CEO_USER_ID = 2;

/**
 * Идэвхтэй CEO-гийн user id, эсвэл `null` (тухайн онцгой зан төлөв унтарсан).
 * `ORG_CEO_USER_ID` env, эсвэл `app_settings['org.ceo_user_id']`-ээс уншина;
 * тохируулаагүй бол {@link CEO_USER_ID}.  `'none'` гэж өгвөл CEO-гүй болно —
 * MGL-ээс өөр компанид энэ hardcode огт хамаарахгүй байх нь ердийн зүйл.
 */
export function ceoUserId(): number | null {
  return orgConfig().ceoUserId;
}

/** Өгөгдсөн хэрэглэгчийн id CEO мөн эсэх.  CEO тохируулаагүй бол үргэлж false. */
export function isCeo(id: number | null | undefined): boolean {
  const ceo = ceoUserId();
  return ceo !== null && id === ceo;
}

/** SQL хэлтэрхий: roster/absent query-гээс CEO-г хасах.  alias default `u`.
 *  CEO тохируулаагүй бол хасах хүн байхгүй тул `1=1` (үргэлж үнэн) буцаана —
 *  дуудагч талын `AND ${excludeCeoSql()}` бичиглэл өөрчлөгдөхгүй. */
export function excludeCeoSql(alias = 'u'): string {
  const ceo = ceoUserId();
  return ceo === null ? '1=1' : `${alias}.id != ${ceo}`;
}

/** SQL хэлтэрхий: бүтээмжийн самбарын гишүүнчлэл.  `includeCeo` (default true)
 *  үнэн бол тохируулсан CEO-г нэмнэ; худал бол зөвхөн ажилчин tier.
 *  Роль жагсаалт нь `LEADERBOARD_ELIGIBLE_ROLES`-оос гарна — SQL болон TS
 *  шалгалт хоёр салж хазайхаас сэргийлж нэг эх сурвалжтай. */
export function leaderboardMemberSql(alias = 'u', includeCeo = true): string {
  const roles = LEADERBOARD_ELIGIBLE_ROLES.map((r) => `'${r}'`).join(',');
  const base = `${alias}.role IN (${roles})`;
  const ceo = ceoUserId();
  return includeCeo && ceo !== null ? `(${base} OR ${alias}.id = ${ceo})` : `(${base})`;
}

/** Leaderboard-д оноо цуглуулах эрхтэй эсэх (role ЭСВЭЛ, `includeCeo` үнэн бол CEO id). */
export function isLeaderboardEligibleUser(role: string, id: number, includeCeo = true): boolean {
  return isLeaderboardEligible(role) || (includeCeo && isCeo(id));
}

/** CEO-г бүтээмжийн самбарт харуулах эсэх admin toggle (`app_settings`
 *  key `ceo_on_leaderboard`).  Default true — зөвхөн тодорхой '0' үед нуана. */
export async function getCeoOnLeaderboard(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM app_settings WHERE key = 'ceo_on_leaderboard'")
    .first<{ value: string }>();
  return row?.value !== '0';
}
