-- 0361 — АЛБАН ЁСНЫ ТАСКИЙН ЦАГ ХЭМЖИГЧ (OFFICIAL_TASK_TIMER, захирлын шийдвэр 2026-09-29).
--
-- Ажилтан «Миний ажлууд» дээр таскийнхаа ▶ товчийг ӨӨРӨӨ дарж эхлүүлнэ, ⏸-аар
-- зогсооно, өөр таскийн ▶ дарвал өмнөх нь автоматаар зогсож шинэ нь эхэлнэ.
-- Захирал/админд харагдах АЛБАН ЁСНЫ цаг ЗӨВХӨН энэ хүснэгтээс.
--
-- ⚠️ Revit-ийн автомат цаг (0360 `revit_work_segments`, REVIT_ACTIVE_TIME) нь
--    ТУСДАА систем — энэ хүснэгттэй хэзээ ч нэмэгдэхгүй, дундажлагдахгүй,
--    нэг нь нөгөөгөө орлохгүй.  Revit-ийн сул зогсолтын дүрэм энд хамаарахгүй.
--
-- task_timer_sessions — нэг мөр = нэг тасралтгүй ажлын хэсэг (эхэлсэн → зогссон).
--   `ended_at IS NULL` = одоо явж буй.  Дууссан мөрийг ХЭЗЭЭ Ч дахин засахгүй;
--   дахин эхлүүлэх нь ШИНЭ мөр.  Бүх цаг нь СЕРВЕРИЙН UTC ISO (…Z) — хөтчийн
--   цаг огт хэрэглэгдэхгүй; «өнөөдөр»-ийг УБ-ын өдрөөр УНШИХДАА тайрна.
--   `duration_ms` = зогсох агшинд бичигдэх (ended_at − started_at), зөвхөн нийлбэр
--   хурдан авахад; үнэн нь хоёр цаг.
--   `start_request_id` / `end_request_id` — нэг сервер хүсэлтийн UUID: сэлгэлтийн
--   хоёр мөрийг (зогссон ↔ эхэлсэн) ба үйл явдлын мөрийг нэг batch дотор холбоно.
--
-- ux_tts_one_running — ⚠️ ХАТУУ ИНВАРИАНТ: нэг ажилтанд ЯГ НЭГ л явж буй мөр.
--   SQLite partial UNIQUE нь pragma-аас үл хамааран үргэлж шалгагдана — давхар
--   даралт, дахин оролдлого, хоёр таб, хоёр компьютер ч хоёр дахь явж буй мөр
--   үүсгэж чадахгүй (кодын шалгалтаас гадна DB-ийн хамгаалалт).
--
-- task_timer_events — append-only аудит: start / pause / switch /
--   auto_stop_completed (таск 100% эсвэл «миний хэсэг дууссан») /
--   auto_stop_deleted (таск устгагдсан).  Сэлгэлт = НЭГ мөр: `session_id` шинэ,
--   `from_session_id`/`from_task_id` зогссон нь («A нь B эхэлсэн тул зогссон»).
--
-- users/tasks руу FK ЗОРИУД байхгүй (users-ийн path-B rebuild-д cascade хүүхэд
-- нэмэхгүй).  DELETE /api/users/:id ба tasks.delete гараар цэвэрлэнэ.

CREATE TABLE IF NOT EXISTS task_timer_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL,
  task_id          INTEGER NOT NULL,
  project_id       INTEGER,
  started_at       TEXT    NOT NULL,
  ended_at         TEXT,
  duration_ms      INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  start_reason     TEXT    NOT NULL DEFAULT 'start' CHECK (start_reason IN ('start', 'switch')),
  end_reason       TEXT    CHECK (end_reason IS NULL OR end_reason IN ('pause', 'switch', 'auto_stop_completed', 'auto_stop_deleted')),
  started_by       INTEGER NOT NULL,
  ended_by         INTEGER,
  start_request_id TEXT    NOT NULL,
  end_request_id   TEXT,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_tts_one_running ON task_timer_sessions (user_id) WHERE ended_at IS NULL;

-- (user_id, task_id) — таскийн нийт цаг.  (user_id, ended_at) — «өнөөдөр» ба
-- нэг хүсэлтийн зогссон мөрийг (`ended_at >= :now AND end_request_id = :req`)
-- бүтэн скангүй олох.  (ended_at) — бүх ажилтны явж буй (IS NULL) ба өнөөдрийн
-- мөр (админы харагдац, таск дууссан үеийн автомат зогсолт).
CREATE INDEX IF NOT EXISTS idx_tts_user_task ON task_timer_sessions (user_id, task_id);

CREATE INDEX IF NOT EXISTS idx_tts_user_ended ON task_timer_sessions (user_id, ended_at);

CREATE INDEX IF NOT EXISTS idx_tts_ended ON task_timer_sessions (ended_at);

CREATE TABLE IF NOT EXISTS task_timer_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  actor_id        INTEGER NOT NULL,
  action          TEXT    NOT NULL CHECK (action IN ('start', 'pause', 'switch', 'auto_stop_completed', 'auto_stop_deleted')),
  session_id      INTEGER NOT NULL,
  task_id         INTEGER NOT NULL,
  from_session_id INTEGER,
  from_task_id    INTEGER,
  at              TEXT    NOT NULL,
  request_id      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tte_user ON task_timer_events (user_id, id);
