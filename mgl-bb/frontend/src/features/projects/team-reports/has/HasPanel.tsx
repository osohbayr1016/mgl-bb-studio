import { TeamReportShell } from '@/features/projects/team-reports/TeamReportShell';
import {
  HasReportDocument,
  HAS_REPORT_STYLES,
} from '@/features/projects/team-reports/has/HasDocument';
import { HAS_SECTIONS } from '@/features/projects/team-reports/has/template';
import type { HasReportAnswers } from '@/features/projects/team-reports/has/types';

interface HasPanelProps {
  projectId: number;
  readOnly?: boolean;
}

export function HasPanel({ projectId, readOnly = false }: HasPanelProps) {
  return (
    <TeamReportShell<HasReportAnswers>
      teamCode="HAS"
      teamLabel="Халаалт, агаар сэлгэлт"
      subtitle="Халаалт, АС, кондиционер, гал утаанаас хамгаалах систем"
      sections={HAS_SECTIONS}
      renderDocument={(a) => <HasReportDocument answers={a} />}
      documentStyles={HAS_REPORT_STYLES}
      projectId={projectId}
      readOnly={readOnly}
    />
  );
}
