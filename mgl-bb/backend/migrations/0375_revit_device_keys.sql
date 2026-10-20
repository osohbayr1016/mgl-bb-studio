-- =====================================================================
-- 0375_revit_device_keys.sql — Revit add-in-ий ТӨХӨӨРӨМЖИЙН КРИПТО ТАНИЛТ
-- =====================================================================
-- ЗОРИЛГО: 0374-ийн лиценз нь MachineGuid / техник хангамжийн хурууны мөрөнд
-- түшиглэдэг — түүнийг мэдэж байгаа хүн хуурамчаар илгээж чадна.  Одоо
-- компьютер бүр ӨӨРИЙН асимметр түлхүүртэй (ECDSA P-256, боломжтой бол TPM
-- дотор, экспортлогдохгүй).  Сервер зөвхөн НИЙТИЙН хагасыг хадгална, лиценз /
-- session авах бүрд нэг удаагийн challenge-д гарын үсэг зуруулна
-- (`lib/revitDeviceKey.ts`, `routes/revitDevice.ts`).
--
-- `revit_license_devices.status` (CHECK-гүй) одоо:
--   auto     — ирцийн ажлын компьютертэй техникээр таарсан (өгөгдмөл)
--   approved — admin гараар зөвшөөрсөн
--   pending  — түлхүүр бүртгүүлсэн, гэвч таараагүй / хязгаар хэтэрсэн: admin хүлээж буй
--   blocked  — admin хаасан (түлхүүр хэвээр, нотолгоо үргэлжлэн бүртгэгдэнэ)
--   revoked  — admin цуцалсан: түлхүүр УСТНА, дахин бүртгэхийн тулд эхлээд pending
--
-- `revit_device_keys` = төхөөрөмж тутмын НИЙТИЙН түлхүүр (нэг мөр = нэг төхөөрөмж).
--   key_x / key_y = P-256 нийтийн түлхүүрийн base64url (32 байт тус бүр)
--   key_id        = SHA-256(X||Y) hex — UNIQUE: нэг түлхүүр хоёр бүртгэлд орохгүй
--   security_level = tpm | software (add-in мэдэгдэнэ, admin-д харагдана)
-- Түлхүүргүй (хуучин) төхөөрөмж: энд мөр байхгүй — `revit.device_key_policy`
-- (app_settings) `required` болтол хуучин замаар ажиллана, түлхүүртэй төхөөрөмж
-- ҮРГЭЛЖ proof шаардана (proof-ыг орхиж downgrade хийх боломжгүй).
--
-- `revit_revoked_keys` = цуцлагдсан түлхүүрийн key_id (tombstone): admin цуцалсан түлхүүр (алдагдсан /
-- хулгайлагдсан програмын түлхүүр) дахин ЯМАР Ч төхөөрөмж дээр бүртгэгдэхгүй.
-- `revit_device_challenges` = нэг удаагийн challenge (replay хамгаалалт: used_at).
-- `revit_security_events`   = аюулгүй байдлын үйл явдлын хязгаарлагдмал бүртгэл
-- (токен, түлхүүр, гарын үсэг ХЭЗЭЭ Ч орохгүй).
--
-- ⚠️ users руу FK ЗОРИУД БАЙХГҮЙ (0374-тэй ижил шалтгаан), `DELETE /api/users/:id`
-- эдгээр хүснэгтийг гараар цэвэрлэнэ.
-- ⚠️ ТЭЭВЭР: 9-өөс бага statement, блок тайлбаргүй, мөрөн дотор цэг таслал алга.
-- =====================================================================

CREATE TABLE IF NOT EXISTS revit_device_keys (
  device_row_id   INTEGER PRIMARY KEY,
  key_id          TEXT    NOT NULL UNIQUE,
  key_x           TEXT    NOT NULL,
  key_y           TEXT    NOT NULL,
  security_level  TEXT    NOT NULL DEFAULT 'software',
  enrolled_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_proof_at   TEXT
);

CREATE TABLE IF NOT EXISTS revit_revoked_keys (
  key_id      TEXT    PRIMARY KEY,
  revoked_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  revoked_by  INTEGER,
  reason      TEXT
);

CREATE TABLE IF NOT EXISTS revit_device_challenges (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  device_id   TEXT    NOT NULL,
  purpose     TEXT    NOT NULL,
  nonce       TEXT    NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revit_security_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  at            TEXT    NOT NULL DEFAULT (datetime('now')),
  event         TEXT    NOT NULL,
  user_id       INTEGER,
  device_row_id INTEGER,
  device_short  TEXT,
  detail        TEXT,
  addin_version TEXT,
  ip            TEXT
);

CREATE INDEX IF NOT EXISTS idx_revit_device_challenges_exp
  ON revit_device_challenges (expires_at);

CREATE INDEX IF NOT EXISTS idx_revit_security_events_user
  ON revit_security_events (user_id, id);
