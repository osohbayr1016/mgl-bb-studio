import { Hono } from 'hono';
import { requireRole } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import { isAllowedDocFile } from '../lib/documentFileTypes';
import { mountDocumentExplorer } from './documentExplorer';
import { mountDocumentOffice } from './documentOfficeRoutes';
import { mountDocumentPurge } from './documentPurgeRoutes';
import { loadFolder } from '../lib/documentTrash';

const documents = new Hono<{ Bindings: Env; Variables: AppVariables }>();
mountDocumentExplorer(documents);
// `/:id/office*` -ыг доорх `/:id`-ЭЭС ӨМНӨ бүртгэнэ (маршрутын дараалал).
mountDocumentOffice(documents);
// Хуучин архивыг бүрмөсөн устгах (admin) — `/purge-legacy` нь мөн `/:id`-ээс ӨМНӨ.
mountDocumentPurge(documents);

/** Row shape of the revisions query in GET /:id — document_revisions.* plus the two joined user names. */
interface DocumentRevisionRow {
  id: number;
  document_id: number;
  revision_number: number;
  file_url: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  status: string;
  uploaded_by: number;
  uploaded_at: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_notes: string | null;
  uploaded_by_name: string;
  reviewed_by_name: string | null;
}

/** Row shape of the comments query in GET /:id — document_comments.* plus the joined user info. */
interface DocumentCommentRow {
  id: number;
  revision_id: number;
  user_id: number;
  content: string;
  created_at: string | null;
  user_name: string;
  profile_image: string | null;
}

// GET /api/documents?archive_id=123
// List every document in one archive, including its latest revision info.
documents.get('/', async (c) => {
  const archiveId = c.req.query('archive_id');
  if (!archiveId) return c.json({ error: 'archive_id required' }, 400);

  // We want the document info + the latest revision info.
  // We can use a subquery or CTE to get the max revision_number per document.
  const query = `
    WITH LatestRevs AS (
      SELECT document_id, MAX(revision_number) as max_rev
      FROM document_revisions
      GROUP BY document_id
    )
    SELECT 
      d.*,
      u.full_name as created_by_name,
      r.id as latest_revision_id,
      r.revision_number,
      r.file_url,
      r.file_name,
      r.file_type,
      r.file_size,
      r.status,
      r.uploaded_at,
      ru.full_name as uploaded_by_name
    FROM documents d
    JOIN users u ON u.id = d.created_by
    LEFT JOIN LatestRevs lr ON lr.document_id = d.id
    LEFT JOIN document_revisions r ON r.document_id = d.id AND r.revision_number = lr.max_rev
    LEFT JOIN users ru ON ru.id = r.uploaded_by
    WHERE d.archive_id = ? AND d.deleted_at IS NULL
    ORDER BY d.created_at DESC
  `;

  const { results } = await c.env.DB.prepare(query).bind(archiveId).all();
  return c.json({ documents: results });
});

// POST /api/documents
// Create a new document and its initial revision (Rev-00)
documents.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    archive_id: number;
    title: string;
    description?: string;
    file_url: string;
    file_name: string;
    file_type?: string;
    file_size?: number;
    folder_id?: number | null;
  }>();

  if (!body.archive_id || !body.title || !body.file_url || !body.file_name) {
    return c.json({ error: 'Missing required fields' }, 400);
  }
  if (!isAllowedDocFile(body.file_name)) {
    return c.json({ error: 'This file type cannot be uploaded' }, 400);
  }
  const folderId = body.folder_id ?? null;
  if (folderId != null) {
    const folder = await loadFolder(c.env.DB, folderId);
    if (!folder || folder.archive_id !== body.archive_id || folder.deleted_at) {
      return c.json({ error: 'Invalid folder' }, 400);
    }
  }

  try {
    const docIdRes = await c.env.DB.prepare(
      `
      INSERT INTO documents (archive_id, title, description, created_by, folder_id)
      VALUES (?, ?, ?, ?, ?)
      RETURNING id
    `,
    )
      .bind(body.archive_id, body.title, body.description ?? null, user.sub, folderId)
      .first<{ id: number }>();

    if (!docIdRes) return c.json({ error: 'Failed to create document' }, 500);

    const revIdRes = await c.env.DB.prepare(
      `
      INSERT INTO document_revisions (document_id, revision_number, file_url, file_name, file_type, file_size, uploaded_by)
      VALUES (?, 0, ?, ?, ?, ?, ?)
      RETURNING id
    `,
    )
      .bind(
        docIdRes.id,
        body.file_url,
        body.file_name,
        body.file_type ?? null,
        body.file_size ?? null,
        user.sub,
      )
      .first<{ id: number }>();

    return c.json(
      { message: 'Document created', document_id: docIdRes.id, revision_id: revIdRes?.id },
      201,
    );
  } catch (err) {
    console.error('Error creating document:', err);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// GET /api/documents/:id
// Get a specific document with ALL its revisions and comments
documents.get('/:id', async (c) => {
  const id = c.req.param('id');

  const docRes = await c.env.DB.prepare(
    `
    SELECT d.*, u.full_name as created_by_name
    FROM documents d
    JOIN users u ON u.id = d.created_by
    WHERE d.id = ?
  `,
  )
    .bind(id)
    .first();

  if (!docRes) return c.json({ error: 'Document not found' }, 404);

  const revsRes = await c.env.DB.prepare(
    `
    SELECT r.*, u.full_name as uploaded_by_name, rev_u.full_name as reviewed_by_name
    FROM document_revisions r
    JOIN users u ON u.id = r.uploaded_by
    LEFT JOIN users rev_u ON rev_u.id = r.reviewed_by
    WHERE r.document_id = ?
    ORDER BY r.revision_number DESC
  `,
  )
    .bind(id)
    .all<DocumentRevisionRow>();

  // Fetch comments for all revisions of this document
  const commentsRes = await c.env.DB.prepare(
    `
    SELECT c.*, u.full_name as user_name, u.profile_image
    FROM document_comments c
    JOIN users u ON u.id = c.user_id
    JOIN document_revisions r ON r.id = c.revision_id
    WHERE r.document_id = ?
    ORDER BY c.created_at ASC
  `,
  )
    .bind(id)
    .all<DocumentCommentRow>();

  // Group comments by revision_id
  const commentsByRev = new Map<number, DocumentCommentRow[]>();
  for (const row of commentsRes.results) {
    const revId = row.revision_id;
    if (!commentsByRev.has(revId)) commentsByRev.set(revId, []);
    commentsByRev.get(revId)!.push(row);
  }

  const revisions = revsRes.results.map((r) => ({
    ...r,
    comments: commentsByRev.get(r.id) || [],
  }));

  return c.json({ document: docRes, revisions });
});

// POST /api/documents/:id/revisions
// Upload a new revision for an existing document
documents.post('/:id/revisions', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const body = await c.req.json<{
    file_url: string;
    file_name: string;
    file_type?: string;
    file_size?: number;
  }>();

  if (!body.file_url || !body.file_name) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  // Get current max revision
  const maxRevRes = await c.env.DB.prepare(
    `
    SELECT MAX(revision_number) as max_rev FROM document_revisions WHERE document_id = ?
  `,
  )
    .bind(id)
    .first<{ max_rev: number }>();

  const nextRev = (maxRevRes?.max_rev ?? -1) + 1;

  const revIdRes = await c.env.DB.prepare(
    `
    INSERT INTO document_revisions (document_id, revision_number, file_url, file_name, file_type, file_size, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
  )
    .bind(
      id,
      nextRev,
      body.file_url,
      body.file_name,
      body.file_type ?? null,
      body.file_size ?? null,
      user.sub,
    )
    .first<{ id: number }>();

  return c.json({ message: 'Revision added', revision_id: revIdRes?.id }, 201);
});

// POST /api/documents/:id/revisions/:rev_id/approve
// Approve or reject a revision
documents.post('/:id/revisions/:rev_id/approve', requireRole('admin', 'senior'), async (c) => {
  const revId = c.req.param('rev_id');
  const user = c.get('user');
  const body = await c.req.json<{ status: 'approved' | 'rejected'; notes?: string }>();

  if (body.status !== 'approved' && body.status !== 'rejected') {
    return c.json({ error: 'Invalid status' }, 400);
  }

  await c.env.DB.prepare(
    `
    UPDATE document_revisions
    SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_notes = ?
    WHERE id = ?
  `,
  )
    .bind(body.status, user.sub, body.notes ?? null, revId)
    .run();

  return c.json({ message: 'Revision status updated' });
});

// POST /api/documents/:id/revisions/:rev_id/comments
// Add a comment to a specific revision
documents.post('/:id/revisions/:rev_id/comments', async (c) => {
  const revId = c.req.param('rev_id');
  const user = c.get('user');
  const body = await c.req.json<{ content: string }>();

  if (!body.content?.trim()) {
    return c.json({ error: 'Comment content required' }, 400);
  }

  const res = await c.env.DB.prepare(
    `
    INSERT INTO document_comments (revision_id, user_id, content)
    VALUES (?, ?, ?)
    RETURNING id
  `,
  )
    .bind(revId, user.sub, body.content.trim())
    .first<{ id: number }>();

  return c.json({ message: 'Comment added', comment_id: res?.id }, 201);
});

export default documents;
