import type { DocumentsApp } from './documentBrowseRoutes';
import { restoreDocument, trashDocument } from '../lib/documentTrash';
import { purgeDocument } from '../lib/documentPurge';
import { withOriginalExt } from '../lib/documentFileTypes';

export function mountDocumentMutations(app: DocumentsApp) {
  app.patch('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const title = String((await c.req.json<{ title?: string }>()).title ?? '').trim();
    if (!title || title.length > 200) return c.json({ error: 'Invalid name' }, 400);
    const doc = await c.env.DB
      .prepare(`SELECT id, deleted_at FROM documents WHERE id = ?`)
      .bind(id)
      .first<{ id: number; deleted_at: string | null }>();
    if (!doc || doc.deleted_at) return c.json({ error: 'Document not found' }, 404);
    const rev = await c.env.DB
      .prepare(
        `SELECT id, file_name FROM document_revisions WHERE document_id = ?
         ORDER BY revision_number DESC LIMIT 1`,
      )
      .bind(id)
      .first<{ id: number; file_name: string }>();
    const fileName = rev ? withOriginalExt(title, rev.file_name) : title;
    await c.env.DB.prepare(`UPDATE documents SET title = ? WHERE id = ?`).bind(fileName, id).run();
    if (rev) {
      await c.env.DB
        .prepare(`UPDATE document_revisions SET file_name = ? WHERE id = ?`)
        .bind(fileName, rev.id)
        .run();
    }
    return c.json({ message: 'ok' });
  });

  app.delete('/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const doc = await c.env.DB
      .prepare(`SELECT id, deleted_at FROM documents WHERE id = ?`)
      .bind(id)
      .first<{ id: number; deleted_at: string | null }>();
    if (!doc || doc.deleted_at) return c.json({ error: 'Document not found' }, 404);
    const trash_op = await trashDocument(c.env.DB, id, c.get('user').sub);
    return c.json({ trash_op });
  });

  app.post('/:id/restore', async (c) => {
    const id = Number(c.req.param('id'));
    const doc = await c.env.DB
      .prepare(`SELECT id, deleted_at FROM documents WHERE id = ?`)
      .bind(id)
      .first<{ id: number; deleted_at: string | null }>();
    if (!doc?.deleted_at) return c.json({ error: 'Not in trash' }, 404);
    await restoreDocument(c.env.DB, id);
    return c.json({ message: 'ok' });
  });

  app.post('/:id/purge', async (c) => {
    const id = Number(c.req.param('id'));
    const doc = await c.env.DB
      .prepare(`SELECT id, deleted_at FROM documents WHERE id = ?`)
      .bind(id)
      .first<{ id: number; deleted_at: string | null }>();
    if (!doc?.deleted_at) return c.json({ error: 'Not in trash' }, 404);
    await purgeDocument(c.env.DB, id);
    return c.json({ message: 'ok' });
  });
}
