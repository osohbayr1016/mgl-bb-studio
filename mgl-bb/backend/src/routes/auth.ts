import { Hono } from 'hono';
import { deleteReplacedMediaAll } from '../lib/mediaReplace';
import { setCookie, deleteCookie } from 'hono/cookie';
import { signToken } from '../lib/jwt';
import { comparePassword, hashPassword } from '../lib/password';
import { requireRole } from '../middleware/auth';
import type { Env, AppVariables, UserRow, UserRole } from '../types';
import { todayInUB } from '../lib/time';
import {
  effectiveSchedule,
  SCHEDULE_SELF_SERVICE_DISABLED,
} from '../lib/workSchedule';
import { getScheduleAssignments } from '../lib/scheduleStore';
import { hasFixedShift, shiftForUser } from '../lib/specialShift';
import { getClientIp } from '../lib/officeNetwork';
import { assertOfficeAccess, officeAccessJson } from '../lib/officeAccess';
import { burnInvite, readInvite } from '../lib/clientInvite';

const auth = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------------------------------------------------ */
/*  POST /auth/login                                                   */
/* ------------------------------------------------------------------ */

auth.post('/login', async (c) => {
  const { username, password } = await c.req.json<{
    username: string;
    password: string;
  }>();

  if (!username || !password) {
    return c.json({ error: 'Username and password are required' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? AND status = ?')
    .bind(username, 'active')
    .first<UserRow>();

  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const valid = await comparePassword(password, user.password_hash);
  if (!valid) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const officeVerdict = await assertOfficeAccess({
    env: c.env,
    requestUrl: c.req.url,
    clientIp: getClientIp(c),
    db: c.env.DB,
    user: { sub: user.id, role: user.role, remote_access_allowed: user.remote_access_allowed },
  });
  if (!officeVerdict.ok) {
    return c.json(officeAccessJson(officeVerdict), officeVerdict.status);
  }

  const token = await signToken({ sub: user.id, role: user.role }, c.env.JWT_SECRET);

  const isLocalhost = c.req.header('host')?.includes('127.0.0.1') || c.req.header('host')?.includes('localhost');
  setCookie(c, 'token', token, {
    httpOnly: true,
    secure: !isLocalhost, // localhost is HTTP, production is HTTPS
    sameSite: isLocalhost ? 'Lax' : 'None',
    path: '/',
    maxAge: 60 * 60 * 24,
  });

  const { password_hash: _, ...profile } = user;
  return c.json({ user: profile, token });
});

/* ------------------------------------------------------------------ */
/*  POST /auth/mcp-token                                               */
/* ------------------------------------------------------------------ */

// Mint a long-lived token for connecting an MCP client (Claude Desktop /
// Claude Code) to the `/mcp` endpoint.  Authed like every /api/auth/* route
// except /login, so the caller must already hold a valid session token.  The
// new token carries the SAME identity — so MCP tools enforce the caller's own
// visibility — plus purpose:'mcp', with a ~1-year expiry so the connector
// doesn't break daily the way a normal 24h session token would.  Revoke by
// rotating JWT_SECRET, OR — since 1A-3 — by setting `users.tokens_valid_from`
// (migration 0211), which revokes per user without touching anyone else.
//
// Токен цохих эрхийг add-in / MCP клиент ХЭРЭГЛЭДЭГ role-уудаар хязгаарлана.
// `client` ба `worker` нь Revit-ээр ажилладаггүй тул 365 хоногийн токен
// хэрэггүй.  REVIT_ROLES (routes/revit.ts) -тай тааруулсан.
//
// ⚠️ Энэ нь 1A-2-ын worker→MCP давалтыг ХААХГҮЙ.  Тэр цоорхой нь:
//    `workerScopeGuard` ЗӨВХӨН /api дээр суудаг атал `/mcp` нь OAuth
//    провайдерын эзэмшдэг root зам.  Энэ role gate нь `worker`-ыг зөвхөн ШИНЭ
//    365 хоногийн токен цохихоос зогсооно — аль хэдийн олгогдсон токен, мөн
//    `/authorize` OAuth зам хэвээрээ.  Жинхэнэ засвар нь /mcp дээрх role шат.
const MCP_TOKEN_ROLES: UserRole[] = ['admin', 'senior', 'engineer', 'architect'];

auth.post('/mcp-token', requireRole(...MCP_TOKEN_ROLES), async (c) => {
  const user = c.get('user');
  // ⚠️ ЗӨВХӨН нууц үгээр нэвтэрсэн (purpose-гүй) session токен 365 хоногийн токен цохино.  Хулгайлагдсан
  //    төхөөрөмжийн session ('revit'), renewal credential ('revit-refresh'), хэвлэх / аудио / OAuth state
  //    токен, эсвэл аль хэдийн 'mcp' токен өөрөө шинэ 365 хоногийн токен ЦОХИЖ ЧАДАХГҮЙ — эс бөгөөс
  //    төхөөрөмж хаагдсан ч халдагч байнгын токен үлдээнэ (migration 0375).  Add-in-ий хуучин урсгал
  //    (login → mint) нь purpose-гүй токеноор дуудагддаг тул хөндөгдөхгүй.
  if (user.purpose) {
    return c.json({ error: 'Forbidden: sign in with your password to create an MCP token' }, 403);
  }
  const expiresInDays = 365;
  const token = await signToken(
    { sub: user.sub, role: user.role, purpose: 'mcp' },
    c.env.JWT_SECRET,
    expiresInDays * 24,
  );
  return c.json({ token, purpose: 'mcp', expires_in_days: expiresInDays });
});

/* ------------------------------------------------------------------ */
/*  POST /auth/logout                                                  */
/* ------------------------------------------------------------------ */

auth.post('/logout', (c) => {
  deleteCookie(c, 'token', { path: '/' });
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  GET /auth/me                                                       */
/* ------------------------------------------------------------------ */

auth.get('/me', async (c) => {
  const payload = c.get('user');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  // Aliasing both `team_name_mn` and `team_name_en` (and keeping legacy
  // `team_name` for any older callers still reading it) so the shape of
  // /auth/me matches /users — the Profile page reads `team_name_mn || team_name_en`
  // and was showing "Баг хуваарилагдаагүй байна" for everyone because we
  // only returned the unprefixed `team_name` here.
  const user = await c.env.DB.prepare(
    `SELECT u.*,
            pt.code    AS team_code,
            pt.name_mn AS team_name_mn,
            pt.name_en AS team_name_en,
            pt.name_mn AS team_name
     FROM users u
     LEFT JOIN user_teams ut_p ON ut_p.user_id = u.id AND ut_p.is_primary = 1
     LEFT JOIN teams pt ON pt.id = ut_p.team_id
     WHERE u.id = ?`,
  )
    .bind(payload.sub)
    .first<
      UserRow & {
        team_code: string | null;
        team_name_mn: string | null;
        team_name_en: string | null;
        team_name: string | null;
      }
    >();

  if (!user) return c.json({ error: 'User not found' }, 404);

  // ─── ХУУЧИРСАН ROLE-ТОЙ ТОКЕН (2026-09-17) ─────────────────────────
  // Бүх `/api` хаалт (`requireRole`, `role === 'client'`, `clientScope`,
  // `workerScope`) role-ийг ЗӨВХӨН JWT-ээс уншдаг, харин энэ хариу DB-ийн
  // мөрийг буцаадаг.  Хоёр нь зөрвөл SPA нь DB-ийн role-оор хуудас зурж,
  // сервер нь токены role-оор 403 өгдөг — «заримдаа Access denied» гэсэн
  // ойлгомжгүй гажиг (жишээ нь client → admin болгосон хүн /app/projects/:id
  // дээр «Төсөл олдсонгүй» хардаг).  Ийм токен нэвтрэлтийн шалгалтыг давж
  // болохгүй: 401 өгвөл SPA нэвтрэх хуудас руу очиж, шинэ role-той токен
  // авна — CLAUDE.md-ийн «log out and log in again» алхам автоматаар.
  //
  // ⚠️ ЗӨВХӨН энд, `authMiddleware`-д БИШ: тэнд нэмбэл Revit add-in-ий
  //    365 хоногийн `purpose:'mcp'` токен role солигдмогц бүх REST дээр
  //    унаж, ~20 PC дээр гараар дахин суулгах шаардлагатай болно.  `/auth/me`-г
  //    зөвхөн SPA дууддаг (grep-ээр батлав) тул нөлөө нь хөтөч дээр л.
  if (payload.role !== user.role) {
    console.warn(
      `[auth] /me: токены role=${payload.role} ≠ DB role=${user.role} sub=${payload.sub} — дахин нэвтрүүлнэ`,
    );
    return c.json({ error: 'Invalid or expired token', code: 'ROLE_CHANGED' }, 401);
  }

  const { results: teamRows } = await c.env.DB.prepare(
    `SELECT t.id, t.code, t.name_mn, t.name_en, ut.is_primary
     FROM user_teams ut
     JOIN teams t ON t.id = ut.team_id
     WHERE ut.user_id = ?
     ORDER BY ut.is_primary DESC, t.sort_order`,
  )
    .bind(payload.sub)
    .all<{
      id: number;
      code: string;
      name_mn: string;
      name_en: string | null;
      is_primary: number;
    }>();

  // Cheap one-shot flag the frontend can use to decide whether to render
  // the "Approvals" nav entry without hammering the queue endpoint on
  // every page load.  Admin-tier users always see it, but a senior only
  // sees it when they're the configured lead of at least one team.
  const leadRow = await c.env.DB.prepare(
    `SELECT 1 AS yes FROM teams WHERE lead_user_id = ? LIMIT 1`,
  )
    .bind(payload.sub)
    .first<{ yes: number }>();

  // ⚠️ `users.work_schedule` нь 2026-09-01-ээс хойш ТҮҮХЭН fallback болсон —
  //    бодит сонголт нь `user_work_schedules`-д (миграци 0199).  Энэ payload-ыг
  //    `useWorkStartReminder` («ажил эхлэхэд 5 минут үлдлээ») уншдаг тул
  //    хүчинтэй ээлжийг ЭНД шийдэж өгөх ёстой, эс бөгөөс сануулга 08:30-ийн
  //    ажилтанд 09:00 гэж очно.
  const assignments = await getScheduleAssignments(c.env.DB, payload.sub);
  const today = todayInUB();
  const effective = effectiveSchedule(user.work_schedule, today, assignments);
  const shift = shiftForUser(payload.sub, user.work_schedule, today, assignments);

  const { password_hash: _, ...profile } = user;
  return c.json({
    user: {
      ...profile,
      work_schedule: effective,
      shift_start_minutes: shift.startMinutes,
      schedule_fixed: hasFixedShift(payload.sub),
      teams: teamRows ?? [],
      is_approval_lead: !!leadRow,
    },
  });
});

/* ------------------------------------------------------------------ */
/*  PATCH /auth/profile                                                */
/* ------------------------------------------------------------------ */

auth.patch('/profile', async (c) => {
  const payload = c.get('user');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<Record<string, unknown>>();
  // ⚠️ `social_links` -ийг бүтээгдэхүүнээс хассан тул энэ whitelist-д БАЙХГҮЙ —
  //    хэрэглэгч дахин бичих боломжгүй.  Харин `users.social_links` БАГАНА нь
  //    үлдэнэ: түүнийг устгахын тулд `users` хүснэгтийг бүтнээр rebuild хийх
  //    шаардлагатай бөгөөд тэр нь ~40 хүүхэд хүснэгт рүү cascade хөөрдөг
  //    (миграци 0136-ын тайлбарыг үз).  `model_xkt_url`, `accent_color`-той
  //    адил «үхсэн багана» конвенцоор орхив.
  //
  // ⚠️ `work_schedule` нь энэ жагсаалтаас 2026-08-26-нд ГАРСАН.  Тэр нь одоо
  //    `users` баганад биш, `user_work_schedules`-д ОГНООТОЙГООР бичигдэнэ
  //    (доор).  Хуучин зан төлөв нь баганыг шууд дарж бичдэг байсан бөгөөд
  //    (а) `'mid'`-ийг CHECK хориглоно, (б) сонголт ТЭР ДОРОО хүчин төгөлдөр
  //    болдог тул хоцорсон хүн ээлжээ солиод торгуулиасаа мултардаг байв.
  const allowed = [
    'bio',
    'description',
    'profile_image',
    'cover_image',
    'signature_url',
    'stamp_url',
  ];

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of allowed) {
    if (key in body) {
      sets.push(`${key} = ?`);
      values.push(body[key]);
    }
  }

  /* ---- Ажлын ээлж — ажилтан өөрөө солихгүй (зөвхөн админ /users) ---- */
  if ('work_schedule' in body) {
    return c.json({ error: SCHEDULE_SELF_SERVICE_DISABLED }, 403);
  }

  if (sets.length === 0) {
    return c.json({ error: 'No valid fields to update' }, 400);
  }

  sets.push("updated_at = datetime('now')");
  values.push(payload.sub);

  // 2026-09-11 (R2 аудит): солигдсон зургийн ХУУЧИН R2 объектыг цэвэрлэхийн
  // тулд UPDATE-ээс ӨМНӨ хуучин утгыг уншина (lib/mediaReplace.ts).
  const MEDIA_COLS = ['profile_image', 'cover_image', 'signature_url', 'stamp_url'] as const;
  const touchesMedia = MEDIA_COLS.some((k) => k in body);
  const prevRow = touchesMedia
    ? await c.env.DB.prepare(
        'SELECT profile_image, cover_image, signature_url, stamp_url FROM users WHERE id = ?',
      )
        .bind(payload.sub)
        .first<Record<(typeof MEDIA_COLS)[number], string | null>>()
    : null;

  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  // UPDATE амжилттай → хуучин объектуудыг (хэн ч ишлэхгүй бол) устгана.
  if (prevRow) {
    c.executionCtx.waitUntil(
      deleteReplacedMediaAll(
        c.env,
        MEDIA_COLS.filter((k) => k in body).map((k) => [prevRow[k], body[k] as string | null]),
      ),
    );
  }

  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  POST /auth/change-password                                         */
/* ------------------------------------------------------------------ */

auth.post('/change-password', async (c) => {
  const payload = c.get('user');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const { current_password, new_password } = await c.req.json<{
    current_password: string;
    new_password: string;
  }>();

  if (!current_password || !new_password) {
    return c.json({ error: 'Both current and new password are required' }, 400);
  }

  if (new_password.length < 6) {
    return c.json({ error: 'New password must be at least 6 characters' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(payload.sub)
    .first<{ password_hash: string }>();

  if (!user) return c.json({ error: 'User not found' }, 404);

  const valid = await comparePassword(current_password, user.password_hash);
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const hash = await hashPassword(new_password);
  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(hash, payload.sub)
    .run();

  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Захиалагчийн урилга — нууц үг тохируулах                           */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ Дараах ХОЁР зам `middleware/auth.ts`-ийн нээлттэй жагсаалтад БАЙГАА:
 *    урилга хүлээн авах хүнд токен байхгүй.  Тиймээс тэдгээр нь ЗӨВХӨН
 *    нэг удаагийн KV урилгын түлхүүрт итгэнэ (`lib/clientInvite.ts`).
 *
 * Замын нэр нь ЯГ ТОГТМОЛ байх ёстой (`path ===` тулгалт) — тиймээс токеныг
 * URL-д биш, биед авна.
 */

auth.post('/client/invite-info', async (c) => {
  const { token } = await c.req.json<{ token?: string }>().catch(() => ({}) as { token?: string });
  const payload = await readInvite(c.env, String(token ?? ''));
  if (!payload) return c.json({ error: 'Урилга хүчингүй эсвэл хугацаа нь дууссан' }, 404);

  const user = await c.env.DB.prepare(
    "SELECT id, full_name, email, username FROM users WHERE id = ? AND role = 'client'",
  )
    .bind(payload.user_id)
    .first<{ id: number; full_name: string; email: string | null; username: string }>();
  if (!user) return c.json({ error: 'Урилга хүчингүй' }, 404);

  let orgName: string | null = null;
  if (payload.org_id) {
    const org = await c.env.DB.prepare('SELECT name FROM client_orgs WHERE id = ?')
      .bind(payload.org_id)
      .first<{ name: string }>();
    orgName = org?.name ?? null;
  }

  return c.json({
    kind: payload.kind,
    full_name: user.full_name,
    username: user.username,
    email: user.email,
    org_name: orgName,
  });
});

/**
 * Нууц үгээ тохируулаад ШУУД нэвтэрнэ.  Дахин нэвтрэх дэлгэц харуулах нь
 * дэмий алхам — захиалагч жилд хэдхэн удаа ордог хүн.
 */
auth.post('/client/accept', async (c) => {
  const { token, password } = await c.req
    .json<{ token?: string; password?: string }>()
    .catch(() => ({}) as { token?: string; password?: string });

  const payload = await readInvite(c.env, String(token ?? ''));
  if (!payload) return c.json({ error: 'Урилга хүчингүй эсвэл хугацаа нь дууссан' }, 404);
  if (!password || password.length < 8) {
    return c.json({ error: 'Нууц үг доод тал нь 8 тэмдэгт байна' }, 400);
  }

  const user = await c.env.DB.prepare(
    "SELECT * FROM users WHERE id = ? AND role = 'client' AND status = 'active'",
  )
    .bind(payload.user_id)
    .first<UserRow>();
  if (!user) return c.json({ error: 'Урилга хүчингүй' }, 404);

  await c.env.DB.prepare(
    "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(await hashPassword(password), user.id)
    .run();

  if (payload.org_id) {
    await c.env.DB.prepare(
      "UPDATE client_contacts SET accepted_at = datetime('now') WHERE org_id = ? AND user_id = ?",
    )
      .bind(payload.org_id, user.id)
      .run();
  }

  // Нэг удаагийн байдал: амжилттай болсны ДАРАА л устгана — эс тэгвэл
  // сүлжээ тасарсан хэрэглэгч урилгаа алдана.
  await burnInvite(c.env, String(token));

  const sessionToken = await signToken({ sub: user.id, role: user.role }, c.env.JWT_SECRET);
  const isLocalhost =
    c.req.header('host')?.includes('127.0.0.1') || c.req.header('host')?.includes('localhost');
  setCookie(c, 'token', sessionToken, {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: isLocalhost ? 'Lax' : 'None',
    path: '/',
    maxAge: 60 * 60 * 24,
  });

  const { password_hash: _drop, ...profile } = user;
  return c.json({ user: profile, token: sessionToken });
});

export default auth;
