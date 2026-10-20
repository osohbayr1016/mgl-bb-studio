/**
 * Үнийн саналын ХЭВЛЭЛТИЙН БАГАНА ТААРУУЛАГЧ.
 *
 * ── Ямар асуудлыг шийдэж байна вэ? ─────────────────────────────────────────
 * `SheetGrid`-ийн `<td>` нь `overflow: hidden` + `whitespace-nowrap` тул нүдэнд
 * багтаагүй ТООГ ЧИМЭЭГҮЙ ОГТОЛНО — алдааны мэдэгдэл ч, гурван цэг ч гарахгүй,
 * зүгээр л нэг орон дутуу хэвлэгдэнэ. 2026-08-17-нд бодит үнийн санал дээр
 * «НИЙТ ДҮН 1,304,953,528» нь 65.2px хэрэгтэй атлаа 63px нүдэнд орж, эцсийн
 * «8» алга болсон (хэмжсэн: headless Chromium, A4 хэвтээ, 12mm зах).
 *
 * Хуучин загвар нь баганы өргөнийг ЗАСВАРЛАГЧИЙН px өргөнөөс гаргаж, үсгийн
 * хэмжээг `1031 / Σөргөн` харьцаагаар сонгодог байсан — өөрөөр хэлбэл нүдэнд
 * ЮУ БИЧИГДСЭНИЙГ огт мэддэггүй. Тиймээс «багтсан эсэх» нь зөвхөн азаас
 * хамаардаг байв.
 *
 * ── Шинэ загвар ────────────────────────────────────────────────────────────
 * Багана бүрийн ХЭРЭГЦЭЭГ нүдний БОДИТ ТЕКСТЭЭС хэмжинэ (canvas `measureText`,
 * баримттай ЯГ нэг фонтоор), дараа нь:
 *
 *   1. Бүх «таслах боломжгүй» нүд багтах ХАМГИЙН ТОМ үсгийн хэмжээг олно.
 *   2. Тэр хэмжээнд багана бүрийн доод өргөнийг тогтооно.
 *   3. Үлдсэн зайг засварлагчийн зохиомжийн харьцаагаар тарааж, доод хэмжээнээс
 *      доош хэзээ ч буулгахгүйгээр 100%-д яг тааруулна (water-filling).
 *
 * Үр дүн: тасралт ЗАРЧМЫН ХУВЬД боломжгүй, бөгөөд үсэг нь өмнөх тогтмол 6.5pt
 * биш, багтах хамгийн том хэмжээгээр гарна (бодит баримт дээр ≈8.5pt).
 *
 * ⚠️ Энэ модуль нь БОСОО хэмжээст хариуцлага хүлээхгүй — мөр шилжүүлэлт
 * (`wrap`) нь текстээс хамаарсан шугаман бус функц тул түүнийг зөвхөн БОДИТ
 * зохиомжийг хэмжиж л мэдэж болно. Түүнийг `QuotePrintPage`-ийн тааруулах
 * гогцоо (`usePrintFit`) хариуцна.
 */
import { cellClass } from '../components/sheetStyles';
import { currencyCols } from './currency';
import { formatValue } from './format';
import { coordToRef, isFormulaError, type CellValue, type FormulaError } from './formula';
import { mergeAt, isMergeOrigin } from './sheetOps';
import type { CellRef, SheetDoc } from '../types/quotes';

/** Хэмжилтийн лавлагаа хэмжээ (px). Том авсан нь бутархай алдааг бууруулна. */
const REF_PX = 200;

/**
 * Хэмжилтийн фонт — `printStyles.QUOTE_PRINT_BASE_CSS`-ийн `.quote-print`-тэй
 * ЯГ ижил байх ЁСТОЙ. Зөрвөл хэмжилт худал болж тасралт эргэж ирнэ.
 */
const FONT_STACK = `'Arimo', 'Noto Sans', 'Arial', Helvetica, sans-serif`;

/**
 * Хэмжилтийн НӨӨЦ (1.5%). Chromium нь жижиг хэмжээнд глифийг бүхэл пикселд
 * нааж (hinting) заримдаа canvas-ийн шугаман тооцооноос 1% орчим өргөн зурдаг.
 * Нөөцгүй бол баримт бүрийн хамгийн урт дүн ирмэг дээрээ сууж, эрсдэлтэй.
 */
const SAFETY = 1.015;

export interface ColumnDemand {
  /**
   * ХАТУУ доод өргөн (em). Мөр шилжүүлж БОЛОХГҮЙ нүднүүдийн (тоо, голлосон
   * богино текст) хамгийн урт нь. Үүнээс нарийсвал текст ТАСАРНА.
   */
  hardEm: number;
  /**
   * ЗӨӨЛӨН доод өргөн (em) — мөр шилжүүлж болох нүдний ХАМГИЙН УРТ ҮГ. Хангах
   * нь зүйтэй ч заавал биш (шаардлагатай бол үг дундуур таслагдана).
   */
  softEm: number;
  /** Засварлагч дээрх зохиомжийн өргөн (px) — илүү зайг хуваарилах харьцаа. */
  designPx: number;
}

export interface FitOptions {
  /** Хэвлэгдэх талбайн өргөн (px). */
  availPx: number;
  /** Хүсэмжит (хамгийн том) үсгийн хэмжээ, pt. */
  maxFontPt: number;
  /** Уншигдахуйц доод хэмжээ, pt — эндээс доош зөвхөн ТАСРАЛТААС зайлсхийхийн тулд буулгана. */
  minFontPt: number;
  /** Туйлын доод хэмжээ, pt. Үүнээс доош буухгүй — оронд нь тасралтыг зөвшөөрнө. */
  floorFontPt: number;
  /** Нүдний хүрээ (px) — багана бүрд нэмэгдэнэ. */
  linePx: number;
  /** pt → px хөрвүүлэгч (@96dpi = 96/72). */
  ptToPx: number;
}

export interface FitResult {
  /** Багана тус бүрийн эцсийн өргөн (px). Нийлбэр нь `availPx`-тэй тэнцүү. */
  widthsPx: number[];
  /** Сонгогдсон үсгийн хэмжээ (pt). */
  fontPt: number;
  /**
   * `true` бол хатуу доод хэмжээ ч багтсангүй — өөрөөр хэлбэл ямар нэг тоо
   * тасарна. Дуудагч үүнийг БҮРТГЭХ ёстой (чимээгүй өнгөрөх нь хамгийн муу).
   */
  clipped: boolean;
}

/* ------------------------------------------------------------------ */
/*  1. Текстийн өргөн хэмжих                                            */
/* ------------------------------------------------------------------ */

let ctx: CanvasRenderingContext2D | null | undefined;

function measureCtx(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    const canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  return ctx;
}

/**
 * Текстийн өргөнийг `em`-ээр буцаана (үсгийн хэмжээнд ХАРЬЦАНГУЙ, тиймээс
 * дурын pt-д үржүүлээд шууд px болно).
 *
 * `tracking` нь `letter-spacing` (em) — хэвлэлтэд тоон нүд -0.01em авдаг.
 * `ctx.letterSpacing` дэмжигдээгүй хөтөч дээр зүгээр л хэрэгсэхгүй, тэр үед
 * хэмжилт БАГА ЗЭРЭГ ӨРГӨН гарна (аюулгүй тал руугаа алддаг).
 */
export function textWidthEm(text: string, weight: number, tracking = 0): number {
  if (!text) return 0;
  const c = measureCtx();
  if (!c) {
    // Canvas байхгүй орчин (SSR / хуучин хөтөч) — Arial-ийн дундаж өргөнөөр
    // ойролцоолно. Хэвлэх хуудас зөвхөн хөтөч дээр ажилладаг тул практикт
    // хүрэхгүй салаа, гэхдээ 0 буцаах нь тасралт төрүүлэх тул болохгүй.
    return text.length * 0.55;
  }
  c.font = `${weight} ${REF_PX}px ${FONT_STACK}`;
  try {
    (c as unknown as { letterSpacing: string }).letterSpacing = `${tracking * REF_PX}px`;
  } catch {
    /* дэмжээгүй — алгасна */
  }
  return c.measureText(text).width / REF_PX;
}

/** Мөр шилжүүлж болох нүдний хамгийн урт ҮГ. */
function longestWordEm(text: string, weight: number): number {
  let max = 0;
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const w = textWidthEm(word, weight);
    if (w > max) max = w;
  }
  return max;
}

/* --- УНШИГДАХУЙЦ доод өргөн (мөр шилждэг нүд) ------------------------------
 * ⚠️ 2026-08-17-Д ЗАССАН ГОЛ АЛДАА. Өмнө нь зөөлөн доод хэмжээ = «хамгийн урт
 * үг» байсан бөгөөд `fitColumns` нь үсгийн хэмжээгээ ЗӨВХӨН ХАТУУ (тоон)
 * хэрэгцээнээс сонгодог байв. Үр дүнд нь бодит баримт дээр 10 мөнгөн багана
 * бүх зайг эзэлж, «Барилгын нэр» · «Барилгын төвөгшил» · «Өндөр» баганууд
 * ердөө 20px үлдэж, кирилл бичвэр НЭГ МӨРД НЭГ ҮСГЭЭР босоо давхарлан
 * бичигдэж байв (хэрэглэгчийн хэвлэсэн баримт, 2026-08-17). Мөр нь тэр
 * хэмжээгээр өндөрсөж баримт A4-д багтахаа больсон.
 *
 * Одоо зөөлөн доод хэмжээ нь «энэ нүд ХЭДЭН МӨРД багтах ёстой вэ» гэдгээс
 * гарна: бүтэн өргөнийг зорилтот мөрийн тоонд хуваана. Ингэснээр урт нэр
 * 3-4 мөрд, толгой 4 мөрд эмхлэгдэнэ — үсэг дундуур биш.
 */
/** Өгөгдлийн нүдний зорилтот мөрийн тоо. */
const TARGET_LINES_BODY = 3;
/** Толгойн зорилтот мөрийн тоо — тэд `overflow-wrap: anywhere` тул илүү тэвчээртэй. */
const TARGET_LINES_HEADER = 4;
/**
 * Урт ҮГ баганыг хэр хүртэл тэлэх эрхтэй вэ (em).
 *
 * ⚠️ 2026-08-19: 5.5 → 6.1. Хуучин утга нь «төвөгшилтэй» (11 үсэг, Arimo
 * метрикээр 5.94 em) гэдгийг ЯГ таслах цэг дээр зогсож байсан — «Онцгой
 * төвөгшилтэй» сонголт цаасан дээр «төвөгшилт|эй» гэж хугарч, нарийссан
 * баганад үсэг тус бүрээр босоо давхарладаг байв (хэрэглэгчийн гомдол).
 *
 * Тэр багана нь ХАТУУ шалгүй (нүд нь `wrap: true`, толгой нь `bg: 'header'`
 * тул `cellShape.hard` хоёул худал) учир `fitColumns`-ийн хоёр дахь шахалтад
 * шал нь ТЭГ болж, мөнгөн баганууд түүнийг бараг тэг хүртэл идэх эрхтэй.
 * Зөөлөн шал нь энд ганц хамгаалалт — тиймээс хамгийн урт бодит үгийг бүтнээр
 * багтаах ёстой.
 *
 * Өртөг нь хэмжигдсэн: `ΣneedEm` +0.65% ⇒ үсгийн хэмжээ −0.5%. Өөрөөр хэлбэл
 * бараг үнэгүй. Үүнээс ДЭЭШ өсгөх нь тэр баганыг агуулгаасаа илүү тэлнэ.
 */
const BODY_WORD_CAP_EM = 6.1;
/**
 * Толгойн ҮГИЙН тааз (em).
 *
 * ⚠️ 2026-09-09: 3.8 → 5.2. Хуучин утга нь хэвлэлтийн товчлолын толь (одоо
 * УСТГАГДСАН) толгойн урт шошгуудыг ҮРГЭЛЖ богиносгодог байхад л зөв байв
 * («Барилгын давхар» → «Давхар», 3.53 em). Товчлол алга болмогц бүтэн шошго
 * цаасан дээр гарч, тэр даруй «Барилг|ын давхар» гэж ҮГ ДУНДУУР хугарав
 * (хэмжсэн: «Барилгын» = 5.01 em, тааз 3.8 em).
 *
 * 5.2 нь бодит толгойнуудын нэг үгийн уртыг БҮТНЭЭР барина (хэмжигдсэн, Arimo
 * 600): «Барилгын» 5.01 · «итгэлцүүр» 5.02 · «автоматик» 5.12 · «төвөгшил»
 * 4.83 · «Өндрийн» 4.46. Үүнээс УРТ үгс («хөдлөлтийн» 6.01, «боловсруулах»
 * 7.03) нь өргөн эсвэл нэгтгэсэн толгойд сууг тул тэдэнд тааз ХЭРЭГГҮЙ —
 * таазыг тэднээр тогтоовол нарийн баганууд хэрэгцээгүй өргөсөж, `fontPt`
 * бүх баримт дээр буурна.
 *
 * Өртөг нь ХЭМЖИГДСЭН (бодит үнийн санал 900, 18 харагдах багана, headless
 * Chrome): нүдний үсэг 11.4204px → 11.4142px буюу −0.05% (≈8.565pt → 8.560pt),
 * баримт 1 хуудас хэвээр. Өөрөөр хэлбэл бараг ҮНЭГҮЙ — учир нь тааз нь зөвхөн
 * НАРИЙН толгойн баганад (тэнд бие нь «3-25F» гэх мэт богино) хүчинтэй.
 */
const HEADER_WORD_CAP_EM = 5.2;
/** Ямар ч бичвэрт нүд үүнээс их өргөн ШААРДАХГҮЙ (em). */
const SOFT_CAP_EM = 8;

/**
 * Мөр шилжүүлж БОЛОХ нүдний УНШИГДАХУЙЦ доод өргөн (em).
 *
 * Хоёр шаардлагын ИХ нь:
 *   • хамгийн урт үг (таслагдахгүйн тулд) — дээд хязгаартай,
 *   • бүтэн бичвэрийг зорилтот мөрийн тоонд хуваасан өргөн.
 * Хоёул `SOFT_CAP_EM`-ээр хязгаарлагдана — нэг урт нүд баганыг идэхгүй.
 */
function readableWrapEm(text: string, weight: number, header: boolean): number {
  const full = textWidthEm(text, weight);
  const word = Math.min(longestWordEm(text, weight), header ? HEADER_WORD_CAP_EM : BODY_WORD_CAP_EM);
  const byLines = full / (header ? TARGET_LINES_HEADER : TARGET_LINES_BODY);
  return Math.min(SOFT_CAP_EM, Math.max(word, Math.min(full, byLines)));
}

/* ------------------------------------------------------------------ */
/*  2. Нүдний ангилал — хэвлэлтийн CSS-ийн ДҮРМҮҮДТЭЙ таарна            */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ Эдгээр тогтмолууд `printStyles.ts`-ийн ижил нэртэй дүрмүүдээс ГАРНА.
 * Тэндхийг өөрчилвөл ЭНДЭХИЙГ мөн адил — эс бөгөөс хэмжилт бодит зохиомжтой
 * зөрж, тасралт эргэж ирнэ.
 */
const PAD_X_EM = 5 / 12;
const NUM_PAD_X_EM = 0.24;
const NUM_TRACKING_EM = -0.01;
/** `td[class~="text-danger"]` — НИЙТ ДҮН ба ХӨНГӨЛӨЛТ үсгийн хэмжээ. */
const DANGER_FONT_EM = 1.02;
/** `font-semibold` = 600, толгой = 700, бусад = 400. */
const WEIGHT_BOLD = 600;
const WEIGHT_NORMAL = 400;

interface CellShape {
  /** Мөр шилжүүлэх боломжгүй юу (тийм бол багана нарийсахад ТАСАРНА). */
  hard: boolean;
  /** Толгойн нүд үү — мөр шилжүүлэлтэд илүү тэвчээртэй (`overflow-wrap: anywhere`). */
  header: boolean;
  /** Тухайн нүдний үсгийн хэмжээ, суурьт харьцангуй. */
  mult: number;
  weight: number;
  padXEm: number;
  trackingEm: number;
}

/**
 * `cellClass`-ийн гаралтаас нүдний хэвлэлтийн ЗАН ТӨЛӨВИЙГ уншина.
 *
 * Хэвлэлтийн CSS дараах нүднүүдэд мөр шилжүүлэхийг ЗӨВШӨӨРДӨГ (тиймээс тэд
 * хатуу доод хэмжээ ТАВЬДАГГҮЙ):
 *   • `text-left` + `whitespace-nowrap`  → `white-space: normal` болгодог,
 *   • толгойн нүд (`bg-muted/60`)         → `overflow-wrap: anywhere`,
 *   • бүлгийн голлосон толгой (`bg-muted/40` + `text-center`) → мөн адил,
 *   • `wrap: true` тавьсан нүд (`whitespace-normal`).
 * Үлдсэн бүх нүд — тоо, голлосон богино текст (`м²`, `3-25F`) — ХАТУУ.
 */
function cellShape(cls: string): CellShape {
  const num = cls.includes('tabular-nums');
  const danger = cls.includes('text-danger');
  const header = cls.includes('bg-muted/60');
  const groupCenter = cls.includes('bg-muted/40') && cls.includes('text-center');
  const wraps =
    !cls.includes('whitespace-nowrap') || cls.includes('text-left') || header || groupCenter;
  return {
    hard: !wraps,
    header: header || groupCenter,
    mult: danger ? DANGER_FONT_EM : 1,
    weight: cls.includes('font-semibold') ? WEIGHT_BOLD : WEIGHT_NORMAL,
    padXEm: num ? NUM_PAD_X_EM : PAD_X_EM,
    trackingEm: num ? NUM_TRACKING_EM : 0,
  };
}

/* ------------------------------------------------------------------ */
/*  3. Хуудасны хэрэгцээг хэмжих                                        */
/* ------------------------------------------------------------------ */

/**
 * Багана тус бүрийн хэрэгцээг хуудасны БОДИТ АГУУЛГААС гаргана.
 *
 * ⚠️ Зөвхөн НЭГ баганад сууж буй нүд тооцогдоно. Нэгтгэсэн нүд (гарчиг,
 * ДҮН-гийн шошго) нь хэд хэдэн баганад тархдаг тул аль нэгэнд нь доод хэмжээ
 * тулгах нь буруу — тэдгээр нь ямар ч байсан мөр шилжүүлж багтана.
 *
 * @param display Тооцоологдсон утгууд (`useQuoteWorkbook`-ийн `values`).
 *                Байхгүй бол нүдний түүхий утгыг ашиглана.
 * @param transform Нүдэнд ЗУРАГДАХ текстийг хэмжихийн ӨМНӨ хувиргана.
 *                ⚠️ `SheetGrid`-т дамжуулсан `printText`-ТЭЙ ЯГ ИЖИЛ функц
 *                байх ЁСТОЙ — зөрвөл хэмжсэн өргөн ба зурагдсан текст зөрж,
 *                тасралт эргэж ирнэ. Хэвлэх хуудас хоёуланг нь ОГТ өгдөггүй
 *                (бүтэн текст зурагдана), тул энэ нь өнөөдөр хэрэглээгүй
 *                уян хатан цэг.
 */
export function measureSheetDemand(
  sheet: SheetDoc,
  display: Map<CellRef, CellValue | FormulaError>,
  visibleCols: number[],
  defaultColWidth: number,
  transform: (text: string) => string = (t) => t,
): ColumnDemand[] {
  const byCol = new Map<number, ColumnDemand>();
  for (const c of visibleCols) {
    const w = sheet.colWidths?.[c];
    byCol.set(c, {
      hardEm: 0,
      softEm: 0,
      designPx: Number.isFinite(w) && (w as number) > 0 ? (w as number) : defaultColWidth,
    });
  }
  /** Багана бүрийн ХАРАГДАХ дараалал доторх байрлал — нэгтгэлийг тараахад. */
  const slotOf = new Map<number, number>();
  visibleCols.forEach((c, i) => slotOf.set(c, i));
  /**
   * ⚠️ «₮ » угтварыг ЗААВАЛ оруулна (`lib/currency.ts`). `SheetGrid` нь
   * `formatValue(value, fmt, money.has(c))` гэж зурдаг — угтваргүй хэмжвэл
   * мөнгөн багана бүр ≈0.83em дутуу тооцогдож, баримт бүхэлдээ тасарна
   * (хэмжсэн 2026-08-17: 46 нүд тасарсан).
   */
  const money = currencyCols(sheet);

  /** Нэгтгэсэн (олон багана эзэлсэн) нүднүүд — дараа нь тарааж тооцно. */
  const spans: { c: number; cs: number; em: number; hard: boolean }[] = [];

  for (let r = 0; r < sheet.rows; r += 1) {
    for (const c of visibleCols) {
      const merge = mergeAt(sheet, r, c);
      if (merge && !isMergeOrigin(merge, r, c)) continue;

      const ref = coordToRef(r, c);
      const cell = sheet.cells[ref];
      const value = display.get(ref);
      const raw = isFormulaError(value)
        ? value.code
        : formatValue(value, cell?.fmt, money.has(c)) || String(cell?.v ?? '');
      // ⚠️ ЗУРАГДАХ текстийг хэмжинэ, түүхийг БИШ (`SheetGrid.printText`-тэй хос).
      const text = transform(raw);
      if (!text) continue;

      const shape = cellShape(cellClass(cell?.s, cell?.fmt));
      const em = shape.hard
        ? shape.mult * (textWidthEm(text, shape.weight, shape.trackingEm) + 2 * shape.padXEm)
        : shape.mult * (readableWrapEm(text, shape.weight, shape.header) + 2 * shape.padXEm);

      const cs = merge ? merge.cs : 1;
      if (cs > 1) {
        spans.push({ c, cs, em, hard: shape.hard });
        continue;
      }
      const dem = byCol.get(c);
      if (!dem) continue;
      if (shape.hard) {
        if (em > dem.hardEm) dem.hardEm = em;
      } else if (em > dem.softEm) dem.softEm = em;
    }
  }

  /* ── Нэгтгэсэн нүдийг эзэмшдэг баганууд дээрээ ТАРААНА ──────────────────
   * «Ажлын зургийн үнэ» (colspan 2) мэт шошго нь ганц ч баганад доод хэмжээ
   * тавихгүй байсан тул 2026-08-17-нд 116px хэрэгтэй атлаа 100px зайд орж
   * тасарч байв. Дутууг нь ЗӨВХӨН тухайн нэгтгэлийн эзэмшдэг баганууд дээр,
   * зохиомжийн өргөний харьцаагаар тарааж нэмнэ. */
  for (const span of spans) {
    const slots: number[] = [];
    for (let i = span.c; i < span.c + span.cs; i += 1) {
      const slot = slotOf.get(i);
      if (slot !== undefined) slots.push(i);
    }
    if (slots.length === 0) continue;
    const cur = slots.reduce((a, i) => {
      const d = byCol.get(i);
      return a + (d ? Math.max(d.hardEm, d.softEm) : 0);
    }, 0);
    const deficit = span.em - cur;
    if (deficit <= 0) continue;
    const totalDesign = slots.reduce((a, i) => a + (byCol.get(i)?.designPx ?? 0), 0) || slots.length;
    for (const i of slots) {
      const d = byCol.get(i);
      if (!d) continue;
      const share = (deficit * (d.designPx || 1)) / totalDesign;
      if (span.hard) d.hardEm += share;
      else d.softEm = Math.max(d.softEm, d.hardEm) + share;
    }
  }

  return visibleCols.map((c) => {
    const d = byCol.get(c) as ColumnDemand;
    return {
      designPx: d.designPx,
      hardEm: d.hardEm * SAFETY,
      softEm: Math.max(d.hardEm, d.softEm) * SAFETY,
    };
  });
}

/* ------------------------------------------------------------------ */
/*  4. Шийдэгч                                                          */
/* ------------------------------------------------------------------ */

/**
 * Багануудыг хэвлэгдэх талбайд ЯГ багтаана.
 *
 * Алгоритм (water-filling):
 *   1. Бүх ХАТУУ хэрэгцээ багтах хамгийн том үсгийн хэмжээг сонгоно.
 *   2. Багана бүрд зохиомжийн харьцаагаар зорилтот өргөн өгнө, гэхдээ доод
 *      хэмжээнээсээ (хатуу + боломжтой бол зөөлөн) хэзээ ч бага биш.
 *   3. Нийлбэр хэтэрсэн бол ЗӨВХӨН нөөцтэй баганаас (доод хэмжээнээсээ дээш
 *      байгаа хэсгээс) харьцаагаар хасна — доод хэмжээ хэзээ ч зөрчигдөхгүй.
 *
 * Алхам 1 нь өргөн ба үсгийн хэмжээ ХОЁУЛАА `fontPt`-д ШУГАМААР хамаардагт
 * тулгуурладаг тул нэг л удаагийн бодолтоор яг таарна (давталт хэрэггүй).
 */
export function fitColumns(cols: ColumnDemand[], opts: FitOptions): FitResult {
  const n = cols.length;
  if (n === 0) return { widthsPx: [], fontPt: opts.maxFontPt, clipped: false };

  const borderPx = opts.linePx * n;
  const usable = Math.max(1, opts.availPx - borderPx);

  /* ── ҮСГИЙН ХЭМЖЭЭГ СОНГОХ ──────────────────────────────────────────────
   * ⚠️ 2026-08-17-Д ЗАССАН ГОЛ АЛДАА — БУЦААЖ БҮҮ ЭВД.
   * Өмнө нь хэмжээг ЗӨВХӨН `sumHardEm`-ээс сонгодог байв. Тэр нь «тоо
   * тасрахгүй» гэдгийг л батална — гэвч бичвэрийн баганад ЮУ ҮЛДЭХ тухай
   * ямар ч шалгуургүй. Бодит хяналтын төсөв дээр 10 мөнгөн багана бүх зайг
   * идэж, «Барилгын нэр» 20px үлдэж, кирилл бичвэр НЭГ ҮСГЭЭР босоо
   * давхарлаж, мөр 10 дахин өндөрсөж баримт A4-д багтахаа больсон.
   *
   * Одоо: хэмжээ нь ХАТУУ + УНШИГДАХУЙЦ ЗӨӨЛӨН хоёрын НИЙЛБЭРЭЭС гарна.
   *   • `fontForNeed` — бүх багана тав тухтай (тоо бүтэн, бичвэр 3-4 мөрд).
   *   • Тэр нь `minFontPt`-ээс доош унавал уншигдацаа хамгаалж `minFontPt`
   *     хүртэл өргөж, оронд нь ЗӨӨЛӨН баганыг шахна (тэд мөр шилжүүлж
   *     багтана — бичвэр АЛДАГДАХГҮЙ, зөвхөн нягтарна).
   *   • Гэхдээ ХЭЗЭЭ Ч `fontForHard`-ээс дээш гарахгүй — тэрнээс дээш бол
   *     тоо тасарна, энэ нь хамгийн муу үр дагавар.
   */
  const sumHardEm = cols.reduce((a, d) => a + d.hardEm, 0);
  const sumNeedEm = cols.reduce((a, d) => a + Math.max(d.hardEm, d.softEm), 0);
  const fontForHard = sumHardEm > 0 ? usable / (sumHardEm * opts.ptToPx) : opts.maxFontPt;
  const fontForNeed = sumNeedEm > 0 ? usable / (sumNeedEm * opts.ptToPx) : opts.maxFontPt;

  let fontPt = Math.min(
    opts.maxFontPt,
    fontForHard,
    Math.max(fontForNeed, Math.min(opts.minFontPt, fontForHard)),
  );
  let clipped = false;
  if (fontPt < opts.floorFontPt) {
    // Уншигдахаа болих хэмжээнд ч багтахгүй — доод шалгуурыг барьж, тасралтыг
    // ЗӨВШӨӨРНӨ. Энэ нь 26 багана × 12 оронтой дүн гэх мэт туйлын тохиолдол.
    fontPt = opts.floorFontPt;
    clipped = true;
  }
  fontPt = Number(fontPt.toFixed(3));

  const px = (em: number) => em * fontPt * opts.ptToPx;
  /** ХАТУУ шал — эндээс доош буувал текст ТАСАРНА. */
  const hardPx = cols.map((d) => px(d.hardEm));
  /** ЗӨӨЛӨН шал — эндээс доош буувал зөвхөн үг дундуур таслагдана. */
  const softPx = cols.map((d, i) => Math.max(hardPx[i] as number, px(d.softEm)));

  const sumDesign = cols.reduce((a, d) => a + d.designPx, 0) || 1;
  let widths = cols.map((d, i) =>
    Math.max((d.designPx / sumDesign) * usable, softPx[i] as number),
  );

  /**
   * Нийлбэрийг `usable`-д тааруулна: өгөгдсөн ШАЛнаас дээш байгаа нөөцөөс
   * харьцаагаар хасна. Шал хүрэхэд зогсоод үлдсэнийг буцаана.
   */
  const shrinkTo = (floors: number[]): number => {
    let total = widths.reduce((a, b) => a + b, 0);
    for (let pass = 0; pass < 8 && total - usable > 0.01; pass += 1) {
      const slack = widths.map((w, i) => Math.max(0, w - (floors[i] as number)));
      const pool = slack.reduce((a, b) => a + b, 0);
      if (pool <= 0.01) break;
      const take = Math.min(total - usable, pool);
      widths = widths.map((w, i) => w - (take * (slack[i] as number)) / pool);
      total = widths.reduce((a, b) => a + b, 0);
    }
    return total;
  };

  // 1) Эхлээд ЗӨӨЛӨН шал хүртэл — уншигдац хамгийн бага хохирно.
  let total = shrinkTo(softPx);
  // 2) Хүрэлцээгүй бол ХАТУУ шал хүртэл — үг таслагдана, тоо тасрахгүй.
  if (total - usable > 0.01) total = shrinkTo(hardPx);
  if (total - usable > 0.01) {
    // 3) Хатуу шал ч багтсангүй — харьцаагаар шахна (текст ТАСАРНА).
    const k = usable / total;
    widths = widths.map((w) => w * k);
    clipped = true;
    total = usable;
  } else if (total < usable - 0.01) {
    // НЭМЭХ — зохиомжийн харьцаагаар илүүг тарааж 100%-д хүргэнэ.
    const extra = usable - total;
    widths = widths.map((w, i) => w + (extra * (cols[i] as ColumnDemand).designPx) / sumDesign);
  }

  return {
    widthsPx: widths.map((w) => w + opts.linePx),
    fontPt,
    clipped,
  };
}
