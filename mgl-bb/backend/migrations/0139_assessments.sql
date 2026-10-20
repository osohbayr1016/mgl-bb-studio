-- =============================================================
-- Ур чадвар / зан чанарын үнэлгээ (Assessments)
-- =============================================================
-- Дотоод судалгаа-тест хөдөлгүүр.  Эхний хэрэглээ: Архитекторуудын ур
-- чадварын тодорхойлолт (БА баг), жилд 1–2 удаа.  Дараа нь өөр судалгаа
-- нэмэгдэх тул асуулга нь КОДОНД БИШ, DB-д JSON схемээр хадгалагдана
-- (`schema_json`) — шинэ асуулга нэмэхэд migration хэрэггүй.
--
-- Схемийн каноник TypeScript тодорхойлолт хоёр газар ижилхэн байна:
--   backend/src/lib/assessmentSchema.ts
--   frontend/src/features/assessments/types.ts
-- Дэлгэрэнгүй: docs/dev/assessments-spec.md
--
-- Урсгал:
--   template (админ зохионо)
--     → round (ээлж; template-ийн схемийг SNAPSHOT хийж хуулна)
--       → participant (оролцогч + түүнийг үнэлэх багийн ахлагч)
--         → response × 2 (self = ажилтан өөрөө, senior = багийн ахлагч)
--
-- Оноолт (§1): must = мөрийн тоо × 5, average = ЗӨВХӨН бөглөгдсөн
-- (submitted) талуудын дундаж, pct = average / must × 100, level нь
-- схемийн band-аас.  Бүх бодолт route талд (lib/assessmentScore.ts).
--
-- Харах эрх (route талд хаагдана): ажилтан өөрийн маягт + ЗӨВХӨН level
-- текст; senior түүнд оногдсон маягтууд; admin бүх тоо/график/export.

-- Асуулгын загвар.  `schema_json` = AssessmentSchema (version/scales/levels/parts).
CREATE TABLE IF NOT EXISTS assessment_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,            -- 'ARCH_SKILLS_2026' г.м
  title_mn      TEXT    NOT NULL,
  title_en      TEXT,
  description   TEXT,
  schema_json   TEXT    NOT NULL DEFAULT '{}',      -- AssessmentSchema (JSON)
  status        TEXT    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'archived')),
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Судалгааны ээлж.  `schema_json` нь template-ийн SNAPSHOT: round нээгдсэний
-- дараа template засагдсан ч энэ round-ын асуулга/жин ӨӨРЧЛӨГДӨХГҮЙ.
CREATE TABLE IF NOT EXISTS assessment_rounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id   INTEGER NOT NULL REFERENCES assessment_templates(id) ON DELETE CASCADE,
  name          TEXT    NOT NULL,                   -- '2026 оны хагас жил' г.м
  period        TEXT    NOT NULL,                   -- '2026' / '2026-H1'
  status        TEXT    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'open', 'closed')),
  schema_json   TEXT    NOT NULL DEFAULT '{}',      -- template-ийн snapshot
  opens_at      TEXT,
  closes_at     TEXT,
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assessment_rounds_template
  ON assessment_rounds(template_id);

-- Оролцогч.  `evaluator_user_id` = түүнийг үнэлэх багийн ахлагч
-- (teams.lead_user_id).  NULL = ахлагчгүй (зөвхөн өөрийн үнэлгээ бөглөнө).
CREATE TABLE IF NOT EXISTS assessment_participants (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id          INTEGER NOT NULL REFERENCES assessment_rounds(id) ON DELETE CASCADE,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evaluator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (round_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_participants_round
  ON assessment_participants(round_id);
CREATE INDEX IF NOT EXISTS idx_assessment_participants_evaluator
  ON assessment_participants(evaluator_user_id);

-- Бөглөх маягт.  Нэг оролцогчид дээд тал нь 2 мөр: self + senior.
-- `answers_json` = { "<itemId>": 1..5 } хавтгай map (item id нь схемийнхтэй
-- тохирно).  `status='submitted'` болсны дараа засагдахгүй (route талд).
CREATE TABLE IF NOT EXISTS assessment_responses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id          INTEGER NOT NULL REFERENCES assessment_rounds(id) ON DELETE CASCADE,
  subject_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Бөглөх ЭЗЭН.  self үед subject_user_id-тэй ижил байна — ингэснээр
  -- эрхийн шалгалт нэг дүрэм болно: evaluator_user_id === user.sub.
  evaluator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  evaluator_kind    TEXT    NOT NULL CHECK (evaluator_kind IN ('self', 'senior')),
  answers_json      TEXT    NOT NULL DEFAULT '{}',
  status            TEXT    NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'submitted')),
  submitted_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (round_id, subject_user_id, evaluator_kind)
);

CREATE INDEX IF NOT EXISTS idx_assessment_responses_round
  ON assessment_responses(round_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_subject
  ON assessment_responses(subject_user_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_evaluator
  ON assessment_responses(evaluator_user_id, status);
