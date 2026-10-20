-- 0410 — Програмын хүсэлт (engineering feedback): хандах эрхийн суурь (2026-10-16).
--
-- «Програмын хүсэлтүүд» inbox-ыг ЗӨВХӨН нэг баталгаажсан хүн (Software Engineer) уншина.  Энэ нь глобал
-- UserRole БИШ — users хүснэгтийн role CHECK-ийг хөндөхгүй (users-ийг rebuild хийх нь 19 cascade хүүхэдтэй
-- path-B ажил), тусдаа capability гишүүнчлэл + тохируулсан reviewer binding:
--
--   • access_capabilities — сервер удирдах эрх (одоогоор зөвхөн 'software_engineer').  Мөр устгахгүй:
--     цуцлахад revoked_at.  granted_by NULL = миграц/CLI bootstrap.  Хүн өөртөө эрх олгохыг CHECK хаана.
--   • engineering_feedback_reviewer_binding — tenant (= энэ D1) тутамд ГАНЦ reviewer (id = 1).  user_id +
--     username + employee_id гурвуулаа users-ийн одоогийн мөртэй тулгагдах ёстой — нэр/албан тушаалаар
--     ХЭЗЭЭ Ч биш.  Аль нэг нь зөрвөл inbox хаалттай (fail-closed).
--
-- Дүрэм ГАНЦ газар: backend/src/lib/engineeringFeedbackAccess.ts.  Inbox-ийн бүх зам (жагсаалт, тоо, дэлгэрэнгүй,
-- хавсралт, экспорт, триаж) тэр функцээр шалгагдана — admin-д далд эрх БАЙХГҮЙ.
-- users руу FK ЗОРИУД байхгүй (D1 runtime-д хэрэгжүүлдэггүй): хэрэглэгч устсан бол binding тулгагдахгүй → хаалттай.

CREATE TABLE IF NOT EXISTS access_capabilities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  capability  TEXT    NOT NULL,
  granted_by  INTEGER,
  granted_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  revoked_at  TEXT,
  revoked_by  INTEGER,
  note        TEXT,
  CHECK (granted_by IS NULL OR granted_by <> user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_access_capabilities_active
  ON access_capabilities (user_id, capability) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS engineering_feedback_reviewer_binding (
  id           INTEGER PRIMARY KEY CHECK (id = 1),
  user_id      INTEGER NOT NULL,
  username     TEXT    NOT NULL,
  employee_id  TEXT    NOT NULL,
  bound_by     TEXT    NOT NULL,
  bound_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  evidence     TEXT
);
