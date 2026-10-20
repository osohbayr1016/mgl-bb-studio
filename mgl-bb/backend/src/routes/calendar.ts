import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import { isAdminRole } from '../types';
import type {
  Env,
  AppVariables,
  CalendarEventRow,
  CalendarPriority,
  CreateCalendarEventRequest,
  UpdateCalendarEventRequest,
} from '../types';
import { pushEvent, pushDelete, isSyncConfigured } from '../lib/googleCalendarSync';

const calendar = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---------- Helpers ----------------------------------------------------------

const VALID_PRIORITIES: readonly CalendarPriority[] = ['normal', 'high', 'urgent'];

function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

/** Accepts HH:MM (24h, e.g. "09:00", "23:59"). */
function isValidHHMM(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** Normalise an optional HH:MM input from the request:
 *   undefined  -> undefined  (caller didn't touch this field)
 *   null / ''  -> null       (clear the field)
 *   "HH:MM"    -> "HH:MM"    (validated)
 *   anything else -> Response (400) so the route can return early. */
function parseOptionalTime(raw: unknown, field: string): string | null | undefined | Response {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  if (typeof raw === 'string' && isValidHHMM(raw)) return raw;
  return new Response(JSON.stringify({ error: `${field} must be HH:MM` }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

function todayIso(): string {
  // YYYY-MM-DD in UTC; the dashboard groups by calendar day so timezone
  // edge-cases are acceptable for an announcement system.
  return new Date().toISOString().slice(0, 10);
}

/**
 * Correlated-subquery columns that aggregate an event's team targeting
 * from the `calendar_event_teams` junction (migration 0100).  Each is a
 * comma-separated string, or NULL when the event has no team rows
 * (= company-wide).  Reused verbatim by /events and /today.  Requires
 * the calendar_events alias to be `e`.
 */
const TEAM_AGG_SELECT = `
           (SELECT group_concat(tm.code) FROM calendar_event_teams et
              JOIN teams tm ON tm.id = et.team_id WHERE et.event_id = e.id) AS team_codes,
           (SELECT group_concat(et.team_id) FROM calendar_event_teams et
              WHERE et.event_id = e.id) AS team_ids_csv,
           (SELECT group_concat(tm.name_mn) FROM calendar_event_teams et
              JOIN teams tm ON tm.id = et.team_id WHERE et.event_id = e.id) AS team_names`;

/**
 * Build the SQL WHERE clause + bind values that scope a calendar query
 * to what the caller is allowed to see:
 *
 *   • Admins see every event regardless of targeting (oversight).
 *   • Everyone else sees company-wide events (no rows in
 *     calendar_event_teams) plus events targeted at a team they
 *     currently belong to.  Workers with no team assigned only see the
 *     company-wide announcements.
 *
 * Returns the SQL fragment and the bind values to append in declaration
 * order.
 */
async function buildVisibilityScope(
  db: D1Database,
  user: { sub: number; role: string },
): Promise<{ sql: string; binds: (string | number)[] }> {
  if (isAdminRole(user.role)) return { sql: '', binds: [] };

  const { results: teamRows } = await db
    .prepare('SELECT team_id FROM user_teams WHERE user_id = ?')
    .bind(user.sub)
    .all<{ team_id: number }>();
  const teamIds = (teamRows ?? []).map((r) => r.team_id);

  // Company-wide = an event with no rows in the junction table.
  const companyWide = 'NOT EXISTS (SELECT 1 FROM calendar_event_teams et WHERE et.event_id = e.id)';

  if (teamIds.length === 0) {
    return { sql: companyWide, binds: [] };
  }
  const placeholders = teamIds.map(() => '?').join(',');
  return {
    sql: `(${companyWide}
           OR EXISTS (SELECT 1 FROM calendar_event_teams et
                      WHERE et.event_id = e.id AND et.team_id IN (${placeholders})))`,
    binds: teamIds,
  };
}

// ---------- Read endpoints (any authenticated user) --------------------------

/** List events between `from` and `to` (inclusive) for the calendar grid.
 *  Defaults to the current month when no range is supplied. */
calendar.get('/events', async (c) => {
  const fromQ = c.req.query('from');
  const toQ = c.req.query('to');
  const user = c.get('user');

  const from = fromQ && isValidIsoDate(fromQ) ? fromQ : null;
  const to = toQ && isValidIsoDate(toQ) ? toQ : null;

  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (from) {
    where.push('e.event_date >= ?');
    binds.push(from);
  }
  if (to) {
    where.push('e.event_date <= ?');
    binds.push(to);
  }

  const scope = await buildVisibilityScope(c.env.DB, user);
  if (scope.sql) {
    where.push(scope.sql);
    binds.push(...scope.binds);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT e.*,
           u.full_name AS created_by_name,
           t.name AS task_name,${TEAM_AGG_SELECT},
           CASE WHEN a.user_id IS NULL THEN 0 ELSE 1 END AS acknowledged
    FROM calendar_events e
    LEFT JOIN users u ON u.id = e.created_by
    LEFT JOIN tasks t ON t.id = e.task_id
    LEFT JOIN calendar_event_acks a ON a.event_id = e.id AND a.user_id = ?
    ${whereSql}
    ORDER BY e.event_date ASC, e.priority DESC, e.id ASC
  `;

  const { results } = await c.env.DB.prepare(sql)
    .bind(user.sub, ...binds)
    .all();
  return c.json({ events: results });
});

/** Today's announcements + ack status — used by the dashboard banner. */
calendar.get('/today', async (c) => {
  const user = c.get('user');
  const today = todayIso();

  const scope = await buildVisibilityScope(c.env.DB, user);
  const where = ['e.event_date = ?'];
  const binds: (string | number)[] = [today];
  if (scope.sql) {
    where.push(scope.sql);
    binds.push(...scope.binds);
  }

  const { results } = await c.env.DB.prepare(
    `
    SELECT e.*,
           u.full_name AS created_by_name,
           t.name AS task_name,${TEAM_AGG_SELECT},
           CASE WHEN a.user_id IS NULL THEN 0 ELSE 1 END AS acknowledged
    FROM calendar_events e
    LEFT JOIN users u ON u.id = e.created_by
    LEFT JOIN tasks t ON t.id = e.task_id
    LEFT JOIN calendar_event_acks a ON a.event_id = e.id AND a.user_id = ?
    WHERE ${where.join(' AND ')}
    ORDER BY e.priority DESC, e.id ASC
  `,
  )
    .bind(user.sub, ...binds)
    .all();

  return c.json({ events: results, date: today });
});

/** Acknowledge an event — every user, idempotent. */
calendar.post('/events/:id/ack', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid event id' }, 400);
  const userId = c.get('user').sub;

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO calendar_event_acks (event_id, user_id)
     VALUES (?, ?)`,
  )
    .bind(id, userId)
    .run();

  return c.json({ ok: true });
});

// ---------- Write endpoints (admin-only) -------------------------------------

/** Read the team-targeting field from a request body, supporting both
 *  the new `team_ids: number[]` and the legacy single `team_id`.
 *  Returns:
 *    undefined  → field omitted entirely (caller keeps current targeting)
 *    number[]   → the requested set ([] = company-wide).  Not yet
 *                 validated against the teams table — pass to
 *                 {@link resolveTeamIds}. */
function normalizeTeamIdsField(body: {
  team_ids?: number[];
  team_id?: number | null;
}): number[] | undefined {
  if (Array.isArray(body.team_ids)) return body.team_ids.map((x) => Number(x));
  if (body.team_id !== undefined) return body.team_id === null ? [] : [Number(body.team_id)];
  return undefined;
}

/** Validate a set of team ids against the teams table.  De-dupes, rejects
 *  malformed ids (400) and ids that reference a missing team (404).
 *  An empty input resolves to `[]` (company-wide). */
async function resolveTeamIds(db: D1Database, ids: number[]): Promise<number[] | Response> {
  const uniq = [...new Set(ids.map((x) => Number(x)))];
  if (uniq.length === 0) return [];
  for (const n of uniq) {
    if (!Number.isFinite(n) || n <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid team_id' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
  }
  const placeholders = uniq.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT id FROM teams WHERE id IN (${placeholders})`)
    .bind(...uniq)
    .all<{ id: number }>();
  const found = new Set((results ?? []).map((r) => r.id));
  const missing = uniq.filter((n) => !found.has(n));
  if (missing.length > 0) {
    return new Response(JSON.stringify({ error: 'Team not found', missing }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }
  return uniq;
}

/** Replace an event's team targeting with the given (already-validated)
 *  set of team ids.  Empty = company-wide (all rows removed). */
async function setEventTeams(db: D1Database, eventId: number, teamIds: number[]): Promise<void> {
  await db.prepare('DELETE FROM calendar_event_teams WHERE event_id = ?').bind(eventId).run();
  if (teamIds.length === 0) return;
  const linkStmt = db.prepare(
    'INSERT OR IGNORE INTO calendar_event_teams (event_id, team_id) VALUES (?, ?)',
  );
  await db.batch(teamIds.map((tid) => linkStmt.bind(eventId, tid)));
}

/** The create payload as it arrives over the wire: the documented
 *  {@link CreateCalendarEventRequest} plus an optional `event_dates` array
 *  for multi-day announcements.  The field is unvalidated client JSON, so
 *  it stays `unknown` until the Array.isArray / String() checks below. */
type CreateCalendarEventBody = CreateCalendarEventRequest & { event_dates?: unknown };

calendar.post('/events', requireAdmin(), async (c) => {
  const body = await c.req.json<CreateCalendarEventBody>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const title = (body.title ?? '').trim();
  if (!title) return c.json({ error: 'title is required' }, 400);

  // Accept either a single `event_date` or an array of `event_dates`.
  const rawDates: string[] = Array.isArray(body.event_dates)
    ? body.event_dates.map((d: unknown) => String(d).trim())
    : [(body.event_date ?? '').trim()];
  const dates = rawDates.filter(isValidIsoDate);
  if (dates.length === 0) return c.json({ error: 'event_date(s) must be YYYY-MM-DD' }, 400);

  const priority: CalendarPriority =
    body.priority && VALID_PRIORITIES.includes(body.priority) ? body.priority : 'normal';
  const summary = body.summary?.trim() || null;
  const message = body.message?.trim() || null;
  const taskId = Number.isFinite(body.task_id) ? Number(body.task_id) : null;

  // Team targeting (junction).  Omitted = company-wide ([]).
  const teamRes = await resolveTeamIds(c.env.DB, normalizeTeamIdsField(body) ?? []);
  if (teamRes instanceof Response) return teamRes;
  const teamIds: number[] = teamRes;

  const startRes = parseOptionalTime(body.start_time, 'start_time');
  if (startRes instanceof Response) return startRes;
  const endRes = parseOptionalTime(body.end_time, 'end_time');
  if (endRes instanceof Response) return endRes;
  const startTime: string | null = startRes ?? null;
  const endTime: string | null = endRes ?? null;

  const user = c.get('user');
  // team_id is a dead column (migration 0100) — targeting lives in the
  // calendar_event_teams junction, so it's left out of the insert (NULL).
  const stmt = c.env.DB.prepare(
    `INSERT INTO calendar_events
       (event_date, title, summary, message, task_id, priority, start_time, end_time, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const results = await c.env.DB.batch(
    dates.map((d) =>
      stmt.bind(d, title, summary, message, taskId, priority, startTime, endTime, user.sub),
    ),
  );

  const ids = results.map((r) => r.meta.last_row_id);

  // Attach the same team targeting to every newly-created event (one per
  // date for multi-day announcements).
  if (teamIds.length > 0) {
    const linkStmt = c.env.DB.prepare(
      'INSERT OR IGNORE INTO calendar_event_teams (event_id, team_id) VALUES (?, ?)',
    );
    const links = ids.flatMap((eid) => teamIds.map((tid) => linkStmt.bind(eid, tid)));
    if (links.length > 0) await c.env.DB.batch(links);
  }

  const { results: rows } = await c.env.DB.prepare(
    `SELECT * FROM calendar_events WHERE id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(...ids)
    .all<CalendarEventRow>();

  if (isSyncConfigured(c.env)) {
    const env = c.env;
    c.executionCtx.waitUntil(
      (async () => {
        for (const rid of ids) {
          try {
            await pushEvent(env, Number(rid));
          } catch (err) {
            console.error('gcal push (create) failed for', rid, err);
          }
        }
      })(),
    );
  }

  return c.json({ events: rows ?? [], event: rows?.[0] ?? null }, 201);
});

calendar.put('/events/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid event id' }, 400);

  const body = await c.req.json<UpdateCalendarEventRequest>().catch(() => null);
  if (!body) return c.json({ error: 'Invalid JSON' }, 400);

  const sets: string[] = [];
  const binds: (string | number | null)[] = [];

  if (body.event_date !== undefined) {
    if (!isValidIsoDate(body.event_date)) {
      return c.json({ error: 'event_date must be YYYY-MM-DD' }, 400);
    }
    sets.push('event_date = ?');
    binds.push(body.event_date);
  }
  if (body.title !== undefined) {
    const title = body.title.trim();
    if (!title) return c.json({ error: 'title cannot be empty' }, 400);
    sets.push('title = ?');
    binds.push(title);
  }
  if (body.summary !== undefined) {
    sets.push('summary = ?');
    binds.push(body.summary?.trim() || null);
  }
  if (body.message !== undefined) {
    sets.push('message = ?');
    binds.push(body.message?.trim() || null);
  }
  if (body.task_id !== undefined) {
    sets.push('task_id = ?');
    binds.push(body.task_id === null ? null : Number(body.task_id));
  }
  if (body.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(body.priority)) {
      return c.json({ error: 'Invalid priority' }, 400);
    }
    sets.push('priority = ?');
    binds.push(body.priority);
  }
  if (body.start_time !== undefined) {
    const r = parseOptionalTime(body.start_time, 'start_time');
    if (r instanceof Response) return r;
    sets.push('start_time = ?');
    binds.push(r ?? null);
  }
  if (body.end_time !== undefined) {
    const r = parseOptionalTime(body.end_time, 'end_time');
    if (r instanceof Response) return r;
    sets.push('end_time = ?');
    binds.push(r ?? null);
  }

  // Team targeting (junction).  Omitted = leave unchanged; provided
  // (incl. empty array) = replace.  Validate up front so a bad team id
  // doesn't leave a half-applied scalar update behind.
  const teamIdsField = normalizeTeamIdsField(body);
  let resolvedTeamIds: number[] | null = null;
  if (teamIdsField !== undefined) {
    const teamRes = await resolveTeamIds(c.env.DB, teamIdsField);
    if (teamRes instanceof Response) return teamRes;
    resolvedTeamIds = teamRes;
  }

  if (sets.length === 0 && resolvedTeamIds === null) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  // Bump updated_at whenever anything (scalar or targeting) changes.
  sets.push('updated_at = CURRENT_TIMESTAMP');
  binds.push(id);
  await c.env.DB.prepare(`UPDATE calendar_events SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  if (resolvedTeamIds !== null) {
    await setEventTeams(c.env.DB, id, resolvedTeamIds);
  }

  const row = await c.env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?')
    .bind(id)
    .first<CalendarEventRow>();

  if (isSyncConfigured(c.env)) {
    const env = c.env;
    c.executionCtx.waitUntil(
      pushEvent(env, id).catch((err) => console.error('gcal push (update) failed for', id, err)),
    );
  }

  return c.json({ event: row });
});

calendar.delete('/events/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid event id' }, 400);

  // Read the Google mapping BEFORE deleting the row — pushDelete needs it and
  // the row is gone afterwards.
  const existing = await c.env.DB.prepare(
    'SELECT google_event_id FROM calendar_events WHERE id = ?',
  )
    .bind(id)
    .first<{ google_event_id: string | null }>();

  // Remove junction rows explicitly — D1 does not reliably enforce FK
  // cascades, so don't rely on ON DELETE CASCADE to clean these up.
  await c.env.DB.prepare('DELETE FROM calendar_event_teams WHERE event_id = ?').bind(id).run();
  await c.env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();

  if (isSyncConfigured(c.env) && existing?.google_event_id) {
    const env = c.env;
    const gid = existing.google_event_id;
    c.executionCtx.waitUntil(
      pushDelete(env, gid).catch((err) => console.error('gcal push (delete) failed for', gid, err)),
    );
  }

  return c.json({ ok: true });
});

/** List who has acknowledged a given event — visible to admins and to the
 *  event's author so they can see uptake at a glance. */
calendar.get('/events/:id/acks', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid event id' }, 400);

  const user = c.get('user');
  if (!isAdminRole(user.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `
    SELECT a.user_id, a.acknowledged_at, u.full_name, u.username, u.team_code
    FROM calendar_event_acks a
    JOIN users u ON u.id = a.user_id
    WHERE a.event_id = ?
    ORDER BY a.acknowledged_at DESC
  `,
  )
    .bind(id)
    .all();

  return c.json({ acks: results });
});

export default calendar;
