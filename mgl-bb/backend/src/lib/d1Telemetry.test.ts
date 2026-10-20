/**
 * `lib/d1Telemetry.ts` — D1 мөрийн тоолуурын тест, хуурамч D1-ээр.
 * Хүсэлт бүрийн `rows_read`/`rows_written` нь `meta`-аас ЗӨВ нэгтгэгдэж,
 * `first()` семантик хэвээр, `batch()` нь wrapper statement-үүдийг задалж
 * жинхэнэ D1 руу дамжуулж буйг барина.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  instrumentD1,
  newD1Stats,
  d1StatsOf,
  overThreshold,
  formatD1Log,
  d1ServerTiming,
  withD1Telemetry,
} from './d1Telemetry.ts';

type Row = Record<string, unknown>;

/** Хуурамч D1: SQL → мөрүүд + meta.  `raw`/`dump`/`withSession` хэрэггүй. */
function fakeD1(table: Record<string, { rows: Row[]; rows_read: number; rows_written?: number }>) {
  const calls: string[] = [];
  const stmt = (sql: string, binds: unknown[] = []): D1PreparedStatement => {
    const entry = table[sql] ?? { rows: [], rows_read: 0 };
    const result = () => ({
      results: entry.rows,
      success: true as const,
      meta: {
        rows_read: entry.rows_read,
        rows_written: entry.rows_written ?? 0,
        duration: 1.5,
        changes: 0,
        last_row_id: 0,
        changed_db: false,
        size_after: 0,
      },
    });
    const s = {
      __sql: sql,
      __binds: binds,
      bind: (...v: unknown[]) => stmt(sql, v),
      first: async (col?: string) => {
        calls.push('first:' + sql);
        const r = entry.rows[0];
        if (!r) return null;
        return col === undefined ? r : (r[col] ?? null);
      },
      run: async () => {
        calls.push('run:' + sql);
        return result();
      },
      all: async () => {
        calls.push('all:' + sql);
        return result();
      },
      raw: async () => entry.rows.map((r) => Object.values(r)),
    };
    return s as unknown as D1PreparedStatement;
  };
  const db = {
    prepare: (sql: string) => stmt(sql),
    batch: async (stmts: D1PreparedStatement[]) => {
      calls.push('batch:' + stmts.map((s) => (s as unknown as { __sql: string }).__sql).join('|'));
      return stmts.map((s) => {
        const sql = (s as unknown as { __sql: string }).__sql;
        const entry = table[sql] ?? { rows: [], rows_read: 0 };
        return {
          results: entry.rows,
          success: true,
          meta: { rows_read: entry.rows_read, rows_written: entry.rows_written ?? 0, duration: 0.5 },
        };
      });
    },
    exec: async () => ({ count: 1, duration: 0 }),
    dump: async () => new ArrayBuffer(0),
    withSession: () => db,
  };
  return { db: db as unknown as D1Database, calls };
}

test('all/first/run нэгтгэгдэж, first нь мөр/багана семантикаа хадгална', async () => {
  const { db, calls } = fakeD1({
    'SELECT a': { rows: [{ a: 1 }, { a: 2 }], rows_read: 500 },
    'SELECT b': { rows: [{ b: 'x' }], rows_read: 7 },
    'UPDATE t': { rows: [], rows_read: 3, rows_written: 2 },
    'SELECT none': { rows: [], rows_read: 0 },
  });
  const stats = newD1Stats();
  const idb = instrumentD1(db, stats);

  const all = await idb.prepare('SELECT a').all();
  assert.equal(all.results.length, 2);
  assert.equal(await idb.prepare('SELECT b').first('b'), 'x');
  assert.deepEqual(await idb.prepare('SELECT b').first(), { b: 'x' });
  assert.equal(await idb.prepare('SELECT none').first(), null);
  await idb.prepare('UPDATE t').bind(1).run();

  assert.equal(stats.queries, 5);
  assert.equal(stats.rowsRead, 500 + 7 + 7 + 0 + 3);
  assert.equal(stats.rowsWritten, 2);
  assert.equal(stats.heaviest[0]?.sql, 'SELECT a');
  assert.equal(stats.heaviest[0]?.rowsRead, 500);
  // `first()` нь `all()`-аар явдаг — жинхэнэ D1 ч бүтэн үр дүнг татдаг.
  assert.ok(calls.every((c) => !c.startsWith('first:')));
  assert.equal(d1StatsOf(idb), stats);
  assert.equal(d1StatsOf(db), undefined);
});

test('batch нь wrapper-уудыг жинхэнэ statement болгож дамжуулна', async () => {
  const { db, calls } = fakeD1({
    'INSERT x': { rows: [], rows_read: 0, rows_written: 1 },
    'INSERT y': { rows: [], rows_read: 0, rows_written: 1 },
  });
  const stats = newD1Stats();
  const idb = instrumentD1(db, stats);
  const res = await idb.batch([idb.prepare('INSERT x').bind(1), idb.prepare('INSERT y')]);
  assert.equal(res.length, 2);
  assert.equal(stats.queries, 2);
  assert.equal(stats.rowsWritten, 2);
  assert.ok(calls.some((c) => c === 'batch:INSERT x|INSERT y'));
});

test('босго ба лог/Server-Timing формат', () => {
  const s = newD1Stats();
  assert.equal(overThreshold(s), false);
  s.rowsRead = 2_000;
  assert.equal(overThreshold(s), true);
  s.queries = 3;
  s.durationMs = 12.34;
  s.heaviest.push({ sql: 'SELECT big', rowsRead: 1999, rowsWritten: 0, rows: 1, ms: 9 });
  assert.equal(d1ServerTiming(s), 'd1;dur=12.3;desc="q=3 r=2000 w=0"');
  const line = formatD1Log('GET /x 200', s);
  assert.ok(line.startsWith('[d1] GET /x 200 q=3 r=2000 w=0 ms=12.3'));
  assert.ok(line.includes('1999r/1rows'));
});

test('withD1Telemetry нь ажлын алдааг дамжуулж, scoped env-д тусдаа DB өгнө', async () => {
  const { db } = fakeD1({ 'SELECT z': { rows: [{ z: 1 }], rows_read: 10 } });
  const env = { DB: db };
  const out = await withD1Telemetry('cron:test', env, async (scoped) => {
    assert.notEqual(scoped.DB, db);
    await scoped.DB.prepare('SELECT z').all();
    return 'done';
  });
  assert.equal(out, 'done');
  await assert.rejects(
    withD1Telemetry('cron:boom', env, async () => {
      throw new Error('boom');
    }),
    /boom/,
  );
});
