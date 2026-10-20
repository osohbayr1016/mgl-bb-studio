-- 0328: Ирцийн төхөөрөмж — нэг ажилтанд ОЛОН браузер, нэг ФИЗИК компьютер.
--
-- Өмнө нь `users.attendance_device_id` ГАНЦ localStorage UUID хадгалдаг байв.
-- localStorage нь браузер-профайл × origin тус бүрд ТУСДАА тул ижил компьютер
-- дээр Chrome → Edge солих, PWA-г өөр браузераас суулгах, «браузерын өгөгдөл
-- цэвэрлэх», Windows дахин суулгах бүр ШИНЭ id үүсгэж, ажилтан 403 авч админ
-- reset шаарддаг байв.
--
-- Одоо: ажилтан бүрд `attendance_devices` мөрүүд — браузер тус бүрд нэг мөр
-- (`browser_id` = хуучин `mgl_device_id`), мөн тухайн браузерын ХЭМЖСЭН
-- техник хангамжийн профайл (`hw_hash`: GPU · CPU цөм · дэлгэц · платформ ·
-- цагийн бүс — `lib/attendanceDevice.ts`).  Танигдаагүй браузераас ирсэн
-- clock-in нь идэвхтэй мөрийн hw_hash-тай ТААРВАЛ ижил компьютер гэж үзээд
-- шинэ мөр (`bound_via = 'hw_match'`) автоматаар нэмэгдэнэ.
--
-- `users.attendance_device_*` баганууд ХЭВЭЭР: анхны (үндсэн) холболтын
-- толь — админы жагсаалтын «холбогдсон/холбоогүй» ба reset нь тэднийг
-- уншиж/цэвэрлэсээр байна.  Reset нь энэ хүснэгтийн мөрийг ч `revoked_at`-аар
-- хаана (устгахгүй — түүх).
--
-- ⚠️ D1 нь runtime дээр FK-г мөрддөггүй тул `DELETE /api/users/:id` энэ
--    хүснэгтийг ГАРААР устгана (users-ийн 20 дахь cascade хүүхэд).
CREATE TABLE IF NOT EXISTS attendance_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  browser_id TEXT NOT NULL,
  hw_hash TEXT,
  hw_json TEXT,
  user_agent TEXT,
  bound_via TEXT NOT NULL DEFAULT 'first' CHECK (bound_via IN ('first', 'hw_match', 'legacy')),
  bound_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  UNIQUE (user_id, browser_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_devices_user ON attendance_devices (user_id, revoked_at);

-- Одоо холбогдсон бүх хүний ганц id-г 'legacy' мөр болгож зөөнө (hw_hash NULL —
-- дараагийн ижил браузерын clock-in дээр профайлыг СУРНА).
INSERT OR IGNORE INTO attendance_devices (user_id, browser_id, user_agent, bound_via, bound_at)
  SELECT id, attendance_device_id, attendance_device_label, 'legacy',
         COALESCE(attendance_device_bound_at, datetime('now'))
    FROM users
   WHERE attendance_device_id IS NOT NULL;
