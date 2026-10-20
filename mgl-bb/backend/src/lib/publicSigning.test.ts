import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Extensionless relative import нь `node --test`-д зөвхөн .ts resolver-тэй ачаалагдана
// (webPush.test.ts / leaveWindow.test.ts-ийн ижил хэв маяг).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  cleanSigningText,
  expiresAtIso,
  isExpired,
  newPublicSigningToken,
  normalizeExpiryDays,
  sha256Hex,
} = await import('./publicSigning.ts');

test('public signing token is high-entropy url-safe and only its hash is stable', async () => {
  const a = newPublicSigningToken();
  const b = newPublicSigningToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.match(b, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.match(await sha256Hex(a), /^[a-f0-9]{64}$/);
  assert.equal(await sha256Hex(a), await sha256Hex(a));
});

test('expiry is clamped to a safe 1..30 day window', () => {
  assert.equal(normalizeExpiryDays(undefined), 7);
  assert.equal(normalizeExpiryDays(0), 1);
  assert.equal(normalizeExpiryDays(99), 30);
  assert.equal(normalizeExpiryDays(14.9), 14);
  const now = Date.UTC(2026, 9, 4, 0, 0, 0);
  const expiry = expiresAtIso(7, now);
  assert.equal(expiry, '2026-10-11T00:00:00.000Z');
  assert.equal(isExpired(expiry, now), false);
  assert.equal(isExpired(expiry, Date.UTC(2026, 9, 11, 0, 0, 0)), true);
});

test('signing text is normalized and bounded', () => {
  assert.equal(cleanSigningText('  Талбайн   инженер  ', 100), 'Талбайн инженер');
  assert.equal(cleanSigningText('   ', 100), null);
  assert.equal(cleanSigningText('abcdef', 4), 'abcd');
});
