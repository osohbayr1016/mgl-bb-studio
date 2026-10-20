import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import type { ScenarioForecast } from '@/features/projects/lib/forecast';

function fmtDate(d: string | null, locale: string): string {
  if (!d) return '—';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(locale === 'mn' ? 'mn-MN' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function VarianceTag({ f }: { f: ScenarioForecast | null }) {
  const { t } = useLanguage();
  if (!f || f.varianceDays === null) return null;
  if (f.varianceDays === 0)
    return <span className="text-success">{t('projectChartsTab.fcVarianceOnTime')}</span>;
  const late = f.varianceDays > 0;
  return (
    <span className={late ? 'text-danger' : 'text-success'}>
      {late
        ? t('projectChartsTab.fcVarianceLate', { days: f.varianceDays })
        : t('projectChartsTab.fcVarianceEarly', { days: -f.varianceDays })}
    </span>
  );
}

export function ForecastReadout({
  progress,
  deadline,
  currentPace,
  locale,
}: {
  progress: number;
  deadline: string | null;
  currentPace: ScenarioForecast | null;
  locale: string;
}) {
  const { t } = useLanguage();
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-micro tabular-nums text-foreground">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-foreground font-semibold">{progress.toFixed(1)}%</span>
        <span>
          {t('projectChartsTab.fcDeadline')}: <span className="text-foreground">{fmtDate(deadline, locale)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#22d3ee' }} />
          {t('projectChartsTab.fcCurrentPace')}:{' '}
          {currentPace?.done ? (
            <span className="text-success">{t('projectChartsTab.fcDone')}</span>
          ) : currentPace?.finishDate ? (
            <>
              <span className="text-foreground">{fmtDate(currentPace.finishDate, locale)}</span> · <VarianceTag f={currentPace} />
            </>
          ) : (
            <span className="text-warning">{t('projectChartsTab.fcNoForecast')}</span>
          )}
        </span>
        <span className={cn('text-micro italic text-muted-foreground')}>({t('projectChartsTab.fcApprox')})</span>
      </div>
    </div>
  );
}

export function PaceSlider({
  value,
  onChange,
  max = 5,
}: {
  value: number;
  onChange: (gainPerDay: number) => void;
  max?: number;
}) {
  const { t } = useLanguage();
  // Never render a value below the slider's min — the parent seeds `scenarioGain`
  // to 0 ("uninitialised") for one frame before its effect sets the real pace,
  // and a controlled `value` under `min` is out-of-range (would flash "0.00").
  const display = Math.max(0.05, value);
  return (
    <label className="pointer-events-auto flex items-center gap-2 text-micro text-foreground">
      <span className="shrink-0">{t('projectChartsTab.fcPaceLabel')}</span>
      <input
        type="range"
        min={0.05}
        max={max}
        step={0.05}
        value={display}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-40 cursor-pointer accent-fuchsia-400"
      />
      <span className="w-16 shrink-0 tabular-nums text-foreground">
        {t('projectChartsTab.fcPaceValue', { gain: display.toFixed(2) })}
      </span>
    </label>
  );
}
