/**
 * `ownProgressStore`-ийн React холбоос: серверийн төлөв (props) → ноорог, ноорогийн snapshot, үйлдлүүд.
 * Цэвэр загвар `ownProgress.ts`, хадгалалт/таймер `ownProgressStore.ts`.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { newDraft, viewOf, type Draft, type OwnBase, type OwnView, type StepKind, type TypedResult } from './ownProgress';
import { ownProgressStore } from './ownProgressStore';
import type { StepMode } from './units';

export interface OwnProgressApi {
  draft: Draft;
  view: OwnView;
  step: (kind: StepKind, mode: StepMode) => void;
  typed: (text: string) => TypedResult | null;
  revert: () => void;
  saveNow: () => void;
  retry: () => void;
  confirmQa: (qa: Record<string, string>) => void;
  cancelQa: () => void;
}

/** `base` = серверээс мэдэгдэж буй миний хуваарилалт (null бол хуваарилалтгүй → hook юу ч хийхгүй). */
export function useOwnProgress(base: OwnBase | null): OwnProgressApi | null {
  const has = base !== null;
  const taskId = base?.taskId ?? 0;
  const userId = base?.userId ?? 0;
  const revision = base?.revision ?? 0;
  const rootDone = base?.rootDone ?? 0;
  const done = base?.done ?? 0;
  const floor = base?.floor ?? 0;
  const target = base?.target ?? 0;

  const subscribe = useCallback((fn: () => void) => ownProgressStore.subscribe(taskId, fn), [taskId]);
  const getSnapshot = useCallback(() => ownProgressStore.snapshot(taskId), [taskId]);
  const stored = useSyncExternalStore(subscribe, getSnapshot, () => null);

  // Серверийн төлөв шинэчлэгдэх бүрт ноороготой тулгана (хуучин revision, явж буй хадгалалтыг сервер хэзээ ч дарахгүй).
  useEffect(() => {
    if (!has) return;
    ownProgressStore.sync({ taskId, userId, revision, rootDone, done, floor, target });
  }, [has, taskId, userId, revision, rootDone, done, floor, target]);

  // Store entry үүсэхээс өмнө (эхний render) props-оос шууд цэвэр ноорог.
  const fallback = useMemo(
    () => (has ? newDraft({ taskId, userId, revision, rootDone, done, floor, target }) : null),
    [has, taskId, userId, revision, rootDone, done, floor, target],
  );
  const draft = stored ?? fallback;

  const step = useCallback((kind: StepKind, mode: StepMode) => ownProgressStore.step(taskId, kind, mode), [taskId]);
  const typed = useCallback((text: string) => ownProgressStore.typed(taskId, text), [taskId]);
  const revert = useCallback(() => ownProgressStore.revert(taskId), [taskId]);
  const saveNow = useCallback(() => void ownProgressStore.saveNow(taskId), [taskId]);
  const retry = useCallback(() => void ownProgressStore.retry(taskId), [taskId]);
  const confirmQa = useCallback((qa: Record<string, string>) => void ownProgressStore.confirmQa(taskId, qa), [taskId]);
  const cancelQa = useCallback(() => ownProgressStore.cancelQa(taskId), [taskId]);

  return useMemo(
    () => (draft ? { draft, view: viewOf(draft), step, typed, revert, saveNow, retry, confirmQa, cancelQa } : null),
    [draft, step, typed, revert, saveNow, retry, confirmQa, cancelQa],
  );
}
