/**
 * Correspondence log (И-мэйл бүртгэл) — per-project record of emails
 * exchanged between staff and the client.  Stored like an Excel
 * ledger: one row per email, with `direction` marking whether we
 * sent or received it.  Staff (project_members) can create / edit /
 * delete; project clients can only read.  Admins can act on anyone's
 * row regardless of authorship.
 */
import { Hono } from 'hono';
import { nextRefNo } from '../lib/refNo';
import { clientCanRead } from '../lib/clientAccess';
import { lockedFieldsIn } from '../lib/correspondenceSignature';
import type { Env, AppVariables } from '../types';
import { registerCorrespondenceSendRoutes } from './correspondenceSend';
import { registerCorrespondenceSignatureRoutes } from './correspondenceSignature';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type Direction = 'sent' | 'received';
type DocType = 'rfi' | 'cr' | 'official' | 'mr';
const ADMIN_ROLES = new Set(['admin']);
const DOC_TYPES = new Set<string>(['rfi', 'cr', 'official', 'mr']);
function isValidDocType(v: unknown): v is DocType {
  return typeof v === 'string' && DOC_TYPES.has(v);
}

interface CorrespondenceRow {
  id: number;
  project_id: number;
  author_id: number;
  log_date: string;
  direction: Direction;
  subject: string;
  body: string | null;
  attachment_url: string | null;
  from_email: string | null;
  to_email: string | null;
  cc_emails: string | null;
  doc_type: DocType | null;
  ref_no: string | null;
  email_message_id: number | null;
  signature_url: string | null;
  /* Захиалагчийн гарын үсэг (migration 0335) — `lib/correspondenceSignature.ts`. */
  sign_status: 'none' | 'pending' | 'signed';
  sign_requested_at: string | null;
  sign_requested_by: number | null;
  client_signature_key: string | null;
  client_signed_at: string | null;
  client_signed_by: number | null;
  client_signer_name: string | null;
  pdf_key: string | null;
  pdf_generated_at: string | null;
  created_at: string;
  updated_at: string;
  author_name?: string;
}

function normalizeMediaUrl(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return null;
  if (!t.startsWith('/media/')) return null;
  return t;
}

// The from / to / cc fields are intentionally stored as free-form
// strings: users paste lists straight from their email client, which
// include `Name <email>` syntax, semicolon or newline separators, and
// multiple addresses per field.  Strict email validation rejected
// those pastes, so we now accept anything and let the human author
// own the format — the log is a record, not an actionable mailer.
function normalizeFreeText(s: string | null | undefined): string | null {
  if (s == null) return null;
  const t = s.trim();
  return t || null;
}

/** Whether `userId` is on `project_members` for `projectId`. */
async function isProjectMember(
  db: D1Database,
  projectId: number,
  userId: number,
): Promise<boolean> {
  const r = await db
    .prepare('SELECT 1 AS x FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1')
    .bind(projectId, userId)
    .first<{ x: number }>();
  return !!r;
}

/** Whether `userId` is a client of the project (role=client AND on the project). */
async function isProjectClient(
  db: D1Database,
  projectId: number,
  userId: number,
): Promise<boolean> {
  const r = await db
    .prepare(
      `SELECT 1 AS x FROM project_members pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = ? AND pm.user_id = ? AND u.role = 'client'
     LIMIT 1`,
    )
    .bind(projectId, userId)
    .first<{ x: number }>();
  return !!r;
}

/** Read-side gate: admins, project staff, AND project clients all see. */
async function canRead(
  db: D1Database,
  projectId: number,
  viewer: { sub: number; role: string },
): Promise<boolean> {
  if (ADMIN_ROLES.has(viewer.role)) return true;
  // Захиалагчийн эрхийн ЭХ СУРВАЛЖ нь `lib/clientAccess.ts` (байгууллага →
  // холбоо барих хүн → төсөл; хуучин project_members мөрийг ч уншдаг).
  // `project_members` нь зөвхөн тусгал тул гарын үсгийн урсгал тэр тусгалыг
  // алгасаж болохгүй.
  if (viewer.role === 'client') return clientCanRead(db, viewer.sub, projectId);
  return isProjectMember(db, projectId, viewer.sub);
}

/** Write-side gate: admins + project staff (but NOT clients). */
async function canWrite(
  db: D1Database,
  projectId: number,
  viewer: { sub: number; role: string },
): Promise<boolean> {
  if (ADMIN_ROLES.has(viewer.role)) return true;
  if (viewer.role === 'client') return false;
  // Staff role + project member.
  return isProjectMember(db, projectId, viewer.sub);
}

function isValidDirection(d: unknown): d is Direction {
  return d === 'sent' || d === 'received';
}

function isValidLogDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ----------------------------------------------------------------------
// GET /api/correspondence/projects/:projectId
// List all correspondence entries for a project, newest log_date first.
// ----------------------------------------------------------------------
router.get('/projects/:projectId', async (c) => {
  const viewer = c.get('user');
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) {
    return c.json({ error: 'Invalid project id' }, 400);
  }

  const projExists = await c.env.DB.prepare('SELECT 1 AS x FROM projects WHERE id = ? LIMIT 1')
    .bind(projectId)
    .first<{ x: number }>();
  if (!projExists) return c.json({ error: 'Project not found' }, 404);

  if (!(await canRead(c.env.DB, projectId, viewer))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // `cl.*` so every column on the row (including from_email / to_email /
  // cc_emails added in later migrations) comes through.  Listing fields
  // explicitly bit us once: a new column was missing from the SELECT so
  // the edit dialog couldn't pre-fill those fields and the next save
  // wiped them.
  const { results } = await c.env.DB.prepare(
    `
    SELECT cl.*, u.full_name AS author_name
    FROM correspondence_log cl
    LEFT JOIN users u ON u.id = cl.author_id
    WHERE cl.project_id = ?
    ORDER BY cl.log_date DESC, cl.id DESC
  `,
  )
    .bind(projectId)
    .all<CorrespondenceRow>();

  // Clients aren't given write permission so the frontend hides the
  // controls; flag it explicitly for UI clarity / debugging.
  const isClient = await isProjectClient(c.env.DB, projectId, viewer.sub);

  return c.json({
    entries: results ?? [],
    can_write: !isClient && (await canWrite(c.env.DB, projectId, viewer)),
    // Захиалагч л гарын үсэг зурна — мөр бүрийн `sign_status = 'pending'` нь
    // товчийг харуулах эсэхийг шийднэ (routes/correspondenceSignature.ts).
    can_sign: viewer.role === 'client',
  });
});

// ----------------------------------------------------------------------
// POST /api/correspondence/projects/:projectId — add a new entry.
// Staff + admins only.  Body: { log_date, direction, subject, body?, attachment_url? }
// ----------------------------------------------------------------------
router.post('/projects/:projectId', async (c) => {
  const viewer = c.get('user');
  const projectId = Number(c.req.param('projectId'));
  if (!Number.isFinite(projectId)) {
    return c.json({ error: 'Invalid project id' }, 400);
  }

  if (!(await canWrite(c.env.DB, projectId, viewer))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req
    .json<{
      log_date?: string;
      direction?: string;
      subject?: string;
      body?: string;
      attachment_url?: string;
      from_email?: string;
      to_email?: string;
      cc_emails?: string;
      doc_type?: string | null;
      ref_no?: string | null;
      signature_url?: string | null;
    }>()
    .catch(
      () =>
        ({}) as {
          log_date?: string;
          direction?: string;
          subject?: string;
          body?: string;
          attachment_url?: string;
          from_email?: string;
          to_email?: string;
          cc_emails?: string;
          doc_type?: string | null;
          ref_no?: string | null;
          signature_url?: string | null;
        },
    );

  if (!isValidLogDate(body.log_date)) {
    return c.json({ error: 'log_date must be YYYY-MM-DD' }, 400);
  }
  if (!isValidDirection(body.direction)) {
    return c.json({ error: "direction must be 'sent' or 'received'" }, 400);
  }
  const subject = (body.subject ?? '').trim();
  if (!subject) {
    return c.json({ error: 'subject is required' }, 400);
  }
  if (body.doc_type != null && body.doc_type !== '' && !isValidDocType(body.doc_type)) {
    return c.json({ error: "doc_type must be 'rfi'|'cr'|'official'|'mr'" }, 400);
  }

  // Auto-number (RFI-202606-001 …) when a doc type is chosen but no explicit
  // ref_no was typed — matches the Gmail-triage classify behaviour.
  let refNo = normalizeFreeText(body.ref_no);
  if (!refNo && isValidDocType(body.doc_type)) {
    refNo = await nextRefNo(c.env.DB, projectId, body.doc_type, body.log_date);
  }

  const signatureUrl = normalizeMediaUrl(body.signature_url);
  if (body.signature_url != null && body.signature_url !== '' && !signatureUrl) {
    return c.json({ error: 'signature_url must be a /media/ key' }, 400);
  }

  const ins = await c.env.DB.prepare(
    `
    INSERT INTO correspondence_log
      (project_id, author_id, log_date, direction, subject, body,
       attachment_url, from_email, to_email, cc_emails, doc_type, ref_no, signature_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
  )
    .bind(
      projectId,
      viewer.sub,
      body.log_date,
      body.direction,
      subject,
      body.body?.trim() || null,
      body.attachment_url?.trim() || null,
      normalizeFreeText(body.from_email),
      normalizeFreeText(body.to_email),
      normalizeFreeText(body.cc_emails),
      isValidDocType(body.doc_type) ? body.doc_type : null,
      refNo,
      signatureUrl,
    )
    .first<{ id: number }>();

  const row = await c.env.DB.prepare(
    `
    SELECT cl.*, u.full_name AS author_name
    FROM correspondence_log cl
    LEFT JOIN users u ON u.id = cl.author_id
    WHERE cl.id = ?
  `,
  )
    .bind(ins?.id)
    .first<CorrespondenceRow>();

  return c.json({ entry: row }, 201);
});

// ----------------------------------------------------------------------
// PATCH /api/correspondence/:id — edit subject / body / date / direction /
// attachment.  Only the author or an admin can edit.
// ----------------------------------------------------------------------
router.patch('/:id', async (c) => {
  const viewer = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id, project_id, author_id, sign_status, pdf_key FROM correspondence_log WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: number;
      project_id: number;
      author_id: number;
      sign_status: string;
      pdf_key: string | null;
    }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const isAdmin = ADMIN_ROLES.has(viewer.role);
  const isAuthor = existing.author_id === viewer.sub;
  if (!isAdmin && !isAuthor) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req
    .json<{
      log_date?: string;
      direction?: string;
      subject?: string;
      body?: string | null;
      attachment_url?: string | null;
      from_email?: string | null;
      to_email?: string | null;
      cc_emails?: string | null;
      doc_type?: string | null;
      ref_no?: string | null;
      signature_url?: string | null;
    }>()
    .catch(
      () =>
        ({}) as {
          log_date?: string;
          direction?: string;
          subject?: string;
          body?: string | null;
          attachment_url?: string | null;
          from_email?: string | null;
          to_email?: string | null;
          cc_emails?: string | null;
          doc_type?: string | null;
          ref_no?: string | null;
          signature_url?: string | null;
        },
    );

  // Захиалагч гарын үсэг зурсан бичиг ХӨДЛӨХГҮЙ (админд ч) — PDF-д орсон
  // агуулгыг өөрчилбөл гарын үсэг өөр баримт дээр зурагдсан болно.  Зөвхөн
  // `attachment_url` (Gmail-ийн зураг) чөлөөтэй.  Шинэ хувилбар хэрэгтэй бол
  // шинэ бичиг үүсгэнэ.
  if (existing.sign_status === 'signed') {
    const locked = lockedFieldsIn(body as Record<string, unknown>);
    if (locked.length > 0) {
      return c.json(
        {
          error: 'Захиалагч гарын үсэг зурсан бичгийн агуулгыг засах боломжгүй',
          locked_fields: locked,
        },
        409,
      );
    }
  }

  // Build a partial-update SET clause from whichever fields the caller
  // actually sent.  This avoids clobbering rows when the UI patches a
  // single field (e.g. just toggling direction).
  const sets: string[] = [];
  const args: (string | number | null)[] = [];

  if (body.log_date !== undefined) {
    if (!isValidLogDate(body.log_date)) {
      return c.json({ error: 'log_date must be YYYY-MM-DD' }, 400);
    }
    sets.push('log_date = ?');
    args.push(body.log_date);
  }
  if (body.direction !== undefined) {
    if (!isValidDirection(body.direction)) {
      return c.json({ error: "direction must be 'sent' or 'received'" }, 400);
    }
    sets.push('direction = ?');
    args.push(body.direction);
  }
  if (body.subject !== undefined) {
    const s = body.subject.trim();
    if (!s) return c.json({ error: 'subject cannot be empty' }, 400);
    sets.push('subject = ?');
    args.push(s);
  }
  if (body.body !== undefined) {
    sets.push('body = ?');
    args.push(body.body ? body.body.trim() || null : null);
  }
  if (body.attachment_url !== undefined) {
    sets.push('attachment_url = ?');
    args.push(body.attachment_url ? body.attachment_url.trim() || null : null);
  }
  if (body.from_email !== undefined) {
    sets.push('from_email = ?');
    args.push(normalizeFreeText(body.from_email));
  }
  if (body.to_email !== undefined) {
    sets.push('to_email = ?');
    args.push(normalizeFreeText(body.to_email));
  }
  if (body.cc_emails !== undefined) {
    sets.push('cc_emails = ?');
    args.push(normalizeFreeText(body.cc_emails));
  }
  if (body.doc_type !== undefined) {
    if (body.doc_type != null && body.doc_type !== '' && !isValidDocType(body.doc_type)) {
      return c.json({ error: "doc_type must be 'rfi'|'cr'|'official'|'mr'" }, 400);
    }
    sets.push('doc_type = ?');
    args.push(isValidDocType(body.doc_type) ? body.doc_type : null);
  }
  if (body.ref_no !== undefined) {
    sets.push('ref_no = ?');
    args.push(normalizeFreeText(body.ref_no));
  }
  if (body.signature_url !== undefined) {
    const signatureUrl = normalizeMediaUrl(body.signature_url);
    if (body.signature_url != null && body.signature_url !== '' && !signatureUrl) {
      return c.json({ error: 'signature_url must be a /media/ key' }, 400);
    }
    sets.push('signature_url = ?');
    args.push(signatureUrl);
  }
  if (sets.length === 0) return c.json({ error: 'No fields to update' }, 400);

  sets.push("updated_at = datetime('now')");
  // Агуулга өөрчлөгдвөл хадгалсан PDF кэш хуучирна — `pdfIsCurrent` үүнийг
  // `updated_at`-аар ч барина, гэвч объектыг орхихгүйн тулд энд шууд салгана.
  const contentChanged = lockedFieldsIn(body as Record<string, unknown>).length > 0;
  if (contentChanged) sets.push('pdf_key = NULL', 'pdf_generated_at = NULL');
  args.push(id);

  await c.env.DB.prepare(`UPDATE correspondence_log SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...args)
    .run();
  if (contentChanged && existing.pdf_key) {
    const oldKey = existing.pdf_key;
    c.executionCtx.waitUntil(c.env.MEETING_BUCKET.delete(oldKey).catch(() => undefined));
  }

  const row = await c.env.DB.prepare(
    `
    SELECT cl.*, u.full_name AS author_name
    FROM correspondence_log cl
    LEFT JOIN users u ON u.id = cl.author_id
    WHERE cl.id = ?
  `,
  )
    .bind(id)
    .first<CorrespondenceRow>();

  return c.json({ entry: row });
});

// ----------------------------------------------------------------------
// DELETE /api/correspondence/:id — author or admin only.
// ----------------------------------------------------------------------
router.delete('/:id', async (c) => {
  const viewer = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT author_id, sign_status, client_signature_key, pdf_key FROM correspondence_log WHERE id = ?',
  )
    .bind(id)
    .first<{
      author_id: number;
      sign_status: string;
      client_signature_key: string | null;
      pdf_key: string | null;
    }>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const isAdmin = ADMIN_ROLES.has(viewer.role);
  const isAuthor = existing.author_id === viewer.sub;
  if (!isAdmin && !isAuthor) return c.json({ error: 'Forbidden' }, 403);
  // Гарын үсэгтэй бичиг = захиалагчийн баталгаа; зохиогч дангаараа устгахгүй.
  if (existing.sign_status === 'signed' && !isAdmin) {
    return c.json({ error: 'Захиалагч гарын үсэг зурсан бичгийг зөвхөн админ устгана' }, 403);
  }

  // 0381: устгагдсан бичигт хүлээгдэж буй public гарын үсгийн link үлдэж болохгүй.
  // Зурагдсан хүсэлтийн мөр (аудит нотолгоо) хэвээр үлдэнэ.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE public_document_sign_requests
          SET status = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now')
        WHERE kind = 'correspondence' AND entity_id = ? AND status = 'pending'`,
    ).bind(id),
    c.env.DB.prepare('DELETE FROM correspondence_log WHERE id = ?').bind(id),
  ]);
  // Хувийн bucket дахь гарын үсэг/PDF-ийг мөртэй нь хамт (арын дэвсгэрт).
  for (const key of [existing.client_signature_key, existing.pdf_key]) {
    if (key) c.executionCtx.waitUntil(c.env.MEETING_BUCKET.delete(key).catch(() => undefined));
  }
  return c.json({ ok: true });
});

registerCorrespondenceSendRoutes(router, canWrite);
// ⚠️ Send замуудын (`/aliases`, `/projects/:id/send-options`) ДАРАА — энд
//    `GET /:id` бүртгэгддэг тул урд нь тавивал `/aliases`-ыг залгина.
registerCorrespondenceSignatureRoutes(router, canRead, canWrite);

export default router;
