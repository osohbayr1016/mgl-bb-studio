/** Local-only field edits (persisted later by saveAll).
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import type { Block, Comp, Drawing, Task } from './types';
import type { SetupStore } from './useSetupStore';

export function useSetupUpdate(store: SetupStore) {
  const {
    setBlocks,
    setDrawings,
    setComponents,
    setTasks,
    markBlockDirty,
    markDrawingDirty,
    markComponentDirty,
    markTaskDirty,
  } = store;


  /* ---------- Update (local only; persisted on Save) ----------
   * Keyed generically off the row interfaces so the field name and the value
   * are checked against each other: `uTask(id, 'name', 5)` and a misspelled
   * `uTask(id, 'progres', 5)` are both compile errors now. Under the old
   * `(f: string, v: any)` signature either one compiled and silently wrote a
   * junk key into local state. */
  const uBlock = <K extends keyof Block>(bid: number, f: K, v: Block[K]) => {
    markBlockDirty(bid);
    setBlocks((p) => p.map((b) => (b.id === bid ? { ...b, [f]: v } : b)));
  };
  const uDraw = <K extends keyof Drawing>(did: number, f: K, v: Drawing[K]) => {
    markDrawingDirty(did);
    setDrawings((p) => p.map((d) => (d.id === did ? { ...d, [f]: v } : d)));
  };
  const uComp = <K extends keyof Comp>(cid: number, f: K, v: Comp[K]) => {
    markComponentDirty(cid);
    setComponents((p) => p.map((c) => (c.id === cid ? { ...c, [f]: v } : c)));
  };
  const uTask = <K extends keyof Task>(tid: number, f: K, v: Task[K]) => {
    markTaskDirty(tid);
    setTasks((p) => p.map((t) => (t.id === tid ? { ...t, [f]: v } : t)));
  };

  return {
    uBlock,
    uDraw,
    uComp,
    uTask,
  };
}
