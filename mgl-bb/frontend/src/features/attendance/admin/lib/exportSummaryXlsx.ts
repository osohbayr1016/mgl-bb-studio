import type { AttendanceSummaryResponse, AttendanceSummaryRow } from '@/shared/types';
import { formatDisplayName } from '@/shared/lib/formatting';
import type { TFn } from '@/features/attendance/admin/constants';
import type { SummaryDisplayTotals } from '@/features/attendance/admin/hooks/useAttendanceSummary';
import { formatShortDate, minutesToHoursDec } from '@/features/attendance/admin/utils/format';
import {
  downloadWorkbook,
  loadExcelJS,
  styleHeaderRow,
} from '@/features/attendance/admin/lib/excel';
import { brand } from '@/shared/config/brand';

/** Хураангуй тайлан (period rollup) → XLSX.  One row per employee.
 *
 *  `totals` нь ЗААВАЛ `rows`-той ижил хамрах хүрээтэй байх ёстой (дэлгэцийн
 *  `summaryDisplayTotals`) — эс бөгөөс НИЙТ мөр өөрийнхөө мөрүүдтэй зөрнө. */
export async function exportSummaryXlsx(
  summary: AttendanceSummaryResponse | null,
  rows: AttendanceSummaryRow[],
  totals: SummaryDisplayTotals,
  t: TFn,
) {
  if (!summary) return;

  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();
  const ws = wb.addWorksheet(t('attendanceAdminPage.xlsxSheetSummary'), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Excel-ийн цагийн нүд нь АРАВТЫН БУТАРХАЙ (106:40 → 106.67) — дэлгэц дээрх
  // `ц:мин` бичиглэлээс өөр тул толгойд нэгжийг ил зарлана.
  const dec = ` (${t('attendanceAdminPage.unitHoursDec')})`;

  ws.columns = [
    { header: t('attendanceAdminPage.colNoShort'), key: 'nu', width: 6 },
    { header: t('common.name'), key: 'name', width: 26 },
    { header: t('attendanceAdminPage.colTeam'), key: 'team', width: 10 },
    { header: t('attendanceAdminPage.colPosition'), key: 'position', width: 18 },
    { header: t('attendanceAdminPage.colWorkDays'), key: 'workDays', width: 12 },
    { header: t('attendanceAdminPage.colPresentDays'), key: 'days', width: 12 },
    { header: t('attendanceAdminPage.colExtraDays'), key: 'extraDays', width: 14 },
    { header: t('attendanceAdminPage.colExpectedHours') + dec, key: 'expected', width: 16 },
    { header: t('attendanceAdminPage.colWorkedHours') + dec, key: 'credited', width: 18 },
    { header: t('attendanceAdminPage.colLeaveHours') + dec, key: 'leave', width: 16 },
    { header: t('attendanceAdminPage.colAnnualLeave'), key: 'annual', width: 12 },
    { header: t('attendanceAdminPage.colOutOfOfficeHours') + dec, key: 'ooo', width: 18 },
    { header: t('attendanceAdminPage.colLateMin'), key: 'late', width: 12 },
    { header: t('attendanceAdminPage.colPenalty'), key: 'penalty', width: 14 },
    { header: t('attendanceAdminPage.colTotal') + dec, key: 'total', width: 16 },
  ];

  styleHeaderRow(ws);

  rows.forEach((r, idx) => {
    const row = ws.addRow({
      nu: idx + 1,
      name: formatDisplayName(r.full_name),
      team: r.team_code ?? '',
      position: r.position ?? '',
      workDays: r.expected_days,
      days: r.present_days,
      extraDays: r.extra_days || '',
      expected: minutesToHoursDec(r.expected_minutes),
      credited: minutesToHoursDec(r.worked_effective_minutes),
      leave: r.leave_minutes > 0 ? minutesToHoursDec(r.leave_minutes) : '',
      annual:
        r.annual_leave_days > 0
          ? `${r.annual_leave_days} (${r.annual_leave_dates.map(formatShortDate).join(', ')})`
          : '',
      ooo: r.out_of_office_minutes > 0 ? minutesToHoursDec(r.out_of_office_minutes) : '',
      late: r.late_minutes || '',
      penalty: r.late_penalty || '',
      total: minutesToHoursDec(r.total_minutes),
    });
    if (r.late_minutes > 0) {
      row.getCell('late').font = { color: { argb: 'FFB91C1C' }, bold: true };
      row.getCell('penalty').font = { color: { argb: 'FFB91C1C' } };
    }
  });

  // ⚠️ НИЙТ мөр нь ХАРАГДАЖ БУЙ (шүүсэн) мөрүүдийн нийлбэрээс гарна, backend-ийн
  //    `summary.totals`-оос БИШ.  `summary.totals` нь бүх ажилтны дүн бөгөөд
  //    нэрээр хайх нь ЗӨВХӨН клиент талд ажилладаг (`/attendance/summary` нь
  //    from/to л хүлээж авдаг) — тиймээс нэг хүнийг шүүж экспортлоход мөр нь
  //    нэг хүнийх, тод будсан НИЙТ мөр нь компани даяарынх болж, торгуулийн
  //    дүн (₮) хүртэл зөрдөг байв.  Дэлгэц дээрх `SummaryTableFoot` аль хэдийн
  //    шүүсэн мөрүүдээр боддог (`summaryDisplayTotals`) — файл одоо түүнтэй таарна.
  const grandRow = ws.addRow({
    nu: '',
    name: t('attendanceAdminPage.grandTotal'),
    team: '',
    position: '',
    workDays: totals.expected_days,
    days: totals.present_days,
    extraDays: rows.reduce((s, r) => s + (r.extra_days ?? 0), 0) || '',
    expected: minutesToHoursDec(totals.expected_minutes),
    credited: minutesToHoursDec(totals.worked_effective_minutes),
    leave: totals.leave_minutes > 0 ? minutesToHoursDec(totals.leave_minutes) : '',
    annual: totals.annual_leave_days || '',
    ooo:
      totals.out_of_office_minutes > 0 ? minutesToHoursDec(totals.out_of_office_minutes) : '',
    late: totals.late_minutes,
    penalty: totals.late_penalty,
    total: minutesToHoursDec(totals.total_minutes),
  });
  grandRow.font = { bold: true };
  grandRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

  ws.getColumn('penalty').numFmt = '#,##0';
  // Цагийн баганууд бутархай тоогоор (8.13) — Excel дээр нийлбэрлэж болно.
  // ⚠️ Зөвхөн ДЭЭР зарлагдсан түлхүүрүүдийг бич.  ExcelJS-ийн `getColumn(key)`
  //    нь танихгүй мөрийг багана ЗААХ ҮСЭГ гэж үзээд `l2n()` рүү уначихдаг ба
  //    'Out of bounds. Excel supports columns from 1 to 16384' гэж ШИДДЭГ —
  //    доорх `downloadWorkbook` хүртэл хүрэлгүй файл огт үүсэхгүй.  2026-08-10-нд
  //    илүү цагийн багана хасагдахад 'otHm' энд үлдэж, экспорт 16 хоног
  //    ЧИМЭЭГҮЙ үхмэл байсан (`onClick` дээр catch байхгүй тул алдаа ч харагдахгүй).
  for (const key of ['expected', 'credited', 'leave', 'ooo', 'total']) {
    ws.getColumn(key).numFmt = '0.00';
  }

  await downloadWorkbook(wb, `attendance_summary_${summary.period.from}_${summary.period.to}.xlsx`);
}
