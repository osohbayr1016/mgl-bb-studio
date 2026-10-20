
UPDATE users SET password_hash = '$2a$10$tHeGV9.kEX.HRCQ0EpYGUOWZ/FTzFxBtm51QZFNQpfqGseJLnyznS', status = 'active' WHERE username = 'admin';
INSERT INTO users (username, password_hash, full_name, role, status)
SELECT 'admin', '$2a$10$tHeGV9.kEX.HRCQ0EpYGUOWZ/FTzFxBtm51QZFNQpfqGseJLnyznS', 'System Admin', 'admin', 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');
