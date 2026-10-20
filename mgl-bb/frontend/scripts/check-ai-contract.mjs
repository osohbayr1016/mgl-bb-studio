/**
 * MGL AI · ХАРИУЛТЫН ГЭРЭЭ — РЕГРЕСС ШАЛГАЛТ (§25, §33).
 *
 *   node scripts/check-ai-contract.mjs        (frontend/ хавтаснаас)
 *
 * ── ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ ──────────────────────────────────────────────
 * Хэмжигдсэн (2026-09-10, Qwen3-8B): загвар «эх сурвалж олдсонгүй» гэж
 * эхлэх тушаалыг үл хайхарч нормын асуултад «бүс нутгийн хөгжил» гэж
 * зохиосон; эрх бүхий шийдвэр байхад «В2 = 10–20 м²» гэсэн зохиомол тоо
 * бичсэн.  Гэрээ тулгагч нь тэдгээрийг ДЕТЕРМИНИСТ байдлаар засна:
 *
 *      ҮНЭН (сервер) > ЗАГВАРЫН ТЕКСТ
 *
 * Мөн ХУДАЛ ЭЕРЭГ-ийн тест: гэрээгүй хариулт ХӨНДӨГДӨХГҮЙ, огноо тоо гэж
 * баригдахгүй, зөвшөөрөгдсөн тоо хасагдахгүй.
 */
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'src', 'features', 'mgl-ai', 'lib');

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const base = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : LIB;
      const asFile = join(base, `${specifier}.ts`);
      if (existsSync(asFile)) return nextResolve(`${specifier}.ts`, context);
      return nextResolve(`${specifier}/index.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { applyContract, numbersIn, splitSentences } = await import(
  '@mgl/mglai-common/turn/contract'
);

let passed = 0;
let failed = 0;
const failures = [];
function scenario(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}\n    ${String(err.message).split('\n')[0]}`);
  }
}

const REFUSAL = 'Энэ шаардлагыг баталгаатай хэлэх эх сурвалж одоогоор олдсонгүй.';
const REFUSAL_CONTRACT = {
  kind: 'norm_refusal',
  requiredSentence: REFUSAL,
  mustMention: [],
  allowedNumbers: [],
  trustedText: null,
  taskIndex: null,
  reason: 't',
};
const V2_CONTRACT = {
  kind: 'norm_decision',
  requiredSentence: null,
  mustMention: ['В2'],
  allowedNumbers: [1401, 2200, 2201, 181, 1400, 1, 180, 13, 4, 2, 3],
  trustedText: 'В2 ангилал: хувийн галын ачаалал g = 1401–2200 МДж/м² (БД 21-101-12, Хүснэгт 4, х.13).',
  taskIndex: null,
  reason: 't',
};

console.log('\nnumbersIn / splitSentences');
scenario('numbersIn · «1 800», «1,5», «2200» бүгд', () => {
  assert.deepEqual(numbersIn('g = 1 800 МДж/м², 1,5 м, 2200'), [1800, 1.5, 2200]);
});
scenario('numbersIn · «В2», «м2» доторх тоо ТОО БИШ', () => {
  assert.deepEqual(numbersIn('В2 ангилал, м2'), []);
});
scenario('splitSentences · цэг, шинэ мөр', () => {
  assert.equal(splitSentences('Нэг. Хоёр!\nГурав').length, 3);
});

console.log('\nГэрээгүй — ХӨНДӨХГҮЙ');
scenario('kind=none → хариулт өөрчлөгдөхгүй', () => {
  const o = applyContract('18 төсөл байна. 5 нь хоцорсон.', { ...REFUSAL_CONTRACT, kind: 'none' });
  assert.equal(o.answer, '18 төсөл байна. 5 нь хоцорсон.');
  assert.equal(o.notices.length, 0);
});
scenario('null гэрээ → өөрчлөгдөхгүй', () => {
  assert.equal(applyContract('x', null).answer, 'x');
  assert.equal(applyContract('x', undefined).answer, 'x');
});

console.log('\nТАТГАЛЗАЛ (norm_refusal)');
scenario('загвар татгалзал бичээгүй → эхэнд НЭМНЭ', () => {
  const o = applyContract('Энэ ачаалал нь V2-ийн хувьд үнэ цэнээрээ бага байдаг.', REFUSAL_CONTRACT);
  assert.ok(o.answer.startsWith(REFUSAL));
  assert.equal(o.appendedRequired, true);
  assert.match(o.answer, /үнэ цэнээрээ/);
});
scenario('зохиомол тоотой өгүүлбэр ХАСАГДАНА, тайлбар үлдэнэ', () => {
  const o = applyContract(
    'В2 ангиллын ачаалал 10 м²-ээс 20 м²-ийг хамарна. Холбогдох норм нь БД 21-101-12 байж болно.',
    REFUSAL_CONTRACT,
  );
  assert.doesNotMatch(o.answer, /10 м²/);
  assert.match(o.answer, /21-101-12/, 'нормын дугаар (21-101-12 нь тоо биш, кодын хэсэг) үлдэнэ');
  assert.equal(o.removedSentences, 1);
  assert.equal(o.notices.length, 1);
  assert.ok(o.answer.startsWith(REFUSAL));
});
scenario('татгалзал аль хэдийн байвал ДАВХАРДУУЛАХГҮЙ', () => {
  const o = applyContract(`${REFUSAL} Холбогдох норм нь БНбД 21-01-02.`, REFUSAL_CONTRACT);
  assert.equal(o.answer.split(REFUSAL).length - 1, 1);
  assert.equal(o.appendedRequired, false);
});
scenario('бүх өгүүлбэр тоотой байвал зөвхөн татгалзал үлдэнэ', () => {
  const o = applyContract('В2 = 1800. В3 = 1400.', REFUSAL_CONTRACT);
  assert.equal(o.answer, REFUSAL);
});
scenario('огноо ТОО ГЭЖ БАРИГДАХГҮЙ (2026-09-10)', () => {
  const o = applyContract('2026-09-10-ны байдлаар эх сурвалж алга.', REFUSAL_CONTRACT);
  assert.match(o.answer, /2026-09-10/);
  assert.equal(o.removedSentences, 0);
});

console.log('\nШИЙДВЭР (norm_decision)');
scenario('хураангуй ЭХЭНД тавигдана, загварын зөв тайлбар үлдэнэ', () => {
  const o = applyContract('В2 ангилалд 1401–2200 МДж/м² багтана. Эх сурвалж: БД 21-101-12, хүснэгт 4, хуудас 13.', V2_CONTRACT);
  assert.ok(o.answer.startsWith(V2_CONTRACT.trustedText));
  assert.match(o.answer, /1401–2200/);
  assert.equal(o.removedSentences, 0);
  assert.equal(o.prependedTrusted, true);
});
scenario('зохиомол тоо (10–20 м²) → тэр өгүүлбэр ХАСАГДАНА', () => {
  const o = applyContract('В2 ангиллын галын ачаалал 10 м²-ээс 20 м²-ийг хамарна.', V2_CONTRACT);
  assert.doesNotMatch(o.answer, /10 м²/);
  assert.ok(o.answer.startsWith(V2_CONTRACT.trustedText));
  assert.equal(o.removedSentences, 1);
});
scenario('ангилал дурдаагүй тайлбар → тэмдэглэл + хураангуй', () => {
  const o = applyContract('Энэ нь бүс нутгийн хөгжлийн асуудал.', V2_CONTRACT);
  assert.ok(o.answer.startsWith(V2_CONTRACT.trustedText));
  assert.ok(o.notices.some((n) => n.includes('ангиллыг дурдаагүй')));
});
scenario('хураангуй аль хэдийн байвал давхардахгүй', () => {
  const o = applyContract(`${V2_CONTRACT.trustedText}\n\nТайлбар.`, V2_CONTRACT);
  assert.equal(o.answer.split(V2_CONTRACT.trustedText).length - 1, 1);
  assert.equal(o.prependedTrusted, false);
});

console.log('\nОЛОН ДААЛГАВАР (taskIndex)');
scenario('зөвхөн 2) хэсэг засагдана, 1) хэсгийн ERP тоо ҮЛДЭНЭ', () => {
  const o = applyContract(
    '1) Манай компанид 18 идэвхтэй төсөл байна.\n2) В2 ангиллын ачаалал 10 м²-ээс 20 м² хүртэл.',
    { ...V2_CONTRACT, taskIndex: 2 },
  );
  assert.match(o.answer, /18 идэвхтэй төсөл/);
  assert.doesNotMatch(o.answer, /10 м²/);
  assert.match(o.answer, /2\)\s*В2 ангилал: хувийн галын ачаалал/);
});
scenario('2) хэсэгт татгалзал алга → 2) дотор нэмнэ, 1) хөндөгдөхгүй', () => {
  const o = applyContract('1) 18 төсөл.\n2) Мэдэхгүй байна.', { ...REFUSAL_CONTRACT, taskIndex: 2 });
  assert.match(o.answer, /^1\) 18 төсөл\./);
  assert.match(o.answer, /2\)\s*Энэ шаардлагыг баталгаатай/);
});
scenario('загвар дугаарлаагүй бол татгалзал ТӨГСГӨЛД нэмэгдэнэ (алдахгүй)', () => {
  const o = applyContract('18 төсөл байна, В2-ийн тухай мэдэхгүй.', { ...REFUSAL_CONTRACT, taskIndex: 2 });
  assert.match(o.answer, /Энэ шаардлагыг баталгаатай/);
  assert.match(o.answer, /18 төсөл/);
});

console.log(`\n${passed} тэнцсэн, ${failed} унасан${failed ? ' · ' + failures.join(' | ') : ''}`);
process.exit(failed ? 1 : 0);
