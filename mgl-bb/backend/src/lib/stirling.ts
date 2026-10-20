import type { Env } from '../types';

/* ============================================================================
 * Stirling-PDF client
 * ----------------------------------------------------------------------------
 * Stirling-PDF (https://github.com/Stirling-Tools/Stirling-PDF) is a PDF
 * toolbox with a REST API. Two transports are supported, preferred in order:
 *
 *   1. A Cloudflare Containers Worker bound as the `STIRLING_SVC` service
 *      binding (see stirling/). Internal, no public hop, no API key.
 *   2. A plain HTTP instance at STIRLING_BASE_URL (e.g. Render/Railway/VPS),
 *      optionally authenticated with STIRLING_API_KEY (X-API-KEY header).
 *
 * Each operation is a multipart/form-data POST whose primary file field is
 * `fileInput`; the response body is the resulting PDF bytes.
 *
 * NOTE: endpoint paths are Stirling's stable v1 routes but can shift between
 * major versions. If an op 404s, check the instance's Swagger UI and adjust the
 * STIRLING_ENDPOINTS map below — that's the single place paths are defined.
 * ========================================================================== */

export const STIRLING_ENDPOINTS = {
  pageNumbers: '/api/v1/misc/add-page-numbers',
  watermark: '/api/v1/security/add-watermark',
  compress: '/api/v1/misc/compress-pdf',
  merge: '/api/v1/general/merge-pdfs',
  password: '/api/v1/security/add-password',
} as const;

/** A single step in a finishing pipeline. Discriminated on `op`. */
export type PdfOp =
  | { op: 'page-numbers'; position?: number; startingNumber?: number; customText?: string }
  | { op: 'watermark'; text: string; opacity?: number; fontSize?: number; rotation?: number }
  | { op: 'compress'; level?: number }
  | { op: 'password'; password: string };

/** True when at least one transport (service binding OR base URL) is configured. */
export function stirlingEnabled(env: Env): boolean {
  if (env.STIRLING_SVC) return true;
  return typeof env.STIRLING_BASE_URL === 'string' && env.STIRLING_BASE_URL.trim().length > 0;
}

/** Public URL used to open the Stirling web editor for manual edits (or null).
 *  Prefers STIRLING_PUBLIC_URL (the container Worker's public URL); falls back
 *  to STIRLING_BASE_URL for plain-HTTP deployments. The service binding has no
 *  browser-reachable URL, so without one of these the manual-edit button hides. */
export function stirlingEditorUrl(env: Env): string | null {
  const url = env.STIRLING_PUBLIC_URL?.trim() || env.STIRLING_BASE_URL?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

function authHeaders(env: Env): Record<string, string> {
  const key = env.STIRLING_API_KEY?.trim();
  return key ? { 'X-API-KEY': key } : {};
}

/**
 * Low-level call: POST a PDF (plus extra string fields and optional extra
 * files) to one Stirling endpoint and return the resulting PDF bytes. Uses the
 * service binding when present, else HTTP. Throws on a non-2xx response.
 */
export async function callStirling(
  env: Env,
  path: string,
  primary: { bytes: Uint8Array; filename: string },
  fields: Record<string, string> = {},
  extraFiles: Array<{ field: string; bytes: Uint8Array; filename: string }> = [],
): Promise<Uint8Array> {
  if (!stirlingEnabled(env)) throw new Error('Stirling-PDF is not configured');

  const form = new FormData();
  form.append('fileInput', new Blob([primary.bytes], { type: 'application/pdf' }), primary.filename);
  for (const f of extraFiles) {
    form.append(f.field, new Blob([f.bytes], { type: 'application/pdf' }), f.filename);
  }
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  let res: Response;
  if (env.STIRLING_SVC) {
    // Service binding: the host is arbitrary; only the path is forwarded to the
    // container Worker. No API key needed (internal, never leaves Cloudflare).
    res = await env.STIRLING_SVC.fetch(`https://stirling-svc${path}`, { method: 'POST', body: form });
  } else {
    const base = env.STIRLING_BASE_URL!.replace(/\/+$/, '');
    // NB: never set Content-Type — FormData sets the multipart boundary.
    res = await fetch(`${base}${path}`, { method: 'POST', headers: authHeaders(env), body: form });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Stirling ${path} → HTTP ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** Apply one op to the running PDF bytes and return the new bytes. */
async function applyOp(env: Env, bytes: Uint8Array, filename: string, op: PdfOp): Promise<Uint8Array> {
  switch (op.op) {
    case 'page-numbers':
      return callStirling(env, STIRLING_ENDPOINTS.pageNumbers, { bytes, filename }, {
        customMargin: 'medium',
        position: String(op.position ?? 8),
        startingNumber: String(op.startingNumber ?? 1),
        pagesToNumber: 'all',
        customText: op.customText ?? '{n}',
      });
    case 'watermark':
      return callStirling(env, STIRLING_ENDPOINTS.watermark, { bytes, filename }, {
        watermarkType: 'text',
        watermarkText: op.text,
        fontSize: String(op.fontSize ?? 30),
        rotation: String(op.rotation ?? 45),
        opacity: String(op.opacity ?? 0.5),
        widthSpacer: '50',
        heightSpacer: '50',
      });
    case 'compress':
      return callStirling(env, STIRLING_ENDPOINTS.compress, { bytes, filename }, {
        optimizeLevel: String(op.level ?? 2),
      });
    case 'password':
      return callStirling(env, STIRLING_ENDPOINTS.password, { bytes, filename }, {
        password: op.password,
      });
    default: {
      const _never: never = op;
      throw new Error(`Unknown PDF op: ${JSON.stringify(_never)}`);
    }
  }
}

/**
 * Run a sequence of ops, threading each op's output into the next. Returns the
 * final PDF bytes. An empty list returns the input unchanged.
 */
export async function runPipeline(
  env: Env,
  input: Uint8Array,
  ops: PdfOp[],
  filename = 'document.pdf',
): Promise<Uint8Array> {
  let bytes = input;
  for (const op of ops) bytes = await applyOp(env, bytes, filename, op);
  return bytes;
}
