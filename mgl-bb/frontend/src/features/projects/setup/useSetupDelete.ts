/** Delete + duplicate + the per-task baseline write.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import { ApiError, apiFetch } from '@/shared/api/client';
import type { SetupStore } from './useSetupStore';

export function useSetupDelete(store: SetupStore) {
  const {
    t,
    blocks,
    setBlocks,
    drawings,
    setDrawings,
    components,
    setComponents,
    tasks,
    setTasks,
    setSaving,
    dirtyBlockIds,
    dirtyDrawingIds,
    dirtyComponentIds,
    dirtyTaskIds,
    flash,
    loadAll,
  } = store;


  /* ---------- Delete ---------- */
  const delBlock = async (bid: number) => {
    try {
      await apiFetch(`/blocks/${bid}`, { method: 'DELETE' });
      dirtyBlockIds.current.delete(bid);
      // Cascade the deletion through local state so we don't leak
      // orphan components/tasks pointing at dead drawing ids. The
      // backend cascade already wiped them; we just mirror that.
      const drawIds = new Set(drawings.filter((d) => d.block_id === bid).map((d) => d.id));
      drawIds.forEach((id) => dirtyDrawingIds.current.delete(id));
      const compIds = new Set(components.filter((c) => drawIds.has(c.drawing_id)).map((c) => c.id));
      compIds.forEach((id) => dirtyComponentIds.current.delete(id));
      const taskIds = new Set(tasks.filter((t) => compIds.has(t.component_id)).map((t) => t.id));
      taskIds.forEach((id) => dirtyTaskIds.current.delete(id));
      setBlocks((p) => p.filter((b) => b.id !== bid));
      setDrawings((p) => p.filter((d) => !drawIds.has(d.id)));
      setComponents((p) => p.filter((c) => !compIds.has(c.id)));
      setTasks((p) => p.filter((t) => !taskIds.has(t.id)));
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('common.deleteFailed'));
    }
  };

  /* ---------- Duplicate ----------
   * Blocks tend to repeat across floors/towers with the same drawings,
   * components, tasks and subtasks — so we let admins deep-copy one and
   * then tweak the clone instead of re-building from scratch. */
  const dupBlock = async (bid: number) => {
    const src = blocks.find((b) => b.id === bid);
    if (!src) return;
    // One id per click: a retried/double request returns the first copy instead
    // of making a second one.  The whole tree is copied in one transaction, so a
    // failure leaves nothing behind.
    const requestId = `dup-${crypto.randomUUID()}`;
    try {
      setSaving(true);
      try {
        await apiFetch(`/blocks/${bid}/duplicate`, { data: { request_id: requestId } });
      } catch (e) {
        // The team's block weights would pass 100% — ask before adding the copy.
        if (!(e instanceof ApiError) || e.code !== 'WEIGHT_BUDGET_EXCEEDED') throw e;
        const after = (e.payload.weight_budget as { after?: number } | undefined)?.after;
        if (!window.confirm(t('adminProjectSetupPage.copyOverBudget', { after: after ?? '?' }))) return;
        await apiFetch(`/blocks/${bid}/duplicate`, {
          data: { request_id: requestId, allow_over_budget: true },
        });
      }
      // Cheapest way to get the full hierarchy back with fresh IDs is a reload,
      // since duplicate creates a whole sub-tree.
      await loadAll();
      flash('success', t('adminProjectSetupPage.blockCopied', { name: src.name }));
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.copyFailed'));
    } finally {
      setSaving(false);
    }
  };
  /* ---------- Rename a duplicated block ----------
   * The pencil on a «(хуулбар)» block saves the new name straight away
   * (name-only PUT — the backend recalcs points only when the weight is in
   * the body) so it does not wait for "Save All" and never marks the block
   * dirty. Resolves `true` on success so the row can close its editor. */
  const renameBlock = async (bid: number, raw: string): Promise<boolean> => {
    const name = raw.trim();
    if (!name) return false;
    try {
      await apiFetch(`/blocks/${bid}`, { method: 'PUT', data: { name } });
      setBlocks((p) => p.map((b) => (b.id === bid ? { ...b, name } : b)));
      flash('success', t('adminProjectSetupPage.blockRenamed'));
      return true;
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.renameFailed'));
      return false;
    }
  };
  const delDraw = async (did: number) => {
    try {
      await apiFetch(`/drawings/${did}`, { method: 'DELETE' });
      dirtyDrawingIds.current.delete(did);
      const compIds = new Set(components.filter((c) => c.drawing_id === did).map((c) => c.id));
      compIds.forEach((id) => dirtyComponentIds.current.delete(id));
      const taskIds = new Set(tasks.filter((t) => compIds.has(t.component_id)).map((t) => t.id));
      taskIds.forEach((id) => dirtyTaskIds.current.delete(id));
      setDrawings((p) => p.filter((d) => d.id !== did));
      setComponents((p) => p.filter((c) => !compIds.has(c.id)));
      setTasks((p) => p.filter((t) => !taskIds.has(t.id)));
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('common.deleteFailed'));
    }
  };
  const delComp = async (cid: number) => {
    try {
      await apiFetch(`/components/${cid}`, { method: 'DELETE' });
      dirtyComponentIds.current.delete(cid);
      const taskIds = new Set(tasks.filter((t) => t.component_id === cid).map((t) => t.id));
      taskIds.forEach((id) => dirtyTaskIds.current.delete(id));
      setComponents((p) => p.filter((c) => c.id !== cid));
      setTasks((p) => p.filter((t) => !taskIds.has(t.id)));
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('common.deleteFailed'));
    }
  };
  const delTask = async (tid: number) => {
    try {
      await apiFetch(`/tasks/${tid}`, { method: 'DELETE' });
      dirtyTaskIds.current.delete(tid);
      setTasks((p) => p.filter((t) => t.id !== tid));
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('common.deleteFailed'));
    }
  };

  /**
   * Save the carry-over (Excel-era) progress % for a single task.  Goes
   * straight to the dedicated baseline endpoint — does NOT touch the
   * dirty-state machine because each save is its own POST and there's
   * nothing to "Save All" later.  We update the local task.progress
   * optimistically so the row reflects the new % immediately, and roll
   * back if the API call fails.
   */
  const setTaskBaseline = async (tid: number, raw: number): Promise<void> => {
    const prev = tasks.find((t) => t.id === tid)?.progress ?? 0;
    const pct = Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : 0));
    if (Math.abs(pct - prev) < 0.01) return; // no-op
    setTasks((p) => p.map((t) => (t.id === tid ? { ...t, progress: pct } : t)));
    try {
      await apiFetch(`/tasks/${tid}/baseline`, {
        method: 'POST',
        data: { percentage: pct },
      });
      flash(
        'success',
        pct > 0
          ? t('adminProjectSetupPage.baselineSaved', { pct: pct.toFixed(0) })
          : t('adminProjectSetupPage.baselineCleared'),
      );
      // Notify the project-overview page (and any other listeners such
      // as the dashboard score chart) so they refetch and reflect the
      // new baseline immediately. Without this, navigating to Overview
      // shows the stale "0 %" until a hard refresh.
      window.dispatchEvent(
        new CustomEvent('progress:submitted', {
          detail: { taskId: tid, percentage: pct, source: 'baseline' },
        }),
      );
    } catch (e) {
      setTasks((p) => p.map((t) => (t.id === tid ? { ...t, progress: prev } : t)));
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.baselineSaveFailed'));
      // Re-throw so the row UI can surface a failed-save indicator
      // instead of flashing "saved" when the POST never landed.
      throw e;
    }
  };

  // ── Stable wrappers for the per-task row handlers ─────────────────────────
  // memo(TaskRow) only skips re-rendering an unchanged row if its callback props
  // are referentially stable. The underlying handlers close over changing state
  // (e.g. setTaskBaseline reads `tasks`), so rather than useCallback-ing each
  // (and risking stale deps) we route every call through a ref that always holds

  return {
    delBlock,
    dupBlock,
    renameBlock,
    delDraw,
    delComp,
    delTask,
    setTaskBaseline,
  };
}
