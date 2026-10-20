/** Identity-stable wrappers around the per-task handlers.
 *
 *  `TaskRow` is memo()'d, so it must not receive a fresh closure on every
 *  parent render. These wrappers never change identity; a ref is re-pointed
 *  at the latest implementations after each render instead.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that module was
 *  split up — no behavioural change. */
import { useCallback, useEffect, useRef } from 'react';

import type { Task } from './types';

export function useStableTaskHandlers(handlers: {
  uTask: <K extends keyof Task>(tid: number, f: K, v: Task[K]) => void;
  delTask: (tid: number) => void;
  addTask: (compId: number, name?: string) => void;
  setTaskBaseline: (tid: number, pct: number) => Promise<void> | void;
}) {
  const taskRowHandlersRef = useRef(handlers);
  useEffect(() => {
    taskRowHandlersRef.current = handlers;
  });

  // Stays generic on the way through: a plain `(f: string, v: string)`
  // re-forward can't call the keyed `uTask` (string isn't assignable to
  // `keyof Task`), and it would erase the field/value pairing for TaskRow.
  const stableUTask = useCallback(
    <K extends keyof Task>(tid: number, f: K, v: Task[K]) =>
      taskRowHandlersRef.current.uTask(tid, f, v),
    [],
  );
  const stableDelTask = useCallback((tid: number) => taskRowHandlersRef.current.delTask(tid), []);
  const stableAddTask = useCallback(
    (compId: number) => taskRowHandlersRef.current.addTask(compId),
    [],
  );
  const stableSetTaskBaseline = useCallback(
    (tid: number, pct: number): Promise<void> | void =>
      taskRowHandlersRef.current.setTaskBaseline(tid, pct),
    [],
  );

  return {
    stableUTask,
    stableDelTask,
    stableAddTask,
    stableSetTaskBaseline,
  };
}
