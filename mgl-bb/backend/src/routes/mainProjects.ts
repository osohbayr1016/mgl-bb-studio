/* =============================================================
 * Үндсэн төсөл (main project) — /api/main-projects (2026-09-11, migration 0281)
 * -------------------------------------------------------------
 * Бодит төсөл = `main_projects` мөр; `projects`-ын ангиллын мөрүүд (AZ/ZA/…)
 * түүнд `main_project_id`-аар харьяалагдана.  Баримт бичгийн Drive хавтас
 * ҮНДСЭН ТӨСӨЛ дээр холбогдоно; ангиллын төсөл бүрийн «Баримт бичиг» таб
 * тэр нэг хавтсыг харна (lib/projectDrive.ts loadProjectDriveRoot).
 *
 *   GET    /                    staff   бүх үндсэн төсөл + гишүүд (+ админд харьяалалгүй төслүүд)
 *   POST   /                    admin   { name, code?, project_ids? }
 *   POST   /auto-group          admin   нэрний «MGL-yymmdd» кодоор автоматаар бүлэглэнэ
 *   PUT    /assign              admin   { project_id, main_project_id | null }
 *   GET    /drive-root          admin   Drive-ийн үндсэн хавтас + алгассан хавтсууд + сүүлийн илрүүлэлт
 *   PUT    /drive-root          admin   { folder: string | null } — холбоод тэр даруй илрүүлнэ
 *   POST   /drive-root/sync     admin   одоо илрүүлэх (cron-ыг хүлээхгүй)
 *   DELETE /drive-root/ignored/:folderId  admin   алгасахаас гаргаж дахин илрүүлнэ
 *   PUT    /:id                 admin   { name?, code?, project_ids? }  (project_ids = бүх гишүүд)
 *   DELETE /:id                 admin   гишүүдийг чөлөөлж устгана (D1 FK-г runtime-д шалгадаггүй);
 *                                       хавтас нь «алгасах» жагсаалтад орно (дахин автоматаар үүсэхгүй)
 *   PUT    /:id/drive-folder    admin   ┐
 *   GET    /:id/drive                   │ routes/projectDrive.ts-ийн mountDriveBrowse —
 *   GET    /:id/drive/folders/:folderId │ ангиллын төслийн замтай ЯГ ижил handler,
 *   GET    /:id/drive/files/:fileId/*   ┘ үндэс нь main_projects.google_drive_folder_id
 *
 * Эрх: staff бүх үндсэн төсөл; `client` нь `clientScope.ts`-ийн цагаан жагсаалтад
 * БАЙХГҮЙ тул 403 (портал компанийн ажлын хавтас хардаггүй); `worker` workerScope-оор хаалттай.
 * ============================================================= */
import { Hono } from 'hono';
import { requireAdmin } from '../middleware/auth';
import type { Env, AppVariables } from '../types';
import type { Context } from 'hono';
import { driveBrowseConfigured, driveBrowseServiceEmail } from '../lib/google/driveBrowse';
import {
  groupingKey,
  loadMainProjects,
  parseProjectName,
  suggestMainProjectName,
  type MemberProjectRow,
} from '../lib/mainProjects';
import { loadMainProjectDriveRoot } from '../lib/projectDrive';
import { invalidateDriveListing } from '../lib/projectDriveAccess';
import {
  discoverProjectFolders,
  ignoreDiscoveredFolder,
  loadCompanyRoot,
  loadDiscoveryLast,
  loadIgnored,
  saveCompanyRoot,
  unignoreDiscoveredFolder,
  type DiscoveryResult,
} from '../lib/projectDriveDiscovery';
import { DRIVE_ROLES, driveErrorResponse, mountDriveBrowse, noStore, verifyFolderInput } from './projectDrive';
import { mountDriveSigning } from './driveSigning';
import { makeDriveSignIo } from '../lib/driveSigningIo';

const mainProjects = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function memberView(p: MemberProjectRow) {
  return {
    id: p.id,
    name: p.name,
    display_title: p.display_title,
    category: p.category,
    status: p.status,
    is_pending: p.is_pending,
    own_folder_id: p.google_drive_folder_id,
  };
}

/** Гишүүн төслийн id жагсаалтыг ариутгана — зөвхөн бүхэл эерэг тоо, давхардалгүй. */
function cleanIds(raw: unknown): number[] | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return [];
  const out = new Set<number>();
  for (const v of raw) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return [...out];
}

/** Гишүүнчлэлийг БҮХЛЭЭР нь солино: хуучин гишүүдийг чөлөөлж, шинийг оноох. */
async function replaceMembers(db: D1Database, mainId: number, projectIds: number[]): Promise<void> {
  const stmts = [
    db.prepare(`UPDATE projects SET main_project_id = NULL WHERE main_project_id = ?`).bind(mainId),
  ];
  for (const pid of projectIds) {
    stmts.push(db.prepare(`UPDATE projects SET main_project_id = ? WHERE id = ?`).bind(mainId, pid));
  }
  await db.batch(stmts);
}

/* ------------------------------------------------------------------ */
/*  Жагсаалт                                                           */
/* ------------------------------------------------------------------ */

// GET /api/main-projects
mainProjects.get('/', async (c) => {
  noStore(c);
  const user = c.get('user');
  // 2026-09-24: «Баримт бичиг» бүх ажилтанд (routes/projectDrive.ts DRIVE_ROLES).
  if (!DRIVE_ROLES.has(user.role)) return c.json({ error: 'Access denied', code: 'FORBIDDEN' }, 403);
  const seesPending = user.role === 'admin' || user.role === 'senior';
  const { mains, members } = await loadMainProjects(c.env.DB, { seesPending });

  const byMain = new Map<number, ReturnType<typeof memberView>[]>();
  const unassigned: ReturnType<typeof memberView>[] = [];
  const standalone: ReturnType<typeof memberView>[] = [];
  for (const p of members) {
    if (p.main_project_id != null) {
      const list = byMain.get(p.main_project_id) ?? [];
      list.push(memberView(p));
      byMain.set(p.main_project_id, list);
    } else {
      unassigned.push(memberView(p));
      // Үндсэн төсөлгүй ч өөрийн хавтастай — Documents хуудсанд тусдаа карт.
      if (p.google_drive_folder_id) standalone.push(memberView(p));
    }
  }
  return c.json({
    configured: driveBrowseConfigured(c.env),
    main_projects: mains.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      folder_id: m.google_drive_folder_id,
      folder_name: m.google_drive_folder_name,
      created_at: m.created_at,
      updated_at: m.updated_at,
      members: byMain.get(m.id) ?? [],
    })),
    standalone,
    /** Зөвхөн админд — үндсэн төсөлд харьяалагдаагүй ангиллын төслүүд. */
    unassigned: user.role === 'admin' ? unassigned : null,
  });
});

/* ------------------------------------------------------------------ */
/*  Drive-ийн үндсэн хавтас — шинэ төслийн хавтсыг автоматаар нэмэх    */
/*  (2026-09-24, lib/projectDriveDiscovery.ts).  `/:id`-ээс ДЭЭР.       */
/* ------------------------------------------------------------------ */

type MainCtx = Context<{ Bindings: Env; Variables: AppVariables }>;

async function driveRootView(c: MainCtx) {
  const db = c.env.DB;
  const [root, ignored, last] = await Promise.all([loadCompanyRoot(db), loadIgnored(db), loadDiscoveryLast(db)]);
  return {
    configured: driveBrowseConfigured(c.env),
    service_email: driveBrowseServiceEmail(c.env),
    root: root ? { ...root, open_url: `https://drive.google.com/drive/folders/${root.id}` } : null,
    ignored,
    last,
  };
}

/** Илрүүлэлт + хариу.  Drive-ийн алдааг хэрэглэгчид кодтой нь буцаана. */
async function discoverAndRespond(c: MainCtx, where: string): Promise<Response> {
  let found: DiscoveryResult;
  try {
    found = await discoverProjectFolders(c.env);
  } catch (err) {
    return driveErrorResponse(c, err, where);
  }
  return c.json({ ...(await driveRootView(c)), created: found.created, renamed: found.renamed });
}

// GET /api/main-projects/drive-root
mainProjects.get('/drive-root', requireAdmin(), async (c) => {
  noStore(c);
  return c.json(await driveRootView(c));
});

// PUT /api/main-projects/drive-root  { folder: string | null }
mainProjects.put('/drive-root', requireAdmin(), async (c) => {
  noStore(c);
  const body = await c.req.json<{ folder?: string | null }>().catch(() => ({}) as { folder?: string | null });
  const raw = body.folder;
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    await saveCompanyRoot(c.env.DB, null);
    return c.json({ ...(await driveRootView(c)), created: [], renamed: 0 });
  }
  const verified = await verifyFolderInput(c, String(raw), 'company-root');
  if (!verified.ok) return verified.response;
  const { entry } = verified;
  // Төслийн хавтсыг андуурч үндсэн хавтас болговол түүний 00–12 дэд хавтас
  // бүр үндсэн төсөл болно — тиймээс татгалзана.
  const clash = await c.env.DB.prepare(
    `SELECT 1 AS x FROM main_projects WHERE google_drive_folder_id = ?
     UNION ALL SELECT 1 FROM projects WHERE google_drive_folder_id = ? LIMIT 1`,
  )
    .bind(entry.id, entry.id)
    .first();
  if (clash) {
    return c.json(
      { error: 'Энэ хавтас аль нэг төслийн хавтас байна — бүх төслийн хавтсыг агуулсан том хавтсыг холбоно уу', code: 'ROOT_IS_PROJECT_FOLDER' },
      409,
    );
  }
  await saveCompanyRoot(c.env.DB, { id: entry.id, name: entry.name });
  return discoverAndRespond(c, 'company-root link');
});

// POST /api/main-projects/drive-root/sync
mainProjects.post('/drive-root/sync', requireAdmin(), async (c) => {
  noStore(c);
  return discoverAndRespond(c, 'company-root sync');
});

// DELETE /api/main-projects/drive-root/ignored/:folderId — «буцааж нэмэх»
mainProjects.delete('/drive-root/ignored/:folderId', requireAdmin(), async (c) => {
  noStore(c);
  await unignoreDiscoveredFolder(c.env.DB, c.req.param('folderId'));
  return discoverAndRespond(c, 'company-root restore');
});

/* ------------------------------------------------------------------ */
/*  Үүсгэх / автомат бүлэглэх / оноох                                  */
/* ------------------------------------------------------------------ */

// POST /api/main-projects  { name, code?, project_ids? }
mainProjects.post('/', requireAdmin(), async (c) => {
  noStore(c);
  const body = await c.req
    .json<{ name?: string; code?: string | null; project_ids?: number[] }>()
    .catch(() => ({}) as { name?: string; code?: string | null; project_ids?: number[] });
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'Нэр шаардлагатай', code: 'NAME_REQUIRED' }, 400);
  const code = body.code?.trim().toUpperCase() || null;
  const ids = cleanIds(body.project_ids) ?? [];

  const res = await c.env.DB.prepare(
    `INSERT INTO main_projects (code, name, created_by) VALUES (?, ?, ?)`,
  )
    .bind(code, name, c.get('user').sub)
    .run();
  const id = Number(res.meta.last_row_id);
  if (ids.length > 0) await replaceMembers(c.env.DB, id, ids);
  return c.json({ id, code, name, member_ids: ids }, 201);
});

// POST /api/main-projects/auto-group
// Харьяалалгүй ангиллын төслүүдийг нэрний «MGL-yymmdd» кодоор бүлэглэж, код
// бүрд үндсэн төсөл үүсгэнэ (ижил кодтой үндсэн төсөл байвал түүнд оноено).
// Гишүүний өөрийн Drive хавтас байвал үндсэн төсөлд өвлүүлнэ (үндсэнд байхгүй
// үед л).  Идемпотент — зөвхөн харьяалалгүйг хөндөнө.
mainProjects.post('/auto-group', requireAdmin(), async (c) => {
  noStore(c);
  const db = c.env.DB;
  const { mains, members } = await loadMainProjects(db, { seesPending: true });
  const mainByCode = new Map<string, (typeof mains)[number]>();
  for (const m of mains) if (m.code) mainByCode.set(m.code.toUpperCase(), m);

  const groups = new Map<string, MemberProjectRow[]>();
  for (const p of members) {
    if (p.main_project_id != null) continue;
    const key = groupingKey(parseProjectName(p.name));
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  let created = 0;
  let assigned = 0;
  const createdNames: string[] = [];
  for (const [key, list] of groups) {
    const parsed = parseProjectName(list[0]!.name);
    let mainId: number;
    let mainHasFolder = false;
    const existing = parsed.code ? mainByCode.get(parsed.code) : undefined;
    if (existing) {
      mainId = existing.id;
      mainHasFolder = Boolean(existing.google_drive_folder_id);
    } else {
      // Нэр: гишүүдийн дунд хамгийн олон давтагдсан суурь нэр (ихэвчлэн бүгд ижил).
      const freq = new Map<string, number>();
      for (const p of list) {
        const b = parseProjectName(p.name).base;
        if (b) freq.set(b, (freq.get(b) ?? 0) + 1);
      }
      const base = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? '';
      const name = suggestMainProjectName({ code: parsed.code, base, category: null }) || key;
      const res = await db
        .prepare(`INSERT INTO main_projects (code, name, created_by) VALUES (?, ?, ?)`)
        .bind(parsed.code, name, c.get('user').sub)
        .run();
      mainId = Number(res.meta.last_row_id);
      created++;
      createdNames.push(name);
    }
    const stmts = list.map((p) =>
      db.prepare(`UPDATE projects SET main_project_id = ? WHERE id = ? AND main_project_id IS NULL`).bind(mainId, p.id),
    );
    // Гишүүний өөрийн хавтсыг үндсэн төсөлд өвлүүлнэ (үндсэнд байхгүй бол).
    const withFolder = list.find((p) => p.google_drive_folder_id);
    if (!mainHasFolder && withFolder) {
      stmts.push(
        db
          .prepare(
            `UPDATE main_projects SET google_drive_folder_id = ?, google_drive_folder_name = ?, updated_at = datetime('now')
              WHERE id = ? AND google_drive_folder_id IS NULL`,
          )
          .bind(withFolder.google_drive_folder_id, withFolder.google_drive_folder_name, mainId),
      );
    }
    await db.batch(stmts);
    assigned += list.length;
  }
  return c.json({ created, assigned, created_names: createdNames });
});

// PUT /api/main-projects/assign  { project_id, main_project_id | null }
mainProjects.put('/assign', requireAdmin(), async (c) => {
  noStore(c);
  const body = await c.req
    .json<{ project_id?: number; main_project_id?: number | null }>()
    .catch(() => ({}) as { project_id?: number; main_project_id?: number | null });
  const pid = Number(body.project_id);
  if (!Number.isInteger(pid) || pid <= 0) return c.json({ error: 'project_id шаардлагатай', code: 'INVALID_ID' }, 400);
  const mid = body.main_project_id == null ? null : Number(body.main_project_id);
  if (mid !== null) {
    const exists = await c.env.DB.prepare(`SELECT id FROM main_projects WHERE id = ?`).bind(mid).first();
    if (!exists) return c.json({ error: 'Үндсэн төсөл олдсонгүй', code: 'NOT_FOUND' }, 404);
  }
  const res = await c.env.DB.prepare(`UPDATE projects SET main_project_id = ? WHERE id = ?`).bind(mid, pid).run();
  if (!res.meta.changes) return c.json({ error: 'Project not found', code: 'PROJECT_NOT_FOUND' }, 404);
  return c.json({ project_id: pid, main_project_id: mid });
});

/* ------------------------------------------------------------------ */
/*  Засах / устгах                                                     */
/* ------------------------------------------------------------------ */

// PUT /api/main-projects/:id  { name?, code?, project_ids? }
mainProjects.put('/:id', requireAdmin(), async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const body = await c.req
    .json<{ name?: string; code?: string | null; project_ids?: number[] }>()
    .catch(() => ({}) as { name?: string; code?: string | null; project_ids?: number[] });
  const exists = await c.env.DB.prepare(`SELECT id FROM main_projects WHERE id = ?`).bind(id).first();
  if (!exists) return c.json({ error: 'Үндсэн төсөл олдсонгүй', code: 'NOT_FOUND' }, 404);

  const sets: string[] = [];
  const vals: (string | null)[] = [];
  if (body.name !== undefined) {
    const name = (body.name ?? '').trim();
    if (!name) return c.json({ error: 'Нэр хоосон байж болохгүй', code: 'NAME_REQUIRED' }, 400);
    sets.push('name = ?');
    vals.push(name);
  }
  if (body.code !== undefined) {
    sets.push('code = ?');
    vals.push(body.code?.trim().toUpperCase() || null);
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    await c.env.DB.prepare(`UPDATE main_projects SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...vals, id)
      .run();
  }
  const ids = cleanIds(body.project_ids);
  if (ids) await replaceMembers(c.env.DB, id, ids);
  return c.json({ message: 'ok' });
});

// DELETE /api/main-projects/:id — гишүүдийг чөлөөлж устгана.  Drive хавтас нь
// зөвхөн ХОЛБООС тул Drive дээр юу ч өөрчлөгдөхгүй.
mainProjects.delete('/:id', requireAdmin(), async (c) => {
  noStore(c);
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid id', code: 'INVALID_ID' }, 400);
  const row = await c.env.DB.prepare(
    `SELECT google_drive_folder_id, google_drive_folder_name, name FROM main_projects WHERE id = ?`,
  )
    .bind(id)
    .first<{ google_drive_folder_id: string | null; google_drive_folder_name: string | null; name: string }>();
  if (!row) return c.json({ error: 'Үндсэн төсөл олдсонгүй', code: 'NOT_FOUND' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE projects SET main_project_id = NULL WHERE main_project_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM main_projects WHERE id = ?`).bind(id),
  ]);
  if (row.google_drive_folder_id) {
    invalidateDriveListing(row.google_drive_folder_id);
    // Эс бөгөөс Drive-ийн үндсэн хавтаснаас дараагийн тик дахин үүсгэнэ.
    await ignoreDiscoveredFolder(c.env.DB, {
      id: row.google_drive_folder_id,
      name: row.google_drive_folder_name ?? row.name,
    });
  }
  return c.json({ message: 'ok' });
});

/* ------------------------------------------------------------------ */
/*  Drive үзэх / холбох — ангиллын төсөлтэй ижил handler-ууд          */
/* ------------------------------------------------------------------ */

mountDriveBrowse(mainProjects, {
  label: 'main',
  resolveRoot: loadMainProjectDriveRoot,
  writeFolder: async (db, root, folder) => {
    await db
      .prepare(
        `UPDATE main_projects
            SET google_drive_folder_id = ?, google_drive_folder_name = ?, updated_at = datetime('now')
          WHERE id = ?`,
      )
      .bind(folder?.id ?? null, folder?.name ?? null, root.project_id)
      .run();
    return 'main';
  },
});

// Word баримтын гарын үсэг + захирлын баталгаажуулалт — ангиллын төсөлтэй ижил handler.
mountDriveSigning(mainProjects, {
  label: 'main',
  resolveRoot: loadMainProjectDriveRoot,
  io: makeDriveSignIo(driveErrorResponse),
});

export default mainProjects;
