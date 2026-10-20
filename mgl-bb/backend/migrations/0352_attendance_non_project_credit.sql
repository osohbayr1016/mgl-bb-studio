-- Төслийн бус ажлын цагийг ирцийн ажилласан цагт нэмэх (2026-09-28).
-- 15:00-д гарах бүртгэлээ хийгээд 15:00-17:00 оффисоос гадуур төслийн бус
-- ажил хийсэн хүний тэр 2 цаг hours_worked-д орно; гарах цаг нь бодитоороо
-- (15:00) үлдэнэ.  Энэ багана нь hours_worked-д АЛЬ ХЭДИЙН орсон хэсгийг
-- тусад нь хадгална — дахин бодоход давхар нэмэгдэхгүй, тайланд ялгаж
-- харуулна.  Дүрэм: backend/src/lib/nonProjectWork.ts nonProjectCreditMinutes,
-- бичигч: backend/src/lib/nonProjectWorkStore.ts syncNonProjectCredit.
ALTER TABLE attendance_sessions ADD COLUMN non_project_credit_hours REAL NOT NULL DEFAULT 0;
