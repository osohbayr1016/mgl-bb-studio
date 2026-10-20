import { useMemo } from 'react';

import { useLanguage } from '@/shared/i18n';

import type { AssessmentLevelBand } from '../types';
import { BehaviorRadarChart } from '../components/BehaviorRadarChart';
import { SkillScatterChart, type ChartSection } from '../components/SkillScatterChart';
import { chartKeyFor, chartKeyForRadar } from '../lib/chartImage';
import { sectionChartLabels, xAxisHeightForLabels } from '../lib/chartAxisLabels';

interface Props {
  sections: ChartSection[];
  scope: string;
  partId: string;
  levels: AssessmentLevelBand[];
  showSelf: boolean;
  showSenior: boolean;
  showAverage: boolean;
  showBenchmark?: boolean;
  benchCount?: number;
}

/** Зан чанарын part: scatter + spider — dialog болон дэлгэрэнгүй харагдацад. */
export function BehaviorPartDualCharts({
  sections,
  scope,
  partId,
  levels,
  showSelf,
  showSenior,
  showAverage,
  showBenchmark,
  benchCount,
}: Props) {
  const { t } = useLanguage();
  const scatterKey = useMemo(() => chartKeyFor(scope, partId), [scope, partId]);
  const radarKey = useMemo(() => chartKeyForRadar(scope, partId), [scope, partId]);
  const scatterHeight = useMemo(() => {
    const labels = sectionChartLabels(sections);
    return 280 + xAxisHeightForLabels(labels);
  }, [sections]);

  const scaleMax = sections[0]?.scaleMax ?? 5;

  const common = {
    sections,
    showSelf,
    showSenior,
    showAverage: showSelf && showSenior && showAverage,
    showBenchmark,
    seriesCounts: showBenchmark && benchCount ? { benchmark: benchCount } : undefined,
    levels,
    valueMode: 'mean' as const,
    scaleMax,
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-micro font-medium text-muted-foreground">
          {t('assessments.chartScatterCaption')}
        </p>
        <SkillScatterChart {...common} chartKey={scatterKey} height={scatterHeight} />
      </div>
      <div>
        <p className="mb-2 text-micro font-medium text-muted-foreground">
          {t('assessments.chartRadarCaption')}
        </p>
        <BehaviorRadarChart {...common} chartKey={radarKey} height={360} />
      </div>
    </div>
  );
}

export default BehaviorPartDualCharts;
