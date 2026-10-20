/** One-shot repair for every 0%-sum group in the project.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import type { Block } from './types';
import { WEIGHT_EPSILON, componentTaskSum, drawingTaskCount, drawingTaskSum, drawingUsesComponentWeights, num, splitEvenly, sumW } from './weights';
import type { SetupStore } from './useSetupStore';

export function useFixAllZeroSums(store: SetupStore) {
  const {
    t,
    blocks,
    setBlocks,
    drawings,
    setDrawings,
    components,
    tasks,
    setTasks,
    markBlockDirty,
    markDrawingDirty,
    markTaskDirty,
    flash,
  } = store;


  /* ---------- Fix all 0%-sum groups ----------
   * Walks the whole tree once and, for every parent whose children's weights
   * sum to ~0, rewrites those children to an even 100% split. Leaves any
   * parent with non-zero manual weights untouched (so users don't lose custom
   * tuning). Only runs locally — admin still needs to press Хадгалах to
   * persist. Used by the rollup summary's "Бүгдийг засах" shortcut so fixing
   * a project's preset-induced 0% validation errors is a one-click job.
   */
  const fixAllZeroSums = () => {
    let groupsFixed = 0;

    // Blocks must sum to 100 *per team* — not project-wide. Walk each
    // team's blocks separately so a zero-summed team gets evenly split
    // without dragging sibling teams' (already balanced) blocks into
    // the rebalance.
    const blocksByTeam = new Map<number, Block[]>();
    for (const b of blocks) {
      if (b.team_id == null) continue;
      const arr = blocksByTeam.get(b.team_id) ?? [];
      arr.push(b);
      blocksByTeam.set(b.team_id, arr);
    }
    const teamFixes = new Map<number, number>(); // block id → new weight
    for (const teamBlocks of blocksByTeam.values()) {
      const sum = sumW(teamBlocks);
      if (sum >= WEIGHT_EPSILON) continue;
      const { share, last } = splitEvenly(teamBlocks.length);
      teamBlocks.forEach((b, i) => {
        teamFixes.set(b.id, i === teamBlocks.length - 1 ? last : share);
        markBlockDirty(b.id);
      });
      groupsFixed += 1;
    }
    if (teamFixes.size > 0) {
      setBlocks((p) =>
        p.map((b) => (teamFixes.has(b.id) ? { ...b, weight_percent: teamFixes.get(b.id)! } : b)),
      );
    }

    // Drawings per block — must sum to 100 inside each block.
    for (const b of blocks) {
      const kids = drawings.filter((d) => d.block_id === b.id);
      if (kids.length === 0) continue;
      const s = sumW(kids);
      if (s < WEIGHT_EPSILON) {
        const { share, last } = splitEvenly(kids.length);
        const kidIds = new Set(
          kids.map((k, i) => [k.id, i === kids.length - 1 ? last : share] as const),
        );
        kids.forEach((k) => markDrawingDirty(k.id));
        setDrawings((prev) =>
          prev.map((d) => {
            const hit = [...kidIds].find(([id]) => id === d.id);
            return hit ? { ...d, weight_percent: hit[1] } : d;
          }),
        );
        groupsFixed += 1;
      }
    }

    // Tasks per drawing — must sum to drawing.weight_percent. Only auto-fix
    // when the current total is ~0 (the bulk-preset case). If the drawing's
    // own weight is also still 0 we leave it alone — admin needs to set it
    // first or run the block-level fix above.
    //
    // Drawings whose components carry weight (the optional intermediate
    // tier) are handled per-component in the next loop instead, so we skip
    // them here to avoid clobbering the admin's per-component targets.
    for (const d of drawings) {
      const target = num(d.weight_percent);
      if (target <= 0) continue;
      if (drawingUsesComponentWeights(d.id, components)) continue;
      const taskSum = drawingTaskSum(d.id, components, tasks);
      if (drawingTaskCount(d.id, components, tasks) === 0) continue;
      if (taskSum >= WEIGHT_EPSILON) continue;
      const taskIds: number[] = [];
      for (const c of components.filter((x) => x.drawing_id === d.id)) {
        for (const t of tasks.filter((x) => x.component_id === c.id)) taskIds.push(t.id);
      }
      if (taskIds.length === 0) continue;
      const share = parseFloat((target / taskIds.length).toFixed(2));
      const last = parseFloat((target - share * (taskIds.length - 1)).toFixed(2));
      const idSet = new Set(taskIds);
      taskIds.forEach((tid) => markTaskDirty(tid));
      setTasks((prev) =>
        prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          const orderIdx = taskIds.findIndex((tid) => tid === t.id);
          const wv = orderIdx === taskIds.length - 1 ? last : share;
          return { ...t, weight_percent: wv };
        }),
      );
      groupsFixed += 1;
    }

    // Tasks per WEIGHTED component — must sum to component.weight_percent.
    // Same auto-fix-only-on-empty rule as drawings above.
    for (const c of components) {
      const cTarget = num(c.weight_percent);
      if (cTarget <= 0) continue;
      const cTasks = tasks.filter((t) => t.component_id === c.id);
      if (cTasks.length === 0) continue;
      const cSum = componentTaskSum(c.id, tasks);
      if (cSum >= WEIGHT_EPSILON) continue;
      const ids = cTasks.map((t) => t.id);
      const share = parseFloat((cTarget / ids.length).toFixed(2));
      const last = parseFloat((cTarget - share * (ids.length - 1)).toFixed(2));
      const idSet = new Set(ids);
      ids.forEach((tid) => markTaskDirty(tid));
      setTasks((prev) =>
        prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          const orderIdx = ids.findIndex((tid) => tid === t.id);
          const wv = orderIdx === ids.length - 1 ? last : share;
          return { ...t, weight_percent: wv };
        }),
      );
      groupsFixed += 1;
    }

    if (groupsFixed === 0) {
      flash('success', t('adminProjectSetupPage.noZeroGroups'));
    } else {
      flash('success', t('adminProjectSetupPage.groupsFixed', { count: groupsFixed }));
    }
  };


  return {
    fixAllZeroSums,
  };
}
