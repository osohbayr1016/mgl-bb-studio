-- =============================================================
-- Migration 0176: Эцсийн хугацааны ОЛОН хариуцагч
-- =============================================================
--
-- ⚠️ ДУГААРЫН ТУХАЙ.  0174 ба 0175 нь production-ы `d1_migrations`-д
--    БҮРТГЭЛТЭЙ (0174_control_budget_drop_sig_line, 0175_control_budget_
--    sig_line_blank) хэдий ч тэдгээрийн файл энэ ажлын модонд БАЙХГҮЙ —
--    өөр хөгжүүлэгчийн салбараас хэрэгжсэн.  Мөн 0173 нь ХОЁР файлтай
--    (0173_user_stamp + 0173_project_milestones).  Тиймээс дараагийн
--    мөргөлдөөнгүй дугаар нь 0176.  Шинэ миграц нэмэхийн ӨМНӨ
--    `SELECT name FROM d1_migrations` -ийг production дээр ЗААВАЛ шалга.
--
-- ЯАГААД ХЭРЭГТЭЙ БОЛОВ?
-- ------------------------------------------------------------------
-- 0173-д эцсийн хугацаа бүр ГАНЦ `owner_id`-тэй байв.  Бодит ажилд нэг
-- хугацааг 2-3 хүн хамтарч барьдаг: «Экспертизийн дүгнэлт» гэдэг нь
-- тооцоочин, архитектор, инженер гурвын хамтын үр дүн.  Ганц эзэнтэй
-- үед бусад нь «Минийх» шүүлтээр өөрийн ажлаа ОГТ олж харахгүй байсан.
--
-- ЗАГВАР: `task_assignees`-ийн батлагдсан хэв маягийг дагав (нэг мөр =
-- нэг хүн, PRIMARY KEY-ээр давхардлыг таслана).  `tasks.assigned_to`
-- шиг «хуучин скаляр багана ЗЭРЭГЦЭЭ үлдээх» алдааг ДАВТААГҮЙ —
-- CLAUDE.md-д тэмдэглэсэнчлэн тэр хоёрыг гараар синк байлгах шаардлага
-- нь мөнхийн зөрүүний эх үүсвэр болдог.  Тиймээс `owner_id`-г ЭНД
-- бүрмөсөн ХАСНА, цорын ганц эх сурвалж нь доорх хүснэгт болно.
--
-- ⚠️ D1 нь runtime дээр FK-г хэрэгжүүлдэггүй тул устгалыг ГАРААР хийнэ:
--      · `DELETE /api/deadlines/milestones/:id` → assignees-ийг устгана
--      · `DELETE /api/projects/:id`             → мөн адил
--    (0173-ын толгойн конвенцтэй ижил.)

CREATE TABLE IF NOT EXISTS project_milestone_assignees (
  milestone_id INTEGER NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (milestone_id, user_id)
);

-- «Миний эцсийн хугацаанууд» — хэрэглэгчээр шүүх (Dashboard, самбар).
CREATE INDEX IF NOT EXISTS idx_milestone_assignees_user
  ON project_milestone_assignees(user_id);

-- Хуучин ганц эзнийг шинэ хүснэгт рүү зөөнө.  Production дээр 0 мөр
-- (шалгасан 2026-08-11), локал хөгжүүлэлтийн DB дээр цөөн мөр байж
-- болзошгүй — аль алинд нь аюулгүй.
INSERT OR IGNORE INTO project_milestone_assignees (milestone_id, user_id)
  SELECT id, owner_id FROM project_milestones WHERE owner_id IS NOT NULL;

-- Скаляр баганыг бүрмөсөн хасна (SQLite 3.35+; D1 дэмждэг — 2026-08-11-нд
-- шалгасан).  Дээрх INSERT-ийн ДАРАА байх ёстой.
ALTER TABLE project_milestones DROP COLUMN owner_id;
