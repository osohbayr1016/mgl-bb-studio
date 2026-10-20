/** One-click full scaffold: builds a whole discipline tree from the presets.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import type { Comp, Drawing, Task } from './types';
import { apiFetch } from '@/shared/api/client';
import { useState } from 'react';
import { planScaffold } from './planScaffold';
import type { SetupStore } from './useSetupStore';

export function useSetupScaffold(store: SetupStore) {
  const {
    t,
    drawings,
    setDrawings,
    components,
    setComponents,
    tasks,
    setTasks,
    flash,
  } = store;


  /* ---------- One-click full scaffold ----------------------------------
   * Builds the discipline tree for the block's team under that block,
   * using PRESET_COMPONENT_WEIGHTS → PRESET_TASK_WEIGHTS for the default
   * per-component / per-task percentages.
   *
   * Since each block now belongs to exactly one team, scaffolding only
   * ever creates a single drawing (the one for that team's discipline)
   * — sibling-drawing balancing is handled by `addDrawing`'s
   * auto-even-split. We don't touch an existing drawing's weight here
   * (that's the admin's call, or auto-even-split's job) — EXCEPT when
   * the drawing is the block's only one and doesn't weigh 100: drawings
   * must sum to 100 within a block and the weight input is hidden, so
   * anything else is unfixable legacy residue (the pre-0062 scaffolder
   * seeded 7 discipline drawings per block from PRESET_DRAWING_WEIGHTS,
   * e.g. HAS = 11, and the one-block-per-team remodel left lone
   * drawings at those weights — capping the block's progress at 11%).
   * We self-heal such a drawing to 100 and re-derive its children.
   *
   * Storage convention:
   *   Component and task weights are stored as "% of block" — i.e.
   *   compStored = compPctOfDrawing × drW / 100. WeightInput renders
   *   them divided by the parent drawing's weight, so the admin sees
   *   the user-friendly "% of drawing" number.
   *
   * Idempotency:
   *   The button is safe to re-run. Drawings/components/tasks that
   *   already exist by name are NOT re-inserted; instead we queue
   *   weight-updates for preset-matching rows whose stored value
   *   drifted, so re-clicking refreshes percentages without duplicates.
   */
  const [scaffoldingBlock, setScaffoldingBlock] = useState<number | null>(null);
  const scaffoldBlockTeams = async (blockId: number, codes: Set<string>) => {
    if (scaffoldingBlock != null) return;
    if (codes.size === 0) {
      flash('error', t('adminProjectSetupPage.pickAtLeastOneTeam'));
      return;
    }
    setScaffoldingBlock(blockId);
    try {
      const { desired, drawingUpdates, componentUpdates, taskUpdates, drawingsInBlock } =
        planScaffold({
          blockId,
          codes,
          drawings,
          components,
          tasks,
        });

      const totalUpdates = drawingUpdates.length + componentUpdates.length + taskUpdates.length;
      if (desired.length === 0 && totalUpdates === 0) {
        flash('success', t('adminProjectSetupPage.structureAlreadyReady'));
        return;
      }

      const res = await apiFetch<{
        drawings: {
          id: number;
          name: string;
          components: { id: number; name: string; tasks: { id: number; name: string }[] }[];
        }[];
      }>(`/blocks/${blockId}/scaffold`, {
        data: {
          drawings: desired,
          weightUpdates: {
            drawings: drawingUpdates,
            components: componentUpdates,
            tasks: taskUpdates,
          },
        },
      });

      // Drive the local-state diff from the REQUEST tree (desired) — the
      // response only carries fresh ids; the request knows whether each
      // entry was a "create new" (has name + weight) or "attach to
      // existing" (has existingDrawingId / existingComponentId), which is
      // exactly the information we need to decide what to splice into
      // local state without double-adding rows.
      const drawingsToAdd: Drawing[] = [];
      const componentsToAdd: Comp[] = [];
      const tasksToAdd: Task[] = [];
      let createdDrawings = 0;
      let createdComponents = 0;
      let createdTasks = 0;

      desired.forEach((drReq, dIdx) => {
        const respDr = res.drawings[dIdx];
        if (!respDr) return;
        const drawingId = respDr.id;
        if (!('existingDrawingId' in drReq)) {
          createdDrawings++;
          drawingsToAdd.push({
            id: drawingId,
            block_id: blockId,
            name: drReq.name,
            weight_percent: drReq.weight_percent,
            sort_order: 0,
          });
        }
        drReq.components.forEach((compReq, cIdx) => {
          const respComp = respDr.components[cIdx];
          if (!respComp) return;
          const componentId = respComp.id;
          if (!('existingComponentId' in compReq)) {
            createdComponents++;
            componentsToAdd.push({
              id: componentId,
              drawing_id: drawingId,
              name: compReq.name,
              weight_percent: compReq.weight_percent,
              sort_order: 0,
            });
          }
          (compReq.tasks ?? []).forEach((taskReq, tIdx) => {
            const respTask = respComp.tasks[tIdx];
            if (!respTask) return;
            createdTasks++;
            tasksToAdd.push({
              id: respTask.id,
              component_id: componentId,
              name: taskReq.name,
              weight_percent: taskReq.weight_percent,
              assigned_to: null,
              assignees: [],
              due_date: null,
              start_date: null,
              sort_order: 0,
              progress: 0,
            });
          });
        });
      });

      // Apply queued weight refreshes to local state (the worker has
      // already persisted them in the same atomic call).
      if (drawingUpdates.length) {
        const map = new Map(drawingUpdates.map((u) => [u.id, u.weight_percent]));
        setDrawings((prev) =>
          prev.map((d) => (map.has(d.id) ? { ...d, weight_percent: map.get(d.id)! } : d)),
        );
      }
      if (componentUpdates.length) {
        const map = new Map(componentUpdates.map((u) => [u.id, u.weight_percent]));
        setComponents((prev) =>
          prev.map((c) => (map.has(c.id) ? { ...c, weight_percent: map.get(c.id)! } : c)),
        );
      }
      if (taskUpdates.length) {
        const map = new Map(taskUpdates.map((u) => [u.id, u.weight_percent]));
        setTasks((prev) =>
          prev.map((t) => (map.has(t.id) ? { ...t, weight_percent: map.get(t.id)! } : t)),
        );
      }

      if (drawingsToAdd.length) setDrawings((prev) => [...prev, ...drawingsToAdd]);
      if (componentsToAdd.length) setComponents((prev) => [...prev, ...componentsToAdd]);
      if (tasksToAdd.length) setTasks((prev) => [...prev, ...tasksToAdd]);

      const refreshedCount = drawingUpdates.length + componentUpdates.length + taskUpdates.length;
      const createdCount = createdDrawings + createdComponents + createdTasks;
      if (createdCount === 0 && refreshedCount === 0) {
        flash('success', t('adminProjectSetupPage.structureAlreadyReady'));
      } else if (createdCount === 0) {
        flash('success', t('adminProjectSetupPage.weightsRefreshed', { count: refreshedCount }));
      } else if (drawingsInBlock.length === 0) {
        flash(
          'success',
          t('adminProjectSetupPage.structureCreated', {
            drawings: createdDrawings,
            components: createdComponents,
            tasks: createdTasks,
          }),
        );
      } else {
        const parts = [
          t('adminProjectSetupPage.countDrawings', { count: createdDrawings }),
          t('adminProjectSetupPage.countComponents', { count: createdComponents }),
          t('adminProjectSetupPage.countTasks', { count: createdTasks }),
        ];
        const refreshedSuffix =
          refreshedCount > 0
            ? t('adminProjectSetupPage.weightsRefreshedSuffix', { count: refreshedCount })
            : '';
        flash(
          'success',
          t('adminProjectSetupPage.missingItemsAdded', {
            items: parts.join(', '),
            suffix: refreshedSuffix,
          }),
        );
      }
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.structureFailed'));
    } finally {
      setScaffoldingBlock(null);
    }
  };


  return {
    scaffoldingBlock,
    setScaffoldingBlock,
    scaffoldBlockTeams,
  };
}
