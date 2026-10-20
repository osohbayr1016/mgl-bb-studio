import { TeamReportShell } from '@/features/projects/team-reports/TeamReportShell';
import { IzReportDocument, IZ_REPORT_STYLES } from '@/features/projects/team-reports/iz/IzDocument';
import { IZ_SECTIONS } from '@/features/projects/team-reports/iz/template';
import type { IzReportAnswers } from '@/features/projects/team-reports/iz/types';

/* =============================================================
 * IZ (Интерьер зураг) panel — TeamReportShell-ийн нимгэн wrapper.
 * Бүх load/save/preview lifecycle нь shell дотор; энэ зүгээр л
 * IZ-ийн sections + document-ыг дамжуулна (BB-тэй ижил загвар).
 * ============================================================= */

interface IzPanelProps {
  projectId: number;
  readOnly?: boolean;
}

export function IzPanel({ projectId, readOnly = false }: IzPanelProps) {
  return (
    <TeamReportShell<IzReportAnswers>
      teamCode="IZ"
      teamLabel="Интерьер зураг"
      subtitle="Интерьерийн зураг төсөл"
      sections={IZ_SECTIONS}
      renderDocument={(a) => <IzReportDocument answers={a} />}
      documentStyles={IZ_REPORT_STYLES}
      projectId={projectId}
      readOnly={readOnly}
    />
  );
}
