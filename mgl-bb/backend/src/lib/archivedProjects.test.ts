/**
 * `lib/archivedProjects.ts` — архивласан төсөл зөвхөн админд.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// `archivedProjects.ts` нь `../types`-ийг өргөтгөлгүй импортолдог —
// `leaveWindow.test.ts`-ийн адил зөвхөн тестийн хүрээнд `.ts` руу буулгана.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { seesArchivedProjects, hideArchivedSql, hideArchivedRows } = await import(
  './archivedProjects.ts'
);

const ROWS = [
  { id: 1, status: 'active' },
  { id: 2, status: 'archived' },
  { id: 3, status: 'completed' },
  { id: 4, status: null },
];

test('зөвхөн admin архивыг харна', () => {
  assert.equal(seesArchivedProjects('admin'), true);
  for (const role of ['engineer', 'architect', 'senior', 'client', 'worker']) {
    assert.equal(seesArchivedProjects(role), false, role);
  }
});

test('admin-д мөр хасагдахгүй, SQL хэсэг хоосон', () => {
  assert.deepEqual(
    hideArchivedRows('admin', ROWS).map((r) => r.id),
    [1, 2, 3, 4],
  );
  assert.equal(hideArchivedSql('admin'), '');
});

test('ажилтанд зөвхөн archived мөр хасагдана (NULL төлөв үлдэнэ)', () => {
  for (const role of ['engineer', 'architect', 'senior']) {
    assert.deepEqual(
      hideArchivedRows(role, ROWS).map((r) => r.id),
      [1, 3, 4],
      role,
    );
    assert.match(hideArchivedSql(role), /^ AND COALESCE\(p\.status, ''\) <> 'archived'$/);
  }
});
