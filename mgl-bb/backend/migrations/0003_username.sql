-- Migration: change email to username
ALTER TABLE users RENAME COLUMN email TO username;
UPDATE users SET username = 'admin' WHERE username = 'admin@mgl.mn';
