-- QTO Самбар — олон файлын нэгтгэл + Revit план PDF бүртгэл.
--
-- Add-in одоо файл тус бүрд (хост + link) тусдаа run илгээдэг (Decision #2)
-- тул самбар «сүүлийн run per file_name»-ээр нэгтгэдэг болов. Доорх индекс
-- тэр correlated subquery-г index seek болгоно. qto_view_exports нь add-in-ий
-- гаргасан план PDF-үүдийг (R2-д /api/upload-аар орсон) төсөлд холбож бүртгэнэ.

CREATE INDEX IF NOT EXISTS idx_qto_runs_project_file
  ON qto_runs (project_id, file_name, created_at DESC);

CREATE TABLE IF NOT EXISTS qto_view_exports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  qto_run_id  INTEGER REFERENCES qto_runs(id) ON DELETE SET NULL,
  view_name   TEXT NOT NULL,            -- Revit view/sheet нэр
  file_name   TEXT,                     -- эх .rvt файл
  media_url   TEXT NOT NULL,            -- '/media/<key>' (POST /api/upload үр дүн)
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qto_view_exports_project
  ON qto_view_exports (project_id, created_at DESC);
