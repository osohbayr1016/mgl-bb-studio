-- =============================================================
-- 0269_mgl_ai_feedback.sql — MGL AI · САНАЛ ХҮСЭЛТ ба СУРГАЛТЫН ДАРААЛАЛ
-- =============================================================
-- ЗОРИЛГО: 👍/👎 → шалтгаан → залруулга → АДМИНЫ БАТАЛГАА → хувилбартай
-- багц.  Амьд жин ХЭЗЭЭ Ч энэ хүснэгтээс шууд өөрчлөгдөхгүй.
--
-- ⚠️ ХОРЛОЛЫН ЭСРЭГ ГОЛ ЗАРЧИМ: `review_state` нь 'pending'-ээс эхэлнэ.
--    0215-ийн `assistant_examples.review_state` нь ЗОРИУД 'verified'-ээс
--    эхэлдэг (тэнд өгөгдмөл нь экспортыг хоосруулахгүй байх ёстой байсан),
--    гэвч ЭНД эсрэг шаардлага үйлчилнэ: дуртай хүн санал өгнө, зөвхөн
--    админ баталгаажуулна.  Хоёр хүснэгтийн өгөгдмөл ӨӨР байх нь алдаа
--    БИШ — тэд өөр өөр эрсдэлийг барина.
--
-- ⚠️ `voter_key` — нэвтрээгүй захиалагч ч санал өгнө (0268-ын `user_id`
--    NULL байж болно).  ЗӨВХӨН `user_id`-д ӨВӨРМӨЦ индекс тавибал
--    SQLite NULL-уудыг ЯЛГААТАЙ гэж үздэг тул нэг нэргүй хүн нэг
--    мессежийг хязгааргүй удаа дарж чадна.  `voter_key` нь нэвтэрсэн
--    хэрэглэгчид u:<id>, нэвтрээгүйд a:<anon session> болно.
--
-- ⚠️ КОНТЕКСТЫГ ХУУЛБАРЛАХГҮЙ, ЗААНА.  `context_ref` / `tool_trace_ref` /
--    `revit_context_ref` нь ЗААГЧ (`ai_messages.msg_uid`, R2 түлхүүр,
--    `bim_sessions.session_uid`).  Нууц агуулгыг санал хүсэлтийн мөрөнд
--    хоёр дахин хадгалах нь нууцлалын хилийг ХОЁР ДАХИН өргөнө.
--    `prompt_snapshot` / `answer_snapshot` нь ГАНЦ үл хамаарах зүйл —
--    сургалтын жишээ болохын тулд асуулт, хариу хоёр ЗААВАЛ хэрэгтэй ба
--    мессеж 90 хоногийн дараа цэвэрлэгдэж болно.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 5 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_feedback (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_uid              TEXT    NOT NULL,
  msg_uid               TEXT    NOT NULL,
  voter_key             TEXT    NOT NULL,
  user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_mode             TEXT    NOT NULL DEFAULT 'employee'
                          CHECK (user_mode IN ('client','employee','admin')),
  org_id                INTEGER,
  vote                  INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  reason_codes_json     TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(reason_codes_json)),
  reason_text           TEXT,
  corrected_answer      TEXT,
  prompt_snapshot       TEXT,
  answer_snapshot       TEXT,
  model_family          TEXT    NOT NULL DEFAULT 'mgl-ai',
  model_version         TEXT,
  runtime_variant       TEXT,
  system_prompt_version TEXT,
  tool_schema_version   TEXT,
  context_ref           TEXT,
  tool_trace_ref        TEXT,
  revit_context_ref     TEXT,
  source_ids_json       TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(source_ids_json)),
  latency_ms            INTEGER,
  first_token_ms        INTEGER,
  prompt_tokens         INTEGER,
  completion_tokens     INTEGER,
  review_state          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (review_state IN ('pending','reviewed','approved','rejected','needs_correction','included_in_dataset','included_in_training_run')),
  reviewed_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           TEXT,
  review_note           TEXT,
  dataset_version       TEXT,
  training_run_uid      TEXT,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_fb_voter ON ai_feedback (msg_uid, voter_key);

CREATE INDEX IF NOT EXISTS idx_ai_fb_queue ON ai_feedback (review_state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_fb_conv ON ai_feedback (conv_uid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_fb_dataset ON ai_feedback (dataset_version) WHERE dataset_version IS NOT NULL;
