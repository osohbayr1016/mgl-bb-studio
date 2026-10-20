import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  audienceMatches,
  audienceWhereSql,
  contentHashOf,
  decodeEntities,
  excerptOf,
  htmlToText,
  isEveryone,
  normalizeAudience,
  parseAckBody,
  parseAudience,
  safeImageSrc,
  sanitizeAnnouncementInput,
  sanitizeHtml,
  serializeAudience,
  signatureObjectKey,
  sniffImageExt,
} from './announcements.ts';

/* ------------------------------------------------------------------ */
/*  Хүрээ                                                              */
/* ------------------------------------------------------------------ */

test('parseAudience: NULL / гажсан JSON / танихгүй утга → бүх ажилтан', () => {
  assert.deepEqual(parseAudience(null), { roles: [], team_ids: [] });
  assert.deepEqual(parseAudience('{oops'), { roles: [], team_ids: [] });
  assert.deepEqual(parseAudience('[1,2]'), { roles: [], team_ids: [] });
  assert.deepEqual(parseAudience('{"roles":["client","worker","hacker"],"team_ids":["x",0,-1,1.5]}'), {
    roles: [],
    team_ids: [],
  });
  assert.ok(isEveryone(parseAudience(null)));
});

test('normalizeAudience: давхардал хасна, зөвхөн ажилтны role, бүхэл id', () => {
  assert.deepEqual(normalizeAudience({ roles: ['senior', 'senior', 'engineer'], team_ids: [2, '2', 3] }), {
    roles: ['senior', 'engineer'],
    team_ids: [2, 3],
  });
  assert.equal(serializeAudience({ roles: [], team_ids: [] }), null);
  assert.equal(serializeAudience({ roles: ['senior'], team_ids: [] }), '{"roles":["senior"],"team_ids":[]}');
});

test('audienceMatches: role × баг хоёулаа биелнэ; worker/client хэзээ ч орохгүй', () => {
  const all = { roles: [], team_ids: [] };
  assert.ok(audienceMatches(all, { role: 'engineer', team_id: null }));
  assert.ok(!audienceMatches(all, { role: 'worker', team_id: 1 }));
  assert.ok(!audienceMatches(all, { role: 'client', team_id: 1 }));

  const ba = normalizeAudience({ roles: ['senior'], team_ids: [2] });
  assert.ok(audienceMatches(ba, { role: 'senior', team_id: 2 }));
  assert.ok(!audienceMatches(ba, { role: 'senior', team_id: 1 }));
  assert.ok(!audienceMatches(ba, { role: 'engineer', team_id: 2 }));
  assert.ok(!audienceMatches(ba, { role: 'senior', team_id: null }));

  const teamOnly = normalizeAudience({ team_ids: [2] });
  assert.ok(audienceMatches(teamOnly, { role: 'engineer', team_id: 2 }));
  assert.ok(!audienceMatches(teamOnly, { role: 'engineer', team_id: null }));
});

test('audienceWhereSql: role литерал, баг bind', () => {
  const all = audienceWhereSql({ roles: [], team_ids: [] });
  assert.match(all.sql, /u\.role IN \('admin','senior','engineer','architect'\)/);
  assert.deepEqual(all.binds, []);
  const ba = audienceWhereSql({ roles: ['senior'], team_ids: [2, 5] });
  assert.match(ba.sql, /u\.role IN \('senior'\)/);
  assert.match(ba.sql, /u\.team_id IN \(\?,\?\)/);
  assert.deepEqual(ba.binds, [2, 5]);
});

/* ------------------------------------------------------------------ */
/*  HTML цэвэрлэгч                                                     */
/* ------------------------------------------------------------------ */

test('sanitizeHtml: энгийн хэлбэржүүлэлт хэвээр, script/style/iframe устгагдана', () => {
  const html =
    '<p>Сайн <b>байна</b> <span style="color: rgb(255, 0, 0); font-weight: bold;">уу</span></p>' +
    '<script>alert(1)</script><style>p{display:none}</style><iframe src="https://x"></iframe>' +
    '<ul><li>нэг</li><li>хоёр</li></ul><h2>Гарчиг</h2><blockquote>иш</blockquote><hr><br>';
  const out = sanitizeHtml(html);
  assert.ok(!/script|alert|<style|display:none|iframe/i.test(out));
  assert.ok(out.includes('<b>байна</b>'));
  assert.ok(out.includes('<span style="color: rgb(255, 0, 0); font-weight: bold">уу</span>'));
  assert.ok(out.includes('<ul><li>нэг</li><li>хоёр</li></ul>'));
  assert.ok(out.includes('<h2>Гарчиг</h2>'));
  assert.ok(out.includes('<hr>') && out.includes('<br>'));
});

test('sanitizeHtml: on* атрибут, javascript: URL, url() style, танихгүй таг', () => {
  const out = sanitizeHtml(
    '<p onclick="x()" style="background: url(http://evil); color: red">t</p>' +
      '<a href="javascript:alert(1)">bad</a><a href="jAvAsCrIpT&#58;alert(1)">bad2</a>' +
      '<a href="https://mgl.mn/x" onmouseover="y()">ok</a>' +
      '<custom-el data-x="1">inner</custom-el><img src="javascript:1"><img src="/media/1-2-abc-x.png" alt="a" width="300" onerror="z()">',
  );
  assert.ok(!/onclick|onmouseover|onerror|javascript|url\(|evil/i.test(out));
  assert.ok(out.includes('<p style="color: red">t</p>'));
  assert.ok(out.includes('<a href="https://mgl.mn/x" target="_blank" rel="noopener noreferrer">ok</a>'));
  assert.ok(out.includes('<a>bad</a>') && out.includes('<a>bad2</a>'));
  assert.ok(out.includes('inner') && !out.includes('custom-el'));
  assert.ok(out.includes('<img src="/media/1-2-abc-x.png" alt="a" width="300">'));
  assert.equal((out.match(/<img/g) ?? []).length, 1);
});

test('sanitizeHtml: тагийн бус < escape, коммент устгагдана, idempotent', () => {
  const out = sanitizeHtml('a < b <!-- secret --> &amp; c <p>d</p>');
  assert.equal(out, 'a &lt; b  &amp; c <p>d</p>');
  const once = sanitizeHtml('<div style="text-align: center"><font color="#ff0000" size="3">x</font></div>');
  assert.equal(sanitizeHtml(once), once);
});

test('sanitizeHtml: холбоос — mailto/tel/харьцангуй зөвшөөрөгдөнө, // хориотой', () => {
  assert.ok(sanitizeHtml('<a href="mailto:a@b.mn">m</a>').includes('href="mailto:a@b.mn"'));
  assert.ok(sanitizeHtml('<a href="/app/projects/1">p</a>').includes('href="/app/projects/1"'));
  assert.ok(sanitizeHtml('<a href="//evil.com">p</a>').includes('<a>p</a>'));
});

test('safeImageSrc / htmlToText / excerptOf', () => {
  assert.equal(safeImageSrc('/media/1-2-abc-x.png'), '/media/1-2-abc-x.png');
  assert.equal(safeImageSrc('/media/a/b.png'), null);
  assert.equal(safeImageSrc('https://cdn.example.com/x.png'), 'https://cdn.example.com/x.png');
  assert.equal(safeImageSrc('http://cdn.example.com/x.png'), null);
  assert.equal(safeImageSrc('data:image/png;base64,AAAA'), null);
  assert.equal(htmlToText('<p>Сайн&nbsp;уу</p><p>Хоёр &amp; гурав</p>'), 'Сайн уу Хоёр & гурав');
  assert.equal(excerptOf('<p>' + 'а'.repeat(300) + '</p>', 20).length, 20);
  assert.equal(decodeEntities('&#x41;&#66;&amp;'), 'AB&');
});

/* ------------------------------------------------------------------ */
/*  Оролт                                                              */
/* ------------------------------------------------------------------ */

test('sanitizeAnnouncementInput: шинэ мөр — гарчиг заавал, бие цэвэрлэгдэнэ', () => {
  const bad = sanitizeAnnouncementInput({ body_html: '<p>x</p>' }, null);
  assert.ok('error' in bad);
  const ok = sanitizeAnnouncementInput(
    { title: '  Шинэчлэлт  ', body_html: '<p>x<script>1</script></p>', kind: 'system_update', ack_mode: 'confirm', audience: { roles: ['senior'] }, pinned: true },
    null,
  );
  assert.ok('input' in ok);
  assert.deepEqual(ok.input, {
    title: 'Шинэчлэлт',
    body_html: '<p>x</p>',
    kind: 'system_update',
    ack_mode: 'confirm',
    audience: { roles: ['senior'], team_ids: [] },
    pinned: true,
  });
});

test('sanitizeAnnouncementInput: PUT — байхгүй талбар өвлөгдөнө, буруу enum 400', () => {
  const existing = {
    title: 'A',
    body_html: '<p>a</p>',
    kind: 'company_info' as const,
    ack_mode: 'signature' as const,
    audience: { roles: [], team_ids: [3] },
    pinned: false,
  };
  const r = sanitizeAnnouncementInput({ title: 'B' }, existing);
  assert.ok('input' in r);
  assert.equal(r.input.body_html, '<p>a</p>');
  assert.equal(r.input.ack_mode, 'signature');
  assert.deepEqual(r.input.audience, { roles: [], team_ids: [3] });
  assert.ok('error' in sanitizeAnnouncementInput({ kind: 'party' }, existing));
  assert.ok('error' in sanitizeAnnouncementInput({ ack_mode: 'maybe' }, existing));
  assert.ok('error' in sanitizeAnnouncementInput({ audience: [1] }, existing));
  const cleared = sanitizeAnnouncementInput({ audience: null }, existing);
  assert.ok('input' in cleared && isEveryone(cleared.input.audience));
});

test('parseAckBody: confirmed заавал, version бүхэл, hash 64 hex', () => {
  const hash = 'a'.repeat(64);
  assert.ok('error' in parseAckBody(null));
  assert.ok('error' in parseAckBody({ ack_version: 1, content_hash: hash }));
  assert.ok('error' in parseAckBody({ confirmed: true, ack_version: 0, content_hash: hash }));
  assert.ok('error' in parseAckBody({ confirmed: true, ack_version: 1, content_hash: 'zz' }));
  assert.deepEqual(parseAckBody({ confirmed: true, ack_version: '2', content_hash: hash.toUpperCase() }), {
    ackVersion: 2,
    contentHash: hash,
  });
});

test('contentHashOf: гарчиг/бие өөрчлөгдвөл өөр, зайг trim', async () => {
  const a = await contentHashOf('T', '<p>x</p>');
  assert.equal(await contentHashOf('  T ', '<p>x</p>'), a);
  assert.notEqual(await contentHashOf('T', '<p>y</p>'), a);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('signatureObjectKey / sniffImageExt', () => {
  assert.equal(signatureObjectKey(7, 2, 5, 'png', 1000, 'abcd1234'), 'announcement-signatures/7/2-5-1000-abcd1234.png');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).buffer;
  assert.equal(sniffImageExt(png), 'png');
  assert.equal(sniffImageExt(new Uint8Array(12).buffer), null);
});
