/**
 * ЗХ-ийн төслийн самбарын ХУГАЦАА — «9-р сарын 1-ээс 9-р сарын 30 хүртэл».
 *
 * Цэвэр функцууд (`scripts/check-asr-board.mjs` node-оор шалгана): зөвхөн
 * `YYYY-MM-DD` мөртэй ажиллаж, `Date`-ийг ЗӨВХӨН UTC-ээр хэрэглэнэ — хөтчийн
 * цагийн бүс огноог нэг өдрөөр шилжүүлэхгүй.  `report_date` нь цаггүй
 * огноо тул мөрөөр харьцуулахад хангалттай.
 *
 * `from` / `to` нь хоёулаа ОРОЛЦОНО (inclusive).  `null` = тэр талдаа
 * хязгааргүй; хоёулаа `null` = «Бүх хугацаа».
 */

export type AsrRangePreset = 'all' | 'thisMonth' | 'lastMonth' | 'last3Months' | 'thisYear';

/** Товчны дараалал = UI дахь дараалал. */
export const ASR_RANGE_PRESETS: readonly AsrRangePreset[] = [
  'all',
  'thisMonth',
  'lastMonth',
  'last3Months',
  'thisYear',
];

export interface AsrRange {
  from: string | null;
  to: string | null;
}

export const ALL_RANGE: AsrRange = { from: null, to: null };

const DAY_MS = 86_400_000;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Бодит огноо мөн эсэх (`2026-02-30` → false). */
export function isYmd(s: string | null | undefined): s is string {
  if (!s) return false;
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return fromUtc(t) === s;
}

function toUtc(ymd: string): number {
  const m = YMD_RE.exec(ymd);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function ymOf(ymd: string): { year: number; month: number } {
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) };
}

/** Сарын 1 (`monthOffset`-оор шилжүүлсэн, он давна). */
function monthStart(year: number, month: number, monthOffset = 0): string {
  return fromUtc(Date.UTC(year, month - 1 + monthOffset, 1));
}

/** Сарын сүүлийн өдөр (`monthOffset`-оор шилжүүлсэн). */
function monthEnd(year: number, month: number, monthOffset = 0): string {
  return fromUtc(Date.UTC(year, month + monthOffset, 0));
}

export function addDays(ymd: string, n: number): string {
  return fromUtc(toUtc(ymd) + n * DAY_MS);
}

/** Хоёр огнооны хоорондох өдөр, ХОЁУЛАНГ нь оруулна (`a` = `b` → 1). */
export function daysInclusive(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS) + 1;
}

/** 0 = Ням … 6 = Бямба (`asr.plans.weekdayInitials`-ийн дараалал). */
export function weekdayOf(ymd: string): number {
  return new Date(toUtc(ymd)).getUTCDay();
}

export function presetRange(preset: AsrRangePreset, today: string): AsrRange {
  const { year, month } = ymOf(today);
  switch (preset) {
    case 'all':
      return ALL_RANGE;
    case 'thisMonth':
      return { from: monthStart(year, month), to: monthEnd(year, month) };
    case 'lastMonth':
      return { from: monthStart(year, month, -1), to: monthEnd(year, month, -1) };
    case 'last3Months':
      return { from: monthStart(year, month, -2), to: monthEnd(year, month) };
    case 'thisYear':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
}

/** Нэг бүтэн сар — жагсаалтын сарын толгойн «Зөвхөн энэ сар». */
export function monthRange(year: number, month: number): AsrRange {
  return { from: monthStart(year, month), to: monthEnd(year, month) };
}

/** Одоогийн мужид таарах товч — таарахгүй бол `'custom'` (гараар сонгосон). */
export function matchPreset(range: AsrRange, today: string): AsrRangePreset | 'custom' {
  for (const p of ASR_RANGE_PRESETS) {
    const r = presetRange(p, today);
    if (r.from === range.from && r.to === range.to) return p;
  }
  return 'custom';
}

/**
 * URL / оролтоос ирсэн утгыг цэвэрлэнэ: буруу огноо → `null` (тэр тал
 * хязгааргүй), `from > to` бол солино (хэрэглэгч эхлэх огноог дуусахаас
 * хойш сонгосон нь «тэр хоёрын хооронд» гэсэн л утгатай).
 */
export function normalizeRange(from: string | null | undefined, to: string | null | undefined): AsrRange {
  const f = isYmd(from) ? from : null;
  const t = isYmd(to) ? to : null;
  if (f && t && f > t) return { from: t, to: f };
  return { from: f, to: t };
}

export function isAllRange(range: AsrRange): boolean {
  return range.from == null && range.to == null;
}

export function inRange(date: string | null | undefined, range: AsrRange): boolean {
  if (!date) return false;
  const d = date.slice(0, 10);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

/**
 * Муж нь БҮТЭН сараар (1-нээс сарын сүүлч хүртэл) таарвал хэдэн сар
 * хамрахыг буцаана — ◀ ▶ тэр тоогоор САРААР шилжинэ («9-р сар» → «8-р сар»,
 * хоногоор шилжвэл 31/30 хоногийн сарууд хоорондоо гулсана).
 */
export function monthSpan(range: AsrRange): number | null {
  if (!range.from || !range.to) return null;
  if (range.from.slice(8) !== '01') return null;
  const end = ymOf(range.to);
  if (range.to !== monthEnd(end.year, end.month)) return null;
  const start = ymOf(range.from);
  const n = (end.year - start.year) * 12 + (end.month - start.month) + 1;
  return n > 0 ? n : null;
}

/** ◀ (`-1`) / ▶ (`+1`) — нээлттэй мужид `null` (шилжүүлэх утгагүй). */
export function shiftRange(range: AsrRange, dir: -1 | 1): AsrRange | null {
  if (!range.from || !range.to) return null;
  const span = monthSpan(range);
  if (span != null) {
    const s = ymOf(range.from);
    return {
      from: monthStart(s.year, s.month, dir * span),
      to: monthEnd(s.year, s.month, dir * span + span - 1),
    };
  }
  const days = daysInclusive(range.from, range.to);
  return { from: addDays(range.from, dir * days), to: addDays(range.to, dir * days) };
}

export type AsrRangeLabel =
  | { kind: 'all' }
  | { kind: 'month'; year: number; month: number }
  | { kind: 'year'; year: number }
  | { kind: 'months'; from: string; to: string }
  | { kind: 'days'; from: string; to: string }
  | { kind: 'fromOnly'; from: string }
  | { kind: 'toOnly'; to: string };

/** Мужийг хүн уншихаар ангилна — бичвэрийг компонент i18n-ээр угсарна. */
export function describeRange(range: AsrRange): AsrRangeLabel {
  if (!range.from && !range.to) return { kind: 'all' };
  if (range.from && !range.to) return { kind: 'fromOnly', from: range.from };
  if (!range.from && range.to) return { kind: 'toOnly', to: range.to };
  const from = range.from!;
  const to = range.to!;
  const span = monthSpan(range);
  if (span === 1) return { kind: 'month', ...ymOf(from) };
  if (span === 12 && from.slice(5) === '01-01') return { kind: 'year', year: ymOf(from).year };
  if (span != null) return { kind: 'months', from, to };
  return { kind: 'days', from, to };
}

/* ------------------------------------------------------------------ */
/*  «Хэн хэзээ явсан» графикийн тэнхлэг                                */
/* ------------------------------------------------------------------ */

export interface AsrAxisDomain {
  from: string;
  to: string;
  days: number;
}

/**
 * Графикийн хэвтээ тэнхлэг.  Хязгаартай мужид ЯГ тэр муж; нээлттэй талыг
 * өгөгдлөөр нөхөж, сарын хил рүү дугуйлна (5-р сарын 5 → 5-р сарын 1) —
 * тэнхлэг сараар таслагдсан үед уншихад хялбар.  Өгөгдөлгүй нээлттэй
 * мужид `null` (зурах зүйл алга).
 */
export function axisDomain(range: AsrRange, dates: readonly string[], today: string): AsrAxisDomain | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const d of dates) {
    if (!isYmd(d)) continue;
    if (min == null || d < min) min = d;
    if (max == null || d > max) max = d;
  }
  let from = range.from;
  let to = range.to;
  if (!from) {
    if (!min) return null;
    const m = ymOf(min);
    from = monthStart(m.year, m.month);
  }
  if (!to) {
    const last = max && max > today ? max : today;
    const m = ymOf(last);
    to = monthEnd(m.year, m.month);
  }
  if (from > to) return null;
  return { from, to, days: daysInclusive(from, to) };
}

/** Огнооны төв хэвтээ байрлал (%) — өдөр бүр ижил өргөнтэй нүд. */
export function positionPct(date: string, domain: AsrAxisDomain): number {
  const i = daysInclusive(domain.from, date) - 1;
  return ((i + 0.5) / domain.days) * 100;
}

export interface AsrAxisTick {
  date: string;
  /** `month` = сарын 1 (сарын нэр), `week` = Даваа гараг (`MM-DD`). */
  kind: 'month' | 'week';
  /** Зай багатай үед зарим шошгыг нууна — зураас хэвээр. */
  showLabel: boolean;
  /** Хүрээний эхний өдрөөс хэдэн хувьд (өдрийн ЗҮҮН ирмэг). */
  pct: number;
}

/**
 * ≤ 62 хоног → 7 хоног бүр (Даваа), үгүй бол сар бүрийн 1.  Сарын шошго
 * 12-оос олон бол алгасаж харуулна (хэт шахагдаж давхцахгүй).
 */
export function axisTicks(domain: AsrAxisDomain): AsrAxisTick[] {
  const edge = (d: string) => ((daysInclusive(domain.from, d) - 1) / domain.days) * 100;
  const ticks: AsrAxisTick[] = [];
  if (domain.days <= 62) {
    // Эхний Даваа гараг хүртэл урагшилна.
    let d = domain.from;
    while (weekdayOf(d) !== 1) d = addDays(d, 1);
    for (; d <= domain.to; d = addDays(d, 7)) {
      ticks.push({ date: d, kind: 'week', showLabel: true, pct: edge(d) });
    }
    return ticks;
  }
  const s = ymOf(domain.from);
  const months: string[] = [];
  for (let i = 0; ; i++) {
    const d = monthStart(s.year, s.month, i);
    if (d > domain.to) break;
    if (d >= domain.from) months.push(d);
  }
  const step = Math.max(1, Math.ceil(months.length / 12));
  months.forEach((d, i) => {
    ticks.push({ date: d, kind: 'month', showLabel: i % step === 0, pct: edge(d) });
  });
  return ticks;
}
