import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// «Хэн хэдэн хувийг хийсэн» — графикийн доор.  Lazy: зөвхөн энэ табыг
// нээхэд л татагдана, мөн avatar/badge зэрэг нь үндсэн chunk-д орохгүй.
const ProjectContributorsCard = lazy(
  () => import('@/features/projects/components/ProjectContributorsCard'),
);
import { useQueryClient } from '@tanstack/react-query';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  TrackingModeExitMode,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';

import { useApiQuery } from '@/shared/api/useApi';
import { useLanguage } from '@/shared/i18n';
import { useTheme } from '@/shared/context/ThemeContext';
import type {
  ProgressTimeseriesPoint,
  ProjectActivityPoint,
  ProjectChartsTimeseries,
  ProjectHeadcountPoint,
  ProjectMilestone,
} from '@/shared/types';
import { buildForecastInput, forecastFinish, forecastFinishFromGain, requiredResource, workingDaysBetween, recentAvgHeadcount, addWorkingDays } from '@/features/projects/lib/forecast';
import { DraggableCursor } from '@/features/projects/components/chart/DraggableCursorPrimitive';
import { VertLine } from '@/features/projects/components/chart/VertLinePrimitive';
import { teamHex } from '@/shared/lib/team-colors';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from '@/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/select';
import ProjectTeamTasksDialog from './ProjectTeamTasksDialog';
import { ForecastReadout, PaceSlider } from '@/features/projects/components/ForecastControls';

/**
 * ProjectChartsTab — the project-detail "Графикууд" tab. A single
 * TradingView-style candlestick chart of the project's overall weighted
 * progress, reconstructed live from approved `progress_entries`:
 *
 *   • Candles  — each candle = a day's progress gain (green = good day,
 *                red = below-pace/idle), with wheel-zoom + drag-pan, an OHLC
 *                legend, a hover tooltip, a 100% target line and report-issue
 *                markers, plus a daily-headcount "volume" histogram pane.
 *   • Fullscreen (browser Fullscreen API) adds a right-side team "watchlist"
 *     (per-team %, range change, sparkline, task & member counts).
 *
 * Lazy-loaded by the tab so lightweight-charts only downloads when the user
 * opens the Графикууд tab — it stays out of the ProjectDetailPage route chunk.
 */

type Range = '7d' | '30d' | '90d' | 'all';

const RANGE_DAYS: Record<Range, number | null> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: null,
};
// Translation keys (resolved via `t()` at render — see usages).
const RANGE_LABEL_KEY: Record<Range, string> = {
  '7d': 'projectChartsTab.range7d',
  '30d': 'projectChartsTab.range30d',
  '90d': 'projectChartsTab.range90d',
  all: 'projectChartsTab.rangeAll',
};

/**
 * Цуваа бүхэлдээ ижил утгатай эсэх — өөрөөр хэлбэл сонгосон цонхонд явц
 * ОГТ өөрчлөгдөөгүй эсэх.
 *
 * Ийм үед лааны график хоосон харагдана (лаа бүрийн бие = өдрийн өсөлт =
 * 0), тиймээс энэ нь автомат өргөтгөлийн дохио болно. 2-оос цөөн цэгтэй
 * бол ямар ч байсан зурах юмгүй тул хавтгайд тооцохгүй — тэнд `EmptyChart`
 * өөрөө ажиллана.
 */
function isFlatSeries(series: ProgressTimeseriesPoint[] | undefined): boolean {
  if (!series || series.length < 2) return false;
  const first = series[0]!.progress;
  return series.every((p) => p.progress === first);
}

const EMPTY_DATA: Omit<ProjectChartsTimeseries, 'days'> = {
  from: '',
  to: '',
  overall: [],
  teams: { teams: [], points: [] },
  activity: [],
  headcount: [],
  milestones: [],
  schedule: { start_date: null, finish_date: null },
  health: { overdue: 0, pending: 0, last_activity_date: null },
  teamWorkers: { progress: [], attendance: [] },
  holidays: [],
};

export default function ProjectChartsTab({
  projectId,
  embeddedFullscreen = false,
  onExitFullscreen,
}: {
  projectId: number;
  /** Render the fullscreen dashboard layout unconditionally (used when the
   *  project header enlarges the chart into a full-viewport overlay). The
   *  top-right toggle then closes the overlay via `onExitFullscreen` instead
   *  of driving the browser Fullscreen API. */
  embeddedFullscreen?: boolean;
  onExitFullscreen?: () => void;
}) {
  const { t } = useLanguage();
  /** `null` = хэрэглэгч мужаа сонгоогүй — автомат сонголт үйлчилнэ. */
  const [userRange, setUserRange] = useState<Range | null>(null);
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Either real browser-fullscreen (the tab's own button) or the embedded
  // overlay (header "enlarge") both render the side-panel dashboard layout.
  const showDashboard = isFullscreen || embeddedFullscreen;
  // 2 cursor-ийн хэмжилт — графикаас callback-аар, side panel-д харуулна.
  const [measureSnap, setMeasureSnap] = useState<MeasureSnapshot | null>(null);

  /* ── ХАВТГАЙ ЦОНХНЫ АВТОМАТ ӨРГӨТГӨЛ ──
   *
   * Лаа бүрийн биеийн өндөр = тухайн өдөр НЭМЭГДСЭН хувь. Тиймээс сонгосон
   * цонхонд явц огт өөрчлөгдөөгүй бол лаа бүр ТЭГ өндөртэй болж график
   * бүрэн хоосон харагдана — өгөгдөл нь байсан ч.
   *
   * Архивласан төсөлд энэ нь ҮРГЭЛЖ тохиолдоно: тэд 100%-д хөлддөг тул
   * анхдагч 30 хоногийн цонх нь ажил дууссаны ДАРААХ хугацаанд бүхэлдээ
   * таарна. (Жишээ: төсөл 30 — 30 хоногт 1 ялгаатай утга (100→100), 90
   * хоногт 40 ялгаатай утга (47.75→100).) Удаан зогссон ИДЭВХТЭЙ төсөлд
   * ч мөн адил.
   *
   * Шийдэл: 30 хоногийн цонхыг ҮРГЭЛЖ асууж, хавтгай эсэхийг шалгана.
   * Хавтгай бол хэрэглэгч өөрөө сонгох хүртэл цонхыг ӨРГӨТГӨНӨ.
   * Энэ probe нь `ProgressSparklinePreview`-ийн query-тэй ЯГ ижил
   * түлхүүртэй тул кэш хуваалцаж, нэмэлт хүсэлт үүсгэхгүй.
   *
   * ⚠️ ӨРГӨТГӨЛ ЭХЛЭЭД 90 ХОНОГ РУУ, «Бүтэн» рүү ШУУД БИШ.  Учир нь
   * backend-ийн `buildDateList` (lib/progressTimeseries.ts) нь 90 хоногоос
   * УРТ мужийг 7 хоногийн алхамтай болгодог.  «Бүтэн» цонх нь төслийн
   * анхны бичилтээс эхэлдэг тул төсөл 90 хоногийн наснаас хэтрэх ӨДӨР
   * график өдрийн лаанаас 7 хоногийн лаа руу чимээгүй үсэрч, бараг
   * хоосон харагддаг байв (жишээ: төсөл 30 — 2026-08-10-нд 90 цэг,
   * 2026-08-11-нд ердөө 14 цэг).  90 хоногийн цонх ҮРГЭЛЖ өдрийн
   * нарийвчлалтай байдаг тул эхлээд түүнийг сонгоно; тэр ч хавтгай бол
   * (удаан хугацаанд зогссон/архивласан төсөл) л «Бүтэн» рүү орно. */
  const probe = useApiQuery<ProjectChartsTimeseries>(
    ['/projects', projectId, 'charts', '30d'],
    `/projects/${projectId}/charts/timeseries?days=30`,
  );
  const probeFlat = isFlatSeries(probe.data?.overall);
  // 2 дахь шат: зөвхөн 30 хоног хавтгай үед л асууна. Түлхүүр нь доорх
  // үндсэн query-тэй ижил тул '90d' сонгогдоход давхар хүсэлт явахгүй.
  const probe90 = useApiQuery<ProjectChartsTimeseries>(
    ['/projects', projectId, 'charts', '90d'],
    `/projects/${projectId}/charts/timeseries?days=90`,
    { enabled: userRange === null && probeFlat },
  );
  const probe90Flat = probe90.data !== undefined && isFlatSeries(probe90.data.overall);
  // Төлөвийг effect дотор БИШ, render-ийн үед гаргана — `react-hooks/
  // set-state-in-effect` дүрэм идэвхтэй бөгөөд каскад render хэрэггүй.
  const autoWidened = userRange === null && probeFlat;
  // 90 хоног ачаалагдаж дуустал '90d' дээр зогсоно — 'all' руу анивчихгүй.
  const range: Range = userRange ?? (!probeFlat ? '30d' : probe90Flat ? 'all' : '90d');

  const days = RANGE_DAYS[range];
  const qs = days ? `?days=${days}` : '';
  // Range is part of the cache key so switching reuses cached windows and
  // never races out-of-order; refetchOnWindowFocus (global default) keeps
  // the active window fresh. `range === '30d'` үед энэ нь probe-той ижил
  // түлхүүр болох тул ганц л хүсэлт явна.
  const { data, isError } = useApiQuery<ProjectChartsTimeseries>(
    ['/projects', projectId, 'charts', range],
    `/projects/${projectId}/charts/timeseries${qs}`,
  );

  // Live refresh whenever progress is submitted/approved anywhere in the
  // app (MyTasks, Approvals, …) so the curve tracks the latest approvals.
  useEffect(() => {
    const onProgress = () =>
      queryClient.invalidateQueries({ queryKey: ['/projects', projectId, 'charts'] });
    window.addEventListener('progress:submitted', onProgress);
    return () => window.removeEventListener('progress:submitted', onProgress);
  }, [queryClient, projectId]);

  // Fullscreen the whole charts dashboard via the browser API (site-office
  // displays). Tracked by the fullscreenchange event so the icon stays in
  // sync even when the user exits with Esc.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  };

  // Loading → `data` is undefined (cards render a skeleton). On error fall
  // back to an empty payload so the cards show their empty states rather
  // than an endless skeleton.
  const resolved: ProjectChartsTimeseries | null =
    data ?? (isError ? { ...EMPTY_DATA, days } : null);

  return (
    <div
      ref={rootRef}
      className={cn('space-y-4', isFullscreen && 'bg-background overflow-auto p-4')}
    >
      {/* Range toggle + fullscreen — shared by all charts. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h3 className="text-base font-semibold">{t('projectChartsTab.charts')}</h3>
        </div>
        <div className="flex items-center gap-2">
          {/* Автоматаар өргөтгөсөн бол ЧИМЭЭГҮЙ хийхгүй — хэрэглэгч яагаад
              30 хоног биш болохыг харах ёстой. */}
          {autoWidened && (
            <span className="text-micro hidden text-muted-foreground sm:inline">
              {t('projectChartsTab.autoWidened')}
            </span>
          )}
          <Select value={range} onValueChange={(v) => setUserRange(v as Range)}>
            <SelectTrigger
              className="h-8 w-[150px] rounded-lg text-xs"
              aria-label={t('projectChartsTab.selectRange')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {(Object.keys(RANGE_DAYS) as Range[]).map((r) => (
                <SelectItem key={r} value={r} className="text-xs">
                  {t(RANGE_LABEL_KEY[r])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={embeddedFullscreen ? onExitFullscreen : toggleFullscreen}
            aria-label={showDashboard ? t('projectChartsTab.exitFullscreen') : t('projectChartsTab.fullscreen')}
            title={showDashboard ? t('projectChartsTab.exitFullscreen') : t('projectChartsTab.fullscreen')}
          >
            {showDashboard ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {showDashboard ? (
        <div className="flex gap-4">
          <div className="min-w-0 flex-1">
            <OverallProgressCard data={resolved} range={range} fullscreen onMeasure={setMeasureSnap} />
          </div>
          <div className="flex w-[300px] shrink-0 flex-col gap-4">
            <PaceSummary
              current={
                resolved && resolved.overall.length
                  ? resolved.overall[resolved.overall.length - 1]!.progress
                  : 0
              }
              startDate={resolved?.schedule.start_date ?? null}
              finishDate={resolved?.schedule.finish_date ?? null}
              today={resolved?.to ?? ''}
            />
            <MeasureCard snap={measureSnap} />
            <ProjectStatsCard
              overall={resolved?.overall ?? []}
              headcount={resolved?.headcount ?? []}
              teams={resolved?.teams.teams ?? []}
            />
            <ProjectHealthCard
              health={resolved?.health ?? { overdue: 0, pending: 0, last_activity_date: null }}
              activity={resolved?.activity ?? []}
              today={resolved?.to ?? ''}
            />
            <WeekdayActivityCard activity={resolved?.activity ?? []} today={resolved?.to ?? ''} />
            <TeamWatchlist
              projectId={projectId}
              teams={resolved?.teams.teams ?? []}
              points={resolved?.teams.points ?? []}
              teamWorkers={resolved?.teamWorkers ?? { progress: [], attendance: [] }}
              className="min-h-0 flex-1"
            />
          </div>
        </div>
      ) : (
        <>
          <OverallProgressCard data={resolved} range={range} onMeasure={setMeasureSnap} />

          {/* Хэн энэ төсөлд хэдэн хувийг хийсэн бэ.  Тоо нь `user_points.delta_pct`-
              ийн нийлбэр тул хүн бүрийн хувь нэмэр нийлээд дээрх графикийн
              төслийн нийт явцтай тэнцэнэ.  Эрхийг сервер шийднэ: админ бүтэн
              жагсаалт, ажилтан зөвхөн өөрийнхөө мөр, захиалагч 403. */}
          <div className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">{t('projectChartsTab.contributorsTitle')}</h3>
              <p className="text-xs text-muted-foreground">
                {t('projectChartsTab.contributorsHint')}
              </p>
            </div>
            <Suspense fallback={<div className="h-40 rounded-lg bg-muted/40 animate-pulse" />}>
              <ProjectContributorsCard projectId={projectId} />
            </Suspense>
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------
 * 1. Overall project progress — bitcoin-style gradient area line.
 * -------------------------------------------------------------- */
function OverallProgressCard({
  data,
  range,
  fullscreen = false,
  onMeasure,
}: {
  data: ProjectChartsTimeseries | null;
  range: Range;
  fullscreen?: boolean;
  onMeasure?: (s: MeasureSnapshot | null) => void;
}) {
  const { t } = useLanguage();
  const series = data?.overall ?? [];
  const latest = series.length ? series[series.length - 1]!.progress : 0;

  // Төлөвлөгөөний шугамын toggle (хуваарьтай төсөлд).
  const [indicators, setIndicators] = useState<IndicatorState>({
    planned: true,
  });
  const hasPlan = !!(data?.schedule.start_date && data?.schedule.finish_date);
  const schedule = data?.schedule ?? { start_date: null, finish_date: null };

  // Half-vs-half slope as a quick "speeding up / slowing down" cue.
  const trend = useMemo(() => {
    const s = data?.overall ?? [];
    if (s.length < 2) return { dir: 'flat' as const, delta: 0 };
    const mid = Math.floor(s.length / 2);
    const startVal = s[0]!.progress;
    const midVal = s[mid]!.progress;
    const endVal = s[s.length - 1]!.progress;
    const firstHalf = midVal - startVal;
    const secondHalf = endVal - midVal;
    const delta = secondHalf - firstHalf;
    return {
      dir: delta > 0.5 ? ('up' as const) : delta < -0.5 ? ('down' as const) : ('flat' as const),
      delta,
    };
  }, [data?.overall]);
  const TrendIcon = trend.dir === 'up' ? TrendingUp : trend.dir === 'down' ? TrendingDown : Minus;
  // Forced-dark card → always use the light-on-dark trend shades.
  const trendColor =
    trend.dir === 'up' ? 'text-emerald-400' : trend.dir === 'down' ? 'text-red-400' : 'text-muted-foreground';

  return (
    <Card
      className="pt-0 gap-0 overflow-hidden border-border text-foreground"
      style={{ backgroundColor: 'hsl(var(--card))' }}
    >
      <CardHeader className="flex items-start gap-2 space-y-0 border-b border-border py-4 sm:flex-row sm:items-center">
        <div className="grid flex-1 gap-1">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5 text-foreground">
            <TrendingUp className="w-4 h-4" style={{ color: TV.up }} />
            {t('projectChartsTab.overallProgress')}
          </CardTitle>
          <CardDescription className="text-[11px] text-muted-foreground">
            {t(RANGE_LABEL_KEY[range])}
          </CardDescription>
        </div>
        <CardAction className="self-start sm:self-center text-right">
          <div className="text-3xl font-bold tabular-nums leading-none text-foreground">
            {latest.toFixed(1)}%
          </div>
          <div
            className={cn(
              'inline-flex items-center gap-0.5 text-[10px] font-semibold tabular-nums mt-1',
              trendColor,
            )}
          >
            <TrendIcon className="w-3 h-3" />
            {trend.dir === 'flat'
              ? t('projectChartsTab.trendFlat')
              : trend.dir === 'up'
                ? t('projectChartsTab.trendUp')
                : t('projectChartsTab.trendDown')}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="px-3 pt-3 sm:px-4 sm:pt-4">
        {/* Төлөвлөгөөний шугамын toggle (хуваарьтай төсөлд). */}
        {data && series.length > 0 && hasPlan && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <IndicatorChip
              label={t('projectChartsTab.indPlanned')}
              color={PLANNED_COLOR}
              active={indicators.planned}
              onClick={() => setIndicators((s) => ({ ...s, planned: !s.planned }))}
            />
          </div>
        )}
        <div
          className={cn('overflow-hidden rounded-lg', fullscreen ? 'h-[80vh]' : 'h-72')}
          style={{ backgroundColor: 'hsl(var(--card))' }}
        >
          {!data ? (
            <div className="h-full animate-pulse bg-white/5" />
          ) : series.length === 0 ? (
            <EmptyChart message={t('projectChartsTab.noApprovedProgress')} />
          ) : (
            <LwProgressChart
              series={series}
              headcount={data.headcount}
              milestones={data.milestones}
              activity={data.activity}
              holidays={data.holidays}
              schedule={schedule}
              indicators={indicators}
              today={data?.to || (series.length ? series[series.length - 1]!.date : '')}
              onMeasure={onMeasure}
            />
          )}
        </div>
        <ChartNote tone="dark">{t('projectChartsTab.chartNote')}</ChartNote>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------------------------------------
 * TradingView-style interactive overall-progress chart.
 * lightweight-charts gives wheel-zoom, drag-pan and a draggable time
 * scale out of the box. The canvas uses a FIXED TradingView dark
 * palette (independent of the app's light/dark theme) so the hero
 * chart always reads like a real TradingView panel.
 * -------------------------------------------------------------- */

// TradingView-style palette. The DATA colours (candles, lines, markers) stay
// fixed so the series read the same on any background; the SURFACE colours
// (bg / axis text / gridlines) follow the app's light/dark theme instead —
// see `readChartColors`, which the chart re-applies on every theme switch.
const TV = {
  bg: '#131722', // fallback only — the live surface comes from --card (readChartColors)
  grid: 'rgba(240, 243, 250, 0.06)', // faint gridlines (fallback)
  text: '#b2b5be', // axis labels (fallback)
  textDim: '#787b86', // dim text
  up: '#26a69a', // candle up (green) — өдрийн өсөлт дунджаас дээш
  down: '#ef5350', // candle down (red) — өсөлт дунджаас доош
  rest: '#f5a623', // ажлын бус өдөр (амралт/баяр) — явц гараагүй (улбар шар)
  flat: '#8b94a3', // эхлэлийн baseline лаа — гүйцэтгэл хэмжихгүй (саарал)
  vol: 'rgba(38, 166, 154, 0.5)', // "volume" bars (green)
  crosshair: '#758696',
} as const;

/** Resolve the chart's surface colours from the app theme tokens (read off the
 *  container's computed CSS variables, so they reflect whichever `.dark`/`.light`
 *  scope is active). Returns canvas-ready `hsl(...)` strings; falls back to the
 *  TradingView constants if a variable is somehow missing. */
function readChartColors(el: HTMLElement): { bg: string; text: string; grid: string } {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const card = v('--card') || v('--background');
  const fg = v('--foreground');
  const border = v('--border');
  return {
    bg: card ? `hsl(${card})` : TV.bg,
    text: fg ? `hsl(${fg})` : TV.text,
    grid: border ? `hsl(${border} / 0.5)` : TV.grid,
  };
}

const TARGET_COLOR = '#f0b90b'; // 100% target line (gold — contrasts the green candles)
const MARKER_COLOR = '#2962ff'; // report-issue markers (TradingView blue)
const PLANNED_COLOR = '#a78bfa'; // planned schedule pace line (violet)

/** Нэмэлт data-fitted индикаторуудын toggle түлхүүрүүд. */
type IndicatorState = { planned: boolean };

/** lightweight-charts time (string | BusinessDay | timestamp) → 'YYYY-MM-DD'
 *  so we can match it back against our daily series for the hover legend. */
function timeToISO(t: Time): string {
  if (typeof t === 'string') return t;
  if (typeof t === 'object' && t !== null && 'year' in t) {
    const mm = String(t.month).padStart(2, '0');
    const dd = String(t.day).padStart(2, '0');
    return `${t.year}-${mm}-${dd}`;
  }
  return String(t);
}

function buildMarkers(milestones: ProjectMilestone[]): SeriesMarker<Time>[] {
  return milestones.map((m) => ({
    time: m.date as Time,
    position: 'aboveBar',
    color: MARKER_COLOR,
    shape: 'circle',
    text: m.label,
  }));
}

type Candle = {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  // Per-bar colours (lightweight-charts supports these) so each candle is
  // tinted by that day's performance, not just close-vs-open.
  color: string;
  borderColor: string;
  wickColor: string;
};
type HoverInfo = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  count: number | null; // attendance headcount that day
  contributors: number | null; // people who logged task progress that day
  nonWorking: boolean; // weekend or company holiday
  // Цонхны ХАМГИЙН ЭХНИЙ цэг: өмнөх өдөргүй тул өсөлтийг хэмжих
  // боломжгүй (хуримтлагдсан түвшин).  Гүйцэтгэлээр дүгнэхгүй, саарал.
  baseline: boolean;
};

/** Legend/tooltip-ийн өнгө: baseline лаа саарал, бусад нь өдрийн төлөвөөр. */
function infoColor(info: HoverInfo, avgGain: number): string {
  if (info.baseline) return TV.flat;
  return stateColor(dayState(info.close - info.open, avgGain, info.nonWorking));
}

/** Тухайн өдөр амралтын өдөр (Бямба/Ням) мөн үү — огнооноос (UB) шууд. */
function isWeekendISO(date: string): boolean {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6;
}

/** Явц гаргасан (хамгийн өчүүхэн ч өсөлттэй) өдрийг "ажилласан" гэж үзнэ. */
const WORKED_EPS = 0.0001;

type DayState = 'up' | 'down' | 'rest';

/** Өдрийн лааны төлөв:
 *   • rest (улбар шар) — ажлын бус өдөр (амралт/баяр) дээр явц гараагүй.
 *     "Амрах ёстой" өдрийг "хоцорсон ажлын өдөр"-өөс ялгана.
 *   • up   (ногоон)    — тухайн өдрийн өсөлт цонхны ДУНДАЖ ажлын өдрийн
 *     өсөлтөөс дээш (ажлын бус ч гэсэн хүн ажиллаж явц гаргасан бол энд).
 *   • down (улаан)     — өсөлт дунджаас доош (идэвхгүй ажлын өдөр). */
function dayState(gain: number, avgGain: number, nonWorking: boolean): DayState {
  if (nonWorking && gain <= WORKED_EPS) return 'rest';
  // Ногоон болохын тулд дунджаас дээш БАЙХ + бодитоор явц гарсан байх ёстой.
  // Floor (WORKED_EPS) нь цонхонд огт явцгүй (avgGain≈0) үед идэвхгүй
  // өдрүүдийг бүгдийг ногоон харуулахаас сэргийлнэ.
  return gain >= Math.max(avgGain, WORKED_EPS) ? 'up' : 'down';
}

function stateColor(s: DayState): string {
  return s === 'up' ? TV.up : s === 'down' ? TV.down : TV.rest;
}

/** Turn the cumulative progress series into OHLC candles: each candle opens
 *  at the previous point's progress and closes at the current one, so the
 *  body height = progress gained that period. Each candle is tinted by
 *  {@link dayState} (green above-average / red below / orange rest day).
 *  `avgGain` is the average daily gain over WORKING days only (non-working
 *  days are excluded so weekend zeros don't deflate the bar), returned so the
 *  legend can colour-match. `nonWorkingDates` carries the company holidays;
 *  weekends are derived from the date. */
function buildCandles(
  series: ProgressTimeseriesPoint[],
  holidaySet: Set<string>,
): { candles: Candle[]; avgGain: number } {
  const base = series.map((p, i) => {
    const open = i > 0 ? series[i - 1]!.progress : p.progress;
    const close = p.progress;
    const date = p.date;
    return {
      time: date as Time,
      date,
      open,
      high: Math.max(open, close),
      low: Math.min(open, close),
      close,
      nonWorking: isWeekendISO(date) || holidaySet.has(date),
      // Эхний цэг (i===0) нь хуримтлагдсан түвшин — open===close болж
      // өсөлт зохиомлоор 0 гардаг.  Дунджид болон өнгөнд тооцохгүй.
      baseline: i === 0,
    };
  });
  // Дунджийг зөвхөн ажлын өдрөөр тооцно (амралтын ба эхлэлийн зохиомол
  // тэг өсөлт бар-ыг хасна).  Бодит ажлын өдөр байхгүй бол baseline-аас
  // бусад бүх өдрөөр, тэр ч байхгүй бол 0.
  let sum = 0;
  let n = 0;
  for (const c of base) {
    if (c.baseline || c.nonWorking) continue;
    sum += c.close - c.open;
    n += 1;
  }
  let avgGain = 0;
  if (n > 0) {
    avgGain = sum / n;
  } else {
    const rest = base.filter((c) => !c.baseline);
    if (rest.length) avgGain = rest.reduce((s, c) => s + (c.close - c.open), 0) / rest.length;
  }
  const candles: Candle[] = base.map((c) => {
    // Baseline лаа саарал (гүйцэтгэлээр дүгнэхгүй); бусад нь өдрийн төлөвөөр.
    const col = c.baseline ? TV.flat : stateColor(dayState(c.close - c.open, avgGain, c.nonWorking));
    return {
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      color: col,
      borderColor: col,
      wickColor: col,
    };
  });
  return { candles, avgGain };
}

/** Төлөвлөсөн шугаман хурд — паспортын start_date→finish_date хооронд 0%→100%.
 *  Цэг бүрийг тухайн лааны огнооны төлөвлөсөн % гэж тооцно (цонхон дотор).
 *  Хуваарь дутуу бол хоосон. */
function computePlanned(
  series: ProgressTimeseriesPoint[],
  schedule: { start_date: string | null; finish_date: string | null },
): { time: Time; value: number }[] {
  const { start_date, finish_date } = schedule;
  if (!start_date || !finish_date) return [];
  const start = new Date(`${start_date}T00:00:00Z`).getTime();
  const finish = new Date(`${finish_date}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start) return [];
  const span = finish - start;
  return series.map((p) => {
    const d = new Date(`${p.date}T00:00:00Z`).getTime() - start;
    const v = Math.max(0, Math.min(100, (100 * d) / span));
    return { time: p.date as Time, value: v };
  });
}

/** Индикаторын toggle chip — өнгөт цэг + нэр; унтраалттай үед бүдэг. */
function IndicatorChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors',
        active
          ? 'border-border bg-white/10 text-foreground'
          : 'border-border bg-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: active ? color : 'transparent', border: `1px solid ${color}` }}
      />
      {label}
    </button>
  );
}

/** 2 cursor-ийн хэмжилтийг side panel руу өргөх snapshot. */
export type MeasureSnapshot = {
  lo: string;
  hi: string;
  avgPerDay: number;
  change: number;
  realFinish: string | null;
  realVariance: number | null;
};

function LwProgressChart({
  series,
  headcount,
  milestones,
  activity,
  holidays,
  schedule,
  indicators,
  today,
  onMeasure,
}: {
  series: ProgressTimeseriesPoint[];
  headcount: ProjectHeadcountPoint[];
  milestones: ProjectMilestone[];
  activity: ProjectActivityPoint[];
  holidays: string[];
  schedule: { start_date: string | null; finish_date: string | null };
  indicators: IndicatorState;
  today: string;
  onMeasure?: (s: MeasureSnapshot | null) => void;
}) {
  const { t, lang } = useLanguage();
  const { resolved: resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const histRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const plannedRef = useRef<ISeriesApi<'Line'> | null>(null);
  const fcCurrentRef = useRef<ISeriesApi<'Line'> | null>(null);
  const fcScenarioRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const { candles, avgGain } = useMemo(
    () => buildCandles(series, holidaySet),
    [series, holidaySet],
  );
  const planStart = schedule.start_date;
  const planFinish = schedule.finish_date;
  const plannedData = useMemo(
    () => computePlanned(series, { start_date: planStart, finish_date: planFinish }),
    [series, planStart, planFinish],
  );

  // Forecast-ийн оролт — энэ компонент дотор тооцно (avgGain энд бий).
  const forecastInput = useMemo(
    () =>
      buildForecastInput({
        series,
        headcount,
        avgGain,
        today,
        deadline: schedule.finish_date,
      }),
    [series, headcount, avgGain, today, schedule.finish_date],
  );
  const currentPaceFinish = useMemo(
    () => (forecastInput ? forecastFinish(forecastInput, forecastInput.currentPeople) : null),
    [forecastInput],
  );

  const [scenarioGain, setScenarioGain] = useState<number>(0); // 0 = uninitialised
  useEffect(() => {
    if (scenarioGain === 0 && forecastInput) {
      // Default the slider to the current real pace (avgGain), snapped to the
      // 0.05 step and clamped to the slider's [0.05, 5] range.
      const snapped = Math.round(forecastInput.avgGain / 0.05) * 0.05;
      setScenarioGain(Math.min(5, Math.max(0.05, snapped)));
    }
  }, [forecastInput, scenarioGain]);

  const scenarioFinish = useMemo(
    () => (forecastInput && scenarioGain > 0 ? forecastFinishFromGain(forecastInput, scenarioGain) : null),
    [forecastInput, scenarioGain],
  );
  const fcScenarioData = useMemo(() => {
    if (!forecastInput || !scenarioFinish?.finishDate) return [];
    return [
      { time: forecastInput.today as Time, value: forecastInput.progress },
      { time: scenarioFinish.finishDate as Time, value: 100 },
    ];
  }, [forecastInput, scenarioFinish]);

  // Forecast төгсгөлийн огноо (одоогийн хурд) — null бол forecast зурахгүй.
  const currentFinishDate = currentPaceFinish?.finishDate ?? null;

  const futureEnd = useMemo(() => {
    const a = currentFinishDate;
    const b = scenarioFinish?.finishDate ?? null;
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }, [currentFinishDate, scenarioFinish]);

  // Чирдэг scenario cursor — аль ч ирээдүйн огноонд тавихад тэр огноонд
  // дуусгахад шаардлагатай нөөцийг (requiredResource) урвуугаар тооцно.
  const [cursorTime, setCursorTime] = useState<string | null>(null);
  const cursorTimeRef = useRef<string | null>(null);
  cursorTimeRef.current = cursorTime;
  const cursorRef = useRef<DraggableCursor | null>(null);
  useEffect(() => {
    if (cursorTime === null) setCursorTime(schedule.finish_date ?? currentFinishDate);
  }, [schedule.finish_date, currentFinishDate, cursorTime]);
  const cursorReq = useMemo(
    () => (forecastInput && cursorTime ? requiredResource(forecastInput, cursorTime) : null),
    [forecastInput, cursorTime],
  );

  // Хэмжих 2 чирдэг cursor (A, B) — хооронд нь явцын дундаж хурдыг (%/өдөр) олно.
  const [measureA, setMeasureA] = useState<string | null>(null);
  const [measureB, setMeasureB] = useState<string | null>(null);
  const measureARef = useRef<string | null>(null);
  const measureBRef = useRef<string | null>(null);
  measureARef.current = measureA;
  measureBRef.current = measureB;
  const measureACursorRef = useRef<DraggableCursor | null>(null);
  const measureBCursorRef = useRef<DraggableCursor | null>(null);
  useEffect(() => {
    if (series.length === 0) return;
    if (measureA === null) setMeasureA(series[0]!.date);
    if (measureB === null) setMeasureB(series[series.length - 1]!.date);
  }, [series, measureA, measureB]);
  const measure = useMemo(() => {
    if (!measureA || !measureB || series.length === 0) return null;
    const lo = measureA <= measureB ? measureA : measureB;
    const hi = measureA <= measureB ? measureB : measureA;
    const change = progressAt(series, hi) - progressAt(series, lo);
    const wd = workingDaysBetween(lo, hi);
    return { lo, hi, change, avgPerDay: wd > 0 ? change / wd : 0, wd };
  }, [measureA, measureB, series]);

  // 2 cursor-ийн хоорондох "бодит хурд"-аар (measure.avgPerDay) төслийн
  // дуусах огноог тооцно — энэ нь хэрэглэгчийн сонгосон гол forecast.
  const realPaceFinish = useMemo(() => {
    if (!forecastInput || !measure || measure.avgPerDay <= 0) return null;
    const remaining = 100 - forecastInput.progress;
    if (remaining <= 0) return { finishDate: forecastInput.today, varianceDays: 0 };
    const days = Math.ceil(remaining / measure.avgPerDay);
    const finishDate = addWorkingDays(forecastInput.today, days);
    const varianceDays = schedule.finish_date
      ? workingDaysBetween(schedule.finish_date, finishDate)
      : null;
    return { finishDate, varianceDays };
  }, [forecastInput, measure, schedule.finish_date]);

  // Хэмжилтийг side panel руу өргөнө (callback) — cursor чирэх бүрд шинэчилнэ.
  const measureSnapshot = useMemo<MeasureSnapshot | null>(
    () =>
      measure
        ? {
            lo: measure.lo,
            hi: measure.hi,
            avgPerDay: measure.avgPerDay,
            change: measure.change,
            realFinish: realPaceFinish?.finishDate ?? null,
            realVariance: realPaceFinish?.varianceDays ?? null,
          }
        : null,
    [measure, realPaceFinish],
  );
  useEffect(() => {
    onMeasure?.(measureSnapshot);
  }, [measureSnapshot, onMeasure]);

  // Ирээдүйн whitespace — өнөөдрөөс forecast-дуусах хүртэл. Тэнхлэгийг нээнэ.
  const futureWhitespace = useMemo(() => {
    if (!futureEnd || series.length === 0) return [];
    const today = series[series.length - 1]!.date;
    const out: { time: Time }[] = [];
    let ms = new Date(`${today}T00:00:00Z`).getTime();
    const endMs = new Date(`${futureEnd}T00:00:00Z`).getTime();
    let guard = 0;
    while (ms < endMs && guard < 2000) {
      ms += 86_400_000;
      out.push({ time: new Date(ms).toISOString().slice(0, 10) as Time });
      guard += 1;
    }
    return out;
  }, [futureEnd, series]);

  // Forecast шугам (одоогийн хурд): (өнөөдөр, явц) → (дуусах, 100).
  const fcCurrentData = useMemo(() => {
    if (!forecastInput || !currentFinishDate) return [];
    return [
      { time: forecastInput.today as Time, value: forecastInput.progress },
      { time: currentFinishDate as Time, value: 100 },
    ];
  }, [forecastInput, currentFinishDate]);

  // Crosshair handler нь нэг л удаа bind хийгддэг тул шинэ өгөгдлийг ref-ээр
  // уншина (contributorsRef-тэй ижил хэв маяг).
  const holidaySetRef = useRef(holidaySet);
  holidaySetRef.current = holidaySet;
  // Цонхны эхний огноо — baseline лааг таних (өсөлтийг хэмжихгүй).
  const firstDateRef = useRef(series[0]?.date ?? '');
  firstDateRef.current = series[0]?.date ?? '';

  // date → people who logged task progress that day (from the activity series).
  // A ref keeps the once-bound crosshair handler reading fresh data.
  const contributorsByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of activity) m.set(a.date, a.contributor_count);
    return m;
  }, [activity]);
  const contributorsRef = useRef(contributorsByDate);
  contributorsRef.current = contributorsByDate;

  const [hover, setHover] = useState<(HoverInfo & { x: number; y: number }) | null>(null);

  const vToday = useRef<VertLine | null>(null);
  const vDeadline = useRef<VertLine | null>(null);
  const vForecast = useRef<VertLine | null>(null);
  const todayTimeRef = useRef<Time | null>(null);
  const deadlineTimeRef = useRef<Time | null>(null);
  const forecastTimeRef = useRef<Time | null>(null);
  todayTimeRef.current = (forecastInput?.today ?? null) as Time | null;
  deadlineTimeRef.current = (schedule.finish_date ?? null) as Time | null;
  forecastTimeRef.current = currentFinishDate as Time | null;

  // Create the chart once. handleScroll/handleScale (wheel-zoom + drag-pan)
  // are on by default. Pane 1 holds the headcount "volume" histogram.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const c0 = readChartColors(el);
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: c0.bg },
        textColor: c0.text,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: c0.grid },
        horzLines: { color: c0.grid },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: TV.crosshair, labelBackgroundColor: TV.up },
        horzLine: { color: TV.crosshair, labelBackgroundColor: TV.up },
      },
      // On touch, keep the crosshair (and tooltip) up after a tap until the
      // next tap — without this a quick tap shows nothing on mobile.
      trackingMode: { exitMode: TrackingModeExitMode.OnNextTap },
      // No global priceFormatter — each series formats its own scale, so the
      // progress pane shows % while the headcount pane below shows a count.
      localization: { locale: 'mn-MN' },
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: TV.up,
      downColor: TV.down,
      borderUpColor: TV.up,
      borderDownColor: TV.down,
      wickUpColor: TV.up,
      wickDownColor: TV.down,
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%`, minMove: 0.1 },
    });
    // 100% target reference line.
    candle.createPriceLine({
      price: 100,
      color: TARGET_COLOR,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: t('projectChartsTab.target'),
    });
    chartRef.current = chart;
    candleRef.current = candle;

    const today = new VertLine(chart, () => todayTimeRef.current, {
      color: TV.flat, width: 1, labelText: t('projectChartsTab.fcToday'), labelColor: TV.textDim,
    });
    const deadline = new VertLine(chart, () => deadlineTimeRef.current, {
      color: '#f97316', width: 2, dashed: true, labelText: t('projectChartsTab.fcDeadline'), labelColor: '#f97316',
    });
    const forecast = new VertLine(chart, () => forecastTimeRef.current, {
      color: '#22d3ee', width: 1, dashed: true, labelText: t('projectChartsTab.fcForecastFinish'), labelColor: '#22d3ee',
    });
    candle.attachPrimitive(today);
    candle.attachPrimitive(deadline);
    candle.attachPrimitive(forecast);
    vToday.current = today;
    vDeadline.current = deadline;
    vForecast.current = forecast;

    // Чирдэг scenario cursor — аль ч ирээдүйн огноонд тавьж болно.
    const cursor = new DraggableCursor(
      chart,
      {
        getTime: () => cursorTimeRef.current as Time | null,
        setTime: (tm) => setCursorTime(String(tm)),
        color: '#fbbf24',
      },
      el,
    );
    candle.attachPrimitive(cursor);
    cursorRef.current = cursor;

    // Хэмжих 2 cursor (A, B) — өнгөрсөн range-ийн дундаж хурдыг хэмжинэ (саарал).
    const measureCursorA = new DraggableCursor(
      chart,
      { getTime: () => measureARef.current as Time | null, setTime: (tm) => setMeasureA(String(tm)), color: '#94a3b8' },
      el,
    );
    const measureCursorB = new DraggableCursor(
      chart,
      { getTime: () => measureBRef.current as Time | null, setTime: (tm) => setMeasureB(String(tm)), color: '#94a3b8' },
      el,
    );
    candle.attachPrimitive(measureCursorA);
    candle.attachPrimitive(measureCursorB);
    measureACursorRef.current = measureCursorA;
    measureBCursorRef.current = measureCursorB;

    // Төлөвлөсөн хуваарийн шугам — reference шугам (autoscale-д нөлөөлөхгүй,
    // lastValue/crosshair marker-гүй); эхний харагдалт mount үеийн
    // `indicators`-оор, дараа нь visibility effect-ээр солигдоно.
    const planned = chart.addSeries(LineSeries, {
      color: PLANNED_COLOR,
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      pointMarkersVisible: false,
      visible: indicators.planned,
      autoscaleInfoProvider: () => null,
    });
    plannedRef.current = planned;

    const fcCurrent = chart.addSeries(LineSeries, {
      color: '#22d3ee',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      pointMarkersVisible: false,
      autoscaleInfoProvider: () => null,
    });
    fcCurrentRef.current = fcCurrent;

    const fcScenario = chart.addSeries(LineSeries, {
      color: '#e879f9',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      pointMarkersVisible: false,
      autoscaleInfoProvider: () => null,
    });
    fcScenarioRef.current = fcScenario;

    // Volume-style headcount pane — only when the project has attendance data
    // (otherwise an empty bottom pane would just look broken).
    if (headcount.length > 0) {
      const hist = chart.addSeries(
        HistogramSeries,
        {
          color: TV.vol,
          priceFormat: { type: 'custom', formatter: (v: number) => `${Math.round(v)}`, minMove: 1 },
          priceLineVisible: false,
        },
        1,
      );
      histRef.current = hist;
      const panes = chart.panes();
      panes[0]?.setStretchFactor(3);
      panes[1]?.setStretchFactor(1);
    }

    // OHLC legend header (TradingView-style) driven by the crosshair.
    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (param.time === undefined || !param.point) {
        setHover(null);
        return;
      }
      const bar = param.seriesData.get(candle) as
        | { open?: number; high?: number; low?: number; close?: number }
        | undefined;
      if (!bar || bar.open === undefined) {
        setHover(null);
        return;
      }
      const count = histRef.current
        ? ((param.seriesData.get(histRef.current) as { value?: number } | undefined)?.value ?? null)
        : null;
      const iso = timeToISO(param.time);
      setHover({
        date: iso,
        open: bar.open,
        high: bar.high ?? bar.open,
        low: bar.low ?? bar.open,
        close: bar.close ?? bar.open,
        count,
        contributors: contributorsRef.current.get(iso) ?? null,
        nonWorking: isWeekendISO(iso) || holidaySetRef.current.has(iso),
        baseline: iso === firstDateRef.current,
        x: param.point.x,
        y: param.point.y,
      });
    });

    return () => {
      cursorRef.current?.destroy();
      cursorRef.current = null;
      measureACursorRef.current?.destroy();
      measureACursorRef.current = null;
      measureBCursorRef.current?.destroy();
      measureBCursorRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      histRef.current = null;
      plannedRef.current = null;
      fcCurrentRef.current = null;
      fcScenarioRef.current = null;
      markersRef.current = null;
      vToday.current = null;
      vDeadline.current = null;
      vForecast.current = null;
    };
    // Create once; data is pushed by the effects below. `headcount` is only
    // read here to decide whether to mount the volume pane at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-paint the chart surface (bg / axis text / gridlines) whenever the app
  // theme flips — the canvas can't read CSS vars itself, so we re-resolve the
  // theme tokens and apply them. Data-series colours are theme-independent.
  useEffect(() => {
    const chart = chartRef.current;
    const el = containerRef.current;
    if (!chart || !el) return;
    const c = readChartColors(el);
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    });
  }, [resolvedTheme]);

  // Push candle data; fit the visible range to it.
  useEffect(() => {
    const candle = candleRef.current;
    const chart = chartRef.current;
    if (!candle || !chart) return;
    candle.setData([...candles, ...futureWhitespace]);
    chart.timeScale().fitContent();
  }, [candles, futureWhitespace]);

  // Push the planned-schedule line.
  useEffect(() => {
    plannedRef.current?.setData(plannedData);
  }, [plannedData]);

  useEffect(() => {
    fcCurrentRef.current?.setData(fcCurrentData);
  }, [fcCurrentData]);

  useEffect(() => {
    fcScenarioRef.current?.setData(fcScenarioData);
  }, [fcScenarioData]);

  // Toggle the planned line's visibility without recreating the series.
  useEffect(() => {
    plannedRef.current?.applyOptions({ visible: indicators.planned });
  }, [indicators]);

  // Push the headcount volume bars.
  useEffect(() => {
    const hist = histRef.current;
    if (!hist) return;
    hist.setData(headcount.map((h) => ({ time: h.date as Time, value: h.count })));
  }, [headcount]);

  // Milestone markers (issued performance reports).
  useEffect(() => {
    const candle = candleRef.current;
    if (!candle) return;
    const markers = buildMarkers(milestones);
    if (markersRef.current) markersRef.current.setMarkers(markers);
    else markersRef.current = createSeriesMarkers(candle, markers);
  }, [milestones]);

  // Legend shows the hovered candle, else the latest.
  const lastCandle = candles[candles.length - 1] ?? null;
  const lastDate = series[series.length - 1]?.date ?? '';
  const lastCount = headcount[headcount.length - 1]?.count ?? null;
  const info: HoverInfo | null =
    hover ??
    (lastCandle
      ? {
          date: lastDate,
          open: lastCandle.open,
          high: lastCandle.high,
          low: lastCandle.low,
          close: lastCandle.close,
          count: lastCount,
          contributors: contributorsByDate.get(lastDate) ?? null,
          nonWorking: isWeekendISO(lastDate) || holidaySet.has(lastDate),
          baseline: lastDate === (series[0]?.date ?? ''),
        }
      : null);

  return (
    <div
      className="flex h-full w-full flex-col overflow-hidden rounded-lg"
      style={{ backgroundColor: 'hsl(var(--card))' }}
    >
      {forecastInput && (
        <div className="shrink-0 space-y-1 border-b border-border px-2 py-1.5">
          <ForecastReadout
            progress={forecastInput.progress}
            deadline={schedule.finish_date}
            currentPace={currentPaceFinish}
            locale={lang}
          />
          <PaceSlider value={scenarioGain} onChange={setScenarioGain} />
          {scenarioFinish?.finishDate && (
            <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#e879f9' }} />
              {t('projectChartsTab.fcScenario')}: {t('projectChartsTab.fcPaceValue', { gain: scenarioGain.toFixed(2) })} →{' '}
              <span className="text-foreground">{new Date(`${scenarioFinish.finishDate}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
            </div>
          )}
          {cursorTime && cursorReq && (
            <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-amber-300">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#fbbf24' }} />
              {t('projectChartsTab.fcRequired', {
                date: new Date(`${cursorTime}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { month: 'short', day: 'numeric' }),
                gain: cursorReq.requiredGain.toFixed(2),
              })}
            </div>
          )}
          {measure && (
            <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#94a3b8' }} />
              {t('projectChartsTab.fcMeasure', {
                from: new Date(`${measure.lo}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { month: 'short', day: 'numeric' }),
                to: new Date(`${measure.hi}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { month: 'short', day: 'numeric' }),
                change: (measure.change >= 0 ? '+' : '') + measure.change.toFixed(1),
                avg: measure.avgPerDay.toFixed(2),
              })}
            </div>
          )}
          {realPaceFinish?.finishDate && (
            <div className="flex items-center gap-1.5 text-[11px] font-semibold tabular-nums text-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#94a3b8' }} />
              {t('projectChartsTab.fcRealPace', {
                date: new Date(`${realPaceFinish.finishDate}T00:00:00Z`).toLocaleDateString(lang === 'mn' ? 'mn-MN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
              })}
              {realPaceFinish.varianceDays != null && realPaceFinish.varianceDays !== 0 && (
                <span className={realPaceFinish.varianceDays > 0 ? 'text-red-400' : 'text-emerald-400'}>
                  ·{' '}
                  {realPaceFinish.varianceDays > 0
                    ? t('projectChartsTab.fcVarianceLate', { days: realPaceFinish.varianceDays })
                    : t('projectChartsTab.fcVarianceEarly', { days: -realPaceFinish.varianceDays })}
                </span>
              )}
            </div>
          )}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />
        {info && <OhlcLegend info={info} avgGain={avgGain} />}
        {hover && (
          <CandleTooltip
            info={hover}
            avgGain={avgGain}
            flip={hover.x > (containerRef.current?.clientWidth ?? 0) / 2}
          />
        )}
      </div>
    </div>
  );
}

/** Floating tooltip pinned next to the hovered candle: that day's start/end
 *  progress, the day's performance and the headcount. */
function CandleTooltip({
  info,
  avgGain,
  flip,
}: {
  info: HoverInfo & { x: number; y: number };
  avgGain: number;
  flip: boolean;
}) {
  const { t } = useLanguage();
  const gain = info.close - info.open;
  const col = infoColor(info, avgGain);
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[150px] rounded-md border border-border bg-muted/95 px-2.5 py-1.5 text-[11px] tabular-nums shadow-xl"
      style={{
        left: info.x,
        top: info.y,
        transform: `translate(${flip ? 'calc(-100% - 14px)' : '14px'}, -50%)`,
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-2 font-semibold text-foreground">
        <span>
          {new Date(info.date).toLocaleDateString('mn-MN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
        {info.nonWorking && (
          <span className="rounded px-1 py-0.5 text-[9px] font-medium" style={{ color: TV.rest }}>
            {t('projectChartsTab.restDay')}
          </span>
        )}
      </div>
      <TooltipRow label={t('projectChartsTab.dayStart')} value={`${info.open.toFixed(1)}%`} />
      <TooltipRow label={t('projectChartsTab.dayEnd')} value={`${info.close.toFixed(1)}%`} />
      <div className="flex justify-between gap-4 font-semibold" style={{ color: col }}>
        <span>{t('projectChartsTab.dayPerformance')}</span>
        <span>
          {gain >= 0 ? '+' : ''}
          {gain.toFixed(1)}%
        </span>
      </div>
      {info.count != null && (
        <TooltipRow
          label={t('projectChartsTab.workedAttendance')}
          value={t('projectChartsTab.peopleCount', { count: Math.round(info.count) })}
        />
      )}
      {info.contributors != null && (
        <TooltipRow
          label={t('projectChartsTab.contributed')}
          value={t('projectChartsTab.peopleCount', { count: Math.round(info.contributors) })}
        />
      )}
    </div>
  );
}

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

/** TradingView-style top-left OHLC legend: O/H/L/C, the day's performance
 *  (progress gained that day, in project %-points) and the headcount — all
 *  tinted green/red by whether it was a good or bad day. */
function OhlcLegend({ info, avgGain }: { info: HoverInfo; avgGain: number }) {
  const { t } = useLanguage();
  const gain = info.close - info.open;
  const col = infoColor(info, avgGain);
  return (
    <div className="pointer-events-none absolute left-2 top-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-2 py-0.5 text-[11px] font-medium tabular-nums">
      <span style={{ color: TV.textDim }}>
        {new Date(info.date).toLocaleDateString('mn-MN', { month: 'short', day: 'numeric' })}
      </span>
      <span style={{ color: col }}>O {info.open.toFixed(1)}</span>
      <span style={{ color: col }}>H {info.high.toFixed(1)}</span>
      <span style={{ color: col }}>L {info.low.toFixed(1)}</span>
      <span style={{ color: col }}>C {info.close.toFixed(1)}</span>
      <span className="font-semibold" style={{ color: col }}>
        {t('projectChartsTab.dayPerformance')} {gain >= 0 ? '+' : ''}
        {gain.toFixed(1)}%
      </span>
      {info.nonWorking && (
        <span className="font-medium" style={{ color: TV.rest }}>
          · {t('projectChartsTab.restDay')}
        </span>
      )}
      {info.count != null && (
        <span style={{ color: TV.textDim }}>
          · {t('projectChartsTab.peopleCount', { count: Math.round(info.count) })}
        </span>
      )}
    </div>
  );
}


/** Small muted caption under a chart explaining what it shows / how it
 *  is computed, so the methodology is transparent to non-admin staff.
 *  `tone="dark"` reads on the dark TradingView panel. */
function ChartNote({ children, tone = 'light' }: { children: ReactNode; tone?: 'light' | 'dark' }) {
  return (
    <p
      className={cn(
        'mt-3 border-t pt-2.5 text-[11px] leading-relaxed',
        tone === 'dark'
          ? 'border-border text-muted-foreground'
          : 'border-border/40 text-muted-foreground',
      )}
    >
      {children}
    </p>
  );
}

/* ----------------------------------------------------------------
 * Fullscreen "required daily pace" panel. Uses the project passport's
 * start_date → finish_date to answer "өдөрт хэдэн хувь явах ёстой":
 *   • Төлөвлөсөн   = 100% ÷ total days (constant planned pace)
 *   • Шаардлагатай = (100 − current) ÷ days left (what's needed now)
 *   • Бодит        = current ÷ days elapsed (pace achieved so far)
 * Status compares current vs the straight-line plan position for today.
 * -------------------------------------------------------------- */

/** Whole days between two YYYY-MM-DD dates (b − a); NaN if unparseable. */
function dayDiff(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00Z`).getTime();
  const tb = new Date(`${b}T00:00:00Z`).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return NaN;
  return Math.round((tb - ta) / 86_400_000);
}

function PaceSummary({
  current,
  startDate,
  finishDate,
  today,
}: {
  current: number;
  startDate: string | null;
  finishDate: string | null;
  today: string;
}) {
  const { t } = useLanguage();
  if (!finishDate) {
    return (
      <div
        className="rounded-lg border border-border p-3 text-[11px] leading-relaxed text-muted-foreground"
        style={{ backgroundColor: 'hsl(var(--card))' }}
      >
        <div className="mb-1 font-semibold uppercase tracking-wider">{t('projectChartsTab.dailyPace')}</div>
        {t('projectChartsTab.noFinishDate')}
      </div>
    );
  }

  const cur = Math.max(0, Math.min(100, current));
  const remaining = Math.max(0, 100 - cur);
  const totalDays = startDate ? dayDiff(startDate, finishDate) : NaN;
  const daysLeft = today ? dayDiff(today, finishDate) : NaN;
  const elapsed = startDate && today ? dayDiff(startDate, today) : NaN;

  const planned = Number.isFinite(totalDays) && totalDays > 0 ? 100 / totalDays : null;
  const actual = Number.isFinite(elapsed) && elapsed > 0 ? cur / elapsed : null;
  const overdue = cur < 100 && Number.isFinite(daysLeft) && daysLeft <= 0;
  const requiredStr =
    remaining <= 0
      ? t('projectChartsTab.perDay', { value: '0' })
      : Number.isFinite(daysLeft) && daysLeft > 0
        ? t('projectChartsTab.perDay', { value: (remaining / daysLeft).toFixed(2) })
        : t('projectChartsTab.overdue');

  // On schedule = current ≥ where the straight-line plan says we should be today.
  const expectedToday =
    planned != null && Number.isFinite(elapsed) ? Math.min(100, planned * Math.max(0, elapsed)) : null;
  const status =
    cur >= 100
      ? { label: t('projectChartsTab.done'), cls: 'text-emerald-400' }
      : overdue
        ? { label: t('projectChartsTab.overdueStatus'), cls: 'text-red-400' }
        : expectedToday != null
          ? cur + 0.5 >= expectedToday
            ? { label: t('projectChartsTab.onSchedule'), cls: 'text-emerald-400' }
            : { label: t('projectChartsTab.behind'), cls: 'text-red-400' }
          : { label: '', cls: '' };

  const fmt = (v: number | null) =>
    v == null ? '—' : t('projectChartsTab.perDay', { value: v.toFixed(2) });
  const finishLabel = new Date(`${finishDate}T00:00:00Z`).toLocaleDateString('mn-MN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Forecast finish at the current actual pace + variance vs the plan.
  let forecast: { label: string; cls: string } | null = null;
  if (cur >= 100) {
    forecast = { label: t('projectChartsTab.done'), cls: 'text-emerald-400' };
  } else if (actual != null && actual > 0 && today) {
    const days = Math.ceil((100 - cur) / actual);
    const fDate = new Date(new Date(`${today}T00:00:00Z`).getTime() + days * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const variance = dayDiff(finishDate, fDate); // + = later than planned
    const fLabel = new Date(`${fDate}T00:00:00Z`).toLocaleDateString('mn-MN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const vTxt =
      variance > 0
        ? t('projectChartsTab.daysLate', { count: variance })
        : variance < 0
          ? t('projectChartsTab.daysEarly', { count: -variance })
          : t('projectChartsTab.exactlyOnSchedule');
    forecast = {
      label: `${fLabel} · ${vTxt}`,
      cls: variance > 0 ? 'text-red-400' : 'text-emerald-400',
    };
  }

  return (
    <div className="rounded-lg border border-border p-3" style={{ backgroundColor: 'hsl(var(--card))' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('projectChartsTab.dailyPace')}
        </span>
        {status.label && (
          <span className={cn('text-[11px] font-semibold', status.cls)}>{status.label}</span>
        )}
      </div>
      <div className="mb-2 text-[10px] text-muted-foreground">
        {t('projectChartsTab.finishLabel', { date: finishLabel })}
        {Number.isFinite(daysLeft) &&
          ` · ${t('projectChartsTab.daysLeft', { count: Math.max(0, daysLeft) })}`}
      </div>
      <div className="space-y-1.5 text-[11px] tabular-nums">
        <PaceRow label={t('projectChartsTab.planned')} value={fmt(planned)} />
        <PaceRow label={t('projectChartsTab.required')} value={requiredStr} emphasize />
        <PaceRow label={t('projectChartsTab.actual')} value={fmt(actual)} />
        {forecast && (
          <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5">
            <span className="text-muted-foreground">{t('projectChartsTab.forecast')}</span>
            <span className={cn('text-right', forecast.cls)}>{forecast.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PaceRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={emphasize ? 'font-semibold text-foreground' : 'text-foreground'}>{value}</span>
    </div>
  );
}

/* ----------------------------------------------------------------
 * Management cockpit: risk signals + latest activity. Overdue counts
 * partially-done tasks too (latest approved % < 100, not just 0%), so a
 * 50%-done-but-late task still flags. "Сүүлийн идэвх" is the most recent
 * day with logged entries (task fills + people).
 * -------------------------------------------------------------- */
/* Side-panel mirror of the 2-cursor measure: real pace + finish forecast. */
function MeasureCard({ snap }: { snap: MeasureSnapshot | null }) {
  const { t, lang } = useLanguage();
  if (!snap) return null;
  const fmt = (d: string, withYear = false) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString(
      lang === 'mn' ? 'mn-MN' : 'en-US',
      withYear
        ? { year: 'numeric', month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric' },
    );
  return (
    <div className="rounded-lg border border-border p-3" style={{ backgroundColor: 'hsl(var(--card))' }}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#94a3b8' }} />
        {t('projectChartsTab.fcMeasureCard')}
      </div>
      <div className="space-y-1.5 text-[11px] tabular-nums">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {fmt(snap.lo)}–{fmt(snap.hi)}
          </span>
          <span className="font-semibold text-foreground">
            {snap.avgPerDay.toFixed(2)}%/{t('projectChartsTab.wlPerDay')}
          </span>
        </div>
        {snap.realFinish && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t('projectChartsTab.fcForecastFinish')}</span>
            <span className="flex items-center gap-1 text-foreground">
              {fmt(snap.realFinish, true)}
              {snap.realVariance != null && snap.realVariance !== 0 && (
                <span className={snap.realVariance > 0 ? 'text-red-400' : 'text-emerald-400'}>
                  (
                  {snap.realVariance > 0
                    ? t('projectChartsTab.fcVarianceLate', { days: snap.realVariance })
                    : t('projectChartsTab.fcVarianceEarly', { days: -snap.realVariance })}
                  )
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* Side-panel stats: today's headcount + trend, task done/total, recent velocity.
 * Бүгд chart payload-аас гарна (backend өөрчлөлтгүй). */
function ProjectStatsCard({
  overall,
  headcount,
  teams,
}: {
  overall: ProgressTimeseriesPoint[];
  headcount: ProjectHeadcountPoint[];
  teams: ProjectChartsTimeseries['teams']['teams'];
}) {
  const { t } = useLanguage();
  const totalTasks = teams.reduce((s, x) => s + x.taskCount, 0);
  const doneTasks = teams.reduce((s, x) => s + x.doneCount, 0);
  const taskPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const hcToday = headcount.length ? headcount[headcount.length - 1]!.count : 0;
  const hcAvg = recentAvgHeadcount(headcount, 14);
  const hcDir: 'up' | 'down' | 'flat' =
    hcToday > hcAvg + 0.5 ? 'up' : hcToday < hcAvg - 0.5 ? 'down' : 'flat';

  // Хурдны хандлага — сүүлийн ~7 цэгийн дундаж өсөлт vs өмнөх ~7.
  const momentum = useMemo(() => {
    const n = overall.length;
    if (n < 3) return null;
    const at = (i: number) => overall[Math.max(0, Math.min(n - 1, i))]!.progress;
    const recent = (at(n - 1) - at(n - 8)) / 7;
    const prior = n >= 15 ? (at(n - 8) - at(n - 15)) / 7 : null;
    const dir: 'up' | 'down' | 'flat' =
      prior == null ? 'flat' : recent > prior + 0.02 ? 'up' : recent < prior - 0.02 ? 'down' : 'flat';
    return { recent: Math.max(0, recent), dir };
  }, [overall]);

  const clsOf = (dir: 'up' | 'down' | 'flat') =>
    dir === 'up' ? 'text-emerald-400' : dir === 'down' ? 'text-red-400' : 'text-muted-foreground';
  const HcIcon = hcDir === 'up' ? TrendingUp : hcDir === 'down' ? TrendingDown : Minus;
  const moDir = momentum?.dir ?? 'flat';
  const MoIcon = moDir === 'up' ? TrendingUp : moDir === 'down' ? TrendingDown : Minus;

  return (
    <div className="rounded-lg border border-border p-3" style={{ backgroundColor: 'hsl(var(--card))' }}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('projectChartsTab.wlStats')}
      </div>
      <div className="space-y-1.5 text-[11px] tabular-nums">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t('projectChartsTab.fcToday')}</span>
          <span className={cn('flex items-center gap-1', clsOf(hcDir))}>
            <HcIcon className="h-3 w-3" />
            {t('projectChartsTab.fcPeople', { count: hcToday })}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t('projectChartsTab.wlTasks')}</span>
          <span className="text-foreground">
            {doneTasks} / {totalTasks} · {taskPct}%
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{t('projectChartsTab.wlMomentum')}</span>
          {momentum ? (
            <span className={cn('flex items-center gap-1', clsOf(momentum.dir))}>
              <MoIcon className="h-3 w-3" />
              {momentum.recent.toFixed(2)}%/{t('projectChartsTab.wlPerDay')}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ProjectHealthCard({
  health,
  activity,
  today,
}: {
  health: ProjectChartsTimeseries['health'];
  activity: ProjectActivityPoint[];
  today: string;
}) {
  const { t } = useLanguage();
  const last = activity.length ? activity[activity.length - 1]! : null;
  const idleDays =
    health.last_activity_date && today
      ? Math.max(0, dayDiff(health.last_activity_date, today))
      : null;
  return (
    <div className="rounded-lg border border-border p-3" style={{ backgroundColor: 'hsl(var(--card))' }}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t('projectChartsTab.riskActivity')}
      </div>
      <div className="space-y-1.5 text-[11px] tabular-nums">
        <HealthRow
          label={t('projectChartsTab.overdueLabel')}
          value={t('projectChartsTab.tasksCount', { count: health.overdue })}
          alert={health.overdue > 0}
        />
        <HealthRow
          label={t('projectChartsTab.pendingApproval')}
          value={`${health.pending}`}
          warn={health.pending > 0}
        />
        <HealthRow
          label={t('projectChartsTab.idle')}
          value={idleDays == null ? '—' : t('projectChartsTab.daysCount', { count: idleDays })}
          alert={idleDays != null && idleDays > 7}
        />
        <HealthRow
          label={t('projectChartsTab.lastActivity')}
          value={
            last
              ? t('projectChartsTab.activitySummary', {
                  entries: last.entry_count,
                  people: last.contributor_count,
                })
              : '—'
          }
        />
      </div>
    </div>
  );
}

function HealthRow({
  label,
  value,
  alert = false,
  warn = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(alert ? 'text-red-400' : warn ? 'text-amber-400' : 'text-foreground')}>
        {value}
      </span>
    </div>
  );
}

/* ----------------------------------------------------------------
 * Weekday task-logging activity, navigable one 7-day week at a time with
 * ◀ ▶ chevrons. Each bar = a day's task-fill count (Да–Ня); the busiest
 * day of the shown week is highlighted. (Navigate further back by widening
 * the range toggle, since the data is range-bounded.)
 * -------------------------------------------------------------- */
// Monday-first weekday abbreviations — translation keys, resolved via `t()`.
const WEEKDAY_KEYS = [
  'projectChartsTab.weekdayMon',
  'projectChartsTab.weekdayTue',
  'projectChartsTab.weekdayWed',
  'projectChartsTab.weekdayThu',
  'projectChartsTab.weekdayFri',
  'projectChartsTab.weekdaySat',
  'projectChartsTab.weekdaySun',
];

function isoAddDays(dateStr: string, n: number): string {
  return new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function WeekdayActivityCard({
  activity,
  today,
}: {
  activity: ProjectActivityPoint[];
  today: string;
}) {
  const { t } = useLanguage();
  const [weekOffset, setWeekOffset] = useState(0); // 0 = week containing `today`

  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of activity) m.set(a.date, a.entry_count);
    return m;
  }, [activity]);

  // Monday of the displayed week (anchor week of `today`, shifted by offset).
  const weekMonday = useMemo(() => {
    if (!today) return '';
    const mondayIdx = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    return isoAddDays(today, -mondayIdx + weekOffset * 7);
  }, [today, weekOffset]);

  const days = useMemo(
    () =>
      weekMonday
        ? Array.from({ length: 7 }, (_, i) => {
            const date = isoAddDays(weekMonday, i);
            return { date, count: byDate.get(date) ?? 0 };
          })
        : [],
    [weekMonday, byDate],
  );

  const counts = days.map((d) => d.count);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((s, n) => s + n, 0);
  const busiest = counts.indexOf(Math.max(...counts));
  const fmtMd = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('mn-MN', { month: 'numeric', day: 'numeric' });

  return (
    <div className="rounded-lg border border-border p-3" style={{ backgroundColor: 'hsl(var(--card))' }}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('projectChartsTab.weekdayActivity')}
        </span>
        <div className="flex items-center gap-1 text-muted-foreground">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            className="rounded p-0.5 hover:bg-white/10 hover:text-foreground"
            aria-label={t('projectChartsTab.prevWeek')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] tabular-nums">
            {weekMonday ? `${fmtMd(weekMonday)}–${fmtMd(isoAddDays(weekMonday, 6))}` : ''}
          </span>
          <button
            type="button"
            disabled={weekOffset >= 0}
            onClick={() => setWeekOffset((w) => Math.min(0, w + 1))}
            className="rounded p-0.5 hover:bg-white/10 hover:text-foreground disabled:opacity-30"
            aria-label={t('projectChartsTab.nextWeek')}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex items-end justify-between gap-1">
        {days.map((d, i) => (
          <div key={d.date} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[9px] tabular-nums text-muted-foreground">{d.count || ''}</span>
            <div
              className="w-full rounded-sm"
              style={{
                height: `${Math.max(3, Math.round((d.count / max) * 40))}px`,
                backgroundColor: total > 0 && i === busiest ? TV.up : 'rgba(148, 160, 180, 0.35)',
              }}
            />
            <span
              className={cn(
                'text-[9px]',
                total > 0 && i === busiest ? 'font-semibold text-emerald-400' : 'text-muted-foreground',
              )}
            >
              {t(WEEKDAY_KEYS[i]!)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Period granularities for the watchlist performance window. */
// `labelKey` resolved via `t()` at render.
const TW_GRANS: { key: 'day' | 'week' | 'month'; labelKey: string; days: number }[] = [
  { key: 'day', labelKey: 'projectChartsTab.granDay', days: 1 },
  { key: 'week', labelKey: 'projectChartsTab.granWeek', days: 7 },
  { key: 'month', labelKey: 'projectChartsTab.granMonth', days: 30 },
];

/** Нийт явц `date`-ийн байдлаар (тухайн өдөр эсвэл өмнөх хамгийн сүүлийн цэг). */
function progressAt(series: ProgressTimeseriesPoint[], date: string): number {
  let v = series.length ? series[0]!.progress : 0;
  for (const p of series) {
    if (p.date <= date) v = p.progress;
    else break;
  }
  return v;
}

/** A team's progress value as of `date` (the last point on/before it). */
function teamValueAt(
  points: ProjectChartsTimeseries['teams']['points'],
  code: string,
  date: string,
): number {
  let v = 0;
  for (const p of points) {
    if (String(p.date) <= date) v = Number(p[code] ?? 0);
    else break;
  }
  return v;
}

function fmtMonthDay(d: string): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('mn-MN', { month: 'numeric', day: 'numeric' });
}

type PeopleMap = Map<string, Map<string, string[]>>; // team → date → names

function buildPeopleMap(rows: { team: string; date: string; name: string }[]): PeopleMap {
  const m: PeopleMap = new Map();
  for (const r of rows) {
    let byDate = m.get(r.team);
    if (!byDate) {
      byDate = new Map();
      m.set(r.team, byDate);
    }
    const names = byDate.get(r.date);
    if (names) names.push(r.name);
    else byDate.set(r.date, [r.name]);
  }
  return m;
}

/** Distinct names for a team across the dates in the window (winStart, winEnd]. */
function peopleInWindow(map: PeopleMap, team: string, winStart: string, winEnd: string): string[] {
  const byDate = map.get(team);
  if (!byDate) return [];
  const set = new Set<string>();
  for (const [date, names] of byDate) {
    if (date > winStart && date <= winEnd) for (const n of names) set.add(n);
  }
  return [...set];
}

/* ----------------------------------------------------------------
 * Fullscreen right-side "watchlist": each discipline team as a row —
 * level %, performance over a selectable period (day / week / month,
 * navigable back with ◀ ▶), a mini sparkline, done/total tasks and
 * member count. Hover a row to see who's on the team.
 * -------------------------------------------------------------- */
function TeamWatchlist({
  projectId,
  teams,
  points,
  teamWorkers,
  className,
}: {
  projectId: number;
  teams: ProjectChartsTimeseries['teams']['teams'];
  points: ProjectChartsTimeseries['teams']['points'];
  teamWorkers: ProjectChartsTimeseries['teamWorkers'];
  className?: string;
}) {
  const { t } = useLanguage();
  // Сонгосон баг — мөр дээр дарахад тухайн багийн "хэн ямар ажлыг хэдэн
  // хувиар хийсэн" задаргааны диалог нээнэ (хуучин hover tooltip-ийг орлоно).
  const [selected, setSelected] = useState<{ code: string; name: string } | null>(null);
  const [gran, setGran] = useState<'day' | 'week' | 'month'>('week');
  const [offset, setOffset] = useState(0); // 0 = latest period

  const progressMap = useMemo(() => buildPeopleMap(teamWorkers.progress), [teamWorkers.progress]);
  const attendanceMap = useMemo(
    () => buildPeopleMap(teamWorkers.attendance),
    [teamWorkers.attendance],
  );

  const periodDays = TW_GRANS.find((g) => g.key === gran)!.days;
  const lastDate = points.length ? String(points[points.length - 1]!.date) : '';
  const winEnd = lastDate ? isoAddDays(lastDate, offset * periodDays) : '';
  const winStart = winEnd ? isoAddDays(winEnd, -periodDays) : '';
  const windowLabel = !winEnd
    ? ''
    : gran === 'day'
      ? fmtMonthDay(winEnd)
      : `${fmtMonthDay(winStart)}–${fmtMonthDay(winEnd)}`;

  return (
    <div
      className={cn('flex flex-col overflow-hidden rounded-lg border border-border', className)}
      style={{ backgroundColor: 'hsl(var(--card))' }}
    >
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('projectChartsTab.teams')}
          </span>
          <div className="flex gap-0.5 rounded bg-white/5 p-0.5">
            {TW_GRANS.map((g) => (
              <button
                key={g.key}
                type="button"
                onClick={() => {
                  setGran(g.key);
                  setOffset(0);
                }}
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px]',
                  gran === g.key
                    ? 'bg-white/15 text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(g.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-1 flex items-center justify-center gap-2 text-muted-foreground">
          <button
            type="button"
            onClick={() => setOffset((o) => o - 1)}
            className="rounded p-0.5 hover:bg-white/10 hover:text-foreground"
            aria-label={t('projectChartsTab.prevPeriod')}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-[10px] tabular-nums">{windowLabel}</span>
          <button
            type="button"
            disabled={offset >= 0}
            onClick={() => setOffset((o) => Math.min(0, o + 1))}
            className="rounded p-0.5 hover:bg-white/10 hover:text-foreground disabled:opacity-30"
            aria-label={t('projectChartsTab.nextPeriod')}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {teams.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-muted-foreground">
            {t('projectChartsTab.noTeamData')}
          </div>
        ) : (
          teams.map((team) => {
            const vals = points.map((p) => Number(p[team.code] ?? 0));
            const endVal = winEnd ? teamValueAt(points, team.code, winEnd) : 0;
            const chg = endVal - (winStart ? teamValueAt(points, team.code, winStart) : 0);
            const peopleCount = new Set([
              ...peopleInWindow(progressMap, team.code, winStart, winEnd),
              ...peopleInWindow(attendanceMap, team.code, winStart, winEnd),
            ]).size;
            const hex = teamHex(team.code);
            return (
              <div
                key={team.code}
                role="button"
                tabIndex={0}
                className="flex w-full cursor-pointer items-center gap-2 border-b border-border px-3 py-2 hover:bg-white/5 focus:bg-white/5 focus:outline-none"
                onClick={() => setSelected({ code: team.code, name: team.name })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelected({ code: team.code, name: team.name });
                  }
                }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: hex }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-foreground">{team.code}</span>
                    <span className="truncate text-[10px] text-muted-foreground">{team.name}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {t('projectChartsTab.teamTasksPeople', {
                      done: team.doneCount,
                      total: team.taskCount,
                      people: peopleCount,
                    })}
                  </div>
                </div>
                <Sparkline values={vals} color={hex} />
                <div className="w-14 shrink-0 text-right">
                  <div className="text-[12px] font-semibold tabular-nums text-foreground">
                    {endVal.toFixed(1)}%
                  </div>
                  <div
                    className={cn(
                      'text-[10px] tabular-nums',
                      chg > 0.05
                        ? 'text-emerald-400'
                        : chg < -0.05
                          ? 'text-red-400'
                          : 'text-muted-foreground',
                    )}
                  >
                    {chg > 0.05 ? '▲' : chg < -0.05 ? '▼' : ''}
                    {Math.abs(chg).toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {selected && (
        <ProjectTeamTasksDialog
          projectId={projectId}
          team={selected}
          from={winStart}
          to={winEnd}
          periodLabel={windowLabel}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

/** Tiny inline SVG sparkline for a team's progress series. */
function Sparkline({
  values,
  color,
  width = 60,
  height = 22,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <svg width={width} height={height} className="shrink-0" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((v - min) / range) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-[11px] text-muted-foreground/70 italic text-center px-2">
      {message}
    </div>
  );
}
