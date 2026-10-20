/**
 * Leave requests (чөлөөний хуудас) — request, list, approve, reject.
 *
 * Workflow:
 *   - Employees POST a request (annual / sick / unpaid / remote / other)
 *     with date range + optional reason + optional attachment URL.
 *   - Admin / senior reviewers list pending requests via GET /api/leaves
 *     and approve/reject through dedicated POST endpoints (audit-friendly).
 *   - Employees can DELETE their own request while it's still pending.
 *   - Админ ажилтны ӨМНӨӨС нөхөж бүртгэнэ: POST /api/leaves + user_id
 *     (+ submit_as_pending) — ажилтны цонх өнгөрсөн өдрийг хаадаг тул
 *     (lib/leaveWindow.ts) өчигдрийн чөлөөг системд оруулах цорын ганц зам.
 *
 * The `days` field is stored verbatim from the form so half-days
 * survive without inventing a separate hours column.  When the client
 * doesn't supply it we default to (end - start + 1) so the row is
 * always non-zero for the timesheet aggregator.
 */
import { Hono, type Context } from 'hono';
import { requireRole } from '../middleware/auth';
import { attendanceRosterSql } from '../lib/attendanceRoster';
import { STANDARD_WORK_DAY_HOURS, type Env, type AppVariables } from '../types';
import {
  LEAVE_POLICY,
  computePolicyWarnings,
  findLeavePolicy,
  ymOf,
  yqOf,
  CEO_APPROVAL_DAY_THRESHOLD,
  type LeaveDayPart,
} from '../lib/leavePolicy';
import { LATE_NOT_WAIVED_SQL } from '../lib/leaveWaiver';
import {
  closedWindowMessage,
  getLeaveWindow,
  resolveShiftOn,
  validateLeaveTiming,
} from '../lib/leaveWindow';
import { findOverlappingLeave } from '../lib/leaveOverlap';
import { syncLeaveArrivalCutsForLeave } from '../lib/leaveArrivalCutStore';
import { dayPartWindow, isDayPart } from '../lib/leaveDayPart';
import { hhmmOfMinutes } from '../lib/workSchedule';
import { getAttendanceSettings } from '../lib/settings';
import { lunchWindowOf } from '../lib/nonProjectWork';
import { leaveRangeHours } from '../lib/leaveHours';
import { getHolidaySet } from '../lib/holidays';
import { createNotification, createNotificationForReviewers } from '../lib/notify';
import { logAdminAction } from '../lib/adminLog';

type AppCtx = Context<{ Bindings: Env; Variables: AppVariables }>;

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type LeaveType = 'annual' | 'sick' | 'unpaid' | 'remote' | 'other';
const LEAVE_TYPES: LeaveType[] = ['annual', 'sick', 'unpaid', 'remote', 'other'];

interface LeaveRow {
  id: number;
  user_id: number;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  days: number;
  hours: number | null;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  reason_code: string | null;
  is_paid: number | null;
  attachment_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reviewer_id: number | null;
  reviewer_note: string | null;
  decided_at: string | null;
  // Цуцлалтын audit (0100) — анхны зөвшөөрлийн reviewer_* талбаруудыг
  // дарж бичихгүйн тулд тусдаа хадгална.
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_note: string | null;
  // Админ ажилтны өмнөөс шууд бүртгэсэн бол үүсгэгч (0102).
  created_by: number | null;
  // Ирсэн цагаар богиносохоос ӨМНӨХ анхны утга (0364).  NULL = богиносоогүй.
  arrival_orig_start_time?: string | null;
  arrival_orig_end_time?: string | null;
  arrival_orig_hours?: number | null;
  arrival_orig_days?: number | null;
  created_at: string;
  updated_at: string;
  // Joined columns:
  full_name?: string;
  employee_id?: string | null;
  profile_image?: string | null;
  team_code?: string | null;
  reviewer_name?: string | null;
  canceller_name?: string | null;
  creator_name?: string | null;
  /** `leave_arrival_cuts`-ийн JSON массив (LIST_SQL) — enrich нь задална. */
  arrival_cuts_json?: string | null;
}

/**
 * `leave_requests`-ийн нийтлэг INSERT баганууд.  Гурван хувилбар
 * (ажилтны хүсэлт / админ нөхөж бүртгэсэн pending / админ шууд
 * зөвшөөрсөн approved) яг эдгээр 12 баганыг ижил дарааллаар бичдэг тул
 * нэг эх сурвалжаас уншина — нэгийг нь мартаад bind-ын дараалал
 * гулсах эрсдэлийг арилгана.
 */
const LEAVE_INSERT_COLS =
  'user_id, leave_type, start_date, end_date, days, hours, ' +
  'start_time, end_time, reason, reason_code, is_paid, attachment_url';
const LEAVE_INSERT_VALS = new Array(12).fill('?').join(', ');

const LIST_SQL = `
  SELECT lr.*,
         u.full_name, u.employee_id, u.profile_image,
         pt.code AS team_code,
         rv.full_name AS reviewer_name,
         cv.full_name AS canceller_name,
         cr.full_name AS creator_name,
         -- Ирсэн цагаар богиносгосон өдрүүд (0364).  PK (leave_id, date)-ийн
         -- индексээр уншигдах тул огнооны дарааллаар ирнэ.
         (SELECT json_group_array(json_object(
                   'date', c.date, 'arrival', c.arrival,
                   'start_time', c.start_time, 'end_time', c.end_time,
                   'full_minutes', c.full_minutes, 'used_minutes', c.used_minutes))
            FROM leave_arrival_cuts c
           WHERE c.leave_id = lr.id
         ) AS arrival_cuts_json
  FROM leave_requests lr
  JOIN users u ON u.id = lr.user_id
  LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
  LEFT JOIN teams pt ON pt.id = ut_p.team_id
  LEFT JOIN users rv ON rv.id = lr.reviewer_id
  LEFT JOIN users cv ON cv.id = lr.cancelled_by
  LEFT JOIN users cr ON cr.id = lr.created_by
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDate(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  // Loose ISO check — D1 will store anything but the UI assumes yyyy-mm-dd.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function diffInclusiveDays(start: string, end: string): number {
  const a = new Date(start + 'T00:00:00Z').getTime();
  const b = new Date(end + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

interface ArrivalCutView {
  date: string;
  arrival: string;
  start_time: string;
  end_time: string;
  full_minutes: number;
  used_minutes: number;
}

interface EnrichedLeaveRow extends Omit<LeaveRow, 'arrival_cuts_json'> {
  policy_warnings: string[];
  requires_ceo_approval: boolean;
  /** Ирсэн цагаар богиносгосон өдрүүд (0364) — хоосон бол богиносоогүй. */
  arrival_cuts: ArrivalCutView[];
}

function parseArrivalCuts(json: string | null | undefined): ArrivalCutView[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as ArrivalCutView[]) : [];
  } catch {
    return [];
  }
}

/**
 * UI-д харуулах журмын сэрэмжлүүлгүүдийг тооцож хавсаргана.  Hot loop-д
 * нэмэлт DB query явуулахгүй — сар/улирлын ашиглалтын тоог энд алгасч,
 * зөвхөн нэг удаагийн хязгаараас хэтэрсэн эсэхийг шалгана.
 */
function enrichLeave(row: LeaveRow): EnrichedLeaveRow {
  const warnings = computePolicyWarnings({
    code: row.reason_code,
    days: row.days,
    hours: row.hours,
  });
  const { arrival_cuts_json, ...rest } = row;
  return {
    ...rest,
    policy_warnings: warnings,
    requires_ceo_approval: row.days >= CEO_APPROVAL_DAY_THRESHOLD,
    arrival_cuts: parseArrivalCuts(arrival_cuts_json),
  };
}

// ---------------------------------------------------------------------------
// Employee endpoints
// ---------------------------------------------------------------------------

// POST /api/leaves — submit a new request
//
// Админ/ахлах `user_id` дамжуулбал тухайн ажилтны ӨМНӨӨС чөлөө бүртгэнэ.
// Хоёр дэд горим:
//   • `submit_as_pending: true` → «нөхөж бүртгэх» (2026-08-26).  Мөр нь
//     'pending' төлөвтэй үүсэж, админ дараа нь `POST /:id/approve`-оор
//     батална.  Ажилтан өнгөрсөн огноогоор өөрөө хүсэлт илгээж чадахгүй
//     (`lib/leaveWindow.ts`) тул энэ нь өчигдрийн чөлөөг системд
//     оруулах цорын ганц зам.
//   • талбаргүй → ШУУД зөвшөөрөгдсөн (хүсэлт→зөвшөөрөл хоёр алхамгүй),
//     reviewer_id = бүртгэсэн админ.  Утсаар ирсэн яаралтай чөлөөнд.
// Хоёуланд нь created_by (0102) нь "админ бүртгэсэн" гэдгийг ялгана.
// Бусад бүх тохиолдолд хуучин шигээ өөрийн pending хүсэлт үүсгэнэ.
router.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));

  const isManager = user.role === 'admin' || user.role === 'senior';
  const requestedUserId = Number(body.user_id);
  const adminGrant =
    isManager && Number.isInteger(requestedUserId) && requestedUserId > 0;
  const targetUserId = adminGrant ? requestedUserId : user.sub;

  // ─── Нөхөж бүртгэх зам (2026-08-26) ────────────────────────────────
  // Ажилтан ӨНГӨРСӨН огноогоор хүсэлт илгээж чадахгүй (`leaveWindow.ts`),
  // тиймээс тэр өдрөө амаар/утсаар чөлөө авсан хүн админд хэлж нөхүүлнэ.
  // `submit_as_pending` ирвэл мөр нь ажилтны хүсэлт шиг 'pending'
  // төлөвтэй үүсээд, дараа нь энгийн батлах урсгалаар
  // (`POST /:id/approve`) зөвшөөрөгдөнө — ингэснээр «хэн бүртгэсэн»
  // (created_by) ба «хэн зөвшөөрсөн» (reviewer_id) хоёр тусдаа хүн
  // болж audit бүтэн үлдэнэ.  Талбар илгээгээгүй бол хуучин зан төлөв:
  // шууд 'approved' (утсаар ирсэн яаралтай чөлөөг хормын дотор бүртгэх).
  const grantPending = adminGrant && body.submit_as_pending === true;

  if (adminGrant) {
    const target = await c.env.DB.prepare(`SELECT id, role FROM users WHERE id = ?`)
      .bind(targetUserId)
      .first<{ id: number; role: string }>();
    if (!target) return c.json({ error: 'Ажилтан олдсонгүй' }, 404);
    if (target.role === 'client') {
      return c.json({ error: 'Захиалагчид чөлөө бүртгэхгүй' }, 400);
    }
  }

  const start = parseDate(body.start_date);
  const end = parseDate(body.end_date);

  // reason_code нь шинэ нарийвчилсан таксоном (Дотоод журам 11.5.x / 11.7
  // гэх мэт).  Хэрэв илгээгдсэн бол түүгээр leave_type болон is_paid-г
  // тогтооно — UI-ийн `leave_type` талбарыг үл хайхран бид журмын
  // мэдээллийг эх сурвалж болгоно.
  const reasonCodeRaw = typeof body.reason_code === 'string' ? body.reason_code.trim() : '';
  const policy = findLeavePolicy(reasonCodeRaw || null);
  const reasonCode = policy ? policy.code : null;

  // Хуучин клиент reason_code илгээгээгүй бол leave_type-аас уламжлал
  // хэвээр үлдээнэ.  Шинэ клиент policy-р дамжуулна.
  const type: LeaveType = policy
    ? policy.leave_type
    : (LEAVE_TYPES as string[]).includes(body.leave_type)
      ? (body.leave_type as LeaveType)
      : 'annual';

  // is_paid: policy-аас унагана; policy байхгүй бол хуучин үндэслэлээр.
  const isPaid: 0 | 1 = policy ? (policy.is_paid ? 1 : 0) : type === 'unpaid' ? 0 : 1;

  if (!start || !end) {
    return c.json({ error: 'start_date / end_date шаардлагатай (yyyy-mm-dd)' }, 400);
  }
  if (end < start) {
    return c.json({ error: 'Дуусах огноо эхлэхээс өмнө байж болохгүй' }, 400);
  }

  // Цаг + өдрийн хоёр форматыг нэг дор баримтлая.  Ажилтан зөвхөн
  // цагаар (4 цаг гэх мэт) оруулсан тохиолдолд `days = hours / 8`
  // гэсэн хувиргалтаар timesheet ажиллагсаагаа алдалгүй үргэлжилнэ.
  const span = diffInclusiveDays(start, end);

  // Optional time-of-day range (HH:MM).  When provided we also derive
  // `hours` from the range so the timesheet aggregator stays consistent.
  const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
  let startTime =
    typeof body.start_time === 'string' && timeRe.test(body.start_time) ? body.start_time : null;
  let endTime =
    typeof body.end_time === 'string' && timeRe.test(body.end_time) ? body.end_time : null;
  if ((startTime && !endTime) || (!startTime && endTime)) {
    return c.json({ error: 'start_time / end_time хоёулаа шаардлагатай' }, 400);
  }
  // ─── Өдрийн хэсгээр авах чөлөө (day_part) ───────────────────────────
  // Клиент цаг бичихгүй, зөвхөн `day_part: 'am'` илгээнэ; цагийг СЕРВЕР
  // гаргана.  Учир нь ээлж нь ЧӨЛӨӨНИЙ ӨДРӨӨР тодорхойлогдоно, өнөөдрийн
  // цонхоор БИШ — зуны албадлага тайлагдах, миграци 0199-ийн огноотой
  // сонголт хүчинтэй болох хоёр нь ижил өдөр тохиолддог тул өнөөдөр 08:00
  // ээлжтэй харагдаж буй хүн маргааш 09:00-аас эхэлж мэднэ.
  // `policy.fixed_day_part` нь клиентийн илгээснийг ДАРНА — `hour_cap` нь
  // зөвхөн сэрэмжлүүлэг тул хатуу баталгаа нь ЭНЭ.
  // ⚠️ `targetUserId`-ийн ээлж (дуудагчийнх БИШ) — adminGrant ч энэ блокоор.
  // ⚠️ БАЙРЛАЛ: (a) доорх `rangeHours` эндээс hours=4 гаргана; (b)
  //    `validateLeaveTiming` нь `startTime === null` бол БҮТЭН ӨДРИЙН
  //    дүрэм хэрэглэнэ; (c) adminGrant-ийн давхцлын шалгалт цаг null
  //    ирвэл `leaveOverlap.ts`-ийн ерөнхий `return true` руу унана.
  if (body.day_part != null && !isDayPart(body.day_part)) {
    return c.json({ error: 'day_part зөвхөн "am" байна' }, 400);
  }
  const dayPart: LeaveDayPart | null =
    policy?.fixed_day_part ?? (isDayPart(body.day_part) ? body.day_part : null);
  if (dayPart) {
    // `routes/attendance.ts` нь `hours`-ийг календарь өдрийн тоонд
    // ХУВААДАГ тул олон хоногийн 4 цаг чимээгүй гажина.
    if (start !== end) {
      return c.json({ error: 'Өдрийн хэсгээр авах чөлөө нэг өдөрт л ногдоно' }, 400);
    }
    const { shift } = await resolveShiftOn(c.env.DB, targetUserId, start);
    const w = dayPartWindow(shift.startMinutes, dayPart);
    startTime = hhmmOfMinutes(w.startMinutes);
    endTime = hhmmOfMinutes(w.endMinutes);
  }

  // Цагтай чөлөөний цаг = цонх − ЦАЙНЫ ЦАГ (2026-10-12, `lib/leaveHours.ts`).
  // Ажлын өдөр ээлж − цай = 8 цаг тул чөлөө ч ижил хэмжүүрээр: 09:16–18:00 →
  // 7.73 цаг (өмнө нь цайтай нь 8.73 болж «8 цагаас хэтэрлээ» гэж унадаг байв).
  let rangeHours: number | null = null;
  if (startTime && endTime) {
    const lunch = lunchWindowOf(await getAttendanceSettings(c.env.DB));
    rangeHours = leaveRangeHours(startTime, endTime, lunch);
    if (rangeHours === null) {
      return c.json({ error: 'Дуусах цаг эхлэхээс хойш байх ёстой' }, 400);
    }
    if (rangeHours <= 0) {
      return c.json({ error: 'Сонгосон цаг бүхэлдээ цайны цагт багтаж байна' }, 400);
    }
    if (start === end && rangeHours > STANDARD_WORK_DAY_HOURS) {
      return c.json(
        {
          error: `Нэг өдрийн чөлөө ${STANDARD_WORK_DAY_HOURS} ажлын цагаас хэтэрч болохгүй (цайны цаг тооцогдохгүй) — сонгосон нь ${rangeHours} цаг`,
        },
        400,
      );
    }
  }

  // ─── Ажлын цагийн цонх (2026-08-13) ────────────────────────────────
  // Ажилтан хүсэлтээ ЗӨВХӨН ажлын цагаар илгээнэ, бүтэн өдрийн чөлөөг
  // хамгийн эрт маргаашаас авна.  Ажлын бус цагт / яаралтай үед утсаар
  // мэдэгдэж, админ `user_id`-тай (adminGrant) бүртгэнэ — тиймээс
  // adminGrant зам энэ шалгалтаас чөлөөтэй.  Дэлгэрэнгүйг
  // `lib/leaveWindow.ts`-ээс үзнэ үү.
  if (!adminGrant) {
    const win = await getLeaveWindow(c.env.DB, targetUserId);
    if (!win.open) {
      return c.json({ error: closedWindowMessage(win), leave_window: win }, 403);
    }
    const timingError = validateLeaveTiming(win, { start, startTime });
    if (timingError) {
      return c.json({ error: timingError, leave_window: win }, 400);
    }
  }

  // ─── Давхардлын хамгаалалт (2026-08-26) ────────────────────────────
  // ЗӨВХӨН adminGrant зам.  Нөхөж бүртгэх үед нэг өдрийг хоёр удаа
  // бичих эрсдэл өндөр (ажилтан утсаар хэлсэн → өөр админ дахин
  // бүртгэнэ) бөгөөд давхардсан мөр ирцийн тайланд чөлөөний цагийг
  // хоёр дахин тоолуулна.  SQL нь огнооны огтлолцлыг шүүнэ, дүрмийн
  // нарийн хэсэг (нэг өдрийн хоёр цагийн чөлөө зэрэгцэж болно) нь
  // `lib/leaveOverlap.ts`-д — цэвэр функц тул тесттэй.
  if (adminGrant) {
    const { results: sameSpanLeaves } = await c.env.DB.prepare(
      `SELECT id, start_date, end_date, start_time, end_time, status
         FROM leave_requests
        WHERE user_id = ?
          AND status IN ('pending','approved')
          AND start_date <= ? AND end_date >= ?`,
    )
      .bind(targetUserId, end, start)
      .all<{
        id: number;
        start_date: string;
        end_date: string;
        start_time: string | null;
        end_time: string | null;
        status: string;
      }>();
    const clash = findOverlappingLeave(
      { start_date: start, end_date: end, start_time: startTime, end_time: endTime },
      sameSpanLeaves ?? [],
    );
    if (clash) {
      const statusLabel = clash.status === 'pending' ? 'хүлээгдэж буй' : 'зөвшөөрөгдсөн';
      return c.json(
        {
          error:
            `Тухайн ажилтанд ${clash.start_date} – ${clash.end_date} хооронд давхцах ` +
            `чөлөө аль хэдийн бүртгэгдсэн байна (${statusLabel}). Давхардуулахгүйн тулд ` +
            `эхлээд түүнийг цуцлах/устгах, эсвэл огноогоо засна уу.`,
          conflict_leave_id: clash.id,
        },
        409,
      );
    }
  }

  let hours: number | null = null;
  if (rangeHours !== null) {
    hours = rangeHours;
  } else if (typeof body.hours === 'number' && body.hours > 0) {
    hours = Math.round(body.hours * 100) / 100;
    if (hours > 90 * STANDARD_WORK_DAY_HOURS) {
      hours = 90 * STANDARD_WORK_DAY_HOURS;
    }
  }

  let days: number;
  if (hours !== null) {
    // Цаг өгөгдсөн бол түүгээр өдрийг тооцоо.  0.25 алхамтай (15
    // минут) болгосон тул UI-н "хагас өдөр" / "4 цаг" сонголтууд
    // 0.5 / 0.5 болж бичигдэнэ.
    days = Math.round((hours / STANDARD_WORK_DAY_HOURS) * 100) / 100;
  } else if (typeof body.days === 'number' && body.days > 0) {
    days = body.days;
    hours = Math.round(days * STANDARD_WORK_DAY_HOURS * 100) / 100;
  } else {
    days = span;
    hours = Math.round(span * STANDARD_WORK_DAY_HOURS * 100) / 100;
  }
  if (days > 90) days = 90;

  const reason =
    typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 1000)
      : null;
  const attachment =
    typeof body.attachment_url === 'string' && body.attachment_url.trim()
      ? body.attachment_url.trim().slice(0, 500)
      : null;

  // Сар/улирлын ашиглалт — журмын 11.7 (сард 3 цалингүй хоног) болон
  // 11.5.5 (улиралд 1 удаа эмнэлгийн шинжилгээ) сэрэмжлүүлэгт хэрэгтэй.
  let monthlyUnpaidDaysUsed: number | undefined;
  let quarterlyUsesUsed: number | undefined;
  if (policy?.monthly_cap_days) {
    const ym = ymOf(start);
    const row = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(days), 0) AS d
         FROM leave_requests
        WHERE user_id = ?
          AND is_paid = 0
          AND leave_type = 'unpaid'   -- цалингүй «Өвчтэй» (2026-10-13) 11.7-ийн 3 хоногт орохгүй
          AND status IN ('pending','approved')
          AND substr(start_date, 1, 7) = ?`,
    )
      .bind(targetUserId, ym)
      .first<{ d: number }>();
    monthlyUnpaidDaysUsed = row?.d ?? 0;
  }
  if (policy?.quarterly_uses && reasonCode) {
    const yq = yqOf(start);
    // SQLite-д улирлаар бүлэглэх энгийн арга байхгүй тул start_date-уудыг
    // авч JS дээр тоолно (ажилтан тус бүрт цөөн бичлэгтэй учраас хямд).
    const all = await c.env.DB.prepare(
      `SELECT start_date FROM leave_requests
        WHERE user_id = ? AND reason_code = ?
          AND status IN ('pending','approved')`,
    )
      .bind(targetUserId, reasonCode)
      .all<{ start_date: string }>();
    quarterlyUsesUsed = (all.results ?? []).filter((r) => yqOf(r.start_date) === yq).length;
  }

  const warnings = computePolicyWarnings({
    code: reasonCode,
    days,
    hours,
    monthlyUnpaidDaysUsed,
    quarterlyUsesUsed,
  });
  const requiresCeoApproval = days >= CEO_APPROVAL_DAY_THRESHOLD;

  // Бүх хувилбарт ижил 12 утга — `LEAVE_INSERT_COLS`-ийн дараалалтай
  // 1:1.  Ялгаа нь зөвхөн ард нь залгагдах status/reviewer/created_by.
  const insertValues = [
    targetUserId,
    type,
    start,
    end,
    days,
    hours,
    startTime,
    endTime,
    reason,
    reasonCode,
    isPaid,
    attachment,
  ];

  // Гурван зан төлөв:
  //   • adminGrant + submit_as_pending → 'pending', reviewer хоосон,
  //     created_by = бүртгэсэн админ (нөхөж бүртгэх зам).
  //   • adminGrant                     → шууд 'approved' (reviewer = админ).
  //   • ажилтны өөрийн хүсэлт          → хуучин шигээ анхдагч 'pending'.
  const result = adminGrant
    ? grantPending
      ? await c.env.DB.prepare(
          `INSERT INTO leave_requests (${LEAVE_INSERT_COLS}, status, created_by)
           VALUES (${LEAVE_INSERT_VALS}, 'pending', ?)`,
        )
          .bind(...insertValues, user.sub)
          .run()
      : await c.env.DB.prepare(
          `INSERT INTO leave_requests
             (${LEAVE_INSERT_COLS}, status, reviewer_id, decided_at, created_by)
           VALUES (${LEAVE_INSERT_VALS}, 'approved', ?, datetime('now'), ?)`,
        )
          .bind(...insertValues, user.sub, user.sub)
          .run()
    : await c.env.DB.prepare(
        `INSERT INTO leave_requests (${LEAVE_INSERT_COLS})
         VALUES (${LEAVE_INSERT_VALS})`,
      )
        .bind(...insertValues)
        .run();

  if (adminGrant) {
    // Шууд зөвшөөрсөн бол ажилтанд нь тэр даруй мэдэгдэнэ.  Нөхөж
    // бүртгэсэн (pending) мөрөнд ЭНД мэдэгдэл явуулахгүй — батлах үед
    // `decide()` нь 'leave_approved'-ыг өөрөө илгээх тул хоёр удаа
    // мэдэгдвэл ажилтанд ойлгомжгүй болно.  Ажилтан хүсэлтээ
    // `GET /api/leaves/my` (Миний чөлөө карт)-аас шууд хардаг.
    if (!grantPending && targetUserId !== user.sub) {
      await createNotification(
        c.env.DB,
        targetUserId,
        'leave_approved',
        'Танд чөлөө бүртгэгдлээ',
        `${start} – ${end}${reason ? ` — ${reason}` : ''}`,
        '/app/attendance',
      );
    }
    // Шууд батлагдсан чөлөө: ажилтан аль хэдийн ирсэн бол (утсаар хэлсэн
    // яаралтай чөлөөг ирсний дараа бүртгэх) ирсэн цагаар богиносно (0364).
    if (!grantPending) {
      await syncLeaveArrivalCutsForLeave(c.env.DB, Number(result.meta.last_row_id));
    }
    await logAdminAction(c.env.DB, {
      actorId: user.sub,
      targetUserId,
      action: 'leave_create',
      date: start,
      details:
        `${type} · ${start} – ${end} (${days} өдөр)` +
        `${grantPending ? ' · нөхөж бүртгэв (хүлээгдэж буй)' : ''}` +
        `${reason ? ` — ${reason}` : ''}`,
    });
  }

  const row = await c.env.DB.prepare(`${LIST_SQL} WHERE lr.id = ?`)
    .bind(result.meta.last_row_id)
    .first<LeaveRow>();

  // POST хариунд сар/улирлын контекст бүхий бүрэн warnings-г хадгалахын
  // тулд enrich-ын дотоод тооцоог дарж өгнө.
  const enriched: EnrichedLeaveRow | null = row
    ? { ...enrichLeave(row), policy_warnings: warnings, requires_ceo_approval: requiresCeoApproval }
    : null;
  // Ажилтны ӨӨРИЙН хүсэлтэд урьд нь ХЭН Ч мэдэгдэл авдаггүй байсан (бүх
  // notify блок `if (adminGrant)`-ийн дотор).  Хоцролтын цуцлалт
  // (`lib/leaveWaiver.ts`) ба «ирээгүй» жагсаалтаас хасагдах
  // (`routes/attendance.ts`) хоёул `status='approved'` ШААРДДАГ тул
  // батлагдаагүй хүсэлт нь ажилтанд бодит торгууль үүсгэнэ.
  // teamId = null → `notify.ts`-ийн бүх идэвхтэй admin.  Senior БИШ:
  // чөлөө батлах дэлгэц нь зөвхөн админд нээлттэй.
  // Best-effort — `createNotificationForReviewers` дотроо алдааг залгидаг.
  if (!adminGrant) {
    await createNotificationForReviewers(
      c.env.DB,
      null,
      'leave_requested',
      'Чөлөөний хүсэлт ирлээ',
      `${row?.full_name ?? ''} · ${start}${start !== end ? ` – ${end}` : ''}` +
        `${hours !== null ? ` · ${hours} ц` : ''}${policy ? ` · ${policy.label}` : ''}`,
      '/app/attendance/admin?tab=leaves',
      user.sub,
    );
  }

  return c.json({ leave: enriched }, 201);
});

// GET /api/leaves/my — caller's own requests
router.get('/my', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    `
    ${LIST_SQL}
    WHERE lr.user_id = ?
    ORDER BY lr.start_date DESC, lr.id DESC
    LIMIT 100
  `,
  )
    .bind(user.sub)
    .all<LeaveRow>();
  return c.json({ leaves: (results ?? []).map(enrichLeave) });
});

// GET /api/leaves/policy — UI зориулсан таксомоны жагсаалт
router.get('/policy', (c) => {
  return c.json({ policy: LEAVE_POLICY });
});

// GET /api/leaves/window — хүсэлт илгээх ажлын цагийн цонх.
// Форм нээхээс өмнө UI үүнийг уншиж, хаалттай бол мессеж харуулна.
// Амралтын өдөр `holidays` хүснэгтэд байдаг тул клиент дангаараа
// тооцох боломжгүй — сервер л мэднэ.  Хатуу шалгалт нь POST дээр.
router.get('/window', async (c) => {
  const user = c.get('user');
  const win = await getLeaveWindow(c.env.DB, user.sub);
  // ?date= — ТУХАЙН өдрийн ээлж.  `win` нь ӨНӨӨДРИЙН цонх бөгөөд
  // `closedWindowMessage` түүний shift_* талбаруудаас хамаардаг тул
  // ХЭЗЭЭ Ч дарж бичихгүй — тусдаа `for_date` блок.  ЗӨВХӨН өөрийн
  // ээлж (user_id параметр САНААТАЙГААР байхгүй — шинэ эрхийн гадаргуу
  // нээхгүй; админ нь батлахын өмнө жагсаалтад гарсан цагийг хардаг).
  const dateParam = c.req.query('date');
  // Цайны цонх — форм чөлөөний цагийг серверийн `leaveRangeHours`-тэй ИЖИЛ
  // (цай хассан) харуулж, «4 цаг» сонголтын дуусах цагийг цайг алгасаж бодно.
  const lunch = lunchWindowOf(await getAttendanceSettings(c.env.DB));
  let forDate: {
    date: string;
    schedule: string;
    shift_label: string;
    shift_start: string;
    shift_end: string;
    am: { start_time: string; end_time: string; hours: number };
  } | null = null;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const { schedule, shift } = await resolveShiftOn(c.env.DB, user.sub, dateParam);
    const w = dayPartWindow(shift.startMinutes, 'am');
    forDate = {
      date: dateParam,
      schedule,
      shift_label: shift.label,
      shift_start: hhmmOfMinutes(shift.startMinutes),
      shift_end: hhmmOfMinutes(shift.endMinutes),
      am: {
        start_time: hhmmOfMinutes(w.startMinutes),
        end_time: hhmmOfMinutes(w.endMinutes),
        // POST-ийн `rangeHours`-тэй ижил томьёо (цай хасна).
        hours:
          leaveRangeHours(hhmmOfMinutes(w.startMinutes), hhmmOfMinutes(w.endMinutes), lunch) ??
          w.hours,
      },
    };
  }
  return c.json({
    window: win,
    message: win.open ? null : closedWindowMessage(win),
    for_date: forDate,
    lunch: lunch ? { start: hhmmOfMinutes(lunch.start), end: hhmmOfMinutes(lunch.end) } : null,
  });
});

// DELETE /api/leaves/:id — employee can withdraw a still-pending request
router.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT user_id, status, start_date, end_date FROM leave_requests WHERE id = ?`,
  )
    .bind(id)
    .first<{ user_id: number; status: string; start_date: string; end_date: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  const isOwner = row.user_id === user.sub;
  const isManager = user.role === 'admin' || user.role === 'senior';
  if (!isManager && !(isOwner && row.status === 'pending')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // D1 FK-г ажиллах үед мөрддөггүй — хүүхэд мөрийг гараар (0364).
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM leave_arrival_cuts WHERE leave_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM leave_requests WHERE id = ?`).bind(id),
  ]);

  // Менежер БУСДЫН бичлэгийг устгавал audit лог үлдээнэ — ажилтны өөрийн
  // pending хүсэлтээ татах нь админ үйлдэл биш тул логгүй.
  if (isManager && !isOwner) {
    await logAdminAction(c.env.DB, {
      actorId: user.sub,
      targetUserId: row.user_id,
      action: 'leave_delete',
      date: row.start_date,
      details: `${row.start_date} – ${row.end_date} (${row.status})`,
    });
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Manager endpoints
// ---------------------------------------------------------------------------

// GET /api/leaves — all requests with optional filters (admin / senior)
router.get('/', requireRole('admin', 'senior'), async (c) => {
  const status = c.req.query('status'); // pending | approved | rejected | cancelled
  const from = c.req.query('from'); // overlap start
  const to = c.req.query('to'); // overlap end
  const userId = c.req.query('user_id');
  // Төрлийн дэд таб: 'annual' = зөвхөн ээлжийн амралт, 'other' = бусад бүх
  // чөлөө (ээлжийн амралтаас бусад).  Заагаагүй бол бүх төрөл (хуучин зан төлөв).
  const leaveType = c.req.query('leave_type');
  const typeCond =
    leaveType === 'annual'
      ? "lr.leave_type = 'annual'"
      : leaveType === 'other'
        ? "lr.leave_type != 'annual'"
        : null;

  const conditions: string[] = [];
  const binds: (string | number)[] = [];

  if (status) {
    conditions.push('lr.status = ?');
    binds.push(status);
  }
  if (userId) {
    conditions.push('lr.user_id = ?');
    binds.push(parseInt(userId, 10));
  }
  // Range overlap: keep rows that intersect [from, to]
  if (from) {
    conditions.push('lr.end_date >= ?');
    binds.push(from);
  }
  if (to) {
    conditions.push('lr.start_date <= ?');
    binds.push(to);
  }
  if (typeCond) {
    conditions.push(typeCond);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `
    ${LIST_SQL}
    ${where}
    ORDER BY
      CASE lr.status WHEN 'pending' THEN 0 ELSE 1 END,
      lr.start_date DESC, lr.id DESC
    LIMIT 500
  `,
  )
    .bind(...binds)
    .all<LeaveRow>();

  // Quick counters so the manager UI can render badges without a 2nd RTT.
  // Статусын тоог сонгосон дэд табын төрлөөр хязгаарлана (alias-гүй хүснэгт).
  const countWhere =
    leaveType === 'annual'
      ? "WHERE leave_type = 'annual'"
      : leaveType === 'other'
        ? "WHERE leave_type != 'annual'"
        : '';
  const counts = await c.env.DB.prepare(
    `
    SELECT
      SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'approved'  THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'rejected'  THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
    FROM leave_requests
    ${countWhere}
  `,
  ).first<{ pending: number; approved: number; rejected: number; cancelled: number }>();

  return c.json({
    leaves: (results ?? []).map(enrichLeave),
    counts: {
      pending: counts?.pending ?? 0,
      approved: counts?.approved ?? 0,
      rejected: counts?.rejected ?? 0,
      cancelled: counts?.cancelled ?? 0,
    },
  });
});

async function decide(c: AppCtx, toStatus: 'approved' | 'rejected') {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) || null : null;

  // Татгалзахад шалтгаан ЗААВАЛ — ажилтанд очих мэдэгдэл нь «яагаад»-ыг
  // хэлэх ёстой (progress reject-ийн `review_note` дүрэмтэй ижил).  Өмнө нь
  // note заавал бус байсан тул татгалзлын дийлэнх мэдэгдэл зөвхөн огноотой,
  // тайлбаргүй очдог байв.
  if (toStatus === 'rejected' && !note) {
    return c.json({ error: 'Татгалзах шалтгаанаа бичнэ үү' }, 400);
  }

  const existing = await c.env.DB.prepare(
    `SELECT status, user_id, start_date, end_date FROM leave_requests WHERE id = ?`,
  )
    .bind(id)
    .first<{ status: string; user_id: number; start_date: string; end_date: string }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (existing.status !== 'pending') {
    return c.json({ error: `Аль хэдийн "${existing.status}" төлөвт оршино` }, 409);
  }

  await c.env.DB.prepare(
    `
    UPDATE leave_requests
    SET status = ?, reviewer_id = ?, reviewer_note = ?,
        decided_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `,
  )
    .bind(toStatus, user.sub, note, id)
    .run();

  // Батлагдах мөчид ажилтан аль хэдийн ирсэн бол (өглөөний чөлөө хүсээд
  // 09:00-д ирсэн, админ 10:00-д баталсан) ирсэн цагаар богиносно (0364).
  if (toStatus === 'approved') await syncLeaveArrivalCutsForLeave(c.env.DB, id);

  // Шийдвэрийг хүсэлт гаргагчид нь мэдэгдэнэ — апп руу орж гараар
  // шалгахыг хүлээлгэхгүй.  Best-effort (notify.ts алдааг залгидаг).
  if (existing.user_id !== user.sub) {
    const range =
      existing.start_date === existing.end_date
        ? existing.start_date
        : `${existing.start_date} – ${existing.end_date}`;
    await createNotification(
      c.env.DB,
      existing.user_id,
      toStatus === 'approved' ? 'leave_approved' : 'leave_rejected',
      toStatus === 'approved' ? 'Чөлөөний хүсэлт зөвшөөрөгдлөө' : 'Чөлөөний хүсэлт татгалзагдлаа',
      toStatus === 'rejected'
        ? `${range} — Шалтгаан: ${note}`
        : `${range}${note ? ` — ${note}` : ''}`,
      // Ирцийн хуудасны «Чөлөө» хэсэг рүү шууд (useSectionAnchor гялалзуулна).
      '/app/attendance?section=sec-attendance-leaves',
    );
  }

  await logAdminAction(c.env.DB, {
    actorId: user.sub,
    targetUserId: existing.user_id,
    action: toStatus === 'approved' ? 'leave_approve' : 'leave_reject',
    date: existing.start_date,
    details: `${existing.start_date} – ${existing.end_date}${note ? ` — ${note}` : ''}`,
  });

  const row = await c.env.DB.prepare(`${LIST_SQL} WHERE lr.id = ?`).bind(id).first<LeaveRow>();
  return c.json({ leave: row ? enrichLeave(row) : null });
}

router.post('/:id/approve', requireRole('admin', 'senior'), (c) => decide(c, 'approved'));
router.post('/:id/reject', requireRole('admin', 'senior'), (c) => decide(c, 'rejected'));

// POST /api/leaves/:id/cancel — зөвшөөрөгдсөн чөлөөг админ цуцлах.
// Ажилтан чөлөөтэй байх хугацаандаа ажилдаа гарсан тохиолдолд
// бичлэгийг устгахын оронд 'cancelled' төлөвт шилжүүлж (audit-friendly),
// ирц/тайлангийн бүх "status = 'approved'" join-уудаас автоматаар хасна.
router.post('/:id/cancel', requireRole('admin', 'senior'), async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id') ?? '', 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : null;

  const existing = await c.env.DB.prepare(
    `SELECT status, user_id, start_date, end_date FROM leave_requests WHERE id = ?`,
  )
    .bind(id)
    .first<{ status: string; user_id: number; start_date: string; end_date: string }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);
  // Pending хүсэлтийг "татгалзах"-аар шийднэ — цуцлалт зөвхөн аль
  // хэдийн зөвшөөрөгдсөн чөлөөнд хамаарна.
  if (existing.status !== 'approved') {
    return c.json({ error: `Зөвхөн зөвшөөрөгдсөн чөлөөг цуцална ("${existing.status}" байна)` }, 409);
  }

  // Анхны зөвшөөрлийн reviewer_id / reviewer_note / decided_at-д
  // ХҮРЭХГҮЙ — цуцлалт тусдаа cancelled_* (0100) баганад бичигдэж,
  // "хэн зөвшөөрсөн → хэн цуцалсан" түүх бүтнээрээ үлдэнэ.
  await c.env.DB.prepare(
    `
    UPDATE leave_requests
    SET status = 'cancelled', cancelled_by = ?, cancel_note = ?,
        cancelled_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `,
  )
    .bind(user.sub, note, id)
    .run();

  // Ажилтанд нь мэдэгдэнэ — чөлөө нь цуцлагдсаныг аппаас л мэдэх ёсгүй.
  if (existing.user_id !== user.sub) {
    await createNotification(
      c.env.DB,
      existing.user_id,
      'leave_cancelled',
      'Чөлөөний хүсэлт цуцлагдлаа',
      `${existing.start_date} – ${existing.end_date}${note ? ` — ${note}` : ''}`,
      '/app/attendance',
    );
  }

  await logAdminAction(c.env.DB, {
    actorId: user.sub,
    targetUserId: existing.user_id,
    action: 'leave_cancel',
    date: existing.start_date,
    details: `${existing.start_date} – ${existing.end_date}${note ? ` — ${note}` : ''}`,
  });

  const row = await c.env.DB.prepare(`${LIST_SQL} WHERE lr.id = ?`).bind(id).first<LeaveRow>();
  return c.json({ leave: row ? enrichLeave(row) : null });
});

// ---------------------------------------------------------------------------
// Aggregated timesheet — the "сарын нэгтгэл" the user asked for.
// One row per user for the date range, joining attendance + approved leave.
// ---------------------------------------------------------------------------
router.get('/timesheet', requireRole('admin', 'senior'), async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) {
    return c.json({ error: 'from / to (yyyy-mm-dd) шаардлагатай' }, 400);
  }

  // Active staff list — one row per person we want on the report.
  const { results: roster } = await c.env.DB.prepare(
    `
    SELECT u.id AS user_id, u.full_name, u.employee_id, u.profile_image,
           pt.code AS team_code, pt.name_mn AS team_name, u.position
    FROM users u
    LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
    LEFT JOIN teams pt ON pt.id = ut_p.team_id
    WHERE ${attendanceRosterSql()}
    ORDER BY u.full_name
  `,
  ).all<{
    user_id: number;
    full_name: string;
    employee_id: string | null;
    profile_image: string | null;
    team_code: string | null;
    team_name: string | null;
    position: string | null;
  }>();

  // Attendance roll-up keyed by user — late_count нь "хоцорсон
  // өдөр", `late_minutes` нь хоцорсон нийт минут.  Хоёр утга хоёул
  // UI-д хэрэг болно (нэгийг count-той, нөгөөг торгуулийн дүнтэй).
  const { results: attendanceRows } = await c.env.DB.prepare(
    `
    SELECT
      a.user_id,
      COUNT(DISTINCT a.date)                                     AS days_present,
      ROUND(COALESCE(SUM(a.hours_worked), 0), 2)                 AS total_hours,
      ROUND(COALESCE(AVG(a.hours_worked), 0), 2)                 AS avg_hours,
      SUM(CASE WHEN a.late_minutes > 0 AND ${LATE_NOT_WAIVED_SQL} THEN 1 ELSE 0 END) AS late_count,
      COALESCE(SUM(CASE WHEN ${LATE_NOT_WAIVED_SQL} THEN a.late_minutes ELSE 0 END), 0) AS late_minutes
    FROM attendance_sessions a
    WHERE a.date >= ? AND a.date <= ? AND a.clock_out IS NOT NULL
    GROUP BY a.user_id
  `,
  )
    .bind(from, to)
    .all<{
      user_id: number;
      days_present: number;
      total_hours: number;
      avg_hours: number;
      late_count: number;
      late_minutes: number;
    }>();

  // Approved leave overlapping the period — sum the days so the
  // monthly view shows "ээлжийн 5 / өвчтэй 2" naturally.
  // Цагийн нэгтгэлд hours-ыг нэмж буцаахын тулд тус бүрийг
  // SUM(hours) хэлбэрээр гаргая.  Хуучин (NULL hours) бичлэгүүдийг
  // `days * 8` гэж тооцно.
  const { results: leaveRows } = await c.env.DB.prepare(
    `
    SELECT user_id, leave_type,
           SUM(days)  AS days,
           SUM(COALESCE(hours, days * ${STANDARD_WORK_DAY_HOURS})) AS hours
    FROM leave_requests
    WHERE status = 'approved'
      AND start_date <= ?
      AND end_date   >= ?
    GROUP BY user_id, leave_type
  `,
  )
    .bind(to, from)
    .all<{
      user_id: number;
      leave_type: LeaveType;
      days: number;
      hours: number;
    }>();

  // Index the per-user data for O(1) merge.
  const att = new Map<number, (typeof attendanceRows)[number]>();
  for (const r of attendanceRows ?? []) att.set(r.user_id, r);
  const leave = new Map<number, Record<LeaveType, number>>();
  const leaveHours = new Map<number, Record<LeaveType, number>>();
  for (const r of leaveRows ?? []) {
    const cur = leave.get(r.user_id) ?? {
      annual: 0,
      sick: 0,
      unpaid: 0,
      remote: 0,
      other: 0,
    };
    cur[r.leave_type] = (cur[r.leave_type] ?? 0) + (r.days ?? 0);
    leave.set(r.user_id, cur);
    const curH = leaveHours.get(r.user_id) ?? {
      annual: 0,
      sick: 0,
      unpaid: 0,
      remote: 0,
      other: 0,
    };
    curH[r.leave_type] = (curH[r.leave_type] ?? 0) + (r.hours ?? 0);
    leaveHours.set(r.user_id, curH);
  }

  // Working-day count for the period (Mon–Fri only).  Used to compute
  // an "absent" headline number on the frontend without needing a
  // separate roundtrip.
  const holidaySet = await getHolidaySet(c.env.DB, from, to);
  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T00:00:00Z');
  let workingDays = 0;
  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    const iso = d.toISOString().slice(0, 10);
    // Нийтийн амралтын өдрийг ажиллах өдрөөс хасна — эзгүй (absent_days)
    // тооцоонд "амарсан" гэж тооцогдоно.
    if (dow !== 0 && dow !== 6 && !holidaySet.has(iso)) workingDays++;
  }

  // Хоцролтын торгуулийг код доторх тогтмолоор тооцно (1 минут =
  // 500 ₮).  HR-ийн мөнгөн дүн гаргахад шууд хэрэглэнэ.
  const LATE_PEN = 500;

  const rows = (roster ?? []).map((u) => {
    const a = att.get(u.user_id);
    const lv = leave.get(u.user_id) ?? {
      annual: 0,
      sick: 0,
      unpaid: 0,
      remote: 0,
      other: 0,
    };
    const lvH = leaveHours.get(u.user_id) ?? {
      annual: 0,
      sick: 0,
      unpaid: 0,
      remote: 0,
      other: 0,
    };
    const totalLeave = lv.annual + lv.sick + lv.unpaid + lv.remote + lv.other;
    const totalLeaveH = lvH.annual + lvH.sick + lvH.unpaid + lvH.remote + lvH.other;
    const daysPresent = a?.days_present ?? 0;
    const lateMinutes = a?.late_minutes ?? 0;
    return {
      user_id: u.user_id,
      full_name: u.full_name,
      employee_id: u.employee_id,
      profile_image: u.profile_image,
      team_code: u.team_code,
      team_name: u.team_name,
      position: u.position,
      days_present: daysPresent,
      total_hours: a?.total_hours ?? 0,
      avg_hours: a?.avg_hours ?? 0,
      late_count: a?.late_count ?? 0,
      late_minutes: lateMinutes,
      late_penalty: lateMinutes * LATE_PEN,
      leave_total: Math.round(totalLeave * 10) / 10,
      leave_total_hours: Math.round(totalLeaveH * 10) / 10,
      leave_breakdown: lv,
      leave_breakdown_hours: lvH,
      // Working days the person was neither present nor on approved
      // leave.  Negative-clamped because some folks may have logged
      // attendance on a weekend.
      absent_days: Math.max(0, workingDays - daysPresent - totalLeave),
    };
  });

  return c.json({
    period: { from, to, working_days: workingDays },
    rows,
    late_penalty_per_minute: LATE_PEN,
  });
});

export default router;
