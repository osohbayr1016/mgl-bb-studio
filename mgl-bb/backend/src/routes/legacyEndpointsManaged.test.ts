// ХУУЧИН бичих замууд managed таск дээр — матриц (2026-10-05).
//
// Хуучин вэб/PWA/Revit клиент managed таск руу ХЭЗЭЭ Ч бичихгүй: хуваарилалт, журнал, оноо, явцын бичлэг, мөр (task_ops)
// нь хуучин замаар нэг ч байтаар өөрчлөгдөхгүй.  Идэвхжүүлэлтийн төлөв enabled, клиентийн гэрээ одоогийнх үед ч (хаалга
// ЦӨМ эрхийг шийддэг; хуучин зам өөрөө хаалттай).  Бодит router + бодит миграц.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, session, uid, USERS } from '../../test-support/allocHarness.ts';
import { makeApp } from '../../test-support/allocApp.ts';

const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B, SENIOR, ADMIN } = USERS;

async function setup() {
  const h = makeDb({ state: 'enabled' });
  const api = await makeApp(h);
  const first = await api.req(A, 'POST', '/api/tasks/501/allocation/split', {
    request_id: uid('split'),
    expected_revision: 0,
    mode: 'total',
    targets: [
      { user_id: A, target_units: pt(40) },
      { user_id: B, target_units: pt(60) },
    ],
  });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  return { h, ...api };
}

/** Managed таскийн БҮХ төлөвийн хуруу — хуучин зам юу ч өөрчлөөгүйг нэг харьцуулалтаар батална. */
function fingerprint(h: ReturnType<typeof makeDb>, taskId: number): string {
  const rows = (sql: string) => h.sqlite.prepare(sql).all(taskId, taskId);
  return JSON.stringify({
    root: rows('SELECT task_id, revision, unattributed_units, unallocated_units FROM task_roots WHERE task_id = ? OR task_id = ?'),
    alloc: rows('SELECT user_id, target_units, done_units, floor_units, released_units, revision FROM task_allocations WHERE task_id = ? OR task_id = ? ORDER BY user_id'),
    contrib: rows('SELECT COUNT(*) AS n FROM task_contributions WHERE task_id = ? OR task_id = ?'),
    points: rows('SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amt FROM user_points WHERE task_id = ? OR task_id = ?'),
    progress: rows('SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = ? OR task_id = ?'),
    ops: rows('SELECT COUNT(*) AS n FROM task_ops WHERE task_id = ? OR task_id = ?'),
    timers: rows('SELECT COUNT(*) AS n FROM task_timer_sessions WHERE task_id = ? OR task_id = ?'),
    task: rows('SELECT weight_percent, due_date, start_date FROM tasks WHERE id = ? OR id = ?'),
  });
}

test('хуучин POST /api/progress managed таскт → 409 MANAGED_ROOT, юу ч өөрчлөгдөхгүй', async () => {
  const { h, req } = await setup();
  const before = fingerprint(h, 501);
  const r = await req(A, 'POST', '/api/progress', { task_id: 501, percentage: 55, date: '2026-10-05' });
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.error, 'MANAGED_ROOT');
  assert.equal(r.json.retryable, false);
  assert.equal(fingerprint(h, 501), before);
});

test('хуучин POST /api/progress/bulk managed таскт → мөр бүр татгалзана, юу ч өөрчлөгдөхгүй', async () => {
  const { h, req } = await setup();
  const before = fingerprint(h, 501);
  const r = await req(A, 'POST', '/api/progress/bulk', { entries: [{ task_id: 501, percentage: 70, date: '2026-10-05' }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const body = r.json as { saved: number; failed: number; results: Array<{ ok: boolean; status: number; body: { error?: string } }> };
  assert.equal(body.saved, 0);
  assert.equal(body.failed, 1);
  assert.equal(body.results[0]!.ok, false);
  assert.equal(body.results[0]!.status, 409);
  assert.equal(body.results[0]!.body.error, 'MANAGED_ROOT');
  assert.equal(fingerprint(h, 501), before);
});

test('хуучин POST /:id/baseline («Анхны явц») managed таскт → татгалзана, түүх хөндөгдөхгүй', async () => {
  const { h, req } = await setup();
  const before = fingerprint(h, 501);
  const r = await req(ADMIN, 'POST', '/api/tasks/501/baseline', { percentage: 30 });
  assert.ok(r.status === 409 || r.status === 423, `status ${r.status} ${JSON.stringify(r.json)}`);
  assert.equal(fingerprint(h, 501), before);
});

test('хуучин POST /:id/split → 410 SPLIT_RETIRED (шинэ таск үүсэхгүй)', async () => {
  const { h, req } = await setup();
  const tasksBefore = (h.sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n;
  const before = fingerprint(h, 501);
  const r = await req(A, 'POST', '/api/tasks/501/split', { weights: [50, 50] });
  assert.equal(r.status, 410);
  assert.equal(r.json.error, 'SPLIT_RETIRED');
  assert.equal((h.sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n, tasksBefore);
  assert.equal(fingerprint(h, 501), before);
});

test('хуучин /:id/share ба /:id/unassign → 410 ASSIGNMENT_REMOVED', async () => {
  const { h, req } = await setup();
  const before = fingerprint(h, 501);
  const share = await req(A, 'POST', '/api/tasks/501/share', { user_ids: [B] });
  const unassign = await req(SENIOR, 'POST', '/api/tasks/501/unassign', { user_id: A });
  assert.equal(share.status, 410);
  assert.equal(unassign.status, 410);
  assert.equal(share.json.error, 'ASSIGNMENT_REMOVED');
  assert.equal(fingerprint(h, 501), before);
});

test('DELETE /api/tasks/:id хийсэн ажилтай managed root → 409 ROOT_PROTECTED, юу ч устахгүй', async () => {
  const { h, req } = await setup();
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-01T01:00:00.000Z', endedAt: '2026-10-01T02:00:00.000Z' });
  const done = await req(A, 'POST', '/api/tasks/501/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: pt(5) });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  const before = fingerprint(h, 501);
  const r = await req(ADMIN, 'DELETE', '/api/tasks/501');
  assert.equal(r.status, 409, JSON.stringify(r.json));
  assert.equal(r.json.error, 'ROOT_PROTECTED');
  assert.equal(fingerprint(h, 501), before);
});

test('DELETE /api/tasks/:id түүхгүй (хуваасан ч ажил хийгдээгүй) root → устна, хуваарилалтын мөр өнчин үлдэхгүй', async () => {
  const { h, req } = await setup();
  const r = await req(ADMIN, 'DELETE', '/api/tasks/501');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  for (const t of ['task_roots', 'task_allocations', 'task_contributions']) {
    assert.equal((h.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE task_id = 501`).get() as { n: number }).n, 0, t);
  }
});

test('PUT /api/tasks/:id нэр/хугацаа засахад хуваарилалт, журнал хөндөгдөхгүй (зөвхөн жин → оноог журналаас тулгана)', async () => {
  const { h, req } = await setup();
  const before = fingerprint(h, 501);
  const r = await req(ADMIN, 'PUT', '/api/tasks/501', { name: 'Шинэ нэр' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(fingerprint(h, 501), before, 'нэр засах нь хуваарилалт/оноог хөдөлгөхгүй');
});

test('идэвхгүй/түр зогссон төлөвт хуучин замууд ХЭВЭЭР хаалттай (төлөв нь хуучин замыг нээхгүй)', async () => {
  const { h, req } = await setup();
  for (const state of ['paused', 'disabled'] as const) {
    h.sqlite.exec(`UPDATE app_settings SET value = '${state}' WHERE key = 'task_alloc.state'`);
    const before = fingerprint(h, 501);
    const r = await req(A, 'POST', '/api/progress', { task_id: 501, percentage: 55, date: '2026-10-05' });
    assert.equal(r.status, 409, `${state}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.error, 'MANAGED_ROOT', state);
    assert.equal(fingerprint(h, 501), before, state);
  }
});

test('хуучин клиент (гэрээний толгойгүй) хуучин замаар managed таскт хүрч ЧАДАХГҮЙ', async () => {
  const { h, req } = await setup();
  const before = fingerprint(h, 501);
  const r = await req(A, 'POST', '/api/progress', { task_id: 501, percentage: 55, date: '2026-10-05' }, { contract: null });
  assert.ok([409, 426].includes(r.status), `status ${r.status}`);
  assert.equal(fingerprint(h, 501), before);
});
