/**
 * `lib/asrReportType.ts`-ийн тест.  Импортгүй цэвэр функцүүд — статик импорт хангалттай.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  ASR_REPORT_TYPES,
  ASR_SITE_SQL,
  DEFAULT_ASR_REPORT_TYPE,
  MEETING_PLATFORM_MAX,
  isAsrReportType,
  meetingPlatformFor,
  parseAsrReportType,
  reportTypeProblem,
  requiresSafetyAck,
} from './asrReportType.ts';

test('4 төрөл, өгөгдмөл нь талбайн хяналт', () => {
  assert.deepEqual([...ASR_REPORT_TYPES], ['site', 'office', 'drawing_change', 'online']);
  assert.equal(DEFAULT_ASR_REPORT_TYPE, 'site');
  assert.ok(isAsrReportType('office'));
  assert.ok(!isAsrReportType('Office'));
  assert.ok(!isAsrReportType(''));
  assert.ok(!isAsrReportType(1));
});

test('parseAsrReportType: ирээгүй = null, танигдахгүй = алдаа (чимээгүй site биш)', () => {
  assert.deepEqual(parseAsrReportType(undefined), { ok: true, type: null });
  assert.deepEqual(parseAsrReportType(null), { ok: true, type: null });
  assert.deepEqual(parseAsrReportType('online'), { ok: true, type: 'online' });
  assert.deepEqual(parseAsrReportType('meeting'), { ok: false });
  assert.deepEqual(parseAsrReportType(''), { ok: false });
});

test('ХАБ-ын баталгаа зөвхөн талбайн хяналтад', () => {
  assert.equal(requiresSafetyAck('site'), true);
  assert.equal(requiresSafetyAck('online'), false);
  assert.equal(requiresSafetyAck('drawing_change'), false);
  assert.equal(requiresSafetyAck('office'), false);
});

test('платформ зөвхөн цахим уулзалтад хадгалагдана, хэвийжнэ, тайрагдана', () => {
  assert.equal(meetingPlatformFor('online', '  Google   Meet '), 'Google Meet');
  assert.equal(meetingPlatformFor('online', '   '), null);
  assert.equal(meetingPlatformFor('online', 42), null);
  assert.equal(meetingPlatformFor('site', 'Zoom'), null);
  assert.equal(meetingPlatformFor('office', 'Zoom'), null);
  assert.equal(meetingPlatformFor('online', 'x'.repeat(300))?.length, MEETING_PLATFORM_MAX);
});

test('илгээх шалгалт: цахим уулзалтад платформ заавал', () => {
  assert.match(reportTypeProblem('online', null) ?? '', /платформ/);
  assert.match(reportTypeProblem('online', '  ') ?? '', /платформ/);
  assert.equal(reportTypeProblem('online', 'Zoom'), null);
  assert.equal(reportTypeProblem('site', null), null);
  assert.equal(reportTypeProblem('drawing_change', undefined), null);
});

test('миграц 0362: хуучин мөр site болно, очилтын нөхцөл зөвхөн site-ийг тоолно', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE author_supervision_reports (
             id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft')`);
  db.exec(`INSERT INTO author_supervision_reports (id, status)
           VALUES (1, 'approved'), (2, 'submitted'), (3, 'draft')`);
  const sql = readFileSync(new URL('../../migrations/0362_asr_report_type.sql', import.meta.url), 'utf8');
  db.exec(sql);

  const types = db
    .prepare('SELECT report_type, meeting_platform FROM author_supervision_reports ORDER BY id')
    .all() as { report_type: string; meeting_platform: string | null }[];
  assert.deepEqual(
    types.map((r) => [r.report_type, r.meeting_platform]),
    [
      ['site', null],
      ['site', null],
      ['site', null],
    ],
  );

  db.exec(`INSERT INTO author_supervision_reports (id, status, report_type, meeting_platform)
           VALUES (4, 'approved', 'online', 'Zoom'), (5, 'submitted', 'office', NULL)`);
  const visits = db
    .prepare(
      `SELECT COUNT(*) AS n FROM author_supervision_reports r
        WHERE r.status IN ('submitted','approved') AND ${ASR_SITE_SQL}`,
    )
    .get() as { n: number };
  assert.equal(visits.n, 2);
});
