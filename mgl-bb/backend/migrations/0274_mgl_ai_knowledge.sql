-- =============================================================
-- 0274_mgl_ai_knowledge.sql — MGL AI · МЭДЛЭГИЙН БҮРТГЭЛ ба ХЭСГҮҮД
-- =============================================================
-- ЗОРИЛГО: §16-ийн шингээлтийн хоолойн ЭЦСИЙН БҮРТГЭЛ.  Нэг баримт =
-- олон хэсэг, хэсэг бүр нь ХУУДАС, ХЭСЭГ, ХУВИЛБАР, АНГИЛЛАА үүрнэ.
--
-- ⚠️ ЭНЭ НЬ `regulatory_documents` / `rule_clauses` (0220)-Г СОЛИХГҮЙ.
--    Тэр хоёр нь АЛБАН ЁСНЫ БНбД/MNS-ийн эрх бүхий бүртгэл бөгөөд
--    0221-ийн CHECK нь тэднээс эшлэлийн итгэлцлийг гаргадаг.  Энэ файл
--    нь ХАЙЛТЫН давхарга: PDF-ээс гаргасан хэсэг, компанийн дотоод
--    баримт, төслийн баримт БҮГД нэг хэлбэрт орж, `source_kind` нь
--    хаанаас ирснийг хэлнэ.  Дүрмийн эшлэл ХЭРЭГТЭЙ үед `clause_uid`
--    дамжуулан 0220 руу БУЦАЖ шийдэгдэнэ — эшлэлийг энэ хүснэгтээс
--    ХЭВЛЭХГҮЙ.
--
-- ⚠️ EMBEDDING ЭНД БАЙХГҮЙ, ЗОРИУД.  Вектор нь ажилтны PC дээрх локал
--    индекст амьдарна (`ai/retrieval/`).  Шалтгаан: (а) хэмжээ —
--    768-хэмжээст float32 нь хэсэг тутамд 3 KB, 100k хэсэг = 300 MB,
--    (б) вектор нь ЗАГВАРААС хамаарна — embedding загвар солиход БҮГД
--    хүчингүй болно, тэр нь D1-ийн ажил биш.  D1 нь «энэ хэсгийг ХЭН
--    үзэж болох вэ» гэсэн ЭРХИЙН үнэнийг барина.
--
-- ⚠️ НУУЦЛАЛЫН ШҮҮЛТ нь `classification` + `visibility_scope` +
--    `allowed_roles_json` + `project_id` + `org_id` ДӨРВҮҮЛЭЭ.  Шүүлт нь
--    prompt угсрахаас ӨМНӨ (`lib/mglai/visibility.ts`) явагдана — загварт
--    «битгий хэл» гэж хэлэх нь шүүлт БИШ.
--
-- ⚠️ D1-д `LIKE '%...%'` том TEXT багана дээр ТАТГАЛЗДАГ (хэмжсэн).
--    Лексик хайлт нь `instr()` ашиглана — `text_folded` нь түүний зорилго.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 7 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_knowledge_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_uid        TEXT    NOT NULL UNIQUE,
  source_kind    TEXT    NOT NULL DEFAULT 'upload'
                   CHECK (source_kind IN ('regulation','company_doc','project_doc','handbook','upload','web')),
  title          TEXT    NOT NULL,
  title_en       TEXT,
  lang           TEXT    NOT NULL DEFAULT 'mn',
  document_uid   TEXT,
  archive_id     INTEGER,
  project_id     INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  org_id         INTEGER,
  classification TEXT    NOT NULL DEFAULT 'internal'
                   CHECK (classification IN ('public','internal','confidential','restricted')),
  visibility_scope TEXT  NOT NULL DEFAULT 'company'
                   CHECK (visibility_scope IN ('public','company','project','org','owner')),
  allowed_roles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_roles_json)),
  version        TEXT,
  effective_from TEXT,
  effective_to   TEXT,
  page_count     INTEGER NOT NULL DEFAULT 0,
  chunk_count    INTEGER NOT NULL DEFAULT 0,
  bytes          INTEGER NOT NULL DEFAULT 0,
  sha256         TEXT,
  r2_key         TEXT,
  ingest_state   TEXT    NOT NULL DEFAULT 'pending'
                   CHECK (ingest_state IN ('pending','extracting','chunked','indexed','failed','retired')),
  ingest_error   TEXT,
  ingested_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ingested_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_doc_scope ON ai_knowledge_documents (visibility_scope, classification, ingest_state);

CREATE INDEX IF NOT EXISTS idx_ai_doc_project ON ai_knowledge_documents (project_id) WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ai_doc_kind ON ai_knowledge_documents (source_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_knowledge_chunks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  chunk_uid      TEXT    NOT NULL UNIQUE,
  doc_uid        TEXT    NOT NULL,
  seq            INTEGER NOT NULL DEFAULT 0,
  page_no        INTEGER,
  section        TEXT,
  heading        TEXT,
  clause_uid     TEXT,
  text           TEXT    NOT NULL,
  text_folded    TEXT    NOT NULL DEFAULT '',
  char_count     INTEGER NOT NULL DEFAULT 0,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  lang           TEXT    NOT NULL DEFAULT 'mn',
  classification TEXT    NOT NULL DEFAULT 'internal'
                   CHECK (classification IN ('public','internal','confidential','restricted')),
  visibility_scope TEXT  NOT NULL DEFAULT 'company'
                   CHECK (visibility_scope IN ('public','company','project','org','owner')),
  allowed_roles_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(allowed_roles_json)),
  project_id     INTEGER,
  org_id         INTEGER,
  embedding_model TEXT,
  embedding_dim  INTEGER,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_chunk_doc ON ai_knowledge_chunks (doc_uid, seq);

CREATE INDEX IF NOT EXISTS idx_ai_chunk_scope ON ai_knowledge_chunks (visibility_scope, classification);
