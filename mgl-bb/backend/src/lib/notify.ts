import type { NotificationType } from '../types';

/**
 * Insert one in-app notification for a single user. Failures are swallowed —
 * notifications are best-effort and must never break the primary action.
 */
export async function createNotification(
  db: D1Database,
  userId: number,
  type: NotificationType,
  title: string,
  body?: string | null,
  link?: string | null,
) {
  try {
    await db
      .prepare(
        'INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(userId, type, title, body ?? null, link ?? null)
      .run();
  } catch (err) {
    console.error('notify failed', err);
  }
}

/**
 * Notify the single person responsible for reviewing a submitter's work —
 * the scope team's designated approval lead (`teams.lead_user_id`).  This
 * deliberately does NOT broadcast to every admin: with ~7 admins on the
 * roster, copying all of them on every team's approvals buried the people
 * who actually own each queue.  Each lead now sees only their own team.
 *
 * Resolution order (first match wins):
 *   1. The team's `lead_user_id` (an active `senior` member) — the one
 *      person responsible for that discipline's approvals.
 *   2. No lead set → the team's `senior` members (any of them can approve
 *      per the /api/progress/:id/approve gate).
 *   3. The team has no senior at all, OR `teamId` is null (legacy block
 *      with no team) → fall back to the admin tier, so a pending approval
 *      is never silently dropped with nobody notified.
 *
 * `excludeUserId` skips the submitter themselves (a lead closing their own
 * task shouldn't be pinged to review their own work).
 */
export async function createNotificationForReviewers(
  db: D1Database,
  teamId: number | null,
  type: NotificationType,
  title: string,
  body?: string | null,
  link?: string | null,
  excludeUserId?: number,
) {
  try {
    let targetIds: number[] = [];

    if (teamId != null) {
      // 1) Багт томилогдсон батлах ахлагч (active senior гишүүн) байвал
      //    зөвхөн түүн рүү.
      const lead = await db
        .prepare(
          `SELECT t.lead_user_id AS id
             FROM teams t
             JOIN users u ON u.id = t.lead_user_id AND u.status = 'active'
            WHERE t.id = ?`,
        )
        .bind(teamId)
        .first<{ id: number }>();

      if (lead?.id) {
        targetIds = [lead.id];
      } else {
        // 2) Ахлагч тохируулаагүй бол тухайн багийн senior гишүүд рүү.
        const { results } = await db
          .prepare(
            `SELECT id FROM users
              WHERE status = 'active' AND role = 'senior'
                AND id IN (SELECT user_id FROM user_teams WHERE team_id = ?)`,
          )
          .bind(teamId)
          .all<{ id: number }>();
        targetIds = results.map((u) => u.id);
      }
    }

    // 3) Баг тодорхойгүй эсвэл уг багт нэг ч senior байхгүй бол сүүлчийн
    //    арга болгон admin tier руу — батлах хүсэлт хэзээ ч хаашаа ч
    //    хүрэлгүй алга болохгүй.
    if (targetIds.length === 0) {
      const { results } = await db
        .prepare(`SELECT id FROM users WHERE status = 'active' AND role = 'admin'`)
        .all<{ id: number }>();
      targetIds = results.map((u) => u.id);
    }

    await Promise.all(
      targetIds
        .filter((id) => id !== excludeUserId)
        .map((id) => createNotification(db, id, type, title, body, link)),
    );
  } catch (err) {
    console.error('notify-reviewers failed', err);
  }
}

/** `notifyProjectResponsible`-ийн буцаах мөр — дуудагч нэрсийг UI-д
 *  эргүүлж харуулдаг («Б.Билгүүн, Д.Сараа руу илгээлээ»). */
export interface NotifiedUser {
  id: number;
  full_name: string;
}

/**
 * Нэг ТӨСЛИЙН хугацааны сануулгыг хариуцагч руу нь илгээнэ («Төслийн
 * хуваарь» хуудас: автомат deadline сануулга + гараар түлхэх «сануулах»).
 *
 * `createNotificationForReviewers` нь нэг БАГААР түлхүүрлэдэг бол энэ нь
 * ТӨСЛӨӨР түлхүүрлэдэг: төсөл нь `project_team_shares`-ээр хэд хэдэн багт
 * хуваагдсан байж болох тул эхлээд багуудыг олж, дараа нь баг ТУС БҮРТ нь
 * доорх шатлалыг явуулаад, эцэст нь хэрэглэгчийн id-гаар давхардлыг арилгана.
 *
 * Шатлал (баг тус бүрд, эхний тохирсон нь ялна):
 *   1. `teams.lead_user_id` — тухайн багийн батлах ахлагч (заавал `active`
 *      бөгөөд `senior`; өөр role-той болсон хуучирсан заалт тоогдохгүй).
 *   2. Ашиглах боломжтой ахлагчгүй бол — тухайн багийн `user_teams`-ээрх
 *      идэвхтэй `senior` гишүүд.
 *   3. Нийт олдвор ХООСОН байвал л сүүлчийн арга болгон бүх идэвхтэй admin.
 *
 * ЯАГААД шууд бүх admin руу хуулдаггүй вэ: ~7 admin байгаа тул төсөл бүрийн
 * сануулгыг бүгд рүү цацвал ахлагч бүрийн ӨӨРИЙН дараалал булагдана
 * (CLAUDE.md-д батлах мэдэгдлийн хувьд яг ижил шийдвэр гарсан).  Admin-ууд
 * зөвхөн `opts.includeAdmins` үед — өөрөөр хэлбэл 1 хоног үлдсэн / хугацаа
 * хэтэрсэн эскалацийн үед — зориудаар нэмэгдэнэ.
 *
 * `opts.excludeUserId` нь илгээгчийг өөрийг нь хасна (сануулга дарсан ахлагч
 * өөр рүүгээ мэдэгдэл авах нь утгагүй).
 *
 * Файлын бусад хэсэгтэй адил best-effort: алдааг зөвхөн логдож, ХЭЗЭЭ Ч
 * шидэхгүй — мэдэгдэл гол үйлдлийг унагааж болохгүй.
 */
export async function notifyProjectResponsible(
  db: D1Database,
  projectId: number,
  type: NotificationType,
  title: string,
  body?: string | null,
  link?: string | null,
  opts?: { includeAdmins?: boolean; excludeUserId?: number },
): Promise<NotifiedUser[]> {
  try {
    // id → нэр гэсэн Map нь давхардлыг (нэг хүн олон багийн ахлагч байх нь
    // элбэг) шууд арилгана.
    const targets = new Map<number, string>();

    // 0) Төслийн багууд.
    const { results: shareRows } = await db
      .prepare(`SELECT team_id FROM project_team_shares WHERE project_id = ?`)
      .bind(projectId)
      .all<{ team_id: number | null }>();
    const teamIds = [
      ...new Set(
        shareRows.map((r) => r.team_id).filter((id): id is number => typeof id === 'number'),
      ),
    ];

    if (teamIds.length > 0) {
      const teamPlaceholders = teamIds.map(() => '?').join(',');

      // 1) Багт томилогдсон ахлагч (active + senior).
      const { results: leads } = await db
        .prepare(
          `SELECT t.id AS team_id, u.id AS user_id, u.full_name AS full_name
             FROM teams t
             JOIN users u ON u.id = t.lead_user_id
              AND u.status = 'active' AND u.role = 'senior'
            WHERE t.id IN (${teamPlaceholders})`,
        )
        .bind(...teamIds)
        .all<{ team_id: number; user_id: number; full_name: string }>();

      const coveredTeams = new Set<number>();
      for (const row of leads) {
        coveredTeams.add(row.team_id);
        targets.set(row.user_id, row.full_name);
      }

      // 2) Ахлагчгүй үлдсэн багуудын идэвхтэй senior гишүүд.
      const orphanTeams = teamIds.filter((id) => !coveredTeams.has(id));
      if (orphanTeams.length > 0) {
        const orphanPlaceholders = orphanTeams.map(() => '?').join(',');
        const { results: seniors } = await db
          .prepare(
            `SELECT u.id AS user_id, u.full_name AS full_name
               FROM user_teams ut
               JOIN users u ON u.id = ut.user_id
              WHERE ut.team_id IN (${orphanPlaceholders})
                AND u.status = 'active' AND u.role = 'senior'`,
          )
          .bind(...orphanTeams)
          .all<{ user_id: number; full_name: string }>();
        for (const row of seniors) targets.set(row.user_id, row.full_name);
      }
    }

    // 3) Хэн ч олдоогүй бол (баггүй төсөл, эсвэл нэг ч senior алга) —
    //    admin tier.  Мөн эскалацийн үед зориудаар admin-уудыг нэмнэ.
    if (targets.size === 0 || opts?.includeAdmins) {
      const { results: admins } = await db
        .prepare(
          `SELECT id AS user_id, full_name AS full_name
             FROM users WHERE status = 'active' AND role = 'admin'`,
        )
        .all<{ user_id: number; full_name: string }>();
      for (const row of admins) targets.set(row.user_id, row.full_name);
    }

    if (opts?.excludeUserId !== undefined) targets.delete(opts.excludeUserId);

    const notified: NotifiedUser[] = [...targets].map(([id, full_name]) => ({ id, full_name }));
    await Promise.all(
      notified.map((u) => createNotification(db, u.id, type, title, body, link)),
    );
    return notified;
  } catch (err) {
    console.error('notify-project-responsible failed', err);
    return [];
  }
}
