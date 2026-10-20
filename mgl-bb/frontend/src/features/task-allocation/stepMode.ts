/**
 * Алхамын горим — `−` / `+` нь хүний НИЙТ зорилтын 10% эсвэл 1% (`units.stepUnits`).  Сонголт хөтөч бүрт
 * ХУВИЙН (localStorage) бөгөөд нэг хуудасны БҮХ мөрд нэгэн зэрэг үйлчилнэ (модулийн store).
 */
import { useCallback, useSyncExternalStore } from 'react';

import type { StepMode } from './units';

const KEY = 'mgl:alloc:step';

function read(): StepMode {
  try {
    return localStorage.getItem(KEY) === '1' ? 1 : 10;
  } catch {
    return 10;
  }
}

let mode: StepMode = read();
const subs = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function setStepMode(next: StepMode): void {
  if (next === mode) return;
  mode = next;
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    /* хувийн горим — хадгалахгүй байж болно */
  }
  for (const fn of [...subs]) fn();
}

export function useStepMode(): [StepMode, (m: StepMode) => void] {
  const current = useSyncExternalStore(
    subscribe,
    () => mode,
    () => 10 as StepMode,
  );
  const set = useCallback((m: StepMode) => setStepMode(m), []);
  return [current, set];
}
