import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';

/**
 * Tiny upload-only network speed test endpoint.
 *
 * The frontend POSTs an opaque blob of random bytes (typically 5–25 MB)
 * here and we *consume but discard* the body, returning the byte count
 * and the request's wall-clock duration.  That lets the client compute
 *
 *     throughput = bytes / elapsed_seconds
 *
 * without polluting R2 with junk objects.  Cloudflare's request-body
 * cap is 100 MB on the free plan and 500 MB on Workers Paid, so we
 * defensively reject anything larger than 100 MB regardless.
 *
 * Why server-measured timing?  Browser-side `performance.now()` already
 * gives the round-trip number the user actually cares about — but if we
 * also report the bytes the worker received we can sanity-check the
 * client's clock + flag stalled connections.
 */
const speedtest = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
speedtest.post('/upload', async (c) => {
  const t0 = Date.now();

  const lenHeader = c.req.header('content-length');
  const declared = lenHeader ? Number(lenHeader) : null;
  if (declared != null && Number.isFinite(declared) && declared > MAX_BYTES) {
    return c.json({ error: 'Файл хэт том (>100MB)' }, 413);
  }

  // Stream the body without holding the whole thing in memory at once —
  // we only need the byte count.  This is what makes the endpoint cheap
  // even for 50–100 MB upload tests.
  let received = 0;
  const reader = c.req.raw.body?.getReader();
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        return c.json({ error: 'Файл хэт том (>100MB)' }, 413);
      }
    }
  }

  const elapsedMs = Date.now() - t0;
  const seconds = Math.max(elapsedMs / 1000, 0.001);

  return c.json({
    bytes_received: received,
    elapsed_ms: elapsedMs,
    server_throughput_bytes_per_sec: Math.round(received / seconds),
    server_throughput_mbps: +((received * 8) / seconds / 1_000_000).toFixed(2),
  });
});

export default speedtest;
