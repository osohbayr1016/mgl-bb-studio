import { Hono } from 'hono';
import type { Env, AppVariables } from '../types';
import { isAdminRole } from '../types';
import { requireAdmin, requireManager } from '../middleware/auth';
import { todayInUB } from '../lib/time';
import { notifyProjectResponsible } from '../lib/notify';
import { parseTimelineJson } from '../lib/passportTimeline';
import {
  applyExtensionToTimelineRows,
  deadlineChangeInsert,
  revertExtensionInTimelineRows,
  summarizeDeadlineChanges,
  toIsoDateLoose,
  validateExtensionInput,
  type DeadlineChangeRow,
  type DeadlineSummary,
} from '../lib/deadlineExtensions';

/* ============================================================
 *  Төслийн дуусах хугацааны СУНГАЛТ + ТҮҮХ — `/api/deadlines/project/:id/extensions`
 * ============================================================
 *  `routes/deadlines.ts`-ийн ХОЁР ДАХЬ mount (`/api/deadlines`) — тэр файл
 *  2300 мөр бөгөөд энэ нь тусдаа ойлголт (migration 0337).  Замууд нь
 *  `/project/:id/extensions…` тул үндсэн router-ийн `/project/:id`-тэй
 *  мөргөлдөхгүй, mount-ийн дараалал хамаагүй.
 *
 *  ДҮРЭМ (`lib/deadlineExtensions.ts`):
 *    • `project_passport.finish_date` = одоо хүчинтэй хугацаа.  Сунгалт нь
 *      түүхийн мөр БИЧЭЭД баганыг шинэчилнэ — уншдаг 30 гаруй газар
 *      (overdue, Timeline, график, тойм, MCP, PDF) юу ч мэдэхгүй, шинэ
 *      хугацааг автоматаар авна.
 *    • 1.3 хүснэгт (`timeline_json`) ХАМТ шинэчлэгдэнэ: `tl-finish` := шинэ,
 *      сунгалт бүр өөрийн `tl-ext*` мөртэй (жишиг баримтын хэлбэр).
 *    • `project_reminders` цэвэрлэгдэнэ — шинэ хугацаан дээр d7/d3/d1
 *      сануулга дахин ажиллана (routes/timeline.ts-ийн ижил дүрэм).
 *
 *  ХАНДАЛТ: унших — `/api/deadlines`-ийн бүх staff (`worker`/`client` нь
 *  scope guard-аар 403); сунгах — admin + senior (`requireManager`,
 *  паспортын 1.3-ыг засах эрхтэй ижил олонлог); буцаах — ЗӨВХӨН admin.
 */
const projectDeadline = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type PassportDates = {
  start_date: string | null;
  finish_date: string | null;
  extension_date: string | null;
  timeline_json: string | null;
};

type ProjectMeta = {
  id: number;
  name: string;
  display_title: string | null;
  status: string;
};

const CHANGES_SQL = `SELECT c.id, c.project_id, c.kind, c.seq, c.from_date, c.to_date, c.days, c.reason,
                            c.approved_by_kind, c.approved_by_name, c.approved_on, c.reference_no, c.note,
                            c.created_by, c.created_at, u.full_name AS created_by_name
                       FROM project_deadline_changes c
                       LEFT JOIN users u ON u.id = c.created_by
                      WHERE c.project_id = ?
                      ORDER BY c.id`;

async function loadProject(db: D1Database, id: number): Promise<ProjectMeta | null> {
  return db
    .prepare('SELECT id, name, display_title, status FROM projects WHERE id = ?')
    .bind(id)
    .first<ProjectMeta>();
}

async function loadPassport(db: D1Database, id: number): Promise<PassportDates | null> {
  return db
    .prepare(
      'SELECT start_date, finish_date, extension_date, timeline_json FROM project_passport WHERE project_id = ?',
    )
    .bind(id)
    .first<PassportDates>();
}

async function loadChanges(db: D1Database, id: number): Promise<DeadlineChangeRow[]> {
  const res = await db.prepare(CHANGES_SQL).bind(id).all<DeadlineChangeRow>();
  return res.results ?? [];
}

export interface DeadlineHistoryResponse extends DeadlineSummary {
  today: string;
  /** Сунгалт бүртгэх эрх (admin + senior). */
  can_manage: boolean;
  /** Сүүлийн сунгалтыг буцаах эрх (admin). */
  can_revert: boolean;
  /** `finish_date` баганын түүхий утга (ISO биш байж болно — UI «тогтоогоогүй»
   *  гэж худал хэлэхгүйн тулд). */
  raw_finish_date: string | null;
  items: DeadlineChangeRow[];
}

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/* ------------------------------------------------------------------ */
/*  GET /project/:id/extensions                                        */
/* ------------------------------------------------------------------ */

projectDeadline.get('/project/:id/extensions', async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Төслийн дугаар буруу' }, 400);
  const user = c.get('user');
  const [project, passport, items] = await Promise.all([
    loadProject(c.env.DB, id),
    loadPassport(c.env.DB, id),
    loadChanges(c.env.DB, id),
  ]);
  if (!project) return c.json({ error: 'Төсөл олдсонгүй' }, 404);
  const summary = summarizeDeadlineChanges(items, passport?.finish_date ?? null);
  const isAdmin = isAdminRole(user.role);
  const body: DeadlineHistoryResponse = {
    ...summary,
    today: todayInUB(),
    can_manage: isAdmin || user.role === 'senior',
    can_revert: isAdmin,
    raw_finish_date: passport?.finish_date ?? null,
    items,
  };
  return c.json(body);
});

/* ------------------------------------------------------------------ */
/*  POST /project/:id/extensions — хугацаа сунгах                      */
/* ------------------------------------------------------------------ */

projectDeadline.post('/project/:id/extensions', requireManager(), async (c) => {
  const id = parseId(c.req.param('id'));
  if (!id) return c.json({ error: 'Төслийн дугаар буруу' }, 400);
  const user = c.get('user');
  const today = todayInUB();
  const body = await c.req.json<unknown>().catch(() => ({}));

  const [project, passport, existing] = await Promise.all([
    loadProject(c.env.DB, id),
    loadPassport(c.env.DB, id),
    loadChanges(c.env.DB, id),
  ]);
  if (!project) return c.json({ error: 'Төсөл олдсонгүй' }, 404);
  if (project.status === 'archived') {
    return c.json({ error: 'Архивлагдсан төслийн хугацааг сунгахгүй', code: 'ARCHIVED' }, 409);
  }

  const v = validateExtensionInput(body, passport?.finish_date ?? null, today);
  if (!v.ok) return c.json({ error: v.error, code: v.code }, 400);
  const input = v.value;
  // Түүхийн мөрөнд ХУУЧИН огноог ISO болгож бичнэ (`2026.07.09` → `2026-07-09`)
  // — `days` бодогдож, UI шууд харьцуулж чадна.  Багана дээрх түүхий утга
  // алдагдахгүй: тэр нь `to_date`-ээр солигдож байгаа тул дахин хэрэггүй.
  const fromDate = toIsoDateLoose(passport?.finish_date) ?? passport?.finish_date ?? null;
  const seq = existing.filter((r) => r.kind === 'extension').length + 1;

  const nextRows = applyExtensionToTimelineRows(
    parseTimelineJson(passport?.timeline_json),
    input.new_finish_date,
    { start_date: passport?.start_date ?? null },
  );
  const nextTimelineJson = nextRows.length > 0 ? JSON.stringify(nextRows) : (passport?.timeline_json ?? null);

  await c.env.DB.batch([
    deadlineChangeInsert(c.env.DB, {
      project_id: id,
      kind: 'extension',
      seq,
      from_date: fromDate,
      to_date: input.new_finish_date,
      reason: input.reason,
      approved_by_kind: input.approved_by_kind,
      approved_by_name: input.approved_by_name,
      approved_on: input.approved_on,
      reference_no: input.reference_no,
      note: input.note,
      created_by: user.sub,
    }),
    // Паспортын мөр `validateExtensionInput` амжилттай бол ЗААВАЛ байна
    // (finish_date уншигдсан) — гэсэн ч upsert хэлбэрээр бичиж, ON CONFLICT
    // дээр зөвхөн хугацааны талбаруудад хүрнэ (гарчиг, захирал… хөндөхгүй).
    c.env.DB.prepare(
      `INSERT INTO project_passport (project_id, finish_date, extension_date, timeline_json, updated_at, updated_by_id)
       VALUES (?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(project_id) DO UPDATE SET
         finish_date    = excluded.finish_date,
         extension_date = excluded.extension_date,
         timeline_json  = excluded.timeline_json,
         updated_at     = datetime('now')`,
    ).bind(id, input.new_finish_date, input.new_finish_date, nextTimelineJson, user.sub),
    // Шинэ хугацаан дээр d7/d3/d1/overdue сануулга дахин ажиллах эрхтэй.
    c.env.DB.prepare('DELETE FROM project_reminders WHERE project_id = ?').bind(id),
  ]);

  const items = await loadChanges(c.env.DB, id);
  const created = items.find((r) => r.kind === 'extension' && r.seq === seq) ?? null;
  const summary = summarizeDeadlineChanges(items, input.new_finish_date);

  // Хариуцагч руу мэдэгдэл — `project_deadline` төрөл (хуваарийн сануулгын
  // ижил ангилал).  Илгээгчийг өөрийг нь хасна.
  const title = project.display_title?.trim() || project.name;
  const days = created?.days ?? null;
  await notifyProjectResponsible(
    c.env.DB,
    id,
    'project_deadline',
    `«${title}» — хугацаа сунгагдлаа (${seq}-р сунгалт)`,
    `${fromDate ?? '—'} → ${input.new_finish_date}${days != null ? ` (+${days} хоног)` : ''}. Шалтгаан: ${input.reason}`,
    `/app/projects/${id}?tab=deadlines`,
    { excludeUserId: user.sub },
  );

  return c.json(
    {
      success: true,
      finish_date: input.new_finish_date,
      item: created,
      ...summary,
    },
    201,
  );
});

/* ------------------------------------------------------------------ */
/*  DELETE /project/:id/extensions/:changeId — сүүлийн сунгалтыг буцаах */
/* ------------------------------------------------------------------ */
/*  Түүх нь append-only боловч ЭНДҮҮРЭЛ засах нэг л зам хэрэгтэй: ЗӨВХӨН
 *  тухайн төслийн ХАМГИЙН СҮҮЛИЙН мөр (дараа нь өөр өөрчлөлт ороогүй) бөгөөд
 *  `finish_date` одоо ч түүний `to_date`-тай тэнцүү үед л буцаана.  Дунд
 *  мөрийг устгах боломжгүй — `seq` дугаарлалт, «анхны хугацаа» эвдэрнэ. */

projectDeadline.delete('/project/:id/extensions/:changeId', requireAdmin(), async (c) => {
  const id = parseId(c.req.param('id'));
  const changeId = parseId(c.req.param('changeId'));
  if (!id || !changeId) return c.json({ error: 'Дугаар буруу' }, 400);

  const [passport, items] = await Promise.all([loadPassport(c.env.DB, id), loadChanges(c.env.DB, id)]);
  const last = items[items.length - 1];
  if (!last || last.id !== changeId) {
    return c.json(
      { error: 'Зөвхөн хамгийн сүүлийн өөрчлөлтийг буцаах боломжтой', code: 'NOT_LATEST' },
      409,
    );
  }
  if (last.kind !== 'extension') {
    return c.json({ error: 'Засварын мөрийг буцаахгүй — «Хуваарь»-аар засна', code: 'NOT_EXTENSION' }, 409);
  }
  const currentIso = toIsoDateLoose(passport?.finish_date);
  if (!last.to_date || currentIso !== last.to_date) {
    return c.json(
      { error: 'Дуусах хугацаа сунгалтаас хойш өөрчлөгдсөн тул буцаах боломжгүй', code: 'STALE' },
      409,
    );
  }

  const prevExt = items.filter((r) => r.kind === 'extension' && r.id !== last.id).pop() ?? null;
  const nextRows = revertExtensionInTimelineRows(
    parseTimelineJson(passport?.timeline_json),
    last.from_date,
    last.to_date,
  );
  const nextTimelineJson = nextRows.length > 0 ? JSON.stringify(nextRows) : (passport?.timeline_json ?? null);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM project_deadline_changes WHERE id = ? AND project_id = ?').bind(changeId, id),
    c.env.DB.prepare(
      `UPDATE project_passport
          SET finish_date = ?, extension_date = ?, timeline_json = ?, updated_at = datetime('now')
        WHERE project_id = ?`,
    ).bind(last.from_date, prevExt?.to_date ?? null, nextTimelineJson, id),
    c.env.DB.prepare('DELETE FROM project_reminders WHERE project_id = ?').bind(id),
  ]);

  const rest = await loadChanges(c.env.DB, id);
  return c.json({ success: true, finish_date: last.from_date, ...summarizeDeadlineChanges(rest, last.from_date) });
});

export default projectDeadline;
