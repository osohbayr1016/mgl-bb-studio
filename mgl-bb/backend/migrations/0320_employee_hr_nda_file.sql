-- 0320 — Нууцлалын гэрээ (NDA) ТУСДАА файл («Тайлан» → HR карт, эзний хүсэлт 2026-09-16).
-- contract_file_* багана нь ХӨДӨЛМӨРИЙН гэрээ хэвээр; nda_file_* нь нууцлалын гэрээ.
-- Хоёулаа хувийн MEETING_BUCKET-ийн `hr/` угтвар, зөвхөн GET /api/reports/employees/:id/contract-file/:kind.
-- Дугаар 0312–0318 нь crc/change-release-control салааных тул алгассан.
ALTER TABLE employee_hr ADD COLUMN nda_file_key TEXT;
ALTER TABLE employee_hr ADD COLUMN nda_file_name TEXT;
ALTER TABLE employee_hr ADD COLUMN nda_file_size INTEGER;
ALTER TABLE employee_hr ADD COLUMN nda_uploaded_at TEXT;
