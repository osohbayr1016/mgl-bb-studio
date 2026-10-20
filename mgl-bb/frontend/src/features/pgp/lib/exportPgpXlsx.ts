// PGP (Хөгжлийн төлөвлөгөө)-ийн Excel export — «бүх хүнээр» болон «хүн
// хүнээр» хоёулаа ижил флат хүснэгт үүсгэнэ: нэг мөр = ажилтан × period,
// багана = Нэр / Баг / Он / Шинэчилсэн огноо / 9 асуултын хариулт
// (PGP_SECTIONS дараалал) / Санал (feedback мөр мөрөөр).

import { loadExcelJS, styleHeader } from '@/features/qto/lib/exportXlsx';
import { formatDateTime } from '@/shared/lib/time';
import type { PgpComment } from '@/shared/types';
import { PGP_SECTIONS, pgpSelectLabelKey } from '../pgpFields';
import { brand } from '@/shared/config/brand';

export interface PgpXlsxRow {
  /** formatDisplayName-ээр бэлдсэн нэр. */
  name: string;
  teamCode: string | null;
  teamName: string | null;
  period: string;
  /** raw ISO — builder дотор formatDateTime хийнэ. */
  updatedAt: string;
  /** Backend serializePlan-ийн answers — string биш утгыг хоосноор орлуулна. */
  answers: Record<string, unknown>;
  comments: Pick<PgpComment, 'author_name' | 'note' | 'created_at'>[];
}

/** Файлын нэрэнд орох хэсгийг ариутгана (кирилл үсгийг хадгална). */
export const sanitizeFileNamePart = (s: string): string =>
  s.replace(/[^\p{L}\p{N}_-]+/gu, '_');

// Excel-ийн нэг нүдний дээд хязгаар 32,767 тэмдэгт — багахан нөөцтэй таслана.
const CELL_CAP = 32_000;
const cap = (s: string) => (s.length > CELL_CAP ? s.slice(0, CELL_CAP) : s);

export async function exportPgpXlsx(input: {
  fileName: string;
  sheetName: string;
  rows: PgpXlsxRow[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}): Promise<void> {
  const { t } = input;
  const fields = PGP_SECTIONS.flatMap((s) => s.fields);

  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();

  // Excel sheet нэрэнд \/*?:[] хориотой, ≤31 тэмдэгт.
  const safeSheet = input.sheetName.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Sheet1';
  const ws = wb.addWorksheet(safeSheet, { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = [
    { header: t('pgpExport.colName'), key: 'name', width: 22 },
    { header: t('pgpExport.colTeam'), key: 'team', width: 22 },
    { header: t('pgpExport.colPeriod'), key: 'period', width: 8 },
    { header: t('pgpExport.colUpdated'), key: 'updated', width: 18 },
    ...fields.map((f) => ({
      header: t(f.labelKey),
      key: `f_${f.key}`,
      width: f.type === 'select' ? 24 : 40,
    })),
    { header: t('pgpExport.colFeedback'), key: 'feedback', width: 50 },
  ];

  for (const row of input.rows) {
    const cells: Record<string, string> = {
      name: row.name,
      team:
        row.teamCode && row.teamName
          ? `${row.teamCode} — ${row.teamName}`
          : (row.teamCode ?? row.teamName ?? ''),
      period: row.period,
      updated: formatDateTime(row.updatedAt),
      feedback: cap(
        row.comments
          .map((cm) => `${cm.author_name ?? '—'} (${formatDateTime(cm.created_at)}): ${cm.note}`)
          .join('\n'),
      ),
    };
    for (const f of fields) {
      const v = row.answers[f.key];
      const raw = typeof v === 'string' ? v : '';
      if (f.type === 'select') {
        // Хадгалагдсан утгыг маягт дээрх label болгож буулгана ('' →
        // «тодорхойгүй» сонголт); танихгүй утга raw-аараа гарна.
        const labelKey = pgpSelectLabelKey(f, raw);
        cells[`f_${f.key}`] = labelKey ? t(labelKey) : raw;
      } else {
        cells[`f_${f.key}`] = cap(raw);
      }
    }
    ws.addRow(cells);
  }

  // Урт текстэн баганад wrap — Excel нүдэн доторх \n-ийг зөвхөн wrapText
  // үед мөр болгож үзүүлдэг. styleHeader-ийг ДАРАА нь дуудсанаар толгойн
  // мөр row-түвшний alignment-аараа голлосон хэвээр үлдэнэ.
  const wrapKeys = [
    ...fields.filter((f) => f.type !== 'select').map((f) => `f_${f.key}`),
    'feedback',
  ];
  for (const key of wrapKeys) {
    ws.getColumn(key).alignment = { wrapText: true, vertical: 'top' };
  }
  styleHeader(ws);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = input.fileName;
  a.click();
  URL.revokeObjectURL(url);
}
