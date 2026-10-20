/** Composes every `useSetup*` hook into the single object the page renders
 *  from. Split out of `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was broken up — the hooks below hold the code verbatim, this file
 *  only wires them together. */
import { useTeamShares } from './useTeamShares';
import { useSetupAdd } from './useSetupAdd';
import { useSetupScaffold } from './useSetupScaffold';
import { useSetupBulkAdd } from './useSetupBulkAdd';
import { useSetupUpdate } from './useSetupUpdate';
import { useSetupDelete } from './useSetupDelete';
import { useEqualSplit } from './useEqualSplit';
import { useFixAllZeroSums } from './useFixAllZeroSums';
import { useSetupSave } from './useSetupSave';
import { useSetupDnd } from './useSetupDnd';
import { useSetupSummary } from './useSetupSummary';
import { useSetupShortcuts } from './useSetupShortcuts';
import { useSetupStore } from './useSetupStore';
import { useStableTaskHandlers } from './useStableTaskHandlers';

export function useProjectSetup() {
  const store = useSetupStore();
  const teamShareActions = useTeamShares(store);
  const add = useSetupAdd(store);
  const scaffold = useSetupScaffold(store);
  const bulk = useSetupBulkAdd(store, { addDrawing: add.addDrawing, addComponent: add.addComponent, addTask: add.addTask });
  const update = useSetupUpdate(store);
  const del = useSetupDelete(store);
  const equalSplit = useEqualSplit(store);
  const fixAll = useFixAllZeroSums(store);
  const save = useSetupSave(store);
  const dnd = useSetupDnd(store);
  const summaryApi = useSetupSummary(store);

  // Identity-stable wrappers so the memo()'d TaskRow isn't re-rendered
  // wholesale on every parent render.
  const stable = useStableTaskHandlers({
    uTask: update.uTask,
    delTask: del.delTask,
    addTask: add.addTask,
    setTaskBaseline: del.setTaskBaseline,
  });

  const canManageSetup = store.user?.role === 'admin' || store.user?.role === 'senior';
  useSetupShortcuts(store, canManageSetup, {
    addBlock: add.addBlock,
    addDrawing: add.addDrawing,
  });

  return {
    ...store,
    ...teamShareActions,
    ...add,
    ...scaffold,
    ...bulk,
    ...update,
    ...del,
    ...equalSplit,
    ...fixAll,
    ...save,
    ...dnd,
    ...summaryApi,
    ...stable,
    canManageSetup,
  };
}

export type SetupApi = ReturnType<typeof useProjectSetup>;
