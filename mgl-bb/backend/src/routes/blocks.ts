import { Hono } from 'hono';
import {
  MAX_DUPLICATE_TASKS,
  countTree,
  duplicateStatements,
  isRequestIdConflict,
  loadOp,
  loadSourceBlock,
  parseDuplicateBody,
  teamBlockWeight,
  weightBudget,
  type DuplicateBody,
} from '../lib/blockDuplicate';
import { convertedPartBody, retiredIntoRootMany } from '../lib/taskAllocGate';
import { ROOT_PROTECTED_MESSAGE, protectedRootsIn, purgeEmptyRoots } from '../lib/taskRootGuard';
import { requireRole, requireManager } from '../middleware/auth';
import type { Env, AppVariables, BlockRow, CreateBlockRequest } from '../types';
import { recalculateProjectPoints } from './progress';

const blocks = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// GET /api/blocks?project_id=X
blocks.get('/', async (c) => {
  const projectId = c.req.query('project_id');
  if (!projectId) return c.json({ error: 'project_id required' }, 400);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM blocks WHERE project_id = ? ORDER BY sort_order',
  )
    .bind(parseInt(projectId, 10))
    .all<BlockRow>();

  return c.json({ blocks: results });
});

// POST /api/blocks (admin)
blocks.post('/', requireManager(), async (c) => {
  const body = await c.req.json<CreateBlockRequest>();
  if (!body.name || body.project_id === undefined || body.weight_percent === undefined) {
    return c.json({ error: 'name, project_id, weight_percent required' }, 400);
  }

  const maxOrder = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM blocks WHERE project_id = ?',
  )
    .bind(body.project_id)
    .first<{ max_order: number | null }>();

  const teamId =
    Number.isFinite(body.team_id as number) && (body.team_id as number) > 0
      ? Number(body.team_id)
      : null;

  const result = await c.env.DB.prepare(
    'INSERT INTO blocks (project_id, name, weight_percent, sort_order, team_id) VALUES (?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(body.project_id, body.name, body.weight_percent, (maxOrder?.max_order ?? -1) + 1, teamId)
    .first<{ id: number }>();

  return c.json({ message: 'Block created', id: result?.id }, 201);
});

/* Reorder blocks within a single project. Mirrors `tasks.put('/reorder')`:
 * take an ordered id array, batch-write sort_order = (i+1)*10. Scoped by
 * project_id so ids from a sibling project can never be touched. The
 * frontend keeps the list within a single team_id tab; cross-team moves
 * are rejected client-side.
 *
 * MUST stay registered ABOVE `blocks.put('/:id')` — otherwise '/reorder'
 * would be swallowed by the `:id` param route (id = "reorder" → NaN). */
blocks.put('/reorder', requireManager(), async (c) => {
  type Body = { project_id?: number; block_ids?: number[] };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const projectId = body.project_id;
  const ids = Array.isArray(body.block_ids) ? body.block_ids : [];
  if (projectId === undefined || ids.length === 0) {
    return c.json({ error: 'project_id and block_ids required' }, 400);
  }
  const stmt = c.env.DB.prepare(
    'UPDATE blocks SET sort_order = ? WHERE id = ? AND project_id = ?',
  );
  await c.env.DB.batch(ids.map((id, i) => stmt.bind((i + 1) * 10, id, projectId)));
  return c.json({ message: 'reordered' });
});

// PUT /api/blocks/:id (admin)
blocks.put('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<Partial<CreateBlockRequest>>();

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.name) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.weight_percent !== undefined) {
    updates.push('weight_percent = ?');
    values.push(body.weight_percent);
  }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  values.push(id);

  await c.env.DB.prepare(`UPDATE blocks SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  // A block-weight change reshapes project progress, so rebuild the
  // leaderboard ledger for the owning project.  Resolve the project id
  // from the block and recalc (best-effort — never fail the update).
  if (body.weight_percent !== undefined) {
    try {
      const owner = await c.env.DB.prepare('SELECT project_id FROM blocks WHERE id = ?')
        .bind(id)
        .first<{ project_id: number }>();
      if (owner) await recalculateProjectPoints(c.env.DB, owner.project_id);
    } catch (err) {
      console.error(`recalculateProjectPoints failed for block ${id}:`, err);
    }
  }

  return c.json({ message: 'Block updated' });
});

// DELETE /api/blocks/:id (admin)
blocks.delete('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const protectedRoots = await protectedRootsIn(c.env.DB, { kind: 'block', id });
  if (protectedRoots.length > 0) {
    return c.json({ error: 'ROOT_PROTECTED', message: ROOT_PROTECTED_MESSAGE, task_ids: protectedRoots }, 409);
  }
  await purgeEmptyRoots(c.env.DB, { kind: 'block', id });
  // ⚠️ D1 нь runtime дээр FK-г хэрэгжүүлдэггүй тул холбоосыг ГАРААР тайлна.
  // Milestone-ыг УСТГАХГҮЙ, зөвхөн холбоосыг нь салгана: хугацаа өөрөө
  // блокоос хамааралгүй утгатай (migration 0173-ын толгойг үз).  Тайлагдсан
  // мөр нь гараар тэмдэглэдэг горим руу эвтэйхэн шилжинэ.
  await c.env.DB.prepare('UPDATE project_milestones SET block_id = NULL WHERE block_id = ?')
    .bind(id)
    .run();
  await c.env.DB.prepare('DELETE FROM blocks WHERE id = ?').bind(id).run();
  return c.json({ message: 'Block deleted' });
});

// POST /api/blocks/:id/duplicate (admin, senior)
// Deep-copy a block with all drawings → components → tasks (not assignees,
// allocations or progress).  Useful when many blocks share the same template
// (e.g. identical tower structures repeating per floor).
//
// Body (all optional — old clients send `{}`):
//   name, request_id (idempotency), weight_percent (override 0–100),
//   allow_over_budget (true = the user confirmed the team's block weights
//   will exceed 100%).
// The whole tree is written in ONE `db.batch` (= one transaction) — see
// `lib/blockDuplicate.ts` for how ids are mapped without RETURNING.
blocks.post('/:id/duplicate', requireManager(), async (c) => {
  const srcId = parseInt(c.req.param('id'), 10);
  if (!Number.isSafeInteger(srcId) || srcId <= 0) return c.json({ error: 'Invalid block id' }, 400);
  const parsed = parseDuplicateBody(await c.req.json<DuplicateBody>().catch(() => ({})));
  if (!parsed.ok) return c.json({ error: parsed.error, code: parsed.code }, 400);
  const userId = Number(c.get('user').sub);
  const db = c.env.DB;

  // Idempotency: the same request_id returns the first result, never a second copy.
  const replay = async (requestId: string) => {
    const op = await loadOp(db, requestId);
    if (!op) return null;
    if (op.user_id !== userId || op.source_block_id !== srcId) {
      return c.json({ error: 'request_id already used for another request', code: 'REQUEST_REUSED' }, 409);
    }
    return c.json({ message: 'Block duplicated', id: op.new_block_id, replayed: true }, 200);
  };
  if (parsed.requestId) {
    const r = await replay(parsed.requestId);
    if (r) return r;
  }

  // ---- Preflight ----
  // Энд байгаа төсвийн шалгалт нь зөвхөн хэрэглэгчид тоог эрт харуулах UX —
  // хүчинтэй шалгалт нь batch доторх блокийн INSERT-д (зэрэг хуулалтууд).
  const src = await loadSourceBlock(db, srcId);
  if (!src) return c.json({ error: 'Block not found' }, 404);
  const counts = await countTree(db, srcId);
  if (counts.tasks > MAX_DUPLICATE_TASKS) {
    return c.json(
      { error: `Block has ${counts.tasks} tasks (max ${MAX_DUPLICATE_TASKS})`, code: 'TOO_LARGE', counts },
      413,
    );
  }
  const weight = parsed.weight ?? src.weight_percent;
  const budget = weightBudget(await teamBlockWeight(db, src.project_id, src.team_id), weight);
  if (budget.over && !parsed.allowOverBudget) {
    return c.json(
      {
        error: `Хуулбар нэмбэл энэ багийн блокуудын нийт жин ${budget.after}% болж 100%-иас хэтэрнэ`,
        code: 'WEIGHT_BUDGET_EXCEEDED',
        weight_budget: budget,
      },
      409,
    );
  }

  const requestId = parsed.requestId ?? `srv-${crypto.randomUUID()}`;
  const name = parsed.name ?? `${src.name} (хуулбар)`;
  try {
    await db.batch(
      duplicateStatements(db, {
        requestId,
        userId,
        srcId,
        name,
        weight,
        now: new Date().toISOString(),
        allowOverBudget: parsed.allowOverBudget,
      }),
    );
  } catch (err) {
    // A concurrent request with the same request_id won the race — the whole
    // batch rolled back, so return the winner's result.
    if (parsed.requestId) {
      const r = await replay(parsed.requestId);
      if (r) return r;
    }
    console.error(`[blocks] duplicate ${srcId} failed (rolled back${isRequestIdConflict(err) ? ', request_id' : ''}):`, err);
    return c.json({ error: 'Блок хуулахад алдаа гарлаа — юу ч хадгалагдаагүй', code: 'DUPLICATE_FAILED' }, 500);
  }

  const op = await loadOp(db, requestId);
  // No op row ⇒ the guarded block INSERT wrote 0 rows, so nothing was created:
  // either the source block was deleted after preflight, or a concurrent write
  // (another duplicate) pushed the team's block weights so this copy would pass 100%.
  if (!op) {
    const now = await loadSourceBlock(db, srcId);
    if (!now) return c.json({ error: 'Block not found' }, 404);
    if (parsed.allowOverBudget) {
      // The budget guard is off for this request, so 0 rows has no explained cause.
      console.error(`[blocks] duplicate ${srcId}: batch wrote no block although the source exists`);
      return c.json({ error: 'Блок хуулахад алдаа гарлаа — юу ч хадгалагдаагүй', code: 'DUPLICATE_FAILED' }, 500);
    }
    const fresh = weightBudget(await teamBlockWeight(db, now.project_id, now.team_id), weight);
    if (!fresh.over) {
      // The budget freed up again between the batch and this re-read — let the client retry.
      return c.json({ error: 'Багийн блокуудын жин өөрчлөгдсөн — дахин оролдоно уу', code: 'WEIGHT_BUDGET_CHANGED' }, 409);
    }
    return c.json(
      {
        error: `Хуулбар нэмбэл энэ багийн блокуудын нийт жин ${fresh.after}% болж 100%-иас хэтэрнэ`,
        code: 'WEIGHT_BUDGET_EXCEEDED',
        weight_budget: fresh,
      },
      409,
    );
  }
  const copied = await countTree(db, op.new_block_id);
  return c.json(
    { message: 'Block duplicated', id: op.new_block_id, counts: copied, weight_budget: budget },
    201,
  );
});

/* --------------------------------------------------------------------------
 * POST /api/blocks/:id/scaffold (admin)
 *
 * Bulk creates an entire drawing → component → task tree under the given
 * block in a single HTTP round-trip.  Frontend-side scaffolding fired ~700
 * separate POSTs which made the "Бүх бүтэц" button take ~1-2 minutes from
 * the user's network; running the inserts inside the worker collapses that
 * to a couple of seconds (no per-insert TLS handshake or auth cycle).
 *
 * Body shape — `weight_percent` is optional (defaults to 0). Each tier
 * supports two variants: create a brand-new row (carry `name` + weight
 * + children), OR attach more children to an already-existing row by
 * passing its id (`existingDrawingId` / `existingComponentId`):
 *
 *   { drawings: [
 *       // new drawing, full sub-tree
 *       { name, weight_percent?, components: [
 *           { name, weight_percent?, tasks: [ { name, weight_percent? } ] }
 *         ] },
 *       // top-up an existing drawing
 *       { existingDrawingId, components: [
 *           { existingComponentId, tasks: [ { name, weight_percent? } ] },
 *           { name, weight_percent?, tasks: [...] },
 *         ] },
 *     ] }
 *
 * Response mirrors the body but each level carries an `id` (existing or
 * freshly-assigned) and the `name` so the client can reconcile its
 * in-memory state without a refetch.
 * ------------------------------------------------------------------------ */
type ScaffoldTask = { name: string; weight_percent?: number };
type ScaffoldComponent =
  | { name: string; weight_percent?: number; tasks?: ScaffoldTask[] }
  | { existingComponentId: number; tasks?: ScaffoldTask[] };
type ScaffoldDrawing =
  | { name: string; weight_percent?: number; components?: ScaffoldComponent[] }
  | { existingDrawingId: number; components?: ScaffoldComponent[] };
type WeightUpdate = { id: number; weight_percent: number };
type ScaffoldRequest = {
  drawings: ScaffoldDrawing[];
  // Optional in-place weight refreshes for existing rows. Frontend uses
  // this to fix preset-derived rows whose stored weight drifted (e.g.
  // unit-conversion bugs in earlier scaffolds) without re-creating the
  // tree.  Each list is treated as authoritative for the listed ids.
  weightUpdates?: {
    drawings?: WeightUpdate[];
    components?: WeightUpdate[];
    tasks?: WeightUpdate[];
  };
};

const isExistingDrawing = (
  d: ScaffoldDrawing,
): d is Extract<ScaffoldDrawing, { existingDrawingId: number }> =>
  'existingDrawingId' in d && typeof d.existingDrawingId === 'number';
const isExistingComponent = (
  cp: ScaffoldComponent,
): cp is Extract<ScaffoldComponent, { existingComponentId: number }> =>
  'existingComponentId' in cp && typeof cp.existingComponentId === 'number';

/**
 * Scaffold нь `existingDrawingId` / `existingComponentId` / `weightUpdates`-ээр ӨӨР блок, ӨӨР ТӨСЛИЙН мөрийг
 * (тэр дундаа хуваарилагдсан таскийн жинг) id-гаар засаж чаддаг байв — одоо БҮХ дурдсан id энэ блокийнх эсэхийг
 * ямар ч бичилтээс ӨМНӨ шалгана.  Буцаах: олдоогүй (энэ блокийнх биш) id-ууд.
 */
export async function idsOutsideBlock(
  db: D1Database,
  blockId: number,
  want: { drawings: number[]; components: number[]; tasks: number[] },
): Promise<{ drawings: number[]; components: number[]; tasks: number[] }> {
  const CHUNK = 90;
  const missing = { drawings: [] as number[], components: [] as number[], tasks: [] as number[] };
  const check = async (kind: keyof typeof missing, ids: number[], sql: (ph: string) => string) => {
    const uniq = [...new Set(ids)];
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const chunk = uniq.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const { results } = await db
        .prepare(sql(ph))
        .bind(blockId, ...chunk)
        .all<{ id: number }>();
      const found = new Set((results ?? []).map((r) => r.id));
      for (const id of chunk) if (!found.has(id)) missing[kind].push(id);
    }
  };
  await check('drawings', want.drawings, (ph) => `SELECT d.id FROM drawings d WHERE d.block_id = ? AND d.id IN (${ph})`);
  await check(
    'components',
    want.components,
    (ph) => `SELECT c.id FROM components c JOIN drawings d ON d.id = c.drawing_id WHERE d.block_id = ? AND c.id IN (${ph})`,
  );
  await check(
    'tasks',
    want.tasks,
    (ph) =>
      `SELECT t.id FROM tasks t JOIN components c ON c.id = t.component_id JOIN drawings d ON d.id = c.drawing_id
        WHERE d.block_id = ? AND t.id IN (${ph})`,
  );
  return missing;
}

blocks.post('/:id/scaffold', requireManager(), async (c) => {
  const blockId = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(blockId)) return c.json({ error: 'Invalid block id' }, 400);

  const block = await c.env.DB.prepare('SELECT id, project_id FROM blocks WHERE id = ?')
    .bind(blockId)
    .first<{ id: number; project_id: number }>();
  if (!block) return c.json({ error: 'Block not found' }, 404);

  const body = await c.req.json<ScaffoldRequest>();
  if (!body || !Array.isArray(body.drawings)) {
    return c.json({ error: 'drawings array is required' }, 400);
  }
  const updates = body.weightUpdates ?? {};
  const drawingUpdates = Array.isArray(updates.drawings) ? updates.drawings : [];
  const componentUpdates = Array.isArray(updates.components) ? updates.components : [];
  const taskUpdates = Array.isArray(updates.tasks) ? updates.tasks : [];
  // Allow updates-only payloads (drawings: [], weightUpdates: {...}) so
  // re-running the scaffold on a fully-populated block can still refresh
  // out-of-date weights without inserting anything.
  const hasWork =
    body.drawings.length > 0 ||
    drawingUpdates.length > 0 ||
    componentUpdates.length > 0 ||
    taskUpdates.length > 0;
  if (!hasWork) {
    return c.json({ error: 'drawings array is required' }, 400);
  }

  // Бичилтээс ӨМНӨ: дурдсан бүх одоо байгаа id энэ блокийнх байх ёстой (өөр блок/төслийн мөр, хуваарилагдсан таскийн жинг
  // чимээгүй засахаас сэргийлнэ).
  {
    const bad = await idsOutsideBlock(c.env.DB, blockId, {
      drawings: [...body.drawings.filter(isExistingDrawing).map((d) => d.existingDrawingId), ...drawingUpdates.map((u) => u.id)],
      components: [
        ...body.drawings.flatMap((d) => (d.components ?? []).filter(isExistingComponent).map((cp) => cp.existingComponentId)),
        ...componentUpdates.map((u) => u.id),
      ],
      tasks: taskUpdates.map((u) => u.id),
    });
    if (bad.drawings.length + bad.components.length + bad.tasks.length > 0) {
      return c.json({ error: 'Зарим id энэ блокийнх биш байна', code: 'NOT_IN_BLOCK', ...bad }, 400);
    }
  }

  // Жин нь ЗААВАЛ төгсгөлөг, сөрөг биш тоо (мөр, NaN, Infinity баганад орвол жигнэсэн явц/оноо эвдэрнэ).  Заагаагүй = 0 (хуучин зан).
  for (const [kind, list] of [['drawings', drawingUpdates], ['components', componentUpdates], ['tasks', taskUpdates]] as const) {
    for (const u of list) {
      const w = (u as { weight_percent?: unknown }).weight_percent;
      if (w !== undefined && w !== null && (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 100_000)) {
        return c.json({ error: 'weight_percent must be a finite number >= 0', code: 'BAD_WEIGHT', kind, id: (u as { id?: unknown }).id }, 400);
      }
    }
  }
  // Нэгтгэгдсэн хэсэг (хөрвүүлэлт, 0385): жинг нь сэргээвэл root-той ДАВХАР тоологдоно — `PUT /tasks/:id`-тэй ижил хаалт.
  if (taskUpdates.length > 0) {
    const retired = await retiredIntoRootMany(c.env.DB, taskUpdates.map((u) => u.id));
    const first = taskUpdates.find((u) => retired.has(Number(u.id)));
    if (first) return c.json(convertedPartBody(Number(first.id), block.project_id, retired.get(Number(first.id))!), 409);
  }

  // ---- LEVEL 1 — drawings ----
  // Figure out the next sort_order under this block so freshly-created
  // drawings append rather than overwrite anything that's already there.
  const maxDrawSort = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM drawings WHERE block_id = ?',
  )
    .bind(blockId)
    .first<{ m: number }>();
  let dSort = (maxDrawSort?.m ?? -1) + 1;

  const drawingStmt = c.env.DB.prepare(
    `INSERT INTO drawings (block_id, name, weight_percent, sort_order)
     VALUES (?, ?, ?, ?) RETURNING id`,
  );
  const componentStmt = c.env.DB.prepare(
    `INSERT INTO components (drawing_id, name, weight_percent, sort_order)
     VALUES (?, ?, ?, ?) RETURNING id`,
  );
  const taskStmt = c.env.DB.prepare(
    `INSERT INTO tasks (component_id, name, weight_percent, sort_order)
     VALUES (?, ?, ?, ?) RETURNING id`,
  );

  // Bind only the create-new drawings into the level-1 batch; existing
  // ones reuse their id directly. We keep request-order alignment via
  // `drawingIds` indexed by the original request slot.
  type CreateDrawing = { reqIdx: number; name: string; weight: number };
  const drawingsToCreate: CreateDrawing[] = [];
  body.drawings.forEach((dr, idx) => {
    if (!isExistingDrawing(dr)) {
      drawingsToCreate.push({
        reqIdx: idx,
        name: dr.name,
        weight: dr.weight_percent ?? 0,
      });
    }
  });
  const drawingBatch = drawingsToCreate.map((d) =>
    drawingStmt.bind(blockId, d.name, d.weight, dSort++),
  );
  const drawingCreateResults = drawingBatch.length
    ? await c.env.DB.batch<{ id: number }>(drawingBatch)
    : [];

  const drawingIds: number[] = body.drawings.map(() => 0);
  // Splice freshly-inserted ids back into their original request slot.
  drawingsToCreate.forEach((d, i) => {
    drawingIds[d.reqIdx] = drawingCreateResults[i]?.results?.[0]?.id ?? 0;
  });
  // Existing drawings just pass their id through.
  body.drawings.forEach((dr, idx) => {
    if (isExistingDrawing(dr)) drawingIds[idx] = dr.existingDrawingId;
  });

  // ---- LEVEL 2 — components ----
  // For new drawings the next sort_order is just 0 (their components are
  // a fresh list). For existing drawings we need the current MAX so we
  // append. One round-trip aggregates them all.
  const existingDrawingIdsForLookup = body.drawings
    .filter(isExistingDrawing)
    .map((d) => d.existingDrawingId);
  const compMaxByDrawing = new Map<number, number>();
  if (existingDrawingIdsForLookup.length > 0) {
    const placeholders = existingDrawingIdsForLookup.map(() => '?').join(',');
    const rows = await c.env.DB.prepare(
      `SELECT drawing_id AS d, MAX(sort_order) AS m FROM components
       WHERE drawing_id IN (${placeholders}) GROUP BY drawing_id`,
    )
      .bind(...existingDrawingIdsForLookup)
      .all<{ d: number; m: number }>();
    for (const r of rows.results ?? []) compMaxByDrawing.set(r.d, r.m);
  }

  // Per-drawing rolling sort cursor — starts at 0 for new drawings and at
  // existing-max+1 for re-runs against an already-populated drawing.
  const compSortCursor = new Map<number, number>();
  body.drawings.forEach((dr, idx) => {
    const drId = drawingIds[idx];
    if (!drId) return;
    if (isExistingDrawing(dr)) {
      compSortCursor.set(drId, (compMaxByDrawing.get(drId) ?? -1) + 1);
    } else {
      compSortCursor.set(drId, 0);
    }
  });

  type CompFlat = {
    drawIdx: number;
    cIdx: number;
    reuseId: number;
    name: string;
    weight: number;
    sort: number;
  };
  const compFlat: CompFlat[] = [];
  body.drawings.forEach((dr, dIdx) => {
    const drId = drawingIds[dIdx];
    if (!drId) return;
    (dr.components ?? []).forEach((comp, cIdx) => {
      if (isExistingComponent(comp)) {
        compFlat.push({
          drawIdx: dIdx,
          cIdx,
          reuseId: comp.existingComponentId,
          name: '',
          weight: 0,
          sort: -1,
        });
      } else {
        const sort = compSortCursor.get(drId) ?? 0;
        compSortCursor.set(drId, sort + 1);
        compFlat.push({
          drawIdx: dIdx,
          cIdx,
          reuseId: 0,
          name: comp.name,
          weight: comp.weight_percent ?? 0,
          sort,
        });
      }
    });
  });

  const componentBatch = compFlat
    .filter((c) => c.reuseId === 0)
    .map((c) => componentStmt.bind(drawingIds[c.drawIdx], c.name, c.weight, c.sort));
  const componentResults = componentBatch.length
    ? await c.env.DB.batch<{ id: number }>(componentBatch)
    : [];

  // Walk compFlat in the same order so each new-component insert's id
  // lines up with its slot; existing components keep their reuseId.
  const compIds: number[] = [];
  let cResIdx = 0;
  for (const cf of compFlat) {
    if (cf.reuseId) {
      compIds.push(cf.reuseId);
    } else {
      compIds.push(componentResults[cResIdx]?.results?.[0]?.id ?? 0);
      cResIdx++;
    }
  }

  // ---- LEVEL 3 — tasks ----
  // Same dance: figure out per-existing-component MAX(sort_order), build
  // one batch insert across all new tasks.
  const existingComponentIds = compFlat.filter((c) => c.reuseId).map((c) => c.reuseId);
  const taskMaxByComponent = new Map<number, number>();
  if (existingComponentIds.length > 0) {
    const placeholders = existingComponentIds.map(() => '?').join(',');
    const rows = await c.env.DB.prepare(
      `SELECT component_id AS c, MAX(sort_order) AS m FROM tasks
       WHERE component_id IN (${placeholders}) GROUP BY component_id`,
    )
      .bind(...existingComponentIds)
      .all<{ c: number; m: number }>();
    for (const r of rows.results ?? []) taskMaxByComponent.set(r.c, r.m);
  }

  // Initialize per-component task-sort cursors.
  const taskSortCursor = new Map<number, number>();
  for (let i = 0; i < compFlat.length; i++) {
    const compId = compIds[i];
    const cf = compFlat[i];
    if (!compId || !cf) continue;
    if (cf.reuseId) {
      taskSortCursor.set(compId, (taskMaxByComponent.get(compId) ?? -1) + 1);
    } else {
      taskSortCursor.set(compId, 0);
    }
  }

  type TaskFlat = { compFlatIdx: number; tIdx: number; name: string; weight: number; sort: number };
  const taskFlat: TaskFlat[] = [];
  compFlat.forEach((cf, cfIdx) => {
    const dr = body.drawings[cf.drawIdx];
    if (!dr) return;
    const comp = (dr.components ?? [])[cf.cIdx];
    if (!comp) return;
    const compId = compIds[cfIdx];
    if (!compId) return;
    (comp.tasks ?? []).forEach((t, tIdx) => {
      const sort = taskSortCursor.get(compId) ?? 0;
      taskSortCursor.set(compId, sort + 1);
      taskFlat.push({
        compFlatIdx: cfIdx,
        tIdx,
        name: t.name,
        weight: t.weight_percent ?? 0,
        sort,
      });
    });
  });

  const taskBatch = taskFlat.map((t) =>
    taskStmt.bind(compIds[t.compFlatIdx], t.name, t.weight, t.sort),
  );
  const taskResults = taskBatch.length ? await c.env.DB.batch<{ id: number }>(taskBatch) : [];
  const taskIds = taskFlat.map((_, i) => taskResults[i]?.results?.[0]?.id ?? 0);

  // ---- Reassemble nested response ----
  type DrawingOut = {
    id: number;
    name: string;
    components: { id: number; name: string; tasks: { id: number; name: string }[] }[];
  };
  const out: DrawingOut[] = [];
  let cfCursor = 0;
  let tfCursor = 0;
  body.drawings.forEach((dr, dIdx) => {
    const dName = isExistingDrawing(dr)
      ? '' // Caller already knows the name; an empty string is harmless.
      : dr.name;
    const drawingOut: DrawingOut = {
      id: drawingIds[dIdx] ?? 0,
      name: dName,
      components: [],
    };
    (dr.components ?? []).forEach((comp) => {
      const compId = compIds[cfCursor] ?? 0;
      const cName = isExistingComponent(comp) ? '' : comp.name;
      const compOut = { id: compId, name: cName, tasks: [] as { id: number; name: string }[] };
      (comp.tasks ?? []).forEach((t) => {
        compOut.tasks.push({ id: taskIds[tfCursor] ?? 0, name: t.name });
        tfCursor++;
      });
      drawingOut.components.push(compOut);
      cfCursor++;
    });
    out.push(drawingOut);
  });

  // ---- LEVEL 4 — weight refreshes for already-existing rows ----
  // Single batch across drawings/components/tasks. We don't validate that
  // the ids belong to this block — only admins can hit this route, and
  // the frontend resolves ids from the same block it just rendered.
  const updateBatch = [
    ...drawingUpdates.map((u) =>
      c.env.DB.prepare('UPDATE drawings SET weight_percent = ? WHERE id = ?').bind(
        u.weight_percent ?? 0,
        u.id,
      ),
    ),
    ...componentUpdates.map((u) =>
      c.env.DB.prepare('UPDATE components SET weight_percent = ? WHERE id = ?').bind(
        u.weight_percent ?? 0,
        u.id,
      ),
    ),
    ...taskUpdates.map((u) =>
      c.env.DB.prepare('UPDATE tasks SET weight_percent = ? WHERE id = ?').bind(
        u.weight_percent ?? 0,
        u.id,
      ),
    ),
  ];
  if (updateBatch.length > 0) {
    await c.env.DB.batch(updateBatch);
  }

  // The scaffold just changed the block's structure and/or weights, both
  // of which feed project progress — rebuild the leaderboard ledger for
  // the owning project (best-effort, never fail the scaffold).
  try {
    await recalculateProjectPoints(c.env.DB, block.project_id);
  } catch (err) {
    console.error(`recalculateProjectPoints failed for project ${block.project_id}:`, err);
  }

  return c.json({ block_id: blockId, drawings: out }, 201);
});

export default blocks;
