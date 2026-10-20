-- Төслийн баримт бичгийн хавтас мод + soft-delete (recycle bin).
-- documents таблицыг DROP хийхгүй — зөвхөн багана нэмнэ.

CREATE TABLE document_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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

CREATE INDEX idx_doc_folders_parent ON document_folders(project_id, parent_id);
CREATE INDEX idx_doc_folders_trash ON document_folders(project_id, deleted_at);
CREATE UNIQUE INDEX idx_doc_folders_system_code
  ON document_folders(project_id, code)
  WHERE code IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE documents ADD COLUMN folder_id INTEGER REFERENCES document_folders(id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN deleted_at DATETIME;
ALTER TABLE documents ADD COLUMN deleted_by INTEGER REFERENCES users(id);
ALTER TABLE documents ADD COLUMN trash_op TEXT;

CREATE INDEX idx_documents_folder ON documents(folder_id);
CREATE INDEX idx_documents_deleted ON documents(project_id, deleted_at);
