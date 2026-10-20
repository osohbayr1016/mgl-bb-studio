-- Create documents table
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  block_id INTEGER REFERENCES blocks(id) ON DELETE CASCADE,
  drawing_id INTEGER REFERENCES drawings(id) ON DELETE CASCADE,
  component_id INTEGER REFERENCES components(id) ON DELETE CASCADE,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create document revisions table
CREATE TABLE document_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL, -- 0, 1, 2...
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at DATETIME,
  review_notes TEXT
);

-- Create document comments table
CREATE TABLE document_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_doc_revisions_doc ON document_revisions(document_id);
CREATE INDEX idx_doc_comments_rev ON document_comments(revision_id);
