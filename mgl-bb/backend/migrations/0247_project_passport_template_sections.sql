-- 0247_project_passport_template_sections.sql
-- «PROJECT DESCRIPTION» Word загварын 1.2 ба 1.3 хэсгүүд.
--
-- Эзний шийдвэр 2026-09-02: Word баримтын БҮХ хэсэг (1.1 Ерөнхий мэдээлэл,
-- Бичиг баримт, 1.2 Хамрах хүрээ, 1.3 Төслийн хугацаа) төслийн «Мэдээлэл»
-- хуудсанд амьдарч, тайлан зэрэг бусад бүх газар ТЭНДЭЭС татна.
--
-- ⚠️ Яагаад JSON вэ: эдгээр гурав нь ХӨДӨЛГӨӨНТ УРТТАЙ хүснэгт бөгөөд
-- SQL-ээр хайгддаггүй.  Харин `start_date` / `finish_date` /
-- `extension_date` нь `deadlines.ts` ба `company.ts`-д JOIN/ORDER BY-д
-- ордог тул БАГАНА хэвээр үлдэнэ — passport route нь 1.3-ын хүснэгтээс
-- тэр гурвыг гаргаж аваад баганад давхар бичнэ.
--
-- ⚠️ `projects` дээр БИШ: тэр хүснэгт 38 cascade хүүхэдтэй бөгөөд
-- rebuild нь хориотой (0223-ын толгойн дүрэм).  `project_passport` нь
-- аль хэдийн 1:1, ON DELETE CASCADE, upsert хэлбэртэй.
ALTER TABLE project_passport ADD COLUMN scope_rows_json TEXT;
ALTER TABLE project_passport ADD COLUMN timeline_json TEXT;
ALTER TABLE project_passport ADD COLUMN meetings_json TEXT;
