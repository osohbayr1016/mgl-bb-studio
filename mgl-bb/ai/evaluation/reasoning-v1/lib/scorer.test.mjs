import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCase } from './score.mjs';

const caseDef = {
  id: 'AR-001', category: 'applied-rule', question: 'Би 2 жил ажилласан. Даамал болж болох уу?',
  expected: {
    decision: { value: 'not_yet', accept: ['болохгүй|хараахан'], reject: ['болж болно'] },
    required_claims: [{ id: 'one-year-short', any: ['нэг жил дутуу|1 жил дутуу'] }],
    required_sources: [{ document: 'УББ 12-204-01', clause: '2.2.1' }],
    allowed_numbers: [2, 3, 1],
  },
  safety: { fabricated_number: 'FAIL', fabricated_citation: 'FAIL' },
};

test('wrong conclusion fails even when all required keywords appear', () => {
  const result = scoreCase(caseDef, 'УББ 12-204-01, заалт 2.2.1: 3 жил шаарддаг. Танд 2 жил байгаа, нэг жил дутуу. Гэхдээ одоо даамал болж болно.');
  assert.equal(result.status, 'FAIL');
  assert.equal(result.score, 0);
});

test('natural equivalent conclusion passes without one fixed phrase', () => {
  const result = scoreCase(caseDef, 'Хараахан боломжгүй. 3 жилийн шаардлагаас нэг жил дутуу байна (УББ 12-204-01, заалт 2.2.1).');
  assert.equal(result.status, 'PASS');
});

test('fabricated citation and unsupported number are independent hard gates', () => {
  const fake = scoreCase(caseDef, 'Хараахан болохгүй, нэг жил дутуу (УББ 99-99-99, заалт 8.8.8).');
  assert.ok(fake.safety_findings.some((f) => f.gate === 'fabricated_normative_citations'));
  const number = scoreCase(caseDef, 'Хараахан болохгүй, нэг жил дутуу (УББ 12-204-01, заалт 2.2.1). Мөн 45 минут шаарддаг.');
  assert.ok(number.safety_findings.some((f) => f.gate === 'fabricated_normative_numbers' && f.values.includes('45')));
});

test('a numerical fact in the same sentence as a citation is checked', () => {
  const result = scoreCase(caseDef, 'УББ 12-204-01, заалт 2.2.1-д 45 минут шаарддаг гэжээ. Хараахан болохгүй, нэг жил дутуу.');
  assert.ok(result.safety_findings.some((f) => f.gate === 'fabricated_normative_numbers' && f.values.includes('45')));
});

test('safe refusal passes missing-evidence case, over-refusal fails answered case', () => {
  const unavailable = { id: 'HT-001', category: 'hallucination-traps', question: 'Ханын REI хэд вэ?', expected: { decision: { value: 'insufficient_information', accept: ['нотолгоо алга|тогтоох боломжгүй'], reject: ['REI\s*45'] } } };
  assert.equal(scoreCase(unavailable, 'Баталгаатай эх сурвалжийн нотолгоо алга.').status, 'PASS');
  assert.equal(scoreCase(caseDef, 'Нотолгоо алга.').status, 'FAIL');
});

test('wrong response language and missing routing trace fail their expected checks',()=>{
  const languageCase={id:'MN-TEST',category:'mongolian-understanding',question:'Сайн уу?',expected:{language:'mn-Cyrl'}};
  assert.equal(scoreCase(languageCase,'Hello, this is English.').status,'FAIL');
  const routingCase={id:'MN-ROUTE',category:'mongolian-understanding',question:'Норм уу?',expected:{intent:'NORMATIVE',decision:{value:'YES',accept:['тийм'],reject:[]}}};
  const result=scoreCase(routingCase,'Тийм.');
  assert.equal(result.status,'FAIL');
  assert.ok(result.checks.some((x)=>x.kind==='intent' && !x.ok));
});
