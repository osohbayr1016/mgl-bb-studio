-- 0367 — Зохиогчийн хяналт: «Оффис уулзалт» төрлийн уулзалтын мэдээлэл
-- (эзний хүсэлт 2026-09-30).
--
-- Оффис уулзалтын тайланд маягтын «Тайлбар», «Бичиг баримтын төрөл» мөрүүд
-- гарахгүй, оронд нь уулзалтын мэдээлэл бичнэ (эзний Word тэмдэглэлийн
-- хүснэгт: Цаг, Уулзах газар, Оролцогч тал, Уулзалтын зорилго).  Өдөр нь
-- тайлангийн «Он сар өдөр» (report_date), бидний оролцсон ажилтнууд нь
-- «хамт явсан» хүснэгт (asr_report_companions, 0351), уулзалтын агуулга нь
-- work_report багана — шинэ багана хэрэггүй.
--
--   meeting_place   — Уулзах газар (чөлөөт бичвэр)
--   meeting_start   — эхэлсэн цаг «HH:MM»
--   meeting_end     — дууссан цаг «HH:MM»
--   meeting_parties — Оролцогч тал: захиалагч, гүйцэтгэгч гэх мэт гадны
--                     оролцогчид (байгууллага, албан тушаал, нэр)
--   meeting_purpose — Уулзалтын зорилго
--
-- Бүгд NULL-тэй, CHECK-гүй (0362-ийн шалтгаан) — утгын дүрэм нь
-- backend/src/lib/asrMeeting.ts.  Бусад төрлийн тайланд хоосон үлдэнэ.
ALTER TABLE author_supervision_reports ADD COLUMN meeting_place TEXT;
ALTER TABLE author_supervision_reports ADD COLUMN meeting_start TEXT;
ALTER TABLE author_supervision_reports ADD COLUMN meeting_end TEXT;
ALTER TABLE author_supervision_reports ADD COLUMN meeting_parties TEXT;
ALTER TABLE author_supervision_reports ADD COLUMN meeting_purpose TEXT;
