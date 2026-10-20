/**
 * Per-project / per-discipline chat threads.
 *
 * One thread per (project_id, team_code).  Clients see the team label
 * ("BA — Барилга архитектур") instead of the engineer's real identity;
 * engineers and admins see who actually authored each message.  The
 * anonymisation is done at the API layer here, not via a SQL view, so
 * the same row reads differently depending on the JWT.
 *
 * Auth model:
 *  - Anyone in `project_members` for the project can read the threads.
 *  - Clients can post into any of the project's threads (their question
 *    might be cross-team — they shouldn't have to know which team they
 *    need).
 *  - Engineers can post into the thread for their own team.
 *  - Admins can read + post into any thread.
 *
 * Anonymisation rules (applied to read endpoints only):
 *  - For client viewers, every non-client author is shown as
 *    `{ user_id: null, full_name: '<team label>', is_team_alias: true }`.
 *  - For client viewers, *other clients* on the same project are still
 *    shown by name (it's a multi-stakeholder project room — the other
 *    clients aren't the engineering side we want to hide).
 *  - Admins authoring messages appear as "Удирдлага / Admin" to clients
 *    rather than the team label, so clients can tell apart engineering
 *    answers from project-management answers.
 */
import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { latestApprovedPctByCreatedAt } from '../lib/progressLatest';

const router = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// The 10 official disciplines.  Mirrors the frontend constant in
// ProjectDetailPage.tsx — keep both lists in sync if the project ever
// gains a new discipline.
const DRAWING_DISCIPLINES: Array<{ code: string; label_mn: string }> = [
  { code: 'BA', label_mn: 'Барилга архитектур' },
  { code: 'BB', label_mn: 'Барилга бүтээц' },
  { code: 'HAS', label_mn: 'Халаалт агаар сэлгэлт' },
  { code: 'TSBU', label_mn: 'Цэвэр бохир ус' },
  { code: 'TSAH', label_mn: 'Цахилгаан' },
  { code: 'HD', label_mn: 'Холбоо дохиолол' },
  { code: 'AU', label_mn: 'Автомат удирдлага' },
  { code: 'EZ', label_mn: 'Эскиз зураг' },
  { code: 'IZ', label_mn: 'Интерьер зураг' },
  { code: 'GT', label_mn: 'Гадна тохижилт' },
];
const VALID_TEAM_CODES = new Set(DRAWING_DISCIPLINES.map((d) => d.code));
const TEAM_LABEL = new Map(DRAWING_DISCIPLINES.map((d) => [d.code, d.label_mn]));

/** Quick membership check used by every route in this file. */
async function isProjectMember(
  db: D1Database,
  projectId: number,
  userId: number,
): Promise<boolean> {
  const r = await db
    .prepare('SELECT 1 AS x FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1')
    .bind(projectId, userId)
    .first<{ x: number }>();
  return !!r;
}

/** Resolve a numeric project_id from a request param, validating membership. */
async function authorizeProject(
  db: D1Database,
  projectIdRaw: string,
  viewer: { sub: number; role: string },
): Promise<{ projectId: number } | { error: string; status: 400 | 403 | 404 }> {
  const projectId = Number(projectIdRaw);
  if (!Number.isFinite(projectId)) return { error: 'Invalid project id', status: 400 };
  const exists = await db
    .prepare('SELECT 1 AS x FROM projects WHERE id = ? LIMIT 1')
    .bind(projectId)
    .first<{ x: number }>();
  if (!exists) return { error: 'Project not found', status: 404 };
  if (viewer.role === 'admin') return { projectId };
  const member = await isProjectMember(db, projectId, viewer.sub);
  if (!member) return { error: 'Not a member of this project', status: 403 };
  return { projectId };
}

/** Find or create a thread row for (project, team_code). */
async function ensureThread(db: D1Database, projectId: number, teamCode: string): Promise<number> {
  const existing = await db
    .prepare('SELECT id FROM project_threads WHERE project_id = ? AND team_code = ? LIMIT 1')
    .bind(projectId, teamCode)
    .first<{ id: number }>();
  if (existing?.id) return existing.id;
  const ins = await db
    .prepare('INSERT INTO project_threads (project_id, team_code) VALUES (?, ?)')
    .bind(projectId, teamCode)
    .run();
  return Number(ins.meta.last_row_id);
}

// ----------------------------------------------------------------------
// GET /api/project-chat/projects/:projectId/threads
// Returns the 10 discipline threads for a project, with last-message
// preview + unread-ish hint (based on last_msg_at).
// ----------------------------------------------------------------------
router.get('/projects/:projectId/threads', async (c) => {
  const viewer = c.get('user');
  const auth = await authorizeProject(c.env.DB, c.req.param('projectId'), viewer);
  if ('error' in auth) return c.json({ error: auth.error }, auth.status);

  const rows = await c.env.DB.prepare(
    `
    SELECT t.id, t.team_code, t.last_msg_at,
           (SELECT COUNT(*) FROM project_thread_messages m
              WHERE m.thread_id = t.id AND m.deleted_at IS NULL) AS message_count
    FROM project_threads t
    WHERE t.project_id = ?
  `,
  )
    .bind(auth.projectId)
    .all<{
      id: number;
      team_code: string;
      last_msg_at: string | null;
      message_count: number;
    }>();
  const byCode = new Map((rows.results ?? []).map((r) => [r.team_code, r]));

  const threads = DRAWING_DISCIPLINES.map((d) => {
    const r = byCode.get(d.code);
    return {
      team_code: d.code,
      label_mn: d.label_mn,
      thread_id: r?.id ?? null,
      last_msg_at: r?.last_msg_at ?? null,
      message_count: r?.message_count ?? 0,
    };
  });

  return c.json({ project_id: auth.projectId, threads });
});

// ----------------------------------------------------------------------
// GET /api/project-chat/projects/:projectId/threads/:teamCode/messages
// Lists messages, anonymising non-client senders for client viewers.
// ----------------------------------------------------------------------
router.get('/projects/:projectId/threads/:teamCode/messages', async (c) => {
  const viewer = c.get('user');
  const auth = await authorizeProject(c.env.DB, c.req.param('projectId'), viewer);
  if ('error' in auth) return c.json({ error: auth.error }, auth.status);

  const teamCode = c.req.param('teamCode');
  if (!VALID_TEAM_CODES.has(teamCode)) return c.json({ error: 'Unknown team code' }, 400);

  const rows = await c.env.DB.prepare(
    `
    SELECT m.id, m.thread_id, m.sender_user_id, m.body, m.attachment_url,
           m.attachment_kind, m.created_at, m.deleted_at,
           u.full_name AS sender_full_name, u.role AS sender_role,
           pt.code AS sender_team_code, pt.name_mn AS sender_team_name_mn,
           u.profile_image AS sender_profile_image
    FROM project_thread_messages m
    JOIN project_threads th ON th.id = m.thread_id
    JOIN users u ON u.id = m.sender_user_id
    LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
    LEFT JOIN teams pt ON pt.id = ut_p.team_id
    WHERE th.project_id = ? AND th.team_code = ? AND m.deleted_at IS NULL
    ORDER BY m.created_at ASC
    LIMIT 500
  `,
  )
    .bind(auth.projectId, teamCode)
    .all<{
      id: number;
      thread_id: number;
      sender_user_id: number;
      body: string;
      attachment_url: string | null;
      attachment_kind: string | null;
      created_at: string;
      deleted_at: string | null;
      sender_full_name: string;
      sender_role: string;
      sender_team_code: string | null;
      sender_team_name_mn: string | null;
      sender_profile_image: string | null;
    }>();

  const isClient = viewer.role === 'client';
  const teamLabel = TEAM_LABEL.get(teamCode) ?? teamCode;

  const messages = (rows.results ?? []).map((r) => {
    const isMine = r.sender_user_id === viewer.sub;
    // For client viewers, hide engineer/admin identities — show only the
    // discipline alias (or a generic "Удирдлага" for admins).  For their
    // own messages and other clients in the same project, show real names.
    if (isClient && !isMine && r.sender_role !== 'client') {
      const alias = r.sender_role === 'admin' ? 'Удирдлага' : `${teamCode} — ${teamLabel}`;
      return {
        id: r.id,
        thread_id: r.thread_id,
        sender: {
          user_id: null as number | null,
          full_name: alias,
          role: 'team',
          team_code: teamCode,
          profile_image: null as string | null,
          is_alias: true,
        },
        body: r.body,
        attachment_url: r.attachment_url,
        attachment_kind: r.attachment_kind,
        created_at: r.created_at,
        is_mine: false,
      };
    }
    return {
      id: r.id,
      thread_id: r.thread_id,
      sender: {
        user_id: r.sender_user_id,
        full_name: r.sender_full_name,
        role: r.sender_role,
        team_code: r.sender_team_code,
        profile_image: r.sender_profile_image,
        is_alias: false,
      },
      body: r.body,
      attachment_url: r.attachment_url,
      attachment_kind: r.attachment_kind,
      created_at: r.created_at,
      is_mine: isMine,
    };
  });

  return c.json({
    project_id: auth.projectId,
    team_code: teamCode,
    label_mn: teamLabel,
    messages,
  });
});

// ----------------------------------------------------------------------
// POST /api/project-chat/projects/:projectId/threads/:teamCode/messages
// Body: { body?: string; attachment_url?: string; attachment_kind?: string }
// ----------------------------------------------------------------------
router.post('/projects/:projectId/threads/:teamCode/messages', async (c) => {
  const viewer = c.get('user');
  const auth = await authorizeProject(c.env.DB, c.req.param('projectId'), viewer);
  if ('error' in auth) return c.json({ error: auth.error }, auth.status);

  const teamCode = c.req.param('teamCode');
  if (!VALID_TEAM_CODES.has(teamCode)) return c.json({ error: 'Unknown team code' }, 400);

  type PostMessageBody = {
    body?: string;
    attachment_url?: string | null;
    attachment_kind?: 'image' | 'file' | null;
  };
  const body = await c.req.json<PostMessageBody>().catch((): PostMessageBody => ({}));
  const text = (body?.body ?? '').toString().trim();
  const attachment = body?.attachment_url ? String(body.attachment_url) : null;
  const attachmentKind = body?.attachment_kind
    ? String(body.attachment_kind)
    : attachment
      ? 'image'
      : null;

  if (!text && !attachment) {
    return c.json({ error: 'Message body or attachment required' }, 400);
  }

  // Engineers may only post into their own team's thread (admins + clients
  // can post anywhere in projects they belong to).
  if (viewer.role !== 'admin' && viewer.role !== 'client') {
    const { results: myTeamCodes } = await c.env.DB.prepare(
      'SELECT t.code AS team_code FROM user_teams ut JOIN teams t ON t.id = ut.team_id WHERE ut.user_id = ?',
    )
      .bind(viewer.sub)
      .all<{ team_code: string }>();
    const myCodes = (myTeamCodes ?? []).map((r) => r.team_code);
    if (!myCodes.includes(teamCode)) {
      return c.json({ error: 'Engineers can only post into their own team thread' }, 403);
    }
  }

  const threadId = await ensureThread(c.env.DB, auth.projectId, teamCode);
  const now = new Date().toISOString();

  const ins = await c.env.DB.prepare(
    `
    INSERT INTO project_thread_messages
      (thread_id, sender_user_id, body, attachment_url, attachment_kind, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(threadId, viewer.sub, text, attachment, attachmentKind, now)
    .run();

  await c.env.DB.prepare('UPDATE project_threads SET last_msg_at = ? WHERE id = ?')
    .bind(now, threadId)
    .run();

  return c.json(
    {
      message: 'Posted',
      id: Number(ins.meta.last_row_id),
      thread_id: threadId,
      created_at: now,
    },
    201,
  );
});

// ----------------------------------------------------------------------
// DELETE /api/project-chat/messages/:id   — admin or author can soft-delete.
// ----------------------------------------------------------------------
router.delete('/messages/:id', async (c) => {
  const viewer = c.get('user');
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT sender_user_id FROM project_thread_messages WHERE id = ? AND deleted_at IS NULL',
  )
    .bind(id)
    .first<{ sender_user_id: number }>();
  if (!row) return c.json({ error: 'Message not found' }, 404);

  if (viewer.role !== 'admin' && row.sender_user_id !== viewer.sub) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  await c.env.DB.prepare(
    "UPDATE project_thread_messages SET deleted_at = datetime('now') WHERE id = ?",
  )
    .bind(id)
    .run();
  return c.json({ message: 'Deleted' });
});

// ----------------------------------------------------------------------
// GET /api/project-chat/projects/:projectId/overview
//
// Anonymised "client-safe" project overview: progress, structure and
// per-discipline breakdown.  We intentionally do NOT return any user
// names, profile images, or assignee details — clients see headcounts
// and team-level numbers only, never who is doing what.
//
// The shape mirrors what `ProjectDetailPage` already computes on the
// staff side, but stripped of identifying fields and pre-aggregated so
// the client UI doesn't need to walk the tree itself.
// ----------------------------------------------------------------------
router.get('/projects/:projectId/overview', async (c) => {
  const viewer = c.get('user');
  const auth = await authorizeProject(c.env.DB, c.req.param('projectId'), viewer);
  if ('error' in auth) return c.json({ error: auth.error }, auth.status);

  const projectId = auth.projectId;

  // Pull the basic project row + structural counts + per-block progress
  // in one batch.  We deliberately re-implement the progress CTE locally
  // (rather than calling out to a shared helper) because we want a
  // single round trip and need extra discipline-level aggregates that
  // the existing /projects/:id endpoint doesn't return.
  const [proj, counts, blockRows, drawingRows, threadRows, taskRows, componentRows] =
    await Promise.all([
      // Project header + passport dates joined in one shot so the
      // client UI can compute "Төслийн хугацаа" (calendar days) without
      // a second round-trip.
      c.env.DB.prepare(
        `
      SELECT p.id, p.name, p.location, p.latitude, p.longitude, p.status, p.description,
             p.created_at, p.updated_at,
             pp.start_date AS start_date,
             pp.finish_date AS finish_date
      FROM projects p
      LEFT JOIN project_passport pp ON pp.project_id = p.id
      WHERE p.id = ?
    `,
      )
        .bind(projectId)
        .first<{
          id: number;
          name: string;
          location: string | null;
          /* Пин — захиалагчийн «Google Maps дээр нээх» яг цэг рүү очихын
           * тулд (байхгүй бол хаягаар хайна). */
          latitude: number | null;
          longitude: number | null;
          status: string | null;
          description: string | null;
          created_at: string;
          updated_at: string;
          start_date: string | null;
          finish_date: string | null;
        }>(),
      // All-time participant count: anyone who has ever been on
      // project_members, OR ever been assigned to one of the project's
      // tasks (task_assignees), OR ever logged a progress entry against
      // one of the project's tasks. UNION dedups, COUNT(*) yields the
      // headcount the client cares about ("how many people have ever
      // touched this project").
      c.env.DB.prepare(
        `
      SELECT
        (SELECT COUNT(*) FROM blocks      WHERE project_id = ?)                                      AS blocks,
        (SELECT COUNT(*) FROM drawings    WHERE block_id IN (SELECT id FROM blocks WHERE project_id = ?)) AS drawings,
        (SELECT COUNT(*) FROM components  WHERE drawing_id IN (
            SELECT d.id FROM drawings d JOIN blocks b ON b.id = d.block_id WHERE b.project_id = ?)) AS components,
        (SELECT COUNT(*) FROM tasks       WHERE component_id IN (
            SELECT c.id FROM components c
              JOIN drawings d ON d.id = c.drawing_id
              JOIN blocks   b ON b.id = d.block_id
              WHERE b.project_id = ?)) AS tasks,
        (SELECT COUNT(*) FROM (
            SELECT user_id FROM project_members WHERE project_id = ?
            UNION
            SELECT ta.user_id
              FROM task_assignees ta
              JOIN tasks t      ON t.id  = ta.task_id
              JOIN components c ON c.id  = t.component_id
              JOIN drawings d   ON d.id  = c.drawing_id
              JOIN blocks b     ON b.id  = d.block_id
              WHERE b.project_id = ?
            UNION
            SELECT pe.user_id
              FROM progress_entries pe
              JOIN tasks t      ON t.id  = pe.task_id
              JOIN components c ON c.id  = t.component_id
              JOIN drawings d   ON d.id  = c.drawing_id
              JOIN blocks b     ON b.id  = d.block_id
              WHERE b.project_id = ?
          )) AS member_count
    `,
      )
        .bind(projectId, projectId, projectId, projectId, projectId, projectId, projectId)
        .first<{
          blocks: number;
          drawings: number;
          components: number;
          tasks: number;
          member_count: number;
        }>(),
      c.env.DB.prepare(
        `
      WITH
      latest_task AS (
        -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
        SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
        FROM tasks t
      ),
      -- Түвшин бүр ЗАРЛАСАН төсвөөр хуваана (зураг нь d.weight_percent-ээр,
      -- блок нь 100-аар) — PROJECT_LIST_SQL-тэй ижил.  Дутуу жин нь
      -- хийгдээгүй ажил гэж тоологдоно.
      draw_prog AS (
        SELECT d.id, d.name AS drawing_name, d.block_id, d.weight_percent,
               COALESCE(
                 SUM(t.weight_percent * COALESCE(lt.percentage, 0))
                   / NULLIF(d.weight_percent, 0),
                 0) AS progress,
               COUNT(t.id) AS task_count
        FROM drawings d
        LEFT JOIN components c ON c.drawing_id = d.id
        LEFT JOIN tasks t ON t.component_id = c.id
        LEFT JOIN latest_task lt ON lt.task_id = t.id
        GROUP BY d.id, d.name, d.block_id, d.weight_percent)
      SELECT b.id, b.name, b.weight_percent,
             b.team_id,
             tm.code    AS team_code,
             tm.name_mn AS team_name_mn,
             COALESCE(pts.share_percent, 0) AS team_share,
             ROUND(COALESCE(SUM(dp.weight_percent * dp.progress), 0) / 100.0, 2) AS progress,
             COUNT(DISTINCT dp.id) AS drawing_count,
             COALESCE(SUM(dp.task_count), 0) AS task_count
      FROM blocks b
      LEFT JOIN draw_prog dp ON dp.block_id = b.id
      LEFT JOIN teams tm     ON tm.id = b.team_id
      LEFT JOIN project_team_shares pts
        ON pts.project_id = b.project_id AND pts.team_id = b.team_id
      WHERE b.project_id = ?
      GROUP BY b.id, b.name, b.weight_percent, b.team_id, tm.code, tm.name_mn, pts.share_percent
      ORDER BY b.id
    `,
      )
        .bind(projectId)
        .all<{
          id: number;
          name: string;
          weight_percent: number;
          team_id: number | null;
          team_code: string | null;
          team_name_mn: string | null;
          team_share: number;
          progress: number;
          drawing_count: number;
          task_count: number;
        }>(),
      // Drawing rows with their team prefix decoded server-side so the
      // client doesn't need to know the discipline keyword fallbacks.
      c.env.DB.prepare(
        `
      WITH
      latest_task AS (
        -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
        SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
        FROM tasks t
      )
      SELECT d.id, d.name, d.block_id, d.weight_percent,
             COUNT(t.id) AS task_count,
             CASE WHEN d.weight_percent > 0
               THEN COALESCE(SUM(t.weight_percent * COALESCE(lt.percentage, 0) / 100.0), 0) * 100.0 / d.weight_percent
               ELSE 0 END AS progress
      FROM drawings d
      JOIN blocks b ON b.id = d.block_id
      LEFT JOIN components c ON c.drawing_id = d.id
      LEFT JOIN tasks t ON t.component_id = c.id
      LEFT JOIN latest_task lt ON lt.task_id = t.id
      WHERE b.project_id = ?
      GROUP BY d.id, d.name, d.block_id, d.weight_percent
    `,
      )
        .bind(projectId)
        .all<{
          id: number;
          name: string;
          block_id: number;
          weight_percent: number;
          task_count: number;
          progress: number;
        }>(),
      c.env.DB.prepare(
        `
      SELECT pt.team_code,
             (SELECT COUNT(*) FROM project_thread_messages m
                WHERE m.thread_id = pt.id AND m.deleted_at IS NULL) AS message_count
      FROM project_threads pt WHERE pt.project_id = ?
    `,
      )
        .bind(projectId)
        .all<{ team_code: string; message_count: number }>(),
      // Per-task rows for drill-down; we deliberately omit assignees so
      // clients still only see "what" is happening, never "who".  We
      // carry `component_id` so the client UI can group tasks under their
      // owning component (the new setup model treats components as a
      // weight-bearing tier rather than a pure grouping).
      c.env.DB.prepare(
        `
      WITH latest_task AS (
    -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
    SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
    FROM tasks t
  )
      SELECT t.id, t.name, t.weight_percent,
             t.component_id,
             c.drawing_id,
             COALESCE(lt.percentage, 0) AS progress
      FROM tasks t
      JOIN components c ON c.id = t.component_id
      JOIN drawings   d ON d.id = c.drawing_id
      JOIN blocks     b ON b.id = d.block_id
      LEFT JOIN latest_task lt ON lt.task_id = t.id
      WHERE b.project_id = ?
      ORDER BY t.id
    `,
      )
        .bind(projectId)
        .all<{
          id: number;
          name: string;
          weight_percent: number;
          component_id: number;
          drawing_id: number;
          progress: number;
        }>(),
      // Components per project — name, weight, owning drawing.  Returned
      // separately so the response builder can emit drawings → components
      // → tasks even for components that don't yet have leaf tasks (the
      // client still sees the structure the admin laid out on setup).
      c.env.DB.prepare(
        `
      SELECT c.id, c.name, c.weight_percent, c.drawing_id, c.sort_order
      FROM components c
      JOIN drawings   d ON d.id = c.drawing_id
      JOIN blocks     b ON b.id = d.block_id
      WHERE b.project_id = ?
      ORDER BY c.drawing_id, c.sort_order, c.id
    `,
      )
        .bind(projectId)
        .all<{
          id: number;
          name: string;
          weight_percent: number;
          drawing_id: number;
          sort_order: number;
        }>(),
    ]);

  if (!proj) return c.json({ error: 'Project not found' }, 404);

  // Bucket drawings by discipline so we can return per-team aggregates
  // without ever leaking individual drawing names to the client.  The
  // discipline detection here mirrors the frontend `drawingTeamCode`
  // helper exactly (prefix match → keyword fallback) so staff and
  // client views agree on which team owns what.
  const byTeam = new Map<
    string,
    { weighted_progress: number; weight_sum: number; task_count: number; drawing_count: number }
  >();
  const sortedCodes = DRAWING_DISCIPLINES.map((d) => d.code).sort((a, b) => b.length - a.length);
  function teamCodeOf(name: string): string | null {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return null;
    const upper = trimmed.toUpperCase();
    for (const code of sortedCodes) {
      if (
        upper.startsWith(`${code} `) ||
        upper.startsWith(`${code}-`) ||
        upper.startsWith(`${code}_`) ||
        upper === code
      )
        return code;
    }
    const lower = trimmed.toLowerCase();
    if (lower.includes('архитектур')) return 'BA';
    if (lower.includes('бүтээц')) return 'BB';
    if (lower.includes('халаалт') || lower.includes('агаар сэлгэлт')) return 'HAS';
    if (lower.includes('цэвэр') || lower.includes('бохир')) return 'TSBU';
    if (lower.includes('цахилгаан')) return 'TSAH';
    if (lower.includes('холбоо') || lower.includes('дохиолол')) return 'HD';
    if (lower.includes('автомат')) return 'AU';
    if (lower.includes('эскиз')) return 'EZ';
    if (lower.includes('интерьер')) return 'IZ';
    if (lower.includes('тохижилт')) return 'GT';
    return null;
  }

  for (const d of drawingRows.results ?? []) {
    const code = teamCodeOf(d.name) ?? '_none';
    const cur = byTeam.get(code) ?? {
      weighted_progress: 0,
      weight_sum: 0,
      task_count: 0,
      drawing_count: 0,
    };
    cur.weighted_progress += d.weight_percent * (d.progress ?? 0);
    cur.weight_sum += d.weight_percent;
    cur.task_count += d.task_count;
    cur.drawing_count += 1;
    byTeam.set(code, cur);
  }

  const messagesByCode = new Map(
    (threadRows.results ?? []).map((r) => [r.team_code, r.message_count]),
  );

  const disciplines = DRAWING_DISCIPLINES.map((d) => {
    const agg = byTeam.get(d.code);
    return {
      code: d.code,
      label_mn: d.label_mn,
      drawing_count: agg?.drawing_count ?? 0,
      task_count: agg?.task_count ?? 0,
      progress:
        agg && agg.weight_sum > 0
          ? Math.round((agg.weighted_progress / agg.weight_sum) * 100) / 100
          : 0,
      message_count: messagesByCode.get(d.code) ?? 0,
      active: !!agg && agg.task_count > 0,
    };
  });

  // Overall progress = Σ_block (b.w × b.p / 100) × (share / 100) — зарласан
  // төсвөөр, PROJECT_LIST_SQL болон calcProjectProgress-тэй яг ижил.  Багийн
  // хуваарийн нийлбэр 100 хүрээгүй бол дутуу нь хийгдээгүй ажил гэж үлдэнэ.
  // Хуваарийн мөргүй багийн блок 0 нэмэрлэнэ — тэр баг идэвхжээгүй гэсэн үг.
  let overall = 0;
  for (const b of blockRows.results ?? []) {
    if (b.team_id === null || b.team_share <= 0) continue;
    const w = Math.max(0, b.weight_percent);
    overall += ((w * (b.progress ?? 0)) / 100) * (b.team_share / 100);
  }
  const overall_progress = Math.round(overall * 100) / 100;

  // Project calendar duration — every day from passport.start_date to
  // passport.finish_date inclusive, weekends and holidays included
  // (the UX explicitly wants raw calendar days, not business days).
  // Falls back to null when either date is missing so the client UI
  // can hide the row instead of showing a misleading zero.
  let duration_days: number | null = null;
  if (proj?.start_date && proj?.finish_date) {
    const s = new Date(`${proj.start_date}T00:00:00Z`).getTime();
    const e = new Date(`${proj.finish_date}T00:00:00Z`).getTime();
    if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
      duration_days = Math.round((e - s) / 86_400_000) + 1;
    }
  }

  return c.json({
    project: proj,
    overall_progress,
    duration_days,
    counts: {
      blocks: counts?.blocks ?? 0,
      drawings: counts?.drawings ?? 0,
      components: counts?.components ?? 0,
      tasks: counts?.tasks ?? 0,
      // Headcount only — never names.  We additionally subtract the
      // number of clients on the project so the displayed number is the
      // engineering-side headcount, which is what the client cares
      // about ("how many people are working on my project").
      team_members: counts?.member_count ?? 0,
      active_disciplines: disciplines.filter((d) => d.active).length,
    },
    blocks: (blockRows.results ?? []).map((b) => {
      // Build per-discipline breakdown for this block from drawingRows
      const blockByTeam = new Map<
        string,
        { drawing_count: number; task_count: number; weighted_progress: number; weight_sum: number }
      >();
      const blockDrawings = (drawingRows.results ?? []).filter((dr) => dr.block_id === b.id);
      for (const d of blockDrawings) {
        const code = teamCodeOf(d.name) ?? '_none';
        const cur = blockByTeam.get(code) ?? {
          drawing_count: 0,
          task_count: 0,
          weighted_progress: 0,
          weight_sum: 0,
        };
        cur.drawing_count += 1;
        cur.task_count += d.task_count;
        cur.weighted_progress += d.weight_percent * (d.progress ?? 0);
        cur.weight_sum += d.weight_percent;
        blockByTeam.set(code, cur);
      }
      const block_disciplines = Array.from(blockByTeam.entries())
        .filter(([, v]) => v.task_count > 0)
        .map(([code, v]) => ({
          code,
          drawing_count: v.drawing_count,
          task_count: v.task_count,
          progress:
            v.weight_sum > 0 ? Math.round((v.weighted_progress / v.weight_sum) * 100) / 100 : 0,
        }))
        .sort((a, b) => b.task_count - a.task_count);

      // Build drawings list with components→tasks attached. The new
      // setup model treats components as a weight-bearing tier, so the
      // client UI groups tasks under their owning component instead of
      // flat-listing them under the drawing. We strip the team prefix
      // from drawing names since the team code is returned separately
      // and the prefix is redundant on the client UI.
      const tasksByComponent = new Map<
        number,
        { id: number; name: string; weight_percent: number; progress: number }[]
      >();
      for (const t of taskRows.results ?? []) {
        const arr = tasksByComponent.get(t.component_id) ?? [];
        arr.push({
          id: t.id,
          name: t.name,
          weight_percent: t.weight_percent,
          progress: Math.round((t.progress ?? 0) * 100) / 100,
        });
        tasksByComponent.set(t.component_id, arr);
      }
      const componentsByDrawing = new Map<number, typeof componentRows.results>();
      for (const co of componentRows.results ?? []) {
        const arr = componentsByDrawing.get(co.drawing_id) ?? [];
        arr.push(co);
        componentsByDrawing.set(co.drawing_id, arr);
      }
      const drawings = blockDrawings
        .filter((d) => d.task_count > 0)
        .map((d) => {
          const drawingComponents = (componentsByDrawing.get(d.id) ?? [])
            .map((co) => {
              const compTasks = tasksByComponent.get(co.id) ?? [];
              // Component progress = weighted average of its tasks.  Falls
              // back to the simple mean when no task carries weight (e.g.
              // legacy data with all tasks at weight 0).
              const totalW = compTasks.reduce((s, t) => s + Math.max(0, t.weight_percent), 0);
              const compProgress =
                totalW > 0
                  ? compTasks.reduce((s, t) => s + t.weight_percent * t.progress, 0) / totalW
                  : compTasks.length > 0
                    ? compTasks.reduce((s, t) => s + t.progress, 0) / compTasks.length
                    : 0;
              return {
                id: co.id,
                name: co.name,
                weight_percent: co.weight_percent,
                progress: Math.round(compProgress * 100) / 100,
                task_count: compTasks.length,
                tasks: compTasks,
              };
            })
            .filter((co) => co.task_count > 0);
          return {
            id: d.id,
            name: d.name,
            team_code: teamCodeOf(d.name),
            weight_percent: d.weight_percent,
            progress: Math.round((d.progress ?? 0) * 100) / 100,
            task_count: d.task_count,
            components: drawingComponents,
          };
        });

      return {
        id: b.id,
        name: b.name,
        weight_percent: b.weight_percent,
        // Owning team (when the admin tagged this block with a discipline
        // on the setup page). The client UI only renders a team-pill
        // filter when at least two distinct teams exist.
        team_id: b.team_id,
        team_code: b.team_code,
        team_name_mn: b.team_name_mn,
        progress: b.progress ?? 0,
        drawing_count: b.drawing_count,
        task_count: b.task_count,
        block_disciplines,
        drawings,
      };
    }),
    // Distinct teams that own at least one block in this project. Used
    // by the client overview to render its team-pill filter; mirrors
    // the staff `team_shares` shape but stripped of allocation % and
    // member identity — clients only see discipline codes + names.
    block_teams: (() => {
      const seen = new Map<
        number,
        { team_id: number; code: string; name_mn: string; block_count: number }
      >();
      for (const b of blockRows.results ?? []) {
        if (b.team_id == null) continue;
        const cur = seen.get(b.team_id);
        if (cur) {
          cur.block_count += 1;
        } else {
          seen.set(b.team_id, {
            team_id: b.team_id,
            code: b.team_code ?? '?',
            name_mn: b.team_name_mn ?? `Team #${b.team_id}`,
            block_count: 1,
          });
        }
      }
      return Array.from(seen.values());
    })(),
    disciplines,
  });
});

// ----------------------------------------------------------------------
// GET /api/project-chat/my-projects
// Returns the projects the current user (typically a client) belongs to,
// with light metadata: name, location, total threads with messages.
// Used by the client dashboard landing page.
// ----------------------------------------------------------------------
router.get('/my-projects', async (c) => {
  const viewer = c.get('user');
  const rows = await c.env.DB.prepare(
    `
    SELECT p.id, p.name, p.location, p.status,
           (SELECT COUNT(*) FROM project_threads pt
              WHERE pt.project_id = p.id AND pt.last_msg_at IS NOT NULL) AS active_threads,
           (SELECT MAX(last_msg_at) FROM project_threads pt2
              WHERE pt2.project_id = p.id) AS last_activity
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE pm.user_id = ?
    ORDER BY (last_activity IS NULL), last_activity DESC, p.name
  `,
  )
    .bind(viewer.sub)
    .all();

  return c.json({ projects: rows.results ?? [] });
});

export default router;
