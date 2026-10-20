-- 0413 — Програмын хүсэлт: түүх (append-only) ба засварын хувилбар (2026-10-16).
--
--   • engineering_request_events — төлөв, ач холбогдол, давхардал, тэмдэглэл, хариу, retest бүр нэг мөр.
--     visibility = 'private' (инженерийн дотоод тэмдэглэл — илгээгч, мэдэгдлийн preview-д ХЭЗЭЭ Ч орохгүй)
--     эсвэл 'sender' (илгээгчид харагдах хариу/төлөв).  Мөр засварлагдахгүй, устгагдахгүй.
--   • engineering_request_fixes — засвар орсон БОДИТ хувилбар Revit оноор (2024, 2027 тусдаа) + commit/PR.
--     Хувилбарын дугаар өссөн гэж хүсэлтийг автоматаар хаахгүй — илгээгч «Бэлэн засварыг шалгах»-аар батална.

CREATE TABLE IF NOT EXISTS engineering_request_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id     TEXT    NOT NULL,
  actor_user_id  INTEGER,
  actor_role     TEXT    NOT NULL,
  kind           TEXT    NOT NULL,
  visibility     TEXT    NOT NULL,
  from_value     TEXT,
  to_value       TEXT,
  body           TEXT,
  meta_json      TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_engineering_request_events_request
  ON engineering_request_events (request_id, id);

CREATE TABLE IF NOT EXISTS engineering_request_fixes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id     TEXT    NOT NULL,
  revit_year     INTEGER,
  fixed_version  TEXT,
  commit_sha     TEXT,
  pr_url         TEXT,
  note           TEXT,
  linked_by      INTEGER NOT NULL,
  linked_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  removed_at     TEXT
);

CREATE INDEX IF NOT EXISTS ix_engineering_request_fixes_request
  ON engineering_request_fixes (request_id);
