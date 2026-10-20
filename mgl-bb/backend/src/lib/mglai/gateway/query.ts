/**
 * MGL AI · БҮТЭЦТЭЙ ASUULGA (Query DSL) — АЮУЛГҮЙ SQL УГСРАЛТ (§12).
 *
 * ⚠️ ГАДНААС ИРДЭГ ЗҮЙЛ БОЛ ЗӨВХӨН БҮТЭЦ: {entity, fields, filters, sort,
 *    limit, aggregate, group_by}.  Талбар бүр каталогоос ЗӨВШӨӨРСӨН
 *    жагсаалтаар шалгагдаж, багана нь БИДНИЙ `col`-оос ирнэ, утга нь
 *    ЗААВАЛ bind-ээр явна.  Дурын мөр SQL-д хэзээ ч залгагдахгүй.
 *
 * ⚠️ ЭРХИЙН ДАВХАРГА ХОЁР: (1) entity + талбар нь горимоор шүүгдэнэ
 *    (`fieldsForMode`), (2) мөрийн хамрах хүрээ нь entity-ийн ЭХ дэд
 *    асуулгад орсон тул ямар ч шүүлт түүнийг тойрохгүй.
 *
 * ⚠️ ХЭМЖЭЭНИЙ ХЯЗГААР: ≤ 100 мөр, ≤ 8 шүүлт, `in` ≤ 20 утга, текст ≤ 200
 *    тэмдэгт.  Загварын контекст 8K — 200 мөр нь түүнийг дүүргэнэ.
 *
 * ⚠️ ЦЭВЭР ХЭСЭГ (`compileQuery`) нь D1-гүй, тестлэгдэнэ; `runQuery` нь
 *    зөвхөн гүйцэтгэнэ.
 */
import type { Env } from '../../../types';
import {
  ENTITIES,
  fieldsForMode,
  isKnownEntity,
  type EntityDef,
  type FieldDef,
  type ScopeCtx,
} from './entities';

export const FILTER_OPS = [
  'eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'is_null', 'not_null',
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const AGG_FNS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export type AggFn = (typeof AGG_FNS)[number];

export interface QueryFilter {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export interface EntityQuery {
  entity: string;
  fields?: string[];
  filters?: QueryFilter[];
  sort?: { field: string; dir?: 'asc' | 'desc' };
  limit?: number;
  group_by?: string;
  aggregate?: { fn: AggFn; field?: string }[];
}

export interface CompiledQuery {
  sql: string;
  binds: unknown[];
  /** Нийт тааралтыг тоолох асуулга (нэгтгэлгүй үед). */
  countSql: string | null;
  countBinds: unknown[];
  entity: EntityDef;
  fields: string[];
  limit: number;
  aggregated: boolean;
}

export type CompileResult = { ok: true; query: CompiledQuery } | { ok: false; error: string };

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const MAX_FILTERS = 8;
const MAX_IN = 20;
const MAX_TEXT = 200;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** «today», «today+30», «today-90» — planner-ийн харьцангуй огноо. */
const REL_DATE_RE = /^today([+-]\d{1,3})?$/;

function addDays(iso: string, delta: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Утгыг талбарын төрөлд тааруулж хувиргана — таарахгүй бол алдаа. */
function coerce(f: FieldDef, raw: unknown, today: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const bad = (why: string) => ({ ok: false as const, error: `«${f.name}»: ${why}` });
  switch (f.type) {
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isInteger(n)) return bad('бүхэл тоо байх ёстой');
      return { ok: true, value: n };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return bad('тоо байх ёстой');
      return { ok: true, value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw ? 1 : 0 };
      if (raw === 1 || raw === 0) return { ok: true, value: raw };
      if (raw === 'true' || raw === 'false') return { ok: true, value: raw === 'true' ? 1 : 0 };
      return bad('true/false байх ёстой');
    }
    case 'date': {
      if (typeof raw !== 'string') return bad('YYYY-MM-DD огноо байх ёстой');
      const s = raw.trim();
      if (DATE_RE.test(s)) return { ok: true, value: s };
      const m = REL_DATE_RE.exec(s);
      if (m) return { ok: true, value: addDays(today, m[1] ? Number(m[1]) : 0) };
      return bad('YYYY-MM-DD эсвэл today±N байх ёстой');
    }
    default: {
      if (typeof raw !== 'string') return bad('текст байх ёстой');
      const s = raw.trim();
      if (s.length === 0) return bad('хоосон');
      return { ok: true, value: s.slice(0, MAX_TEXT) };
    }
  }
}

/**
 * ⚠️ ГОЛ ФУНКЦ — цэвэр.  Бүтцийг шалгаж SQL + bind угсарна.
 */
export function compileQuery(raw: unknown, scope: ScopeCtx): CompileResult {
  const fail = (error: string): CompileResult => ({ ok: false, error });
  if (!raw || typeof raw !== 'object') return fail('query нь объект байх ёстой.');
  const q = raw as Record<string, unknown>;

  if (!isKnownEntity(q.entity)) return fail(`Танихгүй entity: ${String(q.entity)}`);
  const entity = ENTITIES[q.entity]!;
  if (!(entity.modes as readonly string[]).includes(scope.mode)) {
    return fail(`«${entity.name}» энэ горимд харагдахгүй.`);
  }

  const visible = fieldsForMode(entity, scope.mode);
  const byName = new Map(visible.map((f) => [f.name, f]));
  const field = (name: unknown): FieldDef | null =>
    typeof name === 'string' ? byName.get(name) ?? null : null;

  // ── Талбарууд ────────────────────────────────────────────────────
  let fields: string[];
  if (Array.isArray(q.fields) && q.fields.length > 0) {
    fields = [];
    for (const n of q.fields.slice(0, 20)) {
      if (!field(n)) return fail(`Танихгүй талбар: ${String(n)}`);
      if (!fields.includes(n as string)) fields.push(n as string);
    }
  } else {
    // Өгөгдмөл ТОВЧ талбарууд (горимд харагдах нь л) — бүх багана биш.
    const def = entity.defaultFields?.filter((n) => byName.has(n)) ?? [];
    fields = def.length > 0 ? def : visible.map((f) => f.name);
  }

  // ── Шүүлтүүд ─────────────────────────────────────────────────────
  const where: string[] = [];
  const binds: unknown[] = [];
  const filters = Array.isArray(q.filters) ? q.filters : [];
  if (filters.length > MAX_FILTERS) return fail(`Шүүлт ${MAX_FILTERS}-аас олон байж болохгүй.`);
  for (const fr of filters) {
    if (!fr || typeof fr !== 'object') return fail('Шүүлт бүр объект байх ёстой.');
    const f = field((fr as QueryFilter).field);
    if (!f) return fail(`Танихгүй шүүлтийн талбар: ${String((fr as QueryFilter).field)}`);
    if (!f.filterable) return fail(`«${f.name}» талбараар шүүх боломжгүй.`);
    const op = (fr as QueryFilter).op;
    if (!(FILTER_OPS as readonly string[]).includes(op)) return fail(`Танихгүй оператор: ${String(op)}`);
    const value = (fr as QueryFilter).value;
    const col = `q.${f.col}`;

    if (op === 'is_null') {
      where.push(`${col} IS NULL`);
      continue;
    }
    if (op === 'not_null') {
      where.push(`${col} IS NOT NULL`);
      continue;
    }
    if (op === 'in') {
      if (!Array.isArray(value) || value.length === 0) return fail(`«${f.name}» in: массив хэрэгтэй.`);
      if (value.length > MAX_IN) return fail(`«${f.name}» in: ${MAX_IN}-аас олон утга.`);
      const vals: unknown[] = [];
      for (const v of value) {
        const c = coerce(f, v, scope.today);
        if (!c.ok) return fail(c.error);
        vals.push(c.value);
      }
      where.push(`${col} IN (${vals.map(() => '?').join(', ')})`);
      binds.push(...vals);
      continue;
    }
    if (op === 'contains') {
      if (f.type !== 'string') return fail(`«${f.name}»: contains зөвхөн текстэнд.`);
      if (typeof value !== 'string' || value.trim().length === 0) return fail(`«${f.name}» contains: текст хэрэгтэй.`);
      where.push(`instr(lower(COALESCE(${col}, '')), lower(?)) > 0`);
      binds.push(value.trim().slice(0, MAX_TEXT));
      continue;
    }
    const c = coerce(f, value, scope.today);
    if (!c.ok) return fail(c.error);
    const sqlOp = { eq: '=', ne: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=' }[op];
    where.push(`${col} ${sqlOp} ?`);
    binds.push(c.value);
  }

  // ── Нэгтгэл ──────────────────────────────────────────────────────
  const aggs = Array.isArray(q.aggregate) ? q.aggregate : [];
  const groupField = q.group_by === undefined || q.group_by === null ? null : field(q.group_by);
  if (q.group_by !== undefined && q.group_by !== null && !groupField) {
    return fail(`Танихгүй group_by талбар: ${String(q.group_by)}`);
  }
  if (groupField && aggs.length === 0) {
    // Бүлэглээд тоолохгүй нь утгагүй — өгөгдмөлөөр count.
    aggs.push({ fn: 'count' });
  }
  const aggregated = aggs.length > 0;
  if (aggregated && !entity.operations.includes('aggregate') && !entity.operations.includes('count')) {
    return fail(`«${entity.name}» нэгтгэл дэмжихгүй.`);
  }
  if (groupField && !entity.operations.includes('group')) {
    return fail(`«${entity.name}» бүлэглэл дэмжихгүй.`);
  }

  const selectCols: string[] = [];
  const outFields: string[] = [];
  if (aggregated) {
    if (groupField) {
      selectCols.push(`q.${groupField.col} AS ${groupField.name}`);
      outFields.push(groupField.name);
    }
    for (const a of aggs.slice(0, 5)) {
      if (!a || typeof a !== 'object') return fail('aggregate бүр объект байх ёстой.');
      const fn = (a as { fn: unknown }).fn;
      if (!(AGG_FNS as readonly string[]).includes(fn as string)) return fail(`Танихгүй нэгтгэл: ${String(fn)}`);
      if (fn === 'count') {
        selectCols.push('COUNT(*) AS count');
        outFields.push('count');
        continue;
      }
      const af = field((a as { field?: unknown }).field);
      if (!af) return fail(`${String(fn)}: талбар хэрэгтэй.`);
      if (!af.numeric && fn !== 'min' && fn !== 'max') return fail(`«${af.name}» тоон талбар биш.`);
      const alias = `${fn}_${af.name}`;
      selectCols.push(`${String(fn).toUpperCase()}(q.${af.col}) AS ${alias}`);
      outFields.push(alias);
    }
  } else {
    for (const n of fields) {
      const f = byName.get(n)!;
      selectCols.push(`q.${f.col} AS ${f.name}`);
      outFields.push(f.name);
    }
  }

  // ── Эрэмбэ ───────────────────────────────────────────────────────
  let orderBy = '';
  const sortRaw = q.sort && typeof q.sort === 'object' ? (q.sort as { field?: unknown; dir?: unknown }) : null;
  if (sortRaw) {
    const dir = sortRaw.dir === 'desc' ? 'DESC' : 'ASC';
    if (aggregated) {
      // Нэгтгэлд зөвхөн гаралтын багана (count, sum_x …) эсвэл group талбараар.
      const name = typeof sortRaw.field === 'string' ? sortRaw.field : '';
      if (!outFields.includes(name)) return fail(`Нэгтгэлд «${name}»-аар эрэмбэлэх боломжгүй.`);
      orderBy = ` ORDER BY ${name} ${dir}`;
    } else {
      const sf = field(sortRaw.field);
      if (!sf) return fail(`Танихгүй эрэмбийн талбар: ${String(sortRaw.field)}`);
      if (!sf.sortable) return fail(`«${sf.name}» талбараар эрэмбэлэх боломжгүй.`);
      // NULL-ыг СҮҮЛД — «хамгийн ойрхон deadline» асуултад огноогүй мөр эхэнд гарахгүй.
      orderBy = ` ORDER BY (q.${sf.col} IS NULL), q.${sf.col} ${dir}`;
    }
  } else if (!aggregated && entity.defaultSort) {
    const sf = byName.get(entity.defaultSort.field);
    if (sf) orderBy = ` ORDER BY (q.${sf.col} IS NULL), q.${sf.col} ${entity.defaultSort.dir.toUpperCase()}`;
  } else if (aggregated && outFields.includes('count')) {
    orderBy = ' ORDER BY count DESC';
  }

  // ── Хязгаар ──────────────────────────────────────────────────────
  const limRaw = typeof q.limit === 'number' ? q.limit : Number(q.limit ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(limRaw) && limRaw > 0 ? Math.min(limRaw, MAX_LIMIT) : DEFAULT_LIMIT;

  const src = entity.source(scope);
  const whereSql = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
  const groupSql = groupField ? ` GROUP BY q.${groupField.col}` : '';
  const sql = `SELECT ${selectCols.join(', ')} FROM (${src.sql}) q${whereSql}${groupSql}${orderBy} LIMIT ?`;

  return {
    ok: true,
    query: {
      sql,
      binds: [...src.binds, ...binds, limit],
      countSql: aggregated ? null : `SELECT COUNT(*) AS n FROM (${src.sql}) q${whereSql}`,
      countBinds: [...src.binds, ...binds],
      entity,
      fields: outFields,
      limit,
      aggregated,
    },
  };
}

export interface QueryResult {
  entity: string;
  authority: string;
  fields: string[];
  rows: Record<string, unknown>[];
  returned: number;
  /** Шүүлтэд таарсан НИЙТ мөр (нэгтгэлгүй үед) — «24-өөс 25-ыг харуулав». */
  total_matching: number | null;
  truncated: boolean;
}

/** D1 дээр гүйцэтгэнэ.  ⚠️ Зөвхөн `compileQuery`-ийн гаралтыг авна. */
export async function runQuery(env: Env, compiled: CompiledQuery): Promise<QueryResult> {
  const { results } = await env.DB.prepare(compiled.sql)
    .bind(...compiled.binds)
    .all<Record<string, unknown>>();
  const rows = results ?? [];
  let total: number | null = null;
  if (compiled.countSql) {
    const c = await env.DB.prepare(compiled.countSql)
      .bind(...compiled.countBinds)
      .first<{ n: number }>();
    total = Number(c?.n ?? rows.length);
  }
  return {
    entity: compiled.entity.name,
    authority: compiled.entity.authority,
    fields: compiled.fields,
    rows,
    returned: rows.length,
    total_matching: total,
    truncated: total !== null && total > rows.length,
  };
}
