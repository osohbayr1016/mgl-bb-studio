import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';
import {
  HEAT_BG,
  HEAT_WEEKS as WEEKS,
  addDays,
  heatLevel,
  heatRanges,
  heatmapColumns,
  monthStarts,
  weekdayOf,
  type HeatScale,
} from './lib';
import { DayHoverCard } from './DayHoverCard';
import { useDayHover } from './useDayHover';

/**
 * GitHub-ын «contributions» шиг жилийн идэвхийн тор: нүд бүр нэг өдөр, өнгө
 * нь тухайн өдөр ДУГААРЛАЖ бичсэн ажлын тоо (олон бол тод).  Дарахад тэр өдөр
 * сонгогдож календарь, засварлагч тийш шилжинэ.
 *
 * 371 нүд тул нүд бүр товч БИШ — товшилт, hover нь торон дээр нэг handler-аар
 * (`data-date`).  Гараар: тор дээр фокуслаад сумаар хөдөлж Enter-ээр нээнэ.
 * Hover (эсвэл гарын курсор) нь тэр өдрийн ажлыг хөвөгч картаар харуулна
 * (`itemsByDate` өгсөн бол бичвэртэй, эс бөгөөс зөвхөн тоо).
 */

interface Props {
  /** Торын сүүлийн өдөр (энэнээс хойших нүд хоосон). */
  today: string;
  counts: ReadonlyMap<string, number>;
  /** Hover картад харуулах өдрийн ажлууд. */
  itemsByDate?: ReadonlyMap<string, readonly string[]>;
  scale: HeatScale;
  selected?: string | null;
  loading: boolean;
  onPick?: (date: string) => void;
}

export default function ActivityHeatmap({
  today,
  counts,
  itemsByDate,
  scale,
  selected = null,
  loading,
  onPick,
}: Props) {
  const infoId = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const { hover, onMouseMove, onMouseLeave, showAt } = useDayHover();
  const { t } = useLanguage();
  const columns = useMemo(() => heatmapColumns(today, WEEKS), [today]);
  const first = columns[0]![0]!;
  // Баруун ирмэгт ойрхон шошго хайрцгаас хальж хэвтээ гүйлгэгч гаргадаг —
  // сүүлийн 2 баганад эхэлсэн сарын шошгыг (GitHub шиг) орхино.
  const labels = useMemo(() => monthStarts(columns).filter((l) => l.col <= WEEKS - 3), [columns]);

  const [cursor, setCursor] = useState<string | null>(null);
  const pickable = !!onPick;

  // Гарын курсор хөдлөхөд картыг тэр нүдэн дээр харуулна.
  const moveCursor = (d: string) => {
    setCursor(d);
    showAt(gridRef.current?.querySelector(`[data-date="${d}"]`) ?? null, d);
  };

  // Нарийн дэлгэц дээр тор хэвтээ гүйлгэгдэнэ — GitHub шиг ХАМГИЙН СҮҮЛИЙН
  // долоо хоногууд (баруун ирмэг) харагдаж эхэлнэ.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Табаар далд байснаас нээгдэх, цонхны хэмжээ солигдох үед ч (өргөн 0 → N).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const toEnd = () => {
      el.scrollLeft = el.scrollWidth;
    };
    toEnd();
    const ro = new ResizeObserver(toEnd);
    ro.observe(el);
    return () => ro.disconnect();
  }, [today]);

  const describe = (d: string) => {
    const c = counts.get(d) ?? 0;
    const wd = t(`dailyLog.weekday${weekdayOf(d)}`);
    return c > 0
      ? t('dailyLog.heatCell', { date: d, weekday: wd, count: c })
      : t('dailyLog.heatCellEmpty', { date: d, weekday: wd });
  };

  // Нүднүүдийн мод зөвхөн өгөгдөл/сонголт солигдоход дахин үүснэ — hover нь
  // зөвхөн доорх мэдээллийн мөрийг шинэчилнэ.
  const grid = useMemo(
    () =>
      columns.map((week) => (
        <div key={week[0]} className="grid grid-rows-7 gap-[3px]">
          {week.map((d) => {
            if (d > today || d < first) return <div key={d} className="aspect-square" />;
            const c = counts.get(d) ?? 0;
            return (
              <div
                key={d}
                data-date={d}
                className={cn(
                  'aspect-square rounded-[3px] transition-[box-shadow,transform] hover:scale-125 hover:ring-1 hover:ring-foreground/40',
                  pickable && 'cursor-pointer',
                  HEAT_BG[heatLevel(c, scale)],
                  d === selected && 'ring-2 ring-primary ring-offset-1 ring-offset-card',
                  d === cursor && d !== selected && 'ring-2 ring-foreground',
                  d === today && d !== selected && d !== cursor && 'ring-1 ring-foreground/50',
                )}
              />
            );
          })}
        </div>
      )),
    [columns, counts, scale, selected, cursor, today, first, pickable],
  );

  const dateAt = (e: MouseEvent) =>
    (e.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date ?? null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[e.key];
    const base = cursor ?? selected ?? today;
    if (step !== undefined) {
      e.preventDefault();
      const next = addDays(base, step);
      if (next >= first && next <= today) moveCursor(next);
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && onPick) {
      e.preventDefault();
      onPick(base);
    }
  };

  const info = hover?.date ?? cursor ?? selected ?? today;
  const hoverDate = hover?.date ?? null;

  return (
    <div className={cn('space-y-2', loading && 'opacity-60')}>
      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <div className="flex min-w-[46rem] gap-2">
          {/* Гарагийн шошго — Да, Лх, Ба (GitHub-ын Mon/Wed/Fri). */}
          <div className="flex w-6 shrink-0 flex-col pt-5">
            <div className="grid flex-1 grid-rows-7 gap-[3px] text-micro text-muted-foreground">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span key={i} className="flex items-center leading-none">
                  {i % 2 === 0 && i < 6 ? t(`dailyLog.weekdayShort${(i + 1) % 7}`) : ''}
                </span>
              ))}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="relative mb-1 h-4 text-micro text-muted-foreground" aria-hidden="true">
              {labels.map(({ col, month }) => (
                <span
                  key={col}
                  className="absolute top-0 whitespace-nowrap leading-none"
                  style={{ left: `${(col / WEEKS) * 100}%` }}
                >
                  {t(`dailyLog.month${month}`)}
                </span>
              ))}
            </div>
            <div
              ref={gridRef}
              role="grid"
              tabIndex={0}
              aria-label={t('dailyLog.heatmapAria')}
              aria-describedby={infoId}
              className="grid gap-[3px] rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
              onClick={(e) => {
                const d = dateAt(e);
                if (d && onPick) {
                  moveCursor(d);
                  onPick(d);
                }
              }}
              onMouseMove={onMouseMove}
              onMouseLeave={onMouseLeave}
              onKeyDown={onKeyDown}
              // Курсор зөвхөн фокустай үед: фокус авахад сонгосон өдрөөс эхэлнэ.
              // Хулганаар дарж фокуслоход карт hover-ийг дагана; зөвхөн гараар
              // (`:focus-visible`) орсон үед сонгосон өдөр дээр гарна.
              onFocus={(e) =>
                e.currentTarget.matches(':focus-visible')
                  ? moveCursor(selected ?? today)
                  : setCursor(selected ?? today)
              }
              onBlur={() => {
                setCursor(null);
                showAt(null, null);
              }}
            >
              {grid}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-micro text-muted-foreground">
        <span id={infoId} aria-live="polite" className="tabular-nums">
          {describe(info)}
        </span>
        <span className="flex items-center gap-1">
          {t('dailyLog.heatLess')}
          {heatRanges(scale).map((r) => (
            <span
              key={r.level}
              title={
                r.to === 0
                  ? t('dailyLog.heatLegendNone')
                  : r.to === null
                    ? t('dailyLog.heatLegendPlus', { from: r.from })
                    : r.from === r.to
                      ? t('dailyLog.itemCount', { count: r.from })
                      : t('dailyLog.heatLegendRange', { from: r.from, to: r.to })
              }
              className={cn('size-3 rounded-[3px]', HEAT_BG[r.level])}
            />
          ))}
          {t('dailyLog.heatMore')}
        </span>
      </div>

      <DayHoverCard
        hover={hover}
        count={hoverDate ? (counts.get(hoverDate) ?? 0) : 0}
        items={hoverDate ? itemsByDate?.get(hoverDate) : undefined}
      />
    </div>
  );
}
