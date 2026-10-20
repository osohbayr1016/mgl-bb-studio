import type { ReactNode } from 'react';
import { Clock, Coffee, Loader2, Pause, Play } from 'lucide-react';
import { Button } from '@/ui/button';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import StopwatchText from './StopwatchText';
import { minutesToHHMM } from './stopwatch';
import { useLunchNow } from './useLunchNow';
import type { OfficialTimerApi } from './useOfficialTimer';

/** Явж байгааг илтгэх анивчих цэг (хөдөлгөөн багасгах тохиргоонд зогсоно). */
function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
    </span>
  );
}

/**
 * Таскийн албан цаг — ▶ / ⏸ ДҮРСТЭЙ товч (эзэн 2026-10-01: «Өөртөө авах» бичгийн
 * оронд зөвхөн playback товч — дарвал цаг шууд эхэлнэ, цаг явж байх үед ⏸ болж
 * зогсооно).  09-29-ний «бичигтэй товч» шийдвэрийг СОЛЬСОН: бичвэр нь tooltip ба
 * aria-label-д л үлдэнэ.  Төслийн хуудас, «Миний ажлууд», самбарын карт — ГАНЦ товч.
 *   цаг эхлээгүй       → [▶]
 *   өмнө нь бүртгэсэн  → [12:04.33 | ▶]   (`showClosed`; төслийн хуудсанд false — зөвхөн ▶)
 *   одоо бүртгэж буй   → [● 12:04.33 | ⏸] (ногоон)
 *   цайны цагт         → [☕ 12:04.33 | ⏸] — тоолуур хөлдсөн, цонх дуусахад өөрөө үргэлжилнэ
 * Өөр таск бүртгэгдэж байхад ▶ дарвал сервер АТОМ сэлгэнэ.
 */
export default function TaskTimerControl({
  timer,
  taskId,
  taskName,
  projectName,
  canRun,
  size = 'md',
  onStart,
  busy = false,
  disabled = false,
  showClosed = true,
  iconOnly = false,
  startTitle,
}: {
  timer: OfficialTimerApi;
  taskId: number;
  taskName: string;
  projectName?: string;
  /** ▶ товч харуулах эсэх.  false (дууссан мөр, таск авах эрхгүй, самбарын жижиг карт)
   *  бол нийт цаг л харагдана, харин ЯВЖ БАЙГАА бол ⏸ үлдэнэ. */
  canRun: boolean;
  size?: 'sm' | 'md';
  /** «Таск авах» урсгал (2026-10-01): ▶ нь `timer.start` (optimistic) БИШ энэ функцийг
   *  дуудна — эзлэгдсэн таск, ирцгүй үед тоолуур хуурамчаар эхлэхгүй (`useTakeTask`).
   *  Өгөөгүй бол хуучин optimistic `timer.start`. */
  onStart?: () => void;
  /** `onStart`-ийн хүсэлт явж байна — товч түгжигдэж эргэлдэнэ. */
  busy?: boolean;
  /** Өөр товчны хүсэлт явж байна — ▶ түгжигдэнэ (⏸ үргэлж дарагдана). */
  disabled?: boolean;
  /** Өмнөх (дууссан) цагийг ▶-ийн хажууд харуулах эсэх. */
  showClosed?: boolean;
  /** ЗӨВХӨН ▶/⏸ дүрс — цаг (явж байх үед ч) харуулахгүй.  Цаг нь өөр газар (хувь нэмэрчийн жагсаалт) харагддаг үед. */
  iconOnly?: boolean;
  /** ▶-ийн tooltip-ийг солих (төслийн хуудас: «өөртөө авах / хувааж авах» тайлбар). */
  startTitle?: string;
}) {
  const { t } = useLanguage();
  const running = timer.running?.task_id === taskId ? timer.running : null;
  const lunchNow = useLunchNow(running !== null);
  // Серверийн төлөв ирээгүй (ачаалж буй / хуучин worker) бол юу ч харуулахгүй — гэхдээ
  // «авах» урсгал (`onStart`) төлөвөөс хамаардаггүй тул ▶ нь харагдана.
  if (!timer.state && !(canRun && onStart)) return null;
  const closed = timer.state ? timer.closedMs(taskId) : 0;
  const hasTime = !iconOnly && (running !== null || (showClosed && closed > 0));
  // ⚠️ Явж буй цаг ҮРГЭЛЖ ⏸ товчтой — `iconOnly` (цаг нь pill-д) үед `hasTime` false тул энэ нөхцөлгүйгээр ⏸ алга
  // болдог байсан (2026-10-06, төслийн хуудас: ▶ дармагц товч бүрмөсөн алга болж зогсоох арга үлддэггүй байв).
  if (!canRun && !hasTime && !running) return null;
  const sm = size === 'sm';

  const time = hasTime ? (
    <span className="flex items-center gap-1.5">
      {running ? (
        lunchNow ? (
          <Coffee className="size-3.5 shrink-0 text-warning" aria-hidden />
        ) : (
          <LiveDot />
        )
      ) : (
        <Clock className="size-3.5 text-muted-foreground" />
      )}
      <StopwatchText
        baseMs={closed}
        since={running?.since ?? null}
        testId="task-timer-total"
        className={cn(
          'font-medium',
          running ? (lunchNow ? 'text-muted-foreground' : 'text-success') : 'text-foreground/80',
        )}
        unitClassName="font-sans"
      />
    </span>
  ) : null;

  const wrap = (children: ReactNode) => (
    <span
      className="inline-flex"
      data-testid="task-timer"
      data-task-id={taskId}
      data-running={running ? '1' : '0'}
      data-lunch={lunchNow ? '1' : '0'}
    >
      {children}
    </span>
  );

  // ▶ эрхгүй мөр: явж байгаа бол ⏸ (доорх товч), үгүй бол нийт л.
  if (!canRun && !running) {
    return wrap(
      <span
        className="inline-flex h-8 items-center rounded-md border border-border/60 px-2.5 text-xs"
        title={t('taskTimer.totalTitle')}
      >
        {time}
      </span>,
    );
  }

  const other = timer.running !== null && running === null;
  const label = running ? t('taskTimer.pause') : closed > 0 ? t('taskTimer.resume') : t('taskTimer.start');
  const lunchTitle =
    lunchNow && timer.lunch
      ? t('taskTimer.lunchTitle', {
          start: minutesToHHMM(timer.lunch.startMin),
          end: minutesToHHMM(timer.lunch.endMin),
        })
      : null;
  const title = running
    ? (lunchTitle ?? t('taskTimer.pauseTitle'))
    : (startTitle ?? (other ? t('taskTimer.switchTitle') : t('taskTimer.startTitle')));
  const Icon = running ? Pause : Play;

  return wrap(
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy || (disabled && !running)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (running) timer.pause(taskId);
        else if (onStart) onStart();
        else timer.start(taskId, taskName, projectName);
      }}
      title={title}
      aria-label={`${label} — ${taskName}`}
      aria-pressed={running !== null}
      aria-busy={busy || undefined}
      data-testid={running ? 'task-timer-pause' : 'task-timer-start'}
      className={cn(
        'gap-0 overflow-hidden p-0 text-xs font-normal shadow-none',
        sm ? 'h-7 pointer-coarse:h-9' : 'h-8 pointer-coarse:h-10',
        running
          ? 'border-success/40 bg-success/10 hover:bg-success/15 dark:border-success/40 dark:bg-success/10 dark:hover:bg-success/15'
          : 'hover:bg-primary/10',
      )}
    >
      {time && <span className={cn('flex h-full items-center', sm ? 'px-2' : 'px-2.5')}>{time}</span>}
      <span
        className={cn(
          'grid h-full shrink-0 place-items-center',
          sm ? 'w-7 pointer-coarse:w-9' : 'w-8 pointer-coarse:w-10',
          time && (running ? 'border-l border-success/30' : 'border-l border-border'),
        )}
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin text-primary" />
        ) : (
          <Icon className={cn('size-3.5 fill-current', running ? 'text-success' : 'text-primary')} aria-hidden />
        )}
      </span>
    </Button>,
  );
}
