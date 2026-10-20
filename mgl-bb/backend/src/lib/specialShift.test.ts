/**
 * User 69-ийн тогтмол 09:30–18:30 ээлж.  `workSchedule.test.ts`-тэй ижил
 * `registerHooks` resolver — өргөтгөлгүй харьцангуй import-ыг node --test
 * дор уншуулна.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  FIXED_SHIFT_USER_ID,
  FIXED_SHIFT,
  hasFixedShift,
  shiftForUser,
  lateMinutesAgainstShift,
} = await import('./specialShift.ts');
const { SHIFTS } = await import('./workSchedule.ts');

test('user 69 л тогтмол ээлжтэй', () => {
  assert.equal(FIXED_SHIFT_USER_ID, 69);
  assert.equal(hasFixedShift(69), true);
  assert.equal(hasFixedShift(2), false);
  assert.equal(hasFixedShift(null), false);
});

test('тогтмол ээлж 09:30–18:30', () => {
  assert.equal(FIXED_SHIFT.startMinutes, 9 * 60 + 30);
  assert.equal(FIXED_SHIFT.endMinutes, 18 * 60 + 30);
  assert.equal(FIXED_SHIFT.label, '09:30–18:30');
});

test('user 69 зун ч 09:30 үлдэнэ', () => {
  const a = [{ schedule: 'early' as const, effective_from: '2026-01-01' }];
  const july = shiftForUser(69, 'early', '2026-07-15', a);
  assert.equal(july.startMinutes, 9 * 60 + 30);
  assert.equal(july.endMinutes, 18 * 60 + 30);
  const winter = shiftForUser(69, 'standard', '2026-01-15', a);
  assert.equal(winter.startMinutes, 9 * 60 + 30);
});

test('бусад хүн зуны early / өвлийн stored-ыг авна', () => {
  const a = [{ schedule: 'standard' as const, effective_from: '2026-01-01' }];
  assert.equal(shiftForUser(1, 'standard', '2026-07-15', a).startMinutes, SHIFTS.early.startMinutes);
  assert.equal(
    shiftForUser(1, 'standard', '2026-01-15', a).startMinutes,
    SHIFTS.standard.startMinutes,
  );
});

test('09:30-д ирвэл хоцролт 0; 09:40 grace 0 → 10 мин', () => {
  const start = FIXED_SHIFT.startMinutes;
  assert.equal(lateMinutesAgainstShift(start, FIXED_SHIFT, 0), 0);
  assert.equal(lateMinutesAgainstShift(start - 5, FIXED_SHIFT, 0), 0);
  assert.equal(lateMinutesAgainstShift(start + 10, FIXED_SHIFT, 0), 10);
  assert.equal(lateMinutesAgainstShift(start + 10, FIXED_SHIFT, 15), 0);
  assert.equal(lateMinutesAgainstShift(start + 20, FIXED_SHIFT, 5), 15);
});
