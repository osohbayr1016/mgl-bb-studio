/**
 * ХЭСЭГЧИЛСЭН САНАЛ — «зөвхөн эскиз зураг хийлгэвэл хэд болох вэ?»
 *
 * ── Ямар асуудлыг шийдэж байна вэ? ─────────────────────────────────────────
 * Бэлэн болсон саналыг захиалагч уншаад «бид зөвхөн эскиз зургийг нь хийлгэе,
 * тэгвэл үнэ хэд болох вэ?» гэж асуудаг. Өнөөг хүртэл PM үүнд хариулахын тулд
 * ДҮН-гийн томьёог ГАРААР задалж, хамаарахгүй мөрүүдийг устгаж, менежмент ба
 * НӨАТ-ыг дахин холбодог байв — олон алхамтай, алдаа гаргамаар ажил (хэрэглэгч
 * 2026-08-19-нд гомдоллосон).
 *
 * Энэ модуль тэр ажлыг ЦЭВЭР хувиргалт болгоно: хамрах хүрээг сонгоход
 * шаардлагагүй зардлын мөрүүд ДҮН-гээс хасагдаж, менежмент/НӨАТ/НИЙТ ДҮН нь
 * ДҮН рүү заасан ТОМЬЁО хэвээрээ тул ӨӨРСДӨӨ дахин бодогдоно. Өөрөөр хэлбэл
 * «хувиуд нь нэмэгдэж, НӨАТ нь бодогдсон эцсийн үнэ» гарч ирнэ.
 *
 * ── Зарчим: МӨРИЙГ л хасна, ТООЦООЛОХГҮЙ ───────────────────────────────────
 * Дүнг ХЭЗЭЭ Ч литерал болгож хөлдөөхгүй — баримт бүрэн амьд томьёотой хэвээр
 * үлдэнэ (тиймээс шинэ баримт дээр тоо хэмжээ/төвөгшлөө засахад бүх зүйл дагаж
 * шинэчлэгдэнэ). Бүтцийн үйлдлүүд нь `removeCostLine` (`lib/addons.ts`) —
 * тэр нь ДҮН-гийн томьёоноос гишүүнийг эхлээд хасаад дараа нь мөрийг устгадаг
 * тул `#ХАСАГДСАН!` үүсэхгүй, `shiftAddonSpec` бүх spec-ийг дагуулна.
 *
 * ⚠️ АЖЛЫН ЗУРГИЙН ХҮСНЭГТ ХЭВЭЭР ҮЛДЭНЭ (эскиз зөвхөн үлдсэн ч). Учир нь
 * эскизийн үнэ нь ТЭР хүснэгтээс гардаг (`=АЗ*15%`) — барилгын мөрүүдийг
 * устгавал суурь нь алга болж эскизийн үнэ 0 болно. Оронд нь «Ажлын зургийн
 * үнэ» мөрийг ДҮН-гийн томьёоноос хасаад шошгыг нь «/тооцооны суурь/» гэж
 * тэмдэглэнэ — захиалагч тэр тоог төлбөр гэж эндүүрэхгүй.
 *
 * ⚠️ ANCHOR-ЫГ ГАРААР ДАГУУЛНА. Засварлагч нь `normalizeWorkbook` дуудахгүй тул
 * `sheet.anchors` нь ХООСОН — иймд `deleteRows`-ийн anchor шилжүүлэлт энд
 * ажиллах юмгүй бөгөөд `wb.anchors` хуучин мөрөн дээрээ хөлдөнө. НИЙТ ДҮН нь
 * устгасан мөрийн тоогоор ДЭЭШ гулсдаг тул үүнийг заавал засах ёстой: бүтцийн
 * эх сурвалж (`addons.lines.totalRef` / `addons.costLines.sumRef`) нь
 * `shiftAddonSpec`-аар зөв шилжсэн байдаг тул тэднээс дахин бичнэ
 * (`resolveTotal.ts`-ийн 2-р шатлалтай ижил зарчим).
 */
import { removeCostLine } from './addons';
import { syncNotes } from './quoteNotes';
import { refToCoord } from './formula/refs';
import { getCell, setCells } from './sheetOps';
import { clearWorkbookAnchor, setWorkbookAnchor } from './workbook';
import type { NamedSheet, QuoteLang, SheetDoc, WorkbookDoc } from '../types/quotes';

/**
 * «Ажлын зураг» гэсэн зохиомол хамрах хүрээний түлхүүр.
 *
 * ⚠️ Зардлын мөрийн түлхүүрүүдтэй (`sketch`, `geology`, …) НЭГ орон зайд амьдарна
 * — `STANDARD_COST_LINES`-д ийм түлхүүр байхгүй тул мөргөлдөхгүй. Шинэ стандарт
 * зардлын мөр нэмэхдээ `az` гэж бүү нэрлэ.
 */
export const AZ_SCOPE_KEY = 'az';

/** Хамрах хүрээний нэг сонголт (checkbox-ийн мөр). */
export interface ScopeItem {
  key: string;
  /** Баримт дээр бичигдсэн шошго — `label` нь PM-ийн засварыг ч тусгана. */
  label: string;
  /** `az` = ажлын зургийн хүснэгтийн нийлбэр, `cost` = ДҮН-гийн зардлын мөр. */
  kind: 'az' | 'cost';
}

export interface ScopeInfo {
  /** Хамрах хүрээг агуулж буй хуудасны `id`. */
  sheetId: string;
  items: ScopeItem[];
}

/** ДҮН-гийн зардлын мөрүүдийг агуулсан хуудасны индекс (олдоогүй бол -1). */
function scopeSheetIndex(wb: WorkbookDoc): number {
  return wb.sheets.findIndex((s) => !!s.addons?.costLines);
}

/**
 * Хамрах хүрээ хумих БОЛОМЖТОЙ дэвтэр үү (товч харагдах эсэх).
 *
 * ⚠️ Энэ нөхцөлийг дуудагч тал ДАВТАЖ БИЧИХГҮЙ — «costLines байна уу» гэдэг
 * шалгуур энэ файлын мэдлэг, тархвал зөрөх эрсдэлтэй.
 */
export function hasScope(wb: WorkbookDoc): boolean {
  return scopeSheetIndex(wb) >= 0;
}

/**
 * «Ажлын зургийн үнэ» мөрийн шошго — баримт дээр бичигдсэн бичвэрээр.
 * (Загварт `A9` = «Ажлын зургийн үнэ», гэхдээ PM өөрчилсөн байж болно.)
 */
function azLabel(sheet: SheetDoc, baseRef: string, fallback: string): string {
  const co = refToCoord(baseRef);
  if (!co) return fallback;
  const v = getCell(sheet, co.r, 0)?.v;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
}

/**
 * Дэвтэрээс хамрах хүрээний жагсаалтыг уншина. `costLines` тодорхойлогдоогүй
 * (гараар барьсан эсвэл хоосон) дэвтэрт `null` — дуудагч тал товчийг нуух ёстой.
 */
export function readScope(wb: WorkbookDoc, azFallbackLabel = 'Ажлын зураг'): ScopeInfo | null {
  const idx = scopeSheetIndex(wb);
  if (idx < 0) return null;
  const sheet = wb.sheets[idx]!;
  const cl = sheet.addons!.costLines!;

  /* ⚠️⚠️ БҮТЦИЙН ШАЛГУУР — 2026-08-19-нд аудитаар нэмэгдсэн. БҮҮ ХАС.
   *
   * `applyScope` нь `removeCostLine`-ийг дуудах ба тэр нь устгах мөрөө
   * АРИФМЕТИКЭЭР олдог (`addons.ts`: `lineRowOf = sumRow − items.length + idx`).
   * Энэ тооцоо нь «зардлын мөрүүд ДҮН-гийн ЯГ дээр, ЗАВСАРГҮЙ дараалан сууна»
   * гэсэн ЧАНД таамаг дээр тогтоно.
   *
   * PM тэр мужид ГАРААР мөр нэмсэн бол индекс гуйваад БУРУУ МӨР УСТАНА —
   * гарах тоо нь бүрэн үнэмшилтэй харагдана, ямар ч алдааны тэмдэг гарахгүй.
   * Захиалагч руу явах баримтад энэ бол хамгийн аюултай төрлийн эвдрэл.
   *
   * Тиймээс блокийн БҮТЦИЙГ урьдчилан шалгана: ДҮН-гийн мөр ба суурь мөрийн
   * хооронд ЯГ `items.length` мөр байх ёстой. Таарахгүй бол `null` буцааж
   * товчийг БҮРЭН НУУНА — буруу үнэ гаргахаас боломжийг нь хаасан нь дээр. */
  const sumR = refToCoord(cl.sumRef)?.r;
  const baseR = refToCoord(cl.baseRef)?.r;
  if (sumR === undefined || baseR === undefined) return null;
  if (sumR - baseR - 1 !== cl.items.length) return null;

  const items: ScopeItem[] = [
    { key: AZ_SCOPE_KEY, label: azLabel(sheet, cl.baseRef, azFallbackLabel), kind: 'az' },
    ...cl.items.map((x) => ({ key: x.key, label: x.label, kind: 'cost' as const })),
  ];
  return { sheetId: sheet.id, items };
}

/**
 * Шошгоос тайлбарын хаалтыг авна: «Эскиз зургийн үнэ /АЗ*15%/» → «Эскиз зургийн
 * үнэ». Гарчиг угсрахад л хэрэглэнэ — нүдний бичвэрийг ХӨНДӨХГҮЙ.
 */
export function shortScopeLabel(label: string): string {
  return label.replace(/\s*\/[^/]*\/\s*$/, '').trim() || label;
}

/**
 * Нийлбэрийн томьёоноос НЭГ гишүүнийг хасна: `=Z9+Z10+Z11` − `Z10` → `=Z9+Z11`.
 *
 * Гурван байрлалыг тусад нь барина (`removeCostLine`-ийн regex нь зөвхөн
 * ДУНД/СҮҮЛийнхийг мэддэг — «Ажлын зургийн үнэ» нь ҮРГЭЛЖ ЭХНИЙ гишүүн):
 *   • `+REF`  — дунд/сүүл;
 *   • `=REF+` — эхний гишүүн;
 *   • `=REF`  — ганц гишүүн → `=0` (хоосон `=` нь `#ТОМЬЁО!` болно).
 * Олдохгүй бол томьёог ХӨНДӨХГҮЙ — PM гараар өөр бүтэц бичсэн байж болно.
 */
export function dropSumTerm(formula: string, ref: string): string {
  const R = ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // ⚠️ `(?![0-9A-Za-z])` — `Z9` нь `Z90`-тэй таарахаас сэргийлнэ.
  const mid = new RegExp(`\\+\\s*${R}(?![0-9A-Za-z])`);
  if (mid.test(formula)) return formula.replace(mid, '');
  const head = new RegExp(`^=\\s*${R}(?![0-9A-Za-z])\\s*\\+`);
  if (head.test(formula)) return formula.replace(head, '=');
  const only = new RegExp(`^=\\s*${R}(?![0-9A-Za-z])\\s*$`);
  if (only.test(formula)) return '=0';
  return formula;
}

/** «/тооцооны суурь/» тэмдэглэгээ — баримтын хэлээр. */
const BASIS_SUFFIX: Record<QuoteLang, string> = {
  mn: '/тооцооны суурь/',
  en: '/calculation basis/',
};

/**
 * «Ажлын зургийн үнэ» мөрийг ДҮН-гээс хасаад шошгыг нь тэмдэглэнэ.
 *
 * ⚠️ Тэмдэглэгээгүй бол баримт ГАЖ уншигдана: хүснэгтийн доор «Ажлын зургийн
 * үнэ ₮9,435,000,000» гэж зогсоод ДҮН нь ₮1,415,250,000 гэж гарна — захиалагч
 * алдаа гэж бодно. Тэмдэглэгээ нь тэр тоо ЯАГААД дүнд ороогүйг тайлбарлана.
 */
function excludeAz(sheet: SheetDoc, lang: QuoteLang): SheetDoc {
  const cl = sheet.addons?.costLines;
  if (!cl) return sheet;
  const sumCo = refToCoord(cl.sumRef);
  const azCo = refToCoord(cl.baseRef);
  if (!sumCo || !azCo) return sheet;

  let next = sheet;
  const sumCell = getCell(sheet, sumCo.r, sumCo.c);
  if (sumCell?.f) {
    const f = dropSumTerm(sumCell.f, cl.baseRef);
    if (f !== sumCell.f) {
      next = setCells(next, [{ r: sumCo.r, c: sumCo.c, cell: { ...sumCell, f } }]);
    }
  }

  // Шошго — зөвхөн ЛИТЕРАЛ бичвэртэй нүдэнд, нэг л удаа (идемпотент).
  const labelCell = getCell(next, azCo.r, 0);
  const text = typeof labelCell?.v === 'string' ? labelCell.v.trim() : '';
  const suffix = BASIS_SUFFIX[lang];
  if (text === '' || text.includes(suffix)) return next;
  return setCells(next, [{ r: azCo.r, c: 0, cell: { ...labelCell, v: `${text} ${suffix}` } }]);
}

/**
 * Anchor-уудыг БҮТЦИЙН эх сурвалжаас дахин бичнэ (модулийн толгойн тайлбарыг үз).
 *
 * ⚠️ Бүтцийн хаяг нь БАЙХГҮЙ бол хуучныг нь ХАЯНА, үлдээхгүй. Мөр устсаны дараа
 * тэр anchor нь бодит НИЙТ ДҮН-гээс доогуур нүд рүү заана — өнөөдөр тэр нүднүүд
 * тоо БИШ (тайлбар/гарын үсэг) тул `resolveTotal` шошгын шатлал руу унаж зөв
 * хариу өгдөг, гэхдээ тэр нь АЗ. Хаясан үед шийдэгч ҮРГЭЛЖ 2/3-р шатлалаараа
 * явна — санамсаргүй тоон нүдэн дээр буух цонх байхгүй. (0131-ээс хойшхи бүх
 * загварт `lines` байгаа тул энэ салаа нь гараар барьсан хуудсанд л хамаатай.)
 */
function syncAnchors(wb: WorkbookDoc, sheet: NamedSheet): WorkbookDoc {
  let out = wb;
  // Хөнгөлөлт идэвхтэй бол баримтын дүн нь ХАСАГДСАНЫ ДАРААХ мөр
  // (`resolveTotal.addonRefOf`-той ижил эрэмбэ).
  const totalRef = sheet.addons?.lines?.finalRef ?? sheet.addons?.lines?.totalRef;
  out = totalRef
    ? setWorkbookAnchor(out, 'total', sheet.id, totalRef)
    : clearWorkbookAnchor(out, 'total');
  const subtotalRef = sheet.addons?.costLines?.sumRef;
  out = subtotalRef
    ? setWorkbookAnchor(out, 'subtotal', sheet.id, subtotalRef)
    : clearWorkbookAnchor(out, 'subtotal');
  return out;
}

/**
 * Дэвтрийг сонгосон хамрах хүрээгээр ХУМИНА (цэвэр — эх дэвтрийг хөндөхгүй).
 *
 * `keys` нь `readScope`-ийн буцаасан түлхүүрүүдийн ДЭД ОЛОНЛОГ. Сонгогдоогүй
 * зардлын мөр бүр ДҮН-гийн томьёотойгоо хамт арилна; `az` сонгогдоогүй бол
 * ажлын зургийн нийлбэр ДҮН-гээс хасагдана. Менежмент, НӨАТ, НИЙТ ДҮН,
 * хөнгөлөлт бүгд ДҮН рүү заасан томьёо тул ӨӨРСДӨӨ дагана.
 */
export function applyScope(
  wb: WorkbookDoc,
  keys: readonly string[],
  lang: QuoteLang = 'mn',
): WorkbookDoc {
  const idx = scopeSheetIndex(wb);
  if (idx < 0) return wb;
  const src = wb.sheets[idx]!;
  const keep = new Set(keys);

  let sheet: SheetDoc = src;
  // ⚠️ Эх spec-ийн жагсаалтаар давтана — `removeCostLine` бүрд spec шинэчлэгдэх
  // тул давталтын дундуур `sheet.addons`-ыг уншвал индекс гулсана.
  for (const item of src.addons!.costLines!.items) {
    if (!keep.has(item.key)) sheet = removeCostLine(sheet, item.key);
  }
  if (!keep.has(AZ_SCOPE_KEY)) sheet = excludeAz(sheet, lang);

  /* Баримтын доод ТАЙЛБАРЫГ дагуулна (`lib/quoteNotes.ts`).
   *
   * ⚠️ Хэсэгчилсэн санал дээр ЭНЭ АЛХАМ ЗААВАЛ хэрэгтэй: зөвхөн эскиз зургийн
   * үнэ үлдээсэн саналаас геологи/топографийн ЗАРДЛЫН МӨР хасагдсан атал
   * «БД 81-117-13-ийг үндэслэн инженер геологийн ажлын үнийг тооцов» гэсэн
   * өгүүлбэр үлдвэл захиалагч төлөхгүй ажлаа төлбөрт багтсан мэт уншина. */
  sheet = syncNotes(sheet, lang);

  if (sheet === src) return wb; // юу ч хасагдаагүй — өөрчлөлтгүй

  const named: NamedSheet = { ...sheet, id: src.id, name: src.name };
  const out: WorkbookDoc = {
    ...wb,
    sheets: wb.sheets.map((s, i) => (i === idx ? named : s)),
  };
  return syncAnchors(out, named);
}

/**
 * Хамрах хүрээ → саналын ТӨРӨЛ (`variant_key`).
 *
 * Каталогт (`lib/quoteVariants.ts`) зөвхөн хоёр нь тусгагдана: ажлын зураг ба
 * эскиз. Бусад зардлын мөр (геологи, топографи, экспертиз…) нь ажлын ТӨРӨЛ биш,
 * дагалдах зардал тул төрөл үүсгэхгүй. Юу ч таарахгүй бол хоосон буцаана —
 * сервер эх саналынхыг өвлүүлнэ.
 */
export function scopeVariantKeys(keys: readonly string[]): string[] {
  const out: string[] = [];
  if (keys.includes(AZ_SCOPE_KEY)) out.push('design');
  if (keys.includes('sketch')) out.push('sketch');
  return out;
}

/** Гарчгийн дагавар: «ХОТХОН…» → «ХОТХОН… — Эскиз зургийн үнэ». */
export function scopeTitle(baseTitle: string, labels: readonly string[]): string {
  const base = baseTitle.trim();
  const suffix = labels.map(shortScopeLabel).filter(Boolean).join(', ');
  if (suffix === '') return base;
  return base === '' ? suffix : `${base} — ${suffix}`;
}
