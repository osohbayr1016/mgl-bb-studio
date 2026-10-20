import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { detectCharset, isTextFileName, textContentType } from '../lib/textCharset';

const upload = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// Optional target-bucket switch.  Defaults to the public MEDIA_BUCKET so every
// existing caller (avatars, documents, IFC models) is unaffected.  The only
// alternate is the PRIVATE meeting-audio bucket used by the Хурлын тэмдэглэл
// uploader: objects there are streamed solely via the signed /meeting-audio
// route and are NEVER reachable through the public /media mount.  Whichever
// bucket a multipart upload is CREATED on must also be used for every
// part/complete/abort call — the client echoes `bucket` back on each request.
function pickBucket(
  env: Env,
  raw: unknown,
): { bucket: R2Bucket; name: 'media' | 'meeting' | 'client' } {
  if (raw === 'meeting' && env.MEETING_BUCKET) return { bucket: env.MEETING_BUCKET, name: 'meeting' };
  // `client` — захиалагчийн порталын файл (илгээсэн материал + гаргасан
  // зургийн багц).  ХУВИЙН bucket-д, `client/` угтвартай.  /media нь
  // нэвтрэлтгүй нийтийн зам тул гэрээ, геологийн тайлан тэнд байж БОЛОХГҮЙ
  // (CLAUDE.md-ийн аюулгүй байдлын #2).  Уншилт нь зөвхөн
  // `routes/clientFiles.ts`-ийн эрх шалгасан stream-ээр.
  if (raw === 'client' && env.MEETING_BUCKET) return { bucket: env.MEETING_BUCKET, name: 'client' };
  return { bucket: env.MEDIA_BUCKET, name: 'media' };
}

/** Хувийн bucket доторх нэрийн зай — meeting/client хоёр нэг bucket
 *  хуваалцдаг тул угтвар нь тэднийг тусгаарлана. */
function keyPrefix(bucketName: 'media' | 'meeting' | 'client'): string {
  return bucketName === 'client' ? 'client/' : '';
}

/**
 * R2-ийн түлхүүр.  `<userSub>-` угтвар нь ЗААВАЛ хэвээр үлдэнэ — multipart-ын
 * `ownsKey` шалгалт түүн дээр тогтдог.
 *
 * Санамсаргүй хэсэг НЭМСЭН шалтгаан (2026-09-03): хавтас импортлохдоо файлууд
 * ЗЭРЭГЦЭЭ байршдаг тул `<sub>-<ms>-<нэр>` нь ижил нэртэй хоёр файл (өөр өөр
 * дэд хавтас дахь «01.pdf») нэг миллисекундэд таарвал ЯГ ижил түлхүүр өгч,
 * нэг нь нөгөөгөө дардаг байсан.  Дайвар ашиг нь `/media/<key>` таамаглахад
 * хэцүү болсон (CLAUDE.md-ийн аюулгүй байдлын #2).
 */
function mediaKey(userSub: string | number, fileName: string, prefix = ''): string {
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return `${prefix}${userSub}-${Date.now()}-${rand}-${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
}

// POST /api/upload?bucket=media|meeting
upload.post('/', async (c) => {
  const user = c.get('user');

  try {
    const body = await c.req.parseBody();
    const file = body['file'] as File;

    if (!file) {
      return c.json({ error: 'No file uploaded' }, 400);
    }

    const { bucket, name: bucketName } = pickBucket(c.env, c.req.query('bucket'));

    const fileName = mediaKey(user.sub, file.name, keyPrefix(bucketName));

    // Convert File to ArrayBuffer for R2
    const arrayBuffer = await file.arrayBuffer();

    // `.txt`/`.log`/`.md` — кодчлолыг байтаас нь илрүүлж, charset-ыг R2-ийн
    // метадатад ХАДГАЛНА.  Хөтөч `text/plain`-ыг charset-гүй илгээдэг тул
    // үүнгүйгээр Chrome таамаглаж, кирилл текст эвдэрдэг (`lib/textCharset.ts`).
    const contentType = isTextFileName(file.name)
      ? textContentType(detectCharset(arrayBuffer))
      : file.type || 'application/octet-stream';

    await bucket.put(fileName, arrayBuffer, {
      httpMetadata: {
        contentType,
      },
      customMetadata: {
        uploadedBy: user.sub.toString(),
      },
    });

    // Private bucket → no public URL; the caller persists the key and fetches
    // via the signed /meeting-audio route.
    if (bucketName !== 'media') {
      return c.json({ key: fileName, bucket: bucketName, contentType: file.type || null });
    }

    // Public, unauthenticated path — `<img src>` tags can't send the
    // bearer token, so we deliberately route media outside `/api/*`
    // (which is behind authMiddleware).
    const url = `/media/${fileName}`;
    return c.json({ url, key: fileName });
  } catch (error) {
    console.error('Upload Error:', error);
    return c.json({ error: 'Upload failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// Multipart upload — for large files (e.g. IFC models)
//
// The single-request POST `/` above buffers the WHOLE file into Worker memory
// (`parseBody` → `arrayBuffer`) and is bounded by the Worker request-body
// limit (~100 MB on Free/Pro). Construction IFC models routinely exceed both.
// These endpoints proxy R2's native multipart API so the browser can split a
// file into uniform chunks and stream each one straight through the Worker
// into R2 — nothing ever buffers the whole file, and each request stays under
// the body/memory limits:
//
//   1. POST   /api/upload/multipart/create   → { key, uploadId }
//   2. PUT    /api/upload/multipart/part      → { partNumber, etag }   (× N)
//   3. POST   /api/upload/multipart/complete  → { url, key }
//      DELETE /api/upload/multipart/abort     → cancels an in-flight upload
//
// All upload state (uploadId + the collected { partNumber, etag } list) lives
// in the CLIENT; the Worker is stateless and rebuilds the R2 handle with
// `resumeMultipartUpload()` on every part request.
// https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/

// A user may only touch keys they own. Keys are minted server-side as
// `<userSub>-<timestamp>-<random>-<name>`, so this prefix check stops one authed user
// from hijacking another user's in-flight multipart upload by guessing its key.
function ownsKey(userSub: string | number, key: unknown): key is string {
  if (typeof key !== 'string') return false;
  // Угтвартай (`client/…`) түлхүүр дээр ч ижил дүрэм: угтварыг хассаны дараа
  // `<sub>-` -ээр эхлэх ёстой.  Угтварыг таслахгүй бол өөр хэрэглэгчийн
  // multipart upload-ыг булаах боломж нээгдэнэ.
  const bare = key.startsWith('client/') ? key.slice('client/'.length) : key;
  return bare.startsWith(`${userSub}-`);
}

// The uploaded bytes are fully client-controlled and `/media/<key>` is a stable
// public URL on the SAME origin as `/api/*`. If we stored an attacker-chosen
// Content-Type like `text/html` or `image/svg+xml`, any authenticated user
// could host an executable/phishing page on a trusted origin. So we ignore the
// client's Content-Type unless it's in a known-safe inline set, and otherwise
// neutralise it to `application/octet-stream` (the browser downloads instead of
// rendering). Models (.ifc/.xkt) are fetched as bytes, so octet-stream is fine.
const SAFE_MEDIA_CONTENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'application/pdf',
  'application/octet-stream',
]);
function safeMediaContentType(raw: unknown): string {
  const ct = typeof raw === 'string' ? (raw.split(';')[0] ?? '').trim().toLowerCase() : '';
  return SAFE_MEDIA_CONTENT_TYPES.has(ct) ? ct : 'application/octet-stream';
}

// The private meeting bucket isn't served via /media, so the Content-Type
// can't be used to host a phishing page on a trusted origin — we preserve the
// real (audio/*) type so in-app playback works.
function meetingContentType(raw: unknown): string {
  const ct = typeof raw === 'string' ? (raw.split(';')[0] ?? '').trim().toLowerCase() : '';
  return ct || 'application/octet-stream';
}

// POST /api/upload/multipart/create  { filename, contentType?, bucket? } → { key, uploadId, bucket }
upload.post('/multipart/create', async (c) => {
  const user = c.get('user');
  let body: { filename?: unknown; contentType?: unknown; bucket?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  if (!filename) return c.json({ error: 'Missing filename' }, 400);
  const { bucket, name: bucketName } = pickBucket(c.env, body.bucket);
  const contentType =
    bucketName === 'media' ? safeMediaContentType(body.contentType) : meetingContentType(body.contentType);

  const key = mediaKey(user.sub, filename, keyPrefix(bucketName));
  const mpu = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType },
    customMetadata: { uploadedBy: user.sub.toString() },
  });
  return c.json({ key: mpu.key, uploadId: mpu.uploadId, bucket: bucketName });
});

// PUT /api/upload/multipart/part?key=&uploadId=&partNumber=
// Body is the raw chunk, streamed directly into R2 (never buffered) so a
// concurrent chunk can't blow the 128 MB per-isolate memory budget.
upload.put('/multipart/part', async (c) => {
  const user = c.get('user');
  const key = c.req.query('key');
  const uploadId = c.req.query('uploadId');
  const partNumber = parseInt(c.req.query('partNumber') ?? '', 10);

  if (!key || !uploadId) return c.json({ error: 'Missing key or uploadId' }, 400);
  if (!ownsKey(user.sub, key)) return c.json({ error: 'Forbidden' }, 403);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return c.json({ error: 'Invalid partNumber' }, 400);
  }
  if (!c.req.raw.body) return c.json({ error: 'Missing request body' }, 400);

  const { bucket } = pickBucket(c.env, c.req.query('bucket'));
  // `resumeMultipartUpload` is synchronous and does NOT validate the uploadId —
  // an invalid/aborted upload surfaces as an error from `uploadPart()` instead.
  const mpu = bucket.resumeMultipartUpload(key, uploadId);
  try {
    const part = await mpu.uploadPart(partNumber, c.req.raw.body);
    return c.json(part); // { partNumber, etag }
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'uploadPart failed' }, 400);
  }
});

// POST /api/upload/multipart/complete  { key, uploadId, parts: [{partNumber, etag}], bucket? }
upload.post('/multipart/complete', async (c) => {
  const user = c.get('user');
  let body: { key?: unknown; uploadId?: unknown; parts?: unknown; bucket?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { key, uploadId, parts } = body;
  if (typeof key !== 'string' || typeof uploadId !== 'string') {
    return c.json({ error: 'Missing key or uploadId' }, 400);
  }
  if (!ownsKey(user.sub, key)) return c.json({ error: 'Forbidden' }, 403);
  if (!Array.isArray(parts) || parts.length === 0) {
    return c.json({ error: 'Missing parts' }, 400);
  }
  const { bucket, name: bucketName } = pickBucket(c.env, body.bucket);

  // Normalise + sort by partNumber. R2 assembles in part-number order, but the
  // client uploads parts concurrently so they arrive out of order — sorting
  // here keeps `complete` robust regardless of collection order.
  const uploadedParts = parts
    .map((p) => p as { partNumber?: unknown; etag?: unknown })
    .filter((p) => Number.isInteger(p.partNumber) && typeof p.etag === 'string')
    .map((p) => ({ partNumber: p.partNumber as number, etag: p.etag as string }))
    .sort((a, b) => a.partNumber - b.partNumber);
  if (uploadedParts.length !== parts.length) {
    return c.json({ error: 'Malformed parts array' }, 400);
  }

  const mpu = bucket.resumeMultipartUpload(key, uploadId);
  try {
    await mpu.complete(uploadedParts);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'complete failed' }, 400);
  }
  // Private bucket → no public URL; the caller persists the key.
  if (bucketName !== 'media') return c.json({ key, bucket: bucketName });
  return c.json({ url: `/media/${key}`, key });
});

// DELETE /api/upload/multipart/abort  { key, uploadId, bucket? }
upload.delete('/multipart/abort', async (c) => {
  const user = c.get('user');
  let body: { key?: unknown; uploadId?: unknown; bucket?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { key, uploadId } = body;
  if (typeof key !== 'string' || typeof uploadId !== 'string') {
    return c.json({ error: 'Missing key or uploadId' }, 400);
  }
  if (!ownsKey(user.sub, key)) return c.json({ error: 'Forbidden' }, 403);

  const { bucket } = pickBucket(c.env, body.bucket);
  const mpu = bucket.resumeMultipartUpload(key, uploadId);
  try {
    await mpu.abort();
  } catch (err) {
    // An already-completed/aborted upload throws — harmless for a cancel path.
    return c.json({ error: err instanceof Error ? err.message : 'abort failed' }, 400);
  }
  return c.body(null, 204);
});

export default upload;
