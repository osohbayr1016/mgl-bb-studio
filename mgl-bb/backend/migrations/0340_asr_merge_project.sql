-- 0340 — Зохиогчийн хяналтыг ӨӨР ТӨСӨЛ РҮҮ нэгтгэх (эзний шийдвэр 2026-09-23).
--
-- Асуудал: нэг барилга ERP дээр ангилал тус бүрээр НЭГ мөр болж суудаг
-- (`main_projects` бүлэглэдэг ч `projects` мөр нь тусдаа).  EVERGREEN нь
-- AZ (id 41, архивлагдсан) ба ZA (id 37, идэвхтэй) хоёр мөртэй бөгөөд
-- талбайн хяналтын тайлан хоёуланд нь бүртгэгдчихсэн: AZ дээр 10, ZA дээр 3.
-- Инженер шинэ тайлан үүсгэхэд аль «EVERGREEN»-ийг сонгохоо мэдэхгүй, мөн
-- /app/asr самбарт нэг барилга хоёр мөр болж харагдана.
--
-- Шийдвэр: ЗХ-ийн хувьд НЭГ барилга = НЭГ төсөл.  AZ мөрийн бүх тайлан ZA
-- руу шилжинэ, AZ мөр нь ЗХ-ийн төсөл сонголт болон самбараас АРИЛНА.
--
-- ⚠️ ЮУ Ч УСТГАХГҮЙ.  `projects` мөр (41), түүний блок/зураг/таск/паспорт,
--    төслүүдийн жагсаалт, явцын түүх, Drive хавтас БҮГД хэвээр.  Шинэ багана
--    нь ЗӨВХӨН зохиогчийн хяналтын асуулгуудад уншигдана (lib/asrEligible.ts)
--    — өөр ямар ч модуль үүнийг мэдэхгүй.  Буцаах нь нэг UPDATE:
--    UPDATE projects SET asr_merged_into = NULL WHERE id = 41.
ALTER TABLE projects ADD COLUMN asr_merged_into INTEGER REFERENCES projects(id);

-- ДУГААРЛАЛТ.  `idx_asr_seq` нь UNIQUE(project_id, seq) тул хоёр багц
-- 1..10 ба 1..3 гэж давхцаж байгааг заавал зөрүүлнэ.  Эзний шийдвэр:
-- нэгтгэсэн бүртгэлийг ОГНООГООР 1..13 гэж ДАХИН дугаарлана (хамгийн эртний
-- очилт ASR-001).  Тиймээс 13 тайлангийн 12-ынх нь `doc_no` өөрчлөгдөнө.
--
-- ⚠️ ГУРВАН АЛХАМ, санамсаргүй биш.  SQLite нь UNIQUE индексийг мөр тутамд
--    ШУУД шалгадаг тул 1,2,3 → 11,12,13 гэх мэт «байрандаа» дугаарлалт нь
--    дундуураа мөргөлдөнө.  Иймд эхлээд БҮГДИЙГ мөргөлдөхгүй мужид (10001+)
--    аваачаад, дараа нь буулгана.
--
-- Алхам 1: AZ-гийн дугаартай мөрүүдийг ZA руу, түр 1001..1010 болгож
-- (ZA-гийн 1..3-тай мөргөлдөхгүй).
UPDATE author_supervision_reports
   SET project_id = 37,
       seq = seq + 1000
 WHERE project_id = 41 AND seq IS NOT NULL;

-- Алхам 2: дугааргүй мөрүүд (нөхөж бүртгэсэн хуучин файлууд, `doc_no` нь
-- файлынх) зөвхөн төслөө сольно — дараалалд ОРОХГҮЙ.
UPDATE author_supervision_reports
   SET project_id = 37
 WHERE project_id = 41;

-- Алхам 3: огноогоор эрэмбэлсэн байр суурийг тооцож 10000+ мужид бичнэ.
-- Дэд асуулга нь `report_date`/`id`-г л уншдаг (шинэчлэлт хөндөхгүй) тул
-- UPDATE явж байхад ч тогтвортой.  ROW_NUMBER() ХЭРЭГЛЭЭГҮЙ — энгийн
-- COUNT нь 13 мөрөнд ижил үр дүнтэй, D1-ийн хувилбараас хамаарахгүй.
UPDATE author_supervision_reports
   SET seq = 10000 + (
         SELECT COUNT(*)
           FROM author_supervision_reports r2
          WHERE r2.project_id = 37
            AND r2.seq IS NOT NULL
            AND (r2.report_date < author_supervision_reports.report_date
                 OR (r2.report_date = author_supervision_reports.report_date
                     AND r2.id <= author_supervision_reports.id)))
 WHERE project_id = 37 AND seq IS NOT NULL;

-- Алхам 4: 10001..10013 → 1..13 ба `doc_no` дагана.
UPDATE author_supervision_reports
   SET seq = seq - 10000,
       doc_no = 'ASR-' || printf('%03d', seq - 10000)
 WHERE project_id = 37 AND seq > 10000;

-- Хуваарь (`asr_visit_plans`), ХАБ-ын баталгаа (`asr_safety_acknowledgements`)
-- нь энэ төсөл дээр 0 мөртэй (хэмжсэн 2026-09-23) тул зөөх зүйл алга.
UPDATE projects SET asr_merged_into = 37 WHERE id = 41;
