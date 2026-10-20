/**
 * Гантт тэнхлэгийн цэвэр математик. React / DOM / чарт сангийн import ҮГҮЙ —
 * бүгд детерминистик, тусад нь эргэцүүлж болно.
 *
 * Repo-д огнооны сан (date-fns / dayjs / luxon) БАЙХГҮЙ тул гараар бичив.
 * Бүх огноо нь 'YYYY-MM-DD' хуанлийн мөр бөгөөд UTC шөнө дундаар
 * (`new Date(\`${iso}T00:00:00Z\`)`) уншина — `features/projects/lib/forecast.ts`-
 * ийн зөвшилцөлтэй яг ижил, ингэснээр гаригийн тооцоо цагийн бүсээс хамаарахгүй.
 *
 * ⚠ БАТЛАГААГҮЙ ОРОЛТ: `project_passport.start_date` / `finish_date` нь
 * чөлөөт текст багана — бодит өгөгдөлд '-' гэх мэт утга БАЙДАГ. Тул энэ
 * файлын парс хийх бүх зам «уншиж чадахгүй → байхгүй» гэж үзнэ, ХЭЗЭЭ Ч
 * throw хийхгүй.
 *
 * ЗӨВШИЛЦӨЛ (2026-08): томруулалт нь гурван тогтмол шат БИШ, ТАСРАЛТГҮЙ —
 * бүх геометр `pxPerDay: number`-ээс гарна (TradingView маягийн ctrl+дугуй).
 * `Zoom` нэр нь зөвхөн товчлууруудын үсрэх цэг (`ZOOM_PRESETS`) болж үлдэв:
 * тэмдэглэгээний нягтралыг zoom-ийн НЭР биш, `tierFor(pxPerDay)` шийднэ.
 *
 * Туршилтын runner байхгүй тул forecast.ts шиг `// EXPECT:` мөрөөр
 * хүлээгдэж буй утгыг баримтжуулав.
 */

import type { TimelineProject, Zoom } from '../types';

const DAY_MS = 86_400_000;

/** Товчлууруудын үсрэх цэгүүд (px/хоног). Дундах бүх утга ч хүчинтэй. */
export const ZOOM_PRESETS: Record<Zoom, number> = {
  // `day` нь `tierFor`-ийн DAY_TIER_MIN (16)-аас ХАМААРАЛГҮЙ дээгүүр байх ёстой
  // — 48px дээр сарын өдрийн тоо тайван суудаг, ~25 хоног дэлгэцэнд багтана.
  day: 48,
  week: 34,
  month: 9,
  quarter: 3,
};

/** Хамгийн жижиг томруулалт — ~3 жил нэг дэлгэцэнд багтана. */
export const MIN_PX_PER_DAY = 1.6;
/** Хамгийн том томруулалт — нэг хоног 72px, өдрийн шошго тайван суумаар. */
export const MAX_PX_PER_DAY = 72;

/** Эхлэл эсвэл төгсгөлийн аль нэг нь дутуу үед нөхөх хиймэл урт (хоног). */
const STUB_DAYS = 14;
/** Хамгийн эртний огнооны өмнөх зай (хоног). */
const PAD_BEFORE = 14;
/** Хамгийн хожуу огнооны дараах зай (хоног). */
const PAD_AFTER = 30;
/** Хог огноо DOM-ыг хийсгэхээс сэргийлэх дээд хязгаар. */
const MAX_TOTAL_DAYS = 1200;
/** Хамгийн жижиг томруулалт дээр 1 хоногийн баар алга болохоос сэргийлнэ. */
const MIN_BAR_PX = 6;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function isoOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 2 оронтой болгож бөөрөнхийлнө — px-ийн хөвөгч цэгийн хог арилгана. */
function round2(px: number): number {
  return Math.round(px * 100) / 100;
}

/** `[MIN, MAX]` хооронд хумина. Тоо биш утга ирвэл `month` preset рүү унана. */
export function clampPxPerDay(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_PRESETS.month;
  return Math.min(MAX_PX_PER_DAY, Math.max(MIN_PX_PER_DAY, value));
}
// EXPECT: clampPxPerDay(0) === MIN_PX_PER_DAY
// EXPECT: clampPxPerDay(1e6) === MAX_PX_PER_DAY
// EXPECT: clampPxPerDay(9) === 9
// EXPECT: clampPxPerDay(NaN) === ZOOM_PRESETS.month   ← хэзээ ч NaN тарааж болохгүй

/**
 * Дотоод хамгаалалт: геометрийн функцууд NaN / 0 / сөрөг px хүлээж авахгүй.
 * ЗОРИУДААР `clampPxPerDay` БИШ — дуудагч тал MAX-аас дээш утга өгвөл
 * `chartWidth`-тэй зөрөхгүйн тулд утгыг нь хэвээр нь хүндэтгэнэ, зөвхөн
 * утгагүй тоог л барина.
 */
function safePx(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : ZOOM_PRESETS.month;
}

/**
 * 'YYYY-MM-DD' → epoch ms (UTC шөнө дунд). Уншиж чадахгүй бол null.
 *
 * Буцаагаад ISO болгож ТУЛГАНА: V8 нь '2026-02-31'-ийг Invalid Date гэж
 * үзэхгүй, чимээгүйхэн 2026-03-03 болгож хөрвүүлдэг (эмпирикээр шалгав).
 * Тийм огноог 3 хоног гаруулж зурахаас илүү «байхгүй» гэж үзэх нь backend-ийн
 * `isIsoDate` (хатуу хуанлийн шалгалт)-тай нийцнэ.
 */
function toMs(iso: string | null | undefined): number | null {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return null;
  const ms = new Date(`${iso}T00:00:00Z`).getTime();
  if (Number.isNaN(ms)) return null;
  return isoOf(ms) === iso ? ms : null;
}
// EXPECT: toMs('2026-08-06') === Date.UTC(2026, 7, 6)
// EXPECT: toMs('-') === null            ← паспортод бодитоор байдаг утга
// EXPECT: toMs('2026-13-01') === null   ← Invalid Date
// EXPECT: toMs('2026-02-31') === null   ← V8 нь 2026-03-03 болгодог; round-trip барина
// EXPECT: toMs(null) === null

/** `iso` + `n` хоног (хуанлийн, амралтын өдрийг АЛГАСАХГҮЙ).
 *  Уншиж чадахгүй огноог хэвээр нь буцаана. */
export function addDaysIso(iso: string, n: number): string {
  const ms = toMs(iso);
  if (ms === null) return iso;
  return isoOf(ms + Math.round(n) * DAY_MS);
}

/** `toIso` − `fromIso`, хуанлийн хоногоор (тэмдэгтэй). Аль нэг нь
 *  уншигдахгүй бол 0 — дуудагч тал «зөрүүгүй» гэж авч үзнэ. */
export function diffDays(fromIso: string, toIso: string): number {
  const a = toMs(fromIso);
  const b = toMs(toIso);
  if (a === null || b === null) return 0;
  return Math.round((b - a) / DAY_MS);
}
// EXPECT: diffDays('2026-08-06', '2026-08-13') === 7
// EXPECT: diffDays('2026-08-13', '2026-08-06') === -7
// EXPECT: diffDays('2026-08-06', '-') === 0

/** Тухайн долоо хоногийн ДАВАА гараг. */
export function startOfWeekIso(iso: string): string {
  const ms = toMs(iso);
  if (ms === null) return iso;
  const dow = new Date(ms).getUTCDay(); // 0=Ня … 6=Бя
  const back = (dow + 6) % 7; // Даваа=0, Ня=6
  return isoOf(ms - back * DAY_MS);
}
// EXPECT: startOfWeekIso('2026-08-06') === '2026-08-03'  (Пү → тухайн 7 хоногийн Даваа)
// EXPECT: startOfWeekIso('2026-08-03') === '2026-08-03'  (Даваа өөрөө)
// EXPECT: startOfWeekIso('2026-08-02') === '2026-07-27'  (Ням → өмнөх Даваа)

/** Тухайн сарын 1-ний өдөр. */
export function startOfMonthIso(iso: string): string {
  const ms = toMs(iso);
  if (ms === null) return iso;
  return `${iso.slice(0, 7)}-01`;
}
// EXPECT: startOfMonthIso('2026-08-06') === '2026-08-01'

/** Огноогүй талыг 14 хоногийн бодит бус «шилбэ»-гээр нөхөж, төслийн
 *  эзлэх хугацааг [lo, hi] ms болгож буцаана. Хоёул байхгүй бол null. */
function projectSpanMs(
  start: string | null,
  finish: string | null,
): { lo: number; hi: number } | null {
  const s = toMs(start);
  const f = toMs(finish);
  if (s === null && f === null) return null;
  const from = s ?? (f as number) - STUB_DAYS * DAY_MS;
  const to = f ?? (s as number) + STUB_DAYS * DAY_MS;
  return { lo: Math.min(from, to), hi: Math.max(from, to) };
}

/** Тэнхлэгийн хүрээ: (хамгийн эрт огноо, өнөөдөр)-ийн бага нь − 14 хоногоос
 *  (хамгийн хожуу огноо, өнөөдөр)-ийн их нь + 30 хоног хүртэл.
 *  `end === addDaysIso(origin, totalDays)` үргэлж биелнэ. */
export function buildRange(
  projects: TimelineProject[],
  todayIso: string,
): { origin: string; end: string; totalDays: number } {
  const todayMs = toMs(todayIso) ?? toMs(isoOf(Date.now())) ?? 0;

  let minMs = todayMs;
  let maxMs = todayMs;
  for (const p of projects) {
    const span = projectSpanMs(p.start_date, p.finish_date);
    if (!span) continue;
    if (span.lo < minMs) minMs = span.lo;
    if (span.hi > maxMs) maxMs = span.hi;
  }

  const originMs = minMs - PAD_BEFORE * DAY_MS;
  const rawDays = Math.round((maxMs + PAD_AFTER * DAY_MS - originMs) / DAY_MS);
  const totalDays = Math.max(1, Math.min(MAX_TOTAL_DAYS, rawDays));
  const origin = isoOf(originMs);
  return { origin, end: addDaysIso(origin, totalDays), totalDays };
}
// EXPECT: buildRange([], '2026-08-06')
//   → { origin: '2026-07-23', end: '2026-09-05', totalDays: 44 }   (14 + 30)
// EXPECT: огноогүй (эсвэл '-' огноотой) төсөл хүрээг ОГТ өргөтгөхгүй
// EXPECT: totalDays <= 1200 үргэлж — 3000 оны finish_date ч DOM-ыг хийсгэхгүй

/** DOM хамгаалалт — `totalDays`-ийг [0, MAX_TOTAL_DAYS] руу хумина. */
function clampDays(totalDays: number): number {
  if (!Number.isFinite(totalDays)) return 0;
  return Math.max(0, Math.min(MAX_TOTAL_DAYS, Math.round(totalDays)));
}

/** Тэмдэглэгээний нягтралын шат. */
export type TickTier = 'day' | 'week' | 'month' | 'quarter';

/** `day` шат руу орох босго (px/хоног). */
const DAY_TIER_MIN = 16;
/** `week` шат руу орох босго. */
const WEEK_TIER_MIN = 6;
/** `month` шат руу орох босго. */
const MONTH_TIER_MIN = 2.2;

/**
 * Нягтралыг ЗӨВХӨН pxPerDay шийднэ — zoom-ийн НЭР биш.
 *
 * Босгууд нь «шошго давхцахгүй хамгийн бага зай» гэдгээс гарсан: өдрийн
 * тоо (2 тэмдэгт) ойролцоогоор 16px эзэлдэг тул түүнээс нягт үед өдөр
 * бүрийг зурахаа болино (энэ нь дэлгэцийн зургийн саарал «түрхээс» аврах
 * гол засвар).
 */
export function tierFor(pxPerDay: number): TickTier {
  const px = safePx(pxPerDay);
  if (px >= DAY_TIER_MIN) return 'day';
  if (px >= WEEK_TIER_MIN) return 'week';
  if (px >= MONTH_TIER_MIN) return 'month';
  return 'quarter';
}
// EXPECT: tierFor(16) === 'day'     ← босго ӨӨРӨӨ day-д хамаарна
// EXPECT: tierFor(15.9) === 'week'
// EXPECT: tierFor(6) === 'week'
// EXPECT: tierFor(5.9) === 'month'
// EXPECT: tierFor(2.2) === 'month'
// EXPECT: tierFor(2.19) === 'quarter'
// EXPECT: tierFor(ZOOM_PRESETS.week) === 'day'      (34)
// EXPECT: tierFor(ZOOM_PRESETS.month) === 'week'    (9)
// EXPECT: tierFor(ZOOM_PRESETS.quarter) === 'month' (3)
// EXPECT: tierFor(NaN) === 'week'   ← month preset рүү унаад week шат гарна

export interface AxisTick {
  iso: string;
  /** Тэнхлэгийн зүүн ирмэгээс хэмжсэн px. */
  x: number;
  label: string;
  /**
   * «Илүү тод шугам зурмаар ХИЛ» гэсэн утга. Шатнаас хамаарна:
   *   day     → Даваа гараг (7 хоногийн эхлэл)
   *   week    → сарыг нээж буй Даваа (сарын 1–7)
   *   month   → улирлын эхлэл (1/4/7/10-р сар)
   *   quarter → бүх тэмдэг (тэд бүгд улирлын эхлэл)
   *
   * ⚠ Амралтын өдрийг ХЭЗЭЭ Ч major болгохгүй — тэр «эрээн түрхэс» нь
   * яг л засаж байгаа алдаа. Бямба/Ням-ыг `buildWeekendSpans` сүүдэрлэнэ.
   */
  major: boolean;
}

/** Дээд мөрийн зурвас — сар (эсвэл жил) бүрд нэг, өргөнтэй. */
export interface AxisBand {
  iso: string;
  /** Зурвасын зүүн ирмэг, 0-ээр хумигдсан (эхний зурвас тэнхлэгээс өмнө эхэлдэг). */
  x: number;
  /** Харагдах өргөн — сүүлийн зурвас тэнхлэгийн төгсгөлөөр тайрагдана. */
  width: number;
  label: string;
}

function shortMonth(d: Date, lang: 'mn' | 'en'): string {
  // Чарт тэнхлэгийн одоо байгаа зөвшилцөл (ProjectChartsTab.tsx) — зөвхөн
  // САРЫН НЭР локалчлагдана, бусад бүх огноо ISO 'YYYY-MM-DD' хэвээр.
  // mn-MN → «8-р сар», en-GB → «Aug».
  return d.toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });
}

/**
 * Тэнхлэгийн хуваарийн зураас + шошго.
 *
 * Шошго нь ЗОРИУДААР богино: `day`/`week` шатанд зөвхөн САРЫН ӨДӨР ('16').
 * Сар/жилийг дээд мөрийн зурвас (`buildBands`) хэлж өгнө — өмнөх '7/16'
 * хэлбэр 26px тутамд давтагдаж уншигдахгүй болсон.
 */
export function buildTicks(
  origin: string,
  totalDays: number,
  pxPerDay: number,
  lang: 'mn' | 'en',
): AxisTick[] {
  const originMs = toMs(origin);
  if (originMs === null) return [];
  const days = clampDays(totalDays);
  const px = safePx(pxPerDay);
  const tier = tierFor(px);
  const ticks: AxisTick[] = [];

  for (let i = 0; i <= days; i++) {
    const ms = originMs + i * DAY_MS;
    const d = new Date(ms);
    const dow = d.getUTCDay();
    const dom = d.getUTCDate();
    const mon = d.getUTCMonth();
    const x = round2(i * px);

    if (tier === 'day') {
      // Өдөр бүр, шошго нь зөвхөн сарын өдөр. Даваа = 7 хоногийн хил.
      ticks.push({ iso: isoOf(ms), x, label: String(dom), major: dow === 1 });
      continue;
    }

    if (tier === 'week') {
      if (dow !== 1) continue; // зөвхөн Даваа
      // Сарыг нээж буй Даваа нь илүү тод — уншигч сарын хилийг олж харна.
      ticks.push({ iso: isoOf(ms), x, label: String(dom), major: dom <= 7 });
      continue;
    }

    if (dom !== 1) continue; // month / quarter — зөвхөн сарын 1-ний өдөр
    if (tier === 'quarter' && mon % 3 !== 0) continue; // зөвхөн 1/4/7/10-р сар
    ticks.push({ iso: isoOf(ms), x, label: shortMonth(d, lang), major: mon % 3 === 0 });
  }

  return ticks;
}
// EXPECT: buildTicks('2026-08-03', 13, 34, 'mn')[0]
//   → { iso:'2026-08-03', x:0, label:'3', major:true }     (Даваа)
// EXPECT: day шатанд 2026-08-08 (Бямба) → major === false  ← эрээн түрхэс дахин гарахгүй
// EXPECT: buildTicks(origin, days, 9, 'mn') нь ЗӨВХӨН Даваа гаригуудыг буцаана
//   (7 хоногт 1 зураас), шошго нь сарын өдөр ('3'), сарын 1–7-ны Даваа → major
// EXPECT: buildTicks(origin, days, 3, 'mn') нь сар бүрийн 1-нийг буцаана;
//   шошго нь сарын нэр ('8-р сар' / 'Aug'), 1/4/7/10-р сар → major
// EXPECT: buildTicks(origin, days, 1.6, 'mn') нь ЗӨВХӨН 1/4/7/10-р сарын
//   1-нийг буцаана, бүгд major
// EXPECT: buildTicks('-', 40, 34, 'mn') → []   (throw хийхгүй)

/**
 * Дээд мөрийн зурвасууд — `day`/`week` шатанд САР тутамд, `month`/`quarter`
 * шатанд ЖИЛ тутамд нэг. Зурвасууд нь тэнхлэгийг ЦООРХОЙГҮЙ бүрхэнэ:
 * `bands[i].x + bands[i].width === bands[i + 1].x`.
 */
export function buildBands(
  origin: string,
  totalDays: number,
  pxPerDay: number,
  lang: 'mn' | 'en',
): AxisBand[] {
  const originMs = toMs(origin);
  if (originMs === null) return [];
  const days = clampDays(totalDays);
  const px = safePx(pxPerDay);
  const axisWidth = round2(days * px);
  const tier = tierFor(px);
  const byYear = tier === 'month' || tier === 'quarter';

  const bands: AxisBand[] = [];
  let i = 0;
  while (i <= days) {
    const d = new Date(originMs + i * DAY_MS);
    const year = d.getUTCFullYear();
    const mon = d.getUTCMonth();
    // Тухайн зурвасын жинхэнэ эхлэл — эхний зурвас нь тэнхлэгээс ӨМНӨ
    // эхэлж болно (origin нь сарын дунд), тэр үед x нь 0 болж тайрагдана.
    const startMs = byYear ? Date.UTC(year, 0, 1) : Date.UTC(year, mon, 1);
    const nextMs = byYear ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, mon + 1, 1);

    const left = Math.max(0, round2(((startMs - originMs) / DAY_MS) * px));
    const right = Math.min(axisWidth, round2(((nextMs - originMs) / DAY_MS) * px));
    if (right > left) {
      bands.push({
        iso: isoOf(startMs),
        x: left,
        width: round2(right - left),
        label: byYear ? String(year) : `${year} ${shortMonth(d, lang)}`,
      });
    }

    // Дараагийн зурвасын эхний өдөр рүү үсэрнэ (үргэлж ХАТУУ урагшилна).
    i = Math.round((nextMs - originMs) / DAY_MS);
  }

  return bands;
}
// EXPECT: buildBands('2026-07-23', 44, 34, 'mn')
//   → [{ iso:'2026-07-01', x:0, …, label:'2026 7-р сар' },
//      { iso:'2026-08-01', x:306, …, label:'2026 8-р сар' },  (9 хоног × 34px)
//      { iso:'2026-09-01', …, label:'2026 9-р сар' }]
// EXPECT: эхний зурвасын x === 0 үргэлж (origin сарын дунд байсан ч)
// EXPECT: bands[i].x + bands[i].width === bands[i+1].x  — цоорхойгүй бүрхэлт
// EXPECT: сүүлийн зурвасын x + width === totalDays * pxPerDay (тэнхлэгээр тайрагдана)
// EXPECT: pxPerDay === 3 (month шат) үед зурвас нь ЖИЛ болно → label '2026'
// EXPECT: buildBands('-', 44, 34, 'mn') → []

/**
 * Амралтын өдрийн сүүдэрлэх багана. Зөвхөн `tier === 'day'` үед буцаана —
 * түүнээс нягт үед 2 хоног 12px болж, сүүдэр нь өөрөө шуугиан болно.
 * Бямба+Ням хоёрыг НЭГ багана болгож нийлүүлнэ (DOM хоёр дахин бага).
 */
export function buildWeekendSpans(
  origin: string,
  totalDays: number,
  pxPerDay: number,
): { x: number; width: number }[] {
  const originMs = toMs(origin);
  if (originMs === null) return [];
  const px = safePx(pxPerDay);
  if (tierFor(px) !== 'day') return [];

  const days = clampDays(totalDays);
  const axisWidth = round2(days * px);
  const spans: { x: number; width: number }[] = [];

  for (let i = 0; i < days; i++) {
    const dow = new Date(originMs + i * DAY_MS).getUTCDay();
    if (dow !== 6 && dow !== 0) continue;
    // Ням гараг нь өмнөх Бямбын 2 хоногийн баганад аль хэдийн орсон.
    // Цорын ганц үл хамаарах зүйл: тэнхлэг ӨӨРӨӨ Ням гарагаас эхэлсэн үе.
    if (dow === 0 && i > 0) continue;

    const left = round2(i * px);
    const right = Math.min(axisWidth, round2((i + (dow === 6 ? 2 : 1)) * px));
    if (right > left) spans.push({ x: left, width: round2(right - left) });
  }

  return spans;
}
// EXPECT: buildWeekendSpans('2026-08-03', 14, 34)
//   → [{ x: 170, width: 68 }, { x: 408, width: 68 }]   (Бя 8/8 = 5 дахь өдөр)
// EXPECT: buildWeekendSpans('2026-08-03', 14, 9) → []   (week шат — сүүдэрлэхгүй)
// EXPECT: буцаах бүх багана [0, totalDays * pxPerDay] дотор багтана
// EXPECT: buildWeekendSpans('-', 14, 34) → []

/** Огнооны px байрлал (тэнхлэгийн зүүн ирмэгээс).
 *  Уншигдахгүй огноо → 0 (diffDays 0 буцаадаг тул). */
export function xForDate(iso: string, origin: string, pxPerDay: number): number {
  return round2(diffDays(origin, iso) * safePx(pxPerDay));
}
// EXPECT: xForDate('2026-08-06', '2026-08-03', 34) === 102   (3 хоног × 34px)
// EXPECT: xForDate('-', '2026-08-03', 34) === 0

/** Нэг төслийн баарны геометр. Хоёр огноо ч байхгүй бол null (баар
 *  зурахгүй — тэр төсөл «хуваарьгүй» хэсэгт харагдана).
 *  `openStart` / `openEnd` нь тухайн тал нь ТААМАГЛАСАН 14 хоногийн шилбэ
 *  гэдгийг илтгэнэ — дуудагч тал тэр ирмэгийг бүдэг/зураастай зурна. */
export function barGeometry(
  start: string | null,
  finish: string | null,
  origin: string,
  pxPerDay: number,
): { left: number; width: number; openStart: boolean; openEnd: boolean } | null {
  const span = projectSpanMs(start, finish);
  const originMs = toMs(origin);
  if (!span || originMs === null) return null;

  const px = safePx(pxPerDay);
  const left = round2(((span.lo - originMs) / DAY_MS) * px);
  const spanDays = Math.round((span.hi - span.lo) / DAY_MS) + 1; // төгсгөлийн өдрийг оруулна
  const width = Math.max(MIN_BAR_PX, round2(spanDays * px));

  return {
    left,
    width,
    openStart: toMs(start) === null,
    openEnd: toMs(finish) === null,
  };
}
// EXPECT: barGeometry('2026-08-03','2026-08-07','2026-08-03', 34)
//   → { left: 0, width: 170, openStart: false, openEnd: false }   (5 өдөр × 34px)
// EXPECT: barGeometry(null, null, '2026-08-03', 34) === null
// EXPECT: barGeometry('2026-08-03', '-', '2026-08-03', 34).openEnd === true
//   (finish уншигдахгүй → 14 хоногийн шилбэ, ирмэг нээлттэй)
// EXPECT: MIN_PX_PER_DAY дээр 1 өдрийн баар ч гэсэн width >= 6px
