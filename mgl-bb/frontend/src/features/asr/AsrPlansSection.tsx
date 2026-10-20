import { CalendarPlus, Clock, Loader2, MapPin, Users } from 'lucide-react';
import { ErrorState } from '@/shared/components/ErrorState';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { asrProjectName } from '@/features/projects/asr/asrProjectName';
import { useAsrVisitPlans } from '@/features/projects/asr/api';
import type { AsrVisitPlan } from '@/features/projects/asr/types';

/**
 * «Хяналтын хуваарь» — ирэх очилтуудын жагсаалт (миграц 0331).
 *
 * `/app/asr`-ийн төслийн жагсаалтын ДЭЭР (бүх төсөл) ба төслийн
 * workspace-д (тухайн төсөл) хоёуланд нь суудаг тул нэг компонент.
 * Өнгөрсөн хуваарь энд гарахгүй (сервер `from` = өнөөдөр): энэ бол
 * «хэн хэзээ хаашаа явах вэ» гэсэн самбар, түүх нь тайлан өөрөө.
 */
export function AsrPlansSection({
  projectId,
  onOpen,
  onNew,
  className,
}: {
  /** Өгвөл зөвхөн энэ төслийн хуваарь; үгүй бол бүх төслийнх. */
  projectId?: number;
  onOpen: (plan: AsrVisitPlan) => void;
  onNew: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const { data, isLoading, isError, error, refetch } = useAsrVisitPlans(projectId);
  const plans = data?.plans ?? [];
  const canManage = data?.can_manage ?? false;

  return (
    <section
      id="sec-asr-plans"
      className={cn('scroll-mt-24 rounded-lg border bg-card', className)}
      aria-labelledby="asr-plans-heading"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="asr-plans-heading" className="text-sm font-semibold">
            {t('asr.plans.title')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('asr.plans.hint')}</p>
        </div>
        {canManage && (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onNew}>
            <CalendarPlus className="h-4 w-4" />
            {t('asr.plans.add')}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="p-4">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      ) : plans.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          {projectId ? t('asr.plans.emptyProject') : t('asr.plans.empty')}
        </p>
      ) : (
        <ul className="divide-y">
          {plans.map((p) => (
            <li key={p.id}>
              <PlanRow
                plan={p}
                today={data?.today ?? ''}
                showProject={!projectId}
                onClick={() => onOpen(p)}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** «9-р сар · 25 · Ба» гэсэн огнооны хайрцаг. */
function DateBox({ date, today }: { date: string; today: string }) {
  const { t } = useLanguage();
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Гараг, сарын нэрийг ТОЛЬ БИЧГЭЭС авна (`companyTvPage.weekdayInitials`-ийн
  // ижил таслалтай загвар): Chrome-ийн `mn-MN` locale нь олон машинд
  // суугаагүй тул `Intl` нь чимээгүй англи руу унадаг (хэмжсэн), мөн хэл
  // солиход хоёр хэл ижил замаар ирнэ — кодонд хатуу бичсэн монгол үлдэхгүй.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const weekday = t('asr.plans.weekdayInitials').split(',')[dow] ?? '';
  const month = t('asr.plans.monthNames').split(',')[m - 1] ?? String(m);
  const rel =
    date === today
      ? t('asr.plans.today')
      : date === addDays(today, 1)
        ? t('asr.plans.tomorrow')
        : null;
  return (
    <div
      className={cn(
        'flex w-14 shrink-0 flex-col items-center rounded-md border px-1 py-1.5 text-center',
        rel ? 'border-primary/40 bg-primary/5' : 'bg-muted/40',
      )}
    >
      <span className="text-[10px] uppercase leading-none text-muted-foreground">{month}</span>
      <span className="text-xl font-semibold leading-tight tabular-nums">{d}</span>
      <span className="text-[10px] leading-none text-muted-foreground">{rel ?? weekday}</span>
    </div>
  );
}

function addDays(ymd: string, n: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function PlanRow({
  plan,
  today,
  showProject,
  onClick,
}: {
  plan: AsrVisitPlan;
  today: string;
  showProject: boolean;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/30"
    >
      <DateBox date={plan.visit_date} today={today} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {plan.visit_time && (
            <span className="inline-flex items-center gap-1 text-sm font-medium tabular-nums">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              {plan.visit_time}
            </span>
          )}
          {showProject && <span className="truncate text-sm font-medium">{asrProjectName(plan.project_name)}</span>}
          {plan.project_shifr && (
            <span className="font-mono text-xs text-muted-foreground">{plan.project_shifr}</span>
          )}
        </div>
        {plan.project_location && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{plan.project_location}</span>
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <Users
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-label={t('asr.plans.members')}
          />
          {plan.members.map((m) => (
            <Badge
              key={m.user_id}
              variant="outline"
              className={cn('gap-1 text-xs font-normal', teamChipClass(m.team_code))}
            >
              {formatDisplayName(m.full_name) || `#${m.user_id}`}
            </Badge>
          ))}
        </div>
        {plan.note && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{plan.note}</p>
        )}
      </div>
    </button>
  );
}
