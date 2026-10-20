-- =============================================================
-- Migration 0142: Хэд хэдэн ахлагч (олон "senior") нэг ажилтныг үнэлэх
-- =============================================================
--
-- ⚠️⚠️  ЭНЭ ФАЙЛЫГ `wrangler d1 migrations apply`-ЭЭР БҮҮ АЖИЛЛУУЛ  ⚠️⚠️
--
-- `assessment_responses`-ийн UNIQUE(round_id, subject_user_id,
-- evaluator_kind) хязгаарлалтыг сулруулж UNIQUE(round_id, subject_user_id,
-- evaluator_kind, evaluator_user_id) болгохын тулд SQLite-д хүснэгтийг
-- бүтнээр нь дахин байгуулах (rebuild) шаардлагатай — CHECK/UNIQUE зэрэг
-- table-level constraint-ыг ALTER TABLE-ээр засах боломжгүй.
--
-- migration 0136 (users rebuild)-ийн адил зарчмаар: `migrations apply` нь
-- файлыг транзакцаар боодог тул DROP TABLE дунд юм буруудвал бүхэлдээ
-- буцна, гэхдээ энэ тохиолдолд шалтгаан өөр — 2026-08-06-нд шалгасан:
-- `grep -rn "REFERENCES assessment_responses" backend/migrations/` ХООСОН,
-- өөрөөр хэлбэл ЭНЭ хүснэгтийг ямар ч өөр хүснэгт FK-аар CASCADE-аар
-- заадаггүй тул users-ийн адил "40 хүүхэд хүснэгт устана" эрсдэл ЭНД
-- БАЙХГҮЙ. Гэсэн ч тогтсон, шалгагдсан аргачлалыг дагаж non-transactional
-- `d1 execute --file` замаар явуулна.
--
-- ⇒ Production дээр ЗӨВХӨН дараах дарааллаар (backend/-ээс) ажиллуулна:
--
--   1) Нөөцлөх (заавал):
--      npx wrangler d1 export mgl-progress-db --remote --config wrangler.toml \
--        --output ../backup-before-0142.sql
--
--   2) Rebuild (транзакцгүй зам):
--      npx wrangler d1 execute mgl-progress-db --remote --config wrangler.toml \
--        --file ./migrations/0142_assessment_multi_senior.sql
--
--   3) Шалгах:
--      npx wrangler d1 execute mgl-progress-db --remote --config wrangler.toml \
--        --command "PRAGMA foreign_key_check"          -- хоосон байх ёстой
--      npx wrangler d1 execute mgl-progress-db --remote --config wrangler.toml \
--        --command "SELECT COUNT(*) FROM assessment_responses"  -- өмнөх тоотой тэнцүү
--
--   4) Bookkeeping-ийг гараар тааруулах (эс бөгөөс дараагийн `migrations
--      apply` энэ файлыг ДАХИН ажиллуулна — CREATE/INSERT/DROP/RENAME нь
--      идемпотент БИШ тул хоёр дахь удаа алдаа өгнө):
--      npx wrangler d1 execute mgl-progress-db --remote --config wrangler.toml \
--        --command "INSERT INTO d1_migrations (name) VALUES ('0142_assessment_multi_senior.sql')"
--
-- Local dev DB дээр (миниflare, transactional+FK-enforcing тул) энэ
-- файлыг шууд .wrangler/state/v3/d1/.../*.sqlite дээр node:sqlite-ээр
-- ажиллуулна — `wrangler d1 execute --local --file` биш (rollback хийнэ).
--
-- -------------------------------------------------------------
-- Өөрчлөлт: UNIQUE(round_id, subject_user_id, evaluator_kind) →
--           UNIQUE(round_id, subject_user_id, evaluator_kind, evaluator_user_id)
-- Ингэснээр нэг ажилтанд ХЭД ХЭДЭН 'senior' мөр зэрэгцэн орших боломжтой
-- (өөр өөр evaluator_user_id-тай) — жишээ нь баг тус бүрийг 2 ахлагч
-- тус тусдаа бөглөж, дундаж нь оноо тооцооллын түвшинд гарна
-- (backend/src/lib/assessmentScore.ts, frontend lib/score.ts).
-- Бусад бүх багана/CHECK/DEFAULT нь 0139_assessments.sql-тэй яг ижил.
-- -------------------------------------------------------------

PRAGMA foreign_keys = OFF;

CREATE TABLE assessment_responses_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id          INTEGER NOT NULL REFERENCES assessment_rounds(id) ON DELETE CASCADE,
  subject_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evaluator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  evaluator_kind    TEXT    NOT NULL CHECK (evaluator_kind IN ('self', 'senior')),
  answers_json      TEXT    NOT NULL DEFAULT '{}',
  status            TEXT    NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'submitted')),
  submitted_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (round_id, subject_user_id, evaluator_kind, evaluator_user_id)
);

INSERT INTO assessment_responses_new (
  id, round_id, subject_user_id, evaluator_user_id, evaluator_kind,
  answers_json, status, submitted_at, created_at, updated_at
)
SELECT
  id, round_id, subject_user_id, evaluator_user_id, evaluator_kind,
  answers_json, status, submitted_at, created_at, updated_at
FROM assessment_responses;

DROP TABLE assessment_responses;

ALTER TABLE assessment_responses_new RENAME TO assessment_responses;

CREATE INDEX IF NOT EXISTS idx_assessment_responses_round
  ON assessment_responses(round_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_subject
  ON assessment_responses(subject_user_id);
CREATE INDEX IF NOT EXISTS idx_assessment_responses_evaluator
  ON assessment_responses(evaluator_user_id, status);

PRAGMA foreign_keys = ON;
