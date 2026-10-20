/** Explorer browse/trash-ийн жагсаалтын SQL.  Хамрах хүрээ = АРХИВ (0249). */

export const DOC_FILE_LIST_SQL = `
  WITH LatestRevs AS (
    SELECT document_id, MAX(revision_number) AS max_rev
    FROM document_revisions
    GROUP BY document_id
  )
  SELECT
    d.*,
    u.full_name AS created_by_name,
    r.id AS latest_revision_id,
    r.revision_number,
    r.file_url,
    r.file_name,
    r.file_type,
    r.file_size,
    r.status,
    r.uploaded_at,
    ru.full_name AS uploaded_by_name
  FROM documents d
  JOIN users u ON u.id = d.created_by
  LEFT JOIN LatestRevs lr ON lr.document_id = d.id
  LEFT JOIN document_revisions r ON r.document_id = d.id AND r.revision_number = lr.max_rev
  LEFT JOIN users ru ON ru.id = r.uploaded_by
`;

export async function listChildFolders(
  db: D1Database,
  archiveId: number,
  parentId: number | null,
) {
  const q =
    parentId == null
      ? `SELECT * FROM document_folders
         WHERE archive_id = ? AND parent_id IS NULL AND deleted_at IS NULL
         ORDER BY is_system DESC, sort_order ASC, name COLLATE NOCASE ASC`
      : `SELECT * FROM document_folders
         WHERE archive_id = ? AND parent_id = ? AND deleted_at IS NULL
         ORDER BY is_system DESC, sort_order ASC, name COLLATE NOCASE ASC`;
  const stmt =
    parentId == null ? db.prepare(q).bind(archiveId) : db.prepare(q).bind(archiveId, parentId);
  const { results } = await stmt.all();
  return results;
}

export async function listChildFiles(
  db: D1Database,
  archiveId: number,
  folderId: number | null,
) {
  const q =
    folderId == null
      ? `${DOC_FILE_LIST_SQL}
         WHERE d.archive_id = ? AND d.deleted_at IS NULL AND d.folder_id IS NULL
         ORDER BY d.title COLLATE NOCASE ASC`
      : `${DOC_FILE_LIST_SQL}
         WHERE d.archive_id = ? AND d.deleted_at IS NULL AND d.folder_id = ?
         ORDER BY d.title COLLATE NOCASE ASC`;
  const stmt =
    folderId == null ? db.prepare(q).bind(archiveId) : db.prepare(q).bind(archiveId, folderId);
  const { results } = await stmt.all();
  return results;
}

type TrailRow = { id: number; name: string; parent_id: number | null };

export async function folderTrail(db: D1Database, folderId: number) {
  const trail: { id: number; name: string }[] = [];
  let current: number | null = folderId;
  const seen = new Set<number>();
  while (current != null && !seen.has(current) && trail.length < 32) {
    seen.add(current);
    const row: TrailRow | null = await db
      .prepare(
        `SELECT id, name, parent_id FROM document_folders WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(current)
      .first<TrailRow>();
    if (!row) break;
    trail.unshift({ id: row.id, name: row.name });
    current = row.parent_id;
  }
  return trail;
}
