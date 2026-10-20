-- Ирцийн цэг бүрд сонгосон төслийн бус ажил (2026-09-28).
--
-- attendance_checkpoint_projects (0047) ба attendance_checkpoint_repairs
-- (0324)-ийн ИХЭР: өглөө / 14:00 / гарах цэг бүрд ажилтан аль төслийн бус
-- ажлыг сонгосныг хадгална.  Цаггүй бүртгэлийн цагийг ҮҮНЭЭС бодно
-- (backend/src/lib/nonProjectWork.ts deriveTimelessMinutes): өглөөний цэг =
-- өглөөний хагас (4 цаг), 14:00 ба гарах цэг = үдээс хойших хагас (4 цаг).
--
-- ⚠️ entry_id нь FK-ГҮЙ ЗОРИУД — non_project_work_entries-ийг ирээдүйд дахин
--    rebuild хийхэд (0356 шиг) энэ хүснэгт каскадаар хоосрохгүйн тулд.
--    Бүртгэл устгахад мөрийг ГАРААР устгана (routes/nonProjectWork.ts DELETE,
--    routes/users.ts DELETE).  checkpoint_id нь 0324-ийн адил FK-тэй.
CREATE TABLE IF NOT EXISTS attendance_checkpoint_non_project (
  checkpoint_id INTEGER NOT NULL REFERENCES attendance_project_checkpoints(id) ON DELETE CASCADE,
  entry_id      INTEGER NOT NULL,
  PRIMARY KEY (checkpoint_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_acnp_entry ON attendance_checkpoint_non_project(entry_id);
