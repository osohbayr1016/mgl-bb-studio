-- =====================================================================
-- 0242_addin_installs.sql — СУУЛГАЦ БҮРИЙН ЭРҮҮЛ МЭНД
-- =====================================================================
-- ЗОРИЛГО: v2 §74-ийн «Each installed client should expose: add-in version,
-- model version, rules version, configuration version, installation health».
-- Таван утга + өөрийн шалгалтын үр дүн энд буудаг.
--
-- ⚠️ ГРЭЙН: НЭГ мөр = (хэрэглэгч, машин, Revit он).  Нэг ажилтан 2024 ба 2027
-- хоёуланг ажиллуулж болно — тэр нь ХОЁР суулгац.  Нэг машин дээр хоёр хүн
-- нэвтэрч болно — тэр нь ХОЁР мөр.
--
-- ⚠️ machine_hash нь sha256 — МАШИНЫ НЭР БИШ, ЗАМ БИШ.  0202_bim_sessions.sql
-- дэх ижил дүрэм.  Add-in түүнийг ӨӨРӨӨ хэшлэж илгээнэ
-- (revit-mcp/addin/BimEmitter.cs-ийн MachineHash-тай ЯГ ИЖИЛ функц —
-- ChangeTracker.Sha256Hex(MachineName|UserDomainName|UserName) — эс бөгөөс
-- нэг машин хоёр өөр хэшээр харагдана).
--
-- ⚠️ ӨӨРИЙН ХАРАХ ДҮРЭМ (0201:23-32 ба гурван migration толгойд давтагдсан):
-- энэ хүснэгтийн УНШИХ route бүр нь эсвэл `user_id = viewer.sub`, эсвэл
-- ЗӨВХӨН НЭГТГЭСЭН тоо буцаана.  «Хэн хамгийн олон алдаатай суулгацтай вэ»
-- гэсэн хүн нэрлэсэн жагсаалт ХЭЗЭЭ Ч гарахгүй.  Суулгацын эрүүл мэнд нь
-- МАШИНЫ шинж чанар, ХҮНИЙ гүйцэтгэлийн үзүүлэлт БИШ.
--
-- ⚠️ `health_json` нь JSON-ийн БЛОБ + GENERATED VIRTUAL скаляр — 0216-ийн
-- `timing_json` хэв маягийг ҮГ ҮСГЭЭР давтав.  Шинэ шалгалт нэмэхэд миграц
-- ШААРДЛАГАГҮЙ болгох нь зорилго.
--
-- ⚠️ GENERATED багана нь CREATE TABLE ДОТОР.  SQLite-ийн
-- `ALTER TABLE ADD COLUMN` нь `IF NOT EXISTS`-ыг дэмждэггүй тул тусад нь
-- ALTER бичих хувилбар нь ДАХИН АЖИЛЛУУЛАХАД `duplicate column name` өгнө.
--
-- ⚠️ users-ыг ХӨНДӨХГҮЙ — зөвхөн REFERENCES.  `users`-д 19 cascade хүүхэд
-- байгаа тул түүнийг `migrations apply`-аар дахин барих нь БҮХ хүүхэд мөрийг
-- арчина.  Энд ийм алхам БАЙХГҮЙ.
--
-- ⚠️ ТЭЭВЭР: 4 statement (<= 9), блок тайлбаргүй, мөрөн дотор цэг таслал АЛГА.
-- =====================================================================

CREATE TABLE IF NOT EXISTS addin_installs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,

  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine_hash     TEXT    NOT NULL,
  revit_year       TEXT    NOT NULL,
  revit_build      TEXT,

  -- §74-ийн ТАВАН заавал утга -----------------------------------------
  addin_version    TEXT    NOT NULL,
  model_version    TEXT,
  ruleset_version  TEXT,
  config_version   TEXT,
  health           TEXT    NOT NULL DEFAULT 'unknown'
                     CHECK (health IN ('ok','degraded','failed','unknown')),

  -- Нэмэлт нотолгоо ----------------------------------------------------
  pack_sha256      TEXT,
  release_sha256   TEXT,
  channel          TEXT    NOT NULL DEFAULT 'prod',
  model_source     TEXT,
  authority_level  TEXT,

  -- Өөрийн шалгалтын БҮТЭН үр дүн.  { ok:[...], failed:[...], skipped:[...], ts }
  health_json      TEXT    NOT NULL DEFAULT '{}'
                     CHECK (json_valid(health_json) AND json_type(health_json) = 'object'),

  -- Унасан шалгалтын ТОО — индексжүүлэхийн тулд.  Bind зардал ТЭГ.
  sc_failed        INTEGER GENERATED ALWAYS AS
                     (COALESCE(json_array_length(json_extract(health_json, '$.failed')), 0)) VIRTUAL,

  first_seen_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Upsert-ийн түлхүүр.  Нэг машин x нэг хүн x нэг Revit он = НЭГ мөр.
CREATE UNIQUE INDEX IF NOT EXISTS idx_addin_inst_uniq
  ON addin_installs (user_id, machine_hash, revit_year);

-- «Парк даяар аль хувилбар хэдэн машин дээр байна» — §74-ийн ТООЛЛОГО.
CREATE INDEX IF NOT EXISTS idx_addin_inst_version
  ON addin_installs (addin_version, revit_year, last_seen_at DESC);

-- «Ямар суулгац эвдэрсэн байна» — ЗӨВХӨН НЭГТГЭСЭН тайланд.
CREATE INDEX IF NOT EXISTS idx_addin_inst_bad
  ON addin_installs (health, last_seen_at DESC) WHERE health <> 'ok';
