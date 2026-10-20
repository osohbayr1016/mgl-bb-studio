-- 0244_system_user_ids.sql
-- «test» дансыг ирцийн roster-оос хасна.
--
-- Асуудал: `test` (username='test') нь бодит ажилтан биш ч `role='engineer'`,
-- `status='active'` тул ирцийн «Ирээгүй» жагсаалтад өдөр бүр нэмэгдэж,
-- ирцийн хувь, өдрийн хүснэгт, товчоо, ирц баталгаажуулалт, чөлөөний
-- сануулга бүгдийг нэгээр гажуудуулж байсан.
--
-- Шийдэл: `orgConfig().systemUserIds` (lib/systemUsers.ts) — тохиргооны
-- жагсаалт.  Кодын дефолт нь ХООСОН тул өөр компанид суулгахад MGL-ийн id
-- шингээгүй; энэ миграц зөвхөн MGL-ийн production-д утгыг бичнэ.
--
-- Дансыг `status='inactive'` болгосонгүй: routes/auth.ts-ийн login нь
-- `status='active'`-ыг шаарддаг тул туршилтын данс нэвтэрч чадахгүй болно.
--
-- Идемпотент: `test` данс байхгүй, эсвэл түлхүүр аль хэдийн бичигдсэн бол
-- юу ч хийхгүй (тэгэхээр өөрчлөлт гарахгүй).
INSERT INTO app_settings (key, value)
SELECT 'org.system_user_ids', CAST(u.id AS TEXT)
FROM users u
WHERE u.username = 'test'
  AND NOT EXISTS (SELECT 1 FROM app_settings s WHERE s.key = 'org.system_user_ids');
