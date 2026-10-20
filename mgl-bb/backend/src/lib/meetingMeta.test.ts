/**
 * `lib/meetingMeta.ts` — хурлын төслийн жагсаалт / төрөл / оролцогчдын тоо.
 * Импортгүй цэвэр модуль тул шууд статик импорт болно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_MEETING_PROJECTS,
  countAttendees,
  countAttendeesFromJson,
  parseProjectIds,
  resolveMeetingKind,
} from './meetingMeta.ts';

test('parseProjectIds: project_ids массив — давхардал, хүчингүй утга хасагдана, дараалал хадгалагдана', () => {
  assert.deepEqual(parseProjectIds({ project_ids: [30, '32', 30, -1, 0, 1.5, 'x', null] }), [30, 32]);
});

test('parseProjectIds: хуучин project_id ганц тоо → нэг элементтэй массив; null → хоосон', () => {
  assert.deepEqual(parseProjectIds({ project_id: 7 }), [7]);
  assert.deepEqual(parseProjectIds({ project_id: null }), []);
});

test('parseProjectIds: талбар огт ирээгүй → undefined (PUT хөндөхгүй)', () => {
  assert.equal(parseProjectIds({}), undefined);
  assert.equal(parseProjectIds({ title: 'x' } as Record<string, unknown>), undefined);
});

test('parseProjectIds: дээд хязгаараар тайрагдана', () => {
  const many = Array.from({ length: MAX_MEETING_PROJECTS + 5 }, (_, i) => i + 1);
  assert.equal(parseProjectIds({ project_ids: many })!.length, MAX_MEETING_PROJECTS);
});

test('resolveMeetingKind: kind ирээгүй бол төслөөс гаргана', () => {
  assert.deepEqual(resolveMeetingKind(undefined, [3]), { ok: true, kind: 'project', projectIds: [3] });
  assert.deepEqual(resolveMeetingKind(undefined, []), { ok: true, kind: 'company', projectIds: [] });
});

test('resolveMeetingKind: company → төслүүд хаягдана', () => {
  assert.deepEqual(resolveMeetingKind('company', [3, 4]), { ok: true, kind: 'company', projectIds: [] });
});

test('resolveMeetingKind: project төсөлгүй → алдаа; танигдахгүй kind → төслөөс гаргана', () => {
  const r = resolveMeetingKind('project', []);
  assert.equal(r.ok, false);
  assert.deepEqual(resolveMeetingKind('weird', [9]), { ok: true, kind: 'project', projectIds: [9] });
});

test('countAttendees: нэртэй гишүүд л тоологдоно, байгууллага хоорондоо нийлнэ', () => {
  const groups = [
    { org: 'MGL', members: [{ name: 'А' }, { name: '  ' }, { name: 'Б', position: 'ИТА' }] },
    { org: '', members: [{ name: 'В' }] },
    { org: 'Хоосон', members: [] },
    null,
    { org: 'Буруу', members: 'x' },
  ];
  assert.equal(countAttendees(groups), 3);
  assert.equal(countAttendees(null), 0);
});

test('countAttendeesFromJson: JSON багана; буруу JSON = 0', () => {
  assert.equal(countAttendeesFromJson('[{"org":"A","members":[{"name":"x"},{"name":"y"}]}]'), 2);
  assert.equal(countAttendeesFromJson('{not json'), 0);
  assert.equal(countAttendeesFromJson(null), 0);
});
