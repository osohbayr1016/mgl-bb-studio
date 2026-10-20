-- =============================================================
-- Migration 0132: Web Push (браузерын push мэдэгдэл)
-- =============================================================
--
-- Одоо байгаа `notifications` (аппликейшн доторх хонх) хэвээр үлдэнэ —
-- энэ migration нь түүн дээр push-ийн ДАВХАРГА нэмнэ:
--
--   push_subscriptions   — хэрэглэгчийн төхөөрөмж бүрийн PushSubscription
--                          (endpoint + p256dh + auth түлхүүр).
--   notifications.pushed — «энэ мэдэгдлийг push-оор илгээсэн үү» флаг.
--                          Cron sweep (lib/pushSweep.ts) pushed = 0 мөрүүдийг
--                          л түүж илгээнэ.
--   users.push_prefs     — ангилал тус бүрийн асаах/унтраах тохиргоо (JSON).
--
-- ⚠️ ЭНЭ ФАЙЛ ДАХЬ STATEMENT-ИЙН ДАРААЛАЛ ЧУХАЛ.  Доорх (3) backfill-ийг
--    орхивол анхны sweep нь ТҮҮХЭН БҮХ мэдэгдлийг бүх хүн рүү дахин
--    буудна.  Мөн (4) index-ийг backfill-ийн ДАРАА барьж байж хоосон
--    дэд олонлог дээр тогтоно.

-- -------------------------------------------------------------
-- 1. Төхөөрөмжийн бүртгэл (нэг хэрэглэгч олон төхөөрөмжтэй байж болно)
-- -------------------------------------------------------------
-- endpoint нь push service-ийн өгсөн цор ганц URL тул UNIQUE.  Нэг
-- оффисын компьютерийг өөр хүн ашиглавал ижил endpoint дээр user_id-г
-- дарж бичнэ (routes/push.ts дахь ON CONFLICT upsert-ийг үзнэ үү).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  -- Хэрэглэгчийн агентын P-256 нийтийн түлхүүр (65 байт, base64url).
  p256dh TEXT NOT NULL,
  -- 16 байтын authentication secret (base64url).
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  -- Дараалсан алдааны тоолуур; тодорхой хязгаараас хэтэрвэл мөрийг устгана.
  failure_count INTEGER NOT NULL DEFAULT 0
);

-- Sweep нь «эдгээр хэрэглэгчийн бүх төхөөрөмж» гэж уншдаг.
-- (endpoint-д тусад нь index хэрэггүй — UNIQUE аль хэдийн index үүсгэсэн.)
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- -------------------------------------------------------------
-- 2. Мэдэгдэл бүр push-оор явсан эсэх
-- -------------------------------------------------------------
ALTER TABLE notifications ADD COLUMN pushed INTEGER NOT NULL DEFAULT 0;

-- -------------------------------------------------------------
-- 3. ⚠️⚠️ BACKFILL — ЭНЭ МӨРИЙГ ХЭЗЭЭ Ч БҮҮ УСТГА ⚠️⚠️
-- -------------------------------------------------------------
-- Бүх ХУУЧИН мэдэгдлийг «илгээгдсэн» гэж тэмдэглэнэ.  Үүнгүйгээр
-- эхний cron sweep нь өнөөг хүртэлх бүх түүхэн мэдэгдлийг (олон
-- мянган мөр) бүх хэрэглэгчийн бүх төхөөрөмж рүү нэг дор буудаж,
-- push service-ээс rate-limit идэх болно.
UPDATE notifications SET pushed = 1;

-- -------------------------------------------------------------
-- 4. Sweep-ийн дараалал (queue) index
-- -------------------------------------------------------------
-- Partial index: зөвхөн pushed = 0 мөрүүд.  Дээрх backfill-ийн ДАРАА
-- үүсгэж байгаа тул хоосон дэд олонлог дээр барина — sweep бүрийн
-- `WHERE pushed = 0 ORDER BY id LIMIT 200` нь бүтэн table scan хийхгүй.
CREATE INDEX IF NOT EXISTS idx_notifications_push_queue
  ON notifications(id) WHERE pushed = 0;

-- -------------------------------------------------------------
-- 5. Хэрэглэгчийн push тохиргоо (ангиллын JSON)
-- -------------------------------------------------------------
-- NULL = анхдагч (бүх ангилал асаалттай).  lib/pushSweep.ts дахь
-- resolvePrefs() нь буруу/хуучин JSON-ыг чимээгүй анхдагч руу нь буулгана.
--
-- ЗӨВХӨН `ADD COLUMN`.  users хүснэгтийг ХЭЗЭЭ Ч дахин барьж болохгүй:
-- users(id)-д 40+ хүснэгт ON DELETE CASCADE-аар заадаг тул хүснэгт
-- дахин барих (rename/drop) нь тэдгээрийн өгөгдлийг цуврал устгана.
-- Дэлгэрэнгүйг migrations/0091_user_support_flag.sql-ийн тайлбараас үз.
ALTER TABLE users ADD COLUMN push_prefs TEXT;
