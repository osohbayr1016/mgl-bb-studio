import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import type { AssessmentLevelBand } from '../types';
import { DEFAULT_LEVELS, levelForPct } from '../lib/score';
import { BEHAVIOR_BANDS, bandForMean, fmtMean } from '../lib/behaviorScale';
import {
  LEVEL_OVERLAP_SLOT,
  levelAxisTicks,
  levelSlotDomain,
  levelYAxisWidth,
  pctToLevelSlot,
  sortedLevelBands,
  spreadOverlappingY,
} from '../lib/levelChartAxis';
import { LevelYAxisTick } from './LevelYAxisTick';
import { useSeriesColors } from '../lib/chartSeries';
import { sectionChartLabels, xAxisFontSize, xAxisHeightForLabels } from '../lib/chartAxisLabels';
import type { SideKey as HighlightSideKey } from '../lib/scatterSeriesHighlight';
import { seriesStrokeWidth } from '../lib/scatterSeriesHighlight';
import { HitScatterSeries, VisibleScatterSeries } from './HighlightScatterSeries';

/**
 * Ур чадварын connected scatterplot (эх Excel-ийн REPORT DIAGRAMM графикийн
 * хуулбар): X = хэсгүүд, Y = үнэлгээний хувь 0..100.
 *
 * Дөрвөн цуваа — өөрийн үнэлгээ / ахлахын үнэлгээ / дундаж / багийн дундаж —
 * тус бүр цэг + түүнийг холбосон шугамтай (`<Scatter line>`). Цувааг ялгах
 * суваг нь ӨНГӨ (`chartSeries.ts`-ийн `useSeriesColors`, горим тус бүрд
 * тусдаа алхам) ба ЗУЗААН (`scatterSeriesHighlight.ts`) хоёр: дундаж 6px-ээр
 * хамгийн түрүүнд, багийн дундаж 2px тасархайгаар хамгийн сүүлд уншигдана.
 * Легендийн зураас ижил зузаанаа давтдаг тул эрэмбэ нь тайлбартайгаа таарна.
 *
 * Тайлбар (legend) болон level-ийн өнгөт шатлалыг recharts-ийн `<Legend>`
 * биш, ШУУД SVG дотор `<g>`-ээр зурсан нь санаатай: recharts-ийн Legend нь
 * SVG-ийн ГАДНА HTML болж зурагддаг тул `chartImage.ts`-ийн SVG→PNG
 * хөрвүүлэлтэд ордоггүй. recharts 3-т график дурын элементийг surface дотроо
 * шууд зурдаг болсон тул энэ нь ажиллана.
 */

/** График бүрийн нэг тэнхлэгийн (хэсгийн) утга. */
export interface ChartSection {
  /** Богино код — тэнхлэгийн шошго эндээс гарна («CONCEPT_DESIGN»). */
  code: string;
  /** Бүтэн нэр — tooltip-д. */
  title: string;
  /** Өөрийн үнэлгээний хувь (0..100). Тал бөглөөгүй бол null. */
  selfPct: number | null;
  /** Ахлахын үнэлгээний хувь. */
  seniorPct: number | null;
  /** Дундаж = үндсэн «Үнэлгээний хувь». */
  averagePct: number | null;
  /** Багийн дундаж жишиг шугам (хувь хүний харагдацад). */
  benchmarkPct?: number | null;
  /** `valueMode="mean"`-д ашиглагдана (1.0–5.0 дундаж, behavior part). */
  selfMean?: number | null;
  seniorMean?: number | null;
  averageMean?: number | null;
  benchmarkMean?: number | null;
  /** Хэсгийн дээд оноо (`must / item_count`) — `valueMode="mean"`-ий тэнхлэгт. */
  scaleMax?: number | null;
}

/**
 * Цуваа тус бүр ХЭДЭН хүн дээр бодогдсоныг легендэд бичих тоонууд.
 *
 * Багийн дундаж харагдацад л өгнө — «Өөрийн үнэлгээ (3)» гэж харагдсанаар
 * гурван шугам ижил хүмүүс дээр бодогдсон нь нүдэнд илэрхий болно. Хувь хүний
 * харагдацад өгөхгүй (тоо харагдахгүй).
 */
export interface SeriesCounts {
  self?: number;
  senior?: number;
  average?: number;
  benchmark?: number;
}

export interface SkillScatterChartProps {
  sections: ChartSection[];
  showSelf: boolean;
  showSenior: boolean;
  showAverage: boolean;
  showBenchmark?: boolean;
  /** Легенд дэх цуваа бүрийн хүний тоо. Өгөөгүй бол тоо харагдахгүй. */
  seriesCounts?: SeriesCounts;
  /** true — тоо (Y тэнхлэг, tooltip доторх хувь) БҮГД алга болно. */
  hideNumbers?: boolean;
  /** Схемийн level band-ууд. Өгөөгүй бол `DEFAULT_LEVELS`. */
  levels?: AssessmentLevelBand[];
  /** `chartImage.findChartSvg`-д ашиглах түлхүүр. */
  chartKey?: string;
  /** `'mean'` — зан чанарын 1.0–5.0 дундаж тэнхлэг (level slot биш, шууд тоо). */
  valueMode?: 'pct' | 'mean';
  /** `valueMode="mean"`-д Y тэнхлэгийн дээд хязгаар (ихэвчлэн 5). */
  scaleMax?: number;
  height?: number;
  className?: string;
}

type SideKey = HighlightSideKey;

interface Point {
  x: number;
  y: number;
  pct: number;
  code: string;
  title: string;
  side: SideKey;
}

const LEGEND_ROW_Y = 13;
const LEVELS_ROW_Y = 30;
const CHART_MARGIN = { top: 44, right: 16, bottom: 4, left: 0 } as const;

/**
 * Бүх цуваа ижил дугуй цэгтэй — ялгах суваг нь ӨНГӨ ба ЗУЗААН хоёр.
 *
 * `width` нь график доторх шугамын зузаантай ижил байх ёстой: легенд нь
 * «аль нь бүдүүн бэ» гэдгийг давтаж хэлж байж зузааны эрэмбэ уншигдана.
 */
function SeriesGlyph({ color, width }: { color: string; width: number }) {
  return (
    <>
      <line
        x1={-9}
        x2={9}
        y1={0}
        y2={0}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
      <circle r={4} fill={color} />
    </>
  );
}

interface LegendEntry {
  key: SideKey;
  label: string;
  color: string;
  /** Легендийн зураас нь график доторх цувааны ЯГ тэр зузааныг давтана. */
  width: number;
}

/**
 * Хэвтээ эгнээний X байрлалуудыг урьдчилан бодно.
 *
 * Render дотор `let x` -ийг өсгөх нь `react-hooks/immutability`-д баригддаг
 * тул байрлалыг ЦЭВЭР функцээр гаргаж, JSX нь зөвхөн уншина.
 */
function layoutRow(widths: number[], startX: number): number[] {
  const xs: number[] = [];
  let x = startX;
  for (const width of widths) {
    xs.push(x);
    x += width;
  }
  return xs;
}

/**
 * SVG дотор зурагдах тайлбар — дээд мөрөнд цуваанууд, доод мөрөнд level-ийн
 * өнгөт шатлал (арын ReferenceArea band-уудыг нэрлэж өгнө).
 */
function InlineLegend({
  entries,
  levels,
  hoveredSide,
  onHoverSide,
}: {
  entries: LegendEntry[];
  levels: AssessmentLevelBand[];
  hoveredSide: SideKey | null;
  onHoverSide: (side: SideKey | null) => void;
}) {
  const seriesX = layoutRow(
    entries.map((entry) => 28 + entry.label.length * 6.4 + 16),
    8,
  );
  const sortedBands = [...levels].sort((a, b) => a.minPct - b.minPct);
  const bandX = layoutRow(
    sortedBands.map((band) => 16 + band.label.length * 5.6 + 14),
    8,
  );

  return (
    <g aria-hidden="true">
      {entries.map((entry, i) => {
        const x = seriesX[i] ?? 8;
        const dim = hoveredSide !== null && hoveredSide !== entry.key;
        return (
          <g
            key={entry.key}
            style={{ cursor: 'pointer' }}
            pointerEvents="all"
            onMouseEnter={() => onHoverSide(entry.key)}
            onMouseLeave={() => onHoverSide(null)}
          >
            <rect
              x={x - 4}
              y={LEGEND_ROW_Y - 10}
              width={entry.label.length * 6.4 + 32}
              height={18}
              fill="transparent"
            />
            <g transform={`translate(${x + 9},${LEGEND_ROW_Y})`} opacity={dim ? 0.35 : 1}>
              <SeriesGlyph color={entry.color} width={entry.width} />
            </g>
            <text
              x={x + 24}
              y={LEGEND_ROW_Y}
              dy="0.34em"
              fontSize={11}
              fill="currentColor"
              fillOpacity={dim ? 0.35 : 1}
            >
              {entry.label}
            </text>
          </g>
        );
      })}
      {sortedBands.map((band, i) => {
        const x = bandX[i] ?? 8;
        return (
          <g key={band.code}>
            <rect x={x} y={LEVELS_ROW_Y - 4} width={8} height={8} rx={2} fill={band.color} />
            <text
              x={x + 13}
              y={LEVELS_ROW_Y}
              dy="0.34em"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.75}
            >
              {band.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Зан чанарын band-уудын доод хязгаарууд + дээд хязгаар — mean тэнхлэгийн тик. */
function meanAxisTicks(scaleMax: number): { value: number; label: string; code: string }[] {
  return [
    ...BEHAVIOR_BANDS.map((band) => ({ value: band.minMean, label: fmtMean(band.minMean), code: band.code })),
    { value: scaleMax, label: fmtMean(scaleMax), code: 'MAX' },
  ];
}

const MEAN_Y_AXIS_WIDTH = 32;

export function SkillScatterChart({
  sections,
  showSelf,
  showSenior,
  showAverage,
  showBenchmark: showBenchmarkProp,
  seriesCounts,
  hideNumbers = false,
  levels,
  chartKey = 'skill',
  valueMode = 'pct',
  scaleMax: scaleMaxProp,
  height = 340,
  className,
}: SkillScatterChartProps) {
  const { t } = useLanguage();
  const seriesColors = useSeriesColors();
  const bands = levels?.length ? levels : DEFAULT_LEVELS;
  const isMean = valueMode === 'mean';
  const meanScaleMax = scaleMaxProp ?? 5;

  const [hoveredSide, setHoveredSide] = useState<SideKey | null>(null);

  const axisLabels = useMemo(() => sectionChartLabels(sections), [sections]);
  const xAxisHeight = useMemo(() => xAxisHeightForLabels(axisLabels), [axisLabels]);
  const xFontSize = useMemo(
    () => xAxisFontSize(sections.length, Math.max(1, ...axisLabels.map((l) => l.length))),
    [sections.length, axisLabels],
  );

  const showBenchmark = isMean
    ? (showBenchmarkProp ?? sections.some((s) => s.benchmarkMean != null))
    : (showBenchmarkProp ?? sections.some((s) => s.benchmarkPct != null && s.benchmarkPct !== undefined));

  const sortedBands = useMemo(() => sortedLevelBands(bands), [bands]);
  const yTicks = useMemo(
    () => (isMean ? meanAxisTicks(meanScaleMax) : levelAxisTicks(bands)),
    [isMean, meanScaleMax, bands],
  );
  const yDomain = useMemo<[number, number]>(
    () => (isMean ? [0, meanScaleMax] : levelSlotDomain(bands)),
    [isMean, meanScaleMax, bands],
  );
  const yAxisWidth = useMemo(
    () => (isMean ? MEAN_Y_AXIS_WIDTH : levelYAxisWidth(bands)),
    [isMean, bands],
  );

  const series = useMemo(() => {
    const build = (side: SideKey, pick: (s: ChartSection) => number | null): Point[] =>
      sections
        .map((s, i) => ({ s, i, value: pick(s) }))
        .filter((row): row is { s: ChartSection; i: number; value: number } => row.value !== null)
        .map(({ s, i, value }) => {
          const y = isMean ? value : (pctToLevelSlot(bands, value) ?? value);
          return {
            x: i,
            y,
            pct: value,
            code: s.code,
            title: s.title,
            side,
          };
        });

    const raw = isMean
      ? {
          benchmark: build('benchmark', (s) => s.benchmarkMean ?? null),
          self: build('self', (s) => s.selfMean ?? null),
          senior: build('senior', (s) => s.seniorMean ?? null),
          average: build('average', (s) => s.averageMean ?? null),
        }
      : {
          benchmark: build('benchmark', (s) => s.benchmarkPct ?? null),
          self: build('self', (s) => s.selfPct),
          senior: build('senior', (s) => s.seniorPct),
          average: build('average', (s) => s.averagePct),
        };

    const visible: SideKey[] = [];
    if (showBenchmark) visible.push('benchmark');
    if (showSelf) visible.push('self');
    if (showSenior) visible.push('senior');
    if (showAverage) visible.push('average');

    const spread = spreadOverlappingY(visible.flatMap((side) => raw[side]), LEVEL_OVERLAP_SLOT, yDomain[1]);
    const result: Record<SideKey, Point[]> = {
      benchmark: [],
      self: [],
      senior: [],
      average: [],
    };
    for (const p of spread) result[p.side].push(p);
    return result;
  }, [sections, bands, yDomain, isMean, showBenchmark, showSelf, showSenior, showAverage]);

  const sideLabel: Record<SideKey, string> = {
    benchmark: t('assessments.sideBenchmark'),
    self: t('assessments.sideSelf'),
    senior: t('assessments.sideSenior'),
    average: t('assessments.sideAverage'),
  };

  /** Тоо өгөгдсөн бол «Өөрийн үнэлгээ (3)» — эс бөгөөс шошго дангаараа. */
  const withCount = (label: string, count: number | undefined): string =>
    typeof count === 'number' && Number.isFinite(count)
      ? t('assessments.seriesWithCount', { label, count })
      : label;

  const legendEntries: LegendEntry[] = [];
  const pushLegend = (key: SideKey, count: number | undefined) =>
    legendEntries.push({
      key,
      label: withCount(sideLabel[key], count),
      color: seriesColors[key],
      width: seriesStrokeWidth(key, null),
    });
  if (showBenchmark) pushLegend('benchmark', seriesCounts?.benchmark);
  if (showSelf) pushLegend('self', seriesCounts?.self);
  if (showSenior) pushLegend('senior', seriesCounts?.senior);
  if (showAverage) pushLegend('average', seriesCounts?.average);

  const activeSides = useMemo(() => {
    const out: SideKey[] = [];
    if (showBenchmark) out.push('benchmark');
    if (showSelf) out.push('self');
    if (showSenior) out.push('senior');
    if (showAverage) out.push('average');
    return out;
  }, [showBenchmark, showSelf, showSenior, showAverage]);

  if (!sections.length) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-lg border border-dashed text-body text-muted-foreground',
          className,
        )}
        style={{ height }}
      >
        {t('assessments.chartEmpty')}
      </div>
    );
  }

  const lastIndex = sections.length - 1;

  /** Level (pct горим) эсвэл зан чанарын (mean горим) арын туузнуудын мужууд. */
  const bandAreas = isMean
    ? BEHAVIOR_BANDS.map((band, i) => ({
        code: band.code,
        color: band.color,
        y1: band.minMean,
        y2: BEHAVIOR_BANDS[i + 1]?.minMean ?? meanScaleMax,
      }))
    : sortedBands.map((band, i) => ({ code: band.code, color: band.color, y1: i, y2: i + 1 }));

  /** Легендийн доод мөрөнд харуулах band-ууд — mean горимд behavior band-ууд. */
  const legendLevels: AssessmentLevelBand[] = isMean
    ? BEHAVIOR_BANDS.map((band) => ({
        code: band.code,
        label: band.label,
        color: band.color,
        minPct: band.minMean,
        maxPct: band.maxMean,
      }))
    : bands;

  return (
    <div
      data-assessment-chart={chartKey}
      className={cn('w-full text-muted-foreground', className)}
      style={{ height }}
      onMouseLeave={() => setHoveredSide(null)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ ...CHART_MARGIN }}>
          {/* Level шатлалын арын хөнгөн туузнууд — доод legend мөр нь тэднийг нэрлэнэ. */}
          {bandAreas.map((band) => (
            <ReferenceArea
              key={band.code}
              x1={-0.6}
              x2={lastIndex + 0.6}
              y1={band.y1}
              y2={band.y2}
              fill={band.color}
              fillOpacity={0.07}
              stroke="none"
              ifOverflow="hidden"
            />
          ))}

          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.16} />

          <XAxis
            type="number"
            dataKey="x"
            domain={[-0.6, lastIndex + 0.6]}
            ticks={sections.map((_, i) => i)}
            interval={0}
            tickLine={false}
            axisLine={{ stroke: 'currentColor', strokeOpacity: 0.25 }}
            height={xAxisHeight}
            tick={(props) => {
              const index = Number(props.payload?.value ?? props.index);
              const lines = axisLabels[index] ?? [];
              const cx = Number(props.x) || 0;
              const cy = Number(props.y) || 0;
              return (
                <g>
                  {lines.map((line, li) => (
                    <text
                      key={`${index}-${li}`}
                      x={cx}
                      y={cy}
                      dy={12 + li * 11}
                      textAnchor="middle"
                      fontSize={xFontSize}
                      fill="currentColor"
                    >
                      {line}
                    </text>
                  ))}
                </g>
              );
            }}
          />

          <YAxis
            type="number"
            dataKey="y"
            domain={yDomain}
            ticks={yTicks.map((t) => t.value)}
            tickLine={false}
            axisLine={false}
            width={yAxisWidth}
            hide={hideNumbers}
            tick={(props) => (
              <LevelYAxisTick
                x={Number(props.x)}
                y={Number(props.y)}
                payload={props.payload}
                ticks={yTicks}
              />
            )}
          />

          {/* Тэмдэгтийн хэмжээг тогтмолжуулна — 8px-ээс жижиг цэг хүрэхэд бэрх. */}
          <ZAxis type="number" range={[95, 95]} />

          <Tooltip
            cursor={false}
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const point = payload[0]?.payload as Point | undefined;
              if (!point) return null;
              const band = isMean ? bandForMean(point.pct) : levelForPct(bands, point.pct);
              return (
                <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold text-foreground">{point.title}</div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <span
                      className="inline-block size-2 rounded-full"
                      style={{ backgroundColor: seriesColors[point.side] }}
                      aria-hidden
                    />
                    <span className="text-muted-foreground">{sideLabel[point.side]}</span>
                    {isMean && (
                      <span className="ml-1 font-semibold tabular-nums text-foreground">
                        {fmtMean(point.pct)}
                      </span>
                    )}
                    {band && (
                      <span className="ml-1 font-semibold text-foreground">{band.label}</span>
                    )}
                  </div>
                </div>
              );
            }}
          />

          {activeSides.map((side) => (
            <VisibleScatterSeries
              key={side}
              side={side}
              name={sideLabel[side]}
              data={series[side]}
              hovered={hoveredSide}
              onHover={setHoveredSide}
            />
          ))}

          {activeSides.map((side) => (
            <HitScatterSeries
              key={`hit-${side}`}
              side={side}
              data={series[side]}
              onHover={setHoveredSide}
            />
          ))}

          <InlineLegend
            entries={legendEntries}
            levels={legendLevels}
            hoveredSide={hoveredSide}
            onHoverSide={setHoveredSide}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SkillScatterChart;
