-- 0415_drive_doc_sign_summaries.sql
-- «Баримт бичиг» (Google Drive) дээрх Word баримтын гарын үсгийн мөрүүдийн ХУРААНГУЙ —
-- хавтасны жагсаалтын тэмдэг (`POST …/drive/signing/statuses`, зөвхөн D1, Drive руу
-- дуудахгүй) захиалагчийн гарын үсэг дутуу эсэхийг мэдэхийн тулд.
--
-- Эзний хүсэлт (2026-10-19): RFI / CR нь захиалагч баталгаажуулж гарын үсэг зурсны ДАРАА л
-- «Батлагдсан» — өмнө нь захирал баталмагц «Батлагдсан» гэж харагддаг байв.  Дүрэм нь
-- lib/driveClientSign.ts (цэвэр); энэ хүснэгт нь зөвхөн КЭШ: сервер баримтыг уншсан бүрд
-- (самбар нээх, зурах, батлах, гаднын link-ээр зурах) дарж бичнэ.  Мөр байхгүй бол жагсаалт
-- гаднын link-ээс ойролцоолно — устгаж болох, үнэн нь Drive дээрх файл.
--
--   slots_json -- [{key, client, state, external}] — мөрийн түлхүүр (t{хүснэгт}r{мөр}c{багана}),
--                 захиалагчийн мөр эсэх, empty|erp|other, гаднын link-ээр зурсан эсэх.
--   file_name  -- RFI / CR эсэхийг нэрээр шийднэ (файл нэрээ солиход дагана).
-- users / projects руу REFERENCES ЗОРИУД БАЙХГҮЙ (0371-тэй ижил).
CREATE TABLE IF NOT EXISTS drive_doc_sign_summaries (
  file_id TEXT PRIMARY KEY,
  root_folder_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  slots_json TEXT NOT NULL,
  doc_modified_time TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ddss_root ON drive_doc_sign_summaries (root_folder_id);
