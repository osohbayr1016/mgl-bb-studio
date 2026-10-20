import { TeamComponentStatsPanel } from '@/features/projects/team-reports/TeamComponentStatsPanel';
import { PageHeader, PageFooter } from '@/features/performance-reports/components/TableOfContents';
import { T } from '@/features/performance-reports/lib/reportText';
import type { PerformanceReport } from '@/features/performance-reports/types/performanceReport';

/* =============================================================
 * Section 4 — ЯВЦЫН ТОЙМ (consolidated per-team progress).
 * -------------------------------------------------------------
 * One PDF page per team, each rendered by the shared
 * TeamComponentStatsPanel.  The section heading rides on the
 * first team's page (no separate cover page — keeps the PDF
 * tight) and is suppressed on every subsequent team's page.
 *
 * ТҮЛХҮҮР (`progress.*`): нэг блокийн дотор баг БҮРД дахин
 * render хийгддэг шошгууд багийн кодоор дагаварлагдана (давхардсан
 * `data-editkey` нь курсорыг эхний баг руу үсэргэдэг).
 * ============================================================= */
export interface ProgressSummarySectionProps {
  /** Харагдах дугаар — нүүр хуудасны override-ыг мөрдөнө (ctx.reportNo). */
  reportNo: number;
  report: PerformanceReport;
  projectId: number;
  /** Drawing No. — passed through to the page header so every page in
   *  this section carries the consistent header used by Section 2/3. */
  reportDocNo: string | null;
  reportDate: string;
}

export function ProgressSummarySection({
  report,
  reportNo,
  projectId,
  reportDocNo,
  reportDate,
}: ProgressSummarySectionProps) {
  const teams = report.team_progress;
  if (teams.length === 0) return null;
  return (
    <>
      {teams.map((team, idx) => (
        <div key={team.team_id} className="perf-page">
          <PageHeader
            reportNo={reportNo}
            reportDocNo={reportDocNo}
            reportDate={reportDate}
          />

          {idx === 0 && (
            <div className="perf-intro__section-num" data-a4-item>
              <T k="progress.h.section">4. Явцын тойм</T>
            </div>
          )}

          {/* Багийн мөр — доорх хүснэгттэй нэг хуудсанд эхлэх ёстой тул
              бие даасан нэгж (пагинатор түүнийг бүтнээр нь түлхэнэ). */}
          <div className="perf-progress-section__team-bar" data-a4-item>
            {team.team_code} – {team.team_name_mn}
            <span className="perf-progress-section__team-meta">
              <T k={`progress.lbl.sum.${team.team_code}`}>· Σ явц</T>{' '}
              {Number(team.progress).toFixed(2)}%
            </span>
          </div>

          {/* ⚠️ `TeamComponentStatsPanel` дотроо 12 `data-a4-item`-тай —
              энд бүрхэхгүй, пагинатор өөрөө нарийвчилж хуваана. */}
          <TeamComponentStatsPanel projectId={projectId} teamCode={team.team_code} />

          <PageFooter />
        </div>
      ))}
    </>
  );
}
