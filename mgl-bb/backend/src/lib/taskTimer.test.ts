// Албан ёсны таскийн цаг хэмжигч (0361, 0368) — цэвэр дүрэм.  Route + бодит SQLite:
// `routes/taskTimer.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  clippedMs,
  countedMs,
  lunchOverlapMs,
  officialLunchOf,
  officialMsSql,
  OFFICIAL_LUNCH_FROM,
  sessionMs,
  splitByUbDay,
  startOutcome,
  summarizeRange,
  summarizeWindow,
  ubDayWindow,
  ubDateOf,
  dayEndCutoffIso,
  toUtcIso,
  type OfficialLunch,
} from './taskTimer.ts';

const UB = 480;
const H = 3_600_000;
const MIN = 60_000;
/** Прод-ийн тохиргоо (2026-10-01-нд хэмжсэн): цай 13:00–14:00. */
const LUNCH: OfficialLunch = officialLunchOf({ lunchEnabled: true, lunchStart: '13:00', lunchEnd: '14:00' }, UB)!;
/** УБ-ын 'YYYY-MM-DD HH:MM' → UTC мс. */
const ub = (s: string) => Date.parse(`${s.replace(' ', 'T')}:00+08:00`);
const iso = (ms: number) => new Date(ms).toISOString();

test('ubDayWindow: УБ-ын өдөр = UTC 16:00 → 16:00', () => {
  const w = ubDayWindow('2026-09-29', UB);
  assert.equal(new Date(w.startMs).toISOString(), '2026-09-28T16:00:00.000Z');
  assert.equal(new Date(w.endMs).toISOString(), '2026-09-29T16:00:00.000Z');
  assert.equal(ubDateOf(w.startMs, UB), '2026-09-29');
  assert.equal(ubDateOf(w.endMs - 1, UB), '2026-09-29');
});

test('sessionMs: явж буй сэшн = now − эхлэл; цаг ухарсан ч сөрөг биш', () => {
  const now = Date.parse('2026-09-29T03:00:00.000Z');
  assert.equal(sessionMs({ task_id: 1, started_at: '2026-09-29T01:00:00.000Z', ended_at: null }, now, null), 2 * H);
  assert.equal(
    sessionMs({ task_id: 1, started_at: '2026-09-29T01:00:00.000Z', ended_at: '2026-09-29T00:59:00.000Z' }, now, null),
    0,
  );
});

test('түүхэн сэшнүүдийн нийт: 09:00–10:00, 10:30–11:45, 13:00–14:12 = 03:27:00', () => {
  // CEO-ийн жишээ (УБ цаг) — UTC нь −8.
  const s = [
    { task_id: 7, started_at: '2026-09-29T01:00:00.000Z', ended_at: '2026-09-29T02:00:00.000Z' },
    { task_id: 7, started_at: '2026-09-29T02:30:00.000Z', ended_at: '2026-09-29T03:45:00.000Z' },
    { task_id: 7, started_at: '2026-09-29T05:00:00.000Z', ended_at: '2026-09-29T06:12:00.000Z' },
  ];
  const r = summarizeWindow(s, Date.parse('2026-09-29T10:00:00.000Z'), ubDayWindow('2026-09-29', UB), null);
  assert.equal(r.official_ms, 3 * H + 27 * 60_000);
  assert.equal(r.by_task.get(7), 3 * H + 27 * 60_000);
  // Цайны дүрэм 2026-10-01-нээс — 09-29-ний бүртгэл ХЭВЭЭР (эзний шийдвэр).
  const withLunch = summarizeWindow(s, Date.parse('2026-09-29T10:00:00.000Z'), ubDayWindow('2026-09-29', UB), LUNCH);
  assert.equal(withLunch.official_ms, 3 * H + 27 * 60_000);
});

test('«өнөөдөр» зөвхөн УБ-ын тухайн өдөр: шөнө дундыг давсан сэшн хуваагдана', () => {
  const today = ubDayWindow('2026-09-29', UB);
  const s = [
    // өчигдөр 10:00–12:00 УБ
    { task_id: 1, started_at: '2026-09-28T02:00:00.000Z', ended_at: '2026-09-28T04:00:00.000Z' },
    // өчигдөр 23:00 → өнөөдөр 01:00 УБ (өнөөдөрт 1 цаг)
    { task_id: 2, started_at: '2026-09-28T15:00:00.000Z', ended_at: '2026-09-28T17:00:00.000Z' },
    // маргааш 00:30 УБ-аас
    { task_id: 3, started_at: '2026-09-29T16:30:00.000Z', ended_at: '2026-09-29T17:00:00.000Z' },
  ];
  const now = Date.parse('2026-09-30T00:00:00.000Z');
  assert.equal(clippedMs(s[0]!, now, today, null), 0);
  assert.equal(clippedMs(s[1]!, now, today, null), H);
  assert.equal(clippedMs(s[2]!, now, today, null), 0);
  assert.equal(summarizeWindow(s, now, today, null).official_ms, H);

  const days = splitByUbDay(s, now, UB, '2026-09-28', '2026-09-30', null);
  assert.equal(days.get('2026-09-28')?.get(1), 2 * H);
  assert.equal(days.get('2026-09-28')?.get(2), H);
  assert.equal(days.get('2026-09-29')?.get(2), H);
  assert.equal(days.get('2026-09-30')?.get(3), 30 * 60_000);
});

test('startOutcome: хаасан/оруулсан мөрөөс', () => {
  assert.equal(startOutcome(0, 1), 'started');
  assert.equal(startOutcome(1, 1), 'switched');
  assert.equal(startOutcome(0, 0), 'already_running');
});

test('23:59 зогсолт: эхэлсэн УБ өдрийн 23:59:59.999 (UTC 15:59:59.999)', () => {
  // УБ 2026-09-29 17:30-д эхэлсэн (UTC 09:30) → тэр өдрийн 23:59:59.999 УБ.
  assert.equal(dayEndCutoffIso('2026-09-29T09:30:00.000Z', UB), '2026-09-29T15:59:59.999Z');
  // УБ 00:10-д эхэлсэн (UTC өмнөх өдөр 16:10) → ТЭР УБ өдрийн төгсгөл.
  assert.equal(dayEndCutoffIso('2026-09-28T16:10:00.000Z', UB), '2026-09-29T15:59:59.999Z');
});

test('toUtcIso: ирцийн +08:00 → Z; эвдэрсэн → null', () => {
  assert.equal(toUtcIso('2026-10-01T18:05:00+08:00'), '2026-10-01T10:05:00.000Z');
  assert.equal(toUtcIso('nope'), null);
});

/* ------------------------------------------------------------------ */
/*  Цайны цаг (эзэн 2026-10-01): 13:00–14:00 тоологдохгүй                */
/* ------------------------------------------------------------------ */

test('officialLunchOf: ирцийн тохиргооноос; унтраасан / буруу цонх → null', () => {
  assert.deepEqual(LUNCH, { startMin: 780, endMin: 840, fromDate: OFFICIAL_LUNCH_FROM, offsetMinutes: UB });
  assert.equal(OFFICIAL_LUNCH_FROM, '2026-10-01');
  assert.equal(officialLunchOf({ lunchEnabled: false, lunchStart: '13:00', lunchEnd: '14:00' }, UB), null);
  assert.equal(officialLunchOf({ lunchEnabled: true, lunchStart: '14:00', lunchEnd: '13:00' }, UB), null);
  assert.equal(officialLunchOf({ lunchEnabled: true, lunchStart: '13:00', lunchEnd: '13:00' }, UB), null);
  assert.equal(officialLunchOf({ lunchEnabled: true, lunchStart: '1pm', lunchEnd: '14:00' }, UB), null);
});

test('цайны цонх хасагдана: эзний жишээнүүд (2026-10-02)', () => {
  const c = (a: string, b: string) => countedMs(ub(a), ub(b), LUNCH);
  // 12:30-д эхлүүлсэн, 14:30-д зогсоосон → 13:00-д хөлдөж 14:00-д үргэлжилсэн = 1 цаг.
  assert.equal(c('2026-10-02 12:30', '2026-10-02 14:30'), H);
  // Цайны цагийн дотор бүхэлдээ → 0.
  assert.equal(c('2026-10-02 13:15', '2026-10-02 13:45'), 0);
  // Цайны цагт эхлүүлсэн → 14:00-аас тоолно.
  assert.equal(c('2026-10-02 13:30', '2026-10-02 15:00'), H);
  // Бүтэн ажлын өдөр 09:00–17:00 → 7 цаг.
  assert.equal(c('2026-10-02 09:00', '2026-10-02 17:00'), 7 * H);
  // Хил: 13:00-д зогссон / 14:00-д эхэлсэн нь бүтнээрээ.
  assert.equal(c('2026-10-02 12:00', '2026-10-02 13:00'), H);
  assert.equal(c('2026-10-02 14:00', '2026-10-02 15:00'), H);
  assert.equal(lunchOverlapMs(ub('2026-10-02 12:59'), ub('2026-10-02 14:01'), LUNCH), H);
  // Цонхгүй (ирцэд унтраасан) → түүхий үргэлжлэл.
  assert.equal(countedMs(ub('2026-10-02 12:30'), ub('2026-10-02 14:30'), null), 2 * H);
});

test('ЗӨВХӨН 2026-10-01-нээс: өмнөх өдрүүд хэвээр, хоёр өдрийг дамнасан сэшн өдөр бүрээр', () => {
  assert.equal(countedMs(ub('2026-09-30 12:30'), ub('2026-09-30 14:30'), LUNCH), 2 * H);
  assert.equal(countedMs(ub('2026-10-01 12:30'), ub('2026-10-01 14:30'), LUNCH), H);
  // 09-30 13:00 → 10-01 14:30: 25.5 ц − зөвхөн 10-01-ний цай (1 ц).
  assert.equal(countedMs(ub('2026-09-30 13:00'), ub('2026-10-01 14:30'), LUNCH), 24 * H + 30 * MIN);
  // 10-02 12:00 → 10-03 15:00: 27 ц − хоёр өдрийн цай (2 ц).
  assert.equal(countedMs(ub('2026-10-02 12:00'), ub('2026-10-03 15:00'), LUNCH), 25 * H);
});

test('явж буй таймер цайны цагт хөлдөж, 14:00-д өөрөө үргэлжилнэ', () => {
  const s = { task_id: 1, started_at: iso(ub('2026-10-02 12:00')), ended_at: null };
  assert.equal(sessionMs(s, ub('2026-10-02 12:59'), LUNCH), 59 * MIN);
  assert.equal(sessionMs(s, ub('2026-10-02 13:00'), LUNCH), H);
  assert.equal(sessionMs(s, ub('2026-10-02 13:40'), LUNCH), H);
  assert.equal(sessionMs(s, ub('2026-10-02 14:00'), LUNCH), H);
  assert.equal(sessionMs(s, ub('2026-10-02 14:10'), LUNCH), H + 10 * MIN);
});

test('өдрийн тайлан / муж: өдөр бүрийн хэсгээс цай хасагдана; цайны дотор бүхэлдээ байсан сэшн тоологдохгүй', () => {
  const s = [
    { task_id: 7, started_at: iso(ub('2026-10-02 12:30')), ended_at: iso(ub('2026-10-02 14:30')) },
    { task_id: 8, started_at: iso(ub('2026-10-02 13:10')), ended_at: iso(ub('2026-10-02 13:50')) },
  ];
  const now = ub('2026-10-03 09:00');
  const days = splitByUbDay(s, now, UB, '2026-10-02', '2026-10-02', LUNCH);
  assert.equal(days.get('2026-10-02')?.get(7), H);
  assert.equal(days.get('2026-10-02')?.has(8), false);
  const r = summarizeRange(s, now, UB, '2026-10-02', '2026-10-02', LUNCH);
  assert.deepEqual(r, { official_ms: H, active_days: 1, sessions: 1, tasks: 1 });
  assert.equal(clippedMs(s[0]!, now, ubDayWindow('2026-10-02', UB), LUNCH), H);
});

/** Тогтмол үртэй санамсаргүй тоо (LCG) — тест бүр ижил интервалууд. */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

function sqlTwin(lunch: OfficialLunch | null, rows: Array<[number, number]>): number[] {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, started_at TEXT, ended_at TEXT)');
  const ins = db.prepare('INSERT INTO t (id, started_at, ended_at) VALUES (?, ?, ?)');
  rows.forEach(([a, b], i) => ins.run(i + 1, iso(a), iso(b)));
  const out = db.prepare(`SELECT ${officialMsSql('s', lunch)} AS ms FROM t s ORDER BY s.id`).all() as Array<{ ms: number }>;
  db.close();
  return out.map((r) => Number(r.ms));
}

test('officialMsSql ↔ countedMs: ≤ 48 цагийн сэшнд ЯГ ижил (санамсаргүй + хилийн тохиолдол)', () => {
  const r = rng(20261001);
  const base = ub('2026-09-29 00:00');
  const rows: Array<[number, number]> = [
    [ub('2026-10-02 12:30'), ub('2026-10-02 14:30')],
    [ub('2026-10-02 13:00'), ub('2026-10-02 14:00')],
    [ub('2026-09-30 13:00'), ub('2026-10-01 14:30')],
    [ub('2026-10-02 12:00'), ub('2026-10-03 15:00')],
    [ub('2026-10-01 00:00'), ub('2026-10-01 23:59') + 59_999],
    [ub('2026-10-02 13:30') + 123, ub('2026-10-02 13:30') + 123],
  ];
  for (let i = 0; i < 400; i++) {
    const a = base + Math.floor(r() * 7 * 24 * H);
    const len = Math.floor(r() * (i % 4 === 0 ? 47 * H : 6 * H));
    rows.push([a, a + len]);
  }
  for (const lunch of [LUNCH, null, { startMin: 720, endMin: 765, fromDate: '2026-09-30', offsetMinutes: -300 }]) {
    const sql = sqlTwin(lunch, rows);
    rows.forEach(([a, b], i) => assert.equal(sql[i], countedMs(a, b, lunch), `row ${i} ${iso(a)} → ${iso(b)}`));
  }
});

test('frontend ихэр (`features/task-timer/stopwatch.ts`) — ЯГ ижил томьёо (санамсаргүй интервал, 2 тохиргоо)', async () => {
  const F = await import('../../../frontend/src/features/task-timer/stopwatch.ts');
  const r = rng(424242);
  const base = ub('2026-09-29 00:00');
  const pairs: Array<[OfficialLunch, unknown]> = [
    [LUNCH, { start_min: 780, end_min: 840, from: '2026-10-01', offset_min: 480 }],
    [{ startMin: 720, endMin: 765, fromDate: '2026-09-30', offsetMinutes: -300 }, { start_min: 720, end_min: 765, from: '2026-09-30', offset_min: -300 }],
  ];
  for (const [back, wire] of pairs) {
    const front = F.lunchRuleOf(wire);
    assert.ok(front);
    for (let i = 0; i < 400; i++) {
      const a = base + Math.floor(r() * 9 * 24 * H);
      const b = a + Math.floor(r() * (i % 3 === 0 ? 72 * H : 5 * H));
      assert.equal(F.lunchOverlapMs(a, b, front), lunchOverlapMs(a, b, back), `overlap ${iso(a)} → ${iso(b)}`);
      assert.equal(F.countedMs(a, b, front), countedMs(a, b, back), `counted ${iso(a)} → ${iso(b)}`);
    }
  }
});
