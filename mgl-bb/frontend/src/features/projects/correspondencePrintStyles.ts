/**
 * RFI / CR бичгийн хэвлэлтийн CSS — ASR-ийн (`asr/asrPrintStyles.ts`) хэв маяг:
 * A4 босоо, Arimo 10pt, хар-хөх шошгын нүд, running толгой thead-д.
 *
 * ⚠️ Цаасны зай нь backend `lib/correspondencePdf.ts`-ийн `PAGE_MARGIN`-тэй
 *    ЗААВАЛ ТЭНЦҮҮ (14 / 19.05 / 20 / 19.05 мм) — хөлийг puppeteer зурдаг тул
 *    зөрвөл хөл агуулга дээр буудаг (ASR/перф тайланд хэмжсэн).
 *
 * Компонентын файлаас тусдаа байгаа нь Fast Refresh-ийн шаардлага; `@page`
 * дүрэм `index.css`-ийн дараа орох баталгаагүй тул `<style>`-ээр биед оруулна.
 */
export const CORR_PAGE_MARGIN_MM = { top: 14, right: 19.05, bottom: 20, left: 19.05 } as const;

const NAVY = '#0f243e';
const RULE = '#b8c0cc';

/* Логоны ink-ийн хүрээ — asrPrintStyles.ts-ийн ижил тооцоо (12 мм өндөр). */
const LOGO_VIEWBOX_W = 1920;
const LOGO_VIEWBOX_H = 1080;
const LOGO_INK_W = 455;
const LOGO_INK_H = 349;
const LOGO_INK_H_MM = 12;
const LOGO_IMG_H_MM = (LOGO_INK_H_MM * LOGO_VIEWBOX_H) / LOGO_INK_H;
const LOGO_MARGIN_Y_MM = (LOGO_IMG_H_MM * ((LOGO_VIEWBOX_H - LOGO_INK_H) / 2)) / LOGO_VIEWBOX_H;
const LOGO_MARGIN_X_MM =
  ((LOGO_IMG_H_MM * LOGO_VIEWBOX_W) / LOGO_VIEWBOX_H) *
  ((LOGO_VIEWBOX_W - LOGO_INK_W) / 2 / LOGO_VIEWBOX_W);
const mm = (v: number) => `${v.toFixed(2)}mm`;

export const CORR_DOC_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Arimo:ital,wght@0,400;0,700;1,400&display=swap');

@page {
  size: A4 portrait;
  margin: ${CORR_PAGE_MARGIN_MM.top}mm ${CORR_PAGE_MARGIN_MM.right}mm ${CORR_PAGE_MARGIN_MM.bottom}mm ${CORR_PAGE_MARGIN_MM.left}mm;
}

.corr-doc {
  color: #111827;
  background: #fff;
  font-family: Arimo, Arial, Helvetica, sans-serif;
  font-size: 10pt;
  line-height: 1.4;
  width: 171.9mm;
  max-width: 100%;
  margin: 0 auto;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.corr-paper {
  width: 210mm;
  max-width: 100%;
  margin: 0 auto;
  padding: ${CORR_PAGE_MARGIN_MM.top}mm ${CORR_PAGE_MARGIN_MM.right}mm ${CORR_PAGE_MARGIN_MM.bottom}mm ${CORR_PAGE_MARGIN_MM.left}mm;
  box-sizing: border-box;
  background: #fff;
}
@media print {
  .corr-paper { padding: 0; width: auto; }
  .corr-toolbar { display: none !important; }
}

.corr-page { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.corr-page > thead > tr > th, .corr-page > tbody > tr > td {
  border: 0; padding: 0; vertical-align: top; text-align: left; font-weight: 400;
}
.corr-page > thead > tr > th.corr-headcell { padding-bottom: 5mm; overflow: hidden; }
.corr-head {
  display: flex; align-items: flex-start; gap: 6mm;
  padding-bottom: 3mm; border-bottom: 2pt solid ${NAVY};
}
.corr-head-main { flex: 1 1 auto; min-width: 0; }
.corr-head-title { font-size: 15pt; font-weight: 700; line-height: 1.2; color: ${NAVY}; letter-spacing: -0.01em; }
.corr-head-no { color: #c0392b; }
.corr-head-sub { font-size: 8.5pt; font-style: italic; color: #6b7280; margin-top: 0.5mm; }
.corr-head-project { margin-top: 2mm; font-size: 8.5pt; font-weight: 700; text-transform: uppercase; color: #374151; letter-spacing: 0.02em; }
.corr-head-meta { flex: 0 0 auto; text-align: right; font-size: 8.5pt; line-height: 1.5; color: #374151; white-space: nowrap; padding-top: 0.5mm; }
.corr-head-k { color: #6b7280; }
.corr-logo {
  height: ${mm(LOGO_IMG_H_MM)}; width: auto; max-width: none;
  margin: ${mm(-LOGO_MARGIN_Y_MM)} ${mm(-LOGO_MARGIN_X_MM)}; flex: none;
}

.corr-section { margin-bottom: 6mm; }
.corr-section:last-child { margin-bottom: 0; }
.corr-section-title {
  break-after: avoid; page-break-after: avoid;
  display: flex; align-items: baseline; gap: 2mm; margin: 0 0 2mm;
  font-size: 11.5pt; font-weight: 700; color: ${NAVY};
}
.corr-section-en { font-size: 8.5pt; font-weight: 400; font-style: italic; color: #6b7280; }

.corr-t { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 0; }
.corr-t td, .corr-t th {
  border-right: 0.5pt solid ${RULE}; border-bottom: 0.5pt solid ${RULE};
  padding: 1.8mm 2.2mm; vertical-align: middle; text-align: left; font-weight: 400; font-size: 10pt;
  overflow: hidden; word-break: break-word;
}
.corr-t tr:first-child > * { border-top: 0.5pt solid ${RULE}; }
.corr-t tr > *:first-child { border-left: 0.5pt solid ${RULE}; }
.corr-t .corr-wrap { white-space: pre-wrap; }
.corr-t .corr-lbl {
  background: ${NAVY} !important; color: #fff !important; font-weight: 700; font-size: 9pt; line-height: 1.3;
  border-right-color: #2c4260; border-bottom-color: #2c4260;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.corr-lbl-mn { display: block; }
.corr-lbl-en { display: block; font-size: 7.5pt; font-weight: 400; font-style: italic; color: rgba(255,255,255,0.72); }

.corr-body {
  border: 0.5pt solid ${RULE}; padding: 3mm; min-height: 40mm;
  white-space: pre-wrap; word-break: break-word;
}

/* ── Гарын үсгийн блок ── */
.corr-sign { break-inside: avoid; page-break-inside: avoid; }
.corr-sign-cell { vertical-align: top; height: 42mm; }
.corr-sign-who { font-weight: 700; color: ${NAVY}; }
.corr-sign-role { font-size: 8.5pt; color: #6b7280; font-style: italic; }
.corr-sign-img-box { height: 18mm; display: flex; align-items: flex-end; margin: 2mm 0 1mm; }
.corr-sign-img { max-height: 18mm; max-width: 60mm; object-fit: contain; }
.corr-sign-line { border-top: 0.5pt solid #374151; margin-top: 1mm; padding-top: 1mm; font-size: 8.5pt; color: #374151; }
.corr-sign-pending { color: #b45309; font-style: italic; font-size: 9pt; }
.corr-sign-missing { color: #9ca3af; font-style: italic; font-size: 9pt; }
`;
