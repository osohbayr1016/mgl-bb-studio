-- 0190 — progress_entries-ийн ГАРАЛ ҮҮСЭЛ.  `is_baseline` (0040)-ийн ижил заншил.
--
-- ⚠️ ADD COLUMN ЗӨВХӨН — хүснэгтийг ДАХИН БҮТЭЭХГҮЙ.  progress_entries нь
-- tasks-ийн CASCADE хүүхэд тул 0020-ийн rebuild дүрэм хүчинтэй.
--
-- CHECK тавихгүй: ирээдүйн эх сурвалж ('mcp','import') нэмэхэд rebuild
-- шаардахгүй байх ёстой.
--
-- Rollup-ийн 11 хуулбарын аль нь ч `SELECT *` хийдэггүй тул тэдгээр хөндөгдөхгүй.
-- Харин `SELECT pe.*` хийдэг ДӨРВӨН payload нэг талбараар өргөснө:
--   routes/dashboard.ts:38, routes/progress.ts:854 (/my),
--   routes/progress.ts:1286 (/task/:taskId), routes/profiles.ts:240
-- (/progress/my-recent нь баганаа нэрлэн бичдэг тул хөндөгдөхгүй).
-- Frontend төрлүүдийг мөн энэ PR-д шинэчилнэ.

ALTER TABLE progress_entries ADD COLUMN source TEXT NOT NULL DEFAULT 'web';

-- Сервер талын `?source=revit` шүүлтүүрийг тэжээнэ (Stage 3-д нэмэгдэнэ):
-- /api/progress/pending-approvals нь эх сурвалжаар шүүх боломжтой болно, тул
-- ?view=revit нь клиент талын шүүлтүүр биш ЖИНХЭНЭ дараалал болно.
CREATE INDEX IF NOT EXISTS idx_progress_source
  ON progress_entries(source, status);

-- Revit илгээлтийг заавал senior баталгаажуулах эсэх.
--
-- АНХДАГЧ нь 'off' — MGL-ийн БОДИТ ажлын урсгалтай тааруулав (2026-08-24):
-- ахлагч нар ажил ЯВЖ БАЙХ ҮЕД нь хянадаг тул таск бүрээр, хуудас бүрээр
-- дахин батлах нь илүүц ачаалал.  Жинхэнэ шалгалт нь төсөл 100% болоход
-- НЭГ УДАА болдог — тэр үед ахлагч бүх ажлыг зөв эсэхийг шалгаж оруулдаг.
--
-- Энэ нь progress.ts-ийн ОДОО БАЙГАА зан төлөвтэй яг таарна: 100%-аас доош
-- нь status='approved', зөвхөн >=100% нь дараалалд ордог.  Мөн
-- revitProgress.ts-ийн CEILING=99 нь Revit-ээс ажил хаахыг бүрэн хориглодог
-- тул ахлагчийн шалгалт вэб дээр хэвээр үлдэнэ.
--
-- 'on' болговол бүх Revit мөр status='pending' болно (ирээдүйд бодлого
-- өөрчлөгдвөл админ /app/settings-ээс deploy хийлгүйгээр сольно).
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('revit.force_pending', 'off');
