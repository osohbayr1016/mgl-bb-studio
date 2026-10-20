/**
 * Ирцийн ажилласан цаг = ЭЭЛЖИЙН ЦОНХ доторх хугацаа − цай (эзний шийдвэр
 * 2026-10-01, `lib/shiftBoundedHours.ts`).
 *
 * Run with:  node --test src/lib/shiftBoundedHours.test.ts
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

const {
  FULL_DAY_WINDOW,
  SHIFT_BOUNDED_FROM,
  countingWindow,
  daySpanOf,
  isShiftBounded,
  shiftBoundedMinutes,
  shiftBoundedSessionHours,
} = await import('./shiftBoundedHours.ts');
const { nonProjectCreditMinutes } = await import('./nonProjectWork.ts');

const D = '2026-10-02';
const at = (hhmm: string, date = D) => `${date}T${hhmm}:00+08:00`;
const EARLY = { startMinutes: 8 * 60, endMinutes: 17 * 60 };
const MID = { startMinutes: 8 * 60 + 30, endMinutes: 17 * 60 + 30 };
const STANDARD = { startMinutes: 9 * 60, endMinutes: 18 * 60 };
/** Прод дээрх цай 13:00–14:00. */
const LUNCH = { start: 13 * 60, end: 14 * 60 };
const SETTINGS = { lunchEnabled: true, lunchStart: '13:00', lunchEnd: '14:00' };

type Shift = { startMinutes: number; endMinutes: number };
const minutes = (inT: string, outT: string, shift: Shift, lunch: typeof LUNCH | null = LUNCH) =>
  shiftBoundedMinutes([daySpanOf(at(inT), at(outT), D)], shift, lunch);

test('эзний жишээ 1: 08:00 ээлж, 07:40 ирээд 16:40 гарсан → 7ц40м (өмнө нь 8ц)', () => {
  assert.equal(minutes('07:40', '16:40', EARLY), 7 * 60 + 40);
});

test('эзний жишээ 2: 07:20 ирээд 16:57 гарсан → 7ц57м (3 минут эрт)', () => {
  assert.equal(minutes('07:20', '16:57', EARLY), 7 * 60 + 57);
});

test('ээлжээс урт байсан ч 8ц; хоцорсон минут хасагдана', () => {
  assert.equal(minutes('08:00', '17:00', EARLY), 480);
  assert.equal(minutes('07:00', '19:30', EARLY), 480);
  assert.equal(minutes('08:10', '17:00', EARLY), 470);
});

test('ээлжийн гурван сонголт — 08:30–17:30 ба 09:00–18:00 өөрийн цонхоор', () => {
  assert.equal(minutes('08:30', '17:30', MID), 480);
  assert.equal(minutes('08:00', '17:00', MID), 450); // 08:30-аас, 17:00-д гарсан
  assert.equal(minutes('08:00', '18:30', STANDARD), 480);
  assert.equal(minutes('08:40', '17:30', STANDARD), 450); // 09:00–17:30 − цай
});

test('секунд тасална — ажилтны харсан цагтай таарна', () => {
  const span = daySpanOf('2026-10-02T07:20:05+08:00', '2026-10-02T16:57:59+08:00', D);
  assert.equal(shiftBoundedMinutes([span], EARLY, LUNCH), 477);
});

test('давхар бүртгэлийн ихэр нэг удаа; дахин орсон хоёр session нийлнэ', () => {
  const s = (a: string, b: string) => daySpanOf(at(a), at(b), D);
  assert.equal(shiftBoundedMinutes([s('08:00', '17:00'), s('08:00', '17:00')], EARLY, LUNCH), 480);
  assert.equal(shiftBoundedMinutes([s('07:30', '11:00'), s('14:00', '18:00')], EARLY, LUNCH), 360);
});

test('шөнө дамнасан session ээлжийн төгсгөлөөр хязгаарлагдана', () => {
  const span = daySpanOf(at('16:00'), '2026-10-03T02:00:00+08:00', D);
  assert.deepEqual(span, { start: 16 * 60, end: 1440 });
  assert.equal(shiftBoundedMinutes([span], EARLY, LUNCH), 60);
});

test('worker (цэвэрлэгч) — цонхгүй: бодит цаг − цай, эрт гарвал багасна', () => {
  const FIXED = { startMinutes: 9 * 60 + 30, endMinutes: 18 * 60 + 30 };
  assert.deepEqual(countingWindow(FIXED, 'worker'), FULL_DAY_WINDOW);
  assert.equal(countingWindow(FIXED, 'engineer'), FIXED);
  assert.equal(countingWindow(FIXED, null), FIXED);
  // Прод 2026-09-01: 10:53–20:01 → 9ц08м − цай 1ц = 488 (ээлжээр бол 397).
  assert.equal(minutes('10:53', '20:01', countingWindow(FIXED, 'worker')), 488);
  assert.equal(minutes('10:53', '20:01', countingWindow(FIXED, 'architect')), 397);
});

test('цай унтраалттай бол цонх бүтнээрээ', () => {
  assert.equal(minutes('07:40', '16:40', EARLY, null), 8 * 60 + 40);
});

test('session-ий цаг 2 оронтой (hours_worked)', () => {
  assert.equal(shiftBoundedSessionHours(at('07:40'), at('16:40'), D, EARLY, SETTINGS), 7.67);
  assert.equal(shiftBoundedSessionHours(at('07:20'), at('16:57'), D, EARLY, SETTINGS), 7.95);
  assert.equal(shiftBoundedSessionHours(at('07:00'), at('19:00'), D, EARLY, SETTINGS), 8);
  // Цайны цаг дотор ирж гарсан → 0.
  assert.equal(shiftBoundedSessionHours(at('13:10'), at('13:50'), D, EARLY, SETTINGS), 0);
});

test('зөвхөн 2026-10-01-ээс — 9-р сар хуучин дүрмээрээ', () => {
  assert.equal(SHIFT_BOUNDED_FROM, '2026-10-01');
  assert.equal(isShiftBounded('2026-09-30'), false);
  assert.equal(isShiftBounded('2026-10-01'), true);
  assert.equal(isShiftBounded('2027-01-15'), true);
});

test('төслийн бус ажлын нэмэлт мөн ээлжийн цонхоор: 15:00-д гараад 15–19 → 15–17 л', () => {
  const sessions = [{ start: 8 * 60, end: 15 * 60 }];
  const entries = [{ start: 15 * 60, end: 19 * 60 }];
  assert.equal(nonProjectCreditMinutes(sessions, entries, LUNCH), 240); // цонхгүй (хуучин)
  assert.equal(nonProjectCreditMinutes(sessions, entries, LUNCH, { start: 480, end: 1020 }), 120);
  // Ирэхээс өмнөх 06:00–08:30 ажил → зөвхөн 08:00-аас.
  assert.equal(
    nonProjectCreditMinutes([{ start: 510, end: 1020 }], [{ start: 360, end: 510 }], LUNCH, {
      start: 480,
      end: 1020,
    }),
    30,
  );
});
