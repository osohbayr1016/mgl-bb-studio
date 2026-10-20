import { TrendingUp, TrendingDown, Minus, ArrowUp, ArrowDown } from 'lucide-react';
import { Badge } from '@/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import type { TrendResult } from '../types';
import { TREND_LABEL_KEY } from '../lib/windows';
import { fmtPts, fmtSigned } from '../lib/format';

/* ------------------------------------------------------------------ */
/*  Байр: «#3 / 47» + ▲2 / ▼1 / —                                     */
/* ------------------------------------------------------------------ */

export function RankBadge({
  rank,
  pool,
  delta,
  source,
  size = 'sm',
  className,
}: {
  rank: number | null;
  pool: number | null;
  delta: number | null;
  source?: 'snapshot' | 'live' | null;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  const { t } = useLanguage();
  if (rank == null) {
    return (
      <span className={cn('text-xs text-muted-foreground', className)} title={t('reportsPage.notMember')}>
        —
      </span>
    );
  }
  const tone =
    rank === 1 ? 'bg-amber-400/20 text-amber-700 dark:text-amber-300' : rank <= 3 ? 'bg-primary/15 text-primary' : 'bg-muted text-foreground';
  const deltaEl =
    delta == null ? null : delta > 0 ? (
      <span className="inline-flex items-center text-success">
        <ArrowUp className="h-3 w-3" />
        {delta}
      </span>
    ) : delta < 0 ? (
      <span className="inline-flex items-center text-danger">
        <ArrowDown className="h-3 w-3" />
        {Math.abs(delta)}
      </span>
    ) : (
      <span className="inline-flex items-center text-muted-foreground">
        <Minus className="h-3 w-3" />
      </span>
    );
  const hint =
    delta == null
      ? t('reportsPage.rank7dHint')
      : `${delta > 0 ? t('reportsPage.rankUp', { n: delta }) : delta < 0 ? t('reportsPage.rankDown', { n: Math.abs(delta) }) : t('reportsPage.rankSame')} · ${t('reportsPage.rank7dHint')}${source === 'live' ? ` (${t('reportsPage.rankLiveHint')})` : ''}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('inline-flex items-center gap-1.5', className)}>
          <span
            className={cn(
              'inline-flex items-center justify-center rounded-full font-semibold tabular-nums',
              size === 'lg' ? 'h-9 min-w-9 px-2.5 text-base' : 'h-6 min-w-6 px-1.5 text-xs',
              tone,
            )}
          >
            #{rank}
          </span>
          <span className={cn('tabular-nums text-muted-foreground', size === 'lg' ? 'text-sm' : 'text-[11px]')}>
            / {pool ?? '?'}
          </span>
          {deltaEl && <span className={cn('tabular-nums font-medium', size === 'lg' ? 'text-sm' : 'text-[11px]')}>{deltaEl}</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/*  Хандлага: Өсч байна / Буурч байна / Тогтвортой                     */
/* ------------------------------------------------------------------ */

export function TrendChip({ trend, className, showPct = true }: { trend: TrendResult; className?: string; showPct?: boolean }) {
  const { t } = useLanguage();
  const Icon = trend.code === 'up' ? TrendingUp : trend.code === 'down' ? TrendingDown : Minus;
  const tone =
    trend.code === 'up'
      ? 'border-success/40 bg-success/10 text-success'
      : trend.code === 'down'
        ? 'border-danger/40 bg-danger/10 text-danger'
        : 'border-border bg-muted text-muted-foreground';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn('gap-1 whitespace-nowrap font-medium', tone, className)}>
          <Icon className="h-3 w-3" />
          {t(TREND_LABEL_KEY[trend.code])}
          {showPct && (trend.last7 > 0 || trend.prior7 > 0) && (
            <span className="tabular-nums opacity-80">{fmtSigned(trend.last7 - trend.prior7, '%')}</span>
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {t('reportsPage.trendHint')} — {t('reportsPage.trendVs', { last: fmtPts(trend.last7), prior: fmtPts(trend.prior7) })}
      </TooltipContent>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */
/*  Sparkline — өдөр бүр нэг цэгтэй SVG (урт нь сонгосон цонхыг дагана)  */
/* ------------------------------------------------------------------ */

export function Sparkline({
  values,
  width = 96,
  height = 24,
  className,
  stroke,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  stroke?: string;
}) {
  const n = values.length;
  if (n === 0) return null;
  const max = Math.max(...values, 0.0001);
  const pad = 2;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1);
    const y = height - pad - (v / max) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const first = values[0] ?? 0;
  const last = values[n - 1] ?? 0;
  const color = stroke ?? (last > first ? 'var(--color-success)' : last < first ? 'var(--color-danger)' : 'var(--color-primary)');
  const area = `${pad},${height - pad} ${pts.join(' ')} ${(pad + (width - pad * 2)).toFixed(1)},${height - pad}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('shrink-0', className)} aria-hidden>
      <polygon points={area} fill={color} opacity={0.12} />
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
