import { Hono } from 'hono';
import { requireRole, requireManager } from '../middleware/auth';
import { recalculateProjectPoints } from './progress';
import { loadHoldDays } from '../lib/taskHoldStore';
import { pauseOfficialTimer, stopOfficialTimersForTask } from '../lib/taskTimerStore';
import { takeTask } from '../lib/taskTakeService';
import { enforceManagedTaskWrite } from '../middleware/taskAllocGuard';
import { convertedPartBody, retiredIntoRoot } from '../lib/taskAllocGate';
import { ROOT_PROTECTED_MESSAGE, protectedRootsIn, purgeEmptyRoots } from '../lib/taskRootGuard';
import { retiredHandler } from '../lib/retiredHits';
import { findWeightHeir, inheritWeightStatement } from '../lib/taskRootSplitStore';
import { reconcileCreditOrEnqueue } from '../lib/taskCreditReconcileQueue';
import { validateNewTask } from '../lib/taskInput';
import type { Env, AppVariables, TaskRow, CreateTaskRequest } from '../types';

const tasks = new Hono<{ Bindings: Env; Variables: AppVariables }>();

/*
 * ТАСК ДЭЭРХ НЭР = ОДОО ХИЙЖ БУЙ ХҮН (эзний шийдвэр 2026-10-01, migration 0368/0369).
 *
 *   • Байнгын «хариуцагч» гэж БАЙХГҮЙ.  Таск дээр харагдах нэр = албан таймер нь
 *     тэр таск дээр ОДОО явж буй хүн (`task_timer_sessions`, `ended_at IS NULL`).
 *   • «Өөртөө авах» (`POST /:id/claim` = `POST /api/task-timer/start`) = таймер
 *     эхэлнэ; өөр таск дээрх нь АТОМ зогсоно.  Хязгааргүй, ирцтэй байх.  Дүрэм
 *     `lib/taskTakeService.ts` — ганц газар.
 *   • Хуваагдах таск дээр өөр хүн ажиллаж байвал «Өөртөө авах» 409 TASK_OCCUPIED
 *     + өгөгдмөл буцаана; UI хуваарилалтын засварлагч нээнэ (`POST /:id/allocation/split`,
 *     `routes/taskAllocations.ts`).  Хуучин `POST /:id/split` (шинэ таск үүсгэдэг) 2026-10-02-нд ХАСАГДСАН (410).
 *   • `task_assignees` = «энэ таск дээр ажиллаж байсан хүмүүс»-ийн БҮРТГЭЛ (түүх)
 *     — таймер эхлэх бүрт мөр нэмэгдэнэ (`startOfficialTimer`).  Ахлах/админ оноох
 *     боломж ХАСАГДСАН: `/share`, `/unassign` 410; `POST /`, `PUT /:id` нь
 *     `assignees`/`assigned_to`-г үл тоомсорлоно (setup хуудасны хуучин клиент
 *     илгээсээр байж болно).  `tasks.assigned_to` цаашид бичигдэхгүй.
 *   • Хувь оруулах = тухайн таск дээр албан таймерын сэшнтэй хүн (admin залруулга
 *     хэвээр) — `routes/progress.ts` `submitProgressEntry`.
 */

/** Оноох замуудын хариу (2026-10-01-ээс). */
const ASSIGNMENT_REMOVED =
  'Таскийг хүнд оноох боломж хасагдсан — ажилтан төслийн хуудаснаас өөрөө ▶ дарж (цаг эхлүүлж) ажиллана.';

// GET /api/tasks/hold-days?project_id=N | ?mine=1 — таск дээр зарцуулсан
// ажлын өдөр (0350, дүрэм `lib/taskHold.ts`).  ⚠️ 2026-10-01-ээс frontend
// дуудахаа больсон: байнгын эзэмшил байхгүй тул «эзэмшсэн өдөр» утгаа алдсан
// (`task_assignees` нь одоо ажилласан хүмүүсийн бүртгэл).  Хуучин холбоосонд
// хариулсаар байна.
tasks.get('/hold-days', async (c) => {
  const user = c.get('user');
  const projectId = parseInt(c.req.query('project_id') ?? '', 10);
  const mine = c.req.query('mine') === '1';
  if (!mine && !(Number.isFinite(projectId) && projectId > 0)) {
    return c.json({ error: 'project_id or mine=1 required' }, 400);
  }
  const rows = await loadHoldDays(c.env.DB, mine ? { userId: user.sub } : { projectId });
  return c.json({ rows }, 200, { 'Cache-Control': 'private, no-store' });
});

tasks.get('/', async (c) => {
  const componentId = c.req.query('component_id');
  if (!componentId) return c.json({ error: 'component_id required' }, 400);

  const compId = parseInt(componentId, 10);

  const [tasksRes, assigneesRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT t.*, u.full_name as assigned_name, cv.root_task_id AS retired_into FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN task_conversion_members cm ON cm.task_id = t.id AND cm.role = 'retired'
       LEFT JOIN task_conversions cv ON cv.id = cm.conversion_id AND cv.status = 'applied'
       WHERE t.component_id = ? ORDER BY t.sort_order`,
    )
      .bind(compId)
      .all<TaskRow & { assigned_name: string | null; retired_into: number | null }>(),
    c.env.DB.prepare(
      `SELECT ta.task_id, ta.user_id, u.full_name
       FROM task_assignees ta
       INNER JOIN tasks t ON t.id = ta.task_id
       INNER JOIN users u ON u.id = ta.user_id
       WHERE t.component_id = ?`,
    )
      .bind(compId)
      .all<{ task_id: number; user_id: number; full_name: string }>(),
  ]);

  // Group assignees by task_id so the client can render all of them.
  const byTask = new Map<number, Array<{ user_id: number; full_name: string }>>();
  for (const row of assigneesRes.results) {
    const arr = byTask.get(row.task_id) ?? [];
    arr.push({ user_id: row.user_id, full_name: row.full_name });
    byTask.set(row.task_id, arr);
  }

  const enriched = tasksRes.results.map((t) => ({
    ...t,
    assignees: byTask.get(t.id) ?? [],
  }));

  return c.json({ tasks: enriched });
});

tasks.post('/', requireManager(), async (c) => {
  const raw = await c.req.json<unknown>().catch(() => null);
  // Төрлийг ажиллах үед шалгана (lib/taskInput.ts) — урьд нь мөр/NaN/сөрөг жин, 10 000 тэмдэгтийн нэр, буруу огноо шууд
  // баганад ордог байв (PUT /:id-д BAD_WEIGHT шалгалт аль хэдийн бий, POST-д байгаагүй).
  const v = validateNewTask(raw);
  if (!v.ok) return c.json({ error: v.error, code: v.code }, 400);
  const body = v.value;

  // D1 гадаад түлхүүрийг ажиллах үед шалгадаггүй — байхгүй бүрэлдэхүүнд таск үүсвэл эзэнгүй мөр болж үлдэнэ.
  const comp = await c.env.DB.prepare('SELECT id FROM components WHERE id = ?').bind(body.component_id).first();
  if (!comp) return c.json({ error: 'Бүрэлдэхүүн олдсонгүй', code: 'COMPONENT_NOT_FOUND' }, 404);

  const maxOrder = await c.env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM tasks WHERE component_id = ?',
  )
    .bind(body.component_id)
    .first<{ max_order: number | null }>();

  // 2026-10-01: хариуцагч ОНООХГҮЙ — `assignees` / `assigned_to` ирсэн ч үл тоомсорлоно.
  const result = await c.env.DB.prepare(
    `INSERT INTO tasks (component_id, name, weight_percent, due_date, start_date, sort_order)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      body.component_id,
      body.name,
      body.weight_percent,
      body.due_date ?? null,
      body.start_date ?? null,
      (maxOrder?.max_order ?? -1) + 1,
    )
    .first<{ id: number }>();

  return c.json({ message: 'Task created', id: result?.id }, 201);
});

/* Reorder tasks within a single component. Mirrors the proven reorder
 * pattern used for quote-template sections (quotes.ts) and report-template
 * blocks (reportTemplates.ts): take an ordered id array, batch-write
 * sort_order = (i+1)*10. Scoped by component_id so a stray id from another
 * component can never be touched.
 *
 * MUST stay registered ABOVE `tasks.put('/:id')` — otherwise '/reorder'
 * would be swallowed by the `:id` param route (id = "reorder" → NaN). */
tasks.put('/reorder', requireManager(), async (c) => {
  type Body = { component_id?: number; task_ids?: number[] };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  const componentId = body.component_id;
  const ids = Array.isArray(body.task_ids) ? body.task_ids : [];
  if (componentId === undefined || ids.length === 0) {
    return c.json({ error: 'component_id and task_ids required' }, 400);
  }
  const stmt = c.env.DB.prepare(
    'UPDATE tasks SET sort_order = ? WHERE id = ? AND component_id = ?',
  );
  await c.env.DB.batch(ids.map((id, i) => stmt.bind((i + 1) * 10, id, componentId)));
  return c.json({ message: 'reordered' });
});

tasks.put('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<Partial<CreateTaskRequest>>();
  // Нэгтгэгдсэн хэсгийн жин/хугацааг засвал root-той давхар тоологдоно — хөрвүүлэлтийг буцаах л зам.
  const retiredInto = await retiredIntoRoot(c.env.DB, id);
  if (retiredInto !== null) return c.json(convertedPartBody(id, null, retiredInto), 409);
  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name) {
    updates.push('name = ?');
    values.push(body.name);
  }
  if (body.weight_percent !== undefined) {
    // ⚠️ Урьд нь ямар ч утга (мөр, NaN, сөрөг) шууд баганад ордог байв — managed root-ийн коэффициент NaN болж оноо эвдэнэ.
    const w = body.weight_percent as unknown;
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0 || w > 100_000) {
      return c.json({ error: 'weight_percent must be a finite number >= 0', code: 'BAD_WEIGHT' }, 400);
    }
    updates.push('weight_percent = ?');
    values.push(w);
  }
  if (body.due_date !== undefined) {
    updates.push('due_date = ?');
    values.push(body.due_date ?? null);
  }
  if (body.start_date !== undefined) {
    updates.push('start_date = ?');
    values.push(body.start_date ?? null);
  }
  // `assignees` / `assigned_to` — 2026-10-01-ээс ҮЛ ТООМСОРЛОНО (оноох боломж
  // хасагдсан; setup хуудасны хуучин клиент илгээсээр байж болох тул 400 биш).

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }
  values.push(id);
  await c.env.DB.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  // Хуваарилагдсан (managed) таскийн жин өөрчлөгдвөл оноог ЖУРНАЛААС шинэ коэффициенттэй тулгана
  // (lib/taskCreditReweight.ts).  Managed биш таскт юу ч хийхгүй.  Алдаа жин засварыг унагахгүй — аудитор «credit drift»
  // гэж харуулна, админ `alloc-admin/credit/reweight`-ээр дахин ажиллуулна.
  if (body.weight_percent !== undefined) {
    // Унавал `task_credit_reconcile_queue`-д үлдэж cron дахин оролдоно (lib/taskCreditReconcileQueue.ts).
    await reconcileCreditOrEnqueue(c.env.DB, 'task', id, c.get('user').sub);
  }
  return c.json({ message: 'Task updated' });
});

tasks.delete('/:id', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  // Хуваарилагдсан («managed») үндсэн ажил: хийсэн хэсэг, оноо, цагийн түүхтэй бол УСТГАХГҮЙ — ямар ч
  // цэвэрлэгээ бичихээс ӨМНӨ (эзний шийдвэр 2026-10-02).  Түүхгүй бол хуваарилалтын мөрийг гараар цэвэрлээд устгана.
  const protectedRoots = await protectedRootsIn(c.env.DB, { kind: 'task', id });
  if (protectedRoots.length > 0) {
    return c.json({ error: 'ROOT_PROTECTED', message: ROOT_PROTECTED_MESSAGE, task_ids: protectedRoots }, 409);
  }
  await purgeEmptyRoots(c.env.DB, { kind: 'task', id });
  // ⚠️ D1 нь runtime дээр foreign key-г ХЭРЭГЖҮҮЛДЭГГҮЙ тул
  // `task_deadlines.task_id`-ийн `ON DELETE CASCADE` нь зөвхөн зарлал —
  // дэд хугацааны мөрүүдийг ГАРААР устгана, эс бөгөөс өнчин мөр үлдэж
  // `/api/deadlines/upcoming`-д мөнхөд цухуйна (migration 0148-ийг үз).
  // Энэ бол репогийн тогтсон конвенц: email.ts / calendar.ts / pgp.ts /
  // repair.ts бүгд хүүхэд мөрөө гараар цэвэрлэдэг.
  await c.env.DB.prepare('DELETE FROM task_deadlines WHERE task_id = ?').bind(id).run();
  // Мөн адил: `task_checklist_items.task_id`-ийн CASCADE нь зөвхөн зарлал
  // (migration 0177) — хувийн checklist-ийн мөрүүдийг ГАРААР устгана.
  await c.env.DB.prepare('DELETE FROM task_checklist_items WHERE task_id = ?').bind(id).run();
  // Хамтарсан ажлын хуваарилалт (migration 0322) — мөн гараар.
  await c.env.DB.prepare('DELETE FROM task_shares WHERE task_id = ?').bind(id).run();
  // Ажилласан хүмүүсийн бүртгэл (0369-өөс `task_assignees`) — мөн гараар (өнчин
  // мөр «Миний ажлууд»-ын түүхэнд устсан таск болж үлдэхгүйн тулд).
  await c.env.DB.prepare('DELETE FROM task_assignees WHERE task_id = ?').bind(id).run();
  // Таск дээр зарцуулсан өдрийн түүх (0350) — FK-гүй тул гараар.
  await c.env.DB.prepare('DELETE FROM task_hold_periods WHERE task_id = ?')
    .bind(id)
    .run()
    .catch(() => undefined);
  // «Миний ажлууд»-ын хувийн жагсаалт (0370) — FK-гүй тул гараар.
  await c.env.DB.prepare('DELETE FROM task_personal_list WHERE task_id = ?')
    .bind(id)
    .run()
    .catch((err: unknown) => console.error('[my-task-list] cleanup on task delete failed', err));
  // «Таскийг буцаах» (0386) архив — FK-гүй тул гараар.
  await c.env.DB.prepare('DELETE FROM task_retractions WHERE task_id = ?')
    .bind(id)
    .run()
    .catch(() => undefined);
  // «Хуваалтыг цуцлах» (0387) архив — FK-гүй тул гараар.
  await c.env.DB.prepare('DELETE FROM task_unsplits WHERE task_id = ?')
    .bind(id)
    .run()
    .catch(() => undefined);
  // Milestone-ийн таск холбоос (migration 0173) — УСТГАХГҮЙ, зөвхөн тайлна.
  // «Экспертиз дуусах» гэсэн хугацаа нь түүнийг хэмждэг таск устсан ч
  // хэвээр утгатай; тайлагдсаны дараа гараар тэмдэглэдэг горимд шилжинэ.
  await c.env.DB.prepare('UPDATE project_milestones SET task_id = NULL WHERE task_id = ?')
    .bind(id)
    .run();
  // Засварын цагийн таск холбоос (migration 0341) — мөн адил ТАЙЛНА: ажилласан
  // цаг нь төслийн түвшинд үлдэнэ, оноо/явц хөдлөхгүй.
  await c.env.DB.prepare('UPDATE repair_entries SET task_id = NULL WHERE task_id = ?')
    .bind(id)
    .run();
  // «Ажилласан» тэмдэглэгээ (0348) — мөн тайлна (төслийн түвшний тэмдэглэгээ болно).
  await c.env.DB.prepare('UPDATE repair_marks SET task_id = NULL WHERE task_id = ?')
    .bind(id)
    .run();
  // Албан ёсны таймер (0361) — явж буйг ЗОГСООНО, сэшнүүд нь (аудит, өдрийн
  // тайлан) УСТАХГҮЙ.  Хүснэгтгүй орчинд (миграцаас өмнө) устгалыг унагахгүй.
  await stopOfficialTimersForTask(c.env.DB, {
    taskId: id,
    actorId: c.get('user').sub,
    nowIso: new Date().toISOString(),
    requestId: crypto.randomUUID(),
    reason: 'auto_stop_deleted',
  }).catch((err: unknown) => console.error('[task-timer] auto-stop on task delete failed', err));
  // ✂-ээр хуваагдсан хэсэг бол жин нь хуваалтын үлдсэн хэсэг рүү буцна (эзэн 2026-10-12) — эс бөгөөс жин төслөөс алга
  // болж үлдсэн таск, төслийн явц дутуу харагддаг байв.  Нэмэх + устгах НЭГ batch (дунд нь тасарвал жин давхардахгүй).
  const heir = await findWeightHeir(c.env.DB, id).catch((err: unknown) => {
    console.error('[tasks] weight heir lookup failed', err);
    return null;
  });
  if (heir) {
    await c.env.DB.batch([inheritWeightStatement(c.env.DB, id, heir.heir_id), c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id)]);
    // Өв залгагч хуваарилагдсан (managed) бол оноог шинэ жингээр тулгана — `PUT /:id`-ийн жин засвартай ижил.
    await reconcileCreditOrEnqueue(c.env.DB, 'task', heir.heir_id, c.get('user').sub);
    return c.json({
      message: 'Task deleted',
      weight_merged_into: { id: heir.heir_id, name: heir.heir_name, weight: heir.weight },
    });
  }
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
  return c.json({ message: 'Task deleted', weight_merged_into: null });
});

// POST /api/tasks/:id/split — ХАСАГДСАН (2026-10-02).
//
// Хуучин урсгал таскийн ДОТООД ЖИНГ хуваагаад шинэ таск (хуулбар «(i/N)») үүсгэдэг байв.  Эзний шийдвэр: нэг таск
// = НЭГ үндсэн ажил (100%), дотоод жин `W` хэзээ ч өөрчлөгдөхгүй, шинэ таск үүсэхгүй — хүн бүрт ХУВААРИЛАЛТ
// (`task_allocations`) олгогдоно: `POST /api/tasks/:id/allocation/split` (`routes/taskAllocations.ts`).
// Хуучин клиентэд (кэштэй хуудас, гадаад скрипт) ойлгомжтой 410 буцаана — ЮУ Ч бичихгүй.
tasks.post(
  '/:id/split',
  requireRole('admin', 'senior', 'engineer', 'architect'),
  retiredHandler('tasks.split', {
    error: 'SPLIT_RETIRED',
    message:
      'Таск хуваах хуучин арга (шинэ таск үүсгэдэг) хасагдсан — «Хуваарилах» (POST /api/tasks/:id/allocation/split) ашиглана уу.',
  }),
);

// POST /api/tasks/:id/baseline (admin only)
//
// Carry-over from old Excel tracking: admin marks "this task is already
// at X%" without an author or date.  Implemented as a single
// `progress_entries` row with `is_baseline = 1` and status='approved' so
// every existing roll-up (project overview, MyTasksPage, latest-%
// lookups) treats it like real progress.  Leaderboard points for the
// baseline delta are credited to `credit_user_id` (0368: frozen at the
// time of the reset) — a new baseline set after 2026-10-01 has nobody
// holding the task, so it credits the task's most recent contributor
// (registry row), or nobody.
//
// Behaviour:
//   • percentage 0..100 (clamped, rejected if NaN/out-of-range)
//   • removes any prior baseline row for this task (only one allowed)
//   • when percentage > 0, inserts a fresh baseline row stamped with
//     the calling admin as author/reviewer (audit trail) and today's
//     UB date — but the UI must NOT show this as "Bat finished it on
//     April 25".  Frontend reads `is_baseline` and shows a neutral
//     "Анхны явц" badge instead.
//   • when percentage = 0, only the cleanup runs — useful for zeroing
//     out a mistakenly-set baseline.
//
// We do not pre-check "task has worker submissions" — admins are
// allowed to override at any point; the latest-by-created_at lookup
// naturally makes the new baseline win.  If that's surprising we'll
// add a confirm in the UI rather than blocking server-side.
tasks.post('/:id/baseline', requireManager(), async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: 'Invalid task id' }, 400);
  }
  const admin = c.get('user');
  const body = await c.req
    .json<{ percentage?: number }>()
    .catch(() => ({}) as { percentage?: number });
  const raw = Number(body?.percentage);
  if (!Number.isFinite(raw)) {
    return c.json({ error: 'percentage must be a number 0..100' }, 400);
  }
  // Clamp at the boundaries so a tiny float drift (100.0000001) doesn't
  // throw and the admin's intent ("100%") is honoured verbatim.
  const pct = Math.max(0, Math.min(100, raw));

  // Confirm the task actually exists so we don't silently insert
  // dangling progress rows for a deleted task id.
  const exists = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ?')
    .bind(id)
    .first<{ id: number }>();
  if (!exists) return c.json({ error: 'Task not found' }, 404);
  // Хуваарилагдсан («managed») таскийн «Анхны явц»-ыг энд бичихгүй — root-ийн хувь нь хүн бүрийн хэсгийн нийлбэр,
  // хуучин баримтыг (credit_user_id) дахин бичих нь оноо/түүхийг эвдэнэ.
  // ⚠️ Алдааг `null` болгож залгихгүй (fail-open байв): D1 унавал baseline бичигдэхгүй, 500 — managed root-ийн түүхийг дахин бичихээс аюулгүй.
  const managedRoot = await c.env.DB.prepare('SELECT 1 AS x FROM task_roots WHERE task_id = ?').bind(id).first();
  if (managedRoot) {
    return c.json(
      { error: 'MANAGED_ROOT', message: 'Хуваарилагдсан таскийн анхны явцыг энд өөрчлөх боломжгүй.' },
      409,
    );
  }
  const retiredInto = await retiredIntoRoot(c.env.DB, id);
  if (retiredInto !== null) return c.json(convertedPartBody(id, null, retiredInto), 409);

  // The owning project, used to refresh the leaderboard ledger after the
  // baseline change.  Null when the task isn't wired into a block/project
  // (orphan) — then we just skip the recalc.
  const chain = await c.env.DB.prepare(
    `SELECT b.project_id AS project_id
     FROM tasks t
     JOIN components c ON c.id = t.component_id
     JOIN drawings d   ON d.id = c.drawing_id
     JOIN blocks b     ON b.id = d.block_id
     WHERE t.id = ?`,
  )
    .bind(id)
    .first<{ project_id: number }>();
  const projectId = chain?.project_id ?? null;

  // Always wipe the prior baseline first — there is at most one per task.
  await c.env.DB.prepare(`DELETE FROM progress_entries WHERE task_id = ? AND is_baseline = 1`)
    .bind(id)
    .run();

  let entryId: number | null = null;
  if (pct > 0) {
    const today = new Date().toISOString().slice(0, 10);
    // Онооны эзэн: энэ таск дээр хамгийн сүүлд ажилласан хүн (бүртгэл) —
    // байнгын хариуцагч 2026-10-01-ээс байхгүй.
    const credit = await c.env.DB.prepare(
      `SELECT user_id FROM task_assignees WHERE task_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(id)
      .first<{ user_id: number }>();
    const res = await c.env.DB.prepare(
      `INSERT INTO progress_entries
         (task_id, user_id, percentage, date, notes,
          status, reviewed_by, reviewed_at, image_url,
          is_rest_day, defer_next_day, is_baseline, credit_user_id)
       VALUES (?, ?, ?, ?, ?, 'approved', ?, datetime('now'), NULL, 0, 0, 1, ?)`,
    )
      .bind(
        id,
        admin.sub,
        pct,
        today,
        '[Анхны явц] Excel-ээс шилжүүлсэн — гүйцэтгэгч/огноо тодорхойгүй',
        admin.sub,
        credit?.user_id ?? null,
      )
      .run();
    entryId = Number(res.meta.last_row_id);
  }

  // Refresh the project's leaderboard ledger so the baseline change is
  // reflected: a new baseline credits `credit_user_id`, a cleared one
  // removes that credit.  Wrapped so a leaderboard hiccup never fails the
  // (already-successful) baseline write.
  if (projectId !== null) {
    try {
      await recalculateProjectPoints(c.env.DB, projectId);
    } catch (err) {
      console.error('baseline recalc failed', { taskId: id, projectId, err });
    }
  }

  return c.json({
    message: pct > 0 ? 'Анхны явц хадгалагдлаа' : 'Анхны явц цэвэрлэгдлээ',
    task_id: id,
    percentage: pct,
    entry_id: entryId,
  });
});

// POST /api/tasks/:id/claim — «Өөртөө авах» (2026-10-01): албан таймер энэ таск
// дээр эхэлнэ = нэр тэр таск дээр гарна.  `POST /api/task-timer/start`-тэй ИЖИЛ
// (`lib/taskTakeService.ts`).  Хуваагдах таск дээр өөр хүн ажиллаж байвал 409
// TASK_OCCUPIED + хуваах цонхны өгөгдмөл (`occupied.split`).
tasks.post('/:id/claim', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid task id' }, 400);
  // Managed таск дээр цаг эхлүүлэх = managed төлөв өөрчлөх: хаалга (426/423).  Managed биш таскт хуучин зан төлөв.
  const blocked = await enforceManagedTaskWrite(c, id);
  if (blocked) return blocked;
  const r = await takeTask(c.env.DB, user, id);
  if (!r.ok) {
    return c.json(
      { error: r.code, message: r.message, occupied: r.occupied ?? null, allocation: r.allocation ?? null },
      r.status,
    );
  }
  return c.json({
    message: 'Task taken',
    outcome: r.outcome,
    task_id: r.task_id,
    progress: r.progress,
  });
});

// POST /api/tasks/:id/unclaim — 2026-10-01: байнгын эзэмшил байхгүй тул «буцаах» =
// энэ таск дээрх МИНИЙ таймерыг зогсоох (нэр таскаас арилж бусдад чөлөөтэй
// болно).  Өмнө бичсэн явц, оноо, ажилласан түүх хэвээр.
tasks.post('/:id/unclaim', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid task id' }, 400);
  const stopped = await pauseOfficialTimer(c.env.DB, {
    userId: user.sub,
    actorId: user.sub,
    taskId: id,
    nowIso: new Date().toISOString(),
    requestId: crypto.randomUUID(),
  });
  return c.json({ message: stopped > 0 ? 'Stopped' : 'Not running', stopped });
});

// POST /api/tasks/:id/share, /:id/unassign — ахлах/админ хүнд таск ОНООХ ба
// хасах.  2026-10-01-нд ХАСАГДСАН (эзэн: «хүссэн хүн нь хүссэн таскаа авна»,
// нэр = одоо хийж буй хүн).  Хуучин клиентэд ойлгомжтой 410.
tasks.post(
  '/:id/share',
  requireRole('engineer', 'architect', 'senior', 'admin'),
  retiredHandler('tasks.share', { error: 'ASSIGNMENT_REMOVED', message: ASSIGNMENT_REMOVED }),
);
tasks.post(
  '/:id/unassign',
  requireManager(),
  retiredHandler('tasks.unassign', { error: 'ASSIGNMENT_REMOVED', message: ASSIGNMENT_REMOVED }),
);

// ---------------------------------------------------------------------------
// Хувийн checklist — ажилтан ӨӨРИЙН таскаа задлах (migration 0177)
// ---------------------------------------------------------------------------
// ⚠️ ЭНЭ НЬ SUBTASK ДАВХАРГА БИШ.  0017/0020 нь subtask-ийг жинтэй
// давхарга байснаар нь устгасан бөгөөд бид түүнийг сэргээхгүй:
//   • `weight_percent` БАЙХГҮЙ;
//   • rollup-ийн 11 хуулбарын АЛЬ НЬ ЧУСВАЛ энэ хүснэгтийг уншихгүй —
//     `PROJECT_LIST_SQL`, `calcProjectProgress`, `computeProgressFromMap`,
//     `recalculateProjectPoints` бүгд tasks.weight_percent дээр л сууна;
//   • checklist 100% болсон нь ажлыг ХААХГҮЙ — ажилтан % -ээ өөрөө
//     баталж `POST /api/progress` илгээж байж л явц хөдөлнө.
//
// Мөр бүр эзэнтэй (`user_id`): нэг таск дээр хоёр хүн ажиллаж байвал
// тус тусын жагсаалттай бөгөөд нөгөөгийнхийг хардаггүй/заддаггүй.
// Иймд бүх route өөрийн мөр дээр л ажиллана (senior/admin ч бусдын
// хувийн жагсаалтыг заддаггүй).
//
// Route дараалал: `/checklist/:itemId` нь ХОЁР сегмент, `/:id` нь НЭГ
// сегмент тул мөргөлдөхгүй (`/top`, `/reorder`-ийн асуудал энд байхгүй).

const MAX_CHECKLIST_TEXT = 300;
const MAX_CHECKLIST_ITEMS = 50;

/** Тухайн таск дээр checklist хөтлөх эрхтэй эсэх: хуваарилагдсан хүн
 *  (хуучин скаляр эсвэл `task_assignees`), эсвэл senior/admin. */
async function canUseChecklist(
  db: D1Database,
  user: { sub: number; role: string },
  taskId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT t.assigned_to,
              EXISTS (SELECT 1 FROM task_assignees ta
                       WHERE ta.task_id = t.id AND ta.user_id = ?) AS is_member
         FROM tasks t WHERE t.id = ?`,
    )
    .bind(user.sub, taskId)
    .first<{ assigned_to: number | null; is_member: 0 | 1 }>();
  if (!row) return false;
  if (user.role === 'admin' || user.role === 'senior') return true;
  return row.assigned_to === user.sub || row.is_member === 1;
}

interface ChecklistItemRow {
  id: number;
  task_id: number;
  text: string;
  is_done: 0 | 1;
  sort_order: number;
  created_at: string;
  done_at: string | null;
}

// GET /api/tasks/:id/checklist — миний энэ таск дээрх жагсаалт
tasks.get('/:id/checklist', async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(taskId)) return c.json({ error: 'invalid task id' }, 400);
  if (!(await canUseChecklist(c.env.DB, user, taskId))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, task_id, text, is_done, sort_order, created_at, done_at
       FROM task_checklist_items
      WHERE task_id = ? AND user_id = ?
      ORDER BY sort_order, id`,
  )
    .bind(taskId, user.sub)
    .all<ChecklistItemRow>();

  return c.json({ items: results ?? [] });
});

// POST /api/tasks/:id/checklist  { text }
tasks.post('/:id/checklist', async (c) => {
  const user = c.get('user');
  const taskId = parseInt(c.req.param('id'), 10);
  if (!Number.isFinite(taskId)) return c.json({ error: 'invalid task id' }, 400);
  if (!(await canUseChecklist(c.env.DB, user, taskId))) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{ text?: unknown }>().catch(() => ({}) as { text?: unknown });
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);
  if (text.length > MAX_CHECKLIST_TEXT) {
    return c.json({ error: `Хамгийн ихдээ ${MAX_CHECKLIST_TEXT} тэмдэгт` }, 400);
  }

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM task_checklist_items WHERE task_id = ? AND user_id = ?`,
  )
    .bind(taskId, user.sub)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_CHECKLIST_ITEMS) {
    return c.json({ error: `Нэг ажилд хамгийн ихдээ ${MAX_CHECKLIST_ITEMS} алхам` }, 400);
  }

  const next = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) + 1 AS next
       FROM task_checklist_items WHERE task_id = ? AND user_id = ?`,
  )
    .bind(taskId, user.sub)
    .first<{ next: number }>();

  const res = await c.env.DB.prepare(
    `INSERT INTO task_checklist_items (task_id, user_id, text, sort_order)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(taskId, user.sub, text, next?.next ?? 1)
    .run();

  const item = await c.env.DB.prepare(
    `SELECT id, task_id, text, is_done, sort_order, created_at, done_at
       FROM task_checklist_items WHERE id = ?`,
  )
    .bind(Number(res.meta.last_row_id))
    .first<ChecklistItemRow>();

  return c.json({ item }, 201);
});

// PATCH /api/tasks/checklist/:itemId  { text?, is_done? }
tasks.patch('/checklist/:itemId', async (c) => {
  const user = c.get('user');
  const itemId = parseInt(c.req.param('itemId'), 10);
  if (!Number.isFinite(itemId)) return c.json({ error: 'invalid item id' }, 400);

  const body = await c.req
    .json<{ text?: unknown; is_done?: unknown }>()
    .catch(() => ({}) as { text?: unknown; is_done?: unknown });

  const updates: string[] = [];
  const binds: (string | number | null)[] = [];

  if (body.text !== undefined) {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return c.json({ error: 'text cannot be empty' }, 400);
    if (text.length > MAX_CHECKLIST_TEXT) {
      return c.json({ error: `Хамгийн ихдээ ${MAX_CHECKLIST_TEXT} тэмдэгт` }, 400);
    }
    updates.push('text = ?');
    binds.push(text);
  }
  if (body.is_done !== undefined) {
    const done = !!body.is_done;
    updates.push('is_done = ?', 'done_at = ?');
    binds.push(done ? 1 : 0, done ? new Date().toISOString() : null);
  }
  if (updates.length === 0) return c.json({ error: 'nothing to update' }, 400);

  // `AND user_id = ?` нь эрхийн шалгалт БОЛОН эзэмшлийн шалгалт хоёулаа:
  // бусдын мөрийг хөндвөл 0 мөр өөрчлөгдөж 404 буцна.
  binds.push(itemId, user.sub);
  const res = await c.env.DB.prepare(
    `UPDATE task_checklist_items SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
  )
    .bind(...binds)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'Item not found' }, 404);

  const item = await c.env.DB.prepare(
    `SELECT id, task_id, text, is_done, sort_order, created_at, done_at
       FROM task_checklist_items WHERE id = ?`,
  )
    .bind(itemId)
    .first<ChecklistItemRow>();

  return c.json({ item });
});

// DELETE /api/tasks/checklist/:itemId
tasks.delete('/checklist/:itemId', async (c) => {
  const user = c.get('user');
  const itemId = parseInt(c.req.param('itemId'), 10);
  if (!Number.isFinite(itemId)) return c.json({ error: 'invalid item id' }, 400);

  const res = await c.env.DB.prepare(
    `DELETE FROM task_checklist_items WHERE id = ? AND user_id = ?`,
  )
    .bind(itemId, user.sub)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'Item not found' }, 404);

  return c.json({ message: 'Deleted' });
});

export default tasks;
