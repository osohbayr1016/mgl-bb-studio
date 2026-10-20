/** Per-team progress mini-widget shown in the project header.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { Badge } from '@/ui/badge';
import { Progress } from '@/ui/progress';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { useLanguage } from '@/shared/i18n';
import type { TeamProgressItem } from '@/features/projects/components/ProjectInfoTab';

import { TEAM_PREFIX_CODES } from './constants';

export function TeamProgressPreview({
  teams,
  projectProgress,
}: {
  teams: TeamProgressItem[];
  /** Authoritative project total from the backend — uses the hierarchical
   *  formula (block weight × team project share). Passed in so the
   *  headline number on this widget agrees with the "Нийт ажлын явц"
   *  card on Projects / Company; computing it locally from team rows
   *  was task-count-weighted and drifted by ~10 points on multi-team
   *  projects. */
  projectProgress: number;
}) {
  const { t } = useLanguage();
  // Show teams in the canonical discipline order (BA, BB, TSAH, HAS, …) —
  // the same fixed order used everywhere else (team tab strip, blocks) —
  // rather than by progress %, so the rows stay in a predictable place.
  const activeTeams = teams
    .filter((team) => team.taskCount > 0)
    .sort((a, b) => {
      const order = TEAM_PREFIX_CODES as readonly string[];
      const ia = order.indexOf(a.code);
      const ib = order.indexOf(b.code);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  const totalTasks = activeTeams.reduce((sum, team) => sum + team.taskCount, 0);
  const headlineProgress = Math.round(Math.max(0, Math.min(100, projectProgress)));

  return (
    <div className="h-full min-h-[112px] rounded-lg border border-border/60 bg-card/70 backdrop-blur px-3 py-2 overflow-hidden">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {t('projectDetailPage.teamsProgress')}
          </div>
          <div className="mt-0.5 text-lg font-semibold leading-none tabular-nums">
            {headlineProgress}%
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {t('projectDetailPage.activeTeamsTasks', {
              teams: activeTeams.length,
              tasks: totalTasks,
            })}
          </div>
        </div>
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
          {t('projectDetailPage.withTasks')}
        </Badge>
      </div>
      {activeTeams.length === 0 ? (
        <div className="h-12 flex items-center justify-center text-[11px] text-muted-foreground">
          {t('projectDetailPage.noTasks')}
        </div>
      ) : (
        <div className="mt-2 grid gap-1.5">
          {activeTeams.map((team) => (
            <div
              key={team.code}
              className="min-w-0"
              title={t('projectDetailPage.teamProgressTooltip', {
                label: team.label,
                pct: team.progress,
                count: team.taskCount,
              })}
            >
              <div className="grid grid-cols-[42px_minmax(0,1fr)_38px] items-center gap-2">
                <span
                  className={cn(
                    'rounded border px-1.5 py-0.5 text-[10px] font-mono text-center',
                    teamChipClass(team.code),
                  )}
                >
                  {team.code}
                </span>
                <Progress value={team.progress} className="h-1.5" />
                <div className="text-right text-[11px] font-semibold tabular-nums">
                  {team.progress}%
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TeamProgressPreview;
