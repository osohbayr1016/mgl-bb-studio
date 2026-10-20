/**
 * `.docx` → догол мөрийн жагсаалт.
 *
 * `.docx` бол ердөө ZIP архив: доторх `word/document.xml` нь WordprocessingML.
 * `fflate`-ээр задалж, `DOMParser`-оор уншаад догол мөр бүрийн текст + бүтцийн
 * дохиог (загварын нэр, жагсаалтын дугаарлалт, тод бичилт) буцаана.
 *
 * Энэ файл ЗӨВХӨН уншина — ямар нэг ангилал, таамаглал хийхгүй.  Эвристик
 * ангилагч нь `schemaDraft.ts` дотор тусдаа байна (docs/dev/assessments-spec.md §8).
 *
 * `fflate` нь lazy import — Word импорт хийхгүй хэрэглэгчийн үндсэн bundle-д орохгүй.
 */

/** WordprocessingML-ийн үндсэн namespace (transitional). */
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Задалсны алдааны төрлүүд — UI нь эдгээрээр эелдэг мессеж сонгоно. */
export type DocxParseErrorCode = 'not-zip' | 'no-document' | 'bad-xml' | 'empty';

export class DocxParseError extends Error {
  readonly code: DocxParseErrorCode;
  constructor(code: DocxParseErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'DocxParseError';
    this.code = code;
  }
}

/** Word баримтын нэг догол мөр (хүснэгтийн нүд ч мөн адил догол мөр). */
export interface DocxParagraph {
  /** Доторх бүх `w:t` залгасан текст (`w:tab` → таб тэмдэгт). */
  text: string;
  /** `w:pStyle/@w:val` — «Heading1», «ListParagraph» гэх мэт. */
  style?: string;
  /** `w:numPr/w:numId/@w:val` — жагсаалтын дугаарлалтын багц. */
  numId?: string;
  /** `w:numPr/w:ilvl/@w:val` — жагсаалтын гүн (0-оос). */
  ilvl?: number;
  /** Догол мөрд ядаж нэг тод (`w:b`) гүйлт байгаа эсэх. */
  bold: boolean;
  /** Хүснэгтийн (`w:tbl`) дотор байгаа эсэх — оноог тайлбарлах хүснэгт таних. */
  inTable: boolean;
}

// ---------------------------------------------------------------------------
// XML туслахууд — namespace угтвар нь баримт бүрт өөр байж болох тул
// ВСЕГДА localName-аар харьцуулна (`w:p`, `wp:p`, угтваргүй бүгд ажиллана).
// ---------------------------------------------------------------------------

function localNameOf(el: Element): string {
  return el.localName || el.nodeName.replace(/^.*:/, '');
}

/** Тухайн үндэс доторх бүх элементийг баримтын дарааллаар, localName-аар шүүнэ. */
function elementsByLocal(root: Element | Document, local: string): Element[] {
  const all = root.getElementsByTagName('*');
  const out: Element[] = [];
  for (let i = 0; i < all.length; i += 1) {
    const el = all.item(i);
    if (el && localNameOf(el) === local) out.push(el);
  }
  return out;
}

function firstByLocal(root: Element, local: string): Element | null {
  const all = root.getElementsByTagName('*');
  for (let i = 0; i < all.length; i += 1) {
    const el = all.item(i);
    if (el && localNameOf(el) === local) return el;
  }
  return null;
}

/** `w:val` атрибут — namespace-тэй ба угтваргүй хувилбар хоёуланг оролдоно. */
function valOf(el: Element | null): string | undefined {
  if (!el) return undefined;
  const v = el.getAttributeNS(W_NS, 'val') ?? el.getAttribute('w:val') ?? el.getAttribute('val');
  return v === null ? undefined : v;
}

/** `w:b` нь `w:val="0"` / `"false"` үед тод БИШ гэсэн үг. */
function isOnToggle(el: Element): boolean {
  const v = valOf(el);
  return v === undefined || !(v === '0' || v === 'false' || v === 'off');
}

/**
 * Догол мөрийн текстийг баримтын дарааллаар цуглуулна.
 * `w:instrText` (талбарын код) ба `w:delText` (устгасан хяналт) орохгүй.
 */
function collectText(node: Element, out: string[]): void {
  const children = node.children;
  for (let i = 0; i < children.length; i += 1) {
    const child = children.item(i);
    if (!child) continue;
    const name = localNameOf(child);
    if (name === 't') {
      out.push(child.textContent ?? '');
    } else if (name === 'tab') {
      out.push('\t');
    } else if (name === 'br' || name === 'cr') {
      out.push(' ');
    } else if (name === 'instrText' || name === 'delText' || name === 'pPr') {
      // Талбарын код, устгасан текст, догол мөрийн шинж — текст биш.
      continue;
    } else {
      collectText(child, out);
    }
  }
}

/** Таб хадгалж, зайг эмхэлж, таслагдашгүй зайг (U+00A0) энгийн зай болгоно. */
function normalizeText(raw: string): string {
  return raw
    .replace(/\u00a0/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\r?\n/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------

function toBytes(input: File | Blob | ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return Promise.resolve(input);
  if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input));
  return input.arrayBuffer().then((buf) => new Uint8Array(buf));
}

/** ZIP архивын гарын үсэг: `PK\x03\x04`. */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * `.docx`-оос догол мөрүүдийг гаргана.
 *
 * Хүснэгт доторх догол мөрүүд мөн ордог (эх файлд онооны тайлбар хүснэгтэд
 * байдаг) — `inTable: true` гэж тэмдэглэгдэнэ.  Хоосон догол мөр алгасагдана.
 */
export async function parseDocx(
  file: File | Blob | ArrayBuffer | Uint8Array,
): Promise<DocxParagraph[]> {
  const bytes = await toBytes(file);
  if (!looksLikeZip(bytes)) {
    throw new DocxParseError('not-zip', 'Файл ZIP (.docx) бүтэцтэй биш байна.');
  }

  // fflate-ийг зөвхөн энд ачаална — үндсэн bundle-д орохгүй.
  const { unzipSync } = await import('fflate');

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' });
  } catch {
    throw new DocxParseError('not-zip', 'ZIP архивыг задалж чадсангүй.');
  }

  const docBytes = entries['word/document.xml'];
  if (!docBytes) {
    throw new DocxParseError('no-document', 'word/document.xml олдсонгүй.');
  }

  const xml = new TextDecoder('utf-8').decode(docBytes);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new DocxParseError('bad-xml', 'document.xml-ийг уншиж чадсангүй.');
  }

  // Хүснэгтийн догол мөрүүд ч `getElementsByTagName('*')` дотор баримтын
  // дарааллаар ирнэ — тусад нь `w:tbl` тойрох шаардлагагүй.
  const paragraphs = elementsByLocal(doc, 'p');
  const out: DocxParagraph[] = [];

  for (const p of paragraphs) {
    const chunks: string[] = [];
    collectText(p, chunks);
    const text = normalizeText(chunks.join(''));
    if (!text) continue;

    const pPr = firstByLocal(p, 'pPr');
    const style = pPr ? valOf(firstByLocal(pPr, 'pStyle')) : undefined;

    let numId: string | undefined;
    let ilvl: number | undefined;
    const numPr = pPr ? firstByLocal(pPr, 'numPr') : null;
    if (numPr) {
      numId = valOf(firstByLocal(numPr, 'numId'));
      const rawIlvl = valOf(firstByLocal(numPr, 'ilvl'));
      const parsed = rawIlvl === undefined ? Number.NaN : Number.parseInt(rawIlvl, 10);
      if (Number.isFinite(parsed)) ilvl = parsed;
    }

    const bold = elementsByLocal(p, 'b').some(isOnToggle);

    let inTable = false;
    for (let node: Element | null = p.parentElement; node; node = node.parentElement) {
      if (localNameOf(node) === 'tbl') {
        inTable = true;
        break;
      }
    }

    out.push({
      text,
      ...(style ? { style } : {}),
      ...(numId ? { numId } : {}),
      ...(ilvl === undefined ? {} : { ilvl }),
      bold,
      inTable,
    });
  }

  if (out.length === 0) {
    throw new DocxParseError('empty', 'Баримтад текст олдсонгүй.');
  }
  return out;
}
