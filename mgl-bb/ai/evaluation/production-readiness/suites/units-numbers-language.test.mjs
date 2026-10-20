/**
 * MGL AI · UNITS · DECIMALS · LANGUAGE ROUTER · FUZZ (Session C, 2026-09-11).
 *
 *   node --test ai/evaluation/production-readiness/suites/units-numbers-language.test.mjs
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ (мандат §10, §37–§39):
 *   · нэгжийн хэвийжүүлэлт: kPa ≠ Pa, МДж/м² ≡ MJ/m2, мм ≠ м (аюултай холилт 0);
 *   · тооны уншилт: «1,5» = 1.5, «1 500» = 1500, «1,500» = мянгат (яг 3 орон);
 *     огноо/цаг/баримтын код/заалт ТОО БИШ;
 *   · нормын хэмжигдэхүүн (g) бичлэгийн 8 хувилбар — ЗӨВХӨН ХЭМЖИНЭ, унасныг
 *     A-д хандивлана (normEntities.ts нь Session A-ийн хүрээ);
 *   · хэлний чиглүүлэлт: латин монгол ≠ англи; англи үг («end», «bid») монгол
 *     болгохгүй; ил хүсэлт («монголоор хариул») бүхнээс дээгүүр.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend, loadFrontend } from '../lib/load.mjs';

const { normalizeUnit } = await loadBackend('trustedFacts.ts');
const { extractNormEntities } = await loadBackend('normEntities.ts');
const { detectLanguage, normalizeLatinMongolian } = await loadBackend('lang.ts');
const { classifyIntent } = await loadBackend('intent.ts');
const V = await import('@mgl/mglai-common/turn/validator');

/* ── §38 нэгж ────────────────────────────────────────────────────── */
test('normalizeUnit: ижил утгын бичлэгүүд НЭГ канонд', () => {
  const same = (list, canon) => {
    for (const u of list) assert.equal(normalizeUnit(u), canon, `${u} → ${normalizeUnit(u)} ≠ ${canon}`);
  };
  same(['MJ/m²', 'MJ/m2', 'МДж/м²', 'мдж/м2', 'МДж / м²', 'mj/m2'], 'MJ/m2');
  same(['м²', 'm2', 'кв.м', 'кв м', 'М2'], 'm2');
  same(['м³', 'm3', 'куб.м'], 'm3');
  same(['кПа', 'kPa', 'KPA'], 'kPa');
  same(['мм', 'mm'], 'mm');
  same(['см', 'cm'], 'cm');
  same(['°C', '°С', 'градус'], 'C');
  same(['хоног', 'days', 'day'], 'd');
  same(['хувь', '%', 'percent'], '%');
});

test('normalizeUnit: АЮУЛТАЙ холилт байхгүй — kPa ≠ Pa, мм ≠ м ≠ см, MJ ≠ MJ/m2', () => {
  assert.notEqual(normalizeUnit('kPa'), normalizeUnit('Pa'));
  assert.notEqual(normalizeUnit('кПа'), normalizeUnit('Па'));
  assert.notEqual(normalizeUnit('мм'), normalizeUnit('м'));
  assert.notEqual(normalizeUnit('см'), normalizeUnit('м'));
  assert.notEqual(normalizeUnit('MJ'), normalizeUnit('MJ/m2'));
  assert.notEqual(normalizeUnit('м2'), normalizeUnit('м3'));
  assert.equal(normalizeUnit('Pa'), 'Pa');
  assert.equal(normalizeUnit('MPa'), 'mpa', 'MPa нь kPa/Pa-тай нийлэхгүй (канонгүй ч тусдаа)');
});

/* ── §39 тооны уншилт (validator.numbersIn) ─────────────────────── */
test('numbersIn: «1,5» = 1.5 · «1 500»/«1,500» мянгат · зөв уншилт', () => {
  const n = (s) => V.numbersIn(s);
  assert.deepEqual(n('утга 1,5 м'), [1.5]);
  assert.deepEqual(n('утга 1 500 м²'), [1500]);
  assert.deepEqual(n('утга 1,500 м²'), [1500]);
  assert.deepEqual(n('g = 1 800 МДж/м²'), [1800]);
  assert.deepEqual(n('24 идэвхтэй төсөл, явц 62.4%'), [24, 62.4]);
});

test('validator маск: огноо, цаг, баримтын код, заалт, жагсаалтын дугаар ТОО гэж баригдахгүй (allowedNumbers=[] гэрээгээр)', () => {
  const c = { version: 'tfc-1', answerMode: 'grounded', risk: 'medium', facts: [], allowedNumbers: [], allowedCategories: null, requiredSentence: null, trailerText: null, requiredCitations: [], noMatch: false, forbiddenPhrases: [], template: null, taskIndex: null, legacyKind: 'free', reason: 't' };
  for (const s of ['2026-09-11-ний тайлан бэлэн.', '10:30 цагт хурал.', 'БД 21-101-12-ын дагуу.', '4.2.1 заалтад заасан.', 'Заалт 4.20-д бий.', '1) Ангилал\n2) Муж']) {
    const v = V.validateAnswer(s, c);
    assert.ok(!v.violations.some((x) => x.code === 'UNSUPPORTED_NUMBER'), `${s} → ${v.violations.map((x) => x.code).join(',')}`);
  }
  const bad = V.validateAnswer('Нийт 250 даалгавар байна.', c);
  assert.ok(bad.violations.some((x) => x.code === 'UNSUPPORTED_NUMBER'), 'жинхэнэ тоо баригдсангүй');
});

test('numbersIn: «1,500» ба «1,5» ялгагдана — 3 орон = мянгат, 1–2 орон = бутархай', () => {
  assert.deepEqual(V.numbersIn('1,500'), [1500]);
  assert.deepEqual(V.numbersIn('1,50'), [1.5]);
  assert.deepEqual(V.numbersIn('1,5'), [1.5]);
});

/* ── §37 нормын хэмжигдэхүүний fuzz — ХЭМЖИНЭ, A-д хандивлана ─────── */
const G_VARIANTS = [
  ['g=1800 MJ/m2', 1800],
  ['g = 1800 МДж/м²', 1800],
  ['1800 МДж/м² бол?', 1800],
  ['2200MJ/m2', 2200],
  ['2 200 мдж/м2', 2200],
  ['2 200 мджм2', 2200],
  ['g=2200', 2200],
  ['g ni 2200', 2200],
  ['g нь 2200', 2200],
  ['хувийн галын ачаалал 1 401 МДж/м²', 1401],
  ['g = 1.800 MJ/m2', 1800],
  ['g=1800,5 MJ/m2', 1800.5],
];
let gFails = [];
for (const [q, expected] of G_VARIANTS) {
  test(`g-хувилбар: «${q}» → ${expected}`, { todo: 'normEntities.ts — Session A-ийн хүрээ; унасныг хандивлана' }, () => {
    const e = extractNormEntities(q);
    if (e.gMjM2 !== expected) {
      gFails.push(`«${q}» → ${e.gMjM2}`);
      throw new Error(`g=${e.gMjM2} ≠ ${expected}`);
    }
  });
}
test('g-fuzz дүн (A-д хандивлах жагсаалт)', () => {
  console.log(`\n  g-хувилбар унасан ${gFails.length}/${G_VARIANTS.length}: ${gFails.join(' · ') || '—'}\n`);
});

test('нормын тэмдэглэгээний fuzz: бүх g-хувилбар NORMATIVE санаа авна (C-ийн хүрээ)', () => {
  for (const [q] of G_VARIANTS) {
    assert.equal(classifyIntent(q).intent, 'NORMATIVE', q);
  }
});

/* ── §10 хэлний чиглүүлэлт ───────────────────────────────────────── */
test('латин монгол → mn-Latn/mixed, хариулт mn-Cyrl', () => {
  for (const q of ['ene project hezee duusah ve', 'g 1800 bol ali angilal ve', 'revit deer ene wall iin area hed ve', 'manai company d heden project yavj bna', 'chi yu hiij chadah ve', 'sain bna uu']) {
    const d = detectLanguage(q);
    assert.ok(d.language === 'mn-Latn' || d.language === 'mixed', `${q} → ${d.language}`);
    assert.equal(d.responseLanguage, 'mn-Cyrl', q);
  }
});

test('англи өгүүлбэр → en (латин тэмдэг үгийн ХУУРАМЧ таарал байхгүй: end, bid, deer)', () => {
  for (const q of ['How many projects end this month?', 'We need to submit a bid for the school project', 'What is the deadline for this project?', 'Compare project A and project B', 'Why is this project behind schedule?']) {
    const d = detectLanguage(q);
    assert.equal(d.language, 'en', `${q} → ${d.language}`);
    assert.equal(d.responseLanguage, 'en', q);
  }
});

test('кирилл + англи нэр томьёо → mixed, хариулт mn-Cyrl', () => {
  const d = detectLanguage('Revit дээр сонгосон wall-ын area хэд вэ?');
  assert.equal(d.language, 'mixed');
  assert.equal(d.responseLanguage, 'mn-Cyrl');
});

test('ил хүсэлт бүхнээс дээгүүр: «монголоор хариул» латин/англи бичвэрт ч mn-Cyrl; «in English» кириллд ч en', () => {
  assert.equal(detectLanguage('please answer in mongolian: what is the deadline').responseLanguage, 'mn-Cyrl');
  assert.equal(detectLanguage('mongoloor hariulaarai, what can you do').responseLanguage, 'mn-Cyrl');
  assert.equal(detectLanguage('Төслийн явцыг англиар хариулаарай').responseLanguage, 'en');
  assert.equal(detectLanguage('Хэдэн төсөл байна? Answer in English.').responseLanguage, 'en');
});

test('normalizeLatinMongolian: нэр томьёо хөрвөхгүй, танигдсан үг кирилл', () => {
  const n = normalizeLatinMongolian('manai tusul revit deer wall');
  assert.ok(n.includes('манай') && n.includes('төсөл'));
  assert.ok(n.includes('revit') && n.includes('wall'));
});

/* ── §37 fuzz: зай/цэг таслал/том жижиг — ангилал тогтвортой ────── */
test('fuzz: том/жижиг үсэг, зай, цэг таслал ангилалыг өөрчлөхгүй', () => {
  const base = classifyIntent('Хэдэн ажилтан байна?').intent;
  for (const v of ['ХЭДЭН АЖИЛТАН БАЙНА?', 'хэдэн   ажилтан    байна', 'Хэдэн ажилтан байна!!!', '  Хэдэн ажилтан байна ?  ', 'Хэдэн ажилтан байна...']) {
    assert.equal(classifyIntent(v).intent, base, v);
  }
  const norm = classifyIntent('БНбД 21-101-12 хүснэгт 4').intent;
  for (const v of ['бнбд 21-101-12 ХҮСНЭГТ 4', 'БНбД  21-101-12   хүснэгт   4', 'bnbd 21-101-12 table 4']) {
    assert.equal(classifyIntent(v).intent, norm, v);
  }
});

test('fuzz: маш богино / маш урт асуулт унагахгүй', () => {
  assert.ok(classifyIntent('?').intent);
  assert.ok(classifyIntent('а').intent);
  const long = 'Манай компанийн төслүүдийн явц '.repeat(200);
  assert.ok(classifyIntent(long).intent);
  assert.ok(detectLanguage(long).language);
});
