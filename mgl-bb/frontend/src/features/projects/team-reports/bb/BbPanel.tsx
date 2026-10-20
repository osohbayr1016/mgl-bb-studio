import { TeamReportShell } from '@/features/projects/team-reports/TeamReportShell';
import { BbReportDocument, BB_REPORT_STYLES } from '@/features/projects/team-reports/bb/BbDocument';
import { BB_SECTIONS } from '@/features/projects/team-reports/bb/template';
import type { BbReportAnswers } from '@/features/projects/team-reports/bb/types';

/* =============================================================
 * BB (Барилгын бүтээц) panel — thin wrapper around the shared
 * TeamReportShell. All UI chrome + load/save/preview lifecycle
 * lives in the shell so the 6 newer disciplines look identical.
 * ============================================================= */

interface BbPanelProps {
  projectId: number;
  readOnly?: boolean;
}

export function BbPanel({ projectId, readOnly = false }: BbPanelProps) {
  return (
    <TeamReportShell<BbReportAnswers>
      teamCode="BB"
      teamLabel="Барилгын бүтээц"
      subtitle="Барилгын бүтээцийн зураг төсөл"
      sections={BB_SECTIONS}
      renderDocument={(a) => <BbReportDocument answers={a} />}
      documentStyles={BB_REPORT_STYLES}
      projectId={projectId}
      readOnly={readOnly}
    />
  );
}
