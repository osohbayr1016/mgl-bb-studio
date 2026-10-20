-- =============================================
-- Onboarding acknowledgement
-- =============================================
-- Tracks when (and therefore whether) a user has read the company's
-- work guidelines (MGL-GL-25-001 / Ажлын удирдамж rev04).
-- NULL = not yet acknowledged; string = ISO timestamp of acknowledgement.
ALTER TABLE users ADD COLUMN onboarding_acknowledged_at TEXT;

-- Pre-acknowledge existing admins so they don't have to go through the
-- onboarding flow after deploy — they already know the rules.
UPDATE users
SET onboarding_acknowledged_at = datetime('now')
WHERE role = 'admin';
