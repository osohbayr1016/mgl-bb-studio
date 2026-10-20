/**
 * Батлагдсан чөлөөг ИРСЭН ЦАГААР богиносгох — D1 давхарга (migration 0364).
 * Дүрэм бүхэлдээ `lib/leaveArrivalCut.ts`-д (цэвэр, тесттэй).
 *
 * `syncLeaveArrivalCuts(user, date)` нь (ажилтан, өдөр)-ийн төлвийг ЭХНЭЭС нь
 * дахин тооцдог, идемпотент: өдрийн АНХНЫ ирсэн цаг (`MIN(clock_in)`) ×
 * тухайн өдрийг хамарсан батлагдсан чөлөө → `leave_arrival_cuts` мөр + чөлөөний
 * мөрийн үр дүнгийн утга.  Анхны утга `arrival_orig_*`-д хадгалагдах тул ирц
 * засагдах/устгагдах бүрд буцааж тооцно — хэзээ ч «алдагдах» зүйлгүй.
 *
 * Дуудагчид (бүгд Safe хувилбараар — ирц бүртгэлийг ХЭЗЭЭ Ч унагахгүй):
 *   • `POST /attendance/clock-in` (өдрийн анхны ирэлт);
 *   • админы `/sessions/manual`, `/sessions/upsert`, `DELETE /sessions/:id`,
 *     `/sessions/bulk-delete`;
 *   • чөлөө батлагдах мөч (`decide`, админ шууд батлан бүртгэх) —
 *     `syncLeaveArrivalCutsForLeave`: аль хэдийн ирсэн өдрүүдэд.
 */
import type { AttendanceSettings } from './settings';
import { getAttendanceSettings } from './settings';
import { lunchWindowOf } from './nonProjectWork';
import { isHoliday } from './holidays';
import { getScheduleAssignments } from './scheduleStore';
import { shiftForUser } from './specialShift';
import { isWeekend, ubMinutesOf, type ScheduleKey } from './workSchedule';
import { todayInUB } from './time';
import { applyCuts, planDayCut, type DayCut, type LeaveOriginal } from './leaveArrivalCut';

interface LeaveDbRow {
  id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  hours: number | null;
  days: number;
  arrival_orig_start_time: string | null;
  arrival_orig_end_time: string | null;
  arrival_orig_hours: number | null;
  arrival_orig_days: number | null;
}

interface CutDbRow extends DayCut {
  leave_id: number;
}

/** Мөрийн АНХНЫ утга — богиносгосон бол `arrival_orig_*`-оос. */
export function originalOf(row: LeaveDbRow): LeaveOriginal {
  const wasCut = row.arrival_orig_days != null;
  return {
    leave_type: row.leave_type,
    start_date: row.start_date,
    end_date: row.end_date,
    start_time: wasCut ? row.arrival_orig_start_time : row.start_time,
    end_time: wasCut ? row.arrival_orig_end_time : row.end_time,
    hours: wasCut ? row.arrival_orig_hours : row.hours,
    days: wasCut ? (row.arrival_orig_days as number) : row.days,
  };
}

const sameCut = (a: DayCut | null, b: DayCut | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.arrival === b.arrival &&
    a.start_time === b.start_time &&
    a.end_time === b.end_time &&
    a.full_minutes === b.full_minutes &&
    a.used_minutes === b.used_minutes);

export interface LeaveCutResult {
  leave_id: number;
  /** Энэ өдрийн одоогийн богиносголт (байхгүй бол null). */
  cut: DayCut | null;
  /** Энэ дуудлагаар өөрчлөгдсөн эсэх. */
  changed: boolean;
}

/**
 * (ажилтан, өдөр)-ийн чөлөөний богиносголтыг ирцтэй тааруулна.  Бүх бичилт
 * НЭГ batch-д.  Чөлөөгүй өдөрт ганц SELECT л хийнэ.
 */
export async function syncLeaveArrivalCuts(
  db: D1Database,
  userId: number,
  date: string,
  settings?: AttendanceSettings,
): Promise<LeaveCutResult[]> {
  const { results: leaveRows } = await db
    .prepare(
      `SELECT id, leave_type, start_date, end_date, start_time, end_time, hours, days,
              arrival_orig_start_time, arrival_orig_end_time, arrival_orig_hours, arrival_orig_days
         FROM leave_requests
        WHERE user_id = ? AND status = 'approved' AND start_date <= ? AND end_date >= ?`,
    )
    .bind(userId, date, date)
    .all<LeaveDbRow>();
  const leaves = leaveRows ?? [];
  if (leaves.length === 0) return [];

  const ids = leaves.map((l) => l.id);
  const [arrivalRow, userRow, assignments, holiday, attSettings, cutRes] = await Promise.all([
    db
      .prepare(`SELECT MIN(clock_in) AS first_in FROM attendance_sessions WHERE user_id = ? AND date = ?`)
      .bind(userId, date)
      .first<{ first_in: string | null }>(),
    db
      .prepare(`SELECT work_schedule FROM users WHERE id = ?`)
      .bind(userId)
      .first<{ work_schedule: ScheduleKey | null }>(),
    getScheduleAssignments(db, userId),
    isHoliday(db, date),
    settings ? Promise.resolve(settings) : getAttendanceSettings(db),
    db
      .prepare(
        `SELECT leave_id, date, arrival, start_time, end_time, full_minutes, used_minutes
           FROM leave_arrival_cuts WHERE leave_id IN (${ids.map(() => '?').join(',')})`,
      )
      .bind(...ids)
      .all<CutDbRow>(),
  ]);

  const shift = shiftForUser(userId, userRow?.work_schedule ?? null, date, assignments);
  const arrivalMinutes = arrivalRow?.first_in ? ubMinutesOf(arrivalRow.first_in) : null;
  const isFreeDay = isWeekend(date) || holiday;
  const cutsByLeave = new Map<number, DayCut[]>();
  for (const c of cutRes.results ?? []) {
    const list = cutsByLeave.get(c.leave_id) ?? [];
    list.push({
      date: c.date,
      arrival: c.arrival,
      start_time: c.start_time,
      end_time: c.end_time,
      full_minutes: c.full_minutes,
      used_minutes: c.used_minutes,
    });
    cutsByLeave.set(c.leave_id, list);
  }

  const stmts: D1PreparedStatement[] = [];
  const out: LeaveCutResult[] = [];
  for (const row of leaves) {
    const orig = originalOf(row);
    const next = planDayCut({
      leave: orig,
      date,
      arrivalMinutes,
      shift,
      graceMinutes: attSettings.lateGraceMinutes,
      isFreeDay,
      lunch: lunchWindowOf(attSettings),
    });
    const existing = cutsByLeave.get(row.id) ?? [];
    const prev = existing.find((c) => c.date === date) ?? null;
    const changed = !sameCut(prev, next);
    out.push({ leave_id: row.id, cut: next, changed });
    if (!changed) continue;

    if (next) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO leave_arrival_cuts
               (leave_id, date, user_id, arrival, start_time, end_time, full_minutes, used_minutes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(leave_id, date) DO UPDATE SET
               arrival = excluded.arrival, start_time = excluded.start_time,
               end_time = excluded.end_time, full_minutes = excluded.full_minutes,
               used_minutes = excluded.used_minutes, updated_at = datetime('now')`,
          )
          .bind(
            row.id,
            date,
            userId,
            next.arrival,
            next.start_time,
            next.end_time,
            next.full_minutes,
            next.used_minutes,
          ),
      );
    } else {
      stmts.push(
        db.prepare(`DELETE FROM leave_arrival_cuts WHERE leave_id = ? AND date = ?`).bind(row.id, date),
      );
    }

    const remaining = existing.filter((c) => c.date !== date);
    if (next) remaining.push(next);
    const eff = applyCuts(orig, remaining);
    if (remaining.length === 0) {
      // Сэргээлт — анхны утгыг буцааж, тэмдгийг арилгана.
      stmts.push(
        db
          .prepare(
            `UPDATE leave_requests
                SET start_time = ?, end_time = ?, hours = ?, days = ?,
                    arrival_orig_start_time = NULL, arrival_orig_end_time = NULL,
                    arrival_orig_hours = NULL, arrival_orig_days = NULL,
                    updated_at = datetime('now')
              WHERE id = ? AND status = 'approved'`,
          )
          .bind(eff.start_time, eff.end_time, eff.hours, eff.days, row.id),
      );
    } else {
      stmts.push(
        db
          .prepare(
            `UPDATE leave_requests
                SET start_time = ?, end_time = ?, hours = ?, days = ?,
                    arrival_orig_start_time = ?, arrival_orig_end_time = ?,
                    arrival_orig_hours = ?, arrival_orig_days = ?,
                    updated_at = datetime('now')
              WHERE id = ? AND status = 'approved'`,
          )
          .bind(
            eff.start_time,
            eff.end_time,
            eff.hours,
            eff.days,
            orig.start_time,
            orig.end_time,
            orig.hours,
            orig.days,
            row.id,
          ),
      );
    }
  }
  if (stmts.length > 0) await db.batch(stmts);
  return out;
}

/** Ирц бүртгэлийг хэзээ ч унагахгүй хувилбар — алдааг логлоод [] буцаана. */
export async function syncLeaveArrivalCutsSafe(
  db: D1Database,
  userId: number,
  date: string,
  settings?: AttendanceSettings,
): Promise<LeaveCutResult[]> {
  try {
    return await syncLeaveArrivalCuts(db, userId, date, settings);
  } catch (e) {
    console.error('[leave-arrival-cut] sync failed', userId, date, e);
    return [];
  }
}

/**
 * Чөлөө батлагдах мөчид — ажилтан аль хэдийн ирсэн (өнөөдөр хүртэлх) өдрүүдийг
 * тааруулна.  Жишээ: өглөөний чөлөө хүсээд 09:00-д ирсэн, админ 10:00-д баталсан.
 */
export async function syncLeaveArrivalCutsForLeave(db: D1Database, leaveId: number): Promise<void> {
  try {
    const lv = await db
      .prepare(`SELECT user_id, start_date, end_date, status FROM leave_requests WHERE id = ?`)
      .bind(leaveId)
      .first<{ user_id: number; start_date: string; end_date: string; status: string }>();
    if (!lv || lv.status !== 'approved') return;
    const today = todayInUB();
    const to = lv.end_date < today ? lv.end_date : today;
    if (to < lv.start_date) return;
    const { results } = await db
      .prepare(
        `SELECT DISTINCT date FROM attendance_sessions
          WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`,
      )
      .bind(lv.user_id, lv.start_date, to)
      .all<{ date: string }>();
    for (const r of results ?? []) await syncLeaveArrivalCuts(db, lv.user_id, r.date);
  } catch (e) {
    console.error('[leave-arrival-cut] sync for leave failed', leaveId, e);
  }
}
