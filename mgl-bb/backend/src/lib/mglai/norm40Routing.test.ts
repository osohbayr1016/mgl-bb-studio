/**
 * NORM-40 routing + ERP/Revit isolation (NORM-INTEL v3, 2026-10-04).
 *
 * The exact prompts live in `ai/evaluation/norm40-v1-cases.json` and stay OUT of SFT train/val.
 * This suite asserts SAFETY PROPERTIES of the deterministic serving layer (no model involved):
 *   · every norm question reaches the normative route (retrieval-first, evidence mandatory);
 *   · a norm-only turn can never summon an ERP/Revit tool — neither the planner nor the research planner;
 *   · overloaded AEC words (төсөл, ачаалал, ажилтан, deadline, манай…) inside an engineering sentence do not
 *     turn it into an ERP question;
 *   · a mixed message keeps tasks separated: each task only gets its own tools/evidence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const HERE = dirname(fileURLToPath(import.meta.url));
const { classifyIntent } = await import('./intent.ts');
const { planTurn } = await import('./turnPlan.ts');
const { planResearch } = await import('./researchPlan.ts');
const { toolsForMode } = await import('./tools/registry.ts');
const { classifyNormQuestion, NORM_QUESTION_SUBTYPES, detectNormTopics } = await import('./norm/questionKind.ts');
const { isNormOnlyTurn } = await import('./turnPlan.ts');

const bench = JSON.parse(readFileSync(join(HERE, '..', '..', '..', '..', 'ai', 'evaluation', 'norm40-v1-cases.json'), 'utf8'));
const VISIBLE = toolsForMode('employee').map((t) => t.name);
const ERP_TOOLS = new Set([
  'get_active_employees', 'get_employee_activity', 'list_projects', 'get_upcoming_deadlines', 'get_overdue_tasks',
  'get_my_assignments', 'get_project_progress', 'analyze_project', 'describe_system', 'query_entities',
]);
const REVIT_TOOLS = new Set(VISIBLE.filter((n) => /^revit|^get_revit|^list_revit/i.test(n)));

function liveTools(q: string, plan: ReturnType<typeof planTurn>): string[] {
  const research = planResearch({ question: q, plan, mode: 'employee', visibleTools: VISIBLE, round: 0, prior: [], maxTools: 8 });
  return [...plan.tools.map((t) => t.name), ...research.tools.map((t) => t.name)];
}

test('NORM-40 contains exactly 40 blind cases with unique ids and valid subtypes', () => {
  assert.equal(bench.cases.length, 40);
  assert.equal(new Set(bench.cases.map((c: { id: string }) => c.id)).size, 40);
  for (const c of bench.cases) {
    for (const s of c.acceptable_subtypes) assert.ok((NORM_QUESTION_SUBTYPES as readonly string[]).includes(s), `${c.id}: bad subtype ${s}`);
  }
});

for (const c of bench.cases) {
  const q: string = c.turns[0].q;
  test(`NORM40 route ${c.id} · ${q.slice(0, 50)}`, () => {
    const r = classifyIntent(q);
    assert.equal(r.intent, 'NORMATIVE', `${c.id}: ${r.intent} — ${r.reason}`);
    assert.equal(r.policy.evidenceMandatory, true);
    assert.equal(r.policy.needsErpTools, false);

    const p = planTurn({ question: q, rawState: null, seq: 0, visibleTools: VISIBLE });
    assert.equal(p.regulatory, true, `${c.id}: lost the regulatory guard`);
    assert.equal(p.askLocalNorm, true, `${c.id}: did not request norm retrieval`);

    const tools = liveTools(q, p);
    assert.deepEqual(tools.filter((n) => ERP_TOOLS.has(n)), [], `${c.id}: ERP tool leaked into a norm-only turn`);
    assert.deepEqual(tools.filter((n) => REVIT_TOOLS.has(n)), [], `${c.id}: Revit tool leaked into a norm-only turn`);

    const k = classifyNormQuestion(q);
    assert.ok(c.acceptable_subtypes.includes(k.subtype), `${c.id}: subtype ${k.subtype} not in ${c.acceptable_subtypes.join('/')}`);
  });
}

test('overloaded AEC words in an engineering sentence never summon ERP', () => {
  const qs = [
    'Манай төслийн өндөр барилгад эвакуацын шатны өргөн хэд байх ёстой вэ?',
    'Өндөр барилгын ачааллыг тооцохдоо шатны хонгилд утаа хамгаалалт заавал хэрэгтэй юу?',
    'Ажилтнуудын гарах замын коридорын хамгийн бага өргөн хэд вэ?',
    'Deadline дөхөж байна, Firefighter lift-д ямар шаардлага тавигддаг вэ?',
    'Манай компанийн зураг төсөлд fire door-ын EI ангиллыг юугаар сонгох вэ?',
    'tosliin dead-end corridor-iin hyazgaarlalt yamar baidag ve',
  ];
  for (const q of qs) {
    const r = classifyIntent(q);
    assert.equal(r.intent, 'NORMATIVE', `${q} → ${r.intent} (${r.reason})`);
    const p = planTurn({ question: q, rawState: null, seq: 0, visibleTools: VISIBLE });
    assert.deepEqual(liveTools(q, p).filter((n) => ERP_TOOLS.has(n) || REVIT_TOOLS.has(n)), [], q);
  }
});

test('real ERP and general-advice questions are NOT captured by the norm-topic rule', () => {
  const erp: Array<[string, string]> = [
    ['Өндөр барилгын төслийн явц хэд хувьтай байна?', 'COMPANY_FACT'],
    ['Коридорын зургийн даалгавар хэн дээр байна?', 'COMPANY_FACT'],
    ['Хэн хэн коридорын зураг дээр ажиллаж байна?', 'COMPANY_FACT'],
  ];
  for (const [q, want] of erp) {
    const r = classifyIntent(q);
    assert.notEqual(r.intent, 'NORMATIVE', `${q} → ${r.intent} (${r.reason})`);
    assert.ok(r.intent === want || r.intent === 'ERP_ANALYSIS' || r.intent === 'GENERAL_HELP', `${q} → ${r.intent}`);
  }
  // Design-reasoning "why" question about a regulated topic, with no norm word, stays engineering advice.
  const advice = 'Өндөр барилгын усан хангамжийг яагаад бүс болгон хуваадаг вэ?';
  assert.notEqual(classifyIntent(advice).intent, 'NORMATIVE');
});

test('a mixed message keeps tasks separated: ERP task gets ERP tools, norm task gets none', () => {
  const q = 'Эвакуацын шатны хамгийн бага өргөн хэд вэ? Мөн хэдэн идэвхтэй төсөл байна?';
  const p = planTurn({ question: q, rawState: null, seq: 0, visibleTools: VISIBLE });
  assert.equal(p.turn.tasks.length, 2);
  const normIdx = p.turn.tasks.findIndex((t) => t.domain === 'norm');
  const erpIdx = p.turn.tasks.findIndex((t) => t.domain === 'erp');
  assert.ok(normIdx >= 0 && erpIdx >= 0, p.turn.tasks.map((t) => `${t.domain}:${t.text}`).join(' | '));
  assert.ok(p.normTask && !/идэвхтэй төсөл/u.test(p.normTask.text), 'the norm task text must not carry the ERP clause');
  assert.ok(p.tools.some((t) => ERP_TOOLS.has(t.name)), 'the explicit ERP task must still get its own tool');
  assert.equal(p.regulatory, true);
});

test('norm-only turn drops Revit/ERP context; a mixed message does not', () => {
  const norm = planTurn({ question: 'Firefighter lift-д ямар шаардлагууд тавигддаг вэ?', rawState: null, seq: 0, visibleTools: VISIBLE });
  assert.equal(isNormOnlyTurn(norm.turn), true);
  const mixed = planTurn({ question: 'Эвакуацын шатны хамгийн бага өргөн хэд вэ? Мөн хэдэн идэвхтэй төсөл байна?', rawState: null, seq: 0, visibleTools: VISIBLE });
  assert.equal(isNormOnlyTurn(mixed.turn), false);
  const erp = planTurn({ question: 'Хэдэн идэвхтэй төсөл байна?', rawState: null, seq: 0, visibleTools: VISIBLE });
  assert.equal(isNormOnlyTurn(erp.turn), false);
});

test('"шат" as a design STAGE (эскизийн шат, ажлын зургийн шат, concept шатанд) is not the stair topic', () => {
  for (const q of ['Эскиз зургийн шат юуг шийддэг вэ?', 'Ажлын зургийн шат хэзээ эхэлдэг вэ?', 'Хоёр үе шаттай төлөвлөлт гэж юу вэ?']) {
    assert.deepEqual(detectNormTopics(q).filter((t: string) => t === 'stairs'), [], q);
    assert.notEqual(classifyIntent(q).intent, 'NORMATIVE', q);
  }
  assert.ok(detectNormTopics('Өндөр барилгад хэдэн шат төлөвлөх ёстой вэ?').includes('stairs'));
});

test('yes/no design questions that merely mention a regulated topic stay engineering advice', () => {
  for (const q of ['Fire door тавьсан бол асуудал дууссан гэж үзэж болох уу?', 'Өндөр барилгын баганын хэмжээг зөвхөн давхарын тоогоор ерөнхийлөөд хэлж болох уу?', 'Өрөөний хэмжээ зөв харагдаж байгаа ч ашиглахад эвгүй байвал юуг шалгах вэ?']) {
    assert.notEqual(classifyIntent(q).intent, 'NORMATIVE', q);
  }
});
