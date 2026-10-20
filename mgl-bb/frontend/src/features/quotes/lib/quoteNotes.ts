/**
 * БАРИМТЫН ДООД ТАЙЛБАР — «Тайлбар:» ба «Ашигласан материал:» блокуудыг
 * ХУУДАСНЫ БОДИТ АГУУЛГААС нь ГАРГАЖ бичих.
 *
 * ── Ямар асуудлыг шийдэж байна вэ? ─────────────────────────────────────────
 * Загварт (`backend/scripts/gen-control-budget-template.mjs`) энэ хоёр блокийн
 * БҮХ өгүүлбэр ХАТУУ бичигдсэн байв. Тиймээс санал бүр дээр:
 *
 *   • «…4.19-ийг үндэслэн … "BMS" системийн 6%, ТӨСВИЙН 8% нэмж тооцов.» гэж
 *     бичигдсээр байхад PM «Төсөв /ЗТАҮ*8%/» нэмэгдлийг УНТРААСАН байж болно;
 *   • «…3.5.1-ийг үндэслэн 80га талбайн ерөнхий төлөвлөгөө…», «…инженер
 *     геологийн…», «…Тopography М1:500…» гэсэн гурван өгүүлбэр нь тэдгээр
 *     ажил ҮНЭД ОРООГҮЙ саналууд дээр ч гарсаар байв;
 *   • «Ашигласан материал:» жагсаалт нь мөн БД 81-117-13 (геологи) ба
 *     БД 81-103-21 (геодези)-ийг ҮРГЭЛЖ дурддаг байв.
 *
 * Өөрөөр хэлбэл баримт нь өөрийнхөө тоонуудтай ЗӨРЧИЛДӨЖ, захиалагчид
 * ХУДАЛ мэдээлэл өгч байсан (хэрэглэгчийн илрүүлэлт 2026-08-24).
 *
 * ── Зарчим 1: «АСААЛТТАЙ» БИШ, «ҮНЭД ОРСОН» гэдгээр шийднэ ────────────────
 * ⚠️ Хамгийн амархан алдаа: «зардлын мөр spec-д байна» ≠ «тэр ажлыг үнэлсэн».
 * ШИНЭ санал бүр geology/topography/masterplan/landscape мөрүүдийг ХООСОН тоо
 * хэмжээтэй агуулж үүсдэг (`gen-control-budget-template.mjs` тэдгээрийг
 * `v: ''` гэж бичдэг). Тиймээс зөвхөн spec-ийн гишүүнчлэлээр шийдвэл шинэ
 * санал бүр «80га талбайн ерөнхий төлөвлөгөө … тооцов» гэж ₮0 дүнгээр
 * баталгаажуулна — өнөөдрийнхөөс ч дор, учир нь одоо энэ нь ЗОРИУДЫН мэт
 * харагдана. `noteCtx` нь тоо хэмжээ / дүн БИЧИГДСЭН эсэхийг шалгаж, зөвхөн
 * ҮНЭД ОРСОН мөрүүдийг `costKeys`-д хийнэ (нэмэгдэл багана мөн адил:
 * `addonIsUsed` нь бүх мөр нь цэвэрлэгдсэн баганыг тооцохгүй).
 *
 * ── Зарчим 2: ТӨЛӨВ нь ТҮЛХҮҮРЭЭР хадгалагдана, БАЙРЛАЛААР БИШ ────────────
 * `lib/optionalCols.ts`-тэй ижил гэрээ: `SheetDoc.notes` нь зөвхөн ТҮЛХҮҮР
 * хадгална (`on`/`off`/`text`), мөрийн индекс ХЭЗЭЭ Ч биш. Учир нь «Нэмэгдэл»
 * цэс `insertRows`/`deleteRows` дуудахад мөрийн дугаарууд шилждэг ба хадгалсан
 * индекс тэр даруй өөр мөр заана.
 *
 * ⚠️ Ref хадгалахаас ЗОРИУД татгалзсаны БАС НЭГ шалтгаан: `sheetOps.shiftRef`
 * нь УСТСАН мөрийн ref-ийг үхсэн гэж хэлдэггүй, `op.at` руу ЗАДЛАН буулгадаг —
 * `remapCells`/`remapAnchors` шиг хаядаггүй. Тиймээс ref-т суурилсан тайлбар нь
 * мөр устахад амьд харагдсаар ӨӨР мөрийг дарж бичих аюултай (`sections.noteRef`
 * яг ийм эрсдэлтэй байдаг).
 *
 * ── Зарчим 3: БЛОКИЙГ ХУУДСАНААС СКАНДАЖ олно ─────────────────────────────
 * Загварт нэмэлт spec талбар суулгавал ЗӨВХӨН ШИНЭ санал ажиллана — үнийн
 * санал бүр `sheet_json`-оо үүсэх үедээ snapshot авдаг (CLAUDE.md). Тиймээс
 * блокийг «Тайлбар:» / «Ашигласан материал:» ШОШГООР нь оллоо: АЛЬ ХЭДИЙН
 * үүссэн бүх санал дээр ч шууд ажиллана, загварын migration ШААРДАХГҮЙ.
 *
 * ⚠️ Шошгыг зөвхөн ЛИТЕРАЛ (`v`) нүднээс хайна, ТОМЬЁОНООС БИШ. Учир нь
 * баримтын доод хэсэгт «Тайлбар: Зураг төсөл боловсруулах ажлын нийт дүн ₮…»
 * гэж ЭХЭЛДЭГ ТОМЬЁОТОЙ мөр (USGEER) байдаг — түүнийг тайлбарын блок гэж үзвэл
 * `quoteTranslate`-ийн PREFIX/SUFFIX түлхүүрүүд эвдэрч англи баримт дээр
 * «MNT978,161,095» болно.
 *
 * ── Зарчим 4: ӨГҮҮЛБЭРИЙГ БД-ИЙН ЗААЛТЫН ДУГААРААР танина ──────────────────
 * `NoteRule.match` нь БД-ийн заалтын дугаарыг (4.19, 3.5.1, 81-117-13 …)
 * барина, ӨГҮҮЛБЭРИЙН БҮТЭН БИЧВЭРИЙГ БИШ. Учир нь (а) бичвэр нь одоо
 * динамикаар үүсэх тул тогтмол биш, (б) PM гараар засаж болно, (в) англи
 * хуулбар дээр өгүүлбэр орчуулагдсан ч заалтын дугаар нь хэвээр үлдэнэ,
 * (г) «Тopography М1;500» ↔ «М1:500» гэсэн хоёр бичлэг амьд саналууд дээр
 * зэрэг оршдог (migration 0186).
 * Ямар ч дүрэмд таараагүй мөрийг ХЭРЭГЛЭГЧИЙНХ гэж үзэж ХЭВЭЭР үлдээнэ —
 * `lib/signatureBlock.ts`-ийн «чимээгүй бүү хая» гэсэн зарчимтай нэг.
 *
 * ── Зарчим 5: УНТРААСАН мөрийг ХОООСЛОХГҮЙ, УСТГАНА ────────────────────────
 * Хэвлэмэл нь `detectSignatureBlock`-оор хүснэгтийн доорх БҮХ мөрийг нуудаг
 * тул хоосон мөр цаасан дээр харагдахгүй. Гэвч ЗАСВАРЛАГЧ ба EXCEL
 * (`exportQuoteXlsx`) нь түүхий нүдийг уншдаг — хоосон merge-тэй зурвасууд
 * тэнд харагдана. Тиймээс мөрийг бүрэн устгаад, дахин асаахад дахин оруулна.
 * ⚠️ ШОШГЫН МӨР нь ХЭЗЭЭ Ч устахгүй: тэр уствал `detectSignatureBlock` нь
 * `mode='bd'`-г огт эхлүүлэхгүй болж, ҮЛДСЭН БҮХ тайлбар хэвлэмэлээс чимээгүй
 * алга болно (засварлагч дээр харагдсаар байхад).
 *
 * ⚠️ ОРЧУУЛГА: үүсгэсэн өгүүлбэр нь `QUOTE_MN_EN_DICT`-ийн БҮТЭН МӨРИЙН
 * түлхүүрт таарахаа болино. Тиймээс `syncNotes` нь монгол хуудсан дээр
 * бичихдээ МН→EN хосыг `sheet.notes.i18n`-д хамт хадгалдаг ба
 * `POST /api/quotes/:id/translate` тэр давхаргыг AI-ийн үр дүнгээс ДЭЭГҮҮР
 * тавьдаг (`backend/src/routes/quotes.ts`). Ингэснээр англи баримт нь
 * AI-гүйгээр ДЕТЕРМИНИСТ хэвээр үлдэнэ.
 */
import { STANDARD_ADDONS, itemLabel } from './addons';
import { coordToRef, refToCoord } from './formula/refs';
import { getCell, setCells, insertRows, deleteRows, type CellPatch } from './sheetOps';
import type {
  AddonItem,
  NoteGroup,
  NoteState,
  QuoteLang,
  SheetCell,
  SheetDoc,
} from '../types/quotes';

// Төлөвийн ТӨРӨЛ нь `types/quotes.ts`-д (`SheetDoc.notes`) — дугуй импортоос
// сэргийлэв. Энэ файл нь түүний ЛОГИК эзэн.
export type { NoteGroup, NoteState };

/* ------------------------------------------------------------------ */
/*  Контекст — өгүүлбэрүүд ЮУГ уншиж бичигдэх вэ                       */
/* ------------------------------------------------------------------ */

export interface NoteCtx {
  /** ҮНЭД ОРСОН хувийн нэмэгдлүүд — хуудсан дээрх БОДИТ хувьтайгаа. */
  addons: AddonItem[];
  /** ҮНЭД ОРСОН зардлын мөрийн түлхүүрүүд (тоо хэмжээ / дүн бичигдсэн). */
  costKeys: Set<string>;
  /** Зардлын мөрийн тоо хэмжээ + нэгж (жишээ нь `{ qty: 80, unit: 'га' }`). */
  qty: Record<string, { qty?: number; unit?: string }>;
  /** Аль нэг барилгын өндөр 4.5м-ээс ДЭЭШ бичигдсэн эсэх. */
  tallBuilding: boolean;
  /** «Ажлын зургийн үнэ» нь ДҮН-д ОРЖ байна уу (`scopeQuote` хасаагүй эсэх). */
  azPriced: boolean;
}

/** БД 81-16-20, 4.21.3 — итгэлцүүр эхэлдэг өндөр. */
const HCOEF_BASE_M = 4.5;

/** «Өндөр /м/» баганыг ТОЛГОЙН БИЧВЭРЭЭР олно (`optionalCols.groupCols`-той ижил арга). */
const HEIGHT_HEADERS = new Set(['Өндөр /м/', 'Height /m/']);

/** Зардлын мөрийн дугаар — `addons.ts`-ийн `lineRowOf`-той ижил арифметик. */
function costLineRow(sumRow: number, count: number, index: number): number {
  return sumRow - count + index;
}

/** Тоон утга (литерал нүд). Томьёо / хоосон бол `undefined`. */
function numOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (trimmed === '') return undefined;
    const n = Number(trimmed.replace(/[\s,]/g, ''));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Хуудаснаас тайлбарын контекстийг цуглуулна.
 *
 * ⚠️ Томьёо ТООЦОХГҮЙ — тоо хэмжээ, өндөр, шууд дүн БҮГД PM-ийн гараар бичсэн
 * ЛИТЕРАЛ нүд тул шууд уншиж болно (`gen-control-budget-template.mjs` тэднийг
 * `v: ''` гэж үүсгэдэг). Томьёотой байвал «мэдэхгүй» гэж үзээд ҮНЭД ОРСОН гэж
 * тооцно — PM тусгайлан томьёо бичсэн бол тэр нүд утга учиртай.
 */
export function noteCtx(sheet: SheetDoc): NoteCtx {
  const spec = sheet.addons;
  const cl = spec?.costLines;
  const costKeys = new Set<string>();
  const qty: NoteCtx['qty'] = {};

  const sumCo = cl ? refToCoord(cl.sumRef) : null;
  if (cl && sumCo) {
    const amountCol = sumCo.c;
    cl.items.forEach((item, i) => {
      const r = costLineRow(sumCo.r, cl.items.length, i);
      if (item.kind === 'qty') {
        const qCell = getCell(sheet, r, cl.qtyCol);
        const q = numOf(qCell?.v);
        const u = getCell(sheet, r, cl.unitCol)?.v;
        qty[item.key] = {
          qty: q,
          unit: typeof u === 'string' && u.trim() !== '' ? u.trim() : undefined,
        };
        // Тоо хэмжээ нь томьёо бол уншиж чадахгүй — «мэдэхгүй» = ҮНЭД ОРСОН.
        if ((q !== undefined && q > 0) || qCell?.f) costKeys.add(item.key);
      } else if (item.kind === 'flat') {
        const cell = getCell(sheet, r, amountCol);
        const n = numOf(cell?.v);
        if ((n !== undefined && n > 0) || cell?.f) costKeys.add(item.key);
      } else {
        // `percent` — суурь дүнгээс тооцогддог тул үргэлж үнэд ордог.
        costKeys.add(item.key);
      }
    });
  }

  return {
    addons: spec ? spec.items.filter((x) => addonIsUsed(sheet, x.key)) : [],
    costKeys,
    qty,
    tallBuilding: hasTallBuilding(sheet),
    azPriced: azIsPriced(sheet),
  };
}

/**
 * «Ажлын зургийн үнэ» (хүснэгтийн нийлбэр) нь ДҮН-д ОРЖ байгаа эсэх.
 *
 * `lib/scopeQuote.ts`-ийн `excludeAz` нь хэсэгчилсэн (жишээ нь зөвхөн эскиз)
 * санал үүсгэхдээ ДҮН-гийн томьёоноос `costLines.baseRef` гишүүнийг ХАСДАГ.
 * Тиймээс тэр гишүүн байгаа эсэх нь «ажлын зураг үнэд орсон уу» гэдгийн ЦОРЫН
 * ГАНЦ БҮТЦИЙН шинж — шошгын «/тооцооны суурь/» тэмдэглэгээ нь зөвхөн ХҮНД
 * зориулсан давхар дохио бөгөөд PM түүнийг засаж болно.
 *
 * ⚠️ Гишүүн хайх бичиглэл нь `scopeQuote.dropSumTerm`-ийн ИХЭР. Тэндээс
 * импортловол ДУГУЙ ХАМААРАЛ үүснэ (`scopeQuote` → `syncNotes`), тиймээс
 * зориуд давхардуулав — нэгийг нь өөрчилвөл нөгөөг нь ЗААВАЛ дага.
 */
function azIsPriced(sheet: SheetDoc): boolean {
  const cl = sheet.addons?.costLines;
  if (!cl) return true; // costLines-гүй хуудас — «мэдэхгүй» = үнэд орсон
  const sumCo = refToCoord(cl.sumRef);
  if (!sumCo) return true;
  const f = getCell(sheet, sumCo.r, sumCo.c)?.f;
  if (!f) return true; // томьёогүй (PM гараар дүн бичсэн) — мэдэхгүй
  const R = cl.baseRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `(?![0-9A-Za-z])` — `Z9` нь `Z90`-тэй таарахаас сэргийлнэ.
  return new RegExp(`(^=|\\+)\\s*${R}(?![0-9A-Za-z])`).test(f);
}

/**
 * Нэмэгдэл багана нь БОДИТООР үнэд орж байна уу.
 *
 * Багана байгаа нь хангалттай БИШ: загварын тайлбар PM-д «тухайн барилгад
 * хамаарахгүй бол тэр нүдийг цэвэрлэ (хоосон нүд тооцоонд 0 өгнө)» гэж зөвлөдөг.
 * Бүх мөр нь цэвэрлэгдсэн бол уг нэмэгдэл нь ₮0 — өгүүлбэрт дурдах ёсгүй.
 */
function addonIsUsed(sheet: SheetDoc, key: string): boolean {
  const spec = sheet.addons;
  if (!spec) return false;
  const idx = spec.items.findIndex((x) => x.key === key);
  if (idx < 0) return false;
  const col = spec.baseCol + 1 + idx;
  for (let r = spec.firstRow; r <= spec.lastRow; r += 1) {
    const cell = getCell(sheet, r, col);
    if (!cell) continue;
    if (cell.f) return true;
    if (numOf(cell.v) !== undefined) return true;
  }
  return false;
}

/**
 * Аль нэг барилгын өндөр 4,5м-ээс ДЭЭШ бичигдсэн эсэх.
 *
 * ⚠️ Өндрийн ИТГЭЛЦҮҮРИЙН тайлбарыг `optionalCols`-ийн «Өндөр» бүлгийн
 * ХАРАГДАЦАД БҮҮ холбо. Тэр бүлэг нь зөвхөн НУУДАГ (устгадаггүй) — итгэлцүүр
 * нь нуусан ч үнийг үржүүлсээр байна. Багана нуугдсан үед тайлбарыг ч хасвал
 * захиалагч өссөн тоог тайлбарлах СҮҮЛЧИЙН мэдээллээ алдана.
 * Тиймээс ӨГӨГДЛӨӨР шийднэ: 4,5м-ээс дээш барилга байвал л итгэлцүүр
 * ажилласан.
 */
function hasTallBuilding(sheet: SheetDoc): boolean {
  const spec = sheet.addons;
  if (!spec) return false;
  const cols = new Set<number>();
  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    if (!cell || typeof cell.v !== 'string') continue;
    if (!HEIGHT_HEADERS.has(cell.v.trim())) continue;
    const co = refToCoord(ref);
    if (co) cols.add(co.c);
  }
  if (cols.size === 0) return false;
  for (let r = spec.firstRow; r <= spec.lastRow; r += 1) {
    for (const c of cols) {
      const h = numOf(getCell(sheet, r, c)?.v);
      if (h !== undefined && h > HCOEF_BASE_M) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  Өгүүлбэр угсрах туслахууд                                          */
/* ------------------------------------------------------------------ */

/** Монгол таслалаар, англи «, … and …»-аар холбоно. */
function joinClauses(parts: string[], lang: QuoteLang): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (lang !== 'en') return parts.join(', ');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Нэгжийн МН→EN — `addons.ts`-ийн `UNIT_EN`-тэй ижил жагсаалт. */
const UNIT_EN: Record<string, string> = {
  'м²': 'm²',
  га: 'ha',
  цооног: 'borehole',
  тм: 'lin.m',
  ш: 'pcs',
};

/**
 * «80га » / «80 ha » — талбайн хэмжээ.
 *
 * Тоо байхгүй бол ХООСОН мөр («… талбайн ерөнхий төлөвлөгөө …»). Практикт энэ
 * салаа ажиллах нь ховор: `costKeys` нь тоо хэмжээ бичигдсэн үед л энэ дүрмийг
 * асаадаг тул өгүүлбэр гарах болгонд тоо нь бэлэн байдаг.
 */
function areaPrefix(ctx: NoteCtx, lang: QuoteLang): string {
  const src = ctx.qty.masterplan?.qty ? ctx.qty.masterplan : ctx.qty.landscape;
  if (!src?.qty) return '';
  const unit = src.unit ?? 'га';
  const n = src.qty.toLocaleString('en-US');
  return lang === 'en' ? `${n} ${UNIT_EN[unit] ?? unit} ` : `${n}${unit} `;
}

/** Хувийн нэмэгдэл бүрийн өгүүлбэрийн ХЭСЭГ («төсвийн 8%»). */
const ADDON_CLAUSE: Record<string, { mn: (p: number) => string; en: (p: number) => string }> = {
  bms: {
    mn: (p) => `галаас хамгаалах "BMS" системийн ${p}%`,
    en: (p) => `${p}% for the fire-protection "BMS" system`,
  },
  water: {
    mn: (p) => `усаар гал унтраах системийн ${p}%`,
    en: (p) => `${p}% for the water-based fire suppression system`,
  },
  fire: {
    mn: (p) => `галын автоматик системийн ${p}%`,
    en: (p) => `${p}% for the automatic fire alarm system`,
  },
  cool: {
    mn: (p) => `хөргөлтийн системийн ${p}%`,
    en: (p) => `${p}% for the cooling system`,
  },
  quake: {
    mn: (p) => `8 балл газар хөдлөлтийн итгэлцүүрийн ${p}%`,
    en: (p) => `${p}% for the seismic intensity 8 coefficient`,
  },
  tosov: {
    mn: (p) => `төсвийн ${p}%`,
    en: (p) => `${p}% for the cost estimate`,
  },
};

/**
 * Нэг нэмэгдлийн өгүүлбэрийн хэсэг. Стандартад байхгүй (PM гараар нэмсэн)
 * нэмэгдлийг ӨӨРИЙНХ нь шошгоор бичнэ — таамаглаж орчуулахгүй.
 */
function addonClause(item: AddonItem, lang: QuoteLang): string {
  const c = ADDON_CLAUSE[item.key];
  if (c) return lang === 'en' ? c.en(item.pct) : c.mn(item.pct);
  const std = STANDARD_ADDONS.find((x) => x.key === item.key);
  const label = itemLabel(std ?? item, lang);
  return lang === 'en' ? `${item.pct}% for ${label}` : `${label} ${item.pct}%`;
}

/* ------------------------------------------------------------------ */
/*  ДҮРМҮҮД                                                            */
/* ------------------------------------------------------------------ */

export interface NoteRule {
  key: string;
  group: NoteGroup;
  /**
   * Тухайн мөрийг ЭНЭ дүрэм эзэмшиж байгааг таних тэмдэг — БД-ийн ЗААЛТЫН
   * ДУГААР. Бичвэр өөрчлөгдсөн ч (динамик, гараар засагдсан, орчуулагдсан)
   * дугаар нь үлддэг тул давхардал үүсэхгүй.
   */
  match: RegExp;
  /** Хуудасны төлөвөөс АВТОМАТААР асах уу. */
  auto: (ctx: NoteCtx) => boolean;
  render: (ctx: NoteCtx, lang: QuoteLang) => string;
  /** «Тайлбар» цэсэнд харагдах богино нэр. */
  menu: string;
  menuEn: string;
}

/**
 * ⚠️ ДАРААЛАЛ нь баримт дээрх дараалал — загварын (0185) бичсэн дарааллыг
 * ХЭВЭЭР барив.
 *
 * ⚠️ `match` дүрмүүд нэг БҮЛЭГ дотроо ХАРИЛЦАН ОГТЛОЛЦОХГҮЙ байх ЁСТОЙ.
 */
export const NOTE_RULES: readonly NoteRule[] = [
  {
    key: 'height',
    group: 'bd',
    match: /4\.21\.3/,
    menu: 'Өндрийн итгэлцүүр (4.21.3)',
    menuEn: 'Height coefficient (4.21.3)',
    auto: (ctx) => ctx.tallBuilding,
    render: (_ctx, lang) =>
      lang === 'en'
        ? 'Pursuant to BD 81-16-20 cl. 4.21.3, the storey height of an industrial building is taken as 4.5 m; for each additional 1 m above that, a coefficient of 1.05 is applied. /1.5 m × 0.05/'
        : 'БД-81-16-20-ийн 4.21.3-ыг үндэслэн барилгын давхрын өндөр үйлдвэрийн барилгад 4,5м байхаар тооцсон ба түүнээс 1м тутамд 1.05 гэсэн итгэлцүүр хэрэглэнэ. /1.5м*0.05/',
  },
  {
    key: 'addons',
    group: 'bd',
    match: /4\.19/,
    menu: 'Хувийн нэмэгдэл (4.19)',
    menuEn: 'Percentage add-ons (4.19)',
    auto: (ctx) => ctx.addons.length > 0,
    render: (ctx, lang) => {
      const parts = ctx.addons.map((a) => addonClause(a, lang));
      if (parts.length === 0) return '';
      return lang === 'en'
        ? `Pursuant to BD 81-16-20 cl. 4.19, an additional ${joinClauses(parts, lang)} ${
            parts.length > 1 ? 'have' : 'has'
          } been included.`
        : `БД-81-16-20-ийн 4.19-ийг үндэслэн ${joinClauses(parts, lang)} нэмж тооцов.`;
    },
  },
  {
    key: 'masterplan',
    group: 'bd',
    match: /3\.5\.1/,
    menu: 'Ерөнхий төлөвлөгөө (3.5.1)',
    menuEn: 'Master plan (3.5.1)',
    auto: (ctx) => ctx.costKeys.has('masterplan') || ctx.costKeys.has('landscape'),
    render: (ctx, lang) => {
      const mp = ctx.costKeys.has('masterplan');
      const ls = ctx.costKeys.has('landscape');
      const area = areaPrefix(ctx, lang);
      if (lang === 'en') {
        const what =
          mp && ls
            ? 'the master plan and landscaping design'
            : mp
              ? 'the master plan design'
              : 'the landscaping design';
        return `Pursuant to BD 81-16-20 cl. 3.5.1, the unit prices for ${what} of the ${area}site have been calculated.`;
      }
      const what =
        mp && ls
          ? 'ерөнхий төлөвлөгөө, гадна тохижилтын зургийн'
          : mp
            ? 'ерөнхий төлөвлөгөөний зургийн'
            : 'гадна тохижилтын зургийн';
      return `БД-81-16-20-ийн 3.5.1-ийг үндэслэн ${area}талбайн ${what} нэгж үнийг тооцов.`;
    },
  },
  {
    key: 'geology',
    group: 'bd',
    match: /81-117-13/,
    menu: 'Инженер геологи (81-117-13)',
    menuEn: 'Geotechnical investigation (81-117-13)',
    auto: (ctx) => ctx.costKeys.has('geology'),
    render: (_ctx, lang) =>
      lang === 'en'
        ? 'The price of the geotechnical investigation works is calculated pursuant to BD 81-117-13.'
        : 'БД 81-117-13-ийг үндэслэн инженер геологийн ажлын үнийг тооцов.',
  },
  {
    key: 'topography',
    group: 'bd',
    match: /81-103-21/,
    menu: 'Топографи (81-103-21)',
    menuEn: 'Topographic survey (81-103-21)',
    auto: (ctx) => ctx.costKeys.has('topography'),
    // ⚠️ «Т» нь КИРИЛЛ, «opography» нь латин, «М1» нь кирилл М — эх загварын
    // холимог бичлэг. `quoteTranslate`-ийн толь мөн БАЙТААРАА ийм тул БҮҮ «зас».
    render: (_ctx, lang) =>
      lang === 'en'
        ? 'The price of the topographic survey at scale 1:500 is calculated pursuant to BD 81-103-21.'
        : 'БД 81-103-21-ийг үндэслэн Тopography М1:500 зургийн үнийг тооцов.',
  },

  /* — «Ашигласан материал:» блок —
   *
   * ⚠️ Энэ блок нь ЯГ ИЖИЛ ХУДАЛ мэдээллийн эх сурвалж байв: инженер геологи ч,
   * топографи ч байхгүй санал дээр БД 81-117-13 ба БД 81-103-21 гэсэн хоёр
   * стандартыг «ашигласан» гэж жагсаасаар байв — дээрх өгүүлбэрийг нь хассан
   * ч гурван мөрийн доор тэр стандарт хэвээр бичигдэж байвал утга учиргүй. */
  {
    key: 'matDesign',
    group: 'material',
    match: /81-16-20/,
    menu: 'Жишиг үнэ (81-16-20)',
    menuEn: 'Reference prices (81-16-20)',
    // Бүх үнэ ЭНЭ стандартаас гардаг тул үргэлж.
    auto: () => true,
    render: (_ctx, lang) =>
      lang === 'en'
        ? 'BD 81-16-20 Reference Prices for Design Works'
        : 'БД 81-16-20 Зураг төслийн ажлын жишиг үнэ',
  },
  {
    key: 'matGeology',
    group: 'material',
    match: /81-117-13/,
    menu: 'Геологийн жишиг үнэ (81-117-13)',
    menuEn: 'Geotechnical reference prices (81-117-13)',
    auto: (ctx) => ctx.costKeys.has('geology'),
    render: (_ctx, lang) =>
      lang === 'en'
        ? 'BD 81-117-13 Reference Prices for Construction Geotechnical Investigation Works'
        : 'БД 81-117-13 Барилгын инженер геологийн ажлын жишиг үнэ',
  },
  {
    key: 'matTopo',
    group: 'material',
    match: /81-103-21/,
    menu: 'Геодезийн жишиг үнэ (81-103-21)',
    menuEn: 'Geodetic reference prices (81-103-21)',
    auto: (ctx) => ctx.costKeys.has('topography'),
    render: (_ctx, lang) =>
      lang === 'en'
        ? 'BD 81-103-21 Reference Prices for Geodetic and Cartographic Works'
        : 'БД 81-103-21 Геодизи, зураг зүйн ажлын жишиг үнэ',
  },
];

/* ------------------------------------------------------------------ */
/*  ГЭРЭЭНИЙ ХАМРАХ ХҮРЭЭНИЙ ТАЙЛБАР — блок БИШ, ГАНЦ МӨР               */
/* ------------------------------------------------------------------ */

/**
 * «Дээрх үнийн санал нь эскиз зургийн ажлын үнийн санал болно. Ажлын зураг
 * төслийн гэрээг мөн манай компанитай байгуулсан тохиолдолд … нэмэлт хөнгөлөлт
 * үзүүлэх боломжтой.» гэсэн өгүүлбэр нь загварт ХАТУУ бичигдсэн байв — өөрөөр
 * хэлбэл АЖЛЫН ЗУРГИЙН бүрэн санал дээр ч «энэ бол эскизийн санал» гэж бичээд,
 * аль хэдийн үнэд орсон ажлыг нь дахин гэрээлбэл хөнгөлнө гэж амладаг байв
 * (хэрэглэгчийн илрүүлэлт 2026-08-24). Тайлбарын блокуудтай ЯГ ИЖИЛ асуудал.
 *
 * ⇒ Одоо бичвэр нь баримтын ХАМРАХ ХҮРЭЭНЭЭС гарна:
 *   • `azPriced`  — ажлын зургийн нийлбэр ДҮН-д орсон эсэх;
 *   • `sketch`    — эскиз зургийн зардлын мөр үнэд орсон эсэх.
 * Хөнгөлөлтийн амлалт нь ЗӨВХӨН эскиз үнэд орсон АТАЛ ажлын зураг ОРООГҮЙ үед
 * гарна — өөр тохиолдолд утгагүй (аль хэдийн гэрээлж буй ажлаа дахин гэрээлэх
 * гэж байхгүй).
 */
export const CONTRACT_NOTE_KEY = 'contract';

/**
 * Гэрээний тайлбарын мөрийг таних тэмдэг.
 *
 * ⚠️ БҮХ хувилбарыг барих ЁСТОЙ (монгол/англи, хөнгөлөлттэй/хөнгөлөлтгүй),
 * эс бөгөөс `syncNotes` дараагийн удаад мөрөө олохгүй бөгөөд баримт дээр
 * ХУУЧИН өгүүлбэр хөлдөнө. Тиймээс өгүүлбэрийн ТОГТМОЛ эхлэлээр танина.
 */
const CONTRACT_ROW_RE =
  /(дээрх үнийн санал нь|this quotation covers|нэмэлт хөнгөлөлт|additional discount)/i;

/**
 * «… ₮123,456 /… төгрөг/ болно.» — ДҮН ҮСГЭЭР бичсэн мөр.
 *
 * ⚠️ `lib/signatureBlock.ts` ЭНЭ ЖИШИГЭЭР задлагчаа жолооддог тул тэнд ХУУЛБАР
 * БҮҮ гарга — эндээс импортол. Гэрээний мөрийг СЭРГЭЭХ ЗАНГУУ нь мөн энэ мөр
 * (загварт гэрээний өгүүлбэр нь түүний ЯГ ДООР сууна).
 */
export const TOTAL_WORDS_RE = /(₮|MNT)\s*[\d][\d.,\s]*.*(болно|tugrik|tögrög)/i;

/** Тухайн бичвэр нь гэрээний хамрах хүрээний (удирдагдсан) мөр үү. */
export function isContractNoteText(text: string): boolean {
  return CONTRACT_ROW_RE.test(text);
}

/**
 * Гэрээний хамрах хүрээний өгүүлбэр ИДЭВХТЭЙ эсэх.
 *
 * `NOTE_RULES`-ийн `auto` шиг нөхцөл БАЙХГҮЙ: өгүүлбэр нь баримт бүрд хамаатай
 * тул PM ЗОРИУД унтраагаагүй л бол ҮРГЭЛЖ асаалттай (`isNoteActive`-ийн ихэр).
 */
export function isContractNoteActive(sheet: SheetDoc): boolean {
  if (sheet.notes?.on?.includes(CONTRACT_NOTE_KEY)) return true;
  return !sheet.notes?.off?.includes(CONTRACT_NOTE_KEY);
}

function contractRender(ctx: NoteCtx, lang: QuoteLang): string {
  const az = ctx.azPriced;
  const sketch = ctx.costKeys.has('sketch');

  if (lang === 'en') {
    const scope =
      az && sketch
        ? 'the concept design and working drawings design works'
        : az
          ? 'the working drawings design works'
          : sketch
            ? 'the concept design works'
            : 'the works listed above';
    const first = `This quotation covers ${scope}.`;
    return sketch && !az
      ? `${first} Should the working drawings design contract also be awarded to our company, an additional discount may be applied to this quotation.`
      : first;
  }

  const scope =
    az && sketch
      ? 'эскиз болон ажлын зураг төслийн ажлын'
      : az
        ? 'ажлын зураг төслийн ажлын'
        : sketch
          ? 'эскиз зургийн ажлын'
          : 'дээр дурдсан ажлын';
  const first = `Дээрх үнийн санал нь ${scope} үнийн санал болно.`;
  return sketch && !az
    ? `${first} Ажлын зураг төслийн гэрээг мөн манай компанитай байгуулсан тохиолдолд дээрх үнийн саналд нэмэлт хөнгөлөлт үзүүлэх боломжтой.`
    : first;
}

/**
 * Гэрээний хамрах хүрээний өгүүлбэр — ХЭВЛЭМЭЛ ба ХУУДАС хоёрын ЦОРЫН ГАНЦ
 * эх сурвалж (`noteTextsFor`-той ижил гэрээ).
 *
 * PM-ийн гар засвар (`notes.text.contract`) ба унтраалт (`notes.off`) нь
 * бусад тайлбартай ЯГ ИЖИЛ ТҮЛХҮҮРЭЭР хадгалагдана — мөрийн индекс БИШ.
 */
export function contractNoteText(sheet: SheetDoc, lang: QuoteLang = 'mn', ctx?: NoteCtx): string {
  if (!isContractNoteActive(sheet)) return '';
  return contractActiveText(sheet, lang, ctx);
}

/**
 * Унтраалтыг ҮЛ ТООМСОРЛОСОН бичвэр — «дахин асаавал ЮУ бичигдэх вэ».
 * Цэсэнд урьдчилан харуулах, мөрийг сэргээхэд хэрэгтэй.
 */
export function contractActiveText(
  sheet: SheetDoc,
  lang: QuoteLang = 'mn',
  ctx?: NoteCtx,
): string {
  const manual = sheet.notes?.text?.[CONTRACT_NOTE_KEY];
  if (manual !== undefined) return manual;
  return contractRender(ctx ?? noteCtx(sheet), lang);
}

/** Гэрээний тайлбарын мөрийн БАЙРЛАЛ (олдохгүй бол `null`). */
export function findContractRow(sheet: SheetDoc): { r: number; c: number } | null {
  let best: { r: number; c: number } | null = null;
  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    /* ⚠️ Зөвхөн ЛИТЕРАЛ нүд (`litText` нь томьёог хаяна) — баримтын доод
     * хэсгийн USGEER-ийн мөр «Тайлбар: …» гэж ЭХЭЛДЭГ ТОМЬЁО бөгөөд түүнийг
     * дарж бичвэл дүнг үсгээр бичих өгүүлбэр устана. */
    const t = litText(cell ?? undefined);
    if (t === '' || !CONTRACT_ROW_RE.test(t)) continue;
    const co = refToCoord(ref);
    if (!co || co.r >= sheet.rows || co.c >= sheet.cols) continue;
    if (!best || co.r < best.r) best = { r: co.r, c: co.c };
  }
  return best;
}

/**
 * Мөрийг хуудсан дээр ДАХИН БИЧНЭ (засварлагч ба Excel-ийг хэвлэмэлтэй тааруулна).
 *
 * ⚠️ Хоосон бичвэр гарвал мөрийг ХӨНДӨХГҮЙ (устгахгүй, хоослохгүй): устгасан
 * мөрийг дараа нь ЮУГААР Ч олж сэргээх аргагүй болно — регексээр таних тэмдэг
 * нь өөрөө тэр бичвэр. Хэвлэмэл нь бичвэрээ ӨӨРӨӨ гаргадаг тул захиалагч руу
 * явах баримт зөв хэвээр.
 */
function syncContractRow(
  sheet: SheetDoc,
  ctx: NoteCtx,
  lang: QuoteLang,
): { sheet: SheetDoc; pair?: [string, string] } {
  const at = findContractRow(sheet);
  if (!at) {
    /* МӨР НЬ ОГТ ОЛДОХГҮЙ БАЙНА.
     *
     * 0185 загвараар үүссэн баримт (= тайлбарын БЛОКТОЙ) бүрд энэ мөр ЗААВАЛ
     * бичигддэг тул түүний алга болсон нь PM УСТГАСАН гэсэн үг. Түлхүүрээр
     * УНТРААНА — эс бөгөөс хэвлэмэл нь өгүүлбэрээ ДҮРМЭЭР гаргасаар байх ба
     * засварлагч дээр алга болсон өгүүлбэр PDF дээр үлдэнэ (хэрэглэгчийн
     * илрүүлэлт 2026-08-25). Ингэснээр АЛЬ ХЭДИЙН устгагдаж хадгалагдсан
     * саналууд ч дараагийн нээлтэд өөрөө засагдана.
     *
     * ⚠️ Блокгүй ХУУЧИН баримтад ХҮРЭХГҮЙ: тэдний хуудсанд эх бичвэр байсан
     * эсэхийг мэдэх аргагүй тул чимээгүй хасвал захиалагч руу явах өгүүлбэр
     * далд алга болно. Тэнд «Тайлбар» цэсний унтраалт л шийднэ.
     */
    if (!isContractNoteActive(sheet) || !hasNoteBlocks(sheet)) return { sheet };
    const st = sheet.notes ?? {};
    return {
      sheet: withNoteState(sheet, {
        ...st,
        off: [...withoutKey(st.off, CONTRACT_NOTE_KEY), CONTRACT_NOTE_KEY],
      }),
    };
  }
  const text = contractNoteText(sheet, lang, ctx);
  if (text.trim() === '') return { sheet };

  // Гараар бичсэн бичвэрийг орчуулж чадахгүй — толь/AI-д үлдээнэ.
  const managed = sheet.notes?.text?.[CONTRACT_NOTE_KEY] === undefined;
  const pair: [string, string] | undefined =
    managed && lang !== 'en' ? [text, contractRender(ctx, 'en')] : undefined;

  const prev = getCell(sheet, at.r, at.c);
  if (litText(prev) === text) return { sheet, pair };
  return {
    sheet: setCells(sheet, [
      {
        r: at.r,
        c: at.c,
        // ⚠️ `f: undefined` — өмнө томьёо байсан бол заавал салгана.
        cell: {
          ...prev,
          f: undefined,
          v: text,
          s: { ...(prev?.s ?? { align: 'left', wrap: true }) },
        },
      },
    ]),
    pair,
  };
}

/** Гэрээний мөрийн анхдагч хэлбэр — бүтэн өргөнөөр, зүүн тэгшилсэн, wrap. */
const CONTRACT_STYLE = { align: 'left', wrap: true } as const;

/**
 * «Дүн үсгээр» мөрийг олно — гэрээний өгүүлбэрийг СЭРГЭЭХ ЗАНГУУ.
 *
 * Загварт (0185) гэрээний өгүүлбэр нь USGEER-ийн мөрийн ЯГ ДООР сууна. Тиймээс
 * PM өгүүлбэрийг устгачихсан ч түүнийг БАЙРЛУУЛАХ газрыг бичвэргүйгээр олж
 * чадна — өөрөөр хэлбэл «унтрааж → дахин асаах» нь эргэх боломжтой болно.
 *
 * ⚠️ Томьёог мөн шалгана: загварт энэ мөр нь `="Тайлбар: … "&TEXT(Z20)&…`
 * ТОМЬЁО тул зөвхөн литерал бичвэрээр хайвал ХЭЗЭЭ Ч олдохгүй.
 */
function findTotalWordsRow(sheet: SheetDoc): number | null {
  let best: number | null = null;
  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    if (!cell) continue;
    const co = refToCoord(ref);
    if (!co || co.r >= sheet.rows || co.c >= sheet.cols) continue;
    const f = typeof cell.f === 'string' ? cell.f : '';
    const v = typeof cell.v === 'string' ? cell.v : '';
    if (!/USGEER\s*\(/i.test(f) && !TOTAL_WORDS_RE.test(v)) continue;
    if (best === null || co.r > best) best = co.r;
  }
  return best;
}

/** Мөр бүхэлдээ ХООСОН эсэх (томьёо ч, бичвэр ч, тоо ч алга). */
function rowIsEmpty(sheet: SheetDoc, r: number): boolean {
  for (let c = 0; c < sheet.cols; c += 1) {
    const cell = getCell(sheet, r, c);
    if (!cell) continue;
    if (cell.f) return false;
    if (typeof cell.v === 'number') return false;
    if (typeof cell.v === 'string' && cell.v.trim() !== '') return false;
  }
  return true;
}

/**
 * Гэрээний өгүүлбэрийг хуудсанд ДАХИН БИЧНЭ (мөр нь олдохгүй болсон үед).
 *
 * ⚠️ Зөвхөн ЗАНГУУ (дүн үсгээр мөр) олдсон үед ажиллана. Олдохгүй бол хуудсыг
 * ОГТ ХӨНДӨХГҮЙ — хэвлэмэл нь бичвэрээ өөрөө гаргадаг тул захиалагч руу явах
 * баримт зөв хэвээр, зөвхөн засварлагч дээр мөр дутуу байна.
 */
function restoreContractRow(sheet: SheetDoc, text: string): SheetDoc {
  const anchor = findTotalWordsRow(sheet);
  if (anchor === null) return sheet;
  const at = anchor + 1;

  // Ердийн зам: унтраахдаа мөрийг ХООСЛОДОГ тул тэр мөр байрандаа хэвээр байна.
  let next = at < sheet.rows && rowIsEmpty(sheet, at) ? sheet : insertRows(sheet, at, 1);

  // Бүтэн өргөний merge — шинэ мөрд merge өвлөгддөггүй (`refitMerges`-тэй ижил).
  if (!next.merges.some((m) => m.r === at && m.c === 0 && m.rs === 1 && m.cs === next.cols)) {
    const merges = next.merges.filter((m) => !(m.rs === 1 && m.r === at));
    merges.push({ r: at, c: 0, rs: 1, cs: next.cols });
    next = { ...next, merges };
  }

  const prev = getCell(next, at, 0);
  return setCells(next, [
    { r: at, c: 0, cell: { ...prev, f: undefined, v: text, s: { ...(prev?.s ?? CONTRACT_STYLE) } } },
  ]);
}

/**
 * Гэрээний мөрийг хуудсанаас АРИЛГАНА — мөрийг УСТГАХГҮЙ, зөвхөн ХООСЛОНО.
 *
 * ⚠️ Зарчим 5-аас ЗОРИУД ялгаатай. Тайлбарын блокийн мөрүүд нь ШОШГООРОО
 * олддог тул устгаад дахин оруулж болно; гэрээний мөр нь ГАНЦААРАА зогсдог ба
 * зөвхөн ДҮН ҮСГЭЭР мөрийн ДООР байснаараа танигдана. Мөрийг устгавал
 * доорх бүх мөр дээш шилжиж, дахин асаахад геометр өөрчлөгдөнө. Хоослосон мөр
 * нь хэвлэмэлд огт нөлөөлөхгүй (`detectSignatureBlock` хүснэгтийн доорх БҮХ
 * мөрийг нуудаг), Excel дээр л нэг хоосон зурвас үлдэнэ.
 */
function clearContractRow(sheet: SheetDoc): SheetDoc {
  const at = findContractRow(sheet);
  if (!at) return sheet;
  const prev = getCell(sheet, at.r, at.c);
  return setCells(sheet, [
    { r: at.r, c: at.c, cell: { ...prev, f: undefined, v: '', s: { ...(prev?.s ?? CONTRACT_STYLE) } } },
  ]);
}

export function noteRule(key: string): NoteRule | undefined {
  return NOTE_RULES.find((r) => r.key === key);
}

/** Цэсэнд харагдах шошго — `addons.ts`-ийн `itemLabel`-тэй ижил гэрээ. */
export function noteMenuLabel(rule: NoteRule, lang: QuoteLang = 'mn'): string {
  return lang === 'en' ? rule.menuEn : rule.menu;
}

/* ------------------------------------------------------------------ */
/*  Блокийг хуудсанаас олох                                            */
/* ------------------------------------------------------------------ */

/** «Тайлбар:» — ГАНЦААРАА зогсох ШОШГЫН нүд (урт өгүүлбэр НЬ БИШ). */
const BD_LABEL_RE = /^\s*(тайлбар|note|notes)\s*:?\s*$/i;
/** «Ашигласан материал:» шошиг. */
const MATERIAL_LABEL_RE =
  /^\s*(ашигласан материал|материал|source|sources|reference materials?)\s*:?\s*$/i;

export interface NoteBlock {
  group: NoteGroup;
  /** Шошгын мөр — блокийн ЭХНИЙ мөр, эхний тайлбарыг мөн энэ мөр агуулна. */
  labelRow: number;
  labelCol: number;
  /** Тайлбарын бичвэр бичигдэх багана (загварт C = 2). */
  textCol: number;
  /** Блокийн бүх мөр (`labelRow`-оос эхлэн дараалсан). */
  rows: number[];
  /** Шошгын бичвэр — хэвээр нь буцааж бичнэ (PM өөрчилсөн байж болно). */
  labelText: string;
}

/** Мөр бүрийн ОРШИН БУЙ нүднүүдийн баганы индекс, эрэмбэлэгдсэн. */
function colsByRow(sheet: SheetDoc): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const [ref, cell] of Object.entries(sheet.cells ?? {})) {
    if (!cell) continue;
    const co = refToCoord(ref);
    if (!co || co.r >= sheet.rows || co.c >= sheet.cols) continue;
    const list = map.get(co.r);
    if (list) list.push(co.c);
    else map.set(co.r, [co.c]);
  }
  for (const list of map.values()) list.sort((a, b) => a - b);
  return map;
}

/** Нүдний ЛИТЕРАЛ бичвэр. Томьёотой нүд ХООСОН гэж тооцогдоно (зарчим 3). */
function litText(cell: SheetCell | undefined): string {
  if (!cell || cell.f) return '';
  return typeof cell.v === 'string' ? cell.v.trim() : '';
}

/**
 * Хуудсанаас тайлбарын блокуудыг олно.
 *
 * Шошгын мөр = хамгийн зүүн нүд нь `BD_LABEL_RE`/`MATERIAL_LABEL_RE`-д таарсан
 * ЛИТЕРАЛ мөр. Үргэлжлэл = доор нь дараалсан, зөвхөн `textCol`-оос эхэлсэн
 * (зүүн талд нүдгүй) мөрүүд — загварын `span(r, 2, …)` бүтэц яг ийм.
 */
export function findNoteBlocks(sheet: SheetDoc): NoteBlock[] {
  const byRow = colsByRow(sheet);
  const out: NoteBlock[] = [];

  for (const [r, cols] of [...byRow.entries()].sort((a, b) => a[0] - b[0])) {
    const first = cols[0];
    if (first === undefined) continue;
    const label = litText(getCell(sheet, r, first));
    if (label === '') continue;
    const group: NoteGroup | null = BD_LABEL_RE.test(label)
      ? 'bd'
      : MATERIAL_LABEL_RE.test(label)
        ? 'material'
        : null;
    if (!group) continue;

    // Бичвэрийн багана: шошгын дараах ЭХНИЙ нүд, эс бөгөөс шошгоос 2 баруун тийш.
    const textCol = cols.find((c) => c > first) ?? first + 2;
    const rows = [r];
    for (let n = r + 1; n < sheet.rows; n += 1) {
      const nc = byRow.get(n);
      if (!nc || nc.length === 0) break;
      // Зүүн талд нүдтэй мөр = ШИНЭ хэсэг (материал, USGEER, гарын үсэг…).
      if ((nc[0] ?? 0) < textCol) break;
      rows.push(n);
    }
    out.push({ group, labelRow: r, labelCol: first, textCol, rows, labelText: label });
  }
  return out;
}

/** Хуудсанд тайлбарын блок байна уу — цэсийг харуулах эсэхийг шийднэ. */
export function hasNoteBlocks(sheet: SheetDoc): boolean {
  return findNoteBlocks(sheet).length > 0;
}

/* ------------------------------------------------------------------ */
/*  Бичвэр угсрах                                                      */
/* ------------------------------------------------------------------ */

/** Тухайн түлхүүр ИДЭВХТЭЙ эсэх (гараар дарсан төлөв нь автоматыг дарна). */
export function isNoteActive(sheet: SheetDoc, key: string, ctx?: NoteCtx): boolean {
  const rule = noteRule(key);
  if (!rule) return false;
  const st = sheet.notes;
  if (st?.on?.includes(key)) return true;
  if (st?.off?.includes(key)) return false;
  return rule.auto(ctx ?? noteCtx(sheet));
}

/** Тухайн түлхүүрийн бичвэр — гараар засварласан нь давуу. */
export function noteText(sheet: SheetDoc, key: string, lang: QuoteLang, ctx?: NoteCtx): string {
  const rule = noteRule(key);
  if (!rule) return '';
  const manual = sheet.notes?.text?.[key];
  if (manual !== undefined) return manual;
  return rule.render(ctx ?? noteCtx(sheet), lang);
}

/** Блокт бичигдэх бичвэрүүд — ДҮРМИЙН дараалалаар, дараа нь PM-ийн өөрийн мөрүүд. */
/** Тухайн бичвэр нь ЭНЭ бүлгийн ямар нэг дүрэмд ХАРЬЯАЛАГДАЖ байна уу. */
export function isManagedNoteText(text: string, group: NoteGroup): boolean {
  return NOTE_RULES.some((r) => r.group === group && r.match.test(text));
}

/**
 * НЭГ БҮЛГИЙН тайлбарууд — ДҮРМЭЭР үүсгэсэн бичвэрүүд, дараа нь PM-ийн өөрийн
 * (дүрэмгүй) мөрүүд.
 *
 * ⚠️ ЭНЭ нь `syncNotes` (хуудсанд бичих) ба ХЭВЛЭМЭЛ (`lib/signatureBlock.ts`)
 * ХОЁУЛАНГИЙН цорын ганц эх сурвалж. Хоёр тусад нь бодвол цаас, дэлгэц хоёр
 * зөрөх нь гарцаагүй — 2026-08-24-нд яг тэр зөрүү илэрсэн: хэвлэмэл нь
 * ХАТУУ БИЧСЭН таван өгүүлбэр рүү унаж, «Төсөв» унтраасан, геологи/топографи
 * огт хийхгүй санал (№51) дээр ч тэднийг сүрхий бичсээр байв.
 *
 * `foreign` — хуудсанд байгаа, ямар ч дүрэмд таараагүй бичвэрүүд (PM гараар
 * нэмсэн). Хуудсанд тайлбарын блок огт байхгүй бол хоосон.
 */
export function noteTextsFor(
  sheet: SheetDoc,
  group: NoteGroup,
  lang: QuoteLang,
  ctx: NoteCtx,
  foreign: readonly string[] = [],
): { texts: string[]; i18n: Record<string, string> } {
  const texts: string[] = [];
  const i18n: Record<string, string> = {};

  for (const rule of NOTE_RULES) {
    if (rule.group !== group) continue;
    if (!isNoteActive(sheet, rule.key, ctx)) continue;
    const manual = sheet.notes?.text?.[rule.key];
    const text = manual ?? rule.render(ctx, lang);
    if (text.trim() === '') continue;
    texts.push(text);
    // Гараар бичсэн бичвэрийг орчуулж чадахгүй — толь/AI-д үлдээнэ.
    if (manual === undefined && lang !== 'en') {
      const en = rule.render(ctx, 'en');
      if (en.trim() !== '') i18n[text] = en;
    }
  }

  /* PM-ИЙН ӨӨРИЙН МӨРҮҮД — удирдагдсан мөрүүдийн ДАРАА эгнүүлнэ. Тайлбарын
   * төлөвт хадгалдаггүй (давхардана) — хуудас өөрөө эх сурвалж.
   * Аль хэдийн үүсгэсэн бичвэртэй ЯГ ижил мөрийг давхардуулахгүй. */
  for (const t of foreign) {
    if (t.trim() === '' || texts.includes(t)) continue;
    texts.push(t);
  }

  return { texts, i18n };
}

/** Блокийн мөрүүдээс PM-ийн ӨӨРИЙН (дүрэмгүй) бичвэрүүдийг цуглуулна. */
function foreignTexts(sheet: SheetDoc, block: NoteBlock): string[] {
  const out: string[] = [];
  for (const r of block.rows) {
    const t = litText(getCell(sheet, r, block.textCol));
    if (t === '' || isManagedNoteText(t, block.group)) continue;
    out.push(t);
  }
  return out;
}

function blockTexts(
  sheet: SheetDoc,
  block: NoteBlock,
  ctx: NoteCtx,
  lang: QuoteLang,
): { texts: string[]; i18n: Record<string, string> } {
  return noteTextsFor(sheet, block.group, lang, ctx, foreignTexts(sheet, block));
}

/* ------------------------------------------------------------------ */
/*  Хуудсанд бичих                                                     */
/* ------------------------------------------------------------------ */

const LABEL_STYLE = { bold: true, align: 'left' } as const;
const BD_TEXT_STYLE = { align: 'left', wrap: true } as const;
const MATERIAL_TEXT_STYLE = { bold: true, align: 'left', wrap: true } as const;

/** Блокийн мөрүүдийн merge-ийг дахин барина (шинэ мөрд merge өвлөгддөггүй). */
function refitMerges(sheet: SheetDoc, block: NoteBlock, rows: number[]): SheetDoc {
  const inBlock = new Set(rows);
  const merges = sheet.merges.filter((m) => !(m.rs === 1 && inBlock.has(m.r)));
  const first = rows[0];
  if (first !== undefined && block.textCol > block.labelCol) {
    merges.push({
      r: first,
      c: block.labelCol,
      rs: 1,
      cs: block.textCol - block.labelCol,
    });
  }
  const cs = Math.max(1, sheet.cols - block.textCol);
  for (const r of rows) merges.push({ r, c: block.textCol, rs: 1, cs });
  return { ...sheet, merges };
}

/** Нэг блокийг бичвэрийн жагсаалтад тааруулна (мөр нэмэх / устгах / дарж бичих). */
function writeBlock(sheet: SheetDoc, block: NoteBlock, texts: string[]): SheetDoc {
  // ⚠️ Шошгын мөр ХЭЗЭЭ Ч устахгүй: уствал хэвлэмэл дээр `mode='bd'` эхлэхгүй
  // болж ҮЛДСЭН БҮХ тайлбар чимээгүй алга болно (зарчим 5).
  const want = Math.max(1, texts.length);
  const have = block.rows.length;

  let next = sheet;
  if (want > have) next = insertRows(next, block.labelRow + have, want - have);
  else if (want < have) next = deleteRows(next, block.labelRow + want, have - want);

  const rows = Array.from({ length: want }, (_, i) => block.labelRow + i);
  next = refitMerges(next, block, rows);

  const textStyle = block.group === 'material' ? MATERIAL_TEXT_STYLE : BD_TEXT_STYLE;
  const patches: CellPatch[] = [
    {
      r: block.labelRow,
      c: block.labelCol,
      cell: { v: block.labelText, s: { ...LABEL_STYLE } },
    },
  ];
  rows.forEach((r, i) => {
    const prev = getCell(next, r, block.textCol);
    patches.push({
      r,
      c: block.textCol,
      // ⚠️ `f: undefined` — өмнө томьёо байсан бол заавал салгана, эс бөгөөс
      // томьёо давуу эрхтэй тул шинэ бичвэр хэзээ ч харагдахгүй.
      cell: { ...prev, f: undefined, v: texts[i] ?? '', s: { ...(prev?.s ?? textStyle) } },
    });
  });
  return setCells(next, patches);
}

/**
 * Тайлбарын блокуудыг хуудасны БОДИТ агуулгад тааруулж ДАХИН БИЧНЭ.
 *
 * Идемпотент: өөрчлөх зүйл байхгүй бол ЯГ ТЭР объектыг буцаана, тиймээс
 * дуудагч нь autosave-ыг дэмий асаахгүй.
 */
export function syncNotes(sheet: SheetDoc, lang: QuoteLang = 'mn'): SheetDoc {
  const blocks = findNoteBlocks(sheet);
  // ⚠️ Блок байхгүй ч ЭРТ ГАРАХГҮЙ: 0185-аас ӨМНӨХ саналуудад тайлбарын блок
  // байдаггүй ч ГЭРЭЭНИЙ хамрах хүрээний мөр нь байдаг — түүнийг мөн шинэчилнэ.
  const ctx = noteCtx(sheet);

  let next = sheet;
  let i18n: Record<string, string> = {};
  let changed = false;

  // ⚠️ ДООРООС ДЭЭШ: мөр нэмэх/устгах нь ЗӨВХӨН доод блокуудын дугаарыг
  // шилжүүлдэг тул урвуу дарааллаар явбал дээд блокийн индекс хүчинтэй хэвээр.
  for (const block of [...blocks].sort((a, b) => b.labelRow - a.labelRow)) {
    const { texts, i18n: pairs } = blockTexts(next, block, ctx, lang);
    i18n = { ...i18n, ...pairs };
    const current = block.rows.map((r) => litText(getCell(next, r, block.textCol)));
    const same =
      current.length === Math.max(1, texts.length) &&
      current.every((t, i) => t === (texts[i] ?? ''));
    if (same) continue;
    next = writeBlock(next, block, texts);
    changed = true;
  }

  // Гэрээний хамрах хүрээний мөр — блокийн ГАДНА, ганц мөр.
  const contract = syncContractRow(next, ctx, lang);
  if (contract.sheet !== next) {
    next = contract.sheet;
    changed = true;
  }
  if (contract.pair) i18n[contract.pair[0]] = contract.pair[1];

  const prevI18n = sheet.notes?.i18n;
  const i18nChanged = JSON.stringify(prevI18n ?? {}) !== JSON.stringify(i18n);
  if (!changed && !i18nChanged) return sheet;

  const state: NoteState = { ...(next.notes ?? {}) };
  if (Object.keys(i18n).length > 0) state.i18n = i18n;
  else delete state.i18n;
  return withNoteState(next, state);
}

/* ------------------------------------------------------------------ */
/*  Төлөв өөрчлөх (цэснээс)                                            */
/* ------------------------------------------------------------------ */

/** Хоосон төлөвийг `SheetDoc`-оос БҮРЭН хасна (хуучин баримттай ижил JSON). */
function withNoteState(sheet: SheetDoc, state: NoteState): SheetDoc {
  const clean: NoteState = {};
  if (state.on && state.on.length > 0) clean.on = state.on;
  if (state.off && state.off.length > 0) clean.off = state.off;
  if (state.text && Object.keys(state.text).length > 0) clean.text = state.text;
  if (state.i18n && Object.keys(state.i18n).length > 0) clean.i18n = state.i18n;
  if (Object.keys(clean).length === 0) {
    // Хоосон бол талбарыг ОГТ бичихгүй — хуучин баримттай яг ижил `sheet_json`.
    if (sheet.notes === undefined) return sheet;
    const next = { ...sheet };
    delete next.notes;
    return next;
  }
  return { ...sheet, notes: clean };
}

function withoutKey(list: string[] | undefined, key: string): string[] {
  return (list ?? []).filter((k) => k !== key);
}

/**
 * Тайлбарыг асаах / унтраах.
 *
 * Хэрэв гараар сонгосон төлөв нь АВТОМАТ утгатай давхцвал жагсаалтаас БҮРЭН
 * хасна — ингэснээр дараа нь нөхцөл өөрчлөгдөхөд тайлбар автоматаар дагана
 * («хүчээр асаасан» гэж хөлдөхгүй).
 */
export function toggleNote(sheet: SheetDoc, key: string, lang: QuoteLang = 'mn'): SheetDoc {
  const rule = noteRule(key);
  if (!rule) return sheet;
  const ctx = noteCtx(sheet);
  const auto = rule.auto(ctx);
  const want = !isNoteActive(sheet, key, ctx);

  const st = sheet.notes ?? {};
  const state: NoteState = {
    ...st,
    on: withoutKey(st.on, key),
    off: withoutKey(st.off, key),
  };
  if (want !== auto) {
    if (want) state.on = [...(state.on ?? []), key];
    else state.off = [...(state.off ?? []), key];
  }
  return syncNotes(withNoteState(sheet, state), lang);
}

/**
 * Тайлбарын бичвэрийг ГАРААР бичих. Хоосон мөр өгвөл гар засварыг цуцалж
 * автоматаар үүсгэсэн бичвэр рүү буцаана.
 *
 * ⚠️ Гараар бичсэн бичвэр нь орчуулгын давхаргад ОРОХГҮЙ (`i18n`) — англи
 * хуулбар дээр тэр мөр толь/AI-аар явна.
 */
export function setNoteText(
  sheet: SheetDoc,
  key: string,
  text: string,
  lang: QuoteLang = 'mn',
): SheetDoc {
  if (!noteRule(key)) return sheet;
  const st = sheet.notes ?? {};
  const map = { ...(st.text ?? {}) };
  const trimmed = text.trim();
  if (trimmed === '') delete map[key];
  else map[key] = trimmed;
  return syncNotes(withNoteState(sheet, { ...st, text: map }), lang);
}

/* ------------------------------------------------------------------ */
/*  Гэрээний хамрах хүрээний өгүүлбэр — төлөв өөрчлөх                   */
/* ------------------------------------------------------------------ */

/**
 * Гэрээний өгүүлбэрийг асаах / унтраах.
 *
 * ⚠️ ХУУДСЫГ Ч ДАГУУЛНА. Бусад тайлбар нь блокоороо `syncNotes`-д
 * дагуулагддаг бол гэрээний мөр нь БИЧВЭРЭЭРЭЭ танигддаг тул `syncNotes`
 * унтраасан мөрийг олж чаддаггүй (хоосон бичвэр нь `CONTRACT_ROW_RE`-д
 * таарахгүй). Тиймээс унтраах/асаахдаа нүдийг ЭНД шууд бичнэ — эс бөгөөс
 * засварлагч дээр өгүүлбэр үлдсэн атал цаасан дээр гарахгүй (эсвэл эсрэгээр)
 * гэсэн ЗӨРҮҮ үүснэ. Яг тэр зөрүү 2026-08-25-нд хэрэглэгчийн зүгээс
 * илэрсэн: хуудсан дээрээс устгасан өгүүлбэр PDF дээр гарсаар байв.
 */
export function toggleContractNote(sheet: SheetDoc, lang: QuoteLang = 'mn'): SheetDoc {
  const wasOff = !isContractNoteActive(sheet);
  const st = sheet.notes ?? {};
  const state: NoteState = {
    ...st,
    on: withoutKey(st.on, CONTRACT_NOTE_KEY),
    off: withoutKey(st.off, CONTRACT_NOTE_KEY),
  };
  if (!wasOff) state.off = [...(state.off ?? []), CONTRACT_NOTE_KEY];

  let next = withNoteState(sheet, state);
  if (wasOff) {
    // ДАХИН АСААВ — мөр нь хоослогдсон/устсан байвал сэргээнэ.
    if (!findContractRow(next)) {
      const text = contractActiveText(next, lang);
      if (text.trim() !== '') next = restoreContractRow(next, text);
    }
    /* ⚠️ Зангуу (дүн үсгээр мөр) олдоогүй тул мөр сэргэсэнгүй бол ХҮЧЭЭР
     * асаасан гэж тэмдэглэнэ. Эс бөгөөс `syncContractRow`-ийн «мөр алга =
     * PM устгасан» дүрэм тэр дор нь дахин унтраах ба цэсний тэмдэг дарагдахгүй
     * мэт харагдана. */
    if (!findContractRow(next)) {
      const nst = next.notes ?? {};
      next = withNoteState(next, { ...nst, on: [...(nst.on ?? []), CONTRACT_NOTE_KEY] });
    }
  } else {
    next = clearContractRow(next);
  }
  return syncNotes(next, lang);
}

/**
 * Гэрээний өгүүлбэрийг ГАРААР бичих (хоосон өгвөл автомат руу буцна) —
 * `setNoteText`-ийн ихэр.
 */
export function setContractNoteText(
  sheet: SheetDoc,
  text: string,
  lang: QuoteLang = 'mn',
): SheetDoc {
  const st = sheet.notes ?? {};
  const map = { ...(st.text ?? {}) };
  const trimmed = text.trim();
  if (trimmed === '') delete map[CONTRACT_NOTE_KEY];
  else map[CONTRACT_NOTE_KEY] = trimmed;

  let next = withNoteState(sheet, {
    ...st,
    on: withoutKey(st.on, CONTRACT_NOTE_KEY),
    off: withoutKey(st.off, CONTRACT_NOTE_KEY),
    text: map,
  });
  // Гараар бичихийг «дахин асаах» гэж үзнэ — мөр нь алга байвал сэргээнэ.
  if (!findContractRow(next)) {
    const want = contractActiveText(next, lang);
    if (want.trim() !== '') next = restoreContractRow(next, want);
    // Сэргээх зангуу олдоогүй бол `syncContractRow` дахин унтраахаас сэргийлнэ.
    if (!findContractRow(next)) {
      const nst = next.notes ?? {};
      next = withNoteState(next, { ...nst, on: [...(nst.on ?? []), CONTRACT_NOTE_KEY] });
    }
  }
  return syncNotes(next, lang);
}

/**
 * ХУУДСАН ДЭЭР ШУУД хийсэн засварыг ТҮЛХҮҮРИЙН ТӨЛӨВ болгож барина.
 *
 * ⚠️⚠️ ЭНЭ НЬ БОДИТ АЛДААНААС ТӨРСӨН (хэрэглэгчийн илрүүлэлт 2026-08-25).
 * Гэрээний өгүүлбэр нь 2026-08-24-нөөс хойш ДҮРМЭЭР гаргагддаг болсон
 * (`signatureBlock.contractNote` нь хуудсыг УНШИХГҮЙ) — тиймээс PM нүдний
 * бичвэрийг устгаад хадгалахад засварлагч дээр алга болсон атал ХЭВЛЭХ/PDF
 * дээр өгүүлбэр ХЭВЭЭР гарсаар байв. Хуудсан дээрх засвар нь төлөвт огт
 * буудаггүй байсан нь шалтгаан.
 *
 * ⇒ `QuoteEditorPage.handleSheetChange` (хуудасны БҮХ засвар өнгөрдөг ганц
 *   хоолой) энэ функцээр дамжина: мөрийн бичвэр ХООСОРВОЛ `notes.off`, ӨӨР
 *   бичвэр болбол `notes.text` болж БАЙРЛАЛААР БИШ, ТҮЛХҮҮРЭЭР хадгалагдана
 *   (Зарчим 2). Тиймээс дараагийн хэвлэлт хуудастай ЗААВАЛ таарна.
 *
 * ⚠️ Яагаад зөвхөн ГЭРЭЭНИЙ мөр вэ (тайлбарын блокт БИШ): блокийн мөр нь
 * `NoteRule.auto` нөхцөлөөр өөрөө алга болж/гарч ирдэг (тоо хэмжээ цэвэрлэхэд
 * геологийн өгүүлбэр унтардаг г.м.). «Мөр алга болсон = PM унтраасан» гэж
 * үзвэл тэр автомат нөхцөлийг ХӨЛДӨӨНӨ — тоо хэмжээг буцааж бичихэд өгүүлбэр
 * дахин гарахаа болино. Гэрээний өгүүлбэрт `auto` нөхцөл БАЙХГҮЙ бөгөөд
 * `contractRender` нь ХЭЗЭЭ Ч хоосон буцаадаггүй тул «хоосорсон = PM
 * устгасан» гэдэг нь ЭРГЭЛЗЭЭГҮЙ.
 */
export function captureContractEdit(
  prev: SheetDoc,
  next: SheetDoc,
  lang: QuoteLang = 'mn',
): SheetDoc {
  if (prev === next) return next;

  const before = findContractRow(prev);
  const after = findContractRow(next);
  const beforeText = before ? litText(getCell(prev, before.r, before.c)) : '';
  const afterText = after ? litText(getCell(next, after.r, after.c)) : '';
  // Мөр хөндөгдөөгүй (эсвэл хоёуланд нь байхгүй) — дүгнэх зүйлгүй.
  if (beforeText === afterText) return next;

  const st = next.notes ?? {};

  if (afterText === '') {
    // PM бичвэрийг УСТГАСАН → түлхүүрээр УНТРААНА (хэвлэмэл тэр даруй дагана).
    if (!isContractNoteActive(next)) return next;
    const text = { ...(st.text ?? {}) };
    delete text[CONTRACT_NOTE_KEY];
    return withNoteState(next, {
      ...st,
      on: withoutKey(st.on, CONTRACT_NOTE_KEY),
      off: [...withoutKey(st.off, CONTRACT_NOTE_KEY), CONTRACT_NOTE_KEY],
      text,
    });
  }

  /* Бичвэр БАЙНА → асаалттай болгоно. Хэрэв тэр нь ЯГ ОДООГИЙН дүрмээр
   * үүсэх бичвэр бол гар засвар гэж ҮЗЭХГҮЙ — эс бөгөөс `syncNotes` дуудсан
   * бүрд (жишээ нь нэмэгдлийн хувь солиход) өгүүлбэр ХӨЛДӨЖ, хамрах хүрээ
   * өөрчлөгдөхөд дагахаа болино. */
  const auto = contractRender(noteCtx(next), lang);
  const text = { ...(st.text ?? {}) };
  if (afterText === auto) delete text[CONTRACT_NOTE_KEY];
  else text[CONTRACT_NOTE_KEY] = afterText;

  return withNoteState(next, {
    ...st,
    on: withoutKey(st.on, CONTRACT_NOTE_KEY),
    off: withoutKey(st.off, CONTRACT_NOTE_KEY),
    text,
  });
}

/**
 * ГАРААР шинэ тайлбар нэмнэ — блокийн ТӨГСГӨЛД шинэ мөр.
 *
 * Ямар ч дүрэмд таарахгүй тул `syncNotes` түүнийг цаашид ХЭВЭЭР үлдээнэ
 * (`blockTexts`-ийн «PM-ийн өөрийн мөрүүд» салаа).
 */
export function addCustomNote(
  sheet: SheetDoc,
  group: NoteGroup,
  text: string,
  lang: QuoteLang = 'mn',
): SheetDoc {
  const trimmed = text.trim();
  if (trimmed === '') return sheet;
  const block = findNoteBlocks(sheet).find((b) => b.group === group);
  if (!block) return sheet;
  const ctx = noteCtx(sheet);
  const { texts } = blockTexts(sheet, block, ctx, lang);
  return syncNotes(writeBlock(sheet, block, [...texts, trimmed]), lang);
}

/** PM-ийн ГАРААР нэмсэн (дүрэмгүй) мөрүүд — цэсэнд устгах боломж олгоно. */
export function customNotes(sheet: SheetDoc): { group: NoteGroup; text: string }[] {
  const out: { group: NoteGroup; text: string }[] = [];
  for (const block of findNoteBlocks(sheet)) {
    const owned = NOTE_RULES.filter((r) => r.group === block.group);
    for (const r of block.rows) {
      const t = litText(getCell(sheet, r, block.textCol));
      if (t === '' || owned.some((rule) => rule.match.test(t))) continue;
      out.push({ group: block.group, text: t });
    }
  }
  return out;
}

/** Гараар нэмсэн тайлбарыг устгана (бичвэрээрээ таних). */
export function removeCustomNote(
  sheet: SheetDoc,
  group: NoteGroup,
  text: string,
  lang: QuoteLang = 'mn',
): SheetDoc {
  const block = findNoteBlocks(sheet).find((b) => b.group === group);
  if (!block) return sheet;
  const ctx = noteCtx(sheet);
  const { texts } = blockTexts(sheet, block, ctx, lang);
  const idx = texts.indexOf(text);
  if (idx < 0) return sheet;
  const next = texts.filter((_, i) => i !== idx);
  return syncNotes(writeBlock(sheet, block, next), lang);
}

/** Нүдний хаяг — тестэд хэрэгтэй (нийтийн API-д үлдээв). */
export function noteCellRef(block: NoteBlock, index: number): string {
  return coordToRef(block.labelRow + index, block.textCol);
}
