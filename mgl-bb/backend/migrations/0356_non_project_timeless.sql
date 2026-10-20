-- Төслийн бус ажил — ЦАГГҮЙ бүртгэл (2026-09-28).
--
-- Эзний шийдвэр: ирцийн цонхонд (өглөө / 14:00 / гарах) төслийн бус ажлыг
-- зөвхөн СОНГОНО, цаг огт оруулахгүй.  Цагийг сонголтоос бодно — өглөө
-- сонгосон ажил 4 цаг, өдөржин (гурвуулаа) сонгосон ажил 8 цаг
-- (дүрэм: backend/src/lib/nonProjectWork.ts deriveTimelessMinutes, сонголт
-- нь 0357-ийн attendance_checkpoint_non_project).  «Миний ажлууд»-аас
-- бүртгэхэд цаг СОНГОЛТТОЙ.
--
-- Тиймээс start_time / end_time NULL байж болно, minutes нь цаггүй мөрөнд
-- ирцийн сонголтоос бодсон утга (сонгогдоогүй бол 0).  Цагтай мөр хуучин
-- дүрмээрээ (minutes > 0, эхлэх ба дуусах хоёулаа бөглөгдсөн).
--
-- ЯАГААД REBUILD ВЭ: 0342-ийн NOT NULL ба CHECK (minutes > 0)-ийг ALTER-аар
-- өөрчлөх боломжгүй.  CREATE new -> INSERT...SELECT -> DROP old -> RENAME.
--
-- ЭНЭ НЬ PATH B ШААРДДАГГҮЙ — ЭНГИЙН migrations apply ЗӨВ (0343-ийн ижил):
--   non_project_work_entries нь ЗӨВХӨН ХҮҮХЭД — users руу заадаг, харин түүн
--   рүү ямар ч хүснэгт FK-аар заадаггүй (user_points.non_project_work_id нь
--   0343-аар FK-ГҮЙ, 0357-ийн сонголтын хүснэгт ч FK-гүй).  2026-09-28-нд
--   09-24-ний prod хуулбар дээр шалгасан: REFERENCES non_project_work_entries
--   гэсэн мөр sqlite_master-т 0.  DROP нь юуг ч каскадаар устгахгүй, файл
--   транзакцаар боогддог тул алдаа гарвал бүгд буцна.
--
-- PRODUCTION-Д АЖИЛЛУУЛАХЫН ӨМНӨ (backend/-ээс):
--   1) Эцэг биш гэдгийг шалгах (0 мөр буцаах ЁСТОЙ):
--      npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT name FROM sqlite_master WHERE name <> 'non_project_work_entries' AND sql LIKE '%REFERENCES non_project_work_entries%'"
--   2) Мөрийн тоог тэмдэглэж, дараа нь тулгах:
--      npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT COUNT(*) n, SUM(minutes) m, MAX(id) mx FROM non_project_work_entries"
--
-- ⚠️ Багануудыг 0342 + 0344-ийн БОДИТ схемээс (09-24-ний prod хуулбарын
--    sqlite_master) хуулсан; INSERT нь баганыг НЭРЭЭР жагсаана.
-- ⚠️ sqlite_sequence: DROP нь seq-ийг MAX(id) болгоно — устгасан (зөвхөн
--    pending, оноогүй) мөрийн id дахин олгогдож болох ч user_points-д тэр id
--    хэзээ ч байгаагүй тул нийцэл алдагдахгүй.
-- ⚠️ ≤ 9 statement (wrangler-ийн бүртгэлийн INSERT-ийг оролцуулаад): 6 + 1.

CREATE TABLE non_project_work_entries_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  category     TEXT    NOT NULL,
  note         TEXT,
  start_time   TEXT,
  end_time     TEXT,
  minutes      INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  report       TEXT,
  reported_at  TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TEXT,
  review_note  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  daily_rate   REAL,
  rate_source  TEXT,
  computed_pct REAL,
  CHECK ((start_time IS NULL) = (end_time IS NULL)),
  CHECK (start_time IS NULL OR minutes > 0)
);

INSERT INTO non_project_work_entries_new
  (id, user_id, date, category, note, start_time, end_time, minutes, report, reported_at,
   status, reviewed_by, reviewed_at, review_note, created_at, updated_at,
   daily_rate, rate_source, computed_pct)
SELECT
   id, user_id, date, category, note, start_time, end_time, minutes, report, reported_at,
   status, reviewed_by, reviewed_at, review_note, created_at, updated_at,
   daily_rate, rate_source, computed_pct
FROM non_project_work_entries;

DROP TABLE non_project_work_entries;

ALTER TABLE non_project_work_entries_new RENAME TO non_project_work_entries;

CREATE INDEX IF NOT EXISTS idx_npw_user_date ON non_project_work_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_npw_status_date ON non_project_work_entries(status, date);
