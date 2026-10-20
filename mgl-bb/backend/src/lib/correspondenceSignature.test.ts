/**
 * `lib/correspondenceSignature.ts`-ийн тест.  Файл импортгүй, цэвэр тул
 * шууд статик импорт (leaveOverlap.test.ts-тэй ижил).
 *
 *   node --test src/lib/correspondenceSignature.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canCancelSignatureRequest,
  canRequestSignature,
  canSign,
  clientSignatureKey,
  correspondencePdfFileName,
  correspondencePdfKey,
  isSignableDocType,
  lockedFieldsIn,
  MAX_SIGNATURE_BYTES,
  parseSignatureDataUrl,
  pdfIsCurrent,
  signatureRequestMailFooter,
} from './correspondenceSignature.ts';

/* ---------- төлөвийн шилжилт ---------- */

test('зөвхөн rfi/cr гарын үсэгтэй', () => {
  assert.equal(isSignableDocType('rfi'), true);
  assert.equal(isSignableDocType('cr'), true);
  assert.equal(isSignableDocType('official'), false);
  assert.equal(isSignableDocType('mr'), false);
  assert.equal(isSignableDocType(null), false);
});

test('хүсэлт: none → ok, pending/signed → 409, OL → 400', () => {
  assert.deepEqual(canRequestSignature({ doc_type: 'rfi', sign_status: 'none' }), { ok: true });
  const p = canRequestSignature({ doc_type: 'cr', sign_status: 'pending' });
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.status, 409);
  const s = canRequestSignature({ doc_type: 'cr', sign_status: 'signed' });
  assert.equal(s.ok, false);
  if (!s.ok) assert.equal(s.status, 409);
  const o = canRequestSignature({ doc_type: 'official', sign_status: 'none' });
  assert.equal(o.ok, false);
  if (!o.ok) assert.equal(o.status, 400);
});

test('цуцлах: зөвхөн pending; signed нь эцсийн', () => {
  assert.deepEqual(canCancelSignatureRequest({ sign_status: 'pending' }), { ok: true });
  assert.equal(canCancelSignatureRequest({ sign_status: 'none' }).ok, false);
  const s = canCancelSignatureRequest({ sign_status: 'signed' });
  assert.equal(s.ok, false);
  if (!s.ok) assert.equal(s.status, 409);
});

test('зурах: зөвхөн pending rfi/cr', () => {
  assert.deepEqual(canSign({ doc_type: 'rfi', sign_status: 'pending' }), { ok: true });
  assert.equal(canSign({ doc_type: 'rfi', sign_status: 'none' }).ok, false);
  assert.equal(canSign({ doc_type: 'rfi', sign_status: 'signed' }).ok, false);
  const mr = canSign({ doc_type: 'mr', sign_status: 'pending' });
  assert.equal(mr.ok, false);
  if (!mr.ok) assert.equal(mr.status, 400);
});

test('signed мөрөнд агуулгын талбар түгжигдэнэ, attachment_url чөлөөтэй', () => {
  assert.deepEqual(lockedFieldsIn({ subject: 'x', attachment_url: '/media/a.png' }), [
    'subject',
  ]);
  assert.deepEqual(lockedFieldsIn({ attachment_url: null }), []);
  // `undefined` = илгээгээгүй, `null` = цэвэрлэх — сүүлийнх нь ч түгжигдэнэ.
  assert.deepEqual(lockedFieldsIn({ body: null, ref_no: undefined }), ['body']);
});

/* ---------- гарын үсгийн зураг ---------- */

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngDataUrl(size: number): string {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_HEADER, 0);
  for (let i = PNG_HEADER.length; i < size; i++) bytes[i] = i % 251;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(bin)}`;
}

test('PNG data URL → байтууд', () => {
  const r = parseSignatureDataUrl(pngDataUrl(2000));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.bytes.length, 2000);
    assert.equal(r.bytes[0], 0x89);
  }
});

test('PNG биш (JPEG толгой, өөр MIME, хоосон, мөр биш) → алдаа', () => {
  const jpeg = pngDataUrl(500).replace(/,.*$/, ',' + btoa('\xff\xd8\xff' + 'x'.repeat(100)));
  assert.equal(parseSignatureDataUrl(jpeg).ok, false);
  assert.equal(parseSignatureDataUrl('data:image/jpeg;base64,AAAA').ok, false);
  assert.equal(parseSignatureDataUrl('').ok, false);
  assert.equal(parseSignatureDataUrl(undefined).ok, false);
  assert.equal(parseSignatureDataUrl(42).ok, false);
  // Толгой зөв ч 64 байтаас бага = хоосон canvas
  assert.equal(parseSignatureDataUrl(pngDataUrl(20)).ok, false);
});

test('512 KB-аас том зураг татгалзана, яг хязгаар дээр өнгөрнө', () => {
  assert.equal(parseSignatureDataUrl(pngDataUrl(MAX_SIGNATURE_BYTES)).ok, true);
  const big = parseSignatureDataUrl(pngDataUrl(MAX_SIGNATURE_BYTES + 1));
  assert.equal(big.ok, false);
  if (!big.ok) assert.match(big.error, /хэт том/);
});

test('base64 доторх мөр таслалт (хөтчийн урт мөр) зөвшөөрөгдөнө', () => {
  const url = pngDataUrl(300);
  const wrapped = url.slice(0, 40) + '\n' + url.slice(40);
  assert.equal(parseSignatureDataUrl(wrapped).ok, true);
});

/* ---------- түлхүүр / нэр ---------- */

test('R2 түлхүүрүүд хувийн client/ нэрийн зайд, мөч бүрд өөр', () => {
  assert.equal(clientSignatureKey(7, 1700000000000, 'abc'), 'client/signatures/corr-7-1700000000000-abc.png');
  assert.equal(
    correspondencePdfKey(7, 1700000000000, 'abc'),
    'client/correspondence-pdf/corr-7-1700000000000-abc.pdf',
  );
  assert.notEqual(clientSignatureKey(7, 1, 'a'), clientSignatureKey(7, 2, 'a'));
});

test('PDF файлын нэр: дугаар → цэвэрлэсэн, дугааргүй → төрөл-id', () => {
  assert.equal(correspondencePdfFileName({ id: 9, doc_type: 'rfi', ref_no: 'RFI-202606-001' }), 'RFI-202606-001.pdf');
  assert.equal(correspondencePdfFileName({ id: 9, doc_type: 'cr', ref_no: null }), 'CR-9.pdf');
  assert.equal(correspondencePdfFileName({ id: 9, doc_type: 'cr', ref_no: '  ' }), 'CR-9.pdf');
  assert.equal(correspondencePdfFileName({ id: 9, doc_type: 'rfi', ref_no: 'RFI 12/3' }), 'RFI-12-3.pdf');
  // Кирилл үлдэнэ (RFC 5987 filename* нь толгойд), хориотой тэмдэгт хасагдана
  assert.equal(correspondencePdfFileName({ id: 9, doc_type: 'rfi', ref_no: 'Хүсэлт №5:"a"' }), 'Хүсэлт-No5a.pdf');
});

/* ---------- PDF кэш хүчинтэй эсэх ---------- */

test('pdfIsCurrent: түлхүүргүй/хуучирсан → false, шинэ → true', () => {
  assert.equal(
    pdfIsCurrent({ pdf_key: null, pdf_generated_at: null, updated_at: '2026-09-21 01:00:00', client_signed_at: null }),
    false,
  );
  // datetime('now') ба ISO хоёр хэлбэр зэрэгцэн тулгагдана
  assert.equal(
    pdfIsCurrent({
      pdf_key: 'k',
      pdf_generated_at: '2026-09-21T02:00:00.000Z',
      updated_at: '2026-09-21 01:00:00',
      client_signed_at: null,
    }),
    true,
  );
  // Засвар PDF-ээс хойно → хуучирсан
  assert.equal(
    pdfIsCurrent({
      pdf_key: 'k',
      pdf_generated_at: '2026-09-21T02:00:00.000Z',
      updated_at: '2026-09-21 03:00:00',
      client_signed_at: null,
    }),
    false,
  );
  // Гарын үсэг PDF-ээс хойно → хуучирсан (гарын үсэггүй PDF-ийг өгч болохгүй)
  assert.equal(
    pdfIsCurrent({
      pdf_key: 'k',
      pdf_generated_at: '2026-09-21T02:00:00.000Z',
      updated_at: '2026-09-21 01:00:00',
      client_signed_at: '2026-09-21T02:30:00.000Z',
    }),
    false,
  );
});

test('имэйлийн хөл порталын холбоостой, давхар слэшгүй', () => {
  const f = signatureRequestMailFooter('https://mgl-design-system.pages.dev/');
  assert.match(f, /https:\/\/mgl-design-system\.pages\.dev\/client$/);
  assert.match(f, /ГАРЫН ҮСЭГ/);
});
