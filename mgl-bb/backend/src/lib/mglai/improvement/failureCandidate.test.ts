/**
 * MGL AI · АЛДААНЫ НЭР ДЭВШИГЧ — ТЕСТ (Session B §19, §35).
 *
 * Run with:  node --test src/lib/mglai/improvement/failureCandidate.test.ts
 *
 *   ⚠️ ГОЛ АМЛАЛТ: 👎 → SFT гэсэн ШУУД зам БАЙХГҮЙ.
 *     • NEW → APPROVED_SFT шилжилт байхгүй
 *     • RAW (ариутгаагүй) мөрөөс SFT нэр дэвшигч үүсэхгүй
 *     • 👍 нь алдааны нэр дэвшигч болохгүй
 *     • чиглүүлэлт нь reason + trusted тугаар
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

const { candidateFromFeedback, canTransitionFailure, mapFeedbackReasons, recommendRoute, redactCandidateText, sftCandidateFrom, exportRecord, FAILURE_STATUSES } =
  await import('./failureCandidate.ts');

const fb = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 7,
  conv_uid: 'conv_1',
  msg_uid: 'msg_1',
  user_id: 12,
  vote: -1,
  reason_codes_json: '["wrong_regulation","too_short"]',
  reason_text: null,
  corrected_answer: 'Зөв хариулт',
  prompt_snapshot: 'В2 галын ачаалал хэд вэ?',
  answer_snapshot: 'Буруу хариулт',
  model_version: '1.0.0',
  runtime_variant: 'employee-8b-q4',
  system_prompt_version: 'mglai-sys-6',
  tool_schema_version: 'mglai-tools-1',
  context_ref: 'msg_1',
  ...over,
});

test('👎 → NEW нэр дэвшигч, RAW, хувилбарын тамгатай, чиглүүлэлтийн зөвлөмжтэй', () => {
  const c = candidateFromFeedback(fb() as never, { failureUid: 'fail_1', knowledgeVersion: 'norms-1', normRegistryVersion: 'nr-18', runtimeVersion: '1.0.0' });
  assert.ok(c);
  assert.equal(c!.status, 'NEW');
  assert.equal(c!.redaction_status, 'RAW');
  assert.equal(c!.reason_code, 'WRONG_SOURCE');
  const v = JSON.parse(c!.versions_json) as Record<string, string>;
  assert.equal(v.knowledge, 'norms-1');
  assert.equal(v.normRegistry, 'nr-18');
  assert.equal(v.system_prompt, 'mglai-sys-6');
  assert.equal(c!.recommended_route, 'RETRIEVAL_ISSUE');
});

test('👍 → нэр дэвшигч ҮГҮЙ', () => {
  assert.equal(candidateFromFeedback(fb({ vote: 1 }) as never, { failureUid: 'x' }), null);
});

test('шалтгааны эрэмбэ: unsafe > calculation > source > answer', () => {
  assert.equal(mapFeedbackReasons(['too_long', 'unsafe_action']), 'UNSAFE_ACTION');
  assert.equal(mapFeedbackReasons(['incorrect', 'wrong_regulation']), 'WRONG_SOURCE');
  assert.equal(mapFeedbackReasons(['slow']), 'TOO_SLOW');
  assert.equal(mapFeedbackReasons([], ['WRONG_CALCULATION']), 'WRONG_CALCULATION');
  assert.equal(mapFeedbackReasons(['garbage']), 'OTHER');
});

test('НЭВ → APPROVED_SFT шууд БАЙХГҮЙ; TRIAGED → APPROVED_SFT ч байхгүй', () => {
  assert.equal(canTransitionFailure('NEW', 'APPROVED_SFT'), false);
  assert.equal(canTransitionFailure('TRIAGED', 'APPROVED_SFT'), false);
  assert.equal(canTransitionFailure('NEW', 'MODEL_BEHAVIOR'), true);
  assert.equal(canTransitionFailure('MODEL_BEHAVIOR', 'APPROVED_SFT'), true);
  assert.equal(canTransitionFailure('RETRIEVAL_ISSUE', 'APPROVED_SFT'), false);
  assert.equal(canTransitionFailure('RETRIEVAL_ISSUE', 'APPROVED_REGRESSION'), true);
  for (const s of FAILURE_STATUSES) assert.equal(canTransitionFailure('RESOLVED', s), false);
  assert.equal(canTransitionFailure('REJECTED', 'NEW'), true);
});

test('чиглүүлэлт (§22)', () => {
  assert.equal(recommendRoute({ reason: 'WRONG_CALCULATION', validator: null, trusted: null }).status, 'CALCULATION_ISSUE');
  assert.equal(recommendRoute({ reason: 'WRONG_ANSWER', validator: null, trusted: { calculation_used: true } }).status, 'CALCULATION_ISSUE');
  assert.equal(recommendRoute({ reason: 'WRONG_SOURCE', validator: null, trusted: { citation_issue: true } }).status, 'CITATION_ISSUE');
  assert.equal(recommendRoute({ reason: 'WRONG_SOURCE', validator: null, trusted: { no_match: true } }).status, 'RETRIEVAL_ISSUE');
  // Trusted дүн зөв байсан ч загвар өөрчилсөн → SFT/зан төлөв
  const r = recommendRoute({ reason: 'WRONG_ANSWER', validator: { failures: ['NUMBER_CHANGED'] }, trusted: { contract_violations: ['NUMBER_CHANGED'] } });
  assert.equal(r.status, 'MODEL_BEHAVIOR');
  assert.equal(r.target, 'MODEL_BEHAVIOR');
  assert.equal(recommendRoute({ reason: 'BAD_MONGOLIAN', validator: null, trusted: null }).target, 'MODEL_BEHAVIOR');
  assert.equal(recommendRoute({ reason: 'TOO_SLOW', validator: null, trusted: null }).status, 'UI_ISSUE');
  assert.equal(recommendRoute({ reason: 'OTHER', validator: null, trusted: null }).status, 'TRIAGED');
});

test('SFT нэр дэвшигч: RAW → null; ангилагдаагүй → null; REDACTED + MODEL_BEHAVIOR → DRAFT', () => {
  const base = { id: 1, status: 'MODEL_BEHAVIOR', redaction_status: 'REDACTED', question_text: 'Асуулт', corrected_answer: 'Зорилт', reason_code: 'BAD_MONGOLIAN' };
  assert.equal(sftCandidateFrom({ ...base, redaction_status: 'RAW' }, 'u'), null);
  assert.equal(sftCandidateFrom({ ...base, status: 'NEW' }, 'u'), null);
  assert.equal(sftCandidateFrom({ ...base, status: 'RETRIEVAL_ISSUE' }, 'u'), null);
  assert.equal(sftCandidateFrom({ ...base, corrected_answer: null }, 'u'), null);
  const c = sftCandidateFrom(base, 'sft_1')!;
  assert.equal(c.review_state, 'DRAFT');
  assert.equal(c.category, 'style');
  assert.equal(c.language, 'mn');
});

test('ариутгал — и-мэйл, утас, Овог.Нэр, токен', () => {
  const t = redactCandidateText('Б.Батбаяр bat@mglenc.com 9911-2233 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjEyfQ.abcdefghijklmnop123');
  assert.equal(t.includes('@'), false);
  assert.equal(t.includes('9911'), false);
  assert.equal(t.includes('Батбаяр'), false);
  assert.equal(t.includes('eyJ'), false);
});

test('exportRecord — suite-ээс хамааралгүй ерөнхий JSON', () => {
  const r = exportRecord({ candidate_uid: 'c1', failure_id: 7, target: 'NORM', question: 'q', expected: { status: 'refusal' }, failure_class: 'RETRIEVAL_ISSUE', versions: { knowledge: 'k1' }, approval_state: 'APPROVED' });
  assert.equal(r.source, 'failure:7');
  assert.equal(r.target, 'NORM');
});
