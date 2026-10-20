-- =============================================================
-- 0343_user_points_non_project.sql — Төслийн бус ажлын оноо (2026-09-24)
-- =============================================================
--
-- ЮУНД ЗОРИУЛАГДСАН БЭ:
--   Төслийн бус ажил (0342) админ БАТАЛСНЫ ДАРАА л бүтээмжид тооцогдоно
--   (эзний шийдвэр, 2026-09-24): засвартай ИЖИЛ томьёо —
--     оноо = ажилтны ӨДРИЙН ДУНДАЖ ханш × (цаг / 8)
--   Оноо нь бусад бүх оноотой адил `user_points` дэвтэрт бичигдэнэ, тиймээс
--   онооны самбар, Тайлангийн «Бүтээмж», өдрийн snapshot, MCP бүгд ӨӨРЧЛӨЛТГҮЙ
--   уншина (`SUM(amount)`).
--
-- ЯАГААД REBUILD ХЭРЭГТЭЙ ВЭ:
--   0194-ийн `CHECK ((project_id IS NULL) <> (repair_project_id IS NULL))`
--   нь «ЯГ нэг эзэн: төсөл эсвэл засварын төсөл» гэж шаарддаг.  Төслийн бус
--   ажил аль алинд нь хамаарахгүй.  SQLite-д CHECK-ийг ALTER-аар өөрчлөх
--   боломжгүй тул CREATE new -> INSERT...SELECT -> DROP old -> RENAME.
--   Шинэ CHECK:
--     • source = 'non_project'  -> хоёр эзэн ХОЁУЛАА хоосон, `non_project_work_id`
--       ЗААВАЛ дүүрэн (мөр бүр нэг бүртгэлтэй холбогдоно);
--     • бусад source            -> хуучин дүрэм ЯГ хэвээр.
--   Хуучин мөр бүр хоёр дахь салаагаар шалгагдана — өгөгдөл хөдлөхгүй.
--
-- ЭНЭ НЬ PATH B ШААРДДАГГҮЙ — ЭНГИЙН `migrations apply` ЗӨВ (0194-ийн ижил):
--   `user_points` нь ЗӨВХӨН ХҮҮХЭД.  2026-09-24-нд prod хуулбар дээр шалгасан:
--   sqlite_master дээр `REFERENCES user_points` гэсэн хүснэгт, trigger, view
--   байхгүй.  DROP нь юуг ч каскадаар устгахгүй, файл ТРАНЗАКЦААР
--   боогддог тул алдаа гарвал бүгд буцна.
--
-- PRODUCTION-Д АЖИЛЛУУЛАХЫН ӨМНӨ (backend/-ээс):
--   1) Нөөцлөх:
--      npx wrangler d1 export mgl-progress-db-v3 --remote --config wrangler.toml --output ../backup-before-0343.sql
--   2) Схем доорхтой ЯГ таарч байгааг шалгах (багана, DEFAULT, FK):
--      npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT sql FROM sqlite_master WHERE tbl_name = 'user_points'"
--   3) Эцэг биш гэдгийг давхар шалгах (0 мөр буцаах ЁСТОЙ):
--      npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT name FROM sqlite_master WHERE name <> 'user_points' AND sql LIKE '%REFERENCES user_points%'"
--   4) Мөрийн тоог тэмдэглэж, дараа нь тулгах:
--      npx wrangler d1 execute mgl-progress-db-v3 --remote --config wrangler.toml --command "SELECT COUNT(*) n, SUM(amount) s FROM user_points"
--
-- ⚠️ Багануудыг 0194-ийн БОДИТ схемээс (prod хуулбарын sqlite_master) ЯГ
--    хуулсан.  `source`-ийн DEFAULT 'progress' ба `awarded_at`-ын DEFAULT
--    (datetime('now')) ачаалал үүрнэ: progress.ts-ийн INSERT-үүд эдгээрийг
--    нэрлэдэггүй.
-- ⚠️ sqlite_sequence: 0194-ийн адил DROP нь seq-ийг MAX(id) болгож бууруулна.
--    Эдгээр id-г гаднаас заасан FK байхгүй тул санаатайгаар сэргээхгүй.
-- ⚠️ ≤ 9 statement (wrangler-ийн бүртгэлийн INSERT-ийг оролцуулаад) —
--    D1-ийн /query задлагчийн хязгаар.  Энэ файл: 8 + 1.
-- =============================================================

CREATE TABLE user_points_new (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id)             ON DELETE CASCADE,
  project_id          INTEGER          REFERENCES projects(id)          ON DELETE CASCADE,
  task_id             INTEGER          REFERENCES tasks(id)             ON DELETE SET NULL,
  progress_entry_id   INTEGER          REFERENCES progress_entries(id)  ON DELETE SET NULL,
  amount              REAL    NOT NULL,
  delta_pct           REAL    NOT NULL,
  assignee_count      INTEGER NOT NULL,
  awarded_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  awarded_by          INTEGER          REFERENCES users(id),
  source              TEXT    NOT NULL DEFAULT 'progress',
  repair_entry_id     INTEGER,
  repair_project_id   INTEGER          REFERENCES repair_projects(id),
  -- Төслийн бус ажлын бүртгэл (0342).  FK-гүй — `repair_entry_id`-ийн адил
  -- app түвшинд цэвэрлэнэ (DELETE /users/:id гараар устгадаг).
  non_project_work_id INTEGER,
  CHECK (
    (source = 'non_project'
       AND project_id IS NULL AND repair_project_id IS NULL
       AND non_project_work_id IS NOT NULL)
    OR
    (source <> 'non_project'
       AND (project_id IS NULL) <> (repair_project_id IS NULL))
  )
);

INSERT INTO user_points_new
  (id, user_id, project_id, task_id, progress_entry_id, amount, delta_pct,
   assignee_count, awarded_at, awarded_by, source, repair_entry_id, repair_project_id,
   non_project_work_id)
SELECT
   id, user_id, project_id, task_id, progress_entry_id, amount, delta_pct,
   assignee_count, awarded_at, awarded_by, source, repair_entry_id, repair_project_id,
   NULL
FROM user_points;

DROP TABLE user_points;

ALTER TABLE user_points_new RENAME TO user_points;

CREATE INDEX IF NOT EXISTS idx_user_points_user_date      ON user_points(user_id, awarded_at);
CREATE INDEX IF NOT EXISTS idx_user_points_project        ON user_points(project_id, awarded_at);
CREATE INDEX IF NOT EXISTS idx_user_points_awarded        ON user_points(awarded_at);
CREATE INDEX IF NOT EXISTS idx_user_points_repair_project ON user_points(repair_project_id, awarded_at);
