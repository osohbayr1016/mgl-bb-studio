/**
 * MGL AI · ЭЭЛЖИЙН ТАЙЛАГЧ — ТЕСТ (ярианы кернел).
 *
 * Run with:  node --test src/lib/mglai/turn.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ — хэрэглэгчийн шаардлагын 4 яриа:
 *   1. «Project A deadline?» → «yagaad udaad bna?»   — A ҮЛДЭНЭ
 *   2. «Project A deadline?» → «V2 galyn achaalal?»  — A ОРОХГҮЙ
 *   3. «Хэдэн төсөл? В2 галын ачаалал?»              — ХОЁР даалгавар
 *   4. «Project A…» → «Үгүй ээ Project B-г хэлсэн»   — B ЯЛНА
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

const { interpretTurn, splitTasks, findProjectMention, isSelfReference, domainOf } = await import(
  './turn.ts'
);
const { emptyConvState } = await import('./convState.ts');

const SEEN = [
  { id: 30, name: 'Хан-Уул сургууль' },
  { id: 51, name: 'Project A' },
  { id: 52, name: 'Project B' },
  { id: 7, name: 'Төв' },
];

function stateAfter(overrides: Record<string, unknown>) {
  return { ...emptyConvState(), ...overrides };
}

const PROJECT_A_STATE = stateAfter({
  subject: { kind: 'project', id: 51, name: 'Project A' },
  subjectSetAtSeq: 0,
  lastIntent: 'COMPANY_FACT',
  lastTools: ['get_upcoming_deadlines'],
  lastQuestion: 'Project A deadline hezee ve?',
  lastSeq: 0,
  projectsSeen: SEEN,
});

/* ── ТЕСТ 1: үргэлжлэл сэдвийг хадгална ─────────────────────────── */

test('TEST 1 · «yagaad udaad bna?» нь Project A-г ӨВЛӨНӨ', () => {
  const t = interpretTurn({ question: 'yagaad udaad bna?', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'FOLLOW_UP');
  assert.deepEqual(t.subject, { kind: 'project', id: 51, name: 'Project A' });
  assert.equal(t.intent, 'ERP_ANALYSIS', 'ERP-ийн «яагаад» нь шинжилгээ');
  assert.ok(t.historyMessages > 0, 'үргэлжлэлд өмнөх ээлж prompt-д орно');
  assert.match(t.tasks[0]!.resolvedText, /Project A/);
});

test('TEST 1b · кирилл «энэ яагаад удаад байгаа юм» ч мөн адил', () => {
  const t = interpretTurn({ question: 'энэ яагаад удаад байгаа юм', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'FOLLOW_UP');
  assert.equal(t.subject?.kind, 'project');
});

test('TEST 1c · «дэлгэрэнгүй» гэсэн ганц үг ч үргэлжлэл', () => {
  const t = interpretTurn({ question: 'дэлгэрэнгүй', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'FOLLOW_UP');
});

/* ── ТЕСТ 2: шинэ сэдэвт гоожилт байхгүй ────────────────────────── */

test('TEST 2 · «V2 galyn achaalal hed ve?» нь ШИНЭ СЭДЭВ, Project A ОРОХГҮЙ', () => {
  const t = interpretTurn({ question: 'V2 galyn achaalal hed ve?', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'NEW_TOPIC');
  assert.equal(t.subject, null, 'төслийн сэдэв нормын асуултад ӨВЛӨГДӨХГҮЙ');
  assert.equal(t.historyMessages, 0, 'түүх ОГТ орохгүй');
  assert.equal(t.intent, 'NORMATIVE');
  assert.doesNotMatch(t.tasks[0]!.resolvedText, /Project A/);
});

test('TEST 2b · кирилл «В2 ангиллын галын ачаалал хэдээс хэд вэ» ч шинэ сэдэв', () => {
  const t = interpretTurn({
    question: 'В2 ангиллын галын ачаалал хэдээс хэд вэ?',
    state: PROJECT_A_STATE,
    seq: 2,
  });
  assert.equal(t.kind, 'NEW_TOPIC');
  assert.equal(t.subject, null);
});

test('TEST 2c · «энэ нормын дагуу хэд вэ» — «энэ» байвч салбар өөр тул ӨВЛӨХГҮЙ', () => {
  const t = interpretTurn({
    question: 'энэ нормын дагуу гарц хэд байх вэ',
    state: PROJECT_A_STATE,
    seq: 2,
  });
  assert.equal(t.kind, 'NEW_TOPIC');
  assert.equal(t.subject, null);
});

/* ── ТЕСТ 3: олон санаа ─────────────────────────────────────────── */

test('TEST 3 · ERP + норм нэг мессежинд → ХОЁР даалгавар, тусдаа салбар', () => {
  const t = interpretTurn({
    question: 'Манай компанид хэдэн идэвхтэй төсөл байгаа вэ? Бас В2 ангиллын галын ачаалал хэдээс хэд вэ?',
    state: emptyConvState(),
    seq: 0,
  });
  assert.equal(t.kind, 'MULTI_INTENT');
  assert.equal(t.tasks.length, 2);
  assert.equal(t.tasks[0]!.domain, 'erp');
  assert.equal(t.tasks[1]!.domain, 'norm');
  assert.equal(t.intent, 'NORMATIVE', 'хамгийн хатуу санаа ялна');
  assert.equal(t.policy.evidenceMandatory, true);
  assert.equal(t.policy.needsErpTools, true);
  assert.equal(t.historyMessages, 0);
});

test('TEST 3b · латин: «Manai company heden projecttai ve? V2 galyn achaalal hed ve?»', () => {
  const t = interpretTurn({
    question: 'Manai company heden projecttai ve? V2 galyn achaalal hed ve?',
    state: emptyConvState(),
    seq: 0,
  });
  assert.equal(t.kind, 'MULTI_INTENT');
  assert.equal(t.tasks.length, 2);
  assert.equal(t.tasks[1]!.domain, 'norm');
});

test('TEST 3c · ХОЁР ERP асуулт нь НЭГ даалгавар (хуваахгүй)', () => {
  const t = interpretTurn({
    question: 'Хэдэн төсөл идэвхтэй байна? Хэд нь хоцорч байна?',
    state: emptyConvState(),
    seq: 0,
  });
  assert.notEqual(t.kind, 'MULTI_INTENT');
  assert.equal(t.tasks.length, 1);
});

test('TEST 3d · «Сайн уу. Хэдэн төсөл байна?» нь нэг даалгавар (мэндчилгээ залгигдана)', () => {
  const t = interpretTurn({ question: 'Сайн уу. Хэдэн төсөл байна?', state: emptyConvState(), seq: 0 });
  assert.equal(t.tasks.length, 1);
  assert.equal(t.tasks[0]!.domain, 'erp');
});

test('splitTasks · гурваас олон хэсгийг гурав болгож нэгтгэнэ', () => {
  const parts = splitTasks('Хэдэн төсөл байна? В2 ачаалал хэд вэ? Revit дээр wall хэд вэ? Талбайг тооц?');
  assert.ok(parts.length <= 3);
  assert.ok(parts.join(' ').includes('Талбайг тооц'), 'сүүлийн хэсэг алдагдахгүй');
});

/* ── ТЕСТ 4: засвар ялна ────────────────────────────────────────── */

test('TEST 4 · «Үгүй ээ Project B-г хэлсэн» → сэдэв B болно', () => {
  const t = interpretTurn({ question: 'Үгүй ээ Project B-г хэлсэн.', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'CORRECTION');
  assert.deepEqual(t.subject, { kind: 'project', id: 52, name: 'Project B' });
  assert.equal(t.intent, 'COMPANY_FACT', 'засварын санаа нь ӨМНӨХ ээлжийнх');
  assert.match(t.tasks[0]!.resolvedText, /Project B/);
  assert.match(t.tasks[0]!.text, /deadline/, 'өмнөх асуулт шинэ сэдэв дээр давтагдана');
});

test('TEST 4b · латин «ugui ee, Project B-g helsen yum»', () => {
  const t = interpretTurn({ question: 'ugui ee, Project B-g helsen yum', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'CORRECTION');
  assert.equal(t.subject?.kind === 'project' ? t.subject.id : null, 52);
});

test('TEST 4c · засварын тэмдэгтэй ч нэр таарахгүй бол сэдэв ХАСАГДАНА', () => {
  const t = interpretTurn({ question: 'үгүй ээ, тэр биш', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'CORRECTION');
  assert.equal(t.subject, null);
});

/* ── Лавлагаа, тодруулга ────────────────────────────────────────── */

test('REFERENCE · «хоёр дахь нь хэзээ дуусах вэ» нь өмнөх хариултыг шаардана', () => {
  const t = interpretTurn({ question: 'хоёр дахь нь хэзээ дуусах вэ', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'REFERENCE_TO_PRIOR_RESULT');
  assert.ok(t.historyMessages >= 2);
});

test('CLARIFICATION · туслах асуусан, хэрэглэгч богино хариулав', () => {
  const t = interpretTurn({
    question: 'Тийм, тэр',
    state: PROJECT_A_STATE,
    seq: 2,
    lastAssistant: 'Project A-г хэлж байна уу?',
  });
  assert.equal(t.kind, 'CLARIFICATION');
  assert.equal(t.subject?.kind, 'project');
});

test('FOLLOW_UP · англи «Why is this project behind?» нь монгол «энэ төсөл яагаад хоцорч байна»-тай ИЖИЛ', () => {
  for (const q of ['Why is this project behind?', 'Why is the project delayed?', 'Энэ төсөл яагаад хоцорч байна вэ?', 'ene tusul yagaad hotsorch bna']) {
    const t = interpretTurn({ question: q, state: PROJECT_A_STATE, seq: 2 });
    assert.equal(t.kind, 'FOLLOW_UP', q);
    assert.deepEqual(t.subject, { kind: 'project', id: 51, name: 'Project A' }, q);
    assert.equal(t.intent, 'ERP_ANALYSIS', q);
  }
});

test('CONTINUATION · «how many projects are active» нь сэдэвтэй ч тоолох асуулт — сэдэв НААХГҮЙ', () => {
  for (const q of ['How many active projects do we have?', 'Хэдэн төсөл идэвхтэй байна?']) {
    const t = interpretTurn({ question: q, state: PROJECT_A_STATE, seq: 2 });
    assert.notEqual(t.kind, 'FOLLOW_UP', q);
  }
});

/* ── Сэдвийн хугацаа ────────────────────────────────────────────── */

test('TTL · 6-аас олон ээлжийн өмнөх сэдэв ӨВЛӨГДӨХГҮЙ', () => {
  const t = interpretTurn({ question: 'яагаад удаад байна', state: PROJECT_A_STATE, seq: 20 });
  assert.notEqual(t.kind, 'FOLLOW_UP');
  assert.equal(t.subject, null);
});

/* ── Ижил салбарын шинэ дэд асуулт ──────────────────────────────── */

test('CONTINUATION · ижил ERP салбар, нэрлэсэн ӨӨР төсөл → тэр төсөл', () => {
  const t = interpretTurn({
    question: 'Хан-Уул сургууль төслийн явц хэд вэ?',
    state: PROJECT_A_STATE,
    seq: 2,
  });
  assert.equal(t.kind, 'CONTINUATION');
  assert.deepEqual(t.subject, { kind: 'project', id: 30, name: 'Хан-Уул сургууль' });
});

test('NEW_TOPIC · ярианы эхлэл', () => {
  const t = interpretTurn({ question: 'Манай компани хэдэн ажилтантай вэ', state: emptyConvState(), seq: 0 });
  assert.equal(t.kind, 'NEW_TOPIC');
  assert.equal(t.historyMessages, 0);
  assert.equal(t.reason, 'ярианы эхлэл');
});

test('NEW_TOPIC · «өөр асуулт» гэвэл сэдэвтэй ч шинэ', () => {
  const t = interpretTurn({ question: 'өөр асуулт: яагаад хоцорч байна', state: PROJECT_A_STATE, seq: 2 });
  assert.equal(t.kind, 'NEW_TOPIC');
});

/* ── Нэр таних ──────────────────────────────────────────────────── */

test('findProjectMention · хамгийн урт нэр ялна, богино «Төв» дур мэдэн таарахгүй', () => {
  assert.equal(findProjectMention('Хан-Уул сургууль хэзээ дуусах вэ', SEEN)?.id, 30);
  assert.equal(findProjectMention('Төв аймагт хэдэн төсөл байна', SEEN), null, '«Төв» 3 тэмдэгт — энгийн үгтэй давхцдаг тул ХЭЗЭЭ Ч таарахгүй');
  assert.equal(findProjectMention('төсөл #7 явц', SEEN)?.id, 7, 'богино нэртэй төслийг #id-аар');
  assert.equal(findProjectMention('төсөл #52 явц', SEEN)?.id, 52);
  assert.equal(findProjectMention('project a deadline', SEEN)?.id, 51, 'регистр ялгахгүй');
  assert.equal(findProjectMention('Why is this project behind?', SEEN), null, '«Project B» нь «project behind» дотор ТААРАХГҮЙ');
  assert.equal(findProjectMention('Project B-гийн явц хэд вэ', SEEN)?.id, 52, 'кирилл залгавартай нэр таарна');
  assert.equal(findProjectMention('Хан-Уул сургууль-ийн явц', SEEN)?.id, 30, 'зураастай залгавар таарна');
});

test('isSelfReference · «миний даалгавар» тийм, «төслийн даалгавар» үгүй', () => {
  assert.equal(isSelfReference('миний даалгавар юу байна'), true);
  assert.equal(isSelfReference('minii daalgavar'), true);
  assert.equal(isSelfReference('Хан-Уул төслийн даалгавар хэд вэ'), false);
  assert.equal(isSelfReference('В2 галын ачаалал'), false);
});

test('domainOf · санаа → салбар', () => {
  assert.equal(domainOf('NORMATIVE'), 'norm');
  assert.equal(domainOf('ERP_ANALYSIS'), 'erp');
  assert.equal(domainOf('REVIT_READ'), 'revit');
  assert.equal(domainOf(null), 'general');
});

/* ── ТЕСТ N: нормын оролтын үргэлжлэл (P0-13, 2026-09-11) ────────── */

const NORM_STATE = stateAfter({
  lastIntent: 'NORMATIVE',
  lastQuestion: 'g=1800 МДж/м² бол В2 юу?',
  lastSeq: 0,
  norm: {
    inputs: { gMjM2: 1800 },
    medium: [],
    equipmentVolumeUnknown: false,
    documentCode: 'БД 21-101-12',
    lastKind: 'classification',
    lastInitialCategory: 'В2',
    lastFinalCategory: null,
    lastMissingInputs: ['Q', 'H'],
    setAtSeq: 0,
  },
});

test('норм · «Q=50000 МДж, H=6 м» нь нормын төлөвтэй үед NORMATIVE FOLLOW_UP (GENERAL_HELP биш)', () => {
  const t = interpretTurn({ question: 'Q=50000 МДж, H=6 м', state: NORM_STATE, seq: 1 });
  assert.equal(t.kind, 'FOLLOW_UP');
  assert.equal(t.intent, 'NORMATIVE');
  assert.equal(t.tasks[0]?.domain, 'norm');
  assert.equal(t.policy.showConfidenceBadge, true);
  const p = interpretTurn({ question: 'ΔP=5 кПа бол?', state: NORM_STATE, seq: 1 });
  assert.equal(p.kind, 'FOLLOW_UP');
  assert.equal(p.intent, 'NORMATIVE');
});

test('норм · ижил тэмдэглэгээ нормын төлөвГҮЙ бол өмнөх ангилал хэвээр (төлөвгүй шийдвэр өөрчлөгдөхгүй)', () => {
  const t = interpretTurn({ question: 'Q=50000 МДж, H=6 м', state: PROJECT_A_STATE, seq: 1 });
  assert.notEqual(t.intent, 'NORMATIVE');
  const e = interpretTurn({ question: 'Хэдэн төсөл байна?', state: NORM_STATE, seq: 1 });
  assert.equal(e.intent, 'COMPANY_FACT', 'ERP асуулт нормын төлөвөөс хамаарахгүй');
});

/* ── R3.5: Revit сонголт + заах үг → REVIT_READ ──────────────────────── */
test('R3.5: «Энэ юу вэ?» нь Revit сонголттой үед REVIT_READ, сонголтгүй үед GENERAL_HELP', () => {
  const base = { question: 'Энэ юу вэ?', state: emptyConvState(), seq: 0, lastAssistant: null };
  const withSel = interpretTurn({ ...base, revitSelection: 1 });
  assert.equal(withSel.tasks[0]!.intent, 'REVIT_READ');
  assert.equal(withSel.tasks[0]!.domain, 'revit');
  const noSel = interpretTurn({ ...base, revitSelection: 0 });
  assert.equal(noSel.tasks[0]!.intent, 'GENERAL_HELP');
  // Заах үггүй ерөнхий асуулт сонголттой ч ХӨНДӨГДӨХГҮЙ; нормын асуулт ч хөндөгдөхгүй.
  assert.notEqual(interpretTurn({ ...base, question: 'Хэдэн төсөл байна?', revitSelection: 1 }).tasks[0]!.intent, 'REVIT_READ');
  assert.equal(interpretTurn({ ...base, question: 'Энэ хананд ямар норм хамаарах вэ?', revitSelection: 1 }).tasks[0]!.intent, 'NORMATIVE');
});

test('R3.5: «тайлан гарга» нь Revit тайлангийн нотолгоотой үед REVIT_READ, үгүй бол хэвээр', () => {
  const base = { question: 'Өнөөдрийн хийсэн ажлын тайлан гарга.', state: emptyConvState(), seq: 0, lastAssistant: null };
  assert.equal(interpretTurn({ ...base, revitReport: true }).tasks[0]!.intent, 'REVIT_READ');
  assert.notEqual(interpretTurn({ ...base, revitReport: false }).tasks[0]!.intent, 'REVIT_READ');
});

test('R4.2: сонголттой «Энэ ханыг жаахан зөө» / «Y чиглэлд 100 мм зөө» → REVIT_ACTION; «Энэ хана ямар байна?» хэвээр READ', () => {
  const base = { state: emptyConvState(), seq: 0, lastAssistant: null, revitSelection: 1 };
  assert.equal(interpretTurn({ ...base, question: 'Энэ ханыг Y чиглэлд 100 мм зөөх санал гарга.' }).tasks[0]!.intent, 'REVIT_ACTION');
  assert.equal(interpretTurn({ ...base, question: 'Энэ ханыг жаахан зөө.' }).tasks[0]!.intent, 'REVIT_ACTION');
  assert.equal(interpretTurn({ ...base, question: 'Энэ хана ямар байна?' }).tasks[0]!.intent, 'REVIT_READ');
  // Сонголтгүй ч «ханыг … зөө» нь Revit бичих хүсэлт (classifyIntent) — grounding guard контекстгүйг татгалзана, binder зорилтгүйг хаана.
  assert.equal(interpretTurn({ ...base, question: 'Энэ ханыг жаахан зөө.', revitSelection: 0 }).tasks[0]!.intent, 'REVIT_ACTION');
});
