/**
 * MGL AI · MARKDOWN ЗАДЛАН ШИНЖИЛГЭЭ — УРСГАЛД ЗОРИУЛСАН (§21–§24).
 *
 * ⚠️ ЯАГААД САНГИЙН ОРОНД ӨӨРСДӨӨ БИЧСЭН ВЭ.  Гурван шалтгаан, гуравдахь
 *    нь ШИЙДВЭРЛЭХ:
 *
 *      1. `react-markdown` + `remark-gfm` + `rehype-sanitize` нь gzip-д
 *         ~45 KB нэмнэ.  MGL AI нь залхуу ачаалагддаг хуудас тул тэр нь
 *         үхлийн зүйл биш ч үнэгүй ч биш.
 *      2. САНИТАРЧЛАЛ.  Бид ХЭЗЭЭ Ч `dangerouslySetInnerHTML` хэрэглэхгүй —
 *         React элемент шууд угсарна.  Тэгснээр XSS-ийн гадаргуу
 *         БҮРМӨСӨН БАЙХГҮЙ, санитарчлагчийн тохиргоо буруу байх эрсдэл
 *         ч байхгүй (§22).
 *      3. ⚠️ УРСГАЛ.  Ерөнхий сангууд нь БҮХ баримтыг токен бүрд ДАХИН
 *         задлан шинжилдэг.  5 000 токенын хариултад тэр нь секундэд 60
 *         удаа 20 KB задлах гэсэн үг — React-ийн зохион байгуулалт нь
 *         бүх мод дахин барихад НЭМЖ орно (§24-ийн шууд шаардлага:
 *         «avoid repeatedly rebuilding the entire Markdown component
 *         tree for every character»).
 *
 *         Энэ модуль нь ТОГТСОН УГТВАРЫГ кэшлэнэ: сүүлийн бүрэн БЛОКоос
 *         өмнөх бүх зүйл дахин задлагдахгүй.  Токен ирэхэд ЗӨВХӨН сүүлийн
 *         блок дахин задлагдана.
 *
 * ⚠️ ЭНЭ ФАЙЛ ЦЭВЭР — React, DOM энд БАЙХГҮЙ.  `check-ai-markdown.mjs`
 *    нь хөтөчгүйгээр бүх хувилбарыг шалгана.
 *
 * ⚠️ ДЭМЖИХ ЗҮЙЛСИЙН ХИЛ (§21).  Гарчиг · тод · налуу · мөрийн код ·
 *    жагсаалт (дугаартай/дугааргүй, үүрлэсэн) · хүснэгт · ишлэл · кодын
 *    блок · хэвтээ зураас · холбоос · эшлэлийн тэмдэг `[1]`.  ЭНЭ ЖАГСААЛТ
 *    ЗОРИУД БОГИНО: HTML, зураг, footnote зэрэг нь хариултад гарах
 *    ёсгүй бөгөөд дэмжих нь гадаргууг л нэмнэ.
 */

/* ================================================================== */
/*  МӨРИЙН ДОТОРХ (INLINE)                                             */
/* ================================================================== */

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: InlineNode[] }
  | { t: 'em'; c: InlineNode[] }
  | { t: 'code'; v: string }
  /**
   * ⚠️ ЭШЛЭЛ НЬ ТУСДАА ЗАНГИЛАА, ЭНГИЙН ТЕКСТ БИШ.  `[3]` гэсэн тэмдэг нь
   *    дарагдах ёстой (эх сурвалж руу үсрэх) бөгөөд СЕРВЕР дээр дахин
   *    шийдэгддэг (`resolveCitations`).  Түүнийг текст болгон үлдээвэл
   *    UI нь эшлэлийг ялгаж чадахгүй.
   */
  | { t: 'cite'; n: number }
  | { t: 'link'; href: string; c: InlineNode[] };

/**
 * ⚠️ ЗӨВХӨН АЮУЛГҮЙ СХЕМ.  `javascript:`, `data:` нь `<a href>`-ээр
 *    дамжуулан скрипт ажиллуулах сонгодог зам.  Бид React элемент
 *    угсардаг тул HTML тарилга байхгүй ч href нь ТУСДАА гадаргуу.
 */
export function safeHref(raw: string): string | null {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (/^mailto:/i.test(v)) return v;
  // ⚠️ Харьцангуй зам нь ERP-ийн дотоод холбоос байж болно — зөвшөөрнө.
  if (/^\/[^/]/.test(v)) return v;
  return null;
}

/**
 * Мөрийн доторх бичиглэлийг задлана.
 *
 * ⚠️ ЭНЭ НЬ БҮРЭН CommonMark БИШ, ЗОРИУД.  Бүрэн хэрэгжүүлэлт нь
 *    хэдэн зуун мөр бөгөөд бидний хариултад гарахгүй тохиолдлуудыг
 *    (нөхцөлт лавлагаа, HTML entity, зурагт холбоос) шийддэг.  Энд
 *    ЗАДЛАГДААГҮЙ зүйл нь ЭНГИЙН ТЕКСТ болж гарна — өөрөөр хэлбэл
 *    хамгийн муу тохиолдол нь «форматлагдаагүй», «эвдэрсэн» БИШ.
 */
export function parseInline(src: string): InlineNode[] {
  const out: InlineNode[] = [];
  let buf = '';

  const flush = () => {
    if (buf.length > 0) {
      out.push({ t: 'text', v: buf });
      buf = '';
    }
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;

    // ── Мөрийн код `…` ─────────────────────────────────────────
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ t: 'code', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    // ── Тод **…** ──────────────────────────────────────────────
    if (ch === '*' && src[i + 1] === '*') {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    // ── Налуу *…* эсвэл _…_ ────────────────────────────────────
    // ⚠️ `_` нь МОНГОЛ, англи танигчид дунд гарч болно (`user_id`) тул
    //    зөвхөн үгийн ХИЛ дээр л налуу гэж үзнэ.
    if (ch === '*' || (ch === '_' && (i === 0 || /[\s(«"']/.test(src[i - 1]!)))) {
      const end = src.indexOf(ch, i + 1);
      if (end > i + 1 && !/\s/.test(src[i + 1]!)) {
        flush();
        out.push({ t: 'em', c: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    // ── Холбоос [текст](хаяг) ──────────────────────────────────
    if (ch === '[') {
      const close = src.indexOf(']', i + 1);
      if (close > i) {
        const label = src.slice(i + 1, close);

        // ⚠️ ЭШЛЭЛ — `[3]` гэсэн ЦЭВЭР ТОО.  Холбоосоос ӨМНӨ шалгана,
        //    учир нь `[3](…)` гэсэн хэлбэр гарахгүй.
        if (/^\d{1,3}$/.test(label) && src[close + 1] !== '(') {
          flush();
          out.push({ t: 'cite', n: Number(label) });
          i = close + 1;
          continue;
        }

        if (src[close + 1] === '(') {
          const paren = src.indexOf(')', close + 2);
          if (paren > close) {
            const href = safeHref(src.slice(close + 2, paren));
            if (href !== null) {
              flush();
              out.push({ t: 'link', href, c: parseInline(label) });
              i = paren + 1;
              continue;
            }
          }
        }
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return out;
}

/* ================================================================== */
/*  БЛОК                                                               */
/* ================================================================== */

export interface ListItem {
  inline: InlineNode[];
  /** Үүрлэлтийн гүн — 0 = дээд түвшин. */
  depth: number;
}

export type MdBlock =
  | { t: 'heading'; level: 1 | 2 | 3 | 4; inline: InlineNode[] }
  | { t: 'para'; inline: InlineNode[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'quote'; inline: InlineNode[] }
  /** ⚠️ `open: true` = хаагдаагүй ``` — урсгал дундуур ЭНЭ НЬ ХЭВИЙН. */
  | { t: 'code'; lang: string | null; v: string; open: boolean }
  | { t: 'table'; head: InlineNode[][]; rows: InlineNode[][][]; align: (Align | null)[] }
  | { t: 'hr' };

export type Align = 'left' | 'center' | 'right';

export interface ParsedBlock {
  block: MdBlock;
  /** Эх мөрийн эхлэл/төгсгөл — тогтвортой түлхүүр ба кэшийн хил. */
  raw: string;
  /** React-ийн `key`.  ⚠️ Индекс БИШ: блок нэмэгдэхэд бүх key шилжинэ. */
  key: string;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,4})\s+(.*)$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const UL = /^(\s*)[-*+]\s+(.*)$/;
const OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function alignOf(cell: string): Align | null {
  const c = cell.trim();
  if (c.startsWith(':') && c.endsWith(':')) return 'center';
  if (c.endsWith(':')) return 'right';
  if (c.startsWith(':')) return 'left';
  return null;
}

/**
 * Markdown-ыг БЛОКУУД болгон задална.
 *
 * ⚠️ ХААГДААГҮЙ БҮТЭЦ НЬ АЛДАА БИШ (§24).  Урсгал дундуур ```-ийн
 *    хаалт ирээгүй, хүснэгтийн мөр дутуу байх нь ХЭВИЙН.  Тэднийг
 *    задлан шинжилгээний алдаа гэж үзвэл хэрэглэгч хагас бичигдсэн
 *    кодыг «эвдэрсэн» гэж харна.  Оронд нь ХААГДААГҮЙ гэж тэмдэглээд
 *    зөв рендерлэнэ.
 */
export function parseBlocks(src: string): ParsedBlock[] {
  /**
   * ⚠️ CRLF-ИЙГ ХЭВИЙЖҮҮЛНЭ — БОДИТ АЛДАА, 2026-09-09-нд хэмжигдсэн.
   *
   *    Загвар нь LF гаргадаг ч хадгалагдсан яриа, буулгаж тавьсан
   *    текст, Windows-ийн файл нь CRLF байж болно.  JS-ийн `.` нь
   *    тэрэг буцаах тэмдэгтийг ТААРУУЛДАГГҮЙ тул «# Гарчиг<CR>» гэсэн
   *    мөр `HEADING` загварт ОРОХГҮЙ, энгийн текст болж хэрэглэгчид
   *    `#` тэмдэгт ХАРАГДАНА — өөрөөр хэлбэл яг тэр гажиг, зөвхөн
   *    мөрийн төгсгөлөөс шалтгаалж.
   */
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: ParsedBlock[] = [];
  let i = 0;
  let seq = 0;

  const push = (block: MdBlock, raw: string) => {
    seq += 1;
    out.push({ block, raw, key: `b${seq}` });
  };

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // ── Кодын блок ─────────────────────────────────────────────
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const lang = fence[2] ? fence[2] : null;
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        if (l.trimStart().startsWith(marker[0]!.repeat(3)) && l.trim().replace(/[`~]/g, '') === '') {
          closed = true;
          break;
        }
        body.push(l);
      }
      push(
        { t: 'code', lang, v: body.join('\n'), open: !closed },
        lines.slice(i, closed ? j + 1 : j).join('\n'),
      );
      i = closed ? j + 1 : j;
      continue;
    }

    // ── Хэвтээ зураас ──────────────────────────────────────────
    if (HR.test(line)) {
      push({ t: 'hr' }, line);
      i += 1;
      continue;
    }

    // ── Гарчиг ─────────────────────────────────────────────────
    const h = HEADING.exec(line);
    if (h) {
      const level = Math.min(4, h[1]!.length) as 1 | 2 | 3 | 4;
      push({ t: 'heading', level, inline: parseInline(h[2]!.replace(/\s+#+\s*$/, '')) }, line);
      i += 1;
      continue;
    }

    // ── Хүснэгт ────────────────────────────────────────────────
    // ⚠️ Толгой + ЗААГЧ мөр ХОЁУЛАА байж байж хүснэгт гэж үзнэ.
    //    Ганц `|`-тэй мөр нь ердийн текст байж болно (жишээ нь замын
    //    тэмдэглэгээ) — тэрийг хүснэгт гэж уншвал хариулт эвдэрнэ.
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]!)) {
      const head = splitRow(line).map((c) => parseInline(c));
      const align = splitRow(lines[i + 1]!).map(alignOf);
      const rows: InlineNode[][][] = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        if (l.trim() === '' || !l.includes('|')) break;
        rows.push(splitRow(l).map((c) => parseInline(c)));
      }
      push({ t: 'table', head, rows, align }, lines.slice(i, j).join('\n'));
      i = j;
      continue;
    }

    // ── Ишлэл ──────────────────────────────────────────────────
    const q = QUOTE.exec(line);
    if (q) {
      const body: string[] = [q[1]!];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const m = QUOTE.exec(lines[j]!);
        if (!m) break;
        body.push(m[1]!);
      }
      push({ t: 'quote', inline: parseInline(body.join(' ')) }, lines.slice(i, j).join('\n'));
      i = j;
      continue;
    }

    // ── Жагсаалт ───────────────────────────────────────────────
    const ul = UL.exec(line);
    const ol = OL.exec(line);
    if (ul || ol) {
      const ordered = ol !== null;
      const start = ol ? Number(ol[2]) : 1;
      const items: ListItem[] = [];
      let j = i;
      for (; j < lines.length; j++) {
        const l = lines[j]!;
        const mu = UL.exec(l);
        const mo = OL.exec(l);
        if (mu === null && mo === null) {
          // ⚠️ ҮРГЭЛЖЛЭЛИЙН МӨР — өмнөх зүйлд НААЛДАНА.  Үгүй бол урт
          //    зүйл нь дунд нь тасарч, шинэ догол мөр болно.
          if (l.trim() !== '' && items.length > 0 && /^\s+\S/.test(l)) {
            const last = items[items.length - 1]!;
            last.inline = parseInline(
              // ⚠️ Дахин задлан шинжилнэ — тод/код нь мөр давж болно.
              (last.inline.map(inlineText).join('') + ' ' + l.trim()).trim(),
            );
            continue;
          }
          break;
        }
        // ⚠️ ДУГААРТАЙ ба ДУГААРГҮЙ нь ӨӨР ЖАГСААЛТ.  Нэгтгэвэл
        //    дугаарлалт алдагдана.
        if ((mo !== null) !== ordered) break;
        const indent = (mu ?? mo)![1]!.length;
        const text = mu ? mu[2]! : mo![3]!;
        items.push({ inline: parseInline(text), depth: Math.min(3, Math.floor(indent / 2)) });
      }
      push({ t: 'list', ordered, start, items }, lines.slice(i, j).join('\n'));
      i = j;
      continue;
    }

    // ── Догол мөр ──────────────────────────────────────────────
    const body: string[] = [line];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j]!;
      if (
        l.trim() === '' ||
        FENCE.test(l) ||
        HEADING.test(l) ||
        HR.test(l) ||
        QUOTE.test(l) ||
        UL.test(l) ||
        OL.test(l)
      ) {
        break;
      }
      body.push(l);
    }
    push({ t: 'para', inline: parseInline(body.join('\n')) }, lines.slice(i, j).join('\n'));
    i = j;
  }

  return out;
}

/** Задлан шинжилсэн зангилаанаас түүхий текстийг сэргээнэ (үргэлжлэлд). */
function inlineText(n: InlineNode): string {
  switch (n.t) {
    case 'text':
      return n.v;
    case 'code':
      return `\`${n.v}\``;
    case 'cite':
      return `[${n.n}]`;
    case 'strong':
      return `**${n.c.map(inlineText).join('')}**`;
    case 'em':
      return `*${n.c.map(inlineText).join('')}*`;
    case 'link':
      return `[${n.c.map(inlineText).join('')}](${n.href})`;
  }
}

/* ================================================================== */
/*  ТОГТСОН УГТВАРЫН КЭШ (§24)                                         */
/* ================================================================== */

export interface StreamParseCache {
  /** Кэшлэгдсэн эх мөрийн урт — түүнээс өмнөх бүх зүйл ТОГТСОН. */
  stableChars: number;
  /** Тогтсон хэсгийн блокууд — ДАХИН ЗАДЛАГДАХГҮЙ. */
  stableBlocks: ParsedBlock[];
}

export function emptyStreamCache(): StreamParseCache {
  return { stableChars: 0, stableBlocks: [] };
}

/**
 * ⚠️ ТОГТСОН ХИЛИЙГ ОЛНО — ЭНЭ ФУНКЦ БҮХ ОПТИМИЗАЦЫН ЦӨМ.
 *
 *    Токен нэмэгдэхэд БҮХ баримтыг дахин задлах нь 5 000 токенын
 *    хариултад секундэд 60 удаа 20 KB задлах гэсэн үг.  Гэвч markdown-ы
 *    блокууд нь ХООСОН МӨРӨӨР тусгаарлагддаг: сүүлийн хоосон мөрөөс
 *    өмнөх бүх зүйл ДАХИН ХЭЗЭЭ Ч ӨӨРЧЛӨГДӨХГҮЙ.
 *
 * ⚠️ ГАНЦ АЮУЛТАЙ ТОХИОЛДОЛ: КОДЫН БЛОК.  ``` дотор хоосон мөр байж
 *    болох ба тэр нь блокын ХИЛ БИШ.  Тиймээс нээлттэй ``` байвал
 *    тогтсон хил нь тэр ```-ээс ӨМНӨ байх ёстой.  Үүнийг мартвал
 *    урсгал дундуур кодын блок ХОЁР хуваагдана.
 *
 * ⚠️ ХҮСНЭГТ ч мөн адил: сүүлийн блок хүснэгт байж, дараагийн мөр
 *    түүнд НЭМЭГДЭЖ болно.  Тиймээс сүүлийн ХОЁР блокыг ҮРГЭЛЖ
 *    тогтворгүй гэж үзнэ — нэгийг нь орхих нь хямд, алдаа нь үнэтэй.
 */
export function findStableBoundary(src: string): number {
  // ⚠️ `parseBlocks`-тай ИЖИЛ хэвийжүүлэлт — эс тэгвэл хил нь өөр индекс
  //    дээр гарч, тогтсон угтвар зөрнө.
  src = src.replace(/\r\n?/g, '\n');
  // Нээлттэй кодын блокын эхлэлийг ол.
  let fenceOpen = -1;
  let pos = 0;
  const lines = src.split('\n');
  const lineStart: number[] = [];
  for (const l of lines) {
    lineStart.push(pos);
    pos += l.length + 1;
  }
  for (let k = 0; k < lines.length; k++) {
    if (FENCE.test(lines[k]!)) {
      fenceOpen = fenceOpen === -1 ? lineStart[k]! : -1;
    }
  }

  // Сүүлийн хоосон мөрийг ол (хос шинэ мөр).
  let boundary = src.lastIndexOf('\n\n');
  if (boundary === -1) return 0;
  boundary += 2;

  // Нээлттэй ``` байвал түүнээс хойш юу ч тогтвортой БИШ.
  if (fenceOpen !== -1 && boundary > fenceOpen) return fenceOpen;
  return boundary;
}

/**
 * Урсгалын кэштэй задлан шинжилгээ.
 *
 * ⚠️ КЭШ НЬ ЗӨВХӨН ӨСӨХ ТЕКСТЭД ХҮЧИНТЭЙ.  `answer.reset` (хэлний
 *    засвар, дахилт) үед текст БОГИНОСНО — тэр үед кэшийг хаяна.
 *    Үгүй бол хуучин блокууд шинэ хариултын өмнө үлдэж, хэрэглэгч
 *    хоёр хариулт нийлсэнийг харна (яг тэр «AI өөрийгөө давтаж байна»
 *    гэсэн гомдол).
 */
export function parseStreaming(
  src: string,
  cache: StreamParseCache,
): { blocks: ParsedBlock[]; cache: StreamParseCache } {
  // ⚠️ Хэвийжүүлэлт нь `findStableBoundary`, `parseBlocks`, кэшийн
  //    тэмдэгтийн тоолуур ГУРВУУЛАА ижил мөр дээр ажиллахыг баталгаажуулна.
  src = src.replace(/\r\n?/g, '\n');
  if (src.length < cache.stableChars) {
    // Богиноссон — кэш хүчингүй.
    return parseStreaming(src, emptyStreamCache());
  }

  const boundary = findStableBoundary(src);
  let next = cache;

  if (boundary > cache.stableChars) {
    // ⚠️ ЗӨВХӨН ШИНЭ ХЭСГИЙГ задлан шинжилнэ.  Хуучин блокууд нь ижил
    //    объект хэвээр үлдэх тул React-ийн `memo` тэднийг АЛГАСНА.
    const added = parseBlocks(src.slice(cache.stableChars, boundary));
    const offset = cache.stableBlocks.length;
    next = {
      stableChars: boundary,
      stableBlocks: [
        ...cache.stableBlocks,
        ...added.map((b, k) => ({ ...b, key: `s${offset + k}` })),
      ],
    };
  }

  const tail = src.slice(next.stableChars);
  const tailBlocks = parseBlocks(tail).map((b, k) => ({ ...b, key: `t${k}` }));
  return { blocks: [...next.stableBlocks, ...tailBlocks], cache: next };
}
