/* =============================================================
 * «1. Төслийн танилцуулга» хуудсанд ЗӨВХӨН хэрэгтэй нэмэлт CSS.
 * -------------------------------------------------------------
 * `PERFORMANCE_REPORT_STYLES` (styles.ts) дотор аль хэдийн байгаа
 * `.perf-page`, `.perf-table`, `.perf-table--passport`,
 * `.perf-intro__section-num`, `.perf-intro__sub`, `.perf-intro__group`,
 * `.perf-discipline-cells` классуудыг ДАХИН тодорхойлохгүй — зөвхөн
 * жишиг тайланд (251030_MGL_PD_MAX_URGUU.docx) байдаг шинэ
 * элементүүдийг нэмнэ:
 *   • баганы ЯГ өргөн (mm) — `table-layout: fixed` + <colgroup>,
 *   • 1.2 Scope of work хүснэгтийн ӨНГӨӨР ХУВААСАН «File name» багана,
 *   • 1.3-ын гарчгийн хажууд суух «Зургийн файл хадгалах загвар»
 *     ХҮРЭЭГҮЙ тайлбарын блок,
 *   • 1.3-ын зэрэгцээ хоёр хүснэгт,
 *   • зөвхөн ЗАСВАРЛАХ горимд харагдах мөр нэмэх/хасах товчнууд ба
 *     сонгогдоогүй дисциплины □ тэмдэглэгээ,
 *   • ХУУДАСЛАЛТЫН НЭГЖИЙН ХЭМЖЭЭ: «.perf-intro__group--flow» модификатор
 *     ба «.perf-intro__head-row» / «.perf-intro__two-up»-ийн break дүрмүүд
 *     (доорхыг үз — дэлгэцийн A4Paginator ба хэвлэлийг тэнцүүлдэг).
 *
 * ХЭМЖЭЭНИЙ ЭХ СУРВАЛЖ: жишиг docx-ийн `w:tblGrid/w:gridCol` (twip →
 * mm).  Хуудасны геометр нь мөн жишиг docx-ийн `w:sectPr`-ээс:
 *   A4 210 × 297mm, зай дээд 16.70 · баруун 19.05 · доод 23.88 ·
 *   зүүн 19.05mm  →  агуулгын хайрцаг 171.91 × 256.42mm.
 * (Энэ тоонуудын ЦОРЫН ГАНЦ эх сурвалж нь `A4Paginator.tsx`-ийн
 *  `PAGE_PAD` — энд зөвхөн лавлагаа болгон бичив.)
 * Хүснэгтүүд нийт ≈170mm тул агуулгын хайрцгийн баруун талд ~1.8mm
 * сул зай үлдэнэ — ЗАСВАРЛАХ товчнууд яг тэнд «унжина» (colgroup-д
 * ОРОХГҮЙ).
 *
 * ЧУХАЛ: засварлах туслах элемент бүр `@media print { display:none }`
 * — хэвлэсэн/PDF хувилбар дээр жишиг баримттай яг ижил байх ёстой.
 *
 * `PERFORMANCE_REPORT_STYLES`-ийн ДАРАА нэг <style> тагт нийлүүлж
 * оруулна (EDITABLE_STYLES-тэй адил).
 * ============================================================= */

export const INTRO_STYLES = `
/* ---------------- Баганы ЯГ өргөн ---------------- */
/* <colgroup>-ийн mm утга зөвхөн table-layout:fixed үед хүчинтэй. */
.perf-table--intro {
  table-layout: fixed;
  max-width: 100%;
  /* styles.ts-ийн «.perf-table { margin-bottom: 4mm }»-ыг ЗӨВХӨН
   * танилцуулгын хуудсанд чангатгав: энэ хуудсанд 5 хүснэгт байдаг тул
   * мөр бүрийн 1mm нь нийт ~5mm цуглаж, 1.3-ын блокийг өмнөх хуудсанд
   * багтаах сул зай болно.  Бусад хуудасны хүснэгтэд нөлөөлөхгүй. */
  margin-bottom: 3mm;
}

/* Толгойн эгнээ: EN 10pt, доор нь MN налуу 8pt (2 тусдаа мөр).
 * (styles.ts-д .perf-table thead th зөвхөн навигацийн өнгө өгдөг,
 *  хэмжээ өгдөггүй тул энд тодорхойлно.) */
.perf-table--intro thead th { font-size: 10pt; }
.perf-table--intro thead th small,
.perf-table--passport th small {
  display: block;
  font-style: italic;
  font-weight: 400;
  font-size: 8pt;
  opacity: 0.85;
}
/* Паспортын шошгын нүд мөн адил EN 10pt + MN налуу 8pt. */
.perf-table--passport th { font-size: 10pt; }

/* Утгын нүд анхдагчаар 9pt (.perf-table-аас), гэхдээ Drawing No. ба
 * хүний нэрс жишигт 10pt. */
.perf-cell--10 { font-size: 10pt; }
/* styles.ts-ийн «.perf-table th, .perf-table td { text-align: left }»
 * дүрэм (0,1,1) тул ганц класс (0,1,0) энэ дээр ХҮЧГҮЙ.
 * Элементтэй хамт бичиж тодорхойлолтыг өсгөнө. */
.perf-table th.perf-cell--center,
.perf-table td.perf-cell--center { text-align: center; }

/* Паспортын хүснэгт ба «Бичиг баримт» хүснэгтийн ХООРОНДОХ тусгаарлах
 * зурвас: жишигт хажуугийн хүрээгүй, зөвхөн дээд/доод шугамтай цагаан
 * мөр (docx-д нэг мөрт хүснэгт байдаг — энд div-ээр хийв). */
.perf-table--passport { margin-bottom: 0; }
.perf-intro__rule {
  width: 170.24mm;
  max-width: 100%;
  height: 3mm;
  margin: 0 0 2mm;
  background: #fff;
  border-top: 0.5pt solid #0F243E;
  border-bottom: 1pt solid #0F243E;
}

/* Дисциплины ■ мөр: жишигт 8 ТЭНЦҮҮ нүд — эхнийх 16.40mm, дараагийн
 * долоо нь 16.42mm (нийт 131.34mm ≈ паспортын colSpan=3 талбайн
 * 56.29+38.19+36.88 = 131.36mm өргөн).
 *
 * ⚠️ «minmax(0, …)»: жишиг docx-д энэ нь ПАДДИНГГҮЙ үүрлэсэн хүснэгт,
 * харин энд «<td>» дотор сууж байгаа тул «.perf-table td»-ийн хажуугийн
 * padding (8px ≈ 2.1mm × 2) нүдний цэвэр өргөнийг 131.36mm-ээс бага
 * болгоно.  Тогтмол «16.42mm» бол grid нүднээсээ халин гарна.  Иймд
 * (a) доорх «.perf-disc-cell» дээр хажуугийн padding-ийг тэглэж,
 * (b) хүрээний зузаанаас үүсэх үлдэгдэл 0.x mm-ийг «minmax» дааж авна.
 * Ингэснээр өргөн нь ДЭЭД ТАЛДАА 16.42mm — жишгээс хэзээ ч ХЭТРЭХГҮЙ. */
.perf-discipline-cells {
  display: grid;
  grid-template-columns: minmax(0, 16.4mm) repeat(7, minmax(0, 16.42mm));
  gap: 0;
  font-size: 9pt;
}
/* Дисциплины мөрийн нүд: жишигт хажуугийн зайгүй (үүрлэсэн хүснэгт). */
.perf-table td.perf-disc-cell { padding-left: 0; padding-right: 0; }

/* ---------------- 1.2 Scope of work ---------------- */
/* Жишиг баримт дээр файлын нэр ГИПЕР ХОЛБООС БИШ — YYMMDD / PROJECT ID /
 * DISCIPLINE / REVISION хэсэг бүр өөр өнгөтэй, бүхэлдээ bold 9pt. */
.perf-scope-table__file {
  font-weight: 700;
  font-size: 9pt;
  /* ⚠️ ЭНЭ ФАЙЛ БҮХЭЛДЭЭ TEMPLATE LITERAL — тайлбарт backtick бүү бич.
     «Хариуцсан мэргэжилтэн» багана нэмэгдэхэд файлын нэрийн багана
     нарийсдаг.  .perf-table--intro нь table-layout: fixed бөгөөд
     240918_MAX_URGUU_TSBU_A дотор таслах боломж (UAX-14) БАЙХГҮЙ тул
     энэ дүрэмгүйгээр текст хүснэгтийн хүрээ рүү халина — дэлгэц дээр ч,
     PDF дээр ч. */
  overflow-wrap: anywhere;
}
.perf-fname__proj { color: #4F81BD; }
.perf-fname__disc { color: #C0504D; }
.perf-fname__rev  { color: #8064A2; }

/* ---------------- Хуудаслалтын нэгжийн ХЭМЖЭЭ ---------------- */
/* styles.ts-д «.perf-intro__group { break-inside: avoid }» гэж бүлгийг
 * БҮХЭЛД нь наадаг.  1.1-д (гарчиг + паспортын хүснэгт) энэ нь зөв —
 * тэр бүлэг хуудасны эхэнд суудаг.  Харин ХОЛИМОГ агуулгатай бүлэгт
 * (1.2 урсгалтай үе, 1.3) энэ нь ~90mm-ийн ХУВААГДАШГҮЙ биет үүсгэж,
 * өмнөх хуудсанд 80mm сул зай байсан ч бүтнээрээ дараагийн хуудас руу
 * үсэрдэг.  Тийм бүлэгт JSX-ээс «--flow» модификатор өгнө.
 *
 * ⚠️ Энэ файл «PERFORMANCE_REPORT_STYLES»-ийн ДАРАА нийлдэг тул ижил
 * тодорхойлолттой (0,1,0) байсан ч ЭНЭ дүрэм ялна.  styles.ts-д ХҮРЭХ
 * шаардлагагүй — тэр файл өөр эзэмшилтэй. */
.perf-intro__group--flow {
  break-inside: auto;
  page-break-inside: auto;
}

/* ---------------- 1.3-ын гарчиг + тайлбарын блок нэг эгнээнд ---------------- */
/* Жишигт «1.3 Project Timeline» гарчиг ЗҮҮН, «Зургийн файл хадгалах
 * загвар» блок ТҮҮНТЭЙ НЭГ ТҮВШИНД БАРУУН талд сууна.
 *
 * ЭНЭ ЭГНЭЭ нь ЦОГЦ ХУУДАСЛАЛТЫН НЭГЖ («data-a4-item»): дотроо хуваагдахгүй
 * (гарчиг ба файлын нэрийн хайрцаг хэзээ ч салахгүй), араасаа ирэх
 * «.perf-intro__two-up»-ээс мөн салахыг эсэргүүцнэ («break-after: avoid»)
 * — ингэснээр гарчиг хуудасны ёроолд ГАНЦААРАА үлдэхгүй.
 *
 * Босоо зайг чангатгав: 5mm/2mm → 3.5mm/1.5mm (−30%).  Хэмжээ, фонт,
 * баганы өргөн ХӨДӨЛСӨНГҮЙ — зөвхөн зай, тул жишиг docx-ийн бүтэц хэвээр. */
.perf-intro__head-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6mm;
  margin: 3.5mm 0 1.5mm;
  break-inside: avoid;
  page-break-inside: avoid;
  break-after: avoid;
  page-break-after: avoid;
}
.perf-intro__head-row .perf-intro__sub {
  margin: 0;
  flex: 0 0 auto;
}

/* ---------------- Зургийн файл хадгалах загвар (тайлбарын блок) ---------------- */
/* Жишигт <a:ln><a:noFill/> — ХҮРЭЭГҮЙ, цагаан дэвсгэр, бүх мөр
 * баруун тийш (jc=right), 8pt (w:sz=16), Arial Narrow.
 *
 * ЯГ ХЭМЖЭЭ: anchored textbox, өргөн 87.09mm.  Байрлал нь эцэг
 * «.perf-intro__head-row»-ийн «justify-content: space-between»-ээс
 * гарна: блокийн БАРУУН ирмэг агуулгын хайрцгийн баруун зах
 * (210 − 19.05 = 190.95mm) дээр тулна — жишиг docx-тэй адил. */
.perf-fnote {
  flex: 0 1 87.09mm;
  max-width: 87.09mm;
  border: 0;
  padding: 0;
  background: #fff;
  font-family: "Arial Narrow", "Liberation Sans Narrow", Arial, Helvetica, sans-serif;
  font-size: 8pt;
  line-height: 1.4;
  text-align: right;
}
.perf-fnote__title {
  font-weight: 700;
  font-style: italic;
  text-decoration: underline;
}
.perf-fnote__pattern { font-weight: 700; }
/* 3, 4-р мөр налуу. */
.perf-fnote__line { font-style: italic; }
/* Мөр + (засварлах үед) түүний баруун талын жижиг товчнууд —
 * баруун зэрэгцүүлэлт хадгалагдана. */
.perf-fnote__line--edit {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: 4px;
}
.perf-fnote__line--edit > .perf-edit { flex: 0 1 auto; text-align: right; }

/* ---------------- 1.3 зэрэгцээ хоёр хүснэгт ---------------- */
/* Жишигт нэг хүснэгт, 7 багана: зүүн блок 85.71mm, дунд зай 6.28mm,
 * баруун блок 78.15mm.  Харагдац ижил тул flex-ээр 2 хүснэгт болгов. */
/* ⚠️ Энэ эгнээ бол ТУСДАА хуудаслалтын нэгж («data-a4-item»), гарчгийн
 * эгнээнээсээ САЛЖ болно — тэгснээрээ л 1.3 өмнөх хуудасны сул зайд
 * багтдаг.  Гэхдээ ДОТРОО хуваагдах ёсгүй: зүүн (төслийн хугацаа) ба
 * баруун (уулзалтын хуваарь) хүснэгт өөр өөр хуудсанд унавал зэрэгцээ
 * байдал алдагдана.  Өндөр нь ~50mm тул нэг нэгж байх нь асуудалгүй. */
.perf-intro__two-up {
  display: flex;
  gap: 6.28mm;
  align-items: flex-start;
  width: 170.14mm;
  max-width: 100%;
  break-inside: avoid;
  page-break-inside: avoid;
}
.perf-intro__two-up > table:first-child { flex: 0 0 85.71mm; }
.perf-intro__two-up > table + table { flex: 1 1 auto; min-width: 0; }
/* «Start (Эхлэх)» нэг мөрөнд — styles.ts-ийн .perf-table td small
 * display:block-ийг энд л буцаана. */
.perf-intro__two-up .perf-table td small { display: inline; }

/* ---------------- Зөвхөн засварлах горимын туслахууд ---------------- */
/* Мөр нэмэх/хасах товчийг хүснэгтийн баруун ЗАХАД, хүрээнээс гадна
 * тавина: нэмэлт нүд хүрээгүй, дэвсгэргүй тул баримтын харагдац
 * өөрчлөгдөхгүй.  «.perf-table td» дүрмийг дарахын тулд !important.
 * <colgroup>-д энэ багана ОРООГҮЙ тул fixed layout-д өргөн нь 0 болж,
 * товчнууд хуудасны баруун сул зайд «унжина». */
.perf-rowbtn-cell {
  border: 0 !important;
  background: none !important;
  padding: 0 0 0 3px !important;
  width: 1px;
  white-space: nowrap;
  overflow: visible;
  vertical-align: middle;
}
.perf-rowbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin: 0 1px;
  padding: 0;
  border: 1px solid #b9c2d0;
  border-radius: 50%;
  background: #f2f5fa;
  color: #4a5568;
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
  user-select: none;
}
.perf-rowbtn:hover {
  background: #e2eaf6;
  border-color: #7f9dc4;
  color: #14304f;
}
/* Хоосон хүснэгт дээр эхний мөрийг нэмэх мөр. */
.perf-rowadd td {
  border: 0 !important;
  background: none !important;
  padding: 2px 0 !important;
  text-align: center;
}

/* Дисциплины тэмдэглэгээ: засварлах үед бүх код харагдаж, сонгогдоогүй
 * нь □ (U+25A1) ба бүдэг.  Хэвлэхэд сонгогдсон ■ нь л үлдэнэ. */
.perf-disc-toggle { cursor: pointer; }
.perf-disc--off { opacity: .35; }
.perf-discipline-cells span.perf-disc--off::before { content: "\\25A1"; }

@media print {
  .perf-rowbtn,
  .perf-rowbtn-cell,
  .perf-rowadd,
  .perf-disc--off { display: none !important; }
  .perf-disc-toggle { cursor: default; }
}

/* ---------------- Засварлагдах СТАТИК шошго (<T> / reportText.tsx) ---------------- */
/* EDITABLE_STYLES-ийн hover/focus тэмдэглэгээ нь ХӨХ (rgba(56,132,255,…)).
 * Хүснэгтийн толгой ба паспортын шошгын нүд нь navy #0F243E дэвсгэртэй,
 * цагаан үсэгтэй тул тэр хөх бараг үл үзэгдэнэ — шошгыг дарж болохыг
 * хэрэглэгч ОГТ мэдэхгүй.  Иймд эдгээр нүдэнд ЦАЙВАР хувилбар өгнө.
 *
 * Тодорхойлолт: .perf-table thead th .perf-edit--on:hover = (0,3,2) нь
 * EDITABLE_STYLES-ийн .perf-edit--on:hover = (0,2,0)-г давна тул
 * !important шаардлагагүй.
 *
 * Сонголт нь .perf-edit--on-оор явна, .perf-txt-ээр БИШ: <T as="small">
 * үед гадна тал нь <small class="perf-txt">, харин contentEditable нь
 * дотоод <span class="perf-edit--on"> (perf-txt классгүй) байдаг.
 * Эдгээр нүднүүдэд УТГЫН EditableText байдаггүй тул хэт өргөн барихгүй. */
.perf-table thead th .perf-edit--on:hover,
.perf-table--passport th .perf-edit--on:hover {
  background: rgba(255, 255, 255, 0.18);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45);
}
.perf-table thead th .perf-edit--on:focus,
.perf-table--passport th .perf-edit--on:focus {
  background: rgba(255, 255, 255, 0.26);
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.85);
}
/* Шошгыг БҮРЭН арилгасан үед анхдагч текст (placeholder) гарч ирдэг —
 * EDITABLE_STYLES-ийн #9aa4b2 нь navy дээр уншигдахгүй. */
.perf-table thead th .perf-edit--on.perf-edit--empty::before,
.perf-table--passport th .perf-edit--on.perf-edit--empty::before {
  color: rgba(255, 255, 255, 0.62);
}

/* .perf-intro__sub нь text-decoration: underline.  CSS-ийн дүрмээр
 * чимэглэл нь АТОМ inline-level хайрцаг (inline-block) руу ДАМЖДАГГҮЙ,
 * харин .perf-edit--on нь display: inline-block — иймд засварлах
 * горимд «1.1. General Information» гарчгийн доогуур зураас алга болно.
 * Шууд өгч буцаана.  Хаалтанд бичсэн монгол хэсэг нь <em> дотор тул
 * .perf-intro__sub em { text-decoration: none } хэвээрээ хүчинтэй. */
.perf-intro__sub > .perf-txt.perf-edit--on { text-decoration: underline; }
`;
