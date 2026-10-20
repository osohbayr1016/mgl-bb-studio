/** Loads the project tree + team roster and seeds the setup store.
 *
 *  The project detail endpoint returns the whole block/drawing/component/task
 *  tree in one request; `/teams` is fetched alongside so the team-share card
 *  has its lookup table ready on first paint. Failures on `/teams` are
 *  non-fatal — the section then renders codes without names.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import type { QueryClient } from '@tanstack/react-query';

import { apiFetch } from '@/shared/api/client';
import type { ProjectTeamShare, Team } from '@/shared/types';
import type { ProjectCategory } from '@/shared/lib/project-categories';
import { isProjectCategory } from '@/shared/lib/project-categories';

import { flattenProjectTree, type ProjectTreeBlock } from './flattenProjectTree';
import type { SetupStore } from './useSetupStore';
import type { Block, Comp, Drawing, Task } from './types';

export type LoadProjectTreeDeps = {
  id: string | undefined;
  queryClient: QueryClient;
  t: SetupStore['t'];
  flash: (kind: 'success' | 'error', text: string) => void;
  resetDirty: () => void;
  setProjectName: (v: string) => void;
  setProjectCategory: (v: ProjectCategory | null) => void;
  setAllTeams: (v: Team[]) => void;
  setTeamShares: (v: ProjectTeamShare[]) => void;
  setTeamSharesDirty: (v: boolean) => void;
  setBlocks: (v: Block[]) => void;
  setDrawings: (v: Drawing[]) => void;
  setComponents: (v: Comp[]) => void;
  setTasks: (v: Task[]) => void;
  setExpBlocks: (fn: (prev: Set<number>) => Set<number>) => void;
  setLastOpenedBlock: (fn: (prev: number | null) => number | null) => void;
  setLoading: (v: boolean) => void;
};

export async function loadProjectTree({
  id,
  queryClient,
  t,
  flash,
  resetDirty,
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
}: LoadProjectTreeDeps) {
    try {
      // Fetch the project tree and the team roster in parallel.  `/teams`
      // is small and effectively cached at the worker, so the cost is
      // negligible — but pulling it here means the team-shares card has
      // its lookup table ready by the time the rest of the page renders
      // (and `+ Баг нэмэх` can offer the right options on first paint).
      // Failures on `/teams` are non-fatal; the section just renders
      // codes without names.
      const [res, teamsRes] = await Promise.all([
        apiFetch<{
          project: { name: string; category?: ProjectCategory | null };
          blocks: ProjectTreeBlock[];
          team_shares?: ProjectTeamShare[];
        }>(`/projects/${id}`),
        apiFetch<{ teams: Team[] }>('/teams').catch(() => ({ teams: [] as Team[] })),
      ]);

      setProjectName(res.project.name);
      setProjectCategory(isProjectCategory(res.project.category) ? res.project.category : null);
      setAllTeams(teamsRes.teams ?? []);
      // Seed the shared /teams cache so other pages that mount inside
      // the staleTime window (UsersPage, TeamsPage, …) skip the
      // duplicate round-trip.
      queryClient.setQueryData(['/teams'], teamsRes);
      setTeamShares(res.team_shares ?? []);
      setTeamSharesDirty(false);

      const flat = flattenProjectTree(res.blocks);
      setBlocks(flat.blocks);
      setDrawings(flat.drawings);
      setComponents(flat.components);
      setTasks(flat.tasks);
      // Auto-expand the first block on initial load so the admin doesn't
      // have to click a chevron to start editing — most projects have one
      // primary block and burying its body behind an interaction was a
      // recurring source of confusion.
      if (flat.blocks.length > 0) {
        setExpBlocks((prev) => (prev.size === 0 ? new Set([flat.blocks[0].id]) : prev));
        setLastOpenedBlock((prev) => prev ?? flat.blocks[0].id);
      }
      resetDirty();
    } catch (e) {
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.projectLoadFailed'));
    }
    setLoading(false);
}
