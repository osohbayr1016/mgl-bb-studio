-- 0244_email_account_teams.sql — баг бүрт зориулсан Gmail хайрцгийн холбоо.
-- Хоосон junction = бүх баг ашиглана (backward compatible).

CREATE TABLE IF NOT EXISTS email_account_teams (
  account_id INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_email_account_teams_team ON email_account_teams(team_id);
