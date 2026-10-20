-- =============================================================
-- Migration 0148: «Дэд хугацаа» (task sub-deadlines)
-- =============================================================
--
-- Даалгавар бүрийг дотор нь жижиг ШАЛГАХ ЦЭГ болгон задлах боломж.
-- Жишээ: «BA-03 планыг зурах» гэсэн нэг таск дотор
--   · 08-15 — тэнхлэгийн сүлжээ бэлэн
--   · 08-22 — хаалга/цонхны нээлхий тавигдсан
--   · 08-30 — хэмжээс, тэмдэглэгээ бүрэн
-- гэсэн гурван дэд хугацаа.
--
-- ⚠️ ЭНЭ БОЛ ШАЛГАХ ЦЭГ — АЖЛЫН НЭГЖ БИШ.  Дэд хугацаа нь:
--   · MyTasks (`/app/my-tasks`)-д ГАРАХГҮЙ,
--   · батлах дараалалд (approvals) ОРОХГҮЙ,
--   · оноо / leaderboard-д ОГТ нөлөөлӨХГҮЙ,
--   · явцын бичилт (progress_entries) хүлээж авахгүй.
-- Зөвхөн «хэзээ юу бэлэн байх ёстой вэ» гэдгийг тэмдэглэж, дуусгасан
-- эсэхийг `done_at`-аар тэмдэглэнэ.
--
-- ЯАГААД weight_percent = 0 таск БИШ, тусдаа хүснэгт вэ?
-- ------------------------------------------------------------------
-- Анхны санаа нь `lib/meetingTasks.ts`-ийн загвараар (жин 0 таск тусдаа
-- блок дор) хийх байсан.  Жин 0 нь нэгтгэсэн явцын үржвэрийг 0 болгодог
-- тул rollup-д ҮНЭХЭЭР нөлөөлөхгүй — ГЭХДЭЭ мөр нь `tasks` хүснэгтэд
-- БАЙСАН ХЭВЭЭР үлдэнэ, тиймээс task гэж үздэг БҮХ асуулгад цухуйна:
--
--   · `routes/company.ts:230` — `SELECT COUNT(*) FROM tasks
--     WHERE due_date IS NOT NULL AND due_date < ?` — жин шалгадаггүй тул
--     дэд хугацаа бүр компанийн «хугацаа хэтэрсэн» KPI-г гуйвуулна;
--   · MyTasks, approvals queue, `tasks.get('/')`, points recalc — бүгд
--     ижил байдлаар цугларна.
--
-- Тусдаа child хүснэгт нь blocks→drawings→components→tasks модонд ОГТ
-- байхгүй тул rollup-д орох нь БҮТЦИЙН ХУВЬД БОЛОМЖГҮЙ — «жингээр 0»
-- гэсэн зөөлөн баталгаанаас хамаагүй хатуу.
--
-- ⚠️ ЗӨВХӨН НЭМЭЛТ (additive).  DROP TABLE байхгүй, байгаа хүснэгтийн
--    CHECK-д гар хүрэхгүй, parent rebuild БИШ.  Тиймээс энгийн
--    `wrangler d1 migrations apply`-аар аюулгүй хэрэглэнэ (path B
--    хэрэггүй — 0136_worker_role.sql-ийн runbook энд ХАМААРАХГҮЙ).
--
-- ⚠️ D1 нь runtime дээр FK-г ХЭРЭГЖҮҮЛДЭГГҮЙ.  Доорх `ON DELETE CASCADE`
--    нь зөвхөн зарлал — `DELETE /api/tasks/:id` нь `task_deadlines`-ийг
--    ГАРААР устгана (routes/tasks.ts-ийг үз).  Энэ бол репогийн тогтсон
--    конвенц (email.ts / calendar.ts / pgp.ts / repair.ts ижил байдлаар
--    хүүхэд мөрөө гараар цэвэрлэдэг).

CREATE TABLE IF NOT EXISTS task_deadlines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

  -- Хүн уншихаар нэр: «Тэнхлэгийн сүлжээ бэлэн».
  title         TEXT    NOT NULL,

  -- 'YYYY-MM-DD'.  DB түвшинд шалгагдахгүй — API нь `isIsoDate`
  -- (lib/projectRisk.ts)-ээр шалгаж байж бичнэ.  Паспортын огооны
  -- баганаас ялгаатай нь энэ нь ЗААВАЛ байх ёстой: огноогүй дэд хугацаа
  -- гэдэг утгагүй.
  due_date      TEXT    NOT NULL,

  note          TEXT,

  -- NULL = эцэг таскийн эздийнх.  Тодорхой хүн заавал өгөх шаардлагагүй.
  assignee_id   INTEGER REFERENCES users(id),

  -- NULL = хийгдээгүй.  Утга орсон = биелсэн ('YYYY-MM-DD HH:MM:SS').
  -- Тусдаа `status` багана оруулаагүй: хоёр л төлөв байх тул огноо нь
  -- өөрөө төлөв бөгөөд «хэзээ дууссан» гэдгийг давхар хадгална.
  done_at       TEXT,
  done_by_id    INTEGER REFERENCES users(id),

  sort_order    INTEGER NOT NULL DEFAULT 0,

  created_by_id INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Нэг таскийн дэд хугацаануудыг огноогоор эрэмбэлэн унших (хамгийн түгээмэл).
CREATE INDEX IF NOT EXISTS idx_task_deadlines_task
  ON task_deadlines(task_id, due_date);

-- «Ойрын хугацаанууд» (Dashboard) — огнооны мужаар шүүх.
CREATE INDEX IF NOT EXISTS idx_task_deadlines_due
  ON task_deadlines(due_date);
