-- =============================================
-- Захиалагчид НИЙТЛЭХ бүртгэл
-- =============================================
-- Дүрэм НЭГ: published_at байгаа бөгөөд unpublished_at хоосон бол л
-- захиалагчид харагдана.  Өгөгдмөл нь НУУГДМАЛ — ноорог, батлагдаагүй,
-- дотоод материал санамсаргүй гарахгүй.
--
-- kind бүр өөр хүснэгтийн мөрийг заана (ref_id):
--   deliverable     → project_deliverables.id
--   perf_report     → performance_reports.id
--   asr             → author_supervision_reports.id
--   meeting_minutes → meetings.id
--   document        → documents.id
--   model           → project_models.id
--   notice          → ref_id = 0, зөвхөн title_mn + note (зарлал)
--
-- ⚠️ ref_id-д FK ТАВИХГҮЙ: нэг багана долоон өөр эцэг хүснэгт заадаг тул
--    полиморф.  Эх мөр уствал нийтлэл өнчрөх боловч уншилтын үед JOIN нь
--    юу ч буцаахгүй тул захиалагчид харагдахгүй.

CREATE TABLE IF NOT EXISTS client_publications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK(kind IN ('deliverable','perf_report','asr','meeting_minutes','document','model','notice')),
  ref_id         INTEGER NOT NULL,
  title_mn       TEXT NOT NULL,
  note           TEXT,
  published_by   INTEGER NOT NULL REFERENCES users(id),
  published_at   TEXT NOT NULL DEFAULT (datetime('now')),
  unpublished_at TEXT,
  UNIQUE(project_id, kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_client_pub_project ON client_publications(project_id, kind);

CREATE INDEX IF NOT EXISTS idx_client_pub_live ON client_publications(project_id, unpublished_at);
