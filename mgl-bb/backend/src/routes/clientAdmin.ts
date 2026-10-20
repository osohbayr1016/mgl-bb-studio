import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireAdmin, requireManager } from '../middleware/auth';
import { hashPassword } from '../lib/password';
import { invalidateClientAccessCache } from '../lib/clientAccess';
import { emitClientEvent, notifyProjectClients } from '../lib/clientEvents';
import {
  INVITE_TTL_SECONDS,
  RESET_TTL_SECONDS,
  inviteUrl,
  newInviteToken,
  saveInvite,
} from '../lib/clientInvite';
import { sendClientInviteMail, type InviteMailResult } from '../lib/clientInviteMail';

/**
 * `/api/client-admin/*` — АЖИЛТНЫ тал.  Захиалагчийн байгууллага, эрх,
 * нийтлэл, гаргасан зургийн багц, ирсэн материалын шалгалт.
 *
 * ⚠️ Энэ угтвар `lib/clientScope.ts`-ийн цагаан жагсаалтад БАЙХГҮЙ — сегментийн
 *    хилээр таардаг тул `/api/client` зөвшөөрөл нь `/api/client-admin`-ыг
 *    ХАМРАХГҮЙ.  Өөрөөр хэлбэл захиалагч энэ файлын нэг ч замд хүрэхгүй.
 */
const clientAdmin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/* ------------------------------------------------------------------ */
/*  project_members-ийн ТУСГАЛЫГ шинэчлэх                              */
/* ------------------------------------------------------------------ */

/**
 * Байгууллагын эрхийг `project_members`-т тусгана.
 *
 * ЯАГААД ХЭРЭГТЭЙ ВЭ: `project_members` дээр аппын 40 гаруй SQL join тогтдог
 * (төслийн жагсаалт, `/project-chat`, албан бичиг, APS, гүйцэтгэлийн тайлан,
 * паспорт).  Тэдгээрийг бүгдийг нь «байгууллагаар дамжсан» шинэ асуулга
 * болгож дахин бичих нь `PROJECT_LIST_SQL`-ийн байрлалаар bind хийдэг дөрвөн
 * дуудагчийг эвдэх эрсдэлтэй (CLAUDE.md-ийн анхааруулга).  Тиймээс эх
 * сурвалж нь `project_client_access` + `client_contacts`, харин
 * `project_members` нь түүний ТУСГАЛ хэвээр үлдэнэ.
 *
 * ⚠️ ХУУЧИН МӨРИЙГ ХЭЗЭЭ Ч УСТГАХГҮЙ: зөвхөн ЭНЭ байгууллагын
 *    `project_client_access`-д бүртгэлтэй төслийн мөрийг л цэвэрлэнэ.
 *    Гараар нэмсэн 5 хуучин мөр (төсөл 30, 51) хөндөгдөхгүй.
 */
export async function syncOrgMembership(db: D1Database, orgId: number): Promise<void> {
  const { results: contacts } = await db
    .prepare('SELECT user_id FROM client_contacts WHERE org_id = ?')
    .bind(orgId)
    .all<{ user_id: number }>();
  const userIds = contacts.map((r) => r.user_id);

  const { results: orgProjects } = await db
    .prepare('SELECT project_id, revoked_at FROM project_client_access WHERE org_id = ?')
    .bind(orgId)
    .all<{ project_id: number; revoked_at: string | null }>();

  const live = orgProjects.filter((p) => !p.revoked_at).map((p) => p.project_id);
  const managed = new Set(orgProjects.map((p) => p.project_id));

  const stmts: D1PreparedStatement[] = [];

  for (const userId of userIds) {
    // Тухайн хүн ӨӨР байгууллагаар дамжин ямар төсөл харах эрхтэйг ч
    // тооцно — нэг хүн хоёр компанийг төлөөлж болно.
    const { results: allowedRows } = await db
      .prepare(
        `SELECT DISTINCT pca.project_id AS project_id
           FROM project_client_access pca
           JOIN client_contacts cc ON cc.org_id = pca.org_id
          WHERE cc.user_id = ? AND pca.revoked_at IS NULL`,
      )
      .bind(userId)
      .all<{ project_id: number }>();
    const allowed = new Set(allowedRows.map((r) => r.project_id));

    for (const projectId of live) {
      stmts.push(
        db
          .prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)')
          .bind(projectId, userId),
      );
    }
    for (const projectId of managed) {
      if (allowed.has(projectId)) continue;
      stmts.push(
        db
          .prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
          .bind(projectId, userId),
      );
    }
    invalidateClientAccessCache(userId);
  }

  if (stmts.length > 0) await db.batch(stmts);
}

/* ------------------------------------------------------------------ */
/*  Байгууллага                                                        */
/* ------------------------------------------------------------------ */

clientAdmin.get('/orgs', requireManager(), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.name, o.registry_no, o.logo_url, o.status, o.created_at,
            (SELECT COUNT(*) FROM client_contacts cc WHERE cc.org_id = o.id) AS contact_count,
            (SELECT COUNT(*) FROM project_client_access pca
              WHERE pca.org_id = o.id AND pca.revoked_at IS NULL) AS project_count
       FROM client_orgs o
      ORDER BY o.status = 'inactive', o.name`,
  ).all();
  return c.json({ orgs: results });
});

clientAdmin.get('/orgs/:id', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);

  const org = await c.env.DB.prepare('SELECT * FROM client_orgs WHERE id = ?').bind(id).first();
  if (!org) return c.json({ error: 'Not found' }, 404);

  const [contacts, projects] = await Promise.all([
    c.env.DB.prepare(
      `SELECT cc.id, cc.user_id, cc.contact_role, cc.invited_at, cc.accepted_at,
              u.username, u.full_name, u.email, u.status
         FROM client_contacts cc
         JOIN users u ON u.id = cc.user_id
        WHERE cc.org_id = ?
        ORDER BY cc.contact_role = 'viewer', u.full_name`,
    )
      .bind(id)
      .all(),
    c.env.DB.prepare(
      `SELECT pca.project_id, pca.access_level, pca.granted_at, pca.revoked_at, p.name
         FROM project_client_access pca
         JOIN projects p ON p.id = pca.project_id
        WHERE pca.org_id = ?
        ORDER BY pca.revoked_at IS NOT NULL, p.name`,
    )
      .bind(id)
      .all(),
  ]);

  return c.json({ org, contacts: contacts.results, projects: projects.results });
});

clientAdmin.post('/orgs', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ name?: string; registry_no?: string; logo_url?: string }>();
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'Нэр заавал' }, 400);

  const row = await c.env.DB.prepare(
    `INSERT INTO client_orgs (name, registry_no, logo_url, created_by)
     VALUES (?, ?, ?, ?) RETURNING id`,
  )
    .bind(name, (body.registry_no ?? '').trim() || null, (body.logo_url ?? '').trim() || null, user.sub)
    .first<{ id: number }>();

  return c.json({ id: row?.id }, 201);
});

clientAdmin.patch('/orgs/:id', requireAdmin(), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ name?: string; registry_no?: string | null; logo_url?: string | null; status?: string }>();
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?');
    binds.push(body.name.trim());
  }
  if (body.registry_no !== undefined) {
    sets.push('registry_no = ?');
    binds.push((body.registry_no ?? '').trim() || null);
  }
  if (body.logo_url !== undefined) {
    sets.push('logo_url = ?');
    binds.push((body.logo_url ?? '').trim() || null);
  }
  if (body.status === 'active' || body.status === 'inactive') {
    sets.push('status = ?');
    binds.push(body.status);
  }
  if (sets.length === 0) return c.json({ error: 'Nothing to update' }, 400);

  binds.push(id);
  await c.env.DB.prepare(`UPDATE client_orgs SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  invalidateClientAccessCache();
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Холбоо барих хүн + урилга                                          */
/* ------------------------------------------------------------------ */

/**
 * Байгууллагад хүн нэмнэ.  Хоёр горим:
 *   • `user_id` ирвэл — байгаа хэрэглэгчийг холбоно.
 *   • `email` + `full_name` ирвэл — ШИНЭ `client` хэрэглэгч үүсгээд урилгын
 *     нэг удаагийн холбоос буцаана.
 *
 * Шинэ хэрэглэгчид нууц үгийг САНАМСАРГҮЙ өгнө — хэн ч мэдэхгүй, урилгаар л
 * тохируулна.  Ингэснээр «түр нууц үг» имэйлээр яваад хэвээр үлддэг эрсдэл
 * үүсэхгүй.
 */
clientAdmin.post('/orgs/:id/contacts', requireAdmin(), async (c) => {
  const orgId = Number(c.req.param('id'));
  const actor = c.get('user');
  const body = await c.req.json<{
    user_id?: number;
    email?: string;
    full_name?: string;
    username?: string;
    contact_role?: string;
    /** Урилгыг имэйлээр ШУУД илгээх (2026-09-18, lib/clientInviteMail.ts).
     *  Өгөгдмөл true; илгээлт унасан ч холбоос хариунд хэвээр — админ гараар явуулна. */
    send_email?: boolean;
    /** Имэйлийн бичвэрт «энэ төслийн баримт бичигт» гэж дурдах (Баримт бичгийн хуудаснаас). */
    project_id?: number;
  }>();

  const org = await c.env.DB.prepare('SELECT id, name FROM client_orgs WHERE id = ?')
    .bind(orgId)
    .first<{ id: number; name: string }>();
  if (!org) return c.json({ error: 'Org not found' }, 404);

  const role = ['owner', 'pm', 'viewer'].includes(String(body.contact_role))
    ? String(body.contact_role)
    : 'viewer';

  let userId = Number(body.user_id);
  let invite: string | null = null;
  let inviteTo: { email: string; full_name: string } | null = null;

  if (!Number.isFinite(userId) || userId <= 0) {
    const email = (body.email ?? '').trim().toLowerCase();
    const fullName = (body.full_name ?? '').trim();
    if (!email || !fullName) return c.json({ error: 'email + full_name шаардлагатай' }, 400);
    inviteTo = { email, full_name: fullName };

    const existing = await c.env.DB.prepare(
      "SELECT id FROM users WHERE lower(email) = ? AND role = 'client'",
    )
      .bind(email)
      .first<{ id: number }>();

    if (existing) {
      userId = existing.id;
    } else {
      const username = ((body.username ?? '').trim() || email.split('@')[0] || 'client')
        .replace(/[^a-zA-Z0-9._-]/g, '')
        .slice(0, 40);
      const taken = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
        .bind(username)
        .first<{ id: number }>();
      const finalUsername = taken ? `${username}${Date.now().toString().slice(-4)}` : username;

      // Санамсаргүй нууц үг — хэн ч мэдэхгүй, урилгаар солино.
      const randomBytes = new Uint8Array(24);
      crypto.getRandomValues(randomBytes);
      const randomPassword = [...randomBytes].map((b) => b.toString(36)).join('');

      const created = await c.env.DB.prepare(
        `INSERT INTO users (username, password_hash, full_name, role, email, status)
         VALUES (?, ?, ?, 'client', ?, 'active') RETURNING id`,
      )
        .bind(finalUsername, await hashPassword(randomPassword), fullName, email)
        .first<{ id: number }>();
      if (!created) return c.json({ error: 'Хэрэглэгч үүсгэж чадсангүй' }, 500);
      userId = created.id;
    }

    const token = newInviteToken();
    await saveInvite(
      c.env,
      token,
      { user_id: userId, org_id: orgId, kind: 'invite', created_at: new Date().toISOString() },
      INVITE_TTL_SECONDS,
    );
    invite = inviteUrl(c.env, token, 'invite');
  }

  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO client_contacts (org_id, user_id, contact_role, invited_by, invited_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  )
    .bind(orgId, userId, role, actor.sub)
    .run();

  await syncOrgMembership(c.env.DB, orgId);

  let mail: InviteMailResult | null = null;
  if (invite && inviteTo && body.send_email !== false) {
    mail = await sendClientInviteMail(c.env, {
      to: inviteTo.email,
      full_name: inviteTo.full_name,
      kind: 'invite',
      url: invite,
      org_name: org.name,
      project_name: await projectNameOf(c.env.DB, body.project_id),
      inviter_name: await userNameOf(c.env.DB, actor.sub),
    });
  }
  return c.json(
    {
      user_id: userId,
      invite_url: invite,
      email_sent: mail?.sent === true,
      email_error: mail && !mail.sent ? mail.error : null,
    },
    201,
  );
});

async function projectNameOf(db: D1Database, projectId: number | undefined): Promise<string | null> {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.prepare('SELECT name FROM projects WHERE id = ?').bind(id).first<{ name: string }>();
  return row?.name ?? null;
}

async function userNameOf(db: D1Database, userId: number): Promise<string | null> {
  const row = await db.prepare('SELECT full_name FROM users WHERE id = ?').bind(userId).first<{ full_name: string }>();
  return row?.full_name ?? null;
}

clientAdmin.delete('/orgs/:id/contacts/:userId', requireAdmin(), async (c) => {
  const orgId = Number(c.req.param('id'));
  const userId = Number(c.req.param('userId'));
  await c.env.DB.prepare('DELETE FROM client_contacts WHERE org_id = ? AND user_id = ?')
    .bind(orgId, userId)
    .run();
  await syncOrgMembership(c.env.DB, orgId);
  return c.json({ ok: true });
});

/** Урилгыг дахин үүсгэх / нууц үг сэргээх холбоос.  `?send=1` → имэйлээр ч илгээнэ. */
clientAdmin.post('/contacts/:userId/invite', requireAdmin(), async (c) => {
  const userId = Number(c.req.param('userId'));
  const kind = c.req.query('kind') === 'reset' ? 'reset' : 'invite';
  const send = c.req.query('send') === '1';
  const user = await c.env.DB.prepare("SELECT id, email, full_name FROM users WHERE id = ? AND role = 'client'")
    .bind(userId)
    .first<{ id: number; email: string | null; full_name: string }>();
  if (!user) return c.json({ error: 'Not found' }, 404);

  const token = newInviteToken();
  await saveInvite(
    c.env,
    token,
    { user_id: userId, org_id: null, kind, created_at: new Date().toISOString() },
    kind === 'reset' ? RESET_TTL_SECONDS : INVITE_TTL_SECONDS,
  );
  const url = inviteUrl(c.env, token, kind);
  let mail: InviteMailResult | null = null;
  if (send) {
    if (!user.email) {
      mail = { sent: false, error: 'Хэрэглэгчид имэйл хаяг бүртгэгдээгүй' };
    } else {
      const org = await c.env.DB.prepare(
        'SELECT o.name FROM client_contacts cc JOIN client_orgs o ON o.id = cc.org_id WHERE cc.user_id = ? ORDER BY cc.id LIMIT 1',
      )
        .bind(userId)
        .first<{ name: string }>();
      mail = await sendClientInviteMail(c.env, {
        to: user.email,
        full_name: user.full_name,
        kind,
        url,
        org_name: org?.name ?? null,
        inviter_name: await userNameOf(c.env.DB, c.get('user').sub),
      });
    }
  }
  return c.json({
    invite_url: url,
    email_sent: mail?.sent === true,
    email_error: mail && !mail.sent ? mail.error : null,
  });
});

/* ------------------------------------------------------------------ */
/*  Төслийн эрх                                                        */
/* ------------------------------------------------------------------ */

clientAdmin.get('/projects/:id/access', requireManager(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT pca.id, pca.org_id, pca.access_level, pca.granted_at, pca.revoked_at,
            o.name AS org_name,
            (SELECT COUNT(*) FROM client_contacts cc WHERE cc.org_id = o.id) AS contact_count
       FROM project_client_access pca
       JOIN client_orgs o ON o.id = pca.org_id
      WHERE pca.project_id = ?
      ORDER BY pca.revoked_at IS NOT NULL, o.name`,
  )
    .bind(projectId)
    .all();

  // Захиалагчаас ирсэн материалыг АВТОМАТААР хаашаа хуулахыг энэ хоёр багана
  // заана (миграц 0267).  Устгагдсан архив/хавтас руу заасан хуучин утга
  // «тохируулаагүй»-тэй ижил үр дүн өгөх ёстой тул JOIN нь `deleted_at IS
  // NULL`-ээр шүүгдэнэ — UI-д «алга болсон архив» гэж харагдахгүй.
  //
  // ⚠️ ЗААВАЛ try/catch.  Энэ бол «Захиалагчийн эрх» хэсгийн ЦОРЫН ГАНЦ
  //    асуулга биш, ХОЁР ДАХЬ нь — гэтэл нэг хариунд хамт явдаг тул үүний
  //    алдаа эрхийн жагсаалтыг БҮХЭЛД НЬ 500 болгоно.  Яг тэр нь болсон:
  //    worker нь 0267-оос ӨМНӨ deploy хийгдвэл (эсвэл миграц хоцорвол)
  //    `no such column: p.client_intake_archive_id` гараад «Захиалагч» таб
  //    хоосорч, байгууллагад эрх нээх боломжгүй болов.  Автоматжуулалтын
  //    ТОХИРГОО нь эрх олгохоос хамаагүй бага ач холбогдолтой тул унавал
  //    «тохируулаагүй» болж чимээгүй буурах ёстой.
  const intake = await c.env.DB.prepare(
    `SELECT p.client_intake_archive_id AS archive_id,
            p.client_intake_folder_id  AS folder_id,
            a.name AS archive_name,
            f.name AS folder_name
       FROM projects p
       LEFT JOIN document_archives a
              ON a.id = p.client_intake_archive_id AND a.deleted_at IS NULL
       LEFT JOIN document_folders f
              ON f.id = p.client_intake_folder_id  AND f.deleted_at IS NULL
      WHERE p.id = ?`,
  )
    .bind(projectId)
    .first<{
      archive_id: number | null;
      folder_id: number | null;
      archive_name: string | null;
      folder_name: string | null;
    }>()
    .catch(() => null);

  return c.json({
    access: results,
    intake: intake?.archive_name
      ? intake
      : { archive_id: null, folder_id: null, archive_name: null, folder_name: null },
  });
});

/**
 * Автомат архивлалтын зорилтот цэгийг тохируулах / цуцлах.
 *
 * `archive_id: null` илгээвэл автоматжуулалт УНТАРНА — материал `accepted`
 * төлөвт үлдэж, архивт хуулагдахгүй.  Энэ бол зориудын гарц: зарим төслийн
 * баримтыг ажилтан гараар ангилах хэрэгтэй байж болно.
 */
clientAdmin.put('/projects/:id/intake', requireAdmin(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const body = await c.req.json<{ archive_id?: number | null; folder_id?: number | null }>();

  const archiveId =
    body.archive_id === null || body.archive_id === undefined ? null : Number(body.archive_id);
  if (archiveId !== null && !Number.isFinite(archiveId)) {
    return c.json({ error: 'archive_id буруу' }, 400);
  }

  let folderId =
    body.folder_id === null || body.folder_id === undefined ? null : Number(body.folder_id);
  if (folderId !== null && !Number.isFinite(folderId)) {
    return c.json({ error: 'folder_id буруу' }, 400);
  }
  // Архивгүйгээр хавтас утгагүй.
  if (archiveId === null) folderId = null;

  if (archiveId !== null) {
    const archive = await c.env.DB.prepare(
      'SELECT id FROM document_archives WHERE id = ? AND deleted_at IS NULL',
    )
      .bind(archiveId)
      .first<{ id: number }>();
    if (!archive) return c.json({ error: 'Архив олдсонгүй' }, 404);

    // Хавтас нь ЯГ ЭНЭ архивынх эсэхийг шалгана — өөр архивын хавтас руу
    // заавал `documents.archive_id` ба `document_folders.archive_id` хоёр
    // зөрж, Explorer дээр баримт «хаана ч байхгүй» болно.
    if (folderId !== null) {
      const folder = await c.env.DB.prepare(
        `SELECT id FROM document_folders
          WHERE id = ? AND archive_id = ? AND deleted_at IS NULL`,
      )
        .bind(folderId, archiveId)
        .first<{ id: number }>();
      if (!folder) return c.json({ error: 'Хавтас энэ архивт харьяалагдахгүй байна' }, 400);
    }
  }

  await c.env.DB.prepare(
    'UPDATE projects SET client_intake_archive_id = ?, client_intake_folder_id = ? WHERE id = ?',
  )
    .bind(archiveId, folderId, projectId)
    .run();

  return c.json({ ok: true });
});

clientAdmin.post('/projects/:id/access', requireAdmin(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const actor = c.get('user');
  const body = await c.req.json<{ org_id?: number; access_level?: string }>();
  const orgId = Number(body.org_id);
  if (!Number.isFinite(orgId)) return c.json({ error: 'org_id required' }, 400);
  const level = ['viewer', 'contributor', 'approver'].includes(String(body.access_level))
    ? String(body.access_level)
    : 'viewer';

  await c.env.DB.prepare(
    `INSERT INTO project_client_access (project_id, org_id, access_level, granted_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, org_id)
     DO UPDATE SET access_level = excluded.access_level,
                   granted_by = excluded.granted_by,
                   granted_at = datetime('now'),
                   revoked_at = NULL`,
  )
    .bind(projectId, orgId, level, actor.sub)
    .run();

  await syncOrgMembership(c.env.DB, orgId);
  return c.json({ ok: true }, 201);
});

clientAdmin.delete('/projects/:id/access/:orgId', requireAdmin(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const orgId = Number(c.req.param('orgId'));
  await c.env.DB.prepare(
    `UPDATE project_client_access SET revoked_at = datetime('now')
      WHERE project_id = ? AND org_id = ?`,
  )
    .bind(projectId, orgId)
    .run();
  await syncOrgMembership(c.env.DB, orgId);
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Гаргасан зургийн багц                                              */
/* ------------------------------------------------------------------ */

clientAdmin.get('/projects/:id/deliverables', requireManager(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT d.*,
            (SELECT COUNT(*) FROM deliverable_files f WHERE f.deliverable_id = d.id) AS file_count,
            (SELECT COUNT(*) FROM client_publications cp
              WHERE cp.project_id = d.project_id AND cp.kind = 'deliverable'
                AND cp.ref_id = d.id AND cp.unpublished_at IS NULL) AS published
       FROM project_deliverables d
      WHERE d.project_id = ?
      ORDER BY d.created_at DESC, d.id DESC`,
  )
    .bind(projectId)
    .all();
  return c.json({ deliverables: results });
});

clientAdmin.get('/deliverables/:id/files', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT id, file_name, file_size, file_type, sort_order, uploaded_at
       FROM deliverable_files WHERE deliverable_id = ? ORDER BY sort_order, id`,
  )
    .bind(id)
    .all<Record<string, unknown>>();
  return c.json({
    files: results.map((f) => ({ ...f, url: `/api/client-files/deliverable/${Number(f.id)}` })),
  });
});

clientAdmin.post('/projects/:id/deliverables', requireManager(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const actor = c.get('user');
  const body = await c.req.json<{
    title?: string;
    discipline?: string | null;
    rev?: string;
    note?: string | null;
    files?: { key?: string; name?: string; size?: number | null; type?: string | null }[];
  }>();
  const title = (body.title ?? '').trim();
  if (!title) return c.json({ error: 'Гарчиг заавал' }, 400);

  const row = await c.env.DB.prepare(
    `INSERT INTO project_deliverables (project_id, discipline, title, rev, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      projectId,
      (body.discipline ?? '').trim() || null,
      title,
      (body.rev ?? '0').trim() || '0',
      (body.note ?? '') || null,
      actor.sub,
    )
    .first<{ id: number }>();
  if (!row) return c.json({ error: 'Хадгалж чадсангүй' }, 500);

  const files = (body.files ?? []).filter((f) => typeof f?.key === 'string' && f.key);
  if (files.length > 0) {
    await c.env.DB.batch(
      files.map((f, i) =>
        c.env.DB.prepare(
          `INSERT INTO deliverable_files
             (deliverable_id, r2_key, file_name, file_type, file_size, sort_order, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(row.id, String(f.key), String(f.name ?? ''), f.type ?? null, f.size ?? null, i, actor.sub),
      ),
    );
  }

  return c.json({ id: row.id }, 201);
});

clientAdmin.post('/deliverables/:id/files', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  const actor = c.get('user');
  const body = await c.req.json<{
    files?: { key?: string; name?: string; size?: number | null; type?: string | null }[];
  }>();
  const files = (body.files ?? []).filter((f) => typeof f?.key === 'string' && f.key);
  if (files.length === 0) return c.json({ error: 'files required' }, 400);

  const maxRow = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM deliverable_files WHERE deliverable_id = ?',
  )
    .bind(id)
    .first<{ m: number }>();
  const start = (maxRow?.m ?? -1) + 1;

  await c.env.DB.batch(
    files.map((f, i) =>
      c.env.DB.prepare(
        `INSERT INTO deliverable_files
           (deliverable_id, r2_key, file_name, file_type, file_size, sort_order, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, String(f.key), String(f.name ?? ''), f.type ?? null, f.size ?? null, start + i, actor.sub),
    ),
  );
  return c.json({ ok: true }, 201);
});

/**
 * Багцыг ГАРГАНА.  Ижил чиглэлийн өмнөх ГАРСАН багцыг `superseded` болгоно —
 * хуучин хувилбарыг УСТГАХГҮЙ, зөвхөн «хуучирсан» гэж тэмдэглэнэ.
 */
clientAdmin.post('/deliverables/:id/issue', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  const actor = c.get('user');

  const head = await c.env.DB.prepare(
    'SELECT id, project_id, discipline, title, rev, status FROM project_deliverables WHERE id = ?',
  )
    .bind(id)
    .first<{
      id: number;
      project_id: number;
      discipline: string | null;
      title: string;
      rev: string;
      status: string;
    }>();
  if (!head) return c.json({ error: 'Not found' }, 404);
  if (head.status !== 'draft') return c.json({ error: 'Аль хэдийн гарсан' }, 409);

  const fileCount = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM deliverable_files WHERE deliverable_id = ?',
  )
    .bind(id)
    .first<{ n: number }>();
  if (!fileCount?.n) return c.json({ error: 'Файлгүй багцыг гаргах боломжгүй' }, 400);

  await c.env.DB.prepare(
    `UPDATE project_deliverables
        SET status = 'issued', issued_at = datetime('now'), issued_by = ?
      WHERE id = ? AND status = 'draft'`,
  )
    .bind(actor.sub, id)
    .run();

  // Ижил чиглэлийн өмнөх хувилбарууд хуучирлаа.
  if (head.discipline) {
    await c.env.DB.prepare(
      `UPDATE project_deliverables
          SET status = 'superseded'
        WHERE project_id = ? AND discipline = ? AND id <> ? AND status = 'issued'`,
    )
      .bind(head.project_id, head.discipline, id)
      .run();
  }

  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Нийтлэл                                                            */
/* ------------------------------------------------------------------ */

const PUBLISH_KINDS = new Set([
  'deliverable',
  'perf_report',
  'asr',
  'meeting_minutes',
  'document',
  'model',
  'notice',
]);

clientAdmin.get('/projects/:id/publications', requireManager(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const { results } = await c.env.DB.prepare(
    `SELECT cp.*, u.full_name AS published_by_name
       FROM client_publications cp
       LEFT JOIN users u ON u.id = cp.published_by
      WHERE cp.project_id = ?
      ORDER BY cp.unpublished_at IS NOT NULL, cp.published_at DESC`,
  )
    .bind(projectId)
    .all();
  return c.json({ publications: results });
});

clientAdmin.post('/projects/:id/publications', requireManager(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const actor = c.get('user');
  const body = await c.req.json<{
    kind?: string;
    ref_id?: number;
    title_mn?: string;
    note?: string | null;
  }>();

  const kind = String(body.kind ?? '');
  if (!PUBLISH_KINDS.has(kind)) return c.json({ error: 'Invalid kind' }, 400);

  // «Зарлал» нь эх мөргүй тул `ref_id` байхгүй.  ГЭХДЭЭ хүснэгт дээр
  // UNIQUE(project_id, kind, ref_id) байгаа тул тогтмол 0 өгвөл ХОЁР ДАХЬ
  // зарлал эхнийхээ ДАРНА.  Тиймээс зарлал бүрд дараагийн дугаар олгоно.
  let refId: number;
  if (kind === 'notice') {
    const maxRow = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(ref_id), 0) AS m FROM client_publications
        WHERE project_id = ? AND kind = 'notice'`,
    )
      .bind(projectId)
      .first<{ m: number }>();
    refId = (maxRow?.m ?? 0) + 1;
  } else {
    refId = Number(body.ref_id);
  }
  if (!Number.isFinite(refId)) return c.json({ error: 'ref_id required' }, 400);
  const title = (body.title_mn ?? '').trim();
  if (!title) return c.json({ error: 'Гарчиг заавал' }, 400);

  // Ноорог зүйлийг нийтлэхийг эх сурвалж дээр нь хаана — UI-д итгэхгүй.
  if (kind === 'deliverable') {
    const d = await c.env.DB.prepare(
      'SELECT status FROM project_deliverables WHERE id = ? AND project_id = ?',
    )
      .bind(refId, projectId)
      .first<{ status: string }>();
    if (!d) return c.json({ error: 'Багц олдсонгүй' }, 404);
    if (d.status === 'draft') return c.json({ error: 'Эхлээд багцыг гаргана уу' }, 400);
  }
  if (kind === 'perf_report') {
    const r = await c.env.DB.prepare(
      'SELECT status FROM project_performance_reports WHERE id = ? AND project_id = ?',
    )
      .bind(refId, projectId)
      .first<{ status: string }>();
    if (!r) return c.json({ error: 'Тайлан олдсонгүй' }, 404);
    if (r.status !== 'issued') return c.json({ error: 'Зөвхөн гаргасан тайланг нийтэлнэ' }, 400);
  }

  await c.env.DB.prepare(
    `INSERT INTO client_publications (project_id, kind, ref_id, title_mn, note, published_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, kind, ref_id)
     DO UPDATE SET title_mn = excluded.title_mn,
                   note = excluded.note,
                   published_by = excluded.published_by,
                   published_at = datetime('now'),
                   unpublished_at = NULL`,
  )
    .bind(projectId, kind, refId, title, (body.note ?? '') || null, actor.sub)
    .run();

  const EVENT_KIND: Record<string, 'deliverable' | 'report' | 'asr' | 'document' | 'notice'> = {
    deliverable: 'deliverable',
    perf_report: 'report',
    asr: 'asr',
    document: 'document',
  };
  await emitClientEvent(c.env, projectId, EVENT_KIND[kind] ?? 'notice', title, refId, actor.sub);
  await notifyProjectClients(
    c.env,
    projectId,
    'client_publication',
    'Шинэ материал нийтлэгдлээ',
    title,
    '/client',
  );

  return c.json({ ok: true }, 201);
});

clientAdmin.delete('/publications/:id', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare(
    "UPDATE client_publications SET unpublished_at = datetime('now') WHERE id = ?",
  )
    .bind(id)
    .run();
  return c.json({ ok: true });
});

/**
 * Батлагдсан ЗХ (ASR) тайланг захиалагчид нийтлэх.
 *
 * ⚠️ ЯАГААД PDF-ийг АГШИНД НЬ ХАДГАЛДАГ ВЭ: `routes/authorSupervision.ts`-ийн
 *    толгойд «client БҮХ endpoint дээр 403» гэсэн ЗОРИУДЫН хил бичээстэй
 *    байдаг.  Түүнийг задлахын оронд PDF-ийг НИЙТЛЭХ МӨЧИД, НИЙТЛЭГЧ
 *    АДМИНЫ эрхээр рендерлээд хувийн bucket-д хадгална.  Ингэснээр:
 *      • ASR модулийн хаалт бүрэн бүтэн үлдэнэ,
 *      • захиалагчийн `role`-той хэвлэлтийн токен ХЭЗЭЭ Ч үүсэхгүй
 *        (тэр нь print хуудсанд ASR REST дуудлага хийлгэдэг тул 403 болно),
 *      • захиалагчийн гарт очсон хувилбар ХӨЛДӨНӨ — дараа нь тайлан
 *        засагдсан ч тэдний татсан баримт өөрчлөгдөхгүй.
 *
 * Хадгалалт нь ЭНГИЙН БАГЦ (`project_deliverables`) хэлбэрээр — тусдаа
 * схем нэмэхгүйгээр татах зам, эрх, нийтлэл бүгд дахин ашиглагдана.
 */
clientAdmin.post('/projects/:id/publish-asr/:asrId', requireAdmin(), async (c) => {
  const projectId = Number(c.req.param('id'));
  const asrId = Number(c.req.param('asrId'));
  const actor = c.get('user');
  if (!Number.isFinite(projectId) || !Number.isFinite(asrId)) {
    return c.json({ error: 'Invalid id' }, 400);
  }

  const asr = await c.env.DB.prepare(
    `SELECT id, project_id, status, doc_no, report_date
       FROM author_supervision_reports WHERE id = ?`,
  )
    .bind(asrId)
    .first<{
      id: number;
      project_id: number;
      status: string;
      doc_no: string | null;
      report_date: string;
    }>();
  if (!asr || asr.project_id !== projectId) return c.json({ error: 'Not found' }, 404);
  if (asr.status !== 'approved') {
    return c.json({ error: 'Зөвхөн БАТЛАГДСАН тайланг нийтэлнэ' }, 400);
  }

  const label = `ЗХ тайлан ${asr.doc_no ?? `#${asr.id}`}`;

  const already = await c.env.DB.prepare(
    `SELECT id FROM project_deliverables
      WHERE project_id = ? AND note = ? AND status <> 'draft'`,
  )
    .bind(projectId, `asr:${asrId}`)
    .first<{ id: number }>();
  if (already) return c.json({ error: 'Аль хэдийн нийтлэгдсэн', deliverable_id: already.id }, 409);

  // Өөрийнхөө worker руу — нийтлэгч админы эрхээр.
  const origin = new URL(c.req.url).origin;
  const headers = new Headers();
  const auth = c.req.header('Authorization');
  if (auth) headers.set('Authorization', auth);
  const cookie = c.req.header('Cookie');
  if (cookie) headers.set('Cookie', cookie);

  let pdf: ArrayBuffer;
  try {
    const res = await fetch(`${origin}/api/author-supervision/${asrId}/pdf`, { headers });
    if (!res.ok) {
      return c.json({ error: 'PDF үүсгэж чадсангүй', status: res.status }, 502);
    }
    pdf = await res.arrayBuffer();
  } catch (err) {
    console.error('[publish-asr] pdf fetch failed', err);
    return c.json({ error: 'PDF үүсгэж чадсангүй' }, 502);
  }

  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const fileName = `${(asr.doc_no ?? `DASR-${asr.id}`).replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`;
  const key = `client/${actor.sub}-${Date.now()}-${rand}-${fileName}`;
  await c.env.MEETING_BUCKET.put(key, pdf, {
    httpMetadata: { contentType: 'application/pdf' },
    customMetadata: { uploadedBy: String(actor.sub), asrId: String(asrId) },
  });

  const deliverable = await c.env.DB.prepare(
    `INSERT INTO project_deliverables
       (project_id, discipline, title, rev, note, status, issued_at, issued_by, created_by)
     VALUES (?, NULL, ?, ?, ?, 'issued', datetime('now'), ?, ?)
     RETURNING id`,
  )
    .bind(projectId, label, asr.doc_no ?? '0', `asr:${asrId}`, actor.sub, actor.sub)
    .first<{ id: number }>();
  if (!deliverable) return c.json({ error: 'Хадгалж чадсангүй' }, 500);

  await c.env.DB.prepare(
    `INSERT INTO deliverable_files
       (deliverable_id, r2_key, file_name, file_type, file_size, sort_order, uploaded_by)
     VALUES (?, ?, ?, 'application/pdf', ?, 0, ?)`,
  )
    .bind(deliverable.id, key, fileName, pdf.byteLength, actor.sub)
    .run();

  await c.env.DB.prepare(
    `INSERT INTO client_publications (project_id, kind, ref_id, title_mn, note, published_by)
     VALUES (?, 'deliverable', ?, ?, ?, ?)
     ON CONFLICT(project_id, kind, ref_id)
     DO UPDATE SET unpublished_at = NULL, published_at = datetime('now')`,
  )
    .bind(projectId, deliverable.id, label, `asr:${asrId}`, actor.sub)
    .run();

  await emitClientEvent(c.env, projectId, 'asr', label, deliverable.id, actor.sub);
  await notifyProjectClients(
    c.env,
    projectId,
    'client_publication',
    'Зохиогчийн хяналтын тайлан нийтлэгдлээ',
    label,
    '/client',
  );

  return c.json({ deliverable_id: deliverable.id }, 201);
});

/* ------------------------------------------------------------------ */
/*  Ирсэн материалын шалгалт                                           */
/* ------------------------------------------------------------------ */

clientAdmin.get('/submissions', requireManager(), async (c) => {
  const status = c.req.query('status');
  const projectId = Number(c.req.query('project_id'));

  const where: string[] = [];
  const binds: unknown[] = [];
  if (status && ['submitted', 'accepted', 'rejected'].includes(status)) {
    where.push('s.status = ?');
    binds.push(status);
  }
  if (Number.isFinite(projectId)) {
    where.push('s.project_id = ?');
    binds.push(projectId);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.project_id, s.ref_no, s.title, s.status, s.submitted_at,
            s.reviewed_at, s.review_note, s.fields_json,
            p.name AS project_name, t.name_mn AS template_name,
            u.full_name AS submitted_by_name, o.name AS org_name,
            (SELECT COUNT(*) FROM client_submission_files f WHERE f.submission_id = s.id) AS file_count
       FROM client_submissions s
       JOIN projects p ON p.id = s.project_id
       JOIN client_submission_templates t ON t.id = s.template_id
       LEFT JOIN users u ON u.id = s.submitted_by
       LEFT JOIN client_orgs o ON o.id = s.org_id
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY s.status = 'submitted' DESC, s.id DESC
      LIMIT 200`,
  )
    .bind(...binds)
    .all();

  return c.json({ submissions: results });
});

type AdminContext = Context<{ Bindings: Env; Variables: AppVariables }>;

async function reviewSubmission(
  c: AdminContext,
  decision: 'accepted' | 'rejected',
): Promise<Response> {
  const id = Number(c.req.param('id'));
  const actor = c.get('user');
  const body = await c.req
    .json<{ review_note?: string }>()
    .catch(() => ({}) as { review_note?: string });
  const note = (body.review_note ?? '').trim();
  if (decision === 'rejected' && !note) {
    return c.json({ error: 'Буцаах шалтгаанаа бичнэ үү' }, 400);
  }

  const head = await c.env.DB.prepare(
    `SELECT s.id, s.project_id, s.ref_no, s.title, s.status, s.submitted_by,
            p.client_intake_archive_id AS intake_archive_id,
            p.client_intake_folder_id  AS intake_folder_id
       FROM client_submissions s
       JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<{
      id: number;
      project_id: number;
      ref_no: string;
      title: string;
      status: string;
      submitted_by: number;
      intake_archive_id: number | null;
      intake_folder_id: number | null;
    }>();
  if (!head) return c.json({ error: 'Not found' }, 404);
  if (head.status !== 'submitted') return c.json({ error: 'Аль хэдийн шийдэгдсэн' }, 409);

  const res = await c.env.DB.prepare(
    `UPDATE client_submissions
        SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ?
      WHERE id = ? AND status = 'submitted'`,
  )
    .bind(decision, actor.sub, note || null, id)
    .run();
  // `progress.ts`-ийн батлах уралдааны хамгаалалттай ижил заль.
  if (res.meta.changes === 0) return c.json({ error: 'Аль хэдийн шийдэгдсэн' }, 409);

  /*
   * Хүлээн авмагц АРХИВТ АВТОМАТААР хуулна (эзний шийдвэр, 2026-09-08).
   *
   * ⚠️ Уралдааны хамгаалалтын ДАРАА байрлана — `changes === 0` замаар
   *    буцсан хоёр дахь дуудлага давхар хуулбар үүсгэхгүй.  «Нэг удаа
   *    хүлээн авна ⇒ нэг удаа хуулна» гэдгийг тэр шалгалт л барина.
   *
   * ⚠️ ХУУЛАЛТ УНАСАН Ч ХҮЛЭЭН АВАХ НЬ ХҮЧИНТЭЙ ХЭВЭЭР.  Шийдвэр аль
   *    хэдийн бичигдсэн бөгөөд D1 дээр route бүхэлдээ гүйлгээнд ОРДОГГҮЙ
   *    тул буцаах боломжгүй.  Архивын алдаанаас болж 5xx буцаавал админ
   *    дахин дарж 409 авна — материал хүлээн авагдсан мөртлөө UI нь
   *    алдаа харуулна.  Тиймээс `archived` тугийг хариунд буцааж, UI
   *    «архивт хуулагдсангүй» гэдгийг тусад нь мэдэгдэнэ.
   */
  let archived: number | null = null;
  if (decision === 'accepted' && head.intake_archive_id !== null) {
    try {
      archived = await copySubmissionToArchive(
        c.env.DB,
        head.id,
        head.intake_archive_id,
        head.intake_folder_id,
        actor.sub,
      );
    } catch (err) {
      console.warn('[client-admin] автомат архивлалт унасан', err);
    }
  }

  await emitClientEvent(
    c.env,
    head.project_id,
    'submission_reviewed',
    `${head.title} — ${decision === 'accepted' ? 'хүлээн авлаа' : 'буцаалаа'}`,
    head.id,
    actor.sub,
  );
  await notifyProjectClients(
    c.env,
    head.project_id,
    'client_submission_reviewed',
    decision === 'accepted' ? 'Материал хүлээн авлаа' : 'Материал буцаагдлаа',
    `${head.title} (${head.ref_no})${note ? ` — ${note}` : ''}`,
    '/client',
  );

  return c.json({ ok: true, archived });
}

clientAdmin.post('/submissions/:id/accept', requireManager(), (c) => reviewSubmission(c, 'accepted'));
clientAdmin.post('/submissions/:id/reject', requireManager(), (c) => reviewSubmission(c, 'rejected'));

/**
 * Хүлээн авсан материалын файлуудыг архивын мөр болгон хуулна.
 *
 * ⚠️ БАЙТЫГ ХӨДӨЛГӨХГҮЙ.  `document_revisions.file_url` нь ХУВИЙН
 *    bucket дахь файлыг заасан `/api/client-files/submission/:id` нэвтрэлт
 *    шаарддаг замыг хадгална — `/media` руу хуулбал захиалагчийн гэрээ,
 *    даалгавар нэвтрэлтгүй нийтэд ил болно (CLAUDE.md-ийн аюулгүй
 *    байдлын #2).
 *
 * Буцаах утга нь хуулагдсан файлын тоо.  Зорилтот архив байхгүй/устсан бол
 * `null` — дуудагч талд «тохируулаагүй» ба «хуулагдсан» хоёрыг ялгах
 * боломж өгнө.
 */
async function copySubmissionToArchive(
  db: D1Database,
  submissionId: number,
  archiveId: number,
  folderId: number | null,
  actorId: number,
): Promise<number | null> {
  // Устгагдсан архив руу заасан хуучин тохиргоо нь ХООСОН баримт
  // үүсгэхийн оронд чимээгүй унах ёстой — 0267-ийн толгойд бичсэн шалтгаан
  // (D1 нь ажиллах үедээ `ON DELETE SET NULL`-ыг хэрэгжүүлдэггүй).
  const archive = await db
    .prepare('SELECT id FROM document_archives WHERE id = ? AND deleted_at IS NULL')
    .bind(archiveId)
    .first<{ id: number }>();
  if (!archive) return null;

  // Хавтас нь өөр архивынх болсон/устсан бол архивын ҮНДЭС рүү хуулна.
  // Хуулахаа болих нь материалыг алдахтай адил тул энд fail-open зөв.
  let targetFolder: number | null = null;
  if (folderId !== null) {
    const folder = await db
      .prepare(
        `SELECT id FROM document_folders
          WHERE id = ? AND archive_id = ? AND deleted_at IS NULL`,
      )
      .bind(folderId, archiveId)
      .first<{ id: number }>();
    targetFolder = folder ? folder.id : null;
  }

  const { results: files } = await db
    .prepare(
      'SELECT id, canonical_name FROM client_submission_files WHERE submission_id = ? ORDER BY sort_order',
    )
    .bind(submissionId)
    .all<{ id: number; canonical_name: string }>();

  let copied = 0;
  for (const f of files) {
    const doc = await db
      .prepare(
        `INSERT INTO documents (archive_id, folder_id, title, created_by)
         VALUES (?, ?, ?, ?) RETURNING id`,
      )
      .bind(archiveId, targetFolder, f.canonical_name, actorId)
      .first<{ id: number }>();
    if (!doc) continue;
    await db
      .prepare(
        `INSERT INTO document_revisions
           (document_id, revision_number, file_url, file_name, uploaded_by)
         VALUES (?, 1, ?, ?, ?)`,
      )
      .bind(doc.id, `/api/client-files/submission/${f.id}`, f.canonical_name, actorId)
      .run();
    copied += 1;
  }

  return copied;
}

/**
 * Хүлээн авсан материалыг архивт ГАРААР хуулна.
 *
 * `reviewSubmission` нь төсөлд зорилтот архив тохируулагдсан үед үүнийг
 * АВТОМАТААР хийдэг (эзний шийдвэр, 2026-09-08).  Энэ гарц нь хоёр
 * тохиолдолд үлдэнэ: зорилтот цэг тохируулаагүй төсөл, болон өөр архив
 * руу нэмж хуулах хэрэгцээ.  Тиймээс `archived_at` шалгаад давхар
 * хуулахаас сэргийлнэ.
 */
clientAdmin.post('/submissions/:id/archive', requireManager(), async (c) => {
  const id = Number(c.req.param('id'));
  const actor = c.get('user');
  const body = await c.req.json<{ archive_id?: number; folder_id?: number | null }>();
  const archiveId = Number(body.archive_id);
  if (!Number.isFinite(archiveId)) return c.json({ error: 'archive_id required' }, 400);

  const head = await c.env.DB.prepare(
    'SELECT id, title, status FROM client_submissions WHERE id = ?',
  )
    .bind(id)
    .first<{ id: number; title: string; status: string }>();
  if (!head) return c.json({ error: 'Not found' }, 404);
  if (head.status !== 'accepted') {
    return c.json({ error: 'Эхлээд хүлээн авна уу' }, 400);
  }

  const copied = await copySubmissionToArchive(
    c.env.DB,
    id,
    archiveId,
    body.folder_id ?? null,
    actor.sub,
  );
  if (copied === null) return c.json({ error: 'Архив олдсонгүй' }, 404);

  return c.json({ copied });
});

export default clientAdmin;
