-- =============================================
-- 0018 used a correlated subquery that read `tasks` while it was being
-- updated, so the per-drawing SUM() it relied on shifted mid-statement
-- and the rescale ended up partially applied (drawings landed at ~2x
-- their target instead of dead on).
--
-- This migration snapshots the per-drawing scaling factor into a real
-- staging table FIRST (D1 doesn't allow TEMP tables), then UPDATE-FROMs
-- against the snapshot so every task in a given drawing sees the same
-- factor regardless of update order. The staging table is dropped at
-- the end.
-- =============================================

DROP TABLE IF EXISTS _drawing_factor;

CREATE TABLE _drawing_factor (
  drawing_id INTEGER PRIMARY KEY,
  factor REAL NOT NULL
);

INSERT INTO _drawing_factor (drawing_id, factor)
SELECT
  d.id,
  CASE
    WHEN d.weight_percent > 0 AND COALESCE(SUM(t.weight_percent), 0) > 0
      THEN d.weight_percent * 1.0 / SUM(t.weight_percent)
    ELSE 1.0
  END
FROM drawings d
LEFT JOIN components c ON c.drawing_id = d.id
LEFT JOIN tasks t ON t.component_id = c.id
GROUP BY d.id;

UPDATE tasks
SET weight_percent = ROUND(
  weight_percent * (
    SELECT df.factor
    FROM _drawing_factor df
    INNER JOIN components c ON c.drawing_id = df.drawing_id
    WHERE c.id = tasks.component_id
  ),
  4
)
WHERE EXISTS (
  SELECT 1
  FROM _drawing_factor df
  INNER JOIN components c ON c.drawing_id = df.drawing_id
  WHERE c.id = tasks.component_id
    AND df.factor != 1.0
);

DROP TABLE _drawing_factor;
