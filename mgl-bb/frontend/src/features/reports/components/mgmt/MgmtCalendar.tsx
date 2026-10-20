import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { m, useReducedMotion } from 'motion/react';
import { ArrowLeft, ChevronLeft, ChevronRight, Plus, RotateCcw, Search, X } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { useAuth } from '@/shared/context/AuthContext';
import { cn } from '@/shared/lib/utils';
import { EASE_OUT } from '@/shared/lib/motion';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Skeleton } from '@/ui/skeleton';
import { weekdayOf } from '@/features/daily-log/lib';
import { openDailyNote } from '@/features/daily-log/dailyNoteEvents';
import { DayHoverCard } from '@/features/daily-log/DayHoverCard';
import { useDayHover } from '@/features/daily-log/useDayHover';
import { useManagementLogs } from '../../api';
import {
  canGoNext,
  cellKey,
  containsToday,
  fetchWindow,
  indexDays,
  matchesQuery,
  shiftCursor,
  stepDay,
  viewDates,
  writersOn,
  calTotals,
  type CalTotals,
  type CalView,
} from '../../lib/mgmtCalendar';
import { highlightParts } from '../../lib/mgmtJournal';
import { useUbToday } from '../../lib/useUbToday';
import { MgmtAvatar } from './MgmtAvatar';
import { MgmtDayDialog, type CalPerson } from './MgmtDayDialog';

const WEEK_PREVIEW = 2;
const MONTH_PREVIEW = 3;
const MONTH_AVATARS = 5;
/** Нэр · Да–Ба өргөн · Бя/Ня нарийн (амралтын өдөр ихэнхдээ хоосон — бичвэрт зай үлдээнэ). */
const GRID_COLS = 'var(--cal-name) repeat(5, minmax(0, 1fr)) repeat(2, minmax(0, 0.5fr))';
/** Даваа … Ням (`weekdayOf`: 0 = Ням). */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * «Тайлан → Менежментийн багийн тайлан» — КАЛЕНДАРЬ (2026-10-08).
 * Эзэн: урт бичвэрийн дундаас тухайн хүний тухайн өдрийн тайланг олох нь
 * замбараагүй → «7 хоног»: мөр = хүн, багана = өдөр, нүдэнд тэр хүний тэр өдрийн
 * ажил; «Сар»: сарын календарь (бүгд — өдөр бүр хэн бичсэн; нэг хүн — түүний ажил).
 * Нүд дээр дарахад бүтэн тайлан цонхонд.  Хувь, хоцролт, «бичээгүй», цаг ЗОРИУД
 * байхгүй — баг тайван, юу хийснээ л тэмдэглэнэ.  URL: `?cv=week|month&cd=&who=`.
 */
export function MgmtCalendar({ onMember }: { onMember: (id: number) => void }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const reduce = useReducedMotion();
  const [today] = useUbToday();
  const [sp, setSp] = useSearchParams();

  const view: CalView = sp.get('cv') === 'month' ? 'month' : 'week';
  const cdRaw = sp.get('cd');
  const cursor = cdRaw && /^\d{4}-\d{2}-\d{2}$/.test(cdRaw) && cdRaw <= today ? cdRaw : today;
  const whoRaw = Number(sp.get('who'));
  const who = Number.isFinite(whoRaw) && whoRaw > 0 ? whoRaw : null;
  const patch = (next: Record<string, string | null>) =>
    setSp(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(next)) {
          if (v == null) p.delete(k);
          else p.set(k, v);
        }
        return p;
      },
      { replace: true },
    );

  const [q, setQ] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<{ date: string; userId: number | null } | null>(null);

  const win = fetchWindow(view, cursor, today);
  const query = useManagementLogs(win.window, win.anchor);
  const data = query.data;

  // Захирал (CEO) энэ тайланг уншигч — жагсаалтад орохгүй (эзэн 2026-10-08).
  const people: CalPerson[] = useMemo(
    () =>
      (data?.members ?? [])
        .filter((x) => !x.is_ceo)
        .map((x) => ({
          user_id: x.user_id,
          name: x.name,
          position: x.position,
        })),
    [data],
  );
  const selected = who != null ? people.find((p) => p.user_id === who) : undefined;
  const rows = selected ? [selected] : people;
  const order = rows.map((p) => p.user_id);
  const index = useMemo(() => indexDays(data?.days ?? []), [data]);
  const grid = viewDates(view, cursor);
  const flat = grid.flat();
  const month = cursor.slice(0, 7);
  const shownDates = flat.filter((d) => d <= today && (view === 'week' || d.startsWith(month)));
  const totals = calTotals(index, order, shownDates);

  // «/» — хайлт руу.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = (dir: -1 | 1) => patch({ cd: shiftCursor(view, cursor, dir, today) });
  const rangeLabel =
    view === 'week'
      ? `${fmtMd(flat[0]!)} – ${fmtMd(flat[6]!)}`
      : t('mgmtLogs.calMonthLabel', { y: month.slice(0, 4), m: Number(month.slice(5)) });
  const canWrite = !!user && user.role === 'admin' && !user.is_support;

  const openCell = (date: string, userId: number | null) => setOpen({ date, userId });
  const dialogPeople = open?.userId != null ? [open.userId] : order;

  return (
    <div id="sec-reports-mgmt" className="scroll-mt-24 space-y-4">
      {/* Толгой: гарчиг + хайлт + нэмэх */}
      <m.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE_OUT }}
        className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3"
      >
        <div className="min-w-0">
          {selected ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => patch({ who: null })}
                className="rounded-lg"
                data-cal-all=""
              >
                <ArrowLeft /> {t('mgmtLogs.calShowAll')}
              </Button>
              <div className="mt-3 flex items-center gap-3">
                <MgmtAvatar userId={selected.user_id} name={selected.name} size="lg" />
                <div className="min-w-0">
                  <h2 className="text-title leading-tight font-semibold break-words">
                    {selected.name}
                  </h2>
                  {selected.position && (
                    <p className="text-sm text-muted-foreground">{selected.position}</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <h2 className="text-title font-semibold">{t('mgmtLogs.jTeam')}</h2>
          )}
          <div
            className="mt-2 flex flex-wrap items-baseline gap-x-2 text-3xl leading-tight font-semibold tracking-tight tabular-nums"
            data-cal-summary=""
          >
            {data ? (
              selected ? (
                <>
                  <span>{totals.items}</span>
                  <span className="text-lg font-normal text-muted-foreground">
                    {t('mgmtLogs.calItemsUnit')} ·
                  </span>
                  <span>{totals.byPerson.get(selected.user_id)?.days ?? 0}</span>
                  <span className="text-lg font-normal text-muted-foreground">
                    {t('mgmtLogs.calWordDays')}
                  </span>
                </>
              ) : (
                <>
                  <span>{totals.people}</span>
                  <span className="text-lg font-normal text-muted-foreground">
                    {t('mgmtLogs.calWordPeople')} ·
                  </span>
                  <span>{totals.items}</span>
                  <span className="text-lg font-normal text-muted-foreground">
                    {t('mgmtLogs.calWordNoted')}
                  </span>
                </>
              )
            ) : (
              <Skeleton className="h-8 w-56" />
            )}
          </div>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQ('');
              }}
              placeholder={t('mgmtLogs.jSearch')}
              aria-label={t('mgmtLogs.jSearch')}
              className="h-10 rounded-xl pr-9 pl-9"
            />
            {q && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setQ('')}
                aria-label={t('mgmtLogs.jClear')}
                className="absolute top-1/2 right-2 -translate-y-1/2"
              >
                <X />
              </Button>
            )}
          </div>
          {canWrite && (
            <Button type="button" className="h-10 shrink-0 rounded-xl" onClick={openDailyNote}>
              <Plus className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{t('mgmtLogs.jAddMine')}</span>
            </Button>
          )}
        </div>
      </m.section>

      {/* Хэрэгслийн мөр: 7 хоног / Сар · ◀ огноо ▶ · Өнөөдөр · хүн */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" className="inline-flex rounded-xl bg-muted p-1">
          {(['week', 'month'] as const).map((v) => (
            <Button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              variant="ghost"
              size="sm"
              onClick={() => patch({ cv: v === 'week' ? null : v })}
              className={cn(
                'h-8 rounded-lg px-3 pointer-coarse:h-9',
                view === v
                  ? 'bg-card text-foreground shadow-sm hover:bg-card'
                  : 'text-muted-foreground',
              )}
            >
              {v === 'week' ? t('mgmtLogs.calWeek') : t('mgmtLogs.calMonth')}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => go(-1)}
            aria-label={t('mgmtLogs.calPrev')}
          >
            <ChevronLeft />
          </Button>
          <span
            className="min-w-[8.5rem] text-center text-sm font-semibold tabular-nums"
            data-cal-label=""
          >
            {rangeLabel}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => go(1)}
            disabled={!canGoNext(view, cursor, today)}
            aria-label={t('mgmtLogs.calNext')}
          >
            <ChevronRight />
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-lg"
          disabled={containsToday(view, cursor, today)}
          onClick={() => patch({ cd: null })}
        >
          {t('mgmtLogs.calToday')}
        </Button>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-[28rem] rounded-2xl" />
      ) : query.isError || !data ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-card py-12 shadow-apple">
          <p className="text-sm text-destructive">{t('mgmtLogs.loadFailed')}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            <RotateCcw className="h-3.5 w-3.5" /> {t('mgmtLogs.captureRetry')}
          </Button>
        </div>
      ) : (
        <m.div
          key={`${view}|${flat[0]}|${who ?? 'all'}`}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
          className={cn('transition-opacity', query.isFetching && 'opacity-70')}
        >
          {view === 'week' ? (
            <WeekGrid
              dates={flat}
              rows={rows}
              index={index}
              totals={totals}
              today={today}
              q={q}
              onCell={openCell}
              onPerson={(id) => patch({ who: String(id) })}
            />
          ) : (
            <MonthGrid
              grid={grid}
              month={month}
              people={people}
              order={order}
              single={who != null}
              index={index}
              today={today}
              q={q}
              onDay={(date) => openCell(date, who)}
            />
          )}
        </m.div>
      )}

      {open && (
        <MgmtDayDialog
          open
          date={open.date}
          userId={open.userId}
          people={people}
          index={index}
          query={q}
          prevDate={stepDay(
            index,
            flat.filter((d) => d <= today),
            open.date,
            -1,
            dialogPeople,
          )}
          nextDate={stepDay(
            index,
            flat.filter((d) => d <= today),
            open.date,
            1,
            dialogPeople,
          )}
          onNav={(date) => setOpen({ ...open, date })}
          onMember={(id) => {
            setOpen(null);
            onMember(id);
          }}
          onPerson={(id) => {
            setOpen(null);
            patch({ who: String(id) });
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

function fmtMd(date: string): string {
  return `${Number(date.slice(5, 7))}.${Number(date.slice(8))}`;
}

function Marked({ text, q }: { text: string; q: string }) {
  return (
    <>
      {highlightParts(text, q).map((p, k) =>
        p.hit ? (
          <mark key={k} className="rounded-sm bg-warning/30 px-0.5 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={k}>{p.text}</span>
        ),
      )}
    </>
  );
}

/* ---------------- 7 хоног: мөр = хүн, багана = өдөр ---------------- */

/** Нүдэнд харагдах ажил: хайлттай үед тохирсон нь эхэнд. */
function previewItems(items: readonly string[], q: string, n: number): string[] {
  if (!q.trim()) return items.slice(0, n);
  const hit = items.filter((it) => matchesQuery([it], q));
  return [...hit, ...items.filter((it) => !hit.includes(it))].slice(0, n);
}

function WeekGrid({
  dates,
  rows,
  index,
  totals,
  today,
  q,
  onCell,
  onPerson,
}: {
  dates: readonly string[];
  rows: readonly CalPerson[];
  index: ReadonlyMap<string, readonly string[]>;
  totals: CalTotals;
  today: string;
  q: string;
  onCell: (date: string, userId: number) => void;
  onPerson: (id: number) => void;
}) {
  const { t } = useLanguage();
  const { hover, onMouseMove, onMouseLeave } = useDayHover();
  const hoverPerson = hover ? rows.find((p) => String(p.user_id) === hover.key) : undefined;
  const hoverItems =
    hoverPerson && hover ? index.get(cellKey(hoverPerson.user_id, hover.date)) : undefined;
  return (
    <div className="overflow-x-auto rounded-2xl bg-card shadow-apple">
      <div
        className="grid min-w-[52rem] [--cal-name:4.25rem] sm:min-w-[60rem] sm:[--cal-name:13rem]"
        style={{ gridTemplateColumns: GRID_COLS }}
        role="grid"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        {/* Толгой мөр */}
        <div className="sticky left-0 z-20 border-b border-border bg-card" />
        {dates.map((date) => {
          const isToday = date === today;
          const wd = weekdayOf(date);
          const day = totals.byDate.get(date);
          return (
            <div
              key={date}
              role="columnheader"
              className={cn(
                'min-w-0 border-b border-l border-border px-3 py-2.5',
                (wd === 0 || wd === 6) && 'bg-muted/30',
              )}
            >
              <p
                className={cn(
                  'truncate text-micro text-muted-foreground',
                  isToday && 'text-primary',
                )}
              >
                {t(`dailyLog.weekday${wd}`)}
              </p>
              <p
                className={cn(
                  'mt-0.5 inline-grid min-w-7 place-items-center rounded-full px-1.5 text-sm font-semibold tabular-nums',
                  isToday && 'bg-primary text-primary-foreground',
                )}
              >
                {fmtMd(date)}
              </p>
              <p className="mt-1 h-4 truncate text-micro tabular-nums text-muted-foreground">
                {day && day.items > 0
                  ? t('mgmtLogs.calDaySum', { people: day.people, items: day.items })
                  : ''}
              </p>
            </div>
          );
        })}

        {/* Хүн бүр нэг мөр */}
        {rows.map((p) => (
          <WeekRow
            key={p.user_id}
            person={p}
            sum={totals.byPerson.get(p.user_id)}
            dates={dates}
            index={index}
            today={today}
            q={q}
            onCell={onCell}
            onPerson={onPerson}
          />
        ))}
      </div>
      <DayHoverCard
        hover={hoverItems ? hover : null}
        title={hoverPerson?.name}
        count={hoverItems?.length ?? 0}
        items={hoverItems}
      />
    </div>
  );
}

function WeekRow({
  person: p,
  sum,
  dates,
  index,
  today,
  q,
  onCell,
  onPerson,
}: {
  person: CalPerson;
  sum: { items: number; days: number } | undefined;
  dates: readonly string[];
  index: ReadonlyMap<string, readonly string[]>;
  today: string;
  q: string;
  onCell: (date: string, userId: number) => void;
  onPerson: (id: number) => void;
}) {
  const { t } = useLanguage();
  const items = sum?.items ?? 0;
  return (
    <>
      <div
        role="rowheader"
        className="sticky left-0 z-10 border-b border-border bg-card px-2.5 py-3 sm:px-3.5"
      >
        <m.button
          type="button"
          onClick={() => onPerson(p.user_id)}
          className="flex w-full items-start gap-2.5 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
          title={[p.name, p.position].filter(Boolean).join(' · ')}
        >
          <span className="flex shrink-0 flex-col items-center gap-1">
            <MgmtAvatar userId={p.user_id} name={p.name} />
            {items > 0 && (
              <span className="text-micro font-semibold tabular-nums text-muted-foreground sm:hidden">
                {items}
              </span>
            )}
          </span>
          <span className="hidden min-w-0 flex-1 sm:block">
            <span className="line-clamp-2 text-sm leading-tight font-semibold break-words">
              {p.name}
            </span>
            {p.position && (
              <span className="mt-0.5 block truncate text-micro text-muted-foreground">
                {p.position}
              </span>
            )}
            {items > 0 && (
              <span className="mt-1.5 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium tabular-nums text-primary">
                {t('mgmtLogs.calPersonSum', { items, days: sum?.days ?? 0 })}
              </span>
            )}
          </span>
        </m.button>
      </div>
      {dates.map((date) => {
        const list = index.get(cellKey(p.user_id, date));
        const wd = weekdayOf(date);
        const tint = cn(
          'border-b border-l border-border',
          (wd === 0 || wd === 6) && 'bg-muted/30',
          date === today && 'bg-primary/5',
        );
        if (!list || date > today) return <div key={date} role="gridcell" className={tint} />;
        const hit = matchesQuery(list, q);
        const shown = previewItems(list, q, WEEK_PREVIEW);
        return (
          <div key={date} role="gridcell" className={cn(tint, 'p-1.5')}>
            <m.button
              type="button"
              onClick={() => onCell(date, p.user_id)}
              whileHover={{ y: -1 }}
              transition={{ duration: 0.15 }}
              data-cal-cell={`${p.user_id}|${date}`}
              data-date={date}
              data-hover-key={String(p.user_id)}
              aria-label={`${p.name} · ${date} · ${t('mgmtLogs.calItemsN', { count: list.length })}`}
              className={cn(
                'flex h-full min-h-[7rem] w-full flex-col gap-1.5 rounded-xl bg-background/70 p-2.5 text-left ring-1 ring-border/60',
                'transition-[box-shadow,opacity,background-color] hover:bg-background hover:shadow-md hover:ring-primary/40',
                'focus-visible:outline-2 focus-visible:outline-ring',
                !hit && 'opacity-30',
              )}
            >
              <span className="flex items-baseline gap-1">
                <span className="text-base leading-none font-semibold tabular-nums">
                  {list.length}
                </span>
                <span className="text-micro text-muted-foreground">
                  {t('mgmtLogs.calItemsUnit')}
                </span>
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                {shown.map((it, i) => (
                  <span key={i} className="flex min-w-0 items-start gap-1.5 text-xs leading-snug">
                    <span
                      className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60"
                      aria-hidden
                    />
                    <span className="line-clamp-2 min-w-0 break-words">
                      <Marked text={it} q={q} />
                    </span>
                  </span>
                ))}
              </span>
              {list.length > WEEK_PREVIEW && (
                <span className="mt-auto text-micro font-medium text-primary">
                  {t('mgmtLogs.calMoreN', { count: list.length - WEEK_PREVIEW })}
                </span>
              )}
            </m.button>
          </div>
        );
      })}
    </>
  );
}

/* ---------------- Сар: календарь ---------------- */

function MonthGrid({
  grid,
  month,
  people,
  order,
  single,
  index,
  today,
  q,
  onDay,
}: {
  grid: readonly (readonly string[])[];
  month: string;
  people: readonly CalPerson[];
  order: readonly number[];
  single: boolean;
  index: ReadonlyMap<string, readonly string[]>;
  today: string;
  q: string;
  onDay: (date: string) => void;
}) {
  const { t } = useLanguage();
  const byId = new Map(people.map((p) => [p.user_id, p]));
  return (
    <div className="overflow-hidden rounded-2xl bg-card shadow-apple">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((wd) => (
          <div
            key={wd}
            className="px-2 py-2 text-center text-micro font-medium text-muted-foreground"
          >
            <span className="hidden sm:inline">{t(`dailyLog.weekday${wd}`)}</span>
            <span className="sm:hidden">{t(`dailyLog.weekdayShort${wd}`)}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {grid.flat().map((date) => {
          const inMonth = date.startsWith(month);
          const future = date > today;
          const wd = weekdayOf(date);
          const writers = inMonth && !future ? writersOn(index, date, order) : [];
          const items =
            single && writers.length > 0 ? (index.get(cellKey(writers[0]!, date)) ?? []) : [];
          const hit = writers.some((id) => matchesQuery(index.get(cellKey(id, date)) ?? [], q));
          const base = cn(
            'min-h-[6.5rem] border-b border-l border-border p-1.5 first:border-l-0 sm:min-h-[7.5rem]',
            '[&:nth-child(7n+1)]:border-l-0',
            (wd === 0 || wd === 6) && 'bg-muted/30',
            !inMonth && 'bg-muted/10',
          );
          const dayItems = writers.reduce(
            (n, id) => n + (index.get(cellKey(id, date))?.length ?? 0),
            0,
          );
          const head = (
            <span className="flex w-full items-center justify-between gap-1">
              <span
                className={cn(
                  'inline-grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums',
                  !inMonth && 'text-muted-foreground/50',
                  date === today && 'bg-primary text-primary-foreground',
                )}
              >
                {Number(date.slice(8))}
              </span>
              {dayItems > 0 && (
                <span className="rounded-full bg-primary/10 px-1.5 text-micro font-medium tabular-nums text-primary">
                  {dayItems}
                </span>
              )}
            </span>
          );
          if (writers.length === 0) {
            return (
              <div key={date} className={base}>
                {head}
              </div>
            );
          }
          return (
            <div key={date} className={base}>
              <m.button
                type="button"
                onClick={() => onDay(date)}
                whileHover={{ y: -1 }}
                transition={{ duration: 0.15 }}
                data-cal-day={date}
                className={cn(
                  'flex h-full w-full flex-col items-start gap-1 rounded-lg p-1 text-left transition-[background-color,opacity] hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring',
                  !hit && 'opacity-30',
                )}
              >
                {head}
                {single ? (
                  <>
                    {items.slice(0, MONTH_PREVIEW).map((it, i) => (
                      <span
                        key={i}
                        className="line-clamp-1 w-full text-micro leading-snug break-words"
                      >
                        <Marked text={it} q={q} />
                      </span>
                    ))}
                    {items.length > MONTH_PREVIEW && (
                      <span className="text-micro font-medium text-primary">
                        {t('mgmtLogs.feedMoreItems', { count: items.length - MONTH_PREVIEW })}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="mt-auto inline-grid min-w-5 place-items-center rounded-full bg-primary/15 px-1.5 text-micro font-semibold text-primary tabular-nums sm:hidden">
                      {writers.length}
                    </span>
                    <span className="mt-auto hidden flex-wrap items-center gap-0.5 sm:flex">
                      {writers.slice(0, MONTH_AVATARS).map((id) => (
                        <MgmtAvatar
                          key={id}
                          userId={id}
                          name={byId.get(id)?.name ?? '?'}
                          size="sm"
                        />
                      ))}
                      {writers.length > MONTH_AVATARS && (
                        <span className="text-micro text-muted-foreground">
                          +{writers.length - MONTH_AVATARS}
                        </span>
                      )}
                    </span>
                  </>
                )}
              </m.button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
