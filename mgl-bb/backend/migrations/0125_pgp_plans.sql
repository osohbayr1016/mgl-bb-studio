-- =============================================================
-- Хувь хүний хөгжлийн төлөвлөгөө (Personal Growth Plan / PGP)
-- =============================================================
-- Ажилтан өөрийн хөгжлийн төлөвлөгөөг жил бүр (period) бөглөнө.
-- Урсгал ЭНГИЙН: submit/түгжээ байхгүй — эзэн хүссэн үедээ засаж autosave
-- хийнэ, статус байхгүй. Жил бүр шинэ бичлэг үүсгэх ба өмнөх нь түүхээр
-- үлдэнэ (UNIQUE(user_id, period)).
--
-- Маягтын бүх талбар `answers_json`-д хадгалагдана (frontend schema —
-- quotes.data_json хэв маяг): strengths, challenges, project_involvement,
-- technical_skills, career_direction, cross_discipline, org_support,
-- work_environment, action_plan_3y. Маягт өөрчлөгдөхөд migration хэрэггүй.
--
-- Харах эрх (route талд): эзэн өөрөө + admin + senior. Admin/senior нь
-- `pgp_comments`-оор санал (feedback) бичнэ.
CREATE TABLE IF NOT EXISTS pgp_plans (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period       TEXT    NOT NULL,               -- '2026' г.м
  answers_json TEXT    NOT NULL DEFAULT '{}',  -- маягтын бүх талбар (frontend schema)
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, period)
);

CREATE INDEX IF NOT EXISTS idx_pgp_user ON pgp_plans(user_id);

-- Admin/senior-ийн санал (feedback) — нэг PGP дор олон хүн тэмдэглэл үлдээж болно.
CREATE TABLE IF NOT EXISTS pgp_comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pgp_id     INTEGER NOT NULL REFERENCES pgp_plans(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  note       TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pgp_comments_pgp ON pgp_comments(pgp_id);
