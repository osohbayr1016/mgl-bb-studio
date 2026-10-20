-- =============================================================
-- Migration 0146: Асуулгын баг (BA/BB…) + раунд даяарх senior үнэлэгчид
-- =============================================================
--
-- Энэ файл нь ЗӨВХӨН `ALTER TABLE … ADD COLUMN` агуулна — хүснэгт дахин
-- байгуулахгүй тул `wrangler d1 migrations apply`-ээр аюулгүй ажиллана
-- (0136/0142-ийн DROP TABLE-ийн онцгой зам ЭНД ХАМААРАХГҮЙ).
--
-- 1) `assessment_templates.team_codes`
--    «Энэ асуулга нь BB багийнх» гэсэн АНХДАГЧ баг.  JSON массив текст:
--    '["BB"]' эсвэл '["BA","BB"]'.  NULL / '[]' = баг заагаагүй.
--    Раунд үүсгэхэд урьдчилан бөглөгдөж ирнэ, админ засаж болно —
--    template нь баг руу ЗАНГИДАХГҮЙ, зөвхөн санал болгоно.
--
-- 2) `assessment_rounds.team_codes`
--    Тухайн раунд ЯМАР багт явсныг бүртгэнэ (оролцогчид нь
--    `assessment_participants`-д хадгалагдсан ч «яагаад эдгээр хүмүүс вэ»
--    гэдэг нь алдагддаг байсан).  Мөн JSON массив текст.
--
-- 3) `assessment_rounds.senior_user_ids`
--    Раунд ДАЯАР үнэлэх senior-уудын id — JSON массив текст: '[4,11]'.
--    Сонгосон senior бүр БҮХ оролцогчийг үнэлнэ (өөрийгөө үнэлэхээс бусад),
--    өөрөөр хэлбэл `assessment_responses`-д оролцогч × senior бүрд нэг
--    'senior' мөр үүснэ.  Үүнийг migration 0142-ийн сулруулсан
--    UNIQUE(round_id, subject_user_id, evaluator_kind, evaluator_user_id)
--    боломжтой болгосон.  Оноолт талд `scoreAssessment` олон senior-ийн
--    хариултыг аль хэдийн ДУНДАЖИЛДАГ тул тооцооллын өөрчлөлт хэрэггүй.
--
--    `assessment_participants.evaluator_user_id` нь ХЭВЭЭР үлдэнэ — хуучин
--    раундуудын «үндсэн ахлагч» түүх, шинэ раундад эхний senior-ийг
--    бичнэ (жагсаалтын багана нэг л нэр харуулдаг).
-- -------------------------------------------------------------

ALTER TABLE assessment_templates ADD COLUMN team_codes TEXT;

ALTER TABLE assessment_rounds ADD COLUMN team_codes TEXT;

ALTER TABLE assessment_rounds ADD COLUMN senior_user_ids TEXT;
