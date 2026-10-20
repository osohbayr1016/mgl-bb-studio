-- 0187 — Revit .rvt файлын БАРИМТЫН мөнхийн таних тэмдэг.
--
-- `file_name` нь ЗӨВХӨН ШОШГО: handshake бүрт шинэчлэгддэг, ХЭЗЭЭ Ч түлхүүр
-- биш.  Save-As / нэр солих / central хуулбар бүгд basename-ийг өөрчилдөг
-- (QtoExtractor.cs, ScheduleExportCommand.cs, LinkEnumerator.cs,
-- PdfViewExportCommand.cs — Path.GetFileName-ийн ДӨРВӨН хуулбар).
-- Түлхүүр нь `doc_uid`.
--
-- ⚠️ `uid_source='project_info'` (v1) нь `doc.ProjectInformation.UniqueId`.
-- ProjectInformation бол .rte template-д хадгалагддаг ЭНГИЙН Element тул НЭГ
-- template-ээс үүссэн БҮХ төсөл ИЖИЛ UniqueId-тай байх БОДИТ эрсдэлтэй.
-- Тиймээс өвөрмөц индекс нь ГЛОБАЛ БИШ, харин (project_id, doc_uid).
-- Эмпирик тест хийж баталгаажуулсны дараа л глобал болгож чангатгана
-- (тэр үед 0191 нэмнэ; энэ файлыг ЗАСАХГҮЙ).
--
-- ⚠️ Энэ нь `projects`-ийн CASCADE хүүхэд болж НЭМЭГДЭЖ байна.  projects-т
-- аль хэдийн 33 cascade хүүхэд бий; энэ бол 34 дэх нь.  `migrations apply`-аар
-- projects-ийг ДАХИН БҮТЭЭХ нь улам аюултай боллоо — path B заавал.
-- Гэхдээ ЭНЭ migration өөрөө зөвхөн CREATE TABLE тул аюулгүй.

CREATE TABLE IF NOT EXISTS revit_documents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  doc_uid       TEXT    NOT NULL,
  uid_source    TEXT    NOT NULL DEFAULT 'project_info'
                        CHECK (uid_source IN ('project_info','es_stamp','manual')),
  file_name     TEXT    NOT NULL,
  revit_version TEXT,
  is_link       INTEGER NOT NULL DEFAULT 0 CHECK (is_link IN (0,1)),
  team_code     TEXT,
  sheet_count   INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  first_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_by  INTEGER REFERENCES users(id)
);

-- Төсөл дотор өвөрмөц.  Template-ээс өвлөсөн давхардсан UniqueId нь өөр өөр
-- төсөлд зэрэгцэн оршиж чадна; нэг төсөл дотор давхардвал 409 өгнө.
CREATE UNIQUE INDEX IF NOT EXISTS idx_revit_documents_project_uid
  ON revit_documents(project_id, doc_uid);

-- Салаалалт (fork) илрүүлэх: нэг doc_uid хэдэн төсөлд харагдаж байна вэ.
CREATE INDEX IF NOT EXISTS idx_revit_documents_uid
  ON revit_documents(doc_uid);
CREATE INDEX IF NOT EXISTS idx_revit_documents_project
  ON revit_documents(project_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_revit_documents_file
  ON revit_documents(project_id, file_name);
