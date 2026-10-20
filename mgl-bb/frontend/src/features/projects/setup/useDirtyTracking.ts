/** Per-row dirty tracking for the setup tree.
 *
 *  `saveAll()` only PUTs the rows the user actually edited instead of
 *  round-tripping the entire tree (which on a fully-scaffolded project meant
 *  ~250 sequential PUTs per save click). Extracted verbatim from
 *  `AdminProjectSetupPage.tsx` — no behavioural change. */
import { useCallback, useRef, useState } from 'react';

export function useDirtyTracking() {
  // Dirty tracking — per-row id sets so `saveAll()` only PUTs the rows
  // the user actually edited instead of round-tripping the entire tree
  // (which on a fully-scaffolded project meant ~250 sequential PUTs per
  // save click).  The numeric counter behind it just drives the
  // StickySaveBar copy ("3 хадгалаагүй өөрчлөлт") and is bumped on
  // every dirty-marking call regardless of whether the id was already
  // queued — that's fine, it's an indicator, not an invoice.
  const dirtyBlockIds = useRef<Set<number>>(new Set());
  const dirtyDrawingIds = useRef<Set<number>>(new Set());
  const dirtyComponentIds = useRef<Set<number>>(new Set());
  const dirtyTaskIds = useRef<Set<number>>(new Set());
  const [dirtyCount, setDirtyCount] = useState(0);
  const markBlockDirty = useCallback((bid: number) => {
    dirtyBlockIds.current.add(bid);
    setDirtyCount((n) => n + 1);
  }, []);
  const markDrawingDirty = useCallback((did: number) => {
    dirtyDrawingIds.current.add(did);
    setDirtyCount((n) => n + 1);
  }, []);
  const markComponentDirty = useCallback((cid: number) => {
    dirtyComponentIds.current.add(cid);
    setDirtyCount((n) => n + 1);
  }, []);
  const markTaskDirty = useCallback((tid: number) => {
    dirtyTaskIds.current.add(tid);
    setDirtyCount((n) => n + 1);
  }, []);
  const resetDirty = useCallback(() => {
    dirtyBlockIds.current.clear();
    dirtyDrawingIds.current.clear();
    dirtyComponentIds.current.clear();
    dirtyTaskIds.current.clear();
    setDirtyCount(0);
  }, []);

  return {
    dirtyBlockIds,
    dirtyDrawingIds,
    dirtyComponentIds,
    dirtyTaskIds,
    dirtyCount,
    setDirtyCount,
    markBlockDirty,
    markDrawingDirty,
    markComponentDirty,
    markTaskDirty,
    resetDirty,
  };
}
