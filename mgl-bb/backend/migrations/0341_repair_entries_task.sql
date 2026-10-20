-- 0341 — Засварын цагийг ТАСКТАЙ холбох (сонголттой), 2026-09-24.
--
-- Засварын ажил ХУВИАР биш АЖИЛЛАСАН ЦАГААР хэмжигдэнэ: цагаар бодогддог
-- (progress_mode = 'hours') төслийн таскийн мөрөнд «хэдэн хувь» биш «хэн
-- хэдэн цаг» харагдана (А — 3 цаг, Б — 5 цаг).  Үүний тулд бүртгэл аль
-- таск дээр хийгдсэнийг мэдэх ёстой.
--
-- task_id нь NULL байж БОЛНО, хуучин бүх мөр NULL хэвээр (зөвхөн төслийн
-- түвшний цаг).  Дотоод ажил (repair_project_id) таскгүй тул үргэлж NULL.
-- Зөвхөн progress_mode = 'hours' төслийн таск холбогдоно — routes/repair.ts
-- шалгана, ердийн (жинлэсэн) төслийн таск хөндөгдөхгүй.
--
-- ON DELETE SET NULL: таск устахад цаг нь төслийн түвшинд үлдэнэ, хэзээ ч
-- устахгүй.  routes/tasks.ts DELETE нь мөн гараар тайлна (D1 FK конвенц).
-- ⚠️ tasks хүснэгтийг ирээдүйд path B-ээр дахин барих бол энэ холбоос
-- migrations apply дотор NULL болно — цаг хэвээр, зөвхөн таскийн нэр алга.
ALTER TABLE repair_entries ADD COLUMN task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_repair_task ON repair_entries(task_id);
