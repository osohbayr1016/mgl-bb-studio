/**
 * Захиалагчийн гарын үсгийн мөргүй Word баримтад (RFI — захиалагч асууж, манай тал
 * хариулсан загвар) «Захиалагч хүлээн авсан» мөрийг НЭМНЭ (эзний шийдвэр 2026-10-12).
 *
 * Бодит RFI-уудад хэмжсэн: захиалагчийн «Хүсэлт гаргасан» мөрөнд гарын үсгийн нүд
 * огт байдаггүй (зөвхөн хаяг/WeChat), харин CR загварт «Захиалагчаас баталсан» мөр бий.
 *
 * Дүрэм (цэвэр XML, `docxSign.ts`-ийн задлагчийг дахин ашиглана):
 *   • захиалагчийн мөр (`client`) аль хэдийн байвал — юу ч хийхгүй (`HAS_CLIENT_ROW`);
 *   • баримтын СҮҮЛИЙН «багана» хэлбэрийн гарын үсгийн блокийн сүүлийн мөрийн БҮТЦИЙГ
 *     (нүднүүдийн `tcPr` — өргөн, хүрээ, дүүргэлт; мөрийн өндөр) хуулж, бичвэр/зураггүй
 *     шинэ мөр болгоно — тиймээс хүснэгтийн сүлжээ (gridSpan) ЯГ таарна;
 *   • үүргийн нүдэнд «Захиалагч хүлээн авсан: (Received by client)» (тэр баганын өөр
 *     шошгоны үсгийн хэлбэрээр), бусад нүд хоосон — захиалагч зурахад нэр/албан тушаал/
 *     огноо нь гарын үсэгтэй хамт бөглөгдөнө (`stampDocumentXml`);
 *   • босоо нэгтгэлийг (vMerge) хуулахгүй; сүүлийн мөрийн хайрцаг доош нэгтгэгдсэн бол
 *     нэгтгэлийн ДАРАА оруулна;
 *   • «мөрөн дотор» хэлбэрийн маягт (зөвлөхийн RFI) — оруулах газар тодорхойгүй тул
 *     `NO_TABLE` (таамаглахгүй).
 * Баримтын бусад байт хөндөгдөхгүй (зөвхөн мөр оруулна).
 */
import { escapeXmlText, findSignatureSlots, parseTables, type DocxCell, type DocxTable } from './docxSign';

export const CLIENT_ROW_LABEL_MN = 'Захиалагч хүлээн авсан:';
export const CLIENT_ROW_LABEL_EN = '(Received by client)';

export type AppendClientRowResult =
  | { ok: true; xml: string; table: number; row: number }
  | { ok: false; reason: 'HAS_CLIENT_ROW' | 'NO_TABLE' };

const TCPR_RE = /^<w:tc\b[^>]*>\s*(<w:tcPr\/>|<w:tcPr>[\s\S]*?<\/w:tcPr>)/;
const PPR_RE = /<w:p\b[^>]*>\s*(<w:pPr>[\s\S]*?<\/w:pPr>|<w:pPr\/>)/;
const RUN_RPR_RE = /<w:r\b[^>]*>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)\s*<w:t\b/;

function stripVMerge(tcPr: string): string {
  return tcPr.replace(/<w:vMerge\b[^>]*\/>/g, '').replace(/<w:vMerge\b[^>]*>[\s\S]*?<\/w:vMerge>/g, '');
}

/** Тэмдэглэл/засварын элементийг (rPrChange г.м.) хуулахгүй. */
function cleanRPr(rPr: string): string {
  return rPr.replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/g, '');
}

function cleanPPr(pPr: string): string {
  // Дугаарлалт / хуудас таслалт / догол мөрийн өөрчлөлтийн түүхийг шинэ хоосон мөрөнд авчрахгүй.
  return pPr
    .replace(/<w:numPr>[\s\S]*?<\/w:numPr>/g, '')
    .replace(/<w:pageBreakBefore\b[^>]*\/>/g, '')
    .replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/g, '')
    .replace(/<w:rPr>[\s\S]*?<\/w:rPr>/g, '');
}

function cellParts(xml: string, cell: DocxCell): { tcPr: string; pPr: string; rPr: string } {
  const slice = xml.slice(cell.start, cell.end);
  const tcPr = TCPR_RE.exec(slice)?.[1] ?? '<w:tcPr/>';
  const pPr = PPR_RE.exec(slice)?.[1] ?? '';
  const rPr = RUN_RPR_RE.exec(slice)?.[1] ?? '';
  return { tcPr: stripVMerge(tcPr), pPr: cleanPPr(pPr), rPr: cleanRPr(rPr) };
}

function paragraph(pPr: string, text: string, rPr: string): string {
  const run = text ? `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>` : '';
  return `<w:p>${pPr}${run}</w:p>`;
}

/** Хоёр нүд сүлжээний баганаар давхцах эсэх. */
function overlaps(a: { c0: number; c1: number }, b: { c0: number; c1: number }): boolean {
  return Math.max(a.c0, b.c0) < Math.min(a.c1, b.c1);
}

export function appendClientRowXml(xml: string): AppendClientRowResult {
  const tables = parseTables(xml);
  const slots = findSignatureSlots(tables);
  if (slots.some((s) => s.client)) return { ok: false, reason: 'HAS_CLIENT_ROW' };
  const column = slots.filter((s) => s.pattern === 'column');
  if (column.length === 0) return { ok: false, reason: 'NO_TABLE' };
  const last = column.reduce((a, b) => (b.table > a.table || (b.table === a.table && b.row > a.row) ? b : a));
  const table: DocxTable | undefined = tables.find((t) => t.index === last.table);
  const template = table?.rows[last.row];
  if (!table || !template) return { ok: false, reason: 'NO_TABLE' };

  // Сүүлийн мөрийн хайрцаг (эсвэл бусад нүд) доош нэгтгэгдсэн бол нэгтгэлийн дараа оруулна.
  let after = last.row;
  while (after + 1 < table.rows.length) {
    const next = table.rows[after + 1]!;
    const continues = next.cells.some(
      (c) => c.vMerge === 'continue' && template.cells.some((t) => overlaps(t, c) && (t.vMerge === 'restart' || t.vMerge === 'continue')),
    );
    if (!continues) break;
    after++;
  }
  const insertAt = table.rows[after]!.end;

  // Үүргийн нүд = мөрийн эхний нүд (хайрцгийн зүүн талд).  Үсгийн хэлбэрийг тэр баганын
  // бичвэртэй хамгийн ойрын шошгоноос авна (vMerge-ийн үргэлжлэл нүд хоосон байдаг).
  const labelCell = template.cells[0] && template.cells[0] !== last.box && template.cells[0].c1 <= last.box.c0 ? template.cells[0] : null;
  let labelStyle: { pPr: string; rPr: string } | null = null;
  if (labelCell) {
    for (let ri = last.row; ri >= 0 && !labelStyle; ri--) {
      const c = table.rows[ri]?.cells.find((x) => x.c0 === labelCell.c0);
      if (c && c.text.trim()) {
        const p = cellParts(xml, c);
        if (p.rPr) labelStyle = { pPr: p.pPr, rPr: p.rPr };
      }
    }
  }

  const cells = template.cells.map((cell) => {
    const parts = cellParts(xml, cell);
    if (cell === labelCell) {
      const style = labelStyle ?? { pPr: parts.pPr, rPr: parts.rPr || (cell.darkFill ? '<w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr>' : '') };
      return `<w:tc>${parts.tcPr}${paragraph(style.pPr, CLIENT_ROW_LABEL_MN, style.rPr)}${paragraph(style.pPr, CLIENT_ROW_LABEL_EN, style.rPr)}</w:tc>`;
    }
    return `<w:tc>${parts.tcPr}${paragraph(parts.pPr, '', '')}</w:tc>`;
  });

  const trSlice = xml.slice(template.start, template.end);
  const trOpen = /^<w:tr\b[^>]*>/.exec(trSlice)?.[0] ?? '<w:tr>';
  // w14:paraId / textId нь баримтад ГАНЦ байх ёстой — хуулбарт оруулахгүй.
  const trTag = trOpen.replace(/\s+w14:(?:paraId|textId)="[^"]*"/g, '');
  const trPr = template.trPr ? xml.slice(template.trPr.start, template.trPr.end) : '';
  const newRow = `${trTag}${trPr}${cells.join('')}</w:tr>`;

  return { ok: true, xml: xml.slice(0, insertAt) + newRow + xml.slice(insertAt), table: table.index, row: after + 1 };
}
