/** Shared state for the project setup page: the block/drawing/component/task
 *  tree, the team-share roster, UI expansion state and the per-row dirty
 *  tracking that `saveAll` consumes.
 *
 *  Every other `useSetup*` hook takes this store as its single argument, so
 *  the page can compose them without prop-drilling two dozen setters.
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up — no behavioural change. */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { toast } from '@/shared/components/Toast';
import { useLanguage } from '@/shared/i18n';
import type { ProjectTeamShare, Team, User } from '@/shared/types';
import type { ProjectCategory } from '@/shared/lib/project-categories';
import { loadProjectTree } from './loadProjectTree';
import { useDirtyTracking } from './useDirtyTracking';

import type { Banner, Block, Comp, Drawing, Task } from './types';

/** Sentinel for the legacy-data tab: blocks saved before the `team_id` model
 *  was introduced surface under a small "Бусад" pseudo-tab so they stay
 *  editable until an admin retags them. */
export const UNGROUPED_TAB = 'ungrouped' as const;
export type TeamTabValue = number | typeof UNGROUPED_TAB | null;

export function useSetupStore() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [projectName, setProjectName] = useState('');
  const [projectCategory, setProjectCategory] = useState<ProjectCategory | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  // Currently-selected team tab. `null` = roster hasn't loaded yet,
  // `'ungrouped'` = legacy-data pseudo-tab.
  const [activeTeamId, setActiveTeamId] = useState<TeamTabValue>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [components, setComponents] = useState<Comp[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  // Per-project team-share roster (project_team_shares).  Loaded as part
  // of `loadAll()` from the project detail endpoint and saved separately
  // via the `PUT .../team-shares` replace-all endpoint — it intentionally
  // does NOT participate in the StickySaveBar dirty counter so admins
  // can save it independently of the block/drawing/component edits.
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [teamShares, setTeamShares] = useState<ProjectTeamShare[]>([]);
  const [teamSharesDirty, setTeamSharesDirty] = useState(false);
  const [savingTeamShares, setSavingTeamShares] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  // Set of currently expanded block IDs.  Multi-open is supported so admins
  // can scan multiple blocks side-by-side or use the "Бүгдийг нээх" toolbar
  // shortcut to open every block at once when reviewing a long project.
  const [expBlocks, setExpBlocks] = useState<Set<number>>(new Set());
  // Most-recently-opened block — used by Cmd/Ctrl+D so the "add drawing"
  // shortcut targets a predictable block when several are open.
  const [lastOpenedBlock, setLastOpenedBlock] = useState<number | null>(null);
  // Active drawing tab per block — { [block_id]: drawing_id_string }.
  // Persists which drawing the admin was editing within each block while
  // they switch between blocks during a long setup session.
  const [activeDrawingByBlock, setActiveDrawingByBlock] = useState<Record<number, string>>({});

  const dirty = useDirtyTracking();

  const flash = (kind: 'success' | 'error', text: string) => {
    if (kind === 'success') {
      toast.success(text);
      setBanner(null);
    } else {
      setBanner({ kind, text });
      toast.error(text);
    }
  };

  const loadAll = async () =>
    loadProjectTree({
      id,
      queryClient,
      t,
      flash,
      resetDirty: dirty.resetDirty,
      setProjectName,
      setProjectCategory,
      setAllTeams,
      setTeamShares,
      setTeamSharesDirty,
      setBlocks,
      setDrawings,
      setComponents,
      setTasks,
      setExpBlocks,
      setLastOpenedBlock,
      setLoading,
    });

  // `loadAll` already pulls /teams as part of the project fetch, so we
  // intentionally do NOT call `loadTeams()` again here — that was a
  // duplicate round-trip on every page mount. /users is fetched via
  // useApiQuery below so it's shared with other admin pages.
  useEffect(() => {
    loadAll(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Shared /users cache — also consumed by UsersPage, ProjectDetailPage
  // (AddMembersDialog), TeamDetailPage. Cross-page navigation reuses
  // this entry inside the TanStack staleTime window.
  const usersQuery = useApiQuery<{ users: User[] }>('/users', { retry: false });
  useEffect(() => {
    if (!usersQuery.data) return;
    setUsers(usersQuery.data.users.filter((u) => u.status === 'active'));
  }, [usersQuery.data]);
  useEffect(() => {
    if (usersQuery.error)
      flash('error', usersQuery.error.message ?? t('adminProjectSetupPage.usersLoadFailed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usersQuery.error]);

  // Auto-pick the first team tab whenever the team-shares roster loads
  // (or its first row changes). Keeps the page from rendering a "no
  // active tab" empty state when admins navigate in for the first time.
  useEffect(() => {
    if (activeTeamId === UNGROUPED_TAB) return;
    if (activeTeamId != null && teamShares.some((ts) => ts.team_id === activeTeamId)) return;
    if (teamShares.length > 0) setActiveTeamId(teamShares[0].team_id);
    else setActiveTeamId(null);
  }, [teamShares, activeTeamId]);

  // Auto-dismiss the inline error banner after a few seconds.  Success
  // states now route through `toast.success` so this only runs for
  // sticky errors that we still want visible above the fold.
  useEffect(() => {
    if (!banner || banner.kind !== 'error') return;
    const timer = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(timer);
  }, [banner]);

  return {
    id,
    user,
    t,
    queryClient,
    projectName,
    setProjectName,
    projectCategory,
    setProjectCategory,
    savingCategory,
    setSavingCategory,
    activeTeamId,
    setActiveTeamId,
    blocks,
    setBlocks,
    drawings,
    setDrawings,
    components,
    setComponents,
    tasks,
    setTasks,
    users,
    setUsers,
    allTeams,
    setAllTeams,
    teamShares,
    setTeamShares,
    teamSharesDirty,
    setTeamSharesDirty,
    savingTeamShares,
    setSavingTeamShares,
    loading,
    setLoading,
    saving,
    setSaving,
    banner,
    setBanner,
    expBlocks,
    setExpBlocks,
    lastOpenedBlock,
    setLastOpenedBlock,
    activeDrawingByBlock,
    setActiveDrawingByBlock,
    dirtyBlockIds: dirty.dirtyBlockIds,
    dirtyDrawingIds: dirty.dirtyDrawingIds,
    dirtyComponentIds: dirty.dirtyComponentIds,
    dirtyTaskIds: dirty.dirtyTaskIds,
    dirtyCount: dirty.dirtyCount,
    setDirtyCount: dirty.setDirtyCount,
    markBlockDirty: dirty.markBlockDirty,
    markDrawingDirty: dirty.markDrawingDirty,
    markComponentDirty: dirty.markComponentDirty,
    markTaskDirty: dirty.markTaskDirty,
    resetDirty: dirty.resetDirty,
    flash,
    loadAll,
  };
}

export type SetupStore = ReturnType<typeof useSetupStore>;
