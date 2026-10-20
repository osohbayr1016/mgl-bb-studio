-- 0368 — «ТАСК ДЭЭРХ НЭР = ОДОО ХИЙЖ БУЙ ХҮН» (эзний шийдвэр 2026-10-01), 1/2.
--
-- task_timer_sessions.end_note ба task_timer_events.note — 0361-ийн end_reason/action
-- CHECK олонлогийг ӨӨРЧЛӨХГҮЙГЭЭР (хүснэгт rebuild хийхгүйн тулд) ЯАГААД зогссоныг
-- тодруулна: clock_out (ирцээ «Гарах» бүртгэсэн), day_end (23:59-д автоматаар,
-- мартсан цаг), admin_stop (админ гараар), split (таскийг хуваахад тухайн хүн
-- өөрийн шинэ хэсэг рүү шилжсэн).  NULL = өмнөх утга (гараар зогсоосон, өөр таск
-- авсан, таск дууссан).  Дүрэм lib/taskTimer.ts OfficialTimerEndNote.
--
-- progress_entries.credit_user_id — «Анхны явц» (is_baseline = 1) бичлэгийн оноог
-- ХЭНД тооцох.  recalculateProjectPoints өмнө нь tasks.assigned_to (одоогийн
-- хариуцагч)-г уншдаг байв.  0369 бүх хариуцагчийг арилгах тул тэр мөчийн утгыг
-- ЭНД хөлдөөнө — дахин тооцоход хуучин онооны эзэн хөдлөхгүй.
--
-- Бүгд нэмэлт багана (ALTER ADD COLUMN) — users/projects-ийн rebuild БИШ, хуучин
-- worker шинэ баганыг үл тоож ажилласаар байна.

ALTER TABLE task_timer_sessions ADD COLUMN end_note TEXT;

ALTER TABLE task_timer_events ADD COLUMN note TEXT;

ALTER TABLE progress_entries ADD COLUMN credit_user_id INTEGER;

UPDATE progress_entries
   SET credit_user_id = (SELECT t.assigned_to FROM tasks t WHERE t.id = progress_entries.task_id)
 WHERE is_baseline = 1 AND credit_user_id IS NULL;
