/**
 * AST-ийн тооцоолуур.
 *
 * Хөдөлгүүр ЦЭВЭР: DOM, сүлжээ, тарифын каталог, «дүн үсгээр» хөрвүүлэгч —
 * бүгд `EvalContext`-оор ГАДНААС тарина. Ингэснээр энэ файл нь бүрэн тестлэгдэх
 * ба хэвлэх хуудас, засварлагч, серверийн аль ч орчинд ижил ажиллана.
 *
 * Алдаа нь утга шиг ТАРХАНА: алдаатай нүдийг лавласан томьёо мөн адил алдаатай
 * болно (Excel-тэй ижил). Алдааны кодын хуваарь:
 *   `#ТОМЬЁО!`   — бүтцийн алдаа: задлан шинжлэх, үл мэдэгдэх функц, буруу
 *                  аргументийн тоо, муж скаляр байрлалд.
 *   `#ТООЦОО!`   — тооцооны алдаа: 0-д хуваах, тоо болгож чадахгүй текст,
 *                  хязгааргүй/NaN үр дүн.
 *   `#ТАРИФ!`    — тарифын хүснэгтээс мөр олдсонгүй.
 *   `#ХАСАГДСАН!`— устсан мөр/багана руу заасан лавлагаа.
 *   `#ЦИКЛ!`     — мөчлөгт хамаарал (зөвхөн `index.ts` тавина).
 */
import type { CellRef } from '../../types/quotes';
import { MAX_RANGE_CELLS, expandRange, rangeCellCount } from './refs';
import { parse, type BinOp, type Node } from './parser';

export type CellValue = number | string | null;

export type ErrorCode = '#ТОМЬЁО!' | '#ЦИКЛ!' | '#ТАРИФ!' | '#ХАСАГДСАН!' | '#ТООЦОО!';

export interface FormulaError {
  code: ErrorCode;
}

export interface EvalContext {
  /**
   * Аль хэдийн тооцоологдсон утга (хоосон нүд → `null`). `sheet` өгвөл хөндлөн
   * хуудасны нүд (`ИГС!G17`); эс бөгөөс тухайн (идэвхтэй) хуудас.
   */
  getCell(ref: CellRef, sheet?: string): CellValue | FormulaError;
  /** Тарифын хүснэгт — олдохгүй бол `null` → `#ТАРИФ!`. */
  tariff(area: number, complexityMn: string): number | null;
  /** Дүнг үсгээр бичих. */
  usgeer(amount: number): string;
  /**
   * `TEXT()`-ийн мянгатын форматын locale. Англи саналд `'en-US'`,
   * өгөөгүй бол `'mn-MN'` (өмнөх зан төлөв хэвээр).
   */
  locale?: string;
}

export const ERR: Record<'formula' | 'cycle' | 'tariff' | 'deleted' | 'calc', FormulaError> = {
  formula: { code: '#ТОМЬЁО!' },
  cycle: { code: '#ЦИКЛ!' },
  tariff: { code: '#ТАРИФ!' },
  deleted: { code: '#ХАСАГДСАН!' },
  calc: { code: '#ТООЦОО!' },
};

const ERROR_CODES: ErrorCode[] = ['#ТОМЬЁО!', '#ЦИКЛ!', '#ТАРИФ!', '#ХАСАГДСАН!', '#ТООЦОО!'];

export function isFormulaError(v: unknown): v is FormulaError {
  return (
    typeof v === 'object' &&
    v !== null &&
    'code' in v &&
    typeof (v as { code: unknown }).code === 'string'
  );
}

/** Мужийн утга — зөвхөн дотоод, нүдэнд хэзээ ч бичигдэхгүй. */
interface RangeVal {
  kind: 'range';
  items: (CellValue | FormulaError)[];
}
type Val = CellValue | FormulaError | RangeVal;

function isRange(v: Val): v is RangeVal {
  return typeof v === 'object' && v !== null && (v as RangeVal).kind === 'range';
}

/* ---------------- Хөрвүүлэлт ---------------- */

/** Тоон контекст: хоосон = 0, тоон текст = тоо, бусад текст = `#ТООЦОО!`. */
function toNumber(v: Val): number | FormulaError {
  if (isFormulaError(v)) return v;
  if (isRange(v)) return ERR.formula;
  if (v === null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : ERR.calc;
  const s = v.trim();
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : ERR.calc;
}

function toText(v: Val): string | FormulaError {
  if (isFormulaError(v)) return v;
  if (isRange(v)) return ERR.formula;
  if (v === null) return '';
  return typeof v === 'number' ? String(v) : v;
}

/**
 * Логик контекст. Харьцуулалт 1/0 буцаадаг тул (CellValue-д boolean байхгүй)
 * энд тоог л голчлон авна; текстийг ҮНЭН/ХУДАЛ гэж уншиж чадвал уншина.
 */
function toBool(v: Val): boolean | FormulaError {
  if (isFormulaError(v)) return v;
  if (isRange(v)) return ERR.formula;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  const s = v.trim().toLowerCase();
  if (s === '' || s === 'false' || s === 'худал' || s === 'үгүй') return false;
  if (s === 'true' || s === 'үнэн' || s === 'тийм') return true;
  const n = Number(s);
  return Number.isFinite(n) ? n !== 0 : ERR.calc;
}

/**
 * Excel-ийн эрэмбийн дүрэм: тоо < текст. Хоосон нүдийг эсрэг талын төрөлд
 * тааруулна (хоосон = 0 эсвэл ""). Текстийг том/жижиг үсэг үл ялган жишнэ.
 */
function compare(a: Val, b: Val): number | FormulaError {
  if (isFormulaError(a)) return a;
  if (isFormulaError(b)) return b;
  if (isRange(a) || isRange(b)) return ERR.formula;
  let x: CellValue = a;
  let y: CellValue = b;
  if (x === null) x = typeof y === 'string' ? '' : 0;
  if (y === null) y = typeof x === 'string' ? '' : 0;
  if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : x < y ? -1 : 1;
  if (typeof x === 'number') return -1; // тоо үргэлж текстээс өмнө
  if (typeof y === 'number') return 1;
  const sx = x.toLowerCase();
  const sy = y.toLowerCase();
  return sx === sy ? 0 : sx < sy ? -1 : 1;
}

/* ---------------- Тоон туслахууд ---------------- */

/**
 * Тоог өгөгдсөн орноор дугуйлна.
 *
 * `toPrecision(15)` нь хөвөгч цэгийн хазайлтыг арилгана: `1.005 * 100` нь
 * 100.49999999999999 болдог тул шууд `Math.round` хийвэл 1.00 гардаг байв.
 */
function roundTo(x: number, digits: number, mode: 'half' | 'up' | 'down'): number {
  const d = Math.trunc(digits);
  const p = Math.pow(10, d);
  const scaled = Number((x * p).toPrecision(15));
  const abs = Math.abs(scaled);
  const rounded = mode === 'half' ? Math.round(abs) : mode === 'up' ? Math.ceil(abs) : Math.floor(abs);
  return ((scaled < 0 ? -1 : 1) * rounded) / p;
}

/**
 * Аргументуудаас тоонуудыг цуглуулна.
 * - муж дотор: зөвхөн бодит тоог авна (текст, хоосныг алгасна — Excel-ийн SUM)
 * - скаляр: хоосныг алгасна, бусдыг чанд хөрвүүлнэ
 * - алдаа: тэр дор нь тархана
 */
function collectNumbers(args: Val[]): number[] | FormulaError {
  const out: number[] = [];
  for (const a of args) {
    if (isFormulaError(a)) return a;
    if (isRange(a)) {
      for (const item of a.items) {
        if (isFormulaError(item)) return item;
        if (typeof item === 'number' && Number.isFinite(item)) out.push(item);
      }
      continue;
    }
    if (a === null) continue;
    const n = toNumber(a);
    if (isFormulaError(n)) return n;
    out.push(n);
  }
  return out;
}

/* ---------------- Функцууд ---------------- */

type Fn = (args: Val[], ctx: EvalContext) => Val;

const FUNCS: Record<string, Fn> = {
  SUM: (args) => {
    const nums = collectNumbers(args);
    return isFormulaError(nums) ? nums : nums.reduce((s, n) => s + n, 0);
  },
  AVERAGE: (args) => {
    const nums = collectNumbers(args);
    if (isFormulaError(nums)) return nums;
    if (nums.length === 0) return ERR.calc; // 0-д хуваахтай адил
    return nums.reduce((s, n) => s + n, 0) / nums.length;
  },
  MIN: (args) => {
    const nums = collectNumbers(args);
    if (isFormulaError(nums)) return nums;
    return nums.length === 0 ? 0 : Math.min(...nums);
  },
  MAX: (args) => {
    const nums = collectNumbers(args);
    if (isFormulaError(nums)) return nums;
    return nums.length === 0 ? 0 : Math.max(...nums);
  },
  ABS: (args) => {
    if (args.length !== 1) return ERR.formula;
    const n = toNumber(args[0] as Val);
    return isFormulaError(n) ? n : Math.abs(n);
  },
  /**
   * Тоог ХАРАГДАХ мөр болгоно — `&`-тэй хамт тайлбарын өгүүлбэр угсрахад:
   * `="…дүн ₮"&TEXT(M13)&" /"&USGEER(M13)&" төгрөг/ болно."`
   *
   * Хоёр дахь аргумент нь формат; өгөөгүй бол `#,##0` (үнийн саналын бүх тоо
   * мянгатын таслалтай). `&` өөрөө форматгүй залгадаг тул энэ функц хэрэгтэй.
   */
  TEXT: (args, ctx) => {
    if (args.length < 1 || args.length > 2) return ERR.formula;
    const raw = args[0] as Val;
    if (isFormulaError(raw)) return raw;
    if (isRange(raw)) return ERR.formula;
    if (raw === null) return '';
    if (typeof raw === 'string') return raw;

    let fmt = '#,##0';
    if (args.length === 2) {
      const f = toText(args[1] as Val);
      if (isFormulaError(f)) return f;
      if (f.trim() !== '') fmt = f.trim();
    }
    // Locale-ийг контекстээс тарина — англи саналд 'en-US' (`quotes.lang`).
    const locale = ctx.locale ?? 'mn-MN';
    switch (fmt) {
      case '#,##0.00':
        return raw.toLocaleString(locale, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      case '0%':
        return `${Math.round(raw * 100)}%`;
      case '0.0%':
        return `${(raw * 100).toFixed(1)}%`;
      case 'text':
        return String(raw);
      default:
        return Math.round(raw).toLocaleString(locale);
    }
  },
  COUNT: (args) => {
    let n = 0;
    for (const a of args) {
      if (isFormulaError(a)) return a;
      if (isRange(a)) {
        for (const item of a.items) {
          if (isFormulaError(item)) return item;
          if (typeof item === 'number' && Number.isFinite(item)) n += 1;
        }
      } else if (typeof a === 'number' && Number.isFinite(a)) n += 1;
    }
    return n;
  },
  ROUND: (args) => roundFn(args, 'half'),
  ROUNDUP: (args) => roundFn(args, 'up'),
  ROUNDDOWN: (args) => roundFn(args, 'down'),
  /**
   * ⚠️ БӨГЛӨӨГҮЙ мөр нь АЛДАА БИШ.
   *
   * Талбай эсвэл төвөгшил хоосон байвал `null` (хоосон нүд) буцаана — `#ТАРИФ!`
   * БИШ. Учир нь шинэ үнийн санал үүсгэхэд бүх мөр хоосон байдаг ба хэрэв энд
   * алдаа буцаавал тэр нь `=E4*G4` → `=SUM(...)` → НИЙТ ҮНЭ хүртэл тархаж,
   * хоосон загвар бүхэлдээ `#ТАРИФ!`-аар дүүрч эвдэрсэн мэт харагдана.
   * `#ТАРИФ!` нь зөвхөн ЖИНХЭНЭ алдаанд зориулагдана: талбай/төвөгшил бичигдсэн
   * атлаа каталогоос тохирох шатлал олдоогүй (жишээ нь 60,000 м² — Хүснэгт 9
   * 50,000-аар тасардаг, эсвэл төвөгшлийн нэр буруу бичигдсэн).
   */
  TARIF: (args, ctx) => {
    if (args.length !== 2) return ERR.formula;
    const rawArea = args[0] as Val;
    const rawCx = args[1] as Val;
    if (isFormulaError(rawArea)) return rawArea;
    if (isFormulaError(rawCx)) return rawCx;

    const cx = toText(rawCx);
    if (isFormulaError(cx)) return cx;
    const area = toNumber(rawArea);
    if (isFormulaError(area)) return area;

    // Хоосон оролт = «хараахан бөглөөгүй» → хоосон нүд.
    if (cx.trim() === '' || area <= 0) return null;

    const rate = ctx.tariff(area, cx.trim());
    return rate === null || !Number.isFinite(rate) ? ERR.tariff : rate;
  },
  USGEER: (args, ctx) => {
    if (args.length !== 1) return ERR.formula;
    const n = toNumber(args[0] as Val);
    return isFormulaError(n) ? n : ctx.usgeer(n);
  },
};

function roundFn(args: Val[], mode: 'half' | 'up' | 'down'): Val {
  if (args.length < 1 || args.length > 2) return ERR.formula;
  const x = toNumber(args[0] as Val);
  if (isFormulaError(x)) return x;
  const d = args.length === 2 ? toNumber(args[1] as Val) : 0;
  if (isFormulaError(d)) return d;
  const r = roundTo(x, d, mode);
  return Number.isFinite(r) ? r : ERR.calc;
}

/* ---------------- Гол тооцоолуур ---------------- */

function evalNode(node: Node, ctx: EvalContext): Val {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'str':
      return node.v;
    case 'err':
      return { code: ERROR_CODES.find((c) => c === node.code) ?? '#ТОМЬЁО!' };
    case 'ref':
      return ctx.getCell(node.ref, node.sheet);
    case 'range': {
      if (rangeCellCount(node.from, node.to) > MAX_RANGE_CELLS) return ERR.formula;
      return {
        kind: 'range',
        items: expandRange(node.from, node.to).map((ref) => ctx.getCell(ref, node.sheet)),
      };
    }
    case 'unary': {
      const x = evalNode(node.x, ctx);
      const n = toNumber(x);
      if (isFormulaError(n)) return n;
      if (node.op === '-') return -n;
      if (node.op === '%') return n / 100;
      return n;
    }
    case 'binary':
      return evalBinary(node.op, evalNode(node.a, ctx), evalNode(node.b, ctx));
    case 'call':
      return evalCall(node, ctx);
    default:
      return ERR.formula;
  }
}

function evalBinary(op: BinOp, a: Val, b: Val): Val {
  if (op === '=' || op === '<>' || op === '<' || op === '<=' || op === '>' || op === '>=') {
    const c = compare(a, b);
    if (isFormulaError(c)) return c;
    switch (op) {
      case '=':
        return c === 0 ? 1 : 0;
      case '<>':
        return c === 0 ? 0 : 1;
      case '<':
        return c < 0 ? 1 : 0;
      case '<=':
        return c <= 0 ? 1 : 0;
      case '>':
        return c > 0 ? 1 : 0;
      default:
        return c >= 0 ? 1 : 0;
    }
  }
  // Мөр залгах. Тоог ФОРМАТГҮЙГЭЭР залгана (Excel-тэй ижил) — мянгатын
  // таслалтай харуулахыг хүсвэл `TEXT()` ашиглана.
  if (op === '&') {
    const sa = toText(a);
    if (isFormulaError(sa)) return sa;
    const sb = toText(b);
    if (isFormulaError(sb)) return sb;
    return sa + sb;
  }
  const x = toNumber(a);
  if (isFormulaError(x)) return x;
  const y = toNumber(b);
  if (isFormulaError(y)) return y;
  let r: number;
  switch (op) {
    case '+':
      r = x + y;
      break;
    case '-':
      r = x - y;
      break;
    case '*':
      r = x * y;
      break;
    case '/':
      if (y === 0) return ERR.calc;
      r = x / y;
      break;
    case '^':
      r = Math.pow(x, y);
      break;
    default:
      return ERR.formula;
  }
  return Number.isFinite(r) ? r : ERR.calc;
}

function evalCall(node: Node & { t: 'call' }, ctx: EvalContext): Val {
  const name = node.name.toUpperCase();

  // IF нь ЗАЛХУУ: сонгогдоогүй салаа огт тооцоологдохгүй. Тэгэхгүй бол
  // `=IF(D4=0;0;X/D4)` мэт хамгаалалт утгагүй болж, 0-д хуваах алдаа гоожно.
  if (name === 'IF') {
    if (node.args.length < 2 || node.args.length > 3) return ERR.formula;
    const cond = toBool(evalNode(node.args[0] as Node, ctx));
    if (isFormulaError(cond)) return cond;
    if (cond) return evalNode(node.args[1] as Node, ctx);
    return node.args.length === 3 ? evalNode(node.args[2] as Node, ctx) : null;
  }

  const fn = FUNCS[name];
  if (!fn) return ERR.formula;
  return fn(
    node.args.map((a) => evalNode(a, ctx)),
    ctx,
  );
}

/** AST-ийг тооцоолж НҮДНИЙ утга буцаана (муж энд зөвшөөрөгдөхгүй). */
export function evaluateAst(ast: Node, ctx: EvalContext): CellValue | FormulaError {
  const v = evalNode(ast, ctx);
  if (isRange(v)) return ERR.formula;
  return v;
}

/** Томьёоны текстийг задлан шинжлээд тооцоолно. */
export function evaluateFormula(formula: string, ctx: EvalContext): CellValue | FormulaError {
  const res = parse(formula);
  if (!res.ok) return ERR.formula;
  return evaluateAst(res.ast, ctx);
}
