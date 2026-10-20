/** Team-tab navigator — each block is owned by exactly one team via
 *  `block.team_id`. The tab list comes from the project's team_shares roster
 *  (the share % inputs live inline on each tab), plus a "Бусад" pseudo-tab for
 *  legacy blocks that predate the team model.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx`'s render when that
 *  ~5 700-line module was split up — no behavioural change. Props are a
 *  `Pick` of the `useProjectSetup()` API so the page can spread it straight in. */
import { cn } from '@/shared/lib/utils';

import { AddTeamPicker } from './AddTeamPicker';
import { TeamSharePill } from './TeamSharePill';
import { TeamShareToolbar } from './TeamShareToolbar';
import type { SetupApi } from './useProjectSetup';
import { UNGROUPED_TAB } from './useSetupStore';

type Props = Pick<
  SetupApi,
  | 'activeTeamId'
  | 'addTeamShare'
  | 'allTeams'
  | 'applyCategoryTeams'
  | 'applyPresetTeamShares'
  | 'blocks'
  | 'flash'
  | 'isOrphanedBlock'
  | 'projectCategory'
  | 'removeTeamShare'
  | 'saveTeamShares'
  | 'savingTeamShares'
  | 'setActiveTeamId'
  | 't'
  | 'teamShares'
  | 'teamSharesDirty'
  | 'updateTeamShare'
>;

export function TeamTabNavigator(props: Props) {
  const {
    activeTeamId,
    addTeamShare,
    allTeams,
    applyCategoryTeams,
    applyPresetTeamShares,
    blocks,
    flash,
    isOrphanedBlock,
    projectCategory,
    removeTeamShare,
    saveTeamShares,
    savingTeamShares,
    setActiveTeamId,
    t,
    teamShares,
    teamSharesDirty,
    updateTeamShare,
  } = props;

  const hasUngroupedBlocks = blocks.some(isOrphanedBlock);
  if (teamShares.length === 0 && !hasUngroupedBlocks) return null;
  const shareSum = teamShares.reduce((s, ts) => s + Number(ts.share_percent || 0), 0);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border pb-2">
      {teamShares.map((ts) => (
        <TeamSharePill
          key={ts.team_id}
          ts={ts}
          active={activeTeamId === ts.team_id}
          blockCount={blocks.filter((b) => b.team_id === ts.team_id).length}
          onSelect={() => setActiveTeamId(ts.team_id)}
          onShareChange={(value) => updateTeamShare(ts.team_id, value)}
          onRemove={() => {
            const r = removeTeamShare(ts.team_id);
            if (!r.ok) flash('error', r.reason);
          }}
          t={t}
        />
      ))}

      <AddTeamPicker
        teamShares={teamShares}
        allTeams={allTeams}
        projectCategory={projectCategory}
        addTeamShare={addTeamShare}
        t={t}
      />

      {hasUngroupedBlocks && (
        <button
          type="button"
          onClick={() => setActiveTeamId(UNGROUPED_TAB)}
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors',
            activeTeamId === UNGROUPED_TAB
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-dashed border-border/60 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
          )}
          title={t('adminProjectSetupPage.ungroupedTabTitle')}
        >
          <span className="truncate max-w-[160px]">{t('adminProjectSetupPage.other')}</span>
          <span className="text-micro tabular-nums opacity-70">
            ({blocks.filter(isOrphanedBlock).length})
          </span>
        </button>
      )}

      <TeamShareToolbar
        teamShares={teamShares}
        shareSum={shareSum}
        projectCategory={projectCategory}
        applyCategoryTeams={applyCategoryTeams}
        applyPresetTeamShares={applyPresetTeamShares}
        saveTeamShares={saveTeamShares}
        savingTeamShares={savingTeamShares}
        teamSharesDirty={teamSharesDirty}
        flash={flash}
        t={t}
      />
    </div>
  );
}

export default TeamTabNavigator;
