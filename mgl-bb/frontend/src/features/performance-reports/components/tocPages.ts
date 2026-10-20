/* =============================================================
 * computeTocPages — best-effort physical page numbers for the TOC.
 * -------------------------------------------------------------
 * Chromium doesn't expose CSS `target-counter`, so in a single-pass
 * render we can't ask "which printed A4 does this section land on?".
 * Instead we measure: every top-level report block (.perf-cover /
 * .perf-page) carries `page-break-after: always`, so each starts a
 * fresh physical page. A block therefore spans
 * `ceil(contentHeight / H)` A4 sheets (cover = 1, full-bleed), and we
 * accumulate start pages across blocks. An anchored sub-section
 * (`data-toc`) lands on its block's start page plus how far down the
 * block it sits.
 *
 * Heights are measured with `min-height` neutralised so they match the
 * print layout (`@media print .perf-page { min-height: 0 }`) rather
 * than the on-screen 297mm boxes. Accurate to ±1 page for very tall
 * sections whose internal break-inside:avoid blocks force an early
 * page break — good enough for a contents page.
 * ============================================================= */

import { CONTENT_H_MM } from '@/features/performance-reports/components/A4Paginator';

/* A4-ийн хэвлэгдэх агуулгын хайрцгийн ӨНДӨР, CSS px (1mm = 96/25.4 px).
 *
 * ⚠️ Урьд нь энд «297 − 22 − 15» гэж ГАРААР бичигдсэн байсан бөгөөд тэр нь
 * @page / puppeteer-ийн ХУУЧИН зайтай уягдсан байв.  Жишиг .docx-ийн
 * `w:sectPr` (дээд 16.7 · доод 23.88mm) руу шилжсэний дараа энэ тоо ганцаараа
 * хоцорч, агуулгын нэгжийн өндөр 260mm гэж тооцогдоод хуудасны дугаар
 * бодитоос зөрдөг байсан.  Одоо `A4Paginator.PAGE_PAD` — дэлгэцийн
 * хуудаслалттай ЯГ нэг эх сурвалжаас гарна. */
const PAGE_CONTENT_PX = CONTENT_H_MM * (96 / 25.4); // 256.42mm ≈ 969.2px

export function computeTocPages(shell: HTMLElement): Record<string, number> {
  const blocks = Array.from(
    shell.querySelectorAll<HTMLElement>('.perf-cover, .perf-page'),
  );
  if (blocks.length === 0) return {};

  // Neutralise min-height so offsetHeight reflects true content height
  // (matches the print layout). Saved + restored so the on-screen
  // preview isn't left collapsed.
  const savedMinHeight = blocks.map((b) => b.style.minHeight);
  blocks.forEach((b) => {
    b.style.minHeight = '0px';
  });
  void shell.offsetHeight; // force a single reflow

  const map: Record<string, number> = {};
  let page = 1;
  for (const block of blocks) {
    const startPage = page;
    const blockTop = block.getBoundingClientRect().top;

    const anchors: HTMLElement[] = [];
    if (block.hasAttribute('data-toc')) anchors.push(block);
    anchors.push(...Array.from(block.querySelectorAll<HTMLElement>('[data-toc]')));
    for (const a of anchors) {
      const id = a.getAttribute('data-toc');
      if (!id) continue;
      const offsetWithin = Math.max(0, a.getBoundingClientRect().top - blockTop);
      map[id] = startPage + Math.floor(offsetWithin / PAGE_CONTENT_PX);
    }

    const span = block.classList.contains('perf-cover')
      ? 1
      : Math.max(1, Math.ceil(block.offsetHeight / PAGE_CONTENT_PX));
    page += span;
  }

  blocks.forEach((b, i) => {
    b.style.minHeight = savedMinHeight[i] ?? '';
  });

  return map;
}
