-- Ирц бүртгэхдээ ЗАСВАРЫН ТӨСӨЛ (repair_projects, 0194) сонгох (2026-09-17).
--
-- Асуудал: жижиг засварын ажил (1-2 цаг, Projects хуудсанд байхгүй) хийж буй
-- ажилтан ирц бөглөхдөө тэр ажлаа сонгож чаддаггүй байсан — `daily_active_projects`
-- ба `attendance_checkpoint_projects` хоёулаа ЗӨВХӨН `projects.id` авдаг.  Тиймээс
-- захирал түүнийг өөр төсөл дээр ажиллаж байгаа гэж хардаг байв.
--
-- Шийдэл: `repair_entries`-ийн ижил философи — `projects`-ийн хүснэгтэд багана
-- НЭМЭХГҮЙ, тусдаа ИХЭР хүснэгт.  `daily_active_projects`-ийг 20 газар
-- `JOIN projects` хийж уншдаг тул NULL-тэй project_id нэмвэл бүгд чимээгүй
-- хаяна; ихэр хүснэгт бол харуулах ёстой уншигч (Багууд хуудас) л UNION-оор
-- opt-in хийнэ, бусад (төслийн график, timeseries, MCP) хэвээр.
-- ⚠️ `projects.id` ба `repair_projects.id` ДАВХЦДАГ (хоёулаа AUTOINCREMENT) —
-- хоёрыг холих хариунд засварын төслийг `id = -repair_project_id`,
-- `kind = 'repair'` гэж ялгана (routes/teams.ts allocation).
CREATE TABLE IF NOT EXISTS daily_active_repairs (
  user_id           INTEGER NOT NULL REFERENCES users(id),
  date              TEXT    NOT NULL,
  repair_project_id INTEGER NOT NULL REFERENCES repair_projects(id),
  created_at        TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date, repair_project_id)
);

CREATE INDEX IF NOT EXISTS idx_dar_user_date ON daily_active_repairs(user_id, date);
CREATE INDEX IF NOT EXISTS idx_dar_date_repair ON daily_active_repairs(date, repair_project_id);

-- Шат бүрийн (өглөө / үдээс хойш / гарах) сонголтын хуулбар —
-- `attendance_checkpoint_projects`-ийн ихэр.  Checkpoint мөр нь хоёуланг
-- зэрэг агуулж болно (төсөл + засварын төсөл).
CREATE TABLE IF NOT EXISTS attendance_checkpoint_repairs (
  checkpoint_id     INTEGER NOT NULL REFERENCES attendance_project_checkpoints(id) ON DELETE CASCADE,
  repair_project_id INTEGER NOT NULL REFERENCES repair_projects(id),
  PRIMARY KEY (checkpoint_id, repair_project_id)
);

CREATE INDEX IF NOT EXISTS idx_acr_repair ON attendance_checkpoint_repairs(repair_project_id);
