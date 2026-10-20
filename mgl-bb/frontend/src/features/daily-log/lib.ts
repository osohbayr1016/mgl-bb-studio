/**
 * Өдрийн ажлын тайлан — хөтөчийн цэвэр туслахууд.
 *
 * `stripLeadingMark` нь backend `lib/dailyWorkLog.ts`-ийн ИХЭР: сервер
 * хадгалахдаа дугаарыг хасдаг тул «өөрчлөгдсөн эсэх» (dirty) шалгалт ижил
 * дүрмээр харьцуулахгүй бол хадгалаагүй мэт харагдана.  Нэгийг нь өөрчилбөл
 * нөгөөг нь хамт өөрчил.
 */

const LEADING_MARK = /^\s*(?:\d{1,3}[.)](?!\d)|[-*•·])\s*/u;

export function stripLeadingMark(line: string): string {
  return line.replace(LEADING_MARK, '').trim();
}

/** Засварлагчийн бичвэр → хадгалагдах мөрүүд (сервертэй ижил дүрэм). */
export function textToItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(stripLeadingMark)
    .filter((s) => s.length > 0);
}

/** Хадгалсан мөрүүд → засварлагчид «1. …» хэлбэрээр. */
export function itemsToText(items: readonly string[]): string {
  return items.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

export function sameItems(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM` сарыг ±n-ээр шилжүүлнэ. */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

/** 0 = Ням … 6 = Бямба (УБ огноо тул UTC-ээр тооцоход аюулгүй). */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Enter дарахад дараагийн дугаарыг тавих.  Одоогийн мөр «k. …» бол
 * «\n(k+1). » оруулна; мөр нь зөвхөн «k. » (хоосон) бол дугаарыг арилгана.
 * Дугаартай мөр биш бол null → хөтчийн ердийн Enter.
 */
export function continueNumbering(
  text: string,
  caret: number,
): { text: string; caret: number } | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const line = text.slice(lineStart, caret);
  const m = /^(\s*)(\d{1,3})([.)])(\s*)(.*)$/u.exec(line);
  if (!m) return null;
  if (m[5]!.trim() === '' && text.slice(caret).split('\n')[0]!.trim() === '') {
    const next = text.slice(0, lineStart) + text.slice(caret);
    return { text: next, caret: lineStart };
  }
  const insert = `\n${m[1]}${Number(m[2]) + 1}${m[3]} `;
  return {
    text: text.slice(0, caret) + insert + text.slice(caret),
    caret: caret + insert.length,
  };
}

// ─── Календарь + contribution heatmap ──────────────────────────────────────
// Долоо хоног ДАВАА гарагаас эхэлнэ (Монголын хуанли).  Бүх огноо `YYYY-MM-DD`
// УБ огноо тул UTC арифметик аюулгүй — цагийн бүс хөрвүүлэх шаардлагагүй.

/** `YYYY-MM-DD` ± n өдөр. */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const wd = weekdayOf(date);
  return wd === 0 || wd === 6;
}

/** Тухайн өдрийг агуулсан долоо хоногийн Даваа гараг. */
export function mondayOf(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** Даваа … Ням — 7 огноо. */
export function weekDates(date: string): string[] {
  const mon = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/**
 * Сарын календарийн тор: бүтэн долоо хоногууд (Даваагаас), эхний мөр нь 1-ний
 * өдрийг, сүүлийн мөр нь сарын сүүлийн өдрийг агуулна (4–6 мөр).
 */
export function monthGrid(ym: string): string[][] {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const first = `${ym}-01`;
  const last = `${ym}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
  const rows: string[][] = [];
  for (let mon = mondayOf(first); mon <= last; mon = addDays(mon, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDays(mon, i)));
  }
  return rows;
}

/**
 * Heatmap-ын баганууд (нэг багана = нэг долоо хоног, Даваа … Ням).  Сүүлийн
 * багана нь `to`-г агуулна; `to`-гоос хойших өдрүүд багананд байгаа ч UI
 * тэднийг хоосон зурна.
 */
export function heatmapColumns(to: string, weeks: number): string[][] {
  const lastMon = mondayOf(to);
  return Array.from({ length: weeks }, (_, w) => {
    const mon = addDays(lastMon, -7 * (weeks - 1 - w));
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  });
}

/** Сар эхэлсэн багана (тэр баганын Даваа нь шинэ сард) — сарын шошгын байрлал. */
export function monthStarts(
  columns: readonly (readonly string[])[],
): { col: number; month: number }[] {
  const out: { col: number; month: number }[] = [];
  let prev = '';
  columns.forEach((week, col) => {
    const ym = week[0]!.slice(0, 7);
    if (ym !== prev) {
      prev = ym;
      out.push({ col, month: Number(ym.slice(5, 7)) });
    }
  });
  // Эхний багана сарын дунд эхэлсэн бол дараагийн шошготой давхцахгүйн тулд хасна.
  if (out.length > 1 && out[1]!.col - out[0]!.col < 3) out.shift();
  return out;
}

/** Heatmap-ын долоо хоногийн тоо (GitHub-тай ижил — 1 жил). */
export const HEAT_WEEKS = 53;

/** Шатлал 0–4 → өнгө.  Heatmap ба календарийн тоолуур ИЖИЛ өнгийг хэрэглэнэ. */
export const HEAT_BG = [
  'bg-muted',
  'bg-success/30',
  'bg-success/55',
  'bg-success/80',
  'bg-success',
] as const;

/** Өнгөний 4 шатлалын дээд хил: 1..t[0] → 1, …, t[2]+1.. → 4. */
export type HeatScale = readonly [number, number, number];

/**
 * GitHub-ын contribution графын зарчим: олон ажил бичсэн өдөр тод.  Хуваарь
 * нь тухайн хүний өөрийн өгөгдлөөс (бичсэн өдрүүдийн 90-р перцентиль, доод тал
 * нь 4) — нэг онцгой өдөр бусад бүх өдрийг бүдгэрүүлэхгүй.  4 ажлаас бага бол
 * 1, 2, 3, 4+ гэж шууд.
 */
export function heatScale(counts: Iterable<number>): HeatScale {
  const nz = [...counts].filter((c) => c > 0).sort((a, b) => a - b);
  const p90 = nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * 0.9))]! : 0;
  const s = Math.max(4, p90);
  return [Math.ceil(s / 4), Math.ceil(s / 2), Math.ceil((3 * s) / 4)];
}

export function heatLevel(count: number, scale: HeatScale): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= scale[0]) return 1;
  if (count <= scale[1]) return 2;
  if (count <= scale[2]) return 3;
  return 4;
}

/** Шатлал бүрийн мужийн бичвэр («1–2», «7+») — legend-ийн tooltip. */
export function heatRanges(
  scale: HeatScale,
): { level: 0 | 1 | 2 | 3 | 4; from: number; to: number | null }[] {
  return [
    { level: 0, from: 0, to: 0 },
    { level: 1, from: 1, to: scale[0] },
    { level: 2, from: scale[0] + 1, to: scale[1] },
    { level: 3, from: scale[1] + 1, to: scale[2] },
    { level: 4, from: scale[2] + 1, to: null },
  ];
}

/**
 * [from, to] мужийн тоо: нийт ажил, бичсэн өдөр, ажлын өдөр (Да–Ба, өнөөдрөөс
 * хойш тоолохгүй).  Нийтийн баярыг мэдэхгүй — сарын хураангуйтай ижил дүрэм.
 */
export function rangeStats(
  counts: ReadonlyMap<string, number>,
  from: string,
  to: string,
  today: string,
): { items: number; logged: number; workdays: number } {
  const end = to < today ? to : today;
  let items = 0;
  let logged = 0;
  let workdays = 0;
  for (let d = from; d <= end; d = addDays(d, 1)) {
    const c = counts.get(d) ?? 0;
    items += c;
    if (c > 0) logged++;
    if (!isWeekend(d)) workdays++;
  }
  return { items, logged, workdays };
}

// ─── «Нэгтгэл» — тухайн хугацаанд нийт юу хийсэн ─────────────────────────────

export type DigestPreset = 'week' | 'month' | 'prevMonth' | 'quarter' | 'year';
export const DIGEST_PRESETS: readonly DigestPreset[] = [
  'week',
  'month',
  'prevMonth',
  'quarter',
  'year',
];

/** Нэгтгэлийн муж (хоёр төгсгөл багтсан, өнөөдрөөс хэтрэхгүй). */
export function digestRange(preset: DigestPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'week':
      return { from: mondayOf(today), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'prevMonth': {
      const ym = shiftMonth(today.slice(0, 7), -1);
      return { from: `${ym}-01`, to: addDays(`${today.slice(0, 7)}-01`, -1) };
    }
    case 'quarter':
      return { from: addDays(today, -89), to: today };
    case 'year':
      return { from: addDays(today, -364), to: today };
  }
}

export interface DigestLog {
  log_date: string;
  items: readonly string[];
  late?: boolean;
  first_written_on?: string;
  edit_count?: number;
}

export interface DigestMonth<T extends DigestLog = DigestLog> {
  /** `YYYY-MM` */
  month: string;
  logs: T[];
  items: number;
}

/**
 * Өдрийн тайлангуудыг сараар бүлэглэнэ (шинээс хуучин руу), мужаас гадуурх
 * болон хоосон өдрийг хасна.
 */
export function groupDigest<T extends DigestLog>(
  logs: readonly T[],
  from: string,
  to: string,
): { months: DigestMonth<T>[]; days: number; items: number; late: number } {
  const kept = logs
    .filter((l) => l.log_date >= from && l.log_date <= to && l.items.length > 0)
    .slice()
    .sort((a, b) => (a.log_date < b.log_date ? 1 : a.log_date > b.log_date ? -1 : 0));
  const months: DigestMonth<T>[] = [];
  for (const l of kept) {
    const ym = l.log_date.slice(0, 7);
    let m = months[months.length - 1];
    if (!m || m.month !== ym) {
      m = { month: ym, logs: [], items: 0 };
      months.push(m);
    }
    m.logs.push(l);
    m.items += l.items.length;
  }
  return {
    months,
    days: kept.length,
    items: kept.reduce((n, l) => n + l.items.length, 0),
    late: kept.filter((l) => l.late).length,
  };
}
