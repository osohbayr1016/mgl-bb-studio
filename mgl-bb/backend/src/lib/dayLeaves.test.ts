/**
 * `lib/dayLeaves.ts`-ийн тест.  Импортгүй цэвэр модуль — шууд статик импорт.
 * Тохиолдлууд нь 2026-09-ийн продын БОДИТ мөрүүд (leave_requests id-тай).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineDayLeaves, type DayLeaveRow } from './dayLeaves.ts';

const H = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};

function lv(p: Partial<DayLeaveRow> & Pick<DayLeaveRow, 'id' | 'leave_type'>): DayLeaveRow {
  return {
    start_date: '2026-09-01',
    end_date: '2026-09-01',
    start_time: null,
    reason: null,
    hours: null,
    arrival_orig_hours: null,
    arrival_orig_days: null,
    ...p,
  };
}

const noCuts = () => undefined;

function combine(
  leaves: DayLeaveRow[],
  shift = '08:30',
  cuts: Record<string, number> = {},
  date = '2026-09-01',
) {
  return combineDayLeaves({
    leaves,
    date,
    shiftStartMinutes: H(shift),
    cutMinutes: (id, d) => cuts[`${id}|${d}`],
    dayCapMinutes: 480,
  });
}

/** 2026-10-01 хүртэлх `buildDailyAttendanceRows`-ийн ГАНЦ чөлөөний томьёо. */
function oldSingleMinutes(l: DayLeaveRow, date: string, cuts: Record<string, number>): number {
  const cut = cuts[`${l.id}|${date}`];
  if (cut !== undefined) return cut;
  const base = l.arrival_orig_days != null ? l.arrival_orig_hours : l.hours;
  if (base == null) return 480;
  const s = new Date(l.start_date + 'T00:00:00Z').getTime();
  const e = new Date(l.end_date + 'T00:00:00Z').getTime();
  const days = Math.max(1, Math.round((e - s) / 86_400_000) + 1);
  return Math.round((base / days) * 60);
}

test('ганц чөлөөтэй өдөр хуучин томьёотой ЯГ ижил', () => {
  const cases: Array<[DayLeaveRow, Record<string, number>]> = [
    [lv({ id: 1, leave_type: 'other', start_time: '12:00', hours: 5.5 }), {}],
    [lv({ id: 2, leave_type: 'unpaid' }), {}],
    [lv({ id: 3, leave_type: 'sick', start_time: '08:30', hours: 3.5 }), {}],
    [
      lv({
        id: 4,
        leave_type: 'annual',
        start_date: '2026-08-25',
        end_date: '2026-09-02',
        hours: 62.78,
        arrival_orig_hours: 72,
        arrival_orig_days: 9,
      }),
      {},
    ],
    [lv({ id: 5, leave_type: 'annual', start_date: '2026-08-31', end_date: '2026-09-04', hours: 40 }), {}],
    [lv({ id: 6, leave_type: 'other', start_time: '09:00', hours: 1.43 }), { '6|2026-09-01': 86 }],
    [lv({ id: 7, leave_type: 'remote', hours: 2.5 }), {}],
  ];
  for (const [l, cuts] of cases) {
    const r = combine([l], '08:30', cuts);
    const old = oldSingleMinutes(l, '2026-09-01', cuts);
    assert.equal(r.minutes, old, `leave ${l.id}`);
    assert.equal(r.parts.length, 1);
    assert.equal(r.primary?.leave_id, l.id);
    assert.equal(r.annualMinutes, l.leave_type === 'annual' ? old : 0);
    assert.equal(r.paidMinutes, l.leave_type !== 'annual' && l.leave_type !== 'unpaid' ? old : 0);
  }
});

test('ирсэн цагаар 0 болтол богиносгосон чөлөө тэр өдөр чөлөө БИШ', () => {
  const r = combine([lv({ id: 9, leave_type: 'unpaid' })], '08:30', { '9|2026-09-01': 0 });
  assert.equal(r.parts.length, 0);
  assert.equal(r.primary, null);
  assert.equal(r.minutes, 0);
});

test('чөлөөгүй өдөр', () => {
  const r = combine([]);
  assert.deepEqual(r, { parts: [], minutes: 0, annualMinutes: 0, paidMinutes: 0, primary: null });
});

test('прод #46 2026-09-01: 08:30–12:00 хичээлийн нээлт + 12:00–17:30 цалингүй → хоёулаа, 8ц таазтай', () => {
  const r = combine([
    lv({ id: 356, leave_type: 'other', start_time: '08:30', hours: 3.5, reason: 'Хүүхдийн хичээлийн нээлт' }),
    lv({ id: 379, leave_type: 'unpaid', start_time: '12:00', hours: 5.5 }),
  ]);
  assert.equal(r.parts.length, 2);
  assert.deepEqual(
    r.parts.map((p) => [p.leave_id, p.start_time, p.end_time, p.minutes]),
    [
      [356, '08:30', '12:00', 210],
      [379, '12:00', '17:30', 330],
    ],
  );
  // 210 + 330 = 540 > 480 — илүү 60 (цайны цаг) нь ЦАЛИНГҮЙ хэсгээс хасагдана.
  assert.equal(r.minutes, 480);
  assert.equal(r.paidMinutes, 210);
  assert.equal(r.parts[1]!.counted_minutes, 270);
  assert.equal(r.primary?.leave_id, 379);
});

test('is_paid хэсэг бүрд дамжина; is_paid = 0 нь цалинтай минутад орохгүй', () => {
  const r = combine([
    lv({ id: 1, leave_type: 'other', start_time: '08:30', hours: 3.5, is_paid: 1 }),
    lv({ id: 2, leave_type: 'other', start_time: '12:00', hours: 2, is_paid: 0 }),
    lv({ id: 3, leave_type: 'other', start_time: '14:00', hours: 1 }),
  ]);
  assert.deepEqual(
    r.parts.map((p) => [p.leave_id, p.is_paid]),
    [
      [1, 1],
      [2, 0],
      [3, null],
    ],
  );
  // Нийт минут хэвээр; is_paid = 0 хэсэг (120) цалинтайд тоологдохгүй, NULL нь төрлөөрөө.
  assert.equal(r.minutes, 390);
  assert.equal(r.paidMinutes, 270);
});

test('2026-10-13: «Өвчтэй» (sick, is_paid = 0) цалингүй — ажилласан цагт нэмэгдэхгүй', () => {
  const r = combine([lv({ id: 1, leave_type: 'sick', is_paid: 0 })]);
  assert.equal(r.paidMinutes, 0);
  assert.equal(r.annualMinutes, 0);
  assert.equal(r.primary?.leave_type, 'sick');
  // Хуучин цалинтай «Өвчтэй» мөр хэвээр цалинтай.
  const old = combine([lv({ id: 2, leave_type: 'sick', is_paid: 1 })]);
  assert.equal(old.paidMinutes, old.minutes);
});

test('прод #45 2026-09-09: 09:00–13:00 + 14:03–18:03 хоёр хагас өдөр → 8ц', () => {
  const r = combine(
    [
      lv({ id: 398, leave_type: 'unpaid', start_date: '2026-09-09', end_date: '2026-09-09', start_time: '09:00', hours: 4 }),
      lv({ id: 401, leave_type: 'unpaid', start_date: '2026-09-09', end_date: '2026-09-09', start_time: '14:03', hours: 4 }),
    ],
    '09:00',
    {},
    '2026-09-09',
  );
  assert.equal(r.minutes, 480);
  assert.equal(r.paidMinutes, 0);
  assert.equal(r.parts.length, 2);
});

test('прод #41 2026-09-01: богиносгосон өглөөний чөлөө + үдээс хойш цалингүй', () => {
  const r = combine(
    [
      lv({ id: 376, leave_type: 'other', start_time: '09:00', hours: 1.43, arrival_orig_hours: 3, arrival_orig_days: 0.38 }),
      lv({ id: 377, leave_type: 'unpaid', start_time: '14:00', hours: 4 }),
    ],
    '09:00',
    { '376|2026-09-01': 86 },
  );
  assert.equal(r.minutes, 86 + 240);
  assert.equal(r.paidMinutes, 86);
  assert.equal(r.primary?.leave_id, 377);
});

test('прод #5 2026-09-02: давхацсан ээлжийн амралт (08:00–11:04) + 08:00–11:00 цалингүй → давхар тоолохгүй', () => {
  const r = combine(
    [
      lv({
        id: 315,
        leave_type: 'annual',
        start_date: '2026-08-25',
        end_date: '2026-09-02',
        hours: 62.78,
        arrival_orig_hours: 72,
        arrival_orig_days: 9,
      }),
      lv({ id: 378, leave_type: 'unpaid', start_date: '2026-09-02', end_date: '2026-09-02', start_time: '08:00', hours: 3 }),
    ],
    '08:00',
    { '315|2026-09-02': 184 },
    '2026-09-02',
  );
  assert.equal(r.minutes, 184);
  assert.equal(r.annualMinutes, 184);
  assert.equal(r.paidMinutes, 0);
  assert.deepEqual(
    r.parts.map((p) => [p.leave_id, p.counted_minutes]),
    [
      [315, 184],
      [378, 0],
    ],
  );
});

test('тааз цалинтайг сүүлд хөндөнө: ээлжийн амралт + цалинтай, нийт 9ц', () => {
  const r = combine([
    lv({ id: 1, leave_type: 'annual', start_time: '08:30', hours: 4 }),
    lv({ id: 2, leave_type: 'sick', start_time: '12:30', hours: 5 }),
  ]);
  assert.equal(r.minutes, 480);
  assert.equal(r.annualMinutes, 180);
  assert.equal(r.paidMinutes, 300);
});

test('цонхны давхцал хэд хэдэн хэсгийг хамарсан ч нэг л удаа хасагдана', () => {
  const r = combine([
    lv({ id: 1, leave_type: 'other', start_time: '09:00', hours: 1 }),
    lv({ id: 2, leave_type: 'other', start_time: '11:00', hours: 1 }),
    lv({ id: 3, leave_type: 'unpaid', start_time: '08:30', hours: 4 }),
  ]);
  // 08:30–12:30 нь 09–10, 11–12-ыг бүрэн хамарна → нэгдэл = 240.
  assert.equal(r.minutes, 240);
  assert.equal(r.parts.find((p) => p.leave_id === 3)!.counted_minutes, 240);
  assert.equal(r.paidMinutes, 0);
});
