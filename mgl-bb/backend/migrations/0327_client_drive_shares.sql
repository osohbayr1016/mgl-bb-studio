-- =============================================================
-- 0327_client_drive_shares.sql — Захиалагчид нээсэн төслийн Drive баримт — 2026-09-18
-- =============================================================
--
-- Эзний шийдвэр (2026-09-18): захиалагч төслийн Google Drive хавтасны БҮГДИЙГ
-- биш, ажилтны (admin/senior) ТЭМДЭГЛЭСЭН хавтас/файлыг л харж, татна.
-- 2026-09-07-ны «ажлын хавтсыг захиалагчид нээхгүй» шийдвэр хэвээр —
-- энэ хүснэгтэд мөргүй зүйл захиалагчид харагдахгүй (өгөгдмөл ХААЛТТАЙ).
--
--   • Эрх БАЙГУУЛЛАГАД (client_orgs) холбогдоно — project_client_access-тэй
--     ижил загвар; тухайн байгууллагын бүх холбоо барих хүн ижил зүйл харна.
--   • Хавтас нээвэл түүний ДЭД МОД бүхэлдээ (Drive-ын parents гинжээр
--     шалгагдана, lib/clientDriveShares.ts); файл нээвэл зөвхөн тэр файл.
--   • item_name / item_mime нь нээх мөчийн ХАРУУЛАХ кэш — Drive эх сурвалж
--     хэвээр, жагсаалт бүрт Drive-аас дахин уншина.
--   • revoked_at нь мөрийг устгахгүйгээр хаана — «хэзээ, хэн нээж/хаасан»
--     нь маргаанд хэрэгтэй баримт (project_client_access-тэй ижил).
CREATE TABLE IF NOT EXISTS client_drive_shares (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id        INTEGER NOT NULL REFERENCES client_orgs(id) ON DELETE CASCADE,
  drive_item_id TEXT NOT NULL,
  item_kind     TEXT NOT NULL CHECK(item_kind IN ('folder','file')),
  item_name     TEXT NOT NULL,
  item_mime     TEXT,
  note          TEXT,
  shared_by     INTEGER REFERENCES users(id),
  shared_at     TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_by    INTEGER REFERENCES users(id),
  revoked_at    TEXT,
  UNIQUE(project_id, org_id, drive_item_id)
);

CREATE INDEX IF NOT EXISTS idx_client_drive_shares_project ON client_drive_shares(project_id, org_id);

-- Захиалагч ЮУГ хэзээ харсан/татсан — эрхийн удирдлагын хуудсанд «сүүлд
-- татсан» мөр, маргаанд баримт.  Зөвхөн захиалагчийн (role = client) үйлдэл.
-- via_item_id = ЯМАР нээлтээр орсон бэ (нээсэн хавтасны id, эсвэл файл өөрөө) —
-- хавтасны нээлтийн «сүүлд татсан» тоолуур дэд файлуудыг ч тоолно.
CREATE TABLE IF NOT EXISTS client_drive_access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id        INTEGER REFERENCES client_orgs(id) ON DELETE SET NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_item_id TEXT NOT NULL,
  via_item_id   TEXT NOT NULL,
  item_name     TEXT NOT NULL,
  action        TEXT NOT NULL CHECK(action IN ('view','download')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_client_drive_access_log_project ON client_drive_access_log(project_id, id);
