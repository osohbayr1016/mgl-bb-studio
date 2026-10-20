// Managed таскийн оноог жин/төвөгшлийн өөрчлөлтийн дараа ЖУРНАЛААС дахин тооцох (2026-10-05, 0383).
// Баталгаажуулах зүйл: хэн/аль өдөр/аль слайс ХЭВЭЭР, зөвхөн хэмжээ шинэ жингээр; идемпотент; буцаалт/сэргээлт зөв;
// төвөгшил 0 урхи; Σ delta_pct = төслийн явц; хуучин replay (recalculateProjectPoints) managed-ийг эвдэхгүй.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USERS, actorOf, makeDb, rows, session, sum, uid } from '../../test-support/allocHarness.ts';

const Ops = await import('./taskRootOps.ts');
const Reweight = await import('./taskCreditReweight.ts');
const Progress = await import('../routes/progress.ts');
const U = 10_000;
const pt = (p: number) => Math.round(p * U);
const { A, B } = USERS;

const day = (n: number) => `2026-09-${String(n).padStart(2, '0')}`;
const ms = (n: number) => Date.parse(`${day(n)}T10:00:00Z`);

async function split(h: ReturnType<typeof makeDb>, targets: Array<[number, number]>, d = 1) {
  const r = await Ops.applyAllocation({ db: h.d1, nowMs: ms(d), today: day(d) }, actorOf(A), {
    taskId: 501,
    requestId: uid('split'),
    expectedRevision: 0,
    mode: 'total',
    targets: targets.map(([u, p]) => ({ userId: u, targetUnits: pt(p) })),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
}

const rev = (h: ReturnType<typeof makeDb>) =>
  rows<{ revision: number }>(h.sqlite, 'SELECT revision FROM task_roots WHERE task_id = 501')[0]!.revision;

/** `user`-ийн хийсэн хэмжээг `percent`-д хүргэнэ (өөр өдөр). */
async function progress(h: ReturnType<typeof makeDb>, user: number, percent: number, d: number) {
  const hasSession = rows<{ n: number }>(h.sqlite, 'SELECT COUNT(*) AS n FROM task_timer_sessions WHERE user_id = ? AND task_id = 501', user)[0]!.n;
  if (hasSession === 0) {
    session(h.sqlite, { userId: user, taskId: 501, startedAt: `${day(d)}T08:00:00.000Z`, endedAt: `${day(d)}T08:30:00.000Z` });
  }
  const r = await Ops.setOwnProgress({ db: h.d1, nowMs: ms(d), today: day(d) }, actorOf(user), {
    taskId: 501,
    requestId: uid('p'),
    expectedRevision: rev(h),
    doneUnits: pt(percent),
  });
  assert.equal(r.ok, true, JSON.stringify(r));
}

const net = (h: ReturnType<typeof makeDb>, user: number) =>
  sum(h.sqlite, 'SELECT SUM(amount) AS v FROM user_points WHERE user_id = ? AND task_id = 501', user);
const netDelta = (h: ReturnType<typeof makeDb>, user: number) =>
  sum(h.sqlite, 'SELECT SUM(delta_pct) AS v FROM user_points WHERE user_id = ? AND task_id = 501', user);
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} ≠ ${b}`);
const ctxOf = (h: ReturnType<typeof makeDb>) => ({ db: h.d1, nowMs: ms(20), today: day(20) });

/* ------------------------------------------------------------------ */
/*  Цэвэр төлөвлөгч                                                      */
/* ------------------------------------------------------------------ */

test('planReweight: зөрүү л, free (slack-аар хаагдсан) нэгж, хөвөгч таслалтыг алгасна', () => {
  const ctx = { coef: 0.2, complexityPct: 100 };
  const slice = (o: Partial<import('./taskCreditReweight.ts').CreditSlice>) => ({
    id: 1, taskId: 1, userId: 3, kind: 'work' as const, unitsOpen: pt(10), freeOpen: 0,
    creditOpenAmount: 2, creditOpenDeltaPct: 2, awardedAt: '2026-09-01 10:00:00', progressEntryId: null, ...o,
  });
  // 10 пункт × 0.2 = 2.0 → ижил: зөрүү байхгүй
  assert.deepEqual(Reweight.planReweight([slice({})], ctx), []);
  // хөвөгч шуугиан
  assert.deepEqual(Reweight.planReweight([slice({ creditOpenAmount: 2 + 1e-13 })], ctx), []);
  // жин хоёр дахин: зөрүү +2
  const [it] = Reweight.planReweight([slice({ creditOpenAmount: 1, creditOpenDeltaPct: 1 })], ctx);
  assert.ok(it);
  near(it!.amountDelta, 1, 'amountDelta');
  near(it!.coefBefore, 0.1, 'coefBefore');
  near(it!.complexityBefore, 100, 'complexityBefore');
  // бүх нэгж slack-аар хаагдсан (paid = 0) → оноо гарахгүй
  assert.deepEqual(Reweight.planReweight([slice({ freeOpen: pt(10), creditOpenAmount: 0, creditOpenDeltaPct: 0 })], ctx), []);
  // хаагдсан слайс (open 0)
  assert.deepEqual(Reweight.planReweight([slice({ unitsOpen: 0, creditOpenAmount: 0, creditOpenDeltaPct: 0 })], ctx), []);
  // төвөгшил 0: оноо 0, delta_pct хэвээр
  const [z] = Reweight.planReweight([slice({})], { coef: 0.2, complexityPct: 0 });
  near(z!.amountDelta, -2, 'zero complexity amount');
  near(z!.deltaPctDelta, 0, 'zero complexity delta_pct');
});

/* ------------------------------------------------------------------ */
/*  Жингийн өөрчлөлт                                                    */
/* ------------------------------------------------------------------ */

test('таскийн жин 10 → 20: хэн/өдөр ХЭВЭЭР, оноо хоёр дахин, Σ delta_pct = шинэ коэф × хийсэн; идемпотент', async () => {
  const h = makeDb();
  await split(h, [[A, 60], [B, 40]]);
  await progress(h, A, 20, 2);
  await progress(h, A, 50, 5);
  await progress(h, B, 30, 6);
  near(net(h, A), 5, 'өмнө A'); // 0.1 коэф × 50 пункт × 100% төвөгшил
  near(net(h, B), 3, 'өмнө B');
  const originalRows = rows<{ id: number; awarded_at: string; amount: number }>(h.sqlite, 'SELECT id, awarded_at, amount FROM user_points ORDER BY id');

  h.sqlite.exec('UPDATE tasks SET weight_percent = 20 WHERE id = 501');
  const preview = await Reweight.previewTaskReweight(h.d1, 501);
  assert.equal(preview!.totals.slices, 3);
  assert.equal(preview!.totals.users, 2);
  near(preview!.totals.amountDelta, 8, 'preview Σ');
  assert.equal(rows(h.sqlite, 'SELECT * FROM task_credit_adjustments').length, 0, 'preview юу ч бичихгүй');

  const revBefore = rev(h);
  const r = await Reweight.applyTaskReweight(ctxOf(h), 9, 501);
  assert.equal(r.kind, 'applied');
  assert.equal(rev(h), revBefore + 1, 'root revision өснө (зэрэг явж буй мутацийг STALE болгоно)');
  near(net(h, A), 10, 'дараа A');
  near(net(h, B), 6, 'дараа B');
  near(netDelta(h, A), 0.2 * 50, 'A Σ delta_pct = шинэ коэф × 50');
  near(netDelta(h, B), 0.2 * 30, 'B Σ delta_pct');

  // Анхны мөрүүд ХӨНДӨГДӨӨГҮЙ; нөхөн мөрүүд анхны өдөр, анхны эзэнд.
  for (const o of originalRows) {
    const now = rows<{ amount: number; awarded_at: string }>(h.sqlite, 'SELECT amount, awarded_at FROM user_points WHERE id = ?', o.id)[0]!;
    assert.equal(now.amount, o.amount);
    assert.equal(now.awarded_at, o.awarded_at);
  }
  const adj = rows<{ user_id: number; awarded_at: string; amount: number; contribution_id: number; reverses_points_id: number | null }>(
    h.sqlite, 'SELECT user_id, awarded_at, amount, contribution_id, reverses_points_id FROM user_points WHERE id > ? ORDER BY id', originalRows[originalRows.length - 1]!.id);
  assert.equal(adj.length, 3);
  assert.ok(adj.every((a) => a.reverses_points_id === null && a.contribution_id > 0 && a.amount > 0));
  const byDay = (userId: number) => rows<{ d: string; v: number }>(h.sqlite, 'SELECT substr(awarded_at,1,10) AS d, SUM(amount) AS v FROM user_points WHERE user_id = ? AND task_id = 501 GROUP BY d ORDER BY d', userId);
  assert.deepEqual(byDay(A).map((x) => x.d), [day(2), day(5)], 'өдрүүд шилжээгүй');
  near(byDay(A)[0]!.v, 4, 'A 09-02 (20 пункт × 0.2)');
  near(byDay(A)[1]!.v, 6, 'A 09-05 (30 пункт × 0.2)');

  // Аудит
  const audit = rows<{ coef_before: number; coef_after: number; run_id: string }>(h.sqlite, 'SELECT coef_before, coef_after, run_id FROM task_credit_adjustments');
  assert.equal(audit.length, 3);
  assert.ok(audit.every((a) => Math.abs(a.coef_before - 0.1) < 1e-9 && Math.abs(a.coef_after - 0.2) < 1e-9));
  assert.ok(audit.every((a) => a.run_id === `rw-501-r${revBefore}`));

  // Идемпотент: хоёр дахь удаа юу ч бичихгүй.
  const pointsCount = rows(h.sqlite, 'SELECT id FROM user_points').length;
  const again = await Reweight.applyTaskReweight(ctxOf(h), 9, 501);
  assert.equal(again.kind, 'noop');
  assert.equal(rows(h.sqlite, 'SELECT id FROM user_points').length, pointsCount);
  assert.equal(rev(h), revBefore + 1);
});

test('төвөгшил 100 → 50 → 0 → 100: оноо дагана, delta_pct (төслийн явц) хэвээр, эргэж ИЖИЛ болно', async () => {
  const h = makeDb();
  await split(h, [[A, 100]]);
  await progress(h, A, 40, 3);
  near(net(h, A), 4, 'эхний');
  const set = async (c: number) => {
    h.sqlite.exec(`UPDATE projects SET complexity_pct = ${c} WHERE id = 10`);
    return Reweight.reconcileTaskCredit(ctxOf(h), 501, 9);
  };
  assert.equal((await set(50)).kind, 'applied');
  near(net(h, A), 2, 'complexity 50');
  assert.equal((await set(0)).kind, 'applied');
  near(net(h, A), 0, 'complexity 0');
  near(netDelta(h, A), 4, 'delta_pct (явц) complexity-аас үл хамаарна');
  assert.equal((await set(100)).kind, 'applied');
  near(net(h, A), 4, 'буцаж ижил');
  assert.equal((await set(100)).kind, 'noop');
});

test('төвөгшил 0 үед хийсэн ажил (оноо 0, мөргүй) → төвөгшил засагдмагц оноо АНХНЫ ӨДРӨӨР олгогдоно', async () => {
  const h = makeDb();
  h.sqlite.exec('UPDATE projects SET complexity_pct = 0 WHERE id = 10');
  await split(h, [[A, 100]]);
  await progress(h, A, 50, 4);
  assert.equal(rows(h.sqlite, 'SELECT id FROM user_points').length, 0, 'төвөгшил 0 → оноо мөр байхгүй');
  const slice = rows<{ id: number; points_id: number | null; credit_open_amount: number }>(h.sqlite, "SELECT id, points_id, credit_open_amount FROM task_contributions WHERE kind = 'work'")[0]!;
  assert.equal(slice.points_id, null);

  h.sqlite.exec('UPDATE projects SET complexity_pct = 100 WHERE id = 10');
  const r = await Reweight.reconcileTaskCredit(ctxOf(h), 501, 9);
  assert.equal(r.kind, 'applied');
  near(net(h, A), 5, 'оноо олгогдлоо');
  const pts = rows<{ awarded_at: string; contribution_id: number }>(h.sqlite, 'SELECT awarded_at, contribution_id FROM user_points')[0]!;
  assert.equal(pts.awarded_at.slice(0, 10), day(4), 'ажил хийсэн өдөр, өнөөдөр БИШ');
  assert.equal(pts.contribution_id, slice.id);
  const after = rows<{ points_id: number | null }>(h.sqlite, 'SELECT points_id FROM task_contributions WHERE id = ?', slice.id)[0]!;
  assert.ok(after.points_id && after.points_id > 0, 'points_id холбогдов');
});

test('жин өөрчлөгдсөний ДАРАА буцаалт (decrease) шинэ дүнг буцаана — цэвэр оноо = шинэ коэф × үлдсэн хийсэн', async () => {
  const h = makeDb();
  await split(h, [[A, 100]]);
  await progress(h, A, 50, 2);
  h.sqlite.exec('UPDATE tasks SET weight_percent = 20 WHERE id = 501');
  await Reweight.reconcileTaskCredit(ctxOf(h), 501, 9);
  near(net(h, A), 10, 'шинэ жингээр 50');
  await progress(h, A, 30, 7); // 50 → 30 буцаалт
  near(net(h, A), 6, 'буцаалтын дараа: 0.2 × 30');
  near(netDelta(h, A), 0.2 * 30, 'delta_pct');
  // Буцаалтын мөр анхны слайсын өдөрт.
  const rev1 = rows<{ awarded_at: string }>(h.sqlite, 'SELECT awarded_at FROM user_points WHERE reverses_points_id IS NOT NULL')[0]!;
  assert.equal(rev1.awarded_at.slice(0, 10), day(2));
});

test('залруулсан слайс (хаагдсан) жин өөрчлөгдсөн ч хөндөгдөхгүй; сэргээхэд хуучин жингээр нээгдээд ТЭР ДАРУЙ шинэ жинтэй тулгагдана', async () => {
  const h = makeDb();
  await split(h, [[A, 100]]);
  await progress(h, A, 50, 2);
  const slice = rows<{ id: number }>(h.sqlite, "SELECT id FROM task_contributions WHERE kind = 'work' ORDER BY id")[0]!;
  const corrId = uid('corr');
  const c = await Ops.correctOwnProgress({ db: h.d1, nowMs: ms(3), today: day(3) }, actorOf(A), {
    taskId: 501, requestId: corrId, expectedRevision: rev(h), items: [{ sliceId: slice.id }],
  });
  assert.equal(c.ok, true, JSON.stringify(c));
  near(net(h, A), 0, 'залруулга: цэвэр 0');

  h.sqlite.exec('UPDATE tasks SET weight_percent = 20 WHERE id = 501');
  assert.equal((await Reweight.reconcileTaskCredit(ctxOf(h), 501, 9)).kind, 'noop', 'хаагдсан слайс хөндөгдөхгүй');
  near(net(h, A), 0, 'жин өөрчлөгдсөн ч цэвэр 0');

  const restored = await Ops.restoreOwnProgress({ db: h.d1, nowMs: ms(8), today: day(8) }, actorOf(A), {
    taskId: 501, requestId: uid('rest'), expectedRevision: rev(h), correctionRequestId: corrId,
  });
  assert.equal(restored.ok, true, JSON.stringify(restored));
  // Сэргээлт өөрөө хуучин (0.1) жингээр 5.0 буцаав → post-effect `reweight` ТЭР ДАРУЙ 10.0 болгоно.
  near(net(h, A), 10, 'сэргээлтийн дараа шинэ жингээр');
  near(netDelta(h, A), 0.2 * 50, 'delta_pct = шинэ коэф × 50');
});

test('recalculateProjectPoints (хуучин replay) managed-ийг ЖУРНАЛААР тулгана; managed БИШ таскийг хуучнаар дахин тооцно', async () => {
  const h = makeDb();
  await split(h, [[A, 100]]);
  await progress(h, A, 50, 2);
  h.sqlite.exec('UPDATE tasks SET weight_percent = 20 WHERE id = 501');
  await Progress.recalculateProjectPoints(h.d1, 10);
  near(net(h, A), 10, 'recalc-ийн дараа managed шинэ жингээр');
  assert.equal(rows(h.sqlite, 'SELECT id FROM task_credit_adjustments').length, 1);
  await Progress.recalculateProjectPoints(h.d1, 10);
  assert.equal(rows(h.sqlite, 'SELECT id FROM task_credit_adjustments').length, 1, 'дахин recalc — давхар мөргүй');
});

test('хэрэглэгч тус бүр: нөхөн мөр ЗӨВХӨН тэр слайсын эзэнд; бусдад шилжихгүй, нийт Σ хадгалагдана', async () => {
  const h = makeDb();
  await split(h, [[A, 50], [B, 50]]);
  await progress(h, A, 20, 2);
  await progress(h, B, 10, 3);
  const totalBefore = net(h, A) + net(h, B);
  h.sqlite.exec('UPDATE tasks SET weight_percent = 30 WHERE id = 501');
  await Reweight.reconcileTaskCredit(ctxOf(h), 501, 9);
  near(net(h, A), 6, 'A 20 × 0.3');
  near(net(h, B), 3, 'B 10 × 0.3');
  near(net(h, A) + net(h, B), totalBefore * 3, 'Σ 3×');
  const owners = rows<{ user_id: number }>(h.sqlite, 'SELECT DISTINCT user_id FROM task_credit_adjustments ORDER BY user_id').map((r) => r.user_id);
  assert.deepEqual(owners, [A, B]);
});

test('managed биш / олдохгүй таск: skipped; managed таск байхгүй төсөл: ямар ч бичилтгүй', async () => {
  const h = makeDb();
  assert.deepEqual(await Reweight.applyTaskReweight(ctxOf(h), 9, 504), { kind: 'skipped', taskId: 504, reason: 'NOT_MANAGED' });
  const proj = await Reweight.reconcileProjectCredit(ctxOf(h), 10, 9);
  assert.deepEqual({ ...proj }, { projectId: 10, tasks: 0, applied: 0, noop: 0, stale: 0, items: 0, amountDelta: 0, deltaPctDelta: 0 });
  assert.equal(rows(h.sqlite, 'SELECT request_id FROM task_ops').length, 0);
});
