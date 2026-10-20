-- =============================================
-- Чөлөө цуцлалтын audit талбарууд.
-- Зөвшөөрөгдсөн чөлөөг админ цуцлахад (POST /api/leaves/:id/cancel)
-- анхны зөвшөөрлийн reviewer_id / reviewer_note / decided_at-ийг
-- ДАРЖ БИЧИХГҮЙ — цуцлалтын мэдээлэл тусдаа баганад үлдэнэ, ингэснээр
-- "хэн зөвшөөрсөн → хэн цуцалсан" гэсэн бүрэн түүх хадгалагдана.
-- =============================================

ALTER TABLE leave_requests ADD COLUMN cancelled_by INTEGER REFERENCES users(id);
ALTER TABLE leave_requests ADD COLUMN cancelled_at TEXT;
ALTER TABLE leave_requests ADD COLUMN cancel_note TEXT;
