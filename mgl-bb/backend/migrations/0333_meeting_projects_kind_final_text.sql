-- 0333_meeting_projects_kind_final_text.sql — Хурлын тэмдэглэл: олон төсөл,
-- компанийн хурал, эцсийн (гараар засварласан) текст.
--
-- 1) meeting_projects — нэг хурал ОЛОН төсөлтэй холбогдоно (N:M).
--    `meetings.project_id` ХЭВЭЭР үлдэнэ: «үндсэн» төсөл = жагсаалтын эхнийх
--    (sort_order 0).  MCP `create_tasks_from_meeting`-ийн fallback, хуучин
--    `?project_id=` шүүлт, `project_members`-тэй ижил «тусгал» загвар — эх
--    сурвалж нь meeting_projects, project_id нь тусгал (routes/meetings.ts
--    syncMeetingProjects л бичнэ).
-- 2) kind — 'project' | 'company'.  Компанийн хурал = төсөлтэй холбоогүй;
--    инвариант: kind='company' <=> meeting_projects хоосон (сервер шалгана).
--    Одоо байгаа төсөлгүй мөрүүд company болно.
-- 3) final_text — транскриптийн ДАРАА хүн гараар зассан эцсийн тэмдэглэл.
--    meeting_transcripts.transcript_text (Speechmatics-ийн түүхий гаралт)
--    ХӨНДӨГДӨХГҮЙ — дахин хөрвүүлэх/аудитад хэрэгтэй.  Шинжилгээ
--    (lib/meetingAnalysisAi.ts) final_text байвал түүнийг илүүд үзнэ.
--
-- D1 нь FK-г runtime-д мөрддөггүй тул DELETE /meetings/:id нь
-- meeting_projects мөрийг ГАРААР устгана (email.ts/pgp.ts-ийн конвенц).

CREATE TABLE IF NOT EXISTS meeting_projects (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (meeting_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_projects_project ON meeting_projects(project_id);

ALTER TABLE meetings ADD COLUMN kind TEXT NOT NULL DEFAULT 'project' CHECK (kind IN ('project', 'company'));

ALTER TABLE meetings ADD COLUMN final_text TEXT;

ALTER TABLE meetings ADD COLUMN final_text_updated_at TEXT;

ALTER TABLE meetings ADD COLUMN final_text_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

INSERT OR IGNORE INTO meeting_projects (meeting_id, project_id, sort_order)
  SELECT id, project_id, 0 FROM meetings WHERE project_id IS NOT NULL;

UPDATE meetings SET kind = 'company' WHERE project_id IS NULL;
