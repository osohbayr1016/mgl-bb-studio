-- 0383 — ТАСКИЙН ХУВААРИЛТ: засварын (corrective) миграц, 0376–0380-ийн дараах (2026-10-05).
--
-- ⚠️ 0376 / 0377 нь хэрэгжсэн (deployed) тул ХЭЗЭЭ Ч засагдахгүй, дугаар өөрчлөгдөхгүй.  Тэдгээрийн дутагдлыг
-- ЗӨВХӨН энэ шинэ файл нөхнө.  Бүгд нэмэлт (ADD COLUMN / CREATE ... IF NOT EXISTS) — users, projects, task_* хүснэгтийг
-- rebuild хийхгүй, өгөгдөл хөндөхгүй, хуучин worker нэмэлт баганыг үл тоож ажилласаар байна.
--
-- 1) task_ops (идемпотент бүртгэл) — 0377-д дутуу байсан зүйлс:
--      request_hash  — хүсэлтийн агуулгын SHA-256.  Ижил request_id өөр агуулгатай ирвэл 409 REQUEST_REUSED
--                      (өмнө нь чимээгүй анхны үр дүнг буцааж, хэрэглэгчийн ШИНЭ утгыг алдаж болох байсан).
--      post_json     — commit-ийн ДАРААХ үр дагаврын (архив, AI хураангуй, snapshot, засварын цаг) өгөгдөл.
--      post_attempts, post_error — тэр үр дагавар биелээгүй үед дахин оролдлого (post_status = pending).
--      post_status багана 0377-д бий боловч НЭГ Ч УДАА бичигдээгүй байсан (үргэлж done).  Одоо pending → done төлөвт машин.
-- 2) task_credit_adjustments — managed таскийн жин, төвөгшил өөрчлөгдсөний дараах оноог ЖУРНАЛААС дахин тооцсон
--    нөхөн мөрүүд (анхны мөрийг ХЭЗЭЭ Ч дарахгүй, анхны өдөр, анхны эзэн).  UNIQUE (run_id, contribution_id) — дахин
--    ажиллуулахад давхар мөр үүсэхгүй.
-- 3) Индексүүд: restore/аудит/дахин тооцоо ref_id, points_id-аар хайдаг (0377-д зөвхөн slices индекс байсан).

ALTER TABLE task_ops ADD COLUMN request_hash TEXT;

ALTER TABLE task_ops ADD COLUMN post_json TEXT;

ALTER TABLE task_ops ADD COLUMN post_attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE task_ops ADD COLUMN post_error TEXT;

CREATE INDEX IF NOT EXISTS idx_task_ops_post ON task_ops (post_status, created_at) WHERE post_status <> 'done';

CREATE TABLE IF NOT EXISTS task_credit_adjustments (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id            TEXT    NOT NULL,
  task_id           INTEGER NOT NULL,
  contribution_id   INTEGER NOT NULL,
  user_id           INTEGER NOT NULL,
  points_id         INTEGER,
  coef_before       REAL    NOT NULL,
  coef_after        REAL    NOT NULL,
  complexity_before REAL    NOT NULL,
  complexity_after  REAL    NOT NULL,
  amount_before     REAL    NOT NULL,
  amount_after      REAL    NOT NULL,
  delta_pct_before  REAL    NOT NULL,
  delta_pct_after   REAL    NOT NULL,
  awarded_at        TEXT    NOT NULL,
  actor_id          INTEGER,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (run_id, contribution_id)
);

CREATE INDEX IF NOT EXISTS idx_task_credit_adj_task ON task_credit_adjustments (task_id, contribution_id);

CREATE INDEX IF NOT EXISTS idx_task_contrib_ref ON task_contributions (ref_id) WHERE ref_id IS NOT NULL;
