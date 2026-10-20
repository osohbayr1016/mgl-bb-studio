-- 0083_price_quotes.sql — "Үнийн санал" (Price Quote / Proposal)
--
-- Two layers:
--   * quote_templates + quote_template_sections + quote_template_items
--     — admin-authored, reusable schema. Sections hold ordered items;
--       items carry field_type + config_json (qty/unit_price/tax/discount
--       defaults for line items, option lists for select/multi_select).
--   * quotes + quote_comments — filled instances against a template.
--     status: draft → submitted → approved | rejected | expired.
--     Once status != 'draft' the row is read-only (server returns 409 on PUT).
--
-- Snapshots: intro_md / terms_md / currency / validity_days are copied
-- onto the quote at creation so admins can keep iterating templates
-- without rewriting in-flight client quotes.
--
-- No quote_revisions table for v1 — last-write-wins, same as
-- project_performance_reports. Add later if audit/undo is needed.

CREATE TABLE IF NOT EXISTS quote_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  description     TEXT,
  currency        TEXT    NOT NULL DEFAULT 'MNT',
  validity_days   INTEGER NOT NULL DEFAULT 30,
  locale          TEXT    NOT NULL DEFAULT 'mn',
  intro_md        TEXT,
  terms_md        TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_by_id   INTEGER REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quote_templates_active
  ON quote_templates(is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS quote_template_sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id   INTEGER NOT NULL REFERENCES quote_templates(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  title         TEXT    NOT NULL,
  description   TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qts_template
  ON quote_template_sections(template_id, position);

CREATE TABLE IF NOT EXISTS quote_template_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id    INTEGER NOT NULL REFERENCES quote_template_sections(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  label         TEXT    NOT NULL,
  field_type    TEXT    NOT NULL,   -- 'line_item' | 'text' | 'number' | 'select' | 'multi_select' | 'file'
  config_json   TEXT    NOT NULL DEFAULT '{}',
  required      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qti_section
  ON quote_template_items(section_id, position);

CREATE TABLE IF NOT EXISTS quotes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id         INTEGER NOT NULL REFERENCES quote_templates(id),
  project_id          INTEGER REFERENCES projects(id),
  client_id           INTEGER REFERENCES users(id),
  title               TEXT    NOT NULL,
  status              TEXT    NOT NULL DEFAULT 'draft',          -- draft|submitted|approved|rejected|expired
  data_json           TEXT    NOT NULL DEFAULT '{}',             -- {sections:[{id, items:[{id, value?, qty?, unit_price?, tax_pct?, discount_pct?}]}]}
  total_amount        REAL    NOT NULL DEFAULT 0,
  currency            TEXT    NOT NULL DEFAULT 'MNT',
  locale              TEXT    NOT NULL DEFAULT 'mn',
  intro_md_snapshot   TEXT,
  terms_md_snapshot   TEXT,
  validity_days       INTEGER NOT NULL DEFAULT 30,
  public_token        TEXT UNIQUE,                                -- optional long-lived signed link
  created_by_id       INTEGER REFERENCES users(id),
  last_saved_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  submitted_at        TEXT,
  reviewed_by_id      INTEGER REFERENCES users(id),
  reviewed_at         TEXT,
  review_note         TEXT,
  expires_at          TEXT,                                       -- submitted_at + validity_days
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_status   ON quotes(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_client   ON quotes(client_id, status);
CREATE INDEX IF NOT EXISTS idx_quotes_project  ON quotes(project_id);
CREATE INDEX IF NOT EXISTS idx_quotes_template ON quotes(template_id);

CREATE TABLE IF NOT EXISTS quote_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id    INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  body        TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qc_quote
  ON quote_comments(quote_id, created_at);
