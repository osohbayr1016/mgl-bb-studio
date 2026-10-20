/** "+ Баг" picker — lists teams from the global roster that aren't already
 *  part of this project. Picking one drops it into team_shares at 0% (admin
 *  sets the real share via the inline input) and switches the active tab.
 *  When the project has a category, the category's teams appear in a
 *  "Категорийн багууд" group at the top with everything else under "Бусад" —
 *  soft filter only, both groups remain selectable.
 *
 *  Extracted verbatim from `AdminProjectSetupPage.tsx` — no behavioural
 *  change. */
import { Plus } from 'lucide-react';

import type { ProjectTeamShare, Team } from '@/shared/types';
import { Badge } from '@/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { PRESET_TEAM_SHARES_BY_CODE } from '@/shared/lib/team-share-defaults';
import { PROJECT_CATEGORIES } from '@/shared/lib/project-categories';
import type { ProjectCategory } from '@/shared/lib/project-categories';

import type { SetupApi } from './useProjectSetup';

export function AddTeamPicker({
  teamShares,
  allTeams,
  projectCategory,
  addTeamShare,
  t,
}: {
  teamShares: ProjectTeamShare[];
  allTeams: Team[];
  projectCategory: ProjectCategory | null;
  addTeamShare: (team: Team) => void;
  t: SetupApi['t'];
}) {
  const inProject = new Set(teamShares.map((ts) => ts.team_id));
  const addable = allTeams.filter((team) => !inProject.has(team.id));
  if (addable.length === 0) return null;

  const renderItem = (team: Team) => {
    const presetShare = PRESET_TEAM_SHARES_BY_CODE[team.code];
    return (
      <DropdownMenuItem
        key={team.id}
        onClick={() => addTeamShare(team)}
        className="flex items-center gap-2"
      >
        <Badge variant="outline" className="text-micro font-mono font-bold px-1.5">
          {team.code}
        </Badge>
        <span className="text-xs truncate flex-1">{team.name_mn}</span>
        {presetShare != null && (
          <span className="text-micro tabular-nums text-muted-foreground flex-shrink-0">
            {presetShare}%
          </span>
        )}
      </DropdownMenuItem>
    );
  };

  const categoryCodes = projectCategory
    ? new Set(PROJECT_CATEGORIES[projectCategory].teamCodes)
    : null;
  const categoryTeams = categoryCodes ? addable.filter((x) => categoryCodes.has(x.code)) : [];
  const otherTeams = categoryCodes ? addable.filter((x) => !categoryCodes.has(x.code)) : addable;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md border border-dashed border-border/60 px-2 py-1 text-micro text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
          title={t('adminProjectSetupPage.addNewTeam')}
        >
          <Plus className="h-3 w-3" /> {t('adminProjectSetupPage.team')}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {categoryTeams.length > 0 && (
          <>
            <DropdownMenuLabel className="text-label text-muted-foreground">
              {t('adminProjectSetupPage.categoryTeams')}
            </DropdownMenuLabel>
            {categoryTeams.map(renderItem)}
            {otherTeams.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {otherTeams.length > 0 && (
          <>
            {categoryTeams.length > 0 && (
              <DropdownMenuLabel className="text-label text-muted-foreground">
                {t('adminProjectSetupPage.other')}
              </DropdownMenuLabel>
            )}
            {otherTeams.map(renderItem)}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default AddTeamPicker;
