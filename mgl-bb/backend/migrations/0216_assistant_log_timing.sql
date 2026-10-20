-- 0216_assistant_log_timing.sql — `assistant_logs`-ийн ХУГАЦААНЫ ТЕЛЕМЕТР (1C-ийн суурь)
--
-- ⚠️ ЯАГААД: `revit-mcp/addin/AssistantLog.cs:60-105` нь АРВАН ХОЁР ХУГАЦААНЫ
--    талбар зарлаж (`t_total_ms` … `t_agent_total_ms`), `:342-376`
--    `AttachTiming`-д БОДИТООР дүүргэж, `FlushAsync`-аар серверт ИЛГЭЭЖ
--    байна.  Сервер (`routes/revit.ts`-ийн `.map(...)`) НЭГИЙГ Ч уншдаггүй,
--    `assistant_logs`-д тийм багана БАЙХГҮЙ ⇒ хэмжилт ӨДӨР БҮР ЧИМЭЭГҮЙ
--    ХАЯГДАЖ байна.  Энэ бол 0212-ийн толгойд бичсэн ЯГ ТЭР алдаа
--    (`model_version` 3 талбар дээр), одоо 12 талбар дээр давтагдсан нь.
--    «250 мс-ийн хурдан зам» гэсэн БҮХ шаардлага ЭНЭ ӨГӨГДӨЛГҮЙГЭЭР
--    ХЭЗЭЭ Ч хэмжигдэхгүй — өнөөдөр бид зөвхөн ТААМАГЛАЖ байна.
--
-- ⚠️ ЯАГААД 12 ТУСДАА БАГАНА БИШ, НЭГ `timing_json` ВЭ (гол шийдвэр):
--    `assistant_logs` бол ӨНДӨР ЭЗЛЭХҮҮНТЭЙ хүснэгт бөгөөд INSERT нь
--    БАГЦААР явдаг.  Bind төсөг нь D1-ийн 100 bind/statement дээр тулдаг:
--      · өнөөдөр 16 багана → floor(100/16) = 6 мөр/statement
--      · 12 багана нэмбэл 28 → floor(100/28) = 3 мөр/statement (2 дахин олон
--        statement, тэр чинээгээр олон round trip)
--      · НЭГ JSON багана → 17 → floor(100/17) = 5 мөр/statement
--    Схемийн зардал нь мөн ялгаатай: 12 ALTER нь дараа нь талбар нэмэх бүрд
--    ДАХИН миграц + deploy шаардана, JSON нь шаардахгүй (add-in шинэ түлхүүр
--    нэмэхэд сервер зүгээр л дамжуулна).  ХАЛУУН скалярууд нь
--    `GENERATED ALWAYS AS (json_extract(...)) VIRTUAL` — 0207/0209/0210
--    ЯГ ЭНЭ хэв маягийг `learning_events.payload_json` дээр продакшнд аль
--    хэдийн баталсан.  VIRTUAL нь ХАДГАЛАХ ЗАЙ ЭЗЭЛДЭГГҮЙ (уншихад бодогдоно)
--    боловч ИНДЕКСЛЭГДЭЖ чадна — өөрөөр хэлбэл SQL талд тусдаа багана мэт
--    ажиллана, INSERT-ийн bind төсөгт ОРОХГҮЙ.
--
-- ⚠️ NULL vs '{}' — ТОДОРХОЙ ШИЙДВЭР, кодод хатуу бичигдсэн:
--      timing_json IS NULL   = ХЭМЖЭЭГҮЙ.  0216-аас өмнөх бүх мөр, ба
--                              телеметр илгээдэггүй хуучин add-in-ууд.
--      timing_json = объект   = add-in ХЭМЖИЖ ИЛГЭЭСЭН.  Дотор нь дутуу
--                              түлхүүр байвал тэр нь «тэр үе шат
--                              БОЛООГҮЙ» гэсэн утгатай (ж. `t_agent_ttft_ms`
--                              нь алсын streaming БУС эргэлт дээр байхгүй —
--                              `AssistantLog.cs:96-101`).
--    ⇒ «хэмжээгүй» ба «хэмжсэн боловч тэр үе шат байгаагүй» ХОЁР нь
--      ЯЛГАГДАНА.  `routes/revit.ts`-ийн `buildTimingJson` нь БҮХ талбар
--      дутуу үед ХООСОН ОБЪЕКТ БИШ, ЯГ NULL буцаана — тиймээс '{}' мөр
--      үүсэх зам БАЙХГҮЙ.  Хэрэв '{}' харагдвал энэ инвариант эвдэрсэн гэсэн
--      үг (гараар D1 засвар хийсэн байх).
--
-- ⚠️ CHECK нь ХОГ JSON-оос хамгаална.  SQLite-ийн ADD COLUMN дээр CHECK
--    ЗӨВШӨӨРӨГДДӨГ (0006/0009/0029/0030/0040 прецедент, 0215 хамгийн сүүлд).
--    Хуучин мөрүүдэд CHECK эргэж шалгагдахгүй тул backfill ШААРДЛАГАГҮЙ.
--
-- ⚠️ БАЙГАА хүснэгт дээрх ЦЭВЭР ADDITIVE ALTER.  `assistant_logs`-ыг ДАХИН
--    БҮТЭЭХГҮЙ (тэр нь `users`-ийн ON DELETE CASCADE хүүхэд — 0195:72).
--    `users` / `projects` ХӨНДӨГДӨХГҮЙ.
--
-- ⚠️ SQLite-ийн ADD COLUMN нь `IF NOT EXISTS`-ыг ДЭМЖДЭГГҮЙ — энэ файлыг
--    ХОЁР УДАА ажиллуулж БОЛОХГҮЙ.  Migration bookkeeping хамгаална,
--    гараар `d1 execute --file` БҮҮ ажиллуул.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: 6 statement (<= 9), блок тайлбаргүй, цэг таслал мөрөн дотор АЛГА (тайлбарт ч)

ALTER TABLE assistant_logs ADD COLUMN timing_json TEXT
  CHECK (timing_json IS NULL
         OR (json_valid(timing_json) AND json_type(timing_json) = 'object'));

-- ХАЛУУН СКАЛЯР 1 — «250 мс» гэсэн шаардлагын ЦОРЫН ГАНЦ тоо.
ALTER TABLE assistant_logs ADD COLUMN t_total_ms REAL
  GENERATED ALWAYS AS (json_extract(timing_json, '$.t_total_ms')) VIRTUAL;

-- ХАЛУУН СКАЛЯР 2 — АЛЬ давхарга шийдсэн: keyword | model | fallback.
-- ⚠️ Хуучин `decided_by` баганатай ДАВХАРДАНА (ижил гурван утга) — ЗОРИУД.
--    Тэд add-in-ы ӨӨР ХОЁР кодын замаас гарна (`IntentRouter.DecidedByTag`
--    ба `Timing`-ийн бичилт), тиймээс `route_layer <> decided_by` гэсэн мөр
--    нь өөрөө хэмжилтийн БҮРТГЭЛИЙН АЛДААНЫ дохио.  Тусдаа индекс ӨГӨХГҮЙ:
--    тэр тэнхлэгээр шүүх хэрэгцээг `decided_by` аль хэдийн хангадаг, VIRTUAL
--    багана нь зай эзлэхгүй тул зөвхөн тулгалтад ашиглагдана.
ALTER TABLE assistant_logs ADD COLUMN route_layer TEXT
  GENERATED ALWAYS AS (json_extract(timing_json, '$.route_layer')) VIRTUAL;

-- ХАЛУУН СКАЛЯР 3 — эргэлт ХААНА дуусав: empty | busy | pending | fallback | acted.
ALTER TABLE assistant_logs ADD COLUMN exit_path TEXT
  GENERATED ALWAYS AS (json_extract(timing_json, '$.exit_path')) VIRTUAL;

-- Гол шинжилгээний хэлбэр 1: «сүүлийн 7 хоногийн p50/p95 нь хэд вэ».
-- ⚠️ Хэсэгчилсэн: ХЭМЖЭЭГҮЙ мөр (одоогийн БҮХ мөр) индекст ОРОХГҮЙ.
-- ⚠️ `t_total_ms`-ыг индекст оруулсан нь СОРОНЗОН (covering) — цонхны
--    сканнер хүснэгт рүү огт хүрэхгүй.
CREATE INDEX IF NOT EXISTS idx_assistant_logs_latency
  ON assistant_logs (created_at DESC, t_total_ms)
  WHERE t_total_ms IS NOT NULL;

-- Гол шинжилгээний хэлбэр 2: «энэ долоо хоногт хэдэн эргэлт fallback дээр
-- зогсов», «busy хэдэн хувь болов».
CREATE INDEX IF NOT EXISTS idx_assistant_logs_exit
  ON assistant_logs (exit_path, created_at DESC)
  WHERE exit_path IS NOT NULL;
