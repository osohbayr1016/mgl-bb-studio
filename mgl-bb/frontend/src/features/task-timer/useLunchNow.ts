import { useSyncExternalStore } from 'react';
import { isLunchNow, subscribeLunch } from './timerClock';

/**
 * Одоо цайны цаг уу (эзэн 2026-10-01: цайны цонхонд албан цаг тоологдохгүй —
 * тоолуур хөлдөж, цонх дуусахад өөрөө үргэлжилнэ).  Цонх эхлэх/дуусах агшинд
 * дахин рендерлэнэ; бүх уншигч `timerClock.ts`-ийн НЭГ таймерыг хуваалцана.
 * `active` false (таймер нь явахгүй мөр) бол үргэлж false.
 */
export function useLunchNow(active: boolean): boolean {
  const inLunch = useSyncExternalStore(subscribeLunch, isLunchNow, () => false);
  return active && inLunch;
}
