/**
 * .docx доторх БАРААН дэвсгэр дээрх «Автомат» өнгөтэй текстийг ил ЦАГААН болгоно
 * (2026-09-30, эзний хүсэлт: RFI-ийн navy нүдний текст Google Docs-т хар гарч байв).
 *
 * Шалтгаан (прод дээрх RFI файлуудаар хэмжсэн): RFI загварын navy нүд
 * (`w:shd w:fill="0F243E"`) дотор текст ӨНГӨГҮЙ — Word-ийн «Automatic» өнгө.
 * Word тэр өнгийг дэвсгэр бараан бол ЦАГААН, цайвар бол хар болгож зурдаг;
 * Google Docs (хөрвүүлэлт) ба `docx-preview` (хуудсан доторх харагдац) хоёулаа
 * «auto»-г ХАР гэж уншдаг.  Google-оор нэг удаа дамжсан файлд (EVGR RFI-020)
 * тэр хар нь ил `w:color w:val="000000"` болж хадгалагдсан байв.
 *
 * Дүрэм (Word-ийн «auto» зан төлөвийг ил болгох):
 *   • дэвсгэр = run-ий shd → догол мөрийн shd → нүд → мөр → хүснэгт (шууд
 *     формат, дараа нь загварын (style) утга); highlight ТООЦОГДОХГҮЙ — Word ч
 *     тооцдоггүй (2026-09-30 хэмжсэн: хар highlight дээрх auto «□» хар хэвээр =
 *     RFI-ийн сонгосон checkbox); text box дотор дэвсгэр тодорхойгүй тул ХӨНДӨХГҮЙ;
 *   • дэвсгэр «бараан» = цагаан текст хар текстээс илүү ялгардаг (WCAG-ийн
 *     харьцуулалт, гэрэлтэлт < 0.179);
 *   • тэр үед текстийн үр дүнгийн өнгө (шууд → run-ий загвар → догол мөрийн
 *     загвар → хүснэгтийн загвар → docDefaults) нь «auto» ЭСВЭЛ дэвсгэртэйгээ
 *     2:1-ээс бага ялгаралтай (уншигдахгүй — Google-оор дамжсан хар) бол
 *     `<w:color w:val="FFFFFF"/>` бичнэ.  Бусад ил өнгө (улаан тэмдэглэл г.м.) хэвээр.
 *
 * ⚠️ ЗӨВХӨН өнгө: шрифт, хэмжээ, хүснэгт, мөр, зураг — ямар ч элемент нэмэгдэж
 * хасагдахгүй; зөвхөн run/догол мөрийн тэмдгийн `w:rPr` дотор `w:color` нэмэгдэнэ
 * эсвэл солигдоно.  Өөрчлөгдөөгүй XML хэсэг, зураг, бусад бүх файл байт-ижил
 * (ZIP-ийн шахалт л дахин хийгдэнэ).  Юу ч өөрчлөх шаардлагагүй бол ЭХ байтыг
 * буцаана.  Токенжуулалт эх бичвэрийг бүрэн сэргээхгүй бол (эвдэрсэн XML) тэр
 * хэсгийг огт хөндөхгүй.
 *
 * Хэрэглэгч: `DriveFilePreviewDialog` — хуудсан доторх харагдац; `docxGoogleReady.ts`
 * — «Эх файлыг нээх» дээр ИЖИЛ .docx-ийн шинэ хувилбар (Google-д navy бичвэр цагаан).
 * Шалгалт: `npm run check:docx-auto-text`.
 */
import { unzipSync, zipSync, type Zippable } from 'fflate';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const WHITE = 'FFFFFF';

/* ------------------------------------------------------------------ */
/*  Өнгө                                                               */
/* ------------------------------------------------------------------ */

/** Зургаан оронтой том үсгийн hex, «auto» эсвэл тодорхойгүй. */
type ColorVal = string; // 'auto' | 'RRGGBB'
/** Дэвсгэр: hex = будагдсан, null = ил тунгалаг (гадна тийш харна), undefined = заагаагүй. */
type Bg = string | null | undefined;

const UNKNOWN = 'unknown' as const;

function hexOf(v: string | undefined): string | null {
  return v && /^[0-9a-f]{6}$/i.test(v) ? v.toUpperCase() : null;
}

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG-ийн харьцангуй гэрэлтэлт (0 = хар, 1 = цагаан). */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 2) + 0.0722 * channel(hex, 4);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Цагаан текст хараас илүү ялгардаг дэвсгэр (≈ гэрэлтэлт < 0.179). */
export function isDarkFill(hex: string): boolean {
  return contrastRatio(hex, WHITE) > contrastRatio(hex, '000000');
}

/** Ил өнгө энэ ялгаралтаас доош бол «уншигдахгүй» — цагаан болгоно. */
const ILLEGIBLE_CONTRAST = 2;

function mix(fg: string, bg: string, t: number): string {
  let out = '';
  for (let i = 0; i < 6; i += 2) {
    const f = parseInt(fg.slice(i, i + 2), 16);
    const b = parseInt(bg.slice(i, i + 2), 16);
    out += Math.round(f * t + b * (1 - t))
      .toString(16)
      .padStart(2, '0');
  }
  return out.toUpperCase();
}

const HIGHLIGHT: Record<string, string> = {
  black: '000000',
  blue: '0000FF',
  cyan: '00FFFF',
  green: '00FF00',
  magenta: 'FF00FF',
  red: 'FF0000',
  yellow: 'FFFF00',
  white: 'FFFFFF',
  darkBlue: '000080',
  darkCyan: '008080',
  darkGreen: '008000',
  darkMagenta: '800080',
  darkRed: '800000',
  darkYellow: '808000',
  darkGray: '808080',
  lightGray: 'C0C0C0',
};

/* ------------------------------------------------------------------ */
/*  Токен                                                              */
/* ------------------------------------------------------------------ */

/** Сэтгэгдэл, CDATA, таг (хашилтан доторх `>`-г тооцно), текст. */
const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+/g;

export interface Tag {
  name: string;
  close: boolean;
  self: boolean;
}

export function tagOf(tok: string): Tag | null {
  if (tok.charCodeAt(0) !== 60 /* < */) return null;
  const second = tok.charCodeAt(1);
  if (second === 33 /* ! */ || second === 63 /* ? */) return null;
  const m = /^<\/?([^\s/>]+)/.exec(tok);
  if (!m) return null;
  const close = second === 47; /* / */
  return { name: m[1]!, close, self: !close && tok.endsWith('/>') };
}

const attrRe = new Map<string, RegExp>();
export function attr(tok: string, name: string): string | undefined {
  let re = attrRe.get(name);
  if (!re) {
    re = new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    attrRe.set(name, re);
  }
  const m = re.exec(tok);
  return m ? (m[1] ?? m[2]) : undefined;
}

export function tokenize(xml: string): string[] | null {
  const toks = xml.match(TOKEN_RE) ?? [];
  // Бүрэн сэргээгдэхгүй бол (эвдэрсэн `<`) хэсгийг хөндөхгүй — алдагдал < хар текст.
  let len = 0;
  for (const t of toks) len += t.length;
  return len === xml.length ? toks : null;
}

function isBlank(tok: string): boolean {
  return tok.charCodeAt(0) !== 60 && tok.trim() === '';
}

/** `w:color` → 'auto' | hex; танигдахгүй бол undefined (тооцохгүй). */
function colorOf(tok: string): ColorVal | undefined {
  const val = attr(tok, 'w:val');
  if (val === 'auto') return 'auto';
  return hexOf(val) ?? undefined;
}

/** `w:shd` → хэвийн дэвсгэр.  pctN хээг дүүргэлттэй нь холино. */
function shdOf(tok: string): Bg {
  const val = attr(tok, 'w:val') ?? 'clear';
  if (val === 'nil') return null;
  const fill = hexOf(attr(tok, 'w:fill'));
  const rawColor = attr(tok, 'w:color');
  const pattern = hexOf(rawColor) ?? (rawColor === undefined || rawColor === 'auto' ? '000000' : null);
  if (val === 'clear') return fill;
  if (val === 'solid') return pattern;
  const pct = /^pct(\d+)$/.exec(val);
  if (pct && pattern) {
    const t = Math.min(100, Number(pct[1])) / 100;
    if (!fill && t === 0) return null;
    return mix(pattern, fill ?? WHITE, t);
  }
  return fill;
}

function highlightOf(tok: string): Bg {
  const val = attr(tok, 'w:val');
  if (!val || val === 'none') return null;
  return HIGHLIGHT[val] ?? undefined;
}

/* ------------------------------------------------------------------ */
/*  Загвар (styles.xml)                                                */
/* ------------------------------------------------------------------ */

interface StyleDef {
  basedOn?: string;
  color?: ColorVal;
  rShd?: Bg;
  highlight?: Bg;
  pShd?: Bg;
  tcShd?: Bg;
  tblShd?: Bg;
}

export interface DocxStyles {
  byId: Map<string, StyleDef>;
  defaultParagraph?: string;
  defaultTable?: string;
  docColor?: ColorVal;
}

/** Загварын ЗӨВХӨН үндсэн шинжүүд — `w:tblStylePr` (нөхцөлт формат) орохгүй. */
export function parseStyles(xml: string): DocxStyles {
  const styles: DocxStyles = { byId: new Map() };
  const toks = tokenize(xml);
  if (!toks) return styles;
  const stack: string[] = [];
  let cur: StyleDef | null = null;
  let curBase = -1;
  for (const tok of toks) {
    const tg = tagOf(tok);
    if (!tg) continue;
    if (tg.close) {
      stack.pop();
      if (cur && stack.length === curBase) cur = null;
      continue;
    }
    if (tg.name === 'w:style' && !tg.self) {
      const id = attr(tok, 'w:styleId');
      cur = {};
      curBase = stack.length;
      if (id) {
        styles.byId.set(id, cur);
        if (attr(tok, 'w:default') === '1' || attr(tok, 'w:default') === 'true') {
          const type = attr(tok, 'w:type');
          if (type === 'paragraph') styles.defaultParagraph = id;
          if (type === 'table') styles.defaultTable = id;
        }
      }
    } else if (cur) {
      // Загварын доторх зам: [ ..., w:style, <хүүхэд>, <ач> ]
      const rel = stack.slice(curBase + 1);
      if (rel.length === 0 && tg.name === 'w:basedOn') cur.basedOn = attr(tok, 'w:val');
      if (rel.length === 1) {
        const parent = rel[0];
        if (parent === 'w:rPr') {
          if (tg.name === 'w:color') cur.color = colorOf(tok);
          else if (tg.name === 'w:shd') cur.rShd = shdOf(tok);
          else if (tg.name === 'w:highlight') cur.highlight = highlightOf(tok);
        } else if (tg.name === 'w:shd') {
          if (parent === 'w:pPr') cur.pShd = shdOf(tok);
          else if (parent === 'w:tcPr') cur.tcShd = shdOf(tok);
          else if (parent === 'w:tblPr') cur.tblShd = shdOf(tok);
        }
      }
    } else if (tg.name === 'w:color' && stack.slice(-3).join('/') === 'w:docDefaults/w:rPrDefault/w:rPr') {
      styles.docColor = colorOf(tok);
    }
    if (!tg.self) stack.push(tg.name);
  }
  return styles;
}

/** `basedOn` гинжээр анхны заасан утга (мөчлөгөөс хамгаална). */
function fromChain<T>(styles: DocxStyles, id: string | undefined, pick: (s: StyleDef) => T | undefined): T | undefined {
  let cur = id;
  for (let guard = 0; cur && guard < 24; guard++) {
    const s = styles.byId.get(cur);
    if (!s) return undefined;
    const v = pick(s);
    if (v !== undefined) return v;
    cur = s.basedOn;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Нэг XML хэсэг (document / header / footer / footnotes)             */
/* ------------------------------------------------------------------ */

interface Ctx {
  kind: 'tbl' | 'tr' | 'tc' | 'p' | 'txbx';
  depth: number;
  bg?: Bg;
  style?: string;
  /** Зөвхөн p: догол мөрийн тэмдгийн rPr шийдэгдсэн. */
  markDone?: boolean;
}

interface RPrInfo {
  rStyle?: string;
  color?: ColorVal;
  shd?: Bg;
  highlight?: Bg;
  /** Шууд `w:color` элементийн токенуудын муж [эхлэл, төгсгөл]. */
  colorAt?: [number, number];
  /** `w:color`-ийг оруулах токен (түүний ӨМНӨ); байхгүй бол хаах таг. */
  insertAt: number;
}

/** CT_RPr-ийн дараалалд `w:color`-ийн ДАРАА ирдэг элементүүд. */
const AFTER_COLOR = new Set([
  'w:spacing',
  'w:w',
  'w:kern',
  'w:position',
  'w:sz',
  'w:szCs',
  'w:highlight',
  'w:u',
  'w:effect',
  'w:bdr',
  'w:shd',
  'w:fitText',
  'w:vertAlign',
  'w:rtl',
  'w:cs',
  'w:em',
  'w:lang',
  'w:eastAsianLayout',
  'w:specVanish',
  'w:oMath',
  'w:rPrChange',
]);

const COLOR_TAG = `<w:color w:val="${WHITE}"/>`;
const RPR_WHITE = `<w:rPr>${COLOR_TAG}</w:rPr>`;

/** `open` дээрх элементийн хаах тагийн индекс (ижил нэрийн гүнээр); олдохгүй бол -1. */
export function matchClose(toks: string[], open: number, name: string): number {
  let depth = 0;
  for (let t = open; t < toks.length; t++) {
    const tg = tagOf(toks[t]!);
    if (!tg || tg.name !== name || tg.self) continue;
    depth += tg.close ? -1 : 1;
    if (depth === 0) return t;
  }
  return -1;
}

/** rPr-ийн ШУУД хүүхдүүдийг уншина (`w:rPrChange` доторх хуучин утга орохгүй). */
function scanRPr(toks: string[], open: number, close: number): RPrInfo {
  const info: RPrInfo = { insertAt: close };
  let depth = 0;
  let insertFound = false;
  for (let t = open + 1; t < close; t++) {
    const tg = tagOf(toks[t]!);
    if (!tg) continue;
    if (tg.close) {
      depth--;
      continue;
    }
    if (depth === 0) {
      const tok = toks[t]!;
      if (tg.name === 'w:rStyle') info.rStyle = attr(tok, 'w:val');
      else if (tg.name === 'w:color') {
        info.color = colorOf(tok);
        info.colorAt = [t, tg.self ? t : matchClose(toks, t, 'w:color')];
      } else if (tg.name === 'w:shd') info.shd = shdOf(tok);
      else if (tg.name === 'w:highlight') info.highlight = highlightOf(tok);
      if (!insertFound && AFTER_COLOR.has(tg.name)) {
        info.insertAt = t;
        insertFound = true;
      }
    }
    if (!tg.self) depth++;
  }
  return info;
}

export interface PartFix {
  xml: string;
  /** Цагаан болгосон run + догол мөрийн тэмдгийн тоо. */
  changed: number;
}

export function fixPartXml(xml: string, styles: DocxStyles): PartFix {
  const toks = tokenize(xml);
  if (!toks) return { xml, changed: 0 };

  const stack: string[] = [];
  const ctxs: Ctx[] = [];
  const out: string[] = [];
  let changed = 0;

  const parentIs = (name: string, grand?: string) =>
    stack[stack.length - 1] === name && (grand === undefined || stack[stack.length - 2] === grand);
  const nearest = (kind: Ctx['kind']): Ctx | undefined => {
    for (let k = ctxs.length - 1; k >= 0; k--) if (ctxs[k]!.kind === kind) return ctxs[k];
    return undefined;
  };

  /** Догол мөр ба түүний савнуудын дэвсгэр (дотроос гадагш). */
  const containerBg = (): string | null | typeof UNKNOWN => {
    for (let k = ctxs.length - 1; k >= 0; k--) {
      const c = ctxs[k]!;
      if (c.kind === 'txbx') return UNKNOWN;
      let bg: Bg = c.bg;
      if (c.kind === 'p' && bg === undefined) {
        bg = fromChain(styles, c.style ?? styles.defaultParagraph, (s) => s.pShd);
      } else if (c.kind === 'tc' && bg === undefined) {
        const tbl = ctxs.slice(0, k).reverse().find((x) => x.kind === 'tbl');
        bg = fromChain(styles, tbl?.style ?? styles.defaultTable, (s) => s.tcShd);
      } else if (c.kind === 'tbl' && bg === undefined) {
        bg = fromChain(styles, c.style ?? styles.defaultTable, (s) => s.tblShd);
      }
      if (bg) return bg;
    }
    return null;
  };

  /** Загвар/defaults-аас текстийн өнгө (шууд утгагүй үед). */
  const inheritedColor = (rStyle: string | undefined): ColorVal => {
    const p = nearest('p');
    const tbl = nearest('tbl');
    return (
      fromChain(styles, rStyle, (s) => s.color) ??
      fromChain(styles, p?.style ?? styles.defaultParagraph, (s) => s.color) ??
      (tbl ? fromChain(styles, tbl.style ?? styles.defaultTable, (s) => s.color) : undefined) ??
      styles.docColor ??
      'auto'
    );
  };

  /** Цагаан болгох уу. */
  const needsWhite = (info: Partial<RPrInfo> | null, withRunBg: boolean): boolean => {
    let bg: string | null | typeof UNKNOWN = null;
    let highlighted = false;
    if (withRunBg) {
      const hl = info?.highlight !== undefined ? info.highlight : fromChain(styles, info?.rStyle, (s) => s.highlight);
      const shd = info?.shd !== undefined ? info.shd : fromChain(styles, info?.rStyle, (s) => s.rShd);
      highlighted = !!hl;
      // Word «Автомат» өнгийг ЗӨВХӨН дүүргэлтээр (run → догол мөр → нүд) шийддэг,
      // highlight-ийг огт тооцдоггүй (2026-09-30 Word-оор хэмжсэн: хар/хар-хөх highlight
      // дээр хар хэвээр, бараан нүдэн доторх highlight дээр цагаан).  RFI-ийн сонгосон
      // checkbox = хар highlight + auto «□» → Word дээр бүтэн хар дөрвөлжин.
      bg = shd || containerBg();
    } else {
      bg = containerBg();
    }
    if (!bg || bg === UNKNOWN || !isDarkFill(bg)) return false;
    const color = info?.color ?? inheritedColor(info?.rStyle);
    if (color === 'auto') return true;
    // Ил өнгийн ард highlight харагддаг — highlight дээрх ил хар «□» нь зориудын
    // бүтэн хар дөрвөлжин (сонгосон checkbox — EVGR RFI-020) тул хөндөхгүй.
    if (highlighted) return false;
    return contrastRatio(color, bg) < ILLEGIBLE_CONTRAST;
  };

  /** rPr (open..close) -ийг хэрэгтэй бол засаж гаргана. */
  const emitRPr = (open: number, close: number, withRunBg: boolean) => {
    const info = scanRPr(toks, open, close);
    if (!needsWhite(info, withRunBg)) {
      for (let t = open; t <= close; t++) out.push(toks[t]!);
      return;
    }
    changed++;
    for (let t = open; t <= close; t++) {
      if (info.colorAt && t === info.colorAt[0]) {
        out.push(COLOR_TAG);
        t = Math.max(t, info.colorAt[1]);
        continue;
      }
      if (!info.colorAt && t === info.insertAt) out.push(COLOR_TAG);
      out.push(toks[t]!);
    }
  };

  /** Хоосон биш дараагийн токены индекс. */
  const nextSolid = (from: number): number => {
    let j = from;
    while (j < toks.length && isBlank(toks[j]!)) j++;
    return j;
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i]!;
    const tg = tagOf(tok);
    if (!tg) {
      out.push(tok);
      continue;
    }

    if (tg.close) {
      // Догол мөрийн тэмдэг rPr-гүй байсан бол `</w:pPr>`-ийн өмнө.
      if (tg.name === 'w:pPr' && parentIs('w:pPr', 'w:p')) {
        const p = nearest('p');
        if (p && !p.markDone) {
          p.markDone = true;
          if (needsWhite(null, false)) {
            out.push(RPR_WHITE);
            changed++;
          }
        }
      }
      const c = ctxs[ctxs.length - 1];
      if (c && c.depth === stack.length) ctxs.pop();
      stack.pop();
      out.push(tok);
      continue;
    }

    const name = tg.name;

    // ---- run ----------------------------------------------------------
    if (name === 'w:r' && !tg.self) {
      out.push(tok);
      stack.push(name);
      const j = nextSolid(i + 1);
      for (let t = i + 1; t < j; t++) out.push(toks[t]!);
      const next = j < toks.length ? tagOf(toks[j]!) : null;
      if (next && next.name === 'w:rPr' && !next.close) {
        if (next.self) {
          if (needsWhite({}, true)) {
            out.push(RPR_WHITE);
            changed++;
          } else out.push(toks[j]!);
          i = j;
          continue;
        }
        const k = matchClose(toks, j, 'w:rPr');
        if (k > 0) {
          emitRPr(j, k, true);
          i = k;
        } else i = j - 1; // эвдэрсэн rPr — хөндөхгүй
        continue;
      }
      if (needsWhite({}, true)) {
        out.push(RPR_WHITE);
        changed++;
      }
      i = j - 1;
      continue;
    }

    // ---- догол мөрийн тэмдэг -----------------------------------------
    if (name === 'w:rPr' && parentIs('w:pPr', 'w:p')) {
      const p = nearest('p');
      if (p) p.markDone = true;
      if (tg.self) {
        if (needsWhite({}, false)) {
          out.push(RPR_WHITE);
          changed++;
        } else out.push(tok);
        continue;
      }
      const k = matchClose(toks, i, 'w:rPr');
      if (k > 0) {
        emitRPr(i, k, false);
        i = k;
        continue;
      }
    }
    if ((name === 'w:sectPr' || name === 'w:pPrChange') && parentIs('w:pPr', 'w:p')) {
      const p = nearest('p');
      if (p && !p.markDone) {
        p.markDone = true;
        if (needsWhite(null, false)) {
          out.push(RPR_WHITE);
          changed++;
        }
      }
    }

    // ---- шинж ба дэвсгэр ---------------------------------------------
    if (name === 'w:shd') {
      if (parentIs('w:pPr', 'w:p')) {
        const p = nearest('p');
        if (p) p.bg = shdOf(tok);
      } else if (parentIs('w:tcPr', 'w:tc')) {
        const c = nearest('tc');
        if (c) c.bg = shdOf(tok);
      } else if (parentIs('w:tblPrEx', 'w:tr')) {
        const c = nearest('tr');
        if (c) c.bg = shdOf(tok);
      } else if (parentIs('w:tblPr', 'w:tbl')) {
        const c = nearest('tbl');
        if (c) c.bg = shdOf(tok);
      }
    } else if (name === 'w:pStyle' && parentIs('w:pPr', 'w:p')) {
      const p = nearest('p');
      if (p) p.style = attr(tok, 'w:val');
    } else if (name === 'w:tblStyle' && parentIs('w:tblPr', 'w:tbl')) {
      const c = nearest('tbl');
      if (c) c.style = attr(tok, 'w:val');
    }

    // ---- догол мөр -----------------------------------------------------
    if (name === 'w:p') {
      if (tg.self) {
        // `<w:p/>` — хоосон догол мөр.
        ctxs.push({ kind: 'p', depth: stack.length + 1 });
        const white = needsWhite(null, false);
        ctxs.pop();
        if (white) {
          out.push(`${tok.slice(0, -2).trimEnd()}><w:pPr>${RPR_WHITE}</w:pPr></w:p>`);
          changed++;
        } else out.push(tok);
        continue;
      }
      out.push(tok);
      stack.push(name);
      const p: Ctx = { kind: 'p', depth: stack.length };
      ctxs.push(p);
      const j = nextSolid(i + 1);
      const next = j < toks.length ? tagOf(toks[j]!) : null;
      if (!next || next.name !== 'w:pPr' || next.close) {
        // pPr-гүй догол мөр — pPr нь ЭХНИЙ хүүхэд байх ёстой тул энд.
        p.markDone = true;
        if (needsWhite(null, false)) {
          out.push(`<w:pPr>${RPR_WHITE}</w:pPr>`);
          changed++;
        }
      }
      continue;
    }
    if (name === 'w:pPr' && tg.self && parentIs('w:p')) {
      const p = nearest('p');
      if (p && !p.markDone) {
        p.markDone = true;
        if (needsWhite(null, false)) {
          out.push(`<w:pPr>${RPR_WHITE}</w:pPr>`);
          changed++;
          continue;
        }
      }
      out.push(tok);
      continue;
    }

    out.push(tok);
    if (tg.self) continue;
    stack.push(name);
    if (name === 'w:tbl') ctxs.push({ kind: 'tbl', depth: stack.length });
    else if (name === 'w:tr') ctxs.push({ kind: 'tr', depth: stack.length });
    else if (name === 'w:tc') ctxs.push({ kind: 'tc', depth: stack.length });
    else if (name === 'w:txbxContent') ctxs.push({ kind: 'txbx', depth: stack.length });
  }

  return changed > 0 ? { xml: out.join(''), changed } : { xml, changed: 0 };
}

/* ------------------------------------------------------------------ */
/*  .docx (ZIP)                                                        */
/* ------------------------------------------------------------------ */

/** Текст агуулдаг хэсгүүд. */
const PART_RE = /^word\/(document\d*|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
/** Аль хэдийн шахагдсан медиа — дахин шахахгүй (хурд). */
const STORED_RE = /\.(jpe?g|png|gif|mp4|m4a|mp3|wdp|jfif)$/i;

export interface DocxFix {
  bytes: Uint8Array;
  changed: number;
  parts: string[];
}

export function fixDocxBytes(input: Uint8Array): DocxFix {
  const xmlParts = unzipSync(input, { filter: (f) => f.name === 'word/styles.xml' || PART_RE.test(f.name) });
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  const stylesRaw = xmlParts['word/styles.xml'];
  const styles = parseStyles(stylesRaw ? dec.decode(stylesRaw) : '');
  const replaced = new Map<string, Uint8Array>();
  let changed = 0;
  for (const [name, data] of Object.entries(xmlParts)) {
    if (!PART_RE.test(name)) continue;
    const r = fixPartXml(dec.decode(data), styles);
    if (r.changed > 0) {
      replaced.set(name, enc.encode(r.xml));
      changed += r.changed;
    }
  }
  if (changed === 0) return { bytes: input, changed: 0, parts: [] };

  const all = unzipSync(input);
  const files: Zippable = {};
  for (const [name, data] of Object.entries(all)) {
    files[name] = [replaced.get(name) ?? data, { level: STORED_RE.test(name) ? 0 : 6 }];
  }
  return { bytes: zipSync(files), changed, parts: [...replaced.keys()] };
}

/** Blob хувилбар — өөрчлөлтгүй бол ЭХ blob-ыг буцаана. */
export async function fixDocxBlob(blob: Blob): Promise<{ blob: Blob; changed: number }> {
  const r = fixDocxBytes(new Uint8Array(await blob.arrayBuffer()));
  if (r.changed === 0) return { blob, changed: 0 };
  return { blob: new Blob([r.bytes as BlobPart], { type: DOCX_MIME }), changed: r.changed };
}
