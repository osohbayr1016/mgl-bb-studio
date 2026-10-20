#!/usr/bin/env node
/**
 * Хайлтын алдагдлыг оношлох: баримтын тест бүрийг одоогийн кодоор ажиллуулж
 * (а) бодит сан, (б) БД 21-101-12-гүй ТҮР хуулбар дээр харьцуулна — унасан тест
 * нь КОДЫН өөрчлөлтөөс үү, КОРПУСЫН (BM25 IDF) шилжилтээс үү гэдгийг ялгана.
 *
 *   node scripts/diff-retrieval-misses.mjs UBB-12-204-01-2002 [--without BD-21-101-12-2012]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { askNorm } from '../retrieval/src/pipeline.ts';

const docId = process.argv[2];
const withoutIdx = process.argv.indexOf('--without');
const without = withoutIdx === -1 ? null : process.argv[withoutIdx + 1];
const src = path.join(process.env.LOCALAPPDATA ?? '', 'MglAi', 'knowledge', 'knowledge.sqlite');

function run(dbPath, label) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const tests = db.prepare('SELECT test_id, query, language, expected_chunk_id, expected_rule_id FROM ai_query_tests WHERE doc_id = ?').all(docId);
  const misses = [];
  for (const t of tests) {
    const a = askNorm(db, t.query, { evidenceLimit: 5 });
    const want = t.expected_chunk_id ?? t.expected_rule_id;
    const hit = a.evidence.some((e) => e.chunk_id === want) || a.rule_id === want;
    if (!hit) misses.push({ id: t.test_id, q: t.query.slice(0, 70), want, got: a.evidence.slice(0, 3).map((e) => e.chunk_id.split(':').slice(1).join(':')).join(' | '), status: a.status, reason: a.no_match_reason ?? '', named: a.named_document ? `${a.named_document.code}/${a.named_document.relation}` : '' });
  }
  db.close();
  console.log(`${label}: ${tests.length - misses.length}/${tests.length} (${(((tests.length - misses.length) / tests.length) * 100).toFixed(1)}%)`);
  return misses;
}

const real = run(src, 'бодит сан');
let alt = null;
if (without) {
  const tmp = path.join(os.tmpdir(), `mglai-diff-${Date.now()}.sqlite`);
  fs.copyFileSync(src, tmp);
  const db = new DatabaseSync(tmp);
  db.exec(`DELETE FROM ai_rules WHERE doc_id = '${without}'; DELETE FROM ai_chunks WHERE doc_id = '${without}'; DELETE FROM ai_aliases WHERE doc_id = '${without}'; DELETE FROM ai_documents WHERE doc_id = '${without}';`);
  db.exec("INSERT INTO ai_chunks_fts(ai_chunks_fts) VALUES('rebuild')");
  db.close();
  alt = run(tmp, `${without}-гүй хуулбар`);
  fs.rmSync(tmp, { force: true });
}
const altIds = new Set((alt ?? []).map((m) => m.id));
for (const m of real) {
  console.log(`  ${alt ? (altIds.has(m.id) ? '[КОД]   ' : '[КОРПУС]') : ''} ${m.id} «${m.q}» → ${m.status} ${m.reason} ${m.named} | got: ${m.got}`);
}
