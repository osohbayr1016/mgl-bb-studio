// Таскийг ҮНДСЭН таскууд болгон хуваах + буцаах (0395, эзэн 2026-10-09) — БОДИТ SQLite + бодит миграц дээр HTTP урсгал.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { actorOf, legacyEntry, makeDb, rows, session, sum, uid, USERS } from '../../test-support/allocHarness.ts';

const taskRootSplit = (await import('./taskRootSplit.ts')).default;
const taskAllocations = (await import('./taskAllocations.ts')).default;
const tasksRoute = (await import('./tasks.ts')).default;
const { applyParts } = await import('../lib/taskRootOps.ts');
const { planRootSplit, sharesToWeights } = await import('../lib/taskRootSplit.ts');

const pt = (p: number) => Math.round(p * 10_000);
const { A, B, C, SENIOR } = USERS;

function setup() {
  const h = makeDb();
  for (const f of ['0386_task_retractions.sql', '0387_task_unsplits.sql', '0395_task_root_splits.sql']) {
    h.sqlite.exec(readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8'));
  }
  const env = { DB: h.d1 } as unknown as Record<string, unknown>;
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/tasks', taskAllocations as never);
  app.route('/api/tasks', taskRootSplit as never);
  app.route('/api/tasks', tasksRoute as never);
  const exec = { waitUntil: () => undefined, passThroughOnException: () => undefined };
  const req = async (user: number | { sub: number; role: string }, method: string, path: string, body?: unknown) => {
    const actor = typeof user === 'number' ? actorOf(user) : user;
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
  return { h, req };
}

type Req = ReturnType<typeof setup>['req'];
const split = (req: Req, user: number, taskId: number, parts: Array<{ name: string; share: number }>, requestId = uid('rs')) =>
  req(user, 'POST', `/api/tasks/${taskId}/root-split`, {
    request_id: requestId,
    parts: parts.map((p) => ({ name: p.name, share_units: pt(p.share) })),
  });
const undo = (req: Req, user: number, splitId: number, requestId = uid('undo')) =>
  req(user, 'POST', `/api/tasks/root-splits/${splitId}/undo`, { request_id: requestId });

const task = (h: ReturnType<typeof makeDb>, id: number) =>
  h.sqlite.prepare('SELECT id, name, weight_percent, sort_order FROM tasks WHERE id = ?').get(id) as
    | { id: number; name: string; weight_percent: number; sort_order: number }
    | undefined;
const latestPct = (h: ReturnType<typeof makeDb>, id: number) =>
  sum(h.sqlite, `SELECT percentage AS v FROM progress_entries WHERE task_id = ? AND status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 1`, id);
/** Компонент 1-ийн Σ жин × хувь (төслийн явцын хэмжүүр). */
const earned = (h: ReturnType<typeof makeDb>) =>
  rows<{ id: number; weight_percent: number }>(h.sqlite, 'SELECT id, weight_percent FROM tasks WHERE component_id = 1').reduce(
    (s, t) => s + (t.weight_percent * latestPct(h, t.id)) / 100,
    0,
  );

test('цэвэр дүрэм: хувийг жинд хувиргахад нийлбэр ЯГ хадгалагдана; явцгүй ≥2, явцтай ≥1 хэсэг', () => {
  assert.deepEqual(sharesToWeights(10, [pt(60), pt(40)]), [6, 4]);
  const w = sharesToWeights(10, [pt(100 / 3), pt(100 / 3), pt(100 / 3) + 1]);
  assert.equal(Math.round(w.reduce((a, b) => a + b, 0) * 100), 1000);
  assert.equal(planRootSplit(10, 0, [{ name: 'а', share_units: pt(100) }]).ok, false);
  const r = planRootSplit(20, 30, [{ name: 'а', share_units: pt(100) }]);
  assert.ok(r.ok && r.mode === 'remainder' && Math.abs(r.doneWeight - 6) < 1e-9 && r.weights[0] === 14);
  const bad = planRootSplit(10, 0, [{ name: ' ', share_units: pt(50) }, { name: 'б', share_units: pt(50) }]);
  assert.equal(bad.ok === false && bad.code, 'EMPTY_NAME');
  const sumBad = planRootSplit(10, 0, [{ name: 'а', share_units: pt(50) }, { name: 'б', share_units: pt(40) }]);
  assert.equal(sumBad.ok === false && sumBad.code, 'SUM_MISMATCH');
});

test('явцгүй таск: эх таск = эхний хэсэг (нэр, жин), шинэ таск нь шууд ард нь; журнал + гишүүд; replay', async () => {
  const { h, req } = setup();
  const rid = uid('rs');
  const r = await split(req, A, 501, [{ name: 'Фасад — хойд', share: 60 }, { name: 'Фасад — урд', share: 40 }], rid);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.mode, 'whole');
  assert.equal(r.json.parts.length, 2);
  assert.equal(r.json.parts[0].task_id, 501);
  const newId = r.json.parts[1].task_id;
  assert.deepEqual({ ...task(h, 501) }, { id: 501, name: 'Фасад — хойд', weight_percent: 6, sort_order: 10 });
  assert.equal(task(h, newId)?.name, 'Фасад — урд');
  assert.equal(task(h, newId)?.weight_percent, 4);
  assert.equal(task(h, newId)?.sort_order, 20);
  assert.equal(task(h, 502)?.sort_order, 30);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_root_split_members WHERE split_id = ?', r.json.split_id), 2);
  // Ижил request_id → анхны үр дүн, давхар таск үүсэхгүй.
  const again = await split(req, A, 501, [{ name: 'x', share: 50 }, { name: 'y', share: 50 }], rid);
  assert.equal(again.status, 200);
  assert.equal(again.json.replayed, true);
  assert.equal(sum(h.sqlite, "SELECT COUNT(*) AS v FROM tasks WHERE component_id = 1"), 5);
  // GET: шинэ таск дээрээс буцааж болно.
  const info = await req(B, 'GET', `/api/tasks/${newId}/root-split`);
  assert.equal(info.status, 200);
  assert.equal(info.json.last_split.id, r.json.split_id);
  assert.equal(info.json.last_split.undoable, true);
});

test('шалгалт: буруу оролт 400, цагаар бодогддог төсөл / дууссан таск 409, worker 403', async () => {
  const { h, req } = setup();
  assert.equal((await split(req, A, 501, [{ name: 'а', share: 100 }])).json.error, 'TOO_FEW');
  assert.equal((await split(req, A, 501, [{ name: 'а', share: 50 }, { name: 'б', share: 40 }])).json.error, 'SUM_MISMATCH');
  assert.equal((await split(req, A, 501, [{ name: '', share: 50 }, { name: 'б', share: 50 }])).json.error, 'EMPTY_NAME');
  assert.equal((await split(req, A, 601, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }])).json.error, 'HOURS_MODE');
  assert.equal((await split(req, A, 503, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }])).json.error, 'NOT_SPLITTABLE');
  legacyEntry(h.sqlite, { taskId: 504, userId: A, pct: 100, createdAt: '2026-10-01 10:00:00' });
  assert.equal((await split(req, A, 504, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }])).json.error, 'TASK_COMPLETED');
  const w = await req({ sub: 77, role: 'worker' }, 'POST', '/api/tasks/501/root-split', { request_id: uid('rs'), parts: [] });
  assert.equal(w.status, 403);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_root_splits'), 0);
});

test('явцтай таск: хийгдсэн хэсэг 100%-аар хаагдаж, үлдсэн нь шинэ таскууд — төслийн явц ЯГ хэвээр, цаг эхний хэсэг рүү', async () => {
  const { h, req } = setup();
  legacyEntry(h.sqlite, { taskId: 502, userId: B, pct: 30, createdAt: '2026-10-01 10:00:00' });
  session(h.sqlite, { userId: B, taskId: 502, startedAt: new Date(Date.now() - 60_000).toISOString() });
  h.sqlite.prepare(`INSERT INTO task_personal_list (user_id, task_id) VALUES (?, 502)`).run(B);
  const before = earned(h);
  const r = await split(req, B, 502, [{ name: 'План — 1-р давхар', share: 50 }, { name: 'План — 2-р давхар', share: 50 }]);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.mode, 'remainder');
  assert.equal(r.json.done.task_id, 502);
  assert.equal(task(h, 502)?.name, 'План (хийгдсэн 30%)');
  assert.ok(Math.abs((task(h, 502)?.weight_percent ?? 0) - 6) < 1e-9);
  assert.equal(latestPct(h, 502), 100);
  const [p0, p1] = r.json.parts.map((p: any) => p.task_id);
  assert.equal(task(h, p0)?.weight_percent, 7);
  assert.equal(task(h, p1)?.weight_percent, 7);
  assert.ok(Math.abs(earned(h) - before) < 1e-9, `${earned(h)} vs ${before}`);
  // B-ийн цаг: хуучин нь хаагдаж, эхний хэсэг дээр үргэлжилнэ.
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE task_id = 502 AND ended_at IS NULL'), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE task_id = ? AND user_id = ? AND ended_at IS NULL', p0, B), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_personal_list WHERE task_id = ? AND user_id = ?', p0, B), 1);

  // Буцаах: шинэ таскууд устаж, эх таск анхны нэр/жин/явцад; цаг, жагсаалт эх таск руу.
  const u = await undo(req, A, r.json.split_id);
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal(u.json.removed_tasks, 2);
  assert.deepEqual({ name: task(h, 502)?.name, w: task(h, 502)?.weight_percent }, { name: 'План', w: 20 });
  assert.equal(latestPct(h, 502), 30);
  assert.equal(task(h, p0), undefined);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE task_id = 502 AND user_id = ? AND ended_at IS NULL', B), 1);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE task_id IN (?, ?)', p0, p1), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_personal_list WHERE task_id = 502 AND user_id = ?', B), 1);
  assert.ok(Math.abs(earned(h) - before) < 1e-9);
  // Дахин буцаах → 409, өөр request_id-аар.
  assert.equal((await undo(req, A, r.json.split_id)).json.error, 'ALREADY_UNDONE');
});

test('буцаах хаагдана: шинэ таск дээр хувь оруулсан, эсвэл эх таск дээр хуваасны дараа хувь орсон', async () => {
  const { h, req } = setup();
  const r = await split(req, A, 501, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }]);
  const newId = r.json.parts[1].task_id;
  legacyEntry(h.sqlite, { taskId: newId, userId: A, pct: 20, createdAt: '2026-10-09 10:00:00' });
  const info = await req(A, 'GET', '/api/tasks/501/root-split');
  assert.equal(info.json.last_split.undoable, false);
  assert.match(info.json.last_split.blocked_message, /хувь оруулсан/);
  const u = await undo(req, A, r.json.split_id);
  assert.equal(u.status, 409);
  assert.equal(u.json.error, 'UNDO_BLOCKED');
  assert.equal(u.json.blockers[0].code, 'HAS_PROGRESS');
  assert.ok(task(h, newId));

  const r2 = await split(req, A, 502, [{ name: 'в', share: 50 }, { name: 'г', share: 50 }]);
  legacyEntry(h.sqlite, { taskId: 502, userId: A, pct: 10, createdAt: '2026-10-09 11:00:00' });
  const u2 = await undo(req, A, r2.json.split_id);
  assert.equal(u2.json.error, 'UNDO_BLOCKED');
  assert.equal(u2.json.blockers[0].code, 'ORIGINAL_PROGRESS');
});

test('явцгүй хуваалтыг буцаах: эх таск 10, шинэ таск устна, түүн дээрх цаг эх таск руу', async () => {
  const { h, req } = setup();
  const r = await split(req, A, 501, [{ name: 'а', share: 30 }, { name: 'б', share: 30 }, { name: 'в', share: 40 }]);
  const ids = r.json.parts.map((p: any) => p.task_id);
  session(h.sqlite, { userId: C, taskId: ids[2], startedAt: '2026-10-09T01:00:00.000Z', endedAt: '2026-10-09T02:00:00.000Z' });
  const u = await undo(req, B, r.json.split_id);
  assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.deepEqual({ name: task(h, 501)?.name, w: task(h, 501)?.weight_percent }, { name: 'Фасад', w: 10 });
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM tasks WHERE component_id = 1'), 4);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE task_id = 501 AND user_id = ?', C), 1);
  // Буцаасны дараа дахин хувааж болно.
  assert.equal((await split(req, A, 501, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }])).status, 201);
});

test('хүнгүй хэсэгтэй таск (0394): цонх хэсгүүдээр урьдчилан бөглөгдөнө, хуваахад хэсгүүд үндсэн таскууд болно', async () => {
  const { h, req } = setup();
  const made = await applyParts({ db: h.d1 }, actorOf(A), {
    taskId: 501,
    requestId: uid('parts'),
    expectedRevision: 0,
    parts: [{ id: null, label: 'суурь', units: pt(40) }, { id: null, label: 'тоноглол', units: pt(35) }],
  });
  assert.equal(made.ok, true);
  const info = await req(A, 'GET', '/api/tasks/501/root-split');
  assert.equal(info.status, 200);
  assert.equal(info.json.can_split, true, JSON.stringify(info.json.block));
  assert.deepEqual(
    info.json.prefill.map((p: any) => [p.name, p.share_units]),
    [['суурь', pt(40)], ['тоноглол', pt(35)], ['Фасад', pt(25)]],
  );
  const r = await req(A, 'POST', '/api/tasks/501/root-split', { request_id: uid('rs'), parts: info.json.prefill });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.deepEqual(r.json.parts.map((p: any) => [p.name, p.weight_percent]), [['суурь', 4], ['тоноглол', 3.5], ['Фасад', 2.5]]);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots WHERE task_id = 501'), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_parts'), 0);
});

test('хүнд хуваарилагдсан таск → 409 HAS_ALLOCATIONS; өөр хүн ажиллаж буй таскийг ажилтан хуваахгүй, ахлах хуваана', async () => {
  const { h, req } = setup();
  const s = await req(SENIOR, 'POST', '/api/tasks/501/allocation/split', {
    request_id: uid('s'),
    expected_revision: 0,
    mode: 'total',
    targets: [{ user_id: A, target_units: pt(50) }, { user_id: B, target_units: pt(50) }],
  });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const blocked = await split(req, A, 501, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }]);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error, 'HAS_ALLOCATIONS');

  session(h.sqlite, { userId: C, taskId: 504, startedAt: new Date(Date.now() - 60_000).toISOString() });
  const occ = await split(req, A, 504, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }]);
  assert.equal(occ.json.error, 'TASK_OCCUPIED');
  const ok = await split(req, SENIOR, 504, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }]);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  // Явцгүй хуваалт: C эх таск (эхний хэсэг) дээр үргэлжилнэ.
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_timer_sessions WHERE task_id = 504 AND user_id = ? AND ended_at IS NULL', C), 1);
  assert.equal(sum(h.sqlite, "SELECT COUNT(*) AS v FROM notifications WHERE user_id = ? AND type = 'task_assigned'", C), 1);
});

test('✂ хэсгийг устгахад жин эх таск руу буцна (2026-10-12): 2.77 → 1.39 + 1.38 → хуулбар устгавал 2.77, бүлгийн нийлбэр хэвээр', async () => {
  const { h, req } = setup();
  const { ADMIN } = USERS;
  h.sqlite.prepare('UPDATE tasks SET weight_percent = 2.77 WHERE id = 501').run();
  const total = () => sum(h.sqlite, 'SELECT ROUND(SUM(weight_percent), 4) AS v FROM tasks WHERE component_id = 1');
  const before = total();
  const r = await split(req, A, 501, [{ name: '4-р давхар /тааз/', share: 50 }, { name: '4-р давхар /тааз/2', share: 50 }]);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const copy = r.json.parts[1].task_id;
  const near = (a: number | undefined, b: number) => assert.ok(Math.abs((a ?? NaN) - b) < 1e-9, `${a} ≠ ${b}`);
  near(task(h, 501)?.weight_percent, 1.39);
  near(task(h, copy)?.weight_percent, 1.38);

  // Урьдчилан харах: жин + буцах таск.
  const pv = await req(ADMIN, 'GET', `/api/tasks/${copy}/delete-preview`);
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  assert.deepEqual(pv.json.weight_merged_into, { id: 501, name: '4-р давхар /тааз/' });
  near(pv.json.weight, 1.38);
  assert.equal((await req(A, 'GET', `/api/tasks/${copy}/delete-preview`)).status, 403);

  const d = await req(ADMIN, 'DELETE', `/api/tasks/${copy}`);
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(d.json.weight_merged_into.id, 501);
  near(d.json.weight_merged_into.weight, 1.38);
  assert.equal(task(h, copy), undefined);
  assert.equal(task(h, 501)?.weight_percent, 2.77);
  assert.equal(total(), before);
  // Давтан устгалт жинг дахин нэмэхгүй.
  await req(ADMIN, 'DELETE', `/api/tasks/${copy}`);
  assert.equal(task(h, 501)?.weight_percent, 2.77);
  // Устгасан гишүүнтэй хуваалтыг буцаах боломжгүй (MISSING) — жин аль хэдийн эх таск дээр.
  assert.equal((await undo(req, A, r.json.split_id)).status, 409);
});

test('✂ хэсгийг устгах: эх таскийг устгавал жин дараагийн хэсэг рүү; 3 хэсгээс хоёрыг устгавал нийт хэвээр', async () => {
  const { h, req } = setup();
  const { ADMIN } = USERS;
  const total = () => sum(h.sqlite, 'SELECT ROUND(SUM(weight_percent), 4) AS v FROM tasks WHERE component_id = 1');
  const before = total();
  const r = await split(req, A, 501, [{ name: 'а', share: 30 }, { name: 'б', share: 30 }, { name: 'в', share: 40 }]);
  const [a, b, c] = r.json.parts.map((p: any) => p.task_id);
  assert.equal(a, 501);
  // Эх таск (а) устгавал жин нь «б» руу (эх таск байхгүй үед эхний байрлал).
  assert.equal((await req(SENIOR, 'DELETE', `/api/tasks/${a}`)).json.weight_merged_into.id, b);
  assert.equal(task(h, b)?.weight_percent, 6);
  // «в» устгавал жин нь үлдсэн ганц хэсэг «б» руу.
  assert.equal((await req(SENIOR, 'DELETE', `/api/tasks/${c}`)).json.weight_merged_into.id, b);
  assert.equal(task(h, b)?.weight_percent, 10);
  assert.equal(total(), before);
  // Сүүлийн хэсэг — өв залгагчгүй, жин төслөөс хасагдана (энгийн устгалт).
  const last = await req(SENIOR, 'DELETE', `/api/tasks/${b}`);
  assert.equal(last.json.weight_merged_into, null);
  assert.equal(total(), before - 10);
});

test('✂ хэсгийг устгах: явцтай хуваалтын «хийгдсэн хэсэг» жин авахгүй (явц хуурамчаар өсөхгүй); буцаасан хуваалт, энгийн таск — өв залгагчгүй', async () => {
  const { h, req } = setup();
  const { ADMIN } = USERS;
  legacyEntry(h.sqlite, { taskId: 502, userId: B, pct: 30, createdAt: '2026-10-01 10:00:00' });
  const r = await split(req, B, 502, [{ name: 'х1', share: 50 }, { name: 'х2', share: 50 }]);
  assert.equal(r.json.mode, 'remainder');
  const [p0, p1] = r.json.parts.map((p: any) => p.task_id);
  const before = earned(h);
  const d = await req(ADMIN, 'DELETE', `/api/tasks/${p1}`);
  assert.equal(d.json.weight_merged_into.id, p0);
  assert.ok(Math.abs((task(h, 502)?.weight_percent ?? 0) - 6) < 1e-9, 'хийгдсэн хэсгийн жин хөдлөхгүй');
  assert.equal(task(h, p0)?.weight_percent, 14);
  assert.ok(Math.abs(earned(h) - before) < 1e-9);
  // Буцаасан хуваалт: гишүүнчлэл тооцогдохгүй.
  const r2 = await split(req, A, 501, [{ name: 'а', share: 50 }, { name: 'б', share: 50 }]);
  await undo(req, A, r2.json.split_id);
  assert.equal((await req(ADMIN, 'GET', '/api/tasks/501/delete-preview')).json.weight_merged_into, null);
  // Энгийн (хуваагаагүй) таск.
  assert.equal((await req(ADMIN, 'DELETE', '/api/tasks/504')).json.weight_merged_into, null);
});
