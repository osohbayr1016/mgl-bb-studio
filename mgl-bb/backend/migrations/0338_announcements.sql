-- 0338_announcements.sql
-- Нийтийн мэдээлэл — системийн шинэчлэлт, компанийн мэдээлэл, чухал дотоод
-- зарлал.  Админ (зөвхөн admin) HTML агуулгатай (текст · зураг · холбоос ·
-- хэлбэржүүлэлт) мэдээлэл бичиж нийтэлнэ; шаардлагатай бол ажилтан «уншиж
-- танилцлаа» гэж баталгаажуулна, эсвэл профайлын гарын үсгээрээ зурна.
--
-- announcements       -- мэдээлэл өөрөө (draft → published → archived).
--   body_html         -- СЕРВЕР дээр цагаан жагсаалтаар цэвэрлэсэн HTML
--                        (lib/announcements.ts sanitizeHtml); зураг нь /media/<key>.
--   kind              -- system_update | company_info | announcement (шошго л).
--   ack_mode          -- none (уншина л) | confirm (чагт) | signature (гарын үсэг).
--   audience_json     -- NULL = бүх ажилтан; {"roles":[…],"team_ids":[…]} =
--                        зөвхөн тэр role × баг.  Roster/харагдац хоёулаа
--                        нэг предикат (lib/announcements.ts audienceMatches).
--   ack_version       -- «дахин баталгаажуул» гэж нийтлэх бүрд +1; одоогийн
--                        баталгаа = ижил ack_version-тэй мөр.  Хуучин мөр устахгүй.
--   content_hash      -- нийтлэгдсэн гарчиг+биеийн SHA-256; баталгаа хуулж авна.
-- announcement_acks   -- (announcement_id × ack_version × user_id) НЭГ мөр.
--   ack_kind          -- confirm | signature.  signature үед signature_key нь
--                        ХУВИЙН MEETING_BUCKET дахь профайлын гарын үсгийн
--                        хуулбар (`announcement-signatures/…`) — профайлын
--                        объект солигдоход lib/mediaReplace.ts хуучныг устгадаг.
--   user_id           -- users.id.  REFERENCES ЗОРИУД БАЙХГҮЙ (0279/0329/0330-тэй
--                        ижил): users-т FK нэмэх нь path-B rebuild.  DELETE
--                        /api/users/:id энэ хүснэгтийг цэвэрлэхгүй — нэр LEFT JOIN.
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'announcement' CHECK (kind IN ('system_update','company_info','announcement')),
  ack_mode TEXT NOT NULL DEFAULT 'none' CHECK (ack_mode IN ('none','confirm','signature')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  audience_json TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  ack_version INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT,
  published_at TEXT,
  published_by_id INTEGER,
  created_by_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS announcement_acks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  ack_version INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  ack_kind TEXT NOT NULL CHECK (ack_kind IN ('confirm','signature')),
  signature_key TEXT,
  signature_sha256 TEXT,
  acked_at TEXT NOT NULL,
  user_agent TEXT,
  UNIQUE (announcement_id, ack_version, user_id)
);
CREATE INDEX IF NOT EXISTS idx_announcements_status_published
  ON announcements(status, pinned DESC, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcement_acks_user
  ON announcement_acks(user_id, acked_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcement_acks_announcement
  ON announcement_acks(announcement_id, ack_version);
