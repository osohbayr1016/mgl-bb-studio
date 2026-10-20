import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, AppVariables } from '../types';
import { requireRole } from '../middleware/auth';
import { taskAllocContract } from '../middleware/taskAllocGuard';
import { TASK_ALLOC_CONTRACT, TASK_ALLOC_CONTRACT_HEADER, loadGate } from '../lib/taskAllocGate';
import { logTaskAlloc, opResultFields } from '../lib/taskAllocLog';
import { isSingleSegmentMediaUrl } from '../lib/mediaUrl';
import { ceoUserId } from '../lib/ceo';
import {
  applyAllocation,
  correctOwnProgress,
  loadAllocationOverview,
  loadOwnRecords,
  releaseOwn,
  restoreOwnProgress,
  retakeAllocation,
  setOwnProgress,
  type OpCtx,
  type OpFail,
  type OpResult,
} from '../lib/taskRootOps';
import { normalizeAttachmentsInput } from './progress';
import { unsplitTask } from '../lib/taskUnsplit';
import { loadProjectContributors } from '../lib/taskContributors';
import { loadOfficialLunch, lunchWire } from '../lib/taskTimerLunch';
import { retiredHandler } from '../lib/retiredHits';

/**
 * ТАСКИЙН ХУВААРИЛАЛТ — `/api/tasks/:id/allocation/*` (2026-10-02, `/api/tasks`-ийн ХОЁР ДАХЬ mount).
 *
 *   GET  /allocation-candidates         — ирээдүйн ажил эзэлж болох ажилтнууд (засварлагчийн жагсаалт).
 *   GET  /:id/allocation                — таскийн хуваарилалтын тойм (managed эсвэл seed-ийн урьдчилсан харагдац).
 *   POST /:id/allocation/split          — хуваах / засах (managed болгох анхны үйлдэл ч энэ).
 *   POST /:id/allocation/progress       — ӨӨРИЙН хийсэн хэмжээг бичих (оноо, QA, дуусах).
 *   POST /:id/allocation/release        — үлдсэн ажлаа буцаах / шилжүүлэх.
 *   POST /:id/allocation/retake         — чөлөөт ажлаас (дахин) авах.
 *   POST /:id/allocation/parts          — хүн оноолгүйгээр нэрлэсэн хэсгүүд болгох / засах (0394).
 *   POST /:id/allocation/claim-part     — хүнгүй хэсгийг авах (миний хуваарилалт болно).
 *   PUT  /:id/part-label                — хүнгүй хэсгийн нэрийг засах (зөвхөн харагдац).
 *   PUT  /:id/name                      — ҮНДСЭН таскийн нэрийг засах (бүх ажилтан, зөвхөн нэр).
 *   GET  /:id/allocation/records        — өөрийн хүчинтэй хийсэн хэсгүүд + сэргээж болох залруулгууд.
 *   POST /:id/allocation/correct        — өөрийн бүртгэлийг (доод хязгаараас доош ч) хүчингүй болгох, оноог буцаах.
 *   POST /:id/allocation/restore        — хүчингүй болгосон бүртгэлийг сэргээх (давхар оноогүй).
 *
 * Бүх бичих үйлдэл: `request_id` (идемпотент дахин оролдлого) + `expected_revision` (CAS).  Хуучирсан revision →
 * 409 `STALE_REVISION` + `current` (одоогийн төлөв).  Дүрэм `lib/taskRootOps.ts`, цэвэр дүрэм `lib/taskAllocation.ts`.
 *
 * ⚠️ `user_id` ХЭЗЭЭ Ч биеэс авагдахгүй (токены `sub`) — `progress`-ийн `owner_user_id` нь ЗӨВХӨН админд.
 * ⚠️ Хүн бүрийн хэмжээ БҮТЭН НЭГЖ (1% = 10 000 нэгж, `lib/taskUnits.ts`) — JSON-д аравтын бутархай ХҮЛЭЭГДЭХГҮЙ.
 */
const taskAllocations = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const STAFF = requireRole('admin', 'senior', 'engineer', 'architect');

// Хаалга (lib/taskAllocGate.ts): `/:id/allocation[/*]` дээрх БҮХ бичих үйлдэл — клиентийн гэрээ (426) + идэвхжүүлэлтийн
// төлөв (423).  ⚠️ `app.use('*')` БИШ: энэ router нь `/api/tasks`-ийн ТАВ ДАХЬ `tasks` router-тэй ижил угтвар дээр —
// бүх `/api/tasks/*`-д хаалга тавбал таск үүсгэх/засах хуучин замууд 423/426 болно.
// ⚠️ ЭРХИЙН шалгалт (`STAFF`, 403) хаалганаас (426/423) ӨМНӨ — нэвтрээгүй/эрхгүй хэрэглэгчид төлөв, гэрээний
// мэдээлэл задруулахгүй, 403 нь үргэлж түрүүлнэ.
taskAllocations.use('/:id/allocation', STAFF, taskAllocContract);
taskAllocations.use('/:id/allocation/*', STAFF, taskAllocContract);

function ctxOf(c: {
  env: Env;
  executionCtx: { waitUntil: (p: Promise<unknown>) => void };
}): OpCtx {
  return {
    db: c.env.DB,
    ai: c.env.AI,
    waitUntil: (p) => c.executionCtx.waitUntil(p),
  };
}

function failBody(r: OpFail) {
  return { error: r.code, message: r.message, ...(r.extra ?? {}) };
}

/**
 * Мутацийн үр дүнг бүтэцтэй логт бичиж (`lib/taskAllocLog.ts`) HTTP хариу болгоно.  Идентифайер л — тайлбар, асуултын
 * хариулт, нэр ХЭЗЭЭ Ч орохгүй.  `ms` нь handler-ийн хугацаа.
 */
function respond<T extends { root?: { revision: number } }>(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  op: string,
  taskId: number,
  started: number,
  meta: { requestId: unknown; expected: number | null; owner?: number | null },
  r: OpResult<T> | OpFail,
) {
  const actor = c.get('user');
  const base = {
    evt: 'op' as const,
    op,
    correlation_id: c.get('allocCorrelationId') ?? null,
    task_id: taskId,
    actor_id: actor.sub,
    owner_id: meta.owner ?? null,
    request_id: typeof meta.requestId === 'string' ? meta.requestId : null,
    rev_before: meta.expected,
    contract: TASK_ALLOC_CONTRACT,
    client_contract: c.req.header(TASK_ALLOC_CONTRACT_HEADER) ?? null,
    state: c.get('allocState') ?? undefined,
    ms: Date.now() - started,
  };
  if (!r.ok) {
    logTaskAlloc({ ...base, ...opResultFields({ ok: false, status: r.status, code: r.code }) });
    return c.json(failBody(r), r.status);
  }
  const data = r.data as T & { root?: { revision: number } };
  logTaskAlloc({
    ...base,
    ...opResultFields({ ok: true, replayed: r.replayed === true, revisionAfter: data.root?.revision ?? null }),
  });
  return c.json({ ...r.data, replayed: r.replayed === true });
}

function idOf(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/** `expected_revision`: бүхэл ≥ 0 (managed болоогүй таскт 0 эсвэл null). */
function revisionOf(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  return isInt(v) && v >= 0 ? v : undefined;
}

taskAllocations.get('/allocation-candidates', STAFF, async (c) => {
  const ceo = ceoUserId();
  const { results } = await c.env.DB.prepare(
    `SELECT id, full_name, username, role, profile_image
       FROM users
      WHERE status = 'active' AND COALESCE(is_support, 0) = 0
        AND (role IN ('engineer', 'architect', 'senior') OR id = ?)
      ORDER BY full_name`,
  )
    .bind(ceo ?? -1)
    .all<{ id: number; full_name: string | null; username: string; role: string; profile_image: string | null }>();
  return c.json({ users: results ?? [] }, 200, { 'Cache-Control': 'private, max-age=60' });
});

// GET /api/tasks/contributors?project_id=N — төслийн таск бүрийн хувь нэмэрчид + хүн бүрийн албан цаг (нэр + цаг).
// ERP-д нэвтэрсэн ажилтан бүрд харагдана (эзний шийдвэр 2026-10-02) — гаднаас нэвтрэлтгүй БИШ, HR/далд (Revit) өгөгдөл ОРОХГҮЙ.
// Төсөл бүрт нэг дуудлага (асуулга 6) — мөр бүрт БИШ.  `server_now` + `lunch` нь клиентийн тоолуурт.
taskAllocations.get('/contributors', STAFF, async (c) => {
  const projectId = idOf(c.req.query('project_id'));
  if (projectId === null) return c.json({ error: 'project_id is required' }, 400);
  const lunch = await loadOfficialLunch(c.env.DB);
  const [data, gate] = await Promise.all([loadProjectContributors(c.env.DB, projectId, lunch), loadGate(c.env.DB)]);
  return c.json({ server_now: new Date().toISOString(), lunch: lunchWire(lunch), alloc_state: gate.state, ...data }, 200, {
    'Cache-Control': 'private, no-store',
  });
});

// PUT /api/tasks/:id/allocation-label {user_id, label} — хуваарилалтын мөрийн (28.1, 28.2 …) нэрийг засна
// (migration 0393).  2026-10-08 (эзний шийдэл, 2 дахь шийдвэр): ажилтан (admin/senior/engineer/architect) АЛЬ Ч
// мөрийг — зөвхөн ӨӨРИЙНХӨӨ биш, бусдынхыг ч — засна.  ЗӨВХӨН харагдац: явц, оноо, цаг, `task_roots.revision`
// ХӨНДӨГДӨХГҮЙ тул `/:id/allocation/*`-ийн хаалга (426/423) ХЭРЭГГҮЙ — зориуд тэр угтвараас ГАДНА
// (`allocation-label`).  Хоосон label = root-ийн нэр рүү буцна.
taskAllocations.put('/:id/allocation-label', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { user_id?: unknown; label?: unknown };
  if (!isInt(body.user_id) || body.user_id <= 0) return c.json({ error: 'user_id must be a positive integer' }, 400);
  if (body.label !== null && body.label !== undefined && typeof body.label !== 'string') {
    return c.json({ error: 'label must be a string or null' }, 400);
  }
  const label = typeof body.label === 'string' ? body.label.trim().replace(/\s+/g, ' ') : '';
  if (label.length > 120) return c.json({ error: 'label is too long (max 120)', code: 'LABEL_TOO_LONG' }, 400);
  const r = await c.env.DB.prepare("UPDATE task_allocations SET label = ?, updated_at = datetime('now') WHERE task_id = ? AND user_id = ?")
    .bind(label === '' ? null : label, id, body.user_id)
    .run();
  if ((r.meta?.changes ?? 0) === 0) return c.json({ error: 'Allocation not found', code: 'NOT_FOUND' }, 404);
  return c.json({ ok: true, task_id: id, user_id: body.user_id, label: label === '' ? null : label });
});

taskAllocations.get('/:id/allocation', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const [r, gate] = await Promise.all([loadAllocationOverview(c.env.DB, c.get('user'), id), loadGate(c.env.DB)]);
  if (!r.ok) return c.json(failBody(r), r.status);
  // paused/disabled: унших хэвээр, харин бүх үйлдэл хаалттай — UI-д товч идэвхгүй, сервер ч 423 өгнө.
  const allowed =
    gate.state === 'enabled' ? r.data.allowed : { edit: false, progress: false, release: false, retake: false, parts: false };
  return c.json(
    { server_now: new Date().toISOString(), ...r.data, allowed, alloc_state: gate.state },
    200,
    { 'Cache-Control': 'private, no-store' },
  );
});

taskAllocations.post('/:id/allocation/split', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    request_id?: unknown;
    expected_revision?: unknown;
    mode?: unknown;
    targets?: unknown;
  };
  const expected = revisionOf(body.expected_revision);
  if (expected === undefined) return c.json({ error: 'expected_revision must be an integer >= 0 or null' }, 400);
  const mode = body.mode === 'remainder' ? 'remainder' : body.mode === 'total' ? 'total' : null;
  if (mode === null) return c.json({ error: "mode must be 'total' or 'remainder'" }, 400);
  if (!Array.isArray(body.targets)) return c.json({ error: 'targets must be an array' }, 400);
  const targets: Array<{ userId: number; targetUnits: number }> = [];
  for (const t of body.targets) {
    const o = t as { user_id?: unknown; target_units?: unknown };
    if (!isInt(o.user_id) || !isInt(o.target_units)) {
      return c.json({ error: 'each target needs integer user_id and target_units' }, 400);
    }
    targets.push({ userId: o.user_id, targetUnits: o.target_units });
  }
  const started = Date.now();
  const r = await applyAllocation(ctxOf(c), c.get('user'), {
    taskId: id,
    requestId: body.request_id as string,
    expectedRevision: expected,
    mode,
    targets,
  });
  return respond(c, 'split', id, started, { requestId: body.request_id, expected, owner: null }, r);
});

taskAllocations.post('/:id/allocation/progress', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    request_id?: unknown;
    expected_revision?: unknown;
    done_units?: unknown;
    owner_user_id?: unknown;
    notes?: unknown;
    attachments?: unknown;
    image_url?: unknown;
    completion_qa?: unknown;
  };
  const expected = revisionOf(body.expected_revision);
  if (expected === undefined || expected === null) {
    return c.json({ error: 'expected_revision must be an integer >= 0' }, 400);
  }
  if (!isInt(body.done_units)) return c.json({ error: 'done_units must be an integer' }, 400);
  if (body.owner_user_id !== undefined && body.owner_user_id !== null && !isInt(body.owner_user_id)) {
    return c.json({ error: 'owner_user_id must be an integer' }, 400);
  }
  if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
    return c.json({ error: 'notes must be a string' }, 400);
  }
  const att = normalizeAttachmentsInput(body.attachments);
  if (!att.ok) return c.json({ error: att.error }, 400);
  const imageUrl =
    typeof body.image_url === 'string' && body.image_url !== '' ? body.image_url : (att.firstImage ?? null);
  if (imageUrl !== null && !isSingleSegmentMediaUrl(imageUrl)) {
    return c.json({ error: 'image_url must be a /media/ key' }, 400);
  }
  let qa: Record<string, string> | null = null;
  if (body.completion_qa !== undefined && body.completion_qa !== null) {
    if (typeof body.completion_qa !== 'object' || Array.isArray(body.completion_qa)) {
      return c.json({ error: 'completion_qa must be an object' }, 400);
    }
    qa = {};
    for (const [k, v] of Object.entries(body.completion_qa as Record<string, unknown>)) {
      if (typeof v !== 'string') return c.json({ error: 'completion_qa values must be strings' }, 400);
      qa[k] = v;
    }
  }
  const started = Date.now();
  const r = await setOwnProgress(ctxOf(c), c.get('user'), {
    taskId: id,
    requestId: body.request_id as string,
    expectedRevision: expected,
    doneUnits: body.done_units,
    ...(isInt(body.owner_user_id) ? { ownerUserId: body.owner_user_id } : {}),
    notes: typeof body.notes === 'string' ? body.notes : null,
    attachmentsJson: att.json,
    imageUrl,
    completionQa: qa,
  });
  return respond(c, 'progress', id, started, { requestId: body.request_id, expected, owner: isInt(body.owner_user_id) ? body.owner_user_id : null }, r);
});

taskAllocations.post('/:id/allocation/release', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    request_id?: unknown;
    expected_revision?: unknown;
    to_user_id?: unknown;
  };
  const expected = revisionOf(body.expected_revision);
  if (expected === undefined || expected === null) {
    return c.json({ error: 'expected_revision must be an integer >= 0' }, 400);
  }
  if (body.to_user_id !== undefined && body.to_user_id !== null && !isInt(body.to_user_id)) {
    return c.json({ error: 'to_user_id must be an integer' }, 400);
  }
  const started = Date.now();
  const r = await releaseOwn(ctxOf(c), c.get('user'), {
    taskId: id,
    requestId: body.request_id as string,
    expectedRevision: expected,
    toUserId: isInt(body.to_user_id) ? body.to_user_id : null,
  });
  return respond(c, 'release', id, started, { requestId: body.request_id, expected, owner: null }, r);
});

taskAllocations.post('/:id/allocation/retake', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    request_id?: unknown;
    expected_revision?: unknown;
    units?: unknown;
  };
  const expected = revisionOf(body.expected_revision);
  if (expected === undefined || expected === null) {
    return c.json({ error: 'expected_revision must be an integer >= 0' }, 400);
  }
  if (body.units !== undefined && body.units !== null && !isInt(body.units)) {
    return c.json({ error: 'units must be an integer' }, 400);
  }
  const started = Date.now();
  const r = await retakeAllocation(ctxOf(c), c.get('user'), {
    taskId: id,
    requestId: body.request_id as string,
    expectedRevision: expected,
    units: isInt(body.units) ? body.units : null,
  });
  return respond(c, 'retake', id, started, { requestId: body.request_id, expected, owner: null }, r);
});

// POST /api/tasks/:id/allocation/parts, /claim-part — ХАСАГДСАН (эзэн 2026-10-09, 0395).  Хүнгүй хэсгийг ▶ дарж авахад
// тухайн хүн аль хэдийн хуваарилалттай бол хоёр хэсэг НЭГ мөр болж («A · B») нэг л цаг явдаг байв.  Одоо таскийг ✂-ээр
// ЖИНХЭНЭ үндсэн таскууд болгон хуваана (`POST /api/tasks/:id/root-split`, `routes/taskRootSplit.ts`).  Одоо байгаа хэсгүүд
// харагдсаар (`GET /:id/allocation`), ✂ цонх тэднийг урьдчилан бөглөж үндсэн таскууд болгоно.  Хуучин клиентэд 410.
const PARTS_RETIRED = {
  error: 'PARTS_RETIRED',
  message: 'Хүнгүй хэсэг хасагдсан — таскийг ✂ «Хуваах»-аар үндсэн таскууд болгон хуваана уу (хуудсаа шинэчилнэ үү).',
};
taskAllocations.post('/:id/allocation/parts', STAFF, retiredHandler('tasks.allocation_parts', PARTS_RETIRED));
taskAllocations.post('/:id/allocation/claim-part', STAFF, retiredHandler('tasks.allocation_claim_part', PARTS_RETIRED));

// PUT /api/tasks/:id/part-label {part_id, label} — хүнгүй хэсгийн нэрийг засна (0394).  `allocation-label`-ийн ихэр: ЗӨВХӨН
// харагдац, `task_roots.revision` хөндөгдөхгүй тул `/:id/allocation/*`-ийн хаалганаас ГАДНА.  Хоосон нэр хориотой.
taskAllocations.put('/:id/part-label', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { part_id?: unknown; label?: unknown };
  if (!isInt(body.part_id) || body.part_id <= 0) return c.json({ error: 'part_id must be a positive integer' }, 400);
  if (typeof body.label !== 'string') return c.json({ error: 'label must be a string' }, 400);
  const label = body.label.trim().replace(/\s+/g, ' ');
  if (label === '') return c.json({ error: 'label is required', code: 'LABEL_REQUIRED' }, 400);
  if (label.length > 120) return c.json({ error: 'label is too long (max 120)', code: 'LABEL_TOO_LONG' }, 400);
  const r = await c.env.DB.prepare("UPDATE task_parts SET label = ?, updated_at = datetime('now') WHERE id = ? AND task_id = ?")
    .bind(label, body.part_id, id)
    .run();
  if ((r.meta?.changes ?? 0) === 0) return c.json({ error: 'Part not found', code: 'NOT_FOUND' }, 404);
  return c.json({ ok: true, task_id: id, part_id: body.part_id, label });
});

// PUT /api/tasks/:id/name {name} — ҮНДСЭН таскийн нэрийг засна (эзэн 2026-10-12: ✂-ээр хуваагдсан үндсэн таскийн нэрийг
// төслийн хуудаснаас шууд солих).  `PUT /tasks/:id` нь жин/огноотой хамт admin/senior-д л — нэр ганцаараа бүх ажилтанд
// (✂ хуваах эрхтэй ИЖИЛ олонлог).  ЗӨВХӨН нэр: жин, явц, оноо, хуваарилалт хөндөгдөхгүй.
taskAllocations.put('/:id/name', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof body.name !== 'string') return c.json({ error: 'name must be a string' }, 400);
  const name = body.name.trim().replace(/\s+/g, ' ');
  if (name === '') return c.json({ error: 'Нэр хоосон байж болохгүй', code: 'NAME_REQUIRED' }, 400);
  if (name.length > 200) return c.json({ error: 'Нэр хэт урт (200 тэмдэгтээс ихгүй)', code: 'NAME_TOO_LONG' }, 400);
  const r = await c.env.DB.prepare('UPDATE tasks SET name = ? WHERE id = ?').bind(name, id).run();
  if ((r.meta?.changes ?? 0) === 0) return c.json({ error: 'Task not found', code: 'NOT_FOUND' }, 404);
  return c.json({ ok: true, task_id: id, name });
});

// POST /api/tasks/:id/allocation/unsplit — хуваалтыг бүхэлд нь цуцалж таскийг «огт хуваагаагүй» анхны байдалд буцаана
// (эзэн 2026-10-06, `lib/taskUnsplit.ts`).  Эрх: admin/senior/CEO; оролцогч зөвхөн бусдын хийсэн ажилгүй үед.
taskAllocations.post('/:id/allocation/unsplit', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as { request_id?: unknown };
  if (typeof body.request_id !== 'string') return c.json({ error: 'request_id is required' }, 400);
  const user = c.get('user');
  const started = Date.now();
  const r = await unsplitTask(c.env.DB, {
    actorId: user.sub,
    actorRole: user.role,
    taskId: id,
    requestId: body.request_id,
  });
  logTaskAlloc({
    evt: 'op',
    op: 'unsplit',
    correlation_id: c.get('allocCorrelationId') ?? null,
    task_id: id,
    actor_id: user.sub,
    owner_id: null,
    request_id: body.request_id,
    rev_before: null,
    contract: TASK_ALLOC_CONTRACT,
    client_contract: c.req.header(TASK_ALLOC_CONTRACT_HEADER) ?? null,
    state: c.get('allocState') ?? undefined,
    ms: Date.now() - started,
    ...opResultFields(r.ok ? { ok: true, replayed: r.replayed, revisionAfter: null } : { ok: false, status: r.status, code: r.error }),
  });
  if (!r.ok) return c.json({ error: r.error, message: r.message }, r.status);
  return c.json(r);
});

taskAllocations.get('/:id/allocation/records', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const user = c.get('user');
  const owner = user.role === 'admin' ? idOf(c.req.query('owner_user_id')) : null;
  const rec = await loadOwnRecords(c.env.DB, id, owner ?? user.sub);
  return c.json(rec, 200, { 'Cache-Control': 'private, no-store' });
});

taskAllocations.post('/:id/allocation/correct', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    request_id?: unknown;
    expected_revision?: unknown;
    items?: unknown;
    owner_user_id?: unknown;
  };
  const expected = revisionOf(body.expected_revision);
  if (expected === undefined || expected === null) {
    return c.json({ error: 'expected_revision must be an integer >= 0' }, 400);
  }
  if (!Array.isArray(body.items)) return c.json({ error: 'items must be an array' }, 400);
  const items: Array<{ sliceId: number; units?: number }> = [];
  for (const raw of body.items) {
    const o = raw as { slice_id?: unknown; units?: unknown };
    if (!isInt(o.slice_id)) return c.json({ error: 'each item needs an integer slice_id' }, 400);
    if (o.units !== undefined && o.units !== null && !isInt(o.units)) {
      return c.json({ error: 'units must be an integer' }, 400);
    }
    items.push({ sliceId: o.slice_id, ...(isInt(o.units) ? { units: o.units } : {}) });
  }
  if (body.owner_user_id !== undefined && body.owner_user_id !== null && !isInt(body.owner_user_id)) {
    return c.json({ error: 'owner_user_id must be an integer' }, 400);
  }
  const started = Date.now();
  const r = await correctOwnProgress(ctxOf(c), c.get('user'), {
    taskId: id,
    requestId: body.request_id as string,
    expectedRevision: expected,
    items,
    ...(isInt(body.owner_user_id) ? { ownerUserId: body.owner_user_id } : {}),
  });
  return respond(c, 'correct', id, started, { requestId: body.request_id, expected, owner: isInt(body.owner_user_id) ? body.owner_user_id : null }, r);
});

taskAllocations.post('/:id/allocation/restore', STAFF, async (c) => {
  const id = idOf(c.req.param('id'));
  if (id === null) return c.json({ error: 'Invalid task id' }, 400);
  const body = (await c.req.json().catch(() => ({}))) as {
    request_id?: unknown;
    expected_revision?: unknown;
    correction_request_id?: unknown;
    owner_user_id?: unknown;
    completion_qa?: unknown;
  };
  const expected = revisionOf(body.expected_revision);
  if (expected === undefined || expected === null) {
    return c.json({ error: 'expected_revision must be an integer >= 0' }, 400);
  }
  if (typeof body.correction_request_id !== 'string' || body.correction_request_id === '') {
    return c.json({ error: 'correction_request_id is required' }, 400);
  }
  if (body.owner_user_id !== undefined && body.owner_user_id !== null && !isInt(body.owner_user_id)) {
    return c.json({ error: 'owner_user_id must be an integer' }, 400);
  }
  let qa: Record<string, string> | null = null;
  if (body.completion_qa !== undefined && body.completion_qa !== null) {
    if (typeof body.completion_qa !== 'object' || Array.isArray(body.completion_qa)) {
      return c.json({ error: 'completion_qa must be an object' }, 400);
    }
    qa = {};
    for (const [k, v] of Object.entries(body.completion_qa as Record<string, unknown>)) {
      if (typeof v !== 'string') return c.json({ error: 'completion_qa values must be strings' }, 400);
      qa[k] = v;
    }
  }
  const started = Date.now();
  const r = await restoreOwnProgress(ctxOf(c), c.get('user'), {
    taskId: id,
    requestId: body.request_id as string,
    expectedRevision: expected,
    correctionRequestId: body.correction_request_id,
    completionQa: qa,
    ...(isInt(body.owner_user_id) ? { ownerUserId: body.owner_user_id } : {}),
  });
  return respond(c, 'restore', id, started, { requestId: body.request_id, expected, owner: isInt(body.owner_user_id) ? body.owner_user_id : null }, r);
});

export default taskAllocations;
