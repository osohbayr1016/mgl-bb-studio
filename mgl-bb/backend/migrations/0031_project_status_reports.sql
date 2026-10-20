-- =============================================
-- Project status report (явцын тайлан) + progress notes
-- =============================================
-- Захиалагч / гэрээний нэгдсэн тайлан, дээр нь түүхэн "Явцын мэдээ"
-- бичлэгүүд хадгална.  Барилгын төслийн тогтмол тайлагнах форматтай:
--
--   ┌─────────────────────────────────────────────┐
--   │  Header (1:1 with project)                  │
--   │   • Холбогдох хүний мэдээлэл, утас, имэйл   │
--   │   • Гэрээний эхэлсэн / дуусах хугацаа       │
--   │   • Ажлын явц, Санхүүжилт                   │
--   │   • Онцгой байдал / Эрүүл мэнд / БХТ        │
--   ├─────────────────────────────────────────────┤
--   │  Progress notes (1:N)                       │
--   │   • Title, body, attachments[], timestamps  │
--   │   • Нэг тайлан дотор олон явцын мэдээ       │
--   └─────────────────────────────────────────────┘

CREATE TABLE IF NOT EXISTS project_status_reports (
  project_id            INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  -- Гэрээний / холбогдох хүний мэдээлэл
  contact_name          TEXT,
  contact_phone         TEXT,
  contact_email         TEXT,
  contract_start        TEXT,            -- ISO yyyy-mm-dd
  contract_end          TEXT,
  -- Үндсэн явц / санхүүжилтийн нөхцөл
  work_progress         TEXT,            -- "60%", "Эскизийн үе шат" г.м.
  funding_terms         TEXT,
  funding_percent       REAL,            -- 0..100
  -- Гадаад байгууллагуудтай харилцсан тэмдэглэл
  nema_note             TEXT,            -- Онцгой байдалын ерөнхий газар
  health_note           TEXT,            -- Эрүүл мэндийн хяналтын газар
  bdc_experts_note      TEXT,            -- БХТ — экспертүүдийн томилгоо
  bdc_review_note       TEXT,            -- БХТ — Магадлалын дүгнэлтийн нэгтгэл
  notes                 TEXT,            -- Чөлөөт зай
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_id         INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS project_progress_notes (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title                 TEXT NOT NULL,
  body                  TEXT,
  -- JSON массив: [{ "url": "...", "name": "..." }, ...]
  -- Зурaгаа r2 буудалд upload хийсний дараах URL-ыг хадгална.
  attachments_json      TEXT,
  created_by_id         INTEGER REFERENCES users(id),
  -- Хадгалсан үеийн тэмдэглэгдэх UB цаг.
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ppn_project ON project_progress_notes(project_id);
CREATE INDEX IF NOT EXISTS idx_ppn_created ON project_progress_notes(project_id, created_at DESC);
