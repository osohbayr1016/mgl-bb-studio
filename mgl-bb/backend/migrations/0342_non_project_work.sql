-- Төслийн бус ажил (2026-09-24).
--
-- Ажилтан ирц бүртгэхдээ «Төслийн бус ажил» (зохиогчийн хяналт, цаас наах,
-- баримт бичиг янзлах, бусад) сонгож, эхэлсэн/дууссан цагаа бүртгэнэ.  Тэр
-- өдрийн ирц энэ ажлаар тооцогдоно (төсөл сонгох шаардлагыг хангана).
-- Өдрийн төгсгөлд (гарах бүртгэлээс өмнө) яг юу хийснээ `report`-д бичнэ,
-- дараа нь админ шалгаж баталгаажуулна — шалгах дэлгэц нь дараагийн шат.
--
-- Хэлбэр нь `out_of_office_requests` (0085)-тэй ижил: `category` + «Бусад»
-- үед `note`, эхлэх/дуусах цаг, pending/approved/rejected төлөв.
-- ⚠️ `category`-д CHECK ЗОРИУД байхгүй — ангиллын жагсаалт нь
-- `lib/nonProjectWork.ts`-д, шинэ ангилал нэмэх нь миграц шаардахгүй.
-- ⚠️ `minutes` нь цайны цонхтой давхцсан хэсгийг ХАССАН хугацаа (ирцийн
-- `hours_worked`-тэй ижил дүрэм), серверт тооцогдоно — клиентэд итгэхгүй.
-- ⚠️ Төсөл/засварын төсөлтэй ХОЛБООГҮЙ, `daily_active_*`-д ОРОХГҮЙ —
-- `user_id + date`-ээр л ирцтэй холбогдоно.
CREATE TABLE IF NOT EXISTS non_project_work_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  note         TEXT,
  start_time   TEXT    NOT NULL,
  end_time     TEXT    NOT NULL,
  minutes      INTEGER NOT NULL CHECK (minutes > 0),
  report       TEXT,
  reported_at  TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TEXT,
  review_note  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_npw_user_date ON non_project_work_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_npw_status_date ON non_project_work_entries(status, date);
