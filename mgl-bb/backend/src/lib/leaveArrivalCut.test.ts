/**
 * `lib/leaveArrivalCut.ts` — батлагдсан чөлөөг ИРСЭН ЦАГААР богиносгох дүрэм.
 *
 * Run with:  node --test src/lib/leaveArrivalCut.test.ts
 *
 * Эзний жишээ (2026-09-29): 12:00 хүртэл чөлөөтэй хүн 09:00-д ирвэл чөлөө
 * 08:00–09:00 (1 цаг) болно.  Шийдвэрүүд: олон хоногийнд зөвхөн ирсэн өдөр;
 * ээлжийн эхэнд/эрт ирвэл 0 цаг.
 */
import { test } from 'node:test';
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

const { planDayCut, applyCuts, leaveMinutesPerDay, describeCut, formatMinutesMn } = await import(
  './leaveArrivalCut.ts'
);

const SHIFT_08 = { startMinutes: 8 * 60, endMinutes: 17 * 60 };
const SHIFT_09 = { startMinutes: 9 * 60, endMinutes: 18 * 60 };
const DAY = '2026-09-29'; // Мягмар
const hm = (h: number, m = 0) => h * 60 + m;

type Leave = Parameters<typeof planDayCut>[0]['leave'];
const timed = (start: string, end: string, hours: number, type = 'unpaid'): Leave => ({
  leave_type: type,
  start_date: DAY,
  end_date: DAY,
  start_time: start,
  end_time: end,
  hours,
  days: Math.round((hours / 8) * 100) / 100,
});
const fullDay = (from = DAY, to = DAY, type = 'annual'): Leave => {
  const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  return { leave_type: type, start_date: from, end_date: to, start_time: null, end_time: null, hours: span * 8, days: span };
};

const plan = (leave: Leave, arrival: number | null, over: Partial<Parameters<typeof planDayCut>[0]> = {}) =>
  planDayCut({ leave, date: DAY, arrivalMinutes: arrival, shift: SHIFT_08, graceMinutes: 0, isFreeDay: false, ...over });

test('эзний жишээ: 08:00–12:00 чөлөө, 09:00-д ирсэн → 08:00–09:00, 1 цаг', () => {
  const cut = plan(timed('08:00', '12:00', 4), hm(9));
  assert.deepEqual(cut, {
    date: DAY,
    arrival: '09:00',
    start_time: '08:00',
    end_time: '09:00',
    full_minutes: 240,
    used_minutes: 60,
  });
  const eff = applyCuts(timed('08:00', '12:00', 4), [cut!]);
  assert.deepEqual(eff, { start_time: '08:00', end_time: '09:00', hours: 1, days: 0.13 });
});

test('чөлөө дууссаны дараа ирвэл өөрчлөлтгүй (бүтэн ашигласан)', () => {
  assert.equal(plan(timed('08:00', '12:00', 4), hm(12)), null);
  assert.equal(plan(timed('08:00', '12:00', 4), hm(12, 47)), null);
});

test('ээлжийн эхэнд эсвэл эрт ирвэл өглөөний чөлөө 0 цаг (шийдвэр 2)', () => {
  assert.equal(plan(timed('08:00', '12:00', 4), hm(8))?.used_minutes, 0);
  const early = plan(timed('08:00', '09:00', 1), hm(7, 46));
  assert.equal(early?.used_minutes, 0);
  assert.equal(early?.start_time, '08:00');
  assert.equal(early?.end_time, '08:00');
  assert.deepEqual(applyCuts(timed('08:00', '09:00', 1), [early!]), {
    start_time: '08:00',
    end_time: '08:00',
    hours: 0,
    days: 0,
  });
});

test('grace-ийн дотор ирвэл 0 — чөлөөгүй хүнээс бага цалин авахгүй', () => {
  assert.equal(plan(timed('08:00', '12:00', 4), hm(8, 3), { graceMinutes: 5 })?.used_minutes, 0);
  // grace-ээс хэтэрвэл бүтэн зөрүү (08:00-аас) — хоцролт 0 хэвээр.
  assert.equal(plan(timed('08:00', '12:00', 4), hm(8, 10), { graceMinutes: 5 })?.used_minutes, 10);
});

test('өдрийн дундын чөлөө: цонхноос ӨМНӨ ирвэл хөндөхгүй (дараа нь гарна)', () => {
  assert.equal(plan(timed('14:00', '17:00', 3), hm(8, 25)), null);
  assert.equal(plan(timed('16:00', '17:00', 1), hm(7, 56)), null);
  assert.equal(plan(timed('14:00', '17:00', 3), hm(14)), null);
});

test('өдрийн дундын чөлөө: цонхон ДОТОР ирвэл [эхлэл, ирсэн цаг]', () => {
  const cut = plan(timed('10:00', '13:00', 3), hm(11, 15));
  assert.equal(cut?.start_time, '10:00');
  assert.equal(cut?.end_time, '11:15');
  assert.equal(cut?.used_minutes, 75);
});

test('ээлжээс эрт эхэлсэн цагтай чөлөө (08:00, ээлж 09:00) — ээлжийн эхлэлээс тооцно', () => {
  const cut = plan(timed('08:00', '12:00', 4), hm(10), { shift: SHIFT_09 });
  assert.equal(cut?.start_time, '09:00');
  assert.equal(cut?.used_minutes, 60);
  // Ээлж эхлэхээс өмнө ирвэл ашиглаагүй.
  assert.equal(plan(timed('08:00', '12:00', 4), hm(8, 50), { shift: SHIFT_09 })?.used_minutes, 0);
});

test('бүтэн өдрийн чөлөө: ирсэн цаг хүртэл, 8 цагаас хэтрэхгүй', () => {
  const cut = plan(fullDay(), hm(9));
  assert.equal(cut?.full_minutes, 480);
  assert.equal(cut?.used_minutes, 60);
  assert.deepEqual(applyCuts(fullDay(), [cut!]), { start_time: '08:00', end_time: '09:00', hours: 1, days: 0.13 });
  assert.equal(plan(fullDay(), hm(8))?.used_minutes, 0);
  // 16:30-д ирвэл түүхий зөрүү 510 ≥ 480 → бүтэн ашигласан.
  assert.equal(plan(fullDay(), hm(16, 30)), null);
});

test('олон хоногийн чөлөө: зөвхөн ирсэн өдөр богиносно (шийдвэр 1)', () => {
  // Даваа 09-28 – Баасан 10-02, 5 × 8 = 40 цаг.
  const week = fullDay('2026-09-28', '2026-10-02');
  const wed = planDayCut({
    leave: week,
    date: '2026-09-30',
    arrivalMinutes: hm(9),
    shift: SHIFT_08,
    graceMinutes: 0,
    isFreeDay: false,
  });
  assert.equal(wed?.start_time, '08:00');
  assert.equal(wed?.used_minutes, 60);
  const eff = applyCuts(week, [wed!]);
  // Цаг хэвээр (олон хоногийн мөр), 40 − 7 = 33 цаг, 5 − 7/8 = 4.13 өдөр.
  assert.deepEqual(eff, { start_time: null, end_time: null, hours: 33, days: 4.13 });
  // Пүрэв ч ирвэл хоёулаа хасагдана.
  const thu = { ...wed!, date: '2026-10-01', arrival: '08:00', end_time: '08:00', used_minutes: 0 };
  assert.deepEqual(applyCuts(week, [wed!, thu]), { start_time: null, end_time: null, hours: 25, days: 3.13 });
});

test('олон хоногийн мөрийн өдрийн минут = hours / хуанлийн өдөр (ирцийн хүснэгттэй ижил)', () => {
  // 08-25..09-02 (9 хоног, 72 цаг) — прод дээрх бодит мөр.
  assert.equal(leaveMinutesPerDay({ start_date: '2026-08-25', end_date: '2026-09-02', hours: 72 }), 480);
  assert.equal(leaveMinutesPerDay({ start_date: DAY, end_date: DAY, hours: null }), 480);
});

test('хөндөхгүй тохиолдлууд: ирцгүй, амралтын өдөр, remote, мужаас гадуур', () => {
  assert.equal(plan(timed('08:00', '12:00', 4), null), null);
  assert.equal(plan(timed('08:00', '12:00', 4), hm(9), { isFreeDay: true }), null);
  assert.equal(plan(timed('08:00', '12:00', 4, 'remote'), hm(9)), null);
  assert.equal(plan(timed('08:00', '12:00', 4), hm(9), { date: '2026-09-30' }), null);
  // Олон хоногийн ЦАГТАЙ мөр (систем үүсгэдэггүй) — хөндөхгүй.
  assert.equal(
    plan({ ...timed('08:00', '10:00', 2), end_date: '2026-09-30' }, hm(9)),
    null,
  );
});

test('богиносголтгүй бол анхны утгыг яг буцаана (сэргээлт)', () => {
  const l = timed('08:00', '12:00', 4);
  assert.deepEqual(applyCuts(l, []), { start_time: '08:00', end_time: '12:00', hours: 4, days: 0.5 });
});

test('мэдэгдлийн бичвэр', () => {
  assert.equal(formatMinutesMn(60), '1 цаг');
  assert.equal(formatMinutesMn(90), '1 цаг 30 мин');
  assert.equal(formatMinutesMn(18), '18 мин');
  assert.equal(formatMinutesMn(0), '0 цаг');
  const msg = describeCut(plan(timed('08:00', '12:00', 4), hm(9))!);
  assert.match(msg, /09:00-д ирсэн/);
  assert.match(msg, /08:00–09:00 \(1 цаг\)/);
  assert.match(describeCut(plan(timed('08:00', '12:00', 4), hm(7, 55))!), /0 цаг/);
});
