-- 0189 — Revit-ээс ирсэн илгээлт бүрийн АУДИТ + IDEMPOTENCY бүртгэл.
--
-- Гурван зорилго:
--  1. `UNIQUE(user_id, draft_uid)` нь `progress_entries`-т ХЭЗЭЭ Ч байгаагүй
--     давхардлын хамгаалалт.  Дахин оролдож буй add-in хоёр мөр бичихгүй.
--     ⚠️ Энэ нь ЗӨВХӨН Revit клиентийг хамгаална.  Вэб замд idempotency
--     байхгүй хэвээр — системийг «давхардалгүй» гэж тодорхойлж БОЛОХГҮЙ.
--
--  2. AI юу бичсэн (`ai_notes`) vs хүн юу илгээсэн (`notes`).
--     `edited_by_human`-ийг СЕРВЕР тооцно, биеэс уншихгүй.  «AI бичсэн үү,
--     хүн уншсан уу?» гэдэгт жилийн дараа ч хариулна.
--
--  3. `claim_state` — ХОЁР ҮЕ ШАТТАЙ бичилтийн тодорхой бус байдлыг арилгана.
--     `progress_entry_id IS NULL` ганцаараа ХОЁР ялгаатай тохиолдлыг илэрхийлдэг:
--       (a) submitProgressEntry огт дуудагдаагүй  → дахин оролдож БОЛНО
--       (b) дуудагдаж АМЖИЛТТАЙ болоод seal хийх UPDATE унасан → дахин
--           оролдвол ХОЁР progress_entries мөр + ХОЁР user_points үүснэ
--     Тиймээс submitProgressEntry дуудахаас ӨМНӨ 'submitting' гэж тамгална.
--       'claimed'    → мөр авсан, бичилт эхлээгүй  → үргэлжлүүлж болно
--       'submitting' → бичилт эхэлсэн, үр дүн МЭДЭГДЭХГҮЙ → 409 indeterminate
--       'sealed'     → progress_entry_id бичигдсэн  → 200 duplicate
--
-- `change_json.self_reported` нь ҮРГЭЛЖ true — өөрчлөлтийн тоо add-in-ий
-- локал snapshot-оос ирдэг тул сервер БАТАЛГААЖУУЛААГҮЙ өгөгдөл.
--
-- ⚠️ `users`-ийн 20 дахь CASCADE хүүхэд, `projects`-ийн 36 дахь.
-- ⚠️ `progress_entry_id` нь ON DELETE SET NULL боловч progress_entries-д
-- устгах route өнөөдөр БАЙХГҮЙ тул гар цэвэрлэгээ одоохондоо шаардлагагүй.
-- Ийм route нэмбэл энд SET NULL хийх мөрийг ГАРААР нэмэх ёстой.

CREATE TABLE IF NOT EXISTS revit_submissions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_uid            TEXT    NOT NULL,
  user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id              INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  revit_document_id    INTEGER REFERENCES revit_documents(id) ON DELETE SET NULL,
  progress_entry_id    INTEGER REFERENCES progress_entries(id) ON DELETE SET NULL,

  claim_state          TEXT    NOT NULL DEFAULT 'claimed'
                               CHECK (claim_state IN ('claimed','submitting','sealed')),

  percentage           REAL    NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
  suggested_percentage REAL,
  prev_percentage      REAL,
  percent_basis        TEXT    CHECK (percent_basis IN ('checklist','sheets','manual','none')),
  checklist_done       INTEGER NOT NULL DEFAULT 0,
  checklist_total      INTEGER NOT NULL DEFAULT 0,

  notes                TEXT    NOT NULL DEFAULT '',
  ai_notes             TEXT,
  ai_model             TEXT,
  ai_prompt_version    TEXT,
  edited_by_human      INTEGER NOT NULL DEFAULT 0 CHECK (edited_by_human IN (0,1)),

  sheet_uids_json      TEXT    NOT NULL DEFAULT '[]',
  change_json          TEXT    NOT NULL DEFAULT '{}',
  evidence_json        TEXT    NOT NULL DEFAULT '[]',
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  sealed_at            TEXT
);

-- ЭНЭ ИНДЕКС нь хоёр үе шаттай бичилтийн түгжээ.
CREATE UNIQUE INDEX IF NOT EXISTS idx_revit_submissions_draft
  ON revit_submissions(user_id, draft_uid);
CREATE INDEX IF NOT EXISTS idx_revit_submissions_entry
  ON revit_submissions(progress_entry_id);
CREATE INDEX IF NOT EXISTS idx_revit_submissions_task
  ON revit_submissions(task_id, created_at DESC);
-- Гацсан бичилт хайх (claim_state='submitting' + progress_entry_id IS NULL).
CREATE INDEX IF NOT EXISTS idx_revit_submissions_stuck
  ON revit_submissions(claim_state, created_at) WHERE progress_entry_id IS NULL;
