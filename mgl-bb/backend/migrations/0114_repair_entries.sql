-- Засвар (self-logged repair/extra work) + leaderboard wiring.
--
-- Ажилтан my-tasks хуудаснаас засвар/нэмэлт ажлаа бүртгэнэ: project-д холбож
-- зарцуулсан цаг (man-hours) оруулна. Хувь нь автоматаар тооцогдоно:
--     computed_pct = weekly_avg_pct * (hours / day_hours)
-- ба батлахгүйгээр шууд leaderboard оноонд (user_points) нэмэгдэнэ.

CREATE TABLE IF NOT EXISTS repair_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  description     TEXT NOT NULL,
  hours           REAL NOT NULL CHECK(hours > 0),
  day_hours       REAL NOT NULL DEFAULT 8,    -- стандарт ажлын өдрийн цаг (snapshot)
  weekly_avg_pct  REAL NOT NULL DEFAULT 0,    -- үүсгэх үеийн 7 хоногийн AVG(percentage) snapshot
  computed_pct    REAL NOT NULL DEFAULT 0,    -- weekly_avg_pct * (hours / day_hours)
  date            TEXT NOT NULL,              -- UB ажлын огноо YYYY-MM-DD
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_repair_user    ON repair_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_repair_project ON repair_entries(project_id);

-- user_points-ийн мөрийг гарал үүслээр нь ялгана. recalculateProjectPoints нь
-- project-ийн ledger-ийг зөвхөн батлагдсан progress_entries-ээс дахин босгодог
-- тул засварын мөрийг (progress_entry_id NULL) хамгаалахын тулд гарал үүслийг нь
-- тэмдэглэх шаардлагатай. Хуучин бүх мөр default 'progress'-оор backfill хийгдэнэ.
ALTER TABLE user_points ADD COLUMN source          TEXT NOT NULL DEFAULT 'progress';
ALTER TABLE user_points ADD COLUMN repair_entry_id INTEGER;  -- засварын холбоос (app-level cleanup)
