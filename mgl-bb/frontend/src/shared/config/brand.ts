/**
 * Байгууллагын брэнд + локал тохиргоо — FRONTEND тал.
 *
 * `backend/src/lib/orgConfig.ts`-ийн ихэр.  Хоёуланг нь ХАМТ өөрчил.
 *
 * ГУРВАН ДАВХАРГА, дарааллаараа:
 *   1. `DEFAULT_BRAND`        — MGL-ийн одоогийн утга (эцсийн fallback)
 *   2. `VITE_ORG_*` env       — build үед шигтгэгдэнэ
 *   3. `GET /api/settings/org`— DB, админ амьдаар солино (хамгийн өндөр эрх)
 *
 * ⚠️ ЯАГААД БУЛЬ ХОЁР ЭХ СУРВАЛЖ ХЭРЭГТЭЙ ВЭ:
 *    Нэвтрэх хуудас нь ямар ч API дуудалтаас ӨМНӨ брэндээ зурах ёстой —
 *    тиймээс DB ганцаараа хангалтгүй (тахиа–өндөгний асуудал).  Build үеийн
 *    env нь эхний зурагтыг хангана; нэвтэрсний дараа DB-гийн утга дээрээс нь
 *    буух ба `localStorage`-д хадгалагдана, ингэснээр ДАРААГИЙН эхний зурагт
 *    аль хэдийн зөв брэндтэй гарна.
 *
 * ⚠️ Юу ч тохируулаагүй үед үр дүн нь MGL-ийн өнөөдрийн UI-тай ЯГ ИЖИЛ.
 */

export interface Brand {
  /** Богино нэр — хуудасны гарчиг, PWA, wordmark.  ж: `MGL` */
  nameShort: string;
  /** Дэлгэцийн нэр.  ж: `MGL E&C` */
  name: string;
  /** Монгол хууль ёсны нэр. */
  legalNameMn: string;
  /** Англи хууль ёсны нэр — `© 2026 …` мөрөнд ордог. */
  legalNameEn: string;
  /** Аппликейшны нэр — `<title>` дагавар, XLSX metadata. */
  appName: string;
  /** Захирлын албан тушаал — ЗХ (ASR) баримтын «Хянасан». */
  directorTitleMn: string;
  /** Захирлын нэр — ЗХ баримтын «Хянасан» мөрийн өгөгдмөл.  Хоосон байж болно. */
  directorNameMn: string;
  /** Нийтийн вэб сайт — лого дарахад очих. */
  websiteUrl: string;
  /** Холбоо барих хаяг — UI placeholder. */
  contactEmail: string;
  /** Байгуулагдсан он — landing «EST. NNNN». */
  foundedYear: string;
  /** Товч уриа, монгол — нүүр дэлгэц. */
  taglineMn: string;
  /** Товч уриа, англи — нэвтрэх дэлгэцийн wordmark-ийн хажууд. */
  taglineEn: string;
  /** Дашбоардын Google Calendar id.  Хоосон бол виджет нуугдана. */
  calendarId: string;
  /** IANA цагийн бүс — Google Calendar embed-ийн `ctz`. */
  timezone: string;
  /** ISO 4217 валютын код. */
  currencyCode: string;
  /** Валютын тэмдэг. */
  currencySymbol: string;
  /** Төслийн кодын угтвар — богино нэр гаргахад тайрна.  Хоосон бол тайрахгүй. */
  projectCodePrefix: string;
  /** Чөлөөний журмын баримтын дугаар — UI дээр иш татагдана. */
  hrPolicyDoc: string;
}

/* ------------------------------------------------------------------ */
/*  Дефолт — MGL-ийн ӨНӨӨДРИЙН утгууд                                  */
/* ------------------------------------------------------------------ */
export const DEFAULT_BRAND: Brand = {
  nameShort: 'MGL',
  name: 'MGL E&C',
  legalNameMn: '«Эм Жи Эл И Эн Си» ХХК',
  legalNameEn: 'MGL E&C LLC',
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
};

/* ------------------------------------------------------------------ */
/*  Build үеийн env давхарга                                           */
/* ------------------------------------------------------------------ */

function envStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

const E = import.meta.env as Record<string, unknown>;

/** Build үед тогтсон суурь — нэвтрэхээс өмнөх эхний зурагт үүнийг хэрэглэнэ. */
const BUILD_BRAND: Brand = {
  nameShort: envStr(E.VITE_ORG_NAME_SHORT) ?? DEFAULT_BRAND.nameShort,
  name: envStr(E.VITE_ORG_NAME) ?? DEFAULT_BRAND.name,
  legalNameMn: envStr(E.VITE_ORG_LEGAL_NAME_MN) ?? DEFAULT_BRAND.legalNameMn,
  legalNameEn: envStr(E.VITE_ORG_LEGAL_NAME_EN) ?? DEFAULT_BRAND.legalNameEn,
  appName: envStr(E.VITE_ORG_APP_NAME) ?? DEFAULT_BRAND.appName,
  directorTitleMn: envStr(E.VITE_ORG_DIRECTOR_TITLE_MN) ?? DEFAULT_BRAND.directorTitleMn,
  directorNameMn:
    typeof E.VITE_ORG_DIRECTOR_NAME_MN === 'string'
      ? (E.VITE_ORG_DIRECTOR_NAME_MN as string).trim()
      : DEFAULT_BRAND.directorNameMn,
  websiteUrl: envStr(E.VITE_ORG_WEBSITE_URL) ?? DEFAULT_BRAND.websiteUrl,
  contactEmail: envStr(E.VITE_ORG_CONTACT_EMAIL) ?? DEFAULT_BRAND.contactEmail,
  foundedYear: envStr(E.VITE_ORG_FOUNDED_YEAR) ?? DEFAULT_BRAND.foundedYear,
  taglineMn: envStr(E.VITE_ORG_TAGLINE_MN) ?? DEFAULT_BRAND.taglineMn,
  taglineEn: envStr(E.VITE_ORG_TAGLINE_EN) ?? DEFAULT_BRAND.taglineEn,
  calendarId:
    typeof E.VITE_ORG_CALENDAR_ID === 'string'
      ? (E.VITE_ORG_CALENDAR_ID as string).trim()
      : DEFAULT_BRAND.calendarId,
  timezone: envStr(E.VITE_ORG_TIMEZONE) ?? DEFAULT_BRAND.timezone,
  currencyCode: envStr(E.VITE_ORG_CURRENCY_CODE) ?? DEFAULT_BRAND.currencyCode,
  currencySymbol: envStr(E.VITE_ORG_CURRENCY_SYMBOL) ?? DEFAULT_BRAND.currencySymbol,
  // Угтварыг ЗОРИУДААР хоосон болгож болно ('' → тайралт хийхгүй).
  projectCodePrefix:
    typeof E.VITE_ORG_PROJECT_CODE_PREFIX === 'string'
      ? (E.VITE_ORG_PROJECT_CODE_PREFIX as string).trim()
      : DEFAULT_BRAND.projectCodePrefix,
  hrPolicyDoc: envStr(E.VITE_ORG_HR_POLICY_DOC) ?? DEFAULT_BRAND.hrPolicyDoc,
};

/* ------------------------------------------------------------------ */
/*  API давхарга (`GET /api/settings/org`)                             */
/* ------------------------------------------------------------------ */

/** `backend/src/routes/settings.ts` → `orgConfigDto()`-ийн ЯГ ТЭР бүтэц. */
export interface OrgSettingsDto {
  name_short?: string;
  name?: string;
  legal_name_mn?: string;
  legal_name_en?: string;
  app_name?: string;
  director_title_mn?: string;
  director_name_mn?: string;
  website_url?: string;
  contact_email?: string;
  founded_year?: string;
  tagline_mn?: string;
  tagline_en?: string;
  calendar_id?: string;
  timezone?: string;
  currency_code?: string;
  currency_symbol?: string;
  project_code_prefix?: string;
  hr_policy_doc?: string;
  /* Доорхыг frontend хэрэглэдэггүй ч API буцаадаг тул төрөлд бий. */
  ceo_user_id?: number | null;
  shift_standard?: string;
  shift_early?: string;
  summer_months?: number[];
}

const STORAGE_KEY = 'org:brand';

function fromDto(base: Brand, dto: OrgSettingsDto): Brand {
  return {
    nameShort: envStr(dto.name_short) ?? base.nameShort,
    name: envStr(dto.name) ?? base.name,
    legalNameMn: envStr(dto.legal_name_mn) ?? base.legalNameMn,
    legalNameEn: envStr(dto.legal_name_en) ?? base.legalNameEn,
    appName: envStr(dto.app_name) ?? base.appName,
    directorTitleMn: envStr(dto.director_title_mn) ?? base.directorTitleMn,
    directorNameMn:
      typeof dto.director_name_mn === 'string' ? dto.director_name_mn.trim() : base.directorNameMn,
    websiteUrl: envStr(dto.website_url) ?? base.websiteUrl,
    contactEmail: envStr(dto.contact_email) ?? base.contactEmail,
    foundedYear: envStr(dto.founded_year) ?? base.foundedYear,
    taglineMn: envStr(dto.tagline_mn) ?? base.taglineMn,
    taglineEn: envStr(dto.tagline_en) ?? base.taglineEn,
    // Календарийг ЗОРИУДААР хоосон болгож болно ('' → виджет нуугдана).
    calendarId:
      typeof dto.calendar_id === 'string' ? dto.calendar_id.trim() : base.calendarId,
    timezone: envStr(dto.timezone) ?? base.timezone,
    currencyCode: envStr(dto.currency_code) ?? base.currencyCode,
    currencySymbol: envStr(dto.currency_symbol) ?? base.currencySymbol,
    projectCodePrefix:
      typeof dto.project_code_prefix === 'string'
        ? dto.project_code_prefix.trim()
        : base.projectCodePrefix,
    hrPolicyDoc: envStr(dto.hr_policy_doc) ?? base.hrPolicyDoc,
  };
}

/** Өмнөх сессид хадгалсан утга — эхний зурагт үүнийг ашиглана. */
function readCache(): Brand {
  if (typeof localStorage === 'undefined') return BUILD_BRAND;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return BUILD_BRAND;
    return fromDto(BUILD_BRAND, JSON.parse(raw) as OrgSettingsDto);
  } catch {
    // Эвдэрсэн cache нь аппыг унагаах ЁСГҮЙ — build давхаргаар үргэлжилнэ.
    return BUILD_BRAND;
  }
}

let active: Brand = readCache();

/** Идэвхтэй брэнд — SYNC.  React-аас гадуур (утилит, экспорт) ч дуудагдана. */
export function brand(): Brand {
  return active;
}

/** Сервер дээрх тохиргоог тусган, дараагийн эхний зурагтад зориулж хадгална. */
export function applyOrgSettings(dto: OrgSettingsDto): Brand {
  active = fromDto(BUILD_BRAND, dto);
  try {
    localStorage?.setItem(STORAGE_KEY, JSON.stringify(dto));
  } catch {
    // Хувийн горим / дүүрсэн сан — cache-гүйгээр ажиллана.
  }
  for (const fn of listeners) fn(active);
  return active;
}

/** Тестэд болон гараар (нэвтрэхээс гарахад cache цэвэрлэх). */
export function resetBrand(): void {
  active = BUILD_BRAND;
  try {
    localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* үл тоомсорлоно */
  }
  for (const fn of listeners) fn(active);
}

/* ------------------------------------------------------------------ */
/*  React-д захиалах (useSyncExternalStore-д тохирсон)                  */
/* ------------------------------------------------------------------ */

type Listener = (b: Brand) => void;
const listeners = new Set<Listener>();

export function subscribeBrand(fn: () => void): () => void {
  const wrapped: Listener = () => fn();
  listeners.add(wrapped);
  return () => {
    listeners.delete(wrapped);
  };
}

export function getBrandSnapshot(): Brand {
  return active;
}
