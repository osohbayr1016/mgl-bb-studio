// Хоцролтын торгуулийг "чөлөө/гадуур ажил"-аар хасах логик.
//
// Дүрэм: тухайн ажилтан тухайн өдөр approved ЧӨЛӨӨ (leave_requests,
// start_date..end_date муж)-тэй бол тэр өдрийн хоцорсон цаг (late_minutes)-ийг
// 0 гэж үзнэ — торгуульгүй, credited-ээс ч хасахгүй.
//
// Гадуур ажил (out_of_office_requests, work_date) 2026-08-03-аас ӨГЛӨӨНИЙ
// хоцролтыг зөвхөн ХАМРАХ тохиолдолд л цуцална: цагийн мужтай (start/end)
// хүсэлт нь ирсэн цагаас ӨМНӨ эхэлсэн байх ёстой (жишээ: 14:00-17:00 гадуур
// ажил өглөөний 09:30 ирэлтийн хоцролтыг цуцлахгүй).  Цаг заагаагүй хуучин
// хүсэлтүүд урьдын адил бүтэн цуцална (эргэлзээг ажилтны талд).
//
// Хоёр хэлбэрээр илэрхийлэв (хоёулаа ИЖИЛ дүрэм — заавал sync байлгана):
//   • LATE_NOT_WAIVED_SQL — report query-нуудын дотор шууд хэрэглэх SQL predicate
//     (attendance_sessions-ийг `a` нэрээр alias-сан байх ёстой).
//   • isLateWaived()      — нэг (user, date)-д зориулсан boolean шалгалт
//     (my-status зэрэг ганц мөрийн урсгалд).
//
// (buildDailyAttendanceRows өөрийн нарийвчилсан хувилбартай — `lib/lateWaiver.ts`,
// тэнд давхцлын минутыг хэсэгчлэн хасдаг; энд SQL тул binary ойролцоолол
// хэрэглэнэ.  Ирэхээс өмнө эхэлсэн гадуур ажлын өмнөх зай хоёуланд нь
// хоцролт БИШ — 2026-09-29 хүртэл хүснэгт түүнийг хоцролт гэж тоолж зөрдөг байв.)

/**
 * SQL predicate: alias `a` (attendance_sessions)-ийн мөр тухайн өдрийн
 * чөлөө/гадуур ажлаар "хасагдаагүй" буюу хоцролт нь ХЭВЭЭР тооцогдох ёстой
 * бол TRUE.  WHERE болон `CASE WHEN ... THEN late_minutes ELSE 0 END`-д
 * хэрэглэнэ.  Placeholder (`?`) агуулаагүй тул bind-ийн дарааллыг өөрчлөхгүй.
 * `substr(a.clock_in, 12, 5)` = ирсэн цагийн 'HH:MM' (nowInUBIso формат:
 * 'YYYY-MM-DDTHH:MM:SS+08:00').
 */
export const LATE_NOT_WAIVED_SQL = `
  NOT EXISTS (
    SELECT 1 FROM leave_requests lr
    WHERE lr.user_id = a.user_id AND lr.status = 'approved'
      AND lr.start_date <= a.date AND lr.end_date >= a.date
  )
  AND NOT EXISTS (
    SELECT 1 FROM out_of_office_requests oo
    WHERE oo.user_id = a.user_id AND oo.status = 'approved'
      AND oo.work_date = a.date
      AND (oo.start_time IS NULL OR oo.end_time IS NULL
           OR oo.start_time < substr(a.clock_in, 12, 5))
  )`;

/**
 * Тухайн (userId, date)-д хоцролт хасагдах эсэх — approved чөлөө эсвэл
 * өглөөний ирэлтийг хамарсан гадуур ажилтай эсэх.  `LATE_NOT_WAIVED_SQL`-тэй
 * ижил дүрэм.  `arrivedHhmm` ('HH:MM') өгөгдөөгүй бол гадуур ажлын цагийг
 * шалгах боломжгүй тул хуучин журмаар бүтэн цуцална.
 */
export async function isLateWaived(
  db: D1Database,
  userId: number,
  date: string,
  arrivedHhmm?: string | null,
): Promise<boolean> {
  const arrive =
    arrivedHhmm && /^([01]\d|2[0-3]):([0-5]\d)$/.test(arrivedHhmm) ? arrivedHhmm : '24:00';
  const row = await db
    .prepare(
      `SELECT 1 FROM leave_requests
         WHERE user_id = ? AND status = 'approved'
           AND start_date <= ? AND end_date >= ?
       UNION ALL
       SELECT 1 FROM out_of_office_requests
         WHERE user_id = ? AND status = 'approved' AND work_date = ?
           AND (start_time IS NULL OR end_time IS NULL OR start_time < ?)
       LIMIT 1`,
    )
    .bind(userId, date, date, userId, date, arrive)
    .first();
  return !!row;
}

// ---------------------------------------------------------------------------
// «Гарах бүртгэлгүй бол маргааш ирэх бүртгэл хийхгүй» хаалтын ЧӨЛӨӨЛӨЛТ
// ---------------------------------------------------------------------------
//
// Тэр сахилгын дүрэм (2026-08-26, `routes/attendance.ts`) нь «ажил тарахдаа
// цагаа хаахаа МАРТСАН» хүнийг барихаар бодогдсон.  Гэтэл тухайн өдөр
// баталгаажсан ЧӨЛӨӨТЭЙ явсан хүн ажил тарах мөчид оффист БАЙХГҮЙ тул
// гарах бүртгэлээ хийх БОЛОМЖГҮЙ — түүнийг маргааш нь түгжих нь дүрмийн
// зорилгод харшилна.  Бодит тохиолдол (2026-09-07): ажилтан 11:00–17:00
// цалингүй чөлөө авч, админ баталсан атал маргааш нь ирц бүртгүүлж чадаагүй.
//
// ЧӨЛӨӨ нь ЦАГААС ҮЛ ХАМААРНА — `LATE_NOT_WAIVED_SQL`-ийн чөлөөний хагастай
// ЯГ ИЖИЛ дүрэм (тэнд ч хоцролт нь чөлөөний цагийн мужаар нөхцөлддөггүй).
// Хоёр талыг санаатай sync байлгасан: нэг өдрийн чөлөө нэг дүрмээр
// хөнгөлөөд нөгөөгөөр торгодог бол ажилтанд тайлбарлах аргагүй болно.
//
// ГАДУУР АЖИЛ нь зөвхөн ЦАГ ЗААГААГҮЙ (бүтэн өдрийн) үед л чөлөөлнө.
// Цагийн мужтай гадуур ажил (14:00–16:00) хийсэн хүн ажил тарахдаа
// оффист буцаж ирсэн байх ёстой тул хаалт хэвээр — энэ нь ээлжийн
// төгсгөлийг хүн тус бүрээр шийдэхгүйгээр (users + user_work_schedules
// уншилтгүйгээр) аюулгүй талд нь буулт хийсэн хувилбар.
/**
 * SQL predicate: alias `a` (attendance_sessions)-ийн хаагдаагүй мөр
 * ЧӨЛӨӨЛӨГДӨӨГҮЙ буюу ирэх бүртгэлийг ТҮГЖИХ ёстой бол TRUE.
 * Placeholder (`?`) агуулаагүй тул bind-ийн дарааллыг өөрчлөхгүй.
 */
export const OPEN_SESSION_NOT_EXCUSED_SQL = `
  NOT EXISTS (
    SELECT 1 FROM leave_requests lr
    WHERE lr.user_id = a.user_id AND lr.status = 'approved'
      AND lr.start_date <= a.date AND lr.end_date >= a.date
  )
  AND NOT EXISTS (
    SELECT 1 FROM out_of_office_requests oo
    WHERE oo.user_id = a.user_id AND oo.status = 'approved'
      AND oo.work_date = a.date
      AND (oo.start_time IS NULL OR oo.end_time IS NULL)
  )`;

/**
 * SQL predicate: alias `a`-ийн хаагдаагүй мөр нь ДАВХАР ирсэн бүртгэл БИШ
 * бол TRUE.  2026-09-16 хүртэл `POST /clock-in` нь «нээлттэй байна уу?»
 * шалгалт + INSERT гэсэн хоёр тусдаа statement байсан тул давхар дарсан
 * товч ИЖИЛ `clock_in` секундтэй ХОЁР нээлттэй мөр үүсгэж, гарахад нэг нь л
 * хаагдаж, нөгөө нь маргааш нь ажилтныг буруугүйгээр түгжиж байв (прод
 * session 4407/4408).  Ижил өдөр, ЯГ ИЖИЛ `clock_in`-тэй ХААГДСАН ихэр
 * байвал ажилтан гарсан бүртгэлээ хийсэн — үлдсэн мөр нь хог, хаалт биш.
 * Зөвхөн яг ижил `clock_in` — үдийн завсарлагаанд гараад орой мартсан
 * (өөр `clock_in`-тэй) жинхэнэ зөрчлийг хөнгөлөхгүй.
 */
export const OPEN_SESSION_NOT_DUPLICATE_SQL = `
  NOT EXISTS (
    SELECT 1 FROM attendance_sessions twin
    WHERE twin.user_id = a.user_id AND twin.date = a.date
      AND twin.clock_in = a.clock_in AND twin.clock_out IS NOT NULL
  )`;

/**
 * Ажилтныг ирэх бүртгэлээс ТҮГЖИЖ буй хамгийн эртний хаагдаагүй session.
 *
 * Bind дараалал: `(user_id, today, CLOCKOUT_RULE_ACTIVE_FROM)`.
 *
 * ⚠️ Энэ мөр нь `POST /clock-in` ба `GET /my-status` ХОЁУЛААС дуудагдана —
 * хуулбарлавал UI «болно» гэж харуулаад сервер татгалзана.  Тестээс мөн
 * ЭНЭ тогтмолыг шууд ажиллуулдаг (`leaveWaiver.test.ts`) тул route-ын
 * дотор дахин бичихгүй.
 */
export const STALE_OPEN_SESSION_SQL = `
  SELECT a.id, a.date, a.clock_in
    FROM attendance_sessions a
   WHERE a.user_id = ? AND a.clock_out IS NULL
     AND a.date < ? AND a.date >= ?
     AND ${OPEN_SESSION_NOT_EXCUSED_SQL}
     AND ${OPEN_SESSION_NOT_DUPLICATE_SQL}
   ORDER BY a.date ASC LIMIT 1`;
