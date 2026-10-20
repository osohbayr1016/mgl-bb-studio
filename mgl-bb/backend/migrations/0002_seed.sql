-- Seed: Admin user (password: admin123)
-- bcryptjs hash of 'admin123' with 10 rounds
INSERT OR IGNORE INTO users (email, password_hash, full_name, role, status)
VALUES ('admin@mgl.mn', '$2a$10$8KxX5xKGhMNMCEm4G0Cagu8VuKmFER/rby/dKBLaHMrDBqtqf6EHi', 'System Admin', 'admin', 'active');
