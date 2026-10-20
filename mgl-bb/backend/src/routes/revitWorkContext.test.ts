// «MGL ажил» самбар (Revit work tracking MVP, 2026-09-29) — `GET /api/revit/work-context`
// ба `POST /api/revit/submissions`-ийн 100% (хаах) зам.  БОДИТ SQLite, D1 shim,
// Hono `app.request()` — `routes/taskHold.test.ts`-ийн хэв маяг.  Цэвэр дүрэм нь
// `lib/revitWorkContext.test.ts` ба `lib/revitProgress.test.ts`-д.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const revit = (await import('./revit.ts')).default;
const { todayInUB } = await import('../lib/time.ts');

function d1Shim(db: DatabaseSync) {
  const prepare = (sql: string, params: unknown[] = []) => ({
    bind(...args: unknown[]) {
      return prepare(sql, args);
    },
    async all() {
      return { results: db.prepare(sql).all(...(params as never[])) };
    },
    async first() {
      return db.prepare(sql).get(...(params as never[])) ?? null;
    },
    async run() {
      const r = db.prepare(sql).run(...(params as never[]));
      return { meta: { last_row_id: Number(r.lastInsertRowid), changes: r.changes } };
    },
  });
  return {
    prepare,
    async batch(stmts: Array<ReturnType<typeof prepare>>) {
      const out = [];
      for (const s of stmts) out.push(await s.all());
      return out;
    },
  } as unknown as D1Database;
}

const TODAY = todayInUB();

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      progress_mode TEXT DEFAULT 'tasks', completion_questions TEXT, complexity_pct REAL);
    CREATE TABLE project_members (project_id INTEGER, user_id INTEGER);
    CREATE TABLE project_team_shares (project_id INTEGER, team_id INTEGER, share_percent REAL);
    CREATE TABLE blocks (id INTEGER PRIMARY KEY, project_id INTEGER, team_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE drawings (id INTEGER PRIMARY KEY, block_id INTEGER, name TEXT,
      weight_percent REAL DEFAULT 100, sort_order INTEGER DEFAULT 0);
    CREATE TABLE components (id INTEGER PRIMARY KEY, drawing_id INTEGER);
    CREATE TABLE tasks (id INTEGER PRIMARY KEY, component_id INTEGER, name TEXT NOT NULL,
      weight_percent REAL DEFAULT 10, assigned_to INTEGER, sort_order INTEGER DEFAULT 0,
      ai_completion_summary TEXT, ai_completion_summary_at TEXT);
    CREATE TABLE task_assignees (task_id INTEGER, user_id INTEGER, created_at TEXT DEFAULT (datetime('now')),
      self_joined INTEGER DEFAULT 0, PRIMARY KEY (task_id, user_id));
    CREATE TABLE task_self_done (task_id INTEGER, user_id INTEGER, note TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE task_checklist_items (id INTEGER PRIMARY KEY, task_id INTEGER, user_id INTEGER, text TEXT,
      is_done INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0);
    CREATE TABLE progress_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_id INTEGER,
      percentage REAL CHECK (percentage >= 0 AND percentage <= 100), date TEXT, notes TEXT, status TEXT,
      reviewed_by INTEGER, reviewed_at TEXT, image_url TEXT, is_rest_day INTEGER DEFAULT 0,
      defer_next_day INTEGER DEFAULT 0, completion_qa TEXT, attachments TEXT, source TEXT DEFAULT 'web',
      is_baseline INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE repair_marks (id INTEGER PRIMARY KEY, user_id INTEGER, date TEXT, task_id INTEGER,
      project_id INTEGER, repair_project_id INTEGER);
    CREATE TABLE user_points (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, project_id INTEGER,
      repair_project_id INTEGER, task_id INTEGER, progress_entry_id INTEGER, amount REAL, delta_pct REAL,
      assignee_count INTEGER, awarded_by INTEGER, source TEXT NOT NULL DEFAULT 'progress',
      awarded_at TEXT DEFAULT (datetime('now')));
  `);
  // Бодит миграцууд — хүснэгтийн хэлбэр кодтой зөрөхгүйн тулд.
  for (const f of [
    '0187_revit_documents.sql',
    '0189_revit_submissions.sql',
    '0360_revit_work_tracking.sql',
    '0361_task_timer.sql',
    '0368_task_live_take.sql',
    '0376_task_allocations.sql',
    '0377_task_contributions.sql',
    '0378_allocation_ledger_links.sql',
    '0379_task_timer_voids.sql',
    '0385_task_conversions.sql',
  ]) {
    db.exec(readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8'));
  }
  db.exec(`
    INSERT INTO users VALUES (3,'engineer','active'), (4,'engineer','active'), (9,'admin','active'), (7,'worker','active');
    -- 41: EVERGREEN AZ (хувиар), 37: EVERGREEN ZA (цагаар), 50: өөр төсөл (3-т эрхгүй)
    INSERT INTO projects (id, name, progress_mode, completion_questions) VALUES
      (41, 'MGL-251006 EVERGREEN_AZ', 'tasks', NULL),
      (37, 'MGL-251006 EVERGREEN_ZA', 'hours', NULL),
      (50, 'MGL-240101 SECRET', 'tasks', '[{"id":"q1","text":"Юу хийсэн бэ?"}]'),
      (60, 'MGL-250505 ARCHIVED', 'tasks', NULL);
    UPDATE projects SET status = 'archived' WHERE id = 60;
    INSERT INTO project_team_shares VALUES (41, 1, 100), (37, 1, 100), (50, 1, 100);
    INSERT INTO blocks (id, project_id, team_id, name) VALUES (1, 41, 1, 'Блок А'), (2, 37, 1, 'Засвар'),
      (3, 50, 1, 'Нууц'), (4, 60, 1, 'Хуучин');
    INSERT INTO drawings (id, block_id, name) VALUES (1, 1, 'BA - Барилга архитектур'), (2, 2, 'ZA - Засвар'),
      (3, 3, 'BA'), (4, 4, 'BA');
    INSERT INTO components (id, drawing_id) VALUES (1, 1), (2, 2), (3, 3), (4, 4);
    INSERT INTO tasks (id, component_id, name, assigned_to, sort_order) VALUES
      (100, 1, 'Фасад', 3, 1),
      (101, 1, 'Хана', NULL, 2),
      (102, 1, 'Дууссан', 3, 3),
      (103, 1, 'Өөр хүний', 4, 4),
      (104, 1, 'Би өөрөө дууссан гэсэн', 3, 5),
      (200, 2, 'Засвар 1', 3, 1),
      (201, 2, 'Засвар 2', 3, 2),
      (300, 3, 'Нууц таск', 4, 1),
      (400, 4, 'Архивын таск', 3, 1);
    INSERT INTO task_assignees (task_id, user_id) VALUES (101, 3), (200, 3), (300, 4);
    INSERT INTO task_self_done (task_id, user_id) VALUES (104, 3);
    -- 2026-10-01: хувь оруулах = тухайн таскийг «Өөртөө авах»-аар авч ажилласан
    -- (албан таймерын сэшнтэй) хүн.  Инженер 3 нь 100, 102 дээр ажилласан.
    INSERT INTO task_timer_sessions (user_id, task_id, project_id, started_at, ended_at, duration_ms,
      start_reason, end_reason, started_by, ended_by, start_request_id, end_request_id, created_at, updated_at) VALUES
      (3, 100, 41, '2026-09-30T01:00:00.000Z', '2026-09-30T02:00:00.000Z', 3600000, 'start', 'pause', 3, 3, 'r1', 'r1e',
       '2026-09-30T01:00:00.000Z', '2026-09-30T02:00:00.000Z'),
      (3, 102, 41, '2026-09-30T03:00:00.000Z', '2026-09-30T04:00:00.000Z', 3600000, 'start', 'pause', 3, 3, 'r2', 'r2e',
       '2026-09-30T03:00:00.000Z', '2026-09-30T04:00:00.000Z');
    INSERT INTO progress_entries (task_id, user_id, percentage, date, status, created_at) VALUES
      (100, 3, 40, '2026-09-01', 'approved', '2026-09-01 10:00:00'),
      (102, 3, 100, '2026-09-02', 'approved', '2026-09-02 10:00:00'),
      (200, 3, 100, '2026-09-02', 'approved', '2026-09-02 10:00:00');
  `);

  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: unknown } }>();
  app.use('*', async (c, next) => {
    const raw = c.req.header('x-test-user');
    if (raw) c.set('user', JSON.parse(raw));
    await next();
  });
  app.route('/api/revit', revit as never);
  const exec = {
    waitUntil: (p: Promise<unknown>) => {
      p.catch(() => {});
    },
    passThroughOnException: () => {},
  };
  const call = (path: string, method: string, body: unknown, user: { sub: number; role: string }) =>
    app.request(
      `/api/revit${path}`,
      {
        method,
        headers: { 'content-type': 'application/json', 'x-test-user': JSON.stringify(user) },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      },
      { DB: d1Shim(db), AI: undefined },
      exec as never,
    );
  const register = (projectId: number, docUid: string, id?: number) =>
    db
      .prepare(
        `INSERT INTO revit_documents (${id ? 'id, ' : ''}project_id, doc_uid, file_name, created_by)
         VALUES (${id ? '?, ' : ''}?, ?, 'x.rvt', 9)`,
      )
      .run(...((id ? [id, projectId, docUid] : [projectId, docUid]) as never[]));
  return { db, call, register };
}

const ENG = { sub: 3, role: 'engineer' };
const OTHER = { sub: 4, role: 'engineer' };
const ADMIN = { sub: 9, role: 'admin' };
const WORKER = { sub: 7, role: 'worker' };

type Ctx = {
  document: { project_id: number; revit_document_id: number } | null;
  resolved_by: string | null;
  ambiguous: boolean;
  registrations: Array<{ project_id: number; project_name: string }>;
  suggestions: Array<{ project_id: number; reason: string; open_tasks: number }>;
  project: { id: number; progress_mode: string } | null;
  tasks: Array<{
    task_id: number;
    current_progress: number;
    progress_mode: string;
    reported_today: boolean;
    marked_today: boolean;
  }>;
  completion_questions: Array<{ id: string; text: string }>;
  ceiling: number;
};

const ctx = async (
  call: ReturnType<typeof setup>['call'],
  q: string,
  user = ENG,
): Promise<{ status: number; body: Ctx }> => {
  const res = await call(`/work-context?${q}`, 'GET', null, user);
  return { status: res.status, body: (await res.json()) as Ctx };
};

/* ------------------------------------------------------------------ */
/*  GET /work-context                                                  */
/* ------------------------------------------------------------------ */

test('doc_uid заавал — үгүй бол 400', async () => {
  const { call } = setup();
  assert.equal((await ctx(call, 'title=x')).status, 400);
});

test('worker / client замын хаалтаар 403 (router-ийн gate)', async () => {
  const { call } = setup();
  assert.equal((await ctx(call, 'doc_uid=abc', WORKER)).status, 403);
});

test('бүртгэлгүй файл: 404 биш — санал (код таарсан нь эхэнд), таскгүй', async () => {
  const { call } = setup();
  const r = await ctx(call, 'doc_uid=new-doc&file_name=MGL-251006_EVERGREEN_AZ.rvt');
  assert.equal(r.status, 200);
  assert.equal(r.body.document, null);
  assert.equal(r.body.tasks.length, 0);
  // 41 ба 37 хоёулаа код таарсан, миний нээлттэй таскуудтай; 50 (эрхгүй) ОРОХГҮЙ.
  const ids = r.body.suggestions.map((s) => s.project_id);
  assert.deepEqual(ids.sort(), [37, 41]);
  assert.ok(r.body.suggestions.every((s) => s.reason === 'code'));
  assert.ok(!ids.includes(50), 'эрхгүй төсөл санал болохгүй');
  assert.ok(!ids.includes(60), 'архивын төсөл санал болохгүй');
});

test('ганц бүртгэл → single; зөвхөн МИНИЙ НЭЭЛТТЭЙ таск, одоогийн хувь, асуулт', async () => {
  const { call, register } = setup();
  register(41, 'doc-a', 5);
  const r = await ctx(call, 'doc_uid=doc-a');
  assert.equal(r.status, 200);
  assert.equal(r.body.resolved_by, 'single');
  assert.equal(r.body.document?.revit_document_id, 5);
  assert.equal(r.body.project?.progress_mode, 'tasks');
  // 100 (40%), 101 (task_assignees-аар) — 102 (100%), 103 (өөр хүн), 104 (self_done) ОРОХГҮЙ.
  assert.deepEqual(r.body.tasks.map((t) => t.task_id), [100, 101]);
  assert.equal(r.body.tasks[0]!.current_progress, 40);
  assert.equal(r.body.ceiling, 99);
  assert.equal(r.body.completion_questions.length, 3, 'NULL → анхдагч 3 асуулт');
  assert.equal(r.body.suggestions.length, 0, 'шийдэгдсэн үед санал хэрэггүй');
});

test('цагаар явдаг (ZA) төсөл: хувь 100 ч нээлттэй, progress_mode=hours, өнөөдрийн «Ажилласан»', async () => {
  const { db, call, register } = setup();
  register(37, 'doc-za');
  db.prepare(`INSERT INTO repair_marks (user_id, date, task_id, project_id) VALUES (3, ?, 200, 37)`).run(TODAY);
  const r = await ctx(call, 'doc_uid=doc-za');
  assert.deepEqual(r.body.tasks.map((t) => [t.task_id, t.progress_mode, t.marked_today]), [
    [200, 'hours', true],
    [201, 'hours', false],
  ]);
});

test('нэг uid хоёр төсөлд: миний таск хоёуланд → ТААМАГЛАХГҮЙ; hint → тэр', async () => {
  const { call, register } = setup();
  register(41, 'tpl');
  register(37, 'tpl');
  const amb = await ctx(call, 'doc_uid=tpl');
  assert.equal(amb.body.document, null);
  assert.equal(amb.body.ambiguous, true);
  assert.deepEqual(amb.body.registrations.map((x) => x.project_id).sort(), [37, 41]);
  assert.equal(amb.body.tasks.length, 0);

  const hinted = await ctx(call, 'doc_uid=tpl&project_id=37');
  assert.equal(hinted.body.resolved_by, 'hint');
  assert.equal(hinted.body.project?.id, 37);
});

test('эрхгүй төслийн бүртгэл ХАРАГДАХГҮЙ (нэр ч алдагдахгүй), hint ч эрх нээхгүй', async () => {
  const { call, register } = setup();
  register(50, 'secret-doc');
  const r = await ctx(call, 'doc_uid=secret-doc&project_id=50');
  assert.equal(r.body.document, null);
  assert.equal(r.body.registrations.length, 0);
  assert.ok(!JSON.stringify(r.body).includes('SECRET'));
  // Эрхтэй хүн (4 — 300-д хуваарилагдсан) харна.
  const other = await ctx(call, 'doc_uid=secret-doc', OTHER);
  assert.equal(other.body.project?.id, 50);
  assert.deepEqual(other.body.completion_questions, [{ id: 'q1', text: 'Юу хийсэн бэ?' }]);
});

test('архивлагдсан төсөл: бүртгэл шийдэгдэнэ, таск гарахгүй', async () => {
  const { call, register } = setup();
  register(60, 'old-doc');
  const r = await ctx(call, 'doc_uid=old-doc', ADMIN);
  assert.equal(r.body.project?.id, 60);
  assert.equal(r.body.tasks.length, 0);
});

test('өнөөдөр явц бөглөсөн таск — reported_today', async () => {
  const { db, call, register } = setup();
  register(41, 'doc-a');
  db.prepare(
    `INSERT INTO progress_entries (task_id, user_id, percentage, date, status) VALUES (101, 3, 20, ?, 'approved')`,
  ).run(TODAY);
  const r = await ctx(call, 'doc_uid=doc-a');
  const t = new Map(r.body.tasks.map((x) => [x.task_id, x.reported_today]));
  assert.equal(t.get(101), true);
  assert.equal(t.get(100), false);
});

/* ------------------------------------------------------------------ */
/*  POST /submissions — байгаа эрх + 100% хаах (эзний 2026-09-29)       */
/* ------------------------------------------------------------------ */

const submit = (call: ReturnType<typeof setup>['call'], body: Record<string, unknown>, user = ENG) =>
  call('/submissions', 'POST', { confirmed: true, ...body }, user);

test('100% нь completion_qa-гүй бол 400 above_ceiling (мессеж нь хаахыг заана)', async () => {
  const { db, call } = setup();
  const res = await submit(call, { draft_uid: 'd-100-noqa', task_id: 100, percentage: 100 });
  assert.equal(res.status, 400);
  const b = (await res.json()) as { error: string; message: string };
  assert.equal(b.error, 'percentage_above_ceiling');
  assert.match(b.message, /ХААХ/);
  const n = db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = 100').get() as { n: number };
  assert.equal(n.n, 1, 'шинэ мөр үүсээгүй');
});

test('100% + ДУТУУ хариу → 400 completion_qa required (submitProgressEntry-ийн дүрэм), мөргүй', async () => {
  const { db, call } = setup();
  const res = await submit(call, {
    draft_uid: 'd-100-partial',
    task_id: 100,
    percentage: 100,
    completion_qa: { done: 'Фасад бүрэн' },
  });
  assert.equal(res.status, 400);
  const b = (await res.json()) as { error: string; missing: string[] };
  assert.equal(b.error, 'completion_qa required');
  assert.equal(b.missing.length, 2);
  const s = db.prepare(`SELECT claim_state FROM revit_submissions WHERE draft_uid = 'd-100-partial'`).get() as {
    claim_state: string;
  };
  assert.equal(s.claim_state, 'claimed', 'бичилт болоогүй — ижил draft_uid-аар засаад дахин илгээж болно');
});

test('100% + БҮРЭН хариу → 201, source=revit, битүүмжлэгдэнэ; давтан илгээлт давхардахгүй', async () => {
  const { db, call } = setup();
  const qa = { done: 'Фасад бүрэн', issues: 'Байхгүй', next: 'Хяналт' };
  const res = await submit(call, { draft_uid: 'd-close', task_id: 100, percentage: 100, completion_qa: qa, notes: 'дуусгав' });
  assert.equal(res.status, 201);
  const row = db
    .prepare(`SELECT percentage, source, completion_qa FROM progress_entries WHERE task_id = 100 ORDER BY id DESC LIMIT 1`)
    .get() as { percentage: number; source: string; completion_qa: string };
  assert.equal(row.percentage, 100);
  assert.equal(row.source, 'revit');
  assert.deepEqual(JSON.parse(row.completion_qa), qa);

  const again = await submit(call, { draft_uid: 'd-close', task_id: 100, percentage: 100, completion_qa: qa });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as { duplicate: boolean }).duplicate, true);
  const n = db.prepare(`SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = 100 AND percentage = 100`).get() as {
    n: number;
  };
  assert.equal(n.n, 1, 'давтан хүргэлт ХОЁР мөр үүсгэхгүй');
});

test('битүүмжлэгдсэн тайлангийн давтан хүргэлт — дараа нь вэбээс өндөр хувь орсон ч duplicate (409 биш)', async () => {
  const { db, call } = setup();
  const first = await submit(call, { draft_uid: 'd-60', task_id: 100, percentage: 60 });
  assert.equal(first.status, 201);
  // Хооронд нь вэбээс 70% бөглөгдөв.
  db.prepare(
    `INSERT INTO progress_entries (task_id, user_id, percentage, date, status, created_at)
     VALUES (100, 3, 70, ?, 'approved', datetime('now', '+1 minute'))`,
  ).run(TODAY);
  const retry = await submit(call, { draft_uid: 'd-60', task_id: 100, percentage: 60 });
  assert.equal(retry.status, 200, 'ухралт биш — анхны хариу');
  assert.equal(((await retry.json()) as { duplicate: boolean }).duplicate, true);
});

test('дууссан (100%) таск → 409 already_at_ceiling «дууссан»', async () => {
  const { call } = setup();
  const res = await submit(call, { draft_uid: 'd-done', task_id: 102, percentage: 100, completion_qa: {} });
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { message: string }).message, /дууссан/);
});

test('таскийг авч ажиллаагүй инженер → 403 TAKE_REQUIRED (2026-10-01), мөр үүсэхгүй', async () => {
  const { db, call } = setup();
  const res = await submit(call, { draft_uid: 'd-other', task_id: 103, percentage: 50 });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, 'TAKE_REQUIRED');
  const n = db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = 103').get() as { n: number };
  assert.equal(n.n, 0);
});

test('ухралт → 409 percentage_regression, монгол мессежтэй', async () => {
  const { call } = setup();
  const res = await submit(call, { draft_uid: 'd-back', task_id: 100, percentage: 30 });
  assert.equal(res.status, 409);
  const b = (await res.json()) as { error: string; message: string };
  assert.equal(b.error, 'percentage_regression');
  assert.match(b.message, /40%/);
});

test('цагаар явдаг (ZA) таск руу хувь → 403 HOURS_PROGRESS (өөрчлөгдөөгүй дүрэм), мөр үүсэхгүй', async () => {
  const { db, call } = setup();
  const res = await submit(call, { draft_uid: 'd-za', task_id: 201, percentage: 50 });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { error: string }).error, 'HOURS_PROGRESS');
  const n = db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = 201').get() as { n: number };
  assert.equal(n.n, 0);
});

/* ------------------------------------------------------------------ */
/*  Хуваарилагдсан (managed) таск — Revit-ийн гэрээ (2026-10-05)        */
/* ------------------------------------------------------------------ */

const makeManaged = (db: DatabaseSync, taskId: number) =>
  db.prepare('INSERT INTO task_roots (task_id, revision, unallocated_units) VALUES (?, 1, 1000000)').run(taskId);

test('managed таск: /submissions нь 409 MANAGED_ROOT (retryable=false, managed=true, гэрээний толгой) — юу ч бичигдэхгүй', async () => {
  const { db, call } = setup();
  makeManaged(db, 100);
  const res = await submit(call, { draft_uid: 'd-managed-1', task_id: 100, percentage: 55 });
  assert.equal(res.status, 409);
  const b = (await res.json()) as Record<string, unknown>;
  assert.equal(b.error, 'MANAGED_ROOT');
  assert.equal(b.managed, true);
  assert.equal(b.retryable, false);
  assert.equal(b.task_id, 100);
  assert.equal(b.project_id, 41);
  assert.equal(b.open_url, '/app/projects/41?task=100');
  assert.equal(res.headers.get('x-task-alloc-contract'), '1');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = 100').get() as { n: number }).n, 1);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM revit_submissions WHERE draft_uid = 'd-managed-1'").get() as { n: number }).n,
    0,
    'claimed мөр үлдэхгүй',
  );
});

test('managed таск: хувийн шалгалт (ухралт) нь жинхэнэ шалтгааныг ДАРАХГҮЙ — 20% < одоогийн 40% байсан ч MANAGED_ROOT', async () => {
  const { db, call } = setup();
  makeManaged(db, 100);
  const res = await submit(call, { draft_uid: 'd-managed-2', task_id: 100, percentage: 20 });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'MANAGED_ROOT');
});

test('managed болохоос ӨМНӨ битүүмжлэгдсэн мөрийн давтан хүргэлт анхны хариуг буцаана (duplicate)', async () => {
  const { db, call } = setup();
  const first = await submit(call, { draft_uid: 'd-sealed-1', task_id: 100, percentage: 50 });
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()));
  makeManaged(db, 100);
  const again = await submit(call, { draft_uid: 'd-sealed-1', task_id: 100, percentage: 50 });
  assert.equal(again.status, 200);
  assert.equal(((await again.json()) as { duplicate?: boolean }).duplicate, true);
});

test('managed БИШ таск хуучин зан төлөвөөрөө ажиллана', async () => {
  const { call } = setup();
  const res = await submit(call, { draft_uid: 'd-plain-1', task_id: 100, percentage: 50 });
  assert.equal(res.status, 201, JSON.stringify(await res.clone().json()));
});

test('/work-context ба /context: managed тугтай (add-in урьдчилан мэднэ)', async () => {
  const { db, call, register } = setup();
  register(41, 'uid-managed-ctx');
  makeManaged(db, 100);
  const wc = await call('/work-context?doc_uid=uid-managed-ctx', 'GET', undefined, ENG);
  const wcBody = (await wc.json()) as { tasks: Array<{ task_id: number; managed: boolean }> };
  const t100 = wcBody.tasks.find((t) => t.task_id === 100);
  assert.ok(t100, 'таск 100 жагсаалтад');
  assert.equal(t100!.managed, true);
  assert.ok(wcBody.tasks.filter((t) => t.task_id !== 100).every((t) => t.managed === false));
  const cx = await call('/context?doc_uid=uid-managed-ctx', 'GET', undefined, ENG);
  if (cx.status === 200) {
    const cxBody = (await cx.json()) as { tasks?: Array<{ task_id: number; managed?: boolean }> };
    const c100 = cxBody.tasks?.find((t) => t.task_id === 100);
    if (c100) assert.equal(c100.managed, true);
  }
});

/* ------------------------------------------------------------------ */
/*  Хөрвүүлэлтээр нэгтгэгдсэн (retired) хэсэг — Revit-ийн гэрээ (0385)   */
/* ------------------------------------------------------------------ */

const retireTask = (db: DatabaseSync, taskId: number, rootTaskId: number) => {
  db.prepare(
    `INSERT OR IGNORE INTO task_conversions (id, root_task_id, project_id, drawing_id, status, evidence, classification, plan_hash, actor_id, plan_json, rollup_before, rollup_after)
     VALUES ('cv-test', ?, 41, 1, 'applied', 'declared_group', 'proven_split', 'h', 9, '{}', 0, 0)`,
  ).run(rootTaskId);
  db.prepare(
    `INSERT INTO task_conversion_members (task_id, conversion_id, role, name_before, weight_before, weight_after, latest_pct)
     VALUES (?, 'cv-test', 'retired', 'x', 10, 0, 0)`,
  ).run(taskId);
};

test('нэгтгэгдсэн хэсэг: /submissions нь 409 CONVERTED_PART (root руу чиглүүлнэ), юу ч бичигдэхгүй', async () => {
  const { db, call } = setup();
  makeManaged(db, 101);
  retireTask(db, 100, 101);
  const res = await submit(call, { draft_uid: 'd-retired-1', task_id: 100, percentage: 55 });
  assert.equal(res.status, 409);
  const b = (await res.json()) as Record<string, unknown>;
  assert.equal(b.error, 'CONVERTED_PART');
  assert.equal(b.retryable, false);
  assert.equal(res.headers.get('x-task-alloc-contract'), '1');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM progress_entries WHERE task_id = 100').get() as { n: number }).n, 1);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM revit_submissions WHERE draft_uid = 'd-retired-1'").get() as { n: number }).n,
    0,
    'claimed мөр үлдэхгүй',
  );
});

test('нэгтгэгдсэн хэсэг: /work-context-д managed тугтай (add-in хувь илгээхгүй)', async () => {
  const { db, call, register } = setup();
  register(41, 'uid-retired-ctx');
  makeManaged(db, 101);
  retireTask(db, 100, 101);
  const wc = await call('/work-context?doc_uid=uid-retired-ctx', 'GET', undefined, ENG);
  const body = (await wc.json()) as { tasks: Array<{ task_id: number; managed: boolean }> };
  const t100 = body.tasks.find((t) => t.task_id === 100);
  assert.ok(t100, 'нэгтгэгдсэн хэсэг жагсаалтад (түүх) харагдана');
  assert.equal(t100!.managed, true);
});
