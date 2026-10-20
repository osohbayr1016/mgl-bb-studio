import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables } from '../types';
import { getClientIp } from '../lib/officeNetwork';
import {
  assertOfficeAccess,
  isOfficeGuardPublicPath,
  officeAccessJson,
} from '../lib/officeAccess';

/**
 * Global office-network gate for authenticated /api/* traffic.
 * Runs after authMiddleware so c.var.user is available.
 */
export const officeAccessGuard = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  try {
    const path = c.req.path;
    if (isOfficeGuardPublicPath(path)) return next();

    const user = c.get('user');
    if (!user) return next();

    const verdict = await assertOfficeAccess({
      env: c.env,
      requestUrl: c.req.url,
      clientIp: getClientIp(c),
      db: c.env.DB,
      user: { sub: user.sub, role: user.role },
    });
    if (!verdict.ok) {
      return c.json(officeAccessJson(verdict), verdict.status);
    }
  } catch (err) {
    console.warn('[office-access] guard fail-open', err);
  }
  return next();
});
