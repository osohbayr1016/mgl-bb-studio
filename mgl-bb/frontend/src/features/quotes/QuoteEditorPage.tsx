/**
 * Үнийн саналын ЗАСВАРЛАГЧ — `/app/quotes/:id`.
 *
 * Гурван давхрага:
 *   1. `useAutosave<QuoteSavePayload>` — ноорогийн ГАНЦ эх сурвалж (толгойн
 *      талбарууд + ажлын дэвтэр (`workbook`) хоёулаа нэг ачаалалд). 2.5 с
 *      debounce, blur/Ctrl+S дээр flush.
 *   2. `useQuoteWorkbook(workbook)` — олон хуудаст томьёоны хөдөлгүүр (хөндлөн
 *      лавлагаа `=ИГС!G17` ажиллана). Хуудас бүрийн нүдний УТГА `bySheet`-ээс
 *      гарч ИДЭВХТЭЙ хуудсынхыг `SheetGrid`/`SheetToolbar` руу дамжуулна.
 *   3. `SheetGrid` — Excel маягийн засварлагч (нэг хуудас). Focus/сонголтын
 *      төлөв нь grid дотор амьдардаг ба `onFocusChange`/`onSelectionChange`-ээр
 *      энд дээшилж, `SheetToolbar` руу буцаж очно (toolbar өөрөө төлөв
 *      барихгүй). `SheetTabs` нь доод табаар хуудсуудыг шилжүүлж/удирдана.
 *
 * ⚠️ `total_amount` нь workbook-ийн `total` anchor (хуудас + нүд) заасан
 * ТООЦООЛСОН утга. Хадгалах ачаалалд орох ёстой ч хөдөлгүүр рендэрийн ДАРАА
 * ажилладаг тул `setData` дотор шууд бичих боломжгүй (тэр агшинд `bySheet`
 * хуучин дэвтрийнх). Тиймээс хамгийн сүүлийн дүнг `totalRef`-д хадгалж, saver
 * түүнийг илгээх мөчид нь ачаалал руу тарина.
 *
 * ⚠️ `useAutosave`-ийн `initial` нь ЗӨВХӨН mount дээр уншигддаг тул
 * `<QuoteEditor key={quote.id}>` — өөр баримт руу шилжихэд бүрэн remount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FileDown,
  FileSpreadsheet,
  Languages,
  Loader2,
  Printer,
  Scissors,
  Table2,
} from 'lucide-react';

import { ApiError, downloadPdf } from '@/shared/api/client';
import { BrandLoader } from '@/shared/components/BrandLoader';
import { EmptyState } from '@/shared/components/EmptyState';
import { PageContainer } from '@/shared/components/PageContainer';
import { PageHeader } from '@/shared/components/PageHeader';
import { SaveBar } from '@/shared/components/SaveBar';
import { toast } from '@/shared/components/Toast';
import { useAutosave } from '@/shared/hooks/useAutosave';
import { useUndoRedo } from '@/shared/hooks/useUndoRedo';
import { useLanguage } from '@/shared/i18n';
import type { Coord, SheetSelection } from '@/shared/sheet/coords';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';

import {
  QUOTES_FUNNEL_KEY,
  QUOTES_LIST_KEY,
  getQuote,
  quoteKey,
  saveQuote,
  translateQuote,
} from './api/quotes';
import { ScopeQuoteDialog } from './components/ScopeQuoteDialog';
import { SheetGrid } from './components/SheetGrid';
import { SheetTabs } from './components/SheetTabs';
import { SheetToolbar } from './components/SheetToolbar';
import { useQuoteWorkbook } from './hooks/useQuoteWorkbook';
import { sectionCols } from './lib/addons';
import { hiddenGroupCols } from './lib/optionalCols';
import { captureContractEdit, syncNotes } from './lib/quoteNotes';
import { exportQuoteXlsx } from './lib/exportQuoteXlsx';
import { isFormulaError, refToCoord } from './lib/formula';
import type { CellValue, FormulaError } from './lib/formula';
import { resolveAnchor } from './lib/resolveTotal';
import { hasScope } from './lib/scopeQuote';
import { getCell, setCells } from './lib/sheetOps';
import { replaceSheet, setWorkbookAnchor } from './lib/workbook';
import type {
  CellRef,
  NamedSheet,
  Quote,
  QuoteSavePayload,
  SheetDoc,
  WorkbookDoc,
} from './types/quotes';

/** bySheet-д хуудас олдоогүй үеийн тогтвортой хоосон fallback (шинэ Map бүү үүсгэ). */
const EMPTY_VALUES = new Map<CellRef, CellValue | FormulaError>();

/** Татах файлын нэрэнд аюулгүй суурь. */
function fileBase(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'quote';
}

/* ------------------------------------------------------------------ */
/*  Маршрутын бүрхүүл — ачаалал / алдаа                                 */
/* ------------------------------------------------------------------ */

export default function QuoteEditorPage() {
  const { t } = useLanguage();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;

  const { data, isLoading, isError } = useQuery({
    queryKey: quoteKey(id),
    queryFn: () => getQuote(id),
    enabled: validId,
  });

  if (!validId || isError) {
    return (
      <PageContainer>
        <EmptyState icon={FileSpreadsheet} title={t('quotes.err.notFound')} />
      </PageContainer>
    );
  }
  if (isLoading || !data) return <BrandLoader />;

  return <QuoteEditor key={data.id} quote={data} />;
}

/* ------------------------------------------------------------------ */
/*  Засварлагч                                                          */
/* ------------------------------------------------------------------ */

function QuoteEditor({ quote }: { quote: Quote }) {
  const { t, lang } = useLanguage();
  const qc = useQueryClient();
  const navigate = useNavigate();

  /* --- Autosave (толгой + хуудас нэг ачаалалд) --- */

  // Хамгийн сүүлд тооцоологдсон НИЙТ ҮНЭ — saver илгээх мөчдөө эндээс уншина.
  const totalRef = useRef<number | null>(quote.total_amount);

  const persist = useCallback(
    async (payload: QuoteSavePayload) => {
      const res = await saveQuote(quote.id, { ...payload, total_amount: totalRef.current });
      // Жагсаалтын дүн/огноо + юүлүүрийн мөнгөн дүнг шинэчилнэ.
      // ⚠️ ЗӨВХӨН эдгээр хоёр prefix — `QUOTES_KEY`-г бүхэлд нь invalidate
      // хийвэл `quoteKey(id)` дэлгэрэнгүй ч цэвэрлэгдэж, энэ хуудас нээлттэй
      // байхад идэвхтэй query дахин татагдан бичиж буй дэвтрийг дарж бичнэ.
      qc.invalidateQueries({ queryKey: QUOTES_LIST_KEY });
      qc.invalidateQueries({ queryKey: QUOTES_FUNNEL_KEY });
      return res;
    },
    [quote.id, qc],
  );

  const { data, setData, status, dirty, lastSavedAt, commit, save, flush } =
    useAutosave<QuoteSavePayload>({
      initial: {
        title: quote.title,
        client_name: quote.client_name,
        doc_date: quote.doc_date,
        prepared_by: quote.prepared_by,
        project_id: quote.project_id,
        workbook: quote.workbook,
        total_amount: quote.total_amount,
      },
      save: persist,
      debounceMs: 2500,
      initialSavedAt: quote.updated_at,
    });

  /* --- Тооцоо --- */

  // Хэл нь хөдөлгүүрт нөлөөлнө: `USGEER()`-ийн хөрвүүлэгч ба `TEXT()`-ийн locale.
  const { bySheet, tariffsLoading } = useQuoteWorkbook(data.workbook, quote.lang);

  // Идэвхтэй хуудас (таб) — activeSheet индексийг мужид оруулж хамгаална.
  const sheets = data.workbook.sheets;
  const activeIdx = Math.min(Math.max(0, data.workbook.activeSheet ?? 0), sheets.length - 1);
  const activeSheet = sheets[activeIdx];
  const activeValues = bySheet.get(activeSheet.id)?.values ?? EMPTY_VALUES;

  /**
   * НИЙТ ҮНЭ — `anchors.total` БИШ, гурван шатлалт шийдэгчээр (`resolveTotal`).
   * Anchor нь мөр/багана шилжихэд дагадаггүй тул түүнд ГАНЦААР найдаж болохгүй:
   * production-ий #38 санал anchor нь хоосон `G16`-г заасаар байхад бодит дүн нь
   * `Z15`-д сууж, жагсаалтад «—» харагдсан.
   */
  const resolvedTotal = useMemo(
    () => resolveAnchor(data.workbook, 'total', bySheet),
    [data.workbook, bySheet],
  );
  const total = resolvedTotal.value;

  /**
   * ⚠️ Тариф ачаалагдаж дуустал кэшийг БҮҮ шинэчил. `useQuoteWorkbook` тэр
   * хооронд `NO_TARIFF` тарьдаг тул бүх `TARIF()` `#ТАРИФ!` болж дүнгийн гинж
   * нурдаг — тэр агшинд autosave буудвал ЗӨВ дүнг NULL-ээр дарж бичнэ.
   */
  useEffect(() => {
    if (!tariffsLoading) totalRef.current = total;
  }, [total, tariffsLoading]);

  /**
   * ӨӨРӨӨ ЗАСВАРЛАХ — баримтыг нээхэд нэг удаа.
   *
   *   • anchor эвдэрсэн (шийдэгч 2/3-р шатлалаас дүн олсон) бол `anchors`-ыг
   *     бодит нүд рүү нь буцааж бичнэ — ингэснээр дараагийн нээлтэд 1-р шатлал
   *     ажиллаж, хэвлэмэл/XLSX/MCP бүгд ижил нүднээс уншина;
   *   • дүн нь тооцоологдсон атлаа кэш нь хоосон (браузераар нээгээгүй санал)
   *     бол ганц удаа хадгална.
   *
   * `repaired` хамгаалалт нь давхар буудахаас сэргийлнэ; `setData` нь түүхийг
   * (undo) бохирдуулахгүйн тулд `applyWorkbook`-оор БИШ шууд явна — anchor
   * засвар бол хэрэглэгчийн хийсэн засвар биш.
   */
  const repaired = useRef(false);
  useEffect(() => {
    if (repaired.current || tariffsLoading) return;
    const healable = resolvedTotal.via === 'addons' || resolvedTotal.via === 'label';
    const needsSeed = quote.total_amount === null && total !== null;
    if (!healable && !needsSeed) return;

    repaired.current = true;
    totalRef.current = total;

    if (!healable) {
      void save(); // anchor эрүүл, зөвхөн кэш дутуу
      return;
    }
    setData((prev) => {
      let wb = prev.workbook;
      if (resolvedTotal.sheetId && resolvedTotal.ref) {
        wb = setWorkbookAnchor(wb, 'total', resolvedTotal.sheetId, resolvedTotal.ref);
      }
      // Дэд дүнг мөн адил — #38 дээр `total` ба `subtotal` хоёул үхсэн байсан.
      const sub = resolveAnchor(prev.workbook, 'subtotal', bySheet);
      if ((sub.via === 'addons' || sub.via === 'label') && sub.sheetId && sub.ref) {
        wb = setWorkbookAnchor(wb, 'subtotal', sub.sheetId, sub.ref);
      }
      return wb === prev.workbook ? prev : { ...prev, workbook: wb };
    });
  }, [resolvedTotal, total, tariffsLoading, quote.total_amount, bySheet, save, setData]);

  /**
   * БАРИМТЫН ДООД ТАЙЛБАРЫГ баримт нээхэд НЭГ УДАА хуудасны бодит агуулгад
   * тааруулна (`lib/quoteNotes.ts`).
   *
   * ⚠️ Яагаад засварлагч дээр хийх ёстой вэ: загвараас үүссэн ШИНЭ санал бүр
   * «…төсвийн 8% нэмж тооцов», «…80га талбайн ерөнхий төлөвлөгөө…», «…инженер
   * геологийн…» гэсэн ХАТУУ өгүүлбэрүүдийг агуулж төрдөг — тэдгээр нь тухайн
   * саналд огт хамааралгүй байж болно. Загварыг migration-аар засах нь энэ
   * асуудлыг ШИЙДЭХГҮЙ: загвар нь тоо хэмжээ бөглөгдөхөөс өмнө юу үнэд орохыг
   * мэдэх боломжгүй, мөн АЛЬ ХЭДИЙН үүссэн саналууд `sheet_json`-оо snapshot
   * авчихсан байдаг. Тиймээс нээх бүрд тааруулна.
   *
   * ⚠️ `applyWorkbook`-оор БИШ шууд `setData` — anchor засвартай ижил шалтгаан:
   * энэ бол хэрэглэгчийн хийсэн засвар биш тул undo түүхийг бохирдуулахгүй.
   * `syncNotes` идемпотент тул өөрчлөх зүйл байхгүй бол объект нь ижил хэвээр
   * буцаж, autosave огт хөдлөхгүй.
   */
  const notesSynced = useRef(false);
  useEffect(() => {
    if (notesSynced.current) return;
    notesSynced.current = true;
    setData((prev) => {
      const sheets = prev.workbook.sheets.map((sh) => {
        const next = syncNotes(sh, quote.lang);
        return next === sh ? sh : ({ ...next, id: sh.id, name: sh.name } as NamedSheet);
      });
      if (sheets.every((sh, i) => sh === prev.workbook.sheets[i])) return prev;
      return { ...prev, workbook: { ...prev.workbook, sheets } };
    });
  }, [setData, quote.lang]);

  /* --- Хуудасны focus/сонголт (SheetGrid дотроос дээшилнэ) --- */

  const [focused, setFocused] = useState<Coord | null>(null);
  const [selection, setSelection] = useState<SheetSelection | null>(null);

  /* --- Ажлын задаргаа (хэсгийн багана) — АНХДАГЧААР НУУГДСАН --- */

  /**
   * Хэсгийн 7 багана нь хүснэгтийг маш өргөн болгодог ба өдөр тутмын ажилд
   * хэрэггүй — нэг үнийн ЗАДАРГАА тул ДҮН-д нөлөөлөхгүй. Тиймээс анхдагчаар
   * нууж, «Хэсэг хэсгээс харах» дарсан үед л гаргана (хэрэглэгчийн шийдвэр
   * 2026-08-05).
   *
   * ⚠️ Энэ бол ЗӨВХӨН ХАРАГДАЦ. Багануудыг УСТГАХГҮЙ — тэдгээр нь ДҮН-г
   * жолооддог тул устгавал үнэ өөрчлөгдөнө. Баримтад ямар ч өөрчлөлт орохгүй
   * тул хадгалах/PDF-д нөлөөгүй.
   */
  const [showSections, setShowSections] = useState(false);
  /**
   * Засварлагчид нуугдах баганууд — ХОЁР эх сурвалжийн нэгдэл:
   *   1. «Хэсэг» товчны түр харагдац (`showSections`) — зөвхөн энэ сесст,
   *      баримтад хадгалагдахгүй,
   *   2. PM-ийн тухайн саналд УНТРААСАН сонгомол бүлгүүд («Өндөр» г.м.) —
   *      `sheet.hiddenGroups`-д хадгалагдаж, хэвлэх/PDF/Excel-д мөн үйлчилнэ
   *      (`lib/optionalCols.ts`).
   */
  const hiddenCols = useMemo(() => {
    const out = new Set<number>(hiddenGroupCols(activeSheet));
    if (!showSections) for (const c of sectionCols(activeSheet)) out.add(c);
    return out.size > 0 ? out : undefined;
  }, [showSections, activeSheet]);

  /* --- Undo / redo (Ctrl+Z · Ctrl+Y | Ctrl+Shift+Z) --- */

  const history = useUndoRedo<WorkbookDoc>();

  /**
   * Дэвтрийн БҮХ өөрчлөлт эндүүр өнгөрнө — иймд түүх нэг цэгээс бүртгэгдэнэ.
   * `record` нь ӨӨРЧЛӨХИЙН ӨМНӨХ дэвтрийг хадгална.
   */
  const applyWorkbook = useCallback(
    (mutate: (wb: WorkbookDoc) => WorkbookDoc) => {
      setData((prev) => {
        const next = mutate(prev.workbook);
        if (next === prev.workbook) return prev; // өөрчлөлтгүй — түүх бохирдуулахгүй
        history.record(prev.workbook);
        return { ...prev, workbook: next };
      });
    },
    [setData, history],
  );

  // Идэвхтэй хуудсыг засварлахад workbook доторх тухайн нэг хуудсыг л сольж бичнэ
  // (id/name-ийг хадгална — SheetGrid зөвхөн SheetDoc буцаадаг).
  //
  // ⚠️ `captureContractEdit` — хуудсан дээр ШУУД хийсэн засварыг тайлбарын
  // ТӨЛӨВ болгож барина. Гэрээний хамрах хүрээний өгүүлбэр нь ДҮРМЭЭР
  // гаргагддаг (`lib/signatureBlock.ts` хуудсыг уншдаггүй) тул үүнгүйгээр PM
  // нүдийг цэвэрлээд хадгалахад засварлагч дээр алга болсон атал ХЭВЛЭХ/PDF
  // дээр өгүүлбэр хэвээр гарсаар байв (хэрэглэгчийн илрүүлэлт 2026-08-25).
  // Энэ бол хуудасны БҮХ засвар өнгөрдөг ганц хоолой тул зангуу нь ЭНД.
  const handleSheetChange = useCallback(
    (next: SheetDoc) =>
      applyWorkbook((wb) => {
        const idx = Math.min(Math.max(0, wb.activeSheet ?? 0), wb.sheets.length - 1);
        const cur = wb.sheets[idx];
        const captured = captureContractEdit(cur, next, quote.lang);
        const named: NamedSheet = { ...captured, id: cur.id, name: cur.name };
        return replaceSheet(wb, idx, named);
      }),
    [applyWorkbook, quote.lang],
  );

  // Таб зурвасын үйлдлүүд (нэмэх/устгах/нэр солих/дараалал/идэвхжүүлэх). Хуудас
  // солиход өмнөх focus/сонголт шинэ хуудсанд «тарихгүйгээр» цэвэрлэнэ.
  const handleWorkbookChange = useCallback(
    (wb: WorkbookDoc) => {
      setFocused(null);
      setSelection(null);
      applyWorkbook(() => wb);
    },
    [applyWorkbook],
  );

  /**
   * Ctrl+Z / Ctrl+Y (эсвэл Ctrl+Shift+Z) — бүхэл ДЭВТРИЙГ нэг алхмаар буцаана.
   *
   * ⚠️ Нүд засаж байх үед эхлээд `blur` хийж тухайн бичилтийг БАТАЛГААЖУУЛНА
   * (Excel-ийн зан төлөв), эс бөгөөс input дотор хагас бичсэн текст үлдээд undo
   * өмнөх алхмыг буцааж, дараа нь blur болоход хуучирсан текст дахин бичигдэнэ.
   * `blur` нь commit-оо синхроноор дуудна; түүхийн бичилт ref дээр явдаг тул
   * дараагийн мөрөнд аль хэдийн бэлэн байна.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const isUndo = k === 'z' && !e.shiftKey;
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey);
      if (!isUndo && !isRedo) return;

      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.blur();

      e.preventDefault();
      setData((prev) => {
        const next = isUndo ? history.undo(prev.workbook) : history.redo(prev.workbook);
        return next ? { ...prev, workbook: next } : prev;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, setData]);

  const undoProps = useMemo(
    () => ({
      onUndo: () =>
        setData((prev) => {
          const next = history.undo(prev.workbook);
          return next ? { ...prev, workbook: next } : prev;
        }),
      onRedo: () =>
        setData((prev) => {
          const next = history.redo(prev.workbook);
          return next ? { ...prev, workbook: next } : prev;
        }),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    }),
    [history, setData],
  );

  /* --- Толгойн талбарууд --- */

  /**
   * Баримтын нэр — хуудасны ГАРЧГИЙН НҮДЭНД (`anchors.title`) мөн бичнэ.
   *
   * ⚠️ Өмнө нь гарчиг зөвхөн санал ҮҮСГЭХ үед нүдэнд бичигддэг байсан тул
   * нэрийг сольсны дараа PDF/хэвлэмэл дээр ХУУЧИН нэр үлддэг байв (хэрэглэгч
   * 2026-07-27-нд илрүүлсэн: талбар «ХОТХОН…» атлаа A1 нүд «qwe» хэвээр).
   * Anchor яг үүний тулд байдаг — нэр нэг эх сурвалжтай байх ёстой.
   *
   * Түүх (undo) бохирдуулахгүйн тулд `applyWorkbook` БИШ, шууд бичнэ:
   * гарчгийн талбар бол хуудасны засвар биш.
   */
  const setTitle = (v: string) =>
    setData((prev) => {
      const a = prev.workbook.anchors.title;
      if (!a) return { ...prev, title: v };
      const idx = prev.workbook.sheets.findIndex((s) => s.id === a.sheet);
      if (idx < 0) return { ...prev, title: v };
      const sheet = prev.workbook.sheets[idx];
      const co = refToCoord(a.ref);
      if (!co) return { ...prev, title: v };
      const cur = getCell(sheet, co.r, co.c);
      // Гарчгийн нүдэнд томьёо байвал хөндөхгүй — PM зориуд бичсэн байж болно.
      if (cur?.f) return { ...prev, title: v };
      const next = setCells(sheet, [{ r: co.r, c: co.c, cell: { ...cur, v } }]);
      return {
        ...prev,
        title: v,
        workbook: replaceSheet(prev.workbook, idx, { ...next, id: sheet.id, name: sheet.name }),
      };
    });
  const setClient = (v: string) =>
    setData((prev) => ({ ...prev, client_name: v.trim() === '' ? null : v }));
  const setDocDate = (v: string) => setData((prev) => ({ ...prev, doc_date: v }));
  const setPreparedBy = (v: string) =>
    setData((prev) => ({ ...prev, prepared_by: v.trim() === '' ? null : v }));

  /* --- Ctrl+S --- */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        commit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commit]);

  /* --- Англи хувилбар --- */

  /**
   * ⚠️ Компонент амьд эсэх. Орчуулга нь (a) ноорог хадгалагдахыг хүлээж, (b)
   * серверт AI ажиллах хүртэл 15-40 секунд явдаг. Хэрэглэгч энэ хооронд өөр
   * хуудас руу явбал mutation ҮРГЭЛЖИЛСЭЭР байдаг (TanStack Query нь unmount
   * дээр цуцалдаггүй, `useMutation`-ий onSuccess нь ажиглагчгүй ч ажиллана) —
   * тиймээс хүсэлтийг ЭХЛҮҮЛЭХГҮЙ, дууссан ч ХҮЧЭЭР ШИЛЖҮҮЛЭХГҮЙ.
   */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * «Англи хувилбар үүсгэх» — `POST /api/quotes/:id/translate` нь ШИНЭ,
   * холбоотой мөр (`lang='en'`, `source_quote_id`) үүсгэдэг тул амжилтын дараа
   * шууд тийш нь шилжинэ. Аль хэдийн англи хувилбартай бол сервер 409 EXISTS
   * буцаана — алдаа биш, байгаа хувилбар руу нь аваачна.
   *
   * Зөвхөн МОНГОЛ, апп-дотор үүссэн (`source==='app'`) саналд харагдана:
   * англи саналыг дахин орчуулахгүй, дэвтэргүй manual мөрд орчуулах юу ч алга.
   */
  const translateMutation = useMutation({
    mutationFn: () => translateQuote(quote.id),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: QUOTES_LIST_KEY });
      qc.invalidateQueries({ queryKey: QUOTES_FUNNEL_KEY });
      // Кэш шинэчлэлт нь хаанаас ч хамаагүй зөв; ШИЛЖИЛТ л энэ хуудсанд байх
      // үед утга учиртай (дээрх `aliveRef`-ийн тайлбарыг үз).
      if (aliveRef.current) navigate(`/app/quotes/${created.id}`);
    },
    onError: (err) => {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        typeof err.payload.existing_id === 'number'
      ) {
        if (!aliveRef.current) return;
        toast.info(t('quotes.msg.translateExists'));
        navigate(`/app/quotes/${err.payload.existing_id}`);
        return;
      }
      toast.error(t('quotes.err.translateFailed'), err instanceof Error ? err.message : undefined);
    },
  });

  // ⚠️ `isPending` нь `mutate()` дуудагдах хүртэл false тул flush хүлээх зуурх
  // давхар даралтыг ЭНЭ төлөв хаана (handlePdf-ийн `pdfBusy`-тэй ижил хэв маяг).
  const [translateBusy, setTranslateBusy] = useState(false);

  const handleTranslate = async () => {
    if (translateBusy || translateMutation.isPending) return;
    setTranslateBusy(true);
    try {
      // ⚠️ Сервер ХАДГАЛАГДСАН дэвтрийг орчуулдаг тул ноорог бүрэн буутал
      // ХҮЛЭЭНЭ — `commit()` нь зөвхөн эхлүүлдэг тул түүний араас шууд илгээвэл
      // орчуулга сүүлийн засваргүй хуучин дэвтэр дээр явж болно. PDF-ээс
      // ялгаатай нь энэ үр дүн ХАДГАЛАГДДАГ: дахин оролдвол 409 EXISTS болж
      // хуучирсан англи хувилбар руу л буцаана, засах ганц зам нь түүнийг устгах.
      const ok = await flush();
      if (!aliveRef.current) return; // хэрэглэгч хүлээх зуур хуудсаа орхив
      if (!ok) {
        toast.error(t('quotes.err.translateFailed'), t('quotes.err.saveFirst'));
        return;
      }
      translateMutation.mutate();
    } finally {
      setTranslateBusy(false);
    }
  };

  /* --- Экспорт --- */

  const [pdfBusy, setPdfBusy] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);

  const handlePdf = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      // Серверийн Browser Rendering нь ХАДГАЛАГДСАН хуудсыг зурдаг тул
      // эхлээд ноорогоо flush хийнэ.
      commit();
      await downloadPdf(`/quotes/${quote.id}/pdf`, `${fileBase(data.title)}.pdf`);
    } catch (err) {
      toast.error(t('quotes.err.pdf'), err instanceof Error ? err.message : undefined);
    } finally {
      setPdfBusy(false);
    }
  };

  const handleXlsx = async () => {
    if (xlsxBusy) return;
    setXlsxBusy(true);
    try {
      // Хуудас бүрийн тооцоолсон утгыг энгийн map болгоно — алдаатай нүд кодоороо
      // (#ТОМЬЁО! …) очно (чимээгүй 0 болж хувирснаас илүү).
      const valuesBySheet = new Map<string, Map<string, string | number | null>>();
      for (const [sheetId, res] of bySheet) {
        const plain = new Map<string, string | number | null>();
        for (const [ref, v] of res.values) plain.set(ref, isFormulaError(v) ? v.code : v);
        valuesBySheet.set(sheetId, plain);
      }
      await exportQuoteXlsx({
        fileName: `${fileBase(data.title)}.xlsx`,
        workbook: data.workbook,
        valuesBySheet,
      });
    } catch (err) {
      toast.error(t('common.error'), err instanceof Error ? err.message : undefined);
    } finally {
      setXlsxBusy(false);
    }
  };

  const handlePrint = () => {
    commit();
    window.open(`/quotes/${quote.id}/print`, '_blank', 'noopener');
  };

  /* --- Хэсэгчилсэн санал («зөвхөн эскиз зураг бол хэд вэ?») --- */

  /**
   * ⚠️ Диалог нь ХАДГАЛАГДААГҮЙ дэвтэр (`data.workbook`) дээр ажиллана — PM
   * дөнгөж сая тоо хэмжээгээ засчихаад «эскиз бол хэд вэ?» гэж асуух нь
   * хамгийн түгээмэл хэрэглээ. Сервер энэ дэвтрийг биед нь хүлээж авдаг тул
   * flush хүлээх шаардлагагүй (орчуулгаас ялгаатай — тэр ХАДГАЛАГДСАН мөрийг
   * уншдаг). Эх ноорогийг алдахгүйн тулд үүсгэхийн өмнө `commit()` л хийнэ.
   */
  const [scopeOpen, setScopeOpen] = useState(false);
  const canScope = useMemo(
    () => quote.source === 'app' && hasScope(data.workbook),
    [quote.source, data.workbook],
  );

  /* --- Рендэр --- */

  return (
    <PageContainer>
      <PageHeader
        title={data.title || t('quotes.pageTitle')}
        eyebrow={t('quotes.pageTitle')}
        icon={Table2}
        backTo="/app/quotes"
        // Англи хувилбар дээр байгаагаа мэдэгдэх жижиг тэмдэг.
        meta={
          quote.lang === 'en' ? <Badge variant="outline">{t('quotes.badge.en')}</Badge> : undefined
        }
        actions={
          <>
            <SaveBar
              status={status}
              dirty={dirty}
              lastSavedAt={lastSavedAt}
              locale={lang}
              onSave={save}
            />
            {canScope && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setScopeOpen(true)}
              >
                <Scissors />
                {t('quotes.scope.action')}
              </Button>
            )}
            {quote.lang === 'mn' && quote.source === 'app' && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={translateBusy || translateMutation.isPending}
                onClick={handleTranslate}
              >
                {translateBusy || translateMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Languages />
                )}
                {t('quotes.action.translateEn')}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pdfBusy}
              onClick={() => void handlePdf()}
            >
              {pdfBusy ? <Loader2 className="animate-spin" /> : <FileDown />}
              {t('quotes.action.pdf')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={xlsxBusy}
              onClick={() => void handleXlsx()}
            >
              {xlsxBusy ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />}
              {t('quotes.action.xlsx')}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handlePrint}>
              <Printer />
              {t('quotes.action.print')}
            </Button>
          </>
        }
      />

      {/* --- Баримтын толгойн талбарууд --- */}
      <Card className="gap-3 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="quote-title" className="text-xs text-muted-foreground">
              {t('quotes.field.title')}
            </Label>
            <Input
              id="quote-title"
              className="h-8"
              value={data.title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-client" className="text-xs text-muted-foreground">
              {t('quotes.field.client')}
            </Label>
            <Input
              id="quote-client"
              className="h-8"
              value={data.client_name ?? ''}
              onChange={(e) => setClient(e.target.value)}
              onBlur={commit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-date" className="text-xs text-muted-foreground">
              {t('quotes.field.docDate')}
            </Label>
            <Input
              id="quote-date"
              type="date"
              className="h-8"
              value={data.doc_date}
              onChange={(e) => setDocDate(e.target.value)}
              onBlur={commit}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-author" className="text-xs text-muted-foreground">
              {t('quotes.field.preparedBy')}
            </Label>
            <Input
              id="quote-author"
              className="h-8"
              value={data.prepared_by ?? ''}
              onChange={(e) => setPreparedBy(e.target.value)}
              onBlur={commit}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('quotes.anchor.total')}
          </span>
          <span className="text-base font-semibold tabular-nums">
            {total === null ? '—' : `${Math.round(total).toLocaleString('mn-MN')}₮`}
          </span>
          {tariffsLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </Card>

      {/* --- Хуудас (олон табтай ажлын дэвтэр) --- */}
      <div className="space-y-2">
        <SheetToolbar
          sheet={activeSheet}
          focused={focused}
          selection={selection}
          values={activeValues}
          onChange={handleSheetChange}
          undo={undoProps}
          showSections={showSections}
          onToggleSections={() => setShowSections((v) => !v)}
          quoteLang={quote.lang}
        />
        <SheetGrid
          sheet={activeSheet}
          values={activeValues}
          onChange={handleSheetChange}
          onFocusChange={setFocused}
          onSelectionChange={setSelection}
          hiddenCols={hiddenCols}
          className="rounded-md border border-border bg-card"
        />
        <SheetTabs workbook={data.workbook} onChange={handleWorkbookChange} />
      </div>

      {canScope && (
        <ScopeQuoteDialog
          quote={quote}
          workbook={data.workbook}
          open={scopeOpen}
          onOpenChange={setScopeOpen}
          onBeforeCreate={commit}
        />
      )}
    </PageContainer>
  );
}
