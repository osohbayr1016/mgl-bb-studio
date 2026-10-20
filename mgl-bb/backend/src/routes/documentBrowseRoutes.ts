import type { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { DOC_FILE_LIST_SQL, folderTrail, listChildFiles, listChildFolders } from '../lib/documentBrowse';
import { loadFolder } from '../lib/documentTrash';

export type DocumentsApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

export function mountDocumentBrowse(app: DocumentsApp) {
  app.get('/browse', async (c) => {
    const archiveId = Number(c.req.query('archive_id'));
    if (!Number.isFinite(archiveId)) return c.json({ error: 'archive_id required' }, 400);
    const db = c.env.DB;

    const archive = await db
      .prepare(
        `SELECT id, name, source_path FROM document_archives
         WHERE id = ? AND deleted_at IS NULL`,
      )
      .bind(archiveId)
      .first<{ id: number; name: string; source_path: string | null }>();
    if (!archive) return c.json({ error: 'Archive not found' }, 404);

    const rawFolder = c.req.query('folder_id');
    const folderId = rawFolder ? Number(rawFolder) : null;
    if (rawFolder && !Number.isFinite(folderId)) return c.json({ error: 'Invalid folder' }, 400);

    let current: { id: number; name: string; code: string | null; is_system: number } | null = null;
    if (folderId != null) {
      const folder = await loadFolder(db, folderId);
      if (!folder || folder.archive_id !== archiveId || folder.deleted_at) {
        return c.json({ error: 'Folder not found' }, 404);
      }
      current = {
        id: folder.id,
        name: folder.name,
        code: folder.code,
        is_system: folder.is_system,
      };
    }

    const [folders, files, trail] = await Promise.all([
      listChildFolders(db, archiveId, folderId),
      listChildFiles(db, archiveId, folderId),
      folderId != null ? folderTrail(db, folderId) : Promise.resolve([]),
    ]);
    return c.json({ archive, folder: current, folders, files, trail });
  });

  app.get('/trash', async (c) => {
    const archiveId = Number(c.req.query('archive_id'));
    if (!Number.isFinite(archiveId)) return c.json({ error: 'archive_id required' }, 400);
    const db = c.env.DB;
    const folders = await db
      .prepare(
        `SELECT f.* FROM document_folders f
         LEFT JOIN document_folders p ON p.id = f.parent_id
         WHERE f.archive_id = ? AND f.deleted_at IS NOT NULL
           AND (f.parent_id IS NULL OR p.deleted_at IS NULL)
         ORDER BY f.deleted_at DESC`,
      )
      .bind(archiveId)
      .all();
    const files = await db
      .prepare(
        `${DOC_FILE_LIST_SQL}
         LEFT JOIN document_folders df ON df.id = d.folder_id
         WHERE d.archive_id = ? AND d.deleted_at IS NOT NULL
           AND (d.folder_id IS NULL OR df.deleted_at IS NULL)
         ORDER BY d.deleted_at DESC`,
      )
      .bind(archiveId)
      .all();
    return c.json({ folders: folders.results, files: files.results });
  });
}
