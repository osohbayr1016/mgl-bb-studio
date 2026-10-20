import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import { todayInUB, nowInUBIso, isSummerSchedule } from '../lib/time';
import {
  SHIFTS,
  SCHEDULE_KEYS,
  effectiveSchedule,
  scheduleOutlook,
  scheduleEffectiveFrom,
  shortShiftLabel,
  hhmmOfMinutes,
  ubMinutesOf,
  type ScheduleAssignment,
  type ScheduleKey,
  type Shift,
} from '../lib/workSchedule';
import {
  getScheduleAssignments,
  getScheduleAssignmentsFor,
  loadCountingWindow,
  loadShiftForUser,
} from '../lib/scheduleStore';
import {
  SHIFT_BOUNDED_FROM,
  countingWindow,
  daySpanOf,
  isShiftBounded,
  shiftBoundedMinutes,
  shiftBoundedSessionHours,
  type DaySpan,
} from '../lib/shiftBoundedHours';
import { hasFixedShift, lateMinutesAgainstShift, shiftForUser } from '../lib/specialShift';
import { getClientIp, isOfficeIp } from '../lib/officeNetwork';
import { userHasRemoteAccess } from '../lib/officeAccess';
import { getAttendanceSettings, type AttendanceSettings } from '../lib/settings';
import {
  applyNonProjectPicks,
  loadTodayForAttendance,
  nonProjectDayCounts,
  nonProjectMeta,
  syncNonProjectCreditSafe,
} from '../lib/nonProjectWorkStore';
import {
  NON_PROJECT_WORK_ROLES,
  lunchWindowOf,
  parseNonProjectPicks,
  type NonProjectPick,
} from '../lib/nonProjectWork';
import { afterNonProjectChange } from '../lib/nonProjectSync';
import { getHolidaySet, isHoliday } from '../lib/holidays';
import { NOT_ASR_ONLY_SQL } from '../lib/asrEligible';
import { isPhoneUserAgent, getRequestDeviceId } from '../lib/device';
import { normalizeHwProfile, resolveAttendanceDevice } from '../lib/attendanceDevice';
import { LATE_NOT_WAIVED_SQL, STALE_OPEN_SESSION_SQL, isLateWaived } from '../lib/leaveWaiver';
import { lateWaiver } from '../lib/lateWaiver';
import { combineDayLeaves } from '../lib/dayLeaves';
import { addLeaveWorkMinutes } from '../lib/leaveHours';
import { countAttendanceDays } from '../lib/attendanceDayCount';
import { syncLeaveArrivalCutsSafe } from '../lib/leaveArrivalCutStore';
import { describeCut } from '../lib/leaveArrivalCut';
import { createNotification } from '../lib/notify';
import { logAdminAction } from '../lib/adminLog';
import { isAttendanceUnrestricted } from '../lib/attendanceUnrestricted';
import { stopTimerOnClockOut } from '../lib/taskTimerStore';
import { isAdminRole, isWorkerRole } from '../types';
import { attendanceRosterSql } from '../lib/attendanceRoster';
import {
  STANDARD_WORK_DAY_HOURS,
  type Env,
  type AppVariables,
  type AttendanceCheckpointRequest,
  type AttendanceCheckpointType,
  type AttendanceSessionRow,
  type ClockInRequest,
  type ClockOutRequest,
} from '../types';

const EXPECTED_DAY_MINUTES = STANDARD_WORK_DAY_HOURS * 60;

// Ирцээс чөлөөлөгдөх дүрэм (`ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS`,
// `isAttendanceUnrestricted`) 2026-10-01-нд `lib/attendanceUnrestricted.ts`
// руу шилжсэн — таск «Өөртөө авах» ч ЯГ ижил дүрмээр шалгадаг.

/**
 * Домэйн шилжилтийн НЭГ УДААГИЙН «дахин холбох» цонх.
 *
 * `mgl_device_id` нь браузерын `localStorage`-д хадгалагддаг ба localStorage
 * нь ORIGIN тус бүрд ТУСДАА.  2026-08-20-нд frontend нь
 * `mgl-progress-frontend.pages.dev`-ээс `mgl-design-system.pages.dev` рүү
 * шилжсэн (`backend/wrangler.toml` -> FRONTEND_URL / ALLOWED_ORIGINS) тул шинэ
 * домэйн дээр ажилтан бүрд ШИНЭ төхөөрөмжийн id үүсч, `users`-д хуучин домэйн
 * дээр холбогдсон `attendance_device_id` таарахаа больж, БҮХ хүн
 * «Энэ төхөөрөмж бүртгэлгүй байна» гэсэн 403 авч ирцээ бүртгэж чадахгүй болов.
 *
 * Шилжилтээс ӨМНӨ холбогдсон бичлэгийг хоцрогдсон гэж үзээд дараагийн
 * clock-in дээр чимээгүй дахин холбоно — админ 40+ хүнийг гар аргаар
 * (`POST /api/users/:id/reset-device`) цэвэрлэх шаардлагагүй.  Дахин
 * холбогдмогц `attendance_device_bound_at` шинэчлэгдэх тул цонх хэрэглэгч
 * тус бүрд ЯГ НЭГ УДАА нээгдэж, дараа нь «нэг PC» дүрэм хэвийн үргэлжилнэ.
 *
 * Бүх ажилтан шинэ домэйн дээр нэг удаа бүртгүүлсний дараа (~1-2 долоо хоног)
 * энэ тогтмол болон доорх дуудалтыг устгаж болно.
 */
const DEVICE_REBIND_BEFORE_MS = Date.parse('2026-08-20T00:00:00+08:00');

/** Холболт нь домэйн шилжилтээс өмнөх (эсвэл огноогүй) эсэх. */
function isPreDomainMoveBinding(boundAt: string | null | undefined): boolean {
  if (!boundAt) return true; // хэзээ холбогдсон нь тодорхойгүй → дахин холбоно
  const ts = Date.parse(boundAt);
  return Number.isNaN(ts) || ts < DEVICE_REBIND_BEFORE_MS;
}

/**
 * `worker` (цэвэрлэгч / туслах ажилтан) нь ирцийн ӨӨР дүрэмтэй — инженерүүдэд
 * тавьсан хязгаарлалтууд түүнд утгагүй:
 *
 *   • төсөл сонгох          — түүнд хуваарилагдсан төсөл байхгүй  → шаардахгүй
 *   • утаснаас хориглох     — тэр ЯГ утаснаасаа бүртгэнэ          → хориглохгүй
 *   • нэг төхөөрөмжид холбох— утас солиход админ хэрэгтэй болно   → холбохгүй
 *   • ажлын явц оруулах     — task/засвар бүртгэдэггүй            → шаардахгүй
 *   • хоцролт/торгууль      — цаг нь уян хатан                    → тооцохгүй
 *
 * Оронд нь ганц шалгуур үлдэнэ: ЗААВАЛ ажлын WiFi-аас (office IP allowlist).
 * Энэ нь `settings.requireOfficeIp` глобал унтраалттай байсан ч хүчинтэй.
 */
function isWorkerUser(user: { role: string }): boolean {
  return isWorkerRole(user.role);
}

/** Тухайн хэрэглэгчид ажлын сүлжээ (office IP) шаардах эсэх (remote-гүй). */
function officeNetworkRequired(user: { role: string }, settings: AttendanceSettings): boolean {
  return settings.requireOfficeIp || isWorkerUser(user);
}

/** Ирц бүртгэхэд office IP шалгалт хэрэгтэй эсэх. */
async function attendanceOfficeIpRequired(
  db: D1Database,
  user: { sub: number; role: string },
  settings: AttendanceSettings,
): Promise<boolean> {
  if (await userHasRemoteAccess(db, user.sub)) return false;
  return officeNetworkRequired(user, settings);
}

/** Ажлын сүлжээнд байхгүй үеийн 403 хариу — worker-т утсаар нь ойлгомжтой. */
function officeNetworkError(user: { role: string }, clientIp: string) {
  // `code` — frontend нь гарах бүртгэлийн татгалзлыг шалтгаанаар нь ангилж
  // «Гарах бүртгэл хийгдээгүй» цонхонд ойлгомжтой тайлбар харуулна
  // (`features/attendance/clockOutFlow.ts`).
  return isWorkerUser(user)
    ? {
        error: 'Ажлын Wi-Fi-д холбогдоно уу',
        detail:
          'Ирцээ зөвхөн ажлын байрны Wi-Fi сүлжээнд холбогдсон үедээ бүртгэнэ. ' +
          `Одоогийн сүлжээ (${clientIp}) тохирохгүй байна — гар утасны дата унтраагаад Wi-Fi-д холбогдоно уу.`,
        code: 'OFFICE_NETWORK' as const,
        client_ip: clientIp,
      }
    : {
        error: 'Оффисын сүлжээнд холбогдоно уу',
        detail: `IP хаяг (${clientIp}) зөвшөөрөгдөөгүй байна`,
        code: 'OFFICE_NETWORK' as const,
        client_ip: clientIp,
      };
}

/**
 * Ажилтан өнөөдөр ажлын явцаа бүртгэсэн эсэх — «Гарах» товчийг идэвхжүүлэх ба
 * clock-out gate-ийн нэгдсэн шалгуур.  Дор хаяж НЭГ:
 *   - `progress_entries` мөр (rest/defer биш = бодит task гүйцэтгэл), ЭСВЭЛ
 *   - `repair_entries` мөр (өдрийн засвар/нэмэлт ажил), ЭСВЭЛ
 *   - `repair_marks` мөр (0348 «ажилласан» тэмдэглэгээ — 0 цаг ногдсон ч мөр
 *     нь `repair_entries`-д байхгүй тул ТУСАД НЬ), ЭСВЭЛ
 *   - `non_project_work_entries` мөр (төслийн бус ажил, 0342; татгалзсанаас бусад)
 * байвал true.  Засвар нь ажил хийсэн баримт тул зөвхөн засвар хийсэн өдөр ч
 * гарах боломжтой байх ёстой.
 *
 * ⚠️ Төслийн бус ажил нь «юу хийсэн» тайлбар, цаггүй ч энд ТООЦОГДОНО — ирцэд
 *    сонгосон нь л хангалттай.  «Юу хийсэн» + цагийг ажилтан ажлаа дуусгасны
 *    дараа «Миний ажлууд»-аас оруулна; гарах бүртгэл үүнийг ШААРДАХГҮЙ (эзний
 *    дүрэм 2026-09-28 — 15:00-д гараад хяналтад явсан хүн ажлаа хийгээгүй байна).
 */
async function hasReportedWorkToday(
  db: D1Database,
  userId: number,
  today: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 FROM progress_entries
        WHERE user_id = ? AND date = ?
          AND COALESCE(is_rest_day, 0) = 0 AND COALESCE(defer_next_day, 0) = 0
          AND COALESCE(source, '') <> 'alloc_adj'
       UNION ALL
       SELECT 1 FROM repair_entries
        WHERE user_id = ? AND date = ?
       UNION ALL
       SELECT 1 FROM repair_marks
        WHERE user_id = ? AND date = ?
       UNION ALL
       SELECT 1 FROM non_project_work_entries
        WHERE user_id = ? AND date = ? AND status <> 'rejected'
       LIMIT 1`,
    )
    .bind(userId, today, userId, today, userId, today, userId, today)
    .first();
  return !!row;
}

/**
 * «ГАРАХ БҮРТГЭЛГҮЙ БОЛ МАРГААШ ИРЭХ БҮРТГЭЛ ХИЙХГҮЙ» дүрэм хүчин төгөлдөр
 * болох ЭХНИЙ ӨДӨР (УБ, `YYYY-MM-DD`).
 *
 * Эзний шийдвэр (2026-08-26): дүрмийг зарлаад мөрдүүлж эхэлнэ.  Гэхдээ
 * хаагдаагүй session-ыг автоматаар хаадаг ямар ч job байхгүй тул
 * `attendance_sessions`-д ОЛОН ЖИЛИЙН хуримтлагдсан «мартагдсан» мөр
 * байдаг (`/open-sessions` нь `LIMIT 500`).  Шалгуурыг огноогоор
 * шаллаагүй бол зарлал гарсан ӨГЛӨӨ нь өнгөрсний өв ачаанаас болж олон
 * хүн нэг дор, ямар ч буруугүйгээр түгжигдэнэ.
 *
 * Иймд ЗӨВХӨН энэ өдрөөс хойш нээгдсэн session хаалт үүсгэнэ: өнөөдөр
 * (зарлал гарсан өдөр) гарах бүртгэлээ хийгээгүй хүн МАРГААШ түгжигдэнэ —
 * яг зарласан ёсоороо.  Түүнээс өмнөх мөрүүд `/open-sessions` дээр админд
 * харагдсаар байх ба цэвэрлэгдэх боловч хэнийг ч хаахгүй.
 *
 * ⚠️ Хуучин өв цэвэрлэгдсэний дараа энэ тогтмолыг УСТГАЖ болно — тэр үед
 * `findStaleOpenSession`-оос `date >= ?` нөхцөлийг хасна.
 */
const CLOCKOUT_RULE_ACTIVE_FROM = '2026-08-26';

/** Гарах бүртгэлийн дараа дахин «Ирсэн» бүртгэл хийхээс өмнөх хүлээлт —
 *  давхар дарсан товчноос үүсэх хуурамч нээлттэй session-ыг хаана
 *  (`POST /clock-in` доторх тайлбар). */
const REENTRY_COOLDOWN_MS = 5 * 60_000;

/** Түгжээ үүсгэж буй хаагдаагүй бүртгэлийн товч мэдээлэл (clock-in-ийн
 *  алдааны биед ба `/my-status`-д ижилхэн буцна). */
type StaleOpenSession = { id: number; date: string; clock_in: string };

/**
 * Тухайн ажилтныг ирэх бүртгэлээс ТҮГЖИЖ буй, өмнөх өдрийн хаагдаагүй
 * session (байвал хамгийн эртнийх).
 *
 * `clock_out IS NULL` ГАНЦААРАА хангалтгүй — тэр нь ӨНӨӨДРИЙН нээлттэй
 * session-ыг ч барих тул `date < today` заавал хэрэгтэй (өнөөдрийнхийг
 * clock-in доторх өөр 409 барина).
 *
 * ⚠️ Энэ предикатыг `POST /clock-in` ба `GET /my-status` ХОЁУЛАА ашиглана —
 * тусад нь хуулбарлавал UI-д «болно» гэж харуулаад сервер нь татгалзах
 * (эсвэл эсрэгээр) чимээгүй зөрүү үүснэ.  Нэг л газар засна.
 *
 * ⚠️ БАТАЛГААЖСАН ЧӨЛӨӨ / бүтэн өдрийн гадуур ажилтай өдөр ХААЛТ ҮҮСГЭХГҮЙ
 * (2026-09-09).  Ажил тарах мөчид оффист байгаагүй хүн гарах бүртгэлээ хийж
 * ЧАДАХГҮЙ тул түүнийг маргааш нь түгжих нь дүрмийн зорилгод харшилна —
 * бодит тохиолдол: 11:00–17:00 цалингүй чөлөө нь дараагийн ирц бүртгэлийг
 * хаасан.  Шалгуур нь `lib/leaveWaiver.ts`-ийн `STALE_OPEN_SESSION_SQL`
 * дотор — хоцролтын `LATE_NOT_WAIVED_SQL`-тэй нэг файлд, нэг дүрмээр.
 * Чөлөөлөгдсөн мөр админы «Хаагдаагүй бүртгэл» жагсаалтад ХЭВЭЭР харагдана
 * (ажилласан цаг нь `clock_out IS NULL` тул тайланд ч тооцогдохгүй).
 *
 * `idx_attendance_user_date(user_id, date)` (migration 0015) энэ query-г
 * бүрэн тэжээнэ.
 */
async function findStaleOpenSession(
  db: D1Database,
  userId: number,
  today: string,
): Promise<StaleOpenSession | null> {
  const row = await db
    .prepare(STALE_OPEN_SESSION_SQL)
    .bind(userId, today, CLOCKOUT_RULE_ACTIVE_FROM)
    .first<StaleOpenSession>();
  return row ?? null;
}

/**
 * Хаалтаас чөлөөлөгдөх эсэх.  Эзний шийдвэр (2026-08-26): дүрэм БҮХ
 * ажилтанд (цэвэрлэгч ч мөн адил) үйлчилнэ, харин УДИРДЛАГА
 * (`admin` tier + `attendance_unrestricted` тэмдэгтэй хүмүүс)
 * чөлөөлөгдөнө — эс бөгөөс хаалтыг тайлах ёстой хүмүүс өөрсдөө хаагдаж,
 * тайлах хүнгүй үлдэх эрсдэлтэй.
 *
 * Энэ нь `isAttendanceUnrestricted`-ийн ЯГ ижил хүрээ — төсөл/утас/
 * төхөөрөмжийн хязгаарлалтаас чөлөөлөгддөг хүмүүс энэ сахилгын хаалтаас
 * ч чөлөөлөгдөнө.
 */
async function isClockOutRuleExempt(
  db: D1Database,
  user: { sub: number; role: string },
): Promise<boolean> {
  return isAttendanceUnrestricted(db, user);
}

// ---------------------------------------------------------------------------
// Work-schedule хүснэгт → `lib/workSchedule.ts` руу нүүсэн (2026-08-13).
// Чөлөөний хүсэлтийн "ажлын цагийн цонх" мөн тэндээс уншдаг тул ээлжийн
// цагийг зөвхөн нэг газар засна.  `SHIFTS` / `effectiveSchedule` /
// `ubMinutesOf` / `ScheduleKey` дээрх import-оор орж ирнэ.
// ---------------------------------------------------------------------------

const attendance = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type ProjectPick = { project_id: number; name: string };
/** Ирцээр сонгосон ЗАСВАРЫН төсөл (`repair_projects`, миграц 0324) — `projects`-тэй
 *  id давхцдаг тул тусдаа талбар, тусдаа төрөл. */
type RepairPick = { repair_project_id: number; name: string };

type CheckpointSummary = {
  id: number;
  checkpoint_type: AttendanceCheckpointType;
  recorded_at: string;
  notes: string | null;
  projects: ProjectPick[];
  repairs: RepairPick[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Цайны цонх [lunch_start, lunch_end]-ийн (тухайн `date`-ийн UB цаг) ажилласан
 * хугацаа [clockIn, clockOut]-тай давхцсан миллисекундийг буцаана.  Цонхыг
 * бодит UB timestamp болгож байгуулсан тул хэсэгчилсэн давхцал (цайны дунд
 * ирсэн/эрт тарсан), цайны өмнө/хойно тарсан, шөнө дамнасан session бүгд
 * зөв (давхцалгүй бол 0).
 */
function lunchOverlapMs(
  clockIn: string,
  clockOut: string,
  date: string,
  settings: AttendanceSettings,
): number {
  const ls = new Date(`${date}T${settings.lunchStart}:00+08:00`).getTime();
  const le = new Date(`${date}T${settings.lunchEnd}:00+08:00`).getTime();
  if (!(le > ls)) return 0;
  const ci = new Date(clockIn).getTime();
  const co = new Date(clockOut).getTime();
  return Math.max(0, Math.min(co, le) - Math.max(ci, ls));
}

/**
 * Session-ий ажилласан цаг (2 оронтой), цайны цонхтой давхцлыг хасна.
 *
 * 2026-10-01-ээс (`lib/shiftBoundedHours.ts`, эзний шийдвэр) зөвхөн ЭЭЛЖИЙН
 * ЦОНХ доторх хугацаа: 08:00–17:00 ээлжтэй хүн 07:40–16:40 → 7ц40м.  Түүнээс
 * өмнөх өдөр хуучин дүрмээр [ирсэн, гарсан] бүхэлдээ (07:40–16:40 → 8ц) — тиймээс
 * `shift` нь тэр салаанд уншигдахгүй.  `shift` = session-ий ӨДРИЙН тоолох цонх
 * (`countingWindow` / `loadCountingWindow` — ээлж, `worker` бол бүтэн өдөр).
 */
function computeHours(
  clockIn: string,
  clockOut: string,
  opts: { date: string; settings: AttendanceSettings; shift: Pick<Shift, 'startMinutes' | 'endMinutes'> },
): number {
  if (isShiftBounded(opts.date)) {
    return shiftBoundedSessionHours(clockIn, clockOut, opts.date, opts.shift, opts.settings);
  }
  let ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  if (opts.settings.lunchEnabled) {
    ms -= lunchOverlapMs(clockIn, clockOut, opts.date, opts.settings);
  }
  return Math.round((ms / 3_600_000) * 100) / 100;
}

function normalizeProjectIds(projectIds: number[] | undefined): number[] {
  return Array.from(new Set((projectIds ?? []).filter((n) => Number.isInteger(n) && n > 0)));
}

/**
 * Ирцийн нэг цэгт сонгох төслийн ДЭЭД хязгаар (эзэн 2026-09-29: «ирц өгөхдөө
 * дээд талдаа 2 төсөл л сонгоно, 2-оос дээш сонгох боломжгүй»).  Жинхэнэ төсөл
 * + засварын төсөл НИЙЛЭЭД тоологдоно — popup-д хоёулаа «төсөл» сонголт, нэг л
 * олонлог («дор хаяж нэг» дүрэмтэй ижил).  Төслийн бус ажил (0357) тоологдохгүй:
 * төсөл биш, зөвхөн хяналт.  Admin/онцгойлсон ажилтанд ч хамаарна — тэд сонгохгүй
 * байж болох ч сонговол ижил дүрэм.
 * ⚠️ Frontend-ийн ихэр: `AttendanceProjectDialog.tsx` `MAX_ATTENDANCE_PROJECTS`.
 */
const MAX_ATTENDANCE_PROJECTS = 2;

function tooManyProjects(projectIds: number[], repairIds: number[]) {
  const count = projectIds.length + repairIds.length;
  if (count <= MAX_ATTENDANCE_PROJECTS) return null;
  return {
    error: `Хамгийн ихдээ ${MAX_ATTENDANCE_PROJECTS} төсөл сонгоно уу`,
    detail: `Та ${count} төсөл сонгосон байна (засварын төсөл хамт тоологдоно).`,
    code: 'TOO_MANY_PROJECTS' as const,
    max: MAX_ATTENDANCE_PROJECTS,
  };
}

/**
 * Ирцээр сонгосон засварын төслүүд (миграц 0324) — БҮГД байх ба `active`
 * байх ёстой.  Архивласан нь ажилтны жагсаалтад ирдэггүй тул энд 400 иднэ
 * гэдэг нь зөвхөн хуучирсан popup (архивлахаас өмнө нээсэн) тохиолдол.
 */
async function validateRepairProjectIds(
  db: D1Database,
  ids: number[],
): Promise<Response | null> {
  if (ids.length === 0) return null;
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT id, status FROM repair_projects WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: number; status: string }>();
  const byId = new Map((results ?? []).map((r) => [r.id, r.status]));
  const missing = ids.filter((i) => !byId.has(i));
  if (missing.length > 0) {
    return new Response(
      JSON.stringify({
        error: 'Сонгосон засварын төсөл олдсонгүй — хуудсаа шинэчлээд дахин сонгоно уу',
        code: 'REPAIR_PROJECT_NOT_FOUND',
        missing,
      }),
      {
        status: 404,
        headers: { 'content-type': 'application/json' },
      },
    );
  }
  const archived = ids.filter((i) => byId.get(i) !== 'active');
  if (archived.length > 0) {
    return new Response(
      JSON.stringify({
        error: 'Архивласан засварын төсөл сонгох боломжгүй — жагсаалтаа шинэчилнэ үү',
        code: 'REPAIR_PROJECT_ARCHIVED',
        archived,
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }
  return null;
}

async function validateProjectIds(
  db: D1Database,
  user: { sub: number; role: string },
  ids: number[],
): Promise<Response | null> {
  if (ids.length === 0) return null;

  const placeholders = ids.map(() => '?').join(',');
  const { results: found } = await db
    .prepare(`SELECT p.id FROM projects p WHERE p.id IN (${placeholders}) AND ${NOT_ASR_ONLY_SQL}`)
    .bind(...ids)
    .all<{ id: number }>();
  const foundIds = new Set((found ?? []).map((r) => r.id));
  const missing = ids.filter((i) => !foundIds.has(i));
  if (missing.length > 0) {
    return new Response(
      JSON.stringify({
        error: 'Сонгосон төсөл олдсонгүй — хуудсаа шинэчлээд дахин сонгоно уу',
        code: 'PROJECT_NOT_FOUND',
        missing,
      }),
      {
        status: 404,
        headers: { 'content-type': 'application/json' },
      },
    );
  }

  if (user.role === 'client') {
    const { results: memberRows } = await db
      .prepare(
        `SELECT project_id FROM project_members
        WHERE user_id = ? AND project_id IN (${placeholders})`,
      )
      .bind(user.sub, ...ids)
      .all<{ project_id: number }>();
    const memberSet = new Set((memberRows ?? []).map((r) => r.project_id));
    const denied = ids.filter((i) => !memberSet.has(i));
    if (denied.length > 0) {
      return new Response(JSON.stringify({ error: 'Access denied', denied }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }
  }

  return null;
}

/**
 * Нөхцөл — `selectionStatements`-ийн мөр бүрийн бичилтийг хамгаалах SQL
 * фрагмент (+ bind).  `ALWAYS` = хамгаалалтгүй.  Batch нь нэг транзакц тул
 * фрагмент мөр бүрд ДАХИН үнэлэгдэнэ — өөрөө өөрчлөх бичилтийн ӨМНӨ л байрлуул.
 */
type WriteGuard = { sql: string; binds: unknown[] };
const ALWAYS: WriteGuard = { sql: '1', binds: [] };

/** Өнөөдрийн сонголт (`daily_active_*`) — хоёр хүснэгт, нэг олонлог. */
function dailyActiveStatements(
  db: D1Database,
  userId: number,
  date: string,
  ids: number[],
  repairIds: number[],
  guard: WriteGuard = ALWAYS,
): D1PreparedStatement[] {
  return [
    db
      .prepare(`DELETE FROM daily_active_projects WHERE user_id = ? AND date = ? AND ${guard.sql}`)
      .bind(userId, date, ...guard.binds),
    ...ids.map((pid) =>
      db
        .prepare(
          `INSERT INTO daily_active_projects (user_id, date, project_id)
           SELECT ?, ?, ? WHERE ${guard.sql}`,
        )
        .bind(userId, date, pid, ...guard.binds),
    ),
    db
      .prepare(`DELETE FROM daily_active_repairs WHERE user_id = ? AND date = ? AND ${guard.sql}`)
      .bind(userId, date, ...guard.binds),
    ...repairIds.map((rid) =>
      db
        .prepare(
          `INSERT INTO daily_active_repairs (user_id, date, repair_project_id)
           SELECT ?, ?, ? WHERE ${guard.sql}`,
        )
        .bind(userId, date, rid, ...guard.binds),
    ),
  ];
}

async function replaceDailyActiveProjects(
  db: D1Database,
  userId: number,
  date: string,
  ids: number[],
  repairIds: number[] = [],
): Promise<void> {
  await db.batch(dailyActiveStatements(db, userId, date, ids, repairIds));
}

type CheckpointArgs = {
  userId: number;
  date: string;
  sessionId: number | null;
  checkpointType: AttendanceCheckpointType;
  recordedAt: string;
  projectIds: number[];
  repairProjectIds?: number[];
  notes?: string | null;
};

/**
 * Цэгийн мөр (upsert — `UNIQUE(user_id, date, checkpoint_type)`, 0047) + түүний
 * төсөл/засварын хүүхэд мөрүүд, дээр нь өнөөдрийн сонголт — бүгд batch-ын
 * statement болж буцна.  Хүүхэд мөрүүд checkpoint id-г дэд асуулгаар олдог
 * тул нэг batch-д багтана (өмнө нь SELECT → INSERT → batch гурван тусдаа
 * дуудлага байсан — дундаас нь унавал цэг төсөлгүй үлддэг байв).
 */
function selectionStatements(
  db: D1Database,
  args: CheckpointArgs,
  guard: WriteGuard = ALWAYS,
): D1PreparedStatement[] {
  const cpId = `(SELECT id FROM attendance_project_checkpoints
                  WHERE user_id = ? AND date = ? AND checkpoint_type = ?)`;
  const cpBinds = [args.userId, args.date, args.checkpointType];
  const repairIds = args.repairProjectIds ?? [];
  return [
    ...dailyActiveStatements(db, args.userId, args.date, args.projectIds, repairIds, guard),
    db
      .prepare(
        `INSERT INTO attendance_project_checkpoints
           (user_id, date, session_id, checkpoint_type, recorded_at, notes)
         SELECT ?, ?, ?, ?, ?, ? WHERE ${guard.sql}
         ON CONFLICT (user_id, date, checkpoint_type) DO UPDATE SET
           session_id  = COALESCE(excluded.session_id, session_id),
           recorded_at = excluded.recorded_at,
           notes       = COALESCE(excluded.notes, notes)`,
      )
      .bind(
        args.userId,
        args.date,
        args.sessionId,
        args.checkpointType,
        args.recordedAt,
        args.notes ?? null,
        ...guard.binds,
      ),
    db
      .prepare(
        `DELETE FROM attendance_checkpoint_projects WHERE checkpoint_id = ${cpId} AND ${guard.sql}`,
      )
      .bind(...cpBinds, ...guard.binds),
    ...args.projectIds.map((pid) =>
      db
        .prepare(
          `INSERT INTO attendance_checkpoint_projects (checkpoint_id, project_id)
           SELECT ${cpId}, ? WHERE ${guard.sql}`,
        )
        .bind(...cpBinds, pid, ...guard.binds),
    ),
    db
      .prepare(
        `DELETE FROM attendance_checkpoint_repairs WHERE checkpoint_id = ${cpId} AND ${guard.sql}`,
      )
      .bind(...cpBinds, ...guard.binds),
    ...repairIds.map((rid) =>
      db
        .prepare(
          `INSERT INTO attendance_checkpoint_repairs (checkpoint_id, repair_project_id)
           SELECT ${cpId}, ? WHERE ${guard.sql}`,
        )
        .bind(...cpBinds, rid, ...guard.binds),
    ),
  ];
}

/** Batch-ын төгсгөлд цэгийн id-г уншина (`results[last]`). */
function checkpointIdStatement(db: D1Database, args: CheckpointArgs): D1PreparedStatement {
  return db
    .prepare(
      `SELECT id FROM attendance_project_checkpoints
        WHERE user_id = ? AND date = ? AND checkpoint_type = ?`,
    )
    .bind(args.userId, args.date, args.checkpointType);
}

function checkpointIdOf(results: D1Result[]): number {
  const rows = (results[results.length - 1]?.results ?? []) as Array<{ id: number }>;
  return Number(rows[0]?.id ?? 0);
}

/**
 * Ирцийн хүсэлтийн `non_project` (0357) — цэгт сонгосон төслийн бус ажил.
 * Бүртгэх эрхгүй ролийнх (админ, цэвэрлэгч) үл тоогдоно — `/api/non-project-work`
 * тэдэнд 403 өгдөгтэй ижил.  `picks: null` = талбаргүй (хуучин клиент).
 */
function readNonProjectPicks(user: { role: string }, raw: unknown) {
  if (!(NON_PROJECT_WORK_ROLES as readonly string[]).includes(user.role)) {
    return { ok: true as const, picks: null };
  }
  return parseNonProjectPicks(raw);
}

/**
 * Цэгийн төслийн бус сонголтыг хадгалаад цаг/ирц/засварыг дахин бодно.
 * Ирцийн бичилт аль хэдийн амжилттай тул алдаа нь хүсэлтийг унагахгүй.
 *
 * `applyNonProjectPicks` нь давтахад аюулгүй (`planPicks` өнөөдрийн мөртэй
 * тулгана — эхний оролдлогоор үүссэн мөрийг дахин үүсгэхгүй, холбоосыг
 * `INSERT OR IGNORE` + бүтнээр солино), тиймээс түр зуурын D1 алдаанд НЭГ удаа
 * дахин оролдоно.  Дахиад унавал `false` — дуудагч ажилтанд хэлнэ (14:00 эсвэл
 * гарах цонхонд дахин сонгоход нөхөгдөнө).  Сонголтгүй бол `true`.
 */
async function saveNonProjectPicks(
  db: D1Database,
  args: { userId: number; date: string; checkpointId: number; picks: NonProjectPick[] | null; now: string },
  settings: AttendanceSettings,
): Promise<boolean> {
  if (!args.picks) return true;
  let saved = false;
  for (let attempt = 1; attempt <= 2 && !saved; attempt++) {
    try {
      await applyNonProjectPicks(db, { ...args, picks: args.picks });
      saved = true;
    } catch (err) {
      console.error('[non-project] checkpoint picks failed', { attempt, userId: args.userId, date: args.date }, err);
    }
  }
  if (!saved) return false;
  await afterNonProjectChange(db, args.userId, args.date, settings);
  return true;
}

const NON_PROJECT_NOT_SAVED =
  'Төслийн бус ажлын сонголт хадгалагдсангүй — 14:00 эсвэл гарах үеийн цонхонд дахин сонгоно уу.';

/** Цэг + төслийн сонголтыг НЭГ batch-д (атомик) хадгалаад цэгийн id буцаана. */
async function saveProjectCheckpoint(db: D1Database, args: CheckpointArgs): Promise<number> {
  const results = await db.batch([...selectionStatements(db, args), checkpointIdStatement(db, args)]);
  return checkpointIdOf(results);
}

/**
 * Ирсэн бүртгэл: session + өнөөдрийн сонголт + өглөөний цэг НЭГ batch-д
 * (транзакц).  Бүх бичилт «нээлттэй session байхгүй» нөхцөлөөр хамгаалагдаж
 * session INSERT-ээс ӨМНӨ байрлана — давхар хүсэлт юу ч бичихгүй (`null`).
 * Дундаас унавал бүгд буцна — «ирсэн боловч төсөлгүй» төлөв үүсэхгүй.
 */
export async function writeClockIn(
  db: D1Database,
  a: {
    userId: number;
    date: string;
    clockIn: string;
    ip: string | null;
    notes: string | null;
    lateMinutes: number;
    deviceId: string | null;
    projectIds: number[];
    repairProjectIds: number[];
  },
): Promise<{ sessionId: number; checkpointId: number } | null> {
  const noOpenSession: WriteGuard = {
    sql: `NOT EXISTS (SELECT 1 FROM attendance_sessions
                       WHERE user_id = ? AND date = ? AND clock_out IS NULL)`,
    binds: [a.userId, a.date],
  };
  const morning: CheckpointArgs = {
    userId: a.userId,
    date: a.date,
    sessionId: null,
    checkpointType: 'morning',
    recordedAt: a.clockIn,
    projectIds: a.projectIds,
    repairProjectIds: a.repairProjectIds,
    notes: a.notes,
  };
  const selection = selectionStatements(db, morning, noOpenSession);
  const results = await db.batch([
    ...selection,
    db
      .prepare(
        `INSERT INTO attendance_sessions (user_id, clock_in, ip_address, date, notes, late_minutes, device_id)
         SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${noOpenSession.sql}`,
      )
      .bind(a.userId, a.clockIn, a.ip, a.date, a.notes, a.lateMinutes, a.deviceId, ...noOpenSession.binds),
    // Re-entry дээр цэг өмнөх session-д холбоотой байж болно → шинэ рүү.
    // `recorded_at = clockIn` нь энэ хүсэлтийн цэг гэдгийг баталгаажуулна.
    db
      .prepare(
        `UPDATE attendance_project_checkpoints
            SET session_id = (SELECT MAX(id) FROM attendance_sessions
                               WHERE user_id = ? AND date = ? AND clock_out IS NULL)
          WHERE user_id = ? AND date = ? AND checkpoint_type = 'morning' AND recorded_at = ?`,
      )
      .bind(a.userId, a.date, a.userId, a.date, a.clockIn),
    checkpointIdStatement(db, morning),
  ]);
  const inserted = results[selection.length]!;
  if (!inserted.meta.changes) return null;
  return { sessionId: Number(inserted.meta.last_row_id), checkpointId: checkpointIdOf(results) };
}

/**
 * Гарсан бүртгэл: session хаалт + өнөөдрийн сонголт + гарах цэг НЭГ batch-д.
 * Сонголтын мөрүүд «энэ session нээлттэй хэвээр» нөхцөлөөр хамгаалагдаж
 * UPDATE-ээс ӨМНӨ байрлана — зэрэг ирсэн хоёр дахь «Гарах» юу ч бичихгүй
 * (`null`).  Өнөөдрийн ӨӨР нээлттэй мөр (атомик clock-in-ээс өмнө үүссэн
 * давхар бүртгэл) үлдвэл ХАМТ хаана — эс тэгвэл маргааш `findStaleOpenSession`
 * түүнийг барьж ажилтныг буруугүйгээр түгжинэ.  Цагийг ДАВХАР тоолохгүйн тулд
 * `hours_worked = 0`; шалтгааныг `edit_note`-д (`edited_by` NULL — системийн
 * цэвэрлэгээ).  Цэгийн id буцаана.
 */
export async function writeClockOut(
  db: D1Database,
  a: {
    userId: number;
    date: string;
    sessionId: number;
    clockOut: string;
    hours: number;
    notes: string | null;
    projectIds: number[];
    repairProjectIds: number[];
  },
): Promise<number | null> {
  const stillOpen: WriteGuard = {
    sql: `EXISTS (SELECT 1 FROM attendance_sessions WHERE id = ? AND clock_out IS NULL)`,
    binds: [a.sessionId],
  };
  const args: CheckpointArgs = {
    userId: a.userId,
    date: a.date,
    sessionId: a.sessionId,
    checkpointType: 'clock_out',
    recordedAt: a.clockOut,
    projectIds: a.projectIds,
    repairProjectIds: a.repairProjectIds,
    notes: a.notes,
  };
  const selection = selectionStatements(db, args, stillOpen);
  const results = await db.batch([
    ...selection,
    db
      .prepare(
        `UPDATE attendance_sessions
            SET clock_out = ?, hours_worked = ?, notes = COALESCE(?, notes)
          WHERE id = ? AND clock_out IS NULL`,
      )
      .bind(a.clockOut, a.hours, a.notes, a.sessionId),
    db
      .prepare(
        `UPDATE attendance_sessions
            SET clock_out = ?, hours_worked = 0,
                edit_note = 'Давхар ирсэн бүртгэл — гарах бүртгэлээр автоматаар хаагдсан'
          WHERE user_id = ? AND date = ? AND clock_out IS NULL AND id <> ?`,
      )
      .bind(a.clockOut, a.userId, a.date, a.sessionId),
    checkpointIdStatement(db, args),
  ]);
  if (!results[selection.length]!.meta.changes) return null;
  return checkpointIdOf(results);
}

async function getCheckpointSummaries(
  db: D1Database,
  userId: number,
  date: string,
): Promise<CheckpointSummary[]> {
  const { results: rows } = await db
    .prepare(
      `SELECT id, checkpoint_type, recorded_at, notes
       FROM attendance_project_checkpoints
      WHERE user_id = ? AND date = ?
      ORDER BY recorded_at`,
    )
    .bind(userId, date)
    .all<{
      id: number;
      checkpoint_type: AttendanceCheckpointType;
      recorded_at: string;
      notes: string | null;
    }>();

  const checkpoints = rows ?? [];
  if (checkpoints.length === 0) return [];

  const ids = checkpoints.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const { results: projectRows } = await db
    .prepare(
      `SELECT acp.checkpoint_id, acp.project_id, p.name
       FROM attendance_checkpoint_projects acp
       JOIN projects p ON p.id = acp.project_id
      WHERE acp.checkpoint_id IN (${placeholders})
      ORDER BY p.name`,
    )
    .bind(...ids)
    .all<{ checkpoint_id: number; project_id: number; name: string }>();

  const byCheckpoint = new Map<number, ProjectPick[]>();
  for (const row of projectRows ?? []) {
    const list = byCheckpoint.get(row.checkpoint_id) ?? [];
    list.push({ project_id: row.project_id, name: row.name });
    byCheckpoint.set(row.checkpoint_id, list);
  }

  // Засварын төслийн сонголт (0324) — тусдаа хүснэгт, тусдаа жагсаалт.
  const { results: repairRows } = await db
    .prepare(
      `SELECT acr.checkpoint_id, acr.repair_project_id, rp.name
       FROM attendance_checkpoint_repairs acr
       JOIN repair_projects rp ON rp.id = acr.repair_project_id
      WHERE acr.checkpoint_id IN (${placeholders})
      ORDER BY rp.name`,
    )
    .bind(...ids)
    .all<{ checkpoint_id: number; repair_project_id: number; name: string }>();
  const repairsByCheckpoint = new Map<number, RepairPick[]>();
  for (const row of repairRows ?? []) {
    const list = repairsByCheckpoint.get(row.checkpoint_id) ?? [];
    list.push({ repair_project_id: row.repair_project_id, name: row.name });
    repairsByCheckpoint.set(row.checkpoint_id, list);
  }

  return checkpoints.map((row) => ({
    id: row.id,
    checkpoint_type: row.checkpoint_type,
    recorded_at: row.recorded_at,
    notes: row.notes,
    projects: byCheckpoint.get(row.id) ?? [],
    repairs: repairsByCheckpoint.get(row.id) ?? [],
  }));
}

function getNextCheckpointPrompt(args: {
  session: AttendanceSessionRow | null;
  checkpointTypes: Set<AttendanceCheckpointType>;
}): AttendanceCheckpointType | null {
  const nowMinutes = ubMinutesOf(nowInUBIso());

  if (!args.session || args.session.clock_out) {
    return args.checkpointTypes.has('morning') ? null : 'morning';
  }

  if (nowMinutes >= 14 * 60 && !args.checkpointTypes.has('afternoon')) {
    return 'afternoon';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Clock In / Clock Out  (Office-IP-only)
// ---------------------------------------------------------------------------

/** Shared office IP gate for clock-in/out/checkpoint. */
async function enforceAttendanceOfficeIp(
  c: { env: { DB: D1Database }; json: (body: unknown, status?: number) => Response },
  user: { sub: number; role: string },
  clientIp: string,
  settings: AttendanceSettings,
): Promise<Response | null> {
  if (!(await attendanceOfficeIpRequired(c.env.DB, user, settings))) return null;
  if (await isOfficeIp(c.env.DB, clientIp)) return null;
  return c.json(officeNetworkError(user, clientIp), 403);
}

// POST /api/attendance/clock-in — present at the office?
attendance.post('/clock-in', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<ClockInRequest>().catch(() => ({}) as ClockInRequest);

  const clientIp = getClientIp(c);
  const settings = await getAttendanceSettings(c.env.DB);
  const officeBlock = await enforceAttendanceOfficeIp(c, user, clientIp, settings);
  if (officeBlock) return officeBlock;

  const today = todayInUB();
  const existingOpen = await c.env.DB.prepare(
    `SELECT id FROM attendance_sessions
     WHERE user_id = ? AND date = ? AND clock_out IS NULL`,
  )
    .bind(user.sub, today)
    .first();

  if (existingOpen) {
    return c.json(
      { error: 'Та аль хэдийн ирцээ бүртгэсэн байна. Эхлээд гарах бүртгэл хийнэ үү.' },
      409,
    );
  }

  // ⚠️ ӨМНӨХ ӨДРИЙН ХААГДААГҮЙ БҮРТГЭЛ → өнөөдөр ирэх бүртгэл ХИЙХГҮЙ.
  //
  // Эзний шийдвэр (2026-08-26): «ажил тарах үед гарах бүртгэлээ хийгээгүй
  // ажилтан маргааш өглөө ирсэн бүртгэлээ хийх боломжгүй».  Хаагдаагүй
  // session нь `hours_worked`-ыг NULL үлдээж, `/stats` (`clock_out IS NOT
  // NULL`) болон гүйцэтгэлийн тайлангаас тухайн өдрийг бүрмөсөн унагаадаг —
  // өөрөөр хэлбэл мартсан хүн өөрөө хохирохоос гадна тайлан бүхэлдээ
  // гажина.  Автомат хаагч job байхгүй тул сахилга л шийднэ.
  //
  // БАЙРЛАЛ нь санамсаргүй биш:
  //   • Дээрх «өнөөдөр аль хэдийн ирсэн» 409-ийн ДАРАА — тэр нь илүү
  //     тодорхой мессеж бөгөөд хоёулаа зэрэг үнэн байж болно.
  //   • Төслийн шалгалт болон `isAttendanceUnrestricted`-аас ӨМНӨ —
  //     эцэстээ татгалзах бүртгэлд төсөл сонгуулах popup утгагүй.
  //   • ⚠️ Төхөөрөмжийн блокоос (`UPDATE users SET attendance_device_id`)
  //     ЗААВАЛ ӨМНӨ — тэр нь энэ handler-ийн анхны бичилт бөгөөд
  //     татгалзсан оролдлого `DEVICE_REBIND_BEFORE_MS`-ийн нэг удаагийн
  //     цонхыг зарцуулж дуусгах ёсгүй.
  //
  // Тайлах ЦОРЫН ГАНЦ зам нь удирдлага: Ирц → «Хаагдаагүй бүртгэл» таб
  // (`GET /open-sessions` — предикат нь `findStaleOpenSession`-тэй ижил) →
  // `POST /sessions/:id/clock-out` эсвэл `DELETE /sessions/:id` (bulk мөн).
  if (!(await isClockOutRuleExempt(c.env.DB, user))) {
    const stale = await findStaleOpenSession(c.env.DB, user.sub, today);
    if (stale) {
      return c.json(
        {
          // Эзний бичсэн ЯГ ЭНЭ өгүүлбэр.  Гурван frontend дуудагч бүгд
          // `err.message`-ийг харуулдаг тул dialog утаслаагүй гадаргуу
          // (dashboard widget) дээр ч зөв текст гарна.
          error:
            'Та ирцийн гарсан бүртгэлээ хийгээгүй тул системийн бүртгэлээ хийх боломжгүй байна. Менежментийн багтай ирж уулзана уу.',
          // Машин уншигдах ялгуур — `ApiError.code` руу автоматаар
          // хөрвөнө (`shared/api/client.ts`), frontend үүгээр Dialog нээнэ.
          code: 'OPEN_PRIOR_SESSION',
          open_session: stale,
        },
        409,
      );
    }
  }

  // Энэ өдрийн АНХНЫ ирэлт мөн үү?  Ажлынхаа дундаас гараад (clock-out)
  // буцаж ороход (re-entry) хоцролтыг ДАХИН тооцох ёсгүй — хоцролт зөвхөн
  // тухайн өдрийн анхны clock-in-д (бодит ирсэн цаг) бодогдоно.  Нээлттэй
  // session дээр дээр нь аль хэдийн 409 буцсан тул энэ нь өмнө ХААГДСАН
  // session (өглөө орж, дундаас гарсан) байгаа эсэхийг л шалгана.
  const priorSessionToday = await c.env.DB.prepare(
    `SELECT clock_out FROM attendance_sessions
      WHERE user_id = ? AND date = ?
      ORDER BY clock_out DESC LIMIT 1`,
  )
    .bind(user.sub, today)
    .first<{ clock_out: string | null }>();
  const isReentry = !!priorSessionToday;

  // ⚠️ ГАРСНЫ ДАРАА ШУУД ДАХИН «ИРСЭН» ДАРАХЫГ ХААНА (2026-09-25).
  //
  // Гарах бүртгэл хийсний дараа товч «Ирсэн» болж хувирдаг тул ажилтан
  // хэдхэн секундийн дотор дахин дарж ШИНЭ нээлттэй session үүсгэдэг байв
  // (прод: user 39 09-18-нд 4 с, user 42 09-21-нд 6 с, 09-24-нд 27 с).  Тэр
  // мөр маргааш өглөө ажилтныг `OPEN_PRIOR_SESSION`-оор түгжиж, өглөөний
  // `morning` checkpoint-ийг орой руу зөөж (`saveProjectCheckpoint` upsert),
  // админы «гарах цаг нөхөх» нь ирсэн цаг (18:01)-аас өмнөх утгыг татгалздаг
  // тул засах боломжгүй болдог — зөвхөн устгах л үлдэнэ.  Жинхэнэ буцаж орох
  // (re-entry) нь хэдэн минутын дотор бараг байдаггүй.
  if (priorSessionToday?.clock_out) {
    const sinceOutMs =
      new Date(nowInUBIso()).getTime() - new Date(priorSessionToday.clock_out).getTime();
    if (sinceOutMs >= 0 && sinceOutMs < REENTRY_COOLDOWN_MS) {
      return c.json(
        {
          error: `Та ${extractClock(priorSessionToday.clock_out) ?? ''}-д гарсан бүртгэлээ хийсэн байна. Буцаж ирсэн бол ${REENTRY_COOLDOWN_MS / 60_000} минутын дараа дахин бүртгэнэ үү.`,
          code: 'JUST_CLOCKED_OUT',
        },
        409,
      );
    }
  }

  // Admin tier + онцгойлсон ажилтнууд (ATTENDANCE_UNRESTRICTED_EMPLOYEE_IDS)
  // нь төсөл сонгох/утас/төхөөрөмжийн хязгаарлалтгүй — нэг удаа тооцоод
  // доорх бүх шалгалтад дахин ашиглана.
  const unrestricted = await isAttendanceUnrestricted(c.env.DB, user);
  // Цэвэрлэгчид хуваарилагдсан төсөл байхгүй тул төсөл/төхөөрөмжийн
  // шалгалтуудаас чөлөөлөгдөнө (ажлын WiFi нь дээр аль хэдийн шалгагдсан).
  const worker = isWorkerUser(user);
  const projectIds = normalizeProjectIds(body.project_ids);
  // Засварын төсөл (0324) — жинхэнэ төслийн оронд ЭСВЭЛ хамт сонгож болно.
  // «Дор хаяж нэг» дүрэм хоёрын НИЙЛБЭРЭЭР: зөвхөн засвар сонгосон ч хангана,
  // эс тэгвэл ажилтан дахиад хамаагүй төсөл сонгож захирлыг төөрөгдүүлнэ —
  // энэ хүснэгт яг тэр асуудлыг засахаар үүссэн.
  const repairProjectIds = normalizeProjectIds(body.repair_project_ids);
  // Төслийн бус ажил (0357) — энэ цэгт цаггүй СОНГОСОН ажил.
  const np = readNonProjectPicks(user, body.non_project);
  if (!np.ok) return c.json({ error: np.error, code: np.code }, 400);
  // Бусдад заавал нэг төсөл шаардана.  Төслийн бус ажлын СОНГОЛТ, эсвэл
  // өнөөдөр аль хэдийн бүртгэсэн төслийн бус ажил (0342, хуучин клиент) ч
  // хангана — эзний шийдвэр: тэр өдрийн ирц тэр ажлаар тооцогдоно.
  if (
    projectIds.length + repairProjectIds.length + (np.picks?.length ?? 0) === 0 &&
    !unrestricted &&
    !worker &&
    (await nonProjectDayCounts(c.env.DB, user.sub, today)).total === 0
  ) {
    return c.json(
      {
        error: 'Өнөөдөр ажиллах төслөө сонгоно уу',
        detail:
          'Ирсэн бүртгэл хийхдээ popup цонхноос дор хаяж нэг төсөл сонгох эсвэл төслийн бус ажлаа бүртгэнэ үү.',
      },
      400,
    );
  }
  const tooMany = tooManyProjects(projectIds, repairProjectIds);
  if (tooMany) return c.json(tooMany, 400);
  const validationError =
    (await validateProjectIds(c.env.DB, user, projectIds)) ??
    (await validateRepairProjectIds(c.env.DB, repairProjectIds));
  if (validationError) return validationError;

  // Төхөөрөмжийн шалгалт — ирсэн бүртгэл (session start) зөвхөн PC-гээс.
  // Admin tier (удирдлага) нь аль ч төхөөрөмжөөс бүртгэж болох тул
  // чөлөөлөгдөнө.  Бусдад: утсыг server талд backstop болгон хориглож,
  // анхны clock-in-д тухайн PC-д холбоно; дараа нь зөвхөн тэр компьютерээс л
  // clock-in хийнэ.  «Компьютер» = `attendance_devices`-ийн идэвхтэй мөрүүд
  // (миграц 0328): браузер тус бүрд нэг `browser_id` + ХЭМЖСЭН техник
  // хангамжийн профайл.  Танигдаагүй браузер (Chrome → Edge, PWA, storage
  // цэвэрлэгдсэн, Windows дахин суусан) нь профайл таарвал ижил компьютер гэж
  // автоматаар нэмэгдэнэ — `lib/attendanceDevice.ts`-ийн тайлбар, хязгаар.
  // Админ reset-ээр л ШИНЭ компьютер холбогдоно.
  const deviceId = getRequestDeviceId(c);
  if (!unrestricted && !worker) {
    if (isPhoneUserAgent(c.req.header('user-agent'))) {
      return c.json({ error: 'Утаснаас ирц бүртгэх боломжгүй — компьютер ашиглана уу' }, 403);
    }
    if (!deviceId) {
      return c.json(
        { error: 'Төхөөрөмж танигдсангүй. Компьютерийн браузераас дахин оролдоно уу.' },
        400,
      );
    }
    const decision = await resolveAttendanceDevice(c.env.DB, {
      userId: user.sub,
      browserId: deviceId,
      profile: normalizeHwProfile(body.device),
      userAgent: c.req.header('user-agent') ?? null,
      hwMatchEnabled: settings.deviceHwMatch,
      // Домэйн шилжилтээс өмнөх холболтыг нэг удаа дахин холбоно —
      // `DEVICE_REBIND_BEFORE_MS`-ийн тайлбарыг үз.
      isLegacyBinding: isPreDomainMoveBinding,
      now: nowInUBIso(),
    });
    if (decision.kind === 'reject') {
      return c.json(
        {
          error: 'Энэ төхөөрөмж бүртгэлгүй байна. Админд хандан төхөөрөмжөө шинэчлүүлнэ үү.',
          code: 'DEVICE_NOT_REGISTERED',
        },
        403,
      );
    }
  }

  // Хэрэглэгчийн цагийн хуваариас хамаарч хоцорсон минутыг тооцно.
  // Шифт-ийн эхэн цагаас өмнө (эсвэл яг тэр үед) бол 0.  Бусад
  // тохиолдолд (clock-in минут − шифт эхлэх минут).
  const userRow = await c.env.DB.prepare(`SELECT work_schedule FROM users WHERE id = ?`)
    .bind(user.sub)
    .first<{ work_schedule: ScheduleKey }>();
  // Зуны үед (6–8 сар) бүгд 08:00–17:00 ээлжтэй тул хоцролт тооцох
  // эхэн цэг нь хадгалсан тохиргооноос үл хамаарч 08:00 болно.
  // Зунаас гадуур бол `user_work_schedules`-ийн ТУХАЙН ӨДӨРТ хүчинтэй мөр
  // (миграци 0199); мөр байхгүй бол хуучин багана.
  const clockInAssignments = await getScheduleAssignments(c.env.DB, user.sub);
  const shift = shiftForUser(user.sub, userRow?.work_schedule, today, clockInAssignments);

  const clockIn = nowInUBIso();
  // Шифт-ийн эхэн цагаас хэдэн минут хоцорсон бэ?  Эхний `grace`
  // минутыг үл тооцно (админ тохируулсан).
  // Re-entry (дундаас гараад буцаж орох) дээр хоцролт тооцохгүй — өглөөний
  // анхны ирэлт дээр аль хэдийн бодогдсон.
  // Цэвэрлэгчийн цаг уян хатан тул хоцролт/торгууль огт тооцохгүй.
  const lateMinutes =
    isReentry || worker
      ? 0
      : lateMinutesAgainstShift(ubMinutesOf(clockIn), shift, settings.lateGraceMinutes);

  // ⚠️ АТОМИК оруулга — дээрх `existingOpen` шалгалт ба энэ INSERT хоёрын
  // хооронд ИЖИЛ хэрэглэгчийн хоёр дахь clock-in хүсэлт орж ирвэл (товч
  // давхар дарах, сүлжээний давталт) хоёулаа шалгалтыг давж ХОЁР нээлттэй
  // session үүсгэдэг байв.  `POST /clock-out` нь `LIMIT 1`-ээр нэгийг л
  // хаадаг тул нөгөө нь үүрд нээлттэй үлдэж, маргааш өглөө нь ажилтныг
  // «гарсан бүртгэлээ хийгээгүй» гэж түгжиж байсан (прод: session 4407/4408,
  // ижил `clock_in` секунд, ижил төхөөрөмж — 2026-09-10).  D1 нэг statement-ийг
  // бүхэлд нь атомик гүйцэтгэдэг тул `WHERE NOT EXISTS` нь шалгалт ба
  // бичилтийг нэг үйлдэл болгоно; `changes === 0` бол хоёр дахь хүсэлт.
  //
  // ⚠️ Session + өнөөдрийн сонголт + өглөөний цэг (+ төсөл/засвар) НЭГ batch
  // (= нэг транзакц).  Өмнө нь session-ийг хадгалсны ДАРАА тусдаа дуудлагууд
  // байсан тул дундаас D1 алдаа гарвал ажилтан «ирсэн» боловч төсөлгүй/цэггүй
  // үлддэг байв.  Бүх мөр ИЖИЛ «нээлттэй session байхгүй» нөхцөлөөр
  // хамгаалагдаж, session INSERT-ээс ӨМНӨ байрлана — транзакцын эхэнд нөхцөл
  // үнэн бол бүгд, худал (давхар хүсэлт) бол юу ч бичигдэхгүй.  Session id нь
  // хараахан байхгүй тул цэг `session_id NULL`-аар орж, INSERT-ийн дараах
  // UPDATE холбоно.  (`writeClockIn`)
  const written = await writeClockIn(c.env.DB, {
    userId: user.sub,
    date: today,
    clockIn,
    ip: clientIp,
    notes: body.notes ?? null,
    lateMinutes,
    deviceId: deviceId || null,
    projectIds,
    repairProjectIds,
  });
  if (!written) {
    return c.json(
      { error: 'Та аль хэдийн ирцээ бүртгэсэн байна. Эхлээд гарах бүртгэл хийнэ үү.' },
      409,
    );
  }
  const { sessionId, checkpointId: morningCheckpointId } = written;
  // Төслийн бус ажил олон алхамтай (`planPicks` → мөр үүсгэх → холбох) тул
  // дээрх batch-д багтахгүй; давтахад аюулгүй, нэг удаа дахин оролдоно.
  const nonProjectSaved = await saveNonProjectPicks(
    c.env.DB,
    { userId: user.sub, date: today, checkpointId: morningCheckpointId, picks: np.picks, now: clockIn },
    settings,
  );
  // Дахин орсон бол шинэ (нээлттэй) session нь өмнө нэмэгдсэн төслийн бус
  // ажлын хугацаатай давхцаж болно — тэр хэсэг одоо оффисын цаг (0352).
  if (isReentry) await syncNonProjectCreditSafe(c.env.DB, user.sub, today, settings);
  // Батлагдсан чөлөөний дунд ирсэн бол чөлөө ИРСЭН ЦАГААР богиносно (0364,
  // `lib/leaveArrivalCut.ts`).  Зөвхөн өдрийн анхны ирэлт — дахин орох нь
  // `MIN(clock_in)`-ийг өөрчлөхгүй.  Safe: алдаа ирц бүртгэлийг унагахгүй.
  const leaveCuts = isReentry
    ? []
    : (await syncLeaveArrivalCutsSafe(c.env.DB, user.sub, today, settings)).filter(
        (r) => r.changed && r.cut,
      );
  const leaveCutNote = leaveCuts.map((r) => describeCut(r.cut!)).join(' ');
  const notes = [leaveCutNote, nonProjectSaved ? '' : NON_PROJECT_NOT_SAVED].filter(Boolean).join(' ');

  return c.json({
    message: notes ? `Ирцийн бүртгэл амжилттай. ${notes}` : 'Ирцийн бүртгэл амжилттай',
    non_project_saved: nonProjectSaved,
    leave_adjustments: leaveCuts.map((r) => ({ leave_id: r.leave_id, ...r.cut! })),
    session_id: sessionId,
    clock_in: clockIn,
    date: today,
    schedule: shift.label,
    late_minutes: lateMinutes,
    late_penalty: lateMinutes * settings.latePenaltyPerMinute,
    project_ids: projectIds,
    repair_project_ids: repairProjectIds,
  });
});

// POST /api/attendance/clock-out — close the open session for today
attendance.post('/clock-out', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<ClockOutRequest>().catch(() => ({}) as ClockOutRequest);

  const clientIp = getClientIp(c);
  const settings = await getAttendanceSettings(c.env.DB);
  const officeBlock = await enforceAttendanceOfficeIp(c, user, clientIp, settings);
  if (officeBlock) return officeBlock;

  const today = todayInUB();
  const session = await c.env.DB.prepare(
    `SELECT * FROM attendance_sessions
     WHERE user_id = ? AND date = ? AND clock_out IS NULL
     ORDER BY clock_in DESC LIMIT 1`,
  )
    .bind(user.sub, today)
    .first<AttendanceSessionRow>();

  if (!session) {
    // Өнөөдөр нээлттэй бүртгэл алга = аль хэдийн гарсан, эсвэл ирээгүй.
    // Frontend нь энэ кодыг аваад төлвөө дахин уншиж аль нь болохыг хэлнэ
    // (сүлжээ тасарч хариу нь алдагдсан амжилттай гарах бүртгэлийг «алдаа»
    // гэж харуулахгүйн тулд).
    return c.json(
      {
        error: 'Өнөөдөр нээлттэй ирсэн бүртгэл алга — та аль хэдийн гарсан эсвэл ирсэн бүртгэл хийгээгүй байна',
        code: 'NO_OPEN_SESSION',
      },
      404,
    );
  }

  const clockOut = nowInUBIso();
  const hours = computeHours(session.clock_in, clockOut, {
    date: session.date,
    settings,
    shift: countingWindow(await loadShiftForUser(c.env.DB, user.sub, session.date), user.role),
  });
  const projectIds = normalizeProjectIds(body.project_ids);
  const repairProjectIds = normalizeProjectIds(body.repair_project_ids);
  // Гарах цэгт сонгосон төслийн бус ажил (0357) — зөвхөн хяналт.
  const np = readNonProjectPicks(user, body.non_project);
  if (!np.ok) return c.json({ error: np.error, code: np.code }, 400);
  const unrestricted = await isAttendanceUnrestricted(c.env.DB, user);
  const worker = isWorkerUser(user);
  // Admin tier + онцгойлсон ажилтнууд (мөн цэвэрлэгч) төсөл сонгохгүйгээр гарч болно.
  const nonProject =
    unrestricted || worker ? null : await nonProjectDayCounts(c.env.DB, user.sub, today);
  if (
    projectIds.length + repairProjectIds.length + (np.picks?.length ?? 0) === 0 &&
    !unrestricted &&
    !worker &&
    (nonProject?.total ?? 0) === 0
  ) {
    return c.json(
      {
        error: 'Тарах үеийн төслөө сонгоно уу',
        detail: 'Гарсан бүртгэл хийхдээ тухайн үед ажиллаж байсан төслөө баталгаажуулна уу.',
        code: 'PROJECT_REQUIRED',
      },
      400,
    );
  }
  const tooMany = tooManyProjects(projectIds, repairProjectIds);
  if (tooMany) return c.json(tooMany, 400);
  const validationError =
    (await validateProjectIds(c.env.DB, user, projectIds)) ??
    (await validateRepairProjectIds(c.env.DB, repairProjectIds));
  if (validationError) return validationError;

  // Гарахын өмнө өнөөдөр дор хаяж нэг ажлын явц (task-ийн гүйцэтгэлийн хувь
  // ЭСВЭЛ засвар) бүртгэсэн байх ёстой — admin/онцгойлсноос бусдад.
  // "Амарсан" болон "маргааш хийнэ" гэсэн бичлэгийг тооцохгүй.
  // Цэвэрлэгч task/засвар бүртгэдэггүй тул энэ шалгуураас чөлөөлөгдөнө.
  if (!unrestricted && !worker) {
    // Шинэ төслийн бус сонголт ч ажлын баримт — хүсэлт дотор мөр болж бичигдэнэ.
    const reported =
      (np.picks?.length ?? 0) > 0 || (await hasReportedWorkToday(c.env.DB, user.sub, today));
    if (!reported) {
      return c.json(
        {
          error: 'Гарахын өмнө ажлын явцаа оруулна уу',
          detail:
            'Өнөөдөр дор хаяж нэг төсөл дээр task-ийн гүйцэтгэлийн хувиа эсвэл засвараа бүртгэсэн байх шаардлагатай.',
          code: 'PROGRESS_REQUIRED',
        },
        400,
      );
    }
    // Төслийн бус ажлын «юу хийсэн»-ийг ЭНД шаардахаа больсон (2026-09-28):
    // ажилтан ажлаа дуусгасны дараа «Миний ажлууд»-аас цагтай нь оруулна.
  }

  // ⚠️ Session хаалт + өнөөдрийн сонголт + гарах цэг НЭГ batch (транзакц) —
  // clock-in-тэй ижил шалтгаан (`writeClockOut`).  Зэрэг ирсэн хоёр дахь
  // «Гарах» юу ч бичихгүй → 409.
  const clockOutCheckpointId = await writeClockOut(c.env.DB, {
    userId: user.sub,
    date: today,
    sessionId: session.id,
    clockOut,
    hours,
    notes: body.notes ?? null,
    projectIds,
    repairProjectIds,
  });
  if (clockOutCheckpointId === null) {
    return c.json({ error: 'Гарсан бүртгэл аль хэдийн хийгдсэн байна', code: 'ALREADY_CLOCKED_OUT' }, 409);
  }
  // «Гарах» = ажлаас гарсан → албан таскийн таймер зогсоно, нэр таскаас арилна
  // (эзэн 2026-10-01).  Алдаа нь гарах бүртгэлийг унагахгүй.
  await stopTimerOnClockOut(c.env.DB, { userId: user.sub, actorId: user.sub, clockOutIso: clockOut }).catch(
    (err: unknown) => console.error('[task-timer] stop on clock-out failed', err),
  );
  const nonProjectSaved = await saveNonProjectPicks(
    c.env.DB,
    { userId: user.sub, date: today, checkpointId: clockOutCheckpointId, picks: np.picks, now: clockOut },
    settings,
  );
  // ⚠️ ГАРАХ ЦАГ БОДИТООРОО (жишээ 15:00) хадгалагдана, харин тэр цагаас
  // хойших (эсвэл ирэхээс өмнөх) төслийн бус ажлын хугацаа ажилласан цагт
  // нэмэгдэнэ — 15:00-д гараад 17:00 хүртэл зохиогчийн хяналтад явсан хүн
  // бүтэн өдрөө авна (эзний шийдвэр 2026-09-28, миграц 0352).
  const credit = await syncNonProjectCreditSafe(c.env.DB, user.sub, today, settings);
  const nonProjectCreditHours = credit.sessionId === session.id ? credit.creditHours : 0;

  return c.json({
    message: nonProjectSaved
      ? 'Гарсан бүртгэл амжилттай'
      : 'Гарсан бүртгэл амжилттай. Төслийн бус ажлын сонголт хадгалагдсангүй — «Миний ажлууд»-аас бүртгэнэ үү.',
    non_project_saved: nonProjectSaved,
    session_id: session.id,
    clock_in: session.clock_in,
    clock_out: clockOut,
    hours_worked: Math.round((hours + nonProjectCreditHours) * 100) / 100,
    non_project_credit_hours: nonProjectCreditHours,
    project_ids: projectIds,
    repair_project_ids: repairProjectIds,
  });
});

// ---------------------------------------------------------------------------
// Employee Self-Service
// ---------------------------------------------------------------------------

// GET /api/attendance/my-status — Current clock-in status for today
attendance.get('/my-status', async (c) => {
  const user = c.get('user');
  const today = todayInUB();

  const session = await c.env.DB.prepare(
    `SELECT * FROM attendance_sessions
     WHERE user_id = ? AND date = ?
     ORDER BY clock_in DESC LIMIT 1`,
  )
    .bind(user.sub, today)
    .first<AttendanceSessionRow>();

  // Тухайн өдөр approved чөлөө / өглөөний ирэлтийг хамарсан гадуур ажилтай
  // бол хоцролтыг ажилтанд харуулахгүй (торгуульгүй) — report талтай ижил
  // дүрэм.  Ирсэн цагийг дамжуулснаар үдээс хойшхи гадуур ажил өглөөний
  // хоцролтыг цуцлахгүй.
  if (
    session &&
    (session.late_minutes ?? 0) > 0 &&
    (await isLateWaived(c.env.DB, user.sub, today, extractClock(session.clock_in)))
  ) {
    session.late_minutes = 0;
  }

  // Өмнөх өдрийн хаагдаагүй бүртгэлээс болж ирэх бүртгэл ХААГДСАН эсэх.
  // Дээрх `session` нь зөвхөн ӨНӨӨДРИЙНХ (`date = ?`) тул энэ мэдээлэл
  // хариунаас өөр хаанаас ч гарахгүй — UI товч дарж 409 идэхээс өмнө
  // хэрэглэгчид шалтгааныг хэлэх ёстой.
  //
  // ⚠️ `POST /clock-in`-ийн хаалттай ЯГ ижил хос дуудлага (чөлөөлөлт +
  // предикат) — хоёр тал зөрвөл UI сервертэй зөрчилдөнө.
  const blockedOpenSession = (await isClockOutRuleExempt(c.env.DB, user))
    ? null
    : await findStaleOpenSession(c.env.DB, user.sub, today);

  // Surface whether the caller is currently on the office network so the UI
  // can tell the user *why* the button is disabled before they click it.
  // Also echo the raw client IP back so the user (or an admin standing
  // beside them) can ask IT to whitelist the right /24 subnet — DHCP-leased
  // public IPs typically vary by the last octet across days.
  const clientIp = getClientIp(c);
  const onOfficeIp = await isOfficeIp(c.env.DB, clientIp);

  // Цагийн хуваарь + 1 цаг хоцрох тутамд хичнээн төгрөг гэдгийг
  // мөн ажилтны UI-д буцааж урьдчилан мэдэгдье.
  const userRow = await c.env.DB.prepare(`SELECT work_schedule FROM users WHERE id = ?`)
    .bind(user.sub)
    .first<{ work_schedule: ScheduleKey }>();
  //
  // ЭЭЛЖИЙН ГУРВАН ӨӨР ТОО (2026-08-26) — эдгээрийг хооронд нь БҮҮ ХУТГА:
  //   `scheduleKey`  — ӨНӨӨДӨР бодитоор үйлчилж буй ээлж (зунаар дарагдсан).
  //   `selected`     — ажилтны СОНГОСОН ээлж; picker-т энэ идэвхтэй харагдана.
  //   `changesTo`    — ажлын цаг дараагийн удаа өөрчлөгдөх өдөр ба шинэ ээлж.
  //
  // ⚠️ Урьд нь UI нь сонголтоо `work_schedule` (=бодит ээлж) дээр тулгуурлаж
  //    байсан тул зуны үед бүх хүнд `early` идэвхтэй харагддаг байв — хүн
  //    `standard` хадгалсан ч.  Тиймээс ХОЁРЫГ ТУСАД НЬ буцаана.
  const scheduleAssignments = await getScheduleAssignments(c.env.DB, user.sub);
  const outlook = scheduleOutlook(userRow?.work_schedule, today, scheduleAssignments);
  const scheduleKey = outlook.effective;
  const shiftOfToday = shiftForUser(user.sub, userRow?.work_schedule, today, scheduleAssignments);
  const fixedShift = hasFixedShift(user.sub);
  // Ажилтан өөрөө ээлж солих UI хаагдсан (2026-09-03).  Зөвхөн админ
  // `PUT /api/users/:id`-ээр өөрчилнө.  `summer_forced` нь зуны тайлбарт.
  const summerForced = fixedShift ? false : isSummerSchedule(today);
  const scheduleLocked = true;

  // Өнөөдрийн идэвхтэй төслүүд — UI-д clock-in товч идэвхтэй болгох
  // эсэхийг шийдэхэд, мөн My Tasks-ийн "Active" tab-д ашиглана.
  const { results: activeRows } = await c.env.DB.prepare(
    `SELECT project_id FROM daily_active_projects WHERE user_id = ? AND date = ?`,
  )
    .bind(user.sub, today)
    .all<{ project_id: number }>();
  // Засварын төслийн сонголт (0324) + popup-ийн «Засварын төсөл» хуудасны
  // жагсаалт.  Жагсаалтыг ЭНД өгснөөр frontend нь `/api/repair/projects`
  // (өөр role gate, өөр prefix) руу тусдаа хүсэлт хийхгүй.
  const [activeRepairRes, repairListRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT repair_project_id FROM daily_active_repairs WHERE user_id = ? AND date = ?`,
    )
      .bind(user.sub, today)
      .all<{ repair_project_id: number }>(),
    c.env.DB.prepare(
      `SELECT id, name, description FROM repair_projects
        WHERE status = 'active' ORDER BY sort_order ASC, name ASC`,
    ).all<{ id: number; name: string; description: string | null }>(),
  ]);
  const checkpoints = await getCheckpointSummaries(c.env.DB, user.sub, today);
  const checkpointTypes = new Set(checkpoints.map((cp) => cp.checkpoint_type));
  // Өнөөдрийн төслийн бус ажил (0342) — popup-ийн «Төслийн бус ажил» хуудас
  // ба «дор хаяж нэг» тоололд.  `/api/non-project-work` руу тусдаа хүсэлт
  // хийлгэхгүйн тулд ЭНД өгнө (засварын төслийн жагсаалттай ижил шалтгаан).
  const nonProjectToday = await loadTodayForAttendance(c.env.DB, user.sub, today);

  const settings = await getAttendanceSettings(c.env.DB);
  const attendanceIpRequired = await attendanceOfficeIpRequired(c.env.DB, user, settings);

  const worker = isWorkerUser(user);
  const reportedToday = worker || (await hasReportedWorkToday(c.env.DB, user.sub, today));

  return c.json({
    today,
    clocked_in: session ? !session.clock_out : false,
    on_office_ip: onOfficeIp,
    require_office_ip: attendanceIpRequired,
    client_ip: clientIp,
    session: session ?? null,
    work_schedule: scheduleKey,
    schedule_label: shiftOfToday.label,
    schedule_locked: scheduleLocked,
    /** Зуны албадлага (6–8 сар) идэвхтэй эсэх — UI-н тайлбар бичихэд. */
    summer_forced: summerForced,
    /** Ажилтны СОНГОСОН ээлж (picker-ийн идэвхтэй товч). */
    schedule_selected: outlook.selected,
    /** Одоо сонголт хийвэл хэзээнээс хүчинтэй болох вэ (маргааш, зуны үед
     *  зун дуусах өдөр).  UI нь «...-нээс эхэлнэ» гэж бичнэ. */
    schedule_effective_from: scheduleEffectiveFrom(today),
    /** Ажлын цаг дараагийн удаа өөрчлөгдөх өдөр + шинэ ээлж.  `null` бол
     *  өөрчлөлт хүлээгдэхгүй.  «Маргааш ч ажил 08:00-д эхэлнэ» гэсэн
     *  сануулга ЭНЭ талбар дээр тулгуурлана. */
    schedule_change: fixedShift
      ? null
      : outlook.changesTo
        ? {
            schedule: outlook.changesTo.schedule,
            date: outlook.changesTo.date,
            label: SHIFTS[outlook.changesTo.schedule].label,
          }
        : null,
    /** Сонгож болох бүх ээлж — шошгыг СЕРВЕРЭЭС өгснөөр frontend-ийн
     *  дөрвөн хуулбар шошго зөрөх эрсдэл арилна (`ORG_SHIFT_*` тохиргоог
     *  UI мөрддөг болно). */
    schedule_options: SCHEDULE_KEYS.map((k) => ({
      key: k,
      label: SHIFTS[k].label,
      start: hhmmOfMinutes(SHIFTS[k].startMinutes),
      end: hhmmOfMinutes(SHIFTS[k].endMinutes),
    })),
    late_penalty_per_minute: settings.latePenaltyPerMinute,
    late_grace_minutes: settings.lateGraceMinutes,
    active_project_ids: (activeRows ?? []).map((r) => r.project_id),
    /** Өнөөдөр сонгосон ЗАСВАРЫН төслүүд (`repair_projects.id` — `projects.id`-тэй
     *  ХОЛИХГҮЙ). */
    active_repair_project_ids: (activeRepairRes.results ?? []).map((r) => r.repair_project_id),
    /** Popup-д сонгож болох идэвхтэй засварын төслүүд. */
    repair_projects: repairListRes.results ?? [],
    /** Төслийн бус ажил (0342): өнөөдрийн бүртгэл + маягтын ангилал, цайны цонх.
     *  Татгалзсан мөр ч жагсаалтад орно (төлөвөөр нь харагдана), харин
     *  «дор хаяж нэг» тоололд орохгүй — `nonProjectDayCounts`. */
    non_project_work: {
      today: nonProjectToday,
      ...nonProjectMeta(
        settings,
        hhmmOfMinutes(shiftOfToday.endMinutes),
        hhmmOfMinutes(shiftOfToday.startMinutes),
      ),
    },
    checkpoints,
    // Үдээс хойших төслийн баталгаажуулалт цэвэрлэгчид хамаарахгүй.
    next_checkpoint_prompt: worker
      ? null
      : getNextCheckpointPrompt({ session: session ?? null, checkpointTypes }),
    progress_logged_today: reportedToday,
    // null = хаалтгүй.  Бөглөгдсөн бол ирэх бүртгэл БОЛОМЖГҮЙ бөгөөд
    // зөвхөн удирдлага (Ирц → «Хаагдаагүй бүртгэл») тайлж чадна.
    blocked_open_session: blockedOpenSession,
  });
});

// POST /api/attendance/checkpoint — save a midday project confirmation.
attendance.post('/checkpoint', async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<AttendanceCheckpointRequest>()
    .catch((): AttendanceCheckpointRequest => ({}));
  const checkpointType = body.checkpoint_type ?? 'afternoon';

  if (checkpointType !== 'afternoon') {
    return c.json({ error: 'Зөвхөн үдээс хойших checkpoint энд бүртгэнэ' }, 400);
  }

  const clientIp = getClientIp(c);
  const settings = await getAttendanceSettings(c.env.DB);
  const officeBlock = await enforceAttendanceOfficeIp(c, user, clientIp, settings);
  if (officeBlock) return officeBlock;

  const today = todayInUB();
  const session = await c.env.DB.prepare(
    `SELECT * FROM attendance_sessions
     WHERE user_id = ? AND date = ? AND clock_out IS NULL
     ORDER BY clock_in DESC LIMIT 1`,
  )
    .bind(user.sub, today)
    .first<AttendanceSessionRow>();

  if (!session) {
    return c.json({ error: 'Эхлээд ирсэн бүртгэл хийсэн байх шаардлагатай' }, 400);
  }

  if (ubMinutesOf(nowInUBIso()) < 14 * 60) {
    return c.json(
      {
        error: 'Үдээс хойших checkpoint 14:00-аас хойш нээгдэнэ',
      },
      400,
    );
  }

  const projectIds = normalizeProjectIds(body.project_ids);
  const repairProjectIds = normalizeProjectIds(body.repair_project_ids);
  const np = readNonProjectPicks(user, body.non_project);
  if (!np.ok) return c.json({ error: np.error, code: np.code }, 400);
  // Admin tier + онцгойлсон ажилтнууд (мөн цэвэрлэгч) төсөл сонгохгүйгээр
  // баталгаажуулж болно.
  if (
    projectIds.length + repairProjectIds.length + (np.picks?.length ?? 0) === 0 &&
    !isWorkerUser(user) &&
    !(await isAttendanceUnrestricted(c.env.DB, user)) &&
    // Өнөөдөр бүртгэсэн төслийн бус ажил (0342) ч хангана.
    (await nonProjectDayCounts(c.env.DB, user.sub, today)).total === 0
  ) {
    return c.json(
      {
        error: 'Үдээс хойш ажиллах төслөө сонгоно уу',
        detail: '14:00 орчмын popup дээр дор хаяж нэг төсөл сонгоорой.',
      },
      400,
    );
  }
  const tooMany = tooManyProjects(projectIds, repairProjectIds);
  if (tooMany) return c.json(tooMany, 400);

  const validationError =
    (await validateProjectIds(c.env.DB, user, projectIds)) ??
    (await validateRepairProjectIds(c.env.DB, repairProjectIds));
  if (validationError) return validationError;

  const recordedAt = nowInUBIso();
  // Өнөөдрийн сонголт + цэг нэг batch-д (`saveProjectCheckpoint`).
  const checkpointId = await saveProjectCheckpoint(c.env.DB, {
    userId: user.sub,
    date: today,
    sessionId: session.id,
    checkpointType,
    recordedAt,
    projectIds,
    repairProjectIds,
    notes: body.notes ?? null,
  });
  const nonProjectSaved = await saveNonProjectPicks(
    c.env.DB,
    { userId: user.sub, date: today, checkpointId, picks: np.picks, now: recordedAt },
    settings,
  );

  return c.json({
    message: nonProjectSaved
      ? 'Үдээс хойших төсөл баталгаажлаа'
      : `Үдээс хойших төсөл баталгаажлаа. ${NON_PROJECT_NOT_SAVED}`,
    non_project_saved: nonProjectSaved,
    checkpoint_id: checkpointId,
    checkpoint_type: checkpointType,
    recorded_at: recordedAt,
    project_ids: projectIds,
    repair_project_ids: repairProjectIds,
  });
});

// ---------------------------------------------------------------------------
// Daily Active Projects — which projects the user plans to work on today.
// Captured before clock-in (the clock-in route hard-rejects empty sets).
// ---------------------------------------------------------------------------

// GET /api/attendance/active-projects?date=YYYY-MM-DD
attendance.get('/active-projects', async (c) => {
  const user = c.get('user');
  const date = c.req.query('date') ?? todayInUB();

  const [projectRes, repairRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT dap.project_id, p.name
         FROM daily_active_projects dap
         JOIN projects p ON p.id = dap.project_id
        WHERE dap.user_id = ? AND dap.date = ?
        ORDER BY p.name`,
    )
      .bind(user.sub, date)
      .all<{ project_id: number; name: string }>(),
    c.env.DB.prepare(
      `SELECT dar.repair_project_id, rp.name
         FROM daily_active_repairs dar
         JOIN repair_projects rp ON rp.id = dar.repair_project_id
        WHERE dar.user_id = ? AND dar.date = ?
        ORDER BY rp.name`,
    )
      .bind(user.sub, date)
      .all<{ repair_project_id: number; name: string }>(),
  ]);
  const results = projectRes.results ?? [];
  const repairs = repairRes.results ?? [];

  return c.json({
    date,
    project_ids: results.map((r) => r.project_id),
    projects: results,
    repair_project_ids: repairs.map((r) => r.repair_project_id),
    repair_projects: repairs,
  });
});

// PUT /api/attendance/active-projects — replace today's set
attendance.put('/active-projects', async (c) => {
  const user = c.get('user');
  type Body = { project_ids?: number[]; repair_project_ids?: number[] };
  const body = await c.req.json<Body>().catch((): Body => ({}));
  const today = todayInUB();

  const ids = normalizeProjectIds(body.project_ids);
  const repairIds = normalizeProjectIds(body.repair_project_ids);
  const tooMany = tooManyProjects(ids, repairIds);
  if (tooMany) return c.json(tooMany, 400);

  // Validate that each requested project exists.  Clients can only pick
  // projects they're a member of; internal staff can pick any project
  // (mirrors the visibility rules in `projects.get('/:id')`).
  const validationError =
    (await validateProjectIds(c.env.DB, user, ids)) ??
    (await validateRepairProjectIds(c.env.DB, repairIds));
  if (validationError) return validationError;

  // D1 has no real transactions across statements, but `batch` runs them
  // atomically on the same statement queue so a partial failure leaves the
  // table in a clean state for this user/date pair.
  await replaceDailyActiveProjects(c.env.DB, user.sub, today, ids, repairIds);

  return c.json({ date: today, project_ids: ids, repair_project_ids: repairIds });
});

// GET /api/attendance/my-sessions — Current user's attendance history
attendance.get('/my-sessions', async (c) => {
  const user = c.get('user');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30', 10), 100);

  // Хоцролтыг my-status-тай ИЖИЛ дүрмээр буцаана: тухайн өдөр approved
  // чөлөө/гадуур ажилтай бол хоцролт хасагдаж 0 болно (`LATE_NOT_WAIVED_SQL`,
  // alias `a`).  Энэ нь түүхэн жагсаалтад чөлөөтэй өдрийг буруугаар "хоцорсон"
  // гэж харуулахаас сэргийлнэ.  Predicate нь placeholder агуулаагүй тул
  // bind-ийн дарааллыг өөрчлөхгүй.
  let query = `SELECT a.*,
      (CASE WHEN ${LATE_NOT_WAIVED_SQL} THEN a.late_minutes ELSE 0 END) AS late_minutes_effective
    FROM attendance_sessions a WHERE a.user_id = ?`;
  const binds: (string | number)[] = [user.sub];

  if (from) {
    query += ` AND a.date >= ?`;
    binds.push(from);
  }
  if (to) {
    query += ` AND a.date <= ?`;
    binds.push(to);
  }

  query += ` ORDER BY a.clock_in DESC LIMIT ?`;
  binds.push(limit);

  const { results } = await c.env.DB.prepare(query)
    .bind(...binds)
    .all<AttendanceSessionRow & { late_minutes_effective: number }>();

  // `late_minutes_effective`-ийг бодит `late_minutes` болгож, туслах баганыг хасна.
  const sessions = (results ?? []).map((r) => {
    const { late_minutes_effective, ...rest } = r;
    return { ...rest, late_minutes: late_minutes_effective };
  });

  const weekStart = getWeekStart(todayInUB());
  const weekSessions = sessions.filter((s) => s.date >= weekStart);
  const weekHours = weekSessions.reduce((sum, s) => sum + (s.hours_worked ?? 0), 0);

  return c.json({
    sessions,
    week_summary: {
      total_hours: Math.round(weekHours * 100) / 100,
      days_present: new Set(weekSessions.map((s) => s.date)).size,
      week_start: weekStart,
    },
  });
});

// ---------------------------------------------------------------------------
// Admin Endpoints
// ---------------------------------------------------------------------------

// GET /api/attendance/sessions — All attendance records (admin)
attendance.get('/sessions', requireRole('admin', 'senior'), async (c) => {
  const date = c.req.query('date') ?? todayInUB();
  const userId = c.req.query('user_id');

  let query = `
    SELECT a.*, u.full_name, u.employee_id, u.profile_image
    FROM attendance_sessions a
    JOIN users u ON u.id = a.user_id
    WHERE a.date = ?
  `;
  const binds: (string | number)[] = [date];

  if (userId) {
    query += ` AND a.user_id = ?`;
    binds.push(parseInt(userId, 10));
  }

  query += ` ORDER BY a.clock_in ASC`;

  const { results } = await c.env.DB.prepare(query)
    .bind(...binds)
    .all();

  return c.json({ date, sessions: results });
});

// GET /api/attendance/open-sessions — өмнөх өдрүүдийн хаагдаагүй бүртгэлүүд (admin)
//
// Ажилтан орой тарахдаа цагаа хаахаа мартвал session нь clock_out NULL
// хэвээр үлдэж, тайлангууд (`clock_out IS NOT NULL` шүүлттэй) тухайн
// өдрийг "ирээгүй" мэт тооцдог.  Энэ жагсаалтаас админ мартагдсан
// бүртгэлүүдийг олж, доорх POST-оор гарах цагийг нь нөхөж бичнэ.
/**
 * Нэг хүсэлтэд буцаах хаагдаагүй бүртгэлийн дээд тоо.
 *
 * ⚠️ 200 байсныг 500 болгосон (2026-08-26).  Админ энэ жагсаалтыг одоо
 * БАГААР нь шүүж, тухайн багийн сениорт өгөх баримт болгон хэвлэдэг
 * болсон — таслагдсан жагсаалт нь «энэ бол таны багийн бүх өр» гэсэн
 * албан шаардлагыг ХУДАЛ болгоно.  Хамгийн том баг (БА) дангаараа 200
 * мөрт хүрч байсан тул хуучин хязгаар яг тэр газраа тасалдаг байв.
 *
 * Таслагдсан эсэхийг хэрэглэгчээс НУУХГҮЙ: хариунд `total` (хязгаараас
 * ӨМНӨХ бодит тоо) явуулж, UI нь `total > sessions.length` үед
 * анхааруулга харуулна.
 */
const OPEN_SESSIONS_LIMIT = 500;

attendance.get('/open-sessions', requireRole('admin', 'senior'), async (c) => {
  const today = todayInUB();

  // `team_code` / `team_name` нь ҮНДСЭН (`user_teams.is_primary = 1`) баг —
  // ирцийн бусад хэсэгтэй (daily-grid, хураангуй, чөлөө) ижил дүрслэл.
  //
  // ⚠️ ЯАГААД ХАРЬЯАЛАЛ БҮРЭЭР БИШ, ЗӨВХӨН ҮНДСЭН БАГААР ВЭ:
  // `daily-grid`-ийн `team_id` шүүлт нь `user_teams`-ийн ЯМАР Ч мөрөөр
  // тааруулдаг.  Энэ жагсаалтад тэр нь буруу хариу өгнө — production
  // өгөгдөл дээр БА багийн бүх гишүүн IZ, EZ багт хоёрдогчоор
  // бүртгэлтэй тул «IZ» гэж шүүхэд 42-ын оронд 242 мөр гарч, IZ-ийн
  // сениор БА-гийн хүмүүсийн өрийг хүлээж авах байсан.  Үндсэн багаар
  // шүүхэд бүлгүүд ДАВХЦАХГҮЙ (нийлбэр нь яг `total`) бөгөөд баганад
  // харагдаж буй баг нь шүүлттэйгээ ҮРГЭЛЖ таарна.
  const { results } = await c.env.DB.prepare(
    `
    SELECT a.*, u.full_name, u.employee_id, u.profile_image,
           pt.code AS team_code, pt.name_mn AS team_name,
           pt.sort_order AS team_sort
    FROM attendance_sessions a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
    LEFT JOIN teams pt ON pt.id = ut_p.team_id
    WHERE a.clock_out IS NULL AND a.date < ?
    ORDER BY a.date DESC, a.clock_in ASC
    LIMIT ${OPEN_SESSIONS_LIMIT}
  `,
  )
    .bind(today)
    .all();

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM attendance_sessions a
      WHERE a.clock_out IS NULL AND a.date < ?`,
  )
    .bind(today)
    .first<{ n: number }>();

  return c.json({
    sessions: results ?? [],
    total: totalRow?.n ?? (results ?? []).length,
    limit: OPEN_SESSIONS_LIMIT,
  });
});

// POST /api/attendance/sessions/:id/clock-out — гарах цаг нөхөх/засах (admin)
//
// Body: { time: 'HH:mm', note?: string, next_day?: boolean }.  `time` нь
// session-ы өдрийн (UB) цаг; `next_day: true` бол шөнө дөлөөр (00:00-аас
// хойш) тарсан гэж үзэн дараагийн өдрийн огноонд бичнэ.  Зөвхөн:
//   - нээлттэй (clock_out NULL) session-ыг хаах, эсвэл
//   - өмнө нь админ нөхсөн утгыг залруулахыг зөвшөөрнө —
// ажилтны ӨӨРИЙН бүртгэсэн (organic) гарах цагийг энэ route-оор дарж
// засах боломжгүй.  Хэн/хэзээ/яагаад нөхснийг edited_by / edited_at /
// edit_note (0099) баганад үлдээж, залруулгад өмнөх утгыг note-д хадгална.
attendance.post('/sessions/:id/clock-out', requireRole('admin', 'senior'), async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req
    .json<{ time?: string; note?: string; next_day?: boolean }>()
    .catch((): { time?: string; note?: string; next_day?: boolean } => ({}));

  const time = typeof body.time === 'string' ? body.time.trim() : '';
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
    return c.json({ error: 'Гарах цаг (HH:mm) шаардлагатай' }, 400);
  }
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const session = await c.env.DB.prepare(`SELECT * FROM attendance_sessions WHERE id = ?`)
    .bind(id)
    .first<AttendanceSessionRow>();
  if (!session) return c.json({ error: 'Бүртгэл олдсонгүй' }, 404);

  // Organic (ажилтны өөрөө хаасан) бүртгэлийг өөрчлөхийг хориглоно —
  // цалин/тайлангийн өгөгдлийг чимээгүй дарж бичих гарцыг хаана.
  if (session.clock_out && !session.edited_by) {
    return c.json({ error: 'Ажилтны өөрөө бүртгэсэн гарах цагийг засах боломжгүй' }, 409);
  }

  // Session-ы өдрийн (эсвэл next_day үед маргаашийн) UB цагаар ISO
  // болгоно — clock_in-тэй ижил формат тул epoch-оор шууд жишиж болно.
  const outDate = body.next_day === true ? nextDayIso(session.date) : session.date;
  const clockOut = `${outDate}T${time}:00+08:00`;
  const outMs = new Date(clockOut).getTime();
  if (outMs <= new Date(session.clock_in).getTime()) {
    return c.json({ error: 'Гарах цаг ирсэн цагаас хойш байх ёстой' }, 400);
  }
  // Ирээдүйн цаг нөхөхийг хориглоно — одоо ажиллаж буй хүний session-ыг
  // "18:00-д тарна" гэж урьдчилан хаах боломжгүй.
  if (outMs > new Date(nowInUBIso()).getTime()) {
    return c.json({ error: 'Ирээдүйн цаг бүртгэх боломжгүй' }, 400);
  }

  const settings = await getAttendanceSettings(c.env.DB);
  const hours = computeHours(session.clock_in, clockOut, {
    date: session.date,
    settings,
    shift: await loadCountingWindow(c.env.DB, session.user_id, session.date),
  });
  // Залруулга бол өмнөх утгыг edit_note-д хадгална — анхны нөхөлтийн
  // утга алга болохгүй (append-only түүхийн хямд хувилбар).
  const prevPrefix = session.clock_out
    ? `[өмнөх: ${extractClock(session.clock_out) ?? session.clock_out}] `
    : '';
  const fullNote = `${prevPrefix}${note ?? ''}`.trim() || null;

  // CAS (2026-10-15): уншсан агшны `clock_out`/`edited_by` хэвээр байх үед л бичнэ — дээрх organic хамгаалалтыг уншсаны
  // ДАРАА ажилтан өөрөө «Гарах» дарсан (эсвэл өөр админ зэрэг зассан) бол тэр бүртгэлийг чимээгүй дарахгүй.
  const adminOut = await c.env.DB.prepare(
    `UPDATE attendance_sessions
     SET clock_out = ?, hours_worked = ?, non_project_credit_hours = 0,
         edited_by = ?, edited_at = ?, edit_note = ?
     WHERE id = ? AND clock_out IS ? AND edited_by IS ?`,
  )
    .bind(clockOut, hours, user.sub, nowInUBIso(), fullNote, id, session.clock_out ?? null, session.edited_by ?? null)
    .run();
  if (!adminOut.meta.changes) {
    return c.json(
      { error: 'Бүртгэл энэ хооронд өөрчлөгдсөн байна — жагсаалтаа шинэчлээд дахин оролдоно уу', code: 'SESSION_CHANGED' },
      409,
    );
  }
  if (!session.clock_out && session.date === todayInUB()) {
    await stopTimerOnClockOut(c.env.DB, {
      userId: session.user_id,
      actorId: user.sub,
      clockOutIso: clockOut,
    }).catch((err: unknown) => console.error('[task-timer] stop on admin clock-out failed', err));
  }
  const credit = await syncNonProjectCreditSafe(c.env.DB, session.user_id, session.date, settings);
  const totalHours =
    credit.sessionId === id ? Math.round((hours + credit.creditHours) * 100) / 100 : hours;

  if (session.user_id !== user.sub) {
    // Ажилтанд нь мэдэгдэнэ — цагийг нь хэн нэгэн өөрчилснийг далдлахгүй.
    await createNotification(
      c.env.DB,
      session.user_id,
      'attendance_adjusted',
      'Гарах цагийг админ нөхөж бүртгэлээ',
      `${session.date} — ${time}${note ? ` (${note})` : ''}`,
      '/app/attendance',
    );
  }
  // Өөрийн session-оо нөхөж буй тохиолдолд мэдэгдэл илгээхгүй — өмнө нь
  // бүх админд цацдаг байсныг хассан (7 админ бүгдийг чирэгдүүлэхгүй).

  // Audit лог — хэн, хэний, аль өдрийн гарах цагийг нөхснийг үлдээнэ.
  await logAdminAction(c.env.DB, {
    actorId: user.sub,
    targetUserId: session.user_id,
    action: 'session_clock_out',
    date: session.date,
    details: `${time}${body.next_day ? ' (+1 өдөр)' : ''}${note ? ` — ${note}` : ''}`,
  });

  return c.json({
    message: 'Гарах цаг нөхөгдлөө',
    session_id: id,
    date: session.date,
    clock_in: session.clock_in,
    clock_out: clockOut,
    hours_worked: totalHours,
  });
});

// POST /api/attendance/sessions/manual — ирц бүхэлд нь гараар нөхөх (admin)
//
// Огт ирц бүртгээгүй (чөлөөтэй ч ажилласан, мартсан, гадуур ажилтай г.м.)
// хүнд админ ирсэн (+сонголтоор гарсан) цагийг нь нөхөж бүртгэнэ.
// Body: { user_id, date: 'yyyy-mm-dd', clock_in: 'HH:mm',
//         clock_out?: 'HH:mm', next_day?: boolean, note?: string }.
// `clock_out` хоосон бол нээлттэй session үүснэ — өнөөдрийнхөд ажилтан
// өөрөө хааж болно.  Хоцролтыг ажилтны хуваарь + grace-аар тооцно;
// чөлөөтэй өдрийн хоцролт унших талдаа (LATE_NOT_WAIVED_SQL) аль
// хэдийн waive хийгддэг тул энд онцгой тохиолдол хэрэггүй.
// created_by-д үүсгэгчийг үлдээнэ — зөвхөн ийм бичлэгийг устгаж болно.
attendance.post('/sessions/manual', requireRole('admin', 'senior'), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{
      user_id?: number;
      date?: string;
      clock_in?: string;
      clock_out?: string;
      next_day?: boolean;
      note?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);

  const targetId = Number(body.user_id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: 'user_id шаардлагатай' }, 400);
  }
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date (yyyy-mm-dd) шаардлагатай' }, 400);
  }
  const today = todayInUB();
  if (date > today) {
    return c.json({ error: 'Ирээдүйн өдөрт ирц нөхөх боломжгүй' }, 400);
  }
  const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const inTime = typeof body.clock_in === 'string' ? body.clock_in.trim() : '';
  if (!timeRe.test(inTime)) {
    return c.json({ error: 'Ирсэн цаг (HH:mm) шаардлагатай' }, 400);
  }
  const outTime = typeof body.clock_out === 'string' ? body.clock_out.trim() : '';
  if (outTime && !timeRe.test(outTime)) {
    return c.json({ error: 'Гарах цаг (HH:mm) буруу байна' }, 400);
  }
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const target = await c.env.DB.prepare(
    `SELECT id, full_name, role, status, work_schedule FROM users WHERE id = ?`,
  )
    .bind(targetId)
    .first<{
      id: number;
      full_name: string;
      role: string;
      status: string;
      work_schedule: ScheduleKey | null;
    }>();
  if (!target) return c.json({ error: 'Ажилтан олдсонгүй' }, 404);
  if (target.role === 'client') {
    return c.json({ error: 'Захиалагчид ирц бүртгэхгүй' }, 400);
  }

  // Нээлттэй session байвал давхар бичлэг үүсгэхгүй — эхлээд хаалга.
  const openExisting = await c.env.DB.prepare(
    `SELECT id FROM attendance_sessions WHERE user_id = ? AND date = ? AND clock_out IS NULL LIMIT 1`,
  )
    .bind(targetId, date)
    .first();
  if (openExisting) {
    return c.json({ error: 'Тухайн өдөр нээлттэй ирцийн бүртгэл байна — эхлээд хаана уу' }, 409);
  }

  // Тухайн өдөр өмнө нь (хаагдсан) session байвал re-entry гэж үзэн
  // хоцролт тооцохгүй — clock-in route-ын дүрэмтэй ижил.
  const priorSession = await c.env.DB.prepare(
    `SELECT 1 FROM attendance_sessions WHERE user_id = ? AND date = ? LIMIT 1`,
  )
    .bind(targetId, date)
    .first();

  const clockIn = `${date}T${inTime}:00+08:00`;
  const nowMs = new Date(nowInUBIso()).getTime();
  if (new Date(clockIn).getTime() > nowMs) {
    return c.json({ error: 'Ирээдүйн цаг бүртгэх боломжгүй' }, 400);
  }

  // Тохиргоо (хоцролтын grace + цайны цонх) — hours болон late хоёуланд хэрэгтэй.
  const settings = await getAttendanceSettings(c.env.DB);
  // Тухайн өдөрт хүчинтэй байсан ээлж (миграци 0199) — ажилласан цаг
  // (`lib/shiftBoundedHours.ts`) болон хоцролт хоёуланд.
  const targetAssignments = await getScheduleAssignments(c.env.DB, target.id);
  const shift = shiftForUser(target.id, target.work_schedule, date, targetAssignments);

  let clockOut: string | null = null;
  let hours: number | null = null;
  if (outTime) {
    const outDate = body.next_day === true ? nextDayIso(date) : date;
    clockOut = `${outDate}T${outTime}:00+08:00`;
    const outMs = new Date(clockOut).getTime();
    if (outMs <= new Date(clockIn).getTime()) {
      return c.json({ error: 'Гарах цаг ирсэн цагаас хойш байх ёстой' }, 400);
    }
    if (outMs > nowMs) {
      return c.json({ error: 'Ирээдүйн цаг бүртгэх боломжгүй' }, 400);
    }
    hours = computeHours(clockIn, clockOut, {
      date,
      settings,
      shift: countingWindow(shift, target.role),
    });
  }

  // Хоцролт — ажилтны тухайн өдрийн бодит ээлж + grace (clock-in-тэй ижил).
  // ⚠️ `date` нь ӨНГӨРСӨН өдөр байж болно: ээлжийг (`shift`) дээр, ажилласан
  //    цагийн хамт тооцсон — хуваарилалтын түүхээс ТЭР ӨДӨРТ хүчинтэй байсан.
  const lateMinutes = priorSession
    ? 0
    : lateMinutesAgainstShift(ubMinutesOf(clockIn), shift, settings.lateGraceMinutes);

  const editedAt = nowInUBIso();
  const result = await c.env.DB.prepare(
    `INSERT INTO attendance_sessions
       (user_id, clock_in, clock_out, hours_worked, ip_address, date, notes,
        late_minutes, created_by, edited_by, edited_at, edit_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      targetId,
      clockIn,
      clockOut,
      hours,
      'admin-manual',
      date,
      note,
      lateMinutes,
      user.sub,
      user.sub,
      editedAt,
      note,
    )
    .run();
  const sessionId = Number(result.meta.last_row_id);
  await syncNonProjectCreditSafe(c.env.DB, targetId, date, settings);
  await syncLeaveArrivalCutsSafe(c.env.DB, targetId, date, settings);

  const detail = `${inTime}${outTime ? ` → ${outTime}${body.next_day ? ' (+1 өдөр)' : ''}` : ' → ?'}${note ? ` — ${note}` : ''}`;
  if (targetId !== user.sub) {
    // Ажилтанд нь мэдэгдэнэ — ирцийг нь хэн нэгэн нөхснийг далдлахгүй.
    await createNotification(
      c.env.DB,
      targetId,
      'attendance_adjusted',
      'Ирцийг админ нөхөж бүртгэлээ',
      `${date} — ${detail}`,
      '/app/attendance',
    );
  }
  await logAdminAction(c.env.DB, {
    actorId: user.sub,
    targetUserId: targetId,
    action: 'session_create',
    date,
    details: detail,
  });

  return c.json({
    message: 'Ирц нөхөгдлөө',
    session_id: sessionId,
    date,
    clock_in: clockIn,
    clock_out: clockOut,
    hours_worked: hours,
    late_minutes: lateMinutes,
  });
});

// POST /api/attendance/sessions/upsert — "Тайлан" grid-ээс ирц нөхөх/засах (admin)
//
// (user_id, date)-аар тухайн өдрийн session-уудыг тоолж:
//   • 0 session  → шинээр нөхнө (`/sessions/manual`-тай ижил логик).
//   • 1 session  → түүний ирсэн/гарсан цагийг засаж, хоцролт/hours-ийг ДАХИН тооцно.
//   • 2+ session → 409 (нэг бүрчлэн засахыг зөвлөнө) — буруу засахаас сэргийлнэ.
// `/sessions/manual`-ийг хөндөхгүйгээр зэрэгцүүлэн нэмсэн (today таб тэрийг ашигладаг).
attendance.post('/sessions/upsert', requireRole('admin', 'senior'), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{
      user_id?: number;
      date?: string;
      clock_in?: string;
      clock_out?: string;
      next_day?: boolean;
      note?: string;
    }>()
    .catch(() => ({}) as Record<string, never>);

  const targetId = Number(body.user_id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return c.json({ error: 'user_id шаардлагатай' }, 400);
  }
  const date = typeof body.date === 'string' ? body.date.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ error: 'date (yyyy-mm-dd) шаардлагатай' }, 400);
  }
  const today = todayInUB();
  if (date > today) {
    return c.json({ error: 'Ирээдүйн өдөрт ирц нөхөх боломжгүй' }, 400);
  }
  const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const inTime = typeof body.clock_in === 'string' ? body.clock_in.trim() : '';
  if (!timeRe.test(inTime)) {
    return c.json({ error: 'Ирсэн цаг (HH:mm) шаардлагатай' }, 400);
  }
  const outTime = typeof body.clock_out === 'string' ? body.clock_out.trim() : '';
  if (outTime && !timeRe.test(outTime)) {
    return c.json({ error: 'Гарах цаг (HH:mm) буруу байна' }, 400);
  }
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const target = await c.env.DB.prepare(
    `SELECT id, full_name, role, status, work_schedule FROM users WHERE id = ?`,
  )
    .bind(targetId)
    .first<{
      id: number;
      full_name: string;
      role: string;
      status: string;
      work_schedule: ScheduleKey | null;
    }>();
  if (!target) return c.json({ error: 'Ажилтан олдсонгүй' }, 404);
  if (target.role === 'client') {
    return c.json({ error: 'Захиалагчид ирц бүртгэхгүй' }, 400);
  }

  // Тухайн өдрийн бүх session — create/edit/refuse-ийг шийднэ.
  const { results: daySessions } = await c.env.DB.prepare(
    `SELECT id FROM attendance_sessions WHERE user_id = ? AND date = ? ORDER BY clock_in ASC`,
  )
    .bind(targetId, date)
    .all<{ id: number }>();
  const existing = daySessions ?? [];
  if (existing.length > 1) {
    return c.json({ error: 'Тухайн өдөр олон бүртгэлтэй — нэг бүрчлэн засна уу' }, 409);
  }

  const settings = await getAttendanceSettings(c.env.DB);
  const nowMs = new Date(nowInUBIso()).getTime();
  // Тухайн өдөрт хүчинтэй байсан ээлж — ажилласан цаг ба хоцролт хоёуланд.
  const targetAssignments = await getScheduleAssignments(c.env.DB, target.id);
  const shift = shiftForUser(target.id, target.work_schedule, date, targetAssignments);

  const clockIn = `${date}T${inTime}:00+08:00`;
  if (new Date(clockIn).getTime() > nowMs) {
    return c.json({ error: 'Ирээдүйн цаг бүртгэх боломжгүй' }, 400);
  }

  let clockOut: string | null = null;
  let hours: number | null = null;
  if (outTime) {
    const outDate = body.next_day === true ? nextDayIso(date) : date;
    clockOut = `${outDate}T${outTime}:00+08:00`;
    const outMs = new Date(clockOut).getTime();
    if (outMs <= new Date(clockIn).getTime()) {
      return c.json({ error: 'Гарах цаг ирсэн цагаас хойш байх ёстой' }, 400);
    }
    if (outMs > nowMs) {
      return c.json({ error: 'Ирээдүйн цаг бүртгэх боломжгүй' }, 400);
    }
    hours = computeHours(clockIn, clockOut, {
      date,
      settings,
      shift: countingWindow(shift, target.role),
    });
  }

  // Хоцролт — энэ нь тухайн өдрийн ЦОРЫН ГАНЦ session тул re-entry биш:
  // ирсэн цаг vs бодит ээлж + grace (тухайн өдөрт хүчинтэй байсан ээлж).
  const lateMinutes = lateMinutesAgainstShift(
    ubMinutesOf(clockIn),
    shift,
    settings.lateGraceMinutes,
  );

  const editedAt = nowInUBIso();
  const detail = `${inTime}${outTime ? ` → ${outTime}${body.next_day ? ' (+1 өдөр)' : ''}` : ' → ?'}${note ? ` — ${note}` : ''}`;

  let sessionId: number;
  let action: 'session_create' | 'session_edit';
  if (existing.length === 0) {
    // Шинээр нөхнө.
    const result = await c.env.DB.prepare(
      `INSERT INTO attendance_sessions
         (user_id, clock_in, clock_out, hours_worked, ip_address, date, notes,
          late_minutes, created_by, edited_by, edited_at, edit_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        targetId,
        clockIn,
        clockOut,
        hours,
        'admin-manual',
        date,
        note,
        lateMinutes,
        user.sub,
        user.sub,
        editedAt,
        note,
      )
      .run();
    sessionId = Number(result.meta.last_row_id);
    action = 'session_create';
  } else {
    // Ганц session-ийг засна.  `created_by`-г хөндөхгүй (organic бичлэг хэвээр),
    // зөвхөн edited_* + цагуудыг шинэчилнэ.  note өгсөн үед `notes`/`edit_note`
    // шинэчлэгдэнэ, эс бөгөөс хуучин утга хэвээр.
    sessionId = existing[0]!.id;
    await c.env.DB.prepare(
      `UPDATE attendance_sessions
         SET clock_in = ?, clock_out = ?, hours_worked = ?, late_minutes = ?,
             non_project_credit_hours = 0,
             notes = COALESCE(?, notes), edited_by = ?, edited_at = ?,
             edit_note = COALESCE(?, edit_note)
       WHERE id = ?`,
    )
      .bind(clockIn, clockOut, hours, lateMinutes, note, user.sub, editedAt, note, sessionId)
      .run();
    action = 'session_edit';
  }
  await syncNonProjectCreditSafe(c.env.DB, targetId, date, settings);
  // Ирсэн цаг засагдвал богиносгосон чөлөө ч дагаж дахин тооцогдоно.
  await syncLeaveArrivalCutsSafe(c.env.DB, targetId, date, settings);

  if (targetId !== user.sub) {
    await createNotification(
      c.env.DB,
      targetId,
      'attendance_adjusted',
      action === 'session_create' ? 'Ирцийг админ нөхөж бүртгэлээ' : 'Ирцийг админ засварлалаа',
      `${date} — ${detail}`,
      '/app/attendance',
    );
  }
  await logAdminAction(c.env.DB, {
    actorId: user.sub,
    targetUserId: targetId,
    action,
    date,
    details: detail,
  });

  return c.json({
    message: action === 'session_create' ? 'Ирц нөхөгдлөө' : 'Ирц засагдлаа',
    session_id: sessionId,
    date,
    clock_in: clockIn,
    clock_out: clockOut,
    hours_worked: hours,
    late_minutes: lateMinutes,
  });
});

/**
 * Устгаж болох бүртгэл:
 *   - админ гараар нөхөж үүсгэсэн (created_by NOT NULL), ЭСВЭЛ
 *   - ӨМНӨХ өдрийн хаагаагүй (clock_out NULL) бичлэг — мартагдсан хог.
 * Өнөөдрийн хаагаагүй session ажилтан одоо ажиллаж байгааг илтгэх тул
 * устгахыг хориглоно; хаагдсан organic бүртгэл цалин/тайлангийн өгөгдөл
 * учраас мөн хамгаалагдсан хэвээр.
 */
function sessionDeletable(s: AttendanceSessionRow, today: string): boolean {
  return !!s.created_by || (s.clock_out == null && s.date < today);
}

// DELETE /api/attendance/sessions/:id — нөхсөн эсвэл хаагаагүй ирц устгах (admin)
attendance.delete('/sessions/:id', requireRole('admin', 'senior'), async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const session = await c.env.DB.prepare(`SELECT * FROM attendance_sessions WHERE id = ?`)
    .bind(id)
    .first<AttendanceSessionRow>();
  if (!session) return c.json({ error: 'Бүртгэл олдсонгүй' }, 404);
  if (!sessionDeletable(session, todayInUB())) {
    return c.json(
      { error: 'Зөвхөн админ нөхөж бүртгэсэн эсвэл өмнөх өдрийн хаагаагүй ирцийг устгаж болно' },
      409,
    );
  }

  await c.env.DB.prepare(`DELETE FROM attendance_sessions WHERE id = ?`).bind(id).run();
  await syncNonProjectCreditSafe(c.env.DB, session.user_id, session.date);
  // Ирц уствал тэр өдрийн богиносгосон чөлөө анхны хэмжээндээ буцна.
  await syncLeaveArrivalCutsSafe(c.env.DB, session.user_id, session.date);

  if (session.user_id !== user.sub) {
    await createNotification(
      c.env.DB,
      session.user_id,
      'attendance_adjusted',
      'Нөхөж бүртгэсэн ирцийг админ устгалаа',
      `${session.date} — ${extractClock(session.clock_in) ?? session.clock_in}`,
      '/app/attendance',
    );
  }
  await logAdminAction(c.env.DB, {
    actorId: user.sub,
    targetUserId: session.user_id,
    action: 'session_delete',
    date: session.date,
    details: `${extractClock(session.clock_in) ?? session.clock_in}${
      session.clock_out ? ` → ${extractClock(session.clock_out) ?? session.clock_out}` : ''
    }`,
  });

  return c.json({ message: 'Нөхсөн ирц устгагдлаа', session_id: id });
});

// POST /api/attendance/sessions/bulk-delete — олон бүртгэл зэрэг устгах (admin)
//
// Body: { ids: number[] } (дээд тал нь 100).  Мөр бүрд single-delete-тэй
// ЯГ ижил sessionDeletable шалгалт хийнэ — эрхгүй мөр алгасагдаж `skipped`-д
// тоологдоно, бусад нь устаад мөр бүр attendance_admin_logs-д бичигдэнэ.
// "Хаагдаагүй бүртгэлүүд" картын checkbox сонголтын ар тал.
attendance.post('/sessions/bulk-delete', requireRole('admin', 'senior'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ ids?: unknown }>().catch((): { ids?: unknown } => ({}));
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is number => Number.isInteger(v) && (v as number) > 0).slice(0, 100)
    : [];
  if (ids.length === 0) return c.json({ error: 'ids хоосон байна' }, 400);

  const today = todayInUB();
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM attendance_sessions WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<AttendanceSessionRow>();
  const found = results ?? [];
  const eligible = found.filter((s) => sessionDeletable(s, today));

  if (eligible.length > 0) {
    await c.env.DB.prepare(
      `DELETE FROM attendance_sessions WHERE id IN (${eligible.map(() => '?').join(',')})`,
    )
      .bind(...eligible.map((s) => s.id))
      .run();
    const days = new Map(eligible.map((s) => [`${s.user_id}|${s.date}`, s]));
    for (const s of days.values()) {
      await syncNonProjectCreditSafe(c.env.DB, s.user_id, s.date);
      await syncLeaveArrivalCutsSafe(c.env.DB, s.user_id, s.date);
    }

    for (const s of eligible) {
      if (s.user_id !== user.sub) {
        await createNotification(
          c.env.DB,
          s.user_id,
          'attendance_adjusted',
          'Хаагаагүй ирцийн бүртгэлийг админ устгалаа',
          `${s.date} — ${extractClock(s.clock_in) ?? s.clock_in}`,
          '/app/attendance',
        );
      }
      await logAdminAction(c.env.DB, {
        actorId: user.sub,
        targetUserId: s.user_id,
        action: 'session_delete',
        date: s.date,
        details: `${extractClock(s.clock_in) ?? s.clock_in}${
          s.clock_out ? ` → ${extractClock(s.clock_out) ?? s.clock_out}` : ' → (хаагаагүй)'
        }`,
      });
    }
  }

  return c.json({ deleted: eligible.length, skipped: ids.length - eligible.length });
});

// POST /api/attendance/sessions/bulk-clock-out — олон хаагдаагүй session-д нэг
// гарах цаг бичиж зэрэг хаах (admin).
//
// Body: { ids: number[] (≤100), time: 'HH:mm', next_day?: boolean, note?: string }.
// Мөр бүрд /sessions/:id/clock-out-той ИЖИЛ дүрэм: organic (ажилтны өөрөө
// хаасан) бүртгэл, ирсэн цагаас өмнөх эсвэл ирээдүйн цаг — алгасаж `skipped`-д
// тоологдоно.  `time` нь session тус бүрийн өдрийн (next_day үед маргаашийн) UB цаг.
attendance.post('/sessions/bulk-clock-out', requireRole('admin', 'senior'), async (c) => {
  const user = c.get('user');
  const body = await c.req
    .json<{ ids?: unknown; time?: string; next_day?: boolean; note?: string }>()
    .catch((): { ids?: unknown; time?: string; next_day?: boolean; note?: string } => ({}));

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is number => Number.isInteger(v) && (v as number) > 0).slice(0, 100)
    : [];
  if (ids.length === 0) return c.json({ error: 'ids хоосон байна' }, 400);

  const time = typeof body.time === 'string' ? body.time.trim() : '';
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
    return c.json({ error: 'Гарах цаг (HH:mm) шаардлагатай' }, 400);
  }
  const note =
    typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;
  const nextDay = body.next_day === true;

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM attendance_sessions WHERE id IN (${placeholders})`,
  )
    .bind(...ids)
    .all<AttendanceSessionRow>();
  const found = results ?? [];
  const settings = await getAttendanceSettings(c.env.DB);

  const nowMs = new Date(nowInUBIso()).getTime();
  let closed = 0;
  let skipped = 0;
  // Ажилтан × өдрийн ээлж — ижил хүний олон мөрд дахин уншихгүй.
  const shiftCache = new Map<string, Pick<Shift, 'startMinutes' | 'endMinutes'>>();

  for (const session of found) {
    // Organic (ажилтны өөрөө хаасан) бүртгэлийг дарж бичихгүй — single-тэй ижил guard.
    if (session.clock_out && !session.edited_by) {
      skipped++;
      continue;
    }
    const outDate = nextDay ? nextDayIso(session.date) : session.date;
    const clockOut = `${outDate}T${time}:00+08:00`;
    const outMs = new Date(clockOut).getTime();
    if (outMs <= new Date(session.clock_in).getTime() || outMs > nowMs) {
      skipped++;
      continue;
    }

    const shiftKey = `${session.user_id}|${session.date}`;
    let shift = shiftCache.get(shiftKey);
    if (!shift) {
      shift = await loadCountingWindow(c.env.DB, session.user_id, session.date);
      shiftCache.set(shiftKey, shift);
    }
    const hours = computeHours(session.clock_in, clockOut, { date: session.date, settings, shift });
    const prevPrefix = session.clock_out
      ? `[өмнөх: ${extractClock(session.clock_out) ?? session.clock_out}] `
      : '';
    const fullNote = `${prevPrefix}${note ?? ''}`.trim() || null;

    // CAS — single-тэй ижил: уншсанаас хойш ажилтан өөрөө гарсан / өөр админ зассан мөрийг алгасна.
    const bulkOut = await c.env.DB.prepare(
      `UPDATE attendance_sessions
       SET clock_out = ?, hours_worked = ?, non_project_credit_hours = 0,
           edited_by = ?, edited_at = ?, edit_note = ?
       WHERE id = ? AND clock_out IS ? AND edited_by IS ?`,
    )
      .bind(
        clockOut,
        hours,
        user.sub,
        nowInUBIso(),
        fullNote,
        session.id,
        session.clock_out ?? null,
        session.edited_by ?? null,
      )
      .run();
    if (!bulkOut.meta.changes) {
      skipped++;
      continue;
    }
    if (!session.clock_out && session.date === todayInUB()) {
      await stopTimerOnClockOut(c.env.DB, {
        userId: session.user_id,
        actorId: user.sub,
        clockOutIso: clockOut,
      }).catch((err: unknown) => console.error('[task-timer] stop on bulk clock-out failed', err));
    }
    await syncNonProjectCreditSafe(c.env.DB, session.user_id, session.date, settings);

    if (session.user_id !== user.sub) {
      await createNotification(
        c.env.DB,
        session.user_id,
        'attendance_adjusted',
        'Гарах цагийг админ нөхөж бүртгэлээ',
        `${session.date} — ${time}${note ? ` (${note})` : ''}`,
        '/app/attendance',
      );
    }
    await logAdminAction(c.env.DB, {
      actorId: user.sub,
      targetUserId: session.user_id,
      action: 'session_clock_out',
      date: session.date,
      details: `${time}${nextDay ? ' (+1 өдөр)' : ''}${note ? ` — ${note}` : ''} [bulk]`,
    });
    closed++;
  }

  return c.json({ closed, skipped });
});

// GET /api/attendance/admin-logs — ирц/чөлөөний админ үйлдлийн лог (admin)
//
// 0102-ийн append-only audit урсгал: ирц нөхөх/устгах, гарах цаг нөхөх,
// чөлөө шууд бүртгэх/зөвшөөрөх/татгалзах/цуцлах/устгах.  Сүүлийн нь
// эхэндээ; ?user_id= -ээр нэг ажилтных руу шүүж болно.
attendance.get('/admin-logs', requireRole('admin', 'senior'), async (c) => {
  const userIdQ = c.req.query('user_id');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10) || 100, 300);

  let sql = `
    SELECT l.*,
           act.full_name AS actor_name, act.profile_image AS actor_image,
           tgt.full_name AS target_name, tgt.profile_image AS target_image
    FROM attendance_admin_logs l
    JOIN users act ON act.id = l.actor_id
    LEFT JOIN users tgt ON tgt.id = l.target_user_id
  `;
  const binds: (string | number)[] = [];
  if (userIdQ) {
    sql += ` WHERE l.target_user_id = ?`;
    binds.push(parseInt(userIdQ, 10));
  }
  sql += ` ORDER BY l.id DESC LIMIT ?`;
  binds.push(limit);

  const { results } = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all();

  return c.json({ logs: results ?? [] });
});

// GET /api/attendance/stats — Aggregated statistics (admin)
attendance.get('/stats', requireRole('admin', 'senior'), async (c) => {
  const from = c.req.query('from') ?? getWeekStart(todayInUB());
  const to = c.req.query('to') ?? todayInUB();

  const { results: userStats } = await c.env.DB.prepare(
    `
    SELECT
      a.user_id,
      u.full_name,
      u.employee_id,
      u.profile_image,
      COUNT(DISTINCT a.date) AS days_present,
      ROUND(SUM(a.hours_worked), 2) AS total_hours,
      ROUND(AVG(a.hours_worked), 2) AS avg_hours,
      COALESCE(SUM(CASE WHEN ${LATE_NOT_WAIVED_SQL} THEN a.late_minutes ELSE 0 END), 0) AS late_minutes,
      MIN(a.clock_in) AS earliest_clock_in,
      MAX(a.clock_out) AS latest_clock_out
    FROM attendance_sessions a
    JOIN users u ON u.id = a.user_id
    WHERE a.date >= ? AND a.date <= ? AND a.clock_out IS NOT NULL
    GROUP BY a.user_id
    ORDER BY u.full_name
  `,
  )
    .bind(from, to)
    .all<{
      user_id: number;
      full_name: string;
      employee_id: string | null;
      profile_image: string | null;
      days_present: number;
      total_hours: number;
      avg_hours: number;
      late_minutes: number;
      earliest_clock_in: string;
      latest_clock_out: string | null;
    }>();

  const settings = await getAttendanceSettings(c.env.DB);

  // Хоцорсон минутаас торгуулийн дүнг тооцож хариунд оруулъя.
  const userStatsWithPenalty = (userStats ?? []).map((u) => ({
    ...u,
    late_penalty: (u.late_minutes ?? 0) * settings.latePenaltyPerMinute,
  }));

  const today = todayInUB();
  // Өнөөдөр нийтийн амралт бол хэн ч "ирээгүй" гэж тоологдохгүй — бүгд амарсан.
  const todayIsHoliday = await isHoliday(c.env.DB, today);
  // "Ирээгүй" = active staff that didn't clock in AND aren't on approved
  // leave today AND don't have approved out-of-office work today.  Skipping
  // these checks would keep paging managers about people the company has
  // already excused (гадуур ажилтай үед «Тас» биш — 2026-08-03).
  const { results: absent } = await c.env.DB.prepare(
    `
    SELECT u.id, u.full_name, u.employee_id, u.profile_image
    FROM users u
    WHERE ${attendanceRosterSql()}
      AND u.id NOT IN (
        SELECT user_id FROM attendance_sessions WHERE date = ?
      )
      AND u.id NOT IN (
        SELECT user_id FROM leave_requests
        WHERE status = 'approved'
          AND start_date <= ? AND end_date >= ?
      )
      AND u.id NOT IN (
        SELECT user_id FROM out_of_office_requests
        WHERE status = 'approved' AND work_date = ?
      )
    ORDER BY u.full_name
  `,
  )
    .bind(today, today, today, today)
    .all();

  // Surface today's approved-leave list as a separate bucket so the UI
  // can show "чөлөөтэй" alongside "ирээгүй" rather than blending them.
  const { results: onLeave } = await c.env.DB.prepare(
    `
    SELECT u.id, u.full_name, u.employee_id, u.profile_image,
           lr.id AS leave_id, lr.leave_type, lr.start_date, lr.end_date,
           lr.start_time, lr.end_time
    FROM leave_requests lr
    JOIN users u ON u.id = lr.user_id
    WHERE lr.status = 'approved'
      AND lr.start_date <= ? AND lr.end_date >= ?
      -- Өнөөдөр ирсэн тул чөлөө нь ирсэн цагаар богиноссон (0364) — «одоо
      -- чөлөөтэй» биш.  Нэг өдрийн мөр end_time-аараа доор хасагдана; энэ нь
      -- олон хоногийн (цаггүй) мөрийн төлөө.
      AND NOT EXISTS (
        SELECT 1 FROM leave_arrival_cuts c WHERE c.leave_id = lr.id AND c.date = ?
      )
    ORDER BY u.full_name
  `,
  )
    .bind(today, today, today)
    .all<{
      id: number;
      full_name: string;
      employee_id: string | null;
      profile_image: string | null;
      leave_id: number;
      leave_type: string;
      start_date: string;
      end_date: string;
      start_time: string | null;
      end_time: string | null;
    }>();

  // Цагийн (хагас өдрийн) чөлөөний цонх өнөөдөр дуусчихсан бол "одоо
  // чөлөөтэй" жагсаалтаас хасна — өглөөний 2 цагийн чөлөөтэй хүн ажилдаа
  // эргэж ирсний дараа өдөржингөө "чөлөөтэй" гэж харагдахаа болино.  Бүтэн
  // өдрийн чөлөө (end_time = NULL) болон хараахан болоогүй цагийн чөлөө
  // (цонх нь дуусаагүй) хэвээр харагдана.
  const nowHm = extractClock(nowInUBIso());
  const onLeaveNow = (onLeave ?? []).filter((l) => {
    if (nowHm && l.end_time && l.end_date === today) {
      return nowHm <= l.end_time;
    }
    return true;
  });

  // Хоцорсон бүртгэлийг хадгалсан `late_minutes` талбараар авна
  // (ажилтан бүрийн өөрийн цагийн хуваарьт тулгуурлан clock-in
  // үед тооцогдсон тул энд ямар нэг threshold хэрэггүй).
  const { results: lateToday } = await c.env.DB.prepare(
    `
    SELECT a.user_id, u.full_name, u.profile_image, a.clock_in,
           a.late_minutes
    FROM attendance_sessions a
    JOIN users u ON u.id = a.user_id
    WHERE a.date = ?
      AND a.late_minutes > 0
      AND ${LATE_NOT_WAIVED_SQL}
    ORDER BY a.late_minutes DESC, a.clock_in
  `,
  )
    .bind(today)
    .all<{
      user_id: number;
      full_name: string;
      profile_image: string | null;
      clock_in: string;
      late_minutes: number;
    }>();

  // Тэр өдрийн нийт хоцролт + торгууль (UI badge-д хэрэглэгдэнэ).
  const lateTodayWithPenalty = (lateToday ?? []).map((r) => ({
    ...r,
    late_penalty: r.late_minutes * settings.latePenaltyPerMinute,
  }));
  const lateTotals = lateTodayWithPenalty.reduce(
    (acc, r) => ({
      minutes: acc.minutes + r.late_minutes,
      penalty: acc.penalty + r.late_penalty,
    }),
    { minutes: 0, penalty: 0 },
  );

  return c.json({
    period: { from, to },
    today,
    user_stats: userStatsWithPenalty,
    absent_today: todayIsHoliday ? [] : absent,
    on_leave_today: onLeaveNow,
    late_today: lateTodayWithPenalty,
    late_totals_today: lateTotals,
    late_penalty_per_minute: settings.latePenaltyPerMinute,
    late_grace_minutes: settings.lateGraceMinutes,
  });
});

export type RosterUser = {
  user_id: number;
  full_name: string;
  employee_id: string | null;
  profile_image: string | null;
  position: string | null;
  /** ⚠️ ТҮҮХЭН fallback багана.  Тухайн өдрийн бодит ээлжийг
   *  `user_work_schedules`-ийн мөр дарж болно — `buildDailyAttendanceRows`
   *  доторх `scheduleMap`-ыг үз. */
  work_schedule: ScheduleKey | null;
  /** `worker` бол ажилласан цаг ээлжийн цонхоор хязгаарлагдахгүй
   *  (`lib/shiftBoundedHours.ts` `countingWindow`).  Хоёр roster SELECT өгнө. */
  role?: string | null;
  team_code: string | null;
  team_name: string | null;
  /** `teams.sort_order` — компанийн ӨӨРИЙН багийн дараалал (БА, БҮ, ХАС…).
   *  `/daily-grid` үүнийг сонгож өгдөг тул «Тайлан» табын багийн шүүлтийн
   *  chip-үүд «Хаагдаагүй» табтай ЯГ ижил дарааллаар эрэмбэлэгдэнэ.
   *  `/summary` сонгодоггүй тул СОНГОЛТТОЙ (`?`) — байхгүй үед frontend тал
   *  кодоор нь эрэмбэлж, зөвхөн дараалал нь өөр болно (шүүлт нь ажиллана). */
  team_sort?: number | null;
};

/**
 * Нэг roster + [from,to] мужид per (ажилтан, өдөр) ирцийн мөрүүдийг тооцоолно.
 * `/daily-grid` БА `/summary` ХОЁУЛАА үүгээр дамжина — "цаг бодолт" (credited /
 * worked_effective / хоцролт) хоёр таб дээр ЯГ ижил гарахыг баталгаажуулна.
 * Зөвхөн Дав–Баа өдрүүд (амралтын өдөр хасагдана).
 */
export async function buildDailyAttendanceRows(
  db: D1Database,
  from: string,
  to: string,
  roster: RosterUser[],
) {
  const userIds = roster.map((u) => u.user_id);
  // Ээлжийн хуваарилалтын түүх — roster бүхэлдээ НЭГ query-гээр (миграци 0199).
  const scheduleMap = await getScheduleAssignmentsFor(db, userIds);
  const userPlaceholders = userIds.map(() => '?').join(',');

  // Aggregate per (user_id, date) so multiple clock-in/out cycles in one
  // day still produce a single row: earliest `clock_in`, latest `clock_out`,
  // summed `hours_worked`, max RAW `late_minutes` (waiver JS-д тооцогдоно).
  const { results: sessionRows } = await db
    .prepare(
      `
    SELECT user_id, date,
           MIN(clock_in)              AS clock_in,
           MAX(clock_out)             AS clock_out,
           COALESCE(SUM(hours_worked), 0) AS hours_worked,
           COALESCE(SUM(non_project_credit_hours), 0) AS non_project_credit_hours,
           COALESCE(MAX(late_minutes), 0) AS late_minutes,
           SUM(CASE WHEN clock_out IS NULL THEN 1 ELSE 0 END) AS open_sessions,
           COUNT(*) AS session_count
    FROM attendance_sessions a
    WHERE date >= ? AND date <= ?
      AND user_id IN (${userPlaceholders})
    GROUP BY user_id, date
  `,
    )
    .bind(from, to, ...userIds)
    .all<{
      user_id: number;
      date: string;
      clock_in: string;
      clock_out: string | null;
      hours_worked: number | null;
      /** `hours_worked`-д аль хэдийн орсон төслийн бус ажлын цаг (0352). */
      non_project_credit_hours: number | null;
      late_minutes: number | null;
      open_sessions: number;
      session_count: number;
    }>();

  // 2026-10-01-ээс (`lib/shiftBoundedHours.ts`) өдрийн ажилласан минутыг
  // ХААГДСАН session-уудын ИНТЕРВАЛААС дахин бодно, хадгалсан `hours_worked`-ийг
  // уншихгүй: дүрэм солигдохоос өмнө (deploy-оос өмнө) хаагдсан session хуучин
  // дүрмээр бичигдсэн байж болно, давхар бүртгэлийн ихэр нэгдлээр нэг л удаа
  // тоологдоно.  Түүнээс өмнөх өдрийн мөрөнд энэ query огт явахгүй.
  const spansByKey = new Map<string, DaySpan[]>();
  const boundedFrom = isShiftBounded(from) ? from : SHIFT_BOUNDED_FROM;
  if (to >= boundedFrom) {
    const { results: spanRows } = await db
      .prepare(
        `
    SELECT user_id, date, clock_in, clock_out
    FROM attendance_sessions
    WHERE date >= ? AND date <= ? AND clock_out IS NOT NULL
      AND user_id IN (${userPlaceholders})
  `,
      )
      .bind(boundedFrom, to, ...userIds)
      .all<{ user_id: number; date: string; clock_in: string; clock_out: string }>();
    for (const r of spanRows ?? []) {
      const key = `${r.user_id}|${r.date}`;
      const list = spansByKey.get(key) ?? [];
      list.push(daySpanOf(r.clock_in, r.clock_out, r.date));
      spansByKey.set(key, list);
    }
  }

  // `arrival_orig_*` (0364) — ирсэн цагаар богиносгосон чөлөөний АНХНЫ утга.
  // Олон хоногийн мөрийн `hours` нь богиносголтын дараах НИЙТ тул ирээгүй
  // өдрүүдийн минутыг анхны утгаас бодно; богиносгосон өдөр нь
  // `leave_arrival_cuts.used_minutes`-ээр (`lib/leaveArrivalCut.ts`).
  const { results: leaveRows } = await db
    .prepare(
      `
    SELECT id, user_id, leave_type, start_date, end_date, start_time, reason, hours,
           arrival_orig_hours, arrival_orig_days, is_paid
    FROM leave_requests
    WHERE status = 'approved'
      AND start_date <= ? AND end_date >= ?
      AND user_id IN (${userPlaceholders})
  `,
    )
    .bind(to, from, ...userIds)
    .all<{
      id: number;
      user_id: number;
      leave_type: 'annual' | 'sick' | 'unpaid' | 'remote' | 'other';
      start_date: string;
      end_date: string;
      start_time: string | null;
      reason: string | null;
      hours: number | null;
      arrival_orig_hours: number | null;
      arrival_orig_days: number | null;
      is_paid: number | null;
    }>();
  const { results: leaveCutRows } = await db
    .prepare(
      `
    SELECT leave_id, date, used_minutes
    FROM leave_arrival_cuts
    WHERE date >= ? AND date <= ?
      AND user_id IN (${userPlaceholders})
  `,
    )
    .bind(from, to, ...userIds)
    .all<{ leave_id: number; date: string; used_minutes: number }>();
  const leaveCutMinutes = new Map<string, number>();
  for (const cut of leaveCutRows ?? []) {
    leaveCutMinutes.set(`${cut.leave_id}|${cut.date}`, cut.used_minutes);
  }

  // Гадуур ажлыг мөр мөрөөр нь (цагийн мужтай нь) авна — хоцролтын waiver-т
  // өглөөний хоцролтын завсартай давхцлыг тооцоход start/end цаг хэрэгтэй.
  const { results: oooRows } = await db
    .prepare(
      `
    SELECT user_id, work_date, COALESCE(hours, 0) AS hours, start_time, end_time
    FROM out_of_office_requests
    WHERE status = 'approved'
      AND work_date >= ? AND work_date <= ?
      AND user_id IN (${userPlaceholders})
  `,
    )
    .bind(from, to, ...userIds)
    .all<{
      user_id: number;
      work_date: string;
      hours: number;
      start_time: string | null;
      end_time: string | null;
    }>();

  const sessionMap = new Map<string, (typeof sessionRows)[number]>();
  for (const s of sessionRows ?? []) sessionMap.set(`${s.user_id}|${s.date}`, s);

  const leaveByUser = new Map<number, Array<(typeof leaveRows)[number]>>();
  for (const lv of leaveRows ?? []) {
    const list = leaveByUser.get(lv.user_id) ?? [];
    list.push(lv);
    leaveByUser.set(lv.user_id, list);
  }

  const oooMap = new Map<string, number>();
  const oooEntriesByKey = new Map<
    string,
    Array<{ start_time: string | null; end_time: string | null }>
  >();
  for (const o of oooRows ?? []) {
    const key = `${o.user_id}|${o.work_date}`;
    oooMap.set(key, (oooMap.get(key) ?? 0) + (o.hours ?? 0));
    const list = oooEntriesByKey.get(key) ?? [];
    list.push({ start_time: o.start_time, end_time: o.end_time });
    oooEntriesByKey.set(key, list);
  }

  // Mon–Fri only — Бямба/Ням өдөр цагийн хүснэгтэд МӨР ҮҮСГЭХГҮЙ.
  //
  // ⚠️ Эзний шийдвэр 2026-10-01: амралтын өдөр (Бя/Ня) ямар ч байдлаар — оффис
  //    дээр ч, гадуур ажил / зохиогчийн хяналтаар ч — ажилласан цагт ТООЦОГДОХГҮЙ;
  //    тэр өдөр юу ч хийгээгүй мэт бодно (Батзориг А. 2026-09: 22 ажлын өдөр = 176 ц).
  //    2026-07-30-аас өмнө энд хэрэглэгч Бя/Нямд бодит ирц / гадуур ажилтай бол
  //    «нөхөж ажилласан» нэмэлт мөр үүсгэж цагийг нь тоолдог байсан (git log:
  //    `weekendActivityByUser`).  Ирцийн бичлэг, гадуур ажлын хүсэлт өөрөө DB-д
  //    хэвээр — зөвхөн энэ хүснэгт/хураангуй/XLSX-д харагдаж, тоологдохгүй.
  //    Нийтийн БАЯРЫН өдөр хэвээр: мөр байна, ажилласан бол бодит цагаараа тоологдоно.
  const dates: string[] = [];
  const fromDate = new Date(from + 'T00:00:00Z');
  const toDate = new Date(to + 'T00:00:00Z');
  for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10));
  }

  const today = todayInUB();
  const settings = await getAttendanceSettings(db);
  const lunchWindow = lunchWindowOf(settings);
  const holidaySet = await getHolidaySet(db, from, to);

  const rows = roster.flatMap((u) => {
    const userLeaves = leaveByUser.get(u.user_id) ?? [];

    return dates.map((date) => {
      // Зуны үед (6–8 сар) бодит ээлж нь өдрөөс хамаарч `early` болно.
      // ⚠️ Шошго/төлөвлөсөн цагийг ХАТУУ БИЧСЭН ternary-аар БИШ, `shiftForUser`-ээс
      //    гаргана: 3 дахь ээлж (`mid` 08:30–17:30) + user 69-ийн тогтмол 09:30–18:30.
      const scheduleKey = effectiveSchedule(u.work_schedule, date, scheduleMap.get(u.user_id));
      const shiftOfDay = shiftForUser(u.user_id, u.work_schedule, date, scheduleMap.get(u.user_id));
      const scheduleLabel = shortShiftLabel(shiftOfDay);
      const plannedIn = hhmmOfMinutes(shiftOfDay.startMinutes);
      const plannedOut = hhmmOfMinutes(shiftOfDay.endMinutes);
      const isRestDay = isWeekendYmd(date);
      const isHolidayDay = holidaySet.has(date);
      const session = sessionMap.get(`${u.user_id}|${date}`) ?? null;
      // Амралтын (Бя/Ня) БОЛОН нийтийн баярын өдөр чөлөө тооцохгүй — баяр нь
      // ээлжийн амралтыг ДАРНА (жишээ: наадмын 07-10..07-15 нь ээлжийн
      // амралтын хоногт тооцогдохгүй, тайланд «баярын өдөр» гэж гарна).
      // Ирсэн цагаар 0 болтол богиносгосон чөлөө (ээлжийн эхэнд ирсэн) тэр
      // өдөр чөлөө БИШ — энгийн ажлын өдөр (0364, эзний шийдвэр).
      // ⚠️ Өдрийн БҮХ чөлөөг нэгтгэнэ (`lib/dayLeaves.ts`) — 2026-10-01 хүртэл
      //    `find` нь ЭХНИЙ чөлөөг л авч, 08:30–12:00 + 12:00–17:30 гэсэн хоёр
      //    чөлөөтэй өдрийн хоёр дахийг огт тоолдоггүй байв.
      const dayLeaves = combineDayLeaves({
        leaves:
          isRestDay || isHolidayDay
            ? []
            : userLeaves.filter((lv) => lv.start_date <= date && lv.end_date >= date),
        date,
        shiftStartMinutes: shiftOfDay.startMinutes,
        cutMinutes: (leaveId, d) => leaveCutMinutes.get(`${leaveId}|${d}`),
        dayCapMinutes: EXPECTED_DAY_MINUTES,
      });
      const leave = dayLeaves.primary;
      const oooHours = oooMap.get(`${u.user_id}|${date}`) ?? 0;
      const oooMinutes = Math.round(oooHours * 60);
      const oooEntries = oooEntriesByKey.get(`${u.user_id}|${date}`) ?? [];
      const leaveMinutes = dayLeaves.minutes;

      const actualIn = session?.clock_in ? extractClock(session.clock_in) : null;
      // ⚠️ Тухайн өдөр БҮРЭН хаагдсан эсэх — «гарах бүртгэлтэй юу» гэдгийг
      //    ЗӨВХӨН эндээс шалгана.  Дээрх SQL нь `COALESCE(SUM(hours_worked), 0)`
      //    хийдэг тул session мөр байгаа л бол `hours_worked` ХЭЗЭЭ Ч null
      //    байдаггүй (SUM(NULL) → NULL → COALESCE → 0).  Тиймээс хуучин
      //    `session?.hours_worked != null` шалгуур нь «дууссан өдөр» биш зүгээр
      //    «session мөр байна уу» гэдгийг л шалгаж, тарах товч дараагүй хүнд ч
      //    доорх `creditedMinutes` бүтэн 8ц (480 − хоцролт) олгодог байв
      //    (продакшнд 2026-04-20..08-25 хооронд 490 ийм мөр ≈ 3,900 хийсвэр цаг).
      //    Мартсан clock-out нь ШИЙТГЭЛ биш УРАМШУУЛАЛ болж байсан гэсэн үг.
      //    Одоо хаагдаагүй өдөр `null` (= «тооцоогүй») болж, тайланд «—» гарна.
      const isDayClosed = !!session && (session.open_sessions ?? 0) === 0;
      const actualOut =
        session && isDayClosed && session.clock_out ? extractClock(session.clock_out) : null;
      // 2026-10-01-ээс ажилласан минут = ЭЭЛЖИЙН ЦОНХ доторх хугацаа (session-уудын
      // нэгдэл ∩ ээлж − цай) + оффисоос гадуурх төслийн бус ажил (sync нь мөн
      // ээлжийн цонхоор хязгаарладаг).  07:40–16:40, 08:00–17:00 ээлж → 7ц40м.
      const shiftBounded = isShiftBounded(date);
      const workMinutes =
        session && isDayClosed
          ? shiftBounded
            ? shiftBoundedMinutes(
                spansByKey.get(`${u.user_id}|${date}`) ?? [],
                countingWindow(shiftOfDay, u.role),
                lunchWindow,
              ) + Math.round((session.non_project_credit_hours ?? 0) * 60)
            : Math.round((session.hours_worked ?? 0) * 60)
          : null;

      const isOnLeave = !!leave;
      // Чөлөөт өдөр = баярын ЭСВЭЛ амралтын (Бя/Ня) өдөр: хүлээгдэх цаг 0,
      // «Тас» тэмдэглэгдэхгүй, ажилласан бол бүх минут нь тоологдоно.
      const isFreeDay = isHolidayDay || isRestDay;
      // Батлагдсан гадуур ажилтай өдөр «Тас» биш (2026-08-03) — ирц бүртгүүлээгүй
      // ч албан ажлаар гадуур байсан нь баталгаажсан.
      const isAbsent = !session && !isOnLeave && !isFreeDay && oooMinutes <= 0 && date <= today;

      // Хоцролт: ЧӨЛӨӨТЭЙ өдөр — чөлөөний минутыг хасч ҮЛДЭХ хоцролтыг тооцно.
      // Энгийн өдөр — түүхий хоцролт.  Амралтын өдөр (нөхөлт) — clock-in дээр
      // ээлжийн төлөвлөсөн цагтай харьцуулж бодогдсон хоцролт ХЭВЭЭР тайланд
      // гарна (2026-07-30-ны хүсэлт).
      // Тогтмол ээлж (user 69): snapshot `late_minutes` нь өмнөх 08:00/09:00
      // ээлжээр бичигдсэн байж болно — тайлангийн кредит 09:30-тай харьцуулна.
      const rawLate =
        hasFixedShift(u.user_id) && session?.clock_in
          ? lateMinutesAgainstShift(
              ubMinutesOf(session.clock_in),
              shiftOfDay,
              settings.lateGraceMinutes,
            )
          : (session?.late_minutes ?? 0);
      // Цайны цонхтой давхцсан хоцролтыг тооцохгүй (2026-07-30-ны хүсэлт):
      // хүлээгдэх ирэх цаг (чөлөөтэй бол чөлөөний минутаар хойшилно) → бодит
      // ирсэн цагийн завсрын [lunchStart, lunchEnd]-тэй давхцлыг хасна.
      // Жишээ: чөлөө 11:00 хүртэл, 12:47-д ирсэн бол 12:00–12:47 нь цайны цаг
      // тул хоцролт 107 биш 60 минут.
      //
      // Гадуур ажил мөн адил зөвхөн ӨГЛӨӨНИЙ хоцролтын завсартай [effStart,
      // arrive] давхцсан хэсгээрээ л хоцролтыг цуцална (2026-08-03-ны хүсэлт:
      // үдээс хойшхи гадуур ажил өглөөний хоцролтыг цуцлахгүй).  Цаг заагаагүй
      // (start/end хоосон) хүсэлт хуучин журмаараа бүтэн цуцална — хэзээ гадуур
      // байсан нь тодорхойгүй тул эргэлзээг ажилтны талд шийднэ.
      //
      // ⚠️ Цонхнуудыг НЭГТГЭЖ (union) хасна, тус тусад нь НЭМЖ хасахгүй.  Урьд нь
      //    цайны цонх ба гадуур ажлын цонх бие даан тооцогдоод хоёулаа хасагддаг
      //    байсан тул ДАВХЦСАН минут хоёр удаа цуцлагддаг байв (жишээ: 08:00
      //    ээлж, цай 12:00–13:00, гадуур ажил 09:00–13:00, ирсэн 13:30 →
      //    хуучнаар хоцролт 30, зөв нь 90).  Мөн нэг өдөрт давхардсан хоёр
      //    гадуур ажлын хүсэлт ижил завсрыг хоёр удаа цуцалдаг байсан —
      //    `out-of-office.ts`-д давхардлын шалгуур байхгүй тул энэ бодитой.
      //
      // ⚠️ 2026-09-29: өдрийн анхны гадуур ажил ирэхээс ӨМНӨ эхэлсэн бол
      //    ээлжийн эхлэлээс тэр хүртэлх зай (гэрээсээ шууд явсан зам) хоцролт
      //    биш — дээрх жишээ одоо 30.  Дүрэм бүхэлдээ `lib/lateWaiver.ts`-д.
      // Чөлөө ДУУСАХ ханын цаг: чөлөөний минут цай хассан (`lib/leaveHours.ts`) тул
      // ээлжийн эхлэл дээр цайг АЛГАСАЖ нэмнэ — 09:00–14:30 чөлөө (270 мин) 14:30-д
      // дуусна, 13:30-д биш; эс бөгөөс 14:30-д ирсэн хүн 30 мин хоцорсон болно.
      const leaveWallMinutes = isOnLeave
        ? addLeaveWorkMinutes(shiftOfDay.startMinutes, leaveMinutes, lunchWindow) -
          shiftOfDay.startMinutes
        : 0;
      const { waiverMinutes, blanket: oooBlanketWaiver } = lateWaiver({
        rawLate,
        actualIn,
        effStartMin: shiftOfDay.startMinutes + leaveWallMinutes,
        lunch: settings.lunchEnabled ? { start: settings.lunchStart, end: settings.lunchEnd } : null,
        ooo: oooEntries,
      });
      const lateMin = oooBlanketWaiver
        ? 0
        : Math.max(0, (isOnLeave ? rawLate - leaveWallMinutes : rawLate) - waiverMinutes);
      const expectedMinutes = isOnLeave || isFreeDay ? 0 : EXPECTED_DAY_MINUTES;
      const expectedAfterLate = Math.max(0, expectedMinutes - lateMin);
      // Чөлөөтэй өдөр: чөлөө + кредит ≤ 8ц.  Чөлөөт өдөр — бодит цагаар (сайн дур).
      const leaveCap = Math.max(0, EXPECTED_DAY_MINUTES - leaveMinutes - lateMin);
      // 2026-10-01-ээс (эзний шийдвэр, `lib/shiftBoundedHours.ts`): кредит =
      // ээлжийн цонх доторх ажилласан минут, дээд тал нь 8ц − хоцролт (чөлөөтэй
      // өдөр 8ц − чөлөө − хоцролт).  ЭРТ ГАРВАЛ БАГАСНА: 07:20 ирээд 16:57-д
      // гарсан (08:00–17:00) → 7ц57м.  Хоцролт аль хэдийн ирсэн цагаас тоологдсон
      // тул `min` — давхар хасагдахгүй.
      // Түүнээс өмнөх өдөр — 2026-08-03-ны бодлого («135.23 гаргах бодолтоор
      // явъя»): ГАРСАН өдөрт кредит нь гарсан цагаас ХАМААРАХГҮЙ (энгийн өдөр =
      // 8ц − хоцролт, чөлөөтэй өдөр = 8ц − чөлөө − хоцролт).
      // Баярын өдрийн ажил бодит цагаараа (10-01-ээс мөн ээлжийн цонх дотор).
      const dayCap = isOnLeave ? leaveCap : expectedAfterLate;
      const creditedMinutes =
        workMinutes != null
          ? isFreeDay
            ? workMinutes
            : shiftBounded
              ? Math.min(workMinutes, dayCap)
              : dayCap
          : isOnLeave || isAbsent
            ? 0
            : null;
      // Илүү цагийн хүсэлт хасагдсаны дараа «нийт» нь тооцсон минуттай ижил.
      // Өмнө нь `creditedMinutes + overtimeMinutes` байсан ба тооцоо хийгдээгүй
      // (null) өдөрт илүү цаг ганцаараа утга үүсгэдэг нөөц салаа байсан — тэр
      // салаа одоо утгагүй тул null хэвээр үлдэнэ (migration 0171).
      const totalMinutes = creditedMinutes;
      const latePenalty = lateMin * settings.latePenaltyPerMinute;
      // "Ажилласан цаг" = бодит ажилласан + ЦАЛИНТАЙ чөлөө (unpaid болон ЭЭЛЖИЙН
      // АМРАЛТААС бусад) + гадуур ажил, өдөрт 8ц-аар таглана.  Ээлжийн амралт
      // "ажилласан цаг" БИШ — тусдаа annual_leave_minutes талбараар гарна.
      // Амралтын (Бя/Ня) өдрийн нөхөлт ч мөн 8ц-аар таглагдана (2026-07-30-ны
      // хүсэлт).  8ц-аас илүү гарсан цагийг тоолох механизм БАЙХГҮЙ — илүү
      // цагийн хүсэлт 2026-08-10-нд системээс бүрэн хасагдсан (migration 0171).
      // Олон чөлөөтэй өдөрт төрөл бүрийн минутыг тусад нь (`lib/dayLeaves.ts`).
      const annualLeaveMinutes = dayLeaves.annualMinutes;
      const paidLeaveMinutes = dayLeaves.paidMinutes;
      // Таг нь БҮХ өдөрт (8ц − хоцролт) — гадуур ажил, цалинтай чөлөө тагийг
      // нөхөж хоцролтыг "залгихгүй", мөн амралтын/баярын өдрийн нөхөлтийн
      // хоцролт ч нийт цагаас хасагдана (2026-08-03-ны хүсэлт: «хоцролтын
      // минут нийт ажилласан цагаас ЗААВАЛ хасагдана» — жигд дүрэм).
      // Credited энгийн өдөрт аль хэдийн 8ц−late-аар таглагддаг тул давхар
      // хасалт үүсэхгүй; чөлөөт өдөрт leave=null тул paidLeave=0.
      const workedEffectiveMinutes = Math.min(
        (creditedMinutes ?? 0) + paidLeaveMinutes + oooMinutes,
        Math.max(0, EXPECTED_DAY_MINUTES - lateMin),
      );

      return {
        user_id: u.user_id,
        full_name: u.full_name,
        employee_id: u.employee_id,
        profile_image: u.profile_image,
        position: u.position,
        team_code: u.team_code,
        team_name: u.team_name,
        team_sort: u.team_sort ?? null,
        date,
        schedule_key: scheduleKey,
        schedule_label: scheduleLabel,
        planned_in: plannedIn,
        planned_out: plannedOut,
        actual_in: actualIn,
        actual_out: actualOut,
        session_count: session?.session_count ?? 0,
        late_minutes: lateMin,
        late_penalty: latePenalty,
        work_minutes: workMinutes,
        // `work_minutes`-ийн дотор, оффисоос гадуур хийсэн төслийн бус ажлын
        // хэсэг (0352) — «15:00-д гарсан атлаа 8 цаг» гэдгийг тайлбарлана.
        non_project_credit_minutes:
          session && isDayClosed ? Math.round((session.non_project_credit_hours ?? 0) * 60) : 0,
        expected_minutes: expectedMinutes,
        credited_minutes: creditedMinutes,
        worked_effective_minutes: workedEffectiveMinutes,
        total_minutes: totalMinutes,
        is_on_leave: isOnLeave,
        leave_type: leave?.leave_type ?? null,
        leave_reason: leave?.reason ?? null,
        leave_minutes: leaveMinutes,
        annual_leave_minutes: annualLeaveMinutes,
        // Өдрийн чөлөө бүр (цонх, төрөл, минут) — нэгээс олон байвал UI бүгдийг харуулна.
        leave_parts: dayLeaves.parts,
        is_absent: isAbsent,
        is_holiday: isHolidayDay,
        is_rest_day: isRestDay,
        out_of_office_minutes: oooMinutes,
      };
    });
  });

  return {
    rows,
    dates,
    workingDays: dates.filter((d) => !holidaySet.has(d)).length,
    settings,
  };
}

// GET /api/attendance/daily-grid — XLSX-style daily roster (admin)
//
// Бүх идэвхтэй ажилтны "ажлын өдөр х нэг ажилтан" гэсэн хэлбэрээр
// ирэх / тарах / хоцролт / чөлөө / тас / илүү цаг / ажлын цагийг нэг
// мөрөнд буцаана.  Approve хийгдсэн чөлөө/илүү цаг автоматаар тухайн
// өдрийн нүднүүдэд нөлөөлнө.
// Admin/senior бүгдийг хардаг; бусад ажилтан өөрийн мөрийг л хардаг тул
// requireRole-гүй — доор inline self-scope хийнэ (баг/бусдын ирц харагдахгүй).
attendance.get('/daily-grid', async (c) => {
  const viewer = c.get('user');
  const isPriv = isAdminRole(viewer.role) || viewer.role === 'senior';
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) {
    return c.json({ error: 'from / to (yyyy-mm-dd) шаардлагатай' }, 400);
  }
  // Эрхгүй ажилтанд team_id-г үл тоомсорлож, user_id-г өөрийнх рүү албадна.
  // `?mine=1` дамжуулбал эрхтэй (admin/senior) хэрэглэгчийг ч өөрийнх рүү
  // хязгаарлана — "Миний өдрийн ирц" карт бүх ажилтныг гоожуулахгүйн тулд.
  const forceSelf = c.req.query('mine') === '1';
  const teamId = isPriv && !forceSelf ? c.req.query('team_id') : undefined;
  const userIdQ = isPriv && !forceSelf ? c.req.query('user_id') : String(viewer.sub);

  let rosterSql = `
    SELECT u.id AS user_id, u.full_name, u.employee_id, u.profile_image,
           u.position, u.work_schedule, u.role,
           pt.code AS team_code, pt.name_mn AS team_name,
           pt.sort_order AS team_sort
    FROM users u
    LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
    LEFT JOIN teams pt ON pt.id = ut_p.team_id
    WHERE ${attendanceRosterSql()}
  `;
  const rosterBinds: (string | number)[] = [];
  if (teamId) {
    rosterSql += ` AND u.id IN (SELECT user_id FROM user_teams WHERE team_id = ?)`;
    rosterBinds.push(parseInt(teamId, 10));
  }
  if (userIdQ) {
    rosterSql += ` AND u.id = ?`;
    rosterBinds.push(parseInt(userIdQ, 10));
  }
  rosterSql += ` ORDER BY u.full_name`;

  const { results: roster } = await c.env.DB.prepare(rosterSql)
    .bind(...rosterBinds)
    .all<{
      user_id: number;
      full_name: string;
      employee_id: string | null;
      profile_image: string | null;
      position: string | null;
      work_schedule: ScheduleKey | null;
      team_code: string | null;
      team_name: string | null;
      team_sort: number | null;
    }>();

  if (!roster || roster.length === 0) {
    return c.json({ period: { from, to, working_days: 0 }, rows: [] });
  }

  const { rows, workingDays, settings } = await buildDailyAttendanceRows(
    c.env.DB,
    from,
    to,
    roster,
  );

  return c.json({
    period: { from, to, working_days: workingDays },
    rows,
    settings: {
      late_grace_minutes: settings.lateGraceMinutes,
      late_penalty_per_minute: settings.latePenaltyPerMinute,
      expected_day_minutes: EXPECTED_DAY_MINUTES,
    },
  });
});

// GET /api/attendance/summary — One row per employee for a date range.
//
// Reuses the same grace + credited formulas as `/daily-grid` so reports
// reconcile cell-for-cell.  Aggregation must happen at day-level first
// because `min(work_minutes, expected − late)` doesn't distribute over
// SUM (you can stay late one day and not "make up" for being late on
// another).
attendance.get('/summary', requireRole('admin', 'senior'), async (c) => {
  const today = todayInUB();
  const from = c.req.query('from') ?? daysAgoUB(today, 29);
  const to = c.req.query('to') ?? today;
  const teamId = c.req.query('team_id');
  const userIdQ = c.req.query('user_id');

  let rosterSql = `
    SELECT u.id AS user_id, u.full_name, u.employee_id, u.profile_image,
           u.position, u.work_schedule, u.role,
           pt.code AS team_code, pt.name_mn AS team_name
    FROM users u
    LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
    LEFT JOIN teams pt ON pt.id = ut_p.team_id
    WHERE ${attendanceRosterSql()}
  `;
  const rosterBinds: (string | number)[] = [];
  if (teamId) {
    rosterSql += ` AND u.id IN (SELECT user_id FROM user_teams WHERE team_id = ?)`;
    rosterBinds.push(parseInt(teamId, 10));
  }
  if (userIdQ) {
    rosterSql += ` AND u.id = ?`;
    rosterBinds.push(parseInt(userIdQ, 10));
  }
  rosterSql += ` ORDER BY u.full_name`;

  const { results: roster } = await c.env.DB.prepare(rosterSql)
    .bind(...rosterBinds)
    .all<{
      user_id: number;
      full_name: string;
      employee_id: string | null;
      profile_image: string | null;
      position: string | null;
      work_schedule: ScheduleKey | null;
      team_code: string | null;
      team_name: string | null;
    }>();

  const settings = await getAttendanceSettings(c.env.DB);

  if (!roster || roster.length === 0) {
    return c.json({
      period: { from, to, working_days: 0 },
      rows: [],
      totals: emptySummaryTotals(),
      settings: {
        late_grace_minutes: settings.lateGraceMinutes,
        late_penalty_per_minute: settings.latePenaltyPerMinute,
      },
    });
  }

  const { rows: dailyRows, workingDays } = await buildDailyAttendanceRows(
    c.env.DB,
    from,
    to,
    roster,
  );

  // Ажилтан бүрийн өдрийн мөрүүдийг нэгтгэнэ — /daily-grid-тэй ЯГ ижил цаг
  // бодолт (credited / worked_effective / хоцролт) баталгаажна.
  const rowsByUser = new Map<number, (typeof dailyRows)[number][]>();
  for (const r of dailyRows) {
    const list = rowsByUser.get(r.user_id) ?? [];
    list.push(r);
    rowsByUser.set(r.user_id, list);
  }

  const rows = roster.map((u) => {
    const userRows = rowsByUser.get(u.user_id) ?? [];
    // ⚠️ `userRows` нь Бя/Ня (нөхөж ажилласан) нэмэлт мөртэй тул мөр тоолж
    //    «ирсэн өдөр» гаргахгүй — `expected_days`-тэй ижил суурьтай (ажиллах
    //    ёстой өдөр) тоолно; амралтаар ажилласан өдөр `extra_days`-д тусдаа.
    const { present_days, extra_days } = countAttendanceDays(userRows);
    let late_minutes = 0;
    let credited_minutes = 0;
    let worked_effective_minutes = 0;
    let out_of_office_minutes = 0;
    let leave_minutes = 0; // ээлжийн бус чөлөө (annual тусдаа тоологдоно)
    let annual_leave_minutes = 0; // ээлжийн амралт — "ажилласан цаг"-аас ТУСДАА
    const annualDates: string[] = [];
    for (const r of userRows) {
      late_minutes += r.late_minutes;
      credited_minutes += r.credited_minutes ?? 0;
      worked_effective_minutes += r.worked_effective_minutes;
      out_of_office_minutes += r.out_of_office_minutes;
      annual_leave_minutes += r.annual_leave_minutes ?? 0;
      // Нэг өдөр ээлжийн амралт + өөр чөлөө байж болох тул төрлөөр нь задлана
      // (ганц чөлөөтэй өдөрт хуучин `leave_type === 'annual'` салаатай ижил).
      if (r.leave_parts.some((p) => p.leave_type === 'annual')) annualDates.push(r.date);
      if (r.is_on_leave) leave_minutes += r.leave_minutes - (r.annual_leave_minutes ?? 0);
    }
    return {
      user_id: u.user_id,
      full_name: u.full_name,
      employee_id: u.employee_id,
      profile_image: u.profile_image,
      position: u.position,
      team_code: u.team_code,
      team_name: u.team_name,
      expected_days: workingDays,
      expected_minutes: workingDays * EXPECTED_DAY_MINUTES,
      present_days,
      extra_days,
      late_minutes,
      late_penalty: late_minutes * settings.latePenaltyPerMinute,
      credited_minutes,
      worked_effective_minutes,
      leave_minutes,
      annual_leave_days: annualDates.length,
      annual_leave_dates: annualDates.sort(),
      annual_leave_minutes,
      out_of_office_minutes,
      // Нийт = өдөр бүр 8ц-аар таглагдсан "ажилласан цаг".  Задаргааны
      // багануудын шууд нийлбэр БИШ — нэг өдөрт ажилласан + гадуур ажил 8ц
      // давбал өдрийн таглалт үйлчилдэг тул тэр нийлбэр «Ажилласан цаг»-аас
      // их гарч зөрдөг байсан.  (Илүү цагийн нэмэгдэл 0171-д хасагдсан.)
      total_minutes: worked_effective_minutes,
    };
  });

  const totals = rows.reduce(
    (t, r) => ({
      expected_days: t.expected_days + r.expected_days,
      expected_minutes: t.expected_minutes + r.expected_minutes,
      present_days: t.present_days + r.present_days,
      extra_days: t.extra_days + r.extra_days,
      late_minutes: t.late_minutes + r.late_minutes,
      late_penalty: t.late_penalty + r.late_penalty,
      credited_minutes: t.credited_minutes + r.credited_minutes,
      worked_effective_minutes: t.worked_effective_minutes + r.worked_effective_minutes,
      leave_minutes: t.leave_minutes + r.leave_minutes,
      annual_leave_days: t.annual_leave_days + r.annual_leave_days,
      annual_leave_minutes: t.annual_leave_minutes + r.annual_leave_minutes,
      out_of_office_minutes: t.out_of_office_minutes + r.out_of_office_minutes,
      total_minutes: t.total_minutes + r.total_minutes,
    }),
    emptySummaryTotals(),
  );

  return c.json({
    period: { from, to, working_days: workingDays },
    rows,
    totals,
    settings: {
      late_grace_minutes: settings.lateGraceMinutes,
      late_penalty_per_minute: settings.latePenaltyPerMinute,
    },
  });
});

// GET /api/attendance/report — Daily breakdown for a date range (admin)
attendance.get('/report', requireRole('admin', 'senior'), async (c) => {
  const from = c.req.query('from') ?? getWeekStart(todayInUB());
  const to = c.req.query('to') ?? todayInUB();

  const { results } = await c.env.DB.prepare(
    `
    SELECT
      a.date,
      COUNT(DISTINCT a.user_id) AS employees_present,
      ROUND(AVG(a.hours_worked), 2) AS avg_hours,
      ROUND(SUM(a.hours_worked), 2) AS total_hours
    FROM attendance_sessions a
    WHERE a.date >= ? AND a.date <= ? AND a.clock_out IS NOT NULL
    GROUP BY a.date
    ORDER BY a.date
  `,
  )
    .bind(from, to)
    .all();

  return c.json({ period: { from, to }, daily: results });
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Extract `HH:mm` from an ISO timestamp produced by `nowInUBIso` (already
 *  in UB +08:00). Falls back to null if the format isn't recognised. */
function extractClock(iso: string): string | null {
  const m = iso.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function emptySummaryTotals() {
  return {
    expected_days: 0,
    expected_minutes: 0,
    present_days: 0,
    extra_days: 0,
    late_minutes: 0,
    late_penalty: 0,
    credited_minutes: 0,
    worked_effective_minutes: 0,
    leave_minutes: 0,
    annual_leave_days: 0,
    annual_leave_minutes: 0,
    out_of_office_minutes: 0,
    total_minutes: 0,
  };
}


/** Тухайн `yyyy-mm-dd` огноо Бямба/Ням мөн үү.  UTC аргаар тооцдог тул
 *  Worker-ийн runtime timezone-оос хамаарахгүй. */
function isWeekendYmd(date: string): boolean {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return dow === 0 || dow === 6;
}

/** [start, end] (хоёул багтсан) мужид багтах Дав–Баа ажлын өдрүүдийг
 *  `yyyy-mm-dd` хэлбэрээр өсөхөөр буцаана.  Амралтын өдрийг (Бя/Ня) алгасна. */
function weekdayDatesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  const from = new Date(start + 'T00:00:00Z');
  const to = new Date(end + 'T00:00:00Z');
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Дараагийн өдрийн ISO огноо.  UTC аргуудаар тооцдог тул Worker-ийн
 *  runtime timezone (production = UTC)-оос үл хамааран зөв ажиллана. */
function nextDayIso(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** N хоногийн өмнөх UB огноог `yyyy-mm-dd` хэлбэрээр. */
function daysAgoUB(today: string, n: number): string {
  const d = new Date(today + 'T00:00:00+08:00');
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = start of week
  d.setDate(d.getDate() - diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default attendance;
