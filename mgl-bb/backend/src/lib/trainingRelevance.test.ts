/**
 * node --test src/lib/trainingRelevance.test.ts
 *
 * ⚠️ `registerHooks` ШААРДЛАГАГҮЙ — `trainingRelevance.ts` нь `./bimEvents`
 *    -ээс ЗӨВХӨН ТӨРӨЛ импортолдог (`import type`), тиймээс ажиллах үед
 *    импорт үүсэхгүй.  ГЭХДЭЭ ЭНЭ ФАЙЛ өөрөө `LEARNING_EVENT_KINDS`-ыг
 *    (утга) хэрэглэх ёстой — түлхүүрийн ТООГ тулгах цорын ганц арга тэр —
 *    тиймээс `bimEvents`-ыг `registerHooks`-той динамик импортоор авна
 *    (`bimEvents.test.ts`-ийн ЯГ ИЖИЛ хэв маяг).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Апп-ын эх код нь өргөтгөлгүй импорт бичдэг; Node-ийн ESM loader түүнийг
// шийддэггүй.  `bimEvents.test.ts:24-31`-ийн заншил.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { LEARNING_EVENT_KINDS } = await import('./bimEvents.ts');
const {
  TRAINING_RELEVANCE,
  relevanceOf,
  isCoreTrainingEligible,
  isVerifiedTeamSource,
  VERIFICATION_STATES,
} = await import('./trainingRelevance.ts');

/** Тэнцсэн суурь оролт — тест бүр ЗӨВХӨН нэг талбарыг өөрчилнө. */
function eligible(over: Record<string, unknown> = {}) {
  return {
    kind: 'FINAL_APPROVAL' as const,
    partsMissing: 0,
    verificationState: null,
    teamSource: 'binding',
    teamCode: 'BA',
    currentVerifiedTeam: 'BA',
    packPublished: true,
    identityMatch: 'unknown' as const,
    ...over,
  };
}

test('1 · TRAINING_RELEVANCE нь LEARNING_EVENT_KINDS-ыг БҮРЭН хамарна', () => {
  assert.equal(Object.keys(TRAINING_RELEVANCE).length, LEARNING_EVENT_KINDS.length);
  for (const k of LEARNING_EVENT_KINDS) {
    assert.ok(TRAINING_RELEVANCE[k], `${k} нь TRAINING_RELEVANCE-д алга`);
  }
});

test('2 · амьдралын мөчлөг ба багажийн дуудлага нь never', () => {
  for (const k of ['SESSION_START', 'SESSION_END', 'TOOL_INVOKED', 'TOOL_RESULT'] as const) {
    assert.equal(relevanceOf(k, { verificationState: null }), 'never', k);
    // ⚠️ verification state ЯМАР Ч БАЙСАН never хэвээр.
    assert.equal(relevanceOf(k, { verificationState: 'HUMAN_VERIFIED' }), 'never', k);
  }
});

test('3 · AI_PREDICTION нь verification state-ээс ҮЛ ХАМААРАН evaluation_only', () => {
  for (const vs of [null, ...VERIFICATION_STATES]) {
    assert.equal(relevanceOf('AI_PREDICTION', { verificationState: vs }), 'evaluation_only');
  }
});

test('4 · RULE_VALIDATION + HUMAN_VERIFIED → core', () => {
  assert.equal(relevanceOf('RULE_VALIDATION', { verificationState: 'HUMAN_VERIFIED' }), 'core');
});

test('5 · RULE_VALIDATION + UNVERIFIED → evaluation_only', () => {
  assert.equal(relevanceOf('RULE_VALIDATION', { verificationState: 'UNVERIFIED' }), 'evaluation_only');
  // CLAUSE_CITED ч гэсэн ХҮРЭЛЦЭХГҮЙ — заалт иш татсан нь хүн шалгасан гэсэн үг БИШ.
  assert.equal(relevanceOf('RULE_VALIDATION', { verificationState: 'CLAUSE_CITED' }), 'evaluation_only');
});

test('6 · RULE_VALIDATION + null (тамгалагч бичээгүй) → evaluation_only', () => {
  assert.equal(relevanceOf('RULE_VALIDATION', { verificationState: null }), 'evaluation_only');
});

test('7 · isCoreTrainingEligible нь sheet_prefix багийн эх сурвалж дээр false', () => {
  assert.equal(isVerifiedTeamSource('sheet_prefix'), false);
  assert.equal(isVerifiedTeamSource('behavior'), false);
  assert.equal(isVerifiedTeamSource('user_primary'), false);
  assert.equal(isCoreTrainingEligible(eligible({ teamSource: 'sheet_prefix' })), false);
  // Суурь оролт өөрөө ТЭНЦЭНЭ — эс бөгөөс дээрх шалгалт утгагүй.
  assert.equal(isCoreTrainingEligible(eligible()), true);
});

test('8 · хөлдөөсөн баг нь өнөөдрийн баталгаажсан багтай зөрвөл false', () => {
  assert.equal(
    isCoreTrainingEligible(eligible({ teamCode: 'BA', currentVerifiedTeam: 'IZ' })),
    false,
  );
});

test('9 · үлдсэн хаалганууд — parts_missing, багц, identity', () => {
  assert.equal(isCoreTrainingEligible(eligible({ partsMissing: 1 })), false);
  // Дүрмийн багцгүй баг (MGMT · EZ · GT) нь ЭНД зогсоно — жагсаалтгүйгээр.
  assert.equal(isCoreTrainingEligible(eligible({ packPublished: false })), false);
  assert.equal(isCoreTrainingEligible(eligible({ identityMatch: 'mismatch' })), false);
  // ЭЗЭНГҮЙ оролт: 'unknown' нь БЛОКЛОХГҮЙ (суурь оролт аль хэдийн true).
  assert.equal(isCoreTrainingEligible(eligible({ identityMatch: 'match' })), true);
  // AI гаралт нь БҮХ бусад нөхцөл хангасан ч ЦӨМД орохгүй.
  assert.equal(isCoreTrainingEligible(eligible({ kind: 'AI_PREDICTION' })), false);
  // Баталгаажсан дүрмийн вердикт нь ЦӨМД ОРНО.
  assert.equal(
    isCoreTrainingEligible(
      eligible({ kind: 'RULE_VALIDATION', verificationState: 'HUMAN_VERIFIED' }),
    ),
    true,
  );
});
