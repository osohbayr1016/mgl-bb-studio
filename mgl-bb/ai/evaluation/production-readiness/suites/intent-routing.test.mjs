/**
 * MGL AI · HELD-OUT INTENT + TOOL ROUTING SUITE (Session C, 2026-09-11).
 *
 *   node --test ai/evaluation/production-readiness/suites/intent-routing.test.mjs
 *
 * ⚠️ ЯГ ЮУГ ХАМГААЛЖ БАЙНА ВЭ.  Ангилал (`classifyIntent`) + хэл (`detectLanguage`)
 *    + хэрэгслийн төлөвлөгөө ЖИНХЭНЭ `/plan` замаар (`planTurn` → `planResearch`,
 *    employee горим).  Хэмжигдсэн (2026-09-11, засварын ӨМНӨ): 29 асуултын 17 нь
 *    буруу; «Ажилтны тоо» → tasks entity (буруу итгэмжлэгдсэн домэйн).
 *
 *    Тест бүр НЭГ асуулт.  `known_gap` тэмдэгтэй асуулт `todo` — ажиллана,
 *    тоологдоно, гэвч унагахгүй; засагдвал «хасах цаг болсон» гэж хэлнэ.
 *
 *    Төгсгөлд confusion matrix (хүлээсэн ↔ гарсан) console-д.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from '../lib/load.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(HERE, '..', 'cases', 'intent-routing.json'), 'utf8'));

const { planTurn } = await loadBackend('turnPlan.ts');
const { planResearch } = await loadBackend('researchPlan.ts');
const { toolsForMode } = await loadBackend('tools/registry.ts');
const VISIBLE = toolsForMode('employee').map((t) => t.name);

/** Хэрэгслийн нэр + entity → бүл. */
function familiesOf(tools, plan) {
  const out = new Set();
  for (const t of tools) {
    const entity = t.args?.query?.entity;
    if (t.name === 'get_active_employees') out.add('employees');
    else if (t.name === 'get_employee_activity') out.add('activity');
    else if (t.name === 'list_projects' || t.name === 'get_project_progress' || t.name === 'analyze_project' || t.name === 'get_upcoming_deadlines') out.add('projects');
    else if (t.name === 'get_overdue_tasks' || t.name === 'get_my_assignments') out.add('tasks');
    else if (t.name === 'describe_system') out.add('system');
    else if (t.name === 'query_entities') out.add(entity ?? 'query');
    else out.add(t.name);
  }
  if (plan.askLocalNorm) out.add('norm');
  if (out.size === 0) out.add('none');
  return out;
}

export function routeQuestion(q) {
  const plan = planTurn({ question: q, rawState: null, seq: 0, visibleTools: VISIBLE });
  const research = planResearch({ question: q, plan, mode: 'employee', visibleTools: VISIBLE, round: 0, prior: [], maxTools: 8 });
  return {
    intent: plan.turn.intent,
    kind: plan.turn.kind,
    lang: plan.lang.language,
    respLang: plan.lang.responseLanguage,
    norm: plan.askLocalNorm,
    regulatory: plan.regulatory,
    tools: research.tools,
    families: familiesOf(research.tools, plan),
    reason: plan.turn.reason,
  };
}

const matrix = new Map(); // expected(first) → Map(actual → n)
let gapsOpen = 0;
let gapsFixed = 0;

for (const c of cases) {
  const name = `${c.known_gap ? '[gap] ' : ''}«${c.q}»`;
  const run = () => {
    const r = routeQuestion(c.q);
    const exp = c.intent[0];
    if (!matrix.has(exp)) matrix.set(exp, new Map());
    matrix.get(exp).set(r.intent, (matrix.get(exp).get(r.intent) ?? 0) + 1);

    const errors = [];
    if (!c.intent.includes(r.intent)) errors.push(`intent ${r.intent} ∉ [${c.intent.join('|')}] (${r.reason})`);
    if (c.notIntent && c.notIntent.includes(r.intent)) errors.push(`intent ${r.intent} хориотой`);
    if (c.norm !== undefined && r.norm !== c.norm) errors.push(`askLocalNorm=${r.norm}, хүлээсэн ${c.norm}`);
    if (c.family) {
      const ok = c.family.split('|').some((f) => r.families.has(f));
      if (!ok) errors.push(`family [${[...r.families].join(',')}] ∌ ${c.family} (tools: ${r.tools.map((t) => t.name).join(',') || '—'})`);
    }
    if (c.notFamily) for (const f of c.notFamily) if (r.families.has(f)) errors.push(`family ${f} хориотой (tools: ${r.tools.map((t) => t.name).join(',')})`);
    if (c.lang && !c.lang.split('|').includes(r.lang)) errors.push(`lang ${r.lang} ≠ ${c.lang}`);
    if (c.respLang && r.respLang !== c.respLang) errors.push(`respLang ${r.respLang} ≠ ${c.respLang}`);
    if (c.multi && r.kind !== 'MULTI_INTENT') errors.push(`kind ${r.kind} ≠ MULTI_INTENT`);
    return errors;
  };

  if (c.known_gap) {
    test(name, { todo: c.known_gap }, () => {
      const errors = run();
      if (errors.length === 0) {
        gapsFixed += 1;
        console.log(`    ↳ ЗАСАГДСАН — known_gap тэмдгийг хас: ${c.known_gap}`);
      } else {
        gapsOpen += 1;
        console.log(`    ↳ нээлттэй: ${errors.join('; ')}`);
      }
    });
  } else {
    test(name, () => {
      const errors = run();
      assert.deepEqual(errors, [], errors.join('; '));
    });
  }
}

test('confusion matrix (мэдээлэл)', () => {
  const intents = [...new Set([...matrix.keys(), ...[...matrix.values()].flatMap((m) => [...m.keys()])])].sort();
  const w = 18;
  console.log(`\n  хүлээсэн\\гарсан ${intents.map((i) => i.slice(0, 8).padStart(9)).join('')}`);
  for (const exp of intents) {
    const row = matrix.get(exp) ?? new Map();
    console.log(`  ${exp.padEnd(w)}${intents.map((a) => String(row.get(a) ?? '').padStart(9)).join('')}`);
  }
  console.log(`  known_gap: нээлттэй ${gapsOpen}, засагдсан ${gapsFixed}\n`);
});
