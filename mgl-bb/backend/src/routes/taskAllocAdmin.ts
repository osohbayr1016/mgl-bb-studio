import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireAdmin, requireManager } from '../middleware/auth';
import { contractHeaders, loadGate } from '../lib/taskAllocGate';
import { loadRootsOverview, loadStateOverview, setGateState } from '../lib/taskAllocAdmin';
import { auditTaskAllocations } from '../lib/taskAllocAudit';
import { applyTaskReweight, managedTaskIdsOfProject, previewTaskReweight, reconcileProjectCredit } from '../lib/taskCreditReweight';
import { applyConversion, discoverGroups, listConversions, previewConversion, revertConversion } from '../lib/taskConversion';
import type { OpFail } from '../lib/taskRootOps';
import { correlationIdOf, logTaskAlloc } from '../lib/taskAllocLog';
import { TASK_ALLOC_CONTRACT } from '../lib/taskAllocGate';

/**
 * ТАСКИЙН ХУВААРИЛТ — МЕНЕЖЕРИЙН ГАДАРГУУ `/api/tasks/alloc-admin/*` (router нь `/api/tasks` дээр mount, замууд `/alloc-admin/…`) (2026-10-05).
 *
 *   GET  /state   — admin|senior: идэвхжүүлэлтийн төлөв, гэрээний хувилбар, root-уудын тоо, төлөв солилтын түүх.
 *   PUT  /state   — admin: `{state, reason, expected_state?}` — disabled | enabled | paused.  Үндэслэл ЗААВАЛ.
 *   GET  /roots   — admin|senior: managed root-уудын тойм (`project_id`, `only_open`, `limit`, `offset`).
 *   GET  /audit   — admin|senior: инвариантын аудит (`task_id`, `project_id`, `deep=1`, `limit`) — зөвхөн УНШИХ.
 *   GET  /credit/reweight  — admin|senior: жин/төвөгшлийн өөрчлөлтийн дараах оноо тулгалтын ТӨЛӨВЛӨГӨӨ (`task_id` | `project_id`).
 *   POST /credit/reweight  — admin: ЯГ ТЭР тулгалтыг хэрэгжүүлнэ (идемпотент: зөрүүгүй бол юу ч бичихгүй).
 *   GET  /conversion/candidates — admin|senior: хуучин бүлгийн нэр дэвшигчид + нотолгооны ангилал (юу ч бичихгүй).
 *   POST /conversion/preview    — admin|senior: бүлгийн БҮТЭН төлөвлөгөө + `plan_hash` (юу ч бичихгүй).
 *   POST /conversion/apply      — admin: preview-ийн төлөвлөгөөг атом хэрэгжүүлнэ (`request_id`, `plan_hash`, `reason`).
 *   POST /conversion/:id/revert — admin: root дээр юу ч хийгдээгүй бол ЭХНИЙ төлөвт буцаана.
 *   GET  /conversion/history    — admin|senior: хөрвүүлэлтийн журнал.
 *
 * ⚠️ Энэ router нь `taskAllocContract` хаалганаас ЧӨЛӨӨТЭЙ — paused/disabled үед ч ажиллана (хөрвүүлэлт, аудит,
 * төлөв солих нь release-ийн дарааллын дундаас хийгдэнэ).  Харин БҮХ зам ЗААВАЛ admin/senior.  `/api/tasks`-ийн `/:id`
 * замуудаас ӨМНӨ mount хийнэ (index.ts).
 * ⚠️ Хариу бүр `X-Task-Alloc-Contract` + `X-Task-Alloc-State` + `X-Request-Id` тээнэ.
 */
const taskAllocAdmin = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ⚠️ `use('*')` БИШ: энэ router `/api/tasks`-ийн угтвар дээр mount хийгдсэн (modules.ts-ийн угтвар жагсаалттай таарахын тулд) —
// бүх `/api/tasks/*`-д хамаарвал хуучин замуудын толгой өөрчлөгдөнө.
taskAllocAdmin.use('/alloc-admin/*', async (c, next) => {
  const rid = correlationIdOf(c.req.header('X-Request-Id'));
  await next();
  const gate = await loadGate(c.env.DB);
  for (const [k, v] of Object.entries(contractHeaders(gate.state))) c.res.headers.set(k, v);
  c.res.headers.set('X-Request-Id', rid);
  c.res.headers.set('Cache-Control', 'private, no-store');
});

const intOf = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return raw !== undefined && Number.isSafeInteger(n) && n > 0 ? n : null;
};

taskAllocAdmin.get('/alloc-admin/state', requireManager(), async (c) => {
  return c.json(await loadStateOverview(c.env.DB));
});

taskAllocAdmin.put('/alloc-admin/state', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as { state?: unknown; expected_state?: unknown; reason?: unknown };
  const r = await setGateState(c.env.DB, user.sub, { to: body.state, expected: body.expected_state, reason: body.reason });
  logTaskAlloc({
    evt: 'state_change',
    correlation_id: correlationIdOf(c.req.header('X-Request-Id')),
    actor_id: user.sub,
    contract: TASK_ALLOC_CONTRACT,
    state: r.ok ? r.to : undefined,
    result: r.ok ? 'ok' : 'fail',
    status: r.ok ? 200 : r.status,
    code: r.ok ? null : r.code,
  });
  if (!r.ok) {
    return c.json({ error: r.code, message: r.message, ...(r.current ? { current: r.current } : {}) }, r.status);
  }
  return c.json({ ...(await loadStateOverview(c.env.DB)), changed: r.changed, from: r.from });
});

taskAllocAdmin.get('/alloc-admin/roots', requireManager(), async (c) => {
  const data = await loadRootsOverview(c.env.DB, {
    projectId: intOf(c.req.query('project_id')),
    limit: intOf(c.req.query('limit')) ?? 50,
    offset: Number(c.req.query('offset')) > 0 ? Math.floor(Number(c.req.query('offset'))) : 0,
    onlyOpen: c.req.query('only_open') === '1',
  });
  return c.json(data);
});

taskAllocAdmin.get('/alloc-admin/audit', requireManager(), async (c) => {
  const started = Date.now();
  const report = await auditTaskAllocations(c.env.DB, {
    taskId: intOf(c.req.query('task_id')),
    projectId: intOf(c.req.query('project_id')),
    deep: c.req.query('deep') === '1',
    limit: intOf(c.req.query('limit')) ?? 500,
  });
  logTaskAlloc({
    evt: 'audit',
    correlation_id: correlationIdOf(c.req.header('X-Request-Id')),
    actor_id: c.get('user').sub,
    result: report.ok ? 'ok' : 'fail',
    code: report.ok ? null : Object.keys(report.counts).join(','),
    ms: Date.now() - started,
  });
  return c.json(report);
});

/* ------------------------------------------------------------------ */
/*  Жингийн дараах оноо тулгалт (lib/taskCreditReweight.ts)               */
/* ------------------------------------------------------------------ */

const REWEIGHT_PROJECT_CAP = 200;

taskAllocAdmin.get('/alloc-admin/credit/reweight', requireManager(), async (c) => {
  const taskId = intOf(c.req.query('task_id'));
  const projectId = intOf(c.req.query('project_id'));
  if (!taskId && !projectId) return c.json({ error: 'BAD_SCOPE', message: 'task_id эсвэл project_id шаардлагатай' }, 400);
  const allIds = taskId ? [taskId] : await managedTaskIdsOfProject(c.env.DB, projectId!);
  const ids = allIds.slice(0, REWEIGHT_PROJECT_CAP);
  const previews = [];
  for (const id of ids) {
    const p = await previewTaskReweight(c.env.DB, id);
    if (p) previews.push({ task_id: p.taskId, project_id: p.projectId, coef: p.coef, complexity_pct: p.complexityPct, totals: p.totals, items: p.items.length });
  }
  const drifting = previews.filter((p) => p.items > 0);
  return c.json({
    tasks: previews.length,
    drifting: drifting.length,
    amount_delta: drifting.reduce((s, p) => s + p.totals.amountDelta, 0),
    previews: drifting,
    // Төслийн хүрээнд хамгийн ихдээ REWEIGHT_PROJECT_CAP таскийг харуулна — үлдсэнийг таскаар нь (task_id) эсвэл автомат тулгалтаар.
    truncated: allIds.length > ids.length,
  });
});

taskAllocAdmin.post('/alloc-admin/credit/reweight', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const taskId = typeof body.task_id === 'number' && Number.isSafeInteger(body.task_id) && body.task_id > 0 ? body.task_id : null;
  const projectId = typeof body.project_id === 'number' && Number.isSafeInteger(body.project_id) && body.project_id > 0 ? body.project_id : null;
  if (!taskId && !projectId) return c.json({ error: 'BAD_SCOPE', message: 'task_id эсвэл project_id шаардлагатай' }, 400);
  const ctx = { db: c.env.DB, ai: c.env.AI, waitUntil: (p: Promise<unknown>) => c.executionCtx.waitUntil(p), force: true };
  if (!taskId) {
    const n = (await managedTaskIdsOfProject(c.env.DB, projectId!)).length;
    if (n > REWEIGHT_PROJECT_CAP) {
      return c.json({ error: 'TOO_MANY_TASKS', message: `Төсөлд ${n} managed таск байна (> ${REWEIGHT_PROJECT_CAP}) — task_id-аар нэг нэгээр тулгана уу`, tasks: n }, 400);
    }
  }
  if (taskId) {
    let r = await applyTaskReweight(ctx, user.sub, taskId);
    if (r.kind === 'stale') r = await applyTaskReweight(ctx, user.sub, taskId);
    return c.json({ scope: 'task', result: r });
  }
  return c.json({ scope: 'project', result: await reconcileProjectCredit(ctx, projectId!, user.sub) });
});

/* ------------------------------------------------------------------ */
/*  Хуучин бүлгийн хөрвүүлэлт (lib/taskConversion.ts)                    */
/* ------------------------------------------------------------------ */

const failBody = (r: OpFail) => ({ error: r.code, message: r.message, ...(r.extra ?? {}) });

function numArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0) : [];
}

function ownersOf(v: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const taskId = Number(k);
      if (Number.isSafeInteger(taskId) && taskId > 0 && typeof val === 'number' && Number.isSafeInteger(val) && val > 0) out[taskId] = val;
    }
  }
  return out;
}

taskAllocAdmin.get('/alloc-admin/conversion/candidates', requireManager(), async (c) => {
  return c.json(
    await discoverGroups(c.env.DB, {
      projectId: intOf(c.req.query('project_id')),
      limit: intOf(c.req.query('limit')) ?? 50,
      includeManaged: c.req.query('include_managed') === '1',
    }),
  );
});

taskAllocAdmin.post('/alloc-admin/conversion/preview', requireManager(), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await previewConversion(c.env.DB, {
    taskIds: numArray(body.task_ids),
    rootTaskId: typeof body.root_task_id === 'number' ? body.root_task_id : null,
    rootName: typeof body.root_name === 'string' ? body.root_name : null,
    futureOwners: ownersOf(body.future_owners),
  });
  if (!r.ok) return c.json(failBody(r), r.status);
  return c.json(r.data);
});

taskAllocAdmin.post('/alloc-admin/conversion/apply', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await applyConversion(
    { db: c.env.DB, ai: c.env.AI, waitUntil: (p) => c.executionCtx.waitUntil(p) },
    { sub: user.sub, role: user.role },
    {
      taskIds: numArray(body.task_ids),
      rootTaskId: typeof body.root_task_id === 'number' ? body.root_task_id : null,
      rootName: typeof body.root_name === 'string' ? body.root_name : null,
      futureOwners: ownersOf(body.future_owners),
      requestId: typeof body.request_id === 'string' ? body.request_id : '',
      planHash: typeof body.plan_hash === 'string' ? body.plan_hash : '',
      reason: typeof body.reason === 'string' ? body.reason : '',
      confirmAmbiguous: body.confirm_ambiguous === true,
    },
  );
  if (!r.ok) {
    logTaskAlloc({ evt: 'conversion', op: 'convert', correlation_id: correlationIdOf(c.req.header('X-Request-Id')), actor_id: user.sub, result: 'fail', code: r.code, status: r.status });
    return c.json(failBody(r), r.status);
  }
  return c.json({ ...r.data, replayed: r.replayed === true });
});

taskAllocAdmin.post('/alloc-admin/conversion/:id/revert', requireAdmin(), async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const r = await revertConversion(
    { db: c.env.DB },
    { sub: user.sub, role: user.role },
    {
      conversionId: c.req.param('id') ?? '',
      requestId: typeof body.request_id === 'string' ? body.request_id : '',
      reason: typeof body.reason === 'string' ? body.reason : '',
    },
  );
  if (!r.ok) {
    logTaskAlloc({ evt: 'conversion', op: 'revert', correlation_id: correlationIdOf(c.req.header('X-Request-Id')), actor_id: user.sub, result: 'fail', code: r.code, status: r.status });
    return c.json(failBody(r), r.status);
  }
  return c.json({ ...r.data, replayed: r.replayed === true });
});

taskAllocAdmin.get('/alloc-admin/conversion/history', requireManager(), async (c) => {
  return c.json({ conversions: await listConversions(c.env.DB, intOf(c.req.query('limit')) ?? 50) });
});

export default taskAllocAdmin;
