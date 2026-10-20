import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, mediaUrl } from '@/shared/api/client';
import type {
  ProjectDetailResponse,
  ProjectPassport,
  ProjectClientDocument,
  Team,
  User,
} from '@/shared/types';
import type {
  PerformanceReport,
  PerformanceReportResponse,
  TeamSnapshotItem,
  ProgressTimeseriesPoint,
} from '@/features/performance-reports/types/performanceReport';
import {
  coerceBlock,
  type BlockContentMap,
  type ReportBlock,
  type ReportBlockRaw,
} from '@/features/performance-reports/types/performanceReportBlocks';
import type { TeamReportResource, TeamReportAnswers } from '@/features/projects/team-reports/types';
import { PROJECT_SECTION_DOC_STYLES } from '@/features/projects/team-reports/project-sections/ProjectSectionDocument';
import { NORM_DOC_STYLES } from '@/features/projects/team-reports/norm/NormDocument';
import type { NormAnswers } from '@/features/projects/team-reports/norm/NormPanel';
import type {
  NormCatalogCategory,
  NormCatalogResponse,
} from '@/features/projects/team-reports/norm/catalogApi';
import {
  DrawingListContext,
  groupItemsByTeam,
  makeDrawingRowsResolver,
  type TeamDrawingItem,
} from '@/features/projects/team-reports/drawingList';
import type { TeamTemplateOverrides } from '@/features/report-templates/types/teamTemplateOverrides';
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
import {
  PdfBlockRenderer,
  computeNarrativeIndexes,
  type PdfBlockContext,
} from '@/features/performance-reports/components/PdfBlockRenderer';
import { deriveEffectiveTeams } from '@/features/performance-reports/components/effectiveTeams';
import { EXECUTION_SUMMARY_STYLES } from '@/features/performance-reports/components/ExecutionSummaryPage';
import {
  AllTeamChartsPage, ALL_TEAM_CHARTS_STYLES, computeChartStats,
} from '@/features/performance-reports/components/AllTeamChartsPage';
import {
  FinalSignoffPage,
} from '@/features/performance-reports/components/FinalSignoffPage';
import { FINAL_SIGNOFF_STYLES } from '@/features/performance-reports/components/finalSignoffStyles';
import {
  ReportBrandContext, TocPageContext,
} from '@/features/performance-reports/components/TableOfContents';
import { computeTocPages } from '@/features/performance-reports/components/tocPages';
import { EDITABLE_STYLES } from '@/features/performance-reports/components/EditableText';
import { INTRO_STYLES } from '@/features/performance-reports/components/introStyles';
import {
  ReportTextContext,
  REPORT_TEXT_STYLES,
  type ReportTextApi,
} from '@/features/performance-reports/lib/reportText';
import { buildIntroAuto } from '@/features/performance-reports/lib/introAuto';
import { effectiveReportNo } from '@/features/performance-reports/lib/blockContentResolve';
import {
  resolveIntroModel,
  type IntroOverride,
} from '@/features/performance-reports/types/introOverride';
import {
  SIGNOFF_EXEC_REP_KEY,
  findSigner,
  resolveSignerName,
  signerSignatureUrl,
} from '@/features/performance-reports/lib/signoffSigner';
import { whenHandSignsReady } from '@/shared/components/HandSignature';
import { bridgePrintToken } from '@/shared/lib/printAuth';

/* =============================================================
 * Гүйцэтгэлийн тайлан — block-based multi-page print page.
 * -------------------------------------------------------------
 * Standalone route, rendered by Cloudflare Browser Rendering to
 * produce the project-wide PDF.  The report is composed from an
 * ordered list of typed blocks (cover / TOC / project-intro /
 * summary-notes / team-narrative / team-stats / all-team-stats /
 * rich-text / divider).  PdfBlockRenderer is a switch dispatch —
 * mirrors the landing CMS pattern (landing/BlockRenderer.tsx).
 * ============================================================= */

// Bridge the print token into localStorage BEFORE React mounts so the first
// apiFetch already carries it.
bridgePrintToken();

interface AllData {
  report: PerformanceReport;
  blocks: ReportBlock[];
  project: ProjectDetailResponse;
  passport: ProjectPassport;
  documents: ProjectClientDocument[];
  teams: Team[];
  users: User[];
  teamReports: TeamReportResource[];
  progressTimeseries: ProgressTimeseriesPoint[];
  logoUrl: string | null;
  clientLogoUrl: string | null;
  /** КОМПАНИЙН тамга (`app_settings.report_stamp_url`) — аль хэдийн
   *  `mediaUrl()`-ээр бүтэн зам болсон.  «Баталгаажуулалт» хуудсанд
   *  `ReportBrandContext`-ээр очно. */
  stampUrl: string | null;
  /** Pre-fetched project-level report answers + norm catalog for the
   *  `project-sections` block (avoids the doc self-fetch snapshot race). */
  projectSections: Partial<Record<'GENERAL' | 'ROOMS' | 'FIRE', TeamReportAnswers>> & {
    NORM?: NormAnswers;
  };
  normCatalog: NormCatalogCategory[];
  /** Зургийн жагсаалт: нийтлэг нэмэлт мөрүүд + бүх багийн override нэрс —
   *  team-narrative doc-ууд DrawingListContext-ээр авдаг. */
  drawingItems: TeamDrawingItem[];
  overridesByTeam: Record<string, TeamTemplateOverrides>;
  /** Блокийн ТҮҮХИЙ контентоос уншсан статик-шошгын override-ууд.
   *  ⚠️ `coerceBlock` нь мэдэгдэхгүй талбарыг хаядаг тул ЗААВАЛ түүхий
   *  `content`-оос уншина — хэвлэлд шошго алга болох ёсгүй. */
  textOverridesById: Record<number, Record<string, string>>;
}

/** Түүхий блокийн контентоос `textOverrides`-ыг аюулгүй гаргана. */
function readTextOverrides(content: unknown): Record<string, string> | null {
  if (!content || typeof content !== 'object') return null;
  const raw = (content as { textOverrides?: unknown }).textOverrides;
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

export default function PerformanceReportPrintPage() {
  const { id, reportId } = useParams<{ id: string; reportId: string }>();
  const projectId = Number(id);
  const reportIdNum = Number(reportId);

  const [data, setData] = useState<AllData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tocPages, setTocPages] = useState<Record<string, number>>({});
  const shellRef = useRef<HTMLDivElement>(null);

  /* ХАР ЗУРВАСЫН ХАМГААЛАЛТ (CSS-ийн хосолсон бэхэлгээ).
   * -----------------------------------------------------------------
   * Апп нь `:root { color-scheme: dark }` (index.css) + index.html-ийн
   * `<meta name="color-scheme" content="dark light">` зарладаг.  Хэвлэх
   * үед Chromium нь `@page`-ийн захын хайрцгуудыг UA-гийн canvas өнгөөр
   * буддаг тул dark scheme дор хуудас бүрийн дээд/доод зурвас #121212
   * болж, header/footer уншигдахгүй болдог байв.
   * `styles.ts`-ийн `@media print` дотор `!important` дүрэм бий; энэ нь
   * `<meta>`-г ч дарах DOM-ийн түвшний баталгаа.  Хэвлэх маршрут нь
   * зөвхөн PDF-д зориулагдсан тул аппын сэдэвт нөлөөлөхгүй. */
  useEffect(() => {
    const root = document.documentElement;
    const prevScheme = root.style.colorScheme;
    const prevBg = root.style.backgroundColor;
    root.style.colorScheme = 'light';
    root.style.backgroundColor = '#ffffff';
    return () => {
      root.style.colorScheme = prevScheme;
      root.style.backgroundColor = prevBg;
    };
  }, []);

  useEffect(() => {
    if (!Number.isFinite(projectId) || !Number.isFinite(reportIdNum)) return;
    let cancelled = false;
    (async () => {
      try {
        const [
          reportRes,
          project,
          passport,
          docs,
          teamsRes,
          usersRes,
          trRes,
          blocksRes,
          brandingRes,
          clientLogoRes,
          tsRes,
          genRes,
          normRes,
          roomsRes,
          fireRes,
          catalogRes,
          drawingItemsRes,
          allOverridesRes,
        ] = await Promise.all([
          apiFetch<PerformanceReportResponse>(
            `/projects/${projectId}/performance-reports/${reportIdNum}`,
          ),
          apiFetch<ProjectDetailResponse>(`/projects/${projectId}`),
          apiFetch<{ passport: ProjectPassport }>(`/projects/${projectId}/passport`).catch(() => ({
            passport: stubPassport(projectId),
          })),
          apiFetch<{ documents: ProjectClientDocument[] }>(
            `/projects/${projectId}/client-documents`,
          ).catch(() => ({ documents: [] as ProjectClientDocument[] })),
          apiFetch<{ teams: Team[] }>('/teams').catch(() => ({ teams: [] as Team[] })),
          apiFetch<{ users: User[] }>('/users').catch(() => ({ users: [] as User[] })),
          apiFetch<{ reports: TeamReportResource[] }>(`/projects/${projectId}/team-reports`).catch(
            () => ({ reports: [] as TeamReportResource[] }),
          ),
          apiFetch<{ blocks: ReportBlockRaw[] }>(
            `/projects/${projectId}/performance-reports/${reportIdNum}/blocks`,
          ).catch(() => ({ blocks: [] as ReportBlockRaw[] })),
          apiFetch<{ logo_url: string | null; stamp_url: string | null }>(
            '/settings/branding',
          ).catch(() => ({ logo_url: null, stamp_url: null })),
          apiFetch<{ logo_url: string | null }>(`/projects/${projectId}/client-logo`).catch(() => ({
            logo_url: null,
          })),
          apiFetch<{ series: ProgressTimeseriesPoint[] }>(
            `/projects/${projectId}/performance-reports/${reportIdNum}/progress-timeseries`,
          ).catch(() => ({ series: [] as ProgressTimeseriesPoint[] })),
          // Project-түвшний хэсгүүд (project-sections block-д) — доод document
          // өөрөө fetch хийхээс сэргийлж энд урьдчилан татаж, readiness-д тооцно.
          apiFetch<{ report: { answers: TeamReportAnswers | null } | null }>(
            `/projects/${projectId}/team-reports/GENERAL`,
          ).catch(() => ({ report: null })),
          apiFetch<{ report: { answers: NormAnswers | null } | null }>(
            `/projects/${projectId}/team-reports/NORM`,
          ).catch(() => ({ report: null })),
          apiFetch<{ report: { answers: TeamReportAnswers | null } | null }>(
            `/projects/${projectId}/team-reports/ROOMS`,
          ).catch(() => ({ report: null })),
          apiFetch<{ report: { answers: TeamReportAnswers | null } | null }>(
            `/projects/${projectId}/team-reports/FIRE`,
          ).catch(() => ({ report: null })),
          apiFetch<NormCatalogResponse>('/norm-catalog').catch(() => ({
            catalog: [] as NormCatalogCategory[],
          })),
          apiFetch<{ items: TeamDrawingItem[] }>('/team-drawing-items').catch(() => ({
            items: [] as TeamDrawingItem[],
          })),
          apiFetch<{
            overrides: Array<{ team_code: string; overrides: TeamTemplateOverrides }>;
          }>(`/projects/${projectId}/team-form-templates?full=1`).catch(() => ({
            overrides: [] as Array<{ team_code: string; overrides: TeamTemplateOverrides }>,
          })),
        ]);
        if (cancelled) return;
        setData({
          report: reportRes.report,
          blocks: (blocksRes.blocks ?? []).map(coerceBlock),
          project,
          passport: passport.passport,
          documents: docs.documents,
          teams: teamsRes.teams,
          users: usersRes.users,
          teamReports: trRes.reports,
          // Issued reports carry a frozen curve on the report itself;
          // prefer it, else fall back to the live endpoint result.
          progressTimeseries: reportRes.report.progress_timeseries?.length
            ? reportRes.report.progress_timeseries
            : (tsRes.series ?? []),
          logoUrl: brandingRes.logo_url ? mediaUrl(brandingRes.logo_url) : null,
          clientLogoUrl: clientLogoRes.logo_url ? mediaUrl(clientLogoRes.logo_url) : null,
          /* `/media/<key>` → Worker-ийн эх сурвалж.  Хэвлэлийн хуудас
             Pages домэйн дээр ачаалагддаг тул дан замаар үлдээвэл SPA
             fallback (index.html) буцаж зураг эвдэрнэ. */
          stampUrl: brandingRes.stamp_url ? mediaUrl(brandingRes.stamp_url) : null,
          projectSections: {
            GENERAL: genRes.report?.answers ?? undefined,
            NORM: normRes.report?.answers ?? undefined,
            ROOMS: roomsRes.report?.answers ?? undefined,
            FIRE: fireRes.report?.answers ?? undefined,
          },
          normCatalog: catalogRes.catalog ?? [],
          drawingItems: drawingItemsRes.items ?? [],
          overridesByTeam: Object.fromEntries(
            (allOverridesRes.overrides ?? []).map((o) => [o.team_code, o.overrides]),
          ),
          textOverridesById: Object.fromEntries(
            (blocksRes.blocks ?? [])
              .map((b) => [b.id, readTextOverrides(b.content)] as const)
              .filter((e): e is readonly [number, Record<string, string>] => e[1] !== null),
          ),
        });
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Ачаалж чадсангүй');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, reportIdNum]);

  // Mark the page ready for Browser-Rendering: three rAFs after data is
  // mounted lets fonts settle and layout commit. Without this guard the
  // headless screenshot can land on a half-laid-out tree.
  useEffect(() => {
    // Run once the data is in OR the load failed. The error branch must also
    // set the print-ready marker so server-side Browser Rendering fails fast
    // instead of hanging until the puppeteer timeout.
    if (!data && !error) return;
    let cancel = false;
    // Error path: no TOC measurement to do — just signal readiness so the
    // headless capture proceeds against the visible error message.
    if (error) {
      document.body.setAttribute('data-print-ready', 'true');
      return () => {
        cancel = true;
      };
    }
    const mark = () =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (cancel) return;
          // Гарын үсгийн тайралт layout-ыг өөрчилж болно — TOC-ийг ДАРАА нь.
          void whenHandSignsReady().then(() => {
            if (cancel) return;
            if (shellRef.current) setTocPages(computeTocPages(shellRef.current));
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                if (!cancel) document.body.setAttribute('data-print-ready', 'true');
              }),
            );
          });
        }),
      );
    // Wait for web fonts to finish loading before signalling readiness —
    // otherwise Browser Rendering can screenshot mid-FOIT and the text
    // renders invisible (blank pages with no glyphs).
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      document.fonts.ready
        .then(() => {
          if (!cancel) mark();
        })
        .catch(() => {
          if (!cancel) mark();
        });
    } else {
      mark();
    }
    return () => {
      cancel = true;
    };
  }, [data, error]);

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
            // EditableText нь энд ЗӨВХӨН уншигдана (onChange өгөхгүй), гэхдээ
            // класс тодорхойлолт нь байхгүй бол хэвлэлийн харагдац preview-ээс
            // зөрнө. Танилцуулгын 1.2 / файлын нэрийн хайрцгийн классууд
            // INTRO_STYLES дотор.
            EDITABLE_STYLES +
            REPORT_TEXT_STYLES +
            INTRO_STYLES,
        }}
      />
    ),
    [],
  );

  // Stable narrative-index counter shared by the team-narrative blocks
  // so the visible numbering ({n}. {team_name}) stays sequential across
  // reorder. Each render resets it before mapping through blocks.
  const narrativeIndexRef = useRef({ current: 0 });

  if (error) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif' }}>
        {styleTag}
        <p>{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#888' }}>
        {styleTag}
        Loading…
      </div>
    );
  }

  const {
    report,
    blocks,
    project,
    passport,
    documents,
    teams,
    users,
    teamReports,
    progressTimeseries,
    logoUrl,
    clientLogoUrl,
    stampUrl,
    projectSections,
    normCatalog,
    drawingItems,
    overridesByTeam,
    textOverridesById,
  } = data;
  const drawingNo = passport.drawing_no;
  // Толгойн огноо: гаргасан огноо → хугацааны төгсгөл → эхлэл.  `??` биш
  // `||`: `period_end` нь хоосон МӨР ('') байж болох тул `??` түүнийг
  // «утга бий» гэж үзээд огноогүй толгой үлдээнэ.
  const reportDate =
    report.issued_at?.slice(0, 10) || report.period_end || report.period_start || '';
  // Issued reports carry a frozen snapshot; drafts (which Browser
  // Rendering also renders for the live PDF preview path) get a live
  // projection from the project hierarchy so block resolvers can
  // find their team AND the numbers match what /issue would freeze.
  const effectiveTeams: TeamSnapshotItem[] = deriveEffectiveTeams(report, project);
  // Танилцуулгын авто утгууд — preview-тэй ЯГ ижил функц (lib/introAuto.ts).
  const introAuto = buildIntroAuto({
    project,
    passport,
    documents,
    teams,
    users,
    effectiveTeams,
    statusMeetings: report.status_meetings ?? [],
  });
  narrativeIndexRef.current.current = 0;

  /* Нүүр хуудасны «reportNo» override нь хуудас бүрийн толгойд ч
   * мөрдөгдөнө — нүүрэн дээр №02 гэж бичээд бусад хуудсанд №04
   * гарах алдааг таслана. */
  const shownReportNo = effectiveReportNo(blocks, report.report_no);
  const ctx: PdfBlockContext = {
    report,
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
    projectSections,
    normCatalog,
    introAuto,
    // `editable` өгөхгүй → ProjectIntroPage зөвхөн уншигдана, засварлах
    // туслах товчнууд render хийгдэхгүй.  A4Paginator-ыг ЭНД ХЭРЭГЛЭХГҮЙ:
    // хэвлэлд Chromium-ийн жинхэнэ @page тасалдал ажиллана.
  };

  // Pre-migration reports have no blocks; render a single placeholder
  // page so the PDF endpoint still returns something useful.
  if (blocks.length === 0) {
    return (
      <div className="perf-shell">
        {styleTag}
        <div className="perf-page">
          <p style={{ fontSize: 11, color: '#666', fontFamily: 'sans-serif' }}>
            Энэ тайлан нь хуучин загвараар хадгалагдсан тул блок бүртгэгдээгүй байна. Шинэ тайлан
            үүсгэх юм бол блокийн жагсаалт автоматаар үүсэх болно.
          </p>
        </div>
      </div>
    );
  }

  // Багуудын нэгтгэсэн график — placed right after the project-intro block
  // (section 1.3), not at the end. Fallback: append last if no intro block.
  const chartsEl = (
    <AllTeamChartsPage
      reportNo={shownReportNo}
      reportDocNo={drawingNo}
      reportDate={reportDate}
      teams={effectiveTeams}
      overallProgress={Number(project.project.progress) || 0}
      stats={computeChartStats(project, passport, effectiveTeams.length)}
    />
  );
  const hasIntro = blocks.some((b) => b.type === 'project-intro');

  // team-narrative doc-уудын зургийн жагсаалт: нийтлэг нэмэлт мөр + энэ
  // төслийн бүх багийн override нэрс (data нь Promise.all-д татагдсан тул
  // snapshot race-гүй).
  const drawingRowsResolver = makeDrawingRowsResolver(
    groupItemsByTeam(drawingItems),
    overridesByTeam,
  );

  /* Section 3-ийн дугаарлалт — preview-тэй ЯГ ижил функцээр урьдчилан
   * тооцоолно (`PdfBlockRenderer` одоо `React.memo` тул render дотор
   * ++ хийдэг ref тоолуурт найдаж болохгүй). */
  const narrativeIndexes = computeNarrativeIndexes(
    blocks,
    new Set(effectiveTeams.map((t) => t.team_code)),
  );

  /* Блокт харьяалагдахгүй хуудсууд (нэгтгэсэн график, гарын үсэг) нь
   * статик шошгоо танилцуулгын блокийн нэрийн зайд хадгалдаг —
   * preview дэх `docTextBlockId`-тай ижил дүрэм.  Хэвлэлд ЗАСВАРЛАХГҮЙ
   * тул `set: null`. */
  const docTextBlockId =
    blocks.find((b) => b.type === 'project-intro')?.id ?? blocks[0]?.id ?? 0;
  const docTextApi: ReportTextApi = {
    t: (key, fallback) => textOverridesById[docTextBlockId]?.[key] ?? fallback,
    set: null,
  };

  /* ── «Боловсруулсан ажилтан» → гарын үсэг / тамга ─────────────
   * Preview-тэй ЯГ ижил дүрэм (lib/signoffSigner.ts): нэрийг НЭГ
   * түлхүүрээс уншиж, хэрэглэгчийн жагсаалтаас олж, зургийг гаргана. */
  /* ⚠️ СЕРВЕРИЙН тодруулга ЭХЭЛЖ ялна (`GET …/:reportId` → `report.signoff`).
   *
   * Доорх frontend дүрэм `users` жагсаалтаас хамаардаг ба `GET /api/users`
   * нь `requireManager()`.  Тиймээс ЗАХИАЛАГЧ өөрөө (мөн инженер/архитектор)
   * PDF татахад 403 буцаж `users: []` болно — тамга нь гарсаар атал гарын
   * үсгийн зураг БА нэр хоёулаа алга болж, гарын үсэггүй баримт client тал
   * руу очдог байв.  Зөвхөн admin/senior татахад л зөв гардаг байсан.
   *
   * `??` (`||` БИШ): сервер ХООСОН МӨР буцаах нь «хэрэглэгч нэрийг зориуд
   * арилгасан» гэсэн ХҮЧИНТЭЙ утга. */
  const signerName =
    report.signoff?.name ??
    resolveSignerName(
      textOverridesById[docTextBlockId]?.[SIGNOFF_EXEC_REP_KEY],
      users,
      report.created_by_id,
    );
  const signerSignature = report.signoff
    ? report.signoff.signature_url
      ? mediaUrl(report.signoff.signature_url)
      : null
    : signerSignatureUrl(findSigner(users, signerName));

  /* Захиалагчийн байгууллагын нэр — «1.1 Ерөнхий мэдээлэл»-ийн утга.
   * Хэвлэлд амьд override байхгүй тул блокт ХАДГАЛАГДСАН override-оос
   * (coerceBlock түүнийг хадгалдаг) авна. */
  const storedIntroOverride: IntroOverride | null = (() => {
    const b = blocks.find((x) => x.type === 'project-intro');
    return b ? ((b.content as BlockContentMap['project-intro']).override ?? null) : null;
  })();
  const signoffClientName = resolveIntroModel(storedIntroOverride ?? {}, introAuto).clientName;

  return (
    <ReportBrandContext.Provider value={{ logoUrl, clientLogoUrl, stampUrl }}>
      <TocPageContext.Provider value={tocPages}>
        <DrawingListContext.Provider value={drawingRowsResolver}>
        <ReportTextContext.Provider value={docTextApi}>
        <div className="perf-shell" ref={shellRef}>
          {styleTag}
          {blocks.map((b) => (
            <Fragment key={b.id}>
              <PdfBlockRenderer
                block={b}
                ctx={ctx}
                /* ⚠️ `execution-summary` нь §1-тэй ижил гарчиг / шифр /
                   байршил / захирал хэвлэдэг ч ӨӨРИЙН хадгалагдсан
                   override-гүй тул түүнийг ЭНДЭЭС өгнө.  (`project-intro`
                   нь блокийнхоо контентоос өөрөө уншина.) */
                introOverride={b.type === 'execution-summary' ? storedIntroOverride : undefined}
                textOverrides={textOverridesById[b.id]}
                narrativeIndex={narrativeIndexes[b.id]}
                editable={false}
              />
              {b.type === 'project-intro' && chartsEl}
            </Fragment>
          ))}
          {!hasIntro && chartsEl}
          <FinalSignoffPage
            reportNo={shownReportNo}
            reportDocNo={drawingNo}
            reportDate={reportDate}
            overallProgress={Number(project.project.progress) || 0}
            clientName={signoffClientName}
            signerName={signerName}
            execSignatureUrl={signerSignature}
          />
        </div>
        </ReportTextContext.Provider>
        </DrawingListContext.Provider>
      </TocPageContext.Provider>
    </ReportBrandContext.Provider>
  );
}

function stubPassport(projectId: number): ProjectPassport {
  return {
    project_id: projectId,
    full_title: null,
    drawing_no: null,
    scope: null,
    director: null,
    client_pm: null,
    start_date: null,
    finish_date: null,
    extension_date: null,
    doc_no: null,
    meeting_30: null,
    meeting_50: null,
    meeting_100: null,
    disciplines: [],
    client_contacts: [],
    scope_rows: [],
    timeline: [],
    meetings: [],
    notes: null,
    updated_at: '',
    updated_by_id: null,
  };
}
