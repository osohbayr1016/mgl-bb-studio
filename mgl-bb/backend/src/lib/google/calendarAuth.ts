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
