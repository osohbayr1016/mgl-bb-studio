-- =============================================
-- Захиалагчид харагдах өөрчлөлтийн урсгал
-- =============================================
-- WebSocket (ClientRoom Durable Object) бол зөвхөн ТЭЭВЭР — үнэн нь ЭНД.
-- Захиалагч офлайн байхад болсон өөрчлөлт алдагдаж болохгүй тул дахин
-- холбогдоход `since_id`-аар гүйцээж татна.

CREATE TABLE IF NOT EXISTS client_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  ref_id        INTEGER,
  title_mn      TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_events_project ON client_events(project_id, id);
