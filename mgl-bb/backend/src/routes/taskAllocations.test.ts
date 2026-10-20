// Таскийн хуваарилалтын HTTP давхарга — БОДИТ SQLite + бодит миграц дээр Hono `app.request()` (2026-10-02).
// Хамрах хүрээ: тойм/хуваах/явц/буцаах/дахин авах (хүсэлтийн шалгалт, CAS, идемпотент), авах урсгал (managed → олон хүн
// зэрэг, NOT_ALLOCATED), цаг хүчингүй болгох/сэргээх, хувь нэмэрч/цагийн нэгтгэл, устгалын хамгаалалт, /my-tasks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { actorOf, legacyEntry, makeDb, rows, session, sum, uid, USERS } from '../../test-support/allocHarness.ts';

const taskAllocations = (await import('./taskAllocations.ts')).default;
const tasksRoute = (await import('./tasks.ts')).default;
const taskTimerRoute = (await import('./taskTimer.ts')).default;
const progressRoute = (await import('./progress.ts')).default;
const componentsRoute = (await import('./components.ts')).default;
const drawingsRoute = (await import('./drawings.ts')).default;
const blocksRoute = (await import('./blocks.ts')).default;
const { todayInUB } = await import('../lib/time.ts');

const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B, C, SENIOR, ADMIN } = USERS;

function appFor(h: ReturnType<typeof makeDb>) {
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
  app.route('/api/progress', progressRoute as never);
  app.route('/api/components', componentsRoute as never);
  app.route('/api/drawings', drawingsRoute as never);
  app.route('/api/blocks', blocksRoute as never);
  const exec = { waitUntil: () => undefined, passThroughOnException: () => undefined };
  const req = async (userId: number, method: string, path: string, body?: unknown) => {
    const res = await app.request(
      `http://x${path}`,
      {
        method,
        headers: {
          'x-test-user': JSON.stringify(actorOf(userId)),
          // Одоогийн frontend бүх managed бичилтэд гэрээний хувилбарыг илгээнэ (lib/taskAllocGate.ts).
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
  return { app, req };
}

/** Бүгд ирцтэй (take) — ирцийн нээлттэй session. */
function clockIn(h: ReturnType<typeof makeDb>, ids: number[]) {
  for (const u of ids) {
    h.sqlite
      .prepare(`INSERT INTO attendance_sessions (user_id, date, clock_in, clock_out) VALUES (?, ?, '08:55', NULL)`)
      .run(u, todayInUB());
  }
}

async function split(req: ReturnType<typeof appFor>['req'], user = A, targets = [[A, 40], [B, 60]] as number[][], rev: number | null = 0, taskId = 501) {
  return req(user, 'POST', `/api/tasks/${taskId}/allocation/split`, {
    request_id: uid('split'),
    expected_revision: rev,
    mode: 'total',
    targets: targets.map(([u, p]) => ({ user_id: u, target_units: pt(p!) })),
  });
}

test('GET тойм: managed биш → preview; split-ийн дараа managed + миний хэсэг + allowed', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  const pre = await req(A, 'GET', '/api/tasks/501/allocation');
  assert.equal(pre.status, 200);
  assert.equal(pre.json.managed, false);
  assert.equal(pre.json.preview.attribution, 'empty');
  assert.equal(pre.json.allowed.edit, true);
  const r = await split(req);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.converted, true);
  assert.equal(r.json.root.revision, 1);
  const post = await req(A, 'GET', '/api/tasks/501/allocation');
  assert.equal(post.json.managed, true);
  assert.equal(post.json.me.target_units, pt(40));
  assert.equal(post.json.allowed.progress, true);
  const stranger = await req(C, 'GET', '/api/tasks/501/allocation');
  assert.equal(stranger.json.me, null);
  assert.equal(stranger.json.allowed.edit, false);
});

test('split: хүсэлтийн шалгалт 400 (mode, targets, бүхэл бус тоо), STALE 409 + current, идемпотент replayed', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  const noMode = await req(A, 'POST', '/api/tasks/501/allocation/split', { request_id: uid('s'), expected_revision: 0, targets: [] });
  assert.equal(noMode.status, 400);
  const badTarget = await req(A, 'POST', '/api/tasks/501/allocation/split', {
    request_id: uid('s'), expected_revision: 0, mode: 'total', targets: [{ user_id: A, target_units: 5.5 }],
  });
  assert.equal(badTarget.status, 400);
  const badRev = await req(A, 'POST', '/api/tasks/501/allocation/split', {
    request_id: uid('s'), expected_revision: -1, mode: 'total', targets: [],
  });
  assert.equal(badRev.status, 400);

  const requestId = uid('split');
  const body = { request_id: requestId, expected_revision: 0, mode: 'total', targets: [{ user_id: A, target_units: pt(40) }, { user_id: B, target_units: pt(60) }] };
  const first = await req(A, 'POST', '/api/tasks/501/allocation/split', body);
  const again = await req(A, 'POST', '/api/tasks/501/allocation/split', body);
  assert.equal(first.status, 200);
  assert.equal(first.json.replayed, false);
  assert.equal(again.status, 200);
  assert.equal(again.json.replayed, true);
  const stale = await req(A, 'POST', '/api/tasks/501/allocation/split', { ...body, request_id: uid('s2') });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'STALE_REVISION');
  assert.equal(stale.json.current.revision, 1);
});

test('progress HTTP: QA алдааны хэлбэр (questions, missing, scopes), амжилттай дуусгалт, noop', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  await split(req);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T08:00:00.000Z', endedAt: '2026-10-02T08:30:00.000Z' });
  const noQa = await req(A, 'POST', '/api/tasks/501/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: pt(40) });
  assert.equal(noQa.status, 400);
  assert.equal(noQa.json.error, 'completion_qa required');
  assert.ok(Array.isArray(noQa.json.questions) && noQa.json.questions.length > 0);
  assert.ok(Array.isArray(noQa.json.missing));
  assert.equal(noQa.json.scopes.own, true);
  const ok = await req(A, 'POST', '/api/tasks/501/allocation/progress', {
    request_id: uid('p'), expected_revision: 1, done_units: pt(40), completion_qa: { done: 'x', issues: 'y', next: 'z' },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.reached_own_cap, true);
  const noop = await req(A, 'POST', '/api/tasks/501/allocation/progress', {
    request_id: uid('p'), expected_revision: ok.json.root.revision, done_units: pt(40),
  });
  assert.equal(noop.status, 200);
  assert.equal(noop.json.noop, true);
  const bad = await req(A, 'POST', '/api/tasks/501/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: 'abc' });
  assert.equal(bad.status, 400);
  const noReq = await req(A, 'POST', '/api/tasks/501/allocation/progress', { expected_revision: 1, done_units: 1 });
  assert.equal(noReq.status, 400);
  assert.equal(noReq.json.error, 'BAD_REQUEST_ID');
});

test('release/retake HTTP: буцаахад чөлөөт ажил, авахад 409 хэтрэх хэмжээ + available_units', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  await split(req);
  const rel = await req(A, 'POST', '/api/tasks/501/allocation/release', { request_id: uid('r'), expected_revision: 1 });
  assert.equal(rel.status, 200, JSON.stringify(rel.json));
  assert.equal(rel.json.released_units, pt(40));
  const over = await req(C, 'POST', '/api/tasks/501/allocation/retake', { request_id: uid('r'), expected_revision: rel.json.root.revision, units: pt(50) });
  assert.equal(over.status, 409);
  assert.equal(over.json.available_units, pt(40));
  const ok = await req(C, 'POST', '/api/tasks/501/allocation/retake', { request_id: uid('r'), expected_revision: rel.json.root.revision, units: pt(40) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.taken_units, pt(40));
});

test('авах (▶): managed үед олон хүн ЗЭРЭГ ажиллана; хуваарилагдаагүй → 409 NOT_ALLOCATED + чөлөөт ажил; буцаасны дараа ч', async () => {
  const h = makeDb();
  clockIn(h, [A, B, C]);
  const { req } = appFor(h);
  await split(req);
  const a = await req(A, 'POST', '/api/task-timer/start', { task_id: 501 });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  const b = await req(B, 'POST', '/api/task-timer/start', { task_id: 501 });
  assert.equal(b.status, 200, JSON.stringify(b.json)); // хоёулаа зэрэг ажиллана (хуучин «нэг хүн» дүрэм хамаарахгүй)
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE task_id = 501 AND ended_at IS NULL'), 2);
  const c1 = await req(C, 'POST', '/api/task-timer/start', { task_id: 501 });
  assert.equal(c1.status, 409);
  assert.equal(c1.json.error, 'NOT_ALLOCATED');
  assert.equal(c1.json.allocation.available_units, 0);
  assert.equal(c1.json.allocation.has_row, false);
  // A буцаана → таймер зогсоно, дахин ▶ → NOT_ALLOCATED (+ чөлөөт ажил 40)
  const rel = await req(A, 'POST', '/api/tasks/501/allocation/release', { request_id: uid('r'), expected_revision: 1 });
  assert.equal(rel.status, 200);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE task_id = 501 AND user_id = 3 AND ended_at IS NULL'), 0);
  const a2 = await req(A, 'POST', '/api/task-timer/start', { task_id: 501 });
  assert.equal(a2.status, 409);
  assert.equal(a2.json.error, 'NOT_ALLOCATED');
  assert.equal(a2.json.allocation.available_units, pt(40));
  assert.equal(a2.json.allocation.released_units, pt(40));
  // Бусад (managed биш) таск дээр хуучин дүрэм хэвээр: A эхлүүлэхэд B 409 TASK_OCCUPIED
  const t1 = await req(A, 'POST', '/api/task-timer/start', { task_id: 504 });
  assert.equal(t1.status, 200);
  const t2 = await req(B, 'POST', '/api/task-timer/start', { task_id: 504 });
  assert.equal(t2.status, 409);
  assert.equal(t2.json.error, 'TASK_OCCUPIED');
});

test('цаг хүчингүй болгох: сэшн УСТАХГҮЙ, тоологдохгүй; хүчинтэй сэшнгүй бол хувь оруулахыг TAKE_REQUIRED; сэргээвэл дахин тоологдоно', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  await split(req);
  const sid = session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T08:00:00.000Z', endedAt: '2026-10-02T09:00:00.000Z' });
  const days = async () => (await req(A, 'GET', `/api/task-timer/users/${A}/days?from=2026-10-02&to=2026-10-02`)).json;
  assert.equal((await days()).days[0].official_ms, 3_600_000);
  const v = await req(A, 'POST', `/api/task-timer/sessions/${sid}/void`, { request_id: uid('v') });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal(v.json.outcome, 'voided');
  // Мөр үлдсэн (аудит), цаг тоологдохгүй
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE id = ?', sid), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_void_log'), 1);
  const d = await days();
  assert.equal(d.days.length === 0 || d.days[0].official_ms === 0, true);
  assert.equal(d.days.length === 0 ? false : d.days[0].sessions[0].voided, d.days.length === 0 ? false : true);
  // Хүчинтэй сэшнгүй → хувь оруулах 403 TAKE_REQUIRED
  const noSession = await req(A, 'POST', '/api/tasks/501/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: pt(5) });
  assert.equal(noSession.status, 403);
  assert.equal(noSession.json.error, 'TAKE_REQUIRED');
  // Дахин хүчингүй болгох = already_voided (идемпотент)
  const again = await req(A, 'POST', `/api/task-timer/sessions/${sid}/void`, {});
  assert.equal(again.json.outcome, 'already_voided');
  // Сэргээнэ
  const res = await req(A, 'POST', `/api/task-timer/sessions/${sid}/restore`, { request_id: uid('rs') });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.outcome, 'restored');
  assert.equal((await days()).days[0].official_ms, 3_600_000);
  const ok = await req(A, 'POST', '/api/tasks/501/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: pt(5) });
  assert.equal(ok.status, 200);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_void_log'), 2);
});

test('цаг хүчингүй болгох: өөр хүний сэшин 404; явж буй сэшин эхлээд зогсоод хүчингүй болно', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  const bs = session(h.sqlite, { userId: B, taskId: 501, startedAt: '2026-10-02T08:00:00.000Z', endedAt: '2026-10-02T09:00:00.000Z' });
  const other = await req(A, 'POST', `/api/task-timer/sessions/${bs}/void`, {});
  assert.equal(other.status, 404);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_voids'), 0);
  const running = session(h.sqlite, { userId: A, taskId: 504, startedAt: '2026-10-02T09:30:00.000Z' });
  const r = await req(A, 'POST', `/api/task-timer/sessions/${running}/void`, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.was_running, true);
  const row = rows<{ ended_at: string | null; end_note: string | null }>(h.sqlite, 'SELECT ended_at, end_note FROM task_timer_sessions WHERE id = ?', running)[0]!;
  assert.ok(row.ended_at);
  assert.equal(row.end_note, 'void');
});

test('хувь нэмэрч/цаг: нотолгоотой хүн л; bookmark БИШ; void-тэй цаг тоологдохгүй; нэр + цаг; шинэчлэгдсэн нэгтгэл', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  // B — bookmark (task_personal_list) — нотолгоо БИШ
  h.sqlite.exec(`INSERT INTO task_personal_list (user_id, task_id) VALUES (${B}, 504)`);
  // A: 504 дээр 1 цаг (хүчинтэй), C: 504 дээр хүчингүй болгосон 2 цаг
  session(h.sqlite, { userId: A, taskId: 504, startedAt: '2026-10-02T08:00:00.000Z', endedAt: '2026-10-02T09:00:00.000Z' });
  const sc = session(h.sqlite, { userId: C, taskId: 504, startedAt: '2026-10-02T10:00:00.000Z', endedAt: '2026-10-02T12:00:00.000Z' });
  await req(C, 'POST', `/api/task-timer/sessions/${sc}/void`, {});
  // 502 дээр managed: A 30 (хийсэн 10, цаг байхгүй), B 70 (хийгээгүй, цаггүй)
  await split(req, A, [[A, 30], [B, 70]], 0, 502);
  session(h.sqlite, { userId: A, taskId: 502, startedAt: '2026-10-02T07:00:00.000Z', endedAt: '2026-10-02T07:10:00.000Z' });
  await req(A, 'POST', '/api/tasks/502/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: pt(10) });
  const r = await req(B, 'GET', '/api/tasks/contributors?project_id=10');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t504 = r.json.tasks['504'];
  assert.equal(t504.length, 1); // зөвхөн A (B bookmark, C хүчингүй цаг)
  assert.equal(t504[0].user_id, A);
  assert.equal(t504[0].official_closed_ms, 3_600_000);
  assert.deepEqual(t504[0].evidence, ['time']);
  const t502 = r.json.tasks['502'];
  assert.deepEqual(t502.map((x: any) => [x.user_id, x.contributor, x.done_units, x.target_units]), [
    [A, true, pt(10), pt(30)],
    [B, false, 0, pt(70)], // хуваарилагдсан гэхдээ хувь нэмэрч БИШ (хийгээгүй, цаггүй)
  ]);
  assert.equal(r.json.managed['502'].root_done_units, pt(10));
  // Төслийн хүн × цаг: A = 1 цаг + 10 минут (502, 504), C байхгүй (хүчингүй)
  const people = r.json.people.map((p: any) => [p.user_id, p.official_closed_ms]);
  assert.deepEqual(people, [[A, 3_600_000 + 600_000]]);
  assert.equal(r.json.server_now.length > 10, true);
});

test('хувь нэмэрч: хуучин (managed биш) таскийн явц/оноо, baseline болон хуваалтын системийн бичлэг нотолгоо БИШ', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  legacyEntry(h.sqlite, { taskId: 504, userId: C, pct: 30, createdAt: '2026-09-20 09:00:00', points: { amount: 3, deltaPct: 3 } });
  h.sqlite.exec(`INSERT INTO progress_entries (task_id, user_id, percentage, date, status, is_baseline, source, created_at)
                 VALUES (504, ${ADMIN}, 40, '2026-09-21', 'approved', 1, 'web', '2026-09-21 09:00:00')`);
  h.sqlite.exec(`INSERT INTO progress_entries (task_id, user_id, percentage, date, status, source, created_at)
                 VALUES (504, ${SENIOR}, 100, '2026-09-22', 'approved', 'split', '2026-09-22 09:00:00')`);
  const r = await req(A, 'GET', '/api/tasks/contributors?project_id=10');
  const list = r.json.tasks['504'] as Array<{ user_id: number }>;
  assert.deepEqual(list.map((x) => x.user_id), [C]); // админ (baseline), ахлах (split) орохгүй
  const bad = await req(A, 'GET', '/api/tasks/contributors');
  assert.equal(bad.status, 400);
});

test('DELETE /tasks/:id: түүхтэй managed root 409 ROOT_PROTECTED (цэвэрлэгээнээс өмнө); түүхгүй бол устаж мөрүүд цэвэрлэгдэнэ', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  await split(req);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T08:00:00.000Z', endedAt: '2026-10-02T08:30:00.000Z' });
  await req(A, 'POST', '/api/tasks/501/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: pt(10) });
  const protectedDel = await req(SENIOR, 'DELETE', '/api/tasks/501');
  assert.equal(protectedDel.status, 409);
  assert.equal(protectedDel.json.error, 'ROOT_PROTECTED');
  assert.deepEqual(protectedDel.json.task_ids, [501]);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM tasks WHERE id = 501'), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_allocations'), 2);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), 1); // оноо хөндөгдөөгүй
  // Түүхгүй managed (502): устгагдаж, хуваарилалтын мөр цэвэрлэгдэнэ
  await split(req, A, [[A, 50], [B, 50]], 0, 502);
  const del = await req(SENIOR, 'DELETE', '/api/tasks/502');
  assert.equal(del.status, 200, JSON.stringify(del.json));
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM tasks WHERE id = 502'), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_allocations WHERE task_id = 502'), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots WHERE task_id = 502'), 0);
});

test('component/drawing/block устгах: түүхтэй managed root агуулсан бол 409, ямар ч цэвэрлэгээгүй', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  await split(req);
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T08:00:00.000Z', endedAt: '2026-10-02T08:30:00.000Z' });
  await req(A, 'POST', '/api/tasks/501/allocation/progress', { request_id: uid('p'), expected_revision: 1, done_units: pt(10) });
  for (const [path, label] of [['/api/components/1', 'component'], ['/api/drawings/1000', 'drawing'], ['/api/blocks/100', 'block']] as const) {
    const r = await req(SENIOR, 'DELETE', path);
    assert.equal(r.status, 409, label);
    assert.equal(r.json.error, 'ROOT_PROTECTED', label);
  }
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM components WHERE id = 1'), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM drawings WHERE id = 1000'), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM blocks WHERE id = 100'), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 1);
});

test('хуучин /split ХАСАГДСАН (410), /baseline нь managed таскт 409 MANAGED_ROOT', async () => {
  const h = makeDb();
  clockIn(h, [A]);
  const { req } = appFor(h);
  await split(req);
  const legacySplit = await req(A, 'POST', '/api/tasks/501/split', { weights: [5, 5] });
  assert.equal(legacySplit.status, 410);
  assert.equal(legacySplit.json.error, 'SPLIT_RETIRED');
  const baseline = await req(SENIOR, 'POST', '/api/tasks/501/baseline', { percentage: 20 });
  assert.equal(baseline.status, 409);
  assert.equal(baseline.json.error, 'MANAGED_ROOT');
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM tasks'), 5); // шинэ таск үүсээгүй
});

test('/my-tasks: managed таск allocation (revision, миний хэсэг) агуулна; хүчингүй цаг can_report-ыг үгүйсгэнэ', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  await split(req);
  const sid = session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-02T08:00:00.000Z', endedAt: '2026-10-02T09:00:00.000Z' });
  const my = await req(A, 'GET', '/api/progress/my-tasks');
  assert.equal(my.status, 200, JSON.stringify(my.json).slice(0, 300));
  const item = my.json.items.find((i: any) => i.id === 501);
  assert.ok(item, 'managed таск миний жагсаалтад');
  assert.equal(item.allocation.revision, 1);
  assert.equal(item.allocation.my.target_units, pt(40));
  assert.equal(item.allocation.my.future_units, pt(40));
  assert.equal(item.can_report, true);
  await req(A, 'POST', `/api/task-timer/sessions/${sid}/void`, {});
  const after = await req(A, 'GET', '/api/progress/my-tasks');
  const item2 = after.json.items.find((i: any) => i.id === 501);
  assert.equal(item2.can_report, false);
});

test('worker/client ба хэрэглэгчгүй хүсэлт: /allocation нь зөвхөн ажилтны үүрэгт (403)', async () => {
  const h = makeDb();
  const { app } = appFor(h);
  const env = { DB: h.d1 } as never;
  const exec = { waitUntil: () => undefined } as never;
  const noUser = await app.request('http://x/api/tasks/501/allocation', {}, env, exec);
  assert.equal(noUser.status, 403);
  for (const role of ['client', 'worker']) {
    const res = await app.request(
      'http://x/api/tasks/501/allocation',
      { headers: { 'x-test-user': JSON.stringify({ sub: 6, role }) } },
      env,
      exec,
    );
    assert.equal(res.status, 403, role);
    const post = await app.request(
      'http://x/api/tasks/501/allocation/split',
      {
        method: 'POST',
        headers: { 'x-test-user': JSON.stringify({ sub: 6, role }), 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: 'req-abcdefgh', expected_revision: 0, mode: 'total', targets: [] }),
      },
      env,
      exec,
    );
    assert.equal(post.status, 403, role);
  }
});

test('allocation-label (0393): админ/ахлах мөрийн нэрийг засна, contributors-д гарна, хоосон = root-ийн нэр, явц/оноо/revision хөндөгдөхгүй', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  const sp = await split(req);
  assert.equal(sp.status, 200);
  const rev = rows(h.sqlite, 'SELECT revision FROM task_roots WHERE task_id = 501')[0].revision;
  const before = rows(h.sqlite, 'SELECT COUNT(*) AS n FROM user_points')[0].n;

  // Админ засна.
  const ok = await req(ADMIN, 'PUT', '/api/tasks/501/allocation-label', { user_id: B, label: '  Дулааны   тооцоо ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.label, 'Дулааны тооцоо');
  const list = await req(A, 'GET', '/api/tasks/contributors?project_id=10');
  const mine = (list.json.tasks['501'] as Array<{ user_id: number; label: string | null }>);
  assert.equal(mine.find((r) => r.user_id === B)?.label, 'Дулааны тооцоо');
  assert.equal(mine.find((r) => r.user_id === A)?.label, null);

  // Ахлах мөн засна; хоосон = null.
  const clr = await req(SENIOR, 'PUT', '/api/tasks/501/allocation-label', { user_id: B, label: '   ' });
  assert.equal(clr.status, 200);
  assert.equal(clr.json.label, null);

  // Өөрчлөлтийн дараа split-ийн CAS, оноо, revision хэвээр; шинэ мөрийн нэр хадгалагдсан хэвээр (UPDATE-аар засагдсан тул).
  await req(ADMIN, 'PUT', '/api/tasks/501/allocation-label', { user_id: A, label: 'Зураг' });
  assert.equal(rows(h.sqlite, 'SELECT revision FROM task_roots WHERE task_id = 501')[0].revision, rev);
  assert.equal(rows(h.sqlite, 'SELECT COUNT(*) AS n FROM user_points')[0].n, before);
  const re = await split(req, A, [[A, 50], [B, 50]], rev);
  assert.equal(re.status, 200);
  assert.equal(rows(h.sqlite, 'SELECT label FROM task_allocations WHERE task_id = 501 AND user_id = 3')[0].label, 'Зураг');
});

test('allocation-label (2026-10-08, 2 дахь шийдвэр): engineer ӨӨРИЙН БА БУСДЫН мөрийг засна, worker/client 403, буруу оролт 400, хуваарилалтгүй хүн 404, хэт урт 400', async () => {
  const h = makeDb();
  const { req } = appFor(h);
  await split(req);
  // Engineer өөрийн (A) мөрийг засна.
  const own = await req(A, 'PUT', '/api/tasks/501/allocation-label', { user_id: A, label: 'x' });
  assert.equal(own.status, 200);
  assert.equal(own.json.label, 'x');
  // Engineer бусдын (B) мөрийг ч засна — эзний 2026-10-08-ны 2 дахь шийдвэр: «ажилтан хэн ч хэнийг ч нэрлэж болно».
  const other = await req(A, 'PUT', '/api/tasks/501/allocation-label', { user_id: B, label: 'y' });
  assert.equal(other.status, 200);
  assert.equal(other.json.label, 'y');
  assert.equal((await req(ADMIN, 'PUT', '/api/tasks/501/allocation-label', { label: 'x' })).status, 400);
  assert.equal((await req(ADMIN, 'PUT', '/api/tasks/501/allocation-label', { user_id: A, label: 5 })).status, 400);
  assert.equal((await req(ADMIN, 'PUT', '/api/tasks/501/allocation-label', { user_id: A, label: 'я'.repeat(121) })).status, 400);
  assert.equal((await req(ADMIN, 'PUT', '/api/tasks/501/allocation-label', { user_id: C, label: 'x' })).status, 404);

  // worker/client ямар ч мөрийг засаж чадахгүй (403) — ажилтны ролиудаас гадуур.
  const { app } = appFor(h);
  const env = { DB: h.d1 } as never;
  const exec = { waitUntil: () => undefined } as never;
  for (const role of ['client', 'worker']) {
    const res = await app.request(
      'http://x/api/tasks/501/allocation-label',
      {
        method: 'PUT',
        headers: { 'x-test-user': JSON.stringify({ sub: 6, role }), 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: A, label: 'z' }),
      },
      env,
      exec,
    );
    assert.equal(res.status, 403, role);
  }
});
