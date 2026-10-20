-- 0398 — Зохиогчийн хяналт: «Оффис уулзалт»-ын баримтын нэмэлт (эзний хүсэлт 2026-10-12).
--
--   meeting_doc_json = {
--     "party_lines":    {"<user_id>": "«…» ХХК-ийн Software engineer О.Өсөхбаяр"},  -- «Оролцогч тал»-ын
--                        манай талын мөрийг ГАРААР зассан утга (засаагүй хүн = автомат мөр)
--     "client_org":      "Жинди Хуарун ХХК",   -- хөлийн «… Талаас төлөөлж гарын үсэг зурсан»
--     "client_position": "Төслийн менежер"
--   }
-- Утгын дүрэм — backend/src/lib/asrMeeting.ts `sanitizeMeetingDoc`.  NULL = хоосон.  CHECK-гүй.
ALTER TABLE author_supervision_reports ADD COLUMN meeting_doc_json TEXT;
