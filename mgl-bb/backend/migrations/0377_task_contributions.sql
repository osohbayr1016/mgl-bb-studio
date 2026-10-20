-- 0377 — ТАСКИЙН ХУВААРИЛАЛТ: хувь нэмрийн журнал + мутацийн бүртгэл (2/4).
--
-- task_contributions — «хэн, хэзээ, хэдийг хийсэн + түүнд ямар оноо олгосон» журнал.
--   Слайс (kind 'work' | 'seed'): units, units_open (хүчинтэй үлдсэн), free_open (тэднээс оноогүй — slack-аар
--     хаагдсан), credit_open_* (үлдсэн оноо).  Хэсэгчилсэн буцаалт пропорциональ, бүтнээр нь буцаахад
--     үлдсэн оноог ЯГ буцаана.  seed = хуучин `user_points` мөр бүрт нэг слайс (`points_id`), шинэ оноо ҮҮСЭХГҮЙ.
--   Үйл явдал (kind 'correction' | 'restore'): ref_id = слайс (restore-д correction мөр), units сөрөг/эерэг,
--     points_id = буцаалтын `user_points` мөр.  Анхны мөрийг ХЭЗЭЭ Ч устгахгүй.
--   work_date = ажил хийсэн өдөр, awarded_at = оноо хамаарах анхны цаг (буцаалт ЭНД бичигдэнэ),
--   recorded_at = бичигдсэн цаг — гурвуулаа ТУСДАА.
--   (request_id, seq) UNIQUE — нэг үйлдлийн доторх мөрийн тогтвортой дугаар; batch дотор бусад мөрийг
--   (user_points, progress_entries) түүгээр холбоно.
--
-- task_ops — ИДЕМПОТЕНТ ба өөрчлөлтийн түүх.  Мутаци бүр эхлээд энэ хүснэгтэд marker мөр бичнэ (CAS-ийн
--   шалгалт INSERT-ийн WHERE дотор), дараагийн бүх statement тухайн marker байхад л ажиллана — тиймээс
--   хуучирсан revision юу ч бичихгүй.  Ижил request_id дахин ирвэл хадгалсан result_json буцна.
--   post_status = commit-ийн дараах үр дагавар (мэдэгдэл, AI хураангуй, засварын цагийн sync) биелсэн эсэх.
--
-- FK байхгүй (D1 runtime-д хэрэгжүүлдэг эсэх баримтуудад зөрчилтэй), устгалыг гараар.

CREATE TABLE IF NOT EXISTS task_contributions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id               INTEGER NOT NULL,
  allocation_id         INTEGER,
  user_id               INTEGER NOT NULL,
  actor_id              INTEGER NOT NULL,
  kind                  TEXT    NOT NULL CHECK (kind IN ('work', 'seed', 'correction', 'restore')),
  units                 INTEGER NOT NULL,
  units_open            INTEGER NOT NULL DEFAULT 0,
  free_open             INTEGER NOT NULL DEFAULT 0,
  free_units            INTEGER NOT NULL DEFAULT 0,
  credit_amount         REAL    NOT NULL DEFAULT 0,
  credit_delta_pct      REAL    NOT NULL DEFAULT 0,
  credit_open_amount    REAL    NOT NULL DEFAULT 0,
  credit_open_delta_pct REAL    NOT NULL DEFAULT 0,
  points_id             INTEGER,
  ref_id                INTEGER,
  progress_entry_id     INTEGER,
  work_date             TEXT    NOT NULL,
  awarded_at            TEXT    NOT NULL,
  recorded_at           TEXT    NOT NULL,
  request_id            TEXT    NOT NULL,
  seq                   INTEGER NOT NULL DEFAULT 0,
  root_revision         INTEGER NOT NULL,
  qa_json               TEXT,
  restored_at           TEXT,
  restore_request_id    TEXT,
  note                  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_task_contrib_request ON task_contributions (request_id, seq);

CREATE INDEX IF NOT EXISTS idx_task_contrib_slices ON task_contributions (task_id, user_id, kind, units_open);

CREATE TABLE IF NOT EXISTS task_ops (
  request_id           TEXT PRIMARY KEY,
  task_id              INTEGER NOT NULL,
  user_id              INTEGER NOT NULL,
  kind                 TEXT    NOT NULL,
  root_revision_before INTEGER NOT NULL,
  root_revision_after  INTEGER NOT NULL,
  before_json          TEXT,
  after_json           TEXT,
  result_json          TEXT    NOT NULL,
  post_status          TEXT    NOT NULL DEFAULT 'done',
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_task_ops_task ON task_ops (task_id, created_at);
