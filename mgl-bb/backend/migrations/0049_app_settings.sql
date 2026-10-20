-- App-wide attendance settings (formerly hardcoded in `types.ts`).
--
-- `late_grace_minutes`     — first N minutes after shift start that don't
--                             count as "late" (penalty + credit deduction).
-- `late_penalty_per_minute` — MNT charged per late minute.
--
-- Defaults preserve current behaviour: 0 grace, 500 ₮/min.
CREATE TABLE app_settings (
  key          TEXT PRIMARY KEY,
  value        TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by   INTEGER REFERENCES users(id)
);

INSERT INTO app_settings (key, value) VALUES
  ('late_grace_minutes', '0'),
  ('late_penalty_per_minute', '500');
