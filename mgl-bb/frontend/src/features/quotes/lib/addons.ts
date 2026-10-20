/**
 * Нэмэгдэл багана — асаах / унтраах (БД 81-16-20/2020, заалт 4.19, 4.21).
 *
 * «Нэмэгдэл» гэдэг нь суурь баганаас (ихэвчлэн ЗТАҮ) хувиар тооцогдох багана:
 * усаар гал унтраах 4%, галын автоматик 6%, хөргөлт 5%, 8 балл газар хөдлөлт
 * 10% гэх мэт. Төсөл бүрт өөр өөр багц хэрэгтэй тул PM тэдгээрийг цэсээс
 * асааж/унтраана.
 *
 * Инвариант (`AddonSpec`-ийн тайлбарыг үз): нэмэгдэл багана нь `baseCol`-ийн яг
 * баруун талд дараалан байрлаж, мөрийн нийт дүн нь тэдгээрийн дараа орно.
 * Тиймээс асаах = «нийт дүнгийн ӨМНӨ багана оруулах», унтраах = «тэр баганыг
 * устгах». `insertCols`/`deleteCols` бүх томьёог автоматаар шилжүүлдэг тул
 * нийт дүн, доод нийлбэр, anchor бүгд өөрөө зөв үлдэнэ.
 */
import { coordToRef, refToCoord } from './formula/refs';
import {
  deleteCols,
  deleteRows,
  getCell,
  insertCols,
  insertRows,
  setAnchor,
  setCells,
  type CellPatch,
} from './sheetOps';
import type {
  AddonItem,
  AddonSpec,
  CostLineItem,
  LineAddonSpec,
  QuoteLang,
  SectionItem,
  SectionSpec,
  SheetCell,
  SheetDoc,
} from '../types/quotes';

/**
 * Стандарт нэмэгдлүүд — MGL-ийн бодит үнийн санал/хяналтын төсвөөс.
 *
 * ⚠️ `bms` ба `fire` нь ХОЁР ӨӨР зүйл (хэрэглэгч 2026-07-24-нд баталсан):
 * хяналтын төсөвт «BMS» нь галаас хамгаалах системийн зураг төсөл, «Галын
 * автоматик» нь тусдаа. Бүү нэгтгэ.
 *
 * ⚠️ `labelEn` нь серверийн орчуулгын толийн (`backend/src/lib/quoteTranslate.ts`)
 * EN утгуудтай БАЙТ БҮРЭЭРЭЭ ижил байх ёстой — англи хуудсан дээр цэснээс дахин
 * асаахад орчуулгатай яг адил бичвэр гарна. Толь өөрчлөгдвөл энд ЗЭРЭГ өөрчил.
 */
export const STANDARD_ADDONS: readonly AddonItem[] = [
  { key: 'bms', label: 'BMS /ЗТАҮ*6%/', labelEn: 'BMS /design fee×6%/', pct: 6 },
  {
    key: 'water',
    label: 'Усаар гал унтраах систем 4%',
    labelEn: 'Water-based fire suppression system 4%',
    pct: 4,
  },
  { key: 'fire', label: 'Галын автоматик 6%', labelEn: 'Automatic fire alarm system 6%', pct: 6 },
  { key: 'cool', label: 'Хөргөлт 5%', labelEn: 'Cooling system 5%', pct: 5 },
  {
    key: 'quake',
    label: '8 балл газар хөдлөлтийн итгэлцүүр 10%',
    labelEn: 'Seismic intensity 8 coefficient 10%',
    pct: 10,
  },
  { key: 'tosov', label: 'Төсөв /ЗТАҮ*8%/', labelEn: 'Cost estimate /design fee×8%/', pct: 8 },
];

/**
 * Хэлээс хамаарсан шошго: англи хуудсанд (`quotes.lang === 'en'`) `labelEn`
 * (байвал), эс бөгөөс `label`. Цэсний харагдац ба нүдэнд бичигдэх бичвэр
 * ХОЁУЛАА үүгээр гарна — гараар нэмсэн (labelEn-гүй) зүйл хэл үл харгалзан
 * өөрийн шошгоороо үлдэнэ.
 */
export function itemLabel(
  item: { label: string; labelEn?: string },
  lang: QuoteLang = 'mn',
): string {
  return lang === 'en' ? (item.labelEn ?? item.label) : item.label;
}

/** Мөрийн нийт дүнгийн багана — сүүлчийн нэмэгдлийн яг баруун талд. */
export function addonTotalCol(spec: AddonSpec): number {
  return spec.baseCol + spec.items.length + 1;
}

/** `key`-ийн багана (идэвхгүй бол `-1`). */
export function addonColOf(spec: AddonSpec, key: string): number {
  const i = spec.items.findIndex((x) => x.key === key);
  return i < 0 ? -1 : spec.baseCol + 1 + i;
}

export function isAddonActive(sheet: SheetDoc, key: string): boolean {
  return !!sheet.addons?.items.some((x) => x.key === key);
}

/* ------------------------------------------------------------------ */
/*  Тусламжууд                                                         */
/* ------------------------------------------------------------------ */

const NUM_STYLE = { align: 'right', border: true } as const;
const HDR_STYLE = {
  bold: true,
  align: 'center',
  bg: 'header',
  border: true,
  wrap: true,
} as const;

/** Мөрийн нийт дүнгийн томьёог одоогийн нэмэгдлүүдээр дахин угсарна. */
function totalFormula(spec: AddonSpec, r: number): string {
  const cols = [spec.baseCol, ...spec.items.map((_, i) => spec.baseCol + 1 + i)];
  return `=${cols.map((c) => coordToRef(r, c)).join('+')}`;
}

/**
 * Нийт дүнгийн баганын томьёог мөр бүрд дахин бичнэ.
 *
 * ⚠️ Зөвхөн ТОМЬЁОТОЙ нүдийг дарж бичнэ — PM гараар тоо бичсэн (override хийсэн)
 * нүдийг хөндөхгүй.
 */
function rewriteTotals(sheet: SheetDoc, spec: AddonSpec): SheetDoc {
  const tc = addonTotalCol(spec);
  const patches: CellPatch[] = [];
  for (let r = spec.firstRow; r <= spec.lastRow; r += 1) {
    const cur = getCell(sheet, r, tc);
    if (!cur?.f) continue;
    patches.push({ r, c: tc, cell: { ...cur, f: totalFormula(spec, r) } });
  }
  return setCells(sheet, patches);
}

/** Бүлгийн толгойн merge-ийг нэмэгдэл багануудыг бүрэн хамруулж тэлнэ. */
function fitGroupHeader(sheet: SheetDoc, spec: AddonSpec): SheetDoc {
  if (spec.groupRow === undefined || spec.items.length === 0) return sheet;
  const first = spec.baseCol + 1;
  const last = spec.baseCol + spec.items.length;
  // Нэмэгдлийн мужтай огтлолцож буй бүлгийн merge-ийг олж дахин хэмжинэ.
  const merges = sheet.merges.map((m) => {
    if (m.r !== spec.groupRow || m.rs !== 1) return m;
    const mEnd = m.c + m.cs - 1;
    if (mEnd < first || m.c > last) return m;
    return { ...m, c: first, cs: last - first + 1 };
  });
  return { ...sheet, merges };
}

/* ------------------------------------------------------------------ */
/*  Асаах / унтраах                                                    */
/* ------------------------------------------------------------------ */

/**
 * Нэмэгдэл багана НЭМНЭ — сүүлчийн нэмэгдлийн дараа (нийт дүнгийн өмнө).
 * Толгой + мөр бүрийн `=<суурь>*N%` томьёо бичиж, нийт дүн ба бүлгийн толгойг
 * дагуулна. Аль хэдийн идэвхтэй бол юу ч хийхгүй.
 *
 * `lang` — англи хуудсанд (`'en'`) толгойд ч, spec-д ч `labelEn` бичигдэнэ,
 * ингэснээр цэс монгол бичвэрийг англи баримтад хэзээ ч оруулахгүй.
 */
export function addAddon(sheet: SheetDoc, item: AddonItem, lang: QuoteLang = 'mn'): SheetDoc {
  const spec = sheet.addons;
  if (!spec || spec.items.some((x) => x.key === item.key)) return sheet;

  const label = itemLabel(item, lang);
  // Англи хуудсанд spec-ийн item ч англи шошготой хадгалагдана — орчуулга
  // (`quoteTranslate`) items[].label-ийг яг ингэж бичдэг тул дахин асаахад
  // ялгаа гарахгүй.
  const stored: AddonItem = lang === 'en' ? { ...item, label } : item;

  const at = spec.baseCol + spec.items.length + 1; // нийт дүнгийн байрлал
  let next = insertCols(sheet, at, 1);
  // ⚠️ ШИЛЖСЭН spec-ээс үүсгэнэ, `spec`-ээс БИШ. `insertCols` нь
  // `shiftAddonSpec`-ээр `lines`/`costLines`/`sections`-ийн нүдний хаягуудыг
  // (baseRef/sumRef/totalRef/pctCol…) шинэ багана руу зөв шилжүүлсэн байдаг;
  // хуучин `spec`-ээр дарж бичвэл тэдгээр хаяг ХОЦРОГДОЖ, дараагийн мөрийн
  // toggle нь буруу баганаас уншиж НИЙТ ДҮН-г `#ХАСАГДСАН!` болгоно.
  const nextSpec: AddonSpec = { ...(next.addons ?? spec), items: [...spec.items, stored] };
  next = { ...next, addons: nextSpec };

  const patches: CellPatch[] = [
    { r: spec.headerRow, c: at, cell: { v: label, s: { ...HDR_STYLE } } },
  ];
  for (let r = spec.firstRow; r <= spec.lastRow; r += 1) {
    // Тухайн мөрд суурь нүд нь томьёо/утгагүй бол ч томьёог тавина — хожим
    // бөглөхөд ажиллана (хоосон суурь = 0).
    patches.push({
      r,
      c: at,
      cell: {
        f: `=${coordToRef(r, spec.baseCol)}*${item.pct}%`,
        fmt: '#,##0',
        s: { ...NUM_STYLE },
      } as SheetCell,
    });
  }
  next = setCells(next, patches);
  next = rewriteTotals(next, nextSpec);
  return fitGroupHeader(next, nextSpec);
}

/**
 * Нэмэгдэл баганыг УСТГАНА. Нийт дүн ба бүлгийн толгой автоматаар агшина.
 * (`deleteCols` нь бусад бүх томьёоны лавлагааг зөв шилжүүлнэ.)
 */
export function removeAddon(sheet: SheetDoc, key: string): SheetDoc {
  const spec = sheet.addons;
  if (!spec) return sheet;
  const idx = spec.items.findIndex((x) => x.key === key);
  if (idx < 0) return sheet;

  const at = spec.baseCol + 1 + idx;
  let next = deleteCols(sheet, at, 1);
  // ⚠️ `addAddon`-тай ижил шалтгаан: `deleteCols`-ийн шилжүүлсэн spec-ийг л
  // үндэс болгоно (тэр нь устсан баганы item-ийг аль хэдийн хассан байдаг).
  const shifted = next.addons ?? spec;
  const nextSpec: AddonSpec = {
    ...shifted,
    items: shifted.items.filter((x) => x.key !== key),
  };
  next = { ...next, addons: nextSpec };
  next = rewriteTotals(next, nextSpec);
  return fitGroupHeader(next, nextSpec);
}

export function toggleAddon(sheet: SheetDoc, item: AddonItem, lang: QuoteLang = 'mn'): SheetDoc {
  return isAddonActive(sheet, item.key)
    ? removeAddon(sheet, item.key)
    : addAddon(sheet, item, lang);
}

/**
 * Шошгонд ШИНГЭСЭН хувийг сольж бичнэ: «Хөргөлт 5%» → «Хөргөлт 7%»,
 * «BMS /ЗТАҮ*6%/» → «BMS /ЗТАҮ*7%/».
 *
 * ⚠️ Зөвхөн ЭХНИЙ «тоо%» токеныг солино — үлдсэн бичвэрийг хөндөхгүй тул PM
 * толгойг гараар өөрөөр нэрлэсэн байсан ч тэр нэр хадгалагдана. Хувь агуулаагүй
 * шошго (жишээ нь зүгээр «Хөргөлт») ӨӨРЧЛӨГДӨХГҮЙ — санамсаргүй «7%» наахаас
 * татгалзсан нь зориуд: шошго бол PM-ийн бичвэр, бид зөвхөн хуучирсан тоог
 * шинэчилнэ.
 */
function relabelPct(label: string, pct: number): string {
  return label.replace(/\d+(?:[.,]\d+)?\s*%/, `${pct}%`);
}

/**
 * Нэмэгдлийн ХУВИЙГ солино — тухайн баганын бүх мөрийн томьёог дахин бичнэ.
 *
 * Хувь нь баганын томьёонд шингэдэг (`=<суурь>*N%`, мөр бүрд тусдаа хувийн нүд
 * БАЙХГҮЙ) тул засварыг цэснээс хийнэ — `setSectionPct`-тэй ижил зарчим.
 * `pct` нь ХУВЬ (6 = 6%), бутархай биш.
 *
 * ⚠️ ТОЛГОЙН ШОШГЫГ ЗААВАЛ ДАГУУЛНА. Шошгод хувь нь бичвэрээр шингэсэн байдаг
 * («Хөргөлт 5%») тул зөвхөн томьёог сольвол хүснэгт «5%» гэж бичээд 7%-иар
 * тооцох ЧИМЭЭГҮЙ зөрчил үүснэ — үнийн баримт дээр энэ нь хамгийн аюултай
 * төрлийн алдаа. Загварын шошгоос БИШ, нүдэнд ОДОО байгаа бичвэрээс сольдог.
 *
 * ⚠️ Зөвхөн ТОМЬЁОТОЙ нүдийг дарж бичнэ — PM гараар тоо бичсэн (тухайн барилгад
 * хамаарахгүй гэж цэвэрлэсэн эсвэл өөр дүн тавьсан) нүд хөндөгдөхгүй.
 */
export function setAddonPct(sheet: SheetDoc, key: string, pct: number): SheetDoc {
  const spec = sheet.addons;
  if (!spec || !Number.isFinite(pct)) return sheet;
  const idx = spec.items.findIndex((x) => x.key === key);
  if (idx < 0) return sheet;

  const col = spec.baseCol + 1 + idx;
  const patches: CellPatch[] = [];

  for (let r = spec.firstRow; r <= spec.lastRow; r += 1) {
    const prev = getCell(sheet, r, col);
    if (!prev?.f) continue; // гараар бичсэн override — бүү хөнд
    patches.push({
      r,
      c: col,
      cell: { ...prev, v: undefined, f: `=${coordToRef(r, spec.baseCol)}*${pct}%` },
    });
  }

  // Толгойн бичвэр дэх хувийг шинэчлэх.
  const head = getCell(sheet, spec.headerRow, col);
  const headText = typeof head?.v === 'string' ? head.v : undefined;
  if (headText !== undefined) {
    const next = relabelPct(headText, pct);
    if (next !== headText) patches.push({ r: spec.headerRow, c: col, cell: { ...head, v: next } });
  }

  const items = spec.items.map((x) =>
    x.key === key ? { ...x, pct, label: relabelPct(x.label, pct) } : x,
  );
  const withCells = setCells(sheet, patches);
  return { ...withCells, addons: { ...(withCells.addons as AddonSpec), items } };
}

/* ------------------------------------------------------------------ */
/*  Баримтын түвшний МӨРИЙН нэмэгдэл (хөнгөлөлт г.м.)                  */
/* ------------------------------------------------------------------ */

/**
 * Стандарт мөрийн нэмэгдэл.
 *
 * Хөнгөлөлт нь `sign: -1` — хувийн нүдэнд ЭЕРЭГ тоо (`10`) бичихэд томьёо нь
 * дүнг БУУРУУЛНА. Тэмдгийг хэрэглэгчид даалгавал «10» гэж бичээд санамсаргүй
 * НЭМЭГДҮҮЛЧИХДЭГ (хэрэглэгч 2026-07-24-нд илрүүлсэн).
 *
 * ⚠️ БАЙРЛАЛ (хэрэглэгчийн шийдвэр 2026-08-20): ХАСАХ мөр нь НИЙТ ДҮН-гийн
 * ЯГ ДООР сууж, «-180,000» гэсэн ХАСАГДАХ дүнг БИШ, хасагдсаны дараах ЭЦСИЙН
 * дүнг харуулна — захиалагч төлөх ёстой тоогоо шууд уншина. Тиймээс НИЙТ ДҮН
 * өөрөө хөнгөлөлтгүй хэвээр үлдэж, доод мөр нь
 * `=НИЙТ ДҮН − НИЙТ ДҮН*ABS(хувь)%` гэж ТҮҮНЭЭС тооцогдоно; хувь нь тусдаа
 * ЗАСАГДАХ нүдэнд суух тул PM тоог сольмогц дүн шууд дахин бодогдоно.
 */
export const STANDARD_LINE_ADDONS: readonly AddonItem[] = [
  { key: 'discount', label: 'ХӨНГӨЛӨЛТ', labelEn: 'DISCOUNT', pct: 10, sign: -1 },
];

export function isLineAddonActive(sheet: SheetDoc, key: string): boolean {
  return !!sheet.addons?.lines?.items.some((x) => x.key === key);
}

/**
 * НИЙТ ДҮН-гийн ДООРХ эцсийн мөрийн шошго («ХӨНГӨЛӨЛТ ХАССАН НИЙТ ДҮН»).
 *
 * ⚠️ Гарах ХОЁУЛАН бичвэр нь `backend/src/lib/quoteTranslate.ts`-ийн
 * `QUOTE_MN_EN_DICT`-д БАЙТААРАА байх ЁСТОЙ — англи хувилбар үүсгэхэд орчуулга
 * нь цэснээс дахин нэмсэнтэй яг ижил мөр гаргах ёстой (толь ↔ `labelEn` ихрийн
 * дүрэм).
 */
function netLabel(item: { label: string; labelEn?: string }, lang: QuoteLang): string {
  return lang === 'en'
    ? `TOTAL AFTER ${item.labelEn ?? item.label}`
    : `${item.label} ХАССАН НИЙТ ДҮН`;
}

/** НИЙТ ДҮН-гийн ДООР сууж буй мөрийн түлхүүр (байвал). */
function belowKeyOf(lines: LineAddonSpec): string | undefined {
  return lines.finalRef ? lines.finalKey : undefined;
}

/** НИЙТ ДҮН-гийн ДЭЭР сууж буй мөрүүд — доод мөр тооллогоос гарна. */
function aboveItems(lines: LineAddonSpec): AddonItem[] {
  const bk = belowKeyOf(lines);
  return bk === undefined ? [...lines.items] : lines.items.filter((x) => x.key !== bk);
}

/** Дээд мөрийн нэмэгдлүүд `totalRef`-ийн яг дээр дараалан сууна. */
function lineRowOf(totalRow: number, count: number, index: number): number {
  return totalRow - count + index;
}

/**
 * «Тайлбар: … нийт дүн ₮…» өгүүлбэрийг өөр нүд рүү заалгана.
 *
 * Тэр өгүүлбэр бол баримтын дүнг ҮСГЭЭР бичсэн ГАНЦ мөр. Хөнгөлөлт үйлчилж
 * байхад хөнгөлөлтгүй дүнг бичвэл нэг баримт дээр ХОЁР өөр «нийт дүн» гарч,
 * аль нь үнэн болох нь тодорхойгүй болно. Зөвхөн `USGEER(` агуулсан томьёог
 * (загварын тайлбарын мөр) хөндөнө.
 */
function retargetNote(sheet: SheetDoc, from: string, to: string): SheetDoc {
  if (from === to) return sheet;
  // Лавлагааг БҮТНЭЭР нь тааруулна: `Z39` нь `Z390`-ийн ч, `ИГС!Z39`-ийн ч
  // хэсэг байж болохгүй ($1 нь урд талын тэмдэгтийг буцааж тавина).
  const re = new RegExp(`([^A-Za-z0-9_!]|^)${from}(?![0-9A-Za-z])`, 'g');
  const patches: CellPatch[] = [];
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (!cell?.f || !cell.f.includes('USGEER(')) continue;
    const f = cell.f.replace(re, `$1${to}`);
    if (f === cell.f) continue;
    const co = refToCoord(ref);
    if (co) patches.push({ r: co.r, c: co.c, cell: { ...cell, f } });
  }
  return patches.length > 0 ? setCells(sheet, patches) : sheet;
}

/**
 * Мөрийн нэмэгдэл НЭМНЭ.
 *
 *   • ХАСАХ мөр (`sign: -1` — хөнгөлөлт): НИЙТ ДҮН-гийн ЯГ ДООР шинэ мөр орж,
 *     ХАСАГДСАНЫ ДАРААХ эцсийн дүнг харуулна. НИЙТ ДҮН-гийн томьёо
 *     ХӨНДӨГДӨХГҮЙ (доод мөр түүнээс тооцогдоно), харин баримтын `total`
 *     anchor доод мөр рүү шилжинэ — жагсаалт, PDF, XLSX, MCP бүгд захиалагчийн
 *     ТӨЛӨХ дүнг уншина.
 *   • Нэмэгдүүлэх мөр: хуучин зан төлөв — НИЙТ ДҮН-гийн ДЭЭР орж, НИЙТ ДҮН-гийн
 *     томьёонд гишүүн болно.
 *
 * Хувь нь ХОЁУЛАНД нь томьёонд ШИНГЭЭГҮЙ, тусдаа нүдэнд сууна
 * (`=Z39-Z39*ABS(Y40)%`) — PM зөвхөн тэр тоог сольж хөнгөлөлтөө өөрчилнө.
 */
export function addLineAddon(sheet: SheetDoc, item: AddonItem, lang: QuoteLang = 'mn'): SheetDoc {
  const spec = sheet.addons;
  const lines = spec?.lines;
  if (!spec || !lines || lines.items.some((x) => x.key === item.key)) return sheet;
  const totalCo = refToCoord(lines.totalRef);
  if (!totalCo) return sheet;

  // Доод мөр ГАНЦ — аль хэдийн эзэлсэн бол дараагийн хасах мөр хуучнаараа
  // (НИЙТ ДҮН-гийн ДЭЭР) орно.
  const below = item.sign === -1 && !lines.finalRef;
  const label = below ? netLabel(item, lang) : itemLabel(item, lang);
  const stored: AddonItem = lang === 'en' ? { ...item, label } : item;

  const at = below ? totalCo.r + 1 : totalCo.r; // дээд мөр үед НИЙТ ДҮН доошилно
  let next = insertRows(sheet, at, 1);
  const nl = next.addons?.lines;
  if (!nl) return sheet;
  const newTotalCo = refToCoord(nl.totalRef);
  if (!newTotalCo) return sheet;

  const amountCol = newTotalCo.c;
  const pctCol = Math.max(0, amountCol - 1);
  const pctRef = coordToRef(at, pctCol);
  const amountRef = coordToRef(at, amountCol);
  const totalRef = coordToRef(newTotalCo.r, amountCol);

  // Дүнг бууруулж буй мөр УЛААН (danger) — НИЙТ ДҮН-гийн өнгөтэй ижил.
  const reduces = item.sign === -1;
  const tone = reduces ? ('danger' as const) : ('default' as const);
  // Тэмдгийг ТОМЬЁО эзэмшинэ: хэрэглэгч `10` бичсэн ч хасах чиглэлд үйлчилнэ.
  const amountFormula = below
    ? `=${totalRef}-${totalRef}*ABS(${pctRef})%`
    : reduces
      ? `=-${nl.baseRef}*ABS(${pctRef})%`
      : `=${nl.baseRef}*${pctRef}%`;
  next = setCells(next, [
    {
      r: at,
      c: 0,
      cell: { v: label, s: { bold: true, align: 'right', border: true, color: tone } },
    },
    {
      r: at,
      c: pctCol,
      // Хувь нь ТООН нүд (`10`) — `0%` формат биш, эс бөгөөс PM «10» гэж
      // бичихэд 1000% гэж ойлгогдоно. Томьёо нь `…*ABS(P19)%` гэж хувь болгоно.
      cell: { v: item.pct, s: { align: 'center', border: true, color: tone } },
    },
    {
      r: at,
      c: amountCol,
      cell: {
        f: amountFormula,
        fmt: '#,##0',
        s: { bold: true, align: 'right', border: true, color: tone },
      },
    },
  ]);
  // Шошгыг хувийн нүд хүртэл нэгтгэнэ (нарийн хуудсанд merge гарахгүй).
  if (pctCol >= 1) {
    next = { ...next, merges: [...next.merges, { r: at, c: 0, rs: 1, cs: pctCol }] };
  }

  if (below) {
    // Үсгээр бичсэн тайлбар мөн эцсийн дүнг заана.
    next = retargetNote(next, totalRef, amountRef);
    // Баримтын дүн = захиалагчийн ТӨЛӨХ дүн.
    next = setAnchor(next, 'total', at, amountCol);
  } else {
    // НИЙТ ДҮН-гийн томьёонд шинэ гишүүнийг нэмнэ.
    const totalCell = getCell(next, newTotalCo.r, amountCol);
    if (totalCell?.f) {
      next = setCells(next, [
        { r: newTotalCo.r, c: amountCol, cell: { ...totalCell, f: `${totalCell.f}+${amountRef}` } },
      ]);
    }
  }

  const nextLines: LineAddonSpec = {
    ...(next.addons?.lines ?? nl),
    items: [...nl.items, stored],
  };
  if (below) {
    nextLines.finalRef = amountRef;
    nextLines.finalKey = item.key;
  }
  return { ...next, addons: { ...(next.addons as AddonSpec), lines: nextLines } };
}

/** Мөрийн нэмэгдлийг устгана — лавлагааг эхлээд салгаж байж мөрийг устгана. */
export function removeLineAddon(sheet: SheetDoc, key: string): SheetDoc {
  const spec = sheet.addons;
  const lines = spec?.lines;
  if (!spec || !lines || !lines.items.some((x) => x.key === key)) return sheet;
  const totalCo = refToCoord(lines.totalRef);
  if (!totalCo) return sheet;

  const amountCol = totalCo.c;
  const totalRef = coordToRef(totalCo.r, amountCol);
  const below = belowKeyOf(lines) === key;

  let row: number;
  if (below) {
    const finalCo = lines.finalRef ? refToCoord(lines.finalRef) : undefined;
    if (!finalCo) return sheet;
    row = finalCo.r;
  } else {
    const above = aboveItems(lines);
    const idx = above.findIndex((x) => x.key === key);
    if (idx < 0) return sheet;
    row = lineRowOf(totalCo.r, above.length, idx);
  }
  const amountRef = coordToRef(row, amountCol);

  // ⚠️ Мөрийг устгахаас ӨМНӨ бүх лавлагааг салгана — эс бөгөөс `deleteRows`
  // тэдгээрийг `#ХАСАГДСАН!` болгож НИЙТ ДҮН / тайлбар эвдэрнэ.
  let next = sheet;
  if (below) {
    next = retargetNote(next, amountRef, totalRef);
  } else {
    const totalCell = getCell(sheet, totalCo.r, amountCol);
    if (totalCell?.f) {
      const stripped = totalCell.f.replace(new RegExp(`\\+\\s*${amountRef}(?![0-9A-Za-z])`), '');
      next = setCells(next, [{ r: totalCo.r, c: amountCol, cell: { ...totalCell, f: stripped } }]);
    }
  }
  next = deleteRows(next, row, 1);
  // Anchor устсан мөртэй хамт арилсан — НИЙТ ДҮН рүү нь буцаана (тэр мөр дээр
  // байсан тул байрлал өөрчлөгдөөгүй).
  if (below) next = setAnchor(next, 'total', totalCo.r, amountCol);

  const nl = next.addons?.lines;
  if (!nl) return next;
  const nextLines: LineAddonSpec = { ...nl, items: nl.items.filter((x) => x.key !== key) };
  if (below) {
    delete nextLines.finalRef;
    delete nextLines.finalKey;
  }
  return { ...next, addons: { ...(next.addons as AddonSpec), lines: nextLines } };
}

export function toggleLineAddon(
  sheet: SheetDoc,
  item: AddonItem,
  lang: QuoteLang = 'mn',
): SheetDoc {
  return isLineAddonActive(sheet, item.key)
    ? removeLineAddon(sheet, item.key)
    : addLineAddon(sheet, item, lang);
}

/* ------------------------------------------------------------------ */
/*  ДҮН-д ордог ЗАРДЛЫН мөрүүд                                          */
/* ------------------------------------------------------------------ */

/** Нэгжийн dropdown — зардлын мөрийн `qty` төрөлд. */
const UNIT_CHOICES = ['м²', 'га', 'цооног', 'тм', 'ш'];
/**
 * Англи хуудасны нэгжүүд — орчуулгын толийн (м²→m², га→ha, цооног→borehole,
 * тм→lin.m, ш→pcs) яг мөрүүд, дараалал нь `UNIT_CHOICES`-тэй ижил.
 */
const UNIT_CHOICES_EN = ['m²', 'ha', 'borehole', 'lin.m', 'pcs'];
/** Нэгжийн МН→EN хөрвүүлэлт — толинд байхгүй нэгж хэвээрээ үлдэнэ. */
const UNIT_EN: Record<string, string> = {
  'м²': 'm²',
  га: 'ha',
  цооног: 'borehole',
  тм: 'lin.m',
  ш: 'pcs',
};

/**
 * Стандарт зардлын мөрүүд — MGL-ийн хяналтын төсвийн бүтцээс.
 * `percent` нь `costLines.baseRef` (ажлын зургийн үнийн нийт дүн)-ээс тооцогдоно.
 */
export const STANDARD_COST_LINES: readonly CostLineItem[] = [
  {
    key: 'sketch',
    label: 'Эскиз зургийн үнэ /АЗ*15%/',
    labelEn: 'Concept design fee /WD×15%/',
    kind: 'percent',
    pct: 15,
  },
  {
    key: 'masterplan',
    label: 'Ерөнхий төлөвлөгөө барилгажилтын төсөв',
    labelEn: 'Master plan development budget',
    kind: 'qty',
    unit: 'га',
  },
  {
    key: 'landscape',
    label: 'Гадна тохижилтын зураг төсөл',
    labelEn: 'Landscaping design',
    kind: 'qty',
    unit: 'га',
  },
  // Нэгж үнийг PM гараар бичнэ. (Өмнө нь тусдаа «ИГС» хуудсаас `=ИГС!G14` гэж
  // хөндлөн лавлагаагаар татдаг байсныг 2026-07-24-нд хэрэглэгч хассан.)
  {
    key: 'geology',
    label: 'Инженер геологийн судалгаа',
    labelEn: 'Geotechnical investigation',
    kind: 'qty',
    unit: 'цооног',
  },
  {
    key: 'topography',
    label: 'Топографийн зураглал',
    labelEn: 'Topographic survey',
    kind: 'qty',
    unit: 'га',
  },
  {
    key: 'emergency',
    label: 'Онцгой байдлын хяналтын зардал',
    labelEn: 'Emergency Management Agency review fee',
    kind: 'flat',
  },
  {
    key: 'expertise',
    label: 'Улсын экспертизийн зардал /АЗ*8%/',
    labelEn: 'State expertise review fee /WD×8%/',
    kind: 'percent',
    pct: 8,
  },
];

export function isCostLineActive(sheet: SheetDoc, key: string): boolean {
  return !!sheet.addons?.costLines?.items.some((x) => x.key === key);
}

/**
 * Зардлын мөр НЭМНЭ — ДҮН-гийн яг дээр мөр оруулж, төрлөөс нь хамааран
 * (хувь / тоо×үнэ / шууд дүн) нүднүүдийг бичээд ДҮН-гийн томьёонд нэмнэ.
 */
export function addCostLine(sheet: SheetDoc, item: CostLineItem, lang: QuoteLang = 'mn'): SheetDoc {
  const spec = sheet.addons;
  const cl = spec?.costLines;
  if (!spec || !cl || cl.items.some((x) => x.key === item.key)) return sheet;
  const sumCo = refToCoord(cl.sumRef);
  if (!sumCo) return sheet;

  // Англи хуудсанд шошго, нэгж, нэгжийн dropdown БҮГД англиар — цэс монгол
  // бичвэрийг англи баримтад оруулах ёсгүй (орчуулгын толийн мөрүүд).
  const label = itemLabel(item, lang);
  const unit = lang === 'en' ? (UNIT_EN[item.unit ?? ''] ?? item.unit ?? '') : (item.unit ?? '');
  const unitChoices = lang === 'en' ? UNIT_CHOICES_EN : UNIT_CHOICES;
  const stored: CostLineItem =
    lang === 'en' ? { ...item, label, ...(item.unit !== undefined ? { unit } : {}) } : item;

  /**
   * Байрлалыг СТАНДАРТ дараалалаар сонгоно — эс бөгөөс унтрааж асаасан мөр
   * жагсаалтын сүүлд очиж, «Улсын экспертизийн зардал» дундуур орно.
   * Стандартад байхгүй (гараар нэмсэн) мөр эцэст нь очно.
   */
  const rank = (k: string) => {
    const i = STANDARD_COST_LINES.findIndex((x) => x.key === k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  let idx = cl.items.findIndex((x) => rank(x.key) > rank(item.key));
  if (idx < 0) idx = cl.items.length;

  const at = lineRowOf(sumCo.r, cl.items.length, idx); // энэ мөрөөс доош түлхэнэ
  let next = insertRows(sheet, at, 1);
  const nc = next.addons?.costLines;
  if (!nc) return sheet;
  const newSumCo = refToCoord(nc.sumRef);
  if (!newSumCo) return sheet;

  const amountCol = newSumCo.c;
  const amountRef = coordToRef(at, amountCol);
  const patches: CellPatch[] = [
    { r: at, c: nc.labelCol, cell: { v: label, s: { align: 'left', border: true, wrap: true } } },
  ];

  if (item.kind === 'percent') {
    patches.push({
      r: at,
      c: amountCol,
      cell: { f: `=${nc.baseRef}*${item.pct ?? 0}%`, fmt: '#,##0', s: { ...NUM_STYLE } },
    });
  } else if (item.kind === 'qty') {
    patches.push(
      {
        r: at,
        c: nc.unitCol,
        cell: { v: unit, choices: unitChoices, s: { align: 'center', border: true } },
      },
      { r: at, c: nc.qtyCol, cell: { v: '', fmt: '#,##0', s: { ...NUM_STYLE } } },
      {
        r: at,
        c: nc.priceCol,
        cell: item.priceFormula
          ? { f: item.priceFormula, fmt: '#,##0.00', s: { ...NUM_STYLE } }
          : { v: '', fmt: '#,##0', s: { ...NUM_STYLE } },
      },
      {
        r: at,
        c: amountCol,
        cell: {
          f: `=${coordToRef(at, nc.qtyCol)}*${coordToRef(at, nc.priceCol)}`,
          fmt: '#,##0',
          s: { ...NUM_STYLE },
        },
      },
    );
  } else {
    // flat — дүнг гараар бичнэ.
    patches.push({ r: at, c: amountCol, cell: { v: '', fmt: '#,##0', s: { ...NUM_STYLE } } });
  }
  next = setCells(next, patches);

  // ДҮН-гийн томьёонд шинэ гишүүнийг нэмнэ.
  const sumCell = getCell(next, newSumCo.r, amountCol);
  if (sumCell?.f) {
    next = setCells(next, [
      { r: newSumCo.r, c: amountCol, cell: { ...sumCell, f: `${sumCell.f}+${amountRef}` } },
    ]);
  }

  const items = [...nc.items];
  items.splice(idx, 0, stored);
  return { ...next, addons: { ...(next.addons as AddonSpec), costLines: { ...nc, items } } };
}

/** Зардлын мөрийг устгана — ДҮН-гийн томьёоноос гишүүнийг эхлээд хасна. */
export function removeCostLine(sheet: SheetDoc, key: string): SheetDoc {
  const spec = sheet.addons;
  const cl = spec?.costLines;
  if (!spec || !cl) return sheet;
  const idx = cl.items.findIndex((x) => x.key === key);
  if (idx < 0) return sheet;
  const sumCo = refToCoord(cl.sumRef);
  if (!sumCo) return sheet;

  const row = lineRowOf(sumCo.r, cl.items.length, idx);
  const amountCol = sumCo.c;
  const amountRef = coordToRef(row, amountCol);

  let next = sheet;
  const sumCell = getCell(sheet, sumCo.r, amountCol);
  if (sumCell?.f) {
    const stripped = sumCell.f.replace(new RegExp(`\\+\\s*${amountRef}(?![0-9A-Za-z])`), '');
    next = setCells(next, [{ r: sumCo.r, c: amountCol, cell: { ...sumCell, f: stripped } }]);
  }
  next = deleteRows(next, row, 1);

  const nc = next.addons?.costLines;
  if (!nc) return next;
  return {
    ...next,
    addons: {
      ...(next.addons as AddonSpec),
      costLines: { ...nc, items: nc.items.filter((x) => x.key !== key) },
    },
  };
}

export function toggleCostLine(
  sheet: SheetDoc,
  item: CostLineItem,
  lang: QuoteLang = 'mn',
): SheetDoc {
  return isCostLineActive(sheet, item.key)
    ? removeCostLine(sheet, item.key)
    : addCostLine(sheet, item, lang);
}

/* ------------------------------------------------------------------ */
/*  АЗ-ийн ХЭСГҮҮД — БД 81-16-20/2020, заалт 4.22.1, Хүснэгт 10        */
/* ------------------------------------------------------------------ */

/**
 * Зураг төслийн ажлын хэсгүүд — MGL-ийн мэргэжлийн БАГУУДААР.
 *
 * Код/нэр нь `teams` хүснэгтийн `code`/`name_mn`-тэй санаатай ижил (BA, BB,
 * HAS, TSBU, TSAH, HD, AU) — төслийн багийн хуваарь (`project_team_shares`)
 * болон энэ задаргаа НЭГ ҮГИЙН САНГААР ярина. `EZ`/`IZ`/`GT` багууд энд алга:
 * эскиз зураг ба гадна тохижилт нь аль хэдийн ЗАРДЛЫН МӨР.
 *
 * ⚠️ `pct` нь АНХДАГЧ утга — MGL-ийн бодит хуваарь (2026-08-05, нийлбэр яг
 * 100%). Хэрэглэгч «Хэсэг» цэснээс хувь бүрийг ЗАСНА (`setSectionPct`), тэр нь
 * тухайн баганы бүх томьёог дахин бичнэ.
 *
 * ⚠️ Нийлбэр 100% байх ШААРДЛАГАГҮЙ: гэрээнд хамрагдах хэсгүүдийг л сонгодог
 * тул унтраахад 100%-иас бага болох нь ХЭВИЙН.
 */
export const STANDARD_SECTIONS: readonly SectionItem[] = [
  { key: 'ba', label: 'Барилга архитектур', labelEn: 'Architecture', code: 'BA', pct: 30 },
  { key: 'bb', label: 'Барилга бүтэц', labelEn: 'Structural engineering', code: 'BB', pct: 32 },
  {
    key: 'has',
    label: 'Халаалт агаар сэлгэлт',
    labelEn: 'Heating and ventilation',
    code: 'HAS',
    pct: 11,
  },
  {
    key: 'tsbu',
    label: 'Цэвэр бохир ус',
    labelEn: 'Water supply and sewerage',
    code: 'TSBU',
    pct: 8,
  },
  { key: 'tsah', label: 'Цахилгаан хангамж', labelEn: 'Power supply', code: 'TSAH', pct: 10 },
  {
    key: 'hd',
    label: 'Холбоо дохиолол',
    labelEn: 'Communications and alarm systems',
    code: 'HD',
    pct: 5,
  },
  { key: 'au', label: 'Автомат удирдлага', labelEn: 'Building automation', code: 'AU', pct: 4 },
];

/** НИЙТ ҮНЭ-ний багана — сүүлчийн хэсгийн яг баруун талд. */
/**
 * Хэсгийн багануудын индекс — ХАРАГДАЦААС нуухад (`SheetGrid.hiddenCols`).
 *
 * ⚠️ Нуух нь УСТГАХААС зарчмын ялгаатай: хэсгийн багана нь ДҮН-г жолооддог
 * (`costLines.baseRef === sections.sumRef`) тул устгавал үнэ өөрчлөгдөнө.
 * Энэ функц зөвхөн зурагдахгүй болгоход хэрэглэгдэнэ — томьёо бүрэн ажилласаар.
 */
export function sectionCols(sheet: SheetDoc): number[] {
  const spec = sheet.addons?.sections;
  if (!spec) return [];
  return spec.items.map((_, i) => spec.baseCol + 1 + i);
}

export function sectionTotalCol(spec: SectionSpec): number {
  return spec.baseCol + spec.items.length + 1;
}

/** `key`-ийн багана (идэвхгүй бол `-1`). */
export function sectionColOf(spec: SectionSpec, key: string): number {
  const i = spec.items.findIndex((x) => x.key === key);
  return i < 0 ? -1 : spec.baseCol + 1 + i;
}

export function isSectionActive(sheet: SheetDoc, key: string): boolean {
  return !!sheet.addons?.sections?.items.some((x) => x.key === key);
}

/** Идэвхтэй хувиудын нийлбэр — зөвхөн МЭДЭЭЛЭЛ (100%-иас бага байж болно). */
export function sectionPctTotal(sheet: SheetDoc): number {
  const sec = sheet.addons?.sections;
  if (!sec) return 0;
  return sec.items.reduce((acc: number, x: SectionItem) => acc + (x.pct ?? 0), 0);
}

/** Хасагдсан (идэвхгүй) стандарт хэсгүүд — тайлбар болон цэст хэрэглэнэ. */
export function missingSections(spec: SectionSpec): SectionItem[] {
  return STANDARD_SECTIONS.filter((s) => !spec.items.some((x) => x.key === s.key));
}

/**
 * Хасагдсан хэсгүүдийн ТАЙЛБАР — хэвлэмэлд хэсгийн багана нуугддаг тул
 * захиалагч «юу, хэдэн хувиар хасагдсаныг» зөвхөн эндээс мэдэнэ.
 *
 * Англи хуудсанд бүхэлдээ англиар: `Excluded disciplines: … . Total −N%.`
 */
function sectionNoteText(spec: SectionSpec, lang: QuoteLang = 'mn'): string {
  const gone = missingSections(spec);
  if (gone.length === 0) return '';
  const parts = gone.map((s) => `${itemLabel(s, lang)} −${s.pct ?? 0}%`);
  const cut = gone.reduce((acc: number, s: SectionItem) => acc + (s.pct ?? 0), 0);
  return lang === 'en'
    ? `Excluded disciplines: ${parts.join(', ')}. Total −${cut}%.`
    : `Хасагдсан хэсэг: ${parts.join(', ')}. Нийт −${cut}%.`;
}

/** Тайлбарын нүдийг шинэчилнэ (`noteRef` тодорхойлогдсон үед). */
function writeSectionNote(sheet: SheetDoc, spec: SectionSpec, lang: QuoteLang = 'mn'): SheetDoc {
  if (!spec.noteRef) return sheet;
  const co = refToCoord(spec.noteRef);
  if (!co) return sheet;
  const prev = getCell(sheet, co.r, co.c) ?? {};
  return setCells(sheet, [
    {
      r: co.r,
      c: co.c,
      cell: { ...prev, f: undefined, v: sectionNoteText(spec, lang), s: { ...prev.s, wrap: true } },
    },
  ]);
}

/** Нэг хэсгийн баганын томьёо: суурь × хувь. */
function sectionCellFormula(baseCol: number, r: number, pct: number): string {
  return `=${coordToRef(r, baseCol)}*${pct}%`;
}

/**
 * НИЙТ ҮНЭ баганыг хэсгүүдийн НИЙЛБЭР болгож дахин бичнэ.
 *
 * ⚠️ `rewriteTotals` (нэмэгдэл)-ээс ЯЛГААТАЙ: нэмэгдэл нь суурь+нэмэгдлүүдийг
 * нэмдэг бол энд НИЙТ ҮНЭ = зөвхөн хэсгүүдийн нийлбэр. Тиймээс хэсэг унтраахад
 * тухайн хувиар шууд буурна. Хэсэг үлдээгүй бол `=0`.
 */
function rewriteSectionTotals(sheet: SheetDoc, spec: SectionSpec): SheetDoc {
  const totalCol = sectionTotalCol(spec);
  const cols = spec.items.map((_x: SectionItem, i: number) => spec.baseCol + 1 + i);
  const rows: number[] = [];
  for (let r = spec.firstRow; r <= spec.lastRow; r += 1) rows.push(r);
  rows.push(spec.sumRow);

  const patches: CellPatch[] = rows.map((r) => {
    const prev = getCell(sheet, r, totalCol) ?? {};
    const f = cols.length > 0 ? `=${cols.map((c) => coordToRef(r, c)).join('+')}` : '=0';
    return { r, c: totalCol, cell: { ...prev, v: undefined, f, fmt: prev.fmt ?? '#,##0' } };
  });
  return setCells(sheet, patches);
}

/** Бүлгийн толгойн merge-ийг хэсгийн багануудын тоонд тааруулна. */
function fitSectionGroupHeader(sheet: SheetDoc, spec: SectionSpec): SheetDoc {
  if (spec.groupRow === undefined || spec.items.length === 0) return sheet;
  const from = spec.baseCol + 1;
  const cs = spec.items.length;
  const merges = sheet.merges
    .filter((m) => !(m.r === spec.groupRow && m.c === from))
    .concat([{ r: spec.groupRow, c: from, rs: 1, cs }]);
  return { ...sheet, merges };
}

/**
 * Хэсгийн БАГАНА нэмнэ — НИЙТ ҮНЭ-ний өмнө багана оруулж, толгой + мөр бүрийн
 * томьёог бичээд НИЙТ ҮНЭ-г дахин барина.
 *
 * Байрлалыг СТАНДАРТ дараалалаар сонгоно, эс бөгөөс унтрааж асаасан хэсэг
 * жагсаалтын сүүлд очно.
 */
export function addSection(sheet: SheetDoc, item: SectionItem, lang: QuoteLang = 'mn'): SheetDoc {
  const spec = sheet.addons?.sections;
  if (!spec || spec.items.some((x) => x.key === item.key)) return sheet;

  // Англи хуудсанд толгойд ч, spec-д ч `labelEn` (addAddon-той ижил гэрээ).
  const label = itemLabel(item, lang);
  const stored: SectionItem = lang === 'en' ? { ...item, label } : item;

  const rank = (k: string) => {
    const i = STANDARD_SECTIONS.findIndex((x) => x.key === k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  let idx = spec.items.findIndex((x) => rank(x.key) > rank(item.key));
  if (idx < 0) idx = spec.items.length;

  const at = spec.baseCol + 1 + idx;
  let next = insertCols(sheet, at, 1);
  const shifted = next.addons?.sections ?? spec;
  const items = [...spec.items];
  items.splice(idx, 0, stored);
  const nextSec: SectionSpec = { ...shifted, items };
  next = { ...next, addons: { ...(next.addons as AddonSpec), sections: nextSec } };

  // Баганы толгойд ЗӨВХӨН нэр — код (`/BA/`) нь баримт дээр илүүц (хэрэглэгчийн
  // шийдвэр 2026-08-05). Код нь «Хэсэг» цэсэнд л үлдэнэ, тэнд багтай тааруулахад
  // хэрэгтэй.
  const patches: CellPatch[] = [
    { r: nextSec.headerRow, c: at, cell: { v: label, s: { ...HDR_STYLE } } },
  ];
  for (let r = nextSec.firstRow; r <= nextSec.lastRow; r += 1) {
    patches.push({
      r,
      c: at,
      cell: {
        f: sectionCellFormula(nextSec.baseCol, r, item.pct ?? 0),
        fmt: '#,##0',
        s: { ...NUM_STYLE },
      } as SheetCell,
    });
  }
  // Нийлбэрийн мөр — тухайн баганын SUM.
  patches.push({
    r: nextSec.sumRow,
    c: at,
    cell: {
      f: `=SUM(${coordToRef(nextSec.firstRow, at)}:${coordToRef(nextSec.lastRow, at)})`,
      fmt: '#,##0',
      s: { bold: true, align: 'right', bg: 'group', border: true },
    } as SheetCell,
  });
  next = setCells(next, patches);
  next = rewriteSectionTotals(next, nextSec);
  next = writeSectionNote(next, nextSec, lang);
  return fitSectionGroupHeader(next, nextSec);
}

/** Хэсгийн БАГАНЫГ устгана — НИЙТ ҮНЭ автоматаар агшина. */
export function removeSection(sheet: SheetDoc, key: string, lang: QuoteLang = 'mn'): SheetDoc {
  const spec = sheet.addons?.sections;
  if (!spec) return sheet;
  const idx = spec.items.findIndex((x) => x.key === key);
  if (idx < 0) return sheet;

  const at = spec.baseCol + 1 + idx;
  let next = deleteCols(sheet, at, 1);
  const shifted = next.addons?.sections ?? spec;
  const nextSec: SectionSpec = {
    ...shifted,
    items: shifted.items.filter((x) => x.key !== key),
  };
  next = { ...next, addons: { ...(next.addons as AddonSpec), sections: nextSec } };
  next = rewriteSectionTotals(next, nextSec);
  next = writeSectionNote(next, nextSec, lang);
  return fitSectionGroupHeader(next, nextSec);
}

export function toggleSection(sheet: SheetDoc, item: SectionItem, lang: QuoteLang = 'mn'): SheetDoc {
  return isSectionActive(sheet, item.key)
    ? removeSection(sheet, item.key, lang)
    : addSection(sheet, item, lang);
}

/**
 * Хэсгийн ХУВИЙГ солино — тухайн баганын бүх томьёог дахин бичнэ.
 *
 * Хувь нь баганын томьёонд шингэдэг (мөр бүрд нүд байхгүй) тул засварыг цэснээс
 * хийнэ. `pct` нь ХУВЬ (30 = 30%), бутархай биш.
 */
export function setSectionPct(
  sheet: SheetDoc,
  key: string,
  pct: number,
  lang: QuoteLang = 'mn',
): SheetDoc {
  const spec = sheet.addons?.sections;
  if (!spec || !Number.isFinite(pct)) return sheet;
  const idx = spec.items.findIndex((x) => x.key === key);
  if (idx < 0) return sheet;

  const col = spec.baseCol + 1 + idx;
  const patches: CellPatch[] = [];
  for (let r = spec.firstRow; r <= spec.lastRow; r += 1) {
    const prev = getCell(sheet, r, col) ?? {};
    patches.push({
      r,
      c: col,
      cell: { ...prev, v: undefined, f: sectionCellFormula(spec.baseCol, r, pct) },
    });
  }
  const items = spec.items.map((x) => (x.key === key ? { ...x, pct } : x));
  const nextSec: SectionSpec = { ...spec, items };
  let next = setCells(sheet, patches);
  next = { ...next, addons: { ...(next.addons as AddonSpec), sections: nextSec } };
  return writeSectionNote(next, nextSec, lang);
}

// ⚠️ `AddonSpec`-ийг мөр/багана шилжихэд дагуулах логик нь `sheetOps.ts`-д
// (`shiftAddonSpec`) — тэнд бусад шилжүүлэлттэй хамт байх нь зөв бөгөөд энэ
// файл `sheetOps`-оос импортолдог тул дугуй хамаарал үүсэхээс сэргийлнэ.
