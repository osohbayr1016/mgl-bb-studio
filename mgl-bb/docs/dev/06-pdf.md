# §06 · PDF гаргах 3 зам (эндүүрдэг!)

Хамгийн олон эндүүрдэг зүйл: MGL-д PDF гаргах **3 тусдаа** pipeline бий, тус тусын зорилготой.

| Зам | Binding | Юунд | Онцлог |
|-----|---------|------|--------|
| **Browser Rendering** (puppeteer) | `BROWSER` | Дотоод perf-report, хурал, project print | Жинхэнэ Chromium frontend-ийн `/print` route-ыг ачаална |
| **WeasyPrint** контейнер | `WEASYPRINT_SVC` | Client design-progress тайлан | JS **ажиллуулдаггүй** — chart заавал static SVG байх ёстой |
| **Stirling-PDF** | `STIRLING_SVC` | Post-process (page number, watermark, compress, нууц үг) | Тохиргоо байхгүй бол товч нуугдана |

## Browser Rendering-ийн print pattern

1 минутын signed print JWT гаргана → headless Chromium frontend-ийн `/print` route руу (`?t=<jwt>` нь `localStorage` руу гүүрлэгдэнэ) → `body[data-print-ready="true"]`-г хүлээнэ → `page.pdf()`.

Тиймээс print route нь **2 контекстэд** ажиллах ёстой: сервер render + хэрэглэгчийн `window.print()`. **Auth-ээс хамаарсан loading spinner бүү тавь.** Repeating header/footer (page number, doc no., logo) template-ээр ордог. DOCX зам нэмэлтээр recharts SVG-г PNG болгож rasterize хийгээд `html-to-docx`-ыг lazy import хийдэг.

## WeasyPrint vs Browser Rendering

- **WeasyPrint** = server талд static HTML render (recharts/JS үгүй, Pango/Cairo). Chart заавал static SVG/CSS.
- **Browser Rendering** = амьд React print хуудсыг жинхэнэ Chromium-аар.

2 өөр HTML pipeline, 2 өөр тайлангийн загвар. `lib/clientReportRender.ts` нь маршрут ба `generate_report` MCP tool хоёулаа адилхан байтаар гаргахын тулд импортлогдоно (byte-identical output).

## Гол код

- `routes/performanceReports.ts` (`/api/projects` дор mount), `routes/reportTemplates.ts`, `routes/pdfTools.ts`
- `lib/clientReport*.ts`, `lib/weasyprint.ts`, `lib/stirling.ts`
- Frontend print хуудсууд: `features/projects/ProjectPrintPage.tsx`, `features/performance-reports/PerformanceReportPrintPage.tsx`, `features/meeting-notes/MeetingPrintPage.tsx`, `features/quotes/QuotePrintPage.tsx`
