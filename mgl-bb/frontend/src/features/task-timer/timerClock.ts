import { anchorNow, lunchRuleOf, lunchStateAt, nextAnchor, type ClockAnchor, type LunchRule } from './stopwatch';

/**
 * Табын ГАНЦ серверийн цаг (модулийн түвшинд — хуудас, карт бүгд хуваалцана).
 * Хариу бүрийн `server_now`-ийг хүлээж авсан агшны `performance.now()`-тэй
 * холбоно; дараа нь монотон `performance.now()`-оор урагшилна — хэрэглэгч
 * компьютерийнхээ цагийг өөрчилсөн ч тоолуур үсрэхгүй.
 */
let anchor: ClockAnchor | null = null;

export function syncServerClock(serverNowIso: string | undefined): void {
  if (!serverNowIso) return;
  anchor = nextAnchor(anchor, Date.parse(serverNowIso), performance.now());
}

export function serverNowMs(): number {
  return anchorNow(anchor, performance.now(), Date.now());
}

/* ------------------------------------------------------------------ */
/*  Цайны цаг — табын ГАНЦ дүрэм (сервер өгнө: `/state`, `/live`)       */
/* ------------------------------------------------------------------ */

let lunch: LunchRule | null = null;
const lunchListeners = new Set<() => void>();
let lunchTimer = 0;

/** Серверийн `lunch`-ийг хадгална (өөрчлөгдвөл цайны төлөв уншигчдад мэдэгдэнэ). */
export function syncLunch(raw: unknown): void {
  const next = lunchRuleOf(raw);
  const same =
    next === lunch ||
    (next !== null &&
      lunch !== null &&
      next.startMin === lunch.startMin &&
      next.endMin === lunch.endMin &&
      next.fromDate === lunch.fromDate &&
      next.offsetMin === lunch.offsetMin);
  if (same) return;
  lunch = next;
  armLunchTimer();
  for (const fn of lunchListeners) fn();
}

/** Одоогийн цайны дүрэм (ирээгүй / ирцэд унтраасан бол null). */
export function currentLunch(): LunchRule | null {
  return lunch;
}

/** Одоо цайны цаг уу — `useSyncExternalStore`-ийн snapshot. */
export function isLunchNow(): boolean {
  return lunchStateAt(serverNowMs(), lunch).inLunch;
}

/** Цонх эхлэх/дуусах агшинд (мөн дүрэм өөрчлөгдөхөд) дуудагдана — бүх уншигч НЭГ таймер хуваалцана. */
export function subscribeLunch(fn: () => void): () => void {
  lunchListeners.add(fn);
  if (lunchListeners.size === 1) armLunchTimer();
  return () => {
    lunchListeners.delete(fn);
    if (lunchListeners.size === 0) {
      window.clearTimeout(lunchTimer);
      lunchTimer = 0;
    }
  };
}

function armLunchTimer(): void {
  window.clearTimeout(lunchTimer);
  lunchTimer = 0;
  if (lunchListeners.size === 0) return;
  const edge = lunchStateAt(serverNowMs(), lunch).nextEdgeMs;
  if (edge === null) return;
  // Хилээс бага зэрэг хойно — цаг тойруулсны алдаагаар хилийн өмнө сэрэхгүй.
  const wait = Math.min(Math.max(250, edge - serverNowMs() + 50), 2_000_000_000);
  lunchTimer = window.setTimeout(() => {
    for (const fn of lunchListeners) fn();
    armLunchTimer();
  }, wait);
}

/* ------------------------------------------------------------------ */
/*  Нэг requestAnimationFrame давталт — бүх амьд тоолуур хуваалцана     */
/* ------------------------------------------------------------------ */

type FrameFn = (nowMs: number) => void;
const subscribers = new Set<FrameFn>();
let frame = 0;

function loop() {
  const now = serverNowMs();
  for (const fn of subscribers) fn(now);
  frame = subscribers.size > 0 ? requestAnimationFrame(loop) : 0;
}

/** Кадр бүрт дуудагдана (далд табд хөтөч өөрөө зогсооно). */
export function subscribeFrame(fn: FrameFn): () => void {
  subscribers.add(fn);
  if (frame === 0) frame = requestAnimationFrame(loop);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}
