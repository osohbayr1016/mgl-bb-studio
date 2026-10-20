import type { DocumentsApp } from './documentBrowseRoutes';
import { requireAdmin } from '../middleware/auth';
import { loadFolder } from '../lib/documentTrash';

/**
 * Архив = серверээс импортолсон НЭГ хавтас (0249).
 *
 * Баримт бичгийн хуудас нь төслүүдийг ЖАГСААХАА БОЛЬСОН — эзний шийдвэр
 * (2026-09-03): «Projects хэсэгт байгаа төслүүд автоматаар дуудагдахыг
 * болиулж, зөвхөн серверээс оруулдаг болго».  Тиймээс энэ таблиц нь
 * `projects`-той ямар ч холбоогүй.
 *
 * Үүсгэх/нэр солих/устгах нь ЗӨВХӨН admin: архив бол компанийн бүхэл
 * бүтэн хавтасны хуулбар тул санамсаргүй устгал үнэтэй.  Дотор нь хавтас
 * үүсгэх, файл нэмэх зэрэг нь өмнөх шигээ нэвтэрсэн бүх хэрэглэгчид нээлттэй.
 */

function trimName(raw: unknown, max = 200): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (!name || name.length > max) return null;
  return name;
}

const ARCHIVE_LIST_SQL = `
  SELECT
    a.id,
    a.name,
    a.source_path,
    a.created_at,
    u.full_name AS created_by_name,
    (SELECT COUNT(*) FROM document_folders f
      WHERE f.archive_id = a.id AND f.deleted_at IS NULL) AS folder_count,
    (SELECT COUNT(*) FROM documents d
      WHERE d.archive_id = a.id AND d.deleted_at IS NULL) AS file_count,
    (SELECT COALESCE(SUM(r.file_size), 0)
       FROM documents d
       JOIN document_revisions r ON r.document_id = d.id
      WHERE d.archive_id = a.id AND d.deleted_at IS NULL) AS total_size
  FROM document_archives a
  JOIN users u ON u.id = a.created_by
  WHERE a.deleted_at IS NULL
  ORDER BY a.created_at DESC
`;

export function mountDocumentArchives(app: DocumentsApp) {
  app.get('/archives', async (c) => {
    const { results } = await c.env.DB.prepare(ARCHIVE_LIST_SQL).all();
    return c.json({ archives: results });
  });

  app.post('/archives', requireAdmin(), async (c) => {
    const body = await c.req.json<{ name: string; source_path?: string }>();
    const name = trimName(body.name);
    if (!name) return c.json({ error: 'Invalid name' }, 400);
    const dup = await c.env.DB
      .prepare(`SELECT id FROM document_archives WHERE name = ? AND deleted_at IS NULL LIMIT 1`)
      .bind(name)
      .first<{ id: number }>();
    if (dup) return c.json({ error: 'Name exists', archive_id: dup.id }, 409);
    const row = await c.env.DB
      .prepare(
        `INSERT INTO document_archives (name, source_path, created_by)
         VALUES (?, ?, ?) RETURNING id`,
      )
      .bind(name, trimName(body.source_path, 1000), c.get('user').sub)
      .first<{ id: number }>();
    return c.json({ archive_id: row?.id }, 201);
  });

  app.patch('/archives/:id', requireAdmin(), async (c) => {
    const id = Number(c.req.param('id'));
    const name = trimName((await c.req.json<{ name?: string }>()).name);
    if (!Number.isFinite(id) || !name) return c.json({ error: 'Invalid name' }, 400);
    const dup = await c.env.DB
      .prepare(
        `SELECT id FROM document_archives
         WHERE name = ? AND deleted_at IS NULL AND id != ? LIMIT 1`,
      )
      .bind(name, id)
      .first<{ id: number }>();
    if (dup) return c.json({ error: 'Name exists' }, 409);
    const res = await c.env.DB
      .prepare(`UPDATE document_archives SET name = ? WHERE id = ? AND deleted_at IS NULL`)
      .bind(name, id)
      .run();
    if (!res.meta.changes) return c.json({ error: 'Archive not found' }, 404);
    return c.json({ message: 'ok' });
  });

  // Зөөлөн устгал.  Хатуу устгавал D1 нь FK cascade-ыг ажиллуулдаггүй тул
  // хавтас/файл нь өнчирнө — тиймээс энд зөвхөн нуулаа.
  app.delete('/archives/:id', requireAdmin(), async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const res = await c.env.DB
      .prepare(
        `UPDATE document_archives SET deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(c.get('user').sub, id)
      .run();
    if (!res.meta.changes) return c.json({ error: 'Archive not found' }, 404);
    return c.json({ message: 'ok' });
  });
}

export async function archiveExists(db: D1Database, id: number): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM document_archives WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: number }>();
  return row != null;
}

/** Хавтас нь тухайн архивынх мөн үү, устгагдаагүй юу. */
export async function folderInArchive(
  db: D1Database,
  folderId: number,
  archiveId: number,
): Promise<boolean> {
  const folder = await loadFolder(db, folderId);
  return folder != null && folder.archive_id === archiveId && !folder.deleted_at;
}
