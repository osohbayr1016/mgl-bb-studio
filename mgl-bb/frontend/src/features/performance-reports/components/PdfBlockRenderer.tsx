import { Component, memo, useMemo, type ReactNode } from 'react';
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
  StatusMeeting,
  WorkforceRow,
} from '@/features/performance-reports/types/performanceReport';
import {
  ReportTextContext,
  type ReportTextApi,
} from '@/features/performance-reports/lib/reportText';
import type {
  ReportBlock,
  BlockContentMap,
} from '@/features/performance-reports/types/performanceReportBlocks';
import type { TeamReportResource } from '@/features/projects/team-reports/types';
import { BaReportDocument } from '@/features/projects/team-reports/ba/BaDocument';
import { BbReportDocument } from '@/features/projects/team-reports/bb/BbDocument';
import { HasReportDocument } from '@/features/projects/team-reports/has/HasDocument';
import { CbuReportDocument } from '@/features/projects/team-reports/cbu/CbuDocument';
import { TsahReportDocument } from '@/features/projects/team-reports/tsah/TsahDocument';
import { HdReportDocument } from '@/features/projects/team-reports/hd/HdDocument';
import { AuReportDocument } from '@/features/projects/team-reports/au/AuDocument';
import { IzReportDocument } from '@/features/projects/team-reports/iz/IzDocument';
import { StatusQuestionsDocument } from '@/features/projects/team-reports/StatusQuestionsDocument';
import { TeamComponentStatsPanel } from '@/features/projects/team-reports/TeamComponentStatsPanel';
import { ProjectSectionDocument } from '@/features/projects/team-reports/project-sections/ProjectSectionDocument';
import { NormDocument } from '@/features/projects/team-reports/norm/NormDocument';
import { GENERAL_SECTIONS } from '@/features/projects/team-reports/project-sections/generalTemplate';
import { ROOMS_SECTIONS } from '@/features/projects/team-reports/project-sections/roomsTemplate';
import { FIRE_SECTIONS } from '@/features/projects/team-reports/project-sections/fireTemplate';
import type { NormAnswers } from '@/features/projects/team-reports/norm/NormPanel';
import type { NormCatalogCategory } from '@/features/projects/team-reports/norm/catalogApi';
import type { TeamReportAnswers } from '@/features/projects/team-reports/types';
import type { BaReportAnswers } from '@/features/projects/team-reports/ba/types';
import { CoverPage } from '@/features/performance-reports/components/CoverPage';
import { resolveCover } from '@/features/performance-reports/lib/blockContentResolve';
import {
  TableOfContents,
  PageHeader,
  PageFooter,
} from '@/features/performance-reports/components/TableOfContents';
import { ProjectIntroPage } from '@/features/performance-reports/components/ProjectIntroPage';
import { buildIntroAuto } from '@/features/performance-reports/lib/introAuto';
import {
  resolveIntroModel,
  type IntroAuto,
  type IntroOverride,
} from '@/features/performance-reports/types/introOverride';
import { TeamSectionPage } from '@/features/performance-reports/components/TeamSectionPage';
import { ProgressSummarySection } from '@/features/performance-reports/components/ProgressSummarySection';
import { ExecutionSummaryPage } from '@/features/performance-reports/components/ExecutionSummaryPage';

/* =============================================================
 * Block dispatch — turns one stored block into the matching
 * PDF section.  Mirrors landing's BlockRenderer.tsx switch.
 *
 * `ctx` carries the data the parameter-less blocks need (project,
 * passport, documents, team narratives, etc.) — fetched once by
 * the print page and shared across every block.
 * ============================================================= */

/** «Тайлангийн талбарууд» (зүүн талын форм) руу буцаах patch.
 *  Урьдчилан харах хуудсан дээр шууд засварласан утга энэ гинжээр
 *  редакторын локал төлөв рүү очиж, зүүн талын input мөн адил
 *  шинэчлэгдэнэ («sync both» — хэрэглэгчийн 4-р шаардлага). */
export interface ReportFieldPatch {
  summary_text?: string | null;
  notes?: string | null;
  period_start?: string;
  period_end?: string;
  status_meetings?: StatusMeeting[];
  workforce?: WorkforceRow[];
}

/** `ctx.report`-оос ГАРГАСАН хувьсамтгай талбарууд.  Зөвхөн
 *  `ExecutionSummaryPage` уншдаг (2026-08-25 нягтлав) тул ctx-ийн
 *  лавлагааг тогтвортой байлгахын тулд prop-оор явуулна. */
export interface LiveReportFields {
  summary_text?: string | null;
  workforce?: WorkforceRow[];
  status_meetings?: StatusMeeting[];
}

export interface PdfBlockContext {
  report: PerformanceReport;
  project: ProjectDetailResponse;
  projectId: number;
  passport: ProjectPassport;
  documents: ProjectClientDocument[];
  teams: Team[];
  users: User[];
  teamReports: TeamReportResource[];
  drawingNo: string | null;
  reportDate: string;
  /** Тайлангийн ХАРАГДАХ дугаар.  Нүүр хуудасны «reportNo» override нь
   *  хуудас бүрийн толгойд ч мөрдөгдөнө — «report.report_no» биш ЭНИЙГ
   *  ашиглана (lib/blockContentResolve.ts → effectiveReportNo). */
  reportNo: number;
  /** Effective team list. For issued reports this is the snapshot
   *  in `report.team_progress`; for drafts (where the snapshot is
   *  empty) it's a zero-progress fallback built from
   *  `project.team_shares` so the preview still shows the structure
   *  the issued report will have. */
  effectiveTeams: TeamSnapshotItem[];
  /** @deprecated «Scope of work» мөрүүд одоо `introAuto.scopeRows`-д
   *  амьдардаг (lib/introAuto.ts).  Талбарыг зөвхөн хуучин дуудагчид
   *  (TemplatePreview) эвдэрхийгүй байлгах үүднээс үлдээв — ямар ч блок
   *  үүнийг УНШИХГҮЙ. */
  teamScopes?: Array<{
    code: string;
    name_mn: string;
    leader_name: string | null;
    file_name: string;
  }>;
  /** «1. Төслийн танилцуулга»-ын авто утгууд.  Дуудагч урьдчилан
   *  тооцоолж өгвөл түүнийг, эс бөгөөс renderer нь ctx-ээс өөрөө
   *  `buildIntroAuto`-оор гаргана (TemplatePreview-ийн stub зам). */
  introAuto?: IntroAuto;
  /** ⚠️ ХУУЧИРСАН зам — `PdfBlockRenderer`-ийн ИЖИЛ НЭРТЭЙ prop-ыг
   *  хэрэглэ.  Танилцуулга бичих бүрд `ctx` шинэчлэгдвэл `React.memo`
   *  утгагүй болж БҮХ блок (recharts, багийн баримт) дахин render болно —
   *  яг энэ нь «маш удаан laggy» гэсэн гомдлын шалтгаан байсан.
   *  Талбарыг зөвхөн `TemplatePreview` мэтийн хуучин дуудагчид эвдэрхийгүй
   *  байлгах үүднээс үлдээв. */
  introOverride?: IntroOverride | null;
  /** ⚠️ ХУУЧИРСАН — prop хэлбэрээр дамжуул (дээрхийг үз). */
  onIntroChange?: (patch: Partial<IntroOverride>) => void;
  /** ⚠️ ХУУЧИРСАН — prop хэлбэрээр дамжуул (дээрхийг үз). */
  editable?: boolean;
  /** «Тайлангийн талбарууд»-ыг ХУУДСАН ДЭЭРЭЭС засварлах гарц.  Өгөөгүй
   *  (хэвлэх зам, issued тайлан) бол тэдгээр талбар зөвхөн уншигдана. */
  onReportChange?: (patch: ReportFieldPatch) => void;
  /** Daily project-wide progress curve for the 'all-team-charts' line
   *  chart. Frozen on issued reports, fetched live for drafts; `[]`
   *  when unavailable (the chart renders its empty state). */
  progressTimeseries: ProgressTimeseriesPoint[];
  /** Numbering for team-narrative blocks within Section 3. The
   *  renderer increments this for each team-narrative block it
   *  emits so the user-visible "{n}. {name} – {progress}%" stays
   *  sequential even when blocks are reordered. */
  teamNarrativeIndex: { current: number };
  /** Pre-fetched project-level report answers (GENERAL/NORM/ROOMS/FIRE) for
   *  the `project-sections` block. The PDF page fetches these so the docs
   *  don't self-fetch (snapshot race); preview leaves them undefined and the
   *  docs self-fetch. */
  projectSections?: Partial<Record<'GENERAL' | 'ROOMS' | 'FIRE', TeamReportAnswers>> & {
    NORM?: NormAnswers;
  };
  /** Pre-fetched norm catalog for the `project-sections` block's NormDocument. */
  normCatalog?: NormCatalogCategory[];
}

export interface PdfBlockRendererProps {
  block: ReportBlock;
  /** ЗӨВХӨН тогтвортой (memo хийгдсэн) утгууд.  Хувьсамтгай зүйлийг
   *  доорх тусдаа prop-оор дамжуул — эс бөгөөс `React.memo` нурна. */
  ctx: PdfBlockContext;
  /** `project-intro` БА `execution-summary` блокт өгнө.
   *  ⚠️ Хоёр хуудас НЭГ ижил гарчиг / шифр / байршил / захирал хэвлэдэг тул
   *  §1-ийн override нь хураангуй хуудсанд ч мөрдөгдөх ЁСТОЙ.  Урьд нь
   *  зөвхөн §1-д дамждаг байсан учир хураангуй хуудас паспортын түүхий
   *  утгыг хэвлэж, гараар засварласан нэр хоёр хуудсанд ЗӨРДӨГ байв. */
  introOverride?: IntroOverride | null;
  onIntroChange?: (patch: Partial<IntroOverride>) => void;
  /** Энэ блокийн засварлагдсан СТАТИК шошгууд (`lib/reportText.tsx`). */
  textOverrides?: Record<string, string>;
  onTextChange?: (blockId: number, key: string, value: string) => void;
  editable?: boolean;
  /** ХУВЬСАМТГАЙ тайлангийн талбарууд — ЗӨВХӨН `execution-summary` блокт.
   *  `ctx.report`-ыг тогтвортой байлгах үүднээс эдгээрийг тусад нь
   *  дамжуулна (`introOverride`-тай ижил хэв маяг): хуудсан дээрх
   *  «Танилцуулга» / «Ажиллах хүчин» талбарт бичихэд ЗӨВХӨН тэр блок
   *  дахин render болно, багийн баримт/хүснэгтүүд хөдлөхгүй.
   *  ⚠️ `useMemo`-той тогтвортой лавлагаа байх ЁСТОЙ. */
  liveFields?: LiveReportFields;
  /** Section 3-ийн дугаарлалт.  Урьд нь `ctx.teamNarrativeIndex` рефийг
   *  render дотор ++ хийж тоолдог байсан — `React.memo`-той хамт тэр нь
   *  ЭВДЭРНЭ (алгассан блок тоологдохгүй).  Тиймээс дуудагч урьдчилан
   *  тооцоолж (`computeNarrativeIndexes`) энд өгнө. */
  narrativeIndex?: number;
}

/** Render-ийн хувьсамтгай хэсэг — `ctx`-ээс АНГИД байлгаснаар
 *  танилцуулга дээр бичихэд зөвхөн танилцуулгын блок дахин render болно. */
interface RenderOpts {
  editable: boolean;
  introOverride?: IntroOverride | null;
  onIntroChange?: (patch: Partial<IntroOverride>) => void;
  liveFields?: LiveReportFields;
  narrativeIndex?: number;
}

/* ⚠️ `React.memo` — гүйцэтгэлийн гол засвар.  Блок бүр өөрийн
 * агуулга/override өөрчлөгдсөн үед л дахин render болно; танилцуулгын
 * талбарт түлхүүр дарахад recharts график, багийн ТАЙЛБАР БИЧИГ,
 * норм/өрөө/галын баримтууд ХӨДӨЛӨХГҮЙ. */
export const PdfBlockRenderer = memo(function PdfBlockRenderer({
  block,
  ctx,
  introOverride,
  onIntroChange,
  textOverrides,
  onTextChange,
  editable,
  liveFields,
  narrativeIndex,
}: PdfBlockRendererProps) {
  // Хуучин дуудагчид (TemplatePreview) ctx-ээр дамжуулсаар байгаа тул
  // prop → ctx гэсэн дарааллаар шийднэ.
  const isEditable = editable ?? ctx.editable ?? false;
  const blockId = block.id;
  const textApi = useMemo<ReportTextApi>(
    () => ({
      t: (key: string, fallback: string) => textOverrides?.[key] ?? fallback,
      set:
        isEditable && onTextChange
          ? (key: string, value: string) => onTextChange(blockId, key, value)
          : null,
    }),
    [textOverrides, isEditable, onTextChange, blockId],
  );

  if (block.hidden) return null;
  const opts: RenderOpts = {
    editable: isEditable,
    introOverride: introOverride !== undefined ? introOverride : ctx.introOverride,
    onIntroChange: onIntroChange ?? ctx.onIntroChange,
    liveFields,
    narrativeIndex,
  };
  return (
    <ReportTextContext.Provider value={textApi}>
      <BlockErrorBoundary blockType={block.type}>{renderByType(block, ctx, opts)}</BlockErrorBoundary>
    </ReportTextContext.Provider>
  );
});

/* Section 3-ийн блокуудын дугаарыг УРЬДЧИЛАН тооцоолно.
 * -------------------------------------------------------------
 * Дүрэм нь хуучин ref-тэй хувилбартай яг ижил байх ёстой:
 *   • нуусан блок тоологдохгүй,
 *   • багаа олоогүй `team-narrative` тоологдохгүй (MissingTeamPage),
 *   • `team-stats` нь ӨМНӨХ narrative-ийн дугаарыг дахин хэрэглэнэ
 *     (өмнө нь байхгүй бол 1). */
export function computeNarrativeIndexes(
  blocks: ReportBlock[],
  knownTeamCodes: ReadonlySet<string>,
): Record<number, number> {
  const out: Record<number, number> = {};
  let n = 0;
  for (const b of blocks) {
    if (b.hidden) continue;
    if (b.type === 'team-narrative') {
      const code = (b.content as BlockContentMap['team-narrative']).team_code;
      if (!knownTeamCodes.has(code)) continue;
      out[b.id] = ++n;
    } else if (b.type === 'team-stats') {
      out[b.id] = n > 0 ? n : 1;
    }
  }
  return out;
}

function renderByType(block: ReportBlock, ctx: PdfBlockContext, opts: RenderOpts): ReactNode {
  switch (block.type) {
    case 'cover': {
      const override = (block.content as BlockContentMap['cover']).override;
      const m = resolveCover(ctx, override);
      return (
        <CoverPage
          reportNo={m.reportNo}
          periodStart={m.periodStart}
          periodEnd={m.periodEnd}
          projectFullTitle={m.projectFullTitle}
          projectName={m.projectName}
          clientName={m.clientName}
          drawingNo={m.drawingNo}
        />
      );
    }

    case 'toc':
      return (
        <TableOfContents
          reportNo={ctx.reportNo}
          reportDocNo={ctx.drawingNo}
          reportDate={ctx.reportDate}
          teams={ctx.effectiveTeams}
        />
      );

    case 'project-intro': {
      // Давуу эрэмбэ: редакторын амьд төлөв → блокийн хадгалагдсан
      // override → авто.  `ctx.introOverride === undefined` (өгөөгүй) үед
      // л блокийн контент уншигдана; `null` нь «override байхгүй» гэсэн
      // ЖИНХЭНЭ утга тул түүнийг давж блок руу унах ёсгүй.
      const stored = (block.content as BlockContentMap['project-intro']).override;
      const override = opts.introOverride !== undefined ? opts.introOverride : stored;
      const model = resolveIntroModel(override, ctx.introAuto ?? introAutoFromCtx(ctx));
      return (
        <ProjectIntroPage
          reportNo={ctx.reportNo}
          reportDate={ctx.reportDate}
          drawingNo={ctx.drawingNo}
          model={model}
          onChange={opts.editable ? opts.onIntroChange : undefined}
          disabled={!opts.editable}
        />
      );
    }

    case 'team-narrative': {
      const content = block.content as BlockContentMap['team-narrative'];
      const team = ctx.effectiveTeams.find((t) => t.team_code === content.team_code);
      if (!team) return <MissingTeamPage code={content.team_code} ctx={ctx} />;
      // Урьдчилан тооцоолсон дугаар байвал түүнийг (memo-той нийцтэй);
      // эс бөгөөс хуучин ref-тэй зам (TemplatePreview).
      const idx = opts.narrativeIndex ?? ++ctx.teamNarrativeIndex.current;
      const teamReport = ctx.teamReports.find((tr) => tr.team_code === team.team_code) ?? null;
      const pageProps = {
        reportNo: ctx.reportNo,
        reportDocNo: ctx.drawingNo,
        reportDate: ctx.reportDate,
        team,
        index: idx,
      };
      // No filled report yet → a single placeholder page (unchanged).
      // Sign-off lives on the team-stats (ЯВЦЫН ТОЙМ) page now, not here.
      if (!teamReport) {
        return (
          <TeamSectionPage {...pageProps} tocId={`team-narr-${team.team_code}`}>
            {null}
          </TeamSectionPage>
        );
      }
      // ТАЙЛБАР БИЧИГ + the status questions flow as ONE continuous section:
      // the doc fills the page, and when it runs out the questions continue
      // straight on (no forced page break that would leave the first page
      // half-empty). Section headings stay glued to their text and Q&A items
      // don't split (break-after/break-inside rules in styles.ts +
      // STATUS_DOC_STYLES), and block flow respects the @page margins so the
      // content never spills over the footer.
      const { doc, statusQ } = teamNarrativeParts(team, teamReport);
      return (
        <TeamSectionPage {...pageProps} tocId={`team-narr-${team.team_code}`}>
          {doc}
          {statusQ}
        </TeamSectionPage>
      );
    }

    case 'team-stats': {
      const content = block.content as BlockContentMap['team-stats'];
      const team = ctx.effectiveTeams.find((t) => t.team_code === content.team_code);
      if (!team) return <MissingTeamPage code={content.team_code} ctx={ctx} />;
      const idx = opts.narrativeIndex ?? (ctx.teamNarrativeIndex.current || 0);
      return (
        <TeamSectionPage
          reportNo={ctx.reportNo}
          reportDocNo={ctx.drawingNo}
          reportDate={ctx.reportDate}
          team={team}
          index={idx > 0 ? idx : 1}
          tocId={`team-stats-${team.team_code}`}
        >
          <TeamComponentStatsPanel projectId={ctx.projectId} teamCode={team.team_code} />
        </TeamSectionPage>
      );
    }

    case 'all-team-stats':
      // ProgressSummarySection iterates report.team_progress internally;
      // spread the effective list onto a derived report so drafts work too.
      return (
        <ProgressSummarySection
          report={{ ...ctx.report, team_progress: ctx.effectiveTeams }}
          reportNo={ctx.reportNo}
          projectId={ctx.projectId}
          reportDocNo={ctx.drawingNo}
          reportDate={ctx.reportDate}
        />
      );

    case 'project-sections':
      return <ProjectSectionsBlock ctx={ctx} />;

    case 'execution-summary': {
      /* ⚠️ `??` БИШ, `live ? … : …`.  Хэрэглэгч «Танилцуулга»-г БҮРЭН
       * арилгахад `summary_text` нь `null` болдог — `??` тэр үед
       * `ctx.report`-ын ХУУЧИН текстийг сэргээж, арилгасан зүйл буцаж
       * ирэх алдаа гарна. */
      const live = opts.liveFields;
      /* ⚠️ Гарчиг / шифр / байршил / захирал / захиалагч — §1-ИЙН ЯГ ТЭР
       * ДУУДЛАГА (`resolveIntroModel(override, auto)`).  Энэ хуудас урьд нь
       * паспортыг ШУУД уншдаг байсан тул §1 дээр гараар засварласан утга
       * энд тусдаггүй, мөн `display_title`-тай паспортгүй төсөл дээр (жишээ
       * нь 57-р төсөл) §1 урт гарчгийг, энэ хуудас богино `name`-ийг
       * хэвлэдэг байв.
       * ⚠️ `opts.introOverride` нь `project-intro` салаатай ИЖИЛ эх
       * сурвалж — дуудагч (`PerformanceReportPreview` / `…PrintPage`) энэ
       * блокт мөн адил дамжуулна.  Өгөөгүй бол (TemplatePreview-ийн stub
       * зам) авто давхарга л ажиллана. */
      const introFacts = resolveIntroModel(
        opts.introOverride,
        ctx.introAuto ?? introAutoFromCtx(ctx),
      );
      return (
        <ExecutionSummaryPage
          reportNo={ctx.reportNo}
          reportDocNo={ctx.drawingNo}
          reportDate={ctx.reportDate}
          overallProgress={Number(ctx.project.project.progress) || 0}
          intro={introFacts}
          /* ⚠️ `opts.liveFields` нь ctx-ээс ГАРГАСАН хувьсамтгай утга —
             байвал түүнийг эхэлж авна.  Хэвлэх зам / TemplatePreview нь
             өгдөггүй тул `ctx.report` руу уначихна. */
          meetings={live ? (live.status_meetings ?? []) : ctx.report.status_meetings}
          summaryText={live ? live.summary_text : ctx.report.summary_text}
          workforce={live ? live.workforce : ctx.report.workforce}
          onReportChange={ctx.onReportChange}
        />
      );
    }

    case 'rich-text': {
      const content = block.content as BlockContentMap['rich-text'];
      if (!content.heading && !content.body) return null;
      return (
        <div className="perf-page">
          <PageHeader
            reportNo={ctx.reportNo}
            reportDocNo={ctx.drawingNo}
            reportDate={ctx.reportDate}
          />
          {content.heading && <div className="perf-intro__section-num">{content.heading}</div>}
          {content.body && <p className="perf-summary__intro">{content.body}</p>}
          <PageFooter />
        </div>
      );
    }

    case 'divider': {
      const content = block.content as BlockContentMap['divider'];
      if (content.style === 'page-break') {
        // Empty .perf-page produces a blank page-break-after page.
        return <div className="perf-page" />;
      }
      // Hairline: thin rule inside its own narrow page so it doesn't
      // bleed across sections in the PDF render flow.
      return (
        <div
          className="perf-page"
          style={{ minHeight: 'auto', paddingTop: '12mm', paddingBottom: '12mm' }}
        >
          <hr style={{ border: 0, borderTop: '1px solid #999', margin: '0' }} />
        </div>
      );
    }

    default:
      return null;
  }
}

/* `ctx.introAuto`-г өгөөгүй дуудагчид (TemplatePreview) зориулсан нөөц зам —
 * ctx-д аль хэдийн байгаа өгөгдлөөс ижил авто загварыг гаргана. */
function introAutoFromCtx(ctx: PdfBlockContext): IntroAuto {
  return buildIntroAuto({
    project: ctx.project,
    passport: ctx.passport,
    documents: ctx.documents,
    teams: ctx.teams,
    users: ctx.users,
    effectiveTeams: ctx.effectiveTeams,
    statusMeetings: ctx.report.status_meetings,
  });
}

/* Project-түвшний хэсгүүд (Үндэслэл/Норм/Өрөө/Гал) — Гүйцэтгэлийн тайлангийн
 * эхэнд (танилцуулгын дараа). Хэсэг бүр өөрийн .perf-page-д, зөвхөн агуулгатай
 * бол л боогдоно — хоосон doc нь `null` буцаах тул хоосон хуудас үүсэхгүй.
 * PDF-д ctx.projectSections/normCatalog-оор pre-fetch дамждаг (snapshot race-
 * гүй); preview-д document-ууд өөрсдөө fetch хийнэ. */
function ProjectSectionsBlock({ ctx }: { ctx: PdfBlockContext }) {
  const chrome = (content: ReactNode) => (
    <div className="perf-page">
      <PageHeader
        reportNo={ctx.reportNo}
        reportDocNo={ctx.drawingNo}
        reportDate={ctx.reportDate}
      />
      {content}
      <PageFooter />
    </div>
  );
  return (
    <>
      <ProjectSectionDocument
        projectId={ctx.projectId}
        code="GENERAL"
        docTitle="ҮНДЭСЛЭЛ, БАЙРШИЛ, АНГИЛАЛ"
        sections={GENERAL_SECTIONS}
        answers={ctx.projectSections?.GENERAL}
        wrap={chrome}
      />
      <NormDocument
        projectId={ctx.projectId}
        answers={ctx.projectSections?.NORM}
        catalog={ctx.normCatalog}
        wrap={chrome}
      />
      <ProjectSectionDocument
        projectId={ctx.projectId}
        code="ROOMS"
        docTitle="ТЕХНИКИЙН ӨРӨӨ БА НӨӨЦ ТЭЖЭЭЛ"
        sections={ROOMS_SECTIONS}
        answers={ctx.projectSections?.ROOMS}
        wrap={chrome}
      />
      <ProjectSectionDocument
        projectId={ctx.projectId}
        code="FIRE"
        docTitle="ГАЛЫН АЮУЛГҮЙ БАЙДАЛ"
        sections={FIRE_SECTIONS}
        answers={ctx.projectSections?.FIRE}
        wrap={chrome}
      />
    </>
  );
}

/* Splits a team's narrative into its two printable halves so the
 * caller can place each on its own page: the discipline ТАЙЛБАР БИЧИГ
 * document (`doc`, null when the team has none / BA without a building
 * type) and the universal 5-question status block (`statusQ`). */
function teamNarrativeParts(
  team: TeamSnapshotItem,
  report: TeamReportResource,
): { doc: ReactNode | null; statusQ: ReactNode } {
  const answers = (report.answers ?? {}) as Record<string, unknown>;
  const statusQ = <StatusQuestionsDocument answers={answers} mode="client" />;
  let doc: ReactNode | null = null;
  switch (team.team_code) {
    case 'BA':
      doc = report.building_type ? (
        <BaReportDocument
          answers={answers as unknown as BaReportAnswers}
          buildingType={report.building_type}
          mode="client"
        />
      ) : null;
      break;
    case 'BB':
      doc = <BbReportDocument answers={answers as never} mode="client" />;
      break;
    case 'HAS':
      doc = <HasReportDocument answers={answers as never} mode="client" />;
      break;
    case 'TSBU':
      doc = <CbuReportDocument answers={answers as never} mode="client" />;
      break;
    case 'TSAH':
      doc = <TsahReportDocument answers={answers as never} mode="client" />;
      break;
    case 'HD':
      doc = <HdReportDocument answers={answers as never} mode="client" />;
      break;
    case 'AU':
      doc = <AuReportDocument answers={answers as never} mode="client" />;
      break;
    case 'IZ':
      doc = <IzReportDocument answers={answers as never} mode="client" />;
      break;
    default:
      doc = null;
  }
  return { doc, statusQ };
}

function MissingTeamPage({ code, ctx }: { code: string; ctx: PdfBlockContext }) {
  return (
    <div className="perf-page">
      <PageHeader
        reportNo={ctx.reportNo}
        reportDocNo={ctx.drawingNo}
        reportDate={ctx.reportDate}
      />
      <div className="perf-intro__section-num">— {code || '?'}</div>
      <p className="perf-summary__intro">
        Энэ багийг төсөл дээр сонгоогүй байна. Тайлангаас энэ блокыг устгаж эсвэл багийг төсөлд
        нэмнэ үү.
      </p>
      <PageFooter />
    </div>
  );
}

/* Per-block error boundary so one broken block doesn't blank the
 * entire PDF.  Mirrors landing's BlockErrorBoundary — silent in
 * production-print, visible inline if mounted in the editor. */
interface BoundaryProps {
  blockType: string;
  children: ReactNode;
}
interface BoundaryState {
  error: Error | null;
}
class BlockErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.warn(`[block:${this.props.blockType}] render failed`, error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="perf-page">
          <p style={{ color: '#9b1f1f', fontSize: 11, fontFamily: 'sans-serif' }}>
            [{this.props.blockType}] {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
