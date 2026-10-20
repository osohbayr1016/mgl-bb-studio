/**
 * `lib/lateWaiver.ts`-ийн тест.  Файл нь импортгүй, цэвэр функц тул
 * `registerHooks` шаардлагагүй — шууд статик импорт хийж болно.
 *
 * `late(...)` нь `buildDailyAttendanceRows`-ийн (чөлөөгүй өдрийн) томьёог давтана:
 * blanket ? 0 : max(0, rawLate − waiverMinutes).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lateWaiver, unionLengthMinutes, type OooSpan } from './lateWaiver.ts';

const LUNCH = { start: '12:00', end: '13:00' };
const H = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
const ooo = (start: string | null, end: string | null): OooSpan => ({ start_time: start, end_time: end });

/** Ээлжийн эхлэлтэй харьцуулсан түүхий хоцролтоос хөнгөлөлтийн дараах хоцролт. */
function late(
  shiftStart: string,
  arrive: string,
  entries: OooSpan[],
  lunch: { start: string; end: string } | null = LUNCH,
): number {
  const rawLate = Math.max(0, H(arrive) - H(shiftStart));
  const r = lateWaiver({ rawLate, actualIn: arrive, effStartMin: H(shiftStart), lunch, ooo: entries });
  return r.blanket ? 0 : Math.max(0, rawLate - r.waiverMinutes);
}

test('прод 2026-09-09: 08:00 ээлж, гадуур ажил 09:00–14:00, 12:53 ирсэн → 0 (өмнө нь 60)', () => {
  assert.equal(late('08:00', '12:53', [ooo('09:00', '14:00')]), 0);
});

test('прод 2026-09-23: 08:00 ээлж, гадуур ажил 09:00–14:20, 14:19 ирсэн → 0 (өмнө нь 60)', () => {
  assert.equal(late('08:00', '14:19', [ooo('09:00', '14:20')]), 0);
});

test('09:00 ээлж, гадуур ажил 09:00–14:00, 12:51 ирсэн → 0 (хэвээр)', () => {
  assert.equal(late('09:00', '12:51', [ooo('09:00', '14:00')]), 0);
});

test('гадуур ажил дууссанаас ирэх хүртэлх зай ХЭВЭЭР хоцролт', () => {
  // 08:00 ээлж, гадуур ажил 09:00–13:00, 13:30 ирсэн → 13:00–13:30 = 30.
  assert.equal(late('08:00', '13:30', [ooo('09:00', '13:00')]), 30);
  // 08:00–14:00 гадуур ажил, 17:03 ирсэн → 14:00–17:03 = 183.
  assert.equal(late('08:00', '17:03', [ooo('08:00', '14:00')]), 183);
});

test('ирсний ДАРАА эхэлсэн (үдээс хойшхи) гадуур ажил өглөөний хоцролтыг цуцлахгүй', () => {
  assert.equal(late('08:00', '08:07', [ooo('14:00', '16:00')]), 7);
  assert.equal(late('08:00', '10:00', [ooo('15:00', '17:00')]), 120);
});

test('зөвхөн өдрийн АНХНЫ гадуур ажлын өмнөх зай чөлөөлөгдөнө', () => {
  // 08:00 ээлж, 09:00–10:00 ба 11:00–11:30, 11:45 ирсэн:
  // 08:00–10:00 чөлөөтэй, 10:00–11:00 хоцролт, 11:00–11:30 чөлөөтэй, 11:30–11:45 хоцролт → 75.
  assert.equal(late('08:00', '11:45', [ooo('11:00', '11:30'), ooo('09:00', '10:00')]), 75);
});

test('цайны цонх ба гадуур ажил давхцвал нэг л удаа хасна', () => {
  // 09:00 ээлж, гадуур ажил 11:00–12:30, 13:30 ирсэн:
  // 09:00–12:30 (зам + гадуур) ∪ 12:00–13:00 (цай) = 09:00–13:00 → 30.
  assert.equal(late('09:00', '13:30', [ooo('11:00', '12:30')]), 30);
});

test('гадуур ажилгүй бол зөвхөн цай хасагдана', () => {
  assert.equal(late('08:00', '12:53', []), 293 - 53);
  assert.equal(late('08:00', '12:53', [], null), 293);
});

test('цаг заагаагүй гадуур ажил эсвэл ирсэн цаг уншигдаагүй → бүтэн цуцлана', () => {
  assert.equal(late('08:00', '12:53', [ooo(null, null)]), 0);
  const r = lateWaiver({ rawLate: 60, actualIn: null, effStartMin: H('08:00'), lunch: LUNCH, ooo: [ooo('09:00', '14:00')] });
  assert.deepEqual(r, { waiverMinutes: 0, blanket: true });
  const none = lateWaiver({ rawLate: 60, actualIn: null, effStartMin: H('08:00'), lunch: LUNCH, ooo: [] });
  assert.deepEqual(none, { waiverMinutes: 0, blanket: false });
});

test('хоцролтгүй бол юу ч хасахгүй', () => {
  const r = lateWaiver({ rawLate: 0, actualIn: '07:50', effStartMin: H('08:00'), lunch: LUNCH, ooo: [ooo(null, null)] });
  assert.deepEqual(r, { waiverMinutes: 0, blanket: false });
});

test('unionLengthMinutes давхцлыг нэг удаа тоолно', () => {
  assert.equal(unionLengthMinutes([]), 0);
  assert.equal(unionLengthMinutes([[0, 10], [5, 20], [30, 40]]), 30);
});
