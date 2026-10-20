/**
 * Багийн профайл — «Бүтээмж» таб (2026-09-24).  ЦЭВЭР функцүүд (D1-гүй, тесттэй);
 * D1 уншилт нь `teamProductivityStore.ts`, замууд нь `routes/teamProductivity.ts`.
 *
 * Эзний хүсэлт: баг дээр дарахад тухайн багийн статистик — хэдэн хувь нь ажлаа
 * хийсэн, хэд нь төсөлд орсон, хэд нь зохиогчийн хяналтаар явсан; гишүүн бүрийн
 * ӨДРИЙН ДУНДАЖ бүтээмжийн хувь; өдөр / 7 хоног / сараар, өнгөрснийг буцааж
 * шалгана.  Багийн хамгийн дээд ба хамгийн доод хүний зөрүү 20%-иас (захирал
 * өөрчилнө) хэтэрвэл улаан — захирал ахлахад анхааруулга илгээнэ.
 *
 * ── ТОДОРХОЙЛОЛТУУД ────────────────────────────────────────────────────
 *  • Бүтээмж = `user_points.amount`-ийн нийлбэр (таск + засвар + төслийн бус —
 *    Онооны самбар, Тайлан хуудастай ИЖИЛ эх сурвалж).
 *  • Өдрийн дундаж = хугацааны бүтээмж ÷ АЖИЛЛАХ ЁСТОЙ өдөр.  Ажиллах ёстой
 *    өдөр = ажлын өдөр (Даваа–Баасан, `holidays`-гүй; `leaveAvailability.ts`-ийн
 *    `workingDates`) − батлагдсан бүтэн өдрийн чөлөө.  Тиймээс чөлөө хувийг
 *    өсгөхгүй, бууруулахгүй (эзний 2026-09-24-ний дүрэм); чөлөөт өдөр бодитоор
 *    оноо авсан бол тэр нь энгийн ажлын өдөр (`loadLeaveNeutral`-тэй ижил).
 *    Чөлөөгүй тасалсан өдөр 0 оноотой ажлын өдөр хэвээр.  Амралтын өдөр авсан
 *    оноо нийлбэрт орно, хуваарьт орохгүй.
 *  • Хугацаанд шинээр орсон хүн (`users.created_at`) — ажлын өдрийг орсон
 *    өдрөөс нь тоолно.  Одоо явагдаж буй хугацааг өнөөдрөөр таслана.
 *  • Зөрүү = (дээд − доод) ÷ дээд × 100 — харьцангуй.  Өдрийн дундаж ~0.01–0.3%
 *    тул «20 хувийн пункт» хэзээ ч хүрэхгүй; эзний «20%» нь зөвхөн харьцангуйгаар
 *    утгатай.  Жишээ: 0.20% ба 0.15% → зөрүү 25% → хэтэрсэн.
 *  • Шугам = дээд × (1 − босго/100) — доод хүн хүрэх ёстой түвшин; түүнээс
 *    доош хүн бүрт «өдөрт +X% нэмэх хэрэгтэй» гэж харуулна.
 *  • 7 хоног = Даваа–Ням, сар = хуанлийн сар (өнгөрсөн хугацааг тогтвортой
 *    харьцуулахын тулд гулсах цонх БИШ).
 */
import { addDays, isWeekend } from './workSchedule';
import { lastDayOfMonth, monthAdd } from './reportWindows';
import { workingDates } from './leaveAvailability';

export type PeriodKind = 'day' | 'week' | 'month';
export const PERIOD_KINDS: readonly PeriodKind[] = ['day', 'week', 'month'];

/** Гишүүдийн зөрүүний анхдагч босго (%) — эзний «20%-иас хол байх ёсгүй». */
export const DEFAULT_GAP_THRESHOLD_PCT = 20;
/** `app_settings` түлхүүр — захирал өөрчилнө. */
export const GAP_THRESHOLD_SETTING_KEY = 'team_productivity.gap_threshold_pct';

/** Түүхийн графикт хэдэн хугацаа буцааж харуулах вэ. */
export const HISTORY_COUNT: Record<PeriodKind, number> = { day: 14, week: 12, month: 12 };

export function isPeriodKind(v: unknown): v is PeriodKind {
  return typeof v === 'string' && (PERIOD_KINDS as readonly string[]).includes(v);
}

export interface DateRange {
  from: string;
  to: string;
}

export interface ResolvedPeriod extends DateRange {
  kind: PeriodKind;
  /** Тоолох сүүлийн өдөр — одоо явагдаж буй хугацаанд өнөөдөр, бусад үед `to`. */
  until: string;
  /** Өнөөдөр энэ хугацаанд багтаж байна (дуусаагүй). */
  current: boolean;
  /** Өмнөх хугацааны нэг огноо (◀ товч). */
  prev_date: string;
  /** Дараагийн хугацааны нэг огноо (▶ товч) — ирээдүй бол null. */
  next_date: string | null;
}

/** Даваа гараг (YYYY-MM-DD) — `date`-ийг агуулсан 7 хоногийн эхлэл. */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Ням
  return addDays(date, -((dow + 6) % 7));
}

/** `kind`-ийн `date`-ийг агуулсан бүтэн хугацаа (өнөөдрөөр таслахгүй). */
export function periodRange(kind: PeriodKind, date: string): DateRange {
  if (kind === 'day') return { from: date, to: date };
  if (kind === 'week') {
    const from = weekStart(date);
    return { from, to: addDays(from, 6) };
  }
  const month = date.slice(0, 7);
  return { from: `${month}-01`, to: lastDayOfMonth(month) };
}

/** Өмнөх хугацааны бүтэн муж. */
export function previousRange(kind: PeriodKind, r: DateRange): DateRange {
  if (kind === 'month') return periodRange('month', `${monthAdd(r.from.slice(0, 7), -1)}-01`);
  return periodRange(kind, addDays(r.from, -1));
}

/**
 * Хүсэлтийн (`kind`, `date`) → хугацаа.  Ирээдүйн огноо өнөөдөр болж буурна —
 * ирээдүйн хугацааг харах утгагүй бөгөөд «шугам»-ыг хоосон өгөгдлөөр бодно.
 */
export function resolvePeriod(kind: PeriodKind, date: string, today: string): ResolvedPeriod {
  const d = date > today ? today : date;
  const r = periodRange(kind, d);
  const until = r.to < today ? r.to : today;
  const nextFrom = addDays(r.to, 1);
  return {
    kind,
    from: r.from,
    to: r.to,
    until,
    current: today >= r.from && today <= r.to,
    prev_date: previousRange(kind, r).from,
    next_date: nextFrom <= today ? nextFrom : null,
  };
}

/**
 * Түүхийн хугацаанууд — одоогийнхтой ХАМТ сүүлийн `count` ширхэг, хуучнаас
 * шинэ рүү.  Муж бүрийн `to`-г `until`-аар таслана (одоогийн хугацаа дуусаагүй).
 */
export function historyRanges(p: ResolvedPeriod, count: number): DateRange[] {
  const out: DateRange[] = [];
  let r: DateRange = { from: p.from, to: p.to };
  for (let i = 0; i < count; i++) {
    out.push({ from: r.from, to: r.to < p.until ? r.to : p.until });
    r = previousRange(p.kind, r);
  }
  return out.reverse();
}

/* ------------------------------------------------------------------ */
/*  Гишүүний өдрийн дундаж                                             */
/* ------------------------------------------------------------------ */

export interface MemberDaily {
  /** Бүртгэл үүссэн УБ огноо — хугацааны дунд орсон бол тэр өдрөөс тоолно. */
  joined: string | null;
  /** УБ огноо → бүтээмж (оноо). */
  points: ReadonlyMap<string, number> | undefined;
  /** Батлагдсан бүтэн өдрийн чөлөөтэй АЖЛЫН огноонууд (`leaveDatesByUser`). */
  leave: ReadonlySet<string> | undefined;
}

export interface MemberAverage {
  points: number;
  /** Ажиллах ёстой өдөр (ажлын өдөр − чөлөө), орсон өдрөөс. */
  work_days: number;
  /** Хасагдсан чөлөөт ажлын өдөр (оноо авсан чөлөөт өдөр тоологдохгүй). */
  leave_days: number;
  /** `work_days` 0 бол null — харьцуулалтад орохгүй (бүтэн чөлөө, амралтын өдөр). */
  avg: number | null;
}

export function sumPoints(points: ReadonlyMap<string, number> | undefined, r: DateRange): number {
  if (!points) return 0;
  let s = 0;
  for (const [d, v] of points) if (d >= r.from && d <= r.to) s += v;
  return s;
}

/**
 * ЦЭВЭР: гишүүний АЖИЛЛАХ ЁСТОЙ огноонууд (орсон өдрөөс, ажлын өдөр, чөлөөгүй)
 * + хасагдсан чөлөөт өдрийн тоо.  Ирц / ажил бүртгэсэн хувийн хуваарь ч энэ.
 */
export function memberWorkDates(
  m: MemberDaily,
  r: DateRange,
  holidays: ReadonlySet<string>,
): { dates: string[]; leave_days: number } {
  const start = m.joined && m.joined > r.from ? m.joined : r.from;
  if (start > r.to) return { dates: [], leave_days: 0 };
  const dates: string[] = [];
  let leaveDays = 0;
  for (const d of workingDates({ from: start, to: r.to }, holidays)) {
    if (m.leave?.has(d) && !((m.points?.get(d) ?? 0) > 0)) leaveDays += 1;
    else dates.push(d);
  }
  return { dates, leave_days: leaveDays };
}

/** ЦЭВЭР: нэг гишүүний мужийн бүтээмж ба өдрийн дундаж (дээрх тодорхойлолт). */
export function memberAverage(m: MemberDaily, r: DateRange, holidays: ReadonlySet<string>): MemberAverage {
  const points = sumPoints(m.points, r);
  const { dates, leave_days } = memberWorkDates(m, r, holidays);
  const workDays = dates.length;
  return { points, work_days: workDays, leave_days, avg: workDays > 0 ? points / workDays : null };
}

/** Мужид ажлын өдөр (амралт/баяргүй) байгаа эсэх — түүхийн графикийн цэг. */
export function hasWorkingDay(r: DateRange, holidays: ReadonlySet<string>): boolean {
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) if (!isWeekend(d) && !holidays.has(d)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/*  Зөрүү (дээд ↔ доод)                                                */
/* ------------------------------------------------------------------ */

export interface GapInput {
  user_id: number;
  avg: number | null;
}

export interface GapResult {
  /** Харьцуулалтад орсон гишүүн (дундаж нь тодорхой). */
  compared: number;
  top_user_id: number | null;
  top_avg: number | null;
  bottom_user_id: number | null;
  bottom_avg: number | null;
  /** (дээд − доод) ÷ дээд × 100; 2-оос цөөн хүн бол null. */
  gap_pct: number | null;
  /** Доод хүн хүрэх ёстой түвшин = дээд × (1 − босго/100). */
  line: number | null;
  threshold_pct: number;
  exceeded: boolean;
}

/**
 * ЦЭВЭР: багийн зөрүү.  Тэнцсэн үед user_id-аар тогтвортой эрэмбэлнэ.  Бүгд 0
 * бол зөрүү 0 (хэн ч хэнээс доогуур биш) — «шугам» мөн 0.
 */
export function computeGap(rows: readonly GapInput[], thresholdPct: number): GapResult {
  const cmp = rows
    .filter((r): r is { user_id: number; avg: number } => r.avg != null && Number.isFinite(r.avg))
    .sort((a, b) => b.avg - a.avg || a.user_id - b.user_id);
  const top = cmp[0] ?? null;
  const bottom = cmp.length > 0 ? cmp[cmp.length - 1]! : null;
  const base: GapResult = {
    compared: cmp.length,
    top_user_id: top?.user_id ?? null,
    top_avg: top?.avg ?? null,
    bottom_user_id: cmp.length >= 2 ? (bottom?.user_id ?? null) : null,
    bottom_avg: cmp.length >= 2 ? (bottom?.avg ?? null) : null,
    gap_pct: null,
    line: top ? top.avg * (1 - thresholdPct / 100) : null,
    threshold_pct: thresholdPct,
    exceeded: false,
  };
  if (!top || !bottom || cmp.length < 2) return base;
  // Нэг оронтой бөөрөнхийлж ДАРАА нь харьцуулна — 0.20 ба 0.16 гэхэд хөвөгч
  // таслалын алдаагаар 20.000000000000004 болж «хэтэрсэн» гэж гарахаас сэргийлнэ;
  // дэлгэц ч яг энэ утгыг харуулна.
  const gap = round1(top.avg > 0 ? ((top.avg - bottom.avg) / top.avg) * 100 : 0);
  return { ...base, gap_pct: gap, exceeded: gap > thresholdPct };
}

/** Дээд хүний хэдэн хувьд хүрсэн (дээд 0 эсвэл тодорхойгүй бол null). */
export function pctOfTop(avg: number | null, topAvg: number | null): number | null {
  if (avg == null || topAvg == null || !(topAvg > 0)) return null;
  return (avg / topAvg) * 100;
}

/** Шугамд хүрэхийн тулд өдөрт нэмэх хувь (шугамаас дээш бол 0). */
export function neededPerDay(avg: number | null, line: number | null): number | null {
  if (avg == null || line == null) return null;
  return Math.max(0, line - avg);
}

/** Босгыг ариутгана: 1–100, аравтын нэг орон; буруу утга → анхдагч 20. */
export function parseThresholdPct(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_GAP_THRESHOLD_PCT;
  const clamped = Math.min(100, Math.max(1, n));
  return Math.round(clamped * 10) / 10;
}

/** Оноо / дундаж — 4 орон (өдрийн дундаж 0.0005 хүртэл бага; reports.ts `roundPts`-тэй ижил). */
export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Хувь (зөрүү, дээд хүний %, ирцийн %) — 1 орон. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Хоёр тооны харьцаа хувиар (хуваагч 0 бол null). */
export function ratePct(num: number, den: number): number | null {
  return den > 0 ? round1((num / den) * 100) : null;
}

/* ------------------------------------------------------------------ */
/*  Анхааруулгын бичвэр                                                */
/* ------------------------------------------------------------------ */

/** Мэдэгдлийн бичвэрт — өдрийн дундажийг «0.056%» хэлбэрээр (3 орон хүртэл). */
export function fmtAvgPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const r = abs >= 1 ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000;
  return `${r}%`;
}

const PERIOD_WORD: Record<PeriodKind, string> = { day: 'өдөр', week: '7 хоног', month: 'сар' };

export function periodLabelMn(kind: PeriodKind, from: string, to: string): string {
  if (kind === 'day') return `${from} (${PERIOD_WORD.day})`;
  return `${from} – ${to} (${PERIOD_WORD[kind]})`;
}

export interface WarningTextInput {
  team_code: string;
  team_name: string;
  kind: PeriodKind;
  from: string;
  to: string;
  gap: GapResult;
  top_name: string | null;
  bottom_name: string | null;
  /** Шугамаас доош гишүүд (хамгийн доогуур нь эхэндээ). */
  below: ReadonlyArray<{ full_name: string; avg: number | null; need: number | null }>;
  note: string | null;
  sender_name: string;
}

/** Зөрүү / босгыг «25%», «12.5%» хэлбэрээр (илүү тэг үгүй). */
export function fmtPlainPct(v: number | null): string {
  return v == null || !Number.isFinite(v) ? '—' : `${round1(v)}%`;
}

/** Ахлах руу очих мэдэгдлийн гарчиг + бие (серверийн тоо — клиентийн тоонд итгэхгүй). */
export function buildWarningText(w: WarningTextInput): { title: string; body: string } {
  const title = `${w.team_code} баг: гишүүдийн бүтээмжийн зөрүү ${fmtPlainPct(w.gap.gap_pct)} (босго ${fmtPlainPct(w.gap.threshold_pct)})`;
  const lines: string[] = [];
  lines.push(`${w.team_name} · ${periodLabelMn(w.kind, w.from, w.to)}`);
  if (w.top_name) lines.push(`Хамгийн өндөр: ${w.top_name} — өдөрт ${fmtAvgPct(w.gap.top_avg)}`);
  if (w.bottom_name) lines.push(`Хамгийн бага: ${w.bottom_name} — өдөрт ${fmtAvgPct(w.gap.bottom_avg)}`);
  if (w.gap.line != null) {
    lines.push(`Шугам (дээд хүний ${fmtPlainPct(100 - w.gap.threshold_pct)}): өдөрт ${fmtAvgPct(w.gap.line)}`);
  }
  if (w.below.length > 0) {
    const shown = w.below.slice(0, 8).map((b) => `${b.full_name} ${fmtAvgPct(b.avg)} (+${fmtAvgPct(b.need)}/өдөр)`);
    const more = w.below.length > shown.length ? ` … +${w.below.length - shown.length}` : '';
    lines.push(`Шугамаас доош ${w.below.length} хүн: ${shown.join(', ')}${more}`);
  }
  if (w.note) lines.push(`Захирлын тэмдэглэл: ${w.note}`);
  lines.push(`Илгээсэн: ${w.sender_name}`);
  // Мэдэгдлийн жагсаалт / хонх нь мөр таслалыг хадгалдаггүй — бусад мэдэгдэлтэй
  // (`asrVisitPlan.ts`) ижил « · » тусгаарлагч.
  return { title, body: lines.join(' · ') };
}
