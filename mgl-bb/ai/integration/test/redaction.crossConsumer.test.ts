/**
 * MGL AI · РЕДАКЦ — ХӨНДЛӨН ХЭРЭГЛЭГЧИЙН ТЭНЦҮҮ БАЙДАЛ (GAP-027, эзний шийдвэр 2026-09-11).
 *
 * Гурван орох цэг ИЖИЛ sentinel оролтод ИЖИЛ гаралт өгөх ёстой:
 *   1. канон  `packages/mglai-common/src/redaction.ts`
 *   2. backend `backend/src/lib/mglai/redaction.ts` (`@mgl/mglai-common/redaction` re-export)
 *   3. ai/deployment `ai/deployment/src/telemetry.ts redactText` (Session B — merge хийгдтэл skip)
 *
 * ⚠️ 2 ба 3 нь ХУУЛБАР биш, канон руу заасан байх ёстой — гаралт тэнцүү байхаас гадна
 *    backend-ийн функц нь канон функцтэй ИЖИЛ объект (===) байх.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO } from '../src/contracts/sources.ts';
import * as canon from '../../../packages/mglai-common/src/redaction.ts';

const SENTINELS = canon.CROSS_CONSUMER_SENTINELS;

test('канон: sentinel бүр маскалагдана, «хэвээр» мөр хэвээр', () => {
  for (const s of SENTINELS.slice(0, -1)) {
    const out = canon.redact(s);
    assert.ok(!canon.containsSentinel(out), out);
    assert.ok(!/SENTINEL-INSTALL|hunter22|Mongol2026|bat@|99112233|AKIAIOSFODNN7EXAMPLE|BEGIN PRIVATE/.test(out), out);
  }
  assert.equal(canon.redact(SENTINELS.at(-1)!), SENTINELS.at(-1));
});

test('backend re-export ≡ канон (ижил функцийн объект)', async () => {
  const p = join(REPO, 'backend', 'src', 'lib', 'mglai', 'redaction.ts');
  assert.ok(existsSync(p), 'backend/src/lib/mglai/redaction.ts алга');
  const be = (await import(pathToFileURL(p).href)) as typeof canon;
  assert.equal(be.redact, canon.redact, 'backend нь канон модулийг импортлоогүй — хуулбар?');
  for (const s of SENTINELS) assert.equal(be.redact(s), canon.redact(s));
});

test('ai/deployment redactText ≡ канон (Session B merge хийгдсэн бол)', async (t) => {
  const p = join(REPO, 'ai', 'deployment', 'src', 'telemetry.ts');
  if (!existsSync(p)) return t.skip('ai/deployment/src/telemetry.ts алга (Session B WIP merge хийгдээгүй)');
  const tel = (await import(pathToFileURL(p).href)) as { redactText?: (s: string) => string };
  assert.equal(typeof tel.redactText, 'function', 'telemetry.ts redactText экспортлоогүй');
  const diffs: string[] = [];
  for (const s of SENTINELS) {
    const a = tel.redactText!(s);
    const b = canon.redactText(s);
    if (a !== b) diffs.push(`${JSON.stringify(s.slice(0, 40))}: deployment=${JSON.stringify(a.slice(0, 60))} канон=${JSON.stringify(b.slice(0, 60))}`);
  }
  assert.deepEqual(diffs, [], `ai/deployment redactText ≠ канон — GAP-027: telemetry.ts нь packages/mglai-common/src/redaction.ts-ийн redactText руу заах ёстой (B)`);
  // Хуулбар биш гэдгийг ч шалгана — ижил функцийн объект.
  assert.equal(tel.redactText, canon.redactText, 'deployment redactText нь канон функц БИШ (хуулбар) — B: re-export болго');
});
