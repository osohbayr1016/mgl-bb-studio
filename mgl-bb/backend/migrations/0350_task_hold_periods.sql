-- 0350_task_hold_periods.sql — таск дээр зарцуулсан өдрийн ТҮҮХ (2026-09-25)
--
-- Эзний дүрэм: таскийг өөртөө авсан (эсвэл админ оноосон) өдрөөс хойш тэр
-- хүн таск дээр хэдэн АЖЛЫН өдөр зарцуулсныг тоолно.  Таскаа буцаагаад дахин
-- авбал тоолол ТАСРАЛТГҮЙ үргэлжилнэ (7 өдөр ажиллаад буцаасан хүн дахин
-- авбал 8 дахь өдрөөс), буцаасан хугацаа тоологдохгүй.
--
-- Одоогийн эзэмшил нь task_assignees.created_at-аас эхэлдэг тул энд ЗӨВХӨН
-- ДУУССАН хугацаа хадгалагдана: хүн таскаас гарах бүрд (unclaim, unassign,
-- хариуцагч солих) тэр мөрийн created_at -> одоо гэсэн нэг мөр бичигдэнэ.
-- Дүрэм lib/taskHold.ts, бичилт/уншилт lib/taskHoldStore.ts.
--
-- users болон tasks руу FK ЗОРИУД байхгүй (0279/0329-ийн шалтгаан - users-ийн
-- cascade хүүхдийг нэмэгдүүлэхгүй).  tasks.delete гараар цэвэрлэнэ, устсан
-- хэрэглэгчийн мөр хоосон түүх болж үлдэнэ (уншигч хэрэглэгч рүү JOIN хийдэггүй).
-- Огноо нь UTC 'YYYY-MM-DD HH:MM:SS' (datetime('now')).

CREATE TABLE IF NOT EXISTS task_hold_periods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  started_at TEXT    NOT NULL,
  ended_at   TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_hold_periods_task_user ON task_hold_periods(task_id, user_id);

CREATE INDEX IF NOT EXISTS idx_task_hold_periods_user ON task_hold_periods(user_id);
