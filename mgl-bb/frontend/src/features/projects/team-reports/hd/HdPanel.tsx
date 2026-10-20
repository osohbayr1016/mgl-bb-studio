import { TeamReportShell } from '@/features/projects/team-reports/TeamReportShell';
import { HdReportDocument, HD_REPORT_STYLES } from '@/features/projects/team-reports/hd/HdDocument';
import { HD_SECTIONS } from '@/features/projects/team-reports/hd/template';
import type { HdReportAnswers } from '@/features/projects/team-reports/hd/types';

interface HdPanelProps {
  projectId: number;
  readOnly?: boolean;
}

export function HdPanel({ projectId, readOnly = false }: HdPanelProps) {
  return (
    <TeamReportShell<HdReportAnswers>
      teamCode="HD"
      teamLabel="Холбоо дохиолол"
      subtitle="Холбоо, дотоод сүлжээ, хяналт хамгаалалт, гал дохиолол"
      sections={HD_SECTIONS}
      renderDocument={(a) => <HdReportDocument answers={a} />}
      documentStyles={HD_REPORT_STYLES}
      projectId={projectId}
      readOnly={readOnly}
    />
  );
}
