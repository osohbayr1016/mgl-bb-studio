/**
 * MGL AI · ХАРИУЛТЫН ГЭРЭЭ — ТЕСТ (§17, §23).
 *
 * Run with:  node --test src/lib/mglai/answerContract.test.ts
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

const { buildAnswerContract, LEGAL_REVIEW_TRAILER_MN, LEGAL_REVIEW_TRAILER_EN, NORM_REFUSAL_MN } = await import('./answerContract.ts');

const base = { regulatory: false, evidenceCount: 0, normDecision: null, responseLanguage: 'mn-Cyrl' as const, normTaskIndex: null, taskCount: 1 };

test('хүний хяналт шаардлагатай баримт → norm_legal_review трейлер (mn/en), татгалзал БИШ', () => {
  // Amendment D (2026-09-11): `unknown_requires_legal_verification` = NEEDS_HUMAN_REVIEW → трейлер;
  // харин `current_status_not_checked…` нь «одоо мөрдөгдөж буй, нэмэлт өөрчлөлт шалгаагүй» —
  // ТОВЧ ТЭМДЭГЛЭЛ (мета), «хуучин» трейлер БИШ (доорх тест).
  const c = buildAnswerContract({ ...base, regulatory: true, evidenceCount: 3, localNorm: { legalReviewRequired: true, effectiveStatus: 'unknown_requires_legal_verification', documentCode: 'БНбД 21-04-05' } });
  assert.equal(c.kind, 'norm_legal_review');
  assert.equal(c.trailerText, LEGAL_REVIEW_TRAILER_MN);
  assert.ok(!/хуучин/.test(c.trailerText ?? ''), '«хуучин» гэсэн үг зөвхөн HISTORICAL/SUPERSEDED-д');
  assert.equal(c.requiredSentence, null, 'нотолгоо БАЙГААтул татгалзахгүй');
  assert.equal(c.allowedNumbers, null, 'заалтын тоог хасахгүй');
  const en = buildAnswerContract({ ...base, regulatory: true, evidenceCount: 1, responseLanguage: 'en', localNorm: { legalReviewRequired: true, effectiveStatus: 'unknown_requires_legal_verification', documentCode: null } });
  assert.equal(en.trailerText, LEGAL_REVIEW_TRAILER_EN);
});

test('Amendment D · «нэмэлт өөрчлөлт шалгаагүй» баримт → трейлергүй (товч тэмдэглэл мета өгөгдөлд)', () => {
  const c = buildAnswerContract({ ...base, regulatory: true, evidenceCount: 3, localNorm: { legalReviewRequired: true, effectiveStatus: 'current_status_not_checked_for_later_amendments', documentCode: 'БД 21-101-12' } });
  assert.equal(c.trailerText, null);
  assert.equal(c.kind, 'norm_legal_review');
});

test('хүчин төгөлдөр баримт → трейлергүй; нотолгоогүй норм → татгалзал хэвээр', () => {
  const ok = buildAnswerContract({ ...base, regulatory: true, evidenceCount: 2, localNorm: { legalReviewRequired: false, effectiveStatus: 'in_force', documentCode: 'X' } });
  assert.equal(ok.kind, 'none');
  const none = buildAnswerContract({ ...base, regulatory: true, evidenceCount: 0, localNorm: { legalReviewRequired: true, effectiveStatus: null, documentCode: null } });
  assert.equal(none.kind, 'norm_refusal');
  assert.equal(none.requiredSentence, NORM_REFUSAL_MN);
});

test('шинжилгээний хэмжүүр → analysis_metric трейлер; нормын асуултад орохгүй', () => {
  const c = buildAnswerContract({ ...base, metricNote: 'Хэмжүүр: идэвхийн оноо … албан ёсны KPI биш.' });
  assert.equal(c.kind, 'analysis_metric');
  assert.match(c.trailerText ?? '', /KPI биш/);
  const norm = buildAnswerContract({ ...base, regulatory: true, evidenceCount: 0, metricNote: 'x' });
  assert.equal(norm.kind, 'norm_refusal', 'норм нь хэмжүүрээс давамгайлна');
});
