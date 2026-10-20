import { Coffee, Pause, Timer } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import StopwatchText from './StopwatchText';
import { minutesToHHMM } from './stopwatch';
import { useLunchNow } from './useLunchNow';
import type { OfficialTimerApi } from './useOfficialTimer';

/** Нэг хэмжигдэхүүн: жижиг гарчиг + том тоо (секундомерын формат). */
function Metric({
  label,
  baseMs,
  since,
  testId,
  emphasis,
}: {
  label: string;
  baseMs: number;
  since: number | null;
  testId: string;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-[7.5rem]">
      <div className="text-label uppercase text-muted-foreground">{label}</div>
      <StopwatchText
        baseMs={baseMs}
        since={since}
        testId={testId}
        className={cn('mt-1 text-3xl font-light leading-none tracking-tight', emphasis ? 'text-foreground' : 'text-foreground/80')}
        fracClassName="text-2xl"
        unitClassName="text-sm font-normal"
      />
    </div>
  );
}

/**
 * «Миний ажлууд»-ын дээд хэсэг — албан ёсны ажлын цаг: одоо бүртгэгдэж буй таск,
 * энэ таскийн нийт, өнөөдрийн нийт, ⏸ (зогсоох).  Бүртгэгдэж буй таск жагсаалтын
 * шүүлтүүрт харагдахгүй байсан ч (өөр таб, буцаасан таск) эндээс зогсоож болно.
 * Цайны цагт (2026-10-01) «Цайны цаг» гэж тэмдэглэнэ — тоолуур хөлдөж, цонх
 * дуусахад өөрөө үргэлжилнэ.
 */
export default function OfficialTimerBanner({ timer }: { timer: OfficialTimerApi }) {
  const { t } = useLanguage();
  const { state, running } = timer;
  const lunchNow = useLunchNow(running !== null);
  if (!state) return null;

  const todaySince = running ? Math.max(running.since, timer.dayStartMs) : null;
  const lunchTitle = timer.lunch
    ? t('taskTimer.lunchTitle', { start: minutesToHHMM(timer.lunch.startMin), end: minutesToHHMM(timer.lunch.endMin) })
    : undefined;

  return (
    <section
      id="sec-mytasks-timer"
      aria-label={t('taskTimer.bannerTitle')}
      className={cn(
        'relative overflow-hidden rounded-xl border bg-card scroll-mt-24',
        running ? 'border-success/40' : 'border-border',
      )}
      data-testid="official-timer-banner"
    >
      {/* Бүртгэж байх үед зүүн талын нарийн ногоон зурвас — төлөвийг холоос танина. */}
      <span
        className={cn('absolute inset-y-0 left-0 w-1', running ? 'bg-success' : 'bg-border')}
        aria-hidden
      />
      <div className="flex flex-col gap-4 py-4 pl-5 pr-4 sm:flex-row sm:items-center sm:gap-6">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-lg border',
              running ? 'border-success/30 bg-success/10 text-success' : 'border-border bg-muted/40 text-muted-foreground',
            )}
          >
            <Timer className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-label uppercase text-muted-foreground">{t('taskTimer.bannerTitle')}</span>
              {running && lunchNow && (
                <span
                  className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                  title={lunchTitle}
                  data-testid="official-timer-lunch"
                >
                  <Coffee className="size-3" aria-hidden />
                  {t('taskTimer.statusLunch')}
                </span>
              )}
              {running && !lunchNow && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                  <span className="relative flex size-1.5" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-success" />
                  </span>
                  {t('taskTimer.bannerRunning')}
                </span>
              )}
            </div>
            {running ? (
              <>
                <div
                  className="mt-1 truncate text-sm font-semibold text-foreground"
                  data-testid="official-timer-running-task"
                  data-task-id={running.task_id}
                  title={running.task_name ?? undefined}
                >
                  {running.task_name ?? `#${running.task_id}`}
                </div>
                {running.project_name && (
                  <div className="truncate text-xs text-muted-foreground">{running.project_name}</div>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">{t('taskTimer.bannerIdle')}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 sm:border-l sm:border-border sm:pl-6">
          {running && (
            <Metric
              label={t('taskTimer.bannerTaskTotal')}
              baseMs={timer.closedMs(running.task_id)}
              since={running.since}
              testId="official-timer-task-total"
              emphasis
            />
          )}
          <Metric
            label={t('taskTimer.bannerToday')}
            baseMs={timer.todayClosedMs}
            since={todaySince}
            testId="official-timer-today"
            emphasis={!running}
          />
          {running && (
            <Button
              variant="outline"
              size="icon"
              className="self-center border-success/40 bg-success/10 text-success hover:bg-success/15 hover:text-success"
              onClick={() => timer.pause(running.task_id)}
              title={lunchNow && lunchTitle ? lunchTitle : t('taskTimer.pauseTitle')}
              aria-label={`${t('taskTimer.pause')} — ${running.task_name ?? `#${running.task_id}`}`}
              data-testid="official-timer-banner-pause"
            >
              <Pause className="size-4 fill-current" aria-hidden />
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
