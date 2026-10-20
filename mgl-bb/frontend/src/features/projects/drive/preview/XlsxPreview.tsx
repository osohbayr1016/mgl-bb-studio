/**
 * .xlsx-ийг ХӨТӨЧ ДЭЭР уншиж (`exceljs` — аль хэдийн бандлд байгаа сан)
 * Excel-тэй адил хүснэгтээр харуулна: хуудас бүр таб, баганын үсэг, мөрийн
 * дугаар, нэгтгэсэн нүд (colspan/rowspan), хадгалагдсан томьёоны УТГА.
 *
 * Эзний 2026-09-11-ний гомдол: Drive-ын xlsx-ийн зураг «looks terrible».
 * Энэ нь Drive-аас ирсэн эх байтуудаас шууд — хуулбар, Google хөрвүүлэлт,
 * серверийн ажил ХЭРЭГГҮЙ.  Хэв маяг (өнгө, шрифт) бүрэн хуулагдахгүй;
 * яг Excel шиг харах бол «Эх файлыг нээх».
 *
 * Хэмжээний тааз: мөр 3 000 / багана 80 тутамд хуудас бүр — түүнээс дээшийг
 * тасалж «… мөр дутуу» гэж хэлнэ (DOM-д 100 000 нүд хийхгүй).
 */
import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/i18n';
import { loadExcelJS } from '@/features/attendance/admin/lib/excel';
import { toView, type SheetView } from './xlsxView';

interface ParseResult {
  blob: Blob;
  sheets: SheetView[] | null;
  error: boolean;
}

export default function XlsxPreview({ blob, name }: { blob: Blob; name: string }) {
  const { t } = useLanguage();
  // Үр дүнг ямар blob-ынх гэдгээр нь тэмдэглэнэ — өөр файл ирэхэд хуучин
  // хүснэгт хэзээ ч харагдахгүй, effect дотор синхрон setState хэрэггүй.
  const [result, setResult] = useState<ParseResult | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ExcelJS = await loadExcelJS();
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await blob.arrayBuffer());
        const views = wb.worksheets
          .filter((ws) => ws.state !== 'hidden' && ws.state !== 'veryHidden')
          .map(toView);
        if (!cancelled) setResult({ blob, sheets: views, error: false });
      } catch (err) {
        console.error('[drive-preview] xlsx parse failed', name, err);
        if (!cancelled) setResult({ blob, sheets: null, error: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob, name]);

  const current = result && result.blob === blob ? result : null;
  const sheets = current?.sheets ?? null;
  const error = current?.error ?? false;
  const active = sheets ? Math.min(activeIdx, sheets.length - 1) : 0;
  const sheet = useMemo(() => sheets?.[active] ?? null, [sheets, active]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{t('projectDrive.renderFailed')}</p>
      </div>
    );
  }
  if (!sheets || !sheet) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">{t('projectDrive.rendering')}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <table className="border-collapse text-xs" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 44 }} />
            {sheet.colWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="border border-border bg-muted px-1 py-0.5 text-center font-normal text-muted-foreground" />
              {sheet.cols.map((c) => (
                <th key={c} className="border border-border bg-muted px-1 py-0.5 text-center font-normal text-muted-foreground">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row) => (
              <tr key={row.n}>
                <td className="border border-border bg-muted px-1 py-0.5 text-center text-muted-foreground">{row.n}</td>
                {row.cells.map((cell, i) =>
                  cell.covered ? null : (
                    <td
                      key={i}
                      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
                      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                      className={cn(
                        'overflow-hidden text-ellipsis whitespace-nowrap border border-border/70 px-1.5 py-0.5 align-top text-foreground',
                        cell.align === 'right' && 'text-right tabular-nums',
                        cell.align === 'center' && 'text-center',
                        cell.bold && 'font-semibold',
                      )}
                      title={cell.text.length > 24 ? cell.text : undefined}
                    >
                      {cell.text}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {(sheet.truncatedRows > 0 || sheet.truncatedCols > 0) && (
          <p className="px-3 py-2 text-[11px] text-muted-foreground">
            {t('projectDrive.sheetTruncated', { rows: sheet.truncatedRows, cols: sheet.truncatedCols })}
          </p>
        )}
      </div>
      {/* Excel шиг доод талын хуудасны табууд. */}
      <div className="flex shrink-0 gap-1 overflow-x-auto border-t border-border bg-muted/40 px-2 py-1">
        {sheets.map((s, i) => (
          <button
            key={s.name + i}
            type="button"
            onClick={() => setActiveIdx(i)}
            className={cn(
              'whitespace-nowrap rounded-md px-2.5 py-1 text-xs',
              i === active
                ? 'bg-background font-medium text-foreground shadow-xs'
                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
            )}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
