/* =============================================================
 * CSS for the project-wide Гүйцэтгэлийн тайлан PDF.
 * -------------------------------------------------------------
 * Injected once at the top of PerformanceReportPrintPage via a
 * <style> tag.  Class names are prefixed `perf-` so they don't
 * collide with the per-team document styles (BA_REPORT_STYLES
 * etc.) that ride along for the per-team sections.
 *
 * The PDF is rendered by Cloudflare Browser Rendering with
 * `margin: 0` so the cover page can be full-bleed navy.
 *
 * ⚠️ `.perf-page` is NOT an A4 sheet — it is a "section that starts on a
 * new page". Its size and inner padding come from A4Paginator's `.a4-flow`
 * wrapper on screen, and from the `@page` margin (plus the print-only side
 * padding below) when Chromium paginates. See the `.perf-page` block.
 *
 * ⚠️ ДООРХ ТЕМПЛЕЙТ ЛИТЕРАЛ ДОТОР BACKTICK-ГҮЙ БИЧНЭ.  Тайлбар дотор ч
 * гэсэн ` тэмдэг тавибал мөрийг тасалж, TS1005 алдаа өгнө.  Код/классын
 * нэрийг «guillemet» дотор бич.
 * ============================================================= */

export const PERFORMANCE_REPORT_STYLES = `
/* Arimo — a metric-compatible Arial alternative with full Cyrillic Extended
 * coverage (ү U+04AF, ө U+04E9 …). Cloudflare Browser Rendering's headless
 * Chromium has no "Arial" installed, so it fell back per-glyph for the
 * Mongolian-specific letters and they rendered inconsistently in the PDF.
 * Loading Arimo as a web font (and forcing it below) makes every glyph use
 * one consistent face while keeping the Arial look. @import must stay first. */
@import url('https://fonts.googleapis.com/css2?family=Arimo:wght@400;700&display=swap');
/* Page margins MUST be declared in CSS @page (not only via puppeteer's
 * margin option): once any @page rule exists, Chromium uses the CSS page
 * model and the puppeteer margin no longer insets the *content* — it only
 * positions the header/footer templates. That mismatch let content fill the
 * full sheet and overlap the repeating header/footer band. So we set the
 * margin here so content insets into the same box the header/footer sit
 * outside of.  The navy cover overrides back to 0 via @page :first below.
 *
 * ⚠️ ЭНЭ ТОО НЬ «A4Paginator.PAGE_PAD»-ТАЙ ТЭНЦҮҮ БАЙХ ЁСТОЙ (16.7 / 23.88).
 * Дэлгэцийн paginator агуулгыг 256.42mm тутамд тасалдаг; хэрэв @page 22/15
 * (=260mm) хэвээр байвал Chromium 3.58mm ХОЖУУ тасалж, хуудас тутамд алдаа
 * хуримтлагдан «дэлгэц дээр харсан нь PDF-тэй тэнцүү» гэсэн бүх санаа нурна.
 *
 * ⚠️ BACKEND-ИЙН «page.pdf({ margin })» НЬ ЭНЭ ТООТОЙ ТЭНЦҮҮ БАЙХ ЁСТОЙ
 * («backend/src/routes/performanceReports.ts», PDF_MARGIN_TOP_MM /
 * PDF_MARGIN_BOTTOM_MM).  @page байгаа үед Chromium агуулгыг CSS-ийн зайгаар
 * инсет хийдэг ч header/footer-ийн зурвасыг puppeteer-ийн зайгаар байрлуулдаг:
 * хоёр нь зөрвөл header-ийн доод зураас агуулгын эхний мөрийн ДЭЭР бууна
 * (2026-08-25-нд PDF-ээс пикселээр хэмжиж баталсан).  Аль нэгийг нь өөрчлөх
 * бол НӨГӨӨГ НЬ ЗЭРЭГ өөрчил. */
@page { size: A4; margin: 16.7mm 0mm 23.88mm 0mm; }

@media print {
  /* ⚠️ ХАР ЗУРВАСЫГ АРИЛГАХ — PDF-ийн хамгийн ил харагдах алдаа байв.
   * -----------------------------------------------------------------
   * Апп нь «index.css»-д «:root { color-scheme: dark }» (+ index.html-ийн
   * «<meta name="color-scheme" content="dark light">») зарладаг.  Хэвлэх
   * маршрут нь аппын дотор амьдардаг тул ТҮҮНИЙГ ӨВЛӨНӨ.
   * «page.pdf({ printBackground: true })» үед Chromium нь «@page»-ийн захын
   * хайрцгуудыг (header/footer сууж буй зурвас) UA-гийн canvas өнгөөр буддаг
   * бөгөөд «color-scheme: dark» үед тэр нь #121212 болно.  Үр дүнд нь
   * хуудас бүрийн дээд/доод зурвас ХАР гарч, header/footer-ийн бараан
   * текст уншигдахаа больдог байв (PDF-ээс пиксел хэмжилтээр батлагдсан:
   * (18,18,18) — хоёуланд нь, light сэдэвтэй хэрэглэгч дээр ч гэсэн).
   *
   * Хэвлэлд албадан гэрэл болгоно.  «!important» шаардлагатай: «index.css»
   * дэх «:root» дүрэм нь тодорхойлолтын хувьд ижил тул зөвхөн дараалал
   * шийднэ, харин энэ хуудасны CSS хэзээ ачаалагдахыг батлах боломжгүй. */
  :root, html, body {
    color-scheme: light !important;
    background: #fff !important;
    background-color: #fff !important;
  }

  /* Cover (1st page) stays full-bleed — no header/footer band. */
  @page :first { margin: 0; }

  /* The global print stylesheet (index.css) hides everything outside
   * ".print-area" via "body * { visibility: hidden }". This report is a
   * standalone print route rendered into .perf-shell, so re-assert
   * visibility — without it page.pdf() produces totally blank pages. */
  body, body * { visibility: visible !important; }

  /* Header/footer are drawn by puppeteer in the @page margins on every
   * A4 (accurate page numbers). Hide the in-flow ones so they don't
   * double up; they still render on screen / in the editor preview.
   * !important because these rules sit BEFORE the base .perf-page__*
   * declarations — media queries don't add specificity, so source
   * order would otherwise let the base rules win in print too. */
  .perf-page__header, .perf-page__footer { display: none !important; }

  /* Дотоод хэсгүүдийн ХАЖУУГИЙН зай. @page-ийн хэвтээ margin нь 0mm (нүүр
   * хуудас full-bleed navy байх ёстой тул), тиймээс зүүн/баруун захын зайг
   * агуулга өөрөө өгөх ёстой. Урьд нь .perf-page-ийн үндсэн padding өгдөг
   * байсан ба одоо тэр нь A4Paginator-ийн .a4-flow дээр очсон — тиймээс
   * зөвхөн .a4-flow-гүй (paginator-гүй) хэвлэлийн замд нөхөж өгнө. Босоо
   * зайг дан ганц @page margin (16.7mm/23.88mm) хариуцна — .perf-page дээр
   * босоо padding БАЙХГҮЙ, эс бөгөөс тэр нь @page-ийн дээр нэмэгдэж
   * дэлгэцийн 256.42mm-тэй дахин зөрнө. */
  .perf-page { padding-left: 19.05mm; padding-right: 19.05mm; }
  .a4-flow .perf-page { padding-left: 0; padding-right: 0; }

  /* A4Paginator дэлгэцэн дээр [data-a4-item] элементийг ХЭМЖИЖ, тухайн
   * хуудсанд багтахгүй бол бүтнээр нь дараагийн хуудас руу түлхдэг. Хэвлэлийн
   * PDF дэлгэцийн үр дүнтэй ТААРАХ ёстой тул Chromium-д яг ижил утгатай
   * зааврыг өгнө: элементийг битгий хуваа. */
  [data-a4-item] { break-inside: avoid; page-break-inside: avoid; }

  /* ⚠️ ГЭХДЭЭ: ХЭСГИЙН БҮРХҮҮЛИЙГ ХЭЗЭЭ Ч НААЖ БОЛОХГҮЙ.
   * Эдгээрийн өндөр нь агуулгаас хамаарч нэг хуудаснаас УРТ болж чадна
   * (хэмжсэн: «bb-doc__grp» = 268mm = хуудасны 105%).  Нэг хуудаснаас урт
   * хайрцагт «break-inside: avoid» тавихад Chromium эхлээд түүнийг ШИНЭ
   * хуудас руу түлхэж, өмнөх хуудсыг бараг хоосон орхиод дараа нь ямар ч
   * байсан хуваадаг — PDF-ээс хэмжихэд 15-р хуудас 3%, 16-р хуудас ердөө
   * 10% дүүрсэн байв.  Тиймээс бүрхүүлүүдийг урсгана; өнчин гарчгаас
   * доорх «break-after: avoid» хамгаална.  (Дэлгэцийн A4Paginator мөн
   * багтахгүй бүрхүүл рүү орж хүүхдүүдийг нь нэгж болгодог болсон.) */
  .perf-shell [class*="-doc__grp"],
  .perf-shell [class*="-doc__group"],
  .perf-shell .perf-team__body {
    break-inside: auto !important;
    page-break-inside: auto !important;
  }

  /* ═══ КОНТЕЙНЕРИЙГ ХЭЗЭЭ Ч БҮТНЭЭР НЬ НААХГҮЙ ═══
   * -------------------------------------------------------------
   * Багийн бичиг баримт БҮР өөрийн CSS-дээ дараах дүрэмтэй:
   *     .xx-doc__list, .xx-doc__zone { break-inside: avoid-page }
   * Гэтэл эдгээр нь ЖАГСААЛТ ба БҮС — уртыг нь хэрэглэгчийн оруулсан
   * өгөгдөл тодорхойлдог тул нэг хуудаснаас хэдэн ч дахин урт болж чадна.
   * Chromium ийм хайрцгийг эхлээд ШИНЭ хуудас руу түлхээд дараа нь ямар ч
   * байсан хуваадаг.  Үр дүнд нь «A block 2-р давхар» гэсэн ГАРЧИГ хуудасны
   * дээр ганцаараа үлдэж, доор нь БҮТЭН ХУУДАС хоосон, агуулга нь
   * дараагийн хуудаснаас эхэлдэг байв (2026-08-25-нд PDF-ээс илрүүлсэн).
   *
   * Тиймээс: КОНТЕЙНЕР (div/ul/ol/section/article) хэзээ ч наагдахгүй,
   * зөвхөн ЖИЖИГ нэгж (p / li / tr) л бүтнээрээ үлдэнэ.  Энэ нь баримт
   * бүрийн өөрийнх нь дүрмийг дардаг тул ШИНЭ баримт нэмэгдэхэд ч
   * автоматаар зөв ажиллана — БҮХ төсөл, БҮХ ирээдүйн тайланд. */
  .perf-shell .perf-team__body div,
  .perf-shell .perf-team__body ul,
  .perf-shell .perf-team__body ol,
  .perf-shell .perf-team__body section,
  .perf-shell .perf-team__body article,
  .perf-shell .psec-doc ul, .perf-shell .psec-doc ol, .perf-shell .psec-doc div,
  .perf-shell .norm-doc ul, .perf-shell .norm-doc ol, .perf-shell .norm-doc div {
    break-inside: auto !important;
    page-break-inside: auto !important;
  }
  .perf-shell .perf-team__body li,
  .perf-shell .perf-team__body p,
  .perf-shell .psec-doc li, .perf-shell .psec-doc p,
  .perf-shell .norm-doc li, .perf-shell .norm-doc p {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* ГАРЧИГ / ШОШГО — доорх агуулгатайгаа ЗААВАЛ хамт явна.
   * Баримтууд гарчгийг ихэвчлэн «h1..h4» БИШ, класстай «p» / «div»-ээр
   * бичдэг («iz-doc__zone-title», «xx-doc__heading», «norm-doc__cat» …)
   * тул элементийн нэрээр биш КЛАССААР барина. */
  .perf-shell [class*="__zone-title"],
  .perf-shell [class*="__heading"],
  .perf-shell [class*="__title"],
  .perf-shell [class*="__subtitle"],
  .perf-shell [class*="__cat"],
  .perf-shell [class*="__cat-head"] {
    break-after: avoid !important;
    page-break-after: avoid !important;
    break-inside: avoid;
  }
  /* Paginator-ийн "энэ элементээс шинэ хуудас эхэл" тэмдэглэгээний хэвлэлийн хос. */
  [data-a4-break="before"] { break-before: page; page-break-before: always; }

  /* ХҮСНЭГТ — МӨРӨӨР хуваагдана (урьд нь бүтнээр нь хориглодог байв).
   * -----------------------------------------------------------------
   * Хуучин дүрэм: «.perf-shell table { break-inside: avoid !important }».
   * Тайлбар нь «Chromium хуваагдсан хүснэгтийг @page-ийн зах руу цухуйлгаж
   * header/footer-тэй давхцуулдаг» байсан.  Тэр цухуйлт нь ҮНЭНДЭЭ «@page»
   * margin (16.7/23.88mm) ба puppeteer-ийн margin (22/15mm) ЗӨРСӨНӨӨС
   * үүсдэг байсан — хоёуланг нь тэнцүүлснээр асуудал арилсан.
   *
   * Бүтнээр нь хориглосон нь харин ноцтой хажуугийн үр дагавартай байв:
   * хагас хуудсанд багтахгүй хүснэгт БҮТНЭЭРЭЭ дараагийн хуудас руу үсэрч,
   * өмнөх хуудсыг бараг хоосон орхидог (PDF хэмжилтээр 15-р хуудас 3%,
   * 16-р хуудас 8% дүүрсэн байв).  Одоо:
   *   • хүснэгт мөрөөр урсана,
   *   • МӨР хэзээ ч хоёр хуудсанд хуваагдахгүй,
   *   • «thead» хуудас бүрд ДАВТАГДАНА («table-header-group»).
   * Энэ нь дэлгэцийн A4Paginator-ийн мөр-түлхэх логиктой яг таарна. */
  .perf-shell table { break-inside: auto !important; page-break-inside: auto !important; }
  .perf-shell thead { display: table-header-group; }
  .perf-shell tfoot { display: table-footer-group; }
  .perf-shell tr { break-inside: avoid; page-break-inside: avoid; }

  /* ӨНЧИН СҮҮЛИЙН МӨР — хүснэгтийн ганц мөр дангаараа шинэ хуудсанд
   * үлдэхээс сэргийлнэ.  Хэмжилтээр 16-р хуудас нь ЗӨВХӨН нэг мөртэй
   * (дүүрэлт 5%) гарч байв: өмнөх хуудас дүүрээд сүүлийн мөр ганцаараа
   * үсэрсэн.  «break-before: avoid» нь Chromium-д тэр мөрийг өмнөх
   * мөртэйгээ хамт байлгахыг хэлнэ — өмнөх хуудсанд зай байвал буцааж
   * татна, эс бөгөөс СҮҮЛИЙН ХОЁР мөрийг хамт зөөнө. */
  .perf-shell tbody tr:last-child { break-before: avoid; page-break-before: avoid; }

  /* Гарчиг нь хуудасны ёроолд ГАНЦААРАА үлдэхгүй — дараагийн агуулгатайгаа
   * хамт шилжинэ.  Энэ нь бүтэн хэсгийг «break-inside: avoid»-оор наахаас
   * ХАМААГҮЙ дээр: хуудас дүүрсэн хэвээр үлдэж, зөвхөн өнчин гарчиг л
   * зөөгдөнө. */
  .perf-shell h1, .perf-shell h2, .perf-shell h3, .perf-shell h4,
  .perf-shell .perf-intro__sub, .perf-shell .perf-intro__section-num,
  .perf-shell .perf-team__heading { break-after: avoid; page-break-after: avoid; }

  /* (Явцын тоймын хүснэгтийн тусгай дүрэм БОЛОВСРОЛ болов — дээрх нийтлэг
   *  «хүснэгт мөрөөр урсана» дүрэм түүнийг аль хэдийн хамарна.) */
  /* Chromium collapse-хүснэгтийг хуваахдаа сүүлийн мөрийг @page margin руу
   * цухуйлгадаг (footer-ийн зурвастай давхцдаг) баримтжсан алдаатай. Хуваагддаг
   * цорын ганц хүснэгтэд collapse-ыг унтраана — харагдац өөрчлөгдөхгүй
   * (зөвхөн td-ийн доод хүрээ ашигладаг тул spacing 0-той separate ижил). */
  .perf-shell .team-stats-doc__table {
    border-collapse: separate !important;
    border-spacing: 0 !important;
  }

  /* Тайлбар бичиг / form-filled narrative: keep a section heading glued to
   * the text that follows it, and never split a paragraph or list item
   * across A4s. So a section that doesn't fit at the bottom of a page
   * moves whole to the next page (with its heading) instead of breaking
   * mid-way. Scoped to .perf-team__body so it only affects narrative
   * content, not the structural intro/summary pages. */
  .perf-team__body h1,
  .perf-team__body h2,
  .perf-team__body h3,
  .perf-team__body h4 { break-after: avoid; page-break-after: avoid; }
  .perf-team__body p,
  .perf-team__body li { break-inside: avoid; page-break-inside: avoid; }

  /* project-sections блок (Үндэслэл/Норм/Өрөө/Гал) — narrative-тэй ижил
   * хамгаалалт: мөр хуудасны заагт хагарч footer-ийн зурвастай давхцахаас
   * сэргийлж догол мөр/жагсаалтын мөрийг бүтнээр нь шилжүүлнэ, хэсгийн
   * гарчгийг дараах текстэндээ наана. */
  .perf-shell .psec-doc p,
  .perf-shell .psec-doc li,
  .perf-shell .norm-doc p,
  .perf-shell .norm-doc li { break-inside: avoid; page-break-inside: avoid; }
  .perf-shell .psec-doc__cat,
  .perf-shell .norm-doc__cat { break-after: avoid; page-break-after: avoid; }
}

* { box-sizing: border-box; }

/* Force the whole report onto Arimo so ү/ө (and every other glyph) render
 * with one consistent face in the PDF — overrides the per-discipline-doc
 * "Arial" stacks without having to touch each of the 9 doc components. */
.perf-shell,
.perf-shell * { font-family: "Arimo", "Arial", Helvetica, sans-serif !important; }

.perf-shell {
  background: #fff;
  color: #111;
  font-family: "Arial", "Helvetica", "Noto Sans", sans-serif;
  line-height: 1.5;
  counter-reset: pdfpage;
}
/* Each rendered page (cover or inner) increments the counter so
 * the footer can show "Хуудас N". Pure-CSS, no React plumbing. */
.perf-cover, .perf-page { counter-increment: pdfpage; }

/* ---------------- Cover page ---------------- */
.perf-cover {
  background: #0F243E;
  color: #fff;
  width: 210mm;
  height: 297mm;
  padding: 24mm 20mm;
  position: relative;
  page-break-after: always;
  break-after: page;
  font-family: "Helvetica", "Arial", "Noto Sans", sans-serif;
}
/* .a4-flow нь хуудасны дотоод зайг (padding) өөрөө өгдөг тул нүүр хуудсыг
 * сөрөг margin-аар цаасны дөрвөн зах руу гаргаж бүтэн navy бүрхүүл болгоно.
 * ⚠️ Утгууд нь .a4-flow-ийн padding-той ЯГ тааруулсан — тэр нь A4Paginator.tsx
 * дахь PAGE_PAD (жишиг .docx-ийн w:sectPr: 16.7 / 19.05 / 23.88 / 19.05 mm)-аас
 * үүсдэг тул PAGE_PAD өөрчлөгдвөл ЭНИЙГ ГАРААР хамт өөрчил. Дайвар үр дүн нь
 * ашигтай: 297mm өндөр нүүр хуудас урсгалд 297−16.7−23.88 = 256.42mm буюу яг
 * нэг хуудасны агуулгын өндөртэй тэнцэж хэмжигдэнэ. */
.a4-flow .perf-cover { margin: -16.7mm -19.05mm -23.88mm -19.05mm; }

.perf-cover__anchor {
  position: absolute;
  top: 30mm;
  left: 12mm;
  width: 14px;
  height: 14px;
  opacity: 0.55;
}
.perf-cover__title-wrap {
  position: absolute;
  top: 40%;
  right: 20mm;
  text-align: right;
  /* 65% (≈136mm) дээр «Гүйцэтгэлийн Тайлан №05» 36pt-оор багтдаггүй байсан
   * тул гарчиг 3 мөр болж «№» ба «05» салдаг байв.  78% ≈ 164mm — зүүн ирмэг
   * нь 26mm-д тулах тул A4-ийн захад хүрэхгүй. */
  max-width: 78%;
}
.perf-cover__title {
  font-size: 36pt;
  font-weight: 400;
  margin: 0;
  letter-spacing: 0.5px;
}
/* «№05» — хэзээ ч хоёр мөр болж салахгүй. */
.perf-cover__title-no { white-space: nowrap; }
/* Засварлах горимд EditableText нь «inline-block» болдог: тэр нь дотроо мөр
 * таслахгүй атом хайрцаг болохоор уншилтын горимоос ӨӨР байрлана.  Нүүр
 * хуудасны гарчигт хоёр горим ижил байх ёстой тул «inline» болгоно. */
.perf-cover__title .perf-edit--on { display: inline; }
.perf-cover__period {
  font-size: 10pt;
  margin-top: 8mm;
  opacity: 0.85;
  letter-spacing: 0.5px;
}
.perf-cover__meta {
  position: absolute;
  right: 20mm;
  bottom: 24mm;
  text-align: right;
  font-size: 9pt;
  line-height: 1.6;
  max-width: 70%;
}
.perf-cover__meta strong { font-weight: 600; }
.perf-cover__doc-no {
  margin-top: 6mm;
  font-size: 9pt;
  letter-spacing: 0.4px;
}

/* ---------------- Inner sections (NOT sheets) ---------------- */
/* ⚠️ .perf-page нь A4 хуудас БИШ, харин «шинэ хуудаснаас эхэлдэг ХЭСЭГ».
 * Урьд нь width:210mm + min-height:297mm + padding + page-break-after:always
 * байсан нь блок бүрийг албаар бүтэн A4 болгодог тул богино блокийн дараа
 * ХООСОН цагаан талбай үлдэж, урт блок нь хаа дуртай газраа тасардаг байв.
 * Одоо хэмжээ ба дотоод зайг A4Paginator-ийн .a4-flow (дэлгэц) / @page margin
 * (хэвлэл) хариуцах ба энд зөвхөн «шинэ хуудаснаас эхэл» гэсэн заавар үлдэнэ.
 * break-AFTER биш break-BEFORE: сүүлийн хэсгийн ард хоосон хуудас үүсэхгүй
 * тул :last-child цэвэрлэгээ ч хэрэггүй болсон. */
.perf-page {
  position: relative;
  break-before: page;
  page-break-before: always;
}
/* Хуудасны эхэнд аль хэдийн байрлаж буй хэсэг (нүүр хуудасны дараах эхний
 * хэсэг, эсвэл paginator-ийн үүсгэсэн хуудасны эхний хүүхэд) дахин шинэ
 * хуудас нэхэхгүй — эс бөгөөс өмнө нь хоосон хуудас үүснэ. */
.perf-page:first-child {
  break-before: auto;
  page-break-before: auto;
}

/* Client sign-off / approval table at the bottom of a team's section. */
.perf-signoff {
  width: 100%;
  border-collapse: collapse;
  margin-top: 10mm;
  font-size: 9pt;
  break-inside: avoid;
  page-break-inside: avoid;
}
.perf-signoff th,
.perf-signoff td {
  border: 1px solid #0F243E;
  padding: 5px 8px;
  vertical-align: top;
  text-align: left;
}
.perf-signoff th,
.perf-signoff .perf-signoff__role {
  background: #1f3a5a;
  color: #fff;
  font-weight: 700;
}
.perf-signoff th em,
.perf-signoff .perf-signoff__role em {
  font-weight: 400;
  font-style: italic;
  font-size: 8pt;
  opacity: 0.85;
}
.perf-signoff__role { width: 26%; vertical-align: middle; }
.perf-signoff__fill { height: 15mm; background: #fff; }

.perf-page__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 1px solid #999;
  padding-bottom: 6px;
  font-size: 9pt;
  margin-bottom: 10mm;
}
.perf-page__header-title { font-weight: 700; }
.perf-page__header-doc { color: #555; font-size: 8pt; line-height: 1.5; }

.perf-page__footer {
  position: absolute;
  bottom: 8mm;
  left: 19.05mm;
  right: 19.05mm;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 8pt;
  color: #777;
  border-top: 1px solid #ddd;
  padding-top: 4px;
}
/* .perf-page нь A4 өндөртэй байхаа больсон тул position:absolute; bottom:8mm
 * footer нь хуудасны ёроолд биш ХЭСГИЙН ёроолд наалдаж, агуулгатай давхцана.
 * Дэлгэцэн дээр A4Paginator өөрөө хуудас бүрийн доор дугаар зурдаг тул энийг
 * нуу. (Хэвлэхэд @media print дотор аль хэдийн нуугдсан — тэнд puppeteer-ийн
 * header/footer template ажилладаг.) */
.a4-flow .perf-page__footer { display: none; }

.perf-page__footer-logo {
  font-family: "Helvetica", "Arial", sans-serif;
  font-weight: 700;
  font-size: 9pt;
  letter-spacing: 1px;
  color: #0F243E;
  display: flex;
  align-items: center;
  gap: 6px;
}
.perf-page__footer-logo img {
  max-height: 34px;
  max-width: 160px;
  object-fit: contain;
}
.perf-page__footer-pageno {
  font-family: "Helvetica", "Arial", sans-serif;
  font-size: 8.5pt;
  color: #555;
}
.perf-page__footer-pageno::before { content: "Хуудас " counter(pdfpage); }

.perf-cover__logo {
  position: absolute;
  bottom: 16mm;
  left: 16mm;
  max-width: 140px;
  max-height: 60px;
  object-fit: contain;
}

/* ---------------- Table of contents ---------------- */
.perf-toc__title {
  text-align: center;
  font-size: 16pt;
  margin: 0 0 14mm;
  text-decoration: underline;
}
.perf-toc__list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.perf-toc__row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 5px 0;
  font-size: 10.5pt;
}
.perf-toc__row--top { font-weight: 700; text-transform: uppercase; font-size: 10pt; }
.perf-toc__row--sub { padding-left: 14mm; font-size: 10pt; }
.perf-toc__row--subsub { padding-left: 24mm; font-size: 9pt; color: #555; }
.perf-toc__label { flex: 0 0 auto; max-width: 70%; }
.perf-toc__dots {
  flex: 1 1 auto;
  border-bottom: 1px dotted #888;
  margin: 0 4px 4px;
  height: 1px;
}
.perf-toc__page { flex: 0 0 auto; min-width: 24px; text-align: right; }

/* ---------------- Project intro tables ---------------- */
/* Босоо зайг ~35% чангатгав (8mm/3mm -> 5mm/2mm).  Хэмжээ, фонт, өнгө
 * ХӨДӨЛСӨНГҮЙ — зөвхөн зай, тул жишиг .docx-ийн бүтэц хэвээр. */
.perf-intro__section-num {
  font-size: 11pt;
  font-weight: 700;
  margin: 5mm 0 2mm;
}
.perf-intro__section-num em {
  display: block;
  font-style: italic;
  font-weight: 400;
  color: #666;
  font-size: 9pt;
}
/* Дэд гарчгийг хүснэгтэдээ наана — гарчиг хуудасны ёроолд өнчрөхгүй,
 * бүлэг бүхэлдээ хамт зөөгдөнө.
 *
 * ⚠️ Энэ нь одоо зөвхөн ЖИЖИГ бүлэгт (1.1) үнэн.  Урт бүлэг (1.2 «Scope of
 * work», 1.3 «Project Timeline») бүхэлдээ наагдвал өмнөх хуудсанд 80mm сул
 * зай байсан ч бүтнээрээ үсэрдэг тул JSX-ээс «.perf-intro__group--flow»
 * модификатор авдаг бөгөөд «introStyles.ts» түүнийг «break-inside: auto»
 * болгож ЭНЭ дүрмийг цуцална (тэр файл эндээс ХОЙШ нийлдэг). */
.perf-intro__group { break-inside: avoid; page-break-inside: avoid; }

/* Босоо зай чангатгав (5mm/2mm -> 3.5mm/1.5mm).  1.3-ын дэд гарчиг нь
 * «introStyles.ts»-д «.perf-intro__head-row .perf-intro__sub { margin: 0 }»-
 * оор аль хэдийн тэглэгдсэн тул энэ өөрчлөлт 1.1 / 1.2-т үйлчилнэ. */
.perf-intro__sub {
  font-size: 10pt;
  font-weight: 700;
  margin: 3.5mm 0 1.5mm;
  text-decoration: underline;
}
.perf-intro__sub em {
  font-style: italic;
  font-weight: 400;
  color: #666;
  text-decoration: none;
}

/* Хүснэгтийн доод зай 4mm -> 2.5mm (-37%).  Энэ нь тайлангийн БҮХ
 * хүснэгтэд үйлчилнэ; танилцуулгын 5 хүснэгт нь «introStyles.ts»-ийн
 * «.perf-table--intro { margin-bottom: 3mm }»-оор өөрийн утгаа барина. */
.perf-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
  margin-bottom: 2.5mm;
}
.perf-table th, .perf-table td {
  border: 1px solid #aaa;
  padding: 5px 8px;
  vertical-align: top;
  text-align: left;
}
.perf-table thead th {
  background: #0F243E;
  color: #fff;
  font-weight: 700;
}
.perf-table--passport th {
  background: #0F243E;
  color: #fff;
  font-weight: 700;
  width: 18%;
}
.perf-table--passport th small {
  display: block;
  font-style: italic;
  font-weight: 400;
  font-size: 8pt;
  opacity: 0.8;
}
.perf-table td small {
  display: block;
  font-style: italic;
  color: #666;
  font-size: 8pt;
}

.perf-discipline-cells {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 9pt;
}
.perf-discipline-cells span::before {
  content: "■";
  margin-right: 4px;
  color: #0F243E;
}

/* ---------------- Team section page ---------------- */
.perf-team__heading {
  font-size: 12pt;
  font-weight: 700;
  margin: 0 0 5mm;
}
.perf-team__heading mark {
  background: #fff58a;
  padding: 0 3px;
}
.perf-team__body { font-size: 10pt; line-height: 1.55; }
.perf-team__body p { margin: 0 0 3mm; text-align: justify; white-space: pre-wrap; }

/* ═══ НИЙТЛЭГ БАТАЛГАА — үргэлжилсэн бичвэр ҮРГЭЛЖ ТЭГШРҮҮЛСЭН ═══
 * -------------------------------------------------------------
 * Багийн тайлбар бичгүүд (BA/BB/ХАС/ЦБУ/ЦАХ/ХД/АУ/ИЗ) тус бүр
 * ӨӨРИЙН «*_REPORT_STYLES» экспорттой бөгөөд тэдгээрийг хэвлэх хуудас
 * болон урьдчилан харах хуудас ГАРААР нийлүүлдэг.  Практикт «IZ» нь тэр
 * жагсаалтаас ОРХИГДСОН байсан: интерьерийн баг бүхий төслийн тайланд
 * ИЗ-ийн бичиг баримт CSS-гүй буюу зүүн тийш эгнэсэн, зайгүй гарч байв
 * (2026-08-25-нд PDF-ээс илрүүлсэн).
 *
 * Тиймээс тэгшрүүлэлтийг тухайн баримтын CSS-ээс ХАМААРУУЛАХГҮЙ болгов:
 * доорх дүрэм нь «.perf-team__body» дотор орох ямар ч догол мөр,
 * жагсаалтын мөрөнд үйлчилнэ.  Шинэ баг/баримт нэмэгдэхэд ямар ч
 * тохиргоогүйгээр ЗӨВ гарна — БҮХ төсөл, БҮХ ирээдүйн тайланд.
 *
 * «text-align-last: left» — сүүлийн мөр сунахгүй.  Монгол бичвэрт
 * «hyphens» ХЭРЭГЛЭХГҮЙ: үг таслах дүрэм байхгүй тул буруу тасална. */
.perf-shell .perf-team__body p,
.perf-shell .perf-team__body li,
.perf-shell .psec-doc p,
.perf-shell .psec-doc li,
.perf-shell .norm-doc p,
.perf-shell .norm-doc li {
  text-align: justify;
  text-align-last: left;
  overflow-wrap: break-word;
}
/* Гарчиг, шошго, тоон утга — ХЭЗЭЭ Ч тэгшрүүлэхгүй (үг хоорондын зай
 * сунаж уншихад муу болно). */
.perf-shell .perf-team__body h1,
.perf-shell .perf-team__body h2,
.perf-shell .perf-team__body h3,
.perf-shell .perf-team__body h4,
.perf-shell .perf-team__body th,
.perf-shell .perf-team__body td,
.perf-shell .perf-team__body [class*="__heading"],
.perf-shell .perf-team__body [class*="__title"] {
  text-align: initial;
  text-align-last: auto;
}

/* ═══ ДЭД ХЭСГҮҮДИЙН ХООРОНД НЭГ МӨРИЙН ЗАЙ ═══
 * Хэрэглэгчийн шаардлага: «эне бүхэнд дунд нь 1 мөр зай авах».
 * Баримт тус бүрийн CSS-д зай өгсөн ч, CSS нь холбогдоогүй баримтад
 * (дээрх ИЗ-ийн тохиолдол) үйлчлэхгүй тул энд НИЙТЛЭГ доод хязгаар
 * тавина.  «margin-top»-оор л өгч байгаа тул баримтын өөрийн
 * «margin-bottom»-той давхарлахгүй; аль их нь ялна. */
.perf-shell .perf-team__body li + li { margin-top: 0.5em; }
.perf-shell .perf-team__body [class*="__zone"] + [class*="__zone"],
.perf-shell .perf-team__body [class*="__facets"] > li + li { margin-top: 1em; }
.perf-team__empty {
  font-style: italic;
  color: #888;
  font-size: 9.5pt;
}

/* ---------------- Misc ---------------- */
.perf-progress-pct {
  display: inline-block;
  background: #fff58a;
  padding: 0 4px;
  font-weight: 700;
  border-radius: 2px;
}

/* ---------------- Section 2 (summary notes) ---------------- */
.perf-summary__intro {
  font-size: 10pt;
  line-height: 1.55;
  text-align: justify;
  margin: 0 0 6mm;
  text-indent: 8mm;
  white-space: pre-wrap;
}

.perf-stage-table { font-size: 9.5pt; }
.perf-stage-table th {
  background: #0F243E;
  color: #fff;
  text-align: center;
  font-weight: 700;
  padding: 8px 6px;
}
.perf-stage-table tbody tr:nth-child(odd) td.perf-stage-table__name {
  background: #f5f7fb;
}
.perf-stage-table__name {
  font-weight: 600;
  padding: 8px 10px;
  border: 1px solid #0F243E;
}
.perf-stage-table__stage {
  background: #fff;
  color: #111;
  padding: 10px 12px;
  text-align: center;
  vertical-align: middle;
  border: 1px solid #0F243E;
  line-height: 1.45;
}

.perf-workforce-table { font-size: 9.5pt; }
.perf-workforce-table th {
  background: #0F243E;
  color: #fff;
  text-align: center;
  font-weight: 700;
  padding: 7px 8px;
}
.perf-workforce-table td {
  background: #f5f7fb;
  border: 1px solid #c7cfdd;
  padding: 7px 10px;
  vertical-align: top;
}
.perf-workforce-table tbody tr:nth-child(even) td { background: #eef2f8; }
.perf-workforce-table__total td {
  background: #0F243E;
  color: #fff;
  font-weight: 700;
  padding: 7px 10px;
}

/* ---------------- Section 4 (progress summary) ---------------- */
.perf-progress-section__team-bar {
  background: #0F243E;
  color: #fff;
  font-size: 11pt;
  font-weight: 700;
  padding: 6px 12px;
  margin: 6mm 0 4mm;
  border-radius: 2px;
}
.perf-progress-section__team-meta {
  font-weight: 400;
  color: rgba(255, 255, 255, 0.85);
  font-size: 9.5pt;
  margin-left: 8px;
}
`;
