/**
 * Зохиогчийн хяналтын баримтын хэвлэлтийн CSS.
 *
 * 2026-09-23-аас ЭЗНИЙ ӨГСӨН ЖИШЭЭ БАРИМТЫН («01. Жишээ тайлан.pdf») хэв маяг:
 *   цаас      A4 210×297, дээш 14 / хажуу 19.05 / доош 20 мм (хөл нь доод зайд)
 *   фонт      Arimo 10pt (Arial-ийн хэмжээст ижил), мөр 1.35
 *   толгой    Word загварын толгой (2026-09-28): «Design Author’s Supervision
 *             Report» / Report Date / Doc. No. + баруун талд лого, доор зураас
 *   блок      ХАР хүрээтэй (0.9pt) бие даасан хайрцаг; блок хооронд зай
 *   шошго     #0F243E дүүргэлт, цагаан тод 9pt + налуу цайвар англи дэд шошго
 *   бие       НАЛУУ бичвэр (жишээний «Хяналтаар гарсан шийдвэрлэх
 *             асуудлууд:» доорх 1–9 дугаарласан догол мөрүүдтэй ижил)
 *   лого      ЗӨВХӨН толгойд (2026-09-28-наас; гарын үсгийн хажуугаас хасагдсан)
 *
 * ⚠️ Өмнөх (2026-09-16) Гүйцэтгэлийн тайлангийн хэв маяг — дугаарласан
 *    «1. Төслийн мэдээлэл» гарчиг, хэсэг тус бүрийн тусдаа хүснэгт, хар-хөх
 *    дэд тууз — ХАСАГДСАН.  Тэр нь баримтыг тайлан мэт харагдуулдаг байсан;
 *    эзэн ЦААСАН МАЯГТЫН хэлбэрийг сонгосон.  Буцаах бол `AsrDocument.tsx`-ийн
 *    2026-09-23-ны тайлбарыг ЭХЛЭЭД уншина.
 *
 * ХУУДАСНЫ БҮТЭЦ:
 *
 *   .asr-page (table)
 *     thead → running толгой: гарчиг / огноо / Doc. No. + лого  ← хуудас БҮРТ
 *     tbody → .asr-form (маягтын толгой) · .asr-block × N
 *
 * ⚠️ Толгой нь ГАДНА бүрхэгч хүснэгтийн thead-д: Chrome нь thead-ийг хуудас
 *    бүрт давтдаг тул хоёр дахь хуудсан дээр ч толгой хэвээр.  `position:
 *    fixed` арга Cloudflare-ийн Chromium дээр толгойг тайрдаг (AsrDocument.tsx).
 *
 * ⚠️ .asr-doc-ийн өргөн ДЭЛГЭЦ ДЭЭР Ч 171.9мм (= 210 − 2×19.05).  Дэлгэц =
 *    цаас байж мөр таслалт хэвлэлттэй ижил байна.
 *
 * ⚠️ ХУУДАСНЫ ХӨЛ БАЙХГҮЙ (эзэн 2026-09-28): серверийн PDF-д footerTemplate
 *    алга, браузерын print-ийн огноо / URL / «1/2» ч гарахгүй.  Арга: `@page`
 *    margin = 0 (Chrome толгой/хөлөө ЗӨВХӨН хуудасны зайд зурдаг — зай
 *    байхгүй бол зурахгүй), харин цаасны зайг ХЭВЛЭХ үед:
 *      дээд  = thead-ийн padding-top (хуудас бүрт давтагдана),
 *      доод  = tfoot-ийн хоосон нүдний өндөр (хуудас бүрт давтагдана),
 *      хажуу = .asr-paper-ийн padding (бүх хуудсанд).
 *    `routes/authorSupervision.ts`-ийн page.pdf margin мөн 0.
 *
 * Компонентын файлаас ТУСДАА байгаа нь Fast Refresh-ийн шаардлага
 * (`react-refresh/only-export-components`).  CSS-ийг мөр болгож экспортлоод
 * компонентын биед `<style dangerouslySetInnerHTML>` болгон рендерлэнэ —
 * жирийн CSS import хийвэл lazy chunk-ийн `<style>` нь `index.css`-ийн дараа
 * орох баталгаагүй тул `@page` дүрэм аль нь хожих нь build бүрт хэлбэлзэнэ.
 */

/* --- БЛАНКНЫ ЛОГО ---------------------------------------------------------
 * ⚠️ `public/logo.svg`-ийн viewBox нь 1920×1080 боловч БОДИТ зураг (ink) нь
 * түүний дунд ердөө 455×349 нэгжийг эзэлдэг (x 732–1187, y 365–714) — өөрөөр
 * хэлбэл 76% нь хоосон зай.  Иймд хайрцагт `object-fit: contain`-аар багтаавал
 * бодит тэмдэг ердөө ~4.5мм болж, бланк «логогүй» мэт харагдана.
 *
 * Шийдэл нь `features/quotes/components/printStyles.ts`-д аль хэдийн
 * тогтсон арга: зургийг ТОМСГООД эргэн тойрны хоосон зайг СӨРӨГ зайгаар
 * хасна — эзлэх хайрцаг нь ЯГ ink-ийн хэмжээ болж, зохиомж хөндөгдөхгүй.
 * ⚠️ Зурагдах талбай нь layout хайрцгаасаа ЦУХУЙХ тул эцэг элемент
 * (`.asr-logo-box`) нь overflow: hidden байх ЁСТОЙ — эс бөгөөс Chrome
 * хэвлэхдээ хуудсыг бүхэлд нь шахдаг (хэмжсэн 2026-09-11).
 *
 * ⚠️ `logo.svg`-ийг СОЛИХ бол ink-ийн хүрээг ДАХИН хэмжинэ (headless Chrome-д
 * 1920×1080-аар зурж `getBBox()` авах).
 */
const LOGO_VIEWBOX_W = 1920;
const LOGO_VIEWBOX_H = 1080;
const LOGO_INK_W = 455;
const LOGO_INK_H = 349;
/** Цаасан дээрх тэмдгийн БОДИТ өндөр (мм).  Толгойн гурван мөртэй ижил өндөр
 *  (Word загварт лого 18×14мм) — 2026-09-28-нд гарын үсгийн хажуугаас (17мм)
 *  толгой руу шилжсэн. */
const LOGO_INK_H_MM = 12.5;

const LOGO_IMG_H_MM = (LOGO_INK_H_MM * LOGO_VIEWBOX_H) / LOGO_INK_H;
const LOGO_MARGIN_Y_MM = (LOGO_IMG_H_MM * ((LOGO_VIEWBOX_H - LOGO_INK_H) / 2)) / LOGO_VIEWBOX_H;
const LOGO_MARGIN_X_MM =
  ((LOGO_IMG_H_MM * LOGO_VIEWBOX_W) / LOGO_VIEWBOX_H) *
  ((LOGO_VIEWBOX_W - LOGO_INK_W) / 2 / LOGO_VIEWBOX_W);

const mm = (v: number) => `${v.toFixed(2)}mm`;

/** Цаасны зай (мм).  ⚠️ `routes/authorSupervision.ts`-ийн `page.pdf({margin})`
 *  ЭДГЭЭРТЭЙ ЯГ ТЭНЦҮҮ — хөлийн зурвас тэндээс, агуулгын инсет эндээс. */
export const ASR_PAGE_MARGIN_MM = { top: 14, right: 19.05, bottom: 20, left: 19.05 } as const;

const NAVY = '#0f243e';
/** Блокийн ГАДНА хүрээ — жишээн дээр хар, дотоод шугамаас зузаан. */
const BOX = '#111827';
/** Нүд хоорондын дотоод шугам. */
const RULE = '#3f4854';

/** Дэлгэц дээрх A4 хуудас хоорондын саарал зай (мм) — `AsrPagedDocument`. */
export const ASR_SHEET_GAP_MM = 8;
/**
 * Толгойн өндрийн анхны таамаг (мм) — `AsrPagedDocument` бодит өндрийг
 * хэмжихээс өмнөх нэг агшинд л.  3 мөр × 10pt × 1.32 + 1.8мм + зураас + 4мм.
 */
const HEAD_H_FALLBACK = '20.04mm';
const M = ASR_PAGE_MARGIN_MM;

/**
 * ДЭЛГЭЦ ДЭЭРХ A4 ХУУДАСЛАЛТ (эзний хүсэлт 2026-09-28: тайлан нээхэд шууд
 * хэвлэхтэй ИЖИЛ, A4-аар хуваагдсан баримт харагдана).
 *
 * Хуудаслалтыг JS тооцоолдоггүй — браузерын ӨӨРИЙН хуваах хөдөлгүүр (хэвлэхэд
 * ажилладагтай ижил LayoutNG fragmentation) хийнэ: `.asr-sheets` нь нэг
 * баганатай multicol, `column-height` = нэг хуудасны агуулгын өндөр,
 * `column-wrap: wrap` = багана бүр ШИНЭ МӨР (= шинэ хуудас) болж доош
 * жагсана.  Тиймээс `break-inside: avoid`, `break-after: avoid`, orphans /
 * widows, «гарын үсгийн блок таслагдахгүй» бүгд хэвлэлттэй ИЖИЛ шийдэгдэнэ.
 *
 * Хэвлэлтээс ялгарах ганц зүйл — multicol нь хүснэгтийн <thead>-ийг багана
 * бүрт ДАВТДАГГҮЙ (Chrome 154 дээр хэмжсэн).  Тиймээс дэлгэц дээр thead/tfoot
 * нуугдаж, толгойг хуудас бүрийн карт дээр ТУСАД НЬ зурна (`.asr-sheet-head`),
 * харин агуулгын талбайн өндөр нь хэвлэлтийнхтэй ЯГ тэнцүү:
 *   297 − дээд зай − толгой − доод зай.
 * Толгойн бодит өндрийг (`--asr-head-h`) компонент хэмжиж өгнө.
 *
 * Бүгд `@media screen` дотор — хэвлэх / серверийн PDF (print media) хуучин
 * ердийн урсгалаараа (доорх print хэсэг) хэвээр.
 */
const SHEET_STYLES = `
@media screen {
  .asr-sheets-scaler {
    width: calc(210mm * var(--asr-scale, 1));
    height: calc(var(--asr-stage-h, 297mm) * var(--asr-scale, 1));
    margin: 0 auto;
    overflow: clip;
    overflow-clip-margin: 16px;
  }
  .asr-sheets-stage {
    position: relative;
    width: 210mm;
    transform: scale(var(--asr-scale, 1));
    transform-origin: top left;
  }
  .asr-sheet-layer { position: absolute; inset: 0; }
  .asr-sheet-card {
    position: absolute;
    left: 0;
    width: 210mm;
    height: 297mm;
    background: #fff;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.14), 0 6px 18px rgba(15, 23, 42, 0.12);
  }
  /* Хуудас бүрийн толгой — хэвлэлтийн thead-ийн байр: дээд зай + доод 4мм. */
  .asr-doc.asr-sheet-head {
    position: absolute;
    top: ${M.top}mm;
    left: ${M.left}mm;
    width: 171.9mm;
    max-width: none;
    margin: 0;
    padding: 0 0 4mm;
    background: transparent;
  }
  .asr-sheets {
    position: relative;
    width: 210mm;
    box-sizing: border-box;
    padding: calc(${M.top}mm + var(--asr-head-h, ${HEAD_H_FALLBACK})) ${M.right}mm ${M.bottom}mm ${M.left}mm;
    column-count: 1;
    column-gap: 0;
    column-fill: auto;
    column-height: calc(297mm - ${M.top}mm - var(--asr-head-h, ${HEAD_H_FALLBACK}) - ${M.bottom}mm);
    column-wrap: wrap;
    /* Хуудас хоорондын зай = доод зай + саарал завсар + дараагийн хуудасны
       дээд зай + толгой.  Нийт өндөр = N×297 + (N−1)×завсар. */
    row-gap: calc(${M.bottom}mm + ${ASR_SHEET_GAP_MM}mm + ${M.top}mm + var(--asr-head-h, ${HEAD_H_FALLBACK}));
  }
  .asr-sheets .asr-page > thead,
  .asr-sheets .asr-page > tfoot { display: none; }
  /* Хэвлэлтийн @media print-ийн дүрмүүдийн дэлгэцийн ихэр. */
  .asr-sheets .asr-t tr { break-inside: avoid; page-break-inside: avoid; }
  .asr-sheets .asr-photo-sheet { break-before: column; }
}
`;

/**
 * Баримтын үндсэн CSS — дэлгэц + хэвлэлт хоёуланд.  Апп ДОТОР (засварлагчийн
 * «Баримт» горим) зөвхөн ҮҮНИЙГ оруулна (`ASR_DOC_SCREEN_STYLES`): доорх
 * print хэсэг нь `body *`, `@page` зэрэг ГЛОБАЛ дүрэмтэй тул аппын бусад
 * хуудасны хэвлэлтийг эвдэнэ.
 */
const BASE_STYLES = `
/* ⚠️ @import нь stylesheet-ийн ХАМГИЙН ЭХНИЙ дүрэм байх ЁСТОЙ — доош бүү зөө.
   Arimo (Arial-ийн хэмжээст ижил): Cloudflare Browser Rendering-ийн headless
   Chromium-д Arial БАЙХГҮЙ тул ү/ө зэрэг кирилл глиф glyph-fallback-д орж
   эвдэрдэг.  Хэрэглэгчийн браузарт энэ нь илүүдэхгүй. */
@import url('https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,700;1,400;1,700&family=Roboto+Condensed:wght@400;700&display=swap');

.asr-doc {
  color: #111827;
  background: #fff;
  font-family: Arimo, Arial, Helvetica, sans-serif;
  font-size: 10pt;
  line-height: 1.35;
  /* Цаасны агуулгын өргөн: A4 210 − зүүн/баруун 19.05мм.  Дэлгэц дээр ч
     ЯГ ЭНЭ өргөн — мөр таслалт хэвлэлттэй ижил байх ёстой (дээрх тайлбар). */
  width: 171.9mm;
  max-width: 100%;
  margin: 0 auto;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* Дэлгэц дээрх «цаас»: @page-ийн зайг padding-аар давтана, хэвлэхэд 0. */
.asr-paper {
  width: 210mm;
  max-width: 100%;
  margin: 0 auto;
  padding: ${ASR_PAGE_MARGIN_MM.top}mm ${ASR_PAGE_MARGIN_MM.right}mm ${ASR_PAGE_MARGIN_MM.bottom}mm ${ASR_PAGE_MARGIN_MM.left}mm;
  box-sizing: border-box;
  background: #fff;
}

/* ── Гадна бүрхэгч хүснэгт: thead = running толгой (хуудас бүрт давтагдана). ── */
.asr-page {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
}
.asr-page > thead > tr > th,
.asr-page > tbody > tr > td {
  border: 0;
  padding: 0;
  vertical-align: top;
  text-align: left;
  font-weight: 400;
}
.asr-page > thead > tr > th.asr-headcell { padding-bottom: 4mm; }
/* Хуудас бүрийн дээд/доод зай — дэлгэц дээр 0 (.asr-paper-ийн padding
   хангана), хэвлэхэд @media print доор. */
.asr-page > tfoot > tr > td.asr-footcell { height: 0; padding: 0; border: 0; }

/* Толгой — Word загварын header1.xml: Arial Narrow 10pt, гарчиг тод, баруун
   талд лого, доор нь бүтэн өргөний хар зураас.  Arial Narrow нь Windows-ийн
   хөтчид байдаг; Cloudflare-ийн headless Chromium-д байхгүй тул Roboto
   Condensed (дээрх @import) орлоно — хоёулаа нарийсгасан, хэмжээ ойролцоо. */
.asr-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6mm;
  padding-bottom: 1.8mm;
  border-bottom: 0.75pt solid ${BOX};
  font-family: 'Arial Narrow', 'Roboto Condensed', Arimo, Arial, sans-serif;
  color: #111827;
}
.asr-head-text {
  min-width: 0;
  font-size: 10pt;
  line-height: 1.32;
}
.asr-head-title { font-weight: 700; }
.asr-head-line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Блок: жишээний бие даасан хар хүрээтэй хайрцаг ── */
.asr-block { margin-top: 4mm; }
.asr-block:last-child { margin-bottom: 0; }

/* ── Хүснэгт ──
   separate + тэг зай: Chromium нь collapse горимд хуваагдсан хүснэгтийн
   сүүлийн мөрийг @page-ийн зайд цухуйлгадаг.  Хүрээг нүд бүрийн баруун+доод
   талд тавьж, эхний мөр / эхний баганад дээд+зүүн хүрээ өгснөөр давхар
   зураас үүсэхгүйгээр collapse-тай ижил харагдана. */
.asr-t {
  width: 100%;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
}
.asr-t td, .asr-t th {
  border-right: 0.5pt solid ${RULE};
  border-bottom: 0.5pt solid ${RULE};
  padding: 1.5mm 2mm;
  vertical-align: middle;
  text-align: left;
  font-weight: 400;
  font-size: 10pt;
  overflow: hidden;
}
.asr-t tr:first-child > * { border-top: 0.5pt solid ${RULE}; }
.asr-t tr > *:first-child { border-left: 0.5pt solid ${RULE}; }
.asr-t thead + tbody tr:first-child > * { border-top: 0; }

/* Хар ГАДНА хүрээ — жишээний блок бүр ийм зузаан хүрээтэй. */
.asr-t.asr-box { border: 0.9pt solid ${BOX}; }

.asr-t .asr-mid { vertical-align: middle; text-align: center; }
.asr-t .asr-wrap { white-space: pre-wrap; word-break: break-word; }
.asr-t .asr-strong { font-weight: 700; }
.asr-t .asr-num { font-variant-numeric: tabular-nums; }
.asr-empty { color: #9aa3b2; }

/* Шошгын нүд — хар-хөх дүүргэлт, цагаан тод 9pt, налуу цайвар англи дэд шошго. */
.asr-t .asr-lbl {
  background: ${NAVY} !important;
  color: #fff !important;
  font-weight: 700;
  font-size: 9pt;
  line-height: 1.25;
  border-right-color: #2c4260;
  border-bottom-color: #2c4260;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* Шошго БҮР зүүн талаасаа эхэлнэ (эзэн 2026-09-30) — толгойн мөрийн шошго ч
   (.asr-mid нь зөвхөн босоо голлуулалт + утгын нүдийг голлуулдаг). */
.asr-t .asr-lbl.asr-mid { text-align: left; }
.asr-lbl-mn { display: block; }
.asr-lbl-en {
  display: block;
  font-size: 7.5pt;
  font-weight: 400;
  font-style: italic;
  color: rgba(255, 255, 255, 0.72);
}
.asr-t .asr-lbl.asr-mid .asr-lbl-en { display: inline; margin-left: 1mm; }
/* Гарын үсгийн хүснэгтийн үүргийн нүд — шошго боловч зүүн тал руу. */
.asr-t .asr-lbl.asr-lbl-role { text-align: left; font-size: 9pt; }

/* ── МАЯГТ — Word загварын 12 баганат хүснэгт (эзний зураг 2026-09-28):
   Arial 9pt утга, 8pt тод цагаан шошго, нягт мөр (trHeight 180–261 twip ≈
   3.2–4.6мм), ХАР дотоод шугам, зузаан гадна хүрээ. ── */
.asr-t.asr-form { border: 1.2pt solid ${BOX}; }
.asr-t.asr-form td,
.asr-t.asr-form th {
  height: 4.4mm;
  padding: 0.5mm 1.2mm;
  font-size: 8.5pt;
  line-height: 1.25;
  border-right-color: ${BOX};
  border-bottom-color: ${BOX};
}
.asr-t.asr-form tr:first-child > * { border-top-color: ${BOX}; }
.asr-t.asr-form tr > *:first-child { border-left-color: ${BOX}; }
/* ⚠️ Сонгогч нь .asr-t.asr-form-оор эхэлнэ — эс бөгөөс дээрх
   «.asr-t.asr-form th/td» (0,2,1) нь фонтын хэмжээг дарна. */
.asr-t.asr-form .asr-flbl {
  background: ${NAVY} !important;
  color: #fff !important;
  font-weight: 700;
  font-size: 8pt;
  text-align: left;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* Төслийн нэр — загвар дээр голлуулсан, том тод. */
.asr-t.asr-form .asr-form-name { text-align: center; font-weight: 700; font-size: 10pt; }
/* Маягтын чагт — зураг дээрх шиг бүх бичвэр ХАР, энгийн жинтэй (хайрцаг л
   ялгана).  Нүд нарийн (≈20мм, загварын 1149 twip) тул 7.5pt + жижиг
   хайрцаг/зай — «Ажлын зураг» нэг мөрт багтана (8pt-д хоёр мөр болдог — хэмжсэн; чагтын зай нь зөвхөн доорх «+» дүрмээр); багтахгүй бол ТАСРАХГҮЙ,
   дараагийн мөрөнд ороно. */
.asr-t.asr-form td.asr-cbcell { padding-left: 0.4mm; padding-right: 0.2mm; font-size: 7.5pt; }
.asr-form .asr-check {
  margin: 0;
  gap: 0.5mm;
  color: #111827;
  font-weight: 400;
  white-space: normal;
  align-items: flex-start;
}
.asr-form .asr-check--on { font-weight: 400; }
/* Зай нь ЗӨВХӨН хоёр чагтын ХООРОНД (нэмэлт багууд) — ганц чагтын баруун
   зай мөрийн өргөнд тооцогдож «Ажлын зураг»-ийг хоёр мөр болгож байв. */
.asr-form .asr-check + .asr-check { margin-left: 1.2mm; }
.asr-form .asr-cb { width: 2.3mm; height: 2.3mm; margin-top: 0.25mm; }
/* Хяналтын төрөл (0362) — бүтэн өргөний нэг нүдэнд 4 чагт, хооронд нь зай. */
.asr-t.asr-form td.asr-typecell .asr-check + .asr-check { margin-left: 5mm; }
.asr-form .asr-check--on .asr-cb::after { left: 0.72mm; top: 0.18mm; width: 0.6mm; height: 1.25mm; }

/* ── CSS checkbox (фонтоос хамааралгүй) ── */
.asr-checks { line-height: 1.3; }
.asr-check {
  display: inline-flex;
  align-items: center;
  gap: 1.3mm;
  margin: 0.5mm 4.5mm 0.5mm 0;
  color: #6b7280;
  white-space: nowrap;
}
.asr-check--on { color: #111827; font-weight: 700; }
.asr-cb {
  display: inline-block;
  width: 3.2mm;
  height: 3.2mm;
  box-sizing: border-box;
  border: 0.5pt solid #6b7280;
  background: #fff;
  position: relative;
  flex: none;
}
.asr-check--on .asr-cb {
  background: ${NAVY};
  border-color: ${NAVY};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* Цагаан хачиг — хоёр хүрээтэй тэгш өнцөгтийг 45° эргүүлж зурна. */
.asr-check--on .asr-cb::after {
  content: '';
  position: absolute;
  left: 1.05mm;
  top: 0.35mm;
  width: 0.8mm;
  height: 1.7mm;
  border: solid #fff;
  border-width: 0 0.5mm 0.5mm 0;
  transform: rotate(45deg);
}

/* «Шалгасан» / «Баталсан» — нэр + гарын үсэг (компанийн ТАМГА энд гарахгүй). */
.asr-t .asr-checked { text-align: left; }
.asr-checked img {
  display: block;
  max-height: 13mm; max-width: 38mm; width: auto;
  margin: 0.5mm 0 -0.4mm;
  object-fit: contain;
  mix-blend-mode: multiply;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.asr-t .asr-approved { vertical-align: middle; }

/* ── АЖЛЫН ТАЙЛАН — жишээний 3-р блок: НЭГ хар хүрээтэй хайрцаг, дотор нь
   хар-хөх тууз → багийн чагт → бие.  Агуулга урт бол хуудсаар үргэлжилнэ
   (гадна хүрээ нь хэсгүүдэд хуваагдана — энэ нь зөв зан төлөв). ── */
.asr-block--work { border: 0.9pt solid ${BOX}; }
.asr-band {
  display: flex;
  align-items: baseline;
  gap: 2mm;
  padding: 1.4mm 2mm;
  background: ${NAVY};
  color: #fff;
  border-bottom: 0.5pt solid ${RULE};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  /* Тууз агуулгаасаа салж хуудасны ёроолд ганцаараа үлдэхгүй. */
  break-after: avoid;
  page-break-after: avoid;
}
.asr-band-mn { font-size: 10.5pt; font-weight: 700; letter-spacing: 0.01em; }
.asr-band-en { font-size: 8pt; font-style: italic; color: rgba(255, 255, 255, 0.72); }
.asr-workteams {
  /* Багийн мөр бичих талбайгаасаа салж хуудас хооронд хуваагдахгүй. */
  break-after: avoid;
  page-break-after: avoid;
  padding: 1.3mm 2mm;
  border-bottom: 0.5pt solid ${RULE};
  background: #f1f4f8;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.asr-workbody {
  /* Хоосон тайланд ч гараар бичих зай үлдэнэ; агуулга урт бол өснө. */
  min-height: 52mm;
  padding: 2.5mm 2.5mm 2mm;
}
/* Биеийн бичвэр — жишээний хэв маягаар НАЛУУ. */
.asr-p {
  font-style: italic;
  margin: 0 0 2.2mm;
  orphans: 2;
  widows: 2;
}
.asr-p:last-child { margin-bottom: 0; }
/* «Хяналтаар гарсан шийдвэрлэх асуудлууд:» — тод-налуу дэд гарчиг. */
.asr-wh {
  break-after: avoid;
  page-break-after: avoid;
  margin: 3mm 0 1.4mm;
  font-size: 10pt;
}
.asr-wh-mn { font-weight: 700; font-style: italic; color: ${NAVY}; }
.asr-wh-en { font-size: 8pt; font-style: italic; color: #6b7280; }
/* Багийн тэмдэглэл — код + бичвэр. */
.asr-note { display: flex; gap: 2.5mm; margin-bottom: 2.2mm; orphans: 2; widows: 2; }
.asr-note-team {
  flex: 0 0 11mm;
  align-self: flex-start;
  padding: 0.3mm 0;
  text-align: center;
  font-size: 8pt;
  font-weight: 700;
  font-style: normal;
  color: #fff;
  background: ${NAVY};
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.asr-note-text { flex: 1 1 auto; min-width: 0; margin-bottom: 0; }
/* «Шийдсэн: ASR-007 · 2026.09.20 — …» — энэ тайлангийн асуудлыг шийдсэн
   дараагийн тайлангууд (сервер гарган авна). */
.asr-resolved-in { margin: 1.5mm 0 2.2mm; padding: 0 0 0 4mm; font-size: 9pt; color: #374151; }
.asr-resolved-in li { margin: 0.5mm 0; }
.asr-resolved-in-k { font-weight: 700; color: #1a7f4b; }
/* Шийдлийн хүснэгт — биеийн дотор. */
.asr-t.asr-res { margin-top: 0.5mm; }
.asr-t.asr-res td { vertical-align: top; font-style: italic; }
.asr-t.asr-res .asr-res-ref { font-size: 9pt; font-style: normal; }
/* Оффис уулзалтын хүсэлтийн хүснэгт (0396) — эзний Word тэмдэглэлийн хэлбэр:
   «0.1 Захиалагч» тод гарчиг, цагаан тод толгой, нэгтгэсэн «Хүсэлт гаргагч»,
   хар-хөх хөлийн мөр. */
.asr-req { margin: 0 0 4mm; }
/* «Тайлбар: …» — тод шошго + энгийн (налуу биш) бичвэр. */
.asr-meet-note { font-size: 10.5pt; line-height: 1.6; margin: 3mm 0 0; text-align: justify; white-space: pre-wrap; word-break: break-word; }
.asr-meet-note-k { font-weight: 700; }
/* Мөр / «Тайлбар»-ын ард хавсаргасан зураг — бичвэрийн доор, 2 хүртэл зэрэгцэнэ. */
.asr-item-imgs { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 1.5mm; }
.asr-item-imgs img {
  display: block;
  max-width: calc(50% - 1mm);
  max-height: 55mm;
  width: auto;
  height: auto;
  object-fit: contain;
  border: 0.3pt solid #cbd5e1;
  break-inside: avoid;
  page-break-inside: avoid;
}
.asr-item-imgs img:only-child { max-width: 100%; max-height: 80mm; }
/* Зурагтай мөр өндөр болдог — бүтэн мөрийг дараагийн хуудас руу түлхвэл том хоосон
   зай үлддэг тул ЗӨВХӨН ийм мөрийг хуваахыг зөвшөөрнө (зураг өөрөө хуваагдахгүй). */
.asr-t.asr-req-t tr:has(.asr-item-imgs) { break-inside: auto; page-break-inside: auto; }
/* «Хүсэлт гаргагч»-ийг rowspan-гүйгээр нэгтгэсэн мэт: дараагийн мөртэйгээ дундаа шугамгүй. */
.asr-t.asr-req-t td.asr-req-by--open { border-bottom-color: transparent; }
.asr-t.asr-req-t td.asr-req-by { vertical-align: top; padding-top: 3mm; }
/* ── Оффис уулзалтын хөл (2026-10-12): оролцогч бүр байгууллага + албан тушаал,
   нэр ……, захиалагчийн төлөөлөгч, огноо.  Хүрээгүй, хуудас хооронд таслагдахгүй. ── */
.asr-mf { margin-top: 7mm; font-size: 10.5pt; line-height: 1.55; }
.asr-mf-head { font-weight: 700; margin: 0 0 2.5mm; break-after: avoid; page-break-after: avoid; }
.asr-mf-head--client { margin-top: 6mm; }
.asr-mf-person { margin: 0 0 3.5mm; break-inside: avoid; page-break-inside: avoid; }
.asr-mf-line { display: flex; align-items: flex-end; gap: 1.5mm; }
.asr-mf-line > span:first-child { flex: 0 1 auto; }
/* Гарын үсгийн мөр: цэгтэй шугам, гарын үсэг (тунгалаг PNG, жигд хэмжээ —
   HandSignature fitToInk="document") шугамын ДЭЭР голдоо, доод хэсэг нь шугамыг
   бага зэрэг давна — хүн цаасан дээр мөрөн дээр зурдаг шиг.  Урсгалаас гадуур
   (absolute) тул мөрийн өндрийг өөрчлөхгүй. */
.asr-mf-dots {
  position: relative;
  flex: 0 0 55mm;
  height: 1.1em;
  border-bottom: 1.2pt dotted #111827;
  margin-bottom: 0.35em;
}
.asr-mf-dots img {
  position: absolute;
  left: 50%;
  bottom: -2.5mm;
  transform: translateX(-50%);
  max-width: none;
  object-fit: contain;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/* Гарын үсэг дээшээ ~10мм цухуйна — хүмүүсийн хоорондын зай түүнийг багтаана. */
.asr-mf-person:has(.asr-mf-dots img) { padding-top: 8mm; }
.asr-mf-date { margin-top: 8mm; font-variant-numeric: tabular-nums; }
.asr-req:last-child { margin-bottom: 0; }
.asr-req-head {
  font-weight: 700;
  font-size: 10.5pt;
  margin: 0 0 1.4mm;
  break-after: avoid;
  page-break-after: avoid;
}
.asr-req-intro { font-size: 10pt; margin: 0 0 1.6mm 4mm; break-after: avoid; page-break-after: avoid; }
.asr-t.asr-req-t { border: 0.9pt solid ${BOX}; }
.asr-t.asr-req-t th, .asr-t.asr-req-t td { font-style: normal; }
.asr-t.asr-req-t .asr-req-th { font-weight: 700; text-align: center; font-size: 10pt; }
.asr-t.asr-req-t td { font-size: 10pt; vertical-align: middle; }
.asr-t.asr-req-t tr.asr-req-foot td {
  height: 6mm;
  border-right-color: #2c4260;
  padding: 0;
  background: ${NAVY} !important;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── ГАРЫН ҮСЭГ — жишээний 4-р блок.  Хуудас хооронд таслагдахгүй.  (Лого
   2026-09-28-наас толгойд.) ── */
.asr-block--sign {
  break-inside: avoid;
  page-break-inside: avoid;
}
.asr-t.asr-sign tbody td, .asr-t.asr-sign tbody th { height: 15mm; }
/* Оффис уулзалтын «Манай тал» — нэрийн дээр албан тушаал (эзэн 2026-10-08). */
.asr-sign-pos { font-size: 8pt; color: #4b5563; line-height: 1.25; margin-bottom: 0.6mm; }
.asr-t .asr-sig { text-align: center; vertical-align: bottom; padding-bottom: 1.5mm; }
.asr-sig img {
  display: block;
  max-height: 15mm; max-width: 40mm; width: auto;
  margin: 0.4mm auto -0.6mm;
  object-fit: contain;
  mix-blend-mode: multiply;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/* Толгойн лого.  Ink нь ЯГ ${LOGO_INK_H_MM}мм өндөр болж эзэлнэ (дээрх
   тайлбарыг үз): зургийг томсгоод эргэн тойрны хоосон зайг сөрөг зайгаар
   хасав.  overflow: hidden нь ЗААВАЛ — зурагдах талбай layout хайрцгаасаа
   цухуйдаг.  Саарал өнгө — лавлагаа баримтын толгойн логотой ижил. */
.asr-logo-box { flex: 0 0 auto; overflow: hidden; line-height: 0; margin-top: 0.3mm; }
.asr-logo {
  height: ${mm(LOGO_IMG_H_MM)};
  width: auto;
  max-width: none;
  display: block;
  margin: ${mm(-LOGO_MARGIN_Y_MM)} ${mm(-LOGO_MARGIN_X_MM)};
  opacity: 0.55;
}

/* ── Улаан дэвтэр — зураг нь мөрийг хуудасны хагасаас илүү идэхгүй (өндрийн
   тааз), эс бөгөөс босоо утасны зураг бүтэн хуудас болж дараагийнх руу
   түлхэнэ. ── */
.asr-block--redbook { break-inside: avoid; page-break-inside: avoid; }
.asr-redbook-photocell { padding: 1.5mm !important; text-align: center; }
.asr-redbook-photo { max-height: 90mm; max-width: 100%; object-fit: contain; }

/* ── Зураг — ХУУДАС ТУС БҮРД 4 (2×2), тайлбартай (0336, эзэн 2026-09-23-нд
   ХЭВЭЭР ҮЛДЭЭХИЙГ ил баталсан).
   .asr-photo-sheet = нэг хуудас: ҮРГЭЛЖ шинэ хуудаснаас эхэлнэ (хавсралт
   нь баримтын ТӨГСГӨЛД — 4 зургийн хуудас бүтэн хуудас эзэлдэг тул текстийн
   дунд байрлуулбал өмнөх хуудасны тал нь хоосон үлддэг байв) ба дотроо
   хуваагдахгүй.  Зургийн хайрцаг ТОГТМОЛ өндөртэй (66мм) + contain: босоо
   утасны зураг тайрагдахгүй, 2 мөр × (66 + тайлбар ≤ 14) + зай ≈ 165мм нь
   толгойтой хуудсанд (≈ 223мм) 3 мөрт тайлбартай ч багтана.
   background-image БИШ <img>: Chrome хэвлэхэд дэвсгэр зургийг хаядаг. ── */
.asr-block--photos { break-inside: auto; page-break-inside: auto; margin-top: 0; }
.asr-photo-sheet {
  break-before: page;
  page-break-before: always;
  break-inside: avoid;
  page-break-inside: avoid;
}
/* Хуудас бүрийн толгойн доорх «Төслийн нэр | …» мөр — жишээний зургийн
   хуудасны яг тэр хэлбэр (running толгойд төслийн нэр байдаггүй). */
.asr-t.asr-photohead { margin-bottom: 3mm; }
.asr-photo-sheet-no { text-align: right; font-size: 8.5pt; color: #6b7280; }
.asr-photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4mm; }
.asr-photo {
  margin: 0;
  min-width: 0;
  break-inside: avoid;
  page-break-inside: avoid;
}
.asr-photo-box {
  position: relative;
  height: 66mm;
  overflow: hidden;
  border: 0.5pt solid ${BOX};
  background: #f3f5f8;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/* Зургийн ӨӨРИЙН хүрээ — тэмдэг нь хайрцгийн саарал зайд биш, ЗУРАГ ДЭЭР
   (баруун доод буланд) суух ёстой (эзний хүсэлт 2026-09-25).  Босоо зураг
   хайрцагт contain-оор багтахад хоёр талдаа саарал зай үлддэг тул тэмдгийг
   хайрцагт биш, зургийн хэмжээтэй тэнцэх энэ хүрээнд байрлуулна. */
.asr-photo-frame {
  position: relative;
  max-width: 100%;
  max-height: 100%;
  line-height: 0;
}
.asr-photo-frame img {
  display: block;
  max-width: 100%;
  max-height: calc(66mm - 1pt);
  width: auto;
  height: auto;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/* Тэмдэг: зургийн БАРУУН ДООД буланд «2026.09.21 14:35:09» + төслийн нэр
   (photoStamp.ts).  Дугаар нь тэмдэгт БИШ — доорх тайлбарын мөрөнд. */
.asr-photo-stamp {
  position: absolute;
  right: 0;
  bottom: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 0.6mm 1.5mm;
  text-align: right;
  font-size: 6.5pt;
  line-height: 1.25;
  color: #fff;
  background: rgba(0, 0, 0, 0.58);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.asr-photo-when { display: block; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
.asr-photo-project {
  display: block;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  opacity: 0.95;
}
/* Тайлбар — зургийн ДООР: дугаар + бичвэр (3 мөр хүртэл), хоосон бол гараар
   бичих зураас.  Жишээнд хуудсанд НЭГ тайлбар байдаг; бидэнд ЗУРАГ БҮРД —
   энэ нь илүү нарийн мэдээлэл тул буурахгүй (эзний 2026-09-23-ны заавар). */
.asr-photo figcaption {
  display: flex;
  gap: 1.8mm;
  align-items: flex-start;
  margin-top: 1.4mm;
  min-height: 6mm;
  font-size: 8.5pt;
  line-height: 1.3;
  font-style: italic;
  color: #111827;
}
.asr-photo-cap-no {
  flex: none; font-weight: 700; font-style: normal;
  color: ${NAVY}; font-variant-numeric: tabular-nums;
}
.asr-photo-cap-text {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.asr-photo-cap-empty { color: #9aa3b2; font-style: normal; }
/* ── Оффис уулзалт (0367, эзэн 2026-09-30): хавсралт нь ЯГ НЭГ ТОМ зураг —
   хуудсанд 1, бүтэн өргөнөөр.  Хайрцаг нь тогтмол 66мм биш, зургийн өндрөөр
   (≤ 185мм: толгой ≈ 223мм − «Төслийн нэр» мөр − тайлбар), тиймээс хөндлөн
   зурагт саарал зурвас үлдэхгүй.  Тайлбар = автомат тэмдэг (нэр · огноо цаг). ── */
.asr-photos--single { grid-template-columns: 1fr; }
.asr-photo--single .asr-photo-box { height: auto; max-height: 185mm; background: none; }
.asr-photo--single .asr-photo-frame img { max-height: calc(185mm - 1pt); }
.asr-photo--single .asr-photo-stamp { font-size: 8pt; padding: 0.8mm 2mm; }
.asr-photo--single figcaption { justify-content: center; font-size: 9.5pt; }
${SHEET_STYLES}`;

/** Зөвхөн хэвлэх хуудсанд (`AsrPrintPage`) — глобал `@page` + print дүрэм. */
const PRINT_STYLES = `
@media print {
  /* index.css нь \`body *\` бүгдийг нууж, зөвхөн .print-area-г харуулдаг.
     Энэ мөргүйгээр БҮРЭН ХООСОН хуудас хэвлэгдэнэ. */
  body, body * { visibility: visible !important; }
  .asr-print-toolbar { display: none !important; }
  /* @page-ийн зай 0 (доор) — цаасны зайг энд: хажуу нь padding, дээд/доод нь
     хуудас бүрт давтагдах thead/tfoot. */
  .asr-paper {
    width: auto; max-width: none; margin: 0;
    padding: 0 ${ASR_PAGE_MARGIN_MM.right}mm 0 ${ASR_PAGE_MARGIN_MM.left}mm;
  }
  /* Дэлгэцийн A4 хуудаслалт хэвлэхэд ҮГҮЙ — ердийн урсгал, .asr-paper-тай
     ижил хажуугийн зай; хуудас бүрийн толгой нь дахин thead. */
  .asr-sheet-layer { display: none !important; }
  .asr-sheets {
    padding: 0 ${ASR_PAGE_MARGIN_MM.right}mm 0 ${ASR_PAGE_MARGIN_MM.left}mm;
  }
  .asr-page > thead > tr > th.asr-headcell { padding-top: ${ASR_PAGE_MARGIN_MM.top}mm; }
  .asr-page > tfoot > tr > td.asr-footcell { height: ${ASR_PAGE_MARGIN_MM.bottom}mm; }
  /* Мөрүүд хуудсаар хуваагдахгүй. */
  .asr-t tr { break-inside: avoid; page-break-inside: avoid; }
}

/* CSS @page — серверийн PDF (preferCSSPageSize) ба хөтчийн print хоёуланд.
   ⚠️ margin 0 ЗОРИУД — браузерын огноо / URL / хуудасны дугаар гарахгүй
   (дээрх тайлбар).  routes/authorSupervision.ts-ийн page.pdf margin мөн 0. */
@page {
  size: A4 portrait;
  margin: 0;
}
`;

/** Апп доторх «Баримт» горим — глобал print/@page дүрэмгүй. */
export const ASR_DOC_SCREEN_STYLES = BASE_STYLES;

/** Хэвлэх хуудас (`AsrPrintPage`) — дэлгэц + хэвлэлт + серверийн PDF. */
export const ASR_DOC_STYLES = BASE_STYLES + PRINT_STYLES;
