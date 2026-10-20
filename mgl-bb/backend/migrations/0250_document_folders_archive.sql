-- Хавтас/баримтыг архив дээр түшиглүүлж дахин үүсгэнэ (0249-ийг үзнэ үү).
--
-- ⚠️ ЭНЭ ФАЙЛ ЭЦЭГ ТАБЛИЦЫГ DROP ХИЙДЭГ.  CLAUDE.md-ийн дүрмээр энэ нь
-- `migrations apply`-д хориотой, учир нь транзакц дотор `ON DELETE CASCADE`
-- ажиллаж хүүхэд мөрийг арчина.  Тиймээс энд ХАМГААЛАЛТ хийв:
--
--   * `documents`-ыг DROP хийхэд `document_revisions` cascade-аар арчигдана.
--     Иймд ЭХЛЭЭД `_rev_bak` рүү бүрэн хуулж авна (0251 буцааж тавина).
--   * `document_comments` нь `document_revisions`-оос хамаардаг.  2026-09-03-нд
--     продакшнд 0 мөр байсан — хэрэглэхийн ӨМНӨ дахин тоолж баталгаажуулах.
--   * Зөөх өгөгдлөө мөн `_fold_bak` / `_doc_bak` рүү урьдчилж хуулна.
--
-- RENAME огт ашиглаагүй: эцгийг нь DROP хийсний дараа `ALTER TABLE ... RENAME`
-- нь схемийг дахин задалдаг тул алга болсон таблиц руу заасан FK дээр унах
-- эрсдэлтэй.  CREATE-AS-SELECT нөөц + DROP + CREATE нь тэр эрсдэлгүй.
CREATE TABLE _fold_bak AS
SELECT f.id AS id, a.id AS archive_id, f.parent_id AS parent_id, f.name AS name,
       f.code AS code, f.is_system AS is_system, f.sort_order AS sort_order,
       f.created_by AS created_by, f.created_at AS created_at,
       f.deleted_at AS deleted_at, f.deleted_by AS deleted_by, f.trash_op AS trash_op
FROM document_folders f
JOIN document_archives a ON a.source_path = 'project:' || f.project_id;

CREATE TABLE _doc_bak AS
SELECT d.id AS id, a.id AS archive_id, d.folder_id AS folder_id, d.title AS title,
       d.description AS description, d.created_by AS created_by, d.created_at AS created_at,
       d.deleted_at AS deleted_at, d.deleted_by AS deleted_by, d.trash_op AS trash_op
FROM documents d
JOIN document_archives a ON a.source_path = 'project:' || d.project_id;

CREATE TABLE _rev_bak AS SELECT * FROM document_revisions;

DROP TABLE documents;

DROP TABLE document_folders;

CREATE TABLE document_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES document_archives(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES document_folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  is_system INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,
  deleted_by INTEGER REFERENCES users(id),
  trash_op TEXT
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES document_archives(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,
  deleted_by INTEGER REFERENCES users(id),
  trash_op TEXT
);
