import { currentTenantId } from './requestContext';

/**
 * «Энэ захиалагч аль төслийг харах эрхтэй вэ» гэдгийн ЦОРЫН ГАНЦ эх сурвалж.
 *
 * ⚠️ Эрхийг JWT-д ХЭЗЭЭ Ч хийхгүй.  CLAUDE.md-ийн хатуу сургамж: `role` нь
 *    токеноос уншигддаг тул DB дээрх өөрчлөлт 24 цаг хүчингүй хэвээр байдаг —
 *    захиалагчийн эрх нээх/хаах нь тэр хугацаанд хүлээх боломжгүй зүйл
 *    (гэрээ цуцлагдсан компани маргааш хүртэл зураг татсаар байх ёсгүй).
 *    Тиймээс хүсэлт бүрт DB-ээс шийдэж, `officeAccess.ts`-тэй яг ижил
 *    60 секундын кэшээр дуудлагын тоог барина.
 *
 * ХОЁР ЭХ СУРВАЛЖИЙГ ЗЭРЭГ УНШИНА (шилжилтийн үе):
 *   1. `project_client_access` → `client_contacts` — ШИНЭ, байгууллага төвтэй.
 *   2. `project_members` — ХУУЧИН, хүн шууд төсөлд холбогдсон 5 мөр.
 * Хоёр дахийг нь дараагийн хувилбарт устгана; түүнийг устгах өдөр энэ
 * файлын `LEGACY_SQL`-ийг хасахад л хангалттай — дуудагч талд өөрчлөлт
 * орохгүй.
 */

export type ClientAccessLevel = 'viewer' | 'contributor' | 'approver';

const LEVEL_RANK: Record<ClientAccessLevel, number> = {
  viewer: 0,
  contributor: 1,
  approver: 2,
};

export interface ClientProjectAccess {
  project_id: number;
  access_level: ClientAccessLevel;
  /** Шинэ загвараар ирсэн бол байгууллагын id; хуучин мөрөөр ирвэл null. */
  org_id: number | null;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; rows: ClientProjectAccess[] }>();

function cacheKey(userId: number): string {
  return `${currentTenantId()}:${userId}`;
}

/** Эрх өөрчлөгдөх бүрт (эрх нээх/хаах, гэрээ цуцлах) дуудна. */
export function invalidateClientAccessCache(userId?: number): void {
  if (userId === undefined) cache.clear();
  else cache.delete(cacheKey(userId));
}

const ORG_SQL = `
  SELECT pca.project_id AS project_id,
         pca.access_level AS access_level,
         pca.org_id AS org_id
    FROM project_client_access pca
    JOIN client_contacts cc ON cc.org_id = pca.org_id
   WHERE cc.user_id = ? AND pca.revoked_at IS NULL`;

/** ⚠️ Устгах өдөр: энэ тогтмолыг болон түүний try/catch-ийг хамт хасна. */
const LEGACY_SQL = `
  SELECT pm.project_id AS project_id
    FROM project_members pm
   WHERE pm.user_id = ?`;

/** Тухайн захиалагчийн БҮХ төслийн эрх (кэштэй). */
export async function clientProjectAccess(
  db: D1Database,
  userId: number,
): Promise<ClientProjectAccess[]> {
  const now = Date.now();
  const key = cacheKey(userId);
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.rows;

  const byProject = new Map<number, ClientProjectAccess>();

  // 1) Шинэ, байгууллага төвтэй эрх.  Migration хараахан ороогүй DB дээр
  //    (локал хуучин хуулбар) хүснэгт байхгүй тул алдааг залгиж, хуучин
  //    эх сурвалж дээр л ажиллана.
  try {
    const { results } = await db
      .prepare(ORG_SQL)
      .bind(userId)
      .all<{ project_id: number; access_level: string; org_id: number }>();
    for (const row of results) {
      const level = (
        row.access_level === 'approver' || row.access_level === 'contributor'
          ? row.access_level
          : 'viewer'
      ) as ClientAccessLevel;
      const prev = byProject.get(row.project_id);
      if (!prev || LEVEL_RANK[level] > LEVEL_RANK[prev.access_level]) {
        byProject.set(row.project_id, {
          project_id: row.project_id,
          access_level: level,
          org_id: row.org_id,
        });
      }
    }
  } catch (err) {
    console.warn('[client-access] org хүснэгт уншигдсангүй', err);
  }

  // 2) Хуучин шууд гишүүнчлэл — үргэлж `viewer`.
  try {
    const { results } = await db.prepare(LEGACY_SQL).bind(userId).all<{ project_id: number }>();
    for (const row of results) {
      if (!byProject.has(row.project_id)) {
        byProject.set(row.project_id, {
          project_id: row.project_id,
          access_level: 'viewer',
          org_id: null,
        });
      }
    }
  } catch (err) {
    console.warn('[client-access] project_members уншигдсангүй', err);
  }

  const rows = [...byProject.values()];
  cache.set(key, { at: now, rows });
  return rows;
}

/** Захиалагчийн харж болох төслийн id-ууд. */
export async function clientProjectIds(db: D1Database, userId: number): Promise<number[]> {
  return (await clientProjectAccess(db, userId)).map((r) => r.project_id);
}

/** Нэг төсөл дээрх эрхийн түвшин; эрхгүй бол null. */
export async function clientAccessLevel(
  db: D1Database,
  userId: number,
  projectId: number,
): Promise<ClientAccessLevel | null> {
  const rows = await clientProjectAccess(db, userId);
  return rows.find((r) => r.project_id === projectId)?.access_level ?? null;
}

/** Уншиж болох эсэх (viewer ч хангалттай). */
export async function clientCanRead(
  db: D1Database,
  userId: number,
  projectId: number,
): Promise<boolean> {
  return (await clientAccessLevel(db, userId, projectId)) !== null;
}

/** Материал ИЛГЭЭХ эрхтэй эсэх — `contributor` буюу түүнээс дээш. */
export async function clientCanSubmit(
  db: D1Database,
  userId: number,
  projectId: number,
): Promise<boolean> {
  const level = await clientAccessLevel(db, userId, projectId);
  return level === 'contributor' || level === 'approver';
}

/** Захиалагчийн харьяалагдах байгууллагын id-ууд. */
export async function clientOrgIds(db: D1Database, userId: number): Promise<number[]> {
  try {
    const { results } = await db
      .prepare('SELECT org_id FROM client_contacts WHERE user_id = ?')
      .bind(userId)
      .all<{ org_id: number }>();
    return results.map((r) => r.org_id);
  } catch {
    return [];
  }
}

/**
 * Route дотор нэг мөрөөр дуудах хаалт.  `client` биш бол ҮРГЭЛЖ true —
 * ажилтны эрхийг энэ файл ШИЙДЭХГҮЙ (тэр нь route бүрийн өөрийн хэрэг).
 */
export async function guardClientProject(
  db: D1Database,
  user: { sub: number; role: string },
  projectId: number,
): Promise<boolean> {
  if (user.role !== 'client') return true;
  return clientCanRead(db, user.sub, projectId);
}
