WITH
latest_task AS (
  SELECT pe.task_id, pe.percentage
  FROM progress_entries pe
  WHERE pe.task_id IS NOT NULL AND pe.status = 'approved'
    AND pe.id = (
      SELECT id FROM progress_entries x
      WHERE x.task_id = pe.task_id AND x.status = 'approved'
      ORDER BY x.created_at DESC
      LIMIT 1
    )
),
draw_prog AS (
  SELECT d.id, d.block_id, d.weight_percent,
         CASE WHEN d.weight_percent > 0
           THEN COALESCE(SUM(t.weight_percent * COALESCE(lt.percentage, 0) / 100.0), 0) * 100.0 / d.weight_percent
           ELSE 0 END AS progress
  FROM drawings d
  LEFT JOIN components c ON c.drawing_id = d.id
  LEFT JOIN tasks t ON t.component_id = c.id
  LEFT JOIN latest_task lt ON lt.task_id = t.id
  GROUP BY d.id, d.block_id, d.weight_percent
),
block_prog AS (
  SELECT b.id, b.project_id, b.team_id, b.weight_percent,
         COALESCE(SUM(dp.weight_percent * dp.progress / 100.0), 0) AS progress
  FROM blocks b
  LEFT JOIN draw_prog dp ON dp.block_id = b.id
  GROUP BY b.id, b.project_id, b.team_id, b.weight_percent
),
project_prog AS (
  SELECT p.id,
         COALESCE(SUM(bp.weight_percent * bp.progress / 100.0 * COALESCE(pts.share_percent, 0) / 100.0), 0) AS progress
  FROM projects p
  LEFT JOIN block_prog bp ON bp.project_id = p.id
  LEFT JOIN project_team_shares pts ON pts.project_id = bp.project_id AND pts.team_id = bp.team_id
  GROUP BY p.id
)
SELECT p.name AS project, p.status, p.category,
       ROUND(COALESCE(pp.progress, 0), 1) AS progress_pct
FROM projects p
LEFT JOIN project_prog pp ON pp.id = p.id
ORDER BY progress_pct DESC, p.created_at DESC;
