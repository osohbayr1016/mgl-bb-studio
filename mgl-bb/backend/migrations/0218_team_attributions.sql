-- =============================================================
-- 0218_team_attributions.sql — §73: илрүүлэлт нь БУЦААГДАХ ёстой
-- =============================================================
-- ЗОРИЛГО: v2 §73 нь тавыг хадгал гэж заасан — таасан баг, итгэлцэл,
-- эх сурвалж, ДАРАА НЬ БАТАЛГААЖСАН баг, залруулгын түүх.  `bim_sessions`
-- нь ЗӨВХӨН ОДООГИЙН төлөв; түүх нь энд, зөвхөн нэмэгддэг байдлаар.
--
-- ⚠️ ЗАЛРУУЛГА нь ХУУЧИН МӨРИЙГ УСТГАХГҮЙ.  Шинэ мөр нэмж, өмнөхийг
-- `superseded_by`-аар ХҮЧИНГҮЙ БОЛГОНО.  «Машин IZ гэж таасан, хүн BA гэж
-- зассан» гэдэг нь §66-ын хуурамч-эерэг хэмжилтийн ЦОРЫН ГАНЦ түүхий эд —
-- түүнийг устгах нь хэмжих боломжийг устгана.
--
-- ⚠️ БАГАНЫН ТОО: 18.  Баримтын §6/§7 нь «17» гэж бичсэн байсан нь
-- АРИФМЕТИКИЙН АЛДАА — §3.2-ын DDL өөрөө 18 багана зарладаг.  Нэг ч
-- баганыг хасаагүй: `scope_kind` нь ГАРГАЖ АВАХ БОЛОМЖГҮЙ (нэг мөр
-- session_id, revit_document_id, project_id ГУРВУУЛАНГ агуулж болно —
-- тэдгээр нь КОНТЕКСТ, харин `scope_kind` нь тэр залруулга ХЭР ХОЛ
-- үйлчлэхийг заана: `sticky` нь `document`, эс бөгөөс `session`).
-- Тиймээс ЗӨВ тоо нь 18 бөгөөд баримтын хүлээн авах шалгуур засагдав.
--
-- ⚠️ ХОЁР ТРИГГЕРИЙН ХЭЛБЭР нь 0206-ынхтой ЯГ ИЖИЛ: UPDATE нь ЗӨВХӨН
-- `superseded_at`-ыг NULL-ээс утга руу шилжүүлэх үед л зөвшөөрөгдөнө.
-- Багана заалт БИЧИХГҮЙ (`BEFORE UPDATE ON <t>`, `OF ...`-гүй) — 1B-1
-- §2.7-д хэмжсэнээр `BEFORE UPDATE OF col` нь дараа нь ALTER-ээр
-- нэмэгдсэн баганыг ХАМГААЛДАГГҮЙ.
--
-- ⚠️ `END;` нь ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД.  wrangler-ийн задлагчийн regex
-- нь регистрт мэдрэг — жижиг үсгээр бичвэл файл ХАГАС хэрэгжиж,
-- `d1_migrations` мөр БИЧИГДЭХГҮЙ ба цорын ганц засвар нь ШИНЭ ДУГААР.
--
-- ⚠️ REFERENCES БАЙХГҮЙ (0201-ийн шалтгаан).  `user_id`, `project_id`,
-- `revit_document_id` нь энгийн INTEGER — `users` (19 каскад хүүхэд) ба
-- `projects` (33) ХӨНДӨГДӨХГҮЙ.
--
-- ⚠️ ТЭЭВЭР: 8 statement (тааз 9 — триггер бүр `;`-ээр ХОЁР болж тоологдоно),
-- блок тайлбаргүй, мөрөн дотор цэг таслал АЛГА.
-- =============================================================

CREATE TABLE IF NOT EXISTS team_attributions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,

  -- --- ХАМРАХ ХҮРЭЭ ---
  -- session | document | project.  Нэг залруулга хэр өргөн үйлчлэхийг заана:
  -- `session` = зөвхөн энэ Revit процесс, `document` = энэ .rvt цаашид,
  -- `project` = төслийн бүх баримт.  §73-ын «сүүлд баталгаажсан баг».
  scope_kind          TEXT    NOT NULL DEFAULT 'session',
  session_id          INTEGER,
  revit_document_id   INTEGER,
  project_id          INTEGER,
  -- Хэний сесс/баримт дээр — ҮЙЛДЭГЧ.  Токеноос, клиентээс БИШ.
  user_id             INTEGER NOT NULL,

  -- --- ТААСАН (машин) ---
  inferred_team_code  TEXT,
  inferred_confidence REAL    NOT NULL DEFAULT 0,
  inferred_source     TEXT    NOT NULL DEFAULT 'uncertain',
  -- Шатны бүх нэр дэвшигч + оноо.  ЗАМ, ФАЙЛЫН НЭР ХАДГАЛАХГҮЙ (0202:39).
  evidence_json       TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(evidence_json)),
  -- 1-р ба 3-р шат ЗӨРЧИЛДВӨЛ ["BA","IZ"].  NULL = зөрчилгүй.
  conflict_json       TEXT,

  -- --- БАТАЛГААЖСАН (хүн) ---
  verified_team_code  TEXT,
  verified_by         INTEGER,
  verified_at         TEXT,
  -- manual | membership | manager.  Хүн ямар эрхээр баталгаажуулсан.
  verified_via        TEXT,

  -- --- ХҮЧИНТЭЙ ХУГАЦААНЫ ЗААГ ---
  superseded_by       INTEGER,
  superseded_at       TEXT,

  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_team_attr_session
  ON team_attributions (session_id, id DESC) WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_attr_doc
  ON team_attributions (revit_document_id, id DESC) WHERE revit_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_team_attr_live
  ON team_attributions (user_id, id DESC) WHERE superseded_at IS NULL;

CREATE TRIGGER IF NOT EXISTS team_attributions_append_only
BEFORE UPDATE ON team_attributions
WHEN NEW.superseded_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'team_attributions is append-only - only superseding may UPDATE');
END;

CREATE TRIGGER IF NOT EXISTS team_attributions_supersede_once
BEFORE UPDATE ON team_attributions
WHEN OLD.superseded_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'team_attributions row already superseded');
END;
