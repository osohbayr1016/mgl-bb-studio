/**
 * exceljs-ийн ажлын хуудсыг render хийхэд бэлэн ХАВТГАЙ бүтэц болгоно
 * (`XlsxPreview.tsx`-ийн цэвэр хэсэг — компонентоос тусдаа тул тестлэгдэнэ).
 *
 * Хэмжээний тааз: мөр 3 000 / багана 80 тутамд хуудас бүр — түүнээс дээшийг
 * тасалж `truncatedRows/Cols`-оор мэдэгдэнэ (DOM-д 100 000 нүд хийхгүй).
 */
import type ExcelJSNs from 'exceljs';

export const MAX_ROWS = 3000;
export const MAX_COLS = 80;

export interface Cell {
  text: string;
  colSpan: number;
  rowSpan: number;
  /** Нэгтгэсэн мужийн зүүн дээд биш нүд — render хийхгүй. */
  covered: boolean;
  align: 'left' | 'right' | 'center';
  bold: boolean;
}

export interface SheetView {
  name: string;
  /** Баганын үсгүүд (A, B, …). */
  cols: string[];
  colWidths: number[];
  rows: { n: number; cells: Cell[] }[];
  truncatedRows: number;
  truncatedCols: number;
}

export function colLetter(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/**
 * exceljs-ийн нүдний утгыг ҮРГЭЛЖ мөр болгоно.  `cell.text`-д ИТГЭХГҮЙ:
 * холбоос (hyperlink) бүхий нүдний `text` нь xlsx-ээс уншихад rich text
 * объект (`{richText: […]}`), огноо эсвэл тоо байж болдог бөгөөд exceljs
 * түүнийг шууд буцаадаг — React объект рендерлэх гэж бүх preview-г унагадаг
 * байв (2026-09-28).  Томьёоны алдаа (`{error: '#DIV/0!'}`) ч «[object Object]»
 * болж харагддаг байв.
 */
export function valueText(v: unknown, depth = 0): string {
  if (v == null || depth > 4) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v !== 'object') return '';
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.richText)) {
    return o.richText.map((run) => valueText((run as { text?: unknown } | null)?.text, depth + 1)).join('');
  }
  // Холбоос: харагдах бичвэр нь `text` (өөрөө rich text / тоо / огноо байж болно).
  if ('hyperlink' in o) return valueText(o.text, depth + 1);
  // Томьёо: хадгалагдсан үр дүн.
  if ('formula' in o || 'sharedFormula' in o) return valueText(o.result, depth + 1);
  if ('error' in o) return valueText(o.error, depth + 1);
  if ('text' in o) return valueText(o.text, depth + 1);
  if ('result' in o) return valueText(o.result, depth + 1);
  return '';
}

function cellText(cell: ExcelJSNs.Cell): string {
  try {
    return valueText(cell.value);
  } catch {
    return '';
  }
}

export function toView(ws: ExcelJSNs.Worksheet): SheetView {
  const rowCount = Math.max(ws.actualRowCount, ws.rowCount);
  const colCount = Math.max(ws.actualColumnCount, ws.columnCount);
  const nRows = Math.min(rowCount, MAX_ROWS);
  const nCols = Math.min(colCount, MAX_COLS);

  // Нэгтгэсэн мужууд: зүүн дээд нүдэнд span, бусдыг нь `covered`.
  const spans = new Map<string, { colSpan: number; rowSpan: number }>();
  const covered = new Set<string>();
  const merges = (ws.model as { merges?: string[] }).merges ?? [];
  for (const range of merges) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
    if (!m) continue;
    const c1 = ws.getColumn(m[1]!).number;
    const r1 = Number(m[2]);
    const c2 = ws.getColumn(m[3]!).number;
    const r2 = Number(m[4]);
    spans.set(`${r1}:${c1}`, { colSpan: c2 - c1 + 1, rowSpan: r2 - r1 + 1 });
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r !== r1 || c !== c1) covered.add(`${r}:${c}`);
      }
    }
  }

  const rows: SheetView['rows'] = [];
  for (let r = 1; r <= nRows; r++) {
    const row = ws.getRow(r);
    const cells: Cell[] = [];
    for (let c = 1; c <= nCols; c++) {
      const key = `${r}:${c}`;
      const cell = row.getCell(c);
      const span = spans.get(key);
      const numeric =
        typeof cell.value === 'number' ||
        (typeof cell.value === 'object' &&
          cell.value != null &&
          'result' in cell.value &&
          typeof (cell.value as { result?: unknown }).result === 'number');
      const h = cell.alignment?.horizontal;
      cells.push({
        text: cellText(cell),
        colSpan: Math.min(span?.colSpan ?? 1, nCols - c + 1),
        rowSpan: Math.min(span?.rowSpan ?? 1, nRows - r + 1),
        covered: covered.has(key),
        align: h === 'center' || h === 'right' || h === 'left' ? h : numeric ? 'right' : 'left',
        bold: Boolean(cell.font?.bold),
      });
    }
    rows.push({ n: r, cells });
  }

  const cols: string[] = [];
  const colWidths: number[] = [];
  for (let c = 1; c <= nCols; c++) {
    cols.push(colLetter(c));
    // Excel-ийн өргөн нь «тэмдэгтийн тоо» — ~7px/тэмдэгт гэж хувиргана.
    const w = ws.getColumn(c).width;
    colWidths.push(Math.round(Math.min(Math.max((w ?? 9) * 7.2, 40), 480)));
  }
  return {
    name: ws.name,
    cols,
    colWidths,
    rows,
    truncatedRows: Math.max(0, rowCount - nRows),
    truncatedCols: Math.max(0, colCount - nCols),
  };
}
