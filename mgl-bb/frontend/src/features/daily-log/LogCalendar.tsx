import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';
import { Button } from '@/ui/button';
import {
  DIGEST_PRESETS,
  HEAT_BG,
  heatLevel,
  isWeekend,
  mondayOf,
  monthGrid,
  weekDates,
  weekdayOf,
  type DigestLog,
  type DigestPreset,
  type HeatScale,
} from './lib';
import LogDigest from './LogDigest';
import { DayHoverCard } from './DayHoverCard';
import { useDayHover } from './useDayHover';

/**
 * Өдрийн тайлангийн календарь.  «7 хоног» харагдац нь долоо хоногийн өдөр
 * бүрийн ажлыг ШУУД харуулна (дарж нээх шаардлагагүй); «Сар» нь сарын тор,
 * нүд бүрд ажлын тоо (heatmap-тай ижил өнгө) ба эхний ажлууд, hover хийхэд
 * тэр өдрийн бүх ажил; «Нэгтгэл» нь сонгосон хугацаанд НИЙТ юу хийснийг
 * өдрөөр бүлэглэж жагсаана (`LogDigest`).
 *
 * Өргөнийг viewport БИШ, `@container`-оор хэмжинэ — профайлын хажуугийн цэс,
 * засварлагчийн багана хоёр хуудасны өргөнийг ихээхэн багасгадаг.
 */

export type CalendarView = 'week' | 'month' | 'digest';

export interface CalendarLog extends DigestLog {
  log_date: string;
  items: string[];
}

const VIEWS: readonly CalendarView[] = ['week', 'month', 'digest'];
const VIEW_LABEL: Record<CalendarView, string> = {
  week: 'dailyLog.viewWeek',
  month: 'dailyLog.viewMonth',
  digest: 'dailyLog.viewDigest',
};

interface Props {
  view: CalendarView;
  anchor: string;
  today: string;
  selected: string;
  byDate: ReadonlyMap<string, CalendarLog>;
  /** «Нэгтгэл» харагдацын мөрүүд (шинээс хуучин руу) ба муж. */
  logs: readonly CalendarLog[];
  range: { from: string; to: string };
  digestPreset: DigestPreset;
  onDigestPreset: (p: DigestPreset) => void;
  scale: HeatScale;
  loading: boolean;
  error: boolean;
  onViewChange: (v: CalendarView) => void;
  onNavigate: (delta: number) => void;
  onToday: () => void;
  onPick: (date: string) => void;
  className?: string;
}

const dayNum = (d: string) => String(Number(d.slice(8, 10)));

export default function LogCalendar(props: Props) {
  const {
    view,
    anchor,
    today,
    loading,
    error,
    onViewChange,
    onNavigate,
    onToday,
    className,
    digestPreset,
    onDigestPreset,
    range,
  } = props;
  const { t } = useLanguage();

  const isCurrent =
    view === 'week'
      ? mondayOf(anchor) === mondayOf(today)
      : anchor.slice(0, 7) === today.slice(0, 7);
  const canNext =
    view === 'week' ? mondayOf(anchor) < mondayOf(today) : anchor.slice(0, 7) < today.slice(0, 7);

  let title: string;
  if (view === 'week') {
    const days = weekDates(anchor);
    title = t('dailyLog.weekRange', {
      from: days[0]!.slice(5).replace('-', '.'),
      to: days[6]!.slice(5).replace('-', '.'),
    });
  } else {
    title = t('dailyLog.monthLabel', { y: anchor.slice(0, 4), m: Number(anchor.slice(5, 7)) });
  }

  return (
    <Card className={cn('@container gap-3 border-border bg-card/60 py-4 backdrop-blur', className)}>
      {/* Нэг мөр: гарчиг · ‹ хугацаа › · энэ 7 хоног/өнөөдөр · харагдацын сэлгүүр
          (нарийн үед мөр дамжина). */}
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <CardTitle className="mr-1 flex items-center gap-2 text-base">
            <CalendarDays className="h-5 w-5 text-primary" />
            <span className="sr-only @[40rem]:not-sr-only">{t('dailyLog.calendarTitle')}</span>
          </CardTitle>
          {view === 'digest' ? (
            <div className="flex flex-wrap items-center gap-1">
              {DIGEST_PRESETS.map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="xs"
                  variant={digestPreset === p ? 'secondary' : 'ghost'}
                  aria-pressed={digestPreset === p}
                  className="px-2.5"
                  onClick={() => onDigestPreset(p)}
                >
                  {t(`dailyLog.digestPreset_${p}`)}
                </Button>
              ))}
              <span className="px-1 text-micro tabular-nums text-muted-foreground">
                {range.from} – {range.to}
              </span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={t(view === 'week' ? 'dailyLog.prevWeek' : 'dailyLog.prevMonth')}
                  onClick={() => onNavigate(-1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-28 text-center text-sm font-medium tabular-nums">
                  {title}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={t(view === 'week' ? 'dailyLog.nextWeek' : 'dailyLog.nextMonth')}
                  disabled={!canNext}
                  onClick={() => onNavigate(1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              {isCurrent ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">
                  {t(view === 'week' ? 'dailyLog.thisWeek' : 'dailyLog.thisMonth')}
                </span>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={onToday}>
                  {t('dailyLog.today')}
                </Button>
              )}
            </>
          )}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <div
            role="radiogroup"
            aria-label={t('dailyLog.calendarTitle')}
            className="ml-auto inline-flex rounded-md border border-border bg-background/60 p-0.5"
          >
            {VIEWS.map((v) => (
              <Button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                variant={view === v ? 'secondary' : 'ghost'}
                size="xs"
                className="px-3"
                onClick={() => onViewChange(v)}
              >
                {t(VIEW_LABEL[v])}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4">
        {error ? (
          <p className="text-sm text-destructive">{t('dailyLog.loadFailed')}</p>
        ) : view === 'week' ? (
          <WeekView {...props} />
        ) : view === 'month' ? (
          <MonthView {...props} />
        ) : (
          <div className="max-h-[36rem] overflow-y-auto pr-1">
            <LogDigest logs={props.logs} from={range.from} to={range.to} onPickDay={props.onPick} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Нүдний товчны нийтлэг классууд — `@/ui/button`-ы хэмжээг бүрэн дарна. */
const CELL_BTN =
  'h-auto w-full min-w-0 items-stretch justify-start whitespace-normal p-0 text-left font-normal pointer-coarse:h-auto has-[>svg]:p-0 motion-safe:active:scale-100';

function CountChip({ count, scale }: { count: number; scale: HeatScale }) {
  const level = heatLevel(count, scale);
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-micro font-semibold tabular-nums',
        HEAT_BG[level],
        level >= 3 ? 'text-success-foreground' : 'text-foreground',
      )}
    >
      {count}
    </span>
  );
}

/**
 * Нарийн (жагсаалт) горимд өдөр бүр ≤ 3 мөр: 3-аас олон ажилтай бол эхний 2 +
 * «+N ажил» — 7 хоног бүхэлдээ нэг дэлгэцэнд багтана.  Бүтэн жагсаалт нь
 * засварлагчид (өдрөө дарахад), өргөн (7 багана) горимд бүгд харагдана.
 */
const NARROW_MAX_LINES = 3;

function WeekView({ anchor, today, selected, byDate, scale, onPick }: Props) {
  const { t } = useLanguage();
  const days = weekDates(anchor);

  return (
    <ol className="grid gap-1.5 @[44rem]:grid-cols-7 @[44rem]:gap-2">
      {days.map((d) => {
        const log = byDate.get(d);
        const items = log?.items ?? [];
        const future = d > today;
        const weekend = isWeekend(d);
        const narrowShown = items.length > NARROW_MAX_LINES ? NARROW_MAX_LINES - 1 : items.length;
        return (
          <li key={d} className="min-w-0">
            <Button
              type="button"
              variant="ghost"
              disabled={future}
              aria-pressed={d === selected}
              title={d}
              onClick={() => onPick(d)}
              className={cn(
                CELL_BTN,
                'flex gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-1.5 hover:bg-accent/40 @[44rem]:h-full @[44rem]:min-h-56 @[44rem]:flex-col @[44rem]:gap-2 @[44rem]:px-2 @[44rem]:py-2',
                weekend && !items.length && 'bg-muted/30',
                d === today && 'border-primary/50',
                d === selected && 'border-primary ring-2 ring-primary/40',
              )}
            >
              <span className="flex w-14 shrink-0 flex-col @[44rem]:w-full @[44rem]:flex-row @[44rem]:items-center @[44rem]:justify-between">
                <span className="flex items-baseline gap-1.5">
                  <span
                    className={cn(
                      'text-lg font-semibold tabular-nums leading-none',
                      d === today && 'text-primary',
                    )}
                  >
                    {dayNum(d)}
                  </span>
                  <span className="text-micro text-muted-foreground">
                    {t(`dailyLog.weekdayShort${weekdayOf(d)}`)}
                  </span>
                </span>
                {items.length > 0 && (
                  <span className="mt-1 @[44rem]:mt-0">
                    <CountChip count={items.length} scale={scale} />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                {items.length > 0 ? (
                  // Товч дотор `<ol>` хүчингүй HTML тул дугаарыг гараар.
                  <span className="block space-y-0.5 text-sm @[44rem]:max-h-72 @[44rem]:overflow-y-auto @[44rem]:text-micro">
                    {items.map((it, i) => (
                      <span
                        key={i}
                        className={cn('flex gap-1', i >= narrowShown && 'hidden @[44rem]:flex')}
                      >
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {i + 1}.
                        </span>
                        <span className="min-w-0 truncate @[44rem]:overflow-visible @[44rem]:break-words @[44rem]:whitespace-normal">
                          {it}
                        </span>
                      </span>
                    ))}
                    {narrowShown < items.length && (
                      <span className="block text-micro text-muted-foreground @[44rem]:hidden">
                        {t('dailyLog.moreItems', { count: items.length - narrowShown })}
                      </span>
                    )}
                  </span>
                ) : future ? (
                  <span className="text-micro text-muted-foreground/60">—</span>
                ) : weekend ? (
                  <span className="text-micro text-muted-foreground">{t('dailyLog.weekend')}</span>
                ) : (
                  <span
                    className={cn(
                      'text-sm italic',
                      d === today ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    {d === today ? t('dailyLog.todayNotWritten') : t('dailyLog.notWritten')}
                  </span>
                )}
              </span>
            </Button>
          </li>
        );
      })}
    </ol>
  );
}

function MonthView({ anchor, today, selected, byDate, scale, onPick }: Props) {
  const { t } = useLanguage();
  const ym = anchor.slice(0, 7);
  const rows = monthGrid(ym);
  // Hover хийхэд тэр өдрийн БҮХ ажил (нүдэнд эхний 2 л багтана).
  const { hover, onMouseMove, onMouseLeave } = useDayHover();
  const hovered = hover ? byDate.get(hover.date) : undefined;

  return (
    <div onMouseMove={onMouseMove} onMouseLeave={onMouseLeave}>
      <DayHoverCard
        hover={hover && hover.date <= today ? hover : null}
        count={hovered?.items.length ?? 0}
        items={hovered?.items}
      />
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-micro font-medium text-muted-foreground">
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
          <span key={wd}>{t(`dailyLog.weekdayShort${wd}`)}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {rows.flat().map((d) => {
          const inMonth = d.slice(0, 7) === ym;
          const items = byDate.get(d)?.items ?? [];
          const future = d > today;
          const weekend = isWeekend(d);
          return (
            <Button
              key={d}
              type="button"
              variant="ghost"
              disabled={future}
              aria-pressed={d === selected}
              aria-label={`${d} ${t('dailyLog.itemCount', { count: items.length })}`}
              data-date={d}
              onClick={() => onPick(d)}
              className={cn(
                CELL_BTN,
                'flex min-h-14 flex-col gap-1 rounded-md border border-border/60 bg-background/40 p-1.5 hover:bg-accent/40 @[40rem]:min-h-20',
                !inMonth && 'opacity-45',
                weekend && !items.length && 'bg-muted/30',
                d === today && 'border-primary/60',
                d === selected && 'border-primary ring-2 ring-primary/40',
              )}
            >
              <span className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    'text-sm font-semibold tabular-nums leading-none',
                    d === today && 'text-primary',
                  )}
                >
                  {dayNum(d)}
                </span>
                {items.length > 0 && <CountChip count={items.length} scale={scale} />}
              </span>
              {items.length > 0 && (
                <span className="hidden min-w-0 space-y-0.5 @[40rem]:block">
                  {items.slice(0, 2).map((it, i) => (
                    <span key={i} className="block truncate text-micro text-muted-foreground">
                      {i + 1}. {it}
                    </span>
                  ))}
                  {items.length > 2 && (
                    <span className="block text-micro text-muted-foreground/80">
                      {t('dailyLog.moreItems', { count: items.length - 2 })}
                    </span>
                  )}
                </span>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
