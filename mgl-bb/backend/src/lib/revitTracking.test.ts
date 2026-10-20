// Revit-ийн автомат цаг бүртгэлийн цэвэр дүрэм (migration 0360).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STALE_AFTER_MS,
  addDays,
  cleanActiveMs,
  cleanState,
  isWorkDate,
  liveStatusOf,
  pickSession,
  resolveReportDate,
  validateSegment,
  MAX_MS_PER_DAY,
} from './revitTracking.ts';

const TODAY = '2026-09-29';
const seg = (over: Record<string, unknown> = {}) => ({
  segment_id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6-1',
  session_id: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6',
  user_id: 7,
  task_id: 11,
  work_date: TODAY,
  active_ms: 60_000,
  idle_ms: 5_000,
  rev: 3,
  first_at: '2026-09-29T01:00:00.000Z',
  last_at: '2026-09-29T01:01:05.000Z',
  ...over,
});

test('validateSegment: a well-formed cumulative segment passes', () => {
  const v = validateSegment(seg(), 7, TODAY);
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.seg.active_ms, 60_000);
    assert.equal(v.seg.task_id, 11);
    assert.equal(v.seg.first_at, '2026-09-29T01:00:00.000Z');
  }
});

test('validateSegment: identity comes from the token, never the body', () => {
  const v = validateSegment(seg({ user_id: 8 }), 7, TODAY);
  assert.deepEqual(v.ok ? null : v.reason, 'user_mismatch');
});

test('validateSegment: rejects bad shapes with a reason and keeps the id for the ack', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ segment_id: 'x' }, 'bad_segment_id'],
    [{ segment_id: 'has space in it' }, 'bad_segment_id'],
    [{ session_id: '' }, 'bad_session_id'],
    [{ task_id: 0 }, 'bad_task_id'],
    [{ task_id: '12a' }, 'bad_task_id'],
    [{ work_date: '2026-02-30' }, 'bad_work_date'],
    [{ work_date: addDays(TODAY, 2) }, 'date_out_of_range'],
    [{ work_date: addDays(TODAY, -40) }, 'date_out_of_range'],
    [{ active_ms: -1 }, 'bad_active_ms'],
    [{ active_ms: '100' }, 'bad_active_ms'],
    [{ active_ms: MAX_MS_PER_DAY + 1 }, 'duration_out_of_range'],
    [{ rev: 0 }, 'bad_rev'],
  ];
  for (const [over, reason] of cases) {
    const v = validateSegment(seg(over), 7, TODAY);
    assert.equal(v.ok, false, JSON.stringify(over));
    if (!v.ok) assert.equal(v.reason, reason, JSON.stringify(over));
  }
  const bad = validateSegment(seg({ task_id: 0 }), 7, TODAY);
  assert.equal(bad.ok ? null : bad.segment_id, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6-1');
});

test('validateSegment: tomorrow is allowed (client clock slightly ahead), old queued days within 35 are allowed', () => {
  assert.equal(validateSegment(seg({ work_date: addDays(TODAY, 1) }), 7, TODAY).ok, true);
  assert.equal(validateSegment(seg({ work_date: addDays(TODAY, -30) }), 7, TODAY).ok, true);
});

test('liveStatusOf: stale heartbeat or ended session is offline no matter what the client said', () => {
  const now = Date.parse('2026-09-29T02:00:00.000Z');
  const fresh = new Date(now - 5_000).toISOString();
  const stale = new Date(now - STALE_AFTER_MS - 1).toISOString();
  assert.equal(liveStatusOf({ state: 'working', task_id: 3, last_seen_at: fresh, ended_at: null }, now), 'working');
  assert.equal(liveStatusOf({ state: 'working', task_id: 3, last_seen_at: stale, ended_at: null }, now), 'offline');
  assert.equal(liveStatusOf({ state: 'working', task_id: 3, last_seen_at: fresh, ended_at: fresh }, now), 'offline');
  assert.equal(liveStatusOf({ state: 'idle', task_id: 3, last_seen_at: fresh, ended_at: null }, now), 'idle');
  assert.equal(liveStatusOf({ state: 'background', task_id: 3, last_seen_at: fresh, ended_at: null }, now), 'idle');
  assert.equal(liveStatusOf({ state: 'no_task', task_id: null, last_seen_at: fresh, ended_at: null }, now), 'online_no_task');
  assert.equal(liveStatusOf({ state: 'no_document', task_id: null, last_seen_at: fresh, ended_at: null }, now), 'online_no_task');
  assert.equal(liveStatusOf({ state: 'suspended', task_id: 3, last_seen_at: fresh, ended_at: null }, now), 'offline');
  assert.equal(liveStatusOf({ state: 'working', task_id: 3, last_seen_at: 'garbage', ended_at: null }, now), 'offline');
});

test('pickSession: prefers the live working session over an older/offline one', () => {
  const now = Date.parse('2026-09-29T02:00:00.000Z');
  const rows = [
    { session_id: 'old', user_id: 7, state: 'working', task_id: 1, last_seen_at: '2026-09-28T09:00:00.000Z', ended_at: null },
    { session_id: 'idle', user_id: 7, state: 'idle', task_id: 2, last_seen_at: new Date(now - 3_000).toISOString(), ended_at: null },
    { session_id: 'work', user_id: 7, state: 'working', task_id: 3, last_seen_at: new Date(now - 8_000).toISOString(), ended_at: null },
  ];
  assert.equal(pickSession(rows, now)?.session_id, 'work');
  assert.equal(pickSession([rows[0]], now)?.session_id, 'old');
  assert.equal(pickSession([], now), null);
});

test('resolveReportDate: queued report keeps its day for 3 days, never the future', () => {
  assert.equal(resolveReportDate('2026-09-28', TODAY), '2026-09-28');
  assert.equal(resolveReportDate('2026-09-26', TODAY), '2026-09-26');
  assert.equal(resolveReportDate('2026-09-25', TODAY), TODAY);
  assert.equal(resolveReportDate('2026-09-30', TODAY), TODAY);
  assert.equal(resolveReportDate(undefined, TODAY), TODAY);
  assert.equal(resolveReportDate('29/09/2026', TODAY), TODAY);
});

test('helpers', () => {
  assert.equal(isWorkDate('2026-09-29'), true);
  assert.equal(isWorkDate('2026-13-01'), false);
  assert.equal(addDays('2026-09-29', 3), '2026-10-02');
  assert.equal(cleanState('working'), 'working');
  assert.equal(cleanState('hacking'), 'no_task');
  assert.equal(cleanActiveMs(-5), null);
  assert.equal(cleanActiveMs(1.9), 1);
  assert.equal(cleanActiveMs(MAX_MS_PER_DAY * 2), MAX_MS_PER_DAY);
});
