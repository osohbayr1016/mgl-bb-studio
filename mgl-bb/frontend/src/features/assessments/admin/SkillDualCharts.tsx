import { useMemo } from 'react';

import { useLanguage } from '@/shared/i18n';

import type { AssessmentLevelBand } from '../types';
import { BehaviorRadarChart } from '../components/BehaviorRadarChart';
import { SkillScatterChart, type ChartSection, type SeriesCounts } from '../components/SkillScatterChart';
import { chartKeyFor, chartKeyForRadar } from '../lib/chartImage';

interface Props {
  sections: ChartSection[];
  scope: string;
  partId: string;
  levels: AssessmentLevelBand[];
  showSelf: boolean;
  showSenior: boolean;
  showAverage: boolean;
  showBenchmark?: boolean;
  seriesCounts?: SeriesCounts;
}

/** Ур чадварын part: scatter дээр, spider/radar доор — босоо хоёр график. */
export function SkillDualCharts({
  sections,
  scope,
  partId,
  levels,
  showSelf,
  showSenior,
  showAverage,
  showBenchmark,
  seriesCounts,
}: Props) {
  const { t } = useLanguage();
  const scatterKey = useMemo(() => chartKeyFor(scope, partId), [scope, partId]);
  const radarKey = useMemo(() => chartKeyForRadar(scope, partId), [scope, partId]);

  const common = {
    sections,
    showSelf,
    showSenior,
    showAverage: showSelf && showSenior && showAverage,
    showBenchmark,
    seriesCounts,
    levels,
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="mb-2 text-micro font-medium text-muted-foreground">
          {t('assessments.chartScatterCaption')}
        </p>
        <SkillScatterChart {...common} chartKey={scatterKey} />
      </div>
      <div>
        <p className="mb-2 text-micro font-medium text-muted-foreground">
          {t('assessments.chartRadarCaption')}
        </p>
        <BehaviorRadarChart {...common} chartKey={radarKey} height={380} levelAxis />
      </div>
    </div>
  );
}

export default SkillDualCharts;
