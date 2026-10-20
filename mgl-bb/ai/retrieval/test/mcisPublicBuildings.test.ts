/**
 * MGL AI retrieval · MCIS GOLD v3 ОЛОН НИЙТИЙН БАРИЛГЫН ГУРВАН БАГЦ — ТЕСТ (2026-09-11).
 *
 * Run with:  node --test retrieval/test/mcisPublicBuildings.test.ts
 *
 * ⚠️ БНбД 31-23-12 (захиргааны барилга, 2022 онд КОД СОЛИГДСОН), 31-24-22 (цэцэрлэг,
 *    64 эх-шалгалтын хаалттай заалт), 31-25-22 (сургууль, 2024 оны №36 тушаалаар
 *    НЭМЭЛТ ӨӨРЧЛӨЛТ орсон) — гурвуулаа өмнөх долоон багцад байгаагүй ойлголт авчирсан:
 *      • хавсралтын тоон мөр (`APP-D` хаяг) → `…:appendix:Д` хэсэг; хавсралтын үсэг нь
 *        хаяг (`Хавсралт В` ≠ `Хавсралт B-10`);
 *      • тоон бус хүснэгтийн id (`APP-A1`, `T-5.1.14-1`) + баганын гарчигтай мөр;
 *      • `>= [100, 50]` нь МУЖ биш, хоёр баганын зарласан утга;
 *      • `amended_rules` профайл: `:clause:`-гүй id, `direct_answer` хаалт, өөрчлөлтийн
 *        тушаал эшлэлийн шошгонд;
 *      • `code`-гүй баримт (`current_code` + `legacy_code`).
 *
 * ⚠️ Бодит багц олдохгүй бол шингээлтийн тестүүд АЛГАСНА (унахгүй).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectProfile,
  legalinfoNumericRows,
  legalinfoGenericTables,
  appendixChunkId,
  amendedRulesChunks,
  amendedRulesRules,
  normalizeAmendments,
  normalizeAliasRows,
  normalizeCases,
  amendedChunkId,
} from '../src/datasetProfiles.ts';
import { isExecutableVerification } from '../src/rules.ts';
import { buildCitation, isCitable } from '../src/citation.ts';
import { extractDocRef } from '../src/normalize.ts';
import { openKnowledgeDb } from '../src/db.ts';
import { ingestDataset } from '../src/ingest.ts';
import { askNorm } from '../src/pipeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', 'data-train-files');
const ADMIN = join(ROOT, 'MCIS_MGL_AI_BNbD_31-23-12_GOLD_v3_SOURCED_COMPLETE');
const KINDER = join(ROOT, 'MCIS_MGL_AI_BNbD_31-24-22_GOLD_v3_SOURCED_COMPLETE');
const SCHOOL = join(ROOT, 'MCIS_MGL_AI_BNbD_31-25-22_GOLD_v3_CURRENT_AMENDED_COMPLETE');
const GEO = join(ROOT, 'MCIS_MGL_AI_BNbD_11-03-21_GOLD_v3_SOURCED_COMPLETE');
const have = (f: string, marker: string): boolean => existsSync(join(f, marker));
const skipAdmin = have(ADMIN, 'legal_status_graph.json') ? false : 'БНбД 31-23-12 багц олдсонгүй';
const skipKinder = have(KINDER, 'legal_status_graph.json') ? false : 'БНбД 31-24-22 багц олдсонгүй';
const skipSchool = have(SCHOOL, 'canonical_rules.jsonl') ? false : 'БНбД 31-25-22 багц олдсонгүй';
const skipGeoAdmin = have(GEO, 'legal_status_graph.json') && !skipAdmin ? false : 'БНбД 11-03-21 / 31-23-12 багц олдсонгүй';

function fresh(folders: string[]) {
  const db = openKnowledgeDb({ path: ':memory:' });
  const counts = folders.map((f) => ingestDataset(db, f));
  return { db, counts };
}

/* ── Хэлбэр таних ────────────────────────────────────────────────── */

test('amended_rules — canonical_rules + section_index хосоор танигдана; duty_rules байхгүй', () => {
  const files = new Set(['document.json', 'knowledge_chunks.jsonl', 'aliases.json', 'canonical_rules.jsonl', 'section_index.jsonl', 'legal_status_graph.json']);
  assert.equal(detectProfile((f) => files.has(f)), 'amended_rules');
  // legalinfo хэлбэр ХЭВЭЭР legalinfo — шинэ профайл түүнийг дарахгүй.
  const legal = new Set(['duty_rules.jsonl', 'legal_status_graph.json', 'canonical_clause_rules.jsonl']);
  assert.equal(detectProfile((f) => legal.has(f)), 'legalinfo_rules');
});

/* ── Тоон мөр ─────────────────────────────────────────────────────── */

test('хоёр тооны массив нь ЗӨВХӨН range/between-д муж; `>= [100, 50]` нь зарласан утга', () => {
  const rows = legalinfoNumericRows(
    [
      { rule_id: 'D:APP-A1:gym', locator: 'APP-A1', name: 'gym_min', operator: '>=', value: [100, 50], unit: 'm2' },
      { rule_id: 'D:4.1.8:pg', locator: '4.1.8', name: 'special_playground', operator: 'range', value: [5, 7], unit: 'm2/child' },
      // ⚠️ 31-25-22 урд зайтай харьцуулагч бичсэн.
      { rule_id: 'D:2.5:area', locator: '2.5', name: 'classroom_area', operator: ' >=', value: 2.5, unit: 'm2/student' },
    ],
    'verified_official_text',
  );
  assert.equal(rows[0]!.value, '100, 50');
  assert.deepEqual(rows[1]!.value, [5, 7]);
  assert.equal(rows[2]!.operator, '>=');
});

/* ── Ерөнхий хүснэгт ──────────────────────────────────────────────── */

test('тоон бус хүснэгтийн id орно; баганын гарчигтай мөр зипэгдэнэ; хаяг section_path-ийн эхэнд', () => {
  const t = legalinfoGenericTables(
    'D',
    {
      '6.1': {
        title: 'Өрөөний хаалганаас гарц хүртэлх хамгийн их зай',
        locator: '6.2.3, Хүснэгт 6.1',
        columns_people_per_m2: ['≤2', '2–3', '>5'],
        rows: [{ route: 'мухар хонгил', class: 'C0', m: [30, 25, 10] }],
      },
      'APP-A1': {
        title: 'Нэмэлт өрөөний хамгийн бага талбай',
        locator: 'А хавсралт, А.1 хүснэгт',
        rows: [{ room: 'бассейн', min_m2: [90, 50] }],
      },
    },
    'verified_official_text',
  );
  assert.equal(t.chunks.length, 2);
  const fire = t.chunks[0]!;
  assert.equal(fire.table_no, 6.1);
  assert.match(fire.text_mn, /people per m2 ≤2 → 30; people per m2 2–3 → 25; people per m2 >5 → 10/);
  assert.equal(fire.section_path, '6.2.3, Хүснэгт 6.1 / Өрөөний хаалганаас гарц хүртэлх хамгийн их зай');
  const app = t.chunks[1]!;
  assert.equal(app.table_no, null);
  assert.equal(app.chunk_id, 'D:table:APP-A1:row:1');
  assert.equal(app.row_no, '1');
  assert.match(app.section_path ?? '', /^А хавсралт, А\.1 хүснэгт \//);
  // Баганын гарчиггүй хүснэгтэд массив нь хуучнаараа « | » -аар.
  assert.match(app.text_mn, /min_m2: 90 \| 50/);
  // Хаяг нь эшлэлд хүрдэг — хүснэгтийн дугаар, заалт, хуудас алга ч «хавсралт, хүснэгт» үгтэй.
  const c = buildCitation({ doc_id: 'D', code: 'БНбД 31-24-22', title_mn: 't', effective_status: 'x', table_no: null, row_no: null, clause_no: null, page: null, section_path: app.section_path });
  assert.equal(isCitable(c), true);
});

/* ── Хавсралтын хаяг ──────────────────────────────────────────────── */

test('appendixChunkId — «Appendix V»/«Хавсралт Д» → байгаа хэсэг (латин ↔ кирилл), заалт → null', () => {
  const exists = (id: string): boolean => ['D:appendix:В', 'D:appendix:Д', 'D:appendix:A'].includes(id);
  assert.equal(appendixChunkId('D', 'Appendix V', exists), 'D:appendix:В');
  assert.equal(appendixChunkId('D', 'Хавсралт Д', exists), 'D:appendix:Д');
  assert.equal(appendixChunkId('D', 'Appendix A', exists), 'D:appendix:A');
  assert.equal(appendixChunkId('D', 'Хавсралт Дэд', exists), null);
  assert.equal(appendixChunkId('D', '4.17', exists), null);
});

test('extractDocRef — хавсралтын үсэг хаяг; дэд дугаар бүтнээрээ; «хавсралтын», «-ийн хавсралт» биш', () => {
  assert.equal(extractDocRef('БНбД 31-23-12-ийн Хавсралт В юу шаарддаг вэ?').appendix, 'В');
  assert.equal(extractDocRef('БНбД 11-03-21 Хавсралт B-10 Хөрсний лабораторийн шинжилгээ').appendix, 'B-10');
  assert.equal(extractDocRef('БНбД 11-08-23 А.1 хавсралт').appendix, 'А.1');
  assert.equal(extractDocRef('БНбД 31-23-12 Appendix V').appendix, 'V');
  assert.equal(extractDocRef('хавсралтын дүрэм юу вэ').appendix, undefined);
  assert.equal(extractDocRef('УББ 12-01-01-ийн хавсралт юу вэ').appendix, undefined);
});

test('isCitable — хавсралтын хаяг шошгонд байвал эшлэгддэг; зөвхөн «Legal status» бол үгүй; мөр ганцаараа хаяг', () => {
  const base = { doc_id: 'D', code: 'БНбД 31-23-12', title_mn: 't', effective_status: 'x', table_no: null, row_no: null, clause_no: null, page: null };
  assert.equal(isCitable(buildCitation({ ...base, section_path: 'Хавсралт Д / Хавсралт' })), true);
  assert.equal(isCitable(buildCitation({ ...base, section_path: 'Legal status' })), false);
  assert.equal(isCitable(buildCitation({ ...base, section_path: '4. Ерөнхий зүйл' })), false);
  assert.equal(isCitable(buildCitation({ ...base, section_path: null, row_no: '3' })), true);
});

/* ── Alias ────────────────────────────────────────────────────────── */

test('keyword_alias_index — ӨГҮҮЛБЭР alias болохгүй (aliases.json-той ижил дүрэм)', () => {
  const rows = normalizeAliasRows([
    { alias: 'БНбД 31-25-22 2.4', target_id: 'D:2.4', language: 'mn' },
    { alias: 'Бие даасан сургуулийн барилга ≤1400 сурагч байх ёстой гэж заасан.', target_id: 'D:2.4', language: 'mn' },
  ]);
  assert.deepEqual(rows.map((r) => r.alias), ['БНбД 31-25-22 2.4']);
});

/* ── amended_rules адаптер ────────────────────────────────────────── */

const AMEND = normalizeAmendments([
  { clause: '5.1.6', old_phrase: '7 ба түүнээс доош баллын', current_phrase: '6 ба түүнээс доош баллын', amendment_order: '36', amendment_date: '2024-02-16', source_url: 'https://legalinfo.mn/x.pdf' },
]);

test('amendedRulesChunks — каноник заалт verified, бүлгийн хаалт needs_human_review, өөрчлөгдсөн заалт тушаалын хаягтай', () => {
  const chunks = amendedRulesChunks(
    [
      { chunk_id: 'S:status', kind: 'legal_status', text_mn: 'Current amended norm', source_url: 'https://legalinfo.mn/s', direct_answer: true },
      { chunk_id: 'S:2.4', kind: 'canonical_rule', locator: '2.4', text_mn: 'Бие даасан сургууль ≤1400 сурагч.', source_url: 'https://legalinfo.mn/t', direct_answer: true, amended_2024: false },
      { chunk_id: 'S:5.1.6', kind: 'canonical_rule', locator: '5.1.6', text_mn: '2024 оны өөрчлөлтийг хэрэглэнэ.', source_url: 'https://legalinfo.mn/t', direct_answer: true, amended_2024: true },
      { chunk_id: 'S:section:5.2.9', kind: 'source_gate', locator: '5.2.9', text_mn: '5.2.9 — Спорт заал: эхийг шалга.', source_url: 'https://legalinfo.mn/t', direct_answer: false },
    ],
    [
      { section: '2', title_mn: 'Ерөнхий зүйл' },
      { section: '5.1', title_mn: 'Эзлэхүүн төлөвлөлт' },
      { section: '5.2.9', title_mn: 'Спорт заал' },
    ],
    [{ rule_id: 'S:2.4', tags: ['capacity'] }],
    AMEND,
    'БНбД 31-25-22',
  );
  const [status, c24, c516, gate] = chunks as [typeof chunks[0], typeof chunks[0], typeof chunks[0], typeof chunks[0]];
  assert.equal(status.verification_status, 'verified_official_text');
  assert.equal(c24.clause_no, '2.4');
  assert.equal(c24.section_path, '2 Ерөнхий зүйл');
  assert.match(c24.search_text, /capacity/);
  assert.equal(isExecutableVerification(c24.verification_status), true);
  // Өөрчлөгдсөн заалт: хаягийн ЭХНИЙ сегмент нь тушаал — эшлэлийн шошгонд гарна.
  assert.equal(c516.section_path, '2024 өөрчлөлт: тушаал №36 (2024-02-16) / 5.1 Эзлэхүүн төлөвлөлт');
  assert.match(c516.search_text, /нэмэлт өөрчлөлт/);
  // ⚠️ Хуучин үг хэллэг хайлтын мөрөнд ОРОХГҮЙ — «7 балл» асуулт хуучин утгыг олохгүй.
  assert.doesNotMatch(c516.search_text, /7 ба түүнээс доош/);
  assert.equal((c516.metadata as { answer_source: { amendment_url: string } }).answer_source.amendment_url, 'https://legalinfo.mn/x.pdf');
  // Хаалт: хайгдана, гүйцэтгэгдэхгүй; заалтын хаягтай.
  assert.equal(gate.verification_status, 'needs_human_review');
  assert.equal(gate.clause_no, '5.2.9');
  assert.equal(gate.section_path, '5.2.9 Спорт заал');

  const rules = amendedRulesRules(chunks, AMEND);
  assert.equal(rules.length, 4);
  const r516 = rules.find((r) => r.chunk_id === 'S:5.1.6')!;
  assert.match(r516.notes.join(' '), /тушаал №36/);
  assert.match(r516.notes.join(' '), /хуучин «7 ба түүнээс доош баллын» → одоо «6 ба түүнээс доош баллын»/);
  assert.ok(r516.aliases_mn.includes('нэмэлт өөрчлөлт'));
  const rStatus = rules.find((r) => r.chunk_id === 'S:status')!;
  assert.ok(rStatus.aliases_mn.includes('хүчин төгөлдөр'));
});

test('normalizeCases — chunkIdOf нь хэсгийн id-г ПРОФАЙЛААР угсарна', () => {
  const cases = normalizeCases([{ id: 'B001', rule: '2.4', input: { students: 1400 }, expected: { pass: true } }], { docId: 'S', code: 'БНбД 31-25-22' }, amendedChunkId);
  assert.equal(cases[0]!.expected_rule_id, 'S:2.4');
  assert.equal(cases[0]!.query_mn, 'БНбД 31-25-22 2.4');
});

/* ── Бодит багцууд ────────────────────────────────────────────────── */

test('31-23-12 — code нь current_code-оос, хавсралтын 43 тоон мөр эх хэсэгтэй, хуучин кодоор олдоно', { skip: skipAdmin }, () => {
  const { db, counts } = fresh([ADMIN]);
  const c = counts[0]!;
  assert.equal(c.profile, 'legalinfo_rules');
  // 120 багцын хэсэг + 43 хүснэгтийн мөр (7 хүснэгт).
  assert.equal(c.chunks, 163);
  assert.equal(c.rulesByKind.threshold, 190);
  assert.equal(c.rulesByKind.table_row, 43);
  assert.deepEqual(c.orphanRules, []);
  // GAP-025 (2026-09-14): багц мөр бүрдээ `official_mcis_pdf` гэж зарладаг (үүрлэсэн) — төлөв нь
  //    ӨӨРИЙНХӨӨРӨӨ санд орно (өмнө нь `verified_official_text` гэж чимээгүй дээшлүүлэгдэж байв);
  //    ЭЗЭН тэр мөрийг эх сурвалжийн эрхээр батлав → хаалттай 4 (8.9, 9.4 … `needs_human_review`)
  //    + 1 хуулийн төлөвийн хэсэг (`official_legalinfo`, тоон нөхцөлгүй — өмнө нь өгөгдмөлөөр
  //    `verified_official_text` болдог байсан; одоо зарласан төлөв нь хэвээр, бүртгэлтэй хаалттай).
  assert.equal(c.unverifiedRules, 5);
  assert.equal(c.verification.statuses['official_mcis_pdf']?.class, 'executable');
  assert.deepEqual(c.verification.unknown, []);
  const stored = db.prepare('SELECT verification_status, COUNT(*) n FROM ai_rules WHERE doc_id = ? GROUP BY 1 ORDER BY n DESC').all('BNBD-31-23-12-2012') as { verification_status: string; n: number }[];
  assert.equal(stored[0]?.verification_status, 'official_mcis_pdf', 'зарласан төлөв хэвээр хадгалагдана');
  const doc = db.prepare('SELECT code FROM ai_documents WHERE doc_id = ?').get('BNBD-31-23-12-2012') as { code: string };
  assert.equal(doc.code, 'БНбД 31-23-12');

  // Хавсралт Д-гийн ажлын байрны талбай — хэсэг нь `appendix:Д`, тооцоо детерминист, эшлэл хаягтай.
  const a = askNorm(db, 'БНбД 31-23-12 Хавсралт Д хэлтсийн даргын ажлын байрны талбай', {
    context: { 'хэлтсийн_дарга_ахлах_мэргэжилтэн_ерөнхий_нягтлан_154': 9 },
  });
  assert.equal(a.rule_id, 'BNBD-31-23-12-2012:APP-D:хэлтсийн_дарга_ахлах_мэргэжилтэн_ерөнхий_нягтлан_154');
  assert.equal(a.status, 'verified');
  assert.equal(a.citation?.label_mn, 'БНбД 31-23-12, Хавсралт Д');
  assert.match(a.citation?.source_url ?? '', /mcis\.gov\.mn/);

  // Хавсралтын ҮСЭГ нь хаяг — зургаан хавсралт дундаас яг В.
  const v = askNorm(db, 'БНбД 31-23-12-ийн Хавсралт В юу шаарддаг вэ?');
  assert.equal(v.evidence[0]?.chunk_id, 'BNBD-31-23-12-2012:appendix:В');

  // Хуучин код (2022 онд солигдсон) нь тэр баримтыг нэрлэнэ.
  const legacy = askNorm(db, 'БНбД 31-04-12 4.17 лифт', { context: { level_difference_m: 12 } });
  assert.equal(legacy.citation?.doc_id, 'BNBD-31-23-12-2012');
  assert.equal(legacy.rule_id, 'BNBD-31-23-12-2012:4.17:elevator_general_height');
  assert.deepEqual(legacy.decisions, { elevator_general_height: true });
  db.close();
});

test('GAP-032 · «лифтний хонгилын хана» нь 31-23-12 §6.3.6 (ХОЛБОХ хонгил, REI45)-ийг ЗЭЭЛЭХГҮЙ — олдсонгүй', { skip: skipAdmin }, () => {
  const { db } = fresh([ADMIN]);
  // Эх шалтгаан: «хонгил» + «хана» гэсэн хоёр үгээр §6.3.6 давхцлын босго давдаг; асуултын
  //    сэдэв «лифт» (корпуст 2 хэсэгт л) тэр хэсэгт огт байхгүй.  Лифтний хонгилын галд
  //    тэсвэрлэлт энэ санд БАЙХГҮЙ тул зөв хариу = олдсонгүй (зээлсэн заалтаас аюулгүй).
  const a = askNorm(db, 'Лифтний хонгилын хананы галд тэсвэрлэх хугацаа хэдэн цаг байх ёстой вэ?');
  assert.equal(a.status, 'insufficient_evidence');
  assert.equal(a.rule_id, null);
  assert.equal(a.no_match_reason, 'no_content_overlap');
  assert.ok(!(a.evidence ?? []).some((e) => e.chunk_id.endsWith(':clause:6.3.6')));
  // Эерэг хяналт: лифтний тухай асуулт лифтний заалтыг олно; холбох хонгилын асуулт §6.3.6-г олно.
  const lift = askNorm(db, 'Лифтний тоог юугаар тогтоох вэ?');
  assert.equal(lift.evidence[0]?.chunk_id, 'BNBD-31-23-12-2012:clause:4.17');
  const corridor = askNorm(db, 'Холбох хонгилын хана галд хэр тэсвэртэй байх вэ?');
  assert.equal(corridor.evidence[0]?.chunk_id, 'BNBD-31-23-12-2012:clause:6.3.6');
  db.close();
});

test('11-03-21-ийн «Хавсралт B-10» нь B-1…B-5-аар ШАХАГДАХГҮЙ (хаяг бүтнээрээ таарна)', { skip: skipGeoAdmin }, () => {
  const { db } = fresh([GEO, ADMIN]);
  const a = askNorm(db, 'БНбД 11-03-21 Хавсралт B-10 Хөрсний лабораторийн физик шинжилгээ, стандарт');
  assert.equal(a.evidence[0]?.chunk_id, 'BNBD-11-03-21-2022:appendix:B-10');
  db.close();
});

test('31-24-22 — хаалттай заалт хайгдана гэвч гүйцэтгэгдэхгүй; тоон бус хүснэгтийн мөр ордог', { skip: skipKinder }, () => {
  const { db, counts } = fresh([KINDER]);
  const c = counts[0]!;
  // 213 багцын хэсэг + 45 хүснэгтийн мөр (6 хүснэгт; APP-B1 нь мөргүй — хориотой).
  assert.equal(c.chunks, 258);
  assert.equal(c.rulesByKind.table_row, 45);
  assert.equal(c.rulesByKind.threshold, 203);
  assert.deepEqual(c.orphanRules, []);
  // GAP-025: `registered_full_text` (үүрлэсэн, 508 мөр) — эзэн эх сурвалжийн эрхээр батлав (2026-09-14);
  //    65 `needs_human_review` + 4 `usable_for_current_compliance: false` тоон мөр (багцын өөрийн хаалт
  //    эх сурвалжийн төлөвөөс дээгүүр → `source_render_review`) + 1 тушаалын хэсэг (`official_order`) = 70.
  assert.equal(c.unverifiedRules, 70);
  assert.equal(c.verification.statuses['registered_full_text']?.class, 'executable');
  const gated = db.prepare("SELECT COUNT(*) n FROM ai_rules WHERE doc_id = ? AND verification_status = 'source_render_review'").get('BNBD-31-24-22-2022') as { n: number };
  assert.equal(gated.n, 4, 'usable=false мөр эзний whitelist-ээр ч гүйцэтгэгдэхгүй');
  assert.equal(c.verification.statuses['registered_full_text']?.class, 'executable');

  const gate = askNorm(db, 'БНбД 31-24-22 4.1.7');
  assert.equal(gate.rule_id, 'BNBD-31-24-22-2022:clause:4.1.7:requirement');
  assert.equal(gate.status, 'uncertain');
  assert.match(gate.citation?.source_url ?? '', /legalinfo\.mn/);

  const ok = askNorm(db, 'БНбД 31-24-22 4.1.6 улаан шугамаас зай', { context: { urban_redline_m: 24.9 } });
  assert.equal(ok.rule_id, 'BNBD-31-24-22-2022:4.1.6:urban_redline_distance:002');
  assert.equal(ok.status, 'verified');
  assert.deepEqual(ok.decisions, { urban_redline_distance: false });

  const row = db.prepare('SELECT section_path, row_no FROM ai_chunks WHERE chunk_id = ?').get('BNBD-31-24-22-2022:table:APP-V1:row:1') as { section_path: string; row_no: string };
  assert.match(row.section_path, /^В хавсралт, В\.1 хүснэгт \//);
  db.close();
});

test('31-25-22 — amended_rules: 87 хэсэг бүр дүрэмтэй, 45 хаалт, 5.1.6-ийн эшлэлд тушаал №36', { skip: skipSchool }, () => {
  const { db, counts } = fresh([SCHOOL]);
  const c = counts[0]!;
  assert.equal(c.profile, 'amended_rules');
  assert.equal(c.chunks, 87);
  assert.equal(c.rulesByKind.requirement, 87);
  assert.equal(c.rulesByKind.threshold, 49);
  assert.deepEqual(c.orphanRules, []);
  assert.equal(c.unverifiedRules, 45);

  const a = askNorm(db, 'БНбД 31-25-22 5.1.6 газар хөдлөлтийн балл');
  assert.equal(a.rule_id, 'BNBD-31-25-22-2022-AMENDED-2024:5.1.6:requirement');
  assert.equal(a.citation?.label_mn, 'БНбД 31-25-22, 2024 өөрчлөлт: тушаал №36 (2024-02-16), заалт 5.1.6');

  const n = askNorm(db, 'БНбД 31-25-22 2.4', { context: { students: 1401 } });
  assert.equal(n.status, 'verified');
  assert.deepEqual(n.decisions, { standalone_school_students: false });
  assert.equal(n.citation?.label_mn, 'БНбД 31-25-22, 2 Ерөнхий зүйл, заалт 2.4');

  const gate = askNorm(db, 'БНбД 31-25-22 5.2.9 спорт заал');
  assert.equal(gate.evidence[0]?.chunk_id, 'BNBD-31-25-22-2022-AMENDED-2024:section:5.2.9');
  assert.equal(gate.status, 'uncertain');
  db.close();
});
