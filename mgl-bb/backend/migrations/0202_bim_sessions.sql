-- =============================================================
-- 0202_bim_sessions.sql — БҮРТГЭЛИЙН СЕССИЙН ХЭМЖЭЭС (dimension)
-- =============================================================
--
-- ЗОРИЛГО: «хэн, ямар төсөл дээр, ямар баримт дээр, ямар Revit-ээр, ямар
-- add-in build-ээр, ямар загварын хувилбартай, хэдийд» гэсэн ГАРЛЫН
-- МЭДЭЭЛЛИЙГ НЭГ УДАА бичих.
--
-- ⚠️ ЯАГААД ТУСДАА ХЭМЖЭЭС ВЭ — энэ бол D1-ийн ТӨЛБӨРИЙН шийдвэр.
--    Гарлын 10 талбарыг гүйлгээ бүрд давтвал (жилд ~3.7 сая мөр) тэдгээр
--    нь мөр тутамд ~120 нэмэлт байт болно = ЖИЛД ~440 МБ ЗӨВХӨН давталт.
--    D1-ийн НЭГ САНГИЙН ТААЗ 10 ГБ бөгөөд тэр нь и-мэйлийн бие, үнийн
--    санал, бусад БҮГДТЭЙ ХУВААЛЦСАН (өнөөдөр нийт 48.8 МБ).  Мөн D1 нь
--    УНШСАН МӨРӨӨР төлбөр авдаг тул нарийн хүснэгт = хямд асуулга.
--    Сессийн мөр: 49 инженер × өдөрт ~10 сесс × 250 өдөр = ЖИЛД ~122k мөр.
--
-- ⚠️ ЭНЭ БОЛ БҮХ БАГЦЫН ЦОРЫН ГАНЦ ХУВЬСДАГ (mutable) ХҮСНЭГТ.
--    0206-ын append-only trigger ЭНД ТАВИГДАХГҮЙ — `ended_at`, тоолуурууд,
--    `last_seen_at` нь сессийн явцад шинэчлэгдэнэ.  Бусад дөрвөн хүснэгт
--    (`bim_artifacts`, `revit_transactions`, `revit_element_touches`,
--    `learning_events`) нь ЯМАР Ч тохиолдолд append-only.
--    ⚠️ Иймд ГАРЛЫН талбарууд (`revit_version`, `addin_version`,
--    `model_version`, `ruleset_version`) нь ЗАРЧМЫН ХУВЬД дарж бичигдэж
--    болно.  Тэднийг сесс эхлэхэд НЭГ УДАА бичээд ДАХИН БҮҮ ХӨНД —
--    `POST /api/bim/sessions` дээрх upsert нь зөвхөн `ended_at`,
--    `last_seen_at`, тоолуурууд, `dropped_count`-ыг шинэчилнэ.  Энэ бол
--    кодын дүрэм, DB-ийн хаалт БИШ; шалгалт нь `lib/bimEvents.ts`-д.
--
-- ⚠️ МЭДЭГДЭНЭ, ТАТГАЛЗАХ ТОВЧ БАЙХГҮЙ (эзний 2026-08-27-ны шийдвэр).
--    `capture_policy` ба `notice_version` нь ТЭР ШИЙДВЭРИЙН БҮРТГЭЛ:
--      • `notice_version` — ажилтанд ЯМАР мэдэгдлийн хувилбарыг үзүүлсэн
--        байхад энэ сесс бичигдэв.  Маргаан гарвал хариулах цорын ганц мөр.
--      • `capture_policy` — 'full' | 'meta' | 'off'.  ӨНӨӨДӨР ҮРГЭЛЖ 'full',
--        сервер ч, клиент ч түүнийг СОЛИХГҮЙ.  Багана нь ХОЖИМ хүн тус
--        бүрийн татгалзал нэмэхэд СХЕМ ӨӨРЧЛӨХГҮЙГЭЭР залгах цэг байхаар
--        зориудаар байрлав.  ⚠️ Татгалзлын УРСГАЛЫГ БҮҮ БАРЬ — эзэн
--        татгалзсан.  Зөвхөн багана нь байна.
--
-- ⚠️ ЗАМ, МАШИНЫ НЭР ХАДГАЛАХГҮЙ.  `central_path_hash` ба `machine_hash`
--    нь SHA-256, ЭХ МӨР БИШ.  Шалтгаан: central замд үйлчлүүлэгчийн нэр,
--    ажилтны нэр, дотоод серверийн нэр байдаг.  Хэш нь «энэ хоёр сесс
--    ИЖИЛ загвар дээр байсан» гэсэн ЦОРЫН ГАНЦ хэрэгтэй асуултад хариулна.
--
-- ⚠️ REFERENCES ЗАРЛАЛ БАЙХГҮЙ — шалтгаан 0201-д бүтнээр бичигдсэн.

CREATE TABLE IF NOT EXISTS bim_sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Add-in-ий үүсгэсэн GUID.  Revit процесс + баримт тутамд НЭГ.
  -- ⚠️ Revit дахин эхлэхэд ШИНЭ утга гарна — тиймээс `seq` тэглэгдэх нь
  --    аюулгүй (0203-ын `UNIQUE(session_id, seq)`-ийн урьдчилсан нөхцөл).
  session_uid       TEXT    NOT NULL,

  user_id           INTEGER NOT NULL,
  project_id        INTEGER,
  revit_document_id INTEGER,           -- revit_documents.id
  doc_uid           TEXT,              -- revit_documents.doc_uid, давхардуулсан
  -- ⚠️ ЗӨВХӨН ШОШГО (0187-ийн дүрэм): Save-As / нэр солих бүрт өөрчлөгдөнө.
  doc_title         TEXT    NOT NULL DEFAULT '',
  is_link           INTEGER NOT NULL DEFAULT 0 CHECK (is_link IN (0,1)),

  central_path_hash TEXT,              -- sha256, ЗАМ БИШ
  machine_hash      TEXT,              -- sha256, МАШИНЫ НЭР БИШ
  worksharing       TEXT,              -- none | central | local | cloud

  revit_version     TEXT    NOT NULL DEFAULT '',
  revit_build       TEXT,              -- ж: '2027.1.2.345'
  addin_version     TEXT    NOT NULL DEFAULT '',
  addin_channel     TEXT    NOT NULL DEFAULT 'prod',

  -- Тухайн сесст ИДЭВХТЭЙ байсан хувилбарууд.  Сессийн дунд загвар
  -- солигдвол add-in ШИНЭ сесс нээнэ (1C-ийн гэрээ).
  model_version     TEXT,              -- assistant_models.version
  prompt_version    TEXT,
  ruleset_version   TEXT,

  capture_schema    INTEGER NOT NULL DEFAULT 1,
  capture_policy    TEXT    NOT NULL DEFAULT 'full',
  notice_version    TEXT    NOT NULL DEFAULT '',

  -- КЛИЕНТИЙН цаг (ISO-8601 UTC).  Add-in офлайн байж болно.
  started_at        TEXT    NOT NULL,
  ended_at          TEXT,
  client_tz_offset_min INTEGER,

  -- СЕРВЕРИЙН цаг.  bind = 0.
  first_seen_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Сервер эхний холбоо дээр тооцно: received − occurred.  Клиентийн цаг
  -- буруу тохируулагдсан машиныг илрүүлэх ЦОРЫН ГАНЦ дохио.
  clock_skew_sec    INTEGER NOT NULL DEFAULT 0,

  txn_count         INTEGER NOT NULL DEFAULT 0,
  event_count       INTEGER NOT NULL DEFAULT 0,
  -- ⚠️ Клиент ӨӨРӨӨ зарласан АЛДАГДАЛ (локал буферийн халилт, Revit гэнэт
  --    унасан, `ChangeTracker.cs:74`-ийн MaxMetaEntries=20000 хэтэрсэн).
  --    ЭНЭ ТОО БАЙХГҮЙ бол сургалтын багц ЧИМЭЭГҮЙ дутуу болно — «үйл
  --    явдал байгаагүй» ба «үйл явдал алдагдсан» хоёр ялгагдахаа болино.
  dropped_count     INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bim_sessions_uid
  ON bim_sessions (session_uid);
-- ⚠️ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ асуулгын гүйцэтгэлд.  Индекс БАЙГАА нь
--    ахлагчийн тайлан бичихийг ЗӨВШӨӨРСӨН гэсэн үг БИШ (дээрх дүрэм).
CREATE INDEX IF NOT EXISTS idx_bim_sessions_user
  ON bim_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_bim_sessions_project
  ON bim_sessions (project_id, started_at DESC) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bim_sessions_doc
  ON bim_sessions (revit_document_id, started_at DESC) WHERE revit_document_id IS NOT NULL;
-- Хаагдаагүй сесс хайх (Revit унасан) — хэсэгчилсэн тул бараг зайгүй.
CREATE INDEX IF NOT EXISTS idx_bim_sessions_open
  ON bim_sessions (last_seen_at) WHERE ended_at IS NULL;
