import { useState, type ReactNode } from 'react';
import { ChevronDown, Timer } from 'lucide-react';
import { ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { formatDateTime, todayUB } from '@/shared/lib/time';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import StopwatchText from './StopwatchText';
import { endNoteKey } from './officialTimer';

interface DaysResponse {
  server_now: string;
  from: string;
  to: string;
  days: Array<{
    date: string;
    official_ms: number;
    tasks: Array<{ task_id: number; task_name: string | null; project_name: string | null; official_ms: number }>;
    sessions: Array<{
      id: number;
      task_id: number;
      started_at: string;
      ended_at: string | null;
      end_reason: string | null;
      /** 0368: clock_out | day_end | admin_stop | split. */
      end_note?: string | null;
      /** 0379: эзэн хүчингүй болгосон — өдрийн нийлбэрт ОРОХГҮЙ, аудитад үлдэнэ. */
      voided?: boolean;
    }>;
  }>;
}

/** Профайлын «Өдрийн тайлан»-д харуулах өдрийн тоо. */
const DAYS = 14;

function isoAddDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const hhmm = (iso: string) => formatDateTime(iso).slice(11);

const REASON_KEY: Record<string, string> = {
  pause: 'taskTimer.reasonPause',
  switch: 'taskTimer.reasonSwitch',
  auto_stop_completed: 'taskTimer.reasonCompleted',
  auto_stop_deleted: 'taskTimer.reasonDeleted',
};

/** Профайлын карт: гарчигтай, хүрээтэй. */
function ProfileShell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return (
    <Card className="mb-4 border-border bg-card/60 backdrop-blur" data-testid="official-timer-days">
      <div className="flex items-center gap-2 border-b border-border/60 px-5 py-4">
        <Timer className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{t('taskTimer.dayTitle')}</h3>
      </div>
      <CardContent className="pt-3">
        <p className="mb-3 text-xs text-muted-foreground">{t('taskTimer.dayHint')}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/** Тайлангийн хүснэгтийн мөрийн доорх задрал — гарчиг, хүрээгүй. */
function EmbeddedShell({ children }: { children: ReactNode }) {
  return <div data-testid="official-timer-days">{children}</div>;
}

/**
 * Өдрийн тайлан — АЛБАН ЁСНЫ таскийн цаг (▶/⏸, 0361) өдөр × таск × сэшн.
 * Өөрөө эсвэл admin л хардаг (сервер 403 бол карт огт харагдахгүй).
 * ⚠️ Revit-ийн автомат цаг энд ОРОХГҮЙ — захирлын шийдвэр (2026-09-29).
 *
 * Хоёр хэрэглээ: профайл (өгөгдмөл, сүүлийн 14 өдөр, `ProfileShell`) ба Тайлан
 * хуудасны «Таскийн цаг» табын ажилтны задрал (`embedded`, сонгосон муж).
 */
export default function OfficialTimerDaysCard({
  userId,
  from: fromProp,
  to: toProp,
  embedded = false,
}: {
  userId: number;
  /** Өгөхгүй бол сүүлийн 14 өдөр (профайл).  Тайлангийн табд сонгосон муж (≤62 өдөр). */
  from?: string;
  to?: string;
  /** Тайлангийн хүснэгтийн мөрийн дор — гарчиг/хүрээгүй, ачаалж буй/алдааг ил харуулна. */
  embedded?: boolean;
}) {
  const { t } = useLanguage();
  const to = toProp ?? todayUB();
  const from = fromProp ?? isoAddDays(to, -(DAYS - 1));
  const q = useApiQuery<DaysResponse>(
    ['/task-timer/days', userId, from, to],
    `/task-timer/users/${userId}/days?from=${from}&to=${to}`,
    { enabled: userId > 0, retry: false, refetchInterval: 60_000 },
  );
  const [open, setOpen] = useState<string | null>(null);

  if (!embedded && q.error instanceof ApiError && q.error.status === 403) return null;
  if (!embedded && (q.isLoading || !q.data)) return null;
  if (!q.data) {
    return (
      <p className={cn('py-3 text-center text-sm', q.isError ? 'text-destructive' : 'text-muted-foreground')}>
        {q.isError ? t('taskTimer.liveError') : t('common.loading')}
      </p>
    );
  }

  const days = q.data.days;
  const Shell = embedded ? EmbeddedShell : ProfileShell;
  return (
    <Shell>
      {days.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">{t('taskTimer.dayEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {days.map((d) => {
            const expanded = open === d.date;
            return (
              <li key={d.date} className="py-2.5">
                <Button
                  variant="ghost"
                  onClick={() => setOpen(expanded ? null : d.date)}
                  className="h-auto w-full justify-start gap-3 px-1 py-1 text-left font-normal pointer-coarse:h-auto"
                  aria-expanded={expanded}
                >
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-180')}
                  />
                  <span className="text-sm font-medium tabular-nums text-foreground">{d.date}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('taskTimer.daySessions', { count: d.sessions.length })}
                  </span>
                  <StopwatchText
                    baseMs={d.official_ms}
                    since={null}
                    className="ml-auto font-mono text-sm font-semibold text-foreground"
                  />
                </Button>
                <ul className="mt-1.5 space-y-1 pl-6">
                  {d.tasks.map((task) => (
                    <li key={task.task_id} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {task.project_name ? `${task.project_name} › ` : ''}
                        <span className="text-foreground">{task.task_name ?? `#${task.task_id}`}</span>
                      </span>
                      <StopwatchText baseMs={task.official_ms} since={null} className="font-mono text-foreground/80" />
                    </li>
                  ))}
                </ul>
                {expanded && (
                  <ul className="mt-2 space-y-0.5 border-l border-border/60 pl-6 ml-1.5 text-micro text-muted-foreground">
                    {d.sessions.map((s) => {
                      const name = d.tasks.find((x) => x.task_id === s.task_id)?.task_name ?? `#${s.task_id}`;
                      return (
                        <li
                          key={s.id}
                          className={cn('flex flex-wrap gap-x-2 tabular-nums', s.voided && 'opacity-60')}
                          data-voided={s.voided ? '1' : '0'}
                        >
                          <span className={cn('font-mono', s.voided && 'line-through')}>
                            {formatDateTime(s.started_at).slice(5)} → {s.ended_at ? hhmm(s.ended_at) : t('taskTimer.dayRunning')}
                          </span>
                          <span className="text-foreground/80">{name}</span>
                          {s.voided && <span>· {t('taskAlloc.sessions.voidedBadge')}</span>}
                          {s.end_reason && (
                            <span>
                              · {t(endNoteKey(s.end_note) ?? REASON_KEY[s.end_reason] ?? 'taskTimer.reasonPause')}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
