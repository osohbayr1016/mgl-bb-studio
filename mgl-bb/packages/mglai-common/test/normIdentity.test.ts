/**
 * MGL AI · normIdentity — ТЕСТ (Session D).
 *   node --test test/normIdentity.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compareDatasetIdentity, identityLines, fingerprintFromHex, fromWire, toWire, type NormDocumentIdentity } from '../src/normIdentity.ts';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const doc = (id: string, sha: string | null): NormDocumentIdentity => ({ documentId: id, documentCode: null, datasetId: null, datasetVersion: null, datasetSha256: sha });

test('таарсан → match', () => {
  const r = compareDatasetIdentity([doc('BD', A)], [doc('BD', A), doc('EXTRA', B)]);
  assert.equal(r.status, 'match');
  assert.equal(r.compared, 1);
  assert.deepEqual(r.registryOnly, []);
});

test('зөрсөн → mismatch (баримт нэрлэгдэнэ); том үсэг/зайг тэгшитгэнэ', () => {
  const r = compareDatasetIdentity([doc('BD', A.toUpperCase())], [doc('BD', ` ${B} `)]);
  assert.equal(r.status, 'mismatch');
  assert.deepEqual(r.mismatched, [{ documentId: 'BD', registrySha256: A, knowledgeSha256: B }]);
});

test('бүртгэлд байгаа ч санд байхгүй → registryOnly, not_comparable (зөрчил биш)', () => {
  const r = compareDatasetIdentity([doc('BD', A)], [doc('OTHER', B)]);
  assert.equal(r.status, 'not_comparable');
  assert.deepEqual(r.registryOnly, ['BD']);
});

test('нэг тал sha-гүй (хуучин шингээлт) → unknown, «таарна» гэж хэлэхгүй', () => {
  const r = compareDatasetIdentity([doc('BD', A)], [doc('BD', null)]);
  assert.equal(r.status, 'unknown');
  assert.deepEqual(r.shaMissing, ['BD']);
});

test('mismatch нь unknown/not_comparable-аас давамгайлна', () => {
  const r = compareDatasetIdentity([doc('X', A), doc('Y', A), doc('Z', A)], [doc('X', B), doc('Y', null)]);
  assert.equal(r.status, 'mismatch');
  assert.equal(r.mismatched.length, 1);
  assert.deepEqual(r.shaMissing, ['Y']);
  assert.deepEqual(r.registryOnly, ['Z']);
});

test('хурууны хээний мөр детерминист (эрэмбэ хамаарахгүй), sha-гүй нь ялгарна', () => {
  const a = identityLines([doc('B', B), doc('A', A)]);
  const b = identityLines([doc('A', A), doc('B', B)]);
  assert.equal(a, b);
  assert.equal(a, `A=${A}\nB=${B}`);
  assert.notEqual(identityLines([doc('A', null)]), identityLines([doc('A', A)]));
  assert.equal(fingerprintFromHex('kf1', 'ABCDEF0123456789' + 'f'.repeat(48)), 'kf1:abcdef0123456789');
});

test('wire ↔ объект хос', () => {
  const docs = [{ documentId: 'BD', documentCode: 'БД 21-101-12', datasetId: 'mgl-ai-bd', datasetVersion: '0.2.0', datasetSha256: A }];
  assert.deepEqual(fromWire(toWire(docs)), docs);
  assert.deepEqual(toWire(docs)[0], { document_id: 'BD', document_code: 'БД 21-101-12', dataset_id: 'mgl-ai-bd', dataset_version: '0.2.0', dataset_sha256: A });
});
