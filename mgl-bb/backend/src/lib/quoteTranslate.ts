/**
 * Үнийн саналын ажлын дэвтрийг МОНГОЛ → АНГЛИ хөрвүүлэх цөм
 * (POST /api/quotes/:id/translate — routes/quotes.ts).
 *
 * ХОЁР ДАВХАРГА:
 *   1. Загварын ТОГТМОЛ бичвэрүүд (толгой, нэмэгдэл, хэсэг, нийлбэрийн мөр,
 *      dropdown сонголт …) — гараар баталсан толь `QUOTE_MN_EN_DICT`.
 *      Нарийвчлал чухал тул AI-д ДААТГАХГҮЙ. Түлхүүрүүд нь
 *      `backend/scripts/gen-control-budget-template.mjs`-ийн мөрүүдтэй
 *      БАЙТ-ААРАА ижил байх ЁСТОЙ (генератор өөрчлөгдвөл энд дагуулна);
 *      англи утгууд нь frontend `lib/addons.ts`-ийн `labelEn`-тэй ижил —
 *      цэснээс дахин нэмсэн мөр орчуулгатай яг таарна.
 *   2. Чөлөөт бичвэр (барилгын нэр, гарчиг, PM-ийн бичсэн тэмдэглэл) —
 *      Workers AI батч (`translateStringsAi`). AI аль нэг мөрийг алгассан ч
 *      тэр нүд ХООСОРДОГГҮЙ — монголоороо үлдэнэ (админ редактор дээрээ
 *      засна). AI бүр мөсөн унасан ч мөн адил.
 *
 * ЮУГ хөрвүүлдэг вэ (routes/quotes.ts-ийн шийдвэртэй ижил):
 *   • нүдний литерал утга `v` (кирилл агуулсан мөр),
 *   • томьёо `f`-ийн ДОТОРХ "..." литералууд (томьёо өөрөө ХЭЗЭЭ Ч
 *     тооцоологдохгүй, бүтэц нь хөндөгдөхгүй),
 *   • `choices` (dropdown) массивууд,
 *   • `sheet.addons`-ийн items/lines/costLines/sections шошгууд,
 *   • хуудасны нэрс (Нэгтгэл → Summary, ХуудасN → SheetN).
 * Тоо, нүдний лавлагаа, функц, merge, style, anchor, fmt — ХӨНДӨХГҮЙ.
 *
 * ⚠️ Хуудасны нэр өөрчлөгдөхөд томьёон доторх `Нэр!A1` лавлагааг МӨН дагуулж
 * солино: frontend-ийн хөдөлгүүр хөндлөн лавлагааг НЭРЭЭР шийддэг
 * (`lib/workbook.ts` → `sheetByName`) тул нэрийг л сольчихвол олон хуудаст
 * дэвтрийн cross-sheet томьёо бүгд эвдэрнэ.
 */

import type { NamedSheet, SheetCell, WorkbookDoc } from '../routes/quotes';
import { orgConfig } from './orgConfig';

/* ------------------------------------------------------------------ */
/*  Толь — ЭХ СУРВАЛЖ нь gen-control-budget-template.mjs-ийн мөрүүд    */
/* ------------------------------------------------------------------ */

/**
 * МОНГОЛ (түлхүүр, trim хийсэн) → АНГЛИ. Түлхүүр нэмэх/өөрчлөх бол эхлээд
 * генераторын мөртэй байт-аараа тулгаж, frontend `lib/addons.ts`-ийн
 * `labelEn`-ийг зэрэг шинэчил.
 */
export const QUOTE_MN_EN_DICT: Record<string, string> = {
  // — Гарчиг / бүлгийн толгой —
  'БАРИЛГА БАЙГУУЛАМЖ БАРИХ ЗУРАГ ТӨСӨЛ БОЛОВСРУУЛАХ ХЯНАЛТЫН ТӨСӨВ':
    'CONTROL BUDGET FOR THE DEVELOPMENT OF DESIGN DOCUMENTATION FOR BUILDINGS AND STRUCTURES',
  'Зураг төсөл боловсруулах үнийг «Зураг төслийн ажлын жишиг үнэ» БД 81-16-20/2020-ийг үндэслэн тооцов.':
    'The design fee is calculated on the basis of "Reference Prices for Design Works" BD 81-16-20/2020.',
  '*БД 81-16-20/2020-4.19, 4.21 дагуу технологийн өндөр шаардлагатай барилгад нэмж тооцно.':
    '*Applied additionally to buildings with advanced technological requirements per BD 81-16-20/2020 cl. 4.19, 4.21.',
  '*БД 81-16-20/2020-4.22.1 Хүснэгт 10 — зураг төслийн ажлын хэсгүүд (нэг үнийн задаргаа).':
    '*BD 81-16-20/2020 cl. 4.22.1, Table 10 — design work disciplines (breakdown of a single fee).',
  // — Баганын толгой —
  'Д/д': 'No.',
  'Барилгын нэр': 'Building name',
  'Барилгын давхар': 'Storeys',
  'Тоо хэмжээ': 'Quantity',
  'Хэмжих нэгж': 'Unit',
  'Өндөр /м/': 'Height /m/',
  'Барилгын төвөгшил': 'Building complexity',
  'Дүн /төг/': 'Amount /MNT/',
  'Нийт үнэ': 'Total price',
  'Жишиг үнэ /төг/': 'Base rate /MNT/',
  'Өндрийн итгэлцүүр': 'Height coefficient',
  'Нэгж үнэ /төг/': 'Unit price /MNT/',
  'Зураг төслийн ажлын үнэ': 'Design works fee',
  // — Нэмэгдлүүд (frontend STANDARD_ADDONS-ийн ихэр) —
  'BMS /ЗТАҮ*6%/': 'BMS /design fee×6%/',
  'Усаар гал унтраах систем 4%': 'Water-based fire suppression system 4%',
  'Галын автоматик 6%': 'Automatic fire alarm system 6%',
  'Хөргөлт 5%': 'Cooling system 5%',
  '8 балл газар хөдлөлтийн итгэлцүүр 10%': 'Seismic intensity 8 coefficient 10%',
  'Төсөв /ЗТАҮ*8%/': 'Cost estimate /design fee×8%/',
  // — Хэсгүүд (frontend STANDARD_SECTIONS-ийн ихэр) —
  'Барилга архитектур': 'Architecture',
  'Барилга бүтэц': 'Structural engineering',
  'Халаалт агаар сэлгэлт': 'Heating and ventilation',
  'Цэвэр бохир ус': 'Water supply and sewerage',
  'Цахилгаан хангамж': 'Power supply',
  'Холбоо дохиолол': 'Communications and alarm systems',
  'Автомат удирдлага': 'Building automation',
  // — Мөр / нийлбэрүүд (frontend STANDARD_COST_LINES-ийн ихэр орсон) —
  'Ажлын зургийн үнэ': 'Working drawings fee',
  'Эскиз зургийн үнэ /АЗ*15%/': 'Concept design fee /WD×15%/',
  'Ерөнхий төлөвлөгөө барилгажилтын төсөв': 'Master plan development budget',
  'Гадна тохижилтын зураг төсөл': 'Landscaping design',
  'Инженер геологийн судалгаа': 'Geotechnical investigation',
  'Топографийн зураглал': 'Topographic survey',
  'Онцгой байдлын хяналтын зардал': 'Emergency Management Agency review fee',
  'Улсын экспертизийн зардал /АЗ*8%/': 'State expertise review fee /WD×8%/',
  'ДҮН': 'SUBTOTAL',
  'Менежментийн зардал /2%/': 'Management fee /2%/',
  // ⚠️ ТОМООР бичсэн хувилбар — migration 0184 (`…_management_caps`) шошгыг
  //    ТОМ үсэг рүү шилжүүлсэн ч толийг дагуулаагүй тул энэ мөр англи хуулбар
  //    дээр AI-д унадаг байв. Хоёулаа амьд: 0184-өөс ӨМНӨХ саналууд өөрсдийн
  //    жижиг үсэгт snapshot-оо авч явна.
  'МЕНЕЖМЕНТИЙН ЗАРДАЛ /2%/': 'MANAGEMENT FEE /2%/',
  'НӨАТ /10%/': 'VAT /10%/',
  'НИЙТ ДҮН': 'GRAND TOTAL',
  // frontend STANDARD_LINE_ADDONS (хөнгөлөлтийн мөр).
  'ХӨНГӨЛӨЛТ': 'DISCOUNT',
  // Хөнгөлөлт хассаны дараах ЭЦСИЙН мөр (НИЙТ ДҮН-гийн ДООР) — frontend
  // `lib/addons.ts` → `netLabel()`-ийн гаргадаг ЯГ ХОЁР бичвэр.
  'ХӨНГӨЛӨЛТ ХАССАН НИЙТ ДҮН': 'TOTAL AFTER DISCOUNT',
  /* — Тайлбарын («дүн үсгээр») томьёоны литералууд —
   *
   * Загварын мөр нь ГУРВАН литералт томьёо:
   *   ="<PREFIX>" & TEXT(нийт) & " /" & USGEER(нийт) & "<SUFFIX>"
   * `translateFormula` литерал БҮРИЙГ тусад нь `translateFreeText`-ээр
   * гүйлгэдэг тул PREFIX ба SUFFIX ХОЁУЛАА энд түлхүүр байх ЁСТОЙ. Аль нэг нь
   * дутвал тэр хэсэг AI руу унана — тэгвэл (а) орчуулга тогтворгүй, (б) AI
   * унавал мөр МОНГОЛООРОО үлдэж англи баримт дундуураа хоёр хэлтэй болно.
   *
   * ⚠️ PREFIX-ийн англи утгын ТӨГСГӨЛИЙН ЗАЙ нь утгын нэг хэсэг: монголд «₮»
   * тооны өмнө шууд наалддаг («₮978,161,095») бол англид «MNT 978,161,095»
   * гэж ЗАЙТАЙ бичигдэнэ. `translateFreeText` нь ЭХ мөрийн зайг сэргээдэг ба
   * монгол түлхүүр төгсгөлдөө зайгүй тул тэр зай ЗӨВХӨН эндээс ирнэ. Хасвал
   * англи баримт дээр «MNT978,161,095» гэж наалдана.
   *
   * ⚠️ Гурван PREFIX хувилбар бүгд амьд: үнийн санал бүр `sheet_json`-оо
   * ҮҮСГЭХ ҮЕДЭЭ snapshot авдаг тул загварыг зассан ч ХУУЧИН саналууд өөрсдийн
   * бичвэрээ мөнхөд авч явна. Түлхүүр устгавал тэр саналуудын англи хуулбар
   * эвдэрнэ — ЗӨВХӨН НЭМНЭ, битгий хас. */
  // (a) ОДООГИЙН — gen-control-budget-template.mjs, migration 0186-аас хойш.
  'Тайлбар: Зураг төсөл боловсруулах ажлын нийт дүн ₮':
    'Note: The total price for the design works is MNT ',
  // (b) 0185 ба түүнээс өмнөх хяналтын төсвийн загвар. Хамрах хүрээг буруу
  //     нэрлэсэн бичвэр боловч тэр саналуудын эх нь ТИЙМ тул ҮНЭНЧ орчуулна —
  //     орчуулга нь эх бичвэрийг ЧИМЭЭГҮЙ засах ёсгүй (монгол/англи хоёр
  //     хуулбар нэг дүнг өөр хамрах хүрээтэй тайлбарлавал маргаан үүсгэнэ).
  'Тайлбар: Эскиз зураг боловсруулах ажлын нийт дүн ₮':
    'Note: The total price for the concept design works is MNT ',
  // (c) Хамгийн анхны хяналтын төсвийн бичвэр.
  'Тайлбар: Хяналтын төсвийн нийт дүн ₮': 'Note: The grand total of this control budget is MNT ',
  // (d) Энгийн үнийн саналын загвар — gen-default-quote-template.mjs (0130).
  //     ⚠️ «Тайлбар:» -ийн дараа ХОЁР зайтай нь ЭХ бичвэрийн хэсэг —
  //     `translateFreeText` зөвхөн ХОЁР ҮЗҮҮРИЙН зайг тайрдаг тул дотоод давхар
  //     зай түлхүүрт ЗААВАЛ байх ёстой.
  'Тайлбар:  Зураг төсөл боловсруулах ажлын үнийн дүн ₮':
    'Note: The total price for the design works is MNT ',
  // SUFFIX — дөрвөн PREFIX-ийн аль нь ч энэ НЭГ төгсгөлтэй.
  'төгрөг/ болно.': 'tugriks/.',
  /* — Баримтын ДООД ТАЙЛБАРЫН БЛОК —
   *
   * ⚠️ Эдгээр нь загварын ТОГТМОЛ бичвэрүүд (БД стандартын эшлэл) бөгөөд
   * хяналтын төсвийн санал БҮР дээр гардаг. 2026-08-24 хүртэл тольд байхгүй
   * байсан тул англи хуулбар дээр БҮГД Workers AI-д унаж байв — өөрөөр хэлбэл
   * улсын стандартын дугаар, хувь, метр зэрэг НАРИЙВЧЛАЛ ЧУХАЛ бичвэрийг
   * загварчлалын моделд даатгаж, AI унавал бүхэл блок монголоороо үлддэг байв.
   * Тольд орсноор англи баримт ОДОО ДЕТЕРМИНИСТ — AI огт ажиллахгүй ч бүтэн
   * англиар гарна. Загварын мөрийг өөрчилвөл ЭНД мөн адил шинэчил
   * (`quoteTranslate.test.ts`-ийн «ИХЭР ХАМГААЛАЛТ» тест томьёоны литералыг
   * барьдаг ч энгийн `v:` бичвэрийг барьдаггүй). */
  'Тайлбар:': 'Note:',
  'БД-81-16-20-ийн 4.21.3-ыг үндэслэн барилгын давхрын өндөр үйлдвэрийн барилгад 4,5м байхаар тооцсон ба түүнээс 1м тутамд 1.05 гэсэн итгэлцүүр хэрэглэнэ. /1.5м*0.05/':
    'Pursuant to BD 81-16-20 cl. 4.21.3, the storey height of an industrial building is taken as 4.5 m; for each additional 1 m above that, a coefficient of 1.05 is applied. /1.5 m × 0.05/',
  'БД-81-16-20-ийн 4.19-ийг үндэслэн галаас хамгаалах "BMS" системийн 6%, төсвийн 8% нэмж тооцов.':
    'Pursuant to BD 81-16-20 cl. 4.19, an additional 6% for the fire-protection "BMS" system and 8% for the cost estimate have been included.',
  'БД-81-16-20-ийн 3.5.1-ийг үндэслэн 80га талбайн ерөнхий төлөвлөгөө, гадна тохижилтын зургийн нэгж үнийг тооцов.':
    'Pursuant to BD 81-16-20 cl. 3.5.1, the unit prices for the master plan and landscaping design of an 80 ha site have been calculated.',
  'БД 81-117-13-ийг үндэслэн инженер геологийн ажлын үнийг тооцов.':
    'The price of the geotechnical investigation works is calculated pursuant to BD 81-117-13.',
  // ⚠️ ХОЁР бичлэг: «М1:500» нь migration 0186-аас хойш, «М1;500» нь түүнээс
  //    өмнөх бичгийн алдаатай хувилбар. Хуучин саналууд өөрсдийнхөө snapshot-ыг
  //    авч явдаг тул хоёулаа хэрэгтэй. («Т» нь кирилл, «opography» нь латин —
  //    эх бичвэр ийм холимог, БАЙТ-ААРАА хуулсан байх ёстой.)
  'БД 81-103-21-ийг үндэслэн Тopography М1:500 зургийн үнийг тооцов.':
    'The price of the topographic survey at scale 1:500 is calculated pursuant to BD 81-103-21.',
  'БД 81-103-21-ийг үндэслэн Тopography М1;500 зургийн үнийг тооцов.':
    'The price of the topographic survey at scale 1:500 is calculated pursuant to BD 81-103-21.',
  'Ашигласан материал:': 'Reference materials:',
  'БД 81-16-20 Зураг төслийн ажлын жишиг үнэ':
    'BD 81-16-20 Reference Prices for Design Works',
  'БД 81-117-13 Барилгын инженер геологийн ажлын жишиг үнэ':
    'BD 81-117-13 Reference Prices for Construction Geotechnical Investigation Works',
  'БД 81-103-21 Геодизи, зураг зүйн ажлын жишиг үнэ':
    'BD 81-103-21 Reference Prices for Geodetic and Cartographic Works',
  // Гэрээний нэмэлт нөхцөл. ⚠️ Эх бичвэр нь «эскиз зургийн ажлын үнийн санал»
  //    гэж хамрах хүрээг нэрлэдэг — ҮНЭНЧ орчуулна (орчуулга эх бичвэрийг
  //    чимээгүй засах ёсгүй). Монгол талыг нь өөрчлөх бол тусдаа шийдвэр.
  // ⚠️ Энэ өгүүлбэр нь 2026-08-24-ээс хойш ХАМРАХ ХҮРЭЭНЭЭС ҮҮСНЭ
  //    (`frontend/.../lib/quoteNotes.ts` → `contractNoteText`). Динамик бичвэр нь
  //    `sheet.notes.i18n` давхаргаар ирдэг тул энд байгаа нь НӨӨЦ — тайлбарын
  //    төлөв бичигдээгүй хуучин саналууд ба AI-гүй детерминист зам.
  //    ШИНЭ хувилбар нэмэх бол `contractRender`-ийн ГУРВАН салааг бүгдийг нь дага.
  'Дээрх үнийн санал нь эскиз болон ажлын зураг төслийн ажлын үнийн санал болно.':
    'This quotation covers the concept design and working drawings design works.',
  'Дээрх үнийн санал нь ажлын зураг төслийн ажлын үнийн санал болно.':
    'This quotation covers the working drawings design works.',
  'Дээрх үнийн санал нь дээр дурдсан ажлын үнийн санал болно.':
    'This quotation covers the works listed above.',
  'Дээрх үнийн санал нь эскиз зургийн ажлын үнийн санал болно. Ажлын зураг төслийн гэрээг мөн манай компанитай байгуулсан тохиолдолд дээрх үнийн саналд нэмэлт хөнгөлөлт үзүүлэх боломжтой.':
    'This quotation covers the concept design works. Should the working drawings design contract also be awarded to our company, an additional discount may be applied to this quotation.',
  // — Гарын үсгийн блок —
  'БОЛОВСРУУЛСАН:': 'PREPARED BY:',
  '«Эм Жи Эл И Эн Си» ХХК-ийн': '"MGL E&C" LLC',
  'Төслийн менежер:': 'Project Manager:',
  // — Dropdown сонголтууд (төвөгшил нь frontend tariffLookup-ийн англи
  //   түлхүүрүүдтэй ХАМТ явна — TARIF() эдгээрийг таних ёстой) —
  'Бага төвөгшилтэй': 'Low complexity',
  'Дунд төвөгшилтэй': 'Medium complexity',
  'Өндөр төвөгшилтэй': 'High complexity',
  'Онцгой төвөгшилтэй': 'Special complexity',
  'Барилгын ажлын зөвшөөрөл шаардлагагүй': 'No construction permit required',
  'м²': 'm²',
  'га': 'ha',
  'цооног': 'borehole',
  'тм': 'lin.m',
  'ш': 'pcs',
};

/* ------------------------------------------------------------------ */
/*  Жижиг туслахууд                                                    */
/* ------------------------------------------------------------------ */

/** Орчуулга хэрэгтэйн ГАНЦ шинж: кирилл үсэг агуулсан эсэх (U+0400–U+04FF). */
const CYRILLIC_RE = /[Ѐ-ӿ]/;
export const hasCyrillic = (s: string): boolean => CYRILLIC_RE.test(s);

/**
 * Томьёон доторх "..." литерал — frontend
 * `lib/formula/tokenizer.ts`-ийн ЯГ ижил дүрэм: `""` нь нэг хашилт.
 */
const FORMULA_STR_RE = /"(?:[^"]|"")*"/g;

/** Эх мөрийн эхлэл/төгсгөлийн зайг салгана (орчуулахдаа хадгалахын тулд). */
function splitWs(s: string): { lead: string; core: string; trail: string } {
  const lead = /^\s*/.exec(s)?.[0] ?? '';
  if (lead.length === s.length) return { lead: s, core: '', trail: '' };
  const trail = /\s*$/.exec(s)?.[0] ?? '';
  return { lead, core: s.slice(lead.length, s.length - trail.length), trail };
}

/** Нэг мөрийг хөрвүүлэгч — толь эхэлж, дараа нь AI-ийн үр дүн, эс бөгөөс эх. */
type Translate = (s: string) => string;

/**
 * Байгууллагын нэрний ДИНАМИК толь — статик `QUOTE_MN_EN_DICT`-ээс ӨМНӨ
 * шалгагдана.
 *
 * Компанийн хууль ёсны нэр нь тольд шууд бичигдсэн байсан
 * (`'«Эм Жи Эл И Эн Си» ХХК-ийн' → '"MGL E&C" LLC'`), тиймээс өөр компанийн
 * үнийн санал орчуулахад MGL-ийн нэр гарч ирдэг байв.  Одоо
 * `org.legal_name_mn` / `org.legal_name_en` тохиргооноос гарна.
 *
 * Статик оруулга нь ХЭВЭЭР үлдсэн: MGL-ийн өмнө үүсгэсэн үнийн саналууд
 * `sheet_json`-доо хуучин мөрөө агуулж байгаа тул тэдгээр нь үргэлжлүүлэн
 * зөв орчуулагдана.  Динамик толь нь зөвхөн ДЭЭР нь давхарлана.
 *
 * `-ийн` залгавартай хэлбэрийг мөн бүртгэнэ — загварт эзэмшлийн тийн ялгалаар
 * ордог («… ХХК-ийн Төслийн менежер»).
 */
function orgNameDict(): Record<string, string> {
  const { legalNameMn, legalNameEn, name } = orgConfig();
  const out: Record<string, string> = {};
  out[legalNameMn] = legalNameEn;
  out[`${legalNameMn}-ийн`] = legalNameEn;
  out[`${legalNameMn}-ын`] = legalNameEn;
  out[name] = name;
  return out;
}

/**
 * Чөлөөт мөрийг хөрвүүлнэ: толь → AI-ийн үр дүн → (олдохгүй бол) ЭХ МОНГОЛ.
 * Эхлэл/төгсгөлийн зай хэвээр хадгалагдана; толь/AI-ийн хайлт TRIM хийсэн
 * мөрөөр явна.
 */
export function translateFreeText(s: string, aiBySource: ReadonlyMap<string, string>): string {
  if (!hasCyrillic(s)) return s;
  const { lead, core, trail } = splitWs(s);
  const en = orgNameDict()[core] ?? QUOTE_MN_EN_DICT[core] ?? aiBySource.get(core);
  return en === undefined ? s : `${lead}${en}${trail}`;
}

/** Мөр AI-д явах шаардлагатай юу: кирилтэй БА тольд байхгүй. */
export function needsAiTranslation(s: string): boolean {
  const core = s.trim();
  return (
    core !== '' &&
    hasCyrillic(core) &&
    orgNameDict()[core] === undefined &&
    QUOTE_MN_EN_DICT[core] === undefined
  );
}

/* ------------------------------------------------------------------ */
/*  Хуудасны нэр                                                       */
/* ------------------------------------------------------------------ */

/**
 * Хуудасны нэрийг хөрвүүлнэ. `Нэгтгэл` → `Summary`, `ХуудасN` → `SheetN`
 * (тогтмол дүрэм), бусад кирилл нэр толь/AI-аар.
 */
export function translateSheetName(name: string, tr: Translate): string {
  const core = name.trim();
  if (core === 'Нэгтгэл') return 'Summary';
  const m = /^Хуудас(\d+)$/.exec(core);
  if (m) return `Sheet${m[1] ?? ''}`;
  return hasCyrillic(core) ? tr(name) : name;
}

/* ------------------------------------------------------------------ */
/*  Томьёо — зөвхөн "..." литерал + хуудасны нэрийн лавлагаа            */
/* ------------------------------------------------------------------ */

/** Ганц "..." литералыг хөрвүүлнэ (escape тайлж, буцааж хийнэ). */
function translateLiteral(lit: string, tr: Translate): string {
  const inner = lit.slice(1, -1).replace(/""/g, '"');
  if (!hasCyrillic(inner)) return lit;
  const en = tr(inner);
  if (en === inner) return lit;
  return `"${en.replace(/"/g, '""')}"`;
}

/** Regex-д аюулгүй болгоно. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Хашилтгүй бичиж БОЛОХ хуудасны нэр. Tokenizer хашилтгүй танигчийг
 * «үсгүүд → тоонууд» гэж уншаад ЗОГСДОГ (`tokenizer.ts` — isNameStart давталт,
 * дараа нь цифрүүд), тул `Sheet2` болно, `Block1A` эсвэл зайтай нэр БОЛОХГҮЙ —
 * тэдгээрийг хашилттай бичнэ.
 */
const BARE_SHEET_NAME_RE = /^[A-Za-z]+\d*$/;

/**
 * Литерал-БУС хэсэгт хуудасны нэрийн лавлагааг (`Нэр!A1`, `'Нэр'!A1`)
 * шинэ нэрээр солино. Литералын доторх тохиолдол энд ИРДЭГГҮЙ —
 * `translateFormula` хэсэглэж дууддаг.
 *
 * ⚠️ ХӨДӨЛГҮҮРТЭЙ ЯГ ИЖИЛ ТАНИЛТ. Хуудсыг нэрээр нь олохдоо frontend
 * (`formula/index.ts` idByName, `lib/workbook.ts` sheetByName) нэрийг
 * `trim().toLowerCase()` хийдэг, tokenizer нь хашилтгүй нэр ба `!`-ийн хооронд
 * ЗАЙ зөвшөөрдөг. Тиймээс энд ч мөн адил ТОМ/ЖИЖИГ үсэг ялгалгүй, зайг
 * тэвчиж тааруулна — эс тэгвээс PM-ийн гараар бичсэн `=нэгтгэл!M13` /
 * `=Нэгтгэл !M13` хэлбэрүүд англи хуулбар дээр #ТОМЬЁО! болно.
 *
 * Зайг ЗАЛГИНА (`[ \t]*` нь тааралтын ДОТОР): хашилттай нэрийн дараа
 * tokenizer `!`-ийг ШУУД шаарддаг тул `'New Name' !A1` гэж үлдээвэл эвдэрнэ.
 */
function renameSheetRefs(part: string, renames: ReadonlyMap<string, string>): string {
  if (renames.size === 0 || !part.includes('!')) return part;
  let out = part;
  for (const [oldName, newName] of renames) {
    // Шинэ нэр нь энгийн танигч биш бол хашилттай хэлбэрээр бичнэ
    // (tokenizer 'Нэр'!A1 хэлбэрийг үргэлж уншина).
    const safeNew = BARE_SHEET_NAME_RE.test(newName)
      ? newName
      : `'${newName.replace(/'/g, "''")}'`;
    // Хашилттай хэлбэр: 'Нэр'!A1 (доторх ' нь '' болж давхардсан байдаг).
    const escQuoted = escapeRe(oldName.replace(/'/g, "''"));
    out = out.replace(
      new RegExp(`'[ \\t]*${escQuoted}[ \\t]*'(?=!)`, 'giu'),
      () => safeNew,
    );
    // Хашилтгүй хэлбэр: Нэр!A1 / Нэр !A1 — өмнөх тэмдэгт нь нэрийн тэмдэгт
    // ба хашилт БИШ байх ёстой.
    const escBare = escapeRe(oldName);
    out = out.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}_'])${escBare}[ \\t]*(?=!)`, 'giu'),
      (_m, lead: string) => `${lead}${safeNew}`,
    );
  }
  return out;
}

/**
 * Томьёог хөрвүүлнэ: "..." литералууд орчуулагдаж, литерал-бус хэсэгт
 * хуудасны нэрийн лавлагаа шинэчлэгдэнэ. Бусад ЮУ Ч өөрчлөгдөхгүй.
 */
export function translateFormula(
  f: string,
  tr: Translate,
  renames: ReadonlyMap<string, string> = new Map(),
): string {
  let out = '';
  let last = 0;
  for (const m of f.matchAll(FORMULA_STR_RE)) {
    const lit = m[0] ?? '';
    const idx = m.index ?? 0;
    out += renameSheetRefs(f.slice(last, idx), renames);
    out += translateLiteral(lit, tr);
    last = idx + lit.length;
  }
  out += renameSheetRefs(f.slice(last), renames);
  return out;
}

/* ------------------------------------------------------------------ */
/*  Дэвтрийг бүхэлд нь алхагч                                          */
/* ------------------------------------------------------------------ */

/**
 * `sheet.addons`-ийн шошгуудыг хөрвүүлнэ. Сервер spec-ийн бүтцийг
 * ЭЗЭМШДЭГГҮЙ (`unknown` — эзэн нь frontend `lib/addons.ts`) тул зөвхөн
 * items/lines/costLines/sections-ийн `label`-д хамгаалалттайгаар хүрнэ;
 * бусад талбар (unit, pct, key, baseRef …) хэвээр дамжина.
 */
function mapAddonSpec(
  addons: unknown,
  tr: Translate,
  renames: ReadonlyMap<string, string>,
): unknown {
  if (!addons || typeof addons !== 'object') return addons;
  const spec = addons as Record<string, unknown>;
  let changed = false;
  const mapItems = (items: unknown): unknown => {
    if (!Array.isArray(items)) return items;
    let itemsChanged = false;
    const next = items.map((it) => {
      if (!it || typeof it !== 'object') return it;
      const o = it as Record<string, unknown>;
      let patch: Record<string, unknown> | null = null;
      if (typeof o.label === 'string' && hasCyrillic(o.label)) {
        const label = tr(o.label);
        if (label !== o.label) (patch ??= { ...o }).label = label;
      }
      // ⚠️ Унтраасан зардлын мөрийг цэснээс ДАХИН асаахад энэ хадгалагдсан
      // `priceFormula` нүдэнд ШУУД бичигддэг (frontend `lib/addons.ts`). Хуудасны
      // нэр солигдсон үед үүнийг дагуулж заасаагүй бол англи хуулбар дээр
      // дахин асаасан мөр #ТОМЬЁО! өгнө (хуучин саналуудад `=ИГС!G14` мэт бий).
      if (typeof o.priceFormula === 'string' && o.priceFormula) {
        const pf = translateFormula(o.priceFormula, tr, renames);
        if (pf !== o.priceFormula) (patch ??= { ...o }).priceFormula = pf;
      }
      if (!patch) return it;
      itemsChanged = true;
      return patch;
    });
    if (!itemsChanged) return items;
    changed = true;
    return next;
  };
  const out: Record<string, unknown> = { ...spec };
  const items = mapItems(spec.items);
  if (items !== spec.items) out.items = items;
  for (const key of ['lines', 'costLines', 'sections']) {
    const sub = spec[key];
    if (!sub || typeof sub !== 'object') continue;
    const so = sub as Record<string, unknown>;
    const subItems = mapItems(so.items);
    if (subItems !== so.items) out[key] = { ...so, items: subItems };
  }
  return changed ? out : addons;
}

/**
 * БАРИМТЫН ДООД ТАЙЛБАРЫН төлөв (`SheetDoc.notes`, frontend `lib/quoteNotes.ts`).
 *
 *   • `text` — PM-ийн ГАРААР бичсэн өгүүлбэр. Толь/AI-аар хөрвүүлнэ, эс бөгөөс
 *     англи баримт нээгдээд `syncNotes(sheet,'en')` ажиллахад тэр МОНГОЛ
 *     бичвэр буцаад нүдэнд бичигдэнэ (нүд нь орчуулагдсан ч төлөв нь биш).
 *   • `i18n` — МОНГОЛ→АНГЛИ хос. Англи хуулбар дээр утгагүй тул ХАЯНА;
 *     `syncNotes` мөн адил англи хуудсан дээр үүнийг бичдэггүй.
 *   • `on`/`off` — түлхүүр, орчуулга хамаарахгүй.
 */
function mapNoteState(notes: unknown, tr: Translate): unknown {
  if (!notes || typeof notes !== 'object') return notes;
  const o = notes as Record<string, unknown>;
  let changed = false;
  const out: Record<string, unknown> = { ...o };

  if (o.i18n !== undefined) {
    delete out.i18n;
    changed = true;
  }
  if (o.text && typeof o.text === 'object') {
    const src = o.text as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    let textChanged = false;
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string' && hasCyrillic(v)) {
        const en = tr(v);
        next[k] = en;
        if (en !== v) textChanged = true;
      } else next[k] = v;
    }
    if (textChanged) {
      out.text = next;
      changed = true;
    }
  }
  return changed ? out : notes;
}

/** Нэг нүдийг хөрвүүлнэ; өөрчлөлтгүй бол ЭХ объектоо буцаана. */
function mapCell(cell: SheetCell, tr: Translate, renames: ReadonlyMap<string, string>): SheetCell {
  let next: SheetCell | null = null;
  const ensure = (): SheetCell => (next ??= { ...cell });
  if (typeof cell.f === 'string' && cell.f) {
    // Томьёотой нүдэнд `v` нь зөвхөн кэш — эвлүүлэхгүй, томьёо давуу.
    const f = translateFormula(cell.f, tr, renames);
    if (f !== cell.f) ensure().f = f;
  } else if (typeof cell.v === 'string' && hasCyrillic(cell.v)) {
    const v = tr(cell.v);
    if (v !== cell.v) ensure().v = v;
  }
  if (Array.isArray(cell.choices)) {
    const choices = cell.choices.map((ch) => (typeof ch === 'string' ? tr(ch) : ch));
    if (choices.some((ch, i) => ch !== cell.choices?.[i])) ensure().choices = choices;
  }
  return next ?? cell;
}

/**
 * Дэвтрийн бүх орчуулагдах байрлалд `tr`-ийг хэрэглэнэ. Collect ба apply
 * хоёул ЭНЭ нэг алхагчаар явдаг тул «цуглуулсан мөр» ба «хөрвүүлсэн мөр»
 * хэзээ ч зөрөхгүй.
 */
function mapWorkbook(workbook: WorkbookDoc, tr: Translate): WorkbookDoc {
  // Хуудасны нэрс — ЭХЭЛЖ: томьёоны `Нэр!A1` лавлагааг дагуулж солиход
  // хуучин→шинэ нэрийн зураглал хэрэгтэй (файлын толгойн тайлбарыг үз).
  //
  // ⚠️ ДАВХАР НЭР ГАРГАХГҮЙ. Хөдөлгүүр хуудсыг нэрээр нь `trim().toLowerCase()`
  // харьцуулж олдог тул хоёр хуудас ижил нэртэй болбол хөндлөн лавлагаа
  // ЧИМЭЭГҮЙ буруу хуудас руу холбогдоно (`idByName` сүүлийнхийг, `sheetByName`
  // эхнийхийг сонгодог) — алдаа гарахгүй, зөвхөн ӨӨР ТОО гарна. Тиймээс
  // орчуулаагүй (латин) нэрсийг эхэлж «эзэмшүүлээд», мөргөлдвөл 2, 3 … дугаар
  // залгана (`Summary2` — хашилтгүй бичигдэх хэлбэрээ хадгална).
  const norm = (s: string) => s.trim().toLowerCase();
  const proposed = workbook.sheets.map((s) => translateSheetName(s.name, tr));
  const taken = new Set<string>(
    workbook.sheets.filter((s, i) => proposed[i] === s.name).map((s) => norm(s.name)),
  );
  const renames = new Map<string, string>();
  const newNames = workbook.sheets.map((s, i) => {
    const want = proposed[i] ?? s.name;
    if (want === s.name) return s.name;
    let nn = want;
    for (let n = 2; taken.has(norm(nn)); n += 1) nn = `${want}${n}`;
    taken.add(norm(nn));
    renames.set(s.name, nn);
    return nn;
  });

  const sheets = workbook.sheets.map((sheet, i): NamedSheet => {
    const cells: Record<string, SheetCell> = {};
    let cellsChanged = false;
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      // ⚠️ Хадгалагдсан дэвтэрт `null` нүд ТААРДАГ (сервер JSON-ыг түүхийгээр
      // нь хадгалдаг). Хөдөлгүүр ч мөн `if (!cell) continue` гэж хамгаалдаг —
      // энд шалгахгүй бол орчуулга TypeError шидэж, AI-гаа зарцуулсны эцэст
      // админд хоосон 500 очно (`app.onError` репод БАЙХГҮЙ).
      if (!cell || typeof cell !== 'object') {
        cells[ref] = cell;
        continue;
      }
      const next = mapCell(cell, tr, renames);
      if (next !== cell) cellsChanged = true;
      cells[ref] = next;
    }
    const addons = mapAddonSpec(sheet.addons, tr, renames);
    const notes = mapNoteState(sheet.notes, tr);
    const name = newNames[i] ?? sheet.name;
    if (!cellsChanged && addons === sheet.addons && notes === sheet.notes && name === sheet.name) {
      return sheet;
    }
    const out: NamedSheet = { ...sheet, name, cells: cellsChanged ? cells : sheet.cells };
    if (addons !== undefined) out.addons = addons;
    if (notes !== undefined) out.notes = notes as NamedSheet['notes'];
    else delete out.notes;
    return out;
  });
  // anchors нь хуудасны ID-гаар заадаг (нэрээр БИШ) тул хэвээр.
  return { ...workbook, sheets };
}

/**
 * Тольд байхгүй, кирилл агуулсан БҮХ мөрийг цуглуулна (AI-д явуулах
 * жагсаалт). TRIM хийсэн, давхардалгүй.
 */
export function collectTranslatables(workbook: WorkbookDoc): string[] {
  const out = new Set<string>();
  mapWorkbook(workbook, (s) => {
    if (needsAiTranslation(s)) out.add(s.trim());
    return s;
  });
  return [...out];
}

/**
 * Орчуулгыг дэвтэрт тусгана. `aiBySource` нь TRIM хийсэн монгол мөр → англи;
 * толь ЭХЭЛЖ шалгагдана, аль алинд нь байхгүй мөр МОНГОЛООРОО үлдэнэ
 * (AI-ийн хэсэгчилсэн уналт нүд хоослохгүй).
 */
export function applyTranslations(
  workbook: WorkbookDoc,
  aiBySource: ReadonlyMap<string, string>,
): WorkbookDoc {
  return mapWorkbook(workbook, (s) => translateFreeText(s, aiBySource));
}

/* ------------------------------------------------------------------ */
/*  Workers AI — батч орчуулга                                         */
/* ------------------------------------------------------------------ */

export interface TranslatableString {
  id: string;
  mn: string;
}

/**
 * Үндсэн загвар — JSON mode-той 70B (workers-types каталогид типтэй).
 * Унавал (throw / хоосон хариу) → репогийн туршигдсан 8B fallback
 * (`lib/meetingAnalysisAi.ts`-ийн промпт-скелет + brace-slice parse хэв маяг).
 */
const AI_MODEL_PRIMARY = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const AI_MODEL_FALLBACK = '@cf/meta/llama-3.1-8b-instruct';

/** Нэг дуудлагад явах мөрийн дээд тоо — Worker-ийн батч конвенц. */
const AI_BATCH_SIZE = 60;
/** ~60 богино мөрийн орчуулга + JSON хүрээ. Кирилл токен халуун гүйдэг
 *  тул нөөцтэй (routes/ai.ts-ийн тайлбартай ижил үндэслэл). */
const AI_MAX_TOKENS = 3000;

const AI_SYSTEM =
  'You are a professional Mongolian-to-English translator preparing a formal ' +
  'construction-engineering price quotation. Translate each Mongolian string into ' +
  'formal business English using standard AEC (architecture / engineering / ' +
  'construction) terminology. Do NOT translate or alter numbers, cell references, ' +
  'formulas, the symbols %, ₮ and №, abbreviations such as BMS or BD 81-16-20, or ' +
  'personal and company names. Return ONLY JSON in exactly this form, with one ' +
  'entry per input id and no other text:\n' +
  '{"translations":[{"id":"...","en":"..."}]}';

/**
 * Моделийн хариунаас текстийг сугална (string | {response} хоёуланг).
 *
 * ⚠️ JSON mode (`response_format`) үед ажиллах орчин `response`-ыг УРЬДЧИЛАН
 * ЗАДАЛСАН ОБЪЕКТООР буцаадаг (пиннэсэн `workers-types` нь `string` гэж
 * хоцорсон). `String(objekt)` нь "[object Object]" өгч, `parseTranslations`
 * хоосон буцаагаад БҮХ батч 8B fallback руу чимээгүй унана — өөрөөр хэлбэл
 * үндсэн (чанартай) модель ажиллахаа болино. Тиймээс объект хэлбэрийг
 * буцаагаад JSON болгож өгнө.
 */
function outputText(res: unknown): string {
  if (typeof res === 'string') return res;
  if (res && typeof res === 'object' && 'response' in res) {
    const r = (res as { response?: unknown }).response;
    if (r && typeof r === 'object') return JSON.stringify(r);
    return String(r ?? '');
  }
  return '';
}

/**
 * Хариуг хамгаалалттай задлана: brace-slice → JSON.parse → хэлбэрийн шүүлт.
 * Зөвхөн батчид байсан id-г авна (модель зохиосон id хаягдана).
 */
function parseTranslations(raw: string, validIds: ReadonlySet<string>): Map<string, string> {
  const out = new Map<string, string>();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return out;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as { translations?: unknown };
    if (!Array.isArray(obj.translations)) return out;
    for (const t of obj.translations) {
      if (!t || typeof t !== 'object') continue;
      const o = t as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.en !== 'string') continue;
      const en = o.en.trim();
      if (!en || !validIds.has(o.id)) continue;
      out.set(o.id, en);
    }
  } catch {
    /* хариу JSON биш — доорх fallback/монгол үлдээх зам ажиллана */
  }
  return out;
}

/**
 * Чөлөөт мөрүүдийг батчаар орчуулна. Батчууд ДАРААЛЛААР явна (subrequest
 * төсөв). ХЭЗЭЭ Ч throw ХИЙХГҮЙ: аль нэг батч хоёр моделийн алинд ч бүтэлгүй
 * бол тэр батчийн мөрүүд map-д ОРОХГҮЙ — дуудагч тэдгээрийг монголоор нь
 * үлдээнэ («AI-ийн уналт нүд хоослохгүй» гэрээ).
 */
export async function translateStringsAi(
  ai: Ai,
  strings: TranslatableString[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < strings.length; i += AI_BATCH_SIZE) {
    const batch = strings.slice(i, i + AI_BATCH_SIZE);
    const ids = new Set(batch.map((s) => s.id));
    const userContent = JSON.stringify({ strings: batch });

    let got: Map<string, string> | null = null;
    try {
      const res = await ai.run(AI_MODEL_PRIMARY, {
        messages: [
          { role: 'system', content: AI_SYSTEM },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: AI_MAX_TOKENS,
      });
      got = parseTranslations(outputText(res), ids);
    } catch (err) {
      console.error('[quoteTranslate] primary model failed', err);
    }

    if (!got || got.size === 0) {
      try {
        const res = (await ai.run(AI_MODEL_FALLBACK, {
          messages: [
            { role: 'system', content: AI_SYSTEM },
            { role: 'user', content: userContent },
          ],
          max_tokens: AI_MAX_TOKENS,
        } as AiTextGenerationInput)) as AiTextGenerationOutput;
        got = parseTranslations(outputText(res), ids);
      } catch (err) {
        console.error('[quoteTranslate] fallback model failed', err);
      }
    }

    if (got) for (const [id, en] of got) out.set(id, en);
  }
  return out;
}
