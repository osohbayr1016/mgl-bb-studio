import { Hono } from 'hono';
import { detachUserFromRoots } from '../lib/taskRootGuard';
import { deleteReplacedMediaAll } from '../lib/mediaReplace';
import { requireAdmin, requireManager } from '../middleware/auth';
import { hashPassword } from '../lib/password';
import { isCeo } from '../lib/ceo';
import { monthKeyOf, monthRange, parseMonthKey } from '../lib/monthKey';
import { orgUtcOffsetMinutes } from '../lib/reportWindows';
import { todayInUB, nowInUBIso } from '../lib/time';
import { browserLabel, revokeAllDevices } from '../lib/attendanceDevice';
import {
  effectiveSchedule,
  isScheduleKey,
  latestAssignment,
  scheduleEffectiveFrom,
  selectedSchedule,
  type ScheduleKey,
} from '../lib/workSchedule';
import { getScheduleAssignmentsFor, setScheduleAssignment } from '../lib/scheduleStore';
import { hasFixedShift, FIXED_SHIFT, FIXED_SHIFT_LOCKED_ERROR } from '../lib/specialShift';
import { invalidateTokenCache } from '../lib/tokenValidity';
import { invalidateRemoteAccessCache } from '../lib/officeAccess';
/* Ажилтны амьдралын мөчлөг → судалгааны оролцогчийн жагсаалт.
 * Дүрэм нь `lib/assessmentRoster.ts`-д ГАНЦ хувь байна — `routes/assessments.ts`
 * мөн тэндээс уншдаг тул хоёр тал хэзээ ч зөрөхгүй. */
import {
  autoEnrollUserIntoOpenRounds,
  pruneInactiveUserFromRosters,
} from '../lib/assessmentRoster';
import { ALL_ROLES } from '../types';
import type {
  Env,
  AppVariables,
  UserRow,
  CreateUserRequest,
  UpdateUserRequest,
  Seniority,
  UserRole,
} from '../types';

const users = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// GET (list/read) is available to all manager-level roles so they can populate
// task-assignment pickers.  Every mutation (create / edit / password-reset /
// device-reset / status / DELETE) is admin-only.  (The former `system_admin`
// role — which alone could DELETE — was abolished in 2026-06 along with
// `management`; see the note in types.ts.)
users.use('/*', async (c, next) => {
  const guard = c.req.method === 'GET' ? requireManager() : requireAdmin();
  return guard(c, next);
});

/** user_teams sync-д client-ээс ирдэг нэг мөр. `is_primary` нь frontend-ээс
 *  boolean эсвэл 0/1 хэлбэрээр ирж болох тул хоёуланг нь хүлээж авна
 *  (runtime нь `entry.is_primary ? 1 : 0` гэж хэвийн болгодог). */
interface TeamMembershipInput {
  team_id: number;
  is_primary: boolean | number;
}

const VALID_ROLES = ALL_ROLES;
const VALID_SENIORITY: readonly Seniority[] = [
  'senior',
  'intermediate',
  'junior',
  'intern',
] as const;

function normaliseSeniority(value: unknown): Seniority | null | undefined {
  // undefined  → "талбар огт ирээгүй" → бичихгүй
  // null / ''  → "арилгах" → NULL болгоно
  // string     → enum-д таарвал зөвшөөрнө
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string' && VALID_SENIORITY.includes(value as Seniority)) {
    return value as Seniority;
  }
  return undefined;
}

/** Цалингийн имэйлийн optional талбар. Буцаах утга:
 *    undefined → "талбар огт ирээгүй, орхино"
 *    null      → "цэвэрлэх"
 *    string    → шинэ утга
 *    'invalid' → caller 400 буцаана */
function normaliseEmail(value: unknown): string | null | undefined | 'invalid' {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return 'invalid';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'invalid';
  return trimmed;
}

// Shared SELECT clause used by the list endpoint.
// LEFT JOIN so users without a team still appear in the list.
const USER_SELECT = `
  SELECT u.id, u.username, u.email, u.full_name, u.role, u.status,
         u.profile_image, u.cover_image, u.bio, u.description, u.social_links,
         -- Гарын үсэг + тамга: гүйцэтгэлийн тайлангийн «Баталгаажуулалт»
         -- хуудас (мөн үнийн саналын блоктой ижил зан төлөв) эдгээрийг
         -- ЭНЭ жагсаалтаас уншина.  PATCH /users/:id аль хэдийн бичдэг
         -- байсан ч SELECT нь буцаадаггүй тул зураг хэзээ ч гарахгүй байв.
         u.signature_url, u.stamp_url,
         u.team_id, u.position, u.employee_id, u.seniority, u.is_support,
         -- ⚠️ 0199-ийн ДАРАА Ч ЗААВАЛ хэрэгтэй: ээлжээ хэзээ ч сонгоогүй
         --    хүний ээлж нь ЭНЭ хуучин баганаас (2026 оны 9-р сараас өмнөх
         --    түүх) унана.  Сонгохоо мартвал доорх effectiveSchedule /
         --    selectedSchedule нь undefined авч, тэр хүн бүрийг 'standard'
         --    (09:00–18:00) гэж ХУДЛАА хэлнэ — UserRow.work_schedule нь
         --    заавал байх талбар гэж зарлагдсан тул tsc үүнийг барихгүй.
         --    ЭНЭ БЛОК нь JS template literal тул урвуу хашилт бичиж болохгүй.
         u.work_schedule,
         u.attendance_device_id, u.attendance_device_bound_at, u.attendance_unrestricted,
         -- Ирцийн ИДЭВХТЭЙ браузер/төхөөрөмжийн тоо (0328) — «холбогдсон»
         -- шошгон дээр «· 2 браузер» гэж харуулна.
         (SELECT COUNT(*) FROM attendance_devices ad
           WHERE ad.user_id = u.id AND ad.revoked_at IS NULL) AS attendance_device_count,
         u.remote_access_allowed,
         u.created_at, u.updated_at,
         pt.code AS team_code, pt.name_mn AS team_name_mn, pt.name_en AS team_name_en
  FROM users u
  LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
  LEFT JOIN teams pt ON pt.id = ut_p.team_id
`;

// GET /api/users
users.get('/', async (c) => {
  // Ordering: team sort first so grouping by team is natural,
  // then admin-like roles above regulars, then alphabetical by name.
  const { results } = await c.env.DB.prepare(
    `
    ${USER_SELECT}
    ORDER BY
      COALESCE(pt.sort_order, 999),
      CASE u.role
        WHEN 'admin'  THEN 1
        WHEN 'senior' THEN 2
        WHEN 'worker' THEN 4
        ELSE 3
      END,
      u.full_name
  `,
  ).all<
    UserRow & { team_code: string | null; team_name_mn: string | null; team_name_en: string | null }
  >();

  // Attach the full `teams` array per user so the edit dialog can
  // round-trip multi-team membership without a second roundtrip.
  const { results: memberships } = await c.env.DB.prepare(
    `
    SELECT ut.user_id, t.id, t.code, t.name_mn, t.name_en, ut.is_primary
    FROM user_teams ut
    JOIN teams t ON t.id = ut.team_id
    ORDER BY ut.user_id, ut.is_primary DESC, t.sort_order
  `,
  ).all<{
    user_id: number;
    id: number;
    code: string;
    name_mn: string;
    name_en: string | null;
    is_primary: number;
  }>();

  const teamsByUser = new Map<
    number,
    Array<{
      id: number;
      code: string;
      name_mn: string;
      name_en: string | null;
      is_primary: number;
    }>
  >();
  for (const m of memberships ?? []) {
    const list = teamsByUser.get(m.user_id) ?? [];
    list.push({
      id: m.id,
      code: m.code,
      name_mn: m.name_mn,
      name_en: m.name_en,
      is_primary: m.is_primary,
    });
    teamsByUser.set(m.user_id, list);
  }

  // Ажлын ээлж — сонголт нь `user_work_schedules`-д (миграци 0199), тиймээс
  // `u.work_schedule` багана нь ганцаараа ХУУЧИРСАН утга.  Админ жагсаалтад
  // «хэн ямар ээлж сонгосон» ба «өнөөдөр бодитоор юу үйлчилж байна» хоёрыг
  // ХОЁУЛАНГ нь өгнө (зуны үед тэд зөрнө).
  const today = todayInUB();
  const scheduleMap = await getScheduleAssignmentsFor(
    c.env.DB,
    (results ?? []).map((u) => u.id),
  );

  const enriched = (results ?? []).map((u) => {
    const assignments = scheduleMap.get(u.id);
    // Хамгийн сүүлийн сонголт — БАЙХГҮЙ бол тэр хүн ээлжээ ХЭЗЭЭ Ч сонгоогүй
    // бөгөөд `work_schedule_selected` нь хуучин `users.work_schedule` баганаас
    // (2026 оны 9-р сараас өмнөх түүхээс) унасан утга.  Админ «хэн сонголтоо
    // хийгээгүй вэ» гэдгийг ЗӨВХӨН үүгээр ялгана — хоёр тохиолдолд ижилхэн
    // 'standard' гарч ирдэг тул ээлжийн түлхүүр өөрөө хариулж чадахгүй.
    //
    // ⚠️ «Мөр байна» ≠ «ажилтан өөрөө сонгосон».  `user_work_schedules`-д
    //    ХОЁР бичигч бий: ажилтны `PATCH /auth/profile` (createdBy = өөрөө) ба
    //    админы `PUT /api/users/:id` (createdBy = админ).  Сүүлийнх нь
    //    хэрэглэгчийн засварын цонхноос ЯМАР Ч талбар засахад давхар явдаг
    //    тул зөвхөн албан тушаал засахад ч мөр үүснэ.  Тиймээс гурван төлөв
    //    буцаана — миграци 0199 нь `created_by`-г яг үүнд зориулж авсан.
    const latest = latestAssignment(assignments);
    const source = !latest
      ? ('default' as const)
      : latest.created_by === u.id
        ? ('self' as const)
        : ('admin' as const);
    return {
      ...u,
      work_schedule: effectiveSchedule(u.work_schedule, today, assignments),
      work_schedule_selected: selectedSchedule(u.work_schedule, assignments),
      work_schedule_source: source,
      /** Сонголт хэзээнээс хүчинтэй (ИРЭЭДҮЙН огноо байж болно). */
      work_schedule_from: latest?.effective_from ?? null,
      schedule_fixed: hasFixedShift(u.id),
      schedule_label: hasFixedShift(u.id) ? FIXED_SHIFT.label : undefined,
      teams: teamsByUser.get(u.id) ?? [],
    };
  });

  return c.json({ users: enriched });
});

// ---------------------------------------------------------------------------
// GET /api/users/monthly-stats?month=YYYY-MM — «Бүтээмж» табын сарын хүснэгт.
//
// ЭХ СУРВАЛЖИЙН ШИЙДВЭР: бүх багана `progress_entries`-ээс шууд бодогдоно;
// `user_points` дэвтрийг ОГТ уншихгүй.  Шалтгаан нь `recalculateProjectPoints`
// (progress.ts) дэвтрийн `source='progress'` зүсмэлийг бүхэлд нь устгаад
// ӨНӨӨДРИЙН жин/team-share/complexity-ээр дахин бүтээдэг — өөрөөр хэлбэл
// өнгөрсөн сарын оноо блокийн жин засах, багийн хувь солих зэрэг үйлдлээр
// хэн ч хүрэлгүйгээр хөдөлдөг.  Мөн дахин бүтээхдээ `awarded_at`-д
// `pe.created_at`-ыг бичдэг бол амьд зам нь `datetime('now')`-г авдаг тул
// оноо САР ХООРОНД шилждэг.  `progress_entries` эсрэгээрээ:
//   • entry-д `PUT`/`DELETE` route байхгүй,
//   • approve/reject хоёулаа `AND status='pending'`-тэй тул батлагдсан мөрийн
//     `percentage`/`date`-д ямар ч API хүрч чадахгүй,
//   • `date` нь INSERT дээр нэг л удаа бичигддэг.
//
// BASELINE: `is_baseline=1` мөр нь админ/senior-ийн Excel-ээс шилжүүлсэн
// эхлэлийн төлөв (`POST /api/tasks/:id/baseline`).  Дэвтэрт эдгээр нь
// ХАРИУЦАГЧид оноо бичдэг (progress.ts:1385) — өөрөө бичээгүй ажил.  Энд
// тэдгээрийг тооллогоос хасна; гэхдээ Q4-ийн LAG гинжинд ҮЛДЭЭНЭ, эс бөгөөс
// 90% baseline дээрх бодит 95% бичилт 5-ын оронд 95 гэж тоологдоно.
// Хассан мөрийн тоог `baseline_excluded`-оор буцааж админд ил гаргана.
//
// ХАМРАХ ХҮРЭЭ: `client` (гадны хэрэглэгч) ба `worker` (цэвэрлэгч —
// `POST /api/progress`-ыг дуудаж ч чадахгүй) хасагдана.  Идэвхгүй болсон
// ажилтан тухайн сард бичилт хийсэн бол ХЭВЭЭР харагдана (өнгөрсөн сарын
// тайлан бүрэн байхын тулд).  CEO-г (lib/ceo.ts) хасахгүй — админ бүх мөрийг
// хармаар байгаа — харин тэрээр ирцээс чөлөөлөгдсөн тул түүний
// `reporting_rate_pct` нь утгагүй болох учир `null` болгоно.
// ---------------------------------------------------------------------------

/** Идэвхтэй бүрэлдэхүүн + тухайн сард бичилт хийсэн идэвхгүй ажилтнууд. */
const MONTHLY_ROSTER_SQL = `
  SELECT u.id AS user_id, u.full_name, u.employee_id, u.role, u.position,
         u.status, u.profile_image, u.is_support,
         pt.code AS team_code, pt.name_mn AS team_name
  FROM users u
  LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
  LEFT JOIN teams pt ON pt.id = ut_p.team_id
  WHERE u.role NOT IN ('client', 'worker')
    AND (
      u.status = 'active'
      OR u.id IN (SELECT user_id FROM progress_entries WHERE date >= ?1 AND date < ?2 AND COALESCE(source, '') <> 'alloc_adj')
    )
  ORDER BY
    COALESCE(pt.sort_order, 999),
    CASE u.role WHEN 'admin' THEN 1 WHEN 'senior' THEN 2 ELSE 3 END,
    u.full_name
`;

// `is_rest_day` / `defer_next_day` шүүлт нь attendance.ts-ийн
// `hasReportedWorkToday` (цаг гаргахыг хаадаг хаалга)-той ЯГ ижил байх ёстой —
// тайлан нь ажилтны өдөр бүр амьдардаг дүрмээс өөр зүйл шаардаж болохгүй.
// `status` шүүлт зориудаар БАЙХГҮЙ: буцаагдсан бичилт ч гэсэн «тайлагнасан».
const MONTHLY_ACTIVITY_SQL = `
  SELECT pe.user_id,
         COUNT(DISTINCT pe.date)      AS report_days,
         COUNT(*)                     AS entries_filed,
         COUNT(DISTINCT b.project_id) AS projects_touched,
         COUNT(DISTINCT CASE WHEN pe.percentage >= 100
                              AND pe.status IN ('approved','pending')
                             THEN pe.task_id END) AS closures_filed,
         COUNT(DISTINCT CASE WHEN pe.percentage >= 100
                              AND pe.status = 'approved'
                             THEN pe.task_id END) AS closures_approved,
         COUNT(DISTINCT CASE WHEN pe.percentage >= 100
                              AND pe.status = 'rejected'
                             THEN pe.task_id END) AS closures_rejected
  FROM progress_entries pe
  LEFT JOIN tasks      t ON t.id = pe.task_id
  LEFT JOIN components c ON c.id = t.component_id
  LEFT JOIN drawings   d ON d.id = c.drawing_id
  LEFT JOIN blocks     b ON b.id = d.block_id
  WHERE pe.date >= ?1 AND pe.date < ?2
    AND COALESCE(pe.is_baseline,    0) = 0
    AND COALESCE(pe.is_rest_day,    0) = 0
    AND COALESCE(pe.defer_next_day, 0) = 0
    AND COALESCE(pe.source, '') <> 'alloc_adj'
  GROUP BY pe.user_id
`;

/** Ажилласан өдөр — «тайлагналтын хувь»-ийн хуваарь.  `clock_out IS NOT NULL`
 *  нь leaves.ts-ийн ирцийн нийлбэртэй ижил предикат. */
const MONTHLY_ATTENDANCE_SQL = `
  SELECT a.user_id, COUNT(DISTINCT a.date) AS attended_days
  FROM attendance_sessions a
  WHERE a.date >= ?1 AND a.date < ?2
    AND a.clock_out IS NOT NULL
  GROUP BY a.user_id
`;

// Төслийн явцад оруулсан ХУВЬ (нэгж %) — `calcProjectProgress`-ийн задаргаа.
// Тэнд draw_prog нь `… * 100.0 / d.weight_percent` гэж хуваадаг тул зурагны
// жин яг хасагдаж, нэг таскийн Δp хувь дараах хэмжээгээр төслийг ахиулна:
//     b.weight_percent × t.weight_percent × share_percent × Δp / 1e6
// Дотоод D1 дээр 2026-05/06/07 гурван сард `user_points.delta_pct`-тэй 4 орон
// хүртэл тулгаж шалгасан — цорын ганц зөрүү нь baseline мөрүүд (энд хасагдсан).
// `month_tasks` нь LAG цонхыг тухайн сард хөндөгдсөн таскуудаар хязгаарлана;
// гурван сар дээр шүүлтгүй хувилбартай байт-ижил үр дүн өгсөн.
export const MONTHLY_POINTS_SQL = `
  WITH month_tasks AS (
    SELECT DISTINCT task_id
    FROM progress_entries
    WHERE date >= ?1 AND date < ?2
      AND status = 'approved'
      AND task_id IS NOT NULL
      AND COALESCE(is_baseline, 0) = 0
      AND task_id NOT IN (SELECT task_id FROM task_roots)
      AND task_id NOT IN (SELECT task_id FROM task_conversion_members)
  ),
  ordered AS (
    SELECT pe.user_id, pe.date, pe.task_id, pe.percentage, pe.is_baseline,
           LAG(pe.percentage) OVER (
             PARTITION BY pe.task_id ORDER BY pe.created_at, pe.id
           ) AS prev_pct
    FROM progress_entries pe
    WHERE pe.status = 'approved'
      AND pe.task_id IN (SELECT task_id FROM month_tasks)
  ),
  legacy AS (
    SELECT o.user_id,
           SUM(
             CASE WHEN d.weight_percent > 0
                  THEN b.weight_percent * COALESCE(pts.share_percent, 0)
                       * t.weight_percent / 10000.0
                       * MAX(0, o.percentage - COALESCE(o.prev_pct, 0)) / 100.0
                  ELSE 0 END
           ) AS pts
    FROM ordered o
    JOIN tasks      t ON t.id = o.task_id
    JOIN components c ON c.id = t.component_id
    JOIN drawings   d ON d.id = c.drawing_id
    JOIN blocks     b ON b.id = d.block_id
    LEFT JOIN project_team_shares pts
           ON pts.project_id = b.project_id AND pts.team_id = b.team_id
    WHERE o.date >= ?1 AND o.date < ?2
      AND COALESCE(o.is_baseline, 0) = 0
    GROUP BY o.user_id
  ),
  -- Хуваарилагдсан (managed) таск: «хамгийн өндөр хувь»-ийн LAG биш ЖУРНАЛААС (user_points.delta_pct = төслийн Δ%).
  -- Залруулга (alloc_adj) projection мөр LAG-д орвол «20 → 5 → 12» нь 20 гэж тоологдож (буцаалтыг үгүйсгэж) эсвэл
  -- залруулах-сэргээх нь давхар тоологддог байв.  Сар = ажил хийсэн (оноо олгосон) УБ өдөр; буцаалт анхны өдөрт.
  managed AS (
    SELECT up.user_id, SUM(up.delta_pct) AS pts
    FROM user_points up
    WHERE up.task_id IN (SELECT task_id FROM task_roots UNION SELECT task_id FROM task_conversion_members)
      AND up.source = 'progress'
      AND date(up.awarded_at, ?3) >= ?1 AND date(up.awarded_at, ?3) < ?2
    GROUP BY up.user_id
  )
  SELECT user_id, ROUND(SUM(pts), 4) AS progress_points
  FROM (SELECT user_id, pts FROM legacy UNION ALL SELECT user_id, pts FROM managed)
  GROUP BY user_id
`;

// Хариуцлагын зөрүү.  Үндсэн баганууд нь БИЧСЭН хүнд тооцогддог (ажилтан
// өөрөө хянаж чадах цорын ганц тоо), энэ нь харин «түүний хариуцсан таск
// дээр хэн бичсэн»-ийг хэмжинэ.  `task_assignees` + хуучин `tasks.assigned_to`
// хоёуланг нь уншина (repo-д хоёулаа зэрэг арчлагддаг).
// АНХААР: хариуцлагын түүх хадгалагддаггүй (`syncTaskAssignees` нь DELETE +
// INSERT) тул энэ багана нь «ӨНӨӨДРИЙН хариуцлагаар» тооцогдоно.
export const MONTHLY_ATTRIBUTION_SQL = `
  WITH assignee AS (
    SELECT task_id, user_id FROM task_assignees
    UNION
    SELECT id AS task_id, assigned_to AS user_id FROM tasks WHERE assigned_to IS NOT NULL
  )
  SELECT a.user_id AS assignee_id,
         COUNT(*) AS entries_on_assigned_tasks,
         SUM(CASE WHEN pe.user_id <> a.user_id THEN 1 ELSE 0 END) AS entries_filed_by_others
  FROM progress_entries pe
  JOIN assignee a ON a.task_id = pe.task_id
  WHERE pe.date >= ?1 AND pe.date < ?2
    AND COALESCE(pe.is_baseline,    0) = 0
    AND COALESCE(pe.is_rest_day,    0) = 0
    AND COALESCE(pe.defer_next_day, 0) = 0
    AND COALESCE(pe.source, '') <> 'alloc_adj'
  GROUP BY a.user_id
`;

/** Хассан baseline мөрийн аудит — хэн хэдийг импортолсныг ил гаргана. */
const MONTHLY_BASELINE_SQL = `
  SELECT pe.user_id AS imported_by, u.full_name, COUNT(*) AS rows_excluded
  FROM progress_entries pe
  LEFT JOIN users u ON u.id = pe.user_id
  WHERE pe.date >= ?1 AND pe.date < ?2 AND pe.is_baseline = 1
  GROUP BY pe.user_id, u.full_name
  ORDER BY rows_excluded DESC
`;

interface RosterRow {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  role: UserRole;
  position: string | null;
  status: string | null;
  profile_image: string | null;
  is_support: number;
  team_code: string | null;
  team_name: string | null;
}

interface ActivityRow {
  user_id: number;
  report_days: number;
  entries_filed: number;
  projects_touched: number;
  closures_filed: number;
  closures_approved: number;
  closures_rejected: number;
}

// Модулийн wildcard нь GET-д `requireManager()` (admin + senior) тавьдаг.
// Бүх ажилтны бүтээмжийг зэрэгцүүлэн харах нь илүү хүчтэй мэдээлэл задруулалт
// бөгөөд `requireManager` нь баг/төслийн хамаарлыг ШАЛГАДАГГҮЙ (аль ч senior
// бүх фирмийг харна) тул route дээр нь илүү чанга хаалт нэмнэ.
// Route дараалал: `users.ts`-д `GET /:id` одоогоор БАЙХГҮЙ тул мөргөлдөөнгүй —
// гэхдээ ирээдүйд нэмэгдвэл энэ мөр түүнээс ДЭЭР байх ёстой.
users.get('/monthly-stats', requireAdmin(), async (c) => {
  const currentMonth = monthKeyOf(todayInUB());
  const raw = c.req.query('month');
  const month = raw === undefined || raw === '' ? currentMonth : parseMonthKey(raw);
  if (!month) {
    return c.json({ error: 'month нь YYYY-MM хэлбэртэй, сар нь 01–12 байх ёстой' }, 400);
  }
  const { from, to } = monthRange(month);

  const [roster, activity, attendance, points, attribution, baseline] = await Promise.all([
    c.env.DB.prepare(MONTHLY_ROSTER_SQL).bind(from, to).all<RosterRow>(),
    c.env.DB.prepare(MONTHLY_ACTIVITY_SQL).bind(from, to).all<ActivityRow>(),
    c.env.DB.prepare(MONTHLY_ATTENDANCE_SQL)
      .bind(from, to)
      .all<{ user_id: number; attended_days: number }>(),
    c.env.DB.prepare(MONTHLY_POINTS_SQL)
      .bind(from, to, `${orgUtcOffsetMinutes() >= 0 ? '+' : '-'}${Math.abs(orgUtcOffsetMinutes())} minutes`)
      .all<{ user_id: number; progress_points: number | null }>(),
    c.env.DB.prepare(MONTHLY_ATTRIBUTION_SQL).bind(from, to).all<{
      assignee_id: number;
      entries_on_assigned_tasks: number;
      entries_filed_by_others: number;
    }>(),
    c.env.DB.prepare(MONTHLY_BASELINE_SQL).bind(from, to).all<{
      imported_by: number;
      full_name: string | null;
      rows_excluded: number;
    }>(),
  ]);

  const activityBy = new Map((activity.results ?? []).map((r) => [r.user_id, r]));
  const attendanceBy = new Map((attendance.results ?? []).map((r) => [r.user_id, r.attended_days]));
  const pointsBy = new Map((points.results ?? []).map((r) => [r.user_id, r.progress_points ?? 0]));
  const attributionBy = new Map((attribution.results ?? []).map((r) => [r.assignee_id, r]));

  const rows = (roster.results ?? []).map((u) => {
    const a = activityBy.get(u.user_id);
    const attr = attributionBy.get(u.user_id);
    const attendedDays = attendanceBy.get(u.user_id) ?? 0;
    const reportDays = a?.report_days ?? 0;
    // CEO нь ирцээс бүрэн чөлөөлөгдсөн (lib/ceo.ts) тул түүний хуваарь
    // харьцуулах боломжгүй — хувийг нь огт бодохгүй.
    const ceo = isCeo(u.user_id);
    const rate =
      ceo || attendedDays <= 0 ? null : Math.round((reportDays / attendedDays) * 1000) / 10;

    return {
      user_id: u.user_id,
      full_name: u.full_name,
      employee_id: u.employee_id,
      role: u.role,
      position: u.position,
      status: u.status,
      profile_image: u.profile_image,
      is_support: u.is_support,
      team_code: u.team_code,
      team_name: u.team_name,
      is_ceo: ceo,
      attended_days: attendedDays,
      report_days: reportDays,
      reporting_rate_pct: rate,
      entries_filed: a?.entries_filed ?? 0,
      closures_filed: a?.closures_filed ?? 0,
      closures_approved: a?.closures_approved ?? 0,
      closures_rejected: a?.closures_rejected ?? 0,
      progress_points: pointsBy.get(u.user_id) ?? 0,
      projects_touched: a?.projects_touched ?? 0,
      entries_on_assigned_tasks: attr?.entries_on_assigned_tasks ?? 0,
      entries_filed_by_others: attr?.entries_filed_by_others ?? 0,
    };
  });

  return c.json({
    month,
    range: { from, to },
    current_month: currentMonth,
    rows,
    baseline_excluded: baseline.results ?? [],
  });
});

// POST /api/users
users.post('/', async (c) => {
  const body = await c.req.json<CreateUserRequest & { team_ids?: TeamMembershipInput[] }>();
  const { username, password, full_name, role, team_id, position, employee_id } = body;
  // INSERT-ийн үед undefined ба null-ийг ялгах хэрэггүй — хоёулаа NULL.
  const seniorityIn = normaliseSeniority(body.seniority) ?? null;
  const emailIn = normaliseEmail(body.email);
  // Дэмжих ажилтан (цэвэрлэгч гэх мэт) — бүтээмжийн самбараас хасагдана.
  const isSupport = body.is_support ? 1 : 0;
  if (emailIn === 'invalid') {
    return c.json({ error: 'Имэйл хаяг буруу байна' }, 400);
  }

  if (!username || !password || !full_name || !role) {
    return c.json({ error: 'All fields are required: username, password, full_name, role' }, 400);
  }

  if (!VALID_ROLES.includes(role as UserRole)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  if (password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400);
  }

  // Uniqueness checks up front so we can return a friendly 409 instead of a
  // raw UNIQUE constraint error.
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first();
  if (existing) return c.json({ error: 'Username already exists' }, 409);

  if (employee_id) {
    const existingEmp = await c.env.DB.prepare('SELECT id FROM users WHERE employee_id = ?')
      .bind(employee_id)
      .first();
    if (existingEmp) return c.json({ error: 'Employee ID already exists' }, 409);
  }

  const passwordHash = await hashPassword(password);

  const result = await c.env.DB.prepare(
    `INSERT INTO users (username, password_hash, full_name, role, team_id, position, employee_id, seniority, email, is_support)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      username,
      passwordHash,
      full_name,
      role,
      team_id ?? null,
      position ?? null,
      employee_id ?? null,
      seniorityIn,
      emailIn ?? null,
      isSupport,
    )
    .run();

  const newId = result.meta.last_row_id as number;

  // Sync user_teams junction table
  const teamIds: TeamMembershipInput[] = body.team_ids ?? [];
  if (Array.isArray(teamIds) && teamIds.length > 0) {
    for (const entry of teamIds.slice(0, 3)) {
      await c.env.DB.prepare(
        `INSERT INTO user_teams (user_id, team_id, is_primary) VALUES (?, ?, ?)`,
      )
        .bind(newId, entry.team_id, entry.is_primary ? 1 : 0)
        .run();
    }
  } else if (team_id) {
    await c.env.DB.prepare(`INSERT INTO user_teams (user_id, team_id, is_primary) VALUES (?, ?, 1)`)
      .bind(newId, team_id)
      .run();
  }

  // Шинэ ажилтныг нээлттэй судалгаанд ШУУД бүртгэнэ — эс бөгөөс профайл
  // дээр нь ямар ч маягт гарахгүй (`GET /assessments/my` нь урьдчилан
  // үүсгэсэн `assessment_responses` мөрөөс уншдаг).  Багийн мөрүүдийг
  // дээр бичсэний ДАРАА дуудна: хамрах хүрээ `user_teams`-ээс шалгагдана.
  // ⚠️ Судалгаа бол хэрэглэгч үүсгэхэд ХАМААРАЛГҮЙ ажил — алдаа гарвал
  //    хэрэглэгч үүсгэх үйлдлийг унагаах ёсгүй.
  try {
    await autoEnrollUserIntoOpenRounds(c.env.DB, newId);
  } catch {
    /* судалгааны бүртгэл амжилтгүй — хэрэглэгч үүссэн хэвээр */
  }

  return c.json(
    {
      message: 'User created',
      user: {
        id: newId,
        username,
        full_name,
        role,
        team_id: team_id ?? null,
        position: position ?? null,
        employee_id: employee_id ?? null,
        seniority: seniorityIn,
        email: emailIn ?? null,
        is_support: isSupport,
        status: 'active',
      },
    },
    201,
  );
});

// PUT /api/users/:id
users.put('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<UpdateUserRequest & { team_ids?: TeamMembershipInput[] }>();

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.username) {
    updates.push('username = ?');
    values.push(body.username);
  }
  if (body.full_name) {
    updates.push('full_name = ?');
    values.push(body.full_name);
  }
  if (body.role) {
    if (!VALID_ROLES.includes(body.role as UserRole)) {
      return c.json({ error: 'Invalid role' }, 400);
    }
    updates.push('role = ?');
    values.push(body.role);
  }
  // team_id / position / employee_id / email — allow explicit null to "unassign"
  if (body.team_id !== undefined) {
    updates.push('team_id = ?');
    values.push(body.team_id ?? null);
  }
  if (body.position !== undefined) {
    updates.push('position = ?');
    values.push(body.position ?? null);
  }
  if (body.employee_id !== undefined) {
    updates.push('employee_id = ?');
    values.push(body.employee_id ?? null);
  }
  if (body.seniority !== undefined) {
    const sn = normaliseSeniority(body.seniority);
    if (sn !== undefined) {
      updates.push('seniority = ?');
      values.push(sn);
    }
  }
  if (body.email !== undefined) {
    const em = normaliseEmail(body.email);
    if (em === 'invalid') {
      return c.json({ error: 'Имэйл хаяг буруу байна' }, 400);
    }
    updates.push('email = ?');
    values.push(em ?? null);
  }
  if (body.is_support !== undefined) {
    updates.push('is_support = ?');
    values.push(body.is_support ? 1 : 0);
  }
  if (body.signature_url !== undefined) {
    updates.push('signature_url = ?');
    values.push(body.signature_url ?? null);
  }
  if (body.stamp_url !== undefined) {
    updates.push('stamp_url = ?');
    values.push(body.stamp_url ?? null);
  }

  /* ---- Ажлын ээлж (админ ажилтны өмнөөс) ----
   * ⚠️ `users.work_schedule` баганад БИЧИХГҮЙ: CHECK нь 'mid'-ийг хориглоно,
   *    мөн солилт нь МАРГААШААС хүчинтэй байх ёстой (эзний шийдвэр
   *    2026-08-26).  Тиймээс `user_work_schedules` руу огноотой мөр нэмнэ.
   *    Ажилтны өөрийн `PATCH /auth/profile`-тэй ЯГ ижил зам. */
  let scheduleEffectiveDate: string | null = null;
  if (body.work_schedule !== undefined) {
    if (hasFixedShift(id)) {
      return c.json({ error: FIXED_SHIFT_LOCKED_ERROR }, 403);
    }
    if (!isScheduleKey(body.work_schedule)) {
      return c.json({ error: 'Ажлын ээлж буруу байна' }, 400);
    }
    scheduleEffectiveDate = scheduleEffectiveFrom(todayInUB());
    await setScheduleAssignment(c.env.DB, {
      userId: id,
      schedule: body.work_schedule as ScheduleKey,
      effectiveFrom: scheduleEffectiveDate,
      createdBy: c.get('user')?.sub ?? null,
    });
  }

  if (updates.length === 0) {
    // Зөвхөн ээлж солисон бол `users` мөрөнд засах юм байхгүй — 400 БИШ.
    if (scheduleEffectiveDate) {
      return c.json({ message: 'User updated', schedule_effective_from: scheduleEffectiveDate });
    }
    return c.json({ error: 'No fields to update' }, 400);
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  // 2026-09-11 (R2 аудит): гарын үсэг/тамга солигдвол хуучин объектыг цэвэрлэх
  // — UPDATE-ээс ӨМНӨ хуучин утгыг уншина (lib/mediaReplace.ts).
  const touchesMedia = body.signature_url !== undefined || body.stamp_url !== undefined;
  const prevMedia = touchesMedia
    ? await c.env.DB.prepare('SELECT signature_url, stamp_url FROM users WHERE id = ?')
        .bind(id)
        .first<{ signature_url: string | null; stamp_url: string | null }>()
    : null;

  try {
    await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
      .bind(...values)
      .run();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return c.json({ error: 'Username or employee ID already in use' }, 409);
    }
    throw err;
  }
  if (prevMedia) {
    const pairs: Array<[string | null | undefined, string | null | undefined]> = [];
    if (body.signature_url !== undefined) pairs.push([prevMedia.signature_url, body.signature_url]);
    if (body.stamp_url !== undefined) pairs.push([prevMedia.stamp_url, body.stamp_url]);
    c.executionCtx.waitUntil(deleteReplacedMediaAll(c.env, pairs));
  }

  // Sync user_teams if team_ids array provided
  const teamIds: TeamMembershipInput[] | undefined = body.team_ids;
  if (Array.isArray(teamIds)) {
    if (teamIds.length > 3) {
      return c.json({ error: 'Maximum 3 teams allowed' }, 400);
    }
    if (teamIds.length > 0) {
      const primaryCount = teamIds.filter((e) => e.is_primary).length;
      if (primaryCount !== 1) {
        return c.json({ error: 'Exactly one team must be primary' }, 400);
      }
    }
    await c.env.DB.prepare(`DELETE FROM user_teams WHERE user_id = ?`).bind(id).run();
    for (const entry of teamIds) {
      await c.env.DB.prepare(
        `INSERT INTO user_teams (user_id, team_id, is_primary) VALUES (?, ?, ?)`,
      )
        .bind(id, entry.team_id, entry.is_primary ? 1 : 0)
        .run();
    }
    const primaryTeamId = teamIds.find((e) => e.is_primary)?.team_id ?? null;
    await c.env.DB.prepare(`UPDATE users SET team_id = ? WHERE id = ?`)
      .bind(primaryTeamId, id)
      .run();
  } else if (body.team_id !== undefined) {
    // Legacy single team_id: sync as sole primary in user_teams
    await c.env.DB.prepare(`DELETE FROM user_teams WHERE user_id = ? AND is_primary = 1`)
      .bind(id)
      .run();
    if (body.team_id != null) {
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO user_teams (user_id, team_id, is_primary) VALUES (?, ?, 1)`,
      )
        .bind(id, body.team_id)
        .run();
    }
  }

  // Баг эсвэл role өөрчлөгдсөн байж болно — хамрагдах ёстой нээлттэй
  // судалгаанд нөхөж бүртгэнэ (жишээ нь client → engineer болгож зассан).
  // Хасалт хийхгүй: дээрх `PATCH /:id/team`-ийн тайлбарыг үз.
  try {
    await autoEnrollUserIntoOpenRounds(c.env.DB, id);
  } catch {
    /* судалгааны бүртгэл амжилтгүй — хэрэглэгчийн засвар амжилттай хэвээр */
  }

  return c.json({ message: 'User updated' });
});

// PATCH /api/users/:id/status
users.patch('/:id/status', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { status } = await c.req.json<{ status: 'active' | 'inactive' }>();

  if (status !== 'active' && status !== 'inactive') {
    return c.json({ error: 'Status must be active or inactive' }, 400);
  }

  // Prevent deactivating yourself
  const currentUser = c.get('user');
  if (currentUser.sub === id) {
    return c.json({ error: 'Cannot change your own status' }, 400);
  }

  if (status === 'inactive') {
    await c.env.DB.prepare(
      "UPDATE users SET status = ?, tokens_valid_from = strftime('%Y-%m-%dT%H:%M:%SZ','now'), updated_at = datetime('now') WHERE id = ?",
    )
      .bind(status, id)
      .run();
  } else {
    await c.env.DB.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(status, id)
      .run();
  }

  /* ---- ТОКЕНЫ ЦУЦЛАЛТЫН КЭШ (1A-3) --------------------------------------
   * `lib/tokenValidity.ts` нь `status`-ыг isolate бүрт 60 секунд кэшилдэг.
   * Энэ дуудлага нь ТУХАЙН isolate-ын бичлэгийг шууд арилгаж, идэвхгүй
   * болголтыг нэн даруй хүчинтэй болгоно.  Бусад isolate дээр TTL-ээр
   * (хамгийн удаад 60 сек) биелнэ — жинхэнэ баталгаа нь TTL, энэ дуудлага БИШ.
   *
   * `tokens_valid_from` нь идэвхгүй болгоход ОДОО бичигдэнэ — хуучин session,
   * Revit add-in, MCP OAuth grant (guardMcp DB шалгалт) бүгд хаагдана.
   * Эргүүлж `active` болгоход утгыг ЦЭВЭРЛЭХГҮЙ: хуучин токен сэрэх ёсгүй,
   * хэрэглэгч дахин нэвтэрнэ. */
  invalidateTokenCache(id);

  /* ---- Судалгааны жагсаалтыг мөрдүүлнэ (2026-08-19, эзний шийдвэр) ----
   *
   * ИДЭВХГҮЙ → бүх раундаас (нээлттэй ч, хаагдсан ч) хасна.  Зөвхөн
   * БӨГЛӨӨГҮЙ маягт устана; ИЛГЭЭСЭН хариулт DB-д бүтнээрээ үлдэнэ —
   * тэр нь уншихдаа `ACTIVE_PARTICIPANT_SQL`-ээр шүүгдэж харагдахгүй тул
   * дэлгэц дээрх үр дүн хүссэнтэй ижил боловч устгал буцаагдашгүй болохгүй.
   *
   * ЭРГЭЖ ИДЭВХТЭЙ → шууд буцааж бүртгэхгүй.  Уншихын шүүлт нь түүний
   * ИЛГЭЭСЭН өгөгдлийг аль хэдийн буцааж харуулна; шинээр маягт нээх нь
   * админы зориудын шийдвэр байх ёстой (Ростер самбар).  Гэхдээ нээлттэй
   * раундад хамрагдах ёстой бол автомат бүртгэл түүнийг нөхнө.
   *
   * ⚠️ Аль ч тохиолдолд алдаа нь төлөв солих үндсэн үйлдлийг унагаахгүй. */
  try {
    if (status === 'inactive') await pruneInactiveUserFromRosters(c.env.DB, id);
    else await autoEnrollUserIntoOpenRounds(c.env.DB, id);
  } catch {
    /* судалгааны жагсаалт шинэчлэгдсэнгүй — төлөв нь солигдсон хэвээр */
  }

  return c.json({ message: `User status changed to ${status}` });
});

// PATCH /api/users/:id/team — quick endpoint used by the "Move" action
// in the users table. Accepts { team_id, position }.
users.patch('/:id/team', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { team_id, position } = await c.req.json<{
    team_id: number | null;
    position?: string | null;
  }>();

  const updates: string[] = ['team_id = ?'];
  const values: (string | number | null)[] = [team_id ?? null];

  if (position !== undefined) {
    updates.push('position = ?');
    values.push(position ?? null);
  }
  updates.push("updated_at = datetime('now')");
  values.push(id);

  await c.env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  // Sync user_teams: remove old primary, insert new one
  await c.env.DB.prepare(`DELETE FROM user_teams WHERE user_id = ? AND is_primary = 1`)
    .bind(id)
    .run();
  if (team_id != null) {
    await c.env.DB.prepare(
      `INSERT OR REPLACE INTO user_teams (user_id, team_id, is_primary) VALUES (?, ?, 1)`,
    )
      .bind(id, team_id)
      .run();
  }

  // Баг солиход шинэ багийнхаа нээлттэй судалгаанд нөхөж бүртгэгдэнэ.
  // ⚠️ ХУУЧИН багийн раундаас АВТОМАТААР хасахгүй — хүн аль хэдийн үнэлгээгээ
  //    бөглөсөн байж болно, түүнийг автомат ажил устгах ёсгүй.  Хасалт бол
  //    ҮРГЭЛЖ админы зориудын үйлдэл (Ростер самбар).
  try {
    await autoEnrollUserIntoOpenRounds(c.env.DB, id);
  } catch {
    /* судалгааны бүртгэл амжилтгүй — баг солих нь амжилттай хэвээр */
  }

  return c.json({ message: 'Team assignment updated' });
});

// DELETE /api/users/:id
users.delete('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const currentUser = c.get('user');

  if (currentUser.sub === id) {
    return c.json({ error: 'Cannot delete yourself' }, 400);
  }

  // ⚠️ D1 нь runtime дээр FK-ийг мөрддөггүй тул хүүхэд мөрийг ГАРААР устгана
  //    (`email.ts`, `calendar.ts`, `pgp.ts`, `repair.ts`-тэй ижил конвенц).
  await c.env.DB.prepare('DELETE FROM user_work_schedules WHERE user_id = ?').bind(id).run();
  // «Тайлан» хуудасны хоёр хүснэгт (0310/0311).  Гэрээний PDF-ийн R2 объект
  // (MEETING_BUCKET `hr/…`) orphan болно — хэрэглэгч устгах нь маш ховор.
  await c.env.DB.prepare('DELETE FROM employee_hr WHERE user_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM employee_daily_snapshots WHERE user_id = ?').bind(id).run();
  // Ирцийн төхөөрөмжийн мөрүүд (0328).
  await c.env.DB.prepare('DELETE FROM attendance_devices WHERE user_id = ?').bind(id).run();
  // Төслийн бус ажлын бүртгэл (0342).  `reviewed_by` нь бусдын мөрөөс энэ
  // хүнийг заасан байж болох тул NULL болгоно (FK-ийн ON DELETE SET NULL-ийн гар хувилбар).
  // Ирцийн цэгийн сонголт (0357) нь бүртгэл рүү FK-гүй — эхлээд.
  await c.env.DB.prepare(
    'DELETE FROM attendance_checkpoint_non_project WHERE entry_id IN (SELECT id FROM non_project_work_entries WHERE user_id = ?)',
  )
    .bind(id)
    .run()
    .catch((err: unknown) => console.error('[users] non-project selection cleanup failed', err));
  await c.env.DB.prepare('DELETE FROM non_project_work_entries WHERE user_id = ?').bind(id).run();
  await c.env.DB.prepare('UPDATE non_project_work_entries SET reviewed_by = NULL WHERE reviewed_by = ?')
    .bind(id)
    .run();
  // Өдрийн ажлын тайлан (0345) — эхлээд түүх, дараа нь мөр.
  await c.env.DB.prepare(
    'DELETE FROM daily_work_log_revisions WHERE log_id IN (SELECT id FROM daily_work_logs WHERE user_id = ?)',
  )
    .bind(id)
    .run();
  await c.env.DB.prepare('DELETE FROM daily_work_logs WHERE user_id = ?').bind(id).run();
  // Revit-ийн автомат цаг бүртгэл (0360) — users руу FK-гүй.
  await c.env.DB.prepare('DELETE FROM revit_work_segments WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] revit tracking cleanup failed', err));
  await c.env.DB.prepare('DELETE FROM revit_work_presence WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] revit presence cleanup failed', err));
  // Албан ёсны таскийн таймер (0361) — users руу FK-гүй.
  await c.env.DB.prepare('DELETE FROM task_timer_sessions WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] task timer cleanup failed', err));
  await c.env.DB.prepare('DELETE FROM task_timer_events WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] task timer events cleanup failed', err));
  // Таскийн хуваарилалт (0376): хүний хуваарилалтын мөр устаж хийсэн нь «эзэнгүй» (B), үлдсэн ажил чөлөөт (U) болно;
  // цагийг хүчингүй болгосон мөрүүд (0379).  Журнал (түүх) үлдэнэ.
  await detachUserFromRoots(c.env.DB, id);
  // «Миний ажлууд»-ын хувийн жагсаалт (0370) — users руу FK-гүй.
  await c.env.DB.prepare('DELETE FROM task_personal_list WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] my-task-list cleanup failed', err));
  // Програмын хүсэлтийн capability (0410) — users руу FK-гүй.  Хүсэлт, түүх нь ЗОРИУД үлдэнэ (инженерийн аудит);
  // reviewer binding нь username + employee_id-ээр тулгадаг тул устсан хүнд хэзээ ч таарахгүй (fail-closed).
  await c.env.DB.prepare('DELETE FROM access_capabilities WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] capability cleanup failed', err));
  // «Таскийг буцаах» (0386) архив — users руу FK-гүй.
  await c.env.DB.prepare('DELETE FROM task_retractions WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] task retractions cleanup failed', err));
  // Revit add-in-ий төхөөрөмжийн түлхүүр (0375) — төхөөрөмжийн мөрийг устгахаас ӨМНӨ;
  // challenge-ууд.  Аюулгүй байдлын үйл явдлын бүртгэл (revit_security_events) ЗОРИУДААР үлдэнэ.
  await c.env.DB.prepare(
    'DELETE FROM revit_device_keys WHERE device_row_id IN (SELECT id FROM revit_license_devices WHERE user_id = ?)',
  ).bind(id).run()
    .catch((err: unknown) => console.error('[users] revit device keys cleanup failed', err));
  await c.env.DB.prepare('DELETE FROM revit_device_challenges WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] revit challenges cleanup failed', err));
  // Revit add-in-ий лицензийн компьютерууд (0374) — users руу FK-гүй.
  await c.env.DB.prepare('DELETE FROM revit_license_devices WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] revit license cleanup failed', err));
  // Revit-ийн өөрчлөлтийн мэдэгдэл (0390) — alias ба хүлээн авагчийн мөр (FK-гүй).
  // Илгээсэн мэдэгдлүүд нь бусад хүлээн авагчийн түүх тул ЗОРИУДААР үлдэнэ.
  await c.env.DB.prepare('DELETE FROM revit_user_aliases WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] revit aliases cleanup failed', err));
  await c.env.DB.prepare('DELETE FROM revit_change_notice_recipients WHERE user_id = ?').bind(id).run()
    .catch((err: unknown) => console.error('[users] revit change notice recipients cleanup failed', err));
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  // Устгасан хэрэглэгчийн кэшлэгдсэн мөрийг арилгана — эс тэгвэл түүний токен
  // энэ isolate дээр TTL дуустал (60 сек) хүчинтэй хэвээр байна (1A-3).
  invalidateTokenCache(id);
  return c.json({ message: 'User deleted' });
});

// POST /api/users/:id/reset-password (admin resets a user's password)
users.post('/:id/reset-password', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { new_password } = await c.req.json<{ new_password: string }>();

  if (!new_password || new_password.length < 6) {
    return c.json({ error: 'Password must be at least 6 characters' }, 400);
  }

  const hash = await hashPassword(new_password);
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(hash, id)
    .run();

  return c.json({ message: 'Password reset successfully' });
});

// GET /api/users/:id/devices — ирцийн холбогдсон браузер/төхөөрөмжүүд (0328).
// Reset dialog-д «юу холбогдсон бэ» гэж харуулна.  Идэвхтэй + сүүлийн
// 20 хаагдсан мөр; `hw_json`-ийн GPU/дэлгэц нь «ижил компьютер юу» гэдгийг
// админд ойлгуулна.
users.get('/:id/devices', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { results } = await c.env.DB.prepare(
    `SELECT id, browser_id, hw_hash, hw_json, user_agent, bound_via, bound_at,
            last_seen_at, revoked_at
       FROM attendance_devices
      WHERE user_id = ?
      ORDER BY (revoked_at IS NULL) DESC, bound_at DESC, id DESC
      LIMIT 40`,
  )
    .bind(id)
    .all<{
      id: number;
      browser_id: string;
      hw_hash: string | null;
      hw_json: string | null;
      user_agent: string | null;
      bound_via: string;
      bound_at: string;
      last_seen_at: string | null;
      revoked_at: string | null;
    }>();
  const devices = (results ?? []).map((r) => {
    let hw: { gpu?: string | null; screen?: string | null; cores?: number | null } = {};
    try {
      hw = r.hw_json ? (JSON.parse(r.hw_json) as typeof hw) : {};
    } catch {
      hw = {};
    }
    return {
      id: r.id,
      browser: browserLabel(r.user_agent),
      bound_via: r.bound_via,
      bound_at: r.bound_at,
      last_seen_at: r.last_seen_at,
      revoked_at: r.revoked_at,
      /** hw_hash ижил мөрүүд = нэг компьютер гэж таньсан. */
      hw_group: r.hw_hash ? r.hw_hash.slice(0, 8) : null,
      gpu: hw.gpu ?? null,
      screen: hw.screen ?? null,
      cores: hw.cores ?? null,
    };
  });
  return c.json({ devices });
});

// POST /api/users/:id/reset-device — clear the user's bound attendance device
// so their next clock-in from a PC re-binds (PC солих / storage цэвэрлэгдсэн
// тохиолдолд).  Зөвхөн холболтыг цэвэрлэнэ — ирцийн түүхэнд нөлөөлөхгүй.
// 0328-аас хойш `attendance_devices`-ийн БҮХ идэвхтэй мөрийг ч хаана
// (`revoked_at`, устгахгүй) — эс тэгвэл хуучин мөр «идэвхтэй» хэвээр үлдэж
// шинэ компьютер танигдахгүй.
users.post('/:id/reset-device', async (c) => {
  const id = parseInt(c.req.param('id'), 10);

  await c.env.DB.prepare(
    `UPDATE users SET attendance_device_id = NULL, attendance_device_label = NULL,
       attendance_device_bound_at = NULL, updated_at = datetime('now') WHERE id = ?`,
  )
    .bind(id)
    .run();
  await revokeAllDevices(c.env.DB, id, nowInUBIso());

  return c.json({ message: 'Төхөөрөмжийн холболт цэвэрлэгдлээ' });
});

// PATCH /api/users/:id/attendance-access — toggle "ирцийн хязгаарлалтгүй".
// 1 бол хэрэглэгч admin-тай адил утаснаас ирц бүртгэх, нэг төхөөрөмжид
// холбогдохгүй, төсөл заавал сонгохгүй болно.
users.patch('/:id/attendance-access', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { unrestricted } = await c.req.json<{ unrestricted: boolean }>();

  await c.env.DB.prepare(
    "UPDATE users SET attendance_unrestricted = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(unrestricted ? 1 : 0, id)
    .run();

  return c.json({
    message: unrestricted
      ? 'Утаснаас ирц бүртгэхийг зөвшөөрлөө'
      : 'Утаснаас ирц бүртгэхийг хаалаа',
    attendance_unrestricted: unrestricted ? 1 : 0,
  });
});

// PATCH /api/users/:id/remote-access — toggle «гаднаас системд хандах».
users.patch('/:id/remote-access', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { remote } = await c.req.json<{ remote: boolean }>();

  await c.env.DB.prepare(
    "UPDATE users SET remote_access_allowed = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(remote ? 1 : 0, id)
    .run();

  invalidateRemoteAccessCache(id);

  return c.json({
    message: remote
      ? 'Гаднаас системд хандахыг зөвшөөрлөө'
      : 'Гаднаас системд хандахыг хаалаа',
    remote_access_allowed: remote ? 1 : 0,
  });
});

export default users;
