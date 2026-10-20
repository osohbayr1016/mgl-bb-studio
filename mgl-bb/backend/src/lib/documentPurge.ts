/** Recycle bin-ээс бүрмөсөн устгах — D1 FK cascade ажиллахгүй тул гараар. */

export async function purgeDocument(db: D1Database, docId: number): Promise<void> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM document_comments
         WHERE revision_id IN (SELECT id FROM document_revisions WHERE document_id = ?)`,
      )
      .bind(docId),
    db.prepare(`DELETE FROM document_revisions WHERE document_id = ?`).bind(docId),
    db.prepare(`DELETE FROM documents WHERE id = ?`).bind(docId),
  ]);
}

export async function purgeByTrashOp(
  db: D1Database,
  archiveId: number,
  trashOp: string,
): Promise<void> {
  const { results } = await db
    .prepare(`SELECT id FROM documents WHERE archive_id = ? AND trash_op = ?`)
    .bind(archiveId, trashOp)
    .all<{ id: number }>();
  for (const row of results) {
    await purgeDocument(db, row.id);
  }
  await db
    .prepare(`DELETE FROM document_folders WHERE archive_id = ? AND trash_op = ?`)
    .bind(archiveId, trashOp)
    .run();
}

export async function siblingNameTaken(
  db: D1Database,
  archiveId: number,
  parentId: number | null,
  name: string,
  excludeId?: number,
): Promise<boolean> {
  const row =
    parentId == null
      ? await db
          .prepare(
            `SELECT id FROM document_folders
             WHERE archive_id = ? AND parent_id IS NULL AND deleted_at IS NULL AND name = ?
               AND (? IS NULL OR id != ?) LIMIT 1`,
          )
          .bind(archiveId, name, excludeId ?? null, excludeId ?? 0)
          .first<{ id: number }>()
      : await db
          .prepare(
            `SELECT id FROM document_folders
             WHERE archive_id = ? AND parent_id = ? AND deleted_at IS NULL AND name = ?
               AND (? IS NULL OR id != ?) LIMIT 1`,
          )
          .bind(archiveId, parentId, name, excludeId ?? null, excludeId ?? 0)
          .first<{ id: number }>();
  return row != null;
}
