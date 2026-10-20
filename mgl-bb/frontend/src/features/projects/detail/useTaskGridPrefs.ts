/** Sort + column-width state for the project overview task grids.
 *  Extracted from `ProjectDetailPage.tsx` (the `TasksFlatTable` body) when
 *  that file was split into per-component modules — no behavioural change. */
import { useCallback, useEffect, useState } from 'react';

import type { FlatTask } from './types';

// ----- Sort state per tab -----
// The flat data-grid is sortable by discipline, drawing, component,
// assignee, weights, and progress. We keep one sort spec per tab so
// switching tabs doesn't lose your previously-chosen ordering.
export type SortKey =
  | 'discipline'
  | 'drawing'
  | 'component'
  | 'name'
  | 'assignee'
  | 'leafWeight'
  | 'projectShare'
  | 'progress';
export type SortDir = 'asc' | 'desc';
export type SortSpec = { key: SortKey; dir: SortDir } | null;

export function useTabbedSort() {
  const [sortByTab, setSortByTab] = useState<Record<string, SortSpec>>({});
  const sortFor = useCallback((tabKey: string): SortSpec => sortByTab[tabKey] ?? null, [sortByTab]);
  const cycleSort = useCallback((tabKey: string, key: SortKey) => {
    setSortByTab((prev) => {
      const cur = prev[tabKey] ?? null;
      let next: SortSpec;
      if (!cur || cur.key !== key) next = { key, dir: 'asc' };
      else if (cur.dir === 'asc') next = { key, dir: 'desc' };
      else next = null; // third click clears
      return { ...prev, [tabKey]: next };
    });
  }, []);
  return { sortFor, cycleSort };
}

/** Apply a sort spec to a task list, returning a new array.  `workerName` —
 *  «Одоо хийж буй» баганын эрэмбэ (2026-10-01: нэр = одоо ажиллаж буй хүн). */
export function sortTasks(
  list: FlatTask[],
  sort: SortSpec,
  workerName: (taskId: number) => string = () => '',
): FlatTask[] {
  const sorted = [...list];
  if (!sort) return sorted;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const cmpStr = (a: string, b: string) => a.localeCompare(b, 'mn') * dir;
  const cmpNum = (a: number, b: number) => (a - b) * dir;
  const accessor: Record<SortKey, (t: FlatTask) => string | number> = {
    discipline: (t) => t.teamCode ?? '_none',
    drawing: (t) => t.drawing,
    component: (t) => t.component ?? '',
    name: (t) => t.name,
    assignee: (t) => workerName(t.id),
    leafWeight: (t) => t.leafWeight,
    projectShare: (t) => t.projectShare,
    progress: (t) => t.progress,
  };
  sorted.sort((a, b) => {
    const va = accessor[sort.key](a);
    const vb = accessor[sort.key](b);
    return typeof va === 'number' && typeof vb === 'number'
      ? cmpNum(va, vb)
      : cmpStr(String(va), String(vb));
  });
  return sorted;
}

// Resizable Ажил column. Long task names get clipped because Ажил
// is squeezed by the four right-side columns (Хариуцагч + three %
// columns). The admin drags a single handle at the Ажил ↔ Хариуцагч
// boundary: dragging right widens Ажил and shifts the four right-
// side columns bodily to the right WITHOUT changing their widths.
// The table grows past the card boundary; the existing table
// container's overflow-x-auto produces a horizontal scrollbar so
// the % columns remain reachable. Persisted per browser.
const AJIL_EXTRA_W_KEY = 'mgl:projectDetail:ajilExtraWidth';
const AJIL_EXTRA_W_MIN = 0;
const AJIL_EXTRA_W_MAX = 1500;

export function useAjilColumnWidth() {
  const [ajilExtraWidth, setAjilExtraWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = window.localStorage.getItem(AJIL_EXTRA_W_KEY);
    const n = stored ? parseInt(stored, 10) : NaN;
    return Number.isFinite(n) && n >= AJIL_EXTRA_W_MIN && n <= AJIL_EXTRA_W_MAX ? n : 0;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(AJIL_EXTRA_W_KEY, String(ajilExtraWidth));
    } catch {
      /* localStorage disabled — width still works for this session */
    }
  }, [ajilExtraWidth]);

  const startAjilResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = ajilExtraWidth;
    const onMove = (mv: PointerEvent) => {
      const dx = mv.clientX - startX;
      setAjilExtraWidth(Math.max(AJIL_EXTRA_W_MIN, Math.min(AJIL_EXTRA_W_MAX, startW + dx)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // CSS variable cascades to both the flat "Бүгд" table and the
  // per-discipline GroupedTasksTable so they share the same width.
  const cardStyle = { '--ajil-extra-w': `${ajilExtraWidth}px` } as React.CSSProperties;
  // Inline style applied to each <Table>. Using min-width (not width)
  // works more reliably across browsers for <table> elements: the table
  // is at least 100% + extra wide, and the auto Ажил column absorbs all
  // the slack. We override the base `w-full` class with `w-auto` in the
  // className so the inline `min-width` actually takes effect.
  const tableStyle = {
    minWidth: `calc(100% + var(--ajil-extra-w, 0px))`,
  } as React.CSSProperties;

  return { startAjilResize, cardStyle, tableStyle };
}
