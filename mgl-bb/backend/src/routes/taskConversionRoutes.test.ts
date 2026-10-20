// Хөрвүүлэлтийн HTTP давхарга (2026-10-05): эрх (инженер 403, senior preview, зөвхөн admin apply/revert), бүтэн урсгал
// (candidates → preview → apply → history → revert) ба нэгтгэгдсэн хэсэг дээрх хуучин БҮХ бичих замын хаалт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyEntry, makeDb, rows, USERS, uid } from '../../test-support/allocHarness.ts';
import { makeApp } from '../../test-support/allocApp.ts';

const { A, B, C, SENIOR, ADMIN } = USERS;
const GROUP = [501, 502, 504];

function legacyGroup(h: ReturnType<typeof makeDb>) {
  legacyEntry(h.sqlite, { taskId: 501, userId: A, pct: 50, createdAt: '2026-09-12 10:00:00', points: { amount: 5, deltaPct: 5 } });
  legacyEntry(h.sqlite, { taskId: 502, userId: B, pct: 30, createdAt: '2026-09-11 10:00:00', points: { amount: 6, deltaPct: 6 } });
  legacyEntry(h.sqlite, { taskId: 504, userId: C, pct: 60, createdAt: '2026-09-13 10:00:00', points: { amount: 6, deltaPct: 6 } });
  h.sqlite.prepare("UPDATE tasks SET name = 'Фасад (1/3)' WHERE id = 501").run();
  h.sqlite.prepare("UPDATE tasks SET name = 'Фасад (2/3)' WHERE id = 502").run();
  h.sqlite.prepare("UPDATE tasks SET name = 'Фасад (3/3)' WHERE id = 504").run();
}

async function setup() {
  const h = makeDb({ state: 'paused' }); // release-ийн дараалал: paused дээр хөрвүүлнэ
  legacyGroup(h);
  const api = await makeApp(h);
  return { h, ...api };
}

const base = '/api/tasks/alloc-admin/conversion';

test('эрх: инженер 403, senior preview/candidates уншина, apply/revert зөвхөн admin', async () => {
  const { req } = await setup();
  assert.equal((await req(A, 'GET', `${base}/candidates`)).status, 403);
  assert.equal((await req(A, 'POST', `${base}/preview`, { task_ids: GROUP })).status, 403);
  const cand = await req(SENIOR, 'GET', `${base}/candidates`);
  assert.equal(cand.status, 200, JSON.stringify(cand.json));
  const pv = await req(SENIOR, 'POST', `${base}/preview`, { task_ids: GROUP });
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  const apply = await req(SENIOR, 'POST', `${base}/apply`, { task_ids: GROUP, request_id: uid('conv'), plan_hash: pv.json.plan_hash, reason: 'тест' });
  assert.equal(apply.status, 403);
  const revert = await req(SENIOR, 'POST', `${base}/conv-x/revert`, { request_id: uid('rev'), reason: 'тест' });
  assert.equal(revert.status, 403);
});

test('бүтэн урсгал (paused дээр): candidates → preview → apply → history → revert; X-Task-Alloc толгой тээнэ', async () => {
  const { h, req } = await setup();
  const cand = await req(ADMIN, 'GET', `${base}/candidates`);
  assert.equal(cand.status, 200);
  assert.equal(cand.json.groups.length, 1);
  assert.equal(cand.json.groups[0].evidence, 'name_pattern');
  assert.equal(cand.json.groups[0].classification.classification, 'ambiguous');
  assert.equal(cand.json.groups[0].suggested_root_task_id, 501);
  assert.equal(cand.headers.get('x-task-alloc-state'), 'paused');

  const pv = await req(ADMIN, 'POST', `${base}/preview`, { task_ids: cand.json.groups[0].task_ids });
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  assert.equal(pv.json.plan.rootNameAfter, 'Фасад');
  assert.equal(pv.json.needs_confirmation, true);

  const requestId = uid('conv');
  const noConfirm = await req(ADMIN, 'POST', `${base}/apply`, { task_ids: GROUP, request_id: requestId, plan_hash: pv.json.plan_hash, reason: 'нэрийн хэв маяг' });
  assert.equal(noConfirm.status, 409);
  assert.equal(noConfirm.json.error, 'CONFIRMATION_REQUIRED');
  const ok = await req(ADMIN, 'POST', `${base}/apply`, { task_ids: GROUP, request_id: requestId, plan_hash: pv.json.plan_hash, reason: 'нэрийн хэв маяг', confirm_ambiguous: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.root_task_id, 501);
  assert.equal(ok.json.replayed, false);
  const replay = await req(ADMIN, 'POST', `${base}/apply`, { task_ids: GROUP, request_id: requestId, plan_hash: pv.json.plan_hash, reason: 'нэрийн хэв маяг', confirm_ambiguous: true });
  assert.equal(replay.json.replayed, true);

  const hist = await req(SENIOR, 'GET', `${base}/history`);
  assert.equal(hist.json.conversions.length, 1);
  assert.equal(hist.json.conversions[0].status, 'applied');
  const audit = await req(ADMIN, 'GET', '/api/tasks/alloc-admin/audit?deep=1');
  assert.equal(audit.json.ok, true, JSON.stringify(audit.json.findings));

  const rev = await req(ADMIN, 'POST', `${base}/${requestId}/revert`, { request_id: uid('rev'), reason: 'тест буцаалт' });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  assert.equal(rows(h.sqlite, 'SELECT * FROM task_roots').length, 0);
  assert.equal((await req(SENIOR, 'GET', `${base}/history`)).json.conversions[0].status, 'reverted');
});

test('нэгтгэгдсэн хэсэг: хуучин БҮХ бичих зам хаалттай (явц, таймер, жин засах, устгах), root руу чиглүүлнэ', async () => {
  const { h, req } = await setup();
  const pv = await req(ADMIN, 'POST', `${base}/preview`, { task_ids: GROUP });
  const ok = await req(ADMIN, 'POST', `${base}/apply`, { task_ids: GROUP, request_id: uid('conv'), plan_hash: pv.json.plan_hash, reason: 'нэрийн хэв маяг', confirm_ambiguous: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  h.sqlite.exec("UPDATE app_settings SET value = 'enabled' WHERE key = 'task_alloc.state'");
  h.sqlite.prepare("INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out) VALUES (?, date('now'), '08:55', NULL)").run(B);

  // явц: нэгтгэгдсэн хэсэг (502) дээр
  const prog = await req(B, 'POST', '/api/progress', { task_id: 502, percentage: 40 });
  assert.equal(prog.status, 409, JSON.stringify(prog.json));
  assert.equal(prog.json.error, 'CONVERTED_PART');
  assert.equal(prog.json.root_task_id, 501);
  assert.equal(prog.json.retryable, false);
  // таймер, claim
  const timer = await req(B, 'POST', '/api/task-timer/start', { task_id: 502 });
  assert.equal(timer.status, 409, JSON.stringify(timer.json));
  assert.equal(timer.json.error, 'CONVERTED_PART');
  const claim = await req(B, 'POST', '/api/tasks/502/claim', {});
  assert.equal(claim.status, 409, JSON.stringify(claim.json));
  assert.equal(claim.json.error, 'CONVERTED_PART');
  // жин/хугацаа засах, устгах
  const put = await req(SENIOR, 'PUT', '/api/tasks/502', { weight_percent: 20 });
  assert.equal(put.status, 409);
  assert.equal(put.json.error, 'CONVERTED_PART');
  assert.equal(rows<{ weight_percent: number }>(h.sqlite, 'SELECT weight_percent FROM tasks WHERE id = 502')[0]!.weight_percent, 0);
  const del = await req(SENIOR, 'DELETE', '/api/tasks/502');
  assert.equal(del.status, 409, JSON.stringify(del.json));
  assert.equal(del.json.error, 'ROOT_PROTECTED');
  // жагсаалтад retired_into
  const list = await req(SENIOR, 'GET', '/api/tasks?component_id=1');
  const t502 = list.json.tasks.find((t: { id: number }) => t.id === 502);
  assert.equal(t502.retired_into, 501);
  assert.equal(list.json.tasks.find((t: { id: number }) => t.id === 501).retired_into, null);
  // «Миний ажлууд»-д нэгтгэгдсэн хэсэг гарахгүй (B 502 дээр ажиллаж байсан)
  h.sqlite.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (502, ?)').run(B);
  const mine = await req(B, 'GET', '/api/progress/my-tasks/ids?project_id=10');
  assert.equal(mine.status, 200, JSON.stringify(mine.json));
  assert.ok(!(mine.json.task_ids as number[]).includes(502), 'нэгтгэгдсэн хэсэг миний жагсаалтад үгүй');
  assert.ok((mine.json.task_ids as number[]).includes(501), 'харин B-ийн хийсэн хэсэг бүхий root жагсаалтад бий');
});

test('credit/reweight: engineer 403, senior төлөвлөгөө үзнэ, зөвхөн admin хэрэгжүүлнэ; хэрэгжүүлсний дараа drift алга (идемпотент)', async () => {
  const h = makeDb({ state: 'enabled' });
  const api = await makeApp(h);
  const U = 10_000;
  const split = await api.req(A, 'POST', '/api/tasks/501/allocation/split', {
    request_id: uid('split'), expected_revision: 0, mode: 'total',
    targets: [{ user_id: A, target_units: 60 * U }, { user_id: B, target_units: 40 * U }],
  });
  assert.equal(split.status, 200, JSON.stringify(split.json));
  h.sqlite.prepare("INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms, start_reason, started_by, start_request_id, end_reason, created_at, updated_at) VALUES (3, 501, 10, '2026-10-05T08:00:00.000Z', '2026-10-05T08:30:00.000Z', 1800000, 'start', 3, 'seed-x', 'pause', '2026-10-05T08:00:00.000Z', '2026-10-05T08:00:00.000Z')").run();
  const prog = await api.req(A, 'POST', '/api/tasks/501/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: 30 * U });
  assert.equal(prog.status, 200, JSON.stringify(prog.json));
  // Жинг шууд SQL-ээр (hook-ийг тойруулж) 10 → 20 болгоно: оноо хоцорно.
  h.sqlite.prepare('UPDATE tasks SET weight_percent = 20 WHERE id = 501').run();

  assert.equal((await api.req(A, 'GET', '/api/tasks/alloc-admin/credit/reweight?task_id=501')).status, 403);
  const preview = await api.req(SENIOR, 'GET', '/api/tasks/alloc-admin/credit/reweight?task_id=501');
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.drifting, 1);
  assert.ok(preview.json.amount_delta > 0);
  assert.equal((await api.req(SENIOR, 'POST', '/api/tasks/alloc-admin/credit/reweight', { task_id: 501 })).status, 403);
  assert.equal((await api.req(ADMIN, 'POST', '/api/tasks/alloc-admin/credit/reweight', {})).status, 400);

  const applied = await api.req(ADMIN, 'POST', '/api/tasks/alloc-admin/credit/reweight', { task_id: 501 });
  assert.equal(applied.status, 200, JSON.stringify(applied.json));
  assert.equal(applied.json.result.kind, 'applied');
  const after = await api.req(SENIOR, 'GET', '/api/tasks/alloc-admin/credit/reweight?project_id=10');
  assert.equal(after.json.drifting, 0);
  const again = await api.req(ADMIN, 'POST', '/api/tasks/alloc-admin/credit/reweight', { project_id: 10 });
  assert.equal(again.json.result.applied, 0, 'зөрүүгүй бол юу ч бичихгүй');
  const audit = await api.req(ADMIN, 'GET', '/api/tasks/alloc-admin/audit?deep=1');
  assert.equal(audit.json.ok, true, JSON.stringify(audit.json.findings));
});

test('POST /api/blocks/:id/scaffold: нэгтгэгдсэн хэсгийн жинг сэргээж ДАВХАР тоолох боломжгүй (409 CONVERTED_PART), буруу жин 400', async () => {
  const { h, req } = await setup();
  const pv = await req(ADMIN, 'POST', `${base}/preview`, { task_ids: GROUP });
  const apply = await req(ADMIN, 'POST', `${base}/apply`, { task_ids: GROUP, request_id: uid('conv'), plan_hash: pv.json.plan_hash, reason: 'нэрийн хэв маяг', confirm_ambiguous: true });
  assert.equal(apply.status, 200, JSON.stringify(apply.json));
  const weights = () => rows<{ id: number; weight_percent: number }>(h.sqlite, 'SELECT id, weight_percent FROM tasks WHERE id IN (501, 502, 504) ORDER BY id');
  const before = JSON.stringify(weights());

  const retired = await req(SENIOR, 'POST', '/api/blocks/100/scaffold', { drawings: [], weightUpdates: { tasks: [{ id: 502, weight_percent: 20 }] } });
  assert.equal(retired.status, 409, JSON.stringify(retired.json));
  assert.equal(retired.json.error, 'CONVERTED_PART');
  assert.equal(JSON.stringify(weights()), before, 'нэгтгэгдсэн хэсгийн жин хөндөгдөөгүй');

  for (const bad of ['abc', -5, null, 1e9]) {
    const r = await req(SENIOR, 'POST', '/api/blocks/100/scaffold', { drawings: [], weightUpdates: { tasks: [{ id: 504, weight_percent: bad }] } });
    if (bad === null) {
      assert.equal(r.status, 409, 'null = 0 (хуучин зан) — жин талбар хоосон; нэгтгэгдсэн хэсэг тул ТЭР хаалтаар (500 биш)');
      continue;
    }
    assert.equal(r.status, 400, `${String(bad)}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.code, 'BAD_WEIGHT');
  }
  assert.equal(JSON.stringify(weights()), before, 'буруу жин баганад бичигдээгүй');
});
