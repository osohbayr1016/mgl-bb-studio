/**
 * MGL AI retrieval · ЖУРМЫН ПРОФАЙЛ (БНбД 11-03-02) + 11-106-25-ын тоон мөрийн `clause` нөөц — ТЕСТ.
 *
 * Run with:  node --test retrieval/test/procedureProfile.test.ts
 *
 * 2026-09-21: `data-train-files/`-д 10 хоног шингээгдэлгүй хэвтсэн хоёр багц.
 *   • MGL_AI_BNbD_11_03_02_dataset — ямар ч профайлд танигдахгүй (үүрэг/эрхийн файлгүй, оронд нь
 *     `procedure_rules` + `required_documents` + `approval_requirements`).
 *   • MCIS_MGL_AI_BNbD_11-106-25 — `legalinfo_rules` гэж танигддаг ч 145 тоон мөр бүгд
 *     «эх хэсэггүй» болж орохгүй байв: мөр `locator` биш `clause` гэж бичдэг.
 * Бодит багц олдохгүй бол шингээлтийн тестүүд АЛГАСНА (унахгүй).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectProfile, legalinfoNumericRows, legalinfoScalarRules, procedureRules, type ChunkIn } from '../src/datasetProfiles.ts';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset } from '../src/ingest.ts';
import { askNorm } from '../src/pipeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', 'data-train-files');
const PROC = join(ROOT, 'MGL_AI_BNbD_11_03_02_dataset');
const TOPO = join(ROOT, 'MCIS_MGL_AI_BNbD_11-106-25_GOLD_v3_SOURCED_COMPLETE');
const skipProc = existsSync(join(PROC, 'procedure_rules.jsonl')) ? false : 'БНбД 11-03-02 багц олдсонгүй';
const skipTopo = existsSync(join(TOPO, 'numeric_requirements.jsonl')) ? false : 'БНбД 11-106-25 багц олдсонгүй';

const chunk = (id: string, kind = 'clause', text = 'x'): ChunkIn => ({
  chunk_id: id,
  kind,
  page: 3,
  source_pdf_page: null,
  table_no: null,
  row_no: null,
  clause_no: null,
  section_path: null,
  text_mn: text,
  text_latin: null,
  search_text: text,
  authority_level: 'normative',
  visibility: 'public_norm',
  verification_status: 'verified_from_page_image',
  retrieval_weight: 1,
  metadata: {},
});

/* ── Хэлбэр таних ────────────────────────────────────────────────── */

test('procedure_rules + required_documents хосоор журмын профайл танигдана; legalinfo/flat-ээс ялгаатай', () => {
  const files = new Set(['document.json', 'knowledge_chunks.jsonl', 'aliases.json', 'procedure_rules.jsonl', 'required_documents.jsonl', 'approval_requirements.jsonl']);
  assert.equal(detectProfile((f) => files.has(f)), 'procedure_rules');
  files.delete('required_documents.jsonl');
  assert.equal(detectProfile((f) => files.has(f)), null);
});

/* ── Дүрмийн адаптер ─────────────────────────────────────────────── */

test('журмын мөр → хэсгийн шаардлага: яг таарсан заалт, дэд заалт (2.1 → 2.1.a), нийлмэл хаяг «1.5 + page 9 list», өөрийн хэсэгтэй зөвшөөрөл/баримт', () => {
  const chunks = [
    chunk('D:clause:1.5'),
    chunk('D:clause:2.1.a'),
    chunk('D:clause:2.1.b'),
    chunk('D:approval:AP02', 'approval'),
    chunk('D:required_document:RD01', 'required_document'),
    chunk('D:clause:admin.approval', 'metadata'),
    chunk('D:clause:3.3'),
  ];
  const rules = procedureRules(
    'D',
    {
      procedures: [
        { rule_id: 'D:rule:a', source_clause: '1.5 + page 9 list', page: 4, description_mn: 'Улсын магадлалд оруулна.', verification_status: 'verified_from_page_image' },
        { rule_id: 'D:rule:b', source_clause: '2.1', page: 4, description_mn: 'Захиалагч зөвшөөрөл авна.', verification_status: 'verified_from_page_image' },
        { rule_id: 'D:rule:c', source_clause: '9.9', page: 4, description_mn: 'Байхгүй заалт.', verification_status: 'verified_from_page_image' },
      ],
      approvals: [{ approval_id: 'D:AP02', source_clause: 'Approval list', page: 9, authority_mn: 'Гал түймэртэй тэмцэх алба', mode: 'coordinate', verification_status: 'verified_from_page_image' }],
      documents: [{ requirement_id: 'D:RD01', source_clause: '1.2', page: 3, name_mn: 'Зургийн даалгавар', verification_status: 'verified_from_page_image' }],
    },
    chunks,
  );
  const byChunk = new Map(rules.map((r) => [r.chunk_id, r]));
  assert.equal(byChunk.get('D:clause:1.5')?.object_mn, 'Улсын магадлалд оруулна.');
  assert.equal(byChunk.get('D:clause:2.1.a')?.object_mn, 'Захиалагч зөвшөөрөл авна.');
  assert.equal(byChunk.get('D:approval:AP02')?.object_mn, 'Гал түймэртэй тэмцэх алба — coordinate');
  assert.equal(byChunk.get('D:required_document:RD01')?.object_mn, 'Зургийн даалгавар');
  // байхгүй заалтын мөр ОРООГҮЙ (эшлэлгүй дүрэм байхгүй)
  assert.ok(!rules.some((r) => r.object_mn === 'Байхгүй заалт.'));
  // дүрэмгүй үлдсэн хэсэг бүр quote_source_clause шаардлага авна; metadata-д ҮГҮЙ
  assert.equal(byChunk.get('D:clause:3.3')?.decision_policy, 'quote_source_clause');
  assert.equal(byChunk.get('D:clause:2.1.b')?.rule_kind, 'requirement');
  assert.equal(byChunk.has('D:clause:admin.approval'), false);
  assert.ok(rules.every((r) => r.rule_kind === 'requirement' && r.citation_required));
  // rule_id давхардахгүй
  assert.equal(new Set(rules.map((r) => r.rule_id)).size, rules.length);
});

/* ── 11-106-25: `clause` нь `locator`-ын нөөц ────────────────────── */

test('тоон мөр `locator`-гүй, `clause`-тай бол хэсэг нь `…:clause:<clause>`-оор олдоно (хавсралтын үсэгтэй «В.1.1» ч)', () => {
  const rows = legalinfoNumericRows([
    { rule_id: 'D:1.1:supported_1_100', clause: '1.1', name: 'supported_1_100', operator: '=', value: '1:100', unit: 'scale', source: { locator: 'заалт 1.1', verification_status: 'verified_content_extract' } },
    { rule_id: 'D:В.1.1:sym', clause: 'В.1.1', name: 'sym', operator: '>=', value: 2, unit: 'мм', source: { locator: 'В хавсралт, В.1.1', verification_status: 'verified_content_extract' } },
    { rule_id: 'D:6.3:orphan', clause: '6.3', name: 'orphan', operator: '>=', value: 1, unit: 'м', source: { locator: 'заалт 6.3', verification_status: 'verified_content_extract' } },
  ]);
  assert.equal(rows[0]!.locator, '1.1');
  assert.equal(rows[1]!.locator, 'В.1.1');
  const chunks = new Map([['D:clause:1.1', chunk('D:clause:1.1')], ['D:clause:В.1.1', chunk('D:clause:В.1.1')]]);
  const rules = legalinfoScalarRules(rows, new Set(), (id) => chunks.get(id), 'D');
  const attached = rules.filter((r) => chunks.has(r.chunk_id));
  assert.deepEqual(attached.map((r) => r.chunk_id).sort(), ['D:clause:1.1', 'D:clause:В.1.1']);
  // 6.3 — багцад заалтын хэсэг байхгүй → эх хэсэггүй хэвээр (шингээгч орхиж, тайлагнана)
  assert.ok(rules.some((r) => r.rule_id.startsWith('D:6.3') && !chunks.has(r.chunk_id)));
  // verified_content_extract нь гүйцэтгэгдэхгүй ХЭВЭЭР — эзний шийдвэр, адаптер дээшлүүлэхгүй
  assert.ok(attached.every((r) => r.verification_status === 'verified_content_extract'));
});

/* ── Бодит багц ──────────────────────────────────────────────────── */

test('БНбД 11-03-02 бодит багц шингээгдэж, гадаадын байгууллагын асуултад өөрийн заалтаа эшилнэ', { skip: skipProc }, () => {
  const db = openKnowledgeDb({ path: ':memory:' });
  const c = ingestDataset(db, PROC);
  assert.equal(c.profile, 'procedure_rules');
  assert.equal(c.chunks, 69);
  assert.ok(c.rules >= 60, `rules ${c.rules}`);
  assert.equal(c.orphanRules.length, 0);
  assert.deepEqual(c.verification.unknown, []);
  const a = askNorm(db, 'Гадаадын байгууллагаар Монголд зураг төсөл хийлгэхэд энэ журам хамаарах уу?', { evidenceLimit: 5 });
  assert.ok(a.evidence.some((e) => e.chunk_id === 'BNBD-11-03-02-2002:clause:1.1'), a.evidence.map((e) => e.chunk_id).join(','));
  assert.equal(a.citation?.document, 'БНбД 11-03-02');
  // 2002 оны журам — хүчинтэй эсэх шалгагдаагүй → хуулийн хяналтын туг, эрх бүхий БИШ
  const cur = db.prepare('SELECT effective_status FROM ai_documents WHERE doc_id = ?').get('BNBD-11-03-02-2002') as { effective_status: string };
  assert.equal(cur.effective_status, 'current_status_not_checked_for_later_amendments_or_replacement');
  db.close();
});

test('БНбД 11-106-25 бодит багц: тоон мөр эх заалтдаа холбогдоно (145 → ≤40 эх хэсэггүй), гүйцэтгэгдэхгүй хэвээр', { skip: skipTopo }, () => {
  const db = openKnowledgeDb({ path: ':memory:' });
  const c = ingestDataset(db, TOPO);
  assert.equal(c.profile, 'legalinfo_rules');
  assert.ok(c.orphanRules.length <= 40, `orphans ${c.orphanRules.length}`);
  assert.ok(c.rulesByKind.threshold! >= 100, JSON.stringify(c.rulesByKind));
  const exec = db.prepare("SELECT COUNT(*) AS n FROM ai_rules WHERE doc_id = ? AND verification_status = 'verified_content_extract'").get('BNBD-11-106-25-2025') as { n: number };
  assert.ok(exec.n >= 100);
  const a = askNorm(db, 'БНбД 11-106-25 ямар масштабын байр зүйн зураглалд хамаарах вэ?', { evidenceLimit: 5 });
  assert.ok(a.evidence.some((e) => e.chunk_id === 'BNBD-11-106-25-2025:clause:1.1'), a.evidence.map((e) => e.chunk_id).join(','));
  db.close();
});
