/**
 * MGL AI · МЭДЛЭГИЙН САНГИЙН КАТАЛОГ — «чамд ямар норм байгаа вэ», «БНбД X юуны тухай вэ».
 *
 * ⚠️ ЯАГААД ЭНЭ МОДУЛЬ ОРШИН БАЙНА (2026-09-18, хэмжсэн).  «Чамд ямар норм дүрмүүд
 *    байгаа вэ?» гэсэн асуулт `/norm`-ын BM25 хайлтад орж, агуулгын токен таарахгүй
 *    тул `insufficient_evidence` буцааж, загвар prompt-ынхаа сүүлийн мөрийг
 *    («Идэвхгүй хэлбэрээс идэвхтэйг илүүд үз.») цуурайтуулж байв.  Асуулт нь
 *    ЗААЛТЫН асуулт БИШ — САНГИЙН ЖАГСААЛТЫН асуулт; хариу нь `ai_documents`-д
 *    аль хэдийн байгаа, хайх зүйл алга.  Мөн «УББ 12-01-01 юуны тухай вэ?» гэхэд
 *    BM25 санамсаргүй 5 заалт буцаадаг байсан — баримтын БҮТЭЦ (бүлэг, заалтын
 *    муж, хүснэгт, хавсралт) нь `section_path`-д байгаа, түүнийг л өгнө.
 *
 * ⚠️ ДЕТЕРМИНИСТ, ЗАГВАРГҮЙ.  Ижил санд ижил хариу.  Заалтын АГУУЛГА эндээс
 *    ХЭЗЭЭ Ч гарахгүй — зөвхөн код · нэр · төлөв · тоо · бүлгийн гарчиг.
 *    Техникийн шаардлага асуувал `/norm` (pipeline.ts) хэвээр.
 *
 * ⚠️ `registry.ts`-ээс ЗОРИУД импортлодоггүй (тэр нь L1 сэдвийн чиглүүлэгчтэй
 *    холбогддог) — бүртгэлийн тоог `ai_norm_registry`-ээс шууд, хүснэгт байхгүй
 *    хуучин санд `null`.
 */
import type { DatabaseSync } from 'node:sqlite';
import { foldText } from './fold.ts';

export const CATALOG_VERSION = 'norm-catalog/1';

/** Хэсгийн `kind`-ийн бүлэглэл — UI/prompt-д «заалт 44 · хүснэгтийн мөр 33» гэж тоолоход. */
const CLAUSE_KINDS = new Set(['clause', 'normative_clause', 'canonical_clause', 'canonical_rule', 'requirement', 'duty_rule', 'right_rule', 'liability_rule', 'prohibition', 'numeric_rule', 'qualification_rule', 'appointment_rule', 'organization_rule', 'qualification_knowledge']);
const TABLE_KINDS = new Set(['table', 'table_row', 'table_rule', 'structured_table', 'reference_table', 'appendix_row', 'classification_rule', 'building_classification_rule']);
/** Бүтцийн тоймд ОРОХГҮЙ хэсгүүд — баримтын мета (хууль зүйн төлөв, эх сурвалжийн бүрэн бүтэн байдал, индекс). */
const DROP_KINDS = new Set(['metadata', 'meta', 'legal_status', 'current_status', 'source_integrity', 'source_gap', 'source_gate', 'source_locator_gate', 'section_index', 'appendix_index']);

/** Баримтын албан эх сурвалжийн URL — метадатагийн аль нэг талбараас, зохиохгүй. */
const SOURCE_URL_KEYS = ['authoritative_current_text_url', 'current_text_url', 'technical_pdf_url', 'source_url', 'source_inventory_url', 'official_url', 'url'] as const;

export interface CatalogDocument {
  doc_id: string;
  code: string;
  title_mn: string;
  title_en: string | null;
  effective_status: string;
  pages: number;
  authority: string | null;
  order_date: string | null;
  order_number: string | null;
  effective_from: string | null;
  source_url: string | null;
  chunks: number;
  clauses: number;
  table_rows: number;
  rules: number;
  ingested_at: string;
}

export interface CatalogSection {
  path: string;
  /** Хэсгийн тоо (заалт/мөр/хүснэгт бүгд). */
  n: number;
  clause_from: string | null;
  clause_to: string | null;
  kind: 'clauses' | 'tables' | 'mixed' | 'other';
}

export interface CatalogCounts {
  documents: number;
  chunks: number;
  rules: number;
  aliases: number;
}

export interface RegistryCounts {
  norms: number;
  active: number;
  candidate: number;
  draft: number;
}

export interface NormCatalogInventory {
  version: typeof CATALOG_VERSION;
  kind: 'inventory';
  documents: CatalogDocument[];
  counts: CatalogCounts;
  /** L0 бүртгэл (ai/norm-dataset) — шингээгээгүй санд null. */
  registry: RegistryCounts | null;
}

export interface NormCatalogDocument {
  version: typeof CATALOG_VERSION;
  kind: 'document';
  document: CatalogDocument;
  sections: CatalogSection[];
  /** `sections` тайрагдсан бол нийт бүлгийн тоо. */
  sections_total: number;
  /** Хавсралтын нэрс (section_path-аас) — жагсаалтаас тусад нь. */
  appendices: string[];
  /** Хүснэгтийн нэрс — жагсаалтаас тусад нь. */
  tables: string[];
}

export interface NormCatalogNotFound {
  version: typeof CATALOG_VERSION;
  kind: 'not_found';
  code: string;
  /** Бүртгэлд байвал: код · нэр · төлөв (гүн шингээгээгүй гэдэг нь ил). */
  registry: { code: string; title_mn: string; status: string; source_url: string | null } | null;
}

export type NormCatalog = NormCatalogInventory | NormCatalogDocument | NormCatalogNotFound;

function parseMeta(raw: string): Record<string, unknown> {
  try {
    const o: unknown = JSON.parse(raw);
    return typeof o === 'object' && o !== null ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function httpsOf(m: Record<string, unknown>): string | null {
  for (const k of SOURCE_URL_KEYS) {
    const v = m[k];
    if (typeof v === 'string' && /^https:\/\/\S{1,300}$/.test(v)) return v;
  }
  return null;
}

function strOf(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null;
}

interface DocRow {
  doc_id: string;
  code: string;
  title_mn: string;
  authority: string | null;
  order_date: string | null;
  order_number: string | null;
  effective_status: string;
  pages: number;
  metadata_json: string;
  ingested_at: string;
}

const DOC_SQL = `SELECT doc_id, code, title_mn, authority, order_date, order_number, effective_status, pages, metadata_json, ingested_at FROM ai_documents`;

function toDocument(db: DatabaseSync, r: DocRow): CatalogDocument {
  const m = parseMeta(r.metadata_json);
  const c = db
    .prepare(
      `SELECT COUNT(*) AS chunks,
              SUM(CASE WHEN kind IN (${[...CLAUSE_KINDS].map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS clauses,
              SUM(CASE WHEN kind IN (${[...TABLE_KINDS].map(() => '?').join(',')}) THEN 1 ELSE 0 END) AS table_rows
         FROM ai_chunks WHERE doc_id = ?`,
    )
    .get(...CLAUSE_KINDS, ...TABLE_KINDS, r.doc_id) as { chunks: number; clauses: number | null; table_rows: number | null };
  const rules = (db.prepare('SELECT COUNT(*) AS n FROM ai_rules WHERE doc_id = ?').get(r.doc_id) as { n: number }).n;
  return {
    doc_id: r.doc_id,
    // ⚠️ БНбД 31-23-12 багц `code`-гүй, `current_code`-той (CLAUDE.md) — `ai_documents.code`
    //    аль хэдийн шийдсэн; метадатагийн нэрийг ДАВУУ тавихгүй.
    code: r.code,
    title_mn: r.title_mn,
    title_en: strOf(m.title_en) ?? strOf(m.title_en_normalized),
    effective_status: r.effective_status,
    pages: r.pages,
    authority: r.authority ?? strOf(m.approved_by) ?? strOf(m.authority),
    order_date: r.order_date ?? strOf(m.approval_order_date, 10),
    order_number: r.order_number ?? strOf(m.approval_order_number, 20),
    effective_from: strOf(m.effective_from, 10),
    source_url: httpsOf(m),
    chunks: c.chunks,
    clauses: c.clauses ?? 0,
    table_rows: c.table_rows ?? 0,
    rules,
    ingested_at: r.ingested_at,
  };
}

function registryCounts(db: DatabaseSync): RegistryCounts | null {
  try {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS norms,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
                SUM(CASE WHEN status = 'CANDIDATE_NEEDS_STATUS_CHECK' THEN 1 ELSE 0 END) AS candidate,
                SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft
           FROM ai_norm_registry`,
      )
      .get() as { norms: number; active: number | null; candidate: number | null; draft: number | null };
    if (r.norms === 0) return null;
    return { norms: r.norms, active: r.active ?? 0, candidate: r.candidate ?? 0, draft: r.draft ?? 0 };
  } catch {
    return null; // хүснэгт байхгүй — бүртгэл шингээгээгүй хуучин сан
  }
}

/** Санд байгаа БҮХ баримт — код, нэр, төлөв, тоо.  Заалтын агуулга ОРОХГҮЙ. */
export function catalogInventory(db: DatabaseSync): NormCatalogInventory {
  const rows = db.prepare(`${DOC_SQL} ORDER BY code`).all() as unknown as DocRow[];
  const documents = rows.map((r) => toDocument(db, r));
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM ai_documents) AS documents,
              (SELECT COUNT(*) FROM ai_chunks) AS chunks,
              (SELECT COUNT(*) FROM ai_rules) AS rules,
              (SELECT COUNT(*) FROM ai_aliases) AS aliases`,
    )
    .get() as unknown as CatalogCounts;
  return { version: CATALOG_VERSION, kind: 'inventory', documents, counts, registry: registryCounts(db) };
}

/**
 * Код → санд байгаа баримт.  `ai_documents.code`-ыг фолдоор бүтнээр, эсвэл кодын alias-аар
 * (`namedDocuments`-ийн ижил дүрэм — ≥ 6 тэмдэгт, үгийн хилээр) таана.  Олон таарвал
 * (нэг кодын хоёр хувилбар) хамгийн сүүлд шингээсэн нь.
 */
export function resolveCatalogDocument(db: DatabaseSync, code: string): DocRow | null {
  // «БНбД31-17-10» → «БНбД 31-17-10» (үсэг-тооны заагт зай) — фолд нь үгээр тулгадаг.
  const want = foldText(code.replace(/(\p{L})(\d)/u, '$1 $2'));
  if (want.length < 6) return null;
  const rows = db.prepare(`${DOC_SQL} ORDER BY ingested_at DESC`).all() as unknown as DocRow[];
  const hay = ` ${want} `;
  for (const r of rows) {
    const f = foldText(r.code);
    if (f.length >= 6 && (f === want || hay.includes(` ${f} `))) return r;
  }
  for (const r of rows) {
    const aliases = db
      .prepare('SELECT alias_fold FROM ai_aliases WHERE doc_id = ? AND canonical = ? AND length(alias_fold) >= 6')
      .all(r.doc_id, r.code) as Array<{ alias_fold: string }>;
    if (aliases.some((a) => a.alias_fold === want || hay.includes(` ${a.alias_fold} `))) return r;
    // Хуучин код (`legacy_code`) — БНбД 31-04-12 → 31-23-12.
    const m = parseMeta(r.metadata_json);
    const legacy = [m.legacy_code, m.former_code, m.old_code].filter((x): x is string => typeof x === 'string');
    if (legacy.some((c) => foldText(c) === want)) return r;
  }
  return null;
}

const MAX_SECTIONS = 48;
const CLAUSE_NO_RE = /^\d+(?:\.\d+)*$/;

/** «1.9» < «1.12» — заалтын дугаарыг ТООГООР эрэмбэлнэ (текстээр «1.12» < «1.9» болно). */
function clauseKey(no: string): number[] {
  return no.split('.').map((p) => Number(p));
}
function cmpClause(a: string, b: string): number {
  const ka = clauseKey(a);
  const kb = clauseKey(b);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    const d = (ka[i] ?? -1) - (kb[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

function isAppendixPath(p: string): boolean {
  // ⚠️ ASCII `\b` кирилл үсгийн хажууд ҮҮСДЭГГҮЙ (CLAUDE.md-ийн урхи) — `(?!\p{L})`.
  return /^(хавсралт|appendix|приложение)(?!\p{L})/iu.test(p);
}
function isTablePath(p: string): boolean {
  // «6.2.3, Хүснэгт 6.1 / Хүснэгт» — заалтын дугаарын АРД таслалтай ирдэг (БНбД 31-23-12), эхэнд биш.
  // «Хүснэгт 6.1» · «Хүснэгт №1» · «4-р хүснэгт» (СНиП) — гурван хэлбэр.
  return /(^|[/,]\s*)(\d+\s*-?\s*р\s+хүснэгт|(?:хүснэгт|table|таблица)\s*[\d№])/iu.test(p) || /\/\s*хүснэгт\s*$/iu.test(p);
}

/** Нэг баримтын бүтэц — бүлэг тус бүрийн заалтын муж, хүснэгт, хавсралт.  Агуулга ОРОХГҮЙ. */
export function catalogDocument(db: DatabaseSync, code: string): NormCatalogDocument | NormCatalogNotFound {
  const row = resolveCatalogDocument(db, code);
  if (row === null) {
    let registry: NormCatalogNotFound['registry'] = null;
    try {
      const f = foldText(code);
      const r = db
        .prepare(
          `SELECT r.canonical_code AS code, r.title_mn, r.status, r.source_url FROM ai_norm_registry r
            WHERE r.code_key IN (SELECT code_key FROM ai_norm_registry_terms WHERE kind IN ('code','alias') AND term_fold = ?) LIMIT 1`,
        )
        .get(f) as { code: string; title_mn: string; status: string; source_url: string | null } | undefined;
      if (r) registry = { code: r.code, title_mn: r.title_mn, status: r.status, source_url: r.source_url && /^https:\/\//.test(r.source_url) ? r.source_url : null };
    } catch {
      registry = null;
    }
    return { version: CATALOG_VERSION, kind: 'not_found', code: code.trim().slice(0, 64), registry };
  }
  const document = toDocument(db, row);
  const chunks = db
    .prepare('SELECT section_path, kind, clause_no FROM ai_chunks WHERE doc_id = ? ORDER BY rowid')
    .all(row.doc_id) as Array<{ section_path: string | null; kind: string; clause_no: string | null }>;

  const order: string[] = [];
  const acc = new Map<string, { n: number; clauses: string[]; kinds: Set<string> }>();
  const appendices = new Set<string>();
  // Хүснэгт: шошго → гарчиг («Хүснэгт 6.1» толгойн хэсэг ба «… / гарчиг» мөрүүд НЭГ хүснэгт).
  const tables = new Map<string, string | null>();
  for (const c of chunks) {
    const path = (c.section_path ?? '').trim();
    if (path.length === 0) continue;
    // ⚠️ Зөвхөн « / » (зайтай) заагч — гарчиг дотор «гарц/шат» гэсэн зайгүй ташуу байдаг.
    const parts0 = path.split(' / ').map((p) => p.trim());
    let head = parts0[0]!;
    if (isAppendixPath(head)) {
      // «Хавсралт, мөр 12» (СНиП-ийн appendix_row) → «Хавсралт»; нэр нь мөрийн дугааргүй.
      appendices.add(head.replace(/,\s*(мөр|row)\s*\d+.*$/iu, '').trim());
      if (c.kind === 'appendix_row') continue; // хавсралтын мөр бүр тусдаа бүлэг биш
      // Баримт БҮХЭЛДЭЭ хавсралт (БНбД 21-04-05 = Хавсралт №14) — дэд хэсгүүд нь бүлэг.
      if (parts0.length > 1 && !isTablePath(path)) head = `${head} / ${parts0[1]!}`;
    }
    if (DROP_KINDS.has(c.kind) && !isAppendixPath(head)) continue;
    if (isTablePath(path)) {
      // «6.2.3, Хүснэгт 6.1 / Гарчиг» → «Хүснэгт 6.1 — Гарчиг»
      const parts = path.split(' / ').map((p) => p.trim());
      const t = parts.find((p) => /хүснэгт|table|таблица/iu.test(p)) ?? parts[0]!;
      const title = parts.length > 1 && !/^хүснэгт\s*$/iu.test(parts[parts.length - 1]!) ? parts[parts.length - 1]! : null;
      const label = t.replace(/^[\d.]+,\s*/, '');
      if (!tables.has(label) || (title && title !== label && tables.get(label) === null)) tables.set(label, title && title !== label ? title : null);
      continue;
    }
    if (isAppendixPath(head) && !head.includes(' / ') && head !== path) continue; // хавсралтын индексийн мөр — нэрийг л авна
    if (!acc.has(head)) {
      acc.set(head, { n: 0, clauses: [], kinds: new Set() });
      order.push(head);
    }
    const a = acc.get(head)!;
    a.n += 1;
    a.kinds.add(c.kind);
    if (c.clause_no && CLAUSE_NO_RE.test(c.clause_no)) a.clauses.push(c.clause_no);
  }
  const sections: CatalogSection[] = order.map((path) => {
    const a = acc.get(path)!;
    const sorted = [...new Set(a.clauses)].sort(cmpClause);
    const kinds = [...a.kinds];
    const kind: CatalogSection['kind'] = kinds.every((k) => CLAUSE_KINDS.has(k))
      ? 'clauses'
      : kinds.every((k) => TABLE_KINDS.has(k))
        ? 'tables'
        : kinds.some((k) => CLAUSE_KINDS.has(k) || TABLE_KINDS.has(k))
          ? 'mixed'
          : 'other';
    return { path, n: a.n, clause_from: sorted[0] ?? null, clause_to: sorted[sorted.length - 1] ?? null, kind };
  });
  return {
    version: CATALOG_VERSION,
    kind: 'document',
    document,
    sections: sections.slice(0, MAX_SECTIONS),
    sections_total: sections.length,
    appendices: [...appendices].slice(0, 24),
    tables: [...tables].map(([label, title]) => (title ? `${label} — ${title}` : label)).slice(0, 24),
  };
}

/** `/norm/catalog` — `code` байхгүй бол жагсаалт, байвал тэр баримтын бүтэц. */
export function normCatalog(db: DatabaseSync, code: string | null | undefined): NormCatalog {
  const c = typeof code === 'string' ? code.trim() : '';
  return c.length === 0 ? catalogInventory(db) : catalogDocument(db, c);
}
