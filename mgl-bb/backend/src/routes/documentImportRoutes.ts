import type { DocumentsApp } from './documentBrowseRoutes';
import { isAllowedDocFile } from '../lib/documentFileTypes';
import { archiveExists, folderInArchive } from './documentArchiveRoutes';

/**
 * Бүтэн хавтас импортлохын хоёр багц дуудлага.
 *
 * Файл бүрт `POST /documents` дуудвал 2000 файлтай хавтас 2000 round trip
 * болно.  Тиймээс: (1) `POST /conflicts` — байршуулахын ӨМНӨ ижил нэртэй
 * файлыг илрүүлж, хэрэглэгчээс «Солих уу / Алгасах уу» гэж НЭГ удаа асуух,
 * (2) `POST /bulk` — байршуулсан файлуудыг нэг дор бүртгэх.
 *
 * Яагаад мөргөлдөөнийг өмнө нь шалгадаг вэ: хэрэглэгч «алгасах» гэж хэлэх
 * гэж байгаа файлыг R2 руу дэмий байршуулах нь LAN болон интернэтийн цагийг
 * үрнэ.
 */

const MAX_BATCH = 50;

interface ImportFile {
  folder_id?: number | null;
  title: string;
  file_url: string;
  file_name: string;
  file_type?: string | null;
  file_size?: number | null;
  /** Ижил нэртэй файл байвал: replace = шинэ revision, skip = алгасах. */
  on_conflict?: 'replace' | 'skip';
}

/** Тухайн хавтсанд амьд байгаа ижил нэртэй баримтын id. */
async function findLive(
  db: D1Database,
  archiveId: number,
  folderId: number | null,
  title: string,
): Promise<number | null> {
  const q =
    folderId == null
      ? `SELECT id FROM documents
         WHERE archive_id = ? AND folder_id IS NULL AND deleted_at IS NULL
           AND title = ? COLLATE NOCASE LIMIT 1`
      : `SELECT id FROM documents
         WHERE archive_id = ? AND folder_id = ? AND deleted_at IS NULL
           AND title = ? COLLATE NOCASE LIMIT 1`;
  const stmt =
    folderId == null
      ? db.prepare(q).bind(archiveId, title)
      : db.prepare(q).bind(archiveId, folderId, title);
  const row = await stmt.first<{ id: number }>();
  return row?.id ?? null;
}

export function mountDocumentImport(app: DocumentsApp) {
  app.post('/conflicts', async (c) => {
    const body = await c.req.json<{
      archive_id: number;
      items: { folder_id?: number | null; title: string }[];
    }>();
    const archiveId = Number(body.archive_id);
    if (!Number.isFinite(archiveId)) return c.json({ error: 'archive_id required' }, 400);
    if (!Array.isArray(body.items)) return c.json({ error: 'items required' }, 400);
    if (body.items.length > 4000) return c.json({ error: 'Too many items' }, 413);

    // Архивын амьд баримтыг НЭГ удаа уншаад санах ойд тулгана — мөр тус бүрт
    // асуулга явуулбал импорт хэдэн мянган дуудлага болно.
    const { results } = await c.env.DB
      .prepare(
        `SELECT id, folder_id, title FROM documents
         WHERE archive_id = ? AND deleted_at IS NULL`,
      )
      .bind(archiveId)
      .all<{ id: number; folder_id: number | null; title: string }>();
    const live = new Map<string, number>();
    for (const row of results) {
      live.set(`${row.folder_id ?? 0} ${row.title.toLowerCase()}`, row.id);
    }

    const conflicts: { folder_id: number | null; title: string; document_id: number }[] = [];
    for (const item of body.items) {
      if (!item || typeof item.title !== 'string') continue;
      const folderId = item.folder_id ?? null;
      const id = live.get(`${folderId ?? 0} ${item.title.toLowerCase()}`);
      if (id != null) conflicts.push({ folder_id: folderId, title: item.title, document_id: id });
    }
    return c.json({ conflicts });
  });

  app.post('/bulk', async (c) => {
    const user = c.get('user');
    const body = await c.req.json<{ archive_id: number; files: ImportFile[] }>();
    const archiveId = Number(body.archive_id);
    if (!Number.isFinite(archiveId)) return c.json({ error: 'archive_id required' }, 400);
    if (!(await archiveExists(c.env.DB, archiveId))) {
      return c.json({ error: 'Archive not found' }, 404);
    }
    if (!Array.isArray(body.files) || body.files.length === 0) {
      return c.json({ error: 'files required' }, 400);
    }
    if (body.files.length > MAX_BATCH) return c.json({ error: 'Too many files' }, 413);

    const created: { title: string; document_id: number }[] = [];
    const replaced: { title: string; document_id: number }[] = [];
    const skipped: { title: string; reason: string }[] = [];

    // Хавтас бүрийг нэг л удаа шалгана — нэг багц ихэвчлэн нэг хавтасных.
    const folderOk = new Map<number, boolean>();

    for (const file of body.files) {
      const title = String(file?.title ?? '').trim();
      if (!title || !file.file_url || !file.file_name) {
        skipped.push({ title: title || '?', reason: 'invalid' });
        continue;
      }
      if (!isAllowedDocFile(file.file_name)) {
        skipped.push({ title, reason: 'bad_file_type' });
        continue;
      }
      const folderId = file.folder_id ?? null;
      if (folderId != null) {
        let ok = folderOk.get(folderId);
        if (ok == null) {
          ok = await folderInArchive(c.env.DB, folderId, archiveId);
          folderOk.set(folderId, ok);
        }
        if (!ok) {
          skipped.push({ title, reason: 'bad_folder' });
          continue;
        }
      }

      const existing = await findLive(c.env.DB, archiveId, folderId, title);
      if (existing != null) {
        if (file.on_conflict !== 'replace') {
          skipped.push({ title, reason: 'exists' });
          continue;
        }
        // «Солих» = ШИНЭ REVISION.  Хуучин файл түүх болж үлдэх тул
        // санамсаргүй дарж бичсэн зүйлийг сэргээх боломжтой.
        const maxRev = await c.env.DB
          .prepare(`SELECT MAX(revision_number) AS max_rev FROM document_revisions WHERE document_id = ?`)
          .bind(existing)
          .first<{ max_rev: number | null }>();
        await c.env.DB
          .prepare(
            `INSERT INTO document_revisions
               (document_id, revision_number, file_url, file_name, file_type, file_size, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            existing,
            (maxRev?.max_rev ?? -1) + 1,
            file.file_url,
            file.file_name,
            file.file_type ?? null,
            file.file_size ?? null,
            user.sub,
          )
          .run();
        await c.env.DB
          .prepare(`UPDATE documents SET title = ? WHERE id = ?`)
          .bind(file.file_name, existing)
          .run();
        replaced.push({ title, document_id: existing });
        continue;
      }

      const doc = await c.env.DB
        .prepare(
          `INSERT INTO documents (archive_id, folder_id, title, created_by)
           VALUES (?, ?, ?, ?) RETURNING id`,
        )
        .bind(archiveId, folderId, title, user.sub)
        .first<{ id: number }>();
      if (!doc) {
        skipped.push({ title, reason: 'failed' });
        continue;
      }
      await c.env.DB
        .prepare(
          `INSERT INTO document_revisions
             (document_id, revision_number, file_url, file_name, file_type, file_size, uploaded_by)
           VALUES (?, 0, ?, ?, ?, ?, ?)`,
        )
        .bind(
          doc.id,
          file.file_url,
          file.file_name,
          file.file_type ?? null,
          file.file_size ?? null,
          user.sub,
        )
        .run();
      created.push({ title, document_id: doc.id });
    }

    return c.json({ created, replaced, skipped }, 201);
  });
}
