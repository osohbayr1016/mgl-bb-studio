import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CalendarRange, Clock, Gauge, Hammer, TrendingUp, Zap } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { EmployeeMetrics } from '../types';
import { fmtHours, fmtPts } from '../lib/format';
import { LeaveAdjustedMark } from '@/shared/components/LeaveAdjustedMark';

/**
 * Дэлгэрэнгүй KPI — ХОЁР бүлэг (эзний хүсэлт 2026-09-28):
 *   • Бүтээмж — өдрийн дундаж (сүүлийн 30 өдөр) · нийт хувь · ажилласан цаг
 *   • Засвар  — засварын хувь · засварын цаг + нийт хувьд эзлэх хэсэг
 * Хоцролт, чөлөө энд БАЙХГҮЙ — зөвхөн доорх Ирц картад.  Өмнөх үеийн
 * харьцуулалт, хөндсөн/дуусгасан таск, явцын бичлэг, ирсэн өдөр ч энд байхгүй.
 * Өдрийн дундаж нь толгойн цонхыг ДАГАХГҮЙ (үргэлж сүүлийн 30 өдөр) тул тэр
 * хавтан өөрийн хугацааны тэмдэгтэй, бусад нь бүлгийн толгойн хугацаатай.
 */
export function KpiTiles({
  metrics,
  period,
  className,
}: {
  metrics: EmployeeMetrics;
  period: { from: string; to: string };
  className?: string;
}) {
  const { t } = useLanguage();
  const range = period.from === period.to ? period.from : t('reportsPage.periodRange', { from: period.from, to: period.to });
  const hasRepair = metrics.repair_points > 0 || metrics.repair_hours > 0 || metrics.repair_entries > 0;
  // Засвар нь нийт хувьд ОРСОН (repairPointsHint) — тиймээс эзлэх хэсэг 0–100.
  const repairShare =
    metrics.points > 0 ? Math.min(100, Math.max(0, (metrics.repair_points / metrics.points) * 100)) : null;
  const repairShareLabel =
    repairShare == null ? null : repairShare > 0 && repairShare < 1 ? '<1%' : `${Math.round(repairShare)}%`;

  return (
    <div className={cn('grid gap-3 lg:grid-cols-3', className)}>
      {/* ── Бүтээмж ── */}
      <section className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
        <GroupHead
          icon={TrendingUp}
          title={t('reportsPage.groupProductivity')}
          aside={
            <span className="inline-flex items-center gap-1 tabular-nums">
              <CalendarRange className="h-3.5 w-3.5" aria-hidden />
              {range}
            </span>
          }
        />
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Metric
            hero
            className="col-span-2 sm:col-span-1"
            icon={Gauge}
            label={t('reportsPage.kpiDailyAvg')}
            chip={t('reportsPage.kpiDailyAvgHint')}
            value={fmtPts(metrics.daily_avg_30d)}
            desc={t('reportsPage.kpiDailyAvgDesc')}
          />
          <Metric
            icon={Zap}
            label={t('reportsPage.kpiTotalPct')}
            value={fmtPts(metrics.points)}
            extra={<LeaveAdjustedMark days={metrics.leave_days} actual={fmtPts(metrics.points_actual)} />}
            desc={t('reportsPage.kpiTotalPctDesc')}
          />
          <Metric
            icon={Clock}
            label={t('reportsPage.kpiHours')}
            value={fmtHours(metrics.hours_worked)}
            desc={t('reportsPage.kpiHoursDesc')}
          />
        </div>
      </section>

      {/* ── Засвар ── */}
      <section className="flex flex-col rounded-xl border border-border bg-card p-4">
        <GroupHead
          icon={Hammer}
          title={t('reportsPage.groupRepair')}
          hint={t('reportsPage.repairPointsHint', { n: metrics.repair_entries })}
          aside={metrics.repair_entries > 0 ? t('reportsPage.repairEntries', { n: metrics.repair_entries }) : null}
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric
            icon={Zap}
            label={t('reportsPage.kpiRepairPoints')}
            value={fmtPts(metrics.repair_points)}
            muted={!hasRepair}
          />
          <Metric icon={Clock} label={t('reportsPage.kpiRepair')} value={fmtHours(metrics.repair_hours)} muted={!hasRepair} />
        </div>
        <div className="mt-auto pt-3">
          {!hasRepair ? (
            <p className="text-xs text-muted-foreground">{t('reportsPage.repairNone')}</p>
          ) : repairShare != null && repairShareLabel ? (
            <div>
              <div className="flex items-center justify-between gap-2 text-micro text-muted-foreground">
                <span>{t('reportsPage.repairShareOfTotal')}</span>
                <span className="font-medium tabular-nums text-foreground">{repairShareLabel}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${repairShare > 0 ? Math.max(2, repairShare) : 0}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function GroupHead({
  icon: Icon,
  title,
  hint,
  aside,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h3 className="flex items-center gap-2 text-sm font-semibold" title={hint}>
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        {title}
      </h3>
      {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  extra,
  desc,
  chip,
  hero,
  muted,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  extra?: ReactNode;
  desc?: string;
  chip?: string;
  hero?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('rounded-lg p-3', hero ? 'bg-primary/5 ring-1 ring-inset ring-primary/20' : 'bg-muted/40', className)}>
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
        <span className="flex items-baseline">
          <span
            className={cn(
              'font-semibold tabular-nums leading-none',
              hero ? 'text-3xl text-primary' : 'text-metric',
              muted && 'text-muted-foreground',
            )}
          >
            {value}
          </span>
          {extra}
        </span>
        {/* Бүлгийн хугацаанаас ӨӨР хугацаатай хавтан (өдрийн дундаж = сүүлийн 30 өдөр). */}
        {chip && (
          <span className="whitespace-nowrap rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">
            {chip}
          </span>
        )}
      </div>
      {desc && <p className="mt-1.5 text-micro text-muted-foreground">{desc}</p>}
    </div>
  );
}
