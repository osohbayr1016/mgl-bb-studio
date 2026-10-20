/**
 * HUMAN-40 v2 static routing regression.
 *
 * These are the exact prompts from the 2026-10-04 employee audit. They are
 * intentionally held out from SFT. This suite verifies the deterministic
 * serving layer before any model generation: intent, norm route and ERP
 * isolation. Content quality remains a model/candidate evaluation concern.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './production-readiness/lib/load.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(HERE, 'human40-v2-cases.json'), 'utf8'));
const { planTurn } = await loadBackend('turnPlan.ts');
const { planResearch } = await loadBackend('researchPlan.ts');
const { toolsForMode } = await loadBackend('tools/registry.ts');
const VISIBLE = toolsForMode('employee').map((t) => t.name);
const ERP_TOOLS = new Set([
  'get_active_employees','get_employee_activity','list_projects',
  'get_project_progress','analyze_project','get_upcoming_deadlines',
  'get_overdue_tasks','get_my_assignments','describe_system','query_entities',
]);

test('HUMAN-40 v2 contains exactly 40 blind cases', () => {
  assert.equal(cases.length, 40);
  assert.equal(new Set(cases.map((c) => c.id)).size, 40);
});

for (const c of cases) {
  test(`${c.id} · ${c.category}`, () => {
    const q = c.turns[0].q;
    const plan = planTurn({ question: q, rawState: null, seq: 0, visibleTools: VISIBLE });
    assert.equal(plan.turn.intent, c.intent, `${q} → ${plan.turn.intent} (${plan.turn.reason})`);

    const research = planResearch({
      question: q, plan, mode: 'employee', visibleTools: VISIBLE,
      round: 0, prior: [], maxTools: 8,
    });
    const liveTools = [...plan.tools, ...research.tools];
    const erp = liveTools.filter((t) => ERP_TOOLS.has(t.name));

    if (c.intent === 'GENERAL_HELP') {
      assert.equal(plan.askLocalNorm, false, 'general AEC advice must not force norm retrieval');
      assert.deepEqual(erp, [], `general AEC advice leaked ERP tools: ${erp.map((t) => t.name).join(', ')}`);
    }
    if (c.intent === 'NORMATIVE') {
      assert.equal(plan.askLocalNorm, true, 'normative question must use local norm retrieval');
      assert.deepEqual(erp, [], `normative question leaked ERP tools: ${erp.map((t) => t.name).join(', ')}`);
    }
    if (c.intent === 'REVIT_READ') {
      assert.equal(plan.askLocalNorm, false);
      assert.deepEqual(erp, [], `Revit read leaked ERP tools: ${erp.map((t) => t.name).join(', ')}`);
    }
  });
}
