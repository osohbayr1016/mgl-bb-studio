-- =============================================
-- 0017 mistakenly assumed the OLD model anchored task weights at "100 per
-- drawing". In practice the data was "100 per component" (each component
-- distributed its own 100 across its tasks). After 0017 multiplied every
-- task by drawing.weight_percent / 100, drawings with N components ended
-- up with task_sum = N * drawing.weight_percent instead of just
-- drawing.weight_percent.
--
-- This migration normalises every task in a drawing by the ratio
--   drawing.weight_percent / Σ(task.weight_percent in same drawing)
-- so that the new invariant "Σ task per drawing = drawing.weight_percent"
-- holds. Drawings with zero tasks are skipped (avoid divide-by-zero).
-- =============================================

UPDATE tasks
SET weight_percent = ROUND(
  weight_percent * (
    SELECT d.weight_percent * 1.0 / NULLIF(s.task_sum, 0)
    FROM components c
    INNER JOIN drawings d ON d.id = c.drawing_id
    INNER JOIN (
      SELECT d2.id AS drawing_id, SUM(t2.weight_percent) AS task_sum
      FROM drawings d2
      INNER JOIN components c2 ON c2.drawing_id = d2.id
      INNER JOIN tasks t2 ON t2.component_id = c2.id
      GROUP BY d2.id
    ) s ON s.drawing_id = d.id
    WHERE c.id = tasks.component_id
  ),
  4
)
WHERE EXISTS (
  SELECT 1
  FROM components c
  INNER JOIN drawings d ON d.id = c.drawing_id
  INNER JOIN (
    SELECT d2.id AS drawing_id, SUM(t2.weight_percent) AS task_sum
    FROM drawings d2
    INNER JOIN components c2 ON c2.drawing_id = d2.id
    INNER JOIN tasks t2 ON t2.component_id = c2.id
    GROUP BY d2.id
  ) s ON s.drawing_id = d.id
  WHERE c.id = tasks.component_id
    AND s.task_sum > 0
    AND d.weight_percent > 0
);
