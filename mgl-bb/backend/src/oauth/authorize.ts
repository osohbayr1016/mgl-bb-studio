import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AuthRequest, OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { comparePassword } from '../lib/password';
import { getClientIp } from '../lib/officeNetwork';
import { assertOfficeAccess } from '../lib/officeAccess';
import { currentTenantId, hasTenantContext } from '../lib/requestContext';
import type { Env, AppVariables, UserRow } from '../types';
import type { McpProps } from '../mcp/MglMcpAgent';

/**
 * OAuth `/authorize` consent + login UI for the remote MCP server.
 *
 * Mounted at the ROOT of the Hono app (NOT under `/api/*`) so it bypasses
 * `authMiddleware` — it authenticates the user itself, reusing the EXACT
 * `/api/auth/login` check (users SELECT with status='active' + bcrypt
 * comparePassword).  The OAuthProvider advertises this path in its discovery
 * metadata but does NOT implement it — that is this file's job.  On success we
 * call `env.OAUTH_PROVIDER.completeAuthorization(...)` with `props = {sub, role}`
 * (the same shape `MglMcpAgent.this.props` expects) and 302 the browser back to
 * the client with the authorization code.
 */
const authorize = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );

function loginPage(opts: { clientName: string; authState: string; csrf: string; error?: string }): string {
  const { clientName, authState, csrf, error } = opts;
  return `<!doctype html>
<html lang="mn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MGL — Холболт зөвшөөрөх</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
           margin: 0; min-height: 100vh; display: grid; place-items: center;
           background: #0b1220; color: #e7ecf3; }
    .card { width: 360px; max-width: calc(100vw - 32px); padding: 28px;
            background: #131c2e; border: 1px solid #243049; border-radius: 14px;
            box-shadow: 0 8px 40px rgba(0,0,0,.4); }
    h1 { font-size: 18px; margin: 0 0 6px; }
    .sub { font-size: 13px; color: #9fb0c8; margin: 0 0 20px; }
    .sub b { color: #e7ecf3; }
    label { display: block; font-size: 12px; color: #9fb0c8; margin: 14px 0 6px; }
    input { width: 100%; padding: 11px 12px; border-radius: 9px;
            border: 1px solid #2b3a57; background: #0e1626; color: #e7ecf3; font-size: 14px; }
    input:focus { outline: 2px solid #3b82f6; border-color: transparent; }
    button { width: 100%; margin-top: 22px; padding: 12px; border: 0; border-radius: 9px;
             background: #3b82f6; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
    button:hover { background: #2f6fe0; }
    .err { margin-top: 14px; padding: 10px 12px; border-radius: 8px;
           background: #3a1620; border: 1px solid #6b2433; color: #ffb4be; font-size: 13px; }
    .foot { margin-top: 18px; font-size: 11px; color: #6b7c98; text-align: center; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/authorize" autocomplete="off">
    <h1>MGL Progress-д нэвтрэх</h1>
    <p class="sub"><b>${esc(clientName)}</b> таны MGL мэдээлэлд хандах зөвшөөрөл хүсэж байна.</p>
    ${error ? `<div class="err">${esc(error)}</div>` : ''}
    <label for="username">Хэрэглэгчийн нэр</label>
    <input id="username" name="username" autocomplete="username" required autofocus />
    <label for="password">Нууц үг</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <input type="hidden" name="authState" value="${esc(authState)}" />
    <input type="hidden" name="csrf" value="${esc(csrf)}" />
    <button type="submit">Зөвшөөрөх</button>
    <p class="foot">MGL инженерингийн систем</p>
  </form>
</body>
</html>`;
}

/* ----------------------------- GET /authorize ----------------------------- */

authorize.get('/authorize', async (c) => {
  const helpers: OAuthHelpers = c.env.OAUTH_PROVIDER;
  let authReq: AuthRequest;
  try {
    authReq = await helpers.parseAuthRequest(c.req.raw);
  } catch {
    return c.text('Invalid OAuth request', 400);
  }

  let clientName = 'Гадны програм';
  try {
    const client = await helpers.lookupClient(authReq.clientId);
    if (client?.clientName) clientName = client.clientName;
  } catch {
    /* non-fatal — fall back to the generic label */
  }

  // Round-trip the full AuthRequest through the POST (no server-side session),
  // plus a double-submit CSRF token.
  const authState = btoa(unescape(encodeURIComponent(JSON.stringify(authReq))));
  const csrf = crypto.randomUUID();
  setCookie(c, 'mgl_oauth_csrf', csrf, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/authorize',
    maxAge: 600,
  });

  return c.html(loginPage({ clientName, authState, csrf }));
});

/* ----------------------------- POST /authorize ---------------------------- */

authorize.post('/authorize', async (c) => {
  const helpers: OAuthHelpers = c.env.OAUTH_PROVIDER;
  const form = await c.req.formData();

  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');
  const authStateRaw = String(form.get('authState') ?? '');
  const csrfForm = String(form.get('csrf') ?? '');
  const csrfCookie = getCookie(c, 'mgl_oauth_csrf') ?? '';

  let authReq: AuthRequest;
  try {
    authReq = JSON.parse(decodeURIComponent(escape(atob(authStateRaw)))) as AuthRequest;
  } catch {
    return c.text('Invalid request state', 400);
  }

  const reRender = (error: string, status: 400 | 401 = 401) =>
    c.html(loginPage({ clientName: 'Гадны програм', authState: authStateRaw, csrf: csrfForm, error }), status);

  // CSRF: double-submit cookie must match the hidden field.
  if (!csrfForm || csrfForm !== csrfCookie) {
    return reRender('Сесс хүчингүй боллоо. Дахин оролдоно уу.', 400);
  }
  if (!username || !password) {
    return reRender('Хэрэглэгчийн нэр болон нууц үг шаардлагатай.', 400);
  }

  // ---- EXACT reuse of the /api/auth/login check (routes/auth.ts) ----
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? AND status = ?')
    .bind(username, 'active')
    .first<UserRow>();
  if (!user) return reRender('Нэр эсвэл нууц үг буруу байна.');

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) return reRender('Нэр эсвэл нууц үг буруу байна.');

  const officeVerdict = await assertOfficeAccess({
    env: c.env,
    requestUrl: c.req.url,
    clientIp: getClientIp(c),
    db: c.env.DB,
    user: { sub: user.id, role: user.role, remote_access_allowed: user.remote_access_allowed },
  });
  if (!officeVerdict.ok) {
    return reRender(`${officeVerdict.error}. ${officeVerdict.detail}`);
  }

  // ---- Mint the grant.  props === {sub, role, tid?} so MglMcpAgent.this.props
  //      keeps its exact shape; sub stays a number (every tool binds user.sub). ----
  // `tid` нь MCP хаалтын tenant тулгалтын эх өгөгдөл (mcp/guard.ts).  НЭГ-
  // tenant суулгацад `hasTenantContext()` худал → талбар ОГТ нэмэгдэхгүй тул
  // grant-ийн хэлбэр өнөөдрийнхтэй байт байтаараа ижил үлдэнэ
  // (`lib/jwt.ts:54-59`-ийн `signToken`-той ЯГ ижил хэв маяг).
  //
  // ⚠️ ЭНЭ ФАЙЛ `runWithTenant`-ийн ДОТОР ажилладаг: /authorize нь Hono
  //    `app`-ын root mount, `app` нь provider-ийн `defaultHandler`, provider
  //    нь index.ts-ийн гадаад fetch доторх `runWithTenant`-ийн дотор.  Тиймээс
  //    энд `hasTenantContext()` ЗӨВ утга өгнө.
  const props: McpProps = {
    sub: user.id,
    role: user.role,
    ...(hasTenantContext() ? { tid: currentTenantId() } : {}),
  };
  const { redirectTo } = await helpers.completeAuthorization({
    request: authReq,
    userId: String(user.id),
    scope: authReq.scope,
    metadata: { username: user.username },
    props,
  });

  // One-shot CSRF cookie — clear it.
  setCookie(c, 'mgl_oauth_csrf', '', { path: '/authorize', maxAge: 0 });

  return c.redirect(redirectTo);
});

export default authorize;
