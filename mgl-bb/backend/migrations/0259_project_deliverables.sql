-- =============================================
-- Гаргасан зургийн багц (deliverables)
-- =============================================
-- ЯАГААД ШИНЭ ХҮСНЭГТ ВЭ: `drawings` хүснэгт нь (id, block_id, name,
-- weight_percent, sort_order) — файл БАЙХГҮЙ.  Өөрөөр хэлбэл «захиалагч
-- зургаа өөрөө татаж авдаг болъё» гэхэд татах юм нь системд байгаагүй.
--
-- Нэгж нь ХУВИЛБАР (Rev 0 / A / B): захиалагчид өгсөн багц бүр өөрийн
-- гэсэн огноо, гарын үсэг, файлын жагсаалттай.  Хуучин хувилбарыг
-- УСТГАХГҮЙ, зөвхөн superseded болгоно — «бид юуг хэзээ өгсөн бэ» гэдэг
-- маргаанд хариулах цорын ганц баримт.
--
-- Файлууд нь ХААЛТТАЙ R2 (MEETING_BUCKET, `client/` угтвар) дээр байрлана —
-- /media нь нэвтрэлтгүй нийтийн зам тул тэнд байж БОЛОХГҮЙ.

CREATE TABLE IF NOT EXISTS project_deliverables (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  discipline  TEXT,
  title       TEXT NOT NULL,
  rev         TEXT NOT NULL DEFAULT '0',
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','issued','superseded')),
  issued_at   TEXT,
  issued_by   INTEGER REFERENCES users(id),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deliverable_files (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deliverable_id INTEGER NOT NULL REFERENCES project_deliverables(id) ON DELETE CASCADE,
  r2_key         TEXT NOT NULL,
  file_name      TEXT NOT NULL,
  file_type      TEXT,
  file_size      INTEGER,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  uploaded_by    INTEGER REFERENCES users(id),
  uploaded_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_deliverables_project ON project_deliverables(project_id, status);

CREATE INDEX IF NOT EXISTS idx_deliverable_files_parent ON deliverable_files(deliverable_id);
