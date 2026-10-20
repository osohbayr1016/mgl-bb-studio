/**
 * «Менежментийн багийн тайлан» — өдрийн ажлын тайлангийн (0345) БАГИЙН
 * нэгтгэлийн цэвэр дүрэм.  Импортгүй тул `node --test`-д шууд ачаалагдана.
 *
 * Эзний шийдвэр (2026-10-07): CEO болон admin «Тайлан» хуудаснаас менежментийн
 * багийн бүх гишүүний өдрийн тайланг нэгтгэж харна; гишүүн бүрийн өөрийн
 * нэгтгэл (тухайн хугацаанд нийт юу хийсэн) ч тэнд.  Гишүүн = идэвхтэй
 * `admin` (`is_support = 0` — лоббиийн ТВ бүртгэл орохгүй) + тухайн хугацаанд
 * тайлан бичсэн хэн ч (идэвхгүй болсон ч түүх нь харагдана).
 *
 * «Хүлээгдэх өдөр» = Даваа–Баасан − нийтийн баяр, `[max(from, эхлэл, бүртгэгдсэн
 * өдөр), to]` мужид.  Модуль 2026-09-24-нд нэвтэрсэн тул түүнээс өмнөх өдөр
 * «бичээгүй» гэж тоологдохгүй.
 */

/** Өдрийн тайлан продод нэвтэрсэн өдөр (0345 deploy). */
export const DAILY_LOG_SINCE = '2026-09-24';

/** Багийн матриц өдөр бүрийн бичвэрийг (hover) буцаах дээд муж. */
export const MATRIX_ITEMS_MAX_DAYS = 62;

/** Гишүүний дэлгэрэнгүйд буцаах мөрийн дээд тоо (≈5 жил). */
export const MEMBER_LOGS_LIMIT = 2000;

const DAY_MS = 86_400_000;

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

function isWeekendDate(date: string): boolean {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
}

const maxDate = (...ds: (string | null | undefined)[]): string =>
  ds.filter((d): d is string => !!d).reduce((a, b) => (b > a ? b : a));

/** `[from, to]` дахь ажлын өдрүүд (Да–Ба, баярын өдөр биш).  from > to → []. */
export function workdaysIn(from: string, to: string, holidays: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (!isWeekendDate(d) && !holidays.has(d)) out.push(d);
  }
  return out;
}

/** Гишүүнээс тайлан хүлээх эхний өдөр. */
export function expectedFrom(rangeFrom: string, createdDate: string | null | undefined): string {
  const created = createdDate && /^\d{4}-\d{2}-\d{2}$/.test(createdDate) ? createdDate : null;
  return maxDate(rangeFrom, DAILY_LOG_SINCE, created);
}

export interface MemberLogRow {
  log_date: string;
  item_count: number;
  first_written_on: string;
}

export interface MemberSummary {
  /** Бичсэн өдөр (амралтын өдөр ч орно). */
  days_logged: number;
  /** Нийт ажил (дугаарласан мөр). */
  items: number;
  /** Ажлын өдрүүдээс бичсэн нь. */
  logged_workdays: number;
  /** Хүлээгдэх ажлын өдөр. */
  expected_workdays: number;
  /** logged_workdays / expected_workdays; хүлээгдэх өдөргүй бол null. */
  coverage: number | null;
  /** Тайлангийн өдрөөс хойш анх бичсэн («нөхөж бичсэн») өдөр. */
  late_days: number;
  first_date: string | null;
  last_date: string | null;
}

/**
 * Нэг гишүүний `[from, to]` дахь нэгтгэл.  `rows` нь тухайн гишүүний мөрүүд
 * (мужаас гадуурх нь үл тоогдоно).  `expected` = тэр гишүүнээс хүлээх ажлын
 * өдрүүдийн олонлог.
 */
export function summarizeMember(
  rows: readonly MemberLogRow[],
  from: string,
  to: string,
  expected: readonly string[],
): MemberSummary {
  const expectedSet = new Set(expected);
  let days = 0;
  let items = 0;
  let loggedWork = 0;
  let late = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    if (r.log_date < from || r.log_date > to) continue;
    days++;
    items += Math.max(0, Number(r.item_count) || 0);
    if (expectedSet.has(r.log_date)) loggedWork++;
    if (r.first_written_on > r.log_date) late++;
    if (first === null || r.log_date < first) first = r.log_date;
    if (last === null || r.log_date > last) last = r.log_date;
  }
  return {
    days_logged: days,
    items,
    logged_workdays: loggedWork,
    expected_workdays: expected.length,
    coverage: expected.length > 0 ? loggedWork / expected.length : null,
    late_days: late,
    first_date: first,
    last_date: last,
  };
}
