-- =============================================
-- Админ гараар "гарах цаг нөхөх" (clock-out backfill) audit талбарууд.
-- Ажилтан орой тарахдаа цагаа хаахаа мартсан үед админ
-- POST /api/attendance/sessions/:id/clock-out -оор гарах цагийг нөхөж
-- бичнэ — хэн, хэзээ, ямар тайлбартай нөхснийг эдгээр баганад үлдээнэ.
-- =============================================

ALTER TABLE attendance_sessions ADD COLUMN edited_by INTEGER REFERENCES users(id);
ALTER TABLE attendance_sessions ADD COLUMN edited_at TEXT;
ALTER TABLE attendance_sessions ADD COLUMN edit_note TEXT;
