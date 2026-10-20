/**
 * MGL AI · КОНТЕКСТ УГСРАГЧ + ЯРИАНЫ ТӨЛӨВ — ТЕСТ.
 *
 * Run with:  node --test src/lib/mglai/contextBuilder.test.ts
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ:
 *   · шинэ сэдэвт ТҮҮХ, СЭДВИЙН МӨР, PERSONA prompt-д ОГТ орохгүй (гоожилт)
 *   · үргэлжлэлд өмнөх хариулт ТАЙРАГДАЖ орно (давталтын програм талын эх)
 *   · persona нь ЗӨВХӨН өөрийнхөө тухай асуусан / мэндчилгээ / my-tasks
 *   · Revit эрхийн мөр ЗӨВХӨН Revit-ийн санаанд
 *   · клиентээс ирсэн төлөв АРИУТГАГДАНА
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

const CB = await import('./contextBuilder.ts');
const CS = await import('./convState.ts');
const { interpretTurn } = await import('./turn.ts');
const { assembleTurns } = await import('./promptFrame.ts');
const { planTurn, advanceState } = await import('./turnPlan.ts');

const SEEN = [
  { id: 51, name: 'Project A' },
  { id: 52, name: 'Project B' },
];
const A_STATE = {
  ...CS.emptyConvState(),
  subject: { kind: 'project', id: 51, name: 'Project A' },
  subjectSetAtSeq: 0,
  lastIntent: 'COMPANY_FACT',
  lastTools: ['get_upcoming_deadlines'],
  lastQuestion: 'Project A deadline hezee ve?',
  lastSeq: 0,
  projectsSeen: SEEN,
};
const HISTORY = [
  { role: 'user' as const, content: 'Project A deadline hezee ve?' },
  {
    role: 'assistant' as const,
    content:
      'Project A төсөл 2026-10-01-нд дуусна. Явц 42%. Багийн гишүүд: Бат, Болд, Дорж. ' +
      'x'.repeat(2000),
  },
];
const PERSONA = {
  userId: 9,
  name: 'Анар',
  role: 'engineer',
  position: 'Инженер',
  teamName: 'Барилга',
  teamCode: 'BA',
  openTaskCount: 3,
  nextDueDate: '2026-09-20',
  activeProjectCount: 2,
};
const ALL_TOOLS = [
  'get_active_employees',
  'list_projects',
  'get_upcoming_deadlines',
  'get_overdue_tasks',
  'get_my_assignments',
  'get_project_progress',
];

/* ── selectHistory ──────────────────────────────────────────────── */

test('selectHistory · NEW_TOPIC → түүх ОГТ орохгүй', () => {
  const t = interpretTurn({ question: 'V2 galyn achaalal hed ve?', state: A_STATE, seq: 2 });
  assert.deepEqual(CB.selectHistory(HISTORY, t), []);
});

test('selectHistory · FOLLOW_UP → өмнөх ээлж орно, хариулт ТАЙРАГДСАН', () => {
  const t = interpretTurn({ question: 'yagaad udaad bna?', state: A_STATE, seq: 2 });
  const h = CB.selectHistory(HISTORY, t);
  assert.equal(h.length, 2);
  assert.equal(h[0]!.role, 'user');
  assert.ok(h[1]!.content.length < 800, `хариулт тайрагдах ёстой: ${h[1]!.content.length}`);
  assert.ok(h[1]!.content.endsWith('…'));
  assert.match(h[1]!.content, /Project A/);
});

test('selectHistory · түүх ҮРГЭЛЖ хэрэглэгчийн мессежээр эхэлнэ', () => {
  const t = interpretTurn({ question: 'yagaad udaad bna?', state: A_STATE, seq: 2 });
  const h = CB.selectHistory([HISTORY[1]!], t);
  assert.equal(h.length, 0, 'ганц туслахын мессеж → хаягдана');
});

test('clipText · өгүүлбэрийн хил дээр тайрна', () => {
  const s = CB.clipText('Нэг өгүүлбэр. Хоёр дахь өгүүлбэр. Гурав дахь нь маш урт ' + 'y'.repeat(100), 60);
  assert.ok(s.startsWith('Нэг өгүүлбэр. Хоёр дахь өгүүлбэр.'));
  assert.ok(s.endsWith('…'));
});

/* ── subjectLine ────────────────────────────────────────────────── */

test('subjectLine · үргэлжлэлд төслийн мөр, шинэ сэдэвт null', () => {
  const follow = interpretTurn({ question: 'yagaad udaad bna?', state: A_STATE, seq: 2 });
  assert.match(CB.subjectLine(follow) ?? '', /Project A/);
  const fresh = interpretTurn({ question: 'V2 galyn achaalal hed ve?', state: A_STATE, seq: 2 });
  assert.equal(CB.subjectLine(fresh), null);
});

test('subjectLine · засварт «өмнөх төслийг МАРТ» гэсэн тушаал', () => {
  const corr = interpretTurn({ question: 'Үгүй ээ Project B-г хэлсэн', state: A_STATE, seq: 2 });
  const line = CB.subjectLine(corr) ?? '';
  assert.match(line, /Project B/);
  assert.match(line, /МАРТ/);
  assert.doesNotMatch(line, /Project A/);
});

/* ── persona ────────────────────────────────────────────────────── */

test('personaPolicy · төслийн асуултад persona ОРОХГҮЙ (identity гоожилт)', () => {
  assert.equal(
    CB.personaPolicy({ intent: 'COMPANY_FACT', question: 'Хэдэн төсөл байна', plannedTools: ['list_projects'] }),
    'none',
  );
  assert.equal(
    CB.personaPolicy({ intent: 'NORMATIVE', question: 'В2 галын ачаалал', plannedTools: [] }),
    'none',
  );
});

test('personaPolicy · «миний даалгавар» → full; мэндчилгээ → нэр л', () => {
  assert.equal(CB.personaPolicy({ intent: 'COMPANY_FACT', question: 'миний даалгавар', plannedTools: [] }), 'full');
  assert.equal(CB.personaPolicy({ intent: 'COMPANY_FACT', question: 'x', plannedTools: ['get_my_assignments'] }), 'full');
  assert.equal(CB.personaPolicy({ intent: 'CASUAL', question: 'сайн уу', plannedTools: [] }), 'name_only');
  assert.equal(CB.personaPolicy({ intent: 'META', question: 'чи юу чадах вэ', plannedTools: [] }), 'name_only');
});

test('personaText · name_only нь албан тушаал, баг агуулахгүй', () => {
  const t = CB.personaText(PERSONA as never, 'name_only') ?? '';
  assert.match(t, /Анар/);
  assert.doesNotMatch(t, /Инженер|Барилга|хугацаа/);
  const f = CB.personaText(PERSONA as never, 'full') ?? '';
  assert.match(f, /Инженер/);
  assert.equal(CB.personaText(PERSONA as never, 'none'), null);
});

test('revitLevelVisible · зөвхөн Revit санаа эсвэл Revit контекст', () => {
  assert.equal(CB.revitLevelVisible('COMPANY_FACT', false), false);
  assert.equal(CB.revitLevelVisible('NORMATIVE', false), false);
  assert.equal(CB.revitLevelVisible('REVIT_READ', false), true);
  assert.equal(CB.revitLevelVisible('GENERAL_HELP', true), true);
});

/* ── assembleTurns бүхэлдээ ─────────────────────────────────────── */

test('prompt · шинэ нормын сэдэвт «Project A», persona, Revit эрх ХААНА Ч БАЙХГҮЙ', () => {
  const t = interpretTurn({ question: 'В2 галын ачаалал хэд вэ', state: A_STATE, seq: 2 });
  const turns = assembleTurns({
    system: {
      mode: 'employee',
      userName: CB.personaText(PERSONA as never, CB.personaPolicy({ intent: t.intent, question: 'В2 галын ачаалал хэд вэ', plannedTools: [] })),
      revitLevel: CB.revitLevelVisible(t.intent, false) ? 'READ_ONLY' : null,
      subjectLine: CB.subjectLine(t),
      responseLanguage: 'mn-Cyrl',
      intent: t.intent,
      evidenceMandatory: true,
    },
    history: CB.selectHistory(HISTORY, t),
    question: 'В2 галын ачаалал хэд вэ',
    evidence: [],
    regulatory: true,
  });
  const all = turns.map((x) => x.content).join('\n');
  assert.doesNotMatch(all, /Project A/);
  assert.doesNotMatch(all, /Анар|Инженер|Барилга/);
  assert.doesNotMatch(all, /READ_ONLY|эрхийн түвшин/);
  assert.doesNotMatch(all, /ИДЭВХТЭЙ СЭДЭВ/);
});

test('prompt · үргэлжлэлд сэдвийн мөр + тайрсан түүх орно, identity дүрэм байхгүй', () => {
  const t = interpretTurn({ question: 'yagaad udaad bna?', state: A_STATE, seq: 2 });
  const turns = assembleTurns({
    system: {
      mode: 'employee',
      userName: null,
      subjectLine: CB.subjectLine(t),
      responseLanguage: 'mn-Cyrl',
      intent: t.intent,
    },
    history: CB.selectHistory(HISTORY, t),
    question: 'yagaad udaad bna?',
    evidence: [],
  });
  const sys = turns[0]!.content;
  assert.match(sys, /ИДЭВХТЭЙ СЭДЭВ: төсөл «Project A»/);
  assert.equal(turns.filter((x) => x.role === 'assistant' && x.content.includes('Project A төсөл')).length, 1);
  assert.doesNotMatch(sys, /Хэрэглэгчийн нэр/);
});

test('prompt · олон даалгавар → «Асуулт 1/2», тусгаарлах тушаал, нормын татгалзал 2-т Л', () => {
  const q = 'Манай компанид хэдэн идэвхтэй төсөл байгаа вэ? Бас В2 ангиллын галын ачаалал хэдээс хэд вэ?';
  const plan = planTurn({ question: q, rawState: null, seq: 0, visibleTools: ALL_TOOLS });
  assert.equal(plan.turn.kind, 'MULTI_INTENT');
  assert.equal(plan.normTaskIndex, 2);
  const turns = assembleTurns({
    system: {
      mode: 'employee',
      responseLanguage: 'mn-Cyrl',
      intent: plan.turn.intent,
      evidenceMandatory: true,
      normTaskIndex: plan.normTaskIndex,
    },
    history: [],
    question: q,
    evidence: [],
    regulatory: true,
    tasks: plan.turn.tasks.map((x) => x.text),
    toolResults: [{ tool: 'list_projects', ok: true, data: { total_visible: 12 } }],
    asOf: '2026-09-10',
  });
  const sys = turns[0]!.content;
  const user = turns[turns.length - 1]!.content;
  assert.match(sys, /2 ТУСДАА асуулт/);
  assert.match(sys, /2\) дугаар асуулт нь норм/);
  assert.match(user, /Асуултууд:\n1\) /);
  assert.match(user, /\n2\) /);
  assert.match(user, /total_visible/);
});

/* ── planTurn: хэрэгслийн төлөвлөгөө ────────────────────────────── */

test('planTurn · «yagaad udaad bna?» → get_project_progress(51), ERP_ANALYSIS', () => {
  const p = planTurn({ question: 'yagaad udaad bna?', rawState: A_STATE, seq: 2, visibleTools: ALL_TOOLS });
  assert.equal(p.turn.kind, 'FOLLOW_UP');
  assert.deepEqual(p.tools, [{ name: 'get_project_progress', args: { project_id: 51 } }]);
  assert.equal(p.askLocalNorm, false);
});

test('planTurn · нормын даалгаварт ERP хэрэгсэл ДУУДАХГҮЙ («ачаалал» ≠ ажилтан)', () => {
  const p = planTurn({ question: 'В2 ангиллын галын ачаалал хэд вэ', rawState: A_STATE, seq: 2, visibleTools: ALL_TOOLS });
  assert.deepEqual(p.tools, []);
  assert.equal(p.askLocalNorm, true);
  assert.equal(p.regulatory, true);
});

test('planTurn · олон даалгавар: ERP хэрэгсэл 1-ээс, нормын асуулт 2-оос', () => {
  const p = planTurn({
    question: 'Манай компанид хэдэн идэвхтэй төсөл байгаа вэ? Бас В2 ангиллын галын ачаалал хэдээс хэд вэ?',
    rawState: null,
    seq: 0,
    visibleTools: ALL_TOOLS,
  });
  assert.ok(p.tools.some((t) => t.name === 'list_projects'));
  assert.ok(!p.tools.some((t) => t.name === 'get_active_employees'), '«ачаалал» ERP хэрэгсэл болохгүй');
  assert.match(p.normTask?.text ?? '', /В2/);
  assert.doesNotMatch(p.normTask?.text ?? '', /идэвхтэй төсөл/);
  assert.equal(p.searchQuestion, p.normTask?.text);
});

test('planTurn · засвар: өмнөх хэрэгслийг ШИНЭ төсөл дээр', () => {
  const p = planTurn({ question: 'Үгүй ээ Project B-г хэлсэн', rawState: A_STATE, seq: 2, visibleTools: ALL_TOOLS });
  assert.equal(p.turn.kind, 'CORRECTION');
  assert.ok(p.tools.some((t) => t.name === 'get_project_progress' && t.args.project_id === 52));
});

/* ── advanceState ───────────────────────────────────────────────── */

test('advanceState · «хамгийн ойр deadline төсөл аль вэ» → эхний төсөл сэдэв болно', () => {
  const q = 'Deadline hamgiin oir project ali ve?';
  const p = planTurn({ question: q, rawState: null, seq: 0, visibleTools: ALL_TOOLS });
  const next = advanceState({
    state: p.state,
    turn: p.turn,
    toolResults: [
      {
        tool: 'get_upcoming_deadlines',
        ok: true,
        data: { projects: [{ id: 51, name: 'Project A' }, { id: 52, name: 'Project B' }] },
      },
    ],
    seq: 0,
    question: q,
  });
  assert.deepEqual(next.subject, { kind: 'project', id: 51, name: 'Project A' });
  assert.equal(next.projectsSeen.length, 2);
  assert.deepEqual(next.lastTools, ['get_upcoming_deadlines']);
  // Дараагийн ээлж: «yagaad udaad bgaan?» → A
  const p2 = planTurn({ question: 'yagaad udaad bgaan?', rawState: next, seq: 2, visibleTools: ALL_TOOLS });
  assert.equal(p2.turn.kind, 'FOLLOW_UP');
  assert.equal(p2.turn.subject?.kind === 'project' ? p2.turn.subject.id : null, 51);
});

test('advanceState · жагсаалт асуусан бол сэдэв ТОГТООХГҮЙ', () => {
  const q = 'Бүх идэвхтэй төслүүдийг харуул';
  const p = planTurn({ question: q, rawState: null, seq: 0, visibleTools: ALL_TOOLS });
  const next = advanceState({
    state: p.state,
    turn: p.turn,
    toolResults: [{ tool: 'list_projects', ok: true, data: { projects: SEEN } }],
    seq: 0,
    question: q,
  });
  assert.equal(next.subject, null);
  assert.equal(next.projectsSeen.length, 2, 'нэр таних жагсаалт ҮЛДЭНЭ');
});

test('advanceState · нормын шинэ сэдэв төслийн сэдвийг ЦЭВЭРЛЭНЭ, projectsSeen үлдэнэ', () => {
  const q = 'В2 галын ачаалал хэд вэ';
  const p = planTurn({ question: q, rawState: A_STATE, seq: 2, visibleTools: ALL_TOOLS });
  const next = advanceState({ state: p.state, turn: p.turn, toolResults: [], seq: 2, question: q });
  assert.equal(next.subject, null);
  assert.equal(next.lastIntent, 'NORMATIVE');
  assert.equal(next.projectsSeen.length, 2);
});

/* ── parseConvState ─────────────────────────────────────────────── */

test('parseConvState · буруу хувилбар, хог утга → хоосон төлөв', () => {
  assert.deepEqual(CS.parseConvState({ version: 99, subject: { kind: 'project', id: 1, name: 'x' } }), CS.emptyConvState());
  assert.deepEqual(CS.parseConvState('junk'), CS.emptyConvState());
  const s = CS.parseConvState({
    version: 1,
    subject: { kind: 'project', id: -5, name: 'bad' },
    lastIntent: 'HACK',
    lastTools: ['DROP TABLE', 'list_projects'],
    projectsSeen: [{ id: 1, name: 'A' }, { id: 1, name: 'dup' }, { id: 'x', name: 'no' }],
  });
  assert.equal(s.subject, null, 'сөрөг id → хаягдана');
  assert.equal(s.lastIntent, null);
  assert.deepEqual(s.lastTools, ['list_projects']);
  assert.deepEqual(s.projectsSeen, [{ id: 1, name: 'A' }]);
});

test('selectHistory · dropAssistant → өмнөх ХАРИУЛТ орохгүй, хэрэглэгчийн мессеж үлдэнэ (детерминист нормын ээлж)', () => {
  const turn = interpretTurn({ question: 'yagaad udaad bna?', state: A_STATE as never, seq: 1 });
  assert.equal(turn.kind, 'FOLLOW_UP');
  const hist = CB.selectHistory(HISTORY, turn, { dropAssistant: true });
  assert.deepEqual(hist.map((h) => h.role), ['user']);
  assert.equal(hist[0]?.content, 'Project A deadline hezee ve?');
  const normal = CB.selectHistory(HISTORY, turn);
  assert.deepEqual(normal.map((h) => h.role), ['user', 'assistant'], 'өгөгдмөл нь өмнөхтэй ижил');
});
