const bcrypt = require('bcryptjs');
const fs = require('fs');

bcrypt.hash('admin123', 10).then((hash) => {
  const sql = `
UPDATE users SET password_hash = '${hash}', status = 'active' WHERE username = 'admin';
INSERT INTO users (username, password_hash, full_name, role, status)
SELECT 'admin', '${hash}', 'System Admin', 'admin', 'active'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');
`;
  fs.writeFileSync('migrations/0004_fix_admin.sql', sql);
  console.log('Migration generated.');
});
