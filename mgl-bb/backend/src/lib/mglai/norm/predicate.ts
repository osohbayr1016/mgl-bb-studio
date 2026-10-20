/**
 * Хөрвүүлсэн ПРЕДИКАТЫН үнэлгээ — ГУРВАН УТГАТ логик.
 *
 *   true     — нөхцөл хангагдав
 *   false    — хангагдсангүй (эсвэл enum/туг ҮЛ ЗААГДСАН — «хэрэглэгч тэгж
 *              хэлээгүй» = тийм биш; зөвхөн ТООН талбар л «дутуу» байж болно)
 *   missing  — тоон талбар өгөгдөөгүй; `needs`-д нэрс
 *   conflict — тоон утга нь эх сурвалжийн ХИЛИЙН ЗӨРЧИЛ дээр яг буув (28 °C) —
 *              шийдэхгүй (Amendment C)
 *
 * ⚠️ Тоон харьцуулалт ХАТУУ/БАГТААСАН гэдгээ бичлэгээс авна (`op`), эндээс
 *    ТААМАГЛАХГҮЙ.  `between` нь хоёр тал БАГТААСАН (В2 = 1401..2200 гэх мэт).
 */
import type { CompiledBoundaryConflict, CompiledPredicate } from './registryTypes';

export type PredValue = number | string | boolean | readonly string[];
export type PredContext = Readonly<Record<string, PredValue | undefined>>;

export type PredOutcome =
  | { state: 'true' }
  | { state: 'false' }
  | { state: 'missing'; needs: string[] }
  | { state: 'conflict'; field: string; value: number };

export function compareNumber(op: string, actual: number, expected: number | [number, number]): boolean {
  if (Array.isArray(expected)) return actual >= expected[0] && actual <= expected[1];
  switch (op) {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '=':
      return Math.abs(actual - expected) < 1e-9;
    default:
      return false;
  }
}

export function evaluatePredicate(p: CompiledPredicate | null, ctx: PredContext, conflicts: readonly CompiledBoundaryConflict[] = []): PredOutcome {
  if (p === null) return { state: 'true' };
  switch (p.kind) {
    case 'number': {
      const v = ctx[p.field];
      if (typeof v !== 'number') return { state: 'missing', needs: [p.field] };
      const hit = conflicts.find((c) => c.field === p.field && Math.abs(c.value - v) < 1e-9);
      if (hit) return { state: 'conflict', field: p.field, value: v };
      return compareNumber(p.op, v, p.value) ? { state: 'true' } : { state: 'false' };
    }
    case 'enum': {
      const v = ctx[p.field];
      const have = Array.isArray(v) ? (v as readonly string[]) : typeof v === 'string' ? [v] : [];
      return have.some((x) => p.in.includes(x)) ? { state: 'true' } : { state: 'false' };
    }
    case 'flag': {
      const v = ctx[p.field];
      if (typeof v !== 'boolean') return p.value === false ? { state: 'missing', needs: [p.field] } : { state: 'false' };
      return v === p.value ? { state: 'true' } : { state: 'false' };
    }
    case 'not_category': {
      // «А/Б БИШ» гэсэн нөхцөл: тэр ангиллын дүрэм БИЕЛСЭН бол false; тоон оролт
      // дутуугаас ШИЙДЭГДЭЭГҮЙ бол missing (тэр дүрмийн дутуу талбарууд); бусад
      // (биелээгүй эсвэл үнэлээгүй) бол true.  Үнэлсэн бүх ангиллыг «шийдэгдсэн»
      // гэж тооцдог байсан нь В мөрийг ХЭЗЭЭ Ч биелүүлдэггүй байв (2026-09-11 засав).
      const decided = ctx.__decided_categories;
      const have = Array.isArray(decided) ? (decided as readonly string[]) : [];
      if (have.some((c) => p.categories.includes(c))) return { state: 'false' };
      const undecided = ctx.__undecided_categories;
      const pend = Array.isArray(undecided) ? (undecided as readonly string[]) : [];
      const needs = pend
        .map((x) => x.split(':', 2))
        .filter(([cat]) => cat !== undefined && p.categories.includes(cat))
        .map(([, field]) => field ?? '')
        .filter((f) => f.length > 0);
      return needs.length > 0 ? { state: 'missing', needs: [...new Set(needs)] } : { state: 'true' };
    }
    case 'all': {
      const needs: string[] = [];
      for (const sub of p.of) {
        const o = evaluatePredicate(sub, ctx, conflicts);
        if (o.state === 'false') return o;
        if (o.state === 'conflict') return o;
        if (o.state === 'missing') needs.push(...o.needs);
      }
      return needs.length > 0 ? { state: 'missing', needs: [...new Set(needs)] } : { state: 'true' };
    }
    case 'any': {
      const needs: string[] = [];
      let conflict: PredOutcome | null = null;
      for (const sub of p.of) {
        const o = evaluatePredicate(sub, ctx, conflicts);
        if (o.state === 'true') return o;
        if (o.state === 'conflict') conflict = conflict ?? o;
        if (o.state === 'missing') needs.push(...o.needs);
      }
      if (conflict !== null) return conflict;
      return needs.length > 0 ? { state: 'missing', needs: [...new Set(needs)] } : { state: 'false' };
    }
  }
}

/**
 * Предикатын ЗААГДААГҮЙ enum/туг талбарууд — «хэрэглэгч хэлээгүй» гэж false болсон
 * нөхцөлүүд.  Нэг ч дүрэм биелээгүй үед «юу дутуу вэ» гэж ЗӨВ асуухад хэрэглэнэ
 * (өрөөний ангилалд орчин, шатамхай материал байгаа эсэх гэх мэт).
 */
export function absentFields(p: CompiledPredicate | null, ctx: PredContext): string[] {
  if (p === null) return [];
  switch (p.kind) {
    case 'number':
      return typeof ctx[p.field] === 'number' ? [] : [p.field];
    case 'enum': {
      const v = ctx[p.field];
      const have = Array.isArray(v) ? v.length > 0 : typeof v === 'string';
      return have ? [] : [p.field];
    }
    case 'flag':
      return typeof ctx[p.field] === 'boolean' ? [] : [p.field];
    case 'not_category':
      return [];
    case 'all':
    case 'any':
      return [...new Set(p.of.flatMap((sub) => absentFields(sub, ctx)))];
  }
}
