/**
 * `lib/leaveHours.ts` — чөлөөний цагаас цайг хасах дүрэм (2026-10-12).
 *
 * Run with:  node --test src/lib/leaveHours.test.ts
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

const { leaveRangeHours, addLeaveWorkMinutes, leaveWorkMinutes } = await import('./leaveHours.ts');
const { planDayCut } = await import('./leaveArrivalCut.ts');

const LUNCH = { start: 13 * 60, end: 14 * 60 };
const hm = (h: number, m = 0) => h * 60 + m;

test('эзний жишээ: 09:16–18:00 = 7.73 цаг (цай хасна), 8-аас хэтрэхгүй', () => {
  assert.equal(leaveRangeHours('09:16', '18:00', LUNCH), 7.73);
  assert.equal(leaveRangeHours('09:00', '18:00', LUNCH), 8);
  assert.equal(leaveRangeHours('08:00', '17:00', LUNCH), 8);
});

test('цайтай давхцаагүй цонх хэвээр', () => {
  assert.equal(leaveRangeHours('09:00', '12:00', LUNCH), 3);
  assert.equal(leaveRangeHours('14:00', '18:00', LUNCH), 4);
});

test('цайны хагас давхцал', () => {
  assert.equal(leaveRangeHours('13:30', '15:00', LUNCH), 1);
  assert.equal(leaveRangeHours('12:00', '13:30', LUNCH), 1);
  assert.equal(leaveRangeHours('13:00', '14:00', LUNCH), 0);
});

test('цай унтраалттай бол түүхий зөрүү; буруу цонх null', () => {
  assert.equal(leaveRangeHours('09:16', '18:00', null), 8.73);
  assert.equal(leaveRangeHours('18:00', '09:00', LUNCH), null);
  assert.equal(leaveRangeHours(null, '09:00', LUNCH), null);
});

test('addLeaveWorkMinutes — «4 цаг» цайг алгасна', () => {
  assert.equal(addLeaveWorkMinutes(hm(11), 240, LUNCH), hm(16));
  assert.equal(addLeaveWorkMinutes(hm(9), 240, LUNCH), hm(13));
  assert.equal(addLeaveWorkMinutes(hm(14), 120, LUNCH), hm(16));
  assert.equal(addLeaveWorkMinutes(hm(13, 30), 120, LUNCH), hm(16));
  assert.equal(addLeaveWorkMinutes(hm(9), 480, LUNCH), hm(18));
  assert.equal(addLeaveWorkMinutes(hm(9), 0, LUNCH), hm(9));
  assert.equal(addLeaveWorkMinutes(hm(11), 240, null), hm(15));
  // Урвуу шалгалт: үүсгэсэн цонх ЯГ хүссэн ажлын минуттай.
  for (const s of [hm(8), hm(10, 15), hm(12, 59), hm(13, 20), hm(14)]) {
    for (const w of [30, 120, 240, 300]) {
      assert.equal(leaveWorkMinutes(s, addLeaveWorkMinutes(s, w, LUNCH), LUNCH), w);
    }
  }
});

test('ирсэн цагаар богиносгох: цайны дараа ирвэл цай чөлөөнд орохгүй', () => {
  const cut = planDayCut({
    leave: {
      leave_type: 'annual',
      start_date: '2026-10-13',
      end_date: '2026-10-13',
      start_time: null,
      end_time: null,
      hours: 8,
      days: 1,
    },
    date: '2026-10-13',
    arrivalMinutes: hm(14, 30),
    shift: { startMinutes: hm(9), endMinutes: hm(18) },
    graceMinutes: 0,
    isFreeDay: false,
    lunch: LUNCH,
  });
  assert.ok(cut);
  assert.equal(cut.used_minutes, 270);
  assert.equal(cut.start_time, '09:00');
  assert.equal(cut.end_time, '14:30');
});
