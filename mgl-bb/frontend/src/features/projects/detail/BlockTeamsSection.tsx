/** Per-team performance breakdown inside the block detail dialog.
 *  Extracted verbatim from `ProjectDetailPage.tsx` (`BlockDetailDialog`)
 *  when that file was split into per-component modules — no behavioural
 *  change. */
import { Link } from 'react-router-dom';
import { Users2 } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Progress } from '@/ui/progress';
import { cn } from '@/shared/lib/utils';
import { teamChipClass } from '@/shared/lib/team-colors';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';

import { groupAssigneesByTeam } from './blockHelpers';
import { progressColor } from './helpers';

export function BlockTeamsSection({
  teams,
}: {
  teams: ReturnType<typeof groupAssigneesByTeam>;
}) {
  const { t } = useLanguage();
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
        <Users2 className="h-3.5 w-3.5" /> {t('projectDetailPage.teamsPerformance')}
      </h3>
      {teams.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-8 border border-dashed border-border rounded-lg">
          {t('projectDetailPage.noAssigneesYet')}
        </div>
      ) : (
        <div className="space-y-2.5">
          {teams.map((team) => {
            const avgProgress =
              team.people.reduce(
                (s, p) => s + (p.weight_total > 0 ? p.weighted_progress / p.weight_total : 0),
                0,
              ) / team.people.length;
            const totalTasksInTeam = team.people.reduce((s, p) => s + p.task_count, 0);
            return (
              <div key={team.key} className="border border-border/60 rounded-lg p-3 bg-card/40">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="outline"
                      className={cn('font-semibold', teamChipClass(team.code))}
                    >
                      {team.code ?? '–'}
                    </Badge>
                    <span className="font-medium text-sm truncate">{team.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      ·{' '}
                      {t('projectDetailPage.peopleTasksCount', {
                        people: team.people.length,
                        tasks: totalTasksInTeam,
                      })}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'text-sm font-bold tabular-nums',
                      avgProgress >= 100
                        ? 'text-emerald-500'
                        : avgProgress > 0
                          ? 'text-primary'
                          : 'text-muted-foreground',
                    )}
                  >
                    {avgProgress.toFixed(0)}%
                  </span>
                </div>
                <Progress
                  value={avgProgress}
                  className="h-1.5 mb-2.5"
                  indicatorClassName={progressColor(avgProgress)}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {team.people.map((p) => {
                    const personProgress =
                      p.weight_total > 0 ? p.weighted_progress / p.weight_total : 0;
                    return (
                      <Link
                        key={p.user_id}
                        to={`/app/users/${p.user_id}`}
                        className="flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/50 transition-colors"
                      >
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="bg-primary/15 text-primary text-[10px] font-semibold">
                            {formatDisplayName(p.full_name)
                              .split(' ')
                              .map((s) => s[0])
                              .slice(0, 2)
                              .join('')
                              .toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">
                            {formatDisplayName(p.full_name)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {t('projectDetailPage.tasksCountShort', { count: p.task_count })}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Progress
                            value={personProgress}
                            className="h-1 w-12"
                            indicatorClassName={progressColor(personProgress)}
                          />
                          <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">
                            {personProgress.toFixed(0)}%
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default BlockTeamsSection;
