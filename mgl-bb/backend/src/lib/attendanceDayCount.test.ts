/**
 * `lib/attendanceDayCount.ts`-ийн тест.  Импортгүй цэвэр модуль — шууд статик импорт.
 * Үндсэн тохиолдол нь 2026-09-ийн БАТЗОРИГ А. (BB): 22 ажлын өдөр бүгдэд ирсэн,
 * 9/26 (Бя) + 9/27 (Ня) өдөр гадуур ажил 2.00 ц — «24 өдөр · 22 ирсэн» гэж
 * харагдаж ажлын 2 өдөр тасалсан мэт болдог байв.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countAttendanceDays,
  hasWorkActivity,
  isExpectedWorkDay,
  type DayCountRow,
} from './attendanceDayCount.ts';

function row(over: Partial<DayCountRow> = {}): DayCountRow {
  return {
    is_rest_day: false,
    is_holiday: false,
    actual_in: null,
    out_of_office_minutes: 0,
    worked_effective_minutes: 0,
    ...over,
  };
}

/** Дав–Баа өдөр, ирсэн. */
const worked = (over: Partial<DayCountRow> = {}) =>
  row({ actual_in: '08:00', worked_effective_minutes: 480, ...over });

test('isExpectedWorkDay: Бя/Ня ба баярын өдөр ажиллах ёстой өдөр БИШ', () => {
  assert.equal(isExpectedWorkDay(row()), true);
  assert.equal(isExpectedWorkDay(row({ is_rest_day: true })), false);
  assert.equal(isExpectedWorkDay(row({ is_holiday: true })), false);
});

test('hasWorkActivity: ирц, гадуур ажил, тооцсон цаг аль нэг нь', () => {
  assert.equal(hasWorkActivity(row()), false);
  assert.equal(hasWorkActivity(row({ actual_in: '09:00' })), true);
  assert.equal(hasWorkActivity(row({ out_of_office_minutes: 120 })), true);
  assert.equal(hasWorkActivity(row({ worked_effective_minutes: 30 })), true);
});

test('Батзориг А. 2026-09: 22 ажлын өдөр + Бя/Ня гадуур ажил → 22 ирсэн, 2 нэмэлт', () => {
  const rows = [
    ...Array.from({ length: 22 }, () => worked()),
    row({ is_rest_day: true, out_of_office_minutes: 120, worked_effective_minutes: 120 }),
    row({ is_rest_day: true, out_of_office_minutes: 120, worked_effective_minutes: 120 }),
  ];
  assert.equal(rows.length, 24);
  assert.deepEqual(countAttendanceDays(rows), { present_days: 22, extra_days: 2 });
});

test('Бямба гараар ирц бүртгүүлсэн нь ирсэн өдрийн тоог НЭМЭХГҮЙ (ажлын өдрийг далдлахгүй)', () => {
  // 21 ажлын өдөр ирсэн + 1 ажлын өдөр тасалсан + Бямбад ирсэн
  const rows = [
    ...Array.from({ length: 21 }, () => worked()),
    row(), // ажлын өдөр, ирээгүй
    worked({ is_rest_day: true }),
  ];
  assert.deepEqual(countAttendanceDays(rows), { present_days: 21, extra_days: 1 });
});

test('Баярын өдөр ирсэн нь нэмэлт өдөр; ирээгүй баярын мөр юу ч тоолохгүй', () => {
  const rows = [
    worked(),
    row({ is_holiday: true }),
    worked({ is_holiday: true }),
  ];
  assert.deepEqual(countAttendanceDays(rows), { present_days: 1, extra_days: 1 });
});

test('Хоосон мөр, үйлдэлгүй ажлын өдөр (тас) → 0', () => {
  assert.deepEqual(countAttendanceDays([]), { present_days: 0, extra_days: 0 });
  assert.deepEqual(countAttendanceDays([row(), row()]), { present_days: 0, extra_days: 0 });
});
