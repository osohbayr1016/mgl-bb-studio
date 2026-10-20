-- Үнийн санал → admin-only дотоод баримт (re-plan).
-- Хуучин клиент-урсгалын төлвүүдийг (submitted/approved/rejected/expired) шинэ
-- draft/final загвар руу нэг удаа хураана:
--   * approved  → final  (фирмийн хүлээн авсан/баталсан санал = эцсийн)
--   * submitted/rejected/expired → draft (дахин admin эцэслэх боломжтой ноорог)
-- Зөвхөн өгөгдөл шинэчилнэ — schema/CHECK өөрчлөхгүй (quotes.status нь CHECK-гүй
-- энгийн TEXT). Идемпотент: давтан ажиллуулахад аюулгүй.
-- CI deploy эвдэрсэн тул гараар хэрэглэнэ:
--   npx wrangler d1 execute mgl-progress-db --remote --file=./migrations/0107_quotes_status_collapse.sql

UPDATE quotes SET status = 'final' WHERE status = 'approved';
UPDATE quotes SET status = 'draft' WHERE status IN ('submitted', 'rejected', 'expired');
