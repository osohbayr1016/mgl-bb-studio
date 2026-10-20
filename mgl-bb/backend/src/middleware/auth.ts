import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import { verifyToken } from '../lib/jwt';
import { devAuthAvailable, devAuthPayload, warnDevAuthOnce } from '../lib/devAuth';
import { ADMIN_ROLES } from '../types';
import type { Env, AppVariables, UserRole } from '../types';
import { currentTenantId, hasTenantContext } from '../lib/requestContext';
import { checkTokenValidity } from '../lib/tokenValidity';
import { revitSessionPathAllowed, revitSessionState } from '../lib/revitSessionCheck';

export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: AppVariables;
}>(async (c, next) => {
  const path = c.req.path;

  // Skip auth for login endpoint
  if (path === '/api/auth/login') {
    return next();
  }

  // Public marketing landing — read-only payload the unauthenticated
  // www.mglenc.com homepage consumes. Mutations live elsewhere under
  // /api/landing/admin/* and still require an admin token.
  if (path === '/api/landing/public') {
    return next();
  }

  // Block-based landing v2 public reads (page payload + project-page index
  // + hydrated project cards). Mutations under /api/landing/v2/admin/* still
  // require an admin token.
  if (
    path === '/api/landing/v2/public' ||
    path === '/api/landing/v2/public/index' ||
    path === '/api/landing/v2/public/project-cards'
  ) {
    return next();
  }

  // Захиалагчийн урилга — нууц үг тохируулах хүнд токен БАЙХГҮЙ.  Хоёулаа
  // нэг удаагийн KV урилгын түлхүүрт итгэдэг (`lib/clientInvite.ts`), тэр нь
  // хэрэглэгдмэгц устдаг.  Замууд нь ЯГ ТОГТМОЛ тул токеныг URL-д биш биед
  // авдаг — эс тэгвэл энэ `path ===` тулгалт ажиллахгүй.
  if (path === '/api/auth/client/invite-info' || path === '/api/auth/client/accept') {
    return next();
  }

  // Захиалагчийн realtime сувгийн гар барилт.  Хөтчийн WebSocket API нь
  // `Authorization` толгой явуулж чаддаггүй тул токеныг `?t=` эсвэл cookie-
  // гоор авч, `routes/clientPortal.ts` дотроо ӨӨРӨӨ шалгана
  // (`/meeting-audio`-тай ижил буулт).
  if (path === '/api/client/ws') {
    return next();
  }

  // System Workbench-ийн амьд урсгалын WebSocket — ижил шалтгаан; токеноо
  // `routes/devWorkbench.ts` (`/workbench-live`) дотроо шалгаж, зөвхөн admin.
  if (path === '/api/mgl-ai/workbench-live') {
    return next();
  }

  // Gmail OAuth redirect target — Google sends the browser here with
  // ?code=&state=. There's no bearer/cookie to rely on across the redirect,
  // so the handler in routes/email.ts trusts a short-lived signed `state`
  // token instead (see /oauth/start). No c.var.user is set on this path.
  if (path === '/api/email/oauth/callback') {
    return next();
  }

  let token = getCookie(c, 'token');
  const authHeader = c.req.header('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // Жинхэнэ token эхэлж бодогдоно — локал алгасалт нь ЗӨВХӨН token байхгүй
  // (эсвэл хүчингүй) үед ажиллана, тул локалд өөр хэрэглэгчээр нэвтэрч
  // тестлэх боломж хэвээр үлдэнэ.
  const payload = token ? await verifyToken(token, c.env.JWT_SECRET) : null;

  if (!payload) {
    // Локал хөгжүүлэлт: `.dev.vars`-т DEV_AUTH_BYPASS=1 бол 401-ийн оронд
    // DEV_AUTH_USER (өгөгдмөл `admin`) хэрэглэгчээр нэвтэрсэнд тооцно.
    // Prod-д flag байхгүй + host шалгалт хоёулаа хаадаг — lib/devAuth.ts үз.
    if (devAuthAvailable(c.env, c.req.url)) {
      const devUser = await devAuthPayload(c.env);
      if (devUser) {
        warnDevAuthOnce(c.env.DEV_AUTH_USER?.trim() || 'admin');
        c.set('user', devUser);
        return next();
      }
    }
    return c.json({ error: token ? 'Invalid or expired token' : 'Unauthorized' }, 401);
  }

  // ─── ОЛОН-TENANT ХИЛ ───────────────────────────────────────────────
  // `JWT_SECRET` нь Worker-т НЭГ тул A компанид олгосон токен B компанийн
  // контекстэд ч гарын үсгийн хувьд ХҮЧИНТЭЙ шалгагдана.  `sub` нь тухайн
  // компанийн DB доторх user id учир A-гийн `sub: 5` нь B-д ӨӨР ХҮН.
  // Тулгахгүй бол энэ нь бүрэн эрхийн давалт болно.
  //
  // Нэг-tenant суулгацад `hasTenantContext()` худал → шалгалт огт хийгдэхгүй,
  // хуучин токенууд хүчинтэй хэвээр (`tid` claim байхгүй).
  if (hasTenantContext()) {
    const expected = currentTenantId();
    if (payload.tid !== expected) {
      console.warn(
        `[tenant] token tid=${payload.tid ?? '<байхгүй>'} ≠ хүсэлтийн tenant=${expected}`,
      );
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }

  // ─── ТОКЕНЫ ЦУЦЛАЛТ (1A-3) ─────────────────────────────────────────
  // `verifyToken` нь гарын үсэг + `exp`-ээс өөр юу ч шалгадаггүй, DB-д огт
  // ханддаггүй.  Энэ мөр нь идэвхгүй болгосон хэрэглэгч, устгасан хэрэглэгч,
  // мөн `users.tokens_valid_from`-оос ӨМНӨ олгогдсон токеныг хаана.
  //
  // ⚠️ Байрлал ЧУХАЛ: дээрх dev-bypass салаанаас ДООШ (bypass нь `payload`
  //    NULL үед л ажилладаг тул хиймэл payload-ыг DB-тэй тулгах хэрэггүй), мөн
  //    §2.8-ийн 5 нээлттэй замын ДАРАА (тэдэнд `c.var.user` огт байхгүй).
  // ⚠️ Хос дуудагч: `index.ts`-ийн `resolveExternalToken` нь /mcp ба /sse-д
  //    ЯГ ижил шалгалт хийнэ.  Зөвхөн энд нэмэх нь ХУДАЛ баталгаа болно.
  // ⚠️ `purpose` шалгалт ЭНД БАЙХГҮЙ бөгөөд нэмэхийг ХОРИГЛОНО — Revit add-in
  //    нь бүх REST дуудлагаа `purpose:'mcp'` токеноор хийдэг.
  const validity = await checkTokenValidity(c.env.DB, payload);
  if (!validity.ok) {
    // Мессежийг ЗОРИУДААР өөрчлөөгүй: frontend-ийн `apiFetch` энэ 401-ийг
    // үзээд нэвтрэх рүү шиддэг.  Шалтгааныг зөвхөн лог руу гаргана.
    console.warn(`[auth] токен татгалзав sub=${payload.sub} шалтгаан=${validity.reason}`);
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  // ─── REVIT ТӨХӨӨРӨМЖИД УЯАТАЙ ТОКЕНУУД (migration 0375) ──────────────
  // ⚠️ Эдгээр нь ШИНЭ purpose-ууд — 'mcp'-ийн (дээр: татгалзахыг ХОРИГЛОСОН) дүрмийг
  //    хөндөхгүй.
  //   'revit-refresh' — add-in-ий хадгалдаг renewal credential (30 хоног).  Ганцаараа
  //                     ямар ч эрх өгөхгүй: ЗӨВХӨН лиценз / session шинэчлэх 3 замд
  //                     хүчинтэй (түлхүүрийн proof-тэй хамт).  Хулгайлагдсан ч бусад
  //                     /api замд 401.
  //   'revit'         — 30 минутын API session.  Төхөөрөмж хаагдсан / цуцлагдсан /
  //                     «бүх лицензийг зогсоох» асаалттай бол 60 секундэд хүчингүй.
  if (payload.purpose === 'revit-refresh') {
    if (!REVIT_RENEWAL_PATHS.has(path)) {
      console.warn(`[auth] revit-refresh токен ${path} дээр татгалзав sub=${payload.sub}`);
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  } else if (payload.purpose === 'revit') {
    const session = await revitSessionState(c.env.DB, payload);
    if (!session.valid) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
    // Session нь add-in-ий замуудад л хүчинтэй: хулгайлагдсан session (admin role-той ч) 30 минутын турш
    // хэрэглэгч, төлбөр, MCP токен цохих зэрэг БУСАД /api-д хүрэхгүй.  (`revit.session_scope=open` — яаралтай.)
    if (!session.scopeOpen && !revitSessionPathAllowed(path, c.req.method)) {
      console.warn(`[auth] revit session ${path} дээр хүрээнээс гадуур sub=${payload.sub}`);
      return c.json({ error: 'Forbidden', code: 'SESSION_SCOPE' }, 403);
    }
  }

  c.set('user', payload);
  return next();
});

/** Renewal credential-ийг хүлээн авах цорын ганц /api замууд (`routes/revitLicense.ts`, `revitDevice.ts`). */
const REVIT_RENEWAL_PATHS = new Set([
  '/api/revit/license',
  '/api/revit/device/challenge',
  '/api/revit/device/session',
]);

export function requireRole(...roles: UserRole[]) {
  return createMiddleware<{
    Bindings: Env;
    Variables: AppVariables;
  }>(async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Forbidden: insufficient permissions' }, 403);
    }
    return next();
  });
}

/** Бүх "өдөр тутмын админ" эрх — ганц `admin` role.  (`system_admin`
 *  ба `management` role-уудыг 2026-06-д болиулсан — хоёулаа кодод л
 *  байсан бөгөөд production DB-ийн CHECK анхнаасаа зөвшөөрдөггүй
 *  байв; types.ts дахь тайлбарыг үз.) */
export const requireAdmin = () => requireRole(...ADMIN_ROLES);

/** Project/team operation leads: admin tier plus team seniors.  Used for
 *  structure setup, team membership management, and task assignment without
 *  granting seniors confidential admin-only features such as pricing/users
 *  administration. */
export const requireManager = () => requireRole(...ADMIN_ROLES, 'senior');
