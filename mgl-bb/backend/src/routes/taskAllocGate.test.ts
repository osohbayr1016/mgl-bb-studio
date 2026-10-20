// Таскийн хуваарилалтын ХААЛГА — HTTP давхарга (2026-10-05): бодит router + бодит миграц.
// Матриц: идэвхжүүлэлтийн төлөв (enabled/paused/disabled/тохируулаагүй) × клиентийн гэрээ (одоогийн/толгойгүй/буруу/шинэ)
// × БҮХ managed бичих зам (allocation ×6, timer start, claim, session void/restore) + хуучин (managed биш) замууд ХЭВЭЭР.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, session, uid, USERS } from '../../test-support/allocHarness.ts';
import { makeApp } from '../../test-support/allocApp.ts';
import { setAllocLogSink } from '../lib/taskAllocLog.ts';

const { todayInUB } = await import('../lib/time.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B, C, SENIOR, ADMIN } = USERS;

function clockIn(h: ReturnType<typeof makeDb>, ids: number[]) {
  for (const u of ids) {
    h.sqlite
      .prepare(`INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out) VALUES (?, ?, '08:55', NULL)`)
      .run(u, todayInUB());
  }
}

async function setup(state: 'enabled' | 'paused' | 'disabled' | null = 'enabled') {
  const h = makeDb({ state: 'enabled' });
  const api = await makeApp(h);
  // Managed болгох (enabled үед), дараа нь шаардлагатай төлөвт шилжүүлнэ.
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
  if (state === null) h.sqlite.exec("DELETE FROM app_settings WHERE key = 'task_alloc.state'");
  else h.sqlite.exec(`UPDATE app_settings SET value = '${state}' WHERE key = 'task_alloc.state'`);
  return { h, ...api };
}

const progressBody = (rev: number, units = pt(5)) => ({ request_id: uid('p'), expected_revision: rev, done_units: units });

test('enabled + одоогийн гэрээ: managed бичилт ажиллана, хариуд гэрээ/төлөв/корреляцийн толгой', async () => {
  const { h, req } = await setup('enabled');
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-01T01:00:00.000Z', endedAt: '2026-10-01T02:00:00.000Z' });
  const r = await req(A, 'POST', '/api/tasks/501/allocation/progress', progressBody(1));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.headers.get('x-task-alloc-contract'), '1');
  assert.equal(r.headers.get('x-task-alloc-state'), 'enabled');
  assert.match(r.headers.get('x-request-id') ?? '', /^[A-Za-z0-9._-]{8,64}$/);
});

test('корреляцийн ID: зөв X-Request-Id-г хэвээр эргүүлнэ, буруу бол шинээр үүсгэнэ', async () => {
  const { req } = await setup('enabled');
  const good = await req(A, 'GET', '/api/tasks/501/allocation', undefined, { headers: { 'x-request-id': 'trace-abc-12345' } });
  assert.equal(good.headers.get('x-request-id'), 'trace-abc-12345');
  const bad = await req(A, 'GET', '/api/tasks/501/allocation', undefined, { headers: { 'x-request-id': 'bad id!' } });
  assert.match(bad.headers.get('x-request-id') ?? '', /^[0-9a-f-]{36}$/);
});

test('БҮХ allocation бичих замууд: толгойгүй → 426 (Upgrade), юу ч бичигдэхгүй', async () => {
  const { h, req } = await setup('enabled');
  const revBefore = h.sqlite.prepare('SELECT revision FROM task_roots WHERE task_id = 501').get() as { revision: number };
  const paths: Array<[string, unknown]> = [
    ['split', { request_id: uid('s'), expected_revision: 1, mode: 'total', targets: [] }],
    ['progress', progressBody(1)],
    ['release', { request_id: uid('r'), expected_revision: 1 }],
    ['retake', { request_id: uid('t'), expected_revision: 1 }],
    ['correct', { request_id: uid('c'), expected_revision: 1, items: [{ slice_id: 1 }] }],
    ['restore', { request_id: uid('x'), expected_revision: 1, correction_request_id: 'whatever' }],
    ['parts', { request_id: uid('p'), expected_revision: 1, parts: [{ label: 'а', units: 10_000 }] }],
    ['claim-part', { request_id: uid('k'), expected_revision: 1, part_id: 1 }],
  ];
  const opsBefore = (h.sqlite.prepare('SELECT COUNT(*) AS n FROM task_ops').get() as { n: number }).n;
  for (const [name, body] of paths) {
    const r = await req(A, 'POST', `/api/tasks/501/allocation/${name}`, body, { contract: null });
    assert.equal(r.status, 426, name);
    assert.equal(r.json.error, 'CONTRACT_UPGRADE_REQUIRED', name);
    assert.equal(r.headers.get('upgrade'), 'MGL-Task-Alloc/1', name);
    assert.equal(r.headers.get('x-task-alloc-contract'), '1', name);
    assert.equal(r.headers.get('cache-control'), 'no-store', name);
  }
  const revAfter = h.sqlite.prepare('SELECT revision FROM task_roots WHERE task_id = 501').get() as { revision: number };
  assert.equal(revAfter.revision, revBefore.revision);
  assert.equal((h.sqlite.prepare('SELECT COUNT(*) AS n FROM task_ops').get() as { n: number }).n, opsBefore);
});

test('буруу / шинэ (сервер хуучин) гэрээний толгой → 426', async () => {
  const { req } = await setup('enabled');
  for (const c of ['abc', '0', '1.0', '2', '999']) {
    const r = await req(A, 'POST', '/api/tasks/501/allocation/progress', progressBody(1), { contract: c });
    assert.equal(r.status, 426, c);
  }
});

test('paused: бүх managed бичилт 423 TASK_ALLOC_PAUSED, УНШИХ хэвээр, allowed бүгд false', async () => {
  const { h, req } = await setup('paused');
  const opsBefore = (h.sqlite.prepare('SELECT COUNT(*) AS n FROM task_ops').get() as { n: number }).n;
  for (const name of ['split', 'progress', 'release', 'retake', 'correct', 'restore', 'parts', 'claim-part']) {
    const r = await req(A, 'POST', `/api/tasks/501/allocation/${name}`, progressBody(1));
    assert.equal(r.status, 423, name);
    assert.equal(r.json.error, 'TASK_ALLOC_PAUSED', name);
    assert.equal(r.headers.get('x-task-alloc-state'), 'paused', name);
    assert.equal(r.headers.get('upgrade'), null, name);
  }
  assert.equal((h.sqlite.prepare('SELECT COUNT(*) AS n FROM task_ops').get() as { n: number }).n, opsBefore);

  const view = await req(A, 'GET', '/api/tasks/501/allocation');
  assert.equal(view.status, 200);
  assert.equal(view.json.managed, true);
  assert.equal(view.json.alloc_state, 'paused');
  assert.deepEqual(view.json.allowed, { edit: false, progress: false, release: false, retake: false, parts: false });
  assert.equal(view.headers.get('x-task-alloc-state'), 'paused');
  const records = await req(A, 'GET', '/api/tasks/501/allocation/records');
  assert.equal(records.status, 200);
});

test('disabled → 423 TASK_ALLOC_DISABLED; мөр байхгүй (тохируулаагүй) → fail-safe 423 UNCONFIGURED', async () => {
  const d = await setup('disabled');
  const r1 = await d.req(A, 'POST', '/api/tasks/501/allocation/progress', progressBody(1));
  assert.equal(r1.status, 423);
  assert.equal(r1.json.error, 'TASK_ALLOC_DISABLED');
  const u = await setup(null);
  const r2 = await u.req(A, 'POST', '/api/tasks/501/allocation/progress', progressBody(1));
  assert.equal(r2.status, 423);
  assert.equal(r2.json.error, 'TASK_ALLOC_UNCONFIGURED');
  assert.equal(r2.headers.get('x-task-alloc-state'), 'paused');
});

test('426 нь 423-аас ӨМНӨ: paused + толгойгүй клиент → 426', async () => {
  const { req } = await setup('paused');
  const r = await req(A, 'POST', '/api/tasks/501/allocation/progress', progressBody(1), { contract: null });
  assert.equal(r.status, 426);
});

test('paused үед ч admin энгийн managed мутаци хийж ЧАДАХГҮЙ (зөвхөн төлөв солих замаар)', async () => {
  const { req } = await setup('paused');
  const r = await req(ADMIN, 'POST', '/api/tasks/501/allocation/split', {
    request_id: uid('s'), expected_revision: 1, mode: 'total', targets: [{ user_id: A, target_units: pt(100) }],
  });
  assert.equal(r.status, 423);
});

test('managed таск дээр timer start: толгойгүй 426, paused 423, enabled ажиллана; pause ХЭЗЭЭ Ч хаагдахгүй', async () => {
  const { h, req } = await setup('enabled');
  clockIn(h, [A, B]);
  const noHeader = await req(A, 'POST', '/api/task-timer/start', { task_id: 501 }, { contract: null });
  assert.equal(noHeader.status, 426);
  assert.equal(noHeader.json.error, 'CONTRACT_UPGRADE_REQUIRED');

  const ok = await req(A, 'POST', '/api/task-timer/start', { task_id: 501 });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));

  h.sqlite.exec("UPDATE app_settings SET value = 'paused' WHERE key = 'task_alloc.state'");
  const blocked = await req(B, 'POST', '/api/task-timer/start', { task_id: 501 });
  assert.equal(blocked.status, 423);
  assert.equal(blocked.json.error, 'TASK_ALLOC_PAUSED');
  // Зогсоох нь осолд ч боломжтой.
  const pause = await req(A, 'POST', '/api/task-timer/pause', { task_id: 501 }, { contract: null });
  assert.equal(pause.status, 200);
  assert.equal(pause.json.outcome, 'paused');
});

test('managed БИШ таск дээр timer start/claim: хаалтгүй (толгойгүй, paused ч ажиллана) — хуучин зан төлөв ХЭВЭЭР', async () => {
  const { h, req } = await setup('paused');
  clockIn(h, [A]);
  const r = await req(A, 'POST', '/api/task-timer/start', { task_id: 504 }, { contract: null });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const claim = await req(A, 'POST', '/api/tasks/502/claim', undefined, { contract: null });
  assert.equal(claim.status, 200, JSON.stringify(claim.json));
});

test('POST /api/tasks/:id/claim managed таскт: толгойгүй 426, paused 423', async () => {
  const { h, req } = await setup('enabled');
  clockIn(h, [A]);
  const noHeader = await req(A, 'POST', '/api/tasks/501/claim', undefined, { contract: null });
  assert.equal(noHeader.status, 426);
  h.sqlite.exec("UPDATE app_settings SET value = 'disabled' WHERE key = 'task_alloc.state'");
  const off = await req(A, 'POST', '/api/tasks/501/claim');
  assert.equal(off.status, 423);
  assert.equal(off.json.error, 'TASK_ALLOC_DISABLED');
});

test('сэшн void/restore: managed таскийнх paused үед 423, толгойгүй 426; managed биш нь хаалтгүй', async () => {
  const { h, req } = await setup('enabled');
  const managedSession = session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-01T01:00:00.000Z', endedAt: '2026-10-01T02:00:00.000Z' });
  const plainSession = session(h.sqlite, { userId: A, taskId: 504, startedAt: '2026-10-01T03:00:00.000Z', endedAt: '2026-10-01T04:00:00.000Z' });
  const noHeader = await req(A, 'POST', `/api/task-timer/sessions/${managedSession}/void`, { request_id: uid('v') }, { contract: null });
  assert.equal(noHeader.status, 426);
  h.sqlite.exec("UPDATE app_settings SET value = 'paused' WHERE key = 'task_alloc.state'");
  const paused = await req(A, 'POST', `/api/task-timer/sessions/${managedSession}/void`, { request_id: uid('v') });
  assert.equal(paused.status, 423);
  const restorePaused = await req(A, 'POST', `/api/task-timer/sessions/${managedSession}/restore`, { request_id: uid('v') });
  assert.equal(restorePaused.status, 423);
  const plain = await req(A, 'POST', `/api/task-timer/sessions/${plainSession}/void`, { request_id: uid('v') }, { contract: null });
  assert.equal(plain.status, 200, JSON.stringify(plain.json));
});

test('хуучин замууд (таск үүсгэх/засах, split 410, legacy progress) хаалганд ОРООГҮЙ — толгойгүй ч paused ч ажиллана', async () => {
  const { req } = await setup('paused');
  const split = await req(A, 'POST', '/api/tasks/504/split', { weights: [5, 5] }, { contract: null });
  assert.equal(split.status, 410);
  assert.equal(split.json.error, 'SPLIT_RETIRED');
  const put = await req(SENIOR, 'PUT', '/api/tasks/504', { name: 'Огтлол 2' }, { contract: null });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const legacy = await req(A, 'POST', '/api/progress', { task_id: 501, percentage: 10, date: todayInUB() }, { contract: null });
  assert.equal(legacy.status, 409);
  assert.equal(legacy.json.error, 'MANAGED_ROOT');
});

test('хаалганы татгалзал бүтэцтэй логт орно (идентифайер л, нууц тайлбаргүй)', async () => {
  const { req } = await setup('paused');
  const lines: string[] = [];
  setAllocLogSink((l) => lines.push(l));
  try {
    await req(A, 'POST', '/api/tasks/501/allocation/progress', progressBody(1), { contract: null });
    await req(A, 'POST', '/api/tasks/501/allocation/progress', progressBody(1));
  } finally {
    setAllocLogSink(null);
  }
  const parsed = lines.map((l) => JSON.parse(l));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].evt, 'gate_block');
  assert.equal(parsed[0].status, 426);
  assert.equal(parsed[0].actor_id, A);
  assert.equal(parsed[1].status, 423);
  assert.equal(parsed[1].state, 'paused');
  assert.equal(parsed[1].op, 'POST /api/tasks/:n/allocation/progress');
  for (const p of parsed) assert.ok(!('notes' in p) && !('full_name' in p));
});

/* ------------------------------------------------------------------ */
/*  Менежерийн router                                                   */
/* ------------------------------------------------------------------ */

test('alloc-admin: энгийн инженер 403, senior уншина, зөвхөн admin солино', async () => {
  const { req } = await setup('enabled');
  assert.equal((await req(A, 'GET', '/api/tasks/alloc-admin/state')).status, 403);
  const read = await req(SENIOR, 'GET', '/api/tasks/alloc-admin/state');
  assert.equal(read.status, 200);
  assert.equal(read.json.state, 'enabled');
  assert.equal(read.json.contract, 1);
  assert.equal(read.json.counts.roots, 1);
  assert.equal(read.json.counts.participants, 2);
  const seniorPut = await req(SENIOR, 'PUT', '/api/tasks/alloc-admin/state', { state: 'paused', reason: 'тест' });
  assert.equal(seniorPut.status, 403);
});

test('alloc-admin PUT state: paused үед ч ажиллана, үндэслэл заавал, түүх бичигдэнэ, CAS', async () => {
  const { h, req } = await setup('paused');
  const noReason = await req(ADMIN, 'PUT', '/api/tasks/alloc-admin/state', { state: 'enabled' });
  assert.equal(noReason.status, 400);
  assert.equal(noReason.json.error, 'REASON_REQUIRED');
  const bad = await req(ADMIN, 'PUT', '/api/tasks/alloc-admin/state', { state: 'on', reason: 'тест өөрчлөлт' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'BAD_STATE');
  const stale = await req(ADMIN, 'PUT', '/api/tasks/alloc-admin/state', { state: 'enabled', expected_state: 'disabled', reason: 'тест өөрчлөлт' });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'STATE_CHANGED');

  const ok = await req(ADMIN, 'PUT', '/api/tasks/alloc-admin/state', { state: 'enabled', expected_state: 'paused', reason: 'шалгалт дууссан' }, { contract: null });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.state, 'enabled');
  assert.equal(ok.json.changed, true);
  assert.equal(ok.headers.get('x-task-alloc-state'), 'enabled');
  const log = h.sqlite.prepare('SELECT from_state, to_state, actor_id, reason, contract FROM task_alloc_state_log ORDER BY id DESC LIMIT 1').get() as Record<string, unknown>;
  assert.deepEqual({ ...log }, { from_state: 'paused', to_state: 'enabled', actor_id: ADMIN, reason: 'шалгалт дууссан', contract: 1 });
  const rows = (h.sqlite.prepare('SELECT COUNT(*) AS n FROM task_alloc_state_log').get() as { n: number }).n;
  const same = await req(ADMIN, 'PUT', '/api/tasks/alloc-admin/state', { state: 'enabled', reason: 'ижил төлөв' });
  assert.equal(same.status, 200);
  assert.equal(same.json.changed, false);
  assert.equal((h.sqlite.prepare('SELECT COUNT(*) AS n FROM task_alloc_state_log').get() as { n: number }).n, rows, 'ижил төлөв түүх нэмэхгүй');
});

test('alloc-admin: тохируулаагүй (мөр устсан) үед PUT мөрийг үүсгэнэ', async () => {
  const { h, req } = await setup(null);
  const r = await req(ADMIN, 'PUT', '/api/tasks/alloc-admin/state', { state: 'paused', reason: 'эхний тохиргоо' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const row = h.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'task_alloc.state'").get() as { value: string };
  assert.equal(row.value, 'paused');
});

test('alloc-admin /roots: managed root-ийн тойм (оролцогч, зорилт, хийсэн)', async () => {
  const { req } = await setup('enabled');
  const r = await req(SENIOR, 'GET', '/api/tasks/alloc-admin/roots?project_id=10');
  assert.equal(r.status, 200);
  assert.equal(r.json.total, 1);
  const row = r.json.rows[0];
  assert.equal(row.task_id, 501);
  assert.equal(row.participants, 2);
  assert.equal(row.active_participants, 2);
  assert.equal(row.sum_target_units, pt(100));
  assert.equal(row.sum_done_units, 0);
  const other = await req(SENIOR, 'GET', '/api/tasks/alloc-admin/roots?project_id=20');
  assert.equal(other.json.total, 0);
});

test('миграц 0384: root байхгүй → disabled, байвал paused (устгахгүй, мутацийг түр хаана)', async () => {
  const { readFileSync } = await import('node:fs');
  const { DatabaseSync } = await import('node:sqlite');
  const sql0384 = readFileSync(new URL('../../migrations/0384_task_alloc_gate.sql', import.meta.url), 'utf8');
  for (const [hasRoot, expected] of [[false, 'disabled'], [true, 'paused']] as const) {
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')), updated_by INTEGER)');
    db.exec('CREATE TABLE task_roots (task_id INTEGER PRIMARY KEY)');
    if (hasRoot) db.exec('INSERT INTO task_roots (task_id) VALUES (1)');
    db.exec(sql0384);
    const v = db.prepare("SELECT value FROM app_settings WHERE key = 'task_alloc.state'").get() as { value: string };
    assert.equal(v.value, expected);
    const log = db.prepare('SELECT to_state, reason, actor_id FROM task_alloc_state_log').all() as Array<Record<string, unknown>>;
    assert.equal(log.length, 1);
    assert.equal(log[0]!.to_state, expected);
    assert.equal(log[0]!.actor_id, null);
    // Өмнө тохируулсан утгыг ДАРАХГҮЙ (INSERT OR IGNORE) — миграц дахин ажиллавал ч.
    db.exec("UPDATE app_settings SET value = 'enabled' WHERE key = 'task_alloc.state'");
    db.exec(sql0384);
    const again = db.prepare("SELECT value FROM app_settings WHERE key = 'task_alloc.state'").get() as { value: string };
    assert.equal(again.value, 'enabled');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM task_alloc_state_log').get() as { n: number }).n, 1);
  }
});

test('alloc-admin GET audit: инженер 403, senior/admin уншина, paused үед ч ажиллана, эвдсэн өгөгдлийг барина', async () => {
  const { h, req } = await setup('paused');
  assert.equal((await req(A, 'GET', '/api/tasks/alloc-admin/audit')).status, 403);
  const ok = await req(SENIOR, 'GET', '/api/tasks/alloc-admin/audit');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.roots_checked, 1);
  assert.equal(ok.headers.get('x-task-alloc-state'), 'paused');
  h.sqlite.prepare('UPDATE task_roots SET unallocated_units = unallocated_units + 5000').run();
  const bad = await req(ADMIN, 'GET', '/api/tasks/alloc-admin/audit?task_id=501&deep=1');
  assert.equal(bad.status, 200);
  assert.equal(bad.json.ok, false);
  assert.equal(bad.json.counts.ROOT_SUM_NOT_100, 1);
  assert.equal(bad.json.findings[0].task_id, 501);
  assert.equal(bad.json.scope.deep, true);
});

test('alloc-admin: буруу (enum биш) төлөвийн мөрийг админ засаж чадна — өмнө нь INSERT OR IGNORE нь мөрийг хөндөхгүй, STATE_CHANGED үүрд', async () => {
  const { h, req } = await setup('enabled');
  h.sqlite.exec("UPDATE app_settings SET value = 'ON' WHERE key = 'task_alloc.state'"); // junk → код талд paused (тохируулаагүй)
  const cur = await req(ADMIN, 'GET', '/api/tasks/alloc-admin/state');
  assert.equal(cur.json.state, 'paused');
  assert.equal(cur.json.configured, false);
  const r = await req(ADMIN, 'PUT', '/api/tasks/alloc-admin/state', { state: 'enabled', expected_state: 'paused', reason: 'буруу утгыг засав' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal((h.sqlite.prepare("SELECT value FROM app_settings WHERE key = 'task_alloc.state'").get() as { value: string }).value, 'enabled');
  assert.equal((h.sqlite.prepare("SELECT COUNT(*) AS n FROM task_alloc_state_log WHERE to_state = 'enabled' AND reason = 'буруу утгыг засав'").get() as { n: number }).n, 1);
});

test('PUT /api/tasks/:id: жин нь төгсгөлөг, 0..100000 — 1e9 / мөр 400 (managed root-ийн коэффициентийг эвдэхгүй)', async () => {
  const { h, req } = await setup('enabled');
  for (const bad of [1e9, 'abc', -1]) {
    const r = await req(ADMIN, 'PUT', '/api/tasks/501', { weight_percent: bad });
    assert.equal(r.status, 400, String(bad));
  }
  const w = (h.sqlite.prepare('SELECT weight_percent AS w FROM tasks WHERE id = 501').get() as { w: number }).w;
  assert.ok(w < 1000, `жин хэвээр: ${w}`);
});
