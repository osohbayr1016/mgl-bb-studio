/**
 * MGL AI · ЛОКАЛ МЭДЛЭГИЙН САНГИЙН ХОЛБОЛТ (§10, §11).
 *
 * ⚠️ `node:sqlite` — ГУРАВДАГЧ ПАКЕТГҮЙ.  `better-sqlite3` нь эх кодоос
 *    хөрвүүлэгддэг (node-gyp, MSVC) бөгөөд ажилтны 40 машин дээр Visual
 *    Studio Build Tools шаардана.  Node 22.6+-ийн шигтгээст SQLite нь
 *    FTS5-тай ирдэг (хэмжсэн 2026-09-08) тул суулгац нь ЗӨВХӨН Node.
 *
 * ⚠️ VEC0 МОДУЛЬ ЭНЭ BUILD-Д БАЙХГҮЙ (хэмжсэн).  Тиймээс вектор индекс нь
 *    `vector.ts`-ийн интерфейсийн ард — sqlite-vec суусан машин дээр
 *    адаптер солигдоно, суугаагүй дээр FTS5 ГАНЦААРАА ажиллана.  §12:
 *    «SQLite metadata + FTS5 should remain usable even if embeddings are
 *    replaced.»  Тиймээс энэ нь доройтол, УНАЛТ БИШ.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `ai/knowledge/schema.sql` — бүтцийн ЦОРЫН ГАНЦ эх сурвалж. */
export const SCHEMA_PATH = join(HERE, '..', '..', 'knowledge', 'schema.sql');

/**
 * ⚠️ СХЕМИЙН ХУВИЛБАР — багана нэмэх/солих бүрд ӨСГӨНӨ.
 *
 * 1 → анхны (БНбД 21-04-05): дүрэм нь `guat_json` + `gmdh_json`
 * 2 → УББ 12-01-01: `conditions_json` (нэрлэсэн жагсаалт) + `rule_kind`
 *     + `actor` + `clause_no` + `source_pdf_page`
 * 3 → УББ 12-204-01: `ai_aliases.doc_id` — alias-ыг баримтаар нь цэвэрлэх
 *     (чөлөөт канонтой alias өмнө нь хэзээ ч устдаггүй байв)
 */
export const SCHEMA_VERSION = 3;

export interface KnowledgeDbOptions {
  /** Файлын зам, эсвэл `:memory:` (тест). */
  path: string;
  readOnly?: boolean;
}

/**
 * Мэдлэгийн санг нээж, бүтцийг ХЭРЭГЛЭНЭ (идемпотент).
 *
 * ⚠️ `CREATE TABLE IF NOT EXISTS` тул дахин дуудахад өгөгдөл АРИЛАХГҮЙ.
 *    Шинэ багана нэмэх нь тусдаа миграц шаардана — энэ функц түүнийг
 *    хийхгүй, чимээгүй ХИЙХГҮЙ БАЙХ нь чимээгүй ГЭМТЭЭХЭЭС дээр.
 */
/**
 * ⚠️ ХУУЧИН СХЕМИЙГ ЦЭВЭРЛЭНЭ, ЗАСАХГҮЙ.
 *
 * Энэ сан нь 100% ДЕРИВАТИВ — агуулга бүр нь багцын хавтаснаас дахин
 * үүсгэгдэнэ.  Тиймээс `ALTER TABLE`-ийн гинж барих нь дэмий: цэвэрлээд
 * дахин шингээх нь хямд, эргэлзээгүй, мөн хуучин багана үлдээхгүй.
 *
 * ⚠️ ГЭВЧ ЧИМЭЭГҮЙ БИШ.  Дахин барих нь шингээсэн БҮХ багцыг устгана —
 * ажилтан тэднийг дахин шингээх ёстой.  `rebuilt` тугийг дуудагч заавал
 * хэрэглэгчид харуулна, эс тэгвэл «миний норм алга болжээ» гэсэн
 * ойлгомжгүй байдал үүснэ.
 */
/**
 * Сангийн ДЭД БҮТЦИЙН алдаа (хүснэгт алга — дахин шингээлт явж байна, түгжигдсэн,
 * гэмтсэн файл) vs асуултын СИНТАКСИЙН алдаа (FTS5 MATCH).  Эхнийхийг «олдсонгүй» гэж
 * залгих нь P0-14-ийн зөрчил — runtime 503 өгөх ёстой.
 */
export function isKnowledgeInfrastructureError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no such table|database is locked|SQLITE_BUSY|malformed|disk I\/O|unable to open|database disk image|readonly database|not a database/i.test(msg);
}

export class KnowledgeUnavailableError extends Error {
  readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'KnowledgeUnavailableError';
    this.cause = cause;
  }
}

/** Санд бичигдсэн схемийн хувилбар (`ai_schema_meta`), байхгүй бол null. */
export function knowledgeSchemaVersion(db: DatabaseSync): number | null {
  return currentVersion(db);
}

function currentVersion(db: DatabaseSync): number | null {
  try {
    const row = db.prepare('SELECT version FROM ai_schema_meta WHERE id = 1').get() as
      | { version: number }
      | undefined;
    return row?.version ?? null;
  } catch {
    // Хүснэгт байхгүй = хувилбар 1 (эсвэл огт хоосон сан).
    return null;
  }
}

const DERIVED_TABLES = [
  // L2 заалтын тайлбар (ai/norm-dataset/documents/<Doc>/l2) — багцын файлаас дахин үүснэ
  'ai_norm_explanations',
  // L2 хүснэгт/томьёо/холбоос (2026-09-23) — мөн l2/-оос дахин үүснэ
  'ai_norm_explanation_objects',
  // L1 сэдвийн чиглүүлэгч + 2025 оны бүртгэлийн суурь (ai/norm-dataset/router, registry/cdc-2025)
  'ai_norm_building_overlays',
  'ai_norm_topic_assignments',
  'ai_norm_topic_aliases',
  'ai_norm_topics',
  'ai_norm_registry_l1',
  // L0 бүртгэл (ai/norm-dataset) — git-ийн файлаас дахин үүснэ
  'ai_norm_references',
  'ai_norm_registry_terms',
  'ai_norm_registry',
  'ai_chunks_fts',
  'ai_chunk_vectors',
  'ai_calculation_cases',
  'ai_query_tests',
  'ai_aliases',
  'ai_rules',
  'ai_chunks',
  'ai_documents',
  'ai_ingest_log',
];

export interface OpenResult {
  db: DatabaseSync;
  /** Схем хуучирсан тул сан ЦЭВЭРЛЭГДСЭН — бүх багцыг дахин шингээнэ. */
  rebuilt: boolean;
}

export function openKnowledgeDbEx(opts: KnowledgeDbOptions): OpenResult {
  if (opts.path !== ':memory:') mkdirSync(dirname(opts.path), { recursive: true });

  const db = new DatabaseSync(opts.path, { readOnly: opts.readOnly === true });
  if (opts.readOnly === true) return { db, rebuilt: false };

  const existing = currentVersion(db);
  // ⚠️ Огт хоосон сан (хүснэгтгүй) нь «хуучин» БИШ — шинэ.  Ялгахгүй бол
  //    анхны ажиллуулалт бүр «дахин барив» гэж хуурамч анхааруулна.
  const hasTables =
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='ai_chunks'")
        .get() as { n: number }
    ).n > 0;

  let rebuilt = false;
  if (hasTables && existing !== SCHEMA_VERSION) {
    for (const t of DERIVED_TABLES) db.exec(`DROP TABLE IF EXISTS ${t}`);
    rebuilt = true;
  }

  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  db.exec(
    `CREATE TABLE IF NOT EXISTS ai_schema_meta (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL)`,
  );
  db.prepare('INSERT OR REPLACE INTO ai_schema_meta (id, version) VALUES (1, ?)').run(SCHEMA_VERSION);

  return { db, rebuilt };
}

/** Богино хэлбэр — дахин барилтын тугийг сонирхохгүй дуудагчид. */
export function openKnowledgeDb(opts: KnowledgeDbOptions): DatabaseSync {
  return openKnowledgeDbEx(opts).db;
}

/** Ажилтны PC дээрх өгөгдмөл байршил — `config.ts`-ийн `knowledgeDb`-тэй хос. */
export function defaultKnowledgePath(dataDir: string): string {
  return join(dataDir, 'knowledge', 'knowledge.sqlite');
}
