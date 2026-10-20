/**
 * MGL AI · ИТГЭМЖЛЭГДСЭН ДҮНГИЙН ХУРААНГУЙ АДАПТЕР — ТЕСТ (P0-4).
 *
 * Run with:  node --test src/lib/mglai/improvement/trustedSummary.test.ts
 *
 *   • цагаан жагсаалт: мэдэгдэхгүй түлхүүр/урт текст/объект хаягдана
 *   • хувилбар зөрвөл null (хуучин мөр хэвээр уншигдана)
 *   • чиглүүлэлтийн дохио: calculation → CALCULATION_ISSUE, citationIssue → CITATION_ISSUE
 *   • NULL_PROVIDER нь null буцаана (Session D холбох хүртэл)
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

const { sanitizeTrustedSummary, toRoutingSignals, NULL_TRUSTED_SUMMARY_PROVIDER, TRUSTED_SUMMARY_SCHEMA_VERSION } = await import('./trustedSummary.ts');
const { recommendRoute } = await import('./failureCandidate.ts');

test('цагаан жагсаалт — нууц/урт/объект талбар орохгүй', () => {
  const s = sanitizeTrustedSummary({
    schemaVersion: 1,
    kind: 'norm_decision',
    authoritative: true,
    sourceDocumentCode: 'БНбД 21-04-05',
    ruleOrFormulaId: 'bnbd-21-04-05:clause:3.9:numeric',
    verificationState: 'verified',
    resultFingerprint: 'ab12cd34',
    validatorOutcome: 'repaired',
    validatorViolations: ['NUMBER_CHANGED', 'bad code!', 'FAKE_CITATION'],
    prompt: 'нууц prompt',
    clauseText: 'бүтэн заалтын текст',
    evidence: [{ text: 'x' }],
    noMatch: false,
  });
  assert.ok(s);
  assert.deepEqual(Object.keys(s!).sort(), ['authoritative', 'kind', 'noMatch', 'resultFingerprint', 'ruleOrFormulaId', 'schemaVersion', 'sourceDocumentCode', 'validatorOutcome', 'validatorViolations', 'verificationState']);
  assert.deepEqual(s!.validatorViolations, ['NUMBER_CHANGED', 'FAKE_CITATION']);
  assert.equal(JSON.stringify(s).includes('нууц'), false);
});

test('хувилбар зөрвөл null; мэдэгдэхгүй kind → unknown', () => {
  assert.equal(sanitizeTrustedSummary({ schemaVersion: TRUSTED_SUMMARY_SCHEMA_VERSION + 1, kind: 'x' }), null);
  assert.equal(sanitizeTrustedSummary({ kind: 'norm_decision' }), null);
  assert.equal(sanitizeTrustedSummary('x'), null);
  assert.equal(sanitizeTrustedSummary({ schemaVersion: 1, kind: 'something_new' })?.kind, 'unknown');
});

test('чиглүүлэлтийн дохио → recommendRoute', () => {
  const calc = toRoutingSignals(sanitizeTrustedSummary({ schemaVersion: 1, kind: 'calculation', authoritative: true }));
  assert.equal(recommendRoute({ reason: 'WRONG_ANSWER', validator: null, trusted: calc }).status, 'CALCULATION_ISSUE');
  const cit = toRoutingSignals(sanitizeTrustedSummary({ schemaVersion: 1, kind: 'norm_lookup', citationIssue: true }));
  assert.equal(recommendRoute({ reason: 'WRONG_SOURCE', validator: null, trusted: cit }).status, 'CITATION_ISSUE');
  const rep = toRoutingSignals(sanitizeTrustedSummary({ schemaVersion: 1, kind: 'norm_decision', validatorOutcome: 'repaired' }));
  assert.deepEqual(rep?.contract_violations, ['REPAIRED']);
  assert.equal(recommendRoute({ reason: 'WRONG_ANSWER', validator: null, trusted: rep }).status, 'MODEL_BEHAVIOR');
  assert.equal(toRoutingSignals(null), null);
});

test('NULL_PROVIDER → null (Session D холбох хүртэл inbox нь reason-оор л чиглүүлнэ)', async () => {
  assert.equal(await NULL_TRUSTED_SUMMARY_PROVIDER.summaryForMessage('c', 'm'), null);
});
