// Frontend Ulaanbaatar-timezone helpers.
// The browser may be in any timezone (UTC, Europe, etc.) but the company
// reports in Ulaanbaatar local time. Centralize conversion so "today" is
// consistent on the client and the backend.

const UB_TZ = 'Asia/Ulaanbaatar';

/**
 * Returns today's date in Ulaanbaatar as YYYY-MM-DD.
 * Used for the default `date` of progress submissions.
 */
export function todayUB(): string {
  // en-CA renders as YYYY-MM-DD natively.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: UB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * HH:mm in Ulaanbaatar. Useful when we want to show the user the reporting
 * time without leaking the browser's timezone.
 */
export function nowTimeUB(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UB_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

/**
 * Prettier "Today · 14:23 (UB)" for the MyTasks banner.
 */
export function todayBannerUB(): string {
  return `${todayUB()} · ${nowTimeUB()} (Улаанбаатар)`;
}

// ---------------------------------------------------------------------------
// Display helpers — `YYYY-MM-DD` everywhere
// ---------------------------------------------------------------------------
// One unified date format (ISO year-month-day) so every surface of the app
// reads the same way.  The browser's local timezone is fine here because we're
// just rendering — backend always stores ISO timestamps and we only need the
// calendar slot.

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `YYYY-MM-DD` for a Date | ISO string | YYYY-MM-DD string | null.
 * Returns '' when the input is empty / unparseable so the JSX can render
 * the empty case without a defensive ternary at every call site.
 */
export function formatDate(input: Date | string | null | undefined): string {
  if (!input) return '';
  let d: Date;
  if (input instanceof Date) {
    d = input;
  } else {
    // YYYY-MM-DD without time gets local-midnight semantics so the day
    // never slips backwards in negative-offset timezones.
    const s = /^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T00:00:00` : input;
    d = new Date(s);
  }
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Parse a backend timestamp into the correct instant.
 *
 * SQLite `datetime('now')` (the default for created_at / decided_at /
 * updated_at) yields a *naive* "YYYY-MM-DD HH:MM:SS" string in **UTC**.
 * `new Date("2026-05-26 10:00:00")` would read that as browser-local time,
 * showing it ~8h behind Ulaanbaatar.  So we explicitly tag naive datetimes
 * as UTC.  Strings that already carry a zone (e.g. clock_in's
 * `nowInUBIso()` "+08:00", or any "...Z") parse as-is.
 */
function parseInstant(input: Date | string): Date {
  if (input instanceof Date) return input;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(input)) {
    return new Date(input.replace(' ', 'T') + 'Z');
  }
  return new Date(input);
}

const UB_DATETIME_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: UB_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `YYYY-MM-DD HH:mm` for timestamps, rendered in Ulaanbaatar time. */
export function formatDateTime(input: Date | string | null | undefined): string {
  if (!input) return '';
  const d = parseInstant(input);
  if (isNaN(d.getTime())) return '';
  const parts = UB_DATETIME_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
