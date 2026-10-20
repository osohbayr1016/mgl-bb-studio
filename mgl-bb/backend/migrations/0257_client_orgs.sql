-- =============================================
-- Захиалагчийн байгууллага төвтэй таних загвар
-- =============================================
-- Урьд нь «захиалагч хэн бэ» гэдэгт систем ХОЁР өөр хариулт өгдөг байсан:
--   1. project_clients — хуулийн этгээдийн НЭР (8 мөр), нэвтрэх эрхтэй огт
--      холбоогүй шошго.
--   2. users.role='client' + project_members (5 мөр) — нэвтрэх эрх, гэхдээ
--      компанийн ойлголтгүй.
-- Захиалагч талд захирал, ТМ, техникийн хяналт гэсэн хэд хэдэн хүн байдаг,
-- хүн солигддог, компани нь үлддэг.  Тиймээс эрхийг БАЙГУУЛЛАГАД холбоно.
--
-- ⚠️ project_members-ийг УСТГАХГҮЙ.  Тэр хүснэгт дээр 40 гаруй SQL join
--    тогтдог (төслийн жагсаалт, чат, албан бичиг, APS, тайлан).  Эрх олгох
--    үед routes/clientAdmin.ts-ийн syncOrgMembership() нь тухайн байгууллагын
--    хүмүүсийг project_members-т ТУСГАНА — өгөгдлийн эх сурвалж нь энэ
--    хүснэгтүүд, project_members нь түүний ТУСГАЛ.

CREATE TABLE IF NOT EXISTS client_orgs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  registry_no  TEXT,
  logo_url     TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Хүн ↔ байгууллага.  Нэг хүн олон байгууллагыг төлөөлж болно (зөвлөх).
CREATE TABLE IF NOT EXISTS client_contacts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES client_orgs(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_role TEXT NOT NULL DEFAULT 'viewer' CHECK(contact_role IN ('owner','pm','viewer')),
  invited_by   INTEGER REFERENCES users(id),
  invited_at   TEXT,
  accepted_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, user_id)
);

-- Байгууллага ↔ төсөл.  revoked_at нь мөрийг устгахгүйгээр эрхийг хаана —
-- «хэзээ хаагдсан» нь маргаанд хэрэгтэй баримт.
CREATE TABLE IF NOT EXISTS project_client_access (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id       INTEGER NOT NULL REFERENCES client_orgs(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'viewer' CHECK(access_level IN ('viewer','contributor','approver')),
  granted_by   INTEGER REFERENCES users(id),
  granted_at   TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at   TEXT,
  UNIQUE(project_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_client_contacts_user ON client_contacts(user_id);

CREATE INDEX IF NOT EXISTS idx_pca_org ON project_client_access(org_id);

CREATE INDEX IF NOT EXISTS idx_pca_project ON project_client_access(project_id);

-- Паспортын дээрх нэрийг порталын байгууллагатай холбоно.  NULL хэвээр
-- үлдэж болно — хуучин мөрүүд гараар бичсэн нэр.
ALTER TABLE project_clients ADD COLUMN org_id INTEGER REFERENCES client_orgs(id);
