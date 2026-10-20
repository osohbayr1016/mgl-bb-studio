/**
 * Байгууллагын тохиргоо — СИСТЕМИЙГ ӨӨР КОМПАНИД СУУЛГАХАД ЗАСАХ ГАНЦ ГАЗАР.
 *
 * Урьд нь компанийн нэр, ажлын ээлжийн цаг, цагийн бүс, CEO-гийн id зэрэг нь
 * кодын олон арван газарт шууд бичигдсэн байсан.  Энэ модуль тэдгээрийг НЭГ
 * каталогт цуглуулж, гурван давхаргаас уншина:
 *
 *   1. `DEFAULT_ORG_CONFIG`   — MGL-ийн ОДООГИЙН утга (эцсийн fallback)
 *   2. `[vars]` / `.dev.vars` — deploy үед тогтох ENV
 *   3. `app_settings` `org.*` — DB, админ амьдаар солино (хамгийн өндөр эрх)
 *
 * ⚠️ ЗАРЧИМ: юу ч тохируулаагүй үед үр дүн нь MGL-ийн production-ы өнөөдрийн
 *    зан төлөвтэй ЯГ ИЖИЛ байна.  Тиймээс энэ модулийг нэвтрүүлэх нь ажиллаж
 *    байгаа системд ямар ч ажиглагдах өөрчлөлт үүсгэхгүй.
 *
 * ⚠️ ДУУДЛАГЫН ГАРЫН ҮСЭГ ӨӨРЧЛӨГДӨӨГҮЙ.  `SHIFTS`, `isSummerSchedule()`,
 *    `excludeCeoSql()` зэрэг нь sync хэвээр — тэдгээр нь SQL хэлтэрхий үүсгэдэг
 *    ба цэвэр функцүүд дотор сууж байгаа тул async болгох нь 25 газар засах
 *    шаардлага үүсгэнэ.  Оронд нь энэ модуль хүсэлт бүрийн эхэнд НЭГ УДАА
 *    ачаалагдаж (`loadOrgConfig`), доод түвшний функцүүд `orgConfig()`-ээс
 *    sync уншина.
 */

import { parseModules, type ModuleId } from './modules';
import { currentTenantId } from './requestContext';

/** Нэг ажлын ээлжийн тодорхойлолт (UB цагаар минутаар). */
export interface ShiftSpec {
  startMinutes: number;
  endMinutes: number;
  label: string;
}

export interface OrgConfig {
  /* ---- Таних тэмдэг ---- */
  /** Богино нэр — хуудасны гарчиг, PWA, wordmark.  ж: `MGL` */
  nameShort: string;
  /** Дэлгэцийн нэр.  ж: `MGL E&C` */
  name: string;
  /** Монгол хууль ёсны нэр — үнийн санал, гэрээний баримтад ордог. */
  legalNameMn: string;
  /** Англи хууль ёсны нэр — орчуулсан баримт, PDF-д ордог. */
  legalNameEn: string;
  /** Аппликейшны нэр — `<title>` дагавар, API root, XLSX metadata. */
  appName: string;
  /** Захирлын албан тушаалын бичиглэл — ЗХ (ASR) баримтын «Хянасан». */
  directorTitleMn: string;
  /** Захирлын НЭР — ЗХ баримтын «Хянасан» мөрийн өгөгдмөл.  Хоосон бол
   *  талбар хоосон гарч, хэрэглэгч өөрөө бөглөнө. */
  directorNameMn: string;
  /** Нийтийн вэб сайт (лого дарахад очих). */
  websiteUrl: string;
  /** Ерөнхий холбоо барих хаяг — UI-н placeholder, тайлангийн footer. */
  contactEmail: string;
  /** Байгуулагдсан он — landing хуудасны «EST. NNNN». */
  foundedYear: string;
  /** Товч уриа, монгол — нүүр/нэвтрэх дэлгэц. */
  taglineMn: string;
  /** Товч уриа, англи — нэвтрэх дэлгэцийн wordmark-ийн хажууд. */
  taglineEn: string;
  /** Дашбоардад embed хийх Google Calendar-ийн id.  Хоосон бол виджет нуугдана.
   *  `ORG_CALENDAR_ID`, эс бөгөөс синкийн `GOOGLE_CALENDAR_ID`-аас өвлөнө. */
  calendarId: string;

  /* ---- Байршил / локал ---- */
  /** IANA цагийн бүс.  ЭНЭ НЭГ УТГА `todayInUB`, deadline sweep, календарь,
   *  мэйл синк дөрвүүлэнд хэрэглэгдэнэ. */
  timezone: string;
  /** ISO 4217 валютын код. */
  currencyCode: string;
  /** Валютын тэмдэг — үнийн саналын хүснэгтэд. */
  currencySymbol: string;

  /* ---- Дотоод конвенц ---- */
  /** Төслийн кодын угтвар (`MGL-260314 …` → богино нэр гаргахад тайрна).
   *  Хоосон мөр бол тайралт хийхгүй. */
  projectCodePrefix: string;
  /** Чөлөөний журмын баримтын дугаар — UI дээр иш татагдана. */
  hrPolicyDoc: string;

  /* ---- Байгууллагын бүтэц ---- */
  /** «admin-аас дээгүүр» гүйцэтгэх захирлын user id.  `null` бол тухайн
   *  онцгой зан төлөв бүхэлдээ унтарна (ирцээс чөлөөлөх, самбарт гарах). */
  ceoUserId: number | null;

  /**
   * СИСТЕМИЙН/ТУРШИЛТЫН хэрэглэгчдийн id.  Эдгээр нь бодит ажилтан БИШ тул
   * «хэн ажилдаа ирэх ёстой вэ» гэсэн бүх roster-оос хасагдана: ирцийн
   * «Ирээгүй» жагсаалт, өдрийн хүснэгт, товчоо, ирц баталгаажуулалт,
   * чөлөөний сануулга, ticker.  Нэвтрэх эрх нь ХЭВЭЭР — `status='inactive'`
   * болгох нь login-г үхүүлдэг тул туршилтын данс ашиглах боломжгүй болно.
   *
   * Дефолт нь хоосон — тохируулаагүй суулгацад ямар ч өөрчлөлт гарахгүй.
   */
  systemUserIds: readonly number[];

  /* ---- Ажлын цаг ---- */
  shiftStandard: ShiftSpec;
  shiftEarly: ShiftSpec;
  /** Дунд ээлж — 08:30–17:30.  2026-09-01-нээс нэмэгдсэн, хүүхдээ
   *  цэцэрлэг/сургуульд хүргэдэг ажилтанд зориулсан сонголт. */
  shiftMid: ShiftSpec;
  /** Бүх ажилтныг эрт ээлж рүү албадах сарууд (1–12).  Хоосон массив бол
   *  улирлын албадлага байхгүй. */
  summerMonths: readonly number[];

  /* ---- Лиценз ---- */
  /**
   * Тухайн байгууллагад НЭЭЛТТЭЙ модулиуд (`lib/modules.ts`).
   *
   * `null` = ХЯЗГААРЛАЛТГҮЙ (бүх модуль нээлттэй).  Энэ нь дефолт бөгөөд
   * ЗОРИУДААР: MGL-ийн ажиллаж байгаа production дээр энэ давхаргыг
   * нэвтрүүлэхэд ямар ч функц алга болох ЁСГҮЙ.  Хязгаарлалт нь зөвхөн
   * ил тохируулсан үед үйлчилнэ.
   */
  enabledModules: ReadonlySet<ModuleId> | null;
}

/* ------------------------------------------------------------------ */
/*  Дефолт — MGL-ийн ӨНӨӨДРИЙН утгууд.  БҮҮ ӨӨРЧИЛ: энэ бол шинэ        */
/*  тохиргоо нэвтрүүлэхэд production ижил хэвээр үлдэх баталгаа.        */
/* ------------------------------------------------------------------ */
export const DEFAULT_ORG_CONFIG: OrgConfig = {
  nameShort: 'MGL',
  name: 'MGL E&C',
  legalNameMn: '«Эм Жи Эл И Эн Си» ХХК',
  legalNameEn: '"MGL E&C" LLC',
  appName: 'MGL Progress',
  directorTitleMn: 'MGL E&C Захирал',
  directorNameMn: 'Б.Билгүүн',
  websiteUrl: 'https://mglenc.com',
  contactEmail: 'info@mglenc.com',
  foundedYear: '2010',
  taglineMn: 'Барилгын инженерийн цогц шийдэл',
  taglineEn: 'Engineering & Architecture',
  calendarId: 'mgl.eandc@gmail.com',
  timezone: 'Asia/Ulaanbaatar',
  currencyCode: 'MNT',
  currencySymbol: '₮',
  projectCodePrefix: 'MGL',
  hrPolicyDoc: 'Дотоод журам MGL-HR/0124',
  ceoUserId: 2,
  systemUserIds: [],
  shiftStandard: { startMinutes: 9 * 60, endMinutes: 18 * 60, label: '09:00–18:00' },
  shiftEarly: { startMinutes: 8 * 60, endMinutes: 17 * 60, label: '08:00–17:00' },
  shiftMid: { startMinutes: 8 * 60 + 30, endMinutes: 17 * 60 + 30, label: '08:30–17:30' },
  summerMonths: [6, 7, 8],
  enabledModules: null,
};

/* ------------------------------------------------------------------ */
/*  Задлан шинжлэх туслахууд                                            */
/* ------------------------------------------------------------------ */

function cleanString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

/** `'09:00-18:00'` эсвэл `'09:00–18:00'` (en-dash) → `ShiftSpec`.
 *  Буруу формат бол `null` — дуудагч дефолтоо хадгална. */
export function parseShift(raw: unknown): ShiftSpec | null {
  const s = cleanString(raw);
  if (!s) return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)\s*[-–—]\s*([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  const startMinutes = parseInt(m[1]!, 10) * 60 + parseInt(m[2]!, 10);
  const endMinutes = parseInt(m[3]!, 10) * 60 + parseInt(m[4]!, 10);
  // Ээлж нь эхлэхээсээ өмнө дуусах ёсгүй (шөнийн ээлж дэмжигдээгүй).
  if (endMinutes <= startMinutes) return null;
  return { startMinutes, endMinutes, label: `${m[1]}:${m[2]}–${m[3]}:${m[4]}` };
}

/** `'6,7,8'` → `[6,7,8]`.  Хоосон мөр → хоосон массив (улирлын албадлагагүй),
 *  1–12-оос гадуур эсвэл тоо биш утга → `null` (дуудагч дефолтоо хадгална). */
export function parseMonths(raw: unknown): readonly number[] | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length === 0) return [];
  const out: number[] = [];
  for (const part of t.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (!Number.isInteger(n) || n < 1 || n > 12) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Эерэг бүхэл тоо, эсвэл `'none'`/`'null'`/`'0'` → `null` (онцлогийг унтраах). */
export function parseOptionalUserId(raw: unknown, fallback: number | null): number | null {
  const s = cleanString(raw);
  if (s === null) return fallback;
  if (s === 'none' || s === 'null' || s === '0') return null;
  const n = parseInt(s, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** `'61,62'` → `[61,62]`.  Хоосон мөр → хоосон массив (хасах хүнгүй).
 *  Тоо биш / эерэг бус утга агуулсан бол `null` — дуудагч дефолтоо хадгална. */
export function parseUserIds(raw: unknown): readonly number[] | null {
  if (typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.length === 0) return [];
  const out: number[] = [];
  for (const part of t.split(',')) {
    const n = parseInt(part.trim(), 10);
    if (!Number.isInteger(n) || n <= 0) return null;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  ENV давхарга                                                        */
/* ------------------------------------------------------------------ */

/**
 * `Env`-ийн бүтцийн дэд олонлог.  `types.ts`-ээс `Env`-ийг импортлохгүй —
 * `types.ts` нь `lib/projectCategories`-ыг импортолдог бөгөөд тэр нь дараа
 * нь энэ модулийг хэрэглэх магадлалтай тул тойрог хамаарал үүсэхээс сэргийлэв.
 */
export interface OrgEnvVars {
  ORG_NAME_SHORT?: string;
  ORG_NAME?: string;
  ORG_LEGAL_NAME_MN?: string;
  ORG_LEGAL_NAME_EN?: string;
  ORG_APP_NAME?: string;
  ORG_DIRECTOR_TITLE_MN?: string;
  ORG_DIRECTOR_NAME_MN?: string;
  ORG_WEBSITE_URL?: string;
  ORG_CONTACT_EMAIL?: string;
  ORG_FOUNDED_YEAR?: string;
  ORG_TAGLINE_MN?: string;
  ORG_TAGLINE_EN?: string;
  ORG_CALENDAR_ID?: string;
  /** Google Calendar синкийн id (`lib/googleCalendarSync.ts`).  `calendarId`
   *  тохируулаагүй бол үүнээс өвлөнө — нэг утгыг хоёр газар бичихгүйн тулд. */
  GOOGLE_CALENDAR_ID?: string;
  ORG_TIMEZONE?: string;
  ORG_CURRENCY_CODE?: string;
  ORG_CURRENCY_SYMBOL?: string;
  ORG_PROJECT_CODE_PREFIX?: string;
  ORG_HR_POLICY_DOC?: string;
  ORG_CEO_USER_ID?: string;
  /** Таслалаар тусгаарласан систем/туршилтын хэрэглэгчийн id-ууд. */
  ORG_SYSTEM_USER_IDS?: string;
  ORG_SHIFT_STANDARD?: string;
  ORG_SHIFT_MID?: string;
  ORG_SHIFT_EARLY?: string;
  ORG_SUMMER_MONTHS?: string;
  /** Таслалаар тусгаарласан модулийн жагсаалт.  Хоосон = хязгаарлалтгүй. */
  ORG_MODULES_ENABLED?: string;
}

/** ENV-ээс уншиж дефолт дээр давхарлана.  Тохируулаагүй талбар дефолт хэвээр. */
export function orgConfigFromEnv(env: OrgEnvVars): OrgConfig {
  const d = DEFAULT_ORG_CONFIG;
  return {
    nameShort: cleanString(env.ORG_NAME_SHORT) ?? d.nameShort,
    name: cleanString(env.ORG_NAME) ?? d.name,
    legalNameMn: cleanString(env.ORG_LEGAL_NAME_MN) ?? d.legalNameMn,
    legalNameEn: cleanString(env.ORG_LEGAL_NAME_EN) ?? d.legalNameEn,
    appName: cleanString(env.ORG_APP_NAME) ?? d.appName,
    directorTitleMn: cleanString(env.ORG_DIRECTOR_TITLE_MN) ?? d.directorTitleMn,
    // Нэрийг ЗОРИУДААР хоосон болгож болно ('' → баримт дээр хоосон талбар).
    directorNameMn:
      typeof env.ORG_DIRECTOR_NAME_MN === 'string'
        ? env.ORG_DIRECTOR_NAME_MN.trim()
        : d.directorNameMn,
    websiteUrl: cleanString(env.ORG_WEBSITE_URL) ?? d.websiteUrl,
    contactEmail: cleanString(env.ORG_CONTACT_EMAIL) ?? d.contactEmail,
    foundedYear: cleanString(env.ORG_FOUNDED_YEAR) ?? d.foundedYear,
    taglineMn: cleanString(env.ORG_TAGLINE_MN) ?? d.taglineMn,
    taglineEn: cleanString(env.ORG_TAGLINE_EN) ?? d.taglineEn,
    calendarId:
      cleanString(env.ORG_CALENDAR_ID) ?? cleanString(env.GOOGLE_CALENDAR_ID) ?? d.calendarId,
    timezone: cleanString(env.ORG_TIMEZONE) ?? d.timezone,
    currencyCode: cleanString(env.ORG_CURRENCY_CODE) ?? d.currencyCode,
    currencySymbol: cleanString(env.ORG_CURRENCY_SYMBOL) ?? d.currencySymbol,
    // Угтварыг ЗОРИУДААР хоосон болгож болно ('' → тайралт хийхгүй), тиймээс
    // `cleanString` биш шууд шалгалт.
    projectCodePrefix:
      typeof env.ORG_PROJECT_CODE_PREFIX === 'string'
        ? env.ORG_PROJECT_CODE_PREFIX.trim()
        : d.projectCodePrefix,
    hrPolicyDoc: cleanString(env.ORG_HR_POLICY_DOC) ?? d.hrPolicyDoc,
    ceoUserId: parseOptionalUserId(env.ORG_CEO_USER_ID, d.ceoUserId),
    systemUserIds: parseUserIds(env.ORG_SYSTEM_USER_IDS) ?? d.systemUserIds,
    shiftStandard: parseShift(env.ORG_SHIFT_STANDARD) ?? d.shiftStandard,
    shiftEarly: parseShift(env.ORG_SHIFT_EARLY) ?? d.shiftEarly,
    shiftMid: parseShift(env.ORG_SHIFT_MID) ?? d.shiftMid,
    summerMonths: parseMonths(env.ORG_SUMMER_MONTHS) ?? d.summerMonths,
    enabledModules: parseModules(env.ORG_MODULES_ENABLED) ?? d.enabledModules,
  };
}

/* ------------------------------------------------------------------ */
/*  DB давхарга (`app_settings` дахь `org.*` түлхүүрүүд)                 */
/* ------------------------------------------------------------------ */

/** `app_settings`-д хэрэглэгдэх түлхүүр → `OrgConfig` талбарын зураглал.
 *  `Record<keyof OrgConfig, string>` тул шинэ талбар нэмээд энд нэмэхээ
 *  мартвал compile унана — `webPush.ts`-ийн `CATEGORY_OF`-той ижил заль. */
export const ORG_SETTING_KEYS: Record<keyof OrgConfig, string> = {
  nameShort: 'org.name_short',
  name: 'org.name',
  legalNameMn: 'org.legal_name_mn',
  legalNameEn: 'org.legal_name_en',
  appName: 'org.app_name',
  directorTitleMn: 'org.director_title_mn',
  directorNameMn: 'org.director_name_mn',
  websiteUrl: 'org.website_url',
  contactEmail: 'org.contact_email',
  foundedYear: 'org.founded_year',
  taglineMn: 'org.tagline_mn',
  taglineEn: 'org.tagline_en',
  calendarId: 'org.calendar_id',
  timezone: 'org.timezone',
  currencyCode: 'org.currency_code',
  currencySymbol: 'org.currency_symbol',
  projectCodePrefix: 'org.project_code_prefix',
  hrPolicyDoc: 'org.hr_policy_doc',
  ceoUserId: 'org.ceo_user_id',
  systemUserIds: 'org.system_user_ids',
  shiftStandard: 'org.shift_standard',
  shiftEarly: 'org.shift_early',
  shiftMid: 'org.shift_mid',
  summerMonths: 'org.summer_months',
  enabledModules: 'org.modules_enabled',
};

/** DB-гээс уншсан мөрүүдийг суурь тохиргоо дээр давхарлана. */
export function overlayOrgSettings(base: OrgConfig, rows: Map<string, string>): OrgConfig {
  const k = ORG_SETTING_KEYS;
  const str = (key: string, fallback: string): string => cleanString(rows.get(key)) ?? fallback;
  return {
    nameShort: str(k.nameShort, base.nameShort),
    name: str(k.name, base.name),
    legalNameMn: str(k.legalNameMn, base.legalNameMn),
    legalNameEn: str(k.legalNameEn, base.legalNameEn),
    appName: str(k.appName, base.appName),
    directorTitleMn: str(k.directorTitleMn, base.directorTitleMn),
    directorNameMn: rows.has(k.directorNameMn)
      ? (rows.get(k.directorNameMn) ?? '').trim()
      : base.directorNameMn,
    websiteUrl: str(k.websiteUrl, base.websiteUrl),
    contactEmail: str(k.contactEmail, base.contactEmail),
    foundedYear: str(k.foundedYear, base.foundedYear),
    taglineMn: str(k.taglineMn, base.taglineMn),
    taglineEn: str(k.taglineEn, base.taglineEn),
    // Календарийг ЗОРИУДААР хоосон болгож болно ('' → виджет нуугдана).
    calendarId: rows.has(k.calendarId)
      ? (rows.get(k.calendarId) ?? '').trim()
      : base.calendarId,
    timezone: str(k.timezone, base.timezone),
    currencyCode: str(k.currencyCode, base.currencyCode),
    currencySymbol: str(k.currencySymbol, base.currencySymbol),
    projectCodePrefix: rows.has(k.projectCodePrefix)
      ? (rows.get(k.projectCodePrefix) ?? '').trim()
      : base.projectCodePrefix,
    hrPolicyDoc: str(k.hrPolicyDoc, base.hrPolicyDoc),
    ceoUserId: rows.has(k.ceoUserId)
      ? parseOptionalUserId(rows.get(k.ceoUserId), base.ceoUserId)
      : base.ceoUserId,
    systemUserIds: parseUserIds(rows.get(k.systemUserIds)) ?? base.systemUserIds,
    shiftStandard: parseShift(rows.get(k.shiftStandard)) ?? base.shiftStandard,
    shiftEarly: parseShift(rows.get(k.shiftEarly)) ?? base.shiftEarly,
    shiftMid: parseShift(rows.get(k.shiftMid)) ?? base.shiftMid,
    summerMonths: parseMonths(rows.get(k.summerMonths)) ?? base.summerMonths,
    // Хоосон мөр = хязгаарлалтгүй (бүх модуль).  Тиймээс `rows.has` шалгалт
    // хэрэггүй — `parseModules` хоосныг `null` болгож буцаана.
    enabledModules: rows.has(k.enabledModules)
      ? parseModules(rows.get(k.enabledModules))
      : base.enabledModules,
  };
}

/* ------------------------------------------------------------------ */
/*  Идэвхтэй тохиргоо                                                   */
/* ------------------------------------------------------------------ */

/**
 * Компани тус бүрийн ачаалсан тохиргоо.
 *
 * ⚠️ ЯАГААД Map ВЭ:  нэг Worker олон компанийг үйлчилдэг тул ганц хувьсагч
 *    хангалтгүй — хүсэлтүүд `await` дээр солбицдог учир A-гийн тохиргоо
 *    B-гийн хүсэлтийн дунд дарагдана.  Компани бүр өөрийн бичлэгтэй, аль нь
 *    болохыг `requestContext.ts`-ийн AsyncLocalStorage хэлнэ.
 */
interface CacheEntry {
  cfg: OrgConfig;
  /** Хамгийн сүүлд DB-гээс уншсан агшин.  «Хэзээ ч ачаалаагүй» гэдгийг `0`
   *  БИШ `-Infinity`-ээр илэрхийлнэ: `0` нь «1970 онд ачаалсан» гэсэн утгатай
   *  болж, `nowMs` жижиг үед (тест) TTL-ийн шалгалт худал эерэг өгч, эхний
   *  уншилтыг АЛГАСДАГ. */
  loadedAtMs: number;
}

/**
 * ⚠️ Зөвхөн УТГА хадгална — PROMISE ХЭЗЭЭ Ч БИШ.  Өмнө нь `inFlight` Map нь
 *    DB уншилтын promise-ийг хүсэлт хооронд хуваалцдаг байв.  Workers дээр
 *    promise нь түүнийг үүсгэсэн хүсэлтийн I/O контекстод харьяалагдана:
 *    тэр хүсэлт цуцлагдвал (хэрэглэгч хуудсаа хаах, сүлжээ тасрах) D1 уншилт
 *    зогсож promise ХЭЗЭЭ Ч дуусахгүй, `finally` ажиллахгүй — тэгээд тэр
 *    isolate-д ирэх БҮХ дараагийн хүсэлт `app.use('*')` дээр үүрд гацдаг байв
 *    (прод 2026-09-29: `POST /api/auth/login` CPU 0 мс, wall 12 с, «систем рүү
 *    нэвтэрч чадахгүй»; 2026-09-25-ны тайлбаргүй гацалт ч энэ).
 */
const cache = new Map<string, CacheEntry>();

/** DB-г дахин уншихгүй байх хугацаа.  Worker isolate урт наслах тул админы
 *  өөрчлөлт хамгийн ихдээ энэ хугацааны дараа хүчин төгөлдөр болно. */
const TTL_MS = 60_000;

function entry(tenantId: string): CacheEntry {
  const hit = cache.get(tenantId);
  if (hit) return hit;
  const fresh: CacheEntry = { cfg: DEFAULT_ORG_CONFIG, loadedAtMs: Number.NEGATIVE_INFINITY };
  cache.set(tenantId, fresh);
  return fresh;
}

/**
 * Идэвхтэй тохиргоо — SYNC.  `loadOrgConfig` дуудагдаагүй байсан ч (cron,
 * Durable Object, unit test) дефолт буцаана, өөрөөр хэлбэл ХЭЗЭЭ Ч
 * `undefined` биш бөгөөд MGL-ийн өнөөдрийн зан төлөвөөс хазайхгүй.
 */
export function orgConfig(): OrgConfig {
  return entry(currentTenantId()).cfg;
}

/** Тестэд болон гар аргаар тохируулах.  Production кодод хэрэглэхгүй. */
export function setOrgConfig(next: OrgConfig): void {
  cache.set(currentTenantId(), { cfg: next, loadedAtMs: Number.NEGATIVE_INFINITY });
}

/** Дефолт руу буцаах (тестийн цэвэрлэгээ) — БҮХ компанийн бичлэгийг арилгана. */
export function resetOrgConfig(): void {
  cache.clear();
}

/** DB-гээс уншиж кэшийг шинэчилнэ.  Алдаа гарвал ENV давхарга үлдэнэ. */
async function reloadOrgConfig(
  tenantId: string,
  env: OrgEnvVars & { DB?: D1Database },
  nowMs: number,
): Promise<OrgConfig> {
  const fromEnv = orgConfigFromEnv(env);
  const db = env.DB;
  if (!db) {
    cache.set(tenantId, { cfg: fromEnv, loadedAtMs: nowMs });
    return fromEnv;
  }
  let cfg: OrgConfig;
  try {
    const { results } = await db
      .prepare("SELECT key, value FROM app_settings WHERE key LIKE 'org.%'")
      .all<{ key: string; value: string }>();
    const map = new Map<string, string>();
    for (const r of results ?? []) map.set(r.key, r.value);
    cfg = overlayOrgSettings(fromEnv, map);
  } catch {
    // app_settings байхгүй / унших боломжгүй — ENV давхаргаар үргэлжилнэ.
    cfg = fromEnv;
  }
  cache.set(tenantId, { cfg, loadedAtMs: nowMs });
  return cfg;
}

export interface LoadOrgConfigOptions {
  /**
   * TTL-ийг тоохгүй, DB-гээс ЗААВАЛ дахин уншина.  Тохиргоог сая бичсэний
   * дараа (`PUT /api/settings/org`) шинэ утгыг тэр дороо буцаахад хэрэглэнэ.
   *
   * ⚠️ Урьд нь энэ зорилгоор `nowMs`-д ИРЭЭДҮЙН цаг дамжуулдаг заль
   *    хэрэглэсэн байсан нь АЛДААТАЙ байв: тэр нь `loadedAtMs`-ийг ирээдүй рүү
   *    түлхэж, дараагийн бодит цагийн дуудлагууд бүгд `nowMs - loadedAtMs < 0`
   *    болж cache-д баригдан, тохиргоо 10 минут ХӨЛДДӨГ байсан.  Локал дээр
   *    бодитоор ажиллуулж илрүүлсэн.
   */
  force?: boolean;
  /** Цагийг гаднаас өгөх (тест).  Өгөөгүй бол `Date.now()`. */
  nowMs?: number;
}

export async function loadOrgConfig(
  env: OrgEnvVars & { DB?: D1Database },
  options: LoadOrgConfigOptions = {},
): Promise<OrgConfig> {
  const nowMs = options.nowMs ?? Date.now();
  const tenantId = currentTenantId();

  if (options.force === true) return reloadOrgConfig(tenantId, env, nowMs);

  const cur = entry(tenantId);
  if (nowMs - cur.loadedAtMs < TTL_MS) return cur.cfg;

  // Хүсэлт бүр ӨӨРИЙН уншилтаа хийнэ (дээрх ⚠️).  TTL дууссан агшинд
  // зэрэг ирсэн цөөн хүсэлт тус бүр нэг жижиг SELECT хийх нь хямд —
  // өөр хүсэлтийн promise-ийг хүлээх нь isolate-ийг бүхэлд нь гацаадаг.
  return reloadOrgConfig(tenantId, env, nowMs);
}
