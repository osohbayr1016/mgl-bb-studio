// Excel export for a Revit QTO run's fact rows. Column-width/header-style
// patterns follow the old projects/lib/qtoExcel.ts workbook.

import type * as ExcelJSNs from 'exceljs';

import type { QtoFactRow, RevitTotals } from './types';
import { buildTree, type PivotField, type PivotSourceRow } from './pivots';
import { brand } from '@/shared/config/brand';

/** Самбарын multi-file export-д fact мөр бүр эх файлын шошготой явна. */
export type TaggedFactRow = QtoFactRow & { file?: string };

type ExcelJSModule = typeof ExcelJSNs;

// exceljs is ~700 KB — keep it out of the route chunk and only load it the
// moment an export is actually requested (it has its own vendor chunk in
// vite.config.ts).
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

const HEADER_FILL: ExcelJSNs.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE5E7EB' },
};

export function styleHeader(ws: ExcelJSNs.Worksheet) {
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.alignment = { horizontal: 'center' };
  head.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
}

export interface QtoExcelLabels {
  sheetOverview: string;
  sheetCategory: string;
  sheetMaterial: string;
  sheetLevel: string;
  project: string;
  file: string;
  date: string;
  by: string;
  revitVersion: string;
  category: string;
  family: string;
  type: string;
  level: string;
  material: string;
  count: string;
  length: string;
  area: string;
  volume: string;
  mass: string;
  total: string;
  noCategory: string;
  noFamily: string;
  noType: string;
  noLevel: string;
  noMaterial: string;
  /** Multi-file горимд л хэрэглэгдэнэ (заавал биш). */
  sheetFiles?: string;
  colFile?: string;
  elements?: string;
  /** 0120 талбарууд — өгвөл Категори sheet-д нэмэлт баганууд гарна. */
  colMark?: string;
  colMarks?: string;
  colThickness?: string;
  colKeynote?: string;
  sheetRooms?: string;
  roomNumber?: string;
  roomName?: string;
}

export interface QtoExcelInput {
  fileName: string;
  meta: {
    project: string;
    file: string;
    date: string;
    by: string;
    revitVersion: string;
  };
  totals: RevitTotals | null;
  facts: TaggedFactRow[];
  labels: QtoExcelLabels;
  /** Самбарын нэгтгэсэн export: «Файлууд» sheet + Категори sheet-д Файл багана. */
  multiFile?: boolean;
  files?: { name: string; date: string; elements: number }[];
  /** Өрөөний ведомость (0120) — өгвөл «Өрөө» sheet нэмэгдэнэ. */
  rooms?: { number: string; name: string; level: string; area_m2: number | null }[];
}

const METRIC_COLUMNS = (
  l: QtoExcelLabels,
): Partial<ExcelJSNs.Column>[] => [
  { header: l.count, key: 'count', width: 10 },
  { header: l.length, key: 'length', width: 14 },
  { header: l.area, key: 'area', width: 14 },
  { header: l.volume, key: 'volume', width: 16 },
  { header: l.mass, key: 'mass', width: 16 },
];

function applyMetricFormats(ws: ExcelJSNs.Worksheet) {
  ws.getColumn('count').numFmt = '#,##0';
  for (const key of ['length', 'area', 'volume'] as const) {
    ws.getColumn(key).numFmt = '#,##0.00';
  }
  ws.getColumn('mass').numFmt = '#,##0.0';
}

/** One sheet grouped by a single fact field, metrics summed per group. */
function addGroupedSheet(
  wb: ExcelJSNs.Workbook,
  facts: PivotSourceRow[],
  field: PivotField,
  sheetName: string,
  groupHeader: string,
  emptyLabel: string,
  labels: QtoExcelLabels,
) {
  const ws = wb.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: groupHeader, key: 'group', width: 34 },
    ...METRIC_COLUMNS(labels),
  ];
  const { roots, totals } = buildTree(facts, [field]);
  for (const node of roots) {
    ws.addRow({
      group: node.value || emptyLabel,
      count: node.metrics.count,
      length: node.metrics.length_m,
      area: node.metrics.area_m2,
      volume: node.metrics.volume_m3,
      mass: node.metrics.mass_kg,
    });
  }
  const totalRow = ws.addRow({
    group: labels.total,
    count: totals.count,
    length: totals.length_m,
    area: totals.area_m2,
    volume: totals.volume_m3,
    mass: totals.mass_kg,
  });
  totalRow.font = { bold: true };
  applyMetricFormats(ws);
  styleHeader(ws);
}

/**
 * Нэг ведомостыг (generic мөр×багана) Excel болгож татна — Самбарын
 * «Ведомость» view-гийн жагсаалтын download товч.
 */
export async function exportScheduleXlsx(input: {
  fileName: string;
  sheetName: string;
  columns: string[];
  rows: string[][];
}): Promise<void> {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();

  // Excel sheet нэрэнд \/*?:[] хориотой, ≤31 тэмдэгт.
  const safeSheet = input.sheetName.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || 'Sheet1';
  const ws = wb.addWorksheet(safeSheet, { views: [{ state: 'frozen', ySplit: 1 }] });

  const colCount = Math.max(input.columns.length, ...input.rows.map((r) => r.length), 1);
  ws.columns = Array.from({ length: colCount }, (_, i) => ({
    header: input.columns[i] ?? '',
    key: `c${i}`,
    width: 24,
  }));
  for (const row of input.rows) {
    ws.addRow(Object.fromEntries(row.map((v, i) => [`c${i}`, v])));
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

/**
 * Build the workbook — Тойм (meta + totals), Категори (flat fact rows),
 * Материал (grouped), Давхар (grouped) — and trigger a browser download.
 */
export async function exportQtoXlsx(input: QtoExcelInput): Promise<void> {
  const { facts, labels, meta, totals, multiFile, files } = input;
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();

  /* Тойм — meta + totals */
  {
    const ws = wb.addWorksheet(labels.sheetOverview);
    ws.columns = [
      { header: '', key: 'label', width: 26 },
      { header: '', key: 'value', width: 40 },
    ];
    ws.addRow({ label: labels.project, value: meta.project });
    ws.addRow({ label: labels.file, value: meta.file });
    ws.addRow({ label: labels.date, value: meta.date });
    if (meta.by) ws.addRow({ label: labels.by, value: meta.by });
    if (meta.revitVersion) ws.addRow({ label: labels.revitVersion, value: meta.revitVersion });
    ws.addRow({});
    if (totals) {
      ws.addRow({ label: labels.count, value: totals.count });
      ws.addRow({ label: labels.length, value: totals.length_m });
      ws.addRow({ label: labels.area, value: totals.area_m2 });
      ws.addRow({ label: labels.volume, value: totals.volume_m3 });
      ws.addRow({ label: labels.mass, value: totals.mass_kg });
    }
    ws.getColumn('label').font = { bold: true };
  }

  /* Файлууд — multi-file export-д хамрагдсан файл бүрийн мөр. */
  if (multiFile && files && files.length > 0) {
    const ws = wb.addWorksheet(labels.sheetFiles ?? 'Files', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: labels.colFile ?? labels.file, key: 'name', width: 44 },
      { header: labels.date, key: 'date', width: 20 },
      { header: labels.elements ?? labels.count, key: 'elements', width: 12 },
    ];
    for (const f of files) ws.addRow({ name: f.name, date: f.date, elements: f.elements });
    ws.getColumn('elements').numFmt = '#,##0';
    styleHeader(ws);
  }

  /* Категори — the flat fact table (category / family / type / level /
     material + the five metrics). Facts are already the finest grain.
     Multi-file горимд тэргүүн «Файл» багана; labels.colMark өгөгдсөн бол
     0120 талбарууд (марк/зузаан/keynote) мөн нэмэгдэнэ. */
  const withNewFields = !!labels.colMark;
  {
    const ws = wb.addWorksheet(labels.sheetCategory, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      ...(multiFile
        ? [{ header: labels.colFile ?? labels.file, key: 'file', width: 30 } as Partial<ExcelJSNs.Column>]
        : []),
      { header: labels.category, key: 'category', width: 26 },
      { header: labels.family, key: 'family', width: 28 },
      { header: labels.type, key: 'type', width: 30 },
      ...(withNewFields
        ? ([
            { header: labels.colMark, key: 'mark', width: 14 },
            { header: labels.colMarks, key: 'marks', width: 24 },
          ] as Partial<ExcelJSNs.Column>[])
        : []),
      { header: labels.level, key: 'level', width: 18 },
      { header: labels.material, key: 'material', width: 30 },
      ...(withNewFields
        ? ([
            { header: labels.colThickness, key: 'thickness', width: 12 },
            { header: labels.colKeynote, key: 'keynote', width: 20 },
          ] as Partial<ExcelJSNs.Column>[])
        : []),
      ...METRIC_COLUMNS(labels),
    ];
    for (const f of facts) {
      ws.addRow({
        ...(multiFile ? { file: f.file ?? '' } : {}),
        category: f.category || labels.noCategory,
        family: f.family || labels.noFamily,
        type: f.type_name || labels.noType,
        ...(withNewFields
          ? {
              mark: f.type_mark ?? '',
              marks: f.marks ?? '',
              thickness: f.thickness_mm,
              keynote: f.keynote ?? '',
            }
          : {}),
        level: f.level || labels.noLevel,
        material: f.material || labels.noMaterial,
        count: f.count,
        length: f.length_m,
        area: f.area_m2,
        volume: f.volume_m3,
        mass: f.mass_kg,
      });
    }
    applyMetricFormats(ws);
    styleHeader(ws);
  }

  /* Өрөө — ведомость (0120): дугаар / нэр / давхар / м². */
  if (input.rooms && input.rooms.length > 0 && labels.sheetRooms) {
    const ws = wb.addWorksheet(labels.sheetRooms, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: labels.roomNumber ?? '#', key: 'number', width: 12 },
      { header: labels.roomName ?? '', key: 'name', width: 36 },
      { header: labels.level, key: 'level', width: 18 },
      { header: labels.area, key: 'area', width: 14 },
    ];
    for (const r of input.rooms) {
      ws.addRow({ number: r.number, name: r.name, level: r.level, area: r.area_m2 });
    }
    ws.getColumn('area').numFmt = '#,##0.00';
    styleHeader(ws);
  }

  /* Материал / Давхар — grouped */
  addGroupedSheet(wb, facts, 'material', labels.sheetMaterial, labels.material, labels.noMaterial, labels);
  addGroupedSheet(wb, facts, 'level', labels.sheetLevel, labels.level, labels.noLevel, labels);

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
