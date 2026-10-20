/**
 * External document signing.
 *
 * Staff creates a short-lived bearer link under /api/signing-links.
 * The recipient opens /sign/:token without an ERP account; the Worker exposes
 * only that one document and one signature slot under /public/signing/:token.
 * Raw tokens are never persisted (migration 0381 stores SHA-256 only).
 *
 * Consistency rules (все хоёр хүснэгтийн төлөв нэг D1 batch-д өөрчлөгдөнө):
 *   • link үүсгэх  = хуучин pending-ийг revoke + шинийг insert НЭГ batch.
 *   • гарын үсэг   = баримтын slot-ыг бөглөх + request-ийг `signed` болгох НЭГ batch;
 *     баримтын UPDATE нь «request одоо pending, хугацаа дуусаагүй» гэдгийг SQL-д
 *     шалгана, request-ийн UPDATE нь «баримт яг миний гарын үсгийг авсан» гэдгийг
 *     шалгана → хоёр тал хэзээ ч зөрөхгүй (revoke / ERP signer / portal signer уралдаан).
 *   • PDF snapshot нь ТУСДАА, сонголтой: унавал гарын үсгийг ЭРГЭЖ БУЦААХГҮЙ,
 *     staff `POST /:id/snapshot`-оор дахин оролдоно.
 * Рендерлэх IO (Browser Rendering) нь `SigningRenderIo`-оор оролцдог тул route нь
 * `node --test`-д ачаалагдана.
 */
import { Hono } from 'hono';
import { canSeeAsrReport } from '../lib/asrVisibility';
import {
  clientSignatureKey,
  DOC_TYPE_TITLE_MN,
  isSignableDocType,
  parseSignatureDataUrl,
} from '../lib/correspondenceSignature';
import { createNotification } from '../lib/notify';
import { orgConfig } from '../lib/orgConfig';
import {
  cleanSigningText,
  expiresAtIso,
  isExpired,
  isPublicSigningKind,
  isPublicSigningSlot,
  newPublicSigningToken,
  normalizeExpiryDays,
  sha256Hex,
  type PublicSigningKind,
  type PublicSigningSlot,
  type PublicSigningStatus,
} from '../lib/publicSigning';
import type { SigningRenderActor, SigningRenderIo } from '../lib/publicSigningRender';
import { todayInUB } from '../lib/time';
import { isAdminRole, type AppVariables, type Env, type UserRole } from '../types';

type App = { Bindings: Env; Variables: AppVariables };

const STAFF_ROLES = new Set<UserRole>(['admin', 'senior', 'engineer', 'architect']);

/** JSON body-ийн дээд хэмжээ: 512 KB PNG → ~700 KB base64 + бусад талбар. */
const MAX_SIGN_BODY_BYTES = 900 * 1024;

interface RequestRow {
  id: number;
  token_hash: string;
  kind: PublicSigningKind;
  entity_id: number;
  project_id: number;
  slot: PublicSigningSlot;
  role_label: string;
  signer_name_hint: string | null;
  status: PublicSigningStatus;
  requested_by: number;
  expires_at: string;
  first_viewed_at: string | null;
  signed_name: string | null;
  signature_key: string | null;
  signature_sha256: string | null;
  document_snapshot_key: string | null;
  document_sha256: string | null;
  signed_at: string | null;
  signed_user_agent: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Requester {
  id: number;
  role: UserRole;
  full_name: string | null;
  position: string | null;
  status: string;
}

export function tokenLooksValid(token: string): boolean {
  // 32 random bytes → 43 base64url chars (the range tolerates future widening).
  return /^[A-Za-z0-9_-]{40,60}$/.test(token);
}

function noStore(c: { header: (k: string, v: string) => void }) {
  c.header('Cache-Control', 'no-store, max-age=0');
  c.header('Pragma', 'no-cache');
  c.header('X-Content-Type-Options', 'nosniff');
  // The token lives in the URL path — never leak it through Referer.
  c.header('Referrer-Policy', 'no-referrer');
}

async function requestFromToken(db: D1Database, token: string): Promise<RequestRow | null> {
  if (!tokenLooksValid(token)) return null;
  const hash = await sha256Hex(token);
  return db
    .prepare('SELECT * FROM public_document_sign_requests WHERE token_hash = ? LIMIT 1')
    .bind(hash)
    .first<RequestRow>();
}

async function requester(db: D1Database, userId: number): Promise<Requester | null> {
  return db
    .prepare('SELECT id, role, full_name, position, status FROM users WHERE id = ?')
    .bind(userId)
    .first<Requester>();
}

/** `routes/correspondence.ts` `canWrite`-ийн ихэр: admin + (staff AND project member), client үгүй. */
async function isCorrespondenceWriter(
  db: D1Database,
  projectId: number,
  user: { sub: number; role: string },
): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (!STAFF_ROLES.has(user.role as UserRole)) return false;
  const row = await db
    .prepare('SELECT 1 AS x FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1')
    .bind(projectId, user.sub)
    .first<{ x: number }>();
  return !!row;
}

async function requesterStillAuthorized(
  db: D1Database,
  req: Pick<RequestRow, 'kind' | 'entity_id' | 'project_id'>,
  who: Requester | null,
): Promise<boolean> {
  if (!who || who.status !== 'active' || !STAFF_ROLES.has(who.role)) return false;
  if (req.kind === 'correspondence') {
    return isCorrespondenceWriter(db, req.project_id, { sub: who.id, role: who.role });
  }
  return canSeeAsrReport(db, req.entity_id, { sub: who.id, isAdmin: isAdminRole(who.role) });
}

async function staffCanAccessEntity(
  db: D1Database,
  kind: PublicSigningKind,
  entityId: number,
  user: { sub: number; role: UserRole },
): Promise<boolean> {
  if (!STAFF_ROLES.has(user.role)) return false;
  if (kind === 'correspondence') {
    const row = await db
      .prepare('SELECT project_id FROM correspondence_log WHERE id = ?')
      .bind(entityId)
      .first<{ project_id: number }>();
    return !!row && isCorrespondenceWriter(db, row.project_id, user);
  }
  return canSeeAsrReport(db, entityId, { sub: user.sub, isAdmin: isAdminRole(user.role) });
}

function defaultRoleLabel(kind: PublicSigningKind, slot: PublicSigningSlot): string {
  if (kind === 'correspondence') return 'Захиалагч / хүлээн авагч';
  return slot === 'arch' ? 'Хяналт хийсэн / зохиогч' : 'Талбайн инженер';
}

function publicUrl(frontendUrl: string, token: string): string {
  return `${frontendUrl.replace(/\/+$/, '')}/sign/${encodeURIComponent(token)}`;
}

async function closeRequest(
  db: D1Database,
  req: RequestRow,
  status: 'expired' | 'revoked',
): Promise<RequestRow> {
  await db
    .prepare(
      `UPDATE public_document_sign_requests
          SET status = ?, revoked_at = CASE WHEN ? = 'revoked' THEN datetime('now') ELSE revoked_at END,
              updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(status, status, req.id)
    .run();
  return { ...req, status };
}

async function expireIfNeeded(db: D1Database, req: RequestRow): Promise<RequestRow> {
  if (req.status !== 'pending' || !isExpired(req.expires_at)) return req;
  return closeRequest(db, req, 'expired');
}

interface DocumentMeta {
  project_name: string;
  document_type: string;
  document_no: string | null;
  title: string;
  document_date: string;
  prepared_by: string | null;
  prepared_by_position: string | null;
  already_signed: boolean;
  signed_name: string | null;
  signed_at: string | null;
  /** Баримтын «одоогийн төлөв»-ийн тэмдэг — preview cache + snapshot шалгалт. */
  version: string;
}

async function loadDocumentMeta(db: D1Database, req: RequestRow): Promise<DocumentMeta | null> {
  if (req.kind === 'correspondence') {
    const row = await db
      .prepare(
        `SELECT c.id, c.project_id, c.doc_type, c.ref_no, c.subject, c.log_date,
                c.author_id, c.sign_status, c.client_signer_name, c.client_signed_at, c.updated_at,
                p.name AS project_name, u.full_name AS author_name, u.position AS author_position
           FROM correspondence_log c
           LEFT JOIN projects p ON p.id = c.project_id
           LEFT JOIN users u ON u.id = c.author_id
          WHERE c.id = ?`,
      )
      .bind(req.entity_id)
      .first<{
        id: number;
        project_id: number;
        doc_type: string | null;
        ref_no: string | null;
        subject: string;
        log_date: string;
        author_id: number;
        sign_status: string;
        client_signer_name: string | null;
        client_signed_at: string | null;
        updated_at: string;
        project_name: string | null;
        author_name: string | null;
        author_position: string | null;
      }>();
    if (!row || !isSignableDocType(row.doc_type)) return null;
    return {
      project_name: row.project_name ?? 'Төсөл',
      document_type: DOC_TYPE_TITLE_MN[row.doc_type],
      document_no: row.ref_no,
      title: row.subject,
      document_date: row.log_date,
      prepared_by: row.author_name,
      prepared_by_position: row.author_position,
      already_signed: row.sign_status === 'signed',
      signed_name: row.client_signer_name,
      signed_at: row.client_signed_at,
      version: row.updated_at,
    };
  }

  const row = await db
    .prepare(
      `SELECT r.id, r.project_id, r.doc_no, r.report_date, r.author_id, r.updated_at,
              r.sig_arch_name, r.sig_arch_url, r.sig_arch_date,
              r.sig_site_name, r.sig_site_url, r.sig_site_date,
              p.name AS project_name, u.full_name AS author_name, u.position AS author_position
         FROM author_supervision_reports r
         LEFT JOIN projects p ON p.id = r.project_id
         LEFT JOIN users u ON u.id = r.author_id
        WHERE r.id = ?`,
    )
    .bind(req.entity_id)
    .first<{
      id: number;
      project_id: number;
      doc_no: string | null;
      report_date: string;
      author_id: number;
      updated_at: string;
      sig_arch_name: string | null;
      sig_arch_url: string | null;
      sig_arch_date: string | null;
      sig_site_name: string | null;
      sig_site_url: string | null;
      sig_site_date: string | null;
      project_name: string | null;
      author_name: string | null;
      author_position: string | null;
    }>();
  if (!row) return null;
  const arch = req.slot === 'arch';
  const url = arch ? row.sig_arch_url : row.sig_site_url;
  return {
    project_name: row.project_name ?? 'Төсөл',
    document_type: 'Зохиогчийн хяналтын тайлан',
    document_no: row.doc_no,
    title: row.doc_no ? `Зохиогчийн хяналт · ${row.doc_no}` : 'Зохиогчийн хяналтын тайлан',
    document_date: row.report_date,
    prepared_by: row.author_name,
    prepared_by_position: row.author_position,
    already_signed: Boolean(url && url.trim()),
    signed_name: arch ? row.sig_arch_name : row.sig_site_name,
    signed_at: arch ? row.sig_arch_date : row.sig_site_date,
    version: row.updated_at,
  };
}

function companyBlock() {
  const org = orgConfig();
  return {
    name: org.name,
    legal_name: org.legalNameMn,
    tagline: org.taglineMn,
    website: org.websiteUrl,
    contact_email: org.contactEmail,
  };
}

/** Request дууссан (`signed|revoked|expired`) үед ил гаргах хамгийн бага мэдээлэл. */
function terminalPayload(req: RequestRow, meta: DocumentMeta | null) {
  const signed = req.status === 'signed';
  return {
    request: {
      status: req.status,
      role_label: req.role_label,
      signer_name_hint: null,
      expires_at: req.expires_at,
      signed_name: signed ? (req.signed_name ?? meta?.signed_name ?? null) : null,
      signed_at: signed ? (req.signed_at ?? meta?.signed_at ?? null) : null,
    },
    company: companyBlock(),
    document: meta
      ? {
          project_name: meta.project_name,
          document_type: meta.document_type,
          document_no: meta.document_no,
          title: meta.title,
          document_date: meta.document_date,
          prepared_by: null,
          prepared_by_position: null,
        }
      : null,
  };
}

/**
 * Баримтыг R2-д тавьсан гарын үсгийн ТҮЛХҮҮР руу чиглүүлсэн «яг миний гарын үсэг
 * баримтад байна» шалгалт — snapshot-ийн зөв байдлыг батлахад хэрэглэнэ.
 */
async function entityHoldsSignature(db: D1Database, req: RequestRow): Promise<string | null> {
  if (!req.signature_key) return null;
  if (req.kind === 'correspondence') {
    const row = await db
      .prepare('SELECT client_signature_key, updated_at FROM correspondence_log WHERE id = ?')
      .bind(req.entity_id)
      .first<{ client_signature_key: string | null; updated_at: string }>();
    return row && row.client_signature_key === req.signature_key ? row.updated_at : null;
  }
  const row = await db
    .prepare(
      'SELECT sig_arch_url, sig_site_url, updated_at FROM author_supervision_reports WHERE id = ?',
    )
    .bind(req.entity_id)
    .first<{ sig_arch_url: string | null; sig_site_url: string | null; updated_at: string }>();
  if (!row) return null;
  const url = req.slot === 'arch' ? row.sig_arch_url : row.sig_site_url;
  return url === `/media/${req.signature_key}` ? row.updated_at : null;
}

/**
 * Гарын үсэг зурагдсаны ДАРААХ баримтын PDF-ийг хувийн bucket-д өөрчлөгдөхгүй
 * нотолгоо болгон хадгална.  Хэзээ ч шидэхгүй; амжилттай эсэхийг буцаана.
 *
 * Зөв байдал: рендерийн өмнө/дараа баримт ЯГ миний гарын үсэгтэй, ижил `updated_at`
 * хэвээр байх ёстой — үгүй бол (баримт дундуур засагдсан) нэг удаа дахин оролдоод,
 * дахин зөрвөл хадгалахгүй (буруу төлөвийг «нотолгоо» болгохгүй).
 */
export async function storeSignedSnapshot(
  env: Env,
  io: SigningRenderIo,
  req: RequestRow,
  actor: SigningRenderActor,
): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = await entityHoldsSignature(env.DB, req);
      if (before === null) return false;
      const rendered = await io.render(env, req.kind, req.entity_id, actor);
      if (!rendered) return false;
      const after = await entityHoldsSignature(env.DB, req);
      if (after === null || after !== before) continue;

      const hash = await sha256Hex(rendered.bytes);
      const key =
        `public-signing/snapshots/${req.kind}-${req.entity_id}-request-${req.id}-` +
        `${crypto.randomUUID().replace(/-/g, '')}.pdf`;
      await env.MEETING_BUCKET.put(key, rendered.bytes, {
        httpMetadata: { contentType: 'application/pdf' },
        customMetadata: {
          publicSigningRequestId: String(req.id),
          kind: req.kind,
          entityId: String(req.entity_id),
          sha256: hash,
        },
      });
      const updated = await env.DB.prepare(
        `UPDATE public_document_sign_requests
            SET document_snapshot_key = ?, document_sha256 = ?, updated_at = datetime('now')
          WHERE id = ? AND status = 'signed' AND document_snapshot_key IS NULL`,
      )
        .bind(key, hash, req.id)
        .run();
      if (!updated.meta.changes) {
        await env.MEETING_BUCKET.delete(key).catch(() => undefined);
        return false;
      }
      return true;
    }
    console.error('[public-signing] snapshot skipped: document kept changing', req.id);
    return false;
  } catch (err) {
    console.error('[public-signing] signed snapshot failed', req.id, err);
    return false;
  }
}

function previewKey(requestId: number): string {
  return `public-signing/preview/request-${requestId}.pdf`;
}

/**
 * Баримтыг Browser Rendering-ээр PDF болгож хувийн preview cache-д тавина.  Нэг
 * удаагийн рендер ~5–15 с (браузер асаах + хуудас + зураг) — гаднын хүн link
 * нээгээд тэр хугацаанд хоосон дэлгэц хардаг байсан (эзэн 2026-10-12: «маш
 * удаан»).  Тиймээс link ҮҮСГЭХ агшинд (`staffRouter.post`) ч энэ функцийг
 * `waitUntil`-ээр дуудаж cache-ийг урьдчилан бөглөнө; `GET /:token/document`
 * эхний нээлтээс л cache-ээс өгнө.  `meta.version` (= баримтын updated_at)
 * зөрвөл cache хүчингүй тул хуучирсан баримт хэзээ ч гарахгүй.
 */
async function renderAndCachePreview(
  env: Env,
  io: SigningRenderIo,
  req: RequestRow,
  who: Requester,
  meta: DocumentMeta,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const rendered = await io.render(env, req.kind, req.entity_id, { sub: who.id, role: who.role });
  if (!rendered) return null;
  waitUntil(
    env.MEETING_BUCKET.put(previewKey(req.id), rendered.bytes, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: { version: meta.version, fileName: rendered.fileName },
    }).then(
      () => undefined,
      (err) => console.error('[public-signing] preview cache write failed', req.id, err),
    ),
  );
  return rendered;
}

/** Link үүсгэсний дараа (хариу явсны ДАРАА) cache-ийг бөглөнө — алдаа нь юуг ч унагахгүй. */
async function warmPreview(env: Env, io: SigningRenderIo, requestId: number): Promise<void> {
  try {
    const req = await env.DB.prepare('SELECT * FROM public_document_sign_requests WHERE id = ?')
      .bind(requestId)
      .first<RequestRow>();
    if (!req || req.status !== 'pending') return;
    const [who, meta] = await Promise.all([
      requester(env.DB, req.requested_by),
      loadDocumentMeta(env.DB, req),
    ]);
    if (!who || !meta || meta.already_signed) return;
    const writes: Promise<unknown>[] = [];
    await renderAndCachePreview(env, io, req, who, meta, (p) => writes.push(p));
    await Promise.all(writes);
  } catch (err) {
    console.error('[public-signing] preview warm failed', requestId, err);
  }
}

/** Гарын үсэг зурсны дараа/цуцлахад preview cache-ийг устгана (best effort). */
function dropPreview(env: Env, requestId: number): Promise<void> {
  return env.MEETING_BUCKET.delete(previewKey(requestId)).catch(() => undefined) as Promise<void>;
}

function bodyOf<T>(raw: unknown): Partial<T> {
  return raw && typeof raw === 'object' ? (raw as Partial<T>) : {};
}

export function createSigningRouters(io: SigningRenderIo) {
  const staffRouter = new Hono<App>();
  const publicRouter = new Hono<{ Bindings: Env }>();

  /* ---------------------------------------------------------------- */
  /* Staff: create/list/revoke share links                              */
  /* ---------------------------------------------------------------- */

  staffRouter.post('/', async (c) => {
    const user = c.get('user');
    if (!STAFF_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);

    const body = bodyOf<{
      kind: unknown;
      entity_id: unknown;
      slot: unknown;
      role_label: unknown;
      signer_name_hint: unknown;
      expires_in_days: unknown;
    }>(await c.req.json().catch(() => null));

    if (!isPublicSigningKind(body.kind)) return c.json({ error: 'Invalid signing kind' }, 400);
    const entityId = Number(body.entity_id);
    if (!Number.isInteger(entityId) || entityId <= 0) return c.json({ error: 'Invalid entity id' }, 400);

    const kind = body.kind;
    const slot: PublicSigningSlot =
      kind === 'correspondence' ? 'client' : isPublicSigningSlot(body.slot) ? body.slot : 'site';
    if (kind === 'asr' && slot === 'client') return c.json({ error: 'ASR slot must be arch or site' }, 400);

    let projectId: number;
    let suggestedName: string | null = null;

    if (kind === 'correspondence') {
      const row = await c.env.DB.prepare(
        'SELECT id, project_id, doc_type, sign_status, client_signer_name FROM correspondence_log WHERE id = ?',
      )
        .bind(entityId)
        .first<{
          id: number;
          project_id: number;
          doc_type: string | null;
          sign_status: string;
          client_signer_name: string | null;
        }>();
      if (!row) return c.json({ error: 'Not found' }, 404);
      // Эрхийн шалгалт ЭХЛЭЭД — эрхгүй хүнд баримтын төлөв (404/409) харуулахгүй.
      if (!(await isCorrespondenceWriter(c.env.DB, row.project_id, user))) {
        return c.json({ error: 'Forbidden' }, 403);
      }
      if (!isSignableDocType(row.doc_type)) return c.json({ error: 'Зөвхөн RFI / CR бичигт link үүсгэнэ' }, 400);
      if (row.sign_status === 'signed') return c.json({ error: 'Аль хэдийн гарын үсэг зурсан' }, 409);
      projectId = row.project_id;
      suggestedName = row.client_signer_name;
    } else {
      if (!(await canSeeAsrReport(c.env.DB, entityId, { sub: user.sub, isAdmin: isAdminRole(user.role) }))) {
        // Олдохгүй ба харах эрхгүйг ялгахгүй.
        return c.json({ error: 'Forbidden' }, 403);
      }
      const row = await c.env.DB.prepare(
        `SELECT id, project_id, sig_arch_name, sig_arch_url, sig_site_name, sig_site_url
           FROM author_supervision_reports WHERE id = ?`,
      )
        .bind(entityId)
        .first<{
          id: number;
          project_id: number;
          sig_arch_name: string | null;
          sig_arch_url: string | null;
          sig_site_name: string | null;
          sig_site_url: string | null;
        }>();
      if (!row) return c.json({ error: 'Not found' }, 404);
      const occupied = slot === 'arch' ? row.sig_arch_url : row.sig_site_url;
      if (occupied && occupied.trim()) {
        return c.json({ error: 'Энэ гарын үсгийн мөр аль хэдийн бөглөгдсөн' }, 409);
      }
      projectId = row.project_id;
      suggestedName = slot === 'arch' ? row.sig_arch_name : row.sig_site_name;
    }

    const rawToken = newPublicSigningToken();
    const hash = await sha256Hex(rawToken);
    const expiresAt = expiresAtIso(normalizeExpiryDays(body.expires_in_days));
    const roleLabel = cleanSigningText(body.role_label, 120) ?? defaultRoleLabel(kind, slot);
    const signerName = cleanSigningText(body.signer_name_hint, 160) ?? suggestedName;

    // Хуучин pending-ийг revoke + шинийг insert НЭГ transaction: хоёр хүсэлт
    // зэрэг ирсэн ч (unique partial index) нэг нь л үлдэнэ, insert унавал
    // хуучин link хэвээр.
    const statements = [
      c.env.DB.prepare(
        `UPDATE public_document_sign_requests
            SET status = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now')
          WHERE kind = ? AND entity_id = ? AND slot = ? AND status = 'pending'`,
      ).bind(kind, entityId, slot),
      c.env.DB.prepare(
        `INSERT INTO public_document_sign_requests
           (token_hash, kind, entity_id, project_id, slot, role_label, signer_name_hint,
            status, requested_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).bind(hash, kind, entityId, projectId, slot, roleLabel, signerName, user.sub, expiresAt),
    ];
    if (kind === 'correspondence') {
      // Хуучин status UI утга учиртай хэвээр; signed хэзээ ч буурахгүй.
      statements.push(
        c.env.DB.prepare(
          `UPDATE correspondence_log
              SET sign_status = CASE WHEN sign_status = 'none' THEN 'pending' ELSE sign_status END,
                  sign_requested_at = COALESCE(sign_requested_at, datetime('now')),
                  sign_requested_by = COALESCE(sign_requested_by, ?),
                  updated_at = datetime('now')
            WHERE id = ? AND sign_status <> 'signed'`,
        ).bind(user.sub, entityId),
      );
    }
    const results = await c.env.DB.batch(statements);
    const ins = results[1]!;
    // Гаднын хүн link нээхээс ӨМНӨ баримтыг рендерлэж cache-д тавина (хурд).
    c.executionCtx.waitUntil(warmPreview(c.env, io, Number(ins.meta.last_row_id)));

    return c.json(
      {
        id: Number(ins.meta.last_row_id),
        url: publicUrl(c.env.FRONTEND_URL, rawToken),
        expires_at: expiresAt,
        status: 'pending',
        role_label: roleLabel,
        slot,
      },
      201,
    );
  });

  staffRouter.get('/', async (c) => {
    const user = c.get('user');
    if (!STAFF_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
    const kind = c.req.query('kind');
    const entityId = Number(c.req.query('entity_id'));
    if (!isPublicSigningKind(kind) || !Number.isInteger(entityId) || entityId <= 0) {
      return c.json({ error: 'kind and entity_id are required' }, 400);
    }
    if (!(await staffCanAccessEntity(c.env.DB, kind, entityId, user))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    const rows = await c.env.DB.prepare(
      `SELECT id, kind, entity_id, slot, role_label, signer_name_hint,
              CASE WHEN status = 'pending' AND expires_at <= ? THEN 'expired' ELSE status END AS status,
              requested_by, expires_at, first_viewed_at, signed_name, signed_at,
              signature_sha256, document_sha256,
              CASE WHEN document_snapshot_key IS NOT NULL THEN 1 ELSE 0 END AS snapshot_ready,
              revoked_at, created_at, updated_at
         FROM public_document_sign_requests
        WHERE kind = ? AND entity_id = ?
        ORDER BY id DESC LIMIT 20`,
    )
      .bind(new Date().toISOString(), kind, entityId)
      .all();
    return c.json({ requests: rows.results });
  });

  staffRouter.delete('/:id', async (c) => {
    const user = c.get('user');
    if (!STAFF_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const row = await c.env.DB.prepare(
      'SELECT id, kind, entity_id, requested_by, status FROM public_document_sign_requests WHERE id = ?',
    )
      .bind(id)
      .first<{
        id: number;
        kind: PublicSigningKind;
        entity_id: number;
        requested_by: number;
        status: PublicSigningStatus;
      }>();
    if (!row) return c.json({ error: 'Not found' }, 404);
    if (user.role !== 'admin' && row.requested_by !== user.sub) return c.json({ error: 'Forbidden' }, 403);
    if (!(await staffCanAccessEntity(c.env.DB, row.kind, row.entity_id, user))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (row.status !== 'pending') return c.json({ error: 'Зөвхөн хүлээгдэж буй link-ийг цуцална' }, 409);
    await c.env.DB.prepare(
      `UPDATE public_document_sign_requests
          SET status = 'revoked', revoked_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ? AND status = 'pending'`,
    )
      .bind(id)
      .run();
    c.executionCtx.waitUntil(dropPreview(c.env, id));
    return c.json({ ok: true });
  });

  /** Гарын үсэг зурагдсан хүсэлтийн PDF snapshot-ийг (унасан бол) дахин үүсгэнэ. */
  staffRouter.post('/:id/snapshot', async (c) => {
    const user = c.get('user');
    if (!STAFF_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const req = await c.env.DB.prepare('SELECT * FROM public_document_sign_requests WHERE id = ?')
      .bind(id)
      .first<RequestRow>();
    if (!req) return c.json({ error: 'Not found' }, 404);
    if (!(await staffCanAccessEntity(c.env.DB, req.kind, req.entity_id, user))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (req.status !== 'signed' || !req.signature_key) {
      return c.json({ error: 'Зөвхөн энэ link-ээр зурагдсан баримтад snapshot үүснэ' }, 409);
    }
    if (req.document_snapshot_key) return c.json({ ok: true, snapshot_ready: true, already: true });
    const ok = await storeSignedSnapshot(c.env, io, req, { sub: user.sub, role: user.role });
    if (!ok) return c.json({ error: 'Snapshot үүсгэж чадсангүй (баримт өөрчлөгдсөн эсвэл рендер алдаатай)' }, 502);
    return c.json({ ok: true, snapshot_ready: true });
  });

  /** Хувийн bucket дахь өөрчлөгдөхгүй PDF нотолгоог эрхтэй ажилтанд л өгнө. */
  staffRouter.get('/:id/snapshot', async (c) => {
    const user = c.get('user');
    if (!STAFF_ROLES.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
    const req = await c.env.DB.prepare('SELECT * FROM public_document_sign_requests WHERE id = ?')
      .bind(id)
      .first<RequestRow>();
    if (!req) return c.json({ error: 'Not found' }, 404);
    if (!(await staffCanAccessEntity(c.env.DB, req.kind, req.entity_id, user))) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    if (!req.document_snapshot_key) return c.json({ error: 'Snapshot үүсээгүй байна' }, 404);
    const obj = await c.env.MEETING_BUCKET.get(req.document_snapshot_key);
    if (!obj) return c.json({ error: 'Snapshot олдсонгүй' }, 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="signed-${req.kind}-${req.entity_id}-${req.id}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Document-SHA256': req.document_sha256 ?? '',
      },
    });
  });

  /* ---------------------------------------------------------------- */
  /* Public: one-token document view + signature                         */
  /* ---------------------------------------------------------------- */

  publicRouter.get('/:token', async (c) => {
    noStore(c);
    let req = await requestFromToken(c.env.DB, c.req.param('token'));
    if (!req) return c.json({ error: 'Link олдсонгүй эсвэл хүчингүй байна' }, 404);
    req = await expireIfNeeded(c.env.DB, req);

    const meta = await loadDocumentMeta(c.env.DB, req);

    if (req.status === 'pending') {
      const who = await requester(c.env.DB, req.requested_by);
      if (!(await requesterStillAuthorized(c.env.DB, req, who))) {
        // Хүсэгчийн эрх алга болсон → link-ийг бүр мөсөн хаана (slot чөлөөлөгдөнө).
        await closeRequest(c.env.DB, req, 'revoked');
        return c.json({ error: 'Энэ link-ийн эрх хүчингүй болсон' }, 410);
      }
      if (!meta) return c.json({ error: 'Баримт олдсонгүй' }, 404);

      // ERP / client portal энэ slot-ыг аль хэдийн зурсан бол public link нээгдэхгүй.
      if (meta.already_signed) {
        await c.env.DB.prepare(
          `UPDATE public_document_sign_requests
              SET status = 'signed', signed_name = COALESCE(signed_name, ?),
                  signed_at = COALESCE(signed_at, ?), updated_at = datetime('now')
            WHERE id = ? AND status = 'pending'`,
        )
          .bind(meta.signed_name, meta.signed_at, req.id)
          .run();
        const fresh = await c.env.DB.prepare('SELECT * FROM public_document_sign_requests WHERE id = ?')
          .bind(req.id)
          .first<RequestRow>();
        return c.json(terminalPayload(fresh ?? { ...req, status: 'signed' }, meta));
      }

      if (!req.first_viewed_at) {
        await c.env.DB.prepare(
          `UPDATE public_document_sign_requests
              SET first_viewed_at = datetime('now'), updated_at = datetime('now')
            WHERE id = ? AND first_viewed_at IS NULL`,
        )
          .bind(req.id)
          .run();
      }

      return c.json({
        request: {
          status: 'pending',
          role_label: req.role_label,
          signer_name_hint: req.signer_name_hint,
          expires_at: req.expires_at,
          signed_name: null,
          signed_at: null,
        },
        company: companyBlock(),
        document: {
          project_name: meta.project_name,
          document_type: meta.document_type,
          document_no: meta.document_no,
          title: meta.title,
          document_date: meta.document_date,
          prepared_by: meta.prepared_by,
          prepared_by_position: meta.prepared_by_position,
        },
      });
    }

    // signed | revoked | expired — хүсэгчийн эрхээс үл хамаарч төгсгөлийн төлөв.
    return c.json(terminalPayload(req, req.status === 'revoked' || req.status === 'expired' ? null : meta));
  });

  publicRouter.get('/:token/document', async (c) => {
    noStore(c);
    let req = await requestFromToken(c.env.DB, c.req.param('token'));
    if (!req) return c.json({ error: 'Link олдсонгүй' }, 404);
    req = await expireIfNeeded(c.env.DB, req);
    // Зөвхөн хүлээгдэж буй link баримт өгнө: зурсан/цуцалсан/дууссан bearer token
    // амьд баримтыг цааш задруулахгүй.
    if (req.status !== 'pending') return c.json({ error: 'Link хүчингүй болсон' }, 410);

    const who = await requester(c.env.DB, req.requested_by);
    if (!(await requesterStillAuthorized(c.env.DB, req, who)) || !who) {
      await closeRequest(c.env.DB, req, 'revoked');
      return c.json({ error: 'Баримтыг нээх эрх хүчингүй болсон' }, 410);
    }
    const meta = await loadDocumentMeta(c.env.DB, req);
    if (!meta) return c.json({ error: 'Баримт олдсонгүй' }, 404);
    if (meta.already_signed) return c.json({ error: 'Link хүчингүй болсон' }, 410);

    const pdfHeaders = (fileName: string): Record<string, string> => {
      const ascii = fileName.replace(/[^ -~]/g, '_').replace(/["\\]/g, '_');
      return {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Cache-Control': 'no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      };
    };

    // Нэвтрэлтгүй endpoint-ээр Browser Rendering-ийг дахин дахин ажиллуулахгүйн
    // тулд баримтын төлөв (updated_at) өөрчлөгдөөгүй бол хувийн cache-ээс өгнө.
    const key = previewKey(req.id);
    try {
      const cached = await c.env.MEETING_BUCKET.get(key);
      if (cached && cached.customMetadata?.version === meta.version) {
        return new Response(cached.body, {
          status: 200,
          headers: pdfHeaders(cached.customMetadata?.fileName ?? 'document.pdf'),
        });
      }
    } catch (err) {
      console.error('[public-signing] preview cache read failed', req.id, err);
    }

    try {
      const rendered = await renderAndCachePreview(c.env, io, req, who, meta, (p) =>
        c.executionCtx.waitUntil(p),
      );
      if (!rendered) return c.json({ error: 'Баримт олдсонгүй' }, 404);
      return new Response(rendered.bytes, { status: 200, headers: pdfHeaders(rendered.fileName) });
    } catch (err) {
      console.error('[public-signing] document render failed', req.kind, req.entity_id, err);
      return c.json({ error: 'Баримтыг урьдчилан харахад алдаа гарлаа' }, 500);
    }
  });

  publicRouter.post('/:token/sign', async (c) => {
    noStore(c);
    const declared = Number(c.req.header('Content-Length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_SIGN_BODY_BYTES) {
      return c.json({ error: 'Хүсэлт хэт том байна' }, 413);
    }

    let req = await requestFromToken(c.env.DB, c.req.param('token'));
    if (!req) return c.json({ error: 'Link олдсонгүй эсвэл хүчингүй байна' }, 404);
    req = await expireIfNeeded(c.env.DB, req);
    if (req.status === 'signed') return c.json({ error: 'Аль хэдийн гарын үсэг зурсан' }, 409);
    if (req.status === 'revoked' || req.status === 'expired') return c.json({ error: 'Link хүчингүй болсон' }, 410);

    const linkOwner = await requester(c.env.DB, req.requested_by);
    if (!(await requesterStillAuthorized(c.env.DB, req, linkOwner))) {
      await closeRequest(c.env.DB, req, 'revoked');
      return c.json({ error: 'Энэ link-ийн эрх хүчингүй болсон' }, 410);
    }

    const body = bodyOf<{ signature_data_url: unknown; signer_name: unknown; consent: unknown }>(
      await c.req.json().catch(() => null),
    );
    if (body.consent !== true) return c.json({ error: 'Баталгаажуулах зөвшөөрөл шаардлагатай' }, 400);
    // Нэр заавал өөрөө оруулна/батлана — staff-ийн заасан hint ганцаараа хангалтгүй.
    const signedName = cleanSigningText(body.signer_name, 160);
    if (!signedName) return c.json({ error: 'Гарын үсэг зурж буй хүний нэр шаардлагатай' }, 400);
    const parsed = parseSignatureDataUrl(body.signature_data_url);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    const signatureHash = await sha256Hex(parsed.bytes);
    const now = new Date().toISOString();
    const userAgent = (c.req.header('User-Agent') ?? '').slice(0, 500) || null;

    // Нийтлэг хоёр дахь statement: request-ийг `signed` болгоно, ГЭХДЭЭ зөвхөн
    // баримт яг энэ гарын үсгийг авсан үед (ижил batch, дараалан гүйнэ).
    const finalizeSql = (entityCheck: string) =>
      `UPDATE public_document_sign_requests
          SET status = 'signed', signed_name = ?, signature_key = ?, signature_sha256 = ?,
              signed_at = ?, signed_user_agent = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'pending' AND ${entityCheck}`;

    let signatureKey: string;
    let bucket: R2Bucket;
    let staleCorrPdf: string | null = null;
    let entityStmt: D1PreparedStatement;
    let finalizeStmt: D1PreparedStatement;

    if (req.kind === 'correspondence') {
      const row = await c.env.DB.prepare(
        'SELECT id, sign_status, client_signature_key, pdf_key FROM correspondence_log WHERE id = ?',
      )
        .bind(req.entity_id)
        .first<{ id: number; sign_status: string; client_signature_key: string | null; pdf_key: string | null }>();
      if (!row) return c.json({ error: 'Баримт олдсонгүй' }, 404);
      if (row.sign_status === 'signed' || row.client_signature_key) {
        return c.json({ error: 'Баримтад аль хэдийн гарын үсэг зурсан' }, 409);
      }
      staleCorrPdf = row.pdf_key;
      bucket = c.env.MEETING_BUCKET;
      signatureKey = clientSignatureKey(req.entity_id, Date.now(), crypto.randomUUID().replace(/-/g, '').slice(0, 10));
      entityStmt = c.env.DB.prepare(
        `UPDATE correspondence_log
            SET sign_status = 'signed', client_signature_key = ?, client_signed_at = ?,
                client_signed_by = NULL, client_signer_name = ?,
                pdf_key = NULL, pdf_generated_at = NULL, updated_at = datetime('now')
          WHERE id = ? AND sign_status <> 'signed' AND client_signature_key IS NULL
            AND EXISTS (SELECT 1 FROM public_document_sign_requests
                         WHERE id = ? AND status = 'pending' AND expires_at > ?)`,
      ).bind(signatureKey, now, signedName, req.entity_id, req.id, now);
      finalizeStmt = c.env.DB.prepare(
        finalizeSql('EXISTS (SELECT 1 FROM correspondence_log WHERE id = ? AND client_signature_key = ?)'),
      ).bind(signedName, signatureKey, signatureHash, now, userAgent, req.id, req.entity_id, signatureKey);
    } else {
      const row = await c.env.DB.prepare(
        'SELECT id, sig_arch_url, sig_site_url FROM author_supervision_reports WHERE id = ?',
      )
        .bind(req.entity_id)
        .first<{ id: number; sig_arch_url: string | null; sig_site_url: string | null }>();
      if (!row) return c.json({ error: 'Тайлан олдсонгүй' }, 404);
      const occupied = req.slot === 'arch' ? row.sig_arch_url : row.sig_site_url;
      if (occupied && occupied.trim()) {
        return c.json({ error: 'Энэ гарын үсгийн мөр аль хэдийн бөглөгдсөн' }, 409);
      }
      bucket = c.env.MEDIA_BUCKET;
      signatureKey = `public-sign-${req.id}-${crypto.randomUUID().replace(/-/g, '')}.png`;
      const url = `/media/${signatureKey}`;
      const date = todayInUB();
      const col = req.slot === 'arch' ? 'arch' : 'site';
      entityStmt = c.env.DB.prepare(
        `UPDATE author_supervision_reports
            SET sig_${col}_name = ?, sig_${col}_url = ?, sig_${col}_date = ?, updated_at = datetime('now')
          WHERE id = ? AND (sig_${col}_url IS NULL OR TRIM(sig_${col}_url) = '')
            AND EXISTS (SELECT 1 FROM public_document_sign_requests
                         WHERE id = ? AND status = 'pending' AND expires_at > ?)`,
      ).bind(signedName, url, date, req.entity_id, req.id, now);
      finalizeStmt = c.env.DB.prepare(
        finalizeSql(`EXISTS (SELECT 1 FROM author_supervision_reports WHERE id = ? AND sig_${col}_url = ?)`),
      ).bind(signedName, signatureKey, signatureHash, now, userAgent, req.id, req.entity_id, url);
    }

    await bucket.put(signatureKey, parsed.bytes, {
      httpMetadata: { contentType: 'image/png' },
      customMetadata: { publicSigningRequestId: String(req.id), kind: req.kind, entityId: String(req.entity_id) },
    });

    let results: D1Result[];
    try {
      results = await c.env.DB.batch([entityStmt, finalizeStmt]);
    } catch (err) {
      await bucket.delete(signatureKey).catch(() => undefined);
      console.error('[public-signing] sign batch failed', req.id, err);
      return c.json({ error: 'Гарын үсэг хадгалахад алдаа гарлаа. Дахин оролдоно уу.' }, 500);
    }

    if (!results[0]!.meta.changes || !results[1]!.meta.changes) {
      // Уралдаан алдсан: гарын үсгийн байтыг устгаад яг ямар шалтгаантайг тодруулна.
      await bucket.delete(signatureKey).catch(() => undefined);
      const fresh = await c.env.DB.prepare('SELECT status, expires_at FROM public_document_sign_requests WHERE id = ?')
        .bind(req.id)
        .first<{ status: PublicSigningStatus; expires_at: string }>();
      if (fresh?.status === 'revoked' || fresh?.status === 'expired' || (fresh && isExpired(fresh.expires_at))) {
        return c.json({ error: 'Link хүчингүй болсон' }, 410);
      }
      return c.json({ error: 'Энэ гарын үсгийн мөрөнд өөр хүн түрүүлж гарын үсэг зурсан' }, 409);
    }

    // Амжилттай — дараах зүйлс аль нь ч гарын үсгийг эргүүлэхгүй.
    const signedRow: RequestRow = {
      ...req,
      status: 'signed',
      signed_name: signedName,
      signature_key: signatureKey,
      signature_sha256: signatureHash,
      signed_at: now,
    };
    c.executionCtx.waitUntil(dropPreview(c.env, req.id));
    if (staleCorrPdf) {
      const key = staleCorrPdf;
      c.executionCtx.waitUntil(c.env.MEETING_BUCKET.delete(key).catch(() => undefined) as Promise<void>);
    }
    if (linkOwner && STAFF_ROLES.has(linkOwner.role)) {
      c.executionCtx.waitUntil(
        storeSignedSnapshot(c.env, io, signedRow, { sub: linkOwner.id, role: linkOwner.role }).then(() => undefined),
      );
    }
    try {
      await createNotification(
        c.env.DB,
        req.requested_by,
        'client_signed',
        'Гаднын гарын үсэг ирлээ',
        `${signedName} · ${req.role_label}`,
        req.kind === 'correspondence'
          ? `/app/projects/${req.project_id}?tab=mail`
          : `/app/asr/${req.entity_id}`,
      );
    } catch (err) {
      console.error('[public-signing] notification failed', req.id, err);
    }

    return c.json({
      ok: true,
      status: 'signed',
      signed_name: signedName,
      signed_at: now,
      role_label: req.role_label,
    });
  });

  return { publicDocumentSigning: publicRouter, signingLinks: staffRouter };
}
