/**
 * ПРОГРАМЫН ХҮСЭЛТ — `/api/engineering-feedback` (2026-10-16).
 *
 * Revit add-in-ий «Санал хүсэлт» цонх болон ERP-ийн ажилтан алдаа / сайжруулалт / асуулт илгээнэ; ЗӨВХӨН баталгаажсан
 * Software Engineer (lib/engineeringFeedbackAccess.ts) «Програмын хүсэлтүүд» inbox-оос уншиж, шийдвэрлэнэ.
 *
 * ЗАМЫН ГЭРЭЭ
 *   Илгээгч (идэвхтэй admin/engineer/architect/senior; ERP session эсвэл Revit-ийн төхөөрөмжийн session):
 *     GET    /capabilities                         өөрийн туг + хязгаар (inbox-ийн мэдээлэл БАЙХГҮЙ)
 *     POST   /drafts                               idempotent ноорог (client_request_id)
 *     GET    /drafts/:id   PATCH /drafts/:id        өөрийн ноорог
 *     POST   /drafts/:id/attachments                хавсралт НӨӨЦЛӨХ (сервер түлхүүр олгоно)
 *     PUT    /attachments/:aid/content              энгийн файл — нэг stream (≤ 25 MiB)
 *     PUT    /attachments/:aid/parts/:n             том файл (RVT/RFA/ZIP) — multipart хэсэг
 *     POST   /attachments/:aid/complete             multipart-ийг дуусгах (бүх хэсэг, хэмжээ шалгана)
 *     DELETE /attachments/:aid                      цуцлах/хасах (зөвхөн ноорог)
 *     POST   /drafts/:id/submit                     АТОМ: дугаар, status=received, зөвхөн ready хавсралт
 *     GET    /mine   GET /mine/:id                  өөрийн баримт (дотоод тэмдэглэлгүй)
 *     POST   /mine/:id/retest                        «засагдаагүй» / «ажиллаж байна» / нэмэлт мэдээлэл
 *   Reviewer (ганц баталгаажсан хүн; эрхгүй бол бүх inbox зам 404 — оршин буйг ч илчлэхгүй):
 *     GET  /inbox   GET /inbox/count   GET /inbox/export   GET /inbox/:id   POST /inbox/:id/read
 *     PATCH /inbox/:id (төлөв, ач холбогдол, давхардал — optimistic version)   POST /inbox/:id/events (тэмдэглэл/хариу)
 *     POST /inbox/:id/fixes   DELETE /inbox/:id/fixes/:fixId   GET|HEAD /inbox/:id/attachments/:aid (хувийн stream)
 *
 * ⚠️ БАЙТ нь ЗӨВХӨН `FEEDBACK_BUCKET`-д (хувийн, нийтийн домэйнгүй).  Binding байхгүй бол хавсралтын замууд 503 —
 *    MEDIA_BUCKET руу ХЭЗЭЭ Ч унагахгүй.  `/media/<key>` холбоос, presigned URL, объектын түлхүүр клиент рүү явахгүй.
 * ⚠️ D1 ба R2 нэг transaction-д БАЙХГҮЙ: хавсралт бүр төлөвтэй (reserved → uploading → ready), давтахад аюулгүй;
 *    дуусаагүй / хаягдсаныг cron-ын цэвэрлэгч (`sweepEngineeringFeedback`) устгана — ready, илгээсэн хүсэлтийн
 *    хавсралтыг ХЭЗЭЭ Ч хөндөхгүй.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';

import type { AppVariables, Env, JWTPayload } from '../types';
import { currentTenantId } from '../lib/requestContext';
import { contentDisposition } from '../lib/privateFileStream';
import {
  EF_EXTENSIONS,
  EF_LIMITS,
  EF_PRIORITIES,
  EF_STATUSES,
  EF_SOURCES,
  EF_TYPES,
  checkAttachmentSize,
  displayNumber,
  expectedPartSize,
  isClientId,
  isOpaqueId,
  isStatus,
  normalizeSha256,
  objectKeyFor,
  opaqueId,
  parseDraftFields,
  partCount,
  payloadHash,
  publicStatusLabel,
  reviewerCanMove,
  reviewerNextStatuses,
  sanitizeFileName,
  scrubDiagnostics,
  senderTransition,
  submitProblem,
  type DraftFields,
  type EfPriority,
  type EfStatus,
} from '../lib/engineeringFeedback';
import {
  boundReviewerUserId,
  resolveReviewer,
  resolveSubmitter,
  tokenKindOf,
  type EfActor,
} from '../lib/engineeringFeedbackAccess';

type Bindings = { Bindings: Env; Variables: AppVariables };
type Ctx = Context<Bindings>;

const router = new Hono<Bindings>();

router.onError((err, c) => {
  console.error('[engineering-feedback]', err);
  return c.json({ error: 'Дотоод алдаа гарлаа', code: 'INTERNAL' }, 500);
});

// Бүх JSON хариу хувийн — CDN/хөтөч кэшлэхгүй (хүсэлт бүр эрхээр ялгаатай).
router.use('*', async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'private, no-store');
});

/* ------------------------------------------------------------------ */
/*  Туслах                                                             */
/* ------------------------------------------------------------------ */

function fail(c: Ctx, status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 503, code: string, message: string, extra: Record<string, unknown> = {}) {
  return c.json({ error: message, code, ...extra }, status);
}

function bucketOf(c: Ctx): R2Bucket | null {
  const b = (c.env as Env & { FEEDBACK_BUCKET?: R2Bucket }).FEEDBACK_BUCKET;
  return b ?? null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeJson(text: string | null | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Илгээгчийн өөрийн хүсэлтийн хуудас (ERP) — мэдэгдлийн холбоос. */
const SENDER_LINK = "'/app/my-engineering-requests?id=' || er.id";

function addMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

async function readJson(c: Ctx): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function submitter(c: Ctx): Promise<EfActor | null> {
  return resolveSubmitter(c.env.DB, c.get('user') as JWTPayload | undefined);
}

async function reviewer(c: Ctx): Promise<EfActor | null> {
  return resolveReviewer(c.env.DB, c.get('user') as JWTPayload | undefined);
}

const notFound = (c: Ctx) => fail(c, 404, 'NOT_FOUND', 'Олдсонгүй');

/** Stream-ийн SHA-256: Workers-ийн `crypto.DigestStream` (бүтэн файлыг санах ойд барихгүй). */
interface StreamHasher {
  write(chunk: Uint8Array): Promise<void>;
  finish(): Promise<string>;
}

function streamHasher(): StreamHasher {
  const DS = (crypto as unknown as { DigestStream?: new (alg: string) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> } })
    .DigestStream;
  if (!DS) throw new Error('crypto.DigestStream алга');
  const ds = new DS('SHA-256');
  const w = ds.getWriter();
  return {
    write: (chunk) => w.write(chunk),
    async finish() {
      await w.close();
      const buf = await ds.digest;
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    },
  };
}

class TooLargeError extends Error {}

/** Байт тоолж, хэш бодож, хязгаараас хэтэрвэл таслах урсгал. */
function metered(body: ReadableStream<Uint8Array>, limit: number, hasher: StreamHasher): { stream: ReadableStream<Uint8Array>; seen: () => number } {
  let seen = 0;
  const t = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, ctrl) {
      seen += chunk.byteLength;
      if (seen > limit) {
        ctrl.error(new TooLargeError('limit'));
        return;
      }
      await hasher.write(chunk);
      ctrl.enqueue(chunk);
    },
  });
  return { stream: body.pipeThrough(t), seen: () => seen };
}

/** R2 нь урсгалын уртыг мэдэх ёстой — Workers-ийн `FixedLengthStream`.  Тест орчинд (Node) шууд дамжуулна. */
function knownLength(stream: ReadableStream<Uint8Array>, length: number): ReadableStream<Uint8Array> {
  const FLS = (globalThis as unknown as { FixedLengthStream?: new (n: number) => TransformStream<Uint8Array, Uint8Array> }).FixedLengthStream;
  if (!FLS) return stream;
  const fixed = new FLS(length);
  stream.pipeTo(fixed.writable).catch(() => {
    /* урт зөрвөл R2 put өөрөө алдаа буцаана */
  });
  return fixed.readable;
}

/* ------------------------------------------------------------------ */
/*  Мөр                                                                */
/* ------------------------------------------------------------------ */

interface RequestRow extends DraftFields {
  id: string;
  number: number | null;
  client_request_id: string;
  submitter_user_id: number;
  recipient_user_id: number | null;
  status: EfStatus;
  priority: EfPriority;
  duplicate_of: string | null;
  payload_hash: string | null;
  submit_attempt: string | null;
  mutation_nonce: string | null;
  reviewer_read_at: string | null;
  last_sender_activity_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  resolved_at: string | null;
}

interface AttachmentRow {
  id: string;
  request_id: string;
  owner_user_id: number;
  client_attachment_id: string;
  object_key: string;
  original_name: string;
  extension: string;
  media_type: string;
  kind: string;
  declared_size: number;
  actual_size: number | null;
  client_sha256: string | null;
  server_sha256: string | null;
  upload_mode: 'single' | 'multipart';
  r2_upload_id: string | null;
  part_size: number | null;
  state: string;
  expires_at: string;
  created_at: string;
  completed_at: string | null;
  version: number;
}

const LIVE_ATTACHMENT_STATES = ['reserved', 'uploading', 'ready'];

async function loadRequest(db: D1Database, id: string): Promise<RequestRow | null> {
  if (!isOpaqueId(id, 'efr')) return null;
  return db.prepare('SELECT * FROM engineering_requests WHERE id = ?').bind(id).first<RequestRow>();
}

async function loadAttachment(db: D1Database, aid: string): Promise<AttachmentRow | null> {
  if (!isOpaqueId(aid, 'efa')) return null;
  return db.prepare('SELECT * FROM engineering_request_attachments WHERE id = ?').bind(aid).first<AttachmentRow>();
}

async function attachmentsOf(db: D1Database, requestId: string): Promise<AttachmentRow[]> {
  const r = await db
    .prepare('SELECT * FROM engineering_request_attachments WHERE request_id = ? ORDER BY created_at, id')
    .bind(requestId)
    .all<AttachmentRow>();
  return r.results ?? [];
}

async function partsOf(db: D1Database, aid: string): Promise<Array<{ part_number: number; etag: string; size: number; sha256: string }>> {
  const r = await db
    .prepare('SELECT part_number, etag, size, sha256 FROM engineering_request_attachment_parts WHERE attachment_id = ? ORDER BY part_number')
    .bind(aid)
    .all<{ part_number: number; etag: string; size: number; sha256: string }>();
  return r.results ?? [];
}

/** Илгээгчид харагдах хавсралт: объектын түлхүүр, R2 upload id ХЭЗЭЭ Ч орохгүй. */
function shapeAttachmentOwn(a: AttachmentRow, uploadedParts: number[] = []) {
  return {
    id: a.id,
    client_attachment_id: a.client_attachment_id,
    name: a.original_name,
    kind: a.kind,
    size: a.declared_size,
    state: a.state,
    mode: a.upload_mode,
    part_size: a.upload_mode === 'multipart' ? a.part_size : null,
    part_count: a.upload_mode === 'multipart' ? partCount(a.declared_size, a.part_size ?? EF_LIMITS.partBytes) : 1,
    uploaded_parts: uploadedParts,
    expires_at: a.expires_at,
    server_sha256: a.state === 'ready' ? a.server_sha256 : null,
  };
}

function shapeOwnRequest(r: RequestRow, atts: AttachmentRow[]) {
  return {
    id: r.id,
    number: r.number,
    display_number: displayNumber(r.number),
    client_request_id: r.client_request_id,
    channel: r.channel,
    source: r.source,
    tool_id: r.tool_id,
    type: r.type,
    title: r.title,
    description: r.description,
    expected: r.expected,
    actual: r.actual,
    steps: r.steps,
    suggestion: r.suggestion,
    impact: r.impact,
    status: r.status,
    status_label: publicStatusLabel(r.status),
    version: r.version,
    created_at: r.created_at,
    submitted_at: r.submitted_at,
    updated_at: r.updated_at,
    attachments: atts.filter((a) => a.state !== 'deleted' && a.state !== 'aborted').map((a) => shapeAttachmentOwn(a)),
  };
}

/* ------------------------------------------------------------------ */
/*  Capabilities                                                       */
/* ------------------------------------------------------------------ */

router.get('/capabilities', async (c) => {
  const payload = c.get('user') as JWTPayload | undefined;
  const [sub, rev] = await Promise.all([submitter(c), reviewer(c)]);
  return c.json({
    can_submit: !!sub,
    can_review: !!rev,
    token_kind: tokenKindOf(payload),
    storage_available: !!bucketOf(c),
    limits: {
      max_attachments: EF_LIMITS.maxAttachments,
      max_total_bytes: EF_LIMITS.maxTotalBytes,
      max_ordinary_bytes: EF_LIMITS.maxOrdinaryBytes,
      part_bytes: EF_LIMITS.partBytes,
      title_max: EF_LIMITS.titleMax,
      text_max: EF_LIMITS.textMax,
      extensions: Object.fromEntries(Object.entries(EF_EXTENSIONS).map(([k, v]) => [k, { large: v.large, preview: v.preview }])),
    },
    sources: EF_SOURCES,
    types: EF_TYPES,
  });
});

/* ------------------------------------------------------------------ */
/*  Ноорог                                                             */
/* ------------------------------------------------------------------ */

const FIELD_COLUMNS: Array<keyof DraftFields> = [
  'channel',
  'source',
  'tool_id',
  'source_context',
  'type',
  'title',
  'description',
  'expected',
  'actual',
  'steps',
  'suggestion',
  'impact',
  'diagnostics_schema',
  'diagnostics_json',
  'revit_year',
  'revit_build',
  'addin_version',
  'addin_sha256',
];

function fieldValues(f: DraftFields): unknown[] {
  return FIELD_COLUMNS.map((k) => f[k]);
}

router.post('/drafts', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const body = await readJson(c);
  const crid = body.client_request_id;
  if (!isClientId(crid)) return fail(c, 400, 'BAD_CLIENT_ID', 'client_request_id буруу (8–80 тэмдэгт)');
  const db = c.env.DB;
  const existing = await db
    .prepare('SELECT * FROM engineering_requests WHERE submitter_user_id = ? AND client_request_id = ?')
    .bind(actor.userId, crid)
    .first<RequestRow>();
  if (existing) return c.json({ request: shapeOwnRequest(existing, await attachmentsOf(db, existing.id)), reused: true });

  const parsed = parseDraftFields(body, actor.tokenKind === 'revit' ? 'revit' : 'erp');
  if (!parsed.fields) return fail(c, 400, 'BAD_FIELDS', parsed.error ?? 'Талбар буруу');
  const id = opaqueId('efr');
  const now = nowIso();
  try {
    await db
      .prepare(
        `INSERT INTO engineering_requests (id, client_request_id, submitter_user_id, ${FIELD_COLUMNS.join(', ')},
           status, priority, version, created_at, updated_at, last_sender_activity_at)
         VALUES (?, ?, ?, ${FIELD_COLUMNS.map(() => '?').join(', ')}, 'draft', 'normal', 1, ?, ?, ?)`,
      )
      .bind(id, crid, actor.userId, ...fieldValues(parsed.fields), now, now, now)
      .run();
  } catch (err) {
    // Зэрэг ирсэн ижил client_request_id — ялагчийг буцаана.
    const winner = await db
      .prepare('SELECT * FROM engineering_requests WHERE submitter_user_id = ? AND client_request_id = ?')
      .bind(actor.userId, crid)
      .first<RequestRow>();
    if (winner) return c.json({ request: shapeOwnRequest(winner, await attachmentsOf(db, winner.id)), reused: true });
    throw err;
  }
  const row = await loadRequest(db, id);
  return c.json({ request: shapeOwnRequest(row!, []), reused: false }, 201);
});

async function ownRequest(c: Ctx, actor: EfActor, id: string): Promise<RequestRow | null> {
  const r = await loadRequest(c.env.DB, id);
  return r && r.submitter_user_id === actor.userId ? r : null;
}

router.get('/drafts/:id', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const r = await ownRequest(c, actor, c.req.param('id'));
  if (!r) return notFound(c);
  const atts = await attachmentsOf(c.env.DB, r.id);
  return c.json({ request: shapeOwnRequest(r, atts) });
});

router.patch('/drafts/:id', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const r = await ownRequest(c, actor, c.req.param('id'));
  if (!r) return notFound(c);
  if (r.status !== 'draft') return fail(c, 409, 'ALREADY_SUBMITTED', 'Хүсэлт аль хэдийн илгээгдсэн');
  const body = await readJson(c);
  const parsed = parseDraftFields({ ...r, diagnostics: r.diagnostics_json, ...body }, r.channel);
  if (!parsed.fields) return fail(c, 400, 'BAD_FIELDS', parsed.error ?? 'Талбар буруу');
  const version = typeof body.version === 'number' ? body.version : null;
  const res = await c.env.DB
    .prepare(
      `UPDATE engineering_requests SET ${FIELD_COLUMNS.map((k) => `${k} = ?`).join(', ')},
              updated_at = ?, version = version + 1
        WHERE id = ? AND submitter_user_id = ? AND status = 'draft' AND (? IS NULL OR version = ?)`,
    )
    .bind(...fieldValues(parsed.fields), nowIso(), r.id, actor.userId, version, version)
    .run();
  if (!res.meta.changes) {
    const cur = await loadRequest(c.env.DB, r.id);
    if (cur && cur.status !== 'draft') return fail(c, 409, 'ALREADY_SUBMITTED', 'Хүсэлт аль хэдийн илгээгдсэн');
    return fail(c, 409, 'STALE_VERSION', 'Ноорог өөр газраас өөрчлөгдсөн', { version: cur?.version ?? null });
  }
  const cur = await loadRequest(c.env.DB, r.id);
  return c.json({ request: shapeOwnRequest(cur!, await attachmentsOf(c.env.DB, r.id)) });
});

/* ------------------------------------------------------------------ */
/*  Хавсралт                                                           */
/* ------------------------------------------------------------------ */

router.post('/drafts/:id/attachments', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const r = await ownRequest(c, actor, c.req.param('id'));
  if (!r) return notFound(c);
  if (r.status !== 'draft') return fail(c, 409, 'ALREADY_SUBMITTED', 'Хүсэлт аль хэдийн илгээгдсэн');
  const bucket = bucketOf(c);
  if (!bucket) return fail(c, 503, 'STORAGE_UNAVAILABLE', 'Файлын хадгалалт тохируулагдаагүй — зөвхөн бичвэр илгээх боломжтой');
  const body = await readJson(c);
  const cid = body.client_attachment_id;
  if (!isClientId(cid)) return fail(c, 400, 'BAD_CLIENT_ID', 'client_attachment_id буруу');
  const name = sanitizeFileName(body.name);
  if (!name.ok) return fail(c, 422, 'BAD_FILE', name.error ?? 'Файл буруу');
  const size = body.size;
  const clientSha = body.sha256 === undefined || body.sha256 === null ? null : normalizeSha256(body.sha256);
  if (body.sha256 !== undefined && body.sha256 !== null && !clientSha) return fail(c, 422, 'BAD_HASH', 'sha256 буруу');
  const kind = body.kind === 'screenshot' || body.kind === 'diagnostics' ? body.kind : 'file';
  const db = c.env.DB;

  const atts = await attachmentsOf(db, r.id);
  const same = atts.find((a) => a.client_attachment_id === cid);
  if (same) {
    if (same.declared_size !== size || same.original_name !== name.name || (same.client_sha256 ?? null) !== clientSha) {
      return fail(c, 409, 'ATTACHMENT_ID_REUSED', 'Энэ хавсралтын түлхүүр өөр файлд хэрэглэгдсэн');
    }
    if (same.state === 'deleted' || same.state === 'aborted') return fail(c, 409, 'ATTACHMENT_GONE', 'Энэ хавсралт цуцлагдсан — шинэ түлхүүрээр дахин сонгоно уу');
    const parts = same.upload_mode === 'multipart' ? (await partsOf(db, same.id)).map((p) => p.part_number) : [];
    return c.json({ attachment: shapeAttachmentOwn(same, parts), reused: true });
  }
  const live = atts.filter((a) => LIVE_ATTACHMENT_STATES.includes(a.state));
  const usedBytes = live.reduce((s, a) => s + a.declared_size, 0);
  const sizeCheck = checkAttachmentSize(name.extension!, size, usedBytes, live.length);
  if (!sizeCheck.ok) return fail(c, size === undefined ? 400 : 413, 'LIMIT', sizeCheck.error ?? 'Хязгаараас хэтэрнэ');
  const spec = EF_EXTENSIONS[name.extension!]!;
  const aid = opaqueId('efa');
  const key = objectKeyFor(currentTenantId());
  const now = nowIso();
  let uploadId: string | null = null;
  if (sizeCheck.mode === 'multipart') {
    const mpu = await bucket.createMultipartUpload(key, {
      httpMetadata: { contentType: spec.mediaType },
      customMetadata: { attachment: aid, request: r.id },
    });
    uploadId = mpu.uploadId;
  }
  try {
    await db
      .prepare(
        `INSERT INTO engineering_request_attachments
           (id, request_id, owner_user_id, client_attachment_id, object_key, original_name, extension, media_type, kind,
            declared_size, client_sha256, upload_mode, r2_upload_id, part_size, state, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        aid,
        r.id,
        actor.userId,
        cid,
        key,
        name.name!,
        name.extension!,
        spec.mediaType,
        kind,
        size as number,
        clientSha,
        sizeCheck.mode!,
        uploadId,
        sizeCheck.mode === 'multipart' ? EF_LIMITS.partBytes : null,
        sizeCheck.mode === 'multipart' ? 'uploading' : 'reserved',
        addMinutes(EF_LIMITS.uploadTtlMinutes),
        now,
        now,
      )
      .run();
  } catch (err) {
    if (uploadId) {
      try {
        await bucket.resumeMultipartUpload(key, uploadId).abort();
      } catch {
        /* цэвэрлэгч R2 lifecycle-ээр */
      }
    }
    const winner = (await attachmentsOf(db, r.id)).find((a) => a.client_attachment_id === cid);
    if (winner) return c.json({ attachment: shapeAttachmentOwn(winner), reused: true });
    throw err;
  }
  const row = await loadAttachment(db, aid);
  return c.json({ attachment: shapeAttachmentOwn(row!) }, 201);
});

/** Хавсралт + түүний ноорог илгээгчийнх, ноорог хэвээр, хугацаа дуусаагүй эсэх. */
async function ownWritableAttachment(c: Ctx, actor: EfActor, aid: string): Promise<{ a: AttachmentRow; r: RequestRow } | Response> {
  const a = await loadAttachment(c.env.DB, aid);
  if (!a || a.owner_user_id !== actor.userId) return notFound(c);
  const r = await loadRequest(c.env.DB, a.request_id);
  if (!r || r.submitter_user_id !== actor.userId) return notFound(c);
  if (r.status !== 'draft') return fail(c, 409, 'ALREADY_SUBMITTED', 'Хүсэлт аль хэдийн илгээгдсэн — хавсралт өөрчлөхгүй');
  if (a.state === 'deleted' || a.state === 'aborted') return fail(c, 409, 'ATTACHMENT_GONE', 'Хавсралт цуцлагдсан');
  if (a.state !== 'ready' && a.expires_at < nowIso()) return fail(c, 410, 'UPLOAD_EXPIRED', 'Илгээх хугацаа дууссан — файлыг дахин сонгоно уу');
  return { a, r };
}

router.put('/attachments/:aid/content', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const bucket = bucketOf(c);
  if (!bucket) return fail(c, 503, 'STORAGE_UNAVAILABLE', 'Файлын хадгалалт тохируулагдаагүй');
  const got = await ownWritableAttachment(c, actor, c.req.param('aid'));
  if (got instanceof Response) return got;
  const { a } = got;
  if (a.upload_mode !== 'single') return fail(c, 409, 'WRONG_MODE', 'Энэ файл хэсэгчилж илгээгдэнэ (parts)');
  if (a.state === 'ready') return c.json({ attachment: shapeAttachmentOwn(a), reused: true });
  const lenHeader = c.req.header('content-length');
  if (lenHeader !== undefined && lenHeader !== '' && Number(lenHeader) !== a.declared_size) {
    return fail(c, 400, 'SIZE_MISMATCH', 'Файлын хэмжээ нөөцөлсөнтэй таарахгүй');
  }
  const body = c.req.raw.body;
  if (!body) return fail(c, 400, 'EMPTY_BODY', 'Файлын агуулга алга');
  const hasher = streamHasher();
  const m = metered(body, a.declared_size, hasher);
  try {
    await bucket.put(a.object_key, knownLength(m.stream, a.declared_size), {
      httpMetadata: { contentType: a.media_type },
      customMetadata: { attachment: a.id, request: a.request_id },
    });
  } catch (err) {
    if (err instanceof TooLargeError || m.seen() > a.declared_size) return fail(c, 413, 'SIZE_MISMATCH', 'Файл нөөцөлсөн хэмжээнээс том');
    console.error('[engineering-feedback] put failed', err);
    return fail(c, 400, 'UPLOAD_FAILED', 'Файл бүрэн ирсэнгүй — дахин оролдоно уу');
  }
  const sha = await hasher.finish();
  const fault = async (code: string, message: string, status: 413 | 422 | 400) => {
    try {
      await bucket.delete(a.object_key);
    } catch {
      /* цэвэрлэгч */
    }
    await c.env.DB.prepare(`UPDATE engineering_request_attachments SET updated_at = ? WHERE id = ?`).bind(nowIso(), a.id).run();
    return fail(c, status, code, message);
  };
  if (m.seen() !== a.declared_size) return fault('SIZE_MISMATCH', 'Файлын хэмжээ нөөцөлсөнтэй таарахгүй', 400);
  if (a.client_sha256 && a.client_sha256 !== sha) return fault('HASH_MISMATCH', 'Файлын хэш таарахгүй — файл замдаа өөрчлөгдсөн', 422);
  const head = await bucket.head(a.object_key);
  if (!head || head.size !== a.declared_size) return fault('VERIFY_FAILED', 'Хадгалсан файлын хэмжээ таарахгүй', 400);
  const now = nowIso();
  await c.env.DB
    .prepare(
      `UPDATE engineering_request_attachments
          SET state = 'ready', actual_size = ?, server_sha256 = ?, completed_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND state IN ('reserved')`,
    )
    .bind(head.size, sha, now, now, a.id)
    .run();
  const cur = await loadAttachment(c.env.DB, a.id);
  return c.json({ attachment: shapeAttachmentOwn(cur!) });
});

router.put('/attachments/:aid/parts/:n', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const bucket = bucketOf(c);
  if (!bucket) return fail(c, 503, 'STORAGE_UNAVAILABLE', 'Файлын хадгалалт тохируулагдаагүй');
  const got = await ownWritableAttachment(c, actor, c.req.param('aid'));
  if (got instanceof Response) return got;
  const { a } = got;
  if (a.upload_mode !== 'multipart' || !a.r2_upload_id) return fail(c, 409, 'WRONG_MODE', 'Энэ файл нэг удаагийн илгээлтээр (content)');
  if (a.state !== 'uploading') return fail(c, 409, 'NOT_UPLOADING', 'Хавсралт хэсэг хүлээн авахгүй төлөвт байна');
  const n = Number(c.req.param('n'));
  const expected = expectedPartSize(a.declared_size, n, a.part_size ?? EF_LIMITS.partBytes);
  if (expected === null) return fail(c, 400, 'BAD_PART', 'Хэсгийн дугаар буруу');
  const lenHeader = c.req.header('content-length');
  if (lenHeader !== undefined && lenHeader !== '' && Number(lenHeader) !== expected) return fail(c, 400, 'SIZE_MISMATCH', `Хэсгийн хэмжээ ${expected} байт байх ёстой`);
  const wantSha = c.req.query('sha256');
  const clientPartSha = wantSha ? normalizeSha256(wantSha) : null;
  if (wantSha && !clientPartSha) return fail(c, 422, 'BAD_HASH', 'sha256 буруу');
  const body = c.req.raw.body;
  if (!body) return fail(c, 400, 'EMPTY_BODY', 'Хэсгийн агуулга алга');
  const hasher = streamHasher();
  const m = metered(body, expected, hasher);
  let etag: string;
  try {
    const up = bucket.resumeMultipartUpload(a.object_key, a.r2_upload_id);
    const part = await up.uploadPart(n, knownLength(m.stream, expected));
    etag = part.etag;
  } catch (err) {
    if (err instanceof TooLargeError || m.seen() > expected) return fail(c, 413, 'SIZE_MISMATCH', 'Хэсэг хэт том');
    console.error('[engineering-feedback] part failed', err);
    return fail(c, 400, 'UPLOAD_FAILED', 'Хэсэг бүрэн ирсэнгүй — дахин оролдоно уу');
  }
  const sha = await hasher.finish();
  if (m.seen() !== expected) return fail(c, 400, 'SIZE_MISMATCH', `Хэсгийн хэмжээ ${expected} байт байх ёстой`);
  if (clientPartSha && clientPartSha !== sha) return fail(c, 422, 'HASH_MISMATCH', 'Хэсгийн хэш таарахгүй');
  await c.env.DB
    .prepare(
      `INSERT INTO engineering_request_attachment_parts (attachment_id, part_number, etag, size, sha256, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(attachment_id, part_number) DO UPDATE SET etag = excluded.etag, size = excluded.size,
              sha256 = excluded.sha256, uploaded_at = excluded.uploaded_at`,
    )
    .bind(a.id, n, etag, expected, sha, nowIso())
    .run();
  const parts = (await partsOf(c.env.DB, a.id)).map((p) => p.part_number);
  return c.json({ part_number: n, size: expected, sha256: sha, uploaded_parts: parts });
});

router.post('/attachments/:aid/complete', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const bucket = bucketOf(c);
  if (!bucket) return fail(c, 503, 'STORAGE_UNAVAILABLE', 'Файлын хадгалалт тохируулагдаагүй');
  const got = await ownWritableAttachment(c, actor, c.req.param('aid'));
  if (got instanceof Response) return got;
  const { a } = got;
  if (a.state === 'ready') return c.json({ attachment: shapeAttachmentOwn(a), reused: true });
  if (a.upload_mode !== 'multipart' || !a.r2_upload_id) return fail(c, 409, 'NOT_UPLOADED', 'Файл хараахан илгээгдээгүй');
  const ps = a.part_size ?? EF_LIMITS.partBytes;
  const total = partCount(a.declared_size, ps);
  const parts = await partsOf(c.env.DB, a.id);
  const byNo = new Map(parts.map((p) => [p.part_number, p]));
  const missing: number[] = [];
  for (let i = 1; i <= total; i++) {
    const p = byNo.get(i);
    if (!p || p.size !== expectedPartSize(a.declared_size, i, ps)) missing.push(i);
  }
  if (missing.length) return fail(c, 409, 'PARTS_MISSING', 'Зарим хэсэг дутуу', { missing });
  try {
    await bucket.resumeMultipartUpload(a.object_key, a.r2_upload_id).complete(
      parts.filter((p) => p.part_number <= total).map((p) => ({ partNumber: p.part_number, etag: p.etag })),
    );
  } catch (err) {
    // Timeout-ийн дараах давталт: R2 аль хэдийн дуусгасан байж болно — объект байгаа эсэхээр шийднэ.
    const h = await bucket.head(a.object_key);
    if (!h || h.size !== a.declared_size) {
      console.error('[engineering-feedback] complete failed', err);
      return fail(c, 400, 'COMPLETE_FAILED', 'Файлыг нэгтгэж чадсангүй — хэсгүүдийг дахин илгээнэ үү');
    }
  }
  const head = await bucket.head(a.object_key);
  if (!head || head.size !== a.declared_size) return fail(c, 400, 'VERIFY_FAILED', 'Хадгалсан файлын хэмжээ таарахгүй');
  const now = nowIso();
  await c.env.DB
    .prepare(
      `UPDATE engineering_request_attachments
          SET state = 'ready', actual_size = ?, completed_at = ?, updated_at = ?, version = version + 1
        WHERE id = ? AND state = 'uploading'`,
    )
    .bind(head.size, now, now, a.id)
    .run();
  const cur = await loadAttachment(c.env.DB, a.id);
  return c.json({ attachment: shapeAttachmentOwn(cur!) });
});

router.delete('/attachments/:aid', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const a = await loadAttachment(c.env.DB, c.req.param('aid'));
  if (!a || a.owner_user_id !== actor.userId) return notFound(c);
  const r = await loadRequest(c.env.DB, a.request_id);
  if (!r || r.submitter_user_id !== actor.userId) return notFound(c);
  if (r.status !== 'draft') return fail(c, 409, 'ALREADY_SUBMITTED', 'Илгээсэн хүсэлтийн хавсралтыг хасахгүй');
  if (a.state === 'deleted' || a.state === 'aborted') return c.json({ ok: true });
  // Төлөвийг эхэлж — байт устгал унавал цэвэрлэгч хийнэ (aborted нь хэзээ ч ready болохгүй).
  await c.env.DB
    .prepare(`UPDATE engineering_request_attachments SET state = 'aborted', updated_at = ?, version = version + 1 WHERE id = ? AND state <> 'deleted'`)
    .bind(nowIso(), a.id)
    .run();
  const bucket = bucketOf(c);
  if (bucket) {
    try {
      if (a.upload_mode === 'multipart' && a.r2_upload_id && a.state === 'uploading') {
        await bucket.resumeMultipartUpload(a.object_key, a.r2_upload_id).abort();
      }
      await bucket.delete(a.object_key);
      await c.env.DB.prepare(`UPDATE engineering_request_attachments SET state = 'deleted', updated_at = ? WHERE id = ?`).bind(nowIso(), a.id).run();
    } catch {
      /* cron цэвэрлэгч дахин оролдоно */
    }
  }
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Submit (атом)                                                      */
/* ------------------------------------------------------------------ */

function receipt(r: RequestRow, atts: AttachmentRow[]) {
  return {
    id: r.id,
    number: r.number,
    display_number: displayNumber(r.number),
    status: r.status,
    status_label: publicStatusLabel(r.status),
    title: r.title,
    type: r.type,
    source: r.source,
    submitted_at: r.submitted_at,
    attachments: atts.filter((a) => a.state === 'ready').map((a) => ({ id: a.id, name: a.original_name, size: a.declared_size })),
  };
}

router.post('/drafts/:id/submit', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const db = c.env.DB;
  const r = await ownRequest(c, actor, c.req.param('id'));
  if (!r) return notFound(c);
  const body = await readJson(c);
  const listedRaw = Array.isArray(body.attachment_ids) ? body.attachment_ids : [];
  if (listedRaw.length > EF_LIMITS.maxAttachments || !listedRaw.every((x) => isOpaqueId(x, 'efa'))) {
    return fail(c, 400, 'BAD_ATTACHMENTS', 'attachment_ids буруу');
  }
  const listed = [...new Set(listedRaw as string[])];
  const hasFields = typeof body.title === 'string' || typeof body.description === 'string' || typeof body.type === 'string';
  const parsed = hasFields ? parseDraftFields({ ...r, diagnostics: r.diagnostics_json, ...body }, r.channel) : { fields: r as DraftFields };
  if (!parsed.fields) return fail(c, 400, 'BAD_FIELDS', parsed.error ?? 'Талбар буруу');
  const fields = parsed.fields;
  const hash = await payloadHash(fields, listed);
  let atts = await attachmentsOf(db, r.id);

  // Аль хэдийн илгээгдсэн (timeout-ийн дараах давталт, давхар товшилт, хоёр Revit).
  if (r.status !== 'draft') {
    if (r.payload_hash === hash) return c.json({ receipt: receipt(r, atts), already_submitted: true });
    return fail(c, 409, 'IDEMPOTENCY_CONFLICT', 'Энэ хүсэлт өөр агуулгаар аль хэдийн илгээгдсэн', { receipt: receipt(r, atts) });
  }
  const problem = submitProblem(fields);
  if (problem) return fail(c, 422, 'INCOMPLETE', problem);
  for (const id of listed) {
    const a = atts.find((x) => x.id === id);
    if (!a) return fail(c, 400, 'BAD_ATTACHMENTS', 'Хавсралт энэ хүсэлтийнх биш');
    if (a.state !== 'ready') return fail(c, 409, 'ATTACHMENTS_PENDING', 'Хавсралт бүрэн илгээгдээгүй', { attachment_id: id, state: a.state });
  }
  const recipient = await boundReviewerUserId(db);
  const now = nowIso();
  let myNonce = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const nonce = opaqueId('efr');
    myNonce = nonce;
    const guard = `EXISTS (SELECT 1 FROM engineering_requests WHERE id = ? AND submit_attempt = ?)`;
    const notListed = listed.length ? `AND id NOT IN (${listed.map(() => '?').join(', ')})` : '';
    try {
      await db.batch([
        db
          .prepare(
            `UPDATE engineering_requests
                SET ${FIELD_COLUMNS.map((k) => `${k} = ?`).join(', ')},
                    status = 'received',
                    number = (SELECT COALESCE(MAX(number), 0) + 1 FROM engineering_requests),
                    recipient_user_id = ?, payload_hash = ?, submit_attempt = ?, submitted_at = ?,
                    last_sender_activity_at = ?, updated_at = ?, version = version + 1
              WHERE id = ? AND submitter_user_id = ? AND status = 'draft'`,
          )
          .bind(...fieldValues(fields), recipient, hash, nonce, now, now, now, r.id, actor.userId),
        db
          .prepare(
            `UPDATE engineering_request_attachments SET state = 'aborted', updated_at = ?
              WHERE request_id = ? AND state IN ('reserved', 'uploading', 'ready', 'failed') ${notListed} AND ${guard}`,
          )
          .bind(now, r.id, ...listed, r.id, nonce),
        db
          .prepare(
            `INSERT INTO engineering_request_events (request_id, actor_user_id, actor_role, kind, visibility, to_value, created_at)
             SELECT ?, ?, 'sender', 'submitted', 'sender', 'received', ? WHERE ${guard}`,
          )
          .bind(r.id, actor.userId, now, r.id, nonce),
        db
          .prepare(
            `INSERT INTO notifications (user_id, type, title, body, link)
             SELECT ?, 'engineering_request_new', 'Шинэ програмын хүсэлт ПХ-' || printf('%04d', er.number),
                    substr(er.title, 1, 140), '/app/engineering-requests?id=' || er.id
               FROM engineering_requests er
              WHERE ? IS NOT NULL AND er.id = ? AND er.submit_attempt = ?`,
          )
          .bind(recipient, recipient, r.id, nonce),
      ]);
    } catch (err) {
      // UNIQUE(number) мөргөлдөөн (өөр хүсэлт яг тэр агшинд) — дахин.
      if (attempt < 2 && /UNIQUE|constraint/i.test(String((err as Error)?.message ?? err))) continue;
      throw err;
    }
    break;
  }
  const cur = await loadRequest(db, r.id);
  atts = await attachmentsOf(db, r.id);
  if (!cur || cur.status === 'draft') return fail(c, 409, 'SUBMIT_FAILED', 'Илгээж чадсангүй — дахин оролдоно уу');
  if (cur.payload_hash !== hash) return fail(c, 409, 'IDEMPOTENCY_CONFLICT', 'Энэ хүсэлт өөр агуулгаар аль хэдийн илгээгдсэн', { receipt: receipt(cur, atts) });
  // Зэрэг ирсэн ижил submit-ийн нөгөө нь ялсан бол (давхар товшилт, хоёр Revit) — idempotent давталт.
  if (cur.submit_attempt !== myNonce) return c.json({ receipt: receipt(cur, atts), already_submitted: true });
  return c.json({ receipt: receipt(cur, atts), already_submitted: false }, 201);
});

/* ------------------------------------------------------------------ */
/*  Илгээгчийн баримт, retest                                          */
/* ------------------------------------------------------------------ */

interface EventRow {
  id: number;
  request_id: string;
  actor_user_id: number | null;
  actor_role: string;
  kind: string;
  visibility: string;
  from_value: string | null;
  to_value: string | null;
  body: string | null;
  meta_json: string | null;
  created_at: string;
}

/** Илгээгчид харагдах түүх: зөвхөн visibility='sender', төлөвийг нийтийн нэрээр, commit/PR-гүй. */
function shapeEventForSender(e: EventRow) {
  const statusLabel = (v: string | null) => (v && isStatus(v) ? publicStatusLabel(v) : null);
  let year: number | null = null;
  if (e.kind === 'release' && e.meta_json) {
    try {
      const m = JSON.parse(e.meta_json) as { revit_year?: unknown };
      year = typeof m.revit_year === 'number' ? m.revit_year : null;
    } catch {
      year = null;
    }
  }
  return {
    id: e.id,
    kind: e.kind,
    by: e.actor_role === 'reviewer' ? 'reviewer' : e.actor_role === 'system' ? 'system' : 'sender',
    status: ['status', 'submitted', 'retest', 'duplicate', 'reopen'].includes(e.kind) ? statusLabel(e.to_value) : null,
    body: e.kind === 'reply' || e.kind === 'retest' ? e.body : null,
    fixed_version: e.kind === 'release' ? e.to_value : null,
    revit_year: year,
    created_at: e.created_at,
  };
}

router.get('/mine', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const rows = await c.env.DB
    .prepare(
      `SELECT id, number, title, type, source, tool_id, status, created_at, submitted_at, updated_at
         FROM engineering_requests WHERE submitter_user_id = ? ORDER BY COALESCE(submitted_at, created_at) DESC LIMIT 100`,
    )
    .bind(actor.userId)
    .all<Pick<RequestRow, 'id' | 'number' | 'title' | 'type' | 'source' | 'tool_id' | 'status' | 'created_at' | 'submitted_at' | 'updated_at'>>();
  return c.json({
    items: (rows.results ?? []).map((r) => ({
      ...r,
      display_number: displayNumber(r.number),
      status_label: publicStatusLabel(r.status),
      can_retest: r.status === 'ready_for_retest' || r.status === 'resolved',
    })),
  });
});

router.get('/mine/:id', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const r = await ownRequest(c, actor, c.req.param('id'));
  if (!r) return notFound(c);
  const db = c.env.DB;
  const [atts, ev] = await Promise.all([
    attachmentsOf(db, r.id),
    db
      .prepare(`SELECT * FROM engineering_request_events WHERE request_id = ? AND visibility = 'sender' ORDER BY id`)
      .bind(r.id)
      .all<EventRow>(),
  ]);
  return c.json({
    request: shapeOwnRequest(r, atts),
    events: (ev.results ?? []).map(shapeEventForSender),
    can_retest: r.status === 'ready_for_retest' || r.status === 'resolved',
    can_reply: r.status === 'awaiting_info',
  });
});

router.post('/mine/:id/retest', async (c) => {
  const actor = await submitter(c);
  if (!actor) return fail(c, 403, 'FORBIDDEN', 'Хүсэлт илгээх эрхгүй байна');
  const r = await ownRequest(c, actor, c.req.param('id'));
  if (!r) return notFound(c);
  const body = await readJson(c);
  const action = body.action;
  if (action !== 'still_broken' && action !== 'works' && action !== 'info') return fail(c, 400, 'BAD_ACTION', 'action буруу');
  const clientEventId = body.client_event_id;
  if (clientEventId !== undefined && !isClientId(clientEventId)) return fail(c, 400, 'BAD_CLIENT_ID', 'client_event_id буруу');
  const db = c.env.DB;
  if (typeof clientEventId === 'string') {
    const dup = await db
      .prepare(`SELECT id FROM engineering_request_events WHERE request_id = ? AND kind = 'retest' AND json_extract(meta_json, '$.client_event_id') = ?`)
      .bind(r.id, clientEventId)
      .first<{ id: number }>();
    if (dup) return c.json({ status: r.status, status_label: publicStatusLabel(r.status), reused: true });
  }
  const next = senderTransition(r.status, action);
  if (!next) return fail(c, 409, 'INVALID_STATE', 'Энэ төлөвт энэ үйлдэл хийгдэхгүй', { status: r.status });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, EF_LIMITS.textMax) : '';
  if (action === 'info' && !note) return fail(c, 422, 'NOTE_REQUIRED', 'Нэмэлт мэдээллээ бичнэ үү');
  const diag = scrubDiagnostics(body.diagnostics ?? null);
  const meta = JSON.stringify({ action, client_event_id: clientEventId ?? null, diagnostics: diag ? JSON.parse(diag) : null });
  const now = nowIso();
  const nonce = opaqueId('efr');
  const recipient = await boundReviewerUserId(db);
  const res = await db.batch([
    db
      .prepare(
        `UPDATE engineering_requests SET status = ?, last_sender_activity_at = ?, updated_at = ?, version = version + 1,
                mutation_nonce = ?,
                resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
                duplicate_of = CASE WHEN ? = 'reopened' THEN NULL ELSE duplicate_of END
          WHERE id = ? AND submitter_user_id = ? AND status = ?`,
      )
      .bind(next, now, now, nonce, next, now, next, r.id, actor.userId, r.status),
    db
      .prepare(
        `INSERT INTO engineering_request_events (request_id, actor_user_id, actor_role, kind, visibility, from_value, to_value, body, meta_json, created_at)
         SELECT ?, ?, 'sender', 'retest', 'sender', ?, ?, ?, ?, ? WHERE EXISTS
           (SELECT 1 FROM engineering_requests WHERE id = ? AND mutation_nonce = ?)`,
      )
      .bind(r.id, actor.userId, r.status, next, note || null, meta, now, r.id, nonce),
    db
      .prepare(
        `INSERT INTO notifications (user_id, type, title, body, link)
         SELECT ?, 'engineering_request_activity', 'ПХ-' || printf('%04d', er.number) || ': ' || ?, NULL,
                '/app/engineering-requests?id=' || er.id
           FROM engineering_requests er
          WHERE ? IS NOT NULL AND er.id = ? AND er.mutation_nonce = ?`,
      )
      .bind(
        recipient,
        action === 'works' ? 'илгээгч засварыг баталлаа' : action === 'still_broken' ? 'илгээгч «засагдаагүй» гэв' : 'илгээгч мэдээлэл нэмэв',
        recipient,
        r.id,
        nonce,
      ),
  ]);
  if (!res[0]?.meta?.changes) return fail(c, 409, 'STALE', 'Төлөв өөрчлөгдсөн — хуудсаа шинэчилнэ үү');
  return c.json({ status: next, status_label: publicStatusLabel(next) });
});

/* ------------------------------------------------------------------ */
/*  Reviewer inbox                                                     */
/* ------------------------------------------------------------------ */

const OPEN_STATUSES: EfStatus[] = ['received', 'triaged', 'in_progress', 'awaiting_info', 'ready_for_retest', 'reopened'];
const UNREAD_SQL = `(er.reviewer_read_at IS NULL OR er.reviewer_read_at < er.last_sender_activity_at)`;

interface InboxFilter {
  where: string;
  binds: unknown[];
}

function inboxFilter(q: Record<string, string | undefined>): InboxFilter | { error: string } {
  const where: string[] = [`er.status <> 'draft'`];
  const binds: unknown[] = [];
  const list = (v: string | undefined, allowed: readonly string[]) => {
    if (!v) return null;
    const items = v.split(',').map((s) => s.trim()).filter(Boolean);
    if (!items.length || items.length > 20 || !items.every((s) => allowed.includes(s))) return 'bad';
    return items;
  };
  const status = q.status === 'open' ? OPEN_STATUSES : list(q.status, EF_STATUSES.filter((s) => s !== 'draft'));
  if (status === 'bad') return { error: 'status буруу' };
  if (status) {
    where.push(`er.status IN (${status.map(() => '?').join(', ')})`);
    binds.push(...status);
  }
  for (const [key, allowed] of [
    ['type', EF_TYPES],
    ['source', EF_SOURCES],
    ['priority', EF_PRIORITIES],
  ] as const) {
    const v = list(q[key], allowed);
    if (v === 'bad') return { error: `${key} буруу` };
    if (v) {
      where.push(`er.${key} IN (${v.map(() => '?').join(', ')})`);
      binds.push(...v);
    }
  }
  if (q.revit_year) {
    const y = Number(q.revit_year);
    if (!Number.isSafeInteger(y) || y < 2020 || y > 2040) return { error: 'revit_year буруу' };
    where.push('er.revit_year = ?');
    binds.push(y);
  }
  const prefix = (col: string, v: string | undefined, max: number) => {
    if (!v) return true;
    if (v.length > max) return false;
    where.push(`instr(lower(${col}), lower(?)) = 1`);
    binds.push(v);
    return true;
  };
  if (!prefix('er.revit_build', q.revit_build, 64)) return { error: 'revit_build буруу' };
  if (!prefix('er.addin_version', q.addin_version, 40)) return { error: 'addin_version буруу' };
  if (!prefix('er.addin_sha256', q.addin_sha256, 64)) return { error: 'addin_sha256 буруу' };
  if (q.tool_id) {
    if (q.tool_id.length > 80) return { error: 'tool_id буруу' };
    where.push('er.tool_id = ?');
    binds.push(q.tool_id);
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (q.from) {
    if (!dateRe.test(q.from)) return { error: 'from буруу' };
    where.push('substr(er.submitted_at, 1, 10) >= ?');
    binds.push(q.from);
  }
  if (q.to) {
    if (!dateRe.test(q.to)) return { error: 'to буруу' };
    where.push('substr(er.submitted_at, 1, 10) <= ?');
    binds.push(q.to);
  }
  if (q.unread === '1') where.push(UNREAD_SQL);
  if (q.q) {
    const s = q.q.trim().slice(0, 100);
    if (s) {
      const n = /^(?:пх-?)?0*(\d{1,7})$/i.exec(s);
      where.push(
        `(instr(lower(er.title), lower(?)) > 0 OR instr(lower(er.description), lower(?)) > 0 OR instr(lower(COALESCE(er.tool_id, '')), lower(?)) > 0${
          n ? ' OR er.number = ?' : ''
        })`,
      );
      binds.push(s, s, s);
      if (n) binds.push(Number(n[1]));
    }
  }
  return { where: where.join(' AND '), binds };
}

const INBOX_COLUMNS = `er.id, er.number, er.title, er.type, er.source, er.tool_id, er.channel, er.status, er.priority,
  er.revit_year, er.revit_build, er.addin_version, er.addin_sha256, er.duplicate_of, er.submitted_at, er.updated_at,
  er.submitter_user_id, u.full_name AS submitter_name, u.username AS submitter_username, ${UNREAD_SQL} AS unread,
  (SELECT COUNT(*) FROM engineering_request_attachments a WHERE a.request_id = er.id AND a.state = 'ready') AS attachment_count`;

router.get('/inbox', async (c) => {
  if (!(await reviewer(c))) return notFound(c);
  const q = c.req.query();
  const f = inboxFilter(q);
  if ('error' in f) return fail(c, 400, 'BAD_FILTER', f.error);
  const pageSize = Math.min(100, Math.max(1, Number(q.page_size) || 25));
  const page = Math.max(1, Math.min(10000, Number(q.page) || 1));
  const db = c.env.DB;
  const [rows, total] = await Promise.all([
    db
      .prepare(
        `SELECT ${INBOX_COLUMNS} FROM engineering_requests er LEFT JOIN users u ON u.id = er.submitter_user_id
          WHERE ${f.where} ORDER BY er.submitted_at DESC, er.number DESC LIMIT ? OFFSET ?`,
      )
      .bind(...f.binds, pageSize, (page - 1) * pageSize)
      .all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) AS n FROM engineering_requests er WHERE ${f.where}`).bind(...f.binds).first<{ n: number }>(),
  ]);
  return c.json({
    items: (rows.results ?? []).map((r) => ({ ...r, unread: !!r.unread, display_number: displayNumber(r.number as number) })),
    total: total?.n ?? 0,
    page,
    page_size: pageSize,
  });
});

router.get('/inbox/count', async (c) => {
  if (!(await reviewer(c))) return notFound(c);
  const row = await c.env.DB
    .prepare(
      `SELECT SUM(CASE WHEN ${UNREAD_SQL} THEN 1 ELSE 0 END) AS unread,
              SUM(CASE WHEN er.status IN (${OPEN_STATUSES.map(() => '?').join(', ')}) THEN 1 ELSE 0 END) AS open
         FROM engineering_requests er WHERE er.status <> 'draft'`,
    )
    .bind(...OPEN_STATUSES)
    .first<{ unread: number | null; open: number | null }>();
  return c.json({ unread: row?.unread ?? 0, open: row?.open ?? 0 });
});

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Excel-ийн томьёо гүйцэтгэхээс (CSV injection) сэргийлнэ.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

router.get('/inbox/export', async (c) => {
  if (!(await reviewer(c))) return notFound(c);
  const f = inboxFilter(c.req.query());
  if ('error' in f) return fail(c, 400, 'BAD_FILTER', f.error);
  const rows = await c.env.DB
    .prepare(
      `SELECT ${INBOX_COLUMNS} FROM engineering_requests er LEFT JOIN users u ON u.id = er.submitter_user_id
        WHERE ${f.where} ORDER BY er.submitted_at DESC LIMIT 5000`,
    )
    .bind(...f.binds)
    .all<Record<string, unknown>>();
  const head = ['Дугаар', 'Илгээсэн', 'Төлөв', 'Ач холбогдол', 'Төрөл', 'Эх сурвалж', 'Хэрэгсэл', 'Гарчиг', 'Илгээгч', 'Revit он', 'Revit build', 'Add-in', 'Add-in SHA256', 'Хавсралт'];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows.results ?? []) {
    lines.push(
      [
        displayNumber(r.number as number),
        r.submitted_at,
        r.status,
        r.priority,
        r.type,
        r.source,
        r.tool_id,
        r.title,
        r.submitter_name ?? r.submitter_username,
        r.revit_year,
        r.revit_build,
        r.addin_version,
        r.addin_sha256,
        r.attachment_count,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(`engineering-requests-${stamp}.csv`),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

function shapeAttachmentForReviewer(a: AttachmentRow) {
  const spec = EF_EXTENSIONS[a.extension];
  return {
    id: a.id,
    name: a.original_name,
    extension: a.extension,
    kind: a.kind,
    size: a.actual_size ?? a.declared_size,
    preview: spec?.preview ?? null,
    integrity:
      a.upload_mode === 'single'
        ? { mode: 'server_sha256', server_sha256: a.server_sha256, client_sha256: a.client_sha256 }
        : { mode: 'multipart_parts_server_sha256', client_sha256_reported: a.client_sha256 },
    completed_at: a.completed_at,
  };
}

router.get('/inbox/:id', async (c) => {
  if (!(await reviewer(c))) return notFound(c);
  const db = c.env.DB;
  const r = await loadRequest(db, c.req.param('id'));
  if (!r || r.status === 'draft') return notFound(c);
  const [atts, ev, fixes, dups, submitterRow, target, related] = await Promise.all([
    attachmentsOf(db, r.id),
    db.prepare(`SELECT * FROM engineering_request_events WHERE request_id = ? ORDER BY id`).bind(r.id).all<EventRow>(),
    db
      .prepare(
        `SELECT id, revit_year, fixed_version, commit_sha, pr_url, note, linked_by, linked_at FROM engineering_request_fixes
          WHERE request_id = ? AND removed_at IS NULL ORDER BY linked_at`,
      )
      .bind(r.id)
      .all(),
    db
      .prepare(`SELECT id, number, title, status, revit_year FROM engineering_requests WHERE duplicate_of = ? ORDER BY number`)
      .bind(r.id)
      .all<{ id: string; number: number; title: string; status: string; revit_year: number | null }>(),
    db.prepare(`SELECT id, full_name, username, role, employee_id FROM users WHERE id = ?`).bind(r.submitter_user_id).first(),
    r.duplicate_of
      ? db.prepare(`SELECT id, number, title, status FROM engineering_requests WHERE id = ?`).bind(r.duplicate_of).first<{ id: string; number: number; title: string; status: string }>()
      : Promise.resolve(null),
    r.tool_id
      ? db
          .prepare(
            `SELECT id, number, title, status, revit_year, revit_build, addin_version FROM engineering_requests
              WHERE tool_id = ? AND id <> ? AND status <> 'draft' ORDER BY submitted_at DESC LIMIT 10`,
          )
          .bind(r.tool_id, r.id)
          .all<{ id: string; number: number; title: string; status: string; revit_year: number | null; revit_build: string | null; addin_version: string | null }>()
      : Promise.resolve({ results: [] as Array<{ id: string; number: number; title: string; status: string; revit_year: number | null; revit_build: string | null; addin_version: string | null }> }),
  ]);
  const diagnostics = safeJson(r.diagnostics_json);
  return c.json({
    request: {
      ...r,
      submit_attempt: undefined,
      mutation_nonce: undefined,
      payload_hash: undefined,
      diagnostics_json: undefined,
      diagnostics,
      display_number: displayNumber(r.number),
      unread: !r.reviewer_read_at || (!!r.last_sender_activity_at && r.reviewer_read_at < r.last_sender_activity_at),
      next_statuses: reviewerNextStatuses(r.status),
    },
    submitter: submitterRow,
    attachments: atts.filter((a) => a.state === 'ready').map(shapeAttachmentForReviewer),
    events: (ev.results ?? []).map((e) => ({
      ...e,
      meta: safeJson(e.meta_json),
      meta_json: undefined,
    })),
    fixes: fixes.results ?? [],
    duplicates: (dups.results ?? []).map((d) => ({ ...d, display_number: displayNumber(d.number) })),
    duplicate_of: target ? { ...target, display_number: displayNumber(target.number) } : null,
    related: (related.results ?? []).map((x) => ({ ...x, display_number: displayNumber(x.number) })),
  });
});

router.post('/inbox/:id/read', async (c) => {
  if (!(await reviewer(c))) return notFound(c);
  const r = await loadRequest(c.env.DB, c.req.param('id'));
  if (!r || r.status === 'draft') return notFound(c);
  await c.env.DB.prepare(`UPDATE engineering_requests SET reviewer_read_at = ? WHERE id = ?`).bind(nowIso(), r.id).run();
  return c.json({ ok: true });
});

async function duplicateProblem(db: D1Database, id: string, target: unknown): Promise<string | null> {
  if (!isOpaqueId(target, 'efr')) return 'Давхардлын хүсэлт буруу';
  if (target === id) return 'Хүсэлт өөрийгөө давхардуулж болохгүй';
  let cur: string | null = target;
  for (let hop = 0; hop < 25 && cur; hop++) {
    const row: { id: string; status: string; duplicate_of: string | null } | null = await db
      .prepare(`SELECT id, status, duplicate_of FROM engineering_requests WHERE id = ?`)
      .bind(cur)
      .first();
    if (!row) return hop === 0 ? 'Давхардлын хүсэлт олдсонгүй' : null;
    if (hop === 0 && row.status === 'draft') return 'Давхардлын хүсэлт олдсонгүй';
    if (row.duplicate_of === id) return 'Давхардлын холбоо тойрог үүсгэнэ';
    cur = row.duplicate_of;
  }
  return null;
}

router.patch('/inbox/:id', async (c) => {
  const rev = await reviewer(c);
  if (!rev) return notFound(c);
  const db = c.env.DB;
  const r = await loadRequest(db, c.req.param('id'));
  if (!r || r.status === 'draft') return notFound(c);
  const body = await readJson(c);
  const version = body.version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) return fail(c, 400, 'VERSION_REQUIRED', 'version шаардлагатай');
  let status: EfStatus = r.status;
  let priority: EfPriority = r.priority;
  let duplicateOf: string | null = r.duplicate_of;
  if (body.status !== undefined) {
    if (!isStatus(body.status) || !reviewerCanMove(r.status, body.status)) {
      return fail(c, 409, 'INVALID_TRANSITION', 'Энэ төлөв рүү шилжих боломжгүй', { from: r.status, allowed: reviewerNextStatuses(r.status) });
    }
    status = body.status;
  }
  if (body.priority !== undefined) {
    if (typeof body.priority !== 'string' || !(EF_PRIORITIES as readonly string[]).includes(body.priority)) return fail(c, 400, 'BAD_PRIORITY', 'Ач холбогдол буруу');
    priority = body.priority as EfPriority;
  }
  if (status === 'duplicate' && r.status !== 'duplicate') {
    const problem = await duplicateProblem(db, r.id, body.duplicate_of);
    if (problem) return fail(c, 422, 'BAD_DUPLICATE', problem);
    duplicateOf = body.duplicate_of as string;
  } else if (body.duplicate_of !== undefined && status !== 'duplicate') {
    return fail(c, 422, 'BAD_DUPLICATE', 'Давхардлыг зөвхөн «duplicate» төлөвтэй хамт');
  }
  if (status === 'reopened') duplicateOf = null;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, EF_LIMITS.textMax) : '';
  const reply = typeof body.reply === 'string' ? body.reply.trim().slice(0, EF_LIMITS.textMax) : '';
  if (status === r.status && priority === r.priority && !note && !reply) return c.json({ ok: true, version: r.version, unchanged: true });
  const now = nowIso();
  const nonce = opaqueId('efr');
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE engineering_requests SET status = ?, priority = ?, duplicate_of = ?, updated_at = ?, version = version + 1,
                mutation_nonce = ?,
                resolved_at = CASE WHEN ? = 'resolved' THEN COALESCE(resolved_at, ?) WHEN ? = 'reopened' THEN NULL ELSE resolved_at END
          WHERE id = ? AND version = ?`,
      )
      .bind(status, priority, duplicateOf, now, nonce, status, now, status, r.id, version),
  ];
  // Дагалдах мөрүүд ЗӨВХӨН энэ засвар ялсан үед (хуучин таб, давхар товшилт түүх/мэдэгдэл бичихгүй).
  // ⚠️ updated_at-аар биш — ижил миллисекундэд давхцдаг (тестээр барьсан).
  const guard = `EXISTS (SELECT 1 FROM engineering_requests WHERE id = ? AND mutation_nonce = ?)`;
  const guardBinds = [r.id, nonce];
  const ev = (kind: string, visibility: string, from: string | null, to: string | null, text: string | null, meta: unknown = null) =>
    db
      .prepare(
        `INSERT INTO engineering_request_events (request_id, actor_user_id, actor_role, kind, visibility, from_value, to_value, body, meta_json, created_at)
         SELECT ?, ?, 'reviewer', ?, ?, ?, ?, ?, ?, ? WHERE ${guard}`,
      )
      .bind(r.id, rev.userId, kind, visibility, from, to, text, meta === null ? null : JSON.stringify(meta), now, ...guardBinds);
  if (status !== r.status) {
    stmts.push(ev(status === 'duplicate' ? 'duplicate' : status === 'reopened' ? 'reopen' : 'status', 'sender', r.status, status, null, duplicateOf ? { duplicate_of: duplicateOf } : null));
  }
  if (priority !== r.priority) stmts.push(ev('priority', 'private', r.priority, priority, null));
  if (note) stmts.push(ev('note', 'private', null, null, note));
  if (reply) stmts.push(ev('reply', 'sender', null, null, reply));
  // Илгээгчид: зөвхөн нийтийн төлөв ба хариу (дотоод тэмдэглэл, ач холбогдол ХЭЗЭЭ Ч орохгүй).
  if (status !== r.status || reply) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO notifications (user_id, type, title, body, link)
           SELECT er.submitter_user_id, 'engineering_request_update', 'ПХ-' || printf('%04d', er.number) || ': ' || ?, ?, ${SENDER_LINK}
             FROM engineering_requests er WHERE er.id = ? AND ${guard}`,
        )
        .bind(publicStatusLabel(status), reply ? reply.slice(0, 280) : null, r.id, ...guardBinds),
    );
  }
  const res = await db.batch(stmts);
  if (!res[0]?.meta?.changes) {
    const cur = await loadRequest(db, r.id);
    return fail(c, 409, 'STALE_VERSION', 'Өөр газраас өөрчлөгдсөн — хуудсаа шинэчилнэ үү', { version: cur?.version ?? null });
  }
  return c.json({ ok: true, version: version + 1, status, priority, duplicate_of: duplicateOf });
});

router.post('/inbox/:id/events', async (c) => {
  const rev = await reviewer(c);
  if (!rev) return notFound(c);
  const db = c.env.DB;
  const r = await loadRequest(db, c.req.param('id'));
  if (!r || r.status === 'draft') return notFound(c);
  const body = await readJson(c);
  const kind = body.kind === 'reply' ? 'reply' : body.kind === 'note' ? 'note' : null;
  const text = typeof body.body === 'string' ? body.body.trim().slice(0, EF_LIMITS.textMax) : '';
  if (!kind || !text) return fail(c, 400, 'BAD_EVENT', 'Тэмдэглэл/хариу хоосон байна');
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO engineering_request_events (request_id, actor_user_id, actor_role, kind, visibility, body, created_at)
         VALUES (?, ?, 'reviewer', ?, ?, ?, ?)`,
      )
      .bind(r.id, rev.userId, kind, kind === 'reply' ? 'sender' : 'private', text, now),
    db.prepare(`UPDATE engineering_requests SET updated_at = ? WHERE id = ?`).bind(now, r.id),
  ];
  if (kind === 'reply') {
    stmts.push(
      db
        .prepare(
          `INSERT INTO notifications (user_id, type, title, body, link)
           SELECT er.submitter_user_id, 'engineering_request_update', 'ПХ-' || printf('%04d', er.number) || ': хариу ирлээ', ?, ${SENDER_LINK}
             FROM engineering_requests er WHERE er.id = ?`,
        )
        .bind(text.slice(0, 280), r.id),
    );
  }
  await db.batch(stmts);
  return c.json({ ok: true }, 201);
});

router.post('/inbox/:id/fixes', async (c) => {
  const rev = await reviewer(c);
  if (!rev) return notFound(c);
  const db = c.env.DB;
  const r = await loadRequest(db, c.req.param('id'));
  if (!r || r.status === 'draft') return notFound(c);
  const body = await readJson(c);
  const year = body.revit_year === null || body.revit_year === undefined ? null : Number(body.revit_year);
  if (year !== null && (!Number.isSafeInteger(year) || year < 2020 || year > 2040)) return fail(c, 400, 'BAD_YEAR', 'Revit он буруу');
  const fixedVersion = typeof body.fixed_version === 'string' && /^[0-9][0-9A-Za-z.+_-]{0,39}$/.test(body.fixed_version.trim()) ? body.fixed_version.trim() : null;
  const commit = typeof body.commit_sha === 'string' && /^[0-9a-f]{7,40}$/i.test(body.commit_sha.trim()) ? body.commit_sha.trim().toLowerCase() : null;
  const prUrl = typeof body.pr_url === 'string' && /^https:\/\/[^\s<>"']{1,300}$/.test(body.pr_url.trim()) ? body.pr_url.trim() : null;
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, EF_LIMITS.shortMax) || null : null;
  if (!fixedVersion && !commit && !prUrl) return fail(c, 400, 'BAD_FIX', 'Хувилбар, commit эсвэл PR-ийн аль нэгийг зөв бичнэ үү');
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO engineering_request_fixes (request_id, revit_year, fixed_version, commit_sha, pr_url, note, linked_by, linked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(r.id, year, fixedVersion, commit, prUrl, note, rev.userId, now),
    db
      .prepare(
        `INSERT INTO engineering_request_events (request_id, actor_user_id, actor_role, kind, visibility, to_value, meta_json, created_at)
         VALUES (?, ?, 'reviewer', 'release', ?, ?, ?, ?)`,
      )
      .bind(r.id, rev.userId, fixedVersion ? 'sender' : 'private', fixedVersion ?? commit ?? prUrl, JSON.stringify({ revit_year: year, commit_sha: commit, pr_url: prUrl }), now),
    db.prepare(`UPDATE engineering_requests SET updated_at = ? WHERE id = ?`).bind(now, r.id),
  ]);
  return c.json({ ok: true }, 201);
});

router.delete('/inbox/:id/fixes/:fixId', async (c) => {
  const rev = await reviewer(c);
  if (!rev) return notFound(c);
  const r = await loadRequest(c.env.DB, c.req.param('id'));
  if (!r || r.status === 'draft') return notFound(c);
  const fixId = Number(c.req.param('fixId'));
  if (!Number.isSafeInteger(fixId) || fixId <= 0) return notFound(c);
  const res = await c.env.DB
    .prepare(`UPDATE engineering_request_fixes SET removed_at = ? WHERE id = ? AND request_id = ? AND removed_at IS NULL`)
    .bind(nowIso(), fixId, r.id)
    .run();
  if (!res.meta.changes) return notFound(c);
  return c.json({ ok: true });
});

/** Хувийн хавсралтын stream (GET ба HEAD — Hono GET handler HEAD-ийг ч хүлээн авна; эрх ИЖИЛ шалгагдана). */
router.get('/inbox/:id/attachments/:aid', async (c) => {
  if (!(await reviewer(c))) return notFound(c);
  const bucket = bucketOf(c);
  if (!bucket) return fail(c, 503, 'STORAGE_UNAVAILABLE', 'Файлын хадгалалт тохируулагдаагүй');
  const db = c.env.DB;
  const r = await loadRequest(db, c.req.param('id'));
  if (!r || r.status === 'draft') return notFound(c);
  const a = await loadAttachment(db, c.req.param('aid'));
  if (!a || a.request_id !== r.id || a.state !== 'ready') return notFound(c);
  const spec = EF_EXTENSIONS[a.extension];
  const wantInline = c.req.query('inline') === '1' && !!spec?.preview;
  const headers = new Headers({
    'Content-Type': wantInline ? (spec?.preview === 'text' ? 'text/plain; charset=utf-8' : spec!.mediaType) : 'application/octet-stream',
    'Content-Disposition': contentDisposition(a.original_name, wantInline),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox",
    'Referrer-Policy': 'no-referrer',
  });
  if (c.req.method === 'HEAD') {
    const h = await bucket.head(a.object_key);
    if (!h) return notFound(c);
    headers.set('Content-Length', String(h.size));
    return new Response(null, { status: 200, headers });
  }
  const obj = await bucket.get(a.object_key);
  if (!obj) return notFound(c);
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
});

export default router;

/* ------------------------------------------------------------------ */
/*  Cron цэвэрлэгч                                                      */
/* ------------------------------------------------------------------ */

/**
 * Хаягдсан / хугацаа дууссан хавсралтын байтыг устгана (cron-ын fail-safe салаа, ШИНЭ cron илэрхийлэлгүй).
 *   • reserved / uploading / failed — expires_at өнгөрсөн;  aborted — 10 минутын дараа (submit, цуцлалт);
 *   • 30 хоногоос хуучин ИЛГЭЭГДЭЭГҮЙ ноорогийн хавсралт → aborted (дараагийн тикт устна).
 * ⚠️ Илгээсэн хүсэлтийн ready хавсралтыг ХЭЗЭЭ Ч хөндөхгүй.  Нэг тикт ≤ 25 объект.  Binding байхгүй бол юу ч хийхгүй.
 */
export async function sweepEngineeringFeedback(env: Env): Promise<{ deleted: number; aborted: number }> {
  const bucket = (env as Env & { FEEDBACK_BUCKET?: R2Bucket }).FEEDBACK_BUCKET;
  if (!bucket) return { deleted: 0, aborted: 0 };
  const db = env.DB;
  const now = new Date();
  const nowS = now.toISOString();
  const graceS = new Date(now.getTime() - 10 * 60_000).toISOString();
  const draftCut = new Date(now.getTime() - EF_LIMITS.draftTtlDays * 86_400_000).toISOString();
  let aborted = 0;
  try {
    const res = await db
      .prepare(
        `UPDATE engineering_request_attachments SET state = 'aborted', updated_at = ?
          WHERE state IN ('reserved', 'uploading', 'ready', 'failed')
            AND request_id IN (SELECT id FROM engineering_requests WHERE status = 'draft' AND updated_at < ?)`,
      )
      .bind(nowS, draftCut)
      .run();
    aborted = res.meta.changes ?? 0;
  } catch (err) {
    console.error('[engineering-feedback] sweep: draft expiry', err);
  }
  const rows = await db
    .prepare(
      `SELECT a.id, a.object_key, a.upload_mode, a.r2_upload_id, a.state FROM engineering_request_attachments a
        WHERE (a.state IN ('reserved', 'uploading', 'failed') AND a.expires_at < ?)
           OR (a.state = 'aborted' AND a.updated_at < ?)
        ORDER BY a.updated_at LIMIT 25`,
    )
    .bind(nowS, graceS)
    .all<{ id: string; object_key: string; upload_mode: string; r2_upload_id: string | null; state: string }>();
  let deleted = 0;
  for (const a of rows.results ?? []) {
    try {
      if (a.upload_mode === 'multipart' && a.r2_upload_id) {
        try {
          await bucket.resumeMultipartUpload(a.object_key, a.r2_upload_id).abort();
        } catch {
          /* аль хэдийн дууссан/цуцлагдсан */
        }
      }
      await bucket.delete(a.object_key);
      // Илгээсэн хүсэлтийн ready мөр энд хэзээ ч ирэхгүй (WHERE), гэхдээ давхар хамгаалалт: state шалгана.
      await db
        .prepare(`UPDATE engineering_request_attachments SET state = 'deleted', updated_at = ? WHERE id = ? AND state = ?`)
        .bind(nowS, a.id, a.state)
        .run();
      deleted++;
    } catch (err) {
      console.error('[engineering-feedback] sweep: delete failed', a.id, err);
    }
  }
  return { deleted, aborted };
}
