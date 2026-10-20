/**
 * §16–17 — ОДОО ба ТҮҮХЭН баримтыг холихгүй: таван төлөв, төлөв бүрд өөр трейлер.
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

const C = await import('./currentness');
const AC = await import('./answerContract');
const TF = await import('./trustedFacts');
const LN = await import('./localNorm');

test('currentnessOf · локал сангийн БОДИТ статус мөрүүд зөв төлөвт буудаг', () => {
  // Amendment D (2026-09-11): долоон төлөв.  `in_force` = баталгаажсан; `current_*_verified`,
  // `current_status_not_checked…` = мөрдөгдөж буй, нэмэлт өөрчлөлт шалгаагүй; `listed_as_current` =
  // жагсаалтад бүртгэлтэй, эх бичвэр тулгаагүй.  «хуучин» ЗӨВХӨН HISTORICAL/SUPERSEDED.
  assert.equal(C.currentnessOf('in_force'), 'IN_FORCE_VERIFIED');
  assert.equal(C.currentnessOf('unknown_requires_legal_verification'), 'NEEDS_HUMAN_REVIEW');
  assert.equal(C.currentnessOf('current_status_not_checked_for_later_amendments_or_replacement'), 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED');
  assert.equal(C.currentnessOf('current_status_not_checked_for_later_amendments'), 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED');
  assert.equal(C.currentnessOf('current_registered_verified'), 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED');
  assert.equal(C.currentnessOf('current_amended_verified'), 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED');
  assert.equal(C.currentnessOf('current_code_verified_renumbered'), 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED');
  assert.equal(C.currentnessOf('listed_as_current'), 'LISTED_CURRENT_NOT_SOURCE_VERIFIED');
  assert.equal(C.currentnessOf('superseded_by_2022_edition'), 'SUPERSEDED');
  assert.equal(C.currentnessOf('хүчингүй болсон'), 'SUPERSEDED');
  assert.equal(C.currentnessOf('historical_reference'), 'HISTORICAL');
  assert.equal(C.currentnessOf(null), 'UNKNOWN');
  assert.equal(C.currentnessOf(''), 'UNKNOWN');
  // ⚠️ танигдахгүй мөр = UNKNOWN, CURRENT БИШ (хатуу тал руу алдана)
  assert.equal(C.currentnessOf('some_new_value'), 'UNKNOWN');
});

test('currentnessTrailer · CURRENT-д трейлергүй, бусад төлөв бүрд ӨӨР трейлер', () => {
  assert.equal(C.currentnessTrailer('IN_FORCE_VERIFIED', 'mn-Cyrl'), null);
  assert.equal(C.currentnessTrailer('CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED', 'mn-Cyrl'), null, 'товч тэмдэглэл, трейлер биш');
  assert.equal(C.currentnessTrailer('LISTED_CURRENT_NOT_SOURCE_VERIFIED', 'mn-Cyrl'), null);
  assert.match(C.currentnessNote('CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED', 'mn-Cyrl') ?? '', /нэмэлт, өөрчлөлт/);
  assert.ok(!/хуучин/.test(C.currentnessNote('CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED', 'mn-Cyrl') ?? ''));
  assert.ok(!/хуучин/.test(C.LEGAL_REVIEW_TRAILER_MN));
  const s = C.currentnessTrailer('SUPERSEDED', 'mn-Cyrl');
  const h = C.currentnessTrailer('HISTORICAL', 'mn-Cyrl');
  const n = C.currentnessTrailer('NEEDS_HUMAN_REVIEW', 'mn-Cyrl');
  const u = C.currentnessTrailer('UNKNOWN', 'mn-Cyrl');
  assert.ok(s && /СОЛИГДСОН/.test(s));
  assert.ok(h && /ТҮҮХЭН/.test(h));
  assert.ok(n && /хүний хяналт/.test(n));
  assert.equal(u, n, 'UNKNOWN нь хүний хяналттай ижил — тодорхойгүй = аюулгүй тал');
  assert.notEqual(s, h);
  assert.notEqual(s, n);
  assert.ok(/SUPERSEDED/.test(C.currentnessTrailer('SUPERSEDED', 'en') ?? ''));
});

test('buildAnswerContract · солигдсон локал баримт → norm_legal_review + СОЛИГДСОН трейлер', () => {
  const c = AC.buildAnswerContract({
    regulatory: true, evidenceCount: 2, normDecision: null, responseLanguage: 'mn-Cyrl', normTaskIndex: null, taskCount: 1,
    localNorm: { legalReviewRequired: true, effectiveStatus: 'superseded_by_2022_edition', documentCode: 'БНбД 00-00-00' },
  });
  assert.equal(c.kind, 'norm_legal_review');
  assert.equal(c.trailerText, C.SUPERSEDED_TRAILER_MN);
  assert.match(c.reason, /SUPERSEDED/);
  // in_force → legalReviewRequired=false → гэрээ трейлергүй
  const ok = AC.buildAnswerContract({
    regulatory: true, evidenceCount: 2, normDecision: null, responseLanguage: 'mn-Cyrl', normTaskIndex: null, taskCount: 1,
    localNorm: { legalReviewRequired: false, effectiveStatus: 'in_force', documentCode: 'БНбД 11-03-21' },
  });
  assert.notEqual(ok.kind, 'norm_legal_review');
  assert.equal(ok.trailerText, null);
});

test('buildTrustedContract · currentness нь ТӨЛӨВИЙН баримт болж гэрээнд орно (mustMention=false)', () => {
  const c = TF.buildTrustedContract({
    regulatory: true, evidenceCount: 1, normDecision: null, responseLanguage: 'en', normTaskIndex: null, taskCount: 1,
    localNorm: { legalReviewRequired: true, effectiveStatus: 'historical_reference', documentCode: 'УББ 00-00-00', currentness: 'HISTORICAL' },
    toolResults: [], intent: 'NORMATIVE', retrievalNoMatch: false,
  });
  const f = c.facts.find((x) => x.id === 'source_currentness');
  assert.ok(f);
  assert.equal(f.value, 'HISTORICAL');
  assert.equal(f.mustMention, false);
  assert.equal(c.trailerText, C.HISTORICAL_TRAILER_EN);
  assert.equal(c.risk, 'high');
});

test('parseLocalNorm · runtime-ийн хариунаас currentness тооцогдоно', () => {
  const a = LN.parseLocalNorm({
    status: 'supported', rule_id: null, rule_object_mn: null, note_mn: null, missing_context: [],
    citation: { document: 'УББ 12-01-01', label_mn: 'УББ 12-01-01, заалт 2.20, хуудас 9', clause: '2.20', page: 9, legal_review_required: true, effective_status: 'current_status_not_checked_for_later_amendments_or_replacement' },
    evidence: [{ chunk_id: 'c1', kind: 'clause', text_mn: 'Захиалагч …', page: 9, clause_no: '2.20', score: 0.5 }],
  });
  assert.ok(a);
  assert.equal(a.currentness, 'CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED');
  assert.equal(a.legalReviewRequired, true, 'runtime-ийн туг хэвээр дамжина (оношилгоо); шийдвэр нь currentness');
});
