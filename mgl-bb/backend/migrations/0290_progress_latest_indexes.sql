-- 0290 — progress_entries: «сүүлийн батлагдсан явц» хайлтыг НЭГ индексийн мөр болгох.
--
-- D1 rows_read аудит (2026-09-11).  Аппын ~24 rollup/жагсаалт «таскийн сүүлийн
-- батлагдсан явц»-ыг корреляцтай дэд асуулгаар авдаг; кодыг таск тус бүрийн
-- скаляр дэд асуулга болгосон (lib/progressLatest.ts) тул тэр дэд асуулгыг
-- БҮРХЭХ (covering) partial индекс хэрэгтэй — эс бөгөөс индексийн мөр + хүснэгтийн
-- мөр = 2 уншилт.  Хэмжсэн (prod-ын хуулбар):
--   /api/teams/allocation  2 974 739 → 78 062 мөр
--   /api/teams               203 389 → 31 905
--   /api/company/overview    285 735 → 106 039
--   /api/ticker               48 384 → 13 284
--
-- 1) created_at DESC тиебрейк (PROJECT_LIST_SQL, company, progress, deadlines …):
--    хуучин (task_id, created_at DESC) индексийг percentage-тэй БҮРХЭХ болгож солино.
-- 2) date DESC, created_at DESC, id DESC тиебрейк (teams, projectCharts, profiles, MCP):
--    шинэ бүрхэх индекс — өмнө нь таск бүрд түр B-tree эрэмбэ хийдэг байв.
-- 3) idx_progress_task (task_id) → (task_id, created_at DESC): ижил хайлтыг бүгдийг
--    үйлчилнэ, нэмээд «төслийн сүүлийн үйл ажиллагаа» (MAX(created_at) БҮХ статус,
--    projectLastActivitySql) нэг индексийн мөр болно.
--
-- Бичих зардал: progress_entries-д өдөрт хэдэн арван INSERT л ордог тул хоёр
-- нэмэлт индексийн мөр бичилт ач холбогдолгүй; уншилт нь өдөрт олон сая.
DROP INDEX IF EXISTS idx_progress_task_approved_latest;
CREATE INDEX idx_progress_task_approved_latest
  ON progress_entries(task_id, created_at DESC, percentage)
  WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_progress_task_approved_seq
  ON progress_entries(task_id, date DESC, created_at DESC, id DESC, percentage)
  WHERE status = 'approved';
DROP INDEX IF EXISTS idx_progress_task;
CREATE INDEX idx_progress_task ON progress_entries(task_id, created_at DESC);
-- 4) Dashboard-ын «сүүлийн 10 явц» (ORDER BY created_at DESC LIMIT 10) нь
--    created_at дээр индексгүй тул 8 000 мөрийг бүтнээр эрэмбэлдэг байв
--    (хэмжсэн 32 248 мөр; ажилтан бүрийн нэвтрэлт бүрд).
CREATE INDEX IF NOT EXISTS idx_progress_created_at ON progress_entries(created_at DESC);
