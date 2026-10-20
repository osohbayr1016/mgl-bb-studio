/**
 * D1 телеметр — «энэ хүсэлт хэдэн мөр УНШСАН бэ?» гэдгийг хэмжих хөнгөн давхарга.
 *
 * Cloudflare D1 нь буцаасан мөрөөр биш, СКАНДСАН мөрөөр тоолдог (`rows_read`)
 * — тиймээс нэг мөр буцаадаг ч 50 000 мөр уншсан query нь үнэгүй хязгаарыг
 * (5 сая мөр/өдөр) чимээгүй иддэг.  D1 үр дүн бүр `meta.rows_read` /
 * `meta.rows_written` / `meta.duration`-ыг аль хэдийн буцаадаг; энэ модуль
 * тэдгээрийг хүсэлт (эсвэл cron ажил) тус бүрээр НЭГТГЭЖ:
 *
 *   • `Server-Timing: d1;dur=<ms>;desc="q=<query> r=<rows_read> w=<rows_written>"`
 *     толгойгоор Chrome DevTools-ийн Timing таб руу,
 *   • босго давсан (эсвэл `D1_TELEMETRY_VERBOSE=1` үед бүх) хүсэлтийг
 *     `[d1]` лог мөрөөр `wrangler tail` руу — хамгийн хүнд 3 query-ийн
 *     эхний 140 тэмдэгттэй хамт.
 *
 * ⚠️ ЛОГ ХЭМЖЭЭ: өгөгдмөлөөр ЗӨВХӨН босго давсан хүсэлт логдоно (доорх
 *    `LOG_THRESHOLDS`) — минут тутмын cron, unread-count polling зэрэг хямд
 *    зам ямар ч мөр гаргахгүй.  Verbose горим нь зөвхөн локал хэмжилтэд.
 *
 * ⚠️ `first()` нь `all()`-аар хэрэгжсэн: D1-ийн `first()` ч бүтэн үр дүнг
 *    татаж эхнийхийг л буцаадаг тул rows_read ижил, харин `meta` ингэж л
 *    гарт орно.  Үр дүнгийн семантик (мөр байхгүй → null, багана нэрлэсэн →
 *    тэр утга) хэвээр.
 *
 * Гарын үсэг/зан төлөвийг өөрчлөхгүй: `instrumentD1(db)` нь `D1Database`
 * интерфэйсийг бүрэн хэрэгжүүлсэн ЖИНХЭНЭ D1 руу дамжуулагч буцаана.
 */

export interface D1QuerySample {
  sql: string;
  rowsRead: number;
  rowsWritten: number;
  rows: number;
  ms: number;
}

export interface D1Stats {
  queries: number;
  rowsRead: number;
  rowsWritten: number;
  /** D1-ийн өөрийнх нь `meta.duration` нийлбэр (ms). */
  durationMs: number;
  /** Хамгийн олон мөр уншсан query-үүд (дээд `SAMPLE_KEEP`). */
  heaviest: D1QuerySample[];
}

const SAMPLE_KEEP = 8;
const SQL_SNIPPET = 140;

/** Лог мөр гаргах босго — аль нэг нь давбал `[d1]` мөр бичигдэнэ. */
export const LOG_THRESHOLDS = {
  rowsRead: 2_000,
  rowsWritten: 50,
  queries: 25,
} as const;

export function newD1Stats(): D1Stats {
  return { queries: 0, rowsRead: 0, rowsWritten: 0, durationMs: 0, heaviest: [] };
}

/** Wrapped DB → stats, гаднаас (middleware) уншихад. */
const registry = new WeakMap<D1Database, D1Stats>();

export function d1StatsOf(db: D1Database): D1Stats | undefined {
  return registry.get(db);
}

type Meta = Partial<{
  rows_read: number;
  rows_written: number;
  duration: number;
  changes: number;
}>;

function record(stats: D1Stats, sql: string, meta: Meta | undefined, rows: number): void {
  const rowsRead = meta?.rows_read ?? 0;
  const rowsWritten = meta?.rows_written ?? 0;
  const ms = meta?.duration ?? 0;
  stats.queries++;
  stats.rowsRead += rowsRead;
  stats.rowsWritten += rowsWritten;
  stats.durationMs += ms;
  // Хамгийн хүнд N-ийг барина (жижиг тул энгийн insertion).
  const sample: D1QuerySample = {
    sql: sql.replace(/\s+/g, ' ').trim().slice(0, SQL_SNIPPET),
    rowsRead,
    rowsWritten,
    rows,
    ms,
  };
  const h = stats.heaviest;
  if (h.length < SAMPLE_KEEP || rowsRead > (h[h.length - 1]?.rowsRead ?? 0)) {
    h.push(sample);
    h.sort((a, b) => b.rowsRead - a.rowsRead);
    if (h.length > SAMPLE_KEEP) h.length = SAMPLE_KEEP;
  }
}

type InnerMap = WeakMap<D1PreparedStatement, { stmt: D1PreparedStatement; sql: string }>;

function wrapStatement(
  stmt: D1PreparedStatement,
  sql: string,
  stats: D1Stats,
  inner: InnerMap,
): D1PreparedStatement {
  const wrapped: D1PreparedStatement = {
    bind(...values: unknown[]) {
      return wrapStatement(stmt.bind(...values), sql, stats, inner);
    },
    async first<T = unknown>(colName?: string): Promise<T | null> {
      const res = await stmt.all<Record<string, unknown>>();
      record(stats, sql, res.meta as Meta, res.results.length);
      const row = res.results[0];
      if (row === undefined) return null;
      if (colName === undefined) return row as unknown as T;
      return (row[colName] ?? null) as T | null;
    },
    async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const res = await stmt.run<T>();
      record(stats, sql, res.meta as Meta, res.results?.length ?? 0);
      return res;
    },
    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const res = await stmt.all<T>();
      record(stats, sql, res.meta as Meta, res.results.length);
      return res;
    },
    async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
      // `raw()` нь meta буцаадаггүй — тоолуурыг л нэмнэ (уншсан мөр мэдэгдэхгүй).
      const rows = await (options === undefined
        ? stmt.raw<T>()
        : stmt.raw<T>(options as { columnNames: true }));
      record(stats, sql, undefined, rows.length);
      return rows as T[];
    },
  } as D1PreparedStatement;
  // `batch()` нь wrapper-уудыг авдаг тул жинхэнэ statement руу буцаах толь.
  inner.set(wrapped, { stmt, sql });
  return wrapped;
}

/**
 * `db`-г телеметртэй хувилбараар орлуулна.  Буцаасан объект бүр ӨӨРИЙН
 * `D1Stats`-тай — хүсэлт тус бүрд нэг удаа дуудна, ХЭЗЭЭ Ч хуваалцахгүй
 * (`env` нь isolate-д нэг тул `env.DB`-г шууд солих нь зэрэгцээ хүсэлтийн
 * тоог холино).
 */
export function instrumentD1(db: D1Database, stats: D1Stats = newD1Stats()): D1Database {
  const inner: InnerMap = new WeakMap();

  const instrumented: D1Database = {
    prepare: (sql: string) => wrapStatement(db.prepare(sql), sql, stats, inner),
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const reals = statements.map((s) => inner.get(s)?.stmt ?? s);
      const results = await db.batch<T>(reals);
      results.forEach((res, i) => {
        const sql = inner.get(statements[i] as D1PreparedStatement)?.sql ?? '<batch>';
        record(stats, sql, res.meta as Meta, res.results?.length ?? 0);
      });
      return results;
    },
    async exec(query: string): Promise<D1ExecResult> {
      const res = await db.exec(query);
      record(stats, query, { duration: res.duration }, res.count);
      return res;
    },
    dump: () => db.dump(),
    withSession: (constraintOrBookmark?: D1SessionConstraint | D1SessionBookmark) =>
      constraintOrBookmark === undefined ? db.withSession() : db.withSession(constraintOrBookmark),
  } as D1Database;

  registry.set(instrumented, stats);
  return instrumented;
}

/** `Server-Timing` толгойн `d1` хэсэг. */
export function d1ServerTiming(stats: D1Stats): string {
  return `d1;dur=${stats.durationMs.toFixed(1)};desc="q=${stats.queries} r=${stats.rowsRead} w=${stats.rowsWritten}"`;
}

export function overThreshold(stats: D1Stats): boolean {
  return (
    stats.rowsRead >= LOG_THRESHOLDS.rowsRead ||
    stats.rowsWritten >= LOG_THRESHOLDS.rowsWritten ||
    stats.queries >= LOG_THRESHOLDS.queries
  );
}

/** Нэг мөр лог — `[d1] GET /api/x 200 q=12 r=3410 w=0 ms=41 | top: ...`. */
export function formatD1Log(label: string, stats: D1Stats): string {
  const top = stats.heaviest
    .map((h) => `${h.rowsRead}r/${h.rows}rows ${h.ms.toFixed(1)}ms «${h.sql}»`)
    .join(' ‖ ');
  return `[d1] ${label} q=${stats.queries} r=${stats.rowsRead} w=${stats.rowsWritten} ms=${stats.durationMs.toFixed(1)}${top ? ` | top: ${top}` : ''}`;
}

/**
 * Cron/фон ажлын хэмжилт: `env.DB`-г түр орлуулж, ажил дуусмагц нэг мөр логдоно
 * (босго давсан үед, эсвэл verbose).  Ажлын алдааг ЗАЛГИХГҮЙ — дамжуулна.
 */
export async function withD1Telemetry<E extends { DB: D1Database; D1_TELEMETRY_VERBOSE?: string }, T>(
  label: string,
  env: E,
  run: (scoped: E) => Promise<T>,
): Promise<T> {
  const stats = newD1Stats();
  const scoped = { ...env, DB: instrumentD1(env.DB, stats) } as E;
  try {
    return await run(scoped);
  } finally {
    if (env.D1_TELEMETRY_VERBOSE === '1' || overThreshold(stats)) {
      console.log(formatD1Log(label, stats));
    }
  }
}
