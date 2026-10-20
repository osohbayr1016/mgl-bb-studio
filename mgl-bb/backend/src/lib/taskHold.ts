/**
 * Таск дээр зарцуулсан АЖЛЫН ӨДӨР — цэвэр дүрэм (2026-09-25, migration 0350).
 *
 * Эзний дүрэм:
 *   • Таскийг өөртөө авсан / админ оноосон өдрөөс тоолж эхэлнэ.
 *   • Ажлын өдөр = Даваа–Баасан, `holidays`-д бүртгэлтэй өдөр БИШ.
 *   • Таскаа буцаагаад дахин авбал ТАСРАЛТГҮЙ үргэлжилнэ: 7 өдөр ажиллаад
 *     буцаасан хүн дахин авбал 8 дахь өдрөөс — буцаасан хоорондох өдрүүд
 *     тоологдохгүй.
 *   • Хүн тус бүрд тусдаа (А-гийн 7 өдөр Б-д шилжихгүй).
 *
 * Нэг өдөр хэд авч/буцаасан ч тэр өдөр НЭГ л удаа тоологдоно (хугацааны
 * огнооны НЭГДЭЛ).  Авсан өдөр өөрөө 1-р өдөр.
 *
 * 100% БОЛОХОД ЗОГСОНО (эзэн 2026-09-29: «анх авсан өдрөөс 100% болох хүртэлх
 * өдөр — дууссан таск 88, 89 дэх өдөр болж явах ёсгүй»).  Таск 100% болсон
 * өдөр өөрөө тоологдоно (тэр өдөр дуусгасан), түүнээс хойшхи өдөр тоологдохгүй.
 * Дараа нь хэн нэгэн 100%-иас доош бөглөвөл (дахин нээгдсэн) тэр өдрөөс эхлэн
 * дахин тоологдоно — дууссан хоорондох өдрүүд тоологдохгүй.  Дүрэм нь
 * `doneSpans()`-д; хүн тус бүрийн мужаас хасагдана.
 *
 * Энэ файл юу ч импортлохгүй — `node --test` hook-гүйгээр ачаална.
 */

/** УБ огнооны хаалттай муж [from, to] (YYYY-MM-DD). */
export interface HoldSpan {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function isWeekend(date: string): boolean {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** SQLite UTC ('YYYY-MM-DD HH:MM:SS') эсвэл ISO огноо → байгууллагын огноо. */
export function utcToLocalDate(utc: string, offsetMinutes: number): string | null {
  const s = utc.trim();
  if (!s) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s.replace(' ', 'T') : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Эзэмшлийн хугацааг огнооны муж болгоно.  `endedUtc = null` = одоо ч эзэмшиж
 * байна (өнөөдөр хүртэл).  Эвдэрсэн огноо / урвуу муж → null.
 */
export function holdSpan(
  startedUtc: string,
  endedUtc: string | null,
  today: string,
  offsetMinutes: number,
): HoldSpan | null {
  const from = utcToLocalDate(startedUtc, offsetMinutes);
  if (!from) return null;
  const to = endedUtc === null ? today : utcToLocalDate(endedUtc, offsetMinutes);
  if (!to) return null;
  // Ирээдүйд эхэлсэн мэт (цагийн зөрүү) — өнөөдрөөр хязгаарлана.
  const end = to > today ? today : to;
  if (from > end) return null;
  return { from, to: end };
}

/** Таскийн нэг батлагдсан явцын бичлэг (`progress_entries`, status='approved'). */
export interface ProgressPoint {
  /** Бичлэгийн ажлын өдөр (`progress_entries.date`, УБ YYYY-MM-DD). */
  date: string;
  percentage: number;
}

export interface DoneState {
  /** Таск ДУУССАН байсан өдрүүд (100% болсон өдрийн ДАРААХ өдрөөс дахин
   *  нээгдсэн өдрийн ӨМНӨХ өдөр хүртэл; одоо ч дууссан бол `to` = '9999-12-31'). */
  spans: HoldSpan[];
  /** Одоо 100% байгаа бол сүүлд 100% болсон өдөр, эс бөгөөс null. */
  doneOn: string | null;
}

const OPEN_END = '9999-12-31';

/**
 * Батлагдсан бичлэгүүдээс таск хэзээ дууссан байсныг гаргана.  `points` нь
 * «сүүлийн батлагдсан явц»-ын дарааллаар (`created_at, id` өсөх — төслийн
 * хуудас ба «Миний ажлууд»-ын `byCreatedAt` дүрэм) ирнэ.  Амрах/«Маргааш»
 * бичлэг өмнөх хувийг хуулдаг тул таскийг дахин нээхгүй.
 */
export function doneSpans(points: readonly ProgressPoint[]): DoneState {
  const spans: HoldSpan[] = [];
  let doneOn: string | null = null;
  for (const p of points) {
    const done = Number(p.percentage) >= 100;
    if (done && doneOn === null) {
      doneOn = p.date;
    } else if (!done && doneOn !== null) {
      // Дахин нээгдсэн өдөр өөрөө ажлын өдөр — зөвхөн хоорондох өдрүүд хасагдана.
      const from = addDays(doneOn, 1);
      const to = addDays(p.date, -1);
      if (from <= to) spans.push({ from, to });
      doneOn = null;
    }
  }
  if (doneOn !== null) spans.push({ from: addDays(doneOn, 1), to: OPEN_END });
  return { spans, doneOn };
}

/** Мужуудын НЭГДЛИЙН ажлын өдрийн тоо; `excluded` (таск дууссан өдрүүд) тоологдохгүй. */
export function countHoldDays(
  spans: readonly HoldSpan[],
  holidays: ReadonlySet<string>,
  excluded: readonly HoldSpan[] = [],
): number {
  const seen = new Set<string>();
  for (const s of spans) {
    for (let d = s.from; d <= s.to; d = addDays(d, 1)) {
      if (isWeekend(d) || holidays.has(d)) continue;
      if (excluded.some((x) => d >= x.from && d <= x.to)) continue;
      seen.add(d);
    }
  }
  return seen.size;
}

/** Хамгийн эртний эхлэл — баярын өдрийг уншихад хэрэгтэй доод хил. */
export function earliestFrom(spans: readonly HoldSpan[]): string | null {
  let min: string | null = null;
  for (const s of spans) if (min === null || s.from < min) min = s.from;
  return min;
}
