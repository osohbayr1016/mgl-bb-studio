import { BellRing } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime } from '@/shared/lib/time';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { ProductivityWarning } from './types';
import { fmtPct, periodLabel } from './lib';

/**
 * Ахлахад илгээсэн анхааруулгын түүх — «хэзээ, хэнд, ямар зөрүүтэй үед».
 * Мөр бүр илгээх мөчийн snapshot (0346), тиймээс одоогийн тооноос зөрж болно.
 */
export function WarningHistory({ warnings }: { warnings: ProductivityWarning[] }) {
  const { t } = useLanguage();
  if (warnings.length === 0) return null;
  return (
    <section id="sec-team-gap-warnings" className="scroll-mt-24 rounded-xl border border-border/60 bg-card">
      <header className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
        <BellRing className="h-4 w-4 text-danger" />
        <h3 className="text-sm font-semibold">{t('teamProductivity.warningsTitle')}</h3>
        <span className="ml-auto text-xs text-muted-foreground">{warnings.length}</span>
      </header>
      <ul className="divide-y divide-border/40" data-testid="tp-warnings">
        {warnings.map((w) => (
          <li key={w.id} className="space-y-0.5 px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-danger">{fmtPct(w.gap_pct)}</span>
              <span className="text-muted-foreground">
                ({t('teamProductivity.thresholdShort', { v: fmtPct(w.threshold_pct) })})
              </span>
              <span>· {periodLabel({ kind: w.period_kind, from: w.period_from, to: w.period_to }, t)}</span>
              <span className="ml-auto tabular-nums text-muted-foreground">{formatDateTime(w.created_at)}</span>
            </div>
            <p className="text-muted-foreground">
              {t('teamProductivity.warningSentBy', {
                by: formatDisplayName(w.sent_by_name) || '—',
                to: w.recipients.map((r) => formatDisplayName(r.full_name)).join(', ') || '—',
              })}
              {w.below.length > 0 && ` · ${t('teamProductivity.belowCount', { n: w.below.length })}`}
            </p>
            {w.note && <p className="whitespace-pre-line">«{w.note}»</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
