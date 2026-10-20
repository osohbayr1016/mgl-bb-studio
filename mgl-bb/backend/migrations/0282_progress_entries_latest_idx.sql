-- 0282: «сүүлийн батлагдсан явц» дэд асуулгын индекс
-- ---------------------------------------------------------------------
-- Явцын БҮХ rollup (PROJECT_LIST_SQL + түүний 20 гаруй хуулбар, ticker,
-- company overview, dashboard, MCP) даалгавар бүрийн сүүлийн батлагдсан
-- `progress_entries` мөрийг ХОЁР хэлбэрийн correlated дэд асуулгаар олдог:
--
--   WHERE x.task_id = ? AND x.status = 'approved' ORDER BY x.created_at DESC LIMIT 1
--   WHERE x.task_id = ? AND x.status = 'approved' ORDER BY x.date DESC, x.created_at DESC, x.id DESC LIMIT 1
--
-- Өнөөг хүртэл ганц `idx_progress_task(task_id)` л байсан тул дэд асуулга
-- бүр тухайн даалгаврын k мөрийг БҮГДИЙГ уншиж, temp B-tree-ээр эрэмбэлдэг
-- байв — rollup нэг удаа ажиллахад O(N·k) мөр уншилт (N = батлагдсан
-- мөрийн тоо).  D1 нь мөр уншилт бүрийг тоолдог; хэмжсэн (4 345 даалгавар ×
-- 7 мөр): VM-step 3.19M → 660k зөвхөн энэ индексээр, 152k CTE-г даалгавраас
-- эхлүүлэх засвартай хамт (routes/projects.ts-ийн latest_task тайлбарыг үз).
--
-- Хоёр индекс тус тусдаа хэрэгтэй: эрэмбийн эхний түлхүүр (created_at vs
-- date) өөр тул нэг нь нөгөөгөө орлохгүй.  rowid (`id`) индекс бүрийн
-- далд сүүлийн түлхүүр тул `x.id DESC` tiebreak-ийг тусад нь жагсаах хэрэггүй.
-- Зөвхөн CREATE INDEX — `migrations apply`-аар аюулгүй (DROP байхгүй).
CREATE INDEX IF NOT EXISTS idx_progress_task_status_created
  ON progress_entries(task_id, status, created_at);

CREATE INDEX IF NOT EXISTS idx_progress_task_status_date
  ON progress_entries(task_id, status, date, created_at);
