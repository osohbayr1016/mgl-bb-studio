-- 0364 — Батлагдсан чөлөөтэй ажилтан ажилдаа ирвэл чөлөө нь ИРСЭН ЦАГААР
-- автоматаар богиносно (эзний хүсэлт 2026-09-29).
--
-- Жишээ: 08:00–12:00 чөлөөтэй хүн 09:00-д ирвэл чөлөө 08:00–09:00 (1 цаг)
-- болж, цалин нь ирсэн цагаас бодогдоно.  Эзний хоёр шийдвэр:
--   • олон хоногийн чөлөөнд ЗӨВХӨН ирсэн өдөр богиносно, ирээгүй өдрүүд хэвээр;
--   • өглөөний / бүтэн өдрийн чөлөөтэй хүн ээлжийн эхэнд (эсвэл эрт) ирвэл
--     тэр өдрийн чөлөө 0 цаг болно.
-- Дүрэм `lib/leaveArrivalCut.ts`-д, бичилт `lib/leaveArrivalCutStore.ts`-д.
--
-- `leave_arrival_cuts` — (чөлөө, өдөр) тутамд ГАРГАН АВСАН мөр: ирсэн цаг,
-- тэр өдрийн анхны чөлөөний минут (`full_minutes`), ирсэн цаг хүртэлх
-- үлдсэн минут (`used_minutes`).  Ирцийн бүртгэл өөрчлөгдөх бүрд
-- (`syncLeaveArrivalCuts`) дахин тооцогдоно — устгасан бүртгэл чөлөөг буцаана.
--
-- `leave_requests.arrival_orig_*` — анх батлагдсан утгууд.  NULL = хэзээ ч
-- богиносоогүй.  `arrival_orig_days` нь тэмдэг (days нь NOT NULL тул
-- богиносгосон мөрөнд ҮРГЭЛЖ утгатай).  Мөрийн start_time/end_time/hours/days
-- нь богиносгосон ҮР ДҮН тул бусад бүх уншигч (хүснэгт, нэгтгэл, сарын
-- хязгаар, засварын хуваарилалт) өөрчлөлтгүйгээр зөв утга авна.
ALTER TABLE leave_requests ADD COLUMN arrival_orig_start_time TEXT;
ALTER TABLE leave_requests ADD COLUMN arrival_orig_end_time TEXT;
ALTER TABLE leave_requests ADD COLUMN arrival_orig_hours REAL;
ALTER TABLE leave_requests ADD COLUMN arrival_orig_days REAL;
CREATE TABLE IF NOT EXISTS leave_arrival_cuts (
  leave_id     INTEGER NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  user_id      INTEGER NOT NULL,
  arrival      TEXT    NOT NULL,
  start_time   TEXT    NOT NULL,
  end_time     TEXT    NOT NULL,
  full_minutes INTEGER NOT NULL,
  used_minutes INTEGER NOT NULL CHECK (used_minutes >= 0),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (leave_id, date)
);
CREATE INDEX IF NOT EXISTS idx_leave_arrival_cuts_user_date ON leave_arrival_cuts(user_id, date);
