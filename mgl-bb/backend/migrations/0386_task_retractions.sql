-- «ТАСКИЙГ БУЦААХ» (эзэн 2026-10-05) — буруу таск авч, буруу хувь оруулсан хүн тэр таскийг «би үүн дээр юу ч хийгээгүй»
-- болгож буцаана:
--   • миний оруулсан явцын бичлэг + тэдгээрийн оноо УСТАНА (архив энэ хүснэгтэд);
--   • би таскийн нэр/«Миний ажлууд»-аас, бусдын харагдацаас (хувь нэмэрч) алга болно;
--   • харин албан таймерын СЭШН (цаг) УСТАХГҮЙ — систем цагийг үргэлжлүүлэн хэмжинэ; дахин авбал хуучин цаг дээрээ
--     нэмэгдэнэ.  Таск талын харагдацууд (хувь нэмэрч, таскийн нийт цаг) `retracted_at`-аас ӨМНӨ эхэлсэн сэшнийг
--     харуулахгүй (`NOT EXISTS task_retractions r WHERE r.retracted_at >= s.started_at`).
-- Нэг мөр = нэг «Буцаах» үйлдэл.  users/tasks руу FK ЗОРИУД байхгүй (D1 runtime-д хэрэгжүүлдэггүй) — `DELETE /users/:id` ба
-- таск устгахад гараар цэвэрлэнэ.  Нэмэлт миграц — хуучин worker үл тооно.

CREATE TABLE IF NOT EXISTS task_retractions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  -- UTC ISO (`…Z`) — `task_timer_sessions.started_at`-тай ЯГ ИЖИЛ хэлбэр (мөр харьцуулна).
  retracted_at   TEXT    NOT NULL,
  -- Устгасан `progress_entries` / `user_points` мөрүүд (аудит, шаардлагатай бол гараар сэргээнэ).
  entries_json   TEXT    NOT NULL,
  points_json    TEXT    NOT NULL,
  progress_before REAL,
  progress_after  REAL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_retractions_user_task ON task_retractions (user_id, task_id, retracted_at);
