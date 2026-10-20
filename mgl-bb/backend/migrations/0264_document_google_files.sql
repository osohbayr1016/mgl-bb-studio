-- Баримт бичгийн Office файлыг Google Docs/Sheets дээр засах холбоос.
--
-- Нэг мөр = «энэ баримтын ЭНЭ хувилбарыг Google дээр нээсэн» гэсэн амьд
-- холболт.  Хамрах хүрээ нь document_id биш REVISION_ID: шинэ хувилбар
-- байршуулбал хуучин Google файл хуучирсан агуулгыг барьж үлддэг тул тэр
-- холболтыг closed болгож, шинээр хөрвүүлэх ёстой.
--
-- preview_key нь MEETING_BUCKET дахь кэшлэсэн PDF-ийн түлхүүр (ХУВИЙН
-- bucket — /media нь нэвтрэлтгүй нийтийн зам тул тэнд тавьж БОЛОХГҮЙ).
--
-- synced_revision_id: Google-ээс буцааж татсан агуулгыг хадгалсан
-- document_revisions мөр.  Нэг засварын сесс = НЭГ хувилбар: дараагийн
-- татах бүрд шинэ мөр үүсгэхгүй, энэ мөрийн R2 объектыг дарж бичнэ.
-- Эс бөгөөс 2 минут тутмын sweep нь урт засварын үеэр хэдэн арван
-- хувилбар үүсгэнэ.
CREATE TABLE IF NOT EXISTS document_google_files (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id         INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision_id         INTEGER NOT NULL REFERENCES document_revisions(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL,
  google_file_id      TEXT NOT NULL,
  edit_url            TEXT NOT NULL,
  share_mode          TEXT,
  preview_key         TEXT,
  drive_modified_at   TEXT,
  synced_revision_id  INTEGER REFERENCES document_revisions(id) ON DELETE SET NULL,
  opened_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
  last_synced_at      TEXT,
  status              TEXT NOT NULL DEFAULT 'open'
);

-- Нэг хувилбарт нэгээс олон амьд Google файл байвал хоёр хүн өөр өөр
-- хуулбар засаад аль нэг нь чимээгүй алдагдана.  Хэсэгчилсэн unique
-- индекс нь closed мөрийг түүх болгон үлдээхийг зөвшөөрнө.
CREATE UNIQUE INDEX IF NOT EXISTS idx_doc_google_open
  ON document_google_files(revision_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_doc_google_document
  ON document_google_files(document_id);

-- Cron sweep нь амьд холболтуудыг хамгийн эртний sync-ээс нь эхэлж
-- эргүүлдэг тул энэ индекс дээр тогтоно.
CREATE INDEX IF NOT EXISTS idx_doc_google_sweep
  ON document_google_files(status, last_synced_at);
