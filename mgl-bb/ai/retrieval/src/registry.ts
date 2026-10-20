/**
 * MGL AI · L0 НОРМЫН БҮРТГЭЛ — шингээлт + чиглүүлэгч хайлт (ai/norm-dataset/registry).
 *
 * ⚠️ ЭНЭ НЬ ЗААЛТЫН ХАЙЛТ БИШ.  `pipeline.ts` нь шингээсэн баримтын ХЭСГҮҮДИЙГ хайдаг;
 *    энэ модуль нь НОРМ ГЭДЭГ НЭГЖИЙГ хайдаг — код · нэр · төлөв · баг/сэдэв · албан
 *    холбоос.  «Өндөр барилгын гэрэлтүүлгийн норм өг» гэхэд заалт биш, ЖАГСААЛТ хэрэгтэй.
 *    Хариу нь LINKS_ONLY: техникийн шаардлага ЭНДЭЭС ХЭЗЭЭ Ч гарахгүй.
 *
 * ⚠️ ТӨЛӨВ НЬ ШҮҮЛТ.  Өгөгдмөлөөр DRAFT / SUPERSEDED / HISTORICAL нь гарахгүй
 *    (`retrieval_default = 0`); `includeNonCurrent: true` гэж ИЛ асуувал л гарна, тэр үед ч
 *    `status` мөр бүрд хамт явна.  CANDIDATE_NEEDS_STATUS_CHECK нь гарна — гэвч
 *    `status_note` нь «бүртгэлд шалгагдаагүй» гэж хэлнэ.
 *
 * ⚠️ ТААРЦ НЬ ҮГИЙН ЭХНЭЭС (морфологи).  «гэрэлтүүлэг» ↔ «гэрэлтүүлгийн»: alias-ын үг бүрийн
 *    язгуурыг (урт − 3, ≥ 4 тэмдэгт) асуултын үгийн ЭХЭНД тулгана; 4-өөс богино үг бүтнээрээ.
 *    `fold.ts` кирилл/латин хоёуланг нэг мөрөнд буулгадаг тул «undur barilga» ч таарна.
 */
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { foldText } from './fold.ts';
import { ingestL1, codeKey, type L1Paths, type L1IngestCounts } from './topicRouter.ts';

export const REGISTRY_INGEST_VERSION = 'norm-registry/1';
const NON_CURRENT = new Set(['DRAFT', 'SUPERSEDED', 'HISTORICAL']);
/** Кодын хэлбэртэй alias (build-registry.mjs-ийн alias индексийн ижил regex). */
const CODE_LIKE_KEY = /\d{2}-\d{2,3}-\d{2}|\d-\d{2}-\d{2}-\d{2}|ii-\d{2}-\d{2}/;

export interface RegistryRow {
  canonical_code: string;
  code_key: string;
  title_mn: string;
  title_en: string | null;
  document_type: string;
  status: string;
  status_evidence: string[];
  effective_status: string | null;
  capability_level: string;
  priority: string;
  teams: string[];
  topics: string[];
  building_types: string[];
  aliases: string[];
  supersedes: string[];
  superseded_by: string | null;
  successor_draft: string | null;
  draft_of: string | null;
  approval: string | null;
  source_url: string | null;
  source_pdf_url: string | null;
  legal_source_url: string | null;
  source_type: string;
  retrieval_default: boolean;
  deep_ingestion_status: string;
  document_dir: string | null;
  local_pack: string | null;
  note: string | null;
  last_verified: string;
}

interface Taxonomy {
  teams: Record<string, { label_mn?: string; aliases: string[] }>;
  topics: Record<string, { aliases: string[] }>;
  building_types?: Record<string, string[]>;
}

const readJsonl = (p: string): Record<string, unknown>[] =>
  readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

/* ── Шингээлт ───────────────────────────────────────────────────── */

export interface RegistryIngestCounts {
  norms: number;
  terms: number;
  references: number;
  byStatus: Record<string, number>;
  /** L1 багц (2025 оны бүртгэл + сэдвийн чиглүүлэгч) шингэсэн бол түүний тоо; `paths.l1` өгөөгүй бол null. */
  l1: L1IngestCounts | null;
}

/**
 * ⚠️ Куратор мөр (`norms.jsonl`) ЭХЛЭЭД, L1 багц (`paths.l1`) ДАРАА нь — нэг гүйлгээнд.  L1 нь куратор
 *    мөртэй код/alias-аар таарвал НЭГТГЭНЭ (төлөв/нотолгоо/холбоос кураторынх хэвээр), эс бөгөөс шинэ мөр.
 *    Тиймээс `byStatus`-д L1-ийн `STATUS_REQUIRES_VERIFICATION` мөрүүд ч тоологдоно.
 */
export function ingestRegistry(db: DatabaseSync, paths: { norms: string; references: string; taxonomy: string; l1?: L1Paths }, opts: { curatedTopics?: boolean } = {}): RegistryIngestCounts {
  const norms = readJsonl(paths.norms) as unknown as RegistryRow[];
  const refs = readJsonl(paths.references);
  const tax = JSON.parse(readFileSync(paths.taxonomy, 'utf8')) as Taxonomy;
  const byStatus: Record<string, number> = {};
  let terms = 0;
  let l1: L1IngestCounts | null = null;

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM ai_norm_references');
    db.exec('DELETE FROM ai_norm_registry_terms');
    db.exec('DELETE FROM ai_norm_registry');
    const ins = db.prepare(
      `INSERT INTO ai_norm_registry (code_key, canonical_code, title_mn, title_en, document_type, status, status_evidence_json,
         effective_status, capability_level, priority, teams_json, topics_json, building_types_json, aliases_json, supersedes_json,
         superseded_by, successor_draft, draft_of, approval, source_url, source_pdf_url, legal_source_url, source_type,
         retrieval_default, deep_ingestion_status, document_dir, local_pack, note, last_verified, registry_version)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insTerm = db.prepare(
      'INSERT OR IGNORE INTO ai_norm_registry_terms (code_key, kind, term, term_fold, key, weight) VALUES (?,?,?,?,?,?)',
    );
    const term = (codeKey: string, kind: string, t: string, key: string | null, weight: number): void => {
      const f = foldText(t);
      if (f.length === 0) return;
      insTerm.run(codeKey, kind, t, f, key, weight);
      terms += 1;
    };
    const insertNorm = (n: RegistryRow & { registry_version?: string }): void => {
      byStatus[n.status] = (byStatus[n.status] ?? 0) + 1;
      ins.run(
        n.code_key, n.canonical_code, n.title_mn, n.title_en ?? null, n.document_type, n.status, JSON.stringify(n.status_evidence ?? []),
        n.effective_status ?? null, n.capability_level, n.priority, JSON.stringify(n.teams ?? []), JSON.stringify(n.topics ?? []),
        JSON.stringify(n.building_types ?? []), JSON.stringify(n.aliases ?? []), JSON.stringify(n.supersedes ?? []),
        n.superseded_by ?? null, n.successor_draft ?? null, n.draft_of ?? null, n.approval ?? null, n.source_url ?? null,
        n.source_pdf_url ?? null, n.legal_source_url ?? null, n.source_type, n.retrieval_default ? 1 : 0, n.deep_ingestion_status,
        n.document_dir ?? null, n.local_pack ?? null, n.note ?? null, n.last_verified, n.registry_version ?? REGISTRY_INGEST_VERSION,
      );
    };
    const curatedKeys = new Set<string>();
    const aliasIndex = new Map<string, string>();
    const curatedTopics = new Map<string, string[]>();
    for (const n of norms) {
      insertNorm(n);
      curatedKeys.add(n.code_key);
      curatedTopics.set(n.code_key, [...(n.topics ?? []), ...(n.building_types ?? [])]);
      for (const a of n.aliases ?? []) {
        const k = codeKey(a);
        if (CODE_LIKE_KEY.test(k) && !aliasIndex.has(k)) aliasIndex.set(k, n.code_key);
      }
      term(n.code_key, 'code', n.canonical_code, null, 100);
      term(n.code_key, 'title', n.title_mn, null, 40);
      if (n.title_en) term(n.code_key, 'title', n.title_en, null, 30);
      for (const a of n.aliases ?? []) term(n.code_key, 'alias', a, null, /\d{2}-\d{2,3}-\d{2}/.test(a) ? 100 : 30);
      for (const t of n.teams ?? []) for (const a of tax.teams[t]?.aliases ?? []) term(n.code_key, 'team', a, t, 6);
      for (const t of n.topics ?? []) for (const a of tax.topics[t]?.aliases ?? []) term(n.code_key, 'topic', a, t, 10);
      for (const b of n.building_types ?? []) for (const a of tax.building_types?.[b] ?? []) term(n.code_key, 'building_type', a, b, 8);
    }
    if (paths.l1) {
      l1 = ingestL1(db, paths.l1, {
        curatedKeys,
        aliasIndex,
        curatedTopics: opts.curatedTopics === false ? undefined : curatedTopics,
        insertNorm: (row) => insertNorm(row as unknown as RegistryRow & { registry_version?: string }),
        addTerm: term,
      });
    }
    const insRef = db.prepare(
      'INSERT INTO ai_norm_references (from_key, from_clause, from_locator, to_key, to_document, to_in_registry, relationship, context, source_page) VALUES (?,?,?,?,?,?,?,?,?)',
    );
    for (const r of refs) {
      insRef.run(
        String(r.from_key), (r.from_clause as string | null) ?? null, (r.from_locator as string | null) ?? null, String(r.to_key), String(r.to_document),
        r.to_in_registry ? 1 : 0, String(r.relationship), (r.context as string | null) ?? null, (r.source_page as number | null) ?? null,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { norms: norms.length + (l1?.inserted_new ?? 0), terms, references: refs.length, byStatus, l1 };
}

/* ── Хайлт ──────────────────────────────────────────────────────── */

export interface RegistryMatch {
  code: string;
  code_key: string;
  title_mn: string;
  title_en: string | null;
  status: string;
  status_note_mn: string;
  effective_status: string | null;
  capability_level: string;
  deep_ingestion_status: string;
  priority: string;
  teams: string[];
  topics: string[];
  source_url: string | null;
  source_pdf_url: string | null;
  legal_source_url: string | null;
  approval: string | null;
  superseded_by: string | null;
  successor_draft: string | null;
  draft_of: string | null;
  last_verified: string;
  score: number;
  matched: { code: boolean; title: boolean; aliases: string[]; teams: string[]; topics: string[]; building_types: string[] };
}

export interface RegistryInterpretation {
  teams: string[];
  topics: string[];
  building_types: string[];
}

export interface RegistrySearch {
  query: string;
  interpretation: RegistryInterpretation;
  matches: RegistryMatch[];
  excluded_non_current: number;
  answer_mode: 'LINKS_ONLY';
}

export interface RegistrySearchOptions {
  limit?: number;
  /** DRAFT / SUPERSEDED / HISTORICAL мөрийг ч оруулах (ил хүсэлт). */
  includeNonCurrent?: boolean;
}

function stem(tok: string): string {
  return tok.length < 5 ? tok : tok.slice(0, Math.max(4, tok.length - 3));
}

/** alias (folded) нь асуултын (folded) үгсэд ЯЗГУУРААР таарах уу. */
export function aliasMatches(aliasFold: string, queryTokens: readonly string[]): boolean {
  const parts = aliasFold.split(' ').filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  return parts.every((p) => {
    const s = stem(p);
    return queryTokens.some((q) => (p.length < 5 ? q === p : q.startsWith(s)));
  });
}

function statusNote(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'MCIS-ийн хүчин төгөлдөр нормын бүртгэлд «Хүчин төгөлдөр» (сүүлд шалгасан огноог үз).';
    case 'DRAFT':
      return 'ТӨСӨЛ — батлагдаагүй; одоогийн шаардлагын эх сурвалж БИШ.';
    case 'SUPERSEDED':
      return 'Солигдсон — одоо мөрдөгдөж буй хувилбарыг үз.';
    case 'HISTORICAL':
      return 'Түүхэн баримт — одоогийн шаардлага биш.';
    case 'CANDIDATE_NEEDS_STATUS_CHECK':
      return 'Хүчин төгөлдөр эсэх нь албан бүртгэлээр ШАЛГАГДААГҮЙ — ашиглахын өмнө баталгаажуулна уу.';
    case 'STATUS_REQUIRES_VERIFICATION':
      // L1 багц (2025 оны бүртгэлийн мөр): хайж болно, ACTIVE гэж чимээгүй дээшлүүлэхгүй.
      return '2025 оны нормын бүртгэлийн жагсаалтад байсан; 2026 оны хүчин төгөлдөр байдал ШАЛГАГДААГҮЙ — ашиглахын өмнө албан бүртгэлээр баталгаажуулна уу.';
    default:
      return status;
  }
}

function rowToMatch(r: Record<string, unknown>, score: number, matched: RegistryMatch['matched']): RegistryMatch {
  const j = (v: unknown): string[] => (typeof v === 'string' ? (JSON.parse(v) as string[]) : []);
  return {
    code: String(r.canonical_code),
    code_key: String(r.code_key),
    title_mn: String(r.title_mn),
    title_en: (r.title_en as string | null) ?? null,
    status: String(r.status),
    status_note_mn: statusNote(String(r.status)),
    effective_status: (r.effective_status as string | null) ?? null,
    capability_level: String(r.capability_level),
    deep_ingestion_status: String(r.deep_ingestion_status),
    priority: String(r.priority),
    teams: j(r.teams_json),
    topics: j(r.topics_json),
    source_url: (r.source_url as string | null) ?? null,
    source_pdf_url: (r.source_pdf_url as string | null) ?? null,
    legal_source_url: (r.legal_source_url as string | null) ?? null,
    approval: (r.approval as string | null) ?? null,
    superseded_by: (r.superseded_by as string | null) ?? null,
    successor_draft: (r.successor_draft as string | null) ?? null,
    draft_of: (r.draft_of as string | null) ?? null,
    last_verified: String(r.last_verified),
    score,
    matched,
  };
}

export function registryCount(db: DatabaseSync): { norms: number; active: number; drafts: number; unresolved: number; baseline_unverified: number } | null {
  try {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS norms,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS drafts,
                SUM(CASE WHEN status = 'CANDIDATE_NEEDS_STATUS_CHECK' THEN 1 ELSE 0 END) AS unresolved,
                SUM(CASE WHEN status = 'STATUS_REQUIRES_VERIFICATION' THEN 1 ELSE 0 END) AS baseline_unverified
           FROM ai_norm_registry`,
      )
      .get() as { norms: number; active: number | null; drafts: number | null; unresolved: number | null; baseline_unverified: number | null };
    return { norms: r.norms, active: r.active ?? 0, drafts: r.drafts ?? 0, unresolved: r.unresolved ?? 0, baseline_unverified: r.baseline_unverified ?? 0 };
  } catch {
    return null; // хүснэгт байхгүй (хуучин сан, бүртгэл шингээгээгүй)
  }
}

/** Код (эсвэл кодын alias) → бүртгэлийн мөр.  Төлөвөөс ҮЛ хамаарна (нэрлэсэн баримтыг л таних). */
export function lookupRegistryCode(db: DatabaseSync, code: string): RegistryMatch | null {
  const f = foldText(code);
  if (f.length < 6) return null;
  try {
    const row = db
      .prepare(
        `SELECT r.* FROM ai_norm_registry r
          WHERE r.code_key IN (SELECT code_key FROM ai_norm_registry_terms WHERE kind IN ('code','alias') AND weight >= 100 AND term_fold = ?)
          ORDER BY CASE r.status WHEN 'ACTIVE' THEN 0 WHEN 'CANDIDATE_NEEDS_STATUS_CHECK' THEN 1 WHEN 'STATUS_REQUIRES_VERIFICATION' THEN 2 ELSE 3 END LIMIT 1`,
      )
      .get(f) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToMatch(row, 100, { code: true, title: false, aliases: [], teams: [], topics: [], building_types: [] });
  } catch {
    return null;
  }
}

/** Асуултаас баг/сэдэв/барилгын төрлийг таамаглалгүй, taxonomy-ийн alias-аар л таана. */
export function interpretQuery(db: DatabaseSync, query: string): RegistryInterpretation {
  const tokens = foldText(query).split(' ').filter((t) => t.length > 0);
  const out: RegistryInterpretation = { teams: [], topics: [], building_types: [] };
  const rows = db.prepare('SELECT DISTINCT kind, key, term_fold FROM ai_norm_registry_terms WHERE kind IN (\'team\',\'topic\',\'building_type\')').all() as Array<{ kind: string; key: string; term_fold: string }>;
  for (const r of rows) {
    if (!aliasMatches(r.term_fold, tokens)) continue;
    const list = r.kind === 'team' ? out.teams : r.kind === 'topic' ? out.topics : out.building_types;
    if (!list.includes(r.key)) list.push(r.key);
  }
  return out;
}

export function searchRegistry(db: DatabaseSync, query: string, opts: RegistrySearchOptions = {}): RegistrySearch {
  const limit = opts.limit ?? 10;
  const qf = foldText(query);
  const tokens = qf.split(' ').filter((t) => t.length > 0);
  const interpretation = interpretQuery(db, query);
  const scores = new Map<string, { score: number; matched: RegistryMatch['matched'] }>();
  const bump = (key: string, delta: number, mut: (m: RegistryMatch['matched']) => void): void => {
    const cur = scores.get(key) ?? { score: 0, matched: { code: false, title: false, aliases: [], teams: [], topics: [], building_types: [] } };
    cur.score += delta;
    mut(cur.matched);
    scores.set(key, cur);
  };
  const terms = db.prepare('SELECT code_key, kind, term, term_fold, key, weight FROM ai_norm_registry_terms').all() as Array<{ code_key: string; kind: string; term: string; term_fold: string; key: string | null; weight: number }>;
  const hay = ` ${qf} `;
  for (const t of terms) {
    if (t.kind === 'code' || (t.kind === 'alias' && t.weight >= 100)) {
      // код: явцуу тоо асуултад БҮТНЭЭРЭЭ байх ёстой («31-17-10» ⊂ «bnbd 31-17-10 …»)
      if (t.term_fold.length >= 6 && hay.includes(` ${t.term_fold} `)) bump(t.code_key, t.weight, (m) => { m.code = true; });
      continue;
    }
    if (!aliasMatches(t.term_fold, tokens)) continue;
    if (t.kind === 'title') bump(t.code_key, t.weight, (m) => { m.title = true; });
    else if (t.kind === 'alias') bump(t.code_key, t.weight, (m) => { if (!m.aliases.includes(t.term)) m.aliases.push(t.term); });
    else if (t.kind === 'team') bump(t.code_key, t.weight, (m) => { if (t.key && !m.teams.includes(t.key)) m.teams.push(t.key); });
    else if (t.kind === 'topic') bump(t.code_key, t.weight, (m) => { if (t.key && !m.topics.includes(t.key)) m.topics.push(t.key); });
    else if (t.kind === 'building_type') bump(t.code_key, t.weight, (m) => { if (t.key && !m.building_types.includes(t.key)) m.building_types.push(t.key); });
  }
  // Сэдвийн олон alias нэг сэдэвт → оноо нь СЭДВЭЭР (alias тоолохгүй), нэг сэдэв = 10, нэг баг = 6.
  const rows = db.prepare('SELECT * FROM ai_norm_registry').all() as Record<string, unknown>[];
  const byKey = new Map(rows.map((r) => [String(r.code_key), r] as const));
  const matches: RegistryMatch[] = [];
  let excluded = 0;
  for (const [key, s] of scores) {
    const r = byKey.get(key);
    if (!r) continue;
    const m = s.matched;
    const score = (m.code ? 100 : 0) + (m.title ? 40 : 0) + m.aliases.length * 8 + m.topics.length * 10 + m.teams.length * 6 + m.building_types.length * 8
      // ЗӨВХӨН баг/сэдвийн таарцтай мөрөнд өндөр барилгын гэх мэт барилгын төрлийн шүүлт нь давуу
      + (m.building_types.length > 0 && m.topics.length > 0 ? 5 : 0);
    if (score < 6) continue;
    if (NON_CURRENT.has(String(r.status)) && !opts.includeNonCurrent) {
      excluded += 1;
      continue;
    }
    matches.push(rowToMatch(r, score, m));
  }
  matches.sort((a, b) => b.score - a.score || (a.status === 'ACTIVE' ? -1 : 1) - (b.status === 'ACTIVE' ? -1 : 1) || a.code.localeCompare(b.code));
  return { query, interpretation, matches: matches.slice(0, limit), excluded_non_current: excluded, answer_mode: 'LINKS_ONLY' };
}

/** Хамаарлын граф — нэг нормоос ГАРАХ ишлэлүүд (эх сурвалжийн заалттай), дараагийн нормыг сонгоход. */
export function referencesFrom(db: DatabaseSync, codeKey: string): Array<{ to_document: string; to_key: string; to_in_registry: boolean; relationship: string; count: number; from_clauses: string[] }> {
  const rows = db
    .prepare('SELECT to_document, to_key, to_in_registry, relationship, from_clause FROM ai_norm_references WHERE from_key = ?')
    .all(codeKey) as Array<{ to_document: string; to_key: string; to_in_registry: number; relationship: string; from_clause: string | null }>;
  const agg = new Map<string, { to_document: string; to_key: string; to_in_registry: boolean; relationship: string; count: number; from_clauses: string[] }>();
  for (const r of rows) {
    const k = `${r.to_key}|${r.relationship}`;
    const cur = agg.get(k) ?? { to_document: r.to_document, to_key: r.to_key, to_in_registry: r.to_in_registry === 1, relationship: r.relationship, count: 0, from_clauses: [] };
    cur.count += 1;
    if (r.from_clause && !cur.from_clauses.includes(r.from_clause)) cur.from_clauses.push(r.from_clause);
    agg.set(k, cur);
  }
  return [...agg.values()].sort((a, b) => b.count - a.count);
}
