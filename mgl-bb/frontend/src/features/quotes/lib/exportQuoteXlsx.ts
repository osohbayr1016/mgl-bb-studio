// Үнийн саналын ажлын дэвтрийг (WorkbookDoc) Excel болгож татах.
//
// Хэв маяг нь `features/qto/lib/exportXlsx.ts`-ийг дагана: exceljs-ийг зөвхөн
// export дарагдсан үед memoized dynamic import-оор ачаална (vite.config.ts-д
// тусдаа chunk-тай) ба Blob → objectURL → click → revokeObjectURL.
//
// v3 — олон worksheet: workbook-ийн хуудас бүрд `wb.addWorksheet(sheet.name)`
// нэмж, нүд/merge/colWidth/style-ийг ганц-хуудаст логикоор бичнэ. Томьёотой
// нүдэнд ТООЦООЛСОН утгыг (`valuesBySheet`) бичнэ — Excel рүү манай өөрсдийн
// функцууд (`TARIF()` …) хөрвөхгүй (#NAME? болно).

import type * as ExcelJSNs from 'exceljs';

import { hiddenGroupCols } from './optionalCols';
import type { CellRef, NamedSheet, NumFmt, SheetCell, SheetDoc, WorkbookDoc } from '../types/quotes';
import { brand } from '@/shared/config/brand';

type ExcelJSModule = typeof ExcelJSNs;

// exceljs ~700 KB — маршрутын chunk-д орохгүйгээр, export жинхэнэ дуудагдсан
// мөчид л ачаална.
let excelJsPromise: Promise<ExcelJSModule> | null = null;
const loadExcelJS = (): Promise<ExcelJSModule> => {
  if (!excelJsPromise) {
    excelJsPromise = import('exceljs')
      .then((m) => (m.default ?? m) as ExcelJSModule)
      // ⚠️ Унасан promise-ыг memo-д ҮЛДЭЭЖ БОЛОХГҮЙ: `if (!excelJsPromise)`
      //    хамгаалалт нь rejected promise-ыг ч truthy гэж үздэг тул сүлжээний
      //    түр саатлаар 930 kB-ийн chunk нэг удаа унавал дараагийн товшилтууд
      //    ганц ч хүсэлт явуулалгүй, ижил алдаагаар мөнхөд унана.
      .catch((err) => {
        excelJsPromise = null;
        throw err;
      });
  }
  return excelJsPromise;
};

/** Excel-ийн баганы өргөний нэгж ≈ px / 7 (Calibri 11 дэх «0» тэмдэгтийн өргөн). */
const PX_PER_UNIT = 7;

/** Хуудасны нэр хоосон/эвдэрсэн үеийн нөөц нэр. */
const FALLBACK_SHEET_NAME = 'Хуудас';

/** `NumFmt` → exceljs numFmt. 'text' нь формат тавихгүй (түүхий текст). */
const NUM_FMT: Record<NumFmt, string | null> = {
  text: null,
  '#,##0': '#,##0',
  '#,##0.00': '#,##0.00',
  '0%': '0%',
  '0.0%': '0.0%',
};

/** `CellStyle.bg` → дэвсгэрийн ARGB. Хэвлэмэлд саарал өнгөний шатлал. */
const BG_ARGB: Record<string, string> = {
  header: 'FFE5E7EB', // gray-200 — хүснэгтийн толгой
  group: 'FFF3F4F6', // gray-100 — бүлгийн мөр
  total: 'FFD1D5DB', // gray-300 — нийлбэрийн мөр
};

/** `CellStyle.color` → фонтын ARGB. index.css-ийн семантик токенуудын дүйцэл. */
const FG_ARGB: Record<string, string> = {
  danger: 'FFDC2626',
  success: 'FF12A67B', // --success: 160 84% 42%
  muted: 'FF6B7280',
};

const THIN_BORDER: ExcelJSNs.Borders = {
  top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  right: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  diagonal: {},
};

/** 'A1' / 'N28' / 'AA7' → 0-ээс эхэлсэн {r, c}. Танигдахгүй бол `null`. */
function parseRef(ref: CellRef): { r: number; c: number } | null {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref.trim());
  if (!m) return null;
  const letters = (m[1] ?? '').toUpperCase();
  const digits = m[2] ?? '';
  let col = 0;
  for (let i = 0; i < letters.length; i += 1) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  const row = Number(digits);
  if (!col || !row) return null;
  return { r: row - 1, c: col - 1 };
}

/**
 * Excel worksheet нэрийн хязгаарлалт: ≤31 тэмдэгт, `\ / ? * [ ] :` оруулж
 * болохгүй, давхардсан нэр байж болохгүй. Эдгээрийг цэвэрлэж, давхардсаныг
 * дугаарлана — exceljs алдаа шидэхээс сэргийлнэ.
 */
function sanitizeSheetName(name: string, used: Set<string>): string {
  let base = (name ?? '').replace(/[\\/?*[\]:]/g, ' ').trim();
  if (base.length > 31) base = base.slice(0, 31).trim();
  if (base === '') base = FALLBACK_SHEET_NAME;

  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n})`;
    const head = base.slice(0, Math.max(1, 31 - suffix.length)).trim();
    candidate = `${head}${suffix}`;
    n += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Нүдэнд бичих утгыг сонгоно.
 *
 * Томьёотой нүдэнд ТООЦООЛСОН утгыг бичнэ — Excel рүү томьёо хөрвүүлэхгүй
 * (`TARIF()` гэх мэт манай өөрсдийн функцууд Excel-д байхгүй тул #NAME? болно).
 */
function resolveValue(
  ref: CellRef,
  cell: SheetCell,
  values: Map<string, string | number | null>,
): string | number | null {
  if (values.has(ref)) return values.get(ref) ?? null;
  if (cell.f) return null; // тооцоологдоогүй томьёо — хоосон орхино
  return cell.v ?? null;
}

/** `SheetCell.s` + `fmt` → exceljs-ийн нүдний хэв маяг. */
function applyStyle(target: ExcelJSNs.Cell, cell: SheetCell): void {
  if (cell.fmt) {
    const fmt = NUM_FMT[cell.fmt];
    if (fmt) target.numFmt = fmt;
  }

  const s = cell.s;
  if (!s) return;

  const color = s.color && s.color !== 'default' ? FG_ARGB[s.color] : undefined;
  if (s.bold || s.italic || color) {
    target.font = {
      ...(s.bold ? { bold: true } : {}),
      ...(s.italic ? { italic: true } : {}),
      ...(color ? { color: { argb: color } } : {}),
    };
  }

  if (s.align || s.wrap) {
    target.alignment = {
      ...(s.align ? { horizontal: s.align } : {}),
      ...(s.wrap ? { wrapText: true } : {}),
      vertical: 'middle',
    };
  }

  if (s.bg && s.bg !== 'none') {
    const argb = BG_ARGB[s.bg];
    if (argb) {
      target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    }
  }

  if (s.border) target.border = THIN_BORDER;
}

/**
 * Нэг хуудсыг exceljs worksheet рүү бичнэ — баганы өргөн, нүд, хэв маяг, нэгтгэл.
 *
 * @param values Тухайн хуудасны томьёоны хөдөлгүүрийн ТООЦООЛСОН утгууд
 *               (CellRef → утга). Байхгүй бол хоосон map дамжуулна.
 */
function writeSheet(
  ws: ExcelJSNs.Worksheet,
  sheet: SheetDoc,
  values: Map<string, string | number | null>,
): void {
  /* Баганы өргөн — px → Excel нэгж. */
  const widths = sheet.colWidths ?? [];
  /**
   * PM-ийн тухайн саналд унтраасан сонгомол бүлгүүд («Өндөр» г.м.).
   *
   * ⚠️ Баганыг ОРХИХГҮЙ, НУУНА. Excel-д багана орхивол түүнээс баруун талын
   * бүх нүд ба `merges` нэг зүүн тийш шилжих ёстой болно — тэр зураглалыг
   * гараар барих нь нэгтгэл эвдэх магадлал өндөр. Нуулт нь ижил үр дүнг
   * (захиалагч харахгүй) эрсдэлгүйгээр өгнө. Дэлгэрэнгүйг
   * `lib/optionalCols.ts`-ээс үз — хэвлэх ба засварлагч мөн нэг эх сурвалжтай.
   */
  const hidden = hiddenGroupCols(sheet);
  for (let c = 0; c < sheet.cols; c += 1) {
    const col = ws.getColumn(c + 1);
    const px = widths[c];
    if (typeof px === 'number' && px > 0) {
      col.width = Math.max(1, Math.round((px / PX_PER_UNIT) * 100) / 100);
    }
    if (hidden.has(c)) {
      col.hidden = true;
      // `hidden` дангаараа хангалттай ч, зарим үзэгч (Google Sheets импорт)
      // түүнийг үл тоомсорлодог тул өргөнийг мөн 0 болгоно.
      col.width = 0;
    }
  }

  /* Нүд бүрийг бичнэ. rows/cols-оос гадуурхыг үл тоомсорлоно. */
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (!cell) continue;
    const pos = parseRef(ref);
    if (!pos) continue;
    if (pos.r < 0 || pos.c < 0 || pos.r >= sheet.rows || pos.c >= sheet.cols) continue;

    const target = ws.getCell(pos.r + 1, pos.c + 1);
    target.value = resolveValue(ref, cell, values);
    applyStyle(target, cell);
  }

  /* Нэгтгэлүүд — утгуудыг бичсэний ДАРАА (зүүн дээд нүдний утга үлдэнэ). */
  for (const m of sheet.merges) {
    const top = m.r + 1;
    const left = m.c + 1;
    const bottom = m.r + Math.max(1, m.rs);
    const right = m.c + Math.max(1, m.cs);
    if (top < 1 || left < 1 || bottom > sheet.rows || right > sheet.cols) continue;
    if (bottom === top && right === left) continue;
    try {
      ws.mergeCells(top, left, bottom, right);
    } catch {
      // Давхцсан/буруу нэгтгэл — экспортыг тасалдуулахгүй, алгасна.
    }
  }
}

/**
 * WorkbookDoc-ийг олон worksheet-тэй Excel файл болгож хөтчөөр татуулна.
 *
 * @param opts.workbook      Олон хуудаст ажлын дэвтэр (хуудас бүр = worksheet).
 * @param opts.valuesBySheet Хуудасны `id` → тухайн хуудасны ТООЦООЛСОН утгууд
 *                           (`evaluateWorkbook(...).bySheet`-ийн үр дүн).
 */
export async function exportQuoteXlsx(opts: {
  fileName: string;
  workbook: WorkbookDoc;
  valuesBySheet: Map<string, Map<string, string | number | null>>;
}): Promise<void> {
  const { fileName, workbook, valuesBySheet } = opts;
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();

  const sheets: NamedSheet[] = workbook.sheets ?? [];
  const usedNames = new Set<string>();

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sanitizeSheetName(sheet.name, usedNames));
    const values = valuesBySheet.get(sheet.id) ?? new Map<string, string | number | null>();
    writeSheet(ws, sheet, values);
  }

  // exceljs дор хаяж нэг worksheet шаарддаг — хоосон дэвтэрт нөөц хуудас нэмнэ.
  if (sheets.length === 0) {
    wb.addWorksheet(FALLBACK_SHEET_NAME);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default exportQuoteXlsx;
