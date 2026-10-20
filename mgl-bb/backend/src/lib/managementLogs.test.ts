// `lib/managementLogs.ts` — менежментийн багийн тайлангийн цэвэр дүрэм.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAILY_LOG_SINCE, expectedFrom, summarizeMember, workdaysIn } from './managementLogs.ts';

test('ажлын өдөр: Бя/Ням ба баяр хасагдана, урвуу муж хоосон', () => {
  // 2026-10-05 Даваа … 2026-10-11 Ням
  assert.deepEqual(workdaysIn('2026-10-05', '2026-10-11', new Set()), [
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
  ]);
  assert.deepEqual(workdaysIn('2026-10-05', '2026-10-07', new Set(['2026-10-06'])), ['2026-10-05', '2026-10-07']);
  assert.deepEqual(workdaysIn('2026-10-07', '2026-10-05', new Set()), []);
});

test('хүлээгдэх эхлэл: муж, модуль нэвтэрсэн өдөр, бүртгэгдсэн өдрийн хамгийн хожуу нь', () => {
  assert.equal(expectedFrom('2026-09-01', null), DAILY_LOG_SINCE);
  assert.equal(expectedFrom('2026-10-01', '2026-08-01'), '2026-10-01');
  assert.equal(expectedFrom('2026-10-01', '2026-10-05'), '2026-10-05');
  assert.equal(expectedFrom('2026-10-01', 'буруу'), '2026-10-01');
});

test('гишүүний нэгтгэл: амралтын өдрийн тайлан тоологдох боловч хамралтад орохгүй, мужаас гадуурх үл тоогдоно', () => {
  const expected = workdaysIn('2026-10-05', '2026-10-09', new Set());
  const s = summarizeMember(
    [
      { log_date: '2026-10-05', item_count: 3, first_written_on: '2026-10-05' },
      { log_date: '2026-10-06', item_count: 2, first_written_on: '2026-10-08' }, // нөхөж бичсэн
      { log_date: '2026-10-10', item_count: 1, first_written_on: '2026-10-10' }, // Бямба
      { log_date: '2026-09-30', item_count: 9, first_written_on: '2026-09-30' }, // мужаас гадуур
    ],
    '2026-10-05',
    '2026-10-11',
    expected,
  );
  assert.deepEqual(s, {
    days_logged: 3,
    items: 6,
    logged_workdays: 2,
    expected_workdays: 5,
    coverage: 0.4,
    late_days: 1,
    first_date: '2026-10-05',
    last_date: '2026-10-10',
  });
  assert.equal(summarizeMember([], '2026-10-05', '2026-10-05', []).coverage, null);
});
