/**
 * `lib/leaveWindow.ts`-ийн цэвэр хэсгийн тест — огнооны дүрэм ба хаалттай
 * цонхны мессеж.  `getLeaveWindow` нь D1 шаарддаг тул энд оролцохгүй;
 * оронд нь бодит цонхтой ижил бүтэцтэй объект гараар угсарна.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { LeaveWindow, LeaveWindowReason } from './leaveWindow';

// `leaveWindow.ts` нь өргөтгөлгүй харьцангуй импорт бичдэг (`./time`,
// `./holidays`, `./workSchedule`) — Worker-ийн bundler үүнийг шийддэг ч
// Node-ийн ESM loader шийддэггүй.  `webPush.test.ts`-ийн адил зөвхөн
// тестийн хүрээнд `.ts` руу буулгана.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

// Hook-ийн ДАРАА ачаалагдах ёстой тул динамик импорт.
const { closedWindowMessage, validateLeaveTiming } = await import('./leaveWindow.ts');
const { SHIFTS, isWeekend, addDays, effectiveSchedule } = await import('./workSchedule.ts');

/** 2026-08-13 бол Пүрэв гараг — ажлын өдөр. */
const TODAY = '2026-08-13';
const TOMORROW = '2026-08-14';
const YESTERDAY = '2026-08-12';

function makeWindow(overrides: Partial<LeaveWindow> = {}): LeaveWindow {
  return {
    open: true,
    reason: 'open',
    today: TODAY,
    schedule: 'standard',
    shift_label: '09:00–18:00',
    shift_start: '09:00',
    shift_end: '18:00',
    now: '14:20',
    min_full_day_date: TOMORROW,
    min_timed_date: TODAY,
    min_time_today: '14:20',
    ...overrides,
  };
}

test('бүтэн өдрийн чөлөө: өнөөдөр ба өнгөрсөн огноог хориглоно', () => {
  const win = makeWindow();
  assert.notEqual(validateLeaveTiming(win, { start: TODAY, startTime: null }), null);
  assert.notEqual(validateLeaveTiming(win, { start: YESTERDAY, startTime: null }), null);
});

test('бүтэн өдрийн чөлөө: маргааш ба түүнээс хойш зөвшөөрнө', () => {
  const win = makeWindow();
  assert.equal(validateLeaveTiming(win, { start: TOMORROW, startTime: null }), null);
  assert.equal(validateLeaveTiming(win, { start: '2026-09-01', startTime: null }), null);
});

test('цагийн чөлөө: өнөөдөр одооноос ХОЙШ эхэлбэл зөвшөөрнө', () => {
  const win = makeWindow();
  assert.equal(validateLeaveTiming(win, { start: TODAY, startTime: '15:00' }), null);
  // Яг одоогийн минут дээр эхлэх нь ч зөв (< биш ≤).
  assert.equal(validateLeaveTiming(win, { start: TODAY, startTime: '14:20' }), null);
});

test('цагийн чөлөө: өнөөдөр өнгөрсөн цагт эхлэхийг хориглоно', () => {
  const win = makeWindow();
  assert.notEqual(validateLeaveTiming(win, { start: TODAY, startTime: '14:19' }), null);
  assert.notEqual(validateLeaveTiming(win, { start: TODAY, startTime: '09:00' }), null);
});

test('цагийн чөлөө: өнгөрсөн огноог хориглоно, маргаашийг зөвшөөрнө', () => {
  const win = makeWindow();
  assert.notEqual(validateLeaveTiming(win, { start: YESTERDAY, startTime: '10:00' }), null);
  // Маргааш бол өнөөдрийн цагийн хязгаар хамаарахгүй — 08:00 ч болно.
  assert.equal(validateLeaveTiming(win, { start: TOMORROW, startTime: '08:00' }), null);
});

test('цагийн чөлөө: буруу форматтай цагийг таслана', () => {
  const win = makeWindow();
  assert.notEqual(validateLeaveTiming(win, { start: TODAY, startTime: '25:00' }), null);
});

test('validateLeaveTiming нь цагийг дахин уншихгүй — зөвхөн snapshot-оос', () => {
  // min_time_today-г 23:59 болгоход өнөөдрийн бүх цаг татгалзана;
  // хэрэв дотроо бодит цагийг уншиж байсан бол энэ тест унана.
  const win = makeWindow({ now: '23:59', min_time_today: '23:59' });
  assert.notEqual(validateLeaveTiming(win, { start: TODAY, startTime: '23:58' }), null);
  assert.equal(validateLeaveTiming(win, { start: TODAY, startTime: '23:59' }), null);
});

test('closedWindowMessage: шалтгаан бүрд ажлын цагийн шошгыг дурдана', () => {
  const reasons: LeaveWindowReason[] = ['weekend', 'holiday', 'before_shift', 'after_shift'];
  for (const reason of reasons) {
    const msg = closedWindowMessage(makeWindow({ open: false, reason }));
    assert.ok(msg.includes('09:00–18:00'), `${reason}: ээлжийн шошго дутуу`);
    // Утасны дугаар / message сонголтыг ЗОРИУДААР дурдахгүй (2026-08-13).
    assert.ok(!/\d{8}|утсаар|message/i.test(msg), `${reason}: холбоо барих мэдээлэл орсон байна`);
  }
});

test('өвөл standard 09:00–18:00, зун бүгд early 08:00–17:00', () => {
  assert.equal(effectiveSchedule('standard', '2026-01-15'), 'standard');
  assert.equal(effectiveSchedule('standard', '2026-07-15'), 'early');
  assert.equal(effectiveSchedule(null, '2026-01-15'), 'standard');
  assert.equal(SHIFTS.standard.startMinutes, 9 * 60);
  assert.equal(SHIFTS.standard.endMinutes, 18 * 60);
  assert.equal(SHIFTS.early.startMinutes, 8 * 60);
  assert.equal(SHIFTS.early.endMinutes, 17 * 60);
});

test('isWeekend / addDays нь UB огноог зөв тайлбарлана', () => {
  assert.equal(isWeekend('2026-08-15'), true); // Бямба
  assert.equal(isWeekend('2026-08-16'), true); // Ням
  assert.equal(isWeekend('2026-08-13'), false); // Пүрэв
  assert.equal(addDays(TODAY, 1), TOMORROW);
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
});
