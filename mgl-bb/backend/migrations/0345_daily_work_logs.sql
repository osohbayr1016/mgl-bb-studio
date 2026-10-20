-- Өдрийн ажлын тайлан (2026-09-24).
--
-- Админ (= «Менежмент» баг) Профайл → «Өдрийн тайлан» хэсэгт тухайн өдөр
-- хийсэн ажлаа 1. 2. 3. гэж бичнэ.  Насан туршид хадгалагдаж, сарын эцэст
-- эсвэл шаардлагатай үед нотолгоо болно.
--
-- Эзний шийдвэр (2026-09-24):
--   * ЗӨВХӨН бичсэн хүн өөрөө харна — админ ч бусдынхыг харахгүй.
--   * Өнгөрсөн өдрийг засаж / нөхөж бичиж болно, гэхдээ ТҮҮХ үлдэнэ:
--     засвар бүрийн өмнөх хувилбар `daily_work_log_revisions`-д орно.
--   * Тайлан зөвхөн дэлгэц дээр (экспорт байхгүй).
--
-- ⚠️ `items_json` = мөрийн JSON массив (дугааргүй — дугаарыг UI тавина).
-- ⚠️ `first_written_on` = АНХ бичсэн УБ огноо.  `log_date`-ээс хойш бол
--    «хожим нөхсөн» гэж харагдана — сервер тавина, клиентэд итгэхгүй.
-- ⚠️ Устгах зам ЗОРИУД байхгүй (нотолгоо).  D1 FK-г ажиллах үед мөрддөггүй
--    тул `DELETE /api/users/:id` хоёр хүснэгтийг гараар цэвэрлэнэ.
CREATE TABLE IF NOT EXISTS daily_work_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date          TEXT    NOT NULL,
  items_json        TEXT    NOT NULL,
  first_written_on  TEXT    NOT NULL,
  edit_count        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, log_date)
);

CREATE INDEX IF NOT EXISTS idx_dwl_user_date ON daily_work_logs(user_id, log_date);

-- Append-only: хадгалах бүрд агуулга өөрчлөгдсөн бол ӨМНӨХ хувилбар энд.
-- `valid_from` = тэр хувилбар бичигдсэн цаг, `replaced_at` = солигдсон цаг.
CREATE TABLE IF NOT EXISTS daily_work_log_revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id       INTEGER NOT NULL REFERENCES daily_work_logs(id) ON DELETE CASCADE,
  items_json   TEXT    NOT NULL,
  valid_from   TEXT    NOT NULL,
  replaced_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dwlr_log ON daily_work_log_revisions(log_id, id);
