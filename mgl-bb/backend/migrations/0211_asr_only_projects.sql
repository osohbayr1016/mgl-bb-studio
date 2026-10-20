-- =============================================================
-- 0211_asr_only_projects.sql — Зохиогчийн хяналтын төсөл
-- =============================================================
--
-- Админ нэрээр ЗХ төсөл нээнэ.  Энэ нь `projects` мөр (`asr_only=1`) —
-- тайлангийн FK (`author_supervision_reports.project_id`) хэвээр.
-- Төслүүд хуудас / sidebar / dashboard тоолуур `asr_only`-г ХАТУУ хасна
-- (`lib/asrEligible.ts` NOT_ASR_ONLY_SQL).  Ангилал шинэ код биш:
-- `projects.category` CHECK нь AZ/ZA/ET/EZ/IZ, path-B rebuild хийхгүй.
-- Шинэ мөр `category='ZA'` авна — зөвхөн багийн default roster-т.
--
ALTER TABLE projects ADD COLUMN asr_only INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_projects_asr_only ON projects(asr_only);
