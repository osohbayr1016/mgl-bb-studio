-- ==================================================================
-- 0238_assistant_team_scope.sql — СУРГАЛТЫН КОРПУСЫН БАГИЙН ХАМРАХ ХҮРЭЭ (2-6)
--
-- ЗОРИЛГО: v2 §50 «Team-specific data must remain traceable to company,
--   team, project, source, verification state, model version, dataset
--   version».  Долоон шинжийн ХОЁР ДАХЬ нь (team) өнөөдөр `assistant_logs`
--   ба `assistant_examples` дээр БАЙХГҮЙ.  Энэ миграц түүнийг нэмнэ ба
--   0195:59-60-ын өвөрмөц индексийг ГУРВАЛСАН болгож, хоёр багийг нэг
--   өгүүлбэрийг ӨӨРӨӨР шошголохыг зөвшөөрнө.
--
-- ⚠️ team_code TEXT, team_id INTEGER БИШ.  Шалтгаан: 0069-ийн прецедент
--    («баг дахин суулгагдахад мөр амьд үлдэхийн тулд кодоор лавлана»),
--    `revit_documents.team_code` аль хэдийн TEXT (0187:30), ба дүрмийн
--    багц нь `teams` хүснэгтгүй C# клиентэд хүргэгддэг.  Валидац нь
--    `lib/teamContext.ts`-ийн `isTeamCodeShape` + амьд `teams.code` хайлт,
--    роутын талд.
--
-- ⚠️ NULL = КОМПАНИ ДАЯАР (баг харгалзахгүй).  Энэ бол ЦОРЫН ГАНЦ
--    хамгаалж болох backfill өгөгдмөл: одоо байгаа 2402 мөр нь ямар ч
--    багийн нотолгоо БИШ (бүгд синтетик seed), тэднийг ямар нэг багт
--    оноох нь ТӨСӨӨЛӨЛ болно.  ЗОРИУД BACKFILL ХИЙХГҮЙ.
--
-- ⚠️ BIND АРИФМЕТИК (`lib/assistantLogInsert.ts` / `assistantExampleInsert.ts`
--    дээр хэмжсэн):  assistant_logs 17 -> 18 bind -> floor(100/18) = 5 мөр
--    (ӨӨРЧЛӨГДӨХГҮЙ) · assistant_examples 13 -> 14 bind -> floor(100/14) = 7
--    мөр (ӨӨРЧЛӨГДӨХГҮЙ).  Ingest-ийн бүтээмжид ТЭГ зардал.
--
-- ⚠️ DROP INDEX + CREATE INDEX нь ХҮСНЭГТИЙГ ДАХИН БАРИХГҮЙ.  Тиймээс
--    `users`-ын 19 каскад хүүхдийн хориг ЗӨРЧИГДӨХГҮЙ.  `assistant_examples`
--    нь `users`-ын хүүхэд (0195:53) — ХҮСНЭГТИЙГ ХЭЗЭЭ Ч rebuild хийхгүй.
--
-- ⚠️⚠️ DEPLOY-ИЙН ЦОНХ — УНШИЖ БАЙЖ ХЭРЭГЖҮҮЛ.  Statement 3-4 нь
--    `idx_assistant_ex_uniq`-ийн БАГАНЫН ЖАГСААЛТЫГ сольж байна.  Хуучин
--    worker-ийн `POST /assistant/examples` нь `ON CONFLICT (text, intent)`
--    гэж бичдэг бөгөөд SQLite нь ЯГ ТААРАХ өвөрмөц индекс шаарддаг тул тэр
--    INSERT нь миграцаас ХОЙШ, worker deploy-оос ӨМНӨ 500 өгнө.  Тэр цонх
--    нь ЗӨВХӨН курацийн гар үйлдэлд нөлөөлнө (admin/senior, өдөрт хэдэн
--    удаа) — add-in-ы `POST /assistant/logs` нь ӨӨР хүснэгт, ӨӨР индекс тул
--    ХӨНДӨГДӨХГҮЙ.  Цонхыг богиносгох цорын ганц арга: миграц ба worker
--    deploy-ыг ЗАЛГАА гүйцэтгэ.  Дараалал урвуулах нь БҮР МУУ (шинэ worker
--    хуучин индекс дээр ON CONFLICT алдаа өгнө).
--
-- ⚠️ IFNULL(team_code, '') — SQLite-д NULL нь өөртэйгөө ТЭНЦЭХГҮЙ тул
--    цэвэр `UNIQUE(text, intent, team_code)` нь компани даяарын мөрийг
--    ХЭДЭН УДАА Ч оруулахыг зөвшөөрнө.  Хоосон мөрөнд буулгах нь тэр
--    нүхийг хаана.  `''` нь хүчинтэй team_code БИШ (хэлбэр 2-8 үсэг).
--
-- ⚠️ ДАРААЛАЛ: ALTER x2 -> DROP -> CREATE UNIQUE -> CREATE INDEX x2 -> ALTER.
--    Өвөрмөц индексийг ЭХЛЭЭД хаяхгүй бол хоёр өвөрмөц хязгаарлалт үлдэж,
--    гуравласан нь утгагүй болно.  7 дахь ALTER нь ӨӨР хүснэгт дээр тул
--    дараалалд хамаарахгүй.
--
-- ⚠️ 7 дахь statement нь `learning_events` дээр — ЦОРЫН ГАНЦ ГАДНЫ ХҮСНЭГТ.
--    `lib/trainingRelevance.ts`-ийн `TRAINING_RELEVANCE.RULE_VALIDATION` нь
--    мөрийн ХӨЛДӨӨСӨН `verification_state`-ээс шийдэгддэг ба тэр багана
--    Track 2-т ЭЗЭНГҮЙ байв (0219 нь ЗӨВХӨН `team_code`/`team_source`
--    гаргадаг).  Эзэнгүй үлдээвэл файлын хамгийн ачаа даадаг салаа МӨНХӨД
--    идэвхгүй: `RULE_VALIDATION` бүр `evaluation_only` болж `HUMAN_VERIFIED`
--    вердикт сургалтын цөмд ХЭЗЭЭ Ч орохгүй.
--
-- ⚠️ GENERATED ALWAYS … VIRTUAL — bind ЗАРДАЛГҮЙ.  `EVENT_BINDS` 23 ХЭВЭЭР,
--    statement тутам 4 мөр ХЭВЭЭР.  БОДИТ багана нь ingest-ийг удаашруулах
--    ба 0206-ын append-only триггер UPDATE-ыг хаадаг тул хойш бөглөх
--    БОЛОМЖГҮЙ — VIRTUAL нь ЦОРЫН ГАНЦ зөв хэлбэр (0219-ийн адил).
--
-- ⚠️ ИНДЕКС ЗОРИУД ТАВИХГҮЙ: (1) файл 7/7 тээврийн таазан дээр,
--    (2) `verification_state`-ыг SQL-ээр ШҮҮХГҮЙ — тэнцэх мөрийн ЦОРЫН ГАНЦ
--    SQL шүүлт нь `bimEvents.ts:144`-ийн `DATASET_ELIGIBLE_SQL`,
--    `verification_state` нь TypeScript талд `relevanceOf`-оор уншигдана.
--    Индекс ҮНЭХЭЭР хэрэгтэй бол SPARE 0244 (0243-ыг 2-1 rollback-д заасан).
--
-- Нийт 7 statement (= таазан дээр), блок тайлбаргүй, мөр дотор нэмэлт
-- цэгтэй таслал байхгүй.  ⛔ 8 ДАХЬ STATEMENT НЭМЭХГҮЙ.
-- ==================================================================

-- 1. Түүхий бүртгэлийн баг — СЕРВЕР бөглөнө (клиент зарлаж БОЛОХГҮЙ).
ALTER TABLE assistant_logs ADD COLUMN team_code TEXT;

-- 2. Шошголсон жишээний баг — курацийн үед СЕРВЕР бөглөнө.
ALTER TABLE assistant_examples ADD COLUMN team_code TEXT;

-- 3. Хуучин хос өвөрмөц индексийг хаяна (0195:59-60).
DROP INDEX IF EXISTS idx_assistant_ex_uniq;

-- 4. ГУРВАЛСАН өвөрмөц — «нэг өгүүлбэр, нэг санаа, нэг баг».
CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_ex_uniq
  ON assistant_examples(text, intent, IFNULL(team_code, ''));

-- 5. Сургалтын экспортын гол унших хэлбэр — «баг + итгэл + санаа».
CREATE INDEX IF NOT EXISTS idx_assistant_ex_team
  ON assistant_examples(team_code, review_state, source_type, intent);

-- 6. Курацийн дараалалын багийн шүүлт (`GET /assistant/pending?team=`).
CREATE INDEX IF NOT EXISTS idx_assistant_logs_team
  ON assistant_logs(team_code, curated, created_at DESC);

-- 7. v2 §78-ийн хамаарлын давхаргын ЦОРЫН ГАНЦ өгөгдлийн эх сурвалж.
ALTER TABLE learning_events ADD COLUMN verification_state TEXT GENERATED ALWAYS AS (json_extract(payload_json, '$.verification_state')) VIRTUAL;
