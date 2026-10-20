/**
 * СОНГОМОЛ БАГАНЫ БҮЛЭГ — тухайн саналд харуулах / нуух.
 *
 * ── Ямар асуудлыг шийдэж байна вэ? ─────────────────────────────────────────
 * «Хяналтын төсөв» загварт «Өндөр /м/» ба «Өндрийн итгэлцүүр» хоёр багана
 * ҮРГЭЛЖ гардаг. Гэтэл өндрийн нэмэгдэл хамаарахгүй барилгад PM тэдгээрийг
 * хоосон орхидог бөгөөд итгэлцүүр нь 1.00 гэж зогсдог — өөрөөр хэлбэл
 * захиалагч руу явах баримт дээр ХОЁР багана зөвхөн чимэг болж, 18 багана
 * аль хэдийн шахуу A4-аас зай иддэг (хэрэглэгчийн шийдвэр 2026-08-19).
 *
 * ── Зарчим: УСТГАХГҮЙ, НУУНА ───────────────────────────────────────────────
 * ⚠️⚠️ Энэ нь «Нэмэгдэл» (`lib/addons.ts`)-ээс ЗАРЧМЫН ХУВЬД ӨӨР. Тэнд
 * унтраах = `deleteCols` = багана БОДИТООР устана, учир нь нэмэгдэл багана нь
 * НИЙТ ДҮН-д нэмэгддэг тул унтраахад үнэ БУУРАХ ЁСТОЙ.
 *
 * Өндөр бол эсрэгээрээ: «Өндрийн итгэлцүүр» нүд нь «Өндөр /м/» нүдийг УНШДАГ
 * (`IF(h>4.5; 1+(h−4.5)*0.05; 1)`), «Нэгж үнэ» нь итгэлцүүрийг уншдаг.
 * Багануудыг устгавал тэр гинж тасарч `#ХАСАГДСАН!` болж БҮХ ҮНЭ эвдэрнэ.
 * Тиймээс энд зөвхөн ХАРАГДАЦЫГ хаана — томьёо бүрэн ажилласаар, дүн
 * ЯГ ХЭВЭЭРЭЭ үлдэнэ. Нуусан ч өндөр бичсэн байсан бол итгэлцүүр нь үнэд
 * үйлчилсээр байна (энэ нь ЗӨВ: тоо нь хүчинтэй, зөвхөн харуулахгүй байна).
 *
 * ── Багануудыг ЯАЖ олох вэ? ТОЛГОЙН ТЕКСТЭЭР, индексээр БИШ ────────────────
 * ⚠️ Индекс хадгалах нь эвдэрнэ: «Нэмэгдэл» цэс `insertCols`/`deleteCols`
 * дуудахад баганы дугаарууд ШИЛЖИНЭ, хадгалсан индекс тэр даруй өөр багана
 * заана. Толгойн текст нь харин шилжихгүй. Энэ арга нь `lib/currency.ts`-ийн
 * «/төг/» толгой скан хийдэг жишигтэй ижил.
 *
 * ⚠️ Хадгалалт нь мөн ТҮЛХҮҮРЭЭР (`SheetDoc.hiddenGroups: string[]`), индексээр
 * БИШ — тиймээс нэмэгдэл асаах/унтраах нь нуулгыг хэзээ ч гуйвуулахгүй.
 *
 * ── Хаана үйлчилдэг вэ? ────────────────────────────────────────────────────
 * Нэг эх сурвалж, дөрвөн гаралт:
 *   • Вэб дэх засварлагч — `QuoteEditorPage` → `SheetGrid.hiddenCols`,
 *   • Хэвлэх хуудас + сервер PDF — `printStyles.printHiddenCols` (нэг хуудас),
 *   • Excel — `lib/exportQuoteXlsx.ts` (баганыг `hidden` болгоно).
 */
import type { QuoteLang, SheetDoc } from '../types/quotes';
import { refToCoord } from './formula/refs';

/** Нэг сонгомол бүлэг — хамтдаа асч, хамтдаа унтардаг багануудын багц. */
export interface OptionalColGroup {
  /** Тогтвортой түлхүүр — `SheetDoc.hiddenGroups`-д ЭНЭ хадгалагдана. */
  key: string;
  label: string;
  /** Англи баримтад — `AddonItem.labelEn`-тэй ижил гэрээ. */
  labelEn?: string;
  /**
   * Бүлэгт хамаарах баганыг таних ТОЛГОЙН текстүүд (яг таарах, trim-лэсэн).
   *
   * ⚠️ Монгол БА англи хувилбар ХОЁУЛАА байх ёстой — англи санал
   * (`quotes.lang === 'en'`) нь `backend/src/lib/quoteTranslate.ts`-ээр
   * орчуулагдсан толгойтой ТУСДАА мөр болж хадгалагддаг. Толь тэнд
   * өөрчлөгдвөл энд ЗЭРЭГ өөрчил, эс бөгөөс англи саналд нуулга ажиллахаа
   * болино (баримт эвдрэхгүй — зүгээр л багана харагдсаар байна).
   */
  headers: readonly string[];
}

/**
 * Одоогоор ганц бүлэг. Шинээр нэмэхэд ЗӨВХӨН энд мөр нэмнэ — цэс, хэвлэх,
 * Excel, засварлагч бүгд өөрөө дагана.
 *
 * ⚠️ `headers` дахь монгол мөрүүд нь `backend/scripts/gen-control-budget-
 * template.mjs`-ийн `rowHead`/`subHead`-аас БАЙТААРАА хуулагдсан; англи нь
 * `quoteTranslate.ts` `QUOTE_MN_EN_DICT`-ийн УТГУУД.
 */
export const OPTIONAL_COL_GROUPS: readonly OptionalColGroup[] = [
  {
    key: 'height',
    label: 'Өндөр',
    labelEn: 'Height',
    headers: ['Өндөр /м/', 'Өндрийн итгэлцүүр', 'Height /m/', 'Height coefficient'],
  },
];

/** Хэлээс хамаарсан шошго — `lib/addons.ts`-ийн `itemLabel`-тэй ижил гэрээ. */
export function groupLabel(group: OptionalColGroup, lang: QuoteLang = 'mn'): string {
  return lang === 'en' ? (group.labelEn ?? group.label) : group.label;
}

/**
 * Бүлэгт хамаарах баганы индексүүд — толгойн текстээр сканддана.
 *
 * Хуудсанд тухайн толгой огт байхгүй бол хоосон массив (жишээ нь үндсэн
 * 13-баганат загварт «Өндөр» гэж байхгүй) — дуудагч тэр үед бүлгийг цэсэнд
 * огт харуулахгүй.
 */
export function groupCols(sheet: SheetDoc, group: OptionalColGroup): number[] {
  const want = new Set(group.headers.map((h) => h.trim()));
  const cols = new Set<number>();
  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    if (!cell || typeof cell.v !== 'string') continue;
    if (!want.has(cell.v.trim())) continue;
    const co = refToCoord(ref);
    if (co && co.c >= 0 && co.c < sheet.cols) cols.add(co.c);
  }
  return [...cols].sort((a, b) => a - b);
}

/** Хуудсанд энэ бүлэг ХАМААРАЛТАЙ юу (толгой нь олдож байна уу). */
export function groupApplies(sheet: SheetDoc, group: OptionalColGroup): boolean {
  return groupCols(sheet, group).length > 0;
}

/** Бүлэг ХАРАГДАЖ байна уу. Анхдагч нь ҮРГЭЛЖ харагдана (хуучин саналууд). */
export function isGroupVisible(sheet: SheetDoc, key: string): boolean {
  return !sheet.hiddenGroups?.includes(key);
}

/**
 * НУУГДСАН бүх бүлгийн баганын нэгдэл.
 *
 * Хэвлэх, Excel, засварлагч гурвуулаа ЭНЭ функцээс уншина — гурван газар
 * тусад нь бодвол зөрөх нь гарцаагүй.
 */
export function hiddenGroupCols(sheet: SheetDoc): Set<number> {
  const out = new Set<number>();
  const hidden = sheet.hiddenGroups;
  if (!hidden || hidden.length === 0) return out;
  for (const group of OPTIONAL_COL_GROUPS) {
    if (!hidden.includes(group.key)) continue;
    for (const c of groupCols(sheet, group)) out.add(c);
  }
  return out;
}

/**
 * Бүлгийг асаах / унтраах. Нүд, томьёо, дүн ОГТ хөндөгдөхгүй — зөвхөн
 * `hiddenGroups` жагсаалт өөрчлөгдөнө.
 */
export function toggleGroup(sheet: SheetDoc, key: string): SheetDoc {
  const cur = sheet.hiddenGroups ?? [];
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  // Хоосон бол талбарыг огт бичихгүй — хуучин баримттай яг ижил sheet_json.
  if (next.length === 0) {
    const { hiddenGroups: _drop, ...rest } = sheet;
    return rest as SheetDoc;
  }
  return { ...sheet, hiddenGroups: next };
}
