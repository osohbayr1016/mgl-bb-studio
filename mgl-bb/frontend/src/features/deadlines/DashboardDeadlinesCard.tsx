/**
 * Dashboard-ийн «Ойрын хугацаанууд» карт — шаардлага #5.
 *
 * `/api/deadlines/upcoming` нь ГУРВАН эх сурвалжийг нэгтгэж өгнө:
 * төслийн эцсийн хугацаа, таскийн огноо, дэд шалгах цэг.  Мөр бүр аль
 * төслийнх нь харагдана (`showProject`) — Dashboard дээр төсөл холилдоно.
 *
 * ⚠️ Хугацаа ХЭТЭРСЭН мөр нь харах цонхноос (30 хоног) ҮЛ ХАМААРЧ ордог
 *    (сервер тал зөвхөн дээд хязгаар тавьдаг, доод хязгаар байхгүй) —
 *    хамгийн чухал мөр цонхны гадна үлдэх нь энэ картын гол утгыг алдагдуулна.
 *
 * Хамрах хүрээ: admin/senior нь «Бүгд ↔ Минийх» гэж сэлгэж болно;
 * бусад дүр зөвхөн өөрийнхөө мөрийг харна (`scope=all` нь сервер тал 403).
 */
import { useState } from 'react';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useAuth } from '@/shared/context/AuthContext';
import { CardContent, CardHeader, CardTitle } from '@/ui/card';
import { AppleCard } from '@/ui/apple-card';
import { Badge } from '@/ui/badge';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { ATTENTION_STATES } from '@/features/timeline/lib/riskDisplay';

import { DeadlineList } from './DeadlineList';
import { useUpcomingDeadlines } from './api';

const WINDOW_DAYS = 30;
const MAX_ROWS = 8;

export function DashboardDeadlinesCard({ className }: { className?: string } = {}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const canSeeAll = user?.role === 'admin' || user?.role === 'senior';
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const effectiveScope = canSeeAll ? scope : 'mine';

  const { data, isLoading } = useUpcomingDeadlines(effectiveScope, WINDOW_DAYS);
  const items = data?.items ?? [];
  const attention = items.filter((i) => ATTENTION_STATES.includes(i.risk_state)).length;

  return (
    <AppleCard className={cn('h-full', className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-brand-copper" />
          {t('deadlines.upcomingTitle')}
          {attention > 0 && (
            <Badge
              variant="outline"
              className="border-warning/40 bg-warning/10 text-[10px] text-warning"
            >
              {t('deadlines.attentionCount', { count: attention })}
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {/* Хамрах хүрээний сэлгүүр — зөвхөн admin/senior.  Бусад дүрд
              харагдахгүй, учир нь `scope=all` тэдэнд 403 буцаана. */}
          {canSeeAll && (
            <div className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5">
              {(['mine', 'all'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={scope === s}
                  onClick={() => setScope(s)}
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                    scope === s
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  {t(s === 'mine' ? 'deadlines.scopeMine' : 'deadlines.scopeAll')}
                </button>
              ))}
            </div>
          )}
          <Link
            to="/app/my-tasks"
            className="flex items-center gap-1 text-xs text-brand-copper hover:underline"
          >
            {t('dashboardPage.allLink')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <DeadlineList
          items={items}
          loading={isLoading}
          showProject
          limit={MAX_ROWS}
          emptyLabel={t('deadlines.emptyUpcoming', { days: WINDOW_DAYS })}
        />
      </CardContent>
    </AppleCard>
  );
}

export default DashboardDeadlinesCard;
