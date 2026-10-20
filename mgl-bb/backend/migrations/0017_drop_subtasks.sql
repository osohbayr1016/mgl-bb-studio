-- =============================================
-- Drop the Subtask layer; promote every subtask into a Task.
-- Re-anchor leaf weights so they read as "% of team" instead of "% of drawing".
--
-- Schema after this migration:
--   Project -> Block (= Team)        sum(blocks.weight_percent) = 100 per project
--           -> Drawing (= Group)     sum(drawings.weight_percent) = 100 per block
--           -> Component (folder)    no weight
--           -> Task (= leaf)         sum(tasks.weight_percent) = drawing.weight_percent
--                                    (equivalently: sums to 100 across a team)
-- =============================================

-- 1. Temp column on tasks so we can map old subtask_id -> new task.id
ALTER TABLE tasks ADD COLUMN legacy_subtask_id INTEGER;

-- 2. Promote each subtask into a fresh task row under the parent's component.
--    Sort key keeps each promoted task next to its old siblings.
INSERT INTO tasks (
  component_id, name, weight_percent, assigned_to,
  sort_order, due_date, start_date, created_at, legacy_subtask_id
)
SELECT
  pt.component_id,
  s.name,
  s.weight_percent,
  s.assigned_to,
  pt.sort_order * 1000 + COALESCE(s.sort_order, 0),
  s.due_date,
  s.start_date,
  s.created_at,
  s.id
FROM subtasks s
INNER JOIN tasks pt ON pt.id = s.task_id;

-- 3. Re-anchor progress_entries: any row that pointed at a subtask now
--    points at the new task. The XOR CHECK on (task_id, subtask_id) keeps
--    holding because we set one and null the other in the same UPDATE.
UPDATE progress_entries
SET task_id = (
      SELECT t.id FROM tasks t WHERE t.legacy_subtask_id = progress_entries.subtask_id
    ),
    subtask_id = NULL
WHERE subtask_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM tasks t WHERE t.legacy_subtask_id = progress_entries.subtask_id
  );

-- 4. Re-anchor assignees: subtask_assignees -> task_assignees on the new task.
INSERT OR IGNORE INTO task_assignees (task_id, user_id, created_at)
SELECT t.id, sa.user_id, sa.created_at
FROM subtask_assignees sa
INNER JOIN tasks t ON t.legacy_subtask_id = sa.subtask_id;

-- 5. Delete the old "container" tasks. Any task that had subtasks was just a
--    grouping row; its progress was derived. Each of its subtasks is now its
--    own task carrying the real weight + history.
DELETE FROM tasks
WHERE legacy_subtask_id IS NULL
  AND id IN (SELECT DISTINCT task_id FROM subtasks);

-- 6. Drop the subtask tables and their indexes.
DROP INDEX IF EXISTS idx_subtask_assignees_user;
DROP INDEX IF EXISTS idx_subtasks_task;
DROP INDEX IF EXISTS idx_subtasks_assigned;
DROP INDEX IF EXISTS idx_subtasks_due_date;
DROP INDEX IF EXISTS idx_progress_subtask;
DROP INDEX IF EXISTS idx_progress_subtask_approved_latest;
DROP TABLE IF EXISTS subtask_assignees;
DROP TABLE IF EXISTS subtasks;

-- 7. Re-scale every task's weight from "% of drawing" to "% of team".
--    Old model: leaves (tasks-without-subs + subs) summed to 100 per drawing.
--    New model: leaves (= every task) sum to drawing.weight_percent per drawing.
--    Therefore: new_weight = old_weight * drawing.weight_percent / 100.
UPDATE tasks
SET weight_percent = ROUND(
  weight_percent * (
    SELECT COALESCE(d.weight_percent, 0)
    FROM components c
    INNER JOIN drawings d ON d.id = c.drawing_id
    WHERE c.id = tasks.component_id
  ) / 100.0,
  4
);

-- 8. Drop the temp mapping column.
ALTER TABLE tasks DROP COLUMN legacy_subtask_id;
