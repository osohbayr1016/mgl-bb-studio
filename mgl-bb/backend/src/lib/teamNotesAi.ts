/**
 * Per-team progress notes (Тэмдэглэл) — AI summary
 *
 * Counterpart to `taskCompletionAi.ts` but at the (project, team) level
 * rather than the (task) level.  Folds the four canonical answers into
 * a 3–5 sentence Mongolian summary aimed at a project manager, then
 * caches it on `project_team_notes.ai_summary` so the report can quote
 * it without re-running the model on every page load.
 *
 * Like `summarizeTaskCompletion`, this runs from `c.executionCtx.waitUntil`
 * so the PUT response never waits on the model and failures only log.
 */

export interface TeamNoteQuestion {
  id: string;
  text: string;
}

/** Canonical question set, also exported so the route can fall back when
 *  a project hasn't customised them yet.  Frontend mirrors this list.
 *
 *  History:
 *  - v1 (initial): 4 problem-oriented questions (client docs, inter-team
 *    deps, resolution, schedule + resources).
 *  - v2 (current): generalised q2 to be team-agnostic — was "Барилга
 *    архитектурын..." which awkwardly meta-asked the BA team about
 *    itself; now asks about any upstream team. Added q5 to capture
 *    positive accomplishments so the AI summary + printed report has
 *    something to lead with instead of being purely problem-focused. */
export const TEAM_NOTE_QUESTIONS: TeamNoteQuestion[] = [
  { id: 'q1', text: 'Захиалагчаас бичиг баримт хугацаандаа бүрэн ирсэн үү?' },
  {
    id: 'q2',
    text: 'Бусад багаас шаардлагатай зураг / даалгавар / шийдэл ирсэн үү? Өөрчлөлт орж байгаа юу? Хүлээгдэж буй зүйл байгаа юу?',
  },
  {
    id: 'q3',
    text: 'Дээрх асуудлыг шийдсэн үү? Хэрхэн шийдсэн, эсвэл яагаад шийдэгдээгүй байгааг бичнэ үү.',
  },
  {
    id: 'q4',
    text: 'Ажлын зургийн явц төлөвлөгөөт хугацаандаа үргэлжилж байна уу? Хэрэв үгүй бол нэмэлт шаардлагатай зүйл (хүн хүч, хугацаа г.м.) байгаа юу?',
  },
  { id: 'q5', text: 'Энэ хугацаанд гүйцэтгэсэн гол ажил юу вэ? (товч 2–3 өгүүлбэрээр)' },
];

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

interface SummarizeOpts {
  db: D1Database;
  ai: Ai;
  projectId: number;
  teamCode: string;
}

interface ContextRow {
  project_name: string;
  team_name_mn: string | null;
  answers_json: string | null;
}

/**
 * Load the saved answers for one (project, team), call Workers AI, and
 * persist the resulting summary.  Errors are swallowed and only logged —
 * a model hiccup must never roll back the (already-successful) note save.
 */
export async function summarizeTeamNotes({
  db,
  ai,
  projectId,
  teamCode,
}: SummarizeOpts): Promise<void> {
  try {
    const ctx = await db
      .prepare(
        `
      SELECT p.name AS project_name,
             tm.name_mn AS team_name_mn,
             ptn.answers_json
      FROM project_team_notes ptn
      JOIN projects p ON p.id = ptn.project_id
      LEFT JOIN teams tm ON tm.code = ptn.team_code
      WHERE ptn.project_id = ? AND ptn.team_code = ?
    `,
      )
      .bind(projectId, teamCode)
      .first<ContextRow>();
    if (!ctx) return;

    let answers: Record<string, string> = {};
    if (ctx.answers_json) {
      try {
        answers = JSON.parse(ctx.answers_json) ?? {};
      } catch {
        /* ignore */
      }
    }

    // Bail out if the user hasn't actually answered anything yet — running
    // the model on four empty strings wastes tokens and returns a generic
    // "no information provided" paragraph.
    const hasAny = TEAM_NOTE_QUESTIONS.some((q) => (answers[q.id] ?? '').trim().length > 0);
    if (!hasAny) {
      await db
        .prepare(
          `UPDATE project_team_notes
         SET ai_summary = NULL, ai_summary_at = NULL
         WHERE project_id = ? AND team_code = ?`,
        )
        .bind(projectId, teamCode)
        .run();
      return;
    }

    const qaBlock = TEAM_NOTE_QUESTIONS.map(
      (q) => `- ${q.text}\n  Хариулт: ${(answers[q.id] ?? '').trim() || '(хоосон)'}`,
    ).join('\n');

    const userPrompt = [
      `Төсөл: ${ctx.project_name}`,
      `Баг: ${ctx.team_name_mn ?? teamCode}`,
      '',
      'Тэмдэглэлийн асуулт-хариулт:',
      qaBlock,
    ].join('\n');

    const result = (await ai.run(AI_MODEL, {
      messages: [
        {
          role: 'system',
          content:
            'Чи бол барилгын зураг төслийн менежерт зориулсан туслах. ' +
            'Хэрэглэгчийн өгсөн багийн тайлбар тэмдэглэлд тулгуурлан ' +
            'монгол хэл дээр 3-5 өгүүлбэрийн товч, албан ёсны дүгнэлт бич. ' +
            'Захиалагчаас ирсэн бичиг баримт, бусад багтай зохицуулалт, шийдэгдсэн/шийдэгдээгүй асуудал, ' +
            'хугацааны хүрэлцээг тодорхой дурдана уу. Жагсаалт биш, ' +
            'нийтэлж болохуйц цэвэр текст байг.',
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
        `UPDATE project_team_notes
       SET ai_summary = ?, ai_summary_at = ?
       WHERE project_id = ? AND team_code = ?`,
      )
      .bind(summary, new Date().toISOString(), projectId, teamCode)
      .run();
  } catch (err) {
    console.error('[teamNotesAi] summarize failed:', err);
  }
}
