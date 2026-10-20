/**
 * `lib/asrSummary.ts`-ийн тест — ЗХ-ийн нэгтгэл тайлан.  Импортгүй цэвэр
 * функцүүд (зөвхөн type импорт) тул статик импорт хангалттай.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asrSummaryFileStem,
  buildAsrSummary,
  isYmd,
  parseSummaryQuery,
  summaryWhere,
  type AsrSummaryFilters,
  type SummaryReportRow,
} from './asrSummary.ts';

type T = 'site' | 'office' | 'drawing_change' | 'online';
const isType = (v: unknown): v is T =>
  typeof v === 'string' && ['site', 'office', 'drawing_change', 'online'].includes(v);

const ALL: AsrSummaryFilters = { from: null, to: null, projectId: null, reportType: null, status: 'counted' };

function row(p: Partial<SummaryReportRow> & { id: number }): SummaryReportRow {
  return {
    project_id: 1,
    project_name: 'MGL-251006_EVERGREEN',
    base_name: 'MGL-251006_EVERGREEN_AZ',
    shifr: null,
    contract_no: null,
    doc_no: null,
    report_date: '2026-09-01',
    report_type: 'site',
    meeting_platform: null,
    meeting_place: null,
    meeting_start: null,
    meeting_end: null,
    meeting_parties: null,
    meeting_purpose: null,
    status: 'submitted',
    description: null,
    work_report: null,
    site_tasks: null,
    defects: null,
    red_book_status: 'missing',
    author_id: 10,
    author_name: 'Бат',
    reviewer_name: null,
    reviewed_at: null,
    photo_count: 0,
    ...p,
  };
}

test('isYmd бодит огноо л', () => {
  assert.equal(isYmd('2026-09-30'), true);
  assert.equal(isYmd('2026-02-30'), false);
  assert.equal(isYmd('2026-9-1'), false);
  assert.equal(isYmd(null), false);
});

test('parseSummaryQuery: хоосон = бүх хугацаа, илгээсэн+батлагдсан', () => {
  const r = parseSummaryQuery({}, isType);
  assert.deepEqual(r, { ok: true, filters: ALL });
});

test('parseSummaryQuery: from > to бол солино, бусад шүүлтийг уншина', () => {
  const r = parseSummaryQuery(
    { from: '2026-09-30', to: '2026-09-01', project_id: '41', report_type: 'office', status: 'approved' },
    isType,
  );
  assert.deepEqual(r, {
    ok: true,
    filters: { from: '2026-09-01', to: '2026-09-30', projectId: 41, reportType: 'office', status: 'approved' },
  });
});

test('parseSummaryQuery: буруу утга 400 — чимээгүй үл тоохгүй', () => {
  assert.equal(parseSummaryQuery({ from: '2026-13-01' }, isType).ok, false);
  assert.equal(parseSummaryQuery({ to: 'өчигдөр' }, isType).ok, false);
  assert.equal(parseSummaryQuery({ project_id: 'abc' }, isType).ok, false);
  assert.equal(parseSummaryQuery({ project_id: '-3' }, isType).ok, false);
  assert.equal(parseSummaryQuery({ report_type: 'meeting' }, isType).ok, false);
  assert.equal(parseSummaryQuery({ status: 'draft' }, isType).ok, false);
});

test('summaryWhere: ноорог хэзээ ч орохгүй; bind дараалал = нөхцлийн дараалал', () => {
  const w = summaryWhere({ from: '2026-09-01', to: '2026-09-30', projectId: 7, reportType: 'site', status: 'counted' });
  assert.match(w.sql, /r\.status IN \('submitted','approved'\)/);
  assert.doesNotMatch(w.sql, /draft/);
  assert.deepEqual(w.args, ['2026-09-01', '2026-09-30', 7, 'site']);
  const a = summaryWhere({ ...ALL, status: 'approved' });
  assert.equal(a.sql, `r.status = 'approved'`);
  assert.deepEqual(a.args, []);
});

test('buildAsrSummary: очилт = зөвхөн талбай; хүн = зохиогч + хамт явсан, давхардалгүй', () => {
  const s = buildAsrSummary({
    filters: ALL,
    reports: [
      row({ id: 3, report_date: '2026-09-10', report_type: 'office', author_id: 11, author_name: 'Дорж' }),
      row({ id: 1, report_date: '2026-09-02', status: 'approved', red_book_status: 'signed', photo_count: 4 }),
      row({ id: 2, report_date: '2026-09-05', project_id: 2, project_name: 'MGL-250101_TENNIS', defects: '  ', site_tasks: 'Арматур шалгах' }),
    ],
    teams: [
      { report_id: 1, code: 'BB', name_mn: 'Барилга', work_note: null },
      { report_id: 1, code: 'BA', name_mn: 'Архитектур', work_note: 'тэмдэглэл' },
      { report_id: 2, code: 'BB', name_mn: 'Барилга', work_note: null },
      { report_id: 99, code: 'XX', name_mn: 'шүүлтээс гадуур', work_note: null },
    ],
    companions: [
      { report_id: 1, user_id: 12, full_name: 'Болд' },
      { report_id: 1, user_id: 10, full_name: 'Бат' }, // зохиогч өөрөө — давхардахгүй
      { report_id: 3, user_id: 10, full_name: 'Бат' },
    ],
    resolutions: [
      { report_id: 2, prev_doc_no: 'DASR-BB-001', prev_report_date: '2026-08-20', issue_text: 'Ан цав', resolution_text: 'Зассан' },
      { report_id: 2, prev_doc_no: null, prev_report_date: null, issue_text: ' ', resolution_text: null },
    ],
    truncated: false,
    isType,
  });

  // Он цагийн дарааллаар.
  assert.deepEqual(s.entries.map((e) => e.id), [1, 2, 3]);
  assert.equal(s.totals.reports, 3);
  assert.equal(s.totals.site_visits, 2);
  assert.deepEqual(s.totals.by_type, { site: 2, office: 1, drawing_change: 0, online: 0 });
  assert.deepEqual(s.totals.by_status, { submitted: 2, approved: 1 });
  assert.equal(s.totals.red_book.signed, 1);
  assert.equal(s.totals.red_book.missing, 1); // оффис уулзалт тоологдохгүй
  assert.equal(s.totals.with_defects, 0); // зөвхөн зайтай бичвэр = хоосон
  assert.equal(s.totals.with_tasks, 1);
  assert.equal(s.totals.photos, 4);
  assert.equal(s.totals.projects, 2);
  assert.equal(s.totals.people, 3); // Бат, Болд, Дорж

  const e1 = s.entries[0]!;
  assert.deepEqual(e1.companions, ['Болд']);
  assert.deepEqual(e1.teams.map((t) => t.code), ['BB', 'BA']);
  assert.equal(e1.teams[1]!.work_note, 'тэмдэглэл');
  assert.equal(s.entries[1]!.defects, null);
  assert.equal(s.entries[1]!.resolutions.length, 1); // хоосон шийдлийн мөр хаягдана

  // Багаар: олон багийн тайлан баг бүрт тоологдоно.
  assert.deepEqual(
    s.by_team.map((t) => [t.code, t.reports, t.site_visits]),
    [['BB', 2, 2], ['BA', 1, 1]],
  );

  // Хүнээр: Бат 3 тайлан (2 зохиогч + 1 хамт явсан), 2 очилт.
  const bat = s.by_person.find((p) => p.user_id === 10)!;
  assert.deepEqual([bat.reports, bat.site_visits, bat.authored], [3, 2, 2]);
  assert.equal(s.by_person[0]!.user_id, 10);

  // Төслөөр — нэрээр эрэмбэлсэн (MGL-250101 < MGL-251006).
  assert.deepEqual(s.by_project.map((p) => p.project_id), [2, 1]);
  const p1 = s.by_project.find((p) => p.project_id === 1)!;
  assert.deepEqual([p1.reports, p1.site_visits, p1.approved, p1.people], [2, 1, 1, 3]);
  assert.deepEqual([p1.first_date, p1.last_date], ['2026-09-02', '2026-09-10']);

  // Нээлттэй хугацааг өгөгдлөөр нөхнө.
  assert.deepEqual(s.period, { from: '2026-09-02', to: '2026-09-10' });
});

test('buildAsrSummary: батлагдаагүй тайланд баталсан хүн гарахгүй; танигдахгүй төрөл = талбай', () => {
  const s = buildAsrSummary({
    filters: { ...ALL, from: '2026-09-01', to: '2026-09-30' },
    reports: [
      row({ id: 1, reviewer_name: 'Захирал', reviewed_at: '2026-09-03', report_type: null }),
      row({ id: 2, status: 'approved', reviewer_name: 'Захирал', reviewed_at: '2026-09-03', report_type: 'online', meeting_platform: 'Zoom' }),
      row({ id: 3, report_type: 'office', meeting_platform: 'Zoom' }),
    ],
    teams: [],
    companions: [],
    resolutions: [],
    truncated: false,
    isType,
  });
  assert.equal(s.entries[0]!.reviewer_name, null);
  assert.equal(s.entries[0]!.report_type, 'site');
  assert.equal(s.entries[1]!.reviewer_name, 'Захирал');
  assert.equal(s.entries[1]!.meeting_platform, 'Zoom');
  assert.equal(s.entries[2]!.meeting_platform, null); // платформ зөвхөн цахим уулзалтад
  assert.deepEqual(s.period, { from: '2026-09-01', to: '2026-09-30' });
});

test('buildAsrSummary: хоосон үр дүн', () => {
  const s = buildAsrSummary({ filters: ALL, reports: [], teams: [], companions: [], resolutions: [], truncated: false, isType });
  assert.equal(s.totals.reports, 0);
  assert.deepEqual(s.period, { from: null, to: null });
  assert.deepEqual(s.by_project, []);
});

test('asrSummaryFileStem', () => {
  assert.equal(
    asrSummaryFileStem({ projectCode: 'MGL-251006', period: { from: '2026-09-01', to: '2026-09-30' } }),
    'MGL-251006_DASR_Negtgel_2026-09-01_2026-09-30',
  );
  assert.equal(
    asrSummaryFileStem({ projectCode: null, period: { from: '2026-09-05', to: '2026-09-05' } }),
    'DASR_Negtgel_2026-09-05',
  );
  assert.equal(asrSummaryFileStem({ projectCode: '', period: { from: null, to: null } }), 'DASR_Negtgel_all');
  assert.equal(
    asrSummaryFileStem({ projectCode: 'Luxwood засвар/2', period: { from: '2026-09-01', to: '2026-09-02' } }),
    'Luxwood_засвар_2_DASR_Negtgel_2026-09-01_2026-09-02',
  );
});
