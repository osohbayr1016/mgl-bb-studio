/**
 * §48 АВТОМАТ БАГИЙН ИЛРҮҮЛЭЛТ — ЦОРЫН ГАНЦ хэрэгжүүлэлт.
 *
 * ⚠️ НОТОЛГОО ДЭЭШЭЭ, ШИЙДВЭР ДООШОО.  Add-in баг ЗАРЛАХГҮЙ — нотолгоо
 * илгээнэ, сервер шатыг ажиллуулж, хариуг буцаана.  Шалтгаан:
 * `routes/learning.ts:338-340` нь клиентээс ирсэн хэн болохыг аль хэдийн
 * татгалздаг, `lib/jwt.ts` нь гарын үсэг + `exp`-ийг л шалгадаг тул клиент
 * дурын багийг зарлаж чадна.  Мөн энэ бол залруулга ~20 PC-г дахин
 * суулгахгүйгээр тархах ЦОРЫН ГАНЦ хэлбэр.
 *
 * ⚠️ ЭНЭ ФАЙЛЫН ХОЁР ХЭСЭГ:
 *   1. ЦЭВЭР ЛОГИК (`decideTeam`, `scopesFor`, `complianceEnabled`,
 *      `foldableTeamCodes`, `isTeamCodeShape`, `behaviorCandidate`,
 *      `sheetPrefixCandidate`) — D1 хамааралгүй, `node --test`-ээр бүрэн
 *      хэмжигдэнэ (`teamContext.test.ts`).
 *   2. НЭГ ӨГӨГДЛИЙН УНШИЛТ (`resolveTeamContext`) — шатны SQL-ийг НЭГ
 *      `db.batch()`-аар гүйцэтгээд цэвэр логик руу дамжуулна.
 *
 * ⚠️ БАГИЙН ТООГ (8 / 9 / 11) ЭНД ХЭЗЭЭ Ч ХАТУУ БИЧИХГҮЙ.  Эзэн 2026-08-30-нд
 * салбарын НАЙМ багийг баталсан нь ТӨЛӨВЛӨЛТИЙН тоо (хэдэн дүрмийн багц
 * зохиох вэ), ажиллах үеийн литерал БИШ — ростер `teams.code`-оос, багцтай
 * багууд `rules.team_code`-оос уншигдана.
 */
import { foldText } from './textFold';
import { codePrefix } from './revitMatch';

/* ================================================================== */
/*  1. ХААЛТТАЙ ОЛОНЛОГУУД                                             */
/* ================================================================== */

/** §48-R4-ийн `team_source`.  ХААЛТТАЙ олонлог — SQL CHECK БИШ, TS Record. */
export const TEAM_SOURCES = [
  'binding', //        1-р шат  — батлагдсан хуудасны холбоос → blocks.team_id
  'document', //       1b       — revit_documents.team_code
  'project_shares', // 2-р шат  — project_team_shares-д ганц салбар
  'user_primary', //   3-р шат  — user_teams.is_primary = 1
  'sheet_prefix', //   4-р шат  — ЗӨВХӨН БАТАЛГААЖУУЛАГЧ
  'behavior', //       5-р шат  — ЗӨВХӨН БАТАЛГААЖУУЛАГЧ
  'manual', //         хүний баталгаажуулалт (§73)
  'uncertain', //      6-р шат
] as const;
export type TeamSource = (typeof TEAM_SOURCES)[number];

/**
 * Шат тус бүрийн итгэлцэл.
 *
 * ⚠️ ЭНЭ БОЛ ИТГЭЛЦЛИЙН УРАЛДААН БИШ — §48-R3 нь «preferred hierarchy» гэж
 * заасан, жигнэсэн холимог БИШ.  ШИЙДВЭРЛЭГЧ шатууд нь v2-ын дарааллаар
 * (binding → project metadata → identity) явах ба ЭХНИЙ нэр дэвшигч
 * гаргасан нь ЯЛНА.  Итгэлцэл нь тусад нь МЭДЭЭЛДЭГ тоо —
 * `project_shares` (0.75) нь `user_primary` (0.85)-аас ӨМНӨ шалгагдана.
 */
export const TIER_CONFIDENCE: Record<TeamSource, number> = {
  binding: 1.0,
  document: 0.95,
  project_shares: 0.75,
  user_primary: 0.85,
  sheet_prefix: 0.65,
  behavior: 0.6,
  manual: 1.0,
  uncertain: 0.0,
};

/**
 * Хүлээн авах босго.  Харьцуулалт нь ХАТУУ `>` — `>=` эсэх нь бүхэл шат
 * оршин байх эсэхийг шийддэг тул кодод ил бичигдэнэ.
 */
export const TEAM_ACCEPT_CONFIDENCE = 0.7;

/**
 * ШИЙДВЭРЛЭГЧ vs БАТАЛГААЖУУЛАГЧ.
 *
 * ⚠️ 4- ба 5-р шат нь сессийг ХЭЗЭЭ Ч ДАНГААРАА шийдэхгүй.  Шалтгаан
 * §2.7-д хэмжигдсэн: `textFold.ts:51` давхар үсгийг хураадаг тул
 * `codePrefix('ББ-01') === 'b'`, мөн `foldText('BB') === 'b'` — өөртэйгээ
 * нийцтэй ч ХЭТ ӨРГӨН.  «Б-101» эсвэл «Бетон хийцийн план» нь бүгд BB
 * болж, инженерийн зурж буй зүйлийн ОРОЙГООР бүтээцийн дүрмийн багц
 * ачаалагдах байсан.
 *
 * ⚠️ ДАРААЛАЛ НЬ ЛОАД-БЕАРИНГ: `decideTeam` энэ массивын дарааллаар
 * ялагчийг сонгоно (итгэлцлийн дарааллаар БИШ).
 */
export const RESOLVING_SOURCES: readonly TeamSource[] = [
  'binding',
  'document',
  'project_shares',
  'user_primary',
] as const;

export const CORROBORATING_SOURCES: readonly TeamSource[] = [
  'sheet_prefix',
  'behavior',
] as const;

/**
 * ХҮНЭЭС ГАРААГҮЙ шийдвэрлэгч шатууд — төсөл/баримтын дохио, үйлдэж буй
 * хүнийг ОГТ асуудаггүй.  Тэдгээрийн ЯЛАГЧ нь `user_primary`-тай зөрвөл
 * үр дүн UNCERTAIN болно (`decideTeam`-ийн ЗӨРЧЛИЙН ДҮРЭМ).
 */
export const IMPERSONAL_SOURCES: readonly TeamSource[] = [
  'binding',
  'document',
  'project_shares',
] as const;

/** §47-ын мэдлэгийн дөрвөн түвшин — БОДИТ ХАДГАЛАЛТТАЙ. */
export const KNOWLEDGE_SCOPES = ['GLOBAL', 'COMPANY', 'TEAM', 'PROJECT'] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

/** Нөөцлөгдсөн ХУУРАМЧ кодууд — бодит багт ХЭЗЭЭ Ч оноож болохгүй. */
export const RESERVED_TEAM_CODES: ReadonlySet<string> = new Set([
  'NORM',
  'GENERAL',
  'ROOMS',
  'FIRE',
  'EXTORG',
]);

/**
 * `project_team_shares`-ийн 2-р шатнаас ил хасагдах код.
 *
 * ⚠️ ЭНЭ БОЛ ЖАГСААЛТЫН ҮЛДСЭН ЦОРЫН ГАНЦ ЛИТЕРАЛ бөгөөд ЗӨВШӨӨРӨГДСӨН:
 * эзэн 2026-08-30-нд MGMT-ийг салбарын наймаас ИЛ хассан тул тэр нь энэ
 * шатны ЧИМЭЭГҮЙ ялагч болох ёсгүй.  ⛔ `EZ`, `GT` хоёрыг ЭНД ХАСАХГҮЙ:
 * тэд хууль ёсны `team_code` бөгөөд хуваарь дээр гарвал шат нь тэднийг ЗӨВ
 * шийднэ; дүрмийн багцгүй нь `complianceEnabled`-ээр ДАРАА НЬ
 * илэрхийлэгдэнэ.  ИЛРҮҮЛЭЛТ ба БАГЦ хоёрыг БҮҮ ХОЛИ.
 */
export const SHARES_EXCLUDED_TEAM_CODES: ReadonlySet<string> = new Set(['MGMT']);

/* ================================================================== */
/*  2. ТӨРЛҮҮД                                                         */
/* ================================================================== */

export interface TeamCandidate {
  team_code: string;
  source: TeamSource;
  confidence: number;
  /** Тухайн шатны түүхий тоо — evidence_json руу орно.  ЗАМ, ФАЙЛЫН НЭР БИШ. */
  detail?: Record<string, number | string>;
}

export interface TeamDecision {
  team_code: string | null;
  team_confidence: number;
  team_source: TeamSource;
  /** 2 элемент бол зөрчил — UNCERTAIN.  NULL = зөрчилгүй. */
  conflict: string[] | null;
  /** Шатны БҮХ нэр дэвшигч — UI-ийн сонгогчийг урьдчилан тэмдэглэхэд. */
  candidates: TeamCandidate[];
}

export const UNCERTAIN_SOURCE: TeamSource = 'uncertain';

/* ================================================================== */
/*  3. ЦЭВЭР ЛОГИК                                                     */
/* ================================================================== */

/**
 * Кодын **ХЭЛБЭРИЙН** шалгалт — `projects.ts:2772-2777`-ийн
 * `normaliseTeamCode`-той ижил дүрэм.
 *
 * ⚠️ ЭНЭ БОЛ ХЭЛБЭР, ГИШҮҮНЧЛЭЛ БИШ.  `team_code`-ийн БОДИТ валидац нь
 * АМЬД `teams.code`-ийг хүлээн авна — `code IN ('BA','BB',…)` ХАТУУ
 * ЖАГСААЛТ БИШ.  Иймд `MGMT`, `EZ`, `GT` нь ХҮЧИНТЭЙ `team_code` хэвээр;
 * тэд зөвхөн дүрмийн багцгүй, хүчингүй БИШ.
 */
export function isTeamCodeShape(code: string): boolean {
  if (typeof code !== 'string') return false;
  if (!/^[A-Z]{2,8}$/.test(code)) return false;
  return !RESERVED_TEAM_CODES.has(code);
}

/**
 * 4-р шатны ХАСАХ ЖАГСААЛТ.  `teams.code`-ийн фолдыг урьдчилан тооцоолж,
 * (а) 2 тэмдэгтээс богино эсвэл (б) фолдын дараа ДАВХАРДСАН бүх кодыг
 * ХАЯНА.  Үлдсэнийг `fold -> code` зураглалаар буцаана.
 *
 * ⚠️ `BB` нь ЯГ ТЭР тохиолдол: `textFold.ts:51`-ийн `([a-z])\1+ -> $1`
 * дүрэм давхар үсгийг хураадаг тул `foldText('BB') === 'b'`, мөн
 * `codePrefix('Б-101') === 'b'`.  Ганц үсэг нь «Бетон хийцийн план»,
 * «Б-101» гэх мэт БҮХ зүйлтэй таарах тул хуудасны угтвар дангаараа BB-г
 * ХЭЗЭЭ Ч шийдэж чадахгүй.
 *
 * ⛔ ЗАСВАР НЬ `foldText`-ИЙГ ӨӨРЧЛӨХ БИШ.  Тэр функц нь дөрвөн ихрийн нэг
 * (backend TS, frontend `normalize.ts`, Python trainer, C# `TextFold.cs`) —
 * нэгийг нь өөрчлөх нь вэбийн хайлт ба Revit-ийн хуудас таарцыг ЧИМЭЭГҮЙ
 * доройтуулна.  Тиймээс BB-г ЭНД, зөвхөн багийн 4-р шатнаас хасна.
 */
export function foldableTeamCodes(codes: readonly string[]): Map<string, string> {
  const byFold = new Map<string, string[]>();
  for (const raw of codes) {
    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (!code) continue;
    const fold = foldText(code).replace(/ /g, '');
    if (fold.length < 2) continue; // (а) хэт богино — `BB` -> `b`
    byFold.set(fold, [...(byFold.get(fold) ?? []), code]);
  }
  const out = new Map<string, string>();
  for (const [fold, list] of byFold) {
    if (list.length !== 1) continue; // (б) хоёр код нэг фолдод унав
    out.set(fold, list[0]!);
  }
  return out;
}

/**
 * §48-ын шат — ЦЭВЭР ФУНКЦ.
 *
 * ⚠️ ЗӨРЧЛИЙН ДҮРЭМ (ӨРГӨТГӨСӨН).  ХҮНЭЭС ГАРААГҮЙ шийдвэрлэгч шатуудын
 * ЯЛАГЧ (`IMPERSONAL_SOURCES`-ийн эхнийх) ба `user_primary` хоёулаа нэр
 * дэвшигч гаргаад ЗӨРСӨН бол үр дүн нь UNCERTAIN + conflict, өндөр шат
 * БИШ.  Эс бөгөөс MGMT-гүй ганц хуваарьтай төсөл (интерьер-л ажил, ZA
 * засвар — MGL-д ЭНГИЙН) дээр BA-гийн архитектор HAS-ийн дүрмийн багцыг
 * ЧИМЭЭГҮЙ ачаалах байв: яг R5 / §48-R6-ийн эвдрэл.
 *
 * ⚠️ ЗӨВХӨН ЯЛАГЧТАЙ харьцуулна, бүх хүнээс гараагүй нэр дэвшигчтэй БИШ.
 * `binding` (1.00) BA гэж, `project_shares` (0.75) HAS гэж, хүн BA гэж
 * хэлэхэд хамгийн хүчтэй хоёр бие даасан дохио САНАЛ НИЙЛЖ байна — түүнийг
 * сул шатны улмаас UNCERTAIN болгох нь §76-ын ядаргааны төсвийг дэмий
 * зарцуулна.
 *
 * ⚠️ ЗӨРЧИЛ нь ЗӨВХӨН `user_primary` нэр дэвшигчтэй үед л боломжтой.
 * Хэрэглэгчид ҮНДСЭН баг байхгүй бол (`is_primary = 1` мөргүй) зөрчих тал
 * БАЙХГҮЙ тул шатны дараалал хэвийн ажиллана.
 */
export function decideTeam(candidates: readonly TeamCandidate[]): TeamDecision {
  const all = [...candidates];
  const uncertain = (conflict: string[] | null): TeamDecision => ({
    team_code: null,
    team_confidence: 0,
    team_source: UNCERTAIN_SOURCE,
    conflict,
    candidates: all,
  });

  /** Тухайн шатны эхний ХҮЧИНТЭЙ нэр дэвшигч. */
  const pick = (source: TeamSource): TeamCandidate | null =>
    all.find((c) => c.source === source && isTeamCodeShape(c.team_code)) ?? null;

  const human = pick('user_primary');
  let impersonal: TeamCandidate | null = null;
  for (const s of IMPERSONAL_SOURCES) {
    impersonal = pick(s);
    if (impersonal) break;
  }

  if (human && impersonal && human.team_code !== impersonal.team_code) {
    return uncertain([impersonal.team_code, human.team_code]);
  }

  for (const source of RESOLVING_SOURCES) {
    const c = pick(source);
    if (!c) continue;
    // ⚠️ ХАТУУ `>`.  0.70 яг тэнцүү нэр дэвшигч нь ХҮРЭЛЦЭХГҮЙ.
    if (!(c.confidence > TEAM_ACCEPT_CONFIDENCE)) continue;
    return {
      team_code: c.team_code,
      team_confidence: c.confidence,
      team_source: c.source,
      conflict: null,
      candidates: all,
    };
  }

  // Баталгаажуулагч шат (`sheet_prefix`, `behavior`) ХЭЗЭЭ Ч энд хүрэхгүй —
  // тэд `RESOLVING_SOURCES`-д байхгүй.  Тэдний утга нь `candidates`-д
  // үлдэж, UI-ийн сонгогчийг урьдчилан тэмдэглэхэд л ашиглагдана.
  return uncertain(null);
}

/**
 * Ямар хамрах хүрээ ажиллахыг заана (§47).
 *
 * ⚠️ `TEAM` нь ХОЁР ТУСДАА шалтгаанаар унана — тэдгээрийг БҮҮ ХОЛИ:
 *   (1) `team_code === null` — ИЛРҮҮЛЭЛТ ӨӨРӨӨ УНАСАН (UNCERTAIN);
 *   (2) `team_code !== null` ГЭВЧ `packedTeamCodes`-д БАЙХГҮЙ — илрүүлэлт
 *       АМЖИЛТТАЙ, гэхдээ тэр багт дүрмийн багц зохиогдоогүй (эзэн
 *       баталсан 2026-08-30: `MGMT`, `EZ`, `GT`).
 * `packedTeamCodes` өгөгдөөгүй бол багцын шүүлт ХИЙГДЭХГҮЙ (хуучин зан төлөв).
 */
export function scopesFor(
  d: TeamDecision,
  packedTeamCodes?: ReadonlySet<string>,
): KnowledgeScope[] {
  const base: KnowledgeScope[] = ['GLOBAL', 'COMPANY', 'PROJECT'];
  if (d.team_code === null) return base;
  if (packedTeamCodes !== undefined && !packedTeamCodes.has(d.team_code)) return base;
  return ['GLOBAL', 'COMPANY', 'TEAM', 'PROJECT'];
}

/**
 * Энэ сесст НИЙЦЛИЙН ШАЛГАЛТ ажиллах уу (ЭЗЭН БАТАЛСАН 2026-08-30).
 *
 * ⚠️ `packedTeamCodes` нь АЖИЛЛАХ ҮЕД дамжина — 2-2-ын дүрмийн бүртгэлээс
 * (`SELECT DISTINCT team_code FROM rules WHERE team_code IS NOT NULL`).
 * ЖАГСААЛТ ЭНД ХАТУУ БИЧИГДЭХГҮЙ.
 *
 * ⚠️ `false` буцаах нь «баг тодорхойгүй» ГЭСЭН ҮГ БИШ.  Хоёр төлөв ӨӨР:
 *   UNCERTAIN    → `team_code === null`; мөр нь БАГГҮЙ шошготой.
 *   БАГЦГҮЙ БАГ  → `team_code` нь БОДИТ код; мөр нь ТҮҮГЭЭР шошголно
 *                  (attribution ЗӨВ хэвээр), зөвхөн шалгалт алгасагдана.
 * ⛔ Багцгүй баг нь ӨӨР БАГИЙН дүрэм рүү ХЭЗЭЭ Ч УНАХГҮЙ (v2 §48-R6).
 */
export function complianceEnabled(
  d: TeamDecision,
  packedTeamCodes: ReadonlySet<string>,
): boolean {
  if (d.team_code === null) return false;
  return packedTeamCodes.has(d.team_code);
}

/* ---- 4-р шат · sheet_prefix · 0.65 (ЗӨВХӨН БАТАЛГААЖУУЛАГЧ) -------- */

/** Modal угтвар хүлээн зөвшөөрөгдөх ХАМГИЙН БАГА хуудасны тоо. */
export const SHEET_PREFIX_MIN_HITS = 3;

/**
 * Хуудасны дугаарын угтвараас баг ТААХ — ЗӨВХӨН БАТАЛГААЖУУЛАГЧ.
 *
 * ГУРВАН нөхцөл ЗААВАЛ хангагдана:
 *   (a) 3-аас цөөнгүй хуудас дээр ижил угтвар (modal prefix),
 *   (b) угтвар нь `foldText(teams.code)`-тэй ЯГ таарна,
 *   (c) тухайн код `foldableTeamCodes()`-ийн хасах жагсаалтад БАЙХГҮЙ.
 */
export function sheetPrefixCandidate(
  sheetNumbers: readonly string[],
  foldMap: ReadonlyMap<string, string>,
): TeamCandidate | null {
  const hits = new Map<string, number>();
  for (const n of sheetNumbers) {
    const p = codePrefix(typeof n === 'string' ? n : '');
    if (p.length < 2) continue;
    hits.set(p, (hits.get(p) ?? 0) + 1);
  }
  let bestPrefix = '';
  let bestCount = 0;
  for (const [p, n] of hits) {
    if (n > bestCount) {
      bestPrefix = p;
      bestCount = n;
    }
  }
  if (bestCount < SHEET_PREFIX_MIN_HITS) return null;
  const code = foldMap.get(bestPrefix);
  if (!code || !isTeamCodeShape(code)) return null;
  return {
    team_code: code,
    source: 'sheet_prefix',
    confidence: TIER_CONFIDENCE.sheet_prefix,
    detail: { prefix: bestPrefix, sheets: bestCount },
  };
}

/* ---- 5-р шат · behavior · 0.60-аас хэтрэхгүй (БАТАЛГААЖУУЛАГЧ) ----- */

/**
 * Revit категори → салбарын профайл.
 *
 * ⚠️ §48-R2 нь ЗӨВХӨН инференс дээр тулгуурлахыг хориглодог тул энэ шат
 * ХЭЗЭЭ Ч дангаараа шийдэхгүй.  Профайл нь `teams.code` дээр
 * түлхүүрлэгдэнэ — шинэ код нэмэгдэхэд зүгээр л профайлгүй үлдэнэ (унахгүй).
 */
export const CATEGORY_TEAM_PROFILE: Readonly<Record<string, string>> = {
  Ducts: 'HAS',
  'Air Terminals': 'HAS',
  'Mechanical Equipment': 'HAS',
  Pipes: 'TSBU',
  'Plumbing Fixtures': 'TSBU',
  'Pipe Fittings': 'TSBU',
  'Lighting Fixtures': 'TSAH',
  'Electrical Equipment': 'TSAH',
  Conduit: 'TSAH',
  Furniture: 'IZ',
  Casework: 'IZ',
  Ceilings: 'IZ',
  'Structural Framing': 'BB',
  'Structural Foundations': 'BB',
  Rebar: 'BB',
  Walls: 'BA',
  Doors: 'BA',
  Windows: 'BA',
  Rooms: 'BA',
};

/** Категорийн холимогоос баг ТААХ — ЗӨВХӨН БАТАЛГААЖУУЛАГЧ. */
export function behaviorCandidate(
  categoryCounts: Readonly<Record<string, number>>,
  liveTeamCodes?: ReadonlySet<string>,
): TeamCandidate | null {
  const score = new Map<string, number>();
  let total = 0;
  for (const [cat, n] of Object.entries(categoryCounts)) {
    if (!Number.isFinite(n) || n <= 0) continue;
    const code = CATEGORY_TEAM_PROFILE[cat];
    if (!code) continue;
    if (liveTeamCodes && !liveTeamCodes.has(code)) continue;
    score.set(code, (score.get(code) ?? 0) + n);
    total += n;
  }
  if (total <= 0) return null;
  let best = '';
  let bestN = 0;
  for (const [code, n] of score) {
    if (n > bestN) {
      best = code;
      bestN = n;
    }
  }
  if (!best || !isTeamCodeShape(best)) return null;
  const share = bestN / total;
  // Дийлэнх нь биш бол дохио БАЙХГҮЙ — «магадгүй» гэдэг нь баг биш.
  if (share < 0.5) return null;
  return {
    team_code: best,
    // ⚠️ 0.60-аас ХЭЗЭЭ Ч ДЭЭШ БИШ — босгоос доогуур байх нь БҮТЦИЙН баталгаа.
    source: 'behavior',
    confidence: TIER_CONFIDENCE.behavior * share,
    detail: { elements: bestN, share: Math.round(share * 100) },
  };
}

/* ================================================================== */
/*  4. НЭГ ӨГӨГДЛИЙН УНШИЛТ                                            */
/* ================================================================== */

export interface TeamRosterRow {
  code: string;
  name_mn: string;
  sort_order: number;
}

export interface TeamResolutionInput {
  /** ⚠️ ТОКЕНООС, клиентээс БИШ. */
  userId: number;
  projectId: number | null;
  revitDocumentId: number | null;
  /** 5-р шатны нотолгоо — дуудагч байвал өгнө (заавал биш). */
  categoryCounts?: Readonly<Record<string, number>>;
}

export interface TeamResolution {
  decision: TeamDecision;
  /** АМЬД РОСТЕР — `teams`-ийн БҮХ мөр, зөвхөн багцтай нь БИШ. */
  teams: TeamRosterRow[];
  /**
   * Дүрмийн багцтай багууд.  ⚠️ `undefined` = дүрмийн бүртгэл ХООСОН эсвэл
   * `rules` хүснэгт хараахан хэрэгжээгүй — «энэ багт багц алга»-аас ӨӨР
   * төлөв, тиймээс багцын шүүлт ХИЙГДЭХГҮЙ.
   */
  packedTeamCodes: ReadonlySet<string> | undefined;
}

/** `evidence_json`-д хадгалагдах хэлбэр.  ЗАМ, ФАЙЛЫН НЭР БИШ. */
export function evidenceOf(d: TeamDecision): string {
  return JSON.stringify({
    candidates: d.candidates.map((c) => ({
      team_code: c.team_code,
      source: c.source,
      confidence: c.confidence,
      ...(c.detail ? { detail: c.detail } : {}),
    })),
  });
}

interface CodeRow {
  team_code: string | null;
}

function firstCode(rows: unknown[], source: TeamSource): TeamCandidate | null {
  for (const raw of rows) {
    const r = raw as CodeRow | null;
    const code = typeof r?.team_code === 'string' ? r.team_code.trim().toUpperCase() : '';
    if (isTeamCodeShape(code)) {
      return { team_code: code, source, confidence: TIER_CONFIDENCE[source] };
    }
  }
  return null;
}

/**
 * Шатны БҮХ SQL-ийг гүйцэтгээд `decideTeam`-д өгнө.
 *
 * ⚠️ `rules` хүснэгт (2-2-ын 0221) хараахан ХЭРЭГЖЭЭГҮЙ байж болно — тэр
 * тохиолдолд `packedTeamCodes` нь `undefined` болж, багцын шүүлт огт
 * хийгдэхгүй.  ХЭЗЭЭ Ч ХООСОН Set буцаахгүй: хоосон Set нь «баг бүрд багц
 * алга» гэсэн утгатай бөгөөд `compliance_enabled`-ийг бүх багт `false`
 * болгоно, харин `undefined` нь «шүүх зүйл алга» гэсэн утгатай.
 */
export async function resolveTeamContext(
  db: D1Database,
  input: TeamResolutionInput,
): Promise<TeamResolution> {
  const { userId, projectId, revitDocumentId } = input;

  const stmts: D1PreparedStatement[] = [];
  const slot = new Map<string, number>();
  const push = (key: string, s: D1PreparedStatement): void => {
    slot.set(key, stmts.length);
    stmts.push(s);
  };

  // Ростер — `teams`-ийн БҮХ мөр (ЛИТЕРАЛ тоо ХЭЗЭЭ Ч БИШ).
  push(
    'teams',
    db.prepare('SELECT code, name_mn, sort_order FROM teams ORDER BY sort_order, code'),
  );

  // 3-р шат · user_primary · 0.85
  // ⚠️ `is_primary = 1` нь ЗААВАЛ.  Продакшн дээр БА багийн бүх гишүүн IZ,
  //    EZ-д ХОЁРДОГЧООР бүртгэлтэй (`attendance.ts:1241-1247`) — ямар ч
  //    харьяаллаар шүүвэл BA-гийн архитекторт IZ-ийн багц очно (42 -> 242).
  push(
    'user_primary',
    db
      .prepare(
        `SELECT tm.code AS team_code
           FROM user_teams ut
           JOIN teams tm ON tm.id = ut.team_id
          WHERE ut.user_id = ? AND ut.is_primary = 1
          LIMIT 1`,
      )
      .bind(userId),
  );

  if (revitDocumentId !== null) {
    // 1-р шат · binding · 1.00
    // ⚠️ ЗӨВХӨН ҮЙЛДЭГЧИД ХУВААРИЛАГДСАН ажлын холбоос.  Холбоос нь БАГААР
    //    ХУВААЛЦСАН (`rb.user_id IS NULL`) тул шүүлтгүй бол цахилгаанчин
    //    архитекторын багийг өвлөнө.
    push(
      'binding',
      db
        .prepare(
          `SELECT tm.code AS team_code, COUNT(*) AS n
             FROM revit_sheet_bindings rb
             JOIN tasks t       ON t.id = rb.task_id
             JOIN components co ON co.id = t.component_id
             JOIN drawings d    ON d.id = co.drawing_id
             JOIN blocks b      ON b.id = d.block_id
             JOIN teams tm      ON tm.id = b.team_id
            WHERE rb.revit_document_id = ?
              AND rb.user_id IS NULL
              AND rb.status = 'confirmed'
              AND (t.assigned_to = ?
                   OR EXISTS (SELECT 1 FROM task_assignees ta
                               WHERE ta.task_id = t.id AND ta.user_id = ?))
            GROUP BY tm.code
            ORDER BY n DESC`,
        )
        .bind(revitDocumentId, userId, userId),
    );

    // 1b-р шат · document · 0.95
    push(
      'document',
      db
        .prepare('SELECT team_code FROM revit_documents WHERE id = ? AND team_code IS NOT NULL')
        .bind(revitDocumentId),
    );

    // 4-р шатны НОТОЛГОО (хуудасны дугаар) — ЗӨВХӨН БАТАЛГААЖУУЛАГЧ.
    push(
      'sheets',
      db
        .prepare(
          `SELECT sheet_number FROM revit_sheet_bindings
            WHERE revit_document_id = ? AND user_id IS NULL
            LIMIT 500`,
        )
        .bind(revitDocumentId),
    );
  }

  if (projectId !== null) {
    // 2-р шат · project_shares · 0.75
    // ⚠️ ЗӨВХӨН MGMT-ийг хассаны дараа ЯГ НЭГ мөр үлдвэл.  Хоёр ба түүнээс
    //    дээш бол энэ шат ЮУ Ч гаргахгүй — «магадгүй» гэдэг нь баг биш.
    push(
      'shares',
      db
        .prepare(
          `SELECT tm.code AS team_code
             FROM project_team_shares pts
             JOIN teams tm ON tm.id = pts.team_id
            WHERE pts.project_id = ? AND pts.share_percent > 0`,
        )
        .bind(projectId),
    );
  }

  const res = await db.batch(stmts);
  const rowsOf = (key: string): unknown[] => {
    const i = slot.get(key);
    if (i === undefined) return [];
    return (res[i]?.results ?? []) as unknown[];
  };

  const teams = (rowsOf('teams') as TeamRosterRow[]).map((t) => ({
    code: String(t.code ?? '').toUpperCase(),
    name_mn: String(t.name_mn ?? ''),
    sort_order: Number(t.sort_order ?? 0),
  }));
  const liveCodes = new Set(teams.map((t) => t.code));

  const candidates: TeamCandidate[] = [];
  const binding = firstCode(rowsOf('binding'), 'binding');
  if (binding) candidates.push(binding);
  const documentTier = firstCode(rowsOf('document'), 'document');
  if (documentTier) candidates.push(documentTier);

  const shareCodes = (rowsOf('shares') as CodeRow[])
    .map((r) => String(r?.team_code ?? '').toUpperCase())
    .filter((code) => isTeamCodeShape(code) && !SHARES_EXCLUDED_TEAM_CODES.has(code));
  if (shareCodes.length === 1) {
    candidates.push({
      team_code: shareCodes[0]!,
      source: 'project_shares',
      confidence: TIER_CONFIDENCE.project_shares,
    });
  }

  const primary = firstCode(rowsOf('user_primary'), 'user_primary');
  if (primary) candidates.push(primary);

  const foldMap = foldableTeamCodes(teams.map((t) => t.code));
  const sheetNumbers = (rowsOf('sheets') as Array<{ sheet_number?: unknown }>).map((r) =>
    typeof r?.sheet_number === 'string' ? r.sheet_number : '',
  );
  const prefix = sheetPrefixCandidate(sheetNumbers, foldMap);
  if (prefix) candidates.push(prefix);

  if (input.categoryCounts) {
    const behavior = behaviorCandidate(input.categoryCounts, liveCodes);
    if (behavior) candidates.push(behavior);
  }

  // ⚠️ Багц нь ТУСДАА асуулга: `rules` (0221) хараахан хэрэгжээгүй байж
  //    болно.  Унавал `undefined` — «шүүх зүйл алга».
  let packedTeamCodes: ReadonlySet<string> | undefined;
  try {
    const packed = await db
      .prepare('SELECT DISTINCT team_code FROM rules WHERE team_code IS NOT NULL')
      .all<CodeRow>();
    const set = new Set(
      (packed.results ?? [])
        .map((r) => String(r?.team_code ?? '').toUpperCase())
        .filter((code) => code.length > 0),
    );
    packedTeamCodes = set.size > 0 ? set : undefined;
  } catch {
    packedTeamCodes = undefined;
  }

  return { decision: decideTeam(candidates), teams, packedTeamCodes };
}
