/**
 * Багууд хуудасны харагдацын эрх (2026-09-30, эзний хүсэлт).
 *
 * «Энгийн ажилтан Багууд хэсгээс ЗӨВХӨН өөрийн багийн мэдээллийг авдаг байг;
 * admin, senior урьдын адил бүх багийг харна.»
 *
 * Дүрэм нэг л газарт:
 *   • admin, senior          → бүх баг (өмнөх зан төлөв хэвээр);
 *   • бусад (engineer, architect …) → зөвхөн `user_teams`-д мөртэй баг —
 *     үндсэн (`is_primary = 1`) ба нэмэлт баг хоёулаа.  Гишүүнчлэл гэдэг нь
 *     энэ хүснэгт, тэгэхээр «өөрийн баг» гэж хоёр өөр тодорхойлолт гаргахгүй.
 *
 * Хаалт нь `/api/teams/:id`, `/:id/overview`, `/:id/member-tasks` дээр
 * middleware болж зогсоно.  Бүх багийн хуваарилалтын самбар
 * (`/allocation`) нь бүтнээрээ «хэн аль багт, аль төсөл дээр» гэсэн
 * байгууллагын хэмжээний зураг тул тэнд `requireManager()` — багаар нь
 * шүүсэн хувилбар бичихээс илүү найдвартай (хариу нь `day_work`,
 * `idle_members`, `projects` гэх мэт багийн хилийг давсан 8 бүтэцтэй).
 *
 * ⚠️ `GET /api/teams` (жагсаалт) ЭНД ХАМААРАХГҮЙ: түүнийг долоон dropdown
 * (багийн сонгогч) татдаг тул бүх ролид нээлттэй хэвээр.
 * ⚠️ Frontend-ийн шалгалт (`TeamsPage`, `TeamDetailPage`) зөвхөн UX — жинхэнэ
 * хаалт нь энд.
 */
import { createMiddleware } from 'hono/factory';
import { isAdminRole } from '../types';
import type { Env, AppVariables } from '../types';

/** Бүх багийг харах role-ууд: admin + senior (`requireManager`-тэй ижил олонлог). */
export function seesAllTeams(role: string): boolean {
  return isAdminRole(role) || role === 'senior';
}

/** Хэрэглэгч энэ багийн гишүүн (`user_teams`, үндсэн ба нэмэлт) эсэх. */
export async function isTeamMember(
  db: D1Database,
  userId: number,
  teamId: number,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS yes FROM user_teams WHERE user_id = ? AND team_id = ? LIMIT 1')
    .bind(userId, teamId)
    .first<{ yes: number }>();
  return !!row;
}

export interface OwnTeam {
  id: number;
  code: string;
  name_mn: string;
  name_en: string | null;
  is_primary: number;
}

/**
 * Хэрэглэгчийн өөрийн багууд — үндсэн нь эхэнд.  `GET /api/teams/mine`.
 *
 * Frontend-ийн `user.teams` (`/auth/me`)-ээс ТУСДАА endpoint болсон шалтгаан:
 * `/auth/login` нь `teams`-гүй түүхий `users` мөр буцаадаг тул нэвтэрсэн даруйд
 * `user.teams` хоосон байдаг; хаалт нь `user_teams`-ийг шууд уншдаг тул UI ч
 * яг тэр эх сурвалжаас асууна — хоёр талд «миний баг» зөрөхгүй.
 */
export async function listOwnTeams(db: D1Database, userId: number): Promise<OwnTeam[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.code, t.name_mn, t.name_en, ut.is_primary
         FROM user_teams ut
         JOIN teams t ON t.id = ut.team_id
        WHERE ut.user_id = ?
        ORDER BY ut.is_primary DESC, t.sort_order, t.name_mn`,
    )
    .bind(userId)
    .all<OwnTeam>();
  return results ?? [];
}

/**
 * `/:id`-тай баг руу орох эрхийн хаалт.  Байхгүй багийн id-д ч ижил 403 —
 * энгийн ажилтанд «баг байна уу, үгүй юу» гэдгийг ялгаж хэлэхгүй.
 */
export const requireOwnTeamOrManager = () =>
  createMiddleware<{ Bindings: Env; Variables: AppVariables }>(async (c, next) => {
    const user = c.get('user');
    if (user && seesAllTeams(user.role)) return next();
    const teamId = Number.parseInt(c.req.param('id') ?? '', 10);
    if (!user || !Number.isSafeInteger(teamId) || !(await isTeamMember(c.env.DB, user.sub, teamId))) {
      return c.json(
        { error: 'Forbidden: та зөвхөн өөрийн багийн мэдээллийг харах боломжтой', code: 'TEAM_FORBIDDEN' },
        403,
      );
    }
    return next();
  });
