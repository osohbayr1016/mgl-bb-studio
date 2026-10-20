-- =============================================================
-- 0198_attendance_clockout_announcement.sql
--   «Гарах бүртгэлээ заавал хийнэ үү» — БҮХ ажилтанд НЭГ УДААГИЙН зарлал
-- =============================================================
--
-- ЭЗНИЙ ШААРДЛАГА (2026-08-26):
--   «Ажил тарах үед гарах бүртгэлээ хийгээгүй ажилтнууд маргааш өглөө
--    ирсэн бүртгэлээ хийх боломжгүй болно» гэдгийг ажилтан бүрт
--    урьдчилан мэдэгдэнэ.
--
-- Хаалт нь өөрөө `backend/src/routes/attendance.ts`-д хэрэгжсэн:
--   `POST /clock-in` → `findStaleOpenSession` → 409 `code:'OPEN_PRIOR_SESSION'`.
--   `CLOCKOUT_RULE_ACTIVE_FROM = '2026-08-26'` тул ЗӨВХӨН энэ өдрөөс хойш
--   нээгдсэн session хаалт үүсгэнэ — хуучин хуримтлагдсан «мартагдсан»
--   мөрүүд хэнийг ч гэнэт түгжихгүй.  Мөн текст нь frontend-ийн
--   `attendancePage.clockOutNotice` түлхүүртэй ижил (mn.json / en.json).
--
-- ЯАГААД MIGRATION, ЯАГААД ROUTE ЭСВЭЛ CRON БИШ:
--   * НЭГ УДААГИЙН зарлал.  `d1_migrations` bookkeeping нь давхар
--     илгээхээс өөрөө хамгаална — тусдаа туг ч, day-claim ч хэрэггүй.
--   * Route бол МӨНХИЙН API гадаргуу: `routes/notifications.ts` өнөөдөр
--     зөвхөн УНШИХ (GET / · GET /unread-count · POST /:id/read ·
--     POST /read-all), бүх backend даяар `INSERT INTO notifications` нь
--     ГАНЦХАН газар (`lib/notify.ts`) байдаг.  Нэг зарлалын төлөө тэр
--     хаалгыг үүрд онгойлгож, «бүгд рүү мэдэгдэх» товч үлдээхгүй.
--   * Cron нь хамгийн муу: `index.ts` нь `'* * * * *'`-ээс ӨӨР бүх cron
--     мөрөнд mail/meeting/calendar/deadline дөрвийг ажиллуулдаг тул
--     гуравдахь cron нэмэх нь тэр дөрвийг чимээгүй ДАВХАРДУУЛНА.
--
-- ⚠️⚠️ DEPLOY ДАРААЛАЛ НЬ ЭСРЭГ — WORKER ТҮРҮҮЛНЭ ⚠️⚠️
--   Ердийн дүрэм «migration түрүүлж, дараа нь worker» боловч ЭНД БУРУУ:
--   `lib/pushSweep.ts` нь мөрүүдийг ЭХЛЭЭД `pushed = 1` болгож тэмдэглээд
--   ДАРАА нь `CATEGORY_OF`-оор шүүдэг (`if (!cat) continue`).  Хуучин
--   worker дээр `attendance_announcement` түлхүүр байхгүй тул push нь
--   ЧИМЭЭГҮЙ УСТАЖ, буцаан сэргээх боломжгүй (мөр аль хэдийн pushed=1).
--   Тиймээс заавал:  (1) npm run deploy   →   (2) энэ migration.
--
-- `pushed` баганыг ОРХИНО (default 0) — зорилго нь bell + браузерын push
-- хоёулаа.  ~50 орчим мөр нь `MAX_NOTIFICATIONS_PER_SWEEP = 200`-аас
-- доогуур тул нэг sweep-д багтана, `STALE_MINUTES = 15` дотор явна.
--
-- ХАМРАХ ХҮРЭЭ: `status = 'active' AND role != 'client'` — репогийн ирцийн
-- roster конвенц (`attendanceConfirmations.ts`, `leaves.ts`).  Тайлбар:
--   * `worker` (цэвэрлэгч) ОРНО — хаалт түүнд ч үйлчилнэ, `/api/notifications`
--     нь `lib/workerScope.ts`-ийн allowlist-д байгаа тул хүлээж авна.
--   * `admin` tier ОРНО — тэд хаалтаас чөлөөлөгдсөн ч журмыг мэдэх ёстой
--     (хаалтыг тайлах ажил тэдэн дээр ирнэ).
--   * `client` ХАСАГДАНА — гадны хүн, ирц бүртгэдэггүй.
--
-- ИДЕМПОТЕНТ: `NOT EXISTS` нь энэ төрлийн мэдэгдэл аль хэдийн байгаа
-- хүнийг алгасна.  Migration дахин ажиллах ёсгүй ч, локал DB дээр гараар
-- дуудсан ч давхар мэдэгдэл үүсгэхгүй.
--
-- ⚠️ `notifications.user_id` нь `users(id)`-ийн `ON DELETE CASCADE`
-- хүүхэд.  `INSERT … SELECT` нь `users`-ээс шууд уншиж байгаа тул FK
-- зөрчил боломжгүй (хатуу бичсэн id ашиглаагүй).

INSERT INTO notifications (user_id, type, title, body, link)
SELECT u.id,
       'attendance_announcement',
       'Гарах бүртгэлээ заавал хийнэ үү',
       'Өдрийн мэнд. Ажил тарах үед гарах бүртгэлээ хийгээгүй ажилтнууд маргааш өглөө ирсэн бүртгэлээ хийх боломжгүй болохыг анхаарна уу. Иймд ажил тарах бүрдээ гарах бүртгэлээ заавал хийж хэвшинэ үү.',
       '/app/attendance'
  FROM users u
 WHERE u.status = 'active'
   AND u.role != 'client'
   AND NOT EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.user_id = u.id
            AND n.type = 'attendance_announcement'
       );
