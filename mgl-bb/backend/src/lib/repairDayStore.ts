/**
 * Засварын цагийн АВТОМАТ хуваарилалтын D1 давхарга (миграц 0348).
 *
 * Дүрэм нь `repairDay.ts`-д (цэвэр, тесттэй).  Энд:
 *   • `syncRepairDay` — нэг хүний нэг өдрийн бөглөлтүүдийг уншаад, засварын
 *     тэмдэглэгээ (`repair_marks`) бүрийн цагийг `repair_entries`-ийн
 *     auto/backfill мөр болгож бичнэ; оноотой тэмдэглэгээнд `user_points`
 *     (source='repair').  Идемпотент — хэдэн ч удаа дуудаж болно, өдрийн
 *     бөглөлт өөрчлөгдөх бүрд (тэмдэглэх/болих, хувь бөглөх, төслийн бус
 *     ажил) дахин дуудагдана.
 *   • `createLiveMark` / `deleteMark` — ажилтны «өнөөдөр ажилласан» товч.
 *   • `runHoursBackfill` — 0348-аас өмнө ZA таск дээр ХУВИАР бөглөсөн өдрүүдийг
 *     цаг болгож нөхнө (эзний шийдвэр: «хүн бүрийн цагийг detect хийж оруул»).
 *     Тэр бөглөлт аль хэдийн оноо авсан тул нөхсөн тэмдэглэгээ ОНООГҮЙ
 *     (`award_points = 0`) — зөвхөн цаг ба төслийн явц.
 *
 * ⚠️ `repair_entries.hours` нь CHECK(hours > 0) — 0 цаг ногдсон тэмдэглэгээ
 *    мөргүй үлдэнэ (тэмдэглэгээ өөрөө `repair_marks`-д байгаа тул алга
 *    болохгүй; ирцийн «гарах» хаалт ч `repair_marks`-ийг тоолно).
 * ⚠️ D1 нэг дуудлагад ≤1000 асуулга — нөхөлт нь хэсэгчилсэн (`maxDays`).
 */
import type { Env } from '../types';
import { getAttendanceSettings, type AttendanceSettings } from './settings';
import { shiftForUser } from './specialShift';
import { getScheduleAssignments } from './scheduleStore';
import { orgUtcOffsetMinutes, toSqliteUtc } from './reportWindows';
import { leaderboardMemberSql } from './ceo';
import { baseDailyRate, pctForHours, WORK_DAY_HOURS } from './repairProgress';
import {
  allocateDay,
  hhmmToMinutes,
  minutesIntoDay,
  repairItemKey,
  roundHoursPreservingTotal,
  type DayEvent,
  type DayWindow,
  type Interval,
} from './repairDay';
import type { ScheduleKey } from './workSchedule';

export interface RepairMarkRow {
  id: number;
  user_id: number;
  date: string;
  project_id: number | null;
  repair_project_id: number | null;
  task_id: number | null;
  marked_at: string;
  award_points: number;
  progress_entry_id: number | null;
  daily_rate: number;
  rate_source: string | null;
  progress_rate: number;
  progress_rate_source: string | null;
}

export interface MarkTarget {
  project_id: number | null;
  repair_project_id: number | null;
  task_id: number | null;
}

/** Нөхөлт дууссаныг тэмдэглэх `app_settings` түлхүүр (`'done'`).  Төсөл цагаар
 *  шилжих бүрд устгагдаж дахин асна (routes/projects.ts). */
export const HOURS_BACKFILL_KEY = 'repair.hours_backfill';
/** Cron-ын нэг удаад нөхөх ажилтан-өдөр — бусад cron ажилтай ≤1000 асуулгын
 *  хязгаарыг хуваалцдаг тул бага.  Админы товч нэг дуудлагад илүүг хийнэ.
 *  Хэмжсэн (09-24-ний продын хуулбар, 742 ажилтан-өдөр): ≈35 асуулга/өдөр —
 *  25 өдөр нэг дуудлагад 863 асуулга болж хязгаарт хэт ойртсон тул 15. */
export const CRON_BACKFILL_DAYS = 4;
export const ENDPOINT_BACKFILL_DAYS = 15;

const offsetOf = (date: string) => orgUtcOffsetMinutes(new Date(`${date}T12:00:00Z`));

/** Байгууллагын өдрийн эхлэл (УБ 00:00) UTC-ээр — нөхөлтийн «тэр өдрөөс
 *  ӨМНӨ мэдэгдэж байсан» ханшийн хил. */
export function dayStartUtc(date: string): string {
  return toSqliteUtc(new Date(Date.parse(`${date}T00:00:00Z`) - offsetOf(date) * 60_000));
}

/* ------------------------------------------------------------------ */
/*  Өдрийн өгөгдөл                                                     */
/* ------------------------------------------------------------------ */

/** Ээлж + цай + засварт тооцохгүй хугацаа (төслийн бус ажил, цагийн чөлөө). */
export async function loadDayWindow(
  db: D1Database,
  userId: number,
  date: string,
  settings?: AttendanceSettings,
): Promise<DayWindow> {
  const [userRow, assignments, attSettings, npRes, leaveRes] = await Promise.all([
    db.prepare(`SELECT work_schedule FROM users WHERE id = ?`).bind(userId).first<{ work_schedule: ScheduleKey | null }>(),
    getScheduleAssignments(db, userId),
    settings ? Promise.resolve(settings) : getAttendanceSettings(db),
    db
      .prepare(
        `SELECT start_time, end_time FROM non_project_work_entries
          WHERE user_id = ? AND date = ? AND status <> 'rejected'`,
      )
      .bind(userId, date)
      .all<{ start_time: string | null; end_time: string | null }>(),
    // Нэг өдрийн, цагтай, батлагдсан чөлөө.  'remote' нь чөлөө биш (ажилласан).
    db
      .prepare(
        `SELECT start_time, end_time, hours FROM leave_requests
          WHERE user_id = ? AND status = 'approved' AND start_date = ? AND end_date = ?
            AND start_time IS NOT NULL AND COALESCE(leave_type, '') <> 'remote'`,
      )
      .bind(userId, date, date)
      .all<{ start_time: string; end_time: string | null; hours: number | null }>(),
  ]);
  const shift = shiftForUser(userId, userRow?.work_schedule ?? null, date, assignments);
  const ls = hhmmToMinutes(attSettings.lunchStart);
  const le = hhmmToMinutes(attSettings.lunchEnd);
  const lunch = attSettings.lunchEnabled && ls !== null && le !== null && le > ls ? { start: ls, end: le } : null;
  const blocked: Interval[] = [];
  // Цаггүй мөр (ирцэд сонгосон, 0356/0357) зөвхөн хяналт тул хаахгүй — ажилтан
  // «Миний ажлууд»-аас цагаа оруулахад л тэр муж засвараас гарна.
  for (const r of npRes.results ?? []) {
    const s = hhmmToMinutes(r.start_time);
    const e = hhmmToMinutes(r.end_time);
    if (s !== null && e !== null && e > s) blocked.push({ start: s, end: e });
  }
  for (const r of leaveRes.results ?? []) {
    const s = hhmmToMinutes(r.start_time);
    if (s === null) continue;
    const e = hhmmToMinutes(r.end_time) ?? (Number(r.hours) > 0 ? s + Number(r.hours) * 60 : null);
    if (e !== null && e > s) blocked.push({ start: s, end: e });
  }
  return { start: shift.startMinutes, end: shift.endMinutes, lunch, blocked };
}

export interface DayData {
  events: DayEvent[];
  marks: RepairMarkRow[];
  manualHours: number;
}

/** Өдрийн бөглөлтүүд: хувиар бөглөсөн энгийн таск + засварын тэмдэглэгээ. */
export async function loadDayData(db: D1Database, userId: number, date: string): Promise<DayData> {
  const offset = offsetOf(date);
  const [fillRes, markRes, manualRow] = await Promise.all([
    // Цагаар бодогддог төслийн таскийн ХУВИЙН бөглөлт энд ОРОХГҮЙ — тэд
    // нөхөлтөөр тэмдэглэгээ болно (`runHoursBackfill`), эс бөгөөс хоёр тоологдоно.
    // ⚠️ Жинлэсэн явцаа суурь болгон үргэлжлүүлсэн төсөл (0349, FURNITURE LAND)
    //    ҮЛДЭНЭ: түүний хуучин бөглөлт тэмдэглэгээ болохгүй ч тэр өдрийн цагаас
    //    хувиа эзэлсээр — эс тэгвэл тэр өдөр өөр засвар бөглөсөн хүнд бүтэн өдөр ногдоно.
    db
      .prepare(
        `SELECT pe.task_id, pe.created_at
           FROM progress_entries pe
           JOIN tasks t      ON t.id  = pe.task_id
           JOIN components co ON co.id = t.component_id
           JOIN drawings d   ON d.id  = co.drawing_id
           JOIN blocks b     ON b.id  = d.block_id
           JOIN projects p   ON p.id  = b.project_id
          WHERE pe.user_id = ? AND pe.date = ?
            AND COALESCE(pe.is_rest_day, 0) = 0 AND COALESCE(pe.defer_next_day, 0) = 0
            AND pe.status <> 'rejected'
            AND COALESCE(pe.source, '') <> 'alloc_adj'
            AND (p.progress_mode <> 'hours' OR p.hours_progress_base IS NOT NULL)`,
      )
      .bind(userId, date)
      .all<{ task_id: number; created_at: string | null }>(),
    db
      .prepare(`SELECT * FROM repair_marks WHERE user_id = ? AND date = ? ORDER BY marked_at, id`)
      .bind(userId, date)
      .all<RepairMarkRow>(),
    db
      .prepare(
        `SELECT COALESCE(SUM(hours), 0) AS h FROM repair_entries
          WHERE user_id = ? AND date = ? AND hours_source = 'manual'`,
      )
      .bind(userId, date)
      .first<{ h: number }>(),
  ]);
  // Цаггүй мөр (хуучин өгөгдөл) → өдрийн эцсийн суулт.
  const endOfDay = 24 * 60;
  const events: DayEvent[] = [];
  for (const f of fillRes.results ?? []) {
    events.push({ key: `n:${f.task_id}`, at: minutesIntoDay(f.created_at, date, offset) ?? endOfDay });
  }
  const marks = markRes.results ?? [];
  for (const m of marks) {
    events.push({ key: repairItemKey(m), at: minutesIntoDay(m.marked_at, date, offset) ?? endOfDay, markId: m.id });
  }
  return { events, marks, manualHours: Math.max(0, Number(manualRow?.h ?? 0)) };
}

/* ------------------------------------------------------------------ */
/*  Хуваарилалтыг бичих                                                */
/* ------------------------------------------------------------------ */

export interface SyncResult {
  /** `markId` → хадгалсан цаг (0.01 нарийвчлал). */
  hoursByMark: Map<number, number>;
  writes: number;
}

const changed = (a: number | null | undefined, b: number) => Math.abs(Number(a ?? 0) - b) > 1e-9;

/**
 * Нэг хүний нэг өдрийг ДАХИН хуваарилна.  Бичих зүйл нь зөвхөн тэмдэглэгээнээс
 * гаргасан мөр — гараар бичсэн (`manual`) мөрийг ХЭЗЭЭ Ч хөндөхгүй.
 */
export async function syncRepairDay(
  db: D1Database,
  userId: number,
  date: string,
  opts: { settings?: AttendanceSettings } = {},
): Promise<SyncResult> {
  const [window, day, existingRes] = await Promise.all([
    loadDayWindow(db, userId, date, opts.settings),
    loadDayData(db, userId, date),
    db
      .prepare(
        `SELECT re.id, re.mark_id, re.hours, re.computed_pct, re.progress_pct,
                up.id AS up_id, up.amount AS up_amount
           FROM repair_entries re
           LEFT JOIN user_points up ON up.repair_entry_id = re.id
          WHERE re.user_id = ? AND re.date = ? AND re.mark_id IS NOT NULL`,
      )
      .bind(userId, date)
      .all<{
        id: number;
        mark_id: number;
        hours: number;
        computed_pct: number;
        progress_pct: number;
        up_id: number | null;
        up_amount: number | null;
      }>(),
  ]);
  const alloc = allocateDay(window, day.events, day.manualHours);
  // Өдрийн нийлбэрийг хадгалж дугуйлна (2.67 × 3 = 8.01 биш, 8.00).
  const rounded = roundHoursPreservingTotal(
    new Map(day.marks.map((m) => [m.id, alloc.hoursByMark.get(m.id) ?? 0])),
  );
  const existing = new Map((existingRes.results ?? []).map((r) => [r.mark_id, r]));
  const markIds = new Set(day.marks.map((m) => m.id));
  const stmts: D1PreparedStatement[] = [];
  const hoursByMark = new Map<number, number>();

  const dropRow = (rowId: number) => {
    stmts.push(db.prepare(`DELETE FROM user_points WHERE repair_entry_id = ?`).bind(rowId));
    stmts.push(db.prepare(`DELETE FROM repair_entries WHERE id = ?`).bind(rowId));
  };

  for (const m of day.marks) {
    const hours = rounded.get(m.id) ?? 0;
    hoursByMark.set(m.id, hours);
    const award = m.award_points === 1;
    const computed = award ? pctForHours(m.daily_rate, hours) : 0;
    const progress = pctForHours(m.progress_rate, hours);
    const ex = existing.get(m.id);
    if (hours <= 0) {
      if (ex) dropRow(ex.id);
      continue;
    }
    if (ex) {
      if (changed(ex.hours, hours) || changed(ex.computed_pct, computed) || changed(ex.progress_pct, progress)) {
        stmts.push(
          db
            .prepare(`UPDATE repair_entries SET hours = ?, computed_pct = ?, progress_pct = ? WHERE id = ?`)
            .bind(hours, computed, progress, ex.id),
        );
      }
      if (award && ex.up_id == null) {
        stmts.push(insertPointsStmt(db, m, computed));
      } else if (award && changed(ex.up_amount, computed)) {
        stmts.push(
          db.prepare(`UPDATE user_points SET amount = ?, delta_pct = ? WHERE id = ?`).bind(computed, computed, ex.up_id),
        );
      }
      continue;
    }
    // Шинэ мөр.  `INSERT OR IGNORE` — зэрэг ажилласан хоёр sync (тэмдэглэх +
    // хувь бөглөх) нэг тэмдэглэгээнд хоёр мөр үүсгэхгүй (mark_id UNIQUE).
    stmts.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO repair_entries
             (user_id, project_id, repair_project_id, task_id, description, hours, day_hours,
              weekly_avg_pct, rate_source, computed_pct, date, created_at,
              progress_rate, progress_rate_source, progress_pct, hours_source, mark_id)
           VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          m.user_id,
          m.project_id,
          m.repair_project_id,
          m.task_id,
          hours,
          WORK_DAY_HOURS,
          award ? m.daily_rate : 0,
          award ? m.rate_source : null,
          computed,
          m.date,
          m.marked_at,
          m.progress_rate,
          m.progress_rate_source,
          progress,
          award ? 'auto' : 'backfill',
          m.id,
        ),
    );
    if (award) stmts.push(insertPointsStmt(db, m, computed));
  }
  // Тэмдэглэгээ нь устсан (эсвэл өөр өдөр рүү шилжсэн) мөр үлдэх ёсгүй.
  for (const [markId, ex] of existing) if (!markIds.has(markId)) dropRow(ex.id);

  if (stmts.length > 0) await db.batch(stmts);
  return { hoursByMark, writes: stmts.length };
}

/** Оноотой тэмдэглэгээний `user_points` мөр — байхгүй үед л (давхардахгүй).
 *  `awarded_at` = тэмдэглэсэн агшин: оноо тэр АЖЛЫН ӨДӨРТ харьяалагдана. */
function insertPointsStmt(db: D1Database, m: RepairMarkRow, computed: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO user_points
         (user_id, project_id, repair_project_id, task_id, progress_entry_id,
          amount, delta_pct, assignee_count, awarded_by, source, repair_entry_id, awarded_at)
       SELECT ?, ?, ?, NULL, NULL, ?, ?, 1, ?, 'repair', re.id, ?
         FROM repair_entries re
        WHERE re.mark_id = ?
          AND NOT EXISTS (SELECT 1 FROM user_points up WHERE up.repair_entry_id = re.id)`,
    )
    .bind(m.user_id, m.project_id, m.repair_project_id, computed, computed, m.user_id, m.marked_at, m.id);
}

/** Тухайн өдөр тэмдэглэгээтэй бол л дахин хуваарилна — хувь бөглөх, төслийн
 *  бус ажил зэргийн хүсэлт бүрд хямд (нэг индексийн уншилт). */
export async function syncRepairDayIfMarked(db: D1Database, userId: number, date: string): Promise<void> {
  const any = await db
    .prepare(`SELECT 1 AS x FROM repair_marks WHERE user_id = ? AND date = ? LIMIT 1`)
    .bind(userId, date)
    .first();
  if (any) await syncRepairDay(db, userId, date);
}

/* ------------------------------------------------------------------ */
/*  Ажилтны тэмдэглэгээ                                                */
/* ------------------------------------------------------------------ */

/** Өнөөдрийн тэмдэглэгээнүүд (оноотой, ажилтных) — ижил ажлыг давхар
 *  тэмдэглэхээс сэргийлэхэд. */
export async function findTodayMark(
  db: D1Database,
  userId: number,
  date: string,
  target: MarkTarget,
): Promise<RepairMarkRow | null> {
  const { results } = await db
    .prepare(`SELECT * FROM repair_marks WHERE user_id = ? AND date = ? AND award_points = 1`)
    .bind(userId, date)
    .all<RepairMarkRow>();
  const key = repairItemKey(target);
  return (results ?? []).find((m) => repairItemKey(m) === key) ?? null;
}

/**
 * «Өнөөдөр үүн дээр ажилласан» тэмдэглэгээ.  Ханш (оноо + явц) ЭНЭ агшинд
 * хөлдөнө — өдрийн дотор дахин хуваарилахад цаг л өөрчлөгдөнө.  Ижил ажлыг
 * өнөөдөр аль хэдийн тэмдэглэсэн бол тэрийг буцаана (давхардахгүй).
 */
export async function createLiveMark(
  db: D1Database,
  userId: number,
  date: string,
  target: MarkTarget,
): Promise<{ mark: RepairMarkRow; created: boolean }> {
  const existing = await findTodayMark(db, userId, date, target);
  if (existing) return { mark: existing, created: false };
  const member = leaderboardMemberSql('u', false);
  const [points, progress] = await Promise.all([
    baseDailyRate(db, userId, 'amount', member),
    baseDailyRate(db, userId, 'delta_pct', member),
  ]);
  const row = await db
    .prepare(
      `INSERT INTO repair_marks
         (user_id, date, project_id, repair_project_id, task_id, award_points,
          daily_rate, rate_source, progress_rate, progress_rate_source)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(
      userId,
      date,
      target.project_id,
      target.repair_project_id,
      target.task_id,
      points.rate,
      points.source,
      progress.rate,
      progress.source,
    )
    .first<RepairMarkRow>();
  if (!row) throw new Error('repair mark insert failed');
  return { mark: row, created: true };
}

/** Тэмдэглэгээ + түүнээс гаргасан мөр + оноо.  Өдрийг дахин хуваарилах нь
 *  дуудагчийн ажил (`syncRepairDay`). */
export async function deleteMark(db: D1Database, markId: number): Promise<void> {
  await db.batch([
    db
      .prepare(`DELETE FROM user_points WHERE repair_entry_id IN (SELECT id FROM repair_entries WHERE mark_id = ?)`)
      .bind(markId),
    db.prepare(`DELETE FROM repair_entries WHERE mark_id = ?`).bind(markId),
    db.prepare(`DELETE FROM repair_marks WHERE id = ?`).bind(markId),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Хуучин ZA хувийн бөглөлтийг цаг болгох                             */
/* ------------------------------------------------------------------ */

/** Цагаар бодогддог төслийн таск дээрх, хараахан тэмдэглэгээ болоогүй ХУВИЙН
 *  бөглөлт.  `SELECT … ${PENDING_FILLS}` хэлбэрээр хэрэглэнэ.
 *  Жинлэсэн явцаа суурь болгон үргэлжлүүлсэн төсөл (`hours_progress_base`,
 *  0349 — FURNITURE LAND) ХАСАГДАНА: хувь нь аль хэдийн суурьт орсон тул
 *  хуучин бөглөлтийг цаг болговол явц давхар тоологдоно. */
const PENDING_FILLS = `
  FROM progress_entries pe
  JOIN tasks t       ON t.id  = pe.task_id
  JOIN components co ON co.id = t.component_id
  JOIN drawings d    ON d.id  = co.drawing_id
  JOIN blocks b      ON b.id  = d.block_id
  JOIN projects p    ON p.id  = b.project_id
 WHERE p.progress_mode = 'hours'
   AND p.hours_progress_base IS NULL
   AND COALESCE(pe.is_rest_day, 0) = 0 AND COALESCE(pe.defer_next_day, 0) = 0
   AND pe.status <> 'rejected'
   AND NOT EXISTS (SELECT 1 FROM repair_marks m WHERE m.progress_entry_id = pe.id)`;

export interface BackfillStatus {
  pending_entries: number;
  pending_days: number;
}

export async function hoursBackfillStatus(db: D1Database): Promise<BackfillStatus> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS pending_entries,
              COUNT(DISTINCT pe.user_id || '|' || pe.date) AS pending_days
         ${PENDING_FILLS}`,
    )
    .first<BackfillStatus>();
  return { pending_entries: Number(row?.pending_entries ?? 0), pending_days: Number(row?.pending_days ?? 0) };
}

export interface BackfillRun {
  days: number;
  marks: number;
  remaining_days: number;
}

/**
 * Хамгийн эртний `maxDays` ажилтан-өдрийн хувийн бөглөлтийг тэмдэглэгээ
 * болгоод тэр өдрийг хуваарилна.  Явцын ханш нь ТЭР ӨДРИЙН ЭХЭНД мэдэгдэж
 * байсан 30 хоногийн дундаж.  Идемпотент (`progress_entry_id` UNIQUE,
 * `INSERT OR IGNORE`) — cron ба админы товч зэрэг ажилласан ч давхардахгүй.
 */
export async function runHoursBackfill(db: D1Database, opts: { maxDays: number }): Promise<BackfillRun> {
  const { results: days } = await db
    .prepare(
      `SELECT pe.user_id, pe.date ${PENDING_FILLS}
        GROUP BY pe.user_id, pe.date
        ORDER BY pe.date, pe.user_id
        LIMIT ?`,
    )
    .bind(Math.max(1, Math.trunc(opts.maxDays)))
    .all<{ user_id: number; date: string }>();
  const member = leaderboardMemberSql('u', false);
  const settings = await getAttendanceSettings(db);
  let marks = 0;
  for (const d of days ?? []) {
    const { results: fills } = await db
      .prepare(
        `SELECT pe.id, pe.task_id, b.project_id, pe.created_at ${PENDING_FILLS}
            AND pe.user_id = ? AND pe.date = ?`,
      )
      .bind(d.user_id, d.date)
      .all<{ id: number; task_id: number; project_id: number; created_at: string | null }>();
    if (!fills || fills.length === 0) continue;
    const rate = await baseDailyRate(db, d.user_id, 'delta_pct', member, dayStartUtc(d.date));
    await db.batch(
      fills.map((f) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO repair_marks
               (user_id, date, project_id, repair_project_id, task_id, marked_at, award_points,
                progress_entry_id, daily_rate, rate_source, progress_rate, progress_rate_source)
             VALUES (?, ?, ?, NULL, ?, ?, 0, ?, 0, NULL, ?, ?)`,
          )
          .bind(
            d.user_id,
            d.date,
            f.project_id,
            f.task_id,
            // Цаггүй хуучин мөр → өдрийн эцэс (UTC 23:59 = УБ маргааш 07:59 → эцсийн суулт).
            f.created_at ?? `${d.date} 23:59:59`,
            f.id,
            rate.rate,
            rate.source,
          ),
      ),
    );
    marks += fills.length;
    await syncRepairDay(db, d.user_id, d.date, { settings });
  }
  const status = await hoursBackfillStatus(db);
  return { days: (days ?? []).length, marks, remaining_days: status.pending_days };
}

/**
 * Cron (index.ts-ийн fail-safe салаа, ШИНЭ cron илэрхийлэл НЭМЭЭГҮЙ):
 * нөхөлт дуусаагүй бол хэдэн өдрийг нөхнө.  Дууссан бол ганц уншилт.
 */
export async function runRepairHoursBackfillCron(env: Env): Promise<void> {
  const state = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .bind(HOURS_BACKFILL_KEY)
    .first<{ value: string }>();
  if (state?.value === 'done') return;
  const res = await runHoursBackfill(env.DB, { maxDays: CRON_BACKFILL_DAYS });
  if (res.remaining_days === 0) await markHoursBackfillDone(env.DB);
}

export async function markHoursBackfillDone(db: D1Database): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, 'done', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = 'done', updated_at = datetime('now')`,
    )
    .bind(HOURS_BACKFILL_KEY)
    .run();
}

/** Төсөл цагаар шилжсэн (ZA болсон) — хуучин бөглөлтийг дахин нөхүүлнэ. */
export async function rearmHoursBackfill(db: D1Database): Promise<void> {
  await db.prepare(`DELETE FROM app_settings WHERE key = ?`).bind(HOURS_BACKFILL_KEY).run();
}
