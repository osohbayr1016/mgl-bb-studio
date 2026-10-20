/** One progress-report row in the project activity feed.
 *  Extracted verbatim from `ProjectDetailPage.tsx` when that file was split
 *  into per-component modules — no behavioural change. */
import { memo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight as ChevronRightIcon } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Progress } from '@/ui/progress';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { progressColor, timeAgo } from './helpers';
import type { ActivityEntry } from './types';

export const ActivityRow = memo(function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const { t } = useLanguage();
  const isRest = entry.is_rest_day === 1;
  const initials = entry.user_name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  /* Status colour — pending = amber, approved = emerald, rejected = red,
     rest = blue. Keeps the eye drawn to anything that needs attention
     (pending review) when scrolling the feed. */
  const status: { label: string; cls: string } = isRest
    ? {
        label: t('projectDetailPage.statusRested'),
        cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
      }
    : entry.status === 'approved'
      ? {
          label: t('projectDetailPage.statusApproved'),
          cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
        }
      : entry.status === 'rejected'
        ? {
            label: t('projectDetailPage.statusRejected'),
            cls: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30',
          }
        : {
            label: t('projectDetailPage.statusPending'),
            cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
          };

  return (
    <div className="px-3 py-2.5 flex items-start gap-3 hover:bg-muted/30 transition-colors">
      <Link to={`/app/users/${entry.user_id}`} className="flex-shrink-0">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
            {initials}
          </AvatarFallback>
        </Avatar>
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/app/users/${entry.user_id}`}
            className="text-sm font-medium hover:text-primary transition-colors truncate"
          >
            {entry.user_name}
          </Link>
          {entry.user_team_code && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              · {entry.user_team_code}
            </span>
          )}
          <Badge
            variant="outline"
            className={cn('h-4 text-[9px] uppercase tracking-wider px-1', status.cls)}
          >
            {status.label}
          </Badge>
          {entry.status === 'approved' && entry.reviewer_name && (
            <span className="text-[10px] text-muted-foreground">
              · {t('projectDetailPage.approvedBy', { name: entry.reviewer_name })}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/70 ml-auto">
            {timeAgo(entry.created_at)}
          </span>
        </div>
        <div className="text-sm text-foreground mt-0.5 truncate">
          {entry.task_name || t('projectDetailPage.unnamedTask')}
        </div>
        {(entry.block_name || entry.drawing_name) && (
          <div className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
            {entry.block_name && <span className="truncate">{entry.block_name}</span>}
            {entry.block_name && entry.drawing_name && (
              <ChevronRightIcon className="h-2.5 w-2.5 opacity-40 flex-shrink-0" />
            )}
            {entry.drawing_name && <span className="truncate">{entry.drawing_name}</span>}
          </div>
        )}
        {!isRest && (
          <div className="flex items-center gap-2 mt-1.5">
            <Progress
              value={entry.percentage}
              className="h-1.5 flex-1"
              indicatorClassName={progressColor(entry.percentage)}
            />
            <span className="text-xs font-semibold tabular-nums w-10 text-right">
              {entry.percentage.toFixed(0)}%
            </span>
          </div>
        )}
        {entry.notes && (
          <div className="text-[11px] text-muted-foreground italic mt-1 line-clamp-2">
            "{entry.notes}"
          </div>
        )}
      </div>
    </div>
  );
});

export default ActivityRow;
