/**
 * Үнийн саналын ХЭВЛЭХ хуудасны CSS (`QuotePrintPage`).
 *
 * ⚠️ Энэ файл нүдний ХЭВ МАЯГИЙГ ТОДОРХОЙЛДОГГҮЙ. Тод/налуу/дэвсгэр/хүрээ бүгд
 * `sheetStyles.ts`-ийн `cellClass`-аас гардаг — засварлагч ба хэвлэмэл нэг эх
 * сурвалжтай байх ёстой. Энд зөвхөн ХУУДАСНЫ хүрээ ба ХЭВЛЭЛТИЙН НЯГТРАЛ:
 *   • `@page` (A4 ХЭВТЭЭ) + кирилл фонт,
 *   • баганы өргөнийг A4-д багтаах,
 *   • мөрийн өндөр / нүдний зайг цаасанд тохирсон болгох,
 *   • хуудас таслах дүрмүүд, бланк, гарын үсэг · тамга.
 *
 * ── 2026-08-17-ийн ШИНЭЧЛЭЛ: өргөнийг АГУУЛГААС гаргана ────────────────────
 * Өмнө нь баганы өргөнийг ЗӨВХӨН засварлагчийн px өргөнөөс, үсгийн хэмжээг
 * `1031 / Σөргөн` харьцаагаар авдаг байсан — өөрөөр хэлбэл нүдэнд ЮУ БИЧСЭНИЙГ
 * огт мэддэггүй байв. Гурван бодит алдаа үүнээс гарсан (бүгд хэмжигдсэн):
 *
 *   1. **Тоо чимээгүй тасардаг.** «НИЙТ ДҮН 1,304,953,528» нь 65.2px хэрэгтэй
 *      атлаа 63px нүдэнд орж эцсийн «8» алга болсон. `td` нь `overflow:hidden`
 *      тул ямар ч дохио үлдээхгүй.
 *   2. **Масштабыг НУУГДСАН баганатай хамт боддог байв.** 26 баганаас 8 нь
 *      хэвлэмэлд нуугддаг (7 хэсэг + нэмэгдлийн дүн) атлаа Σөргөн нь 2663px
 *      (бодит нь 1803px) гэж бодогдож, үсэг үргэлж `MIN_FONT_PT`-д тулж,
 *      баганы хувь нь ердөө 67.7% болж үлдсэн 32.3%-ыг Chromium өөрөө
 *      хуваарилдаг байв. Мөн `col:nth-child(n)` нь нуугдсан баганаас хойш
 *      ШИЛЖИЖ, «Нийт үнэ» багана «Дүн /төг/»-ийн өргөнийг авдаг байсан.
 *   3. **Бүтцээр таних дүрмүүд үйлчлэхээ больсон.** `colspan`, `nth-child`
 *      бүгд ХАРАГДАХ баганаар тоологддог тул `sheet.cols`-оор бичсэн
 *      сонгогчид (нийлбэрийн блок, бөглөөгүй мөр) хэзээ ч таардаггүй байв.
 *
 * Одоо `lib/printFit.ts` нь нүд бүрийн БОДИТ текстийг хэмжиж (canvas, баримттай
 * ижил фонт) багана бүрийн хэрэгцээг гаргана, `fitColumns` нь бүх «таслах
 * боломжгүй» нүд багтах ХАМГИЙН ТОМ үсгийн хэмжээг сонгоно. Үр дүнд нь үсэг
 * тогтмол 6.5pt биш, багтахуйц хамгийн том хэмжээгээр гарна.
 *
 * ── Яагаад ЦААСАН дээр засварлагчаас НЯГТ вэ? ──────────────────────────────
 * Дэлгэц дээр нүд нь хулганаар онилох бай (28px өндөр) — цаасан дээр тэр зай нь
 * «дутуу бэлтгэсэн» харагдац өгдөг. MGL-ийн бодит Excel экспорт нь мөр тутам
 * ~5.5mm нягттай. Тиймээс мөрийн өндөр · дотоод зай · мөр хоорондын зайг доорх
 * ТОГТМОЛУУДААР дахин тавина (бүгд `em` — үсгийн хэмжээтэй хамт масштаблана).
 *
 * ── Толгойн мөрийг яаж таних вэ? ───────────────────────────────────────────
 * `CellStyle.bg==='header'` нүдэнд `cellClass` нь `bg-muted/60` класс өгдөг
 * (`sheetStyles.ts` `BG`). Загварын толгой ҮРГЭЛЖ эхний мөрүүдэд байдаггүй
 * (нэмэлт хуудас, бүлэг тус бүрийн толгой) тул мөрийн ДУГААРААР биш ЗАГВАРААР
 * нь онилно: `td[class~="bg-muted/60"]`.
 */
import { addonTotalCol, sectionCols } from '../lib/addons';
import { refToCoord } from '../lib/formula/refs';
import { hiddenGroupCols } from '../lib/optionalCols';
import { textWidthEm, type FitResult } from '../lib/printFit';
import type { NamedSheet, SheetDoc, WorkbookDoc } from '../types/quotes';

/** `SheetGrid`-ийн `DEFAULT_COL_W`-ийн толь — `colWidths` дутуу үед хэрэглэнэ. */
export const DEFAULT_COL_W = 96;

const MM_TO_PX = 96 / 25.4;

/** A4 хэвтээ (297mm) − зүүн/баруун 12mm зах = 273mm.
 *  Захууд нь `backend/src/routes/quotes.ts`-ийн `page.pdf({margin})`-тай тэнцүү. */
const PAGE_W_MM = 297;
const PAGE_H_MM = 210;

/* --- ЗАХ НЬ ХОЁР ДАВХАРГА (2026-08-17) ------------------------------------
 * Асуудал (ЗӨВХӨН ГАРААР ХЭВЛЭХЭД илэрдэг, PDF дээр гардаггүй): браузерын
 * хэвлэх харилцах цонхны «Захын хэмжээ» тохиргоо нь CSS-ийн `@page { margin }`
 * -ыг ДАРЖ бичдэг. Хэрэглэгч «Байхгүй/None» сонговол (эсвэл принтер «бүрэн
 * хуудас» руу шилжвэл) зах БҮРЭН алга болж, лого зүүн ирмэгт, огноо баруун
 * ирмэгт наалдаад хүснэгт цаасны хясаанаас цухуйна.
 *
 * Шийдэл: нийт захыг ХУВААНА —
 *   • `PAGE_MARGIN_*` → `@page { margin }`  — цаасны зах (браузер дарж БОЛНО),
 *   • `SAFE_PAD_*`    → `.quote-print { padding }` — баримтын ДОТООД зай,
 *     үүнийг браузерын ямар ч тохиргоо дарж ЧАДАХГҮЙ.
 * Нийлбэр нь хуучин ганц 14mm/12mm-тэй ЯГ ТЭНЦҮҮ тул PDF-ийн зохиомж,
 * `PRINT_CONTENT_*` тооцоо, баганы өргөн бүгд БАЙСАН ХЭВЭЭР үлдэнэ — харин
 * «зах байхгүй» горимд ч 7mm зай хэзээ ч алдагдахгүй.
 *
 * ⚠️ ОЛОН ХУУДАСТ баримтад `padding-top` нь зөвхөн 1-р хуудсанд, `padding-bottom`
 * нь зөвхөн сүүлийн хуудсанд үйлчилнэ (CSS фрагментацийн дүрэм). Дунд хуудсууд
 * `@page`-ийн 7mm-ээр хамгаалагдана.
 */
const PAGE_MARGIN_X_MM = 5;
const PAGE_MARGIN_Y_MM = 7;
const SAFE_PAD_X_MM = 7;
const SAFE_PAD_Y_MM = 7;
/** НИЙТ зах — доорх агуулгын хэмжээсийн тооцоо зөвхөн эднээс хамаарна. */
const MARGIN_X_MM = PAGE_MARGIN_X_MM + SAFE_PAD_X_MM; // 12
const MARGIN_Y_MM = PAGE_MARGIN_Y_MM + SAFE_PAD_Y_MM; // 14
export const PRINT_CONTENT_MM = PAGE_W_MM - 2 * MARGIN_X_MM; // 273
export const PRINT_CONTENT_PX = PRINT_CONTENT_MM * MM_TO_PX; // ≈1031.8

/** A4 хэвтээ (210mm) − дээд/доод 14mm зах = 182mm. БОСОО филийн суурь. */
export const PRINT_CONTENT_H_MM = PAGE_H_MM - 2 * MARGIN_Y_MM; // 182
export const PRINT_CONTENT_H_PX = PRINT_CONTENT_H_MM * MM_TO_PX; // ≈688

/* --- БЛАНКНЫ ЛОГО ---------------------------------------------------------
 * ⚠️ `public/logo.svg`-ийн viewBox нь 1920×1080 боловч БОДИТ зураг (ink) нь
 * түүний дунд ердөө 455×349 нэгжийг эзэлдэг — растержуулж хэмжсэн (2026-07-29):
 * x 732–1187, y 365–714, өөрөөр хэлбэл хоёр тэнхлэгээр ЯГ голлосон. Тиймээс
 * `height`-ыг шууд тавибал цаасан дээр гарах тэмдэг түүний ердөө 32% болно.
 *
 * Шийдэл: зургийг ТОМСГООД эргэн тойрны хоосон зайг СӨРӨГ зайгаар хасна —
 * ингэснээр эзлэх хайрцаг нь ЯГ ink-ийн хэмжээ болно. Хэмжээг сольход ЗӨВХӨН
 * `LOGO_INK_MM`-ыг засна (`PAGE_HEAD_PX` хүртэл автоматаар дагана).
 *
 * ⚠️ `logo.svg`-ийг СОЛИХ бол ink-ийн хүрээг ДАХИН хэмжинэ.
 */
const LOGO_VIEWBOX_H = 1080;
const LOGO_VIEWBOX_W = 1920;
const LOGO_INK_H = 349;
const LOGO_INK_W = 455;
/**
 * Бланк дээрх логоны БОДИТ өндөр (mm) — хэмжээг ЭНДЭЭС сольж тохируулна.
 *
 * ⚠️ 2026-08-19: 15 → 10. Толгой нь `PAGE_HEAD_PX`-ээр дамжин БОСОО ТӨСВИЙГ
 * шууд иддэг (23mm = 87px = A4 хэвтээгийн 12.7%) атлаа `mm`-ээр хатуу тул
 * үсгийн шахалтад ОГТ хамаарахгүй. 10mm нь албан бланкны ердийн хэмжээ бөгөөд
 * 27px чөлөөлнө.
 */
const LOGO_INK_MM = 10;
/** Логоны доорх зурвас хүртэлх зай, дараа нь хүснэгт хүртэлх зай (mm). */
const HEAD_PAD_MM = 3;
/** ⚠️ 2026-08-19: 5 → 3 (мөн босоо төсөв — дээрх тайлбарыг үз). */
const HEAD_GAP_MM = 3;

/** `<img>`-ийн бодит өндөр: ink-ийг зорилтот хэмжээнд хүргэх томсголт. */
const LOGO_IMG_H_MM = (LOGO_INK_MM * LOGO_VIEWBOX_H) / LOGO_INK_H;
/** Ink-ийн дээд/доод талын хоосон зай — сөрөг зайгаар хасагдана. */
const LOGO_MARGIN_Y_MM = (LOGO_IMG_H_MM * ((LOGO_VIEWBOX_H - LOGO_INK_H) / 2)) / LOGO_VIEWBOX_H;
/** Ink-ийн зүүн/баруун талын хоосон зай (зураг нь голлосон тул хоёр тал тэнцүү). */
const LOGO_MARGIN_X_MM =
  ((LOGO_IMG_H_MM * LOGO_VIEWBOX_W) / LOGO_VIEWBOX_H) *
  ((LOGO_VIEWBOX_W - LOGO_INK_W) / 2 / LOGO_VIEWBOX_W);

/**
 * Хуудас бүрийн толгойн эзлэх өндөр — БОСОО филийн тооцооны оролт.
 * ⚠️ Логоны хэмжээнээс ГАРНА: тогтмол тоо бичвэл лого томсоход фил хэтрүүлж
 * сунгаад агуулга 2 дахь хуудас руу халина.
 */
const PAGE_HEAD_PX = Math.round((LOGO_INK_MM + HEAD_PAD_MM + HEAD_GAP_MM) * MM_TO_PX);
/**
 * «Захиалагч: …» мөрийн эзлэх БОСОО зай (мм) — бичвэрийн өндөр + доод зай.
 * `CLIENT_FONT_PT × 1.3` мөрийн өндөр + `CLIENT_GAP_MM`. Босоо филийн төсвөөс
 * хасагдана (`sheetPrintMetrics`); мөр гарахгүй бол нөөц ч тавигдахгүй.
 */
const CLIENT_FONT_PT = 10;
const CLIENT_GAP_MM = 1.8;
const CLIENT_LINE_MM = ((CLIENT_FONT_PT * 25.4) / 72) * 1.3 + CLIENT_GAP_MM;

/**
 * ХҮСЭМЖИТ (хамгийн том) үсгийн хэмжээ — засварлагчийн `text-xs` = 12px = 9pt.
 * Багана нь агуулгадаа багтаж байвал баримт ЭНЭ хэмжээгээр хэвлэгдэнэ.
 */
const BASE_FONT_PT = 9;
/** pt → px (@96dpi). */
const PT_TO_PX = 96 / 72;

/**
 * ӨГӨГДЛИЙН мөрийн зай (бүгд `em`, өөрөөр хэлбэл үсэгтэй хамт масштаблана).
 */
const LINE_HEIGHT = 1.25;
/** `py`: 2px @12px = 0.53mm. */
const PAD_Y_EM = 2 / 12;
/** `px`: 5px @12px = 1.32mm — текст хүрээндээ наалдахгүй хамгийн бага зай. */
const PAD_X_EM = 5 / 12;
/**
 * ТООН нүдний хажуугийн зай. Текстэн нүднээс нарийн — тоо нь хамгийн урт
 * агуулга тул баганы өргөнийг тэр л тогтоодог, зай нь шууд орон болж хувирна.
 *
 * ⚠️ `lib/printFit.ts`-ийн `NUM_PAD_X_EM`-тэй ЯГ ижил байх ЁСТОЙ — тэнд баганы
 * хэрэгцээг тооцохдоо энэ зайг нэмдэг. Зөрвөл тооцоо худал болж тасралт
 * эргэж ирнэ.
 */
const NUM_PAD_X_EM = 0.24;
/**
 * Мөрийн ДООД өндөр (em). `SheetGrid` нь `<tr style="height:28px">` гэж ХАТУУ
 * бичдэг ба тэр нь масштаблагддаггүй — `!important`-оор дарж, үсгийн хэмжээнээс
 * хамаарсан утга тавина. 1.75 × 12px = 21px ≈ 5.6mm.
 *
 * ⚠️ 0 болгож болохгүй: босоо нэгтгэл (`rowSpan`) үед ДАРАГДСАН мөр өөрийн
 * нүдгүй болдог тул доод хязгааргүй бол 0 өндөртэй болж нэгтгэсэн блок хумигдана.
 */
const ROW_MIN_EM = 1.75;

/**
 * УНШИГДАХУЙЦ доод хэмжээ (pt). 6.5pt = 2.29mm үсгийн өндөр — албан баримтын
 * хүлээн зөвшөөрөгдөх доод хязгаар. Багана агуулгадаа багтаж байвал үүнээс
 * ДЭЭШ (`BASE_FONT_PT` хүртэл) чөлөөтэй өснө.
 */
const MIN_FONT_PT = 6.5;
/**
 * ТУЙЛЫН доод хэмжээ (pt). Эндээс доош ХЭЗЭЭ Ч буухгүй — оронд нь тасралтыг
 * зөвшөөрч, `FitResult.clipped`-ээр дуудагчид мэдэгдэнэ (чимээгүй өнгөрөхөөс
 * харагдахуйц муу баримт дээр ч дээр). Практикт 26 багана × 12 оронтой дүн
 * гэх мэт туйлын тохиолдолд л хүрнэ.
 */
const FLOOR_FONT_PT = 5.5;

/* --- ШУГАМЫН ЗУЗААН -------------------------------------------------------
 * ⚠️ ХОЁР ХАТУУ БАРИМТ, хэвлэсэн PDF-ийг 600dpi-д растержуулж ХЭМЖСЭН:
 *
 * 1. **Chromium `border-width`-ийг 1 CSS px-ээс доош буулгадаггүй.** 0.35px ·
 *    0.5px · 0.7px гурвуулаа PDF дээр ЯГ ижил зурагдсан.
 * 2. **Тор нь ДАВХАРЛАЖ 2px болдог байсан.** `border-collapse: separate` тул
 *    хөрш ХОЁР нүд тус тусдаа 1px зурж, дунд нь 1.92 CSS px бэх гардаг байв.
 *
 * Шийдэл: нүд бүр зөвхөн ДООД+БАРУУН талаа зурна, зүүн ба дээд ГАДНА ирмэгийг
 * тусдаа сонгогчоор нэмнэ. Үр дүн: тор жигд 1px = 0.26mm.
 *
 * ⚠️ `background`-аар зурсан шугам (нийлбэрийн блокийн gradient-ууд) энэ
 * хязгаарт ОРОХГҮЙ — тэнд бутархай px бүтнээрээ зурагдана.
 */
const GRID_LINE_PX = 1;
/**
 * Толгой ↔ өгөгдлийн зааг.
 *
 * ⚠️ 2026-08-24: 2 → `GRID_LINE_PX`. Хэрэглэгчийн шийдвэр — «нийт дүнгээс
 * бусад бүх шугам НЭГ ижил нарийхан байх». Толгойн эгнээ нь аль хэдийн саарал
 * ДЭВСГЭР + 700 жинтэй тул зузаан зураас нэмэлт мэдээлэл өгөхгүй, зөвхөн
 * баримтыг тэгш бус харагдуулж байв.
 */
const HEADER_RULE_PX = GRID_LINE_PX;
/**
 * ЦОРЫН ГАНЦ ЗУЗААН ШУГАМ — НИЙТ ДҮН-гийн мөрийн ДЭЭД зураас.
 *
 * Баримт дээр «энэ бол эцсийн тоо» гэдгийг заах ганц хараа. Өөр ХААНА Ч
 * `GRID_LINE_PX`-ээс зузаан шугам байх ёсгүй (2026-08-24-ний шийдвэр).
 */
const TOTAL_RULE_PX = 2;
/** Бланкны зурвас (лого/огнооны доор) — border биш GRADIENT, тиймээс 0.6px бодит. */
const LETTERHEAD_RULE_PX = 0.6;

/* --- Толгойн мөр --- */
const HEADER_LINE_HEIGHT = 1.15;
const HEADER_PAD_Y_EM = 0.22;
const HEADER_PAD_X_EM = 0.2;
/**
 * Толгойн үсэг өгөгдлөөс 4% ЖИЖИГ. Тодролыг ЖИНГЭЭР (700) ба ДЭВСГЭРЭЭР өгч
 * байгаа тул хэмжээг өчүүхэн буулгах нь харагдацад мэдэгдэхгүй, харин нарийн
 * баганад урт кирилл нэр томьёо тасрахаас аврана.
 */
const HEADER_FONT_EM = 0.96;
/**
 * Толгойн нүдний ДЭЭД мөрийн тоо — «зугтаалтаас» хамгаалах хаалт. `wrap: true`
 * + нарийн багана хосолбол урт шошго 12+ мөр болж задарч толгойн эгнээ
 * баримтын эхний хуудсыг бүхэлд нь иддэг. Бодит шошго 3-4 мөрөөс хэтэрдэггүй.
 */
const HEADER_MAX_LINES = 6;

/* --- БОСОО ФИЛ (хуудасны доод хагасыг дүүргэх) ------------------------------
 * Асуудал: баганы тоо нь ХӨНДЛӨН масштабыг тогтоодог, гэтэл БОСОО хэмжээст тэр
 * масштаб огт хамаагүй. Үр дүнд нь богино баримт A4 хэвтээгийн дээд хагаст
 * шахагдаж, доод хагас нь цоо хоосон үлддэг.
 *
 * Шийдэл: хуудсанд БАГТААД илүү гарсан босоо зайг мөрийн доод өндөрт эргүүлж
 * тараана. Үсгийн хэмжээг өсгөхгүй (тэр нь хөндлөн тасралт үүсгэнэ).
 */
/** Мөрийн өндрийн дээд үржүүлэгч — цөөхөн мөртэй хуудас «зурвасжихаас» хамгаална. */
const MAX_FILL = 1.55;
/** Тооцооллын алдааны нөөц: 8% — 2 дахь хуудас руу «дуслахаас» сэргийлнэ. */
const FILL_SAFETY = 0.92;
/** Гарчгийн мөр (1.6em + доод зай) хэдэн ердийн мөр эзлэх вэ. */
const TITLE_ROW_EQ = 2.3;
/** Толгойн мөр (2-3 мөр бичиг ороосон) хэдэн ердийн мөр эзлэх вэ. */
const HEADER_ROW_EQ = 2.6;
/** ХООСОН (нэг ч нүдгүй) заагч мөр — цаасан дээр нимгэн зурвас. */
const EMPTY_ROW_EQ = 0.55;

/* --- ГАРЫН ҮСЭГ · ТАМГА ---------------------------------------------------
 * Зохиомж (лавлагаа баримтын дагуу):
 *     БОЛОВСРУУЛСАН:            ← хуудасны НҮД (зүүн талд)
 *     «Эм Жи Эл И Эн Си» ХХК-ийн
 *     Төслийн менежер:   ____[гарын үсэг + тамга]____   /Б.Энхмаа/
 */
/** Гарын үсгийн зураасны урт (mm). */
const SIGN_LINE_MM = 64;
/**
 * Гарын үсгийн зургийн ДЭЭД өндөр (mm).
 *
 * Түүх (бүгд 2026-08-17, хэрэглэгчийн шууд заавраар):
 *   13 → 18 («жижиг байна») → 15 («арай том байна») → 12 («still too big»)
 *   → 13.5 («12 нь бодсоноос жижиг, бага зэрэг томсго»).
 * Өөрөөр хэлбэл 15mm нь ХЭТ ТОМ, 12mm нь ХЭТ ЖИЖИГ гэж баталгаажсан —
 * 13.5mm нь тэр хоёрын дундаж. Дахин тохируулах бол ЗӨВХӨН энэ тоог зас.
 */
const SIGN_IMG_MM = 17;
/**
 * Тамганы өндөр (mm) — 40mm (4cm × 4cm).
 */
const STAMP_MM = 40;
/**
 * Тамга нь гарын үсгийн ЗУРААСАН ДЭЭР ГОЛЛОЖ дарагдана — бодит баримт дээр яг
 * ингэж дардаг, мөн тамганы гол дахь «MGL E&C» бичиг зураас дээр таарна
 * (хэрэглэгчийн шаардлага 2026-08-17). Тиймээс тамганы доод ирмэг зураасны
 * доор ЯГ хагасаараа гарна.
 */
const STAMP_BELOW_LINE_MM = STAMP_MM / 2;
/**
 * Хүснэгт ↔ гарын үсгийн блокийн хоорондох зай (mm).
 */
const SIGN_TOP_GAP_MM = 10;
/* --- Гарын үсгийн блокийн ГАРЧИГ («БОЛОВСРУУЛСАН:») ---
 * ⚠️ Эдгээрийг CSS (`.quote-print__sign-head`) БА доорх `SIGN_RESERVE_MM`
 * ХОЁУЛАА уншина — тогтмолыг сольход зохиомж ба нөөц ХАМТ дагана. */
const SIGN_HEAD_FONT_PT = 9.5;
/** ⚠️ 2026-08-19: 3 → 1.5mm (босоо төсөв). */
const SIGN_HEAD_GAP_MM = 1.5;
/** Гарчгийн мөрийн эзлэх өндөр (mm) — pt→mm, ердийн мөрийн өндөр 1.2. */
const SIGN_HEAD_H_MM = ((SIGN_HEAD_FONT_PT * 25.4) / 72) * 1.2 + SIGN_HEAD_GAP_MM;
/**
 * `.quote-print__sign-row`-ийн БҮТЭН өндөр (mm) — CSS-ийн дүрмээс ЯГ гарна:
 * `padding-top` + зураасны өндөр (`height: SIGN_IMG_MM`) + `padding-bottom`.
 */
const SIGN_ROW_H_MM =
  Math.max(0, STAMP_BELOW_LINE_MM - SIGN_IMG_MM) + SIGN_IMG_MM + STAMP_BELOW_LINE_MM;
/**
 * БОСОО ФИЛД үлдээх НӨӨЦ (mm) — гарын үсгийн блокийн БҮТЭН өндөр.
 *
 * ⚠️ 2026-08-17: блок УРСГАЛД орсон тул нөөц нь зөвхөн тамганы цухуйлт биш,
 * блокийн бүх бүрэлдэхүүнийг хамрах ёстой. Дутуу тооцвол босоо фил мөрүүдийг
 * хуудасны ёроол хүртэл сунгаад блокийг 2 дахь хуудас руу түлхэнэ.
 *
 * ⚠️⚠️ 2026-08-19-Д ЗАССАН АЛДАА. Өмнө нь энэ нь ГАРААР бичсэн ойролцоолол
 * байв: `SIGN_TOP_GAP + 6 + SIGN_IMG + max(0, STAMP_BELOW − 6)` = 44mm. Бодит
 * блок нь 51mm (10 + 7.0 гарчиг + 34 мөр) — өөрөөр хэлбэл нөөц 7mm ДУТУУ, фил
 * тэр хэмжээгээр илүү сунгах эрхтэй гэж боддог байв. «Тамганы доод хагас
 * хуудасны захыг ашиглана» гэсэн 6mm хөнгөлөлт нь БУРУУ: `padding-bottom` нь
 * урсгалд бодит зай эзэлдэг тул захад цухуйх боломжгүй.
 *
 * Одоо нөөц нь CSS-ийн бүрэлдэхүүнүүдээс ДЕРИВАТИВААР гарна — зохиомж ба
 * тооцоо зөрөх нь ЗАРЧМЫН ХУВЬД боломжгүй.
 */
const SIGN_RESERVE_MM = SIGN_TOP_GAP_MM + SIGN_HEAD_H_MM + SIGN_ROW_H_MM;

/**
 * Хуудасны ДООД ХЭМЖЭЭ (mm). Богино баримт дээр хуудсыг А4-ийн бүтэн өндөрт
 * хүргэснээр `@media print`-ийн хуудас таслалт тогтвортой болж, доод талын
 * чөлөөт бичвэр (тайлбар · БОЛОВСРУУЛСАН) цаасны дундуур «хөвөхгүй».
 * ⚠️ 182mm-ээс БАГА байх ёстой — яг тэнцүү бол бутархай алдаа 2 дахь хуудас
 * төрүүлж болзошгүй.
 */
const SHEET_MIN_H_MM = PRINT_CONTENT_H_MM - 2;

/** `A12` → 12. Мөрийн дугаарыг нүдний лавлагаанаас салгана. */
function rowOfRef(ref: string): number {
  const m = /(\d+)$/.exec(ref);
  return m ? Number(m[1]) : 0;
}

/**
 * ХЭВЛЭМЭЛЭЭС нуух баганууд.
 *
 * ⚠️ Нуух нь УСТГАХААС зарчмын ялгаатай — эдгээр багана ДҮН-г жолооддог тул
 * устгавал үнэ өөрчлөгдөнө. Зөвхөн зурагдахгүй, томьёо бүрэн ажилласаар.
 *   • Хэсгийн 7 багана — дотоод задаргаа (мэргэжлээр хуваасан нэг үнэ).
 *   • Нэмэгдлийн «Дүн /төг/» — ЗТАҮ + нэмэгдлүүдийн дэд дүн; захиалагчид
 *     эцсийн «Нийт үнэ» л хэрэгтэй (2026-08-12, хэрэглэгчийн шийдвэр).
 *
 * ⚠️ `QuotePrintPage` ба энэ файл ХОЁУЛАА эндээс уншина — зохиомжийн тооцоо
 * (баганы өргөн, `colspan`, `nth-child`) нь ХАРАГДАХ баганаар явдаг тул хоёр
 * тал өөр жагсаалт барих нь өмнө нь бүх бүтцийн сонгогчийг эвдэж байсан.
 */
export function printHiddenCols(sheet: SheetDoc): ReadonlySet<number> {
  const out = new Set<number>(sectionCols(sheet));
  // PM-ийн тухайн саналд унтраасан сонгомол бүлгүүд («Өндөр» г.м.). Засварлагч
  // (`QuoteEditorPage`) ба Excel мөн ЯГ ЭНЭ функцээс уншина — гурван гаралт
  // хэзээ ч зөрөхгүй. Дэлгэрэнгүйг `lib/optionalCols.ts`-ээс үз.
  for (const c of hiddenGroupCols(sheet)) out.add(c);
  const spec = sheet.addons;

  /* ⚠️⚠️ 2026-08-17-Д ЗАССАН НОЦТОЙ АЛДАА — БУЦААЖ БҮҮ ЭВД.
   * Өмнө нь `addonTotalCol(spec)` нь НӨХЦӨЛГҮЙ нуугддаг байв. «Хяналтын
   * төсөв» (26 багана) дээр тэр нь ЗӨВ: тэнд «Дүн /төг/» бол ДУНДЫН дэд дүн
   * бөгөөд түүний баруун талд АЗ-ийн 7 хэсэг + эцсийн «Нийт үнэ» багана бий.
   *
   * Харин ҮНДСЭН загвар (migration 0130, 13 багана) дээр хэсгийн багана
   * БАЙХГҮЙ тул `addonTotalCol = baseCol(7) + items(4) + 1 = 12` нь ЯГ
   * «Нийт зураг төслийн ажлын үнэ /төг/» буюу баримтын ГАНЦ мөнгөн багана
   * болно — ДҮН · МЕНЕЖМЕНТ 2% · НӨАТ 10% · НИЙТ ҮНЭ бүгд түүн дотор сууна
   * (anchors: total = M13, subtotal = M10). Өөрөөр хэлбэл хэвлэмэл ба PDF нь
   * баримтын БҮХ ҮНИЙГ чимээгүй хаядаг байв.
   *
   * Хоёр хамгаалалт:
   *   1. Дэд дүнг ЗӨВХӨН хэсгийн багана байгаа үед нуана — тэр үед л түүний
   *      баруун талд эцсийн дүн бий.
   *   2. ANCHOR (`total` / `subtotal`) агуулсан баганыг ХЭЗЭЭ Ч нуухгүй.
   *      Anchor бол «энэ нүд бол баримтын дүн» гэсэн илэрхий тэмдэглэгээ.
   */
  if (spec && (spec.sections?.items.length ?? 0) > 0) out.add(addonTotalCol(spec));

  for (const key of ['total', 'subtotal'] as const) {
    const ref = sheet.anchors?.[key];
    if (!ref) continue;
    const co = refToCoord(ref);
    if (co) out.delete(co.c);
  }

  // Хамгаалалт: бүх баганыг нуух нь хоосон хуудас гаргана.
  if (out.size >= Math.max(1, sheet.cols | 0)) return new Set<number>();
  return out;
}

/** Хэвлэмэлд ХАРАГДАХ баганы индексүүд, зүүнээс баруун тийш. */
export function printVisibleCols(sheet: SheetDoc): number[] {
  const hidden = printHiddenCols(sheet);
  const out: number[] = [];
  for (let c = 0; c < Math.max(0, sheet.cols | 0); c += 1) if (!hidden.has(c)) out.push(c);
  return out;
}

/** `[c, c+cs)` мужид ХЭДЭН харагдах багана байгаа вэ (`SheetGrid.visibleSpan`-тай ижил). */
function visibleSpan(sheet: SheetDoc, c: number, cs: number): number {
  const hidden = printHiddenCols(sheet);
  const end = Math.min(c + cs, sheet.cols);
  let n = 0;
  for (let i = c; i < end; i += 1) if (!hidden.has(i)) n += 1;
  return Math.max(1, n);
}

/**
 * Хуудасны БОСОО «мөрийн эквивалент» — бодит өндрийг ойролцоолно.
 * Толгой ба гарчиг нь ердийн мөрөөс 2-3 дахин өндөр учир жинтэй тооцно.
 */
function rowEquivalents(sheet: SheetDoc): { eq: number; emptyRows: number } {
  const rows = Math.max(1, sheet.rows | 0);
  const headerRows = new Set<number>();
  const filledRows = new Set<number>();
  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    const r = rowOfRef(ref);
    if (!r) continue;
    filledRows.add(r);
    if (cell?.s?.bg === 'header') headerRows.add(r);
  }
  const titleRow = sheet.merges?.some((m) => m.r === 0 && m.cs >= sheet.cols) ? 1 : 0;

  let eq = 0;
  let emptyRows = 0;
  for (let r = 1; r <= rows; r += 1) {
    if (r === titleRow) eq += TITLE_ROW_EQ;
    else if (headerRows.has(r)) eq += HEADER_ROW_EQ;
    else if (!filledRows.has(r)) {
      eq += EMPTY_ROW_EQ;
      emptyRows += 1;
    } else eq += 1;
  }
  return { eq, emptyRows };
}

/** `quotePrintCss`-ийн нэмэлт оролт — хэмжсэн зохиомж ба хуудасны нөхцөл. */
export interface PrintCssOptions {
  /**
   * Хуудасны `id` → `lib/printFit.ts`-ийн шийдэл. Байхгүй хуудас нь хуучин
   * (агуулга мэдэхгүй) тооцоонд буцаж унана — canvas байхгүй орчинд ч хуудас
   * зурагдана.
   */
  fits?: ReadonlyMap<string, FitResult>;
  /** Гарын үсэг · тамга гарах эсэх — БОСОО филд нөөц үлдээхэд хэрэгтэй. */
  hasSign?: boolean;
  /**
   * «Захиалагч: …» мөр гарах эсэх. Тэр мөр нь `PAGE_HEAD_PX` (лого + огноо)
   * -ийн ГАДНА, хүснэгтийн ДЭЭР сууна тул босоо төсвөөс тусад нь хасагдана —
   * эс бөгөөс фил нь мөрүүдийг хэтэрхий сунгаж баримт 2 дахь хуудас руу халина.
   */
  hasClient?: boolean;
  /**
   * Босоо тааруулалт: үсгийн хэмжээг энэ коэффициентээр үржүүлнэ (≤ 1).
   * `QuotePrintPage` нь зурсны дараа бодит өндрийг хэмжиж, нэг хуудсанд
   * багтаахын тулд шаардвал буулгана.
   */
  fontScale?: number;
}

/** Нэг ХУУДСАНД зориулсан оролт — дэвтрийн түвшний `fits` шийдэгдсэн байна. */
export interface SheetMetricsOptions extends Omit<PrintCssOptions, 'fits'> {
  /** Тухайн хуудасны хэмжсэн шийдэл (`lib/printFit.ts`). */
  fit?: FitResult;
}

export interface SheetPrintMetrics {
  /** ХАРАГДАХ багана тус бүрийн эцсийн өргөн (px). */
  widths: number[];
  /** `widths`-ийн нийлбэр. */
  totalPx: number;
  /** Үсгийн хэмжээ (pt). */
  fontPt: number;
  /** Мөрийн доод өндөр (px) — `tr`-ийн inline 28px-ийг дарна. */
  rowMinPx: number;
  /** Хоосон заагч мөрийн өндөр (px) — өгөгдлийн мөрөөс нимгэн. */
  emptyRowPx: number;
  /** Хуудасны өргөнийг бүрэн эзлүүлэх үү. */
  stretch: boolean;
}

/**
 * Хуудсын хэвлэлтийн хэмжээсүүд.
 *
 * `opts.fits` байвал өргөн ба үсгийн хэмжээ АГУУЛГААС хэмжигдсэн шийдлээс
 * гарна (тасралт БОЛОМЖГҮЙ). Байхгүй бол хуучин, зөвхөн зохиомжийн өргөнд
 * тулгуурласан ойролцоолол руу буцна.
 */
export function sheetPrintMetrics(
  sheet: SheetDoc,
  opts: SheetMetricsOptions = {},
): SheetPrintMetrics {
  const visible = printVisibleCols(sheet);
  const design = visible.map((c) => {
    const w = sheet.colWidths?.[c];
    return Number.isFinite(w) && (w as number) > 0 ? (w as number) : DEFAULT_COL_W;
  });
  const fit = opts.fit;
  const scaleFont = opts.fontScale ?? 1;

  let widths: number[];
  let fontPt: number;
  let stretch: boolean;

  if (fit && fit.widthsPx.length === visible.length) {
    widths = fit.widthsPx;
    fontPt = fit.fontPt * scaleFont;
    stretch = true; // шийдэл нь яг `PRINT_CONTENT_PX`-д тааруулагдсан
  } else {
    // ── Нөөц зам: агуулга хэмжигдээгүй (canvas алга / хуудас хоосон) ──
    const totalDesign = design.reduce((a, b) => a + b, 0);
    const scale = totalDesign > PRINT_CONTENT_PX ? PRINT_CONTENT_PX / totalDesign : 1;
    widths = design;
    fontPt = Math.max(MIN_FONT_PT, BASE_FONT_PT * scale) * scaleFont;
    stretch = totalDesign >= PRINT_CONTENT_PX * 0.82;
  }
  fontPt = Number(Math.max(FLOOR_FONT_PT, fontPt).toFixed(3));

  // ⚠️ `fontPt`-оос гаргана: мөрийн өндөр текстээсээ доогуур унах ёсгүй.
  const baseRowPx = ROW_MIN_EM * fontPt * PT_TO_PX;

  // ── Босоо фил ───────────────────────────────────────────────────────────
  // Хуудсанд багтах өндөр / ойролцоолсон байгалийн өндөр = сул зайн харьцаа.
  // 1-ээс бага бол (урт баримт) огт хөндөхгүй — мөрөө сунгавал зөвхөн нэмэлт
  // хуудас төрүүлнэ.
  const { eq } = rowEquivalents(sheet);
  const reservePx =
    (opts.hasSign ? SIGN_RESERVE_MM : 0) * MM_TO_PX +
    (opts.hasClient ? CLIENT_LINE_MM * MM_TO_PX : 0);
  const availPx = (PRINT_CONTENT_H_PX - PAGE_HEAD_PX - reservePx) * FILL_SAFETY;
  const naturalPx = eq * baseRowPx;
  const fill = Math.min(MAX_FILL, Math.max(1, naturalPx > 0 ? availPx / naturalPx : 1));

  return {
    widths,
    totalPx: widths.reduce((a, b) => a + b, 0),
    fontPt,
    rowMinPx: Number((baseRowPx * fill).toFixed(2)),
    emptyRowPx: Number((baseRowPx * fill * EMPTY_ROW_EQ).toFixed(2)),
    stretch,
  };
}

/** `fitColumns`-д дамжуулах тохиргоо — тогтмолуудыг нэг эх сурвалжаас гаргана. */
export const FIT_OPTIONS = {
  availPx: PRINT_CONTENT_PX,
  maxFontPt: BASE_FONT_PT,
  minFontPt: MIN_FONT_PT,
  floorFontPt: FLOOR_FONT_PT,
  linePx: GRID_LINE_PX,
  ptToPx: PT_TO_PX,
} as const;

/** `td[class~="text-danger"]` — НИЙТ ДҮН ба ХӨНГӨЛӨЛТ үсгийн хэмжээ. */
const DANGER_FONT_EM = 1.02;

/**
 * ДҮНГИЙН БЛОКИЙН зүүн ирмэг (хүснэгтийн өргөний хувиар).
 *
 * ДҮН / НӨАТ / НИЙТ ДҮН мөрүүд нь «нэгтгэсэн нүд + сүүлийн баганын дүн» гэсэн
 * бүтэцтэй. Блокийн өргөнийг түүнд агуулагдах хамгийн урт шошго («ХӨНГӨЛӨЛТ
 * ХАССАН НИЙТ ДҮН», «Менежментийн зардал /2%/» г.м.) бүрэн багтахаар
 * хэмжиж (textWidthEm), хүснэгтийн баганы босоо заагтай тааруулна.
 */
export function summaryBlockStartPct(
  sheet: NamedSheet,
  widths: number[],
  totalPx: number,
  fontPt: number,
  ptToPx: number,
): number {
  let maxLabelPx = 0;
  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    if (!cell?.v || typeof cell.v !== 'string') continue;
    const co = refToCoord(ref);
    if (!co || co.c !== 0) continue;
    // Баруун эгнээтэй нэгтгэсэн шошгын нүднүүд
    if (cell.s?.align === 'right') {
      const danger = cell.s?.color === 'danger';
      const mult = danger ? DANGER_FONT_EM : 1;
      const weight = cell.s?.bold ? 600 : 400;
      const wEm = textWidthEm(cell.v, weight);
      const px = wEm * mult * fontPt * ptToPx + PAD_X_EM * 2 * fontPt * ptToPx + 24;
      if (px > maxLabelPx) maxLabelPx = px;
    }
  }

  const lastColW = widths[widths.length - 1] ?? 0;
  const requiredPx = lastColW + maxLabelPx;
  const target = Math.max(totalPx * 0.24, requiredPx);

  let acc = 0;
  for (let i = widths.length - 1; i >= 0; i -= 1) {
    acc += widths[i] ?? 0;
    if (acc >= target) break;
  }
  return ((totalPx - acc) / (totalPx || 1)) * 100;
}

function sheetLayoutCss(sheet: NamedSheet, scope: string, opts: PrintCssOptions): string {
  const { widths, totalPx, fontPt, rowMinPx, emptyRowPx, stretch } = sheetPrintMetrics(sheet, {
    hasSign: opts.hasSign,
    hasClient: opts.hasClient,
    fontScale: opts.fontScale,
    fit: opts.fits?.get(sheet.id),
  });
  const visible = printVisibleCols(sheet);
  const denom = totalPx || 1;
  const cols = widths
    .map(
      (w, i) =>
        `${scope} .quote-print__grid col:nth-child(${i + 1}) { width: ${((w / denom) * 100).toFixed(4)}% !important; }`,
    )
    .join('\n');

  const tableWidth = stretch ? '100%' : `min(100%, ${totalPx || PRINT_CONTENT_PX}px)`;

  /* ── БӨГЛӨӨГҮЙ ЗАГВАРЫН МӨР ────────────────────────────────────────────
   * «Нэр» ба «тоо хэмжээ» хоёулаа хоосон атлаа томьёо нь 0 буцаадаг мөр
   * (загварын нөөц мөр) баримтыг 0-уудаар бохирдуулдаг. Мөрийг НУУХГҮЙ —
   * зөвхөн өнгийг сулруулж хоёрдогч болгоно.
   *
   * ⚠️⚠️ nth-child нь DOM-ийн БАЙРЛАЛ, баганы индекс БИШ:
   *   • НУУГДСАН багана DOM-д огт байхгүй → индекс ЗҮҮН тийш шилжинэ,
   *   • `colspan` бүр дараагийн бүх nth-child-ыг шахна,
   *   • дээрх мөрийн `rowspan`-д дарагдсан нүд рендэрлэгддэггүй.
   * Тиймээс баганы индексийг ХАРАГДАХ жагсаалт дээр эргүүлж бодно, мөн дүрмийг
   * ЗӨВХӨН зураглал нь БАТТАЙ мөрүүдэд хэрэглэнэ:
   * `:has(> td:nth-child(N))` = td-ийн тоо бүтэн БА `:not(:has(> td[colspan]))`.
   */
  const cl = sheet.addons?.costLines;
  const labelNth = visible.indexOf(cl?.labelCol ?? 1) + 1;
  const qtyNth = visible.indexOf(cl?.qtyCol ?? 3) + 1;
  /** Мөр «бүтэн» гэдгийн шалгуур — ХАРАГДАХ сүүлийн баганад td байх ёстой. */
  const cellCols = Math.max(1, visible.length);

  /* ── Нийлбэрийн блок ─────────────────────────────────────────────────────
   * Нийлбэрийн мөрийг «бүх баганаас нэгээр цөөн нэгтгэсэн, баруун эгнээтэй»
   * бүтцээр таана. ⚠️ `colspan` нь ХАРАГДАХ баганаар тоологддог тул `sheet.cols - 1`
   * биш, түүний ХАРАГДАХ эквивалентыг авна. */
  const sumSpan = visibleSpan(sheet, 0, Math.max(1, (sheet.cols | 0) - 1));
  const sumRow = `tr:has(> td[colspan="${sumSpan}"])`;

  const unfilledRow =
    labelNth > 0 && qtyNth > 0
      ? `${scope} .quote-print__grid tr:has(> td[class~="border"]):has(> td:nth-child(${cellCols})):not(:has(> td[colspan])):has(> td:nth-child(${labelNth}) > span:empty):has(> td:nth-child(${qtyNth}) > span:empty):has(> td[class~="tabular-nums"] > span:not(:empty)) > td {
  color: hsl(215 14% 62%) !important;
}`
      : '';

  return `
/* --- Хуудаснаас тооцоолсон зохиомж (${visible.length} харагдах багана → ${PRINT_CONTENT_PX.toFixed(0)}px, ${fontPt}pt) --- */
${scope} .quote-print__grid > table {
  /* inline style-ыг дарахын тулд !important заавал. */
  width: ${tableWidth} !important;
  margin: 0 auto;
  font-size: ${fontPt}pt !important;
  /* text-xs-ийн 16px мөрийн өндөр ТОГТМОЛ px тул үсэгтэй хамт багасахгүй —
     нэгжгүй харьцаагаар дахин тавина. */
  line-height: ${LINE_HEIGHT.toFixed(4)} !important;
}
/* ⚠️ SheetGrid нь <tr style="height:28px"> гэж ХАТУУ бичдэг — !important дийлнэ. */
${scope} .quote-print__grid tr {
  height: ${rowMinPx}px !important;
}
/* ХООСОН заагч мөр (нэг ч нүдэнд бичиг байхгүй) — өгөгдлийн мөртэй ижил
   өндөртэй байвал баримт дунд нь «нүх» гарна. Нимгэн зурвас болгоно. */
${scope} .quote-print__grid tr:not(:has(> td > span:not(:empty))) {
  height: ${emptyRowPx}px !important;
}
/* px-1.5 / py-1-ийн ЦААСНЫ хувилбар — em тул үсэгтэй хамт масштаблана. */
${scope} .quote-print__grid td {
  padding: ${PAD_Y_EM.toFixed(4)}em ${PAD_X_EM.toFixed(4)}em !important;
}
/* Тоон нүд — хажуугийн зай нарийн (printFit-ийн NUM_PAD_X_EM-тэй ИЖИЛ). */
${scope} .quote-print__grid td[class~="tabular-nums"] {
  padding-left: ${NUM_PAD_X_EM}em !important;
  padding-right: ${NUM_PAD_X_EM}em !important;
}

/* --- БӨГЛӨӨГҮЙ ЗАГВАРЫН МӨР (дэлгэрэнгүйг дээрх тайлбараас үз) --- */
${unfilledRow}

/* --- ДҮН / МЕНЕЖМЕНТ / НӨАТ / НИЙТ ДҮН: нягт нийлбэрийн блок --- */
/* ⚠️⚠️ 2026-08-24 — ЭНД «border: 1px solid …» ГЭЖ ДӨРВӨН ТАЛЫГ БҮҮ ЗУР.
 * Тэр нь ЯГ ЭНЭ файлын GRID_LINE_PX-ийн тайлбарт бичигдсэн «тор давхарлана»
 * гэсэн алдааг нийлбэрийн блок дээр эргүүлэн үүсгэдэг: «border-collapse:
 * separate» тул шошгын нүдний БАРУУН + дүнгийн нүдний ЗҮҮН = 2px, мөр
 * хоорондын ДООД + ДЭЭД = 2px, хүснэгтийн сүүлийн мөр ↔ ДҮН-гийн заагт бас
 * 2px. Үр дүнд нь баримтын доод блок нь дээд хүснэгтээсээ ХАРАГДАХУЙЦ ЗУЗААН
 * гарч, шугамын зузаан «замбараагүй» болж байв (хэрэглэгчийн санал).
 *
 * Одоо эдгээр мөр нь ердийн торны дүрмийг (ДООД + БАРУУН, эхний нүдэнд ЗҮҮН,
 * блокийн эхэнд ДЭЭД) ЯГ адилхан өвлөнө — өөрөөр хэлбэл ганц ч нэмэлт хүрээ
 * зарлахгүй. Энд зөвхөн БАЙРЛАЛ ба ДЭВСГЭР л тодорхойлогдоно. */
${scope} .quote-print__grid td[colspan="${sumSpan}"] {
  text-align: left !important;
  padding-left: 8px !important;
  padding-right: 8px !important;
}
${scope} .quote-print__grid ${sumRow} > td {
  background: transparent !important;
}
${scope} .quote-print__grid ${sumRow} > td:last-child {
  text-align: right !important;
}
/* ДЭД ДҮН-гийн мөр (Ажлын зургийн үнэ) */
${scope} .quote-print__grid tr:has(> td[class~="bg-muted/40"][class~="text-right"]):not(:has(> td[colspan="${sumSpan}"])) > td {
  background: hsl(var(--muted) / 0.35) !important;
}
/* НИЙТ ДҮН ба ХӨНГӨЛӨЛТ — бүтэн мөр даяар тод дэвсгэр + баримтын ЦОРЫН ГАНЦ
   зузаан шугам (TOTAL_RULE_PX). Бусад бүх шугам GRID_LINE_PX хэвээр тул
   энэ ганц зураас нь «эцсийн тоо» гэдгийг эргэлзээгүй заана. */
${scope} .quote-print__grid ${sumRow}:has(> td[class~="text-danger"]) > td {
  background: hsl(var(--muted) / 0.65) !important;
  border-top-width: ${TOTAL_RULE_PX}px !important;
}
/* ⚠️ «border-collapse: separate» тул дээд мөрийн ДООД зураас ба НИЙТ ДҮН-гийн
   ДЭЭД зураас ХАРИЛЦАН ХУРААГДАХГҮЙ — 1px + 2px = 3px болж дахиад л «хэт
   бүдүүн» болно. Тиймээс өмнөх мөрийн доод зураасыг унтраана: ганцхан
   ${TOTAL_RULE_PX}px үлдэнэ. («:has(+ …)» дэмжигдэхгүй хөтөч дээр энэ дүрэм
   зүгээр л хэрэгжихгүй — шугам арай зузаан гарахаас өөр эвдрэл гарахгүй.) */
${scope} .quote-print__grid tr:has(+ ${sumRow}:has(> td[class~="text-danger"])) > td {
  border-bottom-width: 0 !important;
}
/* Тайлбар блокийн үсгийн хэмжээ хүснэгтийн өгөгдлийн мөртэй («Орон сууц загвар-1») ЯГ ИЖИЛ хэмжээтэй байна */
${scope} .quote-print__notes-block {
  font-size: ${fontPt}pt !important;
  line-height: ${LINE_HEIGHT.toFixed(4)} !important;
}
${cols}
`;
}

/**
 * Тогтмол хэсэг.
 *
 * `@import` нь stylesheet-ийн ХАМГИЙН ЭХНИЙ дүрэм байх ёстой тул энэ мөрийг
 * хэзээ ч доош бүү зөө.
 *
 * ⚠️ ТОДОРХОЙЛОЛТЫН ЖИН: нүдний түвшний дүрмүүд энэ тогтмол блокт байдаг ч,
 * хуудас тус бүрийн `sheetLayoutCss` нь ДАРАА нь залгагддаг бөгөөд
 * `!important`-той ижил жинтэй сонгогч бичдэг. Тиймээс эдгээрийг
 * `.quote-print` угсаагаар нэг шат ДЭЭГҮҮР жинтэй болгож бичив.
 */
const QUOTE_PRINT_BASE_CSS = `
/* Arimo (Arial-ийн хэмжээст ижил) + Noto Sans — Cloudflare Browser Rendering-ийн
   headless Chromium-д Arial байхгүй тул ү/ө зэрэг кирилл глиф glyph-fallback-д
   орж эвдэрдэг. Вэб фонтоор бүх глифийг нэг гарнитураар зурна.
   ⚠️ lib/printFit.ts-ийн FONT_STACK ЯГ ИЖИЛ байх ЁСТОЙ — тэнд баганы
   өргөнийг энэ фонтоор хэмждэг. */
@import url('https://fonts.googleapis.com/css2?family=Arimo:wght@400;700&family=Noto+Sans:wght@400;700&display=swap');

/* ⚠️ A4 ХЭВТЭЭ. Захууд нь backend/src/routes/quotes.ts-ийн
   page.pdf({ format:'A4', landscape:true, margin:{ top:14mm, right:12mm,
   bottom:14mm, left:12mm } })-тэй ЯГ таарна: ямар нэг @page дүрэм зарлагдмагц
   Chromium CSS-ийн хуудасны загварт шилждэг бөгөөд puppeteer-ийн margin нь
   агуулгыг дотогш түлхэхээ болино. */
@page { size: A4 landscape; margin: ${PAGE_MARGIN_Y_MM}mm ${PAGE_MARGIN_X_MM}mm; }

.quote-print {
  /* Баримтын шугамууд: index.css-ийн гэрэл горимын --border (34 9% 76%) нь
     цаасан дээр бүдгэрдэг. cellClass-ыг хөндөхгүйгээр ЗӨВХӨН токеныг нь энэ
     хуудсанд дахин тодорхойлно — дэлгэц ба PDF хоёул ижил хэвээр. */
  --border: 220 13% 30%;
  /* Мөн адил: --muted (гэрэл горимд 210 40% 96%) нь дэлгэц дээр л зөв —
     цаасан дээр 0.6 тунгалагтайгаар бараг цагаан болно. Токеныг л бараан
     болгоно: bg-muted/40 (бүлэг) → #e3e8ee, bg-muted/60 (толгой) → #d5dce5,
     bg-muted (нийт дүн) → #b9c5d5 гэсэн 3 ШАТЛАЛТ сүүдэр гарна. */
  --muted: 215 25% 78%;
  background: #fff;
  color: #111;
  /* Дэлгэц дээрх АГУУЛГЫН хайрцаг нь A4-ийн хэвлэгдэх талбайтай ЯГ тэнцүү
     (${PRINT_CONTENT_MM}mm) — масштаб нь PDF-тэйгээ ижил гарна.
     ⚠️ box-sizing: border-box (Tailwind preflight) тул max-width нь padding-ыг
     ЧУУЛНА: агуулга = max-width − 2×${SAFE_PAD_X_MM}mm = ${PRINT_CONTENT_MM}mm. */
  max-width: ${PRINT_CONTENT_MM + 2 * SAFE_PAD_X_MM}mm;
  margin: 0 auto;
  padding: ${SAFE_PAD_Y_MM}mm ${SAFE_PAD_X_MM}mm;
  font-family: 'Arimo', 'Noto Sans', 'Arial', Helvetica, sans-serif;
  /* Толгой/бүлгийн саарал дэвсгэр, хүрээ цаасан дээр гарахын тулд. Өвлөгддөг
     шинж тул доторх бүх нүдэнд үйлчилнэ (page.pdf-д printBackground: true). */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* Нэг гарнитур — доторх бүх нүд/товч фонтоо өвлөнө. */
.quote-print * { font-family: inherit !important; }

/* --- Олон хуудас (v3): хуудас бүр ШИНЭ цаасан дээр эхэлнэ --- */
/* Зэргэлдээ сонгогч тул ЭХНИЙ хуудас таслал авахгүй, дараагийнх бүр авна. */
.quote-print__sheet + .quote-print__sheet {
  break-before: page;
  page-break-before: always;
}
/* Богино баримт дээр хуудсыг А4-ийн бүтэн өндөрт хүргэнэ — ингэснээр доод
   талын чөлөөт бичвэр цаасны дундуур «хөвөхгүй», хуудас таслалт тогтвортой. */
.quote-print__sheet {
  position: relative;
  min-height: ${SHEET_MIN_H_MM}mm;
}

/* --- Толгой (хуудас бүрд): зүүнд MGL лого, баруунд огноо --- */
/* Толгойн өндөр нь LOGO_INK_MM + HEAD_PAD_MM + HEAD_GAP_MM — тэр гурав нь мөн
   PAGE_HEAD_PX-ийг тэжээдэг тул лого томсоход босоо фил өөрөө тохирно. */
.quote-print__head {
  display: flex;
  /* ⚠️ flex-END: огноо нь 8.5pt жижиг блок, лого нь 15mm өндөр — flex-start
     үед огноо логоны ДЭЭД ирмэгт наалдаж «хаягдсан» мэт харагддаг байв.
     Доод ирмэгээр нь тэгшилснээр хоёулаа бланкны зурвас дээр НЭГ ШУГАМД
     суух ба толгой цэвэр уншигдана (хэрэглэгчийн санал 2026-08-17). */
  align-items: flex-end;
  justify-content: space-between;
  gap: 12mm;
  /* Бланкны зурвас: лого/огноог баримтын биеэс салгах нимгэн шугам. Албан
     бичгийн хамгийн хямд бөгөөд хүчтэй дохио.
     ⚠️ border БИШ gradient: Chromium border-ийг 1px-ээс доош буулгадаггүй,
     дэвсгэрээр зурсан шугам тэр хязгаарт орохгүй тул жинхэнэ 0.6px hairline. */
  background-image: linear-gradient(to top, #111 0 ${LETTERHEAD_RULE_PX}px, transparent ${LETTERHEAD_RULE_PX}px);
  background-repeat: no-repeat;
  padding-bottom: ${HEAD_PAD_MM}mm;
  margin-bottom: ${HEAD_GAP_MM}mm;
  /* Толгой хуудасны ёроолд ганцаараа үлдэхээс сэргийлнэ. */
  break-after: avoid;
  page-break-after: avoid;
}
/* Тооцоог LOGO_INK_MM-ийн тайлбараас үз. Эзлэх хайрцаг = ink-ийн хэмжээ. */
.quote-print__logo {
  display: block;
  height: ${LOGO_IMG_H_MM.toFixed(2)}mm;
  width: auto;
  margin: ${(-LOGO_MARGIN_Y_MM).toFixed(2)}mm ${(-LOGO_MARGIN_X_MM).toFixed(2)}mm;
  object-fit: contain;
}
.quote-print__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.8mm;
  text-align: right;
  /* Огнооны суурь шугамыг логоны доод ирмэгтэй нэг түвшинд авчирна. */
  padding-bottom: 0.4mm;
}
.quote-print__date {
  font-size: 9pt;
  line-height: 1.2;
  white-space: nowrap;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
  color: #111;
}

/* --- ЗАХИАЛАГЧ БАЙГУУЛЛАГА (хуудасны гарчгийн ЯГ ДЭЭР) ---
   quotes.client_name нь баримтын ТОЛГОЙН талбар бөгөөд ажлын дэвтэрт
   хадгалагддаггүй — тиймээс хуудасны нүд биш, React мөрөөр зурагдана.
   Гарчиг (A1) төвлөрсөн тул энэ мөр ч төвлөрнө: зүүн эгнээтэй байвал
   баримтын толгой хоёр тийш салж, албан бичгийн тэнцвэр алдагдана.
   ⚠️ Босоо өндөр нь CLIENT_LINE_MM-д тусгагдсан — фонтын хэмжээ эсвэл
   мөр хоорондын зайг өөрчилвөл ТЭР ТОГТМОЛЫГ ч мөн адил өөрчил. */
.quote-print__client {
  margin-bottom: ${CLIENT_GAP_MM}mm;
  font-size: ${CLIENT_FONT_PT}pt;
  line-height: 1.3;
  text-align: center;
  color: #111;
  /* Толгойн мөр хуудасны ёроолд ганцаараа тасрахаас сэргийлнэ. */
  break-after: avoid;
  page-break-after: avoid;
}
.quote-print__client-name {
  font-weight: 700;
}

/* --- Хуудас өөрөө --- */
/* Хүснэгт ба гарын үсгийн блокийн БАЙРЛУУЛАХ СУУРЬ. Гарын үсэг нь хүснэгтийн
   ЁРООЛООС хэмжигдэх ёстой (хуудасны ёроолоос БИШ) — эс бөгөөс богино баримт
   дээр тамга хүснэгтийн дундуур, тэр дундаа НИЙТ ДҮН дээр буудаг (хэмжсэн
   2026-08-17: тамганы төв НИЙТ ДҮН-гийн мөртэй давхцаж байв). */
.quote-print__body { position: relative; }
/* SheetGrid-ийн гаднах див нь overflow-x-auto — хэвлэхэд гүйлгэх зурвас гэж
   байхгүй тул цонхны гадна үлдсэн багана ЗҮГЭЭР Л АЛГА болно. */
.quote-print__grid { overflow: visible !important; }
/* ⚠️ border-collapse: collapse үед Chromium хуваагдсан хүснэгтийн сүүлийн мөрийг
   @page-ийн зах руу цухуйлгадаг (баримтжсан алдаа). SheetGrid аль хэдийн
   border-separate/border-spacing-0-тэй — хэн нэгэн өөрчилвөл эвдрэхээс сэргийлж
   энд дахин баталгаажуулав. */
.quote-print__grid > table {
  border-collapse: separate !important;
  border-spacing: 0 !important;
}
/* --- ХҮСНЭГТИЙН ТАСРАЛТГҮЙ ТОР --- */
/* Зардлын мөрүүд нь зөвхөн хэдхэн нүдтэй — дунд нь нүд ОГТ БАЙХГҮЙ тул хүрээ ч
   зурагддаггүй. Үр дүнд нь цаасан дээр салангид бөөгнөрөл харагдаж баримт
   замбараагүй болдог. Тиймээс ХҮРЭЭТЭЙ нүд агуулсан МӨРИЙН бүх нүдэнд ижил
   hairline тавина — толгойноос доод зардлын мөр хүртэл ТАСРАЛТГҮЙ тор болно.
   ⚠️ ЗӨВХӨН ДООД + БАРУУН тал (GRID_LINE_PX-ийн тайлбарыг үз). */
.quote-print .quote-print__grid tr:has(> td[class~="border"]) > td {
  border: 0 solid hsl(var(--border));
  border-bottom-width: ${GRID_LINE_PX}px;
  border-right-width: ${GRID_LINE_PX}px;
}
/* ЗҮҮН гадна ирмэг — мөр бүрийн эхний нүд. */
.quote-print .quote-print__grid tr:has(> td[class~="border"]) > td:first-child {
  border-left-width: ${GRID_LINE_PX}px;
}
/* ДЭЭД гадна ирмэг — хүрээгүй мөрийн ДАРАА ирсэн эхний хүрээтэй мөр, эсвэл
   хүснэгтийн анхны мөр өөрөө. */
.quote-print .quote-print__grid tr:not(:has(> td[class~="border"])) + tr:has(> td[class~="border"]) > td,
.quote-print .quote-print__grid tbody tr:first-child:has(> td[class~="border"]) > td {
  border-top-width: ${GRID_LINE_PX}px;
}
/* Толгойн эгнээний ДООД зураас — «толгой ↔ өгөгдөл» заагийг тодотгоно. */
.quote-print .quote-print__grid tr:has(> td[class~="bg-muted/60"]) > td {
  border-bottom-width: ${HEADER_RULE_PX}px;
}

/* Anchor-той нүдний цэнхэр гурвалжин (sheetStyles.ts ANCHOR_MARK) нь
   ЗАСВАРЛАГЧИЙН тэмдэглэгээ — албан ёсны баримт дээр гарах ёсгүй. */
.quote-print__grid td::after { display: none !important; }

/* --- ТОЛГОЙН МӨР (CellStyle.bg === 'header' → cellClass-ийн bg-muted/60) --- */
.quote-print .quote-print__grid td[class~="bg-muted/60"],
.quote-print .quote-print__grid thead th,
.quote-print .quote-print__grid thead td,
.quote-print .quote-print__grid tr:has(> td[class~="bg-muted/60"]) > td {
  text-align: center !important;
  line-height: ${HEADER_LINE_HEIGHT} !important;
  padding: ${HEADER_PAD_Y_EM}em ${HEADER_PAD_X_EM}em !important;
  vertical-align: middle !important;
  /* Толгойг өгөгдлөөс ХАРААНААР салгана: font-semibold (600) → 700, +трекинг. */
  font-weight: 700 !important;
  font-size: ${HEADER_FONT_EM}em !important;
  letter-spacing: 0.005em;
  /* Урт кирилл нэр томьёо нарийн баганад сунах гол шалтгаан нь ЗАЙГААР л
     таслагддагт байна. Дурын цэгт таслахыг зөвшөөрснөөр мөрийн тоо цөөрнө. */
  overflow-wrap: anywhere;
  hyphens: auto;
}
/* Бүлгийн толгой (bg='group' → bg-muted/40) нь ТОЛГОЙН эгнээнд ч, дүнгийн
   нүдэнд ч хэрэглэгддэг нэг л токен — голлосон (text-center) нь толгой,
   баруун эгнээтэй (text-right) нь дүн. */
.quote-print .quote-print__grid td[class~="bg-muted/40"][class~="text-center"] {
  background: hsl(var(--muted) / 0.6) !important;
  font-weight: 700 !important;
  font-size: ${HEADER_FONT_EM}em !important;
  line-height: ${HEADER_LINE_HEIGHT} !important;
  padding: ${HEADER_PAD_Y_EM}em ${HEADER_PAD_X_EM}em !important;
  overflow-wrap: anywhere;
}
/* Дэд дүн (Ажлын зургийн үнэ, ДҮН). 0.6 нь ЗОРИУДААР доод НИЙТ ДҮН-гийн
   блокоос (0.75) сул — эс бөгөөс дэд дүн нь баримтын гол тооноос илүү тодорч,
   шатлал урвуу болно. */
.quote-print .quote-print__grid td[class~="bg-muted/40"][class~="text-right"] {
  background: hsl(var(--muted) / 0.6) !important;
}

/* --- ТЕКСТЭН НҮД: тасрахын оронд ДООШ УРСГАНА --- */
/* wrap тэмдэглэгээгүй нүд whitespace-nowrap авдаг ба нарийссан баганад
   ЧИМЭЭГҮЙ тасарна. Босоо зай бол бидэнд илүүдэлтэй тул текстэн (зөвхөн ЗҮҮН
   эгнээтэй) нүдэнд мөр шилжүүлэхийг зөвшөөрнө.
   ⚠️ lib/printFit.ts-ийн cellShape нь ЯГ ЭНЭ дүрмийг тусгадаг — эдгээр нүд
   баганад ХАТУУ доод хэмжээ тавихгүй гэж үздэг. Дүрмийг өөрчилвөл тэндхийг ч
   мөн адил. */
.quote-print .quote-print__grid td[class~="text-left"][class~="whitespace-nowrap"] {
  white-space: normal !important;
  overflow-wrap: anywhere;
}
/* Зугтаалтаас хамгаалах хаалт — HEADER_MAX_LINES-ийн тайлбарыг үз. */
.quote-print .quote-print__grid td[class~="bg-muted/60"] > span {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${HEADER_MAX_LINES};
  overflow: hidden;
}

/* --- ХҮСНЭГТЭЭС ГАДУУРХ БИЧВЭР (тайлбар · нэмэлт тохиролцоо · тэмдэглэл) --- */
/* Хүрээтэй нүд агуулаагүй мөрүүд — тайлбар, нэмэлт нөхцөл.
   Хүснэгтийн зүүн захаас эхэлж, баруун захад тэгширч дуусна (Word justify). */
.quote-print__grid tr:not(:has(> td[class~="border"])) > td {
  font-size: 1.05em;
  line-height: 1.5 !important;
  text-align: justify !important;
  text-justify: inter-word;
  white-space: normal !important;
  overflow-wrap: break-word;
  padding: 0.25em 0 !important;
}

/* --- ТАЙЛБАР БОЛОН АШИГЛАСАН МАТЕРИАЛЫН БҮТЭЦТЭЙ БЛОК --- */
.quote-print__notes-block {
  margin-top: 3mm;
  display: flex;
  flex-direction: column;
  gap: 1.5mm;
  font-size: 1em;
  line-height: 1.35;
  color: #111;
}
.quote-print__notes-row {
  display: grid;
  grid-template-columns: 28mm 1fr;
  align-items: start;
  gap: 1.5mm;
}
.quote-print__notes-label {
  font-weight: 700;
  white-space: nowrap;
}
.quote-print__notes-content {
  display: flex;
  flex-direction: column;
  gap: 0.4mm;
  text-align: justify;
  text-justify: inter-word;
}
.quote-print__notes-material {
  font-weight: 700;
}
.quote-print__notes-text {
  margin-top: 1mm;
  display: flex;
  flex-direction: column;
  gap: 1mm;
  text-align: justify;
  text-justify: inter-word;
}
.quote-print__notes-total {
  font-weight: 400;
}
.quote-print__notes-contract {
  font-weight: 400;
}

/* --- НИЙЛБЭРИЙН МӨРИЙН ШОШГУУД: ЗҮҮН ТАЛД ЭХЛҮҮЛНЭ (Align Left) --- */
.quote-print .quote-print__grid tbody tr td[colspan],
.quote-print .quote-print__grid tbody tr td[class~="text-right"][colspan] {
  text-align: left !important;
  padding-left: 8px !important;
  padding-right: 8px !important;
}
.quote-print .quote-print__grid tbody tr:first-child td[colspan][class~="text-center"] {
  text-align: center !important;
}
/* Нийт үнэ болон тоон нүднүүдийг бүгдийг нь Center болгоно */
.quote-print .quote-print__grid td[class~="tabular-nums"],
.quote-print .quote-print__grid td[class~="text-right"]:not([colspan]),
.quote-print .quote-print__grid tbody tr > td:last-child:not([colspan]) {
  text-align: center !important;
}

/* --- БАРИМТЫН ГАРЧИГ --- */
/* Гарчгийн нүдийг тэмдэглэсэн тусгай атрибут DOM-д БАЙХГҮЙ. Тиймээс бүтцээр нь
   таана: ЭХНИЙ мөрийн, олон багана НЭГТГЭСЭН, ГОЛЛОСОН нүд = гарчиг.
   Таарахгүй бол дүрэм зүгээр л үйлчлэхгүй (аюулгүй degradation). */
.quote-print .quote-print__grid tbody tr:first-child td[colspan][class~="text-center"] {
  font-size: 1.55em !important;
  line-height: 1.2 !important;
  letter-spacing: 0.02em;
  /* Гарчгийн доор бага зэрэг «амьсгал» — хүснэгтээс салгана. */
  padding: 0.2em 0.4em 0.65em !important;
}

/* --- НИЙТ ДҮН (баримтын гол тоо) --- */
/* color:'danger' тавигдсан нийлбэрийн мөрөөр таана.
   ⚠️ 1.2em нь lib/printFit.ts-ийн DANGER_FONT_EM-тэй ЯГ ижил байх ЁСТОЙ —
   энэ нүд баримтын ХАМГИЙН УРТ тоог агуулдаг бөгөөд 2026-08-17 хүртэл яг
   эндээс сүүлийн орон нь тасарч байсан. */
.quote-print .quote-print__grid td[class~="text-danger"] {
  font-size: 1.02em !important;
  font-weight: 700 !important;
  letter-spacing: 0.01em;
  /* Улаанаас арай хатуу, хэвлэхэд тод бордо — албан баримтад тохирно. */
  color: #9a1220 !important;
}

/* --- ТООН НҮД --- */
/* ⚠️ ХЭВЛЭМЭЛД ГОЛЛУУЛНА (хэрэглэгчийн шийдвэр 2026-08-17). Засварлагч дээр
   тоо баруун эгнээтэй хэвээр — тэнд орон нь босоогоор жигдрэх нь засварлахад
   чухал. Цаасан дээр багана бүр ӨӨРИЙН агуулгад тааруулж өргөсгөгддөг тул
   (lib/printFit) баруун эгнээ нь тоог хүрээндээ наалдуулж «шахагдсан»
   харагдац өгдөг байв.
   Голлуулах нь ӨРГӨН ШААРДЛАГЫГ ӨӨРЧЛӨХГҮЙ — printFit нь текстийн бодит
   өргөнөөр багана тавьдаг тул эгнээ хаана ч байсан багтана. */
.quote-print .quote-print__grid td[class~="tabular-nums"] {
  font-variant-numeric: tabular-nums lining-nums;
  letter-spacing: -0.01em;
  text-align: center !important;
}
/* ⚠️ Нэгтгэсэн ШОШГЫН нүд (ДҮН · НӨАТ · НИЙТ ДҮН · Ажлын зургийн үнэ) нь
   баруун эгнээтэй хэвээр — тэдгээр нь тоо биш ГАРЧИГ бөгөөд дүнгийнхээ яг
   зүүн хөршид наалдаж байж «нийлбэрийн блок» уншигдана. */


/* --- ГАРЫН ҮСГИЙН БЛОК (боловсруулсан хүн + тамга) --- */
/* ⚠️ position: absolute — урсгалд ОГТ оролцохгүй (урсгалд байрлуулж туршихад
   БҮРЭН ХООСОН 2 дахь хуудас үүсдэг байв, хэмжсэн 2026-08-11).
   Суурь нь .quote-print__body, өөрөөр хэлбэл ХҮСНЭГТИЙН ЁРООЛ — хуудасны
   ёроол БИШ. Ингэснээр гарын үсэг нь «Төслийн менежер:» гэсэн сүүлийн мөрийн
   хажууд суух ба богино баримт дээр ч хүснэгт рүү дээшээ авирахгүй. */
/* ⚠️ ХУУДАСНЫ ГОЛД (хэрэглэгчийн шийдвэр 2026-08-17). Өмнө нь right: 10mm
   байсан ба хуудасны шошгууд («БОЛОВСРУУЛСАН:», «…ХХК-ийн», «Төслийн
   менежер:») ЗҮҮН талд үлддэг тул баримтын ёроол хоёр тийш салдаг байв. Одоо
   тэдгээр мөрүүд SheetGrid.hiddenRows-оор нуугдаж, бүх бүрэлдэхүүн ЭНЭ нэг
   блокт орсон тул бүлгээрээ голлоно. */
/* ⚠️⚠️ УРСГАЛД БАЙРЛАНА, absolute БИШ (2026-08-17-нд ЗАССАН).
 * position: absolute үед блок нь урсгал дахь агуулгыг МЭДДЭГГҮЙ тул
 * «Тайлбар: … төгрөг болно.» гэсэн мөр, үлдсэн шошгын мөрүүд ба тамга гурав
 * бие бие дээрээ давхарлаж уншигдахгүй болж байв (хэрэглэгчийн зураг).
 * Одоо шошгын мөрүүд hiddenRows-оор нуугдаж БОСОО зай чөлөөлөгдсөн тул блок
 * урсгалд багтана — давхцал ЗАРЧМЫН ХУВЬД боломжгүй болно. */
.quote-print__sign {
  margin: ${SIGN_TOP_GAP_MM}mm auto 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  /* Блок хуудас дундуур таслагдвал тамга нь гарын үсгээсээ сална. */
  break-inside: avoid;
  page-break-inside: avoid;
}
/* «БОЛОВСРУУЛСАН:» — бүлгийн гарчиг.
   ⚠️ ХУУДАСНЫ ЗҮҮН ИРМЭГТ (хэрэглэгчийн шийдвэр 2026-08-19, албан баримтын
   эх хувилбарын дагуу). Гарчиг нь голлосон үед («align-items: center»-ийг
   дагаад) гарын үсгийн зураасны яг дээр буудаг тул албан бичгийн ердийн
   харагдац алдагддаг байв. Загварт ч "БОЛОВСРУУЛСАН:" нь A багананд
   align: 'left'-ээр суудаг (gen-control-budget-template.mjs), тиймээс зүүн
   ирмэг нь эх загвартайгаа мөн нийцнэ.
   ⚠️ ЭНЭ БЛОК НЬ TEMPLATE LITERAL дотор — тайлбарт backtick БҮҮ бич, string
   тасарна.
   ⚠️ Зөвхөн ГАРЧИГ зүүнд шилжинэ — доорх sign-row (байгууллага · зураас ·
   нэр) голлосон хэвээр үлдэнэ. */
/* Гарчиг + гарын үсгийн мөрийн НЭГДСЭН бүлэг.
   ⚠️ ЭНЭ БЛОК НЬ TEMPLATE LITERAL дотор — тайлбарт backtick БҮҮ бич.
   inline-flex тул бүлэг нь агуулгынхаа (= sign-row-ийн) өргөнөөр АГШИНА.
   Түүний зүүн ирмэг нь «…ХХК-ийн» бичвэрийн зүүн ирмэгтэй ЯГ давхцах тул
   доорх align-self: flex-start нь гарчгийг тэр бичвэрийн ЭГЦ ДЭЭР буулгана
   (хэрэглэгчийн шийдвэр 2026-08-19: «БОЛОВСРУУЛСАН: хэсэг хэтэрхий зүүн талд
   байна, Эм Жи Эл И Эн Си ХХК-ийн хэсгийн эгц дээр хавьцаа байрлуулах»).
   Өмнө нь гарчиг .quote-print__sign-д шууд сууж, түүний БҮТЭН өргөнөөр
   flex-start авдаг байсан тул ХУУДАСНЫ зүүн ирмэгт наалддаг байв. */
.quote-print__sign-group {
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
}
/* ⚠️ font-size ба margin-bottom нь SIGN_HEAD_FONT_PT / SIGN_HEAD_GAP_MM-ээс
   гарна — SIGN_RESERVE_MM ЯГ ЭНЭ ХОЁРООС өндрөө бодох тул тоог энд хатуу
   бичвэл нөөц ба зохиомж чимээгүй зөрнө. */
.quote-print__sign-head {
  align-self: flex-start;
  font-weight: 700;
  font-size: ${SIGN_HEAD_FONT_PT}pt;
  line-height: 1.2;
  letter-spacing: 0.01em;
  margin-bottom: ${SIGN_HEAD_GAP_MM}mm;
}
/* Байгууллага · албан тушаал · зураас · нэр — НЭГ хэвтээ бүлэг.
   ⚠️ padding нь ТАМГАНЫ цухуйх хэсгийг УРЬДЧИЛЖ НӨӨЦЛӨНӨ: тамга нь зураасан
   дээр голлодог тул дээш ба доош ${STAMP_BELOW_LINE_MM}mm-ээр гардаг. Нөөцгүй
   бол дээд талаараа «Тайлбар» мөрийг, доод талаараа хуудасны захыг мөргөнө. */
.quote-print__sign-row {
  display: flex;
  align-items: flex-end;
  gap: 4mm;
  padding-top: ${Math.max(0, STAMP_BELOW_LINE_MM - SIGN_IMG_MM).toFixed(1)}mm;
  padding-bottom: ${STAMP_BELOW_LINE_MM}mm;
}
/* «"Эм Жи Эл И Эн Си" ХХК-ийн» / «Төслийн менежер:» — зураасны ЗҮҮН талд,
   мөр хоорондоо нягт, доод ирмэгээрээ зураастай тэгшилнэ. */
.quote-print__sign-org {
  font-size: 9.5pt;
  line-height: 1.55;
  white-space: nowrap;
  max-width: 80mm;
  text-align: right;
  padding-bottom: 0.6mm;
}
/* Гарын үсгийн ЗУРААС — доор нь шугам, дээр нь гарын үсэг/тамга хөвнө. */
.quote-print__sign-line {
  position: relative;
  width: ${SIGN_LINE_MM}mm;
  height: ${SIGN_IMG_MM}mm;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  border-bottom: 0.6px solid #111;
}
.quote-print__sign-img {
  max-height: ${SIGN_IMG_MM}mm;
  max-width: 100%;
  width: auto;
  object-fit: contain;
  /* ⚠️ Бэх нь зураасыг БАГА ЗЭРЭГ давна — бодит гарын үсэг яг ингэж унадаг.
     Хэрэглэгчийн заавраар (2026-08-17) -0.5mm → -1.8mm болгож доошлуулав:
     өмнө нь үсэг зураасны дээгүүр «хөвж» байв. */
  margin-bottom: -1.8mm;
  mix-blend-mode: multiply;
}
/* Тамга нь гарын үсгийн ДЭЭР ДАРАГДАНА — бодит баримт дээр яг ингэж дардаг.
   ⚠️ ЗУРААСАН ДЭЭР ГОЛЛОНО: тамганы БОСОО ТӨВ нь зураастай яг таарна, ингэснээр
   тэмдгийн гол дахь «MGL E&C» бичиг гарын үсгийн зураас дээр буудаг
   (хэрэглэгчийн шаардлага 2026-08-17; өмнө нь төв нь зураасаас 16.3mm ДЭЭР
   байсныг хэмжсэн). Хэвтээгээр мөн голлоно — өмнөх -42% шилжилт нь тамгыг
   «хажууд наасан» мэт харуулж байв.
   mix-blend-mode: multiply тул доорх гарын үсэг тамгаар ХАРАГДСААР байна. */
.quote-print__sign-stamp {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: ${-STAMP_BELOW_LINE_MM}mm;
  height: ${STAMP_MM}mm;
  width: auto;
  object-fit: contain;
  mix-blend-mode: multiply;
}
.quote-print__sign-name {
  font-size: 9pt;
  font-weight: 600;
  white-space: nowrap;
  padding-bottom: 0.5mm;
}

/* --- Хэвлэх товч (зөвхөн дэлгэц дээр; .no-print-ыг index.css нууна) --- */
.quote-print__actions { margin-top: 8mm; display: flex; justify-content: center; }

/* --- Ачаалж байгаа / олдоогүй --- */
.quote-print__msg { padding: 48px; text-align: center; }
.quote-print__msg--error { color: #b00020; }

@media print {
  @page { size: A4 landscape; margin: ${PAGE_MARGIN_Y_MM}mm ${PAGE_MARGIN_X_MM}mm; }

  html, body { background: #fff !important; color: #111 !important; }
  /* index.css нь «body * { visibility: hidden }»-ээр .print-area-аас бусдыг
     нууна. Энэ бол бие даасан хэвлэх маршрут тул харагдацыг эргүүлж асаана —
     эс бөгөөс page.pdf() ЦАГААН хуудас гаргана. */
  body, body * { visibility: visible !important; }

  /* ⚠️ padding нь ҮЛДЭНЭ — энэ бол браузерын «Захын хэмжээ: Байхгүй»
     тохиргооноос хамгаалдаг ДОТООД зай (PAGE_MARGIN_*_MM-ийн тайлбарыг үз).
     @page-ийн ${PAGE_MARGIN_Y_MM}/${PAGE_MARGIN_X_MM}mm + энэ ${SAFE_PAD_Y_MM}/${SAFE_PAD_X_MM}mm = хуучин 14/12mm.
     Зөвхөн ДЭЛГЭЦИЙН голлолт (max-width/margin) хаагдана. */
  .quote-print { max-width: none; margin: 0; padding: ${SAFE_PAD_Y_MM}mm ${SAFE_PAD_X_MM}mm; }

  /* Урт хуудас: хүснэгтийг урсгахыг зөвшөөрнө, харин нэг МӨР хэзээ ч хоёр
     хуудсанд хуваагдахгүй.
     ⚠️ Толгойн мөрийг хуудас бүрд ДАВТАХ боломжгүй: SheetGrid нь
     showHeaders={false} үед <thead> огт рендэрлэдэггүй бөгөөд загварын толгой
     нь ердийн <tbody> мөр юм. */
  .quote-print__grid > table { break-inside: auto; page-break-inside: auto; }
  .quote-print__grid tr { break-inside: avoid; page-break-inside: avoid; }
}
`;

/**
 * Хэвлэх хуудасны бүтэн CSS. Нэг `<style>` дотор оруулна (@import эхэндээ).
 *
 * Олон хуудаст ажлын дэвтэр (v3) — хуудас бүрийн зохиомж нь өөр тул тус бүрийг
 * `.quote-print__sheet--<i>` scope-оор хашиж бичнэ. Индекс нь
 * `QuotePrintPage`-ийн `workbook.sheets.map`-ийн дараалалтай ЯГ таарна.
 */
export function quotePrintCss(workbook: WorkbookDoc, opts: PrintCssOptions = {}): string {
  const perSheet = workbook.sheets
    .map((sheet, i) => sheetLayoutCss(sheet, `.quote-print__sheet--${i}`, opts))
    .join('\n');
  return QUOTE_PRINT_BASE_CSS + perSheet;
}
