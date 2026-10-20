/* ==========================================================================
   SectionHeader — label + live weight meter + equal-split + add button
   WeightMeter  — live "Нийт X% / 100%" badge with traffic-light states
   ==========================================================================

   Moved verbatim out of `AdminProjectSetupPage.tsx` when that ~5 700-line
   module was split up — no behavioural change. The two live together
   because `SectionHeader` is the meter's only caller.
*/
import { AlertCircle, CheckCircle2, Scale } from 'lucide-react';

import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';

import { weightStatus } from './weights';

export function WeightMeter({ sum, itemCount }: { sum: number; itemCount: number }) {
  const { t } = useLanguage();
  const status = weightStatus(sum, itemCount);
  if (status === 'empty') {
    return (
      <span className="text-micro text-muted-foreground">{t('adminProjectSetupPage.empty')}</span>
    );
  }

  const cls =
    status === 'ok'
      ? 'border-success/40 bg-success/10 text-success'
      : status === 'under'
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-destructive/40 bg-destructive/10 text-destructive';

  const remaining = 100 - sum;
  const label =
    status === 'ok'
      ? t('adminProjectSetupPage.meterComplete', { sum: sum.toFixed(1) })
      : status === 'under'
        ? t('adminProjectSetupPage.meterUnder', {
            sum: sum.toFixed(1),
            remaining: remaining.toFixed(1),
          })
        : t('adminProjectSetupPage.meterOver', {
            sum: sum.toFixed(1),
            over: (sum - 100).toFixed(1),
          });

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-medium tabular-nums',
        cls,
      )}
    >
      {status === 'ok' ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      {label}
    </span>
  );
}

export function SectionHeader({
  icon,
  title,
  sum,
  itemCount,
  onEqualSplit,
  action,
  compact = false,
  hideMeter = false,
}: {
  icon: React.ReactNode;
  title: string;
  sum: number;
  itemCount: number;
  onEqualSplit?: () => void;
  action: React.ReactNode;
  compact?: boolean;
  /** When true, omit the live "Нийт X% / 100%" badge — useful for groupings
   *  whose children no longer sum to a fixed target (e.g. components, which
   *  are visual-only after the subtask layer was removed). */
  hideMeter?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 flex-wrap',
        compact ? 'text-xs' : 'text-sm',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            'flex items-center gap-1.5 font-semibold',
            compact ? 'text-muted-foreground' : '',
          )}
        >
          <span className="text-primary">{icon}</span>
          {title}
        </span>
        {!hideMeter && <WeightMeter sum={sum} itemCount={itemCount} />}
      </div>
      <div className="flex items-center gap-1.5">
        {onEqualSplit && itemCount > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-micro text-muted-foreground hover:text-foreground gap-1"
            onClick={onEqualSplit}
            title={t('adminProjectSetupPage.splitAllEquallyTitle', {
              pct: (100 / itemCount).toFixed(1),
            })}
          >
            <Scale className="h-3 w-3" /> {t('adminProjectSetupPage.splitEqually')}
          </Button>
        )}
        {action}
      </div>
    </div>
  );
}
