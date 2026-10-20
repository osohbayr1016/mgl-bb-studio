-- 0414 — Програмын хүсэлт: баталгаажсан reviewer-ийг холбох (2026-10-16).
--
-- Хэн: «Оюунбүрэн Өсөхбаяр» — users.id 75, username usukhbayar, employee_id USH (албан тушаал «Software engineer»).
-- Нотолгоо: 2026-10-16-нд production D1-ээс ЗӨВХӨН УНШИХ асуулгаар (full_name ба username-ийн өргөн хайлт) ЯГ НЭГ мөр
-- олдсон, дөрвөн бие даасан талбар (кирилл нэр, латин username, ажилтны код, албан тушаал) таарсан.
-- Албан тушаал нь зөвхөн нотолгоо — эрх олгох оролт БИШ.
--
-- Аюулгүй байдал:
--   • Хоёр INSERT хоёулаа id + username + employee_id + status='active' ГУРАВ/ДӨРВҮҮЛЭН таарвал л бичнэ.  Өөр компанийн
--     (tenant) эсвэл локал D1-д 75 дугаартай өөр хүн байвал юу ч бичигдэхгүй (inbox хаалттай хэвээр).
--   • Давтан ажиллуулахад давхар мөр үүсгэхгүй (NOT EXISTS).
--   • Энэ файл ӨӨР ХҮНД эрх олгохгүй.  Reviewer өөрөө API-гаар өөрийнхөө эрх/binding-ийг өөрчилж ЧАДАХГҮЙ (тийм зам алга).
-- Цуцлах:  UPDATE access_capabilities SET revoked_at = datetime('now') WHERE user_id = 75 AND capability = 'software_engineer' AND revoked_at IS NULL

INSERT INTO engineering_feedback_reviewer_binding (id, user_id, username, employee_id, bound_by, evidence)
SELECT 1, u.id, u.username, u.employee_id, 'migration:0414',
       'prod D1 read-only lookup 2026-10-16 - unique row - full_name, username, employee_id and position agree'
  FROM users u
 WHERE u.id = 75 AND u.username = 'usukhbayar' AND u.employee_id = 'USH' AND u.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM engineering_feedback_reviewer_binding);

INSERT INTO access_capabilities (user_id, capability, granted_by, note)
SELECT u.id, 'software_engineer', NULL, 'migration:0414 bootstrap - verified reviewer binding'
  FROM users u
 WHERE u.id = 75 AND u.username = 'usukhbayar' AND u.employee_id = 'USH' AND u.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM access_capabilities c
                    WHERE c.user_id = u.id AND c.capability = 'software_engineer' AND c.revoked_at IS NULL);
