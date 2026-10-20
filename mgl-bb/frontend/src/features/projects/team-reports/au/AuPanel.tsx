import { TeamReportShell } from '@/features/projects/team-reports/TeamReportShell';
import { AuReportDocument, AU_REPORT_STYLES } from '@/features/projects/team-reports/au/AuDocument';
import { AU_SECTIONS } from '@/features/projects/team-reports/au/template';
import type { AuReportAnswers } from '@/features/projects/team-reports/au/types';

interface AuPanelProps {
  projectId: number;
  readOnly?: boolean;
}

export function AuPanel({ projectId, readOnly = false }: AuPanelProps) {
  return (
    <TeamReportShell<AuReportAnswers>
      teamCode="AU"
      teamLabel="Автоматжуулалт"
      subtitle="Барилгын инженерийн системийн автоматжуулалт (BMS)"
      sections={AU_SECTIONS}
      renderDocument={(a) => <AuReportDocument answers={a} />}
      documentStyles={AU_REPORT_STYLES}
      projectId={projectId}
      readOnly={readOnly}
    />
  );
}
