-- =============================================
-- Төслийн гар эрэмбэ (admin drag-reorder).  ProjectsPage-ийн «Гар эрэмбэ»
-- sort горимд админ төслүүдийг чирж дээш/доош зөөхөд энэ баганаар хадгална.
-- Бага утга = дээр.  Бүх хуучин төсөл 0-оор эхэлж, created_at-аар эрэмбэлэгдэнэ;
-- админ эрэмблэхэд (i+1)*10 зайтайгаар бичигдэнэ (landing block-ийн pattern).
-- =============================================

ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_projects_sort_order ON projects(sort_order);
