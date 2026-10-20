/**
 * NORM-INTEL v3 — нормын мэдэгдлийн бүртгэл, эшлэл, хүчин төгөлдөр байдал, нэр томьёо, давталтын шалгагч.
 * Бүгд ЦЭВЭР: загвар, сүлжээгүй.  «Үнэмшилтэй атлаа баталгаагүй» хариулт заавал ХАТУУ зөрчил болохыг баталгаажуулна.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NORM_INTEL_VERSION,
  detectSevereRepetition,
  ensureSourceBlock,
  renderSourceBlock,
  validateNormIntel,
  type NormIntelBlock,
  type NormSource,
} from '../src/normIntel.ts';
import { enforceContract, fallbackAnswer, hasHardViolation, validateAnswer, type TrustedContract } from '../src/turn/validator.ts';

const SRC: NormSource = {
  code: 'БНбД 11-22-33', titleMn: 'Жишээ норм', clause: '4.3', table: 2, appendix: null, page: 12,
  currentness: 'IN_FORCE_VERIFIED', statusLabelMn: 'Хүчин төгөлдөр (баталгаажсан)', url: 'https://example.test/n', verification: 'verified',
};

function block(over: Partial<NormIntelBlock> = {}): NormIntelBlock {
  return {
    version: NORM_INTEL_VERSION, subtype: 'REQUIREMENT_LOOKUP', topics: [], evidenceState: 'AUTHORITATIVE', generalOnly: false, evidenceBacked: (over.evidenceState ?? 'AUTHORITATIVE') === 'AUTHORITATIVE',
    applicability: { status: 'APPLIES', considered: [], missing: [] },
    claims: [{ id: 'c1', type: 'minimum', subject: 'өргөн', operator: 'gte', value: 1.2, valueMax: null, unit: 'm', authority: 'verified', sourceIndex: 0, applicability: 'APPLIES' }],
    sources: [SRC], sourceBlock: null, userQuoted: [], userNumbers: [], terminology: [], forbidCompliance: true, stateSentence: null, mustDiscloseCurrentness: false,
    ...over,
  };
}
const ctx = { allowedNumbers: [1.2] as number[] };
const codes = (a: string, b: NormIntelBlock = block()) => validateNormIntel(a, b, ctx).map((v) => v.code);

test('grounded answer with the verified number, unit, comparator and real clause passes', () => {
  assert.deepEqual(codes('Өргөн нь 1.2 м-ээс багагүй байх ёстой (БНбД 11-22-33, заалт 4.3, хүснэгт 2, х.12).'), []);
});

test('unsupported but plausible number is a hard violation', () => {
  assert.ok(codes('Өргөн нь 1.5 м-ээс багагүй байх ёстой.').includes('UNSUPPORTED_NORM_NUMBER'));
});

test('invented clause / table / page / document are hard violations', () => {
  assert.ok(codes('Энэ нь заалт 4.3.2-д заасан.').includes('INVENTED_CLAUSE'));
  assert.ok(codes('Хүснэгт 9-д байна.').includes('INVENTED_CLAUSE'));
  assert.ok(codes('Хуудас 99-д байна.').includes('INVENTED_CLAUSE'));
  assert.ok(codes('Үүнийг БНбД 99-99-99 заасан.').includes('INVENTED_DOCUMENT'));
  assert.ok(!codes('Үүнийг БНбД 11-22-33 заасан.').includes('INVENTED_DOCUMENT'));
});

test('a code the user quoted may be mentioned only while disclaiming it', () => {
  const b = block({ evidenceState: 'NO_VERIFIED_MATCH', sources: [], claims: [], userQuoted: ['БНбД 99-99-99'] });
  assert.deepEqual(validateNormIntel('БНбД 99-99-99 гэсэн кодыг баталгаажуулах боломжгүй байна.', b, { allowedNumbers: [] }), []);
  assert.ok(validateNormIntel('БНбД 99-99-99 заасны дагуу байх ёстой.', b, { allowedNumbers: [] }).some((v) => v.code === 'INVENTED_DOCUMENT'));
});

test('comparator swap (>= to >) and unit mismatch are caught against the claim', () => {
  assert.ok(codes('Өргөн нь 1.2 м-ээс их байх ёстой.').includes('COMPARATOR_CHANGED'));
  assert.ok(codes('Өргөн нь 1.2 мм-ээс багагүй байх ёстой.').includes('CLAIM_UNIT_MISMATCH'));
  assert.ok(!codes('Өргөн нь 1.2 м-ээс багагүй байх ёстой.').includes('COMPARATOR_CHANGED'));
  // «-аас дээш» is ambiguous in Mongolian — not a hard comparator violation
  assert.ok(!codes('Өргөн 1.2 м-аас дээш байна.').includes('COMPARATOR_CHANGED'));
});

test('general mode: any regulatory number, modal assertion or fake authority is hard; hedged guidance is fine', () => {
  const g = block({ evidenceState: 'GENERAL_ONLY', generalOnly: true, sources: [], claims: [] });
  const c = (a: string) => validateNormIntel(a, g, { allowedNumbers: [] }).map((v) => v.code);
  assert.ok(c('Коридорын өргөн 1.4 м байх хэрэгтэй.').includes('GENERAL_NUMBER'));
  assert.ok(c('Шатны хонгил заавал утаанаас хамгаалагдсан байх ёстой.').includes('UNSUPPORTED_MODAL'));
  assert.ok(c('Нормд заасан дагуу 2 гарц хэрэгтэй.').length > 0);
  assert.deepEqual(c('Утаа хамгаалалтын зорилго нь гарах замыг аюулгүй байлгах. Тодорхой шаардлагыг хүчинтэй нормын бичвэрээс шалгана уу.'), []);
  // echoing the user's own number is not a regulatory number
  const g2 = block({ evidenceState: 'GENERAL_ONLY', generalOnly: true, sources: [], claims: [], userNumbers: [25] });
  assert.deepEqual(validateNormIntel('Таны 25 давхар барилгын нөхцөл тодорхой болмогц нормоор шалгана.', g2, { allowedNumbers: [] }), []);
});

test('draft / superseded / historical documents can never be promoted to current', () => {
  const draft = block({ evidenceState: 'CURRENTNESS_UNVERIFIED', sources: [{ ...SRC, code: 'БНбД 31-17-23', currentness: 'DRAFT' }], claims: [] });
  const c = (a: string, b: NormIntelBlock) => validateNormIntel(a, b, { allowedNumbers: [] }).map((v) => v.code);
  assert.ok(c('Ноорог баримт хүчинтэй тул үүнийг мөрдөнө.', draft).includes('CURRENTNESS_PROMOTED'));
  assert.ok(c('БНбД 31-17-23 одоо хүчинтэй.', draft).includes('CURRENTNESS_PROMOTED'));
  assert.deepEqual(c('БНбД 31-17-23 нь ноорог тул хүчин төгөлдөр биш.', draft), []);
  const old = block({ evidenceState: 'CURRENTNESS_UNVERIFIED', sources: [{ ...SRC, currentness: 'SUPERSEDED' }], claims: [] });
  assert.ok(c('Солигдсон баримт одоо мөрдөгдөж байгаа.', old).includes('CURRENTNESS_PROMOTED'));
  assert.ok(c('БНбД 11-22-33 хүчинтэй.', old).includes('CURRENTNESS_PROMOTED'));
});

test('fake compliance certification is blocked, honest uncertainty is not', () => {
  const b = block({ evidenceState: 'MISSING_APPLICABILITY_INPUT', claims: [], applicability: { status: 'MISSING_CONTEXT', considered: [], missing: ['барилгын зориулалт'] } });
  const c = (a: string) => validateNormIntel(a, b, { allowedNumbers: [] }).map((v) => v.code);
  assert.ok(c('Таны шийдэл шаардлагыг хангаж байна.').includes('COMPLIANCE_CERTIFICATION'));
  assert.deepEqual(c('Шийдэл нормд нийцэж байгаа эсэхийг одоогоор батлах боломжгүй.'), []);
});

test('missing applicability: a definitive requirement without a condition is blocked', () => {
  const b = block({ applicability: { status: 'MISSING_CONTEXT', considered: [], missing: ['барилгын зориулалт'] } });
  assert.ok(validateNormIntel('Өргөн нь 1.2 м-ээс багагүй байх ёстой.', b, ctx).some((v) => v.code === 'APPLICABILITY_ASSUMED'));
  assert.ok(!validateNormIntel('Хэрэв барилгын зориулалт нь тохирвол өргөн 1.2 м-ээс багагүй байх ёстой.', b, ctx).some((v) => v.code === 'APPLICABILITY_ASSUMED'));
});

test('abbreviation expansion: EI = Equivalent Impact is a hard violation; the approved meaning is not', () => {
  const t = block({ evidenceState: 'GENERAL_ONLY', generalOnly: true, sources: [], claims: [], terminology: [{ abbr: 'EI', keys: ['bur butn', 'tusgaarl', 'integrity', 'insulation'.slice(0, 9)], definitionMn: 'бүрэн бүтэн байдал ба дулаан тусгаарлалт' }] });
  const c = (a: string) => validateNormIntel(a, t, { allowedNumbers: [] }).map((v) => v.code);
  assert.ok(c('EI гэдэг нь Equivalent Impact гэсэн үг.').includes('TERMINOLOGY_INVENTED'));
  assert.ok(c('EI = Equivalent Impact').includes('TERMINOLOGY_INVENTED'));
  const unknown = block({ evidenceState: 'GENERAL_ONLY', generalOnly: true, sources: [], claims: [], terminology: [{ abbr: 'IDA', keys: [], definitionMn: null }] });
  assert.ok(validateNormIntel('IDA гэдэг нь Indoor Air Direct гэсэн үг.', unknown, { allowedNumbers: [] }).some((v) => v.code === 'TERMINOLOGY_INVENTED'));
});

test('contract integration: hard normIntel violation discards the model answer for the deterministic fallback', () => {
  const nb = block({ sourceBlock: renderSourceBlock([SRC]) });
  const c: TrustedContract = {
    version: 'tfc-2', answerMode: 'grounded', risk: 'high', facts: [], allowedNumbers: [1.2], allowedCategories: null, requiredSentence: null, trailerText: null,
    requiredCitations: [], noMatch: false, forbiddenPhrases: [], template: 'Өргөн нь 1.2 м-ээс багагүй байх ёстой.', taskIndex: null, legacyKind: 'norm_trusted', reason: 't', norm: null, normIntel: nb,
  };
  const bad = 'Өргөн нь 1.5 м байх ёстой. Үүнийг заалт 4.3.2 заасан.';
  assert.equal(hasHardViolation(validateAnswer(bad, c)), true);
  const out = enforceContract(bad, c);
  assert.ok(out.answer.startsWith('Өргөн нь 1.2 м-ээс багагүй'));
  assert.ok(out.answer.includes('БНбД 11-22-33'), 'server-owned source block appended');
  assert.equal(out.validation.ok, true);
  assert.ok(fallbackAnswer(c).includes(SRC.url!));
});

test('server-owned source block: no placeholders, no duplicate, only known fields', () => {
  const partial: NormSource = { ...SRC, clause: null, table: null, page: null, url: null, titleMn: null, statusLabelMn: null };
  assert.equal(renderSourceBlock([partial]), 'Эх сурвалж:\n• БНбД 11-22-33');
  assert.equal(renderSourceBlock([{ ...partial, code: null }]), null);
  const sb = renderSourceBlock([SRC])!;
  const nb = block({ sourceBlock: sb });
  const once = ensureSourceBlock('Хариулт.', nb);
  assert.equal(ensureSourceBlock(once, nb), once);
  assert.ok(!/undefined|null|\{\{/.test(sb));
});

test('severe repetition: filler loops, repeated sentence blocks and unit loops are caught; normal prose is not', () => {
  assert.equal(detectSevereRepetition('төсөл, ашиглалтын нөхцөл, төрөл, төлөв, төсөл, ашиглалтын нөхцөл, төрөл, төлөв, төсөл, ашиглалтын нөхцөл, төрөл, төлөв').severe, true);
  assert.equal(detectSevereRepetition('Энэ нь зөв. '.repeat(1) + 'Шатны хонгилыг утаанаас хамгаалах нь чухал. '.repeat(3)).severe, true);
  assert.equal(detectSevereRepetition('өнгөрсөн ' + 'мөшгөлөөр '.repeat(8) + 'хөрвийн дахин').severe, true);
  const ok = 'Утаа хамгаалалт нь галын үед шатны хонгил руу утаа орохоос сэргийлнэ. Хамгаалах арга нь барилгын өндөр, зориулалтаас хамаарна. Тодорхой шаардлагыг хүчинтэй нормын бичвэрээс шалгана. Маш маш их анхаарах хэрэгтэй гэдгийг мартаж болохгүй.';
  assert.equal(detectSevereRepetition(ok).severe, false);
});
