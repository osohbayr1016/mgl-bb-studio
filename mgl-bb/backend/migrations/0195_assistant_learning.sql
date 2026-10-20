-- 0195 — Revit туслахын ӨӨРӨӨ СУРАЛЦАХ давхарга.
--
-- ЗОРИЛГО: API/LLM-гүйгээр ажилладаг САНАА ТАНИХ ангилагчийг байнга
-- сайжруулах.  Гурван хүснэгт:
--
--   assistant_examples  — сургалтын БАГЦ (үр + цэвэрлэсэн бодит хэрэглээ)
--   assistant_logs      — ТҮҮХИЙ хэрэглээ (юу бичсэн, юу таасан, зөв үү)
--   assistant_models    — сургагдсан ЗАГВАРЫН хувилбарууд
--
-- ⚠️ ЯАГААД ТУСДАА D1 БИШ, ЭНЭ САН ДОТОР ВЭ:
-- Сургалтын өгөгдөл нь `users`, `projects`, `tasks`-тай ХОЛБОГДОЖ байж үнэ
-- цэнтэй — «хэн, ямар төсөл дээр, ямар ажил хийж байхдаа ингэж асуусан».
-- Тусдаа сан тэр JOIN-ыг хийж чадахгүй.  Мөн нэг migration гинж, нэг
-- нөөцлөлт, нэг deploy — нэг үйлчлүүлэгчид хоёр D1 тохируулах нь илүүц.
-- Тусгаарлалтыг `assistant_` угтвараар барина.
--
-- ⚠️ НУУЦЛАЛ: `assistant_logs` нь инженерийн БИЧСЭН ТЕКСТИЙГ хадгална.
-- Загварын геометр, файлын агуулга ОГТ ОРОХГҮЙ.  Хадгалах хугацаа:
-- шошголж `assistant_examples` руу шилжсэн мөрийг 90 хоногийн дараа
-- цэвэрлэж болно (одоохондоо автомат цэвэрлэгээ БАЙХГҮЙ — гараар).
--
-- ⚠️ `users`-ийн 21 дэх CASCADE хүүхэд.

/* ================================================================== */
/*  1. Сургалтын багц                                                  */
/* ================================================================== */

CREATE TABLE IF NOT EXISTS assistant_examples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Хэрэглэгчийн бичих байсан ЯГ мөр.
  text        TEXT    NOT NULL,
  -- `lib/textFold.ts` -ийн `foldText` үр дүн.  Давхардал олох, хайхад.
  -- ⚠️ Сургалтад ТҮҮХИЙ `text`-ийг ашиглана — фолд нь зөвхөн индекс.
  text_folded TEXT    NOT NULL DEFAULT '',

  intent      TEXT    NOT NULL,
  -- isolate_sheet-д хуудасны дугаар (ж: «БА-01»).  Бусдад хоосон.
  slot        TEXT,

  -- cyrillic | latin | codeswitch | terse | polite | typo | question
  style       TEXT,

  -- seed   = гараар/AI-аар үүсгэсэн үр
  -- usage  = бодит хэрэглээнээс шошголсон
  -- manual = хүн гараар нэмсэн
  source      TEXT    NOT NULL DEFAULT 'seed'
                      CHECK (source IN ('seed','usage','manual')),

  -- Муу жишээг УСТГАХГҮЙ, унтраана — юу яагаад хасагдсаныг мэдэх ёстой.
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  note        TEXT,

  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ижил мөр хоёр удаа орохгүй (санаа тус бүрд).
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_ex_uniq
  ON assistant_examples(text, intent);
CREATE INDEX IF NOT EXISTS idx_assistant_ex_intent
  ON assistant_examples(intent, is_active);
CREATE INDEX IF NOT EXISTS idx_assistant_ex_folded
  ON assistant_examples(text_folded);

/* ================================================================== */
/*  2. Түүхий хэрэглээ                                                 */
/* ================================================================== */

CREATE TABLE IF NOT EXISTS assistant_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  -- Контекст: аль .rvt, хэдэн хуудастай.  Загварын АГУУЛГА ОРОХГҮЙ.
  doc_uid       TEXT,
  revit_version TEXT,

  text          TEXT    NOT NULL,

  -- ⚠️ Add-in локалд үүсгэсэн id.  Бүртгэл нь ЛОКАЛД эхлээд бичигдээд
  -- БАГЦААР илгээгддэг тул сүлжээ тасарч ДАХИН илгээгдэх нь хэвийн.
  -- (user_id, client_id) өвөрмөц индекс давхардлыг барина; 👍/👎 хожим
  -- ирэхэд ижил мөрийг ШИНЭЧИЛНЭ (upsert).
  client_id     TEXT    NOT NULL,

  -- Ангилагч юу таасан.
  predicted     TEXT,
  confidence    REAL,
  -- Аль давхарга шийдсэн: keyword | model | fallback
  decided_by    TEXT,

  -- Хэрэглэгч ЗАСВАЛ жинхэнэ санаа.  NULL = засаагүй.
  corrected     TEXT,
  -- 1 = 👍, -1 = 👎, NULL = юу ч дараагүй
  feedback      INTEGER CHECK (feedback IN (-1, 1)),
  -- Үйлдэл бодитоор ГҮЙЦЭТГЭГДСЭН эсэх (fallback дээр зогссон бол 0).
  acted         INTEGER NOT NULL DEFAULT 0 CHECK (acted IN (0,1)),

  -- Шошголж `assistant_examples` руу шилжүүлсэн эсэх.
  curated       INTEGER NOT NULL DEFAULT 0 CHECK (curated IN (0,1)),

  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Нэг бүртгэл хоёр удаа орохгүй; дахин илгээлт нь ШИНЭЧЛЭЛ болно.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_logs_client
  ON assistant_logs(user_id, client_id);

-- Гол унших хэлбэр: «шошголоогүй мөрүүд, шинэхнээс нь».
CREATE INDEX IF NOT EXISTS idx_assistant_logs_curate
  ON assistant_logs(curated, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_logs_user
  ON assistant_logs(user_id, created_at DESC);
-- Загварын чанарыг хэмжих: буруу таасан мөрүүд.
CREATE INDEX IF NOT EXISTS idx_assistant_logs_wrong
  ON assistant_logs(predicted, corrected) WHERE corrected IS NOT NULL;

/* ================================================================== */
/*  3. Сургагдсан загварууд                                            */
/* ================================================================== */

CREATE TABLE IF NOT EXISTS assistant_models (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Огноо + дугаар, ж: «2026-08-24.1»
  version      TEXT    NOT NULL UNIQUE,

  -- Загварын БҮХ жин, JSON.  ~200 KB.  Add-in татаж локалд кэшлэнэ.
  -- Хэлбэр: { intents:[…], vocab:{…}, idf:[…], coef:[[…]], intercept:[…] }
  weights_json TEXT    NOT NULL,

  intents_json TEXT    NOT NULL DEFAULT '[]',
  example_count INTEGER NOT NULL DEFAULT 0,
  -- Хөндлөн шалгалтын нарийвчлал (0..1).
  accuracy     REAL,
  -- Санаа тус бүрийн нарийвчлал, JSON.
  per_intent_json TEXT,

  -- ЗӨВХӨН НЭГ загвар идэвхтэй байна (доорх trigger барина).
  is_active    INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0,1)),
  note         TEXT,
  trained_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ⚠️ Хоёр загвар зэрэг идэвхтэй байвал add-in аль нь ирэхийг мэдэхгүй.
-- Хэсэгчилсэн ӨВӨРМӨЦ индекс нь үүнийг БҮРЭН хаана.
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_model_active
  ON assistant_models(is_active) WHERE is_active = 1;

/* ================================================================== */

-- Ангилагчийн итгэлцлийн доод босго.
--
-- ⚠️ ЭНЭ МӨРИЙГ ОДООХОНДОО ХЭН Ч УНШИХГҮЙ.  Add-in нь `IntentRouter.
-- MinConfidence`-ийг эмхэтгэлийн үед л авдаг; серверээс татах код БИЧИГДЭЭГҮЙ.
-- Тиймээс энэ утгыг өөрчлөхөд ЮУ Ч БОЛОХГҮЙ — add-in-ыг дахин барих хэрэгтэй.
-- Утгыг код дахь бодит утгатай (0.45) тааруулж бичив, эс тэгвээс дараа нь
-- уншсан хүн «0.55 байна» гэж бодох болно.
--
-- 0.45 нь таамаг БИШ: 2392 мөрийн хөндлөн шалгалтаар 91.9% хамрах хүрээнд
-- үйлдлийн 97.1% зөв гарсан (0.55 дээр 88.2% / 98.1%).
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('assistant.min_confidence', '0.45');

-- Хэрэглээг бүртгэх эсэх.  'off' болговол add-in бүртгэл илгээхээ болино.
INSERT OR IGNORE INTO app_settings (key, value)
VALUES ('assistant.logging', 'on');
