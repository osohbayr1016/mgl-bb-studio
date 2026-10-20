-- Үнэлгээний шатлалын (Intern → Expert) өнгийг НЭГ navy-blue ramp болгов.
--
-- Өмнө нь тав тусдаа өнгө (саарал / шар / ягаан / цэнхэр / ногоон) байсан нь
-- шатлалыг ЭРЭМБЭГҮЙ ангилал мэт харуулж байв.  Шинэ өнгө нь нэг өнгөний
-- шаталсан (sequential) ramp: Intern цайвар ган → Expert гүн navy.  Утга нь
-- `lib/assessmentScore.ts` ба `frontend/.../lib/score.ts`-ийн `DEFAULT_LEVELS`,
-- мөн `scripts/assessments/architect-v1.json`-той ЯГ ижил байх ёстой.
--
--   EXPERT  #16a34a -> #2f57ab
--   SENIOR  #0ea5e9 -> #4a6cb5
--   MIDDLE  #6366f1 -> #6581bf
--   JUNIOR  #f59e0b -> #8299c9
--   INTERN  #94a3b8 -> #a1b3d7
--
-- ⚠️ `assessment_rounds.schema_json` бол загварын SNAPSHOT — асуулга/жинг нь
--    хөндөхийг хориглодог.  Гэхдээ ӨНГӨ бол зөвхөн дүрслэл (оноо, band-ын
--    хязгаарт огт нөлөөлөхгүй) тул хуучин раундууд ч шинэ ramp-аар харагдах нь
--    зөв — `BEHAVIOR_BANDS`-ыг хатуу кодлосонтой ижил зарчим.
--
-- Зөвхөн `"color":"#xxxxxx"` хэлбэрийг (API-ийн `JSON.stringify` гаргац)
-- орлуулна — асуултын текст доторх санамсаргүй мөрд хүрэхгүй.

UPDATE assessment_templates
SET schema_json = replace(
      replace(
        replace(
          replace(
            replace(schema_json, '"color":"#16a34a"', '"color":"#2f57ab"'),
            '"color":"#0ea5e9"', '"color":"#4a6cb5"'),
          '"color":"#6366f1"', '"color":"#6581bf"'),
        '"color":"#f59e0b"', '"color":"#8299c9"'),
      '"color":"#94a3b8"', '"color":"#a1b3d7"'),
    updated_at = datetime('now')
WHERE schema_json LIKE '%"color":"#16a34a"%'
   OR schema_json LIKE '%"color":"#0ea5e9"%'
   OR schema_json LIKE '%"color":"#6366f1"%'
   OR schema_json LIKE '%"color":"#f59e0b"%'
   OR schema_json LIKE '%"color":"#94a3b8"%';

UPDATE assessment_rounds
SET schema_json = replace(
      replace(
        replace(
          replace(
            replace(schema_json, '"color":"#16a34a"', '"color":"#2f57ab"'),
            '"color":"#0ea5e9"', '"color":"#4a6cb5"'),
          '"color":"#6366f1"', '"color":"#6581bf"'),
        '"color":"#f59e0b"', '"color":"#8299c9"'),
      '"color":"#94a3b8"', '"color":"#a1b3d7"'),
    updated_at = datetime('now')
WHERE schema_json LIKE '%"color":"#16a34a"%'
   OR schema_json LIKE '%"color":"#0ea5e9"%'
   OR schema_json LIKE '%"color":"#6366f1"%'
   OR schema_json LIKE '%"color":"#f59e0b"%'
   OR schema_json LIKE '%"color":"#94a3b8"%';
