/**
 * MGL AI · ХЭРЭГСЛИЙН ҮР ДҮНГИЙН ТӨСӨВ — ТЕСТ (§36).
 *
 * Run with:  node --test src/lib/mglai/toolBudget.test.ts
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

const { budgetToolResults, shrinkData } = await import('./toolBudget.ts');

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, name: `Даалгавар ${i} — урт нэр урт нэр`, project_name: 'MGL-260226_MITIC_AZ', progress: i }));

test('төсөвт багтаж байвал ижил объект, тайралтгүй', () => {
  const r = budgetToolResults([{ ok: true, data: { rows: rows(3) } }], 10_000);
  assert.equal(r.truncated, false);
  assert.equal(r.before, r.after);
});

test('том массив БҮТЭЦТЭЙ богиносно — JSON хүчинтэй, _truncated ил', () => {
  const r = budgetToolResults([{ ok: true, data: { entity: 'tasks', rows: rows(60), total_matching: 60 } }], 1500);
  assert.equal(r.truncated, true);
  const d = r.results[0]!.data as { rows: unknown[]; _truncated: { rows: { shown: number; total: number } }; total_matching: number };
  assert.ok(d.rows.length < 60 && d.rows.length >= 3);
  assert.equal(d._truncated.rows.total, 60);
  assert.equal(d._truncated.rows.shown, d.rows.length);
  assert.equal(d.total_matching, 60, 'бусад талбар хэвээр');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(d)));
  assert.ok(r.after <= 1500 * 1.2, `${r.after}`);
});

test('жижиг үр дүн хэвээр, том нь үлдсэн төсвийг хуваана', () => {
  const small = { ok: true, data: { total_active: 57 } };
  const big1 = { ok: true, data: { rows: rows(80) } };
  const big2 = { ok: true, data: { projects: rows(80) } };
  const r = budgetToolResults([small, big1, big2], 3000);
  assert.deepEqual(r.results[0]!.data, { total_active: 57 });
  assert.ok((r.results[1]!.data as { rows: unknown[] }).rows.length < 80);
  assert.ok((r.results[2]!.data as { projects: unknown[] }).projects.length < 80);
});

test('урт мөр богиносно; массиваас өөр бүтэц эвдрэхгүй', () => {
  const s = shrinkData({ text: 'x'.repeat(2000), n: 1 }, 500);
  assert.ok((s.data as { text: string }).text.length <= 302);
  assert.equal((s.data as { n: number }).n, 1);
  const arr = shrinkData(rows(50), 800);
  const d = arr.data as { rows: unknown[]; _truncated: { total: number } };
  assert.equal(d._truncated.total, 50);
});
