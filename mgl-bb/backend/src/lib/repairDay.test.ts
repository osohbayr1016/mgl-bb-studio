/**
 * `lib/repairDay.ts` — засварын цагийг өдрийн бөглөлтөөс автоматаар бодох
 * (миграц 0348).  Эзний жишээнүүд үг үсгээрээ тест болсон.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateDay,
  netMinutes,
  minutesIntoDay,
  hhmmToMinutes,
  roundHours,
  roundHoursPreservingTotal,
  repairItemKey,
  type DayWindow,
  type DayEvent,
} from './repairDay.ts';

const h = (hh: number, mm = 0) => hh * 60 + mm;
/** 08:00–17:00, цай 13–14 → 8 цаг (MGL-ийн «early» ээлж, 43 хүн). */
const EARLY: DayWindow = { start: h(8), end: h(17), lunch: { start: h(13), end: h(14) }, blocked: [] };
/** 09:00–18:00, цай 13–14. */
const STANDARD: DayWindow = { start: h(9), end: h(18), lunch: { start: h(13), end: h(14) }, blocked: [] };

const mark = (id: number, key: string, at: number): DayEvent => ({ key, at, markId: id });
const fill = (key: string, at: number): DayEvent => ({ key, at });
const hoursOf = (events: DayEvent[], window = EARLY, manual = 0) =>
  allocateDay(window, events, manual).hoursByMark;
const near = (actual: number | undefined, expected: number, label = '') =>
  assert.ok(Math.abs((actual ?? NaN) - expected) < 1e-9, `${label} expected ${expected}, got ${actual}`);

describe('owner rules', () => {
  test('repair picked in the morning, one task filled at the end of the day → 8 h', () => {
    near(hoursOf([mark(1, 't:10', h(16, 55))]).get(1), 8);
  });

  test('filled early and left (16:40) still counts the whole day', () => {
    near(hoursOf([mark(1, 't:10', h(16, 40))]).get(1), 8);
  });

  test('two repair tasks filled together → 4 + 4', () => {
    const m = hoursOf([mark(1, 't:10', h(16, 50)), mark(2, 't:11', h(16, 52))]);
    near(m.get(1), 4);
    near(m.get(2), 4);
  });

  test('morning work filled at 12:00, repair filled at the end → repair from 12:00 (lunch removed)', () => {
    const early = hoursOf([fill('n:5', h(12)), mark(1, 't:10', h(16, 58))], EARLY);
    near(early.get(1), 4, '08–17 shift: 12–17 minus lunch');
    const std = hoursOf([fill('n:5', h(12)), mark(1, 't:10', h(17, 50))], STANDARD);
    near(std.get(1), 5, '09–18 shift: 12–18 minus lunch');
  });

  test('1 repair task + 3 normal tasks in one sitting → 2 h each («бүгд нийлээд 8 цаг»)', () => {
    const m = hoursOf([
      fill('n:1', h(16, 50)),
      fill('n:2', h(16, 51)),
      mark(1, 't:10', h(16, 52)),
      fill('n:3', h(16, 53)),
    ]);
    near(m.get(1), 2);
  });

  test('N tasks in one sitting → 8 / N, however many', () => {
    const events: DayEvent[] = [];
    for (let i = 0; i < 53; i++) events.push(fill(`n:${i}`, h(16, 50)));
    events.push(mark(99, 't:500', h(16, 59)));
    near(hoursOf(events).get(99), 8 / 54);
  });

  test('the whole day always adds up to 8 h (per sitting, per task)', () => {
    const r = allocateDay(EARLY, [
      mark(1, 't:1', h(10)),
      fill('n:2', h(12, 30)),
      mark(2, 't:3', h(16, 50)),
      mark(3, 'r:4', h(16, 55)),
    ]);
    const sum = r.sittings.reduce((s, x) => s + x.minutes, 0);
    near(sum, 8 * 60);
    near(r.hoursByMark.get(1), 2, '08–10');
    // 10:00–12:30 = 2.5 h → normal task (not credited to any mark)
    near(r.hoursByMark.get(2), 1.75, '12:30–17 minus lunch = 3.5 h shared by two');
    near(r.hoursByMark.get(3), 1.75);
  });
});

describe('sittings', () => {
  test('fills a few minutes apart form one sitting; a 30+ minute gap splits it', () => {
    const r = allocateDay(EARLY, [fill('n:1', h(11)), fill('n:2', h(11, 20)), mark(1, 't:1', h(16, 50))]);
    assert.equal(r.sittings.length, 2);
    assert.deepEqual(r.sittings[0]!.keys, ['n:1', 'n:2']);
    assert.equal(r.sittings[0]!.to, h(11, 20), 'boundary = last fill of the sitting');
    near(r.hoursByMark.get(1), 4 + 40 / 60, '11:20–17:00 = 5h40 minus the lunch hour');
  });

  test('the same task filled twice in one sitting counts once', () => {
    const m = hoursOf([mark(1, 't:1', h(16, 50)), mark(2, 't:1', h(16, 51)), mark(3, 't:2', h(16, 52))]);
    near(m.get(3), 4, 'two distinct tasks → 4 h each');
    near((m.get(1) ?? 0) + (m.get(2) ?? 0), 4, 'the duplicate shares its task’s 4 h');
  });

  test('everything filled after the shift ended is one final sitting', () => {
    const m = hoursOf([mark(1, 't:1', h(17, 30)), mark(2, 't:2', h(19, 45))]);
    near(m.get(1), 4);
    near(m.get(2), 4);
  });

  test('a fill before the shift starts covers no time unless it is the only one', () => {
    near(hoursOf([mark(1, 't:1', h(7, 45))]).get(1), 8, 'only fill → whole day');
    const m = hoursOf([mark(1, 't:1', h(7, 45)), mark(2, 't:2', h(16, 50))]);
    near(m.get(1), 0, 'reported before work started');
    near(m.get(2), 8);
  });

  test('no events → nothing; a broken window → nothing', () => {
    assert.equal(allocateDay(EARLY, []).hoursByMark.size, 0);
    const bad = allocateDay({ ...EARLY, end: EARLY.start }, [mark(1, 't:1', h(12))]);
    assert.equal(bad.hoursByMark.size, 0);
  });
});

describe('time that is not repair time', () => {
  test('non-project work / sub-day leave is removed from the day', () => {
    const w: DayWindow = { ...EARLY, blocked: [{ start: h(9), end: h(11) }] };
    near(hoursOf([mark(1, 't:1', h(16, 50))], w).get(1), 6);
  });

  test('overlapping blocked intervals and lunch are removed once', () => {
    const w: DayWindow = { ...EARLY, blocked: [{ start: h(12), end: h(14) }, { start: h(13, 30), end: h(15) }] };
    // 12:00–15:00 blocked (lunch inside) → 8 − 2 (12–13 + 14–15) = 6
    near(hoursOf([mark(1, 't:1', h(16, 50))], w).get(1), 6);
  });

  test('hand-typed legacy hours are taken first, the rest is shared', () => {
    near(hoursOf([mark(1, 't:1', h(16, 50))], EARLY, 3).get(1), 5);
    near(hoursOf([mark(1, 't:1', h(16, 50))], EARLY, 9).get(1), 0, 'more than a day typed → nothing left');
    const r = allocateDay(EARLY, [fill('n:1', h(12)), mark(1, 't:1', h(16, 50))], 4);
    near(r.capacityMinutes, 240);
    near(r.hoursByMark.get(1), 2, 'sittings shrink proportionally: 4 h × 4/8');
  });
});

describe('helpers', () => {
  test('netMinutes clamps to the shift and removes lunch', () => {
    assert.equal(netMinutes(h(6), h(20), EARLY), 480);
    assert.equal(netMinutes(h(12), h(15), EARLY), 120);
    assert.equal(netMinutes(h(15), h(12), EARLY), 0);
    assert.equal(netMinutes(h(8), h(17), { ...EARLY, lunch: null }), 540);
  });

  test('minutesIntoDay converts a UTC sqlite timestamp into minutes of the UB day', () => {
    assert.equal(minutesIntoDay('2026-09-24 09:00:00', '2026-09-24', 480), h(17));
    assert.equal(minutesIntoDay('2026-09-23 23:45:50', '2026-09-24', 480), h(7, 45) + 50 / 60);
    assert.equal(minutesIntoDay('2026-09-25 01:00:00', '2026-09-24', 480), 24 * 60 + h(9), 'next day → ≥ 1440');
    assert.equal(minutesIntoDay(null, '2026-09-24', 480), null);
    assert.equal(minutesIntoDay('garbage', '2026-09-24', 480), null);
  });

  test('roundHoursPreservingTotal keeps the day at exactly 8 h', () => {
    const three = roundHoursPreservingTotal(new Map([[1, 8 / 3], [2, 8 / 3], [3, 8 / 3]]));
    assert.equal([...three.values()].reduce((s, v) => s + v, 0).toFixed(2), '8.00');
    assert.deepEqual([...three.values()].sort(), [2.66, 2.67, 2.67]);
    const odd = roundHoursPreservingTotal(new Map([[1, 8 / 54], [2, 53 * (8 / 54)], [3, 0]]));
    assert.equal(odd.get(3), 0);
    assert.equal(((odd.get(1) ?? 0) + (odd.get(2) ?? 0)).toFixed(2), '8.00');
    const clean = roundHoursPreservingTotal(new Map([[1, 4], [2, 4]]));
    assert.deepEqual([clean.get(1), clean.get(2)], [4, 4]);
  });

  test('hhmmToMinutes / roundHours / repairItemKey', () => {
    assert.equal(hhmmToMinutes('13:30'), h(13, 30));
    assert.equal(hhmmToMinutes('9:30'), null);
    assert.equal(roundHours(8 / 3), 2.67);
    assert.equal(roundHours(0.004), 0);
    assert.equal(roundHours(-1), 0);
    assert.equal(repairItemKey({ task_id: 7, project_id: 3 }), 't:7');
    assert.equal(repairItemKey({ project_id: 3 }), 'p:3');
    assert.equal(repairItemKey({ repair_project_id: 9 }), 'r:9');
  });
});
