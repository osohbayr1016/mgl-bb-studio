/**
 * `lib/mainProjects.ts`-ийн цэвэр хэсэг: төслийн нэрээс код / суурь нэр /
 * ангиллын залгаварыг ялгах — автомат бүлэглэлтийн үндэс.  Жишээнүүд нь
 * 2026-09-11-ний продакшны бодит нэрүүд.
 */
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

const { parseProjectName, suggestMainProjectName, groupingKey } = await import('./mainProjects.ts');

test('parseProjectName: код + суурь + ангилал (гурван өөр тусгаарлагч)', () => {
  assert.deepEqual(parseProjectName('MGL-251006 EVERGREEN-AZ'), {
    code: 'MGL-251006',
    base: 'EVERGREEN',
    category: 'AZ',
  });
  assert.deepEqual(parseProjectName('MGL-251006_EVERGREEN_ZA'), {
    code: 'MGL-251006',
    base: 'EVERGREEN',
    category: 'ZA',
  });
  assert.deepEqual(parseProjectName('MGL-230314 TOYOTA SERVICE CENTER IZ'), {
    code: 'MGL-230314',
    base: 'TOYOTA SERVICE CENTER',
    category: 'IZ',
  });
});

test('parseProjectName: суурь нэрийн дотоод зураас хэвээр, `_` нь зай', () => {
  assert.deepEqual(parseProjectName('MGL-251222-МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ_AZ'), {
    code: 'MGL-251222',
    base: 'МАКС ӨРГӨӨ-ДАХИН ТӨЛӨВЛӨЛТ',
    category: 'AZ',
  });
  assert.deepEqual(parseProjectName('MGL-230522 Иргэн Батсайханы 25 давхар_IZ'), {
    code: 'MGL-230522',
    base: 'Иргэн Батсайханы 25 давхар',
    category: 'IZ',
  });
  assert.deepEqual(parseProjectName('MGL-240904_ХӨШИГТИЙН ХӨНДИЙ_Захиргааны барилга'), {
    code: 'MGL-240904',
    base: 'ХӨШИГТИЙН ХӨНДИЙ Захиргааны барилга',
    category: null,
  });
});

test('parseProjectName: кодгүй, ангилалгүй нэр — суурь нэр л', () => {
  assert.deepEqual(parseProjectName('  Шинэ төсөл  '), { code: null, base: 'Шинэ төсөл', category: null });
  // «AZ» гэдэг үг нэрийн дунд байвал ангилал гэж УНШИХГҮЙ.
  assert.deepEqual(parseProjectName('MGL-260101 AZ Tower'), { code: 'MGL-260101', base: 'AZ Tower', category: null });
});

test('suggestMainProjectName / groupingKey', () => {
  const p = parseProjectName('MGL-251006_EVERGREEN_ZA');
  assert.equal(suggestMainProjectName(p), 'MGL-251006 EVERGREEN');
  assert.equal(groupingKey(p), 'MGL-251006');
  // Ижил код — өөр тусгаарлагч, өөр ангилал → нэг бүлэг.
  assert.equal(groupingKey(parseProjectName('MGL-251006 EVERGREEN-AZ')), 'MGL-251006');
  // Кодгүй бол суурь нэрээр (жижиг үсгээр).
  assert.equal(groupingKey(parseProjectName('Classic House_EZ')), 'classic house');
  assert.equal(groupingKey(parseProjectName('')), null);
});
