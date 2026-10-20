-- 0379 — АЛБАН ТАЙМЕРИЙН СЭШНИЙГ ХҮЧИНГҮЙ БОЛГОХ (өөрийн бүртгэлээ засах, эзний шийдвэр 2026-10-02), 4/4.
--
-- Ажилтан ӨӨРИЙН дууссан сэшнийг хүчингүй болгож болно: сэшн УСТАХГҮЙ, түүний бодит `started_at` /
-- `ended_at` ХӨНДӨГДӨХГҮЙ (0361-ийн «дууссан мөр хэзээ ч засагдахгүй» дүрэм) — харин энэ хүснэгтэд
-- мөр бичигдэж, бүх албан цагийн уншигчид (`taskTimerStore.ts`) тэр сэшнийг тооцоонд ОРУУЛАХГҮЙ.
--
--   task_timer_voids     — одоогийн төлөв: сэшн тутамд нэг мөр.  `restored_at IS NULL` = хүчингүй.
--                          Дахин сэргээвэл restored_at бичигдэнэ; дахин хүчингүй болговол мөр шинэчлэгдэнэ.
--   task_timer_void_log  — append-only аудит (void / restore бүр нэг мөр).
--
-- Явж буй сэшнийг хүчингүй болгохоос ӨМНӨ зогсооно (`ux_tts_one_running` void-ыг үл тооно).
-- Цаг ба явц ТУСДАА үйлдэл: цаг хасахад явц/засварын цаг автоматаар устахгүй.

CREATE TABLE IF NOT EXISTS task_timer_voids (
  session_id         INTEGER PRIMARY KEY,
  user_id            INTEGER NOT NULL,
  task_id            INTEGER NOT NULL,
  voided_at          TEXT    NOT NULL,
  voided_by          INTEGER NOT NULL,
  void_request_id    TEXT    NOT NULL,
  restored_at        TEXT,
  restore_request_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_timer_voids_user ON task_timer_voids (user_id, restored_at);

CREATE TABLE IF NOT EXISTS task_timer_void_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  actor_id   INTEGER NOT NULL,
  action     TEXT    NOT NULL CHECK (action IN ('void', 'restore')),
  at         TEXT    NOT NULL,
  request_id TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_timer_void_log_session ON task_timer_void_log (session_id, id);
