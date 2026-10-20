import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { apiFetch } from '@/shared/api/client';
import { BaReportDocument, BA_REPORT_STYLES } from '@/features/projects/team-reports/ba/BaDocument';
import { BbReportDocument, BB_REPORT_STYLES } from '@/features/projects/team-reports/bb/BbDocument';
import { HasReportDocument, HAS_REPORT_STYLES } from '@/features/projects/team-reports/has/HasDocument';
import { CbuReportDocument, CBU_REPORT_STYLES } from '@/features/projects/team-reports/cbu/CbuDocument';
import { TsahReportDocument, TSAH_REPORT_STYLES } from '@/features/projects/team-reports/tsah/TsahDocument';
import { HdReportDocument, HD_REPORT_STYLES } from '@/features/projects/team-reports/hd/HdDocument';
import { AuReportDocument, AU_REPORT_STYLES } from '@/features/projects/team-reports/au/AuDocument';
import {
  StatusQuestionsDocument,
  STATUS_DOC_STYLES,
} from '@/features/projects/team-reports/StatusQuestionsDocument';
import {
  TeamComponentStatsPanel,
  TEAM_STATS_DOC_STYLES,
} from '@/features/projects/team-reports/TeamComponentStatsPanel';
import {
  ProjectCorrespondencePanel,
  PROJECT_CORRESPONDENCE_DOC_STYLES,
} from '@/features/projects/team-reports/ProjectCorrespondencePanel';
import {
  NormDocument,
  NORM_DOC_STYLES,
} from '@/features/projects/team-reports/norm/NormDocument';
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
import {
  ProjectSectionDocument,
  PROJECT_SECTION_DOC_STYLES,
} from '@/features/projects/team-reports/project-sections/ProjectSectionDocument';
import { GENERAL_SECTIONS } from '@/features/projects/team-reports/project-sections/generalTemplate';
import { ROOMS_SECTIONS } from '@/features/projects/team-reports/project-sections/roomsTemplate';
import { FIRE_SECTIONS } from '@/features/projects/team-reports/project-sections/fireTemplate';
import { IzReportDocument, IZ_REPORT_STYLES } from '@/features/projects/team-reports/iz/IzDocument';
import type { IzReportAnswers } from '@/features/projects/team-reports/iz/types';
import type { BaReportAnswers } from '@/features/projects/team-reports/ba/types';
import type { TeamReportResource, TeamReportAnswers } from '@/features/projects/team-reports/types';
import { bridgePrintToken } from '@/shared/lib/printAuth';
import {
  ProjectDocumentHeader,
  PROJECT_DOC_HEADER_STYLES,
} from '@/shared/components/ProjectDocumentHeader';
import {
  resolveProjectIdentity,
  type PassportLike,
  type ProjectIdentity,
} from '@/shared/lib/projectIdentity';

/* =============================================================
 * Team report print page (Тайлбар бичиг).
 * -------------------------------------------------------------
 * Standalone route opened via window.open from a team's panel,
 * AND server-rendered by the backend's Browser Rendering binding
 * to produce the PDF download.  When the backend renders this
 * page it appends a short-lived `?t=<jwt>` token — we bridge that
 * into localStorage BEFORE React mounts so the very first
 * `apiFetch` already has the token (otherwise the page would 401
 * on cold render and Chromium would snapshot an empty shell).
 *
 * `?mode=client` toggles between internal Q-format and client
 * "Тайлан" presentation. Client mode also injects the
 * component-stats panel between the team's narrative document
 * and the status questions block so the PDF matches the in-app
 * Тайлан preview exactly.
 *
 * The toolbar is hidden under `@media print` so the browser's
 * print preview / PDF output is just the document body.
 * ============================================================= */

// Bridge the print token synchronously, BEFORE React mounts, so the very first
// apiFetch already has the token (no first-render 401 / empty-shell snapshot).
bridgePrintToken();

interface TeamReportResponse {
  report: TeamReportResource | null;
}

/* `GET /api/projects/:id`-ийн БИДЭНД хэрэгтэй хэсэг.
 *
 * ⚠️ Энэ маршрут паспорт, захиалагч, багийн хуваарийг АЛЬ ХЭДИЙН нэг
 * дуудлагаар буцаадаг (`routes/projects.ts:651-771`) тул толгойн өгөгдөл
 * ХОЁР ДАХЬ round trip шаардахгүй — хэвлэхийн өмнөх хүлээлт нэмэгдэхгүй.
 * Талбар бүр заавал биш: 24 төслийн 15-д нь л паспорт байдаг. */
interface ProjectMinimal {
  project: { id: number; name: string; display_title?: string | null; location: string | null };
  passport?: PassportLike | null;
  clients?: ReadonlyArray<{ name: string }> | null;
  team_shares?: ReadonlyArray<{ team_code: string; team_name_mn?: string | null }> | null;
}

/* Багийн код БИШ, төслийн ТҮВШНИЙ баримтууд.  Тэдэнд «Хэсэг» гэсэн
 * дисциплин байхгүй тул толгойд тэр мөрийг огт гаргахгүй (эс бөгөөс
 * «Хэсэг: NORM» гэсэн утгагүй мөр гарна).  `renderDocumentFor`-ийн
 * дөрвөн тусгай салаатай ИЖИЛ жагсаалт. */
const PROJECT_LEVEL_DOC_CODES = new Set(['GENERAL', 'NORM', 'ROOMS', 'FIRE']);

export default function TeamReportPrintPage() {
  const { id, teamCode: rawTeamCode } = useParams<{ id: string; teamCode: string }>();
  const teamCode = (rawTeamCode ?? '').toUpperCase();
  const projectId = id ? Number(id) : 0;
  // `?mode=client` switches the status-questions block into the
  // client-facing variant (declarative titles, no numbering, empty
  // sections suppressed) AND injects the component-stats panel.
  // Anything else (or absent) keeps the internal "Урьдчилан харах"
  // rendering — the historical default for internal print previews.
  const [searchParams] = useSearchParams();
  const mode: 'internal' | 'client' = searchParams.get('mode') === 'client' ? 'client' : 'internal';

  const [report, setReport] = useState<TeamReportResource | null>(null);
  const [detail, setDetail] = useState<ProjectMinimal | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Норм каталог DB-д шилжсэн тул NormDocument-д хэрэгтэй. Print snapshot
  // каталог ачаалахаас өмнө авагдахаас сэргийлж энд fetch хийж, readiness-д
  // тооцно (NORM тайлан эсвэл client горимын нэгдсэн баримтад л хэрэгтэй).
  const catalogNeeded = teamCode === 'NORM' || mode === 'client';
  const [normCatalog, setNormCatalog] = useState<NormCatalogCategory[] | null>(null);
  const [normCatalogSettled, setNormCatalogSettled] = useState(false);
  // Зургийн жагсаалт: нийтлэг нэмэлт мөрүүд + энэ багийн override нэрс —
  // Document-ууд DrawingListContext-ээр авдаг тул snapshot-аас өмнө татна.
  const [drawingItems, setDrawingItems] = useState<TeamDrawingItem[]>([]);
  const [teamOverrides, setTeamOverrides] = useState<TeamTemplateOverrides | null>(null);
  const [drawingSettled, setDrawingSettled] = useState(false);

  useEffect(() => {
    if (!id || !teamCode) return;
    let cancelled = false;
    (async () => {
      try {
        const [r, p] = await Promise.all([
          apiFetch<TeamReportResponse>(`/projects/${id}/team-reports/${teamCode}`),
          apiFetch<ProjectMinimal>(`/projects/${id}`).catch(() => null),
        ]);
        if (cancelled) return;
        setReport(r.report);
        /* ⚠️ `.catch(() => null)` нь ЗОРИУДЫНХ бөгөөд ЭНЭ ӨӨРЧЛӨЛТӨӨР Ч
         * ХЭВЭЭР ҮЛДЭНЭ: төслийн мэдээлэл ирээгүй бол толгой БАЙХГҮЙ
         * баримт хэвлэгдэнэ — гэхдээ хэвлэгдэнэ.  Хэрэв үүнийг заавал
         * шаардлагатай болговол `data-print-ready` хэзээ ч асахгүй, сервер
         * талын Browser Rendering 25 секунд хүлээгээд ХООСОН бүрхүүл
         * зурна.  Дутуу толгой нь өлгөөтэй PDF-ээс ДЭЭР. */
        setDetail(p);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Ачаалж чадсангүй');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, teamCode]);

  useEffect(() => {
    if (!id || !catalogNeeded) {
      setNormCatalogSettled(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<NormCatalogResponse>('/norm-catalog');
        if (!cancelled) setNormCatalog(res.catalog);
      } catch {
        /* каталог ачаалж чадаагүй ч readiness блоклохгүй */
      } finally {
        if (!cancelled) setNormCatalogSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, catalogNeeded]);

  useEffect(() => {
    if (!id || !teamCode) {
      setDrawingSettled(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [itemsRes, ovRes] = await Promise.all([
          apiFetch<{ items: TeamDrawingItem[] }>('/team-drawing-items').catch(() => ({
            items: [] as TeamDrawingItem[],
          })),
          apiFetch<{ overrides: TeamTemplateOverrides }>(
            `/projects/${id}/team-form-templates/${teamCode}`,
          ).catch(() => ({ overrides: {} as TeamTemplateOverrides })),
        ]);
        if (cancelled) return;
        setDrawingItems(itemsRes.items ?? []);
        setTeamOverrides(ovRes.overrides ?? null);
      } finally {
        if (!cancelled) setDrawingSettled(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, teamCode]);

  // Tell Browser Rendering when the page is safe to snapshot. The
  // PDF endpoint waits for body[data-print-ready="true"]; without it
  // puppeteer would fire `pdf()` before fonts loaded and the result
  // would be a blank page (Cloudflare's headless Chromium ships no
  // Cyrillic glyphs by default). Three rAF ticks give layout +
  // paint enough time to commit.
  useEffect(() => {
    if (!report && !error) return;
    // Каталог/зургийн жагсаалт ачаалж дуустал snapshot-ыг хойшлуулна.
    if (!normCatalogSettled || !drawingSettled) return;
    let cancelled = false;
    (async () => {
      try {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.body.dataset.printReady = 'true';
          });
        });
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [report, error, normCatalogSettled, drawingSettled]);

  // Hard safety: if everything stalled (network, auth, etc.) flip
  // the ready flag anyway after 18s so puppeteer's 25s waitFor
  // selector still resolves and we return a useful PDF (even if
  // it's the error shell).
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (document.body.dataset.printReady !== 'true') {
        document.body.dataset.printReady = 'true';
      }
    }, 18000);
    return () => window.clearTimeout(t);
  }, []);

  // Inject the document stylesheet at the document level so it applies
  // both to the on-screen preview and to the browser print pipeline.
  // STATUS_DOC_STYLES is always loaded because every team's report
  // starts with the universal status block.  TEAM_STATS_DOC_STYLES is
  // always loaded too — it costs nothing and lets the internal print
  // pick up the same styling if we ever surface stats there.
  /* Баримтын толгойн өгөгдөл — ЦОРЫН ГАНЦ resolver-оор.
   *
   * ⚠️ Шатлалыг (паспорт → `display_title` → `name` гэх мэт) энд БИТГИЙ
   * давт: `shared/lib/projectIdentity.ts` нь backend хостойгоо хамт
   * хөдөлдөг бөгөөд вэб, PDF, MCP гурав ижил гарчиг хэвлэх ҮНДЭС нь.
   *
   * ⚠️ Hook-ууд эрт буцаалтуудаас (`if (error) …`, `if (!report) …`) ӨМНӨ
   * дуудагдах ЁСТОЙ. */
  const identity: ProjectIdentity | null = useMemo(() => {
    if (!detail?.project) return null;
    return resolveProjectIdentity({
      project: detail.project,
      passport: detail.passport ?? null,
      clients: detail.clients ?? null,
      /* Багийн ахлахын НЭР зориуд дамжуулаагүй: толгойд ажилтны нэр
       * гардаггүй бөгөөд client горимд гарах ч ёсгүй. */
      teamShares: detail.team_shares ?? null,
    });
  }, [detail]);

  /* Энэ баримтын дисциплин.  Паспортын 1.2 мөрүүд (эсвэл түүний багийн
   * хуваарь дээрх нөхөлт) аль хэдийн код → шошго → монгол нэрийг агуулдаг
   * тул дисциплины лавлахыг ЭНД ДАХИН тодорхойлохгүй. */
  const disciplineLabel = useMemo(() => {
    if (!identity || PROJECT_LEVEL_DOC_CODES.has(teamCode)) return '';
    const row = identity.scopeRows.find((r) => r.code === teamCode);
    if (!row) return teamCode;
    const label = row.codeLabel || row.code || teamCode;
    return row.identification ? `${label} · ${row.identification}` : label;
  }, [identity, teamCode]);

  const styleTag = useMemo(
    () => (
      <style
        dangerouslySetInnerHTML={{
          __html:
            PAGE_STYLES +
            PROJECT_DOC_HEADER_STYLES +
            STATUS_DOC_STYLES +
            TEAM_STATS_DOC_STYLES +
            PROJECT_CORRESPONDENCE_DOC_STYLES +
            NORM_DOC_STYLES +
            PROJECT_SECTION_DOC_STYLES +
            BA_REPORT_STYLES +
            BB_REPORT_STYLES +
            HAS_REPORT_STYLES +
            CBU_REPORT_STYLES +
            TSAH_REPORT_STYLES +
            HD_REPORT_STYLES +
            AU_REPORT_STYLES +
            IZ_REPORT_STYLES,
        }}
      />
    ),
    [],
  );

  if (error)
    return <ErrorShell message={error} backTo={`/app/projects/${id}`} styleTag={styleTag} />;
  if (!report) {
    return (
      <ErrorShell
        message="Энэ багийн тайлбар бичиг бөглөгдөөгүй байна. Эхлээд төслийн 'Тайлбар бичиг' tab-аас тус багийн асуумжийг бөглөн хадгална уу."
        backTo={`/app/projects/${id}`}
        styleTag={styleTag}
      />
    );
  }

  const documentNode = renderDocumentFor(
    teamCode,
    report,
    mode,
    projectId,
    normCatalog ?? undefined,
  );

  // Documents зургийн жагсаалтаа context-оор авдаг (нийтлэг нэмэлт мөр +
  // энэ төслийн override нэрс) — provider-гүй бол хатуу үндсэн мөрүүд.
  const drawingRowsResolver = makeDrawingRowsResolver(groupItemsByTeam(drawingItems), {
    [teamCode]: teamOverrides,
  });

  return (
    <DrawingListContext.Provider value={drawingRowsResolver}>
    <div className="ba-print-shell">
      {styleTag}

      <div className="ba-print-toolbar">
        <Link to={`/app/projects/${id}`} className="ba-print-back-link">
          <ArrowLeft size={14} /> Буцах
        </Link>
        <div className="ba-print-title">
          {detail?.project.name ?? 'Тайлбар бичиг'} · {teamCode}
        </div>
        <button type="button" className="ba-print-button" onClick={() => window.print()}>
          <Printer size={14} /> Хэвлэх
        </button>
      </div>

      <div className="ba-print-page">
        {/* Төслийн толгой — 8 дисциплины баримт ба серверийн PDF ХОЁУЛАА
            ЭНЭ мөрөөр толгойтой болно (сервер яг энэ URL-ыг рендэрлэдэг).
            `identity` нь `null` бол ЮУ Ч гарахгүй бөгөөд хэвлэлт
            ХОЙШЛОХГҮЙ — дээрх fetch-ийн тайлбарыг үз. */}
        {identity && (
          <ProjectDocumentHeader
            identity={identity}
            audience={mode}
            discipline={disciplineLabel}
          />
        )}
        {documentNode}
      </div>
    </div>
    </DrawingListContext.Provider>
  );
}

/** Per-team document dispatch.
 *
 *  Internal mode (the default) keeps the historical order: status
 *  Q-block first, then the team's narrative document. Used by the
 *  in-app "Хэвлэх" button and the existing internal print flow.
 *
 *  Client mode mirrors the in-app Тайлан pane: the team's narrative
 *  leads, the component-stats panel sits in the middle, and the
 *  status block (with declarative titles) closes the document. */
function renderDocumentFor(
  teamCode: string,
  report: TeamReportResource,
  mode: 'internal' | 'client',
  projectId: number,
  normCatalog: NormCatalogCategory[] | undefined,
): React.ReactNode {
  // Project-level "Норм дүрэм" has its own standalone print — no team chrome
  // (status questions / stats / correspondence). Pass the loaded answers so the
  // document doesn't re-fetch (avoids the cold-render race on the PDF path).
  if (teamCode === 'GENERAL') {
    return (
      <ProjectSectionDocument
        projectId={projectId}
        code="GENERAL"
        docTitle="ҮНДЭСЛЭЛ, БАЙРШИЛ, АНГИЛАЛ"
        sections={GENERAL_SECTIONS}
        answers={report.answers as unknown as TeamReportAnswers}
      />
    );
  }
  if (teamCode === 'NORM') {
    return (
      <NormDocument
        projectId={projectId}
        answers={report.answers as unknown as NormAnswers}
        catalog={normCatalog}
      />
    );
  }
  if (teamCode === 'ROOMS') {
    return (
      <ProjectSectionDocument
        projectId={projectId}
        code="ROOMS"
        docTitle="ТЕХНИКИЙН ӨРӨӨ БА НӨӨЦ ТЭЖЭЭЛ"
        sections={ROOMS_SECTIONS}
        answers={report.answers as unknown as TeamReportAnswers}
      />
    );
  }
  if (teamCode === 'FIRE') {
    return (
      <ProjectSectionDocument
        projectId={projectId}
        code="FIRE"
        docTitle="ГАЛЫН АЮУЛГҮЙ БАЙДАЛ"
        sections={FIRE_SECTIONS}
        answers={report.answers as unknown as TeamReportAnswers}
      />
    );
  }

  const answers = (report.answers ?? {}) as Record<string, unknown>;
  // Бүх 8 багийн дисциплин баримт — PdfBlockRenderer.teamNarrativeParts-тай
  // ижил dispatch. (Өмнө зөвхөн BA/IZ байсан тул бусад багийн ТАЙЛБАР БИЧИГ,
  // доторх зургийн жагсаалт нь PDF-д огт гардаггүй байв.)
  const teamDoc =
    teamCode === 'BA' && report.building_type ? (
      <BaReportDocument
        answers={answers as unknown as BaReportAnswers}
        buildingType={report.building_type}
        mode={mode}
      />
    ) : teamCode === 'BB' ? (
      <BbReportDocument answers={answers as never} mode={mode} />
    ) : teamCode === 'HAS' ? (
      <HasReportDocument answers={answers as never} mode={mode} />
    ) : teamCode === 'TSBU' ? (
      <CbuReportDocument answers={answers as never} mode={mode} />
    ) : teamCode === 'TSAH' ? (
      <TsahReportDocument answers={answers as never} mode={mode} />
    ) : teamCode === 'HD' ? (
      <HdReportDocument answers={answers as never} mode={mode} />
    ) : teamCode === 'AU' ? (
      <AuReportDocument answers={answers as never} mode={mode} />
    ) : teamCode === 'IZ' ? (
      <IzReportDocument answers={answers as unknown as IzReportAnswers} mode={mode} />
    ) : null;

  if (mode === 'client') {
    return (
      <>
        {teamDoc}
        {teamDoc && <div style={{ height: '24px' }} />}
        <ProjectSectionDocument
          projectId={projectId}
          code="GENERAL"
          docTitle="ҮНДЭСЛЭЛ, БАЙРШИЛ, АНГИЛАЛ"
          sections={GENERAL_SECTIONS}
        />
        <div style={{ height: '24px' }} />
        <NormDocument projectId={projectId} catalog={normCatalog} />
        <div style={{ height: '24px' }} />
        <ProjectSectionDocument
          projectId={projectId}
          code="ROOMS"
          docTitle="ТЕХНИКИЙН ӨРӨӨ БА НӨӨЦ ТЭЖЭЭЛ"
          sections={ROOMS_SECTIONS}
        />
        <div style={{ height: '24px' }} />
        <ProjectSectionDocument
          projectId={projectId}
          code="FIRE"
          docTitle="ГАЛЫН АЮУЛГҮЙ БАЙДАЛ"
          sections={FIRE_SECTIONS}
        />
        <div style={{ height: '24px' }} />
        <TeamComponentStatsPanel projectId={projectId} teamCode={teamCode} />
        <div style={{ height: '24px' }} />
        <StatusQuestionsDocument answers={answers} mode="client" />
        <div style={{ height: '24px' }} />
        <ProjectCorrespondencePanel projectId={projectId} />
      </>
    );
  }

  return (
    <>
      <StatusQuestionsDocument answers={answers} mode="internal" />
      {teamDoc && (
        <>
          <div style={{ height: '24px' }} />
          {teamDoc}
        </>
      )}
    </>
  );
}

function ErrorShell({
  message,
  backTo,
  styleTag,
}: {
  message: string;
  backTo: string;
  styleTag: React.ReactNode;
}) {
  return (
    <div className="ba-print-shell">
      {styleTag}
      <div className="ba-print-error">
        <p>{message}</p>
        <Link to={backTo} className="ba-print-back-link">
          <ArrowLeft size={14} /> Төсөл рүү буцах
        </Link>
      </div>
    </div>
  );
}

const PAGE_STYLES = `
.ba-print-shell { min-height: 100vh; background: #e9eaee; padding: 0; }
.ba-print-toolbar {
  position: sticky; top: 0; z-index: 10;
  display: flex; align-items: center; justify-content: space-between;
  background: #1f2937; color: #fff; padding: 10px 16px; gap: 12px;
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
}
.ba-print-title { font-size: 13px; opacity: 0.9; flex: 1; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ba-print-back-link {
  display: inline-flex; align-items: center; gap: 4px;
  color: #fff; text-decoration: none; font-size: 13px; padding: 6px 10px;
  border-radius: 6px; background: rgba(255,255,255,0.06);
}
.ba-print-back-link:hover { background: rgba(255,255,255,0.14); }
.ba-print-button {
  display: inline-flex; align-items: center; gap: 6px;
  background: #2563eb; color: #fff; border: 0; padding: 7px 14px;
  border-radius: 6px; font-size: 13px; cursor: pointer;
}
.ba-print-button:hover { background: #1d4ed8; }
.ba-print-page { background: #fff; max-width: 820px; margin: 24px auto; padding: 32px 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
.ba-print-error { max-width: 600px; margin: 80px auto; background: #fff; padding: 24px; border-radius: 8px; text-align: center; font-family: ui-sans-serif, system-ui, sans-serif; color: #1f2937; }
.ba-print-error p { margin: 0 0 14px; font-size: 14px; }

@media print {
  /* Counteract index.css's global "body * { visibility: hidden }" print
   * isolation (it only re-shows .print-area) — this is a standalone print
   * route, so everything must stay visible or page.pdf() goes blank. */
  body, body * { visibility: visible !important; }
  .ba-print-shell { background: #fff; }
  .ba-print-toolbar { display: none; }
  .ba-print-page { box-shadow: none; max-width: none; margin: 0; padding: 0; }
}
@page { size: A4; margin: 16mm 14mm; }
`;
