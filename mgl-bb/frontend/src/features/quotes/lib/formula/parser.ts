/**
 * Pratt (precedence climbing) задлан шинжлэгч — токенуудаас AST.
 *
 * Тэргүүлэх эрэмбэ (сулаас хүчтэй рүү):
 *   харьцуулалт (= <> < <= > >=) < `+ -` < `* /` < `^` < unary `-` < postfix `%`
 *
 * Unary `-` нь `^`-ээс ХҮЧТЭЙ тул `-2^2 = 4` (Excel-тэй ижил). `^` нь Excel-ийн
 * адил зүүн ассоциатив (`2^3^2 = 64`).
 *
 * Гадагшаа ХЭЗЭЭ Ч throw хийхгүй — алдааг `{ ok:false, error:'#ТОМЬЁО!' }`
 * хэлбэрээр буцаана. (Дотооддоо sentinel throw ашиглаад хилийн дээр барьж
 * авдаг — ингэснээр давхарласан рекурс бүрт алдааны шалгалт бичих шаардлагагүй.)
 */
import type { CellRef } from '../../types/quotes';
import { tokenize, type Token } from './tokenizer';

export type BinOp = '+' | '-' | '*' | '/' | '^' | '&' | '=' | '<>' | '<' | '<=' | '>' | '>=';
/** `%` нь постфикс боловч AST-д мөн адил нэг операндтай зангилаа. */
export type UnOp = '-' | '+' | '%';

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  /** `sheet` байвал хөндлөн хуудасны лавлагаа (`ИГС!G17`). */
  | { t: 'ref'; ref: CellRef; sheet?: string }
  | { t: 'range'; from: CellRef; to: CellRef; sheet?: string }
  | { t: 'unary'; op: UnOp; x: Node }
  | { t: 'binary'; op: BinOp; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] }
  /** Томьёонд шууд бичигдсэн алдааны литерал (`#ХАСАГДСАН!`). */
  | { t: 'err'; code: string };

export type ParseResult = { ok: true; ast: Node } | { ok: false; error: '#ТОМЬЁО!' };

const FAIL: ParseResult = { ok: false, error: '#ТОМЬЁО!' };

/** Зөвхөн энэ модулийн дотор шидэгддэг тэмдэг. */
const BAD = Symbol('bad-formula');

/**
 * Excel-ийн эрэмбийг дагана: харьцуулалт < `&` < `+ -` < `* /` < `^`.
 * `&` нь нэмэхээс СУЛ тул `="Дүн: "&A1+B1` нь `"Дүн: "&(A1+B1)` гэж уншигдана.
 */
const BIN_PREC: Record<string, number> = {
  '=': 1,
  '<>': 1,
  '<': 1,
  '<=': 1,
  '>': 1,
  '>=': 1,
  '&': 2,
  '+': 3,
  '-': 3,
  '*': 4,
  '/': 4,
  '^': 5,
};

class Parser {
  private i = 0;

  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.i];
  }

  private next(): Token {
    const t = this.tokens[this.i];
    if (!t) throw BAD;
    this.i += 1;
    return t;
  }

  private expect(kind: Token['kind']): Token {
    const t = this.peek();
    if (!t || t.kind !== kind) throw BAD;
    this.i += 1;
    return t;
  }

  /** Хамгийн гадна талын оролт: илэрхийлэл + үлдэгдэл токен байж болохгүй. */
  parseRoot(): Node {
    if (this.tokens.length === 0) throw BAD;
    const node = this.parseExpr(1);
    if (this.i !== this.tokens.length) throw BAD;
    return node;
  }

  private parseExpr(minPrec: number): Node {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (!t || t.kind !== 'op') break;
      const prec = BIN_PREC[t.text];
      if (prec === undefined || prec < minPrec) break;
      this.i += 1;
      // Бүх бинар оператор зүүн ассоциатив → баруун талыг prec+1-ээр уншина.
      const right = this.parseExpr(prec + 1);
      left = { t: 'binary', op: t.text as BinOp, a: left, b: right };
    }
    return left;
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t && t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.i += 1;
      return { t: 'unary', op: t.text as UnOp, x: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Node {
    let x = this.parsePrimary();
    while (this.peek()?.kind === 'percent') {
      this.i += 1;
      x = { t: 'unary', op: '%', x };
    }
    return x;
  }

  private parsePrimary(): Node {
    const t = this.next();
    switch (t.kind) {
      case 'num':
        return { t: 'num', v: t.num ?? 0 };
      case 'str':
        return { t: 'str', v: t.str ?? '' };
      case 'ref':
        return { t: 'ref', ref: t.ref as CellRef, sheet: t.sheet };
      case 'range':
        return { t: 'range', from: t.ref as CellRef, to: t.ref2 as CellRef, sheet: t.sheet };
      case 'err':
        return { t: 'err', code: t.text };
      case 'lparen': {
        const inner = this.parseExpr(1);
        this.expect('rparen');
        return inner;
      }
      case 'func':
        return this.parseCall(t.text);
      default:
        throw BAD;
    }
  }

  private parseCall(name: string): Node {
    this.expect('lparen');
    const args: Node[] = [];
    if (this.peek()?.kind === 'rparen') {
      this.i += 1;
      return { t: 'call', name, args };
    }
    for (;;) {
      args.push(this.parseExpr(1));
      const t = this.peek();
      if (t?.kind === 'sep') {
        this.i += 1;
        continue;
      }
      this.expect('rparen');
      return { t: 'call', name, args };
    }
  }
}

/** Токенуудаас AST. */
export function parseTokens(tokens: Token[]): ParseResult {
  try {
    return { ok: true, ast: new Parser(tokens).parseRoot() };
  } catch {
    // `BAD` эсвэл гэнэтийн дотоод алдаа — аль нь ч байсан хэрэглэгчид нэг л
    // зүйл харагдана: томьёо буруу. Хүснэгт хэзээ ч унтрахгүй.
    return FAIL;
  }
}

/** Томьёоны текстээс AST (`'=D4*E4'` эсвэл `'D4*E4'`). */
export function parse(formula: string): ParseResult {
  const lexed = tokenize(formula);
  if (!lexed.ok) return FAIL;
  return parseTokens(lexed.tokens);
}
