// Хуучин бүлгийг хуваарилалт (managed root) руу хөрвүүлэх — БОДИТ SQLite + бодит миграц (0376–0385) дээр (2026-10-05).
// Баталгаажуулах: (1) төслийн явц, оноо, түүх, график ХЭВЭЭР; (2) ангилал (нотолгооны түвшин) ба хориглох шалтгаан;
// (3) идемпотент, хуучирсан төлөвлөгөө, атом (дундаас унавал юу ч бичигдэхгүй); (4) буцаалт; (5) хуучин замуудын хаалт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, actorOf, legacyEntry, makeDb, rows, session, sum, uid } from '../../test-support/allocHarness.ts';

const Conv = await import('./taskConversion.ts');
const Plan = await import('./taskConversionPlan.ts');
const Audit = await import('./taskAllocAudit.ts');
const Ops = await import('./taskRootOps.ts');
const Progress = await import('../routes/progress.ts');
const Series = await import('./progressTimeseries.ts');
const Users = await import('../routes/users.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B, C, ADMIN, SENIOR } = USERS;

type H = ReturnType<typeof makeDb>;
const NOW = Date.parse('2026-10-05T10:00:00Z');
const ctx = (h: H, nowMs = NOW) => ({ db: h.d1, nowMs, today: '2026-10-05' });
const admin = actorOf(ADMIN);

/**
 * Хуучин бүлэг: 501 (w10, A), 502 (w20, B), 504 (w10, C) — нэг зураг, жингийн нийлбэр 40.
 *   501: A 20% (09-10) → 50% (09-12)      502: B 30% (09-11)      504: C 60% (09-13) → 100% (09-15)
 * Төслийн явц (нэг зургийн жигнэсэн) = 10×.5 + 20×.3 + 10×1 = 21.
 */
function legacyGroup(h: H) {
  legacyEntry(h.sqlite, { taskId: 501, userId: A, pct: 20, createdAt: '2026-09-10 10:00:00', points: { amount: 2, deltaPct: 2 } });
  legacyEntry(h.sqlite, { taskId: 501, userId: A, pct: 50, createdAt: '2026-09-12 10:00:00', points: { amount: 3, deltaPct: 3 } });
  legacyEntry(h.sqlite, { taskId: 502, userId: B, pct: 30, createdAt: '2026-09-11 10:00:00', points: { amount: 6, deltaPct: 6 } });
  legacyEntry(h.sqlite, { taskId: 504, userId: C, pct: 60, createdAt: '2026-09-13 10:00:00', points: { amount: 6, deltaPct: 6 } });
  legacyEntry(h.sqlite, { taskId: 504, userId: C, pct: 100, createdAt: '2026-09-15 10:00:00', points: { amount: 4, deltaPct: 4 } });
  h.sqlite.prepare("UPDATE tasks SET due_date = '2026-10-20', start_date = '2026-09-01' WHERE id IN (502, 504)").run();
}
const GROUP = [501, 502, 504];

async function previewOk(h: H, extra: Partial<Parameters<typeof Conv.previewConversion>[1]> = {}) {
  const r = await Conv.previewConversion(h.d1, { taskIds: GROUP, nowMs: NOW, today: '2026-10-05', ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) throw new Error('unreachable');
  return r.data;
}

async function convert(h: H, over: Partial<Parameters<typeof Conv.applyConversion>[2]> = {}) {
  const pv = await previewOk(h, { rootTaskId: over.rootTaskId ?? null, futureOwners: over.futureOwners });
  assert.ok(pv.plan_hash, JSON.stringify(pv.plan_failure ?? pv.classification));
  return Conv.applyConversion(ctx(h), admin, {
    taskIds: GROUP,
    requestId: uid('conv'),
    planHash: pv.plan_hash!,
    reason: 'тест: бүлгийг нэгтгэв',
    confirmAmbiguous: true,
    nowMs: NOW,
    today: '2026-10-05',
    ...over,
  });
}

const snapshot = (h: H) => ({
  tasks: rows(h.sqlite, 'SELECT id, name, weight_percent, due_date, start_date FROM tasks ORDER BY id'),
  points: rows(h.sqlite, 'SELECT id, user_id, task_id, amount, delta_pct, awarded_at, source FROM user_points ORDER BY id'),
  entries: rows(h.sqlite, 'SELECT id, task_id, user_id, percentage, date, created_at, source FROM progress_entries ORDER BY id'),
});

const near = (a: number, b: number, msg: string, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} ≠ ${b}`);

/* ------------------------------------------------------------------ */
/*  Цэвэр дүрэм                                                         */
/* ------------------------------------------------------------------ */

test('parseSplitName / groupByNamePattern: бүрэн, давхардалгүй 1..N л нэр дэвшигч (нэр нь НОТОЛГОО БИШ)', () => {
  assert.deepEqual(Plan.parseSplitName('Фасад (2/3)'), { base: 'Фасад', index: 2, count: 3 });
  assert.equal(Plan.parseSplitName('Фасад (4/3)'), null);
  assert.equal(Plan.parseSplitName('(1/2)'), null);
  assert.equal(Plan.parseSplitName('Фасад'), null);
  const rows = [
    { id: 1, drawingId: 9, componentId: 1, name: 'Фасад (1/2)', sortOrder: 1 },
    { id: 2, drawingId: 9, componentId: 1, name: 'Фасад (2/2)', sortOrder: 2 },
    { id: 3, drawingId: 9, componentId: 1, name: 'План (1/3)', sortOrder: 3 }, // дутуу
    { id: 4, drawingId: 9, componentId: 1, name: 'План (2/3)', sortOrder: 4 },
    { id: 5, drawingId: 8, componentId: 2, name: 'Огтлол (1/2)', sortOrder: 1 }, // өөр зураг дээр дутуу
    { id: 6, drawingId: 9, componentId: 1, name: 'Дүрс (1/2)', sortOrder: 5 },
    { id: 7, drawingId: 9, componentId: 1, name: 'Дүрс (1/2)', sortOrder: 6 }, // давхардсан
  ];
  const g = Plan.groupByNamePattern(rows);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0]!.taskIds, [1, 2]);
});

test('planConversion: нэгж хэвээр — Σ T + B + U = 100%, root = Σ wⱼpⱼ/W, 100%-ийн хэсэг ЯГ Tⱼ (1 нэгжийн үлдэгдэл үгүй)', () => {
  const mk = (taskId: number, weight: number, pct: number): import('./taskConversionPlan.ts').MemberInput => ({
    taskId, name: `t${taskId}`, weight, sortOrder: taskId, componentId: 1, drawingId: 1, dueDate: null, startDate: null,
    lastEntryId: taskId, lastPointsId: 0,
    entries: pct > 0 ? [{ id: taskId, userId: 3, creditUserId: null, isBaseline: false, source: 'web', units: pt(pct) }] : [],
    credits: [], timeline: pct > 0 ? [{ id: taskId, date: '2026-09-01', createdAt: '2026-09-01 10:00:00', units: pt(pct) }] : [],
    runningTimerUsers: [], managed: false, retired: false,
  });
  // 3 тэнцүү жин: 1e6 / 3 — тэгшилэхгүй, дугуйлалтын үлдэгдэл бий
  const members = [mk(1, 10, 100), mk(2, 10, 50), mk(3, 10, 0)];
  const plan = Plan.planConversion({
    members, rootTaskId: 1, nowMs: NOW, today: '2026-10-05', lastRootCreatedAt: null,
    facts: { projectId: 1, projectStatus: 'active', progressMode: 'tasks', drawingWeight: 100, blockWeight: 100, teamShare: 100, evidence: 'declared_group' },
  });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  if (!plan.ok) return;
  const sumT = plan.members.reduce((s, m) => s + m.targetUnits, 0);
  assert.equal(sumT, 1_000_000);
  assert.equal(plan.members[0]!.doneUnits, plan.members[0]!.targetUnits, '100% хэсэг = T (1 нэгж үлдэхгүй)');
  assert.equal(plan.unallocatedUnits + plan.unattributedUnits + plan.allocations.reduce((s, a) => s + a.targetUnits, 0), 1_000_000);
  assert.ok(Math.abs(plan.rollup.delta) <= (plan.rollup.toleranceUnits * plan.weight) / 1_000_000 + 1e-9);
  near(plan.weight, 30, 'W');
});

test('classifyGroup: already_managed / organizational (өөр зураг, нэг гишүүн, жингүй) / proven / ambiguous + хориглох шалтгаан', () => {
  const m = (taskId: number, o: Partial<import('./taskConversionPlan.ts').MemberInput> = {}): import('./taskConversionPlan.ts').MemberInput => ({
    taskId, name: `t${taskId}`, weight: 10, sortOrder: taskId, componentId: 1, drawingId: 1, dueDate: null, startDate: null,
    lastEntryId: 0, lastPointsId: 0, entries: [], credits: [], timeline: [], runningTimerUsers: [], managed: false, retired: false, ...o,
  });
  const facts = (evidence: 'declared_group' | 'name_pattern' | 'manual', o: Partial<import('./taskConversionPlan.ts').GroupFacts> = {}) => ({
    projectId: 1, projectStatus: 'active', progressMode: 'tasks', drawingWeight: 100, blockWeight: 100, teamShare: 100, evidence, ...o,
  });
  assert.equal(Plan.classifyGroup([m(1, { managed: true }), m(2)], facts('declared_group')).classification, 'already_managed');
  assert.equal(Plan.classifyGroup([m(1, { retired: true }), m(2)], facts('declared_group')).classification, 'already_managed');
  assert.deepEqual(Plan.classifyGroup([m(1)], facts('declared_group')).blockers, ['SINGLE_MEMBER']);
  assert.deepEqual(Plan.classifyGroup([m(1), m(2, { drawingId: 2 })], facts('declared_group')).blockers, ['DIFFERENT_DRAWINGS']);
  assert.deepEqual(Plan.classifyGroup([m(1), m(2, { weight: 0 })], facts('declared_group')).blockers, ['ZERO_WEIGHT_MEMBER']);
  const proven = Plan.classifyGroup([m(1), m(2)], facts('declared_group'));
  assert.equal(proven.classification, 'proven_split');
  assert.equal(proven.convertible, true);
  assert.equal(Plan.needsExplicitConfirmation(proven), false);
  const amb = Plan.classifyGroup([m(1), m(2)], facts('name_pattern'));
  assert.equal(amb.classification, 'ambiguous');
  assert.equal(Plan.needsExplicitConfirmation(amb), true);
  assert.ok(Plan.classifyGroup([m(1), m(2)], facts('manual', { projectStatus: 'archived' })).blockers.includes('PROJECT_INACTIVE'));
  assert.ok(Plan.classifyGroup([m(1), m(2)], facts('manual', { progressMode: 'hours' })).blockers.includes('HOURS_MODE'));
  assert.ok(Plan.classifyGroup([m(1, { runningTimerUsers: [3] }), m(2)], facts('manual')).blockers.includes('RUNNING_TIMER'));
  const done = (id: number) => m(id, { entries: [{ id, userId: 3, creditUserId: null, isBaseline: false, source: 'web', units: pt(100) }] });
  assert.ok(Plan.classifyGroup([done(1), done(2)], facts('manual')).blockers.includes('ALL_DONE'));
  assert.ok(Plan.classifyGroup(Array.from({ length: 13 }, (_, i) => m(i + 1)), facts('manual')).blockers[0]!.startsWith('TOO_MANY_MEMBERS'));
});

/* ------------------------------------------------------------------ */
/*  Preview                                                             */
/* ------------------------------------------------------------------ */

test('preview: юу ч бичихгүй, төлөвлөгөө тогтвортой хэш, тоо зөв (T/D/B/U, эзэмшил нотолгоотой л)', async () => {
  const h = makeDb();
  legacyGroup(h);
  const before = JSON.stringify(snapshot(h));
  const pv = await previewOk(h);
  assert.equal(JSON.stringify(snapshot(h)), before, 'preview өгөгдөл хөндөхгүй');
  assert.equal(pv.evidence, 'manual');
  assert.equal(pv.classification.classification, 'ambiguous');
  assert.equal(pv.needs_confirmation, true);
  const plan = pv.plan!;
  near(plan.weight, 40, 'W');
  assert.equal(plan.rootTaskId, 501);
  // T = 25% / 50% / 25%; D = 12.5% / 15% / 25% → root 52.5%
  assert.deepEqual(plan.members.map((m) => m.targetUnits), [pt(25), pt(50), pt(25)]);
  assert.deepEqual(plan.members.map((m) => m.doneUnits), [pt(12.5), pt(15), pt(25)]);
  assert.equal(plan.rootDoneUnits, pt(52.5));
  assert.equal(plan.unattributedUnits, 0);
  assert.equal(plan.unallocatedUnits, pt(47.5)); // ирээдүйн ажил — ЭЗЭНГҮЙ (U), хүнд ХЭЗЭЭ Ч оноохгүй
  assert.deepEqual(plan.allocations.map((a) => [a.userId, a.doneUnits, a.targetUnits]), [[A, pt(12.5), pt(12.5)], [B, pt(15), pt(15)], [C, pt(25), pt(25)]]);
  near(plan.rollup.before, 21, 'өмнөх жигнэсэн явц');
  near(plan.rollup.after, 21, 'хойдох жигнэсэн явц');
  assert.equal(plan.seedAttribution, 'clean');
  assert.equal(plan.slices.length, 5); // хуучин оноо мөр бүр нэг слайс
  const again = await previewOk(h);
  assert.equal(again.plan_hash, pv.plan_hash);
  // өөр root → өөр хэш
  const other = await previewOk(h, { rootTaskId: 502 });
  assert.notEqual(other.plan_hash, pv.plan_hash);
});

test('preview: ирээдүйн ажлын эзнийг ЗӨВХӨН менежер ил зааж болно; эрхгүй/бүлгээс гадуурх хүн татгалзана', async () => {
  const h = makeDb();
  legacyGroup(h);
  const pv = await previewOk(h, { futureOwners: { 502: B } });
  const plan = pv.plan!;
  assert.equal(plan.members.find((m) => m.taskId === 502)!.futureOwner, B);
  // B: D 15% + ирээдүй (50 − 15 = 35%) = 50%
  assert.deepEqual(plan.allocations.find((a) => a.userId === B), { userId: B, ordinal: 2, doneUnits: pt(15), floorUnits: pt(15), targetUnits: pt(50) });
  assert.equal(plan.unallocatedUnits, pt(12.5) + pt(0)); // 501-ийн ирээдүй 12.5%, 504 дууссан
  h.sqlite.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(SENIOR);
  const bad = await Conv.previewConversion(h.d1, { taskIds: GROUP, futureOwners: { 502: SENIOR } });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.code, 'USER_NOT_ELIGIBLE');
  const outside = await Conv.previewConversion(h.d1, { taskIds: GROUP, futureOwners: { 503: B } });
  assert.equal(!outside.ok && outside.code, 'BAD_OWNER');
  const noRoot = await Conv.previewConversion(h.d1, { taskIds: GROUP, rootTaskId: 999 });
  assert.equal(!noRoot.ok && noRoot.code, 'ROOT_NOT_IN_GROUP');
  const tiny = await Conv.previewConversion(h.d1, { taskIds: [501] });
  assert.equal(!tiny.ok && tiny.code, 'BAD_GROUP');
});

/* ------------------------------------------------------------------ */
/*  Apply                                                               */
/* ------------------------------------------------------------------ */

test('apply: төслийн явц, оноо, график, сарын оноо ХЭВЭЭР; root/хуваарилалт/слайс зөв; аудит цэвэр', async () => {
  const h = makeDb();
  h.sqlite.exec('ALTER TABLE projects ADD COLUMN hours_progress_base REAL'); // график (progressTimeseries) энэ баганыг уншина
  legacyGroup(h);
  const progressBefore = await Progress.calcProjectProgress(h.d1, 10);
  const seriesBefore = await Series.snapshotProgressTimeseries(h.d1, 10, '2026-09-01', '2026-10-05');
  const pointsBefore = rows(h.sqlite, 'SELECT * FROM user_points ORDER BY id');
  const monthSql = (db: H) => Users.MONTHLY_POINTS_SQL.replace(/\?3/g, "'+480 minutes'").replace(/\?1/g, "'2026-09-01'").replace(/\?2/g, "'2026-10-01'") && rows(db.sqlite, Users.MONTHLY_POINTS_SQL.replace(/\?3/g, "'+480 minutes'").replace(/\?1/g, "'2026-09-01'").replace(/\?2/g, "'2026-10-01'"));
  const monthBefore = monthSql(h);

  const r = await convert(h);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.data.root_task_id, 501);
  assert.equal(r.data.root_done_pct, 52.5);
  assert.deepEqual(r.data.retired, [502, 504]);

  // Төслийн явц ЯГ хэвээр (нэг зургийн жигнэсэн rollup).
  near(await Progress.calcProjectProgress(h.d1, 10), progressBefore, 'төслийн явц', 1e-6);
  // Түүхийн график хэвээр (backfill).
  const seriesAfter = await Series.snapshotProgressTimeseries(h.d1, 10, '2026-09-01', '2026-10-05');
  assert.equal(seriesAfter.length, seriesBefore.length);
  seriesBefore.forEach((p, i) => near(seriesAfter[i]!.progress, p.progress, `график ${p.date}`, 0.011));
  // Оноо: НЭГ Ч шинэ мөр үгүй, хуучин мөр бүр хэвээр.
  assert.deepEqual(rows(h.sqlite, 'SELECT * FROM user_points ORDER BY id'), pointsBefore);
  // Сарын оноо хэвээр (A 5, B 6, C 10).
  assert.deepEqual(monthSql(h), monthBefore);
  // Бүтэц.
  const t = Object.fromEntries(rows<{ id: number; weight_percent: number; due_date: string | null; start_date: string | null }>(h.sqlite, 'SELECT id, weight_percent, due_date, start_date FROM tasks').map((x) => [x.id, x]));
  assert.equal(t[501]!.weight_percent, 40);
  assert.equal(t[502]!.weight_percent, 0);
  assert.equal(t[502]!.due_date, null);
  assert.equal(t[504]!.weight_percent, 0);
  assert.equal(t[503]!.weight_percent, 0); // бүлгийн гишүүн биш — хөндөгдөөгүй
  const root = rows<{ revision: number; unattributed_units: number; unallocated_units: number; slack_units: number; seed_attribution: string }>(h.sqlite, 'SELECT * FROM task_roots WHERE task_id = 501')[0]!;
  assert.equal(root.revision, 1);
  assert.equal(root.unattributed_units, 0);
  assert.equal(root.unallocated_units, pt(47.5));
  assert.equal(root.seed_attribution, 'clean');
  assert.equal(rows(h.sqlite, 'SELECT * FROM task_roots').length, 1, 'зөвхөн нэг root');
  assert.equal(sum(h.sqlite, "SELECT COUNT(*) AS v FROM task_contributions WHERE task_id = 501 AND kind = 'seed'"), 5);
  // Root-ийн сүүлийн явц = 52.5 (projection), сүүлийн мөр нь alloc_adj (ажлын үйл явдал БИШ).
  const last = rows<{ percentage: number; source: string }>(h.sqlite, "SELECT percentage, source FROM progress_entries WHERE task_id = 501 AND status = 'approved' ORDER BY created_at DESC, id DESC LIMIT 1")[0]!;
  assert.equal(last.percentage, 52.5);
  assert.equal(last.source, 'alloc_adj');
  // Журнал.
  const conv = rows<{ status: string; evidence: string; classification: string; rollup_before: number; rollup_after: number }>(h.sqlite, 'SELECT * FROM task_conversions')[0]!;
  assert.equal(conv.status, 'applied');
  assert.equal(conv.evidence, 'manual');
  near(conv.rollup_before, conv.rollup_after, 'journal rollup', 1e-9);
  assert.deepEqual(rows(h.sqlite, 'SELECT task_id, role FROM task_conversion_members ORDER BY task_id').map((x) => ({ ...x })), [
    { task_id: 501, role: 'root' }, { task_id: 502, role: 'retired' }, { task_id: 504, role: 'retired' },
  ]);
  // Аудитор (deep) цэвэр.
  const audit = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'error'), []);
  assert.equal(audit.roots_checked, 1);
});

test('apply: нэгтгэсний дараа хуучин replay (recalculateProjectPoints) нэгтгэгдсэн хэсгийн оноог ХӨНДӨХГҮЙ', async () => {
  const h = makeDb();
  legacyGroup(h);
  const r = await convert(h);
  assert.equal(r.ok, true);
  const before = rows(h.sqlite, 'SELECT * FROM user_points ORDER BY id');
  await Progress.recalculateProjectPoints(h.d1, 10);
  assert.deepEqual(rows(h.sqlite, 'SELECT * FROM user_points ORDER BY id'), before);
  const audit = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'error'), []);
});

test('apply: root дээр дараа нь хуваарилалт/явц/залруулга хэвийн ажиллана, нэгтгэгдсэн хэсэг дээр бичих боломжгүй', async () => {
  const h = makeDb();
  legacyGroup(h);
  const r = await convert(h);
  assert.equal(r.ok, true);
  // U = 47.5%: A, B хоёрт хуваарилна (нийт зорилт: A 12.5 + 30 = 42.5, B 15 + 17.5 = 32.5; C 25 түүх)
  const alloc = await Ops.applyAllocation(ctx(h), actorOf(A), {
    taskId: 501, requestId: uid('split'), expectedRevision: 1, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(42.5) }, { userId: B, targetUnits: pt(32.5) }],
  });
  assert.equal(alloc.ok, true, JSON.stringify(alloc));
  session(h.sqlite, { userId: A, taskId: 501, startedAt: '2026-10-05T08:00:00.000Z', endedAt: '2026-10-05T08:30:00.000Z' });
  const rev = rows<{ revision: number }>(h.sqlite, 'SELECT revision FROM task_roots WHERE task_id = 501')[0]!.revision;
  const p = await Ops.setOwnProgress(ctx(h), actorOf(A), { taskId: 501, requestId: uid('p'), expectedRevision: rev, doneUnits: pt(20) });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.ok(sum(h.sqlite, 'SELECT SUM(amount) AS v FROM user_points WHERE user_id = 3') > 5, 'A-д шинэ оноо');
  const audit = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'error'), []);
});

test('apply: нотолгоо сул (ambiguous) бол ИЛ баталгаа шаардана; шалтгаан заавал; зөвхөн админ', async () => {
  const h = makeDb();
  legacyGroup(h);
  const pv = await previewOk(h);
  const noConfirm = await Conv.applyConversion(ctx(h), admin, { taskIds: GROUP, requestId: uid('conv'), planHash: pv.plan_hash!, reason: 'тест шалтгаан' });
  assert.equal(!noConfirm.ok && noConfirm.code, 'CONFIRMATION_REQUIRED');
  const noReason = await Conv.applyConversion(ctx(h), admin, { taskIds: GROUP, requestId: uid('conv'), planHash: pv.plan_hash!, reason: ' ', confirmAmbiguous: true });
  assert.equal(!noReason.ok && noReason.code, 'REASON_REQUIRED');
  const senior = await Conv.applyConversion(ctx(h), actorOf(SENIOR), { taskIds: GROUP, requestId: uid('conv'), planHash: pv.plan_hash!, reason: 'тест шалтгаан', confirmAmbiguous: true });
  assert.equal(!senior.ok && senior.code, 'ADMIN_ONLY');
  const badHash = await Conv.applyConversion(ctx(h), admin, { taskIds: GROUP, requestId: uid('conv'), planHash: 'x'.repeat(8), reason: 'тест шалтгаан', confirmAmbiguous: true });
  assert.equal(!badHash.ok && badHash.code, 'BAD_PLAN_HASH');
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 0, 'татгалзсан үед юу ч бичигдээгүй');
});

test('apply: зарлагдсан бүлэг (tasks.group_id) = proven_split → баталгаагүйгээр хөрвүүлнэ; нэр дэвшигчийн жагсаалт нотолгоогоор ангилна', async () => {
  const h = makeDb();
  h.sqlite.exec('ALTER TABLE tasks ADD COLUMN group_id INTEGER');
  legacyGroup(h);
  h.sqlite.prepare('UPDATE tasks SET group_id = 7 WHERE id IN (501, 502, 504)').run();
  // нэрийн хэв маяг: 503 + шинэ таск хос
  h.sqlite.prepare("UPDATE tasks SET name = 'Огтлол (1/2)' WHERE id = 503").run();
  h.sqlite.prepare("INSERT INTO tasks (id, component_id, name, weight_percent, sort_order) VALUES (505, 1, 'Огтлол (2/2)', 5, 50)").run();
  const found = await Conv.discoverGroups(h.d1, {});
  assert.equal(found.declared_groups_supported, true);
  const declared = found.groups.find((g) => g.evidence === 'declared_group')!;
  assert.deepEqual(declared.task_ids.sort(), GROUP);
  assert.equal(declared.classification.classification, 'proven_split');
  const named = found.groups.find((g) => g.evidence === 'name_pattern')!;
  assert.deepEqual(named.task_ids, [503, 505]);
  assert.equal(named.classification.classification, 'organizational'); // 503 жин 0 → нэгтгэх боломжгүй
  assert.deepEqual(named.classification.blockers, ['ZERO_WEIGHT_MEMBER']);
  const pv = await previewOk(h);
  assert.equal(pv.evidence, 'declared_group');
  assert.equal(pv.needs_confirmation, false);
  const r = await Conv.applyConversion(ctx(h), admin, { taskIds: GROUP, requestId: uid('conv'), planHash: pv.plan_hash!, reason: 'зарлагдсан бүлэг', nowMs: NOW, today: '2026-10-05' });
  assert.equal(r.ok, true, JSON.stringify(r));
  // Нэгтгэсний дараа нэр дэвшигч жагсаалтаас гарна (already_managed тоологдоно).
  const after = await Conv.discoverGroups(h.d1, {});
  assert.equal(after.groups.filter((g) => g.evidence === 'declared_group').length, 0);
  assert.equal(after.counts.already_managed, 1);
});

test('apply: root-ийн нэр — «(i/N)» хэв маягаас суурь нэр; гараар өгсөн нэр давамгайлна', async () => {
  const h = makeDb();
  legacyGroup(h);
  h.sqlite.prepare("UPDATE tasks SET name = 'Фасад (1/3)' WHERE id = 501").run();
  h.sqlite.prepare("UPDATE tasks SET name = 'Фасад (2/3)' WHERE id = 502").run();
  h.sqlite.prepare("UPDATE tasks SET name = 'Фасад (3/3)' WHERE id = 504").run();
  const pv = await previewOk(h);
  assert.equal(pv.evidence, 'name_pattern');
  assert.equal(pv.plan!.rootNameAfter, 'Фасад');
  const named = await previewOk(h, { rootName: 'Фасадны зураг' });
  assert.equal(named.plan!.rootNameAfter, 'Фасадны зураг');
  const r = await Conv.applyConversion(ctx(h), admin, { taskIds: GROUP, requestId: uid('conv'), planHash: pv.plan_hash!, reason: 'нэрийн хэв маяг', confirmAmbiguous: true, nowMs: NOW, today: '2026-10-05' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(rows<{ name: string }>(h.sqlite, 'SELECT name FROM tasks WHERE id = 501')[0]!.name, 'Фасад');
});

test('apply: эргэлзээтэй түүх (77 → 8 буурсан) — хийсэн нь эзэнгүй B, slack үлдэнэ, хэнд ч нэр зохиохгүй; аудит цэвэр', async () => {
  const h = makeDb();
  legacyEntry(h.sqlite, { taskId: 501, userId: A, pct: 77, createdAt: '2026-09-10 10:00:00', points: { amount: 7.7, deltaPct: 7.7 } });
  legacyEntry(h.sqlite, { taskId: 501, userId: B, pct: 8, createdAt: '2026-09-12 10:00:00' }); // буурсан → оноо буцаагдаагүй
  legacyEntry(h.sqlite, { taskId: 502, userId: C, pct: 25, createdAt: '2026-09-11 10:00:00', points: { amount: 5, deltaPct: 5 } });
  const r = await convert(h);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.data.seed_attribution, 'uncertain');
  const root = rows<{ unattributed_units: number; slack_units: number }>(h.sqlite, 'SELECT unattributed_units, slack_units FROM task_roots WHERE task_id = 501')[0]!;
  // 501: T = 10/30·1e6 = 333334 (хамгийн их үлдэгдэл), D = 8% × T; B = D (эзэнгүй)
  assert.ok(root.unattributed_units > 0);
  assert.ok(root.slack_units > 0, '77→8: төлөгдсөн атлаа одоо хүчинтэй биш хэсэг slack');
  const alloc = rows<{ user_id: number }>(h.sqlite, 'SELECT user_id FROM task_allocations ORDER BY ordinal');
  assert.deepEqual(alloc.map((a) => a.user_id), [C], 'зөвхөн нотолгоотой C; A, B-д хийсэн хэсэг оноогдоогүй');
  const audit = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'error'), []);
});

test('apply: хуучин хуваалтын «хийгдсэн хэсэг» (source=split) — хэнийх нь тодорхойгүй тул B, алдаагүй хөрвүүлнэ', async () => {
  const h = makeDb();
  legacyGroup(h);
  // 504: 100% «хуваалтын хийгдсэн хэсэг» болгож тэмдэглэнэ
  h.sqlite.prepare("UPDATE progress_entries SET source = 'split' WHERE task_id = 504 AND percentage = 100").run();
  const pv = await previewOk(h);
  assert.ok(pv.classification.warnings.includes('LEGACY_SPLIT_DONE_PART'));
  const m504 = pv.plan!.members.find((m) => m.taskId === 504)!;
  assert.equal(m504.attribution, 'uncertain');
  assert.equal(m504.unattributedUnits, m504.doneUnits);
  const r = await convert(h);
  assert.equal(r.ok, true, JSON.stringify(r));
  const audit = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.deepEqual(audit.findings.filter((f) => f.severity === 'error'), []);
});

/* ------------------------------------------------------------------ */
/*  Хориг, идемпотент, хуучирсан, атом                                   */
/* ------------------------------------------------------------------ */

test('хориг: явж буй таймер, архивласан төсөл, цагийн горим, бүгд дууссан → хөрвүүлэхгүй (юу ч бичихгүй)', async () => {
  const h = makeDb();
  legacyGroup(h);
  session(h.sqlite, { userId: A, taskId: 502, startedAt: '2026-10-05T08:00:00.000Z' }); // явж буй
  const pv = await previewOk(h);
  assert.ok(pv.classification.blockers.includes('RUNNING_TIMER'));
  assert.equal(pv.plan, null);
  const r = await Conv.applyConversion(ctx(h), admin, { taskIds: GROUP, requestId: uid('conv'), planHash: 'a'.repeat(32), reason: 'тест шалтгаан', confirmAmbiguous: true });
  assert.equal(r.ok, false);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 0);
  h.sqlite.prepare('UPDATE task_timer_sessions SET ended_at = ?, duration_ms = 1000 WHERE ended_at IS NULL').run('2026-10-05T08:10:00.000Z');
  h.sqlite.prepare("UPDATE projects SET status = 'archived' WHERE id = 10").run();
  assert.ok((await previewOk(h)).classification.blockers.includes('PROJECT_INACTIVE'));
  h.sqlite.prepare("UPDATE projects SET status = 'active', progress_mode = 'hours' WHERE id = 10").run();
  assert.ok((await previewOk(h)).classification.blockers.includes('HOURS_MODE'));
});

test('идемпотент: ижил request_id → анхны үр дүн (replayed), давхар бичигдэхгүй; өөр агуулга → REQUEST_REUSED; буцаасны дараа → CONVERSION_REVERTED', async () => {
  const h = makeDb();
  legacyGroup(h);
  const pv = await previewOk(h);
  const requestId = uid('conv');
  const body = { taskIds: GROUP, requestId, planHash: pv.plan_hash!, reason: 'тест шалтгаан', confirmAmbiguous: true, nowMs: NOW, today: '2026-10-05' };
  const first = await Conv.applyConversion(ctx(h), admin, body);
  assert.equal(first.ok, true, JSON.stringify(first));
  const stateAfter = JSON.stringify(snapshot(h));
  const again = await Conv.applyConversion(ctx(h), admin, body);
  assert.equal(again.ok && again.replayed, true);
  assert.deepEqual(again.ok && again.data, first.ok && first.data);
  assert.equal(JSON.stringify(snapshot(h)), stateAfter, 'дахин оролдлого өгөгдөл хөндөхгүй');
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_conversions'), 1);
  const reused = await Conv.applyConversion(ctx(h), admin, { ...body, planHash: 'b'.repeat(40) });
  assert.equal(!reused.ok && reused.code, 'REQUEST_REUSED');
  // Аль хэдийн managed бүлэгт ШИНЭ request_id → ALREADY_MANAGED
  const second = await Conv.applyConversion(ctx(h), admin, { ...body, requestId: uid('conv') });
  assert.equal(second.ok, false);
  const rev = await Conv.revertConversion(ctx(h), admin, { conversionId: requestId, requestId: uid('rev'), reason: 'тест буцаалт' });
  assert.equal(rev.ok, true, JSON.stringify(rev));
  const afterRevert = await Conv.applyConversion(ctx(h), admin, body);
  assert.equal(!afterRevert.ok && afterRevert.code, 'CONVERSION_REVERTED');
});

test('хуучирсан төлөвлөгөө: preview-ийн дараа гишүүнд шинэ явц орвол PLAN_STALE (юу ч бичигдэхгүй)', async () => {
  const h = makeDb();
  legacyGroup(h);
  const pv = await previewOk(h);
  legacyEntry(h.sqlite, { taskId: 502, userId: B, pct: 40, createdAt: '2026-10-05 09:00:00', points: { amount: 2, deltaPct: 2 } });
  const before = JSON.stringify(snapshot(h));
  const r = await Conv.applyConversion(ctx(h), admin, { taskIds: GROUP, requestId: uid('conv'), planHash: pv.plan_hash!, reason: 'тест шалтгаан', confirmAmbiguous: true, nowMs: NOW, today: '2026-10-05' });
  assert.equal(!r.ok && r.code, 'PLAN_STALE');
  assert.equal(JSON.stringify(snapshot(h)), before);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 0);
});

test('атом: batch дундаас унавал ЮУ Ч бичигдэхгүй (жин, root, слайс, backfill, marker бүгд эхний төлөвт)', async () => {
  const h = makeDb();
  legacyGroup(h);
  const pv = await previewOk(h);
  // Дундаас нь унагах: хуваарилалтын UNIQUE (task_id, ordinal)-ыг урьдчилан эзэлнэ — task_roots-гүй тул guard өнгөрнө.
  h.sqlite.prepare('INSERT INTO task_allocations (task_id, user_id, ordinal, target_units) VALUES (501, 99, 1, 0)').run();
  const before = JSON.stringify({ ...snapshot(h), ops: rows(h.sqlite, 'SELECT * FROM task_ops'), alloc: rows(h.sqlite, 'SELECT * FROM task_allocations') });
  await assert.rejects(
    Conv.applyConversion(ctx(h), admin, { taskIds: GROUP, requestId: uid('conv'), planHash: pv.plan_hash!, reason: 'тест шалтгаан', confirmAmbiguous: true, nowMs: NOW, today: '2026-10-05' }),
  );
  const after = JSON.stringify({ ...snapshot(h), ops: rows(h.sqlite, 'SELECT * FROM task_ops'), alloc: rows(h.sqlite, 'SELECT * FROM task_allocations') });
  assert.equal(after, before, 'rollback — нэг мөр ч өөрчлөгдөөгүй');
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_conversions'), 0);
});

/* ------------------------------------------------------------------ */
/*  Буцаалт                                                             */
/* ------------------------------------------------------------------ */

test('revert: root дээр юу ч хийгдээгүй бол ЭХНИЙ төлөвт ЯГ буцна (жин, нэр, хугацаа, backfill, root, слайс); дахин хөрвүүлж болно', async () => {
  const h = makeDb();
  legacyGroup(h);
  const before = JSON.stringify(snapshot(h));
  const r = await convert(h);
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.notEqual(JSON.stringify(snapshot(h)), before);
  const rev = await Conv.revertConversion(ctx(h), admin, { conversionId: r.data.conversion_id, requestId: uid('rev'), reason: 'тест буцаалт' });
  assert.equal(rev.ok, true, JSON.stringify(rev));
  assert.equal(JSON.stringify(snapshot(h)), before, 'хөрвүүлэлтийн өмнөх төлөвтэй ЯГ ижил');
  for (const t of ['task_roots', 'task_allocations', 'task_contributions', 'task_conversion_members']) {
    assert.equal(sum(h.sqlite, `SELECT COUNT(*) AS v FROM ${t}`), 0, t);
  }
  assert.equal(rows<{ status: string }>(h.sqlite, 'SELECT status FROM task_conversions')[0]!.status, 'reverted');
  const twice = await Conv.revertConversion(ctx(h), admin, { conversionId: r.data.conversion_id, requestId: uid('rev'), reason: 'тест буцаалт' });
  assert.equal(!twice.ok && twice.code, 'ALREADY_REVERTED');
  const audit = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.equal(audit.ok, true);
  const again = await convert(h);
  assert.equal(again.ok, true, 'буцаасны дараа дахин хөрвүүлж болно');
});

test('revert: root дээр үйлдэл хийгдсэний дараа REVERT_UNSAFE (юу ч өөрчлөгдөхгүй); админ биш 403', async () => {
  const h = makeDb();
  legacyGroup(h);
  const r = await convert(h);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const split = await Ops.applyAllocation(ctx(h), actorOf(A), {
    taskId: 501, requestId: uid('split'), expectedRevision: 1, mode: 'total',
    targets: [{ userId: A, targetUnits: pt(60) }],
  });
  assert.equal(split.ok, true, JSON.stringify(split));
  const before = JSON.stringify(snapshot(h));
  const rev = await Conv.revertConversion(ctx(h), admin, { conversionId: r.data.conversion_id, requestId: uid('rev'), reason: 'тест буцаалт' });
  assert.equal(!rev.ok && rev.code, 'REVERT_UNSAFE');
  assert.equal(JSON.stringify(snapshot(h)), before);
  const nonAdmin = await Conv.revertConversion(ctx(h), actorOf(SENIOR), { conversionId: r.data.conversion_id, requestId: uid('rev'), reason: 'тест буцаалт' });
  assert.equal(!nonAdmin.ok && nonAdmin.code, 'ADMIN_ONLY');
});

/* ------------------------------------------------------------------ */
/*  Аудитор: хөрвүүлэлтийн журналын эрүүл мэнд                           */
/* ------------------------------------------------------------------ */

test('аудитор: нэгтгэгдсэн хэсэгт жин буцаавал CONVERSION_RETIRED_ACTIVE; root уствал CONVERSION_ROOT_MISSING', async () => {
  const h = makeDb();
  legacyGroup(h);
  assert.equal((await convert(h)).ok, true);
  h.sqlite.prepare('UPDATE tasks SET weight_percent = 20 WHERE id = 502').run();
  const a = await Audit.auditTaskAllocations(h.d1, {});
  assert.equal(a.counts.CONVERSION_RETIRED_ACTIVE, 1);
  assert.equal(a.ok, false);
  h.sqlite.prepare('UPDATE tasks SET weight_percent = 0 WHERE id = 502').run();
  h.sqlite.prepare('UPDATE tasks SET weight_percent = 55 WHERE id = 501').run();
  const w = await Audit.auditTaskAllocations(h.d1, {});
  assert.equal(w.counts.CONVERSION_ROOT_WEIGHT_CHANGED, 1);
  assert.equal(w.counts.CONVERSION_RETIRED_ACTIVE ?? 0, 0);
  h.sqlite.prepare('DELETE FROM task_roots WHERE task_id = 501').run();
  const m = await Audit.auditTaskAllocations(h.d1, {});
  assert.equal(m.counts.CONVERSION_ROOT_MISSING, 1);
});

/* ------------------------------------------------------------------ */
/*  Хоёр дахь шатны шалгалтаас гарсан засварууд (2026-10-05, ревью)      */
/* ------------------------------------------------------------------ */

/** Төлөвлөгөөг тооцсоны ДАРАА, batch-ийн ӨМНӨ завсарт `race()` ажиллуулдаг D1 (TOCTOU-г санаатай үүсгэнэ). */
function racingD1(h: H, race: () => void): D1Database {
  const base = h.d1 as unknown as { prepare: (sql: string) => Record<string, unknown>; batch: (s: unknown[]) => Promise<unknown> };
  let fired = false;
  let chainLoads = 0;
  const fire = () => {
    if (!fired) {
      fired = true;
      race();
    }
  };
  return {
    prepare(sql: string) {
      // Хуучин код төлөвлөгөөнийхөө дараа гишүүдийг ДАХИН уншдаг байв (2 дахь chain query) — яг тэр агшинд бичилт оруулна.
      if (sql.includes('last_points_id')) {
        chainLoads += 1;
        if (chainLoads === 2) fire();
      }
      return base.prepare(sql);
    },
    async batch(stmts: unknown[]) {
      fire(); // Шинэ код дахин уншдаггүй — batch-ийн guard-аас өмнө оруулна.
      return base.batch(stmts);
    },
  } as unknown as D1Database;
}

test('apply TOCTOU: төлөвлөгөө тооцсоны ДАРАА гишүүнд явц орвол guard барина — тооцоонд ороогүй 90% чимээгүй алдагдахгүй', async () => {
  const h = makeDb();
  legacyGroup(h);
  const pv = await previewOk(h);
  const racing = racingD1(h, () =>
    legacyEntry(h.sqlite, { taskId: 502, userId: B, pct: 90, createdAt: '2026-10-05 09:30:00', points: { amount: 5, deltaPct: 5 } }),
  );
  const r = await Conv.applyConversion({ db: racing, nowMs: NOW, today: '2026-10-05' }, admin, {
    taskIds: GROUP,
    requestId: uid('conv'),
    planHash: pv.plan_hash!,
    reason: 'тест шалтгаан',
    confirmAmbiguous: true,
    nowMs: NOW,
    today: '2026-10-05',
  });
  assert.equal(r.ok, false, 'завсарт орсон явцтай бүлгийг нэгтгэж БОЛОХГҮЙ');
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_roots'), 0);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM task_conversions'), 0);
  assert.equal(sum(h.sqlite, 'SELECT weight_percent AS v FROM tasks WHERE id = 502'), 20, 'гишүүний жин хэвээр');
});

test('revert: convert → revert → convert → revert — хоёр дахь буцаалт ч ажиллана (өмнөх мөчлөгийн marker «дараах үйлдэл» биш)', async () => {
  const h = makeDb();
  legacyGroup(h);
  const before = JSON.stringify(snapshot(h));
  const c1 = await convert(h);
  assert.equal(c1.ok, true, JSON.stringify(c1));
  if (!c1.ok) return;
  const r1 = await Conv.revertConversion(ctx(h), admin, { conversionId: c1.data.conversion_id, requestId: uid('rev'), reason: 'эхний буцаалт' });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const c2 = await convert(h);
  assert.equal(c2.ok, true, JSON.stringify(c2));
  if (!c2.ok) return;
  const r2 = await Conv.revertConversion(ctx(h), admin, { conversionId: c2.data.conversion_id, requestId: uid('rev'), reason: 'хоёр дахь буцаалт' });
  assert.equal(r2.ok, true, JSON.stringify(r2));
  assert.equal(JSON.stringify(snapshot(h)), before, 'хоёр мөчлөгийн дараа ч эхний төлөвтэй ЯГ ижил');
});

test('revert: root дээр хөрвүүлэлтийн дараа ажил орвол хоёр дахь мөчлөгт ч REVERT_UNSAFE хэвээр (marker-ийн шүүлт нэмэлт ажлыг далдлахгүй)', async () => {
  const h = makeDb();
  legacyGroup(h);
  const c1 = await convert(h);
  assert.equal(c1.ok, true);
  if (!c1.ok) return;
  await Conv.revertConversion(ctx(h), admin, { conversionId: c1.data.conversion_id, requestId: uid('rev'), reason: 'эхний буцаалт' });
  const c2 = await convert(h);
  assert.equal(c2.ok, true);
  if (!c2.ok) return;
  h.sqlite
    .prepare("INSERT INTO task_ops (request_id, task_id, user_id, kind, root_revision_before, root_revision_after, result_json) VALUES ('op-later', 501, 3, 'progress', 1, 2, '{}')")
    .run();
  const r = await Conv.revertConversion(ctx(h), admin, { conversionId: c2.data.conversion_id, requestId: uid('rev'), reason: 'хоёр дахь буцаалт' });
  assert.equal(!r.ok && r.code, 'REVERT_UNSAFE');
});

test('revert: ижил request_id ӨӨР хөрвүүлэлтэд → REQUEST_REUSED (анхны үр дүнг буруу буцаахгүй)', async () => {
  const h = makeDb();
  legacyGroup(h);
  const c1 = await convert(h);
  assert.equal(c1.ok, true);
  if (!c1.ok) return;
  const rid = uid('rev');
  const r1 = await Conv.revertConversion(ctx(h), admin, { conversionId: c1.data.conversion_id, requestId: rid, reason: 'буцаалт' });
  assert.equal(r1.ok, true);
  const same = await Conv.revertConversion(ctx(h), admin, { conversionId: c1.data.conversion_id, requestId: rid, reason: 'буцаалт' });
  assert.equal(same.ok && same.replayed, true, 'ижил хөрвүүлэлт → replay');
  const other = await Conv.revertConversion(ctx(h), admin, { conversionId: 'cv-another', requestId: rid, reason: 'буцаалт' });
  assert.equal(!other.ok && other.code, 'REQUEST_REUSED');
});

test('revert: хөрвүүлэлтийн ДАРАА root-ийн нэр/хугацаа засагдсан бол буцаалт тэр засварыг ДАРЖ бичихгүй (NAME_EDITED / DATES_EDITED)', async () => {
  for (const [sql, code] of [
    ["UPDATE tasks SET name = 'Гараар засав' WHERE id = 501", 'NAME_EDITED:501'],
    ["UPDATE tasks SET due_date = '2027-01-01' WHERE id = 501", 'DATES_EDITED:501'],
    ["UPDATE tasks SET due_date = '2027-01-01' WHERE id = 502", 'DATES_EDITED:502'],
  ] as const) {
    const h = makeDb();
    legacyGroup(h);
    const c = await convert(h);
    assert.equal(c.ok, true, sql);
    if (!c.ok) return;
    h.sqlite.prepare(sql).run();
    const r = await Conv.revertConversion(ctx(h), admin, { conversionId: c.data.conversion_id, requestId: uid('rev'), reason: 'буцаалт' });
    assert.equal(!r.ok && r.code, 'REVERT_UNSAFE', sql);
    assert.ok(!r.ok && (r.extra as { reasons?: string[] } | undefined)?.reasons?.includes(code), `${sql}: ${JSON.stringify(r)}`);
  }
});

test('seed дугуйлалт: бутархай жинтэй (7/13/11) хөрвүүлэлт «оноо зөрсөн» шуугиан үүсгэхгүй — аудит CREDIT_DRIFT-гүй, анхны тулгалт юу ч бичихгүй', async () => {
  const h = makeDb();
  legacyGroup(h);
  h.sqlite.prepare('UPDATE tasks SET weight_percent = CASE id WHEN 501 THEN 7 WHEN 502 THEN 13 WHEN 504 THEN 11 END WHERE id IN (501, 502, 504)').run();
  const c = await convert(h);
  assert.equal(c.ok, true, JSON.stringify(c));
  const pointsBefore = sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points');
  const audit = await Audit.auditTaskAllocations(h.d1, { deep: true });
  assert.equal(audit.counts.CREDIT_DRIFT ?? 0, 0, JSON.stringify(audit.findings.filter((f) => f.code === 'CREDIT_DRIFT')));
  const Reweight = await import('./taskCreditReweight.ts');
  const r = await Reweight.reconcileTaskCredit({ db: h.d1, force: true }, 501, ADMIN);
  assert.equal(r.kind, 'noop', JSON.stringify(r));
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), pointsBefore, 'шинэ user_points мөр бичигдээгүй');
  assert.equal(sum(h.sqlite, 'SELECT revision AS v FROM task_roots WHERE task_id = 501'), 1, 'root revision өсөөгүй');
});

test('paused үед автомат тулгалт (жин засах, recalc) юу ч бичихгүй; админы тусгай тулгалт (force) ажиллана', async () => {
  const h = makeDb();
  legacyGroup(h);
  const c = await convert(h);
  assert.equal(c.ok, true);
  h.sqlite.exec("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('task_alloc.state', 'paused')");
  h.sqlite.prepare('UPDATE tasks SET weight_percent = weight_percent * 2 WHERE id = 501').run();
  const Reweight = await import('./taskCreditReweight.ts');
  const revBefore = sum(h.sqlite, 'SELECT revision AS v FROM task_roots WHERE task_id = 501');
  const ptsBefore = sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points');
  const auto = await Reweight.reconcileTaskCredit({ db: h.d1 }, 501, ADMIN);
  assert.deepEqual({ ...auto }, { kind: 'skipped', taskId: 501, reason: 'GATE_NOT_ENABLED' });
  const proj = await Reweight.reconcileProjectCredit({ db: h.d1 }, 10, ADMIN);
  assert.equal(proj.gateSkipped, true);
  assert.equal(sum(h.sqlite, 'SELECT revision AS v FROM task_roots WHERE task_id = 501'), revBefore);
  assert.equal(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points'), ptsBefore);
  const forced = await Reweight.reconcileTaskCredit({ db: h.d1, force: true }, 501, ADMIN);
  assert.equal(forced.kind, 'applied', JSON.stringify(forced));
  assert.ok(sum(h.sqlite, 'SELECT COUNT(*) AS v FROM user_points') > ptsBefore);
});
