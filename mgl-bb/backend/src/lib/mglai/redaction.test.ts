/**
 * MGL AI · РЕДАКЦ — ТЕСТ (Session C, 2026-09-11).
 *
 * Run with:  node --test src/lib/mglai/redaction.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ: sentinel нууц, JWT, API түлхүүр, нууц үг, имэйл,
 *    утас ЛОГ/telemetry/экспортод маскалагдана; нормын код, огноо, хувь, төслийн
 *    код, sha256 (64) ХЭВЭЭР (хэт хамгаалалт оношилгоог сохолно).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { redact, redactSecrets, redactObject, containsSentinel } = await import('./redaction.ts');

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
