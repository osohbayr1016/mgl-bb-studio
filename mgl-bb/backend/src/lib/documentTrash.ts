export interface FolderRow {
  id: number;
  archive_id: number;
  parent_id: number | null;
  name: string;
  code: string | null;
  is_system: number;
  sort_order: number;
  created_by: number;
  created_at: string;
  deleted_at: string | null;
  deleted_by: number | null;
  trash_op: string | null;
}

const TREE_SQL = `WITH RECURSIVE tree AS (
  SELECT id FROM document_folders WHERE id = ? AND deleted_at IS NULL
  UNION ALL
  SELECT f.id FROM document_folders f
  JOIN tree t ON f.parent_id = t.id
  WHERE f.deleted_at IS NULL
) SELECT id FROM tree`;

export async function loadFolder(db: D1Database, id: number): Promise<FolderRow | null> {
  return db.prepare(`SELECT * FROM document_folders WHERE id = ?`).bind(id).first<FolderRow>();
}

export async function descendantFolderIds(db: D1Database, folderId: number): Promise<number[]> {
  const { results } = await db.prepare(TREE_SQL).bind(folderId).all<{ id: number }>();
  return results.map((r) => r.id);
}

export async function trashFolderTree(
  db: D1Database,
  folderId: number,
  userId: number,
): Promise<string> {
  const ids = await descendantFolderIds(db, folderId);
  const op = crypto.randomUUID();
  if (ids.length === 0) return op;
  const ph = ids.map(() => '?').join(',');
  await db.batch([
    db
      .prepare(
        `UPDATE document_folders SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, trash_op = ?
         WHERE id IN (${ph}) AND deleted_at IS NULL`,
      )
      .bind(userId, op, ...ids),
    db
      .prepare(
        `UPDATE documents SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, trash_op = ?
         WHERE folder_id IN (${ph}) AND deleted_at IS NULL`,
      )
      .bind(userId, op, ...ids),
  ]);
  return op;
}

export async function trashDocument(db: D1Database, docId: number, userId: number): Promise<string> {
  const op = crypto.randomUUID();
  await db
    .prepare(
      `UPDATE documents SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?, trash_op = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(userId, op, docId)
    .run();
  return op;
}

export async function restoreByTrashOp(
  db: D1Database,
  archiveId: number,
  trashOp: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE document_folders SET deleted_at = NULL, deleted_by = NULL, trash_op = NULL
         WHERE archive_id = ? AND trash_op = ?`,
      )
      .bind(archiveId, trashOp),
    db
      .prepare(
        `UPDATE documents SET deleted_at = NULL, deleted_by = NULL, trash_op = NULL
         WHERE archive_id = ? AND trash_op = ?`,
      )
      .bind(archiveId, trashOp),
  ]);
}

export async function restoreDocument(db: D1Database, docId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE documents SET deleted_at = NULL, deleted_by = NULL, trash_op = NULL WHERE id = ?`,
    )
    .bind(docId)
    .run();
}
