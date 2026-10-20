/**
 * `asr_report_companions` — D1 уншилт/бичилт.  Дүрэм `asrCompanions.ts`.
 */
import type { D1Database } from '@cloudflare/workers-types';
import {
  ASR_COMPANION_ROLES,
  parseCompanionIds,
  planCompanionReplace,
  type CompanionExisting,
} from './asrCompanions';

const ROLES = ASR_COMPANION_ROLES.map((r) => `'${r}'`).join(',');

export async function loadCompanions(db: D1Database, reportId: number) {
  const { results } = await db
    .prepare(
      `SELECT c.user_id, c.red_book_photo_url, c.red_book_verified_by,
              c.red_book_verified_at, c.sort_order,
              u.full_name, u.position, v.full_name AS red_book_verifier_name
         FROM asr_report_companions c
         JOIN users u ON u.id = c.user_id
         LEFT JOIN users v ON v.id = c.red_book_verified_by
        WHERE c.report_id = ?
        ORDER BY c.sort_order, u.full_name`,
    )
    .bind(reportId)
    .all();
  return results ?? [];
}

/**
 * Сонгох боломжтой хүмүүс.  `team` = зохиогчийн өөрийн багийнхан (талбайн
 * «хамт явсан»); `all` = бүх идэвхтэй ажилтан (оффис уулзалтын «Оролцсон»,
 * 0367 — `lib/asrMeeting.ts`).
 */
export type CompanionScope = 'team' | 'all';

export async function listCompanionCandidates(
  db: D1Database,
  authorId: number,
  scope: CompanionScope = 'team',
) {
  const { results } = await db
    .prepare(
      scope === 'all'
        ? `SELECT u.id, u.full_name, u.username, u.position, u.profile_image,
                  group_concat(t.code, ', ') AS team_codes
             FROM users u
             LEFT JOIN user_teams ut ON ut.user_id = u.id
             LEFT JOIN teams t ON t.id = ut.team_id
            WHERE u.id <> ?
              AND u.status = 'active'
              AND u.role IN (${ROLES})
            GROUP BY u.id
            ORDER BY u.full_name`
        : `SELECT u.id, u.full_name, u.username, u.position, u.profile_image,
                  group_concat(t.code, ', ') AS team_codes
             FROM users u
             JOIN user_teams ut ON ut.user_id = u.id
             JOIN user_teams mine ON mine.team_id = ut.team_id AND mine.user_id = ?
             JOIN teams t ON t.id = ut.team_id
            WHERE u.id <> ?
              AND u.status = 'active'
              AND u.role IN (${ROLES})
            GROUP BY u.id
            ORDER BY u.full_name`,
    )
    .bind(...(scope === 'all' ? [authorId] : [authorId, authorId]))
    .all();
  return results ?? [];
}

async function eligibleIds(
  db: D1Database,
  authorId: number,
  ids: number[],
  scope: CompanionScope,
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const marks = ids.map(() => '?').join(',');
  const sameTeam =
    scope === 'all'
      ? ''
      : `AND EXISTS (
            SELECT 1 FROM user_teams mine
              JOIN user_teams ut ON ut.team_id = mine.team_id AND ut.user_id = u.id
             WHERE mine.user_id = ?
          )`;
  const { results } = await db
    .prepare(
      `SELECT u.id AS id FROM users u
        WHERE u.id IN (${marks})
          AND u.status = 'active'
          AND u.role IN (${ROLES})
          ${sameTeam}`,
    )
    .bind(...ids, ...(scope === 'all' ? [] : [authorId]))
    .all<{ id: number }>();
  return new Set((results ?? []).map((r) => r.id));
}

export async function replaceCompanions(
  db: D1Database,
  reportId: number,
  authorId: number,
  raw: unknown,
  /** Оффис уулзалт (0367): бүх ажилтнаас, `MAX_MEETING_PARTICIPANTS` хүртэл. */
  opts: { scope?: CompanionScope; max?: number } = {},
): Promise<{ ok: true } | { ok: false; status: 400 | 409; error: string }> {
  const scope = opts.scope ?? 'team';
  const ids = parseCompanionIds(raw, authorId);
  if (!ids) return { ok: false, status: 400, error: 'Хамт явсан хүмүүсийн жагсаалт буруу байна.' };
  const { results } = await db
    .prepare(
      `SELECT user_id, red_book_verified_at FROM asr_report_companions WHERE report_id = ?`,
    )
    .bind(reportId)
    .all<CompanionExisting>();
  const plan = planCompanionReplace(results ?? [], ids, opts.max);
  if (!plan.ok) return { ok: false, status: 409, error: plan.error };
  const allowed = await eligibleIds(db, authorId, plan.add, scope);
  if (plan.add.some((id) => !allowed.has(id))) {
    return {
      ok: false,
      status: 400,
      error:
        scope === 'all'
          ? 'Зөвхөн идэвхтэй ажилтныг нэмнэ.'
          : 'Зөвхөн өөрийн багийн идэвхтэй ажилтныг нэмнэ.',
    };
  }
  const stmts = [
    ...plan.remove.map((userId) =>
      db
        .prepare('DELETE FROM asr_report_companions WHERE report_id = ? AND user_id = ?')
        .bind(reportId, userId),
    ),
    ...plan.add.map((userId, i) =>
      db
        .prepare(
          `INSERT INTO asr_report_companions (report_id, user_id, sort_order) VALUES (?, ?, ?)`,
        )
        .bind(reportId, userId, ids.indexOf(userId) >= 0 ? ids.indexOf(userId) : i),
    ),
  ];
  if (stmts.length > 0) await db.batch(stmts);
  return { ok: true };
}

/**
 * Оффис уулзалтын баг (эзэн 2026-10-08): маягтад багийн чагт БАЙХГҮЙ — баг нь
 * уулзалтад оролцсон хүмүүсээс гарна.  Тайланд нэг ч баг тэмдэглэгдээгүй үед л
 * бөглөнө (хэзээ ч юу ч устгахгүй): зохиогчийн бүх баг ЭХЭНД (үндсэн нь
 * түрүүлж — дугаарлалтын «эхний баг», `lib/asrNo.ts`), дараа нь «Оролцсон»
 * хүмүүсийн (`asr_report_companions`) ҮНДСЭН багууд.  Хэн нь ч багт байхгүй бол
 * хоосон хэвээр — тайлан баггүйгээр (`DASR-NNN`) илгээгдэнэ, админ батална.
 *
 * @returns Нэмсэн мөрийн тоо.
 */
export async function fillMeetingTeams(
  db: D1Database,
  reportId: number,
  authorId: number,
): Promise<number> {
  const res = await db
    .prepare(
      `INSERT INTO author_supervision_report_teams (report_id, team_id, work_note, sort_order)
       SELECT ?, t.id, NULL,
              MIN(CASE WHEN ut.user_id = ? THEN 0 ELSE 2 END + CASE WHEN ut.is_primary = 1 THEN 0 ELSE 1 END)
                * 100000 + COALESCE(t.sort_order, 0)
         FROM user_teams ut
         JOIN teams t ON t.id = ut.team_id
        WHERE (ut.user_id = ?
               OR (ut.is_primary = 1
                   AND ut.user_id IN (SELECT c.user_id FROM asr_report_companions c WHERE c.report_id = ?)))
          AND NOT EXISTS (SELECT 1 FROM author_supervision_report_teams x WHERE x.report_id = ?)
        GROUP BY t.id`,
    )
    .bind(reportId, authorId, authorId, reportId, reportId)
    .run();
  return Number(res.meta?.changes ?? 0);
}
