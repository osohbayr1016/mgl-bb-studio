import type { Env, UserRole } from '../types';
import { devAuthAvailable } from './devAuth';
import { currentTenantId } from './requestContext';
import { isOfficeIp } from './officeNetwork';

export const OFFICE_NETWORK_CODE = 'office_network_required';

export type OfficeAccessVerdict =
  | { ok: true }
  | { ok: false; status: 403; code: typeof OFFICE_NETWORK_CODE; error: string; detail: string };

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; allowed: boolean }>();

function cacheKey(userId: number): string {
  return `${currentTenantId()}:${userId}`;
}

export function invalidateRemoteAccessCache(userId?: number): void {
  if (userId === undefined) cache.clear();
  else cache.delete(cacheKey(userId));
}

/** DB-аас remote_access_allowed уншина (60 сек cache). */
export async function userHasRemoteAccess(db: D1Database, userId: number): Promise<boolean> {
  const now = Date.now();
  const key = cacheKey(userId);
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.allowed;

  let allowed = false;
  try {
    const row = await db
      .prepare('SELECT remote_access_allowed FROM users WHERE id = ?')
      .bind(userId)
      .first<{ remote_access_allowed: number | null }>();
    allowed = row?.remote_access_allowed === 1;
  } catch {
    // D1 алдаа / багана байхгүй → fail-open. `false` бол бүх staff-ийг түгжинэ.
    allowed = true;
  }
  cache.set(key, { at: now, allowed });
  return allowed;
}

export type AssertOfficeAccessOpts = {
  env: Env;
  requestUrl: string;
  clientIp: string;
  db: D1Database;
  /** Authenticated user; login handler passes the DB row directly. */
  user?: { sub: number; role: UserRole; remote_access_allowed?: number | null };
};

/**
 * Оффисын сүлжээний хязгаарлалт — staff-ийг office IP-д, client + remote
 * зөвшөөрөлтэй хүмүүсийг гаднаас ч нэвтрэхэд зориулсан.
 */
export async function assertOfficeAccess(opts: AssertOfficeAccessOpts): Promise<OfficeAccessVerdict> {
  const { env, requestUrl, clientIp, db, user } = opts;

  try {
    // 2026-09-01: global gate on /auth/me locked the SPA (loader → timeout).
    // Set wrangler [vars] OFFICE_ACCESS_ENFORCED = "1" only after staff who
    // work off-site have remote_access_allowed=1.
    if (env.OFFICE_ACCESS_ENFORCED !== '1') return { ok: true };
    if (devAuthAvailable(env, requestUrl)) return { ok: true };
    if (user?.role === 'client') return { ok: true };
    if (user?.remote_access_allowed === 1) return { ok: true };
    if (await isOfficeIp(db, clientIp)) return { ok: true };
    if (!user) return officeDenied(clientIp);
    if (await userHasRemoteAccess(db, user.sub)) return { ok: true };
    return officeDenied(clientIp);
  } catch (err) {
    console.warn('[office-access] fail-open', err);
    return { ok: true };
  }
}

function officeDenied(clientIp: string): OfficeAccessVerdict {
  return {
    ok: false,
    status: 403,
    code: OFFICE_NETWORK_CODE,
    error: 'Оффисын сүлжээнд холбогдоно уу',
    detail: `IP хаяг (${clientIp}) зөвшөөрөгдөөгүй байна`,
  };
}

export function officeAccessJson(verdict: Extract<OfficeAccessVerdict, { ok: false }>) {
  return { error: verdict.error, detail: verdict.detail, code: verdict.code };
}

/** Public /api paths that skip the global office gate (login checks in-handler). */
export function isOfficeGuardPublicPath(path: string): boolean {
  return (
    path === '/api/auth/login' ||
    path === '/api/auth/me' ||
    path === '/api/auth/logout' ||
    path === '/api/landing/public' ||
    path === '/api/landing/v2/public' ||
    path === '/api/landing/v2/public/index' ||
    path === '/api/landing/v2/public/project-cards' ||
    path === '/api/email/oauth/callback'
  );
}
