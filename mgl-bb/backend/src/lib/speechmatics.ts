/**
 * Speechmatics batch (async) speech-to-text — Хурлын тэмдэглэл pipeline.
 *
 * Flow (see routes/meetings.ts + routes/speechmatics.ts):
 *   1. `submitJob` POSTs a config-only batch job that tells Speechmatics to
 *      FETCH the audio from a short-lived signed `/meeting-audio/:key?t=<jwt>`
 *      URL (the audio lives in the PRIVATE MEETING_BUCKET, never on /media).
 *      It registers a `notification_config` webhook so Speechmatics POSTs back
 *      to `/speechmatics/callback?mid=<meetingId>` when the job finishes.
 *   2. On the callback (or via the cron reconcile backstop) we call
 *      `fetchTranscriptJson` to pull the authoritative json-v2 transcript, then
 *      `parseTranscript` to turn it into speaker-grouped Mongolian text.
 *
 * We deliberately do NOT rely on the transcript being inlined in the webhook
 * body — the webhook is only a "job done" ping; the worker fetches the
 * transcript itself so we're decoupled from the exact notification payload.
 *
 * Speechmatics keeps job data for ~7 days, so the worker (D1) is the store of
 * record once a transcript is fetched.
 */

import type { Env, JWTPayload } from '../types';
import { signToken } from './jwt';

/** Operating point for the language pack.  'enhanced' = best accuracy; if a
 *  language has no enhanced pack, switch this to 'standard'. */
const OPERATING_POINT: 'enhanced' | 'standard' = 'enhanced';

/** Signed-URL validity — Speechmatics fetches the audio at job start (usually
 *  within seconds), but jobs can queue, so give a generous window. */
const AUDIO_URL_TTL_HOURS = 6;

function baseUrl(env: Env): string {
  return (env.SPEECHMATICS_BASE_URL || 'https://eu1.asr.api.speechmatics.com/v2').replace(/\/$/, '');
}

function authHeader(env: Env): Record<string, string> {
  return { Authorization: `Bearer ${env.SPEECHMATICS_API_KEY ?? ''}` };
}

/**
 * Mint a short-lived signed URL that streams ONE private audio object.  Used
 * both for the Speechmatics fetch and for in-app playback (an `<audio>` tag
 * can't send an Authorization header, so the token rides in the query string).
 */
export async function signAudioUrl(
  env: Env,
  origin: string,
  key: string,
  user: { sub: number; role: JWTPayload['role'] },
  ttlHours: number = AUDIO_URL_TTL_HOURS,
): Promise<string> {
  const token = await signToken(
    { sub: user.sub, role: user.role, purpose: 'stt-audio', audio_key: key },
    env.JWT_SECRET,
    ttlHours,
  );
  return `${origin}/meeting-audio/${encodeURIComponent(key)}?t=${encodeURIComponent(token)}`;
}

export interface SubmitJobOpts {
  env: Env;
  /** Public origin of THIS worker (e.g. https://api.example.com) — used to build
   *  both the signed audio fetch URL and the notification callback URL. */
  origin: string;
  meetingId?: number;
  /**
   * Completion-webhook query string, WITHOUT the leading `?`.
   *
   * Omit it and the URL is `?mid=<meetingId>` — the original meeting
   * behaviour, byte for byte.  The Зохиогчийн хяналт (ASR) recorder passes
   * `kind=asr&rid=<recordingId>` instead, and `routes/speechmatics.ts`
   * branches on `kind` BEFORE any of the `mid` logic runs.  That branch is
   * the only reason this module knows a second consumer exists — the job
   * config, the signed audio URL and the transcript parsing are shared
   * unchanged.
   */
  callbackQuery?: string;
  audioKey: string;
  language: string;
  /** Uploader — used to sign the audio URL. */
  user: { sub: number; role: JWTPayload['role'] };
}

/**
 * Submit a batch transcription job.  Returns the Speechmatics job id.
 * Throws on any non-2xx so the caller can surface a clear failure.
 */
export async function submitJob(opts: SubmitJobOpts): Promise<string> {
  const { env, origin, meetingId, callbackQuery, audioKey, language, user } = opts;
  if (!env.SPEECHMATICS_API_KEY) throw new Error('SPEECHMATICS_API_KEY not configured');

  const audioUrl = await signAudioUrl(env, origin, audioKey, user);

  const config: Record<string, unknown> = {
    type: 'transcription',
    transcription_config: {
      language,
      operating_point: OPERATING_POINT,
      diarization: 'speaker',
    },
    fetch_data: { url: audioUrl },
  };

  // Register the completion webhook only when the shared secret is set — the
  // callback rejects unauthenticated POSTs, so without the secret it'd be dead.
  // The cron reconcile still finalizes the job either way.
  if (env.SPEECHMATICS_WEBHOOK_SECRET) {
    const callbackUrl = `${origin}/speechmatics/callback?${callbackQuery ?? `mid=${meetingId}`}`;
    config.notification_config = [
      {
        url: callbackUrl,
        // Speechmatics appends ?id=<jobId>&status=<success|error|...> to this URL.
        auth_headers: [`x-mgl-speechmatics-secret: ${env.SPEECHMATICS_WEBHOOK_SECRET}`],
        method: 'post',
      },
    ];
  }

  // The batch API wants multipart/form-data with a `config` JSON part; for a
  // fetch_data (URL-pull) job there is no `data_file` part.  Let fetch set the
  // multipart boundary — don't hand-set Content-Type.
  const form = new FormData();
  form.append('config', JSON.stringify(config));

  const res = await fetch(`${baseUrl(env)}/jobs`, {
    method: 'POST',
    headers: authHeader(env),
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Speechmatics job submit ${res.status}: ${text.slice(0, 500)}`);
  }
  let parsed: { id?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Speechmatics job submit: unparseable response: ${text.slice(0, 200)}`);
  }
  if (!parsed.id) throw new Error('Speechmatics job submit: response missing job id');
  return parsed.id;
}

/* ------------------------------------------------------------------ */
/*  Transcript fetch + parse                                          */
/* ------------------------------------------------------------------ */

interface JsonV2Alternative {
  content?: string;
  speaker?: string;
}
interface JsonV2Result {
  type?: 'word' | 'punctuation' | string;
  attaches_to?: 'previous' | 'next' | 'both' | 'none' | string;
  alternatives?: JsonV2Alternative[];
}
interface JsonV2 {
  job?: { duration?: number };
  metadata?: { transcription_config?: { language?: string } };
  results?: JsonV2Result[];
}

export interface JobInfo {
  id: string;
  status: string; // running | done | rejected
  duration?: number;
}

/** GET /v2/jobs/:id — used by the reconcile backstop to learn a stuck job's status. */
export async function fetchJobInfo(env: Env, jobId: string): Promise<JobInfo | null> {
  const res = await fetch(`${baseUrl(env)}/jobs/${encodeURIComponent(jobId)}`, {
    headers: authHeader(env),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { job?: { id?: string; status?: string; duration?: number } };
  const job = data.job;
  if (!job?.id || !job.status) return null;
  return { id: job.id, status: job.status, duration: job.duration };
}

/** GET /v2/jobs/:id/transcript?format=json-v2 — the authoritative transcript. */
export async function fetchTranscriptJson(env: Env, jobId: string): Promise<JsonV2> {
  const res = await fetch(
    `${baseUrl(env)}/jobs/${encodeURIComponent(jobId)}/transcript?format=json-v2`,
    { headers: authHeader(env) },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Speechmatics transcript fetch ${res.status}: ${t.slice(0, 300)}`);
  }
  return (await res.json()) as JsonV2;
}

export interface ParsedTranscript {
  text: string;
  speakerCount: number;
  wordCount: number;
  durationSeconds: number | null;
  language: string | null;
}

/** "S1" → "Илтгэгч 1"; "UU" (unknown) → "Тодорхойгүй". */
function speakerLabel(speaker: string): string {
  if (!speaker || speaker === 'UU') return 'Тодорхойгүй';
  const m = speaker.match(/^S(\d+)$/);
  return m ? `Илтгэгч ${m[1]}` : speaker;
}

/**
 * Fold json-v2 `results` into speaker-grouped plain text.  Consecutive words
 * from the same speaker form one turn; punctuation attaches to the running
 * turn without a leading space.
 */
export function parseTranscript(json: JsonV2): ParsedTranscript {
  const results = Array.isArray(json.results) ? json.results : [];
  type Turn = { speaker: string; text: string };
  const turns: Turn[] = [];
  let current: Turn | null = null;
  const speakers = new Set<string>();
  let wordCount = 0;

  for (const r of results) {
    const alt = r.alternatives?.[0];
    if (!alt) continue;
    const content = (alt.content ?? '').trim();
    if (!content) continue;

    if (r.type === 'punctuation') {
      if (current) current.text += content;
      continue;
    }

    // word
    wordCount += 1;
    const speaker = alt.speaker ?? 'UU';
    if (speaker && speaker !== 'UU') speakers.add(speaker);

    if (!current || current.speaker !== speaker) {
      current = { speaker, text: content };
      turns.push(current);
    } else {
      current.text += (current.text ? ' ' : '') + content;
    }
  }

  const text = turns.map((t) => `${speakerLabel(t.speaker)}: ${t.text}`).join('\n\n');

  return {
    text,
    speakerCount: speakers.size,
    wordCount,
    durationSeconds: typeof json.job?.duration === 'number' ? json.job.duration : null,
    language: json.metadata?.transcription_config?.language ?? null,
  };
}
