/**
 * `lib/complianceAuthority.ts` — v2 §80-ийн эрхийн түвшний тест.
 *
 * Run with:  node --test src/lib/complianceAuthority.test.ts
 *
 * ЮУГ БАРИХ ГЭЖ БАЙНА:
 *   1. `authorityFromSetting` нь ХОГ УТГА БҮРИЙГ хамгийн БАГА эрх рүү
 *      унагаана.  Хэрэв нэг өдөр 'abc' нь 'RECOMMEND' болвол `surface`
 *      ба `recommend` хоёулаа асч, LEVEL 0-д гарах ёстой релиз нь
 *      инженерүүдэд шууд зөвлөмж түлхэж эхэлнэ.
 *   2. `AUTHORITY_CAPS` нь TOTAL — түвшин бүрд мөр байна, `write` нь
 *      зөвхөн 4/5-д true, OBSERVE нь `surface: false`.
 *   3. Эрхүүд нь МОНОТОН — түвшин өсөхөд эрх ХЭЗЭЭ Ч буурахгүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Апп-ын эх код нь өргөтгөлгүй импорт бичдэг (`bimEvents.test.ts:24-31`).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const M = await import('./complianceAuthority.ts');

/* ================================================================== */

test('NULL / хоосон / хог утга БҮГД OBSERVE руу унана', () => {
  const junk: Array<string | null | undefined> = [
    null,
    undefined,
    '',
    '   ',
    'abc',
    'OBSERVE',
    '9',
    '6',
    '-1',
    '1.5',
    'NaN',
    'Infinity',
    '0x2',
    '2abc',
  ];
  for (const raw of junk) {
    assert.equal(
      M.authorityFromSetting(raw),
      'OBSERVE',
      `${JSON.stringify(raw)} нь OBSERVE руу унах ёстой`,
    );
    assert.equal(M.authorityIndexFromSetting(raw), 0, `${JSON.stringify(raw)} → индекс 0`);
  }
});

test('0..5 тэмдэгт мөр нь ЯГ тэр түвшин рүү буулгагдана', () => {
  const expected = [
    'OBSERVE',
    'EXPLAIN',
    'RECOMMEND',
    'PREVIEW',
    'HUMAN_APPROVED_EXECUTE',
    'LIMITED_AUTONOMOUS_EXECUTE',
  ];
  for (let i = 0; i < expected.length; i++) {
    assert.equal(M.authorityFromSetting(String(i)), expected[i]);
    assert.equal(M.authorityIndexFromSetting(String(i)), i);
  }
  // 0230-ийн ҮРЭЭСЛЭГЧ утга нь ЯГ '0'.
  assert.equal(M.authorityFromSetting('0'), 'OBSERVE');
});

test('AUTHORITY_CAPS нь TOTAL — түвшин бүрд мөртэй', () => {
  assert.equal(M.AUTHORITY_LEVELS.length, 6);
  for (const level of M.AUTHORITY_LEVELS) {
    const caps = M.AUTHORITY_CAPS[level];
    assert.ok(caps, `${level}-д эрхийн мөр алга`);
    for (const key of ['collect', 'surface', 'explain', 'recommend', 'preview', 'write']) {
      assert.equal(typeof (caps as Record<string, unknown>)[key], 'boolean', `${level}.${key}`);
    }
  }
});

test('OBSERVE нь ЦУГЛУУЛНА, ГЭВЧ ХАРУУЛАХГҮЙ (релиз N-ийн гэрээ)', () => {
  const caps = M.AUTHORITY_CAPS.OBSERVE;
  assert.equal(caps.collect, true);
  assert.equal(caps.surface, false);
  assert.equal(caps.explain, false);
  assert.equal(caps.recommend, false);
  assert.equal(caps.preview, false);
  assert.equal(caps.write, false);
  // `authorityCaps` нь ЯГ ижил объект буцаана — хоёр дахь бодлого БАЙХГҮЙ.
  assert.equal(M.authorityCaps(M.authorityFromSetting(null)), caps);
});

test('write нь ЗӨВХӨН LEVEL 4/5-д true — релиз N-д хүрэхгүй', () => {
  const writable = M.AUTHORITY_LEVELS.filter((l) => M.AUTHORITY_CAPS[l].write);
  assert.deepEqual(writable, ['HUMAN_APPROVED_EXECUTE', 'LIMITED_AUTONOMOUS_EXECUTE']);
});

test('эрх нь МОНОТОН — түвшин өсөхөд ХЭЗЭЭ Ч буурахгүй', () => {
  const keys = ['collect', 'surface', 'explain', 'recommend', 'preview', 'write'] as const;
  for (let i = 1; i < M.AUTHORITY_LEVELS.length; i++) {
    const prev = M.AUTHORITY_CAPS[M.AUTHORITY_LEVELS[i - 1]!];
    const cur = M.AUTHORITY_CAPS[M.AUTHORITY_LEVELS[i]!];
    for (const k of keys) {
      assert.ok(
        !prev[k] || cur[k],
        `${M.AUTHORITY_LEVELS[i]}.${k} нь өмнөх түвшнээс БУУРСАН`,
      );
    }
  }
});
