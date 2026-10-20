import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';

import { restoreCaret } from '@/features/performance-reports/components/EditableText';

/* =============================================================
 * A4Paginator — дэлгэц дээрх ЖИНХЭНЭ A4 хуудаслалт (WYSIWYG).
 * -------------------------------------------------------------
 * АСУУДАЛ:  Урьдчилан харах хэсэг нь `.perf-page { height: 297mm;
 * overflow: hidden }` ашигладаг байсан тул нэг A4-д багтаагүй
 * агуулга ЗҮГЭЭР Л АЛГА БОЛДОГ, харин Chromium хэвлэхдээ огт өөр
 * газар тасалдаг.  Иймд дэлгэц ≠ PDF.
 *
 * ШИЙДЭЛ (курсор алдагдахаас сэргийлсэн дизайн):
 *
 *   Агуулгыг хуудас бүрд ХУВААЖ дахин render хийхгүй.  Агуулга нь
 *   contentEditable (EditableText) тул элемент өөр эцэг рүү шилжвэл
 *   unmount болж бичиж байсан курсор алга болно.  Оронд нь:
 *
 *   1) Агуулгыг НЭГ тасралтгүй урсгалаар (`.a4-flow`) render хийнэ.
 *   2) Ард нь `position:absolute` цагаан A4 хуудсуудыг (`.a4-sheet`)
 *      ЗУРНА — зөвхөн харагдац, DOM-д ямар ч агуулга агуулахгүй.
 *   3) Урсгал доторх "хуваагдах ёсгүй" нэгжүүдийг хэмжиж, хуудасны
 *      заагт унасныг нь `margin-top`-оор дараагийн хуудас руу ТҮЛХНЭ.
 *   4) Цаасны ГАДНА үлдэж болзошгүй бүх зурвасыг (хуудас хоорондын
 *      цоорхой, захын зай) ДЭЭРЭЭС нь бүрхэх маск зурна.
 *
 *   Ингэснээр DOM нэг л удаа mount болж, элемент хэзээ ч өөр эцэг рүү
 *   шилждэггүй → курсор амьд үлдэнэ.
 *
 * ---------------------------------------------------------------
 * НЭГЖ ИЛРҮҮЛЭЛТ (2026-08-25 засвар).
 *
 * УРЬД НЬ зөвхөн `flow.querySelectorAll('[data-a4-item]')`-ыг хайдаг
 * байв.  Практикт тэр атрибутыг ЗӨВХӨН `ProjectIntroPage` тавьдаг тул
 * `TeamSectionPage`, `AllTeamChartsPage`, `FinalSignoffPage`,
 * `ExecutionSummaryPage`, `TableOfContents`, `ProgressSummarySection`
 * зэрэг БҮХ БУСАД блок пагинаторт «үл үзэгдэх» байсан: хэмжих зүйл
 * олдохгүй тул юу ч түлхэгдэхгүй, агуулга цаас дуусахад ч зогсохгүй
 * цаашаа урсаж, хуудас хоорондын саарал зайн дээгүүр бичигдэнэ.
 *
 * Одоо `collect` нь DOM-ыг РЕКУРСИВ гүйж, нэгжийг ӨӨРӨӨ олно
 * (яг доорх дарааллаар):
 *
 *   0. `[data-a4-skip]` эсвэл `display:none` → бүрэн алгасна.
 *   1. `.perf-page | .perf-cover | .perf-team-page` = ХЭСЭГ.  Хэсэг бүр
 *      ШИНЭ ХУУДАСНААС эхэлнэ (атрибут байхгүй ч гэсэн), дараа нь
 *      дотогшоо рекурс хийнэ.  Зөвхөн ЭХНИЙ хэсэг үл хамаарна.
 *   2. `margin`-аар түлхэх БОЛОМЖГҮЙ элемент (position:absolute/fixed/
 *      sticky, float, inline, table-row/-cell гэх мэт) → алгасна.
 *   3. `[data-a4-item]` гар тэмдэглэгээ → НЭГЖ, дотогш ОРОХГҮЙ.
 *  3b. ДОТОР нь `[data-a4-item]` байвал → рекурс (зохиогчийн нарийвчлал
 *      ялна; багийн тайлангийн бичиг баримтууд бүгд тэмдэглэгээтэй).
 *   4. `<table>` → нэг хуудсанд БАГТВАЛ бүтэн НЭГЖ; УРТ бол хүснэгтийг
 *      хуудасны эхэнд түлхээд МӨР бүрийг нь тусад нь нэгж болгоно
 *      (доорх «B хязгаар»-ыг үз).
 *   5. Өндөр нь нэг хуудасны агуулгын өндөрт багтвал → НЭГЖ.
 *   6. Хүүхэдтэй бөгөөд багтахгүй бол → хүүхдүүд рүү рекурс.
 *   7. Хүүхэдгүй (leaf) бөгөөд хэт өндөр → НЭГЖ (түлхэх нь утгагүй;
 *      маск нь «хэвлэгч тайрсан» мэт харагдуулна).
 *
 * ХЯЗГААР (зориудынх):
 *   • Нэгж нь ЭНГИЙН БЛОК УРСГАЛД байх ёстой — эс бөгөөс margin-top
 *     түлхэлт ард нь байгаа агуулгыг шилжүүлэхгүй (2-р дүрэм).
 *   • Нэг A4-д багтахгүй том элементийг түлхэхгүй — тасрахыг зөвшөөрнө.
 *   • B хязгаар: `<tr>` элементийг margin-аар ТҮЛХЭХ БОЛОМЖГҮЙ (CSS:
 *     `display: table-row` дээр margin үйлчлэхгүй).  Иймд:
 *       – хүснэгт БҮТНЭЭРЭЭ нэг хуудсанд багтвал ХҮСНЭГТИЙГ түлхнэ;
 *       – хүснэгт нэг хуудаснаас урт бол ХҮСНЭГТИЙГ хуудасны эхэнд
 *         түлхээд, МӨР бүрийг нь тусдаа нэгж болгож, түлхэлтийг тухайн
 *         мөрийн НҮДНҮҮДИЙН `padding-top`-оор хийнэ (`collectRows`).
 *         Нүд сунгагдсанаас үүсэх хоосон зай нь цаасны захын зай +
 *         хуудас хоорондын цоорхойд унах бөгөөд тэр бүсийг МАСК бүрхэнэ.
 *     ⚠️ Урьд нь мөрүүд огт хэмжигддэггүй байсан тул заагт таарсан ~10
 *     мөр маскийн доор бүрмөсөн АЛГА БОЛДОГ байв (`team-stats-doc__table`
 *     нь олон зуун мөртэй).  Одоо мөр бүр дараагийн хуудасны эхэнд бүтэн
 *     очно — энэ нь `styles.ts`-ийн `@media print` дэх
 *     `.team-stats-doc__table tr { break-inside: avoid }`-той ЯГ ижил
 *     үр дүн тул дэлгэц ↔ PDF зөрүү арилна.
 *     ⚠️ Үлдсэн жижиг зөрүү: дэлгэц дээр `thead` хуудас бүрд ДАВТАГДАХГҮЙ
 *     (урсгал нэг л удаа render хийгддэг), харин PDF-д давтагдана.
 * ============================================================= */

/* ---------------- A4 геометр (мм) ----------------
 * ЖИШИГ .docx-ийн `w:sectPr`-ээс гаргасан БОДИТ хэмжилт (twips → mm):
 *   pgSz  w=11906 h=16838      → 210.01 × 297.00 mm (A4 portrait)
 *   pgMar top=947 right=1080 bottom=1354 left=1080
 *         → дээд 16.70 · баруун 19.05 · доод 23.88 · зүүн 19.05 mm
 *   агуулгын хайрцаг = 171.91 × 256.42 mm
 *
 * ⚠️ ЭНЭ бол дотоод зайн ЦОРЫН ГАНЦ эх сурвалж.  `.a4-flow`-ийн CSS
 * padding болон доорх хэмжилтийн алгоритмын PAD_T/PAD_B хоёул ҮҮНЭЭС
 * гарна — тэдгээр нь зөрвөл хуудас буруу газраа тасарна.
 * px рүү hardcode хөрвүүлэлт хийхгүй — DOM-оос хэмжинэ. */
export const PAGE_PAD = { top: 16.7, right: 19.05, bottom: 23.88, left: 19.05 } as const;

const PAGE_H_MM = 297;
const PAD_T_MM = PAGE_PAD.top;
const PAD_B_MM = PAGE_PAD.bottom;
/** Нэг хуудасны агуулгын өндөр (мм): 297 − 16.7 − 23.88 = 256.42 */
export const CONTENT_H_MM = PAGE_H_MM - PAD_T_MM - PAD_B_MM;

/** Дэлгэцэн дээрх хуудас хоорондын зай (CSS px).  `.a4-sheet`-ийн
 *  `margin-bottom` болон `.a4-mask--gap`-ийн өндөртэй ЗААВАЛ тэнцүү. */
const SHEET_GAP_PX = 14;

/** Хөвөгч таслалын алдааны хүлцэл (px). */
const EPS = 0.5;

/** Албадсан хуудасны заагийн «аль хэдийн дээд талд байна» хүлцэл (CSS px,
 *  ~1mm).  Дараалсан хоёр тэмдэглэгээ (жишээ нь `PerformanceReportPreview`
 *  дэх 1px `PageBreak` + түүний ард ирэх `.perf-page`) нэг нэгнийгээ
 *  ХООСОН хуудас руу түлхэхээс сэргийлнэ. */
const BREAK_SLACK = 4;

/** Үүнээс нам элементийг нэгж болгохгүй (CSS px).  Бэхгүй тусгаарлагч
 *  (1px `PageBreak`) хуудасны эхэнд суусны улмаас араас нь ирэх бодит
 *  агуулга дахин бүтэн хуудас түлхэгдэх алдааг таслана. */
const MIN_ITEM_H = 2;

/** Бичилт «зогссон» гэж үзэх чимээгүй хугацаа (мс).  Энэ хугацаанд
 *  хуудаслалтыг ОГТ дахин тооцохгүй — 1651 нэгжийн layout уншилт нь
 *  товчлуур тутамд кадр алгасуулдаг (E2E хэмжилтээр p95 59мс).  Бичилт
 *  зогсмогц нэг л удаа хэмжинэ.  Хэрэглэгч бичиж байхдаа хуудасны заагийг
 *  хардаггүй — бичиж дуусаад л хардаг тул харагдацад нөлөөгүй. */
const TYPING_IDLE_MS = 220;

/** Шинэ хуудаснаас эхэлдэг «хэсэг»-үүд. */
const SECTION_SEL = '.perf-page, .perf-cover, .perf-team-page';

/** `margin-top` нь урсгалыг доош түлхэж чаддаг display-үүд. */
const PUSHABLE_DISPLAY = new Set(['block', 'flow-root', 'flex', 'grid', 'table', 'list-item']);

function isPushable(cs: CSSStyleDeclaration): boolean {
  if (!PUSHABLE_DISPLAY.has(cs.display)) return false;
  const pos = cs.position;
  if (pos === 'absolute' || pos === 'fixed' || pos === 'sticky') return false;
  return cs.float === 'none';
}

/** Элемент цаасны захын зайг ӨӨРӨӨ будаж байна уу (жишээ нь navy нүүр
 *  хуудас `.perf-cover`, энэ нь сөрөг margin-аар цаасны дөрвөн зах хүртэл
 *  сунадаг).  Ийм хуудсан дээр цагаан «захын маск» зурвал дизайныг
 *  хайчилна — тиймээс тэр хуудасны маскийг унтраана. */
function paintsBackground(cs: CSSStyleDeclaration): boolean {
  if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
  const bg = cs.backgroundColor;
  if (!bg || bg === 'transparent') return false;
  const m = /^rgba?\(([^)]+)\)$/.exec(bg);
  if (!m) return true;
  const parts = m[1].split(',');
  if (parts.length < 4) return true;
  return (Number.parseFloat(parts[3] ?? '1') || 0) > 0.5;
}

/** Дэд-пиксел нарийвчлалтай өндөр.  `offsetHeight` бүхэл тоо руу
 *  бөөрөнхийлдөг тул эхлээд rect-ийг үзнэ. */
function rectHeight(el: HTMLElement): number {
  const h = el.getBoundingClientRect().height;
  return h > 0 ? h : el.offsetHeight;
}

/** CSS-д бичихэд тохиромжтой мм утга (хөвөгч таслалын шуугианыг арилгана). */
function mmCss(v: number): string {
  return `${Number(v.toFixed(4))}mm`;
}

/** Хуудасны АЛХАМ CSS илэрхийлэл: цаас + дэлгэцийн цоорхой.
 *  Маскийг px-ээр биш `calc()`-аар байрлуулснаар browser zoom / dpi-аас
 *  бүрэн хамааралгүй болж, JS дэх pxPerMm-тэй хэзээ ч зөрөхгүй. */
const UNIT_CSS = `(${PAGE_H_MM}mm + ${SHEET_GAP_PX}px)`;

/** p дугаар хуудасны ЦААСНЫ дээд ирмэг. */
function sheetTopCss(p: number): string {
  return `calc(${p} * ${UNIT_CSS})`;
}

/** Нэг хэмжигдсэн нэгж. */
interface Measured {
  el: HTMLElement;
  /** Урсгалын хүрээ-хайрцгийн дээд ирмэгээс хойших БАЙГАЛИЙН зай. */
  top: number;
  /** Будагдсан хайрцгийн өндөр. */
  h: number;
  /** Урсгалд ЭЗЛЭХ өндөр (сөрөг margin-ыг хассан).  `.perf-cover` нь
   *  297mm өндөртэй ч −16.7/−23.88mm margin-тай тул урсгалд яг нэг
   *  хуудасны агуулгын өндөр (256.42mm) эзэлдэг. */
  fit: number;
  /** Элементийн ӨӨРИЙН CSS margin-top. */
  natMt: number;
  /** Урд байгаа урсгал дахь ах дүүгийн CSS margin-bottom (px).  Ах дүү
   *  байхгүй бол 0.  «Margin залгирал»-ыг нөхөхөд хэрэглэнэ — доорх
   *  `collapsedBase()`-ыг үз. */
  prevMb: number;
  /** Урд ах дүүгийн ХҮРЭЭ-хайрцгийн ёроолоос энэ элементийн хүрээ-хайрцгийн
   *  дээд ирмэг хүртэлх ХЭМЖСЭН зай (px).  `null` = урд ах дүү алга.
   *  Залгирал БОЛСОН эсэхийг үүгээр таамаглалгүйгээр тогтооно. */
  prevGap: number | null;
  forceBreak: boolean;
  bleed: boolean;
  /** ХҮСНЭГТИЙН МӨРИЙН горим.  `display: table-row` дээр margin
   *  үйлчлэхгүй тул түлхэлтийг мөрийн НҮДНҮҮДИЙН `padding-top`-оор
   *  хийнэ (доорх «B хязгаар»-ыг үз).  Хоосон бол энгийн margin горим. */
  cells?: HTMLElement[];
  /** Мөрийн нүдний БАЙГАЛИЙН `padding-top` (px). */
  natPt?: number;
}

interface CollectState {
  sections: number;
}

/* ---------------------------------------------------------
 * Рекурсив нэгж илрүүлэлт.  ЗӨВХӨН УНШИНА — энд ямар ч style
 * бичихгүй (layout thrashing-ээс сэргийлнэ).
 * ------------------------------------------------------- */
function collect(
  container: Element,
  flowTop: number,
  scale: number,
  contentH: number,
  out: Measured[],
  state: CollectState,
): void {
  const kids = container.children;
  /* Эцгийн display — flex/grid контейнерт margin ОГТ ЗАЛГИРДАГГҮЙ тул
   * доорх нөхөлтийг тэнд хэрэглэж БОЛОХГҮЙ (хэт их түлхэнэ). */
  const parentDisplay = window.getComputedStyle(container).display;
  const parentCollapses = !parentDisplay.includes('flex') && !parentDisplay.includes('grid');
  /* Урд байгаа УРСГАЛ дахь ах дүүгийн хүрээ-хайрцгийн ёроол ба түүний
   * margin-bottom.  «Margin залгирал»-ыг нөхөхөд л хэрэгтэй (доорх
   * `collapsedBase()`).  `display:none` / абсолют элемент энд ОРОХГҮЙ —
   * тэдгээр нь урсгалд байхгүй тул залгиралд ч оролцохгүй. */
  let prevBottom: number | null = null;
  let prevMb = 0;
  for (let i = 0; i < kids.length; i += 1) {
    const el = kids[i];
    // SVG гэх мэт HTML бус элемент — margin-аар түлхэх найдваргүй тул
    // эцэг нь нэгж болох ёстой.
    if (!(el instanceof HTMLElement)) continue;
    if (el.hasAttribute('data-a4-skip')) continue;

    const cs = window.getComputedStyle(el);
    if (cs.display === 'none') continue;

    const rect = el.getBoundingClientRect();
    const natMt = Number.parseFloat(cs.marginTop) || 0;
    const natMb = Number.parseFloat(cs.marginBottom) || 0;
    const h = rect.height / scale;
    const fit = h + Math.min(0, natMt) + Math.min(0, natMb);
    const top = (rect.top - flowTop) / scale;
    const pushable = isPushable(cs);
    const bleed = paintsBackground(cs);

    /* Урд ах дүүтэйгээ хэр зайтай сууж байгааг ЭНД барина — доор олон
     * `continue` байгаа тул давталтын төгсгөлд шинэчилж болохгүй.
     * `prevGap`-ыг ӨМНӨХ утгуудаас гаргаад, дараа нь энэ элементийн
     * утгуудаар шууд солино. */
    const prevGap = prevBottom === null || !parentCollapses ? null : top - prevBottom;
    const prevMbHere = prevMb;
    if (pushable) {
      prevBottom = top + h;
      prevMb = natMb;
    }

    // ---- 1. Хэсэг: шинэ хуудаснаас эхэлж, дотогшоо рекурс ----
    if (el.matches(SECTION_SEL)) {
      if (pushable) {
        out.push({
          el, top, h, fit, natMt, prevMb: prevMbHere, prevGap,
          forceBreak: state.sections > 0, bleed,
        });
      }
      state.sections += 1;
      collect(el, flowTop, scale, contentH, out, state);
      continue;
    }

    // ---- 2. Түлхэх боломжгүй бол дотогш ч орох утгагүй ----
    // (абсолют хайрцгийн дотор түлхэх нь хуудсыг биш зөвхөн тэр
    //  хайрцгийн доторх байрлалыг өөрчилнө.)
    if (!pushable) continue;

    const manual = el.hasAttribute('data-a4-item');
    const isTable = el.tagName === 'TABLE';
    const fits = fit <= contentH + EPS;
    const leaf = el.childElementCount === 0;

    // ---- 3b / 6. Дотогш орох эсэх ----
    //
    // ⚠️ `!fits` нь ГАР ТЭМДЭГЛЭГЭЭНЭЭС ДЭЭГҮҮР ЯЛНА.  Урьд нь энэ
    // нөхцөл `!manual && …` дотор байсан тул `data-a4-item` тэмдэглэгээтэй
    // элемент ямар ч өндөртэй байсан АТОМ нэгж болдог байв.  Практикт
    // `bb-doc__grp` зэрэг хэсгийн бүрхүүл нь 268mm буюу нэг хуудасны
    // 105% хүрдэг: ийм нэгжийг «бүтнээр нь дараагийн хуудсанд» гэж
    // түлхэхэд өмнөх хуудас бараг ХООСОН үлдээд, дараа нь ямар ч байсан
    // хуваагдана (PDF-ээс хэмжихэд 15-р хуудас 3%, 16-р хуудас 8%
    // дүүрсэн байв).  Хэвлэлийн `break-inside: avoid` ч яг ижил байдлаар
    // ажилладаг тул шийдэл нь НЭГЖИЙГ ЖИЖИГЛЭХ: багтахгүй бүрхүүл рүү
    // орж хүүхдүүдийг нь тус тусад нь нэгж болгоно.
    //
    // Гарчиг өнчрөхөөс `styles.ts`-ийн `break-after: avoid` хамгаална.
    if (!isTable && !leaf && (!fits || (!manual && el.querySelector('[data-a4-item]') !== null))) {
      collect(el, flowTop, scale, contentH, out, state);
      continue;
    }

    // ---- Бэхгүй тусгаарлагчийг хаяна ----
    // `.perf-block-break` (1px) нь хэсгүүдийн ӨМНӨ сууж хуудас
    // эхлүүлдэг байсан.  Одоо хэсэг өөрөө хуудас эхлүүлдэг тул тэр
    // тэмдэглэгээ илүүц бөгөөд үлдээвэл ард нь ирэх хэсгийг 1px-ээр
    // «хуудасны эхэн БИШ» болгож бүтэн ХООСОН хуудас түүдэг.
    // (Хэсэг БИШ агуулгын өмнөх гар тэмдэглэгээ хэвээр хүчинтэй.)
    if (fit < MIN_ITEM_H) {
      if (!el.hasAttribute('data-a4-break')) continue;
      // Ард нь ирэх ЭХНИЙ БОДИТ агуулгыг хай — зам дээрх бусад бэхгүй
      // тусгаарлагчдыг алгасна (агуулгагүй блок `null` render хийхэд
      // хоёр `PageBreak` зэрэгцэн үлддэг).
      let next: Element | null = el.nextElementSibling;
      while (
        next !== null &&
        !next.matches(SECTION_SEL) &&
        next instanceof HTMLElement &&
        next.getBoundingClientRect().height / scale < MIN_ITEM_H
      ) {
        next = next.nextElementSibling;
      }
      if (next !== null && next.matches(SECTION_SEL)) continue;
    }

    // ---- 4. Хүснэгт ----
    if (isTable) {
      // Багтаж байвал бүтэн нэгж — хуудасны заагт унавал бүхэлдээ
      // дараагийн хуудас руу түлхэгдэнэ.
      if (fits) {
        // (Гар тэмдэглэгээ `data-a4-break="before"` хүснэгтэд ч хүчинтэй.)
        out.push({
          el, top, h, fit, natMt, prevMb: prevMbHere, prevGap,
          forceBreak: el.dataset.a4Break === 'before', bleed,
        });
        continue;
      }
      // Нэг хуудаснаас УРТ хүснэгт: хүснэгтийг хуудасны эхэнд түлхээд
      // (толгой + дээд тал нь олон мөр эхний хуудсанд багтана) МӨРҮҮДИЙГ
      // нь тус тусад нь хуудаслана.
      out.push({ el, top, h, fit, natMt, prevMb: prevMbHere, prevGap, forceBreak: true, bleed });
      collectRows(el as HTMLTableElement, flowTop, scale, out);
      continue;
    }

    out.push({
      el,
      top,
      h,
      fit,
      natMt,
      prevMb: prevMbHere,
      prevGap,
      forceBreak: el.dataset.a4Break === 'before',
      bleed,
    });
  }
}

/* ---------------------------------------------------------
 * Нэг хуудаснаас УРТ хүснэгтийн мөрүүдийг нэгж болгон цуглуулна.
 *
 * `display: table-row` дээр `margin` үйлчлэхгүй тул мөрийг margin-аар
 * ТҮЛХЭХ БОЛОМЖГҮЙ.  Гэхдээ мөрийн НҮДНҮҮДИЙН `padding-top`-ыг
 * өсгөвөл мөрийн өндөр өсч, ард нь ирэх бүх мөр доош шилжинэ — үр дүн
 * нь margin-тай ЯГ ижил.  Сунгагдсан нүдний хоосон хэсэг нь хуудасны
 * захын зай + хуудас хоорондын цоорхойд унах бөгөөд тэр бүсийг МАСК
 * бүрхдэг тул харагдахгүй.
 *
 * Урьд нь мөрүүд огт хэмжигддэггүй байсан: урт хүснэгт хуудасны эхнээс
 * эхлээд цаашаа тасралтгүй урсаж, заагт таарсан ~10 мөр маскийн доор
 * бүрмөсөн АЛГА БОЛДОГ байв (`team-stats-doc__table` шиг олон зуун
 * мөртэй хүснэгтэд хуудас тутамд).
 *
 * `thead`-ийн мөрийг АВАХГҮЙ: тэр нь хүснэгтийн хамгийн эхэнд, хүснэгт
 * өөрөө хуудасны эхэнд түлхэгдсэн байдаг тул хэзээ ч заагт унахгүй.
 * ------------------------------------------------------- */
function collectRows(
  table: HTMLTableElement,
  flowTop: number,
  scale: number,
  out: Measured[],
): void {
  for (const body of Array.from(table.tBodies)) {
    for (const tr of Array.from(body.rows)) {
      const cells = Array.from(tr.cells) as HTMLElement[];
      const first = cells[0];
      if (!first) continue;
      const rect = tr.getBoundingClientRect();
      const h = rect.height / scale;
      if (h < MIN_ITEM_H) continue;
      // ⚠️ Мөр доторх нүднүүд ижил `padding-top`-той гэж үзнэ (энэ
      // репо дахь бүх хүснэгтэд үнэн — padding нь `td`/`th`-д ангиар
      // тавигддаг).  Нэг л уншилтаар өнгөрснөөр урт хүснэгт дээр
      // хэдэн зуун `getComputedStyle` дуудахаас сэргийлнэ.
      const natPt = Number.parseFloat(window.getComputedStyle(first).paddingTop) || 0;
      out.push({
        el: tr,
        top: (rect.top - flowTop) / scale,
        h,
        fit: h,
        natMt: 0,
        // Мөрийг padding-оор түлхдэг тул margin залгирал хамаарахгүй.
        prevMb: 0,
        prevGap: null,
        forceBreak: false,
        bleed: false,
        cells,
        natPt,
      });
    }
  }
}

/* ---------------------------------------------------------
 * MARGIN ЗАЛГИРЛЫН НӨХӨЛТ  (2026-08-26)
 * ---------------------------------------------------------
 * СИМПТОМ: 90 хуудаст тайлангийн 27 хэсгийн 25 нь хуудасныхаа эхнээс
 * хазайж (эхлээд 3.6мм, сүүлдээ 79мм) агуулга цаасны захын зайд унаж,
 * маскийн доор хагас тайрагдаж харагдана.  Хэрэглэгчийн гомдол:
 * «текст зөв харагдахгүй байна», «энэ input дээр бичиж болохгүй байна»
 * (бичиж БОЛДОГ — бичсэн зүйл маскийн ДООР үлддэг).
 *
 * ШАЛТГААН: түлхэлтийг `margin-top`-оор бичдэг.  Зэргэлдээ ах дүүгийн
 * `margin-bottom` ба энэ элементийн `margin-top` нь CSS-ийн дүрмээр
 * ЗАЛГИРДАГ (collapse) — үр дүнгийн зай нь НИЙЛБЭР биш ХАМГИЙН ИХ нь.
 * Тиймээс:
 *     өмнө:  зай = max(prevMb, natMt)
 *     дараа: зай = max(prevMb, natMt + push)  ≈ natMt + push
 *     БОДИТ шилжилт = natMt + push − max(prevMb, natMt)
 * буюу `prevMb > natMt` үед түлхэлт нь (prevMb − natMt)-ээр ДУТУУ
 * ажиллана.  Пагинаторын загвар нь шилжилтийг push гэж үзсээр байдаг
 * тул алдаа хуудас бүрд ХУРИМТЛАГДАНА.
 *
 * ЗАСВАР: суурийг `natMt` биш, урд ах дүүтэйгээ хоорондын БОДИТ ХЭМЖСЭН
 * зай (`prevGap`) болгоно:
 *     margin-top := prevGap + push
 * Түлхэлт нь ямагт нэг хуудасны «үхсэн зурвас»-аас (≈44мм = 167px) том
 * тул шинэ margin нь залгиралд ЯЛЖ, эцсийн зай яг `prevGap + push`
 * болно ⇒ бодит шилжилт = push.  ЯГ ЭНЭ хэлбэр нь «зай хаанаас гарсныг»
 * (ах дүүгийн margin-bottom, түүний ХҮҮХДИЙН залгирсан margin, эсвэл
 * хоёрын нийлбэр) мэдэхийг огт шаардахгүй — тоог нь ХЭМЖСЭН.
 *
 * ⚠️ Яагаад `prevMb`-г шууд ашиглаагүй вэ: хэмжилтээр `perf-intro__group`
 * дээр prevGap = 13.2px, харин урд ах дүүгийн зарласан margin-bottom
 * 11.34px байв — зөрүү нь ах дүүгийн ХҮҮХДЭЭС гадагш залгирсан margin.
 * Зарласан утгаар нөхөх нь тэр 1.9px-ыг алдаж, 90 хуудсанд хуримтлагдана.
 *
 * ⚠️ `prevGap` нь flex/grid эцэгт `null` (тэнд margin залгирдаггүй) ба
 * урд ах дүүгүй үед ч `null` — хоёуланд нь хуучин зан төлөв (`natMt`).
 * ------------------------------------------------------- */
function collapsedBase(it: Measured): number {
  return it.prevGap === null ? it.natMt : it.prevGap;
}

export interface A4PaginatorProps {
  children: ReactNode;
  /** `false` үед юу ч хэмжихгүй, `children`-ээ шууд буцаана
   *  (хэвлэх / PDF маршрут — тэнд жинхэнэ `@page` тасалдал ажиллана). */
  enabled?: boolean;
  className?: string;
}

export function A4Paginator({ children, enabled = true, className }: A4PaginatorProps): JSX.Element {
  const docRef = useRef<HTMLDivElement | null>(null);
  const flowRef = useRef<HTMLDivElement | null>(null);
  // Хэмжилтийн датчик: 100mm ба 100px.  Хоёуланг нь харьцуулж
  // (а) мм→px харьцаа, (б) эцэг дэх `transform: scale()`-ийг олно.
  const mmProbeRef = useRef<HTMLDivElement | null>(null);
  const pxProbeRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const charTimerRef = useRef<number | null>(null);
  /** D5 — бичилт зогссоны дараа ажиллах цорын ганц хойшлуулсан хэмжилт. */
  const idleTimerRef = useRef<number | null>(null);
  /** D5 — хамгийн сүүлд `characterData` өөрчлөлт болсон мөч. */
  const typingAtRef = useRef(0);
  /** Өмнөх хэмжилтэд түлхэлт БИЧСЭН элементүүд.  Дахин `querySelectorAll`
   *  хийхгүйгээр буцаан тэглэхэд хэрэглэнэ. */
  const pushedRef = useRef<HTMLElement[]>([]);
  /** Хямд «өөрчлөлт байна уу» гарын үсэг (D1).  Хэмжилтийн ДАРААХ
   *  төлөвийг хадгална. */
  const sigRef = useRef<{ h: number; n: number } | null>(null);

  const [pageCount, setPageCount] = useState(1);
  const [docMinHeight, setDocMinHeight] = useState<number | null>(null);
  /** Захын маск унтраах хуудсууд, «0,3,7» хэлбэрээр.  Мөр болгосон нь
   *  зориудынх: утга нь өөрчлөгдөөгүй үед React дахин render хийхгүй. */
  const [bleedKey, setBleedKey] = useState('');

  /* ---------------------------------------------------------
   * Хэмжилт + түлхэлт.
   *
   * ГҮЙЦЭТГЭЛИЙН ГЭРЭЭ (D):
   *   W0  бичилт  — өмнөх түлхэлтүүдийг тэглэнэ
   *   R   уншилт  — БҮХ rect / computed style-ыг цуглуулна
   *   W1  бичилт  — БҮХ margin-top-ыг бичнэ
   * Уншилт↔бичилтийг ХЭЗЭЭ Ч давхарлахгүй — эс бөгөөс элемент тутамд
   * layout албадаж (layout thrashing) хэдэн зуун reflow үүснэ.
   * ------------------------------------------------------- */
  const measure = useCallback(() => {
    const doc = docRef.current;
    const flow = flowRef.current;
    const mmProbe = mmProbeRef.current;
    const pxProbe = pxProbeRef.current;
    if (!doc || !flow || !mmProbe || !pxProbe) return;

    // ---- D1. Хямд өөрчлөлтийн шалгалт ----
    // Бичиж байхад ихэнх товчлуур урсгалын өндрийг огт өөрчилдөггүй
    // (нэг мөрийн дотор тэмдэгт нэмэгдэнэ).  Тийм тохиолдолд бүх
    // баримтыг дахин алхах шаардлагагүй.  `restoreCaret()`-ыг ч
    // дуудахгүй — фокус хөндөгдөхгүй.
    // ⚠️ Хязгаар: өндөр ба элементийн тоо аль аль нь өөрчлөгдөөгүй ч
    // хэвтээ чиглэлд текст дахин урсаж болно.  Босоо урсгалд байрлал
    // нь өндрөөр тодорхойлогддог тул үр дүн ижил хэвээр үлдэнэ.
    // (rect-ийн өндөр нь `scrollHeight`-ээс ялгаатай нь ДЭД-ПИКСЕЛ
    //  нарийвчлалтай тул нэг мөрийн өндрийн өчүүхэн өөрчлөлтийг ч барина.)
    const sigH = Math.round(flow.getBoundingClientRect().height * 100);
    const sigN = flow.getElementsByTagName('*').length;
    const prevSig = sigRef.current;
    if (prevSig && prevSig.h === sigH && prevSig.n === sigN) return;

    // ---- 0. Масштаб ба мм→px харьцааг DOM-оос уншина ----
    // (96dpi гэж hardcode бичихгүй: browser zoom / dpi / transform-д тэсвэртэй)
    const scale = rectHeight(pxProbe) / 100;
    if (!(scale > 0)) return;
    const pxPerMm = rectHeight(mmProbe) / 100 / scale;
    if (!(pxPerMm > 0)) return;

    const PAGE_H = PAGE_H_MM * pxPerMm;
    const PAD_T = PAD_T_MM * pxPerMm;
    const PAD_B = PAD_B_MM * pxPerMm;
    /** Нэг хуудсанд агуулга багтах цэвэр өндөр. */
    const CONTENT_H = PAGE_H - PAD_T - PAD_B;
    if (!(CONTENT_H > 0)) return;
    /** Хуудас хоорондын АЛХАМ: цаас + дэлгэцийн цоорхой.
     *  Урсгал бол тасралтгүй нэг багана тул N дугаар хуудасны агуулга
     *  урсгалын дотор [N*UNIT + PAD_T, … + CONTENT_H] мужид очих ёстой.
     *  Иймд түлхэлт нь зөвхөн "хуудасны үлдсэн хэсгийг дүүргэх" бус,
     *  доод/дээд захын зай + цоорхойг (UNIT − CONTENT_H) БАС давах
     *  ёстой — эс бөгөөс агуулга цаасныхаа хажуугаар хуудас тутамд
     *  ~34mm-ээр гулсана. */
    const UNIT = PAGE_H + SHEET_GAP_PX;

    // ---- W0. Өмнөх бүх түлхэлтийг арилгана ----
    for (const el of pushedRef.current) {
      if (el instanceof HTMLTableRowElement) {
        // Мөрийн горим: түлхэлт нь нүднүүдийн `padding-top`-д бичигдсэн.
        for (const c of Array.from(el.cells)) c.style.removeProperty('padding-top');
        el.style.removeProperty('--a4-nat-pt');
      } else {
        el.style.removeProperty('margin-top');
        el.style.removeProperty('--a4-nat-mt');
      }
      el.removeAttribute('data-a4-pushed');
    }
    pushedRef.current = [];

    // ---- R. Бүх уншилт (энд л ганц reflow үүснэ) ----
    const flowRect = flow.getBoundingClientRect();
    const flowTop = flowRect.top;
    const natFlowH = flowRect.height / scale;

    const items: Measured[] = [];
    collect(flow, flowTop, scale, CONTENT_H, items, { sections: 0 });
    const n = items.length;

    // ---- 3. Түлхэлтийг тооцоолно ----
    const push = new Array<number>(n).fill(0);
    const finalTop = new Array<number>(n).fill(0);
    let shift = 0;
    /** Хамгийн сүүлд албадсан хуудасны дугаар.  Дараалсан хоёр «шинэ
     *  хуудаснаас эхэл» нэгж (жишээ нь ХООСОН `divider: page-break`
     *  хэсэг) нэг хуудсанд наалдахаас сэргийлнэ. */
    let lastBreakPage = -1;
    for (let i = 0; i < n; i += 1) {
      const it = items[i];
      const top = it.top + shift;
      const rel = top - PAD_T;
      const pageIdx = Math.max(0, Math.floor((rel + EPS) / UNIT));
      /** Тухайн хуудасны агуулгын бүсийн эхнээс хойших байрлал (0 … UNIT). */
      const inPage = rel - pageIdx * UNIT;

      // (а) Хүчээр шинэ хуудас.
      if (it.forceBreak) {
        const needsFresh = pageIdx === lastBreakPage;
        if (inPage > BREAK_SLACK || needsFresh) {
          const delta = UNIT - inPage;
          if (delta > EPS) {
            shift += delta;
            push[i] = delta;
          }
          lastBreakPage = pageIdx + 1;
        } else {
          lastBreakPage = pageIdx;
        }
        finalTop[i] = it.top + shift;
        continue;
      }

      // (б) Нэг A4-д огт багтахгүй том элемент — түлхэх нь утгагүй,
      //     тасрахыг зөвшөөрнө (маск нь «тайрсан» мэт харагдуулна).
      if (it.fit > CONTENT_H + EPS) {
        finalTop[i] = it.top + shift;
        continue;
      }

      // (в) Хуудасны агуулгын ёроолыг давсан ЭСВЭЛ хуудас хоорондын
      //     цоорхойд унасан бол дараагийн хуудасны эхэнд түлхнэ.
      //     Тэмдэглэл: delta ≥ (PAD_B + GAP + PAD_T) ≈ 34mm тул өмнөх
      //     ах дүүгийн margin-bottom-той "залгирах" (margin collapsing)
      //     магадлалгүй — түлхэлт үргэлж бүрэн хүчинтэй.
      if (inPage + it.fit > CONTENT_H + EPS) {
        const delta = UNIT - inPage;
        if (delta > EPS) {
          shift += delta;
          push[i] = delta;
        }
      }
      finalTop[i] = it.top + shift;
    }

    // ---- W1. Түлхэлтийг margin-top болгон бичнэ ----
    const pushed: HTMLElement[] = [];
    for (let i = 0; i < n; i += 1) {
      if (push[i] <= EPS) continue;
      const it = items[i];
      // Хэвлэхэд (Ctrl+P) түлхэлтийг тайлж, элементийн ӨӨРИЙН margin /
      // padding-ыг сэргээх боломж олгоно — доорх `@media print` дүрмүүд
      // эдгээр хувьсагчийг уншина.
      if (it.cells) {
        // Хүснэгтийн мөр: margin үйлчлэхгүй тул нүднүүдийн padding-оор.
        const natPt = it.natPt ?? 0;
        it.el.style.setProperty('--a4-nat-pt', `${natPt}px`);
        for (const c of it.cells) c.style.paddingTop = `${natPt + push[i]}px`;
      } else {
        // `--a4-nat-mt` нь ХЭВЛЭХ үед түлхэлтийг тайлж, элементийн ӨӨРИЙН
        // margin-ыг сэргээхэд хэрэглэгддэг тул суурь нь ҮРГЭЛЖ `natMt`.
        it.el.style.setProperty('--a4-nat-mt', `${it.natMt}px`);
        it.el.style.marginTop = `${collapsedBase(it) + push[i]}px`;
      }
      it.el.setAttribute('data-a4-pushed', '');
      pushed.push(it.el);
    }
    pushedRef.current = pushed;

    // ---- 5. Хуудасны тоо ----
    // Дахин reflow үүсгэхгүйн тулд өндрийг аналитикаар бодно:
    // урсгалын агуулгын ёроол = (анхны өндөр − доод зай) + нийт түлхэлт.
    // Хуудас p-д агуулга [p*UNIT + PAD_T, … + CONTENT_H] мужид багтана.
    const lastY = natFlowH - PAD_B + shift;
    const pages = Math.max(1, Math.ceil((lastY - PAD_T - CONTENT_H - EPS) / UNIT) + 1);
    setPageCount(pages);
    // Сүүлийн цаасны ёроол (араас нь цоорхой хэрэггүй).  Эцэг хайрцаг
    // үүнээс богино байвал сүүлийн хуудас скроллд багтахгүй үлдэнэ.
    setDocMinHeight(pages * UNIT - SHEET_GAP_PX);

    // ---- 5b. Захын зайг ӨӨРӨӨ будаж буй хуудсууд ----
    // `.perf-cover` нь сөрөг margin-аар цаасны дөрвөн зах хүртэл navy
    // болдог.  Тэр хуудсан дээр цагаан захын маск зурвал доод 23.88mm
    // цагаан зурвас гарч дизайныг хайчилна — иймд унтраана.
    const bleeds: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const it = items[i];
      if (!it.bleed) continue;
      const y0 = finalTop[i];
      const y1 = y0 + it.h;
      const p0 = Math.max(0, Math.floor((y0 + EPS) / UNIT));
      const p1 = Math.min(pages - 1, Math.floor((y1 - EPS) / UNIT));
      for (let p = p0; p <= p1; p += 1) {
        const sheetTop = p * UNIT;
        const headB = sheetTop + PAD_T;
        const footA = sheetTop + PAGE_H - PAD_B;
        const footB = sheetTop + PAGE_H;
        const hitsHead = y0 < headB - EPS && y1 > sheetTop + EPS;
        const hitsFoot = y0 < footB - EPS && y1 > footA + EPS;
        if ((hitsHead || hitsFoot) && !bleeds.includes(p)) bleeds.push(p);
      }
    }
    setBleedKey(bleeds.join(','));

    // ---- 6. Гарын үсгийг ШИНЭЧЛЭНЭ ----
    // Түлхэлт бичсэний ДАРАА уншина: `ResizeObserver` маань өөрийнхөө
    // бичилтээс болж дахин асахад дээрх D1 шалгалт түүнийг үнэгүй
    // таслана.
    sigRef.current = { h: Math.round(flow.getBoundingClientRect().height * 100), n: sigN };

    // ---- 7. Курсорыг сэргээнэ ----
    restoreCaret();
  }, []);

  /** requestAnimationFrame-аар debounce — давхар ажиллахаас сэргийлнэ. */
  const schedule = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      measure();
    });
  }, [measure]);

  /* D5 — БИЧИЖ БАЙХ ҮЕИЙН ХОЙШЛУУЛАЛТ.
   * ------------------------------------------------------------------
   * Доорх `useLayoutEffect`-ийн хамаарлын жагсаалтад `children` байгаа:
   * эцэг дахин render хийх бүрд шинэ объект болдог тул contentEditable
   * дотор товчлуур дарах БҮРД `measure()` СИНХРОНООР, зурагдахаас өмнө
   * ажилладаг.  D1 шалгалт ихэнхийг нь таслах ч `getBoundingClientRect()`
   * нь дөнгөж өөрчлөгдсөн DOM дээр layout-ыг албадан тооцуулдаг —
   * 1651 нэгжтэй баримт дээр энэ нь кадр алгасуулна (E2E: p95 59мс).
   *
   * Тиймээс бичилт ИДЭВХТЭЙ байх хугацаанд синхрон хэмжилтийг бүрмөсөн
   * алгасаад, бичилт зогссоны дараа НЭГ л удаа хэмжинэ.  Хэрэглэгч бичиж
   * байхдаа хуудасны заагийг хардаггүй — бичиж дуусаад л хардаг. */
  const scheduleIdle = useCallback(
    (delay: number) => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = window.setTimeout(() => {
        idleTimerRef.current = null;
        measure();
      }, delay);
    },
    [measure],
  );

  // Render-ийн дараа синхроноор (хэрэглэгчид анивчиж харагдахгүй).
  // ⚠️ Dependency жагсаалт ЗААВАЛ байх ёстой (D1): `measure` нь
  // `setPageCount` / `setDocMinHeight` / `setBleedKey` дуудаж дахин
  // render үүсгэдэг — dependency-гүй үед тэр render дахин хэмжилт
  // өдөөж, хэмжилт бүр ХОЁР дахин ажилладаг байв.  `children` нь эцэг
  // дахин render хийх бүрд шинэ объект болдог тул бодит агуулгын
  // өөрчлөлтийг барих ба пагинаторын ӨӨРИЙН setState-ыг барихгүй.
  useLayoutEffect(() => {
    if (!enabled) return;
    // D5: бичилт идэвхтэй байвал синхрон хэмжилт хийхгүй — зогсоод хэмжинэ.
    if (performance.now() - typingAtRef.current < TYPING_IDLE_MS) {
      scheduleIdle(TYPING_IDLE_MS);
      return;
    }
    measure();
  }, [enabled, children, measure, scheduleIdle]);

  useEffect(() => {
    if (!enabled) return;
    const flow = flowRef.current;
    if (!flow) return;

    // enabled солигдоход хуучин гарын үсэг хүчингүй.
    sigRef.current = null;

    // Өндөр өөрчлөгдөх бүрт (зураг ачаалагдах, мөр нэмэгдэх…).
    // ⚠️ Энэ observer бидний бичсэн margin-top-оос БОЛЖ ӨӨРӨӨ асна.
    // Алгоритм идемпотент тул давталт үүсэхгүй, дээрх D1 шалгалт
    // хоёр дахь дуудалтыг бараг үнэгүй таслана.
    const ro = new ResizeObserver(() => schedule());
    ro.observe(flow);

    // contentEditable дотор бичихэд DOM-ийн текст өөрчлөгдөнө.
    // `attributes: false` нь ЧУХАЛ: дээрх margin-top бичилт маань өөрөө
    // observer-ыг дахин ажиллуулж хязгааргүй давталт үүсгэхгүй.
    //
    // D3: `childList` (блок нэмэх/хасах) — ШУУД.
    //     `characterData` (бичиж байгаа) — 80мс throttle.  Бичих явцад
    //     хуудсыг тэмдэгт тутамд дахин зохион байгуулах шаардлагагүй;
    //     өндөр өөрчлөгдвөл ResizeObserver аль хэдийн барина.
    const mo = new MutationObserver((records) => {
      let structural = false;
      for (const r of records) {
        if (r.type !== 'characterData') {
          structural = true;
          break;
        }
      }
      if (structural) {
        if (charTimerRef.current !== null) {
          window.clearTimeout(charTimerRef.current);
          charTimerRef.current = null;
        }
        schedule();
        return;
      }
      // D5: бичиж байгааг тэмдэглэнэ (layout-effect үүнийг уншина) ба
      // хэмжилтийг бичилт ЗОГССОНЫ дараа нэг л удаа хийнэ.
      typingAtRef.current = performance.now();
      scheduleIdle(TYPING_IDLE_MS);
    });
    mo.observe(flow, {
      characterData: true,
      childList: true,
      subtree: true,
      attributes: false,
    });

    // Arimo вэб фонт ачаалагдмагц мөрийн өндөр өөрчлөгддөг.
    let alive = true;
    if (document.fonts && document.fonts.ready) {
      void document.fonts.ready.then(() => {
        if (alive) schedule();
      });
    }

    return () => {
      alive = false;
      ro.disconnect();
      mo.disconnect();
      sigRef.current = null;
      if (charTimerRef.current !== null) {
        window.clearTimeout(charTimerRef.current);
        charTimerRef.current = null;
      }
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // `scheduleIdle` нь MutationObserver-ийн `characterData` салаанд
    // ашиглагдана — хуучирсан closure нь хуучин `measure`-ыг барихаас
    // сэргийлж хамаарлын жагсаалтад ЗААВАЛ орно.
  }, [enabled, schedule, scheduleIdle]);

  // Хэвлэх / PDF маршрут: жинхэнэ `@page` тасалдал ажиллах тул ямар ч
  // хэмжилт, ямар ч нэмэлт DOM хийхгүй.
  if (!enabled) return <>{children}</>;

  const cls = ['a4-doc', className].filter(Boolean).join(' ');
  const bleed = new Set(bleedKey ? bleedKey.split(',').map((s) => Number(s)) : []);

  return (
    <div
      ref={docRef}
      className={cls}
      style={docMinHeight != null ? { minHeight: `${docMinHeight}px` } : undefined}
    >
      {/* Хэмжилтийн датчик — layout-д огт нөлөөлөхгүй (absolute + width:0). */}
      <div className="a4-probe" aria-hidden="true">
        <div ref={mmProbeRef} style={{ height: '100mm' }} />
        <div ref={pxProbeRef} style={{ height: '100px' }} />
      </div>

      {/* Ард зурагдах цагаан A4 цааснууд — зөвхөн харагдац. */}
      <div className="a4-sheets" aria-hidden="true">
        {Array.from({ length: pageCount }, (_, i) => (
          <div className="a4-sheet" key={i} />
        ))}
      </div>

      {/* Тасралтгүй агуулгын урсгал — НЭГ Л удаа mount болно. */}
      <div ref={flowRef} className="a4-flow">
        {children}
      </div>

      {/* Цаасны ГАДНАХ бүх зурвасыг бүрхэх маск — урсгалын ДЭЭР.
          Түлхэгдэж чадаагүй агуулга (нэг хуудаснаас урт хүснэгтийн мөр,
          асар том зураг…) цаасны хилээс цааш ХАРАГДАХГҮЙ, ирмэг цэвэр
          үлдэнэ.  Дэлгэц дээр «хэвлэгч тайрсан» мэт харагдана. */}
      <div className="a4-masks" aria-hidden="true">
        {Array.from({ length: pageCount }, (_, i) => (
          <Fragment key={i}>
            {!bleed.has(i) && (
              <>
                <div className="a4-mask a4-mask--paper" style={headMaskStyle(i)} />
                <div className="a4-mask a4-mask--paper" style={footMaskStyle(i)} />
              </>
            )}
            {i < pageCount - 1 ? (
              <div className="a4-mask a4-mask--gap" style={gapMaskStyle(i)} />
            ) : (
              <div className="a4-mask a4-mask--tail" style={tailMaskStyle(i)} />
            )}
            {!bleed.has(i) && (
              <span className="a4-pageno" style={pageNoStyle(i)}>
                {i + 1} / {pageCount}
              </span>
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Маскийн геометр ----------------
 * Бүгд `calc()` — мм ба px-ийг хольж бичсэн тул browser zoom / dpi-аас
 * хамааралгүй, JS дэх pxPerMm-тэй хэзээ ч зөрөхгүй.
 *
 *   ┌────────────────┐ ← цаасны дээд ирмэг     (p*UNIT)
 *   │ head  (цагаан) │   өндөр = PAGE_PAD.top
 *   ├────────────────┤ ← агуулгын бүсийн эхлэл
 *   │    АГУУЛГА     │
 *   ├────────────────┤ ← агуулгын бүсийн төгсгөл
 *   │ foot  (цагаан) │   өндөр = PAGE_PAD.bottom
 *   ├────────────────┤ ← цаасны доод ирмэг     (p*UNIT + 297mm)
 *   │ gap  (саарал)  │   өндөр = SHEET_GAP_PX + ирмэгийн сүүдэр
 *   └────────────────┘ ← дараагийн цаасны дээд ирмэг
 *
 * Сүүлийн хуудасны ард `tail` нь баримтын ЁРООЛ хүртэл сунана —
 * түлхэгдэж чадаагүй урт агуулга ч түүний доор бүрэн нуугдана. */
function headMaskStyle(p: number): CSSProperties {
  return { top: sheetTopCss(p), height: mmCss(PAD_T_MM) };
}
function footMaskStyle(p: number): CSSProperties {
  return {
    top: `calc(${sheetTopCss(p)} + ${mmCss(PAGE_H_MM - PAD_B_MM)})`,
    height: mmCss(PAD_B_MM),
  };
}
function gapMaskStyle(p: number): CSSProperties {
  return { top: `calc(${sheetTopCss(p)} + ${PAGE_H_MM}mm)`, height: `${SHEET_GAP_PX}px` };
}
function tailMaskStyle(p: number): CSSProperties {
  return { top: `calc(${sheetTopCss(p)} + ${PAGE_H_MM}mm)`, bottom: 0 };
}
/** Хуудасны дугаар — цаасны доод ирмэгээс 5mm дээр, баруун талд.
 *  `foot` масктай нэг зурвас дээр суух тул маскийн ДАРАА render хийнэ. */
function pageNoStyle(p: number): CSSProperties {
  return {
    top: `calc(${sheetTopCss(p)} + ${mmCss(PAGE_H_MM - 5)})`,
    transform: 'translateY(-100%)',
  };
}

/** Пагинаторын CSS.  `PERFORMANCE_REPORT_STYLES` + `EDITABLE_STYLES`-ийн
 *  ард нэмж, нэг `<style>` дотор оруулна.
 *
 *  ⚠ `.a4-flow`-ийн `padding` нь `PAGE_PAD`-аас template literal-аар
 *  ҮҮСДЭГ тул хэмжилтийн алгоритмтай хэзээ ч зөрөхгүй.  `.a4-sheet`-ийн
 *  `height` / `margin-bottom` нь PAGE_H_MM / SHEET_GAP_PX-тэй ЗААВАЛ
 *  таарах ёстой — нэгийг нь өөрчилвөл нөгөөг нь бас өөрчил. */
export const A4_PAGINATOR_STYLES = `
.a4-doc {
  position: relative;
  width: 210mm;
  margin: 0 auto;
  /* Маскийн өнгө.  Хараагчийн дэвсгэр (.perf-preview-host) өөр байвал
   * эцэг нь эдгээр хувьсагчийг дарж бичиж болно. */
  --a4-paper: #fff;
  --a4-gap-bg: #e9eaee;
}

/* Хэмжилтийн датчик: урсгалаас гадуур, харагдахгүй, өргөнгүй. */
.a4-probe {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  visibility: hidden;
  pointer-events: none;
}
.a4-probe > div { width: 0; }

/* Ард зурагдах цаасны давхарга. */
.a4-sheets {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 0;
  pointer-events: none;
}
.a4-sheet {
  position: relative;
  width: 210mm;
  height: ${PAGE_H_MM}mm;
  margin: 0 0 ${SHEET_GAP_PX}px;
  background: var(--a4-paper, #fff);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.10);
}
.a4-sheet:last-child { margin-bottom: 0; }

/* Агуулгын тасралтгүй урсгал — цаасны ДЭЭР, ил тод дэвсгэртэй.
 * "flow-root" нь margin алдагдахаас (collapsing through) сэргийлж,
 * хэмжсэн өндөр бодит өндөртэй үргэлж тэнцүү байхыг баталгаажуулна. */
.a4-flow {
  position: relative;
  z-index: 1;
  display: flow-root;
  background: transparent;
  padding: ${PAGE_PAD.top}mm ${PAGE_PAD.right}mm ${PAGE_PAD.bottom}mm ${PAGE_PAD.left}mm;
}

/* Цаасны ГАДНАХ зурвасыг бүрхэх маск — урсгалаас ДЭЭГҮҮР (z-index 2).
 * .a4-flow нь z-index:1-тэй тул өөрийн stacking context үүсгэдэг —
 * дотор нь ямар ч z-index бичсэн агуулга маскийг давж гарахгүй. */
.a4-masks {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 2;
  pointer-events: none;
}
.a4-mask {
  position: absolute;
  left: 0;
  right: 0;
}
/* Цаасны захын зай — цаасны өнгөөр. */
.a4-mask--paper { background: var(--a4-paper, #fff); }
/* Хуудас хоорондын цоорхой — хараагчийн дэвсгэрээр + цаасны ирмэгийн
 * сүүдрийг давтаж (.a4-sheet-ийн box-shadow энд дарагдана). */
.a4-mask--gap,
.a4-mask--tail {
  background-color: var(--a4-gap-bg, #e9eaee);
  background-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.10) 0,
    rgba(0, 0, 0, 0.02) 9px,
    rgba(0, 0, 0, 0.05) ${SHEET_GAP_PX}px
  );
  background-repeat: no-repeat;
}
/* Сүүлийн цаасны доогуур сүүдэр зөвхөн эхний зурваст, цааш нь цэвэр. */
.a4-mask--tail { background-size: 100% ${SHEET_GAP_PX}px; }

/* Хуудасны дугаар — цаас бүрийн доод баруун буланд жижгээр.
 * Маскийн давхаргад суудаг (маск нь цаасны доод захыг бүрхдэг тул
 * цаасан дээр үлдээвэл далдлагдана). */
.a4-pageno {
  position: absolute;
  right: 8mm;
  font-size: 8px;
  line-height: 1;
  letter-spacing: 0.04em;
  color: #9aa4b2;
  font-family: "Arial", Helvetica, sans-serif;
  user-select: none;
}

/* Хэвлэх үед бүх backdrop алга болно — Chromium өөрөө жинхэнэ @page
 * тасалдал хийнэ.  Түлхэлтүүдийг тайлж, элементийн ӨӨРИЙН margin-ыг
 * сэргээнэ (author !important нь inline style-ыг дийлдэг). */
@media print {
  .a4-doc {
    width: auto;
    margin: 0;
    min-height: 0 !important;
  }
  .a4-sheets,
  .a4-masks,
  .a4-probe { display: none !important; }
  .a4-flow {
    display: block;
    padding: 0 !important;
  }
  /* ⚠️ Зөвхөн ТҮЛХЭГДСЭН элементийг тэглэнэ.  Урьд нь энэ дүрэм
   * [data-a4-item]-д хамаардаг байсан нь эрсдэлтэй: --a4-nat-mt
   * тавигдаагүй элементийн ӨӨРИЙН CSS margin-top-ыг 0 болгодог. */
  .a4-flow [data-a4-pushed] { margin-top: var(--a4-nat-mt, 0px) !important; }
  /* Мөрийн түлхэлт нь НҮДНИЙ padding-top дээр inline бичигддэг тул
   * !important-гүйгээр буцаахгүй. */
  .a4-flow tr[data-a4-pushed] > td,
  .a4-flow tr[data-a4-pushed] > th { padding-top: var(--a4-nat-pt, 0px) !important; }
}
`;
