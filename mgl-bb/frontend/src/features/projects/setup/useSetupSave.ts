/** Persists only the rows the user actually edited.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import { apiFetch } from '@/shared/api/client';
import { num } from './weights';
import type { SetupStore } from './useSetupStore';

export function useSetupSave(store: SetupStore) {
  const {
    t,
    blocks,
    drawings,
    components,
    tasks,
    setSaving,
    dirtyBlockIds,
    dirtyDrawingIds,
    dirtyComponentIds,
    dirtyTaskIds,
    flash,
    setDirtyCount,
  } = store;


  /* ---------- Save ----------
   * Components started life as visual-only folders; they're now optionally
   * weight-bearing. A component with `weight_percent > 0` becomes a target
   * for its tasks (tasks sum to the component, components sum to the parent
   * drawing). Components left at 0 are still groupings — their tasks count
   * directly toward the parent drawing along with sibling components' tasks.
   * Either way we PUT `weight_percent`; backend defaults work for both
   * paths. */
  const saveAll = async () => {
    // Snapshot the dirty sets so concurrent edits during the save don't
    // get silently dropped — we'll only clear ids that we actually flushed.
    const blockIds = new Set(dirtyBlockIds.current);
    const drawIds = new Set(dirtyDrawingIds.current);
    const compIds = new Set(dirtyComponentIds.current);
    const taskIds = new Set(dirtyTaskIds.current);

    if (blockIds.size + drawIds.size + compIds.size + taskIds.size === 0) {
      flash('success', t('adminProjectSetupPage.noChangesToSave'));
      return;
    }

    setSaving(true);
    try {
      // Parallel within each tier, sequential between tiers (drawings
      // depend on blocks existing, etc.).  Hundreds of rows-per-save
      // becomes a handful of round-trips' worth of latency this way.
      const dirtyBlocks = blocks.filter((b) => blockIds.has(b.id));
      const dirtyDraws = drawings.filter((d) => drawIds.has(d.id));
      const dirtyComps = components.filter((c) => compIds.has(c.id));
      const dirtyTasks = tasks.filter((t) => taskIds.has(t.id));

      await Promise.all(
        dirtyBlocks.map((b) =>
          apiFetch(`/blocks/${b.id}`, {
            method: 'PUT',
            data: { name: b.name, weight_percent: num(b.weight_percent) },
          }),
        ),
      );
      await Promise.all(
        dirtyDraws.map((d) =>
          apiFetch(`/drawings/${d.id}`, {
            method: 'PUT',
            data: { name: d.name, weight_percent: num(d.weight_percent) },
          }),
        ),
      );
      await Promise.all(
        dirtyComps.map((c) =>
          apiFetch(`/components/${c.id}`, {
            method: 'PUT',
            data: { name: c.name, weight_percent: num(c.weight_percent) },
          }),
        ),
      );
      await Promise.all(
        dirtyTasks.map((t) =>
          apiFetch(`/tasks/${t.id}`, {
            method: 'PUT',
            data: {
              name: t.name,
              weight_percent: num(t.weight_percent),
              // 2026-10-01: `assignees` илгээхгүй — хүнд оноох боломж хасагдсан.
              due_date: t.due_date ?? null,
              start_date: t.start_date ?? null,
            },
          }),
        ),
      );

      // Drop every id we flushed; anything marked dirty during the await
      // window is left in place so the next Save click picks it up.
      blockIds.forEach((id) => dirtyBlockIds.current.delete(id));
      drawIds.forEach((id) => dirtyDrawingIds.current.delete(id));
      compIds.forEach((id) => dirtyComponentIds.current.delete(id));
      taskIds.forEach((id) => dirtyTaskIds.current.delete(id));
      const remaining =
        dirtyBlockIds.current.size +
        dirtyDrawingIds.current.size +
        dirtyComponentIds.current.size +
        dirtyTaskIds.current.size;
      setDirtyCount(remaining);

      flash('success', t('adminProjectSetupPage.savedSuccessfully'));
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('common.saveFailed'));
    }
    setSaving(false);
  };


  return {
    saveAll,
  };
}
