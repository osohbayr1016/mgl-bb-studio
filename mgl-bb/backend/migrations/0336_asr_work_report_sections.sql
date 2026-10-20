-- 0336_asr_work_report_sections.sql
-- Зохиогчийн хяналт: «Ажлын тайлан» хэсгийн бүтэц + өмнөх тайлангийн
-- асуудлын шийдэл (эзний хүсэлт 2026-09-21).
--
-- Тайлан бүр дараах ГУРВАН чөлөөт текстийг авна (баримт дээр «Ажлын
-- тайлан» хэсгийн дэд хэсгүүд болж гарна):
--   work_report  -- Ажлын тайлан (тайлангийн түвшний ерөнхий бичвэр;
--                   баг тус бүрийн work_note ХЭВЭЭР, түүний доор гарна)
--   site_tasks   -- Талбай дээр өгсөн үүрэг даалгавар
--   defects      -- Илэрсэн алдаа, дутагдал
--
-- Зургийн тайлбар (caption) нь photos_json-ы мөр бүрд `caption` талбар болж
-- орсон — тусдаа багана шаардлагагүй (parsePhotos / sanitizePhotos).
--
-- asr_issue_resolutions — «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн».
-- ОДООГИЙН тайлан дээр амьдардаг мөр: өмнөх тайлангийн id + тэр үеийн
-- асуудлын бичвэр (цооног, засаж болно) + шийдлийн бичвэр.  Өмнөх тайлан
-- ХЭЗЭЭ Ч хөндөгдөхгүй (илгээгдсэн/батлагдсан тайлан хөлдсөн байдаг), тиймээс
-- түүх алга болдоггүй; өмнөх тайлангийн дэлгэрэнгүйд «ASR-00N дээр шийдсэн»
-- гэсэн холбоос ГАРГАН АВЧ харуулна (routes/authorSupervision.ts loadResolvedIn).
--
-- prev_report_id нь NULL-ддаг (ON DELETE SET NULL): өмнөх тайлан устсан ч
-- prev_doc_no / prev_report_date цооног үлдэж шийдлийн мөр утгаа алдахгүй.
-- D1 нь FK-г ажиллагааны үед хэрэгждэггүй тул DELETE /:id гараар NULL болгоно
-- (email.ts / repair.ts-ийн гар устгалын конвенц).
ALTER TABLE author_supervision_reports ADD COLUMN work_report TEXT;
ALTER TABLE author_supervision_reports ADD COLUMN site_tasks TEXT;
ALTER TABLE author_supervision_reports ADD COLUMN defects TEXT;
CREATE TABLE IF NOT EXISTS asr_issue_resolutions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES author_supervision_reports(id) ON DELETE CASCADE,
  prev_report_id INTEGER REFERENCES author_supervision_reports(id) ON DELETE SET NULL,
  prev_doc_no TEXT,
  prev_report_date TEXT,
  issue_text TEXT,
  resolution_text TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_asr_res_report ON asr_issue_resolutions(report_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_asr_res_prev ON asr_issue_resolutions(prev_report_id);
