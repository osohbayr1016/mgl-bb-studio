/** Bulk add from the multi-select preset dialogs.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import { WEIGHT_EPSILON, num } from './weights';
import type { SetupStore } from './useSetupStore';

export function useSetupBulkAdd(store: SetupStore,
  deps: {
    addDrawing: (blockId: number, name?: string) => Promise<unknown>;
    addComponent: (drawingId: number, name?: string) => Promise<unknown>;
    addTask: (compId: number, name?: string) => Promise<unknown>;
  }) {
  const {
    t,
    drawings,
    components,
    setTasks,
    markTaskDirty,
    flash,
  } = store;
  const { addDrawing, addComponent, addTask } = deps;


  /* ---------- Bulk add (multi-select preset dialogs) ---------- */
  // Fires the single-item endpoint once per picked preset. We run them
  // sequentially so sort_order on the server stays stable and the local
  // state array ends up in the same order the user checked them.
  //
  // After a bulk insert we auto-balance the parent's children to 100% IF the
  // parent was effectively empty-weighted (total sum ~= 0). This removes the
  // "ажлууд (0.0%)" validation pain after bulk-adding from presets: the admin
  // expects "5 ажил нэмэгдэхэд тус бүр 20%" by default. We never touch a
  // parent that already has custom weights — respect manual tuning.
  //
  // Returns the new weights so the caller can render a small "success"
  // toast explaining what happened.
  const addDrawingsBulk = async (blockId: number, names: string[]) => {
    // addDrawing re-even-splits siblings on every call, so by the end
    // of this loop the block already has 100/N across N drawings.
    for (const name of names) await addDrawing(blockId, name);
    if (names.length > 1) {
      flash('success', t('adminProjectSetupPage.drawingsAdded', { count: names.length }));
    }
  };
  const addComponentsBulk = async (drawingId: number, names: string[]) => {
    for (const name of names) await addComponent(drawingId, name);
    if (names.length > 1) {
      flash('success', t('adminProjectSetupPage.componentsAdded', { count: names.length }));
    }
  };
  // After bulk-inserting tasks under a component we try to seed sensible
  // weights so the admin doesn't have to type them all by hand. The scope
  // of the auto-split depends on whether the component is weight-bearing:
  //   • If `comp.weight_percent > 0`, we split that component's weight
  //     evenly across just the tasks under this component (drawing siblings
  //     are unaffected).
  //   • Otherwise (legacy "components are folders" mode), we split the
  //     parent drawing's weight across every task in every component of
  //     that drawing — but only when the drawing-wide task total is still
  //     ~0. If any sibling already has a custom weight we leave the new
  //     ones at 0 to avoid clobbering manual tuning.
  const addTasksBulk = async (compId: number, names: string[]) => {
    for (const name of names) await addTask(compId, name);
    const comp = components.find((c) => c.id === compId);
    if (!comp) return;
    const drawing = drawings.find((d) => d.id === comp.drawing_id);
    if (!drawing) return;
    const compW = num(comp.weight_percent);
    const drawingTarget = num(drawing.weight_percent);

    // We need the freshest task list (addTask above has just pushed new
    // rows via setTasks, which TypeScript closures won't see). Use the
    // setTasks updater to read prev, decide split policy, and apply it in
    // one pass. Capture the decision via a ref-shaped object so the toast
    // below knows what (if anything) was rebalanced.
    const decision: { kind: 'comp' | 'draw' | null; target: number } = { kind: null, target: 0 };
    setTasks((prev) => {
      if (compW > 0) {
        const compTasks = prev.filter((t) => t.component_id === compId);
        if (compTasks.length === 0) return prev;
        const total = compTasks.reduce((s, t) => s + num(t.weight_percent), 0);
        if (total > WEIGHT_EPSILON) return prev;
        decision.kind = 'comp';
        decision.target = compW;
        const share = parseFloat((compW / compTasks.length).toFixed(2));
        const last = parseFloat((compW - share * (compTasks.length - 1)).toFixed(2));
        const ids = new Set(compTasks.map((t) => t.id));
        compTasks.forEach((t) => markTaskDirty(t.id));
        return prev.map((t) => {
          if (!ids.has(t.id)) return t;
          const orderIdx = compTasks.findIndex((dt) => dt.id === t.id);
          const wv = orderIdx === compTasks.length - 1 ? last : share;
          return { ...t, weight_percent: wv };
        });
      }

      if (drawingTarget <= 0) return prev;
      const drawingTasks = prev.filter((t) => {
        const c = components.find((cc) => cc.id === t.component_id);
        return c?.drawing_id === drawing.id;
      });
      if (drawingTasks.length === 0) return prev;
      const total = drawingTasks.reduce((s, t) => s + num(t.weight_percent), 0);
      if (total > WEIGHT_EPSILON) return prev;
      decision.kind = 'draw';
      decision.target = drawingTarget;
      const share = parseFloat((drawingTarget / drawingTasks.length).toFixed(2));
      const last = parseFloat((drawingTarget - share * (drawingTasks.length - 1)).toFixed(2));
      const ids = new Set(drawingTasks.map((t) => t.id));
      drawingTasks.forEach((t) => markTaskDirty(t.id));
      return prev.map((t) => {
        if (!ids.has(t.id)) return t;
        const orderIdx = drawingTasks.findIndex((dt) => dt.id === t.id);
        const wv = orderIdx === drawingTasks.length - 1 ? last : share;
        return { ...t, weight_percent: wv };
      });
    });

    if (names.length > 1) {
      const label =
        decision.kind === 'comp'
          ? t('adminProjectSetupPage.componentWeightLabel', {
              pct: decision.target.toFixed(1),
            })
          : decision.kind === 'draw'
            ? t('adminProjectSetupPage.drawingWeightLabel', { pct: decision.target.toFixed(1) })
            : null;
      flash(
        'success',
        label
          ? t('adminProjectSetupPage.tasksAddedAndSplit', { count: names.length, label })
          : t('adminProjectSetupPage.tasksAdded', { count: names.length }),
      );
    }
  };


  return {
    addDrawingsBulk,
    addComponentsBulk,
    addTasksBulk,
  };
}
