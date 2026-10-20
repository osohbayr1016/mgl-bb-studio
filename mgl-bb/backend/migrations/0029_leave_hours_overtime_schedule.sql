-- =============================================================
-- Hour-granular чөлөө + Илүү цагийн хүсэлт + Ажилтны цагийн
-- хуваарь + Хоцролт минутаар тооцох.
--
-- Үндсэн зорилго:
--   1) Хагас өдөр / 4 цаг / 2 цаг гэх мэт нарийвчилсан чөлөөг
--      `leave_requests.hours` баганаар хадгалъя.  Хуучин мөрүүд
--      `days * 8` томъёогоор backfill хийгдэнэ (8 цагийн ажлын
--      өдөр гэж үздэг).
--
--   2) Илүү цагаар ажилласан хүсэлтийг тусдаа `overtime_requests`
--      хүснэгтэд хадгална. Бичлэгийн structure нь leave-тэй
--      төстэй (request → approve/reject ажлын урсгал) тул UI/CRUD
--      кодыг хуулж бичсэн.
--
--   3) Ажилтан өөрийн ажлын цагийн хуваарь (08:00–17:00 эсвэл
--      09:00–18:00) сонгох боломжтой.  Хоцролтыг тус хуваарийн
--      эхэн цагтай харьцуулж тооцно.
--
--   4) `attendance_sessions.late_minutes` багана нэмж хадгалснаар
--      хоцорсон минут × 500 ₮ торгуулийн нэгтгэлийг хурдан гаргана.
--
-- Зориуд хязгаарласан зүйл:
--   - Торгуулийн хувь (1 минут = 500 ₮) кодоор тогтоосон
--     (LATE_PENALTY_PER_MINUTE).  Дараа нь `app_settings` гэж
--     гаргахаар тааруулсан.
-- =============================================================

-- 1. Чөлөөнд цагаар нарийвчилсан мэдээлэл нэмье ──────────────────
ALTER TABLE leave_requests ADD COLUMN hours REAL;

UPDATE leave_requests
SET hours = ROUND(days * 8, 2)
WHERE hours IS NULL;

-- 2. Ажилтан өөрийн цагийн хуваариа сонгох ───────────────────────
--    'standard' = 09:00–18:00 (anhandifolt)
--    'early'    = 08:00–17:00
ALTER TABLE users ADD COLUMN work_schedule TEXT NOT NULL DEFAULT 'standard'
  CHECK(work_schedule IN ('standard', 'early'));

-- 3. Хоцорсон минутыг ирцийн мөрөнд хадгалъя ─────────────────────
--    Хоцролтыг clock-in хийх үед тооцоод бичих тул дараа нь
--    дахин агрегац хийх шаардлагагүй болно.
ALTER TABLE attendance_sessions ADD COLUMN late_minutes INTEGER NOT NULL DEFAULT 0;

-- 4. Илүү цагийн хүсэлтийн хүснэгт ────────────────────────────────
CREATE TABLE IF NOT EXISTS overtime_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Илүү цаг ажилласан огноо (нэг өдөртэй холбогддог)
  work_date       TEXT    NOT NULL,
  -- Хичнээн цаг ажилласан (REAL — 1.5, 2, 3.5 г.м.)
  hours           REAL    NOT NULL DEFAULT 1,
  -- Эхлэх / дуусах цагийг сонголтоор оруулна
  start_time      TEXT,
  end_time        TEXT,
  reason          TEXT,
  attachment_url  TEXT,
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewer_id     INTEGER REFERENCES users(id),
  reviewer_note   TEXT,
  decided_at      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_overtime_user      ON overtime_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_overtime_status    ON overtime_requests(status);
CREATE INDEX IF NOT EXISTS idx_overtime_work_date ON overtime_requests(work_date);
