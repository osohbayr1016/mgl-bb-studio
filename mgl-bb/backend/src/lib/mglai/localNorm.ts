/**
 * MGL AI · ЛОКАЛ НОРМЫН ХАРИУ (хөтчөөс дамжуулсан `/norm`) — ариутгал.
 *
 * ⚠️ Хөтөч бол ТЭЭВЭР, сервер бол ШИЙДВЭР (`tool_results`-ийн ижил загвар).
 *    Клиентээс ирсэн ямар ч талбарыг тайрч, цагаан жагсаалтаар л авна.
 *
 * 2026-09-11 (P0-8/P0-14, Amendment A): ХЭСЭГ БҮРИЙН баримт (`doc_id`, `code`) ба
 * `verification_status`-ыг ХАДГАЛНА — өмнө нь толгой эшлэлийн баримтыг бүх хэсэгт
 * дарж, «БНбД 21-04-05»-ын заалт «БНбД 31-23-12» гэж prompt-д ордог байв (хэмжсэн).
 * `no_match_reason` ба `named_document` нь «олдсонгүй» / «нэрлэсэн баримт алга» /
 * «заалт алга»-г ялгана; `dataset_sha256` нь бүртгэлтэй тулгах түлхүүр.
 */
import { sanitizeFence } from './promptFrame';
import { currentnessNote, currentnessOf, type Currentness } from './currentness';
import { foldText } from '../textFold';
import { ACRONYMS, actionPrefix, alsoAsksWhy, askForm, asksApplicability, hasWordPrefix, yearsGap, type AskForm } from './localNormFrame';
import { parseLocalNormExplanation, type LocalNormExplanation } from './normExplain';
import type { Evidence } from './visibility';

export type LocalNoMatchReason = 'no_candidates' | 'no_visible_chunk' | 'no_content_overlap' | 'named_document_absent' | 'clause_not_in_named_document';

export interface LocalNormAnswer {
  status: string;
  ruleId: string | null;
  ruleObjectMn: string | null;
  citationLabel: string | null;
  /** Баримтын нэр (runtime `citation.title_mn`, 2026-09-23) — хуучин runtime-д null. */
  titleMn: string | null;
  documentCode: string | null;
  clause: string | null;
  page: number | null;
  noteMn: string | null;
  missingContext: string[];
  /**
   * Runtime-ийн ДЕТЕРМИНИСТ хүснэгтийн шийдвэр (`/norm.decisions`, ж. БНбД 21-04-05: `{GUAT:true, GMDH:false}`) —
   * ЦАГААН ЖАГСААЛТААР (түлхүүр ≤ 4, утга boolean|null).  2026-09-18 хүртэл Worker үүнийг УНШДАГГҮЙ байсан тул
   * «Хатаалгын өрөөнд ГУАТ хэрэгтэй юу?» гэхэд runtime `verified` GUAT=true гэсэн ч чат хоосон/трейлер л
   * харуулж байв (хэмжсэн, прод).  `localNormTemplate` үүнийг өгүүлбэр болгоно.
   */
  decisions: Record<string, boolean | null>;
  ruleKind: string | null;
  table: number | null;
  row: string | null;
  /** Runtime-ийн `effective_status !== 'in_force'` — зөвхөн оношилгоонд; шийдвэр `currentness`. */
  legalReviewRequired: boolean;
  effectiveStatus: string | null;
  currentness: Currentness;
  /** Amendment A — багцын таних тэмдэг (хуучин шингээлтэд null). */
  datasetSha256: string | null;
  datasetVersion: string | null;
  noMatchReason: LocalNoMatchReason | null;
  namedDocument: { code: string | null; absent: boolean; relation: string | null; relatedCode: string | null } | null;
  /**
   * L0 нормын бүртгэл (runtime `/norm` → `registry`, ai/norm-dataset, 2026-09-16) — ЦАГААН ЖАГСААЛТААР.
   * Нэрлэсэн баримт санд байхгүй ч бүртгэлд байвал `named` (код · нэр · төлөв · албан холбоос,
   * `deep_ingested:false`); `matches` нь асуултын баг/сэдвээр холбогдох нормууд (LINKS_ONLY).
   * Техникийн шаардлага ЭНДЭЭС ХЭЗЭЭ Ч гарахгүй — зөвхөн код/нэр/төлөв/URL.  Хуучин runtime-д null.
   */
  registry: LocalNormRegistry | null;
  /**
   * L2 ЗААЛТЫН ТАЙЛБАР (runtime `/norm` → `explanation`, ai/retrieval/src/explain.ts, 2026-09-18) — цагаан
   * жагсаалтаар (`normExplain.ts`).  Зөвхөн L2 багцтай баримтад (эхлээд БНбД 31-17-10); `computable:false`
   * биш бичлэг хаягдана.  Хуучин runtime-д null.
   */
  explanation: LocalNormExplanation | null;
  evidence: {
    chunkId: string;
    docId: string | null;
    code: string | null;
    kind: string;
    textMn: string;
    page: number | null;
    clauseNo: string | null;
    verificationStatus: string | null;
    score: number;
  }[];
}

export type LocalNormRegistryStatus = 'ACTIVE' | 'DRAFT' | 'SUPERSEDED' | 'HISTORICAL' | 'CANDIDATE_NEEDS_STATUS_CHECK' | 'GUIDANCE' | 'STATUS_REQUIRES_VERIFICATION';

export interface LocalNormRegistryEntry {
  code: string;
  titleMn: string;
  status: LocalNormRegistryStatus;
  statusNoteMn: string | null;
  capabilityLevel: string | null;
  deepIngested: boolean;
  sourceUrl: string | null;
  legalSourceUrl: string | null;
  supersededBy: string | null;
  successorDraft: string | null;
  lastVerified: string | null;
  matchedTopics: string[];
  matchedTeams: string[];
}

/**
 * L1 сэдвийн чиглүүлэгчийн мөр (runtime `/norm` → `registry.topic_router`, ai/norm-dataset/router, 2026-09-18).
 * Сэдэв → ОЛОН баримт: код (кодгүй ЗГ-ын тогтоолд null, нэр заавал) · нэр · албан холбоос (ХЭЗЭЭ Ч null биш —
 * URL-гүй мөр хаягдана) · төлөв.  `STATUS_REQUIRES_VERIFICATION` = 2025 оны бүртгэлийн мөр, хүчин төгөлдөр
 * байдал шалгагдаагүй — `statusVerified:false`; ACTIVE зөвхөн MCIS-ээр баталгаажсан куратор мөрөнд.
 * Техникийн шаардлага ЭНДЭЭС ХЭЗЭЭ Ч гарахгүй.
 */
export interface LocalNormTopicRouteEntry {
  registryId: string;
  code: string | null;
  titleMn: string;
  status: LocalNormRegistryStatus;
  statusNoteMn: string | null;
  statusVerified: boolean;
  supersededBy: string | null;
  url: string;
  legalSourceUrl: string | null;
  scopeClasses: string[];
  topics: string[];
  routerScore: number;
  routerReason: string;
}

export interface LocalNormTopicRoute {
  detectedTopics: string[];
  detection: 'exact' | 'stem' | 'none';
  wantsCost: boolean;
  wantsLabour: boolean;
  /** Runtime-ийн БҮХ таарсан мөрийн тоо (results нь MAX_TOPIC_ROUTE_RESULTS-аар тайрагдсан байж болно). */
  total: number;
  truncated: boolean;
  excluded: { cost: number; labour: number };
  results: LocalNormTopicRouteEntry[];
}

export interface LocalNormRegistry {
  named: LocalNormRegistryEntry | null;
  interpretation: { teams: string[]; topics: string[]; buildingTypes: string[] };
  matches: LocalNormRegistryEntry[];
  excludedNonCurrent: number;
  /** L1 сэдвийн чиглүүлэгч — хуучин runtime / шингээгээгүй санд null. */
  topicRouter: LocalNormTopicRoute | null;
}

const REGISTRY_STATUSES = new Set(['ACTIVE', 'DRAFT', 'SUPERSEDED', 'HISTORICAL', 'CANDIDATE_NEEDS_STATUS_CHECK', 'GUIDANCE', 'STATUS_REQUIRES_VERIFICATION']);
const MAX_REGISTRY_MATCHES = 8;
/** Төсвийн асуулт 113 мөр буцаадаг — template бүгдийг харуулна (prompt-ын хайрцаг тусдаа ≤15 тайрна); `total`-д бүтэн тоо. */
const MAX_TOPIC_ROUTE_RESULTS = 160;
const TOPIC_ROUTER_STATUSES = new Set<LocalNormRegistryStatus>(['ACTIVE', 'SUPERSEDED', 'HISTORICAL', 'CANDIDATE_NEEDS_STATUS_CHECK', 'STATUS_REQUIRES_VERIFICATION', 'DRAFT', 'GUIDANCE']);

function https(v: unknown): string | null {
  return typeof v === 'string' && /^https:\/\/[^\s]{1,300}$/.test(v) ? v : null;
}

function strList(v: unknown, max = 12, len = 40): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max).map((x) => x.slice(0, len)) : [];
}

function registryEntry(raw: unknown, deepIngestedDefault: boolean): LocalNormRegistryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const code = s(r.code, 64);
  const titleMn = s(r.title_mn, 200);
  const status = typeof r.status === 'string' && REGISTRY_STATUSES.has(r.status) ? (r.status as LocalNormRegistryEntry['status']) : null;
  if (!code || !titleMn || !status) return null;
  const m = (r.matched ?? {}) as Record<string, unknown>;
  return {
    code,
    titleMn,
    status,
    statusNoteMn: s(r.status_note_mn, 300),
    capabilityLevel: s(r.capability_level, 4),
    deepIngested: typeof r.deep_ingested === 'boolean' ? r.deep_ingested : deepIngestedDefault,
    sourceUrl: https(r.source_url),
    legalSourceUrl: https(r.legal_source_url),
    supersededBy: s(r.superseded_by, 64),
    successorDraft: s(r.successor_draft, 64),
    lastVerified: s(r.last_verified, 10),
    matchedTopics: strList(m.topics),
    matchedTeams: strList(m.teams),
  };
}

function topicRouteEntry(raw: unknown): LocalNormTopicRouteEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const registryId = s(r.registry_id, 64);
  const titleMn = s(r.title_mn, 300);
  const status = typeof r.status === 'string' && TOPIC_ROUTER_STATUSES.has(r.status as LocalNormRegistryStatus) ? (r.status as LocalNormRegistryStatus) : null;
  const url = https(r.url);
  // URL-гүй, нэргүй, төлөвгүй мөр хаягдана — «холбоосыг хэзээ ч алдахгүй» гэрээний хөтчийн тал.
  if (!registryId || !titleMn || !status || !url) return null;
  return {
    registryId,
    code: s(r.code, 64),
    titleMn,
    status,
    statusNoteMn: s(r.status_note_mn, 300),
    // ACTIVE л баталгаажсан; runtime-ийн тугийг ДАХИН шийднэ (хөтөч/runtime дур мэдэн true өгч чадахгүй).
    statusVerified: status === 'ACTIVE',
    supersededBy: s(r.superseded_by, 64),
    url,
    legalSourceUrl: https(r.legal_source_url),
    scopeClasses: strList(r.scope_classes, 4, 32),
    topics: strList(r.topics, 8, 40),
    routerScore: typeof r.router_score === 'number' && Number.isFinite(r.router_score) ? r.router_score : 0,
    routerReason: s(r.router_reason, 80) ?? '',
  };
}

export function parseLocalNormTopicRoute(raw: unknown): LocalNormTopicRoute | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const all = Array.isArray(r.results) ? r.results : [];
  const results = all.slice(0, MAX_TOPIC_ROUTE_RESULTS).map(topicRouteEntry).filter((x): x is LocalNormTopicRouteEntry => x !== null);
  const ex = (r.excluded ?? {}) as Record<string, unknown>;
  const detection = r.detection === 'exact' || r.detection === 'stem' ? r.detection : 'none';
  return {
    detectedTopics: strList(r.detected_topics, 8, 40),
    detection,
    wantsCost: r.wants_cost === true,
    wantsLabour: r.wants_labour === true,
    total: typeof r.count === 'number' && Number.isFinite(r.count) ? Math.max(results.length, Math.trunc(r.count)) : all.length,
    truncated: all.length > MAX_TOPIC_ROUTE_RESULTS,
    excluded: { cost: n(ex.cost) ?? 0, labour: n(ex.labour) ?? 0 },
    results,
  };
}

export function parseLocalNormRegistry(raw: unknown): LocalNormRegistry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const i = (r.interpretation ?? {}) as Record<string, unknown>;
  const matches = Array.isArray(r.matches) ? r.matches.slice(0, MAX_REGISTRY_MATCHES).map((m) => registryEntry(m, false)).filter((m): m is LocalNormRegistryEntry => m !== null) : [];
  return {
    named: registryEntry(r.named, false),
    interpretation: { teams: strList(i.teams), topics: strList(i.topics), buildingTypes: strList(i.building_types) },
    matches,
    excludedNonCurrent: typeof r.excluded_non_current === 'number' && Number.isFinite(r.excluded_non_current) ? Math.max(0, Math.trunc(r.excluded_non_current)) : 0,
    topicRouter: parseLocalNormTopicRoute(r.topic_router),
  };
}

const MAX_CLAUSE_CHARS = 1200;
const MAX_EVIDENCE = 4;
const STATUSES = new Set(['verified', 'supported', 'uncertain', 'insufficient_evidence']);
const NO_MATCH = new Set<LocalNoMatchReason>(['no_candidates', 'no_visible_chunk', 'no_content_overlap', 'named_document_absent', 'clause_not_in_named_document']);

function s(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = sanitizeFence(v).trim();
  return t.length === 0 ? null : t.slice(0, max);
}

function n(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : null;
}

const DECISION_KEY = /^[A-Za-zА-Яа-яӨөҮү_]{2,24}$/u;
function parseDecisions(raw: unknown): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= 4 || !DECISION_KEY.test(k)) continue;
    if (v === true || v === false || v === null) out[k] = v;
  }
  return out;
}

/** Шийдвэрийн түлхүүрийн монгол нэр — БНбД 21-04-05-ын хоёр багана. */
const DECISION_LABEL: Record<string, { mn: string; en: string }> = {
  GUAT: { mn: 'гал унтраах автомат төхөөрөмж (ГУАТ)', en: 'automatic fire-extinguishing system (ГУАТ)' },
  GMDH: { mn: 'галын дохиоллын хэрэгсэл (ГМДХ)', en: 'fire alarm system (ГМДХ)' },
};

/**
 * Runtime-ийн дутуу талбарын түлхүүр → хүний нэр.
 * ⚠️ ТАНИГДАХГҮЙ ТҮЛХҮҮР ДЭЛГЭЦЭНД ХЭЗЭЭ Ч ГАРАХГҮЙ (2026-09-23): «…facility_volume_m3 утгаас хамаарна» гэж
 *    дотоод түлхүүр хэрэглэгчид харагдаж байв (эзний HL06).  Нэргүй түлхүүр чимээгүй хасагдана.
 */
const MISSING_LABEL: Record<string, { mn: string; en: string }> = {
  height_m: { mn: 'барилгын өндөр (м)', en: 'building height (m)' },
  rack_height_m: { mn: 'тавиурын өндөр (м)', en: 'rack height (m)' },
  area_m2: { mn: 'талбай (м²)', en: 'area (m²)' },
  item_count: { mn: 'нэгжийн тоо', en: 'item count' },
  count: { mn: 'тоо', en: 'count' },
  floors: { mn: 'давхрын тоо', en: 'number of floors' },
  volume_m3: { mn: 'эзлэхүүн (м³)', en: 'volume (m³)' },
  facility_volume_m3: { mn: 'байгууламжийн эзлэхүүн (м³)', en: 'facility volume (m³)' },
  power_kw: { mn: 'чадал (кВт)', en: 'power (kW)' },
  voltage_kv: { mn: 'хүчдэл (кВ)', en: 'voltage (kV)' },
  vehicle_count: { mn: 'тээврийн хэрэгслийн тоо', en: 'vehicle count' },
  cable_count: { mn: 'кабелийн тоо', en: 'cable count' },
};
function missingLabels(keys: readonly string[], lang: 'mn-Cyrl' | 'en'): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keys) {
    const m = MISSING_LABEL[k];
    if (!m) continue;
    const l = lang === 'en' ? m.en : m.mn;
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  return out.join(', ');
}

function citationTail(a: LocalNormAnswer, e: LocalNormAnswer['evidence'][number] | undefined, lang: 'mn-Cyrl' | 'en'): string {
  const code = e?.code ?? a.documentCode;
  const bits: string[] = [];
  if (code) bits.push(code);
  if (a.table !== null) bits.push(`${lang === 'en' ? 'Table' : 'Хүснэгт'} ${a.table}`);
  else if (e?.clauseNo) bits.push(`${lang === 'en' ? 'clause' : 'заалт'} ${e.clauseNo}`);
  const page = e?.page ?? a.page;
  if (page !== null && page !== undefined) bits.push(`${lang === 'en' ? 'p.' : 'х.'}${page}`);
  return bits.length > 0 ? ` (${bits.join(', ')})` : '';
}

/**
 * Локал нормын ХАРИУЛТЫН ДЕТЕРМИНИСТ ЗАГВАР — гэрээний `template` (загвар унавал энэ гарна).
 *
 * ⚠️ ЯАГААД.  Өмнө нь `composeTemplate` эдгээр ээлжид «Хүний хяналт хэрэгтэй: **NEEDS_HUMAN_REVIEW**» /
 *    «Мөрдөгдөж буй…: **CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED**» гэсэн ТӨЛӨВИЙН ENUM бичдэг байсан
 *    бөгөөд загвар унахад хэрэглэгч яг тэр enum-ийг хариулт болгон авч байв (хэмжсэн 2026-09-18, прод:
 *    «Тэгвэл В2-ийн галын ачааллын муж хэд вэ?»).  Одоо: verified хүснэгтийн шийдвэр → шийдвэрийн
 *    өгүүлбэр; supported → эхний заалтын текст + эшлэл; uncertain → «шууд заалт олдсонгүй, хамгийн ойр…».
 *    Заалтын АГУУЛГА зөвхөн нотолгооны текстээс — зохиогдохгүй.
 * ⚠️ 2026-09-23: АСУУЛТЫН ХЭЛБЭРЭЭР эхний өгүүлбэр (`localNormFrame.ts`) — «Тийм — …эрх заасан», «Энэ заалт
 *    шалтгааныг нь тайлбарлаагүй», «…жагсаалтад бүртгэлтэй», «таны 2 жил … 1 жилээр дутуу».  Жагсаалтын заалт
 *    БҮТНЭЭРЭЭ (өгүүлбэрийн дундуур тасрахгүй), эх сурвалж НЭГ удаа төгсгөлд.
 */
const ASKS_VALUE = /(?<!\p{L})(хэд[\p{L}]*|hed[a-z]*|how\s+(?:many|much)|what\s+(?:is|are)\s+the)(?!\p{L})/iu;
/** Урт заалтыг үгийн хилээр тайрна («…баримт би» гэж дундуур нь тасардаг байв). */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${cut.slice(0, at > max * 0.6 ? at : max).trimEnd()}…`;
}
/** Жагсаалтын заалтын төгсгөлийн «;» / «,» — уншихад саад, утгыг өөрчлөхгүй. */
function clauseBody(text: string, max = 600): string {
  return clip(text.trim().replace(/[;,]\s*$/u, ''), max);
}
const TOKEN_STOP = new Set(['байх', 'ёстой', 'байна', 'болно', 'хэрэгтэй', 'вэ', 'бэ', 'юу', 'ямар', 'хэдэн', 'хэд', 'дотор', 'дээш', 'бага', 'их', 'ба', 'бол', 'нь'].map((w) => foldText(w)));
/**
 * Асуулт ба заалтын текстийн АГУУЛГЫН давхцал — ФОЛДООР (кирилл ↔ латин), ≥4 тэмдэгттэй үгсийн 5 тэмдэгтийн угтвараар.
 * ⚠️ 2026-09-23 хүртэл кирилл үсгээр л харьцуулдаг байсан тул латин асуулт («…heden tsag tusah yostoi») кирилл заалттай
 *    ХЭЗЭЭ Ч давхцахгүй, «олдсонгүй» гэж хариулдаг байв (эзний HL10).
 */
function contentOverlap(question: string, text: string): number {
  const toks = (t: string) => new Set(foldText(t).split(' ').filter((w) => w.length >= 4 && !TOKEN_STOP.has(w)).map((w) => w.slice(0, 5)));
  const q = toks(question);
  let n = 0;
  for (const w of toks(text)) if (q.has(w)) n += 1;
  return n;
}

export interface LocalNormComposed {
  text: string;
  /** Хариултад харуулсан ГАНЦ заалтын дугаар — дараагийн «энэ юу гэсэн үг вэ?» асуултын зангуу (`convState.norm.lastClause`). */
  clauses: string[];
}

export interface ComposeOptions {
  /** Дагалдах асуулт (FOLLOW_UP) — баримтад цоожилсон хайлтын толгой заалтад илүү итгэнэ. */
  followUp?: boolean;
}

type Ev = LocalNormAnswer['evidence'][number];

export function composeLocalNorm(a: LocalNormAnswer, lang: 'mn-Cyrl' | 'en', question = '', opts: ComposeOptions = {}): LocalNormComposed | null {
  const en = lang === 'en';
  const top = a.evidence[0];
  const ruleChunk = a.ruleId ? a.evidence.find((e) => a.ruleId!.startsWith(e.chunkId)) : undefined;
  const keys = Object.keys(a.decisions);
  if (a.status === 'verified' && keys.length > 0 && keys.some((k) => a.decisions[k] !== null)) {
    const parts = keys
      .filter((k) => a.decisions[k] !== null)
      .map((k) => {
        const label = DECISION_LABEL[k] ? (en ? DECISION_LABEL[k]!.en : DECISION_LABEL[k]!.mn) : k;
        return a.decisions[k] ? (en ? `${label} — required` : `${label} — шаардлагатай`) : en ? `${label} — not required` : `${label} — шаардлагагүй`;
      });
    const obj = a.ruleObjectMn ?? (en ? 'This object' : 'Энэ объект');
    const quote = ruleChunk ? ` — «${ruleChunk.textMn.slice(0, 200)}»` : '';
    return { text: `${obj}: ${parts.join('; ')}${citationTail(a, ruleChunk ?? top, lang)}${quote}.`, clauses: [] };
  }
  if (!top) return null;
  const form = askForm(question);
  const whyNote = en ? 'The clause itself does not explain why.' : 'Яагаад гэдгийг энэ заалт өөрөө тайлбарлаагүй.';

  if (a.status === 'uncertain') {
    // «Гол үүдний гэрэлтүүлэг хэдэн люкс вэ?» — runtime тоон дүрмийг «lux оролт дутуу» гэж uncertain болгодог,
    //    гэвч хэрэглэгч УТГЫГ нь асууж байна: заалтын текст асуулттай агуулгаараа давхцаж, тоо агуулж байвал
    //    заалт өөрөө хариулт (хэмжсэн 2026-09-18).  «Гишгүүрийн өндөр» ↔ «28 м-ээс дээш орон сууц» давхцал 0–1
    //    тул энд ОРОХГҮЙ — «шууд заалт олдсонгүй» хэвээр.
    if (ASKS_VALUE.test(question) && /\d/.test(top.textMn) && contentOverlap(question, top.textMn) >= 2) {
      const text = `${clip(top.textMn, 400)}${citationTail(a, top, lang)}.${alsoAsksWhy(question) ? `\n\n${whyNote}` : ''}`;
      return { text, clauses: [top.clauseNo].filter((c): c is string => c !== null) };
    }
    if (form === 'concept') return conceptFrame(a, top, lang, question);
    // «Яагаад …» дагалдах асуулт — баримтад цоожилсон хайлтын толгой заалт нь өмнөх хариултын заалт.
    if (form === 'why' && contentOverlap(question, top.textMn) >= (opts.followUp ? 1 : 2)) return whyFrame(a, top, lang);
    // Босготой дүрэм оролт дутуу гэж `uncertain` болсон ч ЗААЛТ нь асуултад тод хамаатай бол (≥2 агуулгын үг) тэр нь
    //    хариулт — «би 2 жил ажилласан, даамал болж чадах уу» ↔ 2.2.1 «3-аас доошгүй жил»: хэрэглэгч тоогоо ӨӨРӨӨ
    //    хэлсэн (эзний HL04: өмнө нь «шууд заалт олдсонгүй … professional_construction_experience_years» гарч байв).
    if ((form === 'requirement' || form === 'ability' || form === 'duties') && contentOverlap(question, top.textMn) >= 2) {
      return leadFrame(a, top, lang, question, form);
    }
    const labels = missingLabels(a.missingContext, lang);
    const miss = labels.length > 0 ? (en ? ` The matched rule depends on: ${labels}.` : ` Олдсон дүрэм нь ${labels} утгаас хамаарна — тэр утгыг өгвөл шийдэж болно.`) : '';
    const text = en
      ? `No clause in the knowledge base answers this directly. Closest: «${clip(top.textMn, 220)}»${citationTail(a, top, lang)}.${miss}`
      : `Санд энэ асуултад шууд хариулах баталгаажсан заалт олдсонгүй. Хамгийн ойр: «${clip(top.textMn, 220)}»${citationTail(a, top, lang)}.${miss}`;
    return { text, clauses: [] };
  }
  // «Ажлын байрны гэрэлтүүлэг хэдэн лк вэ?» → supported атлаа олдсон заалт ТООГҮЙ (даамлын эрх): утга асуусан
  //    асуултад тоогүй заалт хариулт биш — загварт өгвөл зохиомол тайлбар бичдэг (хэмжсэн 2026-09-18).
  if (localNormValueMissing(a, question)) {
    const text = en
      ? `The knowledge base has no clause with the requested value for this. Closest clause: «${clip(top.textMn, 220)}»${citationTail(a, top, lang)}.`
      : `Санд энэ асуултын тоон шаардлагыг заасан заалт олдсонгүй. Хамгийн ойр заалт: «${clip(top.textMn, 220)}»${citationTail(a, top, lang)}.`;
    return { text, clauses: [] };
  }
  if (form === 'status') return statusFrame(a, top, lang, question);
  if (form === 'why') return whyFrame(a, top, lang);
  if (form === 'concept') return conceptFrame(a, top, lang, question);
  return leadFrame(a, top, lang, question, form);
}

/** Хуучин гэрээ — текст л. */
export function localNormTemplate(a: LocalNormAnswer, lang: 'mn-Cyrl' | 'en', question = ''): string | null {
  return composeLocalNorm(a, lang, question)?.text ?? null;
}

function sameDocClauses(a: LocalNormAnswer, top: Ev): Ev[] {
  const code = top.code ?? a.documentCode;
  return a.evidence.filter((e) => e.chunkId !== top.chunkId && (e.code ?? a.documentCode) === code && e.clauseNo !== null && e.textMn.length > 20);
}

function sourceLine(a: LocalNormAnswer, top: Ev, lang: 'mn-Cyrl' | 'en'): string {
  const code = top.code ?? a.documentCode ?? '';
  const title = a.titleMn ? ` «${a.titleMn}»` : '';
  const page = top.page ?? a.page;
  const pg = page !== null && page !== undefined ? (lang === 'en' ? `, p.${page}` : `, х.${page}`) : '';
  return lang === 'en' ? `Source: ${code}${title}${pg}.` : `Эх сурвалж: ${code}${title}${pg}.`;
}

function item(e: Ev, lang: 'mn-Cyrl' | 'en'): string {
  const ref = e.clauseNo ? (lang === 'en' ? ` (clause ${e.clauseNo})` : ` (заалт ${e.clauseNo})`) : '';
  return `${clauseBody(e.textMn)}${ref}`;
}

function listBlock(items: readonly Ev[], lang: 'mn-Cyrl' | 'en'): string {
  if (items.length === 1) return `${item(items[0]!, lang)}.`;
  return items.map((e) => `• ${item(e, lang)}`).join('\n');
}

function leadFrame(a: LocalNormAnswer, top: Ev, lang: 'mn-Cyrl' | 'en', question: string, form: AskForm): LocalNormComposed {
  const en = lang === 'en';
  let items: Ev[] = [top, ...sameDocClauses(a, top)];
  const action = form === 'ability' ? actionPrefix(question) : null;
  const actionHit = action !== null && hasWordPrefix(top.textMn, action);
  // Эрхийн асуулт: асуусан ҮЙЛДЛИЙГ («зогсоож») агуулсан заалтуудыг л жагсаана (4.9 «шагнал авах» биш).
  if (actionHit) items = items.filter((e) => hasWordPrefix(e.textMn, action!));
  items = items.slice(0, form === 'duties' ? 5 : 3);
  const kind = a.ruleKind;
  let lead: string;
  if (form === 'ability' && kind === 'right') {
    lead = actionHit
      ? en ? 'Yes — the source grants this right in the following cases:' : 'Тийм — эх сурвалжид дараах тохиолдолд ийм эрх заасан байна:'
      : en ? 'The source grants the following rights on this:' : 'Эх сурвалжид энэ талаар дараах эрхийг заасан байна:';
  } else if (form === 'ability' && kind === 'obligation') {
    lead = en ? 'The source states this as an obligation:' : 'Эх сурвалжид үүнийг үүрэг гэж заасан байна:';
  } else if (form === 'duties' && kind === 'obligation') {
    lead = en ? 'The main duties stated in the source:' : 'Эх сурвалжид заасан гол үүргүүд:';
  } else if (form === 'duties' && kind === 'right') {
    lead = en ? 'The rights stated in the source:' : 'Эх сурвалжид заасан эрхүүд:';
  } else if (form === 'duties' && kind === 'responsibility') {
    lead = en ? 'The liability stated in the source:' : 'Эх сурвалжид заасан хариуцлага:';
  } else if (form === 'requirement') {
    lead = en ? 'The source sets these requirements:' : 'Эх сурвалжид дараах шаардлага тавьсан байна:';
  } else {
    lead = en ? 'The source says this on the matter:' : 'Эх сурвалжид энэ талаар ингэж заасан байна:';
  }
  // Жилийн шаардлагыг хэрэглэгчийн ИЛ хэлсэн тоотой харьцуулна («би 2 жил…» ↔ «3-аас доошгүй жил»).
  let verdict = '';
  if (form === 'requirement') {
    for (const e of items) {
      const g = yearsGap(question, e.textMn);
      if (g === null) continue;
      verdict =
        g.have < g.need
          ? en
            ? `Not yet — the source requires at least ${g.need} years; your ${g.have} years fall ${g.need - g.have} short (clause ${e.clauseNo ?? ''}).`
            : `Одоохондоо үгүй — дүрэмд хамгийн багадаа ${g.need} жил шаарддаг, таны ${g.have} жил ${g.need - g.have} жилээр дутуу байна (заалт ${e.clauseNo ?? ''}).`
          : en
            ? `On experience you qualify — the source requires at least ${g.need} years and you have ${g.have}. Check the other requirements too.`
            : `Туршлагын шаардлагыг хангаж байна — дүрэмд хамгийн багадаа ${g.need} жил шаарддаг, танд ${g.have} жил бий. Бусад шаардлагыг ч шалгаарай.`;
      break;
    }
  }
  const head = verdict.length > 0 ? `${verdict}\n\n${en ? 'All requirements in the source:' : 'Эх сурвалжид тавьсан шаардлагууд:'}` : lead;
  return {
    text: `${head}\n${listBlock(items, lang)}\n\n${sourceLine(a, top, lang)}`,
    clauses: items.length === 1 ? [items[0]!.clauseNo].filter((c): c is string => c !== null) : [],
  };
}

function whyFrame(a: LocalNormAnswer, top: Ev, lang: 'mn-Cyrl' | 'en'): LocalNormComposed {
  const en = lang === 'en';
  const lead = en
    ? 'The clause does not explain the reason — it only sets the condition:'
    : 'Энэ заалт шалтгааныг нь тайлбарлаагүй — зөвхөн дараах нөхцөлийг тогтоосон:';
  return { text: `${lead}\n${item(top, lang)}.\n\n${sourceLine(a, top, lang)}`, clauses: [top.clauseNo].filter((c): c is string => c !== null) };
}

function statusFrame(a: LocalNormAnswer, top: Ev, lang: 'mn-Cyrl' | 'en', question: string): LocalNormComposed {
  const en = lang === 'en';
  const code = a.namedDocument?.code ?? top.code ?? a.documentCode ?? '';
  const title = a.titleMn;
  const leadMn: Record<Currentness, string> = {
    IN_FORCE_VERIFIED: `Тийм — ${code} одоо мөрдөгдөж байна.`,
    CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED: `Тийм — ${code} мөрдөгдөж буй баримт; гэхдээ дараагийн нэмэлт, өөрчлөлтийг бүрэн шалгаагүй.`,
    LISTED_CURRENT_NOT_SOURCE_VERIFIED: `Тийм — ${code} Монголд мөрдөгдөж буй нормын жагсаалтад бүртгэлтэй.`,
    NEEDS_HUMAN_REVIEW: `Энэ баримтын (${code}) одоогийн хүчин төгөлдөр байдлыг баталгаажуулаагүй — албан эх сурвалжаас шалгах хэрэгтэй.`,
    HISTORICAL: `${code} бол түүхэн баримт — одоогийн шаардлага биш.`,
    SUPERSEDED: `Үгүй — ${code} хүчингүй болсон (солигдсон).`,
    DRAFT: `${code} бол НООРОГ (батлагдаагүй) баримт — хүчин төгөлдөр болтол одоогийн шаардлага биш.`,
    UNKNOWN: `Энэ баримтын (${code}) одоогийн хүчин төгөлдөр байдлыг баталгаажуулаагүй — албан эх сурвалжаас шалгах хэрэгтэй.`,
  };
  const leadEn: Record<Currentness, string> = {
    IN_FORCE_VERIFIED: `Yes — ${code} is in force.`,
    CURRENT_BUT_LATER_AMENDMENTS_NOT_VERIFIED: `Yes — ${code} is current, though later amendments have not been fully checked.`,
    LISTED_CURRENT_NOT_SOURCE_VERIFIED: `Yes — ${code} is on Mongolia's list of norms in force.`,
    NEEDS_HUMAN_REVIEW: `The current legal status of ${code} has not been verified — check the official source.`,
    HISTORICAL: `${code} is a historical document — not a current requirement.`,
    SUPERSEDED: `No — ${code} has been superseded.`,
    DRAFT: `${code} is a DRAFT (not approved) document — not a current requirement until it enters into force.`,
    UNKNOWN: `The current legal status of ${code} has not been verified — check the official source.`,
  };
  const parts: string[] = [en ? leadEn[a.currentness] : leadMn[a.currentness]];
  if (/:status(?:$|:)/u.test(top.chunkId)) parts.push(en ? `Registry: ${clauseBody(top.textMn, 300)}.` : `Бүртгэл: ${clauseBody(top.textMn, 300)}.`);
  if (title) {
    parts.push(en ? `Scope: it is the norm for «${title}».` : `Хамрах хүрээ: энэ нь «${title}»-ийн норм.`);
    if (asksApplicability(question)) {
      parts.push(
        en
          ? `Whether it applies to your project depends on the project type: use it only for «${title}» work.`
          : `Таны төсөлд хэрэглэх эсэх нь төслийн төрлөөс хамаарна: зөвхөн «${title}»-ийн ажилд хэрэглэнэ.`,
      );
    }
  }
  const note = currentnessNote(a.currentness, lang);
  if (note) parts.push(note);
  parts.push(sourceLine(a, top, lang));
  return { text: parts.join('\n\n'), clauses: [] };
}

function conceptFrame(a: LocalNormAnswer, top: Ev, lang: 'mn-Cyrl' | 'en', question: string): LocalNormComposed {
  const en = lang === 'en';
  const terms = ACRONYMS.filter((x) => x.re.test(question));
  if (terms.length > 0) {
    const lines = terms.map((t) => `• ${en ? t.en : t.mn}`).join('\n');
    const tail = en
      ? 'Which buildings and rooms must have which system is set by the tables of БНбД 21-04-05 — tell me the building or room and I will look it up.'
      : 'Аль барилга, өрөөнд аль нь заавал шаардлагатайг БНбД 21-04-05-ын хүснэгтүүд тогтоодог — барилга эсвэл өрөөгөө хэлбэл хүснэгтээс хэлж өгье.';
    return { text: `${en ? 'Terms (БНбД 21-04-05):' : 'Нэр томьёо (БНбД 21-04-05):'}\n${lines}\n\n${tail}`, clauses: [] };
  }
  const text = en
    ? `The knowledge base has no direct definition for this. Closest clause: «${clip(top.textMn, 220)}»${citationTail(a, top, lang)}.`
    : `Санд энэ ойлголтын шууд тодорхойлолт алга. Хамгийн ойр заалт: «${clip(top.textMn, 220)}»${citationTail(a, top, lang)}.`;
  return { text, clauses: [] };
}

/**
 * Локал нормын хариулт ЗАГВАРГҮЙ (templateOnly) — БҮХ төлөвт (2026-09-18, хэмжсэн).
 *
 * ⚠️ Адаптер 0.4-тэй Qwen3-8B заалтын текстээс ЗОХИОДОГ: «Даамал хариуцлага хүлээх вэ?» → зөв заалт [1]
 *    + «Гэрээний төлөвлөгөө байхгүй бол даамал хариуцлага алга» (заалтад БАЙХГҮЙ); «геодезийн үндэслэл хэдэн
 *    хоногийн өмнө?» → «хоёр долоо хоног» (зөв нь 10-аас доошгүй хоног).  Тоогүй зохиомол өгүүлбэрийг validator
 *    барьж чадахгүй.  Заалтын текст + эшлэл + төлөвийн трейлер нь ҮРГЭЛЖ зөв; найруулга нь дараагийн адаптерын
 *    (SFT `norm-catalog`/`norm-evidence` гэр бүлүүд) ажил.  Детерминист хөдөлгүүрийн ээлж (trustedNorm) энд орохгүй.
 */
export function localNormValueMissing(a: LocalNormAnswer, question: string): boolean {
  // Зөвхөн ТОЛГОЙ заалт (эшлэгдэх нь) — доод хэсгүүдэд санамсаргүй тоо байх нь хариулт болохгүй.
  return a.status === 'supported' && a.evidence.length > 0 && ASKS_VALUE.test(question) && !/\d/.test(a.evidence[0]!.textMn);
}

/** Локал нормын ээлжийг ЗАГВАРГҮЙ (templateOnly) хариулах эсэх — хүснэгтийн шийдвэр, uncertain, тоогүй утгын асуулт. */
export function localNormDeterministic(a: LocalNormAnswer, question: string): boolean {
  void question;
  return a.evidence.length > 0 || Object.values(a.decisions).some((v) => v !== null);
}

export function parseLocalNorm(raw: unknown): LocalNormAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const status = typeof r.status === 'string' && STATUSES.has(r.status) ? r.status : null;
  if (status === null) return null;

  const cit = (r.citation ?? null) as Record<string, unknown> | null;
  const evRaw = Array.isArray(r.evidence) ? r.evidence.slice(0, MAX_EVIDENCE) : [];

  const evidence: LocalNormAnswer['evidence'] = [];
  for (const e of evRaw) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    const text = s(x.text_mn, MAX_CLAUSE_CHARS);
    const id = s(x.chunk_id, 128);
    if (!text || !id) continue;
    evidence.push({
      chunkId: id,
      docId: s(x.doc_id, 128),
      code: s(x.code, 64),
      kind: s(x.kind, 32) ?? 'clause',
      textMn: text,
      page: n(x.page),
      clauseNo: s(x.clause_no, 32),
      verificationStatus: s(x.verification_status, 80),
      score: typeof x.score === 'number' && Number.isFinite(x.score) ? x.score : 0,
    });
  }

  const nd = (r.named_document ?? null) as Record<string, unknown> | null;
  const reason = typeof r.no_match_reason === 'string' && NO_MATCH.has(r.no_match_reason as LocalNoMatchReason) ? (r.no_match_reason as LocalNoMatchReason) : null;
  const sha = cit && typeof cit.dataset_sha256 === 'string' && /^[0-9a-f]{64}$/.test(cit.dataset_sha256) ? cit.dataset_sha256 : null;

  return {
    status,
    ruleId: s(r.rule_id, 256),
    ruleObjectMn: s(r.rule_object_mn, MAX_CLAUSE_CHARS),
    citationLabel: cit ? s(cit.label_mn, 300) : null,
    titleMn: cit ? s(cit.title_mn, 200) : null,
    documentCode: cit ? s(cit.document, 64) : null,
    clause: cit ? s(cit.clause, 32) : null,
    page: cit ? n(cit.page) : null,
    noteMn: s(r.note_mn, 500),
    decisions: parseDecisions(r.decisions),
    ruleKind: s(r.rule_kind, 40),
    table: cit ? n(cit.table) : null,
    row: cit ? s(cit.row, 16) : null,
    legalReviewRequired: cit ? cit.legal_review_required === true : false,
    effectiveStatus: cit ? s(cit.effective_status, 120) : null,
    currentness: currentnessOf(cit ? s(cit.effective_status, 120) : null),
    datasetSha256: sha,
    datasetVersion: cit ? s(cit.dataset_version, 32) : null,
    noMatchReason: reason,
    registry: parseLocalNormRegistry(r.registry),
    explanation: parseLocalNormExplanation(r.explanation),
    namedDocument: nd
      ? {
          code: s(nd.code, 64),
          absent: nd.absent === true,
          relation: s(nd.relation, 32),
          relatedCode: s(nd.relatedCode ?? nd.related_code, 64),
        }
      : null,
    missingContext: Array.isArray(r.missing_context)
      ? r.missing_context.filter((m): m is string => typeof m === 'string').slice(0, 6).map((m) => m.slice(0, 80))
      : [],
    evidence,
  };
}

/**
 * Локал хэсгүүдийг prompt-ын нотолгоо болгоно — ХЭСЭГ БҮР ӨӨРИЙН баримттай.
 *
 * @param onlyDocument — TrustedNormResult байвал ЗӨВХӨН тэр баримтын хэсгүүд
 *   (өөр баримтын текст эрх бүхий үр дүнтэй ХЭЗЭЭ Ч холилдохгүй, P0-8).
 * @param dropReviewFlagged — хүний хяналттай/render-review хэсгийг prompt-д
 *   энгийн нотолгоо мэт оруулахгүй (транскрипцийн мета-тэмдэглэл орж байв).
 */
export function localNormEvidence(
  a: LocalNormAnswer,
  opts: { onlyDocument?: string | null; dropReviewFlagged?: boolean; sameDoc?: (a: string, b: string) => boolean } = {},
): Evidence[] {
  const same = opts.sameDoc ?? ((x: string, y: string) => x.toLowerCase().replace(/\s+/g, '') === y.toLowerCase().replace(/\s+/g, ''));
  return a.evidence
    .filter((e) => {
      const code = e.code ?? a.documentCode;
      if (opts.onlyDocument && (!code || !same(code, opts.onlyDocument))) return false;
      if (opts.dropReviewFlagged && e.verificationStatus && /review/i.test(e.verificationStatus)) return false;
      return true;
    })
    .map((e) => {
      const code = e.code ?? a.documentCode;
      return {
        id: `local:${e.chunkId}`,
        kind: e.clauseNo ? ('clause' as const) : ('chunk' as const),
        title: [code, e.clauseNo ? `заалт ${e.clauseNo}` : null].filter(Boolean).join(', ') || (code ?? 'Норм'),
        text: e.textMn,
        classification: 'public' as const,
        visibilityScope: 'public' as const,
        allowedRoles: [],
        projectId: null,
        orgId: null,
        documentUid: code,
        clauseUid: e.clauseNo,
        page: e.page,
        section: e.clauseNo,
        score: e.score,
      };
    });
}
