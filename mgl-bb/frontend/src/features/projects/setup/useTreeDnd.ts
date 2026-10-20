/** Drag-to-reorder for blocks, drawings and components (the structural tiers).
 *
 *  Extracted from `AdminProjectSetupPage.tsx` when that ~5 700-line module
 *  was split up. Takes the shared `useSetupStore` — no behavioural change. */
import type { Block, Comp, Drawing } from './types';
import type { DragEndEvent } from '@dnd-kit/core';
import { apiFetch } from '@/shared/api/client';
import { arrayMove } from '@dnd-kit/sortable';
import { useCallback, useMemo } from 'react';
import type { SetupStore } from './useSetupStore';

export function useTreeDnd(store: SetupStore) {
  const {
    id,
    t,
    blocks,
    setBlocks,
    drawings,
    setDrawings,
    components,
    setComponents,
    teamShares,
    flash,
    loadAll,
  } = store;

  const teamShareIds = useMemo(() => new Set(teamShares.map((ts) => ts.team_id)), [teamShares]);
  const isOrphanedBlock = useCallback(
    (b: Block) => b.team_id == null || !teamShareIds.has(b.team_id),
    [teamShareIds],
  );

  /* ---------- Drag-to-reorder for blocks / drawings / components ----------
   * Identical mechanic to `handleTaskDragEnd` above: optimistic local
   * update → PUT to /<entity>/reorder → on failure flash + loadAll() to
   * snap back to server truth. Each handler is scoped to the parent the
   * dragged row belongs to (block→project tab, drawing→block, component
   * →drawing) so a stray drop can never reshape a sibling group. */
  const reorderBlocksLocal = (orderedIds: number[]) => {
    setBlocks((prev) => {
      const orderedSet = new Set(orderedIds);
      const byId = new Map(
        prev.filter((b) => orderedSet.has(b.id)).map((b) => [b.id, b] as const),
      );
      const reordered = orderedIds
        .map((bid, i) => {
          const b = byId.get(bid);
          return b ? { ...b, sort_order: (i + 1) * 10 } : null;
        })
        .filter((b): b is Block => b !== null);
      let qi = 0;
      return prev.map((b) => (orderedSet.has(b.id) ? (reordered[qi++] ?? b) : b));
    });
  };

  const handleBlockDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = Number(String(active.id).slice('block-'.length));
    const overId = Number(String(over.id).slice('block-'.length));
    const a = blocks.find((b) => b.id === activeId);
    const o = blocks.find((b) => b.id === overId);
    if (!a || !o) return;
    // Reorder is scoped to the active team tab. Cross-tab drops (block from
    // team A dropped on a team B block, or any block↔Бусад crossover) are
    // rejected — the UI uses separate DndContexts per tab anyway, but the
    // guard keeps the data safe if that ever breaks.
    const aOrphan = isOrphanedBlock(a);
    const oOrphan = isOrphanedBlock(o);
    if (aOrphan !== oOrphan) return;
    if (!aOrphan && a.team_id !== o.team_id) return;
    const sameTab = (b: Block) => (aOrphan ? isOrphanedBlock(b) : b.team_id === a.team_id);
    const tabIds = blocks.filter(sameTab).map((b) => b.id);
    const oldIdx = tabIds.indexOf(activeId);
    const newIdx = tabIds.indexOf(overId);
    if (oldIdx < 0 || newIdx < 0) return;
    const nextIds = arrayMove(tabIds, oldIdx, newIdx);
    reorderBlocksLocal(nextIds);
    apiFetch('/blocks/reorder', {
      method: 'PUT',
      data: { project_id: Number(id), block_ids: nextIds },
    }).catch((err: unknown) => {
      flash('error', err instanceof Error ? err.message : t('adminProjectSetupPage.reorderFailed'));
      void loadAll();
    });
  };

  const reorderDrawingsLocal = (blockId: number, orderedIds: number[]) => {
    setDrawings((prev) => {
      const byId = new Map(
        prev.filter((d) => d.block_id === blockId).map((d) => [d.id, d] as const),
      );
      const reordered = orderedIds
        .map((did, i) => {
          const d = byId.get(did);
          return d ? { ...d, sort_order: (i + 1) * 10 } : null;
        })
        .filter((d): d is Drawing => d !== null);
      let qi = 0;
      return prev.map((d) => (d.block_id === blockId ? (reordered[qi++] ?? d) : d));
    });
  };

  const handleDrawingDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = Number(String(active.id).slice('drawing-'.length));
    const overId = Number(String(over.id).slice('drawing-'.length));
    const a = drawings.find((d) => d.id === activeId);
    const o = drawings.find((d) => d.id === overId);
    if (!a || !o || a.block_id !== o.block_id) return;
    const blockId = a.block_id;
    const ids = drawings.filter((d) => d.block_id === blockId).map((d) => d.id);
    const oldIdx = ids.indexOf(activeId);
    const newIdx = ids.indexOf(overId);
    if (oldIdx < 0 || newIdx < 0) return;
    const nextIds = arrayMove(ids, oldIdx, newIdx);
    reorderDrawingsLocal(blockId, nextIds);
    apiFetch('/drawings/reorder', {
      method: 'PUT',
      data: { block_id: blockId, drawing_ids: nextIds },
    }).catch((err: unknown) => {
      flash('error', err instanceof Error ? err.message : t('adminProjectSetupPage.reorderFailed'));
      void loadAll();
    });
  };

  const reorderComponentsLocal = (drawingId: number, orderedIds: number[]) => {
    setComponents((prev) => {
      const byId = new Map(
        prev.filter((c) => c.drawing_id === drawingId).map((c) => [c.id, c] as const),
      );
      const reordered = orderedIds
        .map((cid, i) => {
          const co = byId.get(cid);
          return co ? { ...co, sort_order: (i + 1) * 10 } : null;
        })
        .filter((c): c is Comp => c !== null);
      let qi = 0;
      return prev.map((c) => (c.drawing_id === drawingId ? (reordered[qi++] ?? c) : c));
    });
  };

  const handleComponentDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = Number(String(active.id).slice('comp-'.length));
    const overId = Number(String(over.id).slice('comp-'.length));
    const a = components.find((c) => c.id === activeId);
    const o = components.find((c) => c.id === overId);
    if (!a || !o || a.drawing_id !== o.drawing_id) return;
    const drawingId = a.drawing_id;
    const ids = components.filter((c) => c.drawing_id === drawingId).map((c) => c.id);
    const oldIdx = ids.indexOf(activeId);
    const newIdx = ids.indexOf(overId);
    if (oldIdx < 0 || newIdx < 0) return;
    const nextIds = arrayMove(ids, oldIdx, newIdx);
    reorderComponentsLocal(drawingId, nextIds);
    apiFetch('/components/reorder', {
      method: 'PUT',
      data: { drawing_id: drawingId, component_ids: nextIds },
    }).catch((err: unknown) => {
      flash('error', err instanceof Error ? err.message : t('adminProjectSetupPage.reorderFailed'));
      void loadAll();
    });
  };



  return {
    teamShareIds,
    isOrphanedBlock,
    reorderBlocksLocal,
    handleBlockDragEnd,
    reorderDrawingsLocal,
    handleDrawingDragEnd,
    reorderComponentsLocal,
    handleComponentDragEnd,
  };
}
