-- =============================================
-- Funding milestones — replace single % with structured table
-- =============================================
-- Өмнөх `funding_terms` (TEXT) + `funding_percent` (REAL) хосын оронд
-- "Тулбөрийн нөхцөл / Хувь / Авсан эсэх" гэсэн жагсаалттай table-аар
-- хадгална.  JSON массив байдлаар нэг л багана дотор хадгалаад UI дээр
-- редакцэлнэ.  Хуучин 2 баганыг шууд DROP хийхгүй (SQLite ALTER хязгаар-
-- лалттай) — payload дотор унтраагаад л орхино.
--
-- JSON форматын жишээ:
-- [
--   { "label": "Гэрээ байгуулсны дараа", "percent": 30, "done": true,
--     "received_at": "2026-04-12" },
--   { "label": "30%-ийн зураг хүлээлгэн өгсний дараа", "percent": 30,
--     "done": false }
-- ]
ALTER TABLE project_status_reports
  ADD COLUMN funding_milestones_json TEXT;
