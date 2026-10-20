/**
 * `lib/clientDriveUpload.ts`-ийн ЦЭВЭР дүрэм: «09» хавтсыг нэрээр таних,
 * хүүхдүүдээс сонгох, зорилтот зам 09-ийн дотор эсэх.  Drive/DB хэсэг энд
 * ОРОЛЦОХГҮЙ (route harness тусдаа).
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

const { isClientUploadFolderName, pickClientUploadFolder, uploadAllowedOnPath, CLIENT_UPLOAD_FOLDER_CODE } =
  await import('./clientDriveUpload.ts');

const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';

test('код нь загварын 09', () => {
  assert.equal(CLIENT_UPLOAD_FOLDER_CODE, '09');
});

test('isClientUploadFolderName: загварын нэр ба богино хувилбарууд таарна', () => {
  assert.equal(isClientUploadFolderName('09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ'), true);
  assert.equal(isClientUploadFolderName('09'), true);
  assert.equal(isClientUploadFolderName('09_Client'), true);
  assert.equal(isClientUploadFolderName('09-Материал'), true);
  assert.equal(isClientUploadFolderName('  09 Материал'), true);
});

test('isClientUploadFolderName: 090/091, 9, 08, дунд нь 09 — таарахгүй', () => {
  assert.equal(isClientUploadFolderName('090 Бусад'), false);
  assert.equal(isClientUploadFolderName('091'), false);
  assert.equal(isClientUploadFolderName('9 Материал'), false);
  assert.equal(isClientUploadFolderName('08 EMAIL COMMUNICATION'), false);
  assert.equal(isClientUploadFolderName('10 ЗАХИАЛАГЧААР БАТАЛГААЖСАН ЗУРАГ'), false);
  assert.equal(isClientUploadFolderName('Хуучин 09'), false);
  assert.equal(isClientUploadFolderName(''), false);
});

test('pickClientUploadFolder: зөвхөн жинхэнэ хавтас — файл, товчлол алгасна', () => {
  const entries = [
    { id: 'f-09-pdf', name: '09 тайлбар.pdf', mimeType: 'application/pdf' },
    { id: 'sc-09', name: '09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ', mimeType: SHORTCUT },
    { id: 'd-08', name: '08 EMAIL COMMUNICATION', mimeType: FOLDER },
  ];
  assert.equal(pickClientUploadFolder(entries), null);
  const withReal = [...entries, { id: 'd-09', name: '09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ', mimeType: FOLDER }];
  assert.equal(pickClientUploadFolder(withReal)?.id, 'd-09');
});

test('pickClientUploadFolder: олон таарвал нэрээр эхнийх (детерминист)', () => {
  const a = { id: 'zzz', name: '09 Б', mimeType: FOLDER };
  const b = { id: 'aaa', name: '09 А', mimeType: FOLDER };
  assert.equal(pickClientUploadFolder([a, b])?.id, 'aaa');
  assert.equal(pickClientUploadFolder([b, a])?.id, 'aaa');
});

const ROOT = { id: 'root-folder-id-000', name: 'MGL-251006 EVERGREEN' };
const UP = { id: 'upload-folder-0900', name: '09 ЗАХИАЛАГЧААС ИРСЭН МАТЕРИАЛ' };
const SUB = { id: 'sub-folder-id-0000', name: 'Гэрчилгээ' };
const ARCH = { id: 'arch-folder-id-000', name: '01 PROJECT DESCRIPTION' };

test('uploadAllowedOnPath: 09 өөрөө ба дэд мод — тийм; үндэс, бусад хавтас — үгүй', () => {
  assert.equal(uploadAllowedOnPath([ROOT, UP], UP.id), true);
  assert.equal(uploadAllowedOnPath([ROOT, UP, SUB], UP.id), true);
  assert.equal(uploadAllowedOnPath([ROOT], UP.id), false);
  assert.equal(uploadAllowedOnPath([ROOT, ARCH], UP.id), false);
  assert.equal(uploadAllowedOnPath([ROOT, ARCH, SUB], UP.id), false);
});

test('uploadAllowedOnPath: 09 хавтас олдоогүй (null) бол хаана ч үгүй', () => {
  assert.equal(uploadAllowedOnPath([ROOT, UP], null), false);
  assert.equal(uploadAllowedOnPath([], UP.id), false);
});
