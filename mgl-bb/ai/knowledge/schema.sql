-- =============================================================
-- MGL AI · ЛОКАЛ МЭДЛЭГИЙН САН (§10, §11)
-- =============================================================
-- ⚠️ ЭНЭ НЬ D1 БИШ, ЗОРИУД.  §11: «Do NOT make Cloudflare D1 the primary
--    high-frequency local RAG/vector database.»  Энэ файл нь ажилтны PC
--    дээрх SQLite-ийн бүтэц: FTS5 + бүтэцтэй дүрмийн хүснэгт + солигдох
--    вектор индекс.  D1 нь ЭРХИЙН ба АМЬД компанийн өгөгдлийн үнэн хэвээр.
--
-- ⚠️ ЭНД ЯМАР Ч КОМПАНИЙН НУУЦ БАЙХГҮЙ БАЙХ ЁСГҮЙ ГЭСЭН ҮГ БИШ — харин
--    мөр бүр `visibility` ба `authority_level`-ээ ӨӨРӨӨ үүрнэ.  Захиалагчийн
--    горимд `visibility = 'public_norm'` мөрийг Л уншина (§6): шүүлт нь
--    prompt угсрахаас ӨМНӨ, SQL-ийн түвшинд.
--
-- ⚠️ EMBEDDING БАГАНА ЭНД БАЙХГҮЙ.  §12: embedding загвар нь СОЛИГДОНО.
--    Вектор нь `ai_chunk_vectors`-д тусад нь амьдарна, `embedding_model`
--    багана нь аль загвараар тооцсоныг үүрнэ — загвар солиход тэр хүснэгтийг
--    Л хоослоно, `ai_chunks` ХӨНДӨГДӨХГҮЙ.  Тиймээс FTS5 нь embedding
--    байхгүй ч БҮРЭН ажиллана (§12-ийн шаардлага).
--
-- ⚠️ `verification_status` НЬ ГҮЙЦЭТГЭЛИЙН ХААЛГА, шошго биш.
--    `needs_human_review` мөр нь ХАЙГДАНА (ажилтан үзэж болно) ч
--    `evaluateRule` нь түүнийг ЭРХ БҮХИЙ хариу болгон ГҮЙЦЭТГЭХГҮЙ.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_documents (
  doc_id           TEXT PRIMARY KEY,
  code             TEXT NOT NULL,
  title_mn         TEXT NOT NULL,
  jurisdiction     TEXT NOT NULL DEFAULT 'Mongolia',
  authority        TEXT,
  order_date       TEXT,
  order_number     TEXT,
  version          TEXT,
  -- ⚠️ `unknown_requires_legal_verification` нь бодит төлөв.  Хуучирсан
  --    норм дээр «баталгаажсан» гэж хариулах нь мэргэжлийн эрсдэл тул
  --    `citation.ts` үүнийг эшлэл бүрд дагуулна.
  effective_status TEXT NOT NULL,
  source_file      TEXT NOT NULL,
  source_sha256    TEXT NOT NULL,
  pages            INTEGER NOT NULL DEFAULT 0,
  training_policy  TEXT,
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  ingested_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_chunks (
  chunk_id            TEXT PRIMARY KEY,
  doc_id              TEXT NOT NULL REFERENCES ai_documents(doc_id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  -- ⚠️ ХЭВЛЭМЭЛ хуудас — эшлэлд ЭНЭ гарна.
  page                INTEGER,
  -- ⚠️ PDF-ийн хуудас — ЗӨВХӨН мөрдөн шалгахад.  УББ 12-01-01-ийн PDF нь
  --    товхимол хэлбэрээр (booklet) сканердсан тул хэвлэмэл 9-р хуудас нь
  --    PDF-ийн 5-р хуудсанд байдаг.  Хоёрыг хольвол эшлэл нь хүнийг
  --    БУРУУ хуудас руу илгээнэ.
  source_pdf_page     INTEGER,
  table_no            INTEGER,
  row_no              TEXT,
  clause_no           TEXT,
  section_path        TEXT,
  text_mn             TEXT NOT NULL,
  text_latin          TEXT,
  search_text         TEXT NOT NULL,
  authority_level     TEXT NOT NULL DEFAULT 'normative',
  visibility          TEXT NOT NULL DEFAULT 'public_norm',
  verification_status TEXT NOT NULL,
  retrieval_weight    REAL NOT NULL DEFAULT 1.0,
  metadata_json       TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc_page  ON ai_chunks(doc_id, page);
CREATE INDEX IF NOT EXISTS idx_chunks_verify    ON ai_chunks(verification_status);
CREATE INDEX IF NOT EXISTS idx_chunks_visible   ON ai_chunks(visibility);
CREATE INDEX IF NOT EXISTS idx_chunks_table_row ON ai_chunks(table_no, row_no);

-- ⚠️ `unicode61` нь кирилл үсгийг ҮГЭЭР зөв тасалдаг ба том/жижиг үсгийг
--    эвхдэг.  `porter` нь АНГЛИД зориулагдсан — монголд хэрэглэвэл үндсийг
--    буруу тайрна.  Токенизаторыг солих нь индексийг ДАХИН БАРИХ шаардана.
CREATE VIRTUAL TABLE IF NOT EXISTS ai_chunks_fts USING fts5(
  chunk_id UNINDEXED,
  text_mn,
  text_latin,
  search_text,
  tokenize = 'unicode61'
);

-- ⚠️ НӨХЦӨЛ НЬ НЭРЛЭСЭН ЖАГСААЛТ, ХАТУУ ХОЁР БАГАНА БИШ.
--    Анхны хувилбар нь `guat_json` + `gmdh_json` гэсэн хоёр багантай байсан —
--    тэр нь БНбД 21-04-05 (гал унтраах) баримтын хэлбэр.  УББ 12-01-01
--    (захиалагчийн дүрэм) ирэхэд таараагүй: түүний босго нь «бие даасан алба
--    заавал байгуулна» гэсэн ГАНЦ нэрлэсэн үр дагавартай, гуравдахь баримт
--    дахин өөр байх нь тодорхой.  Баримт бүрд шинэ багана нэмэх нь схемийг
--    хязгааргүй өсгөх ба хөдөлгүүрийг баримт тус бүрд салгана.
--    `conditions_json` нь `[{key, cond}]` — гал нь ['GUAT','GMDH'], УББ нь
--    ['independent_client_office_mandatory'].  ГАНЦ хөдөлгүүр бүгдийг үнэлнэ.
--
-- ⚠️ ХООСОН `conditions_json` НЬ ХҮЧИНТЭЙ.  Үүрэг, эрх, хариуцлагын заалтад
--    тоон босго БАЙХГҮЙ — тэд эшлэх, уншуулах зориулалттай.  Тэднийг
--    «дутуу дүрэм» гэж үзэх нь зөв хариуг эргэлзээтэй болгоно.
CREATE TABLE IF NOT EXISTS ai_rules (
  rule_id              TEXT PRIMARY KEY,
  chunk_id             TEXT NOT NULL REFERENCES ai_chunks(chunk_id) ON DELETE CASCADE,
  doc_id               TEXT NOT NULL REFERENCES ai_documents(doc_id) ON DELETE CASCADE,
  -- table_row | threshold | deadline | obligation | right | responsibility
  rule_kind            TEXT NOT NULL DEFAULT 'table_row',
  table_no             INTEGER,
  row_no               TEXT,
  clause_no            TEXT,
  page                 INTEGER,
  section              TEXT,
  object_mn            TEXT NOT NULL,
  object_latin         TEXT,
  -- ⚠️ ХЭН үүрэг хүлээх вэ.  УББ-д «захиалагч» vs «гүйцэтгэгч» нь гол
  --    ялгуур — түүнийг алдвал гүйцэтгэгчийн үүргийг захиалагчийнх гэж
  --    хариулна.  БНбД-д NULL (тэнд субъект биш, объект нь чухал).
  actor                TEXT,
  required_context_json TEXT NOT NULL DEFAULT '[]',
  conditions_json      TEXT NOT NULL DEFAULT '[]',
  aliases_mn_json      TEXT NOT NULL DEFAULT '[]',
  aliases_latin_json   TEXT NOT NULL DEFAULT '[]',
  aliases_en_json      TEXT NOT NULL DEFAULT '[]',
  decision_policy      TEXT NOT NULL,
  citation_required    INTEGER NOT NULL DEFAULT 1,
  verification_status  TEXT NOT NULL,
  notes_json           TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_rules_kind ON ai_rules(rule_kind);
CREATE INDEX IF NOT EXISTS idx_rules_clause ON ai_rules(doc_id, clause_no);

CREATE INDEX IF NOT EXISTS idx_rules_doc       ON ai_rules(doc_id);
CREATE INDEX IF NOT EXISTS idx_rules_table_row ON ai_rules(table_no, row_no);
CREATE INDEX IF NOT EXISTS idx_rules_verify    ON ai_rules(verification_status);

-- ⚠️ Alias нь ХАЙЛТЫГ өргөтгөнө, ХУУЛИЙН УТГЫГ ӨӨРЧЛӨХГҮЙ.  «sprinkler»
--    гэж хайхад ГУАТ-ын мөр олдоно — гэвч хариултын текст нь эх сурвалжийн
--    үг хэллэгээр гарна, alias-аар ОРЛУУЛАГДАХГҮЙ.
-- ⚠️ `doc_id` НЬ ЦЭВЭРЛЭЛТИЙН ТҮЛХҮҮР (схем 3, 2026-09-10).  Өмнө нь alias-ыг
--    зөвхөн `canonical`-аар нь (дүрмийн id эсвэл baримтын id-ийн угтвар)
--    цэвэрлэдэг байсан тул чөлөөт канонтой бүлэг («барилгын зураг төсөл» →
--    «БНбД») нэг удаа орсон бол ХЭЗЭЭ Ч устдаггүй байв — багц зассан ч
--    хуучин alias хайлтыг гажуудуулсаар (хэмжсэн: УББ 12-204-01).
CREATE TABLE IF NOT EXISTS ai_aliases (
  doc_id    TEXT NOT NULL DEFAULT '',
  canonical TEXT NOT NULL,
  language  TEXT NOT NULL,
  alias     TEXT NOT NULL,
  alias_fold TEXT NOT NULL,
  weight    REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (doc_id, canonical, language, alias)
);

CREATE INDEX IF NOT EXISTS idx_aliases_doc ON ai_aliases(doc_id);

CREATE INDEX IF NOT EXISTS idx_aliases_fold ON ai_aliases(alias_fold);

-- Алтан тестүүд — «сургалт ажиллав уу» гэдгийг ХЭМЖИХ цорын ганц эх сурвалж.
-- ⚠️ ХҮЛЭЭГДЭХ ЗҮЙЛ НЬ БАРИМТААС ХАМААРНА.  БНбД багц нь ДҮРМИЙН id-г
--    (`expected_rule_id`), УББ багц нь ХЭСГИЙН id-г (`expected_id`) нэрлэдэг.
--    Нэгийг нөгөө рүү шахах нь мэдээлэл алдагдуулна — хоёуланг нь хадгална.
CREATE TABLE IF NOT EXISTS ai_query_tests (
  test_id       TEXT PRIMARY KEY,
  doc_id        TEXT,
  query         TEXT NOT NULL,
  language      TEXT NOT NULL,
  expected_rule_id  TEXT,
  expected_chunk_id TEXT,
  expected_page INTEGER,
  expected_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS ai_calculation_cases (
  case_id          TEXT PRIMARY KEY,
  doc_id           TEXT,
  query_mn         TEXT NOT NULL,
  query_latin      TEXT,
  query_en         TEXT,
  context_json     TEXT NOT NULL DEFAULT '{}',
  expected_rule_id TEXT,
  expected_json    TEXT NOT NULL DEFAULT '{}',
  must_cite_source INTEGER NOT NULL DEFAULT 1
);

-- ⚠️ ВЕКТОР НЬ ТУСАД НЬ.  sqlite-vec байхгүй машин дээр ч энэ хүснэгт
--    үүсэх ба ХООСОН үлдэнэ — `NullVectorIndex` нь [] буцаана, RRF нь
--    үлдсэн хоёр хөлөөр ажиллана.  Энэ нь доройтол, УНАЛТ БИШ.
CREATE TABLE IF NOT EXISTS ai_chunk_vectors (
  chunk_id        TEXT PRIMARY KEY REFERENCES ai_chunks(chunk_id) ON DELETE CASCADE,
  embedding_model TEXT NOT NULL,
  dim             INTEGER NOT NULL,
  embedding       BLOB NOT NULL
);

-- Шингээлтийн бүртгэл — «хэзээ, юуг, ямар hash-аар» (§10-ийн шинэлэг байдал).
CREATE TABLE IF NOT EXISTS ai_ingest_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id        TEXT NOT NULL,
  dataset       TEXT NOT NULL,
  dataset_version TEXT,
  source_sha256 TEXT,
  chunks        INTEGER NOT NULL DEFAULT 0,
  rules         INTEGER NOT NULL DEFAULT 0,
  aliases       INTEGER NOT NULL DEFAULT 0,
  tests         INTEGER NOT NULL DEFAULT 0,
  cases         INTEGER NOT NULL DEFAULT 0,
  unverified    INTEGER NOT NULL DEFAULT 0,
  ingested_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================
-- L0 · НОРМЫН БҮРТГЭЛ (ai/norm-dataset/registry, 2026-09-16)
-- =============================================================
-- ⚠️ ЭХ СУРВАЛЖ НЬ GIT-ИЙН ФАЙЛ (`ai/norm-dataset/registry/norms.jsonl`), ЭНЭ ХҮСНЭГТ
--    ДЕРИВАТИВ.  `ai_documents` нь ШИНГЭЭСЭН баримтыг л мэднэ; бүртгэл нь шингээгээгүй
--    нормыг ч (код · нэр · төлөв · баг/сэдэв · албан холбоос) мэднэ — «өндөр барилгын
--    гэрэлтүүлгийн норм өг» гэхэд заалтгүй ч ЗӨВ холбоос гарна, заалт зохиогдохгүй.
-- ⚠️ ТӨЛӨВ ТААМАГЛАГДАХГҮЙ: ACTIVE зөвхөн MCIS-ийн бүртгэлээс; DRAFT/SUPERSEDED/HISTORICAL
--    нь `retrieval_default = 0` — өгөгдмөл хайлтад орохгүй (хүсэлтээр л).
-- ⚠️ `CREATE TABLE IF NOT EXISTS` — схемийн хувилбар ӨСГӨХГҮЙ (одоо байгаа сан хөндөгдөхгүй,
--    шинэ хүснэгт нээхэд л үүснэ).  Дахин барихад `db.ts` DERIVED_TABLES-д орсон.
CREATE TABLE IF NOT EXISTS ai_norm_registry (
  code_key              TEXT PRIMARY KEY,
  canonical_code        TEXT NOT NULL,
  title_mn              TEXT NOT NULL,
  title_en              TEXT,
  document_type         TEXT NOT NULL,
  status                TEXT NOT NULL,
  status_evidence_json  TEXT NOT NULL DEFAULT '[]',
  effective_status      TEXT,
  capability_level      TEXT NOT NULL,
  priority              TEXT NOT NULL,
  teams_json            TEXT NOT NULL DEFAULT '[]',
  topics_json           TEXT NOT NULL DEFAULT '[]',
  building_types_json   TEXT NOT NULL DEFAULT '[]',
  aliases_json          TEXT NOT NULL DEFAULT '[]',
  supersedes_json       TEXT NOT NULL DEFAULT '[]',
  superseded_by         TEXT,
  successor_draft       TEXT,
  draft_of              TEXT,
  approval              TEXT,
  source_url            TEXT,
  source_pdf_url        TEXT,
  legal_source_url      TEXT,
  source_type           TEXT NOT NULL,
  retrieval_default     INTEGER NOT NULL DEFAULT 1,
  deep_ingestion_status TEXT NOT NULL,
  document_dir          TEXT,
  local_pack            TEXT,
  note                  TEXT,
  last_verified         TEXT NOT NULL,
  registry_version      TEXT NOT NULL
);

-- Хайлтын нэр томьёо: код/alias/гарчиг + багийн ба сэдвийн alias (taxonomy-оос дэлгэсэн).
CREATE TABLE IF NOT EXISTS ai_norm_registry_terms (
  code_key  TEXT NOT NULL REFERENCES ai_norm_registry(code_key) ON DELETE CASCADE,
  kind      TEXT NOT NULL,   -- code | alias | title | team | topic | building_type
  term      TEXT NOT NULL,
  term_fold TEXT NOT NULL,
  key       TEXT,            -- багийн/сэдвийн түлхүүр (kind = team/topic үед)
  weight    REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (code_key, kind, term)
);
CREATE INDEX IF NOT EXISTS idx_registry_terms_fold ON ai_norm_registry_terms(term_fold);

-- Хамаарлын граф: нормоос норм руу (заалтын ишлэл, орлуулга, төслийн хувилбар).
CREATE TABLE IF NOT EXISTS ai_norm_references (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  from_key       TEXT NOT NULL,
  from_clause    TEXT,
  from_locator   TEXT,
  to_key         TEXT NOT NULL,
  to_document    TEXT NOT NULL,
  to_in_registry INTEGER NOT NULL DEFAULT 0,
  relationship   TEXT NOT NULL,
  context        TEXT,
  source_page    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_norm_refs_from ON ai_norm_references(from_key);
CREATE INDEX IF NOT EXISTS idx_norm_refs_to   ON ai_norm_references(to_key);

-- =============================================================
-- L1 · СЭДВИЙН ЧИГЛҮҮЛЭГЧ + 2025 оны нормын бүртгэлийн суурь мөр
--      (ai/norm-dataset/router + registry/cdc-2025, 2026-09-18)
-- =============================================================
-- ⚠️ ЭХ СУРВАЛЖ НЬ GIT-ИЙН ФАЙЛ (`router/*.json[l]`, `registry/cdc-2025/*.jsonl`) — эдгээр
--    хүснэгт ДЕРИВАТИВ, `ai:ingest:registry` бүрд цэвэрлэгдэж дахин бичигдэнэ.  Багцын
--    524 мөр нь `ai_norm_registry`-д НЭГТГЭГДЭНЭ (код/alias-аар таарсан мөр давхардахгүй,
--    гараар баталгаажсан ACTIVE төлөв хэзээ ч дарагдахгүй); энд зөвхөн L1-ийн НЭМЭЛТ
--    талбар: багцын registry_id, хамрах хүрээний анги (cost/labour шүүлт), чиглүүлэлтийн
--    сэдэв, албан холбоосын гурван түвшин, 2025 оны бүртгэлийн мөрийн провенанс.
-- ⚠️ 2025 оны бүртгэлийн мөр нь ЗААЛТ БИШ — эндээс тоо, заалт, хүснэгт ХЭЗЭЭ Ч гарахгүй.
--    `STATUS_REQUIRES_VERIFICATION` = хайж болно, хүчинтэй эсэх нь шалгагдаагүй; ACTIVE
--    болгож чимээгүй дээшлүүлэхгүй.
-- ⚠️ `CREATE TABLE IF NOT EXISTS` — схемийн хувилбар ӨСГӨХГҮЙ (`ai_norm_registry`-тэй ижил
--    дүрэм: одоо байгаа сан хөндөгдөхгүй, шинэ хүснэгт нээхэд л үүснэ).  `db.ts` DERIVED_TABLES-д.
CREATE TABLE IF NOT EXISTS ai_norm_registry_l1 (
  code_key                 TEXT PRIMARY KEY REFERENCES ai_norm_registry(code_key) ON DELETE CASCADE,
  registry_id              TEXT NOT NULL UNIQUE,
  canonical_code_pkg       TEXT,             -- багцын код (нэгтгэсэн мөрөнд куратор кодоос зөрж болно)
  record_kind              TEXT NOT NULL,    -- main_record | standard | subentry | post_baseline_record
  merged_into_curated      INTEGER NOT NULL DEFAULT 0,  -- 1 = norms.jsonl-ийн мөртэй нэгтгэсэн (төлөв нь тэндээс)
  pkg_status               TEXT NOT NULL,    -- багцын төлөв (STATUS_REQUIRES_VERIFICATION | SUPERSEDED …)
  baseline_status          TEXT,
  baseline_year            INTEGER,
  scope_classes_json       TEXT NOT NULL DEFAULT '[]',
  routing_topics_json      TEXT NOT NULL DEFAULT '[]',
  topic_evidence_json      TEXT NOT NULL DEFAULT '{}',
  source_url               TEXT NOT NULL,    -- бүртгэлийн PDF хуудас (үргэлж бий)
  official_detail_url      TEXT,
  official_pdf_url         TEXT,
  legalinfo_url            TEXT,
  parent_registry_id       TEXT,
  decision_text            TEXT,
  invalid_decree_text      TEXT,
  lookup_enabled           INTEGER NOT NULL DEFAULT 1,
  baseline_source_json     TEXT NOT NULL DEFAULT '{}',  -- pdf_page · printed_page · row_no · sha256
  dataset_id               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_norm_l1_registry_id ON ai_norm_registry_l1(registry_id);

CREATE TABLE IF NOT EXISTS ai_norm_topics (
  topic_id      TEXT PRIMARY KEY,
  label_mn      TEXT NOT NULL,
  aliases_json  TEXT NOT NULL DEFAULT '[]',
  keywords_json TEXT NOT NULL DEFAULT '[]'
);

-- alias_norm = жишиг хэрэгжүүлэлтийн (topic_lookup.py) `norm()`: жижиг үсэг, ё→е, зай нэг.
-- alias_fold = fold.ts (кирилл↔латин) — морфологийн нөөц таарц.
CREATE TABLE IF NOT EXISTS ai_norm_topic_aliases (
  topic_id   TEXT NOT NULL REFERENCES ai_norm_topics(topic_id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  alias_fold TEXT NOT NULL,
  PRIMARY KEY (topic_id, alias)
);

CREATE TABLE IF NOT EXISTS ai_norm_topic_assignments (
  code_key  TEXT NOT NULL REFERENCES ai_norm_registry(code_key) ON DELETE CASCADE,
  topic_id  TEXT NOT NULL,
  PRIMARY KEY (code_key, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_norm_topic_assign_topic ON ai_norm_topic_assignments(topic_id);

-- Барилгын төрлийн давхарга (building_overlays.json): kind = anchor | core | topic (topic_id-тай).
-- `code_key` NULL = давхаргын код бүртгэлд олдсонгүй (шингээлт ИЛ тоолно, чимээгүй алгасахгүй).
CREATE TABLE IF NOT EXISTS ai_norm_building_overlays (
  building  TEXT NOT NULL,
  kind      TEXT NOT NULL,
  topic_id  TEXT NOT NULL DEFAULT '',   -- '' = anchor/core (сэдэвгүй давхарга)
  position  INTEGER NOT NULL,
  code      TEXT NOT NULL,
  code_key  TEXT,
  PRIMARY KEY (building, kind, topic_id, position)
);

-- ═══ L2 — НОРМ ОЙЛГОХ / ТАЙЛБАРЛАХ ДАВХАРГА (ai/norm-dataset/documents/<Doc>/l2, 2026-09-18) ═══
-- Заалт БҮРД нэг «clause_explanation» бичлэг: эх бичвэр (ХӨДЛӨШГҮЙ, sha256-тай) + детерминист семантик
--    хүрээ (subject/requirement/conditions/exceptions/prohibitions/permissions/cross_references — өгүүлбэр
--    бүр ЭХЭЭС үг үсгээрээ) + энгийн монгол тайлбар (AUTO_DRAFT) + тоо ЭХИЙН ХЭЛБЭРЭЭР + эх сурвалж
--    (хуудас, URL, PDF sha256).  Баримт/хэсгийн түвшний бичлэг мөн энд (`kind`).
-- ⚠️ ТООЦОО БИШ: бичлэг бүр `computable = 0` — ангилал, интерполяц, pass/fail, хэмжээ ЭНДЭЭС ХЭЗЭЭ Ч гарахгүй.
-- ⚠️ ХҮЧИНТЭЙ ЭСЭХ нь ТУСДАА (`ai_norm_registry` / `ai_documents.effective_status`) — энд төлөв дээшлэхгүй.
-- ⚠️ `chunk_id` = `ai_chunks.chunk_id` (заалтын хэсэг) — хайлтын ХОЁР ДАХЬ систем БИШ: одоо байгаа
--    `askNorm` хэсгээ олоод, энэ хүснэгтээс тайлбарыг нь ЗАЛГАНА.  Заалтын дугаар үндсэн хэсэг/хавсралт
--    хооронд ДАВХАРДДАГ (8.3 ↔ 8-р хавсралтын 8.3) тул `scope`+`appendix` ялгуур.
-- ⚠️ `CREATE TABLE IF NOT EXISTS`, SCHEMA_VERSION ӨСГӨХГҮЙ — ажилтны сан дахин баригдахгүй; багцын
--    файлаас (`l2/clause_explanations.jsonl`) бүтнээр дахин үүсдэг (DERIVED_TABLES).
CREATE TABLE IF NOT EXISTS ai_norm_explanations (
  explanation_id     TEXT PRIMARY KEY,           -- <doc_id>:l2:clause:<clause_uid> | :l2:section:<n> | :l2:document
  doc_id             TEXT NOT NULL,
  norm_code          TEXT NOT NULL,
  kind               TEXT NOT NULL CHECK (kind IN ('clause', 'section', 'document')),
  chunk_id           TEXT,                       -- заалтын хэсэг (`ai_chunks.chunk_id`); section/document-д NULL
  clause_id          TEXT,                       -- «5.2» (хавсралтад ч «8.3»)
  clause_uid         TEXT,                       -- «БНбД 31-17-10#5.2» / «…#A8:8.3» — ГАНЦ утгатай
  scope              TEXT,                       -- body | appendix
  appendix           TEXT,
  section            TEXT,
  requirement_type   TEXT,                       -- scope|definition|obligation|prohibition|permission|reference|procedure|informational
  heading_path_json  TEXT NOT NULL,
  source_text        TEXT,                       -- ЭХ БИЧВЭР ЯГ (clauses.jsonl-ийн text)
  source_text_sha256 TEXT,
  plain_mn           TEXT,
  plain_method       TEXT,                       -- deterministic_digest | llm_validated
  frame_json         TEXT NOT NULL,              -- semantic_frame
  numeric_json       TEXT NOT NULL,              -- numeric_literals (эхийн хэлбэрээр)
  page               INTEGER,
  source_url         TEXT,
  document_sha256    TEXT,
  verification_explanation TEXT NOT NULL,        -- AUTO_DRAFT | HUMAN_VERIFIED (энэ хэрэгсэл ХЭЗЭЭ Ч HUMAN_VERIFIED бичихгүй)
  computable         INTEGER NOT NULL DEFAULT 0 CHECK (computable = 0),
  record_json        TEXT NOT NULL,              -- бүтэн бичлэг (гэрээний бүх талбар)
  generated_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_norm_expl_chunk ON ai_norm_explanations(chunk_id);
CREATE INDEX IF NOT EXISTS idx_norm_expl_doc_clause ON ai_norm_explanations(doc_id, kind, clause_id, scope);
CREATE INDEX IF NOT EXISTS idx_norm_expl_doc_section ON ai_norm_explanations(doc_id, kind, section);

-- L2 ХҮСНЭГТ / ТОМЬЁО / БАРИМТ ХООРОНДЫН ХОЛБООС (2026-09-23, БНбД 20-04-17-оос эхлэн) — `documents/<Doc>/l2/`
--   {table,formula}_explanations.jsonl + cross_document_links.json.  `ai_norm_explanations`-ийн kind CHECK нь ажилтны
--   санд аль хэдийн үүссэн тул ТУСДАА хүснэгт (CREATE TABLE IF NOT EXISTS, SCHEMA_VERSION өсөхгүй, DERIVED_TABLES-д).
--   Нүд, илэрхийлэл бүр ЭХЭЭС үг үсгээрээ; computable ҮРГЭЛЖ 0 — L2 томьёо гүйцэтгэхгүй, хүснэгтээс тооцоолохгүй.
CREATE TABLE IF NOT EXISTS ai_norm_explanation_objects (
  object_id    TEXT PRIMARY KEY,                  -- <doc_id>:l2:table:<no> | :l2:formula:<label> | :l2:links
  doc_id       TEXT NOT NULL,
  norm_code    TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('table', 'formula', 'links')),
  object_key   TEXT,                              -- хүснэгтийн дугаар («8.3», «Д.1») / томьёоны шошго («10.1»)
  chunk_id     TEXT,                              -- `ai_chunks.chunk_id` (<doc_id>:table:<no> | :formula:<label>)
  clause_id    TEXT,                              -- томьёоны заалт / хүснэгтийн байрлалын заалт
  page         INTEGER,
  computable   INTEGER NOT NULL DEFAULT 0 CHECK (computable = 0),
  record_json  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_norm_obj_doc ON ai_norm_explanation_objects(doc_id, kind, object_key);
CREATE INDEX IF NOT EXISTS idx_norm_obj_chunk ON ai_norm_explanation_objects(chunk_id);
