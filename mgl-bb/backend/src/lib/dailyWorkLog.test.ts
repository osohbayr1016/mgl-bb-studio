/**
 * `lib/dailyWorkLog.ts`-ийн тест.  Файл нь импортгүй, цэвэр функц тул
 * `registerHooks` шаардлагагүй.  Миграц 0345-ыг `node:sqlite` дээр бодитоор
 * ажиллуулж UNIQUE хязгаарыг ч шалгана.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_ITEMS,
  addDays,
  checkLogDate,
  isLate,
  isRealDate,
  itemsEqual,
  monthBounds,
  rangeBounds,
  normalizeItems,
  parseStoredItems,
  stripLeadingMark,
} from './dailyWorkLog.ts';

test('дугаар / тэмдгийг хасна, «3.5 м» зэрэг тоог хөндөхгүй', () => {
  assert.equal(stripLeadingMark('1. Хурал'), 'Хурал');
  assert.equal(stripLeadingMark('  2) Гэрээ'), 'Гэрээ');
  assert.equal(stripLeadingMark('3.Зураг хүлээлгэв'), 'Зураг хүлээлгэв');
  assert.equal(stripLeadingMark('- Утсаар ярив'), 'Утсаар ярив');
  assert.equal(stripLeadingMark('• Имэйл'), 'Имэйл');
  assert.equal(stripLeadingMark('3.5 м хана шалгав'), '3.5 м хана шалгав');
  assert.equal(stripLeadingMark('2026 оны төсөв'), '2026 оны төсөв');
});

test('бичвэр ба массив хоёулаа ижил үр дүн, хоосон мөр хасагдана', () => {
  const a = normalizeItems('1. Хурал\n\n2. Гэрээ\r\n  ');
  const b = normalizeItems(['1. Хурал', '', 'Гэрээ']);
  assert.deepEqual(a, { ok: true, items: ['Хурал', 'Гэрээ'] });
  assert.deepEqual(b, a);
});

test('хоосон, хэт олон, хэт урт, буруу хэлбэр татгалзана', () => {
  assert.equal((normalizeItems('  \n ') as { code: string }).code, 'EMPTY');
  const many = Array.from({ length: MAX_ITEMS + 1 }, (_, i) => `ажил ${i}`);
  assert.equal((normalizeItems(many) as { code: string }).code, 'TOO_MANY');
  assert.equal((normalizeItems('x'.repeat(2001)) as { code: string }).code, 'TOO_LONG');
  assert.equal((normalizeItems(42) as { code: string }).code, 'BAD_INPUT');
  assert.equal((normalizeItems(['a', 1]) as { code: string }).code, 'BAD_INPUT');
});

test('огноо: бодит, ирээдүй биш', () => {
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('2026-09-24'), true);
  assert.equal(checkLogDate('2026-09-24', '2026-09-24'), null);
  assert.equal(checkLogDate('2026-09-01', '2026-09-24'), null);
  assert.match(checkLogDate('2026-09-25', '2026-09-24') ?? '', /Ирээдүй/);
  assert.match(checkLogDate('2019-12-31', '2026-09-24') ?? '', /эрт/);
  assert.match(checkLogDate('24/09/2026', '2026-09-24') ?? '', /буруу/);
});

test('сарын хил, үсрэнгүй жил', () => {
  assert.deepEqual(monthBounds('2026-09'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(monthBounds('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  assert.equal(monthBounds('2026-13'), null);
  assert.equal(monthBounds('2026-9'), null);
});

test('огнооны муж: дараалал, урт, бодит огноо', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.deepEqual(rangeBounds('2026-09-29', '2026-10-05', 7), { from: '2026-09-29', to: '2026-10-05' });
  assert.equal(rangeBounds('2026-09-29', '2026-10-06', 7), null); // 8 өдөр
  assert.equal(rangeBounds('2026-10-05', '2026-09-29', 62), null); // урвуу
  assert.equal(rangeBounds('2026-02-30', '2026-03-05', 62), null);
  assert.equal(rangeBounds('', '2026-03-05', 62), null);
  assert.deepEqual(rangeBounds('2026-10-07', '2026-10-07', 1), { from: '2026-10-07', to: '2026-10-07' });
});

test('хожим нөхсөн, тэнцүү байдал, эвдэрсэн JSON', () => {
  assert.equal(isLate('2026-09-25', '2026-09-24'), true);
  assert.equal(isLate('2026-09-24', '2026-09-24'), false);
  assert.equal(itemsEqual(['a', 'b'], ['a', 'b']), true);
  assert.equal(itemsEqual(['a', 'b'], ['b', 'a']), false);
  assert.deepEqual(parseStoredItems('["a",2,"b"]'), ['a', 'b']);
  assert.deepEqual(parseStoredItems('{oops'), []);
  assert.deepEqual(parseStoredItems(null), []);
});

test('миграц 0345: нэг хүн нэг өдөрт нэг мөр, түүх тусдаа', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY)');
  db.exec('INSERT INTO users (id) VALUES (1), (2)');
  const sql = readFileSync(
    new URL('../../migrations/0345_daily_work_logs.sql', import.meta.url),
    'utf8',
  );
  db.exec(sql);
  const ins = db.prepare(
    'INSERT INTO daily_work_logs (user_id, log_date, items_json, first_written_on) VALUES (?, ?, ?, ?)',
  );
  ins.run(1, '2026-09-24', '["a"]', '2026-09-24');
  ins.run(2, '2026-09-24', '["b"]', '2026-09-24');
  assert.throws(() => ins.run(1, '2026-09-24', '["c"]', '2026-09-24'), /UNIQUE/);
  db.prepare(
    'INSERT INTO daily_work_log_revisions (log_id, items_json, valid_from) VALUES (1, ?, ?)',
  ).run('["old"]', '2026-09-24 01:00:00');
  const n = db.prepare('SELECT COUNT(*) AS n FROM daily_work_log_revisions').get() as { n: number };
  assert.equal(n.n, 1);
});
