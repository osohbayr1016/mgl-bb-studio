import { createMiddleware } from 'hono/factory';
import { moduleOfPath } from './modules';
import { orgConfig } from './orgConfig';
import type { Env, AppVariables } from '../types';

/**
 * МОДУЛИЙН ЭРХИЙН ХААЛТ — тухайн байгууллага худалдаж аваагүй модулийн
 * `/api` гарцуудыг хаана.
 *
 * `lib/workerScope.ts`-ийн ХОЁР ДАХЬ хувилбар: тэр нь ХЭРЭГЛЭГЧИЙН (worker
 * role) хамрах хүрээг хязгаарладаг бол энэ нь DEPLOYMENT-ийн хамрах хүрээг
 * хязгаарлана.  Хоёулаа `/api/*`-д, дараалан суудаг.
 *
 * ЗАН ТӨЛӨВ:
 *   • Тохиргоо байхгүй (`enabledModules === null`) → юу ч хийхгүй.  Энэ бол
 *     ДЕФОЛТ: MGL-ийн ажиллаж байгаа production дээр ямар ч гарц хаагдахгүй.
 *   • Танихгүй `/api` зам → дамжуулна.  Хаах нь энэ давхаргын ажил биш;
 *     Hono өөрөө 404 өгнө.
 *   • Хаагдсан модуль → **403**, `workerScopeGuard`-тай ижил хэлбэрээр.
 *
 * ⚠️ ЯАГААД 403, 404 БИШ ВЭ:  404 нь «модуль байдгийг ч мэдэгдэхгүй» гэсэн
 *    давуу талтай ч, энэ нь single-tenant суулгац тул тэр далдлалт бараг
 *    утгагүй.  Харин 403 нь алдаа хайхад ойлгомжтой, мөн репод аль хэдийн
 *    байгаа `workerScopeGuard`-ийн хэв маягтай нэг мөр байна.  Хариу нь
 *    ЗААВАЛ JSON — `frontend/src/shared/api/client.ts`-ийн `apiFetch` нь
 *    хариуг JSON гэж уншиж, алдааг нь залгидаг тул JSON биш хариу нь
 *    `{}` болж хувирдаг.
 *
 * ⚠️ ЭНЭ ХААЛТ `/api/*`-д Л СУУНА.  `/mcp` нь OAuth provider-ийн эзэмшдэг
 *    root зам тул энд ХАМРАГДАХГҮЙ — `workerScope`-ийн адил цоорхой.
 *    MCP талын ROLE ба TENANT хязгаарлалт нь одоо `mcp/guard.ts`-д
 *    төвлөрсөн бөгөөд `index.ts`-ийн `guardMcp` (L1) ба
 *    `MglMcpAgent.init()` (L2) гэсэн ХОЁР давхаргаар мөрддөг.
 *    ⚠️ ГЭХДЭЭ МОДУЛИЙН эрх (`enabledModules`) нь `/mcp`-д ХЭВЭЭР
 *    шалгагддаггүй — tool бүрийг модульд буулгах ажил хийгдээгүй.
 */
export const entitlementGuard = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const enabled = orgConfig().enabledModules;
  if (!enabled) return next(); // хязгаарлалтгүй суулгац

  const mod = moduleOfPath(c.req.path);
  if (mod === null) return next(); // танихгүй зам — Hono шийднэ
  if (enabled.has(mod)) return next();

  return c.json(
    {
      error: 'Энэ модуль тухайн байгууллагад нээгдээгүй байна',
      code: 'module_disabled',
      module: mod,
    },
    403,
  );
});
