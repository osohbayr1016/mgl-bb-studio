/** Shared dnd sensors and drag-to-reorder for task rows.
 *
 *  Extracted from `AdminProjectSetupPage.tsx` when that ~5 700-line module
 *  was split up. Takes the shared `useSetupStore` — no behavioural change. */
import type { DragEndEvent } from '@dnd-kit/core';
import type { Task } from './types';
import { apiFetch } from '@/shared/api/client';
import { arrayMove } from '@dnd-kit/sortable';
import { useAppDndSensors } from '@/shared/lib/dndSensors';
import type { SetupStore } from './useSetupStore';

export function useTaskDnd(store: SetupStore) {
  const {
    t,
    tasks,
    setTasks,
    flash,
    loadAll,
  } = store;

  /* ---------- Drag-to-reorder tasks ----------
   * Tasks are dragged to reorder within their own component only (no
   * cross-component moves). Structural ops on this page persist
   * immediately (POST/DELETE), so a reorder also writes through right
   * away — mirroring the landing CMS / quote-template reorder UX. */
  const dndSensors = useAppDndSensors();

  // Re-slot one component's tasks into `orderedIds` order inside the flat
  // `tasks` array (the render reads array order via tasks.filter), and bump
  // their sort_order to (i+1)*10 so local state matches what the server writes.
  const reorderTasksLocal = (componentId: number, orderedIds: number[]) => {
    setTasks((prev) => {
      const byId = new Map(
        prev.filter((t) => t.component_id === componentId).map((t) => [t.id, t]),
      );
      const reordered = orderedIds
        .map((id, i) => {
          const t = byId.get(id);
          return t ? { ...t, sort_order: (i + 1) * 10 } : null;
        })
        .filter((t): t is Task => t !== null);
      let qi = 0;
      return prev.map((t) => (t.component_id === componentId ? (reordered[qi++] ?? t) : t));
    });
  };

  const handleTaskDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeId = Number(active.id);
    const overId = Number(over.id);
    const a = tasks.find((t) => t.id === activeId);
    const o = tasks.find((t) => t.id === overId);
    // Within-component only — reject cross-component drops.
    if (!a || !o || a.component_id !== o.component_id) return;
    const compId = a.component_id;
    const compIds = tasks.filter((t) => t.component_id === compId).map((t) => t.id);
    const oldIdx = compIds.indexOf(activeId);
    const newIdx = compIds.indexOf(overId);
    if (oldIdx < 0 || newIdx < 0) return;
    const nextIds = arrayMove(compIds, oldIdx, newIdx);
    reorderTasksLocal(compId, nextIds); // optimistic
    apiFetch('/tasks/reorder', {
      method: 'PUT',
      data: { component_id: compId, task_ids: nextIds },
    }).catch((err: unknown) => {
      flash('error', err instanceof Error ? err.message : t('adminProjectSetupPage.reorderFailed'));
      void loadAll(); // on failure, snap back to the server's truth
    });
  };

  // Blocks belong in the "Бусад" pseudo-tab when team_id IS NULL (legacy
  // un-tagged data) OR when team_id references a team that isn't in this
  // project's roster. The second case is the orphan path — historically
  // those blocks fell through every tab and stayed invisible until an
  // admin re-added the matching team-share, at which point the team
  // could no longer be removed because the orphan now "owned" it.

  return {
    dndSensors,
    reorderTasksLocal,
    handleTaskDragEnd,
  };
}
