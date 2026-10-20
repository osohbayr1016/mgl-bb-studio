/** Overview filter state: the block-card selection, the team pill strip and
 *  the scroll anchor that jumps to the task list on block select.
 *  Extracted from `ProjectDetailPage.tsx` when that file was split into
 *  per-component modules — no behavioural change. */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useProjectOverviewState() {
  const [selectedBlockId, setSelectedBlockId] = useState<number | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<number | null>(null);
  // "Бүгд" товчоор бүх багийг тодорхой сонгосон эсэх.  Энэ үед auto-pick
  // (эхний багийг автоматаар сонгох) алгасагдаж, бүх багийн блок/ажил
  // харагдана.  Тодорхой баг сонгоход дахин false болно.
  const [showAllTeams, setShowAllTeams] = useState(false);
  // Anchor for the tasks section so we can scroll-down on block select.
  const tasksRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedBlockId == null) return;
    // Defer to the next frame so the block tasks have re-rendered before
    // we scroll to them; otherwise the scroll target shifts mid-flight.
    const timer = window.setTimeout(() => {
      tasksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [selectedBlockId]);

  // Stable so the memo() BlockCard list isn't re-rendered wholesale on every
  // parent render (BlockCard derives the toggle target from its own block.id).
  const selectBlock = useCallback(
    (blockId: number) => setSelectedBlockId((prev) => (prev === blockId ? null : blockId)),
    [],
  );
  const clearBlock = useCallback(() => setSelectedBlockId(null), []);

  const changeTeam = useCallback((teamId: number | null) => {
    setShowAllTeams(false);
    setActiveTeamId(teamId);
    setSelectedBlockId(null);
  }, []);

  const showEveryTeam = useCallback(() => {
    setShowAllTeams(true);
    setActiveTeamId(null);
    setSelectedBlockId(null);
  }, []);

  return {
    selectedBlockId,
    activeTeamId,
    setActiveTeamId,
    showAllTeams,
    tasksRef,
    selectBlock,
    clearBlock,
    changeTeam,
    showEveryTeam,
  };
}
