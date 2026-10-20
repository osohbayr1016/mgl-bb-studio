/**
 * MGL AI · CONVERSATION CONTEXT + LONG-CONTEXT SUITE (Session C, 2026-09-11).
 *
 *   node --test ai/evaluation/production-readiness/suites/conversation-context.test.mjs
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ (мандат §14, §15) — ярианы кернелийн ЦЭВЭР
 *    хэсгүүд (`planTurn` → `advanceState` → `selectHistory` → `assembleTurns`):
 *      · сэдэв солилт (Revit → компани → ерөнхий): хуучин хэрэгсэл/сэдэв
 *        ШИНЭ сэдэвт хольцолдохгүй;
 *      · үргэлжлэл («Хариуцсан хүн нь?») зөв төслийг хадгална;
 *      · туслахын ӨМНӨХ БУРУУ хариулт (481 төсөл) баримт болохгүй — гэрээ
 *        түүхийн тоог зөвшөөрөгдсөн олонлогт оруулахгүй;
 *      · 50/100 ээлжийн яриа prompt-ыг задлахгүй: түүх тайрагдаж, prompt
 *        контекстын цонхны хязгаар дотор, сэдэв TTL-ээр унтарна.
 *
 *  Загваргүй, D1-гүй; хэрэгслийн үр дүн нь fixture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend } from '../lib/load.mjs';

const { planTurn, advanceState } = await loadBackend('turnPlan.ts');
const { planResearch } = await loadBackend('researchPlan.ts');
const { selectHistory, subjectLine } = await loadBackend('contextBuilder.ts');
const { assembleTurns } = await loadBackend('promptFrame.ts');
const { buildTrustedContract } = await loadBackend('trustedFacts.ts');
const { applyGroundingGuard } = await loadBackend('groundingGuard.ts');
const { toolsForMode } = await loadBackend('tools/registry.ts');
const { SUBJECT_TTL_TURNS } = await loadBackend('convState.ts');

const VISIBLE = toolsForMode('employee').map((t) => t.name);
const PROJECTS = { projects: [{ id: 30, name: 'Хан-Уул сургууль', progress: 41.2 }, { id: 37, name: 'Evergreen', progress: 88 }], active_count: 2, total_visible: 2 };
const DEADLINES = { count: 2, projects: [{ id: 30, name: 'Хан-Уул сургууль', days_remaining: 12, finish_date: '2026-09-23' }, { id: 37, name: 'Evergreen', days_remaining: 40 }] };

/** Нэг ээлж: төлөвлө → (хуурамч хэрэгсэл) → төлөв урагшлуул. */
function turn(question, state, seq, toolData = {}) {
  const plan = planTurn({ question, rawState: state, seq, visibleTools: VISIBLE });
  const research = planResearch({ question, plan, mode: 'employee', visibleTools: VISIBLE, round: 0, prior: [], maxTools: 8 });
  const toolResults = research.tools.map((t) => ({ tool: t.name, ok: t.name in toolData, data: toolData[t.name] ?? null, error: t.name in toolData ? null : 'not stubbed' }));
  const next = advanceState({ state: plan.state, turn: plan.turn, toolResults, seq, question });
  return { plan, research, toolResults, next };
}

test('сэдэв солилт: Revit → компани → ерөнхий — хуучин сэдэв/хэрэгсэл гоожихгүй', () => {
  let state = null;
  const t1 = turn('Revit дээр сонгосон ханын талбай хэд вэ?', state, 0);
  assert.equal(t1.plan.turn.intent, 'REVIT_READ');
  assert.equal(t1.research.tools.length, 0, 'Revit асуултад ERP хэрэгсэл орсон');
  state = t1.next;

  const t2 = turn('Хамгийн ойрхон дуусах төсөл аль вэ?', state, 1, { get_upcoming_deadlines: DEADLINES });
  assert.equal(t2.plan.turn.kind, 'NEW_TOPIC', `Revit-ийн дараах компанийн асуулт шинэ сэдэв байх ёстой (${t2.plan.turn.reason})`);
  assert.ok(t2.research.tools.some((t) => t.name === 'get_upcoming_deadlines'));
  assert.equal(t2.next.subject?.id, 30, '«хамгийн ойрхон» → эхний төсөл сэдэв болно');
  state = t2.next;

  const t3 = turn('Чи ямар model ашигладаг вэ?', state, 2);
  assert.equal(t3.plan.turn.intent, 'META');
  assert.equal(t3.research.tools.length, 0, 'мета асуултад төслийн хэрэгсэл чирэгдсэн');
  assert.equal(subjectLine(t3.plan.turn), null, 'мета асуултад сэдвийн мөр орсон');
  const turns = assembleTurns({ system: { mode: 'employee', subjectLine: subjectLine(t3.plan.turn), intent: 'META' }, history: selectHistory([{ role: 'user', content: t2.plan.turn.tasks[0].text }, { role: 'assistant', content: 'Хан-Уул сургууль, 12 хоног үлдсэн.' }], t3.plan.turn), question: t3.plan.turn.tasks[0].text, evidence: [] });
  const all = turns.map((t) => t.content).join('\n');
  assert.ok(!all.includes('Хан-Уул'), 'өмнөх сэдвийн төсөл мета асуултын prompt-д орсон');
});

test('үргэлжлэл: «deadline?» → «Хариуцсан хүн нь?» — сэдэв хадгалагдаж, тэр төслийн хэрэгсэл дуудагдана', () => {
  const t1 = turn('Хан-Уул сургууль төслийн deadline хэзээ вэ?', null, 0, { list_projects: PROJECTS, get_upcoming_deadlines: DEADLINES });
  const t2 = turn('Хариуцсан хүн нь хэн бэ?', t1.next, 1, { get_project_progress: { id: 30, name: 'Хан-Уул сургууль', progress_percent: 41 } });
  assert.notEqual(t2.plan.turn.kind, 'NEW_TOPIC', `үргэлжлэл алдагдав (${t2.plan.turn.reason})`);
  assert.equal(t2.plan.turn.subject?.id, 30, 'сэдэв солигдов');
  const line = subjectLine(t2.plan.turn);
  assert.ok(line && line.includes('Хан-Уул'), 'сэдвийн мөр байхгүй');
});

test('«яагаад удаад байна?» → тухайн төслийн analyze_project (list_projects хасагдана)', () => {
  const t1 = turn('Хамгийн ойрхон deadline-тай төсөл аль вэ?', null, 0, { get_upcoming_deadlines: DEADLINES });
  const t2 = turn('Яагаад удаад байна?', t1.next, 1);
  assert.ok(t2.research.tools.some((t) => t.name === 'analyze_project' && t.args.project_id === 30), `analyze_project(30) алга: ${t2.research.tools.map((t) => t.name).join(',')}`);
  assert.ok(!t2.research.tools.some((t) => t.name === 'list_projects'));
});

test('өмнөх БУРУУ хариулт (481 төсөл) баримт болохгүй — гэрээ түүхээс тоо авахгүй, шинэ хэрэгсэл дуудагдана', () => {
  const history = [
    { role: 'user', content: 'Хэдэн төсөл байна?' },
    { role: 'assistant', content: 'Манай компанид 481 төсөл байна.' },
  ];
  const t = turn('Тэгвэл идэвхтэй нь хэд вэ?', { version: 1, subject: null, subjectSetAtSeq: -1, lastIntent: 'COMPANY_FACT', lastTools: ['list_projects'], lastQuestion: 'Хэдэн төсөл байна?', lastSeq: 0, projectsSeen: [] }, 1, { list_projects: PROJECTS });
  assert.ok(t.research.tools.some((x) => x.name === 'list_projects'), 'хэрэгсэл ДАХИН дуудагдах ёстой — түүхийн тоо биш');
  const c = applyGroundingGuard(
    buildTrustedContract({ regulatory: false, evidenceCount: 0, normDecision: null, responseLanguage: 'mn-Cyrl', normTaskIndex: null, taskCount: 1, localNorm: null, metricNote: null, toolResults: t.toolResults, intent: t.plan.turn.intent, retrievalNoMatch: false }),
    { intent: t.plan.turn.intent, toolResults: t.toolResults, revitContextPresent: false, responseLanguage: 'mn-Cyrl' },
  );
  assert.ok(c.allowedNumbers !== null && !c.allowedNumbers.includes(481), '481 зөвшөөрөгдсөн тоонд орсон');
  const sel = selectHistory(history, t.plan.turn);
  // Түүх орсон ч (үргэлжлэл) — тоо нь гэрээгээр хасагдана; түүхийн assistant мөр тайрагдсан
  assert.ok(sel.every((m) => m.content.length <= 1200));
});

test('норм асуулт → төслийн сэдэв ЦЭВЭРЛЭГДЭНЭ (гоожилтын хоёр дахь хаалга)', () => {
  const t1 = turn('Хамгийн ойрхон deadline-тай төсөл аль вэ?', null, 0, { get_upcoming_deadlines: DEADLINES });
  assert.equal(t1.next.subject?.id, 30);
  const t2 = turn('В2 галын ачаалал хэдээс хэд вэ?', t1.next, 1);
  assert.equal(t2.plan.turn.kind, 'NEW_TOPIC');
  assert.equal(subjectLine(t2.plan.turn), null);
  assert.equal(t2.research.tools.length, 0, 'нормын асуултад ERP хэрэгсэл орсон');
  assert.equal(t2.next.subject, null, 'нормын ээлжийн дараа төслийн сэдэв үлдсэн');
});

test('сэдэв TTL: 6 ээлж хэрэглэгдээгүй сэдэв унтарна', () => {
  const t1 = turn('Хамгийн ойрхон deadline-тай төсөл аль вэ?', null, 0, { get_upcoming_deadlines: DEADLINES });
  let state = t1.next;
  for (let i = 1; i <= SUBJECT_TTL_TURNS + 1; i++) state = turn('Сайн уу', state, i).next;
  const late = turn('Яагаад удаад байна?', state, SUBJECT_TTL_TURNS + 2);
  assert.ok(!late.research.tools.some((t) => t.name === 'analyze_project'), 'хуучирсан сэдвийн төсөл дахин амилав');
});

/* ── §15 урт яриа ─────────────────────────────────────────────── */
function longConversation(turnsN) {
  const history = [];
  for (let i = 0; i < turnsN; i++) {
    history.push({ role: 'user', content: `Асуулт ${i}: Төсөл ${i % 7} ямар байна? ${'дэлгэрэнгүй '.repeat(20)}` });
    history.push({ role: 'assistant', content: `Хариулт ${i}. ${'Энэ төслийн явц сайн байна, ажилтнууд идэвхтэй ажиллаж байна. '.repeat(25)}` });
  }
  return history;
}

for (const n of [50, 100]) {
  test(`${n} ээлж: prompt хязгаарлагдмал, түүх ≤ 2 мессеж (FOLLOW_UP) эсвэл 0 (NEW_TOPIC), кирилл ≤ 8K токенд багтана`, () => {
    const history = longConversation(n);
    const state = { version: 1, subject: { kind: 'project', id: 30, name: 'Хан-Уул сургууль' }, subjectSetAtSeq: 2 * n - 1, lastIntent: 'COMPANY_FACT', lastTools: ['get_project_progress'], lastQuestion: 'x', lastSeq: 2 * n - 1, projectsSeen: [{ id: 30, name: 'Хан-Уул сургууль' }] };
    for (const [q, kindExpected] of [['Яагаад удаад байна?', 'FOLLOW_UP'], ['В2 галын ачаалал хэд вэ?', 'NEW_TOPIC']]) {
      const plan = planTurn({ question: q, rawState: state, seq: 2 * n, visibleTools: VISIBLE });
      assert.equal(plan.turn.kind, kindExpected, `${q}: ${plan.turn.reason}`);
      const sel = selectHistory(history, plan.turn);
      assert.ok(sel.length <= 2, `түүх ${sel.length} мессеж`);
      const turns = assembleTurns({ system: { mode: 'employee', subjectLine: subjectLine(plan.turn), intent: plan.turn.intent, regulatory: plan.regulatory, evidenceMandatory: plan.turn.policy.evidenceMandatory }, history: sel, question: q, evidence: [], regulatory: plan.regulatory });
      const chars = turns.reduce((a, t) => a + t.content.length, 0);
      // кирилл ~2.2 тэмдэгт/токен; 8K цонх − 1024 max_tokens − 256 SAFETY ≈ 6.9K токен ≈ 15K тэмдэгт
      assert.ok(chars < 15000, `${n} ээлж → prompt ${chars} тэмдэгт (хэт урт)`);
      console.log(`    ↳ ${n} ээлж · «${q}» → kind=${plan.turn.kind}, түүх ${sel.length}, prompt ${chars} тэмдэгт`);
    }
  });
}

test('parseConvState: гажуудсан/хэт урт төлөв унагахгүй, projectsSeen ≤ 40', () => {
  const huge = { version: 1, subject: { kind: 'project', id: 1, name: 'x'.repeat(5000) }, subjectSetAtSeq: 0, lastIntent: 'HACK', lastTools: Array(100).fill('list_projects'), lastQuestion: 'q'.repeat(9000), lastSeq: 0, projectsSeen: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `p${i}` })) };
  const plan = planTurn({ question: 'Сайн уу', rawState: huge, seq: 1, visibleTools: VISIBLE });
  assert.ok(plan.state.projectsSeen.length <= 40, `projectsSeen ${plan.state.projectsSeen.length}`);
  assert.ok(plan.state.lastTools.length <= 8);
  assert.ok((plan.state.subject?.name ?? '').length <= 300, 'сэдвийн нэр хязгааргүй');
});
