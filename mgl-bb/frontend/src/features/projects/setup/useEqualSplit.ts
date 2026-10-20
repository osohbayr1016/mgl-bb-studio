/** Equal-split helpers for each tier of the weight tree.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import { UNGROUPED_TAB } from './useSetupStore';
import { num, splitEvenly } from './weights';
import type { SetupStore } from './useSetupStore';

export function useEqualSplit(store: SetupStore) {
  const {
    activeTeamId,
    blocks,
    setBlocks,
    drawings,
    components,
    setComponents,
    tasks,
    setTasks,
    markBlockDirty,
    markComponentDirty,
    markTaskDirty,
  } = store;


  /* ---------- Equal split helpers ---------- */
  // Fills every sibling with (100 / n)%. Operates on local state only so the
  // user can continue editing before pressing Save.
  const equalSplitBlocks = () => {
    // Block weight is "% within team" — only equal-split the blocks of
    // the active team tab so we don't accidentally rebalance siblings
    // in a sibling team. `splitEvenly` returns a share and a last value
    // that absorbs the rounding remainder so the sum stays at exactly
    // 100 (instead of drifting to 99.99 / 100.03 with uniform values).
    const targetTeamId = activeTeamId === UNGROUPED_TAB ? null : activeTeamId;
    const scoped = blocks.filter((b) => b.team_id === targetTeamId);
    if (scoped.length === 0) return;
    scoped.forEach((b) => markBlockDirty(b.id));
    const { share, last } = splitEvenly(scoped.length);
    setBlocks((p) =>
      p.map((b) => {
        const idx = scoped.findIndex((s) => s.id === b.id);
        if (idx === -1) return b;
        return { ...b, weight_percent: idx === scoped.length - 1 ? last : share };
      }),
    );
  };
  /** Distribute the drawing's posted weight evenly across every task in
   *  every component of that drawing. Tasks under a drawing must sum to
   *  `drawing.weight_percent` in the new model. */
  const equalSplitDrawingTasks = (drawingId: number) => {
    const drawing = drawings.find((d) => d.id === drawingId);
    if (!drawing) return;
    const target = num(drawing.weight_percent);
    const taskIds: number[] = [];
    for (const c of components.filter((x) => x.drawing_id === drawingId)) {
      for (const t of tasks.filter((x) => x.component_id === c.id)) taskIds.push(t.id);
    }
    if (taskIds.length === 0 || target <= 0) return;
    taskIds.forEach((tid) => markTaskDirty(tid));
    const share = parseFloat((target / taskIds.length).toFixed(2));
    const last = parseFloat((target - share * (taskIds.length - 1)).toFixed(2));
    const idSet = new Set(taskIds);
    setTasks((p) =>
      p.map((t) => {
        if (!idSet.has(t.id)) return t;
        const orderIdx = taskIds.findIndex((tid) => tid === t.id);
        const wv = orderIdx === taskIds.length - 1 ? last : share;
        return { ...t, weight_percent: wv };
      }),
    );
  };

  /** Distribute the drawing's weight evenly across its components. Use this
   *  when an admin wants the optional component tier ("Бүрдэл") to slice the
   *  drawing into equal sub-shares, e.g. drawing 10% → 2 components × 5%. */
  const equalSplitDrawingComponents = (drawingId: number) => {
    const drawing = drawings.find((d) => d.id === drawingId);
    if (!drawing) return;
    const target = num(drawing.weight_percent);
    const list = components.filter((c) => c.drawing_id === drawingId);
    if (list.length === 0 || target <= 0) return;
    list.forEach((c) => markComponentDirty(c.id));
    const share = parseFloat((target / list.length).toFixed(2));
    const last = parseFloat((target - share * (list.length - 1)).toFixed(2));
    setComponents((p) =>
      p.map((c) => {
        const idx = list.findIndex((l) => l.id === c.id);
        if (idx === -1) return c;
        return { ...c, weight_percent: idx === list.length - 1 ? last : share };
      }),
    );
  };

  /** Equalise weights among tasks under one component. Always splits
   *  the *parent's* budget (component weight if set, else drawing
   *  weight, else 100) — does NOT preserve the current task sum.
   *  This matches the admin's mental model: "7 tasks → each gets 1/7
   *  of the parent's budget", regardless of what they happened to
   *  type in before clicking the split button. */
  const equalSplitTasks = (compId: number) => {
    const leafTasks = tasks.filter((t) => t.component_id === compId);
    if (leafTasks.length === 0) return;
    const comp = components.find((c) => c.id === compId);
    const drawing = comp ? drawings.find((d) => d.id === comp.drawing_id) : null;
    const compW = comp ? num(comp.weight_percent) : 0;
    const target = compW > 0 ? compW : drawing ? num(drawing.weight_percent) : 100;
    if (target <= 0) return;
    leafTasks.forEach((t) => markTaskDirty(t.id));
    const share = parseFloat((target / leafTasks.length).toFixed(2));
    const last = parseFloat((target - share * (leafTasks.length - 1)).toFixed(2));
    setTasks((p) =>
      p.map((t) => {
        const idx = leafTasks.findIndex((lt) => lt.id === t.id);
        if (idx === -1) return t;
        return { ...t, weight_percent: idx === leafTasks.length - 1 ? last : share };
      }),
    );
  };


  return {
    equalSplitBlocks,
    equalSplitDrawingTasks,
    equalSplitDrawingComponents,
    equalSplitTasks,
  };
}
