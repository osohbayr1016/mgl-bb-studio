-- 0395 — ТАСКИЙГ ҮНДСЭН ТАСКУУД БОЛГОН ХУВААХ + БУЦААХ (эзэн 2026-10-09).
--
-- «✂ Хуваах» нь таскийг нэр + хувиар ЖИНХЭНЭ шинэ үндсэн таскууд (`tasks` мөр) болгоно — 0394-ийн хүнгүй хэсэг (нэг таск
-- доторх нөөц) ба түүнийг ▶ дарж авахад хоёр хэсэг нэг хүний хуваарилалт болж «A · B» нийлдэг байдлыг солино.
--   • Явцгүй таск: эх таск нь эхний хэсэг болно (id хэвээр, нэр/жин шинэчлэгдэнэ), бусад нь шинэ таск.
--   • Явцтай таск: эх таск «хийгдсэн хэсэг» болж жин нь W × p / 100, системийн 100% бичлэгээр (`source='split'`) хаагдана;
--     үлдсэн W − W·p/100 нь шинэ таскууд болно — төслийн явц ЯГ хэвээр.
-- Энэ хүснэгт нь «буцаах» (`POST /api/tasks/root-splits/:id/undo`)-ийн журнал: юуг яаж сэргээхийг хадгална.  Буцаахад
-- шинэ таскууд устаж (тэдгээр дээр хувь/оноо/хуваарилалт гарсан бол ТАТГАЛЗАНА), эх таск анхны нэр, жин, явцдаа буцна.
-- Мөр устахгүй — `undone_at` л тавигдана (аудит).
--
-- `entry_mark` = хуваах агшинд `progress_entries`-ийн хамгийн их id: эх таск дээр түүнээс хойш бичлэг гарсан бол
-- буцаахаас татгалзана (хэсгийн хувийг бүтэн таскийн хувь гэж уншуулахгүй).
-- FK ЗОРИУД байхгүй (D1 runtime-д хэрэгждэггүй — 0376-ийн жишгээр); `DELETE /api/tasks/:id` гараар цэвэрлэнэ.
-- Шинэ хүснэгт л: хуучин worker үүнийг үл тоож ажилласаар байна.

CREATE TABLE IF NOT EXISTS task_root_splits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id      TEXT    NOT NULL UNIQUE,
  task_id         INTEGER NOT NULL,
  project_id      INTEGER,
  mode            TEXT    NOT NULL,
  orig_name       TEXT    NOT NULL,
  orig_weight     REAL    NOT NULL,
  orig_progress   REAL    NOT NULL DEFAULT 0,
  done_entry_id   INTEGER,
  entry_mark      INTEGER NOT NULL DEFAULT 0,
  actor_id        INTEGER NOT NULL,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  undone_at       TEXT,
  undone_by       INTEGER,
  undo_request_id TEXT    UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_task_root_splits_task ON task_root_splits (task_id);

-- Хуваалтын гишүүд: role = 'part' (шинэ буюу явцгүй үед эх таск) | 'done' (явцтай үед хаагдсан эх таск).
CREATE TABLE IF NOT EXISTS task_root_split_members (
  split_id    INTEGER NOT NULL,
  task_id     INTEGER NOT NULL,
  position    INTEGER NOT NULL,
  role        TEXT    NOT NULL,
  is_original INTEGER NOT NULL DEFAULT 0,
  name        TEXT    NOT NULL,
  weight      REAL    NOT NULL,
  PRIMARY KEY (split_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_root_split_members_task ON task_root_split_members (task_id);
