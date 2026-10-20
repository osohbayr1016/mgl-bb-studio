-- 0330_internal_rules.sql
-- Дотоод журам — ажилтан уншиж, танилцсанаа ГАРЫН ҮСГЭЭР баталгаажуулна
-- (эзний хүсэлт 2026-09-21).  Гарын авлага (0172) нь role x түвшний
-- зөвлөмж бөгөөд уншилтын бүртгэлгүй; энэ нь тусдаа модуль.
--
-- Гурван хүснэгт, ГУРВАН ҮҮРЭГ:
--   internal_rules           -- админы АЖЛЫН ХУВЬ.  title/body чөлөөтэй
--                               засагдана, ажилтан үүнийг ХЭЗЭЭ Ч уншихгүй.
--   internal_rule_versions   -- НИЙТЛЭГДСЭН АГШИН (append-only).  Ажилтан
--                               `internal_rules.current_version_id`-г уншина.
--                               Хуучин хувилбар устахгүй: гарын үсэг нь
--                               «тэр өдөр ЭНЭ бичвэрт» гэсэн түүх.
--   internal_rule_signatures -- (version_id x user_id) НЭГ гарын үсэг.
--                               Бичвэр өөрчлөгдөж дахин нийтлэгдвэл шинэ
--                               version_id -> бүгд ДАХИН зурна.
--
-- signature_key    -- ХУВИЙН MEETING_BUCKET дахь хуулбар
--                     (`rule-signatures/<rule>/<version>-<user>-<ms>-<rand>.png`).
--                     Профайлын /media/ объект руу заадаггүй: тэр нь нийтийн
--                     bucket бөгөөд ажилтан гарын үсгээ солиход
--                     lib/mediaReplace.ts хуучныг УСТГАДАГ.
-- signature_sha256 -- хуулбарын байтын хэш (бүрэн бүтэн байдал).
-- content_hash     -- хувилбарын бичвэрийн SHA-256-ийн хуулбар — version_id
--                     мартагдсан ч ЯГ ямар бичвэрт зурсныг нотолно.
-- user_id          -- users.id.  REFERENCES ЗОРИУД БАЙХГҮЙ (0279/0329-тэй
--                     ижил шалтгаан): users-т FK ирмэг нэмэх нь path-B
--                     rebuild + DELETE /api/users/:id-ийн гар устгалд мөр
--                     нэмнэ.  Нэрийг LEFT JOIN-оор уншина.
-- signed_at        -- ISO UTC, серверийн цаг.
CREATE TABLE IF NOT EXISTS internal_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_mn TEXT NOT NULL,
  title_en TEXT,
  body_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  current_version_id INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS internal_rule_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES internal_rules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title_mn TEXT NOT NULL,
  title_en TEXT,
  body_md TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  published_by_id INTEGER,
  published_at TEXT NOT NULL,
  UNIQUE (rule_id, version)
);
CREATE TABLE IF NOT EXISTS internal_rule_signatures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES internal_rules(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES internal_rule_versions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  signature_key TEXT NOT NULL,
  signature_sha256 TEXT NOT NULL,
  signature_source TEXT NOT NULL DEFAULT 'profile',
  signed_at TEXT NOT NULL,
  user_agent TEXT,
  UNIQUE (version_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_internal_rule_versions_rule
  ON internal_rule_versions(rule_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_internal_rule_signatures_user
  ON internal_rule_signatures(user_id, signed_at DESC);
CREATE INDEX IF NOT EXISTS idx_internal_rule_signatures_rule
  ON internal_rule_signatures(rule_id, version_id);
