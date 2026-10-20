/**
 * Хурлын action item → Tasks гүүр.
 *
 * Хурлын AI/гар шинжилгээний "хийх ажлууд" (action_items) нь зөвхөн
 * meeting_analyses дотор уншигдаад мартагддаг байсныг жинхэнэ даалгавар
 * болгож төслийн шатлалд оруулна.  Жингийн дүрэм:
 *
 *   - Төсөл бүрд "Хурлын даалгавар" нэртэй НЭГ block (weight_percent = 0,
 *     team_id NULL) үүсгэнэ — жин 0 тул доорх бүх мод төслийн явцын
 *     rollup-д ОГТ нөлөөлөХГҮЙ (calcProjectProgress-ийн үржвэр 0 болно).
 *   - Доор нь "Хурлын шийдвэрүүд" drawing, хурал тус бүрд нэг component
 *     ("Хурал #N: <гарчиг>") — даалгаврууд хаанаас гарсан нь мөрдөгдөнө.
 *   - Tasks нь жин 0-тэй; MyTasks дээр оноогдсон хүнд нь харагдаж,
 *     явцын тайлан/мэдэгдлийн бүх урсгал хэвийн ажиллана (100% хаахад
 *     баталгаажуулалт + оноо Δ=0 тул leaderboard-д нөлөөгүй).
 *
 * Route (POST /api/meetings/:id/tasks) болон MCP tool
 * (create_tasks_from_meeting_actions) хоёулаа энэ helper-ийг дууддаг.
 */

import type { Env } from '../types';
import { createNotification } from './notify';

export const BRIDGE_BLOCK_NAME = 'Хурлын даалгавар';
export const BRIDGE_DRAWING_NAME = 'Хурлын шийдвэрүүд';

const MAX_ITEMS = 50;
const MAX_TASK_NAME = 300;
const MAX_COMPONENT_NAME = 120;

export interface MeetingTaskInput {
  text: string;
  /** users.id жагсаалт — байхгүй/хоосон бол эзэнгүй даалгавар. */
  assignee_ids?: number[];
  /** YYYY-MM-DD — буруу форматтай бол хаягдана (null болно). */
  due_date?: string | null;
}

export interface CreatedMeetingTask {
  id: number;
  name: string;
  assignee_ids: number[];
  due_date: string | null;
}

export type CreateTasksResult =
  | {
      ok: true;
      project_id: number;
      project_name: string;
      block_id: number;
      component_id: number;
      tasks: CreatedMeetingTask[];
      /** Идэвхгүй/олдоогүй тул хаягдсан assignee id-нууд (item бүрээр нийлбэр). */
      dropped_assignee_ids: number[];
      /** Component дотор ижил нэртэй даалгавар аль хэдийн байсан тул
       *  алгассан мөрүүд — давхар дарах/retry-ийн idempotency хамгаалалт. */
      skipped_duplicates: string[];
    }
  | { ok: false; status: 400 | 404; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Шатлалын нэг түвшинд нэрээр хайж, байхгүй бол үүсгэнэ. */
async function ensureRow(
  db: D1Database,
  table: 'blocks' | 'drawings' | 'components',
  parentCol: 'project_id' | 'block_id' | 'drawing_id',
  parentId: number,
  name: string,
): Promise<number> {
  const existing = await db
    .prepare(`SELECT id FROM ${table} WHERE ${parentCol} = ? AND name = ? LIMIT 1`)
    .bind(parentId, name)
    .first<{ id: number }>();
  if (existing) return existing.id;

  const maxOrder = await db
    .prepare(`SELECT MAX(sort_order) AS max_order FROM ${table} WHERE ${parentCol} = ?`)
    .bind(parentId)
    .first<{ max_order: number | null }>();
  const created = await db
    .prepare(
      `INSERT INTO ${table} (${parentCol}, name, weight_percent, sort_order)
       VALUES (?, ?, 0, ?) RETURNING id`,
    )
    .bind(parentId, name, (maxOrder?.max_order ?? -1) + 1)
    .first<{ id: number }>();
  if (!created) throw new Error(`${table} insert failed`);
  return created.id;
}

export async function createTasksFromMeeting(
  env: Env,
  opts: {
    meetingId: number;
    projectId: number;
    items: MeetingTaskInput[];
  },
): Promise<CreateTasksResult> {
  const db = env.DB;

  const items = (opts.items ?? [])
    .map((i) => ({
      text: typeof i.text === 'string' ? i.text.trim().slice(0, MAX_TASK_NAME) : '',
      assignee_ids: Array.isArray(i.assignee_ids)
        ? [...new Set(i.assignee_ids.filter((n) => Number.isFinite(n) && n > 0))]
        : [],
      due_date:
        typeof i.due_date === 'string' && DATE_RE.test(i.due_date.trim())
          ? i.due_date.trim()
          : null,
    }))
    .filter((i) => i.text);
  if (items.length === 0) return { ok: false, status: 400, error: 'items required' };
  if (items.length > MAX_ITEMS) {
    return { ok: false, status: 400, error: `too many items (max ${MAX_ITEMS})` };
  }

  const meeting = await db
    .prepare(`SELECT id, title FROM meetings WHERE id = ?`)
    .bind(opts.meetingId)
    .first<{ id: number; title: string }>();
  if (!meeting) return { ok: false, status: 404, error: 'Meeting not found' };

  // MyTasks нь зөвхөн идэвхтэй төслийн даалгаврыг үзүүлдэг тул архивлагдсан
  // төсөл рүү даалгавар үүсгэх нь "алга болсон" мэт төөрөгдөл үүсгэнэ — хориглоно.
  const project = await db
    .prepare(`SELECT id, name, status FROM projects WHERE id = ?`)
    .bind(opts.projectId)
    .first<{ id: number; name: string; status: string }>();
  if (!project) return { ok: false, status: 404, error: 'Project not found' };
  if (project.status !== 'active') {
    return { ok: false, status: 400, error: 'Project is not active' };
  }

  // Оноох гэж буй хүмүүс идэвхтэй эсэхийг нэг query-ээр шалгана.
  const wantedIds = [...new Set(items.flatMap((i) => i.assignee_ids))];
  const validIds = new Set<number>();
  if (wantedIds.length > 0) {
    const placeholders = wantedIds.map(() => '?').join(',');
    const { results } = await db
      .prepare(`SELECT id FROM users WHERE id IN (${placeholders}) AND status = 'active'`)
      .bind(...wantedIds)
      .all<{ id: number }>();
    for (const r of results ?? []) validIds.add(r.id);
  }
  const droppedIds = wantedIds.filter((id) => !validIds.has(id));

  // Block → drawing → component гинжийг баталгаажуулна (бүгд weight 0).
  const blockId = await ensureRow(db, 'blocks', 'project_id', project.id, BRIDGE_BLOCK_NAME);
  const drawingId = await ensureRow(db, 'drawings', 'block_id', blockId, BRIDGE_DRAWING_NAME);
  const componentName = `Хурал #${meeting.id}: ${meeting.title}`.slice(0, MAX_COMPONENT_NAME);
  const componentId = await ensureRow(db, 'components', 'drawing_id', drawingId, componentName);

  const maxOrder = await db
    .prepare(`SELECT MAX(sort_order) AS max_order FROM tasks WHERE component_id = ?`)
    .bind(componentId)
    .first<{ max_order: number | null }>();
  let sortOrder = (maxOrder?.max_order ?? -1) + 1;

  // Idempotency: component нь хурал бүрд тогтмол нэртэй тул ижил нэртэй
  // даалгавар аль хэдийн байвал retry/давхар илгээлт гэж үзэж алгасна.
  const { results: existingTasks } = await db
    .prepare(`SELECT name FROM tasks WHERE component_id = ?`)
    .bind(componentId)
    .all<{ name: string }>();
  const existingNames = new Set((existingTasks ?? []).map((t) => t.name));

  const created: CreatedMeetingTask[] = [];
  const skippedDuplicates: string[] = [];
  for (const item of items) {
    if (existingNames.has(item.text)) {
      skippedDuplicates.push(item.text);
      continue;
    }
    existingNames.add(item.text);
    const assignees = item.assignee_ids.filter((id) => validIds.has(id));
    const row = await db
      .prepare(
        `INSERT INTO tasks (component_id, name, weight_percent, assigned_to, due_date, sort_order)
         VALUES (?, ?, 0, ?, ?, ?) RETURNING id`,
      )
      .bind(componentId, item.text, assignees[0] ?? null, item.due_date, sortOrder++)
      .first<{ id: number }>();
    if (!row) continue;

    if (assignees.length > 0) {
      const stmt = db.prepare(
        `INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)`,
      );
      await db.batch(assignees.map((uid) => stmt.bind(row.id, uid)));
      // Хурлын даалгавар гэдгийг мэдэгдлийн body-д тодруулна.
      for (const uid of assignees) {
        await createNotification(
          db,
          uid,
          'task_assigned',
          'Танд хурлаас даалгавар оноогдлоо',
          `${meeting.title} — ${item.text}${item.due_date ? ` (дуусах ${item.due_date})` : ''}`,
          '/app/my-tasks',
        );
      }
    }

    created.push({
      id: row.id,
      name: item.text,
      assignee_ids: assignees,
      due_date: item.due_date,
    });
  }

  return {
    ok: true,
    project_id: project.id,
    project_name: project.name,
    block_id: blockId,
    component_id: componentId,
    tasks: created,
    dropped_assignee_ids: droppedIds,
    skipped_duplicates: skippedDuplicates,
  };
}
