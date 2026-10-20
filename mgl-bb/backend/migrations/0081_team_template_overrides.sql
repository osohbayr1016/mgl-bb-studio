-- =============================================
-- Per-team form template overrides (тайлбар бичиг)
-- =============================================
-- Each row scopes a JSON patch onto one team's hardcoded
-- AccordionForm template (in
-- `frontend/src/components/team-reports/<team>/template.ts`). The
-- patch only touches human-readable labels / hints / placeholders /
-- blurbs / select-option labels — field keys, kinds, and visibleIf
-- logic stay code-bound to keep saved answers + Document renderers
-- consistent.
--
-- Missing row / missing key = fall back to the hardcoded default.
-- See `frontend/src/components/team-reports/resolveTemplate.ts`.
CREATE TABLE IF NOT EXISTS team_template_overrides (
  team_code      TEXT PRIMARY KEY,
  overrides_json TEXT NOT NULL DEFAULT '{}',
  updated_by_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
