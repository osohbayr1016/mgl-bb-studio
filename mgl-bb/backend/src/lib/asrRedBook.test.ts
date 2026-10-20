/**
 * `lib/asrRedBook.ts`-ийн тест (0366).  Импортгүй цэвэр функцүүд — статик импорт хангалттай.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  RED_BOOK_OK_SQL,
  isRedBookAbsent,
  redBookClearProblem,
  redBookProblem,
  redBookSatisfied,
  redBookStatusOf,
} from './asrRedBook.ts';
import { requiresRedBook } from './asrReportType.ts';

test('төлөв: баталгаажсан > зурагтай > байгаагүй > дутуу', () => {
  assert.equal(redBookStatusOf({}), 'missing');
  assert.equal(redBookStatusOf({ red_book_absent: 0 }), 'missing');
  assert.equal(redBookStatusOf({ red_book_absent: 1 }), 'absent');
  assert.equal(redBookStatusOf({ red_book_absent: true }), 'absent');
  assert.equal(redBookStatusOf({ red_book_photo_url: '/media/x.jpg', red_book_absent: 1 }), 'signed');
  assert.equal(
    redBookStatusOf({ red_book_photo_url: '/media/x.jpg', red_book_verified_at: '2026-09-30' }),
    'verified',
  );
  assert.ok(!isRedBookAbsent('0'));
  assert.ok(!isRedBookAbsent(null));
});

test('зөвхөн талбайн хяналтад заавал', () => {
  assert.ok(requiresRedBook('site'));
  assert.ok(!requiresRedBook('office'));
  assert.ok(!requiresRedBook('online'));
  assert.ok(!requiresRedBook('drawing_change'));
});

test('илгээх / батлах: зураг эсвэл «байгаагүй» хангалттай', () => {
  assert.match(redBookProblem({}, true) ?? '', /улаан дэвтэр байгаагүй/);
  assert.equal(redBookProblem({ red_book_photo_url: '/media/x.jpg' }, true), null);
  assert.equal(redBookProblem({ red_book_absent: 1 }, true), null);
  // Бусад төрөл хэзээ ч хаагдахгүй.
  assert.equal(redBookProblem({}, false), null);
  assert.ok(redBookSatisfied({ red_book_absent: 1 }));
});

test('илгээгдсэн/батлагдсан тайланг хоосон болгохгүй, ноорог/буцаагдсан чөлөөтэй', () => {
  for (const status of ['submitted', 'approved']) {
    assert.ok(redBookClearProblem(status, true, { red_book_photo_url: null, red_book_absent: 0 }));
    assert.equal(redBookClearProblem(status, true, { red_book_photo_url: '/media/y.jpg' }), null);
    assert.equal(redBookClearProblem(status, true, { red_book_absent: 1 }), null);
    assert.equal(redBookClearProblem(status, false, {}), null);
  }
  for (const status of ['draft', 'rejected']) {
    assert.equal(redBookClearProblem(status, true, {}), null);
  }
});

test('0366 миграц + RED_BOOK_OK_SQL бодит SQLite дээр', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE author_supervision_reports (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL,
    report_type TEXT NOT NULL DEFAULT 'site',
    red_book_photo_url TEXT
  )`);
  db.exec(
    readFileSync(new URL('../../migrations/0366_asr_red_book_absent.sql', import.meta.url), 'utf8'),
  );
  const ins = db.prepare(
    'INSERT INTO author_supervision_reports (id, status, report_type, red_book_photo_url) VALUES (?, ?, ?, ?)',
  );
  ins.run(1, 'submitted', 'site', null); // дутуу — батлагдахгүй
  ins.run(2, 'submitted', 'site', '/media/a.jpg'); // зурагтай
  ins.run(3, 'submitted', 'site', null); // доор «байгаагүй» болно
  ins.run(4, 'submitted', 'office', null); // талбайн биш
  // Хуучин мөр өгөгдмөл 0 авна.
  const row = db.prepare('SELECT red_book_absent FROM author_supervision_reports WHERE id = 1').get() as {
    red_book_absent: number;
  };
  assert.equal(row.red_book_absent, 0);
  db.prepare('UPDATE author_supervision_reports SET red_book_absent = 1 WHERE id = 3').run();

  db.prepare(
    `UPDATE author_supervision_reports SET status = 'approved' WHERE status = 'submitted' AND ${RED_BOOK_OK_SQL}`,
  ).run();
  const approved = db
    .prepare(`SELECT id FROM author_supervision_reports WHERE status = 'approved' ORDER BY id`)
    .all()
    .map((r) => (r as { id: number }).id);
  assert.deepEqual(approved, [2, 3, 4]);
});
