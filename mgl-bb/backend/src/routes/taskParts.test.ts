// Хүнгүй хэсэг (0394, эзэн 2026-10-09) — БОДИТ SQLite + бодит миграц.
// 2026-10-09-ний орой (0395): HTTP замууд (`/allocation/parts`, `/claim-part`) 410 PARTS_RETIRED — ✂ одоо үндсэн таскууд
// болгон хуваана (`taskRootSplit.test.ts`).  Прод дээр аль хэдийн үүссэн хэсгүүд харагдсаар тул доорх тестүүд хэсгийг lib-ээр
// (`applyParts`/`claimPart`) шууд үүсгэж, бусад үйлдэлтэй харилцан ажиллагааг (нөөц, unsplit, аудит) шалгасаар байна.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { actorOf, makeDb, rows, sum, uid, USERS } from '../../test-support/allocHarness.ts';

const taskAllocations = (await import('./taskAllocations.ts')).default;
const tasksRoute = (await import('./tasks.ts')).default;
const taskTimerRoute = (await import('./taskTimer.ts')).default;
const { todayInUB } = await import('../lib/time.ts');
const { auditTaskAllocations } = await import('../lib/taskAllocAudit.ts');
const { readFileSync } = await import('node:fs');

const pt = (p: number) => Math.round(p * 10_000);
const { A, B, C, SENIOR } = USERS;

function appFor(h: ReturnType<typeof makeDb>, role?: Record<number, string>) {
  const env = { DB: h.d1 } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/tasks', taskAllocations as never);
  app.route('/api/tasks', tasksRoute as never);
  app.route('/api/task-timer', taskTimerRoute as never);
  const exec = { waitUntil: () => undefined, passThroughOnException: () => undefined };
  return async (userId: number, method: string, path: string, body?: unknown) => {
    const actor = role?.[userId] ? { sub: userId, role: role[userId] } : actorOf(userId);
    const res = await app.request(
      `http://x${path}`,
      {
        method,
        headers: {
          'x-test-user': JSON.stringify(actor),
          'x-task-alloc-contract': '1',
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      env as never,
      exec as never,
    );
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
}

function clockIn(h: ReturnType<typeof makeDb>, ids: number[]) {
  for (const u of ids) {
    h.sqlite
      .prepare(`INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out) VALUES (?, ?, '08:55', NULL)`)
      .run(u, todayInUB());
  }
}

type Req = ReturnType<typeof appFor>;

const { applyParts, claimPart } = await import('../lib/taskRootOps.ts');

/** Lib-ийн үр дүнг хуучин HTTP хариутай ижил хэлбэрт ({status, json}). */
function asHttp(r: any): { status: number; json: any } {
  return r.ok
    ? { status: 200, json: { ...r.data, replayed: r.replayed === true } }
    : { status: r.status, json: { error: r.code, message: r.message, ...(r.extra ?? {}) } };
}

let partsDb: ReturnType<typeof makeDb> | null = null;
const parts = async (
  _req: Req,
  user: number,
  list: Array<{ part_id?: number; label: string; units: number }>,
  rev: number | null,
  taskId = 501,
  requestId: string = uid('parts'),
) =>
  asHttp(
    await applyParts({ db: partsDb!.d1 }, actorOf(user), {
      taskId,
      requestId,
      expectedRevision: rev,
      parts: list.map((x) => ({ id: x.part_id ?? null, label: x.label, units: x.units })),
    }),
  );

const claim = async (_req: Req, user: number, partId: number, rev: number, taskId = 501) =>
  asHttp(await claimPart({ db: partsDb!.d1 }, actorOf(user), { taskId, requestId: uid('claim'), expectedRevision: rev, partId }));

test('хасагдсан HTTP замууд: /allocation/parts, /claim-part → 410 PARTS_RETIRED, юу ч бичигдэхгүй', async () => {
  const h = makeDb();
  partsDb = h;
  const req = appFor(h);
  const p = await req(A, 'POST', '/api/tasks/501/allocation/parts', { request_id: uid('p'), expected_revision: 0, parts: [{ label: 'а', units: pt(10) }] });
  assert.equal(p.status, 410);
  assert.equal(p.json.error, 'PARTS_RETIRED');
  const k = await req(A, 'POST', '/api/tasks/501/allocation/claim-part', { request_id: uid('k'), expected_revision: 1, part_id: 1 });
  assert.equal(k.status, 410);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 0);
});

test('хуваах: хуваагдаагүй таскийг ажилтан хүнгүй 3 хэсэг болгоно → managed, дугаар 1..3, хувь нэмэрчид хэсгүүд харагдана', async () => {
  const h = makeDb();
  partsDb = h;
  const req = appFor(h);
  const r = await parts(req, C, [
    { label: 'суурь', units: pt(40) },
    { label: 'тоноглол', units: pt(35) },
    { label: 'шугам', units: pt(25) },
  ], 0);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.converted, true);
  assert.equal(r.json.created, 3);
  assert.equal(r.json.root.unallocated_units, pt(100));
  assert.equal(r.json.root.free_units, 0);
  assert.deepEqual(r.json.root.parts.map((p: any) => [p.ordinal, p.label, p.units]), [[1, 'суурь', pt(40)], [2, 'тоноглол', pt(35)], [3, 'шугам', pt(25)]]);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_allocations WHERE task_id = 501'), 0);
  // Хуваалт оноо, явц үүсгэхгүй.
  assert.equal(sum(h.sqlite, "SELECT COUNT(*) AS v FROM user_points WHERE task_id = 501"), 0);
  const contrib = await req(A, 'GET', '/api/tasks/contributors?project_id=10');
  assert.equal(contrib.status, 200);
  assert.deepEqual(contrib.json.managed['501'].parts.map((p: any) => p.label), ['суурь', 'тоноглол', 'шугам']);
  // Тойм: хэсэг засах эрх бүх ажилтанд
  const ov = await req(B, 'GET', '/api/tasks/501/allocation');
  assert.equal(ov.json.allowed.parts, true);
  assert.equal(ov.json.root.parts.length, 3);
});

test('хуваах: буруу оролт 400, чөлөөтөөс их 409 OVER_FREE, хуучирсан revision 409, идемпотент replay', async () => {
  const h = makeDb();
  partsDb = h;
  const req = appFor(h);
  assert.equal((await parts(req, A, [{ label: '  ', units: pt(10) }], 0)).json.error, 'BAD_LABEL');
  assert.equal((await parts(req, A, [{ label: 'а', units: pt(0) }], 0)).json.error, 'BAD_VALUE');
  assert.equal((await parts(req, A, [], 0)).json.error, 'NO_PARTS');
  const over = await parts(req, A, [{ label: 'а', units: pt(101) }], 0);
  assert.equal(over.status, 400); // 100%-аас их = буруу утга
  const ok = await parts(req, A, [{ label: 'а', units: pt(60) }], 0);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.root.free_units, pt(40));
  const stale = await parts(req, A, [{ label: 'б', units: pt(10) }], 0);
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'STALE_REVISION');
  const big = await parts(req, A, [{ part_id: ok.json.root.parts[0].part_id, label: 'а', units: pt(60) }, { label: 'б', units: pt(41) }], 1);
  assert.equal(big.status, 409);
  assert.equal(big.json.error, 'OVER_FREE');
  const rid = uid('same');
  const list = [{ part_id: ok.json.root.parts[0].part_id, label: 'а2', units: pt(50) }];
  const first = await parts(req, A, list, 1, 501, rid);
  assert.equal(first.status, 200);
  const again = await parts(req, A, list, 1, 501, rid);
  assert.equal(again.status, 200);
  assert.equal(again.json.replayed, true);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_parts WHERE task_id = 501'), 1);
});

test('засах: нэр/хувь солих, хуулах (шинэ дугаар), устгах — дугаар дахин ашиглагдахгүй', async () => {
  const h = makeDb();
  partsDb = h;
  const req = appFor(h);
  const r1 = await parts(req, A, [{ label: 'суурь', units: pt(50) }, { label: 'хана', units: pt(50) }], 0);
  const [p1, p2] = r1.json.root.parts;
  // «хана»-г хуулж (хоёр хуваана), «суурь»-ыг устгана
  const r2 = await parts(req, A, [
    { part_id: p2.part_id, label: 'хана — зүүн', units: pt(25) },
    { label: 'хана — баруун', units: pt(25) },
  ], r1.json.root.revision);
  assert.equal(r2.status, 200, JSON.stringify(r2.json));
  assert.equal(r2.json.removed, 1);
  assert.deepEqual(r2.json.root.parts.map((p: any) => [p.ordinal, p.label]), [[2, 'хана — зүүн'], [3, 'хана — баруун']]);
  assert.equal(r2.json.root.free_units, pt(50));
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_parts WHERE id = ?', p1.part_id), 0);
  // PUT part-label: зөвхөн нэр, revision хөдлөхгүй
  const rev = sum(h.sqlite, 'SELECT revision AS v FROM task_roots WHERE task_id = 501');
  const lab = await req(B, 'PUT', '/api/tasks/501/part-label', { part_id: p2.part_id, label: '  хана   зүүн тал ' });
  assert.equal(lab.status, 200, JSON.stringify(lab.json));
  assert.equal(lab.json.label, 'хана зүүн тал');
  assert.equal(sum(h.sqlite, 'SELECT revision AS v FROM task_roots WHERE task_id = 501'), rev);
  assert.equal((await req(B, 'PUT', '/api/tasks/501/part-label', { part_id: p2.part_id, label: ' ' })).status, 400);
  assert.equal((await req(B, 'PUT', '/api/tasks/502/part-label', { part_id: p2.part_id, label: 'x' })).status, 404);
});

test('авах: ▶ хэсэггүй хүнд NOT_ALLOCATED (хэсгүүд чөлөөт биш); хэсгийг авбал түүний хуваарилалт болж цаг эхэлнэ', async () => {
  const h = makeDb();
  partsDb = h;
  clockIn(h, [A, B, C]);
  const req = appFor(h);
  const r1 = await parts(req, SENIOR, [{ label: 'суурь', units: pt(40) }, { label: 'тоноглол', units: pt(60) }], 0);
  const [p1, p2] = r1.json.root.parts;
  const start0 = await req(B, 'POST', '/api/task-timer/start', { task_id: 501 });
  assert.equal(start0.status, 409);
  assert.equal(start0.json.error, 'NOT_ALLOCATED');
  assert.equal(start0.json.allocation.available_units, 0);
  // Чөлөөт ажлаас (retake) хэсгийг булаахгүй
  const retake = await req(B, 'POST', '/api/tasks/501/allocation/retake', { request_id: uid('r'), expected_revision: r1.json.root.revision });
  assert.equal(retake.status, 409);
  assert.equal(retake.json.error, 'NOTHING_FREE');

  const c1 = await claim(req, B, p1.part_id, r1.json.root.revision);
  assert.equal(c1.status, 200, JSON.stringify(c1.json));
  assert.equal(c1.json.ordinal, 1);
  assert.equal(c1.json.merged, false);
  assert.equal(c1.json.root.unallocated_units, pt(60));
  assert.deepEqual(c1.json.root.parts.map((p: any) => p.label), ['тоноглол']);
  const alloc = rows<{ ordinal: number; target_units: number; label: string }>(h.sqlite, 'SELECT ordinal, target_units, label FROM task_allocations WHERE task_id = 501 AND user_id = ?', B);
  assert.deepEqual(alloc.map((a) => ({ ...a })), [{ ordinal: 1, target_units: pt(40), label: 'суурь' }]);
  const start1 = await req(B, 'POST', '/api/task-timer/start', { task_id: 501 });
  assert.equal(start1.status, 200, JSON.stringify(start1.json));

  // Хуучирсан revision → STALE; өөр хүн авсан хэсэг → PART_NOT_FOUND
  assert.equal((await claim(req, C, p2.part_id, r1.json.root.revision)).json.error, 'STALE_REVISION');
  assert.equal((await claim(req, C, p1.part_id, c1.json.root.revision)).json.error, 'PART_NOT_FOUND');

  // Хэсэгтэй үед хүмүүсийн хуваарилалтыг засахад хэсэг хэвээр (U = нөөц)
  const sp = await req(SENIOR, 'POST', '/api/tasks/501/allocation/split', {
    request_id: uid('s'), expected_revision: c1.json.root.revision, mode: 'total', targets: [{ user_id: B, target_units: pt(30) }, { user_id: A, target_units: pt(10) }],
  });
  assert.equal(sp.status, 200, JSON.stringify(sp.json));
  assert.equal(sp.json.root.unallocated_units, pt(60));
  assert.equal(sp.json.root.parts.length, 1);
  // Хэсгийг эзлэхийг оролдвол SUM_MISMATCH
  const steal = await req(SENIOR, 'POST', '/api/tasks/501/allocation/split', {
    request_id: uid('s'), expected_revision: sp.json.root.revision, mode: 'total', targets: [{ user_id: B, target_units: pt(100) }],
  });
  assert.equal(steal.status, 409);
  assert.equal(steal.json.error, 'SUM_MISMATCH');

  // A (аль хэдийн 10% хуваарилалттай) үлдсэн хэсгийг авбал түүн дээр нэмэгдэнэ, нэр холбогдоно
  const c2 = await claim(req, A, p2.part_id, sp.json.root.revision);
  assert.equal(c2.status, 200, JSON.stringify(c2.json));
  assert.equal(c2.json.merged, true);
  assert.equal(c2.json.root.unallocated_units, 0);
  const aRow = rows<{ target_units: number; label: string }>(h.sqlite, 'SELECT target_units, label FROM task_allocations WHERE task_id = 501 AND user_id = ?', A)[0]!;
  assert.equal(aRow.target_units, pt(70));
  assert.equal(aRow.label.endsWith('· тоноглол'), true);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_parts WHERE task_id = 501'), 0);

  const audit = await auditTaskAllocations(h.d1, { taskId: 501 });
  assert.equal(audit.errors, 0, JSON.stringify(audit.findings));
});

test('цуцлах (unsplit): хэсгүүд root-той хамт устна; эрх — worker 403', async () => {
  const h = makeDb();
  partsDb = h;
  for (const f of ['0386_task_retractions.sql', '0387_task_unsplits.sql']) {
    h.sqlite.exec(readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8'));
  }
  const req = appFor(h, { 77: 'worker' });
  await parts(req, A, [{ label: 'а', units: pt(30) }, { label: 'б', units: pt(70) }], 0);
  const un = await req(SENIOR, 'POST', '/api/tasks/501/allocation/unsplit', { request_id: uid('un') });
  assert.equal(un.status, 200, JSON.stringify(un.json));
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots WHERE task_id = 501'), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_parts WHERE task_id = 501'), 0);
});

test('үндсэн таскийн нэр (PUT /:id/name, 2026-10-12): ажилтан солино, жин хөдлөхгүй; хоосон 400, байхгүй 404, worker 403', async () => {
  const h = makeDb();
  const req = appFor(h, { 77: 'worker' });
  const w0 = sum(h.sqlite, 'SELECT weight_percent AS v FROM tasks WHERE id = 501');
  const ok = await req(B, 'PUT', '/api/tasks/501/name', { name: '  3-р давхар   /хана/ ' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.name, '3-р давхар /хана/');
  assert.equal(rows(h.sqlite, 'SELECT name FROM tasks WHERE id = 501')[0]?.name, '3-р давхар /хана/');
  assert.equal(sum(h.sqlite, 'SELECT weight_percent AS v FROM tasks WHERE id = 501'), w0);
  assert.equal((await req(B, 'PUT', '/api/tasks/501/name', { name: '  ' })).status, 400);
  assert.equal((await req(B, 'PUT', '/api/tasks/501/name', { name: 'x'.repeat(201) })).status, 400);
  assert.equal((await req(B, 'PUT', '/api/tasks/999999/name', { name: 'x' })).status, 404);
  assert.equal((await req(77, 'PUT', '/api/tasks/501/name', { name: 'x' })).status, 403);
});
