-- Ведомость (Revit Schedule/Quantities) — инженерүүдийн Revit дотор зохиосон
-- бэлэн хүснэгтүүдийг вэбэд байршуулах. Add-in-ий «Ведомость илгээх» товч
-- сонгосон schedule-үүдийн харагдах текстийг (эсийн утга, бүлэглэлт, нийлбэр
-- бүхий) мөр баганаар нь илгээдэг.
--
-- Семантик: REPLACE — нэг (project, file, name) гурвалд сүүлийн илгээлт л
-- үлдэнэ (intake нь илгээгдсэн нэрсийг DELETE хийгээд дахин INSERT). Түүх
-- хэрэгтэй бол qto_runs шиг append болгож өөрчилнө — одоогоор шаардлагагүй.
-- rows_json: string[][] (мөр бүр эсийн текстүүд) — 5к мөр ~ 300KB, D1-ийн
-- 1MB/мөр лимитэд багтана.

CREATE TABLE IF NOT EXISTS qto_schedules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL,
  category     TEXT NOT NULL DEFAULT '',
  columns_json TEXT NOT NULL DEFAULT '[]',
  rows_json    TEXT NOT NULL DEFAULT '[]',
  row_count    INTEGER NOT NULL DEFAULT 0,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qto_schedules_project
  ON qto_schedules (project_id, file_name, name);
