import { Hono } from 'hono';
import { requireManager } from '../middleware/auth';
import { TEAM_REPORT_STATUS_QUESTIONS } from '../lib/teamReportStatusQuestions';
import type { Env, AppVariables } from '../types';

/**
 * Status-question sentence starters (clickable chips).
 *
 * Per team, per status question (q1..q5), up to 3 short phrases the
 * editor can click to seed an answer.  Storage is one row per
 * (team_code, question_id) with `starters_json` holding the array
 * (see migration 0073).
 *
 * GET /api/status-starters/:teamCode
 *   Returns all five question entries for the given team, filling
 *   missing rows with empty arrays so the frontend doesn't need to
 *   coalesce.  Any logged-in user can read.
 *
 * PUT /api/status-starters/:teamCode/:questionId
 *   Replace the (up to 3) starters for one (team, question).
 *   Admin tier + senior roles (the same set that owns team config
 *   elsewhere — see `requireManager`).  Empty array clears the row.
 */

const STARTERS_PER_QUESTION_MAX = 3;
const STARTER_TEXT_MAX_LENGTH = 120;

const status = new Hono<{ Bindings: Env; Variables: AppVariables }>();

interface StarterRow {
  team_code: string;
  question_id: string;
  starters_json: string;
  updated_at: string;
  updated_by_id: number | null;
}

export interface StatusQuestionStarters {
  team_code: string;
  question_id: string;
  starters: string[];
  updated_at: string;
  updated_by_id: number | null;
}

function parseStarters(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, STARTERS_PER_QUESTION_MAX);
  } catch {
    return [];
  }
}

function rowToResource(row: StarterRow): StatusQuestionStarters {
  return {
    team_code: row.team_code,
    question_id: row.question_id,
    starters: parseStarters(row.starters_json),
    updated_at: row.updated_at,
    updated_by_id: row.updated_by_id,
  };
}

status.get('/:teamCode', async (c) => {
  const teamCode = c.req.param('teamCode').toUpperCase();
  const rows = await c.env.DB.prepare(
    'SELECT team_code, question_id, starters_json, updated_at, updated_by_id FROM status_question_starters WHERE team_code = ?',
  )
    .bind(teamCode)
    .all<StarterRow>();

  // Map saved rows by question id, then build the full canonical list so
  // the frontend always gets exactly len(TEAM_REPORT_STATUS_QUESTIONS)
  // entries in the same order — no need to coalesce missing rows there.
  const byQuestion = new Map<string, StarterRow>();
  for (const r of rows.results ?? []) byQuestion.set(r.question_id, r);

  const entries: StatusQuestionStarters[] = TEAM_REPORT_STATUS_QUESTIONS.map((q) => {
    const r = byQuestion.get(q.id);
    return r
      ? rowToResource(r)
      : {
          team_code: teamCode,
          question_id: q.id,
          starters: [],
          updated_at: '',
          updated_by_id: null,
        };
  });

  return c.json({ entries });
});

status.put('/:teamCode/:questionId', requireManager(), async (c) => {
  const teamCode = c.req.param('teamCode').toUpperCase();
  const questionId = c.req.param('questionId');
  const user = c.get('user');

  // Validate the question id against the canonical list so a typo here
  // can't pollute the table with rows the frontend will never render.
  const validIds = new Set(TEAM_REPORT_STATUS_QUESTIONS.map((q) => q.id));
  if (!validIds.has(questionId as (typeof TEAM_REPORT_STATUS_QUESTIONS)[number]['id'])) {
    return c.json({ error: `Unknown question_id: ${questionId}` }, 400);
  }

  let body: { starters?: unknown };
  try {
    body = await c.req.json<{ starters?: unknown }>();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  if (!Array.isArray(body.starters)) {
    return c.json({ error: 'Body must include `starters: string[]`.' }, 400);
  }

  // Sanitise: drop non-strings, trim, drop blanks, cap each entry's
  // length, and cap the array at 3 (the contract the frontend renders).
  const clean = (body.starters as unknown[])
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => s.slice(0, STARTER_TEXT_MAX_LENGTH))
    .slice(0, STARTERS_PER_QUESTION_MAX);

  await c.env.DB.prepare(
    `
      INSERT INTO status_question_starters
        (team_code, question_id, starters_json, updated_at, updated_by_id)
      VALUES (?, ?, ?, datetime('now'), ?)
      ON CONFLICT(team_code, question_id) DO UPDATE SET
        starters_json = excluded.starters_json,
        updated_at = excluded.updated_at,
        updated_by_id = excluded.updated_by_id
    `,
  )
    .bind(teamCode, questionId, JSON.stringify(clean), user?.sub ?? null)
    .run();

  const row = await c.env.DB.prepare(
    'SELECT team_code, question_id, starters_json, updated_at, updated_by_id FROM status_question_starters WHERE team_code = ? AND question_id = ?',
  )
    .bind(teamCode, questionId)
    .first<StarterRow>();

  if (!row) return c.json({ error: 'Saved row not found' }, 500);
  return c.json({ entry: rowToResource(row) });
});

export default status;
