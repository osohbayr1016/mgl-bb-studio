import { formatDisplayName } from '@/shared/lib/formatting';
import type { TFn } from '@/features/attendance/admin/constants';
import type { ShiftRosterRow } from '@/features/attendance/admin/hooks/useShiftRoster';
import type { ShiftOption } from '@/features/attendance/shifts';
import {
  downloadWorkbook,
  loadExcelJS,
  styleHeaderRow,
} from '@/features/attendance/admin/lib/excel';
import { brand } from '@/shared/config/brand';

/**
 * «Ажлын цаг» таб → XLSX.  Ажилтан бүрд нэг мөр.
 *
 * ⚠️ Мөрүүд нь ДЭЛГЭЦИЙН (шүүсэн, эрэмбэлсэн) жагсаалт — `exportSummaryXlsx`
 *    -ийн сургамжтай ижил: хэрэглэгч ээлжээр шүүгээд татахад файл нь
 *    дэлгэц дээрх зүйлээ агуулах ёстой, компани даяарынхыг БИШ.
 *
 * ⚠️ `ws.getColumn(key)` нь ЗӨВХӨН доор зарласан түлхүүрийг хүлээж авна —
 *    танихгүй мөрийг Excel-ийн багана заах ҮСЭГ гэж үзээд шидэж, файл огт
 *    үүсэхгүй болдог (`exportSummaryXlsx`-ийн 16 хоногийн чимээгүй эвдрэл).
 */
export async function exportShiftRosterXlsx(
  rows: readonly ShiftRosterRow[],
  options: readonly ShiftOption[],
  t: TFn,
) {
  if (rows.length === 0) return;

  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();
  const ws = wb.addWorksheet(t('attendanceAdminPage.xlsxSheetShifts'), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const labelOf = (key: string) => options.find((o) => o.key === key)?.label ?? key;

  ws.columns = [
    { header: t('attendanceAdminPage.colNoShort'), key: 'nu', width: 6 },
    { header: t('common.name'), key: 'name', width: 26 },
    { header: t('attendanceAdminPage.colTeam'), key: 'team', width: 10 },
    { header: t('attendanceAdminPage.colPosition'), key: 'position', width: 22 },
    { header: t('attendanceAdminPage.colShiftSelected'), key: 'shift', width: 18 },
    { header: t('attendanceAdminPage.colShiftEffective'), key: 'effective', width: 18 },
    { header: t('attendanceAdminPage.colShiftChosen'), key: 'chosen', width: 14 },
    { header: t('attendanceAdminPage.colShiftFrom'), key: 'from', width: 14 },
  ];

  styleHeaderRow(ws);

  rows.forEach((r, idx) => {
    const row = ws.addRow({
      nu: idx + 1,
      name: formatDisplayName(r.full_name),
      team: r.team_code ?? '',
      position: r.position ?? '',
      shift: labelOf(r.selected),
      effective: labelOf(r.effective),
      chosen:
        r.source === undefined
          ? ''
          : r.source === 'self'
            ? t('attendanceAdminPage.shiftChosenYes')
            : r.source === 'admin'
              ? t('attendanceAdminPage.shiftChosenAdmin')
              : t('attendanceAdminPage.shiftChosenNo'),
      from: r.effective_from ?? '',
    });
    // Сонголтоо ӨӨРӨӨ хийгээгүй хүнийг ялгаж будна — файл нь «хэнд сануулах вэ»
    // гэсэн жагсаалт болж хэвлэгддэг.  Админ тохируулсан нь ч ажилтны шийдвэр
    // биш тул мөн ялгарна (арай зөөлөн өнгөөр).
    if (r.source === 'default') {
      row.getCell('chosen').font = { color: { argb: 'FFB91C1C' }, bold: true };
    } else if (r.source === 'admin') {
      row.getCell('chosen').font = { color: { argb: 'FF0369A1' } };
    }
  });

  await downloadWorkbook(wb, 'attendance_shifts.xlsx');
}
