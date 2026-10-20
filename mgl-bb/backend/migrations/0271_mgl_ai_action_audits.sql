-- =============================================================
-- 0271_mgl_ai_action_audits.sql — MGL AI · ҮЙЛДЛИЙН АУДИТ
-- =============================================================
-- ЗОРИЛГО: MGL AI-ийн санаачилсан БҮХ хэрэгслийн дуудлага — уншсан ч,
-- бичсэн ч — мөшгигдөнө.  Revit-ийн бичилт бүрд «хэн, хэзээ, ямар
-- хувилбар, ямар аргумент, ямар элемент, баталсан уу, үр дүн юу».
--
-- ⚠️ ЯАГААД `revit_transactions` (0203) БИШ ВЭ.  Тэр нь ХҮНИЙ Revit доторх
--    гүйлгээний леджер бөгөөд `lib/bimEvents.ts` гэсэн ГАНЦ бичих гарцтай,
--    append-only trigger-ээр хамгаалагдсан (0206).  AI-ийн санаачилсан
--    үйлдэл нь ӨӨР асуултад хариулна: «ямар prompt үүнийг үүсгэв, хэн
--    зөвшөөрөв, ямар загварын хувилбар байв».  Хоёуланг нэг хүснэгтэд
--    хийвэл 0206-ийн trigger нь AI-ийн мөрийг ч хөлдөөх ба
--    `confirmed_at` дараа нь бичигдэж ЧАДАХГҮЙ.
--
-- ⚠️ `decision` нь ЗААВАЛ бичигдэнэ.  'auto' нь ЗӨВХӨН READ_ONLY
--    ангиллын хэрэгсэлд эсвэл FULL_AGENT профайлд зөвшөөрөгдөнө —
--    хаалгыг `lib/mglai/permissions.ts` барина, энэ хүснэгт нь БАРИМТ.
--
-- ⚠️ УНШИХ ЭРХ: ажилтан ЗӨВХӨН өөрийн мөрөө харна (0195-ийн хувийн
--    нууцын үл хөдлөх дүрэм).  Админ нэгтгэсэн тоо харна.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 4 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_action_audits (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  action_uid        TEXT    NOT NULL UNIQUE,
  conv_uid          TEXT,
  msg_uid           TEXT,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_mode         TEXT    NOT NULL DEFAULT 'employee'
                      CHECK (user_mode IN ('client','employee','admin')),
  surface           TEXT    NOT NULL DEFAULT 'web'
                      CHECK (surface IN ('web','revit','api')),
  tool_name         TEXT    NOT NULL,
  tool_kind         TEXT    NOT NULL DEFAULT 'read'
                      CHECK (tool_kind IN ('read','view','write','admin')),
  permission_level  TEXT    NOT NULL DEFAULT 'READ_ONLY',
  decision          TEXT    NOT NULL DEFAULT 'auto'
                      CHECK (decision IN ('auto','confirmed','cancelled','denied','error')),
  args_json         TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(args_json)),
  preview_json      TEXT,
  project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  doc_uid           TEXT,
  element_count     INTEGER NOT NULL DEFAULT 0,
  element_ids_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(element_ids_json)),
  model_version     TEXT,
  runtime_variant   TEXT,
  tool_schema_version TEXT,
  requested_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  confirmed_at      TEXT,
  completed_at      TEXT,
  duration_ms       INTEGER,
  result            TEXT    NOT NULL DEFAULT 'pending'
                      CHECK (result IN ('pending','ok','failed','rolled_back')),
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_ai_audit_user ON ai_action_audits (user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_conv ON ai_action_audits (conv_uid, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_audit_write ON ai_action_audits (tool_kind, result, requested_at DESC);
