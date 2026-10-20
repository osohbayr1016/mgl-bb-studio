-- =============================================================
-- 0281_main_projects.sql — ҮНДСЭН ТӨСӨЛ (main project) — 2026-09-11
-- =============================================================
--
-- Эзний шийдвэр: `projects` хүснэгтийн мөр нь бодит төслийн НЭГ ангилал
-- (AZ / ZA / EZ / ET / IZ) — «MGL-251006 EVERGREEN» нь AZ (#41) ба ZA (#37)
-- гэсэн хоёр мөр.  Баримт бичиг (Google Drive хавтас) нь тэр АНГИЛЛЫНХ БИШ,
-- бодит төслийнх.  Тиймээс бодит төслийг тусад нь бүртгэж (үндсэн төсөл),
-- ангиллын мөрүүдийг түүнд харьяалуулж, Drive хавтсыг үндсэн төсөл дээр
-- холбоно; ангиллын төсөл бүрийн «Баримт бичиг» таб тэр нэг хавтсыг харна.
--
-- `projects.google_drive_folder_id` (0278) ХЭВЭЭР — үндсэн төсөлгүй мөрийн
-- өөрийн холбоос / хуучин холбоос.  Шийдэх дүрэм (lib/projectDrive.ts
-- loadProjectDriveRoot): үндсэн төслийн хавтас байвал ТЭР, эс бөгөөс өөрийнх.
--
-- `code` нь нэрний «MGL-yymmdd» угтвар — автомат бүлэглэлтийн түлхүүр;
-- UNIQUE БИШ (нэг өдөр хоёр гэрээ байж болно), зөвхөн индекстэй.
-- D1 нь FK-г runtime дээр шалгадаггүй тул устгахад `projects.main_project_id`-г
-- гараар NULL болгоно (routes/mainProjects.ts).
CREATE TABLE IF NOT EXISTS main_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT,
  name TEXT NOT NULL,
  google_drive_folder_id TEXT,
  google_drive_folder_name TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_main_projects_code ON main_projects(code);
ALTER TABLE projects ADD COLUMN main_project_id INTEGER REFERENCES main_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_projects_main_project ON projects(main_project_id);
