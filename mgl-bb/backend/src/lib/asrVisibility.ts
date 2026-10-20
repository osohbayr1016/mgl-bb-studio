/**
 * Зохиогчийн хяналтын тайлангийн БАГИЙН харагдац (эзний шийдвэр 2026-09-29).
 *
 * «Тухайн багийн зохиогчийн хяналт зөвхөн адилхан багийнхандаа харагдана —
 * ББ-гийнхэн ББ-гийнхээ л; админд нэгдсэн байдлаар.»
 *
 *   • admin            → бүх тайлан;
 *   • бусад (ASR_ROLES) → тайланд сонгогдсон багийн аль нэгний гишүүн
 *                         (`user_teams`), эсвэл тайланг бичсэн / хамт явсан хүн
 *                         (өөр багт шилжсэн ч өөрийн очилтоо харна).
 *
 * Ноорогийн хил (`DRAFT_VISIBILITY` — зохиогч + админ) ТУСДАА хэвээр, энэ
 * нөхцөл түүн дээр НЭМЭГДЭНЭ.  Батлах эрх (`canReview`) нь аль хэдийн багаар
 * хязгаарлагддаг тул батлагч үргэлж харж чадна.
 *
 * ⚠️ ГАНЦ ГАЗАР.  Жагсаалт, самбарын статистик, очилтын тойм, өмнөх
 *    тайлангийн асуудлын сонголт, дэлгэрэнгүй/PDF, глобал хайлт, MGL AI —
 *    бүгд үүгээр.  Шинэ уншилт нэмбэл эндээс ав, давтаж бичвэл нэг нь мартагдана.
 *
 * SQL-д хэрэглэгчийн id-г BIND биш ТОО болгож шигтгэнэ: `personVisitsSql`
 * мэт нэг нөхцөлийг хэд хэдэн удаа давтдаг query-д байрлалын bind эвдэрнэ.
 * Утга нь баталгаажсан токены `sub` → `Number.isSafeInteger` шалгасан бүхэл
 * тоо тул шигтгэх нь аюулгүй; бүхэл биш бол ЮУ Ч харуулахгүй.
 */

export interface AsrViewer {
  sub: number;
  /** Админ эсэх — дуудагч `isAdminRole(user.role)`-оор өгнө. */
  isAdmin: boolean;
}

/** `alias` нь `author_supervision_reports`-ийн alias. */
export function asrVisibleSql(viewer: AsrViewer, alias = 'r'): string {
  if (viewer.isAdmin) return '1 = 1';
  const uid = Number(viewer.sub);
  if (!Number.isSafeInteger(uid)) return '0 = 1';
  return `(${alias}.author_id = ${uid}
    OR EXISTS (SELECT 1 FROM author_supervision_report_teams vis_rt
                 JOIN user_teams vis_ut ON vis_ut.team_id = vis_rt.team_id
                WHERE vis_rt.report_id = ${alias}.id AND vis_ut.user_id = ${uid})
    OR EXISTS (SELECT 1 FROM asr_report_companions vis_c
                WHERE vis_c.report_id = ${alias}.id AND vis_c.user_id = ${uid}))`;
}

/** Нэг тайланг үзэгч харж болох эсэх — `GET /:id`, PDF, бичлэгийн жагсаалт. */
export async function canSeeAsrReport(
  db: D1Database,
  reportId: number,
  viewer: AsrViewer,
): Promise<boolean> {
  if (viewer.isAdmin) return true;
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM author_supervision_reports r
        WHERE r.id = ? AND ${asrVisibleSql(viewer)}`,
    )
    .bind(reportId)
    .first<{ x: number }>();
  return !!row;
}
