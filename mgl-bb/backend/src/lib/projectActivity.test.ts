/**
 * `lib/projectActivity.ts`-ийн тест.  Импортгүй цэвэр функцүүд тул
 * `registerHooks` шаардлагагүй.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_WEIGHTS,
  activityWindowStart,
  buildProjectActivity,
  emptyProjectActivity,
  latestActivityAt,
  scoreProjectActivity,
  type ProjectActivityRow,
} from './projectActivity.ts';

const row = (over: Partial<ProjectActivityRow> = {}): ProjectActivityRow => ({
  project_id: 1,
  assignee_count: 0,
  attendance_users_30d: 0,
  attendance_user_days_30d: 0,
  progress_users_30d: 0,
  progress_entries_30d: 0,
  last_progress_at: null,
  last_attendance_date: null,
  ...over,
});

test('оролцоогүй төсөл 0 оноотой, last_activity_at null', () => {
  const a = emptyProjectActivity(7);
  assert.equal(a.project_id, 7);
  assert.equal(a.score, 0);
  assert.equal(a.last_activity_at, null);
});

test('оноо = жинлэсэн нийлбэр (жин нэг газраас)', () => {
  const r = row({
    assignee_count: 4,
    attendance_users_30d: 3,
    attendance_user_days_30d: 20,
    progress_users_30d: 2,
    progress_entries_30d: 10,
  });
  const w = ACTIVITY_WEIGHTS;
  const expected =
    4 * w.assignee + 3 * w.attendanceUser + 20 * w.attendanceUserDay + 2 * w.progressUser + 10 * w.progressEntry;
  assert.equal(scoreProjectActivity(r), Math.round(expected * 100) / 100);
});

test('нэг хүн олон бичлэг хийсэн нь олон хүн ажилласнаас ДООГУУР', () => {
  // 1 хүн, 30 хоногт 20 явцын бичлэг
  const lone = row({ assignee_count: 1, progress_users_30d: 1, progress_entries_30d: 20 });
  // 5 хүн, тус бүр 1 бичлэг, 5-уулаа ирц дээр сонгосон
  const team = row({
    assignee_count: 5,
    progress_users_30d: 5,
    progress_entries_30d: 5,
    attendance_users_30d: 5,
    attendance_user_days_30d: 5,
  });
  assert.ok(scoreProjectActivity(team) > scoreProjectActivity(lone));
});

test('latestActivityAt — хожуу нь ялна, ирцийн огноо өдрийн эхлэл гэж тооцогдоно', () => {
  assert.equal(latestActivityAt(null, null), null);
  assert.equal(latestActivityAt('2026-09-10 08:00:00', null), '2026-09-10 08:00:00');
  assert.equal(latestActivityAt(null, '2026-09-12'), '2026-09-12');
  assert.equal(latestActivityAt('2026-09-10 08:00:00', '2026-09-12'), '2026-09-12');
  // Тэр өдөр явц бичсэн бол явц нь хожуу (лексик: '2026-09-12 0…' > '2026-09-12')
  assert.equal(latestActivityAt('2026-09-12 09:30:00', '2026-09-12'), '2026-09-12 09:30:00');
});

test('buildProjectActivity мөрийг хэвээр хадгалж score/last_activity_at нэмнэ', () => {
  const a = buildProjectActivity(
    row({ project_id: 3, assignee_count: 2, last_attendance_date: '2026-09-01' }),
  );
  assert.equal(a.project_id, 3);
  assert.equal(a.assignee_count, 2);
  assert.equal(a.score, 2 * ACTIVITY_WEIGHTS.assignee);
  assert.equal(a.last_activity_at, '2026-09-01');
});

test('activityWindowStart — 30 хоногийн өмнөх огноо, сар/жил давна', () => {
  assert.equal(activityWindowStart('2026-09-18'), '2026-08-19');
  assert.equal(activityWindowStart('2026-01-10'), '2025-12-11');
  assert.equal(activityWindowStart('2026-03-05', 7), '2026-02-26');
});
