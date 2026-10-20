/**
 * Томьёоны ЛАВЛАГААГ тодруулах — Excel-ийн зан төлөв.
 *
 * Нүд дээр зогсоход (эсвэл засварлаж эхлэхэд) тухайн томьёоны заасан нүд/мужууд
 * өнгөт хүрээтэй болно. Ингэснээр `=Q9+Q10+Q11+…` гэсэн урт томьёо ЮУГ нийлбэрлэж
 * байгаа нь хараад л ойлгогдоно — нүд бүрийг тоолж суух шаардлагагүй.
 *
 * ⚠️ Задлан шинжлэхдээ ХӨДӨЛГҮҮРИЙГ (`parse`) ашиглана — regex биш. Тиймээс
 * хашилт доторх текст (`"A1 гэж бичсэн"`), функцийн нэр (`LOG10`), хөндлөн
 * хуудасны лавлагаа бүгд зөв ялгагдана.
 */
import { parse, type Node } from './formula/parser';
import { coordToRef, refToCoord } from './formula/refs';
import type { CellRef, SheetDoc } from '../types/quotes';

/** Тодруулгын өнгөний тоо — дараалан эргэлдэнэ (Excel мөн адил цөөн өнгөтэй). */
export const REF_HIGHLIGHT_COUNT = 5;

/**
 * Нэг лавлагааны хамрах хүрээ.
 * `sheet` байвал ӨӨР хуудсых — тухайн хуудсан дээр тодруулахгүй.
 */
export interface RefSpan {
  /** Тодруулгын өнгөний индекс (0..REF_HIGHLIGHT_COUNT-1). */
  tone: number;
  minR: number;
  maxR: number;
  minC: number;
  maxC: number;
  /** Хөндлөн лавлагааны хуудасны нэр (тухайн хуудсынх бол `undefined`). */
  sheet?: string;
}

/**
 * Томьёоноос лавлагаануудыг гаргана — гарч ирсэн ДАРААЛЛААР өнгө онооно.
 * Ижил лавлагаа хоёр удаа гарвал НЭГ өнгөтэй (Excel-тэй ижил).
 *
 * `=` -ээр эхлээгүй (томьёо биш) бол хоосон массив.
 */
export function collectRefSpans(formula: string | undefined): RefSpan[] {
  if (!formula || !formula.trimStart().startsWith('=')) return [];
  const parsed = parse(formula);
  if (!parsed.ok) return [];

  const out: RefSpan[] = [];
  const toneByKey = new Map<string, number>();

  const push = (from: CellRef, to: CellRef, sheet?: string) => {
    const a = refToCoord(from);
    const b = refToCoord(to);
    if (!a || !b) return;
    const span: Omit<RefSpan, 'tone'> = {
      minR: Math.min(a.r, b.r),
      maxR: Math.max(a.r, b.r),
      minC: Math.min(a.c, b.c),
      maxC: Math.max(a.c, b.c),
      sheet,
    };
    const key = `${sheet ?? ''}!${span.minR},${span.minC},${span.maxR},${span.maxC}`;
    let tone = toneByKey.get(key);
    if (tone === undefined) {
      tone = toneByKey.size % REF_HIGHLIGHT_COUNT;
      toneByKey.set(key, tone);
    }
    out.push({ tone, ...span });
  };

  const walk = (n: Node): void => {
    switch (n.t) {
      case 'ref':
        push(n.ref, n.ref, n.sheet);
        break;
      case 'range':
        push(n.from, n.to, n.sheet);
        break;
      case 'unary':
        walk(n.x);
        break;
      case 'binary':
        walk(n.a);
        walk(n.b);
        break;
      case 'call':
        for (const a of n.args) walk(a);
        break;
      default:
        break;
    }
  };
  walk(parsed.ast);
  return out;
}

/**
 * `(r,c)` нүдэнд тохирох тодруулгын өнгө (олон лавлагаа давхцвал ЭХНИЙХ нь).
 * Хөндлөн хуудасны лавлагааг алгасана — тэр нүд энэ хуудсанд байхгүй.
 */
export function refToneAt(spans: RefSpan[], r: number, c: number): number | null {
  for (const s of spans) {
    if (s.sheet) continue;
    if (r >= s.minR && r <= s.maxR && c >= s.minC && c <= s.maxC) return s.tone;
  }
  return null;
}

/**
 * Тодруулгын мужийн ИРМЭГИЙГ тодорхойлно — Excel шиг зөвхөн ГАДНА талын
 * хүрээ зурахын тулд (дотоод нүднүүдийн хооронд шугам гарахгүй).
 */
export function refEdgesAt(
  spans: RefSpan[],
  r: number,
  c: number,
): { tone: number; top: boolean; right: boolean; bottom: boolean; left: boolean } | null {
  for (const s of spans) {
    if (s.sheet) continue;
    if (r < s.minR || r > s.maxR || c < s.minC || c > s.maxC) continue;
    return {
      tone: s.tone,
      top: r === s.minR,
      right: c === s.maxC,
      bottom: r === s.maxR,
      left: c === s.minC,
    };
  }
  return null;
}

/**
 * Томьёоны ТЕКСТИЙГ хэсгүүдэд хуваана — лавлагаа бүрийг өнгөөр будахад.
 * `tone === null` бол ердийн текст.
 *
 * ⚠️ Текстийг ДАХИН задлахын оронд `collectRefSpans`-ийн өнгөтэй тааруулахын
 * тулд жижиг сканнер ашиглана: томьёоны бичигдсэн ДАРААЛАЛ нь AST-г гүйсэн
 * дараалалтай тохирдоггүй тул (жишээ нь `SUM(A1:B2)*C3`) хаяг бүрийг өөрөө
 * олоод, `collectRefSpans`-ийн хуваарилалттай ижил түлхүүрээр өнгө авна.
 */
export interface FormulaChunk {
  text: string;
  tone: number | null;
}

export function splitFormulaByRefs(formula: string, spans: RefSpan[]): FormulaChunk[] {
  if (spans.length === 0) return [{ text: formula, tone: null }];

  // Муж/нүдний хаяг → өнгө. `collectRefSpans`-тай ижил түлхүүр.
  const toneOf = (from: string, to: string, sheet?: string): number | null => {
    const a = refToCoord(from);
    const b = refToCoord(to);
    if (!a || !b) return null;
    const key = `${sheet ?? ''}!${Math.min(a.r, b.r)},${Math.min(a.c, b.c)},${Math.max(a.r, b.r)},${Math.max(a.c, b.c)}`;
    for (const s of spans) {
      const sk = `${s.sheet ?? ''}!${s.minR},${s.minC},${s.maxR},${s.maxC}`;
      if (sk === key) return s.tone;
    }
    return null;
  };

  const out: FormulaChunk[] = [];
  let plain = '';
  const flush = () => {
    if (plain !== '') {
      out.push({ text: plain, tone: null });
      plain = '';
    }
  };

  // `A1`, `A1:B2`, `Нэр!A1` — хашилт доторхыг алгасана.
  const re = /("(?:[^"]|"")*")|((?:'[^']*'|[\p{L}_][\p{L}\p{N}_]*)!)?(\$?[A-Za-z]{1,3}\$?\d{1,7})(\s*:\s*(\$?[A-Za-z]{1,3}\$?\d{1,7}))?/gu;
  let last = 0;
  for (let m = re.exec(formula); m; m = re.exec(formula)) {
    if (m[1] !== undefined) continue; // мөрийн литерал — хэвээр
    const [whole] = m;
    const sheetPrefix = m[2];
    const first = m[3] as string;
    const second = m[5];
    const sheet = sheetPrefix ? sheetPrefix.slice(0, -1).replace(/^'|'$/g, '') : undefined;
    const tone = toneOf(first, second ?? first, sheet);
    if (tone === null) continue;
    plain += formula.slice(last, m.index);
    flush();
    out.push({ text: whole, tone });
    last = m.index + whole.length;
  }
  plain += formula.slice(last);
  flush();
  return out;
}

/** Хуудсан дээр тухайн нүдний томьёог уншиж лавлагаануудыг гаргах товчлол. */
export function refSpansOfCell(sheet: SheetDoc, r: number, c: number): RefSpan[] {
  return collectRefSpans(sheet.cells[coordToRef(r, c)]?.f);
}
