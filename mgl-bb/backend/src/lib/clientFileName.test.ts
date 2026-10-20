/**
 * `lib/clientFileName.ts` — захиалагчийн файлын нэр үүсгэгчийн тест.
 *
 * `webPush.test.ts` / `leaveWindow.test.ts`-ийн адил `registerHooks`-оор
 * өргөтгөлгүй харьцангуй импортыг `.ts` руу буулгана: Worker-ийн bundler
 * үүнийг шийддэг ч Node-ийн ESM loader шийддэггүй.
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

// Hook-ийн ДАРАА ачаалагдах ёстой тул динамик импорт.
const { buildFileName, dedupeNames, projectCode, slugPart, translit } = await import(
  './clientFileName.ts'
);

test('translit — кирилл латин болно, том үсэг хадгалагдана', () => {
  assert.equal(translit('Макс Өргөө'), 'Maks Orgoo');
  assert.equal(translit('цахилгаан'), 'tsahilgaan');
  assert.equal(translit('Цахилгаан'), 'Tsahilgaan');
});

test('slugPart — зөвшөөрөгдөөгүй тэмдэгтийг цэвэрлэнэ', () => {
  assert.equal(slugPart('Геологи  тайлан (2026)'), 'Geologi_tailan_2026');
  assert.equal(slugPart('___'), '');
  assert.equal(slugPart('a'.repeat(60), 10), 'aaaaaaaaaa');
});

test('projectCode — бодит төслийн нэрнээс кодыг таана', () => {
  assert.equal(projectCode('MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_AZ'), 'MGL-251222');
  assert.equal(projectCode('MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_ZA'), 'MGL-251222');
});

test('projectCode — загварт нийцэхгүй нэрийг товчилно', () => {
  assert.equal(projectCode('Шинэ зуунмод хот'), 'Shine');
  assert.equal(projectCode(''), 'PROJECT');
});

test('buildFileName — бүх токеныг дүүргэж өргөтгөлийг хадгална', () => {
  const name = buildFileName(
    '{project_code}-{doc_type}-{discipline}-{yyyymmdd}-{seq3}',
    {
      project_code: 'MGL-251222',
      doc_type: 'DAALGAVAR',
      discipline: 'BA',
      date: '2026-09-07',
      seq: 1,
      original: 'даалгавар.pdf',
    },
    'даалгавар.pdf',
  );
  assert.equal(name, 'MGL-251222-DAALGAVAR-BA-20260907-001.pdf');
});

test('buildFileName — хоосон токен давхар зураас үлдээхгүй', () => {
  const name = buildFileName(
    '{project_code}-{doc_type}-{discipline}-{yyyymmdd}-{seq3}',
    {
      project_code: 'MGL-251222',
      doc_type: 'SUDALGAA',
      discipline: null,
      date: '2026-09-07',
      seq: 12,
      original: 'geo.pdf',
    },
    'geo.pdf',
  );
  assert.equal(name, 'MGL-251222-SUDALGAA-20260907-012.pdf');
});

test('buildFileName — өргөтгөлгүй файлыг ч зохицуулна', () => {
  const name = buildFileName('{doc_type}-{seq3}', {
    project_code: 'X',
    doc_type: 'HARIU',
    date: '2026-09-07',
    seq: 3,
    original: 'README',
  }, 'README');
  assert.equal(name, 'HARIU-003');
});

test('buildFileName — {orig} нь анхны нэрийг цэвэрлэж хэрэглэнэ', () => {
  const name = buildFileName('{doc_type}-{orig}', {
    project_code: 'X',
    doc_type: 'LAVLAGAA',
    date: '2026-09-07',
    seq: 1,
    original: 'Загвар зураг №5.jpg',
  }, 'Загвар зураг №5.jpg');
  assert.equal(name, 'LAVLAGAA-Zagvar_zurag_5.jpg');
});

test('buildFileName — бүх токен хоосон байсан ч нэр хоосон гарахгүй', () => {
  const name = buildFileName('{discipline}-{rev}', {
    project_code: 'X',
    doc_type: 'Y',
    discipline: '',
    rev: '',
    date: '2026-09-07',
    seq: 0,
    original: 'file.pdf',
  }, 'file.pdf');
  assert.equal(name, 'file.pdf');
});

test('dedupeNames — давхардсан нэрэнд дугаар нэмнэ (өргөтгөл жижигрэнэ)', () => {
  assert.deepEqual(
    dedupeNames(['a.pdf', 'a.pdf', 'b.pdf', 'A.PDF']),
    ['a.pdf', 'a-2.pdf', 'b.pdf', 'A-3.pdf'],
  );
});
