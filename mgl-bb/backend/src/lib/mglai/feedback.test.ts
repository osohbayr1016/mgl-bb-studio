/**
 * MGL AI · САНАЛ ХҮСЭЛТИЙН ТӨЛӨВИЙН МАШИН — ТЕСТ (§32).
 *
 * Run with:  node --test src/lib/mglai/feedback.test.ts
 *
 * ⚠️ ГОЛ АМЛАЛТ: «Never let a malicious employee poison the live model
 *    through dislikes.»  Доорх «хордуулалт» блок нь тэрийг барина.
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

const { canTransition, trainingEligible, normalizeReasons, FEEDBACK_STATES, isFeedbackState } =
  await import('./feedback.ts');

type In = Parameters<typeof canTransition>[0];

function t(over: Partial<In>): In {
  return {
    from: 'pending',
    to: 'reviewed',
    isAdmin: true,
    hasCorrection: false,
    isNegative: false,
    ...over,
  } as In;
}

/* ================================================================== */
/*  1. Хордуулалтын эсрэг                                              */
/* ================================================================== */

test('АДМИН БИШ хүн ямар ч шилжилт хийж ЧАДАХГҮЙ', () => {
  for (const to of ['reviewed', 'approved', 'rejected', 'needs_correction'] as const) {
    const r = canTransition(t({ from: 'pending', to, isAdmin: false }));
    assert.equal(r.ok, false, to);
  }
});

test('pending → included_in_dataset ШУУД зам БАЙХГҮЙ', () => {
  // Баталгаагүй санал багцад ОРОХ ГАРЦ БАЙХГҮЙ.
  const r = canTransition(t({ from: 'pending', to: 'included_in_dataset', datasetVersion: 'v1' }));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, 'not_allowed');
});

test('pending → approved ШУУД зам ч БАЙХГҮЙ — хяналт ЗААВАЛ', () => {
  const r = canTransition(t({ from: 'pending', to: 'approved' }));
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.error, 'not_allowed');
});

test('👎 санал нь ЗАЛРУУЛГАГҮЙГЭЭР батлагдахгүй', () => {
  const no = canTransition(
    t({ from: 'reviewed', to: 'approved', isNegative: true, hasCorrection: false }),
  );
  assert.equal(no.ok, false);
  assert.equal(no.ok === false && no.error, 'requires_correction');

  const yes = canTransition(
    t({ from: 'reviewed', to: 'approved', isNegative: true, hasCorrection: true }),
  );
  assert.equal(yes.ok, true);
});

test('👍 санал нь залруулгагүй батлагдана', () => {
  const r = canTransition(t({ from: 'reviewed', to: 'approved', isNegative: false }));
  assert.equal(r.ok, true);
});

/* ================================================================== */
/*  2. Багцын хувилбар                                                 */
/* ================================================================== */

test('багцад оруулахад ХУВИЛБАР заавал', () => {
  const no = canTransition(t({ from: 'approved', to: 'included_in_dataset' }));
  assert.equal(no.ok, false);
  assert.equal(no.ok === false && no.error, 'requires_dataset_version');

  const yes = canTransition(
    t({ from: 'approved', to: 'included_in_dataset', datasetVersion: 'mgl-dataset-1.1.0' }),
  );
  assert.equal(yes.ok, true);
});

/* ================================================================== */
/*  3. Эцсийн төлөв                                                    */
/* ================================================================== */

test('included_in_training_run нь ЭЦСИЙН — түүхийг дахин бичихгүй', () => {
  for (const to of FEEDBACK_STATES) {
    const r = canTransition(t({ from: 'included_in_training_run', to }));
    assert.equal(r.ok, false, to);
    assert.equal(r.ok === false && r.error, 'terminal', to);
  }
});

test('rejected нь pending руу л буцна', () => {
  assert.equal(canTransition(t({ from: 'rejected', to: 'pending' })).ok, true);
  assert.equal(canTransition(t({ from: 'rejected', to: 'approved' })).ok, false);
});

/* ================================================================== */
/*  4. Бүтэн мөчлөг                                                    */
/* ================================================================== */

test('§32-ийн БҮТЭН мөчлөг ажиллана', () => {
  const steps: [string, string, Partial<In>][] = [
    ['pending', 'reviewed', {}],
    ['reviewed', 'approved', { isNegative: true, hasCorrection: true }],
    ['approved', 'included_in_dataset', { datasetVersion: 'mgl-dataset-1.1.0' }],
    ['included_in_dataset', 'included_in_training_run', {}],
  ];
  for (const [from, to, extra] of steps) {
    const r = canTransition(t({ from: from as never, to: to as never, ...extra }));
    assert.equal(r.ok, true, `${from} → ${to}`);
  }
});

/* ================================================================== */
/*  5. Сургалтад тэнцэх                                                */
/* ================================================================== */

test('зөвхөн батлагдсан/багцад орсон мөр сургалтад тэнцэнэ', () => {
  assert.equal(trainingEligible('approved'), true);
  assert.equal(trainingEligible('included_in_dataset'), true);
  assert.equal(trainingEligible('pending'), false);
  assert.equal(trainingEligible('reviewed'), false);
  assert.equal(trainingEligible('rejected'), false);
  assert.equal(trainingEligible('needs_correction'), false);
});

/* ================================================================== */
/*  6. Шалтгааны цэвэрлэгээ                                            */
/* ================================================================== */

test('танихгүй шалтгаан чимээгүй хаягдана, давхардал арилна', () => {
  assert.deepEqual(normalizeReasons(['incorrect', 'zzz', 'incorrect', 'slow']), [
    'incorrect',
    'slow',
  ]);
  assert.deepEqual(normalizeReasons('incorrect'), []);
  assert.deepEqual(normalizeReasons(null), []);
});

test('isFeedbackState нь хаалттай', () => {
  assert.equal(isFeedbackState('approved'), true);
  assert.equal(isFeedbackState('APPROVED'), false);
  assert.equal(isFeedbackState(1), false);
});
