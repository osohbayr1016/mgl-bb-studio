-- =============================================================
-- Migration 0141: «Төслийн хуваарь» (portfolio Gantt + эрсдэлийн хөдөлгүүр)
-- =============================================================
--
-- `/app/timeline` хуудас (admin + senior) нь төсөл бүрийг НЭГ мөрөөр огнооны
-- тэнхлэг дээр байрлуулж, аль ажил яаралтай болохыг эрэмбэлж харуулна.
-- Тухайн эрсдэлийн төлөв нь ШИНЭ багана биш — `project_passport.start_date /
-- finish_date`, нэгтгэсэн явц, сүүлийн хөдөлгөөнөөс УРГУУЛЖ бодогдоно
-- (backend/src/lib/projectRisk.ts).  Тиймээс энд төслийн статус/амьдралын
-- мөчлөгийн багана НЭМЭХГҮЙ — зөвхөн сануулгын БҮРТГЭЛ, гар явцын багана.
--
-- ⚠️ ЗӨВХӨН НЭМЭЛТ (additive).  DROP TABLE байхгүй, байгаа хүснэгтийн CHECK-д
--    гар хүрэхгүй.  Production D1 нь foreign key АСААЛТТАЙ ажилладаг бөгөөд
--    `wrangler d1 migrations apply` файл бүрийг transaction-д ороодог тул
--    parent хүснэгт унагаах нь бүх cascade хүүхэд мөрийг устгана
--    (0136_worker_role.sql-ийн runbook-ийг үз).

-- -------------------------------------------------------------
-- 1. Автомат сануулгын бүртгэл (өдөр тутмын cron)
-- -------------------------------------------------------------
-- Хугацаа дуусахаас 7 / 3 / 1 хоногийн өмнө, хугацаа хэтэрсэн үед, мөн
-- удаан хөдөлгөөнгүй (stale) төсөл дээр хариуцагч руу мэдэгдэл илгээнэ.
-- Энэ хүснэгт нь «ямар төсөл дээр ямар шатны сануулга илгээгдсэн бэ»
-- гэдгийг цээжилж, ӨДӨР БҮР ижил сануулга давтахаас сэргийлнэ
-- (`(project_id, stage)` анхдагч түлхүүр = шат тус бүр яг нэг удаа).
--
-- Хуваарь дахин тавигдвал (start/finish засварлагдвал) API нь энэ төслийн
-- мөрүүдийг устгаж, шинэ хуваарь дээр дахин сануулах эрхийг нь нээнэ —
-- routes/timeline.ts дахь PUT .../schedule-ийг үз.
CREATE TABLE IF NOT EXISTS project_reminders (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 'd7' | 'd3' | 'd1' | 'overdue' | 'stale'
  stage      TEXT    NOT NULL,
  sent_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, stage)
);

-- -------------------------------------------------------------
-- 2. Гар «түлхэц» (nudge) — хүнээс хүнрүү сануулга
-- -------------------------------------------------------------
-- Удирдлага хуваарийн хуудаснаас «сануулах» товч дарахад хариуцагч бүрд
-- нэг мөр бичигдэнэ.  Хоёр зорилготой: (а) хэн хэнд юу сануулсны түүх,
-- (б) нэг илгээгч нэг төсөл дээр ӨДӨРТ НЭГ УДАА л түлхэц өгөх хязгаар
-- (routes/timeline.ts нь өнөөдрийн мөр байвал 409 буцаана).
CREATE TABLE IF NOT EXISTS project_nudges (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  to_user_id   INTEGER NOT NULL REFERENCES users(id),
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Төслийн түүхийг сүүлийнхээс нь уншина.
CREATE INDEX IF NOT EXISTS idx_project_nudges_project
  ON project_nudges(project_id, created_at DESC);
-- «Энэ илгээгч өнөөдөр аль хэдийн түлхсэн үү» шалгалт.
CREATE INDEX IF NOT EXISTS idx_project_nudges_sender
  ON project_nudges(from_user_id, created_at DESC);

-- -------------------------------------------------------------
-- 3. Гар явц (manual_progress)
-- -------------------------------------------------------------
-- Жижиг засварын ажил нь блок / зураг / бүрэлдэхүүн / таскийн модгүй
-- ордог тул жинлэсэн нэгтгэлээр бодогдох явц нь МӨНХӨД 0% харагддаг —
-- хуваарийн хуудсанд бүгд «хийгдээгүй» мэт харагдана.  Энэ баганад
-- удирдлага гараар 0–100 хооронд утга тавьж, тухайн төслийн бодит
-- байдлыг илэрхийлнэ.
--
-- Урьтамж: гар утга БАЙВАЛ ДАВАМГАЙЛНА
-- (`COALESCE(p.manual_progress, pp.progress, 0)` — routes/projects.ts дахь
-- PROJECT_LIST_SQL-ийг үз).  NULL = гар утга байхгүй, мод дээрээс бодно.
-- REAL тул 12.5 гэх мэт бутархай утга зөвшөөрөгдөнө.
ALTER TABLE projects ADD COLUMN manual_progress REAL;
