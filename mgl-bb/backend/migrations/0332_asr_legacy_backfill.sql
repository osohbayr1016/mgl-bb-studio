-- 0332_asr_legacy_backfill.sql
-- Зохиогчийн хяналт: ХУУЧИН (систем нэвтрэхээс өмнөх) тайлангуудыг нөхөж бүртгэх.
--
-- Хуучин урсгал = `YYMMDD_<ТӨСӨЛ>_ASR_<БАГ>_<NNN>.docx|pdf` файл төслийн Google
-- Drive хавтсанд (main_projects.google_drive_folder_id).  Тэдгээр файлыг
-- `project_drive_versions` (0300) аль хэдийн индекслэсэн тул нэр дэвшигчийг
-- Drive рүү дуудалгүй D1-ээс уншина; сонгосон файлаас `author_supervision_reports`
-- мөр үүсгэж, эх файлтай нь ЭНД холбоно.
--
-- Эзний шийдвэр (2026-09-21):
--   • зорилтот төслийг ХЭРЭГЛЭГЧ сонгоно (өгөгдмөл: идэвхтэй ZA гишүүн);
--   • нэг Drive файл ХЭЗЭЭ Ч хоёр удаа орохгүй (доорх UNIQUE), ижил огноо + баг
--     нь ЗӨӨЛӨН давхардал (сервер алгасна, хэрэглэгч ил баталж давна);
--   • нөхөж бүртгэсэн тайлан ТӨСЛИЙН ASR-NNN дарааллаас дугаар АВАХГҮЙ
--     (`seq` NULL хэвээр) — файлын нэрэн дэх дугаар `legacy_doc_no`-д;
--   • шууд `approved`, admin/senior л ажиллуулна.
--
-- `origin`: 'app' = аппаар бүртгэсэн, 'legacy' = нөхөж бүртгэсэн.  `r.*`-ээр
-- жагсаалт/дэлгэрэнгүйд автоматаар очно; UI «Нөхөж бүртгэсэн» тэмдэг харуулна.
ALTER TABLE author_supervision_reports ADD COLUMN origin TEXT NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'legacy'));
ALTER TABLE author_supervision_reports ADD COLUMN legacy_doc_no TEXT;
ALTER TABLE author_supervision_reports ADD COLUMN legacy_author_name TEXT;
ALTER TABLE author_supervision_reports ADD COLUMN imported_by INTEGER;

-- Нэг Drive файл → нэг шийдвэр: тайланд холбогдсон ('imported') эсвэл «энэ бол
-- тайлан биш» гэж алгассан ('ignored').  Тайлан устахад мөр нь CASCADE-аар
-- устаж, файл дахин нэр дэвшигч болно (зориудаар — буруу импортыг устгаад
-- дахин оруулах зам).  `project_id`/`decided_by`-д REFERENCES ЗОРИУД БАЙХГҮЙ:
-- `users`/`projects` дээр шинэ FK ирмэг нь path-B rebuild-ийн жагсаалтыг л
-- уртасгана; нэрийг LEFT JOIN-оор уншдаг тул устсан мөр NULL болно.
CREATE TABLE IF NOT EXISTS asr_legacy_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drive_file_id TEXT NOT NULL,
  root_folder_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  project_id INTEGER,
  report_id INTEGER REFERENCES author_supervision_reports(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('imported', 'ignored')),
  decided_by INTEGER NOT NULL,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asr_legacy_file ON asr_legacy_sources(drive_file_id);
CREATE INDEX IF NOT EXISTS idx_asr_legacy_report ON asr_legacy_sources(report_id);
