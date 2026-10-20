import { Fragment, memo, useDeferredValue, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch, mediaUrl } from '@/shared/api/client';
import { useApiQuery } from '@/shared/api/useApi';
import {
  DrawingListContext,
  TEAM_DRAWING_ITEMS_KEY,
  groupItemsByTeam,
  makeDrawingRowsResolver,
  type TeamDrawingItemsResponse,
} from '@/features/projects/team-reports/drawingList';
import type { TeamTemplateOverrides } from '@/features/report-templates/types/teamTemplateOverrides';
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
  ProgressTimeseriesPoint,
} from '@/features/performance-reports/types/performanceReport';
import type { BlockContentMap, ReportBlock } from '@/features/performance-reports/types/performanceReportBlocks';
import type { TeamReportResource } from '@/features/projects/team-reports/types';
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
import { IZ_REPORT_STYLES } from '@/features/projects/team-reports/iz/IzDocument';
import { PROJECT_SECTION_DOC_STYLES } from '@/features/projects/team-reports/project-sections/ProjectSectionDocument';
import { NORM_DOC_STYLES } from '@/features/projects/team-reports/norm/NormDocument';
import {
  PdfBlockRenderer,
  computeNarrativeIndexes,
  type PdfBlockContext,
  type ReportFieldPatch,
  type LiveReportFields,
} from '@/features/performance-reports/components/PdfBlockRenderer';
import { deriveEffectiveTeams } from '@/features/performance-reports/components/effectiveTeams';
import { ReportBrandContext } from '@/features/performance-reports/components/TableOfContents';
import { EXECUTION_SUMMARY_STYLES } from '@/features/performance-reports/components/ExecutionSummaryPage';
import {
  AllTeamChartsPage, ALL_TEAM_CHARTS_STYLES, computeChartStats,
} from '@/features/performance-reports/components/AllTeamChartsPage';
import {
  FinalSignoffPage,
} from '@/features/performance-reports/components/FinalSignoffPage';
import { FINAL_SIGNOFF_STYLES } from '@/features/performance-reports/components/finalSignoffStyles';
import {
  A4Paginator, A4_PAGINATOR_STYLES,
} from '@/features/performance-reports/components/A4Paginator';
import { EDITABLE_STYLES } from '@/features/performance-reports/components/EditableText';
import { INTRO_STYLES } from '@/features/performance-reports/components/introStyles';
import {
  ReportTextContext,
  REPORT_TEXT_STYLES,
  type ReportTextApi,
} from '@/features/performance-reports/lib/reportText';
import { buildIntroAuto, emptyPassport } from '@/features/performance-reports/lib/introAuto';
import { effectiveReportNo } from '@/features/performance-reports/lib/blockContentResolve';
import { resolveIntroModel, type IntroOverride } from '@/features/performance-reports/types/introOverride';
import {
  SIGNOFF_EXEC_REP_KEY,
  findSigner,
  resolveSignerName,
  signerSignatureUrl,
} from '@/features/performance-reports/lib/signoffSigner';

/* =============================================================
 * Live preview pane for the report editor.
 * -------------------------------------------------------------
 * Renders the same blocks as the PDF would, in the same order, so
 * the editor's right pane stays in sync with what `wrangler` /
 * Browser Rendering will produce.  The `report` prop carries the
 * local editor overrides (period dates, summary_text, meetings,
 * workforce) so typing in the left pane reflects immediately.
 *
 * Data the renderer needs (project, passport, documents, teams,
 * users, team reports) is fetched here; falls back to safe stubs
 * while loading or on error so the preview doesn't blank.
 *
 * ⚠️ ГҮЙЦЭТГЭЛИЙН ГЭРЭЭ (хэрэглэгчийн «маш удаан laggy» гомдол).
 * Энэ файл дахь бүх `useMemo` нь гоо сайхны биш, ФУНКЦИОНАЛ:
 *   1. `ctx` нь ЗӨВХӨН тогтвортой өгөгдөл агуулна.  Танилцуулгын
 *      override, textOverrides, callback-ууд `ctx`-д БАЙХГҮЙ — тэдгээр
 *      нь блок бүрд ТУСДАА prop-оор очно.  Эс бөгөөс түлхүүр дарах
 *      бүрд `ctx` шинэчлэгдэж, `React.memo` бүхэлдээ утгагүй болно.
 *   2. Блокуудын render (`PdfBlockRenderer`), нэгтгэсэн график
 *      (`MemoCharts`) ба гарын үсгийн хуудас (`MemoSignoff`) бүгд
 *      memo — recharts бол хамгийн үнэтэй нь.
 *   3. Дуудагч (`PerformanceReportEditorPage`) callback бүрийг
 *      `useCallback`-аар тогтвортой лавлагаатай өгөх ЁСТОЙ.
 * ============================================================= */

/* Хоосон утгуудын ТОГТМОЛ лавлагаа — `?? []` бичвэл render бүрд шинэ
 * массив үүсч, доорх бүх memo-гийн хамаарал үргэлж «өөрчлөгдсөн»
 * болно. */
const EMPTY_DOCS: ProjectClientDocument[] = [];
const EMPTY_TEAMS: Team[] = [];
const EMPTY_USERS: User[] = [];
const EMPTY_TEAM_REPORTS: TeamReportResource[] = [];
const EMPTY_SERIES: ProgressTimeseriesPoint[] = [];
const EMPTY_SNAPSHOT: TeamSnapshotItem[] = [];

/* ХУВЬСАМТГАЙ тайлангийн талбарууд — эдгээрийг `ctx`-ээс ГАРГАНА.
 * -------------------------------------------------------------
 * Хуудсан дээрх «Танилцуулга» / «Ажиллах хүчин» талбарт бичих бүрд
 * `livePreviewReport` шинэ объект болдог.  Хэрэв тэр объект шууд `ctx`-д
 * ороод байвал түлхүүр дарах бүрд БҮХ блок (багийн баримт, олон зуун
 * мөртэй `team-stats` хүснэгт) дахин render болно — яг «маш удаан laggy»
 * гомдол.  Иймд эдгээр гурван талбарыг зөвхөн `execution-summary` блокт
 * prop-оор өгч, `ctx.report`-ыг тогтвортой лавлагаагаар үлдээнэ.
 *
 * ⚠️ Үүний үр дагавар: `ctx.report.summary_text / workforce /
 * status_meetings` нь бичиж байх ҮЕД ХУУЧИРСАН байж болно.  Эдгээрийг
 * уншдаг ЦОРЫН ГАНЦ хэрэглэгч бол `ExecutionSummaryPage` (2026-08-25
 * нягтлав) бөгөөд тэр нь `liveFields`-ээр амьд утгыг авдаг.  Шинэ блок
 * эдгээр талбарыг уншдаг бол ЗААВАЛ `liveFields` руу нэм. */
/* ⚠️ `status_meetings` энд ЗОРИУДААР БАЙХГҮЙ: уулзалтын хуваарь нь
 * `introAuto`-д ордог (`buildIntroAuto`) тул түүнийг өөрчлөхөд `ctx`
 * ямар ч байсан шинэчлэгдэнэ.  Волатил гэж тэмдэглэвэл `ctx.introAuto`
 * шинэ, `ctx.report.status_meetings` хуучин болж ctx дотроо ЗӨРНӨ. */
const VOLATILE_REPORT_KEYS = new Set(['summary_text', 'workforce', 'notes']);

function sameExceptVolatile(a: PerformanceReport, b: PerformanceReport): boolean {
  if (a === b) return true;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  for (const k of ka) {
    if (VOLATILE_REPORT_KEYS.has(k)) continue;
    if (ra[k] !== rb[k]) return false;
  }
  return true;
}

const MemoCharts = memo(AllTeamChartsPage);
const MemoSignoff = memo(FinalSignoffPage);

export interface PerformanceReportPreviewProps {
  projectId: number;
  /** Live-overridden report. The editor passes a memoized copy
   *  blending the persisted row with local field edits so typing
   *  shows immediately. */
  report: PerformanceReport;
  blocks: ReportBlock[];
  /** Редактор дээр бичигдэж буй, хараахан хадгалагдаагүй танилцуулгын
   *  override.  Өгвөл блокийн хадгалагдсан контентыг дийлнэ — ингэснээр
   *  формд бичих бүрд хуудас шууд шинэчлэгдэнэ. */
  introOverride?: IntroOverride | null;
  /** Хуудсан дээр шууд засварласан талбарын patch (2 талт синк). */
  onIntroChange?: (patch: Partial<IntroOverride>) => void;
  /** Засварлагдсан СТАТИК шошгууд, блокийн id-гаар индексжсэн. */
  textOverrides?: Record<number, Record<string, string>>;
  /** Статик шошго засагдахад дуудагдана.  ⚠️ `useCallback`-тай байх ёстой. */
  onTextChange?: (blockId: number, key: string, value: string) => void;
  /** «Тайлангийн талбарууд»-ыг хуудсан дээрээс засварлах гарц. */
  onReportChange?: (patch: ReportFieldPatch) => void;
  /** Урьдчилан харах хэсэг засварлагдах эсэх (issued / admin бус бол false). */
  editable?: boolean;
}

export const PerformanceReportPreview = memo(function PerformanceReportPreview({
  projectId,
  report,
  blocks,
  introOverride,
  onIntroChange,
  textOverrides,
  onTextChange,
  onReportChange,
  editable = false,
}: PerformanceReportPreviewProps) {
  /* ГҮЙЦЭТГЭЛ — «Танилцуулга» блокийн дахин render-ийг ХОЙШЛУУЛНА.
   * ------------------------------------------------------------------
   * `ProjectIntroPage` нь 1.1/1.2/1.3-ын бүх хүснэгт, мөр бүрийн
   * `EditableText`-ийг агуулдаг (олон зуун элемент).  Товчлуур дарах бүрд
   * тэр бүхэн синхроноор дахин render болвол кадр алгасна (E2E хэмжилтээр
   * товчноос зураг хүртэл p95 ≈ 69мс).
   *
   * `useDeferredValue` нь React 19-д тэр render-ийг ТАСЛАГДАХ, бага
   * зэрэглэлийн ажил болгоно: товчлуурын кадр эхлээд зурагдаж, preview
   * араас нь гүйцнэ.
   *
   * ⚠️ Хэрэглэгчийн «realtime» шаардлагыг ЭНЭ ЗӨРЧИХГҮЙ:
   *   • Preview дотор бичиж байхад тухайн талбар нь contentEditable —
   *     үсэг DOM-д ШУУД орно, React-ийн render хүлээхгүй.
   *   • Зүүн input-д бичихэд preview 1-2 кадрын дараа гүйцнэ (≈30мс),
   *     хүний нүдэнд шууд.
   * `onIntroChange` нь ХОЙШЛУУЛАГДАХГҮЙ — зүүн талын форм үргэлж шууд
   * шинэчлэгдэнэ. */
  /* Нүүр хуудасны «reportNo» override нь хуудас бүрийн толгойд ч
   * мөрдөгдөнө — нүүрэн дээр №02 гэж бичээд бусад хуудсанд №04
   * гарах алдааг таслана. */
  const shownReportNo = effectiveReportNo(blocks, report.report_no);

  const deferredIntro = useDeferredValue(introOverride);

  const projectQuery = useApiQuery<ProjectDetailResponse>(
    ['/projects', projectId],
    `/projects/${projectId}`,
    { enabled: !!projectId },
  );
  const passportQuery = useApiQuery<{ passport: ProjectPassport }>(
    ['/projects', projectId, 'passport'],
    `/projects/${projectId}/passport`,
    { enabled: !!projectId, retry: false },
  );
  const documentsQuery = useApiQuery<{ documents: ProjectClientDocument[] }>(
    ['/projects', projectId, 'client-documents'],
    `/projects/${projectId}/client-documents`,
    { enabled: !!projectId, retry: false },
  );
  const teamsQuery = useApiQuery<{ teams: Team[] }>(['/teams'], '/teams', { retry: false });
  const usersQuery = useApiQuery<{ users: User[] }>(['/users'], '/users', { retry: false });
  const teamReportsQuery = useApiQuery<{ reports: TeamReportResource[] }>(
    ['/projects', projectId, 'team-reports-all'],
    `/projects/${projectId}/team-reports`,
    { enabled: !!projectId, retry: false },
  );
  const brandingQuery = useApiQuery<{ logo_url: string | null; stamp_url: string | null }>(
    ['/settings/branding'],
    '/settings/branding',
    { retry: false },
  );
  /* ⚠️ `/media/<key>` → Worker-ийн эх сурвалж.  Pages домэйн дээр дан
     замаар үлдээвэл SPA fallback (`/* /index.html 200`) index.html
     буцааж, зураг эвдэрнэ — `shared/api/client.ts`-ийн `mediaUrl()`
     тайлбарт баримтжуулсан урхи.  Тамга нэмэхэд `ReportBrand` нь
     «зам нь бүтэн болсон байх ЁСТОЙ» гэж тодорхойлогдсон тул нэг
     объектын дотор лого нь тэр дүрмээ зөрчиж байсныг залруулав. */
  const logoUrl = brandingQuery.data?.logo_url ? mediaUrl(brandingQuery.data.logo_url) : null;
  /* КОМПАНИЙН тамга.  `/media/<key>` хэлбэрээр хадгалагддаг тул ЗААВАЛ
   * `mediaUrl()`-ээр Worker-ийн эх сурвалж руу заана — Pages домэйн дээр
   * дан `/media/…` нь SPA fallback (index.html) руу унаж зураг эвдэрнэ. */
  const stampUrl = brandingQuery.data?.stamp_url
    ? mediaUrl(brandingQuery.data.stamp_url)
    : null;
  const clientLogoQuery = useApiQuery<{ logo_url: string | null }>(
    ['/projects', projectId, 'client-logo'],
    `/projects/${projectId}/client-logo`,
    { enabled: !!projectId, retry: false },
  );
  const clientLogoUrl = clientLogoQuery.data?.logo_url
    ? mediaUrl(clientLogoQuery.data.logo_url)
    : null;

  const timeseriesQuery = useApiQuery<{ series: ProgressTimeseriesPoint[] }>(
    ['/projects', projectId, 'perf-report', report.id, 'progress-timeseries'],
    `/projects/${projectId}/performance-reports/${report.id}/progress-timeseries`,
    { enabled: !!projectId && !!report.id, retry: false },
  );

  // Зургийн жагсаалт: нийтлэг нэмэлт мөр + бүх багийн override нэрс —
  // team-narrative doc-ууд DrawingListContext-ээр авдаг (print хуудастай ижил).
  const drawingItemsQuery = useApiQuery<TeamDrawingItemsResponse>(
    TEAM_DRAWING_ITEMS_KEY,
    '/team-drawing-items',
    { staleTime: Infinity, retry: false },
  );
  // Түлхүүр нь ['/projects', id, 'team-form-templates'] prefix дор — Загвар
  // засах editor энэ prefix-ийг invalidate хийдэг тул нэр засмагц preview
  // шинэчлэгдэнэ (staleTime ∞ ч invalidation-д refetch хийнэ).
  const allOverridesQuery = useApiQuery<{
    overrides: Array<{ team_code: string; overrides: TeamTemplateOverrides }>;
  }>(
    ['/projects', projectId, 'team-form-templates', 'full'],
    `/projects/${projectId}/team-form-templates?full=1`,
    { enabled: !!projectId, staleTime: Infinity, retry: false },
  );
  const drawingRowsResolver = useMemo(
    () =>
      makeDrawingRowsResolver(
        groupItemsByTeam(drawingItemsQuery.data?.items),
        Object.fromEntries(
          (allOverridesQuery.data?.overrides ?? []).map((o) => [o.team_code, o.overrides]),
        ),
      ),
    [drawingItemsQuery.data, allOverridesQuery.data],
  );

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
            IZ_REPORT_STYLES +
            PROJECT_SECTION_DOC_STYLES +
            NORM_DOC_STYLES +
            EXECUTION_SUMMARY_STYLES +
            ALL_TEAM_CHARTS_STYLES +
            FINAL_SIGNOFF_STYLES +
            // ⚠️ Дараалал чухал: INTRO_STYLES нь PERFORMANCE_REPORT_STYLES-ийн
            // классуудыг нарийвчилдаг, A4_PAGINATOR_STYLES нь хуудасны
            // «цаас» давхаргыг зурдаг, PREVIEW_OVERRIDES хамгийн сүүлд.
            EDITABLE_STYLES +
            REPORT_TEXT_STYLES +
            INTRO_STYLES +
            A4_PAGINATOR_STYLES +
            PREVIEW_OVERRIDES,
        }}
      />
    ),
    [],
  );

  /* Хувьсамтгай талбарууд `ctx`-ийн лавлагааг эвдэхээс сэргийлнэ (дээрх
   * `VOLATILE_REPORT_KEYS`-ийн тайлбарыг үз).
   *
   * Энэ бол React-ийн баримтжуулсан «render-ийн үед төлөв тохируулах»
   * (adjusting state during render) хэв маяг: ХУВЬСАМТГАЙ талбар л
   * өөрчлөгдсөн бол ӨМНӨХ объектыг үлдээнэ, бусад тохиолдолд шинийг
   * авна.  `useRef` БИШ учир нь ref-ийг render дотор унших нь дахин
   * render өдөөхгүй (react-hooks/refs дүрэм үүнийг барьдаг). */
  const [prevReport, setPrevReport] = useState(report);
  let ctxReport = prevReport;
  if (!sameExceptVolatile(prevReport, report)) {
    setPrevReport(report);
    ctxReport = report;
  }

  const liveFields = useMemo<LiveReportFields>(
    () => ({
      summary_text: report.summary_text,
      workforce: report.workforce,
      status_meetings: report.status_meetings,
    }),
    [report.summary_text, report.workforce, report.status_meetings],
  );

  /* ── Түүхий өгөгдөл → ТОГТВОРТОЙ лавлагаа ───────────────────── */
  const project = projectQuery.data ?? null;
  const passport = useMemo(
    () => passportQuery.data?.passport ?? emptyPassport(projectId),
    [passportQuery.data, projectId],
  );
  const documents = documentsQuery.data?.documents ?? EMPTY_DOCS;
  const teams = teamsQuery.data?.teams ?? EMPTY_TEAMS;
  const users = usersQuery.data?.users ?? EMPTY_USERS;
  const teamReports = teamReportsQuery.data?.reports ?? EMPTY_TEAM_REPORTS;
  const progressTimeseries = ctxReport.progress_timeseries?.length
    ? ctxReport.progress_timeseries
    : (timeseriesQuery.data?.series ?? EMPTY_SERIES);

  const drawingNo = passport.drawing_no;
  // Толгойн огноо: гаргасан огноо → хугацааны төгсгөл → эхлэл.  `??` биш
  // `||`: `period_end` нь хоосон МӨР ('') байж болох тул `??` түүнийг
  // «утга бий» гэж үзээд огноогүй толгой үлдээнэ.
  const reportDate =
    report.issued_at?.slice(0, 10) || report.period_end || report.period_start || '';
  const overallProgress = Number(project?.project.progress) || 0;

  // Drafts have no snapshot yet — derive live progress from the
  // project hierarchy so the preview shows real numbers (matching
  // what snapshotTeamProgress would freeze on issue).
  const effectiveTeams = useMemo<TeamSnapshotItem[]>(
    // ⚠️ `ctxReport` — амьд `report` БИШ.  Амьд объект нь «Танилцуулга»-д
    // түлхүүр дарах бүрд шинэ болдог тул энэ memo дэмий дахин ажиллаж,
    // цааш нь introAuto → ctx → БҮХ блок гэсэн гинжээр нурна.
    () => (project ? deriveEffectiveTeams(ctxReport, project) : EMPTY_SNAPSHOT),
    [ctxReport, project],
  );

  // «Scope of work» мөрүүд + паспортын бүх авто утга нэг эх сурвалжтай
  // (lib/introAuto.ts) — хэвлэх хуудас яг ижил функцийг дуудна.
  const statusMeetings = ctxReport.status_meetings;
  const introAuto = useMemo(
    () =>
      project
        ? buildIntroAuto({
            project,
            passport,
            documents,
            teams,
            users,
            effectiveTeams,
            statusMeetings: statusMeetings ?? [],
          })
        : null,
    [project, passport, documents, teams, users, effectiveTeams, statusMeetings],
  );

  const chartStats = useMemo(
    () => (project ? computeChartStats(project, passport, effectiveTeams.length) : null),
    [project, passport, effectiveTeams.length],
  );

  /* Section 3-ийн дугаарлалт — memo-той нийцүүлж УРЬДЧИЛАН тооцоолно.
   * (Хуучин ref++ тоолуур нь алгассан блокийг тоолохгүй тул дугаар
   * гажина.) */
  const narrativeIndexes = useMemo(
    () => computeNarrativeIndexes(blocks, new Set(effectiveTeams.map((t) => t.team_code))),
    [blocks, effectiveTeams],
  );

  // `PdfBlockContext.teamNarrativeIndex` заавал байх тул үлдээв — гэхдээ
  // одоо `narrativeIndex` prop нь түүнийг дийлнэ.
  const narrativeIndexRef = useRef({ current: 0 });

  /* ⚠️ ctx нь ЗӨВХӨН тогтвортой өгөгдөл.  Танилцуулгын override,
   * textOverrides, `editable` энд БАЙХГҮЙ. */
  const ctx = useMemo<PdfBlockContext | null>(() => {
    if (!project || !introAuto) return null;
    return {
      report: ctxReport,
      project,
      projectId,
      passport,
      documents,
      teams,
      users,
      teamReports,
      effectiveTeams,
      drawingNo,
      reportNo: shownReportNo,
      reportDate,
      progressTimeseries,
      teamNarrativeIndex: narrativeIndexRef.current,
      introAuto,
      onReportChange,
    };
  }, [
    ctxReport,
    project,
    projectId,
    passport,
    documents,
    teams,
    users,
    teamReports,
    effectiveTeams,
    drawingNo,
    shownReportNo,
    reportDate,
    progressTimeseries,
    introAuto,
    onReportChange,
  ]);

  const brand = useMemo(
    () => ({ logoUrl, clientLogoUrl, stampUrl }),
    [logoUrl, clientLogoUrl, stampUrl],
  );

  /* Блокт ХАМААРАХГҮЙ хуудсууд (нэгтгэсэн график, гарын үсгийн хуудас)
   * нь өөрийн блокгүй тул статик шошгоо танилцуулгын блокийн нэрийн
   * зайд хадгална.  Түлхүүрүүд өөрсдөө угсаагаараа (`charts.*`,
   * `signoff.*`) ялгардаг тул `intro.*`-той мөргөлдөхгүй. */
  const docTextBlockId = useMemo(() => {
    const intro = blocks.find((b) => b.type === 'project-intro');
    return intro?.id ?? blocks[0]?.id ?? 0;
  }, [blocks]);
  const docTextApi = useMemo<ReportTextApi>(
    () => ({
      t: (key: string, fallback: string) => textOverrides?.[docTextBlockId]?.[key] ?? fallback,
      set:
        editable && onTextChange && docTextBlockId
          ? (key: string, value: string) => onTextChange(docTextBlockId, key, value)
          : null,
    }),
    [textOverrides, editable, onTextChange, docTextBlockId],
  );

  /* ── «Боловсруулсан ажилтан» → гарын үсэг / тамга ─────────────
   * Үнийн саналын зан төлөв: тайлан боловсруулсан хүний НЭРИЙГ бичихэд
   * (редакторын шинэ талбар ЭСВЭЛ Баталгаажуулалт хуудасны талбар —
   * хоёул НЭГ түлхүүрт бичдэг) тухайн хүний гарын үсэг, тамга гарч ирнэ.
   * Таарах хүн олдохгүй бол зураггүй — алдаа биш. */
  const signerName = useMemo(
    () =>
      resolveSignerName(
        textOverrides?.[docTextBlockId]?.[SIGNOFF_EXEC_REP_KEY],
        users,
        report.created_by_id,
      ),
    [textOverrides, docTextBlockId, users, report.created_by_id],
  );
  const signerSignature = useMemo(
    () => signerSignatureUrl(findSigner(users, signerName)),
    [users, signerName],
  );

  /* Захиалагчийн байгууллагын нэр — «1.1 Ерөнхий мэдээлэл»-ийн утга.
   * Хэрэглэгч танилцуулгад override хийсэн бол ТҮҮНИЙГ ашиглана
   * («introOverride» = хадгалагдаагүй амьд утга, түүнгүй бол блокт
   * хадгалагдсан override).  Ингэснээр Баталгаажуулалт хуудасны
   * «Захиалагч байгууллагын нэр» дээд талын танилцуулгатай ижил байна. */
  const storedIntroOverride = useMemo<IntroOverride | null>(() => {
    const b = blocks.find((x) => x.type === 'project-intro');
    return b ? ((b.content as BlockContentMap['project-intro']).override ?? null) : null;
  }, [blocks]);
  const signoffClientName = useMemo(
    () =>
      introAuto
        ? resolveIntroModel(introOverride ?? storedIntroOverride ?? {}, introAuto).clientName
        : '',
    [introOverride, storedIntroOverride, introAuto],
  );

  if (!project || !ctx || !chartStats) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Урьдчилан харах ачаалж байна…</span>
      </div>
    );
  }

  const chartsEl = (
    <MemoCharts
      reportNo={shownReportNo}
      reportDocNo={drawingNo}
      reportDate={reportDate}
      teams={effectiveTeams}
      overallProgress={overallProgress}
      stats={chartStats}
    />
  );

  return (
    <ReportBrandContext.Provider value={brand}>
      <DrawingListContext.Provider value={drawingRowsResolver}>
      <ReportTextContext.Provider value={docTextApi}>
      <div className="perf-preview-host">
        {styleTag}
        {blocks.length === 0 ? (
          <p className="text-sm text-muted-foreground italic p-6">
            Энэ тайланд блок байхгүй байна. "+ Блок" товчоор нэмнэ үү.
          </p>
        ) : (
          /* A4Paginator нь агуулгыг ХУВААХГҮЙ — ард нь цаас зурж, хуудасны
             заагт унасан нэгжийг margin-аар доош түлхдэг.  Ингэснээр
             contentEditable элемент өөр эцэг рүү шилждэггүй тул хуудсан
             дээр бичиж байхад курсор амьд үлдэнэ. */
          <A4Paginator enabled>
            <div className="perf-shell perf-preview-shell">
              {blocks.map((b) => (
                <Fragment key={b.id}>
                  <PageBreak />
                  <PdfBlockRenderer
                    block={b}
                    ctx={ctx}
                    /* Хувьсамтгай зүйл нь ЗӨВХӨН энд — ингэснээр
                       танилцуулга бичихэд бусад блок хөдлөхгүй. */
                    /* ⚠️ `execution-summary` НЬ ЧУХАЛ: тэр хуудас §1-тэй ижил
                       гарчиг / шифр / байршил / захирал хэвлэдэг тул ИЖИЛ
                       override-ыг авах ёстой — эс бөгөөс §1 дээр гараар
                       засварласан нэр хураангуй хуудсанд тусахгүй. */
                    introOverride={
                      b.type === 'project-intro'
                        ? deferredIntro
                        : b.type === 'execution-summary'
                          ? /* Хураангуй хуудсанд ӨӨРИЙН хадгалагдсан override
                               байхгүй тул амьд утга → блокт хадгалагдсан утга
                               гэсэн дарааллаар (`signoffClientName`-тэй ижил). */
                            (deferredIntro ?? storedIntroOverride)
                          : undefined
                    }
                    onIntroChange={b.type === 'project-intro' ? onIntroChange : undefined}
                    textOverrides={textOverrides?.[b.id]}
                    onTextChange={onTextChange}
                    liveFields={b.type === 'execution-summary' ? liveFields : undefined}
                    editable={editable}
                    narrativeIndex={narrativeIndexes[b.id]}
                  />
                  {b.type === 'project-intro' && (
                    <>
                      <PageBreak />
                      {chartsEl}
                    </>
                  )}
                </Fragment>
              ))}
              {!blocks.some((b) => b.type === 'project-intro') && (
                <>
                  <PageBreak />
                  {chartsEl}
                </>
              )}
              <PageBreak />
              <MemoSignoff
                reportNo={shownReportNo}
                reportDocNo={drawingNo}
                reportDate={reportDate}
                overallProgress={overallProgress}
                clientName={signoffClientName}
                signerName={signerName}
                execSignatureUrl={signerSignature}
              />
            </div>
          </A4Paginator>
        )}
      </div>
      </ReportTextContext.Provider>
      </DrawingListContext.Provider>
    </ReportBrandContext.Provider>
  );
});

/* ─────────────────────────────────────────────────────────────
 * Хуудасны заагийг АЛБАДАХ тэмдэглэгээ.
 * -------------------------------------------------------------
 * A4Paginator нь `data-a4-break="before"`-ыг ЗӨВХӨН `[data-a4-item]`
 * элемент дээр уншдаг.  Блокуудын үндэс (`.perf-page`, `.perf-cover`,
 * `.perf-team-page`) нь өөрсдөө item БИШ (танилцуулгын хуудас дотроо
 * илүү нарийн item-үүдтэй), тиймээс блок бүрийн ӨМНӨ ийм 1px өндөртэй
 * хоосон item тавьж хуудас эхлүүлнэ.
 *
 * Яагаад 0 биш 1px вэ: 0 өндөртэй, хүрээ/дотоод зайгүй блок нь өөрийн
 * дээд/доод margin-аа «нийлүүлдэг» (self-collapsing) тул түлхэлт нь
 * дараагийн элементийн margin-той нийлж алдагдах эрсдэлтэй.  1px нь
 * үүнээс сэргийлнэ, харагдацад нөлөөгүй, пагинатор бодит DOM-ыг
 * хэмждэг тул хуримтлагдах алдаа үүсгэхгүй. */
function PageBreak() {
  return (
    <div className="perf-block-break" data-a4-item data-a4-break="before" aria-hidden="true" />
  );
}

/* =============================================================
 * Preview-only overrides.
 * -------------------------------------------------------------
 * ⚠️ УРЬД НЬ энд блок бүрийг `height: 297mm; overflow: hidden`-ээр
 * албаар нэг A4 болгодог байсан.  Тэр нь нэг хуудсанд багтаагүй
 * агуулгыг ХАЙЧЛАН хаядаг (дэлгэц дээр АЛГА болно, хэвлэхэд огт өөр
 * газар тасарна) байсан тул бүхэлд нь УСТГАВ — хуудаслалтыг одоо
 * A4Paginator хийж, цаас + сүүдрийг `.a4-sheet` зурна.
 *
 * ⚠️ Энд `height` / `min-height` / `overflow: hidden` агуулсан дүрэм
 * ДАХИН БҮҮ НЭМ.  Preview нь PDF-тэй ЯГ ижил байх ёстой; ямар нэг
 * хэмжээ энд дарж бичигдвэл тэр баталгаа алдагдана.  Үлдэх ёстой зүйл
 * бол зөвхөн хараагчийн дэвсгэр. */
const PREVIEW_OVERRIDES = `
.perf-preview-host { background: #e9eaee; min-height: 100%; padding: 16px; overflow: auto; }
/* Цаасыг .a4-sheet зурдаг тул урсгал өөрөө ил тод. */
.perf-preview-shell { background: transparent; }

/* Хуудас эхлүүлэх тэмдэглэгээ (PageBreak) — харагдахгүй, зөвхөн
 * пагинаторын хэмжилтэд оршино.  Ctrl+P хийвэл жинхэнэ @page ажиллах
 * тул огт хэрэггүй. */
.perf-block-break {
  height: 1px;
  margin: 0;
  padding: 0;
  border: 0;
}
@media print {
  .perf-block-break { display: none !important; }
}
`;

// Silence unused warning — apiFetch is part of useApiQuery's
// implementation but ESLint sometimes flags imports brought in
// for type discovery only.
void apiFetch;
