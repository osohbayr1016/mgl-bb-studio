import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCharset, hasCharset, isTextFileName, textContentType } from './textCharset.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);

test('isTextFileName covers only the inline-readable extensions', () => {
  for (const n of ['a.txt', 'A.TXT', 'server.log', 'notes.md']) {
    assert.equal(isTextFileName(n), true, n);
  }
  for (const n of ['a.pdf', 'a.dwg', 'a.csv', 'a', 'a.txt.pdf']) {
    assert.equal(isTextFileName(n), false, n);
  }
});

test('Cyrillic UTF-8 is detected as utf-8', () => {
  assert.equal(detectCharset(utf8('Нэмэлт мэдээлэл')), 'utf-8');
  // BOM-той UTF-8
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Нэмэлт')]);
  assert.equal(detectCharset(withBom), 'utf-8');
});

test('UTF-16 BOMs are detected', () => {
  assert.equal(detectCharset(new Uint8Array([0xff, 0xfe, 0x1d, 0x04])), 'utf-16le');
  assert.equal(detectCharset(new Uint8Array([0xfe, 0xff, 0x04, 0x1d])), 'utf-16be');
});

test('windows-1251 Cyrillic falls back instead of being mislabelled utf-8', () => {
  // «Нэмэлт» windows-1251-ээр: UTF-8-д хүчингүй байтын дараалал.
  const cp1251 = new Uint8Array([0xcd, 0xfd, 0xec, 0xfd, 0xeb, 0xf2]);
  assert.equal(detectCharset(cp1251), 'windows-1251');
});

test('a truncated multi-byte character at the sniff boundary is not an error', () => {
  // 64 KB-ийн заагийг давуулж, сүүлчийн тэмдэгтийг тасалдаг урт текст.
  const long = utf8('Нэмэлт '.repeat(20000));
  assert.equal(detectCharset(long), 'utf-8');
});

test('textContentType and hasCharset agree', () => {
  assert.equal(textContentType('utf-8'), 'text/plain; charset=utf-8');
  assert.equal(hasCharset(textContentType('windows-1251')), true);
  assert.equal(hasCharset('text/plain'), false);
  assert.equal(hasCharset(null), false);
});
