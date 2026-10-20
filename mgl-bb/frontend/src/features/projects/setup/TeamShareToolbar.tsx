/** Trailing meter + preset/save buttons on the team-tab strip.
 *
 *  The preset button rewrites every share whose team_code lives in the
 *  historical PRESET_TEAM_SHARES table (BA 30 / BB 32 / HAS 11 / TSBU 8 /
 *  TSAH 10 / HD 5 / AU 4) — handy one-click "make this look like a normal
 *  job" action. Save is decoupled from the StickySaveBar: clicking the
 *  dedicated button flushes only the team-share table, leaving in-progress
 *  block edits untouched.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { Check, Loader2 } from 'lucide-react';

import type { ProjectTeamShare } from '@/shared/types';
import { Button } from '@/ui/button';
import { PRESET_TEAM_SHARES_BY_CODE } from '@/shared/lib/team-share-defaults';
import { PROJECT_CATEGORIES } from '@/shared/lib/project-categories';
import type { ProjectCategory } from '@/shared/lib/project-categories';

import { WeightMeter } from './SectionHeader';

import type { SetupApi } from './useProjectSetup';

export function TeamShareToolbar({
  teamShares,
  shareSum,
  projectCategory,
  applyCategoryTeams,
  applyPresetTeamShares,
  saveTeamShares,
  savingTeamShares,
  teamSharesDirty,
  flash,
  t,
}: {
  teamShares: ProjectTeamShare[];
  shareSum: number;
  projectCategory: ProjectCategory | null;
  applyCategoryTeams: () => { added: number; missing: string[] };
  applyPresetTeamShares: () => { changed: number; skipped: number };
  saveTeamShares: () => void;
  savingTeamShares: boolean;
  teamSharesDirty: boolean;
  flash: (kind: 'success' | 'error', text: string) => void;
  t: SetupApi['t'];
}) {
  if (teamShares.length === 0) return null;

  // Only show the "apply category teams" button when a category is set AND
  // at least one of its teams is missing from the current roster. Otherwise
  // the click would be a no-op.
  const def = projectCategory ? PROJECT_CATEGORIES[projectCategory] : null;
  const have = new Set(teamShares.map((ts) => ts.team_code));
  const missingCount = def ? def.teamCodes.filter((c) => !have.has(c)).length : 0;

  // Only show the preset button if at least one team in this project has a
  // preset entry — otherwise it would do nothing.
  const presetApplicable = teamShares.some(
    (ts) => ts.team_code != null && PRESET_TEAM_SHARES_BY_CODE[ts.team_code] != null,
  );

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <WeightMeter sum={shareSum} itemCount={teamShares.length} />
      {def && missingCount > 0 && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            const r = applyCategoryTeams();
            if (r.added === 0) {
              flash('success', t('adminProjectSetupPage.allCategoryTeamsAdded'));
            } else {
              const note =
                r.missing.length > 0
                  ? t('adminProjectSetupPage.teamsNotFoundNote', { codes: r.missing.join(', ') })
                  : '';
              flash(
                'success',
                t('adminProjectSetupPage.teamsAddedThenSave', { count: r.added, note }),
              );
            }
          }}
          title={`${def.code} — ${def.teamCodes.join(' · ')}`}
        >
          {t('adminProjectSetupPage.addCategoryTeams', { count: missingCount })}
        </Button>
      )}
      {presetApplicable && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => {
            const r = applyPresetTeamShares();
            if (r.changed === 0) {
              flash('success', t('adminProjectSetupPage.presetAlreadyMatches'));
            } else {
              flash('success', t('adminProjectSetupPage.presetSharesApplied', { count: r.changed }));
            }
          }}
          title="BA 30 / BB 32 / HAS 11 / TSBU 8 / TSAH 10 / HD 5 / AU 4"
        >
          {t('adminProjectSetupPage.presetValues')}
        </Button>
      )}
      {teamSharesDirty && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={saveTeamShares}
          disabled={savingTeamShares}
          title={t('adminProjectSetupPage.saveTeamShares')}
        >
          {savingTeamShares ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <Check className="h-3 w-3 mr-1" />
          )}
          {t('common.save')}
        </Button>
      )}
    </div>
  );
}

export default TeamShareToolbar;
