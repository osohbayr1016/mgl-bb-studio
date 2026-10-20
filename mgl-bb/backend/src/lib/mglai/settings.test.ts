/**
 * MGL AI · ТОХИРГОО ба ЗАГВАРЫН МЕТАДАТА — ТЕСТ.
 *
 * Run with:  node --test src/lib/mglai/settings.test.ts
 *
 * ⚠️ Энэ файл нь миграц 0275-ийн INSERT-үүд ба кодын өгөгдмөл ХОЁРЫГ
 *    тулгана.  0195-ийн `assistant.min_confidence` дээр сурсан сургамж
 *    (тайлбарт бичсэн утга кодтой зөрсөн) дахин давтагдахгүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { settingsFromMap, MGLAI_DEFAULTS, MGLAI_SETTING_KEYS } = await import('./settings.ts');
const { modelIdentity, displayName, isRuntimeVariant, RUNTIME_VARIANTS, MGL_AI_VERSION } =
  await import('./version.ts');

/* ================================================================== */
/*  1. Миграцтай тулгах                                                */
/* ================================================================== */

test('0275-ийн үр бүр кодын өгөгдмөлтэй ЯГ таарна', () => {
  const sql = readFileSync(
    new URL('../../../migrations/0275_mgl_ai_settings.sql', import.meta.url),
    'utf8',
  );
  const seeded = new Map<string, string>();
  for (const m of sql.matchAll(/VALUES \('([^']+)', '([^']*)'\)/g)) {
    seeded.set(m[1]!, m[2]!);
  }

  // Түлхүүр бүр тарьсан байх ёстой.
  for (const k of MGLAI_SETTING_KEYS) {
    assert.ok(seeded.has(k), `0275-д «${k}» тарьсангүй`);
  }

  // Тарьсан утга нь кодын өгөгдмөлийг ДАХИН гаргах ёстой.
  const fromSeed = settingsFromMap(seeded);
  assert.deepEqual(fromSeed, MGLAI_DEFAULTS);
});

/* ================================================================== */
/*  2. Буруу утга дээрх зан төлөв                                      */
/* ================================================================== */

test('хоосон тохиргоо нь өгөгдмөлийг өгнө', () => {
  assert.deepEqual(settingsFromMap(new Map()), MGLAI_DEFAULTS);
});

test('enabled нь зөвхөн «0» дээр унтарна', () => {
  assert.equal(settingsFromMap(new Map([['mglai.enabled', '0']])).enabled, false);
  assert.equal(settingsFromMap(new Map([['mglai.enabled', 'false']])).enabled, true);
  assert.equal(settingsFromMap(new Map([['mglai.enabled', '']])).enabled, true);
});

test('client_mode нь зөвхөн «1» дээр АСНА — өгөгдмөл нь хаалттай', () => {
  assert.equal(settingsFromMap(new Map()).clientMode, false);
  assert.equal(settingsFromMap(new Map([['mglai.client_mode', 'true']])).clientMode, false);
  assert.equal(settingsFromMap(new Map([['mglai.client_mode', '1']])).clientMode, true);
});

test('хүрээнээс гарсан тоо нь өгөгдмөл рүү унана', () => {
  const s = settingsFromMap(
    new Map([
      ['mglai.context_tokens', '999999'],
      ['mglai.max_tool_iterations', '-4'],
      ['mglai.evidence_top_k', 'олон'],
    ]),
  );
  assert.equal(s.contextTokens, MGLAI_DEFAULTS.contextTokens);
  assert.equal(s.maxToolIterations, MGLAI_DEFAULTS.maxToolIterations);
  assert.equal(s.evidenceTopK, MGLAI_DEFAULTS.evidenceTopK);
});

/* ================================================================== */
/*  3. Загварын метадата                                               */
/* ================================================================== */

test('UI-ийн нэр нь СУУРЬ ЗАГВАРЫН брэндийг ГАРГАХГҮЙ', () => {
  const name = displayName();
  assert.equal(name, 'MGL AI 1.0');
  assert.equal(/qwen|llama|mistral|gpt|claude/i.test(name), false);
});

test('таних тэмдэг нь бүх хувилбарын талбарыг агуулна', () => {
  const id = modelIdentity('employee-4b-q4');
  assert.equal(id.product, 'MGL AI');
  assert.equal(id.family, 'mgl-ai');
  assert.equal(id.version, MGL_AI_VERSION);
  assert.equal(id.runtime_variant, 'employee-4b-q4');
  assert.ok(id.system_prompt_version.length > 0);
  assert.ok(id.tool_schema_version.length > 0);
  assert.ok(id.retrieval_version.length > 0);
});

test('runtime_variant нь ХААЛТТАЙ олонлог — «ижил загвар» гэж худлаа хэлэхгүй', () => {
  assert.equal(isRuntimeVariant('client-lite'), true);
  assert.equal(isRuntimeVariant('employee-4b-q4'), true);
  assert.equal(isRuntimeVariant('echo'), true);
  assert.equal(isRuntimeVariant('employee-70b'), false);
  // Ажилтны 4B ба захиалагчийн Lite нь ӨӨР утга — нэгтгэх нь §12-ийн
  // «Do not pretend the Lite and 4B weights are identical» -ийг зөрчинө.
  assert.notEqual(
    RUNTIME_VARIANTS.indexOf('client-lite'),
    RUNTIME_VARIANTS.indexOf('employee-4b-q4'),
  );
});
