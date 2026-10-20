-- 0376 — ТАСКИЙН ХУВААРИЛАЛТ: үндсэн ажил (root) + оролцогч бүрийн хуваарилалт (эзний шийдвэр 2026-10-02), 1/4.
--
-- Нэг таск = НЭГ «үндсэн ажил» (`tasks.id`).  Хуваахад шинэ таск ҮҮСЭХГҮЙ, дотоод жин
-- (`tasks.weight_percent`) ӨӨРЧЛӨГДӨХГҮЙ — оролцогч бүрт хуваарилалт мөр үүснэ.  Бүх хэмжээ
-- ҮНДСЭН АЖЛЫН хувиар, бүхэл нэгжээр: 1 пункт (1%) = 10 000 нэгж, бүтэн ажил = 1 000 000
-- (backend/src/lib/taskUnits.ts).
--
--   task_roots        — managed болсон таск бүрд нэг мөр.  `revision` нь бүх мутацийн CAS
--                       (хоёр хүн зэрэг хадгалах, дахин оролдлого, хуучирсан дэлгэц).
--                       unattributed_units = B — эзэн нь баталгаагүй хуучин хийсэн (түгжигдсэн);
--                       unallocated_units  = U — хуваарилагдаагүй ирээдүйн ажил;
--                       slack_units — хуучин HWM-д төлөгдсөн атлаа одоо хүчинтэй биш нэгж
--                       (шинэ хийсэн хэсэг эхлээд үүнийг дүүргэж, давхар төлөхгүй).
--                       next_ordinal — хэсгийн дугаар (17.1, 17.2 …) НЭГ удаа олгогдож дахин ашиглагдахгүй.
--   task_allocations  — (root, хэрэглэгч) бүрт нэг мөр: T = target_units (хийсэн + хийх),
--                       D = done_units (одоо хүчинтэй хийсэн), L = floor_units (хуваалт засахад түгжигдсэн
--                       хийсэн; ердийн «−» үүнээс доош орохгүй), released_units = сүүлд буцаасан
--                       ирээдүйн ажил (дахин авахад санал болгоно).  0 ≤ L ≤ D ≤ T ≤ 100.
--
-- Инвариант (Σ T + B + U = 100) нь SQL-д БИШ, цэвэр дүрэмд (`checkRootInvariants`) шалгагдана.
-- users/tasks руу FK ЗОРИУД байхгүй (D1 runtime-д хэрэгжүүлдэг эсэх нь баримтуудад зөрчилтэй) —
-- устгалыг routes/projects.ts, routes/users.ts гараар хийнэ.  Бүгд нэмэлт: хуучин worker шинэ
-- хүснэгтийг үл тоож ажилласаар байна.

CREATE TABLE IF NOT EXISTS task_roots (
  task_id            INTEGER PRIMARY KEY,
  revision           INTEGER NOT NULL DEFAULT 1,
  unattributed_units INTEGER NOT NULL DEFAULT 0 CHECK (unattributed_units BETWEEN 0 AND 1000000),
  unallocated_units  INTEGER NOT NULL DEFAULT 0 CHECK (unallocated_units BETWEEN 0 AND 1000000),
  slack_units        INTEGER NOT NULL DEFAULT 0 CHECK (slack_units >= 0),
  next_ordinal       INTEGER NOT NULL DEFAULT 1,
  seed_attribution   TEXT,
  seed_json          TEXT,
  completed_at       TEXT,
  created_by         INTEGER,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_allocations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  ordinal        INTEGER NOT NULL,
  target_units   INTEGER NOT NULL DEFAULT 0 CHECK (target_units BETWEEN 0 AND 1000000),
  done_units     INTEGER NOT NULL DEFAULT 0 CHECK (done_units >= 0),
  floor_units    INTEGER NOT NULL DEFAULT 0 CHECK (floor_units >= 0),
  released_units INTEGER NOT NULL DEFAULT 0 CHECK (released_units >= 0),
  revision       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (floor_units <= done_units AND done_units <= target_units),
  UNIQUE (task_id, user_id),
  UNIQUE (task_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_task_allocations_user ON task_allocations (user_id);
