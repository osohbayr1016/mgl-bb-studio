import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { Activity, History, Loader2, NotebookPen, Save } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { apiFetch, ApiError } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import { toast } from '@/shared/components/Toast';
import { formatDateTime, todayUB } from '@/shared/lib/time';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { Badge } from '@/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogScrollableBody,
  DialogTitle,
} from '@/ui/dialog';
import ActivityHeatmap from './ActivityHeatmap';
import LogCalendar, { type CalendarView } from './LogCalendar';
import {
  HEAT_WEEKS,
  addDays,
  continueNumbering,
  digestRange,
  heatScale,
  heatmapColumns,
  itemsToText,
  mondayOf,
  monthGrid,
  rangeStats,
  sameItems,
  shiftMonth,
  textToItems,
  weekDates,
  weekdayOf,
  type DigestPreset,
} from './lib';

/**
 * «Өдрийн тайлан» — Профайл дээрх админы (= Менежмент баг) хэсэг
 * (`/api/daily-work-logs`, миграц 0345).  Өдөр хийсэн ажлаа 1. 2. 3. гэж
 * бичнэ; насан туршид хадгалагдаж сарын эцэст нотолгоо болно.  Энэ хэсэг
 * зөвхөн өөрийнхийг харуулна — сервер `user.sub`-аар шүүнэ (CEO + admin
 * багийн нэгтгэлийг «Тайлан → Менежментийн багийн тайлан»-аас уншина,
 * 2026-10-07).  Засвар бүрийн өмнөх хувилбар түүхэнд үлдэнэ, устгах товч
 * ЗОРИУД байхгүй.
 *
 * Бүтэц (2026-10-07): дээр нь тоон хураангуй + GitHub маягийн жилийн
 * идэвхийн тор (өнгө = өдрийн ДУГААРЛАСАН ажлын тоо), доор нь календарь
 * (7 хоног / сар — ажлыг шууд харуулна) ба сонгосон өдрийн засварлагч хажуу
 * тийш — урт жагсаалтаар доош гүйлгэх шаардлагагүй.  «Нэгтгэл» харагдац нь
 * сонгосон хугацаанд НИЙТ юу хийснийг жагсаана; heatmap / сарын нүдэн дээр
 * hover хийхэд тэр өдрийн ажил хөвөгч картаар гарна.
 */

interface DailyLog {
  log_date: string;
  items: string[];
  first_written_on: string;
  late: boolean;
  edit_count: number;
  created_at: string;
  updated_at: string;
}

interface RangeResponse {
  today: string;
  from: string;
  to: string;
  logs: DailyLog[];
  lifetime: { days: number; first_date: string | null };
}

interface ActivityResponse {
  today: string;
  from: string;
  to: string;
  days: { date: string; count: number; items?: string[] }[];
  lifetime: { days: number; first_date: string | null };
}

interface DayResponse {
  log: DailyLog | null;
  revisions: { items: string[]; valid_from: string; replaced_at: string }[];
}

const LOG_KEY = '/daily-work-logs';
/** «7 хоног / Сар» сонголт — зөвхөн энэ хөтчийн тав тух. */
const VIEW_STORAGE = 'mgl:daily-log:view';

function readView(): CalendarView {
  try {
    const v = localStorage.getItem(VIEW_STORAGE);
    return v === 'month' || v === 'digest' ? v : 'week';
  } catch {
    return 'week';
  }
}

function Kpi({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: number | string;
  unit: string;
  sub: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border/60 bg-background/40 px-3 py-1.5">
      <dt className="truncate text-micro text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline gap-1">
        <span className="text-title tabular-nums">{value}</span>
        <span className="text-sm text-muted-foreground">{unit}</span>
      </dd>
      <dd className="truncate text-micro text-muted-foreground">{sub}</dd>
    </div>
  );
}

export default function DailyWorkLogSection() {
  const { t } = useLanguage();
  const qc = useQueryClient();
  const today = todayUB();

  const [date, setDate] = useState(today);
  const [anchor, setAnchor] = useState(today);
  const [view, setViewState] = useState<CalendarView>(readView);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const setView = (v: CalendarView) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_STORAGE, v);
    } catch {
      /* хувийн цонх — сонголт санагдахгүй, ажиллана */
    }
  };

  // Календарийн харагдах муж: 7 хоног эсвэл сарын бүтэн долоо хоногийн тор
  // (сарын хилийг давдаг тул `?month=` биш `from/to`).
  const [digestPreset, setDigestPreset] = useState<DigestPreset>('month');
  const range = useMemo(() => {
    if (view === 'digest') return digestRange(digestPreset, today);
    if (view === 'week') {
      const d = weekDates(anchor);
      return { from: d[0]!, to: d[6]! };
    }
    const rows = monthGrid(anchor.slice(0, 7));
    return { from: rows[0]![0]!, to: rows[rows.length - 1]![6]! };
  }, [view, anchor, digestPreset, today]);

  const rangeQuery = useApiQuery<RangeResponse>(
    [LOG_KEY, 'range', range.from, range.to],
    `/daily-work-logs?from=${range.from}&to=${range.to}`,
    { retry: false, placeholderData: keepPreviousData },
  );
  const heatFrom = useMemo(() => heatmapColumns(today, HEAT_WEEKS)[0]![0]!, [today]);
  const activityQuery = useApiQuery<ActivityResponse>(
    [LOG_KEY, 'activity', heatFrom, today],
    // `items=1` — нүдэн дээр hover хийхэд тэр өдрийн ажил шууд харагдана.
    `/daily-work-logs/activity?from=${heatFrom}&to=${today}&items=1`,
    { retry: false },
  );
  const dayQuery = useApiQuery<DayResponse>([LOG_KEY, 'day', date], `/daily-work-logs/${date}`, {
    retry: false,
  });

  const saved = dayQuery.data?.log ?? null;
  const savedItems = useMemo(() => saved?.items ?? [], [saved]);
  const items = useMemo(() => textToItems(text), [text]);
  const dirty = !sameItems(items, savedItems);

  // Сонгосон өдрийн хадгалсан бичвэрийг засварлагчид ачаална (огноо солигдох
  // эсвэл сервер шинэ хувилбар буцаах бүрд).
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!dayQuery.data) return;
    const key = `${date}|${saved?.updated_at ?? ''}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setText(savedItems.length ? itemsToText(savedItems) : '');
  }, [dayQuery.data, date, saved, savedItems]);

  /** Өдөр сонгох — heatmap, календарь, огнооны талбар бүгд энд ирнэ. */
  const pickDate = (next: string) => {
    if (!next || next > today) return;
    if (next !== date) {
      if (dirty && !window.confirm(t('dailyLog.discardConfirm'))) return;
      setDate(next);
    }
    setAnchor(next);
    // Нарийн дэлгэц дээр засварлагч календарийн ДЭЭР байрлана — харагдахгүй
    // бол л гүйлгэнэ (өргөн дэлгэц дээр хажууд нь байгаа тул хөдлөхгүй).
    const r = editorRef.current?.getBoundingClientRect();
    if (r && (r.top < 0 || r.top > window.innerHeight - 160)) {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const navigate = (delta: number) =>
    setAnchor((a) =>
      view === 'week' ? addDays(mondayOf(a), 7 * delta) : `${shiftMonth(a.slice(0, 7), delta)}-01`,
    );

  const save = async () => {
    if (saving || !dirty) return;
    if (items.length === 0) {
      toast.error(t('dailyLog.emptyError'));
      return;
    }
    setSaving(true);
    // `base_edit_count` — засаж эхэлсэн хувилбар; хооронд нь өөр газраас (баруун доод тэмдэглэл, өөр таб) хадгалсан
    // бол сервер 409 STALE_LOG буцаана, хэн нэгний бичсэнийг чимээгүй дарахгүй.
    const put = (base: number | null) =>
      apiFetch(`/daily-work-logs/${date}`, { method: 'PUT', data: { items, base_edit_count: base } });
    try {
      try {
        await put(saved ? saved.edit_count : null);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 409 && e.code === 'STALE_LOG')) throw e;
        const current = (e.payload.log ?? null) as DailyLog | null;
        if (!window.confirm(t('dailyLog.conflictConfirm'))) {
          // Сервер дээрх хувилбарыг ачаална — хэрэглэгч дахин засна.
          setText(current?.items.length ? itemsToText(current.items) : '');
          await qc.invalidateQueries({ queryKey: [LOG_KEY] });
          toast.info(t('dailyLog.conflictLoaded'));
          return;
        }
        await put(current ? current.edit_count : null);
      }
      // Өдөр, календарийн муж, heatmap — бүгд нэг угтвар доор.
      await qc.invalidateQueries({ queryKey: [LOG_KEY] });
      toast.success(t('dailyLog.saved'));
    } catch (e) {
      toast.error(t('dailyLog.saveFailed'), e instanceof ApiError ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return;
    const next = continueNumbering(el.value, el.selectionStart);
    if (!next) return;
    e.preventDefault();
    setText(next.text);
    requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret));
  };

  const onFocus = () => {
    if (text.trim() === '') setText('1. ');
  };

  const byDate = useMemo(
    () => new Map((rangeQuery.data?.logs ?? []).map((l) => [l.log_date, l])),
    [rangeQuery.data],
  );
  const counts = useMemo(
    () => new Map((activityQuery.data?.days ?? []).map((d) => [d.date, d.count])),
    [activityQuery.data],
  );
  const itemsByDate = useMemo(
    () => new Map((activityQuery.data?.days ?? []).map((d) => [d.date, d.items ?? []])),
    [activityQuery.data],
  );
  const scale = useMemo(() => heatScale(counts.values()), [counts]);

  const monday = mondayOf(today);
  const week = rangeStats(counts, monday, addDays(monday, 6), today);
  const month = rangeStats(counts, `${today.slice(0, 7)}-01`, today, today);
  const year = rangeStats(counts, heatFrom, today, today);
  const lifetime = activityQuery.data?.lifetime ?? rangeQuery.data?.lifetime;
  const revisions = dayQuery.data?.revisions ?? [];

  const weekday = (d: string) => t(`dailyLog.weekday${weekdayOf(d)}`);

  return (
    <div className="space-y-4">
      <Card className="gap-3 border-border bg-card/60 py-4 backdrop-blur">
        <CardHeader className="px-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <NotebookPen className="h-5 w-5 text-primary" />
              {t('dailyLog.title')}
            </CardTitle>
            <CardDescription className="text-micro">{t('dailyLog.description')}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Kpi
              label={t('dailyLog.kpiWeek')}
              value={week.items}
              unit={t('dailyLog.unitItems')}
              sub={t('dailyLog.kpiDays', { days: week.logged })}
            />
            <Kpi
              label={t('dailyLog.kpiMonth')}
              value={month.items}
              unit={t('dailyLog.unitItems')}
              sub={t('dailyLog.kpiDays', { days: month.logged })}
            />
            <Kpi
              label={t('dailyLog.kpiYear')}
              value={year.items}
              unit={t('dailyLog.unitItems')}
              sub={t('dailyLog.kpiDays', { days: year.logged })}
            />
            <Kpi
              label={t('dailyLog.kpiLifetime')}
              value={lifetime?.days ?? 0}
              unit={t('dailyLog.unitDays')}
              sub={
                lifetime?.first_date
                  ? t('dailyLog.kpiSince', { since: lifetime.first_date })
                  : t('dailyLog.kpiNone')
              }
            />
          </dl>

          <section aria-labelledby="daily-log-heat-title">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3
                id="daily-log-heat-title"
                className="flex items-center gap-1.5 text-sm font-medium"
              >
                <Activity className="h-4 w-4 text-success" />
                {t('dailyLog.heatmapTitle')}
              </h3>
              <span className="text-micro text-muted-foreground">
                {t('dailyLog.heatmapSummary', { items: year.items, days: year.logged })}
              </span>
            </div>
            {activityQuery.isError ? (
              <p className="text-sm text-destructive">{t('dailyLog.loadFailed')}</p>
            ) : (
              <ActivityHeatmap
                today={today}
                counts={counts}
                itemsByDate={itemsByDate}
                scale={scale}
                selected={date}
                loading={activityQuery.isLoading}
                onPick={pickDate}
              />
            )}
          </section>
        </CardContent>
      </Card>

      <div className="@container">
        <div className="grid gap-4 @[52rem]:grid-cols-[minmax(0,1fr)_21rem] @[52rem]:items-start @[80rem]:grid-cols-[minmax(0,1fr)_26rem]">
          <LogCalendar
            className="order-2 @[52rem]:order-1"
            view={view}
            anchor={anchor}
            today={today}
            selected={date}
            byDate={byDate}
            logs={rangeQuery.data?.logs ?? []}
            range={range}
            digestPreset={digestPreset}
            onDigestPreset={setDigestPreset}
            scale={scale}
            loading={rangeQuery.isFetching}
            error={rangeQuery.isError}
            onViewChange={setView}
            onNavigate={navigate}
            onToday={() => pickDate(today)}
            onPick={pickDate}
          />

          <div
            ref={editorRef}
            className="order-1 scroll-mt-24 @[52rem]:sticky @[52rem]:top-4 @[52rem]:order-2"
          >
            <Card className="gap-3 border-border bg-card/60 py-4 backdrop-blur">
              <CardHeader className="px-4">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <span className="tabular-nums">{date}</span>
                  <span className="font-normal text-muted-foreground">{weekday(date)}</span>
                  {date === today && (
                    <Badge
                      variant="outline"
                      className="border-primary/40 bg-primary/10 text-primary"
                    >
                      {t('dailyLog.today')}
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Label htmlFor="daily-log-date" className="sr-only">
                    {t('dailyLog.date')}
                  </Label>
                  <Input
                    id="daily-log-date"
                    type="date"
                    value={date}
                    max={today}
                    onChange={(e) => pickDate(e.target.value)}
                    className="h-8 w-40"
                  />
                  {date !== today && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => pickDate(today)}
                    >
                      {t('dailyLog.today')}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 px-4">
                <div className="space-y-1">
                  <Label htmlFor="daily-log-text">{t('dailyLog.itemsLabel')}</Label>
                  <Textarea
                    id="daily-log-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={onKeyDown}
                    onFocus={onFocus}
                    rows={8}
                    placeholder={t('dailyLog.placeholder')}
                    disabled={dayQuery.isLoading}
                    className="font-mono text-sm leading-relaxed"
                  />
                  <p className="text-xs text-muted-foreground">{t('dailyLog.hint')}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button type="button" onClick={() => void save()} disabled={!dirty || saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
                    {t('dailyLog.save')}
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    {t('dailyLog.itemCount', { count: items.length })}
                  </span>
                  {dirty && saved && (
                    <span className="text-sm text-warning">{t('dailyLog.unsaved')}</span>
                  )}
                </div>

                {saved && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground border-t border-border pt-3">
                    <span>{t('dailyLog.savedAt', { at: formatDateTime(saved.updated_at) })}</span>
                    {saved.edit_count > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setHistoryOpen(true)}
                      >
                        <History className="h-3.5 w-3.5 mr-1" />
                        {t('dailyLog.editedTimes', { count: saved.edit_count })}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('dailyLog.historyTitle', { date })}</DialogTitle>
            <DialogDescription>{t('dailyLog.historyDesc')}</DialogDescription>
          </DialogHeader>
          <DialogScrollableBody className="space-y-4">
            {saved && (
              <section>
                <p className="text-xs font-medium text-success mb-1">
                  {t('dailyLog.historyCurrent', { at: formatDateTime(saved.updated_at) })}
                </p>
                <ol className="list-decimal pl-5 text-sm space-y-0.5">
                  {saved.items.map((it, i) => (
                    <li key={i} className="break-words">
                      {it}
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {revisions.map((r, idx) => (
              <section key={idx} className="border-t border-border pt-3">
                <p className="text-xs text-muted-foreground mb-1">
                  {t('dailyLog.historyVersion', {
                    from: formatDateTime(r.valid_from),
                    to: formatDateTime(r.replaced_at),
                  })}
                </p>
                <ol className="list-decimal pl-5 text-sm space-y-0.5 text-muted-foreground">
                  {r.items.map((it, i) => (
                    <li key={i} className="break-words">
                      {it}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </DialogScrollableBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
