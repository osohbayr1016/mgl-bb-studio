/**
 * Task completion AI summary
 *
 * When a worker reports a task as 100% done they answer a small set of
 * Mongolian questions (e.g. "What did you finish?", "Any blockers?",
 * "Next step?"). This module:
 *
 *   1. Loads the most recent 100% entry for the task (its `completion_qa`),
 *      a few of the latest free-text `notes`, and the task / project name.
 *   2. Asks Cloudflare Workers AI to fold all of that into a short, formal
 *      Mongolian-language summary aimed at a project manager.
 *   3. Caches the result on `tasks.ai_completion_summary` so the UI can read
 *      it without re-calling the model on every page load.
 *
 * The whole flow is best-effort — failures are swallowed and only logged.
 * It runs from `c.executionCtx.waitUntil(...)` so the original POST /progress
 * response never waits on the model.
 */

export interface CompletionQuestion {
  id: string;
  text: string;
}

/** Default questions used when a project has no `completion_questions` set. */
export const DEFAULT_COMPLETION_QUESTIONS: CompletionQuestion[] = [
  { id: 'done', text: 'Та юу хийж дуусгасан бэ?' },
  { id: 'issues', text: 'Тулгарсан асуудал, эрсдэл байсан уу?' },
  { id: 'next', text: 'Дараагийн алхам, шилжүүлэх ёстой зүйл юу вэ?' },
];

/** Parse the JSON column safely; falls back to defaults on any error. */
export function parseCompletionQuestions(json: string | null | undefined): CompletionQuestion[] {
  if (!json) return DEFAULT_COMPLETION_QUESTIONS;
  try {
    const parsed = JSON.parse(json);
    if (
      Array.isArray(parsed) &&
      parsed.every((q) => q && typeof q.id === 'string' && typeof q.text === 'string')
    ) {
      return parsed;
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_COMPLETION_QUESTIONS;
}

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

interface SummarizeOpts {
  db: D1Database;
  ai: Ai;
  taskId: number;
}

interface ContextRow {
  task_name: string;
  project_name: string;
  completion_questions: string | null;
  completion_qa: string | null;
}

/**
 * Read the task context, call Workers AI, and persist the result.
 * Errors never throw — they're logged and the cached column stays as-is.
 */
export async function summarizeTaskCompletion({ db, ai, taskId }: SummarizeOpts): Promise<void> {
  try {
    const ctx = await db
      .prepare(
        `
      SELECT t.name          AS task_name,
             p.name          AS project_name,
             p.completion_questions,
             (SELECT pe.completion_qa FROM progress_entries pe
              WHERE pe.task_id = t.id AND pe.completion_qa IS NOT NULL
              ORDER BY pe.created_at DESC LIMIT 1) AS completion_qa
      FROM tasks t
      JOIN components c ON c.id = t.component_id
      JOIN drawings   d ON d.id = c.drawing_id
      JOIN blocks     b ON b.id = d.block_id
      JOIN projects   p ON p.id = b.project_id
      WHERE t.id = ?
    `,
      )
      .bind(taskId)
      .first<ContextRow>();
    if (!ctx) return;

    const questions = parseCompletionQuestions(ctx.completion_questions);
    let answers: Record<string, string> = {};
    if (ctx.completion_qa) {
      try {
        answers = JSON.parse(ctx.completion_qa) ?? {};
      } catch {
        /* ignore */
      }
    }

    const { results: noteRows } = await db
      .prepare(
        `
      SELECT pe.notes, pe.date, u.full_name
      FROM progress_entries pe
      LEFT JOIN users u ON u.id = pe.user_id
      WHERE pe.task_id = ?
        AND pe.notes IS NOT NULL AND TRIM(pe.notes) != ''
      ORDER BY pe.created_at DESC
      LIMIT 8
    `,
      )
      .bind(taskId)
      .all<{ notes: string; date: string; full_name: string | null }>();

    const qaBlock = questions
      .map((q) => `- ${q.text}\n  Хариулт: ${(answers[q.id] ?? '').trim() || '(хоосон)'}`)
      .join('\n');

    const notesBlock =
      (noteRows ?? [])
        .map((r) => `- [${r.date}] ${r.full_name ?? 'Тодорхойгүй'}: ${r.notes.trim()}`)
        .join('\n') || '(тэмдэглэл байхгүй)';

    const userPrompt = [
      `Төсөл: ${ctx.project_name}`,
      `Даалгавар: ${ctx.task_name}`,
      '',
      'Дуусгах асуулт-хариулт:',
      qaBlock,
      '',
      'Сүүлийн өдөр тутмын тэмдэглэлүүд:',
      notesBlock,
    ].join('\n');

    const result = (await ai.run(AI_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'Чи бол барилгын төслийн менежерт зориулсан туслах. ' +
            'Хэрэглэгчийн өгсөн даалгаврын тайлан, асуулт-хариулт, тэмдэглэлд тулгуурлан ' +
            'монгол хэл дээр 3-5 өгүүлбэрийн товч, албан ёсны дүгнэлт бич. ' +
            'Юу хийж дуусгасан, эрсдэл/саад, дараагийн алхамыг тодорхой дурдана уу. ' +
            'Жагсаалт биш, нийтэлж болохуйц цэвэр текст байг.',
        },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 400,
    } as AiTextGenerationInput)) as AiTextGenerationOutput;

    const summary = (
      typeof result === 'object' && result && 'response' in result
        ? String((result as { response?: unknown }).response ?? '')
        : ''
    ).trim();
    if (!summary) return;

    await db
      .prepare(
        `UPDATE tasks SET ai_completion_summary = ?, ai_completion_summary_at = ? WHERE id = ?`,
      )
      .bind(summary, new Date().toISOString(), taskId)
      .run();
  } catch (err) {
    console.error('[taskCompletionAi] summarize failed:', err);
  }
}
