import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Check, HardHat, Minus, ShieldCheck, Wrench } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { PeriodKind, ProductivityGap, ProductivityMember } from './types';
import { fmtAvg, fmtPct, trendOf } from './lib';

const GRID =
  'lg:grid-cols-[2rem_minmax(0,1.5fr)_minmax(0,1.5fr)_4.5rem_6rem_6.5rem_6.5rem_4rem_3rem_4.5rem]';

/**
 * Гишүүдийн өдрийн дундаж бүтээмж — дээрээс доош.  Тууз нь дээд хүнтэй
 * харьцуулсан урт, босоо зураас = «шугам» (дээд хүний 80%).  Шугамаас доош
 * хүн бүрд «өдөрт +X% нэмэх хэрэгтэй» — захирал тухайн хүнтэй тулж ажиллах
 * тоо (эзний хүсэлт).  Мөр дарахад хүний профайл.
 */
export function MemberRanking({
  members,
  gap,
  kind,
}: {
  members: ProductivityMember[];
  gap: ProductivityGap;
  kind: PeriodKind;
}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const linePct = 100 - gap.threshold_pct;
  const compared = gap.compared >= 2;

  return (
    <section id="sec-team-members-productivity" className="scroll-mt-24 rounded-xl border border-border/60 bg-card">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/50 px-4 py-3">
        <h3 className="text-sm font-semibold">{t('teamProductivity.membersTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('teamProductivity.membersHint')}</p>
      </header>

      <div
        className={cn(
          'hidden gap-2 border-b border-border/40 px-4 py-2 text-label text-muted-foreground lg:grid',
          GRID,
        )}
      >
        <span>#</span>
        <span>{t('teamProductivity.colMember')}</span>
        <span>{t('teamProductivity.colAvg')}</span>
        <span className="text-right">{t('teamProductivity.colPctOfTop')}</span>
        <span className="text-right">{t(`teamProductivity.colPrev_${kind}`)}</span>
        <span className="text-right">{t('teamProductivity.colNeed')}</span>
        <span className="text-right">{t('teamProductivity.colDays')}</span>
        <span className="text-right">{t('teamProductivity.colProjects')}</span>
        <span className="text-right">{t('teamProductivity.colAsr')}</span>
        <span className="text-right">{t('teamProductivity.colTrend')}</span>
      </div>

      <ul className="divide-y divide-border/40" data-testid="tp-members">
        {members.map((m) => {
          const name = formatDisplayName(m.full_name);
          const trend = trendOf(m.avg, m.prev_avg);
          const barPct = m.pct_of_top == null ? 0 : Math.min(100, Math.max(0, m.pct_of_top));
          const isTop = m.user_id === gap.top_user_id;
          const isBottom = m.user_id === gap.bottom_user_id;
          return (
            <li key={m.user_id} data-testid="tp-member-row" data-user-id={m.user_id} data-below={m.below_line ? '1' : '0'}>
              {/* Мөр бүхэлдээ хүний профайл руу холбоос (Ctrl+дарж шинэ таб нээж болно). */}
              <Link
                to={m.user_id === user?.id ? '/app/profile' : `/app/users/${m.user_id}`}
                className={cn(
                  'grid w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-muted/40',
                  GRID,
                  m.below_line && 'bg-danger/[0.03]',
                )}
              >
                <span
                  className={cn(
                    'text-sm font-bold tabular-nums',
                    isTop ? 'text-success' : isBottom && compared ? 'text-danger' : 'text-muted-foreground',
                  )}
                >
                  {m.rank ?? '–'}
                </span>

                <span className="flex min-w-0 items-center gap-2">
                  <Avatar className="h-7 w-7 shrink-0">
                    {m.profile_image && <AvatarImage src={`${MEDIA_BASE_URL}${m.profile_image}`} alt={name} />}
                    <AvatarFallback className="bg-primary/15 text-label text-primary">
                      {name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-sm font-medium">{name}</span>
                      {m.is_lead && (
                        <span className="shrink-0 rounded border border-success/40 bg-success/10 px-1 text-label text-success">
                          {t('teamProductivity.leadBadge')}
                        </span>
                      )}
                      {m.role === 'senior' && !m.is_lead && <ShieldCheck className="h-3 w-3 shrink-0 text-warning" />}
                    </span>
                    <span className="block truncate text-label font-normal normal-case tracking-normal text-muted-foreground">{m.position || m.role}</span>
                  </span>
                </span>

                {/* Өдрийн дундаж + тууз (гар утсан дээр нэрийн доор бүтэн мөр). */}
                <span className="col-span-2 min-w-0 lg:col-span-1">
                  {m.avg == null ? (
                    <span className="text-xs italic text-muted-foreground">
                      {m.leave_days > 0
                        ? t('teamProductivity.onLeaveAll', { n: m.leave_days })
                        : t('teamProductivity.noWorkDays')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'w-16 shrink-0 text-sm font-semibold tabular-nums',
                          m.below_line ? 'text-danger' : 'text-foreground',
                        )}
                        data-testid="tp-member-avg"
                      >
                        {fmtAvg(m.avg)}
                      </span>
                      <span className="relative h-2 min-w-0 flex-1 rounded-full bg-muted" aria-hidden>
                        <span
                          className={cn(
                            'absolute inset-y-0 left-0 rounded-full',
                            m.below_line ? 'bg-danger/70' : isTop ? 'bg-success' : 'bg-primary/70',
                          )}
                          style={{ width: `${barPct}%` }}
                        />
                        {compared && (
                          <span className="absolute inset-y-[-3px] w-px bg-foreground/60" style={{ left: `${linePct}%` }} />
                        )}
                      </span>
                    </span>
                  )}
                  {/* Гар утсанд — дэлгэрэнгүй багануудын оронд нэг мөр. */}
                  <span className="mt-1 block text-label font-normal normal-case tracking-normal text-muted-foreground lg:hidden">
                    {m.pct_of_top != null && t('teamProductivity.pctOfTopShort', { v: fmtPct(m.pct_of_top) })}
                    {m.below_line && m.need_per_day != null && (
                      <span className="text-danger"> · {t('teamProductivity.needShort', { v: fmtAvg(m.need_per_day) })}</span>
                    )}
                    {' · '}
                    {t('teamProductivity.daysShort', { logged: m.logged_days, work: m.work_days })}
                  </span>
                </span>

                <span className="hidden text-right text-xs tabular-nums lg:block">{fmtPct(m.pct_of_top)}</span>

                <span className="hidden items-center justify-end gap-1 text-xs tabular-nums lg:flex">
                  {trend === 'up' && <ArrowUpRight className="h-3.5 w-3.5 text-success" />}
                  {trend === 'down' && <ArrowDownRight className="h-3.5 w-3.5 text-danger" />}
                  {trend === 'flat' && <Minus className="h-3.5 w-3.5 text-muted-foreground" />}
                  {fmtAvg(m.prev_avg)}
                </span>

                <span className="hidden text-right text-xs tabular-nums lg:block" data-testid="tp-member-need">
                  {m.avg == null || !compared ? (
                    '—'
                  ) : m.below_line ? (
                    <span className="font-medium text-danger">+{fmtAvg(m.need_per_day)}</span>
                  ) : (
                    <Check className="ml-auto h-3.5 w-3.5 text-success" />
                  )}
                </span>

                <span
                  className="hidden text-right text-xs tabular-nums lg:block"
                  title={t('teamProductivity.daysTitle', {
                    logged: m.logged_days,
                    present: m.present_days,
                    work: m.work_days,
                    leave: m.leave_days,
                  })}
                >
                  {m.logged_days}/{m.work_days}
                  {m.leave_days > 0 && (
                    <span className="text-muted-foreground"> {t('teamProductivity.leaveShort', { n: m.leave_days })}</span>
                  )}
                </span>

                <span className="hidden items-center justify-end gap-1 text-xs tabular-nums lg:flex">
                  {m.project_count}
                  {m.repair_count > 0 && (
                    <span className="inline-flex items-center text-warning" title={t('teamProductivity.repairTitle')}>
                      +{m.repair_count}
                      <Wrench className="h-3 w-3" />
                    </span>
                  )}
                </span>

                <span className="hidden items-center justify-end gap-0.5 text-xs tabular-nums lg:flex">
                  {m.asr_count > 0 ? (
                    <>
                      {m.asr_count}
                      <HardHat className="h-3 w-3 text-warning" />
                    </>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </span>

                <span className="hidden justify-end lg:flex">
                  <MiniTrend values={m.series} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Сүүлийн хугацаануудын өдрийн дундаж — null (чөлөө/амралт) цэггүй, үлдсэнийг холбоно. */
function MiniTrend({ values, width = 64, height = 20 }: { values: (number | null)[]; width?: number; height?: number }) {
  const pts = values
    .map((v, i) => (v == null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p != null);
  if (pts.length < 2) return <span className="text-label font-normal normal-case tracking-normal text-muted-foreground">—</span>;
  const max = Math.max(...pts.map((p) => p.v), 0.0001);
  const pad = 2;
  const n = values.length;
  const xy = pts.map(({ i, v }) => {
    const x = pad + (i * (width - pad * 2)) / Math.max(1, n - 1);
    const y = height - pad - (v / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const first = pts[0]!.v;
  const last = pts[pts.length - 1]!.v;
  const color = last > first ? 'var(--color-success)' : last < first ? 'var(--color-danger)' : 'var(--color-primary)';
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <polyline points={xy.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
