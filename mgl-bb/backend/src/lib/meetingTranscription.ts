/**
 * Shared meeting-transcription finalisation + reconcile.
 *
 * Both the Speechmatics webhook (routes/speechmatics.ts) and the cron backstop
 * (the `scheduled` handler in index.ts) need to: fetch the json-v2 transcript,
 * persist it, flip the meeting to `transcribed`, and decide whether to kick off
 * analysis.  That logic lives here so the two callers stay in lock-step.
 */

import type { Env } from '../types';
import { fetchTranscriptJson, fetchJobInfo, parseTranscript } from './speechmatics';
import { runMeetingAnalysis } from './meetingAnalysisAi';

/** Statuses that mean "transcript already handled" — guards against the webhook
 *  and the cron reconcile both finalising (and double-analysing) the same job. */
const ALREADY_DONE = new Set(['transcribed', 'analyzing', 'analyzed']);

export function autoAnalyzeEnabled(env: Env): boolean {
  return env.MEETING_AUTO_ANALYZE === '1';
}

export async function markTranscribeFailed(
  env: Env,
  meetingId: number,
  sttStatus: string,
  error: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE meetings SET status='transcribe_failed', error=?, updated_at=datetime('now') WHERE id=?`,
  )
    .bind(error.slice(0, 300), meetingId)
    .run();
  await env.DB.prepare(
    `UPDATE meeting_recordings SET stt_status=?, completed_at=datetime('now') WHERE meeting_id=?`,
  )
    .bind(sttStatus, meetingId)
    .run();
}

/**
 * Fetch + persist the transcript for a finished job.  Idempotent: if the
 * meeting is already transcribed/analysed it returns `shouldAnalyze:false`.
 */
export async function finalizeTranscript(
  env: Env,
  meetingId: number,
  jobId: string,
): Promise<{ done: boolean; shouldAnalyze: boolean }> {
  const m = await env.DB.prepare('SELECT status FROM meetings WHERE id=?')
    .bind(meetingId)
    .first<{ status: string }>();
  if (!m) return { done: false, shouldAnalyze: false };
  if (ALREADY_DONE.has(m.status)) return { done: true, shouldAnalyze: false };

  const json = await fetchTranscriptJson(env, jobId);
  const parsed = parseTranscript(json);

  // Speechmatics-ийн бүрэн JSON (үг тус бүрийн timing/speaker-тэй) урт хуралд
  // олон MB болж, D1-ийн нэг утгын хязгаарыг хэтэрч `SQLITE_TOOBIG` өгдөг
  // байсан (жишээ нь ~2 цагийн хурал).  Тиймээс бүрэн JSON-ийг R2-д хадгалж,
  // D1-д зөвхөн бодитоор уншигддаг `transcript_text`-ийг үлдээнэ
  // (`transcript_json` баганыг хаана ч уншдаггүй тул NULL).  Audio аль хэдийн
  // R2-д байгаа тул transcript-ийг ч мөн адил тэнд хадгалах нь зөв.
  try {
    await env.MEETING_BUCKET.put(`meetings/${meetingId}/transcript.json`, JSON.stringify(json), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch (err) {
    // R2 бичилт амжилтгүй ч transcript_text хадгалагдсан хэвээр — best-effort,
    // транскрипцийг бүхэлд нь унагахгүй.
    console.error('transcript_json R2 put failed', err);
  }

  await env.DB.prepare(
    `INSERT INTO meeting_transcripts
       (meeting_id, language, transcript_text, transcript_json, speaker_count, word_count, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
     ON CONFLICT(meeting_id) DO UPDATE SET
       language = excluded.language,
       transcript_text = excluded.transcript_text,
       transcript_json = excluded.transcript_json,
       speaker_count = excluded.speaker_count,
       word_count = excluded.word_count,
       created_at = datetime('now')`,
  )
    .bind(meetingId, parsed.language, parsed.text, null, parsed.speakerCount, parsed.wordCount)
    .run();

  await env.DB.prepare(
    `UPDATE meeting_recordings
        SET stt_status='success', completed_at=datetime('now'), duration_seconds=?
      WHERE meeting_id=? AND stt_job_id=?`,
  )
    .bind(parsed.durationSeconds, meetingId, jobId)
    .run();

  await env.DB.prepare(
    `UPDATE meetings SET status='transcribed', error=NULL, updated_at=datetime('now') WHERE id=?`,
  )
    .bind(meetingId)
    .run();

  return { done: true, shouldAnalyze: autoAnalyzeEnabled(env) };
}

interface StuckRow {
  meeting_id: number;
  stt_job_id: string;
}

/**
 * Cron backstop for missed webhooks.  Finds meetings stuck in `transcribing`
 * for more than a couple of minutes, checks the job, and finalises (+ analyses)
 * the done ones / fails the rejected ones.  Bounded per run.
 */
export async function reconcileMeetings(env: Env): Promise<void> {
  if (!env.SPEECHMATICS_API_KEY) return;

  const { results } = await env.DB.prepare(
    `SELECT mr.meeting_id AS meeting_id, mr.stt_job_id AS stt_job_id
       FROM meeting_recordings mr
       JOIN meetings m ON m.id = mr.meeting_id
      WHERE m.status = 'transcribing'
        AND mr.stt_job_id IS NOT NULL
        AND mr.submitted_at IS NOT NULL
        AND mr.submitted_at <= datetime('now', '-2 minutes')
      ORDER BY mr.submitted_at ASC
      LIMIT 10`,
  ).all<StuckRow>();

  for (const row of results ?? []) {
    try {
      const info = await fetchJobInfo(env, row.stt_job_id);
      if (!info) continue;
      if (info.status === 'done') {
        const { shouldAnalyze } = await finalizeTranscript(env, row.meeting_id, row.stt_job_id);
        if (shouldAnalyze) await runMeetingAnalysis(env, row.meeting_id);
      } else if (info.status === 'rejected') {
        await markTranscribeFailed(env, row.meeting_id, 'error', 'Speechmatics rejected the job');
      }
      // 'running' → leave it; next cron tick re-checks.
    } catch (err) {
      console.error('[reconcileMeetings] job', row.stt_job_id, err);
    }
  }
}
