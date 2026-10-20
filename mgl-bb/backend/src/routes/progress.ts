import { Hono } from 'hono';
import { requireRole, requireAdmin } from '../middleware/auth';
import { todayInUB } from '../lib/time';
import { isSingleSegmentMediaUrl } from '../lib/mediaUrl';
import { addDays } from '../lib/workSchedule';
import type {
  Env,
  AppVariables,
  ProgressEntryRow,
  ProgressEntryRequest,
  ProgressBulkRequest,
  ProgressAttachment,
  ProjectComplexity,
} from '../types';
import { COMPLEXITY_PERCENT } from '../types';
import { parseCompletionQuestions, summarizeTaskCompletion } from '../lib/taskCompletionAi';
import { latestApprovedPctByCreatedAt } from '../lib/progressLatest';
import { creditSplit, loadTaskShares, loadProjectTaskShares } from '../lib/taskShares';
import { roundHours } from '../lib/repairHours';
import { syncRepairDayIfMarked } from '../lib/repairDayStore';
import { loadTaskForTake, stopOfficialTimersForTask } from '../lib/taskTimerStore';
import { retractMyTask } from '../lib/taskRetract';
import { orgUtcOffsetMinutes } from '../lib/reportWindows';
import { ubDayWindow } from '../lib/taskTimer';
import {
  SPLIT_DONE_MESSAGE,
  TAKE_DENIAL_MESSAGE,
  TAKE_DENIAL_STATUS,
  TAKE_REQUIRED_MESSAGE,
  distributeByContribution,
  hwmFraction,
  takeDenial,
} from '../lib/taskTake';
import { isCeo } from '../lib/ceo';
import {
  addToMyList,
  hideFromMyList,
  loadMyTaskIdsForProject,
  myTaskIdsSql,
} from '../lib/myTaskList';
import { loadRootsForTasks, rootView } from '../lib/taskRootStore';
import { convertedPartBody, managedRootBody, retiredIntoRoot } from '../lib/taskAllocGate';
import { reconcileCreditOrEnqueue } from '../lib/taskCreditReconcileQueue';

const progress = new Hono<{ Bindings: Env; Variables: AppVariables }>();

type ProgressWithName = ProgressEntryRow & {
  task_name: string | null;
  user_name?: string;
};

interface AwardOutcome {
  delta_pct: number;
  complexity: ProjectComplexity;
  complexity_pct: number;
  total_points: number;
  per_user: number;
  recipients: Array<{ user_id: number; full_name: string; points: number }>;
}

/**
 * Award leaderboard percent-points for a single newly-saved progress entry.
 *
 * Crediting model: the user who submits the entry (`awardedBy`) gets the
 * full share — we do not split between the task's assignees.  If two
 * people are assigned and one submits "90% done", that 90% counts toward
 * the submitter's percent total only.  The other assignee earns when
 * they themselves submit.
 *
 * ONE exception (migration 0322, `lib/taskShares.ts`): a task with
 * `task_shares` rows splits every award by `share_percent`, regardless of
 * who submitted — «би 80% хийгээд нөгөө нь миний ажлыг ашиглаад дуусгасан»
 * still credits 80 / 20.  Both `amount` and `delta_pct` are scaled by the
 * fraction so Σ delta_pct across users still equals the project's progress
 * (the invariant `leaderboard.ts` relies on).
 *
 *   share = complexityPct × Δprojectpct / 100   (percent points)
 *
 * Stored on `user_points.amount`.  Errors are caught at the call site so
 * a leaderboard hiccup never rolls back the (already-successful)
 * progress write.
 *
 * ХАМГИЙН ӨНДӨР ХУВЬ (эзэн 2026-10-01, `lib/taskTake.ts` `hwmFraction`): таск
 * урьд хүрч байсан хамгийн өндөр хувь хүртэлх хэсэг аль хэдийн оноо авсан —
 * зөвхөн түүнээс ДЭЭШ гарсан хэсэг шинэ.  77 → 8 (алдаа) → 77 гэж бичихэд
 * давхар оноо гарахгүй; бусдын хийснийг бууруулаад дахин өсгөгч ч зөвхөн шинээр
 * давсан хэсгийнхээ оноог авна.  `recalculateProjectPoints` ЯГ ижил дүрмээр.
 */
async function awardPointsForEntry(opts: {
  db: D1Database;
  entryId: number;
  taskId: number | null;
  oldPct: number;
  awardedBy: number;
  /** Энэ бичлэгээс ӨМНӨХ таскийн сүүлийн хувь ба хамгийн өндөр хувь. */
  oldTaskPct: number;
  taskHwm: number;
  newTaskPct: number;
}): Promise<{ ok: true; outcome: AwardOutcome | null }> {
  const { db, entryId, taskId, oldPct, awardedBy } = opts;
  if (taskId === null) return { ok: true, outcome: null };

  const chain = await db
    .prepare(
      `
    SELECT b.project_id AS project_id, p.complexity AS complexity,
           p.complexity_pct AS complexity_pct
    FROM tasks t
    JOIN components c ON c.id = t.component_id
    JOIN drawings d  ON d.id = c.drawing_id
    JOIN blocks b    ON b.id = d.block_id
    JOIN projects p  ON p.id = b.project_id
    WHERE t.id = ?
  `,
    )
    .bind(taskId)
    .first<{ project_id: number; complexity: string | null; complexity_pct: number | null }>();
  const projectId = chain?.project_id ?? null;
  if (projectId === null) return { ok: true, outcome: null };

  // Per-project free weight (0-100), entered by an admin. The legacy tier
  // string is kept only for the toast payload's `complexity` label.
  const complexity = (chain?.complexity ?? 'mid') as ProjectComplexity;
  const complexityPct = Math.max(0, chain?.complexity_pct ?? COMPLEXITY_PERCENT.mid);
  if (complexityPct <= 0) return { ok: true, outcome: null };

  const newPct = await calcProjectProgress(db, projectId);
  const deltaPct =
    Math.max(0, newPct - oldPct) * hwmFraction(opts.oldTaskPct, opts.newTaskPct, opts.taskHwm);
  if (deltaPct <= 0.0001) return { ok: true, outcome: null };

  const share = complexityPct * (deltaPct / 100);

  // Хамтарсан ажил (0322): task_shares мөртэй бол хувиар хуваана, үгүй бол
  // илгээгч 100%.  `awarded_by` нь бүх мөрөнд илгээгч хэвээр — хуваалт
  // хасагдахад `redistributeTaskPoints` түүгээр буцаана.
  const split = creditSplit(await loadTaskShares(db, taskId), awardedBy);

  // Look up the recipients' names for the toast payload.  Even if a user
  // row was deleted between submit and award we still write the
  // user_points row so the leaderboard math stays consistent — the name
  // just falls back to a placeholder.
  const nameRows = await db
    .prepare(
      `SELECT id, full_name FROM users WHERE id IN (${split.map(() => '?').join(',')})`,
    )
    .bind(...split.map((s) => s.user_id))
    .all<{ id: number; full_name: string }>();
  const nameById = new Map((nameRows.results ?? []).map((r) => [r.id, r.full_name]));

  const insertStmt = db.prepare(
    `
    INSERT INTO user_points
      (user_id, project_id, task_id, progress_entry_id,
       amount, delta_pct, assignee_count, awarded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
  );
  await db.batch(
    split.map((s) =>
      insertStmt.bind(
        s.user_id,
        projectId,
        taskId,
        entryId,
        share * s.fraction,
        deltaPct * s.fraction,
        split.length,
        awardedBy,
      ),
    ),
  );

  const mine = split.find((s) => s.user_id === awardedBy);
  return {
    ok: true,
    outcome: {
      delta_pct: deltaPct,
      complexity,
      complexity_pct: complexityPct,
      total_points: share,
      per_user: share * (mine?.fraction ?? 0),
      recipients: split.map((s) => ({
        user_id: s.user_id,
        full_name: nameById.get(s.user_id) ?? '',
        points: share * s.fraction,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Хавсралт (migration 0177)
// ---------------------------------------------------------------------------
// Нэг тайланд олон файл: зураг, PDF, DWG, скриншот.  `url` нь ЗААВАЛ
// `/media/<key>` байх ёстой — `POST /api/upload` яг тэрийг буцаадаг.
// Гадаад URL-ыг хориглосон нь: тайлангийн хавсралт нь өөр серверийн
// агуулга рүү заавал болохгүй (тэр нь дараа нь өөрчлөгдөж/алга болж
// болно) бөгөөд admin-ий шалгах гарц нь бидний R2 л байх ёстой.

const MAX_ATTACHMENTS = 10;
const MAX_ATTACHMENT_URL = 512;
const MAX_ATTACHMENT_NAME = 200;

/** Хадгалагдсан JSON-ыг массив болгож унших.  Гэмтсэн/хоосон бол `[]` —
 *  унших тал хэзээ ч шидэхгүй (0177-ийн толгойн тэмдэглэлийг үз). */
function parseAttachments(raw: string | null | undefined): ProgressAttachment[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is ProgressAttachment =>
        !!a && typeof a === 'object' && typeof (a as ProgressAttachment).url === 'string',
    );
  } catch {
    return [];
  }
}

/** Клиентээс ирсэн хавсралтын массивыг цэвэрлэж, хадгалах JSON + хуучин
 *  `image_url` баганад тавих эхний ЗУРАГ-ийг буцаана. */
export function normalizeAttachmentsInput(
  raw: unknown,
): { ok: true; json: string | null; firstImage: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, json: null, firstImage: null };
  if (!Array.isArray(raw)) return { ok: false, error: 'attachments must be an array' };
  if (raw.length === 0) return { ok: true, json: null, firstImage: null };
  if (raw.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `Хамгийн ихдээ ${MAX_ATTACHMENTS} хавсралт` };
  }

  const cleaned: ProgressAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'Invalid attachment' };
    const a = item as Record<string, unknown>;
    const url = typeof a.url === 'string' ? a.url.trim() : '';
    // ⚠️ Урьд нь зөвхөн `url.startsWith('/media/')` байсан — тэр нь
    // `/media/email%2F5%2Fx%2Fbody.html` мэтийг НЭВТРҮҮЛДЭГ.  Hono `%2F`-ыг
    // задалдаг тул тийм утга уншихад хавтастай R2 түлхүүр болно
    // (`lib/mediaUrl.ts`-ийн толгойг үз).
    if (!isSingleSegmentMediaUrl(url) || url.length > MAX_ATTACHMENT_URL) {
      return { ok: false, error: 'Attachment url must be a /media/ key' };
    }
    const rawName = typeof a.name === 'string' ? a.name.trim() : '';
    const name = (rawName || url.slice('/media/'.length)).slice(0, MAX_ATTACHMENT_NAME);
    const type = typeof a.type === 'string' ? a.type.slice(0, 100) : undefined;
    const size = typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : undefined;
    cleaned.push({ url, name, ...(type ? { type } : {}), ...(size !== undefined ? { size } : {}) });
  }

  // MIME төрөл нь заримдаа хоосон ирдэг (үйлдлийн систем таниагүй) тул
  // өргөтгөлөөр нь ч шалгана — эс бөгөөс `image_url` хоосон үлдэж хуучин
  // уншигчид зургийг олохгүй.
  const firstImage =
    cleaned.find(
      (a) => (a.type ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|avif)$/i.test(a.url),
    )?.url ?? null;
  return { ok: true, json: JSON.stringify(cleaned), firstImage };
}

// ---------------------------------------------------------------------------
// Нэг тайлангийн бичилт — `POST /` ба `POST /bulk` ХОЁУЛАА үүнийг дууддаг
// ---------------------------------------------------------------------------
// Bulk нь энэ функцийг ДАРААЛЛААР дуудна: мөр бүр өөрийн Δ%-ийг тооцохын
// тулд төслийн явцыг бичилтийн ӨМНӨ агшин зуур авдаг тул зэрэг ажиллуулбал
// хоёр мөр ижил snapshot дээр суугаад leaderboard-ийн оноо давхардана.

export interface ProgressSubmitCtx {
  db: D1Database;
  ai: Env['AI'];
  /** `c.executionCtx.waitUntil` — бүтцээр нь дамжуулна.  Глобал
   *  `ExecutionContext` нэрийг Hono ба workers-types хоёр зөрчилтэй
   *  зарладаг (CLAUDE.md-ийн `softDeleteMessageIds` тэмдэглэлийг үз). */
  waitUntil: (p: Promise<unknown>) => void;
  user: { sub: number; role: string };
}

type SubmitStatus = 201 | 400 | 403 | 404 | 409;

interface SubmitResult {
  ok: boolean;
  status: SubmitStatus;
  body: Record<string, unknown>;
}

/**
 * Дуудагчийн НЭМЭЛТ тохиргоо.  Вэбийн хэвийн зам үүнийг ОГТ дамжуулдаггүй
 * тул анхдагч утгууд нь өнөөдрийн зан төлөвтэй ЯГ ИЖИЛ байх ёстой.
 *
 * `source`  — `progress_entries.source` (migration 0190).  'web' = хөтөч,
 *             'revit' = Revit add-in.  Rollup-ийн 11 хуулбарын аль нь ч
 *             үүнийг уншдаггүй; зөвхөн аудит болон шүүлтүүрт.
 *
 * (`forcePending` байсан — 2026-09-17-нд баталгаажуулалтын алхам бүхэлдээ
 * хасагдсан тул мөр бүр шууд `approved`.  Доорх тайлбарыг үз.)
 */
export interface SubmitOptions {
  source?: 'web' | 'revit';
}

export function ctxOf(c: {
  env: Env;
  executionCtx: { waitUntil: (p: Promise<unknown>) => void };
  get: (k: 'user') => { sub: number; role: string };
}): ProgressSubmitCtx {
  return {
    db: c.env.DB,
    ai: c.env.AI,
    waitUntil: (p) => c.executionCtx.waitUntil(p),
    user: c.get('user'),
  };
}

export async function submitProgressEntry(
  ctx: ProgressSubmitCtx,
  body: ProgressEntryRequest,
  options: SubmitOptions = {},
): Promise<SubmitResult> {
  const source = options.source ?? 'web';
  const { db, user } = ctx;
  const isRestDay = !!body.is_rest_day;
  const isDeferNext = !!body.defer_next_day && !isRestDay;
  const fail = (status: SubmitStatus, b: Record<string, unknown>): SubmitResult => ({
    ok: false,
    status,
    body: b,
  });

  if (isRestDay && body.defer_next_day) {
    return fail(400, { error: 'Cannot combine rest day and defer-to-tomorrow' });
  }
  // Default to "today" in Ulaanbaatar so mobile/field users don't have to
  // think about timezones.
  const entryDate = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : todayInUB();

  // Rest days and "Маргааш" deferrals don't require a percentage — we carry
  // forward the last recorded % so roll-ups never regress.
  if (!isRestDay && !isDeferNext) {
    if (body.percentage === undefined) {
      return fail(400, { error: 'percentage is required' });
    }
    if (body.percentage < 0 || body.percentage > 100) {
      return fail(400, { error: 'Percentage must be between 0 and 100' });
    }
  }

  if (!body.task_id) {
    return fail(400, { error: 'task_id is required' });
  }

  const att = normalizeAttachmentsInput(body.attachments);
  if (!att.ok) return fail(400, { error: att.error });

  // Хувь оруулах эрх (эзэн 2026-10-01: «таскийг авалгүйгээр хийх боломжгүй»):
  // тухайн таск дээр албан таймерын сэшнтэй (нэг ч удаа «Өөртөө авах»-аар
  // ажилласан) хүн — яг одоо ажиллаж байх албагүй (оройн тайлан).  admin
  // залруулга хэвээр.  Байнгын «хариуцагч» байхгүй болсон тул `assigned_to` /
  // `task_assignees`-ээр шалгахаа больсон; senior-т ч ИЖИЛ (тэр өөрөө таск авдаг).
  let itemName: string | null = null;
  let projectId: number | null = null;
  const task = await db
    .prepare(
      `
    SELECT t.name, b.project_id, b.team_id,
           p.completion_questions AS completion_questions,
           p.progress_mode,
           -- Хүчинтэй (хүчингүй болгоогүй) цагийн сэшн: bookmark, хүчингүй болгосон сэшн нь нотолгоо БИШ (0379).
           EXISTS (SELECT 1 FROM task_timer_sessions s
                    WHERE s.task_id = t.id AND s.user_id = ?
                      AND NOT EXISTS (SELECT 1 FROM task_timer_voids v WHERE v.session_id = s.id AND v.restored_at IS NULL)) AS has_taken,
           EXISTS (SELECT 1 FROM progress_entries sp
                    WHERE sp.task_id = t.id AND sp.source = 'split' AND sp.status = 'approved') AS split_done,
           (EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = t.id)
            OR EXISTS (SELECT 1 FROM task_conversion_members cm WHERE cm.task_id = t.id AND cm.role = 'retired')) AS managed
    FROM tasks t
    INNER JOIN components c ON c.id = t.component_id
    INNER JOIN drawings d ON d.id = c.drawing_id
    INNER JOIN blocks b ON b.id = d.block_id
    INNER JOIN projects p ON p.id = b.project_id
    WHERE t.id = ?
  `,
    )
    .bind(user.sub, body.task_id)
    .first<{
      name: string;
      project_id: number;
      team_id: number | null;
      completion_questions: string | null;
      progress_mode: string | null;
      has_taken: 0 | 1;
      split_done: 0 | 1;
      managed: 0 | 1;
    }>();
  if (!task) return fail(404, { error: 'Task not found' });
  // Хуваарилагдсан («managed») үндсэн ажил: root-ийн хувь нь олон хүний хэсгийн НИЙЛБЭР тул хуучин
  // «root-ийн хувь бичих» зам (вэб, /bulk, Revit add-in) хаалттай — өөрийн хэсгийг
  // `POST /api/tasks/:id/allocation/progress`-оор бөглөнө.  Админ ч мөн (залруулга нь тусдаа зам).
  if (task.managed === 1) {
    const into = await retiredIntoRoot(db, Number(body.task_id));
    return fail(409, into !== null ? convertedPartBody(Number(body.task_id), task.project_id, into) : managedRootBody(Number(body.task_id), task.project_id));
  }
  // Цагаар бодох төсөл (0339, шинэ ZA засварын төсөл): таск дээр гараар %
  // бичих зам ХААЛТТАЙ — явц нь зөвхөн «Засвар бүртгэх» цагийн бүртгэлээс.
  // Web, /bulk, Revit add-in бүгд энэ функцээр ордог тул нэг хаалт хангалттай.
  if (task.progress_mode === 'hours') {
    return fail(403, {
      error: 'HOURS_PROGRESS',
      message:
        'Засварын төсөлд хувь бөглөхгүй — «Миний таскууд» дээр «Ажилласан» гэж тэмдэглэнэ үү, цагийг систем бодно.',
    });
  }
  if (user.role !== 'admin' && task.has_taken !== 1) {
    return fail(403, { error: 'TAKE_REQUIRED', message: TAKE_REQUIRED_MESSAGE });
  }
  // Хуваалтаар хаагдсан «хийгдсэн хэсэг» — хуучин хуудаснаас 80% гэж бичвэл
  // явц 100 → 80 болж буурна.  Үргэлжлэл нь хуваасан шинэ хэсэг дээр.
  if (user.role !== 'admin' && task.split_done === 1) {
    return fail(409, { error: 'SPLIT_DONE', message: SPLIT_DONE_MESSAGE });
  }
  itemName = task.name;
  projectId = task.project_id;
  void itemName;

  // For rest-day / defer-to-tomorrow, carry over the most recent % for this item so
  // roll-ups & "current progress" don't regress. Defaults to 0.
  let effectivePct: number;
  if (isRestDay || isDeferNext) {
    const prev = await db
      .prepare(
        `SELECT percentage FROM progress_entries
       WHERE task_id = ? AND status = 'approved'
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .bind(body.task_id)
      .first<{ percentage: number }>();
    effectivePct = prev?.percentage ?? 0;
  } else {
    effectivePct = body.percentage!;
  }

  // When this entry would close the task (100%), require answers to the
  // project's completion questions so the AI summary has something to chew
  // on. Rest-day / defer entries are exempt — they don't close the task.
  const closesTask = !isRestDay && !isDeferNext && effectivePct >= 100;
  let completionQaJson: string | null = null;
  if (closesTask) {
    const questions = parseCompletionQuestions(task.completion_questions);
    const answers = body.completion_qa ?? {};
    const missing = questions.filter((q) => !(answers[q.id] ?? '').trim()).map((q) => q.text);
    if (missing.length > 0) {
      return fail(400, {
        error: 'completion_qa required',
        message: 'Ажил дуусгахын тулд бүх асуултад хариулна уу.',
        questions,
        missing,
      });
    }
    const trimmed: Record<string, string> = {};
    for (const q of questions) trimmed[q.id] = (answers[q.id] ?? '').trim();
    completionQaJson = JSON.stringify(trimmed);
  }

  // Every submission — 100% closures included — is the source of truth
  // immediately.  The team-lead approval step for 100% closures was removed
  // on 2026-09-17 (owner's decision: employees are trusted to close their own
  // tasks; the «Баталгаажуулах» queue only slowed them down).  `reviewed_by`
  // / `reviewed_at` are stamped to the submitter so the audit trail still
  // records who/when.  `status='pending'` / `'rejected'` are never written
  // any more; migration 0323 flipped the last pending rows.
  const status = 'approved' as const;
  const reviewed_by = user.sub;
  const reviewed_at = new Date().toISOString();

  // Auto-prepend prefixes so lists and exports stay readable without a join.
  const finalNotes = isRestDay
    ? body.notes?.trim()
      ? `Амарсан — ${body.notes.trim()}`
      : 'Амарсан'
    : isDeferNext
      ? body.notes?.trim()
        ? `Маргааш хийнэ — ${body.notes.trim()}`
        : 'Маргааш хийнэ'
      : (body.notes ?? null);

  // Snapshot project progress BEFORE the insert so we can credit points
  // for the marginal contribution of this entry. Rest-day / defer carry
  // the previous % forward so they won't move the needle, but it's cheap
  // to snapshot anyway and the award helper short-circuits on Δpct ≤ 0.
  const willAward = !isRestDay && !isDeferNext && projectId !== null;
  const oldProjectPct = willAward ? await calcProjectProgress(db, projectId!) : 0;
  // Таскийн ӨМНӨХ сүүлийн хувь (`calcProjectProgress`-тэй ижил `created_at` дараалал)
  // ба хамгийн өндөр хувь — оноо зөвхөн түүнээс дээш (`hwmFraction`).
  const taskHistory = willAward
    ? await db
        .prepare(
          `SELECT COALESCE(${latestApprovedPctByCreatedAt('?1')}, 0) AS last_pct,
                  COALESCE((SELECT MAX(h.percentage) FROM progress_entries h
                             WHERE h.task_id = ?1 AND h.status = 'approved'), 0) AS hwm`,
        )
        .bind(body.task_id)
        .first<{ last_pct: number; hwm: number }>()
    : null;

  // `image_url` нь хуучин ганц зургийн багана.  Хэрэв дуудагч зөвхөн шинэ
  // `attachments`-ыг өгсөн бол эхний ЗУРГИЙГ нь тэнд давхар бичнэ — ингэснээр
  // `image_url`-ыг уншдаг хуучин код (тайлан, экспорт) хэвээр ажиллана.
  const imageUrl = body.image_url ?? att.firstImage;
  // ⚠️ `body.image_url` нь урьд НЭГ Ч шалгалтгүй байсан — дурын мөр (гадаад
  //    URL, хавтастай `/media/…`) шууд баганад ордог байв.  `att.firstImage`
  //    нь аль хэдийн шалгагдсан тул давхардсан шалгалт үнэгүй.
  //    `null`/хоосон нь хүчинтэй (зураггүй тайлан) тул зөвхөн УТГАТАЙГ шална.
  if (imageUrl != null && imageUrl !== '' && !isSingleSegmentMediaUrl(imageUrl)) {
    return fail(400, { error: 'image_url must be a /media/ key' });
  }

  const result = await db
    .prepare(
      `INSERT INTO progress_entries
       (task_id, user_id, percentage, date, notes,
        status, reviewed_by, reviewed_at, image_url, is_rest_day, defer_next_day,
        completion_qa, attachments, source)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM task_roots r WHERE r.task_id = ?)
        AND NOT EXISTS (SELECT 1 FROM task_conversion_members cm WHERE cm.task_id = ? AND cm.role = 'retired')`,
    )
    .bind(
      body.task_id,
      user.sub,
      effectivePct,
      entryDate,
      finalNotes,
      status,
      reviewed_by,
      reviewed_at,
      imageUrl,
      isRestDay ? 1 : 0,
      isDeferNext ? 1 : 0,
      completionQaJson,
      att.json,
      source,
      body.task_id,
      body.task_id,
    )
    .run();
  // ⚠️ Дээрх `managed` шалгалт ба энэ INSERT атом БИШ байв: хооронд хуваалт (managed болгох) commit хийгдвэл хуучин
  //    «root-ийн хувь бичих» мөр managed таск дээр орж, Σ D ≠ root_done болно.  INSERT өөрөө одоо root байхгүй үед л ажиллана.
  if (Number(result.meta.changes) === 0) {
    const into = await retiredIntoRoot(db, Number(body.task_id));
    return fail(409, into !== null ? convertedPartBody(Number(body.task_id), projectId, into) : managedRootBody(Number(body.task_id), projectId));
  }

  // Award leaderboard points for the marginal Δ% this entry caused.
  let pointsAwarded: AwardOutcome | null = null;
  if (willAward) {
    try {
      const res = await awardPointsForEntry({
        db,
        entryId: Number(result.meta.last_row_id),
        taskId: body.task_id,
        oldPct: oldProjectPct,
        awardedBy: user.sub,
        oldTaskPct: Number(taskHistory?.last_pct) || 0,
        taskHwm: Number(taskHistory?.hwm) || 0,
        newTaskPct: effectivePct,
      });
      if (res.ok) pointsAwarded = res.outcome;
    } catch (err) {
      console.error('Award pipeline failed (entry already saved):', err);
    }
  }

  // Таск 100% болж хаагдсан бол түүн дээр явж буй АЛБАН ЁСНЫ таймерыг (0361)
  // зогсооно — вэб, /bulk, Revit гурвуулаа энэ функцээр ордог тул нэг газар.
  // Хаах дүрэм (асуулт заавал) ӨӨРЧЛӨГДӨӨГҮЙ; таймер зөвхөн үр дагавар.
  // Бичлэг аль хэдийн хадгалагдсан тул алдаа нь хариуг унагахгүй.
  if (closesTask) {
    try {
      await stopOfficialTimersForTask(db, {
        taskId: body.task_id,
        actorId: user.sub,
        nowIso: new Date().toISOString(),
        requestId: crypto.randomUUID(),
        reason: 'auto_stop_completed',
      });
    } catch (err) {
      console.error('[task-timer] auto-stop on completion failed (entry already saved):', err);
    }
  }

  // Fire-and-forget: ask Workers AI to fold the answers + recent notes
  // into a short Mongolian summary cached on `tasks`.
  if (closesTask) {
    const taskId = body.task_id;
    ctx.waitUntil(summarizeTaskCompletion({ db, ai: ctx.ai, taskId }));
  }

  let projectArchived = false;
  if (projectId !== null) {
    try {
      projectArchived = await archiveProjectIfComplete(db, projectId);
    } catch (err) {
      console.error('Auto-archive failed (entry already saved):', err);
    }
  }

  return {
    ok: true,
    status: 201,
    body: {
      message: isRestDay
        ? 'Амарсан тэмдэглэгдлээ'
        : isDeferNext
          ? 'Маргааш хийнэ гэж тэмдэглэгдлээ'
          : projectArchived
            ? 'Төсөл 100% хүрч архивлагдлаа'
            : effectivePct >= 100
              ? 'Ажил 100% дууссан гэж бүртгэгдлээ'
              : 'Явц хадгалагдлаа',
      id: result.meta.last_row_id,
      status,
      task_id: body.task_id,
      project_id: projectId,
      project_archived: projectArchived,
      points_awarded: pointsAwarded,
    },
  };
}

/**
 * Хувийн бөглөлт нь өдрийн засварын цагийн ХИЛИЙГ хөдөлгөнө (миграц 0348,
 * lib/repairDay.ts): «өглөөний ажлаа 12:00-д бөглөсөн бол засвар тэр цагаас
 * эхэлнэ», мөн нэг суултын таскийн тоо өөрчлөгдөнө.  Өнөөдөр засварын
 * тэмдэглэгээтэй хүний өдрийг дахин хуваарилна.  Хүсэлтийн ДОТОР (await) —
 * `waitUntil`-ээр бол дараалсан хоёр бөглөлтийн sync бие биенээ хуучин
 * snapshot-оор дарж болно.  Алдаа нь бөглөлтийг унагахгүй (мөр аль хэдийн
 * хадгалагдсан).  Өнгөрсөн огнооны бөглөлт хуучин өдрийг хөдөлгөхгүй.
 */
async function resyncRepairHours(
  db: D1Database,
  userId: number,
  dates: Iterable<string | null | undefined>,
): Promise<void> {
  const today = todayInUB();
  let touchesToday = false;
  for (const d of dates) if (!d || d === today) touchesToday = true;
  if (!touchesToday) return;
  try {
    await syncRepairDayIfMarked(db, userId, today);
  } catch (err) {
    console.error('[repair-day] resync after progress failed', err);
  }
}

// POST /api/progress — daily report (progress % + optional attachments, or rest-day).
//
// Every submission is written with `status='approved'` immediately — there
// is no review step at any percentage (the 100%-closure approval queue was
// removed 2026-09-17).  Leaderboard points are awarded in the same request.
progress.post('/', requireRole('engineer', 'architect', 'senior', 'admin'), async (c) => {
  const body = await c.req.json<ProgressEntryRequest>();
  const res = await submitProgressEntry(ctxOf(c), body);
  if (res.ok) await resyncRepairHours(c.env.DB, c.get('user').sub, [body.date]);
  return c.json(res.body, res.status);
});

// POST /api/progress/bulk — олон мөрийн өдөр тутмын тайланг НЭГ хүсэлтээр.
//
// Яагаад: 15 таск = 15 round-trip байсан.  Утсан дээр талбар дээрээс
// илгээхэд энэ нь хамгийн удаан хэсэг байв.  Одоо мөрүүдээ сонгоод нэг
// дарахад бүгд явна.
//
// Гэрээ:
//   • `entries` — `POST /` -тэй ЯГ ижил бие бүхий массив (≤ BULK_MAX).
//   • Мөр бүр ТУСДАА амжилт/алдаатай: нэг мөр 403 болоход бусад нь
//     хадгалагдсан хэвээр үлдэнэ (энэ нь transaction БИШ — D1 дээр
//     хэдэн арван INSERT-ийг нэг transaction-д барих боломж байхгүй,
//     мөн хагас хадгалагдсан нь алдагдсанаас дээр).
//   • ДАРААЛЛААР боловсруулна: мөр бүр өөрийн Δ%-ийн snapshot-ыг
//     бичилтийн өмнө авдаг тул зэрэгцүүлбэл оноо давхардана.
//   • 100% хаалт (completion_qa шаардсан) нь мөрийн түвшинд 400 буцаана;
//     UI түүнийг нь ганцаарчилсан «Дуусгах» dialog руу залгамжилна.
const BULK_MAX = 40;

progress.post('/bulk', requireRole('engineer', 'architect', 'senior', 'admin'), async (c) => {
  const body = await c.req.json<ProgressBulkRequest>().catch(() => null);
  const entries = body?.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    return c.json({ error: 'entries is required' }, 400);
  }
  if (entries.length > BULK_MAX) {
    return c.json({ error: `Нэг удаад хамгийн ихдээ ${BULK_MAX} тайлан` }, 400);
  }

  const ctx = ctxOf(c);
  const results: Array<{
    task_id: number | null;
    ok: boolean;
    status: number;
    body: Record<string, unknown>;
  }> = [];
  for (const entry of entries) {
    try {
      const res = await submitProgressEntry(ctx, entry);
      results.push({
        task_id: entry?.task_id ?? null,
        ok: res.ok,
        status: res.status,
        body: res.body,
      });
    } catch (err) {
      // Нэг мөрийн гэнэтийн алдаа үлдсэн мөрүүдийг зогсоохгүй.
      console.error('Bulk progress row failed:', err);
      results.push({
        task_id: entry?.task_id ?? null,
        ok: false,
        status: 500,
        body: { error: 'Хадгалж чадсангүй' },
      });
    }
  }

  const saved = results.filter((r) => r.ok).length;
  // Бүх мөрийн ДАРАА НЭГ удаа — мөр бүрд sync хийвэл нэг өдрийг 40 дахин бодно.
  if (saved > 0) {
    await resyncRepairHours(
      c.env.DB,
      c.get('user').sub,
      entries.map((e) => e?.date),
    );
  }
  return c.json({ results, saved, failed: results.length - saved });
});

// GET /api/progress/my-tasks — МИНИЙ АЖЛУУД (2026-10-01, эзэн): миний ажилласан таскууд
// (`task_assignees` = «тухайн таск дээр ажиллаж байсан хүмүүс»-ийн бүртгэл — 0369: хувь
// оруулсан + албан таймер эхлүүлсэн хүмүүс) ∪ төслийн хуудаснаас «Миний ажилд нэмэх»-ээр
// нэмсэн таскууд (0370, ЗӨВХӨН надад харагдана) − «Миний ажлаас хасах»-аар хассан таскууд.
// Олонлог `lib/myTaskList.ts myTaskIdsSql`.  Мөр бүр `can_report` (миний таймерын сэшнтэй —
// хувь оруулах эрх) ба `working` (ОДОО хэн ажиллаж байна; нэр л — шинэчлэл нь
// `/task-timer/working?mine=1`).  Цаг эхлүүлэх нь эндээс ч болно (`/task-timer/start`).

// Row shape of the my-tasks SELECT below — tasks joined up the
// component → drawing → block → project chain, aliased per level.
interface MyTaskRow {
  id: number;
  name: string;
  weight_percent: number;
  assigned_to: number | null;
  due_date: string | null;
  start_date: string | null;
  ai_completion_summary: string | null;
  ai_completion_summary_at: string | null;
  component_id: number;
  component_name: string;
  drawing_id: number;
  drawing_name: string;
  block_id: number;
  block_name: string;
  project_id: number;
  project_name: string;
  project_completion_questions: string | null;
  project_category: string | null;
  /** 'tasks' | 'hours' (0339).  'hours' бол мөр дээр % бичих маягт байхгүй —
   *  явц цагийн бүртгэлээс. */
  project_progress_mode: string | null;
  /** 1 = энэ хэрэглэгч «миний хийх ажил дууссан» гэж тэмдэглэсэн (0253). */
  self_done: 0 | 1;
  self_done_at: string | null;
  /** Сүүлийн батлагдсан хувь (`byCreatedAt` — өмнөх мөр тутмын асуулгатай ижил). */
  current_progress: number;
  item_type: 'task';
}

progress.get('/my-tasks', async (c) => {
  const user = c.get('user');
  const today = todayInUB();

  const { results: tasks } = await c.env.DB.prepare(
    `
    SELECT 
      t.id, t.name, t.weight_percent, t.assigned_to, t.due_date, t.start_date,
      t.ai_completion_summary, t.ai_completion_summary_at,
      comp.id AS component_id, comp.name AS component_name,
      d.id AS drawing_id, d.name AS drawing_name,
      b.id AS block_id, b.name AS block_name,
      p.id AS project_id, p.name AS project_name,
      p.completion_questions AS project_completion_questions,
      p.category AS project_category,
      p.progress_mode AS project_progress_mode,
      CASE WHEN sd.id IS NULL THEN 0 ELSE 1 END AS self_done,
      sd.created_at AS self_done_at,
      COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS current_progress,
      'task' AS item_type
    FROM tasks t
    JOIN components comp ON comp.id = t.component_id
    JOIN drawings d ON d.id = comp.drawing_id
    JOIN blocks b ON b.id = d.block_id
    JOIN projects p ON p.id = b.project_id
    -- «Би өөрийн хэсгээ дуусгасан» хувийн тэмдэглэгээ (0253).  ЗӨВХӨН
    -- харагдац: ямар ч rollup энэ хүснэгтийг уншдаггүй.
    LEFT JOIN task_self_done sd ON sd.task_id = t.id AND sd.user_id = ?
    -- Миний жагсаалт = ажилласан (task_assignees + хуучин скаляр assigned_to) ∪ нэмсэн −
    -- хассан (0370).  2026-09-11 (D1 аудит): «assigned_to = ? OR EXISTS(...)» нь индекс
    -- ашиглуулахгүй тул 4 345 таскийг бүтнээр скандаж байв; IN + UNION нь
    -- idx_tasks_assigned, idx_task_assignees_user, task_personal_list-ийн PK-г ашиглана.
    WHERE t.id IN (${myTaskIdsSql(user.sub)})
      AND p.status = 'active'
    ORDER BY p.name, b.sort_order, d.sort_order, comp.sort_order, t.sort_order
  `,
  )
    .bind(user.sub)
    .all<MyTaskRow>();

  // Хувийн checklist-ийн тоолол (migration 0177).  Мөр бүрт нэг query
  // ажиллуулбал энэ N+1 нь бүр даанагүй болно — нэг GROUP BY-аар бүх
  // таскийнхаа тоог нэг дор авч, доор map-аас нь уншина.
  //
  // ⚠️ Энэ тоо нь ЗӨВХӨН харагдац: rollup-д ОГТ ОРОХГҮЙ.  Checklist нь
  // subtask давхарга биш (0177-ийн толгойг үз) — «3/5 → 60%» гэдэг нь
  // ажилтанд санал болгох тоо, ажилтан хүлээж авбал л энгийн
  // progress_entries болж бичигдэнэ.
  const { results: checklistRows } = await c.env.DB.prepare(
    `SELECT task_id, COUNT(*) AS total, SUM(is_done) AS done
       FROM task_checklist_items
      WHERE user_id = ?
      GROUP BY task_id`,
  )
    .bind(user.sub)
    .all<{ task_id: number; total: number; done: number }>();
  const checklistByTask = new Map<number, { total: number; done: number }>();
  for (const row of checklistRows ?? []) {
    checklistByTask.set(row.task_id, { total: row.total, done: row.done ?? 0 });
  }

  // Хамтарсан ажлын хувь (migration 0322) — миний таскуудын бүх мөрийг нэг
  // асуулгаар: «энэ таск дээр би хэдэн хувь, хэдүүлээ».  ЗӨВХӨН харагдац —
  // оноо хуваах логик lib/taskShares.ts-д.
  const { results: shareRows } = await c.env.DB.prepare(
    `SELECT task_id, user_id, share_percent, is_owner
       FROM task_shares
      WHERE task_id IN (${myTaskIdsSql(user.sub)})`,
  )
    .all<{ task_id: number; user_id: number; share_percent: number; is_owner: 0 | 1 }>();
  const shareByTask = new Map<
    number,
    { my_percent: number | null; people: number; is_owner: boolean }
  >();
  for (const row of shareRows ?? []) {
    const cur = shareByTask.get(row.task_id) ?? { my_percent: null, people: 0, is_owner: false };
    cur.people += 1;
    if (row.user_id === user.sub) {
      cur.my_percent = row.share_percent;
      cur.is_owner = row.is_owner === 1;
    }
    shareByTask.set(row.task_id, cur);
  }

  // Цагаар бодогддог засварын төслийн (0339) таскийн мөрөнд ХУВЬ биш АЖИЛЛАСАН
  // ЦАГ харагдана (2026-09-24): «би N цаг · нийт M цаг» — `repair_entries.task_id`
  // (0341).  ЗӨВХӨН харагдац.  Ганц GROUP BY; зөвхөн 'hours' мөрөнд хавсарна.
  // ⚠️ try/catch: энэ endpoint бүх ажилтны өдөр тутмын хуудас — 0341 хэрэгжихээс
  // өмнө worker deploy болсон ч (task_id багана алга) жагсаалт унах ёсгүй.
  const repairHoursByTask = new Map<number, { mine: number; total: number }>();
  /** Өнөөдрийн «ажилласан» тэмдэглэгээ (0348) — мөрийн товчны төлөв ба
   *  систем хуваарилсан цаг. */
  const repairTodayByTask = new Map<number, { mark_id: number; hours: number }>();
  if (tasks.some((t) => t.project_progress_mode === 'hours')) {
    try {
      const { results: hourRows } = await c.env.DB.prepare(
        `SELECT task_id, SUM(hours) AS total,
                SUM(CASE WHEN user_id = ? THEN hours ELSE 0 END) AS mine
           FROM repair_entries
          WHERE task_id IN (${myTaskIdsSql(user.sub)})
          GROUP BY task_id`,
      )
        .bind(user.sub)
        .all<{ task_id: number; total: number; mine: number }>();
      for (const row of hourRows ?? []) {
        repairHoursByTask.set(row.task_id, {
          mine: roundHours(row.mine),
          total: roundHours(row.total),
        });
      }
    } catch (err) {
      console.error('[my-tasks] repair hours lookup failed', err);
    }
    // Тусдаа try — 0348 хэрэгжихээс өмнө (repair_marks алга) дээрх цаг хэвээр харагдана.
    try {
      const { results: markRows } = await c.env.DB.prepare(
        `SELECT m.id AS mark_id, m.task_id, COALESCE(re.hours, 0) AS hours
           FROM repair_marks m
           LEFT JOIN repair_entries re ON re.mark_id = m.id
          WHERE m.user_id = ? AND m.date = ? AND m.award_points = 1 AND m.task_id IS NOT NULL`,
      )
        .bind(user.sub, today)
        .all<{ mark_id: number; task_id: number; hours: number }>();
      for (const row of markRows ?? []) {
        repairTodayByTask.set(row.task_id, { mark_id: row.mark_id, hours: roundHours(row.hours) });
      }
    } catch (err) {
      console.error('[my-tasks] repair marks lookup failed', err);
    }
  }

  // Өнөөдрийн миний бичлэг (таск тус бүрийн СҮҮЛИЙН) ба миний албан таймерын
  // сэшнтэй таскууд (хувь оруулах эрх; `today` = өнөөдөр (УБ) ажилласан), ОДОО хэн
  // ажиллаж байна — нэг асуулга тус бүр (өмнө нь таск бүрд 2 асуулга: 150 таск =
  // 300 D1 дуудлага).
  const dayStartIso = new Date(ubDayWindow(today, orgUtcOffsetMinutes()).startMs).toISOString();
  const [todayRes, takenRes, workingRes] = await Promise.all([
    c.env.DB.prepare(
      `SELECT task_id, is_rest_day, defer_next_day FROM progress_entries
        WHERE user_id = ? AND date = ?
        ORDER BY created_at, id`,
    )
      .bind(user.sub, today)
      .all<{ task_id: number; is_rest_day: 0 | 1; defer_next_day: 0 | 1 }>(),
    c.env.DB.prepare(
      `SELECT s.task_id,
              MAX(CASE WHEN s.ended_at IS NULL OR s.ended_at >= ?2 THEN 1 ELSE 0 END) AS today
         FROM task_timer_sessions s
        WHERE s.user_id = ?1
          AND NOT EXISTS (SELECT 1 FROM task_timer_voids v WHERE v.session_id = s.id AND v.restored_at IS NULL)
        GROUP BY s.task_id`,
    )
      .bind(user.sub, dayStartIso)
      .all<{ task_id: number; today: 0 | 1 }>(),
    c.env.DB.prepare(
      `SELECT s.task_id, s.user_id, u.full_name
         FROM task_timer_sessions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.ended_at IS NULL`,
    ).all<{ task_id: number; user_id: number; full_name: string | null }>(),
  ]);
  const todayByTask = new Map<number, { is_rest_day: 0 | 1; defer_next_day: 0 | 1 }>();
  for (const r of todayRes.results ?? []) todayByTask.set(r.task_id, r); // сүүлийнх нь үлдэнэ
  const takenSet = new Set((takenRes.results ?? []).map((r) => r.task_id));
  const workedTodaySet = new Set((takenRes.results ?? []).filter((r) => r.today === 1).map((r) => r.task_id));
  const workingByTask = new Map<number, Array<{ user_id: number; full_name: string | null }>>();
  for (const w of workingRes.results ?? []) {
    const list = workingByTask.get(w.task_id) ?? [];
    list.push({ user_id: w.user_id, full_name: w.full_name });
    workingByTask.set(w.task_id, list);
  }

  // Хуваарилагдсан («managed») таскууд: миний хэсэг (T/D/L), root-ийн revision — нэг асуулга, мөр бүрд биш.
  // ⚠️ try/catch: 0376 хэрэгжихээс өмнө worker deploy болсон ч өдөр тутмын жагсаалт унах ёсгүй.
  let rootsByTask = new Map<number, ReturnType<typeof rootView>>();
  try {
    const snaps = await loadRootsForTasks(
      c.env.DB,
      tasks.map((t) => t.id),
    );
    rootsByTask = new Map([...snaps].map(([id, snap]) => [id, rootView(snap)]));
  } catch (err) {
    console.error('[my-tasks] allocation lookup failed', err);
  }

  const taskItems = tasks.map((t) => {
      const todayRow = todayByTask.get(t.id) ?? null;
      const { project_completion_questions, self_done, ...rest } = t;
      const root = rootsByTask.get(t.id) ?? null;
      return {
        ...rest,
        // Хуваарилагдсан бол: revision + миний хэсэг + root-ийн тойм (null = ердийн таск).
        allocation: root
          ? {
              revision: root.revision,
              root_done_units: root.root_done_units,
              unallocated_units: root.unallocated_units,
              unattributed_units: root.unattributed_units,
              participants: root.participants.length,
              my: root.participants.find((x) => x.user_id === user.sub) ?? null,
            }
          : null,
        // 0/1 → boolean.  Ангилал нь клиент дээр «энэ мөрд тэмдэглэх
        // товч гарах уу»-г шийднэ (зөвхөн ZA — доорх route-ыг үз).
        self_done: self_done === 1,
        completion_questions: parseCompletionQuestions(project_completion_questions),
        current_progress: Number(t.current_progress) || 0,
        // Хувь оруулах эрх — энэ таск дээр миний албан таймерын сэшн байгаа
        // (`submitProgressEntry`-ийн ижил дүрэм; admin залруулга серверт).
        can_report: takenSet.has(t.id),
        // Өнөөдөр (УБ) энэ таск дээр миний албан таймер явсан — «өнөөдрийн тайлан»
        // зөвхөн эдгээрт хүлээгдэнэ (түүхийн бусад мөр биш).
        worked_today: workedTodaySet.has(t.id),
        // ОДОО энэ таск дээр ажиллаж буй хүмүүс (би байж ч болно) — нэр л.
        working: workingByTask.get(t.id) ?? [],
        reported_today: !!todayRow,
        reported_today_rest: todayRow?.is_rest_day === 1,
        reported_today_deferred: todayRow?.defer_next_day === 1,
        checklist: checklistByTask.get(t.id) ?? { total: 0, done: 0 },
        share: shareByTask.get(t.id) ?? null,
        // Зөвхөн цагаар бодогддог төслийн мөрөнд (бусдад null) — дээрхийг үз.
        repair_hours:
          t.project_progress_mode === 'hours'
            ? (repairHoursByTask.get(t.id) ?? { mine: 0, total: 0 })
            : null,
        // Өнөөдөр «ажилласан» гэж тэмдэглэсэн эсэх + ногдсон цаг (0348).
        repair_today:
          t.project_progress_mode === 'hours' ? (repairTodayByTask.get(t.id) ?? null) : null,
      };
  });

  const allItems = taskItems;
  const totalItems = allItems.length;
  const completedItems = allItems.filter((i) => i.current_progress >= 100).length;
  // ⚠️ «Би дуусгасан» гэж тэмдэглэсэн мөр нь ХАРАГДАХГҮЙ тул тоололд
  // ч орохгүй — эс тэгвэл самбарын «N идэвхтэй» тэмдэг жагсаалтад
  // байхгүй ажлыг зөрүүтэй тоолно.
  const inProgressItems = allItems.filter(
    (i) => i.current_progress > 0 && i.current_progress < 100 && !i.self_done,
  ).length;
  const notStartedItems = allItems.filter((i) => i.current_progress === 0 && !i.self_done).length;
  const selfDoneItems = allItems.filter((i) => i.self_done && i.current_progress < 100).length;
  // How many of today's reports still need to be filed (excluding fully-completed items).
  const reportedToday = allItems.filter((i) => i.reported_today).length;
  // Цагаар бодох төслийн таск (0339) дээр өдрийн % тайлан байхгүй тул
  // «өнөөдөр илгээгээгүй» тоололд ОРОХГҮЙ.  2026-10-01-ээс жагсаалт нь ТҮҮХ
  // (ажиллаж байсан бүх таск) тул «хүлээгдэж буй» = зөвхөн ӨНӨӨДӨР ажилласан таск.
  const pendingToday = allItems.filter(
    (i) =>
      i.worked_today &&
      !i.reported_today &&
      i.current_progress < 100 &&
      !i.self_done &&
      i.project_progress_mode !== 'hours',
  ).length;

  return c.json({
    items: allItems,
    summary: {
      total: totalItems,
      completed: completedItems,
      in_progress: inProgressItems,
      not_started: notStartedItems,
      self_done: selfDoneItems,
      today: today,
      reported_today: reportedToday,
      pending_today: pendingToday,
    },
  });
});

// ───────── «Миний хийх ажил дууссан» тэмдэглэгээ (0253) ─────────
//
// ЗӨВХӨН ЗАСВАРЫН ТӨСӨЛ (`projects.category = 'ZA'`).
//
// Яагаад: засварын ажилд ажилтны хариуцсан хэсэг дуусахад таскийн НИЙТ
// хувь 100%-д хүрдэггүй (үлдсэнийг өөр хүн / өөр үе шат гүйцээнэ).
// «Миний даалгаврууд» нь `current_progress < 100` бүхнийг харуулдаг тул
// тэр мөрүүд хэзээ ч арилалгүй хуримтлагдаж, ажилтан жагсаалтаа
// цэвэрлэхийн тулд ӨӨРИЙН ХИЙГЭЭГҮЙ хувийг нэмж 100% болгох сэдэлтэй
// болж байв.  Энэ бол өгөгдөл гуйвуулах шууд шахалт — иймд «дуусгасан»
// гэж хэлэх нь тайлагналаас БҮРЭН тусдаа гарц байх ёстой.
//
// ⚠️ ЭНЭ НЬ ХУВЬ БИЧИХГҮЙ.  `progress_entries` үүсэхгүй, `user_points`
// хөдлөхгүй, ямар ч rollup `task_self_done`-ыг уншихгүй.  Төслийн явц
// хэвээрээ — зөвхөн тухайн хүний жагсаалтаас мөр нуугдана.
//
// Бусад ангилалд хаалттай: ердийн ажлын зураг дээр ажилтан өөрөө ажлаа
// хаах эрхгүй (эзний шийдвэр).  DELETE (буцаах) нь ангилал шалгахгүй —
// төслийн ангилал сүүлд өөрчлөгдвөл ч тэмдэглэгээгээ авах боломжтой
// байх ёстой, эс тэгвэл мөр үүрд нуугдана.
const SELF_DONE_CATEGORY = 'ZA';

/** Таск миний жагсаалтад байгаа эсэх — `/my-tasks` дэх WHERE-ийн ЯГ ижил олонлог
 *  (`myTaskIdsSql`: ажилласан ∪ нэмсэн − хассан). */
async function findMyTask(
  db: D1Database,
  taskId: number,
  userId: number,
): Promise<{ id: number; category: string | null } | null> {
  const row = await db
    .prepare(
      `SELECT t.id, p.category
         FROM tasks t
         JOIN components comp ON comp.id = t.component_id
         JOIN drawings d ON d.id = comp.drawing_id
         JOIN blocks b ON b.id = d.block_id
         JOIN projects p ON p.id = b.project_id
        WHERE t.id = ?
          AND t.id IN (${myTaskIdsSql(userId)})
        LIMIT 1`,
    )
    .bind(taskId)
    .first<{ id: number; category: string | null }>();
  return row ?? null;
}

const SELF_DONE_ROLES = requireRole('engineer', 'architect', 'senior', 'admin');

// POST /api/progress/my-tasks/:taskId/self-done — тэмдэглэх
progress.post('/my-tasks/:taskId/self-done', SELF_DONE_ROLES, async (c) => {
  const user = c.get('user');
  const taskId = Number(c.req.param('taskId'));
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return c.json({ error: 'Буруу таск' }, 400);
  }
  const body = await c.req.json<{ note?: string }>().catch(() => ({}) as { note?: string });
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;

  const task = await findMyTask(c.env.DB, taskId, Number(user.sub));
  if (!task) return c.json({ error: 'Таск олдсонгүй' }, 404);
  if (task.category !== SELF_DONE_CATEGORY) {
    return c.json({ error: 'Зөвхөн засварын төсөл дээр өөрийн ажлаа дууссан гэж тэмдэглэнэ' }, 403);
  }

  await c.env.DB.prepare(
    `INSERT INTO task_self_done (task_id, user_id, note) VALUES (?, ?, ?)
       ON CONFLICT(task_id, user_id) DO UPDATE SET note = excluded.note`,
  )
    .bind(taskId, user.sub, note)
    .run();

  // «Миний хэсэг дууссан» = энэ хүний хувьд таск дууссан — ӨӨРИЙН албан
  // таймерыг (0361) зогсооно; бусдын таймер хэвээр.
  try {
    await stopOfficialTimersForTask(c.env.DB, {
      taskId,
      actorId: user.sub,
      nowIso: new Date().toISOString(),
      requestId: crypto.randomUUID(),
      reason: 'auto_stop_completed',
      onlyUserId: user.sub,
    });
  } catch (err) {
    console.error('[task-timer] auto-stop on self-done failed:', err);
  }

  return c.json({ ok: true, self_done: true });
});

// DELETE /api/progress/my-tasks/:taskId/self-done — буцаах
progress.delete('/my-tasks/:taskId/self-done', SELF_DONE_ROLES, async (c) => {
  const user = c.get('user');
  const taskId = Number(c.req.param('taskId'));
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return c.json({ error: 'Буруу таск' }, 400);
  }
  await c.env.DB.prepare(`DELETE FROM task_self_done WHERE task_id = ? AND user_id = ?`)
    .bind(taskId, user.sub)
    .run();
  return c.json({ ok: true, self_done: false });
});

// ───────── «Миний ажилд нэмэх / хасах» — хувийн жагсаалт (0370, эзэн 2026-10-01) ─────────
//
// Төслийн хуудасны таскийн мөр дээрх товч.  ЗӨВХӨН надад харагдана: таск дээрх нэр нь
// хэвээр «албан таймер нь ОДОО явж буй хүн» (0368), `task_assignees`-д юу ч бичигдэхгүй.
// Нэмэх эрх = таск авч ажиллах эрх (`takeDenial` — эрх → таск → төсөл → дууссан), гэхдээ
// ИРЦ шаардахгүй (жагсаалтад нэмэх нь цаг эхлүүлэх БИШ — маргаашийн ажлаа өнөөдөр бэлдэж болно).
// Дүрэм, SQL: `lib/myTaskList.ts`.

function listTaskId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// POST /api/progress/my-tasks/:taskId/list — «Миний ажилд нэмэх»
progress.post('/my-tasks/:taskId/list', async (c) => {
  const user = c.get('user');
  const taskId = listTaskId(c.req.param('taskId'));
  if (taskId === null) return c.json({ error: 'Буруу таск' }, 400);
  const facts = await loadTaskForTake(c.env.DB, taskId, user.sub);
  const denial = takeDenial(user.role, isCeo(user.sub), {
    exists: facts.exists,
    project_active: facts.project_active,
    latest_pct: facts.latest_pct,
    self_done: facts.self_done,
    clocked_in: true,
  });
  if (denial) {
    return c.json({ error: denial, message: TAKE_DENIAL_MESSAGE[denial] }, TAKE_DENIAL_STATUS[denial]);
  }
  await addToMyList(c.env.DB, user.sub, taskId);
  return c.json({ ok: true, task_id: taskId, in_list: true });
});

// DELETE /api/progress/my-tasks/:taskId/list — «Миний ажлаас хасах» (ажиллаж байсан таскийг ч
// нууна).  Цаг нь ЯГ ОДОО энэ таск дээр явж байвал 409 — эхлээд зогсооно (эс тэгвэл явж буй
// таск «Миний ажлууд»-аас алга болж, зөвхөн толгойн тууз дээр үлдэнэ).
progress.delete('/my-tasks/:taskId/list', async (c) => {
  const user = c.get('user');
  const taskId = listTaskId(c.req.param('taskId'));
  if (taskId === null) return c.json({ error: 'Буруу таск' }, 400);
  const running = await c.env.DB.prepare(
    `SELECT 1 AS x FROM task_timer_sessions WHERE user_id = ? AND task_id = ? AND ended_at IS NULL`,
  )
    .bind(user.sub, taskId)
    .first<{ x: number }>();
  if (running) {
    return c.json(
      { error: 'TASK_RUNNING', message: 'Энэ таск дээр таны цаг явж байна — эхлээд «Зогсоох» дарна уу.' },
      409,
    );
  }
  await hideFromMyList(c.env.DB, user.sub, taskId);
  return c.json({ ok: true, task_id: taskId, in_list: false });
});

// POST /api/progress/my-tasks/:taskId/retract — «ТАСКИЙГ БУЦААХ» (эзэн 2026-10-05, 0386, `lib/taskRetract.ts`).
// Буруу таск авч буруу хувь оруулсан хүн тэр таскийг «би үүн дээр юу ч хийгээгүй» болгоно: миний хувь + оноо устаж, би таскийн
// нэр / «Миний ажлууд» / хувь нэмэрчийн жагсаалтаас алга болно.  Албан таймерын цаг УСТАХГҮЙ (системд хэмжигдсээр, дахин авбал
// нэмэгдэнэ) — харин таск дээр харагдахгүй.  Бусдын бичлэг/оноо/цаг хөндөгдөхгүй.
progress.post('/my-tasks/:taskId/retract', async (c) => {
  const user = c.get('user');
  if (!['admin', 'senior', 'engineer', 'architect'].includes(user.role)) {
    return c.json({ error: 'FORBIDDEN', message: 'Таск буцаах эрхгүй' }, 403);
  }
  const taskId = listTaskId(c.req.param('taskId'));
  if (taskId === null) return c.json({ error: 'Буруу таск' }, 400);
  const r = await retractMyTask(c.env.DB, { userId: user.sub, taskId, requestId: crypto.randomUUID() });
  if (!r.ok) return c.json({ error: r.error, message: r.message }, r.status);
  // Оноо өөрчлөгдсөн — самбарын кэш (company/leaderboard) өөрийн TTL-ээр шинэчлэгдэнэ.
  return c.json(r);
});

// GET /api/progress/my-tasks/ids?project_id= — энэ төсөл дэх миний жагсаалтын таскууд
// (төслийн хуудасны «Миний ажилд нэмэх» товчны төлөв ба «Зөвхөн миний» шүүлт).
progress.get('/my-tasks/ids', async (c) => {
  const user = c.get('user');
  const projectId = listTaskId(c.req.query('project_id'));
  if (projectId === null) return c.json({ error: 'project_id is required' }, 400);
  const taskIds = await loadMyTaskIdsForProject(c.env.DB, user.sub, projectId);
  return c.json({ task_ids: taskIds }, 200, { 'Cache-Control': 'private, no-store' });
});

// GET /api/progress/my-recent?days=N — сүүлийн N хоногт МИНИЙ өгсөн тайлан.
//
// Яагаад: «Өчигдөр би юу бичсэн бэ» гэдгийг харах гарц огт байгаагүй тул
// үргэлжлэл бичихэд хүн санахаа больдог байв.  Энэ нэг query нь хоёр
// хэрэгцээг зэрэг хаадаг:
//   • «Өмнөх тайлан» самбар — өдрөөр нь бүлэглэж харуулна;
//   • мөр бүрийн «Өчигдөр 45%» чип — клиент task_id-гаар нь group хийж,
//     ӨНӨӨДРИЙНХӨӨС өмнөх хамгийн сүүлийнхийг авна.
// Ингэснээр `/my-tasks` дээрх N+1 өсөхгүй (мөр бүрт нэмэлт query үгүй).
//
// Өнөөдрийн мөрүүд ч мөн багтана — «би өнөөдөр юу илгээсэн бэ»-г нэг
// дор харуулах нь ашигтай; клиент огноогоор нь ялгана.
progress.get('/my-recent', async (c) => {
  const user = c.get('user');
  const raw = parseInt(c.req.query('days') ?? '7', 10);
  const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 30) : 7;
  const today = todayInUB();
  const from = addDays(today, -(days - 1));

  const { results } = await c.env.DB.prepare(
    `
    SELECT pe.id, pe.task_id, pe.percentage, pe.date, pe.notes, pe.status,
           pe.review_note, pe.image_url, pe.attachments, pe.is_rest_day,
           pe.defer_next_day, pe.created_at, pe.reviewed_by,
           t.name AS task_name,
           p.id   AS project_id,
           p.name AS project_name,
           reviewer.full_name AS reviewer_name
    FROM progress_entries pe
    INNER JOIN tasks t       ON t.id = pe.task_id
    INNER JOIN components co ON co.id = t.component_id
    INNER JOIN drawings d    ON d.id = co.drawing_id
    INNER JOIN blocks b      ON b.id = d.block_id
    INNER JOIN projects p    ON p.id = b.project_id
    LEFT JOIN users reviewer ON reviewer.id = pe.reviewed_by
    WHERE pe.user_id = ? AND pe.date >= ? AND pe.date <= ?
    ORDER BY pe.date DESC, pe.created_at DESC
  `,
  )
    .bind(user.sub, from, today)
    .all<{
      id: number;
      task_id: number;
      percentage: number;
      date: string;
      notes: string | null;
      status: string;
      review_note: string | null;
      image_url: string | null;
      attachments: string | null;
      is_rest_day: 0 | 1;
      defer_next_day: 0 | 1;
      created_at: string;
      reviewed_by: number | null;
      task_name: string;
      project_id: number;
      project_name: string;
      reviewer_name: string | null;
    }>();

  // `attachments`-ыг энд задалж өгнө — клиент дахин JSON.parse хийхгүй.
  // Хуучин мөрүүд зөвхөн `image_url`-тэй тул түүнийг нэг элементтэй
  // хавсралт болгож нэгтгэнэ (UI нэг л зам мэднэ).
  const entries = (results ?? []).map((r) => {
    const attachments = parseAttachments(r.attachments);
    if (attachments.length === 0 && r.image_url) {
      attachments.push({ url: r.image_url, name: 'зураг', type: 'image/*' });
    }
    return {
      id: r.id,
      task_id: r.task_id,
      task_name: r.task_name,
      project_id: r.project_id,
      project_name: r.project_name,
      percentage: r.percentage,
      date: r.date,
      notes: r.notes,
      status: r.status,
      review_note: r.review_note,
      attachments,
      is_rest_day: r.is_rest_day === 1,
      defer_next_day: r.defer_next_day === 1,
      created_at: r.created_at,
      reviewer_name:
        r.reviewed_by != null && r.reviewer_name && r.reviewed_by !== user.sub
          ? r.reviewer_name
          : null,
    };
  });

  return c.json({ entries, from, to: today, today, days });
});

// GET /api/progress/my — my progress entries (all statuses)
progress.get('/my', async (c) => {
  const user = c.get('user');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const { results } = await c.env.DB.prepare(
    `
    SELECT pe.*,
      t.name AS task_name
    FROM progress_entries pe
    LEFT JOIN tasks t ON t.id = pe.task_id
    WHERE pe.user_id = ?
    ORDER BY pe.date DESC, pe.created_at DESC
    LIMIT ?
  `,
  )
    .bind(user.sub, limit)
    .all<ProgressWithName>();

  return c.json({ entries: results });
});

// POST /api/progress/task/:taskId/regenerate-summary — re-run the AI
// completion summary for a task. Useful if the model failed the first time
// or the answers were updated. Senior + admin only.
progress.post('/task/:taskId/regenerate-summary', requireRole('senior', 'admin'), async (c) => {
  const taskId = parseInt(c.req.param('taskId'), 10);
  if (!Number.isFinite(taskId)) return c.json({ error: 'invalid task id' }, 400);
  await summarizeTaskCompletion({ db: c.env.DB, ai: c.env.AI, taskId });
  const row = await c.env.DB.prepare(
    `SELECT ai_completion_summary, ai_completion_summary_at FROM tasks WHERE id = ?`,
  )
    .bind(taskId)
    .first<{ ai_completion_summary: string | null; ai_completion_summary_at: string | null }>();
  return c.json({
    ai_completion_summary: row?.ai_completion_summary ?? null,
    ai_completion_summary_at: row?.ai_completion_summary_at ?? null,
  });
});

// GET /api/progress/task/:taskId — progress history for a task
progress.get('/task/:taskId', async (c) => {
  const taskId = parseInt(c.req.param('taskId'), 10);

  const { results } = await c.env.DB.prepare(
    `
    SELECT pe.*, u.full_name AS user_name
    FROM progress_entries pe
    INNER JOIN users u ON u.id = pe.user_id
    WHERE pe.task_id = ?
    ORDER BY pe.date DESC, pe.created_at DESC
  `,
  )
    .bind(taskId)
    .all<ProgressWithName>();

  return c.json({ entries: results });
});

// POST /api/progress/consolidate/:projectId — admin daily consolidation
progress.post('/consolidate/:projectId', requireAdmin(), async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);
  const { date } = await c.req.json<{ date: string }>();
  const user = c.get('user');

  if (!date) return c.json({ error: 'date is required' }, 400);

  // One round-trip rolls up every block in the project.  Previously we
  // ran `calcBlockProgress` once per block in a JS loop, which scaled
  // O(blocks) D1 round-trips and dominated the consolidate latency on
  // projects with many blocks.  The CTE below is the same per-task →
  // drawing → block aggregation, just batched.
  const { results: blockRows } = await c.env.DB.prepare(
    `
    WITH
    latest_task AS (
      -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
      SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
      FROM tasks t
    ),
    -- Зарласан төсвөөр: зураг нь d.weight_percent-ээр, блок нь 100-аар
    -- (PROJECT_LIST_SQL болон calcProjectProgress-тэй ижил).  Дутуу жин нь
    -- хийгдээгүй ажил гэж тоологдоно.
    draw_prog AS (
      SELECT d.id, d.block_id, d.weight_percent,
             COALESCE(
               SUM(t.weight_percent * COALESCE(lt.percentage, 0))
                 / NULLIF(d.weight_percent, 0),
               0
             ) AS progress
      FROM drawings d
      LEFT JOIN components c ON c.drawing_id = d.id
      LEFT JOIN tasks t      ON t.component_id = c.id
      LEFT JOIN latest_task lt ON lt.task_id = t.id
      WHERE d.block_id IN (SELECT id FROM blocks WHERE project_id = ?)
      GROUP BY d.id, d.block_id, d.weight_percent
    )
    SELECT b.id, b.name, b.team_id, b.weight_percent,
           COALESCE(pts.share_percent, 0) AS team_share,
           COALESCE(SUM(dp.weight_percent * dp.progress), 0) / 100.0 AS progress
    FROM blocks b
    LEFT JOIN draw_prog dp ON dp.block_id = b.id
    LEFT JOIN project_team_shares pts
      ON pts.project_id = b.project_id AND pts.team_id = b.team_id
    WHERE b.project_id = ?
    GROUP BY b.id, b.name, b.team_id, b.weight_percent, pts.share_percent
    ORDER BY b.sort_order
  `,
  )
    .bind(projectId, projectId)
    .all<{
      id: number;
      name: string;
      team_id: number | null;
      weight_percent: number;
      team_share: number;
      progress: number;
    }>();

  // Total = Σ_block (b.w × b.p / 100) × (share / 100) — зарласан төсвөөр,
  // `calcProjectProgress`-тэй яг ижил.  Blocks with no team_id (or a team that
  // has no share row) contribute zero — they're surfaced under the "Бусад"
  // pseudo-tab and only count once an admin retags them.
  const blockData: Array<{ name: string; weight: number; progress: number }> = [];
  let totalProgress = 0;
  for (const b of blockRows) {
    blockData.push({ name: b.name, weight: b.weight_percent, progress: b.progress });
    if (b.team_id === null || b.team_share <= 0) continue;
    const w = Math.max(0, b.weight_percent);
    totalProgress += ((w * b.progress) / 100) * (b.team_share / 100);
  }

  await c.env.DB.prepare(
    `
    INSERT INTO daily_summaries (project_id, date, total_progress, block_data, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id, date) DO UPDATE SET
      total_progress = excluded.total_progress,
      block_data = excluded.block_data,
      created_by = excluded.created_by
  `,
  )
    .bind(
      projectId,
      date,
      Math.round(totalProgress * 100) / 100,
      JSON.stringify(blockData),
      user.sub,
    )
    .run();

  return c.json({ message: 'Consolidated', total_progress: totalProgress, blocks: blockData });
});

// GET /api/progress/history/:projectId — daily summaries over time
progress.get('/history/:projectId', async (c) => {
  const projectId = parseInt(c.req.param('projectId'), 10);

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM daily_summaries WHERE project_id = ? ORDER BY date ASC',
  )
    .bind(projectId)
    .all<{ date: string; total_progress: number; block_data: string | null }>();

  const parsed = results.map((r) => ({
    date: r.date,
    total_progress: r.total_progress,
    blocks: r.block_data
      ? (JSON.parse(r.block_data) as Array<{ name: string; weight: number; progress: number }>)
      : [],
  }));

  return c.json({ history: parsed });
});

// (`calcBlockProgress` was removed when `consolidate` was rewritten to
// roll up every block in a single CTE.  The project-level helper below
// is the only remaining aggregator and is shared with the leaderboard
// award pipeline.)

/**
 * Project-level progress %.  Rolls up every block weighted by its
 * `blocks.weight_percent` ("% within its team") and its team's
 * `project_team_shares.share_percent` ("% within the project"), so the
 * formula is Σ (team_share/100 × block_w/100 × block_progress). Used by
 * the leaderboard award pipeline to take a snapshot before/after each
 * save and reward eligible assignees proportional to the delta.
 */
export async function calcProjectProgress(db: D1Database, projectId: number): Promise<number> {
  const row = await db
    .prepare(
      `
    WITH
    latest_task AS (
      -- 2026-09-11: таск бүрд НЭГ индексийн мөр (lib/progressLatest.ts). Тиебрейк хэвээр.
      SELECT t.id AS task_id, ${latestApprovedPctByCreatedAt('t.id')} AS percentage
      FROM tasks t
    ),
    draw_prog AS (
      SELECT d.id, d.block_id, d.weight_percent,
             CASE
               WHEN d.weight_percent > 0
               THEN COALESCE(SUM(t.weight_percent * COALESCE(lt.percentage, 0) / 100.0), 0) * 100.0 / d.weight_percent
               ELSE 0
             END AS progress
      FROM drawings d
      LEFT JOIN components c ON c.drawing_id = d.id
      LEFT JOIN tasks t      ON t.component_id = c.id
      LEFT JOIN latest_task lt ON lt.task_id = t.id
      WHERE d.block_id IN (SELECT id FROM blocks WHERE project_id = ?)
      GROUP BY d.id, d.block_id, d.weight_percent
    ),
    block_prog AS (
      SELECT b.id, b.team_id, b.weight_percent,
             COALESCE(SUM(dp.weight_percent * dp.progress / 100.0), 0) AS progress
      FROM blocks b
      LEFT JOIN draw_prog dp ON dp.block_id = b.id
      WHERE b.project_id = ?
      GROUP BY b.id, b.team_id, b.weight_percent
    )
    SELECT COALESCE(SUM(
      bp.weight_percent * bp.progress / 100.0
        * COALESCE(pts.share_percent, 0) / 100.0
    ), 0) AS progress
    FROM block_prog bp
    LEFT JOIN project_team_shares pts
      ON pts.project_id = ? AND pts.team_id = bp.team_id
  `,
    )
    .bind(projectId, projectId, projectId)
    .first<{ progress: number }>();
  return row?.progress ?? 0;
}

// ─────────────────────────────────────────────────────────────────────
//  Leaderboard recalculation (recalc-on-edit)
// ─────────────────────────────────────────────────────────────────────
//  `user_points` is normally an append-only ledger written once at award
//  time (see `awardPointsForEntry`), baking in the project's complexity
//  and the weight structure that existed at that moment.  When an admin
//  later changes the project complexity or any structural weight
//  (block/drawing/task `weight_percent`, or `project_team_shares`), the
//  historic rows go stale and the leaderboard locks onto outdated values.
//
//  `recalculateProjectPoints` rebuilds the entire ledger for one project
//  from scratch under the CURRENT weights + complexity by replaying every
//  approved progress entry in chronological order — exactly mirroring how
//  `awardPointsForEntry` credited each entry live.  The original
//  `awarded_at` (entry `created_at`) is preserved so the rolling-window
//  leaderboard keeps placing each award in the right time bucket.
//
//  Crediting model: normal (self-reported) entries credit the submitter
//  (`user_id`); baseline (admin-imported) entries credit `credit_user_id`
//  (0368 — the task's assignee FROZEN at the 2026-10-01 reset, falling back to
//  `tasks.assigned_to` for rows written before it), since the importing
//  admin/senior didn't do the work.  `assignee_count = 1` either way (no
//  split).  A baseline nobody holds writes no row.  Exception: a task with
//  `task_shares` rows (0322) splits every entry by share_percent — the
//  same rule `awardPointsForEntry` applies live.
//
//  2026-10-01 (эзэн): (1) ХАМГИЙН ӨНДӨР ХУВЬ — `awardPointsForEntry`-тэй ЯГ
//  ижил `hwmFraction`: таск урьд хүрч байсан хамгийн өндөр хувиас ДЭЭШ гарсан
//  хэсэг л оноо авна.  (2) `source = 'split'` бичлэг (хуваахад «хийгдсэн хэсэг»
//  100%) нь тухайн таскийн ӨМНӨХ хувь нэмэрчдэд хувь тэнцүүлэн хуваагдана —
//  эх таскийн жин `W·p/100` болсон тул хүн бүрийн хуучин оноо ЯГ сэргэнэ.

interface ProjectWeightStructure {
  blocks: Array<{ id: number; team_id: number | null; weight: number }>;
  drawingsByBlock: Map<number, Array<{ id: number; weight: number }>>;
  tasksByDrawing: Map<number, Array<{ id: number; weight: number }>>;
  shareByTeam: Map<number, number>;
}

/**
 * In-memory twin of the `calcProjectProgress` SQL.  Given the current
 * weight structure and a map of taskId → latest approved percentage,
 * returns the project's overall progress %.  Must stay byte-for-byte
 * consistent with `calcProjectProgress` (note: component weights are NOT
 * used — task weights are summed straight under the drawing and divided
 * by the drawing's own `weight_percent`).
 */
function computeProgressFromMap(
  structure: ProjectWeightStructure,
  taskPct: Map<number, number>,
): number {
  let projectProgress = 0;
  for (const block of structure.blocks) {
    const share = block.team_id === null ? 0 : (structure.shareByTeam.get(block.team_id) ?? 0);
    if (share <= 0 || block.weight <= 0) continue;

    const drawings = structure.drawingsByBlock.get(block.id) ?? [];
    let blockProgress = 0;
    for (const drawing of drawings) {
      if (drawing.weight <= 0) continue;
      const tasks = structure.tasksByDrawing.get(drawing.id) ?? [];
      let weightedTaskSum = 0;
      for (const task of tasks) {
        weightedTaskSum += (task.weight * (taskPct.get(task.id) ?? 0)) / 100;
      }
      const drawProgress = (weightedTaskSum * 100) / drawing.weight;
      blockProgress += (drawing.weight * drawProgress) / 100;
    }
    projectProgress += ((block.weight * blockProgress) / 100) * (share / 100);
  }
  return projectProgress;
}

/**
 * Rebuild `user_points` for one project from current weights + complexity.
 * Safe to call after any complexity / weight / team-share edit.  Throws on
 * DB error — callers should wrap in try/catch so a leaderboard hiccup never
 * rolls back the (already-successful) edit.
 */
export async function recalculateProjectPoints(
  db: D1Database,
  projectId: number,
): Promise<void> {
  await recalculateLegacyProjectPoints(db, projectId);
  // Хуваарилагдсан (managed) таскийн оноо хуучин replay-д ХӨНДӨГДДӨГГҮЙ (журнал) — тэдгээрийг ЖУРНАЛААС одоогийн жин,
  // төвөгшилтэй тулгана (lib/taskCreditReweight.ts).  Managed таск байхгүй төсөлд ганц хөнгөн асуулга.  Алдаа нь
  // (аль хэдийн амжилттай болсон) жин засварыг унагахгүй — аудитор «credit drift» гэж харуулна, админ дахин ажиллуулна.
  // Унавал `task_credit_reconcile_queue`-д үлдэж cron дахин оролдоно (lib/taskCreditReconcileQueue.ts).
  await reconcileCreditOrEnqueue(db, 'project', projectId);
}

async function recalculateLegacyProjectPoints(db: D1Database, projectId: number): Promise<void> {
  const project = await db
    .prepare(`SELECT complexity_pct FROM projects WHERE id = ?`)
    .bind(projectId)
    .first<{ complexity_pct: number | null }>();
  if (!project) return;

  // Free per-project weight (0-100). Falls back to the legacy mid weight
  // for any row that somehow predates the 0093 backfill.
  const complexityPct = Math.max(0, project.complexity_pct ?? COMPLEXITY_PERCENT.mid);

  // complexityPct of 0 means no points are ever earned — clear the ledger.
  // Only the progress-sourced rows: засвар-sourced rows (source='repair') are
  // earned independently of project progress, so they must survive recalcs.
  if (complexityPct <= 0) {
    await db
      .prepare(
        `DELETE FROM user_points WHERE project_id = ? AND source = 'progress'
            AND (task_id IS NULL OR (task_id NOT IN (SELECT task_id FROM task_roots)
                                     AND task_id NOT IN (SELECT task_id FROM task_conversion_members)))`,
      )
      .bind(projectId)
      .run();
    return;
  }

  // ---- Load the current weight structure in a handful of queries. ----
  const [blocksRes, drawingsRes, tasksRes, sharesRes] = await Promise.all([
    db
      .prepare(`SELECT id, team_id, weight_percent FROM blocks WHERE project_id = ?`)
      .bind(projectId)
      .all<{ id: number; team_id: number | null; weight_percent: number }>(),
    db
      .prepare(
        `SELECT d.id, d.block_id, d.weight_percent
         FROM drawings d
         WHERE d.block_id IN (SELECT id FROM blocks WHERE project_id = ?)`,
      )
      .bind(projectId)
      .all<{ id: number; block_id: number; weight_percent: number }>(),
    db
      .prepare(
        `SELECT t.id, d.id AS drawing_id, t.weight_percent
         FROM tasks t
         JOIN components c ON c.id = t.component_id
         JOIN drawings d   ON d.id = c.drawing_id
         WHERE d.block_id IN (SELECT id FROM blocks WHERE project_id = ?)`,
      )
      .bind(projectId)
      .all<{ id: number; drawing_id: number; weight_percent: number }>(),
    db
      .prepare(`SELECT team_id, share_percent FROM project_team_shares WHERE project_id = ?`)
      .bind(projectId)
      .all<{ team_id: number; share_percent: number }>(),
  ]);

  const structure: ProjectWeightStructure = {
    blocks: (blocksRes.results ?? []).map((b) => ({
      id: b.id,
      team_id: b.team_id,
      weight: b.weight_percent ?? 0,
    })),
    drawingsByBlock: new Map(),
    tasksByDrawing: new Map(),
    shareByTeam: new Map(),
  };
  for (const d of drawingsRes.results ?? []) {
    const list = structure.drawingsByBlock.get(d.block_id) ?? [];
    list.push({ id: d.id, weight: d.weight_percent ?? 0 });
    structure.drawingsByBlock.set(d.block_id, list);
  }
  for (const t of tasksRes.results ?? []) {
    const list = structure.tasksByDrawing.get(t.drawing_id) ?? [];
    list.push({ id: t.id, weight: t.weight_percent ?? 0 });
    structure.tasksByDrawing.set(t.drawing_id, list);
  }
  for (const s of sharesRes.results ?? []) {
    structure.shareByTeam.set(s.team_id, s.share_percent ?? 0);
  }

  // Хамтарсан ажлын хуваарилалт — төслийн бүх таскийнхыг нэг асуулгаар.
  const sharesByTask = await loadProjectTaskShares(db, projectId);

  // Хуваарилагдсан («managed») таскийн оноо ЖУРНАЛААС (task_contributions) гарна — хуучин replay тэднийг
  // ХӨНДӨХГҮЙ (оноо, буцаалт, seed-ийн лавлагаа хэвээр).  Гэхдээ явц нь ерөнхий rollup-д орно (taskPct).
  const managedTasks = new Set<number>(
    (
      await db
        .prepare(
          `SELECT r.task_id FROM task_roots r
             JOIN tasks t ON t.id = r.task_id
             JOIN components c ON c.id = t.component_id
             JOIN drawings d ON d.id = c.drawing_id
             JOIN blocks b ON b.id = d.block_id
            WHERE b.project_id = ?1
            UNION
           SELECT m.task_id FROM task_conversion_members m
             JOIN tasks t ON t.id = m.task_id
             JOIN components c ON c.id = t.component_id
             JOIN drawings d ON d.id = c.drawing_id
             JOIN blocks b ON b.id = d.block_id
            WHERE b.project_id = ?1`,
        )
        .bind(projectId)
        .all<{ task_id: number }>()
    ).results?.map((r) => r.task_id) ?? [],
  );

  // ---- Replay approved entries chronologically. ----
  const entriesRes = await db
    .prepare(
      `SELECT pe.id, pe.task_id, pe.user_id, pe.percentage, pe.created_at,
              pe.is_baseline, pe.source, pe.credit_user_id, t.assigned_to
       FROM progress_entries pe
       JOIN tasks t      ON t.id = pe.task_id
       JOIN components c ON c.id = t.component_id
       JOIN drawings d   ON d.id = c.drawing_id
       JOIN blocks b     ON b.id = d.block_id
       WHERE b.project_id = ?
         AND pe.task_id IS NOT NULL
         AND pe.status = 'approved'
       ORDER BY pe.created_at ASC, pe.id ASC`,
    )
    .bind(projectId)
    .all<{
      id: number;
      task_id: number;
      user_id: number;
      percentage: number;
      created_at: string;
      is_baseline: number;
      source: string | null;
      credit_user_id: number | null;
      assigned_to: number | null;
    }>();

  const taskPct = new Map<number, number>();
  /** Таск тус бүрийн урьд хүрсэн хамгийн өндөр хувь (`hwmFraction`). */
  const taskHwm = new Map<number, number>();
  /** Таск тус бүрийн хувь нэмэрч → олгосон Δ% (`source='split'`-ийг хуваахад). */
  const contribByTask = new Map<number, Map<number, number>>();
  const inserts: D1PreparedStatement[] = [];
  const insertStmt = db.prepare(
    `INSERT INTO user_points
       (user_id, project_id, task_id, progress_entry_id,
        amount, delta_pct, assignee_count, awarded_by, awarded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const entry of entriesRes.results ?? []) {
    const prevTaskPct = taskPct.get(entry.task_id) ?? 0;
    const hwmBefore = taskHwm.get(entry.task_id) ?? 0;
    const oldPct = computeProgressFromMap(structure, taskPct);
    taskPct.set(entry.task_id, entry.percentage);
    const newPct = computeProgressFromMap(structure, taskPct);
    taskHwm.set(entry.task_id, Math.max(hwmBefore, entry.percentage));
    if (managedTasks.has(entry.task_id)) continue;
    const deltaPct =
      Math.max(0, newPct - oldPct) * hwmFraction(prevTaskPct, entry.percentage, hwmBefore);
    if (deltaPct <= 0.0001) continue;

    // Хуваалтын «хийгдсэн хэсэг 100%» — өмнөх хувь нэмэрчдэд хувь тэнцүүлэн.
    if (entry.source === 'split') {
      const dist = distributeByContribution(deltaPct, contribByTask.get(entry.task_id) ?? new Map());
      for (const d of dist) {
        inserts.push(
          insertStmt.bind(
            d.user_id,
            projectId,
            entry.task_id,
            entry.id,
            complexityPct * (d.amount / 100),
            d.amount,
            dist.length,
            d.user_id,
            entry.created_at,
          ),
        );
      }
      continue;
    }

    // Baseline entries are entered by an admin/senior on the worker's
    // behalf, so credit the worker frozen in `credit_user_id` (0368) — not
    // the importer.  Normal entries are self-reported, so the submitter IS
    // the worker.  A baseline nobody holds has nobody to credit: its
    // progress still counts toward the roll-up (taskPct was set above) but
    // no user_points row is written.
    const creditedUser = entry.is_baseline
      ? (entry.credit_user_id ?? entry.assigned_to)
      : entry.user_id;
    const split = creditSplit(sharesByTask.get(entry.task_id) ?? [], creditedUser);
    if (split.length === 0) continue;

    const share = complexityPct * (deltaPct / 100);
    const contrib = contribByTask.get(entry.task_id) ?? new Map<number, number>();
    contribByTask.set(entry.task_id, contrib);
    for (const s of split) {
      contrib.set(s.user_id, (contrib.get(s.user_id) ?? 0) + deltaPct * s.fraction);
      inserts.push(
        insertStmt.bind(
          s.user_id,
          projectId,
          entry.task_id,
          entry.id,
          share * s.fraction,
          deltaPct * s.fraction,
          split.length,
          creditedUser,
          entry.created_at,
        ),
      );
    }
  }

  // ---- Swap the ledger: delete the old rows, write the rebuilt ones. ----
  // Scope the delete to progress-sourced rows so засвар-sourced points
  // (source='repair', earned outside project progress) are never wiped.
  const ops: D1PreparedStatement[] = [
    db
      .prepare(
        `DELETE FROM user_points WHERE project_id = ? AND source = 'progress'
            AND (task_id IS NULL OR (task_id NOT IN (SELECT task_id FROM task_roots)
                                     AND task_id NOT IN (SELECT task_id FROM task_conversion_members)))`,
      )
      .bind(projectId),
    ...inserts,
  ];
  await db.batch(ops);
}

/**
 * Төслийн хувь 100 хүрвэл АВТОМАТААР архивлана.  `auto_archived_at` (0378) нь «хувь дүүрч өөрөө хаагдсан»
 * гэдгийг батлах тэмдэг — залруулгаар хувь буурахад ЗӨВХӨН ийм төслийг дахин нээнэ; гараар архивлагдсан
 * (`auto_archived_at IS NULL`) төслийг хэзээ ч нээхгүй.  Вэб, /bulk, Revit ба хуваарилагдсан таскийн
 * (`lib/taskRootOps.ts`) бүх зам энэ ганц функцээр.
 */
export async function archiveProjectIfComplete(db: D1Database, projectId: number): Promise<boolean> {
  const pct = await calcProjectProgress(db, projectId);
  if (pct < 99.999) return false;

  const result = await db
    .prepare(
      `
    UPDATE projects
    SET status = 'archived',
        auto_archived_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
      AND status != 'archived'
  `,
    )
    .bind(projectId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

export default progress;
