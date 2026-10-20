/**
 * АЛБАН ЁСНЫ ТАСКИЙН ЦАГ ХЭМЖИГЧ — D1 уншилт/бичилт (migration 0361, 0368).
 * Дүрэм, тооцоо: `taskTimer.ts`, `taskTake.ts` (цэвэр).  Тест:
 * `routes/taskTimer.test.ts`, `routes/taskTake.test.ts` (бодит SQLite + бодит миграц).
 *
 * ⚠️ АТОМ ЧАНАР.  Эхлүүлэх / сэлгэх / зогсоох бүр НЭГ `db.batch()` — D1 нь batch-ийг
 *    нэг транзакцаар, бусад бичилттэй ДАРААЛУУЛЖ ажиллуулдаг.  Хоёр таб, хоёр
 *    компьютер, давхар даралт зэрэг ирсэн хүсэлт тус бүр бүтэн batch-аар
 *    солигдоно; дунд нь өөр хүсэлт орохгүй.  Дээрээс нь 0361-ийн
 *    `ux_tts_one_running` (user_id WHERE ended_at IS NULL) нь «нэг хүнд нэгээс
 *    олон явж буй мөр» гэдгийг DB түвшинд боломжгүй болгоно.
 *
 * 2026-10-01 (эзэн): таск дээрх НЭР = энэ таймер нь тэр таск дээр ОДОО явж буй
 * хүн.  ХУВААГДАХ таск (`isSplittableTask`) дээр НЭГ хүн — өөр хүн явж байхад
 * эхлүүлэх оролдлого юу ч бичихгүй (өөрийн өмнөх таскаа ч зогсоохгүй) бөгөөд
 * дуудагч TASK_OCCUPIED болгоно.  Энэ хориг нь INSERT-ийн WHERE дотор тул зэрэг
 * ирсэн хоёр «Өөртөө авах»-ын ЯГ НЭГ нь л ялна.  Эхэлсэн сэшн бүр
 * `task_assignees`-д (одоо = «энэ таск дээр ажиллаж байсан хүмүүс»-ийн бүртгэл)
 * мөр үлдээнэ — «Миний ажлууд»-ын түүх, багийн хуудас, график түүнээс уншина.
 *
 * Batch дотор мөрүүдийг `request_id`-аар (сервер үүсгэсэн UUID) холбоно:
 * зогссон мөрийн `end_request_id` = эхэлсэн мөрийн `start_request_id` = үйл
 * явдлын `request_id`.  Зогссон мөрийг `user_id = ? AND ended_at >= :now AND
 * end_request_id = ?` гэж хайна — `ended_at = MAX(started_at, :now) ≥ :now`
 * үргэлж үнэн тул `idx_tts_user_ended`-ээр бүтэн скангүй олдоно (D1 rows_read).
 * Өнгөрсөн агшинд хаах (ирцийн «Гарах», 23:59) нь `user_id + end_request_id`-аар.
 */
import { latestApprovedPctByCreatedAt } from './progressLatest';
import {
  clippedMs,
  officialMsSql,
  startOutcome,
  summarizeRange,
  summarizeWindow,
  ubDateOf,
  ubDayWindow,
  ubRangeWindow,
  dayEndCutoffIso,
  SYSTEM_ACTOR_ID,
  type OfficialLunch,
  type OfficialTimerEndNote,
  type OfficialTimerEndReason,
  type OfficialTimerRangeSummary,
  type OfficialTimerSessionLite,
  type OfficialTimerStartOutcome,
  type TimeWindow,
} from './taskTimer';
import { isSplittableTask } from './taskTake';

/** `CLOSE_SET`-ийн ЯГ ижил, гэхдээ `?1` биш дурын bind тэмдэгтээр (`ParamBag`-ийн `?N`) — marker-тэй
 *  batch-д (`taskRootOps.ts`) хэрэглэнэ.  Хоёр хувилбар нэг дүрэм: өөрчилбөл хоёуланг. */
export function closeSetSql(nowTok: string): string {
  return `
  ended_at    = MAX(started_at, ${nowTok}),
  duration_ms = MAX(0, CAST(ROUND((julianday(MAX(started_at, ${nowTok})) - julianday(started_at)) * 86400000.0) AS INTEGER)),
  updated_at  = ${nowTok}`;
}

/**
 * Хүчингүй болгосон (`task_timer_voids`, 0379) сэшнийг ТООЦООНООС хасах нөхцөл.  Сэшн УСТАХГҮЙ, бодит
 * `started_at`/`ended_at` хөндөгдөхгүй — зөвхөн албан цагийн БҮХ уншигч энэ нөхцлөөр хасна.  Уншигч шинээр
 * нэмэхдээ ЗААВАЛ ашигла (хасахгүй бол хүчингүй болгосон цаг нийлбэрт орсоор байна).
 */
export const notVoidSql = (alias: string): string =>
  `NOT EXISTS (SELECT 1 FROM task_timer_voids v WHERE v.session_id = ${alias}.id AND v.restored_at IS NULL)`;

/**
 * «Таскийг буцаах» (0386, `lib/taskRetract.ts`) — таск талын харагдацаас (хувь нэмэрчийн цаг, таскийн нийт цаг) тухайн хүний
 * буцаасан агшнаас ӨМНӨ эхэлсэн сэшнийг хасна.  Сэшн УСТАХГҮЙ, админы албан цагийн тайлан (`live`, `days`, `report`) тоолсоор —
 * зөвхөн таск дээрх харагдац л нуугдана.  ⚠️ `lib/taskContributors.ts` `NOT_RETRACTED`-тэй ИЖИЛ.
 */
export const notRetractedSql = (alias: string): string =>
  `NOT EXISTS (SELECT 1 FROM task_retractions r
                WHERE r.task_id = ${alias}.task_id AND r.user_id = ${alias}.user_id AND r.retracted_at >= ${alias}.started_at)`;

/** SQL: `started_at`-аас `:now` хүртэлх мс (сөрөг бол 0).  ?1 = now.
 *  ⚠️ `duration_ms` = ТҮҮХИЙ үргэлжлэл (аудит).  Албан цаг нь цайны цагийг хасдаг
 *  (2026-10-01) тул уншихдаа `officialMsSql` / `countedMs` — `SUM(duration_ms)` БИШ. */
const CLOSE_SET = `
  ended_at    = MAX(started_at, ?1),
  duration_ms = MAX(0, CAST(ROUND((julianday(MAX(started_at, ?1)) - julianday(started_at)) * 86400000.0) AS INTEGER)),
  updated_at  = ?1`;

/** Өнгөрсөн агшинд хаах (ирцийн «Гарах», 23:59): `?1` = зогсох агшин, `?7` = бичсэн агшин. */
const CLOSE_AT_SET = `
  ended_at    = MAX(started_at, ?1),
  duration_ms = MAX(0, CAST(ROUND((julianday(MAX(started_at, ?1)) - julianday(started_at)) * 86400000.0) AS INTEGER)),
  updated_at  = ?7`;

/* ------------------------------------------------------------------ */
/*  «Өөртөө авах»-ын баримт                                            */
/* ------------------------------------------------------------------ */

export interface TaskWorker {
  user_id: number;
  full_name: string | null;
}

export interface TaskForTake {
  exists: boolean;
  task_id: number;
  task_name: string | null;
  project_id: number | null;
  project_active: boolean;
  progress_mode: string | null;
  weight_percent: number;
  latest_pct: number;
  /** Энэ хүн «миний хэсэг дууссан» гэж тэмдэглэсэн (0253). */
  self_done: boolean;
  /** Хуваагдах таск — нэг удаад нэг хүн (`isSplittableTask`). */
  splittable: boolean;
  /** ОДОО энэ таск дээр таймер нь явж буй БУСАД хүмүүс. */
  others: TaskWorker[];
  /** Дуудагч өөрөө энэ таск дээр ажиллаж байна. */
  mine: boolean;
  /** «Өөр хүн аль хэдийн хувь оруулсан, би энэ таск дээр хараахан ажиллаагүй» (эзэн 2026-10-06): өөр хүний батлагдсан
   *  явцын бичлэг > 0 БАЙНА, харин миний өөрийн явц/цаг (буцаасныг хасаад) БАЙХГҮЙ.  Хуваарилалт идэвхтэй үед авах нь
   *  хуваах цонх гаргана (`takeTask`). */
  foreign_progress: boolean;
  /** Хуваарилагдсан («managed», 0376) үндсэн ажил — хуучин «нэг хүн» (exclusive) дүрэм хамаарахгүй. */
  managed: boolean;
  /** Managed бол: миний ирээдүйн ажил (T − D, нэгжээр), хийсэн, буцаасан, чөлөөт ажил. */
  alloc: {
    my_future_units: number;
    my_done_units: number;
    my_released_units: number;
    unallocated_units: number;
    has_row: boolean;
  } | null;
}

/**
 * «Өөр хүн аль хэдийн хувь оруулсан, би энэ таск дээр хараахан ажиллаагүй» (`TaskForTake.foreign_progress`).
 * Өөр хүний батлагдсан явц > 0 байна (системийн split/alloc бичлэг биш), харин миний өөрийн явц ба (void/«буцаах»-аар
 * хасаагүй) албан таймерын сэшн БАЙХГҮЙ.  `task_retractions` (0386) хараахан үүсээгүй орчинд буцаасан сэшнийг хасахгүй,
 * унших боломжгүй бол `false` — энэ нь «авах»-ыг ХЭЗЭЭ Ч унагаахгүй (зөвхөн хуваах цонх гарахгүй).
 */
async function hasForeignProgress(db: D1Database, taskId: number, userId: number): Promise<boolean> {
  const sql = (retracted: string) =>
    `SELECT (EXISTS (SELECT 1 FROM progress_entries pe
                      WHERE pe.task_id = ?1 AND pe.user_id <> ?2 AND pe.status = 'approved' AND pe.percentage > 0
                        AND COALESCE(pe.source, 'web') NOT IN ('split', 'alloc', 'alloc_adj'))
             AND NOT EXISTS (SELECT 1 FROM progress_entries pm
                              WHERE pm.task_id = ?1 AND pm.user_id = ?2 AND pm.percentage > 0
                                AND COALESCE(pm.source, 'web') NOT IN ('split', 'alloc', 'alloc_adj'))
             AND NOT EXISTS (SELECT 1 FROM task_timer_sessions s
                              WHERE s.task_id = ?1 AND s.user_id = ?2 AND ${notVoidSql('s')}${retracted})) AS f`;
  const run = (retracted: string) => db.prepare(sql(retracted)).bind(taskId, userId).first<{ f: number }>();
  try {
    return (await run(` AND ${notRetractedSql('s')}`))?.f === 1;
  } catch {
    try {
      return (await run(''))?.f === 1;
    } catch {
      return false;
    }
  }
}

/** Таск авах / хуваахад хэрэгтэй баримт (хоёр асуулга). */
export async function loadTaskForTake(
  db: D1Database,
  taskId: number,
  userId: number,
): Promise<TaskForTake> {
  const [row, running, rootRow] = await Promise.all([
    db
      .prepare(
        `SELECT t.id, t.name, t.weight_percent, b.project_id, p.status AS project_status,
                p.progress_mode,
                COALESCE(${latestApprovedPctByCreatedAt('t.id')}, 0) AS latest_pct,
                EXISTS (SELECT 1 FROM task_self_done sd WHERE sd.task_id = t.id AND sd.user_id = ?1) AS self_done
           FROM tasks t
           INNER JOIN components c ON c.id = t.component_id
           INNER JOIN drawings d   ON d.id = c.drawing_id
           INNER JOIN blocks b     ON b.id = d.block_id
           INNER JOIN projects p   ON p.id = b.project_id
          WHERE t.id = ?2`,
      )
      .bind(userId, taskId)
      .first<{
        id: number;
        name: string;
        weight_percent: number;
        project_id: number;
        project_status: string | null;
        progress_mode: string | null;
        latest_pct: number;
        self_done: number;
      }>(),
    db
      .prepare(
        `SELECT s.user_id, u.full_name
           FROM task_timer_sessions s
           LEFT JOIN users u ON u.id = s.user_id
          WHERE s.ended_at IS NULL AND s.task_id = ?`,
      )
      .bind(taskId)
      .all<{ user_id: number; full_name: string | null }>(),
    // Хуваарилагдсан («managed») root + миний хуваарилалт (0376).  ⚠️ try/catch: 0376 хэрэгжихээс өмнө worker
    // deploy болсон ч таск авах нь унах ёсгүй (хуучин зам хэвээр).
    db
      .prepare(
        `SELECT r.unallocated_units,
                a.target_units, a.done_units, a.released_units
           FROM task_roots r
           LEFT JOIN task_allocations a ON a.task_id = r.task_id AND a.user_id = ?2
          WHERE r.task_id = ?1`,
      )
      .bind(taskId, userId)
      .first<{
        unallocated_units: number;
        target_units: number | null;
        done_units: number | null;
        released_units: number | null;
      }>()
      .catch(() => null),
  ]);
  const workers = running.results ?? [];
  const managed = rootRow !== null && rootRow !== undefined;
  // Хүнгүй хэсгүүд (0394) нь U-ийн доторх нөөц — «чөлөөт ажил»-аас хасна (тэднийг хэсэг тус бүрээр авна).  Тусдаа асуулга:
  // хүснэгт хараахан байхгүй орчинд managed төлөвийг алдагдуулахгүй.
  const reserved = managed
    ? await db
        .prepare('SELECT COALESCE(SUM(units), 0) AS u FROM task_parts WHERE task_id = ?')
        .bind(taskId)
        .first<{ u: number }>()
        .then((r) => r?.u ?? 0)
        .catch(() => 0)
    : 0;
  const alloc = managed
    ? {
        my_future_units: Math.max(0, (rootRow.target_units ?? 0) - (rootRow.done_units ?? 0)),
        my_done_units: rootRow.done_units ?? 0,
        my_released_units: rootRow.released_units ?? 0,
        unallocated_units: Math.max(0, rootRow.unallocated_units - reserved),
        has_row: rootRow.target_units !== null,
      }
    : null;
  if (!row) {
    return {
      exists: false,
      task_id: taskId,
      task_name: null,
      project_id: null,
      project_active: false,
      progress_mode: null,
      weight_percent: 0,
      latest_pct: 0,
      self_done: false,
      splittable: false,
      others: [],
      mine: false,
      foreign_progress: false,
      managed: false,
      alloc: null,
    };
  }
  return {
    exists: true,
    task_id: row.id,
    task_name: row.name,
    project_id: row.project_id,
    project_active: row.project_status === 'active',
    progress_mode: row.progress_mode,
    weight_percent: Number(row.weight_percent) || 0,
    latest_pct: Number(row.latest_pct) || 0,
    self_done: row.self_done === 1,
    splittable: isSplittableTask({ progress_mode: row.progress_mode, weight_percent: row.weight_percent }),
    others: workers.filter((w) => w.user_id !== userId),
    mine: workers.some((w) => w.user_id === userId),
    foreign_progress: await hasForeignProgress(db, taskId, userId),
    managed,
    alloc,
  };
}

export interface TimerWriteParams {
  userId: number;
  actorId: number;
  nowIso: string;
  requestId: string;
}

/**
 * Эхлүүлэх ба АТОМ сэлгэлт («Өөртөө авах»-ын цөм).  Нэг batch:
 *   1) өөр таск явж байвал зогсооно (`end_reason='switch'`) — ГЭХДЭЭ зорилтот
 *      таск өөр хүнд эзлэгдсэн (`exclusive`) бол юу ч хийхгүй;
 *   2) энэ хүнд явж буй мөр үлдээгүй бөгөөд таск эзлэгдээгүй бол шинэ мөр (тэр
 *      таск аль хэдийн явж байвал юу ч хийхгүй — давхар даралт идемпотент);
 *   3) `task_assignees`-д (ажилласан хүмүүсийн бүртгэл) мөр — байвал үл тоох;
 *   4) аудитын ганц мөр (`start` эсвэл `switch` — сэлгэлтэд хуучин сэшн/таск).
 * Шинэ сэшний эхлэл = MAX(:now, энэ хүний хамгийн сүүлд зогссон цаг) —
 * isolate-уудын цагийн мс-ийн зөрүүгээр ч хоёр сэшн давхцахгүй.
 * `inserted = 0` бол дуудагч «аль хэдийн явж байна» уу «эзлэгдсэн» үү гэдгийг
 * дахин уншиж шийднэ (`takeTask`).
 */
export async function startOfficialTimer(
  db: D1Database,
  p: TimerWriteParams & { taskId: number; projectId: number | null; exclusive?: boolean },
): Promise<{ outcome: OfficialTimerStartOutcome; inserted: number }> {
  const excl = p.exclusive ? 1 : 0;
  const close = db
    .prepare(
      `UPDATE task_timer_sessions SET ${CLOSE_SET},
              end_reason = 'switch', ended_by = ?2, end_request_id = ?3
        WHERE user_id = ?4 AND ended_at IS NULL AND task_id <> ?5
          AND NOT (?6 = 1 AND EXISTS (SELECT 1 FROM task_timer_sessions x
                                       WHERE x.task_id = ?5 AND x.ended_at IS NULL AND x.user_id <> ?4))`,
    )
    .bind(p.nowIso, p.actorId, p.requestId, p.userId, p.taskId, excl);
  const insert = db
    .prepare(
      `INSERT INTO task_timer_sessions
         (user_id, task_id, project_id, started_at, start_reason, started_by,
          start_request_id, created_at, updated_at)
       SELECT ?1, ?2, ?3,
              MAX(?4, COALESCE((SELECT MAX(z.ended_at) FROM task_timer_sessions z
                                 WHERE z.user_id = ?1 AND z.ended_at >= ?4), ?4)),
              CASE WHEN EXISTS (SELECT 1 FROM task_timer_sessions o
                                 WHERE o.user_id = ?1 AND o.ended_at >= ?4 AND o.end_request_id = ?6)
                   THEN 'switch' ELSE 'start' END,
              ?5, ?6, ?4, ?4
        WHERE NOT EXISTS (SELECT 1 FROM task_timer_sessions r
                           WHERE r.user_id = ?1 AND r.ended_at IS NULL)
          AND NOT (?7 = 1 AND EXISTS (SELECT 1 FROM task_timer_sessions x
                                       WHERE x.task_id = ?2 AND x.ended_at IS NULL AND x.user_id <> ?1))`,
    )
    .bind(p.userId, p.taskId, p.projectId, p.nowIso, p.actorId, p.requestId, excl);
  const registry = db
    .prepare(
      `INSERT OR IGNORE INTO task_assignees (task_id, user_id)
       SELECT ?2, ?1
        WHERE EXISTS (SELECT 1 FROM task_timer_sessions s
                       WHERE s.user_id = ?1 AND s.task_id = ?2 AND s.ended_at IS NULL)`,
    )
    .bind(p.userId, p.taskId);
  const event = db
    .prepare(
      `INSERT INTO task_timer_events
         (user_id, actor_id, action, session_id, task_id, from_session_id, from_task_id, at, request_id)
       SELECT n.user_id, ?2, n.start_reason, n.id, n.task_id, o.id, o.task_id, n.started_at, ?3
         FROM task_timer_sessions n
         LEFT JOIN task_timer_sessions o
                ON o.user_id = n.user_id AND o.ended_at >= ?4 AND o.end_request_id = ?3
        WHERE n.user_id = ?1 AND n.ended_at IS NULL AND n.start_request_id = ?3`,
    )
    .bind(p.userId, p.actorId, p.requestId, p.nowIso);
  const [closed, inserted] = await db.batch([close, insert, registry, event]);
  const ins = inserted?.meta.changes ?? 0;
  return { outcome: startOutcome(closed?.meta.changes ?? 0, ins), inserted: ins };
}

/**
 * Зогсоох — явж буй сэшнийг хаана.  `taskId` өгвөл ЗӨВХӨН тэр таск явж байвал —
 * хуучирсан таб A-г зогсоох гэж дарахад өөр төхөөрөмж дээр эхэлсэн B-г
 * санамсаргүй зогсоохгүй.  Буцаах: зогссон мөрийн тоо (0 эсвэл 1).
 */
export async function pauseOfficialTimer(
  db: D1Database,
  p: TimerWriteParams & { taskId: number | null },
): Promise<number> {
  const close = db
    .prepare(
      `UPDATE task_timer_sessions SET ${CLOSE_SET},
              end_reason = 'pause', ended_by = ?2, end_request_id = ?3
        WHERE user_id = ?4 AND ended_at IS NULL AND (?5 IS NULL OR task_id = ?5)`,
    )
    .bind(p.nowIso, p.actorId, p.requestId, p.userId, p.taskId);
  const event = db
    .prepare(
      `INSERT INTO task_timer_events
         (user_id, actor_id, action, session_id, task_id, at, request_id)
       SELECT user_id, ?2, 'pause', id, task_id, ended_at, ?3
         FROM task_timer_sessions
        WHERE user_id = ?1 AND ended_at >= ?4 AND end_request_id = ?3`,
    )
    .bind(p.userId, p.actorId, p.requestId, p.nowIso);
  const [closed] = await db.batch([close, event]);
  return closed?.meta.changes ?? 0;
}

/**
 * Хүний явж буй таймерыг ӨГӨГДСӨН агшинд зогсооно (өнгөрсөн байж болно):
 *   • ирцээ «Гарах» бүртгэхэд (`note='clock_out'`, тэр хүн/админ) — эзэн 2026-10-01;
 *   • админ гараар (`note='admin_stop'`);
 *   • 23:59 (`note='day_end'`, систем) — `sweepDayEndTimers`.
 * `ended_at = MAX(started_at, atIso)` — тэр агшнаас ХОЙШ эхэлсэн сэшн 0 болно.
 * `atIso` нь UTC `…Z` байх ЁСТОЙ (`toUtcIso`) — SQL `MAX` нь мөр харьцуулна.
 * `sessionId` өгвөл зөвхөн тэр сэшн (23:59-ийн sweep — хооронд нь хүн өөрөө
 * зогсоож шинийг эхлүүлсэн бол шинийг нь хөндөхгүй).
 */
export async function stopRunningTimerAt(
  db: D1Database,
  p: {
    userId: number;
    actorId: number;
    atIso: string;
    nowIso: string;
    requestId: string;
    note: OfficialTimerEndNote;
    sessionId?: number;
  },
): Promise<{ stopped: number; task_id: number | null; task_name: string | null }> {
  const sessionId = p.sessionId ?? null;
  const close = db
    .prepare(
      `UPDATE task_timer_sessions SET ${CLOSE_AT_SET},
              end_reason = 'pause', ended_by = ?2, end_request_id = ?3, end_note = ?5
        WHERE user_id = ?4 AND ended_at IS NULL AND (?6 IS NULL OR id = ?6)`,
    )
    .bind(p.atIso, p.actorId, p.requestId, p.userId, p.note, sessionId, p.nowIso);
  const event = db
    .prepare(
      `INSERT INTO task_timer_events
         (user_id, actor_id, action, session_id, task_id, at, request_id, note)
       SELECT user_id, ?2, 'pause', id, task_id, ended_at, ?3, ?4
         FROM task_timer_sessions
        WHERE user_id = ?1 AND end_request_id = ?3`,
    )
    .bind(p.userId, p.actorId, p.requestId, p.note);
  const [closed] = await db.batch([close, event]);
  const stopped = closed?.meta.changes ?? 0;
  if (stopped === 0) return { stopped, task_id: null, task_name: null };
  const row = await db
    .prepare(
      `SELECT s.task_id, t.name AS task_name
         FROM task_timer_sessions s LEFT JOIN tasks t ON t.id = s.task_id
        WHERE s.user_id = ? AND s.end_request_id = ? LIMIT 1`,
    )
    .bind(p.userId, p.requestId)
    .first<{ task_id: number; task_name: string | null }>();
  return { stopped, task_id: row?.task_id ?? null, task_name: row?.task_name ?? null };
}

/**
 * Ирцийн «Гарах» → албан таймер зогсоно (эзэн 2026-10-01).  `clockOutIso` нь
 * ирцийн `…+08:00` хэлбэртэй ч болно — энд UTC руу хөрвүүлнэ.  Алдаа нь ирцийн
 * бичилтийг унагахгүй (дуудагч `.catch`).
 */
export async function stopTimerOnClockOut(
  db: D1Database,
  p: { userId: number; actorId: number; clockOutIso: string },
): Promise<number> {
  const ms = Date.parse(p.clockOutIso);
  if (!Number.isFinite(ms)) return 0;
  const nowIso = new Date().toISOString();
  // Ирээдүйн агшин (цагийн зөрүү) бол одоогоор — таймер ирээдүйд «явж» дуусахгүй.
  const atIso = new Date(Math.min(ms, Date.parse(nowIso))).toISOString();
  const r = await stopRunningTimerAt(db, {
    userId: p.userId,
    actorId: p.actorId,
    atIso,
    nowIso,
    requestId: crypto.randomUUID(),
    note: 'clock_out',
  });
  return r.stopped;
}

/**
 * Шөнө дундыг давж мартагдсан таймерыг ЭХЭЛСЭН өдрийн 23:59:59.999-д хаана
 * (эзэн 2026-10-01).  Cron-ы fail-safe салаагаар 2 минут тутам — ажил байхгүй
 * бол ганц хямд уншилт (`ended_at IS NULL` мөрүүд л).  Буцаах: хаагдсан сэшнүүд
 * (мэдэгдэлд).
 */
export async function sweepDayEndTimers(
  db: D1Database,
  nowMs: number,
  offsetMinutes: number,
): Promise<Array<{ user_id: number; task_id: number; task_name: string | null; cutoff: string }>> {
  const todayStartIso = new Date(ubDayWindow(ubDateOf(nowMs, offsetMinutes), offsetMinutes).startMs).toISOString();
  const { results } = await db
    .prepare(
      `SELECT s.id, s.user_id, s.task_id, s.started_at, t.name AS task_name
         FROM task_timer_sessions s LEFT JOIN tasks t ON t.id = s.task_id
        WHERE s.ended_at IS NULL AND s.started_at < ?`,
    )
    .bind(todayStartIso)
    .all<{ id: number; user_id: number; task_id: number; started_at: string; task_name: string | null }>();
  const out: Array<{ user_id: number; task_id: number; task_name: string | null; cutoff: string }> = [];
  const nowIso = new Date(nowMs).toISOString();
  for (const s of results ?? []) {
    const cutoff = dayEndCutoffIso(s.started_at, offsetMinutes);
    const r = await stopRunningTimerAt(db, {
      userId: s.user_id,
      actorId: SYSTEM_ACTOR_ID,
      atIso: cutoff,
      nowIso,
      requestId: crypto.randomUUID(),
      note: 'day_end',
      sessionId: s.id,
    });
    if (r.stopped > 0) out.push({ user_id: s.user_id, task_id: s.task_id, task_name: s.task_name, cutoff });
  }
  return out;
}

/**
 * Таск дуусахад (100% батлагдсан явц эсвэл «миний хэсэг дууссан»), устгагдахад,
 * эсвэл хуваахад «хийгдсэн хэсэг» болж хаагдахад тэр таск дээр явж буй БҮХ албан
 * таймерыг хаана.  Хэнийх ч байсан — таск дууссан тул.  Буцаах: хаасан мөрийн тоо.
 */
export async function stopOfficialTimersForTask(
  db: D1Database,
  p: {
    taskId: number;
    actorId: number;
    nowIso: string;
    requestId: string;
    reason: Extract<OfficialTimerEndReason, 'auto_stop_completed' | 'auto_stop_deleted'>;
    /** Зөвхөн энэ хүний сэшн («миний хэсэг дууссан» — бусдынх хэвээр). */
    onlyUserId?: number;
    note?: OfficialTimerEndNote | null;
  },
): Promise<number> {
  const only = p.onlyUserId ?? null;
  const note = p.note ?? null;
  const close = db
    .prepare(
      `UPDATE task_timer_sessions SET ${CLOSE_SET},
              end_reason = ?2, ended_by = ?3, end_request_id = ?4, end_note = ?7
        WHERE ended_at IS NULL AND task_id = ?5 AND (?6 IS NULL OR user_id = ?6)`,
    )
    .bind(p.nowIso, p.reason, p.actorId, p.requestId, p.taskId, only, note);
  const event = db
    .prepare(
      `INSERT INTO task_timer_events
         (user_id, actor_id, action, session_id, task_id, at, request_id, note)
       SELECT user_id, ?2, ?3, id, task_id, ended_at, ?4, ?5
         FROM task_timer_sessions
        WHERE ended_at >= ?1 AND end_request_id = ?4`,
    )
    .bind(p.nowIso, p.actorId, p.reason, p.requestId, note);
  const [closed] = await db.batch([close, event]);
  return closed?.meta.changes ?? 0;
}

/* ------------------------------------------------------------------ */
/*  Өөрийн сэшнийг хүчингүй болгох / сэргээх (0379, 2026-10-02)          */
/* ------------------------------------------------------------------ */

export type VoidOutcome = 'voided' | 'already_voided' | 'not_found';
export type RestoreOutcome = 'restored' | 'not_voided' | 'not_found' | 'overlap';

/**
 * Ажилтан ӨӨРИЙН сэшнийг хүчингүй болгоно: сэшн УСТАХГҮЙ, бодит цаг хөндөгдөхгүй — `task_timer_voids`-д мөр
 * бичигдэж албан цагийн бүх уншигч (`notVoidSql`) тоолохгүй.  Явж буй сэшнийг НЭГ batch-д эхлээд ЗОГСООЖ
 * (серверийн одоогийн агшинд) дараа нь хүчингүй болгоно.  Явц, засварын цаг, оноо АВТОМАТААР устахгүй —
 * тусдаа үйлдэл.  Аудит: `task_timer_void_log` (append-only).
 */
export async function voidOwnSession(
  db: D1Database,
  p: { userId: number; sessionId: number; requestId: string; nowIso: string },
): Promise<{ outcome: VoidOutcome; was_running: boolean; task_id: number | null }> {
  const row = await db
    .prepare(
      `SELECT s.task_id, s.ended_at,
              EXISTS (SELECT 1 FROM task_timer_voids v WHERE v.session_id = s.id AND v.restored_at IS NULL) AS voided
         FROM task_timer_sessions s WHERE s.id = ? AND s.user_id = ?`,
    )
    .bind(p.sessionId, p.userId)
    .first<{ task_id: number; ended_at: string | null; voided: 0 | 1 }>();
  if (!row) return { outcome: 'not_found', was_running: false, task_id: null };
  if (row.voided === 1) return { outcome: 'already_voided', was_running: false, task_id: row.task_id };
  const running = row.ended_at === null;
  const stmts: D1PreparedStatement[] = [];
  if (running) {
    stmts.push(
      db
        .prepare(
          `UPDATE task_timer_sessions SET ${CLOSE_SET},
                  end_reason = 'pause', ended_by = ?2, end_request_id = ?3, end_note = 'void'
            WHERE id = ?4 AND user_id = ?2 AND ended_at IS NULL`,
        )
        .bind(p.nowIso, p.userId, p.requestId, p.sessionId),
      db
        .prepare(
          `INSERT INTO task_timer_events (user_id, actor_id, action, session_id, task_id, at, request_id, note)
           SELECT user_id, ?2, 'pause', id, task_id, ended_at, ?3, 'void'
             FROM task_timer_sessions WHERE id = ?1 AND end_request_id = ?3`,
        )
        .bind(p.sessionId, p.userId, p.requestId),
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO task_timer_voids (session_id, user_id, task_id, voided_at, voided_by, void_request_id)
         SELECT id, user_id, task_id, ?3, ?2, ?4 FROM task_timer_sessions
          WHERE id = ?1 AND user_id = ?2 AND ended_at IS NOT NULL
         ON CONFLICT(session_id) DO UPDATE SET
           voided_at = excluded.voided_at, voided_by = excluded.voided_by, void_request_id = excluded.void_request_id,
           restored_at = NULL, restore_request_id = NULL
          WHERE task_timer_voids.restored_at IS NOT NULL`,
      )
      .bind(p.sessionId, p.userId, p.nowIso, p.requestId),
    db
      .prepare(
        `INSERT INTO task_timer_void_log (session_id, user_id, actor_id, action, at, request_id)
         SELECT session_id, user_id, ?2, 'void', ?3, ?4 FROM task_timer_voids
          WHERE session_id = ?1 AND void_request_id = ?4`,
      )
      .bind(p.sessionId, p.userId, p.nowIso, p.requestId),
  );
  await db.batch(stmts);
  return { outcome: 'voided', was_running: running, task_id: row.task_id };
}

/**
 * Хүчингүй болгосон сэшнийг сэргээнэ — ЗӨВХӨН анхны үнэн интервал (давхар сэшн үүсгэхгүй).  Тэр интервал
 * өөр хүчинтэй сэшнтэй давхцаж байвал (`overlap`) татгалзана.
 */
export async function restoreOwnSession(
  db: D1Database,
  p: { userId: number; sessionId: number; requestId: string; nowIso: string },
): Promise<{ outcome: RestoreOutcome; task_id: number | null }> {
  const row = await db
    .prepare('SELECT s.task_id FROM task_timer_sessions s WHERE s.id = ? AND s.user_id = ?')
    .bind(p.sessionId, p.userId)
    .first<{ task_id: number }>();
  if (!row) return { outcome: 'not_found', task_id: null };
  const [restored] = await db.batch([
    db
      .prepare(
        `UPDATE task_timer_voids SET restored_at = ?3, restore_request_id = ?4
          WHERE session_id = ?1 AND user_id = ?2 AND restored_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM task_timer_sessions s
                JOIN task_timer_sessions o ON o.user_id = s.user_id AND o.id <> s.id
               WHERE s.id = task_timer_voids.session_id
                 AND o.started_at < s.ended_at
                 AND COALESCE(o.ended_at, '9999-12-31T00:00:00.000Z') > s.started_at
                 AND NOT EXISTS (SELECT 1 FROM task_timer_voids x WHERE x.session_id = o.id AND x.restored_at IS NULL))`,
      )
      .bind(p.sessionId, p.userId, p.nowIso, p.requestId),
    db
      .prepare(
        `INSERT INTO task_timer_void_log (session_id, user_id, actor_id, action, at, request_id)
         SELECT session_id, user_id, ?2, 'restore', ?3, ?4 FROM task_timer_voids
          WHERE session_id = ?1 AND restore_request_id = ?4`,
      )
      .bind(p.sessionId, p.userId, p.nowIso, p.requestId),
  ]);
  if ((restored?.meta.changes ?? 0) > 0) return { outcome: 'restored', task_id: row.task_id };
  // Яагаад: хүчингүй болгоогүй эсвэл давхцсан.
  const state = await db
    .prepare('SELECT restored_at FROM task_timer_voids WHERE session_id = ?')
    .bind(p.sessionId)
    .first<{ restored_at: string | null }>();
  if (!state || state.restored_at !== null) return { outcome: 'not_voided', task_id: row.task_id };
  return { outcome: 'overlap', task_id: row.task_id };
}

/**
 * Төслийн таскууд дээр ОДОО ажиллаж буй хүмүүс (таск тус бүрд) — төслийн
 * хуудасны «Одоо хийж буй» нүд.  ЦАГ БУЦААХГҮЙ (эзэн: зарцуулсан цаг нь зөвхөн
 * тухайн хүнд + админд).  `project_id` нь сэшн эхлэхэд хадгалагдсан.
 */
export async function loadProjectWorkers(
  db: D1Database,
  projectId: number,
): Promise<Array<{ task_id: number; user_id: number; full_name: string | null; profile_image: string | null }>> {
  const { results } = await db
    .prepare(
      `SELECT s.task_id, s.user_id, u.full_name, u.profile_image
         FROM task_timer_sessions s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.ended_at IS NULL AND s.project_id = ?`,
    )
    .bind(projectId)
    .all<{ task_id: number; user_id: number; full_name: string | null; profile_image: string | null }>();
  return results ?? [];
}

/* ------------------------------------------------------------------ */
/*  Уншилт                                                             */
/* ------------------------------------------------------------------ */

export interface OfficialRunning {
  session_id: number;
  task_id: number;
  task_name: string | null;
  project_id: number | null;
  project_name: string | null;
  started_at: string;
}

/** Ажилтны өөрийн төлөв (`GET /api/task-timer/state`). */
export interface OfficialTimerState {
  running: OfficialRunning | null;
  /** Таск тус бүрийн ДУУССАН сэшнүүдийн нийт (мс) — миний ажилласан бүх таск.
   *  Явж буй сэшнийг клиент `server_now − started_at`-аар нэмнэ. */
  tasks: Array<{ task_id: number; official_closed_ms: number; sessions: number }>;
  /** Өнөөдрийн (УБ) ДУУССАН сэшнүүдийн нийт (мс, өдрийн хилээр тайрсан). */
  official_today_closed_ms: number;
  /** Өнөөдрийн дууссан хэсэг таск тус бүрээр. */
  today_by_task: Array<{ task_id: number; official_closed_ms: number }>;
}

export async function loadRunning(db: D1Database, userId: number): Promise<OfficialRunning | null> {
  return (
    (await db
      .prepare(
        `SELECT s.id AS session_id, s.task_id, t.name AS task_name,
                s.project_id, p.name AS project_name, s.started_at
           FROM task_timer_sessions s
           LEFT JOIN tasks t    ON t.id = s.task_id
           LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.user_id = ? AND s.ended_at IS NULL`,
      )
      .bind(userId)
      .first<OfficialRunning>()) ?? null
  );
}

export async function loadOfficialTimerState(
  db: D1Database,
  userId: number,
  nowMs: number,
  today: TimeWindow,
  lunch: OfficialLunch | null,
): Promise<OfficialTimerState> {
  const dayStartIso = new Date(today.startMs).toISOString();
  const dayEndIso = new Date(today.endMs).toISOString();
  const [running, totals, todayRows] = await Promise.all([
    loadRunning(db, userId),
    // Миний ажилласан БҮХ таск (2026-10-01: «Миний ажлууд» = түүх) — хуучин
    // «хариуцагч»-ийн шүүлтүүр хасагдсан; сэшн нь 0361-ээс хойш тул цөөн.
    // Цайны цаг хассан (`officialMsSql`) — `SUM(duration_ms)` нь түүхий.
    // «Таскийг буцаах» (0386) шүүлт — хүснэгт хараахан үүсээгүй орчинд (миграцаас өмнө worker гарсан) шүүлтгүй уншина.
    (async () => {
      const q = (extra: string) =>
        db
          .prepare(
            `SELECT s.task_id, SUM(${officialMsSql('s', lunch)}) AS official_closed_ms, COUNT(*) AS sessions
               FROM task_timer_sessions s
              WHERE s.user_id = ?1 AND s.ended_at IS NOT NULL AND ${notVoidSql('s')}${extra}
              GROUP BY s.task_id`,
          )
          .bind(userId)
          .all<{ task_id: number; official_closed_ms: number | null; sessions: number }>();
      try {
        return await q(` AND ${notRetractedSql('s')}`);
      } catch {
        return await q('');
      }
    })(),
    db
      .prepare(
        `SELECT s.task_id, s.started_at, s.ended_at
           FROM task_timer_sessions s
          WHERE s.user_id = ?1 AND s.ended_at > ?2 AND s.started_at < ?3 AND ${notVoidSql('s')}`,
      )
      .bind(userId, dayStartIso, dayEndIso)
      .all<OfficialTimerSessionLite>(),
  ]);
  const day = summarizeWindow(todayRows.results ?? [], nowMs, today, lunch);
  return {
    running,
    tasks: (totals.results ?? []).map((r) => ({
      task_id: r.task_id,
      official_closed_ms: Number(r.official_closed_ms) || 0,
      sessions: r.sessions,
    })),
    official_today_closed_ms: day.official_ms,
    today_by_task: [...day.by_task].map(([task_id, ms]) => ({ task_id, official_closed_ms: ms })),
  };
}

/** Админы харагдацын нэг мөр (`GET /api/task-timer/live`). */
export interface OfficialLiveRow {
  user_id: number;
  full_name: string | null;
  username: string;
  role: string;
  profile_image: string | null;
  running: (OfficialRunning & { official_task_closed_ms: number }) | null;
  official_today_closed_ms: number;
  /** Өнөөдрийн хамгийн сүүлд зогссон сэшн (явж буй таскгүй үед «сүүлд хэзээ»). */
  last_stop: {
    at: string;
    reason: string | null;
    /** 0368 — clock_out / day_end / admin_stop / split (NULL = энгийн). */
    note: string | null;
    task_id: number;
    task_name: string | null;
  } | null;
}

/**
 * Захирал/админы харагдац — ЗӨВХӨН албан таймер (Revit-ийн цаг энд ОРОХГҮЙ).
 * Жагсаалт = идэвхтэй ажилтнууд (client/worker/support биш); асуулга 4,
 * ажилтан тутамд дуудлагагүй.
 */
export async function loadOfficialTimerLive(
  db: D1Database,
  nowMs: number,
  today: TimeWindow,
  lunch: OfficialLunch | null,
): Promise<OfficialLiveRow[]> {
  const dayStartIso = new Date(today.startMs).toISOString();
  const dayEndIso = new Date(today.endMs).toISOString();
  const [roster, running, accumulated, todayRows] = await Promise.all([
    db
      .prepare(
        `SELECT id, full_name, username, role, profile_image FROM users
          WHERE status = 'active' AND role IN ('admin', 'senior', 'engineer', 'architect')
            AND COALESCE(is_support, 0) = 0`,
      )
      .all<{ id: number; full_name: string | null; username: string; role: string; profile_image: string | null }>(),
    db
      .prepare(
        `SELECT s.user_id, s.id AS session_id, s.task_id, t.name AS task_name,
                s.project_id, p.name AS project_name, s.started_at
           FROM task_timer_sessions s
           LEFT JOIN tasks t    ON t.id = s.task_id
           LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.ended_at IS NULL`,
      )
      .all<OfficialRunning & { user_id: number }>(),
    // Явж буй таск дээрх тухайн хүний ӨМНӨХ (дууссан) сэшнүүдийн нийт (цайны цаг хассан).
    db
      .prepare(
        `SELECT r.user_id, SUM(${officialMsSql('s', lunch)}) AS ms
           FROM task_timer_sessions r
           INNER JOIN task_timer_sessions s
                   ON s.user_id = r.user_id AND s.task_id = r.task_id AND s.ended_at IS NOT NULL
                  AND ${notVoidSql('s')}
          WHERE r.ended_at IS NULL
          GROUP BY r.user_id`,
      )
      .all<{ user_id: number; ms: number | null }>(),
    db
      .prepare(
        `SELECT s.user_id, s.task_id, s.started_at, s.ended_at, s.end_reason, s.end_note, t.name AS task_name
           FROM task_timer_sessions s
           LEFT JOIN tasks t ON t.id = s.task_id
          WHERE s.ended_at > ?1 AND s.started_at < ?2 AND ${notVoidSql('s')}`,
      )
      .bind(dayStartIso, dayEndIso)
      .all<
        OfficialTimerSessionLite & {
          user_id: number;
          end_reason: string | null;
          end_note: string | null;
          task_name: string | null;
        }
      >(),
  ]);

  const runningBy = new Map((running.results ?? []).map((r) => [r.user_id, r]));
  const accBy = new Map((accumulated.results ?? []).map((r) => [r.user_id, Number(r.ms) || 0]));
  const todayBy = new Map<number, typeof todayRows.results>();
  for (const r of todayRows.results ?? []) {
    const list = todayBy.get(r.user_id) ?? [];
    list.push(r);
    todayBy.set(r.user_id, list);
  }

  return (roster.results ?? []).map((u) => {
    const run = runningBy.get(u.id) ?? null;
    const mine = todayBy.get(u.id) ?? [];
    const last = mine.reduce<(typeof mine)[number] | null>(
      (acc, s) => (acc === null || (s.ended_at ?? '') > (acc.ended_at ?? '') ? s : acc),
      null,
    );
    return {
      user_id: u.id,
      full_name: u.full_name,
      username: u.username,
      role: u.role,
      profile_image: u.profile_image,
      running: run
        ? {
            session_id: run.session_id,
            task_id: run.task_id,
            task_name: run.task_name,
            project_id: run.project_id,
            project_name: run.project_name,
            started_at: run.started_at,
            official_task_closed_ms: accBy.get(u.id) ?? 0,
          }
        : null,
      official_today_closed_ms: summarizeWindow(mine, nowMs, today, lunch).official_ms,
      last_stop: last
        ? {
            at: last.ended_at!,
            reason: last.end_reason,
            note: last.end_note,
            task_id: last.task_id,
            task_name: last.task_name,
          }
        : null,
    };
  });
}

/** Өдрийн тайланд: [from, to] мужтай давхцах сэшнүүд (явж буй нь ч). */
export async function loadSessionsOverlapping(
  db: D1Database,
  userId: number,
  win: TimeWindow,
): Promise<
  Array<OfficialTimerSessionLite & { id: number; end_reason: string | null; end_note: string | null; voided: boolean }>
> {
  // Хүчингүй болгосон сэшн ЖАГСААЛТАД үлдэнэ (`voided: true` — эзэн сэргээж болно) гэхдээ тоолуурт ОРОХГҮЙ:
  // дуудагч `voided`-ыг шүүж `splitByUbDay`-д өгнө.
  const res = await db
    .prepare(
      `SELECT s.id, s.task_id, s.started_at, s.ended_at, s.end_reason, s.end_note,
              CASE WHEN ${notVoidSql('s')} THEN 0 ELSE 1 END AS voided
         FROM task_timer_sessions s
        WHERE s.user_id = ?1 AND (s.ended_at IS NULL OR s.ended_at > ?2) AND s.started_at < ?3
        ORDER BY s.started_at, s.id`,
    )
    .bind(userId, new Date(win.startMs).toISOString(), new Date(win.endMs).toISOString())
    .all<OfficialTimerSessionLite & { id: number; end_reason: string | null; end_note: string | null; voided: 0 | 1 }>();
  return (res.results ?? []).map((r) => ({ ...r, voided: r.voided === 1 }));
}

/** Тайлангийн «Таскийн цаг» табын нэг ажилтны мөр. */
export interface OfficialReportRow extends OfficialTimerRangeSummary {
  user_id: number;
  full_name: string | null;
  username: string;
  role: string;
  profile_image: string | null;
  /** Одоо таймер нь явж байгаа эсэх. */
  running: boolean;
}

/** Төсөл тус бүрийн нийлбэр (`project_id` нь сэшин дээр хадгалагдсан). */
export interface OfficialReportProject {
  project_id: number | null;
  project_name: string | null;
  official_ms: number;
  people: number;
  tasks: number;
}

export interface OfficialReport {
  /** Мужийн бодит эхлэл — `all` цонхонд анхны сэшний өдөр. */
  from: string;
  rows: OfficialReportRow[];
  projects: OfficialReportProject[];
  totals: { official_ms: number; sessions: number; active_people: number; people: number };
}

/**
 * Админы «Таскийн цаг» тайлан: [from, to] мужийн ажилтан тус бүрийн албан цаг ба
 * төслөөр.  Асуулга 3 (ажилтан, сэшн, `all`-ийн эхлэл) — ажилтан тутамд дуудлагагүй.
 * ⚠️ Зөвхөн албан таймер (0361); Revit-ийн автомат цаг (0360) энд ОРОХГҮЙ.
 */
export async function loadOfficialTimerReport(
  db: D1Database,
  nowMs: number,
  offsetMinutes: number,
  range: { from: string; to: string; all: boolean },
  lunch: OfficialLunch | null,
): Promise<OfficialReport> {
  let from = range.from;
  if (range.all) {
    const first = await db
      .prepare(`SELECT MIN(started_at) AS m FROM task_timer_sessions`)
      .first<{ m: string | null }>();
    // Сэшн байхгүй бол `to`-той нэг өдөр (хоосон тайлан).
    from = first?.m ? ubDateOf(Date.parse(first.m), offsetMinutes) : range.to;
  }
  const win = ubRangeWindow(from, range.to, offsetMinutes);
  const startIso = new Date(win.startMs).toISOString();
  const endIso = new Date(win.endMs).toISOString();

  const [users, sessions] = await Promise.all([
    // Идэвхтэй ажилтнууд (live карттай ижил) + мужид цаг бичсэн ч одоо идэвхгүй болсон хүн.
    db
      .prepare(
        `SELECT id, full_name, username, role, profile_image FROM users
          WHERE (status = 'active' AND role IN ('admin', 'senior', 'engineer', 'architect')
                 AND COALESCE(is_support, 0) = 0)
             OR id IN (SELECT user_id FROM task_timer_sessions
                        WHERE (ended_at IS NULL OR ended_at > ?1) AND started_at < ?2)`,
      )
      .bind(startIso, endIso)
      .all<{ id: number; full_name: string | null; username: string; role: string; profile_image: string | null }>(),
    db
      .prepare(
        `SELECT s.user_id, s.task_id, s.project_id, p.name AS project_name, s.started_at, s.ended_at
           FROM task_timer_sessions s
           LEFT JOIN projects p ON p.id = s.project_id
          WHERE (s.ended_at IS NULL OR s.ended_at > ?1) AND s.started_at < ?2 AND ${notVoidSql('s')}
          ORDER BY s.started_at, s.id`,
      )
      .bind(startIso, endIso)
      .all<OfficialTimerSessionLite & { user_id: number; project_id: number | null; project_name: string | null }>(),
  ]);

  const byUser = new Map<number, Array<(typeof sessions.results)[number]>>();
  const byProject = new Map<
    number,
    { project_id: number | null; project_name: string | null; ms: number; people: Set<number>; tasks: Set<number> }
  >();
  for (const s of sessions.results ?? []) {
    const list = byUser.get(s.user_id) ?? [];
    list.push(s);
    byUser.set(s.user_id, list);

    const ms = clippedMs(s, nowMs, win, lunch);
    if (ms <= 0) continue;
    const key = s.project_id ?? 0;
    const agg = byProject.get(key) ?? {
      project_id: s.project_id,
      project_name: s.project_name,
      ms: 0,
      people: new Set<number>(),
      tasks: new Set<number>(),
    };
    agg.ms += ms;
    agg.people.add(s.user_id);
    agg.tasks.add(s.task_id);
    byProject.set(key, agg);
  }

  const rows: OfficialReportRow[] = (users.results ?? []).map((u) => {
    const mine = byUser.get(u.id) ?? [];
    return {
      user_id: u.id,
      full_name: u.full_name,
      username: u.username,
      role: u.role,
      profile_image: u.profile_image,
      // «Одоо явж байна» — зөвхөн мужид өнөөдөр багтсан үед (өнгөрсөн мужид утгагүй).
      running: win.endMs > nowMs && mine.some((s) => s.ended_at === null),
      ...summarizeRange(mine, nowMs, offsetMinutes, from, range.to, lunch),
    };
  });

  return {
    from,
    rows,
    projects: [...byProject.values()]
      .map((a) => ({
        project_id: a.project_id,
        project_name: a.project_name,
        official_ms: a.ms,
        people: a.people.size,
        tasks: a.tasks.size,
      }))
      .sort((a, b) => b.official_ms - a.official_ms),
    totals: {
      official_ms: rows.reduce((acc, r) => acc + r.official_ms, 0),
      sessions: rows.reduce((acc, r) => acc + r.sessions, 0),
      active_people: rows.filter((r) => r.official_ms > 0).length,
      people: rows.length,
    },
  };
}
