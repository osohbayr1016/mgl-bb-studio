import { Hono } from 'hono';
import type { Env } from '../types';
import { verifyToken } from '../lib/jwt';

/**
 * GET /meeting-audio/:key?t=<jwt>
 *
 * Streams ONE private meeting-audio object from MEETING_BUCKET.  Mounted at the
 * worker ROOT (outside /api/*) so `authMiddleware` doesn't run — auth is the
 * short-lived signed token (`purpose:'stt-audio'`, scoped to this exact key by
 * `audio_key`).  Consumed by Speechmatics' `fetch_data` during transcription and
 * by the in-app `<audio>` player (which can't send an Authorization header, so
 * the token rides in the query string).  Supports HTTP Range so playback can seek.
 */
const meetingAudio = new Hono<{ Bindings: Env }>();

meetingAudio.get('/:key', async (c) => {
  const key = c.req.param('key');
  const token = c.req.query('t');
  if (!token) return c.json({ error: 'Missing token' }, 401);

  const payload = await verifyToken(token, c.env.JWT_SECRET);
  if (!payload || payload.purpose !== 'stt-audio' || payload.audio_key !== key) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  const rangeHeader = c.req.header('range');
  if (rangeHeader) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
    if (m) {
      const start = parseInt(m[1]!, 10);
      const endRaw = m[2] ? parseInt(m[2]!, 10) : undefined;
      const r2range =
        endRaw !== undefined ? { offset: start, length: endRaw - start + 1 } : { offset: start };
      const object = await c.env.MEETING_BUCKET.get(key, { range: r2range });
      if (!object) return c.notFound();
      const total = object.size;
      const end = endRaw !== undefined ? Math.min(endRaw, total - 1) : total - 1;
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'private, max-age=3600');
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(object.body, { status: 206, headers });
    }
  }

  const object = await c.env.MEETING_BUCKET.get(key);
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
});

export default meetingAudio;
