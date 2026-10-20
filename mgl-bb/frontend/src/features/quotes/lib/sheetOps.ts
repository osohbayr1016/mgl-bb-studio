/**
 * `SheetDoc`-ийн ЦЭВЭР (immutable) үйлдлүүд — нүд бичих, мөр/багана нэмэх/устгах,
 * нүд нэгтгэх.
 *
 * Бүх функц шинэ `SheetDoc` буцаана (React state-д шууд тавихад тохиромжтой).
 * Мөр/багана оруулах, устгах үед томьёо доторх лавлагааг `shiftRefsInFormula`
 * шилжүүлнэ — эс бөгөөс мөр нэмэхэд бүх тооцоо эвдэрнэ.
 */
import {
  coordToRef,
  refToCoord,
  shiftRefsInFormula,
  translateFormula,
} from './formula/refs';
import type {
  AddonSpec,
  AnchorKey,
  CellRef,
  CostLineSpec,
  LineAddonSpec,
  SectionSpec,
  SheetCell,
  SheetDoc,
  SheetMerge,
} from '../types/quotes';

/* ------------------------------------------------------------------ */
/*  Нүд унших / бичих                                                  */
/* ------------------------------------------------------------------ */

export function getCell(sheet: SheetDoc, r: number, c: number): SheetCell | undefined {
  return sheet.cells[coordToRef(r, c)];
}

export interface CellPatch {
  r: number;
  c: number;
  /** `null` = нүдийг устгах (sparse хадгалалт). */
  cell: SheetCell | null;
}

/**
 * Олон нүдийг НЭГ шинэчлэлтээр бичнэ.
 *
 * Excel-ээс 50 нүд буулгахад 50 удаа `setState` дуудвал React 50 удаа дахин
 * зурж, томьёоны граф 50 удаа тооцоологдоно. Тиймээс clipboard/fill-down бүх
 * бичилтээ энэ рүү нэг дор өгдөг.
 */
export function setCells(sheet: SheetDoc, patches: CellPatch[]): SheetDoc {
  if (patches.length === 0) return sheet;
  const cells = { ...sheet.cells };
  let maxR = sheet.rows - 1;
  for (const p of patches) {
    const ref = coordToRef(p.r, p.c);
    if (p.cell === null) delete cells[ref];
    else cells[ref] = p.cell;
    if (p.r > maxR) maxR = p.r;
  }
  return { ...sheet, cells, rows: Math.max(sheet.rows, maxR + 1) };
}

/* ------------------------------------------------------------------ */
/*  Мөр / багана                                                       */
/* ------------------------------------------------------------------ */

type ShiftOp = Parameters<typeof shiftRefsInFormula>[1];

/**
 * `AddonSpec`-ийн индексүүдийг мөр/багана нэмэх-устгахад дагуулна — эс бөгөөс
 * «Нэмэгдэл» цэс буруу багана руу заана.
 *
 * Нэмэгдлийн мужийн ДОТОР багана уствал тэр нэмэгдлүүд жагсаалтаас хасагдана
 * (хэрэглэгч гараар устгасан = унтраасантай ижил).
 */
function shiftAddonSpec(spec: AddonSpec | undefined, op: ShiftOp): AddonSpec | undefined {
  if (!spec) return undefined;
  const shift = (i: number) => {
    if (op.kind === 'insertRow' || op.kind === 'insertCol') return i >= op.at ? i + op.count : i;
    if (i >= op.at + op.count) return i - op.count;
    return i >= op.at ? op.at : i; // устсан мужид байсан → мужийн эхлэл рүү
  };

  /**
   * Мужийн ТӨГСГӨЛИЙН индекс (`lastRow`) — `op.growEnd` асаалттай үед яг доор
   * нь орсон мөрийг муж ЗАЛГИНА (`ShiftOp.growEnd`-ийг үз).
   *
   * ⚠️ Энэ нь `SUM(...)` мужтай ЗААВАЛ хамт хөдлөх ёстой: `lastRow` хоцорвол
   * дараагийн «Нэмэгдэл»/«Хэсэг» асаах·унтраахад томьёо зөвхөн хуучин мөрүүд
   * дээр дахин үүсч, доор нэмэгдсэн мөрүүд БАЙНГА хасагдана.
   */
  const shiftEnd = (i: number) => {
    if (op.kind === 'insertRow' || op.kind === 'insertCol') {
      return i >= (op.growEnd ? op.at - 1 : op.at) ? i + op.count : i;
    }
    return shift(i);
  };

  /**
   * Мужийн ЭХЛЭЛИЙН индекс (`firstRow`) — `op.growStart` асаалттай үед яг
   * эхэн дээр нь орсон мөрийг муж ЗАЛГИНА (`ShiftOp.growStart`-ыг үз).
   *
   * ⚠️ `shiftEnd`-тэй ижил шалтгаан: `SUM(...)` мужийн эхлэлтэй ЗААВАЛ хамт
   * хөдлөх ёстой. `firstRow` урагшилчихвал дараагийн «Нэмэгдэл»/«Хэсэг»
   * асаах·унтраахад томьёо шинэ ЭХНИЙ мөрийг алгасаж дахин үүснэ.
   */
  const shiftStart = (i: number) => {
    if (op.kind === 'insertRow' || op.kind === 'insertCol') {
      return i >= (op.growStart ? op.at + 1 : op.at) ? i + op.count : i;
    }
    return shift(i);
  };

  /** `lines`-ийн нүдний хаягийг мөр/багана шилжилтэд дагуулна. */
  const shiftRef = (ref: string): string => {
    const co = refToCoord(ref);
    if (!co) return ref;
    return op.kind === 'insertRow' || op.kind === 'deleteRow'
      ? coordToRef(shift(co.r), co.c)
      : coordToRef(co.r, shift(co.c));
  };
  const withLines = (next: AddonSpec): AddonSpec => {
    if (!spec.lines) return next;
    const lines: LineAddonSpec = {
      ...spec.lines,
      baseRef: shiftRef(spec.lines.baseRef),
      totalRef: shiftRef(spec.lines.totalRef),
    };
    // Хөнгөлөлтийн (эцсийн дүнгийн) мөр мөн адил дагана — эс бөгөөс мөр нэмэх
    // бүрд `finalRef` хоцорч, устгах үед БУРУУ мөрийг устгана.
    if (spec.lines.finalRef !== undefined) lines.finalRef = shiftRef(spec.lines.finalRef);
    return { ...next, lines };
  };

  /**
   * `costLines`-ийг дагуулна: нүдний хаяг (`baseRef`/`sumRef`) мөр/багана аль
   * алинд нь шилжинэ; мөрийн бүрэлдэхүүн БАГАНУУД зөвхөн багана нэмэх/устгахад.
   */
  const withCostLines = (next: AddonSpec): AddonSpec => {
    const cl = spec.costLines;
    if (!cl) return next;
    const costLines: CostLineSpec = {
      ...cl,
      baseRef: shiftRef(cl.baseRef),
      sumRef: shiftRef(cl.sumRef),
    };
    if (op.kind === 'insertCol' || op.kind === 'deleteCol') {
      costLines.labelCol = shift(cl.labelCol);
      costLines.qtyCol = shift(cl.qtyCol);
      costLines.unitCol = shift(cl.unitCol);
      costLines.priceCol = shift(cl.priceCol);
    }
    return { ...next, costLines };
  };

  /**
   * `sections`-ийг дагуулна.
   *
   * ⚠️ Хэсэг нь БАГАНА (`AddonSpec`-тэй ижил зохион байгуулалт) тул дүрэм нь
   * нэмэгдлийнхтэй ижил: мөрийн үйлдэлд мөрийн индексүүд, баганын үйлдэлд
   * `baseCol` шилжинэ, мужийн ДОТОР багана уствал тэр хэсгүүд жагсаалтаас
   * хасагдана (хэрэглэгч гараар устгасан = унтраасантай ижил).
   */
  const withSections = (next: AddonSpec): AddonSpec => {
    const sc = spec.sections;
    if (!sc) return next;
    if (op.kind === 'insertRow' || op.kind === 'deleteRow') {
      const sections: SectionSpec = {
        ...sc,
        headerRow: shift(sc.headerRow),
        firstRow: shiftStart(sc.firstRow),
        lastRow: shiftEnd(sc.lastRow),
        sumRow: shift(sc.sumRow),
      };
      if (sc.groupRow !== undefined) sections.groupRow = shift(sc.groupRow);
      if (sc.noteRef !== undefined) sections.noteRef = shiftRef(sc.noteRef);
      return { ...next, sections };
    }
    const first = sc.baseCol + 1;
    let items = sc.items;
    if (op.kind === 'deleteCol') {
      const from = Math.max(op.at, first);
      const to = Math.min(op.at + op.count - 1, sc.baseCol + sc.items.length);
      if (to >= from) {
        const dropFrom = from - first;
        const dropTo = to - first;
        items = sc.items.filter((_, i) => i < dropFrom || i > dropTo);
      }
    }
    const sections: SectionSpec = { ...sc, baseCol: shift(sc.baseCol), items };
    if (sc.noteRef !== undefined) sections.noteRef = shiftRef(sc.noteRef);
    return { ...next, sections };
  };

  if (op.kind === 'insertRow' || op.kind === 'deleteRow') {
    const next: AddonSpec = {
      ...spec,
      headerRow: shift(spec.headerRow),
      firstRow: shiftStart(spec.firstRow),
      lastRow: shiftEnd(spec.lastRow),
    };
    if (spec.groupRow !== undefined) next.groupRow = shift(spec.groupRow);
    return withLines(withCostLines(withSections(next)));
  }

  const first = spec.baseCol + 1;
  let items = spec.items;
  if (op.kind === 'deleteCol') {
    const from = Math.max(op.at, first);
    const to = Math.min(op.at + op.count - 1, spec.baseCol + spec.items.length);
    if (to >= from) {
      const dropFrom = from - first;
      const dropTo = to - first;
      items = spec.items.filter((_, i) => i < dropFrom || i > dropTo);
    }
  }
  return withLines(withCostLines(withSections({ ...spec, baseCol: shift(spec.baseCol), items })));
}

/* ------------------------------------------------------------------ */
/*  Merge-ийг мөр/багана нэмэх-устгахад дагуулах                        */
/* ------------------------------------------------------------------ */

/** `shiftMergeAxis`-ийн үйлдэл — нэг тэнхлэг дээрх оруулалт/устгал. */
interface AxisOp {
  kind: 'insert' | 'delete';
  at: number;
  count: number;
}

/**
 * Merge-ийн НЭГ тэнхлэгийг (эхлэл + урт) шилжүүлж/өргөсгөж/агшаана.
 *
 * ⚠️ Хоёр түгээмэл алдааг энд ЗӨВ барина:
 *  1. Оруулах цэгийг ДУНДУУР нь огтолсон merge өргөсөх ёстой — эс бөгөөс
 *     8 багана хамарсан бүлгийн толгой 1 багана болж хумигдана.
 *  2. ХЭСЭГЧЛЭН устсан merge агших ёстой — эс бөгөөс хэт урт үлдэж хөрш
 *     нүднүүдийг залгина.
 *
 * `null` = энэ тэнхлэг дээр merge-ээс юу ч үлдсэнгүй (бүрмөсөн уссан).
 */
function shiftMergeAxis(
  start: number,
  len: number,
  op: AxisOp,
): { start: number; len: number } | null {
  if (op.kind === 'insert') {
    // Оруулалт merge-ийн эхлэлээс дээгүүр/зүүн тийш → бүхэлдээ шилжинэ.
    if (op.at <= start) return { start: start + op.count, len };
    // Дундуур нь орлоо → merge өргөснө (эхлэл хэвээр).
    if (op.at < start + len) return { start, len: len + op.count };
    // Merge-ийн ард → өөрчлөлтгүй.
    return { start, len };
  }
  // Устгах муж [at, at+count) — давхцсан хэсгээр нь агшаана.
  const end = op.at + op.count;
  const overlap = Math.max(0, Math.min(start + len, end) - Math.max(start, op.at));
  const nextLen = len - overlap;
  if (nextLen <= 0) return null;
  const nextStart = start >= op.at ? Math.max(op.at, start - op.count) : start;
  return { start: nextStart, len: nextLen };
}

/**
 * Утгагүй болсон merge-ийг хаяна: тэнхлэг хоосорсон, эсвэл 1×1 болсон
 * (нэг нүдийг «нэгтгэх» нь утгагүй, хог болж хуримтлагдана). Нөгөө тэнхлэг нь
 * >1 хэвээр бол merge хүчинтэй — жишээ нь rs=2, cs=1 нь босоо нэгтгэл.
 */
function normalizeMerge(m: SheetMerge): SheetMerge | null {
  if (m.rs <= 0 || m.cs <= 0) return null;
  if (m.rs === 1 && m.cs === 1) return null;
  return m;
}

/** Merge жагсаалтыг МӨРИЙН тэнхлэгээр дагуулна (багана хэвээр). */
function shiftMergesByRow(merges: SheetMerge[], op: AxisOp): SheetMerge[] {
  const out: SheetMerge[] = [];
  for (const m of merges) {
    const axis = shiftMergeAxis(m.r, m.rs, op);
    if (!axis) continue;
    const next = normalizeMerge({ ...m, r: axis.start, rs: axis.len });
    if (next) out.push(next);
  }
  return out;
}

/** Merge жагсаалтыг БАГАНЫ тэнхлэгээр дагуулна (мөр хэвээр). */
function shiftMergesByCol(merges: SheetMerge[], op: AxisOp): SheetMerge[] {
  const out: SheetMerge[] = [];
  for (const m of merges) {
    const axis = shiftMergeAxis(m.c, m.cs, op);
    if (!axis) continue;
    const next = normalizeMerge({ ...m, c: axis.start, cs: axis.len });
    if (next) out.push(next);
  }
  return out;
}

/** Нүднүүдийг шилжүүлж, томьёоны лавлагааг зэрэг засна. */
function remapCells(
  sheet: SheetDoc,
  moveCoord: (r: number, c: number) => { r: number; c: number } | null,
  op: ShiftOp,
): Record<CellRef, SheetCell> {
  const next: Record<CellRef, SheetCell> = {};
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const at = refToCoord(ref);
    if (!at) continue;
    const moved = moveCoord(at.r, at.c);
    if (!moved) continue; // устсан мөр/багана дээрх нүд
    next[coordToRef(moved.r, moved.c)] = cell.f
      ? { ...cell, f: shiftRefsInFormula(cell.f, op) }
      : cell;
  }
  return next;
}

function remapAnchors(
  sheet: SheetDoc,
  moveCoord: (r: number, c: number) => { r: number; c: number } | null,
): SheetDoc['anchors'] {
  const next: SheetDoc['anchors'] = {};
  for (const [key, ref] of Object.entries(sheet.anchors)) {
    if (!ref) continue;
    const at = refToCoord(ref);
    if (!at) continue;
    const moved = moveCoord(at.r, at.c);
    if (moved) next[key as AnchorKey] = coordToRef(moved.r, moved.c);
  }
  return next;
}

/**
 * `at`-д `count` мөр оруулна.
 *
 * `growEnd` (анхдагчаар УНТРААЛТТАЙ) нь зөвхөн хэрэглэгчийн «Доор нь мөр
 * нэмэх» дохионд зориулагдана — `ShiftOp.growEnd`-ийн тайлбарыг үз.
 * `addons.ts`-ийн програмчилсан дуудалтууд үүнийг асаахгүй.
 */
export function insertRows(
  sheet: SheetDoc,
  at: number,
  count = 1,
  growEnd = false,
  growStart = false,
): SheetDoc {
  const move = (r: number, c: number) => ({ r: r >= at ? r + count : r, c });
  const op: ShiftOp = { kind: 'insertRow', at, count, growEnd, growStart };
  return {
    ...sheet,
    rows: sheet.rows + count,
    addons: shiftAddonSpec(sheet.addons, op),
    cells: remapCells(sheet, move, op),
    anchors: remapAnchors(sheet, move),
    merges: shiftMergesByRow(sheet.merges, { kind: 'insert', at, count }),
  };
}

export function deleteRows(sheet: SheetDoc, at: number, count = 1): SheetDoc {
  const end = at + count;
  const move = (r: number, c: number) =>
    r >= at && r < end ? null : { r: r >= end ? r - count : r, c };
  const op: ShiftOp = { kind: 'deleteRow', at, count };
  return {
    ...sheet,
    rows: Math.max(1, sheet.rows - count),
    addons: shiftAddonSpec(sheet.addons, op),
    cells: remapCells(sheet, move, op),
    anchors: remapAnchors(sheet, move),
    merges: shiftMergesByRow(sheet.merges, { kind: 'delete', at, count }),
  };
}

export function insertCols(sheet: SheetDoc, at: number, count = 1): SheetDoc {
  const move = (r: number, c: number) => ({ r, c: c >= at ? c + count : c });
  const op: ShiftOp = { kind: 'insertCol', at, count };
  const widths = sheet.colWidths ? [...sheet.colWidths] : undefined;
  if (widths) widths.splice(at, 0, ...Array<number>(count).fill(96));
  return {
    ...sheet,
    cols: sheet.cols + count,
    addons: shiftAddonSpec(sheet.addons, op),
    colWidths: widths,
    cells: remapCells(sheet, move, op),
    anchors: remapAnchors(sheet, move),
    merges: shiftMergesByCol(sheet.merges, { kind: 'insert', at, count }),
  };
}

export function deleteCols(sheet: SheetDoc, at: number, count = 1): SheetDoc {
  const end = at + count;
  const move = (r: number, c: number) =>
    c >= at && c < end ? null : { r, c: c >= end ? c - count : c };
  const op: ShiftOp = { kind: 'deleteCol', at, count };
  const widths = sheet.colWidths ? [...sheet.colWidths] : undefined;
  if (widths) widths.splice(at, count);
  return {
    ...sheet,
    cols: Math.max(1, sheet.cols - count),
    addons: shiftAddonSpec(sheet.addons, op),
    colWidths: widths,
    cells: remapCells(sheet, move, op),
    anchors: remapAnchors(sheet, move),
    merges: shiftMergesByCol(sheet.merges, { kind: 'delete', at, count }),
  };
}

/**
 * Баганы өргөнийг тогтооно (хэрэглэгч толгойн хилийг чирэхэд).
 *
 * `colWidths` нь сийрэг (дутуу) байж болох тул эхлээд бүтэн уртад нь дүүргэнэ —
 * эс бөгөөс 5-р баганыг чирэхэд массив [.., undefined, 120] болж, өмнөх
 * баганууд default руу үсэрнэ.
 */
export function setColWidth(
  sheet: SheetDoc,
  c: number,
  width: number,
  defaultWidth = 96,
): SheetDoc {
  if (c < 0 || c >= sheet.cols) return sheet;
  const widths = Array.from(
    { length: sheet.cols },
    (_, i) => sheet.colWidths?.[i] ?? defaultWidth,
  );
  widths[c] = Math.max(MIN_COL_WIDTH, Math.round(width));
  return { ...sheet, colWidths: widths };
}

/** Багана хэт нарийсаж алга болохоос сэргийлнэ. */
export const MIN_COL_WIDTH = 32;

/** Мөр хүрэлцэхгүй бол доор нь нэмнэ (paste-д хэрэгтэй). */
export function ensureRows(sheet: SheetDoc, needed: number): SheetDoc {
  return needed <= sheet.rows ? sheet : { ...sheet, rows: needed };
}

/* ------------------------------------------------------------------ */
/*  Мөр / багана ХУВИЛАХ (томьёог дагуулж)                             */
/* ------------------------------------------------------------------ */

/** Нүдийг хувилахад: томьёог орчуулж авна; литерал утгыг ХООСОЛНО (шинэ оролт
 *  бэлэн болгоно), гэхдээ формат/загвар/dropdown-ийг хадгална. */
function cloneCellShifted(cell: SheetCell, dr: number, dc: number): SheetCell {
  if (cell.f) return { ...cell, f: translateFormula(cell.f, dr, dc) };
  // Литерал: төрлийг нь үлдээгээд утгыг цэвэрлэнэ.
  const kept: SheetCell = {};
  if (cell.fmt) kept.fmt = cell.fmt;
  if (cell.s) kept.s = cell.s;
  if (cell.choices) kept.choices = cell.choices;
  return kept;
}

/**
 * `sourceRow`-ийн БҮТЦИЙГ (томьёо + формат + dropdown) хуулбарлан `at`-д шинэ мөр
 * оруулна. Тарифын томьёо, тооцооны багана бүгд шинэ мөр рүү заасан томьёотой
 * орж ирнэ; нэр/талбай/төвөгшил зэрэг оролтын нүд хоосон болно.
 *
 * ⚠️ Нийлбэрийн муж (`SUM(M4:M6)`) шинэ мөрийг АГУУЛАХЫН тулд `growEnd` БА
 * `growStart` ХОЁУЛАНГ нь АСААНА. Мужийн ДОТОР нэмэхэд энэ хэрэггүй (энгийн
 * шилжилт хангалттай), харин ХОЁР ИРМЭГ дээр л шаардлагатай:
 *   • СҮҮЛИЙН өгөгдлийн мөрийн ЯГ ДООР → мужийн төгсгөл `at - 1` дээр тул
 *     `growEnd`-гүйгээр огт тэлэхгүй;
 *   • ЭХНИЙ өгөгдлийн мөрийн ЯГ ДЭЭР → муж бүхэлдээ доош гулсаж
 *     (`Z4:Z29` → `Z5:Z30`) шинэ мөр мужаас ГАДУУР үлдэнэ (`growStart`).
 * Хоёр тохиолдол хоёулаа ямар ч улаан тэмдэггүйгээр ₮0 өгдөг байв.
 *
 * ⚠️ 2026-08-19 хүртэл энд `growEnd` БАЙГААГҮЙ бөгөөд энэ тайлбар нь «муж
 * төгсгөлийг тэлдэг (доорх тест батална)» гэж БУРУУ бичигдсэн байв — тийм тест
 * хэзээ ч байгаагүй (frontend-д тест байхгүй). Үр дүнд нь «Доор нь мөр нэмэх»-
 * ээр нэмсэн мөр өөрийн үнээ зөв тооцоод НИЙТ ДҮН рүү огт нэмэгддэггүй,
 * ямар ч улаан тэмдэггүйгээр ₮0 гардаг байлаа.
 */
/**
 * Хувилах ЭХ МӨРИЙГ өгөгдлийн мужид ХАВЧИНА.
 *
 * ⚠️ ЯАГААД: `at` нь өгөгдлийн мужид (эсвэл яг доор нь) буух үед хэрэглэгч
 * «дахиад нэг барилга» гэсэн санаатай байдаг. Гэтэл `SheetToolbar`-ийн товч нь
 * ФОКУСТАЙ мөрийг эх мөр болгодог тул «Ажлын зургийн үнэ» НИЙЛБЭР мөр дээр
 * зогсоод «Дээр нь мөр нэмэх» дарахад НИЙЛБЭР МӨРИЙГ ӨӨРИЙГ НЬ хувилдаг байв.
 * Тэгэхэд шинэ мөр `=SUM(Z4:Z29)`-ийг агуулж, тэлсэн муж түүнийг дотроо
 * тооцоод НИЙТ ДҮН ЯГ ХОЁР ДАХИН нэмэгддэг — ямар ч алдааны тэмдэггүйгээр
 * (2026-08-19-нд #43 санал дээр хэмжсэн: 9.4 тэрбум → 18.8 тэрбум).
 *
 * Мужийн гадна (жишээ нь зардлын мөрүүд, толгой) бол ХЭВЭЭР үлдээнэ — тэнд
 * фокустай мөрийг хувилах нь зөв зан төлөв.
 */
function cloneSourceRow(sheet: SheetDoc, at: number, sourceRow: number): number {
  const band = sheet.addons?.sections ?? sheet.addons;
  if (!band) return sourceRow;
  const { firstRow, lastRow } = band;
  if (!Number.isInteger(firstRow) || !Number.isInteger(lastRow) || lastRow < firstRow) {
    return sourceRow;
  }
  // Шинэ мөр мужид (эсвэл яг төгсгөлд нь) буухгүй бол хөндөхгүй.
  if (at < firstRow || at > lastRow + 1) return sourceRow;
  return Math.min(Math.max(sourceRow, firstRow), lastRow);
}

export function insertRowLike(sheet: SheetDoc, at: number, sourceRow: number): SheetDoc {
  const from = cloneSourceRow(sheet, at, sourceRow);
  // Эх мөрийн нүднүүдийг оруулахаас ӨМНӨ авна (индекс шилжихээс өмнө).
  const src: Array<{ c: number; cell: SheetCell }> = [];
  for (let c = 0; c < sheet.cols; c += 1) {
    const cell = getCell(sheet, from, c);
    if (cell) src.push({ c, cell });
  }
  const inserted = insertRows(sheet, at, 1, true, true);
  const dr = at - from;
  const patches: CellPatch[] = src.map(({ c, cell }) => ({
    r: at,
    c,
    cell: cloneCellShifted(cell, dr, 0),
  }));
  return joinCostSum(setCells(inserted, patches), at);
}

/**
 * ЗАРДЛЫН мужид нэмсэн шинэ мөрийг ДҮН-гийн томьёонд БҮРТГЭНЭ.
 *
 * ⚠️ ЯАГААД ЭНЭ ТУСДАА ХЭРЭГТЭЙ ВЭ: өгөгдлийн муж нь `SUM(Z4:Z29)` МУЖААР
 * нэгтгэгддэг тул `growEnd`/`growStart` хангалттай. Харин ДҮН нь мужгүй,
 * ГАРААР БИЧСЭН НЭМЭХИЙН ГИНЖ (`=Z30+Z31+Z33+Z34+Z35`) — «Нэмэгдэл» цэсээр
 * зардлын мөр нэмэхэд `addons.addCostLine` гишүүнийг нь өөрөө залгадаг ч
 * хэрэглэгч ГАРААР мөр нэмэхэд гинж хэвээрээ үлдэж, шинэ мөрийн дүн ямар ч
 * улаан тэмдэггүйгээр ДҮН-гээс УНАДАГ байв.
 *
 * Яг ийм замаар production #43-ын `Z32` («Барилгажилтын төсөл…» ₮24,100,000)
 * ДҮН-гээс гээгдсэн — гинж нь `=Z30+Z31+Z33+Z34+Z35` гэж `Z32`-гүй сууж байв
 * (2026-08-19-нд хэмжсэн).
 *
 * Зөвхөн `costLines` тодорхойлолттой хуудсанд, зөвхөн зардлын мужид (АЗ-ийн
 * нийлбэр мөрөөс ДООШ, ДҮН-гийн мөр ХүРТЭЛ) буусан мөрөнд ажиллана. Өгөгдлийн
 * муж (АЗ-ийн мөрөөс ДЭЭШ) энэ функцэд хэзээ ч хүрэхгүй — хоёр муж огтлолцдоггүй.
 */
function joinCostSum(sheet: SheetDoc, at: number): SheetDoc {
  const cl = sheet.addons?.costLines;
  if (!cl) return sheet;
  // `insertRows` дараах ДҮН-гийн байрлал (`sumRef` аль хэдийн шилжсэн).
  const sumCo = refToCoord(cl.sumRef);
  if (!sumCo) return sheet;
  const blockTop = sumCo.r - cl.items.length - 1; // шинэ мөр нэмэгдсэн тул -1
  if (at <= blockTop || at >= sumCo.r) return sheet;

  const sumCell = getCell(sheet, sumCo.r, sumCo.c);
  if (!sumCell?.f) return sheet;
  const ref = coordToRef(at, sumCo.c);
  // Аль хэдийн орсон бол (хувилсан томьёо г.м.) давхардуулахгүй.
  if (new RegExp(`(^|[^0-9A-Za-z])${ref}(?![0-9A-Za-z])`).test(sumCell.f)) return sheet;
  return setCells(sheet, [
    { r: sumCo.r, c: sumCo.c, cell: { ...sumCell, f: `${sumCell.f}+${ref}` } },
  ]);
}

/**
 * `sourceCol`-ийн бүтцийг хуулбарлан `at`-д шинэ багана оруулна (мөр хувилахын
 * баганын хувилбар — жишээ нь шинэ хувийн нэмэгдэл багана).
 */
export function insertColLike(sheet: SheetDoc, at: number, sourceCol: number): SheetDoc {
  const src: Array<{ r: number; cell: SheetCell }> = [];
  for (let r = 0; r < sheet.rows; r += 1) {
    const cell = getCell(sheet, r, sourceCol);
    if (cell) src.push({ r, cell });
  }
  const inserted = insertCols(sheet, at, 1);
  const dc = at - sourceCol;
  const patches: CellPatch[] = src.map(({ r, cell }) => ({
    r,
    c: at,
    cell: cloneCellShifted(cell, 0, dc),
  }));
  return setCells(inserted, patches);
}

/* ------------------------------------------------------------------ */
/*  Нэгтгэсэн нүд                                                      */
/* ------------------------------------------------------------------ */

/** Тухайн координатыг бүрхэж буй merge (байвал) — зөвхөн 1 байж болно. */
export function mergeAt(sheet: SheetDoc, r: number, c: number): SheetMerge | undefined {
  return sheet.merges.find(
    (m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs,
  );
}

/** Merge-ийн зүүн дээд нүд мөн эсэх — зөвхөн тэр нүд рендэрлэгдэнэ. */
export function isMergeOrigin(m: SheetMerge, r: number, c: number): boolean {
  return m.r === r && m.c === c;
}

/**
 * Сонгосон тэгш өнцөгтийг нэгтгэнэ. Давхцаж буй хуучин merge-ийг устгана;
 * зүүн дээд нүднээс бусад нүдний утгыг УСТГАНА (Excel-ийн зан төлөв).
 */
export function mergeRange(
  sheet: SheetDoc,
  rect: { minR: number; maxR: number; minC: number; maxC: number },
): SheetDoc {
  const rs = rect.maxR - rect.minR + 1;
  const cs = rect.maxC - rect.minC + 1;
  if (rs <= 1 && cs <= 1) return sheet;

  const cells = { ...sheet.cells };
  for (let r = rect.minR; r <= rect.maxR; r += 1) {
    for (let c = rect.minC; c <= rect.maxC; c += 1) {
      if (r === rect.minR && c === rect.minC) continue;
      delete cells[coordToRef(r, c)];
    }
  }
  const kept = sheet.merges.filter(
    (m) =>
      m.r + m.rs - 1 < rect.minR ||
      m.r > rect.maxR ||
      m.c + m.cs - 1 < rect.minC ||
      m.c > rect.maxC,
  );
  return {
    ...sheet,
    cells,
    merges: [...kept, { r: rect.minR, c: rect.minC, rs, cs }],
  };
}

export function unmergeAt(sheet: SheetDoc, r: number, c: number): SheetDoc {
  const m = mergeAt(sheet, r, c);
  if (!m) return sheet;
  return { ...sheet, merges: sheet.merges.filter((x) => x !== m) };
}

/* ------------------------------------------------------------------ */
/*  Anchor                                                             */
/* ------------------------------------------------------------------ */

export function setAnchor(sheet: SheetDoc, key: AnchorKey, r: number, c: number): SheetDoc {
  return { ...sheet, anchors: { ...sheet.anchors, [key]: coordToRef(r, c) } };
}

export function clearAnchor(sheet: SheetDoc, key: AnchorKey): SheetDoc {
  const anchors = { ...sheet.anchors };
  delete anchors[key];
  return { ...sheet, anchors };
}

/** Тухайн нүдэнд тавигдсан anchor-ийн түлхүүр (байвал). */
export function anchorAt(sheet: SheetDoc, r: number, c: number): AnchorKey | undefined {
  const ref = coordToRef(r, c);
  return (Object.keys(sheet.anchors) as AnchorKey[]).find((k) => sheet.anchors[k] === ref);
}

/* ------------------------------------------------------------------ */

export function emptySheet(rows = 30, cols = 14): SheetDoc {
  return { rows, cols, merges: [], cells: {}, anchors: {} };
}
