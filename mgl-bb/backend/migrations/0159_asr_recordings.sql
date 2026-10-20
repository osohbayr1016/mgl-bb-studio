-- =============================================================
-- Migration 0159: Зохиогчийн хяналт — дуу/видео бичлэг (STT)
-- =============================================================
--
-- Талбай дээрх инженер бичээд ярьж чаддаггүй (бээлийтэй, шаттай, шуургатай).
-- Тиймээс «Шинийг үүсгэх» урсгал нь: ноорог → зураг → ДУУ БИЧИХ → текст.
-- Бичлэг нь Speechmatics-ээр текст болж, инженер түүнийг «Тайлбар» эсвэл
-- багийн «Ажлын тайлан» руу оруулна.
--
-- ⚠️ Аудио нь `MEETING_BUCKET`-д (PRIVATE R2) очно, `MEDIA_BUCKET`-д ОГТ БИШ.
--    Binding-ийн нэр «MEETING» гэдэг нь ХУУЧИРСАН нэр — тэр bucket бол
--    «STT-д зориулсан хувийн bucket» гэсэн үүрэгтэй, зөвхөн хурлынх биш.
--    `/media/:key` бол баталгаажуулалтгүй, түлхүүрээр нь дэлхий даяар
--    уншигддаг (CLAUDE.md → Security #2) тул талбайн дуу бичлэг тэнд
--    ОРОХГҮЙ.  Уншилт нь зөвхөн гарын үсэгтэй `/meeting-audio/:key?t=`
--    (purpose:'stt-audio' JWT, audio_key-д уягдсан).
--
-- `meeting_recordings` (0095)-ийн толин тусгал, гэхдээ 3 ялгаатай:
--   1. `transcript_text` нь ЭНД, мөрөн дээрээ.  Хуралд 1 бичлэг = 1 хурал
--      тул тусдаа `meeting_transcripts` хүснэгт утга учиртай; ASR-д НЭГ
--      тайлан ОЛОН бичлэгтэй (push-to-talk сегмент, өөр өөр багийн тайлбар)
--      тул транскриптийг бичлэг тус бүрд нь наана.
--   2. `sort_order` — олон сегментийн дараалал.  Push-to-talk-ийн
--      fallback зам (нэг бүтэн контейнер үүсгэж чадахгүй хөтөч) нь
--      сегмент бүрийг тусад нь илгээж, ЭНЭ дарааллаар текстийг нийлүүлнэ.
--   3. Бүрэн json-v2-г R2-д ХАДГАЛАХГҮЙ.  Талбайн бичлэг богино (секунд-
--      минут) тул `SQLITE_TOOBIG`-ийн эрсдэлгүй ч, бидэнд илтгэгчийн
--      timing хэрэггүй — зөвхөн текст.  (`meeting_transcripts.transcript_json`
--      үргэлж NULL гэдэг конвенцийг энд огт хөндөхгүй.)
-- -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS asr_recordings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id         INTEGER NOT NULL
    REFERENCES author_supervision_reports(id) ON DELETE CASCADE,

  -- R2 объектын түлхүүр PRIVATE MEETING_BUCKET дотор.  Сервер талд
  -- `<userSub>-<ts>-<name>` хэлбэрээр үүсдэг (routes/upload.ts) тул
  -- intake нь `ownsKey` prefix шалгалтаар өөр хүний файл хавсаргахыг хаана.
  audio_key         TEXT    NOT NULL,
  content_type      TEXT,                        -- audio/webm, audio/mp4, video/mp4 …
  size_bytes        INTEGER,
  duration_seconds  REAL,                        -- эхэндээ клиентийн таамаг, дараа нь job-ийн бодит утга

  -- Speechmatics batch job (lib/speechmatics.ts).  Provider солих шийдвэр
  -- хойшлогдсон тул багана нь providerгүй нэртэй, `stt_provider` нь тэмдэглэл.
  stt_provider      TEXT    NOT NULL DEFAULT 'speechmatics',
  stt_job_id        TEXT,
  stt_status        TEXT,                        -- pending | running | success | error | fetch_error | trim_error
  transcript_text   TEXT,                        -- илтгэгчээр бүлэглэсэн энгийн текст
  language          TEXT,
  error             TEXT,

  -- Олон сегментийн дараалал.  Клиент нь 0-оос эхлэн өгнө; тэнцүү бол
  -- `id`-аар эрэмбэлэгдэнэ (INSERT дараалал = бичсэн дараалал).
  sort_order        INTEGER NOT NULL DEFAULT 0,

  created_by_id     INTEGER NOT NULL REFERENCES users(id),
  submitted_at      TEXT,
  completed_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Тайлангийн бичлэгүүдийг дараалалаар нь унших (детайл хариу бүрт).
CREATE INDEX IF NOT EXISTS idx_asrrec_report
  ON asr_recordings(report_id, sort_order, id);

-- Webhook нь `?rid=<recording id>`-аар ирдэг тул job-оор хайх нь зөвхөн
-- cron reconcile-д хэрэгтэй — гэхдээ тэр нь мөр бүрт нэг удаа ажиллана.
CREATE INDEX IF NOT EXISTS idx_asrrec_job
  ON asr_recordings(stt_job_id);

-- Cron backstop-ийн query: «илгээгдсэн ч дуусаагүй, 2 минутаас удсан».
-- `stt_status` дээрх partial index нь гацсан цөөн мөрийг л хамарна.
CREATE INDEX IF NOT EXISTS idx_asrrec_pending
  ON asr_recordings(submitted_at)
  WHERE stt_job_id IS NOT NULL AND completed_at IS NULL;
