-- =============================================================
-- 0296_mgl_ai_failure_inbox.sql — MGL AI · АДМИНЫ АЛДААНЫ INBOX + РЕГРЕСС/SFT НЭР ДЭВШИГЧ
-- =============================================================
-- Session B (§19-§24).  Эх сурвалж нь `ai_feedback` (0269) — 👎 нэг бүр ЭНД
-- «алдааны нэр дэвшигч» болно, гэхдээ АВТОМАТААР сургалт руу ХЭЗЭЭ Ч явахгүй.
--
-- ⚠️ ЯАГААД `ai_feedback`-ийг ӨРГӨТГӨХГҮЙ ВЭ.  Тэр хүснэгт «ажилтан юу
--    хэлсэн» гэсэн ТҮҮХИЙ мөр (санал, шалтгаан, залруулга).  Энд «админ юу
--    ШИЙДСЭН» — ангилал, чиглүүлэлт, регресс/SFT-д орох эсэх.  Хоёрыг нэг
--    мөрөнд хийвэл ажилтан саналаа засах бүрд админы шийдвэр дарагдана
--    (0269-ийн ON CONFLICT нь review_state-ийг pending руу БУЦААДАГ).
--
-- ⚠️ `question_text`/`answer_text` нь feedback-ийн snapshot-ын ХУУЛБАР БИШ,
--    АРИУТГАСАН хувь (`redaction_status`).  Ариутгаагүй бол NULL хэвээр
--    ба экспорт хийгдэхгүй — сургалтын багц руу компанийн нэр, ажилтны
--    нэр орох замыг эндээс хаана.
--
-- ⚠️ НОРМАТИВ ҮНЭНИЙГ ЭНД ТОДОРХОЙЛОХГҮЙ (Session A-ийн эзэмшил).
--    `expected_json` нь «хүлээгдэж буй зан төлөв» — тухайн suite-ийн
--    (NORM/COMPANY/CONVERSATION/MODEL_BEHAVIOR/UI) ЭКСПОРТЛОГЧ л тайлна.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 7 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_failure_candidates (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  failure_uid           TEXT    NOT NULL UNIQUE,
  feedback_id           INTEGER REFERENCES ai_feedback(id) ON DELETE SET NULL,
  request_id            TEXT,
  conv_uid              TEXT,
  msg_uid               TEXT,
  installation_id       TEXT,
  user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason_code           TEXT    NOT NULL DEFAULT 'OTHER'
                          CHECK (reason_code IN ('WRONG_ANSWER','WRONG_SOURCE','WRONG_CALCULATION','MISUNDERSTOOD','INCOMPLETE','BAD_MONGOLIAN','TOO_SLOW','UNSAFE_ACTION','OTHER')),
  question_text         TEXT,
  answer_text           TEXT,
  corrected_answer      TEXT,
  redaction_status      TEXT    NOT NULL DEFAULT 'RAW' CHECK (redaction_status IN ('RAW','REDACTED','NOT_NEEDED')),
  intent                TEXT,
  tool_route_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(tool_route_json)),
  validator_json        TEXT    CHECK (validator_json IS NULL OR json_valid(validator_json)),
  trusted_summary_json  TEXT    CHECK (trusted_summary_json IS NULL OR json_valid(trusted_summary_json)),
  versions_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(versions_json)),
  status                TEXT    NOT NULL DEFAULT 'NEW'
                          CHECK (status IN ('NEW','TRIAGED','DATA_ISSUE','RETRIEVAL_ISSUE','CALCULATION_ISSUE','MODEL_BEHAVIOR','CITATION_ISSUE','UI_ISSUE','APPROVED_REGRESSION','APPROVED_SFT','RESOLVED','REJECTED')),
  recommended_route     TEXT,
  admin_notes           TEXT,
  triaged_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  triaged_at            TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_failure_status ON ai_failure_candidates (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_failure_feedback ON ai_failure_candidates (feedback_id) WHERE feedback_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_regression_candidates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_uid   TEXT    NOT NULL UNIQUE,
  failure_id      INTEGER REFERENCES ai_failure_candidates(id) ON DELETE SET NULL,
  target          TEXT    NOT NULL CHECK (target IN ('NORM','COMPANY','CONVERSATION','MODEL_BEHAVIOR','UI')),
  question        TEXT    NOT NULL,
  expected_json   TEXT    NOT NULL CHECK (json_valid(expected_json)),
  failure_class   TEXT,
  versions_json   TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(versions_json)),
  approval_state  TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (approval_state IN ('DRAFT','APPROVED','EXPORTED','REJECTED')),
  exported_to     TEXT,
  exported_at     TEXT,
  approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_regression_state ON ai_regression_candidates (approval_state, target, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_sft_candidates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_uid     TEXT    NOT NULL UNIQUE,
  failure_id        INTEGER REFERENCES ai_failure_candidates(id) ON DELETE SET NULL,
  input_text        TEXT    NOT NULL,
  target_text       TEXT    NOT NULL,
  language          TEXT    NOT NULL DEFAULT 'mn' CHECK (language IN ('mn','en','mixed')),
  category          TEXT    NOT NULL DEFAULT 'behavior',
  redaction_status  TEXT    NOT NULL DEFAULT 'RAW' CHECK (redaction_status IN ('RAW','REDACTED','NOT_NEEDED')),
  review_state      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (review_state IN ('DRAFT','APPROVED','INCLUDED','REJECTED')),
  dataset_version   TEXT,
  approved_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_sft_state ON ai_sft_candidates (review_state, created_at DESC);
