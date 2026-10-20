/**
 * MGL AI · L1 СЭДВИЙН ЧИГЛҮҮЛЭГЧ (topic → ОЛОН баримт) + 2025 оны нормын бүртгэлийн суурь мөрийн нэгтгэл.
 *
 * Эх багц: `MCIS_NORM_REGISTRY_L1_TOPIC_ROUTER_2026-09-18` (гитэд `ai/norm-dataset/router/*` +
 * `registry/cdc-2025/*`, провенанс `router/PACKAGE.json`).  Жишиг хэрэгжүүлэлт нь багцын
 * `router/topic_lookup.py` — энэ модуль түүнийг БАЙТ-ИЖИЛ үр дүнтэйгээр порт хийсэн
 * (`retrieval/test/topicRouter.test.ts` нь 92 eval кейсийн ЭРЭМБЭЛСЭН registry_id-г тулгана).
 *
 * ⚠️ ЭНЭ НЬ БАРИМТ ОЛОХ ДАВХАРГА, ЗААЛТЫН ХАЙЛТ БИШ.  «Цахилгаантай холбоотой өндөр барилгын норм
 *    юу вэ?» гэхэд ганц таамагласан норм биш, хамаарах БҮХ бүртгэлийн мөрийг код · нэр · албан
 *    холбоос · төлөвтэй нь буцаана (LINKS_ONLY).  2025 оны бүртгэлийн мөр нь заалт БИШ — эндээс
 *    заалтын дугаар, тоо, хүснэгт, томьёо ХЭЗЭЭ Ч гарахгүй; гүн хариулт GOLD багц руу явна.
 *
 * ⚠️ ТӨЛӨВ ЧИМЭЭГҮЙ ДЭЭШЛЭХГҮЙ.  Багцын `STATUS_REQUIRES_VERIFICATION` = хайж болно, 2026 оны хүчин
 *    төгөлдөр байдал шалгагдаагүй.  Куратор бүртгэл (`norms.jsonl`, MCIS-ээр баталгаажсан ACTIVE)-тэй
 *    код/alias-аар таарсан мөр НЭГТГЭГДЭНЭ — төлөв, нотолгоо, холбоос нь кураторынх хэвээр, багц зөвхөн
 *    alias, чиглүүлэлтийн сэдэв, 2025 оны мөрийн провенанс нэмнэ.  Давхардсан норм ҮҮСЭХГҮЙ.
 *
 * ⚠️ ТӨСӨВ (81-…) / ХӨДӨЛМӨР (83-…) ӨГӨГДМӨЛӨӨР ХАСАГДАНА.  `scope_classes` cost/labour мөр нь асуулт
 *    төсөв/өртөг/хөдөлмөр гэж ИЛ асуусан үед л орно — эс тэгвэл «цахилгаан норм» нь төсвийн 100 мөрөөр
 *    дүүрнэ.
 *
 * ⚠️ ХОЛБООС ХЭЗЭЭ Ч ХАЯГДАХГҮЙ: `url` = official_pdf_url → official_detail_url → source_url
 *    (куратор мөрөнд MCIS-ийн source_pdf_url → source_url эхэлнэ).  Багцын мөр бүр source_url-тай —
 *    шингээлт үүнийг ШАЛГАНА.
 *
 * Жишгээс ЗОРИУД зөрсөн ганц зүйл — морфологи (`stemFallback`, өгөгдмөл true): жишгийн дэд мөрийн
 * таарц «холбоо дохиоллын» ← «холбоо дохиолол»-ыг олдоггүй (дохиол-ЛЫН) тул сэдэвгүй үлдэж лексик
 * нөөц рүү унадаг.  Энд: жишгийн таарц ЭХЛЭЭД (байт-ижил), сэдэв олдоогүй үед Л `registry.ts`-ийн
 * язгуурын таарцаар alias-уудыг дахин тулгана.  `stemFallback:false` = жишиг.
 */
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { foldText } from './fold.ts';
import { aliasMatches } from './registry.ts';

export const L1_INGEST_VERSION = 'topic-router/1';
export const SCOPE_TECHNICAL = 'technical_or_regulatory';

const COST_TRIGGERS = ['төсөв', 'өртөг', 'үнэ бүрд', 'cost'];
const LABOUR_TRIGGERS = ['хөдөлмөр', 'нэгж хугацаа', 'labour', 'labor'];
/**
 * Латинаар бичсэн төсөв/хөдөлмөрийн дохио — `foldText(query)` дээр (жишиг `nq.includes` нь кирилл л).  «Tusviin
 * norm» гэхэд `cost_estimation` сэдэв (морфологи) олдоод, 113 мөр нь «ил асуугаагүй» гэж бүгд хасагдаж 0 гарч
 * байв (хэмжсэн 2026-09-21) — кирилл «Төсвийн норм» ч мөн адил (харьяалахын «төсвийн» нь «төсөв»-ийг агуулдаггүй).
 * «tosov/tosv» = fold(төсөв/төсвийн), «tusuv/tusv» = бичдэг хэлбэр; «ortog/urtug» = өртөг.
 */
const COST_TRIGGERS_FOLD = ['tosov', 'tosv', 'tusuv', 'tusv', 'ortog', 'urtug', 'une burd'];
const LABOUR_TRIGGERS_FOLD = ['hodolmor', 'hudulmur', 'negj hugaca'];

/* ── Түлхүүр ба хэвийжүүлэлт ────────────────────────────────────── */

/**
 * Нормын кодын түлхүүр — `norm-dataset/tools/build-registry.mjs`-ийн `codeKey`-тэй ИЖИЛ
 * (`topicRouter.test.ts` хоёрыг тулгана).  «БНбД 31-17-10» → «bnbd31-17-10».
 */
export function codeKey(code: string): string {
  return String(code)
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, '')
    .replace(/бнбд/g, 'bnbd')
    .replace(/бнод/g, 'bnod')
    .replace(/убб/g, 'ubb')
    .replace(/бд/g, 'bd')
    .replace(/снип/g, 'snip')
    .replace(/(\d)\.(\d)/g, '$1-$2');
}

/** Жишиг `norm()`: жижиг үсэг · ё→е · зай нэг · trim.  Цэг таслал ХЭВЭЭР (дэд мөрийн таарц). */
export function refNorm(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

const CODE_LIKE = /\d{2}-\d{2,3}-\d{2}|\d-\d{2}-\d{2}-\d{2}|ii-\d{2}-\d{2}/;

/**
 * Багцын код → куратор бүртгэлийн code_key.  Дараалал: яг ижил түлхүүр → «＊/NN» хувилбарын
 * дагаварыг хасах («БНбД 22-01-21＊/22» → «bnbd22-01-21＊» → «bnbd22-01-21»; ＊ = од) → alias индекс →
 * нийлмэл код («БД 43-101-03 БД 43-101-03*12») бол хэсэг бүрийг тус тусад нь, СҮҮЛИЙН олдсон нь
 * (хожуу хувилбар).  Олдохгүй бол null = багцын мөр ШИНЭ норм.
 */
export function resolveCuratedKey(code: string, curatedKeys: ReadonlySet<string>, aliasIndex: ReadonlyMap<string, string>): string | null {
  const one = (c: string): string | null => {
    const k = codeKey(c);
    const candidates = [k, k.replace(/\*\/\d{2}$/, '*'), k.replace(/\*\/\d{2}$/, ''), k.replace(/\*$/, '')];
    for (const cand of candidates) {
      if (curatedKeys.has(cand)) return cand;
      const via = aliasIndex.get(cand);
      if (via) return via;
    }
    return null;
  };
  const direct = one(code);
  if (direct) return direct;
  // ⚠️ ASCII `\b` кирилл үсгийн хажууд ҮҮСДЭГГҮЙ — зайгаар хүрээлнэ.
  const parts = code.split(/\s+(?=(?:БНбД|БНОД|БД|УББ|СНиП|MNS)\s)/u).map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length > 1) {
    let last: string | null = null;
    for (const p of parts) last = one(p) ?? last;
    return last;
  }
  return null;
}

/* ── Файлын хэлбэр ──────────────────────────────────────────────── */

export interface L1Paths {
  registry: string; // registry/cdc-2025/registry_with_verified_delta.jsonl
  catalog: string; // router/topic_catalog.json
  aliases: string; // router/topic_aliases.jsonl
  assignments: string; // router/document_topic_assignments.jsonl
  overlays: string; // router/building_overlays.json
  packageMeta?: string; // router/PACKAGE.json (dataset_id)
}

interface PkgRegistryRow {
  registry_id: string;
  canonical_code: string | null;
  title_mn: string;
  title_en: string | null;
  document_type: string;
  record_kind: string;
  status: string;
  baseline_status: string | null;
  baseline_year: number | null;
  supersedes: string[];
  superseded_by: string | null;
  aliases: string[];
  parent_registry_id: string | null;
  decision_text: string | null;
  invalid_decree_text: string | null;
  highrise_relevance: string | null;
  source_url: string;
  official_detail_url: string | null;
  official_pdf_url: string | null;
  legalinfo_url: string | null;
  status_evidence: Array<Record<string, unknown>>;
  source_checked_at: string | null;
  lookup_enabled: boolean;
  routing_topics: string[];
  scope_classes: string[];
  baseline_source: { pdf_sha256?: string; pdf_page?: number; printed_page?: number; row_no?: string; source_row_id?: string } | null;
}

interface PkgAssignment {
  registry_id: string;
  canonical_code: string | null;
  title_mn: string;
  topics: string[];
  scope_classes: string[];
  topic_evidence: Record<string, string[]>;
  source_url: string;
  official_detail_url: string | null;
  official_pdf_url: string | null;
  status: string;
  baseline_status: string | null;
}

interface TopicCatalog {
  topics: Record<string, { mn: string; aliases?: string[]; keywords?: string[] }>;
}

interface Overlays {
  [building: string]: { anchor_codes?: string[]; general_core_codes?: string[]; topic_overlays?: Record<string, string[]>; note?: string };
}

const readJsonl = <T,>(p: string): T[] =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);

/* ── Шингээлт (ingestRegistry-ийн гүйлгээ ДОТОР дуудагдана) ────── */

/** Куратор мөрийг бичсэн `ingestRegistry` энэ хаалгаар бүртгэлийн мөр/нэр томьёо нэмүүлнэ. */
export interface L1IngestHost {
  curatedKeys: ReadonlySet<string>;
  /** кодын alias (codeKey) → куратор code_key */
  aliasIndex: ReadonlyMap<string, string>;
  /** Куратор мөрийн taxonomy сэдэв + барилгын төрөл (code_key → түлхүүрүүд) — L1 сэдвийг НӨХӨХӨД. */
  curatedTopics?: ReadonlyMap<string, readonly string[]>;
  insertNorm: (row: Record<string, unknown>) => void;
  addTerm: (codeKey: string, kind: string, term: string, key: string | null, weight: number) => void;
}

/**
 * Куратор taxonomy (`team_topic_map.json`) → L1 сэдэв — ЗӨВХӨН БАРИЛГЫН ТӨРӨЛ.  Багц БНбД 31-25-22 (сургууль),
 * БНбД 31-03-03＊/11 (олон нийтийн барилга; ＊ = од)-д сэдэв ОГТ оноогоогүй тул «Сургуулийн барилгад ямар норм хамаарах вэ?»
 * → 0 гэж хариулж байв (хэмжсэн 2026-09-18).  Техникийн сэдвийг (цахилгаан, гэрэлтүүлэг …) энд ЗОРИУД нөхөхгүй —
 * 31-17-10-ын 29 сэдэв нь түүнийг бүх жагсаалтад оруулж чимээ болно; өндөр барилгын давхарга тэр ажлыг хийдэг.
 * `curatedTopics: false` = жишиг (topic_lookup.py) байт-ижил.
 */
export const CURATED_BUILDING_TYPE_TO_L1: Readonly<Record<string, string>> = {
  school: 'school',
  kindergarten: 'preschool',
  admin_building: 'administrative_building',
  public_building: 'public_building',
  public: 'public_building',
  residential: 'residential',
  hospital: 'healthcare',
  // ⚠️ `high-rise` ЗОРИУД ҮГҮЙ — куратор taxonomy 18 баримтад «high-rise» сэдэв өгдөг (31-17-10-ын ишлэлүүд);
  //    L1-ийн `highrise` нь сэдэв биш давхаргын түлхүүр тул чиглүүлэлтэд нөлөөгүй, харин өгөгдөлд чимээ.
};

export interface L1IngestCounts {
  /** Куратор барилгын төрлөөс НӨХСӨН сэдвийн холбоос (нэгтгэсэн мөрөнд л). */
  curated_topic_assignments: number;
  package_rows: number;
  merged_into_curated: number;
  inserted_new: number;
  by_pkg_status: Record<string, number>;
  topics: number;
  topic_aliases: number;
  assignments: number;
  overlay_codes: number;
  /** Давхаргын код бүртгэлд олдоогүй — ИЛ (чимээгүй алгасахгүй). */
  overlay_unresolved: string[];
  dataset_id: string;
}

function evidenceStrings(r: PkgRegistryRow): string[] {
  const out: string[] = [];
  for (const e of r.status_evidence ?? []) {
    const ev = e as Record<string, string | null | undefined>;
    out.push(`${ev.event ?? 'event'} — ${ev.source_url ?? ''} (act ${ev.act_number ?? '?'} ${ev.act_date ?? ''}, clause ${ev.act_clause ?? '?'}, checked ${ev.checked_at ?? ''})`.replace(/\s+/g, ' '));
  }
  if (r.baseline_status === 'ACTIVE_IN_2025_REGISTER') {
    const b = r.baseline_source ?? {};
    out.push(`2025 оны нормын бүртгэлийн жагсаалтад (${r.source_url}; pdf p.${b.pdf_page ?? '?'} мөр ${b.row_no ?? '?'}) — 2026 оны хүчин төгөлдөр байдал ШАЛГАГДААГҮЙ`);
  }
  return out;
}

export function ingestL1(db: DatabaseSync, paths: L1Paths, host: L1IngestHost): L1IngestCounts {
  const rows = readJsonl<PkgRegistryRow>(paths.registry);
  const assignments = readJsonl<PkgAssignment>(paths.assignments);
  const catalog = JSON.parse(readFileSync(paths.catalog, 'utf8')) as TopicCatalog;
  const aliasRows = readJsonl<{ alias: string; topic_id: string }>(paths.aliases);
  const overlays = JSON.parse(readFileSync(paths.overlays, 'utf8')) as Overlays;
  const datasetId = paths.packageMeta ? String((JSON.parse(readFileSync(paths.packageMeta, 'utf8')) as { dataset_id?: string }).dataset_id ?? 'unknown') : 'unknown';

  const byId = new Map<string, PkgRegistryRow>();
  for (const r of rows) {
    if (byId.has(r.registry_id)) throw new Error(`L1: registry_id давхардав: ${r.registry_id}`);
    if (!r.source_url) throw new Error(`L1: source_url алга: ${r.registry_id}`);
    byId.set(r.registry_id, r);
  }
  const assignById = new Map(assignments.map((a) => [a.registry_id, a] as const));
  for (const a of assignments) if (!byId.has(a.registry_id)) throw new Error(`L1: assignment-ийн registry_id бүртгэлд алга: ${a.registry_id}`);

  db.exec('DELETE FROM ai_norm_building_overlays');
  db.exec('DELETE FROM ai_norm_topic_assignments');
  db.exec('DELETE FROM ai_norm_topic_aliases');
  db.exec('DELETE FROM ai_norm_topics');
  db.exec('DELETE FROM ai_norm_registry_l1');

  // 1) registry_id → code_key (нэгтгэл эсвэл шинэ)
  const keyOf = new Map<string, string>();
  const merged = new Set<string>();
  const usedNewKeys = new Set<string>();
  const mergedKeyBy = new Map<string, string>();
  const counts: L1IngestCounts = { curated_topic_assignments: 0, package_rows: rows.length, merged_into_curated: 0, inserted_new: 0, by_pkg_status: {}, topics: 0, topic_aliases: 0, assignments: 0, overlay_codes: 0, overlay_unresolved: [], dataset_id: datasetId };
  for (const r of rows) {
    counts.by_pkg_status[r.status] = (counts.by_pkg_status[r.status] ?? 0) + 1;
    let key: string | null = r.canonical_code ? resolveCuratedKey(r.canonical_code, host.curatedKeys, host.aliasIndex) : null;
    if (key) {
      // Хоёр багцын мөр нэг куратор мөрөнд нэгтгэгдэх нь давхардлын дохио — чимээгүй биш, алдаа.
      const prev = mergedKeyBy.get(key);
      if (prev) throw new Error(`L1: ${r.registry_id} (${r.canonical_code}) ба ${prev} хоёулаа куратор ${key}-д нэгтгэгдэнэ`);
      mergedKeyBy.set(key, r.registry_id);
      merged.add(r.registry_id);
    } else {
      key = r.canonical_code ? codeKey(r.canonical_code) : `reg:${r.registry_id.replace(/^mn-construction:/, '')}`;
      if (host.curatedKeys.has(key) || usedNewKeys.has(key)) key = `reg:${r.registry_id.replace(/^mn-construction:/, '')}`;
      usedNewKeys.add(key);
    }
    keyOf.set(r.registry_id, key);
  }
  const codeOfId = (id: string | null): string | null => (id ? (byId.get(id)?.canonical_code ?? null) : null);

  // 2) ai_norm_registry: шинэ мөр INSERT, нэгтгэсэн мөрөнд alias/нэр томьёо л
  const insL1 = db.prepare(
    `INSERT INTO ai_norm_registry_l1 (code_key, registry_id, canonical_code_pkg, record_kind, merged_into_curated, pkg_status, baseline_status, baseline_year,
       scope_classes_json, routing_topics_json, topic_evidence_json, source_url, official_detail_url, official_pdf_url, legalinfo_url, parent_registry_id,
       decision_text, invalid_decree_text, lookup_enabled, baseline_source_json, dataset_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insAssign = db.prepare('INSERT OR IGNORE INTO ai_norm_topic_assignments (code_key, topic_id) VALUES (?, ?)');
  for (const r of rows) {
    const key = keyOf.get(r.registry_id)!;
    const a = assignById.get(r.registry_id);
    const scopes = a?.scope_classes ?? r.scope_classes ?? [];
    const topics = [...(a?.topics ?? r.routing_topics ?? [])];
    const isMerged = merged.has(r.registry_id);
    if (isMerged && host.curatedTopics) {
      for (const t of host.curatedTopics.get(key) ?? []) {
        const l1 = CURATED_BUILDING_TYPE_TO_L1[t];
        if (l1 && !topics.includes(l1)) {
          topics.push(l1);
          counts.curated_topic_assignments += 1;
        }
      }
    }
    if (isMerged) {
      counts.merged_into_curated += 1;
      // Куратор мөр: төлөв/нотолгоо/холбоос ХӨНДӨХГҮЙ; багцын код + alias-ыг нэр томьёо болгон нэмнэ.
      if (r.canonical_code) host.addTerm(key, 'alias', r.canonical_code, null, 100);
      for (const al of r.aliases ?? []) host.addTerm(key, 'alias', al, null, CODE_LIKE.test(codeKey(al)) ? 100 : 30);
    } else {
      counts.inserted_new += 1;
      const nonCurrent = r.status === 'SUPERSEDED' || r.status === 'HISTORICAL' || r.status === 'DRAFT';
      host.insertNorm({
        code_key: key,
        canonical_code: r.canonical_code ?? '',
        title_mn: r.title_mn,
        title_en: r.title_en ?? null,
        document_type: r.document_type,
        status: r.status,
        status_evidence: evidenceStrings(r),
        effective_status: r.status === 'SUPERSEDED' ? 'superseded' : 'unknown_requires_legal_verification',
        capability_level: 'L0',
        priority: /^P[0-9]$/.test(r.highrise_relevance ?? '') ? String(r.highrise_relevance) : 'P2',
        teams: [],
        topics: [],
        building_types: [],
        aliases: [...new Set([...(r.canonical_code ? [r.canonical_code] : []), ...(r.aliases ?? [])])],
        supersedes: (r.supersedes ?? []).map(codeOfId).filter((c): c is string => c !== null),
        superseded_by: codeOfId(r.superseded_by),
        successor_draft: null,
        draft_of: null,
        approval: r.decision_text ?? null,
        source_url: r.official_detail_url ?? r.source_url,
        source_pdf_url: r.official_pdf_url ?? null,
        legal_source_url: r.legalinfo_url ?? null,
        source_type: r.record_kind === 'post_baseline_record' ? 'legalinfo_replacement_event' : 'cdc-register-2025',
        retrieval_default: r.lookup_enabled !== false && !nonCurrent,
        deep_ingestion_status: 'NOT_STARTED',
        document_dir: null,
        local_pack: null,
        note: `${r.record_kind}; 2025 оны бүртгэлийн мөр — заалт биш; хүчин төгөлдөр байдал шалгагдаагүй`,
        last_verified: r.source_checked_at ?? '2026-09-18',
        registry_version: L1_INGEST_VERSION,
      });
      if (r.canonical_code) host.addTerm(key, 'code', r.canonical_code, null, 100);
      host.addTerm(key, 'title', r.title_mn, null, 40);
      if (r.title_en) host.addTerm(key, 'title', r.title_en, null, 30);
      for (const al of r.aliases ?? []) host.addTerm(key, 'alias', al, null, CODE_LIKE.test(codeKey(al)) ? 100 : 30);
    }
    insL1.run(
      key, r.registry_id, r.canonical_code ?? null, r.record_kind, isMerged ? 1 : 0, r.status, r.baseline_status ?? null, r.baseline_year ?? null,
      JSON.stringify(scopes), JSON.stringify(topics), JSON.stringify(a?.topic_evidence ?? {}), r.source_url, r.official_detail_url ?? null,
      r.official_pdf_url ?? null, r.legalinfo_url ?? null, r.parent_registry_id ?? null, r.decision_text ?? null, r.invalid_decree_text ?? null,
      r.lookup_enabled === false ? 0 : 1,
      JSON.stringify({ pdf_sha256: r.baseline_source?.pdf_sha256 ?? null, pdf_page: r.baseline_source?.pdf_page ?? null, printed_page: r.baseline_source?.printed_page ?? null, row_no: r.baseline_source?.row_no ?? null, source_row_id: r.baseline_source?.source_row_id ?? null }),
      datasetId,
    );
    for (const t of topics) {
      insAssign.run(key, t);
      counts.assignments += 1;
    }
  }

  // 3) сэдвийн каталог + alias
  const insTopic = db.prepare('INSERT INTO ai_norm_topics (topic_id, label_mn, aliases_json, keywords_json) VALUES (?,?,?,?)');
  const insAlias = db.prepare('INSERT OR IGNORE INTO ai_norm_topic_aliases (topic_id, alias, alias_norm, alias_fold) VALUES (?,?,?,?)');
  const aliasesByTopic = new Map<string, Set<string>>();
  for (const [tid, m] of Object.entries(catalog.topics)) {
    const set = new Set<string>([m.mn, ...(m.aliases ?? [])]);
    aliasesByTopic.set(tid, set);
    insTopic.run(tid, m.mn, JSON.stringify(m.aliases ?? []), JSON.stringify(m.keywords ?? []));
    counts.topics += 1;
  }
  for (const a of aliasRows) {
    if (!aliasesByTopic.has(a.topic_id)) throw new Error(`L1: alias-ын сэдэв каталогт алга: ${a.topic_id}`);
    aliasesByTopic.get(a.topic_id)!.add(a.alias);
  }
  for (const [tid, set] of aliasesByTopic) {
    for (const al of set) {
      insAlias.run(tid, al, refNorm(al), foldText(al));
      counts.topic_aliases += 1;
    }
  }
  for (const t of new Set(assignments.flatMap((a) => a.topics))) if (!aliasesByTopic.has(t)) throw new Error(`L1: assignment-ийн сэдэв каталогт алга: ${t}`);

  // 4) барилгын төрлийн давхарга — код → code_key (багцын код → registry_id → key; эс бөгөөс куратор)
  const keyByPkgCode = new Map<string, string>();
  for (const r of rows) if (r.canonical_code) keyByPkgCode.set(r.canonical_code, keyOf.get(r.registry_id)!);
  const resolveOverlay = (code: string): string | null => keyByPkgCode.get(code) ?? resolveCuratedKey(code, host.curatedKeys, host.aliasIndex);
  const insOverlay = db.prepare('INSERT INTO ai_norm_building_overlays (building, kind, topic_id, position, code, code_key) VALUES (?,?,?,?,?,?)');
  for (const [building, o] of Object.entries(overlays)) {
    const put = (kind: string, topic: string, codes: string[]): void => {
      codes.forEach((code, i) => {
        const k = resolveOverlay(code);
        if (k === null) counts.overlay_unresolved.push(`${building}/${kind}${topic ? ':' + topic : ''}: ${code}`);
        insOverlay.run(building, kind, topic, i, code, k);
        counts.overlay_codes += 1;
      });
    };
    put('anchor', '', o.anchor_codes ?? []);
    put('core', '', o.general_core_codes ?? []);
    for (const [t, codes] of Object.entries(o.topic_overlays ?? {})) put('topic', t, codes);
  }
  return counts;
}

/* ── Чиглүүлэлт ─────────────────────────────────────────────────── */

export interface TopicRouteOptions {
  /** Төсвийн (81-…) мөрийг оруулах — асуулт төсөв/өртөг гэж хэлээгүй ч. */
  includeCost?: boolean;
  /** Хөдөлмөр зарцуулалтын (83-…) мөрийг оруулах. */
  includeLabour?: boolean;
  /** Жишгийн дэд мөрийн таарц сэдэв олоогүй үед язгуурын таарцаар дахин оролдох (өгөгдмөл true). */
  stemFallback?: boolean;
  building?: string;
}

export interface TopicRouteResult {
  registry_id: string;
  /** Бүртгэлийн канон код (куратор мөрөнд кураторынх), кодгүй баримтад null. */
  code: string | null;
  /** Багцын код — нэгтгэсэн мөрөнд куратор кодоос зөрж болно («БД 43-101-03 БД 43-101-03*12»). */
  code_pkg: string | null;
  title_mn: string;
  title_en: string | null;
  document_type: string;
  record_kind: string;
  /** Хүчинтэй төлөв: куратор мөрөнд MCIS-ийн (ACTIVE …), багцын мөрөнд STATUS_REQUIRES_VERIFICATION / SUPERSEDED. */
  status: string;
  status_note_mn: string;
  status_verified: boolean;
  baseline_status: string | null;
  superseded_by: string | null;
  scope_classes: string[];
  topics: string[];
  /** ХЭЗЭЭ Ч null биш: official_pdf_url → official_detail_url → source_url. */
  url: string;
  official_pdf_url: string | null;
  official_detail_url: string | null;
  source_url: string;
  legal_source_url: string | null;
  capability_level: string;
  deep_ingestion_status: string;
  merged_into_curated: boolean;
  router_score: number;
  router_reason: string;
}

export interface TopicRoute {
  query: string;
  detected_topics: string[];
  detection: 'exact' | 'stem' | 'none';
  wants_cost: boolean;
  wants_labour: boolean;
  count: number;
  results: TopicRouteResult[];
  excluded: { cost: number; labour: number };
  answer_mode: 'LINKS_ONLY';
  note_mn: string;
}

interface JoinedRow {
  code_key: string;
  registry_id: string;
  canonical_code_pkg: string | null;
  record_kind: string;
  merged_into_curated: number;
  pkg_status: string;
  baseline_status: string | null;
  scope_classes_json: string;
  routing_topics_json: string;
  source_url: string;
  official_detail_url: string | null;
  official_pdf_url: string | null;
  legalinfo_url: string | null;
  canonical_code: string;
  title_mn: string;
  title_en: string | null;
  document_type: string;
  status: string;
  superseded_by: string | null;
  r_source_url: string | null;
  r_source_pdf_url: string | null;
  r_legal_source_url: string | null;
  capability_level: string;
  deep_ingestion_status: string;
}

const JOIN_SQL = `SELECT l.code_key, l.registry_id, l.canonical_code_pkg, l.record_kind, l.merged_into_curated, l.pkg_status, l.baseline_status,
       l.scope_classes_json, l.routing_topics_json, l.source_url, l.official_detail_url, l.official_pdf_url, l.legalinfo_url,
       r.canonical_code, r.title_mn, r.title_en, r.document_type, r.status, r.superseded_by,
       r.source_url AS r_source_url, r.source_pdf_url AS r_source_pdf_url, r.legal_source_url AS r_legal_source_url,
       r.capability_level, r.deep_ingestion_status
  FROM ai_norm_registry_l1 l JOIN ai_norm_registry r ON r.code_key = l.code_key`;

export function topicStatusNote(status: string, superseded_by: string | null): string {
  switch (status) {
    case 'ACTIVE':
      return 'MCIS-ийн хүчин төгөлдөр нормын бүртгэлд «Хүчин төгөлдөр» (сүүлд шалгасан огноог үз).';
    case 'STATUS_REQUIRES_VERIFICATION':
      return '2025 оны нормын бүртгэлийн жагсаалтад байсан; 2026 оны хүчин төгөлдөр байдал ШАЛГАГДААГҮЙ — ашиглахын өмнө албан бүртгэлээр баталгаажуулна уу.';
    case 'CANDIDATE_NEEDS_STATUS_CHECK':
      return 'Хүчин төгөлдөр эсэх нь албан бүртгэлээр ШАЛГАГДААГҮЙ — ашиглахын өмнө баталгаажуулна уу.';
    case 'SUPERSEDED':
      return superseded_by ? `Солигдсон — одоо мөрдөгдөж буй хувилбар: ${superseded_by}.` : 'Солигдсон — одоо мөрдөгдөж буй хувилбарыг үз.';
    case 'DRAFT':
      return 'ТӨСӨЛ — батлагдаагүй; одоогийн шаардлагын эх сурвалж БИШ.';
    case 'HISTORICAL':
      return 'Түүхэн баримт — одоогийн шаардлага биш.';
    default:
      return status;
  }
}

function toResult(j: JoinedRow, score: number, why: string): TopicRouteResult {
  const merged = j.merged_into_curated === 1;
  // Куратор мөр: MCIS-ийн PDF → MCIS-ийн дэлгэрэнгүй → багцынх.  Багцын мөр: pdf → detail → бүртгэлийн хуудас.
  const url = (merged ? j.r_source_pdf_url ?? j.r_source_url : null) ?? j.official_pdf_url ?? j.official_detail_url ?? j.source_url;
  const status = j.status;
  return {
    registry_id: j.registry_id,
    code: j.canonical_code.length > 0 ? j.canonical_code : null,
    code_pkg: j.canonical_code_pkg,
    title_mn: j.title_mn,
    title_en: j.title_en,
    document_type: j.document_type,
    record_kind: j.record_kind,
    status,
    status_note_mn: topicStatusNote(status, j.superseded_by),
    status_verified: status === 'ACTIVE',
    baseline_status: j.baseline_status,
    superseded_by: j.superseded_by,
    scope_classes: JSON.parse(j.scope_classes_json) as string[],
    topics: JSON.parse(j.routing_topics_json) as string[],
    url,
    official_pdf_url: j.official_pdf_url ?? (merged ? j.r_source_pdf_url : null),
    official_detail_url: j.official_detail_url ?? (merged ? j.r_source_url : null),
    source_url: j.source_url,
    legal_source_url: j.legalinfo_url ?? j.r_legal_source_url,
    capability_level: j.capability_level,
    deep_ingestion_status: j.deep_ingestion_status,
    merged_into_curated: merged,
    router_score: score,
    router_reason: why,
  };
}

/**
 * Латинаар БИЧДЭГ хэлбэрийн fold — «ө» → «u».  `foldText` нь ө→o («өндөр барилга» → «ondor barilga») боловч
 * ажилтан латинаар «undur barilga» гэж бичдэг (хэмжсэн 2026-09-21: «Tsahilgaantai holbootoi undur barilgiin norm»
 * → зөвхөн `electrical`, `highrise` алдагдаж 11-ийн оронд 18 мөр).  L0 taxonomy (`team_topic_map.json`) энэ
 * хэлбэрийг ил alias-аар («undur barilga») барьдаг; L1 каталогт латин alias байхгүй тул ө-тэй alias бүрд энэ
 * хоёр дахь fold-ыг ЗӨВХӨН морфологийн нөөцөд (stemFallback) тулгана — жишиг горим (stemFallback:false)
 * ХӨНДӨГДӨХГҮЙ.  ү нь `foldText`-д аль хэдийн u.  ө-гүй alias-д null (нэмэлт тулгалтгүй).
 */
export function latinTypedFold(alias: string): string | null {
  if (!/ө/iu.test(alias)) return null;
  return foldText(alias.replace(/ө/giu, 'у'));
}

/**
 * ЯРИАНЫ НЭР (2026-09-28, эзний бодит чат) — «Mongold hudaldaanii tov barilaa gehed, tog us avah norm durem baidag
 * uu» (кирилл «…тог, ус авах норм…» ч мөн) нь ЯМАР Ч сэдэвгүй буцаж «энэ төрлийн барилгад норм санд алга» гэж
 * хариулагдав.  Ажилтан цахилгааныг «тог», ус хангамжийг «ус», дулаан хангамжийг «дулаан» гэж ярьдаг; багцын alias
 * нь албан нэр л («цахилгаан хангамж», «ус хангамж»).  Богино үг тул ДЭД МӨРӨӨР БИШ (тог ⊂ тогтоол, тоглоом; ус ⊂
 * хус), ФОЛДСОН БҮТЭН ТОКЕНООР таарна — кирилл, латин хоёулаа нэг фолд («ус» = «us»).
 * ⚠️ Зөвхөн морфологийн горимд (жишиг `stemFallback:false` = topic_lookup.py-тай байт-ижил ХӨНДӨГДӨХГҮЙ).
 * ⚠️ Латин «us» нь англи «us» — асуулт англи туслах үгтэй бол (tell us, for us) латин ярианы токен тоологдохгүй.
 * ⚠️ «дулаан хамгаалалт/тусгаарлалт/алдагдал» = эрчим хүчний хэмнэлт (өөр сэдэв, alias-аар олдоно) — дараагийн
 *    токен тэр бол «дулаан» hvac болохгүй.
 */
const COLLOQUIAL_TOPIC_TOKENS: ReadonlyArray<{ topic: string; tokens: readonly string[]; ambiguous?: readonly string[]; notBefore?: readonly string[] }> = [
  { topic: 'electrical', tokens: ['тогны', 'тогийг', 'тогоор', 'тогтой', 'togni', 'tognii', 'togiig', 'togoor', 'togtoi'], ambiguous: ['тог'] },
  { topic: 'water_supply', tokens: ['усны', 'усыг', 'усаа', 'усаар', 'усан', 'усгүй', 'usnii', 'usiig', 'usaar', 'usgui'], ambiguous: ['ус'] },
  { topic: 'hvac', tokens: ['дулааны', 'дулааныг', 'dulaanii', 'dulaaniig'], ambiguous: ['дулаан'], notBefore: ['хамгаалалт', 'тусгаарлалт', 'алдагдал', 'hamgaalalt', 'tusgaarlalt', 'aldagdal'] },
  { topic: 'sewerage', tokens: ['бохир', 'канализац', 'канализаци', 'bohir', 'kanalizats', 'kanalizatsi'] },
];
const EN_GUARD = /(?:^|[^a-z])(?:the|is|are|what|which|for|to|of|do|does|can|tell|give|show|me|you|please|how|we|our)(?:[^a-z]|$)/i;
/** Фолдсон токен: кирилл «ус» ба латин «us» нэг хэлбэрт очдог — англитай давхцах үндсэн хэлбэр (`ambiguous`) нь хамгаалалттай. */
const colloquialIndex: ReadonlyArray<{ topic: string; plain: ReadonlySet<string>; ambiguous: ReadonlySet<string>; notBefore: readonly string[] }> = COLLOQUIAL_TOPIC_TOKENS.map((c) => ({
  topic: c.topic,
  plain: new Set(c.tokens.map((t) => foldText(t))),
  ambiguous: new Set((c.ambiguous ?? []).map((t) => foldText(t))),
  notBefore: (c.notBefore ?? []).map((t) => foldText(t)),
}));
export function colloquialTopics(query: string): string[] {
  const ambiguousOk = /[Ѐ-ӿ]/u.test(query) || !EN_GUARD.test(query);
  const tokens = foldText(query).split(' ').filter((t) => t.length > 0);
  const out: string[] = [];
  for (const c of colloquialIndex) {
    const hit = tokens.some((t, i) => {
      if (!(c.plain.has(t) || (ambiguousOk && c.ambiguous.has(t)))) return false;
      const next = tokens[i + 1];
      return !(next !== undefined && c.notBefore.some((nb) => next.startsWith(nb)));
    });
    if (hit) out.push(c.topic);
  }
  return out;
}

/** Жишиг `detect()`: alias нь хэвийжүүлсэн асуултын ДЭД МӨР; сэдэв бүрд хамгийн урт таарсан alias; (-урт, id). */
export function detectTopics(db: DatabaseSync, query: string, opts: { stemFallback?: boolean } = {}): { topics: string[]; detection: 'exact' | 'stem' | 'none' } {
  const nq = refNorm(query);
  const aliases = db.prepare('SELECT topic_id, alias, alias_norm, alias_fold FROM ai_norm_topic_aliases').all() as Array<{ topic_id: string; alias: string; alias_norm: string; alias_fold: string }>;
  const best = new Map<string, number>();
  for (const a of aliases) {
    if (a.alias_norm.length > 0 && nq.includes(a.alias_norm)) best.set(a.topic_id, Math.max(best.get(a.topic_id) ?? 0, a.alias.length));
  }
  const order = (m: Map<string, number>): string[] => [...m.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)).map((e) => e[0]);
  if (opts.stemFallback === false) return best.size > 0 ? { topics: order(best), detection: 'exact' } : { topics: [], detection: 'none' };
  // Ярианы нэр — ЯМАР Ч горимд (exact-тай хамт) нэмэгдэнэ: «цахилгаан, ус авах» → electrical (alias) + water_supply (ярианы).
  //    Жин нь 1 — жинхэнэ alias-ын дараа эрэмбэлэгдэнэ.
  const colloquial = colloquialTopics(query).filter((t) => aliases.some((a) => a.topic_id === t));
  if (best.size > 0) {
    for (const t of colloquial) if (!best.has(t)) best.set(t, 1);
    return { topics: order(best), detection: 'exact' };
  }
  for (const t of colloquial) best.set(t, 1);
  const tokens = foldText(query).split(' ').filter((t) => t.length > 0);
  for (const a of aliases) {
    const alt = latinTypedFold(a.alias);
    if ((a.alias_fold.length > 0 && aliasMatches(a.alias_fold, tokens)) || (alt !== null && alt.length > 0 && aliasMatches(alt, tokens))) {
      best.set(a.topic_id, Math.max(best.get(a.topic_id) ?? 0, a.alias.length));
    }
  }
  return best.size > 0 ? { topics: order(best), detection: 'stem' } : { topics: [], detection: 'none' };
}

export function routeTopics(db: DatabaseSync, query: string, opts: TopicRouteOptions = {}): TopicRoute {
  const nq = refNorm(query);
  const { topics, detection } = detectTopics(db, query, { stemFallback: opts.stemFallback });
  const fq = opts.stemFallback === false ? '' : ` ${foldText(query)} `;
  const wantsCost = opts.includeCost === true || COST_TRIGGERS.some((t) => nq.includes(t)) || COST_TRIGGERS_FOLD.some((t) => fq.includes(t));
  const wantsLabour = opts.includeLabour === true || LABOUR_TRIGGERS.some((t) => nq.includes(t)) || LABOUR_TRIGGERS_FOLD.some((t) => fq.includes(t));
  const building = opts.building ?? 'highrise';
  const highrise = topics.includes(building);
  const topicset = topics.filter((t) => t !== building);

  const rows = db.prepare(JOIN_SQL).all() as unknown as JoinedRow[];
  const byKey = new Map(rows.map((r) => [r.code_key, r] as const));
  const out: TopicRouteResult[] = [];
  const seen = new Set<string>();
  const excluded = { cost: 0, labour: 0 };
  const add = (j: JoinedRow, score: number, why: string): void => {
    if (seen.has(j.registry_id)) return;
    const scopes = JSON.parse(j.scope_classes_json) as string[];
    if (scopes.includes('cost') && !wantsCost) { excluded.cost += 1; seen.add(j.registry_id); return; }
    if (scopes.includes('labour') && !wantsLabour) { excluded.labour += 1; seen.add(j.registry_id); return; }
    out.push(toResult(j, score, why));
    seen.add(j.registry_id);
  };

  let overlayLocked = false;
  if (highrise) {
    const ov = db.prepare('SELECT kind, topic_id, position, code, code_key FROM ai_norm_building_overlays WHERE building = ? ORDER BY position').all(building) as Array<{ kind: string; topic_id: string; position: number; code: string; code_key: string | null }>;
    const explicit: typeof ov = [];
    for (const t of topicset) explicit.push(...ov.filter((o) => o.kind === 'topic' && o.topic_id === t));
    let codes: typeof ov;
    if (explicit.length > 0) { codes = explicit; overlayLocked = true; }
    else if (topicset.length === 0) codes = ov.filter((o) => o.kind === 'core');
    else codes = ov.filter((o) => o.kind === 'anchor');
    codes.forEach((o, i) => {
      const j = o.code_key ? byKey.get(o.code_key) : undefined;
      if (j) add(j, Math.round((100 - i * 0.1) * 10) / 10, 'curated_highrise_overlay');
    });
  }
  const toks = nq.split(' ').filter((t) => t.length >= 4);
  for (const j of rows) {
    const at = JSON.parse(j.routing_topics_json) as string[];
    const inter = at.filter((t) => topicset.includes(t));
    if (topicset.length > 0 && inter.length > 0 && !overlayLocked) {
      add(j, 80 + 5 * inter.length, 'topic_match:' + [...inter].sort().join(','));
    } else if (topicset.length === 0 && !highrise) {
      const txt = refNorm((j.canonical_code_pkg ?? '') + ' ' + j.title_mn);
      if (toks.length > 0 && toks.filter((t) => txt.includes(t)).length >= Math.max(1, Math.floor(toks.length / 2))) add(j, 50, 'lexical_fallback');
    }
  }
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  out.sort((a, b) => b.router_score - a.router_score || cmp(a.code_pkg ?? '', b.code_pkg ?? '') || cmp(a.title_mn, b.title_mn));
  return {
    query,
    detected_topics: topics,
    detection,
    wants_cost: wantsCost,
    wants_labour: wantsLabour,
    count: out.length,
    results: out,
    excluded,
    answer_mode: 'LINKS_ONLY',
    note_mn: 'Баримт олох давхарга (L1): код · нэр · албан холбоос · төлөв.  2025 оны бүртгэлийн мөр нь заалт биш — техникийн шаардлага, тоо эндээс гарахгүй.',
  };
}

/** Сэдвийн каталог (UI/оношилгоо) — id · монгол нэр · alias-ын тоо · баримтын тоо. */
export function topicCatalog(db: DatabaseSync): Array<{ topic_id: string; label_mn: string; aliases: number; documents: number }> {
  return db
    .prepare(
      `SELECT t.topic_id, t.label_mn,
              (SELECT COUNT(*) FROM ai_norm_topic_aliases a WHERE a.topic_id = t.topic_id) AS aliases,
              (SELECT COUNT(*) FROM ai_norm_topic_assignments s WHERE s.topic_id = t.topic_id) AS documents
         FROM ai_norm_topics t ORDER BY t.topic_id`,
    )
    .all() as Array<{ topic_id: string; label_mn: string; aliases: number; documents: number }>;
}

export function topicRouterCount(db: DatabaseSync): { l1_rows: number; merged: number; topics: number; assignments: number } | null {
  try {
    const r = db.prepare('SELECT COUNT(*) AS n, SUM(merged_into_curated) AS m FROM ai_norm_registry_l1').get() as { n: number; m: number | null };
    const t = db.prepare('SELECT COUNT(*) AS n FROM ai_norm_topics').get() as { n: number };
    const a = db.prepare('SELECT COUNT(*) AS n FROM ai_norm_topic_assignments').get() as { n: number };
    return { l1_rows: r.n, merged: r.m ?? 0, topics: t.n, assignments: a.n };
  } catch {
    return null;
  }
}
