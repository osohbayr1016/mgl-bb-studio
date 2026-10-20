/**
 * Зохиогчийн хяналтын ХУВААРЬ — маршрутууд (`/api/author-supervision/plans*`).
 *
 * Эзний шийдвэр 2026-09-21: admin/senior урьдчилан төлөвлөнө (төсөл + огноо
 * + сонголттой цаг + явах хүмүүс + тэмдэглэл), сонгогдсон хүн бүрд одоо
 * байгаа мэдэгдлийн системээр (`notifications` + push) «тэдэн сарын
 * тэдэнд энэ төсөл дээр зохиогчийн хяналтаар явна» гэсэн мэдэгдэл очно.
 *
 * ⚠️ Тайланг (`author_supervision_reports`) ХӨНДӨХГҮЙ — хуваарь бол тусдаа
 *    хүснэгт (миграц 0331), тайланг очсон хүн өмнөх шигээ өөрөө үүсгэнэ.
 *
 * Эрх:
 *   • Унших — ASR_ROLES (admin/engineer/architect/senior); `client` 403,
 *     `worker` `workerScope`-оор өмнө нь хаагдсан.
 *   • Бичих — `requireManager()` (admin + senior).  Ахлагч ямар ч төслийн
 *     хуваарь үүсгэнэ — `requireManager` бусад газарт ч төслийн
 *     гишүүнчлэл шалгадаггүй (CLAUDE.md «accepted blast radius»).
 *
 * Мэдэгдэл (бүгд best-effort, `lib/notify.ts`):
 *   • шинэ гишүүн            → `asr_visit_assigned`  (buildAssignedNotice)
 *   • огноо/цаг/төсөл/тэмдэглэл өөрчлөгдөхөд үлдсэн гишүүд
 *                            → `asr_visit_assigned`  (buildChangedNotice)
 *   • хасагдсан гишүүн / цуцлалт → `asr_visit_cancelled`
 *   Үйлдэл хийсэн хүн өөрөө хуваарьт байвал түүнд мэдэгдэл очихгүй
 *   (бусад модулийн `excludeUserId` конвенц).
 *
 * `asrTargets.ts`-ийн адил `registerAsrVisitPlanRoutes(router)` — `/:id`
 * маршрутуудаас ДЭЭР бүртгэгдэх ёстой, эс тэгвэл `/plans` нь `/:id`-д
 * баригдана.
 */
import type { Hono } from 'hono';
import { requireManager } from '../middleware/auth';
import { createNotification } from './notify';
import { todayInUB } from './time';
import { asrLabelSql, asrProjectName } from './asrProjectName';
import {
  buildAssignedNotice,
  buildCancelledNotice,
  buildChangedNotice,
  diffPlan,
  validatePlanInput,
  type AsrVisitPlanInput,
  type AsrVisitPlanStatus,
  type VisitNoticeContext,
} from './asrVisitPlan';
import type { Env, AppVariables } from '../types';

type App = Hono<{ Bindings: Env; Variables: AppVariables }>;

/** Хуваарьт орж болох дүр — ЗХ тайлан бичдэг дүрүүд (routes/authorSupervision.ts `ASR_ROLES`-ийн ихэр). */
const PLAN_MEMBER_ROLES = ['admin', 'engineer', 'architect', 'senior'] as const;

/** Нэг хүсэлтэд буцаах хуваарийн дээд тоо. */
const LIST_LIMIT = 200;

export interface AsrVisitPlanMember {
  user_id: number;
  full_name: string | null;
  profile_image: string | null;
  team_code: string | null;
  notified_at: string | null;
}

export interface AsrVisitPlanView {
  id: number;
  project_id: number;
  project_name: string;
  project_location: string | null;
  project_shifr: string | null;
  visit_date: string;
  visit_time: string | null;
  note: string | null;
  status: AsrVisitPlanStatus;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  members: AsrVisitPlanMember[];
}

interface PlanRow {
  id: number;
  project_id: number;
  project_name: string;
  project_location: string | null;
  project_shifr: string | null;
  visit_date: string;
  visit_time: string | null;
  note: string | null;
  status: AsrVisitPlanStatus;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

const PLAN_SELECT = `
  SELECT vp.id, vp.project_id, ${asrLabelSql('p')} AS project_name, p.location AS project_location,
         pp.drawing_no AS project_shifr,
         vp.visit_date, vp.visit_time, vp.note, vp.status,
         vp.created_by, cu.full_name AS created_by_name,
         vp.created_at, vp.updated_at, vp.cancelled_at
    FROM asr_visit_plans vp
    JOIN projects p ON p.id = vp.project_id
    LEFT JOIN project_passport pp ON pp.project_id = vp.project_id
    LEFT JOIN users cu ON cu.id = vp.created_by`;

const MEMBER_SELECT = `
  SELECT m.plan_id, m.user_id, u.full_name, u.profile_image, t.code AS team_code, m.notified_at
    FROM asr_visit_plan_members m
    LEFT JOIN users u ON u.id = m.user_id
    LEFT JOIN teams t ON t.id = u.team_id`;

/** D1-ийн 100 bind хязгаарын доор. */
const BIND_CHUNK = 90;

async function loadMembers(
  db: D1Database,
  planIds: number[],
): Promise<Map<number, AsrVisitPlanMember[]>> {
  const out = new Map<number, AsrVisitPlanMember[]>();
  for (let i = 0; i < planIds.length; i += BIND_CHUNK) {
    const chunk = planIds.slice(i, i + BIND_CHUNK);
    const { results } = await db
      .prepare(
        `${MEMBER_SELECT}
          WHERE m.plan_id IN (${chunk.map(() => '?').join(',')})
          ORDER BY m.plan_id, m.rowid`,
      )
      .bind(...chunk)
      .all<AsrVisitPlanMember & { plan_id: number }>();
    for (const r of results ?? []) {
      const list = out.get(r.plan_id) ?? [];
      list.push({
        user_id: r.user_id,
        full_name: r.full_name ?? null,
        profile_image: r.profile_image ?? null,
        team_code: r.team_code ?? null,
        notified_at: r.notified_at ?? null,
      });
      out.set(r.plan_id, list);
    }
  }
  return out;
}

function toView(row: PlanRow, members: AsrVisitPlanMember[]): AsrVisitPlanView {
  return { ...row, members };
}

async function loadPlan(db: D1Database, id: number): Promise<AsrVisitPlanView | null> {
  const row = await db.prepare(`${PLAN_SELECT} WHERE vp.id = ?`).bind(id).first<PlanRow>();
  if (!row) return null;
  const members = await loadMembers(db, [row.id]);
  return toView(row, members.get(row.id) ?? []);
}

/** Мөрийг `validatePlanInput`-ийн `base` хэлбэрт. */
function toInput(view: AsrVisitPlanView): AsrVisitPlanInput {
  return {
    project_id: view.project_id,
    visit_date: view.visit_date,
    visit_time: view.visit_time,
    note: view.note,
    user_ids: view.members.map((m) => m.user_id),
  };
}

/**
 * Сонгосон хүмүүс бүгд идэвхтэй, ЗХ-д явж болох дүртэй эсэх.  Буцаах нь
 * id → нэр (мэдэгдлийн «Хамт явах» мөрөнд).
 */
async function checkMembers(
  db: D1Database,
  userIds: number[],
): Promise<{ ok: true; names: Map<number, string> } | { ok: false; error: string }> {
  const names = new Map<number, string>();
  for (let i = 0; i < userIds.length; i += BIND_CHUNK) {
    const chunk = userIds.slice(i, i + BIND_CHUNK);
    const { results } = await db
      .prepare(
        `SELECT id, full_name, role, status FROM users
          WHERE id IN (${chunk.map(() => '?').join(',')})`,
      )
      .bind(...chunk)
      .all<{ id: number; full_name: string; role: string; status: string }>();
    for (const u of results ?? []) {
      if (u.status !== 'active') {
        return { ok: false, error: `${u.full_name} идэвхгүй хэрэглэгч тул хуваарьт оруулах боломжгүй.` };
      }
      if (!(PLAN_MEMBER_ROLES as readonly string[]).includes(u.role)) {
        return { ok: false, error: `${u.full_name} зохиогчийн хяналтад явах дүргүй байна.` };
      }
      names.set(u.id, u.full_name);
    }
  }
  const missing = userIds.find((id) => !names.has(id));
  if (missing != null) return { ok: false, error: `Хэрэглэгч (id ${missing}) олдсонгүй.` };
  return { ok: true, names };
}

async function loadProjectHead(db: D1Database, projectId: number) {
  return db
    .prepare(
      `SELECT p.id, ${asrLabelSql('p')} AS name, p.location, p.asr_merged_into, pp.drawing_no AS shifr
         FROM projects p
         LEFT JOIN project_passport pp ON pp.project_id = p.id
        WHERE p.id = ?`,
    )
    .bind(projectId)
    .first<{
      id: number;
      name: string;
      location: string | null;
      asr_merged_into: number | null;
      shifr: string | null;
    }>();
}

async function actorName(db: D1Database, userId: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT full_name FROM users WHERE id = ?')
    .bind(userId)
    .first<{ full_name: string }>();
  return row?.full_name ?? null;
}

function planLink(plan: { id: number; project_id: number }): string {
  return `/app/asr?project=${plan.project_id}&plan=${plan.id}`;
}

/** Мэдэгдлийн контекст — хүлээн авагч тус бүрд «Хамт явах» өөр байна. */
function noticeCtx(
  plan: AsrVisitPlanView,
  names: Map<number, string>,
  recipientId: number,
  actor: string | null,
  today: string,
): VisitNoticeContext {
  const companions = plan.members
    .filter((m) => m.user_id !== recipientId)
    .map((m) => names.get(m.user_id) ?? m.full_name ?? '')
    .filter(Boolean);
  return {
    projectName: asrProjectName(plan.project_name),
    location: plan.project_location,
    shifr: plan.project_shifr,
    visitDate: plan.visit_date,
    visitTime: plan.visit_time,
    note: plan.note,
    companions,
    actorName: actor,
    today,
  };
}

async function markNotified(db: D1Database, planId: number, userIds: number[]) {
  if (userIds.length === 0) return;
  const now = new Date().toISOString();
  const stmt = db.prepare(
    'UPDATE asr_visit_plan_members SET notified_at = ? WHERE plan_id = ? AND user_id = ?',
  );
  await db.batch(userIds.map((uid) => stmt.bind(now, planId, uid)));
}

export function registerAsrVisitPlanRoutes(router: App, opts: { readRoles: Set<string> }) {
  /* ------------------------------------------------------------------ */
  /*  GET /plans — жагсаалт                                              */
  /* ------------------------------------------------------------------ */
  /**
   * ?project_id=  — нэг төслийнх
   * ?from= ?to=   — огнооны муж (YYYY-MM-DD); `from` өгөгдмөл = ӨНӨӨДӨР
   *                 (УБ), өөрөөр хэлбэл ирэх хуваарь.  Өнгөрснийг үзэхэд
   *                 `from` ил өгнө.
   * ?mine=1       — зөвхөн өөрийн орсон хуваарь
   * ?include_cancelled=1 — цуцлагдсаныг ч оруулна
   */
  router.get('/plans', async (c) => {
    const user = c.get('user');
    if (!opts.readRoles.has(user.role)) return c.json({ error: 'Forbidden' }, 403);

    const q = c.req.query();
    const where: string[] = [];
    const binds: unknown[] = [];

    const projectId = q.project_id ? Number(q.project_id) : null;
    if (projectId != null) {
      if (!Number.isInteger(projectId) || projectId <= 0) return c.json({ error: 'Invalid project_id' }, 400);
      where.push('vp.project_id = ?');
      binds.push(projectId);
    }
    const from = q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : todayInUB();
    where.push('vp.visit_date >= ?');
    binds.push(from);
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to)) {
      where.push('vp.visit_date <= ?');
      binds.push(q.to);
    }
    if (q.include_cancelled !== '1') where.push(`vp.status = 'planned'`);
    if (q.mine === '1') {
      where.push('EXISTS (SELECT 1 FROM asr_visit_plan_members mm WHERE mm.plan_id = vp.id AND mm.user_id = ?)');
      binds.push(user.sub);
    }

    const { results } = await c.env.DB.prepare(
      `${PLAN_SELECT}
        WHERE ${where.join(' AND ')}
        ORDER BY vp.visit_date, COALESCE(vp.visit_time, '99'), vp.id
        LIMIT ${LIST_LIMIT}`,
    )
      .bind(...binds)
      .all<PlanRow>();
    const rows = results ?? [];
    const members = await loadMembers(
      c.env.DB,
      rows.map((r) => r.id),
    );
    return c.json({
      plans: rows.map((r) => toView(r, members.get(r.id) ?? [])),
      today: todayInUB(),
      can_manage: user.role === 'admin' || user.role === 'senior',
    });
  });

  router.get('/plans/:id', async (c) => {
    const user = c.get('user');
    if (!opts.readRoles.has(user.role)) return c.json({ error: 'Forbidden' }, 403);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const plan = await loadPlan(c.env.DB, id);
    if (!plan) return c.json({ error: 'Not found' }, 404);
    return c.json({ plan, can_manage: user.role === 'admin' || user.role === 'senior' });
  });

  /* ------------------------------------------------------------------ */
  /*  POST /plans — шинэ хуваарь + мэдэгдэл                              */
  /* ------------------------------------------------------------------ */
  router.post('/plans', requireManager(), async (c) => {
    const user = c.get('user');
    const raw = await c.req.json().catch(() => ({}));
    const v = validatePlanInput(raw);
    if (!v.ok) return c.json({ error: v.error }, 400);
    const input = v.value;

    const project = await loadProjectHead(c.env.DB, input.project_id);
    if (!project) return c.json({ error: 'Төсөл олдсонгүй.' }, 404);
    // Нэгтгэгдсэн төсөл (миграц 0340) дээр ШИНЭ хуваарь үүсгэхгүй — сонголтын
    // цонхонд тэр төсөл гарахгүй боловч сервер UI-д итгэхгүй.  ОДОО БАЙГАА
    // хуваарийг засах зам (PATCH) ХӨНДӨГДӨХГҮЙ.
    if (project.asr_merged_into != null) {
      return c.json({ error: 'Энэ төслийн зохиогчийн хяналт өөр төсөл рүү нэгтгэгдсэн.' }, 403);
    }
    const mem = await checkMembers(c.env.DB, input.user_ids);
    if (!mem.ok) return c.json({ error: mem.error }, 400);

    const ins = await c.env.DB.prepare(
      `INSERT INTO asr_visit_plans (project_id, visit_date, visit_time, note, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(input.project_id, input.visit_date, input.visit_time, input.note, user.sub)
      .run();
    const id = Number(ins.meta.last_row_id);
    const memberStmt = c.env.DB.prepare(
      'INSERT INTO asr_visit_plan_members (plan_id, user_id) VALUES (?, ?)',
    );
    await c.env.DB.batch(input.user_ids.map((uid) => memberStmt.bind(id, uid)));

    const plan = (await loadPlan(c.env.DB, id))!;
    const actor = await actorName(c.env.DB, user.sub);
    const today = todayInUB();
    const recipients = input.user_ids.filter((uid) => uid !== user.sub);
    for (const uid of recipients) {
      const n = buildAssignedNotice(noticeCtx(plan, mem.names, uid, actor, today));
      await createNotification(c.env.DB, uid, 'asr_visit_assigned', n.title, n.body, planLink(plan));
    }
    await markNotified(c.env.DB, id, recipients);

    return c.json({ plan: await loadPlan(c.env.DB, id), notified: recipients.length }, 201);
  });

  /* ------------------------------------------------------------------ */
  /*  PATCH /plans/:id — засах (гишүүн нэмэх/хасах, огноо/цаг/тэмдэглэл) */
  /* ------------------------------------------------------------------ */
  router.patch('/plans/:id', requireManager(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const before = await loadPlan(c.env.DB, id);
    if (!before) return c.json({ error: 'Not found' }, 404);
    if (before.status !== 'planned') {
      return c.json({ error: 'Цуцлагдсан хуваарийг засах боломжгүй.' }, 409);
    }

    const raw = await c.req.json().catch(() => ({}));
    const v = validatePlanInput(raw, toInput(before));
    if (!v.ok) return c.json({ error: v.error }, 400);
    const input = v.value;

    if (input.project_id !== before.project_id) {
      const project = await loadProjectHead(c.env.DB, input.project_id);
      if (!project) return c.json({ error: 'Төсөл олдсонгүй.' }, 404);
    }
    const mem = await checkMembers(c.env.DB, input.user_ids);
    if (!mem.ok) return c.json({ error: mem.error }, 400);

    const diff = diffPlan(toInput(before), input);

    await c.env.DB.prepare(
      `UPDATE asr_visit_plans
          SET project_id = ?, visit_date = ?, visit_time = ?, note = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
      .bind(input.project_id, input.visit_date, input.visit_time, input.note, id)
      .run();
    const stmts: D1PreparedStatement[] = [];
    if (diff.removed.length > 0) {
      stmts.push(
        c.env.DB.prepare(
          `DELETE FROM asr_visit_plan_members
            WHERE plan_id = ? AND user_id IN (${diff.removed.map(() => '?').join(',')})`,
        ).bind(id, ...diff.removed),
      );
    }
    const memberStmt = c.env.DB.prepare(
      'INSERT OR IGNORE INTO asr_visit_plan_members (plan_id, user_id) VALUES (?, ?)',
    );
    for (const uid of diff.added) stmts.push(memberStmt.bind(id, uid));
    if (stmts.length > 0) await c.env.DB.batch(stmts);

    const plan = (await loadPlan(c.env.DB, id))!;
    const actor = await actorName(c.env.DB, user.sub);
    const today = todayInUB();
    const link = planLink(plan);
    const notified: number[] = [];

    // Хасагдсан хүн — хуучин огноогоор нь мэдэгдэнэ (тэр л мэддэг хуваарь).
    for (const uid of diff.removed) {
      if (uid === user.sub) continue;
      const n = buildCancelledNotice(
        {
          projectName: asrProjectName(before.project_name),
          visitDate: before.visit_date,
          visitTime: before.visit_time,
          actorName: actor,
          today,
        },
        'removed',
      );
      await createNotification(c.env.DB, uid, 'asr_visit_cancelled', n.title, n.body, link);
    }
    for (const uid of diff.added) {
      if (uid === user.sub) continue;
      const n = buildAssignedNotice(noticeCtx(plan, mem.names, uid, actor, today));
      await createNotification(c.env.DB, uid, 'asr_visit_assigned', n.title, n.body, link);
      notified.push(uid);
    }
    if (diff.changed) {
      for (const uid of diff.kept) {
        if (uid === user.sub) continue;
        const n = buildChangedNotice(noticeCtx(plan, mem.names, uid, actor, today));
        await createNotification(c.env.DB, uid, 'asr_visit_assigned', n.title, n.body, link);
        notified.push(uid);
      }
    }
    await markNotified(c.env.DB, id, notified);

    return c.json({ plan: await loadPlan(c.env.DB, id), notified: notified.length });
  });

  /* ------------------------------------------------------------------ */
  /*  DELETE /plans/:id — цуцлах (мөр ҮЛДЭНЭ, status = cancelled)         */
  /* ------------------------------------------------------------------ */
  router.delete('/plans/:id', requireManager(), async (c) => {
    const user = c.get('user');
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const plan = await loadPlan(c.env.DB, id);
    if (!plan) return c.json({ error: 'Not found' }, 404);

    const res = await c.env.DB.prepare(
      `UPDATE asr_visit_plans
          SET status = 'cancelled', cancelled_by = ?, cancelled_at = ?, updated_at = datetime('now')
        WHERE id = ? AND status = 'planned'`,
    )
      .bind(user.sub, new Date().toISOString(), id)
      .run();
    if ((res.meta.changes ?? 0) === 0) {
      return c.json({ error: 'Хуваарь аль хэдийн цуцлагдсан байна.' }, 409);
    }

    const actor = await actorName(c.env.DB, user.sub);
    const today = todayInUB();
    const link = planLink(plan);
    let notified = 0;
    for (const m of plan.members) {
      if (m.user_id === user.sub) continue;
      const n = buildCancelledNotice(
        {
          projectName: asrProjectName(plan.project_name),
          visitDate: plan.visit_date,
          visitTime: plan.visit_time,
          actorName: actor,
          today,
        },
        'cancelled',
      );
      await createNotification(c.env.DB, m.user_id, 'asr_visit_cancelled', n.title, n.body, link);
      notified += 1;
    }

    return c.json({ plan: await loadPlan(c.env.DB, id), notified });
  });
}
