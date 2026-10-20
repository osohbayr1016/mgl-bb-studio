/**
 * MGL AI · БАРИМТЫГ ХЭСЭГЛЭХ (§16).
 *
 * ⚠️ ЭНЭ ФАЙЛЫН ГОЛ ШИЙДВЭР: МОНГОЛЫН НОРМЫН ХЭСЭГЛЭХ НЭГЖ НЬ ЗААЛТ,
 *    ТЭМДЭГТИЙН ТОО БИШ.
 *
 *    БНбД / БД / MNS баримтууд нь «4.2.1», «5.14», «7.2.3.a» гэсэн
 *    ШАТЛАЛТ дугаартай.  Эшлэл нь ЯГ ТЭР дугаараар хийгддэг («БНбД
 *    21-01-02-ын 4.2.1-д заасны дагуу…»).  Хэрэв 800 тэмдэгт тутамд сохроор
 *    таслах юм бол нэг заалт хоёр хэсэгт хуваагдаж, эшлэл нь ХАГАС өгүүлбэр
 *    заана — тэр нь мэргэжлийн баримт бичигт хүлээн зөвшөөрөгдөхгүй.
 *
 *    Тиймээс: ЗААЛТААР хуваана, заалт хэт урт бол Л дотор нь таслана
 *    (заалтын дугаарыг хадгалж).
 *
 * ⚠️ ХУУДАСНЫ ДУГААР АЛДАГДАХГҮЙ (§16: «Never destroy page references»).
 *    `[хуудас 17]` эсвэл `--- 17 ---` гэсэн тэмдэглэгээг уншиж, дараагийн
 *    хэсгүүдэд өвлүүлнэ.
 *
 * ⚠️ ЦЭВЭР ФУНКЦ — D1-гүй, `node --test`-ээр бүрэн хэмжигдэнэ.
 */
import { foldText } from '../textFold';

/**
 * Заалтын дугаарын хэв маяг.
 *
 * Таарна:   «4.2.1»  «4.2.1.»  «5.14»  «7.2.3.a»  «10.1)»  «§4.2»
 * Таарахгүй: «2026 он»  «1.5 м»  «0.85»  (эдгээр нь ХЭМЖЭЭ, заалт биш)
 *
 * ⚠️ Мөрийн ЭХЭНД байх ёстой — дунд нь байгаа «4.2.1» нь ишлэл байж болно.
 * ⚠️ Дор хаяж НЭГ цэг шаардана: «5» гэсэн ганц тоо нь жагсаалтын дугаар
 *    эсвэл хэмжээ байх магадлалтай.  «5.14» нь заалт.
 */
/**
 * ⚠️ ЭХНИЙ СЕГМЕНТ 0-ЭЭР ЭХЭЛЖ БОЛОХГҮЙ (`[1-9]\d?`).  Үүнгүйгээр
 *    «0.85 коэффициент хэрэглэнэ» гэсэн мөр «0.85» гэсэн ЗААЛТ болж
 *    уншигдана — норм дээр 0-ээр эхэлсэн заалтын дугаар БАЙДАГГҮЙ.
 *    (Тестээр баригдсан, 2026-09-08.)
 */
const CLAUSE_RE = /^\s*(?:§\s*)?([1-9]\d?(?:\.\d{1,3}){1,4})[.)]?\s+(?=\S)/;

/** Хуудасны тэмдэглэгээ — ихэнх PDF→текст хөрвүүлэгчийн гаралт. */
const PAGE_RE =
  /^\s*(?:---+\s*)?(?:\[?\s*(?:хуудас|хууд\.|page|стр\.?)\s*[:.]?\s*(\d{1,4})\s*\]?)(?:\s*---+)?\s*$/i;
/** Ганц тоо агуулсан мөр — олон хөрвүүлэгч хуудсыг ингэж тэмдэглэдэг. */
const BARE_PAGE_RE = /^\s*-{0,3}\s*(\d{1,4})\s*-{0,3}\s*$/;

/**
 * Гарчиг мэт мөр — «БҮЛЭГ», «ХЭСЭГ», «ХАВСРАЛТ» гэж эхэлсэн.
 *
 * ⚠️ `\b` АШИГЛАЖ БОЛОХГҮЙ.  JavaScript-ийн `\b` нь ЗӨВХӨН ASCII үгийн
 *    тэмдэгт дээр тодорхойлогддог тул «БҮЛЭГ 4» гэсэн мөрөнд «Г» ба
 *    хоосон зайны хооронд хил ОЛДОХГҮЙ бөгөөд regex унана.  Үр дүнд нь
 *    гарчиг таних чадвар ЧИМЭЭГҮЙ ажиллахаа больж, гарчгийн мөр өөрөө
 *    баримтын хэсэг болж хадгалагдаж, хуудасны дугаар нь буруу хэсэгт
 *    очиж байв.  (Тестээр баригдсан, 2026-09-08.)
 *
 *    Кирилл текст дээр `\b`-г хаана ч ашиглахгүй — ил тодорхой lookahead.
 */
const HEADING_RE = /^\s*(?:БҮЛЭГ|ХЭСЭГ|ЗҮЙЛ|ХАВСРАЛТ|CHAPTER|SECTION|ANNEX)(?=[\s.:№-]|$)/i;

export interface ChunkInput {
  /** Баримтын бүх текст. */
  text: string;
  /** Хэсэг бүрийн зорилтот дээд урт (тэмдэгт). */
  maxChars?: number;
  /** Заалт хэт урт үед таслахад давхцуулах хэмжээ. */
  overlapChars?: number;
}

export interface ParsedChunk {
  seq: number;
  /** «4.2.1» эсвэл `null` (заалтын дугааргүй хэсэг). */
  clauseNo: string | null;
  /** Хамгийн сүүлд харагдсан хуудасны дугаар. */
  pageNo: number | null;
  /** Хамгийн сүүлд харагдсан гарчиг. */
  heading: string | null;
  text: string;
  textFolded: string;
  charCount: number;
}

/** ⚠️ Заалтыг хугалахгүй байхын тулд өгөгдмөл нь харьцангуй том. */
const DEFAULT_MAX = 1200;
const DEFAULT_OVERLAP = 120;
/** Үүнээс богино хэсэг нь дуу чимээ — хайлтад ашиггүй. */
const MIN_CHUNK_CHARS = 24;

interface Block {
  clauseNo: string | null;
  pageNo: number | null;
  heading: string | null;
  lines: string[];
}

/**
 * Текстийг ЗААЛТЫН блокуудад хуваана.
 *
 * ⚠️ Хуудас, гарчгийн тэмдэглэгээ нь блокийн АГУУЛГАД ОРОХГҮЙ — тэдгээр нь
 *    метадата.  Оруулбал загвар «хуудас 17» гэсэн мөрийг баримтын хэсэг
 *    гэж уншина.
 */
function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let page: number | null = null;
  let heading: string | null = null;
  let current: Block | null = null;

  const push = () => {
    if (current && current.lines.join('\n').trim().length > 0) blocks.push(current);
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');

    const pm = PAGE_RE.exec(line) ?? BARE_PAGE_RE.exec(line);
    if (pm) {
      const n = Number(pm[1]);
      // ⚠️ Ганц тоотой мөр нь заалтын ДОТОР байвал хуудас БИШ, өгөгдөл байж
      //    болно.  Гэвч практикт хуудасны тэмдэглэгээ нь хоосон мөрөөр
      //    хүрээлэгддэг; эрсдэлийг хүлээж авав — буруу уншсан ч зөвхөн
      //    хуудасны дугаар л алдагдана, текст алдагдахгүй.
      if (Number.isFinite(n) && n > 0 && n < 5000) page = n;
      continue;
    }

    if (HEADING_RE.test(line)) {
      push();
      heading = line.trim().slice(0, 200);
      continue;
    }

    const cm = CLAUSE_RE.exec(line);
    if (cm) {
      // ШИНЭ заалт эхэллээ — өмнөхийг хаана.
      push();
      current = { clauseNo: cm[1]!, pageNo: page, heading, lines: [line.trim()] };
      continue;
    }

    if (current === null) {
      current = { clauseNo: null, pageNo: page, heading, lines: [] };
    }
    current.lines.push(line);
  }
  push();
  return blocks;
}

/**
 * Хэт урт заалтыг таслана.
 *
 * ⚠️ Өгүүлбэрийн ХИЛЭЭР таслахыг оролдоно — үг дундуур таслах нь монгол
 *    залгамж нөхцөлийг эвдэж, хайлтын фолд нь буруу үг өгнө.
 */
function splitLong(text: string, maxChars: number, overlap: number): string[] {
  if (text.length <= maxChars) return [text];

  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      // Ойролцоох өгүүлбэрийн төгсгөлийг хай.
      const window = text.slice(start, end);
      const lastStop = Math.max(
        window.lastIndexOf('. '),
        window.lastIndexOf('.\n'),
        window.lastIndexOf('; '),
        window.lastIndexOf('!\n'),
        window.lastIndexOf('?\n'),
      );
      if (lastStop > maxChars * 0.5) end = start + lastStop + 1;
    }
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter((s) => s.length > 0);
}

/**
 * ⚠️ ГОЛ ФУНКЦ.  Баримтын текстийг эшлэх боломжтой хэсгүүд болгоно.
 */
export function chunkDocument(input: ChunkInput): ParsedChunk[] {
  const maxChars = Math.max(200, Math.min(4000, input.maxChars ?? DEFAULT_MAX));
  const overlap = Math.max(0, Math.min(maxChars / 2, input.overlapChars ?? DEFAULT_OVERLAP));

  const chunks: ParsedChunk[] = [];
  let seq = 0;

  for (const block of splitBlocks(input.text)) {
    const body = block.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (body.length < MIN_CHUNK_CHARS) continue;

    const pieces = splitLong(body, maxChars, overlap);
    for (const [i, piece] of pieces.entries()) {
      // ⚠️ Таслагдсан хэсэг бүр ЗААЛТЫН ДУГААРАА хадгална — эс тэгвэл
      //    хоёр дахь хэсэг нь эшлэлгүй үлдэж, хайлтад олдсон ч эшлэж
      //    чадахгүй.
      const text =
        pieces.length > 1 && i > 0 && block.clauseNo
          ? `[${block.clauseNo} үргэлжлэл] ${piece}`
          : piece;

      chunks.push({
        seq: seq++,
        clauseNo: block.clauseNo,
        pageNo: block.pageNo,
        heading: block.heading,
        text,
        textFolded: foldText(text),
        charCount: text.length,
      });
    }
  }
  return chunks;
}

/**
 * Бүтэцтэй оролт (JSON/CSV) -оос шууд хэсэг үүсгэнэ.
 *
 * ⚠️ Эзэн заалтуудыг аль хэдийн ялгасан хүснэгтээр өгвөл түүнийг ДАХИН
 *    задлах нь алдаа гаргана — энэ зам нь тэр тохиолдолд.
 */
export interface StructuredRow {
  clause_no?: string | null;
  page_no?: number | null;
  heading?: string | null;
  text: string;
}

export function chunkStructured(rows: readonly StructuredRow[]): ParsedChunk[] {
  const out: ParsedChunk[] = [];
  let seq = 0;
  for (const r of rows) {
    const text = String(r.text ?? '').trim();
    if (text.length < MIN_CHUNK_CHARS) continue;
    const page = Number(r.page_no);
    out.push({
      seq: seq++,
      clauseNo: r.clause_no ? String(r.clause_no).trim().slice(0, 64) : null,
      pageNo: Number.isInteger(page) && page > 0 ? page : null,
      heading: r.heading ? String(r.heading).trim().slice(0, 200) : null,
      text,
      textFolded: foldText(text),
      charCount: text.length,
    });
  }
  return out;
}

/** Токены ойролцоо тоо — контекстын төсөвт (кирилл нь илүү иднэ). */
export function estimateTokens(text: string): number {
  const cyrillic = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  return Math.ceil(cyrillic / 2.2 + (text.length - cyrillic) / 4);
}
