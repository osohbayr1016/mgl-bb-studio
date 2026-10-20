/**
 * `lib/reportWindows.ts` — цонхны муж, УБ↔UTC хил, огнооны арифметик.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Өргөтгөлгүй харьцангуй импорт (`./orgConfig`) — webPush.test.ts-тэй ижил hook.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  resolveWindow,
  isoAddDays,
  daysBetween,
  ubDayBoundsUtc,
  sqliteOffsetModifier,
  parseOffsetMinutes,
  isIsoDate,
  pickAllTimeFrom,
  listDates,
  monthAdd,
  lastDayOfMonth,
} = await import('./reportWindows.ts');

test('isoAddDays: сар, жилийн хилээр зөв гулсана', () => {
  assert.equal(isoAddDays('2026-09-15', -1), '2026-09-14');
  assert.equal(isoAddDays('2026-03-01', -1), '2026-02-28');
  assert.equal(isoAddDays('2024-03-01', -1), '2024-02-29'); // өндөр жил
  assert.equal(isoAddDays('2026-12-31', 1), '2027-01-01');
  assert.equal(isoAddDays('2026-01-01', -1), '2025-12-31');
});

test('daysBetween багтсан тоолно', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-07'), 7);
  assert.equal(daysBetween('2026-09-15', '2026-09-15'), 1);
});

test('resolveWindow: day / 7d / 14d', () => {
  const d = resolveWindow('day', '2026-09-15');
  assert.deepEqual(d.current, { from: '2026-09-15', to: '2026-09-15' });
  assert.deepEqual(d.previous, { from: '2026-09-14', to: '2026-09-14' });
  assert.equal(d.days, 1);

  const w = resolveWindow('7d', '2026-09-15');
  assert.deepEqual(w.current, { from: '2026-09-09', to: '2026-09-15' });
  assert.deepEqual(w.previous, { from: '2026-09-02', to: '2026-09-08' });
  assert.equal(w.days, 7);

  const f = resolveWindow('14d', '2026-09-15');
  assert.deepEqual(f.current, { from: '2026-09-02', to: '2026-09-15' });
  assert.deepEqual(f.previous, { from: '2026-08-19', to: '2026-09-01' });
  assert.equal(f.days, 14);
});

test('resolveWindow: month — сарын дунд өмнөх сарын ижил тооны өдөртэй харьцуулна', () => {
  const m = resolveWindow('month', '2026-09-15');
  assert.deepEqual(m.current, { from: '2026-09-01', to: '2026-09-15' });
  assert.deepEqual(m.previous, { from: '2026-08-01', to: '2026-08-15' });
  assert.equal(m.days, 15);

  // Сарын 1 → өмнөх сарын 1 л.
  const first = resolveWindow('month', '2026-03-01');
  assert.deepEqual(first.previous, { from: '2026-02-01', to: '2026-02-01' });

  // 3-р сарын 31 → 2-р сар 28 өдөртэй тул сүүлээр таслана.
  const clip = resolveWindow('month', '2026-03-31');
  assert.deepEqual(clip.previous, { from: '2026-02-01', to: '2026-02-28' });

  // 1-р сар → өмнөх жилийн 12-р сар.
  const jan = resolveWindow('month', '2026-01-10');
  assert.deepEqual(jan.previous, { from: '2025-12-01', to: '2025-12-10' });
});

test('resolveWindow: all — өмнөх муж байхгүй', () => {
  const a = resolveWindow('all', '2026-09-15');
  assert.equal(a.current.from, '2000-01-01');
  assert.equal(a.current.to, '2026-09-15');
  assert.equal(a.previous, null);
});

test('ubDayBoundsUtc: УБ өдөр = UTC өмнөх өдрийн 16:00-аас', () => {
  const b = ubDayBoundsUtc('2026-09-15', '2026-09-15', 480);
  assert.equal(b.startUtc, '2026-09-14 16:00:00');
  assert.equal(b.endUtcExclusive, '2026-09-15 16:00:00');

  const w = ubDayBoundsUtc('2026-09-09', '2026-09-15', 480);
  assert.equal(w.startUtc, '2026-09-08 16:00:00');
  assert.equal(w.endUtcExclusive, '2026-09-15 16:00:00');

  // UTC бүс — өөрчлөлтгүй.
  const z = ubDayBoundsUtc('2026-09-15', '2026-09-15', 0);
  assert.equal(z.startUtc, '2026-09-15 00:00:00');
  assert.equal(z.endUtcExclusive, '2026-09-16 00:00:00');
});

test('sqliteOffsetModifier / parseOffsetMinutes', () => {
  assert.equal(sqliteOffsetModifier(480), '+480 minutes');
  assert.equal(sqliteOffsetModifier(-210), '-210 minutes');
  assert.equal(parseOffsetMinutes('GMT+08:00'), 480);
  assert.equal(parseOffsetMinutes('GMT+8'), 480);
  assert.equal(parseOffsetMinutes('UTC-03:30'), -210);
  assert.equal(parseOffsetMinutes('GMT'), 0);
});

test('isIsoDate — хуурамч огноог хаана', () => {
  assert.ok(isIsoDate('2026-09-15'));
  assert.ok(!isIsoDate('2026-02-30'));
  assert.ok(!isIsoDate('2026-9-5'));
  assert.ok(!isIsoDate('20260915'));
  assert.ok(!isIsoDate(null));
});

test('pickAllTimeFrom: ажилд орсон өдөр биш, бүртгэл ба анхны ажлын хувь', () => {
  // Бүртгэл ажлын хувиас эрт → бүртгэл.
  assert.equal(pickAllTimeFrom('2026-09-25', '2026-06-01', '2026-07-15'), '2026-06-01');
  // Ажлын хувь бүртгэлээс эрт (буцааж бичсэн) → тэр өдөр.
  assert.equal(pickAllTimeFrom('2026-09-25', '2026-08-01', '2026-05-04'), '2026-05-04');
  // Зөвхөн бүртгэл.
  assert.equal(pickAllTimeFrom('2026-09-25', '2026-03-02', null), '2026-03-02');
  // Аль нь ч байхгүй, эсвэл anchor-оос хойш → anchor.
  assert.equal(pickAllTimeFrom('2026-09-25', null, null), '2026-09-25');
  assert.equal(pickAllTimeFrom('2026-09-25', '2026-10-01', '2027-01-01'), '2026-09-25');
  // hired_at мэт буруу огноо, цагтай бүртгэл — isIsoDate хаана.
  assert.equal(pickAllTimeFrom('2026-09-25', '2026-06-01T00:00:00', 'not-a-date'), '2026-09-25');
});

test('listDates / monthAdd / lastDayOfMonth', () => {
  assert.deepEqual(listDates('2026-09-13', '2026-09-15'), ['2026-09-13', '2026-09-14', '2026-09-15']);
  assert.equal(monthAdd('2026-01', -1), '2025-12');
  assert.equal(monthAdd('2026-12', 1), '2027-01');
  assert.equal(lastDayOfMonth('2026-02'), '2026-02-28');
  assert.equal(lastDayOfMonth('2024-02'), '2024-02-29');
});
