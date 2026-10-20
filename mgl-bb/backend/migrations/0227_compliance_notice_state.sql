-- =============================================================
-- 0227_compliance_notice_state.sql — МЭДЭГДЛИЙН ТӨЛӨВ (dedup / ack / snooze)
-- =============================================================
-- ЗОРИЛГО: v2 §76-ын долоон хяналт (severity threshold, duplicate suppression,
--   repeated-warning suppression, acknowledgement, snooze, grouping, finding
--   deduplication) -ийн ХАДГАЛАЛТЫН тал.  Revit дахин асахад хэрэглэгчийн
--   «ойлголоо» гэсэн хариу АЛГА болох ЁСГҮЙ — тиймээс төлөв нь серверт байна,
--   `%APPDATA%`-д БИШ.
--
-- ⚠️ dedup_key = sha256(rule_uid || 0x00 || element_uid)-ийн эхний 16 тэмдэгт.
--   `ruleset_version` нь ТҮЛХҮҮРТ ОРОХГҮЙ, ХАЖУУД нь БАГАНА байна.
--   ЯАГААД: багц дахин нийтлэх бүрд түлхүүр өөрчлөгдвөл БҮХ ack компанийн
--   хэмжээнд өнчирч, тоолуур эхний өдрийн утга руугаа буцаж, CRITICAL суваг
--   хүмүүсийн аль хэдийн хаясан мөр дээр ДАХИН асна.  Гэтэл багц дахин
--   нийтлэх нь LEVEL 0 → 1 → 2 ахиулалтын ҮНДСЭН үйлдэл — өөрөөр хэлбэл
--   бүтээгдэхүүнийг ажиллуулах үйлдэл өөрөө §76-ын ядаргааг үүсгэнэ.
--   Ack нь ЗӨВХӨН тухайн дүрмийн `semantic_hash` өөрчлөгдөхөд хүчингүй болно.
--
-- ⚠️ REFERENCES АЛГА.  `user_id` дээр ч гэсэн: BIM-ийн залгамал хүснэгтүүдийн
--   хажууд ON DELETE SET NULL нь хүүхдийн UPDATE болж хувирч, append-only
--   trigger-ийг асааж, ЭЦГИЙН DELETE-ийг БҮХЭЛД НЬ ABORT хийдэг (1B-1 §2.6-д
--   хэмжсэн).  Хүүхдийг гараар устгах нь энэ репогийн уламжлал.
--
-- ⚠️ SELF-VIEW-ONLY.  Мөр бүр `user_id`-тай — унших маршрут бүр
--   `user_id = viewer.sub` эсвэл АГРЕГАТ байна.  Хүн тус бүрийн зөрчлийн
--   тоо ХААНА Ч, АДМИНД Ч рендерлэгдэхгүй.
-- ⚠️ ТЭЭВЭР: 4 statement (<= 9), блок тайлбаргүй, мөрөн дотор цэг таслал АЛГА

CREATE TABLE IF NOT EXISTS compliance_notice_state (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  dedup_key        TEXT    NOT NULL,
  state            TEXT    NOT NULL DEFAULT 'new'
                   CHECK (state IN ('new','shown','acknowledged','snoozed','dismissed')),
  severity         TEXT    NOT NULL DEFAULT 'INFO'
                   CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  rule_uid         TEXT,
  rule_version     INTEGER,
  ruleset_version  TEXT,
  ack_rule_version INTEGER,
  team_code        TEXT,
  doc_uid          TEXT,
  root_dedup_key   TEXT,
  shown_count      INTEGER NOT NULL DEFAULT 0,
  first_shown_at   TEXT,
  last_shown_at    TEXT,
  ack_at           TEXT,
  snooze_until     TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cns_user_key
  ON compliance_notice_state (user_id, dedup_key);

CREATE INDEX IF NOT EXISTS idx_cns_user_state
  ON compliance_notice_state (user_id, state, severity);

CREATE INDEX IF NOT EXISTS idx_cns_snooze
  ON compliance_notice_state (snooze_until)
  WHERE snooze_until IS NOT NULL;
