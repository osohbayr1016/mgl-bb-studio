import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/ui/card';
import { Trophy, TrendingUp, Calendar } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import { formatPoints } from '@/shared/lib/score';
import {
  DEFAULT_COMPLEXITY_PCT,
  clampComplexityPct,
  complexityPctColor,
} from '@/shared/lib/complexity';
import type { MyLeaderboardStats } from '@/shared/types';
import { Badge } from '@/ui/badge';
import { formatDate } from '@/shared/lib/time';

/**
 * "Миний хувь" tab body for ProfilePage.
 *
 * Shows the caller's leaderboard summary + recent awards as percentage
 * points (no money — pricing was removed in 0045_project_complexity).
 */
export default function MyScoreSection() {
  const { t } = useLanguage();
  const query = useApiQuery<MyLeaderboardStats>('/leaderboard/me');
  const stats = query.data ?? null;
  const error = query.error?.message ?? null;

  if (error) {
    return (
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (!stats) {
    return (
      <Card className="border-border bg-card/60 backdrop-blur">
        <CardContent className="p-6">
          <div className="h-32 rounded-md bg-muted/40 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
        <CardContent className="p-6 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              {t('myScoreSection.last30Days')}
            </div>
            <div className="text-3xl font-bold tabular-nums mt-1">
              {formatPoints(stats.total_points)}
            </div>
            {stats.leave_days > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                {t('leaveAdjusted.profileNote', { count: stats.leave_days })}
              </div>
            )}
          </div>
          {/* Чансаа (rank)-ийг профайлаас нуусан — leaderboard хуудсанд хэвээр. */}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              {t('myScoreSection.times')}
            </div>
            <div className="text-3xl font-bold tabular-nums mt-1">{stats.award_count}</div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
              <TrendingUp className="w-3 h-3" /> {t('myScoreSection.earned')}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card/60 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="w-4 h-4 text-warning" />
            {t('myScoreSection.recentEarned')}
          </CardTitle>
          <CardDescription>{t('myScoreSection.recentEarnedDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {stats.recent.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {t('myScoreSection.empty')}
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {stats.recent.map((r) => {
                const pct = clampComplexityPct(r.project_complexity_pct ?? DEFAULT_COMPLEXITY_PCT);
                return (
                  <li key={r.id} className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {r.task_name ?? t('myScoreSection.taskFallback')}
                      </div>
                      <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5">
                        <Calendar className="w-3 h-3" />
                        {formatDate(new Date(r.awarded_at))}
                        {r.project_name && <span>· {r.project_name}</span>}
                        <span>· Δ{r.delta_pct < 0 ? '−' : ''}{Math.abs(r.delta_pct).toFixed(2)}%</span>
                        <Badge
                          variant="outline"
                          className={`text-micro py-0 tabular-nums ${complexityPctColor(pct)}`}
                        >
                          {pct}%
                        </Badge>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {/* Өөрийн бүртгэлийг хүчингүй болгосон буцаалт (2026-10-02) — СӨРӨГ мөр: «+-0.35%» биш «−0.35%». */}
                      <div
                        className={`font-bold tabular-nums text-sm ${r.points < 0 ? 'text-destructive' : ''}`}
                        data-testid={r.points < 0 ? 'score-reversal' : undefined}
                      >
                        {r.points < 0 ? '−' : '+'}
                        {formatPoints(Math.abs(r.points))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
