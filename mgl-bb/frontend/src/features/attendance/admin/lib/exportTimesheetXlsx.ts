import type { DailyAttendanceGridResponse } from '@/shared/types';
import { formatDisplayName } from '@/shared/lib/formatting';
import { LEAVE_TYPE_META, type TFn } from '@/features/attendance/admin/constants';
import { minutesToHoursDec } from '@/features/attendance/admin/utils/format';
import { accumulateTotals, emptyTotals } from '@/features/attendance/admin/utils/totals';
import {
  downloadWorkbook,
  loadExcelJS,
  styleHeaderRow,
} from '@/features/attendance/admin/lib/excel';
import { brand } from '@/shared/config/brand';

/** ExcelJS-ийн header/footer формат кодод `&` нь удирдах тэмдэг — хоёрлоно. */
function escHf(str: string): string {
  return str.replace(/&/g, '&&');
}

/** Экспортын нэмэлт мэдээлэл — багаар шүүсэн эсэх. */
export interface TimesheetXlsxMeta {
  /** «BB (Барилга бүтээц)» эсвэл «BA, BB».  Шүүлтгүй үед `null`. */
  teamLabel?: string | null;
  /** Файлын нэрэнд орох цэвэрлэгдсэн хэсэг («BA-BB»).  Шүүлтгүй үед хоосон. */
  teamStamp?: string;
}

/** Export the daily grid as a real .xlsx using ExcelJS.  Adds late
 *  penalty + credited/total hour columns the legacy CSV lacked, plus
 *  bold header, frozen first row, and subtotal/grand-total rows that
 *  mirror the on-screen layout.
 *
 *  ⚠️ `meta.team*` нь ЗААВАЛ өгөгдөх ёстой зүйл биш ч, багаар шүүсэн
 *  экспортод нь өгөх нь чухал: татсан файл нь аль багийнх болох нь нэр
 *  дээрээ бичигдээгүй бол «нийт компанийн цагийн хүснэгт» гэж андуурагдана. */
export async function exportTimesheetXlsx(
  dailyGrid: DailyAttendanceGridResponse | null,
  t: TFn,
  meta: TimesheetXlsxMeta = {},
) {
  if (!dailyGrid) return;

  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();
  const ws = wb.addWorksheet(t('attendanceAdminPage.xlsxSheetAttendance'), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Excel-ийн цагийн нүд нь АРАВТЫН БУТАРХАЙ (106:40 → 106.67) — дэлгэц дээрх
  // `ц:мин` бичиглэлээс өөр тул толгойд нэгжийг ил зарлана.
  const dec = ` (${t('attendanceAdminPage.unitHoursDec')})`;

  ws.columns = [
    { header: t('attendanceAdminPage.colNu'), key: 'nu', width: 6 },
    { header: t('common.name'), key: 'name', width: 26 },
    { header: t('attendanceAdminPage.colDate'), key: 'date', width: 12 },
    { header: t('attendanceAdminPage.colSchedule'), key: 'schedule', width: 14 },
    { header: t('attendanceAdminPage.colPlannedIn'), key: 'plannedIn', width: 10 },
    { header: t('attendanceAdminPage.colPlannedOut'), key: 'plannedOut', width: 10 },
    { header: t('attendanceAdminPage.colActualIn'), key: 'actualIn', width: 10 },
    { header: t('attendanceAdminPage.colActualOut'), key: 'actualOut', width: 10 },
    { header: t('attendanceAdminPage.colLateMin'), key: 'late', width: 14 },
    { header: t('attendanceAdminPage.colPenalty'), key: 'penalty', width: 14 },
    { header: t('attendanceAdminPage.colLeave'), key: 'leave', width: 16 },
    { header: t('attendanceAdminPage.colLeaveReason'), key: 'leaveReason', width: 24 },
    { header: t('attendanceAdminPage.colLeaveHours') + dec, key: 'leaveHours', width: 16 },
    { header: t('attendanceAdminPage.colOutOfOfficeHours') + dec, key: 'oooHours', width: 18 },
    { header: t('attendanceAdminPage.colAbsent'), key: 'absent', width: 8 },
    { header: t('attendanceAdminPage.colCredited') + dec, key: 'credited', width: 22 },
    { header: t('attendanceAdminPage.colTotal') + dec, key: 'total', width: 16 },
  ];

  styleHeaderRow(ws);

  // Багийн шүүлтийг ХЭВЛЭХ толгойд бичнэ.  Хүснэгтийн 1-р мөр нь хөлдөөсөн
  // толгол тул дээр нь гарчгийн мөр НЭМЖ БОЛОХГҮЙ (`ySplit: 1` ба
  // `styleHeaderRow` хоёул 1-р мөрийг толгой гэж үздэг).
  if (meta.teamLabel) {
    ws.headerFooter = {
      oddHeader: `&L&"-,Bold"${escHf(t('attendanceAdminPage.timesheet'))}&R${escHf(meta.teamLabel)}`,
    };
  }

  const grand = emptyTotals();
  let currentUser: number | null = null;
  let currentName = '';
  let currentTotals = emptyTotals();
  let nu = 0;

  const writeSubtotal = () => {
    if (currentUser === null) return;
    const row = ws.addRow({
      nu: '',
      name: t('attendanceAdminPage.subtotalName', { name: currentName }),
      date: '',
      schedule: '',
      plannedIn: '',
      plannedOut: '',
      actualIn: '',
      actualOut: '',
      late: currentTotals.lateMinutes || '',
      penalty: currentTotals.latePenalty || '',
      leave: currentTotals.leaveDays || '',
      leaveReason: '',
      leaveHours:
        currentTotals.leaveMinutes > 0 ? minutesToHoursDec(currentTotals.leaveMinutes) : '',
      oooHours:
        currentTotals.outOfOfficeMinutes > 0
          ? minutesToHoursDec(currentTotals.outOfOfficeMinutes)
          : '',
      absent: currentTotals.absentDays || '',
      credited: minutesToHoursDec(currentTotals.workedEffectiveMinutes),
      total: minutesToHoursDec(currentTotals.totalMinutes),
    });
    row.font = { italic: true, bold: true };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  };

  for (const r of dailyGrid.rows) {
    if (r.user_id !== currentUser) {
      writeSubtotal();
      currentUser = r.user_id;
      currentName = formatDisplayName(r.full_name);
      currentTotals = emptyTotals();
      nu = 0;
    }
    nu += 1;

    const row = ws.addRow({
      nu,
      name: formatDisplayName(r.full_name),
      date: r.date,
      schedule: r.schedule_label,
      plannedIn: r.planned_in,
      plannedOut: r.planned_out,
      actualIn: r.actual_in ?? '',
      actualOut: r.actual_out ?? '',
      late: r.late_minutes || '',
      penalty: r.late_penalty || '',
      // Нэг өдөр хэд хэдэн чөлөөтэй бол бүгд («Бусад 08:30–12:00 + Цалингүй 12:00–17:30»).
      leave: !r.is_on_leave
        ? ''
        : r.leave_parts && r.leave_parts.length > 1
          ? r.leave_parts
              .map((p) => `${t(LEAVE_TYPE_META[p.leave_type].labelKey)} ${p.start_time}–${p.end_time}`)
              .join(' + ')
          : t(LEAVE_TYPE_META[r.leave_type ?? 'other'].labelKey),
      leaveReason:
        r.leave_parts && r.leave_parts.length > 1
          ? r.leave_parts.map((p) => p.reason).filter(Boolean).join(' · ')
          : (r.leave_reason ?? ''),
      leaveHours: r.leave_minutes > 0 ? minutesToHoursDec(r.leave_minutes) : '',
      oooHours: r.out_of_office_minutes > 0 ? minutesToHoursDec(r.out_of_office_minutes) : '',
      absent: r.is_absent ? 'TRUE' : '',
      // ⚠️ Нөхцөл нь `worked_effective_minutes`-ийг өөрийг нь шалгана.  Урьд нь
      //    `credited_minutes != null` гэж ӨӨР талбараар шалгаад
      //    `worked_effective_minutes`-ийг хэвлэдэг байсан тул гадуур ажилтай
      //    (credited=null, ooo>0) өдөр нүд нь ХООСОН гарч, дэд/нийт дүнд нь
      //    тоологддог байв — `numFmt '0.00'` багана өөрийнхөө дүнтэй нийлдэггүй.
      credited:
        r.credited_minutes != null || r.worked_effective_minutes > 0
          ? minutesToHoursDec(r.worked_effective_minutes)
          : '',
      total: r.total_minutes != null ? minutesToHoursDec(r.total_minutes) : '',
    });

    // Visual cues — late minutes in red, leave/absent rows dimmed.
    if ((r.late_minutes ?? 0) > 0) {
      row.getCell('late').font = { color: { argb: 'FFB91C1C' }, bold: true };
      row.getCell('penalty').font = { color: { argb: 'FFB91C1C' } };
    }
    if (r.is_on_leave) {
      row.font = { color: { argb: 'FF64748B' } };
    }
    if (r.is_absent) {
      row.getCell('absent').font = { color: { argb: 'FFB91C1C' }, bold: true };
    }

    accumulateTotals(currentTotals, r);
    accumulateTotals(grand, r);
  }
  writeSubtotal();

  const grandRow = ws.addRow({
    nu: '',
    name: t('attendanceAdminPage.grandTotal'),
    date: '',
    schedule: '',
    plannedIn: '',
    plannedOut: '',
    actualIn: '',
    actualOut: '',
    late: grand.lateMinutes,
    penalty: grand.latePenalty,
    leave: grand.leaveDays,
    leaveReason: '',
    leaveHours: grand.leaveMinutes > 0 ? minutesToHoursDec(grand.leaveMinutes) : '',
    oooHours: grand.outOfOfficeMinutes > 0 ? minutesToHoursDec(grand.outOfOfficeMinutes) : '',
    absent: grand.absentDays,
    credited: minutesToHoursDec(grand.workedEffectiveMinutes),
    total: minutesToHoursDec(grand.totalMinutes),
  });
  grandRow.font = { bold: true };
  grandRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };

  // Number column formatting (penalty as integer with thousand sep).
  ws.getColumn('penalty').numFmt = '#,##0';
  // Цагийн баганууд бутархай тоогоор (144:25 → 144.42) — Excel дээр
  // нийлбэрлэж/тооцоолж болно.
  for (const key of ['leaveHours', 'oooHours', 'credited', 'total']) {
    ws.getColumn(key).numFmt = '0.00';
  }

  const teamSuffix = meta.teamStamp ? `_${meta.teamStamp}` : '';
  await downloadWorkbook(
    wb,
    `attendance_${dailyGrid.period.from}_${dailyGrid.period.to}${teamSuffix}.xlsx`,
  );
}
