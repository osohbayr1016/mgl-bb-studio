import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { finalizeTranscript, markTranscribeFailed } from '../lib/meetingTranscription';
import { finalizeAsrTranscript, markAsrTranscribeFailed } from '../lib/asrTranscription';
import { runMeetingAnalysis } from '../lib/meetingAnalysisAi';

/**
 * Speechmatics batch-job completion webhook.  Mounted at the worker ROOT
 * (outside /api/*, see index.ts) so it doesn't pass through `authMiddleware`;
 * it authenticates itself via the shared `x-mgl-speechmatics-secret` header
 * (the same model as routes/convert.ts).  The caller is Speechmatics, not a user.
 *
 * We registered the notification URL as `/speechmatics/callback?mid=<meetingId>`;
 * Speechmatics appends `&id=<jobId>&status=<success|error|fetch_error|trim_error>`.
 * The body (job info) is intentionally ignored — we fetch the authoritative
 * transcript ourselves in `finalizeTranscript`.  Must return a fast 2xx or
 * Speechmatics retries.
 *
 * TWO CONSUMERS.  Зохиогчийн хяналт (ASR) submits its own jobs with
 * `?kind=asr&rid=<asr_recordings.id>` (see `SubmitJobOpts.callbackQuery`).
 * That branch is taken FIRST, right after the shared-secret check, and returns
 * before any `mid` parsing — the meeting path below is untouched.  Keep it
 * that way: the meeting flow is the older, more load-bearing one.
 */
const speechmatics = new Hono<{ Bindings: Env; Variables: AppVariables }>();

speechmatics.post('/callback', async (c) => {
  const expected = c.env.SPEECHMATICS_WEBHOOK_SECRET;
  if (!expected) return c.json({ error: 'STT not configured' }, 503);
  if (c.req.header('x-mgl-speechmatics-secret') !== expected) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // ── Зохиогчийн хяналт (ASR) ────────────────────────────────────────
  // Хурлын логикт хүрэхээс ӨМНӨ сална.
  if (c.req.query('kind') === 'asr') {
    const rid = parseInt(c.req.query('rid') ?? '', 10);
    if (!Number.isFinite(rid)) return c.json({ error: 'Missing/invalid rid' }, 400);

    const asrStatus = c.req.query('status') ?? 'success';
    let asrJobId = c.req.query('id') ?? '';
    if (!asrJobId) {
      const rec = await c.env.DB.prepare('SELECT stt_job_id FROM asr_recordings WHERE id = ?')
        .bind(rid)
        .first<{ stt_job_id: string | null }>();
      asrJobId = rec?.stt_job_id ?? '';
    }

    if (asrStatus !== 'success') {
      await markAsrTranscribeFailed(c.env, rid, asrStatus, `Speechmatics status: ${asrStatus}`);
      return c.body(null, 200);
    }
    if (!asrJobId) {
      await markAsrTranscribeFailed(c.env, rid, 'error', 'No job id for recording');
      return c.body(null, 200);
    }

    try {
      await finalizeAsrTranscript(c.env, rid, asrJobId);
    } catch (err) {
      await markAsrTranscribeFailed(
        c.env,
        rid,
        'error',
        err instanceof Error ? err.message : 'finalize failed',
      );
    }
    return c.body(null, 200);
  }

  // ── Хурлын тэмдэглэл (өөрчлөгдөөгүй) ───────────────────────────────
  const mid = parseInt(c.req.query('mid') ?? '', 10);
  if (!Number.isFinite(mid)) return c.json({ error: 'Missing/invalid mid' }, 400);

  const status = c.req.query('status') ?? 'success';
  let jobId = c.req.query('id') ?? '';
  if (!jobId) {
    const rec = await c.env.DB.prepare('SELECT stt_job_id FROM meeting_recordings WHERE meeting_id=?')
      .bind(mid)
      .first<{ stt_job_id: string | null }>();
    jobId = rec?.stt_job_id ?? '';
  }

  if (status !== 'success') {
    await markTranscribeFailed(c.env, mid, status, `Speechmatics status: ${status}`);
    return c.body(null, 200);
  }
  if (!jobId) {
    await markTranscribeFailed(c.env, mid, 'error', 'No job id for meeting');
    return c.body(null, 200);
  }

  try {
    const { shouldAnalyze } = await finalizeTranscript(c.env, mid, jobId);
    if (shouldAnalyze) c.executionCtx.waitUntil(runMeetingAnalysis(c.env, mid));
  } catch (err) {
    await markTranscribeFailed(
      c.env,
      mid,
      'error',
      err instanceof Error ? err.message : 'finalize failed',
    );
  }
  return c.body(null, 200);
});

export default speechmatics;
