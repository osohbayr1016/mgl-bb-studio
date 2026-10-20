/**
 * A1-хэлбэрийн хаяг ↔ координат хөрвүүлэлт, мөн мөр/багана оруулах·устгах үед
 * томьёо доторх лавлагааг шилжүүлэх.
 *
 * Координат нь ХАА САЙГҮЙ 0-ээс эхэлнэ (`SheetMerge.r/c`-тэй нэг ижил):
 * `A1` → `{ r: 0, c: 0 }`. Зөвхөн харагдах хаягийн мөрийн дугаар 1-ээс эхэлдэг.
 *
 * `shiftRefsInFormula` нь ТЕКСТ дээр ажиллана — томьёог задлан шинжлээд буцааж
 * угсардаггүй, учир нь хэрэглэгчийн бичсэн зай, том/жижиг үсэг, тайлбар бүхий
 * бичиглэлийг яг хэвээр нь хадгалах ёстой. Тиймээс энд бие даасан жижиг сканнер
 * бий: мөрийн (хашилт доторх) текст болон функцийн нэрийг ОГТ хөндөхгүй.
 */
import type { CellRef } from '../../types/quotes';

/** Устсан нүд рүү заасан лавлагааны орлуулга. */
export const DELETED_REF = '#ХАСАГДСАН!';

/** Мөр/багана оруулах·устгах үйлдэл. `at` нь 0-ээс эхэлсэн индекс. */
export interface ShiftOp {
  kind: 'insertRow' | 'deleteRow' | 'insertCol' | 'deleteCol';
  at: number;
  count: number;
  /**
   * ⚠️ «ЯГ ДООР нь мөр нэмэх» гэсэн ЗОРИУДЫН заавар: мужийн ТӨГСГӨЛ нь
   * `at - 1` дээр байвал муж шинэ мөрийг ЗАЛГИНА (`=SUM(D4:D8)` дээр 9-р мөр
   * нэмэхэд → `=SUM(D4:D9)`).
   *
   * Excel үүнийг ХИЙДЭГГҮЙ (`=SUM(A1:A5)` нь 6-р мөрийг залгихгүй) тул
   * анхдагчаар УНТРААЛТТАЙ бөгөөд зөвхөн `insertRowLike` — өөрөөр хэлбэл
   * хэрэглэгчийн «Доор нь мөр нэмэх» товч — л асаана. Тэр товч нь загварын
   * хүрээнд «дахиад нэг барилга нэмье» гэсэн утгатай учир нийлбэрт орох нь
   * цорын ганц зөв тайлбар: эс бөгөөс шинэ мөр өөрийн үнээ тооцоод НИЙТ ДҮН
   * рүү огт нэмэгдэхгүй, ямар ч алдааны тэмдэггүйгээр ₮0 болно (2026-08-19).
   *
   * `addons.ts`-ийн програмчилсан `insertRows` дуудалтууд (нэмэгдэл / зардлын
   * мөр) үүнийг АСААХГҮЙ — тэдгээр нь өгөгдлийн мужид хамаарахгүй.
   */
  growEnd?: boolean;
  /**
   * ⚠️ `growEnd`-ийн ТОЛИН тусгал — мужийн ЭХЛЭЛ дээр мөр нэмэхэд муж
   * шинэ мөрийг ЗАЛГИНА (`=SUM(D4:D29)` дээр 4-р мөрийг нэмэхэд
   * `=SUM(D5:D30)` БИШ, `=SUM(D4:D30)`).
   *
   * ЯАГААД ХЭРЭГТЭЙ ВЭ: `growEnd` нь зөвхөн «Доор нь мөр нэмэх»-ийг
   * авардаг байв. Эхний өгөгдлийн мөр дээр зогсоод «ДЭЭР нь мөр нэмэх»
   * дарахад муж бүхэлдээ доош гулсаж (`Z4:Z29` → `Z5:Z30`) шинэ мөр
   * мужаас ГАДУУР үлдэж, ямар ч улаан тэмдэггүйгээр ₮0 нэмдэг байсныг
   * 2026-08-19-нд #43 санал дээр хэмжиж баталлаа.
   *
   * `growEnd`-тэй яг ижил хамрах хүрээ: зөвхөн `insertRowLike` асаана.
   */
  growStart?: boolean;
}

/* ---------------- Тэмдэгтийн ангилал (жижиг туслахууд) ---------------- */

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}
function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
/** Кирилл үсэг — функцийн нэр монголоор ч байж болно. */
function isCyrillic(ch: string): boolean {
  const k = ch.charCodeAt(0);
  return k >= 0x0400 && k <= 0x04ff;
}
export function isNameStart(ch: string): boolean {
  return isAsciiLetter(ch) || isCyrillic(ch) || ch === '_';
}

/* ---------------- Хаяг ↔ координат ---------------- */

/** 0 → 'A', 25 → 'Z', 26 → 'AA'. Bijective base-26. */
export function colToName(c: number): string {
  if (!Number.isFinite(c) || c < 0) return '';
  let n = Math.floor(c);
  let out = '';
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  }
  return out;
}

/** 'A' → 0, 'AA' → 26. Буруу нэр бол `-1`. */
export function nameToCol(s: string): number {
  const up = s.toUpperCase();
  if (up.length === 0) return -1;
  let n = 0;
  for (let i = 0; i < up.length; i += 1) {
    const code = up.charCodeAt(i);
    if (code < 65 || code > 90) return -1;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

const REF_RE = /^([A-Za-z]+)([0-9]+)$/;

/** 'B3' → `{ r: 2, c: 1 }`. Хаяг биш бол `null`. */
export function refToCoord(ref: CellRef): { r: number; c: number } | null {
  const m = REF_RE.exec(ref.trim());
  if (!m) return null;
  const c = nameToCol(m[1] as string);
  const row = Number(m[2]);
  if (c < 0 || !Number.isInteger(row) || row < 1) return null;
  return { r: row - 1, c };
}

/** `(2, 1)` → 'B3'. */
export function coordToRef(r: number, c: number): CellRef {
  return `${colToName(c)}${Math.floor(r) + 1}`;
}

/** Хаягийг том үсгээр нормчилно ('b3' → 'B3'). Хаяг биш бол хэвээр нь. */
export function normalizeRef(ref: string): CellRef {
  const co = refToCoord(ref);
  return co ? coordToRef(co.r, co.c) : ref;
}

/** Тэмдэгт мөр нь бүрэн A1-хаяг мөн эсэх. */
export function isRefName(s: string): boolean {
  return refToCoord(s) !== null;
}

/**
 * Нэг удаад задлахыг зөвшөөрөх нүдний дээд хязгаар.
 *
 * Excel-ээс хуулсан `A1:XFD1048576` мэт муж браузерыг зогсоохгүйн тулд хэрэгтэй.
 * Үнийн саналын хуудас хэдэн зуун мөр л байдаг тул энэ хязгаар практикт хүрэхгүй.
 */
export const MAX_RANGE_CELLS = 50000;

/** Мужийн хайрцаг (нормчилсон, хүрээгээр хавчсан). */
function rangeBox(
  from: CellRef,
  to: CellRef,
  bounds?: { rows: number; cols: number },
): { r1: number; r2: number; c1: number; c2: number } | null {
  const a = refToCoord(from);
  const b = refToCoord(to);
  if (!a || !b) return null;
  const box = {
    r1: Math.max(Math.min(a.r, b.r), 0),
    r2: Math.max(a.r, b.r),
    c1: Math.max(Math.min(a.c, b.c), 0),
    c2: Math.max(a.c, b.c),
  };
  if (bounds) {
    box.r2 = Math.min(box.r2, bounds.rows - 1);
    box.c2 = Math.min(box.c2, bounds.cols - 1);
  }
  return box;
}

/** Мужид хэдэн нүд байгаа — задлахаас ӨМНӨ хэмжихэд. */
export function rangeCellCount(
  from: CellRef,
  to: CellRef,
  bounds?: { rows: number; cols: number },
): number {
  const box = rangeBox(from, to, bounds);
  if (!box) return 0;
  const rows = box.r2 - box.r1 + 1;
  const cols = box.c2 - box.c1 + 1;
  return rows <= 0 || cols <= 0 ? 0 : rows * cols;
}

/**
 * Мужийн бүх нүдний хаягийг задлана. `bounds` өгвөл хуудасны хэмжээгээр
 * хавчина. `MAX_RANGE_CELLS`-ээс их бол хоосон буцаана (дуудагч урьдчилан
 * `rangeCellCount`-оор шалгах ёстой).
 */
export function expandRange(
  from: CellRef,
  to: CellRef,
  bounds?: { rows: number; cols: number },
): CellRef[] {
  const box = rangeBox(from, to, bounds);
  if (!box || rangeCellCount(from, to, bounds) > MAX_RANGE_CELLS) return [];
  const out: CellRef[] = [];
  for (let r = box.r1; r <= box.r2; r += 1) {
    for (let c = box.c1; c <= box.c2; c += 1) out.push(coordToRef(r, c));
  }
  return out;
}

/* ---------------- Лавлагаа шилжүүлэх ---------------- */

/**
 * Нэг тэнхлэгийн индексийг шилжүүлнэ. `null` = уг индекс устсан.
 *
 * `edge` нь мужийн төгсгөлийг хавчих горим (Excel-ийн зан төлөв): мужийн дотор
 * мөр устахад муж агшина, бүхэлдээ устсан үед л `#ХАСАГДСАН!` болно.
 *   'start' → устсан бол устгалын дараах эхний амьд мөр (`at`) руу
 *   'end'   → устсан бол устгалаас өмнөх сүүлийн амьд мөр (`at - 1`) руу
 *
 * НЭМЭХ үед `op.growEnd` асаалттай бол мужийн ТӨГСГӨЛ `at - 1`-ээс эхлэн
 * тэлнэ, `op.growStart` асаалттай бол мужийн ЭХЛЭЛ `at`-д ХӨДӨЛГӨӨНГҮЙ
 * үлдэнэ (`at + 1`-ээс л шилжинэ) — учир шалтгааныг `ShiftOp.growEnd` /
 * `ShiftOp.growStart` дээр үз.
 */
function shiftIndex(
  idx: number,
  op: ShiftOp,
  remove: boolean,
  edge: 'cell' | 'start' | 'end',
): number | null {
  if (!remove) {
    let from = op.at;
    if (edge === 'end' && op.growEnd) from = op.at - 1;
    else if (edge === 'start' && op.growStart) from = op.at + 1;
    return idx >= from ? idx + op.count : idx;
  }
  if (idx < op.at) return idx;
  if (idx >= op.at + op.count) return idx - op.count;
  if (edge === 'start') return op.at;
  if (edge === 'end') return op.at - 1;
  return null;
}

const isRowOp = (op: ShiftOp) => op.kind === 'insertRow' || op.kind === 'deleteRow';
const isRemoveOp = (op: ShiftOp) => op.kind === 'deleteRow' || op.kind === 'deleteCol';

/** Ганц нүдний лавлагааг шилжүүлнэ. Устсан бол `#ХАСАГДСАН!`. */
export function shiftRef(ref: CellRef, op: ShiftOp): string {
  const co = refToCoord(ref);
  if (!co) return ref;
  const remove = isRemoveOp(op);
  if (isRowOp(op)) {
    const r = shiftIndex(co.r, op, remove, 'cell');
    return r === null || r < 0 ? DELETED_REF : coordToRef(r, co.c);
  }
  const c = shiftIndex(co.c, op, remove, 'cell');
  return c === null || c < 0 ? DELETED_REF : coordToRef(co.r, c);
}

/** Мужийн хоёр төгсгөлийг ТУСАД НЬ шилжүүлнэ. Бүхэлдээ уствал `#ХАСАГДСАН!`. */
export function shiftRangeRefs(from: CellRef, to: CellRef, op: ShiftOp): string {
  const a = refToCoord(from);
  const b = refToCoord(to);
  if (!a || !b) return `${from}:${to}`;
  let r1 = Math.min(a.r, b.r);
  let r2 = Math.max(a.r, b.r);
  let c1 = Math.min(a.c, b.c);
  let c2 = Math.max(a.c, b.c);
  const remove = isRemoveOp(op);
  if (isRowOp(op)) {
    const s = shiftIndex(r1, op, remove, 'start');
    const e = shiftIndex(r2, op, remove, 'end');
    if (s === null || e === null || e < 0 || s > e) return DELETED_REF;
    r1 = s;
    r2 = e;
  } else {
    const s = shiftIndex(c1, op, remove, 'start');
    const e = shiftIndex(c2, op, remove, 'end');
    if (s === null || e === null || e < 0 || s > e) return DELETED_REF;
    c1 = s;
    c2 = e;
  }
  return `${coordToRef(r1, c1)}:${coordToRef(r2, c2)}`;
}

/** Сканнерын уншсан «үг» — хаяг мөн үү гэдгийг тэмдэглэнэ. */
interface Word {
  text: string;
  start: number;
  end: number;
  isRef: boolean;
}

function skipSpaces(src: string, i: number): number {
  let j = i;
  while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j += 1;
  return j;
}

/**
 * `i`-ээс эхлэн нэг танигчийг (үсгүүд + цифрүүд) уншина.
 * Дараа нь `(` ирвэл энэ бол ФУНКЦИЙН нэр — хэзээ ч хаяг биш.
 */
function readWord(src: string, i: number): Word | null {
  const first = src[i];
  if (first === undefined || !isNameStart(first)) return null;
  let j = i;
  while (j < src.length && isNameStart(src[j] as string)) j += 1;
  const letters = src.slice(i, j);
  const k = j;
  while (j < src.length && isDigit(src[j] as string)) j += 1;
  const digits = src.slice(k, j);
  const text = letters + digits;
  const nextCh = src[skipSpaces(src, j)];
  const isFunc = nextCh === '(';
  return { text, start: i, end: j, isRef: !isFunc && digits.length > 0 && isRefName(text) };
}

/**
 * `bangAt`-д байгаа `!`-ээс эхлэн хөндлөн лавлагааны СҮҮЛИЙГ (`!G17` эсвэл
 * `!G17:H20`) алгасаад дараагийн байрлалыг буцаана. Хуудасны нэрийг дуудагч тал
 * аль хэдийн уншсан байна.
 */
function skipQualifiedTail(src: string, bangAt: number): number {
  const first = readWord(src, skipSpaces(src, bangAt + 1));
  if (!first) return bangAt + 1;
  const colonAt = skipSpaces(src, first.end);
  if (src[colonAt] === ':') {
    const second = readWord(src, skipSpaces(src, colonAt + 1));
    if (second) return second.end;
  }
  return first.end;
}

/**
 * Томьёон доторх бүх лавлагааг НЭГ УДААГИЙН сканнераар илрүүлж дахин бичнэ.
 *
 * Хашилт доторх текст (`"өндөр"`) болон функцийн нэрийг хөндөхгүй; муж (`A1:B9`)
 * бол хоёр төгсгөлийг тусад нь дамжуулна (хооронд нь зай байвал хэвээр).
 * Шилжүүлэх/орчуулах дүрмийг дуудагч callback-ээр өгнө — иймд `shiftRefsInFormula`
 * (мөр/багана оруулах-устгах) ба `translateFormula` (copy/fill) хоёр НЭГ сканнер
 * дундална.
 */
function mapFormulaRefs(
  f: string,
  onRef: (ref: string) => string,
  onRange: (from: string, to: string) => string,
): string {
  let out = '';
  let i = 0;
  while (i < f.length) {
    const ch = f[i] as string;

    // Мөрийн литерал — дотор нь ямар ч байсан хэвээр хуулна ("" = хашилт).
    if (ch === '"') {
      let j = i + 1;
      while (j < f.length) {
        if (f[j] === '"') {
          if (f[j + 1] === '"') j += 2;
          else {
            j += 1;
            break;
          }
        } else j += 1;
      }
      out += f.slice(i, j);
      i = j;
      continue;
    }

    // Хашилттай хуудасны нэр: 'Sheet Name'!G17 — БҮХЭЛД НЬ хэвээр (хөндлөн
    // лавлагааг мөр/багана шилжүүлэлт хөндөхгүй, v3 хамрах хүрээ).
    if (ch === "'") {
      let j = i + 1;
      while (j < f.length && f[j] !== "'") j += 1;
      if (f[j] === "'" && f[skipSpaces(f, j + 1)] === '!') {
        const end = skipQualifiedTail(f, j + 1);
        out += f.slice(i, end);
        i = end;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }

    const word = readWord(f, i);
    if (!word) {
      out += ch;
      i += 1;
      continue;
    }

    // Хөндлөн лавлагаа `Нэр!G17` — `!` эхэлбэл `word` нь хуудасны нэр; бүхэлд нь
    // хэвээр үлдээнэ (тухайн хуудасны мөр/багана шилжихэд өөр хуудсанд нөлөөгүй).
    if (f[skipSpaces(f, word.end)] === '!') {
      const end = skipQualifiedTail(f, skipSpaces(f, word.end));
      out += f.slice(i, end);
      i = end;
      continue;
    }

    if (!word.isRef) {
      out += word.text;
      i = word.end;
      continue;
    }

    // Муж уу? `A1:B9` (хооронд нь зай байж болно — тэр зайг хэвээр үлдээнэ)
    const colonAt = skipSpaces(f, word.end);
    if (f[colonAt] === ':') {
      const secondAt = skipSpaces(f, colonAt + 1);
      const second = readWord(f, secondAt);
      if (second && second.isRef) {
        const mapped = onRange(word.text, second.text);
        if (mapped === DELETED_REF) out += DELETED_REF;
        else {
          const [a, b] = mapped.split(':');
          out += `${a}${f.slice(word.end, second.start)}${b}`;
        }
        i = second.end;
        continue;
      }
    }

    out += onRef(word.text);
    i = word.end;
  }
  return out;
}

/**
 * Томьёон доторх бүх лавлагааг шилжүүлнэ (мөр/багана оруулах эсвэл устгах).
 * Устсан нүд рүү заасан лавлагаа `#ХАСАГДСАН!` болж, тухайн томьёо алдаа өгнө.
 */
export function shiftRefsInFormula(f: string, op: ShiftOp): string {
  if (!f || op.count <= 0) return f;
  return mapFormulaRefs(
    f,
    (ref) => shiftRef(ref, op),
    (from, to) => shiftRangeRefs(from, to, op),
  );
}

/** Ганц нүдийг (dr,dc)-ээр орчуулна (copy/fill үед харьцангуй лавлагаа). */
function translateRef(ref: CellRef, dr: number, dc: number): string {
  const co = refToCoord(ref);
  if (!co) return ref;
  const r = co.r + dr;
  const c = co.c + dc;
  return r < 0 || c < 0 ? DELETED_REF : coordToRef(r, c);
}

/**
 * Томьёог (dr,dc) нүдээр ОРЧУУЛНА — Excel-ийн copy/fill үеийн харьцангуй лавлагаа.
 *
 * Мөр хувилах, доош дүүргэх үед `=E4*G4`-ийг нэг мөр доош хуулбал `=E5*G5`
 * болно. Муж (`SUM(M4:M6)`) хоёр төгсгөл хоёулаа шилжинэ. Хашилт доторх текст,
 * функцийн нэр хэвээр. Сөрөг координат руу гарвал `#ХАСАГДСАН!`.
 */
export function translateFormula(f: string, dr: number, dc: number): string {
  if (!f || (dr === 0 && dc === 0)) return f;
  return mapFormulaRefs(
    f,
    (ref) => translateRef(ref, dr, dc),
    (from, to) => {
      const a = translateRef(from, dr, dc);
      const b = translateRef(to, dr, dc);
      return a === DELETED_REF || b === DELETED_REF ? DELETED_REF : `${a}:${b}`;
    },
  );
}
