/**
 * ЗХ-ийн нэгтгэл тайлан — Excel (.xlsx).  Хоёр хуудас:
 *   1. «Хураангуй» — шүүлт, тоо, төрлөөр, төслөөр, багаар, хүнээр (A4 босоо, хэвлэхэд бэлэн);
 *   2. «Тайлангууд» — тайлан бүр НЭГ мөр, гол агуулга тус тусдаа баганад
 *      (шүүх, эрэмбэлэхэд — autoFilter + толгой хөлдөөсөн; A4 хэвтээ).
 *
 * Эх сурвалж нь серверийн `AsrSummaryResponse` — тоо дахин бодогдохгүй, PDF/Word-той
 * ижил.  Бичвэр нь `summaryContent.ts`-ийн ижил шошгоор.
 */
import type * as ExcelJSNs from 'exceljs';
import { loadExcelJS } from '@/features/attendance/admin/lib/excel';
import { brand } from '@/shared/config/brand';
import { formatDisplayName } from '@/shared/lib/formatting';
import { formatDateTime } from '@/shared/lib/time';
import {
  dotDate,
  isMultiProject,
  kpiRows,
  metaRows,
  projectLabel,
  redBookLabel,
  statusLabel,
  teamsOf,
  typeLabel,
  typeRows,
  type T,
} from './summaryContent';
import type { AsrSummaryEntry, AsrSummaryResponse } from './summaryTypes';

const NAVY = 'FF0F243E';
const WHITE = 'FFFFFFFF';
const HEAD_FILL = 'FFE8EEF6';
const ZEBRA = 'FFF7F9FB';
const BORDER: Partial<ExcelJSNs.Borders> = {
  top: { style: 'thin', color: { argb: 'FFC5CCD4' } },
  left: { style: 'thin', color: { argb: 'FFC5CCD4' } },
  bottom: { style: 'thin', color: { argb: 'FFC5CCD4' } },
  right: { style: 'thin', color: { argb: 'FFC5CCD4' } },
};

export async function buildAsrSummaryWorkbook(data: AsrSummaryResponse, t: T): Promise<ExcelJSNs.Workbook> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().name;
  wb.created = new Date();
  buildSummarySheet(wb, data, t);
  buildReportsSheet(wb, data, t);
  return wb;
}

function headRow(row: ExcelJSNs.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: WHITE } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.alignment = { vertical: 'middle', wrapText: true };
    c.border = BORDER;
  });
  // Өндөр ЗААХГҮЙ — «Зохиогч болсон» гэх мэт урт толгой мөр таслагдаж Excel өөрөө тааруулна.
}

function bodyRow(row: ExcelJSNs.Row, zebra: boolean) {
  row.eachCell({ includeEmpty: true }, (c) => {
    c.border = BORDER;
    c.alignment = { vertical: 'top', wrapText: true, ...(typeof c.value === 'number' ? { horizontal: 'right' } : {}) };
    if (zebra) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
  });
}

function sectionTitle(ws: ExcelJSNs.Worksheet, text: string, cols: number) {
  ws.addRow([]);
  const r = ws.addRow([text]);
  ws.mergeCells(r.number, 1, r.number, cols);
  r.getCell(1).font = { bold: true, size: 12, color: { argb: NAVY } };
  r.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } };
  r.height = 20;
}

/* ------------------------------------------------------------------ */
/*  1. Хураангуй                                                       */
/* ------------------------------------------------------------------ */

function buildSummarySheet(wb: ExcelJSNs.Workbook, d: AsrSummaryResponse, t: T) {
  const COLS = 9;
  const ws = wb.addWorksheet(t('asr.summary.sheetSummary'), {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&C&P / &N' },
  });
  ws.columns = [
    { width: 6 },
    { width: 34 },
    { width: 16 },
    { width: 11 },
    { width: 11 },
    { width: 12 },
    { width: 11 },
    { width: 9 },
    { width: 13 },
  ];

  const title = ws.addRow([t('asr.summary.docTitle')]);
  ws.mergeCells(title.number, 1, title.number, COLS);
  title.getCell(1).font = { bold: true, size: 15, color: { argb: NAVY } };
  title.height = 26;
  const sub = ws.addRow([
    `${t('asr.summary.docSubtitle')} · ${t('asr.summary.generated', { date: formatDateTime(d.generated_at) })}`,
  ]);
  ws.mergeCells(sub.number, 1, sub.number, COLS);
  sub.getCell(1).font = { italic: true, color: { argb: 'FF555555' } };

  ws.addRow([]);
  for (const [k, v] of metaRows(d, t)) {
    // Шошго 1–2 багана (1-р багана «№»-д зориулж нарийн), утга 3–COLS.
    const r = ws.addRow([k, '', v]);
    ws.mergeCells(r.number, 1, r.number, 2);
    ws.mergeCells(r.number, 3, r.number, COLS);
    r.getCell(1).font = { bold: true };
  }
  if (d.truncated) {
    const r = ws.addRow([t('asr.summary.truncated', { n: d.entries.length })]);
    ws.mergeCells(r.number, 1, r.number, COLS);
    r.getCell(1).font = { bold: true, color: { argb: 'FF92400E' } };
  }

  sectionTitle(ws, t('asr.summary.secOverview'), COLS);
  const kv = (l: string, v: number, i: number) => {
    const r = ws.addRow([l, '', v]);
    ws.mergeCells(r.number, 1, r.number, 2);
    bodyRow(r, i % 2 === 1);
    r.getCell(3).font = { bold: true, color: { argb: NAVY } };
  };
  kpiRows(d, t).forEach(([l, v], i) => kv(l, v, i));
  sectionTitle(ws, t('asr.summary.byType'), COLS);
  typeRows(d, t).forEach(([l, v], i) => kv(l, v, i));

  if (isMultiProject(d) && d.by_project.length > 0) {
    sectionTitle(ws, t('asr.summary.secProjects'), COLS);
    headRow(
      ws.addRow([
        '№',
        t('asr.summary.col.project'),
        t('asr.summary.col.shifr'),
        t('asr.summary.col.reports'),
        t('asr.summary.col.siteVisits'),
        t('asr.summary.col.approved'),
        t('asr.summary.col.defects'),
        t('asr.summary.col.peopleCount'),
        t('asr.summary.col.lastDate'),
      ]),
    );
    d.by_project.forEach((p, i) => {
      bodyRow(
        ws.addRow([
          i + 1,
          projectLabel(p.name),
          p.shifr ?? '',
          p.reports,
          p.site_visits,
          p.approved,
          p.with_defects,
          p.people,
          dotDate(p.last_date),
        ]),
        i % 2 === 1,
      );
    });
  }

  sectionTitle(ws, t('asr.summary.secTeams'), COLS);
  headRow(ws.addRow([t('asr.summary.col.team'), '', t('asr.summary.col.reports'), t('asr.summary.col.siteVisits')]));
  d.by_team.forEach((x, i) => {
    const r = ws.addRow([x.code, x.name ?? '', x.reports, x.site_visits]);
    bodyRow(r, i % 2 === 1);
  });

  sectionTitle(ws, t('asr.summary.secPeople'), COLS);
  headRow(
    ws.addRow([
      '№',
      t('asr.summary.col.name'),
      t('asr.summary.col.reports'),
      t('asr.summary.col.siteVisits'),
      t('asr.summary.col.authored'),
    ]),
  );
  d.by_person.forEach((x, i) => {
    bodyRow(ws.addRow([i + 1, formatDisplayName(x.name), x.reports, x.site_visits, x.authored]), i % 2 === 1);
  });

  ws.addRow([]);
  const note = ws.addRow([t('asr.summary.countedNote')]);
  ws.mergeCells(note.number, 1, note.number, COLS);
  note.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF666666' } };
  note.getCell(1).alignment = { wrapText: true };
  note.height = 30;
}

/* ------------------------------------------------------------------ */
/*  2. Тайлангууд                                                      */
/* ------------------------------------------------------------------ */

function resolutionsText(e: AsrSummaryEntry): string {
  return e.resolutions
    .map((r) => {
      const prev = [r.prev_doc_no, r.prev_report_date ? dotDate(r.prev_report_date) : null].filter(Boolean).join(' · ');
      const body = [r.issue_text, r.resolution_text ? `→ ${r.resolution_text}` : null].filter(Boolean).join(' ');
      return prev ? `${prev}: ${body}` : body;
    })
    .join('\n');
}

function buildReportsSheet(wb: ExcelJSNs.Workbook, d: AsrSummaryResponse, t: T) {
  const ws = wb.addWorksheet(t('asr.summary.sheetReports'), {
    views: [{ state: 'frozen', ySplit: 1, xSplit: 3 }],
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      // 20 багана — нэг хуудсанд шахвал унших боломжгүй жижиг; 2 хуудас өргөн.
      fitToWidth: 2,
      fitToHeight: 0,
      printTitlesRow: '1:1',
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&C&P / &N' },
  });

  const cols: { header: string; width: number; value: (e: AsrSummaryEntry, i: number) => string | number }[] = [
    { header: '№', width: 5, value: (_e, i) => i + 1 },
    { header: t('asr.summary.col.date'), width: 11, value: (e) => dotDate(e.report_date) },
    { header: t('asr.summary.col.docNo'), width: 15, value: (e) => e.doc_no ?? '' },
    { header: t('asr.summary.col.project'), width: 28, value: (e) => projectLabel(e.project_name) },
    { header: t('asr.summary.col.shifr'), width: 14, value: (e) => e.shifr ?? '' },
    { header: t('asr.summary.col.contractNo'), width: 14, value: (e) => e.contract_no ?? '' },
    { header: t('asr.summary.col.type'), width: 15, value: (e) => typeLabel(e, t) },
    { header: t('asr.summary.col.teams'), width: 9, value: (e) => teamsOf(e) },
    { header: t('asr.summary.col.author'), width: 18, value: (e) => (e.author_name ? formatDisplayName(e.author_name) : '') },
    {
      header: t('asr.summary.col.companions'),
      width: 22,
      value: (e) => e.companions.map((c) => formatDisplayName(c)).join(', '),
    },
    { header: t('asr.summary.col.status'), width: 12, value: (e) => statusLabel(e.status, t) },
    { header: t('asr.summary.field.description'), width: 36, value: (e) => e.description ?? '' },
    {
      header: t('asr.summary.field.workReport'),
      width: 36,
      value: (e) => [e.work_report, e.meeting_purpose && e.report_type === 'office' ? `${t('asr.summary.field.meetingPurpose')}: ${e.meeting_purpose}` : null].filter(Boolean).join('\n'),
    },
    { header: t('asr.summary.field.siteTasks'), width: 36, value: (e) => e.site_tasks ?? '' },
    { header: t('asr.summary.field.defects'), width: 36, value: (e) => e.defects ?? '' },
    {
      header: t('asr.summary.field.teamNotes'),
      width: 28,
      value: (e) => e.teams.filter((x) => x.work_note).map((x) => `${x.code}: ${x.work_note}`).join('\n'),
    },
    { header: t('asr.summary.field.resolutions'), width: 36, value: (e) => resolutionsText(e) },
    { header: t('asr.summary.col.redBook'), width: 16, value: (e) => redBookLabel(e, t) },
    {
      header: t('asr.summary.col.reviewer'),
      width: 18,
      value: (e) =>
        e.reviewer_name ? `${formatDisplayName(e.reviewer_name)}${e.reviewed_at ? ` (${dotDate(e.reviewed_at)})` : ''}` : '',
    },
    { header: t('asr.summary.col.photos'), width: 8, value: (e) => e.photo_count },
  ];

  ws.columns = cols.map((c) => ({ width: c.width }));
  headRow(ws.addRow(cols.map((c) => c.header)));
  d.entries.forEach((e, i) => {
    const row = ws.addRow(cols.map((c) => c.value(e, i)));
    bodyRow(row, i % 2 === 1);
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, d.entries.length + 1), column: cols.length } };
}
