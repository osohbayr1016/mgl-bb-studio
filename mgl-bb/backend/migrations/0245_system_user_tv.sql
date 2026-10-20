-- 0245_system_user_tv.sql
-- «TV самбар» дансыг ч ирцийн roster-оос хасна.
--
-- Лобби дэлгэц дээр нэвтэрч байдаг `TV` данс (username='TV') нь 0192-оос
-- хойш ердийн `engineer` мөр тул `role != 'client'` roster бүрд ажилтан шиг
-- тоологдож, «Ирээгүй» жагсаалтад өдөр бүр гарч байсан.  `is_support=1` нь
-- зөвхөн бүтээмжийн самбараас хасдаг — ирцэд нөлөөлдөггүй.
--
-- 0244-ийн `org.system_user_ids` жагсаалтыг дахин тооцоолж бичнэ
-- (lib/systemUsers.ts).  Кодын өөрчлөлт шаардлагагүй.
--
-- Идемпотент: утгыг username-үүдээс бүрэн дахин гаргадаг тул дахин
-- ажиллуулахад ижил үр дүн.  Данс байхгүй бол утга хөндөгдөхгүй.
UPDATE app_settings
SET value = (SELECT group_concat(id) FROM (SELECT id FROM users WHERE username IN ('test', 'TV') ORDER BY id))
WHERE key = 'org.system_user_ids'
  AND (SELECT group_concat(id) FROM users WHERE username IN ('test', 'TV')) IS NOT NULL;

INSERT INTO app_settings (key, value)
SELECT 'org.system_user_ids', v
FROM (SELECT group_concat(id) AS v FROM (SELECT id FROM users WHERE username IN ('test', 'TV') ORDER BY id))
WHERE v IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM app_settings s WHERE s.key = 'org.system_user_ids');
