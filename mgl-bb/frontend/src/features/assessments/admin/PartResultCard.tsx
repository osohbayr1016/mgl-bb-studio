import { useMemo } from 'react';

import { useLanguage } from '@/shared/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/card';

import type { AssessmentLevelBand } from '../types';
import type { ResultPart } from '../lib/aggregate';
import { toChartSections } from '../lib/chartImage';
import { fmtPct } from '../lib/exportAssessmentXlsx';
import { bandForMean, fmtMean, partMean, partScaleMax } from '../lib/behaviorScale';
import { BehaviorRadarChart } from '../components/BehaviorRadarChart';
import { SkillScatterChart, type SeriesCounts } from '../components/SkillScatterChart';
import { BehaviorBandTag, LevelTag } from '../components/LevelTag';
import { ReportDiagramTable } from './ReportDiagramTable';
import { SkillDualCharts } from './SkillDualCharts';

interface PartChartProps {
  part: ResultPart;
  levels: AssessmentLevelBand[];
  showSelf: boolean;
  showSenior: boolean;
  showAverage: boolean;
  showBenchmark?: boolean;
  benchmarkSections?: ReturnType<typeof toChartSections>;
  seriesCounts?: SeriesCounts;
  chartKey: string;
  chartScope: string;
}

export function PartChart({
  part,
  levels,
  showSelf,
  showSenior,
  showAverage,
  showBenchmark,
  benchmarkSections,
  seriesCounts,
  chartKey,
  chartScope,
}: PartChartProps) {
  const sections = useMemo(
    () => toChartSections(part, benchmarkSections),
    [part, benchmarkSections],
  );
  const common = {
    sections,
    showSelf,
    showSenior,
    showAverage: showSelf && showSenior && showAverage,
    showBenchmark,
    seriesCounts,
    levels,
  };

  if (part.chart === 'scatter' && part.weighted) {
    return (
      <SkillDualCharts
        {...common}
        scope={chartScope}
        partId={part.part_id}
      />
    );
  }

  if (part.chart === 'radar') {
    return (
      <BehaviorRadarChart
        {...common}
        chartKey={chartKey}
        valueMode={part.weighted ? undefined : 'mean'}
        scaleMax={part.weighted ? undefined : (sections[0]?.scaleMax ?? 5)}
      />
    );
  }

  return <SkillScatterChart {...common} chartKey={chartKey} />;
}

interface Props {
  part: ResultPart;
  levels: AssessmentLevelBand[];
  showSelf: boolean;
  showSenior: boolean;
  showAverage: boolean;
  showBenchmark?: boolean;
  benchmarkSections?: ReturnType<typeof toChartSections>;
  seriesCounts?: SeriesCounts;
  chartKey: string;
  /** `chartKeyFor`-ийн scope хэсэг (`round`, `detail`, …). */
  chartScope: string;
  detailNumbers: boolean;
}

export function PartResultCard({
  part,
  levels,
  showSelf,
  showSenior,
  showAverage,
  showBenchmark,
  benchmarkSections,
  seriesCounts,
  chartKey,
  chartScope,
  detailNumbers,
}: Props) {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-baseline gap-2 space-y-0">
        <CardTitle className="text-base">{part.title}</CardTitle>
        {part.weighted ? (
          <span className="ml-auto inline-flex items-baseline gap-2">
            <span className="text-micro text-muted-foreground">{t('assessments.partOverall')}</span>
            <span className="text-2xl font-bold tabular-nums">{fmtPct(part.overall_pct)}</span>
            <LevelTag level={part.overall_level} />
          </span>
        ) : (
          <span className="ml-auto inline-flex items-baseline gap-2">
            <span className="text-micro text-muted-foreground">{t('assessments.partOverall')}</span>
            <span className="text-2xl font-bold tabular-nums">
              {fmtMean(partMean(part))} / {fmtMean(partScaleMax(part))}
            </span>
            <BehaviorBandTag band={bandForMean(partMean(part))} />
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        <PartChart
          part={part}
          levels={levels}
          showSelf={showSelf}
          showSenior={showSenior}
          showAverage={showAverage}
          showBenchmark={showBenchmark}
          benchmarkSections={benchmarkSections}
          seriesCounts={seriesCounts}
          chartKey={chartKey}
          chartScope={chartScope}
        />
        <ReportDiagramTable part={part} detail={detailNumbers} />
      </CardContent>
    </Card>
  );
}

export default PartResultCard;
