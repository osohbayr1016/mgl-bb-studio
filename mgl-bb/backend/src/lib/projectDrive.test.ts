/**
 * `lib/projectDrive.ts` + `lib/google/driveBrowse.ts`-ийн ЦЭВЭР хэсгийн тест:
 * хавтасны id ялгах, Drive-ын алдааг ангилах, урьдчилан харах төлөвлөгөө,
 * API мөрийн хэлбэр.  Drive рүү дуудлага хийдэг функцүүд энд ОРОЛЦОХГҮЙ.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Өргөтгөлгүй харьцангуй импортыг `.ts` руу буулгана (leaveWindow.test.ts-тэй ижил).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { parseDriveFolderInput, previewPlan, toProjectDriveItem, effectiveMime, mimeFromFileName } = await import('./projectDrive.ts');
const { classifyDriveFailure, driveBrowseServiceEmail } = await import('./google/driveBrowseCore.ts');

/* ---------------- parseDriveFolderInput ---------------- */

test('parseDriveFolderInput: түүхий id-г хэвээр буцаана', () => {
  assert.equal(parseDriveFolderInput('1AbCdEfGhIjKlMnOpQrStUvWxYz012345'), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345');
  assert.equal(parseDriveFolderInput('  0AKxYz1234567890PVA  '), '0AKxYz1234567890PVA');
});

test('parseDriveFolderInput: Drive-ын холбоосын бүх хэлбэрээс id ялгана', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
  assert.equal(parseDriveFolderInput(`https://drive.google.com/drive/folders/${id}?usp=sharing`), id);
  assert.equal(parseDriveFolderInput(`https://drive.google.com/drive/u/0/folders/${id}`), id);
  assert.equal(parseDriveFolderInput(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(parseDriveFolderInput(`https://drive.google.com/drive/folders/${id}/`), id);
});

test('parseDriveFolderInput: танигдахгүй утга null', () => {
  assert.equal(parseDriveFolderInput(''), null);
  assert.equal(parseDriveFolderInput(null), null);
  assert.equal(parseDriveFolderInput('short'), null);
  assert.equal(parseDriveFolderInput('https://example.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz'), null);
  assert.equal(parseDriveFolderInput('https://drive.google.com/drive/my-drive'), null);
  // Drive-ын id биш тэмдэгт (зай, слэш) — SQL/URL руу орох ёсгүй.
  assert.equal(parseDriveFolderInput("1AbC' or 1=1 --"), null);
});

/* ---------------- classifyDriveFailure ---------------- */

function googleBody(reason: string, message = 'x'): string {
  return JSON.stringify({ error: { code: 0, message, errors: [{ reason, message }] } });
}

test('classifyDriveFailure: статус/reason → code', () => {
  assert.equal(classifyDriveFailure(404, googleBody('notFound')).code, 'NOT_FOUND');
  assert.equal(classifyDriveFailure(401, '').code, 'AUTH_CONFIG');
  assert.equal(classifyDriveFailure(429, '').code, 'RATE_LIMITED');
  assert.equal(classifyDriveFailure(403, googleBody('accessNotConfigured')).code, 'AUTH_CONFIG');
  assert.equal(classifyDriveFailure(403, googleBody('userRateLimitExceeded')).code, 'RATE_LIMITED');
  assert.equal(classifyDriveFailure(403, googleBody('exportSizeLimitExceeded')).code, 'EXPORT_TOO_LARGE');
  assert.equal(classifyDriveFailure(403, googleBody('insufficientFilePermissions')).code, 'PERMISSION_DENIED');
  assert.equal(classifyDriveFailure(500, 'boom').code, 'UNAVAILABLE');
  assert.equal(classifyDriveFailure(503, '<html>').code, 'UNAVAILABLE');
});

test('classifyDriveFailure: JSON биш биетэд ч унахгүй, мессежийг тасална', () => {
  const err = classifyDriveFailure(502, 'x'.repeat(1000));
  assert.equal(err.reason, '');
  assert.ok(err.message.length < 400);
});

/* ---------------- driveBrowseServiceEmail ---------------- */

test('driveBrowseServiceEmail: client_email-ийг л буцаана, нууц түлхүүрийг биш', () => {
  const env = {
    GOOGLE_SA_JSON: JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: 'SECRET' }),
  } as unknown as Parameters<typeof driveBrowseServiceEmail>[0];
  assert.equal(driveBrowseServiceEmail(env), 'sa@p.iam.gserviceaccount.com');
  assert.equal(driveBrowseServiceEmail({} as Parameters<typeof driveBrowseServiceEmail>[0]), null);
  assert.equal(
    driveBrowseServiceEmail({ GOOGLE_SA_JSON: 'not json' } as Parameters<typeof driveBrowseServiceEmail>[0]),
    null,
  );
});

/* ---------------- previewPlan ---------------- */

test('previewPlan: төрөл бүрийн файлд зөв төлөвлөгөө', () => {
  assert.equal(previewPlan({ mimeType: 'application/pdf' }).kind, 'pdf');
  assert.equal(previewPlan({ mimeType: 'image/png' }).kind, 'image');
  // SVG нь скрипт агуулж чаддаг — зураг гэж үзэхгүй.
  assert.equal(previewPlan({ mimeType: 'image/svg+xml', hasThumbnail: false }).kind, 'none');
  assert.equal(previewPlan({ mimeType: 'text/csv' }).kind, 'text');
  assert.deepEqual(previewPlan({ mimeType: 'application/vnd.google-apps.document' }), {
    kind: 'google',
    exportMime: 'application/pdf',
    contentType: 'application/pdf',
  });
  assert.equal(previewPlan({ mimeType: 'application/vnd.google-apps.spreadsheet' }).kind, 'google');
  assert.equal(previewPlan({ mimeType: 'application/vnd.google-apps.presentation' }).kind, 'google');
  // Google Forms/Sites — экспортлогдохгүй → зөвхөн эх файлыг нээх.
  assert.equal(previewPlan({ mimeType: 'application/vnd.google-apps.form' }).kind, 'none');
  // Word/Excel — хөтөч дээр өөрөө render хийнэ (docx-preview / exceljs); Drive-ын
  // нэг хуудасны зураг нь зөвхөн хэт том файлд, PowerPoint-д, хуучин .doc/.xls-д.
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  assert.deepEqual(previewPlan({ mimeType: DOCX, hasThumbnail: true }), { kind: 'docx', contentType: DOCX });
  assert.deepEqual(previewPlan({ mimeType: XLSX, size: '123' }), { kind: 'xlsx', contentType: XLSX });
  // Компанийн бодит тайлангууд 47–110 MB (2026-09-21, прод ledger) — render хийгдэх ЁСТОЙ.
  assert.equal(previewPlan({ mimeType: DOCX, size: String(110 * 1024 * 1024), hasThumbnail: true }).kind, 'docx');
  assert.equal(previewPlan({ mimeType: DOCX, size: String(151 * 1024 * 1024), hasThumbnail: true }).kind, 'thumbnail');
  assert.equal(previewPlan({ mimeType: DOCX, size: String(151 * 1024 * 1024), hasThumbnail: false }).kind, 'none');
  assert.equal(previewPlan({ mimeType: 'application/msword', hasThumbnail: true }).kind, 'thumbnail');
  assert.equal(
    previewPlan({
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      hasThumbnail: true,
    }).kind,
    'thumbnail',
  );
  assert.equal(previewPlan({ mimeType: 'application/zip', hasThumbnail: false }).kind, 'none');
  assert.equal(previewPlan({ mimeType: 'application/vnd.google-apps.folder' }).kind, 'none');
});

test('previewPlan: видео — хөтөч тоглуулж чаддаг контейнер л', () => {
  assert.deepEqual(previewPlan({ mimeType: 'video/mp4', size: '1000' }), { kind: 'video', contentType: 'video/mp4' });
  assert.equal(previewPlan({ mimeType: 'video/webm' }).kind, 'video');
  assert.equal(previewPlan({ mimeType: 'video/quicktime', hasThumbnail: true }).kind, 'thumbnail');
  assert.equal(previewPlan({ mimeType: 'video/mp4', size: String(201 * 1024 * 1024) }).kind, 'none');
});

test('previewPlan: octet-stream файлыг НЭРЭЭР нь таньж render хийнэ', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // ERP-ээс хоосон File.type-тэй байршуулсан .docx — Drive-д octet-stream.
  assert.deepEqual(previewPlan({ mimeType: 'application/octet-stream', name: 'Тайлан 2026.docx', size: '5000' }), {
    kind: 'docx',
    contentType: DOCX,
  });
  assert.equal(previewPlan({ mimeType: 'application/octet-stream', name: 'scan.PDF' }).kind, 'pdf');
  assert.equal(previewPlan({ mimeType: 'application/octet-stream', name: 'photo.jpeg' }).kind, 'image');
  // Танигдахгүй өргөтгөл — хэвээр none/thumbnail.
  assert.equal(previewPlan({ mimeType: 'application/octet-stream', name: 'model.bak', hasThumbnail: false }).kind, 'none');
  assert.equal(previewPlan({ mimeType: 'application/octet-stream', name: 'noext' }).kind, 'none');
  // Drive-ын тодорхой MIME нэрээс ДАВУУ — нэр «.pdf» ч Drive docx гэвэл docx.
  assert.equal(previewPlan({ mimeType: DOCX, name: 'x.pdf' }).kind, 'docx');
  assert.equal(effectiveMime('Application/PDF', 'a.docx'), 'application/pdf');
  assert.equal(effectiveMime('', 'a.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(mimeFromFileName('Зураг.DWG'), 'image/vnd.dwg');
  assert.equal(mimeFromFileName('archive.rar'), null);
  assert.equal(mimeFromFileName(''), null);
});

test('previewPlan: хэт том файлд урьдчилан харахгүй', () => {
  assert.equal(previewPlan({ mimeType: 'application/pdf', size: String(201 * 1024 * 1024) }).kind, 'none');
  assert.equal(previewPlan({ mimeType: 'application/pdf', size: String(157 * 1024 * 1024) }).kind, 'pdf');
  assert.equal(previewPlan({ mimeType: 'text/plain', size: String(3 * 1024 * 1024) }).kind, 'none');
  assert.equal(previewPlan({ mimeType: 'application/pdf', size: String(5 * 1024 * 1024) }).kind, 'pdf');
});

/* ---------------- toProjectDriveItem ---------------- */

test('toProjectDriveItem: Drive-ын мөрөөс зөвхөн хэрэгтэйг нь, тоон хэмжээтэй', () => {
  const item = toProjectDriveItem({
    id: 'f1',
    name: 'Тайлан.pdf',
    mimeType: 'application/pdf',
    modifiedTime: '2026-09-10T01:00:00.000Z',
    size: '12345',
    parents: ['p1'],
    webViewLink: 'https://drive.google.com/file/d/f1/view',
    iconLink: 'https://x/icon.png',
    thumbnailLink: 'https://lh3/secret-ish=s220',
  });
  assert.deepEqual(item, {
    id: 'f1',
    name: 'Тайлан.pdf',
    kind: 'file',
    mime_type: 'application/pdf',
    modified_time: '2026-09-10T01:00:00.000Z',
    size: 12345,
    open_url: 'https://drive.google.com/file/d/f1/view',
    icon_url: 'https://x/icon.png',
    preview: 'pdf',
  });
  // thumbnailLink нь Authorization шаарддаг холбоос — хөтөч рүү ЯВАХГҮЙ.
  assert.ok(!('thumbnailLink' in item));

  const folder = toProjectDriveItem({ id: 'd1', name: 'Архитектур', mimeType: 'application/vnd.google-apps.folder' });
  assert.equal(folder.kind, 'folder');
  assert.equal(folder.preview, 'none');
  assert.equal(folder.size, null);

  const sc = toProjectDriveItem({
    id: 's1',
    name: 'Холбоос',
    mimeType: 'application/vnd.google-apps.shortcut',
    shortcutDetails: { targetId: 'x', targetMimeType: 'application/pdf' },
  });
  assert.equal(sc.kind, 'shortcut');
  assert.equal(sc.shortcut_target_mime, 'application/pdf');
});
