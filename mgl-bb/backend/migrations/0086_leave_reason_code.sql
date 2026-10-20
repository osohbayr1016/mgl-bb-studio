-- Дотоод журам MGL-HR/0124, "АРВАН НЭГ. ЧӨЛӨӨ ОЛГОХ ЖУРАМ"-тай нийцүүлэх.
-- `leave_requests.leave_type` нь өргөн ангилал (annual / sick / unpaid /
-- remote / other) хэвээр үлдэх ба нарийвчилсан шалтгааныг `reason_code`-д
-- хадгална.  Цалинтай эсэхийг `is_paid` (0/1) талбараас түргэн уншина —
-- timesheet aggregator-т ашиглах боломжтой.
--
-- Хяналт: ямар reason_code зөвшөөрөгдөхийг app давхаргад баталгаажуулна
-- (журам цаашид өргөжихөд DB schema хөдлөхгүй байх үүднээс CHECK-ийг
-- зориуд тавьсангүй).

ALTER TABLE leave_requests ADD COLUMN reason_code TEXT;
ALTER TABLE leave_requests ADD COLUMN is_paid INTEGER;

-- Хуучин бичлэгүүдийг тагнах:  annual / sick / remote → цалинтай гэж
-- үзнэ, unpaid нь цалингүй, other нь тодорхойгүй (NULL хэвээр үлдээнэ).
UPDATE leave_requests SET is_paid = 1 WHERE is_paid IS NULL AND leave_type IN ('annual','sick','remote');
UPDATE leave_requests SET is_paid = 0 WHERE is_paid IS NULL AND leave_type = 'unpaid';

CREATE INDEX IF NOT EXISTS idx_leaves_reason_code ON leave_requests(reason_code);
CREATE INDEX IF NOT EXISTS idx_leaves_is_paid_user ON leave_requests(user_id, is_paid, start_date);
