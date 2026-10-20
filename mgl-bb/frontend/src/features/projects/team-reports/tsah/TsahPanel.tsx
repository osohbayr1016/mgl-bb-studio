import { TeamReportShell } from '@/features/projects/team-reports/TeamReportShell';
import {
  TsahReportDocument,
  TSAH_REPORT_STYLES,
} from '@/features/projects/team-reports/tsah/TsahDocument';
import { TSAH_SECTIONS } from '@/features/projects/team-reports/tsah/template';
import type { TsahReportAnswers } from '@/features/projects/team-reports/tsah/types';

interface TsahPanelProps {
  projectId: number;
  readOnly?: boolean;
}

export function TsahPanel({ projectId, readOnly = false }: TsahPanelProps) {
  return (
    <TeamReportShell<TsahReportAnswers>
      teamCode="TSAH"
      teamLabel="Цахилгаан"
      subtitle="Цахилгаан хангамж, дотоод цахилгаан, гэрэлтүүлэг"
      sections={TSAH_SECTIONS}
      renderDocument={(a) => <TsahReportDocument answers={a} />}
      documentStyles={TSAH_REPORT_STYLES}
      projectId={projectId}
      readOnly={readOnly}
    />
  );
}
