# Google Calendar Two-Way Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two-way sync the internal `calendar_events` announcement calendar with one shared company Google Calendar (`mgl.eandc@gmail.com`).

**Architecture:** Backend-only Cloudflare Worker feature. Website→Google pushes immediately on create/update/delete (`c.executionCtx.waitUntil`); Google→Website pulls on the existing 2-minute `scheduled` cron via a Google `syncToken`. Auth reuses the existing `GOOGLE_SA_JSON` service account (no new secret) minting a `calendar`-scoped token with no impersonation. Echo loops are prevented by a stored `google_event_id` + `etag` per row; a cron backstop re-pushes any row whose `updated_at > google_synced_at`.

**Tech Stack:** TypeScript (strict), Hono, Cloudflare Workers + D1 + KV (`OAUTH_KV`), WebCrypto (RS256, already used by `googleAuth.ts`), Google Calendar API v3.

## Global Constraints

- **No test framework exists in this repo** (CLAUDE.md: "There is no test suite anywhere — don't invent `npm test`"). The verification gate for each code task is `npx tsc -b` (run from `backend/`) confirming no *new* type errors in the files this task touched, plus the manual smoke tests in Tasks 7–8. Do **not** scaffold vitest/jest.
- **Stay in scope.** `npx tsc -b` compiles the whole app and may already fail on unrelated in-progress files from other agents. After each task confirm your files are clean, e.g. `npx tsc -b 2>&1 | grep -E "<file-you-touched>"` is empty; surface unrelated blockers, don't fix them.
- **TypeScript strict**, `noUncheckedIndexedAccess` is ON in the backend — index access yields `T | undefined`; guard it.
- **Backend `Env` is the source of truth** for bindings (`backend/src/types.ts`); `worker-configuration.d.ts` is generated and gitignored — don't edit it.
- **Mongolian identifiers/strings** are normal here; keep them.
- **Migrations:** highest number wins, never edit an applied migration. Next number is **0124**. Apply locally with `npx wrangler d1 execute mgl-progress-db --local --file=./migrations/0124_calendar_google_sync.sql` (from `backend/`).
- **Feature flag:** every entry point must no-op when `GOOGLE_SA_JSON` or `GOOGLE_CALENDAR_ID` is unset, so local dev and unconfigured environments never break. Gate with `isSyncConfigured(env)`.
- **UB timezone** is `Asia/Ulaanbaatar`, fixed UTC+8, no DST.
- `google_synced_at` MUST be written with SQL `CURRENT_TIMESTAMP` (never a JS ISO string) so it is byte-comparable with `updated_at` (both `YYYY-MM-DD HH:MM:SS` UTC). A JS `toISOString()` value (`...T...Z`) would sort *after* the space-separated SQLite format and silently break dirty detection.

---

## File Structure

**Create:**
- `backend/migrations/0124_calendar_google_sync.sql` — three sync-bookkeeping columns + index.
- `backend/src/lib/google/calendarAuth.ts` — `getCalendarAccessToken(env)` (calendar-scoped SA token, no impersonation).
- `backend/src/lib/google/calendarClient.ts` — thin Google Calendar v3 REST wrappers + response types.
- `backend/src/lib/googleCalendarSync.ts` — pure mappers + push/pull/backstop orchestration + cron entry.

**Modify:**
- `backend/src/types.ts` — `CalendarEventRow` (+3 columns), `Env` (+`GOOGLE_CALENDAR_ID?`, `GOOGLE_SYNC_USER_ID?`).
- `backend/src/lib/google/googleAuth.ts` — extract exported `mintServiceAccountToken(env, {scope, subject?})`; `getWorkspaceAccessToken` delegates to it.
- `backend/src/routes/calendar.ts` — push-on-write in POST/PUT/DELETE handlers.
- `backend/src/index.ts` — call `syncGoogleCalendar(env)` in the `scheduled` handler.
- `backend/wrangler.toml` — add `GOOGLE_CALENDAR_ID` under `[vars]` (Task 8).

No frontend changes: imported Google events are ordinary `calendar_events` rows already rendered by `GET /api/calendar/events`.

---

## Task 1: Schema — migration 0124 + types

**Files:**
- Create: `backend/migrations/0124_calendar_google_sync.sql`
- Modify: `backend/src/types.ts` (`CalendarEventRow` ~line 744, `Env` ~line 48)

**Interfaces:**
- Produces: three new nullable columns on `calendar_events` (`google_event_id`, `google_etag`, `google_synced_at`); `CalendarEventRow` fields of the same name typed `string | null`; `Env.GOOGLE_CALENDAR_ID?: string`, `Env.GOOGLE_SYNC_USER_ID?: string`.

- [ ] **Step 1: Write the migration**

Create `backend/migrations/0124_calendar_google_sync.sql`:

```sql
-- Google Calendar two-way sync bookkeeping on calendar_events (2026-07-20).
-- google_event_id : mapped Google event id; NULL until first pushed/imported.
-- google_etag     : last-synced Google etag; lets the cron skip our own echoes.
-- google_synced_at: UTC timestamp (CURRENT_TIMESTAMP format) of the last
--                   successful sync for this row. The cron backstop re-pushes
--                   rows where updated_at > google_synced_at.
ALTER TABLE calendar_events ADD COLUMN google_event_id TEXT;
ALTER TABLE calendar_events ADD COLUMN google_etag TEXT;
ALTER TABLE calendar_events ADD COLUMN google_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_calendar_events_google_event_id
  ON calendar_events(google_event_id);
```

- [ ] **Step 2: Apply the migration to the local D1**

Run (from `backend/`):
```bash
npx wrangler d1 execute mgl-progress-db --local --file=./migrations/0124_calendar_google_sync.sql
```
Expected: `Executed ... commands` with no error. Re-running errors with "duplicate column name" — that only confirms it already applied; move on.

- [ ] **Step 3: Add the columns to `CalendarEventRow`**

In `backend/src/types.ts`, inside `interface CalendarEventRow`, after `updated_at: string;` (line ~746) add:

```ts
  /** Google Calendar sync bookkeeping (migration 0124).  NULL until the row
   *  has been pushed to / imported from Google.  google_synced_at is stored
   *  in SQLite CURRENT_TIMESTAMP format so it is comparable with updated_at. */
  google_event_id: string | null;
  google_etag: string | null;
  google_synced_at: string | null;
```

- [ ] **Step 4: Add the env vars to `Env`**

In `backend/src/types.ts`, inside `interface Env`, right after `GOOGLE_SA_JSON?: string;` (line ~48) add:

```ts
  /** Google Calendar id to two-way sync the dashboard calendar with (e.g.
   *  'mgl.eandc@gmail.com').  Absent → calendar sync is a no-op.  See
   *  lib/googleCalendarSync.ts. */
  GOOGLE_CALENDAR_ID?: string;
  /** Internal user id that owns events imported FROM Google.  Falls back to
   *  the lowest-id admin when unset. */
  GOOGLE_SYNC_USER_ID?: string;
```

- [ ] **Step 5: Typecheck**

Run (from `backend/`): `npx tsc -b`
Expected: no error mentioning `types.ts`. (Adding optional/nullable fields is additive; existing `SELECT *` reads still satisfy the wider type.)

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/0124_calendar_google_sync.sql backend/src/types.ts
git commit -m "feat(calendar): 0124 google sync columns + Env vars"
```

---

## Task 2: Service-account calendar token

**Files:**
- Modify: `backend/src/lib/google/googleAuth.ts`
- Create: `backend/src/lib/google/calendarAuth.ts`

**Interfaces:**
- Consumes: `parseServiceAccount`, `importPrivateKey`, `tokenCache`, `nowSec`, `strToB64Url`, `bytesToB64Url`, `encoder`, `GOOGLE_TOKEN_URL`, `TokenResponse` (all currently module-private in `googleAuth.ts`).
- Produces: `mintServiceAccountToken(env: Env, opts: { scope: string; subject?: string }): Promise<string>` (exported from `googleAuth.ts`); `CALENDAR_SCOPE: string` and `getCalendarAccessToken(env: Env): Promise<string>` (exported from `calendarAuth.ts`).

- [ ] **Step 1: Extract the generic minter in `googleAuth.ts`**

In `backend/src/lib/google/googleAuth.ts`, add this exported function immediately above `getWorkspaceAccessToken`:

```ts
/** Mint a service-account access token for `opts.scope`.
 *  `opts.subject` set → domain-wide-delegation impersonation (Gmail mailboxes);
 *  omitted → the SA acts as itself (e.g. a calendar shared with the SA email).
 *  Cached per isolate for the token lifetime (minus 60 s skew). */
export async function mintServiceAccountToken(
  env: Env,
  opts: { scope: string; subject?: string },
): Promise<string> {
  const cacheKey = `sa:${opts.subject ?? '-'}:${opts.scope}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > nowSec() + 60) return cached.token;

  const sa = parseServiceAccount(env);
  const key = await importPrivateKey(sa.private_key);
  const iat = nowSec();
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim: Record<string, string | number> = {
    iss: sa.client_email,
    scope: opts.scope,
    aud: GOOGLE_TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  if (opts.subject) claim.sub = opts.subject;

  const signingInput = `${strToB64Url(JSON.stringify(header))}.${strToB64Url(
    JSON.stringify(claim),
  )}`;
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    encoder.encode(signingInput),
  );
  const assertion = `${signingInput}.${bytesToB64Url(sig)}`;

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google SA token failed (scope=${opts.scope}): ${res.status} ${text}`);
  }
  const data = (await res.json()) as TokenResponse;
  tokenCache.set(cacheKey, { token: data.access_token, expiresAt: iat + data.expires_in });
  return data.access_token;
}
```

- [ ] **Step 2: Make `getWorkspaceAccessToken` delegate to it**

Replace the entire body of `getWorkspaceAccessToken` (the existing function that builds the Gmail JWT) with:

```ts
/** Service-account JWT → impersonated access token for `subjectEmail`. */
async function getWorkspaceAccessToken(env: Env, subjectEmail: string): Promise<string> {
  return mintServiceAccountToken(env, {
    scope: GMAIL_SCOPES.join(' '),
    subject: subjectEmail,
  });
}
```

(This preserves the Gmail behaviour exactly — same scope, same `sub` impersonation, same token endpoint — while removing the duplicated signing code.)

- [ ] **Step 3: Create `calendarAuth.ts`**

Create `backend/src/lib/google/calendarAuth.ts`:

```ts
/**
 * Access-token minting for the shared company Google Calendar.
 *
 * The service account (GOOGLE_SA_JSON — the same one the Gmail integration
 * uses) acts as ITSELF here: no domain-wide-delegation `subject`.  The target
 * calendar is shared with the SA's client_email with "Make changes to events",
 * which is all the read/write access this feature needs (we never invite
 * attendees, so the SA's invite restriction on personal @gmail calendars does
 * not apply).
 */
import type { Env } from '../../types';
import { mintServiceAccountToken } from './googleAuth';

/** Read + write events on calendars shared with the service account. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';

/** Access token for the company Google Calendar. */
export function getCalendarAccessToken(env: Env): Promise<string> {
  return mintServiceAccountToken(env, { scope: CALENDAR_SCOPE });
}
```

- [ ] **Step 4: Typecheck**

Run (from `backend/`): `npx tsc -b`
Expected: no error mentioning `googleAuth.ts` or `calendarAuth.ts`. If `tokenCache`/`nowSec`/etc. show "declared but never read" they are still used — no such error should appear because the delegation keeps them referenced.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/google/googleAuth.ts backend/src/lib/google/calendarAuth.ts
git commit -m "feat(calendar): calendar-scoped service-account token"
```

---

## Task 3: Google Calendar REST client

**Files:**
- Create: `backend/src/lib/google/calendarClient.ts`

**Interfaces:**
- Consumes: `getCalendarAccessToken` (Task 2); `env.GOOGLE_CALENDAR_ID` (Task 1).
- Produces: types `GoogleEventTime`, `GoogleEvent`, `ListResult`, `ListOpts`; functions `insertEvent(env, body): Promise<GoogleEvent>`, `patchEvent(env, eventId, body): Promise<GoogleEvent>`, `deleteEvent(env, eventId): Promise<void>`, `listEvents(env, opts): Promise<ListResult>`. `listEvents` throws an `Error & { code: 'SYNC_TOKEN_INVALID' }` on HTTP 410.

- [ ] **Step 1: Create `calendarClient.ts`**

Create `backend/src/lib/google/calendarClient.ts`:

```ts
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
```

- [ ] **Step 2: Typecheck**

Run (from `backend/`): `npx tsc -b`
Expected: no error mentioning `calendarClient.ts`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/google/calendarClient.ts
git commit -m "feat(calendar): Google Calendar v3 REST client"
```

---

## Task 4: Pure mappers + config helpers

**Files:**
- Create: `backend/src/lib/googleCalendarSync.ts` (mappers + helpers only; orchestration is Task 5)

**Interfaces:**
- Consumes: `GoogleEvent` (Task 3); `CalendarEventRow`, `CalendarPriority`, `Env` (types).
- Produces: `isSyncConfigured(env): boolean`; `MGL_ID_PROP`, `SYNC_TOKEN_KEY`, `PENDING_DELETES_KEY` constants; `mapEventToGoogle(row): GoogleEvent`; `MappedInternalEvent` interface; `mapGoogleToEvent(g): MappedInternalEvent`; `resolveSyncUserId(env): Promise<number | null>`. `PushableRow` type alias.

- [ ] **Step 1: Create `googleCalendarSync.ts` with mappers + helpers**

Create `backend/src/lib/googleCalendarSync.ts`:

```ts
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
 * etag means a real Google-side edit.  This file: mappers + helpers.
 * Orchestration is added in Task 5 of the plan.
 */
import type { Env, CalendarPriority } from '../types';
import type { GoogleEvent } from './google/calendarClient';

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
```

- [ ] **Step 2: Typecheck**

Run (from `backend/`): `npx tsc -b`
Expected: no error mentioning `googleCalendarSync.ts`. (`console`/`crypto`/`Intl` are ambient in Workers; `noUncheckedIndexedAccess` is satisfied by the `?? 0` / `?? ''` guards.)

- [ ] **Step 3: Eyeball-verify the mapping tables**

There is no test runner, so confirm the mappers by reading them against these expected cases (no command to run — this is a code-review checkpoint):

| internal row | → Google |
|---|---|
| `{event_date:'2026-07-20', start_time:null}` | all-day `start.date=2026-07-20`, `end.date=2026-07-21` |
| `{start_time:'09:00', end_time:'10:30'}` | `start.dateTime=2026-07-20T09:00:00 (UB)`, `end 10:30` |
| `{start_time:'23:30', end_time:null}` | `end.dateTime=2026-07-21T00:30:00` (rolls a day) |
| `{priority:'urgent'}` | `colorId:'11'` |

| Google event | → internal |
|---|---|
| `start.date=2026-07-20` | `event_date=2026-07-20`, times null |
| `start.dateTime=...T09:00:00+08:00`, `end ...T10:00:00+08:00` | `start_time=09:00`, `end_time=10:00` |
| `summary=''` | `title='(гарчиггүй)'` |
| `colorId='11'` | `priority='urgent'` |
| no start at all | `event_date=''` (caller skips) |

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/googleCalendarSync.ts
git commit -m "feat(calendar): pure Google<->internal event mappers"
```

---

## Task 5: Sync orchestration (push / pull / backstop)

**Files:**
- Modify: `backend/src/lib/googleCalendarSync.ts` (append orchestration below the mappers)

**Interfaces:**
- Consumes: `insertEvent`, `patchEvent`, `deleteEvent`, `listEvents` (Task 3); mappers + `isSyncConfigured` + `resolveSyncUserId` + `PushableRow` + KV-key constants (Task 4).
- Produces: `pushEvent(env, rowOrId: number | PushableRow): Promise<void>`; `pushDelete(env, googleEventId: string): Promise<void>`; `syncGoogleCalendar(env): Promise<void>` (cron entry). Internal: `applyGooglePull`, `pullChanges`, `reconcileDirty`, `drainPendingDeletes`, KV helpers.

- [ ] **Step 1: Add imports + KV helpers**

At the top of `backend/src/lib/googleCalendarSync.ts`, extend the calendarClient import to pull in the REST functions:

```ts
import {
  insertEvent,
  patchEvent,
  deleteEvent,
  listEvents,
  type GoogleEvent,
} from './google/calendarClient';
```

(Replace the existing `import type { GoogleEvent } ...` line.)

Then append at the end of the file:

```ts
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
```

- [ ] **Step 2: Add `pushEvent` + `pushDelete` (Website → Google)**

Append:

```ts
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
```

- [ ] **Step 3: Add `applyGooglePull` + `pullChanges` (Google → Website)**

Append:

```ts
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

  if (newSyncToken) await env.OAUTH_KV.put(SYNC_TOKEN_KEY, newSyncToken);
}
```

- [ ] **Step 4: Add the backstop + cron entry**

Append:

```ts
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
      await pushEvent(env, row);
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
```

- [ ] **Step 5: Typecheck**

Run (from `backend/`): `npx tsc -b`
Expected: no error mentioning `googleCalendarSync.ts`. Confirm `results` is typed `PushableRow[] | undefined` and the `?? []` guard handles it.

- [ ] **Step 6: Commit**

```bash
git add backend/src/lib/googleCalendarSync.ts
git commit -m "feat(calendar): push/pull/backstop sync orchestration"
```

---

## Task 6: Push-on-write in the calendar routes

**Files:**
- Modify: `backend/src/routes/calendar.ts` (imports; POST `/events` ~line 321; PUT `/events/:id` ~line 411; DELETE `/events/:id` ~line 418)

**Interfaces:**
- Consumes: `pushEvent`, `pushDelete`, `isSyncConfigured` (Task 5); `c.executionCtx.waitUntil` (Hono, already used in routes/email.ts).
- Produces: no new exports — side-effecting Google pushes after each write.

- [ ] **Step 1: Import the sync helpers**

At the top of `backend/src/routes/calendar.ts`, after the existing imports add:

```ts
import { pushEvent, pushDelete, isSyncConfigured } from '../lib/googleCalendarSync';
```

- [ ] **Step 2: Push after create (POST `/events`)**

In the `POST /events` handler, the code builds `ids` (the inserted row ids) and fetches `rows`, then does `return c.json({ events: rows ?? [], ... }, 201);`. Immediately **before** that `return`, insert:

```ts
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
```

- [ ] **Step 3: Push after update (PUT `/events/:id`)**

In the `PUT /events/:id` handler, after the row is re-fetched and before `return c.json({ event: row });`, insert:

```ts
  if (isSyncConfigured(c.env)) {
    const env = c.env;
    c.executionCtx.waitUntil(
      pushEvent(env, id).catch((err) => console.error('gcal push (update) failed for', id, err)),
    );
  }
```

- [ ] **Step 4: Capture the mapping BEFORE delete, then push the delete**

Replace the body of the `DELETE /events/:id` handler (currently: validate `id`, delete junction rows, delete the event, return `{ ok: true }`) with:

```ts
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
```

- [ ] **Step 5: Typecheck**

Run (from `backend/`): `npx tsc -b`
Expected: no error mentioning `routes/calendar.ts`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/calendar.ts
git commit -m "feat(calendar): push calendar writes to Google Calendar"
```

---

## Task 7: Wire the cron + local smoke test

**Files:**
- Modify: `backend/src/index.ts` (import ~line 55; `scheduled` handler ~line 240-245)

**Interfaces:**
- Consumes: `syncGoogleCalendar` (Task 5).
- Produces: the cron now also runs the calendar sync.

- [ ] **Step 1: Import + call in the scheduled handler**

In `backend/src/index.ts`, add near the other lib imports (~line 55):

```ts
import { syncGoogleCalendar } from './lib/googleCalendarSync';
```

Then inside the `scheduled` handler, after the existing `ctx.waitUntil(reconcileMeetings(env));`, add:

```ts
    // Two-way sync the dashboard calendar with the company Google Calendar
    // (no-op unless GOOGLE_SA_JSON + GOOGLE_CALENDAR_ID are set).
    ctx.waitUntil(syncGoogleCalendar(env));
```

- [ ] **Step 2: Typecheck the whole worker**

Run (from `backend/`): `npx tsc -b`
Expected: no error mentioning `index.ts`, `googleCalendarSync.ts`, `calendarClient.ts`, `calendarAuth.ts`, `googleAuth.ts`, `routes/calendar.ts`, or `types.ts`. Unrelated pre-existing errors from other agents' WIP are not yours — confirm with `npx tsc -b 2>&1 | grep -E "calendar|googleAuth"` returning nothing.

- [ ] **Step 3: Local dev smoke — config present**

Put real values in `backend/.dev.vars` (git-ignored):
```
GOOGLE_SA_JSON={"client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n", ...}
GOOGLE_CALENDAR_ID=mgl.eandc@gmail.com
```
(The SA email must already be shared on the calendar with "Make changes to events".)

Run (from `backend/`): `npm run dev` (wrangler dev on :3000).

- [ ] **Step 4: Verify Website → Google (create)**

With an admin JWT in `$TOKEN`, create an event:
```bash
curl -s -X POST http://localhost:3000/api/calendar/events \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"title":"Sync smoke test","event_date":"2026-07-25","priority":"urgent","message":"hello"}'
```
Expected: `201` with the created event. Within a second, the event appears on the Google Calendar (red/urgent color). Then confirm the row got its mapping:
```bash
npx wrangler d1 execute mgl-progress-db --local \
  --command "SELECT id, google_event_id, google_etag, google_synced_at FROM calendar_events WHERE title='Sync smoke test'"
```
Expected: `google_event_id` and `google_etag` are non-null.

- [ ] **Step 5: Verify Website → Google (delete)**

Delete that event via `DELETE /api/calendar/events/:id` (use the id from Step 4). Expected: it disappears from Google Calendar within a second.

- [ ] **Step 6: Verify Google → Website (cron pull)**

Create an event **directly in Google Calendar** (e.g. "From Google 09:00–10:00" on 2026-07-26). Trigger the cron manually (wrangler dev exposes a scheduled trigger endpoint):
```bash
curl "http://localhost:3000/__scheduled?cron=*/2+*+*+*+*"
```
Wait a moment, then:
```bash
npx wrangler d1 execute mgl-progress-db --local \
  --command "SELECT id, title, event_date, start_time, end_time, google_event_id FROM calendar_events WHERE google_event_id IS NOT NULL ORDER BY id DESC LIMIT 5"
```
Expected: a new row titled "From Google" with `event_date=2026-07-26`, `start_time=09:00`, `end_time=10:00`, and a `google_event_id`.

- [ ] **Step 7: Verify echo prevention**

Trigger `/__scheduled` two more times. Re-run the query from Step 6. Expected: **no duplicate rows** are created for the same Google event, and the website-created event from Step 4 (if you recreate one) is not re-imported as a second row.

- [ ] **Step 8: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat(calendar): run Google Calendar sync on the 2-min cron"
```

---

## Task 8: Production config + deploy

**Files:**
- Modify: `backend/wrangler.toml` (`[vars]` block)

**Interfaces:**
- Consumes: everything above.
- Produces: the live two-way sync.

- [ ] **Step 1: One-time Google setup (manual, outside the repo)**

1. In the GCP project that owns the existing Gmail service account, enable the **Google Calendar API**.
2. In `mgl.eandc@gmail.com`'s Google Calendar → Settings → **Share with specific people** → add the SA's `client_email` (from `GOOGLE_SA_JSON`) with **"Make changes to events"**.
3. Confirm the Calendar ID is `mgl.eandc@gmail.com` (Settings → Integrate calendar), or copy the specific calendar's id if using a secondary calendar.

- [ ] **Step 2: Add the calendar id to `wrangler.toml`**

In `backend/wrangler.toml`, under the existing `[vars]` block, add:
```toml
GOOGLE_CALENDAR_ID = "mgl.eandc@gmail.com"
```
(`GOOGLE_SA_JSON` is already a configured secret — do not re-add it. `GOOGLE_SYNC_USER_ID` is optional; leave unset to default to the lowest-id admin.)

- [ ] **Step 3: Deploy (migrations first, then the worker)**

From `backend/`:
```bash
npx wrangler d1 migrations apply mgl-progress-db --remote --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```
Expected: migration `0124` applies (or is already recorded — if a "duplicate column" error appears, the schema drifted ahead of the tracker; reconcile per the repo convention, don't re-run via `d1 execute`). Deploy succeeds (esbuild, no full typecheck — unaffected by unrelated frontend/tsc errors).

- [ ] **Step 4: Production smoke**

Repeat Task 7 Steps 4 & 6 against the production worker host (create one event each way; the real cron fires every 2 minutes, so allow up to ~2 min for the Google→Website direction rather than triggering `/__scheduled`). Delete both test events afterward and confirm they clear on both sides.

- [ ] **Step 5: Commit**

```bash
git add backend/wrangler.toml
git commit -m "chore(calendar): enable Google Calendar sync in production"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 prerequisites / feature flag | Task 2 (`calendarAuth`), Task 4 (`isSyncConfigured`), Task 8 (Google setup, `GOOGLE_CALENDAR_ID`) |
| §4 migration 0124 + columns | Task 1 |
| §5 module layout (calendarAuth/calendarClient/googleCalendarSync + edits) | Tasks 2, 3, 4, 5, 6, 7 |
| §6.1 internal→Google mapping (time/color/extendedProps) | Task 4 `mapEventToGoogle` |
| §6.2 Google→internal mapping + multi-day limitation | Task 4 `mapGoogleToEvent` (single start date) |
| §7.1 push-on-write | Task 6 |
| §7.2 pull + echo prevention (etag) | Task 5 `pullChanges`/`applyGooglePull` |
| §7.3 backstop (reconcileDirty + pending deletes) | Task 5 |
| §8 errors: best-effort push, 410 full-resync, last-writer-wins | Task 5 (`SYNC_TOKEN_INVALID` handling, waitUntil catches) |
| §9 manual verification | Task 7, Task 8 |

**Refinement vs spec:** §6.2 said imported events are always `priority='normal'`. The plan maps `colorId ↔ priority` **both** ways (Task 4) so a website `urgent` event round-trips instead of resetting to normal on the next pull. This is a strict improvement and is documented in `mapGoogleToEvent`.

**Placeholder scan:** none — every code step contains full source; every verification step has an exact command + expected result.

**Type consistency:** `PushableRow`, `MappedInternalEvent`, `GoogleEvent`, `isSyncConfigured`, `pushEvent`, `pushDelete`, `syncGoogleCalendar`, `mapEventToGoogle`, `mapGoogleToEvent`, `resolveSyncUserId` are named identically wherever produced (Tasks 3–5) and consumed (Tasks 6–7). `google_synced_at` is written with `CURRENT_TIMESTAMP` everywhere (Tasks 1, 5) per the Global Constraint.

**No-test-framework note:** verification is `npx tsc -b` + the manual smokes in Tasks 7–8, consistent with the repo having no test runner.
