-- Per-user «гаднаас системд хандах» зөвшөөрөл.
-- Admin UsersPage-аас toggle хийнэ.  1 бол тухайн хэрэглэгч оффисын IP-ийн
-- гаднаас бүрэн системд (ASR талбайд ажиллах гэх мэт) нэвтэрч болно.
-- client role нь энэ баганаас үл хамааран гаднаас ч хандах эрхтэй хэвээр.

ALTER TABLE users ADD COLUMN remote_access_allowed INTEGER NOT NULL DEFAULT 0;
