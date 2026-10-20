import type ExcelJSNs from 'exceljs';
import type { AttendanceSession } from '@/shared/types';
import type { TFn } from '@/features/attendance/admin/constants';
import { formatDateTime } from '@/features/attendance/admin/utils/format';
import {
  downloadWorkbook,
  loadExcelJS,
  styleHeaderRow,
} from '@/features/attendance/admin/lib/excel';
import {
  buildOpenSessionRows,
  openFileStamp,
  openRangeLabel,
} from '@/features/attendance/admin/lib/openSessionRows';
import { brand } from '@/shared/config/brand';

/* =============================================================================
 *  Хаагдаагүй бүртгэл → .xlsx (ХЭВЛЭХЭД БЭЛЭН).
 * -----------------------------------------------------------------------------
 *  Энэ экспортын гол зорилго нь Excel дээр НЭЭЖ ХАРАХ төдий биш, тэндээсээ
 *  ШУУД ХЭВЛЭХ явдал.  Тиймээс `pageSetup`-ыг зориуд бүрэн бөглөнө:
 *
 *    · `fitToWidth: 1 / fitToHeight: 0` — 9 багана A4-ийн ӨРГӨНД багтана,
 *      мөрийн тоо хэдэн ч хуудас болж болно (`0` = хязгааргүй).  Хоёуланг
 *      нь `1` болговол 200 мөр нэг хуудсанд шахагдаж уншигдахаа болино.
 *    · `printTitlesRow: '1:1'` — толгой мөр ХУУДАС БҮРТ давтагдана.  Үүнгүй
 *      бол 2 дахь хуудсаас цааш ямар багана юу болох нь мэдэгдэхгүй.
 *    · `headerFooter` — гарчиг/хугацаа дээр, хэвлэсэн огноо + «х / нийт х»
 *      доор.  Excel-ийн формат кодод `&` нь тусгай тэмдэг тул `escHf()`.
 *
 *  Мөрийг `buildOpenSessionRows`-оос авдаг — дэлгэцийн хүснэгт болон хэвлэх
 *  цонхтой ЯГ ижил тоо гарна.
 * ===========================================================================*/

/** ExcelJS-ийн header/footer формат кодод `&` нь удирдах тэмдэг — хоёрлоно. */
function escHf(s: string): string {
  return s.replace(/&/g, '&&');
}

const BORDER_ARGB = 'FF9CA3AF';

function thinBorder(): Partial<ExcelJSNs.Borders> {
  const side = { style: 'thin' as const, color: { argb: BORDER_ARGB } };
  return { top: side, left: side, bottom: side, right: side };
}

export interface OpenXlsxMeta {
  from: string;
  to: string;
  /** Багийн код — файлын нэрэнд ордог (`…_BB.xlsx`), хоосон бол орохгүй. */
  teamCode: string;
  /** «BB — Барилга бүтээц» шошго.  Excel-ийн хуудасны толгойд гарна тул
   *  хэвлэсэн цаас нь аль багийнх болох нь харагдана. */
  teamLabel: string | null;
}

export async function exportOpenSessionsXlsx(
  sessions: AttendanceSession[],
  range: OpenXlsxMeta,
  t: TFn,
): Promise<void> {
  const rows = buildOpenSessionRows(sessions);
  if (rows.length === 0) return;

  const baseTitle = t('attendanceAdminPage.openPrintTitle');
  const title = range.teamLabel ? `${baseTitle} — ${range.teamLabel}` : baseTitle;
  const rangeLabel = openRangeLabel(range.from, range.to, t);

  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();

  const ws = wb.addWorksheet(t('attendanceAdminPage.openXlsxSheet'), {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      printTitlesRow: '1:1',
      margins: { left: 0.4, right: 0.4, top: 0.7, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: {
      oddHeader: `&L&"-,Bold"&12${escHf(title)}&R&9${escHf(rangeLabel)}`,
      oddFooter: `&L&9${escHf(formatDateTime(new Date().toISOString()))}&R&9&P / &N`,
    },
  });

  ws.columns = [
    { header: t('attendanceAdminPage.colNoShort'), key: 'nu', width: 5 },
    { header: t('attendanceAdminPage.colDate'), key: 'date', width: 12 },
    { header: t('common.name'), key: 'name', width: 26 },
    { header: t('attendanceAdminPage.colNu'), key: 'employeeId', width: 9 },
    { header: t('attendanceAdminPage.colTeam'), key: 'team', width: 8 },
    { header: t('attendanceAdminPage.colActualIn'), key: 'clockIn', width: 9 },
    { header: t('attendanceAdminPage.colActualOut'), key: 'clockOut', width: 11 },
    { header: t('attendanceAdminPage.colLateMin'), key: 'late', width: 13 },
    { header: t('attendanceAdminPage.openColDaysOpen'), key: 'daysOpen', width: 9 },
    { header: t('attendanceAdminPage.openColNote'), key: 'note', width: 24 },
  ];

  styleHeaderRow(ws);
  ws.getRow(1).eachCell((cell) => {
    cell.border = thinBorder();
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columns.length } };

  for (const r of rows) {
    const row = ws.addRow({
      nu: r.nu,
      date: r.date,
      name: r.name,
      employeeId: r.employeeId,
      team: r.teamCode,
      clockIn: r.clockIn,
      // ЗОРИУД ХООСОН: эдгээр бүх бүртгэл нээлттэй (гарах цаггүй) тул энэ
      // багана нь цаасан дээр бодит цагийг ГАРААР бөглөх нүд болно.
      clockOut: '',
      late: r.lateMinutes || '',
      daysOpen: r.daysOpen,
      note: r.note,
    });
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = thinBorder();
    });
    row.getCell('note').alignment = { vertical: 'top', wrapText: true };
    for (const key of [
      'nu',
      'date',
      'employeeId',
      'team',
      'clockIn',
      'clockOut',
      'late',
      'daysOpen',
    ]) {
      row.getCell(key).alignment = { vertical: 'middle', horizontal: 'center' };
    }
    if (r.lateMinutes > 0) {
      row.getCell('late').font = { color: { argb: 'FFB91C1C' }, bold: true };
    }
    // Гараар бөглөх нүдийг цайвар дэвсгэрээр тэмдэглэнэ.
    row.getCell('clockOut').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF7ED' },
    };
  }

  const totalRow = ws.addRow({
    nu: '',
    date: '',
    name: t('attendanceAdminPage.openPrintTotal', { count: rows.length }),
    employeeId: '',
    team: '',
    clockIn: '',
    clockOut: '',
    late: '',
    daysOpen: '',
    note: '',
  });
  totalRow.font = { bold: true };
  totalRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = thinBorder();
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
  });

  const teamSuffix = range.teamCode ? `_${range.teamCode.replace(/[^A-Za-z0-9_-]/g, '')}` : '';
  await downloadWorkbook(
    wb,
    `attendance_open_sessions${teamSuffix}_${openFileStamp(range.from, range.to)}.xlsx`,
  );
}
