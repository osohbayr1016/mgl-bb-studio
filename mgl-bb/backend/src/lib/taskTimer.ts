/**
 * АЛБАН ЁСНЫ ТАСКИЙН ЦАГ ХЭМЖИГЧ (OFFICIAL_TASK_TIMER) — цэвэр дүрэм (migration 0361).
 *
 * Захирлын шийдвэр (2026-09-29): ажилтан таскийнхаа цагийг ӨӨРӨӨ эхлүүлнэ,
 * зогсооно, өөр таск эхлүүлбэл өмнөх нь автоматаар зогсож шинэ нь эхэлнэ.
 * Захирал/админд харагдах албан ёсны цаг ЗӨВХӨН эндээс.
 *
 * 2026-10-01 (эзэн): цаг ЭХЛЭХ нь төслийн хуудасны «Өөртөө авах» — тэр нь
 * таскийг авахын НЭГ АЛХАМ (`lib/taskTake.ts`).  Таск дээрх НЭР = энэ таймер нь
 * тэр таск дээр ОДОО явж буй хүн.  Цаг нь зөвхөн тухайн хүн өөрөө + админд.
 *
 * ⚠️ REVIT_ACTIVE_TIME (0360 `revit_work_segments`, `lib/revitTracking.ts`) нь
 *    ТУСДАА, далд систем.  Энэ файл түүнийг ХЭЗЭЭ Ч уншихгүй, нэмэхгүй,
 *    дундажлахгүй — хоёр тоог дараа нь харьцуулж болохоор салангид хадгална.
 *    Тиймээс API/төрлийн нэр бүр `official_` угтвартай (ерөнхий «worked_ms» биш).
 *
 * Энэ файл D1-гүй (тест `taskTimer.test.ts`); уншилт/бичилт `taskTimerStore.ts`.
 *
 * Цаг: бүх цэг СЕРВЕРИЙН UTC ISO (`Date#toISOString`, үргэлж 24 тэмдэгт …Z) —
 * тиймээс SQLite дээр мөр харьцуулалт (`MAX`, `>=`) цагийн дараалалтай ижил.
 * «Өнөөдөр» = УБ-ын өдөр, УНШИХДАА тайрна (шөнө дундыг давсан хэсэг хоёр өдөрт
 * хуваагдана) — хадгалсан цаг хэзээ ч УБ-ын ханын цаг биш.
 */

/** Албан таймер эхлүүлж болох үүрэг — `canSelfClaim`-ийн ажилтны олонлог + admin
 *  (CEO өөрөө таск авдаг).  worker/client-ийг `workerScope`/`clientScope` аль
 *  хэдийн 403 хийдэг; энд давхар хаалт. */
export const OFFICIAL_TIMER_ROLES = ['admin', 'senior', 'engineer', 'architect'] as const;

/** Сэшн зогсох шалтгаан — 0361-ийн CHECK-тэй ИХЭР. */
export type OfficialTimerEndReason = 'pause' | 'switch' | 'auto_stop_completed' | 'auto_stop_deleted';

/** Аудитын үйлдэл — 0361 `task_timer_events.action`-ийн CHECK-тэй ИХЭР. */
export type OfficialTimerAction = 'start' | 'pause' | 'switch' | 'auto_stop_completed' | 'auto_stop_deleted';

/** `POST /start`-ийн үр дүн. */
export type OfficialTimerStartOutcome = 'started' | 'switched' | 'already_running';

/** Цагийн хүрээ (УБ-ын нэг буюу хэд хэдэн өдөр) — `[startMs, endMs)`. */
export interface TimeWindow {
  startMs: number;
  endMs: number;
}

/** Уншихад хэрэгтэй сэшний хэсэг. */
export interface OfficialTimerSessionLite {
  task_id: number;
  started_at: string;
  ended_at: string | null;
}

const DAY_MS = 86_400_000;

/** ISO → мс.  Эвдэрсэн утга NaN биш 0 буцаана (тоолуур хэзээ ч NaN болохгүй). */
export function isoMs(iso: string): number {
  const v = Date.parse(iso);
  return Number.isFinite(v) ? v : 0;
}

/** 'YYYY-MM-DD' (УБ) → тэр өдрийн UTC хил.  `offsetMinutes` = УБ → 480. */
export function ubDayWindow(date: string, offsetMinutes: number): TimeWindow {
  const startMs = Date.parse(`${date}T00:00:00Z`) - offsetMinutes * 60_000;
  return { startMs, endMs: startMs + DAY_MS };
}

/** [from, to] (УБ, хоёулаа багтсан) мужийн хил. */
export function ubRangeWindow(from: string, to: string, offsetMinutes: number): TimeWindow {
  return {
    startMs: ubDayWindow(from, offsetMinutes).startMs,
    endMs: ubDayWindow(to, offsetMinutes).endMs,
  };
}

/** UTC мс → УБ-ын 'YYYY-MM-DD'. */
export function ubDateOf(ms: number, offsetMinutes: number): string {
  return new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/*  Цайны цаг — тоолохгүй (эзэн 2026-10-01)                            */
/* ------------------------------------------------------------------ */

/**
 * ЦАЙНЫ ЦАГ (эзэн 2026-10-01): цайны цонхонд (прод 13:00–14:00 УБ) албан таймер
 * ТООЛОХГҮЙ — цаг явж байсан ч тэр хооронд хөлдөж, цонх дуусахад өөрөө
 * үргэлжилнэ; цайны цагт эхлүүлсэн таймер цонх дуусахаас тоолж эхэлнэ.
 * Сэшнийг ХААХГҮЙ (таск дээрх нэр хэвээр) — зөвхөн ТООЦООЛОХДОО цонхтой
 * давхцсан хэсгийг хасна.  Тиймээс бичилт хөндөгдөөгүй: `duration_ms` нь
 * ТҮҮХИЙ үргэлжлэл (аудит) хэвээр — албан нийлбэрийг ХЭЗЭЭ Ч `SUM(duration_ms)`-
 * оор бүү ав, `officialMsSql` / `countedMs`-ээр.
 *
 * Цонх = ирцийн ЯГ тэр тохиргоо (`app_settings.lunch_enabled/_start/_end`,
 * `lib/settings.ts`) — нэг эх сурвалж; ирцэд унтраавал таймер ч хасахгүй.
 * Эзний шийдвэр: ЗӨВХӨН `OFFICIAL_LUNCH_FROM`-оос хойших УБ өдрүүдэд — өмнөх
 * өдрүүдийн бүртгэл хэвээр.
 * Frontend ИХЭР: `features/task-timer/stopwatch.ts` (`lunchOverlapMs`, `countedMs`) —
 * `npm run check:stopwatch` хоёуланг санамсаргүй интервалаар тулгана.
 */
export const OFFICIAL_LUNCH_FROM = '2026-10-01';

export interface OfficialLunch {
  /** УБ-ын 00:00-ээс хойш минут — цонх нь [startMin, endMin). */
  startMin: number;
  endMin: number;
  /** Энэ УБ өдрөөс ('YYYY-MM-DD') эхлэн хасна. */
  fromDate: string;
  /** УБ → 480. */
  offsetMinutes: number;
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function hhmmMinutes(v: string): number | null {
  const m = HHMM_RE.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Ирцийн тохиргооноос (`getAttendanceSettings`) — унтраасан / буруу цонх бол null. */
export function officialLunchOf(
  s: { lunchEnabled: boolean; lunchStart: string; lunchEnd: string },
  offsetMinutes: number,
): OfficialLunch | null {
  if (!s.lunchEnabled || !Number.isInteger(offsetMinutes)) return null;
  const startMin = hhmmMinutes(s.lunchStart);
  const endMin = hhmmMinutes(s.lunchEnd);
  if (startMin === null || endMin === null || endMin <= startMin) return null;
  return { startMin, endMin, fromDate: OFFICIAL_LUNCH_FROM, offsetMinutes };
}

/** [aMs, bMs) хугацаа ба өдөр бүрийн цайны цонхны давхцал (мс). */
export function lunchOverlapMs(aMs: number, bMs: number, lunch: OfficialLunch | null): number {
  if (!lunch || !(bMs > aMs)) return 0;
  const off = lunch.offsetMinutes;
  let total = 0;
  for (let day = ubDayWindow(ubDateOf(aMs, off), off).startMs; day < bMs; day += DAY_MS) {
    if (ubDateOf(day, off) < lunch.fromDate) continue;
    const ls = day + lunch.startMin * 60_000;
    const le = day + lunch.endMin * 60_000;
    total += Math.max(0, Math.min(bMs, le) - Math.max(aMs, ls));
  }
  return total;
}

/** [aMs, bMs) хугацааны АЛБАН мс = үргэлжлэл − цайны цаг (хоосон бол 0). */
export function countedMs(aMs: number, bMs: number, lunch: OfficialLunch | null): number {
  if (!(bMs > aMs)) return 0;
  return bMs - aMs - lunchOverlapMs(aMs, bMs, lunch);
}

/**
 * SQL: ХААГДСАН сэшний албан мс (цайны цаг хассан) — `countedMs`-ийн ИХЭР.
 * Сэшн эхэлсэн УБ өдрийн 23:59:59.999-д заавал хаагддаг (`sweepDayEndTimers`)
 * тул эхэлсэн өдөр ба дараагийн ХОЁР өдрийн цонхыг л хасна — ≤ 48 цагийн сэшн
 * (оройн 19:51-д эхэлсэн 44 цагийн сэшн 3 УБ өдрийг дамнадаг) JS-тэй ЯГ ижил
 * (`taskTimer.test.ts` санамсаргүй интервалаар тулгана).
 * Тогтмолуудыг (бүхэл минут, шалгасан огноо) SQL-д ШИГТГЭНЭ — дуудагчийн bind-ийн
 * дараалал (`?1…`) хөдлөхгүй.
 */
export function officialMsSql(alias: string, lunch: OfficialLunch | null): string {
  const s = `${alias}.started_at`;
  const e = `${alias}.ended_at`;
  const raw = `(julianday(${e}) - julianday(${s})) * 86400000.0`;
  if (!lunch) return `MAX(0, CAST(ROUND(${raw}) AS INTEGER))`;
  const { startMin, endMin, offsetMinutes: off, fromDate } = lunch;
  if (![startMin, endMin, off].every(Number.isInteger) || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) {
    throw new Error('officialMsSql: invalid lunch window');
  }
  const shift = `${off >= 0 ? '+' : ''}${off} minutes`;
  const term = (k: number) => {
    const day = `date(${s}, '${shift}', '+${k} days')`;
    const ls = `(julianday(${day}) + ${startMin - off} / 1440.0)`;
    const le = `(julianday(${day}) + ${endMin - off} / 1440.0)`;
    return `(CASE WHEN ${day} >= '${fromDate}' THEN MAX(0.0, (MIN(julianday(${e}), ${le}) - MAX(julianday(${s}), ${ls})) * 86400000.0) ELSE 0.0 END)`;
  };
  return `MAX(0, CAST(ROUND(${raw} - ${term(0)} - ${term(1)} - ${term(2)}) AS INTEGER))`;
}

/** Сэшний төгсгөл (мс) — явж буй бол `nowMs`, гэхдээ эхлэлээс өмнө хэзээ ч биш. */
function endOf(s: OfficialTimerSessionLite, nowMs: number): number {
  const start = isoMs(s.started_at);
  const end = s.ended_at === null ? nowMs : isoMs(s.ended_at);
  return Math.max(start, end);
}

/** Нэг сэшний албан үргэлжлэл (мс, цайны цаг хассан). */
export function sessionMs(s: OfficialTimerSessionLite, nowMs: number, lunch: OfficialLunch | null): number {
  return countedMs(isoMs(s.started_at), endOf(s, nowMs), lunch);
}

/** Сэшний `win` цонхонд багтах албан хэсэг (мс, цайны цаг хассан). */
export function clippedMs(
  s: OfficialTimerSessionLite,
  nowMs: number,
  win: TimeWindow,
  lunch: OfficialLunch | null,
): number {
  const a = Math.max(isoMs(s.started_at), win.startMs);
  const b = Math.min(endOf(s, nowMs), win.endMs);
  return countedMs(a, b, lunch);
}

/** Цонх доторх нийт ба таск тус бүрийн албан цаг. */
export function summarizeWindow(
  sessions: readonly OfficialTimerSessionLite[],
  nowMs: number,
  win: TimeWindow,
  lunch: OfficialLunch | null,
): { official_ms: number; by_task: Map<number, number> } {
  const byTask = new Map<number, number>();
  let total = 0;
  for (const s of sessions) {
    const ms = clippedMs(s, nowMs, win, lunch);
    if (ms <= 0) continue;
    total += ms;
    byTask.set(s.task_id, (byTask.get(s.task_id) ?? 0) + ms);
  }
  return { official_ms: total, by_task: byTask };
}

/**
 * Сэшнүүдийг УБ-ын өдөр тус бүрээр хуваана (өдрийн тайлан): шөнө дундыг давсан
 * сэшн хоёр өдөрт хуваагдаж, өдөр бүр зөвхөн өөрийн хэсгийг авна (цайны цаг хассан).
 * Буцаах: огноо → (таск → мс), зөвхөн [from, to] доторх, 0-ээс их.
 */
export function splitByUbDay(
  sessions: readonly OfficialTimerSessionLite[],
  nowMs: number,
  offsetMinutes: number,
  from: string,
  to: string,
  lunch: OfficialLunch | null,
): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  const range = ubRangeWindow(from, to, offsetMinutes);
  for (const s of sessions) {
    let a = Math.max(isoMs(s.started_at), range.startMs);
    const b = Math.min(endOf(s, nowMs), range.endMs);
    while (a < b) {
      const date = ubDateOf(a, offsetMinutes);
      const dayEnd = ubDayWindow(date, offsetMinutes).endMs;
      const piece = countedMs(a, Math.min(b, dayEnd), lunch);
      if (piece > 0) {
        const byTask = out.get(date) ?? new Map<number, number>();
        byTask.set(s.task_id, (byTask.get(s.task_id) ?? 0) + piece);
        out.set(date, byTask);
      }
      a = dayEnd;
    }
  }
  return out;
}

/** Нэг ажилтны [from, to] мужийн нийлбэр (тайлангийн «Таскийн цаг» таб). */
export interface OfficialTimerRangeSummary {
  official_ms: number;
  /** Цаг бүртгэгдсэн УБ-ын өдрийн тоо (амралтын өдөр ч орно). */
  active_days: number;
  /** Мужид цаг нь хүрсэн сэшний тоо. */
  sessions: number;
  /** Мужид цаг бүртгэгдсэн ялгаатай таскийн тоо. */
  tasks: number;
}

export function summarizeRange(
  sessions: readonly OfficialTimerSessionLite[],
  nowMs: number,
  offsetMinutes: number,
  from: string,
  to: string,
  lunch: OfficialLunch | null,
): OfficialTimerRangeSummary {
  const byDay = splitByUbDay(sessions, nowMs, offsetMinutes, from, to, lunch);
  const tasks = new Set<number>();
  let total = 0;
  for (const byTask of byDay.values()) {
    for (const [taskId, ms] of byTask) {
      total += ms;
      tasks.add(taskId);
    }
  }
  const win = ubRangeWindow(from, to, offsetMinutes);
  return {
    official_ms: total,
    active_days: byDay.size,
    sessions: sessions.filter((s) => clippedMs(s, nowMs, win, lunch) > 0).length,
    tasks: tasks.size,
  };
}

/** `POST /start`-ийн batch-ийн `changes`-ээс үр дүн. */
export function startOutcome(closedRows: number, insertedRows: number): OfficialTimerStartOutcome {
  if (insertedRows === 0) return 'already_running';
  return closedRows > 0 ? 'switched' : 'started';
}

/**
 * Сэшн ЯАГААД зогссоныг нарийвчилна (migration 0368 `end_note` / event `note`).
 * `end_reason`-ийн 0361-ийн CHECK олонлог ӨӨРЧЛӨГДӨӨГҮЙ (хүснэгт rebuild хийхгүйн
 * тулд) — `end_note` нь түүнийг тодруулна:
 *   pause  + clock_out   — ирцээ «Гарах» бүртгэсэн (эзэн 2026-10-01);
 *   pause  + day_end     — 23:59-д автоматаар (мартсан цаг), `ended_by = 0` систем;
 *   pause  + admin_stop  — админ гараар зогсоосон;
 *   switch + split       — таскийг хуваахад тухайн хүн өөрийн шинэ хэсэг рүү шилжсэн.
 * NULL = өмнөх утга (гараар зогсоосон / өөр таск авсан / таск дууссан).
 */
export type OfficialTimerEndNote =
  | 'clock_out'
  | 'day_end'
  | 'admin_stop'
  | 'split'
  // 2026-10-02 (таскийн хуваарилалт): ирээдүйн ажлаа буцаасан/алдсан, өөрийн хэсгээ дууссан, сэшнээ хүчингүй болгосон.
  | 'alloc_release'
  | 'alloc_complete'
  | 'void';

/** Системийн үйлдлийн `actor_id` / `ended_by` (хэрэглэгч биш — 23:59-ийн зогсолт). */
export const SYSTEM_ACTOR_ID = 0;

/**
 * Шөнө дундыг давж мартагдсан сэшний ЗОГСОХ агшин: эхэлсэн УБ өдрийн 23:59:59.999
 * (эзэн 2026-10-01: «гарахаа мартсан бол тэр өдрийн 23:59-д зогсоно»).
 */
export function dayEndCutoffIso(startedAtIso: string, offsetMinutes: number): string {
  const day = ubDateOf(isoMs(startedAtIso), offsetMinutes);
  return new Date(ubDayWindow(day, offsetMinutes).endMs - 1).toISOString();
}

/** Хүн/хэрэгслээс ирсэн ISO цагийг (жишээ нь ирцийн `…+08:00`) сессийн хадгалдаг
 *  UTC `…Z` хэлбэрт хөрвүүлнэ — SQL-ийн `MAX(started_at, ?)` нь МӨР харьцуулдаг тул
 *  өөр бүсийн бичлэг холилдвол цагийн дараалал эвдэрнэ.  Эвдэрсэн бол null. */
export function toUtcIso(iso: string): string | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
