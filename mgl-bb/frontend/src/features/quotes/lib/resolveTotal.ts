/**
 * НИЙТ ДҮН-г НАЙДВАРТАЙ олох — гурван шатлалт шийдэгч.
 *
 * ── Ямар асуудлыг шийдэж байна вэ? ─────────────────────────────────────────
 * Жагсаалтын «Нийт дүн» багана нь `quotes.total_amount` кэшээс уншдаг ба тэр нь
 * `wb.anchors.total` заасан нүдний утга. Гэтэл ТЭР ANCHOR МӨР/БАГАНА ШИЛЖИХЭД
 * ДАГАДАГГҮЙ:
 *   • `sheetOps.remapAnchors` нь зөвхөн ХУУДАС-түвшний `sheet.anchors`-ыг
 *     шилжүүлдэг ба `workbook.replaceSheet` түүнээс уншиж workbook-ийнхыг
 *     шинэчилдэг (`lib/workbook.ts:119-154`);
 *   • харин сервер уншилт бүрд `sheet.anchors`-ыг ХООСЛОДОГ
 *     (`backend/src/routes/quotes.ts` → `parseWorkbook`, «хуудас түвшний anchors
 *     хэрэглэгдэхгүй»), тул засварлагч бүр `{}`-ээс эхэлдэг.
 * Үр дүнд нь мөр устгах/нэмэх бүрд нүд шилжиж, томьёо бүгд зөв дагадаг ч anchor
 * хуучин хаяган дээрээ ХӨЛДӨНӨ. Бодит жишээ (2026-08-17, production):
 *   • #38 — anchor `G16` (хоосон нүд) атлаа НИЙТ ДҮН нь `Z15` → жагсаалтад «—»;
 *   • #24, #39 — anchor эрүүл → жагсаалтад зөв дүн.
 *
 * ── Шийдэл ────────────────────────────────────────────────────────────────
 * Anchor-ыг ГАНЦ эх сурвалж болгохоо болиод, эхний ТООН утга өгсөн шатлалыг
 * авна:
 *   1. `wb.anchors[key]` — эрүүл баримт энд зогсох ба зан төлөв нь өмнөхтэй
 *      БАЙТ БҮРЭЭРЭЭ ижил.
 *   2. `sheet.addons` (`lines.totalRef` / `costLines.sumRef`) — БҮТЦИЙН эх
 *      сурвалж. Энэ нь anchor-оос ялгаатай нь `shiftAddonSpec` (`sheetOps.ts`)
 *      -оор дөрвөн бүтцийн үйлдэл (мөр/багана нэмэх/устгах) бүрд шилждэг БА
 *      серверийн `sanitizeSheetDoc` түүнийг хэвээр нь дамжуулдаг. #38-ийг яг
 *      энэ шатлал засна (`lines.totalRef === 'Z15'` — баримт өөрөө мэдэж байсан).
 *   3. Шошгоор хайх — `addons` огт байхгүй (гараар барьсан) хуудсанд зориулсан
 *      ЭЦСИЙН арга.
 *
 * ⚠️ Энэ модуль anchor-ийн ШИЛЖИЛТИЙГ ЗАСАХГҮЙ, түүний эвдрэлийг ХОР ХӨНӨӨРГҮЙ
 * болгоно. Anchor-ыг мөр/багана дагуулж шилжүүлэх (өөрөөр хэлбэл засварлагчид
 * `normalizeWorkbook` дуудах) нь ТУСДАА, өөрийн шалгалттай өөрчлөлт байх ёстой:
 * `lib/workbook.ts:147-151`-ийн хамгаалалт нь яг тэр замаар 2026-07-29-нд бодит
 * үнийн саналыг эвдсэн, 2026-07-27-нд бас нэгийг (`:128-130`). Frontend-д тест
 * байхгүй тул тэр эрсдэлийг энэ засвартай хамт авахгүй.
 */
import { coordToRef, refToCoord } from './formula/refs';
import type { WorkbookEvalResult } from './formula';
import type { CellRef, NamedSheet, WorkbookDoc } from '../types/quotes';

/** Аль шатлал хариу өгснийг илэрхийлнэ (өөрөө засварлах логик үүнээс шийднэ). */
export type AnchorSource = 'anchor' | 'addons' | 'label' | 'none';

export interface ResolvedAnchor {
  /** Утга олдсон хуудасны `id` (олдоогүй бол null). */
  sheetId: string | null;
  /** Утга олдсон нүдний хаяг (олдоогүй бол null). */
  ref: CellRef | null;
  /** Тооцоолсон утга — зөвхөн ХЯЗГААРЛАГДМАЛ ТОО, эс бөгөөс null. */
  value: number | null;
  via: AnchorSource;
}

/** Энэ шийдэгч зөвхөн МӨНГӨН дүнгийн хоёр түлхүүрт хэрэгтэй (`title`-д биш). */
export type AmountKey = 'total' | 'subtotal';

const NOT_FOUND: ResolvedAnchor = { sheetId: null, ref: null, value: null, via: 'none' };

/** «  Нийт   үнэ: » → «НИЙТ ҮНЭ» */
function normalizeLabel(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim().replace(/[:.\s]+$/, '');
}

/**
 * Шатлал 3-ын шошгууд — ЯГ тохирох (агуулагдах биш).
 *
 * ⚠️ «НИЙТ ҮНЭ» нь загварт БАГАНЫН ТОЛГОЙ (`R2`/`Z2`) бөгөөд production-ий
 * гурван саналын гурвуулан дээр тааралддаг. Тиймээс доорх хайлт ХАМГИЙН СҮҮЛИЙН
 * мөрийг авдаг — эхнийхийг авбал толгойн мөрөнд тогтоно.
 */
const LABELS: Record<AmountKey, ReadonlySet<string>> = {
  total: new Set(['НИЙТ ДҮН', 'НИЙТ ҮНЭ']),
  subtotal: new Set(['ДҮН']),
};

function numberAt(
  bySheet: WorkbookEvalResult['bySheet'],
  sheetId: string,
  ref: CellRef,
): number | null {
  const v = bySheet.get(sheetId)?.values.get(ref);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * `addons`-оос тухайн түлхүүрийн БҮТЦИЙН хаягийг авна.
 *
 * ⚠️ `total` дээр ХӨНГӨЛӨЛТ ХАССАН дүн (`lines.finalRef`) нь НИЙТ ДҮН-гээс
 * ДЭЭГҮҮР эрэмбэлэгдэнэ — хөнгөлөлттэй баримтын жинхэнэ дүн бол захиалагчийн
 * ТӨЛӨХ дүн (`lib/addons.ts` → `addLineAddon`).
 */
function addonRefOf(sheet: NamedSheet, key: AmountKey): CellRef | undefined {
  const spec = sheet.addons;
  if (!spec) return undefined;
  if (key !== 'total') return spec.costLines?.sumRef;
  return spec.lines?.finalRef ?? spec.lines?.totalRef;
}

/**
 * Anchor нь ӨГӨГДЛИЙН МӨР дээр хөлдсөн үү?
 *
 * ⚠️ 1-р шатлалын ЦОРЫН ГАНЦ шалгуур нь «нүд нь ТОО өгч байна уу» байсан.
 * Гэтэл хөлдсөн anchor нь ихэвчлэн ТОМЬЁОТОЙ нүдэн дээр буудаг тул тэр
 * шалгуурыг ҮРГЭЛЖ давдаг — тэгээд 2/3-р шатлал ч, `QuoteEditorPage`-ийн
 * ӨӨРӨӨ ЗАСВАРЛАХ логик ч хэзээ ч ажиллахгүй, баримт МӨНХӨД буруу дүн
 * харуулна.
 *
 * Бодит жишээ (2026-08-19, production #43): `anchors.total = Z20`,
 * `subtotal = Z17` — хоёулаа НЭГ БАРИЛГЫН мөрийн «Нийт үнэ» нүд.
 * Хуудсын толгойд ₮307,214,325 гарч байхад баримтын жинхэнэ НИЙТ ДҮН нь
 * `Z39` = ₮13,566,052,696 байв (46 дахин зөрүү).
 *
 * ЯАГААД ЭНЭ ШАЛГУУР НАЙДВАРТАЙ ВЭ: `addons.firstRow…lastRow` нь нэг мөр = нэг
 * БАРИЛГА гэсэн муж. Баримтын НИЙТ ДҮН/ДҮН тэр мужийн ДОТОР хэзээ ч байхгүй —
 * тэдгээр нь мужийн ДООР сууна. Тиймээс мужид унасан anchor нь тодорхойлолтоор
 * ХӨЛДСӨН; түүнийг гээж 2-р шатлал (`addons` — мөр шилжихэд ДАГАДАГ) руу
 * шилжинэ. Anchor эрүүл, эсвэл `addons` огт байхгүй (гараар барьсан хуудас) бол
 * зан төлөв БАЙТ БҮРЭЭРЭЭ өмнөхтэй ижил.
 */
function anchorIsStale(wb: WorkbookDoc, sheetId: string, ref: CellRef): boolean {
  const sheet = wb.sheets.find((s) => s.id === sheetId);
  const band = sheet?.addons?.sections ?? sheet?.addons;
  if (!band) return false;
  const { firstRow, lastRow } = band;
  if (!Number.isInteger(firstRow) || !Number.isInteger(lastRow) || lastRow < firstRow) {
    return false;
  }
  const co = refToCoord(ref);
  return !!co && co.r >= firstRow && co.r <= lastRow;
}

/**
 * Шошгоор хайх — тухайн хуудсанд шошготой ХАМГИЙН СҮҮЛИЙН мөрийг олоод, тэр
 * мөрийн БАРУУН талаас эхлэн эхний тоон утгыг буцаана.
 *
 * ⚠️ Зөвхөн ЛИТЕРАЛ `cell.v`-г харна — томьёо (`cell.f`) ч, тооцоолсон бичвэр ч
 * биш. Эс бөгөөс загварын «Тайлбар: Хяналтын төсвийн нийт дүн ₮…» гэсэн
 * үүсгэсэн мөр таарна.
 */
function findByLabel(
  sheet: NamedSheet,
  key: AmountKey,
  bySheet: WorkbookEvalResult['bySheet'],
): ResolvedAnchor | null {
  const wanted = LABELS[key];
  let labelRow = -1;
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (typeof cell?.v !== 'string') continue;
    if (!wanted.has(normalizeLabel(cell.v))) continue;
    const co = refToCoord(ref);
    if (co && co.r > labelRow) labelRow = co.r;
  }
  if (labelRow < 0) return null;

  for (let c = sheet.cols - 1; c >= 0; c -= 1) {
    const ref = coordToRef(labelRow, c);
    const value = numberAt(bySheet, sheet.id, ref);
    if (value !== null) return { sheetId: sheet.id, ref, value, via: 'label' };
  }
  return null;
}

/**
 * Хуудсуудыг ХАЙХ ДАРААЛАЛД эрэмбэлнэ: anchor заасан хуудас → идэвхтэй хуудас →
 * үлдсэн нь. Олон хуудаст дэвтэрт НИЙТ ДҮН нь ихэвчлэн эхний («Нэгтгэл»)
 * хуудсанд байдаг ч anchor нь аль хуудсыг заасныг л мэдэж болно.
 */
function searchOrder(wb: WorkbookDoc, preferSheetId: string | undefined): NamedSheet[] {
  const ordered: NamedSheet[] = [];
  const seen = new Set<string>();
  const push = (s: NamedSheet | undefined) => {
    if (!s || seen.has(s.id)) return;
    seen.add(s.id);
    ordered.push(s);
  };
  if (preferSheetId) push(wb.sheets.find((s) => s.id === preferSheetId));
  push(wb.sheets[Math.min(Math.max(0, wb.activeSheet ?? 0), wb.sheets.length - 1)]);
  for (const s of wb.sheets) push(s);
  return ordered;
}

/**
 * Дүнгийн нүдийг олж, түүний ТООЦООЛСОН утгыг буцаана.
 *
 * `bySheet` нь `useQuoteWorkbook`-ийн үр дүн — тариф ачаалагдаж дуустал бүх
 * `TARIF()` `#ТАРИФ!` болдог тул дуудагч тал `tariffsLoading` үед үр дүнг
 * КЭШЛЭХГҮЙ байх ёстой (`QuoteEditorPage` тэгж хийдэг).
 */
export function resolveAnchor(
  wb: WorkbookDoc,
  key: AmountKey,
  bySheet: WorkbookEvalResult['bySheet'],
): ResolvedAnchor {
  // 1) Anchor — эрүүл баримтын зам. Өгөгдлийн мөр дээр хөлдсөнийг НЬ гээнэ.
  const a = wb.anchors[key];
  if (a && !anchorIsStale(wb, a.sheet, a.ref)) {
    const value = numberAt(bySheet, a.sheet, a.ref);
    if (value !== null) return { sheetId: a.sheet, ref: a.ref, value, via: 'anchor' };
  }

  const sheets = searchOrder(wb, a?.sheet);

  // 2) `addons` — бүтцийн эх сурвалж (мөр/багана шилжихэд дагадаг).
  for (const sheet of sheets) {
    const ref = addonRefOf(sheet, key);
    if (!ref) continue;
    const value = numberAt(bySheet, sheet.id, ref);
    if (value !== null) return { sheetId: sheet.id, ref, value, via: 'addons' };
  }

  // 3) Шошго — эцсийн арга.
  for (const sheet of sheets) {
    const hit = findByLabel(sheet, key, bySheet);
    if (hit) return hit;
  }

  return NOT_FOUND;
}
