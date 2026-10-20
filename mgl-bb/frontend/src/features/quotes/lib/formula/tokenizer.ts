/**
 * Томьёоны лексер: түүхий текстийг токен болгож задална.
 *
 * ⚠️ Аргументийн тусгаарлагч нь `;` БА `,` ХОЁУЛАА. Монголд Excel ихэвчлэн `;`
 * хэрэглэдэг (системийн бүсчлэл), гэхдээ англи бичиглэлээс хуулсан томьёо `,`
 * бичсэн байдаг — хоёуланг нь хүлээж авахгүй бол хэрэглэгч шалтгаангүй
 * `#ТОМЬЁО!` хардаг. Тиймээс аль алиныг нь `sep` токен болгоно.
 *
 * Хаяг (`A1`) ба муж (`A1:B9`)-ийг ЭНД ялгана. Учир нь `SUM(A1:B9)` дахь `:`
 * нь ердийн оператор биш — зөвхөн хоёр хаягийн хооронд утгатай. Танигчийн
 * дараа `(` ирвэл энэ бол функцийн нэр (кирилл нэр ч зөвшөөрнө).
 */
import type { CellRef } from '../../types/quotes';
import { isNameStart, isRefName, normalizeRef } from './refs';

export type TokenKind =
  | 'num' // 1234.5
  | 'str' // "текст"
  | 'ref' // A1
  | 'range' // A1:B9
  | 'func' // SUM, TARIF, ХҮҮ …
  | 'err' // #ХАСАГДСАН! мэт алдааны литерал
  | 'op' // + - * / ^ = <> < <= > >= :
  | 'lparen'
  | 'rparen'
  | 'sep' // ; эсвэл ,
  | 'percent'; // постфикс %

export interface Token {
  kind: TokenKind;
  /** Түүхий текст (оператор/функцийн нэрд ашиглагдана). */
  text: string;
  /** `num` үед тоон утга. */
  num?: number;
  /** `str` үед хашилтгүй, escape тайлсан утга. */
  str?: string;
  /** `ref` үед хаяг; `range` үед эхлэлийн хаяг. */
  ref?: CellRef;
  /** `range` үед төгсгөлийн хаяг. */
  ref2?: CellRef;
  /** Хөндлөн хуудасны лавлагаа (`ИГС!G17`) үед хуудасны нэр. Эс бөгөөс тухайн хуудас. */
  sheet?: string;
  /** Эх мөр дэх байрлал (алдаа мөшгихөд). */
  pos: number;
}

export type TokenizeResult = { ok: true; tokens: Token[] } | { ok: false; error: '#ТОМЬЁО!' };

const FAIL: TokenizeResult = { ok: false, error: '#ТОМЬЁО!' };

/**
 * Томьёон дотор ШУУД бичигдэж болох алдааны литералууд.
 *
 * Мөр устгахад `shiftRefsInFormula` нь лавлагааг `#ХАСАГДСАН!` болгодог тул
 * лексер үүнийг заавал таних ёстой — эс бөгөөс тухайн нүд «мэдэхгүй тэмдэгт»
 * гэж `#ТОМЬЁО!` өгч, шалтгаан нь далдарна.
 */
const ERROR_LITERALS = ['#ХАСАГДСАН!', '#ЦИКЛ!', '#ТАРИФ!', '#ТООЦОО!', '#ТОМЬЁО!'] as const;

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}
function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/**
 * `s[start]`-аас эхлэн ХАЯГ эсвэл МУЖ уншина (`A1` / `A1:B9`). Танихгүй бол
 * `null`. Хөндлөн лавлагаа (`ИГС!A1`) ба ердийн лавлагаа хоёр ижил ашиглана.
 */
function readRefOrRange(
  s: string,
  start: number,
): { kind: 'ref' | 'range'; ref: CellRef; ref2?: CellRef; end: number } | null {
  let i = start;
  const lettersStart = i;
  while (i < s.length && isNameStart(s[i] as string)) i += 1;
  const letters = s.slice(lettersStart, i);
  const digitsAt = i;
  while (i < s.length && isDigit(s[i] as string)) i += 1;
  const text = letters + s.slice(digitsAt, i);
  if (letters.length === 0 || !isRefName(text)) return null;

  // муж уу? `A1:B9`
  let k = i;
  while (k < s.length && isSpace(s[k] as string)) k += 1;
  if (s[k] === ':') {
    let m = k + 1;
    while (m < s.length && isSpace(s[m] as string)) m += 1;
    const secondStart = m;
    while (m < s.length && isNameStart(s[m] as string)) m += 1;
    const secondLetters = s.slice(secondStart, m);
    const secondDigitsAt = m;
    while (m < s.length && isDigit(s[m] as string)) m += 1;
    const secondText = secondLetters + s.slice(secondDigitsAt, m);
    if (secondLetters.length > 0 && isRefName(secondText)) {
      return {
        kind: 'range',
        ref: normalizeRef(text),
        ref2: normalizeRef(secondText),
        end: m,
      };
    }
  }
  return { kind: 'ref', ref: normalizeRef(text), end: i };
}

/**
 * Томьёог токенууд болгоно.
 *
 * Тэргүүний `=`-ийг хасна: `SheetCell.f` нь `'=D4*E4'` хэлбэрээр хадгалагддаг ч
 * дотор нь `=` нь харьцуулалтын оператор (`=IF(A1=2;…)`). Эхний `=` л тусгай.
 */
export function tokenize(src: string): TokenizeResult {
  const raw = src.trim();
  const s = raw.startsWith('=') ? raw.slice(1) : raw;
  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const ch = s[i] as string;

    if (isSpace(ch)) {
      i += 1;
      continue;
    }

    // ---- тоо: 123, 1.5, .5, 1e3 ----
    if (isDigit(ch) || (ch === '.' && isDigit(s[i + 1] ?? ''))) {
      const start = i;
      while (i < s.length && isDigit(s[i] as string)) i += 1;
      if (s[i] === '.') {
        i += 1;
        while (i < s.length && isDigit(s[i] as string)) i += 1;
      }
      // экспонент — зөвхөн ард нь цифр байвал (эс бөгөөс E1 нь хаяг байж мэднэ)
      if (s[i] === 'e' || s[i] === 'E') {
        const save = i;
        let j = i + 1;
        if (s[j] === '+' || s[j] === '-') j += 1;
        if (isDigit(s[j] ?? '')) {
          i = j;
          while (i < s.length && isDigit(s[i] as string)) i += 1;
        } else i = save;
      }
      const text = s.slice(start, i);
      const num = Number(text);
      if (!Number.isFinite(num)) return FAIL;
      tokens.push({ kind: 'num', text, num, pos: start });
      continue;
    }

    // ---- мөрийн литерал: "…", дотор нь "" = нэг хашилт ----
    if (ch === '"') {
      const start = i;
      let j = i + 1;
      let value = '';
      let closed = false;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        value += s[j];
        j += 1;
      }
      if (!closed) return FAIL;
      tokens.push({ kind: 'str', text: s.slice(start, j), str: value, pos: start });
      i = j;
      continue;
    }

    // ---- алдааны литерал: #ХАСАГДСАН! ----
    if (ch === '#') {
      const hit = ERROR_LITERALS.find((code) => s.startsWith(code, i));
      if (!hit) return FAIL;
      tokens.push({ kind: 'err', text: hit, pos: i });
      i += hit.length;
      continue;
    }

    // ---- хашилттай хуудасны нэр: 'Sheet Name'!A1 ----
    if (ch === "'") {
      let j = i + 1;
      let name = '';
      let closed = false;
      while (j < s.length) {
        if (s[j] === "'") {
          if (s[j + 1] === "'") {
            name += "'";
            j += 2;
            continue;
          }
          j += 1;
          closed = true;
          break;
        }
        name += s[j];
        j += 1;
      }
      if (!closed || s[j] !== '!') return FAIL;
      const rr = readRefOrRange(s, j + 1);
      if (!rr) return FAIL;
      tokens.push({
        kind: rr.kind,
        text: s.slice(i, rr.end),
        ref: rr.ref,
        ref2: rr.ref2,
        sheet: name,
        pos: i,
      });
      i = rr.end;
      continue;
    }

    // ---- танигч: хаяг, муж, функцийн нэр, эсвэл хөндлөн лавлагаа (Нэр!A1) ----
    if (isNameStart(ch)) {
      const start = i;
      while (i < s.length && isNameStart(s[i] as string)) i += 1;
      const letters = s.slice(start, i);
      const digitsAt = i;
      while (i < s.length && isDigit(s[i] as string)) i += 1;
      const text = letters + s.slice(digitsAt, i);

      let k = i;
      while (k < s.length && isSpace(s[k] as string)) k += 1;

      // Хөндлөн хуудасны лавлагаа: `Нэр!A1`. `!` эхэлбэл `text` нь хуудасны нэр.
      if (s[k] === '!') {
        const rr = readRefOrRange(s, k + 1);
        if (!rr) return FAIL;
        tokens.push({
          kind: rr.kind,
          text: s.slice(start, rr.end),
          ref: rr.ref,
          ref2: rr.ref2,
          sheet: text,
          pos: start,
        });
        i = rr.end;
        continue;
      }

      if (s[k] === '(') {
        tokens.push({ kind: 'func', text, pos: start });
        continue;
      }
      if (!isRefName(text)) return FAIL; // хашилтгүй чөлөөт үг — томьёо биш

      // муж уу? `A1:B9`
      if (s[k] === ':') {
        let m = k + 1;
        while (m < s.length && isSpace(s[m] as string)) m += 1;
        const secondStart = m;
        while (m < s.length && isNameStart(s[m] as string)) m += 1;
        const secondLetters = s.slice(secondStart, m);
        const secondDigitsAt = m;
        while (m < s.length && isDigit(s[m] as string)) m += 1;
        const secondText = secondLetters + s.slice(secondDigitsAt, m);
        if (secondLetters.length > 0 && isRefName(secondText)) {
          tokens.push({
            kind: 'range',
            text: `${text}:${secondText}`,
            ref: normalizeRef(text),
            ref2: normalizeRef(secondText),
            pos: start,
          });
          i = m;
          continue;
        }
      }

      tokens.push({ kind: 'ref', text, ref: normalizeRef(text), pos: start });
      continue;
    }

    // ---- операторууд ба цэг таслал ----
    if (ch === '(') {
      tokens.push({ kind: 'lparen', text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ';' || ch === ',') {
      tokens.push({ kind: 'sep', text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === '%') {
      tokens.push({ kind: 'percent', text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === '<') {
      const next = s[i + 1];
      const text = next === '>' || next === '=' ? `<${next}` : '<';
      tokens.push({ kind: 'op', text, pos: i });
      i += text.length;
      continue;
    }
    if (ch === '>') {
      const text = s[i + 1] === '=' ? '>=' : '>';
      tokens.push({ kind: 'op', text, pos: i });
      i += text.length;
      continue;
    }
    // `&` нь мөр залгах оператор (Excel-тэй ижил). Үнийн саналын тайлбар мөр
    // «…дүн ₮"&TEXT(M13)&" /"&USGEER(M13)&" төгрөг/…» гэж угсардаг тул хэрэгтэй.
    if (
      ch === '+' ||
      ch === '-' ||
      ch === '*' ||
      ch === '/' ||
      ch === '^' ||
      ch === '=' ||
      ch === '&' ||
      ch === ':'
    ) {
      tokens.push({ kind: 'op', text: ch, pos: i });
      i += 1;
      continue;
    }

    return FAIL; // танихгүй тэмдэгт
  }

  return { ok: true, tokens };
}
