// Хөрвүүлэлтээр нэгтгэгдсэн (retired) хэсэг төслийн шатлалд ОРОХГҮЙ (2026-10-05).  Блок/зургийн картын тоо, график, багийн
// статистик, захиалагчийн тайлан, MCP бүгд `getProjectHierarchyFast`-аас авдаг тул ганц эх сурвалжид шүүнэ.
// БОДИТ схем (репогийн БҮХ миграц) — гараар бичсэн хялбаршуулсан хүснэгт биш.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { makeRealSchema } from '../../test-support/realSchema.ts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});
const { getProjectHierarchyFast } = await import('./projects.ts');

function d1(db: DatabaseSync): D1Database {
  const prepare = (sql: string, params: unknown[] = []) => ({
    bind: (...a: unknown[]) => prepare(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...(params as never[])) }),
    first: async () => db.prepare(sql).get(...(params as never[])) ?? null,
  });
  return { prepare } as unknown as D1Database;
}

function seed(db: DatabaseSync) {
  db.exec(`
    INSERT INTO projects (id, name, status) VALUES (10, 'P', 'active');
    INSERT INTO blocks (id, project_id, name, weight_percent) VALUES (1, 10, 'B', 100);
    INSERT INTO drawings (id, block_id, name, weight_percent) VALUES (1, 1, 'BA-01', 100);
    INSERT INTO components (id, drawing_id, name) VALUES (1, 1, 'C');
    INSERT INTO tasks (id, component_id, name, weight_percent, sort_order) VALUES (501, 1, 'Фасад', 40, 1), (502, 1, 'Фасад (2/2)', 0, 2), (503, 1, 'Бусад', 20, 3);
  `);
}
const taskIds = async (db: DatabaseSync) => {
  const blocks = await getProjectHierarchyFast(d1(db), 10);
  const out: number[] = [];
  for (const b of blocks) for (const d of b.drawings) for (const c of d.components) for (const t of c.tasks) out.push(t.id);
  return out.sort((a, b) => a - b);
};

test('нэгтгэгдсэн (applied) хэсэг шатлалд ОРОХГҮЙ; root, бусад таск харагдана; буцаагдсан (reverted) хөрвүүлэлтийн хэсэг дахин харагдана', async () => {
  const { sqlite } = makeRealSchema();
  seed(sqlite);
  assert.deepEqual(await taskIds(sqlite), [501, 502, 503]);
  sqlite.exec(`
    INSERT INTO task_conversions (id, root_task_id, project_id, drawing_id, status, evidence, classification, plan_hash, plan_json, rollup_before, rollup_after)
      VALUES ('cv-1', 501, 10, 1, 'applied', 'declared_group', 'proven_split', 'h', '{}', 0, 0);
    INSERT INTO task_conversion_members (task_id, conversion_id, role, name_before, weight_before, weight_after) VALUES (501, 'cv-1', 'root', 'Фасад (1/2)', 20, 40), (502, 'cv-1', 'retired', 'Фасад (2/2)', 20, 0);
  `);
  assert.deepEqual(await taskIds(sqlite), [501, 503], 'applied → retired хэсэг харагдахгүй');
  sqlite.exec("UPDATE task_conversions SET status = 'reverted' WHERE id = 'cv-1'");
  assert.deepEqual(await taskIds(sqlite), [501, 502, 503], 'reverted → дахин харагдана');
});
