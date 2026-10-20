import { useMemo, useState } from 'react';
import {
  History,
  ChevronDown,
  ChevronRight,
  Copy,
  Paperclip,
  Loader2,
  Coffee,
  CalendarClock,
} from 'lucide-react';
import { Card, CardContent } from '@/ui/card';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { MEDIA_BASE_URL } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { isImageAttachment, type RecentReport } from './types';

/**
 * «Өчигдөр би юу бичсэн бэ» — өмнөх өдрүүдийн МИНИЙ тайлан.
 *
 * Урьд нь энэ гарц огт байгаагүй: ажилтан үргэлжлэл бичихийн тулд
 * өмнөх тэмдэглэлээ санах эсвэл төслийн хуудас руу ороод хайх хэрэгтэй
 * болдог байв.  Одоо `GET /api/progress/my-recent` -ийн нэг query
 * хоёуланд нь үйлчилнэ: энэ самбар, мөн мөр бүрийн «Өчигдөр 45%» чип.
 *
 * Өдрөөр нь бүлэглэж, хамгийн сүүлийн ӨМНӨХ өдрийг анхнаасаа задалсан
 * байдлаар үзүүлнэ — ихэнх тохиолдолд хүн яг түүнийг л хардаг.
 */
export default function PreviousReportsCard({
  entries,
  today,
  loading,
  onReuseNote,
}: {
  entries: RecentReport[];
  today: string;
  loading: boolean;
  onReuseNote: (taskId: number, notes: string) => void;
}) {
  const { t } = useLanguage();

  const groups = useMemo(() => {
    const byDate = new Map<string, RecentReport[]>();
    for (const e of entries) {
      const list = byDate.get(e.date);
      if (list) list.push(e);
      else byDate.set(e.date, [e]);
    }
    // `entries` нь серверээс date DESC-ээр ирдэг тул оруулах дараалал
    // хадгалагдана — дахин sort хийх шаардлагагүй.
    return [...byDate.entries()].map(([date, items]) => ({ date, items }));
  }, [entries]);

  // Анх задлах өдөр: өнөөдрийнхөөс өмнөх хамгийн сүүлийнх.
  const firstPastDate = groups.find((g) => g.date !== today)?.date ?? null;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(firstPastDate ? [firstPastDate] : []),
  );

  const toggleDay = (date: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const pastCount = entries.filter((e) => e.date !== today).length;

  return (
    <Card
      id="sec-mytasks-previous"
      className="border-border bg-card/60 backdrop-blur overflow-hidden scroll-mt-24"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-muted/20 transition-colors"
      >
        <History className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground">
          {t('dailyReport.previousTitle')}
        </span>
        {pastCount > 0 && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] tabular-nums">
            {pastCount}
          </Badge>
        )}
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <CardContent className="pt-0 pb-3 px-4">
          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : groups.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3">{t('dailyReport.previousEmpty')}</p>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => {
                const isToday = g.date === today;
                const isOpen = expanded.has(g.date);
                return (
                  <div key={g.date} className="rounded-lg border border-border/70 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleDay(g.date)}
                      aria-expanded={isOpen}
                      className={cn(
                        'w-full px-3 py-2 flex items-center gap-2 text-left transition-colors',
                        isToday ? 'bg-primary/5 hover:bg-primary/10' : 'bg-muted/30 hover:bg-muted/50',
                      )}
                    >
                      <CalendarClock
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          isToday ? 'text-primary' : 'text-muted-foreground',
                        )}
                      />
                      <span className="text-xs font-medium text-foreground tabular-nums">
                        {g.date}
                      </span>
                      {isToday && (
                        <Badge
                          variant="outline"
                          className="h-4 px-1.5 text-[9px] border-primary/40 text-primary"
                        >
                          {t('dailyReport.previousTodayTag')}
                        </Badge>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                        {t('myTasksPage.taskCount', { count: g.items.length })}
                      </span>
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>

                    {isOpen && (
                      <ul className="divide-y divide-border/50">
                        {g.items.map((e) => (
                          <PreviousRow key={e.id} entry={e} onReuseNote={onReuseNote} />
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function PreviousRow({
  entry,
  onReuseNote,
}: {
  entry: RecentReport;
  onReuseNote: (taskId: number, notes: string) => void;
}) {
  const { t } = useLanguage();
  const statusTone =
    entry.status === 'pending'
      ? 'border-warning/40 bg-warning/10 text-warning'
      : entry.status === 'rejected'
        ? 'border-destructive/40 bg-destructive/10 text-destructive'
        : 'border-success/40 bg-success/10 text-success';

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-xs font-medium text-foreground break-words min-w-0 flex-1">
          {entry.task_name}
        </span>
        {entry.is_rest_day ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px] gap-1">
            <Coffee className="h-2.5 w-2.5" />
            {t('dailyReport.previousRest')}
          </Badge>
        ) : entry.defer_next_day ? (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {t('dailyReport.previousDeferred')}
          </Badge>
        ) : (
          <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] tabular-nums', statusTone)}>
            {entry.percentage}%
          </Badge>
        )}
      </div>

      <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{entry.project_name}</p>

      {entry.notes && (
        <p className="mt-1 text-xs text-foreground/80 whitespace-pre-wrap break-words">
          {entry.notes}
        </p>
      )}

      {entry.review_note && entry.status === 'rejected' && (
        <p className="mt-1 text-[11px] text-destructive">
          {t('myTasksPage.rejectionNote')}: {entry.review_note}
        </p>
      )}

      {entry.status === 'approved' && entry.reviewer_name && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t('projectDetailPage.approvedBy', { name: entry.reviewer_name })}
        </p>
      )}

      {entry.attachments.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {entry.attachments.map((a) =>
            isImageAttachment(a) ? (
              <a key={a.url} href={`${MEDIA_BASE_URL}${a.url}`} target="_blank" rel="noreferrer">
                <img
                  src={`${MEDIA_BASE_URL}${a.url}`}
                  alt={a.name}
                  className="h-12 w-12 rounded object-cover border border-border"
                  loading="lazy"
                />
              </a>
            ) : (
              <a
                key={a.url}
                href={`${MEDIA_BASE_URL}${a.url}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded border border-border bg-muted/30 px-1.5 py-1
                           text-[10px] text-foreground hover:bg-muted/60 max-w-[160px]"
                title={a.name}
              >
                <Paperclip className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{a.name}</span>
              </a>
            ),
          )}
        </div>
      )}

      {entry.notes && (
        <Button
          size="sm"
          variant="ghost"
          className="mt-1 h-6 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => onReuseNote(entry.task_id, entry.notes ?? '')}
        >
          <Copy className="h-3 w-3 mr-1" />
          {t('dailyReport.previousReuse')}
        </Button>
      )}
    </li>
  );
}
