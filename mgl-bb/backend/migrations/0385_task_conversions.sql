-- 0385 — ХУУЧИН ТАСКИЙН БҮЛГИЙГ ХУВААРИЛАЛТ (managed root) РУУ ХӨРВҮҮЛЭХ ЖУРНАЛ (2026-10-05).
--
-- Хуучин загварт нэг ажлыг хэд хэдэн таск болгон хуваасан (хуулбар таск, ROOT бүлэг + дэд таск).  Шинэ загвар нэг root
-- таск + хүн бүрийн хуваарилалт.  Хөрвүүлэлт (backend/src/lib/taskConversion.ts): бүлгийн нэг таск root болж жингээ
-- бүлгийн нийлбэр W болгоно, бусад таск «нэгтгэгдсэн хэсэг» (жин 0) болж түүх нь хэвээр үлдэнэ.  Төслийн явц, оноо ӨӨРЧЛӨГДӨХГҮЙ.
--
--   task_conversions         — хөрвүүлэлт бүр нэг мөр (append-only, status зөвхөн applied → reverted): хэн, хэзээ, ямар нотолгоогоор,
--                              ямар төлөвлөгөөгөөр (plan_json нь БҮТЭН before/after), төслийн явц өмнө/хойно.  id = request_id.
--   task_conversion_members  — бүлгийн таск бүр нэг мөр: root (role = root) эсвэл нэгтгэгдсэн хэсэг (role = retired) ба
--                              өмнөх нэр/жин/хугацаа (буцаахад сэргээнэ).  task_id PRIMARY KEY — нэг таск нэг л идэвхтэй хөрвүүлэлтэд.
--
-- users/tasks руу FK ЗОРИУД байхгүй (D1 runtime-д хэрэгжүүлдэггүй, гараар устгана).  Нэмэлт миграц — хуучин worker үл тооно.

CREATE TABLE IF NOT EXISTS task_conversions (
  id             TEXT PRIMARY KEY,
  root_task_id   INTEGER NOT NULL,
  project_id     INTEGER NOT NULL,
  drawing_id     INTEGER NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reverted')),
  evidence       TEXT    NOT NULL,
  classification TEXT    NOT NULL,
  plan_hash      TEXT    NOT NULL,
  reason         TEXT,
  actor_id       INTEGER,
  plan_json      TEXT    NOT NULL,
  rollup_before  REAL    NOT NULL,
  rollup_after   REAL    NOT NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  reverted_at    TEXT,
  reverted_by    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_task_conversions_root ON task_conversions (root_task_id);

CREATE TABLE IF NOT EXISTS task_conversion_members (
  task_id           INTEGER PRIMARY KEY,
  conversion_id     TEXT    NOT NULL,
  role              TEXT    NOT NULL CHECK (role IN ('root', 'retired')),
  name_before       TEXT    NOT NULL,
  weight_before     REAL    NOT NULL,
  weight_after      REAL    NOT NULL,
  due_date_before   TEXT,
  start_date_before TEXT,
  latest_pct        REAL    NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_task_conv_members_conv ON task_conversion_members (conversion_id);
