/**
 * Thin Google Calendar API v3 REST wrappers.  No business logic — mapping and
 * loop-prevention live in lib/googleCalendarSync.ts.  All calls target the
 * single calendar in env.GOOGLE_CALENDAR_ID.
 */
import type { Env } from '../../types';
import { getCalendarAccessToken } from './calendarAuth';

const API_BASE = 'https://www.googleapis.com/calendar/v3';

export interface GoogleEventTime {
  /** All-day: YYYY-MM-DD. */
  date?: string;
  /** Timed: RFC3339 (may carry an offset). */
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id?: string;
  /** 'confirmed' | 'tentative' | 'cancelled'. */
  status?: string;
  etag?: string;
  summary?: string;
  description?: string;
  colorId?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  extendedProperties?: { private?: Record<string, string> };
}

export interface ListResult {
  items: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

export interface ListOpts {
  syncToken?: string;
  pageToken?: string;
  /** RFC3339 lower bound for the initial full sync (ignored when syncToken set). */
  timeMin?: string;
}

function calId(env: Env): string {
  if (!env.GOOGLE_CALENDAR_ID) throw new Error('GOOGLE_CALENDAR_ID is not set');
  return encodeURIComponent(env.GOOGLE_CALENDAR_ID);
}

export async function insertEvent(env: Env, body: GoogleEvent): Promise<GoogleEvent> {
  const token = await getCalendarAccessToken(env);
  const res = await fetch(`${API_BASE}/calendars/${calId(env)}/events`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Google insertEvent failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GoogleEvent;
}

export async function patchEvent(
  env: Env,
  eventId: string,
  body: GoogleEvent,
): Promise<GoogleEvent> {
  const token = await getCalendarAccessToken(env);
  const res = await fetch(
    `${API_BASE}/calendars/${calId(env)}/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  // Event was deleted on Google since we mapped it → recreate so we don't lose it.
  if (res.status === 404 || res.status === 410) return insertEvent(env, body);
  if (!res.ok) throw new Error(`Google patchEvent failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as GoogleEvent;
}

export async function deleteEvent(env: Env, eventId: string): Promise<void> {
  const token = await getCalendarAccessToken(env);
  const res = await fetch(
    `${API_BASE}/calendars/${calId(env)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
  );
  // Already gone (404/410) or success (200/204) → idempotent no-op.
  if (res.ok || res.status === 404 || res.status === 410) return;
  throw new Error(`Google deleteEvent failed: ${res.status} ${await res.text()}`);
}

export async function listEvents(env: Env, opts: ListOpts): Promise<ListResult> {
  const token = await getCalendarAccessToken(env);
  const params = new URLSearchParams({
    singleEvents: 'true',
    showDeleted: 'true',
    maxResults: '250',
  });
  if (opts.syncToken) params.set('syncToken', opts.syncToken);
  else if (opts.timeMin) params.set('timeMin', opts.timeMin);
  if (opts.pageToken) params.set('pageToken', opts.pageToken);

  const res = await fetch(
    `${API_BASE}/calendars/${calId(env)}/events?${params.toString()}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 410) {
    // syncToken expired → caller must restart a full sync.
    const err = new Error('SYNC_TOKEN_INVALID') as Error & { code?: string };
    err.code = 'SYNC_TOKEN_INVALID';
    throw err;
  }
  if (!res.ok) throw new Error(`Google listEvents failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as ListResult;
  return {
    items: data.items ?? [],
    nextPageToken: data.nextPageToken,
    nextSyncToken: data.nextSyncToken,
  };
}
