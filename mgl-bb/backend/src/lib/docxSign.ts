/**
 * Word (.docx) баримт дээрх ГАРЫН ҮСГИЙН НҮДИЙГ олж, тэнд профайлын гарын
 * үсгийг суулгах — ЦЭВЭР функцууд (`word/document.xml` мөр дээр).  Байт/ZIP
 * нь `lib/docxSignFile.ts`, Drive/D1 нь `lib/driveSigning.ts` +
 * `routes/driveSigning.ts`.
 *
 * Эзний хүсэлт (2026-10-01): «Баримт бичиг» дээрх RFI-д ажилтан профайлын
 * гарын үсгээрээ НЭГ товчоор зурж, дараа нь захирал НЭГ товчоор батална;
 * гарын үсэг ФАЙЛ ДЭЭР суугаад Drive-д хадгалагдана (хэвлэх, PDF, явуулах).
 *
 * Хоёр хэлбэрийг таньдаг — бодит 40 RFI (прод R2, 2026-10-01) дээр хэмжсэн:
 *
 *   1. «БАГАНА» (MGL-ийн RFI загвар, 2026-09-аас):
 *        | Хариу илгээсэн: | Албан тушаал | Овог нэр | Хаяг | Гарын үсэг | Огноо |   ← толгой мөр
 *        |                 | Архитектор   | Б.Эрдэнэ | …    |  [нүд]     | …     |   ← гарын үсгийн мөр
 *        | Хянасан:        | Захирал      | Б.Билгүүн| …    |  [нүд]     | …     |
 *      Толгой мөрөнд «Гарын үсэг (Signature)» багана + дор хаяж нэг өөр баганын
 *      толгой (Албан тушаал / Овог нэр / Огноо) байна; доорх мөр бүр нэг нүд.
 *   2. «МӨРӨН ДОТОР» (зөвлөх/гүйцэтгэгчийн маягт):
 *        | Prepared by: Бэлтгэсэн: | Ц.Эрдэнэболд Name/Нэр | Signature/ Гарын үсэг |
 *      Шошготой нүд ӨӨРӨӨ гарын үсгийн хайрцаг; үүргийн шошго зүүн талд.
 *
 * Гарын үсгийн хайрцагт аль хэдийн ЗУРАГ байвал «зурагдсан»: манай суулгасан
 * зураг `wp:docPr name="mgl-sign-…"` тэмдэгтэй (Word хадгалахад хэвээр үлддэг)
 * тул хэн, хэзээ гэдгийг D1-ийн бичлэгтэй холбоно; тэмдэггүй зураг = гараар
 * оруулсан (`other`).
 *
 * Ажилладаг ГАНЦ зарчим: зөвхөн ХООСОН нүдийг бөглөнө — хүний бичсэн бичвэр,
 * өөр хүний гарын үсгийг ХЭЗЭЭ Ч дарж бичихгүй.  Засварууд нь offset-оор
 * (араас нь урагш) хийгдэх тул баримтын бусад хэсэг БАЙТ-ИЖИЛ үлдэнэ.
 */

/* ------------------------------------------------------------------ */
/*  Бүтэц                                                              */
/* ------------------------------------------------------------------ */

export interface Span {
  /** `xml` доторх үнэмлэхүй эхлэл (оролцоно). */
  start: number;
  /** Төгсгөл (оролцохгүй). */
  end: number;
}

export interface DocxCell extends Span {
  /** Хүснэгтийн сүлжээний багана [c0, c1). */
  c0: number;
  c1: number;
  vMerge: 'restart' | 'continue' | null;
  /** Хэвийжүүлсэн бичвэр (мөр/зай нэг зай болно). */
  text: string;
  hasDrawing: boolean;
  /** Манай суулгасан гарын үсгийн тэмдэг (`mgl-sign-…`). */
  marks: string[];
  /**
   * Тэмдэггүй атлаа манай `descr="MGL ERP · …"`-тэй зураг — Google Docs (Office горим)
   * файлыг дахин хадгалахад `wp:docPr name`-ийг «image2.png» болгож тэмдгийг устгадаг,
   * харин `descr` үлддэг (MGL-WT-CR-002, 2026-10-12).
   */
  erpDescrs: string[];
  /** Нүдний дүүргэлт бараан (хар-хөх толгой г.м.) — хэзээ ч гарын үсгийн хайрцаг биш. */
  darkFill: boolean;
  /** Өргөн (twip): `tcW` (dxa) эсвэл сүлжээний баганын нийлбэр. */
  widthTwips: number | null;
}

export interface DocxRow extends Span {
  cells: DocxCell[];
  /** `<w:trPr>…</w:trPr>`-ийн байрлал (байвал). */
  trPr: Span | null;
}

export interface DocxTable extends Span {
  /** Баримт дахь хүснэгтийн дараалал (гадна, дотор — нээгдсэн дарааллаар). */
  index: number;
  grid: number[];
  rows: DocxRow[];
}

export type SlotState = 'empty' | 'erp' | 'other';
export type SlotPattern = 'column' | 'inline';

export interface SignSlot {
  /** Тогтвортой түлхүүр: `t{хүснэгт}r{мөр}c{багана}`. */
  key: string;
  table: number;
  row: number;
  pattern: SlotPattern;
  /** Ижил толгой/мөрийн бүлэг (UI бүлэглэлт) — баримтын дараалал. */
  group: number;
  /** «Хариу илгээсэн: (Replied by)» гэх мэт — мөрийн үүрэг. */
  role: string;
  position: string;
  name: string;
  date: string;
  /** Захирлын (батлах) мөр — зөвхөн батлагч зурна. */
  approver: boolean;
  /**
   * Захиалагчийн мөр («Захиалагчаас баталсан: (Approved by client)») — ERP-ийн
   * ажилтан хэн ч зурахгүй, захирлын «Батлах» ч тийш очихгүй.
   */
  client: boolean;
  state: SlotState;
  /** `state === 'erp'` үед манай тэмдэг (Google тэмдгийг устгасан бол null). */
  mark: string | null;
  /** Тэмдэггүй ERP гарын үсгийн `descr` («MGL ERP · Нэр · Албан тушаал · ISO») — хэн гэдгийг тулгахад. */
  erpDescr: string | null;
  /** Гарын үсгийн хайрцаг. */
  box: DocxCell;
  posCell: DocxCell | null;
  nameCell: DocxCell | null;
  dateCell: DocxCell | null;
  rowSpan: Span;
  rowTrPr: Span | null;
}

/* ------------------------------------------------------------------ */
/*  XML туслахууд                                                      */
/* ------------------------------------------------------------------ */

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, g: string) => {
    if (g[0] === '#') {
      const code = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITY[g] ?? m;
  });
}

export function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttr(s: string): string {
  return escapeXmlText(s).replace(/"/g, '&quot;');
}

export function normalizeSpace(s: string): string {
  return s.replace(/[\s\u00a0\u200b]+/g, ' ').trim();
}

/** Нүд/хэсгийн бичвэр — `<w:t>` + таб/мөр таслалт зай; догол мөрүүд зайгаар. */
function textOf(fragment: string): string {
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(?:tab|br|cr)\b[^>]*\/>|<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) {
    if (m[1] !== undefined) parts.push(decodeXmlText(m[1]));
    else parts.push(' ');
  }
  return normalizeSpace(parts.join(''));
}

function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name.replace(':', '\\:')}="([^"]*)"`).exec(tag);
  return m ? (m[1] ?? null) : null;
}

/** Манай гарын үсгийн зургийн «Alt text» (`routes/driveSigning.ts` бичдэг: «MGL ERP · Нэр · …»). */
const ERP_DESCR_RE = /^MGL ERP\b/;

/**
 * `tcPr`-ийн `w:shd w:fill` бараан эсэх (харьцангуй гэрэлтэлт < 0.45).  MGL-ийн RFI/CR
 * загварын толгой мөр хар-хөх (#0F243E) дүүргэлттэй, цагаан бичигтэй — тэнд суусан хар
 * бэхтэй гарын үсэг ХАРАГДАХГҮЙ (MGL-WT-CR-002, 2026-10-12).
 */
function isDarkFill(tcPr: string): boolean {
  const shd = /<w:shd\b[^>]*\/?>/.exec(tcPr)?.[0];
  if (!shd) return false;
  const fill = attrOf(shd, 'w:fill') ?? '';
  if (!/^[0-9a-fA-F]{6}$/.test(fill)) return false;
  const r = parseInt(fill.slice(0, 2), 16);
  const g = parseInt(fill.slice(2, 4), 16);
  const b = parseInt(fill.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.45;
}

/* ------------------------------------------------------------------ */
/*  Хүснэгт задлагч                                                    */
/* ------------------------------------------------------------------ */

interface OpenTbl {
  kind: 'tbl';
  start: number;
  headEnd: number;
  index: number;
  rows: DocxRow[];
}
interface OpenTr {
  kind: 'tr';
  start: number;
  headEnd: number;
  cells: Array<{ start: number; end: number; slice: string }>;
}
interface OpenTc {
  kind: 'tc';
  start: number;
}

/** Баримт дахь БҮХ хүснэгт (дотор хүснэгт ч) — нээгдсэн дарааллаар. */
export function parseTables(xml: string): DocxTable[] {
  const out: DocxTable[] = [];
  const stack: Array<OpenTbl | OpenTr | OpenTc> = [];
  const re = /<(\/?)w:(tbl|tr|tc)(?=[\s>/])[^>]*>/g;
  let tableCounter = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const closing = m[1] === '/';
    const kind = m[2] as 'tbl' | 'tr' | 'tc';
    const tag = m[0];
    if (!closing && tag.endsWith('/>')) continue; // хоосон өөрөө хаагдсан (хүчингүй) — алгасна
    if (!closing) {
      const headEnd = m.index + tag.length;
      if (kind === 'tbl') stack.push({ kind, start: m.index, headEnd, index: tableCounter++, rows: [] });
      else if (kind === 'tr') stack.push({ kind, start: m.index, headEnd, cells: [] });
      else stack.push({ kind, start: m.index });
      continue;
    }
    const end = m.index + tag.length;
    const top = stack.pop();
    if (!top || top.kind !== kind) throw new Error(`docx: unbalanced <w:${kind}>`);
    if (top.kind === 'tc') {
      const parent = stack[stack.length - 1];
      if (parent && parent.kind === 'tr') parent.cells.push({ start: top.start, end, slice: xml.slice(top.start, end) });
    } else if (top.kind === 'tr') {
      const parent = stack[stack.length - 1];
      if (parent && parent.kind === 'tbl') parent.rows.push(buildRow(xml, top, end));
    } else {
      const grid = parseGrid(xml, top.headEnd, top.rows[0]?.start ?? end);
      const table: DocxTable = { start: top.start, end, index: top.index, grid, rows: top.rows };
      assignColumns(table);
      out.push(table);
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function parseGrid(xml: string, from: number, to: number): number[] {
  const head = xml.slice(from, to);
  const g = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(head);
  if (!g?.[1]) return [];
  // `tblGridChange` доторх хуучин сүлжээг тоолохгүй.
  const body = g[1].replace(/<w:tblGridChange\b[\s\S]*?<\/w:tblGridChange>/g, '');
  return [...body.matchAll(/<w:gridCol\b[^>]*>/g)].map((x) => {
    const w = attrOf(x[0], 'w:w');
    const n = w ? parseFloat(w) : NaN;
    return Number.isFinite(n) ? n : 0;
  });
}

function buildRow(xml: string, tr: OpenTr, end: number): DocxRow {
  const firstCell = tr.cells[0]?.start ?? end;
  const head = xml.slice(tr.headEnd, firstCell);
  const trPrM = /<w:trPr>[\s\S]*?<\/w:trPr>|<w:trPr\/>/.exec(head);
  const trPr = trPrM ? { start: tr.headEnd + trPrM.index, end: tr.headEnd + trPrM.index + trPrM[0].length } : null;
  const cells: DocxCell[] = tr.cells.map((c) => {
    const tcPrM = /^<w:tc\b[^>]*>\s*(<w:tcPr\/>|<w:tcPr>[\s\S]*?<\/w:tcPr>)/.exec(c.slice);
    const tcPr = tcPrM?.[1] ?? '';
    const spanM = /<w:gridSpan\b[^>]*w:val="(\d+)"/.exec(tcPr);
    const vmM = /<w:vMerge\b([^>]*)\/>/.exec(tcPr);
    let vMerge: DocxCell['vMerge'] = null;
    if (vmM) vMerge = attrOf(vmM[0], 'w:val') === 'restart' ? 'restart' : 'continue';
    const wM = /<w:tcW\b[^>]*\/>/.exec(tcPr);
    let width: number | null = null;
    if (wM && (attrOf(wM[0], 'w:type') ?? 'dxa') === 'dxa') {
      const w = parseFloat(attrOf(wM[0], 'w:w') ?? '');
      if (Number.isFinite(w) && w > 0) width = w;
    }
    const marks: string[] = [];
    const erpDescrs: string[] = [];
    for (const dp of c.slice.matchAll(/<wp:docPr\b[^>]*>/g)) {
      const name = attrOf(dp[0], 'name') ?? '';
      if (/^mgl-sign-[A-Za-z0-9_-]+$/.test(name)) {
        marks.push(name);
        continue;
      }
      const descr = decodeXmlText(attrOf(dp[0], 'descr') ?? '');
      if (ERP_DESCR_RE.test(descr)) erpDescrs.push(descr);
    }
    return {
      start: c.start,
      end: c.end,
      c0: 0,
      c1: Number(spanM?.[1] ?? '1') || 1,
      vMerge,
      text: textOf(c.slice),
      hasDrawing: /<w:drawing\b|<w:pict\b/.test(c.slice),
      marks,
      erpDescrs,
      darkFill: isDarkFill(tcPr),
      widthTwips: width,
    };
  });
  // `gridBefore` — мөр сүлжээний хэдэн баганаас эхлэх.
  const gb = trPrM ? /<w:gridBefore\b[^>]*w:val="(\d+)"/.exec(trPrM[0]) : null;
  let col = Number(gb?.[1] ?? '0') || 0;
  for (const cell of cells) {
    const span = cell.c1; // түр — span-ийг c1-д хадгалсан
    cell.c0 = col;
    cell.c1 = col + span;
    col = cell.c1;
  }
  return { start: tr.start, end, cells, trPr };
}

function assignColumns(table: DocxTable): void {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.widthTwips == null && table.grid.length >= cell.c1) {
        let w = 0;
        for (let i = cell.c0; i < cell.c1; i++) w += table.grid[i] ?? 0;
        cell.widthTwips = w > 0 ? w : null;
      }
    }
  }
}

const edgeCache = new WeakMap<DocxTable, number[]>();

/**
 * Сүлжээний шугамуудын байрлал (twip): `edges[i]` = i-р баганын зүүн ирмэг.
 * Давхцлыг БАГАНЫН ТООГООР биш, ӨРГӨНӨӨР хэмжихэд хэрэгтэй — Word хоёр мөрийн
 * хилийг хэдхэн twip зөрүүлэхэд 15 twip-ийн нарийн багана үүсгэдэг (ORSH-RFI-007,
 * 2026-10-05): толгойн «Гарын үсэг» [4,6) = нарийн + гарын үсэг, доорх мөрийн
 * «Ирсэн хаяг» [3,5) = хаяг + нарийн.  Баганаар тоолбол хоёулаа 1 багана давхцаж
 * хаяг (эхнийх) ялж, гарын үсэг хаягийн нүдэнд суудаг байв.
 * Сүлжээ дутуу (`tblGrid` байхгүй/богино) эсвэл өргөн нь тэг бол 1 багана = 1 нэгж.
 */
function gridEdges(table: DocxTable): number[] {
  const hit = edgeCache.get(table);
  if (hit) return hit;
  let cols = table.grid.length;
  for (const r of table.rows) for (const c of r.cells) cols = Math.max(cols, c.c1);
  const twips = table.grid.length >= cols && table.grid.slice(0, cols).reduce((s, w) => s + w, 0) > 0;
  const edges = [0];
  for (let i = 0; i < cols; i++) edges.push(edges[i]! + (twips ? Math.max(0, table.grid[i] ?? 0) : 1));
  edgeCache.set(table, edges);
  return edges;
}

function spanWidth(edges: readonly number[], c0: number, c1: number): number {
  return c1 > c0 ? (edges[c1] ?? 0) - (edges[c0] ?? 0) : 0;
}

function overlap(edges: readonly number[], a: { c0: number; c1: number }, b: { c0: number; c1: number }): number {
  return spanWidth(edges, Math.max(a.c0, b.c0), Math.min(a.c1, b.c1));
}

/** Мөрийн тэр сүлжээний муж дээрх нүд (өргөнөөр хамгийн их давхцалтай). */
function cellOver(table: DocxTable, row: DocxRow, ref: { c0: number; c1: number }): DocxCell | null {
  const edges = gridEdges(table);
  let best: DocxCell | null = null;
  let bestOv = 0;
  for (const c of row.cells) {
    const ov = overlap(edges, c, ref);
    if (ov > bestOv) {
      best = c;
      bestOv = ov;
    }
  }
  return best;
}

/** Нүдний өргөний хэдэн хувь нь `ref` баганын доор байна (0–1). */
function coverage(table: DocxTable, cell: DocxCell, ref: { c0: number; c1: number }): number {
  const edges = gridEdges(table);
  const w = spanWidth(edges, cell.c0, cell.c1);
  return w > 0 ? overlap(edges, cell, ref) / w : 0;
}

/* ------------------------------------------------------------------ */
/*  Шошго таних                                                         */
/* ------------------------------------------------------------------ */

// ⚠️ Кирилл үсгийн хажууд ASCII `\b` ҮҮСДЭГГҮЙ — латин үгэнд л хэрэглэнэ.
const SIG_LABEL_RE = /гарын\s*үсэг|signature/i;
const POS_HDR_RE = /албан\s*тушаал|\bposition\b/i;
const NAME_HDR_RE = /овог\s*нэр|\bfull\s*name\b|\bname\b|(^|[\s/(])нэр($|[\s:/)])/i;
const DATE_HDR_RE = /огноо|өдөр|\bdate\b/i;
const ROLE_RE =
  /хүсэлт\s*гаргасан|хариу\s*илгээсэн|бэлтгэсэн|хянасан|баталсан|батласан|хүргүүлсэн|илгээсэн|зөвшөөрсөн|\bprepared\b|\breplied\b|\breviewed\b|\bapproved\b|\bchecked\b|\bissued\b|\bsent\s+by\b|\bverified\b/i;
const APPROVER_ROLE_RE = /хянасан|баталсан|батласан|батлав|зөвшөөрсөн|\bapproved\b|\breviewed\b|\bconfirmed\b|\bauthori[sz]ed\b/i;
const DIRECTOR_RE = /захирал|\bdirector\b|\bceo\b/i;
/**
 * Захиалагчийн мөр — CR загварын «Захиалагчаас баталсан: (Approved by client)».
 * ERP-ийн ажилтан захиалагчийн өмнөөс зурахгүй (захиалагч «Баримт бичиг»-т ордоггүй).
 */
const CLIENT_ROLE_RE = /захиалагч|\bclient\b|\bcustomer\b|\bemployer\b/i;
/** Толгой/тайлбар үгс — «цэвэр шошго» эсэхийг шалгахад хасна. */
const CAPTION_WORDS_RE =
  /гарын|үсэг|signature|\bsign\b|албан|тушаал|position|овог|нэр|full|name|огноо|өдөр|date|yyyy|mm|dd|хаяг|address|e-?mail|mail|ирсэн|илгээсэн|хариу|өгсөн|sent|received|revision|submition|submission|[():/.,\s-]/gi;
/**
 * MGL загварын «Монгол: (English)» шошгоны хаалтан доторх ЛАТИН тайлбар — үсгийн
 * алдаатай ч («(Perpared by)», «(Sign)») шошгоны хэсэг.  Өмнө нь «Гарын үсэг: (Sign)»
 * цэвэр толгой гэж танигдаагүй тул CR загварын гарын үсэг толгой нүдэнд суудаг байв.
 */
const LATIN_GLOSS_RE = /\(\s*[A-Za-z][A-Za-z0-9 .,:;/'&-]*\)/g;

const MAX_LABEL_LEN = 48;
/** Гарын үсгийн хайрцгийн өргөний доод тал нь толгойн баганын доор байх хувь. */
const MIN_BOX_COVERAGE = 2 / 3;

function isShortLabel(text: string, re: RegExp): boolean {
  return text.length > 0 && text.length <= MAX_LABEL_LEN && re.test(text);
}

/** Шошгоос бусад агуулга (хүний нэр г.м.) үлдэхгүй бол «цэвэр толгой». */
function isPureCaption(text: string, re: RegExp): boolean {
  if (!isShortLabel(text, re)) return false;
  return text.replace(LATIN_GLOSS_RE, ' ').replace(CAPTION_WORDS_RE, '').length <= 1;
}

/**
 * Баганын толгойн «Албан тушаал» / «Огноо» шошго.  «Нэр» ЗОРИУД ороогүй — зөвлөхийн
 * мөрөн дотрох маягтад хоосон «Name/ Нэр» тайлбар гарын үсгийн хайрцгийн хажууд байдаг.
 */
function isPosOrDateCaption(text: string): boolean {
  return isPureCaption(text, POS_HDR_RE) || isPureCaption(text, DATE_HDR_RE);
}

/** «Ц.Эрдэнэболд Name/ Нэр» → «Ц.Эрдэнэболд». */
export function stripNameCaption(text: string): string {
  return normalizeSpace(
    text
      .replace(/\(?\s*full\s*name\s*\)?/gi, ' ')
      .replace(/\bname\s*\/\s*нэр\b|name\s*\/\s*нэр/gi, ' ')
      .replace(/(^|\s)(name|нэр)\s*[:/]?(?=\s|$)/gi, ' ')
      .replace(/\s*\/\s*$/, ''),
  );
}

function isClientRole(role: string): boolean {
  return CLIENT_ROLE_RE.test(role);
}

function isApprover(role: string, position: string): boolean {
  if (isClientRole(role)) return false;
  if (DIRECTOR_RE.test(position)) return true;
  return position.trim() === '' && APPROVER_ROLE_RE.test(role);
}

function slotStateOf(box: DocxCell): { state: SlotState; mark: string | null; erpDescr: string | null } {
  if (box.marks.length > 0) return { state: 'erp', mark: box.marks[box.marks.length - 1] ?? null, erpDescr: null };
  if (box.erpDescrs.length > 0) return { state: 'erp', mark: null, erpDescr: box.erpDescrs[box.erpDescrs.length - 1] ?? null };
  if (box.hasDrawing) return { state: 'other', mark: null, erpDescr: null };
  return { state: 'empty', mark: null, erpDescr: null };
}

/**
 * «MGL ERP · Мөнхбат Монголжин · Төслийн менежер · 2026-10-12T00:36:15.815Z» →
 * нэр + агшин.  Бүтэц таарахгүй бол null.
 */
export function parseErpDescr(descr: string): { name: string; at: string } | null {
  const parts = descr.split(/\s*·\s*/);
  if (parts.length < 3 || !ERP_DESCR_RE.test(parts[0] ?? '')) return null;
  const at = parts[parts.length - 1] ?? '';
  const name = (parts[1] ?? '').trim();
  if (!name || !Number.isFinite(Date.parse(at))) return null;
  return { name, at };
}

/* ------------------------------------------------------------------ */
/*  Гарын үсгийн нүд олох                                               */
/* ------------------------------------------------------------------ */

export function findSignatureSlots(tables: readonly DocxTable[]): SignSlot[] {
  const slots: SignSlot[] = [];
  const used = new Set<string>();
  let group = 0;
  for (const table of tables) {
    for (let ri = 0; ri < table.rows.length; ri++) {
      const row = table.rows[ri]!;
      for (const head of row.cells) {
        if (!isShortLabel(head.text, SIG_LABEL_RE)) continue;
        const headKey = `t${table.index}r${ri}c${head.c0}`;
        if (used.has(headKey)) continue;
        const column = columnSlots(table, ri, head, group);
        if (column.length > 0) {
          for (const s of column) {
            if (used.has(s.key)) continue;
            used.add(s.key);
            slots.push(s);
          }
          group++;
          continue;
        }
        const inline = inlineSlot(table, ri, head, group);
        if (inline) {
          used.add(inline.key);
          slots.push(inline);
          group++;
        }
      }
    }
  }
  return slots.sort((a, b) => a.table - b.table || a.row - b.row || a.box.c0 - b.box.c0);
}

/** Хэлбэр 1 — «Гарын үсэг» нь баганын толгой. */
function columnSlots(table: DocxTable, hi: number, head: DocxCell, group: number): SignSlot[] {
  const row = table.rows[hi]!;
  const others = row.cells.filter((c) => c !== head);
  const posH = others.find((c) => isPureCaption(c.text, POS_HDR_RE)) ?? null;
  const nameH = others.find((c) => c !== posH && isPureCaption(c.text, NAME_HDR_RE)) ?? null;
  const dateH = others.find((c) => c !== posH && c !== nameH && isPureCaption(c.text, DATE_HDR_RE)) ?? null;
  if (!posH && !nameH && !dateH) return [];
  if (!isPureCaption(head.text, SIG_LABEL_RE)) return [];

  // Мөрийн үүргийн багана: толгой мөрийн эхний нүд, хэрэв баганын толгой биш бол.
  const first = row.cells[0] ?? null;
  const labelCol =
    first && first !== head && first !== posH && first !== nameH && first !== dateH && first.c1 <= head.c0
      ? { c0: first.c0, c1: first.c1 }
      : null;
  let lastLabel = labelCol && first ? first.text : '';

  const out: SignSlot[] = [];
  for (let ri = hi + 1; ri < table.rows.length; ri++) {
    const r = table.rows[ri]!;
    // Дараагийн толгой мөр — энэ блок дууслаа.
    if (r.cells.some((c) => isShortLabel(c.text, SIG_LABEL_RE))) break;
    if (r.cells.some((c) => isPureCaption(c.text, POS_HDR_RE) || isPureCaption(c.text, DATE_HDR_RE))) break;
    const box = cellOver(table, r, head);
    if (!box) break;
    // Хоёр мөр өндөр нэгтгэсэн хайрцгийн доод хэсэг — тусдаа нүд биш.
    if (box.vMerge === 'continue') continue;
    // Бүтэн өргөнөөр сунасан мөр (шинэ хэсгийн гарчиг г.м.) — блок дууслаа.
    if (box.c0 < head.c0 - 1 || box.c1 > head.c1 + 1) break;
    // Нүд нь гарын үсгийн баганын доор ДИЙЛЭНХДЭЭ байх ёстой — энэ мөрөнд гарын
    // үсгийн нүдийг хөрш баганатай (хаяг г.м.) нэгтгэсэн бол тэр нүд хайрцаг биш.
    if (coverage(table, box, head) < MIN_BOX_COVERAGE) continue;
    let role = lastLabel;
    if (labelCol) {
      const lc = cellOver(table, r, labelCol);
      if (lc && lc !== box && lc.vMerge !== 'continue' && lc.text) role = lc.text;
    }
    lastLabel = role;
    // Бараан дүүргэлттэй нүд (дэд гарчиг г.м.) — хар бэх харагдахгүй, хайрцаг биш.
    if (box.darkFill) continue;
    const posCell = posH ? cellOver(table, r, posH) : null;
    const nameCell = nameH ? cellOver(table, r, nameH) : null;
    const dateCell = dateH ? cellOver(table, r, dateH) : null;
    const position = posCell && posCell !== box ? posCell.text : '';
    const name = nameCell && nameCell !== box ? stripNameCaption(nameCell.text) : '';
    const date = dateCell && dateCell !== box ? dateCell.text : '';
    const st = slotStateOf(box);
    out.push({
      key: `t${table.index}r${ri}c${box.c0}`,
      table: table.index,
      row: ri,
      pattern: 'column',
      group,
      role,
      position,
      name,
      date,
      approver: isApprover(role, position),
      client: isClientRole(role),
      state: st.state,
      mark: st.mark,
      erpDescr: st.erpDescr,
      box,
      posCell: posCell && posCell !== box ? posCell : null,
      nameCell: nameCell && nameCell !== box ? nameCell : null,
      dateCell: dateCell && dateCell !== box ? dateCell : null,
      rowSpan: { start: r.start, end: r.end },
      rowTrPr: r.trPr,
    });
  }
  return out;
}

/** Хэлбэр 2 — шошготой нүд өөрөө хайрцаг, үүрэг нь зүүн талд. */
function inlineSlot(table: DocxTable, ri: number, box: DocxCell, group: number): SignSlot | null {
  // Бараан толгой нүд хэзээ ч хайрцаг биш (MGL-WT-CR-002: хар-хөх «Гарын үсэг: (Sign)»
  // толгойд суусан гарын үсэг харагдахгүй, мөр нь «зурагдсан» гэж түгжигдсэн).
  if (box.darkFill) return null;
  const row = table.rows[ri]!;
  const idx = row.cells.indexOf(box);
  let roleIdx = -1;
  for (let i = idx - 1; i >= 0; i--) {
    const c = row.cells[i]!;
    if (isShortLabel(c.text, SIG_LABEL_RE)) break;
    if (isShortLabel(c.text, ROLE_RE)) {
      roleIdx = i;
      break;
    }
  }
  if (roleIdx < 0) return null;
  const role = row.cells[roleIdx]!.text;
  const between = row.cells.slice(roleIdx + 1, idx);
  // Үүрэг ба «Гарын үсэг»-ийн хооронд «Албан тушаал» / «Огноо» баганын толгой байвал
  // энэ нь БАГАНЫН толгой мөр — хайрцаг нь доорх мөрүүдэд (багана хэлбэр танигдаагүй
  // бол ямар ч мөр санал болгохгүй, толгой нүдэнд ХЭЗЭЭ Ч зурахгүй).
  if (between.some((c) => isPosOrDateCaption(c.text))) return null;
  const nameCell = between.length > 0 ? between[0]! : null;
  const name = stripNameCaption(between.map((c) => c.text).join(' '));
  const st = slotStateOf(box);
  const client = isClientRole(role);
  return {
    key: `t${table.index}r${ri}c${box.c0}`,
    table: table.index,
    row: ri,
    pattern: 'inline',
    group,
    role,
    position: '',
    name,
    date: '',
    approver: !client && (APPROVER_ROLE_RE.test(role) || DIRECTOR_RE.test(name)),
    client,
    state: st.state,
    mark: st.mark,
    erpDescr: st.erpDescr,
    box,
    posCell: null,
    nameCell,
    dateCell: null,
    rowSpan: { start: row.start, end: row.end },
    rowTrPr: row.trPr,
  };
}

/* ------------------------------------------------------------------ */
/*  Хүний нэр — баримт дээрх «Б.Эрдэнэжин» ↔ хэрэглэгч                  */
/* ------------------------------------------------------------------ */

function nameTokens(s: string): string[] {
  return stripNameCaption(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[\s.,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** «Бат-Өлзий Билгүүн» → «Б.Билгүүн» (баримтын ердийн хэлбэр).  Нэг үгтэй бол хэвээр. */
export function shortPersonName(fullName: string): string {
  const parts = normalizeSpace(fullName).split(' ').filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const surname = parts[0]!;
  const given = parts[parts.length - 1]!;
  return `${surname.charAt(0).toUpperCase()}.${given}`;
}

/**
 * Баримт дээр бичигдсэн нэр тухайн хүнийх мөн эсэх.  Өөрийн нэр (`given`) ЯГ
 * таарах ёстой; эцгийн нэрийн эхний үсэг баримтад байвал түүнийг ч шалгана.
 * Кирилл (`full_name`) ба латин (`username` «B.Bilguun») хоёуланг оролдоно.
 */
export function personNameMatches(docName: string, user: { full_name?: string | null; username?: string | null }): boolean {
  const doc = nameTokens(docName);
  if (doc.length === 0) return false;
  const docInitials = doc.filter((t) => [...t].length === 1);
  const docWords = doc.filter((t) => [...t].length > 1);
  if (docWords.length === 0) return false;
  const docGiven = docWords[docWords.length - 1]!;
  const docSurname = docWords.length > 1 ? docWords[0]! : null;

  const candidates: Array<{ surname: string | null; given: string }> = [];
  for (const raw of [user.full_name, user.username]) {
    if (!raw) continue;
    const t = nameTokens(raw);
    const words = t.filter((x) => [...x].length > 1);
    const initials = t.filter((x) => [...x].length === 1);
    if (words.length === 0) continue;
    const given = words[words.length - 1]!;
    const surname = words.length > 1 ? words[0]! : (initials[0] ?? null);
    candidates.push({ surname, given });
  }
  return candidates.some((c) => {
    if (c.given !== docGiven) return false;
    if (docSurname) return c.surname === null || c.surname === docSurname;
    const ini = docInitials[0];
    if (!ini) return true;
    return c.surname === null || c.surname.charAt(0) === ini;
  });
}

/* ------------------------------------------------------------------ */
/*  Огнооны хэлбэр — хүснэгтэд бичигдсэн бусад огнооноос дуурайна        */
/* ------------------------------------------------------------------ */

export type DateStyle = 'YYYY.MM.DD' | 'YY.MM.DD' | 'YYYY/MM/DD' | 'YYYY-MM-DD';

export function detectDateStyle(samples: readonly string[]): DateStyle {
  for (const s of samples) {
    const v = s.trim();
    if (/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(v)) return 'YYYY.MM.DD';
    if (/^\d{2}\.\d{2}\.\d{2}$/.test(v)) return 'YY.MM.DD';
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(v)) return 'YYYY/MM/DD';
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) return 'YYYY-MM-DD';
  }
  return 'YYYY.MM.DD';
}

/** `ymd` = «2026-10-01» (УБ-ын огноо). */
export function formatDocDate(ymd: string, style: DateStyle): string {
  const [y = '', m = '', d = ''] = ymd.split('-');
  switch (style) {
    case 'YY.MM.DD':
      return `${y.slice(2)}.${m}.${d}`;
    case 'YYYY/MM/DD':
      return `${y}/${m}/${d}`;
    case 'YYYY-MM-DD':
      return `${y}-${m}-${d}`;
    default:
      return `${y}.${m}.${d}`;
  }
}

/* ------------------------------------------------------------------ */
/*  Зураг — хэмжээ                                                      */
/* ------------------------------------------------------------------ */

export interface ImageInfo {
  ext: 'png' | 'jpeg';
  width: number;
  height: number;
}

/** PNG/JPEG-ийн толгойноос хэмжээ.  Өөр формат (webp, svg) → null. */
export function imageInfo(bytes: Uint8Array): ImageInfo | null {
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = v.getUint32(16);
    const height = v.getUint32(20);
    return width > 0 && height > 0 ? { ext: 'png', width, height } : null;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let p = 2;
    while (p + 9 < bytes.length) {
      if (bytes[p] !== 0xff) {
        p++;
        continue;
      }
      const marker = bytes[p + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        p += 2;
        continue;
      }
      const len = (bytes[p + 2]! << 8) | bytes[p + 3]!;
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (bytes[p + 5]! << 8) | bytes[p + 6]!;
        const width = (bytes[p + 7]! << 8) | bytes[p + 8]!;
        return width > 0 && height > 0 ? { ext: 'jpeg', width, height } : null;
      }
      p += 2 + len;
    }
  }
  return null;
}

const EMU_PER_MM = 36_000;
const EMU_PER_TWIP = 635;
/** Нүдний дотор талын ердийн зай (Word-ийн өгөгдмөл 0.19 см × 2) + бага нөөц. */
const CELL_PAD_TWIPS = 240;

/**
 * Гарын үсгийн зургийн хэмжээ (EMU): өндөр нь хэлбэрээс хамаарна — өргөн
 * гарын үсэг 10 мм, дөрвөлжин ~11.5 мм, босоо 13.5 мм (RFI-ийн мөр 12–14 мм;
 * дөрвөлжин гарын үсэг 11 мм-т хэт жижиг харагдсан — Word-оор хэмжсэн
 * 2026-10-01).  Өргөн нь харьцаагаараа, хайрцгийн өргөнд багтана
 * (хэтэрвэл жигд жижгэрнэ).
 */
export function signatureExtent(img: { width: number; height: number }, boxWidthTwips: number | null): { cx: number; cy: number } {
  const aspect = img.width / img.height;
  const targetH = (aspect >= 2 ? 10 : aspect >= 1.2 ? 11.5 : 13.5) * EMU_PER_MM;
  // Хайрцгийн өргөнөөс ХЭТРЭХГҮЙ (тогтмол өргөнтэй хүснэгтэд зураг нүднээс
  // халиж тайрагдана); өргөн нь мэдэгдэхгүй бол 40 мм.
  const boxW = boxWidthTwips ? Math.max(5 * EMU_PER_MM, (boxWidthTwips - CELL_PAD_TWIPS) * EMU_PER_TWIP) : 40 * EMU_PER_MM;
  const maxW = Math.min(60 * EMU_PER_MM, boxW);
  let cy = targetH;
  let cx = Math.round((cy * img.width) / img.height);
  if (cx > maxW) {
    cx = Math.round(maxW);
    cy = Math.round((cx * img.height) / img.width);
  }
  return { cx: Math.max(1, cx), cy: Math.max(1, cy) };
}

/* ------------------------------------------------------------------ */
/*  Суулгах                                                             */
/* ------------------------------------------------------------------ */

const NS = {
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
} as const;

/** `w:document` үндэст `wp`/`r` namespace зарлаагүй бол нэмнэ. */
export function ensureRootNamespaces(xml: string): string {
  const m = /<w:document\b[^>]*>/.exec(xml);
  if (!m) return xml;
  let tag = m[0];
  for (const [prefix, uri] of Object.entries(NS)) {
    if (!new RegExp(`\\sxmlns:${prefix}=`).test(tag)) tag = tag.replace(/<w:document\b/, `<w:document xmlns:${prefix}="${uri}"`);
  }
  return tag === m[0] ? xml : xml.slice(0, m.index) + tag + xml.slice(m.index + m[0].length);
}

/** Баримт дахь `wp:docPr`-ийн хамгийн их id + 1. */
export function nextDocPrId(xml: string): number {
  let max = 0;
  for (const m of xml.matchAll(/<wp:docPr\b[^>]*\sid="(\d+)"/g)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

/** `word/_rels/document.xml.rels`-д зургийн холбоос (шинэ, давхардахгүй id). */
export function addImageRelationship(relsXml: string, target: string): { xml: string; rid: string } {
  const ids = new Set([...relsXml.matchAll(/\sId="([^"]+)"/g)].map((m) => m[1]));
  let n = 1;
  while (ids.has(`rIdMglSign${n}`)) n++;
  const rid = `rIdMglSign${n}`;
  const rel = `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeXmlAttr(target)}"/>`;
  const close = relsXml.lastIndexOf('</Relationships>');
  if (close < 0) throw new Error('docx: bad relationships part');
  return { xml: relsXml.slice(0, close) + rel + relsXml.slice(close), rid };
}

/** `[Content_Types].xml`-д тэр өргөтгөлийн `Default` байхгүй бол нэмнэ. */
export function ensureImageContentType(ctXml: string, ext: 'png' | 'jpeg'): string {
  const exts = ext === 'png' ? ['png'] : ['jpeg', 'jpg'];
  for (const e of exts) {
    if (new RegExp(`<Default\\b[^>]*\\sExtension="${e}"`, 'i').test(ctXml)) return ctXml;
  }
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  const close = ctXml.lastIndexOf('</Types>');
  if (close < 0) throw new Error('docx: bad content types part');
  return `${ctXml.slice(0, close)}<Default Extension="${ext}" ContentType="${mime}"/>${ctXml.slice(close)}`;
}

/** `pPr`-ийн хүүхдүүдийн схемийн дараалал (CT_PPrBase) — Word эвдэрсэн гэж үзэхгүйн тулд. */
const PPR_ORDER = [
  'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
  'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
  'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd',
  'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc',
  'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr',
  'sectPr', 'pPrChange',
];

/** `<w:pPr>` доторх шууд хүүхдүүд (нэр + бүтэн текст). */
function splitChildren(inner: string): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  let i = 0;
  while (i < inner.length) {
    const lt = inner.indexOf('<', i);
    if (lt < 0) break;
    const m = /^<w:([A-Za-z]+)\b[^>]*?(\/?)>/.exec(inner.slice(lt));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const name = m[1]!;
    if (m[2] === '/') {
      out.push({ name, text: m[0] });
      i = lt + m[0].length;
      continue;
    }
    const close = `</w:${name}>`;
    const end = inner.indexOf(close, lt + m[0].length);
    if (end < 0) {
      out.push({ name, text: inner.slice(lt) });
      break;
    }
    out.push({ name, text: inner.slice(lt, end + close.length) });
    i = end + close.length;
  }
  return out;
}

/** `pPr`-ийн хүүхдийг (spacing, jc) СОЛИНО эсвэл зөв байрлалд НЭМНЭ. */
export function setPPrChild(pPrInner: string, name: string, element: string): string {
  const kids = splitChildren(pPrInner);
  const at = kids.findIndex((k) => k.name === name);
  if (at >= 0) {
    kids[at] = { name, text: element };
  } else {
    const order = PPR_ORDER.indexOf(name);
    let insertAt = kids.length;
    for (let i = 0; i < kids.length; i++) {
      const o = PPR_ORDER.indexOf(kids[i]!.name);
      if (o > order) {
        insertAt = i;
        break;
      }
    }
    kids.splice(insertAt, 0, { name, text: element });
  }
  return kids.map((k) => k.text).join('');
}

/** Гарын үсгийн догол мөр: ганц мөрийн зай (exact бол зураг тайрагдана) + дээр доор 2 pt —
 *  зураг нүдний хүрээнд тулахгүй (Word-оор хэмжсэн 2026-10-01). */
const SIG_SPACING = '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>';
const SIG_JC = '<w:jc w:val="center"/>';

/** Нүдний ЭХНИЙ догол мөр (байрлал); өөрөө хаагдсан `<w:p/>` ч болно. */
function firstParagraph(xml: string, cell: Span): { start: number; end: number; selfClosing: boolean } | null {
  const slice = xml.slice(cell.start, cell.end);
  const m = /<w:p\b[^>]*?(\/?)>/.exec(slice);
  if (!m) return null;
  const start = cell.start + m.index;
  if (m[1] === '/') return { start, end: start + m[0].length, selfClosing: true };
  const close = slice.indexOf('</w:p>', m.index);
  if (close < 0) return null;
  return { start, end: cell.start + close + '</w:p>'.length, selfClosing: false };
}

/** Догол мөрөнд run нэмнэ (төгсгөлд).  `fixLayout` — гарын үсгийн мөрийн зай + голлуулах. */
function appendRunToParagraph(p: string, selfClosing: boolean, run: string, fixLayout: boolean): string {
  let open: string;
  let pPrInner: string | null = null;
  let rest: string;
  if (selfClosing) {
    open = p.replace(/\s*\/>$/, '>');
    rest = '';
  } else {
    const head = /^<w:p\b[^>]*>/.exec(p)![0];
    open = head;
    let body = p.slice(head.length, p.length - '</w:p>'.length);
    const pPrM = /^\s*(<w:pPr\/>|<w:pPr>[\s\S]*?<\/w:pPr>)/.exec(body);
    if (pPrM) {
      const pPr = pPrM[1]!;
      pPrInner = pPr === '<w:pPr/>' ? '' : pPr.slice('<w:pPr>'.length, pPr.length - '</w:pPr>'.length);
      body = body.slice(pPrM[0].length);
    }
    rest = body;
  }
  if (fixLayout) {
    let inner = pPrInner ?? '';
    inner = setPPrChild(inner, 'spacing', SIG_SPACING);
    inner = setPPrChild(inner, 'jc', SIG_JC);
    pPrInner = inner;
  }
  const pPr = pPrInner === null ? '' : `<w:pPr>${pPrInner}</w:pPr>`;
  return `${open}${pPr}${rest}${run}</w:p>`;
}

/** Зургийн run (inline, хайрцагт голлоно). */
export function drawingRun(opts: {
  rid: string;
  docPrId: number;
  mark: string;
  descr: string;
  ext: 'png' | 'jpeg';
  cx: number;
  cy: number;
}): string {
  const a = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const pic = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
  const name = escapeXmlAttr(opts.mark);
  return (
    `<w:r><w:rPr><w:noProof/></w:rPr><w:drawing>` +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${opts.cx}" cy="${opts.cy}"/>` +
    `<wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${opts.docPrId}" name="${name}" descr="${escapeXmlAttr(opts.descr)}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${a}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic xmlns:a="${a}"><a:graphicData uri="${pic}">` +
    `<pic:pic xmlns:pic="${pic}">` +
    `<pic:nvPicPr><pic:cNvPr id="${opts.docPrId}" name="${name}.${opts.ext === 'png' ? 'png' : 'jpg'}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${escapeXmlAttr(opts.rid)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${opts.cx}" cy="${opts.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

const ARIAL_RFONTS = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';
const SYMBOL_FONT_RE = /^(?:symbol|wingdings(?: [23])?|webdings|marlett|ms gothic|ms mincho|segoe ui symbol|segoe ui emoji)$/i;

/**
 * Бичсэн бичвэрийн фонт ҮРГЭЛЖ Arial (2026-10-05 эзний шийдвэр: RFI-ийн бүх текст Arial).
 * Frontend `docxGoogleReady.ts` `forceArialFonts`-ийн ихэр — ижил дүрэм (eastAsia/hint хэвээр,
 * тэмдэгт-фонт хөндөхгүй).  `rPr` байхгүй/фонтгүй бол Arial нэмнэ.
 */
export function arialRunPr(rPr: string | null): string {
  if (!rPr) return `<w:rPr>${ARIAL_RFONTS}</w:rPr>`;
  const m = /<w:rFonts\b([^>]*?)\/>/.exec(rPr);
  if (!m) {
    const open = /^\s*<w:rPr>(\s*<w:rStyle\b[^>]*\/>)?/.exec(rPr);
    return open ? rPr.slice(0, open[0].length) + ARIAL_RFONTS + rPr.slice(open[0].length) : rPr;
  }
  const attrs: Record<string, string> = {};
  for (const a of ` ${m[1]}`.matchAll(/\s(w:[A-Za-z]+)="([^"]*)"/g)) attrs[a[1]!] = a[2]!;
  const slots = ['w:ascii', 'w:hAnsi', 'w:cs'];
  const themes = ['w:asciiTheme', 'w:hAnsiTheme', 'w:cstheme'];
  if ([...slots, 'w:eastAsia'].some((k) => SYMBOL_FONT_RE.test((attrs[k] ?? '').trim()))) return rPr;
  const rest = Object.entries(attrs)
    .filter(([k]) => !slots.includes(k) && !themes.includes(k))
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('');
  return rPr.replace(m[0], `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"${rest}/>`);
}

/** Бичвэрийн run — `rPr` нь хүснэгтийн бусад мөрийн бичвэрээс хуулагдаж, фонт нь Arial болно. */
function textRun(text: string, rPr: string | null): string {
  return `<w:r>${arialRunPr(rPr)}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`;
}

/**
 * Хоосон нүдний догол мөрийн ТЭМДГИЙН формат (`w:pPr/w:rPr`) — Word хоосон нүдэнд
 * бичихэд яг үүнийг хэрэглэдэг (RFI загварт: AGFutura Mon, 9 pt, 90%).  Засварын
 * тэмдэглэгээ (ins/del/rPrChange) хасагдана.
 */
function paragraphMarkRunPr(xml: string, cell: DocxCell): string | null {
  const p = firstParagraph(xml, cell);
  if (!p || p.selfClosing) return null;
  const para = xml.slice(p.start, p.end);
  const open = /^<w:p\b[^>]*>\s*<w:pPr>/.exec(para);
  if (!open) return null;
  // CT_PPr: `rPr` нь `sectPr`/`pPrChange`-аас ӨМНӨ.  Тэдгээр нь дотроо өөр pPr/rPr
  // агуулдаг тул тэнд таслана.
  let pPr = para.slice(open[0].length);
  const cut = pPr.search(/<w:(?:sectPr|pPrChange)\b|<\/w:pPr>/);
  if (cut >= 0) pPr = pPr.slice(0, cut);
  // Шунахай — `rPrChange` доторх `</w:rPr>`-ийг давж гадна талынхыг авна.
  const rPr = /<w:rPr>([\s\S]*)<\/w:rPr>/.exec(pPr)?.[1];
  if (!rPr) return null;
  // CT_ParaRPr → CT_RPr: засварын тэмдэглэгээ run-ийн rPr-д хүчингүй.
  const clean = rPr
    .replace(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/g, '')
    .replace(/<w:(?:ins|del|moveFrom|moveTo)\b[^>]*\/>/g, '')
    .trim();
  return clean ? `<w:rPr>${clean}</w:rPr>` : null;
}

/** Хоосон нүдийг бөглөхөд хэрэглэх `rPr` — ижил баганын бусад мөрийн бичвэртэй run-аас. */
function templateRunPr(xml: string, cells: Array<DocxCell | null>): string | null {
  for (const c of cells) {
    if (!c || !c.text) continue;
    const slice = xml.slice(c.start, c.end);
    for (const m of slice.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const body = m[1] ?? '';
      if (!/<w:t(?:\s[^>]*)?>[^<]*\S[^<]*<\/w:t>/.test(body) || /<w:drawing\b/.test(body)) continue;
      const rPr = /^\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(body);
      return rPr ? rPr[1]! : null;
    }
  }
  return null;
}

export interface StampSpec {
  slot: SignSlot;
  rid: string;
  docPrId: number;
  mark: string;
  descr: string;
  ext: 'png' | 'jpeg';
  cx: number;
  cy: number;
  /** ЗӨВХӨН хоосон нүдийг бөглөнө. */
  fill: { name?: string; position?: string; date?: string };
}

export interface StampResult {
  xml: string;
  /** Бөглөсөн нүднүүд — аудитад. */
  filled: Array<{ field: 'name' | 'position' | 'date'; text: string }>;
  /** Энэ мөрийн хайрцаг БИШ нүднээс устгасан манай зургийн тэмдгүүд. */
  removed: string[];
}

/**
 * Манай суулгасан гарын үсгийн run — `wp:docPr name="mgl-sign-…"`, эсвэл Google тэмдгийг
 * устгасан бол `descr="MGL ERP …"`.  Нэг `<w:r>`-ээс хальдаггүй.
 */
const OUR_DRAWING_RUN_RE =
  /<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?(<wp:docPr\b(?=[^>]*\s(?:name="mgl-sign-[A-Za-z0-9_-]+"|descr="MGL ERP\b))[^>]*>)(?:(?!<\/w:r>)[\s\S])*<\/w:r>/g;

/** Манай гарын үсгийн догол мөр (`SIG_SPACING`: дээр доор 2 pt) — attribute-ийн дараалал Google-д өөр. */
function isSignatureParagraphPPr(paragraph: string): boolean {
  const spacing = /<w:spacing\b[^>]*\/>/.exec(paragraph)?.[0] ?? '';
  return attrOf(spacing, 'w:before') === '40' && attrOf(spacing, 'w:after') === '40';
}

/** Догол мөрөнд харагдах агуулга (бичвэр, зураг) үлдсэн эсэх. */
function paragraphHasContent(paragraph: string): boolean {
  return /<w:t(?:\s[^>]*)?>[^<]*\S[^<]*<\/w:t>|<w:drawing\b|<w:pict\b|<w:object\b/.test(paragraph);
}

/**
 * Буруу байрласан МАНАЙ гарын үсгийг устгах засварууд.  Хамрах хүрээ: (а) зурж буй
 * мөрийн хайрцаг биш нүднүүд (2026-10-05: нарийн сүлжээний баганаас болж «Ирсэн хаяг»-т
 * суусан), (б) тэр хүснэгтийн «Гарын үсэг» шошготой, хайрцаг биш нүднүүд (2026-10-12:
 * CR загварын хар-хөх толгойд суусан).  Хүний оруулсан зураг, ямар нэг мөрийн хайрцаг
 * дахь гарын үсэг хөндөгдөхгүй.  Run-ийг хасахад догол мөр нь хоосон үлдсэн, манай
 * зай/голлуулалттай, нүдэнд өөр догол мөр байгаа бол догол мөрийг бүхэлд нь хасна.
 */
function strayStampEdits(
  xml: string,
  slots: readonly SignSlot[],
  slot: SignSlot,
): { edits: Array<{ start: number; end: number; text: string }>; removed: string[] } {
  const table = parseTables(xml).find((t) => t.index === slot.table);
  if (!table) return { edits: [], removed: [] };
  const boxes = slots.map((s) => s.box);
  const inBox = (start: number, end: number) => boxes.some((b) => start >= b.start && end <= b.end);
  type Hit = { start: number; end: number; name: string; cell: DocxCell };
  const hits = new Map<number, Hit>();
  for (const row of table.rows) {
    const sameRow = row.start === slot.rowSpan.start;
    for (const cell of row.cells) {
      if (boxes.some((b) => b.start === cell.start)) continue;
      if (!sameRow && !isShortLabel(cell.text, SIG_LABEL_RE)) continue;
      const slice = xml.slice(cell.start, cell.end);
      for (const m of slice.matchAll(OUR_DRAWING_RUN_RE)) {
        const start = cell.start + (m.index ?? 0);
        const end = start + m[0].length;
        if (inBox(start, end) || hits.has(start)) continue;
        const dp = m[1] ?? '';
        hits.set(start, { start, end, name: attrOf(dp, 'name') ?? '', cell });
      }
    }
  }
  // Догол мөрөөр бүлэглэнэ — нэг догол мөрийг хасах засвар ба доторх run-уудыг хасах
  // засвар давхцахгүй.
  const byPara = new Map<number, { pStart: number; pEnd: number; cell: DocxCell; runs: Hit[] }>();
  for (const h of hits.values()) {
    const pStart = Math.max(xml.lastIndexOf('<w:p ', h.start), xml.lastIndexOf('<w:p>', h.start));
    const close = xml.indexOf('</w:p>', h.end);
    const pEnd = close < 0 ? -1 : close + '</w:p>'.length;
    const key = pStart >= h.cell.start && pEnd > 0 && pEnd <= h.cell.end ? pStart : -h.start - 1;
    const g = byPara.get(key) ?? { pStart, pEnd, cell: h.cell, runs: [] };
    g.runs.push(h);
    byPara.set(key, g);
  }
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const removed: string[] = [];
  for (const [key, g] of byPara) {
    for (const r of g.runs) removed.push(r.name);
    if (key >= 0) {
      let para = xml.slice(g.pStart, g.pEnd);
      for (const r of [...g.runs].sort((a, b) => b.start - a.start)) {
        para = para.slice(0, r.start - g.pStart) + para.slice(r.end - g.pStart);
      }
      const cellParas = xml.slice(g.cell.start, g.cell.end).match(/<w:p[\s>]/g)?.length ?? 0;
      if (!paragraphHasContent(para) && isSignatureParagraphPPr(para) && cellParas >= 2) {
        edits.push({ start: g.pStart, end: g.pEnd, text: '' });
        continue;
      }
    }
    for (const r of g.runs) edits.push({ start: r.start, end: r.end, text: '' });
  }
  return { edits, removed };
}

/**
 * Нэг нүдэнд гарын үсгийн зураг суулгаж, ХООСОН нэр/албан тушаал/огноог
 * бөглөнө.  `slots` нь ЭНЭ `xml`-ээс `findSignatureSlots`-оор гаргасан байх
 * ёстой (offset-ууд таарна).
 */
export function stampDocumentXml(xml: string, slots: readonly SignSlot[], spec: StampSpec): StampResult {
  const slot = spec.slot;
  if (slot.state !== 'empty') throw new Error('docx: slot is not empty');
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const filled: StampResult['filled'] = [];

  const run = drawingRun(spec);
  if (slot.pattern === 'inline') {
    // Шошготой хайрцаг: шошгоны ДООР шинэ догол мөр.
    const close = slot.box.end - '</w:tc>'.length;
    edits.push({
      start: close,
      end: close,
      text: `<w:p><w:pPr>${SIG_SPACING}${SIG_JC}</w:pPr>${run}</w:p>`,
    });
  } else {
    const p = firstParagraph(xml, slot.box);
    if (!p) throw new Error('docx: signature cell has no paragraph');
    edits.push({
      start: p.start,
      end: p.end,
      text: appendRunToParagraph(xml.slice(p.start, p.end), p.selfClosing, run, true),
    });
  }

  // Хоосон бичвэрийн нүдийг бөглөнө (бусдын бичсэнийг ХЭЗЭЭ Ч дарахгүй).
  const sameGroup = slots.filter((s) => s.group === slot.group && s.key !== slot.key);
  const fills: Array<{ field: 'name' | 'position' | 'date'; cell: DocxCell | null; text: string | undefined; peers: Array<DocxCell | null> }> = [
    { field: 'position', cell: slot.posCell, text: spec.fill.position, peers: sameGroup.map((s) => s.posCell) },
    { field: 'name', cell: slot.nameCell, text: spec.fill.name, peers: sameGroup.map((s) => s.nameCell) },
    { field: 'date', cell: slot.dateCell, text: spec.fill.date, peers: sameGroup.map((s) => s.dateCell) },
  ];
  for (const f of fills) {
    const value = f.text?.trim();
    if (!f.cell || !value || f.cell.text !== '' || f.cell.vMerge === 'continue' || f.cell.hasDrawing) continue;
    const p = firstParagraph(xml, f.cell);
    if (!p) continue;
    // Word-ийн өөрийн зан төлөв: хоосон нүдний догол мөрийн тэмдгийн формат; байхгүй бол
    // ижил баганын бусад мөрийн бичвэр (хүснэгтэд бичсэн нэр, огноо).
    const rPr = paragraphMarkRunPr(xml, f.cell) ?? templateRunPr(xml, f.peers);
    edits.push({
      start: p.start,
      end: p.end,
      text: appendRunToParagraph(xml.slice(p.start, p.end), p.selfClosing, textRun(value, rPr), false),
    });
    filled.push({ field: f.field, text: value });
  }

  // Буруу байрласан манай гарын үсэг (энэ мөрийн хайрцаг биш нүд, хүснэгтийн
  // «Гарын үсэг» толгой) — устгана (`strayStampEdits`).
  const stray = strayStampEdits(xml, slots, slot);
  edits.push(...stray.edits);
  const removed = stray.removed;

  // «exact» өндөртэй мөр зургийг тайрдаг — «atLeast» болгоно (мөр л томорно).
  if (slot.rowTrPr) {
    const trPr = xml.slice(slot.rowTrPr.start, slot.rowTrPr.end);
    if (/w:hRule="exact"/.test(trPr)) {
      edits.push({ start: slot.rowTrPr.start, end: slot.rowTrPr.end, text: trPr.replace(/w:hRule="exact"/g, 'w:hRule="atLeast"') });
    }
  }

  // Засваруудыг ард нь урагш — offset-ууд хөдлөхгүй.  Давхцал гарвал алдаа.
  edits.sort((a, b) => b.start - a.start);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i]!.end > edits[i - 1]!.start) throw new Error('docx: overlapping edits');
  }
  let out = xml;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { xml: ensureRootNamespaces(out), filled, removed };
}
