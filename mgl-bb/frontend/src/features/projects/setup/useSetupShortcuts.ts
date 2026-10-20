/** Cmd/Ctrl+B (new block) and Cmd/Ctrl+D (new drawing) keyboard shortcuts.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that module was
 *  split up — no behavioural change. */
import { useEffect } from 'react';

import type { SetupStore } from './useSetupStore';

export function useSetupShortcuts(
  store: SetupStore,
  canManageSetup: boolean,
  deps: {
    addBlock: (teamId?: number | null) => void;
    addDrawing: (blockId: number, name?: string) => void;
  },
) {
  const { activeTeamId, expBlocks, lastOpenedBlock } = store;
  const { addBlock, addDrawing } = deps;

  useEffect(() => {
    if (!canManageSetup) return;
    function onKey(e: KeyboardEvent) {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      const k = e.key.toLowerCase();
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const inEditable = tag === 'input' || tag === 'textarea';
      if (k === 'b' && !inEditable) {
        e.preventDefault();
        // Inherit the active team-tab so the shortcut creates a block
        // visible under the current team, not a stray "Бусад" entry.
        addBlock(typeof activeTeamId === 'number' ? activeTeamId : null);
      } else if (k === 'd' && !inEditable) {
        const target =
          lastOpenedBlock != null && expBlocks.has(lastOpenedBlock)
            ? lastOpenedBlock
            : expBlocks.values().next().value;
        if (target != null) {
          e.preventDefault();
          addDrawing(target);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageSetup, expBlocks, lastOpenedBlock, activeTeamId]);
}
