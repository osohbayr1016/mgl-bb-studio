/** Drag-to-reorder for every tier of the setup tree.
 *
 *  Composes the task-level and structural-level hooks so callers keep a single
 *  entry point. Split out of `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { useTaskDnd } from './useTaskDnd';
import { useTreeDnd } from './useTreeDnd';
import type { SetupStore } from './useSetupStore';

export function useSetupDnd(store: SetupStore) {
  return { ...useTaskDnd(store), ...useTreeDnd(store) };
}
