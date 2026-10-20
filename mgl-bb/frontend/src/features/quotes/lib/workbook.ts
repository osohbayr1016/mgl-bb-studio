/**
 * Workbook туслахууд — олон хуудаст ажлын дэвтэр (v3).
 *
 * ЧУХАЛ — буцаад нийцтэй байдал: `quotes.sheet_json` баганад хоёр хэлбэр байж
 * болно:
 *   • Шинэ: `WorkbookDoc` = `{ sheets:[…], anchors:{…} }`.
 *   • Хуучин (v2): ганц `SheetDoc` = `{ rows, cols, cells, merges, anchors }`.
 * `normalizeWorkbook` хоёуланг уншиж үргэлж `WorkbookDoc` буцаана. Тусдаа
 * migration ХЭРЭГГҮЙ — зөвхөн уншихад ороогдоно.
 */
import type {
  AnchorKey,
  NamedSheet,
  SheetAnchors,
  SheetCell,
  SheetDoc,
  WorkbookAnchors,
  WorkbookDoc,
} from '../types/quotes';

let idSeq = 0;
/** nanoid өгөгдөөгүй үед (тест/сервер) ажиллах энгийн дараалсан id. */
function localId(): string {
  idSeq += 1;
  return `sheet-${idSeq}`;
}

function isWorkbook(v: unknown): v is WorkbookDoc {
  return typeof v === 'object' && v !== null && Array.isArray((v as WorkbookDoc).sheets);
}

function isSheet(v: unknown): v is SheetDoc {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as SheetDoc).rows === 'number' &&
    typeof (v as SheetDoc).cells === 'object'
  );
}

/** Ганц `SheetDoc`-ийг нэртэй хуудас болгоно (id өгөгдөөгүй бол шинэ). */
export function toNamedSheet(sheet: SheetDoc, name: string, id?: string): NamedSheet {
  return {
    rows: sheet.rows,
    cols: sheet.cols,
    colWidths: sheet.colWidths,
    merges: sheet.merges ?? [],
    cells: sheet.cells ?? {},
    anchors: {},
    id: id ?? localId(),
    name,
  };
}

function normalizeSheetCells(cells: Record<string, SheetCell> | undefined): Record<string, SheetCell> {
  if (!cells) return {};
  const discountRows = new Set<number>();
  for (const [ref, cell] of Object.entries(cells)) {
    if (cell && typeof cell.v === 'string') {
      const vLow = cell.v.toLowerCase();
      if (vLow.includes('хөнгөлөлт') || vLow.includes('discount')) {
        const row = Number(ref.replace(/^[A-Za-z]+/, ''));
        if (row) discountRows.add(row);
      }
    }
  }

  const next: Record<string, SheetCell> = {};
  for (const [ref, cell] of Object.entries(cells)) {
    if (!cell) continue;
    let s = cell.s;
    let v = cell.v;
    if (typeof v === 'string') {
      const vLow = v.toLowerCase();
      if (vLow.includes('менежмент') && !v.includes('МЕНЕЖМЕНТ')) {
        if (vLow.includes('менежментийн зардал')) {
          v = v.replace(/менежментийн зардал/gi, 'МЕНЕЖМЕНТИЙН ЗАРДАЛ');
        } else {
          v = v.replace(/менежмент/gi, 'МЕНЕЖМЕНТ');
        }
      }
      if ((vLow.includes('менежмент') || vLow.includes('нөат')) && s?.bold) {
        s = { ...s, bold: false };
      }
    }
    const row = Number(ref.replace(/^[A-Za-z]+/, ''));
    if ((discountRows.has(row) || s?.color === 'success') && s?.color === 'success') {
      s = { ...s, color: 'danger' };
    }
    // Толгой мөрийн текстүүд төвдөө голлоно (Center)
    if (s?.bg === "header" || (typeof v === "string" && (v.includes("Барилгын нэр") || v.includes("Зураг төсөл боловсруулах")))) {
      if (!s || s.align !== "center") {
        s = { ...s, align: "center" };
      }
    }
    // Бүх тоон нүднүүд (Тоо хэмжээ, нийт үнэ г.м.) төвдөө голлоно (Center)
    if ((cell.fmt && cell.fmt !== "text") || typeof v === "number") {
      if (!s || s.align !== "center") {
        s = { ...s, align: "center" };
      }
    }
    const cellChanged = s !== cell.s || v !== cell.v;
    next[ref] = cellChanged ? { ...cell, ...(s !== cell.s ? { s } : {}), ...(v !== cell.v ? { v } : {}) } : cell;
  }
  return next;
}

function normalizeSheetDoc(sheet: SheetDoc): SheetDoc {
  return {
    ...sheet,
    cells: normalizeSheetCells(sheet.cells ?? {}),
  };
}

export function normalizeWorkbook(raw: unknown, makeId: () => string = localId): WorkbookDoc {
  // Шинэ хэлбэр.
  if (isWorkbook(raw)) {
    const anchors = raw.anchors ?? {};
    const sheets = raw.sheets.map((s, i) => {
      const named = s as Partial<NamedSheet>;
      const id = named.id || makeId();
      const name = named.name || `Хуудас${i + 1}`;
      const n = normalizeSheetDoc(s);
      return {
        ...n,
        id,
        name,
        // ⚠️ Workbook-ийн anchor-ыг тухайн ХУУДСАНД нь бас бичнэ (доорх
        // `replaceSheet`-ийн тайлбарыг үз) — эс бөгөөс мөр/багана нэмэхэд
        // шилждэггүй.
        anchors: pushDownAnchors(anchors, id),
      };
    });
    return { sheets, anchors, activeSheet: raw.activeSheet ?? 0 };
  }

  // Хуучин ганц хуудас → 1-хуудаст workbook. anchors-ыг хуудсаас workbook руу зөөнө.
  if (isSheet(raw)) {
    const id = makeId();
    const sheet = toNamedSheet(normalizeSheetDoc(raw), 'Хуудас1', id);
    const anchors: WorkbookAnchors = {};
    for (const [k, ref] of Object.entries(raw.anchors ?? {})) {
      if (ref) anchors[k as AnchorKey] = { sheet: id, ref };
    }
    return { sheets: [sheet], anchors, activeSheet: 0 };
  }

  // Гэмтэлтэй/хоосон → хоосон 1-хуудаст workbook.
  const id = makeId();
  return {
    sheets: [{ id, name: 'Хуудас1', rows: 30, cols: 14, merges: [], cells: {}, anchors: {} }],
    anchors: {},
    activeSheet: 0,
  };
}

/** Нэрээр хуудас олох (томьёоны хөдөлгүүрт). Регистр үл ялгана. */
export function sheetByName(wb: WorkbookDoc, name: string): NamedSheet | undefined {
  const n = name.trim().toLowerCase();
  return wb.sheets.find((s) => s.name.trim().toLowerCase() === n);
}

export function sheetById(wb: WorkbookDoc, id: string): NamedSheet | undefined {
  return wb.sheets.find((s) => s.id === id);
}

/**
 * Workbook-ийн anchor-уудаас тухайн хуудсынхыг ялгаж, ХУУДАС-түвшний хэлбэрт
 * (`{ключ: ref}`) буулгана.
 */
function pushDownAnchors(anchors: WorkbookAnchors, sheetId: string): SheetAnchors {
  const out: SheetAnchors = {};
  if (!sheetId) return out;
  for (const [k, a] of Object.entries(anchors)) {
    if (a && a.sheet === sheetId) out[k as AnchorKey] = a.ref;
  }
  return out;
}

/**
 * Workbook-ийн нэг хуудсыг солиод шинэ WorkbookDoc буцаана (immutable).
 *
 * ⚠️ ANCHOR-ЫГ ӨӨДӨӨ ТАТНА. Мөр/багана нэмэх-устгах үйлдлүүд (`sheetOps`) нь
 * ЗӨВХӨН хуудас-түвшний `sheet.anchors`-ыг шилжүүлдэг — workbook-ийн
 * `wb.anchors`-ыг мэддэггүй (тэдгээр функц нэг хуудсаар л ажилладаг). Тиймээс
 * загварчлал нь: anchor нь хуудсан дээр «амьдарч» шилжинэ, workbook-ийнх нь
 * түүнээс уншсан ХУУЛБАР.
 *
 * Ингэхгүй бол мөр нэмэх бүрд НИЙТ ҮНЭ-гийн anchor хуучин нүдэн дээрээ үлдэж,
 * жагсаалтын дүн/PDF/MCP буруу (эсвэл хоосон) уншина — 2026-07-27-нд бодит
 * үнийн санал дээр ийм эвдрэл илэрсэн (anchor `Q19`, бодит дүн `P21`).
 */
export function replaceSheet(wb: WorkbookDoc, index: number, next: NamedSheet): WorkbookDoc {
  if (index < 0 || index >= wb.sheets.length) return wb;
  const sheets = wb.sheets.slice();
  sheets[index] = next;

  const prev = wb.sheets[index];
  const anchors: WorkbookAnchors = { ...wb.anchors };
  for (const [k, a] of Object.entries(wb.anchors)) {
    if (!a || a.sheet !== next.id) continue;
    const key = k as AnchorKey;
    const now = next.anchors?.[key];
    if (now) {
      anchors[key] = { sheet: next.id, ref: now };
      continue;
    }
    // ⚠️ Зөвхөн хуудсан дээр БАЙЖ БАЙГААД уссан бол (мөр/багана нь устсан)
    // workbook-ийнхыг арилгана. Хуудсан дээр огт бүртгэгдээгүй байсан бол
    // ХЭВЭЭР үлдээнэ — эс бөгөөс хуучин (anchor-гүй) баримтыг нэг засварлахад
    // бүх anchor устдаг байв (2026-07-29-нд бодит үнийн саналыг эвдсэн).
    if (prev.anchors?.[key]) delete anchors[key];
  }
  return { ...wb, sheets, anchors };
}

/**
 * anchor тухайн (sheetId, ref)-д тавих.
 * Хуудас-түвшинд МӨН бичнэ — тэндээс нь мөр/багана шилжилт дагана.
 */
export function setWorkbookAnchor(
  wb: WorkbookDoc,
  key: AnchorKey,
  sheetId: string,
  ref: string,
): WorkbookDoc {
  const sheets = wb.sheets.map((s) => {
    // Нэг anchor нэг л газар байна: өөр хуудсанд байсныг нь арилгана.
    if (s.id === sheetId) return { ...s, anchors: { ...s.anchors, [key]: ref } };
    if (!s.anchors?.[key]) return s;
    const rest = { ...s.anchors };
    delete rest[key];
    return { ...s, anchors: rest };
  });
  return { ...wb, sheets, anchors: { ...wb.anchors, [key]: { sheet: sheetId, ref } } };
}

export function clearWorkbookAnchor(wb: WorkbookDoc, key: AnchorKey): WorkbookDoc {
  const anchors = { ...wb.anchors };
  delete anchors[key];
  const sheets = wb.sheets.map((s) => {
    if (!s.anchors?.[key]) return s;
    const rest = { ...s.anchors };
    delete rest[key];
    return { ...s, anchors: rest };
  });
  return { ...wb, sheets, anchors };
}
