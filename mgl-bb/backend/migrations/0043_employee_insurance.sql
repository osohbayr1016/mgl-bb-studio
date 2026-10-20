-- Employee insurance registry (ангилалаар захиалагч биш, ажилтан тус бүрээс).

CREATE TABLE IF NOT EXISTS insurance_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_mn TEXT NOT NULL,
  name_en TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO insurance_categories (code, name_mn, name_en, sort_order) VALUES
  ('HEALTH', 'Эрүүл мэндийн даатгал', 'Health insurance', 10),
  ('ACCIDENT', 'Гэнэтийн ослын даатгал', 'Accident insurance', 20),
  ('LIFE', 'Амь насны даатгал', 'Life insurance', 30),
  ('VEHICLE', 'Тээврийн хэрэгслийн даатгал', 'Vehicle insurance', 40),
  ('OTHER', 'Бусад', 'Other', 999);

CREATE TABLE IF NOT EXISTS employee_insurance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES insurance_categories(id) ON DELETE RESTRICT,
  policy_number TEXT,
  insurer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active', 'pending', 'expired', 'cancelled')),
  start_date TEXT,
  end_date TEXT,
  premium_amount REAL,
  coverage_amount REAL,
  currency TEXT NOT NULL DEFAULT 'MNT',
  payment_terms TEXT,
  insured_register TEXT,
  insured_phone TEXT,
  insured_address TEXT,
  beneficiary_name TEXT,
  beneficiary_register TEXT,
  coverage_notes TEXT,
  exclusions TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eir_user ON employee_insurance_records(user_id);
CREATE INDEX IF NOT EXISTS idx_eir_category ON employee_insurance_records(category_id);
CREATE INDEX IF NOT EXISTS idx_eir_status_end ON employee_insurance_records(status, end_date);

CREATE TABLE IF NOT EXISTS employee_insurance_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES employee_insurance_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_eif_record ON employee_insurance_files(record_id);
