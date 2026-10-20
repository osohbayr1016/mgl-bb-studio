/** Team-share roster (Багийн хуваарь) editing plus its standalone
 *  replace-all save. The roster is deliberately NOT part of the StickySaveBar
 *  dirty counter — it has its own PUT endpoint.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` when that ~5 700-line
 *  module was split up. Takes the shared `useSetupStore` — no behavioural
 *  change. */
import type { ProjectTeamShare, Team, TeamShareInput } from '@/shared/types';
import { apiFetch } from '@/shared/api/client';
import { useTeamSharePresets } from './useTeamSharePresets';
import type { SetupStore } from './useSetupStore';

export function useTeamShares(store: SetupStore) {
  const {
    id,
    t,
    activeTeamId,
    setActiveTeamId,
    blocks,
    teamShares,
    setTeamShares,
    setTeamSharesDirty,
    setSavingTeamShares,
    flash,
  } = store;

  const presets = useTeamSharePresets(store);

  const updateTeamShare = (teamId: number, share_percent: number) => {
    setTeamShares((prev) =>
      prev.map((ts) => (ts.team_id === teamId ? { ...ts, share_percent } : ts)),
    );
    setTeamSharesDirty(true);
  };

  // Push a new team into the project's team-share roster. The new entry
  // lands with share_percent=0 — the admin sets a real % via the inline
  // input. We don't auto-rebalance siblings since the existing teams
  // may have hand-tuned percentages we shouldn't clobber.
  //
  // The roster is persisted server-side immediately via the existing
  // replace-all PUT. Doing it eagerly (instead of marking the row dirty
  // and waiting for the user to hit "Хадгалах") closes a footgun: any
  // subsequent loadAll() — e.g. inside dupBlock — would otherwise
  // overwrite local teamShares with the server view and silently drop
  // the unsaved row, leaving any blocks the admin had just created
  // under that team orphaned in the "Бусад" pseudo-tab.
  const addTeamShare = async (team: Team) => {
    if (teamShares.some((ts) => ts.team_id === team.id)) return;
    const prevShares = teamShares;
    const prevActive = activeTeamId;
    const next: ProjectTeamShare[] = [
      ...prevShares,
      {
        id: 0,
        project_id: Number(id ?? 0),
        team_id: team.id,
        share_percent: 0,
        sort_order: prevShares.length,
        team_code: team.code,
        team_name_mn: team.name_mn,
        team_name_en: team.name_en,
      } as ProjectTeamShare,
    ];
    setTeamShares(next);
    setActiveTeamId(team.id);
    try {
      const res = await apiFetch<{ team_shares: ProjectTeamShare[] }>(
        `/projects/${id}/team-shares`,
        {
          method: 'PUT',
          data: {
            team_shares: next.map((ts, i) => ({
              team_id: ts.team_id,
              share_percent: Math.max(0, Math.min(100, Number(ts.share_percent || 0))),
              sort_order: i,
            })),
          },
        },
      );
      setTeamShares(res.team_shares ?? next);
      setTeamSharesDirty(false);
    } catch (e) {
      setTeamShares(prevShares);
      setActiveTeamId(prevActive);
      flash('error', e instanceof Error ? e.message : t('adminProjectSetupPage.teamSaveFailed'));
    }
  };

  // Drop a team from the project's roster. Refused when the team still
  // owns at least one block AND the share already exists in the DB —
  // there, removing would orphan blocks the admin created intentionally.
  // For an unsaved add (ts.id === 0) we always allow the undo: any
  // matching blocks were already orphaned BEFORE the add (they show in
  // "Бусад"), so removing the fresh share leaves them in the same state.
  const removeTeamShare = (teamId: number): { ok: true } | { ok: false; reason: string } => {
    const share = teamShares.find((ts) => ts.team_id === teamId);
    const ownedBlocks = blocks.filter((b) => b.team_id === teamId).length;
    if (ownedBlocks > 0 && share && share.id !== 0) {
      return {
        ok: false,
        reason: t('adminProjectSetupPage.deleteBlocksFirst', { count: ownedBlocks }),
      };
    }
    setTeamShares((prev) => prev.filter((ts) => ts.team_id !== teamId));
    setTeamSharesDirty(true);
    if (activeTeamId === teamId) {
      const next = teamShares.find((ts) => ts.team_id !== teamId);
      setActiveTeamId(next?.team_id ?? null);
    }
    return { ok: true };
  };

  const saveTeamShares = async () => {
    setSavingTeamShares(true);
    try {
      const body: { team_shares: TeamShareInput[] } = {
        team_shares: teamShares.map((ts, i) => ({
          team_id: ts.team_id,
          share_percent: Math.max(0, Math.min(100, Number(ts.share_percent || 0))),
          sort_order: i,
        })),
      };
      const res = await apiFetch<{ team_shares: ProjectTeamShare[] }>(
        `/projects/${id}/team-shares`,
        { method: 'PUT', data: body },
      );
      setTeamShares(res.team_shares ?? []);
      setTeamSharesDirty(false);
      flash('success', t('adminProjectSetupPage.teamSharesSaved'));
    } catch (e) {
      flash(
        'error',
        e instanceof Error ? e.message : t('adminProjectSetupPage.teamSharesSaveFailed'),
      );
    } finally {
      setSavingTeamShares(false);
    }
  };

  return {
    updateTeamShare,
    addTeamShare,
    removeTeamShare,
    saveTeamShares,
    ...presets,
  };
}
