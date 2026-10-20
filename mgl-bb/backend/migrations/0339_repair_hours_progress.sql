-- 0339 — Засварын төслийн явц ЦАГИЙН БҮРТГЭЛЭЭС (эзний шийдвэр 2026-09-21).
--
-- Хоёр «засварын төсөл» хоёулаа хамрагдана:
--   * repair_projects (дотоод ажил) — өнөөг хүртэл явцын хувь ОГТ байгаагүй;
--   * projects.category = 'ZA' — ажилтан таск бүрд гараар % бичдэг байсан.
--
-- Шинэ дүрэм: явц = MIN(100, Σ progress_pct), progress_pct = ажилтны ӨДРИЙН
-- ДУНДАЖ ТӨСЛИЙН-% (delta_pct, шаталсан: self7 → self90 → team30 → company30)
-- × (цаг / 8).  Оноо (computed_pct, user_points) ХЭВЭЭР — энэ нь зөвхөн
-- явцын тоо.  lib/repairProgress.ts — ГАНЦ газар.
--
-- projects.progress_mode: 'tasks' (жинлэсэн мод, өгөгдмөл — одоо байгаа бүх
-- төсөл, хуучин ZA төслүүд ХЭВЭЭР) | 'hours' (цагийн бүртгэлээс).  Шинээр
-- үүсгэсэн ZA төсөл route дээр 'hours' авна; POST /api/progress нь 'hours'
-- төслийн таск дээр 403.
--
-- Одоо байгаа repair_entries мөрүүдийн progress_pct нь 0 үлдэнэ — тэднийг
-- POST /api/repair/backfill-progress (admin, идемпотент) мөр бүрийн огноогоор
-- нөхөж бодно (progress_rate_source IS NULL мөрүүд).
ALTER TABLE projects ADD COLUMN progress_mode TEXT NOT NULL DEFAULT 'tasks' CHECK(progress_mode IN ('tasks','hours'));
ALTER TABLE repair_entries ADD COLUMN progress_rate REAL NOT NULL DEFAULT 0;
ALTER TABLE repair_entries ADD COLUMN progress_rate_source TEXT;
ALTER TABLE repair_entries ADD COLUMN progress_pct REAL NOT NULL DEFAULT 0;
