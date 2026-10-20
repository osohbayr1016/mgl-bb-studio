/**
 * ВАЛЮТЫН БАГАНУУД — «₮» тэмдэг аль нүдэнд гарахыг тодорхойлно.
 *
 * ⚠️ Яагаад `NumFmt`-д «₮#,##0» гэсэн шинэ формат НЭМЭЭГҮЙ вэ: үнийн санал бүр
 * өөрийн `sheet_json` хуулбартай (загвар нь зөвхөн ҮҮСГЭХ мөчид хуулагдана).
 * Шинэ формат нэмбэл зөвхөн ЦААШИД үүсэх санал ₮-тэй болж, аль хэдийн үүссэн
 * бүх баримт хуучин хэвээр үлдэнэ — өөрөөр хэлбэл ижил компанийн хоёр санал
 * өөр өөр харагдана. Тиймээс валютыг ХУУДАСНЫ БҮТЦЭЭС гаргаж авна: тэгвэл
 * хуучин, шинэ, гараар засварласан бүх баримт НЭГ ижил дүрмээр ₮ авна.
 *
 * Хоёр эх сурвалж (аль нэг нь таарвал багана валют болно):
 *   1. `AddonSpec` — ЗТАҮ (`baseCol`), нэмэгдлүүд, тэдгээрийн дүн, АЗ-ийн
 *      хэсгүүд, НИЙТ ҮНЭ, зардлын мөрийн НЭГЖ ҮНЭ. Энэ бол БАТТАЙ мэдээлэл:
 *      багана асаах/унтраахад spec өөрөө шилждэг тул хаяг хэзээ ч хоцрохгүй.
 *   2. Толгойн бичвэр — «/төг/» эсвэл «₮» агуулсан баганы толгой. Загварын
 *      «Жишиг үнэ /төг/», «м² үнэ /төг/» мэт spec-ийн эзэмшдэггүй баганыг
 *      барина.
 *
 * Мөн ХАСАЛТ: `costLines.qtyCol` (тоо хэмжээ) нь `#,##0` форматтай атлаа
 * мөнгө БИШ — spec түүнийг нэрээр нь мэддэг тул илэрхий хасна.
 *
 * ⚠️ Багана валют байх нь ХАНГАЛТТАЙ нөхцөл БИШ: `formatValue` нь зөвхөн
 * МӨНГӨН формат (`#,##0`, `#,##0.00`) дээр ₮ тавина. Ингэснээр хувийн нүд
 * («ХӨНГӨЛӨЛТ»-ийн `-10`, форматгүй тоо) валютын баганад таарсан ч ₮ авахгүй.
 */
import { addonTotalCol, sectionCols, sectionTotalCol } from './addons';
import { refToCoord } from './formula/refs';
import type { NumFmt, SheetDoc } from '../types/quotes';
import { brand } from '@/shared/config/brand';

/** Regex-д аюулгүй болгох. */
function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Толгойд мөнгийг заасан тэмдэглэгээ. «төвөгшил» нь «төг»-тэй таарахгүй.
 * Англи хэлт саналын толгой «Base rate /MNT/» хэлбэртэй тул валютын КОД мөн
 * орно.
 *
 * Урьд нь `/₮|төг|MNT/i` гэж шууд бичигдсэн байсан тул валют нь төгрөгт
 * цоожтой байв.  Одоо тохируулсан тэмдэг + код-оос үүснэ.  «төг» нь МОНГОЛ
 * товчлол тул хэвээр үлдэв — MGL-ийн өмнө үүсгэсэн үнийн саналууд
 * `sheet_json`-доо тэр толгойгоо агуулж байгаа бөгөөд тэдгээр үргэлжлүүлэн
 * зөв уншигдах ёстой.
 */
function moneyHeaderRe(): RegExp {
  const { currencySymbol, currencyCode } = brand();
  const parts = [currencySymbol, 'төг', currencyCode]
    .filter((p) => typeof p === 'string' && p.trim().length > 0)
    .map((p) => escapeRe(p.trim()));
  return new RegExp(parts.join('|'), 'i');
}

/** Мөнгө ИЛЭРХИЙЛЖ чадах форматууд — хувь ба текст энд ОРОХГҮЙ. */
export function isMoneyFmt(fmt: NumFmt | undefined): boolean {
  return fmt === '#,##0' || fmt === '#,##0.00';
}

/**
 * Хуудасны валютын баганууд. Дэлгэц ба цаас ХОЁУЛАА үүнийг дуудна
 * (`SheetGrid`) — тиймээс засварлагч дээр харагдсан ₮ хэвлэмэлд ч гарна.
 */
export function currencyCols(sheet: SheetDoc): ReadonlySet<number> {
  const out = new Set<number>();
  const spec = sheet.addons;

  if (spec) {
    out.add(spec.baseCol);
    spec.items.forEach((_, i) => out.add(spec.baseCol + 1 + i));
    out.add(addonTotalCol(spec));
    if (spec.sections) {
      for (const c of sectionCols(sheet)) out.add(c);
      out.add(sectionTotalCol(spec.sections));
    }
    if (spec.costLines) out.add(spec.costLines.priceCol);
  }

  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    if (cell?.s?.bg !== 'header') continue;
    const label = cell.v;
    if (typeof label !== 'string' || !moneyHeaderRe().test(label)) continue;
    const co = refToCoord(ref);
    if (co) out.add(co.c);
  }

  // Тоо хэмжээ (м², га, цооног) ХЭЗЭЭ Ч валют биш.
  if (spec?.costLines) out.delete(spec.costLines.qtyCol);

  return out;
}
