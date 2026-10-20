-- =============================================================
-- 0331_asr_visit_plans.sql — Зохиогчийн хяналтын ХУВААРЬ (2026-09-21)
-- =============================================================
-- «Хүмүүсийг ЗХ-д явуулахаар сонгох» гэсэн ойлголт өмнө нь модульд огт
-- байгаагүй: тайланг (`author_supervision_reports`) талбайд очсон хүн
-- ӨӨРӨӨ, очсоныхоо ДАРАА үүсгэдэг.  Эзний шийдвэр 2026-09-21: admin/senior
-- УРЬДЧИЛАН төлөвлөнө — төсөл + огноо (+ цаг) + явах хүмүүс + тэмдэглэл —
-- ба сонгогдсон хүн бүрд «тэдэн сарын тэдэнд энэ төсөл дээр зохиогчийн
-- хяналтаар явна» гэсэн мэдэгдэл (`asr_visit_assigned`) очно.
--
-- ⚠️ Хуваарь нь ТАЙЛАНГ ХӨНДӨХГҮЙ.  Тусдаа хүснэгт, тайлан руу FK байхгүй:
--    тайлангийн хөлдөлт/дугаарлалт/батлах эрх хэвээр, тайланг өмнөх
--    шигээ очсон хүн үүсгэнэ.  «Хуваарь ↔ тайлан» холбоос ирээдүйд
--    хэрэгтэй бол тайлан талдаа nullable багана нэмнэ, энд биш.
--
--   asr_visit_plans          1 мөр = 1 төлөвлөсөн очилт
--     visit_date  YYYY-MM-DD (УБ), visit_time HH:MM эсвэл NULL
--     status      planned | cancelled  (цуцалсан мөр ХАДГАЛАГДАНА — түүх)
--   asr_visit_plan_members   хэн явах вэ; notified_at = мэдэгдэл очсон агшин
--
-- users руу REFERENCES ЗОРИУД БАЙХГҮЙ (0279-ийн ижил шалтгаан): users-т
-- шинэ FK ирмэг нэмэх нь path-B rebuild + DELETE /api/users/:id-ийн гар
-- устгалтад мөр нэмнэ; нэрийг LEFT JOIN-оор уншдаг тул устсан хэрэглэгч
-- зүгээр л NULL нэр болно.
-- ⚠️ ТЭЭВЭР: 5 statement (<= 9), блок тайлбаргүй, мөрөн дотор цэг таслал алга.
CREATE TABLE IF NOT EXISTS asr_visit_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  visit_date TEXT NOT NULL,
  visit_time TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'cancelled')),
  created_by INTEGER NOT NULL,
  cancelled_by INTEGER,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asr_visit_plan_members (
  plan_id INTEGER NOT NULL REFERENCES asr_visit_plans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  notified_at TEXT,
  PRIMARY KEY (plan_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_asr_visit_plans_date
  ON asr_visit_plans(status, visit_date, visit_time);

CREATE INDEX IF NOT EXISTS idx_asr_visit_plans_project
  ON asr_visit_plans(project_id, visit_date);

CREATE INDEX IF NOT EXISTS idx_asr_visit_plan_members_user
  ON asr_visit_plan_members(user_id, plan_id);
