/**
 * `lib/leaveDayPart.ts`-ийн тест.  Файл нь runtime импортгүй, цэвэр функц
 * тул `registerHooks` шаардлагагүй — шууд статик импорт хийж болно
 * (`leaveOverlap.test.ts`-ийн жишиг).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayPartWindow, isDayPart, DAY_PART_END_MINUTES } from './leaveDayPart.ts';

/** early 08:00, mid 08:30, standard 09:00 — минутаар. */
const EARLY = 480;
const MID = 510;
const STANDARD = 540;

test('am — ээлжээс үл хамааран ҮРГЭЛЖ 12:00 цагт дуусна', () => {
  // Нягтлангийн дүрэм: «үдээс өмнөх» чөлөө тул ажилтан 12:00-д ажилдаа
  // ирсэн байх ёстой.  Дуусах цаг нь ээлжээс ХАМААРАХГҮЙ.
  for (const start of [EARLY, MID, STANDARD]) {
    assert.equal(dayPartWindow(start, 'am').endMinutes, DAY_PART_END_MINUTES, `shift ${start}`);
    assert.equal(dayPartWindow(start, 'am').endMinutes, 720, `shift ${start}`);
  }
});

test('am — бүртгэгдэх цаг нь ээлж тус бүрд өөр (4.0 / 3.5 / 3.0)', () => {
  // Ажилтан бодитоор яг төдөн цагийн ажлаа тасалсан тул энэ нь ЗӨВ.
  assert.deepEqual(dayPartWindow(EARLY, 'am'), { startMinutes: 480, endMinutes: 720, hours: 4 });
  assert.deepEqual(dayPartWindow(MID, 'am'), { startMinutes: 510, endMinutes: 720, hours: 3.5 });
  assert.deepEqual(dayPartWindow(STANDARD, 'am'), {
    startMinutes: 540,
    endMinutes: 720,
    hours: 3,
  });
});

test('am — hour_cap 4-ийг ХЭЗЭЭ Ч давахгүй', () => {
  // `leavePolicy.ts`-ийн харьцуулалт хатуу `>` тул яг 4.00 нь
  // сэрэмжлүүлэггүй — мөр бүр дээр байнгын анхааруулга үлдэхгүй.
  for (const start of [EARLY, MID, STANDARD]) {
    assert.ok(dayPartWindow(start, 'am').hours <= 4, `shift ${start}`);
  }
});

test('am — 12:00-д ирвэл хоцролт 0 болох тэнцэл', () => {
  // `routes/attendance.ts`: lateMin = rawLate − leaveMinutes − waiver.
  // 12:00-д ирэхэд rawLate = 720 − shiftStart, leaveMinutes = цонхны урт.
  // Цайны цаг (13:00–14:00) энэ завсарт ОГТ ОРОХГҮЙ тул waiver = 0.
  for (const start of [EARLY, MID, STANDARD]) {
    const w = dayPartWindow(start, 'am');
    const rawLate = 720 - start;
    const leaveMinutes = w.endMinutes - w.startMinutes;
    assert.equal(Math.max(0, rawLate - leaveMinutes), 0, `shift ${start}`);
  }
});

test('isDayPart нь танихгүй утгыг татгалзана', () => {
  assert.equal(isDayPart('am'), true);
  // 'pm' нь ЗОРИУДААР татгалзагдана: `routes/attendance.ts` нь sub-day
  // чөлөөг ээлжийн ЭХЭНД байна гэж үздэг тул үдээс хойших чөлөө өглөөний
  // бодит хоцролтыг чимээгүй цуцлах байсан.
  for (const bad of ['pm', 'AM', 'morning', '', null, 0, undefined, {}]) {
    assert.equal(isDayPart(bad), false, String(bad));
  }
});
