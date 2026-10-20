-- =============================================
-- Attendance device binding.
-- Зөвхөн PC-гээс ирсэн бүртгэл (clock-in) хийхэд хэрэглэгчийг тухайн
-- төхөөрөмжид хатуу холбоно: анхны clock-in нь `attendance_device_id`-г
-- бичнэ, дараа нь зөвхөн тэр төхөөрөмжөөс л clock-in хийнэ.  Admin
-- `attendance_device_id`-г NULL болгож reset хийснээр шинэ PC холбогдоно.
-- attendance_sessions.device_id (migration 0015) нь session тус бүрийн
-- audit бичилтэд хэвээр ашиглагдана.
-- =============================================

ALTER TABLE users ADD COLUMN attendance_device_id TEXT;        -- холбогдсон PC-ийн id (NULL = холбоогүй)
ALTER TABLE users ADD COLUMN attendance_device_label TEXT;     -- холбох үеийн User-Agent snapshot (admin-д харуулах)
ALTER TABLE users ADD COLUMN attendance_device_bound_at TEXT;  -- хэзээ холбогдсон (ISO, UB)
