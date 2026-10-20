/**
 * БАГЦ КУРАЦИЙН ТЕСТ — `lib/assistantBulkReview.ts` (ЦЭВЭР хэсэг) +
 * `POST /api/revit/assistant/bulk-review` (МАРШРУТЫН утас).
 *
 * Run with:  node --test src/lib/assistantBulkReview.test.ts
 *
 * ⚠️ ХОЁР ХЭСЭГТЭЙ, ЯАГААД гэвэл энэ гарцын алдаанууд ХОЁР ӨӨР газар
 *    амьдарна:
 *      · ШИЙДВЭР (аль мөр яагаад шийдэгдэх/шийдэгдэхгүй) — цэвэр функц.
 *      · УТАС (эрхийн хаалга, хязгаар, тэмдэглэлийн шаардлага, statement-ийн
 *        ДАРААЛАЛ, `meta.changes`-ийн зааг) — зөвхөн роут дээр.
 *    `complianceGates.test.ts`-ийн ЯГ ИЖИЛ хэв маягаар Hono дэд аппыг
 *    ХУУРАМЧ D1-тэй ажиллуулна.
 *
 * ⚠️ Энэ файлын ХУУРАМЧ D1 нь `complianceGates.test.ts`-ийнхаас НЭГ зүйлээр
 *    ЯЛГААТАЙ: тэр нь SQL-ийг ОГТ гүйцэтгэхгүй, БЭЛЭН мөр буцаадаг.  Энд
 *    `UPDATE`-үүд нь санах ойн мөрүүдийг БОДИТООР өөрчилнө — эс бөгөөс
 *    БИЧИЛТИЙН ДАРААХ БАТАЛГААНЫ УНШИЛТ (энэ гарцын гол механизм) тестэд
 *    ОГТ хэмжигдэхгүй байх байв.
 *
 * ⚠️ `registerHooks` — `src/lib` ба `src/routes` нь өргөтгөлгүй харьцангуй
 *    импорт хэрэглэдэг тул `node --test` дор шууд `import` УНАНА (tsc ногоон
 *    хэвээр).  `complianceGates.test.ts`-ийн ЯГ ИЖИЛ хэв маяг.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Hono } from 'hono';

import {
  BULK_IDS_PER_STATEMENT,
  BULK_OUTCOMES,
  BULK_OUTCOME_STATUS,
  BULK_REVIEW_CAP,
  BULK_TARGET_STATUS,
  blockRejectedExamples,
  chunkIds,
  eligibleIds,
  exampleKey,
  isBulkAction,
  parseBulkIds,
  planBulkReview,
  settleBulkReview,
  summarizeBulkResults,
  toWireResults,
  type BulkLogRow,
  type BulkPlanItem,
  type BulkResult,
  type BulkVerifyRow,
} from './assistantBulkReview.ts';
import { ASSISTANT_EXAMPLE_BINDS } from './assistantExampleInsert.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const revitRoutes = (await import('../routes/revit.ts')).default;

/** `routes/revit.ts`-ийн `ASSISTANT_INTENTS`-ийн ТЕСТИЙН хос. */
const INTENTS = new Set([
  'submit_progress',
  'list_sheets',
  'isolate_sheet',
  'reset_view',
  'whats_changed',
  'set_baseline',
  'progress_status',
  'help',
  'unknown',
]);
const isIntent = (v: unknown): boolean => typeof v === 'string' && INTENTS.has(v);

function log(over: Partial<BulkLogRow> & { id: number }): BulkLogRow {
  return {
    text: 'хуудсуудыг харуул',
    predicted: 'list_sheets',
    corrected: null,
    review_status: null,
    team_code: null,
    ...over,
  };
}

function rowMap(rows: readonly BulkLogRow[]): Map<number, BulkLogRow> {
  return new Map(rows.map((r) => [r.id, r]));
}

/* ================================================================== */
/*  1. ID-НЫ ЦЭВЭРЛЭГЭЭ                                                */
/* ================================================================== */

test('parseBulkIds — массив биш бол notArray', () => {
  const p = parseBulkIds('7');
  assert.equal(p.notArray, true);
  assert.deepEqual(p.ids, []);
});

test('parseBulkIds — `posId`-ийн дүрэм: null/true/мөр/0/сөрөг/бутархай нь ХОГ', () => {
  const p = parseBulkIds([1, null, true, '2', 0, -3, 1.5, 4]);
  assert.deepEqual(p.ids, [1, 4]);
  assert.equal(p.invalid, 6);
  assert.equal(p.duplicates, 0);
});

test('parseBulkIds — ДАВХАРДЛЫГ хаяж, тоолно (мөр тус бүрийн тайлан ЗӨРӨХГҮЙ)', () => {
  const p = parseBulkIds([7, 7, 8, 7]);
  assert.deepEqual(p.ids, [7, 8]);
  assert.equal(p.duplicates, 2);
});

test('parseBulkIds — ЧИМЭЭГҮЙ ТАСЛАХГҮЙ: хязгаараас олон ч БҮГДИЙГ буцаана', () => {
  const many = Array.from({ length: BULK_REVIEW_CAP + 25 }, (_, i) => i + 1);
  assert.equal(parseBulkIds(many).ids.length, BULK_REVIEW_CAP + 25);
});

test('isBulkAction', () => {
  assert.equal(isBulkAction('promote'), true);
  assert.equal(isBulkAction('reject'), true);
  assert.equal(isBulkAction('approve'), false);
  assert.equal(isBulkAction(null), false);
});

/* ================================================================== */
/*  2. ТӨЛӨВЛӨГӨӨ                                                      */
/* ================================================================== */

test('planBulkReview — олдоогүй мөр нь not_found', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [9],
    rows: rowMap([]),
    isIntent,
  });
  assert.equal(items[0]?.blocked, 'not_found');
});

test('planBulkReview — аль хэдийн шийдэгдсэн мөрийг ДАРЖ БИЧИХГҮЙ', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1, 2],
    rows: rowMap([
      log({ id: 1, review_status: 'rejected' }),
      log({ id: 2, review_status: 'promoted' }),
    ]),
    isIntent,
  });
  assert.equal(items[0]?.blocked, 'already_reviewed');
  assert.equal(items[0]?.reviewStatus, 'rejected');
  assert.equal(items[1]?.blocked, 'already_reviewed');
  assert.deepEqual(eligibleIds(items), []);
});

test('planBulkReview — шошгогүй мөр (predicted ба corrected хоёулаа NULL) → no_intent', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1],
    rows: rowMap([log({ id: 1, predicted: null, corrected: null })]),
    isIntent,
  });
  assert.equal(items[0]?.blocked, 'no_intent');
});

test('planBulkReview — танихгүй шошго → bad_intent (no_intent-ээс ТУСДАА)', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1],
    rows: rowMap([log({ id: 1, predicted: 'delete_everything' })]),
    isIntent,
  });
  assert.equal(items[0]?.blocked, 'bad_intent');
});

test('planBulkReview — хоосон бичвэр → no_intent (жишээ гаргах материал дутуу)', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1],
    rows: rowMap([log({ id: 1, text: '   ' })]),
    isIntent,
  });
  assert.equal(items[0]?.blocked, 'no_intent');
});

test('planBulkReview — ХҮНИЙ ЗАСВАР машины таамгаас ДЭЭГҮҮР', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1],
    rows: rowMap([
      log({ id: 1, predicted: 'list_sheets', corrected: 'reset_view' }),
    ]),
    isIntent,
  });
  assert.equal(items[0]?.blocked, null);
  assert.equal(items[0]?.promote?.intent, 'reset_view');
  assert.equal(items[0]?.promote?.curationAction, 'corrected');
  // ⚠️ `predicted` нь `deriveSourceType`-д ХЭВЭЭР дамжина — «машин юу
  //    таасан бэ» гэдэг нь таксономийн оролт.
  assert.equal(items[0]?.promote?.predicted, 'list_sheets');
});

test('planBulkReview — засваргүй бол curationAction нь approved', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1],
    rows: rowMap([log({ id: 1 })]),
    isIntent,
  });
  assert.equal(items[0]?.promote?.curationAction, 'approved');
});

test('planBulkReview — баг нь ГАРАЛ ҮҮСЛИЙН бүртгэлээс, хянагчаас БИШ', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1, 2],
    rows: rowMap([log({ id: 1, team_code: 'IZ' }), log({ id: 2, team_code: null })]),
    isIntent,
  });
  assert.equal(items[0]?.promote?.teamCode, 'IZ');
  assert.equal(items[1]?.promote?.teamCode, null);
});

test('planBulkReview — reject нь шошго ШААРДАХГҮЙ (татгалзал нь бие даасан шийдвэр)', () => {
  const items = planBulkReview({
    action: 'reject',
    ids: [1],
    rows: rowMap([log({ id: 1, predicted: null, corrected: null, text: '' })]),
    isIntent,
  });
  assert.equal(items[0]?.blocked, null);
  assert.equal(items[0]?.promote, null);
});

test('planBulkReview — эрэмбэ нь ИЛГЭЭСЭН дарааллаараа хадгалагдана', () => {
  const items = planBulkReview({
    action: 'reject',
    ids: [5, 3, 9],
    rows: rowMap([log({ id: 3 }), log({ id: 5 }), log({ id: 9 })]),
    isIntent,
  });
  assert.deepEqual(items.map((i) => i.id), [5, 3, 9]);
});

/* ================================================================== */
/*  3. ТАТГАЛЗСАН ЖИШЭЭНИЙ ХААЛТ                                       */
/* ================================================================== */

test('blockRejectedExamples — ЯГ ТЭР (text, intent, team) гурвал нь хаагдана', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1],
    rows: rowMap([log({ id: 1, text: 'хуудас харуул', predicted: 'list_sheets' })]),
    isIntent,
  });
  const keys = new Set([exampleKey('хуудас харуул', 'list_sheets', null)]);
  const out = blockRejectedExamples(items, keys);
  assert.equal(out[0]?.blocked, 'example_rejected');
  assert.equal(out[0]?.promote, null);
});

test('blockRejectedExamples — ӨӨР багийн татгалзал нь энэ мөрийг хаахгүй', () => {
  const items = planBulkReview({
    action: 'promote',
    ids: [1],
    rows: rowMap([
      log({ id: 1, text: 'хуудас харуул', predicted: 'list_sheets', team_code: 'BA' }),
    ]),
    isIntent,
  });
  const keys = new Set([exampleKey('хуудас харуул', 'list_sheets', 'IZ')]);
  assert.equal(blockRejectedExamples(items, keys)[0]?.blocked, null);
});

test('blockRejectedExamples — хоосон олонлог нь юуг ч ӨӨРЧЛӨХГҮЙ', () => {
  const items: BulkPlanItem[] = [
    { id: 1, blocked: null, reviewStatus: null, promote: null },
  ];
  assert.deepEqual(blockRejectedExamples(items, new Set()), items);
});

test('exampleKey — талбарын ЗААГ бүдгэрэхгүй', () => {
  // «баг» талбар руу гулссан утга нь ӨӨР түлхүүр өгөх ЁСТОЙ.
  assert.notEqual(
    exampleKey('a', 'list_sheets', 'BA'),
    exampleKey('a', 'list_sheets', null),
  );
  assert.notEqual(exampleKey('a', 'b', null), exampleKey('ab', '', null));
});

/* ================================================================== */
/*  4. ТУНАДАС                                                         */
/* ================================================================== */

const PLAN_OK: BulkPlanItem[] = [
  { id: 1, blocked: null, reviewStatus: null, promote: null },
];

function verifyMap(rows: readonly BulkVerifyRow[]): Map<number, BulkVerifyRow> {
  return new Map(rows.map((r) => [r.id, r]));
}

test('settleBulkReview — БИД шийдсэн бол applied', () => {
  const out = settleBulkReview({
    action: 'promote',
    items: PLAN_OK,
    verified: verifyMap([{ id: 1, review_status: 'promoted', reviewed_by: 7 }]),
    reviewerId: 7,
  });
  assert.equal(out[0]?.outcome, 'applied');
});

test('settleBulkReview — ХАМТ АЖИЛЛАГЧ түрүүлсэн бол raced (БОДИТ төлөвтэйгээ)', () => {
  const out = settleBulkReview({
    action: 'promote',
    items: PLAN_OK,
    verified: verifyMap([{ id: 1, review_status: 'rejected', reviewed_by: 9 }]),
    reviewerId: 7,
  });
  assert.equal(out[0]?.outcome, 'raced');
  assert.equal(out[0]?.review_status, 'rejected');
});

test('settleBulkReview — ИЖИЛ төлөв ч ӨӨР хянагч бол raced', () => {
  const out = settleBulkReview({
    action: 'reject',
    items: PLAN_OK,
    verified: verifyMap([{ id: 1, review_status: 'rejected', reviewed_by: 9 }]),
    reviewerId: 7,
  });
  assert.equal(out[0]?.outcome, 'raced');
});

test('settleBulkReview — бичилтийн дараа ч NULL бол failed (ЧИМЭЭГҮЙ АМЖИЛТ БИШ)', () => {
  const out = settleBulkReview({
    action: 'promote',
    items: PLAN_OK,
    verified: verifyMap([{ id: 1, review_status: null, reviewed_by: null }]),
    reviewerId: 7,
  });
  assert.equal(out[0]?.outcome, 'failed');
});

test('settleBulkReview — баталгааны мөр огт олдохгүй бол ч failed', () => {
  const out = settleBulkReview({
    action: 'promote',
    items: PLAN_OK,
    verified: verifyMap([]),
    reviewerId: 7,
  });
  assert.equal(out[0]?.outcome, 'failed');
});

test('settleBulkReview — хаагдсан мөр нь шалтгаанаа ХЭВЭЭР авч явна', () => {
  const out = settleBulkReview({
    action: 'promote',
    items: [
      { id: 1, blocked: 'already_reviewed', reviewStatus: 'promoted', promote: null },
      { id: 2, blocked: 'not_found', reviewStatus: null, promote: null },
    ],
    verified: verifyMap([]),
    reviewerId: 7,
  });
  assert.equal(out[0]?.outcome, 'already_reviewed');
  assert.equal(out[0]?.review_status, 'promoted');
  assert.equal(out[1]?.outcome, 'not_found');
  assert.equal(out[1]?.review_status, undefined);
});

test('summarizeBulkResults — БҮХ түлхүүр байна (0 ч гэсэн)', () => {
  const counts = summarizeBulkResults([{ id: 1, outcome: 'applied' }]);
  for (const o of BULK_OUTCOMES) assert.equal(typeof counts[o], 'number');
  assert.equal(counts.applied, 1);
  assert.equal(counts.raced, 0);
});

/* ================================================================== */
/*  5. УТСАН ДЭЭРХ ХЭЛБЭР (frontend-ийн ХОС)                           */
/* ================================================================== */

test('BULK_OUTCOME_STATUS — үр дүн БҮРД бүдүүн төлөв байна', () => {
  for (const o of BULK_OUTCOMES) {
    assert.ok(['ok', 'skipped', 'failed'].includes(BULK_OUTCOME_STATUS[o]), o);
  }
  // ⚠️ ЗӨВХӨН `applied` нь амжилт.  Өөр аль нэг нь `ok` болвол ахлагч
  //    хийгдээгүй ажлыг НОГООН харна.
  const ok = BULK_OUTCOMES.filter((o) => BULK_OUTCOME_STATUS[o] === 'ok');
  assert.deepEqual(ok, ['applied']);
});

test('toWireResults — `status` БА `outcome` ХОЁУЛАА явна', () => {
  const results: BulkResult[] = [
    { id: 1, outcome: 'applied' },
    { id: 2, outcome: 'already_reviewed', review_status: 'promoted' },
    { id: 3, outcome: 'not_found' },
  ];
  const wire = toWireResults(results);
  assert.deepEqual(wire[0], { id: 1, status: 'ok', outcome: 'applied', reason: null });
  assert.equal(wire[1]?.status, 'skipped');
  assert.equal(wire[1]?.reason, 'already_reviewed');
  assert.equal(wire[1]?.review_status, 'promoted');
  assert.equal(wire[2]?.status, 'failed');
});

test('BULK_TARGET_STATUS — үйлдэл бүр зорилтот төлөвтэй', () => {
  assert.equal(BULK_TARGET_STATUS.promote, 'promoted');
  assert.equal(BULK_TARGET_STATUS.reject, 'rejected');
});

/* ================================================================== */
/*  6. D1-ИЙН BIND АРИФМЕТИК                                           */
/* ================================================================== */

test('BULK_IDS_PER_STATEMENT — хамгийн МУУ тохиолдол (2 тогтмол bind) ≤ 100', () => {
  // reject-ийн UPDATE: reviewed_by + note + N id.
  assert.ok(2 + BULK_IDS_PER_STATEMENT <= 100, `${2 + BULK_IDS_PER_STATEMENT}`);
});

test('BULK_REVIEW_CAP нь `/assistant/pending`-ийн хамгийн их хуудастай таарна', () => {
  assert.equal(BULK_REVIEW_CAP, 200);
});

test('chunkIds — хуваалт нь БҮХ элементийг, ДАРААЛЛААР нь хадгална', () => {
  const xs = [1, 2, 3, 4, 5];
  assert.deepEqual(chunkIds(xs, 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkIds([], 3), []);
  assert.deepEqual(chunkIds(xs, 90).flat(), xs);
});

/* ================================================================== */
/*  7. ХУУРАМЧ D1 + МАРШРУТ                                            */
/* ================================================================== */

interface FakeLog {
  id: number;
  text: string;
  predicted: string | null;
  corrected: string | null;
  review_status: string | null;
  reviewed_by: number | null;
  team_code: string | null;
}

interface FakeExample {
  text: string;
  intent: string;
  team_code: string | null;
  review_state: string;
}

interface Stmt {
  sql: string;
  binds: unknown[];
}

/**
 * ХУУРАМЧ D1.  `SELECT`-үүдийг ТАНИЖ, `UPDATE`-үүдийг санах ойд БОДИТООР
 * гүйцэтгэнэ (`AND review_status IS NULL`-ийг ЧАНД дагана) — эс бөгөөс
 * баталгааны уншилтын логик тестэд хэмжигдэхгүй.
 */
function fakeDb(state: { logs: FakeLog[]; examples: FakeExample[] }) {
  const batches: Stmt[][] = [];
  const reads: Stmt[] = [];
  /** Багц бичихээс ЯГ ӨМНӨ дуудагдана — уралдааныг дуурайхад. */
  let beforeBatch: (() => void) | null = null;

  function idsFrom(binds: unknown[], skip: number): number[] {
    return binds.slice(skip).filter((b): b is number => typeof b === 'number');
  }

  function runSelect(sql: string, binds: unknown[]): Record<string, unknown>[] {
    if (sql.includes('FROM assistant_logs') && sql.includes('predicted, corrected')) {
      const ids = new Set(idsFrom(binds, 0));
      return state.logs
        .filter((l) => ids.has(l.id))
        .map((l) => ({
          id: l.id,
          text: l.text,
          predicted: l.predicted,
          corrected: l.corrected,
          review_status: l.review_status,
          team_code: l.team_code,
        }));
    }
    if (sql.includes('FROM assistant_logs') && sql.includes('reviewed_by')) {
      const ids = new Set(idsFrom(binds, 0));
      return state.logs
        .filter((l) => ids.has(l.id))
        .map((l) => ({
          id: l.id,
          review_status: l.review_status,
          reviewed_by: l.reviewed_by,
        }));
    }
    if (sql.includes('FROM assistant_examples')) {
      const texts = new Set(binds.filter((b): b is string => typeof b === 'string'));
      return state.examples
        .filter((e) => e.review_state === 'rejected' && texts.has(e.text))
        .map((e) => ({ text: e.text, intent: e.intent, team_code: e.team_code }));
    }
    return [];
  }

  function runWrite(sql: string, binds: unknown[]): number {
    if (sql.includes('INSERT INTO assistant_examples')) {
      // ⚠️ Мөрийн тоо = bind / мөр тус бүрийн bind.  Тоог ГАРААР бичихгүй —
      //    спецээс гарна (`ASSISTANT_EXAMPLE_BINDS`).
      return Math.floor(binds.length / ASSISTANT_EXAMPLE_BINDS);
    }
    if (sql.includes("review_status = 'promoted'")) {
      const reviewer = binds[0];
      let n = 0;
      for (const id of idsFrom(binds, 1)) {
        const row = state.logs.find((l) => l.id === id);
        if (row && row.review_status === null) {
          row.review_status = 'promoted';
          row.reviewed_by = typeof reviewer === 'number' ? reviewer : null;
          n += 1;
        }
      }
      return n;
    }
    if (sql.includes("review_status = 'rejected'")) {
      // ⚠️ `rejectLogStatements`: bind нь (reviewed_by, note, …id).
      const reviewer = binds[0];
      let n = 0;
      for (const id of idsFrom(binds, 2)) {
        const row = state.logs.find((l) => l.id === id);
        if (row && row.review_status === null) {
          row.review_status = 'rejected';
          row.reviewed_by = typeof reviewer === 'number' ? reviewer : null;
          n += 1;
        }
      }
      return n;
    }
    return 0;
  }

  const db = {
    prepare(sql: string) {
      const stmt = {
        sql,
        binds: [] as unknown[],
        bind(...b: unknown[]) {
          stmt.binds = b;
          return stmt;
        },
        async all() {
          reads.push({ sql, binds: stmt.binds });
          return { results: runSelect(sql, stmt.binds), success: true, meta: {} };
        },
        async first() {
          reads.push({ sql, binds: stmt.binds });
          return runSelect(sql, stmt.binds)[0] ?? null;
        },
        async run() {
          return { success: true, meta: { changes: runWrite(sql, stmt.binds) } };
        },
      };
      return stmt;
    },
    async batch(stmts: Stmt[]) {
      if (beforeBatch) beforeBatch();
      batches.push(stmts.map((s) => ({ sql: s.sql, binds: s.binds })));
      return stmts.map((s) => ({
        results: [],
        success: true,
        meta: { changes: runWrite(s.sql, s.binds) },
      }));
    },
  };

  return {
    db,
    batches,
    reads,
    setBeforeBatch(fn: () => void) {
      beforeBatch = fn;
    },
  };
}

interface Viewer {
  sub: number;
  role: string;
}

const SENIOR: Viewer = { sub: 7, role: 'senior' };
const ADMIN: Viewer = { sub: 2, role: 'admin' };
const ENGINEER: Viewer = { sub: 11, role: 'engineer' };

async function bulk(
  viewer: Viewer,
  payload: unknown,
  state: { logs: FakeLog[]; examples: FakeExample[] },
) {
  const fake = fakeDb(state);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const app = new Hono<any>();
  app.use('*', async (c, next) => {
    c.set('user', viewer);
    await next();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.route('/', revitRoutes as any);
  const res = await app.request(
    '/assistant/bulk-review',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    { DB: fake.db } as never,
  );
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { __raw: text };
  }
  return { status: res.status, body, fake };
}

function fakeLog(over: Partial<FakeLog> & { id: number }): FakeLog {
  return {
    text: `мөр ${over.id}`,
    predicted: 'list_sheets',
    corrected: null,
    review_status: null,
    reviewed_by: null,
    team_code: null,
    ...over,
  };
}

function results(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(body.results)
    ? (body.results as Array<Record<string, unknown>>)
    : [];
}

/* --- 7a. ХААЛГА ба ХЯЗГААР --------------------------------------- */

test('роут — engineer нь 403 (ганц мөрийн гарцуудтай ИЖИЛ хаалга)', async () => {
  const { status, fake } = await bulk(
    ENGINEER,
    { action: 'promote', log_ids: [1] },
    { logs: [fakeLog({ id: 1 })], examples: [] },
  );
  assert.equal(status, 403);
  assert.equal(fake.batches.length, 0, 'эрхгүй хүн бичилт ЭХЛҮҮЛЖ БОЛОХГҮЙ');
});

test('роут — танигдахгүй action нь 400, `cap`-ыг ХЭЛНЭ', async () => {
  const { status, body } = await bulk(
    SENIOR,
    { action: 'approve', log_ids: [1] },
    { logs: [], examples: [] },
  );
  assert.equal(status, 400);
  assert.equal(body.cap, BULK_REVIEW_CAP);
});

test('роут — хязгаараас хэтэрвэл 413, ЧИМЭЭГҮЙ ТАСЛАХГҮЙ', async () => {
  const many = Array.from({ length: BULK_REVIEW_CAP + 1 }, (_, i) => i + 1);
  const { status, body, fake } = await bulk(
    SENIOR,
    { action: 'promote', log_ids: many },
    { logs: [], examples: [] },
  );
  assert.equal(status, 413);
  assert.equal(body.cap, BULK_REVIEW_CAP);
  assert.equal(body.requested, BULK_REVIEW_CAP + 1);
  assert.equal(fake.batches.length, 0, 'хэтэрсэн батч ХЭСГЭЭР нь ч бичигдэх ЁСГҮЙ');
});

test('роут — ЯГ хязгаар дээр ажиллана (off-by-one)', async () => {
  const ids = Array.from({ length: BULK_REVIEW_CAP }, (_, i) => i + 1);
  const { status } = await bulk(
    SENIOR,
    { action: 'reject', log_ids: ids, note: 'хог' },
    { logs: ids.map((id) => fakeLog({ id })), examples: [] },
  );
  assert.equal(status, 200);
});

test('роут — хог id-нууд нь 400, тоог ИЛ хэлнэ', async () => {
  const { status, body } = await bulk(
    SENIOR,
    { action: 'promote', log_ids: [null, true, '5'] },
    { logs: [], examples: [] },
  );
  assert.equal(status, 400);
  assert.equal(body.invalid_ids, 3);
});

test('роут — ТАТГАЛЗАЛ нь ТЭМДЭГЛЭЛГҮЙ БОЛОХГҮЙ', async () => {
  const state = { logs: [fakeLog({ id: 1 })], examples: [] };
  const noNote = await bulk(SENIOR, { action: 'reject', log_ids: [1] }, state);
  assert.equal(noNote.status, 400);
  const blank = await bulk(
    SENIOR,
    { action: 'reject', log_ids: [1], note: '   ' },
    state,
  );
  assert.equal(blank.status, 400, 'зөвхөн хоосон зайнаас бүрдсэн тэмдэглэл нь ТЭМДЭГЛЭЛ БИШ');
  assert.equal(state.logs[0]?.review_status, null);
});

test('роут — ДЭВШҮҮЛЭЛТ нь тэмдэглэл ШААРДАХГҮЙ', async () => {
  const state = { logs: [fakeLog({ id: 1 })], examples: [] };
  const { status } = await bulk(SENIOR, { action: 'promote', log_ids: [1] }, state);
  assert.equal(status, 200);
});

/* --- 7b. ДЭВШҮҮЛЭЛТ ----------------------------------------------- */

test('роут — promote: мөр тус бүрийн үр дүн + БОДИТ тоо', async () => {
  const state = {
    logs: [fakeLog({ id: 1 }), fakeLog({ id: 2, corrected: 'reset_view' })],
    examples: [],
  };
  const { status, body } = await bulk(
    ADMIN,
    { action: 'promote', log_ids: [1, 2] },
    state,
  );
  assert.equal(status, 200);
  assert.equal(body.action, 'promote');
  assert.equal(body.cap, BULK_REVIEW_CAP);
  assert.equal(body.requested, 2);
  assert.equal(body.added, 2);
  assert.equal(body.curated, 2);
  assert.equal(body.rejected, 0);
  assert.deepEqual(
    results(body).map((r) => [r.id, r.outcome, r.status]),
    [
      [1, 'applied', 'ok'],
      [2, 'applied', 'ok'],
    ],
  );
  assert.equal(state.logs[0]?.review_status, 'promoted');
  assert.equal(state.logs[0]?.reviewed_by, 2);
});

test('роут — promote: ЖИШЭЭНИЙ INSERT нь бүртгэлийн UPDATE-ЭЭС ӨМНӨ', async () => {
  const state = { logs: [fakeLog({ id: 1 })], examples: [] };
  const { fake } = await bulk(SENIOR, { action: 'promote', log_ids: [1] }, state);
  const batch = fake.batches[0] ?? [];
  assert.ok(batch[0]?.sql.includes('INSERT INTO assistant_examples'));
  assert.ok(batch[1]?.sql.includes("review_status = 'promoted'"));
  // ⚠️ `changed.slice(exStmtCount)`-ийн зааг ЭНЭ дараалалаас хамаарна;
  //    газар соливол `added` ба `curated` СОЛБИЦОНО.
});

test('роут — promote: НЭГ ч statement 100 bind-ыг ДАВААГҮЙ', async () => {
  const ids = Array.from({ length: BULK_REVIEW_CAP }, (_, i) => i + 1);
  const { fake } = await bulk(
    SENIOR,
    { action: 'promote', log_ids: ids },
    { logs: ids.map((id) => fakeLog({ id })), examples: [] },
  );
  for (const s of [...(fake.batches[0] ?? []), ...fake.reads]) {
    assert.ok(s.binds.length <= 100, `${s.binds.length} bind: ${s.sql.slice(0, 60)}`);
  }
});

test('роут — promote: IDEMPOTENT.  Хоёр дахь илгээлт ДАХИН дэвшүүлэхгүй', async () => {
  const state = { logs: [fakeLog({ id: 1 })], examples: [] };
  await bulk(SENIOR, { action: 'promote', log_ids: [1] }, state);
  const second = await bulk(SENIOR, { action: 'promote', log_ids: [1] }, state);
  assert.equal(second.body.added, 0);
  assert.equal(second.body.curated, 0);
  assert.deepEqual(results(second.body).map((r) => r.outcome), ['already_reviewed']);
  assert.equal(results(second.body)[0]?.review_status, 'promoted');
  assert.equal(second.fake.batches.length, 0, 'шийдэгдсэн мөрд бичилт ОГТ явахгүй');
});

test('роут — promote: ӨӨР ХҮНИЙ ТАТГАЛЗЛЫГ ДАРЖ БИЧИХГҮЙ', async () => {
  const state = {
    logs: [fakeLog({ id: 1, review_status: 'rejected', reviewed_by: 9 })],
    examples: [],
  };
  const { body } = await bulk(SENIOR, { action: 'promote', log_ids: [1] }, state);
  assert.equal(results(body)[0]?.outcome, 'already_reviewed');
  assert.equal(state.logs[0]?.review_status, 'rejected');
  assert.equal(state.logs[0]?.reviewed_by, 9);
});

test('роут — promote: ХОЛИМОГ батч дээр шалтгаан бүр ТУСДАА гарна', async () => {
  const state = {
    logs: [
      fakeLog({ id: 1 }),
      fakeLog({ id: 2, predicted: null }),
      fakeLog({ id: 3, predicted: 'delete_everything' }),
      fakeLog({ id: 5, review_status: 'promoted', reviewed_by: 9 }),
    ],
    examples: [],
  };
  const { body } = await bulk(
    SENIOR,
    { action: 'promote', log_ids: [1, 2, 3, 4, 5] },
    state,
  );
  assert.deepEqual(
    results(body).map((r) => [r.id, r.outcome]),
    [
      [1, 'applied'],
      [2, 'no_intent'],
      [3, 'bad_intent'],
      [4, 'not_found'],
      [5, 'already_reviewed'],
    ],
  );
  const counts = body.counts as Record<string, number>;
  assert.equal(counts.applied, 1);
  assert.equal(counts.not_found, 1);
  assert.equal(body.added, 1, 'зөвхөн ХҮЧИНТЭЙ мөр жишээ болно');
});

test('роут — promote: ТАТГАЛЗСАН жишээтэй давхцвал бүртгэлийг ХӨНДӨХГҮЙ', async () => {
  const state = {
    logs: [fakeLog({ id: 1, text: 'хуудас харуул', predicted: 'list_sheets' })],
    examples: [
      {
        text: 'хуудас харуул',
        intent: 'list_sheets',
        team_code: null,
        review_state: 'rejected',
      },
    ],
  };
  const { body, fake } = await bulk(SENIOR, { action: 'promote', log_ids: [1] }, state);
  assert.equal(results(body)[0]?.outcome, 'example_rejected');
  assert.equal(results(body)[0]?.status, 'skipped');
  assert.equal(fake.batches.length, 0);
  // ⚠️ ХАМГИЙН ЧУХАЛ: бүртгэл «promoted» гэж ХУДАЛ тамгалагдаагүй —
  //    жишээ нь үүсэхгүй байхад бүртгэлийг хаах нь ЧИМЭЭГҮЙ АЛДАГДАЛ.
  assert.equal(state.logs[0]?.review_status, null);
});

test('роут — promote: УРАЛДААН нь raced гэж ҮНЭН мэдээлэгдэнэ', async () => {
  const state = { logs: [fakeLog({ id: 1 })], examples: [] };
  const { body } = await (async () => {
    const fake = fakeDb(state);
    // ⚠️ Уншилтын ДАРАА, бичилтийн ӨМНӨ хамт ажиллагч шийдвэрлэв — `bulk()`
    //    туслах нь энэ дэгээг өгөхгүй тул роутыг ЭНД гараар угсарна.
    fake.setBeforeBatch(() => {
      const row = state.logs[0];
      if (row) {
        row.review_status = 'rejected';
        row.reviewed_by = 9;
      }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const app = new Hono<any>();
    app.use('*', async (c, next) => {
      c.set('user', SENIOR);
      await next();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    app.route('/', revitRoutes as any);
    const res = await app.request(
      '/assistant/bulk-review',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'promote', log_ids: [1] }),
      },
      { DB: fake.db } as never,
    );
    return { body: (await res.json()) as Record<string, unknown> };
  })();
  assert.equal(results(body)[0]?.outcome, 'raced');
  assert.equal(results(body)[0]?.review_status, 'rejected');
  assert.equal(body.curated, 0, '`AND review_status IS NULL` ялагдсан ⇒ 0 өөрчлөлт');
  assert.equal(state.logs[0]?.reviewed_by, 9, 'хамт ажиллагчийн шийдвэр ХЭВЭЭР');
});

test('роут — ДАВХАРДСАН id нэг л удаа тайлагдана', async () => {
  const state = { logs: [fakeLog({ id: 1 })], examples: [] };
  const { body } = await bulk(SENIOR, { action: 'promote', log_ids: [1, 1, 1] }, state);
  assert.equal(body.requested, 1);
  assert.equal(body.duplicates_dropped, 2);
  assert.equal(results(body).length, 1);
  assert.equal(body.added, 1);
});

/* --- 7c. ТАТГАЛЗАЛ ------------------------------------------------ */

test('роут — reject: ганц мөрийн ЗАМТАЙ ИЖИЛ SQL, тэмдэглэл бичигдэнэ', async () => {
  const state = { logs: [fakeLog({ id: 1 }), fakeLog({ id: 2 })], examples: [] };
  const { status, body, fake } = await bulk(
    SENIOR,
    { action: 'reject', log_ids: [1, 2], note: 'загварын дуу чимээ' },
    state,
  );
  assert.equal(status, 200);
  assert.equal(body.rejected, 2);
  assert.equal(body.added, 0);
  assert.equal(body.curated, 0);
  const batch = fake.batches[0] ?? [];
  assert.equal(batch.length, 1);
  assert.ok(batch[0]?.sql.includes("review_status = 'rejected'"));
  assert.ok(batch[0]?.sql.includes('AND review_status IS NULL'));
  // bind: reviewed_by, note, …id
  assert.deepEqual(batch[0]?.binds, [7, 'загварын дуу чимээ', 1, 2]);
  assert.equal(state.logs[0]?.review_status, 'rejected');
});

test('роут — reject: шошгогүй мөрийг ч ТАТГАЛЗАЖ ЧАДНА', async () => {
  const state = {
    logs: [fakeLog({ id: 1, predicted: null, corrected: null })],
    examples: [],
  };
  const { body } = await bulk(
    SENIOR,
    { action: 'reject', log_ids: [1], note: 'утгагүй' },
    state,
  );
  assert.equal(results(body)[0]?.outcome, 'applied');
});

test('роут — reject: IDEMPOTENT', async () => {
  const state = { logs: [fakeLog({ id: 1 })], examples: [] };
  await bulk(SENIOR, { action: 'reject', log_ids: [1], note: 'хог' }, state);
  const second = await bulk(
    SENIOR,
    { action: 'reject', log_ids: [1], note: 'хог' },
    state,
  );
  assert.equal(second.body.rejected, 0);
  assert.equal(results(second.body)[0]?.outcome, 'already_reviewed');
});

test('роут — reject: ЖИШЭЭ ОГТ бичигдэхгүй', async () => {
  const state = { logs: [fakeLog({ id: 1 })], examples: [] };
  const { fake } = await bulk(
    SENIOR,
    { action: 'reject', log_ids: [1], note: 'хог' },
    state,
  );
  for (const s of fake.batches.flat()) {
    assert.ok(!s.sql.includes('INSERT INTO assistant_examples'));
  }
});

test('роут — бүх мөр хаагдсан бол БИЧИЛТ ОГТ явахгүй, 200 хэвээр', async () => {
  const { status, body, fake } = await bulk(
    SENIOR,
    { action: 'promote', log_ids: [41, 42] },
    { logs: [], examples: [] },
  );
  assert.equal(status, 200);
  assert.equal(fake.batches.length, 0);
  assert.deepEqual(results(body).map((r) => r.outcome), ['not_found', 'not_found']);
});
