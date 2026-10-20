/**
 * L2 — норм ойлгох давхарга (`explain.ts`) · БНбД 31-17-10 + СИНТЕТИК хоёр дахь баримт.
 *
 * ⚠️ Синтетик «БНбД 99-99-99» нь ЗӨВХӨН энэ тестэд (mkdtemp) — 31-17-10-тай ИЖИЛ заалтын дугаар (5.2, 8.3, 4.6),
 *    төстэй үг хэллэгтэй; шалгах зүйл: нэрлэсэн баримтын цоож, өөр баримтын тайлбар ХЭЗЭЭ Ч гоожихгүй, дугаар
 *    давхардал (үндсэн 8.3 ↔ 8-р хавсралтын 8.3), computable=false хатуу, эх бичвэр өөрчлөгдөөгүй (sha256).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset } from '../src/ingest.ts';
import { askNorm } from '../src/pipeline.ts';
import { explainForAnswer, explanationByClause, explanationByChunk, explanationCounts, ingestExplanations, explainedDocuments, sectionExplanation, documentExplanation } from '../src/explain.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOC_DIR = join(HERE, '..', '..', 'norm-dataset', 'documents', 'BNbD_31-17-10');
const PACK = join(DOC_DIR, 'pack');
const L2 = join(DOC_DIR, 'l2');
const DOC = 'BNBD-31-17-10-2010';
const SYNTH_DOC = 'BNBD-99-99-99-2099';
const SYNTH_CODE = 'БНбД 99-99-99';

/* ── Синтетик хоёр дахь баримт (clause_document профайл + l2/) ─────── */
function writeJsonl(path: string, rows: unknown[]): void {
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}
function synthDoc(): string {
  const root = mkdtempSync(join(tmpdir(), 'l2-synth-'));
  const pack = join(root, 'pack');
  const l2 = join(root, 'l2');
  mkdirSync(pack);
  mkdirSync(l2);
  const clauses = [
    { clause: '4.6', page: 5, text: 'Синтетик барилгын гол орцын хөлийн өрөөний талбайг цахилгаан шат хүлээх хугацаа 10-15 секунд байхаар тооцон тогтооно.' },
    { clause: '5.2', page: 6, text: 'Синтетик барилгын шат, давхар дундын хучилтанд үйлчлэх жигд тархсан түр ачааллын хэмжээт утгыг 9.9-р хүснэгтийн дагуу авна.' },
    { clause: '8.3', page: 16, text: 'Синтетик дамжуулах гол шугамын босоо шугамуудыг 7 болон түүнээс олон бүсэд зориулж төлөвлөж болно.' },
  ];
  writeFileSync(join(pack, 'document.json'), JSON.stringify({ doc_id: SYNTH_DOC, code: SYNTH_CODE, title_mn: 'Синтетик тест баримт', title_en: 'Synthetic', jurisdiction: 'Mongolia', version: '2099', effective_status: 'in_force', dataset_standard: 'norm-dataset/1', source_url: 'https://example.invalid/synth', text_verification_status: 'official_pdf_text_layer_auto_extracted' }), 'utf8');
  writeJsonl(
    join(pack, 'knowledge_chunks.jsonl'),
    clauses.map((c) => ({ authority_level: 'normative', visibility: 'public_norm', verification_status: 'official_pdf_text_layer_auto_extracted', text_latin: '', chunk_id: `${SYNTH_DOC}:clause:${c.clause}`, kind: 'clause', page: c.page, source_pdf_page: c.page + 2, section: null, text_mn: c.text, search_text: `${SYNTH_CODE} заалт ${c.clause} ${c.text}`, retrieval_weight: 1, source_locator: { url: 'https://example.invalid/synth', printed_page: c.page }, metadata: { scope: 'body', appendix: null, clause: c.clause } })),
  );
  writeFileSync(join(pack, 'aliases.json'), JSON.stringify({ [SYNTH_CODE]: [{ alias: 'BNbD 99-99-99', language: 'latin' }] }), 'utf8');
  writeFileSync(join(pack, 'norm-dataset.pack.json'), JSON.stringify({ schema: 'norm-dataset.pack/1', dataset_id: 'synth', version: '0.0.1', document_code: SYNTH_CODE, doc_id: SYNTH_DOC, source_sha256: 'ab'.repeat(32), text_verification_status: 'official_pdf_text_layer_auto_extracted', counts: { chunks: 3 } }), 'utf8');
  writeJsonl(join(pack, 'numeric_requirements.jsonl'), []);
  writeJsonl(join(pack, 'qa_retrieval_tests.jsonl'), []);
  writeJsonl(join(pack, 'calculation_cases.jsonl'), []);
  writeJsonl(
    join(l2, 'clause_explanations.jsonl'),
    clauses.map((c) => ({
      type: 'clause_explanation',
      schema_version: 'l2-clause/1',
      norm_code: SYNTH_CODE,
      document_id: SYNTH_DOC,
      clause_id: c.clause,
      clause_uid: `${SYNTH_CODE}#${c.clause}`,
      chunk_id: `${SYNTH_DOC}:clause:${c.clause}`,
      scope: 'body',
      appendix: null,
      ambiguous_with: null,
      heading_path: ['9. СИНТЕТИК'],
      source_text: c.text,
      source_text_sha256: createHash('sha256').update(c.text).digest('hex'),
      context: { document_title: 'Синтетик', section: { section: '9', title: 'СИНТЕТИК', page: c.page }, parent_clause: null, prev_clause: null, next_clause: null, definitions: [], referenced_clauses: [], notes: [] },
      semantic_frame: { subject: ['Синтетик'], requirement: [c.text], conditions: [], exceptions: [], prohibitions: [], permissions: [], cross_references: [] },
      plain_mn: `SYNTH ${c.clause}`,
      plain_mn_method: 'deterministic_digest',
      requirement_type: 'obligation',
      numeric_literals: [],
      source: { page: c.page, pdf_page: c.page + 2, url: 'https://example.invalid/synth', pdf_url: null, document_sha256: 'ab'.repeat(32), clause_verification: 'official_pdf_text_layer_auto_extracted' },
      currentness: { effective_status: 'in_force', note: '' },
      verification: { source_text: 'official_pdf_text_layer_auto_extracted', explanation: 'AUTO_DRAFT' },
      execution: { computable: false },
      generated_at: '2026-09-18',
    })),
  );
  return pack;
}

const db = openKnowledgeDb({ path: ':memory:' });
const real = ingestDataset(db, PACK);
const synthPack = synthDoc();
const synth = ingestDataset(db, synthPack);

test('L2 · pack шингээлт l2/-г автоматаар хамт оруулна (593 заалт, 17 хэсэг, 1 баримт, orphan 0)', () => {
  assert.ok(existsSync(join(L2, 'clause_explanations.jsonl')), 'l2/clause_explanations.jsonl байх ёстой (node norm-dataset/tools/build-l2.mjs)');
  assert.equal(real.explanations?.clauses, 593);
  assert.equal(real.explanations?.sections, 17);
  assert.equal(real.explanations?.document, 1);
  assert.equal(real.explanations?.orphan_chunk_ids, 0);
  assert.equal(real.explanations?.human_verified, 0);
  assert.equal(synth.explanations?.clauses, 3);
  const c = explanationCounts(db)!;
  assert.equal(c.documents, 2);
  assert.equal(c.clauses, 596);
  assert.equal(c.human_verified, 0);
});

test('L2 · эх бичвэр ХӨДЛӨШГҮЙ: бичлэгийн source_text = parsed/clauses.jsonl text, sha256 таарна, computable=false бүгд', () => {
  const parsed = new Map(
    readFileSync(join(DOC_DIR, 'parsed', 'clauses.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as { clause_id: string; text: string })
      .map((c) => [c.clause_id, c.text.trim()]),
  );
  const rows = db.prepare(`SELECT clause_uid, source_text, source_text_sha256, computable, record_json FROM ai_norm_explanations WHERE doc_id = ? AND kind = 'clause'`).all(DOC) as Array<{ clause_uid: string; source_text: string; source_text_sha256: string; computable: number; record_json: string }>;
  assert.equal(rows.length, 593);
  for (const r of rows) {
    assert.equal(r.source_text, parsed.get(r.clause_uid), r.clause_uid);
    assert.equal(r.source_text_sha256, createHash('sha256').update(r.source_text).digest('hex'), r.clause_uid);
    assert.equal(r.computable, 0);
    const rec = JSON.parse(r.record_json) as { execution: { computable: boolean }; verification: { explanation: string }; semantic_frame: Record<string, string[]> };
    assert.equal(rec.execution.computable, false);
    assert.equal(rec.verification.explanation, 'AUTO_DRAFT');
    // Семантик хүрээний өгүүлбэр бүр ЭХ БИЧВЭРТ үг үсгээрээ байх ёстой (зохиогдоогүй).
    for (const k of ['requirement', 'conditions', 'exceptions', 'prohibitions', 'permissions'] as const) {
      for (const s of rec.semantic_frame[k] ?? []) assert.ok(r.source_text.includes(s), `${r.clause_uid} ${k}: «${s.slice(0, 60)}» эхэд алга`);
    }
  }
});

test('L2 · computable:true бичлэг шингээлтэд ХАТУУ унана', () => {
  const dir = mkdtempSync(join(tmpdir(), 'l2-bad-'));
  writeJsonl(join(dir, 'clause_explanations.jsonl'), [{ type: 'clause_explanation', document_id: 'X', norm_code: 'X', clause_id: '1.1', clause_uid: 'X#1.1', chunk_id: 'X:clause:1.1', execution: { computable: true }, verification: { explanation: 'AUTO_DRAFT' } }]);
  assert.throws(() => ingestExplanations(db, dir), /computable/);
  assert.equal(explanationCounts(db)!.clauses, 596, 'ROLLBACK — юу ч өөрчлөгдөөгүй');
});

test('L2 · C яг заалт: «БНбД 31-17-10-ын 5.2 заалт» → 31-17-10-ын 5.2, синтетик 5.2 БИШ', () => {
  const q = 'БНбД 31-17-10-ын 5.2 заалт юу гэж заасан бэ?';
  const x = explainForAnswer(db, askNorm(db, q), q)!;
  assert.equal(x.mode, 'exact_clause');
  assert.equal(x.document.doc_id, DOC);
  assert.equal(x.clause?.clause_uid, 'БНбД 31-17-10#5.2');
  assert.match(x.clause!.source_text, /5\.1-р хүснэгтийн дагуу авна/);
  assert.equal(x.clause!.source.page, 6);
  assert.match(x.clause!.source.url!, /^https:\/\/mcis\.gov\.mn\//);
  assert.equal(x.clause!.source.document_sha256, '005f941b814e88a3c1dd707d7bb2958777d4ad73cec2df4b8511af1559ab858f');
  assert.equal(x.computable, false);
  assert.equal(x.ambiguity, null);
});

test('L2 · баримтын цоож: «БНбД 99-99-99-ийн 5.2 заалт» → синтетик, 31-17-10 огт гарахгүй (гоожилт 0)', () => {
  const q = 'БНбД 99-99-99-ийн 5.2 заалт юу гэж заасан бэ?';
  const x = explainForAnswer(db, askNorm(db, q), q)!;
  assert.equal(x.document.doc_id, SYNTH_DOC);
  assert.equal(x.clause?.clause_uid, 'БНбД 99-99-99#5.2');
  assert.ok(!JSON.stringify(x).includes('31-17-10'), 'өөр баримтын текст/код тайлбарт орж болохгүй');
});

test('L2 · нэрлэсэн баримт санд БАЙХГҮЙ → тайлбар null (өөр баримтаас зээлэхгүй)', () => {
  const q = 'УББ 11-202-00-ийн 5.2 заалт юу вэ?';
  const a = askNorm(db, q);
  assert.equal(a.named_document?.absent, true);
  assert.equal(explainForAnswer(db, a, q), null);
});

test('L2 · нэрлэсэн заалт баримтад АЛГА → null (clause_not_in_named_document хэвээр, зохиохгүй)', () => {
  const q = 'БНбД 31-17-10-ын 99.9 заалт';
  const a = askNorm(db, q);
  assert.equal(a.no_match_reason, 'clause_not_in_named_document');
  assert.equal(explainForAnswer(db, a, q), null);
});

test('L2 · дугаар давхардал: «8.3» → үндсэн хэсэг + ambiguity; «8-р хавсралтын 8.3» → хавсралт', () => {
  const q1 = 'БНбД 31-17-10 8.3 заалт';
  const x1 = explainForAnswer(db, askNorm(db, q1), q1)!;
  assert.equal(x1.clause?.clause_uid, 'БНбД 31-17-10#8.3');
  assert.equal(x1.clause?.scope, 'body');
  assert.deepEqual(x1.ambiguity, { chosen: 'БНбД 31-17-10#8.3', alternatives: ['БНбД 31-17-10#A8:8.3'] });
  const q2 = 'БНбД 31-17-10-ын 8-р хавсралтын 8.3 заалт';
  const x2 = explainForAnswer(db, askNorm(db, q2), q2)!;
  assert.equal(x2.clause?.clause_uid, 'БНбД 31-17-10#A8:8.3');
  assert.equal(x2.clause?.scope, 'appendix');
  assert.match(x2.clause!.source_text, /БНбД 40-05-98/);
  // references.jsonl-ийн 40-05-98 ишлэл ХУУДСААР хавсралтын 8.3-т, үндсэн 8.3-т биш.
  assert.ok(x2.clause!.semantic_frame.cross_references.some((r) => r.kind === 'document' && r.target === 'БНбД 40-05-98'));
  assert.ok(!x1.clause!.semantic_frame.cross_references.some((r) => r.target === 'БНбД 40-05-98'));
});

test('L2 · D хайлтаар олдсон заалт (кодгүй): тайлбар = ТОЛГОЙ хэсгийн баримт/заалт, нэр дэвшигч бүгд тэр баримтаас', () => {
  // ⚠️ Кодгүй асуултад аль баримт толгойлохыг BM25 шийднэ (синтетик жижиг корпус 4.6-ийг ч авч болно) —
  //    L2-ийн инвариант нь «тайлбар = олдсон хэсэг» бөгөөд баримт холилдохгүй; тодорхой үгтэй асуултад 31-17-10.
  const q = 'Өндөр барилгын гол орцын хөлийн өрөөний талбайг оргил ачааллын үед цахилгаан шат хүлээх хугацаагаар яаж тогтоох вэ?';
  const a = askNorm(db, q);
  const x = explainForAnswer(db, a, q)!;
  assert.equal(x.mode, 'nearest_clause');
  assert.equal(x.clause?.chunk_id, a.evidence[0]!.chunk_id, 'тайлбар = толгой хэсэг');
  assert.equal(x.clause?.clause_uid, 'БНбД 31-17-10#4.6');
  assert.ok(x.clause!.numeric_literals.some((n) => n.literal === '30-35 секунд'));
  assert.ok(x.candidates.every((c) => c.clause_uid.startsWith('БНбД 31-17-10#')));
  // Синтетик толгойлсон ч тайлбар нь ТЭР баримтынх л (гоожилт биш, зээллэг биш).
  const q2 = 'Синтетик барилгын гол орцын хөлийн өрөөний талбайг яаж тогтоох вэ?';
  const a2 = askNorm(db, q2);
  const x2 = explainForAnswer(db, a2, q2)!;
  assert.equal(x2.document.doc_id, a2.evidence[0]!.doc_id);
  assert.ok(x2.candidates.every((c) => c.clause_uid.startsWith(x2.document.code)));
});

test('L2 · B хэсэг / A баримт (нэрлэсэн баримтад л)', () => {
  const qs = 'БНбД 31-17-10-ын 5-р бүлэг юуны тухай вэ?';
  const xs = explainForAnswer(db, askNorm(db, qs), qs)!;
  assert.equal(xs.mode, 'section');
  assert.equal(xs.section?.section, '5');
  assert.match(xs.section!.title, /АЧААЛАЛ/);
  assert.ok(xs.section!.clause_ids.includes('5.2'));
  const qd = 'БНбД 31-17-10 хэрэглэх хүрээ нь юу вэ?';
  const xd = explainForAnswer(db, askNorm(db, qd), qd)!;
  assert.equal(xd.mode, 'document');
  assert.match(xd.documentExplanation!.scope_text!, /17 давхар/);
  assert.equal(xd.documentExplanation!.execution.computable, false);
  assert.equal(sectionExplanation(db, DOC, '99'), null);
  assert.equal(documentExplanation(db, SYNTH_DOC), null, 'синтетикт баримтын бичлэг өгөөгүй');
});

test('L2 · тайлбаргүй баримтын заалт → null (УББ/бусад санд байхгүй энд; хүснэгт л)', () => {
  assert.deepEqual([...explainedDocuments(db).keys()].sort(), [DOC, SYNTH_DOC].sort());
  assert.equal(explanationByChunk(db, 'UBB-12-01-01-2001:clause:2.5'), null);
  assert.equal(explanationByClause(db, DOC, '5.2', null).record?.clause_uid, 'БНбД 31-17-10#5.2');
  assert.equal(explanationByClause(db, DOC, '6.3.2', '6.3').record?.clause_uid, 'БНбД 31-17-10#A6.3:6.3.2');
});

test('L2 · тоо ЭХИЙН ХЭЛБЭРЭЭР: 1.1-д 1/8, 17 давхар, 51м, 35 давхар, 150м, 6м — баримтын код тоо биш', () => {
  const r = explanationByClause(db, DOC, '1.1', null).record!;
  assert.deepEqual(r.numeric_literals.map((n) => n.literal), ['1/8', '17 давхар', '51м', '35 давхар', '150м', '6м']);
  const a83 = explanationByClause(db, DOC, '8.3', '8').record!;
  assert.deepEqual(a83.numeric_literals, [], 'БНбД 40-05-98 болон хүснэгт 8.1 нь тоо биш');
  assert.equal(r.requirement_type, 'scope');
  assert.ok(r.semantic_frame.exceptions.some((s) => /оруулахгүй/.test(s)));
});

test('L2 · хүчинтэй эсэх асуулт → currentness_routed туг (энд төлөв ХЭЛЭХГҮЙ)', () => {
  const q = 'БНбД 31-17-10-ын 5.2 заалт одоо хүчинтэй юу?';
  const x = explainForAnswer(db, askNorm(db, q), q)!;
  assert.equal(x.currentness_routed, true);
  // L2.1: `status` нь ТАЙЛБАРЫН ажлын урсгалын төлөв (source_verification/explanation_generation/semantic_validation/human_review) —
  //    хүчин төгөлдөр байдлын (ACTIVE/…) төлөв БИШ.
  assert.equal(x.clause!.status?.human_review, 'NOT_REVIEWED');
  assert.ok(!/ACTIVE|in_force|SUPERSEDED/.test(JSON.stringify(x.clause!.status)), 'тайлбарын төлөвт хүчин төгөлдөр байдал орохгүй');
});
