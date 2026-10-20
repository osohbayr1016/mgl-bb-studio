-- 0310 — Ажилтны ӨДРИЙН АВТОМАТ snapshot («Тайлан» хуудас, /api/reports).
--
-- Яагаад хэрэгтэй вэ: бүтээмжийн самбарын БАЙР (rank) хэзээ ч DB-д бичигддэггүй —
-- `ORDER BY SUM(user_points.amount)`-ийн индекс л байдаг.  «7 хоногийн өмнө
-- хэддүгээрт байсан бэ» гэдэг ХАРЬЦАНГУЙ хэмжигдэхүүнийг дараа нь сэргээхэд
-- `recalculateProjectPoints` ledger-ийг дахин бичсэн байж болно.  Тиймээс
-- rank_* / pool_size / team_id нь ЗААВАЛ энд хадгалагдана; бусад багана нь
-- user_points / progress_entries / attendance_sessions-оос дахин бодогдох
-- хямд хуулбар (timeline таб, sparkline нэг индексжсэн уншилтаар гарна).
--
-- Бичигч: lib/employeeSnapshot.ts (cron, УБ 02:00-ийн дараа ӨЧИГДРИЙГ) ба
-- POST /api/reports/snapshots/backfill (түүх нөхөх).  `date` нь УБ огноо.
-- rank_* NULL = тэр өдөр самбарын гишүүн байгаагүй (admin, is_support, идэвхгүй).
CREATE TABLE IF NOT EXISTS employee_daily_snapshots (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date             TEXT    NOT NULL,
  points_day       REAL    NOT NULL DEFAULT 0,
  points_7d        REAL    NOT NULL DEFAULT 0,
  points_30d       REAL    NOT NULL DEFAULT 0,
  rank_7d          INTEGER,
  rank_30d         INTEGER,
  pool_size        INTEGER,
  entries_count    INTEGER NOT NULL DEFAULT 0,
  tasks_touched    INTEGER NOT NULL DEFAULT 0,
  tasks_completed  INTEGER NOT NULL DEFAULT 0,
  repair_hours     REAL    NOT NULL DEFAULT 0,
  present          INTEGER NOT NULL DEFAULT 0,
  hours_worked     REAL    NOT NULL DEFAULT 0,
  late_minutes     INTEGER NOT NULL DEFAULT 0,
  on_leave         INTEGER NOT NULL DEFAULT 0,
  is_free_day      INTEGER NOT NULL DEFAULT 0,
  team_id          INTEGER,
  source           TEXT    NOT NULL DEFAULT 'cron',
  computed_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_eds_date ON employee_daily_snapshots(date);
