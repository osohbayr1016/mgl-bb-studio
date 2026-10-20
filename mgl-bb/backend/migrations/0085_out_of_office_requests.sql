-- =============================================================
-- Ажлаас гадуурх цагийн хүсэлт (out-of-office requests)
-- -------------------------------------------------------------
-- Ажилтан ажлын өдрийн дунд албан ажлаар (зохиогчийн хяналт,
-- хурал, бичиг баримт/зураг хүргэх, хичээл г.м.) оффисоос гадуур
-- зарцуулсан цагаа бүртгүүлэх хүсэлт.  Бүтэц нь `overtime_requests`-
-- тэй бараг ижил (нэг work_date + цаг + approve/reject урсгал),
-- ялгаа нь `category` баганаар шалтгааныг ангилдаг.  'other'
-- сонгосон үед `reason`-д гараар бичнэ.
--
-- Чөлөө (leave_requests) / илүү цаг (overtime_requests)-тай ялгаатай
-- бөгөөд тусдаа approve хийгддэг тул timesheet-д давхар тооцогдохгүй.
-- =============================================================

CREATE TABLE IF NOT EXISTS out_of_office_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Гадуур ажилласан огноо (нэг өдөртэй холбогддог)
  work_date       TEXT    NOT NULL,
  -- Шалтгааны ангилал:
  --   author_supervision = Зохиогчийн хяналт
  --   meeting            = Хурал, уулзалт
  --   documents          = Бичиг баримт өгөх, авах
  --   drawings           = Зураг өгөх, авах
  --   class              = Хичээл
  --   other              = Бусад (reason-д гараар бичнэ)
  category        TEXT    NOT NULL DEFAULT 'other'
                  CHECK(category IN ('author_supervision','meeting','documents','drawings','class','other')),
  -- Гадуур байсан хугацаа (REAL — 1.5, 2, 3.5 г.м.)
  hours           REAL    NOT NULL DEFAULT 1,
  -- Эхлэх / дуусах цагийг сонголтоор оруулна (HH:MM)
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

CREATE INDEX IF NOT EXISTS idx_ooo_user      ON out_of_office_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_ooo_status    ON out_of_office_requests(status);
CREATE INDEX IF NOT EXISTS idx_ooo_work_date ON out_of_office_requests(work_date);
