-- =============================================
-- One-shot script to wipe every project and all dependent data from
-- remote D1. Users, teams, office IPs and attendance sessions are
-- intentionally untouched.
--
-- Order matters: D1/SQLite does not enforce ON DELETE CASCADE unless
-- PRAGMA foreign_keys = ON is in effect (it isn't for D1 statements),
-- so we delete from leaves upward to avoid orphans even though every
-- FK is declared CASCADE in DDL.
--
-- DESTRUCTIVE — irreversible on remote. Make sure this is what you want
-- before invoking with --remote.
-- =============================================

-- 1. Progress history (references tasks)
DELETE FROM progress_entries;

-- 2. Task assignees (references tasks + users)
DELETE FROM task_assignees;

-- 3. Document subtree (comments → revisions → documents, all project-scoped)
DELETE FROM document_comments;
DELETE FROM document_revisions;
DELETE FROM documents;

-- 4. Hierarchy: tasks → components → drawings → blocks
DELETE FROM tasks;
DELETE FROM components;
DELETE FROM drawings;
DELETE FROM blocks;

-- 5. Project metadata
DELETE FROM project_clients;
DELETE FROM project_members;
DELETE FROM daily_summaries;

-- 6. The projects themselves
DELETE FROM projects;

-- 7. Notifications — every notification we currently emit
--    ('progress_pending', 'progress_approved', 'progress_rejected',
--    'task_assigned') refers to project entities that just got wiped,
--    so the links would dead-end. Clear them so the bell starts fresh.
DELETE FROM notifications;

-- 8. Reset AUTOINCREMENT counters so the next project starts at id=1.
--    sqlite_sequence rows only exist for tables that have been
--    inserted into, so DELETE-WHERE is the safe shape.
DELETE FROM sqlite_sequence
WHERE name IN (
  'projects', 'blocks', 'drawings', 'components', 'tasks',
  'progress_entries', 'task_assignees',
  'project_members', 'project_clients', 'daily_summaries',
  'documents', 'document_revisions', 'document_comments',
  'notifications'
);
