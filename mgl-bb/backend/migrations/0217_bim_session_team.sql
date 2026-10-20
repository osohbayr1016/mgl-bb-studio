-- =============================================================
-- 0217_bim_session_team.sql — §48-ын дөрвөл + §72-ын company_id
-- =============================================================
-- ЗОРИЛГО: v2 §48-R4 нь team_id / team_confidence / team_source /
-- team_last_verified дөрвийг ЗААВАЛ хадгална гэж заасан.  Тэдгээрийг
-- `bim_sessions` дээр байрлуулна: сесс = НЭГ хэрэглэгч x НЭГ баримт, энэ
-- бол багийн контекстийн ЯГ ЗӨВ ширхэглэл.
--
-- ⚠️ ЯАГААД `bim_sessions` ДЭЭР, БУСАД ДЭЭР БИШ ВЭ:
-- `bim_sessions` нь 0206-ын найман триггерээс ГАДНА байгаа ЦОРЫН ГАНЦ BIM
-- хүснэгт (`backend/scripts/check-bim-events.mjs:35`).  §73 нь илрүүлэлт
-- залруулагдах ёстой гэж шаарддаг — UPDATE зөвхөн ЭНД хууль ёсны.
-- `learning_events` дээр бодит багана нэмбэл (а) 0206 түүнийг ард нь
-- дүүргэхийг БҮРЭН хориглоно, (б) EVENT_BINDS 23 -> 25 нь statement тутмын
-- мөрийг 4 -> 3 болгож, хамгийн их урсгалтай хүснэгтийн ingest-ийг 25%
-- удаашруулна (R7-ийн шууд зөрчил).  Тиймээс 0219 нь ЗӨВХӨН VIRTUAL.
--
-- ⚠️ ЭЗНИЙ ШИЙДВЭР Ш3 (2026-08-31) — `company_id` ЭНД ОРНО.
-- Баримтын өмнөх хувилбар түүнийг «ХОЙШЛУУЛСАН» гэж бичсэн байв; эзэн
-- зардлыг нь МЭДСЭЭР БАЙЖ баталсан.  BIND АРИФМЕТИК (bimEvents.ts:327
-- `floor(100/(binds+1))`):
--   SESSION_BINDS 27 -> 31 (багийн дөрөв) -> 32 (`company_id`)
--                     -> 33 (2-4-ийн `perf_json`, дискэн дээр 0226).
--   floor(100/28)=3  ...  floor(100/34)=2.
--   Өөрөөр хэлбэл statement тутмын мөр 3 -> 2 БУУРНА.  Энэ бол ХҮЛЭЭН
--   АВСАН зардал: `bim_sessions` нь бага урсгалтай (жилд ~122k мөр), харин
--   өндөр урсгалтай `learning_events` (23 bind) ХӨНДӨГДӨӨГҮЙ.
--   ⚠️ ДАРААГИЙН бодит багана нэмэхгүй: 34 bind нь мөр/statement-ийг
--   floor(100/35)=2 -д үлдээх ч нөөцийг бүрэн шавхана.  Шинэ гүйцэтгэлийн
--   тоо бүр `perf_json`-ы ДОТОР л орно (0226-ын гэрээ).
--
-- ⚠️ `company_id` нь TEXT, INTEGER БИШ.  Репод `companies` ХҮСНЭГТ
-- БАЙХГҮЙ — компанийн таних тэмдэг нь `lib/tenants.ts`-ийн `TenantSpec.id`
-- (богино мөр: `mgl`, `acme`), `lib/requestContext.ts:35`-ын анхдагч нь
-- `'default'`.  Тиймээс анхдагч нь ЯГ ТЭР мөр байх ёстой: нэг-tenant
-- суулгацын бүх мөр `'default'` болж, олон-tenant болоход зөвхөн ШИНЭ мөр
-- ялгарна.  Клиент ХЭЗЭЭ Ч энэ утгыг зарлахгүй — сервер токен/host-оос
-- шийднэ (`routes/learning.ts`-ийн `user_id`-тай ижил дүрэм).
--
-- ⚠️ `team_code` TEXT, `team_id` INTEGER БИШ.  Шалтгаан 0069-д бичигдсэн:
-- «баг дахин тарихад мөр амьд үлдэхийн тулд кодоор лавлана».  Мөн дүрмийн
-- багц нь `teams` хүснэгтгүй C# клиент рүү очно, `codePrefix()` нь код
-- хэлбэрийн мөр гаргадаг, `revit_documents.team_code` аль хэдийн TEXT
-- (0187:30).
--
-- ⚠️ `team_source`-т SQL CHECK БАЙХГҮЙ: хаалттай олонлог нь
-- `lib/teamContext.ts`-ийн `Record<TeamSource, ...>`-д (0205-ын `kind`-ийн
-- адил заль).  CHECK өөрчлөх нь хүснэгт ДАХИН БҮТЭЭХИЙГ шаардана, тэр нь
-- энэ хүснэгтэд хориотой.
--
-- ⚠️ REFERENCES ЗАРЛАЛ БАЙХГҮЙ — шалтгаан 0201-д бүтнээр бичигдсэн
-- (`ON DELETE SET NULL` нь хүүхдийн UPDATE болж, append-only триггерийг
-- асааж, эцгийн DELETE-ийг БҮХЭЛД НЬ ABORT болгодог).
--
-- ⚠️ SQLite-ийн ADD COLUMN нь IF NOT EXISTS-ыг ДЭМЖДЭГГҮЙ — энэ файлыг
-- ХОЁР УДАА ажиллуулж БОЛОХГҮЙ.
-- ⚠️ ТЭЭВЭР: 7 statement (тааз 9), блок тайлбаргүй, мөрөн дотор цэг таслал
-- АЛГА.
-- =============================================================

ALTER TABLE bim_sessions ADD COLUMN team_code TEXT;

ALTER TABLE bim_sessions ADD COLUMN team_confidence REAL NOT NULL DEFAULT 0;

ALTER TABLE bim_sessions ADD COLUMN team_source TEXT NOT NULL DEFAULT 'uncertain';

ALTER TABLE bim_sessions ADD COLUMN team_last_verified TEXT;

ALTER TABLE bim_sessions ADD COLUMN company_id TEXT NOT NULL DEFAULT 'default';

-- Багаар шүүх шинжилгээ: «BA багийн сүүлийн 30 хоногийн сесс».
-- Хэсэгчилсэн — илрүүлэлт унасан (NULL) сесс ЭНД ОРОХГҮЙ.
CREATE INDEX IF NOT EXISTS idx_bim_sessions_team
  ON bim_sessions (team_code, started_at DESC) WHERE team_code IS NOT NULL;

-- §66-ын хуурамч-сөрөг хэмжилт: «хэдэн сесс баггүй үлдэв».
CREATE INDEX IF NOT EXISTS idx_bim_sessions_team_uncertain
  ON bim_sessions (started_at DESC) WHERE team_code IS NULL;
