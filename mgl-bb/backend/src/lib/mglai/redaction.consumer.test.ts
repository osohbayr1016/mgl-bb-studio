/**
 * MGL AI · РЕДАКЦ — BACKEND ХЭРЭГЛЭГЧИЙН НОТОЛГОО (GAP-027).
 *
 * `./redaction` (backend-ийн re-export) нь `@mgl/mglai-common/redaction`-тай ИЖИЛ модуль
 * гэдгийг батална — backend-д алгоритмын хуулбар БАЙХГҮЙ.  Session C-ийн `redaction.test.ts`
 * merge-ээр ирээд мөн энэ re-export-ыг ачаална.
 *
 * Run: node --test src/lib/mglai/redaction.consumer.test.ts
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

const viaBackend = await import('./redaction.ts');
const viaPackage = await import('@mgl/mglai-common/redaction');

test('backend ./redaction нь канон багцын ЯГ ТЭР функцүүд (хуулбар биш)', () => {
  assert.equal(viaBackend.redact, viaPackage.redact);
  assert.equal(viaBackend.redactObject, viaPackage.redactObject);
  assert.equal(viaBackend.REDACTION_VERSION, 'mglai-redaction/1');
});

test('sentinel багц дээр backend гаралт = канон гаралт', () => {
  for (const s of viaPackage.CROSS_CONSUMER_SENTINELS) {
    const out = viaBackend.redact(s);
    assert.equal(out, viaPackage.redact(s));
    assert.ok(!viaPackage.containsSentinel(out), out);
    assert.ok(!out.includes('SENTINEL-INSTALL-SECRET'), out);
  }
});
