import type ExcelJSNs from 'exceljs';

// ExcelJS is ~700 kB and only used by the two export buttons.
// Defer the dependency until the user actually clicks "export" so it
// stays out of the initial route chunk.
type ExcelJSModule = typeof ExcelJSNs;
let excelJsPromise: Promise<ExcelJSModule> | null = null;

export const loadExcelJS = (): Promise<ExcelJSModule> => {
  if (!excelJsPromise) {
    excelJsPromise = import('exceljs')
      .then((m) => (m.default ?? m) as ExcelJSModule)
      // ⚠️ Унасан promise-ыг memo-д ҮЛДЭЭЖ БОЛОХГҮЙ: `if (!excelJsPromise)`
      //    хамгаалалт нь rejected promise-ыг ч truthy гэж үздэг тул сүлжээний
      //    түр саатлаар 930 kB-ийн chunk нэг удаа унавал дараагийн товшилтууд
      //    ганц ч хүсэлт явуулалгүй, ижил алдаагаар мөнхөд унана.
      .catch((err) => {
        excelJsPromise = null;
        throw err;
      });
  }
  return excelJsPromise;
};

/** Түгээмэл толгой мөрийн хэв маяг — хоёр экспорт ижил байдлаар харагдана. */
export function styleHeaderRow(ws: ExcelJSNs.Worksheet) {
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  headerRow.height = 22;
}

/** Workbook-ийг .xlsx болгон татаж авах. */
export async function downloadWorkbook(wb: ExcelJSNs.Workbook, fileName: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
