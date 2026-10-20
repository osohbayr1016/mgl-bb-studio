-- =============================================================
-- Migration 0173: «Төслийн хугацаа» (project milestones)
-- =============================================================
--
-- Төсөлд ХЭДЭН Ч ширхэг нэрлэсэн хугацаа тавих боломж, тус бүр нь
-- дэд хугацаатай байж болно.  Жишээ:
--   · 09-15 — Экспертизийн дүгнэлт гарсан байх
--       · 09-01 — Тооцооны хэсэг бүрэн
--       · 09-08 — Зураг төслийн багц хэвлэгдсэн
--   · 10-01 — Захиалагчид танилцуулах
--
-- ЯАГААД ШИНЭ ХҮСНЭГТ ХЭРЭГТЭЙ БОЛОВ?
-- ------------------------------------------------------------------
-- Migration 0148 (`task_deadlines`) нь дэд хугацааг ЗӨВХӨН таскийн доор
-- үүсгэдэг байв.  Тиймээс «Экспертиз», «Гэрээ байгуулах» гэх мэт ямар ч
-- таск гэж тодорхойлогдоогүй, гэвч төслийн хувьд амин чухал хугацааг
-- бүртгэх газар байсангүй.  Төсөлд байдаг цорын ганц огноо нь
-- `project_passport.finish_date` — НЭГ ширхэг.
--
-- `routes/deadlines.ts`-ийн толгойд «MILESTONE ХҮСНЭГТ БАЙХГҮЙ,
-- ЗОРИУДААР … хэрэв ирээдүйд нэмэгдвэл энэ жагсаалтад тав дахь `kind`
-- болж орно» гэж бичсэн байсан.  Энэ миграц нь яг тэр төлөвлөсөн
-- өргөтгөл — шинэ жагсаалт үүсгэхгүй, `kind: 'milestone'` болж нэгдэнэ.
--
-- ⚠️ ЭНЭ БОЛ ХУГАЦААНЫ ТЭМДЭГЛЭГЭЭ — АЖЛЫН НЭГЖ БИШ.  0148-ийн тогтоосон
-- зарчим ХЭВЭЭР үйлчилнэ.  Milestone нь:
--   · blocks→drawings→components→tasks модонд ОГТ байхгүй,
--   · явцын нэгтгэл (rollup), оноо, leaderboard-д нөлөөлӨХГҮЙ,
--   · батлах дараалалд (approvals) ОРОХГҮЙ,
--   · `progress_entries` хүлээж авахгүй.
-- Модонд байхгүй тул rollup-д орох нь БҮТЦИЙН ХУВЬД БОЛОМЖГҮЙ — «жингээр
-- 0» гэсэн зөөлөн баталгаанаас хамаагүй хатуу.
--
-- ⚠️ ГҮН = 2 ТҮВШИН.  `parent_id` нь өөрөө рүүгээ заадаг ч API нь
--    эцэгтэй мөрийг дахин эцэг болгохыг хориглоно (routes/deadlines.ts-ийн
--    `assertMilestoneDepth`).  Хязгааргүй мод нь мөчлөг (cycle), рекурсив
--    асуулга, гүн UI гэсэн гурван асуудлыг дагуулах тул зориудаар хаав.
--
-- ⚠️ ЗӨВХӨН НЭМЭЛТ (additive).  DROP TABLE байхгүй, байгаа хүснэгтийн
--    CHECK-д гар хүрэхгүй, parent rebuild БИШ.  Тиймээс энгийн
--    `wrangler d1 migrations apply`-аар аюулгүй хэрэглэнэ (path B
--    хэрэггүй — 0136_worker_role.sql-ийн runbook энд ХАМААРАХГҮЙ).
--
-- ⚠️ D1 нь runtime дээр FK-г ХЭРЭГЖҮҮЛДЭГГҮЙ.  Доорх `ON DELETE CASCADE`
--    нь зөвхөн зарлал — устгалыг ГАРААР хийнэ (репогийн тогтсон конвенц,
--    0148-ийн тайлбартай ижил):
--      · `DELETE /api/projects/:id` → project_milestones-ийг устгана
--      · `DELETE /api/tasks/:id`    → холбоос task_id-г NULL болгоно
--      · `DELETE /api/blocks/:id`   → холбоос block_id-г NULL болгоно
--    Сүүлийн хоёр нь УСТГАХГҮЙ, зөвхөн холбоосыг тайлна: хугацаа өөрөө
--    таскаас хамааралгүй утгатай (гэрээний хугацаа таск устсан ч хэвээр).

CREATE TABLE IF NOT EXISTS project_milestones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- NULL = дээд түвшний хугацаа.  Утга орсон = дэд хугацаа.
  -- API нь 2 түвшнээр хязгаарлана (дээрх тайлбарыг үз).
  parent_id     INTEGER REFERENCES project_milestones(id) ON DELETE CASCADE,

  -- Хүн уншихаар нэр: «Экспертизийн дүгнэлт гарсан байх».
  title         TEXT    NOT NULL,

  -- 'YYYY-MM-DD'.  DB түвшинд шалгагдахгүй — API нь `isIsoDate`
  -- (lib/projectRisk.ts)-ээр шалгаж байж бичнэ.  ЗААВАЛ байх ёстой:
  -- огноогүй хугацаа гэдэг утгагүй.
  due_date      TEXT    NOT NULL,

  note          TEXT,

  -- Хариуцагч.  NULL = тодорхой хүн заагаагүй (удирдлагын хугацаа).
  owner_id      INTEGER REFERENCES users(id),

  -- СОНГОЛТООР ажилтай холбоно.  Аль нэг нь дүүрсэн бол «биелсэн» эсэх нь
  -- тухайн блок/таскийн явцаас АВТОМАТААР гарна (>= 100%), гараар
  -- тэмдэглэх шаардлагагүй.  Хоёулаа NULL бол `done_at`-аар гараар.
  -- Хоёуланг нь зэрэг өгвөл task_id давамгайлна (илүү нарийн).
  block_id      INTEGER REFERENCES blocks(id),
  task_id       INTEGER REFERENCES tasks(id),

  -- NULL = хийгдээгүй.  Утга орсон = биелсэн ('YYYY-MM-DD HH:MM:SS').
  -- Тусдаа `status` багана оруулаагүй: хоёр л төлөв байх тул огноо нь
  -- өөрөө төлөв бөгөөд «хэзээ дууссан» гэдгийг давхар хадгална
  -- (task_deadlines-ийн шийдтэй ижил).
  done_at       TEXT,
  done_by_id    INTEGER REFERENCES users(id),

  -- Хугацаа хэтэрсэн мэдэгдлийг НЭГ УДАА илгээхэд.  `project_reminders`
  -- маягийн тусдаа хүснэгт үүсгээгүй: milestone бүрт ЯГ НЭГ шат
  -- («хэтэрсэн») байгаа тул нэмэлт хүснэгт нь зөвхөн JOIN нэмнэ.
  -- `due_date` өөрчлөгдвөл API нь үүнийг NULL болгож дахин сануулах
  -- эрхийг нээнэ (timeline.ts-ийн PUT .../schedule нь project_reminders-ийг
  -- устгадагтай ижил зарчим).
  overdue_notified_at TEXT,

  sort_order    INTEGER NOT NULL DEFAULT 0,

  created_by_id INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Нэг төслийн хугацаануудыг огноогоор эрэмбэлэн унших («Хугацаа» таб,
-- төслийн жагсаалтын chip) — хамгийн түгээмэл асуулга.
CREATE INDEX IF NOT EXISTS idx_project_milestones_project
  ON project_milestones(project_id, due_date);

-- Огнооны мужаар шүүх (Dashboard-ийн зурвас, /app/deadlines хуанли).
CREATE INDEX IF NOT EXISTS idx_project_milestones_due
  ON project_milestones(due_date);

-- Дэд хугацаануудыг эцгээр нь цуглуулах.
CREATE INDEX IF NOT EXISTS idx_project_milestones_parent
  ON project_milestones(parent_id);
