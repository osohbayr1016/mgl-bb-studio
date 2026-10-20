-- =============================================================
-- 0268_mgl_ai_conversations.sql — MGL AI · ЯРИАНЫ ЛЕДЖЕР
-- =============================================================
-- ЗОРИЛГО: MGL AI 1.0-ийн чатын түүх.  Өнөөдөр репод ярианы ЯМАР Ч
-- сервер талын хадгалалт БАЙХГҮЙ — add-in-ийн `Conversation.cs` нь
-- транскриптыг ЛОКАЛД барьж, ээлж бүрт бүтнээр нь дахин илгээдэг
-- (`lib/revitAgent.ts` бол ТӨЛӨВГҮЙ прокси).  Санал хүсэлт, аудит,
-- сургалтын багц гурвуулаа «аль мессеж» гэдгийг заах ТОГТМОЛ id
-- шаарддаг тул тэр id серверт төрөх ёстой.
--
-- ⚠️ ЯАГААД `assistant_logs` (0195) БИШ ВЭ.  Тэр хүснэгт нь САНАА ТАНИХ
--    АНГИЛАГЧИЙН бүртгэл: нэг мөр = нэг өгүүлбэр + таасан intent +
--    confidence.  Түүнд ярианы дараалал, tool дуудлага, эшлэл, streaming
--    хугацаа гэсэн ойлголт БАЙХГҮЙ бөгөөд `idx_assistant_logs_client`
--    нь (user_id, client_id)-ээр ӨВӨРМӨЦ тул нэг ярианы 20 мессежийг
--    хүлээж авахгүй.  Хоёр гэр бүлийг ЗОРИУД тусад нь барина:
--    `assistant_*` = ангилагч, `bim_*` = үйл явдлын леджер, `ai_*` = MGL AI.
--
-- ⚠️ `conv_uid` / `msg_uid` нь КЛИЕНТЭЭС ирнэ.  Add-in ба браузер хоёулаа
--    сүлжээ тасрахад ДАХИН илгээдэг тул ӨВӨРМӨЦ индекс нь давхардлыг
--    барьж, дахин илгээлт нь INSERT биш UPSERT болно.  0195-ийн
--    `client_id` заншлыг ЯГ дагав.
--
-- ⚠️ `user_id` нь NULL байж БОЛНО — нэвтрээгүй захиалагчийн (client mode)
--    яриа.  Тиймээс `voter_key` (0269) шаардлагатай болно.
--
-- ⚠️ `users`-ийн ДАРААГИЙН CASCADE хүүхэд.  D1 ажиллах үедээ FK-г
--    албаддаггүй тул `DELETE /api/users/:id` нь хүүхдээ ГАРААР устгадаг
--    заншилтай (email.ts, calendar.ts, pgp.ts, repair.ts).  MGL AI-ийн
--    цэвэрлэгээ нь `lib/mglai/purge.ts`-д НЭГ дор байна.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 6 statement (тааз 9), блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_conversations (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_uid              TEXT    NOT NULL UNIQUE,
  user_id               INTEGER REFERENCES users(id) ON DELETE CASCADE,
  mode                  TEXT    NOT NULL DEFAULT 'employee'
                          CHECK (mode IN ('client','employee','admin')),
  org_id                INTEGER,
  project_id            INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  surface               TEXT    NOT NULL DEFAULT 'web'
                          CHECK (surface IN ('web','revit','api')),
  title                 TEXT,
  model_family          TEXT    NOT NULL DEFAULT 'mgl-ai',
  model_version         TEXT,
  runtime_variant       TEXT,
  system_prompt_version TEXT,
  tool_schema_version   TEXT,
  message_count         INTEGER NOT NULL DEFAULT 0,
  last_message_at       TEXT,
  status                TEXT    NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','archived','purged')),
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations (user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_conv_mode ON ai_conversations (mode, status, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conv_uid          TEXT    NOT NULL,
  msg_uid           TEXT    NOT NULL,
  seq               INTEGER NOT NULL DEFAULT 0,
  role              TEXT    NOT NULL
                      CHECK (role IN ('user','assistant','tool','system')),
  content           TEXT    NOT NULL DEFAULT '',
  tool_name         TEXT,
  tool_args_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(tool_args_json)),
  tool_result_json  TEXT,
  citations_json    TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(citations_json)),
  confidence        TEXT    CHECK (confidence IN ('verified','supported','uncertain','insufficient')),
  evidence_count    INTEGER NOT NULL DEFAULT 0,
  model_version     TEXT,
  runtime_variant   TEXT,
  first_token_ms    INTEGER,
  total_ms          INTEGER,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  stop_reason       TEXT,
  error             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_msg_uid ON ai_messages (conv_uid, msg_uid);

CREATE INDEX IF NOT EXISTS idx_ai_msg_seq ON ai_messages (conv_uid, seq);
