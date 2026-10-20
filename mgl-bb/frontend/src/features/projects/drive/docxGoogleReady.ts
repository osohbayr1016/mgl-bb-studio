/**
 * «Эх файлыг нээх» (.docx → Google Docs) — Google дээр navy дэвсгэрийн бичвэр, 1-р хуудас зөв
 * харагдахаар ЭХ файлыг засна (2026-09-30, эзний хүсэлт: «Google Docs болгох» товчийг хасч, эх
 * файлыг нээхэд navy дэвсгэрийн бичвэр цагаан).  Хуулбар, хөрвүүлэлт ҮҮСГЭХГҮЙ — ИЖИЛ Drive
 * файлын шинэ хувилбар (`openInGoogle.ts`).
 *
 * Хэмжсэн (RFI-017, RFI-023: Word-оор гаргасан PDF ↔ Google-ийн өөрийнх нь PDF экспорт):
 *   1. Компанийн RFI загвар «사각형 20» гэсэн, хуудаснаас том navy тэгш өнцөгт агуулдаг —
 *      `hidden="1"`.  Word зурдаггүй; Google hidden-ийг үл тоож бичвэрийн ӨМНӨ зурна → 1-р хуудас
 *      бүхэлдээ navy.  Google-оор нэг дамжсан файлд hidden алга болж Word дээр ч navy болдог
 *      (Drive дээрх RFI-020 яг ийм).
 *   2. navy нүдний «Автомат» өнгөтэй бичвэр — Google ХАР (`docxAutoText.ts`).
 *   3. `numId="0"` (дугаарлалтыг цуцалсан) догол мөр: Word загварын дугаарлалтын догол шилжилтийг
 *      хэрэглэдэггүй, Google хэрэглэдэг («Гарчиг»-ийн эхний мөр нүдний хүрээнд наалдсан).
 *
 * Дүрэм — Word дээр ХАРАГДАХ байдлыг ӨӨРЧЛӨХГҮЙ (2026-10-01 эзний шийдвэр):
 *   • нуусан (hidden) хөвөгч зураг/хэлбэрийг устгана (Word ч зурдаггүй);
 *   • хуудаснаас том, бичвэрийн өмнө, бичвэргүй, тунгалаг бус дүүргэлттэй хэлбэр (Google-ийн
 *     гэмтэл — бүх хуудсыг бүрхдэг) -ийг устгана;
 *   • бараан дэвсгэр дээрх «Автомат» бичвэр → ил цагаан (`docxAutoText.ts`);
 *   • `numId="0"` догол мөрөнд Word-ийн бодит догол шилжилтийг ил бичнэ.
 *   • БҮХ бичвэрийн фонт → Arial (`forceArialFonts`, 2026-10-05 эзний шийдвэр).  Түүх: 9/30 AGFutura
 *     Mon → Calibri болгож байсан, 10-01 «фонт хөндөхгүй» болсон — үр дүн нь Google-д AGFutura
 *     байхгүй тул латин Poppins, кирилл Arial болж ХОЛИЛДДОГ (зарим мөр Poppins, зарим Arial).
 *     Эзэн «бүгдийг нь бүхэлд нь Arial» гэж шийдсэн тул AGFutura/Poppins/тема фонтыг бүгд Arial
 *     болгоно (run, загвар, docDefaults, дугаарлалт).  Тэмдэгт-фонт (Symbol, Wingdings, Webdings,
 *     MS Gothic …) хэвээр — checkbox/bullet glyph эвдрэхгүй.  Хэмжээ, 90% шахалт, мөрийн зай хэвээр.
 *     Ижил файлын шинэ хувилбар болж Drive-д бичигддэг тул Word дээр ч Arial харагдана.
 *
 * Шалгалт: `npm run check:docx-google-ready`.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';
import { attr, fixDocxBytes, matchClose, tagOf, tokenize } from './docxAutoText';

/* ------------------------------------------------------------------ */
/*  Хөвөгч хэлбэр                                                       */
/* ------------------------------------------------------------------ */

const HIDDEN_DOCPR_RE = /<wp:docPr\b[^>]*\bhidden="(?:1|true|on)"/;
const VML_SHAPE_RE = /<v:(?:rect|shape|roundrect|oval|line|group|image|polyline|arc|curve)\b[^>]*\bstyle="([^"]*)"/g;

/** Нуусан хөвөгч объект: DrawingML `docPr hidden` ЭСВЭЛ VML `visibility:hidden` + absolute. */
export function isHiddenFloating(xml: string): boolean {
  if (/<wp:anchor\b/.test(xml) && HIDDEN_DOCPR_RE.test(xml)) return true;
  for (const m of xml.matchAll(VML_SHAPE_RE)) {
    const style = m[1] ?? '';
    if (/visibility:\s*hidden/.test(style) && /position:\s*absolute/.test(style)) return true;
  }
  return false;
}

export interface PageSize {
  /** EMU. */
  w: number;
  h: number;
}

/** A4 — sectPr-гүй хэсэгт. */
const A4: PageSize = { w: 11906 * 635, h: 16838 * 635 };

/**
 * Хуудсыг бүхэлд нь бүрхэх хэлбэр: бичвэрийн ӨМНӨ (behindDoc≠1), ороолтгүй, хуудаснаас том,
 * DrawingML хэлбэр (зураг БИШ), тунгалаг бус цул дүүргэлт, бичвэргүй.  Word-д hidden байсныг
 * Google экспортлохдоо ил болгосон үлдэгдэл — бусад бүх агуулгыг далдалдаг тул утга учиргүй.
 */
export function isPageCover(xml: string, page: PageSize): boolean {
  const anchor = /<wp:anchor\b[^>]*>/.exec(xml)?.[0];
  if (!anchor) return false;
  if (/\bbehindDoc="(?:1|true|on)"/.test(anchor)) return false;
  if (!/<wp:wrapNone\b/.test(xml)) return false;
  const extent = /<wp:extent\b[^>]*>/.exec(xml)?.[0] ?? '';
  const cx = Number(attr(extent, 'cx'));
  const cy = Number(attr(extent, 'cy'));
  if (!(cx >= page.w * 0.95 && cy >= page.h * 0.95)) return false;
  if (!/graphicData uri="[^"]*wordprocessingShape"/.test(xml)) return false;
  const spPr = /<wps:spPr\b[\s\S]*?<\/wps:spPr>/.exec(xml)?.[0] ?? '';
  if (!/<a:solidFill\b/.test(spPr) || /<a:alpha\b/.test(spPr)) return false;
  const text = [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('');
  return text.trim() === '';
}

/** sectPr-ийн `w:pgSz` → EMU (эхнийх). */
export function pageSizeOf(xml: string): PageSize {
  const tag = /<w:pgSz\b[^>]*>/.exec(xml)?.[0];
  const w = tag ? Number(attr(tag, 'w:w')) : Number.NaN;
  const h = tag ? Number(attr(tag, 'w:h')) : Number.NaN;
  return w > 0 && h > 0 ? { w: w * 635, h: h * 635 } : A4;
}

/* ------------------------------------------------------------------ */
/*  Загвар (styles.xml) — numId=0 догол мөрийн догол шилжилт            */
/* ------------------------------------------------------------------ */

type IndAttrs = Record<string, string>;

interface ParaStyle {
  basedOn?: string;
  numId?: string;
  ind?: IndAttrs;
}

export interface ParaStyles {
  byId: Map<string, ParaStyle>;
  defaultId?: string;
  /** docDefaults/pPrDefault-ийн ind. */
  baseInd?: IndAttrs;
}

function indAttrsOf(tag: string | undefined): IndAttrs | undefined {
  if (!tag) return undefined;
  const out: IndAttrs = {};
  for (const m of tag.matchAll(/\s(w:[A-Za-z]+)="([^"]*)"/g)) out[m[1]!] = m[2]!;
  return out;
}

export function parseParaStyles(xml: string): ParaStyles {
  const styles: ParaStyles = { byId: new Map() };
  const def = /<w:pPrDefault\b[\s\S]*?<\/w:pPrDefault>/.exec(xml)?.[0];
  if (def) styles.baseInd = indAttrsOf(/<w:ind\b[^>]*>/.exec(def)?.[0]);
  for (const m of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const head = m[1] ?? '';
    if (!/\bw:type="paragraph"/.test(head)) continue;
    const id = /\bw:styleId="([^"]*)"/.exec(head)?.[1];
    if (!id) continue;
    const body = m[2] ?? '';
    const pPr = /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(body)?.[0] ?? '';
    const style: ParaStyle = {
      basedOn: /<w:basedOn\b[^>]*\bw:val="([^"]*)"/.exec(body)?.[1],
      numId: /<w:numPr\b[\s\S]*?<w:numId\b[^>]*\bw:val="([^"]*)"/.exec(pPr)?.[1],
      ind: indAttrsOf(/<w:ind\b[^>]*>/.exec(pPr)?.[0]),
    };
    styles.byId.set(id, style);
    if (/\bw:default="(?:1|true)"/.test(head)) styles.defaultId = id;
  }
  return styles;
}

function styleChain(styles: ParaStyles, id: string | undefined): ParaStyle[] {
  const out: ParaStyle[] = [];
  let cur = id ?? styles.defaultId;
  for (let guard = 0; cur && guard < 24; guard++) {
    const s = styles.byId.get(cur);
    if (!s) break;
    out.push(s);
    cur = s.basedOn;
  }
  return out;
}

const CHAR_UNITS = ['w:leftChars', 'w:startChars', 'w:rightChars', 'w:endChars', 'w:hangingChars', 'w:firstLineChars'];

/**
 * `numId="0"` догол мөр: Word-ийн бодит догол шилжилтийг (загварын гинж + шууд) ил бичих
 * шаардлагатай юу.  Буцаах: шинэ `w:ind` атрибутууд (өөрчлөлтгүй бол null).
 * Word: дугаарлалтыг цуцалсан тул дугаарлалтын түвшний ind ОРОХГҮЙ — зөвхөн загвар + шууд.
 */
export function explicitIndentFor(
  styles: ParaStyles,
  pStyle: string | undefined,
  direct: IndAttrs | undefined,
): IndAttrs | null {
  const chain = styleChain(styles, pStyle);
  // Загварын гинжинд дугаарлалт байхгүй бол Google-д хэрэглэх дугаарлалт ч байхгүй.
  if (!chain.some((s) => s.numId && s.numId !== '0')) return null;
  const layers = [styles.baseInd, ...[...chain].reverse().map((s) => s.ind), direct].filter(
    (l): l is IndAttrs => l !== undefined,
  );
  // Тэмдэгтийн нэгжтэй (Азийн) догол шилжилт — twip-ээр бодохгүй, хөндөхгүй.
  if (layers.some((l) => CHAR_UNITS.some((k) => l[k] !== undefined && Number(l[k]) !== 0))) return null;
  let left: string | undefined;
  let first: { key: 'w:hanging' | 'w:firstLine'; val: string } | undefined;
  for (const l of layers) {
    const lv = l['w:left'] ?? l['w:start'];
    if (lv !== undefined) left = lv;
    // ECMA-376: hanging байвал firstLine үл тоогдоно.
    if (l['w:hanging'] !== undefined) first = { key: 'w:hanging', val: l['w:hanging'] };
    else if (l['w:firstLine'] !== undefined) first = { key: 'w:firstLine', val: l['w:firstLine'] };
  }
  const next: IndAttrs = { ...(direct ?? {}) };
  let changed = false;
  if (next['w:left'] === undefined && next['w:start'] === undefined) {
    next['w:left'] = left ?? '0';
    changed = true;
  }
  if (next['w:hanging'] === undefined && next['w:firstLine'] === undefined) {
    if (first) next[first.key] = first.val;
    else next['w:firstLine'] = '0';
    changed = true;
  }
  return changed ? next : null;
}

/* ------------------------------------------------------------------ */
/*  Фонт → Arial                                                        */
/* ------------------------------------------------------------------ */

/** Үсэг биш тэмдэгт-фонт — Arial болговол checkbox / bullet glyph эвдэрнэ. */
const SYMBOL_FONT_RE = /^(?:symbol|wingdings(?: [23])?|webdings|marlett|ms gothic|ms mincho|segoe ui symbol|segoe ui emoji)$/i;
const FONT_SLOTS = ['w:ascii', 'w:hAnsi', 'w:cs'];
const FONT_THEME_SLOTS = ['w:asciiTheme', 'w:hAnsiTheme', 'w:cstheme'];
const ARIAL_RFONTS = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>';

/** Backend `docxSign.ts` `arialRunPr`-ийн ихэр — хоёр тал ижил дүрэм баримтална. */
export function forceArialFonts(xml: string): { xml: string; count: number } {
  let count = 0;
  const out = xml.replace(/<w:rFonts\b([^>]*?)\/>/g, (tag, attrStr: string) => {
    const attrs = indAttrsOf(` ${attrStr}`) ?? {};
    const literals = [...FONT_SLOTS, 'w:eastAsia'].map((k) => attrs[k]).filter((v): v is string => v !== undefined);
    if (literals.some((v) => SYMBOL_FONT_RE.test(v.trim()))) return tag;
    const touched = [...FONT_SLOTS, ...FONT_THEME_SLOTS].some((k) => attrs[k] !== undefined);
    if (!touched) return tag;
    const clean =
      FONT_SLOTS.every((k) => attrs[k] === 'Arial') && FONT_THEME_SLOTS.every((k) => attrs[k] === undefined);
    if (clean) return tag;
    const rest = Object.entries(attrs)
      .filter(([k]) => !FONT_SLOTS.includes(k) && !FONT_THEME_SLOTS.includes(k))
      .map(([k, v]) => ` ${k}="${v}"`)
      .join('');
    count++;
    return `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"${rest}/>`;
  });
  return { xml: count > 0 ? out : xml, count };
}

/** docDefaults/rPrDefault-д фонт огт байхгүй бол (Word өөрийн өгөгдмөлийг хэрэглэнэ) Arial нэмнэ. */
function ensureDefaultArial(xml: string): { xml: string; count: number } {
  const m = /<w:rPrDefault>\s*<w:rPr>/.exec(xml);
  if (!m) return { xml, count: 0 };
  const end = xml.indexOf('</w:rPrDefault>', m.index);
  if (end < 0 || /<w:rFonts\b/.test(xml.slice(m.index, end))) return { xml, count: 0 };
  const at = m.index + m[0].length;
  return { xml: xml.slice(0, at) + ARIAL_RFONTS + xml.slice(at), count: 1 };
}

/* ------------------------------------------------------------------ */
/*  Хүүхдийн дараалал                                                   */
/* ------------------------------------------------------------------ */

/** CT_PPr-ийн хүүхдийн дараалал — шинэ `w:ind`-ийг зөв байранд оруулна. */
const PPR_ORDER = [
  'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr', 'w:widowControl', 'w:numPr',
  'w:suppressLineNumbers', 'w:pBdr', 'w:shd', 'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap',
  'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN', 'w:bidi', 'w:adjustRightInd',
  'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc',
  'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr',
  'w:sectPr', 'w:pPrChange',
];

interface Child {
  name: string;
  text: string;
}

/** Элементийн (open..close) ШУУД хүүхдүүд бүтэн бичвэрээр. */
function childrenOf(toks: string[], open: number, close: number): Child[] {
  const kids: Child[] = [];
  for (let t = open + 1; t < close; t++) {
    const tok = toks[t]!;
    const tg = tagOf(tok);
    if (!tg || tg.close) {
      if (!tg && tok.trim() === '') continue;
      kids.push({ name: '#', text: tok });
      continue;
    }
    const end = tg.self ? t : matchClose(toks, t, tg.name);
    const stop = end < 0 ? t : end;
    kids.push({ name: tg.name, text: toks.slice(t, stop + 1).join('') });
    t = stop;
  }
  return kids;
}

function upsertOrdered(kids: Child[], order: string[], name: string, text: string): void {
  const at = kids.findIndex((k) => k.name === name);
  if (at >= 0) {
    kids[at] = { name, text };
    return;
  }
  const rank = order.indexOf(name);
  const before = kids.findIndex((k) => k.name !== '#' && (order.indexOf(k.name) < 0 || order.indexOf(k.name) > rank));
  kids.splice(before < 0 ? kids.length : before, 0, { name, text });
}

const writeInd = (attrs: IndAttrs) =>
  `<w:ind${Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${v}"`)
    .join('')}/>`;

/* ------------------------------------------------------------------ */
/*  Нэг XML хэсэг (document / header / footer …)                       */
/* ------------------------------------------------------------------ */

export interface ReadyContext {
  page: PageSize;
  styles: ParaStyles;
}

export interface ReadyStats {
  hidden: number;
  covers: number;
  indents: number;
  /** Arial болгосон `w:rFonts`-ийн тоо (`forceArialFonts`). */
  fonts: number;
}

export const emptyStats = (): ReadyStats => ({ hidden: 0, covers: 0, indents: 0, fonts: 0 });

export function googleReadyPartXml(xml: string, ctx: ReadyContext): { xml: string; stats: ReadyStats } {
  const stats = emptyStats();
  const toks = tokenize(xml);
  if (!toks) return { xml, stats };
  const out: string[] = [];
  const stack: string[] = [];
  let changed = false;

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    const tg = tagOf(tok);
    if (!tg) {
      out.push(tok);
      continue;
    }
    if (tg.close) {
      stack.pop();
      out.push(tok);
      continue;
    }
    const name = tg.name;

    if (!tg.self) {
      // ---- хөвөгч хэлбэр: AlternateContent бүхэлдээ, эсвэл ганц drawing/pict ----
      const inAlt = stack.includes('mc:AlternateContent');
      if (name === 'mc:AlternateContent' || (!inAlt && (name === 'w:drawing' || name === 'w:pict'))) {
        const end = matchClose(toks, i, name);
        if (end > i) {
          const s = toks.slice(i, end + 1).join('');
          const hidden = isHiddenFloating(s);
          if (hidden || isPageCover(s, ctx.page)) {
            if (hidden) stats.hidden++;
            else stats.covers++;
            changed = true;
            i = end;
            continue;
          }
        }
      }

      // ---- numId=0 догол мөрийн догол шилжилт -------------------------------
      if (name === 'w:pPr' && stack[stack.length - 1] === 'w:p') {
        const end = matchClose(toks, i, 'w:pPr');
        if (end > i) {
          const kids = childrenOf(toks, i, end);
          const numPr = kids.find((k) => k.name === 'w:numPr')?.text ?? '';
          const numId = /<w:numId\b[^>]*\bw:val="([^"]*)"/.exec(numPr)?.[1];
          if (numId === '0') {
            const pStyle = /\bw:val="([^"]*)"/.exec(kids.find((k) => k.name === 'w:pStyle')?.text ?? '')?.[1];
            const directTag = kids.find((k) => k.name === 'w:ind')?.text;
            const next = explicitIndentFor(ctx.styles, pStyle, indAttrsOf(directTag));
            if (next) {
              upsertOrdered(kids, PPR_ORDER, 'w:ind', writeInd(next));
              out.push(tok + kids.map((k) => k.text).join('') + toks[end]!);
              stats.indents++;
              changed = true;
              i = end;
              continue;
            }
          }
        }
      }
    }

    out.push(tok);
    if (!tg.self) stack.push(name);
  }

  const joined = changed ? out.join('') : xml;
  const arial = forceArialFonts(joined);
  stats.fonts += arial.count;
  return { xml: arial.xml, stats };
}

/* ------------------------------------------------------------------ */
/*  .docx                                                              */
/* ------------------------------------------------------------------ */

const CONTENT_RE = /^word\/(document\d*|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
/** Фонтыг нь Arial болгох нэмэлт хэсгүүд: загвар (docDefaults + стиль) ба дугаарлалт. */
const FONT_ONLY_RE = /^word\/(styles|numbering)\.xml$/;
const STORED_RE = /\.(jpe?g|png|gif|mp4|m4a|mp3|wdp|jfif)$/i;

export interface GoogleReadyResult {
  bytes: Uint8Array;
  /** Google дээр зөв харагдахаар өөрчлөгдсөн эсэх — false бол ЭХ байт. */
  changed: boolean;
  /** navy бичвэрийг цагаан болгосон run/тэмдгийн тоо (`docxAutoText`). */
  whitened: number;
  stats: ReadyStats;
}

export function prepareDocxForGoogle(input: Uint8Array): GoogleReadyResult {
  const white = fixDocxBytes(input);
  const src = white.bytes;
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const raw = unzipSync(src, { filter: (f) => CONTENT_RE.test(f.name) || FONT_ONLY_RE.test(f.name) });
  const parts: Record<string, string> = {};
  for (const [name, data] of Object.entries(raw)) parts[name] = dec.decode(data);

  const styles = parseParaStyles(parts['word/styles.xml'] ?? '');
  const page = pageSizeOf(parts['word/document.xml'] ?? '');

  const stats = emptyStats();
  const replaced = new Map<string, Uint8Array>();
  for (const [name, xml] of Object.entries(parts)) {
    if (!CONTENT_RE.test(name)) continue;
    const r = googleReadyPartXml(xml, { page, styles });
    if (r.xml !== xml) replaced.set(name, enc.encode(r.xml));
    stats.hidden += r.stats.hidden;
    stats.covers += r.stats.covers;
    stats.indents += r.stats.indents;
    stats.fonts += r.stats.fonts;
  }
  for (const [name, xml] of Object.entries(parts)) {
    if (!FONT_ONLY_RE.test(name)) continue;
    let r = forceArialFonts(xml);
    if (name === 'word/styles.xml') {
      const d = ensureDefaultArial(r.xml);
      r = { xml: d.xml, count: r.count + d.count };
    }
    if (r.xml !== xml) replaced.set(name, enc.encode(r.xml));
    stats.fonts += r.count;
  }
  if (replaced.size === 0) {
    return { bytes: src, changed: white.changed > 0, whitened: white.changed, stats };
  }
  const files: Zippable = {};
  for (const [name, data] of Object.entries(unzipSync(src))) {
    files[name] = [replaced.get(name) ?? data, { level: STORED_RE.test(name) ? 0 : 6 }];
  }
  return { bytes: zipSync(files), changed: true, whitened: white.changed, stats };
}
