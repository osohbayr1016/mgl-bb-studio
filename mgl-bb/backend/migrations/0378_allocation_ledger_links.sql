-- 0378 — ТАСКИЙН ХУВААРИЛАЛТ: оноо/явцын холбоос, автомат архивын тэмдэг, tie-break индекс (3/4).
--
-- user_points:
--   contribution_id    — managed таскийн хувь нэмрийн журналын мөр (`task_contributions.id`).  NULL = хуучин мөр.
--   reverses_points_id — энэ мөр (сөрөг дүнтэй) аль мөрийн оноог БУЦААЖ байгаа.  Буцаалтын мөр нь `source`,
--                        `project_id`-г анхных шигээ хадгална (CHECK, rate ladder, /project уншигчид хэвээр).
--   recorded_at        — бичигдсэн цаг (awarded_at нь анхны ажлын өдрийн цаг хэвээр — буцаалт тэнд тооцогдоно).
--   `recalculateProjectPoints` managed таскийн мөрийг ХЭЗЭЭ Ч устгахгүй (`task_roots`-тэй таск).
--
-- projects.auto_archived_at — хувь 100 хүрч АВТОМАТААР архивлагдсан цаг.  Гараар архивлавал NULL.  Залруулгаар
--   хувь буурахад ЗӨВХӨН энэ тэмдэгтэй төслийг дахин нээнэ (гараар архивласныг хэзээ ч нээхгүй).
--
-- idx_progress_task_approved_latest_id — `latestApprovedPctByCreatedAt` одоо `created_at DESC, id DESC`
--   (ижил секундэд хоёр бичлэг бол сүүлд бичигдсэн нь).  Хуучин индекс хэвээр (устгахгүй).
--
-- Бүгд ADD COLUMN / CREATE INDEX — users/projects-ийн rebuild БИШ.

ALTER TABLE user_points ADD COLUMN contribution_id INTEGER;

ALTER TABLE user_points ADD COLUMN reverses_points_id INTEGER;

ALTER TABLE user_points ADD COLUMN recorded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_user_points_contribution ON user_points (contribution_id) WHERE contribution_id IS NOT NULL;

ALTER TABLE projects ADD COLUMN auto_archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_progress_task_approved_latest_id
  ON progress_entries (task_id, created_at DESC, id DESC, percentage) WHERE status = 'approved';
