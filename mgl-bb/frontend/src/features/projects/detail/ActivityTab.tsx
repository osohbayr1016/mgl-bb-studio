/* ---------- Project Activity tab ----------
 * Drop-in replacement for the old standalone Team tab. Tells two stories
 * on one screen:
 *   1. WHO is on the project (compact roster strip across the top, with
 *      admin-only add/remove controls baked in so the tab still doubles
 *      as the team-management surface).
 *   2. WHAT happened recently (feed of progress updates pulled from
 *      `/projects/:id/activity`, newest first, with status badges so
 *      pending vs approved vs rejected vs rest-day reads at a glance).
 *
 * NOTE: this tab is currently detached from the tabs row — `ProjectDetailPage`
 * keeps a `void ActivityTab` reference so the markup stays one paste away
 * when the data team revives it. Extracted verbatim from
 * `ProjectDetailPage.tsx` when that file was split into per-component
 * modules — no behavioural change.
 */
import { Link } from 'react-router-dom';
import { Activity, Loader2, Users, X } from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import type { User } from '@/shared/types';
import { Avatar, AvatarFallback } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';

import { ActivityFeed } from './ActivityFeed';
import { AddMembersDialog } from './AddMembersDialog';
import { EmptyState } from './atoms';
import type { ActivityEntry } from './types';

export function ActivityTab({
  projectId,
  members,
  currentUserId,
  isAdmin,
  onMembersChanged,
  onRemoveMember,
}: {
  projectId: number;
  members: User[];
  currentUserId: number | null;
  isAdmin: boolean;
  onMembersChanged: () => void;
  onRemoveMember: (userId: number) => void;
}) {
  const { t } = useLanguage();
  const activityQuery = useApiQuery<{ entries: ActivityEntry[] }>(
    ['/projects/activity', projectId],
    `/projects/${projectId}/activity?limit=60`,
  );
  const entries: ActivityEntry[] | null = activityQuery.data?.entries ?? null;
  const loading = activityQuery.isLoading;
  const error = activityQuery.error ? t('projectDetailPage.activityLoadFailed') : null;

  return (
    <div className="space-y-4">
      {/* ----- Roster strip ----- */}
      <Card className="border-border/60">
        <CardContent className="pt-4 pb-3 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">{t('projectDetailPage.teamMembers')}</h3>
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {members.length}
              </Badge>
            </div>
            {isAdmin && (
              <AddMembersDialog
                projectId={projectId}
                existingMemberIds={new Set(members.map((m) => m.id))}
                onAdded={onMembersChanged}
              />
            )}
          </div>
          {members.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              {t('projectDetailPage.noTeamMembers')}
              {isAdmin ? ` ${t('projectDetailPage.noTeamMembersAdmin')}` : ''}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {members.map((m) => (
                <Link
                  key={m.id}
                  to={m.id === currentUserId ? '/app/profile' : `/app/users/${m.id}`}
                  className="group flex items-center gap-2 rounded-full bg-muted/40 hover:bg-muted/70 transition-colors pl-1 pr-2 py-1 border border-transparent hover:border-border"
                  title={`${formatDisplayName(m.full_name)} · @${m.username}`}
                >
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                      {formatDisplayName(m.full_name)
                        .split(' ')
                        .map((p) => p[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs font-medium truncate max-w-[140px]">
                    {formatDisplayName(m.full_name)}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {m.role}
                  </span>
                  {isAdmin && (
                    <button
                      type="button"
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-muted-foreground hover:text-destructive ml-1"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveMember(m.id);
                      }}
                      title={t('projectDetailPage.remove')}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ----- Activity feed ----- */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              <CardTitle className="text-base">{t('projectDetailPage.recentActivity')}</CardTitle>
              {entries && (
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                  {entries.length}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              {t('projectDetailPage.activitySubtitle')}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('projectDetailPage.loadingDots')}
            </div>
          ) : error ? (
            <div className="text-sm text-destructive py-6 text-center">{error}</div>
          ) : !entries || entries.length === 0 ? (
            <EmptyState
              icon={<Activity className="w-10 h-10" />}
              title={t('projectDetailPage.noActivity')}
              description={t('projectDetailPage.noActivityDesc')}
            />
          ) : (
            <ActivityFeed entries={entries} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default ActivityTab;
