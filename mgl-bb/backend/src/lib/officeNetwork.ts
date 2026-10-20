import { ipMatches } from './ip';

/** Read the real client IP from Cloudflare / reverse-proxy headers. */
export function getClientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/** Same as getClientIp but for raw Request (MCP / OAuth paths). */
export function getClientIpFromRequest(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * True iff the given IP is in the active `office_ips` whitelist.
 * Each entry may be a bare address or CIDR block.
 */
export async function isOfficeIp(db: D1Database, ip: string): Promise<boolean> {
  if (!ip || ip === 'unknown') return false;
  try {
    const { results } = await db
      .prepare(`SELECT ip_address FROM office_ips WHERE is_active = 1`)
      .all<{ ip_address: string }>();
    for (const r of results ?? []) {
      if (ipMatches(ip, r.ip_address)) return true;
    }
  } catch (err) {
    console.warn('[office-access] office_ips lookup failed', err);
  }
  return false;
}
