-- 0359 — Зохиогчийн хяналтын дугаар БАГ ТУС БҮРЭЭР, ОГНООНЫ дарааллаар
-- (эзний шийдвэр 2026-09-29).
--
-- Өмнө нь: төсөл тус бүрд НЭГ дараалал, дугаар нь ИЛГЭЭХ мөчид MAX(seq)+1.
-- Тиймээс 07-01-ний очилтыг 09-нд нөхөж оруулахад DASR-016 авч байв
-- (прод, EVERGREEN).  Одоо:
--   • дараалал = (төсөл, дугаарлах баг).  Дугаарлах баг = тайлангийн ЭХНИЙ
--     баг (sort_order) — толгойн Doc. No. ба файлын нэрэнд орж буй тэр баг;
--   • дугаар = тэр багийн ноорог биш тайлангуудын ОГНООНЫ эрэмбэ (1..N);
--     ижил огноотой бол хуучин дугаарын дараалал, дараа нь id — тиймээс нэг
--     өдөр 5 тайлан бичсэн бол тэд хоорондоо байраа солихгүй;
--   • doc_no = DASR-<БАГ>-NNN (DASR-BB-001) — баг бүр 001-ээс эхэлдэг тул
--     багийн кодгүй бол нэгтгэсэн жагсаалтад хоёр «DASR-001» зэрэгцэнэ;
--   • Drive-аас нөхөж бүртгэсэн хуучин тайлан (seq NULL, 0332) ч дараалалд
--     орно — файлын дугаар нь legacy_doc_no-д хэвээр.
-- Цаашид дахин тооцоолол нь lib/asrNo.ts renumberAsrProject (илгээх, огноо /
-- баг засах, устгах, нөхөж бүртгэх бүрд).  Энэ миграц нь ОДОО БАЙГАА мөрүүдийг
-- ижил дүрмээр нэг удаа засна.
--
-- ⚠️ ХУУЧИН UNIQUE(project_id, seq) индексийг ЭХЛЭЭД устгана — баг бүр 1-ээс
--    эхэлбэл төсөл дотор хоёр «1» зайлшгүй.  Шинэ индекс нь (төсөл, баг, дугаар).
DROP INDEX IF EXISTS idx_asr_seq;

ALTER TABLE author_supervision_reports ADD COLUMN seq_team_id INTEGER;

-- Алхам 1: дугаарлах багийг тогтоож, эрэмбийн түлхүүрийг doc_no-д ТҮР бичнэ
-- (огноо | хуучин дугаар | id — бүгд тогтмол урттай тул мөрөөр эрэмбэлэгдэнэ),
-- seq-ийг мөргөлдөхгүй сөрөг утгад аваачна.  SET-ийн бүх илэрхийлэл ХУУЧИН
-- утгыг уншдаг тул түлхүүр дэх seq нь өөрчлөгдөхөөс өмнөхийнх.
UPDATE author_supervision_reports
   SET seq_team_id = (
         SELECT rt.team_id
           FROM author_supervision_report_teams rt
          WHERE rt.report_id = author_supervision_reports.id
          ORDER BY rt.sort_order, rt.team_id
          LIMIT 1),
       doc_no = report_date || '|' || printf('%09d', COALESCE(seq, 999999999)) || '|' || printf('%09d', id),
       seq = -id
 WHERE status <> 'draft';

-- Алхам 2: байр = ижил (төсөл, баг)-ийн түлхүүр нь ≤ өөрийнх тайлангийн тоо.
-- Дэд асуулга нь seq_team_id ба doc_no-г л уншдаг — энэ алхам тэднийг
-- хөндөхгүй тул UPDATE явж байхад ч тогтвортой (0340-ийн ижил арга).
UPDATE author_supervision_reports
   SET seq = (
         SELECT COUNT(*)
           FROM author_supervision_reports o
          WHERE o.project_id = author_supervision_reports.project_id
            AND o.status <> 'draft'
            AND o.seq_team_id IS author_supervision_reports.seq_team_id
            AND o.doc_no <= author_supervision_reports.doc_no)
 WHERE status <> 'draft';

-- Алхам 3: дугаарын бичвэр.  Баггүй (зөвхөн онолын хувьд) мөр DASR-NNN.
UPDATE author_supervision_reports
   SET doc_no = 'DASR-'
         || COALESCE((SELECT t.code FROM teams t WHERE t.id = author_supervision_reports.seq_team_id) || '-', '')
         || printf('%03d', seq)
 WHERE status <> 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS idx_asr_team_seq
  ON author_supervision_reports(project_id, seq_team_id, seq) WHERE seq IS NOT NULL;

-- «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн» мөрийн дугаарын цооног
-- холбоотой тайлангаа дагана (0355-ийн ижил дүрэм).  Холбоос тасарсан мөр
-- тэр үеийн дугаараа хадгална.
UPDATE asr_issue_resolutions
   SET prev_doc_no = (
         SELECT r.doc_no FROM author_supervision_reports r
          WHERE r.id = asr_issue_resolutions.prev_report_id)
 WHERE prev_report_id IN (
         SELECT id FROM author_supervision_reports WHERE doc_no IS NOT NULL);
