import { isAdminRole } from '../types';

/**
 * Ирц бүртгэлийн хязгаарлалтаас (төсөл заавал сонгох, утаснаас хориглох,
 * нэг төхөөрөмжид холбох) бүрэн чөлөөлөгдөх ажилтны кодууд.  Admin tier
 * аль хэдийн чөлөөтэй; энд нэмсэн хүн ролио ӨӨРЧЛӨХГҮЙГЭЭР admin-тэй ижил
 * эрхтэй болно.  Frontend талд `features/attendance/attendanceExempt.ts`-д
 * ижил жагсаалт бий — хоёр талыг ижил байлгана.
 *
 * (2026-10-01-нд `routes/attendance.ts`-ээс энд шилжсэн — таск «Өөртөө авах»
 * нь ирцтэй эсэхийг ЯГ ижил дүрмээр шалгах ёстой тул ганц газар.)
 */
export const ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS = ['ERD'];

/** Admin tier эсвэл онцгойлсон ажилтны кодтой эсэх.  employee_id нь JWT-д
 *  байхгүй тул шаардлагатай үед л users хүснэгтээс уншина (admin богино
 *  холболтоор query-гүй гарна). */
export async function isAttendanceUnrestricted(
  db: D1Database,
  user: { sub: number; role: string },
): Promise<boolean> {
  if (isAdminRole(user.role)) return true;
  // Per-user DB flag (admin UsersPage-аас toggle) ЭСВЭЛ код доторх жагсаалт.
  const row = await db
    .prepare('SELECT employee_id, attendance_unrestricted FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ employee_id: string | null; attendance_unrestricted: number | null }>();
  if (row?.attendance_unrestricted) return true;
  if (ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS.length === 0) return false;
  return !!row?.employee_id && ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS.includes(row.employee_id);
}

/**
 * Ажилтан ОДОО ажил дээр байна уу (эзэн 2026-10-01: «Ирэх» бүртгээгүй бол таск
 * авч цаг эхлүүлэхгүй) — өнөөдрийн (УБ) нээлттэй ирцийн мөр, эсвэл ирцээс
 * чөлөөлөгдсөн (admin tier / онцгой код).  «Гарах» бүртгэхэд албан таймер
 * автоматаар зогсдог (`routes/attendance.ts`) тул хоёр тал нийцнэ.
 */
export async function isAtWork(
  db: D1Database,
  user: { sub: number; role: string },
  today: string,
): Promise<boolean> {
  if (await isAttendanceUnrestricted(db, user)) return true;
  const open = await db
    .prepare(
      `SELECT 1 AS ok FROM attendance_sessions
        WHERE user_id = ? AND date = ? AND clock_out IS NULL
        LIMIT 1`,
    )
    .bind(user.sub, today)
    .first<{ ok: number }>();
  return !!open;
}
