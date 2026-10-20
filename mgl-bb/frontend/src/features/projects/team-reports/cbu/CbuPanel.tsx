import { TeamReportShell } from '@/features/projects/team-reports/TeamReportShell';
import {
  CbuReportDocument,
  CBU_REPORT_STYLES,
} from '@/features/projects/team-reports/cbu/CbuDocument';
import { CBU_SECTIONS } from '@/features/projects/team-reports/cbu/template';
import type { CbuReportAnswers } from '@/features/projects/team-reports/cbu/types';

interface CbuPanelProps {
  projectId: number;
  readOnly?: boolean;
}

export function CbuPanel({ projectId, readOnly = false }: CbuPanelProps) {
  return (
    <TeamReportShell<CbuReportAnswers>
      teamCode="TSBU"
      teamLabel="Цэвэр, бохир ус"
      subtitle="Усан хангамж, ариутгах татуурга, гал тэсвэрлэх систем"
      sections={CBU_SECTIONS}
      renderDocument={(a) => <CbuReportDocument answers={a} />}
      documentStyles={CBU_REPORT_STYLES}
      projectId={projectId}
      readOnly={readOnly}
    />
  );
}
