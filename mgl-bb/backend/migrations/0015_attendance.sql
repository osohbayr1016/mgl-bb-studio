-- =============================================
-- Attendance & Working Hours Tracking
-- 3-Layer Auth: Office IP → QR Code → Device ID
-- =============================================

-- Whitelisted office IP addresses for attendance check-in
CREATE TABLE IF NOT EXISTS office_ips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  ip_address TEXT NOT NULL UNIQUE,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Registered employee devices (phone/browser fingerprint)
CREATE TABLE IF NOT EXISTS employee_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL UNIQUE,
  device_name TEXT,
  registered_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT,
  is_active INTEGER DEFAULT 1
);

-- QR tokens — ephemeral, single-use, 30-second TTL
CREATE TABLE IF NOT EXISTS qr_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_by INTEGER REFERENCES users(id),
  used_at TEXT
);

-- Attendance sessions (clock-in / clock-out records)
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  clock_in TEXT NOT NULL,
  clock_out TEXT,
  hours_worked REAL,
  device_id TEXT,
  ip_address TEXT,
  date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_attendance_user ON attendance_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_sessions(date);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance_sessions(user_id, date);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_token ON qr_tokens(token);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_expires ON qr_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_employee_devices_user ON employee_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_devices_device ON employee_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_office_ips_active ON office_ips(is_active);
