-- =============================================================
-- Migration 0133: Зохиогчийн хяналт (Author's Supervision Report — ASR)
-- =============================================================
--
-- `YYMMDD_PROJECT ID_ASR_BA_001.docx` гэсэн Word загварыг бүрэн орлоно.
-- Талбай дээрх инженер утаснаасаа бөглөж (камераар зураг, дэлгэц дээр
-- гарын үсэг), илгээнэ; админ апп дотор батална.
--
-- Мөчлөг нь `progress_entries`-ийн толин тусгал:
--     draft → submitted → approved | rejected
--
-- НЭГ ОЧИЛТ = НЭГ ТАЙЛАН.  Олон багийг checkbox-оор хамарна, баг тус
-- бүрд «Ажлын тайлан» текст бичнэ.  Дугаарлалт төслөөр: ASR-001,
-- ASR-002 … (Word файлын нэрэн дэх багийн код дугаарт ОРОХГҮЙ).
--
--   ┌────────────────────────────────────────────────┐
--   │ author_supervision_reports (1 мөр = 1 очилт)    │
--   │   doc_no / report_date / shifr / doc_types      │
--   │   photos_json + 2× гарын үсгийн слот            │
--   │   status / reviewed_by / reviewed_at            │
--   ├────────────────────────────────────────────────┤
--   │ author_supervision_report_teams (1:N)           │
--   │   team_id FK + «Ажлын тайлан»                   │
--   └────────────────────────────────────────────────┘

-- -------------------------------------------------------------
-- 1. Тайлангийн үндсэн хүснэгт
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS author_supervision_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- Клиентээс ирдэг crypto.randomUUID().  Талбай дээрх тогтворгүй
  -- сүлжээнд POST нь D1 хүртэл очоод хариу нь замдаа алдагдвал инженер
  -- дахин товшдог — тэр үед энэ түлхүүр давхар мөр үүсгэхээс сэргийлж,
  -- сервер байгаа мөрөө буцаана.  UNIQUE index доор.
  client_uuid TEXT NOT NULL,

  -- Төслийн доторх дараалал.  UNIQUE(project_id, seq) нь MAX(seq)+1
  -- дугаарлалтын race-ийг ЧИМЭЭГҮЙ давхардуулахгүй, ил алдаа болгоно
  -- (lib/refNo.ts-ийн COUNT(*)+1-ээс сайжруулсан цэг).  Ноорог үед NULL
  -- байж, submit хийх мөчид олгогдоно — тэгснээр хаягдсан ноорог дугаар
  -- иддэггүй.
  seq INTEGER,
  doc_no TEXT,                         -- 'ASR-001', олгогдсоны дараа хөлдөнө

  report_date TEXT NOT NULL,           -- YYYY-MM-DD, УБ цагаар (lib/time.ts todayInUB)
  shifr TEXT,                          -- «Шифр» (project_passport.drawing_no-оос prefill)

  -- «Бичиг баримтын төрөл» checkbox-ууд.  JSON массив:
  --   ["planning","progress","report","drawing","schedule","other"]
  -- Хаалттай жагсаалт ч зөвхөн ХАРУУЛАХ зориулалттай — хэзээ ч энэ
  -- талбараар шүүхгүй тул 6 INTEGER багана + ирээдүйн 7 дахь төрлийн
  -- migration гэдэг үнэ цэнэгүй.  Серверийн DOC_KINDS Set цэвэрлэнэ.
  doc_types_json TEXT,
  doc_type_other TEXT,                 -- «Бусад» сонгосон үеийн чөлөөт текст

  description TEXT,                    -- «Тайлбар»

  -- «Attachment / Daily Report No.01-Photos» — дараалалтай галерей.
  -- URL-аар нь хэзээ ч хайхгүй тул project_progress_notes.attachments_json
  -- (0031:41-56)-тай ЯГ ижил хэлбэр: [{url,name}].  Тэгснээр
  -- routes/projects.ts-ийн parseAttachments()-ыг шууд дахин ашиглана.
  photos_json TEXT,

  -- «Хяналт хийсэн» 2 слот.  Тайлан бүрд ШИНЭЭР зурна (users.signature_url
  -- БИШ) — хэрэглэгчийн шийдвэр.  Яг 2 тогтмол слот × 3 скаляр = 6 багана:
  -- тоо нь Word загвараар хатуу, submit-ийн шалгалтад ордог тул JSON
  -- дотор нуух нь ашиггүй.
  sig_arch_name TEXT,                  -- Архитектор, Инженер
  sig_arch_url TEXT,                   -- /media/<key>
  sig_arch_date TEXT,
  sig_site_name TEXT,                  -- Талбайн инженер
  sig_site_url TEXT,
  sig_site_date TEXT,

  -- «Шалгасан» — чөлөөт текст (жишээ: Б.Билгүүн / MGL ENC Захирал).
  -- «Баталсан» багана ЗОРИУДААР БАЙХГҮЙ: түүнийг reviewed_by → users.
  -- full_name-ээс уншина, тэгснээр хоёр эх сурвалж хэзээ ч зөрөхгүй.
  checked_by_name TEXT,
  checked_by_title TEXT,

  -- Амьдралын мөчлөг — progress_entries-ийн толин тусгал.
  author_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,

  -- UTC — бусад бүх хүснэгттэй нийцүүлнэ (frontend-ийн parseInstant нь
  -- naive SQLite datetime-ыг UTC гэж тайлбарладаг).  report_date л УБ.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -------------------------------------------------------------
-- 2. Нэг очилт → олон баг, баг тус бүрд «Ажлын тайлан»
-- -------------------------------------------------------------
-- JSON map БИШ, ХҮҮХЭД ХҮСНЭГТ, учир нь:
--   1. «БА баг энэ төсөл дээр хэдэн удаа талбайд гарсан бэ», «БА-гийн
--      бүх хяналтын тэмдэглэл» гэдэг асуулт гарцаагүй ирнэ — энэ бол
--      энгийн WHERE, JSON map дээр LIKE-ийн хакк.
--   2. team_id нь ЖИНХЭНЭ FK: checkbox жагсаалт DB-ээс ирдэг (Word
--      загварын «ХТ»/«ДГ» багууд teams-д БАЙХГҮЙ, «ЦАХ» нь загварт
--      байхгүй) тул нэр солигдоход ч холбоос эвдэрхгүй.
--   3. «Хяналтаар явсан» сонголт ба «Ажлын тайлан» текст нэг л мөрөөс
--      уншигдана — хоёр бүтэц нэг баримтыг илэрхийлбэл зөрөх нь гарцаагүй.
CREATE TABLE IF NOT EXISTS author_supervision_report_teams (
  report_id INTEGER NOT NULL
    REFERENCES author_supervision_reports(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  work_note TEXT,                      -- «Ажлын тайлан» (тухайн багийнх)
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (report_id, team_id)
);

-- -------------------------------------------------------------
-- 3. Индексүүд
-- -------------------------------------------------------------
-- Жагсаалтын ORDER BY-тай яг таарсан.
CREATE INDEX IF NOT EXISTS idx_asr_project
  ON author_supervision_reports(project_id, report_date DESC, id DESC);

-- Батлах дараалал (ирээдүйд ApprovalsPage-д нэгтгэвэл).
CREATE INDEX IF NOT EXISTS idx_asr_status
  ON author_supervision_reports(status, project_id);

-- Дугаарын мөргөлдөөнийг чимээгүй давхардал биш, ил алдаа болгоно.
-- Partial: ноорог мөрүүд seq = NULL байдаг тул тэднийг хамруулахгүй.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asr_seq
  ON author_supervision_reports(project_id, seq) WHERE seq IS NOT NULL;

-- Давхар илгээлтээс хамгаалах түлхүүр.
CREATE UNIQUE INDEX IF NOT EXISTS idx_asr_uuid
  ON author_supervision_reports(client_uuid);

-- «Энэ багийн бүх хяналт» хайлт.
CREATE INDEX IF NOT EXISTS idx_asrt_team
  ON author_supervision_report_teams(team_id, report_id);
