-- =============================================================
-- Migration 0136: `worker` role (цэвэрлэгч / туслах ажилтан)
-- =============================================================
--
-- ⚠️⚠️  ЭНЭ ФАЙЛЫГ `wrangler d1 migrations apply`-ЭЭР БҮҮ АЖИЛЛУУЛ  ⚠️⚠️
--
-- `users` хүснэгтийн `role` CHECK-ийг өөрчлөхийн тулд SQLite-д хүснэгтийг
-- бүтнээр нь дахин байгуулах (rebuild) шаардлагатай.  Гэвч production D1
-- дээр `PRAGMA foreign_keys` нь 1 (асаалттай) бөгөөд `users`-д ~40 хүснэгт
-- `ON DELETE CASCADE` / `ON DELETE SET NULL`-ээр холбогдсон байдаг.  FK
-- шалгалт асаалттай үед `DROP TABLE users` нь далд `DELETE FROM users`
-- ажиллуулдаг тул CASCADE хөөрч attendance_sessions, progress_entries,
-- notifications, user_points … бүх хүүхэд мөр УСТАНА.
--
-- 2026-08-04-нд түр зуурын D1 (mgl-fk-probe) дээр хэмжсэн бодит үр дүн:
--
--   зам                                             хүүхэд мөр
--   ------------------------------------------------------------
--   d1 migrations apply  (файлыг транзакцаар боодог)  0  ← БҮГД УСТСАН
--   d1 execute --file    (транзакцгүй)                бүрэн ✅
--
--   `PRAGMA defer_foreign_keys = true` (Cloudflare-ийн зөвлөдөг pragma) нь
--   CASCADE үйлдлийг ЗОГСООХГҮЙ — зөвхөн constraint шалгалтыг хойшлуулдаг.
--   `PRAGMA foreign_keys = OFF` нь транзакц дотор no-op тул `migrations
--   apply`-д огт нөлөөлөхгүй.  (Миграци 0035-ыг яг үүнээс болж хаясан.)
--
-- ⇒ Production дээр ЗӨВХӨН дараах дарааллаар (backend/-ээс) ажиллуулна:
--
--   1) Нөөцлөх (заавал):
--      npx wrangler d1 export mgl-progress-db --remote --config wrangler.toml \
--        --output ../backup-before-0136.sql
--
--   2) Rebuild (транзакцгүй зам — cascade хөөрөхгүй):
--      npx wrangler d1 execute mgl-progress-db --remote --config wrangler.toml \
--        --file ./migrations/0136_worker_role.sql
--
--   3) Шалгах — хүүхэд мөр бүтэн, FK эвдрээгүй эсэх:
--      npx wrangler d1 execute mgl-progress-db --remote --config wrangler.toml \
--        --command "PRAGMA foreign_key_check"                     -- хоосон байх ёстой
--      npx wrangler d1 execute mgl-progress-db --remote --config wrangler.toml \
--        --command "SELECT (SELECT COUNT(*) FROM users) u, (SELECT COUNT(*) FROM attendance_sessions) a, (SELECT COUNT(*) FROM progress_entries) p, (SELECT COUNT(*) FROM user_points) pt, (SELECT COUNT(*) FROM notifications) n"
--
--   4) Bookkeeping-ийг гараар тааруулах (эс бөгөөс дараагийн `migrations
--      apply` энэ файлыг ДАХИН ажиллуулж өгөгдөл устгана):
--      npx wrangler d1 execute mgl-progress-db --remote --config wrangler.toml \
--        --command "INSERT INTO d1_migrations (name) VALUES ('0136_worker_role.sql')"
--
-- Local dev DB дээр мөн ижил (--local, --file) зам ашиглана.
--
-- -------------------------------------------------------------
-- Өөрчлөлт: role CHECK-д 'worker' нэмэв.
--   BEFORE: ('admin','engineer','architect','senior','client')
--   AFTER : ('admin','engineer','architect','senior','client','worker')
-- Бусад бүх багана/DEFAULT/CHECK нь production-ийн одоогийн
-- sqlite_master дүрстэй ЯГ ижил (accent_color нь хэрэглээгүй ч
-- үлдээсэн — model_xkt_url-тэй ижил "leftover column" конвенц).
-- -------------------------------------------------------------

PRAGMA foreign_keys = OFF;

-- -------------------------------------------------------------
-- Хуучин ролийн нормчлол (зөвхөн replay-д нөлөөтэй).
-- -------------------------------------------------------------
-- `0035_users_email_and_role_split.sql` нь бүх `admin`-ыг
-- `system_admin` болгож, `management` ролийг нэмсэн.  Тэр хуваалт
-- 2026-06-д хаягдсан (хоёулаа зөвхөн код доторх зохиомол рол байсан)
-- бөгөөд production дээрх мөрүүд гараар `admin` болж буцсан тул доорх
-- CHECK амжилттай өнгөрсөн.  Харин ЦЭВЭР шинэ өгөгдлийн сан (local
-- bootstrap) 0035-ыг бодитоор ажиллуулдаг тул `system_admin` мөр үүсээд
-- энэ rebuild «CHECK constraint failed: role IN (…)»-ээр унадаг байв.
--
-- Нормчлолыг доорх `INSERT … SELECT`-ийн CASE дотор хийнэ — ХУУЧИН
-- хүснэгт дээр `UPDATE … SET role='admin'` хийж БОЛОХГҮЙ, учир нь
-- 0035-ийн CHECK жагсаалтад `admin` АЛГА.  Production дээр энэ CASE нь
-- ямар ч мөрийг өөрчлөхгүй (тэнд `system_admin`/`management` байхгүй).

CREATE TABLE users_new (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  username                    TEXT UNIQUE NOT NULL,
  password_hash               TEXT NOT NULL,
  full_name                   TEXT NOT NULL,
  role                        TEXT NOT NULL CHECK(role IN (
                                'admin','engineer','architect','senior','client','worker'
                              )),
  status                      TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  created_at                  TEXT DEFAULT (datetime('now')),
  updated_at                  TEXT DEFAULT (datetime('now')),
  profile_image               TEXT,
  cover_image                 TEXT,
  bio                         TEXT,
  description                 TEXT,
  social_links                TEXT,
  team_id                     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  position                    TEXT,
  employee_id                 TEXT,
  onboarding_acknowledged_at  TEXT,
  work_schedule               TEXT NOT NULL DEFAULT 'standard'
                              CHECK(work_schedule IN ('standard', 'early')),
  seniority                   TEXT
                              CHECK (seniority IN ('senior','intermediate','junior','intern')),
  email                       TEXT,
  accent_color                TEXT,
  attendance_device_id        TEXT,
  attendance_device_label     TEXT,
  attendance_device_bound_at  TEXT,
  is_support                  INTEGER NOT NULL DEFAULT 0,
  attendance_unrestricted     INTEGER NOT NULL DEFAULT 0,
  signature_url               TEXT,
  push_prefs                  TEXT
);

INSERT INTO users_new (
  id, username, password_hash, full_name, role, status,
  created_at, updated_at, profile_image, cover_image, bio,
  description, social_links, team_id, position, employee_id,
  onboarding_acknowledged_at, work_schedule, seniority, email,
  accent_color, attendance_device_id, attendance_device_label,
  attendance_device_bound_at, is_support, attendance_unrestricted,
  signature_url, push_prefs
)
SELECT
  id, username, password_hash, full_name,
  -- Хаягдсан 0035-ийн ролиудыг буцаан нормчилно (дээрх тайлбарыг үз).
  CASE role WHEN 'system_admin' THEN 'admin'
            WHEN 'management'   THEN 'admin'
            ELSE role END,
  status,
  created_at, updated_at, profile_image, cover_image, bio,
  description, social_links, team_id, position, employee_id,
  onboarding_acknowledged_at, work_schedule, seniority, email,
  accent_color, attendance_device_id, attendance_device_label,
  attendance_device_bound_at, is_support, attendance_unrestricted,
  signature_url, push_prefs
FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- Индексүүдийг дахин үүсгэнэ (username-ийн далд UNIQUE index автоматаар
-- сэргэдэг).  Production sqlite_master-аас хуулбарласан.
CREATE UNIQUE INDEX idx_users_employee_id
  ON users(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX idx_users_team      ON users(team_id);
CREATE INDEX idx_users_seniority ON users(seniority);

PRAGMA foreign_keys = ON;
