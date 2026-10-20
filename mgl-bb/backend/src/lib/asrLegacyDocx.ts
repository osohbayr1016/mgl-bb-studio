/**
 * Хуучин `YYMMDD_PROJECT ID_ASR_BA_001.docx` файлын АГУУЛГЫГ уншина.
 *
 * Загвар нь 12×15 нүдтэй ГАНЦ Word хүснэгт (`frontend/.../asrTemplate.ts`-ийн
 * геометр).  Ажилтнууд тэр загварыг Word дээр бөглөдөг байсан тул:
 *   • шошгын нүд («Төслийн нэр», «Шифр», «Тайлбар», «Хяналтаар явсан» …)
 *     ХЭВЭЭР, дараагийн нүднүүд нь утга;
 *   • checkbox нь Wingdings `<w:sym w:char="F06F"/>` (☐) → `F0FE` (☒) сольсон,
 *     ЭСВЭЛ хүн шууд ☒/✓/x бичсэн байж болно — хоёуланг таньна;
 *   • «Ажлын тайлан» дор багийн нэг мөр (8 checkbox дараалан) + их бие;
 *   • зураг нь `<a:blip r:embed="rIdN"/>` → `word/_rels/document.xml.rels` →
 *     `word/media/…`.
 *
 * Мөрийг ИНДЕКСЭЭР биш ШОШГООР олдог — хэн нэгэн мөр нэмсэн/устгасан ч
 * унших юм л уншигдана.  Ямар ч утга олдохгүй бол `null`, ХЭЗЭЭ Ч шидэхгүй:
 * задлан шинжилгээ бол зөвхөн УРЬДЧИЛАН БӨГЛӨЛТ, хэрэглэгч засаж болно.
 *
 * `parseAsrDocumentXml` нь ЦЭВЭР (мөр → объект) — `asrLegacyDocx.test.ts`.
 */
import { normalizeTeamCode } from './asrLegacy';
import { readZipEntry, readZipText } from './zipRead';

/* ------------------------------------------------------------------ */
/*  OOXML → текст                                                      */
/* ------------------------------------------------------------------ */

const CHECKED_SYMS = new Set(['F0FE', 'F0FD', 'F0FC', 'F0FB']); // ☒ ☑ ✔ ✓ (Wingdings)
const CHECKED_CHARS = /[☒☑✓✔■⊠🗹]/u;
const UNCHECKED_CHARS = /[☐□]/u;

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Догол мөрүүдийг `\n`-ээр, `<w:br/>` → `\n`, `<w:tab/>` → зай. */
function cellText(cellXml: string): string {
  const paras = cellXml.split(/<w:p[ >]/).slice(1);
  const lines = paras.map((p) => {
    const body = p
      .replace(/<w:br\/>|<w:br [^>]*\/>/g, '\n')
      .replace(/<w:tab\/>/g, ' ');
    return [...body.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>|\n/g)]
      .map((m) => (m[0] === '\n' ? '\n' : unescapeXml(m[1] ?? '')))
      .join('');
  });
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').trim();
}

function cellSyms(cellXml: string): string[] {
  return [...cellXml.matchAll(/<w:sym [^>]*w:char="([0-9A-Fa-f]{4})"/g)].map((m) =>
    m[1]!.toUpperCase(),
  );
}

interface Cell {
  xml: string;
  text: string;
  syms: string[];
  span: number;
}

interface Row {
  cells: Cell[];
}

function splitCells(rowXml: string): Cell[] {
  // `<w:tc>` нь атрибутгүй (Word ингэж бичдэг); `</w:tc>` хүртэлх хэсэг.
  const parts = rowXml.split(/<w:tc(?: [^>]*)?>/).slice(1);
  return parts.map((raw) => {
    const xml = raw.slice(0, raw.indexOf('</w:tc>') >= 0 ? raw.indexOf('</w:tc>') : raw.length);
    const span = Number(/<w:gridSpan w:val="(\d+)"/.exec(xml)?.[1] ?? '1');
    return { xml, text: cellText(xml), syms: cellSyms(xml), span };
  });
}

/** Баримтын БҮХ хүснэгтийн мөрүүд (үүрлэсэн хүснэгтгүй гэж үзнэ). */
function splitRows(documentXml: string): Row[] {
  const rows = documentXml.split(/<w:tr(?: [^>]*)?>/).slice(1);
  return rows.map((r) => ({
    cells: splitCells(r.slice(0, r.indexOf('</w:tr>') >= 0 ? r.indexOf('</w:tr>') : r.length)),
  }));
}

/** Нүд «тэмдэглэгдсэн» үү — Wingdings sym, юникод тэмдэг, эсвэл `x` угтвар. */
function isChecked(c: Cell): boolean {
  if (c.syms.some((s) => CHECKED_SYMS.has(s))) return true;
  if (c.syms.length > 0) return false; // ☐ sym байгаа, солиогүй
  if (CHECKED_CHARS.test(c.text)) return true;
  if (UNCHECKED_CHARS.test(c.text)) return false;
  return /^[xX×✗]\s*\S/.test(c.text.trim());
}

/** Шошгын нүд: «Төслийн нэр», «Шифр» … — зайг үл тоон, эхлэлээр. */
function labelIs(c: Cell | undefined, label: string): boolean {
  if (!c) return false;
  const t = c.text.replace(/\s+/g, ' ').trim().toLowerCase();
  return t.startsWith(label.toLowerCase());
}

/** «☐ Төлөвлөлт» → «Төлөвлөлт» (тэмдэг, x, зай хасна). */
function stripMark(text: string): string {
  return text
    .replace(CHECKED_CHARS, '')
    .replace(UNCHECKED_CHARS, '')
    .replace(/^[xX×✗]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DATE_RE = /(20\d{2})\s*[./\-]\s*(\d{1,2})\s*[./\-]\s*(\d{1,2})/;

export function findDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = DATE_RE.exec(text);
  if (!m) return null;
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${m[1]}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Загварын утгууд                                                    */
/* ------------------------------------------------------------------ */

const DOC_KIND_LABELS: { label: string; kind: string }[] = [
  { label: 'Төлөвлөлт', kind: 'planning' },
  { label: 'Явц', kind: 'progress' },
  { label: 'Тайлан', kind: 'report' },
  { label: 'Ажлын зураг', kind: 'drawing' },
  { label: 'Хуваарь', kind: 'schedule' },
  { label: 'Бусад', kind: 'other' },
];

/** «Хяналтаар явсан» мөрийн нүдний шошго (asrTemplate.ts VISITED_TEAM_CELLS). */
const VISITED_LABELS = ['БА', 'ББ', 'ХАС', 'ЦБУ', 'ХТ', 'ДГ', 'ХД', 'АУ', 'ЦАХ'];

/** «Ажлын тайлан» доорх нэг нүдэн дэх 8 checkbox-ийн дараалал. */
const WORK_REPORT_ORDER = ['BA', 'BB', 'HAS', 'TSBU', null, null, 'HD', 'AU'];

export interface ParsedAsrDoc {
  project_name: string | null;
  report_date: string | null;
  shifr: string | null;
  doc_types: string[];
  description: string | null;
  /** «Хяналтаар явсан» тэмдэглэгдсэн багууд (`teams.code`). */
  visited_teams: string[];
  /** «Ажлын тайлан» мөрөнд тэмдэглэгдсэн багууд. */
  work_report_teams: string[];
  work_note: string | null;
  checked_by: string | null;
  sig_arch_name: string | null;
  sig_arch_date: string | null;
  sig_site_name: string | null;
  sig_site_date: string | null;
  /** Толгойн «Doc. No.» — `LUXWOOD_ASR_BB_001` гэх мэт түүхий утга. */
  header_doc_no: string | null;
  header_date: string | null;
  /** Зургийн мөрөн дэх `r:embed` id-ууд (дараалалтай). */
  photo_rids: string[];
}

function emptyParsed(): ParsedAsrDoc {
  return {
    project_name: null,
    report_date: null,
    shifr: null,
    doc_types: [],
    description: null,
    visited_teams: [],
    work_report_teams: [],
    work_note: null,
    checked_by: null,
    sig_arch_name: null,
    sig_arch_date: null,
    sig_site_name: null,
    sig_site_date: null,
    header_doc_no: null,
    header_date: null,
    photo_rids: [],
  };
}

const nz = (s: string | null | undefined): string | null => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

/** Загварын хоосон утга («2026.__.__», «…..») биш бодит утга л буцаана. */
function realValue(s: string | null): string | null {
  const t = nz(s);
  if (!t) return null;
  if (/^[\s._…-]*$/.test(t)) return null;
  return t;
}

export function parseAsrDocumentXml(documentXml: string, headerXml?: string | null): ParsedAsrDoc {
  const out = emptyParsed();
  const rows = splitRows(documentXml);

  // Бүх нүдийг нэг удаа гүйлгэж checkbox-той шошгуудыг цуглуулна — мөрийн
  // байрлалаас үл хамаарна.
  const docKinds = new Set<string>();
  const visited = new Set<string>();
  for (const row of rows) {
    for (const c of row.cells) {
      const label = stripMark(c.text);
      const kind = DOC_KIND_LABELS.find((k) => k.label.toLowerCase() === label.toLowerCase());
      if (kind) {
        if (isChecked(c)) docKinds.add(kind.kind);
        continue;
      }
      if (VISITED_LABELS.includes(label.toUpperCase())) {
        const code = normalizeTeamCode(label);
        if (code && isChecked(c)) visited.add(code);
      }
    }
  }
  out.doc_types = DOC_KIND_LABELS.map((k) => k.kind).filter((k) => docKinds.has(k));
  out.visited_teams = [...visited];

  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i]!.cells;
    const first = cells[0];
    if (!first) continue;

    if (labelIs(first, 'Төслийн нэр')) {
      out.project_name = realValue(cells[1]?.text ?? null);
      const dateCell = cells.find((c, idx) => idx > 1 && labelIs(c, 'Он сар'));
      const dateIdx = dateCell ? cells.indexOf(dateCell) : -1;
      const dateText = dateIdx >= 0 ? (cells[dateIdx + 1]?.text ?? '') : cells[cells.length - 1]!.text;
      out.report_date = findDate(dateText);
      continue;
    }
    if (labelIs(first, 'Шифр')) {
      out.shifr = realValue(cells[1]?.text ?? null);
      continue;
    }
    if (labelIs(first, 'Тайлбар')) {
      out.description = realValue(cells[1]?.text ?? null);
      continue;
    }
    if (labelIs(first, 'Шалгасан')) {
      out.checked_by = realValue(cells[1]?.text ?? null);
      continue;
    }
    if (labelIs(first, 'Ажлын тайлан') && cells.length === 1) {
      // Дараагийн мөр: багийн checkbox мөр; түүний дараах мөр: их бие.
      const teamRow = rows[i + 1];
      const bodyRow = rows[i + 2];
      const teamCell = teamRow?.cells[0];
      if (teamCell && teamCell.syms.length === WORK_REPORT_ORDER.length) {
        teamCell.syms.forEach((s, idx) => {
          const code = WORK_REPORT_ORDER[idx];
          if (code && CHECKED_SYMS.has(s)) out.work_report_teams.push(code);
        });
      } else if (teamCell) {
        // Хүн ☒ гэж бичсэн бол шошгын дарааллаар таамаглана.
        const tokens = teamCell.text.split(/\s+/).filter(Boolean);
        for (let k = 0; k < tokens.length; k++) {
          if (CHECKED_CHARS.test(tokens[k]!)) {
            const code = normalizeTeamCode(stripMark(tokens[k + 1] ?? tokens[k]!));
            if (code) out.work_report_teams.push(code);
          }
        }
      }
      const body = bodyRow?.cells.map((c) => c.text).join('\n') ?? '';
      out.work_note = realValue(body);
      continue;
    }
    if (labelIs(first, 'Архитектор')) {
      out.sig_arch_name = realValue(cells[1]?.text ?? null);
      out.sig_arch_date = findDate(cells[3]?.text ?? cells[cells.length - 1]?.text);
      continue;
    }
    if (labelIs(first, 'Талбайн')) {
      out.sig_site_name = realValue(cells[1]?.text ?? null);
      out.sig_site_date = findDate(cells[3]?.text ?? cells[cells.length - 1]?.text);
      continue;
    }
  }

  // Зургийн мөр: «Шалгасан» ба «Attachment» шошгын ХООРОНД буй мөрүүдийн blip-үүд.
  const rowXmls = documentXml.split(/<w:tr(?: [^>]*)?>/).slice(1);
  let inPhotos = false;
  for (const r of rowXmls) {
    const firstText = cellText(r.split(/<w:tc(?: [^>]*)?>/)[1] ?? '');
    if (/^Шалгасан/i.test(firstText)) {
      inPhotos = true;
      continue;
    }
    if (/^Attachment/i.test(firstText) || /^Ажлын тайлан/i.test(firstText)) inPhotos = false;
    if (!inPhotos) continue;
    for (const m of r.matchAll(/<a:blip [^>]*r:embed="([^"]+)"/g)) out.photo_rids.push(m[1]!);
  }

  if (headerXml) {
    const headText = [...headerXml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)]
      .map((m) => unescapeXml(m[1] ?? ''))
      .join('');
    out.header_date = findDate(headText.replace(/…/g, ''));
    const dn = /Doc\.?\s*No\.?\s*:?\s*([^\s]+(?:\s*ASR[^\s]*)?)/i.exec(headText);
    const rawDoc = dn?.[1]?.replace(/\s+/g, '') ?? null;
    out.header_doc_no = rawDoc && !/^[._…-]*$/.test(rawDoc) && !/\.{3,}/.test(rawDoc) ? rawDoc : null;
  }
  if (!out.report_date && out.header_date) out.report_date = out.header_date;
  return out;
}

/* ------------------------------------------------------------------ */
/*  .docx байт → задлан + зураг                                        */
/* ------------------------------------------------------------------ */

export interface DocxImage {
  rid: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  emf: 'image/emf',
  wmf: 'image/wmf',
};

export async function parseAsrDocx(bytes: Uint8Array): Promise<ParsedAsrDoc> {
  const doc = await readZipText(bytes, 'word/document.xml');
  if (!doc) throw new Error('docx: word/document.xml not found');
  const header = (await readZipText(bytes, 'word/header1.xml')) ?? null;
  return parseAsrDocumentXml(doc, header);
}

/**
 * `r:embed` id → `word/media/…` байт.  Зөвхөн хөтөч дээр харагдах зургийн
 * төрөл (EMF/WMF-ийг алгасна — `/media`-аар үзүүлж чадахгүй).
 */
export async function extractDocxImages(bytes: Uint8Array, rids: string[]): Promise<DocxImage[]> {
  if (rids.length === 0) return [];
  const rels = await readZipText(bytes, 'word/_rels/document.xml.rels');
  if (!rels) return [];
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    targets.set(m[1]!, m[2]!);
  }
  // Атрибутын дараалал өөр бичигдсэн байж болно (Target өмнө нь).
  for (const m of rels.matchAll(/<Relationship [^>]*Target="([^"]+)"[^>]*Id="([^"]+)"/g)) {
    if (!targets.has(m[2]!)) targets.set(m[2]!, m[1]!);
  }
  const out: DocxImage[] = [];
  const seen = new Set<string>();
  for (const rid of rids) {
    const target = targets.get(rid);
    if (!target) continue;
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    if (seen.has(path)) continue;
    seen.add(path);
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
    const mime = IMAGE_MIME[ext];
    if (!mime || mime === 'image/emf' || mime === 'image/wmf') continue;
    const data = await readZipEntry(bytes, path);
    if (!data || data.length === 0) continue;
    out.push({ rid, name: path.slice(path.lastIndexOf('/') + 1), mime, bytes: data });
  }
  return out;
}
