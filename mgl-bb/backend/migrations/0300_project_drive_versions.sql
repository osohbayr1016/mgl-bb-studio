-- =============================================================
-- 0300_project_drive_versions.sql — Төслийн Drive файлын ХУВИЛБАРЫН ТҮҮХ — 2026-09-15
-- =============================================================
--
-- Эзний 2026-09-15-ны шийдвэр: төслийн Google Drive хавтсыг холбоостой хэн ч
-- (Google акаунтгүй гүйцэтгэгч ч) засварлаж болно; харин систем Drive-ыг
-- БАЙНГА СОНСОЖ, файл хадгалагдах бүрд түүний хуулбарыг ӨӨРТӨӨ (хувийн R2,
-- MEETING_BUCKET, `drive-versions/` угтвар) хадгалж, «хэн, хэзээ, юу
-- өөрчилсөн» гэдгийг бүртгэж, сонгосон хувилбар руу БУЦААХ боломж өгнө.
-- Ажилтнууд хувийн Google акаунтгүй (баг тус бүр нэг @mglenc.com) тул Google-ийн
-- өөрийн version history нь хүнийг биш багийг л заадаг — мөн Drive нь энгийн
-- файлын хувилбарыг 30 хоног / 100 хувилбараар хязгаарладаг.  Энэ хүснэгт нь
-- тэр хоёр дутагдлыг нөхдөг ӨӨРИЙН ledger.
--
-- Drive нь ЭХ СУРВАЛЖ хэвээр (0278): энд зөвхөн ХУВИЛБАРЫН хуулбар байна,
-- «Баримт бичиг» таб Drive-аас шууд уншсаар байна.
--
-- Мөр бүр = файлын НЭГ төлөв.  `change_kind`:
--   created   — хавтсанд анх илэрсэн (шинэ файл, эсвэл сонсогч асахаас өмнө байсан)
--   modified  — агуулга өөрчлөгдсөн (md5 / Google баримтын modifiedTime)
--   renamed   — нэр өөрчлөгдсөн (агуулга хэвээр — өмнөх мөрийн R2 объектыг дахин заана)
--   moved     — өөр дэд хавтас руу зөөгдсөн
--   trashed   — хогийн сав руу
--   untrashed — хогийн савнаас буцсан
--   deleted   — Drive-аас бүрмөсөн устсан (эсвэл SA-д харагдахаа больсон)
--   restored  — ERP-ээс өмнөх хувилбар руу буцаасан (`restored_from_version_id`,
--               `restored_by_user_id` — ЭНЭ л мөр ERP-ийн хүнийг мэддэг)
--
-- `r2_key` NULL = тухайн төлөвт байт хуулбар байхгүй (deleted; хэт том файл;
-- экспортлогдохгүй Google формат).  `snapshot_mime` = R2 дахь байтын MIME —
-- Google Docs/Sheets/Slides нь docx/xlsx/pptx болж экспортлогддог, тэр
-- хэлбэрээрээ л Drive руу буцааж ачаалагдана.
--
-- ⚠️ Мөр ХЭЗЭЭ Ч устгагдахгүй, шинэчлэгдэхгүй (ledger).  `renamed`/`moved`
-- мөрүүд өмнөх мөрийн `r2_key`-г ХУВААЛЦДАГ тул R2 объектыг мөрөөр устгахдаа
-- өөр мөр заагаагүй эсэхийг заавал шалгана.
CREATE TABLE IF NOT EXISTS project_drive_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_folder_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  parent_id TEXT,
  size INTEGER,
  md5 TEXT,
  drive_version TEXT,
  drive_modified_at TEXT,
  modified_by_name TEXT,
  modified_by_email TEXT,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('created','modified','renamed','moved','trashed','untrashed','deleted','restored')),
  r2_key TEXT,
  snapshot_mime TEXT,
  restored_from_version_id INTEGER,
  restored_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pdv_file ON project_drive_versions(file_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_pdv_root ON project_drive_versions(root_folder_id, id DESC);
-- Changes API-аас ирсэн, «тогтсон» (QUIET_MS чимээгүй) болохыг хүлээж буй
-- файлууд.  Google Docs нь бичих бүрт modifiedTime-аа шинэчилдэг тул
-- хагас бичсэн өгүүлбэрийг хуулбарлахгүйн тулд хүлээнэ (documentGoogle.ts-тэй
-- ижил зарчим).  Боловсруулсны дараа мөр УСТГАГДАНА — түр хүснэгт.
CREATE TABLE IF NOT EXISTS project_drive_pending (
  file_id TEXT PRIMARY KEY,
  root_folder_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  drive_modified_at TEXT,
  removed INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
