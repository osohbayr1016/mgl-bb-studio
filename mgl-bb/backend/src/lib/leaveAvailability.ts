/**
 * Батлагдсан чөлөө ба БҮТЭЭМЖИЙН ХУВЬ — ГАНЦ газар (2026-09-24).
 *
 * Эзний дүрэм: «чөлөө авлаа гээд хувь нь нэмэгдэх, хасагдах асуудал системд
 * байх ёсгүй — чөлөө авахаас өмнө ямар байсан тэндээсээ үргэлжилнэ».
 *
 * ── АЖИЛЛАСАН ӨДРИЙН ЦОНХ ───────────────────────────────────────────────
 * «Сүүлийн 30 хоног» гэх мэт цонх нь хуанлийн N өдөр БИШ, тухайн хүний
 * сүүлийн K АЖИЛЛАСАН өдөр болно (K = цонхны ажлын өдрийн тоо).  Цонхны
 * чөлөөтэй ажлын өдрүүдийг алгасаж, цонхны эхлэлийг ӨМНӨХ бодит ажлын
 * өдрүүд рүү тэр тоогоор сунгана:
 *
 *     нэрлэсэн: [from, to]         K = ажлын өдөр, L = чөлөөтэй ажлын өдөр
 *     ажилласан: [from′, to] − чөлөөт өдрүүд,   from′ ≤ from нь L ажлын өдрөөр өмнө
 *
 * Үр дүн:
 *   • Чөлөөний ҮЕЭР хувь ХӨЛДӨНӨ — өдөр бүр нэг чөлөөт өдөр нэмэгдэж, цонх
 *     яг нэг ажлын өдрөөр ухарна; тоологдох өдрүүд өөрчлөгдөхгүй.
 *   • Ирсний дараа ТЭНДЭЭСЭЭ үргэлжилнэ — шинэ ажлын өдөр орж, хамгийн
 *     хуучин нь гарна, яг чөлөө аваагүй мэт.
 *   • Хуурамч оноо ҮҮСГЭХГҮЙ — бүх тоо бодит `user_points`; зөвхөн аль
 *     өдрүүдийг тоолохыг сонгоно.  Ledger хөндөгдөхгүй.
 *   • Чөлөөгүй хүнд цонх өөрчлөгдөхгүй → тоо нь ЯГ хуучинтайгаа ижил
 *     (дуудагч SQL-ийн нийлбэр дээр `delta` = 0 нэмнэ).
 *
 * Одоо байгаа тодорхойлолтуудыг ДАХИН ашиглана, шинээр зохиохгүй:
 *   • Ажлын өдөр = Даваа–Баасан, `holidays`-д байхгүй (`routes/leaves.ts`
 *     summary-ийн `working_days`, `routes/reports.ts` `expectedWorkDays`).
 *   • Батлагдсан = `leave_requests.status = 'approved'` — pending / rejected /
 *     cancelled ОГТ тооцогдохгүй (ирцийн `absent_days`-тай ижил).
 *   • Чөлөөгүй тасалсан өдөр — цонхонд хэвээр (0 оноотой), ХӨНДӨГДӨХГҮЙ.
 *
 * Зориудын хил:
 *   • ЦАГААР авсан чөлөө (start_time бөглөсөн, эсвэл нэг өдрийн < 8 цаг) —
 *     ажилтан тэр өдөр ажилласан; чөлөөт өдөр БИШ.
 *   • `leave_type = 'remote'` (зайнаас АЖИЛЛАХ) — ажлын өдөр, чөлөө биш.
 *   • Чөлөөтэй өдөр бодитоор оноо авсан бол (ажилласан) тэр өдөр ЭНГИЙН
 *     ажлын өдөр — бодит ажил хэзээ ч хаягдахгүй (прод хуулбар: 196
 *     чөлөөт хүн-өдрийн 3-т нь л оноо бичигдсэн).
 */
import { STANDARD_WORK_DAY_HOURS } from '../types';
import { isWeekend, addDays } from './workSchedule';
import { getHolidaySet } from './holidays';
import { orgUtcOffsetMinutes, sqliteOffsetModifier, ubDayBoundsUtc } from './reportWindows';

export interface DateRange {
  from: string;
  to: string;
}

export interface ApprovedLeaveRow {
  user_id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  days: number | null;
  hours: number | null;
  start_time: string | null;
}

/** [from, to]-тэй давхцсан батлагдсан чөлөө.  Bind: (to, from). */
export const APPROVED_LEAVE_OVERLAP_SQL = `
  SELECT user_id, leave_type, start_date, end_date, days, hours, start_time
    FROM leave_requests
   WHERE status = 'approved' AND start_date <= ? AND end_date >= ?`;

/** Цонхыг хэдэн хуанлийн өдрөөр ухрааж болох дээд хэмжээ (урт цалингүй чөлөө). */
export const MAX_LOOKBACK_DAYS = 366;

/**
 * Бүтэн өдрийн чөлөө мөн үү.  Олон өдрийн мөр → тийм.  Нэг өдрийн мөр →
 * цаг заагаагүй бөгөөд ≥ 8 цаг (хуучин мөрөнд `hours` NULL бол `days × 8`,
 * reports.ts `leaveAgg`-тай ижил fallback).  `remote` → үгүй.
 */
export function isFullDayLeave(
  l: Pick<ApprovedLeaveRow, 'leave_type' | 'start_date' | 'end_date' | 'days' | 'hours' | 'start_time'>,
): boolean {
  if (l.leave_type === 'remote') return false;
  if (l.start_time) return false;
  if (l.end_date > l.start_date) return true;
  const hours = l.hours ?? (l.days ?? 1) * STANDARD_WORK_DAY_HOURS;
  return hours >= STANDARD_WORK_DAY_HOURS;
}

function isWorkingDay(d: string, holidays: ReadonlySet<string>): boolean {
  return !isWeekend(d) && !holidays.has(d);
}

/** Мужийн ажлын өдрүүд (Даваа–Баасан, амралтын өдөргүй). */
export function workingDates(range: DateRange, holidays: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) if (isWorkingDay(d, holidays)) out.push(d);
  return out;
}

/** ЦЭВЭР: хүн бүрийн бүтэн өдрийн батлагдсан чөлөөтэй АЖЛЫН огноонууд (мужид таслагдсан). */
export function leaveDatesByUser(
  rows: readonly ApprovedLeaveRow[],
  range: DateRange,
  holidays: ReadonlySet<string>,
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const l of rows) {
    if (!isFullDayLeave(l)) continue;
    const from = l.start_date > range.from ? l.start_date : range.from;
    const to = l.end_date < range.to ? l.end_date : range.to;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!isWorkingDay(d, holidays)) continue;
      let set = out.get(l.user_id);
      if (!set) out.set(l.user_id, (set = new Set()));
      set.add(d);
    }
  }
  return out;
}

export interface WorkedWindow {
  /** Сунгасан эхлэл (чөлөөгүй бол нэрлэсэн `from`). */
  from: string;
  to: string;
  /** Тоолохгүй огноонууд — чөлөөтэй ажлын өдрүүд + сунгасан хэсгийн амралтын өдрүүд. */
  skip: Set<string>;
  /** Нэрлэсэн цонхны чөлөөтэй ажлын өдрийн тоо (L). */
  leaveDays: number;
  /** false = `MAX_LOOKBACK_DAYS` хүрэхэд ч L ажлын өдөр олдсонгүй. */
  complete: boolean;
}

/**
 * ЦЭВЭР: нэрлэсэн цонх → ажилласан өдрийн цонх (дээрх тайлбар).  `leave` нь
 * тухайн хүний чөлөөт АЖЛЫН огноонууд — сунгах хэсгийг хамрах ёстой.
 */
export function workedWindow(
  range: DateRange,
  leave: ReadonlySet<string> | undefined,
  holidays: ReadonlySet<string>,
  maxLookbackDays = MAX_LOOKBACK_DAYS,
): WorkedWindow {
  const skip = new Set<string>();
  if (!leave || leave.size === 0) return { from: range.from, to: range.to, skip, leaveDays: 0, complete: true };
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    if (leave.has(d) && isWorkingDay(d, holidays)) skip.add(d);
  }
  const leaveDays = skip.size;
  let need = leaveDays;
  let from = range.from;
  const limit = addDays(range.from, -maxLookbackDays);
  // Чөлөөт ажлын өдөр бүрийг ЯГ НЭГ өмнөх (чөлөөгүй) ажлын өдрөөр орлуулна —
  // сунгасан хэсгийн амралтын өдөр тоологдохгүй, эс тэгвэл цонхонд илүү
  // Бямба/Ням орж ирнэ.
  for (let d = addDays(range.from, -1); need > 0 && d >= limit; d = addDays(d, -1)) {
    from = d;
    if (!isWorkingDay(d, holidays) || leave.has(d)) skip.add(d);
    else need -= 1;
  }
  return { from, to: range.to, skip, leaveDays, complete: need === 0 };
}

/** ЦЭВЭР: өдрийн утгуудын нийлбэр [from, to]-д, `skip` огноонуудыг хасна. */
export function windowSum(
  daily: ReadonlyMap<string, number> | undefined,
  w: { from: string; to: string; skip?: ReadonlySet<string> },
): number {
  if (!daily) return 0;
  let s = 0;
  for (const [d, v] of daily) if (d >= w.from && d <= w.to && !w.skip?.has(d)) s += v;
  return s;
}

/* ------------------------------------------------------------------ */
/*  Ачаалагч — нэрлэсэн нийлбэр дээр нэмэх «delta»                     */
/* ------------------------------------------------------------------ */

export interface LeaveNeutral {
  /** Нэрлэсэн цонхны чөлөөтэй ажлын өдөр (оноо авсан чөлөөт өдөр тоологдохгүй). */
  leaveDays(userId: number, rangeIndex: number): number;
  /**
   * Ажилласан өдрийн цонхны нийлбэр − нэрлэсэн цонхны нийлбэр (хоёулаа УБ
   * өдрөөр).  Дуудагч өөрийн нэрлэсэн нийлбэр дээр НЭМНЭ.  Чөлөөгүй → 0.
   */
  delta(userId: number, rangeIndex: number, key?: string): number;
  /** Сунгасан цонх (чөлөөгүй бол null). */
  window(userId: number, rangeIndex: number): WorkedWindow | null;
}

export interface LeaveNeutralOptions {
  /** Нэрлэсэн цонхнууд (УБ огноо, багтсан). */
  ranges: readonly DateRange[];
  /** Хүн амыг хязгаарлах (өгөөгүй бол бүгд). */
  userIds?: readonly number[];
  /** `user_points` дээрх нийлбэрүүд, түлхүүр → SQL илэрхийлэл.  Эхнийх нь
   *  «тэр өдөр ажилласан уу» (> 0) шалгуур.  Өгөгдмөл `{ pts: 'amount' }`. */
  sums?: Record<string, string>;
  /** Нэмэлт WHERE (жнь `source = 'progress'`). */
  where?: string;
  /**
   * Дуудагчийн нэрлэсэн нийлбэр УБ огноогоор БИШ, гулсах UTC цонхоор
   * (`awarded_at >= datetime('now','-30 days')`) бодогддог бол тэр хилийг
   * `ranges`-тай ижил дарааллаар өгнө.  Тэгвэл `delta` = ажилласан өдрийн
   * цонх − ЯГ тэр SQL цонхны нийлбэр — хилийн өдөр хоёр удаа тоологдохгүй.
   * `sinceSql` / `untilSql` нь SQL илэрхийлэл, `binds` нь тэдгээрийн `?`.
   */
  sqlWindows?: ReadonlyArray<{ sinceSql: string; untilSql?: string; binds?: readonly unknown[] } | null>;
}

const NONE: LeaveNeutral = { leaveDays: () => 0, delta: () => 0, window: () => null };

/**
 * Цонх бүрт хүн бүрийн чөлөөнөөс хамааралгүй нийлбэрийн залруулгыг ачаална.
 * Ердөө 2 D1 уншилт (чөлөө + амралтын өдөр) хэрэв цонхонд чөлөөтэй хүн
 * байхгүй бол; байвал + ЗӨВХӨН тэдний өдрийн оноо (idx_user_points_user_date).
 */
export async function loadLeaveNeutral(db: D1Database, opts: LeaveNeutralOptions): Promise<LeaveNeutral> {
  const ranges = opts.ranges;
  if (ranges.length === 0) return NONE;
  let minFrom = ranges[0]!.from;
  let maxTo = ranges[0]!.to;
  for (const r of ranges) {
    if (r.from < minFrom) minFrom = r.from;
    if (r.to > maxTo) maxTo = r.to;
  }
  const outer: DateRange = { from: addDays(minFrom, -MAX_LOOKBACK_DAYS), to: maxTo };
  const [leaveRes, holidays] = await Promise.all([
    db.prepare(APPROVED_LEAVE_OVERLAP_SQL).bind(outer.to, outer.from).all<ApprovedLeaveRow>(),
    getHolidaySet(db, outer.from, outer.to),
  ]);
  const allow = opts.userIds ? new Set(opts.userIds) : null;
  const rows = (leaveRes.results ?? []).filter((l) => !allow || allow.has(l.user_id));
  const leave = leaveDatesByUser(rows, outer, holidays);

  // Нэрлэсэн аль нэг цонхонд чөлөөт өдөртэй хүмүүс л залруулга авна.
  const candidates: number[] = [];
  let loadFrom = maxTo;
  for (const [userId, dates] of leave) {
    let hit = false;
    for (const r of ranges) {
      const w = workedWindow(r, dates, holidays);
      if (w.leaveDays > 0) {
        hit = true;
        if (w.from < loadFrom) loadFrom = w.from;
      }
    }
    if (hit) candidates.push(userId);
  }
  if (candidates.length === 0) return NONE;

  const sums = opts.sums ?? { pts: 'amount' };
  const keys = Object.keys(sums);
  const primary = keys[0]!;
  const offset = orgUtcOffsetMinutes(new Date(`${maxTo}T12:00:00Z`));
  const bounds = ubDayBoundsUtc(loadFrom, maxTo, offset);
  const cols = keys.map((k, i) => `SUM(${sums[k]}) AS s${i}`).join(', ');
  const ids = candidates.map((n) => Math.trunc(n)).join(',');
  const { results } = await db
    .prepare(
      `SELECT user_id, date(awarded_at, ?) AS day, ${cols}
         FROM user_points
        WHERE user_id IN (${ids}) AND awarded_at >= ? AND awarded_at < ?${opts.where ? ` AND (${opts.where})` : ''}
        GROUP BY user_id, day`,
    )
    .bind(sqliteOffsetModifier(offset), bounds.startUtc, bounds.endUtcExclusive)
    .all<Record<string, number | string>>();

  // user → key → day → value
  const daily = new Map<number, Map<string, Map<string, number>>>();
  for (const r of results ?? []) {
    const userId = Number(r.user_id);
    const day = String(r.day);
    let byKey = daily.get(userId);
    if (!byKey) daily.set(userId, (byKey = new Map()));
    keys.forEach((k, i) => {
      let m = byKey!.get(k);
      if (!m) byKey!.set(k, (m = new Map()));
      m.set(day, Number(r[`s${i}`] ?? 0));
    });
  }

  // SQL цонхтой яг ижил нэрлэсэн нийлбэр (зөвхөн залруулга авах хүмүүст).
  const exactNominal = new Map<string, number>(); // `${i}|${user}|${key}`
  await Promise.all(
    ranges.map(async (_r, i) => {
      const sw = opts.sqlWindows?.[i];
      if (!sw) return;
      const { results: nominal } = await db
        .prepare(
          `SELECT user_id, ${cols}
             FROM user_points
            WHERE user_id IN (${ids}) AND awarded_at >= ${sw.sinceSql}${sw.untilSql ? ` AND awarded_at < ${sw.untilSql}` : ''}${
              opts.where ? ` AND (${opts.where})` : ''
            }
            GROUP BY user_id`,
        )
        .bind(...(sw.binds ?? []))
        .all<Record<string, number | string>>();
      for (const r of nominal ?? []) {
        keys.forEach((k, j) => exactNominal.set(`${i}|${Number(r.user_id)}|${k}`, Number(r[`s${j}`] ?? 0)));
      }
    }),
  );

  const windows = new Map<number, (WorkedWindow | null)[]>();
  for (const userId of candidates) {
    // Чөлөөтэй өдөр бодитоор ажилласан (оноо авсан) бол энгийн ажлын өдөр.
    const worked = daily.get(userId)?.get(primary);
    const dates = new Set([...leave.get(userId)!].filter((d) => !((worked?.get(d) ?? 0) > 0)));
    windows.set(
      userId,
      ranges.map((r) => {
        const w = workedWindow(r, dates, holidays);
        return w.leaveDays > 0 ? w : null;
      }),
    );
  }

  return {
    leaveDays: (userId, i) => windows.get(userId)?.[i]?.leaveDays ?? 0,
    window: (userId, i) => windows.get(userId)?.[i] ?? null,
    delta: (userId, i, key = primary) => {
      const w = windows.get(userId)?.[i];
      if (!w) return 0;
      const m = daily.get(userId)?.get(key);
      const nominal = opts.sqlWindows?.[i]
        ? (exactNominal.get(`${i}|${userId}|${key}`) ?? 0)
        : windowSum(m, ranges[i]!);
      return windowSum(m, w) - nominal;
    },
  };
}
