/**
 * Ажилтны ӨДРИЙН АВТОМАТ snapshot — `employee_daily_snapshots` (миграц 0310).
 *
 * Ямар асуудлыг шийддэг вэ: бүтээмжийн самбарын БАЙР хэзээ ч хадгалагддаггүй,
 * `ORDER BY SUM(user_points.amount)`-ийн индекс л байдаг.  «7 хоногийн өмнө
 * хэддүгээрт байсан бэ, дээшилсэн үү» гэдэг асуултад хариулахын тулд өдөр
 * бүрийн байрыг бичиж үлдээх ёстой — `recalculateProjectPoints` ledger-ийг
 * дахин бичдэг тул дараа нь сэргээх нь найдвартай биш.
 *
 * Хоёр орох цэг:
 *   • `runEmployeeSnapshot(env)` — cron (index.ts-ийн fail-safe салаа).  ШИНЭ
 *     cron илэрхийлэл НЭМЭЭГҮЙ (wrangler.toml-д таарахгүй илэрхийлэл нэмбэл
 *     Gmail/meeting/calendar/deadline дөрвөл давхар ажиллана — CLAUDE.md).
 *     `deadlineSweep.ts`-тэй ижил өөрийгөө хаах хэв маяг: УБ 02:00-аас хойш,
 *     `app_settings.employee_snapshot_last_date`-ийг ЭХЛЭЭД эзэмшээд
 *     ӨЧИГДРИЙГ (болон дутуу үлдсэн ≤14 өдрийг) бичнэ.
 *   • `snapshotDay(db, date, source)` — нэг өдрийг бодож бичнэ; backfill ч
 *     (POST /api/reports/snapshots/backfill) яг үүнийг дуудна.
 *
 * ЯАГААД өчигдрийг 02:00-д: 22:00–23:30-ын гарах бүртгэл, оройн батлалт бүгд
 * хаагдсан; УБ өдрийн UTC муж ([d−1 16:00, d 16:00)) бүтэн өнгөрсөн; нээлттэй
 * session-ийн «ажилласан цаг» тодорхойгүй байх асуудал байхгүй.
 *
 * ЭЗЭМШИЛ-ЭХЛЭЭД семантик (репогийн конвенц): нэг өдөр унавал автоматаар
 * дахин оролдохгүй — давхардал цоорхойноос дор.  `GET /snapshots/status`-ийн
 * `missing_days_30` дутууг ил гаргаж, админ «Нөхөх» товчоор backfill хийнэ.
 */
import type { Env } from '../types';
import { todayInUB } from './time';
import { orgConfig } from './orgConfig';
import { getCeoOnLeaderboard, isLeaderboardEligibleUser } from './ceo';
import { LATE_NOT_WAIVED_SQL } from './leaveWaiver';
import { isWeekend } from './workSchedule';
import { isHoliday } from './holidays';
import { isoAddDays, orgUtcOffsetMinutes, ubDayBoundsUtc } from './reportWindows';
import { rankWithTies } from './reportTrend';
import { loadLeaveNeutral } from './leaveAvailability';

export const SNAPSHOT_KEY = 'employee_snapshot_last_date';
const MIN_HOUR = 2;
const MAX_DAYS_PER_RUN = 14;
/** D1 batch нь transaction — хэсэгчлэн явуулж нэг мөрийн алдаа бүхнийг унагаахаас сэргийлнэ. */
const UPSERT_CHUNK = 25;

export type SnapshotSource = 'cron' | 'backfill';

export interface SnapshotRow {
  user_id: number;
  date: string;
  points_day: number;
  points_7d: number;
  points_30d: number;
  rank_7d: number | null;
  rank_30d: number | null;
  pool_size: number | null;
  entries_count: number;
  tasks_touched: number;
  tasks_completed: number;
  repair_hours: number;
  present: number;
  hours_worked: number;
  late_minutes: number;
  on_leave: number;
  is_free_day: number;
  team_id: number | null;
  source: string;
  computed_at: string;
}

/** УБ-ийн одоогийн цаг (0-23) — deadlineSweep.ts-ийн ижил хэрэгжүүлэлт. */
function currentHourInOrgTz(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: orgConfig().timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const raw = parts.find((p) => p.type === 'hour')?.value ?? '';
  const hour = Number.parseInt(raw, 10);
  return Number.isFinite(hour) ? hour : -1;
}

export async function runEmployeeSnapshot(env: Env): Promise<void> {
  const db = env.DB;
  if (currentHourInOrgTz() < MIN_HOUR) return;

  const target = isoAddDays(todayInUB(), -1);
  let last: string | null = null;
  try {
    const row = await db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .bind(SNAPSHOT_KEY)
      .first<{ value: string }>();
    last = row?.value || null;
    if (last && last >= target) return;

    // Өдрийг АЖИЛ ЭХЛЭХЭЭС ӨМНӨ эзэмшинэ (updated_by NULL — cron-ы ард хэрэглэгч байхгүй).
    await db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), NULL)
         ON CONFLICT(key) DO UPDATE SET
           value      = excluded.value,
           updated_at = datetime('now')`,
      )
      .bind(SNAPSHOT_KEY, target)
      .run();
  } catch (err) {
    console.error('employee-snapshot claim failed', err);
    return;
  }

  // Дутуу үлдсэн өдрүүдийг (≤14) хуучнаас шинэ рүү.  Анхны ажиллуулалтад
  // (last байхгүй) зөвхөн өчигдрийг — түүхийг админ backfill-ээр нөхнө.
  let start = last ? isoAddDays(last, 1) : target;
  if (start > target) start = target;
  const span = Math.round(
    (new Date(`${target}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (span + 1 > MAX_DAYS_PER_RUN) start = isoAddDays(target, -(MAX_DAYS_PER_RUN - 1));

  for (let d = start; d <= target; d = isoAddDays(d, 1)) {
    try {
      await snapshotDay(db, d, 'cron');
    } catch (err) {
      console.error('employee-snapshot day failed', d, err);
      return;
    }
  }
}

interface RosterRow {
  id: number;
  role: string;
  is_support: number;
  team_id: number | null;
}

/**
 * Нэг УБ өдрийн snapshot-ыг бодож `employee_daily_snapshots`-д upsert хийнэ.
 * Идемпотент — ижил өдрийг дахин дуудахад мөр ДАХИН бичигдэнэ (source шинэчлэгдэнэ).
 * ~9 D1 дуудлага + roster/25 batch.
 */
export async function snapshotDay(
  db: D1Database,
  date: string,
  source: SnapshotSource,
): Promise<{ users: number; members: number }> {
  const offset = orgUtcOffsetMinutes(new Date(`${date}T12:00:00Z`));
  const day = ubDayBoundsUtc(date, date, offset);
  const d7 = ubDayBoundsUtc(isoAddDays(date, -6), date, offset);
  const d30 = ubDayBoundsUtc(isoAddDays(date, -29), date, offset);
  const includeCeo = await getCeoOnLeaderboard(db);

  // 7/30 хоногийн оноо + байр нь ажилласан өдрөөр (lib/leaveAvailability.ts) —
  // reports.ts-ийн «одоогийн байр»-тай ижил дүрэм, эс тэгвэл «7 хоногийн өмнөх
  // байр»-тай харьцуулалт чөлөөтэй хүнд худлаа өсөлт/уналт харуулна.
  const [rosterRes, pointsRes, progressRes, repairRes, attRes, leaveRes, holiday, neutral] =
    await Promise.all([
      // 1. Roster — идэвхтэй ажилтан (client/worker-гүй), үндсэн баг.
      db
        .prepare(
          `SELECT u.id, u.role, u.is_support, ut.team_id
             FROM users u
             LEFT JOIN user_teams ut ON ut.user_id = u.id AND ut.is_primary = 1
            WHERE u.status = 'active' AND u.role NOT IN ('client', 'worker')`,
        )
        .all<RosterRow>(),
      // 2. Оноо — ГАНЦ range scan (idx user_points(awarded_at)), 30 хоног.
      db
        .prepare(
          `SELECT user_id,
                  SUM(CASE WHEN awarded_at >= ? THEN amount ELSE 0 END) AS points_day,
                  SUM(CASE WHEN awarded_at >= ? THEN amount ELSE 0 END) AS points_7d,
                  SUM(amount) AS points_30d
             FROM user_points
            WHERE awarded_at >= ? AND awarded_at < ?
            GROUP BY user_id`,
        )
        .bind(day.startUtc, d7.startUtc, d30.startUtc, day.endUtcExclusive)
        .all<{ user_id: number; points_day: number; points_7d: number; points_30d: number }>(),
      // 3. Явцын бичлэг (УБ огноо).
      db
        .prepare(
          `SELECT user_id,
                  COUNT(*) AS entries,
                  COUNT(DISTINCT task_id) AS tasks,
                  SUM(CASE WHEN percentage >= 100 THEN 1 ELSE 0 END) AS completed
             FROM progress_entries
            WHERE date = ? AND status = 'approved' AND COALESCE(source, '') <> 'alloc_adj'
            GROUP BY user_id`,
        )
        .bind(date)
        .all<{ user_id: number; entries: number; tasks: number; completed: number }>(),
      // 4. Засварын цаг.
      db
        .prepare(`SELECT user_id, SUM(hours) AS hours FROM repair_entries WHERE date = ? GROUP BY user_id`)
        .bind(date)
        .all<{ user_id: number; hours: number }>(),
      // 5. Ирц — хоцролт нь чөлөө/гадуур ажлаар хасагдаагүй л тооцогдоно.
      db
        .prepare(
          `SELECT a.user_id,
                  COALESCE(SUM(a.hours_worked), 0) AS hours,
                  COALESCE(MAX(CASE WHEN ${LATE_NOT_WAIVED_SQL} THEN a.late_minutes ELSE 0 END), 0) AS late,
                  SUM(CASE WHEN a.clock_out IS NULL THEN 1 ELSE 0 END) AS open_sessions
             FROM attendance_sessions a
            WHERE a.date = ?
            GROUP BY a.user_id`,
        )
        .bind(date)
        .all<{ user_id: number; hours: number; late: number; open_sessions: number }>(),
      // 6. Батлагдсан чөлөө.
      db
        .prepare(
          `SELECT DISTINCT user_id FROM leave_requests
            WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`,
        )
        .bind(date, date)
        .all<{ user_id: number }>(),
      // 7. Нийтийн амралт.
      isHoliday(db, date),
      // 8. Чөлөөний залруулга (0: 7 хоног, 1: 30 хоног).
      loadLeaveNeutral(db, {
        ranges: [
          { from: isoAddDays(date, -6), to: date },
          { from: isoAddDays(date, -29), to: date },
        ],
      }),
    ]);

  const roster = rosterRes.results ?? [];
  const points = new Map<number, { day: number; d7: number; d30: number }>();
  for (const r of pointsRes.results ?? [])
    points.set(r.user_id, { day: r.points_day ?? 0, d7: r.points_7d ?? 0, d30: r.points_30d ?? 0 });
  for (const u of rosterRes.results ?? []) {
    const d7 = neutral.delta(u.id, 0);
    const d30 = neutral.delta(u.id, 1);
    if (d7 === 0 && d30 === 0) continue;
    const p = points.get(u.id) ?? { day: 0, d7: 0, d30: 0 };
    points.set(u.id, { day: p.day, d7: p.d7 + d7, d30: p.d30 + d30 });
  }
  const progress = new Map<number, { entries: number; tasks: number; completed: number }>();
  for (const r of progressRes.results ?? [])
    progress.set(r.user_id, { entries: r.entries ?? 0, tasks: r.tasks ?? 0, completed: r.completed ?? 0 });
  const repair = new Map<number, number>();
  for (const r of repairRes.results ?? []) repair.set(r.user_id, r.hours ?? 0);
  const att = new Map<number, { hours: number; late: number; open: number }>();
  for (const r of attRes.results ?? [])
    att.set(r.user_id, { hours: r.hours ?? 0, late: r.late ?? 0, open: r.open_sessions ?? 0 });
  const onLeave = new Set((leaveRes.results ?? []).map((r) => r.user_id));
  const freeDay = isWeekend(date) || holiday ? 1 : 0;

  // 8. Байр — зөвхөн самбарын гишүүдийн дунд (leaderboard.ts-тэй ижил шүүлт).
  const members = roster.filter(
    (u) => u.is_support === 0 && isLeaderboardEligibleUser(u.role, u.id, includeCeo),
  );
  const score30 = (u: RosterRow) => points.get(u.id)?.d30 ?? 0;
  const score7 = (u: RosterRow) => points.get(u.id)?.d7 ?? 0;
  const rank30 = rankWithTies(members, score30);
  const rank7 = rankWithTies(members, score7);
  const pool = members.length;

  // 9. Upsert — 20 bind/statement, 25 statement/batch.
  const stmt = db.prepare(
    `INSERT INTO employee_daily_snapshots
       (user_id, date, points_day, points_7d, points_30d, rank_7d, rank_30d, pool_size,
        entries_count, tasks_touched, tasks_completed, repair_hours,
        present, hours_worked, late_minutes, on_leave, is_free_day, team_id, source, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, date) DO UPDATE SET
       points_day = excluded.points_day, points_7d = excluded.points_7d, points_30d = excluded.points_30d,
       rank_7d = excluded.rank_7d, rank_30d = excluded.rank_30d, pool_size = excluded.pool_size,
       entries_count = excluded.entries_count, tasks_touched = excluded.tasks_touched,
       tasks_completed = excluded.tasks_completed, repair_hours = excluded.repair_hours,
       present = excluded.present, hours_worked = excluded.hours_worked, late_minutes = excluded.late_minutes,
       on_leave = excluded.on_leave, is_free_day = excluded.is_free_day, team_id = excluded.team_id,
       source = excluded.source, computed_at = excluded.computed_at`,
  );

  const statements = roster.map((u) => {
    const p = points.get(u.id);
    const pr = progress.get(u.id);
    const a = att.get(u.id);
    const isMember = rank30.has(u);
    return stmt.bind(
      u.id,
      date,
      // Оноо 4 орноор — 1 орны дугуйлалт өдрийн 0.0x оноог бүгдийг 0 болгож байсан (2026-09-16).
      roundPts(p?.day ?? 0),
      roundPts(p?.d7 ?? 0),
      roundPts(p?.d30 ?? 0),
      isMember ? (rank7.get(u) ?? null) : null,
      isMember ? (rank30.get(u) ?? null) : null,
      isMember ? pool : null,
      pr?.entries ?? 0,
      pr?.tasks ?? 0,
      pr?.completed ?? 0,
      round1(repair.get(u.id) ?? 0),
      a ? 1 : 0,
      // Нээлттэй session байвал ажилласан цаг тодорхойгүй → 0 (attendance.ts-ийн isDayClosed дүрэм).
      a && a.open === 0 ? round1(a.hours) : 0,
      a?.late ?? 0,
      onLeave.has(u.id) ? 1 : 0,
      freeDay,
      u.team_id,
      source,
    );
  });

  for (let i = 0; i < statements.length; i += UPSERT_CHUNK) {
    await db.batch(statements.slice(i, i + UPSERT_CHUNK));
  }

  return { users: roster.length, members: pool };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundPts(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Хоцорсон оноо/залруулгын дараа: ажлын өдөр (D) … min(D + 29, өчигдөр) мужид АЛЬ ХЭДИЙН бичигдсэн өдрийн
 * snapshot-уудыг (7/30 хоногийн оноо, байр) дахин бодно — cron зөвхөн өчигдрийг бичдэг тул тэд энэ өөрчлөлтийг
 * агуулаагүй.  D + 29-өөс хойш 30 хоногийн цонхонд орохгүй тул нөлөөгүй.  Snapshot-гүй өдрийг ҮҮСГЭХГҮЙ (тайлан
 * тэнд live тооцоо руу буудаг).  `snapshotDay` идемпотент (upsert).  `nonProjectWorkReview.ts`-ийн жишгийг
 * энд гаргасан — таскийн хуваарилалтын залруулга (оноог анхны өдөрт нь буцаах) мөн хэрэглэнэ.
 */
export async function refreshSnapshotsAfter(db: D1Database, workDate: string): Promise<void> {
  const yesterday = isoAddDays(todayInUB(), -1);
  const lastAffected = isoAddDays(workDate, 29);
  const to = lastAffected < yesterday ? lastAffected : yesterday;
  if (workDate > to) return;
  const { results } = await db
    .prepare(`SELECT DISTINCT date FROM employee_daily_snapshots WHERE date BETWEEN ? AND ? ORDER BY date`)
    .bind(workDate, to)
    .all<{ date: string }>();
  for (const r of results ?? []) await snapshotDay(db, r.date, 'backfill');
}
