import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_DOC_00_FOLDERS,
  PROJECT_DOC_07_FOLDERS,
  PROJECT_DOC_11_FOLDERS,
  PROJECT_DOC_FOLDERS,
} from './projectDocTemplate.ts';

test('standard project folders are 00–12 in order', () => {
  assert.equal(PROJECT_DOC_FOLDERS.length, 13);
  const codes = PROJECT_DOC_FOLDERS.map((f) => f.code);
  assert.deepEqual(
    codes,
    ['00', '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
  );
  assert.equal(new Set(codes).size, 13);
  for (const [i, f] of PROJECT_DOC_FOLDERS.entries()) {
    assert.equal(f.sort_order, i);
    assert.ok(f.name.startsWith(f.code));
    assert.ok(f.hint_mn.length > 0);
    assert.ok(f.hint_en.length > 0);
  }
});

test('00 БИЧИГ БАРИМТ has eight numbered child folders', () => {
  assert.equal(PROJECT_DOC_00_FOLDERS.length, 8);
  const codes = PROJECT_DOC_00_FOLDERS.map((f) => f.code);
  assert.deepEqual(codes, ['00-01', '00-02', '00-03', '00-04', '00-05', '00-06', '00-07', '00-08']);
  const rootCodes = new Set(PROJECT_DOC_FOLDERS.map((f) => f.code));
  for (const [i, f] of PROJECT_DOC_00_FOLDERS.entries()) {
    assert.equal(f.sort_order, i + 1);
    assert.ok(!rootCodes.has(f.code));
    assert.ok(f.name.startsWith(String(i + 1).padStart(2, '0')));
    assert.ok(f.hint_mn.length > 0);
  }
});

test('07 АЛБАН БИЧИГ has incoming and outgoing child folders', () => {
  assert.equal(PROJECT_DOC_07_FOLDERS.length, 2);
  assert.deepEqual(
    PROJECT_DOC_07_FOLDERS.map((f) => f.code),
    ['07-01', '07-02'],
  );
  const rootCodes = new Set(PROJECT_DOC_FOLDERS.map((f) => f.code));
  for (const [i, f] of PROJECT_DOC_07_FOLDERS.entries()) {
    assert.equal(f.sort_order, i + 1);
    assert.ok(!rootCodes.has(f.code));
    assert.ok(f.name.startsWith(String(i + 1).padStart(2, '0')));
    assert.ok(f.hint_mn.length > 0);
  }
});

test('11 ЗОХИОГЧИЙН ХЯНАЛТ has eight numbered child folders', () => {
  assert.equal(PROJECT_DOC_11_FOLDERS.length, 8);
  assert.deepEqual(
    PROJECT_DOC_11_FOLDERS.map((f) => f.code),
    ['11-00', '11-01', '11-02', '11-03', '11-04', '11-05', '11-06', '11-07'],
  );
  const rootCodes = new Set(PROJECT_DOC_FOLDERS.map((f) => f.code));
  for (const [i, f] of PROJECT_DOC_11_FOLDERS.entries()) {
    assert.equal(f.sort_order, i);
    assert.ok(!rootCodes.has(f.code));
    assert.ok(f.name.startsWith(String(i).padStart(2, '0')));
    assert.ok(f.hint_mn.length > 0);
  }
});
