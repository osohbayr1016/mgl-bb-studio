import { ceoUserId } from '../lib/ceo';
import { Hono } from 'hono';
import { launchBrowser, type BrowserSession } from '../lib/browser';
import { requireAdmin } from '../middleware/auth';
import { signToken } from '../lib/jwt';
import { normalizeVariantKeys, serializeVariantKeys } from '../lib/quoteVariants';
import {
  applyTranslations,
  collectTranslatables,
  needsAiTranslation,
  translateFreeText,
  translateStringsAi,
} from '../lib/quoteTranslate';
import { todayInUB } from '../lib/time';
import type { Env, AppVariables } from '../types';

/* =============================================================
 * /api/quotes — Үнийн санал v3 (олон хуудаст ажлын дэвтэр).
 * -------------------------------------------------------------
 * Баримт нь бүтэц-гүй, ЖИНХЭНЭ нүднүүдийн газрын зураг ба олон хуудас
 * (WorkbookDoc = { sheets: NamedSheet[]; anchors }): нүд бүр литерал утга
 * (`v`) эсвэл томьёо (`f`) агуулна, хуудас хоорондоо `=ИГС!G17`-оор
 * лавлана. Тооцоог КЛИЕНТ-ийн `lib/formula` хөдөлгүүр гүйцэтгэнэ — сервер
 * дэвтрийг ХЭЗЭЭ Ч дахин тооцоолохгүй (доорх PUT /:id-ийн тайлбарыг үз).
 *
 * ⚠️ Хадгалалт: `quotes.sheet_json` / `quote_templates.sheet_json` баганад
 * ХОЁР хэлбэр байж болно:
 *   • Шинэ (v3): WorkbookDoc = { sheets:[…], anchors:{…}, activeSheet }.
 *   • Хуучин (v2): ганц SheetDoc = { rows, cols, cells, merges, anchors }.
 * `parseWorkbook` хоёуланг уншиж үргэлж WorkbookDoc буцаана (frontend-ийн
 * `lib/workbook.ts` → `normalizeWorkbook`-ийн толь). Тусдаа migration
 * ХЭРЭГГҮЙ — зөвхөн уншихад ороогдоно.
 *
 * Гэрээний типүүд (SheetDoc / WorkbookDoc / TariffRow / Quote / QuoteTemplate …)
 * нь `frontend/src/features/quotes/types/quotes.ts`-д амьдардаг. Backend
 * тусдаа багц тул тэднийг импортлохгүй — доор ижил ХЭЛБЭРИЙГ давтсан.
 * Хэлбэр өөрчлөгдвөл хоёр талыг зэрэг засна.
 *
 * D1 схем: migration 0128 (quote_tariffs / quote_templates /
 * quote_template_history / quotes). v3-т схем ӨӨРЧЛӨГДӨХГҮЙ, зөвхөн
 * `sheet_json`-ийн JSON агуулга (default загвар = migration 0131).
 *
 * Эрх: БҮХ маршрут `requireAdmin` — үнэ, тариф нь нууц мэдээлэл тул
 * `senior` ч энд ОРОХГҮЙ (requireManager БИШ).
 * ============================================================= */

const quotes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

quotes.use('*', requireAdmin());

/* ---------- Гэрээний хэлбэрүүд (frontend types-ийн толь) ---------- */

type TariffComplexity = 'zovshoorolgui' | 'baga' | 'dund' | 'ondor' | 'ontsgoi';

const COMPLEXITIES: TariffComplexity[] = [
  'zovshoorolgui',
  'baga',
  'dund',
  'ondor',
  'ontsgoi',
];

const DEFAULT_SOURCE_REF = 'БД 81-16-20/2020 4.20 Хүснэгт 9';

/* ---------- Борлуулалтын юүлүүрийн статус (migration 0168) ---------- */

/**
 * ⚠️ ЭНЭ БОЛ ЖИНХЭНЭ ВАЛИДАЦ. `quotes.status` баганад CHECK ХЯЗГААРЛАЛТ
 * БАЙХГҮЙ — SQLite `ALTER TABLE … ADD COLUMN`-д CHECK нэмэхийг зөвшөөрдөггүй
 * бөгөөд хүснэгтийг rebuild хийх (path B) нь энэ үнэ цэнэд тохирохгүй.
 * Шинэ статус нэмэх бол ЭНД нэмнэ, эс бөгөөс DB дурын мөр бичүүлнэ.
 *
 * `expired` ЗОРИУД БАЙХГҮЙ — v2-т хүчинтэй хугацааны талбар алга (0168-ын
 * толгойг үз). v1 (0083)-ийн `submitted/approved/rejected` мөчлөгийг бүү
 * сэргээ: тэр нь харилцагчийн баталгааны урсгал байсан, одоо ийм гадаргуу
 * байхгүй (бүх маршрут `requireAdmin`).
 */
const QUOTE_STATUSES = ['draft', 'sent', 'active', 'lost'] as const;
type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const isQuoteStatus = (v: unknown): v is QuoteStatus =>
  typeof v === 'string' && (QUOTE_STATUSES as readonly string[]).includes(v);

/** Юүлүүрийн хуваарилагдагч — ноорогоос ГАРСАН бүх санал. */
const FUNNEL_SENT_STATUSES: QuoteStatus[] = ['sent', 'active', 'lost'];

/**
 * Баримтын ГАРАЛ ҮҮСЭЛ (migration 0170).
 *
 * ⚠️ `status`-аас ЯЛГААТАЙ нь: энэ утга КЛИЕНТЭЭС ХЭЗЭЭ Ч ИРДЭГГҮЙ — маршрут
 * бүр өөрөө тавина (`POST /` → 'app', `POST /manual` → 'manual'). Тиймээс
 * оролтын валидатор ХЭРЭГГҮЙ; хэрэв хэзээ нэгэн цагт клиентээс авдаг болговол
 * `isQuoteStatus`-ийн адил хамгаалалт ЗААВАЛ нэмнэ (DB-д CHECK байхгүй).
 *
 * ⚠️ 'manual' / 'import' мөрүүд нь ХООСОН ажлын дэвтэртэй тул тэдэн дээр
 * PDF/хэвлэх утгагүй (хоосон A4 гарна). Frontend `canPrintQuote` үүн дээр
 * тулгуурлана — шинэ дэвтэргүй эх сурвалж нэмэхэд тэр функцийг ЗААВАЛ
 * дагуулж шинэчилнэ.
 */
type QuoteSource = 'app' | 'manual' | 'import';

/**
 * Баримтын ХЭЛ (migration 0181).
 *
 * ⚠️ `status`-тай ижил: `lang` баганад CHECK БАЙХГҮЙ (SQLite ALTER-д CHECK
 * нэмэгддэггүй) тул энэ жагсаалт л жинхэнэ валидац. Утга нь клиентээс ХЭЗЭЭ Ч
 * ирдэггүй — `POST /:id/translate` л 'en' тавьдаг; хэрэв хэзээ нэгэн цагт
 * клиентээс авдаг болговол `isQuoteStatus`-ийн адил хамгаалалт ЗААВАЛ нэмнэ.
 *
 * `source_quote_id` (мөн 0181) = англи хувилбарын ЭХ монгол саналын id.
 * Юүлүүр `source_quote_id IS NULL`-ээр шүүдэг (орчуулга нь эх саналтайгаа
 * НЭГ хэлцэл), DELETE нь хүүхдийн холбоосыг ГАРААР тайлдаг.
 */
const QUOTE_LANGS = ['mn', 'en'] as const;
type QuoteLang = (typeof QUOTE_LANGS)[number];

interface TariffRow {
  area_max: number;
  complexity: TariffComplexity;
  rate: number;
  source_ref: string;
}

/** Экспортолсон шалтгаан: `lib/quoteTranslate.ts` дэвтрийг алхахдаа ЭДГЭЭР
 *  хэлбэрийг дахин зарлахгүй, эндээс (type-only) импортолдог. */
export interface SheetCell {
  v?: string | number | null;
  f?: string;
  fmt?: string;
  s?: Record<string, unknown>;
  /** Dropdown сонголтууд (frontend types-ийн толь) — орчуулгад хэрэгтэй. */
  choices?: string[];
}

interface SheetMerge {
  r: number;
  c: number;
  rs: number;
  cs: number;
}

export interface SheetDoc {
  rows: number;
  cols: number;
  colWidths?: number[];
  merges: SheetMerge[];
  cells: Record<string, SheetCell>;
  anchors: Record<string, string | undefined>;
  /**
   * «Нэмэгдэл» цэсийн тодорхойлолт (хувийн нэмэгдэл багана хаана байгааг заана).
   * Серверт утга учиргүй — зөвхөн дамжуулна; эзэн нь
   * `frontend/src/features/quotes/lib/addons.ts`.
   */
  addons?: unknown;
  /**
   * НУУГДСАН сонгомол баганы бүлгүүдийн түлхүүр («height» г.м.). Серверт утга
   * учиргүй — зөвхөн дамжуулна; эзэн нь
   * `frontend/src/features/quotes/lib/optionalCols.ts`.
   *
   * ⚠️ `sanitizeSheetDoc` ЗААВАЛ дамжуулах ёстой — тэр функц allowlist тул
   * бичээгүй талбар чимээгүй алга болно.
   */
  hiddenGroups?: string[];
  /**
   * БАРИМТЫН ДООД ТАЙЛБАРЫН гараар өөрчилсөн төлөв. Эзэн нь
   * `frontend/src/features/quotes/lib/quoteNotes.ts`.
   *
   * Серверт УТГА УЧИРТАЙ ГАНЦ хэсэг нь `i18n`: динамикаар угсарсан монгол
   * өгүүлбэр → англи хос. Тайлбарууд одоо хуудасны агуулгаас үүсдэг тул
   * `QUOTE_MN_EN_DICT`-ийн бүтэн-мөрийн түлхүүрт таарахаа больсон; энэ
   * давхарга байхгүй бол англи хуулбар дээр улсын стандартын эшлэлүүд
   * Workers AI-д унана. `POST /:id/translate` үүнийг AI-ийн үр дүнгээс
   * ДЭЭГҮҮР тавина.
   */
  notes?: {
    on?: string[];
    off?: string[];
    text?: Record<string, string>;
    i18n?: Record<string, string>;
  };
}

/* ---------- Workbook (v3) — олон хуудаст дэвтэр ---------- */

/** Workbook түвшний anchor: аль хуудас (id) + аль нүд (ref). */
export interface WorkbookAnchor {
  sheet: string;
  ref: string;
}

/** Нэртэй хуудас — `SheetDoc` + тогтвортой `id` (`=ИГС!G17` томьёонд) + `name`. */
export interface NamedSheet extends SheetDoc {
  id: string;
  name: string;
}

/** Олон хуудаст ажлын дэвтэр. `anchors` нь workbook түвшинд амьдарна. */
export interface WorkbookDoc {
  sheets: NamedSheet[];
  activeSheet?: number;
  anchors: Record<string, WorkbookAnchor | undefined>;
}

interface TemplateVariant {
  key: string;
  label: string;
  titleTemplate: string;
  hiddenRows: number[];
}

/* ---------- DB мөрүүд ---------- */

interface QuoteRow {
  id: number;
  title: string;
  client_name: string | null;
  variant_key: string;
  doc_date: string;
  prepared_by: string | null;
  project_id: number | null;
  template_id: number | null;
  template_version: number | null;
  sheet_json: string;
  total_amount: number | null;
  contract_amount: number | null;
  status: string;
  status_changed_at: string | null;
  source: QuoteSource;
  lang: QuoteLang;
  source_quote_id: number | null;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
}

/** Жагсаалтын хөнгөн мөр — `sheet_json` БАЙХГҮЙ (хуудас нь хэдэн зуун KB). */
interface QuoteListRow {
  id: number;
  title: string;
  client_name: string | null;
  variant_key: string;
  doc_date: string;
  total_amount: number | null;
  contract_amount: number | null;
  status: string;
  status_changed_at: string | null;
  source: QuoteSource;
  lang: QuoteLang;
  source_quote_id: number | null;
  project_id: number | null;
  project_name: string | null;
  created_by_name: string | null;
  updated_at: string;
}

interface TemplateRow {
  id: number;
  name: string;
  version: number;
  is_default: number;
  sheet_json: string;
  variants_json: string;
  created_at: string;
  updated_at: string;
}

/* ---------- Жижиг туслахууд ---------- */

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const strOrNull = (v: unknown): string | null => str(v) || null;

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const intOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n === null ? null : Math.trunc(n);
};

const isDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** `sheet_json`-ийн дээд хэмжээ. Дэвтэр нь sparse тул хэвийн баримт
 *  ~50-300 KB; олон хуудас + хэв маягтай тул v3-т 2 MB болгов —
 *  түүнээс цаашхи нь буруу клиент эсвэл халдлага. */
const MAX_WORKBOOK_BYTES = 2 * 1024 * 1024;

/** Тарифын хүснэгтийн дээд мөр (Хүснэгт 9 бодитоор ~40 мөр). */
const MAX_TARIFF_ROWS = 10_000;

const byteLen = (s: string): number => new TextEncoder().encode(s).length;

/** Нэг хуудасны id үүсгэгч — зөвхөн НЭГ дэвтрийн дотор давхцахгүй байхад
 *  хангалттай (хуудас хооронд бус, дэвтэр хооронд бус). */
function makeIdFactory(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `sheet-${n}`;
  };
}

/** Дурын parsed объектыг найдвартай SheetDoc болгож цэвэрлэнэ. */
function sanitizeSheetDoc(o: Partial<SheetDoc>): SheetDoc {
  const sheet: SheetDoc = {
    rows: Number.isFinite(o.rows) ? Math.max(1, Math.trunc(Number(o.rows))) : 30,
    cols: Number.isFinite(o.cols) ? Math.max(1, Math.trunc(Number(o.cols))) : 14,
    merges: Array.isArray(o.merges) ? o.merges : [],
    cells: o.cells && typeof o.cells === 'object' ? o.cells : {},
    anchors: o.anchors && typeof o.anchors === 'object' ? o.anchors : {},
  };
  if (Array.isArray(o.colWidths)) sheet.colWidths = o.colWidths;
  // «Нэмэгдэл» цэсийн тодорхойлолт — сервер утга учрыг нь мэдэхгүй, зүгээр л
  // дамжуулна (frontend `lib/addons.ts` эзэмшинэ). Алдвал цэс алга болно.
  if (o.addons && typeof o.addons === 'object') sheet.addons = o.addons;
  /**
   * НУУГДСАН сонгомол баганы бүлгүүд (frontend `lib/optionalCols.ts`) — «Өндөр»
   * гэх мэт багануудыг тухайн саналд харуулах эсэх.
   *
   * ⚠️ Энэ функц бол ALLOWLIST: доор бичээгүй ямар ч талбар ЧИМЭЭГҮЙ хаягддаг.
   * PUT нь `JSON.stringify(body.workbook)`-оор түүхийгээр нь хадгалдаг тул
   * бичилт амжилттай харагдаад (200 OK), дараагийн УНШИЛТ дээр л алга болно —
   * маш төөрөгдүүлсэн шинж тэмдэг. Хуудсанд шинэ талбар нэмэх бүрд ЭНД мөн
   * нэмэх ЁСТОЙ (2026-08-19-нд яг ингэж алдаа гарсан).
   *
   * Утга учрыг нь сервер мэдэхгүй — зөвхөн мөрийн массив гэдгийг шалгаад
   * дамжуулна (`addons`-тай ижил гэрээ).
   */
  /**
   * БАРИМТЫН ДООД ТАЙЛБАРЫН төлөв (frontend `lib/quoteNotes.ts`) — `addons`,
   * `hiddenGroups`-тэй ижил гэрээ: утга учрыг нь сервер мэдэхгүй, зүгээр л
   * дамжуулна. ⚠️ Энд БИЧЭЭГҮЙ бол хадгалалт 200 буцаагаад дараагийн уншилт
   * дээр л алга болно (2026-08-19-ний алдааны хэв маяг).
   */
  if (o.notes && typeof o.notes === 'object') sheet.notes = o.notes;
  if (Array.isArray(o.hiddenGroups)) {
    const keys = o.hiddenGroups.filter((k): k is string => typeof k === 'string');
    if (keys.length > 0) sheet.hiddenGroups = keys;
  }
  return sheet;
}

/** Хоосон 1-хуудаст дэвтэр — 30 мөр × 14 багана (хэвлэмэл ХЭВТЭЭ A4). */
function blankWorkbook(makeId: () => string = makeIdFactory()): WorkbookDoc {
  return {
    sheets: [
      { id: makeId(), name: 'Хуудас1', rows: 30, cols: 14, merges: [], cells: {}, anchors: {} },
    ],
    anchors: {},
    activeSheet: 0,
  };
}

/**
 * Хадгалсан JSON-ийг найдвартай WorkbookDoc болгож нормчилно (buцаад нийц).
 *
 * frontend `lib/workbook.ts` → `normalizeWorkbook`-ийн ижил логик:
 *   • Шинэ WorkbookDoc (`{ sheets:[…] }`) — хуудас бүрд id/name/merges/cells
 *     нөхөж, хуудас түвшний anchors-ыг үл тоомсорлож (workbook anchors ялна).
 *   • Хуучин ганц SheetDoc (`{ rows, cells, … }`) — 1-хуудаст дэвтэр болгож,
 *     хуудасны anchors-ыг workbook anchors руу зөөнө.
 *   • Гэмтэлтэй/хоосон — хоосон 1-хуудаст дэвтэр.
 */
function parseWorkbook(json: string | null | undefined): WorkbookDoc {
  const makeId = makeIdFactory();
  if (!json) return blankWorkbook(makeId);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return blankWorkbook(makeId);
  }
  if (!raw || typeof raw !== 'object') return blankWorkbook(makeId);

  // Шинэ хэлбэр — sheets массивтай.
  if (Array.isArray((raw as WorkbookDoc).sheets)) {
    const wb = raw as WorkbookDoc;
    const sheets: NamedSheet[] = wb.sheets.map((s, i) => {
      const clean = sanitizeSheetDoc(s as Partial<SheetDoc>);
      return {
        ...clean,
        anchors: {}, // хуудас түвшний anchors хэрэглэгдэхгүй
        id: (s && s.id) || makeId(),
        name: (s && s.name) || `Хуудас${i + 1}`,
      };
    });
    if (sheets.length === 0) return blankWorkbook(makeId);
    const anchors =
      wb.anchors && typeof wb.anchors === 'object'
        ? (wb.anchors as Record<string, WorkbookAnchor | undefined>)
        : {};
    return {
      sheets,
      anchors,
      activeSheet: Number.isFinite(wb.activeSheet) ? Number(wb.activeSheet) : 0,
    };
  }

  // Хуучин ганц хуудас → 1-хуудаст дэвтэр. anchors-ыг workbook руу зөөнө.
  const sheet = sanitizeSheetDoc(raw as Partial<SheetDoc>);
  const id = makeId();
  const anchors: Record<string, WorkbookAnchor | undefined> = {};
  for (const [k, ref] of Object.entries(sheet.anchors)) {
    if (ref) anchors[k] = { sheet: id, ref };
  }
  return {
    sheets: [{ ...sheet, anchors: {}, id, name: 'Хуудас1' }],
    anchors,
    activeSheet: 0,
  };
}

function parseVariants(json: string | null | undefined): TemplateVariant[] {
  if (!json) return [];
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    return raw.filter((v): v is TemplateVariant => !!v && typeof v === 'object');
  } catch {
    return [];
  }
}

/** 'N28' → мөрийн 0-ээс эхэлсэн индекс (буруу хаяг бол null). */
function rowOfRef(ref: string): number | null {
  const m = /^[A-Z]+(\d+)$/.exec(ref);
  if (!m || !m[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 1 ? n - 1 : null;
}

/**
 * Variant-ийн `hiddenRows`-ийг хуудсанд тусгана.
 *
 * ⚠️ Мөрийг УСТГАХГҮЙ, зөвхөн ХООСОЛНО. Мөр устгавал доод мөрүүд дээшилж,
 * бүх томьёоны мөрийн лавлагааг шилжүүлэх шаардлагатай болно
 * (`frontend/src/features/quotes/lib/formula/refs.ts` → `shiftRefsInFormula`).
 * Тэр логикийг backend-д ДАВХАРДУУЛАХГҮЙ гэж зориуд шийдсэн: хоосон мөр нь
 * тооцоонд 0 өгдөг тул үр дүн ижил, PM хүсвэл хуудсан дээрээ мөрийг өөрөө
 * устгана.
 */
function applyHiddenRows<T extends SheetDoc>(sheet: T, hiddenRows: number[]): T {
  const hidden = new Set(
    hiddenRows.filter((r) => Number.isInteger(r) && r >= 0).map((r) => Number(r)),
  );
  if (hidden.size === 0) return sheet;

  const cells: Record<string, SheetCell> = {};
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    const r = rowOfRef(ref);
    if (r !== null && hidden.has(r)) continue;
    cells[ref] = cell;
  }
  const merges = sheet.merges.filter(
    (m) => !(Number.isInteger(m?.r) && hidden.has(Number(m.r))),
  );
  return { ...sheet, cells, merges };
}

/**
 * Ирсэн `project_id`-г шалгаж нормчилно. Өгөгдөөгүй/хоосон бол `null`.
 *
 * ⚠️ Байгаа эсэхийг ЗААВАЛ шалгана: D1 нь тунхагласан FK-г ажиллах үедээ
 * ШАХДАГГҮЙ тул буруу id чимээгүйхэн бичигдээд, жагсаалтын LEFT JOIN дээр
 * `project_name: null` болж «алга болсон төсөл» мэт харагдана. 0168-аас өмнө
 * энэ багана ҮРГЭЛЖ NULL бичигддэг байсан (FK ба индекс нь хэрэглэгдээгүй).
 */
async function resolveProjectId(
  db: D1Database,
  raw: unknown,
): Promise<{ id: number | null } | { error: string }> {
  if (raw === undefined || raw === null || raw === '') return { id: null };
  const id = intOrNull(raw);
  if (id === null || id <= 0) return { error: 'Invalid project_id' };
  const exists = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first<{ id: number }>();
  if (!exists) return { error: 'Төсөл олдсонгүй' };
  return { id };
}

/** DB мөр → HTTP-ийн `Quote` (sheet_json → workbook болж задарсан). */
function toQuote(row: QuoteRow, createdByName: string | null, stampUrl: string | null = null) {
  return {
    id: row.id,
    title: row.title,
    client_name: row.client_name,
    variant_key: row.variant_key,
    doc_date: row.doc_date,
    total_amount: row.total_amount,
    // Гэрээний дүн нь саналын дүнгээс ТУСДАА — хэлэлцээрийн дараа өөр болдог
    // (migration 0168). Аль нэгээр нөгөөг нь орлуулж БОЛОХГҮЙ.
    contract_amount: row.contract_amount,
    status: row.status,
    status_changed_at: row.status_changed_at,
    // 'manual' / 'import' = ажлын дэвтэргүй, буцаан бүртгэсэн мөр (0170).
    source: row.source,
    // 'en' = англи хувилбар; `source_quote_id` нь эх монгол саналын id (0181).
    lang: row.lang,
    source_quote_id: row.source_quote_id,
    project_id: row.project_id,
    created_by_name: createdByName,
    /** Баримтын тамга (`/media/<key>`) — эзэмшигчийнх, эс бөгөөс захирлынх. */
    stamp_url: stampUrl,
    updated_at: row.updated_at,
    template_id: row.template_id,
    template_version: row.template_version,
    workbook: parseWorkbook(row.sheet_json),
    prepared_by: row.prepared_by,
    created_at: row.created_at,
  };
}

/* =============================================================
 * Тариф — БД 81-16-20/2020, заалт 4.20, Хүснэгт 9
 * -------------------------------------------------------------
 * ⚠️ Статик маршрутууд `/:id`-ээс ӨМНӨ бүртгэгдэнэ, эс тэгвээс
 * '/tariffs' нь `/:id`-д залгирна.
 * ============================================================= */

// GET /api/quotes/tariffs — бүх мөр.
// withEdgeCache ЗОРИУД хэрэглээгүй: админ-only, ховор боловч гараар
// засагддаг өгөгдөл — кэш нь зөвхөн хуучин үнэ буцаах эрсдэл нэмнэ.
quotes.get('/tariffs', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT area_max, complexity, rate, source_ref
       FROM quote_tariffs
      ORDER BY complexity, area_max`,
  ).all<TariffRow>();
  return c.json(results ?? []);
});

// PUT /api/quotes/tariffs — хүснэгтийг БҮХЭЛД НЬ солино (DELETE + INSERT).
quotes.put('/tariffs', async (c) => {
  const body = await c.req
    .json<{ rows?: unknown }>()
    .catch(() => ({}) as { rows?: unknown });
  if (!Array.isArray(body.rows)) return c.json({ error: 'rows is required' }, 400);
  if (body.rows.length > MAX_TARIFF_ROWS) {
    return c.json({ error: `Хэт олон мөр (>${MAX_TARIFF_ROWS})` }, 413);
  }

  // (area_max, complexity) нь PRIMARY KEY тул ачааллын доторх давхардлыг
  // урьдчилан цэвэрлэнэ — сүүлийнх нь ялна.
  const byKey = new Map<string, TariffRow>();
  for (const raw of body.rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Partial<TariffRow>;
    const areaMax = numOrNull(r.area_max);
    const complexity = str(r.complexity) as TariffComplexity;
    const rate = intOrNull(r.rate);
    if (areaMax === null || areaMax <= 0) {
      return c.json({ error: 'area_max must be a positive number' }, 400);
    }
    if (!COMPLEXITIES.includes(complexity)) {
      return c.json({ error: `Invalid complexity: ${String(r.complexity)}` }, 400);
    }
    if (rate === null || rate < 0) {
      return c.json({ error: 'rate must be a non-negative integer' }, 400);
    }
    byKey.set(`${areaMax}|${complexity}`, {
      area_max: areaMax,
      complexity,
      rate,
      source_ref: str(r.source_ref) || DEFAULT_SOURCE_REF,
    });
  }

  const rows = [...byKey.values()];
  const stmts = [c.env.DB.prepare('DELETE FROM quote_tariffs')];
  // 4 bind/мөр × 25 = 100 ≤ D1-ийн нэг мэдэгдлийн параметрийн хязгаар.
  for (let i = 0; i < rows.length; i += 25) {
    const chunk = rows.slice(i, i + 25);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO quote_tariffs (area_max, complexity, rate, source_ref)
         VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(', ')}`,
      ).bind(...chunk.flatMap((r) => [r.area_max, r.complexity, r.rate, r.source_ref])),
    );
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, count: rows.length });
});

/* =============================================================
 * Template — хуудасны загвар + хувилбарууд
 * ============================================================= */

// GET /api/quotes/templates — бүх загвар (цөөхөн тул `sheet` хамт).
quotes.get('/templates', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, version, is_default, sheet_json, variants_json, created_at, updated_at
       FROM quote_templates
      ORDER BY is_default DESC, name`,
  ).all<TemplateRow>();
  return c.json(
    (results ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      version: t.version,
      is_default: t.is_default,
      workbook: parseWorkbook(t.sheet_json),
      variants: parseVariants(t.variants_json),
      created_at: t.created_at,
      updated_at: t.updated_at,
    })),
  );
});

// GET /api/quotes/templates/:id — нэг загвар.
quotes.get('/templates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT id, name, version, is_default, sheet_json, variants_json, created_at, updated_at
       FROM quote_templates WHERE id = ?`,
  )
    .bind(id)
    .first<TemplateRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({
    id: row.id,
    name: row.name,
    version: row.version,
    is_default: row.is_default,
    workbook: parseWorkbook(row.sheet_json),
    variants: parseVariants(row.variants_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
});

// PUT /api/quotes/templates/:id — загвар засах.
// Одоогийн хувилбарыг `quote_template_history`-д хуулж, version-ийг нэмнэ.
// Хоёр (эсвэл гурав) мэдэгдэл НЭГ `db.batch()`-д — batch нь transactional тул
// түүх бичигдэлгүй хувилбар алдагдах боломжгүй. INSERT…SELECT нь UPDATE-ээс
// ӨМНӨ явагддаг учир ХУУЧИН sheet/variants-ийг л хуулж авна.
quotes.put('/templates/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user');

  const body = await c.req
    .json<{ name?: unknown; workbook?: unknown; variants?: unknown; is_default?: unknown }>()
    .catch(
      () => ({}) as { name?: unknown; workbook?: unknown; variants?: unknown; is_default?: unknown },
    );

  const existing = await c.env.DB.prepare(
    `SELECT id, name, version, is_default, sheet_json, variants_json, created_at, updated_at
       FROM quote_templates WHERE id = ?`,
  )
    .bind(id)
    .first<TemplateRow>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = body.name !== undefined ? str(body.name) : existing.name;
  if (!name) return c.json({ error: 'name is required' }, 400);

  // `workbook`-ийг түүхий JSON-оор хадгална (`sheet_json` баганад). Дахин
  // тооцоолохгүй; уншихад `parseWorkbook` нормчилно.
  const sheetJson =
    body.workbook !== undefined && body.workbook && typeof body.workbook === 'object'
      ? JSON.stringify(body.workbook)
      : existing.sheet_json;
  if (byteLen(sheetJson) > MAX_WORKBOOK_BYTES) {
    return c.json({ error: 'Ажлын дэвтэр хэт том (>2 MB)' }, 413);
  }
  const variantsJson = Array.isArray(body.variants)
    ? JSON.stringify(body.variants)
    : existing.variants_json;
  const isDefault =
    body.is_default !== undefined ? (Number(body.is_default) ? 1 : 0) : existing.is_default;

  const stmts = [
    c.env.DB.prepare(
      `INSERT INTO quote_template_history (template_id, version, sheet_json, variants_json, created_by)
       SELECT id, version, sheet_json, variants_json, ? FROM quote_templates WHERE id = ?`,
    ).bind(user.sub, id),
  ];
  // Ганц л default байх ёстой (POST /api/quotes нь is_default=1-ийг хайдаг).
  if (isDefault === 1) {
    stmts.push(
      c.env.DB.prepare('UPDATE quote_templates SET is_default = 0 WHERE id <> ?').bind(id),
    );
  }
  stmts.push(
    c.env.DB.prepare(
      `UPDATE quote_templates
          SET name = ?, sheet_json = ?, variants_json = ?, is_default = ?,
              version = version + 1, updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(name, sheetJson, variantsJson, isDefault, id),
  );
  await c.env.DB.batch(stmts);

  return c.json({
    id,
    name,
    version: existing.version + 1,
    is_default: isDefault,
    workbook: parseWorkbook(sheetJson),
    variants: parseVariants(variantsJson),
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  });
});

/* =============================================================
 * Үнийн саналууд
 * ============================================================= */

// GET /api/quotes — хөнгөн жагсаалт (`sheet_json` БУЦААХГҮЙ).
// `?status=` — юүлүүрийн шатаар шүүх (буруу утга ирвэл ҮЛ ТООМСОРЛОНО,
// 400 биш: жагсаалтын шүүлтүүр нь бичих үйлдэл биш, хоосон дэлгэц гаргахаас
// бүх мөрийг харуулах нь дээр).
quotes.get('/', async (c) => {
  const limitRaw = Number(c.req.query('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(500, Math.trunc(limitRaw)) : 100;
  const statusRaw = c.req.query('status');
  const status = isQuoteStatus(statusRaw) ? statusRaw : null;

  const { results } = await c.env.DB.prepare(
    `SELECT q.id, q.title, q.client_name, q.variant_key, q.doc_date,
            q.total_amount, q.contract_amount, q.status, q.status_changed_at,
            q.source, q.lang, q.source_quote_id, q.project_id, q.updated_at,
            p.name AS project_name,
            u.full_name AS created_by_name
       FROM quotes q
       LEFT JOIN users u ON u.id = q.created_by_id
       LEFT JOIN projects p ON p.id = q.project_id
      WHERE (? IS NULL OR q.status = ?)
      ORDER BY q.updated_at DESC
      LIMIT ?`,
  )
    .bind(status, status, limit)
    .all<QuoteListRow>();
  return c.json(results ?? []);
});

/* =============================================================
 * GET /api/quotes/funnel — борлуулалтын юүлүүр / win-rate
 * -------------------------------------------------------------
 * ⚠️ `/:id`-ЭЭС ДЭЭР бүртгэгдсэн байх ЁСТОЙ, эс бөгөөс 'funnel' нь `/:id`-д
 * залгирч «Invalid id» 400 буцна (репогийн `/top`/`/reorder` конвенц).
 *
 * ⚠️ ДҮНГИЙН NULL-ИЙГ 0 ГЭЖ ТООЦДОГГҮЙ. `total_amount` нь клиентийн
 * тооцоолсон кэш (0128) — браузераар хэзээ ч нээгээгүй санал дээр NULL.
 * Тэднийг 0 гэж нийлбэрт оруулбал «нийт хэдэн төгрөгний санал явуулав»
 * гэсэн тоо чимээгүйхэн бага гарч, хэн ч анзаарахгүй. Тиймээс нийлбэрт
 * ЗӨВХӨН NOT NULL мөр орж, дутуу мөрийн ТОО (`amount_missing_count`)
 * тусдаа буцна — UI үүнийг ил харуулах үүрэгтэй.
 *
 * `from` / `to` нь `doc_date`-ээр шүүнэ (баримтын огноо), `created_at` биш —
 * буцаан бүртгэсэн өнгөрсөн оны санал өнөөдрийн улиралд орох ёсгүй.
 *
 * ⚠️ АНГЛИ ХУВИЛБАРУУД (`source_quote_id IS NOT NULL`, 0181) юүлүүрт ОРОХГҮЙ —
 * орчуулга нь шинэ хэлцэл биш, эх саналынхаа англи хуулбар. Доорх нэгтгэлийн
 * WHERE-т шүүгддэг тул bucket, totals ХОЁУЛ автоматаар цэвэр.
 * ============================================================= */
quotes.get('/funnel', async (c) => {
  const fromRaw = str(c.req.query('from'));
  const toRaw = str(c.req.query('to'));
  const from = isDate(fromRaw) ? fromRaw : null;
  const to = isDate(toRaw) ? toRaw : null;

  interface BucketRow {
    status: string;
    count: number;
    amount_sum: number;
    amount_missing_count: number;
    contract_sum: number;
    contract_missing_count: number;
  }

  const { results } = await c.env.DB.prepare(
    `SELECT status,
            COUNT(*) AS count,
            COALESCE(SUM(total_amount), 0) AS amount_sum,
            SUM(CASE WHEN total_amount IS NULL THEN 1 ELSE 0 END) AS amount_missing_count,
            COALESCE(SUM(contract_amount), 0) AS contract_sum,
            SUM(CASE WHEN contract_amount IS NULL THEN 1 ELSE 0 END) AS contract_missing_count
       FROM quotes
      -- ⚠️ Англи хувилбарыг (0181) ХАСНА: орчуулга нь эх саналтайгаа НЭГ
      -- хэлцэл тул давхар тоолбол тоо, дүн хоёул хийсвэрээр өснө.
      WHERE source_quote_id IS NULL
        AND (? IS NULL OR doc_date >= ?)
        AND (? IS NULL OR doc_date <= ?)
      GROUP BY status`,
  )
    .bind(from, from, to, to)
    .all<BucketRow>();

  const rawRows = results ?? [];

  const byStatus = new Map(rawRows.map((r) => [r.status, r]));
  // Хоосон шат ч мөр болж гарна — UI-д «0» ба «өгөгдөл алга» хоёр ялгаатай.
  const buckets = QUOTE_STATUSES.map((s) => {
    const r = byStatus.get(s);
    return {
      status: s,
      count: r?.count ?? 0,
      amount_sum: r?.amount_sum ?? 0,
      amount_missing_count: r?.amount_missing_count ?? 0,
      contract_sum: r?.contract_sum ?? 0,
      contract_missing_count: r?.contract_missing_count ?? 0,
    };
  });

  const pick = (s: QuoteStatus) => buckets.find((b) => b.status === s);
  const sentSide = buckets.filter((b) => FUNNEL_SENT_STATUSES.includes(b.status as QuoteStatus));
  const sum = (key: 'count' | 'amount_sum' | 'amount_missing_count') =>
    sentSide.reduce((acc, b) => acc + b[key], 0);

  const sentTotal = sum('count');
  const won = pick('active');

  /*
   * «Нийт үүсгэсэн» — НООРОГ ХАМТ, мужид багтах БҮХ санал. `sent_total` нь
   * ноорогийг ЗОРИУД хасдаг (win-rate-ийн хуваарилагдагч) тул «хэдэн санал
   * үүсгэв» гэсэн асуултад хариулдаггүй — энэ хос түүнийг нөхнө.
   *
   * ⚠️ `buckets`-ЭЭС БИШ, түүхий `rawRows`-оос нийлбэрлэнэ. `quotes.status`-д
   * DB түвшний CHECK БАЙХГҮЙ (0168-ын толгойг үз) тул танихгүй статустай мөр
   * `buckets`-т огт гарахгүй; түүнийг нийт тоонд оруулахгүй бол «үүсгэсэн»
   * тоо чимээгүйхэн бага гарна. Энэ файлын мөнгөн дүнгийн зарчимтай ижил:
   * дутууг НУУХГҮЙ. (Тийм мөр гарвал шатны жагсаалтын нийлбэр нь нийт дүнтэй
   * зөрнө — тэр ЗӨРӨӨ нь өөрөө дохио.)
   */
  const sumAll = (key: 'count' | 'amount_sum' | 'amount_missing_count') =>
    rawRows.reduce((acc, r) => acc + r[key], 0);

  return c.json({
    from,
    to,
    buckets,
    totals: {
      /** Мужид үүсгэсэн БҮХ санал — ноорог ХАМТ. */
      created_total: sumAll('count'),
      /** Тэдгээрийн нийт саналын дүн — ЗӨВХӨН дүн бүртгэгдсэн мөрөөр. */
      created_amount: sumAll('amount_sum'),
      created_amount_missing_count: sumAll('amount_missing_count'),
      /** Ноорогоос ГАРСАН бүх санал — win-rate-ийн хуваарилагдагч. */
      sent_total: sentTotal,
      /** Гэрээ болсон — хуваарь. */
      won_count: won?.count ?? 0,
      /** 0-д хуваахгүй: санал огт явуулаагүй бол хувь нь «мэдэгдэхгүй» (null). */
      win_rate: sentTotal > 0 ? (won?.count ?? 0) / sentTotal : null,
      /** Явуулсан саналуудын нийт дүн — ЗӨВХӨН дүн бүртгэгдсэн мөрөөр. */
      quoted_amount: sum('amount_sum'),
      quoted_amount_missing_count: sum('amount_missing_count'),
      /** Гэрээ болсны нийт ГЭРЭЭНИЙ дүн (саналын дүн БИШ). */
      contracted_amount: won?.contract_sum ?? 0,
      contracted_amount_missing_count: won?.contract_missing_count ?? 0,
    },
  });
});

// POST /api/quotes — template-ээс шинэ баримт үүсгэх.
// Хуудсыг SNAPSHOT-лож хуулна: дараа нь template өөрчлөгдөхөд явж буй
// баримтууд өөрчлөгдөхгүй (`template_version` нь ямар хувилбараас
// салбарласныг тэмдэглэнэ).
quotes.post('/', async (c) => {
  const user = c.get('user');
  type CreatePayload = {
    template_id?: unknown;
    variant_key?: unknown;
    variant_keys?: unknown;
    title?: unknown;
    project_id?: unknown;
  };
  const body = await c.req.json<CreatePayload>().catch(() => ({}) as CreatePayload);

  // Төрөл нь ОЛОН байж болно (эскиз + ажлын зураг хамт). `variant_keys` нь
  // одоогийн клиент, `variant_key` нь хуучин (ганц түлхүүр) — хоёуланг авна.
  const selectedVariants = normalizeVariantKeys(body.variant_keys ?? body.variant_key);
  const variantKeys: string[] = selectedVariants.length > 0 ? selectedVariants : ['design'];
  const variantKey = serializeVariantKeys(variantKeys);
  const templateId = intOrNull(body.template_id);
  if (body.template_id !== undefined && body.template_id !== null) {
    if (templateId === null || templateId <= 0) {
      return c.json({ error: 'Invalid template_id' }, 400);
    }
  }

  const project = await resolveProjectId(c.env.DB, body.project_id);
  if ('error' in project) return c.json({ error: project.error }, 400);
  const projectId = project.id;

  const template = templateId
    ? await c.env.DB.prepare(
        `SELECT id, name, version, is_default, sheet_json, variants_json, created_at, updated_at
           FROM quote_templates WHERE id = ?`,
      )
        .bind(templateId)
        .first<TemplateRow>()
    : await c.env.DB.prepare(
        `SELECT id, name, version, is_default, sheet_json, variants_json, created_at, updated_at
           FROM quote_templates WHERE is_default = 1 ORDER BY id LIMIT 1`,
      ).first<TemplateRow>();

  if (templateId && !template) return c.json({ error: 'Template not found' }, 404);

  let workbook = template ? parseWorkbook(template.sheet_json) : blankWorkbook();
  const variants = template ? parseVariants(template.variants_json) : [];
  // Сонгосон түлхүүр бүрийн template-хувилбар (байвал). Одоогийн «Хяналтын
  // төсөв» загварт каталогийн түлхүүртэй тохирох хувилбар БАЙХГҮЙ тул доорх
  // хоёр механизм хоёулаа no-op — төрөл нь зөвхөн АНГИЛАЛ.
  const matched = variantKeys.map((k) => variants.find((v) => v.key === k) ?? null);
  const firstVariant = matched.find((v) => v !== null) ?? null;

  /**
   * hiddenRows — сонгосон БҮХ төрөлд нийтлэг мөрүүд (ОГТЛОЛЦОЛ). Аль нэг
   * төрөлд тохирох хувилбар олдоогүй бол тэр нь «юу ч нуухгүй» гэсэн үг тул
   * огтлолцол хоосон болно. Ингэснээр «эскиз + ажлын зураг» гэж сонгоход аль
   * нэгэнд нь хэрэгтэй мөр санамсаргүй алга болохгүй.
   */
  const hiddenRows = matched.reduce<number[] | null>((acc, v) => {
    const rows = v && Array.isArray(v.hiddenRows) ? v.hiddenRows : [];
    return acc === null ? [...rows] : acc.filter((r) => rows.includes(r));
  }, null);

  // hiddenRows нь Нэгтгэл (эхний) хуудсанд үйлчилнэ.
  if (hiddenRows && hiddenRows.length > 0 && workbook.sheets.length > 0) {
    const first = workbook.sheets[0];
    if (first) {
      workbook = {
        ...workbook,
        sheets: [applyHiddenRows(first, hiddenRows), ...workbook.sheets.slice(1)],
      };
    }
  }

  // Гарчиг: ирсэн нэр > ЭХНИЙ сонгосон төрлийн загвар ({{object}} нь хараахан
  // мэдэгдээгүй тул хасагдана) > хоосон.
  const title =
    str(body.title) ||
    (firstVariant
      ? str(firstVariant.titleTemplate).replace(/\{\{\s*object\s*\}\}/g, '').trim()
      : '');

  // Гарчгийн anchor байвал шинэ гарчгийг тэр хуудасны тэр нүдэнд бичнэ —
  // хэвлэмэл дээр баримт нэрээ шууд харуулна (томьёог литерал утгаар дарна).
  const titleAnchor = workbook.anchors.title;
  if (title && titleAnchor) {
    workbook = {
      ...workbook,
      sheets: workbook.sheets.map((s) => {
        if (s.id !== titleAnchor.sheet) return s;
        const prev = s.cells[titleAnchor.ref] ?? {};
        return {
          ...s,
          cells: { ...s.cells, [titleAnchor.ref]: { ...prev, v: title, f: undefined } },
        };
      }),
    };
  }

  const sheetJson = JSON.stringify(workbook);
  if (byteLen(sheetJson) > MAX_WORKBOOK_BYTES) {
    return c.json({ error: 'Ажлын дэвтэр хэт том (>2 MB)' }, 413);
  }

  // `status` нь схемийн DEFAULT 'draft'-аар үүснэ — шинэ баримт үргэлж
  // ноорог, юүлүүрт ороогүй. Шилжилт нь ЗӨВХӨН `PATCH /:id/status`-аар.
  const row = await c.env.DB.prepare(
    `INSERT INTO quotes (title, client_name, variant_key, doc_date, prepared_by,
                         project_id, template_id, template_version, sheet_json,
                         total_amount, created_by_id)
     VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, ?, NULL, ?)
     RETURNING id, title, client_name, variant_key, doc_date, prepared_by, project_id,
               template_id, template_version, sheet_json, total_amount, contract_amount,
               status, status_changed_at, source, lang, source_quote_id, created_by_id,
               created_at, updated_at`,
  )
    .bind(
      title,
      variantKey,
      todayInUB(),
      projectId,
      template ? template.id : null,
      template ? template.version : null,
      sheetJson,
      user.sub,
    )
    .first<QuoteRow>();
  if (!row) return c.json({ error: 'Insert failed' }, 500);

  const author = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ full_name: string }>();
  return c.json(toQuote(row, author?.full_name ?? null), 201);
});

/* =============================================================
 * POST /api/quotes/manual — «Хурдан нэмэх» (буцаан бүртгэх)
 * -------------------------------------------------------------
 * MGL-ийн өмнөх ~300 санал Excel дээр, апп-аас ГАДУУР хийгдсэн. Юүлүүр (0168)
 * утга учиртай болохын тулд тэдгээрийг бүртгэх ёстой. Энэ гарц нь загвар,
 * хувилбар, ажлын дэвтэр огт барихгүйгээр ЗӨВХӨН тоон баримтыг авна.
 *
 * `POST /`-ЭЭС ЯЛГАА:
 *   • Хоосон дэвтэр (`blankWorkbook()`) — тооцооны хуудас БАЙХГҮЙ. Тиймээс
 *     эдгээр мөрд PDF/хэвлэх УТГАГҮЙ (`source` = 'manual', migration 0170;
 *     frontend `canPrintQuote` товчийг нууна).
 *   • `status` болон дүнг ШУУД авна — `PATCH /:id/status`-аар дамжуулахгүй.
 *     Тиймээс `quote_status_history`-д мөр ҮҮСГЭХГҮЙ: 300 хиймэл мөр жинхэнэ
 *     шилжилтүүдийг булах байсан. Гарал үүслийг `source` өөрөө тайлбарлана.
 *
 * ⚠️ `/:id`-ЭЭС ДЭЭР бүртгэгдсэн байх шаардлагагүй (POST /:id маршрут
 * байхгүй) ч жагсаалтын дэргэд байлгаж уншихад ойлгомжтой болгов.
 * ============================================================= */
quotes.post('/manual', async (c) => {
  const user = c.get('user');

  type ManualPayload = {
    title?: unknown;
    client_name?: unknown;
    project_id?: unknown;
    doc_date?: unknown;
    total_amount?: unknown;
    contract_amount?: unknown;
    status?: unknown;
    variant_key?: unknown;
    variant_keys?: unknown;
  };
  const body = await c.req.json<ManualPayload>().catch(() => ({}) as ManualPayload);

  const title = str(body.title);
  if (!title) return c.json({ error: 'Гарчиг оруулна уу' }, 400);

  // Дэвтэргүй мөр ч гэсэн ЖАГСААЛТАД «Төрөл» баганатай — 0170-оос өмнө энд
  // 'design' хатуу бичигдсэн байсан тул буцаан бүртгэсэн бүх санал «Ажлын
  // зураг» болж харагддаг байв.
  const manualVariants = normalizeVariantKeys(body.variant_keys ?? body.variant_key);
  const manualVariantKey = serializeVariantKeys(
    manualVariants.length > 0 ? manualVariants : ['design'],
  );

  if (body.status !== undefined && !isQuoteStatus(body.status)) {
    return c.json({ error: `status нь ${QUOTE_STATUSES.join(' | ')} байх ёстой` }, 400);
  }
  const status: QuoteStatus = isQuoteStatus(body.status) ? body.status : 'draft';

  const project = await resolveProjectId(c.env.DB, body.project_id);
  if ('error' in project) return c.json({ error: project.error }, 400);

  const docDateRaw = str(body.doc_date);
  const docDate = isDate(docDateRaw) ? docDateRaw : todayInUB();

  const totalAmount = numOrNull(body.total_amount);
  // `PATCH /:id/status`-тай ИЖИЛ дүрэм: гэрээний дүнг зөвхөн `active` дээр
  // саналын дүнгээр нөхнө. Өөр шатанд нөхвөл «гэрээ болоогүй мөнгө» гэсэн
  // утгагүй тоо юүлүүрт орно.
  const explicitContract = numOrNull(body.contract_amount);
  const contractAmount =
    explicitContract !== null ? explicitContract : status === 'active' ? totalAmount : null;

  const row = await c.env.DB.prepare(
    `INSERT INTO quotes (title, client_name, variant_key, doc_date, prepared_by,
                         project_id, template_id, template_version, sheet_json,
                         total_amount, contract_amount, status, status_changed_at,
                         source, created_by_id)
     VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?, ?, ?, ?, 'manual', ?)
     RETURNING id, title, client_name, variant_key, doc_date, prepared_by, project_id,
               template_id, template_version, sheet_json, total_amount, contract_amount,
               status, status_changed_at, source, lang, source_quote_id, created_by_id,
               created_at, updated_at`,
  )
    .bind(
      title,
      strOrNull(body.client_name),
      manualVariantKey,
      docDate,
      project.id,
      JSON.stringify(blankWorkbook()),
      totalAmount,
      contractAmount,
      status,
      // Ноорогоор бүртгэвэл «төлөв өөрчлөгдсөн» огноо утгагүй.
      status === 'draft' ? null : new Date().toISOString(),
      user.sub,
    )
    .first<QuoteRow>();
  if (!row) return c.json({ error: 'Insert failed' }, 500);

  const author = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ full_name: string }>();
  return c.json(toQuote(row, author?.full_name ?? null), 201);
});

// GET /api/quotes/:id — бүтэн баримт (`sheet` задарсан).
quotes.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    `SELECT q.id, q.title, q.client_name, q.variant_key, q.doc_date, q.prepared_by,
            q.project_id, q.template_id, q.template_version, q.sheet_json,
            q.total_amount, q.contract_amount, q.status, q.status_changed_at,
            q.source, q.lang, q.source_quote_id, q.created_by_id, q.created_at, q.updated_at,
            u.full_name AS created_by_name,
            -- ⚠️ Баримт дээр гарах ТАМГА: эхлээд саналыг эзэмшигчийнх, түүнд
            -- байхгүй бол ЗАХИРЛЫНХ. Тамга нь практикт компанийн НЭГ зүйл ч
            -- users хүснэгтэд хадгалагддаг тул PM өөрөө тамгагүй байхад
            -- баримт тамгагүй гарахаас сэргийлнэ.
            COALESCE(u.stamp_url, ceo.stamp_url) AS stamp_url,
            -- Гарын үсгийн блок: БОЛОВСРУУЛСАН (саналыг үүсгэсэн хүн) ба
            -- ГҮЙЦЭТГЭСЭН (захирал). Хоёулаа users.signature_url-ээс.
            u.signature_url AS author_signature,
            ceo.full_name   AS ceo_name,
            ceo.signature_url AS ceo_signature
       FROM quotes q
       LEFT JOIN users u ON u.id = q.created_by_id
       LEFT JOIN users ceo ON ceo.id = ${ceoUserId() ?? 0}
      WHERE q.id = ?`,
  )
    .bind(id)
    .first<
      QuoteRow & {
        created_by_name: string | null;
        stamp_url: string | null;
        author_signature: string | null;
        ceo_name: string | null;
        ceo_signature: string | null;
      }
    >();
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json({
    ...toQuote(row, row.created_by_name, row.stamp_url),
    author_signature: row.author_signature,
    ceo_name: row.ceo_name,
    ceo_signature: row.ceo_signature,
  });
});

/* =============================================================
 * PATCH /api/quotes/:id/status — юүлүүрийн шат солих
 * -------------------------------------------------------------
 * Статусыг ЗӨВХӨН энэ гарцаар солино (`PUT /:id` нь autosave — тэнд статус
 * солих боломж өгвөл дэвтэр хадгалах бүрд юүлүүр чимээгүйхэн хөдөлнө).
 *
 * Шилжилт бүр `quote_status_history`-д мөр үлдээнэ (migration 0169).
 * Ижил статус руу «шилжүүлэх» нь 409 — түүх хуурамч мөрөөр дүүрэхээс
 * сэргийлнэ, мөн давхар дарсан товчийг илрүүлнэ.
 * ============================================================= */
quotes.patch('/:id/status', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user');

  type StatusPayload = { status?: unknown; note?: unknown; contract_amount?: unknown };
  const body = await c.req.json<StatusPayload>().catch(() => ({}) as StatusPayload);

  if (!isQuoteStatus(body.status)) {
    return c.json({ error: `status нь ${QUOTE_STATUSES.join(' | ')} байх ёстой` }, 400);
  }
  const next = body.status;

  const current = await c.env.DB.prepare(
    'SELECT status, total_amount, contract_amount, source_quote_id FROM quotes WHERE id = ?',
  )
    .bind(id)
    .first<{
      status: string;
      total_amount: number | null;
      contract_amount: number | null;
      source_quote_id: number | null;
    }>();
  if (!current) return c.json({ error: 'Not found' }, 404);
  /*
   * ⚠️ АНГЛИ ХУВИЛБАР ДЭЭР ТӨЛӨВ СОЛИХГҮЙ. Юүлүүр (GET /funnel) орчуулгыг
   * `source_quote_id IS NULL`-ээр ХАСДАГ — нэг хэлцлийг хоёр удаа тоолохгүйн
   * тулд. Тэгэхээр англи мөрийг 'active' болговол тэр ялалт, гэрээний дүн нь
   * ХААНА Ч харагдахгүй (bucket-д ороогүй тул `*_missing_count` ч дохиохгүй).
   * Хэлцлийн төлөв нь ЭХ (монгол) саналынх — цорын ганц үнэн.
   */
  if (current.source_quote_id !== null) {
    return c.json(
      { error: 'Төлөвийг эх (монгол) санал дээр нь солино', code: 'TRANSLATED_QUOTE' },
      400,
    );
  }
  if (current.status === next) {
    return c.json({ error: 'Санал аль хэдийн энэ төлөвт байна', code: 'SAME_STATUS' }, 409);
  }

  /*
   * Гэрээний дүн. Дараалал:
   *   1) хүсэлтэд ирсэн утга (PM гараар засаж болно),
   *   2) аль хэдийн бичигдсэн `contract_amount`,
   *   3) `active` руу шилжиж байгаа үед л — саналын дүнгээр УРЬДЧИЛАН дүүргэнэ.
   *
   * ⚠️ 3-р алхам нь ЗӨВХӨН `active` дээр. Өөр шат руу шилжихэд саналын дүнг
   * гэрээний дүн болгон хуулбал гэрээ болоогүй саналууд гэрээний нийлбэрт
   * орно. `total_amount` нь өөрөө NULL байж болохыг санах хэрэгтэй (браузераар
   * нээгээгүй санал) — тэр тохиолдолд NULL хэвээр үлдэж, юүлүүрийн хариунд
   * `contracted_amount_missing_count`-оор ил гарна.
   */
  const explicit = numOrNull(body.contract_amount);
  const contractAmount =
    explicit !== null
      ? explicit
      : next === 'active'
        ? (current.contract_amount ?? current.total_amount)
        : current.contract_amount;

  const note = strOrNull(body.note);

  /*
   * ⚠️ UPDATE-ыг ЭХЛЭЭД, дараа нь түүх — `db.batch()`-аар БИШ. Batch нь нэг
   * транзакц ч мөн, 0 мөр өөрчилсөн UPDATE нь АЛДАА биш: зэрэг ирсэн хоёр
   * шилжилтийн хоёр дахь нь `AND status = ?`-д унасан ч түүхийн мөр нь
   * ХЭВЭЭР commit болно (хуурамч бичлэг). Дараалуулснаар түүх зөвхөн
   * бодитоор болсон шилжилт дээр л үүснэ.
   */
  const updated = await c.env.DB.prepare(
    `UPDATE quotes
        SET status = ?, status_changed_at = datetime('now'),
            contract_amount = ?, updated_at = datetime('now')
      WHERE id = ? AND status = ?`,
  )
    .bind(next, contractAmount, id, current.status)
    .run();

  // `AND status = ?` нь зэрэг ирсэн хоёр шилжилтийн сүүлчийнхийг барина
  // (progress.ts-ийн зөвшөөрлийн уралдааны хамгаалалттай ижил хэв маяг).
  if (!updated.meta.changes) {
    return c.json({ error: 'Төлөв энэ хооронд өөрчлөгдсөн байна', code: 'STALE_STATUS' }, 409);
  }

  await c.env.DB.prepare(
    `INSERT INTO quote_status_history
            (quote_id, from_status, to_status, contract_amount, note, changed_by_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, current.status, next, contractAmount, note, user.sub)
    .run();

  return c.json({
    ok: true,
    status: next,
    contract_amount: contractAmount,
  });
});

/** GET /api/quotes/:id/status-history — шилжилтийн түүх (шинэ нь дээр). */
quotes.get('/:id/status-history', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const { results } = await c.env.DB.prepare(
    `SELECT h.id, h.from_status, h.to_status, h.contract_amount, h.note,
            h.changed_at, u.full_name AS changed_by_name
       FROM quote_status_history h
       LEFT JOIN users u ON u.id = h.changed_by_id
      WHERE h.quote_id = ?
      ORDER BY h.changed_at DESC, h.id DESC`,
  )
    .bind(id)
    .all();
  return c.json(results ?? []);
});

/**
 * PUT /api/quotes/:id — хадгалах (autosave).
 *
 * ⚠️ Сервер `workbook`-ийг ДАХИН ТООЦООЛДОГГҮЙ — энэ нь ЗОРИУДЫН шийдвэр.
 * Томьёоны хөдөлгүүр (TARIF/SUM/хөндлөн лавлагаа …) зөвхөн клиент талд
 * амьдардаг; түүнийг backend-д давхардуулбал хоёр хувилбар зөрөх эрсдэлтэй.
 * `total_amount` нь дүнгийн нүдний клиентийн тооцоолсон утгын КЭШ бөгөөд
 * зөвхөн жагсаалт/MCP-д зориулагдсан; баримтын жинхэнэ дүн үргэлж дэвтрээс
 * (хэвлэх хуудас ч мөн адил) дахин тооцоологдоно. Клиент тэр нүдийг
 * `anchors.total`-д ганцаар найдалгүй, `lib/resolveTotal.ts`-ийн гурван
 * шатлалт шийдэгчээр олдог (anchor → `addons` → шошго).
 *
 * ⚠️ `total_amount` нь ТҮЛХҮҮР ИРСЭН үед л бичигдэнэ — доорх `hasTotal`-ыг үз.
 *
 * Дэвтрийг ТҮҮХИЙ JSON-оор хадгална — уншихад `parseWorkbook` нормчилно.
 */
quotes.put('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  type SavePayload = {
    title?: unknown;
    client_name?: unknown;
    doc_date?: unknown;
    prepared_by?: unknown;
    project_id?: unknown;
    workbook?: unknown;
    total_amount?: unknown;
  };
  const body = await c.req.json<SavePayload>().catch(() => ({}) as SavePayload);

  if (!body.workbook || typeof body.workbook !== 'object') {
    return c.json({ error: 'workbook is required' }, 400);
  }
  const sheetJson = JSON.stringify(body.workbook);
  if (byteLen(sheetJson) > MAX_WORKBOOK_BYTES) {
    return c.json({ error: 'Ажлын дэвтэр хэт том (>2 MB)' }, 413);
  }

  /**
   * ⚠️ `total_amount`-ыг ТҮЛХҮҮР ИРСЭН эсэхээр шийднэ. `numOrNull` нь дутуу
   * түлхүүрийг `null` болгодог тул тэр талбаргүй ачаалал илгээсэн клиент сайн
   * кэшийг чимээгүй УСТГАДАГ байв (жагсаалтад «—» болно). Илэрхий
   * `total_amount: null` бол хэвээр NULL бичнэ — хоосорсон баримт «—» рүү
   * буцаж чадах ёстой.
   */
  const hasTotal = Object.prototype.hasOwnProperty.call(body, 'total_amount');

  const docDate = str(body.doc_date);
  const row = await c.env.DB.prepare(
    `UPDATE quotes
        SET title = ?, client_name = ?, doc_date = ?, prepared_by = ?,
            project_id = ?, sheet_json = ?,
            total_amount = CASE WHEN ? = 1 THEN ? ELSE total_amount END,
            updated_at = datetime('now')
      WHERE id = ?
      RETURNING updated_at`,
  )
    .bind(
      str(body.title),
      strOrNull(body.client_name),
      isDate(docDate) ? docDate : todayInUB(),
      strOrNull(body.prepared_by),
      intOrNull(body.project_id),
      sheetJson,
      hasTotal ? 1 : 0,
      numOrNull(body.total_amount),
      id,
    )
    .first<{ updated_at: string }>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  return c.json({ ok: true, updated_at: row.updated_at });
});

// DELETE /api/quotes/:id
quotes.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  // ⚠️ Хүүхэд мөрийг ГАРААР устгана: D1 нь тунхагласан `ON DELETE CASCADE`-ыг
  // ажиллах үедээ шахдаггүй тул зөвхөн FK-д найдвал өнчин мөр үлдэнэ
  // (репогийн manual-delete конвенц — email.ts / repair.ts г.м.).
  // Мөн англи хувилбарын эх-холбоосыг ГАРААР тайлна: `source_quote_id`-ийн
  // `ON DELETE SET NULL` (0181) ч мөн адил зөвхөн баримтжуулалт.
  await c.env.DB.prepare('UPDATE quotes SET source_quote_id = NULL WHERE source_quote_id = ?')
    .bind(id)
    .run();
  await c.env.DB.prepare('DELETE FROM quote_status_history WHERE quote_id = ?').bind(id).run();
  const res = await c.env.DB.prepare('DELETE FROM quotes WHERE id = ?').bind(id).run();
  if (!res.meta.changes) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true, message: 'Deleted' });
});

/* =============================================================
 * POST /api/quotes/:id/translate — «Англи хувилбар үүсгэх»
 * -------------------------------------------------------------
 * Монгол саналын дэвтрийг орчуулж ШИНЭ, ХОЛБООТОЙ мөр (`lang='en'`,
 * `source_quote_id=:id`, migration 0181) үүсгэнэ. Редактор, autosave,
 * хэвлэх/PDF, статусын машин бүгд нэг-баримтын замаа өөрчлөлтгүй ашиглана —
 * админ англи хувилбарыг энгийн санал шиг нээж хянана/засна.
 *
 * Орчуулгын хоёр давхарга (`lib/quoteTranslate.ts`):
 *   • Загварын ТОГТМОЛ бичвэр — гараар баталсан толь (QUOTE_MN_EN_DICT).
 *   • Чөлөөт бичвэр (барилгын нэр, гарчиг, PM-ийн тэмдэглэл) — Workers AI
 *     батч. AI хэсэгчлэн/бүрэн унасан ч нүд ХООСОРДОГГҮЙ — монголоороо үлдэнэ.
 *
 * Томьёо ХЭЗЭЭ Ч тооцоологдохгүй — зөвхөн доторх "..." литерал орчуулагдана,
 * тиймээс `total_amount` кэшийг шууд хуулж болно (дүн өөрчлөгдөх шалтгаангүй).
 * `prepared_by` / `client_name` — оноосон нэр тул ХӨРВҮҮЛЭХГҮЙ, шууд хуулна.
 * ============================================================= */
quotes.post('/:id/translate', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user');

  const row = await c.env.DB.prepare(
    `SELECT id, title, client_name, variant_key, doc_date, prepared_by, project_id,
            template_id, template_version, sheet_json, total_amount, contract_amount,
            status, status_changed_at, source, lang, source_quote_id, created_by_id,
            created_at, updated_at
       FROM quotes WHERE id = ?`,
  )
    .bind(id)
    .first<QuoteRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  // Англи хувилбараас дахин хувилбар үүсгэхгүй — орчуулгын гинж үүсэх ёсгүй.
  if (row.lang === 'en') {
    return c.json({ error: 'Энэ санал аль хэдийн англи хувилбар байна' }, 400);
  }
  // 'manual' мөр ХООСОН дэвтэртэй (0170) — орчуулах агуулга алга.
  if (row.source === 'manual') {
    return c.json({ error: 'Гараар бүртгэсэн саналд ажлын дэвтэр байхгүй' }, 400);
  }

  // Нэг эхээс НЭГ л англи хувилбар — давхар даралт/зэрэг хүсэлт 409 авна.
  // Frontend энэ хариугаар байгаа хувилбар руу нь үсэрдэг.
  const existing = await c.env.DB.prepare(
    `SELECT id FROM quotes WHERE source_quote_id = ? AND lang = 'en'`,
  )
    .bind(id)
    .first<{ id: number }>();
  if (existing) return c.json({ error: 'EXISTS', existing_id: existing.id }, 409);

  const workbook = parseWorkbook(row.sheet_json);

  // Тольд байхгүй, кирилтэй БҮХ мөр — НЭГ батч жагсаалтаар AI руу. Гарчиг нь
  // баримт бүрийн ЧӨЛӨӨТ бичвэр (объектын нэр агуулдаг) тул мөн батчид орно.
  const titleMn = row.title.trim();
  /**
   * ТАЙЛБАРЫН ОРЧУУЛГЫН ДАВХАРГА (`sheet.notes.i18n`).
   *
   * ⚠️ Баримтын доод тайлбарууд 2026-08-24-нөөс хойш хуудасны агуулгаас
   * ДИНАМИКААР угсрагддаг (`frontend/.../lib/quoteNotes.ts`) — «…"BMS" системийн
   * 6%, төсвийн 8% нэмж тооцов» гэсэн өгүүлбэр нь идэвхтэй нэмэгдлээс хамаарч
   * өөрчлөгддөг. Тиймээс тэдгээр нь `QUOTE_MN_EN_DICT`-ийн БҮТЭН-МӨРИЙН
   * түлхүүрт таарахаа больсон бөгөөд эс тооцвол улсын стандартын эшлэл бүр
   * Workers AI-д унана (AI унавал мөр МОНГОЛООРОО үлдэж англи баримт дундуураа
   * хоёр хэлтэй болно).
   *
   * ⇒ Frontend бичихдээ монгол↔англи хосыг хуудсанд ХАМТ хадгалдаг. Энэ
   *   давхаргыг AI-ийн үр дүнгээс ДЭЭГҮҮР тавьж, AI руу ч огт явуулахгүй.
   */
  const noteI18n = new Map<string, string>();
  for (const sh of workbook.sheets) {
    const pairs = sh.notes?.i18n;
    if (!pairs) continue;
    for (const [mn, en] of Object.entries(pairs)) {
      if (typeof mn === 'string' && typeof en === 'string' && en.trim() !== '') {
        noteI18n.set(mn.trim(), en);
      }
    }
  }

  const wanted = new Set(collectTranslatables(workbook));
  for (const mn of noteI18n.keys()) wanted.delete(mn);
  if (needsAiTranslation(titleMn)) wanted.add(titleMn);
  const aiStrings = [...wanted].map((mn, i) => ({ id: `s${i + 1}`, mn }));
  const aiById =
    aiStrings.length > 0 ? await translateStringsAi(c.env.AI, aiStrings) : new Map<string, string>();
  // id → en хариуг эх мөр → en болгож буулгана (алгассан id = монголоор үлдэнэ).
  const aiBySource = new Map<string, string>();
  for (const s of aiStrings) {
    const en = aiById.get(s.id);
    if (en) aiBySource.set(s.mn, en);
  }
  // ⚠️ ДАРААЛАЛ ЧУХАЛ: тайлбарын давхарга AI-гаас ДЭЭГҮҮР бичигдэнэ.
  for (const [mn, en] of noteI18n) aiBySource.set(mn, en);

  let enWorkbook = applyTranslations(workbook, aiBySource);
  const enTitle = translateFreeText(row.title, aiBySource);

  // POST /-той ижил: гарчгийн anchor байвал орчуулсан гарчгийг тэр нүдэнд
  // литералаар бичнэ (хэвлэмэл дээр баримт нэрээ шууд харуулна).
  const titleAnchor = enWorkbook.anchors.title;
  if (enTitle && titleAnchor) {
    enWorkbook = {
      ...enWorkbook,
      sheets: enWorkbook.sheets.map((s) => {
        if (s.id !== titleAnchor.sheet) return s;
        const prev = s.cells[titleAnchor.ref] ?? {};
        return {
          ...s,
          cells: { ...s.cells, [titleAnchor.ref]: { ...prev, v: enTitle, f: undefined } },
        };
      }),
    };
  }

  const sheetJson = JSON.stringify(enWorkbook);
  if (byteLen(sheetJson) > MAX_WORKBOOK_BYTES) {
    return c.json({ error: 'Ажлын дэвтэр хэт том (>2 MB)' }, 413);
  }

  // POST /-ийн толь: `status`/`source` схемийн DEFAULT-аараа ('draft'/'app')
  // үүснэ, `quote_status_history`-д мөр БИЧИХГҮЙ (шилжилт нь зөвхөн
  // PATCH /:id/status-аар). Эхийн статус ямар ч байсан орчуулга НООРОГ.
  //
  // ⚠️ Дээрх EXISTS шалгалтаас хойш AI дуудлага ХЭДЭН СЕКУНД зарцуулсан тул
  // зэрэгцээ хүсэлт амжсан байж болно. Хоёр давхар хамгаалалт: (1) 0181-ийн
  // хэсэгчилсэн UNIQUE индекс өгөгдлийн санд шахна, (2) зөрчлийг энд барьж
  // хэрэглэгчид ЯГ ижил 409 EXISTS хариу өгнө (500 биш).
  const created = await c.env.DB.prepare(
    `INSERT INTO quotes (title, client_name, variant_key, doc_date, prepared_by,
                         project_id, template_id, template_version, sheet_json,
                         total_amount, lang, source_quote_id, created_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?, ?)
     RETURNING id, title, client_name, variant_key, doc_date, prepared_by, project_id,
               template_id, template_version, sheet_json, total_amount, contract_amount,
               status, status_changed_at, source, lang, source_quote_id, created_by_id,
               created_at, updated_at`,
  )
    .bind(
      enTitle,
      row.client_name, // оноосон нэр — хөрвүүлэхгүй
      row.variant_key,
      row.doc_date,
      row.prepared_by, // оноосон нэр — хөрвүүлэхгүй
      row.project_id,
      row.template_id,
      row.template_version,
      sheetJson,
      row.total_amount,
      id,
      user.sub,
    )
    .first<QuoteRow>()
    .catch(async (err: unknown) => {
      // UNIQUE зөрчил = яг энэ хооронд өөр хүсэлт англи хувилбарыг үүсгэсэн.
      if (!/UNIQUE/i.test(String(err))) throw err;
      const raced = await c.env.DB.prepare(
        `SELECT id FROM quotes WHERE source_quote_id = ? AND lang = 'en'`,
      )
        .bind(id)
        .first<{ id: number }>();
      return raced ? { raced: raced.id } : null;
    });
  if (!created) return c.json({ error: 'Insert failed' }, 500);
  if ('raced' in created) {
    return c.json({ error: 'EXISTS', existing_id: created.raced }, 409);
  }

  const author = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ full_name: string }>();
  return c.json(toQuote(created, author?.full_name ?? null), 201);
});

/* =============================================================
 * POST /api/quotes/:id/scope — «Хэсэгчилсэн санал»
 * -------------------------------------------------------------
 * «Зөвхөн эскиз зураг хийлгэвэл үнэ хэд болох вэ?» — захиалагчийн хамгийн
 * түгээмэл эргэн асуулт. Урьд нь PM ДҮН-гийн томьёог гараар задалж, мөрүүдийг
 * устгаж, менежмент/НӨАТ-ыг дахин холбодог байсныг (хэрэглэгчийн гомдол
 * 2026-08-19) нэг товч болгов.
 *
 * ⚠️ ХУМИЛТЫГ СЕРВЕР ХИЙХГҮЙ. Клиент `lib/scopeQuote.ts` → `applyScope`-ээр
 * хумигдсан дэвтрийг бэлдээд илгээнэ; энэ маршрут зөвхөн эх саналын толгойн
 * талбаруудыг өвлүүлж ШИНЭ мөр бичнэ. Яагаад: `addons` spec-ийн семантик
 * (зардлын мөр хасах, томьёоны лавлагаа шилжүүлэх) нь бүхэлдээ frontend-ийн
 * `lib/addons.ts`/`sheetOps.ts`-д амьдардаг ба сервер томьёог ХЭЗЭЭ Ч
 * тооцоолдоггүй (файлын толгойг үз). Түүнийг энд давхардуулах нь дахин нэг
 * ИХЭР ФАЙЛ төрүүлнэ.
 *
 * `POST /:id/translate`-ЭЭС ГУРВАН ЯЛГАА — санамсаргүй хуулбарлахаас сэргийлж
 * тус бүрийг нь бичив:
 *   1. `source_quote_id` ТАВИГДАХГҮЙ. Орчуулга нь эх саналтайгаа НЭГ хэлцэл
 *      (тиймээс юүлүүрээс хасагдаж, төлөв нь эх дээрээ солигддог) — харин
 *      хэсэгчилсэн санал нь ӨӨРӨӨ явах ТУСДАА хэлцэл: захиалагч зөвхөн
 *      эскизийг нь авч гэрээ байгуулж болно. `source_quote_id` тавьбал
 *      `PATCH /:id/status` түүнийг 400 (`TRANSLATED_QUOTE`) болгож, тэр санал
 *      юүлүүрт хэзээ ч орохгүй үлдэнэ.
 *   2. `doc_date` = ӨНӨӨДӨР (эхийнх БИШ). Энэ бол шинээр гаргаж буй санал —
 *      юүлүүр `doc_date`-ээр шүүдэг тул хуучин огноогоор бичвэл өнгөрсөн
 *      улирал руу унана.
 *   3. `total_amount` КЛИЕНТЭЭС ирнэ. Дэвтрийг хумихад дүн ЗААВАЛ өөрчлөгддөг
 *      тул эхийн кэшийг хуулах нь ЗӨРЧИЛТЭЙ (орчуулга нь харин дүнг хөнддөггүй
 *      тул тэнд хуулах нь зөв). Клиент дүнг эх бичвэрийнхээ хөдөлгүүрээр
 *      тооцоод илгээнэ; ирээгүй бол NULL үлдэж, засварлагч анх нээгдэхдээ
 *      өөрөө нөхнө (`QuoteEditorPage`-ийн `needsSeed`).
 * ============================================================= */
quotes.post('/:id/scope', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user');

  type ScopePayload = {
    workbook?: unknown;
    title?: unknown;
    variant_keys?: unknown;
    total_amount?: unknown;
  };
  const body = await c.req.json<ScopePayload>().catch(() => ({}) as ScopePayload);

  if (!body.workbook || typeof body.workbook !== 'object') {
    return c.json({ error: 'workbook is required' }, 400);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, title, client_name, variant_key, doc_date, prepared_by, project_id,
            template_id, template_version, sheet_json, total_amount, contract_amount,
            status, status_changed_at, source, lang, source_quote_id, created_by_id,
            created_at, updated_at
       FROM quotes WHERE id = ?`,
  )
    .bind(id)
    .first<QuoteRow>();
  if (!row) return c.json({ error: 'Not found' }, 404);

  // 'manual' / 'import' мөр ХООСОН дэвтэртэй (0170) — хумих хамрах хүрээ алга.
  if (row.source !== 'app') {
    return c.json({ error: 'Гараар бүртгэсэн саналд ажлын дэвтэр байхгүй' }, 400);
  }

  const sheetJson = JSON.stringify(body.workbook);
  if (byteLen(sheetJson) > MAX_WORKBOOK_BYTES) {
    return c.json({ error: 'Ажлын дэвтэр хэт том (>2 MB)' }, 413);
  }

  // Төрөл: клиентийн тооцоолсон (эскиз/ажлын зураг) > эхийнх. Хамрах хүрээнд
  // каталогийн төрөлтэй юу ч таараагүй үед (жишээ нь зөвхөн геологи) баримт
  // ангилалгүй үлдэх ёсгүй.
  const selected = normalizeVariantKeys(body.variant_keys);
  const variantKey = selected.length > 0 ? serializeVariantKeys(selected) : row.variant_key;

  const title = str(body.title) || row.title;

  // Гарчгийн anchor байвал шинэ гарчгийг нүдэнд нь мөн бичнэ (POST / -тэй ижил
  // гэрээ) — эс бөгөөс хэвлэмэл дээр ЭХ саналын нэр үлдэнэ.
  let workbook = parseWorkbook(sheetJson);
  const titleAnchor = workbook.anchors.title;
  if (title && titleAnchor) {
    workbook = {
      ...workbook,
      sheets: workbook.sheets.map((s) => {
        if (s.id !== titleAnchor.sheet) return s;
        const prev = s.cells[titleAnchor.ref] ?? {};
        return {
          ...s,
          cells: { ...s.cells, [titleAnchor.ref]: { ...prev, v: title, f: undefined } },
        };
      }),
    };
  }
  const finalJson = JSON.stringify(workbook);
  if (byteLen(finalJson) > MAX_WORKBOOK_BYTES) {
    return c.json({ error: 'Ажлын дэвтэр хэт том (>2 MB)' }, 413);
  }

  /* ⚠️⚠️ ЭВДЭРСЭН `template_id`-ЭЭС ХАМГААЛАХ — 2026-08-19-нд зассан.
   *
   * Эх саналын `template_id`-ыг ШУУД хуулах нь FOREIGN KEY зөрчил төрүүлж,
   * маршрут 500 буцаадаг байв. Шалтгаан: загвар устгагдахад `quotes.template_id`
   * нь `ON DELETE SET NULL` гэж ЗАРЛАГДСАН ч D1 нь гүйцэтгэлийн үед гадаад
   * түлхүүрийг ЭНФОРС ХИЙДЭГГҮЙ (CLAUDE.md), тиймээс хуучин мөрүүдэд байхгүй
   * загвар руу заасан лавлагаа ҮЛДДЭГ. Локал miniflare нь ЭНФОРС ХИЙДЭГ тул
   * INSERT тэр даруй унана.
   *
   * Хэмжсэн (2026-08-19, локал): #19/#20 нь `template_id = 16` гэж заасан
   * атлаа `quote_templates`-д зөвхөн 11, 22 байсан → «Хэсэгчилсэн санал»
   * товч бүх бодит санал дээр 500 өгч байв.
   *
   * Шийдэл: лавлагаа ОДОО ч хүчинтэй эсэхийг шалгаад, эс бөгөөс NULL. Загварын
   * холбоо нь зөвхөн мэдээллийн зориулалттай (баримт өөрөө `sheet_json`-доо
   * бүрэн бие даасан) тул алдагдах нь хор хөнөөлгүй — 500 өгөхөөс хамаагүй дээр.
   */
  let templateId: number | null = row.template_id ?? null;
  if (templateId !== null) {
    const tpl = await c.env.DB.prepare('SELECT id FROM quote_templates WHERE id = ?')
      .bind(templateId)
      .first<{ id: number }>();
    if (!tpl) templateId = null;
  }

  // `status`/`source` нь схемийн DEFAULT-аараа ('draft'/'app') үүснэ,
  // `quote_status_history`-д мөр БИЧИХГҮЙ — шилжилт нь зөвхөн PATCH /:id/status.
  // `lang` нь эхийнхээ хэлээр (англи саналыг хумихад англи хэвээр).
  const created = await c.env.DB.prepare(
    `INSERT INTO quotes (title, client_name, variant_key, doc_date, prepared_by,
                         project_id, template_id, template_version, sheet_json,
                         total_amount, lang, created_by_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id, title, client_name, variant_key, doc_date, prepared_by, project_id,
               template_id, template_version, sheet_json, total_amount, contract_amount,
               status, status_changed_at, source, lang, source_quote_id, created_by_id,
               created_at, updated_at`,
  )
    .bind(
      title,
      row.client_name,
      variantKey,
      todayInUB(),
      row.prepared_by,
      row.project_id,
      templateId,
      row.template_version,
      finalJson,
      numOrNull(body.total_amount),
      row.lang,
      user.sub,
    )
    .first<QuoteRow>();
  if (!created) return c.json({ error: 'Insert failed' }, 500);

  const author = await c.env.DB.prepare('SELECT full_name FROM users WHERE id = ?')
    .bind(user.sub)
    .first<{ full_name: string }>();
  return c.json(toQuote(created, author?.full_name ?? null), 201);
});

/* ===========================================================
 * GET /api/quotes/:id/pdf
 * -----------------------------------------------------------
 * Server-side PDF export via Cloudflare Browser Rendering —
 * `routes/projects.ts`-ийн төслийн тайлангийн PDF-ийн яг хуулбар:
 * богино насны JWT → headless Chromium → хэвлэх хуудас → PDF.
 *
 * ⚠️ landscape: true — үнийн санал 14 БАГАНАТАЙ тул хөндлөн A4.
 * =========================================================== */
quotes.get('/:id/pdf', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const user = c.get('user');

  const quote = await c.env.DB.prepare('SELECT id, title, lang FROM quotes WHERE id = ?')
    .bind(id)
    .first<{ id: number; title: string; lang: QuoteLang }>();
  if (!quote) return c.json({ error: 'Not found' }, 404);

  // Богино насны (60 с) токен — cold-start + render-д хүрэлцэхүйц урт,
  // алдагдвал хор хөнөөлгүй богино. Дуудагчийн өөрийнх нь эрхийг авч явна.
  const printToken = await signToken(
    { sub: user.sub, role: user.role, purpose: 'print' },
    c.env.JWT_SECRET,
    1 / 60, // цаг -> 1 минут
  );

  const printUrl =
    `${c.env.FRONTEND_URL.replace(/\/+$/, '')}/quotes/${id}/print` +
    `?t=${encodeURIComponent(printToken)}`;

  let browser: BrowserSession | null = null;
  try {
    browser = await launchBrowser(c.env.BROWSER);
    const page = await browser.newPage();

    // A4 хэвтээ ~150 dpi.
    await page.setViewport({ width: 1754, height: 1240, deviceScaleFactor: 1 });

    await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    // Хэвлэх хуудас нь өгөгдөл + Noto Sans ачаалагдсаны дараа <body>-д
    // [data-print-ready="true"] тавина (Cloudflare-ийн headless Chromium
    // кирилл glyph-гүй ирдэг). Timeout-ыг тэвчинэ — дутуу зураг нь
    // 500-аас арай дээр.
    try {
      await page.waitForSelector('body[data-print-ready="true"]', { timeout: 25000 });
    } catch {
      /* fall through and snapshot whatever we have */
    }

    /**
     * ⚠️ ЗАХ НЬ ХОЁР ДАВХАРГА (2026-08-17) — эдгээр тоог дангаар нь бүү зас.
     *
     * `frontend/.../printStyles.ts` нь захыг хуваасан:
     *   • `@page { margin: 7mm 5mm }`      — цаасны зах,
     *   • `.quote-print { padding: 7mm }`  — баримтын ДОТООД зай.
     * Нийлбэр = 14mm / 12mm буюу өмнөх ганц давхаргатай ЯГ ижил. (Учир нь
     * браузераар ГАРААР хэвлэхэд хэрэглэгчийн «Захын хэмжээ: Байхгүй»
     * тохиргоо `@page`-ийг дардаг ба тэр үед дотоод padding л баримтыг
     * хамгаална.)
     *
     * Тиймээс энд ч мөн `@page`-ийн 7/5mm-ыг ЯГ давтана. Chromium нь `@page`
     * дүрэм зарлагдсан үед CSS-ийн хуудасны загварт шилжиж puppeteer-ийн
     * margin-ыг үл тоомсорлодог гэж үздэг ч, тэр зан төлөв хувилбараас
     * хамаардаг: хоёуланг нь ИЖИЛ тавьсанаар аль нь ялсан ч үр дүн НЭГ
     * (7/5 гадна + 7 дотор = 14/12) байхаар баталгаажуулав. 14/12 гэж
     * үлдээвэл puppeteer ялах тохиолдолд нийт зах 21/19mm болж, баганы
     * тооцооны 273mm агуулгын өргөн 259mm болж шахагдана.
     */
    const pdf = await page.pdf({
      format: 'A4',
      landscape: true,
      printBackground: true,
      margin: { top: '7mm', right: '5mm', bottom: '7mm', left: '5mm' },
    });

    const safeName =
      (quote.title || 'quote')
        .normalize('NFKD')
        .replace(/[^\p{L}\p{N}\s_-]/gu, '')
        .trim()
        .replace(/\s+/g, '_')
        .slice(0, 80) || 'quote';

    // Англи хувилбарт англи дагавар — «_unijn_sanal» нь монгол баримтынх.
    const suffix = quote.lang === 'en' ? '_price_quote.pdf' : '_unijn_sanal.pdf';

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}${suffix}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[quote-pdf] render failed', err);
    return c.json(
      {
        error: 'PDF үүсгэхэд алдаа гарлаа',
        detail: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* swallow */
      }
    }
  }
});

export default quotes;
