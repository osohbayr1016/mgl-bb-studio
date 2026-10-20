-- =============================================================
-- 0273_mgl_ai_permissions_sync.sql — MGL AI · ЭРХИЙН ПРОФАЙЛ ба СИНК
-- =============================================================
-- ЗОРИЛГО: §24-ийн таван шатны Revit эрх + §11-ийн офлайн шинэлэг байдал.
--
-- ⚠️ МӨР БАЙХГҮЙ = READ_ONLY, «хязгааргүй» БИШ.  Уншигч тал
--    (`lib/mglai/permissions.ts`) энэ өгөгдмөлийг ЦЭВЭР функцээр барина
--    ба тестээр хаагдсан.  Хүснэгт нь ЗӨВХӨН дээшлүүлэлтийг хадгална.
--
-- ⚠️ ХЭРЭГЛЭГЧ ӨӨРИЙГӨӨ ДЭЭШЛҮҮЛЖ ЧАДАХГҮЙ.  Бичих маршрут нь
--    `requireAdmin()`.  `granted_by` нь ХЭЗЭЭ Ч `user_id`-тэй тэнцэхгүй
--    гэсэн CHECK үүнийг өгөгдлийн санд бататгана — админ өөрөө өөртөө
--    FULL_AGENT өгөх нь ч дор хаяж ХОЁР хүн шаардана.
--
-- ⚠️ `roslyn_enabled` нь ТУСДАА, эрхийн шатнаас ХАМААРАЛГҮЙ туг.
--    FULL_AGENT ч дур мэдэн C# ажиллуулахгүй — §23-ийн «Roslyn arbitrary
--    code execution must be developer/admin-only».
--
-- ⚠️ `ai_sync_state` нь ОФЛАЙН МЭДЛЭГИЙН ШИНЭЛЭГ БАЙДАЛ.  Локал кэш нь
--    ажилтны PC дээр байна — энэ хүснэгт нь «сервер юуг хэзээ өгсөн»
--    гэдгийг л хадгална, өгөгдлийг БИШ.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 5 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_permission_profiles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  revit_level       TEXT    NOT NULL DEFAULT 'READ_ONLY'
                      CHECK (revit_level IN ('READ_ONLY','SAFE_WRITE','CONFIRM_EVERY_WRITE','PROJECT_ADMIN','FULL_AGENT')),
  erp_write_enabled INTEGER NOT NULL DEFAULT 0 CHECK (erp_write_enabled IN (0,1)),
  roslyn_enabled    INTEGER NOT NULL DEFAULT 0 CHECK (roslyn_enabled IN (0,1)),
  max_tool_iterations INTEGER NOT NULL DEFAULT 8,
  project_scope_json TEXT   NOT NULL DEFAULT '[]' CHECK (json_valid(project_scope_json)),
  note              TEXT,
  granted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at        TEXT,
  CHECK (granted_by IS NULL OR granted_by <> user_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_perm_level ON ai_permission_profiles (revit_level);

CREATE TABLE IF NOT EXISTS ai_sync_state (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  install_uid    TEXT    NOT NULL,
  dataset_key    TEXT    NOT NULL,
  data_version   TEXT,
  row_count      INTEGER NOT NULL DEFAULT 0,
  bytes          INTEGER NOT NULL DEFAULT 0,
  sensitivity    TEXT    NOT NULL DEFAULT 'internal'
                   CHECK (sensitivity IN ('public','internal','confidential')),
  synced_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT,
  checksum       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sync_key ON ai_sync_state (install_uid, dataset_key);

CREATE INDEX IF NOT EXISTS idx_ai_sync_fresh ON ai_sync_state (dataset_key, synced_at DESC);
