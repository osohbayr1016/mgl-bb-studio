-- =============================================================
-- 0226_perf_scalars.sql — `bim_sessions`-д СЕССИЙН ГҮЙЦЭТГЭЛИЙН ХУРААНГУЙ
-- =============================================================
-- ЗОРИЛГО: v2 §30-ын «Measure first» ба §82-ын «bounded AI resource usage»
--   шалгуурыг ХЭМЖИГДЭХҮЙЦ болгох.  Өнөөдөр `Metrics`-ийн 11 хуримтлуулагч
--   нь ЗӨВХӨН `%APPDATA%\RevitMcpAddin\timing.log`-д гардаг (512 KB, нэг
--   эргэлт — `Percentiles.cs:508`), сервер рүү ХҮРДЭГ ЗАМ БАЙХГҮЙ.  Хэмжилт
--   ажилтны компьютерт үлдэж байгаа тохиолдолд «add-in удаан уу» гэсэн
--   асуултад ХЭЗЭЭ Ч хариулж чадахгүй.
--
-- ⚠️ ЯАГААД 11 БАГАНА БИШ, НЭГ `perf_json` ВЭ:
--   `bim_sessions`-ийн bind төсөв: өнөөдөр 27 (`bimEvents.ts:384`), 2-1-ийн
--   багийн 4 талбар нэмэгдээд 31, энэ файлын `perf_json` нэмэгдээд 32.
--     floor(100 / 33) = 3 мөр/statement — 27 дээрхтэй ЯГ АДИЛ.
--   ⚠️ ЗУРГАА ДАХЬ бодит багана нь 33 болгож floor(100/34) = 2 руу унагаана
--   — өөрөөр хэлбэл ingest-ийн бүтээмж 33% буурна.  Тиймээс дараагийн БҮХ
--   гүйцэтгэлийн тоо нь `perf_json`-ы ДОТОР л орно — шинэ түлхүүр нэмэхэд
--   миграц ОГТ ШААРДАХГҮЙ (add-in зүгээр л илгээнэ, SQL нь json_extract-аар
--   уншина).  Энэ бол 0216-ийн `timing_json` дээр продакшнд БАТЛАГДСАН хэв маяг.
--
-- ⚠️ NULL vs хоосон объект — 0216:29-40-ийн инвариантыг ХУУЛНА:
--     perf_json IS NULL  = ХЭМЖЭЭГҮЙ (энэ файлаас өмнөх бүх сесс, ба
--                          телеметр илгээдэггүй хуучин add-in)
--     объект             = add-in ХЭМЖИЖ ИЛГЭЭСЭН — дутуу түлхүүр нь «тэр үе
--                          шат БОЛООГҮЙ» гэсэн утгатай
--   `BimEmitter` нь БҮХ талбар дутуу үед ХООСОН ОБЪЕКТ БИШ, ЯГ NULL илгээнэ.
--
-- ⚠️ ЦЭВЭР ADDITIVE ALTER.  `bim_sessions`-ыг ДАХИН БҮТЭЭХГҮЙ.
--   `users` / `projects` ХӨНДӨГДӨХГҮЙ.
-- ⚠️ SQLite-ийн ADD COLUMN нь IF NOT EXISTS-ыг ДЭМЖДЭГГҮЙ — энэ файлыг
--   ХОЁР УДАА ажиллуулж БОЛОХГҮЙ.  Гараар `d1 execute --file` БҮҮ ажиллуул.
-- ⚠️ ТЭЭВЭР: 7 statement (<= 9), блок тайлбаргүй, мөрөн дотор цэг таслал АЛГА

ALTER TABLE bim_sessions ADD COLUMN perf_json TEXT
  CHECK (perf_json IS NULL
         OR (json_valid(perf_json) AND json_type(perf_json) = 'object'));

-- ХАЛУУН СКАЛЯР 1 — ХАЛУУН замын p95.  R7-ийн ГОЛ тоо.
ALTER TABLE bim_sessions ADD COLUMN p95_doc_changed_ms REAL
  GENERATED ALWAYS AS (json_extract(perf_json, '$.p95_doc_changed_ms')) VIRTUAL;

-- ХАЛУУН СКАЛЯР 2 — үндсэн thread-ийн БОДИТ блоклолт (`Metrics.FlushLock`).
ALTER TABLE bim_sessions ADD COLUMN p95_flush_lock_ms REAL
  GENERATED ALWAYS AS (json_extract(perf_json, '$.p95_flush_lock_ms')) VIRTUAL;

-- ХАЛУУН СКАЛЯР 3 — нэгтгэгчийн хаалт (BACKGROUND).
ALTER TABLE bim_sessions ADD COLUMN p95_coalesce_ms REAL
  GENERATED ALWAYS AS (json_extract(perf_json, '$.p95_coalesce_ms')) VIRTUAL;

-- ХАЛУУН СКАЛЯР 4 — багц илгээлтийн эргэлт (REMOTE).
ALTER TABLE bim_sessions ADD COLUMN p95_emit_post_ms REAL
  GENERATED ALWAYS AS (json_extract(perf_json, '$.p95_emit_post_ms')) VIRTUAL;

-- Шинжилгээ 1: «сүүлийн 30 хоногийн халуун замын хуваарилалт».
-- ⚠️ Хэсэгчилсэн: ХЭМЖЭЭГҮЙ сесс индекст ОРОХГҮЙ.  Covering — сканнер
--   хүснэгт рүү хүрэхгүй.
CREATE INDEX IF NOT EXISTS idx_bim_sessions_perf_hot
  ON bim_sessions (started_at DESC, p95_doc_changed_ms)
  WHERE p95_doc_changed_ms IS NOT NULL;

-- Шинжилгээ 2: «аль машин дээр үндсэн thread хамгийн их блоклогдов».
-- ⚠️ АГРЕГАТ ЗОРИУЛАЛТ.  `machine_hash` нь sha256 (0202:63) — хүн БИШ, МАШИН.
--   Хүн тус бүрийн мөр ХЭЗЭЭ Ч рендерлэгдэхгүй (self-view-only инвариант).
CREATE INDEX IF NOT EXISTS idx_bim_sessions_perf_lock
  ON bim_sessions (machine_hash, p95_flush_lock_ms)
  WHERE p95_flush_lock_ms IS NOT NULL;
