import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { useLanguage } from '@/shared/i18n';
import { formatDisplayName } from '@/shared/lib/formatting';
import { teamChipClass } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/tooltip';
import { ASR_STATUS_LABEL } from '@/features/projects/asr/asrStatusStyle';
import { REPORT_TYPE_KEY, reportTypeOf, type AsrReport } from '@/features/projects/asr/types';
import {
  addDays,
  axisTicks,
  positionPct,
  weekdayOf,
  type AsrAxisDomain,
  type AsrAxisTick,
} from '../lib/asrRange';
import type { AsrBoardMark, AsrBoardPerson } from '../lib/asrBoard';
import { monthName, weekdayShort } from './rangeText';

/** Эхлээд харагдах хүний мөр — үлдсэнийг «Бусад N хүн»-ээр дэлгэнэ. */
const VISIBLE_PEOPLE = 10;

/**
 * Нэрийн багана.  Утсанд нэр нь мөрийн ДЭЭР тусдаа (зам бүтэн өргөнөөрөө) —
 * 7rem баганад «Тэн…» гэж тасарч хэн болохыг уншихын аргагүй байсан.
 */
const ROW_GRID = 'grid grid-cols-1 sm:grid-cols-[13rem_minmax(0,1fr)]';

/**
 * «Хэн хэзээ явсан» — мөр бүр нэг хүн, хэвтээ тэнхлэг нь сонгосон хугацаа,
 * цэг бүр тэр хүний НЭГ ӨДРИЙН очилт.  Хүн бүрийн очилтыг огноогоор нь
 * нэг харцаар харуулна — «хэн хэдэн удаа, хэзээ хэзээ» гэдгийг жагсаалтаас
 * тоолох шаардлагагүй.
 *
 *   • дүүрэн цэг = талбайн хяналт; хөндий цэг = бусад төрөл (уулзалт, зургийн
 *     өөрчлөлт) — өнгө биш ХЭЛБЭРээр ялгана (өнгөний харалган, хэвлэлтэд ч);
 *   • тоотой цэг = тэр өдөр хэд хэдэн тайлан (жишээ нь хоёр багийнх);
 *   • цэг дээр дарвал тайлан нээгдэнэ, нэр дээр дарвал доорх жагсаалт тэр
 *     хүнээр шүүгдэнэ.
 */
export function AsrWhoWhenChart({
  domain,
  all,
  people,
  today,
  activePersonId,
  onSelectPerson,
  onOpenReport,
  onShowAll,
  className,
}: {
  domain: AsrAxisDomain | null;
  all: AsrBoardMark<AsrReport>[];
  people: AsrBoardPerson<AsrReport>[];
  today: string;
  activePersonId: number | null;
  onSelectPerson: (userId: number | null) => void;
  onOpenReport: (row: AsrReport) => void;
  /** «Бүх хугацаа» биш үед хоосон бол «Бүх хугацааг харах» товч. */
  onShowAll?: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [trackRef, trackWidth] = useElementWidth<HTMLDivElement>();

  const ticks = useMemo(() => (domain ? axisTicks(domain) : []), [domain]);
  const totalSite = all.reduce((n, m) => n + m.reports.filter((r) => reportTypeOf(r) === 'site').length, 0);
  const hasOther = all.some((m) => m.reports.some((r) => reportTypeOf(r) !== 'site'));
  const hasMulti = all.some((m) => m.reports.length > 1) || people.some((p) => p.marks.some((m) => m.reports.length > 1));

  // Сонгосон хүн «Бусад» дотор нуугдчихвал мөр нь харагдахгүй болно — дэлгэнэ.
  const activeIndex = people.findIndex((p) => p.userId === activePersonId);
  const showAllPeople = expanded || activeIndex >= VISIBLE_PEOPLE;
  const shown = showAllPeople ? people : people.slice(0, VISIBLE_PEOPLE);
  const hidden = people.length - shown.length;

  const todayPct = domain && today >= domain.from && today <= domain.to ? positionPct(today, domain) : null;

  return (
    <section
      id="sec-asr-project-who-when"
      className={cn('scroll-mt-24 rounded-xl border border-border bg-card', className)}
      data-testid="asr-who-when"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pb-2 pt-4 sm:px-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t('asr.board.chartTitle')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('asr.board.chartHint')}</p>
        </div>
        {all.length > 0 && (
          <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <li className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-primary" aria-hidden />
              {t('asr.type.site')}
            </li>
            {hasOther && (
              <li className="inline-flex items-center gap-1.5">
                <span className="size-3 rounded-full border-2 border-primary bg-card" aria-hidden />
                {t('asr.board.legendOther')}
              </li>
            )}
            {hasMulti && (
              <li className="inline-flex items-center gap-1.5">
                <span
                  className="flex size-4 items-center justify-center rounded-full bg-primary text-label leading-none tracking-normal text-primary-foreground"
                  aria-hidden
                >
                  2
                </span>
                {t('asr.board.legendMulti')}
              </li>
            )}
          </ul>
        )}
      </div>

      {!domain || all.length === 0 ? (
        <div className="px-4 pb-5 pt-2 sm:px-5">
          <p className="text-sm text-muted-foreground">{t('asr.board.chartEmpty')}</p>
          {onShowAll && (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onShowAll}>
              {t('asr.board.showAll')}
            </Button>
          )}
        </div>
      ) : (
        <div className="px-2 pb-3 sm:px-3">
          {/* Тэнхлэгийн шошго */}
          <div className={ROW_GRID}>
            <div className="hidden sm:block" />
            <div ref={trackRef} className="relative h-10 overflow-hidden" aria-hidden>
              <AxisLabels ticks={ticks} width={trackWidth} />
              {todayPct != null && (
                <span
                  className={cn(
                    'absolute bottom-0.5 whitespace-nowrap rounded bg-primary/10 px-1 text-label font-medium normal-case tracking-normal text-primary',
                    // Ирмэгт ойр бол картаас гарахгүйгээр нэг тал руу нь тулгана.
                    todayPct > 88 ? '-translate-x-full' : todayPct < 12 ? '' : '-translate-x-1/2',
                  )}
                  style={{ left: `${todayPct}%` }}
                >
                  {t('asr.board.today')}
                </span>
              )}
            </div>
          </div>

          <div role="list" data-testid="asr-who-when-rows">
            <Row
              label={
                <span className="flex min-w-0 items-center justify-between gap-2 px-2">
                  <span className="truncate text-sm font-semibold">{t('asr.board.chartAll')}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{totalSite}</span>
                </span>
              }
              marks={all}
              domain={domain}
              ticks={ticks}
              todayPct={todayPct}
              dimmed={false}
              onOpenReport={onOpenReport}
              className="bg-muted/30"
              testId="asr-who-when-all"
            />
            {shown.map((p) => {
              const active = activePersonId === p.userId;
              return (
                <Row
                  key={p.userId}
                  label={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-pressed={active}
                      onClick={() => onSelectPerson(active ? null : p.userId)}
                      className={cn(
                        'w-full min-w-0 justify-start px-2 py-1 text-left hover:text-foreground',
                        'h-auto whitespace-normal font-normal pointer-coarse:h-auto motion-safe:active:scale-100',
                        active && 'bg-primary/10 ring-1 ring-primary/40',
                      )}
                      data-testid="asr-who-when-person"
                      data-user={p.userId}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{formatDisplayName(p.name)}</span>
                        {p.teams.length > 0 && (
                          <span className="hidden gap-1 sm:flex">
                            {p.teams.slice(0, 3).map((code) => (
                              <span
                                key={code}
                                className={cn(
                                  'rounded-full border px-1 text-label font-medium leading-4 tracking-normal',
                                  teamChipClass(code),
                                )}
                              >
                                {code}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 text-right leading-tight tabular-nums">
                        <span className="block text-sm font-semibold">
                          <span className="sm:hidden">{p.site}</span>
                          <span className="hidden sm:inline">{t('asr.board.visitsShort', { n: p.site })}</span>
                        </span>
                        {p.other > 0 && (
                          <span className="block text-label font-normal normal-case tracking-normal text-muted-foreground">
                            {t('asr.board.otherShort', { n: p.other })}
                          </span>
                        )}
                      </span>
                    </Button>
                  }
                  marks={p.marks}
                  domain={domain}
                  ticks={ticks}
                  todayPct={todayPct}
                  dimmed={activePersonId != null && !active}
                  onOpenReport={onOpenReport}
                  className={active ? 'bg-primary/5' : undefined}
                  testId="asr-who-when-row"
                />
              );
            })}
          </div>

          {(hidden > 0 || (expanded && people.length > VISIBLE_PEOPLE)) && (
            <div className="px-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {hidden > 0 ? t('asr.board.morePeople', { n: hidden }) : t('asr.board.lessPeople')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  marks,
  domain,
  ticks,
  todayPct,
  dimmed,
  onOpenReport,
  className,
  testId,
}: {
  label: ReactNode;
  marks: AsrBoardMark<AsrReport>[];
  domain: AsrAxisDomain;
  ticks: AsrAxisTick[];
  todayPct: number | null;
  dimmed: boolean;
  onOpenReport: (row: AsrReport) => void;
  className?: string;
  testId: string;
}) {
  return (
    <div
      role="listitem"
      className={cn(ROW_GRID, 'items-center rounded-md pt-1 sm:pt-0', className)}
      data-testid={testId}
    >
      <div className="min-w-0 sm:py-0.5">{label}</div>
      <div className={cn('relative h-9 transition-opacity sm:h-10', dimmed && 'opacity-35')}>
        <Weekends domain={domain} />
        {ticks.map((tk) => (
          <span
            key={tk.date}
            aria-hidden
            className={cn('absolute inset-y-1 w-px', tk.kind === 'month' ? 'bg-border' : 'bg-border/60')}
            style={{ left: `${tk.pct}%` }}
          />
        ))}
        <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-border" />
        {todayPct != null && (
          <span
            aria-hidden
            className="absolute inset-y-0 border-l border-dashed border-primary/60"
            style={{ left: `${todayPct}%` }}
          />
        )}
        {marks.map((m) =>
          m.date >= domain.from && m.date <= domain.to ? (
            <Mark key={m.date} mark={m} pct={positionPct(m.date, domain)} onOpenReport={onOpenReport} />
          ) : null,
        )}
      </div>
    </div>
  );
}

/** ≤ 62 хоногийн тэнхлэгт Бямба/Ням гарагийг бүдэг сүүдэрлэнэ — өдөр тоолоход. */
function Weekends({ domain }: { domain: AsrAxisDomain }) {
  if (domain.days > 62) return null;
  const cells: number[] = [];
  let d = domain.from;
  for (let i = 0; i < domain.days; i++, d = addDays(d, 1)) {
    const wd = weekdayOf(d);
    if (wd === 0 || wd === 6) cells.push(i);
  }
  const w = 100 / domain.days;
  return (
    <>
      {cells.map((i) => (
        <span
          key={i}
          aria-hidden
          className="absolute inset-y-1 bg-muted/60"
          style={{ left: `${i * w}%`, width: `${w}%` }}
        />
      ))}
    </>
  );
}

function AxisLabels({ ticks, width }: { ticks: AsrAxisTick[]; width: number }) {
  const { t } = useLanguage();
  const labeled = ticks.filter((tk) => tk.showLabel);
  // Зай багатай (утас) үед шошгыг алгасна — зураас нь мөрөнд хэвээр.
  const minPx = labeled[0]?.kind === 'week' ? 44 : 70;
  const step = width > 0 ? Math.max(1, Math.ceil((labeled.length * minPx) / width)) : 1;
  const shown = labeled.filter((_, i) => i % step === 0);
  const texts = axisLabelTexts(shown, t);
  return (
    <>
      {shown.map((tk, i) => (
        <span
          key={tk.date}
          className={cn(
            'absolute top-0 whitespace-nowrap text-label font-normal normal-case leading-5 tracking-normal text-muted-foreground tabular-nums',
            // Баруун ирмэгт ойр шошгыг зураасныхаа ЗҮҮН талд — картаас хальж тасрахгүй.
            tk.pct > 85 ? '-translate-x-full pr-1' : 'pl-1',
          )}
          style={{ left: `${tk.pct}%` }}
        >
          {texts[i]}
        </span>
      ))}
    </>
  );
}

/** Сарын шошго — эхнийх болон он солигдсон газарт оныг нэмнэ («2026 · 9-р сар»). */
function axisLabelTexts(ticks: AsrAxisTick[], t: (k: string) => string): string[] {
  const out: string[] = [];
  let prevYear: number | null = null;
  for (const tk of ticks) {
    if (tk.kind === 'week') {
      out.push(tk.date.slice(5));
      continue;
    }
    const year = Number(tk.date.slice(0, 4));
    const month = monthName(Number(tk.date.slice(5, 7)), t);
    out.push(prevYear == null || year !== prevYear ? `${year} · ${month}` : month);
    prevYear = year;
  }
  return out;
}

function reportLine(r: AsrReport, t: (k: string) => string): string {
  const type = t(REPORT_TYPE_KEY[reportTypeOf(r)]);
  return `${type} · ${r.doc_no ?? t('asr.docNoPending')} · ${t(ASR_STATUS_LABEL[r.status])}`;
}

function Mark({
  mark,
  pct,
  onOpenReport,
}: {
  mark: AsrBoardMark<AsrReport>;
  pct: number;
  onOpenReport: (row: AsrReport) => void;
}) {
  const { t } = useLanguage();
  const n = mark.reports.length;
  const heading = `${mark.date} · ${weekdayShort(mark.date, t)}`;
  const dot = (
    <span
      className={cn(
        'flex items-center justify-center rounded-full ring-2 ring-card transition-transform group-hover:scale-125',
        n > 1 ? 'size-4 text-label leading-none tracking-normal' : 'size-3',
        mark.site ? 'bg-primary text-primary-foreground' : 'border-2 border-primary bg-card text-primary',
      )}
    >
      {n > 1 ? n : null}
    </span>
  );
  // 24px хүрэлтийн талбай (цэгээс том), мэдрэгчтэй дэлгэцэнд 32px — `Button`-ы
  // 44px өндөр нь хувиар байрлуулсан цэгүүдийг бие биен дээр нь давхарлана.
  const btnClass =
    'group absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full p-0 hover:bg-primary/10 pointer-coarse:size-8 motion-safe:active:scale-100';

  if (n === 1) {
    const r = mark.reports[0]!;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={btnClass}
            style={{ left: `${pct}%` }}
            aria-label={`${heading} — ${reportLine(r, t)}`}
            onClick={() => onOpenReport(r)}
            data-testid="asr-who-when-mark"
            data-date={mark.date}
          >
            {dot}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-left">
          <div className="font-semibold tabular-nums">{heading}</div>
          <div>{reportLine(r, t)}</div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={btnClass}
              style={{ left: `${pct}%` }}
              aria-label={`${heading} — ${t('asr.board.reportsThatDay', { n })}`}
              data-testid="asr-who-when-mark"
              data-date={mark.date}
            >
              {dot}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-left">
          <div className="font-semibold tabular-nums">
            {heading} · {t('asr.board.reportsThatDay', { n })}
          </div>
          {mark.reports.map((r) => (
            <div key={r.id}>{reportLine(r, t)}</div>
          ))}
        </TooltipContent>
      </Tooltip>
      <PopoverContent className="w-72 p-1" align="center">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground tabular-nums">
          {heading} · {t('asr.board.reportsThatDay', { n })}
        </div>
        <ul>
          {mark.reports.map((r) => (
            <li key={r.id}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenReport(r)}
                className="h-auto whitespace-normal font-normal pointer-coarse:h-auto motion-safe:active:scale-100 w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left"
              >
                <span className="font-mono text-xs">{r.doc_no ?? t('asr.docNoPending')}</span>
                <span className="text-xs text-muted-foreground">
                  {t(REPORT_TYPE_KEY[reportTypeOf(r)])} · {t(ASR_STATUS_LABEL[r.status])}
                  {r.team_codes ? ` · ${r.team_codes.split(',').join(', ')}` : ''}
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Элементийн өргөн (px) — тэнхлэгийн шошгыг зайд нь багтаах. */
function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    observer.current = ro;
  }, []);
  return [ref, width];
}
