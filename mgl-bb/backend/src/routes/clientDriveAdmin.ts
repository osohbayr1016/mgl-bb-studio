/* =============================================================
 * Захиалагчид төслийн Drive баримт нээх — АЖИЛТНЫ тал (2026-09-18, миграц 0327)
 * -------------------------------------------------------------
 * `/api/client-admin` дээр mount хийгдсэн ХОЁР ДАХЬ router (routes/clientAdmin.ts-ийн
 * дараа).  `lib/clientScope.ts`-ийн цагаан жагсаалтад БАЙХГҮЙ угтвар тул
 * захиалагч энд хэзээ ч хүрэхгүй.
 *
 *   GET    /projects/:id/drive-shares            нээлтүүд (байгууллагаар) + эрхтэй байгууллагууд
 *   POST   /projects/:id/drive-shares            { org_ids, item_id, note? } — нээх (revoked → сэргээнэ)
 *   DELETE /projects/:id/drive-shares/:shareId   хаах (revoked_at; мөр устахгүй)
 *   GET    /projects/:id/drive-shares/log        захиалагчийн харсан/татсан бүртгэл (сүүлийн N)
 *
 * Эрх: `requireManager()` (admin + senior) — «Баримт бичиг» табыг харах
 * `DRIVE_ROLES`-той ижил хос; захиалагчид нээх нь Drive-ыг харж чадах хүний
 * ажил.  Байгууллага нь тухайн төсөлд ИДЭВХТЭЙ `project_client_access`-тэй
 * байх ёстой (409) — эрхгүй байгууллагад нээлт үүсгэвэл «харагдахгүй мөр»
 * үлдэж төөрөгдүүлнэ.
 *
 * Зүйл нь төслийн Drive үндэс хавтасны ДОТОР байх ёстой (`resolveAncestry`) —
 * өөр төслийн файлын id-г энд өгч нээх боломжгүй.  Нэр/mime нь нээх мөчийн
 * харуулах кэш; захиалагчийн жагсаалт Drive-аас амьд уншина.
 *
 * ⚠️ 2026-09-21-ээс `client_drive_shares` ХАРАГДАЦЫГ ШИЙДЭХЭЭ БОЛЬСОН (эзний
 * шийдвэр: төсөлд эрхтэй байгууллагын захиалагч Drive хавтсыг БҮХЭЛД НЬ
 * view-only харна, зөвхөн «09» хавтсанд байршуулна — `lib/clientDriveUpload.ts`,
 * `routes/clientDrive.ts`).  Энэ router-ийн нээх/хаах замууд хэвээр ажиллана
 * (мөр бичигдэнэ, мэдэгдэл явна) — гэхдээ порталын харагдацад НӨЛӨӨГҮЙ;
 * frontend-ийн «Захиалагч» самбар нээх товчийг харуулахаа больж, зөвхөн
 * `/log` (хандалтын бүртгэл) + урилгыг л ашигладаг.
 * ============================================================= */
import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireManager } from '../middleware/auth';
import { invalidateClientDriveShares, type ClientDriveShareRow } from '../lib/clientDriveShares';
import { emitClientEvent } from '../lib/clientEvents';
import { createNotification } from '../lib/notify';
import { DriveBrowseError, FOLDER_MIME, SHORTCUT_MIME } from '../lib/google/driveBrowse';
import { loadProjectDriveRoot } from '../lib/projectDrive';
import { resolveAncestry } from '../lib/projectDriveAccess';
import { driveErrorResponse, noStore } from './projectDrive';

const clientDriveAdmin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const ID_RE = /^[A-Za-z0-9_-]{10,}$/;

interface ShareView extends ClientDriveShareRow {
  org_name: string;
  shared_by_name: string | null;
  revoked_by: number | null;
  revoked_by_name: string | null;
  /** Энэ зүйлийг захиалагч сүүлд хэзээ харсан/татсан. */
  last_access_at: string | null;
  access_count: number;
}

interface OrgView {
  org_id: number;
  org_name: string;
  access_level: string;
  contact_count: number;
}

async function loadOrgsWithAccess(db: D1Database, projectId: number): Promise<OrgView[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id AS org_id, o.name AS org_name, pca.access_level,
              (SELECT COUNT(*) FROM client_contacts cc WHERE cc.org_id = o.id) AS contact_count
         FROM project_client_access pca
         JOIN client_orgs o ON o.id = pca.org_id
        WHERE pca.project_id = ? AND pca.revoked_at IS NULL AND o.status = 'active'
        ORDER BY o.name`,
    )
    .bind(projectId)
    .all<OrgView>();
  return results;
}

// GET /projects/:id/drive-shares
clientDriveAdmin.get('/projects/:id/drive-shares', requireManager(), async (c) => {
  noStore(c);
  const projectId = Number(c.req.param('id'));
  if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'Invalid id' }, 400);
  const includeRevoked = c.req.query('include_revoked') === '1';

  const root = await loadProjectDriveRoot(c.env.DB, projectId);
  if (!root) return c.json({ error: 'Project not found' }, 404);

  const { results: shares } = await c.env.DB.prepare(
    `SELECT s.id, s.project_id, s.org_id, s.drive_item_id, s.item_kind, s.item_name, s.item_mime, s.note,
            s.shared_by, s.shared_at, s.revoked_by, s.revoked_at,
            o.name AS org_name,
            ub.full_name AS shared_by_name,
            ur.full_name AS revoked_by_name,
            (SELECT MAX(l.created_at) FROM client_drive_access_log l
              WHERE l.project_id = s.project_id AND l.org_id = s.org_id AND l.via_item_id = s.drive_item_id) AS last_access_at,
            (SELECT COUNT(*) FROM client_drive_access_log l
              WHERE l.project_id = s.project_id AND l.org_id = s.org_id AND l.via_item_id = s.drive_item_id) AS access_count
       FROM client_drive_shares s
       JOIN client_orgs o ON o.id = s.org_id
       LEFT JOIN users ub ON ub.id = s.shared_by
       LEFT JOIN users ur ON ur.id = s.revoked_by
      WHERE s.project_id = ? ${includeRevoked ? '' : 'AND s.revoked_at IS NULL'}
      ORDER BY o.name, s.revoked_at IS NOT NULL, s.item_kind, s.item_name`,
  )
    .bind(projectId)
    .all<ShareView>();

  return c.json({
    linked: root.folder_id !== null,
    folder_name: root.folder_name,
    orgs: await loadOrgsWithAccess(c.env.DB, projectId),
    shares,
  });
});

// POST /projects/:id/drive-shares — { org_ids: number[] | org_id, item_id, note? }
clientDriveAdmin.post('/projects/:id/drive-shares', requireManager(), async (c) => {
  noStore(c);
  const projectId = Number(c.req.param('id'));
  if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'Invalid id' }, 400);
  const actor = c.get('user');
  const body = await c.req.json<{ org_ids?: number[]; org_id?: number; item_id?: string; note?: string }>();

  const orgIds = [...new Set((Array.isArray(body.org_ids) ? body.org_ids : [body.org_id]).map(Number))].filter(
    (n) => Number.isInteger(n) && n > 0,
  );
  if (orgIds.length === 0) return c.json({ error: 'org_ids шаардлагатай' }, 400);
  const itemId = String(body.item_id ?? '').trim();
  if (!ID_RE.test(itemId)) return c.json({ error: 'item_id буруу', code: 'INVALID_ID' }, 400);
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : null;

  const root = await loadProjectDriveRoot(c.env.DB, projectId);
  if (!root) return c.json({ error: 'Project not found' }, 404);
  if (!root.folder_id) {
    return c.json({ error: 'Энэ төсөлд Google Drive хавтас холбогдоогүй байна', code: 'NOT_LINKED' }, 409);
  }

  // Байгууллага бүр тухайн төсөлд ИДЭВХТЭЙ эрхтэй байх ёстой.
  const allowed = new Map((await loadOrgsWithAccess(c.env.DB, projectId)).map((o) => [o.org_id, o]));
  const missing = orgIds.filter((id) => !allowed.has(id));
  if (missing.length > 0) {
    return c.json(
      { error: 'Байгууллага энэ төсөлд эрхгүй байна — эхлээд «Захиалагч» табаас эрх олгоно уу', code: 'ORG_NO_ACCESS', org_ids: missing },
      409,
    );
  }

  // Зүйл нь ЭНЭ төслийн хавтасны дотор мөн үү.
  let name: string;
  let mime: string;
  try {
    const anc = await resolveAncestry(c.env, root.folder_id, itemId);
    if (!anc.ok) {
      return anc.reason === 'TRASHED'
        ? c.json({ error: 'Энэ зүйл Drive-ын хогийн саванд байна', code: 'NOT_FOUND' }, 404)
        : c.json({ error: 'Энэ зүйл төслийн хавтасны дотор биш', code: 'OUTSIDE_PROJECT' }, 403);
    }
    name = anc.target.name;
    mime = anc.target.mimeType;
  } catch (err) {
    if (err instanceof DriveBrowseError) return driveErrorResponse(c, err, `client-share project=${projectId} item=${itemId}`);
    throw err;
  }
  if (mime === SHORTCUT_MIME) {
    return c.json({ error: 'Товчлолыг захиалагчид нээх боломжгүй — эх файлыг нь нээнэ үү', code: 'IS_SHORTCUT' }, 400);
  }
  const kind: 'folder' | 'file' = mime === FOLDER_MIME ? 'folder' : 'file';

  const stmts = orgIds.map((orgId) =>
    c.env.DB.prepare(
      `INSERT INTO client_drive_shares (project_id, org_id, drive_item_id, item_kind, item_name, item_mime, note, shared_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, org_id, drive_item_id)
       DO UPDATE SET item_kind = excluded.item_kind, item_name = excluded.item_name, item_mime = excluded.item_mime,
                     note = COALESCE(excluded.note, client_drive_shares.note),
                     shared_by = excluded.shared_by, shared_at = datetime('now'),
                     revoked_by = NULL, revoked_at = NULL`,
    ).bind(projectId, orgId, itemId, kind, name, mime, note, actor.sub),
  );
  await c.env.DB.batch(stmts);
  invalidateClientDriveShares(projectId);

  // Портал руу: үйл явдлын урсгал (жагсаалт шинэчлэгдэнэ) + хонхны мэдэгдэл
  // ЗӨВХӨН нээсэн байгууллагын хүмүүст.  Урсгалын гарчигт файлын нэр ОРОХГҮЙ —
  // төслийн бусад байгууллага ч тэр урсгалыг уншдаг.
  c.executionCtx.waitUntil(
    (async () => {
      await emitClientEvent(c.env, projectId, 'document', 'Баримт бичиг шинэчлэгдлээ', null, actor.sub);
      const ph = orgIds.map(() => '?').join(',');
      const { results } = await c.env.DB.prepare(
        `SELECT DISTINCT cc.user_id FROM client_contacts cc
           JOIN users u ON u.id = cc.user_id AND u.status = 'active'
          WHERE cc.org_id IN (${ph})`,
      )
        .bind(...orgIds)
        .all<{ user_id: number }>();
      const title = kind === 'folder' ? `«${name}» хавтас танд нээгдлээ` : `«${name}» файл танд нээгдлээ`;
      for (const r of results) {
        await createNotification(c.env.DB, r.user_id, 'client_publication', title, root.project_name, '/client');
      }
    })(),
  );

  return c.json({ ok: true, item: { id: itemId, name, kind }, org_ids: orgIds }, 201);
});

// DELETE /projects/:id/drive-shares/:shareId
clientDriveAdmin.delete('/projects/:id/drive-shares/:shareId', requireManager(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const shareId = Number(c.req.param('shareId'));
  if (!Number.isInteger(projectId) || !Number.isInteger(shareId)) return c.json({ error: 'Invalid id' }, 400);
  const actor = c.get('user');
  const res = await c.env.DB.prepare(
    `UPDATE client_drive_shares SET revoked_at = datetime('now'), revoked_by = ?
      WHERE id = ? AND project_id = ? AND revoked_at IS NULL`,
  )
    .bind(actor.sub, shareId, projectId)
    .run();
  invalidateClientDriveShares(projectId);
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'Not found' }, 404);
  c.executionCtx.waitUntil(emitClientEvent(c.env, projectId, 'document', 'Баримт бичиг шинэчлэгдлээ', null, actor.sub));
  return c.json({ ok: true });
});

// GET /projects/:id/drive-shares/log?limit=50
clientDriveAdmin.get('/projects/:id/drive-shares/log', requireManager(), async (c) => {
  noStore(c);
  const projectId = Number(c.req.param('id'));
  if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'Invalid id' }, 400);
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.org_id, o.name AS org_name, l.user_id, u.full_name AS user_name,
            l.drive_item_id, l.item_name, l.action, l.created_at
       FROM client_drive_access_log l
       LEFT JOIN client_orgs o ON o.id = l.org_id
       LEFT JOIN users u ON u.id = l.user_id
      WHERE l.project_id = ?
      ORDER BY l.id DESC
      LIMIT ?`,
  )
    .bind(projectId, limit)
    .all();
  return c.json({ log: results });
});

export default clientDriveAdmin;
