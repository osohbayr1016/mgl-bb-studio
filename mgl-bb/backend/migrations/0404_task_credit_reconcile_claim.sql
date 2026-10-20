-- 0404 — Онооны тулгалтын дараалал: хувилбар + эзэмшлийн claim (0402-ын зэрэгцээ ажиллагааны засвар).
--
-- 0402-ын sweep мөрийг уншаад, тулгалт ажиллуулаад, дараа нь `DELETE … WHERE kind = ? AND target_id = ?` гэж
-- НӨХЦӨЛГҮЙ устгадаг байв.  Тэр хооронд (тулгалт хэдэн секунд үргэлжилнэ) шинэ жин засвар унаж
-- `enqueueCreditReconcile` ИЖИЛ мөрийг шинэчилбэл sweep ШИНЭ ажлыг устгана — тулгалт чимээгүй алга болно.
-- Мөн давхцсан хоёр cron тик ижил мөрийг зэрэг ажиллуулж, алдааны үед оролдлогыг хоёр нэмдэг байв.
--
--   version     — enqueue бүрд +1.  Sweep уншсан хувилбараараа л устгана / оролдлого нэмнэ (CAS).
--   claim_token — sweep мөрийг ажиллуулахаасаа ӨМНӨ эзэмшинэ; дуусгах/алдаа бичих нь зөвхөн тэр токеноор.
--   claimed_at  — унасан sweep-ийн эзэмшил 10 минутын дараа хүчингүй (дахин авч болно).
--
-- Нэмэлт багана л — хуучин worker үл тоомсорлоно (deploy дараалал: энэ миграц → worker).
ALTER TABLE task_credit_reconcile_queue ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE task_credit_reconcile_queue ADD COLUMN claim_token TEXT;
ALTER TABLE task_credit_reconcile_queue ADD COLUMN claimed_at TEXT;
