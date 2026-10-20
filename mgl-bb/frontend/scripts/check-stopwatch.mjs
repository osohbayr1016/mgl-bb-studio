/**
 * Албан таймерын секундомер · дүрмийн шалгалт.
 *
 *   node scripts/check-stopwatch.mjs        (frontend/ хавтаснаас)
 *
 * `src/features/task-timer/stopwatch.ts` — Apple-ийн секундомерын формат
 * (1 цагаас доош мм:сс.сс м, дээш Ц:ММ ц), серверийн цагийн зангуу (дэлгэц хэзээ ч
 * хойш үсрэхгүй), товч дармагц харагдах төлөв.  Frontend-д vitest байхгүй тул
 * бусад `check-*.mjs`-ийн адил node-оор.
 */
import assert from 'node:assert/strict';

const S = await import('../src/features/task-timer/stopwatch.ts');
const { formatStopwatch, msUntilNextChange, nextAnchor, anchorNow, effectiveTimer, keepClickStart, HOUR_MS } = S;

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
};
const fmt = (ms) => {
  const p = formatStopwatch(ms);
  return p.main + p.frac + (p.unit ? ` ${p.unit}` : '');
};

console.log('formatStopwatch');
ok('0 → 00:00.00 m', () => assert.equal(fmt(0), '00:00.00 m'));
ok('7.43 s → 00:07.43 m', () => assert.equal(fmt(7_439), '00:07.43 m'));
ok('never rounds up: 59:59.999 → 59:59.99 m', () => assert.equal(fmt(HOUR_MS - 1), '59:59.99 m'));
ok('1 h → 1:00 h (seconds + hundredths hidden)', () => assert.equal(fmt(HOUR_MS), '1:00 h'));
ok('2 h 05 min 59 s → 2:05 h', () => assert.equal(fmt(2 * HOUR_MS + 5 * 60_000 + 59_999), '2:05 h'));
ok('27 h keeps counting hours', () => assert.equal(fmt(27 * HOUR_MS + 3 * 60_000), '27:03 h'));
ok('negative / NaN → 0', () => {
  assert.equal(fmt(-5), '00:00.00 m');
  assert.equal(fmt(Number.NaN), '00:00.00 m');
});

console.log('msUntilNextChange');
ok('under an hour: repaint every frame', () => assert.equal(msUntilNextChange(12_345), 10));
ok('over an hour: wait for the minute boundary', () => {
  assert.equal(msUntilNextChange(HOUR_MS + 15_000), 45_000);
  assert.equal(msUntilNextChange(HOUR_MS), 60_000);
});

console.log('nextAnchor (server clock)');
ok('first sample becomes the anchor', () =>
  assert.deepEqual(nextAnchor(null, 1_000_000, 50), { serverMs: 1_000_000, perf: 50 }));
ok('a slower (older) sample is ignored — display never jumps back', () => {
  const a = { serverMs: 1_000_000, perf: 0 };
  // 15 s later the reply says 14 950 ms have passed (it spent 50 ms more in flight).
  assert.equal(nextAnchor(a, 1_014_950, 15_000), a);
  assert.equal(anchorNow(a, 15_000, 0), 1_015_000);
});
ok('a fresher sample moves the anchor forward', () => {
  const a = { serverMs: 1_000_000, perf: 0 };
  assert.deepEqual(nextAnchor(a, 1_015_040, 15_000), { serverMs: 1_015_040, perf: 15_000 });
});
ok('a big backwards gap (sleep / clock change) resyncs', () => {
  const a = { serverMs: 1_000_000, perf: 0 };
  assert.deepEqual(nextAnchor(a, 1_005_000, 15_000), { serverMs: 1_005_000, perf: 15_000 });
});
ok('garbage server time keeps the old anchor', () => {
  const a = { serverMs: 1, perf: 0 };
  assert.equal(nextAnchor(a, Number.NaN, 9), a);
});

console.log('effectiveTimer (instant ▶/⏸)');
const iso = (ms) => new Date(ms).toISOString();
const none = new Map();
ok('no pending action → server state', () => {
  const r = effectiveTimer({ session_id: 1, task_id: 7, started_at: iso(1000) }, null, none);
  assert.deepEqual(r, { running: { task_id: 7, since: 1000 }, stopped: null });
});
ok('▶ B while A runs → B starts at the click, A freezes at the click', () => {
  const r = effectiveTimer({ session_id: 1, task_id: 7, started_at: iso(1000) }, { seq: 1, taskId: 8, atMs: 5000 }, none);
  assert.deepEqual(r, { running: { task_id: 8, since: 5000 }, stopped: { task_id: 7, since: 1000, until: 5000 } });
});
ok('⏸ → nothing runs, A freezes at the click', () => {
  const r = effectiveTimer({ session_id: 1, task_id: 7, started_at: iso(1000) }, { seq: 2, taskId: null, atMs: 4000 }, none);
  assert.deepEqual(r, { running: null, stopped: { task_id: 7, since: 1000, until: 4000 } });
});
ok('click start overrides the server start for this tab (no backwards jump)', () => {
  const r = effectiveTimer({ session_id: 9, task_id: 7, started_at: iso(1180) }, null, new Map([[9, 1000]]));
  assert.equal(r.running.since, 1000);
});
ok('keepClickStart: within 1.5 s yes, beyond no', () => {
  assert.equal(keepClickStart(iso(1200), 1000), true);
  assert.equal(keepClickStart(iso(4000), 1000), false);
});

console.log('lunch (2026-10-01: 13:00–14:00 тоологдохгүй — backend lib/taskTimer.ts-ийн ихэр)');
const { lunchRuleOf, lunchOverlapMs, countedMs, lunchStateAt, minutesToHHMM } = S;
const L = lunchRuleOf({ start_min: 780, end_min: 840, from: '2026-10-01', offset_min: 480 });
const ub = (s) => Date.parse(s.replace(' ', 'T') + ':00+08:00');
const H = HOUR_MS;
ok('lunchRuleOf: серверийн хэлбэр → дүрэм; буруу / байхгүй → null', () => {
  assert.deepEqual(L, { startMin: 780, endMin: 840, fromDate: '2026-10-01', offsetMin: 480 });
  assert.equal(lunchRuleOf(null), null);
  assert.equal(lunchRuleOf(undefined), null);
  assert.equal(lunchRuleOf({ start_min: 840, end_min: 780, from: '2026-10-01', offset_min: 480 }), null);
  assert.equal(lunchRuleOf({ start_min: 780, end_min: 840, offset_min: 480 }), null);
});
ok('12:30 → 14:30 = 1 ц (13:00-д хөлдөж 14:00-д үргэлжилнэ); цайны дотор бүхэлдээ = 0', () => {
  assert.equal(countedMs(ub('2026-10-02 12:30'), ub('2026-10-02 14:30'), L), H);
  assert.equal(countedMs(ub('2026-10-02 13:10'), ub('2026-10-02 13:50'), L), 0);
  assert.equal(countedMs(ub('2026-10-02 13:30'), ub('2026-10-02 15:00'), L), H);
  assert.equal(countedMs(ub('2026-10-02 09:00'), ub('2026-10-02 17:00'), L), 7 * H);
});
ok('10-01-ээс өмнөх өдөр хэвээр; дүрэмгүй (ирцэд унтраасан) бол түүхий', () => {
  assert.equal(countedMs(ub('2026-09-30 12:30'), ub('2026-09-30 14:30'), L), 2 * H);
  assert.equal(countedMs(ub('2026-10-02 12:30'), ub('2026-10-02 14:30'), null), 2 * H);
});
ok('явж буй тоолуур: 12:59 → 59 мин, 13:40 → 1 ц (хөлдсөн), 14:10 → 1 ц 10 мин', () => {
  const since = ub('2026-10-02 12:00');
  assert.equal(countedMs(since, ub('2026-10-02 12:59'), L), 59 * 60_000);
  assert.equal(countedMs(since, ub('2026-10-02 13:40'), L), H);
  assert.equal(countedMs(since, ub('2026-10-02 14:10'), L), H + 10 * 60_000);
});
ok('lunchStateAt: цайны дотор / өмнө / дараа + дараагийн хил', () => {
  assert.deepEqual(lunchStateAt(ub('2026-10-02 13:20'), L), { inLunch: true, nextEdgeMs: ub('2026-10-02 14:00') });
  assert.deepEqual(lunchStateAt(ub('2026-10-02 10:00'), L), { inLunch: false, nextEdgeMs: ub('2026-10-02 13:00') });
  assert.deepEqual(lunchStateAt(ub('2026-10-02 15:00'), L), { inLunch: false, nextEdgeMs: ub('2026-10-03 13:00') });
  assert.equal(lunchStateAt(ub('2026-09-30 13:20'), L).inLunch, false, '10-01-ээс өмнө цай тооцохгүй');
  assert.deepEqual(lunchStateAt(ub('2026-10-02 13:20'), null), { inLunch: false, nextEdgeMs: null });
});
ok('minutesToHHMM', () => {
  assert.equal(minutesToHHMM(780), '13:00');
  assert.equal(minutesToHHMM(510), '08:30');
});
// Backend `lib/taskTimer.ts`-тэй ЯГ ижил гэдгийг backend тест (`taskTimer.test.ts`) санамсаргүй
// интервалаар тулгана (frontend багц `type: module` тул тэндээс ачаалахад анхааруулгагүй).

console.log(`\n${n} шалгалт өнгөрлөө.`);
