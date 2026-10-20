import { addDays, mondayOf, monthGrid, weekDates } from '../../daily-log/lib';
import type { ReportWindow } from '../types';

/**
 * «Менежментийн багийн тайлан»-ын КАЛЕНДАРЬ — цэвэр дүрэм (2026-10-08).
 * Эзэн: «өчигдөр, өнөөдөр гэх мэт урт бичвэрийн дундаас тухайн хүний тухайн
 * өдрийн тайланг олох нь замбараагүй» → мөр = хүн, багана = өдөр (7 хоног),
 * эсвэл сарын календарь.  Хувь, хоцролт, «бичээгүй» гэх мэт зүйл ЗОРИУД байхгүй.
 */

export type CalView = 'week' | 'month';

export interface CalDaySource {
  user_id: number;
  date: string;
  count: number;
  items?: readonly string[];
}

/** Тэр харагдацын өдрүүд (долоо хоног = Да…Ня; сар = бүтэн долоо хоногийн тор). */
export function viewDates(view: CalView, cursor: string): string[][] {
  return view === 'week' ? [weekDates(cursor)] : monthGrid(cursor.slice(0, 7));
}

/**
 * Серверээс асуух цонх: `/reports/management-logs` нь `anchor`-ыг өнөөдрөөр
 * тайрдаг тул долоо хоногт `14d` (anchor ≥ Даваа ⇒ from ≤ Даваа), сард `month`.
 * Хоёулаа ≤ 62 өдөр тул бичвэр (`items`) ирнэ.
 */
export function fetchWindow(
  view: CalView,
  cursor: string,
  today: string,
): { window: ReportWindow; anchor: string } {
  if (view === 'week') {
    const sunday = addDays(mondayOf(cursor), 6);
    return { window: '14d', anchor: sunday > today ? today : sunday };
  }
  const [y, m] = cursor.slice(0, 7).split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { window: 'month', anchor: last > today ? today : last };
}

/** ◀ ▶ — долоо хоногоор эсвэл сараар; ирээдүйн харагдац руу явахгүй. */
export function shiftCursor(view: CalView, cursor: string, dir: -1 | 1, today: string): string {
  if (view === 'week') {
    const next = addDays(mondayOf(cursor), dir * 7);
    return next > today ? cursor : next;
  }
  const [y, m] = cursor.slice(0, 7).split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  const next = d.toISOString().slice(0, 10);
  return next.slice(0, 7) > today.slice(0, 7) ? cursor : next;
}

export function canGoNext(view: CalView, cursor: string, today: string): boolean {
  return shiftCursor(view, cursor, 1, today) !== cursor;
}

/** Харагдац өнөөдрийг агуулж байна уу («Өнөөдөр» товчийг идэвхгүй болгоход). */
export function containsToday(view: CalView, cursor: string, today: string): boolean {
  return view === 'week'
    ? mondayOf(cursor) === mondayOf(today)
    : cursor.slice(0, 7) === today.slice(0, 7);
}

export const cellKey = (userId: number, date: string) => `${userId}|${date}`;

/** `хүн|өдөр` → ажлууд (хоосон мөр орохгүй). */
export function indexDays(days: readonly CalDaySource[]): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  for (const d of days) {
    if (d.count <= 0 || !d.items || d.items.length === 0) continue;
    out.set(cellKey(d.user_id, d.date), d.items);
  }
  return out;
}

/** Тэр өдөр бичсэн хүмүүс — `order`-ын дарааллаар. */
export function writersOn(
  index: ReadonlyMap<string, readonly string[]>,
  date: string,
  order: readonly number[],
): number[] {
  return order.filter((id) => index.has(cellKey(id, date)));
}

const fold = (s: string) => s.toLocaleLowerCase('mn-MN');

/** Хайлтын үг ажлуудын аль нэгэнд байна уу (хоосон хайлт = үргэлж тийм). */
export function matchesQuery(items: readonly string[], q: string): boolean {
  const needle = fold(q.trim());
  return !needle || items.some((it) => fold(it).includes(needle));
}

/**
 * Цонхны ◀ ▶: тэр сонголтод (нэг хүн эсвэл бүгд) бичлэгтэй өмнөх/дараах өдөр,
 * зөвхөн ачаалагдсан огноонуудын дотор.  Байхгүй бол null.
 */
export function stepDay(
  index: ReadonlyMap<string, readonly string[]>,
  dates: readonly string[],
  date: string,
  dir: -1 | 1,
  people: readonly number[],
): string | null {
  const sorted = [...new Set(dates)].sort();
  let i = sorted.indexOf(date);
  if (i === -1) return null;
  for (i += dir; i >= 0 && i < sorted.length; i += dir) {
    const d = sorted[i]!;
    if (people.some((id) => index.has(cellKey(id, d)))) return d;
  }
  return null;
}

export interface CalTotals {
  /** Хүн тус бүр: харагдаж буй өдрүүдэд нийт ажил ба бичсэн өдөр. */
  byPerson: Map<number, { items: number; days: number }>;
  /** Өдөр тус бүр: бичсэн хүн ба нийт ажил. */
  byDate: Map<string, { people: number; items: number }>;
  /** Нийт: бичсэн хүн (давхардалгүй) ба ажил. */
  people: number;
  items: number;
}

/** Харагдаж буй өдрүүд × хүмүүсийн ерөнхий тоо — хувь БИШ, зөвхөн «хэдэн ажил». */
export function calTotals(
  index: ReadonlyMap<string, readonly string[]>,
  people: readonly number[],
  dates: readonly string[],
): CalTotals {
  const byPerson = new Map<number, { items: number; days: number }>();
  const byDate = new Map<string, { people: number; items: number }>();
  let items = 0;
  for (const id of people) byPerson.set(id, { items: 0, days: 0 });
  for (const date of dates) {
    const day = { people: 0, items: 0 };
    for (const id of people) {
      const list = index.get(cellKey(id, date));
      if (!list) continue;
      const p = byPerson.get(id)!;
      p.items += list.length;
      p.days += 1;
      day.people += 1;
      day.items += list.length;
    }
    byDate.set(date, day);
    items += day.items;
  }
  let writers = 0;
  for (const p of byPerson.values()) if (p.items > 0) writers += 1;
  return { byPerson, byDate, people: writers, items };
}
