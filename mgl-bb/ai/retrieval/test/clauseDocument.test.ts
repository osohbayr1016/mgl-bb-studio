/**
 * `clause_document` профайл (ai/norm-dataset багц, БНбД 31-17-10) — шингээлт, эшлэл, хаалга.
 *
 * ⚠️ Бодит pack/ хавтаснаас :memory: санд шингээнэ (git-д байгаа, 1.3 MB).  Хэмжсэн зүйл:
 *   • профайл `norm-dataset.pack.json`-оор танигдана, өөр профайлд орохгүй;
 *   • автоматаар задалсан хэсэг НЭГ Ч дүрэм үүсгэхгүй (гүйцэтгэгдэхгүй төлөв → ai_rules 0);
 *   • нэрлэсэн баримт цоожлогдоно; байхгүй заалт → `clause_not_in_named_document`, зохиогдохгүй;
 *   • эшлэл хуудас + https эх сурвалжтай; `legal_review_required` (сүүлийн өөрчлөлт шалгаагүй).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset } from '../src/ingest.ts';
import { askNorm } from '../src/pipeline.ts';
import { detectProfile } from '../src/datasetProfiles.ts';
import { classifyVerification } from '../src/rules.ts';
import { isCitable } from '../src/citation.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK = join(HERE, '..', '..', 'norm-dataset', 'documents', 'BNbD_31-17-10', 'pack');
const DOC = 'BNBD-31-17-10-2010';

const db = openKnowledgeDb({ path: ':memory:' });
const counts = ingestDataset(db, PACK);

test('clause_document · профайл зөвхөн norm-dataset.pack.json-оор танигдана', () => {
  assert.equal(detectProfile((f) => existsSync(join(PACK, f))), 'clause_document');
  assert.equal(detectProfile((f) => f === 'duty_rules.jsonl' || f === 'legal_status_graph.json'), 'legalinfo_rules');
  assert.equal(counts.profile, 'clause_document');
});

test('clause_document · хэсэг ≥ 700, дүрэм 0 (auto-extracted = non_executable), тест 36', () => {
  assert.ok(counts.chunks >= 700, `chunks ${counts.chunks}`);
  assert.equal(counts.rules, 0);
  assert.equal(counts.tests, 36);
  assert.equal(classifyVerification('official_pdf_text_layer_auto_extracted'), 'non_executable');
  assert.deepEqual(counts.verification.unknown, []);
});

test('clause_document · заалт бүр хуудас + https эх сурвалжтай (эшлэгдэх боломжтой)', () => {
  const rows = db.prepare("SELECT chunk_id, page, metadata_json FROM ai_chunks WHERE kind = 'clause'").all() as Array<{ chunk_id: string; page: number | null; metadata_json: string }>;
  assert.ok(rows.length >= 550);
  for (const r of rows) {
    assert.ok(r.page !== null && r.page >= 3 && r.page <= 137, `${r.chunk_id} page ${r.page}`);
    const m = JSON.parse(r.metadata_json) as { url?: string };
    assert.match(m.url ?? '', /^https:\/\//, r.chunk_id);
  }
});

test('clause_document · нэрлэсэн заалт: 6.12 → яг тэр хэсэг, эшлэл хуудас 10, https, хуулийн хяналтын туг', () => {
  const a = askNorm(db, 'БНбД 31-17-10-ийн 6.12 юу гэж байна?', { evidenceLimit: 5 });
  assert.equal(a.status, 'supported');
  assert.equal(a.evidence[0]?.chunk_id, `${DOC}:clause:6.12`);
  assert.equal(a.citation?.clause, '6.12');
  assert.equal(a.citation?.page, 10);
  assert.match(a.citation?.source_url ?? '', /^https:\/\/mcis\.gov\.mn\//);
  assert.ok(isCitable(a.citation!));
  assert.equal(a.citation?.legal_review_required, true, 'current_status_not_checked_for_later_amendments ≠ in_force');
  assert.equal(a.named_document?.absent, false);
});

test('clause_document · байхгүй заалт зохиогдохгүй (99.99 / 6.120)', () => {
  for (const q of ['БНбД 31-17-10-ийн 99.99 заалт юу гэж байна?', '31-17-10-д байхгүй заалтыг хэл: 6.120 заалтын шаардлага']) {
    const a = askNorm(db, q, { evidenceLimit: 5 });
    assert.equal(a.status, 'insufficient_evidence', q);
    assert.equal(a.no_match_reason, 'clause_not_in_named_document', q);
    assert.equal(a.citation, null);
    assert.equal(a.rule_id, null);
  }
});

test('clause_document · санд байхгүй баримт (31-17-23 төсөл) нэрлэвэл өөр баримтаас хариулахгүй', () => {
  const a = askNorm(db, 'БНбД 31-17-23-ын 4.1 заалт өндөр барилгын өндрийг хэрхэн заасан бэ?', { evidenceLimit: 5 });
  assert.equal(a.status, 'insufficient_evidence');
  assert.equal(a.no_match_reason, 'named_document_absent');
  assert.equal(a.named_document?.absent, true);
  assert.equal(a.evidence.length, 0);
});

test('clause_document · хүснэгт ба нэр томъёо хэсэг болж эшлэгдэнэ', () => {
  const t = askNorm(db, 'БНбД 31-17-10 5.1-р хүснэгт техникийн давхрын ачаалал', { evidenceLimit: 5 });
  assert.ok(t.evidence.some((e) => e.chunk_id === `${DOC}:table:5.1`), t.evidence.map((e) => e.chunk_id).join(', '));
  const d = askNorm(db, 'Хэсэгчилсэн нуралт гэж юу вэ? (БНбД 31-17-10 нэр томъёо)', { evidenceLimit: 5 });
  assert.ok(d.evidence.some((e) => e.chunk_id === `${DOC}:definition:хэсэгчилсэн_нуралт`));
});

test('clause_document · tests/retrieval.jsonl Recall@5 ≥ 90% (ганц баримттай сан)', () => {
  const tests = readFileSync(join(PACK, 'qa_retrieval_tests.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { query: string; expected_id: string });
  let hit = 0;
  for (const t of tests) {
    const a = askNorm(db, t.query, { evidenceLimit: 5 });
    if (a.evidence.some((e) => e.chunk_id === t.expected_id)) hit += 1;
  }
  assert.ok(hit / tests.length >= 0.9, `recall@5 ${hit}/${tests.length}`);
});

test('clause_document · захиалагчийн горимд ч нээлттэй норм (public_norm) хайгдана', () => {
  const a = askNorm(db, 'Өндөр барилгын гол орцын хөлийн өрөөнд цахилгаан шат хүлээх хугацаа', { audience: 'client', evidenceLimit: 5 });
  assert.ok(a.evidence.length > 0);
});
