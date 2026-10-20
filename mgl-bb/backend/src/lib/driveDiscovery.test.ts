/**
 * `lib/driveDiscovery.ts`-ийн ЦЭВЭР дүрэм: Drive-ийн үндсэн хавтаснаас шинэ
 * төслийн хавтас илрүүлэх, нэр солигдох, «алгасах» жагсаалт.  Drive/D1 хэсэг
 * (`projectDriveDiscovery.ts`) энд оролцохгүй.
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

const {
  DISCOVERY_FOLDER_MIME,
  IGNORED_MAX,
  addIgnored,
  mainProjectFromFolderName,
  parseIgnored,
  planDiscovery,
  planRenames,
  removeIgnored,
} = await import('./driveDiscovery.ts');

const FOLDER = DISCOVERY_FOLDER_MIME;
const folder = (id: string, name: string, extra: { trashed?: boolean; mimeType?: string } = {}) => ({
  id,
  name,
  mimeType: extra.mimeType ?? FOLDER,
  trashed: extra.trashed,
});

test('нэр: эхний дугаарлалтыг хасаж, DOC кодыг ялгана (09-11-ний гар мөрүүдтэй ижил)', () => {
  assert.deepEqual(mainProjectFromFolderName('00. DOC-260629 ТАЙГАМ АЛТАЙ ОРОН СУУЦ'), {
    code: 'DOC-260629',
    name: 'DOC-260629 ТАЙГАМ АЛТАЙ ОРОН СУУЦ',
  });
  assert.deepEqual(mainProjectFromFolderName('DOC-251006 EVERGREEN'), { code: 'DOC-251006', name: 'DOC-251006 EVERGREEN' });
  assert.deepEqual(mainProjectFromFolderName('mgl-251222 Макс өргөө'), { code: 'MGL-251222', name: 'mgl-251222 Макс өргөө' });
});

test('нэр: кодгүй хавтас ч төсөл болно (эзэн «бүх хавтас» гэж сонгосон)', () => {
  assert.deepEqual(mainProjectFromFolderName('TEMPLATE'), { code: null, name: 'TEMPLATE' });
  assert.deepEqual(mainProjectFromFolderName('  01) Архив '), { code: null, name: 'Архив' });
  // Зөвхөн дугаар бол нэр хоосрохгүй.
  assert.equal(mainProjectFromFolderName('12. ').name, '12.');
});

test('нэр: 7 оронтой / үсэгт наалдсан код код биш', () => {
  assert.equal(mainProjectFromFolderName('DOC-2606291 X').code, null);
  assert.equal(mainProjectFromFolderName('XDOC-260629 X').code, null);
});

test('илрүүлэлт: холбоогүй хавтас л шинээр, нэрээр эрэмбэлсэн', () => {
  const children = [
    folder('b', 'DOC-260901 ШИНЭ Б'),
    folder('linked', 'DOC-251006 EVERGREEN'),
    folder('a', 'DOC-260902 ШИНЭ А'),
    folder('file', 'readme.pdf', { mimeType: 'application/pdf' }),
    folder('sc', 'Shortcut', { mimeType: 'application/vnd.google-apps.shortcut' }),
    folder('tr', 'Хогт', { trashed: true }),
    folder('ign', 'TEMPLATE'),
    folder('a', 'DOC-260902 ШИНЭ А'),
  ];
  const out = planDiscovery(children, new Set(['linked']), new Set(['ign']));
  assert.deepEqual(out, [
    { id: 'b', name: 'DOC-260901 ШИНЭ Б' },
    { id: 'a', name: 'DOC-260902 ШИНЭ А' },
  ]);
});

test('илрүүлэлт: бүгд холбогдсон бол юу ч үүсгэхгүй (idempotent)', () => {
  const children = [folder('x', 'A'), folder('y', 'B')];
  assert.deepEqual(planDiscovery(children, new Set(['x', 'y']), new Set()), []);
});

test('нэр солих: админы өгсөн нэрийг дарахгүй, зөвхөн хавтасны нэрийн кэш', () => {
  const children = [folder('f1', 'DOC-260101 ШИНЭ НЭР'), folder('f2', 'DOC-260102 Б2')];
  const mains = [
    // Нэр нь хавтаснаас үүссэн → дагана.
    { id: 1, name: 'DOC-260101 ХУУЧИН', folder_id: 'f1', folder_name: '00. DOC-260101 ХУУЧИН' },
    // Админ гараар нэрлэсэн → зөвхөн folder_name.
    { id: 2, name: 'Миний нэр', folder_id: 'f2', folder_name: 'DOC-260102 Б' },
    // Өөрчлөгдөөгүй.
    { id: 3, name: 'X', folder_id: 'f3', folder_name: 'X' },
    // Үндсэн хавтасны гадна — хүүхдүүдэд байхгүй.
    { id: 4, name: 'Y', folder_id: 'elsewhere', folder_name: 'Y' },
  ];
  assert.deepEqual(planRenames(children, mains), [
    { id: 1, folder_name: 'DOC-260101 ШИНЭ НЭР', name: 'DOC-260101 ШИНЭ НЭР' },
    { id: 2, folder_name: 'DOC-260102 Б2', name: null },
  ]);
  assert.deepEqual(planRenames([folder('f3', 'X')], mains), []);
});

test('алгасах жагсаалт: эвдэрсэн JSON, давхардал, таазтай', () => {
  assert.deepEqual(parseIgnored(null), []);
  assert.deepEqual(parseIgnored('{bad'), []);
  assert.deepEqual(parseIgnored('{"id":"x"}'), []);
  assert.deepEqual(parseIgnored('[{"id":"a","name":"A"},{"id":"a","name":"B"},{"id":""},{"id":"b"}]'), [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'b' },
  ]);
  let list = addIgnored([], { id: 'a', name: 'A' });
  list = addIgnored(list, { id: 'a', name: 'A2' });
  assert.deepEqual(list, [{ id: 'a', name: 'A2' }]);
  assert.deepEqual(removeIgnored(list, ' a '), []);
  let big: { id: string; name: string }[] = [];
  for (let i = 0; i < IGNORED_MAX + 5; i++) big = addIgnored(big, { id: `f${i}`, name: `F${i}` });
  assert.equal(big.length, IGNORED_MAX);
  assert.equal(big[big.length - 1]!.id, `f${IGNORED_MAX + 4}`);
});
