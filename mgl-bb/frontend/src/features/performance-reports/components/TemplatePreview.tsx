import { useMemo, useRef } from 'react';
import type {
  ProjectDetailResponse,
  ProjectPassport,
  ProjectClientDocument,
  Team,
  User,
} from '@/shared/types';
import type {
  PerformanceReport,
  TeamSnapshotItem,
} from '@/features/performance-reports/types/performanceReport';
import type { ReportBlock } from '@/features/performance-reports/types/performanceReportBlocks';
import { PERFORMANCE_REPORT_STYLES } from '@/features/performance-reports/components/styles';
import { STATUS_DOC_STYLES } from '@/features/projects/team-reports/StatusQuestionsDocument';
import { TEAM_STATS_DOC_STYLES } from '@/features/projects/team-reports/TeamComponentStatsPanel';
import { BA_REPORT_STYLES } from '@/features/projects/team-reports/ba/BaDocument';
import { BB_REPORT_STYLES } from '@/features/projects/team-reports/bb/BbDocument';
import { HAS_REPORT_STYLES } from '@/features/projects/team-reports/has/HasDocument';
import { CBU_REPORT_STYLES } from '@/features/projects/team-reports/cbu/CbuDocument';
import { TSAH_REPORT_STYLES } from '@/features/projects/team-reports/tsah/TsahDocument';
import { HD_REPORT_STYLES } from '@/features/projects/team-reports/hd/HdDocument';
import { AU_REPORT_STYLES } from '@/features/projects/team-reports/au/AuDocument';
import { PROJECT_SECTION_DOC_STYLES } from '@/features/projects/team-reports/project-sections/ProjectSectionDocument';
import { NORM_DOC_STYLES } from '@/features/projects/team-reports/norm/NormDocument';
import {
  PdfBlockRenderer,
  type PdfBlockContext,
} from '@/features/performance-reports/components/PdfBlockRenderer';
import { EXECUTION_SUMMARY_STYLES } from '@/features/performance-reports/components/ExecutionSummaryPage';
import { ReportBrandContext } from '@/features/performance-reports/components/TableOfContents';

/* =============================================================
 * TemplatePreview — live PDF preview of a template's block list.
 * -------------------------------------------------------------
 * Templates aren't bound to a project, so we feed the renderer
 * STUB project / passport / documents data. Block resolvers that
 * read project info (cover, TOC, intro, etc.) render with sensible
 * placeholders; team-narrative / team-stats blocks resolve their
 * `team_code` against the firm-wide teams registry passed in.
 * ============================================================= */

export interface TemplatePreviewProps {
  blocks: ReportBlock[];
  /** Firm-wide teams registry from /api/teams. Used to resolve
   *  team_code → name in team-narrative + team-stats blocks. */
  teams: Team[];
  /** Optional firm logo URL for the cover + footer. */
  logoUrl: string | null;
}

const STUB_PROJECT_NAME = 'Жишээ төсөл';
const STUB_FULL_TITLE = '"Жишээ" ХХК-ийн жишээ цогцолбор';
const STUB_CLIENT_NAME = 'Жишээ Захиалагч';
const STUB_DRAWING_NO = 'TEMPLATE/00';

export function TemplatePreview({ blocks, teams, logoUrl }: TemplatePreviewProps) {
  const today = new Date().toISOString().slice(0, 10);

  const styleTag = useMemo(
    () => (
      <style
        dangerouslySetInnerHTML={{
          __html:
            PERFORMANCE_REPORT_STYLES +
            STATUS_DOC_STYLES +
            TEAM_STATS_DOC_STYLES +
            BA_REPORT_STYLES +
            BB_REPORT_STYLES +
            HAS_REPORT_STYLES +
            CBU_REPORT_STYLES +
            TSAH_REPORT_STYLES +
            HD_REPORT_STYLES +
            AU_REPORT_STYLES +
            PROJECT_SECTION_DOC_STYLES +
            NORM_DOC_STYLES +
            EXECUTION_SUMMARY_STYLES +
            PREVIEW_OVERRIDES,
        }}
      />
    ),
    [],
  );

  const narrativeIndexRef = useRef({ current: 0 });

  // Build a synthetic project + report so blocks have something to
  // chew on. effectiveTeams comes from the firm-wide teams registry
  // (every team in the table) so any team_code in the template
  // resolves.
  const effectiveTeams: TeamSnapshotItem[] = teams.map((t) => ({
    team_id: t.id,
    team_code: t.code,
    team_name_mn: t.name_mn,
    share_percent: 100 / Math.max(teams.length, 1),
    progress: 0,
    task_count: 0,
  }));

  const stubReport: PerformanceReport = {
    id: 0,
    project_id: 0,
    report_no: 0,
    period_start: today,
    period_end: today,
    status: 'draft',
    issued_at: null,
    issued_by_id: null,
    team_progress: effectiveTeams,
    progress_timeseries: [],
    status_meetings: [],
    summary_text: null,
    workforce: [],
    notes: null,
    client_summary_md: null,
    risks: [],
    next_plan: [],
    created_by_id: null,
    created_at: today,
    updated_at: today,
  };

  const stubProject: ProjectDetailResponse = {
    project: {
      id: 0,
      name: STUB_PROJECT_NAME,
      description: null,
      status: 'active',
      location: null,
      latitude: null,
      longitude: null,
      complexity: 'mid',
      model_url: null,
      created_by: null,
      created_at: today,
      updated_at: today,
      progress: 0,
      project_code: null,
      key_image_url: null,
      tech_conditions_summary: null,
    } as unknown as ProjectDetailResponse['project'],
    blocks: [],
    members: [],
    clients: [
      {
        id: 0,
        project_id: 0,
        type: 'company',
        name: STUB_CLIENT_NAME,
        share_percent: 100,
        sort_order: 0,
        created_at: today,
      },
    ],
    team_shares: teams.map((t, i) => ({
      id: i + 1,
      project_id: 0,
      team_id: t.id,
      share_percent: 100 / Math.max(teams.length, 1),
      sort_order: i,
      created_at: today,
      updated_at: today,
      team_code: t.code,
      team_name_mn: t.name_mn,
      team_name_en: t.name_en,
    })),
  };

  const stubPassport: ProjectPassport = {
    project_id: 0,
    full_title: STUB_FULL_TITLE,
    drawing_no: STUB_DRAWING_NO,
    scope: 'Жишээ цар хүрээ',
    director: 'Жишээ захирал',
    client_pm: null,
    start_date: today,
    finish_date: today,
    extension_date: null,
    doc_no: null,
    meeting_30: null,
    meeting_50: null,
    meeting_100: null,
    disciplines: teams.map((t) => t.code),
    client_contacts: [],
    scope_rows: [],
    timeline: [],
    meetings: [],
    notes: null,
    updated_at: today,
    updated_by_id: null,
  };

  const stubDocs: ProjectClientDocument[] = [];
  const stubUsers: User[] = [];

  const teamScopes = effectiveTeams.map((t) => ({
    code: t.team_code,
    name_mn: t.team_name_mn,
    leader_name: null,
    file_name: `TEMPLATE_${t.team_code}_A`,
  }));

  narrativeIndexRef.current.current = 0;

  const ctx: PdfBlockContext = {
    report: stubReport,
    // Загварын урьдчилан харах нь жинхэнэ тайлангүй тул stub-ийн дугаарыг
    // шууд ашиглана (нүүр хуудасны override энд байхгүй).
    reportNo: stubReport.report_no,
    project: stubProject,
    projectId: 0,
    passport: stubPassport,
    documents: stubDocs,
    teams,
    users: stubUsers,
    teamReports: [],
    effectiveTeams,
    drawingNo: STUB_DRAWING_NO,
    reportDate: today,
    teamScopes,
    progressTimeseries: [],
    teamNarrativeIndex: narrativeIndexRef.current,
  };

  return (
    /* Загварын урьдчилан харах — тамга нь ТАЙЛАНГИЙН баримтын зүйл тул
       энд БАЙХГҮЙ (загварт «Баталгаажуулалт» хуудас ордоггүй). */
    <ReportBrandContext.Provider value={{ logoUrl, clientLogoUrl: null, stampUrl: null }}>
      <div className="perf-preview-host">
        {styleTag}
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground italic p-6">
            Энэ загвар хоосон. "+ Блок" товчоор блок нэмнэ үү.
          </p>
        ) : (
          <div className="perf-shell perf-preview-shell">
            {blocks.map((b) => (
              <PdfBlockRenderer key={b.id} block={b} ctx={ctx} />
            ))}
          </div>
        )}
      </div>
    </ReportBrandContext.Provider>
  );
}

/* Same shrunk-page styles the per-report preview uses so blocks read
 * as cards in the scroll list rather than A4 sheets. */
const PREVIEW_OVERRIDES = `
.perf-preview-host { background: #e9eaee; min-height: 100%; padding: 16px; }
.perf-preview-shell { background: transparent; }
.perf-preview-shell .perf-page,
.perf-preview-shell .perf-cover {
  width: auto;
  max-width: 210mm;
  min-height: 0;
  height: auto;
  margin: 0 auto 14px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
  background: #fff;
  page-break-after: auto;
  break-after: auto;
}
.perf-preview-shell .perf-cover {
  background: #0F243E;
  min-height: 240px;
}
.perf-preview-shell .perf-page__footer { position: relative; bottom: auto; left: auto; right: auto; margin-top: 12mm; }
`;
