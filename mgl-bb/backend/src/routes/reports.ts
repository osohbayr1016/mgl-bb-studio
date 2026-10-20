import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import { STANDARD_WORK_DAY_HOURS, type Env, type AppVariables } from '../types';
import { todayInUB } from '../lib/time';
import { withEdgeCache } from '../lib/edgeCache';
import { getCeoOnLeaderboard, isLeaderboardEligibleUser } from '../lib/ceo';
import { LATE_NOT_WAIVED_SQL } from '../lib/leaveWaiver';
import { isWeekend } from '../lib/workSchedule';
import { getHolidaySet } from '../lib/holidays';
import {
  type ReportWindow,
  type ResolvedWindow,
  type DateRange,
  isReportWindow,
  isIsoDate,
  resolveWindow,
  isoAddDays,
  daysBetween,
  listDates,
  orgUtcOffsetMinutes,
  ubDayBoundsUtc,
  sqliteOffsetModifier,
  pickAllTimeFrom,
} from '../lib/reportWindows';
import { classifyTrend, rankWithTies, rankDelta, pctDelta, type TrendResult } from '../lib/reportTrend';
import { snapshotDay, SNAPSHOT_KEY, type SnapshotRow } from '../lib/employeeSnapshot';
import { streamPrivateObject } from '../lib/privateFileStream';
import { parseSchema, EMPTY_SCHEMA, type AssessmentAnswers } from '../lib/assessmentSchema';
import { scoreAssessment } from '../lib/assessmentScore';
import { DriveApiError, DriveNotConfigured, driveShare, driveUpload, isScopeError } from '../lib/google/driveClient';
import { hoursProgressSql } from '../lib/repairProgress';
import nonProjectWorkReview from './nonProjectWorkReview';
import managementLogs from './managementLogs';
import { loadLeaveNeutral, workingDates } from '../lib/leaveAvailability';
import { loadDailyAverages } from '../lib/dailyAverage';

/* ============================================================
 * /api/reports — «Тайлан»: админд зориулсан ажилтан/багийн гүйцэтгэлийн
 * тайлан + HR карт.  БҮХ зам `requireAdmin()` — CEO (id 2) admin тул нэмэлт
 * хаалт хэрэггүй.  `lib/workerScope.ts` / `lib/clientScope.ts` цагаан
 * жагсаалтад ЭНЭ угтвар байхгүй тул worker/client-д өгөгдмөлөөр хаалттай.
 *
 * Тоо бодох зарчим:
 *   • Цонхны нийлбэр (оноо, бичлэг, ирц) ҮРГЭЛЖ LIVE — `user_points`,
 *     `progress_entries`, `attendance_sessions`-оос.  `recalculateProjectPoints`
 *     ledger-ийг дахин бичсэн ч тайлан шинэ утгыг харуулна.
 *   • БАЙР (rank) нь харьцангуй → «7 хоногийн өмнөх байр» нь
 *     `employee_daily_snapshots`-оос (lib/employeeSnapshot.ts).  Snapshot
 *     байхгүй өдөрт LIVE fallback ([anchor−36, anchor−7] мужийн байр) — deploy
 *     хийсний дараах эхний өдрөөс ажиллана.
 *   • `user_points.awarded_at` UTC, бусад `date` багана УБ — хөрвүүлэлт
 *     `lib/reportWindows.ts`-д ГАНЦ газарт.  ⚠️ leaderboard.ts өдрийн bucket-ыг
 *     UTC `DATE(awarded_at)`-аар авдаг тул оройн оноо тэнд өөр өдөрт унаж
 *     болно — зориуд засаагүй (өөр хуудас, өөр гэрээ).
 *
 * Route-ийн дараалал ачаалал үүрнэ: `/overview`, `/teams`, `/snapshots/*`
 * нь `/employees/:id`-ээс ДЭЭР.
 * ============================================================ */

const reports = new Hono<{ Bindings: Env; Variables: AppVariables }>();
reports.use('*', requireAdmin());
// «Төслийн бус ажлын тайлан» таб — шалгах/батлах (0343/0344).  Тусдаа файл:
// ажилтны `/api/non-project-work` нь admin-д хаалттай, энэ нь зөвхөн admin.
reports.route('/non-project-work', nonProjectWorkReview);
// «Менежментийн багийн тайлан» таб — өдрийн ажлын тайлангийн (0345) багийн
// нэгтгэл; зөвхөн CEO + admin (2026-10-07).
reports.route('/management-logs', managementLogs);

/* ------------------------------------------------------------------ */
/*  Түгээмэл                                                           */
/* ------------------------------------------------------------------ */

const WINDOW_DEFAULT: ReportWindow = '7d';
/** Цуваа (series) хамгийн ихдээ хэдэн өдөр — `all` цонхонд ч энэ хязгаар. */
const SERIES_MAX_DAYS = 90;
/** Байрын тооцоонд хэрэглэх өдрийн тоо — leaderboard.ts-ийн 30 хоногтой ижил. */
const RANK_DAYS = 30;
/**
 * Sparkline (хүснэгтийн «N хоног» багана) — сонгосон цонхыг ДАГАНА: 7d → 7
 * цэг, 14d → 14, сар → тэр сарын өдрүүд.  Хоёр цонх өөрийн уртаараа зурагдахгүй:
 * `day` (нэг цэгт хэлбэр байхгүй) → сүүлийн 7 хоног, `all` → сүүлийн 30
 * хоног (bucket-ийн хязгаар).  Хандлага (`trend`) нь ҮРГЭЛЖ 14 хоногийн
 * цуваанаас — `classifyTrend`-ийн 7 vs 7 тодорхойлолт цонхноос хамаарахгүй.
 */
const SPARK_DAY_FALLBACK = 7;
const SPARK_ALL_DAYS = RANK_DAYS;
const TREND_DAYS = 14;
const CONTRACT_MAX_BYTES = 20 * 1024 * 1024;
const CONTRACT_TYPES = ['permanent', 'fixed_term', 'probation', 'contractor', 'other'] as const;

function round1(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 10) / 10;
}

/**
 * ОНОО (user_points.amount) — 4 орны нарийвчлал.  Хэмжсэн (прод, 2026-09-16):
 * нэг тайлангийн оноо дунджаар 0.03, багахан жинтэй таск дээр 0.0002 хүртэл;
 * ажилтны 7 хоногийн нийлбэрийн медиан ~0.1.  `round1` нь энэ бүхнийг «0»
 * болгож, өдрийн нэмэгдлийг хэзээ ч харуулахгүй байсан (эзний гомдол).
 * Цаг, чөлөө, хувь гэх мэт бусад тоо `round1` хэвээр.
 */
function roundPts(n: number | null | undefined): number {
  return Math.round((n ?? 0) * 10000) / 10000;
}

function parseId(raw: string | undefined): number | null {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type WindowParams = { window: ReportWindow; anchor: string; resolved: ResolvedWindow };

/** `?window=&anchor=` → муж; буруу утга null (дуудагч 400 буцаана). */
function readWindow(query: (k: string) => string | undefined): WindowParams | null {
  const w = query('window') ?? WINDOW_DEFAULT;
  if (!isReportWindow(w)) return null;
  const a = query('anchor') ?? todayInUB();
  if (!isIsoDate(a)) return null;
  return { window: w, anchor: a, resolved: resolveWindow(w, a) };
}

/** Sparkline-ийн муж — дээрх тайлбарыг үз. */
function sparkRange(wp: WindowParams): DateRange {
  const { anchor, resolved } = wp;
  if (resolved.window === 'day') return { from: isoAddDays(anchor, -(SPARK_DAY_FALLBACK - 1)), to: anchor };
  if (resolved.window === 'all') return { from: isoAddDays(anchor, -(SPARK_ALL_DAYS - 1)), to: anchor };
  return { from: resolved.current.from, to: resolved.current.to };
}

function sumRange(daily: Map<string, number> | undefined, r: DateRange): number {
  if (!daily) return 0;
  let s = 0;
  for (const [d, v] of daily) if (d >= r.from && d <= r.to) s += v;
  return s;
}

/** [from, to] мужийн ажлын өдрийн тоо (Бямба/Ням + holidays хасагдсан) — lib/leaveAvailability.ts-ийн тодорхойлолт. */
async function expectedWorkDays(db: D1Database, r: DateRange): Promise<number> {
  return workingDates(r, await getHolidaySet(db, r.from, r.to)).length;
}

/* ------------------------------------------------------------------ */
/*  Мөр угсрагч — overview / teams / employee detail бүгд үүнийг хэрэглэнэ  */
/* ------------------------------------------------------------------ */

interface StaffRow {
  id: number;
  username: string;
  full_name: string;
  role: string;
  status: string;
  profile_image: string | null;
  position: string | null;
  employee_id: string | null;
  seniority: string | null;
  is_support: number;
  created_at: string;
  team_id: number | null;
  team_code: string | null;
  team_name: string | null;
}

const STAFF_SQL = `
  SELECT u.id, u.username, u.full_name, u.role, u.status, u.profile_image,
         u.position, u.employee_id, u.seniority, u.is_support, u.created_at,
         pt.id AS team_id, pt.code AS team_code, pt.name_mn AS team_name
    FROM users u
    LEFT JOIN user_teams ut ON ut.user_id = u.id AND ut.is_primary = 1
    LEFT JOIN teams pt ON pt.id = ut.team_id
   WHERE u.role NOT IN ('client', 'worker')`;

export interface EmployeeMetrics {
  /** Цонхны НИЙТ оноо — төслийн тайлан + засвар (`user_points` бүх source). */
  points: number;
  /** Үүний засварын хэсэг (`user_points.source = 'repair'`) — Projects хуудсанд байхгүй
   *  «Засварын төсөл» болон бодит төсөл дээрх засварын бүртгэл хоёулаа. */
  repair_points: number;
  entries_count: number;
  tasks_touched: number;
  tasks_completed: number;
  /** Засварын бүртгэлийн тоо — `entries_count` нь зөвхөн `progress_entries` тул тусад нь. */
  repair_entries: number;
  repair_hours: number;
  /**
   * Батлагдсан тайлан боловч ОНОО АВААГҮЙ — блок/зураг/таскийн жин 0 эсвэл
   * багийн хувь 0 тул Δтөслийн% = 0 (хэмжсэн 2026-09-16: төсөл 39, 55).  Админ
   * «яагаад 0 вэ?» гэдгийг харах ёстой; засах нь төслийн тохиргоо.
   */
  unweighted_entries: number;
  present_days: number;
  expected_days: number | null;
  hours_worked: number;
  late_minutes: number;
  leave_hours: number;
  /** Цонхонд алгассан батлагдсан чөлөөт ажлын өдөр (`all` цонхонд 0). */
  leave_days: number;
  /** Хуанлийн цонхонд бодитоор олгогдсон оноо — `points` нь чөлөөт өдрийг
   *  өмнөх ажлын өдрүүдээр нөхсөн (lib/leaveAvailability.ts). */
  points_actual: number;
  /** Өдрийн дундаж — сүүлийн 21 АЖИЛЛАСАН өдрийн (lib/dailyAverage.ts): шинэ
   *  ажилтан орсноос хойшхи өдрөөрөө, батлагдсан чөлөө алгасагдана. */
  daily_avg_30d: number;
}

export interface EmployeeReportRow {
  user_id: number;
  full_name: string;
  username: string;
  employee_id: string | null;
  position: string | null;
  seniority: string | null;
  profile_image: string | null;
  role: string;
  status: string;
  team_id: number | null;
  team_code: string | null;
  team_name: string | null;
  is_leaderboard_member: boolean;
  points: number;
  points_prev: number | null;
  points_delta_pct: number | null;
  rank_now: number | null;
  pool_size: number | null;
  rank_7d_ago: number | null;
  rank_delta: number | null;
  rank_7d_source: 'snapshot' | 'live' | null;
  trend: TrendResult;
  /** Өдрийн оноо, `sparkline` мужид (хуучнаас шинэ рүү) — урт нь цонхоос хамаарна. */
  spark: number[];
  entries_count: number;
  tasks_touched: number;
  tasks_completed: number;
  repair_points: number;
  repair_entries: number;
  repair_hours: number;
  unweighted_entries: number;
  present_days: number;
  hours_worked: number;
  late_minutes: number;
  leave_hours: number;
  /**
   * Батлагдсан чөлөө (2026-09-24, lib/leaveAvailability.ts): `points`,
   * `points_prev`, `repair_points`, байр, хандлага нь хүний АЖИЛЛАСАН өдрөөр —
   * цонхны чөлөөт ажлын өдрийг алгасаж өмнөх ажлын өдрүүдээр нөхнө, тиймээс
   * чөлөө хувийг өсгөхгүй, бууруулахгүй.  `leave_days` = алгассан өдөр
   * (`all` цонхонд 0 — нийт түүх залруулгагүй), `points_actual` = хуанлийн
   * цонхонд бодитоор олгогдсон.  sparkline нь бодит өдрүүд хэвээр.
   */
  leave_days: number;
  points_actual: number;
}

interface BuildResult {
  rows: EmployeeReportRow[];
  /** user_id → өдөр → оноо (bucket мужид) — detail-ийн цуваанд дахин ашиглана. */
  dailyPoints: Map<number, Map<string, number>>;
  /** Үүний засварын хэсэг (source = 'repair'), ижил түлхүүрээр. */
  dailyRepair: Map<number, Map<string, number>>;
  bucketRange: DateRange;
  sparkRange: DateRange;
  expected_days: number | null;
  pool_size: number;
  /** Өмнөх цонхны чөлөөний мэдээлэл (дэлгэрэнгүйн prev_metrics-д). */
  prevLeave: Map<number, { repair_points: number; leave_days: number; points_actual: number }>;
  /** Хандлагын залруулга хүн бүрд — багийн хандлагад нийлүүлнэ. */
  trendAdjust: Map<number, { prior7: number; last7: number }>;
}

interface AggRow {
  user_id: number;
  present_days: number;
  hours: number;
  late: number;
}
interface ProgRow {
  user_id: number;
  entries: number;
  tasks: number;
  completed: number;
}

async function attendanceAgg(db: D1Database, r: DateRange): Promise<Map<number, AggRow>> {
  const { results } = await db
    .prepare(
      `SELECT a.user_id,
              COUNT(DISTINCT a.date) AS present_days,
              COALESCE(SUM(a.hours_worked), 0) AS hours,
              COALESCE(SUM(CASE WHEN ${LATE_NOT_WAIVED_SQL} THEN a.late_minutes ELSE 0 END), 0) AS late
         FROM attendance_sessions a
        WHERE a.date >= ? AND a.date <= ? AND a.clock_out IS NOT NULL
        GROUP BY a.user_id`,
    )
    .bind(r.from, r.to)
    .all<AggRow>();
  return new Map((results ?? []).map((x) => [x.user_id, x]));
}

async function progressAgg(db: D1Database, r: DateRange): Promise<Map<number, ProgRow>> {
  const { results } = await db
    .prepare(
      `SELECT user_id, COUNT(*) AS entries, COUNT(DISTINCT task_id) AS tasks,
              SUM(CASE WHEN percentage >= 100 THEN 1 ELSE 0 END) AS completed
         FROM progress_entries
        WHERE date >= ? AND date <= ? AND status = 'approved' AND COALESCE(source, '') <> 'alloc_adj'
        GROUP BY user_id`,
    )
    .bind(r.from, r.to)
    .all<ProgRow>();
  return new Map((results ?? []).map((x) => [x.user_id, x]));
}

interface RepairRow {
  user_id: number;
  hours: number;
  entries: number;
}

async function repairAgg(db: D1Database, r: DateRange): Promise<Map<number, RepairRow>> {
  const { results } = await db
    .prepare(
      `SELECT user_id, COALESCE(SUM(hours), 0) AS hours, COUNT(*) AS entries FROM repair_entries
        WHERE date >= ? AND date <= ? GROUP BY user_id`,
    )
    .bind(r.from, r.to)
    .all<RepairRow>();
  return new Map((results ?? []).map((x) => [x.user_id, x]));
}

/**
 * Жин 0 гинжин дээрх батлагдсан тайлан — `awardPointsForEntry` нь Δтөслийн% ≤ 0
 * бол `user_points` мөр бичдэггүй тул эдгээр нь чимээгүй алга болдог.  Нөхцөл нь
 * rollup-ийн математиктай ижил: блок/зураг/таскийн жин ≤ 0, эсвэл тухайн блокийн
 * багт `project_team_shares` мөргүй/0.  Амралт, «маргааш», baseline мөр тоологдохгүй.
 */
async function unweightedAgg(db: D1Database, r: DateRange): Promise<Map<number, number>> {
  const { results } = await db
    .prepare(
      `SELECT pe.user_id, COUNT(*) AS n
         FROM progress_entries pe
         JOIN tasks t      ON t.id = pe.task_id
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         JOIN blocks b     ON b.id = d.block_id
         LEFT JOIN project_team_shares s ON s.project_id = b.project_id AND s.team_id = b.team_id
        WHERE pe.date >= ? AND pe.date <= ? AND pe.status = 'approved'
          AND pe.is_rest_day = 0 AND pe.defer_next_day = 0 AND pe.is_baseline = 0
          AND COALESCE(pe.source, '') <> 'alloc_adj'
          AND (b.weight_percent <= 0 OR d.weight_percent <= 0 OR t.weight_percent <= 0
               OR COALESCE(s.share_percent, 0) <= 0)
        GROUP BY pe.user_id`,
    )
    .bind(r.from, r.to)
    .all<{ user_id: number; n: number }>();
  return new Map((results ?? []).map((x) => [x.user_id, x.n ?? 0]));
}

/**
 * Батлагдсан чөлөө — мужид ТАСЛАСАН ЦАГИЙН нийлбэр (эзний хүсэлт 2026-09-16:
 * өдрөөр биш цагаар).  `leave_requests.hours` нь хүсэлтийн НИЙТ цаг (0029/0051),
 * хуучин мөрөнд NULL бол `days × 8` — `routes/leaves.ts`-ийн нэгтгэлтэй ижил
 * fallback.  Олон өдрийн чөлөө мужаас хальсан бол өдөрт тэнцүү хувааж таслана.
 */
async function leaveAgg(db: D1Database, r: DateRange): Promise<Map<number, number>> {
  // Ирсэн цагаар богиносгосон чөлөө (0364): анхны утгаар өдөрт хувааж,
  // мужид орсон богиносгосон өдрүүдийн хэмнэсэн минутыг хасна.  Нэг өдрийн
  // мөрт `анхны − (full − used)` = `used` — мөрийн үр дүнгийн hours-тай тэнцүү.
  const [{ results }, { results: cutRows }] = await Promise.all([
    db
      .prepare(
        `SELECT id, user_id, start_date, end_date, days, hours, arrival_orig_hours, arrival_orig_days
           FROM leave_requests
          WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`,
      )
      .bind(r.to, r.from)
      .all<{
        id: number;
        user_id: number;
        start_date: string;
        end_date: string;
        days: number;
        hours: number | null;
        arrival_orig_hours: number | null;
        arrival_orig_days: number | null;
      }>(),
    db
      .prepare(
        `SELECT leave_id, SUM(full_minutes - used_minutes) AS saved
           FROM leave_arrival_cuts WHERE date >= ? AND date <= ? GROUP BY leave_id`,
      )
      .bind(r.from, r.to)
      .all<{ leave_id: number; saved: number }>(),
  ]);
  const savedByLeave = new Map((cutRows ?? []).map((c) => [c.leave_id, c.saved ?? 0]));
  const out = new Map<number, number>();
  for (const l of results ?? []) {
    const span = Math.max(1, daysBetween(l.start_date, l.end_date));
    const from = l.start_date > r.from ? l.start_date : r.from;
    const to = l.end_date < r.to ? l.end_date : r.to;
    const clipped = Math.min(span, Math.max(0, daysBetween(from, to)));
    const wasCut = l.arrival_orig_days != null;
    const baseHours = wasCut ? l.arrival_orig_hours : l.hours;
    const baseDays = wasCut ? (l.arrival_orig_days as number) : l.days;
    const totalHours = baseHours ?? (baseDays ?? span) * STANDARD_WORK_DAY_HOURS;
    const hours = Math.max(0, (totalHours * clipped) / span - (savedByLeave.get(l.id) ?? 0) / 60);
    out.set(l.user_id, (out.get(l.user_id) ?? 0) + hours);
  }
  return out;
}

/**
 * Бүх ажилтны тайлангийн мөрийг угсарна.  ~7 D1 дуудлага, бүгд индексжсэн
 * мужийн scan (`user_points(awarded_at)`, `progress_entries(user_id,date)`,
 * `attendance_sessions(date)`).
 */
async function buildRows(
  db: D1Database,
  wp: WindowParams,
  opts: { includeInactive?: boolean } = {},
): Promise<BuildResult> {
  const { anchor, resolved } = wp;
  const cur = resolved.current;
  const prev = resolved.previous;
  const includeCeo = await getCeoOnLeaderboard(db);
  const offset = orgUtcOffsetMinutes(new Date(`${anchor}T12:00:00Z`));

  // Bucket муж: 14 өдрийн хандлага + байрын 30 хоног + 7 хоногийн өмнөх байрын
  // 30 хоног (anchor−36) + өмнөх цонх (сарын цонхонд ~62 өдөр) — аль урт нь.
  // Sparkline-ийн муж (цонх, эсвэл 7/30 хоног) энэ дотор ҮРГЭЛЖ багтана.
  let bucketFrom = isoAddDays(anchor, -36);
  if (prev && prev.from < bucketFrom) bucketFrom = prev.from;
  if (resolved.window !== 'all' && cur.from < bucketFrom) bucketFrom = cur.from;
  const bucketRange: DateRange = { from: bucketFrom, to: anchor };
  const bounds = ubDayBoundsUtc(bucketFrom, anchor, offset);

  // Оноог `source`-оор ХОЁР баганаар авна: `pts` = нийт (Бүтээмж), `repair_pts` =
  // үүний засварын хэсэг (source = 'repair').  Засварын төслийн оноо Бүтээмжид
  // үргэлж орж байсан, зөвхөн ил харагддаггүй байсан — одоо тусад нь буцаана.
  // Чөлөөнөөс хамааралгүй цонхнууд — дараалал нь доорх `i*` индекс.
  const rankRange: DateRange = { from: isoAddDays(anchor, -(RANK_DAYS - 1)), to: anchor };
  const rank7Range: DateRange = { from: isoAddDays(anchor, -(RANK_DAYS + 6)), to: isoAddDays(anchor, -7) };
  const last7Range: DateRange = { from: isoAddDays(anchor, -6), to: anchor };
  const prior7Range: DateRange = { from: isoAddDays(anchor, -(TREND_DAYS - 1)), to: isoAddDays(anchor, -7) };
  const neutralRanges: DateRange[] = [rankRange, rank7Range, last7Range, prior7Range];
  const [iRank, iRank7, iLast7, iPrior7] = [0, 1, 2, 3];
  const iCur = resolved.window === 'all' ? -1 : neutralRanges.push(cur) - 1;
  const iPrev = prev ? neutralRanges.push(prev) - 1 : -1;

  const [staffRes, bucketRes, allRes, snapRes, attMap, progMap, repairMap, leaveMap, expected, unweightedMap, neutral] =
    await Promise.all([
      db
        .prepare(`${STAFF_SQL}${opts.includeInactive ? '' : " AND u.status = 'active'"} ORDER BY u.full_name`)
        .all<StaffRow>(),
      db
        .prepare(
          `SELECT user_id, date(awarded_at, ?) AS day, SUM(amount) AS pts,
                  SUM(CASE WHEN source = 'repair' THEN amount ELSE 0 END) AS repair_pts
             FROM user_points
            WHERE awarded_at >= ? AND awarded_at < ?
            GROUP BY user_id, day`,
        )
        .bind(sqliteOffsetModifier(offset), bounds.startUtc, bounds.endUtcExclusive)
        .all<{ user_id: number; day: string; pts: number; repair_pts: number }>(),
      // `all` цонх — bucket-аас гадуурх бүх оноо.
      resolved.window === 'all'
        ? db
            .prepare(
              `SELECT user_id, SUM(amount) AS pts,
                      SUM(CASE WHEN source = 'repair' THEN amount ELSE 0 END) AS repair_pts
                 FROM user_points WHERE awarded_at < ? GROUP BY user_id`,
            )
            .bind(bounds.startUtc)
            .all<{ user_id: number; pts: number; repair_pts: number }>()
        : Promise.resolve({ results: [] as { user_id: number; pts: number; repair_pts: number }[] }),
      db
        .prepare(`SELECT user_id, rank_30d, pool_size FROM employee_daily_snapshots WHERE date = ?`)
        .bind(isoAddDays(anchor, -7))
        .all<{ user_id: number; rank_30d: number | null; pool_size: number | null }>(),
      attendanceAgg(db, cur),
      progressAgg(db, cur),
      repairAgg(db, cur),
      leaveAgg(db, cur),
      resolved.window === 'all' ? Promise.resolve<number | null>(null) : expectedWorkDays(db, cur),
      unweightedAgg(db, cur),
      loadLeaveNeutral(db, {
        ranges: neutralRanges,
        sums: { pts: 'amount', repair: "CASE WHEN source = 'repair' THEN amount ELSE 0 END" },
      }),
    ]);
  const nd = (userId: number, i: number, key: 'pts' | 'repair' = 'pts') => (i < 0 ? 0 : neutral.delta(userId, i, key));

  const staff = staffRes.results ?? [];
  const dailyPoints = new Map<number, Map<string, number>>();
  const dailyRepair = new Map<number, Map<string, number>>();
  for (const b of bucketRes.results ?? []) {
    const m = dailyPoints.get(b.user_id) ?? new Map<string, number>();
    m.set(b.day, (m.get(b.day) ?? 0) + (b.pts ?? 0));
    dailyPoints.set(b.user_id, m);
    const rm = dailyRepair.get(b.user_id) ?? new Map<string, number>();
    rm.set(b.day, (rm.get(b.day) ?? 0) + (b.repair_pts ?? 0));
    dailyRepair.set(b.user_id, rm);
  }
  const beforeBucket = new Map<number, number>();
  const beforeBucketRepair = new Map<number, number>();
  for (const r of allRes.results ?? []) {
    beforeBucket.set(r.user_id, r.pts ?? 0);
    beforeBucketRepair.set(r.user_id, r.repair_pts ?? 0);
  }

  const snap7 = new Map<number, { rank: number | null; pool: number | null }>();
  for (const s of snapRes.results ?? []) snap7.set(s.user_id, { rank: s.rank_30d, pool: s.pool_size });
  const haveSnapshot = snap7.size > 0;

  // Байр — самбарын гишүүдийн дунд, anchor-оор дуусах 30 хоног.
  const members = staff.filter(
    (u) => u.status === 'active' && u.is_support === 0 && isLeaderboardEligibleUser(u.role, u.id, includeCeo),
  );
  const rankNow = rankWithTies(members, (u) => sumRange(dailyPoints.get(u.id), rankRange) + nd(u.id, iRank));
  // LIVE fallback — snapshot байхгүй бол 7 хоногийн өмнөх 30 хоногийн байр.
  const rankLive7 = haveSnapshot
    ? null
    : rankWithTies(members, (u) => sumRange(dailyPoints.get(u.id), rank7Range) + nd(u.id, iRank7));
  const pool = members.length;

  const trendRange: DateRange = { from: isoAddDays(anchor, -(TREND_DAYS - 1)), to: anchor };
  const spark = sparkRange(wp);
  const sparkDates = listDates(spark.from, spark.to);
  const trendDates = listDates(trendRange.from, trendRange.to);
  const prevLeave: BuildResult['prevLeave'] = new Map();
  const trendAdjust: BuildResult['trendAdjust'] = new Map();
  const rows: EmployeeReportRow[] = staff.map((u) => {
    const daily = dailyPoints.get(u.id);
    const pointsActual =
      resolved.window === 'all'
        ? (beforeBucket.get(u.id) ?? 0) + sumRange(daily, bucketRange)
        : sumRange(daily, cur);
    const points = pointsActual + nd(u.id, iCur);
    const pointsPrev = prev ? sumRange(daily, prev) + nd(u.id, iPrev) : null;
    const dailyRep = dailyRepair.get(u.id);
    const repairPoints =
      resolved.window === 'all'
        ? (beforeBucketRepair.get(u.id) ?? 0) + sumRange(dailyRep, bucketRange)
        : sumRange(dailyRep, cur) + nd(u.id, iCur, 'repair');
    if (prev) {
      prevLeave.set(u.id, {
        repair_points: roundPts(sumRange(dailyRep, prev) + nd(u.id, iPrev, 'repair')),
        leave_days: neutral.leaveDays(u.id, iPrev),
        points_actual: roundPts(sumRange(daily, prev)),
      });
    }
    const tAdj = { prior7: nd(u.id, iPrior7), last7: nd(u.id, iLast7) };
    if (tAdj.prior7 !== 0 || tAdj.last7 !== 0) trendAdjust.set(u.id, tAdj);
    const sparkVals = sparkDates.map((d) => roundPts(daily?.get(d) ?? 0));
    // Хандлагад түүхий утга — 1 орны дугуйлалт өдрийн 0.0x оноог бүгдийг 0 болгож,
    // хүн бүрийг «тогтвортой» гэж ангилдаг байсан.
    const trendVals = trendDates.map((d) => daily?.get(d) ?? 0);
    const isMember = rankNow.has(u);
    const rNow = isMember ? (rankNow.get(u) ?? null) : null;
    let r7: number | null = null;
    let r7src: EmployeeReportRow['rank_7d_source'] = null;
    if (isMember) {
      const s = snap7.get(u.id);
      if (s && s.rank != null) {
        r7 = s.rank;
        r7src = 'snapshot';
      } else if (rankLive7) {
        r7 = rankLive7.get(u) ?? null;
        r7src = 'live';
      }
    }
    const a = attMap.get(u.id);
    const p = progMap.get(u.id);
    return {
      user_id: u.id,
      full_name: u.full_name,
      username: u.username,
      employee_id: u.employee_id,
      position: u.position,
      seniority: u.seniority,
      profile_image: u.profile_image,
      role: u.role,
      status: u.status,
      team_id: u.team_id,
      team_code: u.team_code,
      team_name: u.team_name,
      is_leaderboard_member: isMember,
      points: roundPts(points),
      points_prev: pointsPrev == null ? null : roundPts(pointsPrev),
      points_delta_pct: pointsPrev == null ? null : pctDelta(points, pointsPrev),
      rank_now: rNow,
      pool_size: isMember ? pool : null,
      rank_7d_ago: r7,
      rank_delta: rankDelta(rNow, r7),
      rank_7d_source: r7src,
      trend: classifyTrend(trendVals, tAdj),
      spark: sparkVals,
      entries_count: p?.entries ?? 0,
      tasks_touched: p?.tasks ?? 0,
      tasks_completed: p?.completed ?? 0,
      repair_points: roundPts(repairPoints),
      repair_entries: repairMap.get(u.id)?.entries ?? 0,
      repair_hours: round1(repairMap.get(u.id)?.hours ?? 0),
      unweighted_entries: unweightedMap.get(u.id) ?? 0,
      present_days: a?.present_days ?? 0,
      hours_worked: round1(a?.hours ?? 0),
      late_minutes: a?.late ?? 0,
      leave_hours: round1(leaveMap.get(u.id) ?? 0),
      leave_days: iCur < 0 ? 0 : neutral.leaveDays(u.id, iCur),
      points_actual: roundPts(pointsActual),
    };
  });

  rows.sort((x, y) => y.points - x.points || x.full_name.localeCompare(y.full_name));
  return {
    rows,
    dailyPoints,
    dailyRepair,
    bucketRange,
    sparkRange: spark,
    expected_days: expected,
    pool_size: pool,
    prevLeave,
    trendAdjust,
  };
}

function windowOut(wp: WindowParams) {
  const spark = sparkRange(wp);
  return {
    window: { code: wp.window, from: wp.resolved.current.from, to: wp.resolved.current.to, days: wp.resolved.days },
    previous: wp.resolved.previous,
    anchor: wp.anchor,
    /** Мөр бүрийн `spark` цувааны муж — хүснэгтийн баганын гарчиг үүнээс. */
    sparkline: { from: spark.from, to: spark.to, days: daysBetween(spark.from, spark.to) },
  };
}

/* ------------------------------------------------------------------ */
/*  GET /overview                                                      */
/* ------------------------------------------------------------------ */

reports.get('/overview', async (c) => {
  const wp = readWindow((k) => c.req.query(k));
  if (!wp) return c.json({ error: 'Invalid window or anchor' }, 400);

  // Admin-only тул хэрэглэгчээр scope хийх шаардлагагүй — window+anchor л ялгана.
  return withEdgeCache(
    c,
    { key: 'reports:overview', varyTags: [wp.window, wp.anchor], ttlSeconds: 300 },
    async () => {
      const built = await buildRows(c.env.DB, wp);
      return {
        ...windowOut(wp),
        generated_at: new Date().toISOString(),
        expected_days: built.expected_days,
        pool_size: built.pool_size,
        rows: built.rows,
      };
    },
  );
});

/* ------------------------------------------------------------------ */
/*  GET /teams, GET /teams/:id                                         */
/* ------------------------------------------------------------------ */

export interface TeamReportRow {
  team_id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  members: number;
  leaderboard_members: number;
  points: number;
  points_prev: number | null;
  points_delta_pct: number | null;
  /** Σ оноо ÷ самбарын гишүүд.  Гишүүн бүрийн оноо ажилласан өдрөөр тул
   *  чөлөөтэй гишүүн «0 онооны хүн» болж дунджийг татахгүй. */
  avg_points_per_member: number;
  /** Гишүүдийн засварын оноо (`points`-ийн хэсэг). */
  repair_points: number;
  /** Самбарын гишүүнгүй баг (MGMT г.м.) байр авахгүй — null. */
  rank: number | null;
  present_rate: number | null;
  present_days: number;
  hours_worked: number;
  late_minutes: number;
  entries_count: number;
  tasks_completed: number;
  repair_entries: number;
  unweighted_entries: number;
  trend: TrendResult;
  spark: number[];
}

async function buildTeams(db: D1Database, wp: WindowParams) {
  const [built, teamsRes] = await Promise.all([
    buildRows(db, wp),
    db.prepare(`SELECT id, code, name_mn, name_en, sort_order FROM teams ORDER BY sort_order, code`).all<{
      id: number;
      code: string;
      name_mn: string;
      name_en: string | null;
      sort_order: number | null;
    }>(),
  ]);
  const byTeam = new Map<number, EmployeeReportRow[]>();
  for (const r of built.rows) {
    if (r.team_id == null) continue;
    const arr = byTeam.get(r.team_id) ?? [];
    arr.push(r);
    byTeam.set(r.team_id, arr);
  }
  const rows: TeamReportRow[] = [];
  for (const t of teamsRes.results ?? []) {
    const members = byTeam.get(t.id) ?? [];
    if (members.length === 0) continue;
    const lbMembers = members.filter((m) => m.is_leaderboard_member);
    const points = members.reduce((s, m) => s + m.points, 0);
    const prevVals = members.map((m) => m.points_prev).filter((v): v is number => v != null);
    const pointsPrev = wp.resolved.previous ? prevVals.reduce((s, v) => s + v, 0) : null;
    // Гишүүдийн цуваа бүгд ижил урттай (`built.sparkRange`); хандлага нь багийн
    // 14 хоногийн өдрийн нийлбэрээс — гишүүдийн spark-аас БИШ (цонх 7 хоног байж болно).
    const sparkLen = listDates(built.sparkRange.from, built.sparkRange.to).length;
    const spark = new Array<number>(sparkLen).fill(0);
    for (const m of members) m.spark.forEach((v, i) => (spark[i] = (spark[i] ?? 0) + v));
    const trendVals = listDates(isoAddDays(wp.anchor, -(TREND_DAYS - 1)), wp.anchor).map((d) =>
      members.reduce((s, m) => s + (built.dailyPoints.get(m.user_id)?.get(d) ?? 0), 0),
    );
    const presentDays = members.reduce((s, m) => s + m.present_days, 0);
    const denom = built.expected_days == null ? null : built.expected_days * members.length;
    // Гишүүдийн чөлөөний залруулга багийн хандлагад (хүн бүрийнхтэй ижил дүрэм).
    const trendAdj = { prior7: 0, last7: 0 };
    for (const m of members) {
      const a = built.trendAdjust.get(m.user_id);
      if (a) {
        trendAdj.prior7 += a.prior7;
        trendAdj.last7 += a.last7;
      }
    }
    rows.push({
      team_id: t.id,
      code: t.code,
      name_mn: t.name_mn,
      name_en: t.name_en,
      members: members.length,
      leaderboard_members: lbMembers.length,
      points: roundPts(points),
      points_prev: pointsPrev == null ? null : roundPts(pointsPrev),
      points_delta_pct: pointsPrev == null ? null : pctDelta(points, pointsPrev),
      avg_points_per_member: lbMembers.length ? roundPts(points / lbMembers.length) : 0,
      repair_points: roundPts(members.reduce((s, m) => s + m.repair_points, 0)),
      rank: null,
      present_rate: denom ? Math.round((presentDays / denom) * 1000) / 10 : null,
      present_days: presentDays,
      hours_worked: round1(members.reduce((s, m) => s + m.hours_worked, 0)),
      late_minutes: members.reduce((s, m) => s + m.late_minutes, 0),
      entries_count: members.reduce((s, m) => s + m.entries_count, 0),
      tasks_completed: members.reduce((s, m) => s + m.tasks_completed, 0),
      repair_entries: members.reduce((s, m) => s + m.repair_entries, 0),
      unweighted_entries: members.reduce((s, m) => s + m.unweighted_entries, 0),
      trend: classifyTrend(trendVals, trendAdj),
      spark: spark.map(roundPts),
    });
  }
  // Багийн байр — гишүүн тус бүрд ногдох оноогоор (багийн хэмжээ жигд бус);
  // самбарын гишүүнгүй баг (менежмент) байрлалд оролцохгүй.
  const ranked = rows.filter((r) => r.leaderboard_members > 0);
  const ranks = rankWithTies(ranked, (r) => r.avg_points_per_member);
  for (const r of ranked) r.rank = ranks.get(r) ?? null;
  rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.code.localeCompare(b.code));
  return { rows, built };
}

reports.get('/teams', async (c) => {
  const wp = readWindow((k) => c.req.query(k));
  if (!wp) return c.json({ error: 'Invalid window or anchor' }, 400);
  return withEdgeCache(
    c,
    { key: 'reports:teams', varyTags: [wp.window, wp.anchor], ttlSeconds: 300 },
    async () => {
      const { rows, built } = await buildTeams(c.env.DB, wp);
      return { ...windowOut(wp), expected_days: built.expected_days, rows };
    },
  );
});

reports.get('/teams/:id', async (c) => {
  const teamId = parseId(c.req.param('id'));
  if (teamId === null) return c.json({ error: 'Invalid id' }, 400);
  const wp = readWindow((k) => c.req.query(k));
  if (!wp) return c.json({ error: 'Invalid window or anchor' }, 400);

  const { rows: teamRows, built } = await buildTeams(c.env.DB, wp);
  const team = teamRows.find((t) => t.team_id === teamId);
  const members = built.rows.filter((r) => r.team_id === teamId);
  if (!team && members.length === 0) return c.json({ error: 'Team not found' }, 404);

  // Багийн өдрийн онооны цуваа (bucket мужид, ≤90 өдөр).
  const seriesFrom =
    wp.resolved.window === 'all' || daysBetween(wp.resolved.current.from, wp.anchor) > SERIES_MAX_DAYS
      ? isoAddDays(wp.anchor, -(SERIES_MAX_DAYS - 1))
      : wp.resolved.current.from;
  const from = seriesFrom < built.bucketRange.from ? built.bucketRange.from : seriesFrom;
  const dates = listDates(from, wp.anchor);
  const points = dates.map((d) =>
    roundPts(members.reduce((s, m) => s + (built.dailyPoints.get(m.user_id)?.get(d) ?? 0), 0)),
  );
  return c.json({ ...windowOut(wp), team: team ?? null, rows: members, series: { dates, points } });
});

/* ------------------------------------------------------------------ */
/*  Snapshot — статус, түүх, backfill                                  */
/* ------------------------------------------------------------------ */

reports.get('/snapshots/status', async (c) => {
  const db = c.env.DB;
  const today = todayInUB();
  const from = isoAddDays(today, -30);
  const [last, total, days] = await Promise.all([
    db.prepare('SELECT value FROM app_settings WHERE key = ?').bind(SNAPSHOT_KEY).first<{ value: string }>(),
    db.prepare('SELECT COUNT(*) AS n, MIN(date) AS first_date FROM employee_daily_snapshots').first<{
      n: number;
      first_date: string | null;
    }>(),
    db
      .prepare(`SELECT date, COUNT(*) AS n FROM employee_daily_snapshots WHERE date >= ? AND date < ? GROUP BY date`)
      .bind(from, today)
      .all<{ date: string; n: number }>(),
  ]);
  const have = new Set((days.results ?? []).map((d) => d.date));
  const missing = listDates(from, isoAddDays(today, -1)).filter((d) => !have.has(d));
  return c.json({
    last_date: last?.value || null,
    total_rows: total?.n ?? 0,
    first_date: total?.first_date ?? null,
    missing_days_30: missing,
  });
});

const BACKFILL_MAX_DAYS = 45;

reports.post('/snapshots/backfill', async (c) => {
  let body: { from?: unknown; to?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  const yesterday = isoAddDays(todayInUB(), -1);
  const to = isIsoDate(body.to) ? (body.to > yesterday ? yesterday : body.to) : yesterday;
  const from = isIsoDate(body.from) ? body.from : isoAddDays(to, -(BACKFILL_MAX_DAYS - 1));
  if (from > to) return c.json({ error: 'from > to' }, 400);
  const n = daysBetween(from, to);
  if (n > BACKFILL_MAX_DAYS) {
    return c.json({ error: `Нэг дуудлагад дээд тал нь ${BACKFILL_MAX_DAYS} өдөр`, max_days: BACKFILL_MAX_DAYS }, 400);
  }
  let users = 0;
  const dates: string[] = [];
  for (const d of listDates(from, to)) {
    const r = await snapshotDay(c.env.DB, d, 'backfill');
    users = r.users;
    dates.push(d);
  }
  return c.json({ from, to, days: dates.length, users_per_day: users });
});

/** Cron логикийг цагийн хаалтгүй — smoke тест / гар ажиллуулалт (өчигдөр). */
reports.post('/snapshots/run', async (c) => {
  const yesterday = isoAddDays(todayInUB(), -1);
  const r = await snapshotDay(c.env.DB, yesterday, 'cron');
  await c.env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at, updated_by)
     VALUES (?, ?, datetime('now'), ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'),
       updated_by = excluded.updated_by`,
  )
    .bind(SNAPSHOT_KEY, yesterday, c.get('user').sub)
    .run();
  return c.json({ date: yesterday, ...r });
});

/* ------------------------------------------------------------------ */
/*  Засварын тайлан — GET /repair-projects, /:key, /:key/entries       */
/* ------------------------------------------------------------------ */
/*
 * Тайлан хуудасны «Засварын төслийн тайлан» таб (2026-09-18).  Засварын бүртгэл
 * (`repair_entries`) ХОЁР эх сурвалжийн аль нэгэнд холбогддог (0194-ийн CHECK):
 *   • `project_id`        — ЖИНХЭНЭ төсөл дээрх засвар (анхны 0114 загвар, прод дээрх
 *                           бүртгэлийн дийлэнх нь ийм);
 *   • `repair_project_id` — админы гараар үүсгэсэн дотоод ажил (`repair_projects`).
 * Эзний дүрэм (2026-09-18): «хүмүүс ямар төсөл дээр засвар хийснийг олоод зүүн талд
 * төслүүдийг нь оруул» — тиймээс жагсаалт нь ХОЁУЛАНГ нэгтгэсэн «засварын зорилт»:
 * `key` = `p:<projects.id>` | `r:<repair_projects.id>`.  Хоёр id-ийн орон зай давхцдаг
 * (id 7 хоёуланд нь бий) тул composite түлхүүр ЗААВАЛ — RepairHistoryTab-ийн ижил конвенц.
 *
 *   • `rows` = ядаж НЭГ бүртгэлтэй зорилтууд, хамгийн сүүлд бүртгэл ирсэн нь дээрээ.
 *     Жинхэнэ төсөл нь ТӨЛӨВӨӨС ҮЛ ХАМААРАН орно (архивласан ZA төсөл дээрх засварын
 *     түүх л эзний хайж байгаа зүйл); `idle` = бүртгэлгүй дотоод ажил (устгаж болно).
 *   • Засах/архивлах/устгах нь зөвхөн дотоод ажилд, `/api/repair/projects*` замаар.
 *   • `computed_pct` нь бүртгэх үеийн SNAPSHOT тул нийлбэр нь тэр хүний авсан хувь.
 *   • `repair_entries.created_at` нь 0114-д NOT NULL биш → `date`-аар нөхнө.
 *   • Бүртгэлийн жагсаалт `id`-аар буурах cursor (`?before=`).
 */

export type RepairTargetKind = 'repair' | 'project';

export interface RepairProjectReportRow {
  /** `p:<id>` | `r:<id>` — UI/URL-д хэрэглэх ГАНЦ таних тэмдэг. */
  key: string;
  kind: RepairTargetKind;
  id: number;
  name: string;
  description: string | null;
  /** repair: active|archived · project: active|completed|archived */
  status: string;
  /** Зөвхөн жинхэнэ төсөлд (`projects.category`). */
  category: string | null;
  /** Зөвхөн жинхэнэ төсөлд (`projects.progress_mode`, 0339): 'tasks' | 'hours'. */
  progress_mode: string | null;
  /** Цагийн бүртгэлээс бодсон явц 0–100 (0339): дотоод ажилд үргэлж, жинхэнэ
   *  төсөлд зөвхөн `progress_mode = 'hours'` үед; бусдад null (жинлэсэн явц энд
   *  ХАРУУЛАХГҮЙ — тэр Төслүүд хуудсанд). */
  progress: number | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  entry_count: number;
  people_count: number;
  total_hours: number;
  total_pct: number;
  last_entry_at: string | null;
  last_entry_date: string | null;
  last_entry_user_id: number | null;
  last_entry_user_name: string | null;
}

export interface RepairProjectPersonRow {
  user_id: number;
  full_name: string;
  username: string;
  profile_image: string | null;
  position: string | null;
  user_status: string;
  team_code: string | null;
  entries: number;
  hours: number;
  pct: number;
  /** Энэ хүний зорилтын явцад нэмсэн хувь — түүнд тэр зорилт дээр олгосон
   *  Σ user_points.amount (2026-09-29, `hoursProgressSql`-тэй ижил дүрэм). */
  progress_pct: number;
  /** Энэ хүний хувь зорилтын нийт хувьд эзлэх хэсэг (0–100). */
  share_pct: number;
  first_date: string;
  last_date: string;
  last_at: string | null;
}

export interface RepairProjectEntryRow {
  id: number;
  user_id: number;
  full_name: string;
  profile_image: string | null;
  date: string;
  hours: number;
  computed_pct: number;
  /** Төслийн явцад нэмсэн хувь (0339). */
  progress_pct: number;
  weekly_avg_pct: number;
  rate_source: string | null;
  description: string;
  created_at: string | null;
}

const REPAIR_ENTRIES_PAGE = 30;
const REPAIR_ENTRIES_PAGE_MAX = 100;

/** `p:42` | `r:1` | `42` (хуучин — дотоод ажил) → зорилт.  Танигдахгүй бол null. */
function parseRepairKey(raw: string | undefined): { kind: RepairTargetKind; id: number } | null {
  const m = /^(?:([pr]):)?(\d+)$/.exec((raw ?? '').trim());
  if (!m) return null;
  const id = Number.parseInt(m[2] ?? '', 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { kind: m[1] === 'p' ? 'project' : 'repair', id };
}

/** Хоёр эх сурвалжийн ижил хэлбэртэй SELECT — `fk` нь `re.repair_project_id` эсвэл `re.project_id`. */
function repairTargetSelect(kind: RepairTargetKind): string {
  const fk = kind === 'repair' ? 're.repair_project_id' : 're.project_id';
  const src = kind === 'repair' ? 'repair_projects' : 'projects';
  return `
  SELECT '${kind}' AS kind, x.id, x.name, x.description, x.status,
         ${kind === 'project' ? 'x.category' : 'NULL'} AS category,
         ${kind === 'project' ? 'x.progress_mode' : 'NULL'} AS progress_mode,
         ${
           kind === 'project'
             ? `CASE WHEN x.progress_mode = 'hours' THEN ROUND(${hoursProgressSql('project_id', 'x.id')}, 2) ELSE NULL END`
             : `ROUND(${hoursProgressSql('repair_project_id', 'x.id')}, 2)`
         } AS progress,
         x.created_by, x.created_at,
         cu.full_name AS created_by_name,
         COUNT(re.id)                        AS entry_count,
         COUNT(DISTINCT re.user_id)          AS people_count,
         COALESCE(SUM(re.hours), 0)          AS total_hours,
         COALESCE(SUM(re.computed_pct), 0)   AS total_pct,
         MAX(COALESCE(re.created_at, re.date)) AS last_entry_at,
         MAX(re.date)                        AS last_entry_date,
         (SELECT r2.user_id FROM repair_entries r2
           WHERE ${fk.replace('re.', 'r2.')} = x.id
           ORDER BY COALESCE(r2.created_at, r2.date) DESC, r2.id DESC LIMIT 1) AS last_entry_user_id,
         (SELECT u2.full_name FROM repair_entries r2 JOIN users u2 ON u2.id = r2.user_id
           WHERE ${fk.replace('re.', 'r2.')} = x.id
           ORDER BY COALESCE(r2.created_at, r2.date) DESC, r2.id DESC LIMIT 1) AS last_entry_user_name
  FROM ${src} x
  LEFT JOIN users cu ON cu.id = x.created_by
  LEFT JOIN repair_entries re ON ${fk} = x.id`;
}

function shapeRepairTarget(r: Omit<RepairProjectReportRow, 'key'>): RepairProjectReportRow {
  return {
    ...r,
    key: `${r.kind === 'project' ? 'p' : 'r'}:${r.id}`,
    entry_count: Number(r.entry_count ?? 0),
    people_count: Number(r.people_count ?? 0),
    total_hours: round1(Number(r.total_hours ?? 0)),
    total_pct: Math.round(Number(r.total_pct ?? 0) * 1000) / 1000,
    progress: r.progress == null ? null : Math.round(Number(r.progress) * 100) / 100,
  };
}

// GET /repair-projects — `rows` (бүртгэлтэй дотоод ажил + жинхэнэ төсөл, сүүлийн
//   бүртгэлээр буурах) + `idle` (бүртгэлгүй дотоод ажил).  Архивласан дотоод ажил
//   хоёуланд нь орно — тайлан бол түүх; frontend «Идэвхгүйг харуулах»-аар шүүнэ.
reports.get('/repair-projects', async (c) => {
  const [rpRes, pRes] = await c.env.DB.batch([
    c.env.DB.prepare(`${repairTargetSelect('repair')} GROUP BY x.id`),
    c.env.DB.prepare(`${repairTargetSelect('project')} GROUP BY x.id HAVING COUNT(re.id) > 0`),
  ]);
  const all = [...((rpRes?.results ?? []) as Omit<RepairProjectReportRow, 'key'>[]), ...((pRes?.results ?? []) as Omit<RepairProjectReportRow, 'key'>[])].map(
    shapeRepairTarget,
  );
  const rows = all
    .filter((r) => r.entry_count > 0)
    .sort((a, b) => (b.last_entry_at ?? '').localeCompare(a.last_entry_at ?? '') || b.id - a.id);
  const idle = all
    .filter((r) => r.entry_count === 0)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id);
  return c.json({ generated_at: new Date().toISOString(), rows, idle });
});

// GET /repair-projects/:key — зорилтын толгой + хүн бүрийн нийлбэр (нэр, хувь, цаг).
reports.get('/repair-projects/:key', async (c) => {
  const target = parseRepairKey(c.req.param('key'));
  if (!target) return c.json({ error: 'Invalid id' }, 400);
  const fk = target.kind === 'repair' ? 're.repair_project_id' : 're.project_id';
  const upFk = target.kind === 'repair' ? 'repair_project_id' : 'project_id';

  const [projectRes, peopleRes, creditRes] = await c.env.DB.batch([
    c.env.DB.prepare(`${repairTargetSelect(target.kind)} WHERE x.id = ? GROUP BY x.id`).bind(target.id),
    c.env.DB.prepare(
      `SELECT re.user_id, u.full_name, u.username, u.profile_image, u.position,
              u.status AS user_status, t.code AS team_code,
              COUNT(*)                            AS entries,
              COALESCE(SUM(re.hours), 0)          AS hours,
              COALESCE(SUM(re.computed_pct), 0)   AS pct,
              MIN(re.date)                        AS first_date,
              MAX(re.date)                        AS last_date,
              MAX(COALESCE(re.created_at, re.date)) AS last_at
       FROM repair_entries re
       JOIN users u ON u.id = re.user_id
       LEFT JOIN teams t ON t.id = u.team_id
       WHERE ${fk} = ?
       GROUP BY re.user_id
       ORDER BY pct DESC, hours DESC, u.full_name ASC`,
    ).bind(target.id),
    // Явцад нэмсэн хувь = олгосон хувь (`lib/repairProgress.ts` hoursProgressSql) —
    // нэг индексийн уншилт, хүн бүрд корреляц дэд асуулгагүй.
    c.env.DB.prepare(
      `SELECT user_id, SUM(amount) AS credited FROM user_points WHERE ${upFk} = ? GROUP BY user_id`,
    ).bind(target.id),
  ]);
  const credited = new Map<number, number>();
  for (const r of (creditRes?.results ?? []) as Array<{ user_id: number; credited: number | null }>) {
    credited.set(Number(r.user_id), Number(r.credited ?? 0));
  }
  const projectRow = (projectRes?.results ?? [])[0] as Omit<RepairProjectReportRow, 'key'> | undefined;
  if (!projectRow) return c.json({ error: 'Not found' }, 404);
  const project = shapeRepairTarget(projectRow);

  const rawPeople = (peopleRes?.results ?? []) as Array<Omit<RepairProjectPersonRow, 'share_pct' | 'progress_pct'>>;
  const totalPct = rawPeople.reduce((s, p) => s + Number(p.pct ?? 0), 0);
  const people: RepairProjectPersonRow[] = rawPeople.map((p) => {
    const pct = Number(p.pct ?? 0);
    return {
      ...p,
      entries: Number(p.entries ?? 0),
      hours: round1(Number(p.hours ?? 0)),
      pct: Math.round(pct * 1000) / 1000,
      progress_pct: Math.round((credited.get(Number(p.user_id)) ?? 0) * 1000) / 1000,
      share_pct: totalPct > 0 ? Math.round((pct / totalPct) * 1000) / 10 : 0,
    };
  });

  return c.json({ project, people });
});

// GET /repair-projects/:key/entries?before=<id>&limit=30&user_id=
//   Бүртгэл бүр (хэн, хэзээ, хэдэн цаг, хэдэн хувь, тайлбар) — `id` буурах
//   cursor.  `next_before` null бол дууссан.
reports.get('/repair-projects/:key/entries', async (c) => {
  const target = parseRepairKey(c.req.param('key'));
  if (!target) return c.json({ error: 'Invalid id' }, 400);
  const before = parseId(c.req.query('before') ?? '');
  const userId = parseId(c.req.query('user_id') ?? '');
  const limitRaw = Number(c.req.query('limit'));
  const limit =
    Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, REPAIR_ENTRIES_PAGE_MAX) : REPAIR_ENTRIES_PAGE;

  const filters = [target.kind === 'repair' ? 're.repair_project_id = ?' : 're.project_id = ?'];
  const binds: (number | string)[] = [target.id];
  if (before !== null) {
    filters.push('re.id < ?');
    binds.push(before);
  }
  if (userId !== null) {
    filters.push('re.user_id = ?');
    binds.push(userId);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT re.id, re.user_id, u.full_name, u.profile_image, re.date, re.hours,
            re.computed_pct, re.progress_pct, re.weekly_avg_pct, re.rate_source, re.description, re.created_at
     FROM repair_entries re
     JOIN users u ON u.id = re.user_id
     WHERE ${filters.join(' AND ')}
     ORDER BY re.id DESC
     LIMIT ?`,
  )
    .bind(...binds, limit + 1)
    .all<RepairProjectEntryRow>();
  const rows = results ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return c.json({
    rows: page.map((r) => ({
      ...r,
      hours: Number(r.hours ?? 0),
      computed_pct: Number(r.computed_pct ?? 0),
      weekly_avg_pct: Number(r.weekly_avg_pct ?? 0),
    })),
    next_before: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  });
});

/* ------------------------------------------------------------------ */
/*  GET /employees/:id — дэлгэрэнгүй                                   */
/* ------------------------------------------------------------------ */

reports.get('/employees/:id', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ error: 'Invalid id' }, 400);
  const wp = readWindow((k) => c.req.query(k));
  if (!wp) return c.json({ error: 'Invalid window or anchor' }, 400);
  const db = c.env.DB;
  const { anchor, resolved } = wp;
  const cur = resolved.current;
  const prev = resolved.previous;

  const built = await buildRows(db, wp, { includeInactive: true });
  const row = built.rows.find((r) => r.user_id === userId);
  if (!row) return c.json({ error: 'User not found' }, 404);

  // «Бүх цаг» — ажилд орсон өдрөөс БИШ, системийн бүртгэл ба анхны
  // ажлын хувийн бүртгэлийн аль эртээс. Overview-д хүн бүр өөр эхлэлтэй
  // тул expected_days null; энд нэг хүн тул ажлын өдрийг тоолно.
  const effFrom = resolved.window === 'all' ? await employeeAllTimeFrom(db, userId, anchor) : cur.from;
  const effRange: DateRange = { from: effFrom, to: anchor };
  const offset = orgUtcOffsetMinutes(new Date(`${anchor}T12:00:00Z`));
  const seriesBounds = ubDayBoundsUtc(effFrom, anchor, offset);
  // Цуваа цонхыг БҮТНЭЭР нь дагана; урт цонхонд өдрийг 7 хоног/сараар нэгтгэнэ.
  const granularity = seriesGranularity(daysBetween(effFrom, anchor));

  const [
    teamsRes,
    prevAtt,
    prevProg,
    prevRepair,
    prevLeave,
    prevExpected,
    attDaily,
    ptsDaily,
    projRes,
    rankHist,
    leaveRows,
    suggestionRows,
    allExpected,
    holidaySet,
    prevUnweighted,
    daily30,
    npwRes,
  ] = await Promise.all([
      db
        .prepare(
          `SELECT t.id, t.code, t.name_mn, ut.is_primary FROM user_teams ut JOIN teams t ON t.id = ut.team_id
            WHERE ut.user_id = ? ORDER BY ut.is_primary DESC, t.sort_order`,
        )
        .bind(userId)
        .all<{ id: number; code: string; name_mn: string; is_primary: number }>(),
      prev ? attendanceAgg(db, prev) : Promise.resolve(null),
      prev ? progressAgg(db, prev) : Promise.resolve(null),
      prev ? repairAgg(db, prev) : Promise.resolve(null),
      prev ? leaveAgg(db, prev) : Promise.resolve(null),
      prev ? expectedWorkDays(db, prev) : Promise.resolve<number | null>(null),
      db
        .prepare(
          `SELECT a.date AS day, COALESCE(SUM(a.hours_worked), 0) AS hours,
                  COALESCE(MAX(CASE WHEN ${LATE_NOT_WAIVED_SQL} THEN a.late_minutes ELSE 0 END), 0) AS late
             FROM attendance_sessions a
            WHERE a.user_id = ? AND a.date >= ? AND a.date <= ? AND a.clock_out IS NOT NULL
            GROUP BY a.date`,
        )
        .bind(userId, effFrom, anchor)
        .all<{ day: string; hours: number; late: number }>(),
      // Цуваа bucket мужаас урт байж болно (сарын цонх ≤90) — тусад нь уншина.
      db
        .prepare(
          `SELECT date(awarded_at, ?) AS day, SUM(amount) AS pts,
                  SUM(CASE WHEN source = 'repair' THEN amount ELSE 0 END) AS repair_pts
             FROM user_points
            WHERE user_id = ? AND awarded_at >= ? AND awarded_at < ? GROUP BY day`,
        )
        .bind(sqliteOffsetModifier(offset), userId, seriesBounds.startUtc, seriesBounds.endUtcExclusive)
        .all<{ day: string; pts: number; repair_pts: number }>(),
      // Төслийн задаргаа — ХОЁР баганаар бүлэглэнэ (0194: project_id NULL байж болно).
      db
        .prepare(
          `SELECT p.project_id, p.repair_project_id,
                  COALESCE(pr.name, rp.name) AS project_name,
                  CASE WHEN p.repair_project_id IS NOT NULL THEN 1 ELSE 0 END AS is_repair_project,
                  -- Төслийн бус ажлын оноо (0343) — хоёр эзэн хоёулаа NULL тул
                  -- тэдгээр нь НЭГ бүлэг болно; нэргүй мөрийг UI шошгоор нь нэрлэнэ.
                  MAX(CASE WHEN p.source = 'non_project' THEN 1 ELSE 0 END) AS is_non_project,
                  SUM(p.amount) AS points, COUNT(*) AS award_count, MAX(p.awarded_at) AS last_awarded_at
             FROM user_points p
             LEFT JOIN projects pr ON pr.id = p.project_id
             LEFT JOIN repair_projects rp ON rp.id = p.repair_project_id
            WHERE p.user_id = ? AND p.awarded_at >= ? AND p.awarded_at < ?
            GROUP BY p.project_id, p.repair_project_id
            ORDER BY points DESC`,
        )
        .bind(userId, seriesBounds.startUtc, seriesBounds.endUtcExclusive)
        .all<{
          project_id: number | null;
          repair_project_id: number | null;
          project_name: string | null;
          is_repair_project: number;
          is_non_project: number;
          points: number;
          award_count: number;
          last_awarded_at: string | null;
        }>(),
      db
        .prepare(
          `SELECT date, rank_30d, rank_7d, pool_size, points_30d FROM employee_daily_snapshots
            WHERE user_id = ? AND date <= ? ORDER BY date DESC LIMIT 30`,
        )
        .bind(userId, anchor)
        .all<{ date: string; rank_30d: number | null; rank_7d: number | null; pool_size: number | null; points_30d: number }>(),
      // Чөлөөний хүсэлт — цонхтой ДАВХЦСАН бүх төлөв (цуцалсан ч орно, тоолуурт
      // «хэдэн хүсэлт илгээсэн» гэдэг нь харагдана).  `all`-д доод хилгүй.
      db
        .prepare(
          `SELECT l.id, l.leave_type, l.reason_code, l.start_date, l.end_date, l.start_time, l.end_time,
                  l.days, l.hours, l.reason, l.status, l.is_paid, l.reviewer_note, l.decided_at, l.created_at,
                  rv.full_name AS reviewer_name
             FROM leave_requests l
             LEFT JOIN users rv ON rv.id = l.reviewer_id
            WHERE l.user_id = ? AND l.start_date <= ? AND l.end_date >= ?
            ORDER BY l.start_date DESC, l.id DESC`,
        )
        .bind(userId, anchor, effFrom)
        .all<LeaveRow>(),
      // Санал хүсэлт — ЗӨВХӨН нэрээ нууцлаагүй мөр.  `is_anonymous = 1` нь
      // ажилтанд өгсөн амлалт тул хувийн тайланд ч, экспортод ч орохгүй.
      db
        .prepare(
          `SELECT s.id, s.title, s.description, s.status, s.resolution, s.reviewer_note,
                  s.decided_at, s.created_at, rv.full_name AS reviewer_name
             FROM suggestions s
             LEFT JOIN users rv ON rv.id = s.reviewer_id
            WHERE s.user_id = ? AND s.is_anonymous = 0 AND s.created_at >= ? AND s.created_at < ?
            ORDER BY s.created_at DESC`,
        )
        .bind(userId, seriesBounds.startUtc, seriesBounds.endUtcExclusive)
        .all<SuggestionRow>(),
      resolved.window === 'all' ? expectedWorkDays(db, effRange) : Promise.resolve<number | null>(null),
      getHolidaySet(db, effFrom, anchor),
      prev ? unweightedAgg(db, prev) : Promise.resolve(null),
      // Өдрийн дундаж — АЖИЛЛАСАН өдрийн (lib/dailyAverage.ts): anchor-оор
      // төгсөх сүүлийн 21 ажлын өдөр, шинэ ажилтан орсноос хойш, чөлөө алгасна.
      loadDailyAverages(db, { windows: [{ days: RANK_DAYS, userIds: [userId] }], through: anchor }),
      db
        .prepare(
          `SELECT date, category, note, minutes, status
             FROM non_project_work_entries
            WHERE user_id = ? AND date >= ? AND date <= ? AND status != 'rejected'
            ORDER BY date DESC, id DESC`,
        )
        .bind(userId, effFrom, anchor)
        .all<{ date: string; category: string; note: string | null; minutes: number; status: string }>(),
    ]);

  const ptsRows = ptsDaily.results ?? [];
  const attRows = attDaily.results ?? [];
  const windowPoints = roundPts(ptsRows.reduce((s, r) => s + (r.pts ?? 0), 0));
  const windowRepair = roundPts(ptsRows.reduce((s, r) => s + (r.repair_pts ?? 0), 0));
  let leaveHours = row.leave_hours;
  if (resolved.window === 'all') {
    let h = 0;
    for (const l of leaveRows.results ?? []) {
      if (l.status !== 'approved') continue;
      const span = Math.max(1, daysBetween(l.start_date, l.end_date));
      const from = l.start_date > effFrom ? l.start_date : effFrom;
      const to = l.end_date < anchor ? l.end_date : anchor;
      const clipped = Math.min(span, Math.max(0, daysBetween(from, to)));
      const total = l.hours ?? (l.days ?? span) * STANDARD_WORK_DAY_HOURS;
      h += (total * clipped) / span;
    }
    leaveHours = round1(h);
  }
  const clipped = resolved.window === 'all'
    ? await db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM progress_entries
               WHERE user_id = ?1 AND date >= ?2 AND date <= ?3 AND status = 'approved' AND COALESCE(source, '') <> 'alloc_adj') AS entries,
             (SELECT COUNT(DISTINCT task_id) FROM progress_entries
               WHERE user_id = ?1 AND date >= ?2 AND date <= ?3 AND status = 'approved' AND COALESCE(source, '') <> 'alloc_adj') AS tasks,
             (SELECT COALESCE(SUM(CASE WHEN percentage >= 100 THEN 1 ELSE 0 END), 0) FROM progress_entries
               WHERE user_id = ?1 AND date >= ?2 AND date <= ?3 AND status = 'approved' AND COALESCE(source, '') <> 'alloc_adj') AS completed,
             (SELECT COUNT(*) FROM repair_entries
               WHERE user_id = ?1 AND date >= ?2 AND date <= ?3) AS repair_entries,
             (SELECT COALESCE(SUM(hours), 0) FROM repair_entries
               WHERE user_id = ?1 AND date >= ?2 AND date <= ?3) AS repair_hours`,
        )
        .bind(userId, effFrom, anchor)
        .first<{ entries: number; tasks: number; completed: number; repair_entries: number; repair_hours: number }>()
    : null;
  const metrics: EmployeeMetrics = {
    // «Бүх цаг»-д оноо/ирцийг эхлэлийн өдрөөс (бүртгэл / анхны хувь) тоолно.
    // Бусад цонхонд buildRows аль хэдийн тэр мужтай.
    points: resolved.window === 'all' ? windowPoints : row.points,
    repair_points: resolved.window === 'all' ? windowRepair : row.repair_points,
    entries_count: clipped ? (clipped.entries ?? 0) : row.entries_count,
    tasks_touched: clipped ? (clipped.tasks ?? 0) : row.tasks_touched,
    tasks_completed: clipped ? (clipped.completed ?? 0) : row.tasks_completed,
    repair_entries: clipped ? (clipped.repair_entries ?? 0) : row.repair_entries,
    repair_hours: clipped ? round1(clipped.repair_hours) : row.repair_hours,
    unweighted_entries: row.unweighted_entries,
    present_days: resolved.window === 'all' ? attRows.length : row.present_days,
    expected_days: built.expected_days ?? allExpected,
    hours_worked: resolved.window === 'all' ? round1(attRows.reduce((s, r) => s + (r.hours ?? 0), 0)) : row.hours_worked,
    late_minutes: resolved.window === 'all' ? attRows.reduce((s, r) => s + (r.late ?? 0), 0) : row.late_minutes,
    leave_hours: leaveHours,
    leave_days: row.leave_days,
    points_actual: resolved.window === 'all' ? windowPoints : row.points_actual,
    daily_avg_30d: roundPts(daily30.get(userId)?.avg ?? 0),
  };
  let prevMetrics: EmployeeMetrics | null = null;
  if (prev && prevAtt && prevProg && prevRepair && prevLeave) {
    const a = prevAtt.get(userId);
    const p = prevProg.get(userId);
    const pl = built.prevLeave.get(userId);
    prevMetrics = {
      points: row.points_prev ?? 0,
      // Өмнөх цонх bucket-ийн дотор (buildRows тэгж сунгадаг) тул өдрийн map-аас;
      // чөлөөний залруулгатай (buildRows `prevLeave`).
      repair_points: pl?.repair_points ?? roundPts(sumRange(built.dailyRepair.get(userId), prev)),
      entries_count: p?.entries ?? 0,
      tasks_touched: p?.tasks ?? 0,
      tasks_completed: p?.completed ?? 0,
      repair_entries: prevRepair.get(userId)?.entries ?? 0,
      repair_hours: round1(prevRepair.get(userId)?.hours ?? 0),
      unweighted_entries: prevUnweighted?.get(userId) ?? 0,
      present_days: a?.present_days ?? 0,
      expected_days: prevExpected,
      hours_worked: round1(a?.hours ?? 0),
      late_minutes: a?.late ?? 0,
      leave_hours: round1(prevLeave.get(userId) ?? 0),
      leave_days: pl?.leave_days ?? 0,
      points_actual: pl?.points_actual ?? row.points_prev ?? 0,
      daily_avg_30d: 0,
    };
  }
  const npwRows = npwRes.results ?? [];

  const attByDay = new Map<string, { hours: number; late: number }>();
  for (const r of attDaily.results ?? []) attByDay.set(r.day, { hours: r.hours ?? 0, late: r.late ?? 0 });
  const ptsByDay = new Map<string, number>();
  for (const r of ptsDaily.results ?? []) ptsByDay.set(r.day, r.pts ?? 0);
  const series = buildSeries(effFrom, anchor, granularity, holidaySet, (d) => ({
    points: ptsByDay.get(d) ?? 0,
    hours: attByDay.get(d)?.hours ?? 0,
    late: attByDay.get(d)?.late ?? 0,
    present: attByDay.has(d) ? 1 : 0,
  }));

  const history = (rankHist.results ?? []).reverse();

  const leavesByStatus: Record<string, { days: number; count: number }> = {};
  for (const l of leaveRows.results ?? []) {
    const agg = leavesByStatus[l.status] ?? { days: 0, count: 0 };
    leavesByStatus[l.status] = { days: round1(agg.days + (l.days ?? 0)), count: agg.count + 1 };
  }

  const out = windowOut(wp);
  return c.json({
    ...out,
    // «Бүх цаг»-д 2000-01-01 биш, энэ хүний бодит эхлэлийг харуулна.
    window: { ...out.window, from: effFrom, days: daysBetween(effFrom, anchor) },
    user: {
      id: row.user_id,
      full_name: row.full_name,
      username: row.username,
      employee_id: row.employee_id,
      position: row.position,
      seniority: row.seniority,
      role: row.role,
      status: row.status,
      profile_image: row.profile_image,
      team_id: row.team_id,
      team_code: row.team_code,
      team_name: row.team_name,
      teams: (teamsRes.results ?? []).map((t) => ({ ...t, is_primary: t.is_primary === 1 })),
      is_leaderboard_member: row.is_leaderboard_member,
    },
    metrics,
    prev_metrics: prevMetrics,
    deltas: {
      points_pct: row.points_delta_pct,
      hours_pct: prevMetrics ? pctDelta(metrics.hours_worked, prevMetrics.hours_worked) : null,
      late_minutes: prevMetrics ? metrics.late_minutes - prevMetrics.late_minutes : null,
      present_days: prevMetrics ? metrics.present_days - prevMetrics.present_days : null,
      entries: prevMetrics ? metrics.entries_count - prevMetrics.entries_count : null,
    },
    rank: {
      now: row.rank_now,
      pool_size: row.pool_size,
      at_7d_ago: row.rank_7d_ago,
      delta: row.rank_delta,
      source: row.rank_7d_source,
      history,
    },
    trend: row.trend,
    spark: row.spark,
    series,
    projects: (projRes.results ?? []).map((p) => ({
      project_id: p.project_id,
      repair_project_id: p.repair_project_id,
      is_repair_project: p.is_repair_project === 1,
      is_non_project: p.is_non_project === 1,
      name: p.project_name,
      points: roundPts(p.points),
      award_count: p.award_count,
      last_awarded_at: p.last_awarded_at,
    })),
    leaves: { by_status: leavesByStatus, rows: leaveRows.results ?? [] },
    suggestions: suggestionRows.results ?? [],
    non_project_work: {
      minutes: npwRows.reduce((s, r) => s + r.minutes, 0),
      rows: npwRows,
    },
  });
});

/* ---- Дэлгэрэнгүйн туслахууд ---- */

interface LeaveRow {
  id: number;
  leave_type: string;
  reason_code: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  days: number;
  hours: number | null;
  reason: string | null;
  status: string;
  is_paid: number | null;
  reviewer_note: string | null;
  decided_at: string | null;
  created_at: string;
  reviewer_name: string | null;
}

interface SuggestionRow {
  id: number;
  title: string;
  description: string;
  status: string;
  resolution: string | null;
  reviewer_note: string | null;
  decided_at: string | null;
  created_at: string;
  reviewer_name: string | null;
}

/** Цонхны урт → цувааны нэгж.  ≤ 3 сар өдрөөр, ≤ ~13 сар 7 хоногоор, цаашид сараар. */
export type SeriesGranularity = 'day' | 'week' | 'month';
export function seriesGranularity(days: number): SeriesGranularity {
  if (days <= SERIES_MAX_DAYS) return 'day';
  if (days <= 400) return 'week';
  return 'month';
}

/** Даваа гарагаар эхэлсэн 7 хоногийн эхний өдөр. */
function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Ням
  return isoAddDays(date, -((dow + 6) % 7));
}

function bucketKey(date: string, g: SeriesGranularity): string {
  if (g === 'day') return date;
  if (g === 'week') return weekStart(date);
  return `${date.slice(0, 7)}-01`;
}

/**
 * Өдрийн утгуудыг цувааны нэгжээр нэгтгэнэ.  `expected` = тухайн нэгж дэх
 * ажлын өдөр (амралт, баяр хасагдсан) — ирцийн графикт «ирсэн / ажлын өдөр».
 * Нэгж бүр `from`…`to` мужаар ТАСЛАГДСАН тул эхний/сүүлийн хагас 7 хоног
 * бодитоор хэдэн өдөртэй байна, төдийг л тоолно.
 */
function buildSeries(
  from: string,
  to: string,
  g: SeriesGranularity,
  holidays: Set<string>,
  at: (d: string) => { points: number; hours: number; late: number; present: number },
) {
  const keys: string[] = [];
  const acc = new Map<string, { points: number; hours: number; late: number; present: number; expected: number }>();
  for (const d of listDates(from, to)) {
    const k = bucketKey(d, g);
    let b = acc.get(k);
    if (!b) {
      b = { points: 0, hours: 0, late: 0, present: 0, expected: 0 };
      acc.set(k, b);
      keys.push(k);
    }
    const v = at(d);
    b.points += v.points;
    b.hours += v.hours;
    b.late += v.late;
    b.present += v.present;
    if (!isWeekend(d) && !holidays.has(d)) b.expected += 1;
  }
  return {
    granularity: g,
    dates: keys,
    points: keys.map((k) => roundPts(acc.get(k)!.points)),
    hours: keys.map((k) => round1(acc.get(k)!.hours)),
    late_minutes: keys.map((k) => acc.get(k)!.late),
    present: keys.map((k) => acc.get(k)!.present),
    expected: keys.map((k) => acc.get(k)!.expected),
  };
}

/**
 * «Бүх цаг»-ийн эхлэл — системийн бүртгэл ба анхны ажлын хувийн
 * бүртгэл (baseline/амралтын мөр биш). Ажилд орсон өдөр орохгүй.
 */
async function employeeAllTimeFrom(db: D1Database, userId: number, anchor: string): Promise<string> {
  const r = await db
    .prepare(
      `SELECT (SELECT date(created_at) FROM users WHERE id = ?1) AS created,
              (SELECT MIN(date) FROM progress_entries
                WHERE user_id = ?1 AND is_baseline = 0 AND is_rest_day = 0
                  AND COALESCE(source, '') <> 'alloc_adj') AS progress`,
    )
    .bind(userId)
    .first<{ created: string | null; progress: string | null }>();
  return pickAllTimeFrom(anchor, r?.created, r?.progress);
}

/* ------------------------------------------------------------------ */
/*  Snapshot timeline — нэг хүний өдрийн тайлангууд                    */
/* ------------------------------------------------------------------ */

reports.get('/employees/:id/snapshots', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ error: 'Invalid id' }, 400);
  const today = todayInUB();
  const toQ = c.req.query('to');
  const fromQ = c.req.query('from');
  const to = isIsoDate(toQ) ? toQ : isoAddDays(today, -1);
  let from = isIsoDate(fromQ) ? fromQ : isoAddDays(to, -29);
  if (daysBetween(from, to) > 120) from = isoAddDays(to, -119);
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, t.code AS team_code FROM employee_daily_snapshots s
       LEFT JOIN teams t ON t.id = s.team_id
      WHERE s.user_id = ? AND s.date >= ? AND s.date <= ?
      ORDER BY s.date DESC`,
  )
    .bind(userId, from, to)
    .all<SnapshotRow & { team_code: string | null }>();
  return c.json({ user_id: userId, from, to, rows: results ?? [] });
});

/* ------------------------------------------------------------------ */
/*  HR карт                                                            */
/* ------------------------------------------------------------------ */

interface HrRow {
  user_id: number;
  hired_at: string | null;
  probation_end: string | null;
  contract_no: string | null;
  contract_type: string | null;
  contract_start: string | null;
  contract_end: string | null;
  contract_file_key: string | null;
  contract_file_name: string | null;
  contract_file_size: number | null;
  contract_uploaded_at: string | null;
  nda_file_key: string | null;
  nda_file_name: string | null;
  nda_file_size: number | null;
  nda_uploaded_at: string | null;
  pc_username: string | null;
  pc_password: string | null;
  phone: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: number | null;
}

/** Файлын R2 түлхүүрийг клиентэд өгөхгүй — зөвхөн «байгаа эсэх». */
function hrOut(h: HrRow | null) {
  if (!h) return null;
  const { contract_file_key: _key, nda_file_key: _nda, ...rest } = h;
  return { ...rest, has_contract_file: !!h.contract_file_key, has_nda_file: !!h.nda_file_key };
}

async function loadHr(db: D1Database, userId: number): Promise<HrRow | null> {
  return (await db.prepare(`SELECT * FROM employee_hr WHERE user_id = ?`).bind(userId).first<HrRow>()) ?? null;
}

async function loadUserBasic(db: D1Database, userId: number) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.status, u.position, u.employee_id,
              u.seniority, u.created_at, u.profile_image, u.work_schedule
         FROM users u WHERE u.id = ? AND u.role <> 'client'`,
    )
    .bind(userId)
    .first<{
      id: number;
      username: string;
      full_name: string;
      email: string | null;
      role: string;
      status: string;
      position: string | null;
      employee_id: string | null;
      seniority: string | null;
      created_at: string;
      profile_image: string | null;
      work_schedule: string;
    }>();
}

reports.get('/employees/:id/hr', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const user = await loadUserBasic(db, userId);
  if (!user) return c.json({ error: 'User not found' }, 404);

  // Чөлөө энд БАЙХГҮЙ — цонхыг дагадаг тул GET /employees/:id-ийн `leaves` талбарт.
  const [hr, teamsRes, assessRes, pgpRes] = await Promise.all([
    loadHr(db, userId),
    db
      .prepare(
        `SELECT t.id, t.code, t.name_mn, ut.is_primary FROM user_teams ut JOIN teams t ON t.id = ut.team_id
          WHERE ut.user_id = ? ORDER BY ut.is_primary DESC, t.sort_order`,
      )
      .bind(userId)
      .all<{ id: number; code: string; name_mn: string; is_primary: number }>(),
    db
      .prepare(
        `SELECT ro.id AS round_id, ro.name AS round_name, ro.period, ro.status AS round_status,
                ro.schema_json, ro.created_at, r.evaluator_kind, r.answers_json
           FROM assessment_responses r
           JOIN assessment_rounds ro ON ro.id = r.round_id
          WHERE r.subject_user_id = ? AND r.status = 'submitted' AND ro.status IN ('open', 'closed')
          ORDER BY ro.created_at DESC, r.id`,
      )
      .bind(userId)
      .all<{
        round_id: number;
        round_name: string;
        period: string;
        round_status: string;
        schema_json: string;
        created_at: string;
        evaluator_kind: 'self' | 'senior';
        answers_json: string;
      }>(),
    db
      .prepare(`SELECT id, period, updated_at FROM pgp_plans WHERE user_id = ? ORDER BY period DESC LIMIT 12`)
      .bind(userId)
      .all<{ id: number; period: string; updated_at: string }>(),
  ]);

  // Үнэлгээ — round тус бүрд self + senior[] → нийт хувь ба түвшин.  Admin
  // тул хувь харна (ажилтны /my/results зөвхөн түвшин буцаадаг нь өөр хил).
  const byRound = new Map<
    number,
    { round_id: number; round_name: string; period: string; round_status: string; schema_json: string; self: AssessmentAnswers | null; senior: AssessmentAnswers[] }
  >();
  for (const r of assessRes.results ?? []) {
    const b = byRound.get(r.round_id) ?? {
      round_id: r.round_id,
      round_name: r.round_name,
      period: r.period,
      round_status: r.round_status,
      schema_json: r.schema_json,
      self: null,
      senior: [],
    };
    const answers = parseAnswers(r.answers_json);
    if (r.evaluator_kind === 'self') b.self = answers;
    else b.senior.push(answers);
    byRound.set(r.round_id, b);
  }
  const assessments = [...byRound.values()].map((b) => {
    const schema = parseSchema(b.schema_json) ?? EMPTY_SCHEMA;
    const total = scoreAssessment(schema, { self: b.self, senior: b.senior });
    const selfOnly = b.self ? scoreAssessment(schema, { self: b.self, senior: null }) : null;
    const seniorOnly = b.senior.length ? scoreAssessment(schema, { self: null, senior: b.senior }) : null;
    return {
      round_id: b.round_id,
      round_name: b.round_name,
      period: b.period,
      round_status: b.round_status,
      overall_pct: total.overallPct == null ? null : Math.round(total.overallPct * 10) / 10,
      level: total.overallLevel ? { code: total.overallLevel.code, label: total.overallLevel.label, color: total.overallLevel.color } : null,
      self_pct: selfOnly?.overallPct == null ? null : Math.round(selfOnly.overallPct * 10) / 10,
      senior_pct: seniorOnly?.overallPct == null ? null : Math.round(seniorOnly.overallPct * 10) / 10,
      senior_count: b.senior.length,
    };
  });

  return c.json({
    user: { ...user, teams: (teamsRes.results ?? []).map((t) => ({ ...t, is_primary: t.is_primary === 1 })) },
    hr: hrOut(hr),
    assessments,
    pgp: pgpRes.results ?? [],
    contract_types: CONTRACT_TYPES,
  });
});

function parseAnswers(json: string | null | undefined): AssessmentAnswers {
  try {
    const parsed = JSON.parse(json || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: AssessmentAnswers = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const HR_TEXT_FIELDS = ['contract_no', 'pc_username', 'pc_password', 'phone', 'notes'] as const;
const HR_DATE_FIELDS = ['hired_at', 'probation_end', 'contract_start', 'contract_end'] as const;

/** null/хоосон → null; бусад нь таслагдсан string (≤ max). */
function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

reports.put('/employees/:id/hr', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ error: 'Invalid id' }, 400);
  const db = c.env.DB;
  const user = await loadUserBasic(db, userId);
  if (!user) return c.json({ error: 'User not found' }, 404);

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const patch: Record<string, string | null> = {};
  for (const f of HR_DATE_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    if (v === null || v === '') {
      patch[f] = null;
      continue;
    }
    if (!isIsoDate(v)) return c.json({ error: `${f}: YYYY-MM-DD хэлбэртэй байх ёстой` }, 400);
    patch[f] = v;
  }
  for (const f of HR_TEXT_FIELDS) {
    if (!(f in body)) continue;
    const v = cleanText(body[f], f === 'notes' ? 4000 : 200);
    if (v === undefined) return c.json({ error: `${f}: буруу утга` }, 400);
    patch[f] = v;
  }
  if ('contract_type' in body) {
    const v = body.contract_type;
    if (v === null || v === '') patch.contract_type = null;
    else if (typeof v === 'string' && (CONTRACT_TYPES as readonly string[]).includes(v)) patch.contract_type = v;
    else return c.json({ error: 'contract_type: буруу төрөл', allowed: CONTRACT_TYPES }, 400);
  }

  const existing = await loadHr(db, userId);
  const start = patch.contract_start !== undefined ? patch.contract_start : existing?.contract_start ?? null;
  const end = patch.contract_end !== undefined ? patch.contract_end : existing?.contract_end ?? null;
  if (start && end && end < start) {
    return c.json({ error: 'Гэрээний дуусах огноо эхлэхээс өмнө байж болохгүй' }, 400);
  }

  const keys = Object.keys(patch);
  if (keys.length === 0 && existing) return c.json({ hr: hrOut(existing) });

  const cols = ['user_id', ...keys, 'updated_at', 'updated_by'];
  const placeholders = cols.map((k) => (k === 'updated_at' ? "datetime('now')" : '?')).join(', ');
  const updates = [...keys.map((k) => `${k} = excluded.${k}`), "updated_at = datetime('now')", 'updated_by = excluded.updated_by'];
  await db
    .prepare(
      `INSERT INTO employee_hr (${cols.join(', ')}) VALUES (${placeholders})
       ON CONFLICT(user_id) DO UPDATE SET ${updates.join(', ')}`,
    )
    .bind(userId, ...keys.map((k) => patch[k] ?? null), c.get('user').sub)
    .run();

  return c.json({ hr: hrOut(await loadHr(db, userId)) });
});

/* ---- Гэрээний PDF — ХУВИЙН bucket, `hr/` угтвар.  ХОЁР төрөл (эзний
 *      хүсэлт 2026-09-16): `employment` = Хөдөлмөрийн гэрээ (хуучин
 *      contract_file_* багана), `nda` = Нууцлалын гэрээ (0320-ийн nda_file_*).
 *      Ижил route, `:kind` параметрээр л ялгана — багана нь хүснэгтээс. ---- */

type ContractKind = 'employment' | 'nda';
const CONTRACT_KINDS: readonly ContractKind[] = ['employment', 'nda'];
const CONTRACT_COLS: Record<ContractKind, { key: string; name: string; size: string; at: string; fallback: string }> = {
  employment: {
    key: 'contract_file_key',
    name: 'contract_file_name',
    size: 'contract_file_size',
    at: 'contract_uploaded_at',
    fallback: 'contract.pdf',
  },
  nda: { key: 'nda_file_key', name: 'nda_file_name', size: 'nda_file_size', at: 'nda_uploaded_at', fallback: 'nda.pdf' },
};

function parseKind(raw: string | undefined): ContractKind | null {
  return (CONTRACT_KINDS as readonly string[]).includes(raw ?? '') ? (raw as ContractKind) : null;
}

function fileOf(hr: HrRow | null, kind: ContractKind): { key: string | null; name: string | null } {
  if (!hr) return { key: null, name: null };
  return kind === 'nda'
    ? { key: hr.nda_file_key, name: hr.nda_file_name }
    : { key: hr.contract_file_key, name: hr.contract_file_name };
}

function isPdf(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes.slice(0, 5));
  return head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46; // %PDF
}

reports.post('/employees/:id/contract-file/:kind', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ error: 'Invalid id' }, 400);
  const kind = parseKind(c.req.param('kind'));
  if (!kind) return c.json({ error: 'Гэрээний төрөл: employment | nda' }, 400);
  const db = c.env.DB;
  const user = await loadUserBasic(db, userId);
  if (!user) return c.json({ error: 'User not found' }, 404);

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'file талбар байхгүй' }, 400);
  if (file.size > CONTRACT_MAX_BYTES) return c.json({ error: 'Файл 20 MB-аас том' }, 413);
  const bytes = await file.arrayBuffer();
  if (!isPdf(bytes)) return c.json({ error: 'Зөвхөн PDF' }, 400);

  const cols = CONTRACT_COLS[kind];
  const rand = crypto.randomUUID().slice(0, 8);
  const key = `hr/${userId}-${kind}-${Date.now()}-${rand}.pdf`;
  await c.env.MEETING_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { user_id: String(userId), kind, uploaded_by: String(c.get('user').sub) },
  });

  const existing = await loadHr(db, userId);
  const prevKey = fileOf(existing, kind).key;
  const name = (file.name || cols.fallback).slice(0, 200);
  // Баганын нэр CONTRACT_COLS-оос (тогтмол жагсаалт), хэрэглэгчийн оролт биш.
  await db
    .prepare(
      `INSERT INTO employee_hr (user_id, ${cols.key}, ${cols.name}, ${cols.size}, ${cols.at}, updated_at, updated_by)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?)
       ON CONFLICT(user_id) DO UPDATE SET
         ${cols.key} = excluded.${cols.key}, ${cols.name} = excluded.${cols.name},
         ${cols.size} = excluded.${cols.size}, ${cols.at} = excluded.${cols.at},
         updated_at = datetime('now'), updated_by = excluded.updated_by`,
    )
    .bind(userId, key, name, file.size, c.get('user').sub)
    .run();

  // Хуучин файлыг DB шинэчлэгдсэний ДАРАА устгана (амжилтгүй бол orphan л үлдэнэ).
  if (prevKey && prevKey !== key) {
    c.executionCtx.waitUntil(c.env.MEETING_BUCKET.delete(prevKey).catch(() => {}));
  }
  return c.json({ hr: hrOut(await loadHr(db, userId)) });
});

reports.get('/employees/:id/contract-file/:kind', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ error: 'Invalid id' }, 400);
  const kind = parseKind(c.req.param('kind'));
  if (!kind) return c.json({ error: 'Гэрээний төрөл: employment | nda' }, 400);
  const f = fileOf(await loadHr(c.env.DB, userId), kind);
  if (!f.key) return c.json({ error: 'File not found' }, 404);
  return streamPrivateObject(c.env, f.key, f.name ?? CONTRACT_COLS[kind].fallback, 'application/pdf', { inline: true });
});

reports.delete('/employees/:id/contract-file/:kind', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ error: 'Invalid id' }, 400);
  const kind = parseKind(c.req.param('kind'));
  if (!kind) return c.json({ error: 'Гэрээний төрөл: employment | nda' }, 400);
  const db = c.env.DB;
  const f = fileOf(await loadHr(db, userId), kind);
  if (!f.key) return c.json({ error: 'File not found' }, 404);
  const cols = CONTRACT_COLS[kind];
  await db
    .prepare(
      `UPDATE employee_hr SET ${cols.key} = NULL, ${cols.name} = NULL, ${cols.size} = NULL, ${cols.at} = NULL,
              updated_at = datetime('now'), updated_by = ? WHERE user_id = ?`,
    )
    .bind(c.get('user').sub, userId)
    .run();
  c.executionCtx.waitUntil(c.env.MEETING_BUCKET.delete(f.key).catch(() => {}));
  return c.json({ hr: hrOut(await loadHr(db, userId)) });
});

/* ------------------------------------------------------------------ */
/*  Google Sheets экспорт — хөтөч .xlsx угсарч илгээнэ, Drive хөрвүүлнэ  */
/* ------------------------------------------------------------------ */

/**
 * Тайлангийн workbook-ийг ХӨТӨЧ угсардаг (exceljs аль хэдийн бандлагдсан,
 * дэлгэц дээрх тоо = хуудсан дээрх тоо).  Сервер зөвхөн байтыг Drive руу
 * `convertTo: spreadsheet`-ээр илгээж, домэйнд хуваалцаад холбоос буцаана —
 * `documentOfficeRoutes.ts`-ийн ижил Gmail-OAuth токен, ижил алдааны зураглал.
 * Файл нь `DOCS_DRIVE_FOLDER_ID` хавтсанд (өгвөл) үүснэ.
 */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const GSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const EXPORT_MAX_BYTES = 10 * 1024 * 1024;

reports.post('/employees/:id/export/google-sheet', async (c) => {
  const userId = parseId(c.req.param('id'));
  if (userId === null) return c.json({ error: 'Invalid id' }, 400);
  const user = await loadUserBasic(c.env.DB, userId);
  if (!user) return c.json({ error: 'User not found' }, 404);

  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return c.json({ error: 'file талбар байхгүй' }, 400);
  if (file.size > EXPORT_MAX_BYTES) return c.json({ error: 'Файл 10 MB-аас том' }, 413);
  const nameField = form.get('name');
  const name = (typeof nameField === 'string' && nameField.trim() ? nameField : file.name || 'report').slice(0, 200);

  try {
    const created = await driveUpload(c.env, {
      name: name.replace(/\.xlsx$/i, ''),
      bytes: await file.arrayBuffer(),
      sourceMime: XLSX_MIME,
      convertTo: GSHEET_MIME,
    });
    let shared: 'domain' | 'link' | null = null;
    try {
      shared = await driveShare(c.env, created.id);
    } catch (err) {
      // Хуваалцах эрх байхгүй байсан ч файл үүссэн — холбоосыг буцаана.
      console.error('report sheet share failed', err);
    }
    return c.json({
      id: created.id,
      name: created.name ?? name,
      url: `https://docs.google.com/spreadsheets/d/${created.id}/edit`,
      shared,
    });
  } catch (err) {
    const r = driveErrorResponse(err);
    return c.json({ error: r.error }, r.status);
  }
});

function driveErrorResponse(err: unknown): { status: 500 | 503; error: string } {
  if (err instanceof DriveNotConfigured) return { status: 503, error: err.message };
  if (err instanceof DriveApiError) {
    if (isScopeError(err)) {
      return {
        status: 503,
        error:
          'Google-ийн зөвшөөрөл дутуу байна (Drive-ын эрх олгогдоогүй). Админ → И-мэйл ' +
          'хайрцгууд хуудасны «Google хаяг холбох» картаар дахин холбож, Drive-ын ' +
          'зөвшөөрлийг өгнө үү.',
      };
    }
    if (err.reason === 'storageQuotaExceeded') {
      return { status: 503, error: 'Холбогдсон Google хаягийн Drive-ын багтаамж дүүрсэн байна.' };
    }
    console.error('report sheet drive call failed', err.status, err.reason, err.message);
    return {
      status: 503,
      error: `Google Drive алдаа (${err.status}${err.reason ? ` ${err.reason}` : ''}). ${err.message.slice(0, 200)}`,
    };
  }
  console.error('report sheet export failed', err);
  return { status: 500, error: err instanceof Error ? err.message : 'Экспорт амжилтгүй' };
}

export default reports;
