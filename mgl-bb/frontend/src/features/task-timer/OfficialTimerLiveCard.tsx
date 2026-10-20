import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Coffee, Loader2, Square, Timer } from 'lucide-react';
import { apiFetch, MEDIA_BASE_URL, type ApiError } from '@/shared/api/client';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { formatDateTime } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/avatar';
import { Button } from '@/ui/button';
import {
  OFFICIAL_TIMER_LIVE_KEY,
  OFFICIAL_TIMER_STATE_KEY,
  OFFICIAL_TIMER_WORKING_KEY,
  type OfficialLiveResponse,
  type OfficialLiveRow,
} from './officialTimer';
import StopwatchText from './StopwatchText';
import { minutesToHHMM } from './stopwatch';
import { currentLunch, syncLunch, syncServerClock } from './timerClock';
import { useLunchNow } from './useLunchNow';
import { notifyOtherTabs } from './useOfficialTimer';

const hhmm = (iso: string) => formatDateTime(iso).slice(11);

/**
 * Захирал/админы харагдац — ЗӨВХӨН АЛБАН ЁСНЫ ▶/⏸ таймер (0361): хэн одоо аль
 * таск дээр ажиллаж байна, тэр таскийн хуримтлал, өнөөдрийн нийт.
 *
 * ⚠️ Revit-ийн автомат цаг (0360) энд ХЭЗЭЭ Ч харагдахгүй, нэмэгдэхгүй — захирлын
 *    шийдвэр (2026-09-29): албан тоо нь зөвхөн ажилтны өөрөө удирдсан таймер.
 * 2026-10-01: таймер = таскийг «Өөртөө авах»; админ мартагдсан таймерыг эндээс
 *    «Зогсоох» (`POST /task-timer/users/:id/stop`, тухайн хүнд мэдэгдэл очно).
 */
export default function OfficialTimerLiveCard() {
  const { t } = useLanguage();
  const q = useQuery<OfficialLiveResponse, ApiError>({
    queryKey: OFFICIAL_TIMER_LIVE_KEY,
    queryFn: async () => {
      const res = await apiFetch<OfficialLiveResponse>('/task-timer/live');
      syncServerClock(res.server_now);
      syncLunch(res.lunch);
      return res;
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const [showIdle, setShowIdle] = useState(false);
  const data = q.data;

  const { active, idle } = useMemo(() => {
    const rows = [...(data?.rows ?? [])];
    const name = (r: OfficialLiveRow) => formatDisplayName(r.full_name) || r.username;
    rows.sort((a, b) => {
      const ra = a.running ? 0 : a.official_today_closed_ms > 0 ? 1 : 2;
      const rb = b.running ? 0 : b.official_today_closed_ms > 0 ? 1 : 2;
      return ra - rb || name(a).localeCompare(name(b));
    });
    return {
      active: rows.filter((r) => r.running || r.official_today_closed_ms > 0),
      idle: rows.filter((r) => !r.running && r.official_today_closed_ms === 0),
    };
  }, [data]);

  const runningCount = active.filter((r) => r.running).length;

  return (
    <Card id="sec-reports-tasktime-live" className="border-border bg-card/60 backdrop-blur scroll-mt-24">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Timer className="h-4 w-4 text-primary" />
          {t('taskTimer.liveTitle')}
          <span className="text-xs font-normal text-muted-foreground">
            {t('taskTimer.liveSummary', { running: runningCount, total: data?.rows.length ?? 0 })}
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{t('taskTimer.liveHint')}</p>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : q.isError ? (
          <p className="py-6 text-center text-sm text-destructive">{t('taskTimer.liveError')}</p>
        ) : active.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('taskTimer.liveEmpty')}</p>
        ) : (
          <div className="max-h-[560px] overflow-y-auto overflow-x-hidden pr-1 -mr-1">
            <ul className="divide-y divide-border/60" data-testid="official-timer-live">
              {active.map((r) => (
                <LiveRow key={r.user_id} row={r} dayStartMs={Date.parse(data!.day_start)} />
              ))}
            </ul>
          </div>
        )}
        {idle.length > 0 && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowIdle((v) => !v)}
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={showIdle}
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showIdle && 'rotate-180')} />
              {t('taskTimer.liveIdleToggle', { count: idle.length })}
            </Button>
            {showIdle && (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {idle.map((r) => formatDisplayName(r.full_name) || r.username).join(' · ')}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Сүүлд ЯАГААД зогссон — 0368-ийн `note` (ирц, 23:59, админ, хуваалт) эхлээд. */
function lastStopKey(stop: NonNullable<OfficialLiveRow['last_stop']>) {
  switch (stop.note) {
    case 'clock_out':
      return 'taskTimer.liveLastClockOut';
    case 'day_end':
      return 'taskTimer.liveLastDayEnd';
    case 'admin_stop':
      return 'taskTimer.liveLastAdminStop';
    case 'split':
      return 'taskTimer.liveLastSplit';
    default:
      return stop.reason === 'auto_stop_completed'
        ? 'taskTimer.liveLastCompleted'
        : stop.reason === 'auto_stop_deleted'
          ? 'taskTimer.liveLastDeleted'
          : 'taskTimer.liveLastPaused';
  }
}

function LiveRow({ row, dayStartMs }: { row: OfficialLiveRow; dayStartMs: number }) {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const [stopping, setStopping] = useState(false);
  const run = row.running;
  // Цайны цагт (2026-10-01) тоолуур хөлдсөн — «Ажиллаж байна»-ын оронд «Цайны цаг».
  const lunchNow = useLunchNow(run !== null);
  const lunch = currentLunch();
  const name = formatDisplayName(row.full_name) || row.username;
  const since = run ? Date.parse(run.started_at) : null;
  const lastLabel = (() => {
    if (run) return t('taskTimer.liveSince', { time: hhmm(run.started_at) });
    if (!row.last_stop) return '';
    return t(lastStopKey(row.last_stop), { time: hhmm(row.last_stop.at) });
  })();
  const stop = async () => {
    if (!run) return;
    const ok = await confirmDialog({
      title: t('taskLive.adminStopTitle'),
      description: t('taskLive.adminStopConfirm', { name, task: run.task_name ?? `#${run.task_id}` }),
      confirmText: t('taskLive.adminStop'),
      variant: 'destructive',
    });
    if (!ok) return;
    setStopping(true);
    try {
      await apiFetch(`/task-timer/users/${row.user_id}/stop`, { method: 'POST', data: {} });
      notifyOtherTabs();
      void qc.invalidateQueries({ queryKey: OFFICIAL_TIMER_LIVE_KEY });
      void qc.invalidateQueries({ queryKey: [OFFICIAL_TIMER_WORKING_KEY] });
      void qc.invalidateQueries({ queryKey: OFFICIAL_TIMER_STATE_KEY });
      toast.success(t('taskLive.adminStopped', { name }));
    } catch (e) {
      toast.error(t('common.error'), e instanceof Error ? e.message : undefined);
    } finally {
      setStopping(false);
    }
  };

  return (
    <li className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:gap-3" data-testid="official-timer-live-row">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar className="h-8 w-8 shrink-0">
          {row.profile_image && <AvatarImage src={`${MEDIA_BASE_URL}${row.profile_image}`} />}
          <AvatarFallback className="bg-primary/20 text-label text-primary">
            {name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            {run && lunchNow ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-label normal-case tracking-normal text-warning"
                title={
                  lunch
                    ? t('taskTimer.lunchTitle', { start: minutesToHHMM(lunch.startMin), end: minutesToHHMM(lunch.endMin) })
                    : undefined
                }
              >
                <Coffee className="h-3 w-3" aria-hidden />
                {t('taskTimer.statusLunch')}
              </span>
            ) : run ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-label normal-case tracking-normal text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
                {t('taskTimer.statusWorking')}
              </span>
            ) : (
              <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-label font-normal normal-case tracking-normal text-muted-foreground">
                {t('taskTimer.statusStopped')}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {run
              ? `${run.project_name ?? '—'} › ${run.task_name ?? `#${run.task_id}`}`
              : row.last_stop?.task_name
                ? `${t('taskTimer.liveLastTask')}: ${row.last_stop.task_name}`
                : '—'}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 pl-11 sm:pl-0">
        <div className="text-right">
          <div className="text-label uppercase text-muted-foreground">
            {t('taskTimer.liveCurrentTask')}
          </div>
          {run ? (
            <StopwatchText
              baseMs={run.official_task_closed_ms}
              since={since}
              className={cn('font-mono text-sm font-semibold', lunchNow ? 'text-muted-foreground' : 'text-success')}
            />
          ) : (
            <div className="font-mono text-sm text-muted-foreground">—</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-label uppercase text-muted-foreground">
            {t('taskTimer.bannerToday')}
          </div>
          <StopwatchText
            baseMs={row.official_today_closed_ms}
            since={since === null ? null : Math.max(since, dayStartMs)}
            className="font-mono text-sm font-semibold text-foreground"
          />
        </div>
        <div className="hidden w-24 text-right text-micro text-muted-foreground md:block">{lastLabel}</div>
        {run && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:border-destructive/40 hover:text-destructive"
            onClick={() => void stop()}
            disabled={stopping}
            title={t('taskLive.adminStopFor', { name })}
            data-testid="official-timer-live-stop"
          >
            {stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
            {t('taskLive.adminStop')}
          </Button>
        )}
      </div>
    </li>
  );
}
