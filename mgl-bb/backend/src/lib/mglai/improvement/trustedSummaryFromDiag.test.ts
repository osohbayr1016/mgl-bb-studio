/**
 * MGL AI · diag_json → TrustedResultFeedbackSummary адаптер — ТЕСТ (Session D).
 *
 * Fixture-үүд нь Session A-ийн `routes/mglAi.ts sanitizeDiag()`-ийн ЯГ гаралтын хэлбэрээр.
 * Run: node --test src/lib/mglai/improvement/trustedSummaryFromDiag.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) return nextResolve(`${specifier}.ts`, context);
    return nextResolve(specifier, context);
  },
});

const { summaryFromDiag, diagTrustedSummaryProvider } = await import('./trustedSummaryFromDiag.ts');

const diag = (o: Record<string, unknown>) => JSON.stringify({ mode: 'authoritative', risk: 'high', attempts: 1, final: 'model', buffered: true, violations: [], turn: 'NEW_TOPIC', norm: null, ...o });

test('тооцоолуур → calculation, authoritative, calculator id, verified', () => {
  const s = summaryFromDiag(diag({ norm: { kind: 'calculation', verification: 'verified', authoritative: true, document: 'БД 21-101-12', records: ['BD-21-101-12:formula:22'], calculator: 'fire_load_density', followups: [], warnings: [] } }));
  assert.equal(s?.kind, 'calculation');
  assert.equal(s?.authoritative, true);
  assert.equal(s?.sourceDocumentCode, 'БД 21-101-12');
  assert.equal(s?.ruleOrFormulaId, 'fire_load_density');
  assert.equal(s?.verificationState, 'verified');
  assert.equal(s?.noMatch, false);
  assert.equal(s?.validatorOutcome, 'pass');
});

test('ангилал authoritative → norm_decision; authoritative биш → norm_lookup', () => {
  const a = summaryFromDiag(diag({ norm: { kind: 'classification', verification: 'verified', authoritative: true, document: 'БД 21-101-12', records: ['r1'], calculator: null, followups: [], warnings: [] } }));
  assert.equal(a?.kind, 'norm_decision');
  const b = summaryFromDiag(diag({ norm: { kind: 'classification', verification: 'needs_human_review', authoritative: false, document: 'БД 21-101-12', records: ['r1'], calculator: null, followups: [], warnings: ['source_boundary_conflict'] } }));
  assert.equal(b?.kind, 'norm_lookup');
  assert.equal(b?.verificationState, 'needs_human_review');
  assert.equal(b?.ruleOrFormulaId, 'r1');
});

test('§18 — retrieval_failed нь noMatch БИШ; named_document_absent / no_match нь noMatch', () => {
  const failed = summaryFromDiag(diag({ norm: { kind: 'unverified', verification: 'retrieval_failed', authoritative: false, document: null, records: [], calculator: null, followups: [], warnings: [] } }));
  assert.equal(failed?.kind, 'norm_refusal');
  assert.equal(failed?.noMatch, false, 'хайлт унасан ≠ олдсонгүй');
  const absent = summaryFromDiag(diag({ norm: { kind: 'no_match', verification: 'named_document_absent', authoritative: false, document: 'УББ 11-202-00', records: [], calculator: null, followups: [], warnings: [] } }));
  assert.equal(absent?.kind, 'norm_refusal');
  assert.equal(absent?.noMatch, true);
});

test('data_version_mismatch (Amendment A) нь verificationState-д хэвээр дамжина, authoritative false', () => {
  const s = summaryFromDiag(diag({ norm: { kind: 'classification', verification: 'data_version_mismatch', authoritative: false, document: 'БД 21-101-12', records: ['r1'], calculator: null, followups: [], warnings: [] } }));
  assert.equal(s?.verificationState, 'data_version_mismatch');
  assert.equal(s?.authoritative, false);
  assert.equal(s?.kind, 'norm_lookup');
});

test('норм биш: mode free → free; grounded → company_data; refusal → norm_refusal+noMatch', () => {
  assert.equal(summaryFromDiag(diag({ mode: 'free' }))?.kind, 'free');
  assert.equal(summaryFromDiag(diag({ mode: 'grounded' }))?.kind, 'company_data');
  const r = summaryFromDiag(diag({ mode: 'refusal' }));
  assert.equal(r?.kind, 'norm_refusal');
  assert.equal(r?.noMatch, true);
});

test('validator: repaired/regenerated/template дамжина; зөрчлийн код нэгтгэгдэнэ; эшлэлийн асуудал', () => {
  const s = summaryFromDiag(diag({ final: 'repaired', violations: [['UNSUPPORTED_NUMBER', 'FAKE_CITATION'], ['FAKE_CITATION']] }));
  assert.equal(s?.validatorOutcome, 'repaired');
  assert.deepEqual(s?.validatorViolations, ['UNSUPPORTED_NUMBER', 'FAKE_CITATION']);
  assert.equal(s?.citationIssue, true);
  assert.equal(summaryFromDiag(diag({ final: 'template' }))?.validatorOutcome, 'template');
  // model + зөрчилтэй = засагдсан гэж үзнэ (гэрээ хэрэгжсэн)
  assert.equal(summaryFromDiag(diag({ final: 'model', violations: [['TRAILER_MISSING']] }))?.validatorOutcome, 'repaired');
});

test('текст ОРОХГҮЙ: гаралтад зөвхөн код/төлөв; эвдэрсэн JSON / null → null', () => {
  const s = summaryFromDiag(diag({ norm: { kind: 'requirement', verification: 'verified', authoritative: true, document: 'УББ 12-01-01', records: ['UBB:clause:2.5'], calculator: null, followups: ['f1'], warnings: ['some warning text'] } }));
  assert.ok(!JSON.stringify(s).includes('warning text'));
  assert.equal(summaryFromDiag('{not json'), null);
  assert.equal(summaryFromDiag(null), null);
  assert.equal(summaryFromDiag('[]'), null);
});

test('provider: ai_messages.diag_json-оос уншина (D1 хэлбэрийн хуурамч)', async () => {
  const calls: unknown[][] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async <T,>() => {
          calls.push([sql, ...args]);
          return { diag_json: diag({ norm: { kind: 'calculation', verification: 'verified', authoritative: true, document: 'БД 21-101-12', records: [], calculator: 'q', followups: [], warnings: [] } }) } as T;
        },
      }),
    }),
  };
  const s = await diagTrustedSummaryProvider(db).summaryForMessage('conv1', 'msg1');
  assert.equal(s?.kind, 'calculation');
  assert.match(String(calls[0]![0]), /FROM ai_messages WHERE conv_uid = \? AND msg_uid = \?/);
  assert.deepEqual(calls[0]!.slice(1), ['conv1', 'msg1']);
});
