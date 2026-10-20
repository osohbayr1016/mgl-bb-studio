import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  Save,
  Send,
  Plus,
  CheckCircle2,
  X,
} from 'lucide-react';
import { apiFetch, apiFetchBlob, ApiError, downloadPdf } from '@/shared/api/client';
import { useLanguage } from '@/shared/i18n';
import { useApiQuery } from '@/shared/api/useApi';
import { useAuth } from '@/shared/context/AuthContext';
import { toast } from '@/shared/components/Toast';
import { confirmDialog } from '@/shared/components/ConfirmDialog';
import { Button } from '@/ui/button';
import { Card, CardContent } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { Textarea } from '@/ui/textarea';
import { BlockListEditor } from '@/features/performance-reports/components/blocks/BlockListEditor';
import { PerformanceReportPreview } from '@/features/performance-reports/components/PerformanceReportPreview';
import type { ReportFieldPatch } from '@/features/performance-reports/components/PdfBlockRenderer';
import { StirlingPdfActions } from '@/features/performance-reports/components/StirlingPdfActions';
import { deriveEffectiveTeams } from '@/features/performance-reports/components/effectiveTeams';
import type {
  ProjectDetailResponse,
  ProjectPassport,
  ProjectClientDocument,
  Team,
  User,
} from '@/shared/types';
import {
  coerceBlock,
  type BlockContentMap,
  type ReportBlock,
  type ReportBlockRaw,
} from '@/features/performance-reports/types/performanceReportBlocks';
import { IntroBlockEditor } from '@/features/performance-reports/components/blocks/IntroBlockEditor';
import { buildIntroAuto, emptyPassport } from '@/features/performance-reports/lib/introAuto';
import {
  resolveIntroModel,
  type IntroOverride,
} from '@/features/performance-reports/types/introOverride';
import type { CoverModel } from '@/features/performance-reports/lib/blockContentResolve';
import { resolveProjectIdentity } from '@/shared/lib/projectIdentity';
import type {
  PerformanceReport,
  TeamSnapshotItem,
  StatusMeeting,
  WorkforceRow,
  PerformanceReportDraftInput,
  ReportRisk,
  ReportRag,
} from '@/features/performance-reports/types/performanceReport';
import {
  SIGNOFF_EXEC_REP_KEY,
  resolveSignerName,
} from '@/features/performance-reports/lib/signoffSigner';
import { DesktopOnlyNotice } from '@/shared/components/DesktopOnlyNotice';

/* =============================================================
 * Performance report editor — per-report block composer.
 * -------------------------------------------------------------
 * Pulls the report + its block list, lets admins edit the
 * report-level fields (period, meetings, summary_text, workforce)
 * AND the block list (add / reorder / hide / delete / edit each
 * block's payload).
 *
 * Issued reports go read-only: the editor still loads so users
 * can review, but every action button is disabled.
 * ============================================================= */

const ADMIN_TIER = new Set(['admin']);

/** Хоёр `textOverrides` газрын зураг агуулгаараа ижил эсэх (гүн 2).
 *  Seed effect-д ижил бол хуучин лавлагааг үлдээх зорилготой —
 *  шинэ объект бүр preview-гийн `React.memo`-г дэмий нураана. */
function sameTextMap(
  a: Record<number, Record<string, string>>,
  b: Record<number, Record<string, string>>,
): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[Number(k)];
    const y = b[Number(k)];
    if (!x || !y) return false;
    const xk = Object.keys(x);
    if (xk.length !== Object.keys(y).length) return false;
    for (const kk of xk) if (x[kk] !== y[kk]) return false;
  }
  return true;
}

interface ReportPlusBlocks {
  report: PerformanceReport;
  blocks: ReportBlockRaw[];
}

export default function PerformanceReportEditorPage() {
  const { t } = useLanguage();
  const { id, reportId } = useParams<{ id: string; reportId: string }>();
  const projectId = Number(id);
  const reportIdNum = Number(reportId);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = !!user && ADMIN_TIER.has(user.role);

  const queryKey = ['/projects', projectId, 'performance-reports', reportIdNum] as const;
  const reportQuery = useApiQuery<ReportPlusBlocks>(
    queryKey,
    `/projects/${projectId}/performance-reports/${reportIdNum}`,
    { enabled: Number.isFinite(projectId) && Number.isFinite(reportIdNum) },
  );

  const projectQuery = useApiQuery<ProjectDetailResponse>(
    ['/projects', projectId] as const,
    `/projects/${projectId}`,
    { enabled: Number.isFinite(projectId) },
  );

  const passportQuery = useApiQuery<{ passport: ProjectPassport }>(
    ['/projects', projectId, 'passport'] as const,
    `/projects/${projectId}/passport`,
    { enabled: Number.isFinite(projectId), retry: false },
  );

  /* Танилцуулгын авто утгуудад хэрэгтэй нэмэлт өгөгдөл.  Түлхүүрүүд нь
   * PerformanceReportPreview-ийнхтэй ЯГ ИЖИЛ — тиймээс TanStack Query
   * хоёр дахь сүлжээний дуудлага хийхгүй, кэшийг хуваалцана. */
  const documentsQuery = useApiQuery<{ documents: ProjectClientDocument[] }>(
    ['/projects', projectId, 'client-documents'],
    `/projects/${projectId}/client-documents`,
    { enabled: Number.isFinite(projectId), retry: false },
  );
  const teamsQuery = useApiQuery<{ teams: Team[] }>(['/teams'], '/teams', { retry: false });
  const usersQuery = useApiQuery<{ users: User[] }>(['/users'], '/users', { retry: false });

  const blocks = useMemo<ReportBlock[]>(
    () => (reportQuery.data?.blocks ?? []).map(coerceBlock),
    [reportQuery.data],
  );
  const report = reportQuery.data?.report ?? null;
  const isIssued = report?.status === 'issued';
  const readOnly = !canManage || isIssued;

  const projectData = projectQuery.data ?? null;
  const passportData = passportQuery.data?.passport ?? null;

  // Editor-д блокийн авто render model-ийг өгнө (override талбаруудыг
  // урьдчилан дүүргэх placeholder-д). Зөвхөн cover дэмжигдсэн (Sub-project 1).
  const autoModelFor = useCallback(
    (block: ReportBlock): unknown => {
      if (block.type === 'cover' && projectData && report) {
        /* ⚠️ Гарчиг/шифрийн шатлалыг ЭНД БИТГИЙ БИЧ.  Энэ нь нүүр хуудасны
         * override input-уудын placeholder тул `lib/blockContentResolve.ts`
         * → `resolveCoverAuto`-той ЯГ ИЖИЛ утга гаргах ёстой; эс бөгөөс
         * placeholder нэг нэр, бодит хэвлэлт өөр нэр харуулна.
         * Урьд нь энд `full_title ?? name` гэсэн ДӨРӨВ ДЭХ хуулбар байсан
         * тул `display_title`-тай, паспортгүй төслүүд (жишээ нь 57-р төсөл)
         * дээр хоёул зөрдөг байв.  ⚠️ `resolveCoverAuto` нь бүрэн
         * `PdfBlockContext` шаарддаг (энэ хуудсанд байхгүй) тул түүний
         * тулгуур болох resolver-ийг ШУУД дуудав. */
        const identity = resolveProjectIdentity({
          project: projectData.project,
          passport: passportData,
        });
        const cover: CoverModel = {
          reportNo: report.report_no,
          periodStart: report.period_start,
          periodEnd: report.period_end,
          projectFullTitle: identity.title,
          projectName: identity.shortName,
          /* ⚠️ Захиалагчийг resolver-ээс ЗОРИУД авахгүй — нүүр хуудас нь
           * ЭХНИЙ захиалагчийг хашилтгүй хэвлэдэг (resolveCoverAuto-гийн
           * тайлбарыг үз). */
          clientName: projectData.clients?.[0]?.name ?? null,
          drawingNo: identity.drawingNo || null,
        };
        return cover;
      }
      return null;
    },
    [projectData, passportData, report],
  );

  const [issuing, setIssuing] = useState(false);

  // Local draft state mirrors the report-level fields. Saved by
  // pressing "Хадгалах" — block edits autosave per-row.
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [summaryText, setSummaryText] = useState('');
  /** Тайлангийн тэмдэглэл.  Зүүн талд input байхгүй — ЗӨВХӨН хуудсан
   *  дээрээс засварлагдана (`onReportChange`), гэхдээ хадгалалт нь
   *  бусад талбартай ижил «Хадгалах» товчоор явна. */
  const [notes, setNotes] = useState('');
  const [meetings, setMeetings] = useState<StatusMeeting[]>([]);
  const [workforce, setWorkforce] = useState<WorkforceRow[]>([]);
  // Client-report authored fields (executive summary, risks, next-period plan).
  const [clientSummary, setClientSummary] = useState('');
  const [risks, setRisks] = useState<ReportRisk[]>([]);
  const [nextPlan, setNextPlan] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed local state when the report row arrives or is invalidated.
  useEffect(() => {
    if (!report || dirty) return;
    setPeriodStart(report.period_start);
    setPeriodEnd(report.period_end);
    setSummaryText(report.summary_text ?? '');
    setNotes(report.notes ?? '');
    setMeetings(report.status_meetings ?? []);
    setWorkforce(report.workforce ?? []);
    setClientSummary(report.client_summary_md ?? '');
    setRisks(report.risks ?? []);
    setNextPlan(report.next_plan ?? []);
  }, [report, dirty]);

  const refresh = () => queryClient.invalidateQueries({ queryKey });

  /* ============================================================
   * «1. Төслийн танилцуулга» — 2 талт realtime, ХАДГАЛАХ-аар л батлагдана.
   * ------------------------------------------------------------
   * Зүүн талын форм (IntroBlockEditor) ба баруун талын хуудас
   * (ProjectIntroPage дотор EditableText) ХОЁУЛАА ганц локал төлөв
   * `introOverride`-ыг засварлана — тиймээс аль нэгэнд бичихэд нөгөө нь
   * тэр даруй шинэчлэгдэнэ (realtime).
   *
   * ⚠ ЗОРИУДААР AUTOSAVE / DEBOUNCE ХИЙХГҮЙ.  Бичиж байх үед сервер
   * рүү ямар ч хүсэлт явахгүй; зөвхөн «Хадгалах» товч л блокийн
   * контентыг PATCH-аар бичнэ.  Хэрэглэгчийн шаардлага яг ийм:
   * «save дарахгүй бол хадгалагдахгүй, гэхдээ тэр үед шинэчлэлт бүхэн
   * realtime харагдана».  Debounce-той хувилбар байсныг УСТГАВ — дахин бүү нэм.
   * ============================================================ */
  const introBlock = useMemo(
    () => blocks.find((b) => b.type === 'project-intro') ?? null,
    [blocks],
  );
  const [introOverride, setIntroOverride] = useState<IntroOverride>({});
  /** Хадгалагдаагүй танилцуулгын өөрчлөлт байгаа эсэх.  Товчны идэвх,
   *  «● Хадгалаагүй өөрчлөлт» тэмдэглэгээ, `beforeunload` анхааруулга
   *  гурвуулаа үүнээс уншина. */
  const [introDirty, setIntroDirty] = useState(false);

  /* Блок ирэхэд (эсвэл кэш invalidate болоход) локал төлөвийг seed хийнэ.
   * `introDirty` үед seed ХИЙХГҮЙ: бусад блокийн `handlePatchBlock` бүр
   * `refresh()` дуудаж кэшийг шинэчлэдэг тул энэ хамгаалалтгүй бол бичиж
   * байх үед хуучин контент буцаж ирээд бичсэнийг арчина (тайлангийн
   * талбаруудын seed effect-тэй яг ижил хэв маяг). */
  useEffect(() => {
    if (introDirty) return;
    const b = blocks.find((x) => x.type === 'project-intro');
    setIntroOverride(b ? ((b.content as BlockContentMap['project-intro']).override ?? {}) : {});
  }, [blocks, introDirty]);

  /* ⚠️ ТЭМДЭГТ ДҮРЭМ (`IntroBlockEditor`-ийн «Паспортоос дахин татах»
   * товч ҮҮН ДЭЭР тулгуурладаг):
   *   түлхүүр БАЙХГҮЙ  = паспортыг дага (авто)
   *   `''`             = хэрэглэгч ЗОРИУД цэвэрлэсэн
   * Тиймээс «дахин татах» нь ЗААВАЛ түлхүүрийг устгах ёстой. */
  const applyIntroPatch = useCallback((patch: Partial<IntroOverride>) => {
    setIntroOverride((prev) => {
      // `undefined` утга = «энэ талбарыг АВТО болго» → түлхүүрийг УСТГАНА.
      // Зүгээр `{...prev, ...patch}` хийвэл түлхүүр `undefined` утгатай
      // үлдэнэ; `resolveIntroModel` түүнийг зөв уншина ч `JSON.stringify` хаядаг
      // тул сервер рүү явахдаа «авто руу буц» гэсэн санаа алга болж,
      // хуучин хадгалагдсан утга буцаж амилна.
      const next: IntroOverride = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete (next as Record<string, unknown>)[k];
        else (next as Record<string, unknown>)[k] = v;
      }
      return next;
    });
    setIntroDirty(true);
    setDirty(true);
  }, []);

  /* ============================================================
   * Засварлагдах СТАТИК текст (`lib/reportText.tsx` — `T` компонент).
   * ------------------------------------------------------------
   * Хэрэглэгчийн 3-р гомдол: «I can't change the default text of the
   * table» — хүснэгтийн толгой, шошго зэрэг эх кодын литералуудыг
   * хуудсан дээрээс шууд засварлах боломж.  Утга нь БЛОКИЙН
   * `content_json.textOverrides`-д амьдардаг тул DB migration
   * ШААРДЛАГАГҮЙ (backend `content`-ыг opaque дамжуулна).
   *
   * ⚠ Танилцуулгын override-той ЯГ ижил хэв маяг: autosave БАЙХГҮЙ,
   * зөвхөн «Хадгалах» товч л сервер рүү бичнэ.
   * ============================================================ */
  const rawBlocks = reportQuery.data?.blocks;
  const [textOverrides, setTextOverrides] = useState<Record<number, Record<string, string>>>({});
  const [textDirty, setTextDirty] = useState(false);

  /* Seed — ⚠️ ТҮҮХИЙ контентоос.  `coerceBlock`/`parseBlockContent` нь
   * мэдэгдэхгүй талбарыг хаядаг тул `blocks`-оос уншвал шошгууд
   * чимээгүй алга болно.  `textDirty` үед seed хийхгүй (introDirty-тэй
   * ижил шалтгаан: бусад блокийн PATCH бүр `refresh()` дуудна). */
  useEffect(() => {
    if (textDirty) return;
    const seed: Record<number, Record<string, string>> = {};
    for (const b of rawBlocks ?? []) {
      const raw = (b.content as { textOverrides?: unknown } | null)?.textOverrides;
      if (!raw || typeof raw !== 'object') continue;
      const one: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string') one[k] = v;
      }
      if (Object.keys(one).length) seed[b.id] = one;
    }
    // Ижил бол хуучин лавлагааг үлдээнэ — эс бөгөөс refetch бүрд шинэ
    // объект үүсч, preview-гийн memo-нууд дэмий нурна.
    setTextOverrides((prev) => (sameTextMap(prev, seed) ? prev : seed));
  }, [rawBlocks, textDirty]);

  const applyTextChange = useCallback((blockId: number, key: string, value: string) => {
    setTextOverrides((prev) => {
      const cur = prev[blockId];
      if (cur && cur[key] === value) return prev;
      return { ...prev, [blockId]: { ...(cur ?? {}), [key]: value } };
    });
    setTextDirty(true);
    setDirty(true);
  }, []);

  /** Түлхүүрийг БҮРМӨСӨН УСТГАНА — «авто утга руу буцах» цорын ганц зам.
   *
   *  ⚠️ Яагаад хоосон мөр бичих нь ХАНГАЛТГҮЙ вэ: энэ баримтын
   *  семантикт `undefined` = «авто», `''` = «хэрэглэгч ЗОРИУД арилгасан»
   *  (`lib/reportText.tsx`-ийн `t()`-г үз).  `applyTextChange` нь хэзээ ч
   *  устгадаггүй тул талбарыг цэвэрлэхэд `''` үлдэж, авто нөхөлт
   *  ДАХИЖ ХЭЗЭЭ Ч ажиллахгүй болдог.  Түүнийг буцаахын тулд түлхүүр нь
   *  бүрмөсөн алга болох ёстой. */
  const clearTextOverride = useCallback((blockId: number, key: string) => {
    setTextOverrides((prev) => {
      const cur = prev[blockId];
      if (!cur || !(key in cur)) return prev;
      const next = { ...cur };
      delete next[key];
      return { ...prev, [blockId]: next };
    });
    setTextDirty(true);
    setDirty(true);
  }, []);

  /* БАРИМТЫН түвшний статик текстийн блок — нэгтгэсэн график ба
   * Баталгаажуулалт хуудас нь өөрийн блокгүй тул шошгоо танилцуулгын
   * блокийн нэрийн зайд хадгална.
   *
   * ⚠️ Энэ дүрэм `PerformanceReportPreview.tsx` / `PerformanceReportPrintPage.tsx`
   * дахьтай ЯГ ИЖИЛ байх ЁСТОЙ — зөрвөл редактор нэг блокт бичээд
   * preview/хэвлэл нөгөөгөөс уншиж, бичсэн зүйл огт гарахгүй. */
  const docTextBlockId = useMemo(() => {
    const intro = blocks.find((b) => b.type === 'project-intro');
    return intro?.id ?? blocks[0]?.id ?? 0;
  }, [blocks]);

  /** «Боловсруулсан ажилтан» — Баталгаажуулалт хуудасны зүүн баганын
   *  «Төлөөлөгчийн нэр, албан тушаал» талбартай НЭГ утга (нэг түлхүүр,
   *  нэг хадгалалтын зам) тул хоёр тал автоматаар синк болно. */
  const signoffExecRep = textOverrides[docTextBlockId]?.[SIGNOFF_EXEC_REP_KEY] ?? '';
  /** Талбарыг ХООСОН орхивол хэрэглэгдэх нэр — тайланг ҮҮСГЭСЭН хүн.
   *  Placeholder-ээр л харуулна: input-ыг «утга байгаа» болгож дүр
   *  эсгэвэл арилгах гэж оролдоход буцаад гарч ирж, хэрэглэгч эвдэрсэн
   *  гэж бодно.  Бодит нөхөлт нь `resolveSignerName`-д (нэг эх сурвалж). */
  const signoffExecRepAuto = useMemo(
    () => resolveSignerName(undefined, usersQuery.data?.users ?? [], report?.created_by_id),
    [usersQuery.data, report?.created_by_id],
  );
  /** Түлхүүр нь ОГТ байхгүй («авто») юу, эсвэл хадгалагдсан утгатай юу.
   *  ⚠️ `signoffExecRep` нь хоёр төлөвт хоёуланд нь '' болдог тул түүгээр
   *  ялгаж БОЛОХГҮЙ — эс бөгөөс UI нь «хоосон орхивол авто» гэж худал
   *  амлаад, бодит байдалд авто нөхөлт унтарсан хэвээр үлдэнэ. */
  const signoffExecRepIsSet =
    textOverrides[docTextBlockId]?.[SIGNOFF_EXEC_REP_KEY] !== undefined;
  /** «Зориуд хоосон» — авто нөхөлт унтарсан, тайлан нэргүй, ГАРЫН ҮСЭГГҮЙ
   *  хэвлэгдэнэ.  Хэрэглэгчид ЭНЭ төлөвийг тодорхой харуулах ёстой. */
  const signoffExecRepCleared = signoffExecRepIsSet && signoffExecRep.trim() === '';

  /* «Тайлангийн талбарууд» ↔ хуудас 2 талт синк (4-р гомдол).
   * Хуудсан дээр бичихэд зүүн талын input мөн адил шинэчлэгдэнэ —
   * учир нь хоёулаа ЭНЭ локал төлөвөөс уншина. */
  const applyReportPatch = useCallback((patch: ReportFieldPatch) => {
    if (patch.period_start !== undefined) setPeriodStart(patch.period_start);
    if (patch.period_end !== undefined) setPeriodEnd(patch.period_end);
    if (patch.summary_text !== undefined) setSummaryText(patch.summary_text ?? '');
    if (patch.notes !== undefined) setNotes(patch.notes ?? '');
    if (patch.status_meetings !== undefined) setMeetings(patch.status_meetings);
    if (patch.workforce !== undefined) setWorkforce(patch.workforce);
    setDirty(true);
  }, []);

  /* Багуудын бодит жагсаалтыг НЭГ удаа тооцоолно — блокийн баг сонгох
   * дропдаун, авто танилцуулга ба preview гурвуулаа үүнийг хуваалцана.
   * Ноогдол (draft) тайлангийн `team_progress` хоосон тул төслийн
   * шатлалаас амьд тоо гаргана. */
  const effectiveTeams = useMemo<TeamSnapshotItem[]>(() => {
    if (!report) return [];
    return projectData ? deriveEffectiveTeams(report, projectData) : report.team_progress;
  }, [report, projectData]);

  /** Танилцуулгын авто загвар (паспорт + төсөл + баг + бичиг баримт).
   *  `meetings` нь локал төлөв тул уулзалтын хуваарь засмагц хуудсанд
   *  шууд тусна. */
  const introAuto = useMemo(() => {
    if (!projectData || !report) return null;
    return buildIntroAuto({
      project: projectData,
      passport: passportData ?? emptyPassport(projectId),
      documents: documentsQuery.data?.documents ?? [],
      teams: teamsQuery.data?.teams ?? [],
      users: usersQuery.data?.users ?? [],
      effectiveTeams,
      statusMeetings: meetings,
    });
  }, [
    projectData,
    passportData,
    projectId,
    report,
    meetings,
    effectiveTeams,
    documentsQuery.data,
    teamsQuery.data,
    usersQuery.data,
  ]);

  const introModel = useMemo(
    () => (introAuto ? resolveIntroModel(introOverride, introAuto) : null),
    [introAuto, introOverride],
  );

  /* Хадгалаагүй өөрчлөлттэй байхад таб хаах / сэргээхээс сэргийлнэ.
   * Autosave байхгүй тул энэ хамгаалалт ЗААВАЛ: товч дараагүй
   * гарвал бичсэн бүхэн алга болно. */
  useEffect(() => {
    if (readOnly || (!dirty && !introDirty && !textDirty)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Хөтчүүд өөрийн бичвэрийг харуулдаг болсон ч утга оноох нь шаардлагатай.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [readOnly, dirty, introDirty, textDirty]);

  // Blend the persisted report row with the local editor state so the
  // preview pane shows typing in real time. The report-level fields
  // (period, summary, meetings, workforce) ride straight onto the
  // preview without a server round-trip.
  //
  // ⚠ `useMemo` ЗААВАЛ: memo-гүй бол render бүрд ШИНЭ объект үүсэж preview
  // бүхэлдээ дахин render болно — A4Paginator тэгээд бүх хуудсыг дэмий
  // дахин хэмжиж, хуудсан дээр бичиж байгаа курсор унана.
  //
  // ⚠ Энэ мемо доошоо буюу мултарах `return`-үүдийн ДООР БАЙЖ БОЛОХГҮЙ
  // (нөхцөлт hook болно), тиймээс `report` байхгүй тохиолдлыг дотроо
  // `null`-ээр шийдэж, мултарах шалгалтад нь оруулсан.
  const livePreviewReport = useMemo<PerformanceReport | null>(() => {
    if (!report) return null;
    return {
      ...report,
      period_start: periodStart,
      period_end: periodEnd,
      summary_text: summaryText.trim() ? summaryText : null,
      notes: notes.trim() ? notes : null,
      status_meetings: meetings,
      workforce,
      team_progress: effectiveTeams,
    };
  }, [report, periodStart, periodEnd, summaryText, notes, meetings, workforce, effectiveTeams]);

  const saveReport = async () => {
    if (!report) return;
    setSaving(true);
    try {
      const body: PerformanceReportDraftInput = {
        period_start: periodStart,
        period_end: periodEnd,
        status_meetings: meetings,
        summary_text: summaryText.trim() ? summaryText : null,
        notes: notes.trim() ? notes : null,
        workforce,
        client_summary_md: clientSummary.trim() ? clientSummary : null,
        risks: risks.filter((r) => r.risk.trim() || r.owner.trim() || r.mitigation.trim()),
        next_plan: nextPlan.map((s) => s.trim()).filter((s) => s.length > 0),
      };
      await apiFetch(`/projects/${projectId}/performance-reports/${reportIdNum}`, {
        method: 'PUT',
        data: body,
      });
      // «1. Төслийн танилцуулга»-ын override нь тайлангийн мөрт биш, БЛОКИЙН
      // контентод амьдардаг тул тусдаа PATCH.  Зөвхөн өөрчлөгдсөн үед л
      // илгээнэ — эс тэгвэл зүгээр «Хадгалах» дарах бүрд блокийн
      // `updated_at` шалтгаангүй хөдөлнө.
      //
      // ⚠️ `content` нь БҮТНЭЭР солигддог тул ТҮҮХИЙ контентыг заавал
      // хамт илгээнэ — эс бөгөөс танилцуулгын `override` эсвэл
      // `textOverrides` нөгөөгөө арчина.  Танилцуулгын блокийн хувьд
      // override + textOverrides хоёрыг НЭГ PATCH-аар (2 удаа PATCH
      // хийвэл эхнийх нь дарагдана).
      const rawById = new Map((rawBlocks ?? []).map((b) => [b.id, b]));
      for (const b of blocks) {
        const isIntro = b.type === 'project-intro';
        const rawContent = (rawById.get(b.id)?.content ?? {}) as Record<string, unknown>;
        const nextText = textOverrides[b.id] ?? {};
        const textChanged =
          JSON.stringify(nextText) !== JSON.stringify(rawContent.textOverrides ?? {});
        const introChanged = isIntro && introDirty;
        if (!textChanged && !introChanged) continue;
        const content: Record<string, unknown> = { ...rawContent, textOverrides: nextText };
        if (isIntro) content.override = introOverride;
        await apiFetch(
          `/projects/${projectId}/performance-reports/${reportIdNum}/blocks/${b.id}`,
          { method: 'PATCH', data: { content } },
        );
      }
      toast.success(t('common.saved'));
      // Амжилттай үед л dirty цэвэрлэнэ.  Алдаа гарвал catch руу орох тул
      // төлөв dirty хэвээр үлдэж, бичсэн зүйл алдагдахгүй.
      //
      // ⚠ Дараалал чухал: ЭХЛЭЭД кэшийг шинэчилж дуусгана, ДАРАА нь dirty-г
      // тайлна.  Эсрэгээр хийвэл дээрх seed effect-үүд (`[blocks, introDirty]`
      // ба `[report, dirty]`) хараахан invalidate болоогүй ХУУЧИН өгөгдлөөс
      // тэр даруй буцааж seed хийж, сая хадгалсан агуулга агшин зуур хуучин
      // болж анивчина.
      await refresh();
      setIntroDirty(false);
      setTextDirty(false);
      setDirty(false);
    } catch (e) {
      toast.error(t('common.saveFailed'), e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleIssue = async () => {
    if (!report) return;
    if (!(await confirmDialog({ description: t('performanceReportEditorPage.issueConfirm', { no: report.report_no }) }))) return;
    setIssuing(true);
    try {
      await apiFetch(`/projects/${projectId}/performance-reports/${reportIdNum}/issue`, {
        method: 'POST',
        data: {},
      });
      toast.success(t('performanceReportEditorPage.issued'));
      await refresh();
    } catch (e) {
      toast.error(t('performanceReportEditorPage.issueFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setIssuing(false);
    }
  };

  const handleReorder = async (block_ids: number[]) => {
    // Optimistic update of the cached order so the drag feels instant;
    // the response from the server replaces it shortly after.
    queryClient.setQueryData(queryKey, (prev: ReportPlusBlocks | undefined) => {
      if (!prev) return prev;
      const byId = new Map(prev.blocks.map((b) => [b.id, b]));
      const reordered = block_ids
        .map((id, i) => {
          const b = byId.get(id);
          return b ? { ...b, position: (i + 1) * 10 } : null;
        })
        .filter((b): b is ReportBlockRaw => b !== null);
      return { ...prev, blocks: reordered };
    });
    try {
      await apiFetch(`/projects/${projectId}/performance-reports/${reportIdNum}/blocks/reorder`, {
        method: 'PUT',
        data: { block_ids },
      });
      await refresh();
    } catch (e) {
      toast.error(t('performanceReportEditorPage.reorderFailed'), e instanceof Error ? e.message : t('common.error'));
      await refresh();
    }
  };

  const handlePatchBlock = async (
    blockId: number,
    patch: { content?: unknown; hidden?: boolean },
  ) => {
    try {
      /* ⚠️ ӨГӨГДӨЛ АЛДАГДАХААС ХАМГААЛАХ.  Зүүн талын блокийн форм
       * (`BlockEditors.tsx`) `onChange`-даа контентоо БҮТНЭЭР сольж
       * илгээдэг (жишээ нь `onChange({ team_code })`,
       * `onChange({ style: 'page-break' })`).  Сервер `content`-ыг
       * бүтнээр дарж бичдэг тул тэр PATCH нь хуудсан дээр засварласан
       * СТАТИК ШОШГУУДЫГ (`textOverrides`) чимээгүй арчина — багийн
       * кодыг солиход тэр блокийн бүх шошго алга болно.
       *
       * Иймд ХАДГАЛАГДСАН (raw) `textOverrides`-ыг форм өөрөө өгөөгүй
       * үед үргэлж буцааж наана.  Хадгалаагүй локал засварыг ЭНД
       * НЭМЭХГҮЙ — тэр нь зөвхөн «Хадгалах» товчоор л сервер рүү явна
       * (autosave үүсгэхгүй; `textDirty` нь seed-ийг хааж байгаа тул
       * дараагийн `refresh()` тэднийг устгахгүй). */
      let data = patch;
      if (patch.content && typeof patch.content === 'object') {
        const next = patch.content as Record<string, unknown>;
        if (next.textOverrides === undefined) {
          const rawContent = ((rawBlocks ?? []).find((b) => b.id === blockId)?.content ??
            {}) as Record<string, unknown>;
          const keep = rawContent.textOverrides;
          if (keep && typeof keep === 'object' && Object.keys(keep).length > 0) {
            data = { ...patch, content: { ...next, textOverrides: keep } };
          }
        }
      }
      await apiFetch(
        `/projects/${projectId}/performance-reports/${reportIdNum}/blocks/${blockId}`,
        { method: 'PATCH', data },
      );
      await refresh();
    } catch (e) {
      toast.error(t('common.saveFailed'), e instanceof Error ? e.message : t('common.error'));
    }
  };

  const handleDeleteBlock = async (blockId: number) => {
    try {
      await apiFetch(
        `/projects/${projectId}/performance-reports/${reportIdNum}/blocks/${blockId}`,
        { method: 'DELETE' },
      );
      await refresh();
    } catch (e) {
      toast.error(t('common.deleteFailed'), e instanceof Error ? e.message : t('common.error'));
    }
  };

  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const handleDownloadPdf = async () => {
    if (downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      await downloadPdf(
        `/projects/${projectId}/performance-reports/${reportIdNum}/pdf`,
        `GT_${String(report?.report_no ?? reportIdNum).padStart(2, '0')}.pdf`,
      );
    } catch (e) {
      toast.error(t('performanceReportEditorPage.pdfFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleOpenPrint = () => {
    window.open(
      `/reports/project/${projectId}/performance-report/${reportIdNum}/print`,
      '_blank',
      'noopener',
    );
  };

  // Preview the client-facing design report (works on drafts too): fetch the
  // authed HTML and open it via a blob URL in a new tab (Paged.js paginates).
  const [openingClientWeb, setOpeningClientWeb] = useState(false);
  const handleOpenClientWeb = async () => {
    if (openingClientWeb) return;
    setOpeningClientWeb(true);
    try {
      const blob = await apiFetchBlob(
        `/projects/${projectId}/performance-reports/${reportIdNum}/client-html`,
      );
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(t('performanceReportsPage.clientReportFailed'), e instanceof Error ? e.message : t('common.error'));
    } finally {
      setOpeningClientWeb(false);
    }
  };

  if (reportQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">{t('common.loading')}</span>
      </div>
    );
  }
  if (reportQuery.error || !report || !livePreviewReport) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-sm text-destructive">
        {reportQuery.error?.message ?? t('performanceReportEditorPage.notFound')}
        <div className="mt-3">
          <Button
            variant="outline"
            onClick={() => navigate(`/app/projects/${projectId}/performance-reports`)}
          >
            {t('performanceReportEditorPage.backToList')}
          </Button>
        </div>
      </div>
    );
  }

  const projectName = projectQuery.data?.project.name ?? t('performanceReportEditorPage.projectFallback');
  const workforceTotal = workforce.reduce((s, w) => s + (Number(w.count) || 0), 0);


  return (
    <div className="min-h-screen bg-muted/30 p-4 sm:p-6 space-y-4">
      <DesktopOnlyNotice feature={t('performanceReportEditorPage.editorTitle')} />
      <div className="flex items-center gap-2 flex-wrap">
        <Link
          to={`/app/projects/${projectId}/performance-reports`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          {projectName}
        </Link>
        <span className="text-muted-foreground">·</span>
        <span className="text-sm font-medium">№{String(report.report_no).padStart(2, '0')}</span>
        {isIssued ? (
          <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-[11px]">
            <CheckCircle2 className="w-3 h-3" /> {t('performanceReportEditorPage.statusIssued')} · {report.issued_at?.slice(0, 10)}
          </span>
        ) : (
          <span className="text-amber-600 dark:text-amber-400 text-[11px]">{t('performanceReportEditorPage.statusDraft')}</span>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleOpenPrint}>
            <ExternalLink className="w-4 h-4 mr-1.5" /> {t('common.view')}
          </Button>
          <Button size="sm" onClick={handleDownloadPdf} disabled={downloadingPdf}>
            {downloadingPdf ? (
              <>
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> {t('performanceReportEditorPage.preparing')}
              </>
            ) : (
              <>
                <Download className="w-4 h-4 mr-1.5" /> {t('performanceReportEditorPage.downloadPdf')}
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={handleOpenClientWeb} disabled={openingClientWeb}>
            {openingClientWeb ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4 mr-1.5" />
            )}
            {t('performanceReportsPage.clientReportWeb')}
          </Button>
          <StirlingPdfActions
            projectId={Number(projectId)}
            reportId={reportIdNum}
            reportNo={report.report_no}
          />
          {!readOnly && (
            <>
              {/* Хадгалаагүй өөрчлөлтийн тэмдэглэгээ — autosave байхгүй тул
                  хэрэглэгч товч дарах шаардлагатайг ил харуулна.
                  Шошго нь StickySaveBar-ын нийтлэг түлхүүрийг дахин ашиглана
                  (mn = «хадгалаагүй өөрчлөлт», en = «unsaved changes» —
                  хоёуланд нь байгаа тул i18n drift үүсэхгүй). */}
              {(dirty || introDirty || textDirty) && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                  <span aria-hidden="true">●</span> {t('stickySaveBar.unsavedChanges')}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={saveReport}
                disabled={saving || (!dirty && !introDirty && !textDirty)}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1.5" />
                )}
                {t('common.save')}
              </Button>
              <Button size="sm" onClick={handleIssue} disabled={issuing}>
                {issuing ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-1.5" />
                )}
                {t('performanceReportEditorPage.issue')}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card>
            <CardContent className="py-4 space-y-4">
              {/* «Боловсруулсан ажилтан» — Баталгаажуулалт хуудасны гарын
                  үсэг/тамгыг АСААДАГ талбар.  Түлхүүр нь тэр хуудасны
                  «Төлөөлөгчийн нэр, албан тушаал»-тай нэг тул хоёр тал
                  автоматаар синк болно.  Хадгалалт нь бусад статик
                  шошготой ижил — зөвхөн «Хадгалах» товч бичнэ.
                  Шошго нь ЗОРИУДААР монгол литерал: i18n файлууд (mn/en)
                  энэ даалгаврын хамрах хүрээнд БАЙХГҮЙ. */}
              <div>
                <Label htmlFor="signoff-exec-rep">Боловсруулсан ажилтан</Label>
                <Input
                  id="signoff-exec-rep"
                  value={signoffExecRep}
                  /* ⚠️ Авто нэрийг placeholder болгож ЗӨВХӨН түлхүүр
                     тохируулаагүй үед харуулна.  «Зориуд хоосон» төлөвт
                     тэр нэр гарвал хэвлэгдэх зүйлийг ХУДЛАА зурна. */
                  placeholder={
                    !signoffExecRepIsSet && signoffExecRepAuto
                      ? signoffExecRepAuto
                      : 'Нэр, албан тушаал'
                  }
                  disabled={readOnly || !docTextBlockId}
                  onChange={(e) => applyTextChange(docTextBlockId, SIGNOFF_EXEC_REP_KEY, e.target.value)}
                />
                {signoffExecRepCleared ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-500 mt-1">
                    Энэ талбарыг ЗОРИУД хоосон болгосон байна — тайлан нэргүй, гарын үсэггүй
                    хэвлэгдэнэ.{' '}
                    {signoffExecRepAuto && !readOnly && (
                      <button
                        type="button"
                        className="underline underline-offset-2 hover:no-underline"
                        onClick={() => clearTextOverride(docTextBlockId, SIGNOFF_EXEC_REP_KEY)}
                      >
                        «{signoffExecRepAuto}» руу буцаах
                      </button>
                    )}
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {!signoffExecRepIsSet && signoffExecRepAuto
                      ? `Хоосон орхивол «${signoffExecRepAuto}» гэж бичигдэнэ. Нэр таарсан хүний гарын үсэг Баталгаажуулалт хуудсанд автоматаар гарна.`
                      : 'Нэрийг бичихэд тухайн хүний гарын үсэг Баталгаажуулалт хуудсанд автоматаар гарна.'}
                  </p>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">
                  Байгууллагын тамга нь хүнээс хамаарахгүй — Тохиргоо → Лого хэсгээс нэг удаа
                  тохируулна.
                </p>
              </div>

              <div>
                <h2 className="text-sm font-semibold mb-2">{t('performanceReportEditorPage.reportFields')}</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="ps">{t('performanceReportEditorPage.periodStart')}</Label>
                    <Input
                      id="ps"
                      type="date"
                      value={periodStart}
                      disabled={readOnly}
                      onChange={(e) => {
                        setPeriodStart(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </div>
                  <div>
                    <Label htmlFor="pe">{t('performanceReportEditorPage.periodEnd')}</Label>
                    <Input
                      id="pe"
                      type="date"
                      value={periodEnd}
                      disabled={readOnly}
                      onChange={(e) => {
                        setPeriodEnd(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </div>
                </div>
              </div>

              <div>
                <Label htmlFor="summary">{t('performanceReportEditorPage.summaryLabel')}</Label>
                <Textarea
                  id="summary"
                  rows={5}
                  value={summaryText}
                  disabled={readOnly}
                  onChange={(e) => {
                    setSummaryText(e.target.value);
                    setDirty(true);
                  }}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>{t('performanceReportEditorPage.meetingsLabel')}</Label>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setMeetings((prev) => [
                          ...prev,
                          { label: '', percent: 0, scheduled_at: '' },
                        ]);
                        setDirty(true);
                      }}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> {t('common.add')}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {meetings.map((m, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder={t('common.description')}
                        value={m.label}
                        disabled={readOnly}
                        onChange={(e) => {
                          setMeetings((p) =>
                            p.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)),
                          );
                          setDirty(true);
                        }}
                        className="flex-1"
                      />
                      <div className="relative w-24">
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={m.percent}
                          disabled={readOnly}
                          onChange={(e) => {
                            setMeetings((p) =>
                              p.map((x, idx) =>
                                idx === i ? { ...x, percent: Number(e.target.value) } : x,
                              ),
                            );
                            setDirty(true);
                          }}
                          className="pr-7"
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                          %
                        </span>
                      </div>
                      <Input
                        type="date"
                        value={m.scheduled_at}
                        disabled={readOnly}
                        onChange={(e) => {
                          setMeetings((p) =>
                            p.map((x, idx) =>
                              idx === i ? { ...x, scheduled_at: e.target.value } : x,
                            ),
                          );
                          setDirty(true);
                        }}
                        className="w-40"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            setMeetings((p) => p.filter((_, idx) => idx !== i));
                            setDirty(true);
                          }}
                          className="text-muted-foreground hover:text-destructive p-1"
                          title={t('performanceReportEditorPage.remove')}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {meetings.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      {t('performanceReportEditorPage.noMeetings')}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>{t('performanceReportEditorPage.workforceLabel')}</Label>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setWorkforce((p) => [...p, { category: '', count: 0, description: '' }]);
                        setDirty(true);
                      }}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> {t('common.add')}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {workforce.map((w, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder={t('performanceReportEditorPage.category')}
                        value={w.category}
                        disabled={readOnly}
                        onChange={(e) => {
                          setWorkforce((p) =>
                            p.map((x, idx) => (idx === i ? { ...x, category: e.target.value } : x)),
                          );
                          setDirty(true);
                        }}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        min={0}
                        value={w.count}
                        disabled={readOnly}
                        onChange={(e) => {
                          setWorkforce((p) =>
                            p.map((x, idx) =>
                              idx === i ? { ...x, count: Number(e.target.value) } : x,
                            ),
                          );
                          setDirty(true);
                        }}
                        className="w-20"
                      />
                      <Input
                        placeholder={t('common.description')}
                        value={w.description ?? ''}
                        disabled={readOnly}
                        onChange={(e) => {
                          setWorkforce((p) =>
                            p.map((x, idx) =>
                              idx === i ? { ...x, description: e.target.value } : x,
                            ),
                          );
                          setDirty(true);
                        }}
                        className="flex-1"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            setWorkforce((p) => p.filter((_, idx) => idx !== i));
                            setDirty(true);
                          }}
                          className="text-muted-foreground hover:text-destructive p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {workforce.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      {t('performanceReportEditorPage.noWorkforce')}
                    </p>
                  ) : (
                    <div className="text-[11px] text-muted-foreground tabular-nums pl-1">
                      {t('performanceReportEditorPage.total')}:{' '}
                      <span className="font-semibold text-foreground">{workforceTotal}</span>{' '}
                      {t('common.person')}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4 space-y-4">
              <div>
                <h2 className="text-sm font-semibold">{t('performanceReportEditorPage.clientSectionTitle')}</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t('performanceReportEditorPage.clientSectionHint')}
                </p>
              </div>

              <div>
                <Label htmlFor="client-summary">{t('performanceReportEditorPage.clientSummaryLabel')}</Label>
                <Textarea
                  id="client-summary"
                  rows={4}
                  value={clientSummary}
                  disabled={readOnly}
                  placeholder={t('performanceReportEditorPage.clientSummaryPlaceholder')}
                  onChange={(e) => {
                    setClientSummary(e.target.value);
                    setDirty(true);
                  }}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>{t('performanceReportEditorPage.risksLabel')}</Label>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRisks((p) => [...p, { risk: '', impact: 'amber', owner: '', mitigation: '' }]);
                        setDirty(true);
                      }}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> {t('common.add')}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {risks.map((r, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          placeholder={t('performanceReportEditorPage.riskPlaceholder')}
                          value={r.risk}
                          disabled={readOnly}
                          onChange={(e) => {
                            setRisks((p) => p.map((x, idx) => (idx === i ? { ...x, risk: e.target.value } : x)));
                            setDirty(true);
                          }}
                        />
                        <div className="flex gap-2">
                          <select
                            value={r.impact}
                            disabled={readOnly}
                            onChange={(e) => {
                              setRisks((p) =>
                                p.map((x, idx) => (idx === i ? { ...x, impact: e.target.value as ReportRag } : x)),
                              );
                              setDirty(true);
                            }}
                            className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
                          >
                            <option value="green">{t('performanceReportEditorPage.impactGreen')}</option>
                            <option value="amber">{t('performanceReportEditorPage.impactAmber')}</option>
                            <option value="red">{t('performanceReportEditorPage.impactRed')}</option>
                          </select>
                          <Input
                            placeholder={t('performanceReportEditorPage.ownerPlaceholder')}
                            value={r.owner}
                            disabled={readOnly}
                            onChange={(e) => {
                              setRisks((p) => p.map((x, idx) => (idx === i ? { ...x, owner: e.target.value } : x)));
                              setDirty(true);
                            }}
                            className="flex-1"
                          />
                        </div>
                        <Input
                          placeholder={t('performanceReportEditorPage.mitigationPlaceholder')}
                          value={r.mitigation}
                          disabled={readOnly}
                          onChange={(e) => {
                            setRisks((p) => p.map((x, idx) => (idx === i ? { ...x, mitigation: e.target.value } : x)));
                            setDirty(true);
                          }}
                          className="sm:col-span-2"
                        />
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            setRisks((p) => p.filter((_, idx) => idx !== i));
                            setDirty(true);
                          }}
                          className="text-muted-foreground hover:text-destructive p-1 mt-1"
                          title={t('performanceReportEditorPage.remove')}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {risks.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      {t('performanceReportEditorPage.noRisks')}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>{t('performanceReportEditorPage.nextPlanLabel')}</Label>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNextPlan((p) => [...p, '']);
                        setDirty(true);
                      }}
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> {t('common.add')}
                    </Button>
                  )}
                </div>
                <div className="space-y-2">
                  {nextPlan.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        placeholder={t('performanceReportEditorPage.nextPlanPlaceholder')}
                        value={item}
                        disabled={readOnly}
                        onChange={(e) => {
                          setNextPlan((p) => p.map((x, idx) => (idx === i ? e.target.value : x)));
                          setDirty(true);
                        }}
                        className="flex-1"
                      />
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            setNextPlan((p) => p.filter((_, idx) => idx !== i));
                            setDirty(true);
                          }}
                          className="text-muted-foreground hover:text-destructive p-1"
                          title={t('performanceReportEditorPage.remove')}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                  {nextPlan.length === 0 && (
                    <p className="text-xs text-muted-foreground italic">
                      {t('performanceReportEditorPage.noNextPlan')}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* «1. Төслийн танилцуулга» — блок тайланд байгаа үед л харагдана.
              Энэ форм ба баруун талын хуудас нэг төлөвийг хуваалцдаг тул
              аль нэгэнд нь бичихэд нөгөө нь тэр даруй шинэчлэгдэнэ. */}
          {introBlock && introModel && (
            <Card>
              <CardContent className="py-4">
                <IntroBlockEditor
                  model={introModel}
                  override={introOverride}
                  onChange={applyIntroPatch}
                  disabled={readOnly}
                />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{t('performanceReportEditorPage.blockList')}</h2>
              </div>
              <BlockListEditor
                blocks={blocks}
                report={livePreviewReport}
                readOnly={readOnly}
                autoModelFor={autoModelFor}
                onReorder={handleReorder}
                onPatch={handlePatchBlock}
                onDelete={handleDeleteBlock}
              />
            </CardContent>
          </Card>
        </div>

        {/* Live preview pane — sticky so it stays in view as the left
          column scrolls. Updates immediately for period / summary /
          meetings / workforce edits (in-memory blend); block edits
          refresh after the PATCH round-trip via cache invalidation. */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card className="overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground flex items-center justify-between">
              <span>{t('performanceReportEditorPage.preview')}</span>
              <span className="text-muted-foreground/60 normal-case tracking-normal">
                {t('performanceReportEditorPage.blockCount', { count: blocks.length })}
              </span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 180px)' }}>
              <PerformanceReportPreview
                projectId={projectId}
                report={livePreviewReport}
                blocks={blocks}
                introOverride={introOverride}
                onIntroChange={readOnly ? undefined : applyIntroPatch}
                textOverrides={textOverrides}
                onTextChange={readOnly ? undefined : applyTextChange}
                onReportChange={readOnly ? undefined : applyReportPatch}
                editable={!readOnly}
              />
            </div>
          </Card>
        </div>
      </div>

    </div>
  );
}
