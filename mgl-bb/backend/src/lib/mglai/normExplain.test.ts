/**
 * L2 норм ойлгох давхарга — Worker тал (`normExplain.ts`): цагаан жагсаалтын parser, тооцооны хаалга,
 * хариултын хэлбэр (заалт · энгийн тайлбар · хэнд/юунд · нөхцөл · онцгой нөхцөл · холбогдох · эх сурвалж),
 * гэрээ (`templateOnly`, эх сурвалжийн код заавал, трейлер), follow-up хаяг (`followUpNormQuery`).
 *
 * Бичлэг нь БОДИТ `ai/norm-dataset/documents/BNbD_31-17-10/l2/clause_explanations.jsonl`-оос (5.2, 1.1, 8.3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const NE = await import('./normExplain');
const LN = await import('./localNorm');
const TE = await import('./norm/turnEngine');
const TURN = await import('./turn');
const CS = await import('./convState');
const REG = await import('./norm/registry');

const L2 = join(import.meta.dirname, '..', '..', '..', '..', 'ai', 'norm-dataset', 'documents', 'BNbD_31-17-10', 'l2', 'clause_explanations.jsonl');
const records = new Map(
  readFileSync(L2, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .map((r) => [String(r.clause_uid), r] as const),
);
const rec = (uid: string): Record<string, unknown> => {
  const r = records.get(uid);
  if (!r) throw new Error(`L2 бичлэг алга: ${uid}`);
  return r;
};
const block = (uid: string, over: Record<string, unknown> = {}) => ({
  schema: 'l2-clause/1',
  mode: 'exact_clause',
  document: { doc_id: 'BNBD-31-17-10-2010', code: 'БНбД 31-17-10' },
  clause: rec(uid),
  candidates: [],
  ambiguity: null,
  section: null,
  documentExplanation: null,
  computable: false,
  currentness_routed: false,
  ...over,
});
const baseContract = () => ({
  version: 'tfc-2' as const,
  answerMode: 'grounded' as const,
  risk: 'high' as const,
  facts: [],
  allowedNumbers: null,
  allowedCategories: null,
  requiredSentence: null,
  trailerText: 'Анхаар: сүүлийн өөрчлөлт шалгаагүй.',
  requiredCitations: [],
  noMatch: false,
  forbiddenPhrases: [],
  template: 'хуучин загвар',
  taskIndex: null,
  legacyKind: 'free' as const,
  reason: 'test',
  norm: null,
});

/* ── Parser (цагаан жагсаалт) ─────────────────────────────────────── */

test('parse · бодит 5.2 бичлэг → view; computable ≠ false, schema ≠ l2-clause/1, http URL бүгд хаягдана', () => {
  const x = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2'))!;
  assert.equal(x.mode, 'exact_clause');
  assert.equal(x.code, 'БНбД 31-17-10');
  assert.equal(x.clause?.clauseId, '5.2');
  assert.equal(x.clause?.page, 6);
  assert.match(x.clause!.sourceUrl!, /^https:\/\/mcis\.gov\.mn/);
  assert.ok(x.clause!.numericLiterals.includes('1,0кпа'));
  assert.ok(x.clause!.crossReferences.some((r) => r.kind === 'table' && r.target === '5.1'));
  assert.equal(NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { computable: true })), null);
  assert.equal(NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { schema: 'x' })), null);
  assert.equal(NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { clause: { ...rec('БНбД 31-17-10#5.2'), execution: { computable: true } } })), null);
  const http = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { clause: { ...rec('БНбД 31-17-10#5.2'), source: { page: 6, url: 'http://mcis.gov.mn/x' } } }))!;
  assert.equal(http.clause!.sourceUrl, null);
  assert.equal(NE.parseLocalNormExplanation(null), null);
  assert.equal(NE.parseLocalNormExplanation({ schema: 'l2-clause/1', computable: false, mode: 'exact_clause', document: { code: 'X' } }), null, 'заалт ч, хэсэг ч, баримт ч байхгүй');
});

test('parse · localNorm.parseLocalNorm нь explanation-ыг дамжуулна (хуучин runtime → null)', () => {
  const a = LN.parseLocalNorm({ status: 'supported', evidence: [], explanation: block('БНбД 31-17-10#1.1') })!;
  assert.equal(a.explanation?.clause?.clauseId, '1.1');
  assert.equal(LN.parseLocalNorm({ status: 'supported', evidence: [] })!.explanation, null);
});

/* ── Тооцооны хаалга ─────────────────────────────────────────────── */

test('isComputationAsk · тооцоо/ангилал/pass-fail → true; заалтын лавлагаа → false', () => {
  for (const q of [
    'Миний барилга 120 м өндөр бол 5.2 заалтыг хангах уу?',
    '17 давхар барилгын гол орцын талбайг тооцоод өгөөч',
    'Q=50000 МДж, H=6 м бол ямар ангилалд орох вэ?',
    '150 м өндөр барилгад хэдэн цахилгаан шат хэрэгтэй вэ?',
    'Техникийн давхар 7м өндөртэй бол давхрын тоонд орох уу?',
    'Does a 60 m building comply with clause 5.2?',
  ]) assert.equal(NE.isComputationAsk(q), true, q);
  for (const q of [
    'БНбД 31-17-10-ын 5.2 заалт юу гэж заасан бэ?',
    'БНбД 31-17-10 1.1 заалт хэнд хамаарах вэ?',
    'Энэ юу гэсэн үг вэ?',
    '8-р хавсралтын 8.3 заалтыг энгийнээр тайлбарла',
    'БНбД 31-17-10-ын 5-р бүлэг юуны тухай вэ?',
    'Ямар нөхцөлд хамаарах вэ?',
  ]) assert.equal(NE.isComputationAsk(q), false, q);
});

/* ── Рендер ──────────────────────────────────────────────────────── */

test('render · 5.2: шаардлагатай хэсгүүд, эх бичвэр үг үсгээрээ, тоо эхийн хэлбэрээр, эх сурвалж (код · заалт · хуудас · URL)', () => {
  const x = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2'))!;
  const t = NE.renderExplanation(x, 'mn-Cyrl', 'БНбД 31-17-10-ын 5.2 заалт юу гэж заасан бэ?')!;
  assert.match(t, /^\*\*БНбД 31-17-10 — 5\.2 заалт\*\*/);
  for (const h of ['**Эх бичвэр**', '**Энгийнээр**', '**Энэ заалт юу шаардаж байна**', '**Хэзээ хамаарах**', '**Анхаарах нөхцөл**', '**Холбогдох**', '**Тоо (эхийн хэлбэрээр)**', '**Эх сурвалж**']) assert.ok(t.includes(h), h);
  assert.ok(t.includes('5.1-р хүснэгтийн дагуу авна'));
  assert.ok(t.includes('1,0кпа') && t.includes('0,8кН'));
  assert.match(t, /\*\*Эх сурвалж\*\*: БНбД 31-17-10 · 5\.2 заалт · хэвлэмэл х\. 6 · \[MCIS\]\(https:\/\/mcis\.gov\.mn\//);
  assert.ok(!t.includes('**Онцгой нөхцөл**'), '5.2-т онцгой нөхцөл байхгүй → хэсэг орхигдоно');
  assert.ok(!/AUTO_DRAFT/.test(t), 'enum хэрэглэгчид гарахгүй (трейлерт монголоор)');
  // Заалтын өгүүлбэр бүр эх бичвэрт байх ёстой.
  const src = String(rec('БНбД 31-17-10#5.2').source_text);
  for (const line of t.split('\n').filter((l) => l.startsWith('• '))) assert.ok(src.includes(line.slice(2).replace(/^(?:Зөвшөөрсөн|Хориглосон): /u, '').replace(/…$/, '').slice(0, 60)), line.slice(0, 60));
});

test('render · хоосон хэсгийг ЗӨВХӨН асуусан үед ил хэлнэ («эх бичвэрт заагаагүй»); зохиохгүй', () => {
  const x = NE.parseLocalNormExplanation(block('БНбД 31-17-10#12.5'))!;
  const silent = NE.renderExplanation(x, 'mn-Cyrl', '12.5 заалт юу вэ?')!;
  assert.ok(!silent.includes('**Онцгой нөхцөл**') && !silent.includes('**Хэзээ хамаарах**'));
  const asked = NE.renderExplanation(x, 'mn-Cyrl', '12.5 заалт ямар нөхцөлд хамаарах вэ, онцгой нөхцөл байгаа юу?')!;
  assert.ok(asked.includes('**Хэзээ хамаарах**\nЭх бичвэрт тусгайлан нөхцөл заагаагүй.'));
  assert.ok(asked.includes('**Онцгой нөхцөл**\nЭх бичвэрт онцгой нөхцөл заагаагүй.'));
});

test('render · L2.1 фокус: «яагаад?» → үндэслэл ЗОХИОХГҮЙ; «дээвэрт хамаарах уу?» → эх бичвэрт байгаа/байхгүйг л; нэр дэвшигч зөвхөн PASS үед', () => {
  const x = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2'))!;
  const why = NE.renderExplanation(x, 'mn-Cyrl', 'Яагаад?')!;
  assert.ok(why.includes('**Яагаад**\nЭнэ заалт шаардлагыг тогтоосон боловч тухайн шаардлагын инженерийн үндэслэлийг энэ заалт өөрөө тайлбарлаагүй.'));
  assert.ok(!/учир нь|аюулгүй байдлын үүднээс/.test(why));
  assert.ok(why.includes('**Эх сурвалж**'));
  const roof = NE.renderExplanation(x, 'mn-Cyrl', 'Энэ нь дээвэрт хамаарах уу?')!;
  assert.ok(roof.includes('**Хамаарах уу — «дээвэрт»**'));
  assert.ok(roof.includes('Эх бичвэрт дурдсан: «') && roof.includes('дээврийн'));
  const wall = NE.renderExplanation(x, 'mn-Cyrl', 'Энэ нь галын хаалганд хамаарах уу?')!;
  assert.ok(wall.includes('тусгайлан дурдаагүй — хамаарах эсэхийг энэ заалт өөрөө тогтоогоогүй'));
  // Нэр дэвшигч: FAIL/NOT_RUN → fallback; PASS → нэр дэвшигч «Энгийнээр»-т.
  const rec52 = rec('БНбД 31-17-10#5.2');
  const withFail = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { clause: { ...rec52, plain_mn_candidate: 'ЗОХИОМОЛ', status: { ...(rec52.status as object), semantic_validation: 'FAIL' } } }))!;
  assert.equal(withFail.clause!.plainCandidate, null);
  assert.ok(NE.renderExplanation(withFail, 'mn-Cyrl', '')!.includes(`**Энгийнээр**
${withFail.clause!.plainFallback}`));
  // Семантик PASS ч ХҮНИЙ хяналт APPROVED биш → fallback хэвээр (бодлого: REVIEW_REQUIRED).
  const passNotReviewed = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { clause: { ...rec52, plain_mn_candidate: 'Шалгалт давсан нэр дэвшигч.', status: { ...(rec52.status as object), semantic_validation: 'PASS', human_review: 'NOT_REVIEWED' } } }))!;
  assert.equal(passNotReviewed.clause!.plainCandidate, null);
  const withPass = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { clause: { ...rec52, plain_mn_candidate: 'Шалгалт давсан нэр дэвшигч.', status: { ...(rec52.status as object), semantic_validation: 'PASS', human_review: 'APPROVED' } } }))!;
  assert.equal(withPass.clause!.plainCandidate, 'Шалгалт давсан нэр дэвшигч.');
  assert.ok(NE.renderExplanation(withPass, 'mn-Cyrl', '')!.includes('**Энгийнээр**\nШалгалт давсан нэр дэвшигч.'));
  assert.match(NE.withExplanation(baseContract(), withPass, 'mn-Cyrl', '5.2 заалт').trailerText!, /семантик шалгалт давсан загварын ноорог, хүн шалгаагүй/);
});

test('render · L2.1 ишлэл: шийдэгдээгүй хүснэгт «олдсонгүй — шийдэгдээгүй» гэж ил, холбоос ЗОХИОХГҮЙ; нэр томьёо тодорхойлолттой', () => {
  const r634 = rec('БНбД 31-17-10#A6.3:6.3.34');
  const x = NE.parseLocalNormExplanation(block('БНбД 31-17-10#A6.3:6.3.34', { clause: r634 }))!;
  const t = NE.renderExplanation(x, 'mn-Cyrl', '6.3.34 заалт ямар хүснэгт иш татсан бэ?')!;
  assert.ok(t.includes('14.2-р хүснэгт (энэ баримтад олдсонгүй — шийдэгдээгүй ишлэл)'), t);
  // 2026-09-23: 5.6-ийн «2-р хүснэгт» нь «БНбД 22-01-01*/2006/-ийн 2-р хүснэгт» — ӨӨР баримтынх (шийдэгдээгүй биш).
  const x56 = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.6', { clause: rec('БНбД 31-17-10#5.6') }))!;
  const t56 = NE.renderExplanation(x56, 'mn-Cyrl', '5.6 заалт ямар хүснэгт иш татсан бэ?')!;
  assert.ok(t56.includes('2-р хүснэгт (БНбД 22-01-01*/2006 — өөр баримтынх)') && !t56.includes('шийдэгдээгүй ишлэл'), t56);
  // Нэр томьёоны холбоос: 31-17-10-д бодит холбоос 0 (22 тодорхойлолтын нэг нь ч заалтад давтагддаггүй — хэмжсэн) тул синтетик.
  const r125 = rec('БНбД 31-17-10#12.5');
  const y = NE.parseLocalNormExplanation(block('БНбД 31-17-10#12.5', { clause: { ...r125, context: { ...(r125.context as object), definitions: [{ term: 'Аюулын бүс', definition_id: 'x', appendix: '1', page: 53, definition: 'террорист үйл ажиллагаа буюу бусад онцгой нөхцөл үүсч болзошгүй газар буюу өрөө тасалгаа.', matched_surface: 'аюулын бүсэд', match_method: 'stem_suffix', confidence: 0.9 }] } } }))!;
  assert.equal(y.clause!.definitions[0]?.term, 'Аюулын бүс');
  const ty = NE.renderExplanation(y, 'mn-Cyrl', '')!;
  assert.ok(ty.includes('«Аюулын бүс» — террорист үйл ажиллагаа') && ty.includes('(1-р хавсралт, нэр томьёо)'), ty.slice(0, 300));
  // Нэр томьёоны горим («Аюулын бүс гэж юу вэ?») — тодорхойлолт эхээс үг үсгээрээ.
  const def = NE.parseLocalNormExplanation(block('БНбД 31-17-10#12.5', { mode: 'definition', clause: null, definition: { term: 'Аюулын бүс', definition: 'террорист үйл ажиллагаа буюу бусад онцгой нөхцөл үүсч болзошгүй газар буюу өрөө тасалгаа.', page: 53, appendix: '1', chunk_id: 'BNBD-31-17-10-2010:definition:аюулын_бүс', linked_clauses: [] } }))!;
  assert.equal(def.mode, 'definition');
  const td = NE.renderExplanation(def, 'mn-Cyrl', '')!;
  assert.match(td, /^\*\*БНбД 31-17-10 — нэр томьёо «Аюулын бүс»\*\*/);
  assert.ok(td.includes(`**Тодорхойлолт (эхээс үг үсгээрээ)**` + String.fromCharCode(10) + '«террорист үйл ажиллагаа'));
});

test('render · 8.3 давхардал + хавсралтын хаяг; nearest_clause тэмдэглэл; хэсэг/баримтын горим', () => {
  const amb = NE.parseLocalNormExplanation(block('БНбД 31-17-10#8.3', { ambiguity: { chosen: 'БНбД 31-17-10#8.3', alternatives: ['БНбД 31-17-10#A8:8.3'] } }))!;
  const t = NE.renderExplanation(amb, 'mn-Cyrl', '8.3 заалт')!;
  assert.match(t, /ижил дугаартай 8-р хавсралтын 8\.3 заалт мөн бий/);
  const app = NE.parseLocalNormExplanation(block('БНбД 31-17-10#A8:8.3'))!;
  const ta = NE.renderExplanation(app, 'mn-Cyrl', '')!;
  assert.match(ta, /^\*\*БНбД 31-17-10 — 8-р хавсралт, 8\.3 заалт\*\*/);
  assert.ok(ta.includes('БНбД 40-05-98'));
  const near = NE.parseLocalNormExplanation(block('БНбД 31-17-10#4.6', { mode: 'nearest_clause', candidates: [{ clause_uid: 'БНбД 31-17-10#14.3', clause_id: '14.3', heading: '14. ГАЛЫН АЮУЛГҮЙН ШААРДЛАГА', plain_mn: 'x', page: 36 }] }))!;
  const tn = NE.renderExplanation(near, 'mn-Cyrl', '')!;
  assert.match(tn, /ХАМГИЙН ОЙР заалт/);
  assert.match(tn, /\*\*Мөн үзэх\*\*\n• 14\.3 \(х\. 36\) — 14\. ГАЛЫН/);
  const sec = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { mode: 'section', clause: null, section: { section: '5', title: 'АЧААЛАЛ БА ҮЙЛЧЛЭЛ', page: 6, clause_ids: ['5.1', '5.2', '5.9'], clause_count: 3, requirement_types: { obligation: 2, permission: 1 }, first_clause: { clause_id: '5.1', text: 'Ачаалал…' }, cross_documents: ['БНбД 20-04-17'] } }))!;
  const ts = NE.renderExplanation(sec, 'mn-Cyrl', '')!;
  assert.match(ts, /^\*\*БНбД 31-17-10 — 5-р бүлэг: АЧААЛАЛ БА ҮЙЛЧЛЭЛ\*\*/);
  assert.ok(ts.includes('Заалт: 3 (5.1–5.9)') && ts.includes('БНбД 20-04-17'));
  const doc = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { mode: 'document', clause: null, documentExplanation: { title_mn: 'Өндөр барилгын төлөвлөлт', scope_text: '17 давхар…', sections: [{ section: '1', title: 'ХЭРЭГЛЭХ ХҮРЭЭ', page: 3, clause_count: 2 }], appendices: [{}, {}], counts: { clauses: 593 }, source: { url: 'https://mcis.gov.mn/x' } } }))!;
  const td = NE.renderExplanation(doc, 'mn-Cyrl', '')!;
  assert.ok(td.includes('**Хэрэглэх хүрээ (1.1 заалт)**') && td.includes('заалт 593') && td.includes('хавсралт 2'));
  const sec2 = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2', { mode: 'section', clause: null, section: { section: '5', title: 'АЧААЛАЛ', page: 6, clause_ids: ['5.1'], clause_count: 1, requirement_types: {}, first_clause: null, cross_documents: [], source: { url: 'https://mcis.gov.mn/x' } } }))!;
  assert.match(NE.renderExplanation(sec2, 'mn-Cyrl', '')!, /\[MCIS\]\(https:\/\/mcis\.gov\.mn\/x\)/);
});

/* ── Гэрээ ───────────────────────────────────────────────────────── */

test('withExplanation · templateOnly + код заавал + трейлер (currentness хэвээр); тооцооны асуулт → загвар солигдохгүй, L2 трейлер', () => {
  const x = NE.parseLocalNormExplanation(block('БНбД 31-17-10#5.2'))!;
  const c = NE.withExplanation(baseContract(), x, 'mn-Cyrl', '5.2 заалт юу гэж заасан бэ?');
  assert.equal(c.templateOnly, true);
  assert.match(c.template!, /^\*\*БНбД 31-17-10 — 5\.2 заалт\*\*/);
  assert.deepEqual(c.requiredCitations, ['БНбД 31-17-10']);
  assert.ok(c.trailerText!.startsWith('Анхаар: сүүлийн өөрчлөлт шалгаагүй.'), 'currentness трейлер хэвээр, эхэнд');
  assert.match(c.trailerText!, /автомат ноорог \(AUTO_DRAFT, хүн шалгаагүй\)/);
  assert.match(c.trailerText!, /тооцоо, ангилал, нийцлийн дүгнэлт хийхгүй/);
  assert.match(c.reason, /l2_explanation:exact_clause/);
  const calc = NE.withExplanation(baseContract(), x, 'mn-Cyrl', '120 м өндөр барилга бол 5.2 заалтыг хангах уу?');
  assert.equal(calc.template, 'хуучин загвар');
  assert.equal(calc.templateOnly, undefined);
  assert.ok(calc.trailerText!.includes(NE.L2_NO_COMPUTE_MN));
  assert.match(calc.reason, /l2_no_compute_gate/);
});

/* ── Follow-up хаяг ───────────────────────────────────────────────── */

test('followUpNormQuery · өмнөх баримт+заалт → угтвар; энэ ээлж код/заалт нэрлэсэн бол хөндөхгүй', () => {
  const norm = { inputs: {}, medium: [], equipmentVolumeUnknown: false, documentCode: 'БНбД 31-17-10', lastKind: null, lastInitialCategory: null, lastFinalCategory: null, lastMissingInputs: [], setAtSeq: 2, lastClause: '5.2' };
  const ent = (codes: string[]) => ({ documentCodes: codes }) as unknown as Parameters<typeof TE.followUpNormQuery>[1];
  assert.equal(TE.followUpNormQuery('Энэ юу гэсэн үг вэ?', ent([]), norm), 'БНбД 31-17-10-ын 5.2 заалт: Энэ юу гэсэн үг вэ?');
  assert.equal(TE.followUpNormQuery('Тэгвэл 6.12 заалт нь?', ent([]), norm), 'БНбД 31-17-10: Тэгвэл 6.12 заалт нь?');
  assert.equal(TE.followUpNormQuery('УББ 12-01-01-ийн 2.5 заалт', ent(['УББ 12-01-01']), norm), 'УББ 12-01-01-ийн 2.5 заалт');
  assert.equal(TE.followUpNormQuery('Энэ юу гэсэн үг вэ?', ent([]), null), 'Энэ юу гэсэн үг вэ?');
  const out = TE.normEngineForTurn({ question: 'Энэ юу гэсэн үг вэ?', normTaskText: null, intent: 'NORMATIVE', turnKind: 'FOLLOW_UP', state: { ...CS.emptyConvState(), norm }, lang: 'mn-Cyrl', registry: REG.normRegistry() });
  assert.equal(out.normQuery, 'БНбД 31-17-10-ын 5.2 заалт: Энэ юу гэсэн үг вэ?');
  assert.equal(CS.parseConvState({ ...CS.emptyConvState(), norm }).norm?.lastClause, '5.2');
});

test('turn · «Энэ юу гэсэн үг вэ?» шууд өмнөх нормын ээлжийн дараа = NORMATIVE FOLLOW_UP', () => {
  const prev = { ...CS.emptyConvState(), lastIntent: 'NORMATIVE' as const, lastSeq: 2, lastQuestion: 'БНбД 31-17-10-ын 5.2 заалт юу гэж заасан бэ?' };
  for (const q of ['Энэ юу гэсэн үг вэ?', 'Энгийнээр тайлбарлаад өгөөч', 'Ямар нөхцөлд хамаарах вэ?', 'Онцгой нөхцөл байгаа юу?', 'Энэ нь дээвэрт хамаарах уу?', 'Яагаад?', 'exception бий юу?', 'энэ яг юу гэсэн үг?', 'хэнд хамаарах вэ?']) {
    const t = TURN.interpretTurn({ question: q, state: prev, seq: 3, lastAssistant: '…' });
    assert.ok(t.kind === 'FOLLOW_UP' || t.kind === 'CONTINUATION', `${q} → ${t.kind}`);
    assert.equal(t.tasks[0]?.intent, 'NORMATIVE', q);
  }
});

test('turn · КОНТЕКСТГҮЙ кодгүй асуулт БНбД 31-17-10-ыг ТААМАГЛАХГҮЙ: нормын төлөвгүй «талбайг яаж тогтоох вэ?» → угтваргүй, норм биш', () => {
  const t = TURN.interpretTurn({ question: 'талбайг яаж тогтоох вэ?', state: CS.emptyConvState(), seq: 0 });
  assert.notEqual(t.tasks[0]?.intent, 'NORMATIVE');
  const out = TE.normEngineForTurn({ question: 'талбайг яаж тогтоох вэ?', normTaskText: null, intent: t.tasks[0]!.intent, turnKind: t.kind, state: CS.emptyConvState(), lang: 'mn-Cyrl', registry: REG.normRegistry() });
  assert.equal(out.normQuery, 'талбайг яаж тогтоох вэ?');
  // Нормын төлөвтэй ч ШИНЭ СЭДЭВ (NEW_TOPIC) бол угтваргүй.
  const norm = { inputs: {}, medium: [], equipmentVolumeUnknown: false, documentCode: 'БНбД 31-17-10', lastKind: null, lastInitialCategory: null, lastFinalCategory: null, lastMissingInputs: [], setAtSeq: 2, lastClause: '5.2' };
  const out2 = TE.normEngineForTurn({ question: 'Ажилтны тоо хэд вэ?', normTaskText: null, intent: 'COMPANY_FACT', turnKind: 'NEW_TOPIC', state: { ...CS.emptyConvState(), norm }, lang: 'mn-Cyrl', registry: REG.normRegistry() });
  assert.equal(out2.normQuery, 'Ажилтны тоо хэд вэ?');
});
