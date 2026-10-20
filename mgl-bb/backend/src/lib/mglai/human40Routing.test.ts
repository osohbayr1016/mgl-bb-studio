/**
 * HUMAN-40 v2 routing regression.
 *
 * Exact benchmark prompts stay blind for model training, but deterministic routing
 * must be locked: general AEC advice must not leak into ERP, live Revit facts need
 * Revit context, and actual regulatory questions stay retrieval-first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const HERE = dirname(fileURLToPath(import.meta.url));
const { classifyIntent } = await import('./intent.ts');
const { planTurn } = await import('./turnPlan.ts');
const { planResearch } = await import('./researchPlan.ts');
const { toolsForMode } = await import('./tools/registry.ts');

const bench = JSON.parse(
  readFileSync(join(HERE, '..', '..', '..', '..', 'ai', 'evaluation', 'human40-v2-cases.json'), 'utf8'),
);
const VISIBLE = toolsForMode('employee').map((t) => t.name);
const ERP_TOOLS = new Set([
  'get_active_employees',
  'get_employee_activity',
  'list_projects',
  'get_upcoming_deadlines',
  'get_overdue_tasks',
  'get_my_assignments',
  'get_project_progress',
  'analyze_project',
  'describe_system',
]);

for (const c of bench.cases) {
  const q = c.turns[0].q;
  test(`HUMAN40 route ${c.id} · ${q.slice(0, 56)}`, () => {
    const r = classifyIntent(q);
    assert.equal(r.intent, c.intent, `${c.id}: ${r.intent} — ${r.reason}`);

    const p = planTurn({ question: q, rawState: null, seq: 0, visibleTools: VISIBLE });
    const names = p.tools.map((t) => t.name);
    if (c.intent === 'GENERAL_HELP' || c.intent === 'NORMATIVE' || c.intent === 'REVIT_READ') {
      const leaked = names.filter((n) => ERP_TOOLS.has(n));
      assert.deepEqual(leaked, [], `${c.id}: ERP tool leaked into ${c.intent}: ${leaked.join(', ')}`);

      const research = planResearch({
        question: q,
        plan: p,
        mode: 'employee',
        visibleTools: VISIBLE,
        round: 0,
        prior: [],
        maxTools: 8,
      });
      const researchLeaked = research.tools.map((t) => t.name).filter((n) => ERP_TOOLS.has(n));
      assert.deepEqual(
        researchLeaked,
        [],
        `${c.id}: ERP research leaked into ${c.intent}: ${researchLeaked.join(', ')}`,
      );
    }
    if (c.intent === 'NORMATIVE') {
      assert.equal(p.regulatory, true, `${c.id}: normative route lost regulatory guard`);
      assert.equal(p.askLocalNorm, true, `${c.id}: normative route did not request local norm retrieval`);
    }
    if (c.intent === 'REVIT_READ') {
      assert.equal(r.policy.needsRevit, true, `${c.id}: live Revit fact must require context`);
    }
  });
}

test('HUMAN40 keeps real ERP questions working after bare-project isolation', () => {
  const checks = [
    ['Хэдэн төсөл идэвхтэй байна?', 'COMPANY_FACT'],
    ['ene project yagaad udaad bna', 'ERP_ANALYSIS'],
    ['миний даалгавар юу байна', 'COMPANY_FACT'],
    ['хамгийн ойр deadline-тай төсөл аль вэ', 'COMPANY_FACT'],
  ];
  for (const [q, intent] of checks) assert.equal(classifyIntent(q).intent, intent, q);
});
