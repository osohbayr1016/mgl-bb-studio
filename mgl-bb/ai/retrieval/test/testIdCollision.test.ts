/**
 * GAP-026 — тестийн id ДЭЛХИЙН хэмжээнд тогтвортой: `<doc_id>::<test_id>`.
 *
 * Хэмжсэн (2026-09-14, Session C lint): 13 багцын түүхий id (RET-0001, Q001, B001 …) 481 бүлэгт
 * баримт хооронд давхцдаг.  Угтваргүй бол сүүлд шингээсэн багц өмнөхийг ЧИМЭЭГҮЙ дардаг
 * (`INSERT OR REPLACE`).  Энэ тест (1) багц доторх давхардлыг алдаа болгож, (2) ЭНЭ МАШИНД
 * байгаа БҮХ багцыг нэг санд оруулаад id бүр угтвартай, давхцалгүй, мөр алдагдаагүйг батална.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset, assertUniqueIds } from '../src/ingest.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', 'data-train-files');
/** Адаптергүй/хагас багцууд — `ai:ingest:norm` ч тэднийг алгасдаг (CLAUDE.md). */
const SKIP = new Set(['MCIS_MGL_AI_BNbD_11-106-25_GOLD_v3_SOURCED_COMPLETE', 'MGL_AI_BNbD_11_03_02_dataset', 'MCIS_MGL_AI_BNbD_11-03-21_GOLD_v2_COMPLETE']);

test('assertUniqueIds — давхардал → алдаа, хоосон id → алдаа', () => {
  assert.doesNotThrow(() => assertUniqueIds(['a', 'b'], 'test_id', 'D'));
  assert.throws(() => assertUniqueIds(['a', 'b', 'a'], 'test_id', 'D'), /test_id давхардсан \(1\): a/);
  assert.throws(() => assertUniqueIds([''], 'case_id', 'D'), /хоосон case_id/);
});

test('бүх локал багц нэг санд — id угтвартай, давхцалгүй, түүхий id давхцдаг ч мөр алдагдахгүй', { skip: !existsSync(ROOT) ? 'data-train-files байхгүй' : false }, () => {
  const folders = readdirSync(ROOT)
    .filter((d) => statSync(join(ROOT, d)).isDirectory() && !SKIP.has(d) && existsSync(join(ROOT, d, 'knowledge_chunks.jsonl')))
    .map((d) => join(ROOT, d));
  if (folders.length < 2) return;
  const db = openKnowledgeDb({ path: ':memory:' });
  let expectedTests = 0;
  let expectedCases = 0;
  for (const f of folders) {
    const c = ingestDataset(db, f);
    expectedTests += c.tests;
    expectedCases += c.cases;
  }
  const tests = db.prepare('SELECT test_id, doc_id FROM ai_query_tests').all() as { test_id: string; doc_id: string }[];
  const cases = db.prepare('SELECT case_id, doc_id FROM ai_calculation_cases').all() as { case_id: string; doc_id: string }[];
  // Нэг ч мөр REPLACE-ээр алдагдаагүй.
  assert.equal(tests.length, expectedTests);
  assert.equal(cases.length, expectedCases);
  // Id бүр `<doc_id>::<raw>`; угтвар нь мөрийн doc_id-той таарна.
  for (const t of tests) assert.ok(t.test_id.startsWith(`${t.doc_id}::`), t.test_id);
  for (const c of cases) assert.ok(c.case_id.startsWith(`${c.doc_id}::`), c.case_id);
  // Түүхий id баримт хооронд ДАВХЦДАГ (угтвар load-bearing) — 481 бүлэг хэмжсэн, ≥ 100 байх ёстой.
  const rawByDocs = new Map<string, Set<string>>();
  for (const t of tests) {
    const raw = t.test_id.slice(t.doc_id.length + 2);
    const set = rawByDocs.get(raw) ?? new Set<string>();
    set.add(t.doc_id);
    rawByDocs.set(raw, set);
  }
  const collisions = [...rawByDocs.values()].filter((s) => s.size > 1).length;
  assert.ok(collisions >= 100, `түүхий id-ийн давхцал ${collisions} — угтваргүй бол мөр дарагдана`);
  db.close();
});
