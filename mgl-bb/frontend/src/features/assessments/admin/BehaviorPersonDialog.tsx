import { useMemo, useRef, useState } from 'react';
import { ExternalLink, FileSpreadsheet, Loader2 } from 'lucide-react';

import { useLanguage } from '@/shared/i18n';
import { toast } from '@/shared/components/Toast';
import { formatDisplayName } from '@/shared/lib/formatting';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';

import type { ParticipantResult } from '../api';
import type { AssessmentLevelBand, AssessmentSchema } from '../types';
import { averageParts, buildCohort, sidesPresent } from '../lib/aggregate';
import { behaviorPartFromResult, findBehaviorPart } from '../lib/behaviorPart';
import { captureDualChartsForPart, toChartSections } from '../lib/chartImage';
import { exportParticipantXlsx } from '../lib/exportAssessmentXlsx';
import { BehaviorPartDualCharts } from './BehaviorPartDualCharts';
import { BehaviorPersonBadges } from './BehaviorPersonBadges';
import { ReportDiagramTable } from './ReportDiagramTable';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  person: ParticipantResult | null;
  cohortFiltered: ParticipantResult[];
  levels: AssessmentLevelBand[];
  round: { name: string; period: string };
  schema: AssessmentSchema;
  detailNumbers: boolean;
  onOpenFullPage: (userId: number) => void;
}

export function BehaviorPersonDialog({
  open,
  onOpenChange,
  person,
  cohortFiltered,
  levels,
  round,
  schema,
  detailNumbers,
  onOpenFullPage,
}: Props) {
  const { t } = useLanguage();
  const chartsRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const behaviorPart = useMemo(
    () => (person ? behaviorPartFromResult(person) : null),
    [person],
  );

  const benchBehavior = useMemo(() => {
    if (!person) return null;
    let scope = cohortFiltered;
    if (person.team_code) {
      const team = cohortFiltered.filter((r) => r.team_code === person.team_code);
      if (team.length >= 2) scope = team;
    }
    const members = buildCohort(scope).members;
    if (members.length < 2) return null;
    return findBehaviorPart(averageParts(members, levels));
  }, [person, cohortFiltered, levels]);

  const benchCount = useMemo(() => {
    if (!person) return 0;
    let scope = cohortFiltered;
    if (person.team_code) {
      const team = cohortFiltered.filter((r) => r.team_code === person.team_code);
      if (team.length >= 2) scope = team;
    }
    return buildCohort(scope).members.length;
  }, [person, cohortFiltered]);

  const sides = useMemo(
    () => sidesPresent(behaviorPart ? [behaviorPart] : []),
    [behaviorPart],
  );
  const showAverage = sides.self && sides.senior;
  const sections = useMemo(() => {
    if (!behaviorPart) return [];
    const benchSections = benchBehavior ? toChartSections(benchBehavior) : undefined;
    return toChartSections(behaviorPart, benchSections);
  }, [behaviorPart, benchBehavior]);

  const scope = person ? `behavior-dialog-${person.user_id}` : 'behavior-dialog';

  const handleExport = async () => {
    if (!person || !behaviorPart) return;
    setExporting(true);
    try {
      const charts = await captureDualChartsForPart(
        chartsRef.current,
        behaviorPart,
        scope,
        formatDisplayName(person.full_name),
        t('assessments.chartRadarExportSuffix'),
      );
      if (charts.some((c) => !c.dataUrl)) toast.warn(t('assessments.exportNoCharts'));
      await exportParticipantXlsx({ round, schema, result: person, charts, t });
      toast.success(t('assessments.exportDone'));
    } catch {
      toast.error(t('assessments.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl sm:max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {person ? formatDisplayName(person.full_name) : t('assessments.behaviorSectionTitle')}
          </DialogTitle>
          {person && (
            <p className="text-sm text-muted-foreground">
              {[person.position, person.team_code, `${round.name} · ${round.period}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </DialogHeader>

        {person && behaviorPart ? (
          <div ref={chartsRef} className="space-y-4">
            <BehaviorPersonBadges person={person} />
            <BehaviorPartDualCharts
              sections={sections}
              scope={scope}
              partId={behaviorPart.part_id}
              levels={levels}
              showSelf={sides.self}
              showSenior={sides.senior}
              showAverage={showAverage}
              showBenchmark={!!benchBehavior}
              benchCount={benchCount}
            />
            <ReportDiagramTable part={behaviorPart} detail={detailNumbers} />
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('assessments.behaviorNoData')}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            disabled={exporting || !person || !behaviorPart}
            onClick={() => void handleExport()}
          >
            {exporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FileSpreadsheet className="size-4" aria-hidden />
            )}
            {t('assessments.exportExcel')}
          </Button>
          {person && (
            <Button onClick={() => onOpenFullPage(person.user_id)}>
              <ExternalLink className="size-4" aria-hidden />
              {t('assessments.behaviorOpenFullAnswers')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default BehaviorPersonDialog;
