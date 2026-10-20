-- =============================================================
-- 0295_mgl_ai_fleet.sql — MGL AI · ФЛОТ (ажилтны PC-ийн суулгац) ба РЕЛИЗИЙН МАНИФЕСТ
-- =============================================================
-- Session B (employee deployment).  Дугаарын блок 0295-0299 (0290-0294-өөс шилжсэн 2026-09-14 — 0290 нь main-ийн progress_latest_indexes-тэй мөргөлдсөн):
-- зэрэгцээ Session A (норматив) 0282+ авч болзошгүй.
--
-- ⚠️ ЯАГААД `ai_runtime_installs` (0270) БИШ ВЭ.  Тэр хүснэгт `hostname`,
--    `cpu` авдаг, health/суваг/телеметрийн түвшин мэддэггүй, мөн ХЭМЖСЭН:
--    2026-09-11 хүртэл ai/ ба frontend/ дотор НЭГ Ч ДУУДАГЧГҮЙ (heartbeat
--    хэзээ ч илгээгдээгүй) — тиймээс хоосон.  Шинэ хүснэгт нь хостын нэр
--    АВАХГҮЙ (§16), install_id нь санамсаргүй UUID (хардверийн хээ биш).
--    Хуучныг хөндөхгүй, устгахгүй.
--
-- ⚠️ `versions_json` НЬ БҮРЭЛДЭХҮҮН ТУС БҮРИЙН хувилбар (app/runtime/model/
--    knowledge/normRegistry/revit).  Ганц `version` багана ЗОРИУД байхгүй —
--    §5: суулгац нь ганц хувилбартай биш.
--
-- ⚠️ `telemetry_level_override` нь АДМИНЫ дарах утга — heartbeat-ийн хариугаар
--    ажилтны машин руу буцна (түр DEBUG асаах зам).  NULL = ажилтны өөрийн.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 5 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_fleet_devices (
  installation_id           TEXT    PRIMARY KEY,
  user_id                   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  channel                   TEXT    NOT NULL DEFAULT 'stable' CHECK (channel IN ('admin','canary','stable')),
  channel_override          TEXT    CHECK (channel_override IN ('admin','canary','stable')),
  telemetry_level           TEXT    NOT NULL DEFAULT 'MINIMAL' CHECK (telemetry_level IN ('OFF','MINIMAL','QUALITY','DEBUG')),
  telemetry_level_override  TEXT    CHECK (telemetry_level_override IN ('OFF','MINIMAL','QUALITY','DEBUG')),
  hardware_class            TEXT,
  hardware_json             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(hardware_json)),
  versions_json             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(versions_json)),
  release_id                TEXT,
  last_known_good_release   TEXT,
  health_status             TEXT    CHECK (health_status IN ('READY','DEGRADED','REPAIR_REQUIRED','UPDATING','UNKNOWN')),
  health_facets_json        TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(health_facets_json)),
  health_reasons_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(health_reasons_json)),
  update_json               TEXT    CHECK (update_json IS NULL OR json_valid(update_json)),
  latency_json              TEXT    CHECK (latency_json IS NULL OR json_valid(latency_json)),
  crash_json                TEXT    CHECK (crash_json IS NULL OR json_valid(crash_json)),
  runtime_uptime_s          INTEGER,
  heartbeat_count           INTEGER NOT NULL DEFAULT 0,
  first_seen_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at              TEXT    NOT NULL DEFAULT (datetime('now')),
  note                      TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_fleet_user ON ai_fleet_devices (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_fleet_seen ON ai_fleet_devices (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS ai_release_manifests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id    TEXT    NOT NULL UNIQUE,
  channel       TEXT    NOT NULL DEFAULT 'admin' CHECK (channel IN ('admin','canary','stable')),
  status        TEXT    NOT NULL DEFAULT 'CANDIDATE'
                  CHECK (status IN ('CANDIDATE','APPROVED','CANARY','STABLE','ROLLED_BACK','ARCHIVED')),
  manifest_json TEXT    NOT NULL CHECK (json_valid(manifest_json)),
  notes         TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  approved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at   TEXT,
  promoted_at   TEXT,
  rolled_back_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_release_manifest_status ON ai_release_manifests (status, channel, created_at DESC);
