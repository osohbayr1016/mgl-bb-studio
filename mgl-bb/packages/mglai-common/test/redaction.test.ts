/**
 * MGL AI · РЕДАКЦ — ТЕСТ.
 *
 * Эх: Session C `backend/src/lib/mglai/redaction.test.ts` (2026-09-11) — кейсүүд ХЭВЭЭР,
 * зөвхөн импортын зам канон модуль руу.  + Session B `telemetry.ts SECRET_VALUE_RES`-ийн
 * хэв маягийн кейсүүд (B-ийн `redactText` энэ модуль руу шилжихэд регресс гарахгүйн тулд).
 *
 *   node --test test/redaction.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ: sentinel нууц, JWT, API түлхүүр, нууц үг, имэйл,
 *    утас ЛОГ/telemetry/экспортод маскалагдана; нормын код, огноо, хувь, төслийн
 *    код, sha256 (64) ХЭВЭЭР (хэт хамгаалалт оношилгоог сохолно).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redact, redactSecrets, redactObject, redactText, containsSentinel, CROSS_CONSUMER_SENTINELS, REDACTION_VERSION } from '../src/redaction.ts';

/* ── Session C-ийн кейсүүд (хэвээр) ─────────────────────────────────── */

test('sentinel нууц маскалагдана (§40)', () => {
  const r = redactSecrets('токен SECRET_TEST_TOKEN_ABC123 ба нууц үг FAKE_PASSWORD_123 хадгалав');
  assert.ok(!containsSentinel(r.text), r.text);
  assert.equal(r.counts.sentinel, 2);
});

test('JWT, Bearer, API түлхүүр, PEM маскалагдана', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyMzQ1Njc4OTB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const t = redact(`Authorization: Bearer ${jwt}; key sk-ant-abcdefghijklmnopqrstuvwxyz1234; aws AKIAIOSFODNN7EXAMPLE`);
  assert.ok(!t.includes(jwt));
  assert.ok(!t.includes('sk-ant-'));
  assert.ok(!t.includes('AKIAIOSFODNN7EXAMPLE'));
  const pem = redact('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----');
  assert.equal(pem, '[REDACTED_PEM]');
});

test('нууц үг, secret/token түлхүүр-утга маскалагдана (env, JSON, монгол)', () => {
  assert.ok(!redact('password=hunter22').includes('hunter22'));
  assert.ok(!redact('нууц үг: Mongol2026!').includes('Mongol2026'));
  assert.ok(!redact('{"api_key": "abcd1234efgh5678"}').includes('abcd1234efgh5678'));
  assert.ok(!redact('X-MglAi-Secret: 9f8e7d6c5b4a39281706'.replace('X-MglAi-Secret:', 'mglai_secret=')).includes('9f8e7d6c5b4a39281706'));
});

test('имэйл, монгол утасны дугаар маскалагдана', () => {
  const t = redact('Холбоо: bat@mglenc.com, 99112233, +976 8811-2233');
  assert.ok(!t.includes('bat@') && !t.includes('99112233') && !t.includes('8811'), t);
});

test('ХЭТ ХАМГААЛАЛТГҮЙ: нормын код, огноо, хувь, төслийн код, sha256, заалт ХЭВЭЭР', () => {
  const keep = 'БД 21-101-12 хүснэгт 4, БНбД 11-03-21, 2026-09-11, 62.4%, MGL-251006 EVERGREEN, заалт 4.2.1, sha256 ' + 'a'.repeat(64) + ', 1 800 МДж/м²';
  assert.equal(redact(keep), keep);
});

test('redactObject: нууц түлхүүрийн утга бүхэлдээ, бусад мөр маскалагдана, бүтэц хадгалагдана', () => {
  const o = redactObject({ user: 'A', password: 'x', headers: { authorization: 'Bearer abc' }, note: 'mail bat@mglenc.com', n: 3, list: ['SECRET_TEST_TOKEN_1'] });
  assert.equal(o.password, '[REDACTED]');
  assert.equal(o.headers.authorization, '[REDACTED]');
  assert.ok(!o.note.includes('bat@'));
  assert.equal(o.n, 3);
  assert.ok(!containsSentinel(o.list[0]!));
});

test('хоосон/null унагахгүй', () => {
  assert.equal(redact(null), '');
  assert.equal(redact(undefined), '');
  assert.equal(redact(''), '');
});

/* ── Session B-ийн `SECRET_VALUE_RES` хэв маягууд (redactText drop-in) ── */

test('B: `secret=`/`token:` 6–7 тэмдэгтийн утга ч маскалагдана (B-ийн {6,} доод хязгаар)', () => {
  assert.ok(!redactText('token=abc123').includes('abc123'));
  assert.ok(!redactText('secret: q1w2e3r').includes('q1w2e3r'));
  assert.ok(!redactText('api-key=zxcvbn').includes('zxcvbn'));
});

test('B: `x-mglai-secret=` толгой ба JWT (B-ийн {10,} сегмент)', () => {
  const s = 'x-mglai-secret=SENTINEL-INSTALL-SECRET-0123456789abcdef0123456789';
  assert.ok(!redactText(s).includes('SENTINEL-INSTALL'), redactText(s));
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOjQyNDIsImV4cCI6MTk5OTk5OTk5OX0.SENTINELSIGNATURE0123456789';
  assert.equal(redactText(`Bearer ${jwt}`).includes(jwt), false);
});

test('B: аль хэдийн маскалсан `[REDACTED]`-ийг дахин барихгүй (идемпотент)', () => {
  const once = redactText('token=abc123DEF456 password=hunter22');
  assert.equal(redactText(once), once);
});

test('redactText ≡ redact (drop-in) — бүх cross-consumer sentinel дээр', () => {
  for (const s of CROSS_CONSUMER_SENTINELS) assert.equal(redactText(s), redact(s));
  assert.equal(REDACTION_VERSION, 'mglai-redaction/1');
});

/* ── B-ийн олсон алдаа (2026-09-14): SHA-256 доторх 8 оронтой цуваа утас гэж баригдаж байв ── */

const SHA_LOWER = '836fb811a8b2c3f84894884e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c';
const SHA_UPPER = SHA_LOWER.toUpperCase();
const SHA_MIXED = '836FB811a8b2C3f84894884E1f2A3b4c5D6e7f8091A2b3c4D5e6F708192a3B4c';
const HEX40 = 'f84894884e1f2a3b4c5d6e7f8091a2b3c4d5e6f7'; // git sha1 — hex_token дүрэм (40–63) маскална, ЗОРИУД

test('SHA-256 (64 hex, жижиг/том/холимог) ХЭВЭЭР — доторх 8 оронтой цуваа утас БИШ', () => {
  for (const sha of [SHA_LOWER, SHA_UPPER, SHA_MIXED]) {
    assert.equal(redact(sha), sha);
    assert.equal(redact(`artifact_sha256=${sha}`), `artifact_sha256=${sha}`);
  }
});

test('SHA JSON дотор хэвээр (манифест/heartbeat payload)', () => {
  const json = JSON.stringify({ model: { version: '1.0.0', sha256: SHA_LOWER }, knowledge_sha256: SHA_UPPER, fingerprint: 'fp:' + SHA_MIXED.slice(0, 16) });
  assert.equal(redact(json), json);
  const o = redactObject({ sha256: SHA_LOWER, nested: { list: [SHA_UPPER] } });
  assert.equal(o.sha256, SHA_LOWER);
  assert.equal(o.nested.list[0], SHA_UPPER);
});

test('JWT/base64 биеийн доторх 8 оронтой цуваа утас гэж баригдахгүй (JWT дүрэм өөрөө маскална)', () => {
  const b64 = 'QUJDREVGR0g4ODExMjIzM0lKS0xNTk9Q'; // энгийн base64 — утасны хэлбэр байхгүй
  assert.equal(redact(b64), b64);
  const embedded = 'ref=ab99112233cd';
  assert.equal(redact(embedded), embedded, 'ASCII үсгийн дунд байгаа 8 орон нь утас биш');
});

test('бодит утас: 8 орон, зайтай/зураастай, +976 угтвартай, кирилл үг/цэг таслалын хажууд — маскалагдана', () => {
  for (const s of ['99112233', 'Утас:99112233', '+976 8811-2233', '+976-99112233', 'тел. 8811 2233.', '(99112233)', 'утас99112233 залга', '"phone":"99112233"']) {
    const out = redact(s);
    assert.ok(!/\d{4}[\s-]?\d{4}/.test(out), `${s} → ${out}`);
    assert.ok(out.includes('[REDACTED_PHONE]'), `${s} → ${out}`);
  }
});

test('нууц/токены дүрэм ӨӨРЧЛӨГДӨӨГҮЙ (secret_kv, api_key, hex_token 40–63)', () => {
  assert.ok(!redact('token=abc123DEF456').includes('abc123DEF456'));
  assert.ok(!redact('sk-ant-abcdefghijklmnopqrstuvwxyz1234').includes('sk-ant-'));
  assert.equal(redact(HEX40), '[REDACTED_HEX]');
});

test('cross-consumer sentinel багц дээр SHA хэвээр (backend ≡ deployment тэнцүү байдлын оролт)', () => {
  const keep = CROSS_CONSUMER_SENTINELS.at(-1)!;
  assert.ok(keep.includes('a'.repeat(64)));
  assert.equal(redact(keep), keep);
});
