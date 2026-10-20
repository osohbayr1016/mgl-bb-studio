-- =============================================
-- Project passport + client-supplied documents tracker
-- =============================================
-- Two new tables that capture the structured "паспорт" header used in
-- engineering proposals (the table the user pastes from MEC-25/21 etc.)
-- and the list of documents the *client* must hand over before drawings
-- can begin (А даалгавар, Геологи, Газрын гэрчилгээ, …).
--
-- Both are per-project, so admin/engineers can edit on the staff side
-- and clients see a read-only / mark-as-provided view on the client side.

-- 1.  One-to-one passport / cover-sheet metadata
CREATE TABLE IF NOT EXISTS project_passport (
  project_id        INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  full_title        TEXT,           -- Төслийн нэр (full long form)
  drawing_no        TEXT,           -- Зургийн шифр  (e.g. MEC-25/21)
  scope             TEXT,           -- Ажлын цар хүрээ
  director          TEXT,           -- Захирал
  client_pm         TEXT,           -- Захиалагчийн төслийн менежер (one or many lines)
  start_date        TEXT,           -- ISO yyyy-mm-dd
  finish_date       TEXT,           -- ISO yyyy-mm-dd
  extension_date    TEXT,           -- free-form (sometimes "-")
  meeting_30        TEXT,           -- 30% уулзалт огноо
  meeting_50        TEXT,           -- 50% уулзалт огноо
  meeting_100       TEXT,           -- 100% уулзалт огноо
  -- JSON array of discipline codes (`["BA","BB","HAS","TSBU","TSAH","HD","AU","IZ"]`)
  -- Schema-validated only at the application layer.
  disciplines_json  TEXT,
  notes             TEXT,
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_id     INTEGER REFERENCES users(id)
);

-- 2.  Documents the client must provide.  Engineers seed the list with
-- placeholder rows ("А даалгавар — Захиалагчаас авах") and the client
-- (or admin on their behalf) flips status to 'provided' once handed in.
CREATE TABLE IF NOT EXISTS project_client_documents (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  doc_name          TEXT NOT NULL,    -- e.g. "А даалгавар"
  doc_no            TEXT,             -- e.g. "ГБМЗХ2020/17-047"
  doc_date          TEXT,             -- ISO date or free text
  source            TEXT,             -- e.g. "Захиалагчаас авах" / "ЛЭНД ТЕСТ ХХК"
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK(status IN ('pending','provided','not_required')),
  provided_at       TEXT,
  provided_by_id    INTEGER REFERENCES users(id),
  -- Optional URL / file id once the client uploads the actual paper.
  file_url          TEXT,
  file_name         TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pcd_project ON project_client_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_pcd_status  ON project_client_documents(project_id, status);
