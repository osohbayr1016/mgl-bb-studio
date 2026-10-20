-- Баримт бичгийн модулийг ТӨСЛӨӨС салгана.
--
-- Шалтгаан (эзний шийдвэр, 2026-09-03): «Projects хэсэгт байгаа төслүүд
-- автоматаар Баримт бичиг хуудсанд дуудагдахыг болиулж, зөвхөн серверээс
-- бүтэн хавтсаар нь оруулдаг болго».  Өөрөөр хэлбэл нэгж нь төсөл биш,
-- СЕРВЕРЭЭС ИМПОРТОЛСОН НЭГ ХАВТАС — түүнийг «архив» гэж нэрлэв.
--
-- Тусдаа таблиц болгосон нь `repair_projects` (0194)-ийн жишгийг дагав:
-- архив нь `projects.id` эзэмшдэггүй тул 126 ширхэг `FROM projects` дуудлагын
-- аль нэгэнд нь ХЭЗЭЭ Ч цухуйхгүй.  ⚠️ Хоёр id орон зай ДАВХЦДАГ —
-- `projects.id` 7 ба `document_archives.id` 7 хоёулаа байж болно, тиймээс
-- `/app/documents/:archiveId` нь ХЭЗЭЭ Ч төслийн id биш.
CREATE TABLE document_archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_path TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,
  deleted_by INTEGER REFERENCES users(id)
);

CREATE INDEX idx_doc_archives_live ON document_archives(deleted_at);

-- Аль хэдийн байршуулсан баримтыг АЛДАХГҮЙ: файлтай төсөл бүрээс нэг архив
-- үүсгэж, дараагийн миграцууд түүн рүү хавтас/баримтыг зөөнө.  Хоосон
-- загварын хавтас (00-12) л байгаа төслүүд архив үүсгэхгүй — тэдгээр нь
-- `seedProjectFolders`-ын автомат бүтээгдэхүүн бөгөөд яг тэднийг л эзэн
-- «автоматаар дуудагдахыг болиул» гэсэн.  `source_path` нь энд гарал үүслийн
-- тэмдэглэл БОЛООД дараагийн миграцуудын холбох түлхүүр.
INSERT INTO document_archives (name, source_path, created_by)
SELECT
  p.name,
  'project:' || p.id,
  COALESCE(
    (SELECT d.created_by FROM documents d WHERE d.project_id = p.id ORDER BY d.id LIMIT 1),
    (SELECT f.created_by FROM document_folders f WHERE f.project_id = p.id ORDER BY f.id LIMIT 1)
  )
FROM projects p
WHERE EXISTS (SELECT 1 FROM documents d WHERE d.project_id = p.id);
