-- =============================================
-- Teams / departments + per-user team assignment
-- =============================================

-- 1. Teams table
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Short code the company already uses internally (e.g. BA, BB, HAS, IZ).
  code TEXT NOT NULL UNIQUE,
  -- Human-readable Mongolian name (authoritative for display)
  name_mn TEXT NOT NULL,
  -- Optional English name
  name_en TEXT,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_teams_code ON teams(code);
CREATE INDEX IF NOT EXISTS idx_teams_sort ON teams(sort_order);

-- 2. Link users → teams (plus job position + employee id)
ALTER TABLE users ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
-- Free-form Mongolian job title, e.g. "Ахлах архитектор", "Архитектор", "ЦБУ-ын инженер".
-- Independent of `role` so admins can add new titles without changing the permission model.
ALTER TABLE users ADD COLUMN position TEXT;
-- Internal employee ID, e.g. BLN, GNB. UNIQUE is enforced via index below
-- because ALTER TABLE ADD COLUMN cannot declare UNIQUE inline in SQLite.
ALTER TABLE users ADD COLUMN employee_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id
  ON users(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);

-- 3. Seed teams the company already uses.
-- Idempotent — re-running this migration won't duplicate rows.
INSERT OR IGNORE INTO teams (code, name_mn, name_en, sort_order) VALUES
  ('BA',   'Барилга архитектур',         'Architecture',          10),
  ('BB',   'Барилга бүтээц',             'Structure',             20),
  ('HAS',  'Халаалт агаар сэлгэлт',      'HVAC',                  30),
  ('TSBU', 'Цэвэр бохир ус',             'Plumbing',              40),
  ('TSAH', 'Цахилгаан',                  'Electrical',            50),
  ('HD',   'Холбоо дохиолол',            'Communications',        60),
  ('AU',   'Автомат удирдлага',          'Automation Control',    70),
  ('IZ',   'Интерьер зураг',             'Interior Design',       80),
  ('MGMT', 'Менежмент',                  'Management',            90);
