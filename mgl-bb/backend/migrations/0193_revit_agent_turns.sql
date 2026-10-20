-- 0193 — Revit AI туслахын ээлж бүрийн АУДИТ + хэрэглээний тоолуур.
--
-- Хоёр зорилго:
--  1. ӨРТӨГ нь таамаг биш ТОО байх.  Opus 5 дээр нэг хүсэлт ~$0.10-0.25;
--     20 инженер × өдөрт 6 хүсэлт бол сарын $260-660.  Энэ хүснэгтгүйгээр
--     тэр тоог хэн ч мэдэхгүй.
--  2. Цагийн хязгаар (нэг хэрэглэгч цагт 40 ээлж) — энэ хүснэгтээс тоолно.
--
-- Ярианы ТҮҮХИЙГ хадгалахгүй.  Add-in түүхээ өөрөө эзэмшдэг бөгөөд загварын
-- зураг, дотоод мэдээлэл яриан дунд явдаг тул серверт бөөнөөр хураахгүй.
-- Зөвхөн МЕТА өгөгдөл.
--
-- ⚠️ `users`-ийн CASCADE хүүхэд болж НЭМЭГДЭЖ байна.

CREATE TABLE IF NOT EXISTS revit_agent_turns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       TEXT    NOT NULL,
  turn_id      TEXT    NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,

  provider     TEXT    NOT NULL,
  model        TEXT,
  degraded     INTEGER NOT NULL DEFAULT 0 CHECK (degraded IN (0,1)),
  stop_reason  TEXT,

  tool_names   TEXT    NOT NULL DEFAULT '[]',
  message_count INTEGER NOT NULL DEFAULT 0,

  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,

  error        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Цагийн хязгаарын гол унших хэлбэр.
CREATE INDEX IF NOT EXISTS idx_revit_agent_user_time
  ON revit_agent_turns(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revit_agent_run
  ON revit_agent_turns(run_id, created_at);
-- Нэг ээлж хоёр удаа бүртгэгдэхгүй.
CREATE UNIQUE INDEX IF NOT EXISTS idx_revit_agent_turn_uniq
  ON revit_agent_turns(user_id, turn_id);

-- Нийлүүлэгч: 'anthropic' | 'workers-ai' | 'off'.
-- 'anthropic' сонгосон ч ANTHROPIC_API_KEY тавиагүй бол сервер УНАХГҮЙ,
-- хямд загвар руу шилжиж `degraded: true` гэж хэлнэ.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('revit.agent_provider', 'anthropic');
