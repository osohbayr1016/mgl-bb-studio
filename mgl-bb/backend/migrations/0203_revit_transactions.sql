-- =============================================================
-- 0203_revit_transactions.sql — АЖЛЫН НЭГЖ: Revit-ийн ГҮЙЛГЭЭ, ДАРААЛАЛТАЙ
-- =============================================================
--
-- ЗОРИЛГО: «хана үүсгэв → зөөв → хаалга нэмэв → буцаав → senior залруулав →
-- батлав» гэсэн ГИНЖИЙГ БҮРЭН, ДАРААЛАЛТАЙ хадгалах.  Өнөөдөр энэ гинж
-- ХАДГАЛАГДДАГГҮЙ, архитектурын хувьд хадгалагдаж ч ЧАДАХГҮЙ:
--   • `revit-mcp/addin/ChangeTracker.cs:182` — `Meta[id] = new Touch{...}` нь
--     элемент бүрийн ҮЙЛДЛИЙН ИНДЕКС ба ЦАГИЙГ ДАРЖ БИЧДЭГ.  «Move →
--     Change Wall Type → Delete» гурвын ЗӨВХӨН СҮҮЛИЙНХ нь үлдэнэ.
--   • `ChangeTracker.cs:766` (`if (c.Added.Remove(v)) { c.Meta.Remove(v); }`)
--     ба `:795` (UndoTouch гүн 0 болоход `c.Meta.Remove(v)`) — ОРХИГДСОН
--     ОРОЛДЛОГО ЯМАР Ч УЛ МӨР ҮЛДЭЭХГҮЙ.  Инженер хана тавиад Ctrl+Z
--     дарвал тэр ШИЙДВЭР, тэр ЭРГЭЛЗЭЭ бүрмөсөн алга болно — сургалтын
--     өгөгдлийн хувьд орхигдсон оролдлого нь батлагдсанаас дутуугүй үнэтэй.
--   • `AssistantPane.xaml.cs:1295` — илгээсний ДАРАА `capture_baseline`
--     дуудаж `ChangeTracker.Reset` (`ChangeTracker.cs:325`) хянаж буй
--     олонлогийг БҮХЭЛД НЬ ТЭГЛЭНЭ.
-- Энэ хүснэгт тэр гурвыг НЭГ ДОР шийднэ: мөр нь append-only, дараалалтай,
-- undo нь БҮРТГЭГДЭНЭ (устгагддаггүй), суурь тэглэх нь мөрийг хөндөхгүй.
--
-- ⚠️ 0195-ЫН «геометр, файлын агуулга ОГТ ОРОХГҮЙ» АМЛАЛТ ХҮЧИНГҮЙ —
--    бүтэн тайлбар `0201_bim_artifacts.sql`-ийн толгойд.
--
-- ⚠️ ХУВИЙН НУУЦЫН ҮЛ ХӨДЛӨХ ДҮРЭМ — 0201-ийнхтэй ИЖИЛ, зориуд дахин бичив:
--    ЭЛЕМЕНТ ТҮВШНИЙ ҮЙЛ АЖИЛЛАГАА НЬ ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХАД.  Энэ
--    хүснэгтийн дээгүүр бичигдэх УНШИХ route бүр (а) `user_id = viewer.sub`-
--    ээр хязгаарлагдсан, эсвэл (б) зөвхөн НЭГТГЭСЭН байх ЁСТОЙ.  `op_name`,
--    `added_count` зэрэг нь ахлагчийн тайланд ХЭЗЭЭ Ч орохгүй:
--    `lib/revitNoteAi.ts:152`-ийн `allowedCountsOf` нь болзолгүйгээр хоосон
--    жагсаалт буцаадаг ба `revitNoteAi.test.ts:262`-оор ТҮГЖИГДСЭН.
--
-- ⚠️ ХЭМЖЭЭ — ЭНЭ БАГЦЫН ХАМГИЙН ТОМ ЭРСДЭЛ, ИЛТ БИЧИВ.
--    Нэг инженерийн нэг өдөр ~300 committed гүйлгээ (ХЭМЖЭЭГҮЙ ТААМАГ;
--    харьцуулах цорын ганц тоо нь `progress_entries` 30 хоногт 472 мөр).
--    49 × 300 × 250 = ЖИЛД ~3.7 САЯ МӨР.  Мөр + 5 индекс ≈ 430 байт ⇒
--    ЖИЛД ~1.6 ГБ.  D1-ийн 10 ГБ таазыг и-мэйлийн бие, үнийн санал,
--    бусад БҮХ ЗҮЙЛТЭЙ ХУВААЛЦДАГ (өнөөдөр нийт 48.8 МБ).
--    ⇒ ЭНЭ ХҮСНЭГТ 3-4 ЖИЛИЙН ДОТОР ТААЗ РУУ ХҮРНЭ.
--    Иймд ХОЁР зүйл ЗААВАЛ:
--      1) `app_settings`-ийн `bim.capture.*` дугуйнууд (доор) — deploy-гүйгээр
--         эзэн ханшийг буулгана.  Add-in эдгээрийг handshake дээр татна.
--      2) ЖИЛИЙН ДАРАА нягтруулах төлөвлөгөө: гаргаж авсан ХУРААНГУЙ мөр
--         бичиж, ЭХ МӨРИЙГ R2 руу гаргаад D1-ээс хасна.  `BEFORE DELETE`
--         trigger ЗОРИУДААР БИЧИГДЭЭГҮЙ (0206) — тэр замыг нээлттэй үлдээв.
--
-- ⚠️ ГУРВАН ЗҮЙЛ ГҮЙЛГЭЭНИЙ МӨРӨНД ХЭЗЭЭ Ч БАЙХГҮЙ, УЧИР НЬ REVIT
--    ЗӨВШӨӨРӨХГҮЙ.  `ChangeTracker.cs:45-52`-ийн толгой: `DocumentChanged`
--    нь REVIT-ИЙН ҮНДСЭН THREAD дээр, гүйлгээ бүрийн ДАРАА дуудагдана;
--    тэнд гүйлгээ нээх, `Regenerate()`, ДИСК БИЧИХ хориотой.  Элементийн
--    ПАРАМЕТР эсвэл ГЕОМЕТР унших нь Revit API thread шаарддаг тул
--    `DocumentChanged` дотор хэдэн зуун элемент дээр хийвэл ГАМШИГ.
--    ⇒ Клиент дээр ХОЁР ҮЕ ШАТ: (1) `DocumentChanged`-д ЗӨВХӨН id +
--    гүйлгээний нэр (одоогийн 0.5..168 µs зардлыг ХЭВЭЭР үлдээнэ);
--    (2) хожим, ТУСДАА, төсөвтэй idle ажиллагаанд атрибут/параметрийг
--    уншина.  ⚠️ Тэр ажлыг `ChangeReport`-ийн 4,000 мс төсөвт БҮҮ НЭМ —
--    тэр төсөв аль хэдийн idle зүсэлт тутам 4 дуудлага × 4,000 мс = Revit-ийг
--    ~16 сек царцаана.  Хоёр дахь үе шат ажиллаагүй бол мөр нь атрибутгүй
--    ирнэ ба `parts_expected`-д ELEMENT_ATTRS бит асаалттай, `parts_present`-д
--    УНТРААЛТТАЙ байна — өөрөөр хэлбэл ДУТУУ гэдэг нь ИЛТ БҮРТГЭГДЭНЭ.
--
-- ⚠️ ДАГАЛДАХ ХЭСГИЙН МАСК (satellite mask) — ЭХНИЙ БИЧИЛТЭД ЗАРЛАГДАНА.
--    `parts_expected` / `parts_present` нь БИТ МАСК (JSON БИШ: сая мөр дээр
--    JSON массив нь 40+ байт, INTEGER нь 1-8).  Битүүд (`lib/bimEvents.ts`-д
--    `Record`-оор давхардуулна):
--       1  ELEMENT_ROWS    — `revit_element_touches` мөрүүд
--       2  ELEMENT_DELTA   — R2 дахь бүрэн элементийн дэлгэрэнгүй
--       4  ELEMENT_ATTRS   — атрибут/параметр шийдэгдсэн (2-р үе шат ажилласан)
--       8  VIEW_IMAGE      — харагдацын зураг
--      16  AI_CAUSE        — `learning_events` мөр энэ гүйлгээг үүсгэсэн
--      32  RULE_VERDICT    — дүрмийн дүгнэлт хавсаргасан
--      64  CORRECTION      — хүний залруулга хавсаргасан
--     128  APPROVAL        — батлалт хавсаргасан
--     256  REPORT          — илгээсэн явцын тайлан хавсаргасан
--    ЭНЭ БОЛ ЭНЭ БҮХ БАГЦЫН ХАМГИЙН ЧУХАЛ ЗӨВ БАЙДЛЫН ЗҮЙЛ: маскгүй бол
--    «дагалдах мөр АЛДАГДСАН» ба «дагалдах мөр АНХНААСАА БАЙГААГҮЙ» хоёр
--    ЯЛГАГДАХГҮЙ.  Dataset үүсгэгч нь төгс хүчинтэй харагдаж, ЧИМЭЭГҮЙ
--    БУРУУ сургалтын жишээ гаргана.  `parts_missing` (0207) нь `pe & ~pp`.
--
-- ⚠️ ДАРААЛЛЫГ ХОЁР ӨӨР ИНДЕКС БАРИНА, ХОЛИХГҮЙ:
--      `UNIQUE(txn_uid)`        — ДАХИН ИЛГЭЭЛТ (хэвийн, чимээгүй алгасна)
--      `UNIQUE(session_id,seq)` — КЛИЕНТИЙН АЛДАА (эмгэг, ИЛ гаргана)
--    Ingest нь `ON CONFLICT (txn_uid) DO NOTHING` бичнэ — `INSERT OR IGNORE`
--    нь АЛЬ Ч өвөрмөц хязгаарлалтыг залгидаг тул ХЭРЭГЛЭХГҮЙ.
--    ⚠️ ГЭХДЭЭ: D1-ийн `batch()` нь нэг гүйлгээ тул НЭГ муу мөр 200 мөрийн
--    багцыг БҮХЭЛД НЬ унагаана.  Add-in-д АЛБАДАН ШИНЭЧЛЭХ МЕХАНИЗМ
--    БАЙХГҮЙ (49 ширээ, `Install.bat`) тул давтагдах 500 нь АЛСААС
--    СЭРГЭЭХ БОЛОМЖГҮЙ гогцоо болно.  ⇒ 1B-2-ЫН ЗААВАЛ БИЕЛҮҮЛЭХ ГЭРЭЭ:
--    багц `(session_id, seq)`-ийн зөрчлөөр унавал route нь МӨР ТУС БҮРЭЭР
--    дахин оролдож, зөрчилтэйг нь `bim_sessions.dropped_count`-д тоолж,
--    үлдсэнийг нь бичих ЁСТОЙ.  Тэр fallback-гүйгээр энэ индексийг
--    UNIQUE-ээр шиплэх нь ХОРИОТОЙ.

CREATE TABLE IF NOT EXISTS revit_transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,

  session_id    INTEGER NOT NULL,             -- bim_sessions.id
  txn_uid       TEXT    NOT NULL,             -- add-in-ий GUID, idempotency
  seq           INTEGER NOT NULL CHECK (seq >= 0),

  -- Сессээс ДАВХАРДУУЛСАН.  Зөвхөн ЭНЭ ХОЁР — өөрийгөө харах индекс ба
  -- нэгтгэсэн тайлангийн индекс тус бүрд JOIN хийхээс сэргийлнэ.
  user_id       INTEGER NOT NULL,
  project_id    INTEGER,

  -- ⚠️ Revit-ийн ӨӨРИЙНХ нь гүйлгээний нэр, ЯГ ХЭВЭЭР.  `GetTransactionNames()`
  --    (`ChangeTracker.cs:675`) нь үйл явдлын өгөгдөлд аль хэдийн байгаа тул
  --    ҮНЭГҮЙ.  Нэр нь Revit-ийн ХЭЛНЭЭС хамаарна («Move» / «Переместить») —
  --    орчуулахгүй, таамаглахгүй, ЯГ ТЭР хэвээр хадгална.
  op_name       TEXT    NOT NULL DEFAULT '',
  -- Хэлнээс ҮЛ ХАМААРАХ хэвийн түлхүүр.  CHECK ТАВИАГҮЙ (0190-ийн заншил):
  -- create|edit|delete|undo|redo|view|annotate|link|sync|script|other.
  -- ⚠️ undo/redo нь ТУСДАА анги: `ChangeTracker.cs:685-686` нь «undo:»/«redo:»
  --    угтвар тавьдаг; түүнгүйгээр буцаалт «Зөөсөн» гэж ХУДАЛ харагдана.
  op_class      TEXT    NOT NULL DEFAULT 'edit',

  added_count    INTEGER NOT NULL DEFAULT 0,
  deleted_count  INTEGER NOT NULL DEFAULT 0,
  modified_count INTEGER NOT NULL DEFAULT 0,
  -- Категориор задалсан тоолуур, ж: {"Walls":4,"Doors":1}.
  -- ⚠️ Категорийн НЭР нь Revit-ийн хэлнээс хамаарна — эх хэвээр.
  category_json  TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(category_json)),

  -- Гүйлгээ committed болох үеийн ИДЭВХТЭЙ харагдац / хуудас.
  -- ⚠️ `sheet_uid` нь `revit_sheet_bindings.sheet_uid`-тай ИЖИЛ орон зай
  --    (ViewSheet.UniqueId) — ажлыг таск руу холбох ЦОРЫН ГАНЦ зам.
  view_uid      TEXT,
  sheet_uid     TEXT,

  -- human | ai | script | sync | system.  CHECK ТАВИАГҮЙ.
  origin        TEXT    NOT NULL DEFAULT 'human',

  -- ШАЛТГААН: энэ гүйлгээг үүсгэсэн үйл явдал (AI_ACTION).  learning_events.id
  cause_event_id INTEGER,
  -- ЭЦЭГ: буцаалт нь ЯМАР гүйлгээг буцаасан бэ.  revit_transactions.id
  parent_txn_id  INTEGER,

  parts_expected INTEGER NOT NULL DEFAULT 0,
  parts_present  INTEGER NOT NULL DEFAULT 0,

  -- bim_artifacts.id — flush багцын gzip element-delta blob.
  -- ⚠️ АРТЕФАКТ ЭХЛЭЭД, МӨР ДАРАА НЬ.  Ингэснээр `parts_present`-ийг
  --    ЭХНИЙ БИЧИЛТЭД мэдэж, ЯМАР Ч ТОХИРУУЛГЫН UPDATE ХЭРЭГГҮЙ болно —
  --    append-only-г БҮРЭН барих цорын ганц арга.  Байт нь blob дотор
  --    `txn_uid`-ээр түлхүүрлэгдэнэ (offset багана ХЭРЭГГҮЙ).
  element_artifact_id INTEGER,
  -- Энэ гүйлгээ ХЭДЭН `revit_element_touches` мөр авсан бэ.  Тооллого нь
  -- rows_read төлдөг тул мөрөнд бичив.
  touch_rows    INTEGER NOT NULL DEFAULT 0,

  occurred_at   TEXT    NOT NULL,                            -- КЛИЕНТ (UTC ISO)
  received_at   TEXT    NOT NULL DEFAULT (datetime('now')),  -- СЕРВЕР, bind = 0

  redacted_at      TEXT,
  redacted_by      INTEGER,
  redaction_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_revit_txn_uid
  ON revit_transactions (txn_uid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_revit_txn_seq
  ON revit_transactions (session_id, seq);
-- ЗӨВХӨН ӨӨРИЙГӨӨ ХАРАХ асуулгын гүйцэтгэлд.  Индекс БАЙГАА нь
-- ахлагчийн тайлан бичихийг ЗӨВШӨӨРСӨН гэсэн үг БИШ. -------------
CREATE INDEX IF NOT EXISTS idx_revit_txn_user
  ON revit_transactions (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_revit_txn_project
  ON revit_transactions (project_id, occurred_at) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revit_txn_sheet
  ON revit_transactions (sheet_uid, occurred_at) WHERE sheet_uid IS NOT NULL;

-- ================================================================
-- БҮРТГЭЛИЙН ТӨСВИЙН ДУГУЙНУУД — deploy-гүйгээр эзэн сольж чадна
-- ================================================================
-- ⚠️ Add-in эдгээрийг handshake дээр татаж локалдаа кэшлэнэ (1C-ийн гэрээ).
--    `assistant.min_confidence` шиг УНШИГЧГҮЙ болгож БҮҮ ҮЛДЭЭ —
--    `grep -rn "assistant.min_confidence" backend/src/` нь ӨНӨӨДӨР ТЭГ
--    үр дүн буцаадаг, өөрөөр хэлбэл 0195-ын тэр түлхүүрийг хэн ч уншдаггүй.
