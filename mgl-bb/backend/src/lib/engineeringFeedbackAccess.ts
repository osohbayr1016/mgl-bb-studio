/**
 * ПРОГРАМЫН ХҮСЭЛТ — ХАНДАХ ЭРХИЙН ГАНЦ ЭХ СУРВАЛЖ (2026-10-16).
 *
 * Хоёр асуулт, хоёр функц:
 *   • {@link resolveSubmitter} — хүсэлт ИЛГЭЭЖ болох уу (ноорог, хавсралт, submit, өөрийн баримт, retest).
 *   • {@link resolveReviewer}  — «Програмын хүсэлтүүд» inbox-ыг УНШИЖ/ЗАСАЖ болох уу (жагсаалт, тоо, хайлт,
 *     дэлгэрэнгүй, хавсралт татах, экспорт, триаж, мэдэгдлийн хүлээн авагч).
 *
 * Reviewer = ДӨРВҮҮЛЭН заавал:
 *   1. нэвтэрсэн, идэвхтэй (`users.status = 'active'`), ЭНЭ tenant-ын (D1 = tenant; `tid`-ийг auth.ts аль хэдийн тулгасан);
 *   2. сервер удирдах `access_capabilities` мөр: capability = 'software_engineer', revoked_at IS NULL;
 *   3. `engineering_feedback_reviewer_binding` (ганц мөр) user_id + username + employee_id нь users-ийн ОДООГИЙН мөртэй ЯГ;
 *   4. ердийн интерактив ERP session — `purpose` claim-гүй токен.  Revit-ийн төхөөрөмжийн session ('revit'),
 *      renewal ('revit-refresh'), MCP, print г.м. token ХЭЗЭЭ Ч inbox нээхгүй — `revit.session_scope=open` ч гэсэн.
 *
 * ⚠️ JWT-ийн role ба `users.position` (албан тушаал) эрх олгох оролт БИШ.  Admin-д далд эрх БАЙХГҮЙ.
 * ⚠️ Кэш БАЙХГҮЙ — эрх цуцлагдмагц дараагийн хүсэлт хаагдана (3 мөрийн индекстэй уншилт).
 * ⚠️ Frontend sidebar, route guard, тоолуур нь `GET /api/engineering-feedback/capabilities`-ээр ИЖИЛ функцийг дууддаг.
 */
import type { JWTPayload, UserRole } from '../types';

/** Илгээж болох роль (эзний өгөгдмөл: дотоод ажилтан).  worker/client-ийг workerScope/clientScope аль хэдийн хаадаг. */
export const EF_SUBMITTER_ROLES: readonly UserRole[] = ['admin', 'engineer', 'architect', 'senior'];

export const EF_CAPABILITY = 'software_engineer';

/** Токены төрөл: интерактив ERP session эсвэл Revit add-in-ий төхөөрөмжийн session. */
export type EfTokenKind = 'erp' | 'revit';

export interface EfActor {
  userId: number;
  role: UserRole;
  tokenKind: EfTokenKind;
  username: string;
  fullName: string | null;
}

/** Токены `purpose`-оос: зөвшөөрөгдөх хоёр л төрөл; бусад нь null (татгалзана). */
export function tokenKindOf(payload: Pick<JWTPayload, 'purpose'> | null | undefined): EfTokenKind | null {
  if (!payload) return null;
  const p = payload.purpose;
  if (p === undefined || p === null || p === '') return 'erp';
  if (p === 'revit') return 'revit';
  return null;
}

interface UserRow {
  id: number;
  role: string;
  status: string | null;
  username: string;
  full_name: string | null;
}

async function loadUser(db: D1Database, userId: number): Promise<UserRow | null> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;
  return db
    .prepare(`SELECT id, role, status, username, full_name FROM users WHERE id = ?`)
    .bind(userId)
    .first<UserRow>();
}

/**
 * Илгээгч.  DB-ийн ОДООГИЙН role (JWT-ийнх биш) + идэвхтэй.  null = илгээх эрхгүй.
 * Revit session-ийн role-ийг `revitSessionCheck` аль хэдийн DB-тэй тулгасан ч энд дахин уншина (нэг эх сурвалж).
 */
export async function resolveSubmitter(db: D1Database, payload: JWTPayload | undefined): Promise<EfActor | null> {
  const kind = tokenKindOf(payload);
  if (!payload || !kind) return null;
  const u = await loadUser(db, payload.sub);
  if (!u || u.status !== 'active') return null;
  if (!(EF_SUBMITTER_ROLES as readonly string[]).includes(u.role)) return null;
  return { userId: u.id, role: u.role as UserRole, tokenKind: kind, username: u.username, fullName: u.full_name };
}

/** Reviewer-ийн шалгалтын SQL — нэг асуулгаар бүх нөхцөл (D1 нэг round trip). */
const REVIEWER_SQL = `SELECT u.id, u.role, u.status, u.username, u.full_name
    FROM users u
    JOIN engineering_feedback_reviewer_binding b
      ON b.id = 1
     AND b.user_id = u.id
     AND b.username = u.username
     AND b.employee_id = u.employee_id
    JOIN access_capabilities c
      ON c.user_id = u.id
     AND c.capability = ?
     AND c.revoked_at IS NULL
   WHERE u.id = ?
     AND u.status = 'active'
   LIMIT 1`;

/**
 * Reviewer.  null = эрхгүй (ямар ч шалтгаанаар — хариу нь ялгаагүй, хайж олох боломж өгөхгүй).
 * Хүснэгт байхгүй (миграц хэрэгжээгүй) бол алдааг ДАРЖ null — fail-closed.
 */
export async function resolveReviewer(db: D1Database, payload: JWTPayload | undefined): Promise<EfActor | null> {
  if (!payload || tokenKindOf(payload) !== 'erp') return null;
  if (!Number.isSafeInteger(payload.sub) || payload.sub <= 0) return null;
  let row: UserRow | null = null;
  try {
    row = await db.prepare(REVIEWER_SQL).bind(EF_CAPABILITY, payload.sub).first<UserRow>();
  } catch (err) {
    console.error('[engineering-feedback] reviewer check failed', err);
    return null;
  }
  if (!row) return null;
  return { userId: row.id, role: row.role as UserRole, tokenKind: 'erp', username: row.username, fullName: row.full_name };
}

/** Мэдэгдлийн хүлээн авагч: binding + capability + идэвхтэй (токенгүй).  null = reviewer тохируулаагүй/хаалттай. */
export async function boundReviewerUserId(db: D1Database): Promise<number | null> {
  try {
    const row = await db
      .prepare(
        `SELECT u.id FROM users u
           JOIN engineering_feedback_reviewer_binding b
             ON b.id = 1 AND b.user_id = u.id AND b.username = u.username AND b.employee_id = u.employee_id
           JOIN access_capabilities c
             ON c.user_id = u.id AND c.capability = ? AND c.revoked_at IS NULL
          WHERE u.status = 'active'
          LIMIT 1`,
      )
      .bind(EF_CAPABILITY)
      .first<{ id: number }>();
    return row?.id ?? null;
  } catch {
    return null;
  }
}
