/**
 * `lib/leaveOverlap.ts`-ийн тест.  Файл нь импортгүй, цэвэр функц тул
 * `registerHooks` шаардлагагүй — шууд статик импорт хийж болно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveSpansOverlap, findOverlappingLeave, type LeaveSpan } from './leaveOverlap.ts';

/** Бүтэн өдрийн чөлөө. */
const full = (start: string, end: string = start): LeaveSpan => ({
  start_date: start,
  end_date: end,
  start_time: null,
  end_time: null,
});

/** Нэг өдрийн, цагийн хүрээтэй чөлөө. */
const timed = (date: string, from: string, to: string): LeaveSpan => ({
  start_date: date,
  end_date: date,
  start_time: from,
  end_time: to,
});

test('огноо огтлолцохгүй бол давхцахгүй', () => {
  assert.equal(leaveSpansOverlap(full('2026-08-10'), full('2026-08-11')), false);
  assert.equal(
    leaveSpansOverlap(full('2026-08-01', '2026-08-05'), full('2026-08-06', '2026-08-09')),
    false,
  );
});

test('ижил бүтэн өдөр давхцана', () => {
  assert.equal(leaveSpansOverlap(full('2026-08-10'), full('2026-08-10')), true);
});

test('хүрээ хэсэгчлэн давхцана', () => {
  assert.equal(
    leaveSpansOverlap(full('2026-08-01', '2026-08-05'), full('2026-08-05', '2026-08-09')),
    true,
  );
  assert.equal(
    leaveSpansOverlap(full('2026-08-03', '2026-08-04'), full('2026-08-01', '2026-08-09')),
    true,
  );
});

test('нэг өдрийн цагийн чөлөө хоёулаа — цаг огтлолцвол л давхцана', () => {
  // 10:00–12:00 vs 13:00–15:00 → зэрэгцээ биш
  assert.equal(leaveSpansOverlap(timed('2026-08-10', '10:00', '12:00'), timed('2026-08-10', '13:00', '15:00')), false);
  // Хилийн тохиолдол: 10:00–12:00 vs 12:00–14:00 → шүргэлцэж байгаа ч давхцахгүй
  assert.equal(leaveSpansOverlap(timed('2026-08-10', '10:00', '12:00'), timed('2026-08-10', '12:00', '14:00')), false);
  // 10:00–12:00 vs 11:00–13:00 → давхцана
  assert.equal(leaveSpansOverlap(timed('2026-08-10', '10:00', '12:00'), timed('2026-08-10', '11:00', '13:00')), true);
});

test('бүтэн өдөр vs цагийн чөлөө — үргэлж давхцана', () => {
  assert.equal(leaveSpansOverlap(full('2026-08-10'), timed('2026-08-10', '10:00', '12:00')), true);
  assert.equal(leaveSpansOverlap(timed('2026-08-10', '10:00', '12:00'), full('2026-08-10')), true);
});

test('олон өдрийн мөрөнд цаг байсан ч бүтэн өдөр мэт үзнэ', () => {
  const multiDayTimed: LeaveSpan = {
    start_date: '2026-08-10',
    end_date: '2026-08-12',
    start_time: '10:00',
    end_time: '12:00',
  };
  assert.equal(leaveSpansOverlap(multiDayTimed, timed('2026-08-11', '15:00', '17:00')), true);
});

test('findOverlappingLeave эхний давхцсаныг буцаана', () => {
  const rows = [
    { ...full('2026-08-01'), id: 1 },
    { ...timed('2026-08-10', '13:00', '15:00'), id: 2 },
    { ...full('2026-08-10'), id: 3 },
  ];
  // 09:00–11:00 нь id=2-той давхцахгүй ч id=3 (бүтэн өдөр)-тэй давхцана.
  assert.equal(findOverlappingLeave(timed('2026-08-10', '09:00', '11:00'), rows)?.id, 3);
  assert.equal(findOverlappingLeave(full('2026-08-20'), rows), null);
});
