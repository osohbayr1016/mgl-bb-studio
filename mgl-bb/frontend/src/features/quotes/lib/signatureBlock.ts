/**
 * БАРИМТЫН ГАРЫН ҮСГИЙН БЛОК БОЛОН ТАЙЛБАР, АШИГЛАСАН МАТЕРИАЛ.
 *
 * Хэвлэх хуудас нь хүснэгтийн ДООД мөрүүдийг `SheetGrid`-ээс НУУЖ
 * (`hiddenRows`), энд задалсан бүтцээр React-ээр дахин зурдаг. Тиймээс энэ файл
 * нь «баримтын доод хэсгийг ХУУДСААС УНШИХ» цорын ганц газар.
 *
 * ⚠️⚠️ 2026-08-24 — ХОЁР НОЦТОЙ АЛДАА ЗАССАН. БУЦААЖ БҮҮ ЭВД.
 *
 * 1. **Тооцоолсон утгыг уншиж чаддаггүй байв.** `values` нь
 *    `Map<CellRef, CellValue | FormulaError>` бөгөөд `CellValue = number |
 *    string | null` — өөрөөр хэлбэл утга нь ТҮҮХИЙ, `{ v }` БҮРХҮҮЛГҮЙ.
 *    Хуучин код `values.get(ref)?.v` гэж уншдаг байсан тул мөрөн дээр ҮРГЭЛЖ
 *    `undefined` буцаана. Үр дүнд нь загварын
 *    `="Тайлбар: … ₮" & TEXT(НИЙТ ДҮН) & …` ТОМЬЁО (яг зөв, динамик) хэзээ ч
 *    уншигдаагүй бөгөөд нөөц салаа ажиллаж, ХАТУУ БИЧСЭН ₮1,214,243,934 гэсэн
 *    тоог баримт бүр дээр хэвлэдэг байв.
 * 2. **БД тайлбар / Ашигласан материал нь хуудсанд байсаар атал уншигддаггүй
 *    байв.** Хуучин задлагч мөр бүрээс ЗӨВХӨН хамгийн зүүн нүдийг авдаг байсан
 *    тул `span(r,0,1,'Тайлбар:') + span(r,2,…,'БД-81-16-20-ийн …')` бүтцээс
 *    зөвхөн «Тайлбар:» шошиг олдож, бодит текст алга болдог; үргэлжлэх мөрүүд
 *    (эхний нүд нь C баганад) огт ангилагдалгүй хаягддаг байв. Тиймээс
 *    хэрэглэгч хуудсан дээр тайлбараа засахад хэвлэмэлд НӨЛӨӨЛДӨГГҮЙ байв.
 *
 * ⇒ Одоо: мөрийн БҮХ нүдийг цуглуулж, шошиг → үргэлжлэл гэсэн жижиг төлөвт
 *   машинаар ангилна. Хуудсанд юу бичсэн нь хэвлэмэлд ЯГ тэр чигтээ гарна.
 *   `DEFAULT_*` тогтмолууд нь ЗӨВХӨН тухайн хэсэг хуудсанд огт байхгүй үеийн
 *   (хуучин загвараар үүссэн санал) нөөц.
 */
import { refToCoord } from './formula/refs';
import { numberToEnglish } from './numberToEnglish';
import { numberToMongolian } from './numberToMongolian';
import {
  TOTAL_WORDS_RE,
  contractNoteText,
  isManagedNoteText,
  noteCtx,
  noteTextsFor,
} from './quoteNotes';
import type { CellValue, FormulaError } from './formula';
import type { QuoteLang, SheetDoc } from '../types/quotes';

const HEADING_RE = /^\s*(боловсруулсан|бэлтгэсэн|prepared by|developed by|compiled by)\s*:?\s*$/i;
const ORG_RE = /ХХК|ХК\b|компани|LLC|Ltd|JSC|Co\.|Company/i;
const ROLE_RE = /(менежер|захирал|дарга|инженер|ерөнхий|manager|director|engineer|chief|head)/i;

/** «Тайлбар:» — ЗӨВХӨН ганцаараа зогсох ШОШГЫН нүд (урт өгүүлбэр НЬ БИШ). */
const NOTE_LABEL_RE = /^\s*(тайлбар|note|notes)\s*:?\s*$/i;
/** «Ашигласан материал:» шошиг. */
const MATERIAL_LABEL_RE =
  /^\s*(ашигласан материал|материал|source|sources|reference materials?)\s*:?\s*$/i;
/* «… ₮123,456 /… төгрөг/ болно.» — дүн үсгээр бичсэн мөр.
 * ⚠️ ХУУЛБАР БИШ: `lib/quoteNotes.ts`-ээс импортолно. Тэнд энэ жишиг нь
 * гэрээний өгүүлбэрийг СЭРГЭЭХ ЗАНГУУ болж мөн хэрэглэгддэг тул хоёр газар
 * тусад нь бичвэл задлагч ба сэргээлт хоёр зөрнө. */
/** Гэрээний хамрах хүрээ / хөнгөлөлтийн тайлбар (`quoteNotes`-ийн ИХЭР). */
const CONTRACT_RE =
  /(дээрх үнийн санал нь|this quotation covers|хөнгөлөлт|гэрээг мөн манай|additional discount)/i;

/* ⚠️⚠️ `DEFAULT_BD_NOTES` / `DEFAULT_MATERIAL_NOTES` ХАСАГДСАН (2026-08-24).
 * БҮҮ СЭРГЭЭ.
 *
 * Тэд нь «хуудсанд тайлбарын блок байхгүй бол таван БД-ийн өгүүлбэр ба гурван
 * стандартыг ХЭВЛЭ» гэсэн ХАТУУ БИЧСЭН нөөц байв. 0185-аас ӨМНӨХ загвараар
 * үүссэн санал бүрийн `sheet_json`-д тэр блок ОГТ БАЙДАГГҮЙ тул нөөц нь
 * ПРАКТИКТ ГОЛ ЗАМ болж, баримт нь өөрийнхөө өгөгдөлтэй зөрчилдөж байв.
 *
 * ХЭМЖСЭН ЖИШЭЭ (санал №51, `/quotes/51/print`, 2026-08-24): `addons.items` нь
 * bms·water·fire·cool·quake (ТӨСӨВ БАЙХГҮЙ), `costLines` нь sketch·landscape
 * (ГЕОЛОГИ·ТОПОГРАФИ·ЕРӨНХИЙ ТӨЛӨВЛӨГӨӨ БАЙХГҮЙ) — гэтэл хэвлэмэл нь
 * «төсвийн 8% нэмж тооцов», «БД 81-117-13 … геологи», «БД 81-103-21 … геодизи»
 * гурвыг сүрхий бичсээр байв.
 *
 * ⇒ Одоо нөөц нь `lib/quoteNotes.ts`-ийн ЯГ ТЭР дүрмүүдээр ГАРГАГДАНА
 *   (`noteTextsFor`). Хуудсанд блок байгаа эсэхээс үл хамааран цаас нь
 *   баримтын бодит агуулгыг хэлнэ, PM-ийн «Тайлбар» цэсний асаалт/унтраалт ч
 *   тэр даруй үйлчилнэ (төлөв нь мөрөнд БИШ, `sheet.notes`-д ТҮЛХҮҮРЭЭР
 *   хадгалагддаг тул хуучин хуудсыг мөр оруулж эвдэх шаардлагагүй). */

/* ⚠️ `DEFAULT_CONTRACT_NOTE` ХАСАГДСАН (2026-08-24). БҮҮ СЭРГЭЭ.
 *
 * Тэр нь «эскиз зургийн ажлын үнийн санал … ажлын зургийн гэрээг мөн манайхаар
 * байгуулбал хөнгөлнө» гэсэн ХАТУУ өгүүлбэр байв — ажлын зураг нь аль хэдийн
 * үнэд ОРСОН бүрэн саналууд дээр ч хэвлэгддэг тул баримт нь өөрийнхөө
 * тоонуудтай зөрчилдөж, аль хэдийн гэрээлж буй ажлыг дахин гэрээлбэл хөнгөлнө
 * гэж амладаг байв. Одоо `quoteNotes.contractNoteText` нь баримтын ХАМРАХ
 * ХҮРЭЭНЭЭС гаргана (`azPriced` + эскизийн зардлын мөр). */

export const DEFAULT_HEADING = 'БОЛОВСРУУЛСАН:';
export const DEFAULT_ORG = ['«Эм Жи Эл И Эн Си» ХХК-ийн', 'Төслийн менежер:'];

export interface SignatureBlock {
  hiddenRows: ReadonlySet<number>;
  heading: string;
  org: string[];
  bdNotes: string[];
  materialNotes: string[];
  /**
   * Блокуудын ШОШГЫН бичвэр — ХУУДСААС уншсанаар.
   *
   * ⚠️ 2026-08-24 хүртэл `QuotePrintPage` эдгээрийг МОНГОЛООР ХАТУУ бичдэг
   * байсан тул (а) англи баримт дээр «Тайлбар:» гэж монголоор хэвлэгддэг байв
   * (нүд нь орчуулагдсан ч), (б) жагсаалт хоосорсон үед өнчин тод шошиг
   * үлддэг байв. Одоо хуудсан дээрх нүднээс ирнэ — нэг эх сурвалж.
   */
  noteLabel: string;
  materialLabel: string;
  /** Хоосон мөр = «дүн үсгээр» өгүүлбэр огт хэвлэгдэхгүй (ХУДАЛ тоо гаргахгүй). */
  totalInWords: string;
  contractNote: string;
}

export interface SignatureBlockOptions {
  /**
   * Баримтын БОДИТ НИЙТ ДҮН (`lib/resolveTotal.ts` → `resolveAnchor`).
   * ЗӨВХӨН хуудсан дээр «дүн үсгээр» мөр огт олдоогүй үед хэрэглэнэ —
   * хуудасны өөрийнх нь томьёо ҮРГЭЛЖ ДАВУУ (тэнд PM гараар засаж болно).
   */
  totalAmount?: number | null;
  /** Дүнг үсгээр бичих хэл — зөвхөн нөөц өгүүлбэрт нөлөөлнө. */
  lang?: QuoteLang;
}

export const DEFAULT_NOTE_LABEL = { mn: 'Тайлбар:', en: 'Note:' };
export const DEFAULT_MATERIAL_LABEL = { mn: 'Ашигласан материал:', en: 'Reference materials:' };

const EMPTY: SignatureBlock = {
  hiddenRows: new Set(),
  heading: DEFAULT_HEADING,
  noteLabel: DEFAULT_NOTE_LABEL.mn,
  materialLabel: DEFAULT_MATERIAL_LABEL.mn,
  org: [...DEFAULT_ORG],
  // Хуудасгүй үед тайлбарыг ЗОХИОХГҮЙ — эх өгөгдөл байхгүй.
  bdNotes: [],
  materialNotes: [],
  totalInWords: '',
  // Хуудасгүй үед хамрах хүрээг МЭДЭХГҮЙ — юу ч бичихгүй (`bdNotes`-тай ижил).
  contractNote: '',
};

/**
 * Нүдний ХАРАГДАХ бичвэр.
 *
 * ⚠️ `values` нь ТҮҮХИЙ утга хадгална (`CellValue = number | string | null`),
 * `{ v }` бүрхүүл БИШ — `?.v` гэж уншвал ҮРГЭЛЖ `undefined` (дээрх 1-р алдаа).
 * Томьёоны алдаа (`{ code }`) нь бичвэр биш тул хаяна.
 */
function textOfValue(v: CellValue | FormulaError | undefined): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Дүнг «Тайлбар: … ₮N /үсгээр/ болно.» өгүүлбэр болгоно (ЗӨВХӨН нөөц зам —
 * хуудсан дээр тэр мөр огт байхгүй хуучин санал).
 *
 * ⚠️ Бичвэр нь ХОЁР эх сурвалжтай ИХЭР бөгөөд гурвуулаа ТААРАХ ЁСТОЙ:
 *   • `backend/scripts/gen-control-budget-template.mjs` — хуудсанд бичдэг
 *     монгол томьёо (энэ функцийн монгол салаа түүнтэй үг үсгээрээ ижил),
 *   • `backend/src/lib/quoteTranslate.ts` `QUOTE_MN_EN_DICT` — тэр монгол
 *     бичвэрийн албан ёсны англи хувилбар (энэ функцийн англи салаа).
 * Аль нэгийг өөрчлөх бол гурвууланг нь нэг PR-д өөрчил, эс бөгөөс нэг баримт
 * дотор хоёр өөр өгүүлбэр гарна.
 *
 * ⚠️ Тоог ХОЁР ХЭЛ ДЭЭР Ч `en-US` бүлэглэлтээр бичнэ — хуудасны `TEXT()`
 * хөдөлгүүр ч мөн адил (`useQuoteWorkbook` → locale) тул нөөц ба томьёоны
 * гаралт ялгарахгүй.
 */
function buildTotalSentence(amount: number, lang: QuoteLang): string {
  const n = Math.round(amount);
  if (lang === 'en') {
    return `Note: The total price for the design works is MNT ${n.toLocaleString('en-US')} /${numberToEnglish(n)} tugriks/.`;
  }
  return `Тайлбар: Зураг төсөл боловсруулах ажлын нийт дүн ₮${n.toLocaleString('en-US')} /${numberToMongolian(n)} төгрөг/ болно.`;
}

export function detectSignatureBlock(
  sheet: SheetDoc | undefined,
  values?: Map<string, CellValue | FormulaError>,
  opts: SignatureBlockOptions = {},
): SignatureBlock {
  const lang: QuoteLang = opts.lang ?? 'mn';
  const amount =
    typeof opts.totalAmount === 'number' &&
    Number.isFinite(opts.totalAmount) &&
    opts.totalAmount > 0
      ? opts.totalAmount
      : null;

  if (!sheet) {
    return {
      ...EMPTY,
      noteLabel: lang === 'en' ? DEFAULT_NOTE_LABEL.en : DEFAULT_NOTE_LABEL.mn,
      materialLabel: lang === 'en' ? DEFAULT_MATERIAL_LABEL.en : DEFAULT_MATERIAL_LABEL.mn,
      totalInWords: amount ? buildTotalSentence(amount, lang) : '',
    };
  }

  let lastTableRow = -1;
  /** Мөр → тухайн мөрийн БҮХ бичвэрт нүд (баганаар эрэмбэлэгдэнэ). */
  const textByRow = new Map<number, { col: number; text: string }[]>();

  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    if (!cell) continue;
    const co = refToCoord(ref);
    if (!co || co.r >= sheet.rows || co.c >= sheet.cols) continue;
    if (cell.s?.border) lastTableRow = Math.max(lastTableRow, co.r);

    // Тооцоолсон утга ДАВУУ (томьёотой нүд), эс бөгөөс литерал.
    const computed = values ? textOfValue(values.get(ref)) : '';
    const literal = typeof cell.v === 'string' ? cell.v.trim() : '';
    const text = computed || literal;
    if (!text) continue;

    const list = textByRow.get(co.r);
    if (list) list.push({ col: co.c, text });
    else textByRow.set(co.r, [{ col: co.c, text }]);
  }
  for (const list of textByRow.values()) list.sort((a, b) => a.col - b.col);

  const hidden = new Set<number>();
  let heading = '';
  const org: string[] = [];
  const bdNotes: string[] = [];
  const materialNotes: string[] = [];
  let totalInWords = '';
  let noteLabel = '';
  let materialLabel = '';

  // Хүснэгтээс доош бүх мөрийг SheetGrid-ээс нууж, бүтцээр нь React блокт зурна
  if (lastTableRow >= 0) {
    for (let r = lastTableRow + 1; r < sheet.rows; r++) hidden.add(r);
  }

  /**
   * Одоо аль ЖАГСААЛТ руу «үргэлжлэл» мөрүүд орох вэ. Загварт БД тайлбар ба
   * ашигласан материалын мөрүүд нь шошгын мөрийн ДАРАА, эхний нүд нь тэр
   * шошгоос БАРУУН талд (C багана) байрлаж дараалдаг.
   */
  let mode: 'bd' | 'material' | null = null;
  /** Үргэлжлэл гэж үзэх ХАМГИЙН ЗҮҮН багана — шошиг нь A/B баганад сууна. */
  let contCol = 1;

  const rows = [...textByRow.keys()].sort((a, b) => a - b);
  for (const r of rows) {
    if (r <= lastTableRow) continue;
    const cells = textByRow.get(r)!;
    const first = cells[0]!;
    const label = first.text;
    const rest = cells.slice(1).map((c) => c.text);
    const joined = cells.map((c) => c.text).join(' ');

    if (!heading && HEADING_RE.test(label)) {
      heading = label;
      mode = null;
      continue;
    }

    // «Тайлбар:» ШОШИГ — ард нь ижил мөрөнд эхний тайлбар бичигдсэн байдаг.
    if (NOTE_LABEL_RE.test(label)) {
      mode = 'bd';
      noteLabel = label;
      contCol = first.col + 1;
      bdNotes.push(...rest);
      continue;
    }

    if (MATERIAL_LABEL_RE.test(label)) {
      mode = 'material';
      materialLabel = label;
      contCol = first.col + 1;
      materialNotes.push(...rest);
      continue;
    }

    // «… ₮N /… төгрөг/ болно.» — загварт ЭНЭ мөр нь ТОМЬЁО тул `joined` нь
    // аль хэдийн БОДИТ НИЙТ ДҮН-г агуулж байна.
    if (TOTAL_WORDS_RE.test(joined)) {
      totalInWords = joined;
      mode = null;
      continue;
    }

    /* Гэрээний хамрах хүрээний мөр — бичвэрийг нь АВАХГҮЙ, зөвхөн ТАНИНА:
     * хэвлэгдэх бичвэрийг `contractNoteText` ДҮРМЭЭР гаргана (доорх return).
     * `mode`-ыг тэглэх нь чухал — эс бөгөөс дараагийн мөрүүд тайлбарын
     * жагсаалт руу үргэлжлэн орно. */
    if (CONTRACT_RE.test(joined)) {
      mode = null;
      continue;
    }

    /* Үргэлжлэл: шошгын баганаас БАРУУН талд эхэлсэн бичвэрт мөр.
     *
     * ⚠️ ЭНЭ ШАЛГУУР нь доорх байгууллага/албан тушаалынхаас ЭРТ байх ЁСТОЙ.
     * Эс бөгөөс «БД 81-117-13 Барилгын инженер геологийн ажлын жишиг үнэ»
     * гэсэн МАТЕРИАЛЫН мөр нь «инженер» гэсэн үгээс болж `ROLE_RE`-д унаж,
     * гарын үсгийн блок руу орохын зэрэгцээ `mode`-ыг тэглэж ДАРААГИЙН
     * материалын мөрийг ч (БД 81-103-21) хамт унагаадаг байв — 2026-08-24-нд
     * бодит загвар (0185) дээр хэмжиж илрүүлсэн.
     *
     * Найдвартай ялгах шинж: гарын үсгийн блокийн мөрүүд ҮРГЭЛЖ A баганаас
     * эхэлдэг, харин тайлбар/материалын үргэлжлэл нь шошгын баруун талаас
     * (загварт C багана) эхэлдэг. Дүн үсгээр ба гэрээний тайлбар нь мөн A
     * баганаас эхэлдэг тул дээрх шалгуурууд нь энэ шатанд ХҮРЭХГҮЙ. */
    if (mode && first.col >= contCol) {
      (mode === 'bd' ? bdNotes : materialNotes).push(...cells.map((c) => c.text));
      continue;
    }

    // Байгууллага / албан тушаалын богино мөр — гарын үсгийн блок.
    if (label.length < 60 && (ORG_RE.test(label) || ROLE_RE.test(label))) {
      org.push(label);
      mode = null;
      continue;
    }

    /* СҮҮЛЧИЙН НӨӨЦ: жагсаалт дундуур байгаа, өөр юунд ч таараагүй мөрийг
     * ЧИМЭЭГҮЙ БҮҮ ХАЯ — идэвхтэй жагсаалтад нэм.
     *
     * Шалтгаан: PM хуудсан дээрээ ШИНЭ тайлбар нэмэхдээ A баганаас эхлүүлэн
     * бичих нь бүрэн жам ёсны. Хуучин зан төлөв бол тэр мөрийг хэвлэмэлээс
     * зүгээр л алга болгодог байсан — «заслаа, юу ч өөрчлөгдсөнгүй» гэдэг нь
     * хамгийн төөрөгдүүлсэн үр дүн. Буруу шошгын дор гарсан мөрийг хэрэглэгч
     * шууд хараад засаж чадна, харин алга болсныг нь мэдэх ч аргагүй.
     *
     * ⚠️ `mode` нь «дүн үсгээр» ба гэрээний тайлбарын мөрөнд тэгширдэг тул
     * тэдгээрийн ДАРААХ мөрүүд (БОЛОВСРУУЛСАН:, байгууллага) энд хүрэхгүй. */
    if (mode) {
      (mode === 'bd' ? bdNotes : materialNotes).push(joined);
    }
  }

  /**
   * Тайлбарыг ДҮРМЭЭР гаргана; `parsed`-аас зөвхөн ДҮРЭМГҮЙ (PM-ийн өөрийн)
   * мөрүүдийг авч үлдээнэ.
   */
  const ctx = noteCtx(sheet);
  const derive = (group: 'bd' | 'material', parsed: string[]): string[] =>
    noteTextsFor(
      sheet,
      group,
      lang,
      ctx,
      parsed.filter((t) => !isManagedNoteText(t, group)),
    ).texts;

  if (!totalInWords && amount) totalInWords = buildTotalSentence(amount, lang);
  if (!heading) heading = DEFAULT_HEADING;
  if (org.length === 0) org.push(...DEFAULT_ORG);

  return {
    hiddenRows: hidden,
    heading,
    org,
    noteLabel: noteLabel || (lang === 'en' ? DEFAULT_NOTE_LABEL.en : DEFAULT_NOTE_LABEL.mn),
    materialLabel:
      materialLabel || (lang === 'en' ? DEFAULT_MATERIAL_LABEL.en : DEFAULT_MATERIAL_LABEL.mn),
    /* ⚠️ Тайлбарыг ХУУДСААС ХУУЛАХГҮЙ, `lib/quoteNotes.ts`-ийн ДҮРМЭЭР
     * ГАРГАНА — хуудсан дээр тэр блок байгаа эсэхээс үл хамааран.
     *
     * Яагаад хуулахгүй вэ: (а) 0185-аас өмнөх саналуудын хуудсанд блок ОГТ
     * байдаггүй тул хуулах юм байхгүй (тэдгээр нь өмнө нь ХАТУУ БИЧСЭН нөөц
     * рүү унаж, өөрсдийнхөө өгөгдөлтэй зөрчилдсөн таван өгүүлбэр хэвлэдэг
     * байв — санал №51); (б) блок байгаа саналын мөрүүд нь `syncNotes`
     * ажиллаж амжаагүй байхад ХУУЧИН бичвэрээ хадгалж байж болно —
     * засварлагчаар нэг ч удаа нээгээгүй санал яг тийм.
     *
     * Дүрмээр гаргах нь хоёуланг нэг мөсөн шийдэж, «Тайлбар» цэсний
     * асаалт/унтраалтыг цаасан дээр ТЭР ДАРУЙ үйлчлүүлнэ (төлөв нь мөрөнд
     * БИШ, `sheet.notes`-д ТҮЛХҮҮРЭЭР хадгалагддаг тул хуучин хуудсыг мөр
     * оруулж эвдэх шаардлагагүй). PM-ийн ӨӨРИЙН мөрүүд хэвээр дагана. */
    bdNotes: derive('bd', bdNotes),
    materialNotes: derive('material', materialNotes),
    totalInWords,
    /* ⚠️ ХУУДСАНААС ХУУЛАХГҮЙ — `bdNotes`-тай ЯГ ИЖИЛ шалтгаанаар (дээрх
     * тайлбарыг үз): хуучин саналын мөр нь `syncNotes` ажиллаж амжаагүй байхад
     * ХУУЧИН, зөрчилтэй өгүүлбэрээ хадгалж байдаг. Дүрмээр гаргавал цаас нь
     * баримтын бодит хамрах хүрээг ҮРГЭЛЖ зөв хэлнэ. */
    contractNote: contractNoteText(sheet, lang, ctx),
  };
}
