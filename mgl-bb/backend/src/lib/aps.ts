import type { Env } from '../types';
import { orgConfig } from './orgConfig';

/* ============================================================================
 * Autodesk Platform Services (APS, formerly Forge) — 3D model viewer backend.
 * ----------------------------------------------------------------------------
 * The only place that talks to APS. Raw `fetch` against developer.api.autodesk.com
 * (no Node SDK — Workers-compatible). Flow for a `.rvt` upload:
 *   ensureBucket → uploadToOss (R2 stream → signed-S3) → translate (SVF2) → poll
 *   getManifest until success → the APS Viewer loads the URN in the browser.
 * Auth is 2-legged (client_credentials); the browser only ever gets a scoped,
 * short-lived `viewables:read` token (getViewerToken), never the app secret.
 * ========================================================================== */

const APS_BASE = 'https://developer.api.autodesk.com';

/** R2 object key for a model media url/path (strips host + the /media mount).
 *  Moved here from the retired lib/ifcConvert.ts. */
export function r2KeyFor(modelUrl: string): string {
  const noHost = modelUrl.replace(/^https?:\/\/[^/]+/, '');
  const parts = noHost.split('/media/');
  const tail = parts.length > 1 ? parts[parts.length - 1]! : noHost;
  return tail.replace(/^\/+/, '');
}

// ---- token caching (per-isolate, best-effort) ----------------------------
interface CachedToken {
  token: string;
  exp: number;
}
let serverTok: CachedToken | null = null;
let viewerTok: CachedToken | null = null;

function region(env: Env): string {
  return env.APS_REGION || 'US';
}

async function fetchToken(env: Env, scope: string): Promise<{ access_token: string; expires_in: number }> {
  const id = env.APS_CLIENT_ID;
  const secret = env.APS_CLIENT_SECRET;
  if (!id || !secret) throw new Error('APS credentials are not configured');
  const res = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      // APS v2 takes the client credentials via HTTP Basic, not in the body.
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }).toString(),
  });
  if (!res.ok) {
    throw new Error(`APS token failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Server token (upload + translate). Cached per-isolate with a 60s skew. */
export async function getServerToken(env: Env): Promise<string> {
  const now = Date.now();
  if (serverTok && serverTok.exp > now + 60_000) return serverTok.token;
  const { access_token, expires_in } = await fetchToken(
    env,
    'data:read data:write data:create bucket:create bucket:read',
  );
  serverTok = { token: access_token, exp: now + expires_in * 1000 };
  return access_token;
}

/** Viewer token for the browser — least privilege (`viewables:read` only). */
export async function getViewerToken(env: Env): Promise<{ access_token: string; expires_in: number }> {
  const now = Date.now();
  if (viewerTok && viewerTok.exp > now + 60_000) {
    return { access_token: viewerTok.token, expires_in: Math.floor((viewerTok.exp - now) / 1000) };
  }
  const tok = await fetchToken(env, 'viewables:read');
  viewerTok = { token: tok.access_token, exp: now + tok.expires_in * 1000 };
  return tok;
}

// ---- OSS bucket + signed-S3 upload ---------------------------------------
/**
 * OSS bucket-ийн нэр.  `APS_BUCKET` env (wrangler.toml [vars]) нь эх сурвалж;
 * тохируулаагүй бол байгууллагын богино нэрээс гаргана — MGL дээр энэ нь
 * өмнөх hardcode `'mgl-aps-models'`-той ЯГ ИЖИЛ утга өгнө.  APS bucket-ийн
 * нэр глобал давхцахгүй байх ёстой тул компани бүр өөрийн нэрээ авах нь зөв.
 */
function bucketKey(env: Env): string {
  if (env.APS_BUCKET) return env.APS_BUCKET;
  const slug = orgConfig()
    .nameShort.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'app'}-aps-models`;
}

/** base64url of the OSS object id — the URN the Model Derivative API + Viewer use. */
export function urnify(bucket: string, objectKey: string): string {
  const id = `urn:adsk.objects:os.object:${bucket}/${objectKey}`;
  return btoa(id).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Create the app's OSS bucket once. 409 (already exists) is treated as success. */
export async function ensureBucket(env: Env): Promise<string> {
  const bucket = bucketKey(env);
  const token = await getServerToken(env);
  const res = await fetch(`${APS_BASE}/oss/v2/buckets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-ads-region': region(env),
    },
    body: JSON.stringify({ bucketKey: bucket, policyKey: 'persistent' }),
  });
  if (res.ok || res.status === 409) return bucket;
  throw new Error(`APS ensureBucket failed (${res.status}): ${await res.text()}`);
}

/**
 * Stream bytes to OSS via the signed-S3 flow (single part — fine for typical
 * Revit sizes): GET signed url → PUT to S3 (no auth header) → POST finalize.
 * Returns the object URN.
 */
export async function uploadToOss(
  env: Env,
  bucket: string,
  objectKey: string,
  body: ReadableStream<Uint8Array>,
  size: number,
): Promise<string> {
  const token = await getServerToken(env);
  const encKey = encodeURIComponent(objectKey);

  // Step A — get a signed S3 URL.
  const signRes = await fetch(
    `${APS_BASE}/oss/v2/buckets/${bucket}/objects/${encKey}/signeds3upload`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!signRes.ok) {
    throw new Error(`APS signeds3upload GET failed (${signRes.status}): ${await signRes.text()}`);
  }
  const { uploadKey, urls } = (await signRes.json()) as { uploadKey: string; urls: string[] };
  const signedUrl = urls?.[0];
  if (!signedUrl) throw new Error('APS signeds3upload returned no URL');

  // Step B — PUT the bytes straight to S3 (pre-signed, no Authorization header).
  const putRes = await fetch(signedUrl, {
    method: 'PUT',
    body,
    // Cloudflare requires an explicit content-length for a streamed body.
    headers: { 'Content-Length': String(size) },
  });
  if (!putRes.ok) {
    throw new Error(`APS S3 PUT failed (${putRes.status}): ${await putRes.text()}`);
  }

  // Step C — finalize the upload.
  const finRes = await fetch(
    `${APS_BASE}/oss/v2/buckets/${bucket}/objects/${encKey}/signeds3upload`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadKey }),
    },
  );
  if (!finRes.ok) {
    throw new Error(`APS signeds3upload POST failed (${finRes.status}): ${await finRes.text()}`);
  }
  return urnify(bucket, objectKey);
}

// ---- Model Derivative translate + manifest -------------------------------
/** Kick a SVF2 translation. `rootFilename` is only for composite/zip uploads. */
export async function translate(env: Env, urn: string, rootFilename?: string): Promise<void> {
  const token = await getServerToken(env);
  const input = rootFilename ? { urn, compressedUrn: true, rootFilename } : { urn };
  const res = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-ads-force': 'true', // re-translate even if a manifest already exists
      'x-ads-region': region(env),
    },
    body: JSON.stringify({
      input,
      output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] },
    }),
  });
  if (!res.ok) {
    throw new Error(`APS translate failed (${res.status}): ${await res.text()}`);
  }
}

export interface ApsManifest {
  status: 'pending' | 'inprogress' | 'success' | 'failed' | 'timeout';
  progress?: string;
}

/** Translation status. A 404 means no manifest yet → treat as 'pending'. */
export async function getManifest(env: Env, urn: string): Promise<ApsManifest> {
  const token = await getServerToken(env);
  const res = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${urn}/manifest`, {
    headers: { Authorization: `Bearer ${token}`, 'x-ads-region': region(env) },
  });
  if (res.status === 404) return { status: 'pending' };
  if (!res.ok) {
    throw new Error(`APS manifest failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { status?: string; progress?: string };
  return { status: (json.status as ApsManifest['status']) ?? 'pending', progress: json.progress };
}

/** Map an APS manifest status to our project_models.conversion_status enum. */
export function mapStatus(s: ApsManifest['status']): 'converting' | 'done' | 'failed' {
  if (s === 'success') return 'done';
  if (s === 'failed' || s === 'timeout') return 'failed';
  return 'converting';
}
