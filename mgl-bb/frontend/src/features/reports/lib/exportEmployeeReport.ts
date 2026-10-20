/**
 * Ажилтны тайлангийн workbook — «Тайлан → Ажилтан» табын БҮХ тоо нэг .xlsx-д,
 * хэвлэхэд бэлэн (A4 босоо, өргөндөө багтана, толгой/хөл, хуудасны дугаар).
 * Ижил workbook нь (1) шууд татагдана, (2) сервер Google Drive руу
 * `convertTo: spreadsheet`-ээр илгээж Google Sheets болгоно — тиймээс энд
 * Sheets-ийн импортод СЭРГЭДЭГ хэв маяг л хэрэглэнэ (merge, fill, border,
 * font, number format, багана өргөн; conditional format, theme БИШ).
 *
 * Эх сурвалж нь дэлгэц дээрхтэй ЯГ ижил объектууд (`EmployeeDetailResponse`,
 * `EmployeeHrResponse`, /profiles/:id/activity, /profiles/:id/tasks) — тоо
 * дахин бодогдохгүй, тиймээс «дэлгэц дээр нэг, хуудсан дээр өөр» гэж гарахгүй.
 *
 * ⚠️ HR-ийн PC нууц үг, утас ЭНД ХЭЗЭЭ Ч ОРОХГҮЙ — гэрээний хураангуй л.
 *    Нэрээ нууцалсан санал хүсэлт серверээс ирдэггүй тул энд ч байхгүй.
 */
import type * as ExcelJSNs from 'exceljs';
import { loadExcelJS } from '@/features/attendance/admin/lib/excel';
import { apiFetch } from '@/shared/api/client';
import { brand } from '@/shared/config/brand';
import { formatDisplayName, formatProjectShortName } from '@/shared/lib/formatting';
import { formatDateTime } from '@/shared/lib/time';
import type { MyProgressEntry } from '@/shared/types';
import type { EmployeeDetailResponse, EmployeeHrResponse, ProfileTasksResponse } from '../types';
import { TREND_LABEL_KEY, WINDOW_LABEL_KEY } from './windows';
import { leaveLabel, suggestionStatusLabel } from './labels';

type T = (key: string, params?: Record<string, string | number>) => string;

const NAVY = 'FF1F3A5F';
const NAVY_TEXT = 'FFFFFFFF';
const SECTION_FILL = 'FFE8EEF6';
const HEAD_FILL = 'FFF1F5F9';
const ZEBRA_FILL = 'FFFAFBFD';
const GOOD = 'FF15803D';
const BAD = 'FFB91C1C';
const MUTED = 'FF64748B';
const BORDER: Partial<ExcelJSNs.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD5DBE3' } },
  left: { style: 'thin', color: { argb: 'FFD5DBE3' } },
  bottom: { style: 'thin', color: { argb: 'FFD5DBE3' } },
  right: { style: 'thin', color: { argb: 'FFD5DBE3' } },
};

const COLS = 6;

export function reportFileStem(d: EmployeeDetailResponse): string {
  const name = formatDisplayName(d.user.full_name)
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
  return `Tailan_${name}_${d.window.from}_${d.window.to}`;
}

export async function buildEmployeeReportWorkbook(opts: {
  detail: EmployeeDetailResponse;
  hr: EmployeeHrResponse | null;
  activity: MyProgressEntry[];
  t: T;
}): Promise<ExcelJSNs.Workbook> {
  const { detail: d, hr, activity, t } = opts;
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().name;
  wb.created = new Date();

  // Даалгаврын хуудас — одоогийн хуваарилалт (идэвхтэй төслүүд); унавал хуудас алгасна.
  const tasks = await apiFetch<ProfileTasksResponse>(`/profiles/${d.user.id}/tasks`).catch(
    () => null,
  );

  buildSummarySheet(wb, d, hr, t);
  buildSeriesSheet(wb, d, t);
  buildActivitySheet(wb, activity, t);
  if (tasks) buildTasksSheet(wb, tasks, t);
  return wb;
}

/* ------------------------------------------------------------------ */
/*  Хуудас 1 — Тайлан (хэвлэхэд бэлэн)                                */
/* ------------------------------------------------------------------ */

function buildSummarySheet(
  wb: ExcelJSNs.Workbook,
  d: EmployeeDetailResponse,
  hr: EmployeeHrResponse | null,
  t: T,
) {
  const ws = wb.addWorksheet(t('reportsPage.xls.sheetSummary'), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
      horizontalCentered: true,
    },
  });
  ws.columns = [
    { width: 26 },
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 22 },
    { width: 22 },
  ];
  const name = formatDisplayName(d.user.full_name);
  ws.headerFooter = {
    oddHeader: `&L&"-,Bold"${brand().name}&R${name}`,
    oddFooter: `&L${t('reportsPage.xls.generatedAt', { at: formatDateTime(new Date()) })}&R${t('reportsPage.xls.page')} &P / &N`,
  };

  const periodLabel = `${t(WINDOW_LABEL_KEY[d.window.code])} · ${d.window.from} – ${d.window.to}`;

  // ── Гарчиг ──
  let r = 1;
  ws.mergeCells(r, 1, r, COLS);
  const title = ws.getCell(r, 1);
  title.value = t('reportsPage.xls.title');
  title.font = { bold: true, size: 16, color: { argb: NAVY_TEXT } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(r).height = 30;
  r += 1;
  ws.mergeCells(r, 1, r, COLS);
  const sub = ws.getCell(r, 1);
  sub.value = `${brand().name} · ${periodLabel}`;
  sub.font = { size: 10, color: { argb: MUTED } };
  sub.alignment = { indent: 1 };
  r += 2;

  // ── Ажилтан ──
  r = section(ws, r, t('reportsPage.xls.employee'));
  const teams =
    d.user.teams.map((x) => `${x.code} — ${x.name_mn}`).join(', ') || d.user.team_code || '';
  const pairs: Array<[string, string | number | null]> = [
    [t('reportsPage.colEmployee'), name],
    [
      t('reportsPage.position'),
      [d.user.position, d.user.seniority].filter(Boolean).join(' · ') || null,
    ],
    [t('reportsPage.colTeam'), teams || null],
    [t('reportsPage.xls.employeeId'), d.user.employee_id],
    [t('reportsPage.xls.period'), periodLabel],
    [
      t('reportsPage.xls.previousPeriod'),
      d.previous ? `${d.previous.from} – ${d.previous.to}` : null,
    ],
    [
      t('reportsPage.xls.status'),
      d.user.status === 'active' ? t('reportsPage.xls.active') : t('reportsPage.inactive'),
    ],
  ];
  for (const [k, v] of pairs) {
    kv(ws, r, k, v);
    r += 1;
  }
  r += 1;

  // ── Гүйцэтгэлийн хураангуй ──
  r = section(ws, r, t('reportsPage.xls.performance'));
  const hasPrev = d.prev_metrics != null;
  r = header(
    ws,
    r,
    [
      t('reportsPage.xls.metric'),
      t('reportsPage.xls.current'),
      t('reportsPage.xls.previous'),
      'Δ',
      t('reportsPage.xls.note'),
    ],
    [1, 2, 3, 4, 5],
  );
  ws.mergeCells(r - 1, 5, r - 1, 6);
  const m = d.metrics;
  const p = d.prev_metrics;
  const rankText =
    d.rank.now != null && d.rank.pool_size != null
      ? t('reportsPage.rankOf', { rank: d.rank.now, total: d.rank.pool_size })
      : t('reportsPage.notMember');
  const rankPrev = d.rank.at_7d_ago != null ? String(d.rank.at_7d_ago) : null;
  const metricRows: Array<{
    label: string;
    cur: number | string;
    prev: number | string | null;
    fmt?: string;
    lowerBetter?: boolean;
    note?: string;
  }> = [
    { label: t('reportsPage.kpiPoints'), cur: m.points, prev: p?.points ?? null, fmt: '0.0"%"' },
    {
      label: t('reportsPage.rank'),
      cur: rankText,
      prev: rankPrev,
      note: t('reportsPage.rank7dHint'),
    },
    {
      label: t('reportsPage.colTrend'),
      cur: t(TREND_LABEL_KEY[d.trend.code]),
      prev: null,
      note: t('reportsPage.trendVs', {
        last: round1(d.trend.last7),
        prior: round1(d.trend.prior7),
      }),
    },
    {
      label: t('reportsPage.kpiEntries'),
      cur: m.entries_count,
      prev: p?.entries_count ?? null,
      fmt: '0',
    },
    {
      label: t('reportsPage.kpiTasksTouched'),
      cur: m.tasks_touched,
      prev: p?.tasks_touched ?? null,
      fmt: '0',
    },
    {
      label: t('reportsPage.kpiTasksCompleted'),
      cur: m.tasks_completed,
      prev: p?.tasks_completed ?? null,
      fmt: '0',
    },
    {
      label: t('reportsPage.kpiRepair'),
      cur: m.repair_hours,
      prev: p?.repair_hours ?? null,
      fmt: '0.0" ц"',
    },
    {
      label: t('reportsPage.kpiPresent'),
      cur: m.present_days,
      prev: p?.present_days ?? null,
      fmt: '0',
      note: m.expected_days != null ? t('reportsPage.ofExpected', { n: m.expected_days }) : '',
    },
    {
      label: t('reportsPage.kpiHours'),
      cur: m.hours_worked,
      prev: p?.hours_worked ?? null,
      fmt: '0.0" ц"',
    },
    {
      label: t('reportsPage.kpiLate'),
      cur: m.late_minutes,
      prev: p?.late_minutes ?? null,
      fmt: '0',
      lowerBetter: true,
    },
    {
      label: t('reportsPage.kpiLeave'),
      cur: m.leave_hours,
      prev: p?.leave_hours ?? null,
      fmt: '0.0" ц"',
    },
  ];
  metricRows.forEach((row, i) => {
    const cells = [row.label, row.cur, hasPrev ? (row.prev ?? '—') : '—', '', row.note ?? ''];
    const rr = ws.getRow(r);
    cells.forEach((v, ci) => {
      const c = rr.getCell(ci + 1);
      c.value = v;
      c.border = BORDER;
      if (i % 2 === 1)
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_FILL } };
      if (ci === 1 || ci === 2) c.alignment = { horizontal: 'right' };
      if (row.fmt && typeof v === 'number') c.numFmt = row.fmt;
    });
    ws.mergeCells(r, 5, r, 6);
    rr.getCell(5).alignment = { wrapText: true };
    rr.getCell(1).font = { bold: true };
    if (typeof row.cur === 'number' && typeof row.prev === 'number') {
      const delta = Math.round((row.cur - row.prev) * 10) / 10;
      const dc = rr.getCell(4);
      dc.value = delta;
      dc.numFmt = `+${row.fmt ?? '0.0'};-${row.fmt ?? '0.0'};0`;
      dc.alignment = { horizontal: 'right' };
      const good = delta === 0 ? null : row.lowerBetter ? delta < 0 : delta > 0;
      if (good != null) dc.font = { bold: true, color: { argb: good ? GOOD : BAD } };
    }
    r += 1;
  });
  r += 1;

  // ── Ирц ба чөлөө ──
  r = section(ws, r, t('reportsPage.xls.attendanceLeave'));
  const pct =
    m.expected_days != null
      ? Math.round((m.present_days / Math.max(m.expected_days, 1)) * 100)
      : null;
  kv(
    ws,
    r,
    t('reportsPage.colPresentRate'),
    pct != null ? `${pct}%  (${m.present_days} / ${m.expected_days})` : String(m.present_days),
  );
  r += 1;
  const statuses = ['approved', 'pending', 'rejected', 'cancelled'] as const;
  const byStatus = statuses
    .filter((s) => d.leaves.by_status[s])
    .map(
      (s) =>
        `${t(`reportsPage.leaveStatus.${s}`)}: ${t('reportsPage.days', { n: d.leaves.by_status[s]!.days })} · ${d.leaves.by_status[s]!.count}`,
    )
    .join('   ');
  kv(
    ws,
    r,
    t('reportsPage.leavesInWindow', { n: d.leaves.rows.length }),
    byStatus || t('reportsPage.leavesNone'),
  );
  r += 1;
  if (d.leaves.rows.length) {
    r = header(ws, r, [
      t('reportsPage.colDate'),
      t('reportsPage.xls.leaveType'),
      t('reportsPage.kpiLeave'),
      t('reportsPage.colStatus'),
      t('reportsPage.xls.reason'),
      t('reportsPage.xls.decision'),
    ]);
    d.leaves.rows.forEach((l, i) => {
      const range = l.start_date === l.end_date ? l.start_date : `${l.start_date} – ${l.end_date}`;
      const time = l.start_time && l.end_time ? ` ${l.start_time}–${l.end_time}` : '';
      const decision = [l.reviewer_name, l.reviewer_note].filter(Boolean).join(': ');
      r = tableRow(
        ws,
        r,
        [
          range + time,
          leaveLabel(l),
          l.days,
          t(`reportsPage.leaveStatus.${l.status}`),
          l.reason ?? '',
          decision,
        ],
        i,
        {
          numFmt: { 3: '0.0' },
          color: { 4: l.status === 'approved' ? GOOD : l.status === 'rejected' ? BAD : undefined },
        },
      );
    });
  }
  r += 1;

  // ── Төслүүд ──
  r = section(ws, r, t('reportsPage.projects'));
  if (d.projects.length === 0) {
    kv(ws, r, '', t('reportsPage.noProjects'));
    r += 1;
  } else {
    r = header(
      ws,
      r,
      [
        t('reportsPage.xls.project'),
        t('reportsPage.kpiPoints'),
        t('reportsPage.xls.awards'),
        t('reportsPage.xls.lastAward'),
      ],
      [1, 3, 4, 5],
    );
    ws.mergeCells(r - 1, 1, r - 1, 2);
    ws.mergeCells(r - 1, 5, r - 1, 6);
    d.projects.forEach((pr, i) => {
      const label = pr.project_id
        ? formatProjectShortName(pr.name ?? '')
        : pr.is_non_project
          ? t('nonProjectWork.title')
          : `${pr.name ?? '—'} · ${t('reportsPage.repairProject')}`;
      const rr = ws.getRow(r);
      const vals: Array<string | number> = [
        label,
        '',
        pr.points,
        pr.award_count,
        pr.last_awarded_at ? pr.last_awarded_at.slice(0, 10) : '',
        '',
      ];
      vals.forEach((v, ci) => {
        const c = rr.getCell(ci + 1);
        c.value = v;
        c.border = BORDER;
        if (i % 2 === 1)
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_FILL } };
      });
      ws.mergeCells(r, 1, r, 2);
      ws.mergeCells(r, 5, r, 6);
      rr.getCell(3).numFmt = '0.0"%"';
      rr.getCell(3).alignment = { horizontal: 'right' };
      rr.getCell(4).alignment = { horizontal: 'right' };
      r += 1;
    });
  }
  r += 1;

  // ── Санал хүсэлт ──
  r = section(ws, r, `${t('reportsPage.suggestions')} (${d.suggestions.length})`);
  if (d.suggestions.length === 0) {
    kv(ws, r, '', t('reportsPage.suggestionsNone'));
    r += 1;
  } else {
    r = header(
      ws,
      r,
      [
        t('reportsPage.colDate'),
        t('reportsPage.xls.suggestionTitle'),
        t('reportsPage.xls.description'),
        t('reportsPage.colStatus'),
        t('reportsPage.reviewNote'),
      ],
      [1, 2, 3, 5, 6],
    );
    ws.mergeCells(r - 1, 3, r - 1, 4);
    d.suggestions.forEach((s, i) => {
      const rr = ws.getRow(r);
      const decision = [s.reviewer_name, s.reviewer_note].filter(Boolean).join(': ');
      const vals = [
        s.created_at.slice(0, 10),
        s.title,
        s.description,
        '',
        suggestionStatusLabel(s, t),
        decision,
      ];
      vals.forEach((v, ci) => {
        const c = rr.getCell(ci + 1);
        c.value = v;
        c.border = BORDER;
        c.alignment = { vertical: 'top', wrapText: true };
        if (i % 2 === 1)
          c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_FILL } };
      });
      ws.mergeCells(r, 3, r, 4);
      const color =
        s.status === 'resolved' ? (s.resolution === 'approved' ? GOOD : BAD) : undefined;
      if (color) rr.getCell(5).font = { color: { argb: color } };
      r += 1;
    });
  }
  r += 1;

  // ── Үнэлгээ / гэрээ (HR ачаалагдсан бол) ──
  if (hr) {
    if (hr.assessments.length) {
      r = section(ws, r, t('reportsPage.assessments'));
      r = header(ws, r, [
        t('reportsPage.xls.assessPeriod'),
        t('reportsPage.xls.assessRound'),
        t('reportsPage.xls.level'),
        t('reportsPage.xls.overall'),
        t('reportsPage.assessSelf'),
        t('reportsPage.assessSenior'),
      ]);
      hr.assessments.slice(0, 6).forEach((a, i) => {
        r = tableRow(
          ws,
          r,
          [
            a.period,
            a.round_name,
            a.level?.label ?? '',
            a.overall_pct ?? '',
            a.self_pct ?? '',
            a.senior_pct ?? '',
          ],
          i,
          {
            numFmt: { 4: '0.0"%"', 5: '0.0"%"', 6: '0.0"%"' },
          },
        );
      });
      r += 1;
    }
    r = section(ws, r, t('reportsPage.contract'));
    const h = hr.hr;
    const contractPairs: Array<[string, string | null]> = [
      [t('reportsPage.hiredAt'), h?.hired_at ?? null],
      [
        t('reportsPage.contractEmployment'),
        h?.has_contract_file
          ? `${t('reportsPage.xls.fileAttached')} · ${h.contract_file_name ?? ''}`
          : t('reportsPage.noFile'),
      ],
      [
        t('reportsPage.contractNda'),
        h?.has_nda_file
          ? `${t('reportsPage.xls.fileAttached')} · ${h.nda_file_name ?? ''}`
          : t('reportsPage.noFile'),
      ],
    ];
    for (const [k, v] of contractPairs) {
      kv(ws, r, k, v);
      r += 1;
    }
  }

  r += 1;
  ws.mergeCells(r, 1, r, COLS);
  const foot = ws.getCell(r, 1);
  foot.value = t('reportsPage.ledgerNote');
  foot.font = { size: 8, italic: true, color: { argb: MUTED } };
}

/* ------------------------------------------------------------------ */
/*  Хуудас 2 — Цуваа                                                   */
/* ------------------------------------------------------------------ */

function buildSeriesSheet(wb: ExcelJSNs.Workbook, d: EmployeeDetailResponse, t: T) {
  const ws = wb.addWorksheet(t('reportsPage.xls.sheetSeries'), {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:1',
    },
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  const g = d.series.granularity;
  ws.columns = [
    { header: t(`reportsPage.seriesGranularity.${g}`), key: 'date', width: 14 },
    { header: t('reportsPage.kpiPoints'), key: 'points', width: 12 },
    { header: t('reportsPage.kpiHours'), key: 'hours', width: 14 },
    { header: t('reportsPage.kpiLate'), key: 'late', width: 14 },
    { header: t('reportsPage.kpiPresent'), key: 'present', width: 12 },
    { header: t('reportsPage.expectedDays'), key: 'expected', width: 12 },
  ];
  d.series.dates.forEach((date, i) => {
    ws.addRow({
      date: g === 'month' ? date.slice(0, 7) : date,
      points: d.series.points[i] ?? 0,
      hours: d.series.hours[i] ?? 0,
      late: d.series.late_minutes[i] ?? 0,
      present: d.series.present[i] ?? 0,
      expected: d.series.expected[i] ?? 0,
    });
  });
  const total = ws.addRow({
    date: t('reportsPage.xls.total'),
    points: round1(d.series.points.reduce((s, v) => s + v, 0)),
    hours: round1(d.series.hours.reduce((s, v) => s + v, 0)),
    late: d.series.late_minutes.reduce((s, v) => s + v, 0),
    present: d.series.present.reduce((s, v) => s + v, 0),
    expected: d.series.expected.reduce((s, v) => s + v, 0),
  });
  total.font = { bold: true };
  ws.getColumn('points').numFmt = '0.0';
  ws.getColumn('hours').numFmt = '0.0';
  styleTableHeader(ws);
}

/* ------------------------------------------------------------------ */
/*  Хуудас 3 — Явцын бичлэгүүд                                          */
/* ------------------------------------------------------------------ */

function buildActivitySheet(wb: ExcelJSNs.Workbook, entries: MyProgressEntry[], t: T) {
  const ws = wb.addWorksheet(t('reportsPage.xls.sheetActivity'), {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:1',
    },
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: t('reportsPage.colDate'), key: 'date', width: 12 },
    { header: t('reportsPage.xls.project'), key: 'project', width: 26 },
    { header: t('reportsPage.xls.block'), key: 'block', width: 18 },
    { header: t('reportsPage.colTask'), key: 'task', width: 30 },
    { header: t('reportsPage.colProgress'), key: 'pct', width: 10 },
    { header: 'Δ', key: 'delta', width: 8 },
    { header: t('reportsPage.colStatus'), key: 'status', width: 14 },
    { header: t('reportsPage.notes'), key: 'notes', width: 40 },
    { header: t('reportsPage.reviewNote'), key: 'review', width: 28 },
  ];
  const statusLabel = (e: MyProgressEntry) =>
    e.is_rest_day
      ? t('reportsPage.entryRest')
      : e.status === 'approved'
        ? t('reportsPage.entryApproved')
        : e.status === 'rejected'
          ? t('reportsPage.entryRejected')
          : t('reportsPage.entryPending');
  [...entries]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
    .forEach((e) => {
      ws.addRow({
        date: e.date,
        project: e.project_name ? formatProjectShortName(e.project_name) : '',
        block: e.block_name ?? '',
        task: e.task_name ?? '',
        pct: e.is_rest_day ? '' : e.percentage,
        delta: e.delta_pct ?? '',
        status: statusLabel(e),
        notes: e.notes ?? '',
        review: [e.reviewer_name, e.review_note].filter(Boolean).join(': '),
      });
    });
  if (entries.length === 0) ws.addRow({ date: t('reportsPage.activityNone') });
  ws.getColumn('pct').numFmt = '0"%"';
  ws.getColumn('delta').numFmt = '+0.0;-0.0;0';
  ws.getColumn('notes').alignment = { wrapText: true, vertical: 'top' };
  styleTableHeader(ws);
}

/* ------------------------------------------------------------------ */
/*  Хуудас 4 — Даалгаврууд (одоогийн хуваарилалт)                       */
/* ------------------------------------------------------------------ */

function buildTasksSheet(wb: ExcelJSNs.Workbook, tasks: ProfileTasksResponse, t: T) {
  const ws = wb.addWorksheet(t('reportsPage.xls.sheetTasks'), {
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: '1:1',
    },
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: t('reportsPage.xls.project'), key: 'project', width: 26 },
    { header: t('reportsPage.xls.block'), key: 'block', width: 18 },
    { header: t('reportsPage.xls.drawing'), key: 'drawing', width: 18 },
    { header: t('reportsPage.colTask'), key: 'task', width: 32 },
    { header: t('reportsPage.xls.weight'), key: 'weight', width: 8 },
    { header: t('reportsPage.colProgress'), key: 'pct', width: 10 },
    { header: t('reportsPage.colDue'), key: 'due', width: 12 },
    { header: t('reportsPage.colStatus'), key: 'status', width: 14 },
  ];
  for (const it of tasks.items) {
    const status =
      it.current_progress >= 100
        ? t('reportsPage.tasksDone')
        : it.current_progress > 0
          ? t('reportsPage.tasksActive')
          : t('reportsPage.tasksNotStarted');
    ws.addRow({
      project: formatProjectShortName(it.project_name),
      block: it.block_name,
      drawing: it.drawing_name,
      task: it.name,
      weight: it.weight_percent,
      pct: it.current_progress,
      due: it.due_date ?? '',
      status,
    });
  }
  if (tasks.items.length === 0) ws.addRow({ project: t('reportsPage.tasksNone') });
  ws.getColumn('pct').numFmt = '0"%"';
  ws.getColumn('weight').numFmt = '0.0';
  styleTableHeader(ws);
}

/* ------------------------------------------------------------------ */
/*  Хэв маягийн туслахууд                                              */
/* ------------------------------------------------------------------ */

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Хэсгийн гарчиг — бүтэн мөр, цайвар хөх дэвсгэр. */
function section(ws: ExcelJSNs.Worksheet, r: number, label: string): number {
  ws.mergeCells(r, 1, r, COLS);
  const c = ws.getCell(r, 1);
  c.value = label.toUpperCase();
  c.font = { bold: true, size: 11, color: { argb: NAVY } };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SECTION_FILL } };
  c.alignment = { vertical: 'middle', indent: 1 };
  c.border = { bottom: { style: 'medium', color: { argb: NAVY } } };
  ws.getRow(r).height = 20;
  return r + 1;
}

/** «Шошго | утга» мөр — утга нь 2…6 баганыг нэгтгэнэ. */
function kv(ws: ExcelJSNs.Worksheet, r: number, label: string, value: string | number | null) {
  const k = ws.getCell(r, 1);
  k.value = label;
  k.font = { color: { argb: MUTED } };
  k.alignment = { indent: 1 };
  ws.mergeCells(r, 2, r, COLS);
  const v = ws.getCell(r, 2);
  v.value = value == null || value === '' ? '—' : value;
  v.alignment = { wrapText: true };
  if (value == null || value === '') v.font = { color: { argb: MUTED } };
}

/** Хүснэгтийн толгой — `cols` өгвөл тэр багануудад, эс бөгөөс 1..n дараалан. */
function header(ws: ExcelJSNs.Worksheet, r: number, labels: string[], cols?: number[]): number {
  const rr = ws.getRow(r);
  labels.forEach((l, i) => {
    const c = rr.getCell(cols ? cols[i]! : i + 1);
    c.value = l;
    c.font = { bold: true, size: 10 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
    c.border = BORDER;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  rr.height = 18;
  return r + 1;
}

function tableRow(
  ws: ExcelJSNs.Worksheet,
  r: number,
  values: Array<string | number>,
  index: number,
  opts: { numFmt?: Record<number, string>; color?: Record<number, string | undefined> } = {},
): number {
  const rr = ws.getRow(r);
  values.forEach((v, i) => {
    const c = rr.getCell(i + 1);
    c.value = v;
    c.border = BORDER;
    c.alignment = { vertical: 'top', wrapText: true };
    if (index % 2 === 1)
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA_FILL } };
    const fmt = opts.numFmt?.[i + 1];
    if (fmt && typeof v === 'number') {
      c.numFmt = fmt;
      c.alignment = { horizontal: 'right', vertical: 'top' };
    }
    const color = opts.color?.[i + 1];
    if (color) c.font = { color: { argb: color } };
  });
  return r + 1;
}

/** Хүснэгт-маягийн хуудасны 1-р мөр — bold, дэвсгэр, хүрээ; autofilter. */
function styleTableHeader(ws: ExcelJSNs.Worksheet) {
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  head.height = 22;
  head.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
    c.border = BORDER;
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}
