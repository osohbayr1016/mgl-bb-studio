import { useMemo, useState } from 'react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  useChartHeight,
  useChartWidth,
} from 'recharts';

import { useLanguage } from '@/shared/i18n';
import { cn } from '@/shared/lib/utils';

import type { AssessmentLevelBand } from '../types';
import { DEFAULT_LEVELS, levelForPct } from '../lib/score';
import { useSeriesColors } from '../lib/chartSeries';
import { BEHAVIOR_BANDS, bandForMean, fmtMean } from '../lib/behaviorScale';
import {
  levelAxisTicksPct,
  overlapStepPct,
  pctToLevelSlotPct,
  spreadLevelValuesAtAxis,
} from '../lib/levelChartAxis';
import type { ChartSection, SeriesCounts } from './SkillScatterChart';
import { sectionChartLabels, xAxisFontSize } from '../lib/chartAxisLabels';
import { seriesStrokeWidth, seriesVisualOpacity } from '../lib/scatterSeriesHighlight';

/**
 * Зан чанарын spider / radar график: хэсэг бүр нэг тэнхлэг, радиус = 0..100%.
 *
 * Ур чадварын scatter-тэй ижил гурван цуваа (өөрийн / ахлахын / дундаж),
 * ижил өнгө/зузаан (`useSeriesColors` + `seriesStrokeWidth`), ижил
 * `hideNumbers` prop. Зөвхөн «дундаж» олон өнцөгт
 * талбайгаа дүүргэнэ (`AREA_FILL_OPACITY`) — өөрийн ба ахлахынх нь зөвхөн
 * контур шугам, ингэснээр давхарласан гурван дүрс бүгд уншигдана.
 *
 * Tooltip нь `axis` төрлийн (RadarChart-д зөвхөн тэр л зөвшөөрөгддөг) тул
 * нэг тэнхлэг дээр гурван талын утга зэрэг гарна.
 *
 * Legend-ийг SVG дотор `<g>`-ээр зурсан шалтгаан нь `SkillScatterChart`-тай
 * ижил — recharts-ийн `<Legend>` нь SVG-ийн гадна HTML болж зурагддаг тул
 * Excel-д зориулсан SVG→PNG хөрвүүлэлтэд ордоггүй.
 */

export interface BehaviorRadarChartProps {
  sections: ChartSection[];
  showSelf: boolean;
  showSenior: boolean;
  showAverage: boolean;
  showBenchmark?: boolean;
  /** Легенд дэх цуваа бүрийн хүний тоо. Өгөөгүй бол тоо харагдахгүй. */
  seriesCounts?: SeriesCounts;
  /** true — радиусын тоон шошго ба tooltip доторх хувь БҮГД алга болно. */
  hideNumbers?: boolean;
  levels?: AssessmentLevelBand[];
  /** `chartImage.findChartSvg`-д ашиглах түлхүүр. */
  chartKey?: string;
  /** Ур чадварын spider: хувь биш level төв, radial шошго = Intern…Expert. */
  levelAxis?: boolean;
  /** `'mean'` — зан чанарын 1.0–5.0 дундаж радиус (level slot биш, шууд тоо). */
  valueMode?: 'pct' | 'mean';
  /** `valueMode="mean"`-д радиусын дээд хязгаар (ихэвчлэн 5). */
  scaleMax?: number;
  height?: number;
  className?: string;
}

type SideKey = 'self' | 'senior' | 'average';

/**
 * Олон өнцөгтийн дотоод дүүргэлт. Өөрийн/ахлахын цуваа = 0 (зөвхөн шугам),
 * зөвхөн дундаж дүүргэлттэй тул давхцсан хэсэг бүрхэгддэггүй.
 */
const AREA_FILL_OPACITY: Record<SideKey, number> = {
  self: 0,
  senior: 0,
  average: 0.22,
};

const LEGEND_ROW_Y = 14;
const BAND_ROW_Y = 30;

/** `<RadarChart>`-ийн `margin`/`outerRadius`-той ЯГ ижил байх ёстой — доор
 *  band цагиргуудын радиус тооцоход дахин ашиглана. */
const RADAR_MARGIN = { top: 44, right: 28, bottom: 8, left: 28 } as const;
const RADAR_OUTER_RADIUS_RATIO = 0.68;

interface RadarRow {
  axis: string;
  title: string;
  self: number | null;
  senior: number | null;
  average: number | null;
  selfPct: number | null;
  seniorPct: number | null;
  averagePct: number | null;
}

/** Бүх цуваа ижил дугуй цэгтэй — ялгах суваг нь зөвхөн өнгө. */
function SeriesGlyph({ color }: { color: string }) {
  return (
    <>
      <line x1={-9} x2={9} y1={0} y2={0} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <circle r={4} fill={color} />
    </>
  );
}

/**
 * Хэвтээ эгнээний X байрлалуудыг урьдчилан бодно — render дотор `let x`-ийг
 * өсгөх нь `react-hooks/immutability`-д баригддаг.
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

function InlineLegend({
  entries,
  bandEntries,
  hoveredSide,
  onHoverSide,
}: {
  entries: { key: SideKey; label: string; color: string }[];
  /** Зан чанарын band-уудын тайлбар мөр (`valueMode="mean"`-д). */
  bandEntries?: { code: string; label: string; color: string }[];
  hoveredSide: SideKey | null;
  onHoverSide: (side: SideKey | null) => void;
}) {
  const xs = layoutRow(
    entries.map((entry) => 28 + entry.label.length * 6.4 + 16),
    8,
  );
  const bandXs = layoutRow(
    (bandEntries ?? []).map((band) => 16 + band.label.length * 5.6 + 14),
    8,
  );
  return (
    <g aria-hidden="true">
      {(bandEntries ?? []).map((band, i) => {
        const x = bandXs[i] ?? 8;
        return (
          <g key={band.code}>
            <rect x={x} y={BAND_ROW_Y - 4} width={8} height={8} rx={2} fill={band.color} />
            <text x={x + 13} y={BAND_ROW_Y} dy="0.34em" fontSize={9} fill="currentColor" fillOpacity={0.75}>
              {band.label}
            </text>
          </g>
        );
      })}
      {entries.map((entry, i) => {
        const x = xs[i] ?? 8;
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
              <SeriesGlyph color={entry.color} />
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
    </g>
  );
}

/**
 * Зан чанарын band-уудын босго радиустай тохирсон цагиргууд.
 *
 * `RadarChart`-ийн ДОТОРХ шууд хүүхэд байх ёстой (SVG child, HTML overlay
 * биш) — Excel export-ын SVG→PNG хөрвүүлэлт зөвхөн `<svg>` доторх зангилааг
 * хардаг (`chartImage.ts`). Төв/радиус тооцоолол `RADAR_MARGIN` ба
 * `RADAR_OUTER_RADIUS_RATIO`-г `<RadarChart margin outerRadius>`-тэй ЯГ
 * ижил барих ёстой — эс бөгөөс цагирган band-ууд өгөгдлийн цэгүүдтэй
 * зэрэгцэхгүй болно.
 */
function BehaviorBandRings({ scaleMax }: { scaleMax: number }) {
  const width = useChartWidth();
  const height = useChartHeight();
  if (!width || !height) return null;
  const cx = width / 2;
  const cy = height / 2;
  const maxRadius =
    Math.min(width - RADAR_MARGIN.left - RADAR_MARGIN.right, height - RADAR_MARGIN.top - RADAR_MARGIN.bottom) / 2;
  const outerRadius = Math.max(0, maxRadius) * RADAR_OUTER_RADIUS_RATIO;

  return (
    <g aria-hidden="true" pointerEvents="none">
      {BEHAVIOR_BANDS.map((band) => (
        <circle
          key={band.code}
          cx={cx}
          cy={cy}
          r={Math.max(0, (band.minMean / scaleMax) * outerRadius)}
          fill="none"
          stroke={band.color}
          strokeOpacity={0.35}
          strokeDasharray="3 3"
        />
      ))}
    </g>
  );
}

export function BehaviorRadarChart({
  sections,
  showSelf,
  showSenior,
  showAverage,
  seriesCounts,
  hideNumbers = false,
  levels,
  chartKey = 'behavior',
  levelAxis = false,
  valueMode = 'pct',
  scaleMax: scaleMaxProp,
  height = 340,
  className,
}: BehaviorRadarChartProps) {
  const { t } = useLanguage();
  const seriesColors = useSeriesColors();
  const bands = levels?.length ? levels : DEFAULT_LEVELS;
  const isMean = valueMode === 'mean';
  const meanScaleMax = scaleMaxProp ?? 5;
  const [hoveredSide, setHoveredSide] = useState<SideKey | null>(null);

  const radiusTicks = useMemo(
    () => (levelAxis ? levelAxisTicksPct(bands) : []),
    [bands, levelAxis],
  );

  const meanTicks = useMemo(
    () => (isMean ? [...BEHAVIOR_BANDS.map((b) => b.minMean), meanScaleMax] : []),
    [isMean, meanScaleMax],
  );
  /** mean-тэнхлэгийн tick → band НЭР (levelAxis горимд тоо биш үг харуулна). */
  const meanTickLabel = (value: number): string | undefined =>
    (BEHAVIOR_BANDS.find((b) => Math.abs(b.minMean - value) < 0.01) ?? bandForMean(value))?.label;

  const axisLines = useMemo(() => sectionChartLabels(sections), [sections]);
  const axisFontSize = useMemo(
    () => xAxisFontSize(sections.length, Math.max(1, ...axisLines.map((l) => l.length))),
    [sections.length, axisLines],
  );

  const data: RadarRow[] = useMemo(
    () =>
      sections.map((s, i) => {
        if (isMean) {
          return {
            axis: (axisLines[i] ?? []).join(' ') || s.code || s.title,
            title: s.title,
            selfPct: s.selfMean ?? null,
            seniorPct: s.seniorMean ?? null,
            averagePct: s.averageMean ?? null,
            self: s.selfMean ?? null,
            senior: s.seniorMean ?? null,
            average: s.averageMean ?? null,
          };
        }
        const toPlot = (pct: number | null) => {
          if (pct == null) return null;
          return levelAxis ? pctToLevelSlotPct(bands, pct) : pct;
        };
        const plotted = {
          self: toPlot(s.selfPct),
          senior: toPlot(s.seniorPct),
          average: toPlot(s.averagePct),
        };
        const spread = levelAxis
          ? spreadLevelValuesAtAxis(plotted, overlapStepPct(bands), 100)
          : plotted;
        return {
          axis: (axisLines[i] ?? []).join(' ') || s.code || s.title,
          title: s.title,
          selfPct: s.selfPct,
          seniorPct: s.seniorPct,
          averagePct: s.averagePct,
          self: spread.self ?? null,
          senior: spread.senior ?? null,
          average: spread.average ?? null,
        };
      }),
    [sections, axisLines, bands, levelAxis, isMean],
  );

  const sideLabel: Record<SideKey, string> = {
    self: t('assessments.sideSelf'),
    senior: t('assessments.sideSenior'),
    average: t('assessments.sideAverage'),
  };

  /** Тоо өгөгдсөн бол «Дундаж (3)» — эс бөгөөс шошго дангаараа. */
  const withCount = (label: string, count: number | undefined): string =>
    typeof count === 'number' && Number.isFinite(count)
      ? t('assessments.seriesWithCount', { label, count })
      : label;

  const legendEntries: { key: SideKey; label: string; color: string }[] = [];
  if (showSelf)
    legendEntries.push({
      key: 'self',
      label: withCount(sideLabel.self, seriesCounts?.self),
      color: seriesColors.self,
    });
  if (showSenior)
    legendEntries.push({
      key: 'senior',
      label: withCount(sideLabel.senior, seriesCounts?.senior),
      color: seriesColors.senior,
    });
  if (showAverage)
    legendEntries.push({
      key: 'average',
      label: withCount(sideLabel.average, seriesCounts?.average),
      color: seriesColors.average,
    });

  const bandEntries = isMean
    ? BEHAVIOR_BANDS.map((band) => ({ code: band.code, label: band.label, color: band.color }))
    : undefined;

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

  return (
    <div
      data-assessment-chart={chartKey}
      className={cn('w-full text-muted-foreground', className)}
      style={{ height }}
      onMouseLeave={() => setHoveredSide(null)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart
          data={data}
          outerRadius={`${RADAR_OUTER_RADIUS_RATIO * 100}%`}
          margin={RADAR_MARGIN}
        >
          {isMean && !hideNumbers && <BehaviorBandRings scaleMax={meanScaleMax} />}
          <PolarGrid stroke="currentColor" strokeOpacity={0.2} />
          <PolarAngleAxis
            dataKey="axis"
            tick={(props) => {
              const index = Number(props.index) || 0;
              const lines = axisLines[index] ?? [String(props.payload?.value ?? '')];
              const cx = Number(props.x) || 0;
              const cy = Number(props.y) || 0;
              return (
                <g>
                  {lines.map((line, li) => (
                    <text
                      key={`${index}-${li}`}
                      x={cx}
                      y={cy}
                      dy={(li - (lines.length - 1) / 2) * 11 + 3}
                      textAnchor={props.textAnchor}
                      fontSize={axisFontSize}
                      fill="currentColor"
                    >
                      {line}
                    </text>
                  ))}
                </g>
              );
            }}
          />
          <PolarRadiusAxis
            domain={isMean ? [0, meanScaleMax] : [0, 100]}
            ticks={
              isMean
                ? (meanTicks as unknown as [])
                : levelAxis
                  ? (radiusTicks.map((t) => t.value) as unknown as [])
                  : undefined
            }
            tickCount={isMean || levelAxis ? undefined : 5}
            axisLine={false}
            tick={
              hideNumbers
                ? false
                : levelAxis
                  ? (props) => {
                      const value = Number(props.payload?.value);
                      const label = isMean
                        ? meanTickLabel(value)
                        : radiusTicks.find((t) => Math.abs(t.value - value) < 0.01)?.label;
                      if (!label) return null;
                      return (
                        <text
                          x={props.x}
                          y={props.y}
                          dy="0.32em"
                          textAnchor="middle"
                          fontSize={9}
                          fill="currentColor"
                        >
                          {label}
                        </text>
                      );
                    }
                  : { fontSize: 9, fill: 'currentColor' }
            }
            tickFormatter={
              levelAxis ? undefined : isMean ? (value: number) => fmtMean(value) : (value: number) => `${value}%`
            }
          />

          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null;
              const row = payload[0]?.payload as RadarRow | undefined;
              if (!row) return null;
              const rows: { key: SideKey; pct: number | null }[] = [];
              if (showSelf) rows.push({ key: 'self', pct: row.selfPct });
              if (showSenior) rows.push({ key: 'senior', pct: row.seniorPct });
              if (showAverage) rows.push({ key: 'average', pct: row.averagePct });
              return (
                <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold text-foreground">{row.title}</div>
                  <div className="mt-1 space-y-0.5">
                    {rows.map((entry) => {
                      const band = isMean ? bandForMean(entry.pct) : levelForPct(bands, entry.pct);
                      return (
                        <div key={entry.key} className="flex items-center gap-1.5">
                          <span
                            className="inline-block size-2 rounded-full"
                            style={{ backgroundColor: seriesColors[entry.key] }}
                            aria-hidden
                          />
                          <span className="text-muted-foreground">{sideLabel[entry.key]}</span>
                          {levelAxis || hideNumbers ? (
                            band && (
                              <span className="ml-1 font-semibold text-foreground">{band.label}</span>
                            )
                          ) : (
                            <>
                              <span className="ml-1 font-semibold tabular-nums text-foreground">
                                {entry.pct === null ? '—' : isMean ? fmtMean(entry.pct) : `${entry.pct.toFixed(1)}%`}
                              </span>
                              {band && (
                                <span className="ml-1 text-muted-foreground">{band.label}</span>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }}
          />

          {/* Дундаж хамгийн эхэнд — дүүргэлттэй цорын ганц дүрс тул бусад
              цувааны контур шугамын ДООР зурагдана. */}
          {showAverage && (
            <Radar
              name={sideLabel.average}
              dataKey="average"
              stroke={seriesColors.average}
              strokeWidth={seriesStrokeWidth('average', hoveredSide)}
              strokeOpacity={seriesVisualOpacity('average', hoveredSide)}
              fill={seriesColors.average}
              fillOpacity={AREA_FILL_OPACITY.average * seriesVisualOpacity('average', hoveredSide)}
              dot={{ r: 3, strokeWidth: 0, fill: seriesColors.average }}
              isAnimationActive={false}
              onMouseEnter={() => setHoveredSide('average')}
              onMouseLeave={() => setHoveredSide(null)}
            />
          )}
          {showSelf && (
            <Radar
              name={sideLabel.self}
              dataKey="self"
              stroke={seriesColors.self}
              strokeWidth={seriesStrokeWidth('self', hoveredSide)}
              strokeOpacity={seriesVisualOpacity('self', hoveredSide)}
              fill="none"
              fillOpacity={AREA_FILL_OPACITY.self}
              dot={{ r: 3, strokeWidth: 0, fill: seriesColors.self }}
              isAnimationActive={false}
              onMouseEnter={() => setHoveredSide('self')}
              onMouseLeave={() => setHoveredSide(null)}
            />
          )}
          {showSenior && (
            <Radar
              name={sideLabel.senior}
              dataKey="senior"
              stroke={seriesColors.senior}
              strokeWidth={seriesStrokeWidth('senior', hoveredSide)}
              strokeOpacity={seriesVisualOpacity('senior', hoveredSide)}
              fill="none"
              fillOpacity={AREA_FILL_OPACITY.senior}
              dot={{ r: 3, strokeWidth: 0, fill: seriesColors.senior }}
              isAnimationActive={false}
              onMouseEnter={() => setHoveredSide('senior')}
              onMouseLeave={() => setHoveredSide(null)}
            />
          )}

          <InlineLegend
            entries={legendEntries}
            bandEntries={bandEntries}
            hoveredSide={hoveredSide}
            onHoverSide={setHoveredSide}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default BehaviorRadarChart;
