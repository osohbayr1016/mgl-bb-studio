/**
 * Зохиогчийн хяналтын «хамт явсан» хүмүүс — цэвэр дүрэм.
 *
 * Зохиогч (`author_id`) жагсаалтад ОРОХГҮЙ: тэр хүн тайлан дээр аль хэдийн
 * бүртгэлтэй.  Энд зөвхөн өөрийн багаас нэмсэн нэмэлт хүмүүс.
 */

export const MAX_ASR_COMPANIONS = 8;

export const ASR_COMPANION_ROLES = ['admin', 'engineer', 'architect', 'senior'] as const;

export interface CompanionExisting {
  user_id: number;
  red_book_verified_at: string | null;
}

export function parseCompanionIds(raw: unknown, authorId: number): number[] | null {
  if (!Array.isArray(raw)) return null;
  const ids: number[] = [];
  for (const item of raw) {
    const n = typeof item === 'number' ? item : Number(item);
    if (!Number.isInteger(n) || n <= 0) return null;
    if (n === authorId) continue;
    if (!ids.includes(n)) ids.push(n);
  }
  return ids;
}

/**
 * Хадгалсан мөрөөс хэнийг нэмэх, хасахыг гаргана.
 * Баталгаажсан улаан дэвтэртэй хүнийг хасахгүй — эхлээд баталгааг цуцална.
 */
export function planCompanionReplace(
  existing: readonly CompanionExisting[],
  nextIds: readonly number[],
  /** Дээд тоо — оффис уулзалтын оролцогчид `MAX_MEETING_PARTICIPANTS` (0367). */
  max: number = MAX_ASR_COMPANIONS,
): { ok: true; add: number[]; remove: number[] } | { ok: false; error: string } {
  // Хадгалсан жагсаалтаас УРТАСГАХ үед л хаана: оффис уулзалтын 12 оролцогчтой
  // тайланг талбайн хяналт болгоход (8-ын хязгаар) autosave унаж, төрөл нь
  // хэзээ ч солигдохгүй байхаас сэргийлнэ.
  if (nextIds.length > max && nextIds.length > existing.length) {
    const who = max === MAX_ASR_COMPANIONS ? 'Хамт явсан хүн' : 'Оролцогч';
    return { ok: false, error: `${who} ${max}-аас олон байж болохгүй.` };
  }
  const next = new Set(nextIds);
  const have = new Set(existing.map((r) => r.user_id));
  const remove = existing.filter((r) => !next.has(r.user_id));
  const locked = remove.find((r) => r.red_book_verified_at);
  if (locked) {
    return {
      ok: false,
      error: 'Улаан дэвтэр нь баталгаажсан хүнийг хасахын тулд эхлээд баталгааг цуцална уу.',
    };
  }
  return {
    ok: true,
    add: nextIds.filter((id) => !have.has(id)),
    remove: remove.map((r) => r.user_id),
  };
}

/** Очилтын «хэн явсан» — зохиогч + хамт явсан (давхардахгүй). */
export function personVisitsSql(countedWhere: string): string {
  return `
    SELECT u.id AS user_id, u.full_name, u.profile_image AS avatar_url,
           COUNT(*) AS visits,
           MAX(a.report_date) AS last_visit
      FROM (
        SELECT r.id, r.author_id AS user_id, r.report_date
          FROM author_supervision_reports r
         WHERE ${countedWhere}
        UNION ALL
        SELECT r.id, c.user_id, r.report_date
          FROM author_supervision_reports r
          JOIN asr_report_companions c
            ON c.report_id = r.id AND c.user_id <> r.author_id
         WHERE ${countedWhere}
      ) a
      JOIN users u ON u.id = a.user_id
     GROUP BY u.id
     ORDER BY visits DESC, u.full_name`;
}

/**
 * Баг × хүн.  Зохиогч тайланд сонгосон баг бүрд (өмнөх зан).
 * Хамт явсан хүн зөвхөн өөрийн гишүүн баг нь тайланд сонгогдсон үед.
 */
export function teamPeopleSql(countedWhere: string): string {
  return `
    SELECT t.id AS team_id, t.code AS team_code, t.name_mn, t.name_en, t.sort_order,
           u.id AS user_id, u.full_name, u.profile_image AS avatar_url,
           COUNT(*) AS visits,
           MAX(x.report_date) AS last_visit,
           GROUP_CONCAT(x.report_date, ',') AS visit_dates
      FROM (
        SELECT rt.team_id, r.author_id AS user_id, r.report_date
          FROM author_supervision_report_teams rt
          JOIN author_supervision_reports r ON r.id = rt.report_id
         WHERE ${countedWhere}
        UNION ALL
        SELECT rt.team_id, c.user_id, r.report_date
          FROM author_supervision_report_teams rt
          JOIN author_supervision_reports r ON r.id = rt.report_id
          JOIN asr_report_companions c
            ON c.report_id = r.id AND c.user_id <> r.author_id
          JOIN user_teams ut ON ut.user_id = c.user_id AND ut.team_id = rt.team_id
         WHERE ${countedWhere}
      ) x
      JOIN teams t ON t.id = x.team_id
      JOIN users u ON u.id = x.user_id
     GROUP BY t.id, u.id
     ORDER BY t.sort_order, t.code, visits DESC, u.full_name`;
}
