import { orgConfig } from './orgConfig';

/**
 * Систем/туршилтын хэрэглэгч — ирцийн roster-т ОРОХГҮЙ дансууд.
 *
 * `test` данс нь ажилтан биш ч гэсэн `role='engineer'`, `status='active'`
 * учраас «Ирээгүй» жагсаалтад өдөр бүр гарч, ирцийн хувь, өдрийн хүснэгт,
 * товчоо, ирц баталгаажуулалт, чөлөөний сануулга бүгдэд нэгээр гажуудуулж
 * байсан.
 *
 * ЯАГААД `status='inactive'` БИШ ВЭ: `routes/auth.ts`-ийн login нь
 * `status = 'active'`-ыг шаарддаг тул идэвхгүй болгосон данс руу нэвтрэх
 * боломжгүй болно — туршилтын данс байхаа больно.  Тиймээс нэвтрэх эрхийг
 * хэвээр үлдээж, зөвхөн roster query-үүдээс хасна.
 *
 * Жагсаалт нь `orgConfig()`-оос ирнэ (`ORG_SYSTEM_USER_IDS` env эсвэл
 * `app_settings['org.system_user_ids']`), дефолт нь ХООСОН — өөр компанид
 * суулгахад MGL-ийн id хатуу шингээгүй.  MGL-ийн утгыг миграц 0244 бичнэ.
 *
 * ⚠️ Энэ нь `is_support`-той ӨӨР зүйл: `is_support=1` нь зөвхөн бүтээмжийн
 *    самбараас хасдаг бол энэ нь «ажилдаа ирэх ёстой хүн» гэсэн жагсаалтаас
 *    хасна.  Туршилтын дансыг хоёуланд нь тэмдэглэх нь зөв.
 */

/** Тохируулсан систем/туршилтын хэрэглэгчийн id-ууд (дефолт хоосон). */
export function systemUserIds(): readonly number[] {
  return orgConfig().systemUserIds;
}

/** Өгөгдсөн id систем/туршилтын данс мөн эсэх. */
export function isSystemUser(id: number | null | undefined): boolean {
  return id != null && systemUserIds().includes(id);
}

/** SQL хэлтэрхий: roster/absent query-гээс систем дансуудыг хасна.  alias
 *  default `u`.  Тохируулаагүй бол хасах хүн байхгүй тул `1=1` буцаана —
 *  дуудагч талын `AND ${excludeSystemUsersSql()}` бичиглэл өөрчлөгдөхгүй.
 *  Утгууд нь `parseUserIds`-аар шүүгдсэн бүхэл тоо тул SQL-д шууд бичих нь
 *  аюулгүй (`excludeCeoSql`-тай ижил хэв маяг). */
export function excludeSystemUsersSql(alias = 'u'): string {
  const ids = systemUserIds();
  return ids.length === 0 ? '1=1' : `${alias}.id NOT IN (${ids.join(',')})`;
}
