/**
 * Meeting analysis (Хурлын тэмдэглэлийн дүн шинжилгээ) via Workers AI.
 *
 * Reuses the repo's existing Workers-AI pattern (see lib/taskCompletionAi.ts):
 * Llama 3.1 8B, Mongolian system prompts, `.response` extraction, best-effort
 * (failures are logged, the meeting is flagged `analyze_failed`, nothing throws
 * up to the caller).  Designed to run from `executionCtx.waitUntil(...)` so the
 * webhook / request never blocks on the model.
 *
 * Long transcripts are handled map-reduce style: chunk → summarise each chunk →
 * summarise the chunk-summaries, then a second pass extracts decisions and
 * action items as JSON.
 */

import type { Env } from '../types';

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

/** ~3500 chars/chunk keeps each call well inside the model's context. */
const CHUNK_SIZE = 3500;
/** Bound the number of map calls so a huge transcript can't fan out forever. */
const MAX_CHUNKS = 15;

interface MeetingCtxRow {
  title: string;
  meeting_date: string | null;
  attendees: string | null;
  language: string;
  transcript_text: string | null;
}

async function aiText(env: Env, system: string, user: string, maxTokens: number): Promise<string> {
  const result = (await env.AI.run(AI_MODEL, {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
  } as AiTextGenerationInput)) as AiTextGenerationOutput;
  return (
    typeof result === 'object' && result && 'response' in result
      ? String((result as { response?: unknown }).response ?? '')
      : ''
  ).trim();
}

/** Split on paragraph (turn) boundaries, packing up to CHUNK_SIZE per chunk. */
function chunkTranscript(text: string): string[] {
  const paras = text.split(/\n\n+/);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if (buf && buf.length + p.length + 2 > CHUNK_SIZE) {
      chunks.push(buf);
      buf = '';
    }
    buf = buf ? `${buf}\n\n${p}` : p;
    if (buf.length >= CHUNK_SIZE) {
      chunks.push(buf);
      buf = '';
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

const SUMMARY_SYSTEM =
  'Чи бол барилгын инженерийн фирмийн хурлын тэмдэглэлийн туслах. Уулзалтын ярианы ' +
  'тэмдэглэлд тулгуурлан МОНГОЛ хэл дээр 3-6 өгүүлбэрийн товч, албан ёсны дүгнэлт бич. ' +
  'Юу хэлэлцсэн, ямар гол санал/санаа гарсныг тодорхой дурд. Зөвхөн өгөгдсөн агуулгад ' +
  'тулгуурла, зохиомжилж бүү нэм. Жагсаалт биш, нийтэлж болохуйц цэвэр текст байг.';

const STRUCT_SYSTEM =
  'Чи бол хурлын тэмдэглэлийн туслах. Доорх хурлын агуулгаас гарсан ШИЙДВЭРҮҮД ' +
  '(decisions) болон ХИЙХ АЖЛУУД (action_items)-ыг МОНГОЛ хэлээр гарга. Зөвхөн ' +
  'өгөгдсөн агуулгад тулгуурла. Хариуг ЗӨВХӨН дараах JSON форматаар буцаа, өөр ямар ч ' +
  'текст бүү нэм:\n' +
  '{"decisions":["..."],"action_items":[{"text":"...","owner":"","due":""}]}\n' +
  'owner (хариуцагч) болон due (хугацаа) мэдэгдэхгүй бол хоосон мөр "" үлдээ. ' +
  'Шийдвэр/ажил байхгүй бол хоосон массив [] буцаа.';

export interface MeetingAnalysisResult {
  summary: string;
  decisions: string[];
  actionItems: Array<{ text: string; owner?: string; due?: string }>;
}

function parseStructured(raw: string): {
  decisions: string[];
  actionItems: Array<{ text: string; owner?: string; due?: string }>;
} {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return { decisions: [], actionItems: [] };
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as {
      decisions?: unknown;
      action_items?: unknown;
    };
    const decisions = Array.isArray(obj.decisions)
      ? obj.decisions.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
      : [];
    const actionItems = Array.isArray(obj.action_items)
      ? obj.action_items
          .map((a) => {
            if (typeof a === 'string') return { text: a };
            if (a && typeof a === 'object') {
              const o = a as Record<string, unknown>;
              const text = typeof o.text === 'string' ? o.text : '';
              if (!text.trim()) return null;
              return {
                text,
                owner: typeof o.owner === 'string' && o.owner.trim() ? o.owner : undefined,
                due: typeof o.due === 'string' && o.due.trim() ? o.due : undefined,
              };
            }
            return null;
          })
          .filter((x): x is { text: string; owner?: string; due?: string } => !!x)
      : [];
    return { decisions, actionItems };
  } catch {
    return { decisions: [], actionItems: [] };
  }
}

/**
 * Run the full analysis for a meeting and persist it.  Updates
 * `meetings.status` to 'analyzing' → 'analyzed' (or 'analyze_failed') and
 * upserts the `meeting_analyses` row.  Never throws.
 */
export async function runMeetingAnalysis(env: Env, meetingId: number): Promise<void> {
  try {
    // Хүний зассан эцсийн текст (meetings.final_text, 0333) байвал түүнийг
    // илүүд үзнэ — Speechmatics-ийн түүхий гаралтаас илүү найдвартай, мөн
    // бичлэггүй (гараар бичсэн) хуралд транскрипт огт байхгүй.
    const ctx = await env.DB.prepare(
      `SELECT m.title, m.meeting_date, m.attendees, m.language,
              COALESCE(NULLIF(m.final_text, ''), mt.transcript_text) AS transcript_text
         FROM meetings m
         LEFT JOIN meeting_transcripts mt ON mt.meeting_id = m.id
        WHERE m.id = ?`,
    )
      .bind(meetingId)
      .first<MeetingCtxRow>();

    const transcript = ctx?.transcript_text?.trim();
    if (!ctx || !transcript) {
      await env.DB.prepare(
        `UPDATE meetings SET status='analyze_failed', error='No transcript to analyse', updated_at=datetime('now') WHERE id=?`,
      )
        .bind(meetingId)
        .run();
      return;
    }

    await env.DB.prepare(
      `UPDATE meetings SET status='analyzing', error=NULL, updated_at=datetime('now') WHERE id=?`,
    )
      .bind(meetingId)
      .run();

    const header = [
      `Уулзалтын сэдэв: ${ctx.title}`,
      ctx.meeting_date ? `Огноо: ${ctx.meeting_date}` : null,
      ctx.attendees ? `Оролцогчид: ${ctx.attendees}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    // --- map-reduce summary ---
    const chunks = chunkTranscript(transcript);
    let summary: string;
    if (chunks.length <= 1) {
      summary = await aiText(
        env,
        SUMMARY_SYSTEM,
        `${header}\n\nЯрианы тэмдэглэл:\n${chunks[0] ?? transcript}`,
        400,
      );
    } else {
      const used = chunks.slice(0, MAX_CHUNKS);
      const partials: string[] = [];
      for (let i = 0; i < used.length; i++) {
        const part = await aiText(
          env,
          SUMMARY_SYSTEM,
          `${header}\n\nЯрианы тэмдэглэлийн ${i + 1}-р хэсэг:\n${used[i]}`,
          250,
        );
        if (part) partials.push(part);
      }
      const truncatedNote =
        chunks.length > MAX_CHUNKS ? '\n\n(Тэмдэглэл хэт урт тул эхний хэсгүүдийг авав.)' : '';
      summary = await aiText(
        env,
        SUMMARY_SYSTEM,
        `${header}\n\nХурлын хэсэгчилсэн дүгнэлтүүд:\n${partials.join('\n\n')}${truncatedNote}`,
        450,
      );
    }

    // --- decisions + action items (JSON pass over the summary) ---
    const structRaw = await aiText(
      env,
      STRUCT_SYSTEM,
      `${header}\n\nХурлын дүгнэлт:\n${summary || transcript.slice(0, CHUNK_SIZE)}`,
      500,
    );
    const { decisions, actionItems } = parseStructured(structRaw);

    await env.DB.prepare(
      `INSERT INTO meeting_analyses (meeting_id, summary, decisions_json, action_items_json, model, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
       ON CONFLICT(meeting_id) DO UPDATE SET
         summary = excluded.summary,
         decisions_json = excluded.decisions_json,
         action_items_json = excluded.action_items_json,
         model = excluded.model,
         created_at = datetime('now')`,
    )
      .bind(
        meetingId,
        summary || null,
        JSON.stringify(decisions),
        JSON.stringify(actionItems),
        AI_MODEL,
      )
      .run();

    await env.DB.prepare(
      `UPDATE meetings SET status='analyzed', error=NULL, updated_at=datetime('now') WHERE id=?`,
    )
      .bind(meetingId)
      .run();
  } catch (err) {
    console.error('[meetingAnalysisAi] analysis failed:', err);
    try {
      await env.DB.prepare(
        `UPDATE meetings SET status='analyze_failed', error=?, updated_at=datetime('now') WHERE id=?`,
      )
        .bind(err instanceof Error ? err.message.slice(0, 300) : 'analysis failed', meetingId)
        .run();
    } catch {
      /* ignore */
    }
  }
}
