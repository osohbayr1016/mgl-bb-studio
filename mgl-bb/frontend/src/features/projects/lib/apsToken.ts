import { apiFetch } from '@/shared/api/client';

/* Access-token provider for the APS Viewer. The SDK calls the returned function
 * with a callback expecting (token, expiresInSeconds); we fetch a short-lived
 * `viewables:read` token from the backend /aps/token endpoint and cache it
 * (with a 60s skew) so the SDK's proactive refresh doesn't re-hit us needlessly.
 * The token is app-wide (not project-scoped), so the cache is shared globally;
 * project_id is passed only so the backend can member-gate client callers. */

interface CachedToken {
  token: string;
  expiresAt: number;
}
let cache: CachedToken | null = null;

export function clearApsTokenCache(): void {
  cache = null;
}

export function makeApsTokenGetter(projectId?: number) {
  return (callback: (token: string, expiresIn: number) => void): void => {
    const now = Date.now();
    if (cache && cache.expiresAt - now > 60_000) {
      callback(cache.token, Math.floor((cache.expiresAt - now) / 1000));
      return;
    }
    const qs = projectId != null ? `?project_id=${projectId}` : '';
    apiFetch<{ access_token: string; expires_in: number }>(`/aps/token${qs}`)
      .then(({ access_token, expires_in }) => {
        cache = { token: access_token, expiresAt: Date.now() + expires_in * 1000 };
        callback(access_token, expires_in);
      })
      .catch((e) => {
        // Don't hand the viewer a bad token — it will emit a load error the
        // component surfaces. Clearing the cache lets the next attempt retry.
        cache = null;
        console.error('APS token fetch failed', e);
      });
  };
}
