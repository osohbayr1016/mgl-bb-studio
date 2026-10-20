/** Creating blocks / drawings / components / tasks.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import { UNGROUPED_TAB } from './useSetupStore';
import { apiFetch } from '@/shared/api/client';
import { splitEvenly } from './weights';
import type { SetupStore } from './useSetupStore';

/** What the four single-item create endpoints answer with: HTTP 201 and a flat
 *  `{ message, id }` envelope (see `blocks.ts` / `drawings.ts` / `components.ts`
 *  / `tasks.ts` — each does `c.json({ message: '… created', id: result?.id }, 201)`).
 *  There is no nested `{ block: … }` form, so no fallback is needed.
 *
 *  Both keys are optional: the worker writes `id: result?.id`, and `apiFetch`
 *  degrades an unparseable 2xx body to `{}` — so either can really be missing.
 *  Only `id` is read, and each caller checks it before seeding local state. */
interface CreatedIdResponse {
  message?: string;
  id?: number;
}

export function useSetupAdd(store: SetupStore) {
  const {
    id,
    t,
    activeTeamId,
    blocks,
    setBlocks,
    setDrawings,
    setComponents,
    setTasks,
    markDrawingDirty,
    flash,
  } = store;


  /* ---------- Add ---------- */
  const addBlock = async (teamId?: number | null) => {
    try {
      // New block inherits whichever team tab is active (or whatever the
      // caller explicitly passes — keyboard shortcuts and toolbar
      // buttons both go through here). Falls back to null for legacy
      // projects whose roster hasn't loaded yet. The `'ungrouped'`
      // sentinel maps to null so we never mint more untagged blocks.
      const fromTab = activeTeamId === UNGROUPED_TAB ? null : activeTeamId;
      const ownerTeamId = teamId ?? fromTab ?? null;
      const r = await apiFetch<CreatedIdResponse>('/blocks', {
        data: {
          project_id: Number(id),
          name: 'Шинэ блок',
          weight_percent: 0,
          team_id: ownerTeamId,
        },
      });
      const newId = r.id;
      if (newId == null) throw new Error(t('adminProjectSetupPage.blockAddFailed'));
      setBlocks((p) => [
        ...p,
        {
          id: newId,
          name: 'Шинэ блок',
          weight_percent: 0,
          sort_order: blocks.length,
          team_id: ownerTeamId,
        },
      ]);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.blockAddFailed'));
    }
  };
  const addDrawing = async (blockId: number, name = 'Шинэ зураг') => {
    try {
      const r = await apiFetch<CreatedIdResponse>('/drawings', {
        data: { block_id: blockId, name, weight_percent: 0 },
      });
      const newId = r.id;
      if (newId == null) throw new Error(t('adminProjectSetupPage.drawingAddFailed'));
      // Drawings are folders in the UI (weight input hidden), so we
      // unconditionally re-even-split sibling drawings on every add.
      // Storage convention: component/task weights are "% of block",
      // so changing the parent drawing's weight here doesn't require
      // touching them — the rollup math (taskW × taskProgress / drW)
      // produces the same block contribution either way; only the
      // displayed "% of drawing" denominator changes, which the admin
      // doesn't see.
      setDrawings((p) => {
        const next = [
          ...p,
          { id: newId, block_id: blockId, name, weight_percent: 0, sort_order: 0 },
        ];
        const siblings = next.filter((d) => d.block_id === blockId);
        if (siblings.length === 0) return next;
        siblings.forEach((s) => markDrawingDirty(s.id));
        const { share, last } = splitEvenly(siblings.length);
        return next.map((d) => {
          if (d.block_id !== blockId) return d;
          const idx = siblings.findIndex((s) => s.id === d.id);
          return { ...d, weight_percent: idx === siblings.length - 1 ? last : share };
        });
      });
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.drawingAddFailed'));
    }
  };
  const addComponent = async (drawingId: number, name = 'Шинэ бүрдэл') => {
    try {
      const r = await apiFetch<CreatedIdResponse>('/components', {
        data: { drawing_id: drawingId, name, weight_percent: 0 },
      });
      const newId = r.id;
      if (newId == null) throw new Error(t('adminProjectSetupPage.componentAddFailed'));
      setComponents((p) => [
        ...p,
        {
          id: newId,
          drawing_id: drawingId,
          name,
          weight_percent: 0,
          sort_order: 0,
        },
      ]);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.componentAddFailed'));
    }
  };
  const addTask = async (compId: number, name = 'Шинэ ажил') => {
    try {
      const r = await apiFetch<CreatedIdResponse>('/tasks', {
        data: { component_id: compId, name, weight_percent: 0 },
      });
      const newId = r.id;
      if (newId == null) throw new Error(t('adminProjectSetupPage.taskAddFailed'));
      setTasks((p) => [
        ...p,
        {
          id: newId,
          component_id: compId,
          name,
          weight_percent: 0,
          assigned_to: null,
          assignees: [],
          due_date: null,
          start_date: null,
          sort_order: 0,
          progress: 0,
        },
      ]);
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.taskAddFailed'));
    }
  };

  return {
    addBlock,
    addDrawing,
    addComponent,
    addTask,
  };
}
