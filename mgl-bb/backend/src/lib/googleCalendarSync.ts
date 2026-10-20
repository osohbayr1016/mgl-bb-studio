/**
 * Two-way sync between the internal calendar_events table and one shared
 * company Google Calendar (env.GOOGLE_CALENDAR_ID).
 *
 *   • Website → Google : pushEvent / pushDelete, called from routes/calendar.ts
 *     right after the DB write (via c.executionCtx.waitUntil) AND from the cron
 *     backstop reconcileDirty.
 *   • Google → Website : pullChanges, called from the scheduled cron every ~2 min
 *     with a stored syncToken.
 *
 * Loop prevention: each row stores google_event_id + google_etag.  On pull we
 * skip an event whose etag equals the stored one (it's our own echo); a changed
 * etag means a real Google-side edit.  This file holds both the mappers +
 * helpers and the push/pull/backstop orchestration.
 */
import type { Env, CalendarPriority } from '../types';
import {
  insertEvent,
  patchEvent,
  deleteEvent,
  listEvents,
  type GoogleEvent,
} from './google/calendarClient';

const UB_TZ = 'Asia/Ulaanbaatar';

/** extendedProperties.private key marking website-originated events. */
export const MGL_ID_PROP = 'mgl_event_id';
/** OAUTH_KV keys for sync state. */
export const SYNC_TOKEN_KEY = 'gcal:sync_token';
export const PENDING_DELETES_KEY = 'gcal:pending_deletes';

/** priority ↔ Google colorId.  Two-way so an urgent event round-trips. */
const PRIORITY_COLOR: Record<CalendarPriority, string | undefined> = {
  normal: undefined, // Google default color
  high: '5', // banana / yellow
  urgent: '11', // tomato / red
};
const COLOR_PRIORITY: Record<string, CalendarPriority> = {
  '5': 'high',
  '11': 'urgent',
};

/** True when the integration is configured; otherwise every entry point no-ops. */
export function isSyncConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_SA_JSON && env.GOOGLE_CALENDAR_ID);
}

/** Columns pushEvent / reconcileDirty need from a calendar_events row. */
export type PushableRow = {
  id: number;
  event_date: string;
  title: string;
  summary: string | null;
  message: string | null;
  priority: CalendarPriority;
  start_time: string | null;
  end_time: string | null;
  google_event_id: string | null;
};

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "HH:MM" + 1h → { time, dayOffset } (dayOffset=1 when it rolls past midnight). */
function addOneHour(hhmm: string): { time: string; dayOffset: number } {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = h ?? 0;
  const min = m ?? 0;
  const nh = hour + 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (nh >= 24) return { time: `${pad(nh - 24)}:${pad(min)}`, dayOffset: 1 };
  return { time: `${pad(nh)}:${pad(min)}`, dayOffset: 0 };
}

/** internal row → Google event body. */
export function mapEventToGoogle(row: {
  id: number;
  event_date: string;
  title: string;
  summary: string | null;
  message: string | null;
  priority: CalendarPriority;
  start_time: string | null;
  end_time: string | null;
}): GoogleEvent {
  const description = [row.summary, row.message].filter(Boolean).join('\n\n');
  const g: GoogleEvent = {
    summary: row.title,
    extendedProperties: { private: { [MGL_ID_PROP]: String(row.id) } },
  };
  if (description) g.description = description;
  const color = PRIORITY_COLOR[row.priority];
  if (color) g.colorId = color;

  if (row.start_time) {
    g.start = { dateTime: `${row.event_date}T${row.start_time}:00`, timeZone: UB_TZ };
    if (row.end_time) {
      g.end = { dateTime: `${row.event_date}T${row.end_time}:00`, timeZone: UB_TZ };
    } else {
      const { time, dayOffset } = addOneHour(row.start_time);
      const endDate = dayOffset ? addDays(row.event_date, 1) : row.event_date;
      g.end = { dateTime: `${endDate}T${time}:00`, timeZone: UB_TZ };
    }
  } else {
    // Whole-day: Google's all-day end date is exclusive.
    g.start = { date: row.event_date };
    g.end = { date: addDays(row.event_date, 1) };
  }
  return g;
}

/** Format an RFC3339 instant into UB wall-clock { date, time }. */
function toUBParts(rfc3339: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(rfc3339));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  let hour = get('hour');
  if (hour === '24') hour = '00'; // some ICU builds emit 24 for midnight
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

/** Internal-shaped fields a Google event maps to (no id/created_by). */
export interface MappedInternalEvent {
  event_date: string;
  title: string;
  summary: string | null;
  message: string | null;
  priority: CalendarPriority;
  start_time: string | null;
  end_time: string | null;
}

/** Google event → internal fields.  event_date === '' means "unmappable,
 *  skip" (event carried neither start.date nor start.dateTime). */
export function mapGoogleToEvent(g: GoogleEvent): MappedInternalEvent {
  const title = (g.summary ?? '').trim() || '(гарчиггүй)';
  const message = (g.description ?? '').trim() || null;
  const priority: CalendarPriority = (g.colorId && COLOR_PRIORITY[g.colorId]) || 'normal';

  let event_date = '';
  let start_time: string | null = null;
  let end_time: string | null = null;

  if (g.start?.date) {
    event_date = g.start.date;
  } else if (g.start?.dateTime) {
    const s = toUBParts(g.start.dateTime);
    event_date = s.date;
    start_time = s.time;
    if (g.end?.dateTime) end_time = toUBParts(g.end.dateTime).time;
  }
  return { event_date, title, summary: null, message, priority, start_time, end_time };
}

/** The internal user id events imported FROM Google are attributed to. */
export async function resolveSyncUserId(env: Env): Promise<number | null> {
  if (env.GOOGLE_SYNC_USER_ID && Number.isFinite(Number(env.GOOGLE_SYNC_USER_ID))) {
    return Number(env.GOOGLE_SYNC_USER_ID);
  }
  const row = await env.DB.prepare(
    "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1",
  ).first<{ id: number }>();
  return row?.id ?? null;
}

/* ---------------- KV sync-state helpers ---------------------------------- */

async function getPendingDeletes(env: Env): Promise<string[]> {
  const raw = await env.OAUTH_KV.get(PENDING_DELETES_KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

async function setPendingDeletes(env: Env, ids: string[]): Promise<void> {
  await env.OAUTH_KV.put(PENDING_DELETES_KEY, JSON.stringify([...new Set(ids)]));
}

async function appendPendingDelete(env: Env, id: string): Promise<void> {
  const cur = await getPendingDeletes(env);
  if (!cur.includes(id)) await setPendingDeletes(env, [...cur, id]);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

/* ---------------- Website → Google --------------------------------------- */

/** Push one internal row to Google (insert if unmapped, else patch), then
 *  store the resulting google_event_id + etag.  google_synced_at is written
 *  with CURRENT_TIMESTAMP so it stays comparable with updated_at. */
export async function pushEvent(env: Env, rowOrId: number | PushableRow): Promise<void> {
  if (!isSyncConfigured(env)) return;

  const row =
    typeof rowOrId === 'number'
      ? await env.DB.prepare(
          `SELECT id, event_date, title, summary, message, priority, start_time, end_time, google_event_id
             FROM calendar_events WHERE id = ?`,
        )
          .bind(rowOrId)
          .first<PushableRow>()
      : rowOrId;
  if (!row) return;

  const body = mapEventToGoogle(row);
  const result = row.google_event_id
    ? await patchEvent(env, row.google_event_id, body)
    : await insertEvent(env, body);

  await env.DB.prepare(
    `UPDATE calendar_events
        SET google_event_id = ?, google_etag = ?, google_synced_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
  )
    .bind(result.id ?? row.google_event_id ?? null, result.etag ?? null, row.id)
    .run();
}

/** Delete the Google event mapped to a (now already-deleted) internal row.
 *  On failure the id is queued in KV so the cron backstop retries it. */
export async function pushDelete(env: Env, googleEventId: string): Promise<void> {
  if (!isSyncConfigured(env) || !googleEventId) return;
  try {
    await deleteEvent(env, googleEventId);
  } catch (err) {
    await appendPendingDelete(env, googleEventId);
    throw err;
  }
}

/* ---------------- Google → Website --------------------------------------- */

/** Reconcile a single changed Google event into calendar_events. */
async function applyGooglePull(env: Env, g: GoogleEvent, syncUserId: number): Promise<void> {
  if (!g.id) return;

  const existing = await env.DB.prepare(
    `SELECT id, google_etag FROM calendar_events WHERE google_event_id = ? LIMIT 1`,
  )
    .bind(g.id)
    .first<{ id: number; google_etag: string | null }>();

  // Deleted on Google.
  if (g.status === 'cancelled') {
    if (existing) {
      await env.DB.prepare('DELETE FROM calendar_event_teams WHERE event_id = ?')
        .bind(existing.id)
        .run();
      await env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(existing.id).run();
    }
    return;
  }

  const m = mapGoogleToEvent(g);
  if (!m.event_date) return; // unmappable (no start) → skip

  if (existing) {
    // Our own echo — etag unchanged since we pushed → nothing to do.
    if (g.etag && existing.google_etag && g.etag === existing.google_etag) return;
    // Real Google-side edit → apply.  Set both timestamps in one statement so
    // updated_at === google_synced_at and the row is NOT seen as dirty.
    await env.DB.prepare(
      `UPDATE calendar_events
          SET title = ?, summary = ?, message = ?, event_date = ?, start_time = ?, end_time = ?,
              priority = ?, google_etag = ?, google_synced_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
      .bind(
        m.title,
        m.summary,
        m.message,
        m.event_date,
        m.start_time,
        m.end_time,
        m.priority,
        g.etag ?? null,
        existing.id,
      )
      .run();
    return;
  }

  // Recover our own events whose google_event_id write never landed: pushEvent
  // stamps MGL_ID_PROP into extendedProperties, so a Google event carrying our
  // marker but with no google_event_id mapping is one of ours to adopt, not a
  // new Google-native event to import (spec §7.2 step 1).
  const markerRaw = g.extendedProperties?.private?.[MGL_ID_PROP];
  const markerId = markerRaw ? Number(markerRaw) : NaN;
  if (Number.isFinite(markerId) && markerId > 0) {
    const owned = await env.DB.prepare(
      'SELECT id, google_event_id FROM calendar_events WHERE id = ? LIMIT 1',
    )
      .bind(markerId)
      .first<{ id: number; google_event_id: string | null }>();
    if (owned) {
      // Only adopt an unmapped row. If it already maps to a DIFFERENT Google
      // event, this one is a stray duplicate we created — skip it (don't import
      // a duplicate internal row; an admin can delete the stray on Google).
      if (owned.google_event_id === null) {
        await env.DB.prepare(
          `UPDATE calendar_events
              SET google_event_id = ?, google_etag = ?, google_synced_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
        )
          .bind(g.id, g.etag ?? null, owned.id)
          .run();
      }
      return;
    }
  }

  // New Google-native event → import as a company-wide announcement.
  await env.DB.prepare(
    `INSERT INTO calendar_events
       (event_date, title, summary, message, task_id, priority, start_time, end_time, created_by,
        google_event_id, google_etag, google_synced_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  )
    .bind(
      m.event_date,
      m.title,
      m.summary,
      m.message,
      m.priority,
      m.start_time,
      m.end_time,
      syncUserId,
      g.id,
      g.etag ?? null,
    )
    .run();
}

/** Pull incremental changes from Google using the stored syncToken (or a
 *  30-day full sync on first run / after a 410). */
async function pullChanges(env: Env): Promise<void> {
  const syncUserId = await resolveSyncUserId(env);
  if (syncUserId == null) {
    console.error('gcal pull: no admin user to attribute imported events to');
    return;
  }

  let syncToken = (await env.OAUTH_KV.get(SYNC_TOKEN_KEY)) ?? undefined;
  let pageToken: string | undefined;
  let newSyncToken: string | undefined;

  for (let guard = 0; guard < 50; guard++) {
    let res;
    try {
      res = await listEvents(
        env,
        syncToken ? { syncToken, pageToken } : { timeMin: isoDaysAgo(30), pageToken },
      );
    } catch (err) {
      if ((err as { code?: string }).code === 'SYNC_TOKEN_INVALID') {
        await env.OAUTH_KV.delete(SYNC_TOKEN_KEY);
        syncToken = undefined;
        pageToken = undefined;
        continue; // restart as a full sync
      }
      throw err;
    }

    for (const g of res.items) {
      try {
        await applyGooglePull(env, g, syncUserId);
      } catch (err) {
        console.error('gcal pull: apply failed for', g.id, err);
      }
    }

    if (res.nextPageToken) {
      pageToken = res.nextPageToken;
      continue;
    }
    newSyncToken = res.nextSyncToken;
    break;
  }

  // 2026-09-11: ЗӨВХӨН ӨӨРЧЛӨГДСӨН үед бичнэ.  Cron 2 минут тутам ажилладаг тул
  // болзолгүй put нь өдөрт 720 KV бичилт байсан — Workers Free-ийн KV лимит
  // (1 000 бичилт/өдөр)-ийн 72%.  Google-ийн nextSyncToken нь өөрчлөлтгүй үед
  // ихэвчлэн ижил ирдэг; өөр бол л бичнэ.
  if (newSyncToken && newSyncToken !== syncToken) {
    await env.OAUTH_KV.put(SYNC_TOKEN_KEY, newSyncToken);
  }
}

/* ---------------- Cron backstop + entry ---------------------------------- */

/** Re-push rows that were never pushed or whose immediate push failed/lagged. */
async function reconcileDirty(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT id, event_date, title, summary, message, priority, start_time, end_time, google_event_id
       FROM calendar_events
      WHERE google_event_id IS NULL
         OR google_synced_at IS NULL
         OR updated_at > google_synced_at
      ORDER BY id ASC
      LIMIT 100`,
  ).all<PushableRow>();

  for (const row of results ?? []) {
    try {
      await pushEvent(env, row.id);
    } catch (err) {
      console.error('gcal reconcileDirty: push failed for', row.id, err);
    }
  }
}

/** Retry deletes whose immediate push failed. */
async function drainPendingDeletes(env: Env): Promise<void> {
  const ids = await getPendingDeletes(env);
  if (ids.length === 0) return;
  const remaining: string[] = [];
  for (const id of ids) {
    try {
      await deleteEvent(env, id);
    } catch {
      remaining.push(id);
    }
  }
  await setPendingDeletes(env, remaining);
}

/** Cron entry — invoked from the scheduled handler every ~2 minutes. */
export async function syncGoogleCalendar(env: Env): Promise<void> {
  if (!isSyncConfigured(env)) return;
  try {
    await drainPendingDeletes(env);
    await reconcileDirty(env);
    await pullChanges(env);
  } catch (err) {
    console.error('gcal sync failed', err);
  }
}
