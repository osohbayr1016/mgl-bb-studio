/**
 * GAP-025 — баталгаажилтын төлөвийн ГУРВАН ангийн бүртгэл: executable / non_executable / unknown.
 *
 * Хэмжсэн эх шалтгаан (2026-09-14): БНбД 31-23-12 (`source.verification_status: official_mcis_pdf`,
 * 326 мөр) ба 31-24-22 (`registered_full_text`, 508 мөр) мөрийн төлөвөө ҮҮРЛЭСЭН объектод бичдэг
 * тул адаптер «төлөвгүй» гэж үзээд баримтын өгөгдмөл `verified_official_text` (ЦАГААН ЖАГСААЛТ)
 * өгч байв — 349 + 395 дүрэм эзний шийдвэргүйгээр эрх бүхий болсон.  Одоо: мөрийн зарласан
 * төлөв өгөгдмөлийг дарна; бүртгэлгүй төлөв хаалттай + тайлагнагдана; хөрвүүлэгч зогсоно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  EXECUTABLE_VERIFICATION,
  KNOWN_NON_EXECUTABLE_VERIFICATION,
  classifyVerification,
  evaluateRule,
  type NormRule,
} from '../src/rules.ts';
import { rowVerification, dominantDeclaredVerification, documentVerificationFallback, legalinfoNumericRows, legalinfoChunks } from '../src/datasetProfiles.ts';
import { auditVerification } from '../src/ingest.ts';

test('гурван анги — цагаан жагсаалт, бүртгэлтэй гүйцэтгэгдэхгүй, танигдаагүй; хоёр бүртгэл огтлолцохгүй', () => {
  for (const s of EXECUTABLE_VERIFICATION) {
    assert.equal(classifyVerification(s), 'executable', s);
    assert.equal(KNOWN_NON_EXECUTABLE_VERIFICATION.has(s), false, `${s} хоёр бүртгэлд хамт байж болохгүй`);
  }
  for (const [s, reason] of KNOWN_NON_EXECUTABLE_VERIFICATION) {
    assert.equal(classifyVerification(s), 'non_executable', s);
    assert.ok(reason.length > 10, `${s}: шалтгаан заавал`);
  }
  // 2026-09-14-ний lint-д илэрсэн зургаан төлөв — БҮГД бүртгэлтэй: дөрөв нь эрх бүхий БИШ …
  for (const s of ['verified_content_extract', 'source_render_review', 'verified_locator_source_render_review', 'verified_raw_from_page_image_crosslink_needs_review']) {
    assert.equal(classifyVerification(s), 'non_executable', s);
  }
  // … хоёрыг нь ЭЗЭН эх сурвалжийн эрхээр батлав (2026-09-14) — зөвхөн энэ шалтгаанаар гүйцэтгэгдэнэ.
  for (const s of ['official_mcis_pdf', 'registered_full_text']) assert.equal(classifyVerification(s), 'executable', s);
  assert.equal(classifyVerification('brand_new_status_from_next_package'), 'unknown');
  assert.equal(classifyVerification('verified'), 'non_executable', 'ерөнхий «verified» өөрөө хэзээ ч гүйцэтгэгдэхгүй');
});

test('rowVerification — үүрлэсэн нарийн төлөв мөрийнх; үүрлэсэн ерөнхий «verified» нь эх сурвалжийнх (null)', () => {
  assert.equal(rowVerification({ verification_status: 'verified_official_text', source: { verification_status: 'official_mcis_pdf' } }), 'verified_official_text');
  assert.equal(rowVerification({ source: { verification_status: 'official_mcis_pdf' } }), 'official_mcis_pdf');
  assert.equal(rowVerification({ answer_source: { verification_status: 'registered_full_text' } }), 'registered_full_text');
  assert.equal(rowVerification({ source: { verification_status: 'verified' } }), null);
  assert.equal(rowVerification({}), null);
});

test('баримтын өгөгдмөл — зарласан төлөв `verified_official_text`-ээр ДАРАГДАХГҮЙ (чимээгүй дээшлүүлэлт байхгүй)', () => {
  const rows = Array.from({ length: 20 }, () => ({ answer_source: { verification_status: 'official_mcis_pdf' } }));
  assert.equal(dominantDeclaredVerification(rows), 'official_mcis_pdf');
  assert.equal(documentVerificationFallback({}, 'official_mcis_pdf'), 'official_mcis_pdf');
  assert.equal(documentVerificationFallback({ mcis_pdf_byte_alignment_verified: false }, 'official_mcis_pdf'), 'verified_mirror_text_mongolia_listed');
  assert.equal(documentVerificationFallback({}, null), 'verified_official_text');
  // Зөрүүтэй (олонх < 90 %) бол «баримтын өгөгдмөл» гэж хэлэхгүй.
  const mixed = [...rows.slice(0, 10), ...Array.from({ length: 10 }, () => ({ verification_status: 'verified_official_text' }))];
  assert.equal(dominantDeclaredVerification(mixed), null);
});

test('usable_for_current_compliance=true туг төлөвийг ДЭЭШЛҮҮЛЭХГҮЙ — гүйцэтгэхэд blocked_unverified', () => {
  // Танигдаагүй/бүртгэлтэй-гүйцэтгэгдэхгүй төлөв (`verified_content_extract`, 11-106-25) тугтай ч хаалттай.
  const numeric = legalinfoNumericRows(
    [
      { rule_id: 'X:4.17:h', locator: '4.17', name: 'h', operator: '>=', value: 12, unit: 'm', usable_for_current_compliance: true, source: { verification_status: 'verified_content_extract' } },
      { rule_id: 'X:4.18:w', locator: '4.18', name: 'w', operator: '>=', value: 2, unit: 'm', usable_for_current_compliance: true },
      { rule_id: 'X:4.19:z', locator: '4.19', name: 'z', operator: '>=', value: 1, unit: 'm', usable_for_current_compliance: true, source: { verification_status: 'brand_new_status' } },
    ],
    'verified_content_extract',
  );
  assert.equal(numeric[0]!.verification_status, 'verified_content_extract');
  assert.equal(numeric[1]!.verification_status, 'verified_content_extract', 'төлөвгүй мөр баримтын зарласан өгөгдмөлийг авна');
  assert.equal(numeric[2]!.verification_status, 'brand_new_status', 'ил зарласан төлөв өгөгдмөлөөр дарагдахгүй');
  // Багцын өөрийн хаалт (`usable_for_current_compliance: false`) эзний баталсан төлөвөөс ч ДЭЭГҮҮР — доошлуулна, дээшлүүлэхгүй.
  const gated = legalinfoNumericRows(
    [{ rule_id: 'X:4.20:g', locator: '4.20', name: 'g', operator: '>=', value: 1, unit: 'm', usable_for_current_compliance: false, source: { verification_status: 'registered_full_text' } }],
    'registered_full_text',
  );
  assert.equal(gated[0]!.verification_status, 'source_render_review');
  const mk = (status: string): NormRule =>
    ({
      rule_id: 'X:4.17:h',
      chunk_id: 'X:clause:4.17',
      rule_kind: 'threshold',
      object_mn: 'лифт',
      conditions: [{ key: 'h', cond: { kind: 'number', field: 'h', op: '>=', value: 12, unit: 'm' } }],
      required_context: ['h'],
      decision_policy: 'evaluate_all_conditions',
      citation_required: true,
      verification_status: status,
    }) as unknown as NormRule;
  assert.equal(evaluateRule(mk('verified_content_extract'), { h: 20 }).status, 'blocked_unverified');
  assert.equal(evaluateRule(mk('brand_new_status'), { h: 20 }).status, 'blocked_unverified', 'танигдаагүй → хаалттай');
  // Эзний баталсан эх сурвалжийн төлөв — гүйцэтгэгдэнэ (эх сурвалжийн эрх; хүчин төгөлдөр байдал тусдаа).
  assert.equal(evaluateRule(mk('official_mcis_pdf'), { h: 20 }).status, 'evaluated');
  assert.equal(evaluateRule(mk('registered_full_text'), { h: 20 }).status, 'evaluated');
  const chunks = legalinfoChunks([{ chunk_id: 'X:clause:4.17', text_mn: 'Лифт', answer_source: { verification_status: 'official_mcis_pdf' }, metadata: { allow_current_compliance_answer: true } }], 'verified_official_text');
  assert.equal(chunks[0]!.verification_status, 'official_mcis_pdf', 'зарласан төлөв хэвээр — өгөгдмөлөөр СОЛИГДОХГҮЙ');
});

test('auditVerification — танигдаагүй төлөв тоологдож ИЛ гарна; тугтай атлаа гүйцэтгэгдэхгүй мөр тусдаа', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gap025-'));
  try {
    writeFileSync(
      join(dir, 'numeric_requirements.jsonl'),
      [
        JSON.stringify({ rule_id: 'a', usable_for_current_compliance: true, source: { verification_status: 'totally_new_status' } }),
        JSON.stringify({ rule_id: 'b', usable_for_current_compliance: true, verification_status: 'verified' }),
        JSON.stringify({ rule_id: 'c', usable_for_current_compliance: true, verification_status: 'verified_content_extract' }),
        JSON.stringify({ rule_id: 'd', verification_status: 'verified_from_page_image' }),
      ].join('\n') + '\n',
    );
    const a = auditVerification(dir);
    assert.deepEqual(a.unknown, ['totally_new_status']);
    assert.equal(a.statuses['totally_new_status']?.class, 'unknown');
    assert.equal(a.statuses['verified_from_page_image']?.class, 'executable');
    // «verified» + туг = адаптерын хэвийн зам (тоологдохгүй); бусад хоёр нь тугтай атлаа хаалттай.
    assert.equal(a.markedUsableNonExecutable.rows, 2);
    assert.deepEqual(a.markedUsableNonExecutable.statuses, ['totally_new_status', 'verified_content_extract']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
