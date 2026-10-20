-- 0355 — Зохиогчийн хяналтын тайлангийн дугаар ASR-NNN -> DASR-NNN.
--
-- Эзний шийдвэр 2026-09-28: баримтын нэр «Design Author Supervision Report»,
-- товчлол DASR, ХУУЧИН дугаарыг ч солино.  Шинэ дугаарыг lib/asrNo.ts
-- (formatAsrDocNo + allocateAndSubmit) DASR-ээр олгоно.
--
-- Зөвхөн СИСТЕМИЙН олгосон дугаар (seq IS NOT NULL).  Нөхөж бүртгэсэн хуучин
-- тайлан (seq NULL, doc_no = файлын өөрийн дугаар «ASR-BB-005», миграц 0332)
-- ХӨНДӨГДӨХГҮЙ — тэр нь Drive дээрх файлын нэртэй тулгагдах ёстой.
--
-- Идемпотент: ASR- угтвартай мөр л өөрчлөгдөнө, дахин ажиллуулахад юу ч болохгүй.
-- updated_at-ийг ЗОРИУД хөндөөгүй — агуулга өөрчлөгдөөгүй, нэр л солигдсон.

UPDATE author_supervision_reports
   SET doc_no = 'D' || doc_no
 WHERE seq IS NOT NULL
   AND doc_no LIKE 'ASR-%';

-- «Өмнөх тайлангийн асуудлыг бид ингэж шийдсэн» мөрийн дугаарын цооног нь
-- холбоотой тайлан системийн дугаартай бол түүнийг дагана.  Холбоос нь
-- тасарсан (өмнөх тайлан устсан) мөр тэр үеийн дугаараа хадгална.
UPDATE asr_issue_resolutions
   SET prev_doc_no = 'D' || prev_doc_no
 WHERE prev_doc_no LIKE 'ASR-%'
   AND prev_report_id IN (SELECT id FROM author_supervision_reports WHERE seq IS NOT NULL);
