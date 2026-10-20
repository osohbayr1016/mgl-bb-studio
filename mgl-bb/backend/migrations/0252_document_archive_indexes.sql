-- 0250-д дахин үүсгэсэн таблицуудын индекс.  Тусад нь файл болсон нь D1-ийн
-- «нэг файлд 9 хүртэл statement» тээврийн дүрэмд багтаахын тулд.
CREATE INDEX idx_doc_folders_parent ON document_folders(archive_id, parent_id);

CREATE INDEX idx_doc_folders_trash ON document_folders(archive_id, deleted_at);

CREATE UNIQUE INDEX idx_doc_folders_code
  ON document_folders(archive_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_documents_archive ON documents(archive_id);

CREATE INDEX idx_documents_folder ON documents(folder_id);

CREATE INDEX idx_documents_deleted ON documents(archive_id, deleted_at);
