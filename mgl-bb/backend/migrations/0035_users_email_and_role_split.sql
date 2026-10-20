-- =============================================================
-- Migration 0035: add `users.email` + split `admin` role
-- =============================================================
--
-- Two simultaneous schema changes wrapped in one table-rebuild:
--
--   1.  Add a nullable `email` column (login still uses `username`;
--       `email` is the delivery target for payroll notifications).
--   2.  Replace the `role` CHECK constraint:
--           BEFORE: ('admin','engineer','architect','senior','client')
--           AFTER : ('system_admin','management','engineer','architect','senior','client')
--       SQLite cannot rewrite a CHECK in place — rebuild the table.
--
-- Existing `admin` rows migrate to `system_admin` (super-admin).
-- The `management` role is new and is intentionally empty after the
-- migration; system_admin can promote users to it from the UI.
--
-- Foreign keys from other tables to `users.id` keep working because
-- D1 runs with `foreign_keys = OFF` by default and AUTOINCREMENT
-- preserves every `id` value through the INSERT … SELECT.

CREATE TABLE users_new (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  username                    TEXT UNIQUE NOT NULL,
  password_hash               TEXT NOT NULL,
  full_name                   TEXT NOT NULL,
  role                        TEXT NOT NULL CHECK(role IN (
                                'system_admin','management',
                                'engineer','architect','senior','client'
                              )),
  status                      TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at                  TEXT DEFAULT (datetime('now')),
  updated_at                  TEXT DEFAULT (datetime('now')),
  profile_image               TEXT,
  cover_image                 TEXT,
  bio                         TEXT,
  description                 TEXT,
  social_links                TEXT,
  team_id                     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  position                    TEXT,
  employee_id                 TEXT,
  onboarding_acknowledged_at  TEXT,
  work_schedule               TEXT NOT NULL DEFAULT 'standard'
                              CHECK(work_schedule IN ('standard','early')),
  seniority                   TEXT CHECK (seniority IN ('senior','intermediate','junior','intern')),
  email                       TEXT
);

INSERT INTO users_new (
  id, username, password_hash, full_name, role, status,
  created_at, updated_at, profile_image, cover_image, bio,
  description, social_links, team_id, position, employee_id,
  onboarding_acknowledged_at, work_schedule, seniority, email
)
SELECT
  id, username, password_hash, full_name,
  CASE role WHEN 'admin' THEN 'system_admin' ELSE role END,
  status,
  created_at, updated_at, profile_image, cover_image, bio,
  description, social_links, team_id, position, employee_id,
  onboarding_acknowledged_at, work_schedule, seniority,
  NULL
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

-- Restore non-PK indexes that existed before the rebuild.  The
-- implicit UNIQUE index for `username` is recreated automatically.
CREATE UNIQUE INDEX idx_users_employee_id
  ON users(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX idx_users_seniority ON users(seniority);
CREATE INDEX idx_users_team       ON users(team_id);
