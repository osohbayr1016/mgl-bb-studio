-- =============================================
-- Multi-assignee support for tasks + subtasks
-- =============================================
-- Legacy schema had a single `assigned_to` FK on tasks/subtasks. Engineers
-- frequently share work, so we promote assignment to a many-to-many
-- relationship. The existing scalar column is kept (denormalized "primary
-- assignee") so older queries (dashboard, MyTasks, notifications) continue to
-- work during the rollout without a risky sweep — new writes set it to the
-- first element of the assignees array.

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id    INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE IF NOT EXISTS subtask_assignees (
  subtask_id INTEGER NOT NULL REFERENCES subtasks(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subtask_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_user    ON task_assignees(user_id);
CREATE INDEX IF NOT EXISTS idx_subtask_assignees_user ON subtask_assignees(user_id);

-- Backfill from the legacy scalar columns so existing assignments stay
-- visible under the new multi-assignee model.
INSERT OR IGNORE INTO task_assignees (task_id, user_id)
  SELECT id, assigned_to FROM tasks WHERE assigned_to IS NOT NULL;

INSERT OR IGNORE INTO subtask_assignees (subtask_id, user_id)
  SELECT id, assigned_to FROM subtasks WHERE assigned_to IS NOT NULL;
