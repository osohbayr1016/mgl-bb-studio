// Дотоод журмын цэвэр туслахууд (lib/internalRules.ts).
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
  RULE_ROSTER_ROLES,
  RULE_ROSTER_ROLES_SQL,
  RULE_BODY_MAX,
  RULE_FILE_MAX_COUNT,
  canReadRules,
  cleanRuleFileName,
  contentHashOf,
  hasUnpublishedChanges,
  isRuleBodyEmpty,
  isRuleFileId,
  orphanedKeys,
  parseAttachmentRefs,
  parseAttachmentsJson,
  parseSignBody,
  publicAttachment,
  ruleFileExtOf,
  ruleFileIdOf,
  ruleFileObjectKey,
  sanitizeRuleInput,
  serializeAttachments,
  signatureContentTypeOf,
  signatureExtOf,
  signatureObjectKey,
  sniffImageExt,
} = await import('./internalRules.ts');

test('canReadRules — ажилтны 4 role л; client/worker/хоосон хаалттай', () => {
  for (const r of RULE_ROSTER_ROLES) assert.equal(canReadRules(r), true, r);
  assert.equal(canReadRules('client'), false);
  assert.equal(canReadRules('worker'), false);
  assert.equal(canReadRules(null), false);
  assert.equal(canReadRules(undefined), false);
  assert.equal(RULE_ROSTER_ROLES_SQL, "'admin','senior','engineer','architect'");
});

test('contentHashOf — детерминист, CRLF ≡ LF, гарчиг/бие ялгаатай бол өөр', async () => {
  const a = await contentHashOf('Дотоод журам', 'Нэг\nХоёр');
  const b = await contentHashOf('Дотоод журам', 'Нэг\r\nХоёр');
  const c = await contentHashOf('Дотоод журам ', 'Нэг\nХоёр');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b, 'Windows textarea-ийн мөр төгсгөл хэшийг өөрчлөх ёсгүй');
  assert.equal(a, c, 'гарчгийн захын хоосон зай хэшийг өөрчлөх ёсгүй');
  assert.notEqual(a, await contentHashOf('Дотоод журам', 'Нэг\nГурав'));
  assert.notEqual(a, await contentHashOf('Өөр гарчиг', 'Нэг\nХоёр'));
});

test('hasUnpublishedChanges', () => {
  assert.equal(hasUnpublishedChanges('abc', null), true);
  assert.equal(hasUnpublishedChanges('abc', undefined), true);
  assert.equal(hasUnpublishedChanges('abc', 'abc'), false);
  assert.equal(hasUnpublishedChanges('abc', 'abd'), true);
});

test('sanitizeRuleInput — create: гарчиг заавал, урт тайрагдана, бие CRLF→LF', () => {
  assert.deepEqual(sanitizeRuleInput({}, null), { error: 'Гарчиг (title_mn) шаардлагатай' });
  assert.deepEqual(sanitizeRuleInput({ title_mn: '   ' }, null), { error: 'Гарчиг (title_mn) шаардлагатай' });
  const ok = sanitizeRuleInput(
    { title_mn: '  Дотоод журам  ', title_en: '', body_md: 'a\r\nb', sort_order: 3 },
    null,
  );
  assert.deepEqual(ok, {
    input: { title_mn: 'Дотоод журам', title_en: null, body_md: 'a\nb', body_format: 'markdown', sort_order: 3 },
  });
  const long = sanitizeRuleInput({ title_mn: 'x'.repeat(500), body_md: 'y'.repeat(RULE_BODY_MAX + 1) }, null);
  assert.ok('error' in long && /хэт урт/.test(long.error));
  assert.ok('error' in sanitizeRuleInput({ title_mn: 'x', sort_order: 1.5 }, null));
  assert.ok('error' in sanitizeRuleInput({ title_mn: 'x', title_en: 5 }, null));
  assert.ok('error' in sanitizeRuleInput({ title_mn: 'x', body_md: 5 }, null));
});

test('sanitizeRuleInput — partial PUT: байхгүй талбар existing-ээс өвлөнө', () => {
  const existing = { title_mn: 'Хуучин', title_en: 'Old', body_md: 'body', body_format: 'markdown' as const, sort_order: 7 };
  const r = sanitizeRuleInput({ body_md: 'шинэ бие' }, existing);
  assert.deepEqual(r, { input: { ...existing, body_md: 'шинэ бие' } });
  const r2 = sanitizeRuleInput({ title_en: null }, existing);
  assert.deepEqual(r2, { input: { ...existing, title_en: null } });
});

test('parseSignBody — confirmed:true + version_id + 64 hex hash заавал', () => {
  const hash = 'a'.repeat(64);
  assert.deepEqual(parseSignBody({ confirmed: true, version_id: 5, content_hash: hash }), {
    versionId: 5,
    contentHash: hash,
  });
  // тоо мөрөөр ирсэн ч болно, hex том үсэг → жижиг
  assert.deepEqual(parseSignBody({ confirmed: true, version_id: '5', content_hash: hash.toUpperCase() }), {
    versionId: 5,
    contentHash: hash,
  });
  assert.ok('error' in parseSignBody(null));
  assert.ok('error' in parseSignBody({ confirmed: 'true', version_id: 5, content_hash: hash }));
  assert.ok('error' in parseSignBody({ confirmed: true, version_id: 0, content_hash: hash }));
  assert.ok('error' in parseSignBody({ confirmed: true, version_id: 5, content_hash: 'zz' }));
});

test('signatureObjectKey — хувийн угтвар, rule/version/user, өргөтгөл', () => {
  const k = signatureObjectKey(3, 9, 42, 'png', 1700000000000, 'abcd1234');
  assert.equal(k, 'rule-signatures/3/9-42-1700000000000-abcd1234.png');
  assert.equal(signatureContentTypeOf('png'), 'image/png');
  assert.equal(signatureContentTypeOf('jpg'), 'image/jpeg');
  assert.equal(signatureContentTypeOf('webp'), 'image/webp');
  assert.equal(signatureExtOf('image/png'), 'png');
  assert.equal(signatureExtOf('image/jpeg; charset=binary'), 'jpg');
  assert.equal(signatureExtOf('text/html'), null);
  assert.equal(signatureExtOf(null), null);
});

test('sniffImageExt — байтын толгойгоор; HTML/богино → null', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffImageExt(png.buffer), 'png');
  assert.equal(sniffImageExt(jpg.buffer), 'jpg');
  assert.equal(sniffImageExt(webp.buffer), 'webp');
  assert.equal(sniffImageExt(new TextEncoder().encode('<html><body>x</body></html>').buffer), null);
  assert.equal(sniffImageExt(new Uint8Array([0x89, 0x50]).buffer), null);
});

/* ------------------------------------------------------------------ */
/*  0347 — HTML бие + файл хавсралт                                    */
/* ------------------------------------------------------------------ */

test('contentHashOf — 0330-ийн markdown мөрийн хэш ӨӨРЧЛӨГДӨХГҮЙ; html/хавсралт хэшийг солино', async () => {
  const legacy = await contentHashOf('Журам', 'Бие');
  // 0330-ийн томьёо: sha256(`${title}\n\n${body}`)
  const raw = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('Журам\n\nБие')));
  assert.equal(legacy, [...raw].map((b) => b.toString(16).padStart(2, '0')).join(''));
  assert.equal(await contentHashOf('Журам', 'Бие', { format: 'markdown', attachments: [] }), legacy);

  const html = await contentHashOf('Журам', 'Бие', { format: 'html' });
  assert.notEqual(html, legacy);
  const f1 = { sha256: 'a'.repeat(64), size: 10, name: 'журам.pdf' };
  const withFile = await contentHashOf('Журам', 'Бие', { format: 'html', attachments: [f1] });
  assert.notEqual(withFile, html);
  assert.notEqual(
    withFile,
    await contentHashOf('Журам', 'Бие', { format: 'html', attachments: [{ ...f1, sha256: 'b'.repeat(64) }] }),
    'файлын агуулга солигдвол хэш өөр',
  );
  assert.notEqual(
    withFile,
    await contentHashOf('Журам', 'Бие', { format: 'html', attachments: [{ ...f1, name: 'өөр.pdf' }] }),
    'нэр ч орно',
  );
});

test('sanitizeRuleInput — html: сервер цэвэрлэнэ, формат шалгана, формат солихдоо бие заавал', () => {
  const r = sanitizeRuleInput(
    {
      title_mn: 'Журам',
      body_format: 'html',
      body_md: '<h2 onclick="x()">Нэг</h2><script>alert(1)</script><p>Заалт <b>1</b></p>',
    },
    null,
  );
  assert.ok('input' in r);
  assert.equal(r.input.body_format, 'html');
  assert.equal(r.input.body_md, '<h2>Нэг</h2><p>Заалт <b>1</b></p>');

  assert.ok('error' in sanitizeRuleInput({ title_mn: 'x', body_format: 'docx', body_md: 'a' }, null));
  const existing = { title_mn: 'Х', title_en: null, body_md: '## md', body_format: 'markdown' as const, sort_order: 0 };
  const noBody = sanitizeRuleInput({ body_format: 'html' }, existing);
  assert.ok('error' in noBody && /body_md/.test(noBody.error), 'markdown-ыг HTML гэж уншихгүй');
  // Формат өөрчлөгдөөгүй бол бие шаардлагагүй (жишээ нь sort_order л)
  assert.ok('input' in sanitizeRuleInput({ sort_order: 2 }, { ...existing, body_format: 'html', body_md: '<p>x</p>' }));
  // HTML-д markdown-ын 200k хязгаар биш 500k
  const big = sanitizeRuleInput(
    { title_mn: 'x', body_format: 'html', body_md: `<p>${'я'.repeat(RULE_BODY_MAX + 10)}</p>` },
    null,
  );
  assert.ok('input' in big);
});

test('isRuleBodyEmpty — html таг л бол хоосон, зураг/хүснэгт агуулга', () => {
  assert.equal(isRuleBodyEmpty('<p><br></p>', 'html'), true);
  assert.equal(isRuleBodyEmpty('<p>&nbsp;</p>', 'html'), true);
  assert.equal(isRuleBodyEmpty('<p>x</p>', 'html'), false);
  assert.equal(isRuleBodyEmpty('<img src="/media/a.png">', 'html'), false);
  assert.equal(isRuleBodyEmpty('<table><tr><td></td></tr></table>', 'html'), false);
  assert.equal(isRuleBodyEmpty('  \n ', 'markdown'), true);
  assert.equal(isRuleBodyEmpty('<p></p>', 'markdown'), false);
});

test('хавсралтын өргөтгөл/нэр/түлхүүр', () => {
  assert.equal(ruleFileExtOf('Журам.PDF'), 'pdf');
  assert.equal(ruleFileExtOf('a.docx'), 'docx');
  assert.equal(ruleFileExtOf('x.html'), null, 'HTML — API origin дээр XSS эрсдэлтэй');
  assert.equal(ruleFileExtOf('x.svg'), null);
  assert.equal(ruleFileExtOf('setup.exe'), null);
  assert.equal(ruleFileExtOf('noext'), null);
  assert.equal(ruleFileExtOf('a.valueOf'), null, 'prototype-ийн нэр өргөтгөл болохгүй');

  assert.equal(cleanRuleFileName('C:\\Users\\x\\Дотоод журам.pdf'), 'Дотоод журам.pdf');
  assert.equal(cleanRuleFileName('../../etc/a\u0000b.txt'), 'ab.txt');
  const long = cleanRuleFileName(`${'я'.repeat(300)}.docx`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.docx'), 'таслахад өргөтгөл үлдэнэ');

  const key = ruleFileObjectKey('pdf', 1758000000000, 'abcd1234');
  assert.equal(key, 'rule-files/1758000000000-abcd1234.pdf');
  assert.equal(ruleFileIdOf(key), '1758000000000-abcd1234');
  assert.equal(ruleFileIdOf('client/1-1758000000000-abcd1234.pdf'), null);
  assert.equal(ruleFileIdOf('rule-files/../hr/x.pdf'), null);
  assert.equal(isRuleFileId('1758000000000-abcd1234'), true);
  assert.equal(isRuleFileId('../x'), false);
  assert.equal(isRuleFileId(undefined), false);
  // Санамсаргүй түлхүүр нь өөрийнхөө шалгалтыг давна
  assert.ok(ruleFileIdOf(ruleFileObjectKey('docx')) !== null);
});

test('parseAttachmentRefs — хэлбэр, угтвар, давхардал, тоо', () => {
  const k1 = 'rule-files/1758000000000-abcd1234.pdf';
  const k2 = 'rule-files/1758000000001-abcd1235.docx';
  assert.deepEqual(parseAttachmentRefs(null), { refs: [] });
  assert.deepEqual(parseAttachmentRefs([k1, { key: k2, name: ' Журам.docx ' }, { key: k1 }]), {
    refs: [
      { key: k1, name: null },
      { key: k2, name: 'Журам.docx' },
    ],
  });
  assert.ok('error' in parseAttachmentRefs('x'));
  assert.ok('error' in parseAttachmentRefs([{ key: 'hr/1-employment.pdf' }]), 'өөр угтвар хориотой');
  assert.ok('error' in parseAttachmentRefs([{ name: 'x' }]));
  const many = Array.from(
    { length: RULE_FILE_MAX_COUNT + 1 },
    (_, i) => `rule-files/17580000000${String(i).padStart(2, '0')}-abcd1234.pdf`,
  );
  assert.ok('error' in parseAttachmentRefs(many));
});

test('attachments_json — parse/serialize, ажилтанд түлхүүр гарахгүй, өнчин түлхүүр', () => {
  const a = {
    id: '1758000000000-aaaaaaaa',
    key: 'rule-files/1758000000000-aaaaaaaa.pdf',
    name: 'a.pdf',
    size: 3,
    content_type: 'application/pdf',
    sha256: 'f'.repeat(64),
  };
  const b = { ...a, id: '1758000000001-bbbbbbbb', key: 'rule-files/1758000000001-bbbbbbbb.pdf', name: 'b.pdf' };
  const c = { ...a, id: '1758000000002-cccccccc', key: 'rule-files/1758000000002-cccccccc.pdf', name: 'c.pdf' };
  assert.equal(serializeAttachments([]), null);
  assert.deepEqual(parseAttachmentsJson(serializeAttachments([a, b])), [a, b]);
  assert.deepEqual(parseAttachmentsJson(null), []);
  assert.deepEqual(parseAttachmentsJson('{broken'), []);
  assert.deepEqual(parseAttachmentsJson('[{"id":1}]'), [], 'хэлбэр таарахгүй мөр хаягдана');
  assert.equal('key' in publicAttachment(a), false);
  // b-г хассан, c нь нийтлэгдсэн хувилбарт байгаа тул үлдэнэ
  assert.deepEqual(orphanedKeys([a, b, c], [a], new Set([c.key])), [b.key]);
  assert.deepEqual(orphanedKeys([a], [a], new Set()), []);
});
