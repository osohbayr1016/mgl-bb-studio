-- =============================================================
-- 0323_progress_auto_approve.sql — Явцын баталгаажуулалтын алхам ХАСАГДАВ
-- (2026-09-17)
-- =============================================================
-- Эзний шийдвэр: ажилтан өөрийн ажлаа зөв дуусгаж чадна — 100%-ийн
-- илгээлтийг ахлагч дахин батлах шаардлагагүй.  routes/progress.ts одоо
-- мөр бүрийг шууд status='approved' (reviewed_by = илгээгч) гэж бичдэг;
-- GET /pending-approvals, PATCH /:id/approve, PATCH /:id/reject устсан.
--
-- Дараалалд ГАЦСАН мөрүүдийг эндээс батална — эс тэгвэл тэдгээр нь ямар ч
-- UI/API-гүй, rollup-д тоологдохгүй мөнхийн 'pending' үлдэнэ.
-- reviewed_by = илгээгч (шинэ дүрэмтэй ижил), reviewed_at = одоо.
-- ⚠️ Эдгээр мөрд оноо (user_points) ЭНД олгогдохгүй — deploy-ийн дараа
-- POST /api/leaderboard/recalc-all (admin) ажиллуулбал ledger нөхөгдөнө.
UPDATE progress_entries
   SET status = 'approved',
       reviewed_by = user_id,
       reviewed_at = COALESCE(reviewed_at, datetime('now'))
 WHERE status = 'pending';

-- Хүлээгдэж буй баталгаажуулалтын мэдэгдлүүд одоо юу ч заахгүй — уншсан
-- болгоно (мөрийг устгахгүй, түүх хэвээр).
UPDATE notifications SET read = 1 WHERE type = 'progress_pending' AND read = 0;

-- Revit add-in-ийн «100%-аас доош ч pending болго» туг — уншигч үлдсэнгүй.
DELETE FROM app_settings WHERE key = 'revit.force_pending';
