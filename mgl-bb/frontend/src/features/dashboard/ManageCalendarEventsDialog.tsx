import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '@/shared/context/AuthContext';
import { useLanguage } from '@/shared/i18n';
import { apiFetch } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { cn } from '@/shared/lib/utils';
import { formatDate } from '@/shared/lib/time';
import type { CalendarEvent, CalendarPriority } from '@/shared/types';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/ui/dialog';
import { Input } from '@/ui/input';
import { Textarea } from '@/ui/textarea';
import { Label } from '@/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function isoOf(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayIso() {
  return isoOf(new Date());
}

const PRIORITY_OPTIONS: Array<{ value: CalendarPriority; mn: string; en: string }> = [
  { value: 'normal', mn: 'Энгийн', en: 'Normal' },
  { value: 'high', mn: 'Чухал', en: 'High' },
  { value: 'urgent', mn: 'Яаралтай', en: 'Urgent' },
];

const PRIORITY_CHIP: Record<CalendarPriority, string> = {
  normal: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-300',
  high: 'bg-amber-500/15 text-amber-700 border-amber-500/40 dark:text-amber-300',
  urgent: 'bg-red-500/15 text-red-700 border-red-500/40 dark:text-red-300',
};

type View = 'list' | 'form';

/**
 * Admin-only "manage calendar events" dialog — supersedes the old
 * AddCalendarEventDialog with a full list + create + edit + delete UI.
 * Reads/writes `calendar_events` directly; the backend auto-pushes any
 * change to Google Calendar (push-on-write), so this stays purely a
 * thin CRUD front-end over `/calendar/events`.
 */
export default function ManageCalendarEventsDialog({ onChanged }: { onChanged?: () => void }) {
  const { user } = useAuth();
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [editing, setEditing] = useState<CalendarEvent | null>(null);

  // 60 days back → 180 days ahead, computed once so the query key stays
  // stable across re-renders.
  const range = useMemo(() => {
    const from = new Date();
    from.setDate(from.getDate() - 60);
    const to = new Date();
    to.setDate(to.getDate() + 180);
    return { from: isoOf(from), to: isoOf(to) };
  }, []);

  const eventsQuery = useApiQuery<{ events: CalendarEvent[] }>(
    ['manage-calendar-events', range.from, range.to],
    `/calendar/events?from=${range.from}&to=${range.to}`,
    { enabled: open },
  );

  const sortedEvents = useMemo(() => {
    const events = eventsQuery.data?.events ?? [];
    return [...events].sort((a, b) => {
      const byDate = a.event_date.localeCompare(b.event_date);
      if (byDate !== 0) return byDate;
      return (a.start_time ?? '').localeCompare(b.start_time ?? '');
    });
  }, [eventsQuery.data]);

  if (user?.role !== 'admin') return null;

  const refetchAll = async () => {
    await eventsQuery.refetch();
    onChanged?.();
  };

  const openCreate = () => {
    setEditing(null);
    setView('form');
  };
  const openEdit = (event: CalendarEvent) => {
    setEditing(event);
    setView('form');
  };
  const backToList = () => {
    setEditing(null);
    setView('list');
  };

  const handleDelete = async (event: CalendarEvent) => {
    const ok = await confirmDialog({
      title: lang === 'mn' ? 'Эвент устгах уу?' : 'Delete event?',
      description: event.title,
      confirmText: lang === 'mn' ? 'Устгах' : 'Delete',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiFetch(`/calendar/events/${event.id}`, { method: 'DELETE' });
      toast.success(lang === 'mn' ? 'Эвент устгагдлаа' : 'Event deleted');
      await refetchAll();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : lang === 'mn' ? 'Алдаа гарлаа' : 'Something went wrong',
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setView('list');
          setEditing(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          {lang === 'mn' ? 'Эвент удирдах' : 'Manage events'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {view === 'list'
              ? lang === 'mn'
                ? 'Эвент удирдах'
                : 'Manage events'
              : editing
                ? lang === 'mn'
                  ? 'Эвент засах'
                  : 'Edit event'
                : lang === 'mn'
                  ? 'Шинэ эвент'
                  : 'New event'}
          </DialogTitle>
        </DialogHeader>

        {view === 'list' ? (
          <div className="grid gap-3">
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={openCreate}>
                {lang === 'mn' ? '＋ Шинэ эвент' : '＋ New event'}
              </Button>
            </div>

            {/* `grid-cols-1` = minmax(0, 1fr): without it the implicit grid track
                grows to the LONGEST title's nowrap width, so one long event
                (prod has an 86-char one) widened every row past the list and
                `overflow-x-hidden` clipped the edit/delete buttons off all rows. */}
            <div className="max-h-[60vh] overflow-y-auto overflow-x-hidden grid grid-cols-1 gap-2">
              {eventsQuery.isPending ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {lang === 'mn' ? 'Ачааллаж байна…' : 'Loading…'}
                </p>
              ) : sortedEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {lang === 'mn' ? 'Эвент алга байна' : 'No events'}
                </p>
              ) : (
                sortedEvents.map((event) => (
                  <div
                    key={event.id}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground tabular-nums">
                          {formatDate(event.event_date)}
                          {event.start_time
                            ? ` · ${event.start_time}${event.end_time ? `–${event.end_time}` : ''}`
                            : ` · ${lang === 'mn' ? 'Өдөржин' : 'All day'}`}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border',
                            PRIORITY_CHIP[event.priority],
                          )}
                        >
                          {lang === 'mn'
                            ? PRIORITY_OPTIONS.find((o) => o.value === event.priority)?.mn
                            : PRIORITY_OPTIONS.find((o) => o.value === event.priority)?.en}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm font-medium truncate" title={event.title}>
                        {event.title}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        aria-label={lang === 'mn' ? 'Засах' : 'Edit'}
                        onClick={() => openEdit(event)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        aria-label={lang === 'mn' ? 'Устгах' : 'Delete'}
                        onClick={() => handleDelete(event)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {lang === 'mn' ? 'Хаах' : 'Close'}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <EventForm
            event={editing}
            lang={lang}
            onCancel={backToList}
            onSaved={async () => {
              await refetchAll();
              backToList();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// EventForm — shared create/edit form section.  `event === null` means
// create mode; otherwise it's pre-filled from the row being edited.
// ---------------------------------------------------------------------------
function EventForm({
  event,
  lang,
  onCancel,
  onSaved,
}: {
  event: CalendarEvent | null;
  lang: 'mn' | 'en';
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(event?.title ?? '');
  const [date, setDate] = useState(event?.event_date ?? todayIso());
  const [startTime, setStartTime] = useState(event?.start_time ?? '');
  const [endTime, setEndTime] = useState(event?.end_time ?? '');
  const [message, setMessage] = useState(event?.message ?? '');
  const [priority, setPriority] = useState<CalendarPriority>(event?.priority ?? 'normal');

  const canSubmit = title.trim().length > 0 && date.trim().length > 0 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        event_date: date,
        start_time: startTime || null,
        end_time: endTime || null,
        message: message.trim() || null,
        priority,
      };
      if (event) {
        await apiFetch(`/calendar/events/${event.id}`, { method: 'PUT', data: payload });
        toast.success(lang === 'mn' ? 'Эвент шинэчлэгдлээ' : 'Event updated');
      } else {
        await apiFetch('/calendar/events', { data: payload });
        toast.success(lang === 'mn' ? 'Эвент нэмэгдлээ' : 'Event created');
      }
      await onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : lang === 'mn' ? 'Алдаа гарлаа' : 'Something went wrong',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="event-form-title">{lang === 'mn' ? 'Гарчиг' : 'Title'}</Label>
        <Input
          id="event-form-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={lang === 'mn' ? 'Гарчиг' : 'Title'}
          required
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="event-form-date">{lang === 'mn' ? 'Огноо' : 'Date'}</Label>
        <Input
          id="event-form-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="event-form-start">{lang === 'mn' ? 'Эхлэх цаг' : 'Start time'}</Label>
          <Input
            id="event-form-start"
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="event-form-end">{lang === 'mn' ? 'Дуусах цаг' : 'End time'}</Label>
          <Input
            id="event-form-end"
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="event-form-message">{lang === 'mn' ? 'Тайлбар' : 'Description'}</Label>
        <Textarea
          id="event-form-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={lang === 'mn' ? 'Тайлбар (заавал биш)' : 'Description (optional)'}
          rows={3}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>{lang === 'mn' ? 'Эрэмбэ' : 'Priority'}</Label>
        <Select value={priority} onValueChange={(v) => setPriority(v as CalendarPriority)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {lang === 'mn' ? opt.mn : opt.en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          {lang === 'mn' ? 'Цуцлах' : 'Cancel'}
        </Button>
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
          {saving
            ? lang === 'mn'
              ? 'Хадгалж байна…'
              : 'Saving…'
            : lang === 'mn'
              ? 'Хадгалах'
              : 'Save'}
        </Button>
      </DialogFooter>
    </div>
  );
}
