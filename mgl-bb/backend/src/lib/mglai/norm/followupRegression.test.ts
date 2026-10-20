/**
 * MGL AI · ОЛОН ЭЭЛЖИЙН НОРМЫН РЕГРЕСС — 2026-09-18-нд прод дээр ХЭМЖСЭН гажгууд.
 *
 * Run with:  node --test src/lib/mglai/norm/followupRegression.test.ts
 *
 * Хэрэглэгчийн бодит тест (11 асуулт, прод, адаптер 0.4) дараах гажгуудыг илрүүлсэн; энэ файл тэднийг
 * дахин гарахаас хамгаална:
 *   1. «g=2500 → В1» гэсний дараа «H=8 м үед хэсгүүдийн зай?» → дахин «В1» (өвлөсөн g зайн асуултыг булаав)
 *   2. «S=20 м² бол g хэд вэ?» (Q алга) → өвлөсөн g-ээр В1 (дутууг дутуу гэж хэлээгүй)
 *   3. Q/S-ээс g=900 тооцсон ч төлөвт хуучин g=2500 үлдэж, дараагийн «ямар ангилал?» В1
 *   4. «УББ 12-01-01-ийн 9.7?» → «В2-ийн муж?» — өвлөсөн УББ код хөдөлгүүрийг цоожилж, муж лавлагаа асахгүй
 *   5. «В2-ийн» (залгавартай) ангилал гэж танигдахгүй
 *   6. «…600 мянган нэгж бол ГУАТ уу?» → «Архивт 200 мянган нэгж бол?» GENERAL_HELP/NEW_TOPIC болов
 *   7. «Архивт … ГУАТ уу, ГМДХ уу?» «баримт» үгээр DOCUMENT_ANALYSIS болов
 *   8. Runtime-ийн `decisions` (GUAT/GMDH) Worker-т уншигддаггүй → хоосон/трейлер л хариулт
 *   9. `clause_not_in_named_document` атлаа ойролцоо заалтуудаар grounded хариулт
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

const { runNormEngine } = await import('./engine');
const { normEngineForTurn, normTurnStateFrom } = await import('./turnEngine');
const { extractEngineeringEntities } = await import('./entities');
const { normRegistry } = await import('./registry');
const { emptyConvState } = await import('../convState');
const { interpretTurn } = await import('../turn');
const { classifyIntent } = await import('../intent');
const { parseLocalNorm, localNormTemplate } = await import('../localNorm');

const reg = normRegistry();
const BD = 'БД 21-101-12';
const run = (q: string, prior?: Record<string, unknown> | null) =>
  runNormEngine({ question: q, entities: extractEngineeringEntities(q), registry: reg, lang: 'mn-Cyrl', prior: (prior ?? null) as never });

/* 1 */
test('өвлөсөн g=2500 байхад «H=8 м үед хэсгүүдийн зай?» → зай 18 м, В1 БИШ', () => {
  const prior = extractEngineeringEntities('Хувийн галын ачаалал 2500 МДж/м² бол В ангиллын аль дэд ангилал вэ?');
  const r = run('H=8 м үед хялбар авалцан асах шингэний галын ачааллын хэсгүүдийн хамгийн бага зай хэд вэ?', prior as never);
  assert.ok(r);
  assert.equal(r.answerKind, 'calculation');
  assert.equal(r.value, 18);
  assert.equal(r.unit, 'm');
  assert.equal(r.initialCategory ?? null, null);
});

/* 2 */
test('өвлөсөн g байхад «талбай S=20 м² бол g хэд вэ?» (Q алга) → Q дутуу, ангилал БИШ', () => {
  const prior = extractEngineeringEntities('g = 2500 МДж/м²');
  const r = run('талбай S=20 м² бол хувийн галын ачаалал хэд вэ?', prior as never);
  assert.ok(r);
  assert.equal(r.answerKind, 'insufficient_context');
  assert.deepEqual(r.missingInputs, ['Q_MJ']);
  assert.match(r.textMn, /Q/);
  assert.equal(r.initialCategory ?? null, null);
});

test('«Хувийн галын ачаалал g = 100 МДж/м² бол?» — g өгөгдсөн бол ангилал хэвээр (В4)', () => {
  const r = run('Хувийн галын ачаалал g = 100 МДж/м² бол?', extractEngineeringEntities('g = 1800 МДж/м²') as never);
  assert.equal(r?.initialCategory, 'В4');
});

/* 3 */
test('Q/S-ээс тооцсон g нь төлөвийн g болно; дараагийн «ямар ангилал вэ?» шинэ g-ээр (В3)', () => {
  const st0 = normTurnStateFrom(extractEngineeringEntities('g = 2500 МДж/м²'), run('g = 2500 МДж/м² бол?'), null, 0);
  assert.equal(st0?.inputs.gMjM2, 2500);
  const q = 'Галын ачаалал Q=18000 МДж, талбай S=20 м² бол хувийн галын ачаалал хэд вэ?';
  const e = extractEngineeringEntities(q);
  const r = run(q, { ...(st0!.inputs as object) } as never);
  assert.equal(r?.value, 900);
  const st1 = normTurnStateFrom(e, r, st0, 2);
  assert.equal(st1?.inputs.gMjM2, 900, 'хуучин 2500 солигдсон байх ёстой');
  const r2 = run('тэгвэл ямар ангилал вэ?', { ...(st1!.inputs as object) } as never);
  assert.equal(r2?.initialCategory, 'В3');
});

/* 4 + 5 */
test('«В2-ийн галын ачааллын муж хэд вэ?» — залгавартай ангилал танигдаж муж лавлагаа (1401–2200)', () => {
  const e = extractEngineeringEntities('Тэгвэл В2-ийн галын ачааллын муж хэд вэ?');
  assert.deepEqual(e.mentionedCategories, ['В2']);
  const r = run('Тэгвэл В2-ийн галын ачааллын муж хэд вэ?');
  assert.ok(r);
  assert.equal(r.initialCategory, 'В2');
  assert.match(r.textMn, /1401–2200/);
});

test('өвлөсөн баримт УББ 12-01-01 (бүртгэлд байхгүй) хөдөлгүүрийг цоожлохгүй — В2 муж лавлагаа асна', () => {
  const state = { ...emptyConvState(), norm: { inputs: {}, medium: [], equipmentVolumeUnknown: false, documentCode: 'УББ 12-01-01', lastKind: null, lastInitialCategory: null, lastFinalCategory: null, lastMissingInputs: [], setAtSeq: 6 } };
  const out = normEngineForTurn({ question: 'Тэгвэл В2-ийн галын ачааллын муж хэд вэ?', normTaskText: null, intent: 'NORMATIVE', turnKind: 'CONTINUATION', state: state as never, lang: 'mn-Cyrl', registry: reg });
  assert.ok(out.result, 'үр дүн байх ёстой');
  assert.equal(out.result.documentCode, BD);
  assert.equal(out.result.initialCategory, 'В2');
});

test('энэ ээлжид ИЛ нэрлэсэн бүртгэлд байхгүй баримт хэвээр цоожтой (P0-3)', () => {
  const out = normEngineForTurn({ question: 'УББ 12-01-01-ийн дагуу g=1800 бол?', normTaskText: null, intent: 'NORMATIVE', turnKind: 'NEW_TOPIC', state: emptyConvState() as never, lang: 'mn-Cyrl', registry: reg });
  assert.equal(out.result, null);
  assert.equal(out.namedOutsideRegistry, 'УББ 12-01-01');
});

/* 6 + 7 */
test('«Архивт 600 мянган нэгж баримт … ГУАТ уу, ГМДХ уу?» → NORMATIVE (DOCUMENT_ANALYSIS биш)', () => {
  assert.equal(classifyIntent('Архивт 600 мянган нэгж баримт хадгалдаг бол ГУАТ уу, ГМДХ уу?').intent, 'NORMATIVE');
  assert.equal(classifyIntent('Хатаалгын өрөөнд гал унтраах автомат төхөөрөмж хэрэгтэй юу?').intent, 'NORMATIVE');
});

test('нормын ээлжийн шууд дараах «Архивт 200 мянган нэгж бол?» → FOLLOW_UP NORMATIVE', () => {
  const state = { ...emptyConvState(), lastIntent: 'NORMATIVE' as const, lastSeq: 2, lastQuestion: 'Архивт 600 мянган нэгж баримт хадгалдаг бол ГУАТ уу, ГМДХ уу?' };
  const t = interpretTurn({ question: 'Архивт 200 мянган нэгж бол?', state: state as never, seq: 4, lastAssistant: 'ГУАТ шаардлагатай.' });
  assert.equal(t.kind, 'FOLLOW_UP');
  assert.equal(t.intent, 'NORMATIVE');
  // ERP асуулт, мэндчилгээ энэ дүрэмд ОРОХГҮЙ
  assert.notEqual(interpretTurn({ question: 'Хэдэн төсөл байна?', state: state as never, seq: 4, lastAssistant: 'x' }).intent, 'NORMATIVE');
  assert.equal(interpretTurn({ question: 'Баярлалаа', state: state as never, seq: 4, lastAssistant: 'x' }).intent, 'CASUAL');
  // хуучирсан (зэргэлдээ биш) ээлж → ердийн зам
  assert.notEqual(interpretTurn({ question: 'Архивт 200 мянган нэгж бол?', state: state as never, seq: 8, lastAssistant: 'x' }).kind, 'FOLLOW_UP');
});

/* 8 */
test('runtime decisions (GUAT/GMDH) → детерминист өгүүлбэр; uncertain → «шууд заалт олдсонгүй, хамгийн ойр…»', () => {
  const a = parseLocalNorm({
    status: 'verified',
    rule_id: 'BNBD-21-04-05-ADD-2018-01-18-10:T4:R2',
    rule_object_mn: 'Хатаалгын өрөө',
    decisions: { GUAT: true, GMDH: false, injected_key_that_is_too_long_for_whitelist_xx: true },
    citation: { document: 'БНбД 21-04-05', table: 4, page: 11, effective_status: 'unknown_requires_legal_verification' },
    evidence: [{ chunk_id: 'BNBD-21-04-05-ADD-2018-01-18-10:T4:R2', code: 'БНбД 21-04-05', text_mn: 'Хатаалгын өрөө. ГУАТ: Төрлөөс хамаарахгүй', page: 11, kind: 'table_rule' }],
  });
  assert.ok(a);
  assert.deepEqual(a!.decisions, { GUAT: true, GMDH: false });
  const t = localNormTemplate(a!, 'mn-Cyrl')!;
  assert.match(t, /^Хатаалгын өрөө: гал унтраах автомат төхөөрөмж \(ГУАТ\) — шаардлагатай; галын дохиоллын хэрэгсэл \(ГМДХ\) — шаардлагагүй \(БНбД 21-04-05, Хүснэгт 4, х\.11\)/);
  assert.doesNotMatch(t, /NEEDS_HUMAN_REVIEW|CURRENT_BUT/);

  const u = parseLocalNorm({
    status: 'uncertain',
    rule_id: 'BNBD-21-04-05-ADD-2018-01-18-10:T1:R6.3',
    rule_object_mn: '28 м-ээс дээш өндөртэй орон сууц',
    decisions: { GUAT: false, GMDH: null },
    missing_context: ['height_m', 'rack_height_m'],
    citation: { document: 'БНбД 21-04-05', table: 1, page: 5 },
    evidence: [{ chunk_id: 'x', code: 'БНбД 21-04-05', text_mn: '28 м-ээс дээш өндөртэй орон сууц. ГМДХ: 28 м-ээс дээш', page: 5, kind: 'table_rule' }],
  });
  const tu = localNormTemplate(u!, 'mn-Cyrl')!;
  assert.match(tu, /^Санд энэ асуултад шууд хариулах баталгаажсан заалт олдсонгүй\. Хамгийн ойр: «28 м-ээс дээш/);
  assert.match(tu, /барилгын өндөр \(м\), тавиурын өндөр \(м\)/);
  assert.doesNotMatch(tu, /height_m/);
});

/* 10 — утга асуусан асуулт ба тоон заалт / тоогүй заалт */
test('«… хэдэн люкс вэ?» — uncertain тоон дүрэм атлаа заалт нь давхцаж, тоотой → заалт өөрөө хариулт', () => {
  const a = parseLocalNorm({
    status: 'uncertain',
    rule_id: 'BNBD-31-24-22-2022:6.2.3:main_entrance_lux:115',
    rule_object_mn: 'main entrance: main_entrance_lux — 100 лк',
    decisions: { main_entrance_lux: null },
    missing_context: ['lux'],
    citation: { document: 'БНбД 31-24-22', clause: '6.2.3', page: null },
    evidence: [{ chunk_id: 'BNBD-31-24-22-2022:clause:6.2.3', code: 'БНбД 31-24-22', clause_no: '6.2.3', text_mn: 'Гол үүдний зохиомол гэрэлтүүлэг 100 люкс, бусад орц 20 люкс байна.', page: null, kind: 'clause' }],
  })!;
  const t = localNormTemplate(a, 'mn-Cyrl', 'Цэцэрлэгийн гол үүдний зохиомол гэрэлтүүлэг хэдэн люкс вэ?');
  assert.equal(t, 'Гол үүдний зохиомол гэрэлтүүлэг 100 люкс, бусад орц 20 люкс байна. (БНбД 31-24-22, заалт 6.2.3).');
  // «хэдээр» хэлбэр ч утгын асуулт
  const b = parseLocalNorm({ status: 'uncertain', missing_context: ['thermal_indoor_temperature'], citation: { document: 'БНбД 31-23-12', clause: '9.5' }, evidence: [{ chunk_id: 'x', code: 'БНбД 31-23-12', clause_no: '9.5', text_mn: 'Хашлага бүтээцийн дулаан техникийн тооцоонд дотор агаарын температурыг 18°C гэж авна.', kind: 'clause' }] })!;
  assert.match(localNormTemplate(b, 'mn-Cyrl', 'Хашлага бүтээцийн дулаан техникийн тооцоонд дотор агаарын температурыг хэдээр авах вэ?')!, /^Хашлага бүтээцийн .* 18°C гэж авна\. \(БНбД 31-23-12, заалт 9\.5\)\.$/);
  // Давхцалгүй (гишгүүр ↔ орон сууцны өндөр) → «олдсонгүй, хамгийн ойр»
  const c2 = parseLocalNorm({ status: 'uncertain', missing_context: ['height_m'], citation: { document: 'БНбД 21-04-05', table: 1, page: 5 }, evidence: [{ chunk_id: 'y', code: 'БНбД 21-04-05', text_mn: '28 м-ээс дээш өндөртэй орон сууц. ГМДХ: 28 м-ээс дээш', page: 5, kind: 'table_rule' }] })!;
  assert.match(localNormTemplate(c2, 'mn-Cyrl', 'Гишгүүрийн өндөр хэд байх ёстой вэ?')!, /^Санд энэ асуултад шууд хариулах баталгаажсан заалт олдсонгүй/);
});

test('«… хэдэн лк байх ёстой вэ?» — supported атлаа заалтууд ТООГҮЙ → «тоон шаардлага олдсонгүй», детерминист', async () => {
  const { localNormDeterministic } = await import('../localNorm');
  const a = parseLocalNorm({ status: 'supported', citation: { document: 'УББ 12-204-01', clause: '4.5', page: 9 }, evidence: [{ chunk_id: 'z', code: 'УББ 12-204-01', clause_no: '4.5', text_mn: 'Ажилчдаас үйлдвэрлэл, техник, технологи, хөдөлмөрийн сахилгыг сахих, ажлын байрны нөхцөл, стандартыг сайжруулах асуудлаар санал гаргах.', page: 9, kind: 'clause' }] })!;
  const q = 'Ажлын байрны гэрэлтүүлэг хэдэн лк байх ёстой вэ?';
  assert.equal(localNormDeterministic(a, q), true);
  assert.match(localNormTemplate(a, 'mn-Cyrl', q)!, /^Санд энэ асуултын тоон шаардлагыг заасан заалт олдсонгүй\. Хамгийн ойр заалт:/);
  // Утга асуугаагүй supported — заалтын текст (2026-09-18-аас БҮХ локал нормын хариулт детерминист).
  //    2026-09-23-аас асуултын хэлбэрийн эхний өгүүлбэр + заалт бүтнээрээ + эх сурвалж нэг удаа (`localNormFrame.ts`).
  assert.equal(localNormDeterministic(a, 'Даамал ямар эрхтэй вэ?'), true);
  const rights = localNormTemplate(a, 'mn-Cyrl', 'Даамал ямар эрхтэй вэ?')!;
  assert.match(rights, /^Эх сурвалжид энэ талаар ингэж заасан байна:\nАжилчдаас үйлдвэрлэл/);
  assert.match(rights, /Эх сурвалж: УББ 12-204-01, х\.9\.$/);
});

/* 11 — нормын төлөв ӨӨР сэдвийн нормын асуултыг булаахгүй (эзний 2-р тест, 2026-09-18) */
test('g=900 төлөвтэй байхад «Хатаалгын өрөөнд ГУАТ хэрэгтэй юу?» / «Архивт 600 мянган нэгж бол ГУАТ уу?» → хөдөлгүүр асахгүй', () => {
  const state = { ...emptyConvState(), lastIntent: 'NORMATIVE' as const, lastSeq: 4, norm: { inputs: { gMjM2: 900, qMj: 18000, sM2: 20 }, medium: [], equipmentVolumeUnknown: false, documentCode: BD, lastKind: 'classification', lastInitialCategory: 'В3', lastFinalCategory: null, lastMissingInputs: ['H'], setAtSeq: 4 } };
  for (const q of ['Хатаалгын өрөөнд гал унтраах автомат төхөөрөмж хэрэгтэй юу?', 'Архивт 600 мянган нэгж баримт хадгалдаг бол ГУАТ уу, ГМДХ уу?', 'Архивт 200 мянган нэгж бол?', 'Даамал ямар тохиолдолд хариуцлага хүлээх вэ?']) {
    const out = normEngineForTurn({ question: q, normTaskText: null, intent: 'NORMATIVE', turnKind: 'CONTINUATION', state: state as never, lang: 'mn-Cyrl', registry: reg });
    assert.equal(out.result, null, q);
  }
  // Нүцгэн үргэлжлэл ХЭВЭЭР ажиллана
  const fu = normEngineForTurn({ question: 'тэгвэл ямар ангилал вэ?', normTaskText: null, intent: 'NORMATIVE', turnKind: 'FOLLOW_UP', state: state as never, lang: 'mn-Cyrl', registry: reg });
  assert.equal(fu.result?.initialCategory, 'В3');
  const h = normEngineForTurn({ question: 'H=6 м бол?', normTaskText: null, intent: 'NORMATIVE', turnKind: 'FOLLOW_UP', state: state as never, lang: 'mn-Cyrl', registry: reg });
  assert.ok(h.result, 'H өгвөл 4.20 шалгалт');
  // «В2-ийн муж» — өвлөсөн g=900-аар В3 гэхгүй, В2-ийн муж
  const v2 = normEngineForTurn({ question: 'Тэгвэл В2-ийн галын ачааллын муж хэд вэ?', normTaskText: null, intent: 'NORMATIVE', turnKind: 'CONTINUATION', state: state as never, lang: 'mn-Cyrl', registry: reg });
  assert.equal(v2.result?.initialCategory, 'В2');
  assert.match(v2.result?.textMn ?? '', /1401–2200/);
});
