import { createMiddleware } from 'hono/factory';
import type { Env, AppVariables } from '../types';
import { loadPolicy } from '../lib/revitPolicy';
import { logSecurityEvent } from '../lib/revitDeviceService';
import { getClientIp } from '../lib/officeNetwork';

/**
 * 365 хоногийн `purpose:'mcp'` токеныг `/api/revit/*`-д хүлээн авах эсэх (migration 0375).
 *
 * ЯАГААД: хуучин add-in (≤ 1.9.x) нь бүх REST дуудлагаа энэ нэг жилийн токеноор хийдэг —
 * хулгайлагдсан тохиолдолд төхөөрөмжийн түлхүүргүйгээр жил үргэлжлэн Revit-ийн замуудад
 * хандах боломж олгоно.  Шинэ add-in нь түлхүүртэй төхөөрөмжийн 30 минутын session
 * (`purpose:'revit'`)-оор ажилладаг.  Шилжилт дуусмагц админ бодлогыг
 * `revit.legacy_token_policy = deny` болгоно.
 *
 *   allow — өгөгдмөл (шилжилтийн үе): хуучин add-in хэвээр ажиллана
 *   log   — хуучин токены хэрэглээг аудитад бичнэ (хэн үлдсэнийг харахад)
 *   deny  — 403 `DEVICE_SESSION_REQUIRED`
 *
 * ⚠️ Лиценз / төхөөрөмжийн замууд ЗОРИУД чөлөөлөгдөнө: хуучин add-in хуучин токеноороо
 *    ЛИЦЕНЗ авч, түлхүүр бүртгүүлж шинэ горимд ШИЛЖИХ ёстой — эс бөгөөс `deny` нь
 *    бүх хуучин add-in-ийг шилжих замгүй түгжинэ.  ('revit-refresh' / 'revit'
 *    токенууд энд хамаарахгүй — `middleware/auth.ts`.)
 * ⚠️ `/mcp`, `/api/auth/mcp-token` ХӨНДӨГДӨХГҮЙ (Claude Desktop-ийн MCP холболт).
 * ⚠️ Бодлого уншихад D1 алдаа гарвал `allow` (энэ нь нэмэлт хатуужуулалт; суурь
 *    хамгаалалт нь лиценз олгох замд fail-closed).
 */
export const revitLegacyTokenGuard = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const user = c.get('user');
  if (!user || user.purpose !== 'mcp') return next();
  const path = c.req.path;
  if (path === '/api/revit/license' || path.startsWith('/api/revit/license/') || path.startsWith('/api/revit/device/')) {
    return next();
  }
  const policy = await loadPolicy(c.env.DB);
  if (!policy || policy.legacyTokenPolicy === 'allow') return next();

  if (policy.legacyTokenPolicy === 'deny') {
    await logSecurityEvent(c.env.DB, {
      event: 'legacy_token_denied',
      userId: user.sub,
      detail: path.slice(0, 120),
      ip: getClientIp(c),
    });
    return c.json(
      {
        ok: false,
        code: 'DEVICE_SESSION_REQUIRED',
        error: 'MGL Add-in-ийг шинэчилж, дахин нэвтэрнэ үү.',
      },
      403,
    );
  }
  // 'log' — хэрэглэгч тутамд өдөрт ойролцоогоор нэг мөр (хязгаарлагдмал аудит).
  if (Math.random() < 0.02) {
    await logSecurityEvent(c.env.DB, {
      event: 'legacy_token_used',
      userId: user.sub,
      detail: path.slice(0, 120),
      ip: getClientIp(c),
    });
  }
  return next();
});
