/**
 * Багууд хуудасны ХАРАГДАЦЫН багийн шилжүүлэг (2026-09-18, эзний хүсэлт).
 *
 * «Мянганзул .П, Нэмэхбаяр .Э хоёр Автомат удирдлага дээр байна — Цахилгааны
 * баг руу оруул.  Зөвхөн харагдах байдлын хувьд, Багууд хуудсанд л.»
 *
 * Тиймээс `user_teams`-ийг ХӨНДӨХГҮЙ: тэдний үндсэн баг (`is_primary = 1`)
 * AU хэвээр — лидерборд, ирцийн тайлан, зургийн кодын (TSAH/AU) зураглал,
 * үнэлгээний cohort, `/teams/:id` дээрх гишүүнчлэлийн засвар бүгд хуучнаараа.
 * Зөвхөн Багууд хуудасны УНШИЛТ (`/teams/allocation`, `/teams?teams_view=1`,
 * `/company/day-snapshot?teams_view=1` — сүүлийн хоёрын дуудагч «Өнөөдөр» таб
 * 2026-09-24-нд хасагдсан, хуучин bundle-д зориулж үлдсэн) энэ жагсаалтаар хүнийг өөр багийн
 * мөрөнд тоолно.  Багийн код олдохгүй бол (устгагдсан/нэр солигдсон) жинхэнэ
 * баг руу нь буцна — хүн хэзээ ч алга болохгүй.
 *
 * ⚠️ Хэрэглэгчийн id/багийн код SQL-д ШУУД бичигдэнэ (bind биш — 7 асуулгын
 * байрлалтай bind-уудыг хөндөхгүйн тулд), тиймээс модуль ачаалахад хатуу
 * шалгана: id нь бүхэл тоо, код нь `[A-Z0-9_]` л байна.
 */

export interface TeamsPageOverride {
  /** `users.id` */
  userId: number;
  /** Багууд хуудсанд ХАРУУЛАХ багийн `teams.code`. */
  teamCode: string;
}

export const TEAMS_PAGE_TEAM_OVERRIDES: readonly TeamsPageOverride[] = [
  { userId: 41, teamCode: 'TSAH' }, // Эрдэнэсүрэн Нэмэхбаяр — AU → Цахилгаан
  { userId: 45, teamCode: 'TSAH' }, // Пүрэвбаатар Мянганзул — AU → Цахилгаан
];

const TEAM_CODE_RE = /^[A-Z0-9_]{1,16}$/;

function assertSafe(list: readonly TeamsPageOverride[]): void {
  const seen = new Set<number>();
  for (const o of list) {
    if (!Number.isSafeInteger(o.userId) || o.userId <= 0) {
      throw new Error(`teamsPageDisplay: invalid userId ${String(o.userId)}`);
    }
    if (!TEAM_CODE_RE.test(o.teamCode)) {
      throw new Error(`teamsPageDisplay: invalid teamCode ${JSON.stringify(o.teamCode)}`);
    }
    if (seen.has(o.userId)) throw new Error(`teamsPageDisplay: duplicate userId ${o.userId}`);
    seen.add(o.userId);
  }
}
assertSafe(TEAMS_PAGE_TEAM_OVERRIDES);

/** `?teams_view=1` — Багууд хуудас өөрийгөө таниулах query param. */
export function isTeamsView(query: string | undefined): boolean {
  return query === '1';
}

/**
 * «Хүн → үндсэн баг» харьцаа: `(user_id, team_id)` мөртэй дэд асуулга,
 * `INNER JOIN ${primaryTeamSql(...)} ut ON ut.user_id = u.id` хэлбэрээр
 * хэрэглэнэ.  `teamsView = false` бол яг хуучин
 * `user_teams … WHERE is_primary = 1`; `true` бол шилжүүлэгтэй.
 */
export function primaryTeamSql(opts: { teamsView: boolean }, list = TEAMS_PAGE_TEAM_OVERRIDES): string {
  if (!opts.teamsView || list.length === 0) {
    return `(SELECT ut.user_id, ut.team_id FROM user_teams ut WHERE ut.is_primary = 1)`;
  }
  const rows = list
    .map(
      (o) =>
        `SELECT ${o.userId} AS user_id, (SELECT id FROM teams WHERE code = '${o.teamCode}') AS team_id`,
    )
    .join(' UNION ALL ');
  return `(SELECT ut.user_id, COALESCE(ov.team_id, ut.team_id) AS team_id
           FROM user_teams ut
           LEFT JOIN (${rows}) ov ON ov.user_id = ut.user_id
           WHERE ut.is_primary = 1)`;
}

/**
 * Үндсэн багийн КОД буцаах скаляр илэрхийлэл (`day-snapshot`-ын
 * `team_codes` багана).  `fallbackExpr` нь хуучин илэрхийлэл — шилжүүлэг
 * байхгүй, эсвэл код олдохгүй үед тэр л хэвээр.
 */
export function primaryTeamCodeSql(
  userIdExpr: string,
  fallbackExpr: string,
  opts: { teamsView: boolean },
  list = TEAMS_PAGE_TEAM_OVERRIDES,
): string {
  if (!opts.teamsView || list.length === 0) return fallbackExpr;
  const whens = list
    .map((o) => `WHEN ${o.userId} THEN (SELECT code FROM teams WHERE code = '${o.teamCode}')`)
    .join(' ');
  return `COALESCE(CASE ${userIdExpr} ${whens} END, ${fallbackExpr})`;
}
