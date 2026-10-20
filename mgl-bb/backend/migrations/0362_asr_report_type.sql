-- 0362 — Зохиогчийн хяналтын тайлангийн ТӨРӨЛ (эзний шийдвэр 2026-09-29).
--
-- Үндсэн 4 төрөл, нэг тайлан ЯГ НЭГ төрөлтэй:
--   site           Талбайн хяналт   (өгөгдмөл — одоо байгаа БҮХ тайлан энэ)
--   online         Цахим уулзалт    (meeting_platform = ашигласан платформ)
--   drawing_change Зургийн өөрчлөлт
--   office         Оффис уулзалт
--
-- Цагаан жагсаалт нь `backend/src/lib/asrReportType.ts`.  CHECK ЗОРИУД
-- тавиагүй: утга нэмэхэд хүснэгтийг бүтнээр нь дахин барих шаардлага
-- үүсгэдэг (`users.work_schedule`-ийн сургамж).
--
-- NOT NULL DEFAULT 'site' тул одоо байгаа мөрүүд шууд «Талбайн хяналт» болно —
-- тэд бүгд талбайн очилт байсан тул тоо, ХАБ-ын баталгаа хэвээр.
ALTER TABLE author_supervision_reports ADD COLUMN report_type TEXT NOT NULL DEFAULT 'site';
ALTER TABLE author_supervision_reports ADD COLUMN meeting_platform TEXT;
