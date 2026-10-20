/**
 * Зохиогчийн хяналт (ASR) — дуу бичлэгийн транскрипцийн финализаци + reconcile.
 *
 * `lib/meetingTranscription.ts`-ийн ах дүү файл: Speechmatics-ийн webhook
 * (`routes/speechmatics.ts`, `?kind=asr`) БОЛОН cron backstop
 * (`index.ts`-ийн `scheduled`) хоёул ижил зүйл хийх ёстой — json-v2-г татаж,
 * текст болгож, мөрөө хаах.  Тэр логикийг ганц газар байлгахын тулд энд.
 *
 * ═══ Яагаад хурлынхыг ДАХИН АШИГЛААГҮЙ вэ ═══
 * `finalizeTranscript` нь `meetings.status`-ыг өөрчилж, `meeting_transcripts`
 * руу UPSERT хийж, `runMeetingAnalysis`-ыг тавьдаг — гурвуулаа ASR-д утгагүй.
 * Түүнийг «хоёр төрлийг ойлгодог» болгож ерөнхийчилбөл хурлын урсгал руу
 * эрсдэл шургуулна.  Хуваалцаж байгаа зүйл нь `lib/speechmatics.ts` —
 * `submitJob` / `fetchJobInfo` / `fetchTranscriptJson` / `parseTranscript`
 * бүгд өөрчлөгдөөгүй хэвээр ажиллана.
 *
 * ═══ Аудио хаана байдаг вэ ═══
 * `MEETING_BUCKET` — PRIVATE R2.  Binding-ийн нэр нь хуучирсан: тэр bucket
 * бол «STT-д зориулсан хувийн bucket», зөвхөн хурлынх БИШ.  Талбайн дуу
 * бичлэгийг `MEDIA_BUCKET` руу тавьж БОЛОХГҮЙ — `/media/:key` нь
 * баталгаажуулалтгүй, түлхүүрээ мэдсэн хэн ч уншина (CLAUDE.md → Security
 * #2).  Уншилт нь зөвхөн `signAudioUrl` → `/meeting-audio/:key?t=`.
 */

import type { Env } from '../types';
import { fetchJobInfo, fetchTranscriptJson, parseTranscript } from './speechmatics';

/**
 * Аль хэдийн дууссан гэсэн утгатай төлөвүүд.  Webhook болон cron reconcile
 * хоёр нэг job-ыг зэрэг финализ хийхээс хамгаална (хурлынхтай ижил хамгаалалт).
 */
const ALREADY_DONE = new Set(['success', 'error', 'fetch_error', 'trim_error']);

export async function markAsrTranscribeFailed(
  env: Env,
  recordingId: number,
  sttStatus: string,
  error: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE asr_recordings
        SET stt_status = ?, error = ?, completed_at = datetime('now')
      WHERE id = ? AND completed_at IS NULL`,
  )
    .bind(sttStatus, error.slice(0, 300), recordingId)
    .run();
}

/**
 * Дууссан job-ийн транскриптийг татаж, мөрөнд бичнэ.  Idempotent — аль
 * хэдийн хаагдсан мөр дээр дахин дуудвал `false` буцаана.
 */
export async function finalizeAsrTranscript(
  env: Env,
  recordingId: number,
  jobId: string,
): Promise<boolean> {
  const row = await env.DB.prepare('SELECT stt_status FROM asr_recordings WHERE id = ?')
    .bind(recordingId)
    .first<{ stt_status: string | null }>();
  if (!row) return false;
  if (row.stt_status && ALREADY_DONE.has(row.stt_status)) return false;

  const json = await fetchTranscriptJson(env, jobId);
  const parsed = parseTranscript(json);

  // ⚠️ Бүрэн json-v2-г ХАДГАЛАХГҮЙ.  Талбайн бичлэг богино тул D1-ийн
  //    `SQLITE_TOOBIG` эрсдэл бага ч, бидэнд үг тус бүрийн timing хэрэггүй —
  //    зөвхөн текст нь тайлангийн талбар руу ордог.  (Хурлын урсгалын
  //    «json нь R2-д, D1-д NULL» конвенцийг энд огт хөндөөгүй.)
  await env.DB.prepare(
    `UPDATE asr_recordings
        SET stt_status = 'success',
            transcript_text = ?,
            language = ?,
            duration_seconds = COALESCE(?, duration_seconds),
            error = NULL,
            completed_at = datetime('now')
      WHERE id = ?`,
  )
    .bind(parsed.text, parsed.language, parsed.durationSeconds, recordingId)
    .run();

  return true;
}

interface StuckAsrRow {
  id: number;
  stt_job_id: string;
}

/**
 * Алдагдсан webhook-ийн cron нөөц зам.  `reconcileMeetings`-ийн яг тэр
 * хэлбэр: 2 минутаас удаан «илгээгдсэн ч дуусаагүй» мөрүүдийг шалгаж,
 * дууссаныг нь хаана.  Нэг ажиллалтад 10-аар хязгаарласан.
 *
 * ⚠️ ШИНЭ cron илэрхийлэл НЭМЭХГҮЙ.  `index.ts`-ийн `scheduled` нь
 *    `'* * * * *'`-ээс БУСАД бүх мөрөнд энэ дөрвөлийг ажиллуулдаг тул
 *    гурав дахь илэрхийлэл нэмбэл бүгд ДАВХАР ажиллана.  Энэ нь тэр
 *    байгаа салаанд нэмэгддэг (CLAUDE.md → Cron).
 */
export async function reconcileAsrRecordings(env: Env): Promise<void> {
  if (!env.SPEECHMATICS_API_KEY) return;

  const { results } = await env.DB.prepare(
    `SELECT id, stt_job_id
       FROM asr_recordings
      WHERE stt_job_id IS NOT NULL
        AND completed_at IS NULL
        AND submitted_at IS NOT NULL
        AND submitted_at <= datetime('now', '-2 minutes')
      ORDER BY submitted_at ASC
      LIMIT 10`,
  ).all<StuckAsrRow>();

  for (const row of results ?? []) {
    try {
      const info = await fetchJobInfo(env, row.stt_job_id);
      if (!info) continue;
      if (info.status === 'done') {
        await finalizeAsrTranscript(env, row.id, row.stt_job_id);
      } else if (info.status === 'rejected') {
        await markAsrTranscribeFailed(env, row.id, 'error', 'Speechmatics rejected the job');
      }
      // 'running' → орхино; дараагийн cron дахин шалгана.
    } catch (err) {
      console.error('[reconcileAsrRecordings] job', row.stt_job_id, err);
    }
  }
}
