-- 0351_asr_companions.sql
-- Зохиогчийн хяналт: нэг тайланд ӨӨРИЙН БАГААС хамт явсан хүмүүс.
--
-- Нэг очилт = нэг тайлан хэвээр (`author_id` = тайлан бичсэн хүн).
-- Хамт явсан 3–4 хүн тус бүр дээр:
--   • тайлан бүртгэгдэнэ (очилтын «хэн явсан» тоо)
--   • улаан дэвтрийн зураг тусдаа (`red_book_*` тайлангийн зохиогчийнх хэвээр)
--
-- Хүмүүсийн жагсаалтыг `PATCH /:id` `companion_user_ids`-ээр солино.
-- Зураг нь тайлангийн хөлдөлтөөс гадуур — `/:id/companions/:userId/red-book`.

CREATE TABLE IF NOT EXISTS asr_report_companions (
  report_id INTEGER NOT NULL
    REFERENCES author_supervision_reports(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  red_book_photo_url TEXT,
  red_book_verified_by INTEGER,
  red_book_verified_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (report_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_asr_companions_user
  ON asr_report_companions(user_id, report_id);
