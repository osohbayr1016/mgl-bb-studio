-- =============================================================
-- 0270_mgl_ai_model_releases.sql — MGL AI · ЗАГВАРЫН РЕЛИЗИЙН БҮРТГЭЛ
-- =============================================================
-- ЗОРИЛГО: «MGL AI 1.0» гэж ЯГ ЮУ болохыг нэг мөрөөр тодорхойлно —
-- суурь загвар, адаптер, багц, quantization, checksum, git commit.
--
-- ⚠️ ЯАГААД `assistant_models` (0195) БИШ ВЭ.  Тэр хүснэгт нь жинг
--    `weights_json` багана ДОТОР нь хадгалдаг (~200 KB ангилагч).
--    GGUF артефакт нь ГИГАБАЙТ — D1-ийн мөрөнд ОРОХГҮЙ.  Мөн тэнд
--    quantization, sha256, татах хаяг, буцаах хувилбар гэсэн ойлголт
--    байхгүй бөгөөд `idx_assistant_model_active` нь БҮХ гэр бүлд ганц
--    идэвхтэй мөр л зөвшөөрнө — MGL AI-д ажилтны 4B ба захиалагчийн
--    Lite ХОЁУЛАА зэрэг идэвхтэй байх ЁСТОЙ.
--
-- ⚠️ ГАНЦ ИДЭВХТЭЙ МӨР нь `runtime_variant` ТУС БҮРД.  Хэсэгчилсэн
--    ӨВӨРМӨЦ индекс үүнийг ӨГӨГДЛИЙН САНГИЙН түвшинд барина — UI-д
--    итгэхгүй.
--
-- ⚠️ `license_cleared` нь РЕЛИЗИЙН ХААЛГА.  Суурь жингийн лиценз
--    шалгагдаж `ai/registry/LICENSES.md`-д бичигдтэл 0 хэвээр байх ба
--    ModelManager татахаас ТАТГАЛЗАНА.  Энэ бол баримтжуулалт биш,
--    хаалга — 0221-ийн `verification_state`-тэй ижил заль.
--
-- ⚠️ `artifact_url` нь БИДНИЙ хяналтад байх ёстой (R2 эсвэл өөрийн
--    Worker).  Гуравдагч эх сурвалж руу шууд заах нь §37-ийн «зөвшөөрөгдсөн
--    манифест» дүрмийг зөрчинө.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 6 statement, блок тайлбаргүй, тайлбар дотор цэг-таслалгүй.

CREATE TABLE IF NOT EXISTS ai_model_releases (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  release_uid           TEXT    NOT NULL UNIQUE,
  product               TEXT    NOT NULL DEFAULT 'MGL AI',
  model_family          TEXT    NOT NULL DEFAULT 'mgl-ai',
  version               TEXT    NOT NULL,
  runtime_variant       TEXT    NOT NULL,
  base_model            TEXT    NOT NULL,
  base_model_license    TEXT,
  license_cleared       INTEGER NOT NULL DEFAULT 0 CHECK (license_cleared IN (0,1)),
  adapter               TEXT,
  dataset_version       TEXT,
  system_prompt_version TEXT,
  tool_schema_version   TEXT,
  retrieval_version     TEXT,
  quantization          TEXT,
  runtime               TEXT    NOT NULL DEFAULT 'llama.cpp',
  context_tokens        INTEGER NOT NULL DEFAULT 4096,
  artifact_url          TEXT,
  artifact_bytes        INTEGER,
  artifact_sha256       TEXT,
  min_vram_mb           INTEGER,
  min_ram_mb            INTEGER,
  eval_json             TEXT,
  eval_dataset_version  TEXT,
  eval_passed           INTEGER NOT NULL DEFAULT 0 CHECK (eval_passed IN (0,1)),
  build_commit          TEXT,
  build_date            TEXT,
  channel               TEXT    NOT NULL DEFAULT 'canary'
                          CHECK (channel IN ('canary','beta','stable','rolled_back')),
  is_active             INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  note                  TEXT,
  released_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_release_active ON ai_model_releases (runtime_variant) WHERE is_active = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_release_version ON ai_model_releases (model_family, version, runtime_variant);

CREATE INDEX IF NOT EXISTS idx_ai_release_channel ON ai_model_releases (channel, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_runtime_installs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  install_uid      TEXT    NOT NULL UNIQUE,
  user_id          INTEGER REFERENCES users(id) ON DELETE CASCADE,
  hostname         TEXT,
  os               TEXT,
  cpu              TEXT,
  ram_mb           INTEGER,
  gpu              TEXT,
  vram_mb          INTEGER,
  cuda             TEXT,
  runtime_version  TEXT,
  model_version    TEXT,
  runtime_variant  TEXT,
  engine           TEXT,
  last_seen_at     TEXT,
  last_bench_json  TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_install_user ON ai_runtime_installs (user_id, last_seen_at DESC);
