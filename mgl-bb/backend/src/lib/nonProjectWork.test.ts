/**
 * `lib/nonProjectWork.ts`-ийн тест.  Файл нь импортгүй, цэвэр функц тул
 * `registerHooks` шаардлагагүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NON_PROJECT_CATEGORIES,
  entryStage,
  findOverlap,
  halfOfCheckpoint,
  nonProjectCreditMinutes,
  lunchWindowOf,
  normalizeReport,
  parseHhmm,
  parseNonProjectPicks,
  planPicks,
  validateEntryInput,
  workMinutes,
} from './nonProjectWork.ts';

const LUNCH = lunchWindowOf({ lunchEnabled: true, lunchStart: '12:00', lunchEnd: '13:00' });

test('эзний ангиллууд, зөвхөн «Бусад» тайлбар шаардана', () => {
  assert.deepEqual(
    NON_PROJECT_CATEGORIES.map((c) => c.key),
    ['author_supervision', 'document_exchange', 'drawing_exchange', 'drawing_printing', 'meeting', 'other'],
  );
  assert.deepEqual(
    NON_PROJECT_CATEGORIES.filter((c) => c.requiresNote).map((c) => c.key),
    ['other'],
  );
});

test('parseHhmm: зөв ба буруу хэлбэр', () => {
  assert.equal(parseHhmm('09:30'), 570);
  assert.equal(parseHhmm('23:59'), 1439);
  assert.equal(parseHhmm('10:00:00'), 600);
  assert.equal(parseHhmm('24:00'), null);
  assert.equal(parseHhmm('9:30'), null);
  assert.equal(parseHhmm(930), null);
});

test('workMinutes: цайны цагийг ирцтэй ижил хасна', () => {
  assert.equal(workMinutes(9 * 60, 18 * 60, LUNCH), 8 * 60);
  assert.equal(workMinutes(10 * 60, 12 * 60, LUNCH), 120);
  assert.equal(workMinutes(12 * 60 + 30, 14 * 60, LUNCH), 60);
  assert.equal(workMinutes(12 * 60, 13 * 60, LUNCH), 0);
  // Цайны цаг унтраасан бол бүтэн хугацаа.
  assert.equal(workMinutes(9 * 60, 18 * 60, null), 9 * 60);
  assert.equal(
    lunchWindowOf({ lunchEnabled: false, lunchStart: '12:00', lunchEnd: '13:00' }),
    null,
  );
});

test('validateEntryInput: амжилттай тохиолдол цагийг хэвийжүүлнэ', () => {
  const r = validateEntryInput(
    { category: 'drawing_printing', start_time: '10:00:00', end_time: '15:30' },
    LUNCH,
  );
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.startTime, '10:00');
  assert.equal(r.value.endTime, '15:30');
  assert.equal(r.value.minutes, 270);
  assert.equal(r.value.note, null);
});

test('validateEntryInput: «Бусад» тайлбаргүй бол татгалзана', () => {
  const r = validateEntryInput({ category: 'other', note: '   ', start_time: '09:00', end_time: '10:00' }, LUNCH);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, 'NOTE_REQUIRED');
  const ok = validateEntryInput(
    { category: 'other', note: ' Тавилга зөөх ', start_time: '09:00', end_time: '10:00' },
    LUNCH,
  );
  assert.ok(ok.ok && ok.value.note === 'Тавилга зөөх');
});

test('validateEntryInput: «Бусад» биш ангилалд note хадгалахгүй', () => {
  const r = validateEntryInput(
    { category: 'author_supervision', note: 'илүүдэл', start_time: '09:00', end_time: '10:00' },
    LUNCH,
  );
  assert.ok(r.ok && r.value.note === null);
});

test('validateEntryInput: дууссан цаг ээлжийн төгсгөлөөс хойш байж болохгүй', () => {
  const earlyEnd = 17 * 60;
  const ok = validateEntryInput(
    { category: 'drawing_printing', start_time: '16:00', end_time: '17:00' },
    LUNCH,
    earlyEnd,
  );
  assert.ok(ok.ok && ok.value.endTime === '17:00');
  const late = validateEntryInput(
    { category: 'drawing_printing', start_time: '16:00', end_time: '17:01' },
    LUNCH,
    earlyEnd,
  );
  assert.equal(late.ok, false);
  if (late.ok) return;
  assert.equal(late.code, 'AFTER_SHIFT_END');
  assert.match(late.error, /17:00/);
  const standard = validateEntryInput(
    { category: 'drawing_printing', start_time: '17:00', end_time: '18:00' },
    LUNCH,
    18 * 60,
  );
  assert.ok(standard.ok);
});

test('validateEntryInput: буруу ангилал, цаг, дараалал, бүтэн цайны цаг', () => {
  const codes = [
    validateEntryInput({ category: 'paper_pasting', start_time: '09:00', end_time: '10:00' }, LUNCH),
    validateEntryInput({ category: 'drawing_printing', start_time: '9', end_time: '10:00' }, LUNCH),
    validateEntryInput({ category: 'drawing_printing', start_time: '11:00', end_time: '11:00' }, LUNCH),
    validateEntryInput({ category: 'drawing_printing', start_time: '12:00', end_time: '13:00' }, LUNCH),
  ].map((r) => (r.ok ? 'OK' : r.code));
  assert.deepEqual(codes, ['INVALID_CATEGORY', 'INVALID_TIME', 'END_BEFORE_START', 'ZERO_DURATION']);
});

test('normalizeReport + entryStage', () => {
  assert.equal(normalizeReport('  '), null);
  assert.equal(normalizeReport(null), null);
  assert.equal(normalizeReport(' ok '), 'ok');
  assert.equal(entryStage({ status: 'pending', report: null, start_time: '10:00' }), 'needs_report');
  assert.equal(entryStage({ status: 'pending', report: 'хийсэн', start_time: '10:00' }), 'awaiting_review');
  // Ирцэд сонгосон (цаггүй) мөр тайлбартай ч «Миний ажлууд»-аас цагаа оруулах хүртэл илгээгдээгүй.
  assert.equal(entryStage({ status: 'pending', report: 'хийсэн', start_time: null }), 'needs_report');
  assert.equal(entryStage({ status: 'pending', report: null, start_time: null }), 'needs_report');
  assert.equal(entryStage({ status: 'approved', report: 'хийсэн', start_time: null }), 'approved');
  assert.equal(entryStage({ status: 'rejected', report: null, start_time: null }), 'rejected');
});

test('findOverlap: зэргэлдээ нь давхцахгүй, татгалзсан ба өөрийгөө алгасна', () => {
  const rows = [
    { id: 1, start_time: '09:00', end_time: '11:00', status: 'pending' as const },
    { id: 2, start_time: '13:00', end_time: '15:00', status: 'rejected' as const },
  ];
  assert.equal(findOverlap(rows, { start: 11 * 60, end: 12 * 60 }), null);
  assert.equal(findOverlap(rows, { start: 10 * 60, end: 12 * 60 })?.id, 1);
  assert.equal(findOverlap(rows, { start: 13 * 60, end: 14 * 60 }), null);
  assert.equal(findOverlap(rows, { start: 10 * 60, end: 12 * 60 }, 1), null);
});

test('nonProjectCreditMinutes: 15:00-д гараад 15–17 төслийн бус ажил → 120 минут', () => {
  const r = nonProjectCreditMinutes(
    [{ start: 9 * 60, end: 15 * 60 }],
    [{ start: 15 * 60, end: 17 * 60 }],
    LUNCH,
  );
  assert.equal(r, 120);
});

test('nonProjectCreditMinutes: оффист байх үеийн ажил давхар тоологдохгүй', () => {
  // 09–17 оффист, 10–11 төслийн бус ажил → session аль хэдийн хамарсан.
  assert.equal(
    nonProjectCreditMinutes([{ start: 540, end: 1020 }], [{ start: 600, end: 660 }], LUNCH),
    0,
  );
  // Хэсэгчилсэн давхцал: 16:00-д гарсан, 15–17 ажил → 60.
  assert.equal(
    nonProjectCreditMinutes([{ start: 540, end: 960 }], [{ start: 900, end: 1020 }], LUNCH),
    60,
  );
});

test('nonProjectCreditMinutes: цайны цаг хасагдана, давхардсан ажил нэг удаа', () => {
  // 11:00-д гараад 11–14 ба 13–15 (давхцалтай) → 11–15 = 240 − цай 60 = 180.
  assert.equal(
    nonProjectCreditMinutes(
      [{ start: 540, end: 660 }],
      [
        { start: 660, end: 840 },
        { start: 780, end: 900 },
      ],
      LUNCH,
    ),
    180,
  );
  // Цайны тохиргоо унтраалттай → 240.
  assert.equal(
    nonProjectCreditMinutes([{ start: 540, end: 660 }], [{ start: 660, end: 900 }], null),
    240,
  );
});

test('nonProjectCreditMinutes: нээлттэй session өдрийн төгсгөл хүртэл хамарна', () => {
  // 12:00-д гарч 12–14 ажилд явсан, 13:30-д буцаж орсон (нээлттэй): 12–13 цай,
  // 13:30-аас хойш session хамарна → зөвхөн 13:00–13:30 = 30.
  assert.equal(
    nonProjectCreditMinutes(
      [
        { start: 540, end: 720 },
        { start: 810, end: null },
      ],
      [{ start: 720, end: 840 }],
      LUNCH,
    ),
    30,
  );
  // Өглөө ирэхээс өмнө 08–10 гадуур ажил, 10:00-д ирсэн → 120.
  assert.equal(
    nonProjectCreditMinutes([{ start: 600, end: 1080 }], [{ start: 480, end: 600 }], LUNCH),
    120,
  );
});

test('nonProjectCreditMinutes: ажил, session байхгүй бол 0', () => {
  assert.equal(nonProjectCreditMinutes([{ start: 540, end: 900 }], [], LUNCH), 0);
});

/* ---- Цаггүй бүртгэл, ирцийн сонголт (0356/0357) ---- */

test('validateEntryInput: цаг хоёулаа хоосон бол цаггүй, нэг л бол алдаа', () => {
  for (const body of [
    { category: 'meeting' },
    { category: 'meeting', start_time: '', end_time: '  ' },
    { category: 'meeting', start_time: null, end_time: null },
  ]) {
    const r = validateEntryInput(body, LUNCH, 18 * 60);
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.value.startTime, null);
    assert.equal(r.value.endTime, null);
    assert.equal(r.value.minutes, null);
  }
  const half = validateEntryInput({ category: 'meeting', start_time: '10:00', end_time: '' }, LUNCH);
  assert.equal(half.ok ? 'OK' : half.code, 'INVALID_TIME');
  // «Бусад»-ын тайлбар цаггүй үед ч заавал.
  const other = validateEntryInput({ category: 'other' }, LUNCH);
  assert.equal(other.ok ? 'OK' : other.code, 'NOTE_REQUIRED');
});

test('halfOfCheckpoint: өглөө → am, 14:00 ба гарах → pm (зөвхөн харуулахад)', () => {
  assert.equal(halfOfCheckpoint('morning'), 'am');
  assert.equal(halfOfCheckpoint('afternoon'), 'pm');
  assert.equal(halfOfCheckpoint('clock_out'), 'pm');
});

test('parseNonProjectPicks: талбаргүй = null, давхардал хасна, буруу бол алдаа', () => {
  assert.deepEqual(parseNonProjectPicks(undefined), { ok: true, picks: null });
  assert.deepEqual(parseNonProjectPicks([]), { ok: true, picks: [] });
  const r = parseNonProjectPicks([
    { category: 'meeting' },
    { category: 'meeting', report: 'x' },
    { category: 'other', note: 'Цаас' },
    { category: 'other', note: ' цаас ' },
    { category: 'other', note: 'Хурал', report: '  тайлан  ' },
  ]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.picks, [
    { category: 'meeting', note: null, report: null },
    { category: 'other', note: 'Цаас', report: null },
    { category: 'other', note: 'Хурал', report: 'тайлан' },
  ]);
  for (const bad of [{}, 'meeting', [{ category: 'paper_pasting' }], [{ category: 'other' }]]) {
    assert.equal(parseNonProjectPicks(bad).ok, false);
  }
});

test('planPicks: ижил хүлээгдэж буй мөрийг дахин ашиглана', () => {
  const entries = [
    { id: 1, category: 'meeting', note: null, status: 'approved' as const, start_time: null, report: 'ok' },
    { id: 2, category: 'meeting', note: null, status: 'pending' as const, start_time: '15:00', report: null },
    { id: 3, category: 'meeting', note: null, status: 'pending' as const, start_time: null, report: null },
    { id: 4, category: 'other', note: 'Цаас', status: 'pending' as const, start_time: null, report: null },
  ];
  const plan = planPicks(entries, [
    { category: 'meeting', note: null, report: 'хурал хийв' },
    { category: 'other', note: 'ЦААС', report: null },
    { category: 'author_supervision', note: null, report: null },
  ]);
  // Цаггүй (3) нь цагтай (2)-оос түрүүлнэ; батлагдсан (1) хэзээ ч биш.
  assert.deepEqual(
    plan.map((p) => p.entry?.id ?? null),
    [3, 4, null],
  );
});
