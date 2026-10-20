-- =============================================
-- Attendance simplified to office-IP-only check.
-- Drops the QR token + per-employee device tables that the new flow
-- no longer reads or writes. office_ips and attendance_sessions stay.
-- attendance_sessions.device_id stays nullable (legacy data preserved).
-- =============================================

DROP TABLE IF EXISTS qr_tokens;
DROP TABLE IF EXISTS employee_devices;
