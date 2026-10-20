/**
 * `lib/teamProductivity.ts` — багийн профайлын «Бүтээмж» табын цэвэр дүрэм:
 * хугацаа (өдөр / 7 хоног / сар), өдрийн дундаж (чөлөө хувийг хөдөлгөхгүй),
 * дээд ↔ доод хүний зөрүү, шугам, анхааруулгын бичвэр.
 *
 * ⚠️ `workSchedule.ts` өргөтгөлгүй import-тэй тул `registerHooks` resolver
 *    эхлээд (leaveAvailability.test.ts-тэй ижил).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  weekStart,
  periodRange,
  resolvePeriod,
  historyRanges,
  memberAverage,
  hasWorkingDay,
  computeGap,
  pctOfTop,
  neededPerDay,
  parseThresholdPct,
  fmtAvgPct,
  fmtPlainPct,
  buildWarningText,
  ratePct,
  DEFAULT_GAP_THRESHOLD_PCT,
} = await import('./teamProductivity.ts');

const NONE = new Set<string>();
const pts = (entries: Record<string, number>) => new Map(Object.entries(entries));

// 2026-09-21 = Даваа … 2026-09-27 = Ням.  2026-09-24 = Пүрэв.
describe('хугацаа', () => {
  test('7 хоног Даваагаас эхэлнэ', () => {
    assert.equal(weekStart('2026-09-24'), '2026-09-21');
    assert.equal(weekStart('2026-09-21'), '2026-09-21');
    assert.equal(weekStart('2026-09-27'), '2026-09-21'); // Ням — өмнөх Даваа
    assert.equal(weekStart('2026-09-28'), '2026-09-28');
  });

  test('сар = хуанлийн сар, 2-р сар богино', () => {
    assert.deepEqual(periodRange('month', '2026-09-24'), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(periodRange('month', '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(periodRange('day', '2026-09-24'), { from: '2026-09-24', to: '2026-09-24' });
  });

  test('одоогийн 7 хоног өнөөдрөөр таслагдана, дараагийнх байхгүй', () => {
    const p = resolvePeriod('week', '2026-09-24', '2026-09-24');
    assert.equal(p.from, '2026-09-21');
    assert.equal(p.to, '2026-09-27');
    assert.equal(p.until, '2026-09-24');
    assert.equal(p.current, true);
    assert.equal(p.prev_date, '2026-09-14');
    assert.equal(p.next_date, null);
  });

  test('өнгөрсөн 7 хоног — бүтэн, дараагийн руу шилжиж болно', () => {
    const p = resolvePeriod('week', '2026-09-10', '2026-09-24');
    assert.deepEqual([p.from, p.to, p.until, p.current], ['2026-09-07', '2026-09-13', '2026-09-13', false]);
    assert.equal(p.next_date, '2026-09-14');
  });

  test('ирээдүйн огноо өнөөдөр болж буурна', () => {
    const p = resolvePeriod('day', '2027-01-01', '2026-09-24');
    assert.deepEqual([p.from, p.to, p.next_date, p.prev_date], ['2026-09-24', '2026-09-24', null, '2026-09-23']);
  });

  test('сар — өмнөх/дараагийн сар', () => {
    const aug = resolvePeriod('month', '2026-08-15', '2026-09-24');
    assert.deepEqual([aug.from, aug.to, aug.prev_date, aug.next_date], ['2026-08-01', '2026-08-31', '2026-07-01', '2026-09-01']);
    const sep = resolvePeriod('month', '2026-09-24', '2026-09-24');
    assert.equal(sep.next_date, null);
    assert.equal(sep.until, '2026-09-24');
  });

  test('түүх — хуучнаас шинэ рүү, одоогийнх нь өнөөдрөөр таслагдсан', () => {
    const p = resolvePeriod('week', '2026-09-24', '2026-09-24');
    assert.deepEqual(historyRanges(p, 3), [
      { from: '2026-09-07', to: '2026-09-13' },
      { from: '2026-09-14', to: '2026-09-20' },
      { from: '2026-09-21', to: '2026-09-24' },
    ]);
    const m = resolvePeriod('month', '2026-03-05', '2026-09-24');
    assert.deepEqual(historyRanges(m, 2), [
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-03-31' },
    ]);
  });
});

describe('өдрийн дундаж', () => {
  const WEEK = { from: '2026-09-14', to: '2026-09-20' }; // Да–Ня, 5 ажлын өдөр

  test('амралтын өдрийн оноо нийлбэрт орно, хуваарьт орохгүй', () => {
    const r = memberAverage({ joined: null, points: pts({ '2026-09-14': 0.1, '2026-09-16': 0.2, '2026-09-19': 0.05 }), leave: NONE }, WEEK, NONE);
    assert.equal(r.work_days, 5);
    assert.equal(r.leave_days, 0);
    assert.ok(Math.abs(r.points - 0.35) < 1e-12);
    assert.ok(Math.abs((r.avg ?? 0) - 0.07) < 1e-12);
  });

  test('батлагдсан чөлөө хуваарьнаас хасагдана — хувь буурахгүй', () => {
    const r = memberAverage({ joined: null, points: pts({ '2026-09-14': 0.1, '2026-09-16': 0.3 }), leave: new Set(['2026-09-15']) }, WEEK, NONE);
    assert.equal(r.work_days, 4);
    assert.equal(r.leave_days, 1);
    assert.ok(Math.abs((r.avg ?? 0) - 0.1) < 1e-12);
  });

  test('чөлөөтэй өдөр оноо авсан бол энгийн ажлын өдөр', () => {
    const r = memberAverage({ joined: null, points: pts({ '2026-09-15': 0.2 }), leave: new Set(['2026-09-15']) }, WEEK, NONE);
    assert.equal(r.work_days, 5);
    assert.equal(r.leave_days, 0);
  });

  test('баярын өдөр тоологдохгүй', () => {
    const r = memberAverage({ joined: null, points: undefined, leave: undefined }, WEEK, new Set(['2026-09-14']));
    assert.equal(r.work_days, 4);
    assert.equal(r.avg, 0); // ирээгүй/ажиллаагүй = 0, null биш
  });

  test('хугацааны дунд орсон хүн орсон өдрөөсөө тоологдоно', () => {
    const r = memberAverage({ joined: '2026-09-16', points: pts({ '2026-09-16': 0.3 }), leave: NONE }, WEEK, NONE);
    assert.equal(r.work_days, 3);
    assert.ok(Math.abs((r.avg ?? 0) - 0.1) < 1e-12);
  });

  test('хугацааны дараа орсон, бүтэн чөлөөтэй, амралтын өдөр — дундажгүй (null)', () => {
    assert.equal(memberAverage({ joined: '2026-09-21', points: undefined, leave: NONE }, WEEK, NONE).avg, null);
    const allLeave = new Set(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18']);
    const r = memberAverage({ joined: null, points: undefined, leave: allLeave }, WEEK, NONE);
    assert.deepEqual([r.work_days, r.leave_days, r.avg], [0, 5, null]);
    const sat = memberAverage({ joined: null, points: pts({ '2026-09-19': 0.4 }), leave: NONE }, { from: '2026-09-19', to: '2026-09-19' }, NONE);
    assert.deepEqual([sat.work_days, sat.avg], [0, null]);
    assert.ok(Math.abs(sat.points - 0.4) < 1e-12);
  });

  test('ажлын өдөр байгаа эсэх', () => {
    assert.equal(hasWorkingDay({ from: '2026-09-19', to: '2026-09-20' }, NONE), false);
    assert.equal(hasWorkingDay({ from: '2026-09-18', to: '2026-09-18' }, NONE), true);
    assert.equal(hasWorkingDay({ from: '2026-09-18', to: '2026-09-18' }, new Set(['2026-09-18'])), false);
  });
});

describe('зөрүү', () => {
  test('0.20 ба 0.15 → 25%, 20%-ийн босгыг хэтэрсэн, шугам 0.16', () => {
    const g = computeGap([{ user_id: 1, avg: 0.2 }, { user_id: 2, avg: 0.15 }, { user_id: 3, avg: 0.18 }], 20);
    assert.equal(g.gap_pct, 25);
    assert.equal(g.exceeded, true);
    assert.equal(g.top_user_id, 1);
    assert.equal(g.bottom_user_id, 2);
    assert.ok(Math.abs((g.line ?? 0) - 0.16) < 1e-12);
    assert.equal(g.compared, 3);
  });

  test('яг 20% нь хэтрээгүй (хөвөгч таслалын 20.000…04 гэж алдахгүй)', () => {
    const g = computeGap([{ user_id: 1, avg: 0.2 }, { user_id: 2, avg: 0.16 }], 20);
    assert.equal(g.gap_pct, 20);
    assert.equal(g.exceeded, false);
  });

  test('босгоос бага зөрүү', () => {
    const g = computeGap([{ user_id: 1, avg: 0.048 }, { user_id: 2, avg: 0.0393 }], 20);
    assert.equal(g.exceeded, false);
    assert.equal(g.gap_pct, 18.1);
  });

  test('дундажгүй (null) гишүүн харьцуулалтад орохгүй; ганц хүн → зөрүүгүй', () => {
    const g = computeGap([{ user_id: 1, avg: 0.2 }, { user_id: 2, avg: null }], 20);
    assert.equal(g.compared, 1);
    assert.equal(g.gap_pct, null);
    assert.equal(g.bottom_user_id, null);
    assert.equal(g.exceeded, false);
    assert.equal(g.top_user_id, 1);
  });

  test('бүгд 0 → зөрүү 0; тэнцвэл user_id-аар тогтвортой', () => {
    const g = computeGap([{ user_id: 5, avg: 0 }, { user_id: 3, avg: 0 }], 20);
    assert.deepEqual([g.gap_pct, g.exceeded, g.top_user_id, g.bottom_user_id, g.line], [0, false, 3, 5, 0]);
  });

  test('хүнгүй баг', () => {
    const g = computeGap([], 20);
    assert.deepEqual([g.compared, g.top_user_id, g.gap_pct, g.line], [0, null, null, null]);
  });

  test('дээд хүний хувь, шугамд хүрэх нэмэгдэл', () => {
    assert.equal(pctOfTop(0.1, 0.2), 50);
    assert.equal(pctOfTop(0.1, 0), null);
    assert.equal(pctOfTop(null, 0.2), null);
    assert.ok(Math.abs((neededPerDay(0.1, 0.16) ?? 0) - 0.06) < 1e-12);
    assert.equal(neededPerDay(0.2, 0.16), 0);
    assert.equal(neededPerDay(null, 0.16), null);
  });
});

describe('туслахууд', () => {
  test('босго: 1–100, буруу утга → 20', () => {
    assert.equal(parseThresholdPct('25'), 25);
    assert.equal(parseThresholdPct(0), 1);
    assert.equal(parseThresholdPct(150), 100);
    assert.equal(parseThresholdPct('abc'), DEFAULT_GAP_THRESHOLD_PCT);
    assert.equal(parseThresholdPct(null), DEFAULT_GAP_THRESHOLD_PCT);
    assert.equal(parseThresholdPct(''), DEFAULT_GAP_THRESHOLD_PCT);
    assert.equal(parseThresholdPct(12.34), 12.3);
  });

  test('хувь форматлах', () => {
    assert.equal(fmtAvgPct(0.0564), '0.056%');
    assert.equal(fmtAvgPct(1.234), '1.2%');
    assert.equal(fmtAvgPct(null), '—');
    assert.equal(fmtPlainPct(25), '25%');
    assert.equal(fmtPlainPct(12.5), '12.5%');
    assert.equal(ratePct(17, 19), 89.5);
    assert.equal(ratePct(1, 0), null);
  });

  test('анхааруулгын бичвэр — серверийн тоо, 8-аас олон нэрийг товчилно', () => {
    const gap = computeGap([{ user_id: 1, avg: 0.216 }, { user_id: 2, avg: 0.0002 }], 20);
    const below = Array.from({ length: 10 }, (_, i) => ({ full_name: `Хүн ${i + 1}`, avg: 0.01, need: 0.16 }));
    const { title, body } = buildWarningText({
      team_code: 'BA',
      team_name: 'Барилга архитектур',
      kind: 'week',
      from: '2026-09-14',
      to: '2026-09-20',
      gap,
      top_name: 'Наянбуу',
      bottom_name: 'Тэлмэн',
      below,
      note: 'Энэ 7 хоногт анхаар',
      sender_name: 'Захирал',
    });
    assert.equal(title, 'BA баг: гишүүдийн бүтээмжийн зөрүү 99.9% (босго 20%)');
    assert.match(body, /2026-09-14 – 2026-09-20 \(7 хоног\)/);
    assert.match(body, /Хамгийн өндөр: Наянбуу — өдөрт 0\.216%/);
    assert.match(body, /Шугам \(дээд хүний 80%\): өдөрт 0\.173%/);
    assert.match(body, /Шугамаас доош 10 хүн: .*Хүн 8 0\.01% \(\+0\.16%\/өдөр\) … \+2/);
    assert.match(body, /Захирлын тэмдэглэл: Энэ 7 хоногт анхаар/);
    assert.match(body, /Илгээсэн: Захирал$/);
    // Мэдэгдлийн UI мөр таслалыг хадгалдаггүй — « · »-оор холбоно.
    assert.ok(!body.includes('\n'));
    assert.match(body, / · Хамгийн өндөр: Наянбуу/);
  });
});
