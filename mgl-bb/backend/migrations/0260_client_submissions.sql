-- =============================================
-- Захиалагчийн илгээх материал — маягт + нэрлэх дүрэм
-- =============================================
-- Эзний шийдвэр (2026-09-07): илгээсэн материалыг ажилтан ШАЛГААД
-- баталгаажуулна.  Тиймээс маягт тус бүрийн `requires_review` тохиргоо
-- БАЙХГҮЙ — бүх материал submitted → accepted|rejected замаар явна.
--
-- НЭРЛЭХ ЗАРЧИМ: захиалагчаас файлаа зөв нэрлэхийг ШААРДАХГҮЙ.  Маягтын
-- талбаруудыг аваад нэрийг СЕРВЕР ӨӨРӨӨ үүсгэнэ (lib/clientFileName.ts).
-- Анхны нэр `original_name`-д ХЭЗЭЭ Ч устгагдахгүй хадгалагдана — «би зөв
-- файл явуулсан» гэдэг маргааныг тэр багана хаана.

CREATE TABLE IF NOT EXISTS client_submission_templates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL UNIQUE,
  name_mn          TEXT NOT NULL,
  description_mn   TEXT,
  fields_json      TEXT NOT NULL DEFAULT '[]',
  filename_pattern TEXT NOT NULL,
  allowed_ext      TEXT,
  active           INTEGER NOT NULL DEFAULT 1,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_submissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id        INTEGER REFERENCES client_orgs(id),
  template_id   INTEGER NOT NULL REFERENCES client_submission_templates(id),
  ref_no        TEXT NOT NULL,
  title         TEXT NOT NULL,
  fields_json   TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','accepted','rejected')),
  submitted_by  INTEGER NOT NULL REFERENCES users(id),
  submitted_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  review_note   TEXT,
  UNIQUE(project_id, ref_no)
);

CREATE TABLE IF NOT EXISTS client_submission_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  INTEGER NOT NULL REFERENCES client_submissions(id) ON DELETE CASCADE,
  r2_key         TEXT NOT NULL,
  original_name  TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  file_type      TEXT,
  file_size      INTEGER,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_client_sub_project ON client_submissions(project_id, status);

CREATE INDEX IF NOT EXISTS idx_client_sub_status ON client_submissions(status, submitted_at);

CREATE INDEX IF NOT EXISTS idx_client_sub_files_parent ON client_submission_files(submission_id);
