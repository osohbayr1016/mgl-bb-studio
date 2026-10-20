/** Works out what a "full structure" scaffold needs to create or re-weight.
 *
 *  Walks the preset catalogue once against what already exists under the
 *  block, deciding at each tier whether to create-new, attach-to-existing, or
 *  refresh-weight-only. Pure — the caller POSTs the result and splices local
 *  state. Extracted verbatim from `AdminProjectSetupPage.tsx` — no
 *  behavioural change. */
import { DRAWING_TYPES } from './componentPresets';
import { COMPONENT_TASK_PRESETS } from './componentTaskPresets';
import { PRESET_COMPONENT_WEIGHTS } from './componentWeights';
import { getPresetsForDrawing } from './presetLookup';
import { PRESET_TASK_WEIGHTS } from './taskWeights';
import type { Comp, Drawing, Task } from './types';
import { num } from './weights';

export type ReqTask = { name: string; weight_percent: number };
export type ReqComponent =
  | { name: string; weight_percent: number; tasks: ReqTask[] }
  | { existingComponentId: number; tasks: ReqTask[] };
export type ReqDrawing =
  | { name: string; weight_percent: number; components: ReqComponent[] }
  | { existingDrawingId: number; components: ReqComponent[] };
export type WeightUpdate = { id: number; weight_percent: number };

export function planScaffold({
  blockId,
  codes,
  drawings,
  components,
  tasks,
}: {
  blockId: number;
  codes: Set<string>;
  drawings: Drawing[];
  components: Comp[];
  tasks: Task[];
}) {
  // Index everything that already lives under this block so we can
  // diff against preset-derived values by (parent, name) keys.
  const drawingsInBlock = drawings.filter((d) => d.block_id === blockId);
  const drawingByName = new Map<string, Drawing>();
  drawingsInBlock.forEach((d) => drawingByName.set(d.name, d));
  const componentByDrawingAndName = new Map<string, Comp>();
  components.forEach((c) => {
    componentByDrawingAndName.set(`${c.drawing_id}::${c.name}`, c);
  });
  const taskByComponentAndName = new Map<string, Task>();
  tasks.forEach((t) => {
    taskByComponentAndName.set(`${t.component_id}::${t.name}`, t);
  });

  // Wire-format types — match the worker's request schema.
  type ReqTask = { name: string; weight_percent: number };
  type ReqComponent =
    | { name: string; weight_percent: number; tasks: ReqTask[] }
    | { existingComponentId: number; tasks: ReqTask[] };
  type ReqDrawing =
    | { name: string; weight_percent: number; components: ReqComponent[] }
    | { existingDrawingId: number; components: ReqComponent[] };

  const desired: ReqDrawing[] = [];

  // weight_percent updates queued for already-existing rows whose
  // current stored value drifted from the preset (or whose unit was
  // wrong from a previous incorrect scaffold).
  type WeightUpdate = { id: number; weight_percent: number };
  const drawingUpdates: WeightUpdate[] = [];
  const componentUpdates: WeightUpdate[] = [];
  const taskUpdates: WeightUpdate[] = [];

  // Float comparison helper — db round-trips through SQLite REAL so
  // exact-equals on raw doubles is unreliable.
  const same = (a: number, b: number) => Math.abs(a - b) < 0.0001;

  // Walk the preset tree once, deciding at each tier whether to
  // create-new, attach-to-existing, or refresh-weight-only.
  for (const dt of DRAWING_TYPES) {
    if (!codes.has(dt.code)) continue;
    const drName = `${dt.code} - ${dt.name}`;
    const componentNames = getPresetsForDrawing(drName)?.presets ?? [];
    const componentWeights = PRESET_COMPONENT_WEIGHTS[dt.code] ?? {};
    const taskWeights = PRESET_TASK_WEIGHTS[dt.code] ?? {};
    const existingDrawing = drawingByName.get(drName);

    // Drawing weight is decided by addDrawing's auto-even-split
    // when this is the first/only drawing in the block (100 for a
    // single drawing, 100/N when siblings exist). When the drawing
    // is already there we use its current stored weight to size
    // the child rows, so re-clicks don't silently move things
    // around. Empty existing weight falls back to 100 so the
    // first-ever scaffold has a sane denominator before
    // auto-even-split runs.
    const existingDrW = existingDrawing ? num(existingDrawing.weight_percent) : 0;
    // Self-heal a lone drawing that doesn't weigh 100 (see the
    // function comment): queue the weight fix and use 100 as the
    // denominator so every child re-derives on the correct scale.
    // Multi-drawing blocks are left alone — their split is
    // admin-managed and we can't know the intended shares.
    const healLoneDrawing =
      existingDrawing != null && drawingsInBlock.length === 1 && !same(existingDrW, 100);
    if (healLoneDrawing) {
      drawingUpdates.push({ id: existingDrawing.id, weight_percent: 100 });
    }
    const drW = healLoneDrawing || existingDrW <= 0 ? 100 : existingDrW;

    const reqComponents: ReqComponent[] = [];
    for (const compName of componentNames) {
      const taskNames = COMPONENT_TASK_PRESETS[compName] ?? [];
      const compTaskMap = taskWeights[compName] ?? {};
      const compPctOfDrawing = componentWeights[compName] ?? 0;
      // Storage = "% of block" = pct_of_drawing × drW / 100.  We use
      // `drW` (the *effective* drawing weight) rather than the preset
      // so that EZ/IZ/GT — which have no fixed % of block — refresh
      // correctly once the admin enters a per-project drawing weight
      // and re-clicks scaffold. Also keeps BA…AU consistent if an
      // admin manually shifts a drawing's % of block.
      const compStored = +((compPctOfDrawing * drW) / 100).toFixed(4);
      const existingComp = existingDrawing
        ? componentByDrawingAndName.get(`${existingDrawing.id}::${compName}`)
        : undefined;

      if (existingComp) {
        // Refresh component weight if it drifted.
        if (!same(num(existingComp.weight_percent), compStored)) {
          componentUpdates.push({ id: existingComp.id, weight_percent: compStored });
        }
        // Walk the task list: new tasks go in the create batch,
        // existing tasks may need a weight refresh.
        const missingTasks: ReqTask[] = [];
        for (const tn of taskNames) {
          const tPct = compTaskMap[tn] ?? 0;
          const tStored = +((tPct * drW) / 100).toFixed(4);
          const existingTask = taskByComponentAndName.get(`${existingComp.id}::${tn}`);
          if (existingTask) {
            if (!same(num(existingTask.weight_percent), tStored)) {
              taskUpdates.push({ id: existingTask.id, weight_percent: tStored });
            }
          } else {
            missingTasks.push({ name: tn, weight_percent: tStored });
          }
        }
        if (missingTasks.length > 0) {
          reqComponents.push({ existingComponentId: existingComp.id, tasks: missingTasks });
        }
      } else {
        // New component — bring its full task list along, all in
        // storage units derived from the chosen drW.
        reqComponents.push({
          name: compName,
          weight_percent: compStored,
          tasks: taskNames.map((tn) => {
            const tPct = compTaskMap[tn] ?? 0;
            const tStored = +((tPct * drW) / 100).toFixed(4);
            return { name: tn, weight_percent: tStored };
          }),
        });
      }
    }

    if (existingDrawing) {
      if (reqComponents.length > 0) {
        desired.push({ existingDrawingId: existingDrawing.id, components: reqComponents });
      }
    } else {
      // New drawing — seed at 100% of block. If sibling drawings
      // exist (multi-drawing block) addDrawingsBulk's auto-split
      // would normally rebalance, but the scaffolder bypasses that
      // path; rely on the post-scaffold state to be either a single
      // drawing at 100, or admin-managed afterwards.
      desired.push({
        name: drName,
        weight_percent: 100,
        components: reqComponents,
      });
    }
  }

  return { desired, drawingUpdates, componentUpdates, taskUpdates, drawingsInBlock };
}
