/**
 * Үнэлгээний Excel export — нэг хүнээр (`exportParticipantXlsx`) ба бүх багаар
 * (`exportRoundXlsx`).
 *
 * Хэв маягийг `@/features/qto/lib/exportXlsx` ба `@/features/pgp/lib/
 * exportPgpXlsx` хоёроос авсан: exceljs нь ~700 KB тул `loadExcelJS()`-ээр
 * зөвхөн татах товч дарагдсан үед lazy ачаална, толгойн мөрийг `styleHeader`
 * -ээр будна.
 *
 * Нэг хүний workbook-ийн хуудсууд (эх Excel-ийн бүтэц):
 *   1. «REPORT DIAGRAMM» — толгойд Нэр/Албан тушаал/Жил, дараа нь part бүрээр
 *      Хэсэг|Must|Self|Senior|Average|Эзлэх хувь|Үнэлгээний хувь|Level + НИЙТ.
 *   2. «Хариултууд»      — мөр бүр нэг асуулт: хэсэг, дэд асуулт, асуулт,
 *      өөрийн / ахлахын / дундаж үнэлгээ.
 *   3. «Графикууд»       — scatter + radar-ийн PNG (DOM дахь SVG-ээс
 *      `chartImage.ts`-ээр авсан). Зураг олдоогүй бол хуудас алгасагдана —
 *      тоон хүснэгтүүд ямар ч тохиолдолд бүрэн гарна.
 */

import type * as ExcelJSNs from 'exceljs';

import { loadExcelJS, styleHeader } from '@/features/qto/lib/exportXlsx';

import type { ParticipantResult } from '../api';
import type { AssessmentLevelBand, AssessmentSchema } from '../types';
import type { ResultPart } from './aggregate';
import { itemScore, scaleForPart, DEFAULT_LEVELS } from './score';
import {
  bandForMean,
  BEHAVIOR_BANDS,
  partMean,
  partScaleMax,
  sectionMean,
  sectionScaleMax,
} from './behaviorScale';
import { findBehaviorPart } from './behaviorPart';
import { fitChartBox } from './chartImage';
import { brand } from '@/shared/config/brand';

// ---------------------------------------------------------------------------
// Үр дүнг хэлбэржүүлэх туслахууд
//
// Дэлгэц дээрх REPORT DIAGRAMM хүснэгт БОЛОН энэ workbook хоёул эдгээрийг
// ашиглана — тэгснээр «дэлгэц дээр нэг тоо, Excel дээр өөр тоо» гэж гарахгүй.
// (Компонентын файлаас гаргавал `react-refresh/only-export-components`
// зөрчигдөх тул тэдгээр нь энд байна.)
//
// ⚠️ Нэгтгэлийн (дундаж) логик нь `./aggregate`-д ЗӨӨГДСӨН — тэр нь `exceljs`
//    -гүй, зөвхөн тоо боддог модуль. Хуучин импортлогчид эвдрэхгүйн тулд
//    ижил нэрсээр нь эндээс дахин экспортолж байна; ШИНЭ код нь шууд
//    `./aggregate`-аас импортлох нь зүйтэй.
// ---------------------------------------------------------------------------

export {
  averageParts,
  buildCohort,
  checkAverageInvariant,
  meanOf,
  sidesPresent,
  type Cohort,
  type CohortExcludeReason,
  type CohortMode,
  type ResultPart,
  type ResultSection,
} from './aggregate';

export const fmtPoints = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';

export const fmtPct = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';

/** i18n-ийн `t` — компонентоос дамжина (энэ файл hook дуудахгүй). */
export type TFn = (key: string, params?: Record<string, string | number>) => string;

export interface ChartImageInput {
  title: string;
  /** `svgToPngDataUrl`-ийн үр дүн. `null` бол алгасана. */
  dataUrl: string | null;
  width?: number;
  height?: number;
  /** Аль part-ынх вэ — dashboard хуудсанд зөв лэйн рүү байрлуулахад хэрэглэнэ. */
  partId?: string;
  /** 'main' — үндсэн (scatter/аль ч) зураг, 'radar' — spider зураг. */
  kind?: 'main' | 'radar';
}

const DEFAULT_CHART_WIDTH = 760;
const DEFAULT_CHART_HEIGHT = 360;

/** Excel-ийн нэг нүдний дээд хязгаар 32,767 — багахан нөөцтэй таслана. */
const CELL_CAP = 32_000;
const cap = (s: string) => (s.length > CELL_CAP ? s.slice(0, CELL_CAP) : s);

/** Файлын нэрэнд орох хэсгийг ариутгана (кирилл үсгийг хадгална). */
export const sanitizeFileNamePart = (s: string): string =>
  s.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '');

/** Excel sheet нэрэнд \/*?:[] хориотой, ≤31 тэмдэгт. */
const safeSheetName = (name: string, fallback: string): string =>
  name.replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || fallback;

const PCT_FMT = '0.0"%"';
const POINT_FMT = '#,##0.0';
/** Зан чанарын 1.0–5.0 дундаж/оноо баганад — хувь ('%') биш энгийн тоо. */
const MEAN_FMT = '0.0';

/** `styleHeader`-тэй ижил саарал дүүргэлт — дунд мөрөнд байрлах толгойд. */
const HEADER_FILL: ExcelJSNs.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE5E7EB' },
};

function styleTableHeader(row: ExcelJSNs.Row) {
  row.font = { bold: true };
  row.alignment = { horizontal: 'center', wrapText: true };
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
}

function downloadWorkbook(wb: ExcelJSNs.Workbook, fileName: string) {
  return wb.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ---------------------------------------------------------------------------
// REPORT DIAGRAMM хүснэгт
// ---------------------------------------------------------------------------

const REPORT_COLUMNS = (t: TFn): Partial<ExcelJSNs.Column>[] => [
  { header: t('assessments.colSection'), key: 'section', width: 32 },
  { header: t('assessments.colMust'), key: 'must', width: 10 },
  { header: t('assessments.colSelf'), key: 'self', width: 10 },
  { header: t('assessments.colSenior'), key: 'senior', width: 10 },
  { header: t('assessments.colAverage'), key: 'average', width: 12 },
  { header: t('assessments.colWeight'), key: 'weight', width: 14 },
  { header: t('assessments.colScorePct'), key: 'pct', width: 18 },
  { header: t('assessments.colLevel'), key: 'level', width: 14 },
];

/** Ур чадварын (weighted) part-ын хүснэгтийг идэвхтэй sheet рүү бичнэ. */
function writeWeightedPartTable(ws: ExcelJSNs.Worksheet, part: ResultPart, t: TFn) {
  const titleRow = ws.addRow({ section: part.title });
  titleRow.font = { bold: true };

  const columns = REPORT_COLUMNS(t);
  const headerRow = ws.addRow(
    Object.fromEntries(columns.map((c) => [c.key ?? '', c.header ?? ''])),
  );
  styleTableHeader(headerRow);

  for (const section of part.sections) {
    const row = ws.addRow({
      section: section.title,
      must: section.must,
      self: section.self,
      senior: section.senior,
      average: section.average,
      weight: section.weight,
      pct: section.pct,
      level: section.level?.label ?? '',
    });
    row.getCell('must').numFmt = POINT_FMT;
    row.getCell('self').numFmt = POINT_FMT;
    row.getCell('senior').numFmt = POINT_FMT;
    row.getCell('average').numFmt = POINT_FMT;
    row.getCell('weight').numFmt = PCT_FMT;
    row.getCell('pct').numFmt = PCT_FMT;
  }

  const totalRow = ws.addRow({
    section: t('assessments.colTotal'),
    must: part.totals.must,
    self: part.totals.self,
    senior: part.totals.senior,
    average: part.totals.average,
    weight: part.weight_sum,
    pct: part.overall_pct,
    level: part.overall_level?.label ?? '',
  });
  totalRow.font = { bold: true };
  totalRow.getCell('must').numFmt = POINT_FMT;
  totalRow.getCell('self').numFmt = POINT_FMT;
  totalRow.getCell('senior').numFmt = POINT_FMT;
  totalRow.getCell('average').numFmt = POINT_FMT;
  totalRow.getCell('weight').numFmt = PCT_FMT;
  totalRow.getCell('pct').numFmt = PCT_FMT;

  ws.addRow({});
}

/**
 * Зан чанарын (weighted: false) part-ын хүснэгт — 1.0–5.0 дундаж + Монгол band.
 *
 * `REPORT_COLUMNS`-ийн ЯГ ИЖИЛ 8 түлхүүрийг (`ws.columns` sheet тутамд НЭГ л
 * удаа зарлагддаг тул) өөр утгаар дахин ашиглана:
 *   must→Дээд үнэлгээ, self/senior/average→дундаж, weight→хоосон,
 *   pct→Тодорхойлолт (band нэр), level→Тайлбар (band-ийн утга).
 */
function writeBehaviorPartTable(ws: ExcelJSNs.Worksheet, part: ResultPart, t: TFn) {
  const titleRow = ws.addRow({ section: part.title });
  titleRow.font = { bold: true };

  const headerRow = ws.addRow({
    section: t('assessments.colSection'),
    must: t('assessments.colMaxScore'),
    self: t('assessments.colSelf'),
    senior: t('assessments.colSenior'),
    average: t('assessments.colAverage'),
    weight: '',
    pct: t('assessments.colBandLabel'),
    level: t('assessments.colBandDescription'),
  });
  styleTableHeader(headerRow);

  for (const section of part.sections) {
    const band = bandForMean(sectionMean(section));
    const row = ws.addRow({
      section: section.title,
      must: sectionScaleMax(section),
      self: sectionMean(section, 'self'),
      senior: sectionMean(section, 'senior'),
      average: sectionMean(section, 'average'),
      weight: null,
      pct: band?.label ?? '',
      level: band?.description ?? '',
    });
    row.getCell('must').numFmt = MEAN_FMT;
    row.getCell('self').numFmt = MEAN_FMT;
    row.getCell('senior').numFmt = MEAN_FMT;
    row.getCell('average').numFmt = MEAN_FMT;
  }

  const total = partMean(part);
  const totalBand = bandForMean(total);
  const totalRow = ws.addRow({
    section: t('assessments.colTotal'),
    must: partScaleMax(part),
    self: null,
    senior: null,
    average: total,
    weight: null,
    pct: totalBand?.label ?? '',
    level: totalBand?.description ?? '',
  });
  totalRow.font = { bold: true };
  totalRow.getCell('must').numFmt = MEAN_FMT;
  totalRow.getCell('average').numFmt = MEAN_FMT;

  ws.addRow({});
}

/** Part-ынхаа төрлөөр зөв хүснэгт бичигчийг сонгоно. */
function writePartTable(ws: ExcelJSNs.Worksheet, part: ResultPart, t: TFn) {
  if (part.weighted) writeWeightedPartTable(ws, part, t);
  else writeBehaviorPartTable(ws, part, t);
}

// ---------------------------------------------------------------------------
// Хариултын мөрүүд
// ---------------------------------------------------------------------------

export interface AnswerRow {
  section: string;
  group: string;
  question: string;
  self: number | null;
  senior: number | null;
  average: number | null;
}

/**
 * Схемийг тойрч, мөр бүрийн өөрийн / ахлахын / дундаж оноог гаргана.
 * Excel-ийн «Хариултууд» хуудас БОЛОН дэлгэц дээрх хариултын хүснэгт хоёул
 * үүнийг ашиглана — хоёр газар өөр тоо гарах эрсдэлгүй.
 *
 * `result.answers.senior` нь илгээсэн ахлагч бүрийн хариултын массив
 * (0..N) — мөр бүрийн `senior` утга нь тэдгээрийн ДУНДАЖ (section-ийн
 * "senior" оноог хэд хэдэн ахлагчаар дундажилдагтай ижил зарчим).
 */
export function buildAnswerRows(schema: AssessmentSchema, result: ParticipantResult): AnswerRow[] {
  const rows: AnswerRow[] = [];
  for (const part of schema.parts) {
    const scale = scaleForPart(schema, part);
    for (const section of part.sections) {
      for (const group of section.groups) {
        for (const item of group.items) {
          const rawSelf = result.answers.self?.[item.id];
          const self =
            typeof rawSelf === 'number' && rawSelf > 0
              ? itemScore(rawSelf, scale, item.reverse)
              : null;
          const seniorScores = (result.answers.senior ?? [])
            .map((answers) => answers?.[item.id])
            .filter((raw): raw is number => typeof raw === 'number' && raw > 0)
            .map((raw) => itemScore(raw, scale, item.reverse));
          const senior = seniorScores.length
            ? seniorScores.reduce((a, b) => a + b, 0) / seniorScores.length
            : null;
          const present = [self, senior].filter((v): v is number => v !== null);
          rows.push({
            section: section.title,
            group: group.title,
            question: cap(item.text),
            self,
            senior,
            average: present.length ? present.reduce((a, b) => a + b, 0) / present.length : null,
          });
        }
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Графикийн хуудас
// ---------------------------------------------------------------------------

function addChartsSheet(
  wb: ExcelJSNs.Workbook,
  charts: ChartImageInput[] | undefined,
  t: TFn,
): void {
  const usable = (charts ?? []).filter(
    (c): c is ChartImageInput & { dataUrl: string } => !!c.dataUrl,
  );
  // Зураг огт олдоогүй бол хоосон хуудас нэмэхгүй — тоон хүснэгтүүд хангалттай.
  if (!usable.length) return;

  const ws = wb.addWorksheet(safeSheetName(t('assessments.xlsxSheetCharts'), 'Charts'));
  ws.getColumn(1).width = 4;

  let row = 1;
  for (const chart of usable) {
    const titleCell = ws.getCell(row, 2);
    titleCell.value = chart.title;
    titleCell.font = { bold: true };
    row += 1;

    const width = chart.width ?? DEFAULT_CHART_WIDTH;
    const height = chart.height ?? DEFAULT_CHART_HEIGHT;
    const imageId = wb.addImage({ base64: chart.dataUrl, extension: 'png' });
    // tl нь 0-ээс эхэлдэг (мөр 1 = row 0), ext нь пикселээр.
    ws.addImage(imageId, {
      tl: { col: 1, row },
      ext: { width, height },
    });
    // Нэг мөр ≈ 20px — зурагны дараа сул зайтай үргэлжилнэ.
    row += Math.ceil(height / 20) + 2;
  }
}

// ---------------------------------------------------------------------------
// Dashboard хуудас — эхний хуудас: зүүн лэйн ур чадвар (хүснэгт + scatter),
// баруун лэйн зан чанар (хүснэгт + radar), доор нь хоёр тайлбарын хүснэгт.
//
// `ws.columns` ЗААХГҮЙ — зөвхөн үнэмлэхүй `ws.getCell(r, c)` бичилт. Учир нь
// key-based хуучин writer-үүд (`writePartTable`) НЭГ л удаа `ws.columns`
// зарлагдсан sheet дээр л ажилладаг (§0-ийн тайлбар — `exportQuoteXlsx.ts`
// -ийн загвар).
// ---------------------------------------------------------------------------

/** px → Excel-ийн баганы нэгж — файл даяар ашиглагддаг харьцаа (`px / 7`). */
const PX_PER_COL = 7;

/** Зүүн лэйн (ур чадвар) — `REPORT_COLUMNS`-тэй ижил 8 баганы өргөн. */
const DASH_SKILL_WIDTHS = [32, 10, 10, 10, 12, 14, 18, 14];
/** Гутер (хоосон зай) баганы өргөн. */
const DASH_GUTTER_WIDTH = 3;
/** Баруун лэйн (зан чанар) — Жин баганагүй тул 7 багана. */
const DASH_BEHAVIOR_WIDTHS = [32, 10, 10, 10, 12, 18, 24];

const DASH_LEFT_COL = 1;
const DASH_GUTTER_COL = DASH_LEFT_COL + DASH_SKILL_WIDTHS.length;
const DASH_RIGHT_COL = DASH_GUTTER_COL + 1;
const DASH_TOTAL_COLS = DASH_RIGHT_COL + DASH_BEHAVIOR_WIDTHS.length - 1;

const DASH_LEFT_LANE_MAX_PX = DASH_SKILL_WIDTHS.reduce((a, b) => a + b, 0) * PX_PER_COL;
const DASH_RIGHT_LANE_MAX_PX = DASH_BEHAVIOR_WIDTHS.reduce((a, b) => a + b, 0) * PX_PER_COL;

/** `#16a34a` → `FF16A34A` (exceljs-ийн ARGB дүүргэлт). */
function argbFromHex(hex: string): string {
  return `FF${hex.replace('#', '').toUpperCase()}`;
}

/**
 * Нэг part-ын хүснэгтийг үнэмлэхүй нүднүүд рүү бичнэ (title + толгой мөр +
 * хэсэг тус бүрийн мөр + нийт мөр). `variant: 'skill'` нь `REPORT_COLUMNS`
 * -ийн ЯГ ИЖИЛ 8 баганыг, `variant: 'behavior'` нь Жингүй 7 баганыг ашиглана
 * (сибл агентын `behaviorScale.ts` туслахуудаар 1.0–5.0 дундажаа бодно).
 *
 * @returns Нийт мөрний ДАРАА байрлах чөлөөт мөрний дугаар (1-based).
 */
function writeDashboardBlock(
  ws: ExcelJSNs.Worksheet,
  part: ResultPart,
  t: TFn,
  topRow: number,
  startCol: number,
  variant: 'skill' | 'behavior',
): number {
  let r = topRow;

  const titleCell = ws.getCell(r, startCol);
  titleCell.value = part.title;
  titleCell.font = { bold: true, size: 12 };
  r += 1;

  const headers =
    variant === 'skill'
      ? [
          t('assessments.colSection'),
          t('assessments.colMust'),
          t('assessments.colSelf'),
          t('assessments.colSenior'),
          t('assessments.colAverage'),
          t('assessments.colWeight'),
          t('assessments.colScorePct'),
          t('assessments.colLevel'),
        ]
      : [
          t('assessments.colSection'),
          t('assessments.colMaxScore'),
          t('assessments.colSelf'),
          t('assessments.colSenior'),
          t('assessments.colAverage'),
          t('assessments.colBandLabel'),
          t('assessments.colBandDescription'),
        ];

  headers.forEach((h, i) => {
    const cell = ws.getCell(r, startCol + i);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center', wrapText: true };
    cell.fill = HEADER_FILL;
  });
  r += 1;

  for (const section of part.sections) {
    if (variant === 'skill') {
      const values: (string | number | null)[] = [
        section.title,
        section.must,
        section.self,
        section.senior,
        section.average,
        section.weight,
        section.pct,
        section.level?.label ?? '',
      ];
      values.forEach((v, i) => {
        const cell = ws.getCell(r, startCol + i);
        cell.value = v;
        if (i >= 1 && i <= 4) cell.numFmt = POINT_FMT;
        if (i === 5 || i === 6) cell.numFmt = PCT_FMT;
      });
    } else {
      const band = bandForMean(sectionMean(section));
      const values: (string | number | null)[] = [
        section.title,
        sectionScaleMax(section),
        sectionMean(section, 'self'),
        sectionMean(section, 'senior'),
        sectionMean(section, 'average'),
        band?.label ?? '',
        band?.description ?? '',
      ];
      values.forEach((v, i) => {
        const cell = ws.getCell(r, startCol + i);
        cell.value = v;
        if (i >= 1 && i <= 4) cell.numFmt = MEAN_FMT;
        if (i === 6) cell.alignment = { wrapText: true };
      });
    }
    r += 1;
  }

  if (variant === 'skill') {
    const values: (string | number | null)[] = [
      t('assessments.colTotal'),
      part.totals.must,
      part.totals.self,
      part.totals.senior,
      part.totals.average,
      part.weight_sum,
      part.overall_pct,
      part.overall_level?.label ?? '',
    ];
    values.forEach((v, i) => {
      const cell = ws.getCell(r, startCol + i);
      cell.value = v;
      cell.font = { bold: true };
      if (i >= 1 && i <= 4) cell.numFmt = POINT_FMT;
      if (i === 5 || i === 6) cell.numFmt = PCT_FMT;
    });
  } else {
    const total = partMean(part);
    const totalBand = bandForMean(total);
    const values: (string | number | null)[] = [
      t('assessments.colTotal'),
      partScaleMax(part),
      null,
      null,
      total,
      totalBand?.label ?? '',
      totalBand?.description ?? '',
    ];
    values.forEach((v, i) => {
      const cell = ws.getCell(r, startCol + i);
      cell.value = v;
      cell.font = { bold: true };
      if (i === 1 || i === 4) cell.numFmt = MEAN_FMT;
    });
  }
  r += 1;

  return r;
}

/**
 * Тухайн лэйнд заасан зургийг (олдвол) кэпшнтэй нь байрлуулна. Зураг
 * олдоогүй бол юу ч бичихгүй, `topRow`-оо тэр чигт нь буцаана — тайлбарын
 * хүснэгт дээш нь татагдана.
 */
function placeChartInLane(
  ws: ExcelJSNs.Worksheet,
  wb: ExcelJSNs.Workbook,
  caption: string,
  img: (ChartImageInput & { dataUrl: string }) | undefined,
  startCol: number,
  maxWidthPx: number,
  topRow: number,
): number {
  if (!img) return topRow;
  let row = topRow;

  const captionCell = ws.getCell(row, startCol);
  captionCell.value = caption;
  captionCell.font = { italic: true };
  row += 1;

  const box = fitChartBox(img.width, img.height, maxWidthPx);
  const imageId = wb.addImage({ base64: img.dataUrl, extension: 'png' });
  // tl нь 0-ээс эхэлдэг (мөр 1 = row 0) — `addChartsSheet`-тэй ижил зарчим.
  ws.addImage(imageId, {
    tl: { col: startCol - 1, row },
    ext: { width: box.width, height: box.height },
  });
  row += Math.ceil(box.height / 20) + 2;

  return row;
}

/** Хувиар (0–100%) шатлалын тайлбарын хүснэгт. */
function writeScoreLegend(
  ws: ExcelJSNs.Worksheet,
  startCol: number,
  topRow: number,
  levels: AssessmentLevelBand[],
  t: TFn,
): number {
  let r = topRow;

  const titleCell = ws.getCell(r, startCol);
  titleCell.value = t('assessments.legendScoreTitle');
  titleCell.font = { bold: true };
  r += 1;

  const headers = [t('assessments.legendColLevel'), t('assessments.legendColRange')];
  headers.forEach((h, i) => {
    const cell = ws.getCell(r, startCol + 1 + i);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
  });
  r += 1;

  const sorted = [...levels].sort((a, b) => b.minPct - a.minPct);
  for (const band of sorted) {
    ws.getCell(r, startCol).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: argbFromHex(band.color) },
    };
    ws.getCell(r, startCol + 1).value = band.label;
    ws.getCell(r, startCol + 2).value = `${band.minPct.toFixed(0)}–${band.maxPct.toFixed(0)}%`;
    r += 1;
  }

  return r;
}

/** 1.0–5.0 дундажийн шатлалын тайлбарын хүснэгт (`BEHAVIOR_BANDS`). */
function writeBehaviorLegend(ws: ExcelJSNs.Worksheet, startCol: number, topRow: number, t: TFn): number {
  let r = topRow;

  const titleCell = ws.getCell(r, startCol);
  titleCell.value = t('assessments.legendBehaviorTitle');
  titleCell.font = { bold: true };
  r += 1;

  const headers = [
    t('assessments.legendColLevel'),
    t('assessments.legendColRange'),
    t('assessments.legendColPercent'),
    t('assessments.legendColDescription'),
  ];
  headers.forEach((h, i) => {
    const cell = ws.getCell(r, startCol + 1 + i);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
  });
  r += 1;

  const sorted = [...BEHAVIOR_BANDS].sort((a, b) => b.minMean - a.minMean);
  for (const band of sorted) {
    ws.getCell(r, startCol).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: argbFromHex(band.color) },
    };
    ws.getCell(r, startCol + 1).value = band.label;
    ws.getCell(r, startCol + 2).value = `${band.minMean.toFixed(1)}–${band.maxMean.toFixed(1)}`;
    ws.getCell(r, startCol + 3).value =
      `${(band.minMean * 20).toFixed(0)}–${(band.maxMean * 20).toFixed(0)}%`;
    const descCell = ws.getCell(r, startCol + 4);
    descCell.value = band.description;
    descCell.alignment = { wrapText: true };
    r += 1;
  }

  return r;
}

export interface DashboardSheetInput {
  sheetName: string;
  title: string;
  metaPairs: [string, string][];
  parts: ResultPart[];
  charts: ChartImageInput[];
  levels: AssessmentLevelBand[];
  t: TFn;
}

/**
 * Эхний хуудсыг (skills + behavior 2-баганат dashboard) бичнэ. Sheet-ийг
 * ХАМГИЙН ЭХЭНД нэмнэ гэдгийг дуудагч хариуцна (`wb.addWorksheet`-ийг busy
 * дараалалд нь эхэлж дуудна).
 *
 * @returns `usedCharts` — dashboard дээр аль хэдийн байрласан зургууд
 *          (дуудагч эдгээрийг «Графикууд» хуудсанд дахин оруулахгүй байхын
 *          тулд шүүнэ).
 */
function buildDashboardSheet(
  wb: ExcelJSNs.Workbook,
  opts: DashboardSheetInput,
): { usedCharts: ChartImageInput[] } {
  const { sheetName, title, metaPairs, parts, charts, levels, t } = opts;
  const ws = wb.addWorksheet(safeSheetName(sheetName, 'Dashboard'));

  DASH_SKILL_WIDTHS.forEach((w, i) => {
    ws.getColumn(DASH_LEFT_COL + i).width = w;
  });
  ws.getColumn(DASH_GUTTER_COL).width = DASH_GUTTER_WIDTH;
  DASH_BEHAVIOR_WIDTHS.forEach((w, i) => {
    ws.getColumn(DASH_RIGHT_COL + i).width = w;
  });

  let r = 1;
  const titleCell = ws.getCell(r, DASH_LEFT_COL);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };
  try {
    ws.mergeCells(r, DASH_LEFT_COL, r, DASH_TOTAL_COLS);
  } catch {
    // Нэгтгэл давхцвал экспортыг тасалдуулахгүй — гарчиг эхний нүдэнд үлдэнэ.
  }
  r += 2;

  for (const [label, value] of metaPairs) {
    const labelCell = ws.getCell(r, DASH_LEFT_COL);
    labelCell.value = label;
    labelCell.font = { bold: true };
    ws.getCell(r, DASH_LEFT_COL + 1).value = value;
    r += 1;
  }
  r += 1;

  const skillPart = parts.find((p) => p.weighted) ?? null;
  const behaviorPart = findBehaviorPart(parts);

  const tableTopRow = r;
  let skillBottom = tableTopRow;
  let behaviorBottom = tableTopRow;
  if (skillPart) skillBottom = writeDashboardBlock(ws, skillPart, t, tableTopRow, DASH_LEFT_COL, 'skill');
  if (behaviorPart) {
    behaviorBottom = writeDashboardBlock(ws, behaviorPart, t, tableTopRow, DASH_RIGHT_COL, 'behavior');
  }

  const usedCharts: ChartImageInput[] = [];
  const usableCharts = charts.filter(
    (c): c is ChartImageInput & { dataUrl: string } => !!c.dataUrl,
  );

  const skillImg = skillPart
    ? usableCharts.find((c) => c.partId === skillPart.part_id && c.kind !== 'radar')
    : undefined;
  // Ур чадварын лэйнд ЦЭГЭН ГРАФИКИЙН ДООР нь спайдер (radar) зургийг ч
  // байрлуулна (SkillDualCharts хоёуланг нь captureParts-аар цуглуулдаг) —
  // ⚠️ ХЭРЭВ ЭНЭ ЗУРАГ БАЙХГҮЙ БОЛ «Графикууд» хуудсанд үлдэнэ, dashboard-д
  // ГАРАХГҮЙ — тиймээс `usedCharts`-д зөвхөн ОЛДСОН үед л нэмнэ.
  const skillRadarImg = skillPart
    ? usableCharts.find((c) => c.partId === skillPart.part_id && c.kind === 'radar')
    : undefined;
  // Зан чанарын лэйнд ЮУНЫ ӨМНӨ radar зургийг хайна — зарим дуудагч талд
  // (жишээ нь `chart: 'scatter'` тохиргоотой зан чанарын part) radar огт
  // цуглуулагдаагүй байж болзошгүй тул зөвхөн тэр үед 'main'-руу буцна.
  const behaviorImg = behaviorPart
    ? (usableCharts.find((c) => c.partId === behaviorPart.part_id && c.kind === 'radar') ??
      usableCharts.find((c) => c.partId === behaviorPart.part_id && c.kind !== 'radar'))
    : undefined;

  if (skillImg) usedCharts.push(skillImg);
  if (skillRadarImg) usedCharts.push(skillRadarImg);
  if (behaviorImg) usedCharts.push(behaviorImg);

  const chartTopRow = Math.max(skillBottom, behaviorBottom) + 1;
  const skillScatterBottom = placeChartInLane(
    ws,
    wb,
    t('assessments.chartScatterCaption'),
    skillImg,
    DASH_LEFT_COL,
    DASH_LEFT_LANE_MAX_PX,
    chartTopRow,
  );
  // Спайдер зургийг цэгэн графикийн ДООР байрлуулна — өмнөх зураг байхгүй
  // бол (`skillImg` undefined) `placeChartInLane` `topRow`-оо тэр чигт нь
  // буцаадаг тул спайдер зөвхөн энэ тохиолдолд ч зөв байрандаа очно.
  const skillChartBottom = placeChartInLane(
    ws,
    wb,
    t('assessments.chartRadarCaption'),
    skillRadarImg,
    DASH_LEFT_COL,
    DASH_LEFT_LANE_MAX_PX,
    skillScatterBottom,
  );
  const behaviorChartBottom = placeChartInLane(
    ws,
    wb,
    t('assessments.chartRadarCaption'),
    behaviorImg,
    DASH_RIGHT_COL,
    DASH_RIGHT_LANE_MAX_PX,
    chartTopRow,
  );

  const legendRow = Math.max(skillChartBottom, behaviorChartBottom, chartTopRow) + 1;
  writeScoreLegend(ws, DASH_LEFT_COL, legendRow, levels, t);
  writeBehaviorLegend(ws, DASH_RIGHT_COL, legendRow, t);

  return { usedCharts };
}

// ---------------------------------------------------------------------------
// Нэг хүний workbook
// ---------------------------------------------------------------------------

export interface ParticipantXlsxInput {
  /** Өгөөгүй бол round + хүний нэрээс бүрдэнэ. */
  fileName?: string;
  round: { name: string; period: string };
  schema: AssessmentSchema;
  result: ParticipantResult;
  charts?: ChartImageInput[];
  t: TFn;
}

export async function exportParticipantXlsx(input: ParticipantXlsxInput): Promise<void> {
  const { round, schema, result, charts, t } = input;
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();

  /* 1. Dashboard (ур чадвар + зан чанар нэг дор) */
  const meta: [string, string][] = [
    [t('assessments.colName'), result.full_name],
    [t('assessments.colPosition'), result.position ?? ''],
    [
      t('assessments.colTeam'),
      result.team_code && result.team_name_mn
        ? `${result.team_code} — ${result.team_name_mn}`
        : (result.team_code ?? result.team_name_mn ?? ''),
    ],
    [t('assessments.colPeriod'), `${round.name} · ${round.period}`],
    [
      t('assessments.colEvaluator'),
      result.senior_evaluators
        .map((e) => e.full_name)
        .filter((n): n is string => !!n)
        .join(', '),
    ],
  ];
  const levels = schema.levels?.length ? schema.levels : DEFAULT_LEVELS;
  const { usedCharts } = buildDashboardSheet(wb, {
    sheetName: t('assessments.xlsxSheetReport'),
    title: t('assessments.xlsxSheetReport'),
    metaPairs: meta,
    parts: result.parts,
    charts: charts ?? [],
    levels,
    t,
  });

  /* 2. Хариултууд */
  {
    const ws = wb.addWorksheet(safeSheetName(t('assessments.xlsxSheetAnswers'), 'Answers'), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: t('assessments.colSection'), key: 'section', width: 28 },
      { header: t('assessments.colGroup'), key: 'group', width: 30 },
      { header: t('assessments.colQuestion'), key: 'question', width: 64 },
      { header: t('assessments.colSelfScore'), key: 'self', width: 16 },
      { header: t('assessments.colSeniorScore'), key: 'senior', width: 16 },
      { header: t('assessments.colAverageScore'), key: 'average', width: 16 },
    ];
    for (const row of buildAnswerRows(schema, result)) ws.addRow(row);
    ws.getColumn('question').alignment = { wrapText: true, vertical: 'top' };
    ws.getColumn('average').numFmt = POINT_FMT;
    styleHeader(ws);
  }

  /* 3. Графикууд — dashboard дээр аль хэдийн байрласан зургуудыг давхарлахгүй */
  addChartsSheet(wb, (charts ?? []).filter((c) => !usedCharts.includes(c)), t);

  const fileName =
    input.fileName ??
    `${sanitizeFileNamePart(result.full_name)}_${sanitizeFileNamePart(round.period || round.name)}.xlsx`;
  await downloadWorkbook(wb, fileName);
}

// ---------------------------------------------------------------------------
// Бүх багийн workbook
// ---------------------------------------------------------------------------

/** Багийн (эсвэл «бүгд»-ийн) дундажлагдсан хэсгүүд — харагдац талаас бэлдэнэ. */
export interface RoundXlsxGroup {
  label: string;
  memberCount: number;
  parts: ResultPart[];
}

export interface RoundXlsxInput {
  fileName?: string;
  round: { name: string; period: string };
  schema: AssessmentSchema;
  /** Тойм + Хариултууд хуудсанд орох оролцогчид (шүүлтүүрийн дараах). */
  results: ParticipantResult[];
  /** REPORT DIAGRAMM хуудасны бүлгүүд (бүгд + баг тус бүр). */
  groups: RoundXlsxGroup[];
  charts?: ChartImageInput[];
  t: TFn;
}

export async function exportRoundXlsx(input: RoundXlsxInput): Promise<void> {
  const { round, schema, results, groups, charts, t } = input;
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = brand().appName;
  wb.created = new Date();

  // Тойм хуудасны хэсгийн баганууд — эхний оролцогчийн weighted part-аас.
  const primaryPart = results[0]?.parts.find((p) => p.weighted) ?? results[0]?.parts[0] ?? null;
  const sectionColumns = primaryPart?.sections ?? [];

  /* 0. Хураангуй (dashboard) — бүх оролцогчийн («бүгд») бүлгээс, ХАМГИЙН ЭХЭНД */
  const levels = schema.levels?.length ? schema.levels : DEFAULT_LEVELS;
  const firstGroup = groups[0] ?? null;
  const dashMeta: [string, string][] = [
    [t('assessments.colPeriod'), `${round.name} · ${round.period}`],
  ];
  if (firstGroup) {
    dashMeta.push([firstGroup.label, t('assessments.memberCount', { count: firstGroup.memberCount })]);
  }
  const { usedCharts } = buildDashboardSheet(wb, {
    sheetName: t('assessments.xlsxSheetDashboard'),
    title: t('assessments.xlsxSheetDashboard'),
    metaPairs: dashMeta,
    parts: firstGroup?.parts ?? [],
    charts: charts ?? [],
    levels,
    t,
  });

  /* Тойм — нэг мөр = нэг оролцогч */
  {
    const ws = wb.addWorksheet(safeSheetName(t('assessments.xlsxSheetOverview'), 'Overview'), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: t('assessments.colName'), key: 'name', width: 24 },
      { header: t('assessments.colTeam'), key: 'team', width: 22 },
      { header: t('assessments.colPosition'), key: 'position', width: 22 },
      { header: t('assessments.colSelfSubmitted'), key: 'selfDone', width: 14 },
      { header: t('assessments.colSeniorSubmitted'), key: 'seniorDone', width: 14 },
      ...sectionColumns.map((s, i) => ({
        header: s.code || s.title,
        key: `s${i}`,
        width: 14,
      })),
      { header: t('assessments.colOverallPct'), key: 'overall', width: 16 },
      { header: t('assessments.colLevel'), key: 'level', width: 14 },
    ];

    for (const result of results) {
      const part = result.parts.find((p) => p.weighted) ?? result.parts[0] ?? null;
      const cells: Record<string, string | number | null> = {
        name: result.full_name,
        team:
          result.team_code && result.team_name_mn
            ? `${result.team_code} — ${result.team_name_mn}`
            : (result.team_code ?? result.team_name_mn ?? ''),
        position: result.position ?? '',
        selfDone: result.self_submitted ? t('assessments.yes') : t('assessments.no'),
        seniorDone: result.senior_submitted ? t('assessments.yes') : t('assessments.no'),
        overall: part?.overall_pct ?? null,
        level: part?.overall_level?.label ?? '',
      };
      sectionColumns.forEach((_s, i) => {
        cells[`s${i}`] = part?.sections[i]?.pct ?? null;
      });
      const row = ws.addRow(cells);
      sectionColumns.forEach((_s, i) => {
        row.getCell(`s${i}`).numFmt = PCT_FMT;
      });
      row.getCell('overall').numFmt = PCT_FMT;
    }
    styleHeader(ws);
  }

  /* REPORT DIAGRAMM — бүлэг тус бүрийн дундаж */
  {
    const ws = wb.addWorksheet(safeSheetName(t('assessments.xlsxSheetReport'), 'Report'));
    ws.columns = REPORT_COLUMNS(t).map((c) => ({ ...c, header: '' }));
    const periodRow = ws.addRow({
      section: t('assessments.colPeriod'),
      must: `${round.name} · ${round.period}`,
    });
    periodRow.getCell('section').font = { bold: true };
    ws.addRow({});

    for (const group of groups) {
      const head = ws.addRow({
        section: `${group.label} (${t('assessments.memberCount', { count: group.memberCount })})`,
      });
      head.font = { bold: true, size: 12 };
      for (const part of group.parts) writePartTable(ws, part, t);
    }
  }

  /* Хариултууд — нэг мөр = оролцогч × асуулт */
  {
    const ws = wb.addWorksheet(safeSheetName(t('assessments.xlsxSheetAnswers'), 'Answers'), {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: t('assessments.colName'), key: 'name', width: 24 },
      { header: t('assessments.colTeam'), key: 'team', width: 18 },
      { header: t('assessments.colSection'), key: 'section', width: 28 },
      { header: t('assessments.colGroup'), key: 'group', width: 30 },
      { header: t('assessments.colQuestion'), key: 'question', width: 64 },
      { header: t('assessments.colSelfScore'), key: 'self', width: 16 },
      { header: t('assessments.colSeniorScore'), key: 'senior', width: 16 },
      { header: t('assessments.colAverageScore'), key: 'average', width: 16 },
    ];
    for (const result of results) {
      for (const row of buildAnswerRows(schema, result)) {
        ws.addRow({ name: result.full_name, team: result.team_code ?? '', ...row });
      }
    }
    ws.getColumn('question').alignment = { wrapText: true, vertical: 'top' };
    ws.getColumn('average').numFmt = POINT_FMT;
    styleHeader(ws);
  }

  /* Графикууд — dashboard дээр аль хэдийн байрласан зургуудыг давхарлахгүй */
  addChartsSheet(wb, (charts ?? []).filter((c) => !usedCharts.includes(c)), t);

  const fileName =
    input.fileName ??
    `${sanitizeFileNamePart(round.name)}_${sanitizeFileNamePart(round.period)}.xlsx`;
  await downloadWorkbook(wb, fileName);
}
