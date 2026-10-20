import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Skeleton } from '@/ui/skeleton';
import { Trophy, Users } from 'lucide-react';
import { apiFetch, MEDIA_BASE_URL } from '@/shared/api/client';
import { useIsAdminTier, formatPoints } from '@/shared/lib/score';
import {
  DEFAULT_COMPLEXITY_PCT,
  clampComplexityPct,
  complexityPctColor,
} from '@/shared/lib/complexity';
import { cn } from '@/shared/lib/utils';
import { formatDisplayName } from '@/shared/lib/formatting';
import { useLanguage } from '@/shared/i18n';
import type { ProjectLeaderboardAdmin, ProjectLeaderboardWorker } from '@/shared/types';

/**
 * "Хувь нэмэр" — per-project contributors leaderboard.
 *
 * After 0045_project_complexity money is gone; performance is recorded
 * purely as percentage points scaled by the project's complexity tier.
 *
 *   Admin tier → full ranked list with each contributor's percent points.
 *   Worker tier → ONLY the caller's own one-line contribution + their
 *                 rank among the project's contributors (e.g. "5 / 8").
 *   Client tier → component returns null (the surrounding page already
 *                 hides this for clients via tabs).
 */
export default function ProjectContributorsCard({
  projectId,
  className,
}: {
  projectId: number;
  /** Optional outer class — used by `ProjectDetailPage` to make the card
   *  match the adjacent map's height in the side-by-side grid layout. */
  className?: string;
}) {
  const { t } = useLanguage();
  const isAdmin = useIsAdminTier();
  const [admin, setAdmin] = useState<ProjectLeaderboardAdmin | null>(null);
  const [worker, setWorker] = useState<ProjectLeaderboardWorker | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<ProjectLeaderboardAdmin | ProjectLeaderboardWorker>(
      `/leaderboard/project/${projectId}`,
    )
      .then((r) => {
        if (!alive) return;
        if ('contributors' in r) setAdmin(r);
        else setWorker(r);
      })
      .catch((e) => {
        if (e?.status === 403) return;
        if (alive) setError(e?.message ?? t('common.error'));
      });
    return () => {
      alive = false;
    };
  }, [projectId, t]);

  if (error) {
    return (
      <Card className={className}>
        <CardContent className="p-4 text-xs text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (isAdmin) {
    if (!admin) {
      return (
        <Card className={className}>
          <CardContent className="p-4">
            <Skeleton className="h-20 bg-muted/40" />
          </CardContent>
        </Card>
      );
    }
    const pct = clampComplexityPct(admin.project_complexity_pct ?? DEFAULT_COMPLEXITY_PCT);
    // Эзлэх хувь = хүний хувь ÷ бүх хувь нэмрийн нийлбэр (≈ төслийн нийт явц).
    const total = admin.project_total_pct || 0;
    const share = (v: number) => (total > 0 ? Math.min(100, (v / total) * 100) : 0);
    return (
      <Card className={cn('flex flex-col overflow-hidden', className)}>
        <CardHeader className="pb-3 flex-shrink-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            {t('projectContributorsCard.title')}
          </CardTitle>
          <CardDescription className="text-xs flex items-center gap-2">
            {t('projectContributorsCard.subtitle')}
            <Badge variant="outline" className="text-[10px] py-0 tabular-nums">
              {t('projectContributorsCard.totalDone', {
                pct: (admin.project_total_pct ?? 0).toFixed(1),
              })}
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] py-0 tabular-nums ${complexityPctColor(pct)}`}
            >
              {t('projectContributorsCard.weight', { pct })}
            </Badge>
          </CardDescription>
        </CardHeader>
        {/* Нэг мөр = нэг хүн (~34px).  Хүн олон байдаг (20+) тул картыг
            тогтмол өндөрт барьж дотроо гүйлгэнэ — эс бөгөөс ХУУДАС өөрөө
            уртсаж, графикаас доош 1700px гүйлгэх шаардлагатай болно. */}
        <CardContent className="max-h-[22rem] min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-0">
          {admin.contributors.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t('projectContributorsCard.empty')}
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {admin.contributors.map((c, i) => (
                <li key={c.user_id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                    {i + 1}
                  </span>
                  <Link
                    to={`/app/users/${c.user_id}`}
                    className="flex min-w-0 flex-1 items-center gap-2 hover:opacity-90"
                  >
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarImage
                        src={c.profile_image ? `${MEDIA_BASE_URL}${c.profile_image}` : undefined}
                      />
                      <AvatarFallback className="text-[10px]">
                        {formatDisplayName(c.full_name).slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate text-sm font-medium">
                      {formatDisplayName(c.full_name)}
                    </span>
                    {/* Роль/удаа — нарийн дэлгэцэд нэрэнд зай тавьж хаагдана. */}
                    <span className="hidden shrink-0 text-[11px] text-muted-foreground lg:inline">
                      {c.role} · {t('projectContributorsCard.awardCount', { count: c.award_count })}
                    </span>
                  </Link>
                  <div
                    className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted sm:w-24"
                    title={t('projectContributorsCard.shareOfTotal', {
                      pct: share(c.project_pct).toFixed(0),
                    })}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${share(c.project_pct)}%` }}
                    />
                  </div>
                  {/* Үндсэн тоо = ТӨСЛИЙН ХЭДЭН ХУВЬ.  Оноог хассан: жин 100%
                      төсөл дээр оноо ≈ хувь болж, давхардсан тоо мэт харагддаг. */}
                  <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {c.project_pct.toFixed(2)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  if (!worker) {
    return (
      <Card className={className}>
        <CardContent className="p-4">
          <Skeleton className="h-20 bg-muted/40" />
        </CardContent>
      </Card>
    );
  }

  const me = worker.me;
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="pb-3 flex-shrink-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          {t('projectContributorsCard.myTitle')}
        </CardTitle>
        <CardDescription className="text-xs">{t('projectContributorsCard.mySubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 flex-1 min-h-0 overflow-y-auto">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('projectContributorsCard.myPct')}
            </div>
            <div className="text-2xl font-bold tabular-nums mt-1">
              {me.project_pct.toFixed(2)}%
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
              {t('projectContributorsCard.ofTotal', {
                total: (worker.project_total_pct ?? 0).toFixed(1),
              })}
              {' · '}
              {formatPoints(me.total_points)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('projectContributorsCard.rank')}
            </div>
            <div className="text-2xl font-bold tabular-nums mt-1">
              {me.rank !== null ? (
                <>
                  #{me.rank}{' '}
                  <span className="text-sm text-muted-foreground font-normal">
                    / {me.total_contributors}
                  </span>
                </>
              ) : (
                '—'
              )}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {t('projectContributorsCard.times')}
            </div>
            <div className="text-2xl font-bold tabular-nums mt-1 flex items-center gap-1">
              {me.award_count}
              <Users className="w-4 h-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border/40">
          {t('projectContributorsCard.privacy')}
        </p>
      </CardContent>
    </Card>
  );
}
