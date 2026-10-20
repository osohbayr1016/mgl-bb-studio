/**
 * MGL AI · ХҮНИЙ ЯРИАНЫ ХЭЛБЭРТЭЙ АСУУЛТУУД — эзний HL01–HL10 (2026-09-23, прод, адаптер 0.4: 0/10).
 *
 * Run with:  node --test src/lib/mglai/humanizedTurns.test.ts
 *
 * Хэмжсэн шалтгаан бүрийг нэг тестээр цоожилно:
 *   · маршрут: латин асуултын кирилл түлхүүр үг (фолд), «би захиалагч … үүрэг», «солонгос компани … зураг»,
 *     «хэдэн цаг … ёстой», «чи яг юу хийж чаддаг»;
 *   · ярианы санамж: урт «яагаад …» дагалдах асуулт, ижил салбарын ШИНЭ асуулт өмнөх баримтад цоожлогдохгүй;
 *   · хариултын хүрээ: «Тийм — …эрх», «шалтгааныг тайлбарлаагүй», «жагсаалтад бүртгэлтэй», «1 жилээр дутуу»,
 *     дотоод түлхүүр (`facility_volume_m3`) дэлгэцэнд гарахгүй.
 * Бодит асуулт, эх сурвалжийн текст: `ai/training/humanized_review/cases-2026-09-23.json`.
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

const { classifyIntent, isNormativeQuestion } = await import('./intent');
const { interpretTurn, refersBack } = await import('./turn');
const { emptyConvState } = await import('./convState');
const { normEngineForTurn } = await import('./norm/turnEngine');
const { normRegistry } = await import('./norm/registry');
const { askForm, actionPrefix, yearsGap, asksApplicability } = await import('./localNormFrame');
const { parseLocalNorm, composeLocalNorm } = await import('./localNorm');
const { missingDiscoverySubject, discoverySubjectAbsentText, isDocumentDiscoveryQuestion } = await import('./normDocuments');

/* ── 1. Маршрут ───────────────────────────────────────────────────── */

test('HL маршрут: латин ба кирилл хоёулаа зөв салбарт', () => {
  const cases: Array<[string, string]> = [
    ['chi yg yu hiij chaddag yum be', 'META'],
    ['ugluunees hoish neg ch zov hariult avsangui. chi yg yu hiij chaddag yum be', 'META'],
    ['tsetserlegiin togloomiin talbai deer nar heden tsag tusah yostoi ve? yagaad tiim chuhal yum', 'NORMATIVE'],
    ['Цэцэрлэгийн тоглоомын талбай дээр нар хэдэн цаг тусах ёстой вэ?', 'NORMATIVE'],
    ['solongos kompani manai tosliin zurgiig hiij boloh uu? tegvel yu anhaarah heregtei ve', 'NORMATIVE'],
    ['Солонгос компани манай төслийн зургийг хийж болох уу?', 'NORMATIVE'],
    ['bi zahialagch, udahgui barilga barih gej bna. minii hamgiin gol uureg yu ve? udaan bish gol gol-iig ni helj ogooch', 'NORMATIVE'],
    ['Би захиалагч. Миний гол үүрэг юу вэ?', 'NORMATIVE'],
    ['daamal barilgiin ajliig zogsooj chadah uu? yamar ued zogsooj bolohiig engiin ugeer tailbarlaad ogooch', 'NORMATIVE'],
  ];
  for (const [q, want] of cases) assert.equal(classifyIntent(q).intent, want, q);
});

test('HL маршрут: ERP ба ерөнхий асуулт норм руу ХАЛИХГҮЙ', () => {
  const cases: Array<[string, string]> = [
    ['Манай цэцэрлэгийн төсөл хэзээ дуусах ёстой вэ?', 'COMPANY_FACT'],
    ['Энэ төслийн захиалагч хэн бэ?', 'COMPANY_FACT'],
    ['manai kompani heden ajiltantai ve', 'COMPANY_FACT'],
    ['Солонгос компанитай хийсэн төслийн явц хэд вэ?', 'COMPANY_FACT'],
    ['heden tusul idevhtei bna', 'COMPANY_FACT'],
    ['sain bna uu', 'CASUAL'],
  ];
  for (const [q, want] of cases) assert.equal(classifyIntent(q).intent, want, q);
  // «өрөө», «анги», «шат» угтвараар норм болгохгүй («орох», «ангилал», «шатлал»).
  assert.equal(isNormativeQuestion('Оролтын өгөгдлөө хаана оруулах ёстой вэ?'), false);
  assert.equal(isNormativeQuestion('Шатлалаар ангилал хийх ёстой юу?'), false);
});

/* ── 2. Ярианы санамж ─────────────────────────────────────────────── */

test('HL02: урт «yagaad …» асуулт нормын ээлжийн дараа FOLLOW_UP NORMATIVE', () => {
  const state = { ...emptyConvState(), lastIntent: 'NORMATIVE' as const, lastSeq: 0, lastQuestion: 'daamal ajliig zogsooj chadah uu' };
  const t = interpretTurn({ question: 'yagaad zaaval 2 udaa sanal tavisan baih yostoi gej? neg udaa helehed bolohgui yum uu', state, seq: 2, lastAssistant: null });
  assert.equal(t.kind, 'FOLLOW_UP');
  assert.equal(t.intent, 'NORMATIVE');
});

test('HL08: ижил салбарын ШИНЭ асуулт өмнөх баримтад цоожлогдохгүй; «энэ …» асуулт цоожлогдоно', () => {
  const norm = { inputs: {}, medium: [], equipmentVolumeUnknown: false, documentCode: 'СНиП II-97-76', lastKind: null, lastInitialCategory: null, lastFinalCategory: null, lastMissingInputs: [], setAtSeq: 12, lastClause: null };
  const state = { ...emptyConvState(), lastIntent: 'NORMATIVE' as const, lastSeq: 12, norm };
  const fresh = normEngineForTurn({ question: 'avto ugaalgiin gazar barih gej bna. barilgad ni ymar norm shaardlaga bdag ve', normTaskText: null, intent: 'NORMATIVE', turnKind: 'CONTINUATION', state: state as never, lang: 'mn-Cyrl', registry: normRegistry() });
  assert.doesNotMatch(fresh.normQuery, /СНиП/);
  const back = normEngineForTurn({ question: 'Энэ нормын 3.11 заалт юу вэ?', normTaskText: null, intent: 'NORMATIVE', turnKind: 'CONTINUATION', state: state as never, lang: 'mn-Cyrl', registry: normRegistry() });
  assert.match(back.normQuery, /^СНиП II-97-76/);
  const why = normEngineForTurn({ question: 'yagaad zaaval 2 udaa sanal tavisan baih yostoi gej?', normTaskText: null, intent: 'NORMATIVE', turnKind: 'FOLLOW_UP', state: { ...state, norm: { ...norm, documentCode: 'УББ 12-204-01' } } as never, lang: 'mn-Cyrl', registry: normRegistry() });
  assert.match(why.normQuery, /^УББ 12-204-01: yagaad/);
  assert.equal(refersBack('avto ugaalgiin gazar barih gej bna'), false);
  assert.equal(refersBack('energi hemnelttei barilga'), false, '«ene» дэд мөрөөр таарахгүй');
});

test('HL05/HL06 (прод дахин шалгалт): урт асуулт доторх «tegvel», «tailbarlaach» өмнөх баримтад ЦООЖЛОХГҮЙ', () => {
  const norm = { inputs: {}, medium: [], equipmentVolumeUnknown: false, documentCode: 'УББ 12-204-01', lastKind: null, lastInitialCategory: null, lastFinalCategory: null, lastMissingInputs: [], setAtSeq: 6, lastClause: null };
  const state = { ...emptyConvState(), lastIntent: 'NORMATIVE' as const, lastSeq: 6, norm };
  const run = (question: string) => normEngineForTurn({ question, normTaskText: null, intent: 'NORMATIVE', turnKind: 'CONTINUATION', state: state as never, lang: 'mn-Cyrl', registry: normRegistry() });
  // Өмнө нь хоёулаа «УББ 12-204-01: …» болж даамлын эрхээр хариулагдав; цоожгүйгээр БНбД 11-03-02 / 21-04-05 олддог.
  assert.doesNotMatch(run('solongos kompani manai tosliin zurgiig hiij boloh uu? tegvel yu anhaarah heregtei ve').normQuery, /УББ 12-204-01/);
  assert.doesNotMatch(run('GUAT bolon GMDH hoyriin yalgaa yu ve? shine orson hund oilgomjtoi tailbarlaach').normQuery, /УББ 12-204-01/);
  // Богино эсвэл эхэндээ холбогчтой асуулт ХЭВЭЭР цоожлогдоно.
  assert.match(run('Энэ нь хэнд хамаарах вэ?').normQuery, /^УББ 12-204-01/);
  assert.match(run('tegvel yu anhaarah heregtei ve').normQuery, /^УББ 12-204-01/);
  assert.equal(refersBack('Үүнд ямар шаардлага тавьдаг вэ?'), true);
  assert.equal(refersBack('solongos kompani manai tosliin zurgiig hiij boloh uu? tegvel yu anhaarah heregtei ve'), false);
});

test('HL08 (прод дахин шалгалт): олох асуултын сэдэв нотолгоонд алга → «санд алга», сэдэвтэй/сэдэвгүй асуулт хөндөгдөхгүй', () => {
  const q = 'avto ugaalgiin gazar barih gej bna. barilgad ni ymar norm shaardlaga bdag ve';
  assert.equal(isDocumentDiscoveryQuestion(q), true);
  // Прод дээр ирсэн нотолгоо: БНбД 31-17-10-ийн 6.1 (инженер-геологи) — «барилга, барих, газар, шаардлага»-аар л таарсан.
  const geo = 'Инженер-геологийн хайгуул судалгааны үр дүн нь … барилга барих болон ашиглалтын явцад, суурийн төрөл …';
  assert.deepEqual(missingDiscoverySubject(q, [geo]), ['avto', 'ugalgin']);
  // Кирилл хувилбар: цэцэрлэгийн «угаалга» (угаалгын өрөө) олдсон ч «авто» алга → мөн санд алга.
  assert.deepEqual(missingDiscoverySubject('Авто угаалгын газар барих гэж байна. Барилгад нь ямар норм шаардлага байдаг вэ', [geo, 'Хоол, агуулах, угаалга, индүүдлэг, техникийн өрөөг']), ['avto']);
  assert.equal(missingDiscoverySubject('Шатны хашлагад ямар норм шаардлага байдаг вэ', ['Шатны хашлагын өндөр 0.9 м-ээс багагүй']), null);
  assert.equal(missingDiscoverySubject('Барилгад ямар норм шаардлага байдаг вэ', [geo]), null, 'сэдэвгүй асуулт — хуучин зам');
  const t = discoverySubjectAbsentText('mn-Cyrl');
  assert.ok(t.text.startsWith(t.sentence));
  assert.match(t.sentence, /олдсонгүй, тиймээс шаардлагыг зохиож хэлэхгүй/);
  assert.doesNotMatch(t.text, /avto|ugaal/i, 'латин асуултын үгийг кирилл хариултад давтахгүй');
});

/* ── 3. Асуултын хэлбэр ───────────────────────────────────────────── */

test('askForm: HL асуултууд зөв хэлбэрт', () => {
  assert.equal(askForm('daamal barilgiin ajliig zogsooj chadah uu?'), 'ability');
  assert.equal(askForm('yagaad zaaval 2 udaa sanal tavisan baih yostoi gej?'), 'why');
  assert.equal(askForm('bi zahialagch. minii hamgiin gol uureg yu ve?'), 'duties');
  assert.equal(askForm('bi 2 jil ajillasan engineer. daamal bolj chadah uu? yu dutuu bna'), 'requirement');
  assert.equal(askForm('GUAT bolon GMDH hoyriin yalgaa yu ve?'), 'concept');
  assert.equal(askForm('SNiP II-97-76 odoo ch hereglegdej bgaa yum uu? manai tosold ashiglaj boloh uu'), 'status');
  assert.equal(askForm('Даамал ямар эрхтэй вэ?'), 'duties');
  assert.equal(askForm('Даамлын үүрэг даалгавар заавал биелүүлэх үү?'), 'general');
  assert.equal(actionPrefix('daamal barilgiin ajliig zogsooj chadah uu'), 'zogs');
  assert.equal(actionPrefix('solongos kompani manai tosliin zurgiig hiij boloh uu'), 'zurg');
  assert.deepEqual(yearsGap('bi 2 jil barilga deer ajillasan', 'мэргэжлээрээ 3-аас доошгүй жил барилгын үйлдвэрлэл дээр ажилласан'), { have: 2, need: 3 });
  assert.equal(yearsGap('bi barilga deer ajillasan', '3-аас доошгүй жил'), null);
  assert.equal(asksApplicability('manai tosold ashiglaj boloh uu'), true);
  assert.equal(asksApplicability('odoo ch hereglegdej bgaa yum uu'), false);
});

/* ── 4. Хариултын хүрээ ───────────────────────────────────────────── */

const DAAMAL_TITLE = 'Барилгын талбайн даамлын үлгэрчилсэн дүрэм';
const ev = (clause: string, text: string, page = 9, code = 'УББ 12-204-01') => ({ chunk_id: `UBB-12-204-01-2002:clause:${clause}`, code, clause_no: clause, text_mn: text, page, kind: 'clause' });
const C43 = 'Захиалагчид сарын туршид 2-оос доошгүй удаа албан ёсоор санал тавихад шийдвэрлээгүй, хөдөлмөр хамгаалал, аюулгүй техник, зураг төсөл, техникийн нөхцөл, барилгын дүрэм, заавар, стандарт ноцтой зөрчигдөх нөхцөл байдал бий болсон үед үйлдвэрлэлийг зогсоох;';
const C44 = 'Батлагдсан зураг төсөл, техникийн нөхцөл, стандартын шаардлага хангаагүй ажлыг зогсоож, буруутай этгээдээр үнэ төлбөргүй богино хугацаанд засуулах;';
const C49 = 'Ажил олгогчтой байгуулсан хөдөлмөрийн гэрээнд тусгасан тохиолдолд барилгын даамал нь нэмэгдэл цалин, хөлс, шагнал урамшуулал авах;';

test('HL01: эрхийн асуулт → «Тийм — …», зөвхөн «зогсоох» заалтууд, эх сурвалж нэг удаа', () => {
  const a = parseLocalNorm({
    status: 'supported',
    rule_kind: 'right',
    citation: { document: 'УББ 12-204-01', clause: '4.4', page: 9, title_mn: DAAMAL_TITLE, effective_status: 'current_status_not_checked_for_later_amendments' },
    evidence: [ev('4.4', C44), ev('4.3', C43), ev('4.9', C49, 10)],
  })!;
  const c = composeLocalNorm(a, 'mn-Cyrl', 'daamal barilgiin ajliig zogsooj chadah uu? yamar ued zogsooj bolohiig engiin ugeer tailbarlaad ogooch')!;
  assert.match(c.text, /^Тийм — эх сурвалжид дараах тохиолдолд ийм эрх заасан байна:/);
  assert.match(c.text, /заалт 4\.4/);
  assert.match(c.text, /заалт 4\.3/);
  assert.doesNotMatch(c.text, /урамшуулал/, '4.9 (шагнал авах) нь «зогсоох» эрх биш');
  assert.match(c.text, /Эх сурвалж: УББ 12-204-01 «Барилгын талбайн даамлын үлгэрчилсэн дүрэм», х\.9\.$/);
  assert.doesNotMatch(c.text, /…/, 'заалт дундуураа тасрахгүй');
  assert.deepEqual(c.clauses, [], 'олон заалт харуулсан — дараагийн асуулт баримтад л цоожлогдоно');
});

test('HL02: «яагаад» дагалдах асуулт → шалтгаан тайлбарлаагүй + нөхцөл', () => {
  const a = parseLocalNorm({
    status: 'uncertain',
    rule_kind: 'threshold',
    missing_context: ['formal_proposals_in_month', 'client_unresolved'],
    citation: { document: 'УББ 12-204-01', clause: '4.3', page: 9, title_mn: DAAMAL_TITLE },
    evidence: [ev('4.3', C43)],
  })!;
  const c = composeLocalNorm(a, 'mn-Cyrl', 'yagaad zaaval 2 udaa sanal tavisan baih yostoi gej? neg udaa helehed bolohgui yum uu', { followUp: true })!;
  assert.match(c.text, /^Энэ заалт шалтгааныг нь тайлбарлаагүй — зөвхөн дараах нөхцөлийг тогтоосон:/);
  assert.match(c.text, /2-оос доошгүй удаа/);
  assert.doesNotMatch(c.text, /formal_proposals|client_unresolved/);
  assert.deepEqual(c.clauses, ['4.3']);
});

test('HL04: «болж чадах уу» + «2 жил» → жилийн дутууг ил хэлнэ', () => {
  const a = parseLocalNorm({
    status: 'uncertain',
    rule_kind: 'threshold',
    missing_context: ['professional_construction_experience_years', 'elapsed_years'],
    citation: { document: 'УББ 12-204-01', clause: '2.2.1', page: 5, title_mn: DAAMAL_TITLE },
    evidence: [ev('2.2.1', 'Бакалаврын боловсролтой, мэргэжлээрээ 3-аас доошгүй жил барилгын үйлдвэрлэл дээр ажилласан, инженерийн мэргэшсэн ба зөвлөх зэрэгтэй байх;', 5)],
  })!;
  // Бодит runtime (2026-09-23) 2.2.1-ийг `uncertain` (босгын оролт дутуу) гэж өгдөг — хэрэглэгч тоогоо ӨӨРӨӨ хэлсэн.
  const q = 'bi 2 jil barilga deer ajillasan engineer. daamal bolj chadah uu? yu dutuu bna';
  const c = composeLocalNorm(a, 'mn-Cyrl', q)!;
  assert.match(c.text, /^Одоохондоо үгүй — дүрэмд хамгийн багадаа 3 жил шаарддаг, таны 2 жил 1 жилээр дутуу байна \(заалт 2\.2\.1\)\./);
  assert.doesNotMatch(c.text, /professional_construction|elapsed_years/);
  // supported + олон заалт — шаардлагын жагсаалт үлдэнэ
  const s = parseLocalNorm({ status: 'supported', rule_kind: 'requirement', citation: { document: 'УББ 12-204-01', clause: '2.2.1', page: 5, title_mn: DAAMAL_TITLE }, evidence: [ev('2.2.1', 'Бакалаврын боловсролтой, мэргэжлээрээ 3-аас доошгүй жил барилгын үйлдвэрлэл дээр ажилласан, инженерийн мэргэшсэн ба зөвлөх зэрэгтэй байх;', 5), ev('2.2.2', 'Талбайн даамлын мэргэшүүлэх сургалт төгссөн гэрчилгээтэй байх;', 5)] })!;
  const cs = composeLocalNorm(s, 'mn-Cyrl', q)!;
  assert.match(cs.text, /1 жилээр дутуу/);
  assert.match(cs.text, /гэрчилгээтэй/);
});

test('HL07: хүчин төгөлдөр байдлын асуулт → жагсаалтад бүртгэлтэй + хамрах хүрээ + өөрийн төсөлд', () => {
  const a = parseLocalNorm({
    status: 'supported',
    rule_kind: 'requirement',
    citation: { document: 'СНиП II-97-76* / СНиП II-97-76 М-80', clause: null, page: null, title_mn: 'Хөдөө аж ахуйн үйлдвэрийн ерөнхий төлөвлөгөө', effective_status: 'listed_as_current' },
    evidence: [{ chunk_id: 'SNIP-II-97-76-MNG:status', code: 'СНиП II-97-76* / СНиП II-97-76 М-80', clause_no: null, text_mn: 'СНиП II-97-76* / СНиП II-97-76 М-80 нь Монголын хүчин төгөлдөр нормын албан жагсаалтын Цогцолбор 30, мөр 4-т бүртгэлтэй; шийдвэр нь УБХ-ны 1987 оны 107 дугаар тогтоол.', kind: 'status' }],
  })!;
  const c = composeLocalNorm(a, 'mn-Cyrl', 'SNiP II-97-76 gedeg huuchin orosiin norm odoo ch hereglegdej bgaa yum uu? manai tosold ashiglaj boloh uu')!;
  assert.match(c.text, /^Тийм — СНиП II-97-76\* \/ СНиП II-97-76 М-80 Монголд мөрдөгдөж буй нормын жагсаалтад бүртгэлтэй\./);
  assert.match(c.text, /Бүртгэл: .*1987 оны 107 дугаар тогтоол/);
  assert.match(c.text, /Хамрах хүрээ: энэ нь «Хөдөө аж ахуйн үйлдвэрийн ерөнхий төлөвлөгөө»-ийн норм\./);
  assert.match(c.text, /Таны төсөлд хэрэглэх эсэх нь төслийн төрлөөс хамаарна/);
  assert.match(c.text, /байтаар тулгаж баталгаажуулаагүй/);
});

test('HL06: «ялгаа юу вэ» → нэр томьёо, дотоод түлхүүр ГАРАХГҮЙ', () => {
  const a = parseLocalNorm({
    status: 'uncertain',
    rule_kind: 'table_row',
    missing_context: ['volume_m3', 'facility_volume_m3'],
    citation: { document: 'БНбД 21-04-05', table: 2, page: 6 },
    evidence: [{ chunk_id: 'x', code: 'БНбД 21-04-05', text_mn: 'Үйлдвэрийн болон олон нийтийн барилгын кабелийн байгууламж. ГУАТ: 100 м³-ээс их. ГМДХ: 100 м³ ба түүнээс бага', page: 6, kind: 'table_rule' }],
  })!;
  const c = composeLocalNorm(a, 'mn-Cyrl', 'GUAT bolon GMDH hoyriin yalgaa yu ve? shine orson hund oilgomjtoi tailbarlaach')!;
  assert.match(c.text, /ГУАТ — гал унтраах автомат төхөөрөмж/);
  assert.match(c.text, /ГМДХ — галын дохиоллын хэрэгсэл/);
  assert.doesNotMatch(c.text, /_m3|кабелийн/);
  // Нэргүй түлхүүр «олдсонгүй» замд ч ГАРАХГҮЙ.
  const u = composeLocalNorm(a, 'mn-Cyrl', 'Кабелийн байгууламжид юу хэрэгтэй вэ?')!;
  assert.doesNotMatch(u.text, /facility_volume_m3/);
});

test('HL10: утга + «яагаад» → заалтын утга, шалтгааныг тайлбарлаагүй гэж хэлнэ (латин асуулт)', () => {
  const a = parseLocalNorm({
    status: 'uncertain',
    rule_kind: 'threshold',
    missing_context: ['interrupted_sun_area_share'],
    citation: { document: 'БНбД 31-24-22', clause: '6.1.11', page: null },
    evidence: [{ chunk_id: 'BNBD-31-24-22-2022:clause:6.1.11', code: 'БНбД 31-24-22', clause_no: '6.1.11', text_mn: 'Тоглоомын талбайн нарны шууд тусгалын нийлбэр ≥2.5 цаг; тасалдсан тусгалын үед талбайн 50%-д дор хаяж 1 цаг байна.', page: null, kind: 'clause' }],
  })!;
  const c = composeLocalNorm(a, 'mn-Cyrl', 'tsetserlegiin togloomiin talbai deer nar heden tsag tusah yostoi ve? yagaad tiim chuhal yum')!;
  assert.match(c.text, /^Тоглоомын талбайн нарны шууд тусгалын нийлбэр ≥2\.5 цаг/);
  assert.match(c.text, /Яагаад гэдгийг энэ заалт өөрөө тайлбарлаагүй\./);
  assert.doesNotMatch(c.text, /interrupted_sun/);
});

test('2026-09-28 эзний чат: нормын жагсаалтын ДАРААХ «hamgiin hetsuu norm durmiin jagsaaltiig beltge» — шинэ META ээлж (өмнөх «жагсаалт»-д хандалт биш)', () => {
  const state = { ...emptyConvState(), lastIntent: 'NORMATIVE' as const, lastSeq: 8, lastQuestion: 'tsahilgaantai holbootoi norm durem hed baidag ve' };
  const lastAssistant = '**Олдсон холбогдох баримт: 18**\n| № | Код | Нэр |\n| 1 | **БД 43-102-07** | Орон сууц, олон нийтийн барилгын цахилгаан |';
  const t = interpretTurn({ question: 'hamgiin hetsuu norm durmiin jagsaaltiig beltge', state, seq: 10, lastAssistant });
  assert.equal(t.kind, 'NEW_TOPIC');
  assert.equal(t.intent, 'META');
  assert.equal(t.historyMessages, 0);
  // Сэдэвтэй «жагсаалт» асуулт (каталог биш) өмнөх хариултад хандах хэвээр — энэ засвар түүнийг хөндөхгүй.
  const ref = interpretTurn({ question: 'tuunii jagsaaltiin ehnii 3-iig haruul', state, seq: 10, lastAssistant });
  assert.notEqual(ref.intent, 'META');
});
