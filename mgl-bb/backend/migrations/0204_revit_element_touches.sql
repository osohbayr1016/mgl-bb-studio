-- =============================================================
-- 0204_revit_element_touches.sql — ГҮЙЛГЭЭ ХӨНДСӨН ЭЛЕМЕНТ БҮР
-- =============================================================
--
-- ЗОРИЛГО: эзний 2026-08-27-ны шаардлага — «AI нь хаалгыг ХААНА тавьсан,
-- тэр нь ЗӨВ ҮҮ БУРУУ ЮУ гэдгийг сурах ёстой».  Тэр асуултад хариулахын
-- тулд элемент тус бүр, гүйлгээ тус бүрд ӨӨРИЙН МӨРТЭЙ байх ёстой:
-- ямар КАТЕГОРИ, ямар ТӨРӨЛ, ямар ТҮВШИН, ямар HOST, ХААНА байрлав.
--
-- ⚠️ ЭНЭ ХҮСНЭГТ БОЛ D1-Д БАЙГАА ИНДЕКС, КОРПУС БИШ.
--    Элементийн БҮРЭН, ХЯЗГААРГҮЙ жагсаалт нь ҮРГЭЛЖ R2-д, `bim_artifacts`-ын
--    `kind='ELEMENT_DELTA'` (gzip, `schema_tag='element-delta/v1'`) blob-д
--    бичигдэнэ.  Энэ хүснэгтийн мөр нь ЗӨВХӨН «шууд шүүх, шууд JOIN хийх»
--    боломж өгөх ЗОРИУЛАЛТТАЙ.
--    ЯАГААД: 300 гүйлгээ/өдөр × дунджаар 6 элемент × 49 хүн × 250 өдөр =
--    ЖИЛД 22 САЯ МӨР ≈ 4.4 ГБ.  D1-ийн 10 ГБ тааз нь и-мэйл, үнийн санал,
--    бусад БҮХ зүйлтэй ХУВААЛЦСАН.  Хязгааргүй бичвэл ЭНЭ ХҮСНЭГТ ГАНЦААРАА
--    санг НЭГ ЖИЛД ХАГАСЫГ НЬ ИДНЭ.  Иймд ГУРВАН хаалт (бүгд `app_settings`,
--    0203-д тодорхойлогдсон, deploy-гүйгээр солигдоно):
--      `bim.capture.elements_per_txn`     = 24
--      `bim.capture.elements_per_session` = 4000
--      `bim.capture.element_sample_n`     = 8   (энгийн гүйлгээнд 1/8 түүвэр)
--    ⚠️ Түүвэр нь ЗӨВХӨН ЭНЭ ХҮСНЭГТЭД хамаарна.  R2 дахь element-delta нь
--    түүвэрлэгддэггүй — «бүгдийг хадгал» гэсэн шийдвэр ТЭНД биелнэ.
--    ТҮҮВРЭЭС ҮЛ ХАМААРАН ҮРГЭЛЖ БҮТЭН бичих гүйлгээ (salient):
--      • AI үүсгэсэн (`revit_transactions.origin='ai'` эсвэл `cause_event_id`),
--      • дүрмийн дүгнэлт хавсрагдсан,
--      • хүний залруулга хавсрагдсан,
--      • илгээсэн явцын тайланд хамрагдсан.
--
-- ⚠️ АТРИБУТУУДЫГ `DocumentChanged`-д УНШИЖ БОЛОХГҮЙ.
--    `category`, `type_name`, `level_name`, `workset`, `host_uid`,
--    `placement_json`, `element_uid` — БҮГД Revit API thread шаарддаг.
--    `ChangeTracker.cs:45-52`: `DocumentChanged` нь ҮНДСЭН thread дээр,
--    гүйлгээ бүрийн дараа ажилладаг ба тэнд гүйлгээ нээх, `Regenerate()`,
--    диск бичих ХОРИОТОЙ; одоогийн боловсруулагч 10 id дээр 0.5 µs,
--    5,000 id дээр 168 µs — ЭНЭ ХЯМД БАЙДЛЫГ ХЭВЭЭР БАРИХ ЁСТОЙ.
--    ⇒ Атрибутыг ХОЖИМ, ТУСДАА, төсөвтэй idle ажиллагаанд уншина.
--    ⚠️ `ChangeReport`-ийн 4,000 мс төсөвт БҮҮ НЭМ (idle зүсэлт тутам
--    4 дуудлага = Revit ~16 сек царцах).
--    Атрибут шийдэгдээгүй бол мөр нь ХООСОН талбартай ирнэ ба тухайн
--    гүйлгээний `parts_present`-д ELEMENT_ATTRS (4) бит УНТРААЛТТАЙ байна —
--    «уншиж чадаагүй» ба «уншаад хоосон байсан» хоёр ЯЛГАГДАНА.
--
-- ⚠️ ХОЁР ӨӨР ТАНИХ ТЭМДЭГ, ХОЁУЛАНГ НЬ ХАДГАЛНА:
--    `element_id`  = `ElementId.Value` (long).  ХЯМД, `DocumentChanged`-д
--                    ҮНЭГҮЙ, ГЭХДЭЭ файл хооронд ТОГТВОРГҮЙ, Save-As /
--                    purge / eTransmit дээр өөрчлөгдөж болно.
--    `element_uid` = `Element.UniqueId` (45 тэмдэгт).  ТОГТВОРТОЙ, гэхдээ
--                    API thread шаарддаг тул 2-р үе шатанд л ирнэ (NULL
--                    байж болно).  «Энэ хаалганы амьдрал» гэсэн асуултад
--                    хариулах ЦОРЫН ГАНЦ түлхүүр.
--
-- ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ — 0201/0203-ынхтой ИЖИЛ:
--    ЭЛЕМЕНТ ТҮВШНИЙ ҮЙЛ АЖИЛЛАГАА НЬ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД.  Энэ
--    хүснэгт нь тэр дүрмийн ХАМГИЙН эмзэг гадаргуу: нэг хүн ямар ханыг
--    хэдэн удаа зассаныг харуулж чадна.  `hits`/`depth` нь
--    `ChangeTracker.cs:93`-ийн ЯГ тэр шийдвэрийг авч явна: «нэг ханыг 20
--    удаа хөндсөн нь МУУ АЖИЛТАН гэсэн үг БИШ, суралцаж яваа хүний хэвийн
--    байдал.  Тайланд оруулбал энэ нь шинэ ажилтныг ШИЙТГЭХ хэрэгсэл
--    болно.»  Унших route бүр (а) өөрийн мөрөөр хязгаарлагдсан, эсвэл
--    (б) НЭГТГЭСЭН байх ЁСТОЙ.
--
-- ⚠️ `txn_id`-ГҮЙ БИЧИЖ БОЛОХГҮЙ, ГЭТЭЛ `revit_transactions.id`-Г ТЭР
--    БИЧИЛТИЙН ӨМНӨ МЭДЭХГҮЙ.  Энэ бол ЗАГВАРЫН БОДИТ БЭРХШЭЭЛ, шийдэл нь
--    1B-2-ЫН ЗААВАЛ БИЕЛҮҮЛЭХ ГЭРЭЭ болно.  ГУРВАН боломж авч үзсэн:
--      (а) `txn_uid TEXT` -ийг энд давхардуулах → 22 сая мөр × 32 байт +
--          индекс ≈ 700 МБ ЗӨВХӨН энэ баганад.  ТАТГАЛЗСАН.
--      (б) хоёр round trip: гүйлгээг бичээд `SELECT id, txn_uid … IN (…)`-ээр
--          буцааж уншина (`routes/revit.ts:69`-ийн `IDS_PER_STATEMENT = 50`
--          заншлаар чанклана).  Ажиллана, гэхдээ D1 нь УНШСАН МӨРӨӨР
--          төлдөг бөгөөд flush тутам нэмэлт нэг айлчлал.  ЗӨВХӨН fallback.
--      (в) НЭГ `db.batch()` дотор, ДЭД АСУУЛГААР шийдэх.  СОНГОСОН:
--            INSERT INTO revit_element_touches (txn_id, session_id, …)
--            VALUES ((SELECT id FROM revit_transactions WHERE txn_uid = ?),
--                    ?, …)
--          `idx_revit_txn_uid` нь UNIQUE тул энэ нь индексийн ГАНЦ хайлт.
--          bind тоо ӨӨРЧЛӨГДӨХГҮЙ (17) — `txn_id`-ийн оронд `txn_uid` орно.
--    ⚠️ ГУРВАН ҮР ДАГАВАР, гурвуулаа ЗОРИУДААР:
--      1) `db.batch()` нь НЭГ ГҮЙЛГЭЭ бөгөөд statement-үүд ДАРААЛЛААРАА
--         ажилладаг тул гүйлгээний INSERT нь ЭНЭ statement-ээс ӨМНӨ байх
--         ЁСТОЙ.  ⚠️ 1B-2 үүнийг хаягдах D1 дээр БАТАЛСНЫ ДАРАА л энэ
--         хэлбэрийг шиплэнэ; батлагдаагүй бол (б) хувилбар руу шилжинэ.
--      2) Дахин илгээлт: гүйлгээний INSERT нь `ON CONFLICT (txn_uid) DO
--         NOTHING`-ээр залгигдсан ч дэд асуулга нь ХУУЧИН мөрийг олно —
--         ЗӨВ зан төлөв.
--      3) Гүйлгээ ҮНЭХЭЭР байхгүй бол дэд асуулга NULL буцааж
--         `txn_id INTEGER NOT NULL` татгалзана → багц БҮХЭЛДЭЭ унана.
--         ЧАНГА БҮТЭЛГҮЙТЭЛ нь ЗӨВ: эцэггүй элементийн мөр нь корпусыг
--         чимээгүй бохирдуулна.  0203-ын мөр тус бүрийн fallback гэрээ
--         үүнийг барина.
--
-- ⚠️ REFERENCES ЗАРЛАЛ БАЙХГҮЙ — шалтгаан 0201-д бүтнээр бичигдсэн.

CREATE TABLE IF NOT EXISTS revit_element_touches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  txn_id        INTEGER NOT NULL,      -- revit_transactions.id
  session_id    INTEGER NOT NULL,      -- bim_sessions.id
  -- Давхардуулсан: өөрийгөө харах ба нэгтгэсэн индексүүд JOIN-гүй ажиллана.
  user_id       INTEGER NOT NULL,
  project_id    INTEGER,

  element_id    INTEGER NOT NULL,      -- ElementId.Value — ТОГТВОРГҮЙ
  element_uid   TEXT,                  -- Element.UniqueId — ТОГТВОРТОЙ, хожуу

  -- Хаалттай багц, ХЭЗЭЭ Ч өргөжихгүй → CHECK зөвшөөрөгдөнө.
  change        TEXT    NOT NULL CHECK (change IN ('add','modify','delete')),

  -- ⚠️ Revit-ийн ХЭЛНЭЭС хамаарсан нэрс — эх хэвээр, орчуулахгүй.
  category      TEXT    NOT NULL DEFAULT '',
  type_name     TEXT    NOT NULL DEFAULT '',
  level_name    TEXT    NOT NULL DEFAULT '',
  workset       TEXT    NOT NULL DEFAULT '',
  -- Хаалга ямар ханан дотор байна вэ — «хаана тавьсан» асуултын хагас нь.
  host_uid      TEXT,

  -- Байрлал: {"x":..,"y":..,"z":..,"rot":..,"lvl":"1 давхар","off":..}
  -- ⚠️ ЖИЖИГ, ТОГТМОЛ хэлбэртэй байх ЁСТОЙ.  Бүрэн параметрийн багц нь
  --    `params_artifact_id` (R2) руу явна — энд БИШ.  Мөр нь сая ширхэг
  --    болох тул нэмэлт 200 байт бүр ЖИЛД 4 ГБ болж хувирна.
  placement_json TEXT   NOT NULL DEFAULT '{}' CHECK (json_valid(placement_json)),

  -- bim_artifacts.id — энэ элементийн before/after параметрийн БҮРЭН багц.
  -- ⚠️ АРТЕФАКТ ЭХЛЭЭД, МӨР ДАРАА НЬ (0203-ын дүрэмтэй ижил).
  params_artifact_id INTEGER,

  -- `ChangeTracker.Touch`-ийн хоёр тоолуур, УТГА нь ӨӨР:
  --   hits  — хичээсэн ХҮЧИН ЧАРМАЙЛТ (undo-г ч тооцно)
  --   depth — сууриасаа ХӨДӨЛСӨН хэвээр байгаа ЦЭВЭР өөрчлөлт
  hits          INTEGER NOT NULL DEFAULT 1,
  depth         INTEGER NOT NULL DEFAULT 1,

  occurred_at   TEXT    NOT NULL,                            -- клиентийн цаг
  received_at   TEXT    NOT NULL DEFAULT (datetime('now')),  -- серверийн цаг, bind = 0

  redacted_at      TEXT,
  redacted_by      INTEGER,
  redaction_reason TEXT
);

-- Idempotency.  Нэг гүйлгээнд нэг элемент ЯГ НЭГ мөр авна:
-- `ChangeTracker.cs:740-800`-ийн олонлогийн алгебр нь id-г
-- Added/Deleted/Modified гурвын ЯГ НЭГД нь байрлуулдаг. ----------
CREATE UNIQUE INDEX IF NOT EXISTS idx_ret_txn_elem
  ON revit_element_touches (txn_id, element_id);
CREATE INDEX IF NOT EXISTS idx_ret_txn
  ON revit_element_touches (txn_id);
-- «Энэ хаалганы амьдрал» — сургалтын гол асуулга
CREATE INDEX IF NOT EXISTS idx_ret_elem_uid
  ON revit_element_touches (element_uid, occurred_at)
  WHERE element_uid IS NOT NULL;
-- ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ.  Дээрх дүрмийг үз.
CREATE INDEX IF NOT EXISTS idx_ret_user
  ON revit_element_touches (user_id, occurred_at);
-- НЭГТГЭСЭН: «энэ төсөл дээр ямар категори хэр их хөндөгдөв»
CREATE INDEX IF NOT EXISTS idx_ret_project_cat
  ON revit_element_touches (project_id, category, occurred_at)
  WHERE project_id IS NOT NULL;
