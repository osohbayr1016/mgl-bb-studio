-- 0348 — Засварын цагийг бөглөлтөөс АВТОМАТААР бодох (эзний шийдвэр 2026-09-25).
--
-- 1. БҮХ ZA (Засвар) төсөл цагаар бодогдоно — хувь бөглөх хэсэг байхгүй.
--    0339-д «хуучин ZA төсөл жинлэсэн модоор үлдэнэ» гэж шийдсэнийг эзэн
--    өөрчилсөн: одоо байгаа 9 ZA төслийн хуучин хувийн бөглөлтийг ч цаг
--    болгон нөхөж бодно (lib/repairDayStore.ts, backfill) — явц нь тэр
--    цагуудаас бодогдоно.  Хуучин оноо (user_points source=progress) ХЭВЭЭР.
--
-- 2. Ажилтан цаг БИЧИХГҮЙ.  «Өнөөдөр үүн дээр ажилласан» гэж тэмдэглэнэ
--    (repair_marks), систем өдрийн бөглөлтүүдээс цагийг хуваарилна
--    (lib/repairDay.ts): өдөр = ээлж − цай = 8 цаг, нэг суултаар бөглөсөн
--    бүх таскт тэнцүү; өглөө бусдыг бөглөсөн бол тэр цагаас эхэлнэ.
--
-- repair_marks = ҮЙЛ ЯВДАЛ (хэзээ юуг тэмдэглэсэн).  repair_entries-ийн
-- auto/backfill мөр = ТҮҮНЭЭС ГАРГАСАН цаг (0-ээс их үед л мөр байна —
-- repair_entries.hours нь CHECK(hours > 0)).  Нэг тэмдэглэгээ ↔ нэг мөр
-- (mark_id UNIQUE).  award_points=0 = хуучин хувийн бөглөлтөөс нөхсөн
-- тэмдэглэгээ (progress_entry_id), оноо өгөхгүй — тэр ажил аль хэдийн
-- хувиараа оноо авсан.
--
-- hours_source: manual (0348-аас өмнө гараар бичсэн, хөндөгдөхгүй) | auto
-- (тэмдэглэгээнээс, оноотой) | backfill (хуучин бөглөлтөөс, оноогүй).
-- 8 statement (wrangler-ийн bookkeeping INSERT-тэй 9) — transport дүрэм.
CREATE TABLE IF NOT EXISTS repair_marks (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                 TEXT    NOT NULL,
  project_id           INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  repair_project_id    INTEGER REFERENCES repair_projects(id),
  task_id              INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  marked_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  award_points         INTEGER NOT NULL DEFAULT 1 CHECK (award_points IN (0, 1)),
  progress_entry_id    INTEGER,
  daily_rate           REAL    NOT NULL DEFAULT 0,
  rate_source          TEXT,
  progress_rate        REAL    NOT NULL DEFAULT 0,
  progress_rate_source TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_repair_marks_user_date ON repair_marks(user_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_marks_progress_entry ON repair_marks(progress_entry_id) WHERE progress_entry_id IS NOT NULL;
ALTER TABLE repair_entries ADD COLUMN hours_source TEXT NOT NULL DEFAULT 'manual' CHECK (hours_source IN ('manual', 'auto', 'backfill'));
ALTER TABLE repair_entries ADD COLUMN mark_id INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_repair_entries_mark ON repair_entries(mark_id) WHERE mark_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_repair_user_date ON repair_entries(user_id, date);
UPDATE projects SET progress_mode = 'hours' WHERE category = 'ZA' AND progress_mode <> 'hours';
