/**
 * «Тайлан» хуудасны ЦОНХНЫ математик — цэвэр функцүүд (D1-гүй, тесттэй).
 *
 * Гурван зүйлийг нэг газарт шийднэ:
 *   1. `window` + `anchor` → одоогийн ба ӨМНӨХ (ижил урттай) мужийн УБ огноо.
 *   2. УБ огнооны муж → `user_points.awarded_at` (UTC 'YYYY-MM-DD HH:MM:SS')-тай
 *      харьцуулах хил.  ⚠️ `+8 hours` ХАТУУ БИЧИХГҮЙ — цагийн бүс
 *      `orgConfig().timezone`-оос ирдэг (өгөгдмөл Asia/Ulaanbaatar, DST-гүй).
 *   3. SQLite-ийн `date(awarded_at, ?)` modifier — өдрөөр бүлэглэхэд bind-ээр.
 *
 * `progress_entries.date`, `attendance_sessions.date`, `repair_entries.date`
 * нь аль хэдийн УБ огноо тул тэдэнд зөвхөн (1) хэрэгтэй.
 */
import { orgConfig } from './orgConfig';

export type ReportWindow = 'day' | '7d' | '14d' | 'month' | 'all';

export const REPORT_WINDOWS: readonly ReportWindow[] = ['day', '7d', '14d', 'month', 'all'];

export interface DateRange {
  /** УБ огноо, багтсан. */
  from: string;
  /** УБ огноо, багтсан. */
  to: string;
}

export interface ResolvedWindow {
  window: ReportWindow;
  current: DateRange;
  /** `all`-д null — харьцуулах өмнөх муж байхгүй. */
  previous: DateRange | null;
  /** current-ийн өдрийн тоо; `all`-д -1 (бодит эхлэл тодорхойгүй). */
  days: number;
}

/** `all` цонхны доод хил — системд үүнээс өмнөх өгөгдөл байхгүй. */
export const ALL_TIME_FROM = '2000-01-01';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isReportWindow(v: unknown): v is ReportWindow {
  return typeof v === 'string' && (REPORT_WINDOWS as readonly string[]).includes(v);
}

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const t = new Date(`${v}T00:00:00Z`).getTime();
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/**
 * YYYY-MM-DD дээр өдөр нэмэх/хасах.  UTC-д тулгуурласан тул УБ↔UTC хилээр
 * хэзээ ч гулсахгүй (leaderboard.ts:63-ийн ижил хэрэгжүүлэлт — route файлаас
 * export хийхгүйн тулд энд давхар).
 */
export function isoAddDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Хоёр огнооны хоорондох өдрийн тоо (багтсан): daysBetween('2026-09-01','2026-09-07') = 7. */
export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/** YYYY-MM дээр сар нэмэх/хасах. */
export function monthAdd(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const zeroBased = year * 12 + (mon - 1) + delta;
  const y = Math.floor(zeroBased / 12);
  const m = zeroBased - y * 12 + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

/** Тухайн сарын сүүлийн өдөр (YYYY-MM-DD). */
export function lastDayOfMonth(month: string): string {
  return isoAddDays(`${monthAdd(month, 1)}-01`, -1);
}

/**
 * Цонхыг мужид хөрвүүлнэ.
 *
 *  day   → [a, a]              өмнөх [a-1, a-1]
 *  7d    → [a-6, a]            өмнөх [a-13, a-7]
 *  14d   → [a-13, a]           өмнөх [a-27, a-14]
 *  month → [YYYY-MM-01, a]     өмнөх = ӨМНӨХ САРЫН ижил тооны эхний өдөр
 *          (сарын дунд харьцуулахад шударга: 9-р сарын 15 хүртэлх 15 өдрийг
 *          8-р сарын 1–15-тай тулгана; өмнөх сар богино бол сарын сүүлээр таслана)
 *  all   → [2000-01-01, a]     өмнөх null
 */
export function resolveWindow(window: ReportWindow, anchor: string): ResolvedWindow {
  switch (window) {
    case 'day':
      return {
        window,
        current: { from: anchor, to: anchor },
        previous: { from: isoAddDays(anchor, -1), to: isoAddDays(anchor, -1) },
        days: 1,
      };
    case '7d':
      return {
        window,
        current: { from: isoAddDays(anchor, -6), to: anchor },
        previous: { from: isoAddDays(anchor, -13), to: isoAddDays(anchor, -7) },
        days: 7,
      };
    case '14d':
      return {
        window,
        current: { from: isoAddDays(anchor, -13), to: anchor },
        previous: { from: isoAddDays(anchor, -27), to: isoAddDays(anchor, -14) },
        days: 14,
      };
    case 'month': {
      const month = anchor.slice(0, 7);
      const from = `${month}-01`;
      const elapsed = daysBetween(from, anchor);
      const prevMonth = monthAdd(month, -1);
      const prevFrom = `${prevMonth}-01`;
      const prevToRaw = isoAddDays(prevFrom, elapsed - 1);
      const prevLast = lastDayOfMonth(prevMonth);
      return {
        window,
        current: { from, to: anchor },
        previous: { from: prevFrom, to: prevToRaw > prevLast ? prevLast : prevToRaw },
        days: elapsed,
      };
    }
    case 'all':
      return {
        window,
        current: { from: ALL_TIME_FROM, to: anchor },
        previous: null,
        days: -1,
      };
  }
}

/* ------------------------------------------------------------------ */
/*  УБ огноо ↔ UTC awarded_at                                          */
/* ------------------------------------------------------------------ */

/**
 * Байгууллагын цагийн бүсийн UTC-ээс зөрөх минут (УБ → 480).  Intl-ийн
 * `longOffset` нь 'GMT+08:00' хэлбэрээр ирдэг; UTC дээр зөвхөн 'GMT'.
 * DST-тэй бүсэд `at` огноогоор өөрчлөгдөж болно — УБ-д тогтмол.
 */
export function orgUtcOffsetMinutes(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: orgConfig().timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(at);
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  return parseOffsetMinutes(raw);
}

/** 'GMT+08:00' / 'UTC-03:30' / 'GMT' → минут. Танигдахгүй бол 0. */
export function parseOffsetMinutes(raw: string): number {
  const m = /([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(raw.replace(/^(GMT|UTC)/, ''));
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hh = Number(m[2] ?? 0);
  const mm = Number(m[3] ?? 0);
  return sign * (hh * 60 + mm);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Date → 'YYYY-MM-DD HH:MM:SS' (UTC) — `user_points.awarded_at`-ийн формат. */
export function toSqliteUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

/**
 * УБ огнооны [from, to] мужийг `awarded_at`-тай харьцуулах UTC хилд хөрвүүлнэ:
 * `awarded_at >= startUtc AND awarded_at < endUtcExclusive`.
 * ubDayBoundsUtc('2026-09-15','2026-09-15',480) → 2026-09-14 16:00:00 .. 2026-09-15 16:00:00
 */
export function ubDayBoundsUtc(
  from: string,
  to: string,
  offsetMinutes: number,
): { startUtc: string; endUtcExclusive: string } {
  const start = new Date(new Date(`${from}T00:00:00Z`).getTime() - offsetMinutes * 60_000);
  const end = new Date(
    new Date(`${isoAddDays(to, 1)}T00:00:00Z`).getTime() - offsetMinutes * 60_000,
  );
  return { startUtc: toSqliteUtc(start), endUtcExclusive: toSqliteUtc(end) };
}

/** SQLite modifier: `date(awarded_at, ?)`-д bind хийх '+480 minutes'. */
export function sqliteOffsetModifier(offsetMinutes: number): string {
  return `${offsetMinutes >= 0 ? '+' : '-'}${Math.abs(offsetMinutes)} minutes`;
}

/**
 * «Бүх цаг»-ийн бодит эхлэл. Ажилд орсон өдөр (hired_at) ОРОХГҮЙ —
 * системийн бүртгэл (`users.created_at`) ба анхны ажлын хувийн
 * бүртгэл (`progress_entries.date`)-ийн аль ЭРТ нь. Anchor-оос хойш
 * бол anchor; аль нь ч байхгүй бол anchor.
 */
export function pickAllTimeFrom(
  anchor: string,
  created: string | null | undefined,
  firstProgress: string | null | undefined,
): string {
  const candidates = [created, firstProgress].filter((v): v is string => isIsoDate(v));
  if (candidates.length === 0) return anchor;
  const min = candidates.reduce((a, b) => (b < a ? b : a));
  return min > anchor ? anchor : min;
}

/** [from, to] мужийн өдөр бүрийн жагсаалт (багтсан). */
export function listDates(from: string, to: string): string[] {
  const out: string[] = [];
  const n = daysBetween(from, to);
  for (let i = 0; i < n; i++) out.push(isoAddDays(from, i));
  return out;
}
