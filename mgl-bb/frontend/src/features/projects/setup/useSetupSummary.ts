/** Rollup / weight-mismatch summary shown in the header.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import { useCallback, useMemo } from 'react';

import { buildSetupSummary } from './buildSetupSummary';
import type { SetupStore } from './useSetupStore';

export function useSetupSummary(store: SetupStore) {
  const {
    t,
    blocks,
    drawings,
    components,
    tasks,
    users,
    allTeams,
    teamShares,
    setExpBlocks,
    setLastOpenedBlock,
  } = store;

  /* ---------- Rollup / summary ---------- */
  const summary = useMemo(
    () => buildSetupSummary({ blocks, drawings, components, tasks, users, teamShares, allTeams, t }),
    [blocks, drawings, components, tasks, users, teamShares, allTeams, t],
  );

  // Parse a mismatch label (e.g. "А блок: зурагууд (90.0%)") and try to
  // find the block it belongs to so we can scroll the user to it.  Falls
  // back to the first block when the label is the project-level one
  // ("Блокууд (...)") which doesn't reference any specific section.
  const jumpToMismatch = useCallback(
    (label: string) => {
      const head = label.split(/[:›]/)[0]?.trim() ?? '';
      const target =
        blocks.find((b) => head === b.name) ?? blocks.find((b) => head.includes(b.name));
      const targetId = target?.id ?? blocks[0]?.id;
      if (!targetId) return;
      setExpBlocks((prev) => {
        const next = new Set(prev);
        next.add(targetId);
        return next;
      });
      setLastOpenedBlock(targetId);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-block-id="${targetId}"]`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [blocks, setExpBlocks, setLastOpenedBlock],
  );

  // Cmd/Ctrl+B → new block, Cmd/Ctrl+D → new drawing in the currently
  // expanded block.  Bound at the page level so admins can scaffold a
  // project structure without touching the mouse.  The picker shortcut
  // for "?" is owned by KeyboardShortcutsHelp itself and Cmd+S by
  // StickySaveBar; this only adds the page-specific actions.  Skipped
  // when focus is in a text field so editors don't lose typed letters.

  return {
    summary,
    jumpToMismatch,
  };
}
