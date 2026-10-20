-- =============================================================
-- 0205_learning_events.sql — СУРАХ ГОГЦООНЫ НУРУУ (append-only)
-- =============================================================
--
-- ЗОРИЛГО: ажлын ЭРГЭН ТОЙРНЫ бүх зүйлийг НЭГ дараалалд оруулах —
-- туслахтай ярьсан бичвэр, ангилагчийн ТААМАГ, хүний ЗАЛРУУЛГА, 👍/👎,
-- AI-ийн ҮЙЛДЭЛ, дүрмийн ДҮГНЭЛТ, БАТЛАЛТ, илгээсэн ЯВЦЫН ТАЙЛАН,
-- хавсаргасан АРТЕФАКТ.  ЖИНХЭНЭ МОДЕЛДЭЛТИЙН АЖИЛ нь 0203/0204-д —
-- энэ хүснэгт түүн рүү `txn_id` / `element_id`-ээр заана.
--
-- ⚠️ 1B-1-ИЙН ТӨСЛӨӨС ГУРВАН ЗОРИУДЫН ЗӨРҮҮ, ИЛТ БИЧИВ:
--    (1) `kind` дээр CHECK ТАВИАГҮЙ.  1B-1 §6-ийн хүлээн авах шалгуур
--        «ЕС утга агуулсан CHECK» гэсэн.  Гэвч «бүгдийг хадгал» гэсэн
--        загварт төрөл ГАРЦААГҮЙ өснө (одоо 16), CHECK өөрчлөх нь сая
--        мөртэй append-only хүснэгтийг ДАХИН БАРИХЫГ шаардана — энэ
--        загварын хийж ЧАДАХГҮЙ цорын ганц зүйл.  0190-ийн заншлыг
--        дагав.  Хаалттай багцыг `lib/bimEvents.ts`-ийн
--        `Record<LearningEventKind, …>` БҮРЭН бичлэгээр барина
--        (`lib/pushSweep.ts:53`-ийн `CATEGORY_OF` заль: шинэ утга нэмэхэд
--        ЭМХЭТГЭЛ УНАНА).  `provenance`, `actor_kind` мөн адил.
--        Одоогийн `kind` утгууд (16):
--          TEXT · IMAGE · SKETCH · REVIT_STATE · USER_ACTION · AI_ACTION ·
--          HUMAN_CORRECTION · RULE_VALIDATION · FINAL_APPROVAL   (1B-1-ийн ес)
--          AI_PREDICTION · TOOL_INVOKED · TOOL_RESULT · USER_FEEDBACK ·
--          PROGRESS_REPORT · SESSION_START · SESSION_END          (шинэ долоо)
--    (2) `dataset_version` / `prompt_version` баганыг ХАСАВ — сессийн
--        шинж чанар тул `bim_sessions`-д (0202) байна.  bind төсвөөс 2
--        суларч 23 болов.  1B-4 хожим `dataset_version` нэмэх
--        шаардлагатай бол `ALTER TABLE ADD COLUMN` (NULL-тэй) хямд:
--        24 bind × 4 мөр = 96 ≤ 100 хэвээр багтана.
--    (3) `parts_expected`/`parts_present` нь JSON массив БИШ, БИТ МАСК.
--        1B-2 §3.0 нь `expected_parts TEXT` + `expected_count` гэсэн.
--        Сая мөр дээр JSON массив нь мөр тутам 40+ байт, INTEGER нь 1-8 —
--        ЖИЛД ~150 МБ-ын ялгаа.  Утга нь ЯГ ИЖИЛ (0203-ын битийн
--        хуваарийг үз); `parts_missing` (0207) нь `pe & ~pp`.
--
-- ⚠️ 0195-ЫН «геометр, файлын агуулга ОГТ ОРОХГҮЙ» АМЛАЛТ ХҮЧИНГҮЙ —
--    бүтэн тайлбар `0201_bim_artifacts.sql`-ийн толгойд.  `payload_json`
--    нь ЖИЖИГ, бүтэцтэй метадата хэвээр; зураг, геометр, параметрийн
--    багц нь `artifact_id`-аар R2 руу заана.
--
-- ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ — 0201/0203/0204-ийнхтэй ИЖИЛ,
--    зориуд дөрөв дэх удаагаа бичив: ЭЛЕМЕНТ ТҮВШНИЙ ҮЙЛ АЖИЛЛАГАА НЬ
--    ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД.  Унших route бүр (а) `actor_user_id =
--    viewer.sub`-ээр хязгаарлагдсан, эсвэл (б) зөвхөн НЭГТГЭСЭН байх
--    ЁСТОЙ.  `lib/revitNoteAi.ts:152` + `revitNoteAi.test.ts:262`.
--
-- ⚠️ `assistant_logs` (0195) -ЫГ БҮҮ УСТГА, БҮҮ НҮҮЛГЭ.  Тэр нь 1B-3-ын
--    нутаг.  Хоёр систем ЗЭРЭГ оршино; нэгтгэх эсэх нь 1B-3/1B-7-ын
--    шийдвэр.  `learning_events` нь `assistant_logs`-ыг ОРЛОХГҮЙ.
--
-- ⚠️ БАТЛАЛТ БА ЯВЦЫН ТАЙЛАНГ ЭНД ДАВХАРДУУЛАХГҮЙ.  Мөнгө/оноо нь
--    `progress_entries` + `user_points` + `revit_submissions`-д хэвээр.
--    Энд зөвхөн ЗААГЧ:
--      kind='PROGRESS_REPORT' → payload {"revit_submission_id":…,
--          "progress_entry_id":…,"percentage":…,"txn_from":…,"txn_to":…}
--          ба `txn_id` = тайланд хамрагдсан СҮҮЛИЙН гүйлгээ
--      kind='FINAL_APPROVAL'  → payload {"progress_entry_id":…,
--          "decision":"approved|rejected","reviewer_id":…,"note":…}
--    0207-ын generated багана эдгээрийг индекслэгдэх болгоно.
--
-- ⚠️ ДАРААЛЛЫГ ХОЁР ӨӨР ИНДЕКС БАРИНА (0203-тай ижил дүрэм):
--      `UNIQUE(event_uid)`     — дахин илгээлт (`ON CONFLICT (event_uid)
--                                DO NOTHING`-ээр чимээгүй алгасна)
--      `UNIQUE(stream_id,seq)` — клиентийн алдаа (эмгэг, ИЛ гаргана)
--    `INSERT OR IGNORE`-ыг ХЭРЭГЛЭХГҮЙ: тэр нь АЛЬ Ч өвөрмөц хязгаарлалтыг
--    залгидаг тул хоёр тохиолдол ялгагдахаа болино.  ⚠️ 0203-ын мөр
--    тус бүрийн fallback гэрээ ЭНД Ч ХҮЧИНТЭЙ.
--
-- ⚠️ `txn_id`-Г ЯГ 0204-ИЙН АДИЛААР БИЧНЭ — нэг `db.batch()` дотор, дэд
--    асуулгаар: `(SELECT id FROM revit_transactions WHERE txn_uid = ?)`.
--    Бүтэн үндэслэл `0204`-ийн толгойд.  bind тоо ӨӨРЧЛӨГДӨХГҮЙ (23).
--    ⚠️ ЯЛГАА: энд `txn_id` нь NULLABLE тул дэд асуулга NULL буцаавал мөр
--    ОРНО, багц унахгүй.  Тэр нь ЗӨВ — вэб талын батлалт, дүрмийн дүгнэлт
--    зэрэг Revit гүйлгээгүй үйл явдал ХЭВИЙН.  Гэхдээ клиент гүйлгээ
--    ЗААХААР зорьсон атлаа олдоогүй тохиолдол ЧИМЭЭГҮЙ өнгөрнө — иймд
--    ingest нь дэд асуулгыг ЗӨВХӨН клиент `txn_uid` илгээсэн үед хэрэглэж,
--    үр дүн NULL гарвал `parts_present`-ээс AI_CAUSE(16) битийг УНТРААХ
--    ЁСТОЙ.  Тэгснээр `parts_missing` (0207) түүнийг илрүүлнэ.
--
-- ⚠️ БИЧИХ ДАРААЛАЛ — ЭНЭ БҮХ БАГЦЫН ГЭРЭЭ, ЗӨРЧИЖ БОЛОХГҮЙ:
--      1) артефактын байтыг R2-д тавь → сервер sha256 тооцоол →
--         `bim_artifacts` INSERT → `artifact_id`
--      2) `bim_sessions` upsert (`session_uid`) → `session_id`
--      3) НЭГ `db.batch()`:  revit_transactions → revit_element_touches →
--                             learning_events   (ЯГ ЭНЭ ДАРААЛЛААР)
--      4) `bim_sessions`-ийн тоолуурыг шинэчил (ЦОРЫН ГАНЦ зөвшөөрөгдсөн
--         UPDATE — 0202 бол хувьсдаг хэмжээс)
--    ⚠️ АРТЕФАКТ ЭХЛЭЭД гэдэг нь САНАМСАРГҮЙ БИШ: тэр нь `parts_present`-ийг
--    ЭХНИЙ БИЧИЛТЭД мэдэгддэг болгож, ямар ч ТОХИРУУЛГЫН UPDATE-ийг
--    хэрэггүй болгож, улмаар append-only-г БҮРЭН барих боломж олгодог
--    ЦОРЫН ГАНЦ дараалал.  Урвуулбал (мөр эхлээд, артефакт дараа нь)
--    `parts_present`-ийг хожим ЗАСАХ шаардлагатай болно — тэр нь 0206-ын
--    trigger-т ХОРИОТОЙ.
--
-- ⚠️ REFERENCES ЗАРЛАЛ БАЙХГҮЙ — шалтгаан 0201-д бүтнээр бичигдсэн.
--
-- ⚠️ CURRENT-STATE VIEW ЭНД БАЙХГҮЙ, ЗОРИУДААР.  Мөр тутамд гурван
--    хамаарсан дэд асуулга шаардах view нь сая мөртэй хүснэгт дээр,
--    УНШСАН МӨРӨӨР төлбөр авдаг D1 дээр төлж барагдашгүй.  Одоогийн
--    төлөвийг сервер талд, `stream_id`-ээр хязгаарласан асуулгаар гаргана.

CREATE TABLE IF NOT EXISTS learning_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,

-- ДАРААЛАЛ
  -- bim_sessions.id.  Вэб талаас ирсэн үйл явдалд NULL (Revit сесс байхгүй).
  session_id      INTEGER,
  -- Add-in-д = `bim_sessions.session_uid`;
  -- вэб талд = 'web:<user_id>:<YYYY-MM-DD>'.  ҮРГЭЛЖ утгатай.
  stream_id       TEXT    NOT NULL,
  seq             INTEGER NOT NULL CHECK (seq >= 0),
  event_uid       TEXT    NOT NULL,

-- ЮУ БОЛСОН
  kind            TEXT    NOT NULL,          -- CHECK ТАВИАГҮЙ, дээрх ⚠️-г үз
  actor_kind      TEXT    NOT NULL DEFAULT 'human',   -- human|ai|rule|system

-- ХЭН
  actor_user_id   INTEGER,
  project_id      INTEGER,
  task_id         INTEGER,
  doc_uid         TEXT,

-- ЮУНЫ ТУХАЙ (ажилтай холбох ГОЛ гүүр)
  txn_id          INTEGER,      -- revit_transactions.id
  element_id      INTEGER,      -- ElementId.Value

-- ГИНЖ
  parent_event_id INTEGER,      -- бүтцийн эцэг (HUMAN_CORRECTION → AI_ACTION)
  causal_event_id INTEGER,      -- шалтгаан; эцгээс ӨӨР байж болно

-- АГУУЛГА
  artifact_id     INTEGER,                   -- bim_artifacts.id
  payload_json    TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(payload_json)),
  -- Гэрээний тэмдэглэгээ, ж: 'v1:AI_PREDICTION+prompt'.  `GLOB` нь SQLite-ийн
  -- цөмийн оператор, өргөтгөл шаардахгүй.  Гэрээгүй мөр ОГТ орж чадахгүй.
  payload_contract TEXT   NOT NULL DEFAULT 'v1:unknown'
                          CHECK (payload_contract GLOB 'v[0-9]*:*'),

-- ДАГАЛДАХ ХЭСГИЙН МАСК (0203-ын битийн хуваарь)
  parts_expected  INTEGER NOT NULL DEFAULT 0,
  parts_present   INTEGER NOT NULL DEFAULT 0,

-- ГАРАЛ ҮҮСЭЛ (1B-4 / 1B-7 ашиглана)
  -- UNVERIFIED | MACHINE_GENERATED | RULE_VERIFIED | HUMAN_VERIFIED |
  -- HUMAN_CORRECTED | REJECTED.  CHECK ТАВИАГҮЙ — 1B-7 итгэлийн шатлалыг
  -- өргөтгөнө, тэр үед rebuild шаардах ёсгүй.
  provenance      TEXT    NOT NULL DEFAULT 'UNVERIFIED',
  -- ⚠️ Сесс дунд загвар СОЛИГДОЖ болно тул `model_version` нь СЕССИЙНХЭЭС
  --    ГАДНА үйл явдал тус бүрд хэрэгтэй.
  model_version   TEXT,
  -- Серверийн дүрмийн хөдөлгүүр Revit сессгүйгээр RULE_VALIDATION бичдэг.
  ruleset_version TEXT,

-- ЦАГ
  occurred_at     TEXT    NOT NULL,                            -- КЛИЕНТ (UTC ISO)
  received_at     TEXT    NOT NULL DEFAULT (datetime('now')),  -- СЕРВЕР, bind = 0

-- REDACTION (цорын ганц зөвшөөрөгдсөн UPDATE)
  redacted_at      TEXT,
  redacted_by      INTEGER,
  redaction_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_le_uid
  ON learning_events (event_uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_le_seq
  ON learning_events (stream_id, seq);
-- Ажил ↔ үйл явдлын гүүр: «энэ гүйлгээний тухай юу болов»
CREATE INDEX IF NOT EXISTS idx_le_txn
  ON learning_events (txn_id, id) WHERE txn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_le_project
  ON learning_events (project_id, occurred_at) WHERE project_id IS NOT NULL;
-- Курацийн дараалал (1B-6): шошголоогүй мөрүүд
CREATE INDEX IF NOT EXISTS idx_le_curation
  ON learning_events (provenance, id)
  WHERE provenance IN ('UNVERIFIED','MACHINE_GENERATED');
-- ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ асуулгын гүйцэтгэлд.
CREATE INDEX IF NOT EXISTS idx_le_actor
  ON learning_events (actor_user_id, id) WHERE actor_user_id IS NOT NULL;

-- ⚠️ `assistant.logging` (0195) нь `assistant_logs`-ыг Л зогсоодог.  Энэ нь
--    ШИНЭ, ТУСДАА унтраах товч: `learning_events` + `revit_transactions` +
--    `revit_element_touches` бүгдийг deploy-гүйгээр зогсооно.  Хоёрыг
--    ХОЛИХГҮЙ — ангилагчийн бүртгэл ажиллаж, ажлын бүртгэл зогссон
--    (эсвэл эсрэгээр) байх нь хууль ёсны төлөв.
