/**
 * `lib/projectDriveUpload.ts` — ERP-ээс Drive руу байршуулах ЦЭВЭР хэсэг:
 * нэрийн ариутгал, MIME, chunk-ийн хил, гарын үсэгтэй токен.
 * Drive/D1 хөндөгдөхгүй (route + `driveResumable*` нь `googleAuth.ts`-ийг
 * татдаг тул `node --test`-д ачаалагдахгүй).
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
  UPLOAD_CHUNK_BYTES,
  REVISION_MAX_BYTES,
  checkChunk,
  isRevisableDocx,
  normalizeUploadMime,
  parseConflict,
  parseRevisionRequest,
  sanitizeUploadName,
  signUploadTicket,
  verifyUploadTicket,
} = await import('./projectDriveUpload.ts');

/* ---- нэр ------------------------------------------------------------ */

test('sanitizeUploadName: замын тэмдэг, удирдлагын тэмдэгт, захын цэг', () => {
  assert.equal(sanitizeUploadName('  Зураг 01.pdf  '), 'Зураг 01.pdf');
  assert.equal(sanitizeUploadName('../../etc/passwd'), '_.._etc_passwd');
  assert.equal(sanitizeUploadName('a\\b/c.dwg'), 'a_b_c.dwg');
  assert.equal(sanitizeUploadName('tab\tname\u0000.txt'), 'tabname.txt');
  assert.equal(sanitizeUploadName('.hidden'), 'hidden');
  assert.equal(sanitizeUploadName('trailing. . '), 'trailing');
});

test('sanitizeUploadName: хоосон / зөвхөн цэг / буруу төрөл → null', () => {
  assert.equal(sanitizeUploadName(''), null);
  assert.equal(sanitizeUploadName('   '), null);
  assert.equal(sanitizeUploadName('..'), null);
  assert.equal(sanitizeUploadName('...'), null);
  assert.equal(sanitizeUploadName(42), null);
  assert.equal(sanitizeUploadName(undefined), null);
});

test('sanitizeUploadName: 255-аас урт нэр тайрагдана', () => {
  const long = 'ф'.repeat(300) + '.pdf';
  const out = sanitizeUploadName(long);
  assert.ok(out && out.length <= 255);
});

/* ---- mime ----------------------------------------------------------- */

test('normalizeUploadMime: хоосон/буруу → octet-stream; Google формат зохиож болохгүй', () => {
  assert.equal(normalizeUploadMime(''), 'application/octet-stream');
  assert.equal(normalizeUploadMime(undefined), 'application/octet-stream');
  assert.equal(normalizeUploadMime('not a mime'), 'application/octet-stream');
  assert.equal(normalizeUploadMime('application/vnd.google-apps.document'), 'application/octet-stream');
  assert.equal(normalizeUploadMime('Application/PDF'), 'application/pdf');
  assert.equal(normalizeUploadMime('image/vnd.dwg'), 'image/vnd.dwg');
  // Хөтөч type өгөөгүй → нэрээр нь (өмнө нь octet-stream .docx үүсч, урьдчилан харагддаггүй байв).
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  assert.equal(normalizeUploadMime('', 'Тайлан.docx'), DOCX);
  assert.equal(normalizeUploadMime(undefined, 'a.pdf'), 'application/pdf');
  assert.equal(normalizeUploadMime('application/octet-stream', 'a.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(normalizeUploadMime('application/vnd.google-apps.document', 'a.docx'), DOCX);
  // Танигдахгүй өргөтгөл / нэргүй → хэвээр octet-stream; хөтчийн тодорхой type нэрээс давуу.
  assert.equal(normalizeUploadMime('', 'model.bak'), 'application/octet-stream');
  assert.equal(normalizeUploadMime('', null), 'application/octet-stream');
  assert.equal(normalizeUploadMime('application/pdf', 'a.docx'), 'application/pdf');
});

test('parseConflict: өгөгдмөл replace, буруу утга null', () => {
  assert.equal(parseConflict(undefined), 'replace');
  assert.equal(parseConflict('keep'), 'keep');
  assert.equal(parseConflict('replace'), 'replace');
  assert.equal(parseConflict('overwrite'), null);
});

/* ---- chunk ---------------------------------------------------------- */

test('checkChunk: chunk-ийн хилээс эхэлж, яг хүлээгдсэн урттай байх ёстой', () => {
  const C = UPLOAD_CHUNK_BYTES;
  const size = C * 2 + 1000;
  assert.deepEqual(checkChunk(0, C, size), { ok: true, length: C, last: false });
  assert.deepEqual(checkChunk(C, C, size), { ok: true, length: C, last: false });
  assert.deepEqual(checkChunk(2 * C, 1000, size), { ok: true, length: 1000, last: true });
  // Жижиг файл — ганц chunk, урт = хэмжээ.
  assert.deepEqual(checkChunk(0, 10, 10), { ok: true, length: 10, last: true });
});

test('checkChunk: буруу offset / урт', () => {
  const C = UPLOAD_CHUNK_BYTES;
  assert.deepEqual(checkChunk(1, C, C * 2), { ok: false, reason: 'BAD_OFFSET' });
  assert.deepEqual(checkChunk(C * 2, 1, C * 2), { ok: false, reason: 'BAD_OFFSET' });
  assert.deepEqual(checkChunk(-C, C, C * 2), { ok: false, reason: 'BAD_OFFSET' });
  assert.deepEqual(checkChunk(0, C - 1, C * 2), { ok: false, reason: 'BAD_LENGTH' });
  assert.deepEqual(checkChunk(C, C, C + 5), { ok: false, reason: 'BAD_LENGTH' });
  assert.deepEqual(checkChunk(0, Number.NaN, C), { ok: false, reason: 'BAD_LENGTH' });
});

test('UPLOAD_CHUNK_BYTES нь Google-ийн 256 KiB-ийн үржвэр', () => {
  assert.equal(UPLOAD_CHUNK_BYTES % (256 * 1024), 0);
});

/* ---- токен ---------------------------------------------------------- */

const ticket = {
  session: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=ABC',
  root: 'root1234567890',
  parent: 'parent1234567890',
  name: 'Зураг.pdf',
  mime: 'application/pdf',
  size: 12345,
  existing: null,
  user: 7,
  exp: Date.now() + 60_000,
};

test('upload ticket: гарын үсэг таарвал буцаана', async () => {
  const tok = await signUploadTicket('secret-A', ticket);
  assert.equal(tok.split('.').length, 2, 'ХОЁР хэсэгтэй — JWT биш');
  const back = await verifyUploadTicket('secret-A', tok);
  assert.deepEqual(back, ticket);
});

test('upload ticket: өөр нууц, өөрчилсөн payload, хугацаа дууссан → null', async () => {
  const tok = await signUploadTicket('secret-A', ticket);
  assert.equal(await verifyUploadTicket('secret-B', tok), null);
  const [payload, sig] = tok.split('.') as [string, string];
  // payload-ыг солих: өөр root-той тикет үүсгээд гарын үсгийг хуучнаар үлдээнэ.
  const other = await signUploadTicket('secret-A', { ...ticket, root: 'evil' });
  const spliced = `${other.split('.')[0]}.${sig}`;
  assert.equal(await verifyUploadTicket('secret-A', spliced), null);
  assert.equal(await verifyUploadTicket('secret-A', `${payload}.${sig}x`), null);
  const expired = await signUploadTicket('secret-A', { ...ticket, exp: Date.now() - 1 });
  assert.equal(await verifyUploadTicket('secret-A', expired), null);
});

test('upload ticket: session нь Google-ийн upload хаяг биш бол хүлээж авахгүй', async () => {
  const tok = await signUploadTicket('secret-A', { ...ticket, session: 'https://evil.example/upload' });
  assert.equal(await verifyUploadTicket('secret-A', tok), null);
});

test('upload ticket: хэлбэр буруу / хэт урт', async () => {
  assert.equal(await verifyUploadTicket('secret-A', 'a.b.c'), null);
  assert.equal(await verifyUploadTicket('secret-A', 'nodot'), null);
  assert.equal(await verifyUploadTicket('secret-A', 'x'.repeat(9000)), null);
});

/* ---- «Эх файлыг нээх» — ИЖИЛ .docx-ийн шинэ хувилбар (2026-09-30) ---- */

test('parseRevisionRequest: хэмжээ, тааз, суурь modifiedTime заавал', () => {
  assert.deepEqual(parseRevisionRequest({ size: 1234, base_modified_time: '2026-09-18T00:44:41.123Z' }), {
    ok: true,
    size: 1234,
    base: '2026-09-18T00:44:41.123Z',
  });
  assert.deepEqual(parseRevisionRequest({ size: 0, base_modified_time: 'x' }), { ok: false, code: 'EMPTY_FILE' });
  assert.deepEqual(parseRevisionRequest({ size: 1.5, base_modified_time: 'x' }), { ok: false, code: 'EMPTY_FILE' });
  assert.deepEqual(parseRevisionRequest({ size: '12', base_modified_time: 'x' }), { ok: false, code: 'EMPTY_FILE' });
  assert.deepEqual(parseRevisionRequest({ size: REVISION_MAX_BYTES + 1, base_modified_time: 'x' }), {
    ok: false,
    code: 'REVISION_TOO_LARGE',
  });
  assert.deepEqual(parseRevisionRequest({ size: 10 }), { ok: false, code: 'BASE_REQUIRED' });
  assert.deepEqual(parseRevisionRequest({ size: 10, base_modified_time: '  ' }), { ok: false, code: 'BASE_REQUIRED' });
  assert.deepEqual(parseRevisionRequest(null), { ok: false, code: 'EMPTY_FILE' });
});

test('isRevisableDocx: зөвхөн жинхэнэ .docx (Google формат, товчлол биш)', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  assert.equal(isRevisableDocx({ name: 'RFI_017.docx', mimeType: DOCX }), true);
  assert.equal(isRevisableDocx({ name: 'RFI_017.docx', mimeType: 'application/octet-stream' }), true);
  assert.equal(isRevisableDocx({ name: 'RFI_017', mimeType: 'application/vnd.google-apps.document' }), false);
  assert.equal(isRevisableDocx({ name: 'RFI_017.docx', mimeType: 'application/vnd.google-apps.shortcut' }), false);
  assert.equal(isRevisableDocx({ name: 'a.pdf', mimeType: 'application/pdf' }), false);
  assert.equal(isRevisableDocx({ name: 'a.bin', mimeType: 'application/octet-stream' }), false);
});
