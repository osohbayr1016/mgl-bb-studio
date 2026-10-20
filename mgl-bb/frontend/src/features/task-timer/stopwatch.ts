/**
 * Албан таймерын ХАРУУЛАЛТ — Apple-ийн секундомерын дүрэм, серверийн цагтай
 * тааруулах, товч дармагц шууд харагдах (optimistic) төлөв.  ЦЭВЭР: import-гүй,
 * тиймээс `scripts/check-stopwatch.mjs` node-оор шууд ачаална.
 *
 * Canonical хугацаа нь СЕРВЕРИЙН сэшн хэвээр (0361).  Энд зөвхөн дэлгэц дээр
 * «секундомер шиг» гөлгөр, үсрэлтгүй харуулах дүрэм.
 */

export const HOUR_MS = 3_600_000;

/** Ёс: 1 цагаас доош `мм:сс.сс` + «м», дээш `Ц:ММ` + «ц» (эзэн 2026-10-08: нэгжгүй
 *  «01:02.57» нь «1 цаг 2 мин» гэж уншигддаг байсан — хоёр хэлбэр хоёулаа нэгжтэй). */
export interface StopwatchParts {
  /** «07:43» эсвэл «1:05». */
  main: string;
  /** «.21» (1 цагаас доош) эсвэл ''. */
  frac: string;
  /** 'm' (1 цагаас доош — «минут:секунд») эсвэл 'h' (дээш — «цаг:минут»). */
  unit: 'm' | 'h';
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * Секундомер шиг: доош нь ХЭЗЭЭ Ч дугуйлахгүй (59:59.99 → дараагийн агшинд 1:00).
 * Сөрөг / NaN → 0.
 */
export function formatStopwatch(ms: number): StopwatchParts {
  const t = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  if (t < HOUR_MS) {
    const m = Math.floor(t / 60_000);
    const s = Math.floor((t % 60_000) / 1000);
    const cs = Math.floor((t % 1000) / 10);
    return { main: `${pad2(m)}:${pad2(s)}`, frac: `.${pad2(cs)}`, unit: 'm' };
  }
  const h = Math.floor(t / HOUR_MS);
  const m = Math.floor((t % HOUR_MS) / 60_000);
  return { main: `${h}:${pad2(m)}`, frac: '', unit: 'h' };
}

/** Дэлгэцийн дараагийн өөрчлөлт хүртэл хэдэн мс (1 цагаас дээш — минутын хил). */
export function msUntilNextChange(ms: number): number {
  if (ms < HOUR_MS) return 10;
  return 60_000 - (Math.floor(ms) % 60_000);
}

/* ------------------------------------------------------------------ */
/*  Цайны цаг — тоолохгүй (эзэн 2026-10-01)                            */
/* ------------------------------------------------------------------ */

/**
 * Цайны цонхонд (прод 13:00–14:00 УБ) албан цаг ТООЛОГДОХГҮЙ: явж буй тоолуур
 * хөлдөж, цонх дуусахад өөрөө үргэлжилнэ.  Дүрэм нь backend `lib/taskTimer.ts`
 * (`lunchOverlapMs`, `countedMs`)-ийн ИХЭР — `scripts/check-stopwatch.mjs`
 * хоёуланг санамсаргүй интервалаар тулгана.  Цонхыг сервер өгнө (`/state`,
 * `/live` хариуны `lunch`) — ирцийн цайны тохиргоо, 2026-10-01-нээс.
 */
export interface LunchRule {
  /** УБ-ын 00:00-ээс хойш минут — цонх [startMin, endMin). */
  startMin: number;
  endMin: number;
  /** Энэ УБ өдрөөс ('YYYY-MM-DD') эхлэн. */
  fromDate: string;
  /** УБ → 480. */
  offsetMin: number;
}

const DAY_MS = 86_400_000;

/** Серверийн `lunch` ({start_min, end_min, from, offset_min}) → дүрэм; байхгүй/буруу бол null. */
export function lunchRuleOf(raw: unknown): LunchRule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { start_min: a, end_min: b, from, offset_min: off } = r;
  if (typeof a !== 'number' || typeof b !== 'number' || typeof off !== 'number' || typeof from !== 'string') return null;
  if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(off) || !(b > a)) return null;
  return { startMin: a, endMin: b, fromDate: from, offsetMin: off };
}

const ubDate = (ms: number, off: number) => new Date(ms + off * 60_000).toISOString().slice(0, 10);
const ubDayStart = (ms: number, off: number) => Date.parse(`${ubDate(ms, off)}T00:00:00Z`) - off * 60_000;

/** [aMs, bMs) ба өдөр бүрийн цайны цонхны давхцал (мс). */
export function lunchOverlapMs(aMs: number, bMs: number, lunch: LunchRule | null): number {
  if (!lunch || !(bMs > aMs)) return 0;
  let total = 0;
  for (let day = ubDayStart(aMs, lunch.offsetMin); day < bMs; day += DAY_MS) {
    if (ubDate(day, lunch.offsetMin) < lunch.fromDate) continue;
    const ls = day + lunch.startMin * 60_000;
    const le = day + lunch.endMin * 60_000;
    total += Math.max(0, Math.min(bMs, le) - Math.max(aMs, ls));
  }
  return total;
}

/** [aMs, bMs) хугацааны АЛБАН мс = үргэлжлэл − цайны цаг (хоосон бол 0). */
export function countedMs(aMs: number, bMs: number, lunch: LunchRule | null): number {
  if (!(bMs > aMs)) return 0;
  return bMs - aMs - lunchOverlapMs(aMs, bMs, lunch);
}

/** Одоо цайны цонх дотор уу; дараагийн хил (цонх эхлэх / дуусах) хэзээ (мс). */
export function lunchStateAt(nowMs: number, lunch: LunchRule | null): { inLunch: boolean; nextEdgeMs: number | null } {
  if (!lunch || !Number.isFinite(nowMs)) return { inLunch: false, nextEdgeMs: null };
  const day = ubDayStart(nowMs, lunch.offsetMin);
  const ls = day + lunch.startMin * 60_000;
  const le = day + lunch.endMin * 60_000;
  if (nowMs >= ls && nowMs < le) {
    return { inLunch: ubDate(day, lunch.offsetMin) >= lunch.fromDate, nextEdgeMs: le };
  }
  return { inLunch: false, nextEdgeMs: nowMs < ls ? ls : ls + DAY_MS };
}

/** 780 → '13:00'. */
export function minutesToHHMM(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

/* ------------------------------------------------------------------ */
/*  Серверийн цаг ↔ хөтчийн монотон цаг                                */
/* ------------------------------------------------------------------ */

/** `serverMs` = серверийн цаг, `perf` = тэр агшны `performance.now()`. */
export interface ClockAnchor {
  serverMs: number;
  perf: number;
}

/** Үүнээс их ухралт = унтах/сэрэх, цаг солих — шууд дахин тааруулна. */
export const RESYNC_MS = 1000;

/**
 * Шинэ хариу ирэхэд зангууг шинэчлэх эсэх.  Хариу бүр сүлжээний хоцролттой
 * (ирэхдээ аль хэдийн хуучирсан) тул хамгийн «шинэ» дээж нь хамгийн зөв:
 * урагшаа зөрвөл (бага хоцролттой дээж) шууд авна, хойшоо бага зөрвөл
 * (их хоцролттой) ҮЛ ТООНО — ингэснээр 15 с тутмын тулгалт дэлгэцийг хэзээ ч
 * хойш үсрүүлэхгүй.  Хойшоо `RESYNC_MS`-ээс их бол цаг эвдэрсэн → дахин.
 */
export function nextAnchor(prev: ClockAnchor | null, serverMs: number, perf: number): ClockAnchor | null {
  if (!Number.isFinite(serverMs)) return prev;
  if (!prev) return { serverMs, perf };
  const predicted = prev.serverMs + (perf - prev.perf);
  const diff = serverMs - predicted;
  return diff > 0 || diff < -RESYNC_MS ? { serverMs, perf } : prev;
}

export function anchorNow(a: ClockAnchor | null, perf: number, fallbackMs: number): number {
  return a ? a.serverMs + (perf - a.perf) : fallbackMs;
}

/* ------------------------------------------------------------------ */
/*  Товч дармагц харагдах төлөв                                        */
/* ------------------------------------------------------------------ */

/** Серверээс ирсэн явж буй сэшн (шаардлагатай талбар л). */
export interface RunningLike {
  session_id: number;
  task_id: number;
  started_at: string;
}

/** Хэрэглэгчийн дарсан, серверийн хариу хараахан ирээгүй үйлдэл.
 *  `taskId === null` = ⏸.  `atMs` = дарсан агшин (серверийн цагаар). */
export interface OptimisticAction {
  seq: number;
  taskId: number | null;
  atMs: number;
}

/** Дэлгэцэн дээрх эхлэл: энэ табд ▶ дарсан бол ДАРСАН агшин (тасралтгүй),
 *  эс бөгөөс серверийн `started_at`. */
export function sinceOf(r: RunningLike, overrides: ReadonlyMap<number, number>): number {
  return overrides.get(r.session_id) ?? Date.parse(r.started_at);
}

/**
 * Дэлгэцийн төлөв = серверийн төлөв + (байвал) хүлээгдэж буй үйлдэл.
 *   running  — одоо явж буй таск ба түүний дэлгэцийн эхлэл;
 *   stopped  — хүлээгдэж буй үйлдлээр ДӨНГӨЖ зогссон таск (дарсан агшинд
 *              хөлдөнө): түүний дууссан нийлбэрт `ms`-ийг нэмнэ.
 */
export function effectiveTimer(
  server: RunningLike | null,
  pending: OptimisticAction | null,
  overrides: ReadonlyMap<number, number>,
): {
  running: { task_id: number; since: number } | null;
  stopped: { task_id: number; since: number; until: number } | null;
} {
  const serverRun = server ? { task_id: server.task_id, since: sinceOf(server, overrides) } : null;
  if (!pending) return { running: serverRun, stopped: null };
  if (serverRun && pending.taskId === serverRun.task_id) return { running: serverRun, stopped: null };
  return {
    running: pending.taskId === null ? null : { task_id: pending.taskId, since: pending.atMs },
    stopped: serverRun ? { task_id: serverRun.task_id, since: serverRun.since, until: pending.atMs } : null,
  };
}

/**
 * Хариу ирэхэд: энэ табын ▶ дарсан агшныг тухайн сэшний дэлгэцийн эхлэл болгох
 * уу?  Сервер ≈ дарснаас хэдэн зуун мс-ийн дараа эхэлдэг — зөрүү бага бол
 * дарсан агшнаас үргэлжлүүлнэ (дэлгэц хойш үсрэхгүй), их бол серверийнх.
 */
export const OVERRIDE_TOLERANCE_MS = 1500;
export function keepClickStart(serverStartedAt: string, clickMs: number): boolean {
  const s = Date.parse(serverStartedAt);
  return Number.isFinite(s) && Math.abs(s - clickMs) <= OVERRIDE_TOLERANCE_MS;
}
